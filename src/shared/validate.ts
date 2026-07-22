/**
 * Game definition validation, shared by the editors (inline warnings) and the
 * play screen (errors block starting a game).
 */
import type { Block, Expr, GameDef, ValidationIssue, ZoneRef, CardSelector, ChoiceSpec } from './types';
import { STANDARD_FIELDS } from './types';

export function validateGameDef(def: GameDef): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const zoneIds = new Set(def.zones.map((z) => z.id));
  const varIds = new Set(def.variables.map((v) => v.id));
  const actionIds = new Set(def.actions.map((a) => a.id));
  const cardIds = new Set(def.cards.map((c) => c.id));
  const templateIds = new Set(def.templates.map((t) => t.id));
  const phaseIds = new Set(def.phases.map((p) => p.id));
  const perPlayerZoneIds = new Set(def.zones.filter((z) => z.owner === 'perPlayer').map((z) => z.id));
  const fieldIds = new Set<string>(STANDARD_FIELDS);
  for (const t of def.templates) for (const f of t.fields) fieldIds.add(f.id);
  const cardTypeIds = new Set((def.cardTypes ?? []).map((t) => t.id));
  const cardTagIds = new Set((def.cardTags ?? []).map((t) => t.id));
  const filterIds = new Set((def.filters ?? []).map((f) => f.id));
  // Vocabulary usage (cards' assignments + every walked expression), for the
  // defined-but-unused warnings emitted at the end.
  const usedTypeIds = new Set<string>();
  const usedTagIds = new Set<string>();
  const usedFilterIds = new Set<string>();

  // Static value types where statically knowable (null = unknown / id-like).
  const varTypeById = new Map(def.variables.map((v) => [v.id, v.type]));
  const fieldTypeById = new Map<string, 'number' | 'string' | null>([
    ['rank', 'number'], ['suit', 'string'], ['rankName', 'string'],
    ['color', 'string'], ['name', 'string'], ['isJoker', null],
  ]);
  for (const t of def.templates) {
    for (const f of t.fields) {
      fieldTypeById.set(f.id, f.type === 'number' ? 'number' : f.type === 'text' ? 'string' : null);
    }
  }
  function typeOf(e: Expr): 'number' | 'string' | 'boolean' | null {
    switch (e.kind) {
      case 'num': return 'number';
      case 'str': return 'string';
      case 'bool': return 'boolean';
      case 'math': case 'zoneCount': case 'countCards': case 'sumCards': case 'random':
      case 'turnNumber': case 'playerCount': case 'phaseIndex': case 'phasePos':
        return 'number';
      case 'compare': case 'logic': case 'not': case 'phaseIs':
      case 'cardTypeIs': case 'cardHasTag': case 'filterRef':
        return 'boolean';
      case 'cardField': return fieldTypeById.get(e.fieldId) ?? null;
      case 'getVar': return varTypeById.get(e.varId) ?? null;
      default: return null;
    }
  }
  function checkWinner(winner: { kind: string; varId?: string }, where: string) {
    if (winner.kind === 'highestVar' || winner.kind === 'lowestVar') {
      const vd = def.variables.find((v) => v.id === winner.varId);
      if (!vd) err(where, 'Winner references a missing variable.');
      else if (vd.scope !== 'perPlayer' || vd.type !== 'number') {
        err(where, `Winner-by-variable needs a per-player number variable; "${vd.name}" is a ${vd.scope} ${vd.type}.`);
      }
    }
  }

  const err = (where: string, message: string) => issues.push({ severity: 'error', where, message });
  const warn = (where: string, message: string) => issues.push({ severity: 'warning', where, message });

  // Every move-cause tag any block in the def can emit (typo detection for
  // tag filters): moveCards' explicit tags, draw's tag (default 'draw'),
  // and 'play' when any triggerAbilities block exists (synthetic events).
  const emittedTags = new Set<string>();
  {
    const scanTags = (blocks: Block[]) => {
      for (const b of blocks) {
        if (b.kind === 'moveCards' && b.tag != null) emittedTags.add(b.tag);
        if (b.kind === 'draw') emittedTags.add(b.tag ?? 'draw');
        if (b.kind === 'triggerAbilities') emittedTags.add('play');
        if (b.kind === 'if') { scanTags(b.then); scanTags(b.else); }
        if ('body' in b && Array.isArray((b as { body?: Block[] }).body)) scanTags((b as { body: Block[] }).body);
      }
    };
    scanTags(def.setup);
    def.phases.forEach((p) => scanTags(p.onEnter));
    def.actions.forEach((a) => { scanTags(a.script); if (a.announce) scanTags(a.announce); });
    def.triggers.forEach((t) => scanTags(t.script));
    def.cards.forEach((c) => c.abilities.forEach((a) => scanTags(a.script)));
  }

  if (!def.meta.name.trim()) warn('Game info', 'The game has no name.');
  if (def.meta.minPlayers < 1) err('Game info', 'Minimum players must be at least 1.');
  if (def.meta.maxPlayers < def.meta.minPlayers) err('Game info', 'Max players is below min players.');
  if (def.phases.length === 0) err('Systems', 'A game needs at least one phase.');
  if (def.zones.length === 0) err('Systems', 'A game needs at least one zone.');

  for (const deck of def.decks) {
    const where = `Deck "${deck.name}"`;
    if (!zoneIds.has(deck.initialZone)) err(where, 'Starting zone no longer exists.');
    if (deck.source.kind === 'custom') {
      if (deck.source.entries.length === 0) warn(where, 'Custom deck has no cards.');
      for (const e of deck.source.entries) {
        if (!cardIds.has(e.cardId)) err(where, 'References a card that no longer exists.');
        if (e.count < 1) warn(where, 'A card entry has a count below 1.');
      }
    }
  }

  for (const card of def.cards) {
    if (!templateIds.has(card.templateId)) {
      err(`Card "${card.name}"`, 'Its template no longer exists.');
    }
    if (card.typeId != null) {
      usedTypeIds.add(card.typeId);
      if (!cardTypeIds.has(card.typeId)) err(`Card "${card.name}"`, 'Has a card type that no longer exists.');
    }
    for (const tagId of card.tags ?? []) {
      usedTagIds.add(tagId);
      if (!cardTagIds.has(tagId)) err(`Card "${card.name}"`, 'Carries a tag that no longer exists.');
    }
    for (const ab of card.abilities) {
      const where = `Card "${card.name}" > ability "${ab.name}"`;
      if (ab.zoneId !== null && !zoneIds.has(ab.zoneId)) err(where, 'References a missing zone.');
      if (ab.zoneId === null && ab.on !== 'enterZone' && ab.on !== 'leaveZone') {
        err(where, `A "${ab.on}" ability needs a "while in zone" — without one it never fires.`);
      }
      if (ab.phaseId != null && !phaseIds.has(ab.phaseId)) err(where, 'References a phase that no longer exists.');
      if (ab.tagFilter != null) {
        if (ab.on !== 'enterZone' && ab.on !== 'leaveZone') {
          warn(where, 'A move-tag filter only applies to enter/leave-zone abilities — it is ignored here.');
        } else if (!emittedTags.has(ab.tagFilter)) {
          warn(where, `Filters on move tag "${ab.tagFilter}" but nothing in this game emits it — the ability never fires.`);
        }
      }
      if (ab.condition) walkExpr(ab.condition, where);
      walkBlocks(ab.script, where);
    }
  }

  for (const phase of def.phases) {
    const where = `Phase "${phase.name}"`;
    for (const id of phase.actionIds) {
      if (!actionIds.has(id)) err(where, 'Lists an action that no longer exists.');
    }
    if (phase.mode === 'auto' && phase.actionIds.length > 0) {
      warn(where, 'Auto phases skip player input; its actions will never be offered.');
    }
    walkBlocks(phase.onEnter, `${where} > on enter`);
  }

  for (const action of def.actions) {
    const where = `Action "${action.name}"`;
    if (action.target.kind !== 'none' && !zoneIds.has(action.target.zoneId)) {
      err(where, 'Targets a zone that no longer exists.');
    }
    if (action.legality) walkExpr(action.legality, `${where} > legality`);
    walkBlocks(action.script, where);
    if (action.announce) walkBlocks(action.announce, `${where} > announce`);
    if (action.announce && action.announce.length > 0 && !action.stacked) {
      warn(where, 'Has an announce script but is not stacked — announce only runs for stacked actions.');
    }
  }

  for (const z of def.zones) {
    if (z.capacity != null && z.capacity < 1) {
      warn(`Zone "${z.name}"`, 'Capacity below 1 means no card can ever enter.');
    }
  }
  if (def.cardState) {
    const rv = def.cardState.rotateVar;
    if (rv !== null) {
      const vd = def.variables.find((v) => v.id === rv);
      if (!vd) err('Card state', 'Rotate variable no longer exists.');
      else if (vd.scope !== 'perCard') err('Card state', 'Rotate variable must be per-card.');
    }
    for (const bv of def.cardState.badgeVars) {
      const vd = def.variables.find((v) => v.id === bv);
      if (!vd) err('Card state', 'A badge variable no longer exists.');
      else if (vd.scope !== 'perCard') err('Card state', `Badge variable "${vd.name}" must be per-card.`);
    }
  }
  if (def.tableLayout) {
    const tl = def.tableLayout;
    const groupIds = new Set((tl.groups ?? []).map((g) => g.id));
    for (const [zid, rect] of Object.entries(tl.board)) {
      if (!zoneIds.has(zid)) warn('Table layout', 'Positions a zone that no longer exists.');
      if (rect.groupId != null && !groupIds.has(rect.groupId)) {
        warn('Table layout', 'A zone belongs to a group that no longer exists.');
      }
    }
    for (const zid of Object.keys(tl.seat)) {
      if (!zoneIds.has(zid)) warn('Table layout', 'Positions a zone that no longer exists.');
    }
    for (const id of tl.order ?? []) {
      if (!zoneIds.has(id) && !groupIds.has(id)) {
        warn('Table layout', 'The stacking order lists an element that no longer exists.');
      }
    }
  }

  if (def.screenLayout) {
    // Selector-button catalogs per variant: showForSelector must point at a
    // role:'selector' button IN THE SAME variant (desktop and mobile are
    // separate trees — a cross-variant reference can never gate anything).
    type AnyScreenElement = import('./types').ScreenElement;
    const catalogOf = (elements: AnyScreenElement[]): Map<string, AnyScreenElement> => {
      const map = new Map<string, AnyScreenElement>();
      const collect = (els: AnyScreenElement[]) => {
        for (const el of els) {
          map.set(el.id, el);
          if (el.children) collect(el.children);
        }
      };
      collect(elements);
      return map;
    };
    const isSelectorButton = (el: AnyScreenElement | undefined): boolean =>
      el !== undefined && el.kind === 'button' && el.role === 'selector'
      && (el.selectorGroup ?? '').trim() !== '';
    const desktopCatalog = catalogOf(def.screenLayout.elements);
    const mobileCatalog = catalogOf(def.screenLayout.mobile?.elements ?? []);
    // Ids must be unique within a tree; desktop and mobile are separate trees
    // (a mobile variant typically starts as a copy of the desktop layout).
    const makeWalker = (
      seen: Set<string>,
      own: Map<string, AnyScreenElement>,
      other: Map<string, AnyScreenElement>,
      otherName: string,
    ) => {
      // role:'selector' buttons per selectorGroup name in THIS variant — a
      // group every selector button of which is missing can never switch.
      const selectorGroups = new Set<string>();
      for (const el of own.values()) {
        if (el.kind === 'button' && el.role === 'selector') {
          const g = (el.selectorGroup ?? '').trim();
          if (g !== '') selectorGroups.add(g);
        }
      }
      const walkElements = (elements: AnyScreenElement[], where: string) => {
        for (const el of elements) {
          const here = `${where} > "${el.name}"`;
          if (seen.has(el.id)) err(here, 'Duplicate element id.');
          seen.add(el.id);
          if (el.visible) walkExpr(el.visible, `${here} > visible when`);
          if ((el.kind === 'button' || el.kind === 'counter') && el.enabledWhen) {
            walkExpr(el.enabledWhen, `${here} > enabled when`);
          }
          for (const st of el.states ?? []) {
            walkExpr(st.when, `${here} > state "${st.name}"`);
          }
          (el.styleRules ?? []).forEach((r, i) => {
            walkExpr(r.when, `${here} > style rule ${i + 1}`);
          });
          if (el.kind === 'shape' && el.shape === 'path') {
            const pts = el.points ?? [];
            if (pts.length < 3) err(here, 'A path shape needs at least 3 points.');
            if (pts.some((p) => p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100)) {
              err(here, 'Path points must lie within the shape box (0-100%).');
            }
          }
          if (el.showForSelector !== undefined) {
            const target = own.get(el.showForSelector);
            if (target === undefined) {
              if (other.has(el.showForSelector)) {
                warn(here, `"Show only for" points at a selector button in the ${otherName} — pick one from this screen (each variant switches on its own).`);
              } else {
                warn(here, '"Show only for" points at a selector button that no longer exists — the element always shows.');
              }
            } else if (!isSelectorButton(target)) {
              warn(here, `"Show only for" points at "${target.name}", which is not a selector button — the element always shows.`);
            }
          }
          if (el.kind === 'button') {
            const group = (el.selectorGroup ?? '').trim();
            if (el.role === 'selector' && group === '') {
              warn(here, 'Selector button has no group name — give its radio set a group so it can switch panels.');
            }
            if (el.role !== 'selector' && group !== '' && !selectorGroups.has(group)) {
              warn(here, `Selector group "${group}" has no selector buttons — turn on the Selector role for the buttons that should switch it.`);
            }
          }
          // Flow/slot layout checks.
          if (el.kind === 'zone' && el.layout != null) {
            warn(here, 'Layout is ignored on a zone — zones arrange their cards, not child elements.');
          }
          if (el.slots !== undefined && el.slots.length > 0) {
            const slotIds = new Set(el.slots.map((s) => s.id));
            for (const child of el.children ?? []) {
              if (child.slotId !== undefined && !slotIds.has(child.slotId)) {
                warn(`${here} > "${child.name}"`, `Assigned to slot "${child.slotId}", which this container has no slot for — it won't show.`);
              }
            }
          }
          // Children are allowed on every element (groups require them).
          if (el.kind !== 'group' && el.children) walkElements(el.children, here);
          switch (el.kind) {
            case 'zone':
              if (!zoneIds.has(el.zoneId)) err(here, 'Shows a zone that no longer exists.');
              else {
                const z = def.zones.find((zz) => zz.id === el.zoneId)!;
                if (z.owner === 'shared' && el.seat !== 'shared') {
                  warn(here, `"${z.name}" is a shared zone — the seat setting is ignored.`);
                }
                if (z.owner === 'perPlayer' && el.seat === 'shared') {
                  err(here, `"${z.name}" is per-player — pick whose copy to show (viewer/opponent).`);
                }
              }
              if (el.pileBadgeField != null && !fieldIds.has(el.pileBadgeField)) {
                warn(here, `Pile badge field "${el.pileBadgeField}" is not defined on any template.`);
              }
              if (el.cardFilter) walkExpr(el.cardFilter, `${here} > card filter`);
              if (el.pileBadgeField != null && el.display !== 'piles' && el.display !== 'carousel') {
                warn(here, 'A pile badge field only shows when the display mode is "piles" or "carousel".');
              }
              break;
            case 'varText': {
              const vd = def.variables.find((v) => v.id === el.varId);
              if (!vd) err(here, 'Shows a variable that no longer exists.');
              else if (vd.scope === 'perCard') err(here, 'Per-card variables cannot be shown as a readout.');
              else if (vd.scope === 'perPlayer' && el.seat === 'shared') {
                err(here, `"${vd.name}" is per-player — pick whose value to show.`);
              }
              break;
            }
            case 'button':
              if (el.actionId !== null && el.actionId !== '__pass' && !actionIds.has(el.actionId)) {
                err(here, 'Triggers an action that no longer exists.');
              } else if (el.actionId !== null && el.actionId !== '__pass') {
                const a = def.actions.find((x) => x.id === el.actionId)!;
                if (a.target.kind !== 'none') {
                  err(here, `"${a.name}" needs a card/zone target — buttons can only trigger plain actions.`);
                }
              }
              break;
            case 'counter': {
              const vd = def.variables.find((v) => v.id === el.varId);
              if (!vd) err(here, 'Steps a variable that no longer exists.');
              else if (vd.scope === 'perCard') err(here, 'Per-card variables cannot be shown as a counter.');
              else if (vd.scope === 'perPlayer' && el.seat === 'shared') {
                err(here, `"${vd.name}" is per-player — pick whose value to show.`);
              }
              for (const [aid, side] of [[el.incActionId, '＋'], [el.decActionId, '−']] as const) {
                if (aid === null) continue;
                if (!actionIds.has(aid)) err(here, `The ${side} button triggers an action that no longer exists.`);
                else {
                  const a = def.actions.find((x) => x.id === aid)!;
                  if (a.target.kind !== 'none') {
                    err(here, `"${a.name}" needs a card/zone target — counter buttons can only trigger plain actions.`);
                  }
                }
              }
              if (el.incActionId === null && el.decActionId === null) {
                warn(here, 'Neither stepper is bound — this counter is display-only (a varText also works).');
              }
              break;
            }
            case 'text':
              for (const part of el.parts ?? []) {
                if (typeof part !== 'string') walkExpr(part, `${here} > text`);
              }
              break;
            case 'group':
              walkElements(el.children, here);
              break;
            case 'panelSwitcher': {
              const slotIds = new Set(el.slots.map((s) => s.id));
              if (!slotIds.has('tabs') || !slotIds.has('content')) {
                err(here, 'A panel switcher needs a "tabs" slot and a "content" slot.');
              }
              break;
            }
            case 'image':
              if (!el.src) warn(here, 'Image has no source — it shows an empty placeholder.');
              break;
            case 'shape': case 'line': case 'log':
              break;
          }
        }
      };
      return walkElements;
    };
    makeWalker(new Set<string>(), desktopCatalog, mobileCatalog, 'mobile layout')(def.screenLayout.elements, 'Screen');
    if (def.screenLayout.mobile) {
      makeWalker(new Set<string>(), mobileCatalog, desktopCatalog, 'desktop layout')(def.screenLayout.mobile.elements, 'Mobile screen');
      if (def.screenLayout.mobile.scroll && def.screenLayout.mobile.aspect == null) {
        warn('Mobile screen', 'Scrolling needs a page aspect (height) — set one or the page cannot be taller than the viewport.');
      }
    }
  }

  for (const trigger of def.triggers) {
    const where = `Rule "${trigger.name}"`;
    const ev = trigger.event;
    if ('zoneId' in ev && ev.zoneId !== null && !zoneIds.has(ev.zoneId)) err(where, 'Watches a missing zone.');
    if ('varId' in ev && ev.varId !== null && !varIds.has(ev.varId)) err(where, 'Watches a missing variable.');
    if ('phaseId' in ev && ev.phaseId !== null && !phaseIds.has(ev.phaseId)) err(where, 'Watches a phase that no longer exists.');
    if ((ev.kind === 'cardEnterZone' || ev.kind === 'cardLeaveZone') && ev.tag != null && !emittedTags.has(ev.tag)) {
      warn(where, `Filters on move tag "${ev.tag}" but nothing in this game emits it — the rule never fires.`);
    }
    if (ev.kind === 'effectResolved' && trigger.stacked === true) {
      warn(where, 'A stacked "effect resolved" rule pushes a new effect whenever one resolves — this can loop until the stack cap.');
    }
    if (trigger.condition) walkExpr(trigger.condition, `${where} > condition`);
    walkBlocks(trigger.script, where);
  }

  for (const ec of def.endConditions) {
    const where = `End condition "${ec.name}"`;
    if (ec.condition.kind === 'bool' && ec.condition.value) {
      err(where, 'The condition is always true — the game would end immediately after setup. Pick a real condition.');
    }
    walkExpr(ec.condition, where);
    checkWinner(ec.winner, where);
    if (ec.winner.kind === 'player') walkExpr(ec.winner.player, where);
  }

  walkBlocks(def.setup, 'Setup');

  if (def.endConditions.length === 0) {
    let endsGame = false;
    const scan = (blocks: Block[]) => {
      for (const b of blocks) {
        if (b.kind === 'endGame') endsGame = true;
        if (b.kind === 'if') { scan(b.then); scan(b.else); }
        if ('body' in b && Array.isArray((b as { body?: Block[] }).body)) scan((b as { body: Block[] }).body);
      }
    };
    scan(def.setup);
    def.phases.forEach((p) => scan(p.onEnter));
    def.actions.forEach((a) => scan(a.script));
    def.triggers.forEach((t) => scan(t.script));
    def.cards.forEach((c) => c.abilities.forEach((a) => scan(a.script)));
    if (!endsGame) warn('Systems', 'No end conditions and no "end game" block anywhere — the game can never finish.');
  }

  // Named filters: their conditions get the normal expression walk, and the
  // filterRef edges between them must form no cycle (runtime yields false on
  // re-entry, so a cycle is always an authoring mistake).
  const filters = def.filters ?? [];
  for (const f of filters) walkExpr(f.condition, `Filter "${f.name}"`);
  {
    /** Deep-scan any value for filterRef expressions (nested anywhere). */
    const collectFilterRefs = (value: unknown, out: Set<string>): void => {
      if (!value || typeof value !== 'object') return;
      if (!Array.isArray(value)) {
        const v = value as { kind?: unknown; filterId?: unknown };
        if (v.kind === 'filterRef' && typeof v.filterId === 'string') out.add(v.filterId);
      }
      for (const child of Object.values(value)) collectFilterRefs(child, out);
    };
    const edges = new Map<string, Set<string>>();
    for (const f of filters) {
      const refs = new Set<string>();
      collectFilterRefs(f.condition, refs);
      edges.set(f.id, refs);
    }
    const filterName = (id: string) => filters.find((f) => f.id === id)?.name ?? id;
    const state = new Map<string, 'visiting' | 'done'>();
    const stack: string[] = [];
    const visit = (id: string): void => {
      const s = state.get(id);
      if (s === 'done') return;
      if (s === 'visiting') {
        const names = [...stack.slice(stack.indexOf(id)), id].map((fid) => `"${filterName(fid)}"`);
        err(`Filter "${filterName(id)}"`, `Filters reference each other in a cycle (${names.join(' → ')}) — at play time the loop evaluates to false.`);
        return;
      }
      state.set(id, 'visiting');
      stack.push(id);
      for (const next of edges.get(id) ?? []) if (filterIds.has(next)) visit(next);
      stack.pop();
      state.set(id, 'done');
    };
    for (const f of filters) visit(f.id);
  }
  for (const t of def.cardTypes ?? []) {
    if (!usedTypeIds.has(t.id)) warn(`Card type "${t.name}"`, 'Defined but unused — no card has this type and no condition checks it.');
  }
  for (const t of def.cardTags ?? []) {
    if (!usedTagIds.has(t.id)) warn(`Tag "${t.name}"`, 'Defined but unused — no card carries this tag and no condition checks it.');
  }
  for (const f of filters) {
    if (!usedFilterIds.has(f.id)) warn(`Filter "${f.name}"`, 'Defined but unused — nothing references it.');
  }

  return issues;

  function checkZoneRef(ref: ZoneRef, where: string) {
    if (!zoneIds.has(ref.zoneId)) err(where, 'Uses a zone that no longer exists.');
    if (ref.owner) walkExpr(ref.owner, where);
  }

  function walkSelector(sel: CardSelector, where: string) {
    switch (sel.kind) {
      case 'top': case 'bottom': case 'random': walkExpr(sel.count, where); break;
      case 'filter': walkExpr(sel.filter, where); break;
      case 'specific': walkExpr(sel.card, where); break;
      case 'all': break;
    }
  }

  function walkChoice(choice: ChoiceSpec, where: string) {
    if (choice.kind === 'card') {
      checkZoneRef(choice.from, where);
      if (choice.filter) walkExpr(choice.filter, where);
    }
    if (choice.kind === 'option' && choice.options.length === 0) {
      err(where, 'Choice has no options.');
    }
  }

  function walkBlocks(blocks: Block[], where: string) {
    blocks.forEach((b, i) => walkBlock(b, `${where} > block ${i + 1}`));
  }

  function walkBlock(b: Block, where: string) {
    switch (b.kind) {
      case 'moveCards':
        checkZoneRef(b.from, where); checkZoneRef(b.to, where); walkSelector(b.cards, where); break;
      case 'shuffle': checkZoneRef(b.zone, where); break;
      case 'deal':
        checkZoneRef(b.from, where);
        if (!zoneIds.has(b.toZoneId)) err(where, 'Deals to a zone that no longer exists.');
        else if (!perPlayerZoneIds.has(b.toZoneId)) {
          err(where, 'Deal needs a per-player destination zone (each player gets the cards).');
        }
        walkExpr(b.count, where);
        break;
      case 'setVar':
        if (!varIds.has(b.varId)) err(where, 'Sets a variable that no longer exists.');
        if (b.target) walkExpr(b.target, where);
        walkExpr(b.value, where);
        break;
      case 'changeVar':
        if (!varIds.has(b.varId)) err(where, 'Changes a variable that no longer exists.');
        if (b.target) walkExpr(b.target, where);
        walkExpr(b.by, where);
        break;
      case 'if':
        walkExpr(b.cond, where); walkBlocks(b.then, `${where} > then`); walkBlocks(b.else, `${where} > else`); break;
      case 'repeat': walkExpr(b.times, where); walkBlocks(b.body, where); break;
      case 'repeatWhile': walkExpr(b.cond, where); walkBlocks(b.body, where); break;
      case 'forEachPlayer': walkBlocks(b.body, where); break;
      case 'forEachCard':
        checkZoneRef(b.zone, where);
        if (b.filter) walkExpr(b.filter, where);
        walkBlocks(b.body, where);
        break;
      case 'choose':
        if (b.who) walkExpr(b.who, where);
        walkChoice(b.choice, where);
        break;
      case 'chooseCards':
        if (b.who) walkExpr(b.who, where);
        checkZoneRef(b.from, where);
        if (b.filter) walkExpr(b.filter, where);
        walkExpr(b.min, where);
        walkExpr(b.max, where);
        walkBlocks(b.body, where);
        break;
      case 'choosePile':
        if (b.who) walkExpr(b.who, where);
        checkZoneRef(b.from, where);
        if (b.filter) walkExpr(b.filter, where);
        walkBlocks(b.body, where);
        break;
      case 'draw':
        if (b.who) walkExpr(b.who, where);
        walkExpr(b.count, where);
        checkZoneRef(b.from, where);
        checkZoneRef(b.to, where);
        if (b.refillFrom) {
          checkZoneRef(b.refillFrom, where);
          if (b.refillFrom.zoneId === b.from.zoneId) {
            err(where, 'Draw refills from its own source zone — pick a different refill zone (or none).');
          }
        }
        break;
      case 'triggerAbilities':
        walkExpr(b.card, where);
        if (!zoneIds.has(b.zoneId)) err(where, 'Fires enter-zone abilities for a zone that no longer exists.');
        break;
      case 'cancelTopEffect':
        if (b.cardTo !== null && !zoneIds.has(b.cardTo)) {
          err(where, 'Sends the cancelled card to a zone that no longer exists.');
        }
        break;
      case 'announce':
        for (const part of b.parts) if (typeof part !== 'string') walkExpr(part, where);
        break;
      case 'flipCards': checkZoneRef(b.zone, where); walkSelector(b.cards, where); break;
      case 'setNextPlayer': walkExpr(b.player, where); break;
      case 'endGame':
        checkWinner(b.winner, where);
        if (b.winner.kind === 'player') walkExpr(b.winner.player, where);
        break;
      case 'endPhase': case 'endTurn': break;
    }
  }

  function walkExpr(e: Expr, where: string) {
    switch (e.kind) {
      case 'getVar':
        if (!varIds.has(e.varId)) err(where, 'Reads a variable that no longer exists.');
        if (e.target) walkExpr(e.target, where);
        break;
      case 'zoneCount': case 'topCard': checkZoneRef(e.zone, where); break;
      case 'cardField':
        walkExpr(e.card, where);
        if (!fieldIds.has(e.fieldId)) warn(where, `Field "${e.fieldId}" is not defined on any template.`);
        break;
      case 'bestCard':
        checkZoneRef(e.zone, where);
        if (!fieldIds.has(e.fieldId)) warn(where, `Field "${e.fieldId}" is not defined on any template.`);
        if (e.filter) walkExpr(e.filter, where);
        break;
      case 'countCards':
        checkZoneRef(e.zone, where);
        if (e.filter) walkExpr(e.filter, where);
        break;
      case 'sumCards':
        checkZoneRef(e.zone, where);
        if (!fieldIds.has(e.fieldId)) warn(where, `Field "${e.fieldId}" is not defined on any template.`);
        if (e.filter) walkExpr(e.filter, where);
        break;
      case 'compare': {
        walkExpr(e.left, where); walkExpr(e.right, where);
        const lt = typeOf(e.left);
        const rt = typeOf(e.right);
        if (e.op === 'contains') {
          // Whole-word text membership — a statically numeric side is a bug.
          if (lt === 'number' || rt === 'number') {
            warn(where, '"contains" looks for a whole word inside text — a number on either side will never match.');
          }
          break;
        }
        if (lt && rt && lt !== rt) {
          warn(where, `Compares a ${lt} with a ${rt} — this can never match.`);
        } else if (e.op !== '==' && e.op !== '!=') {
          if ((lt && lt !== 'number') || (rt && rt !== 'number')) {
            warn(where, `"${e.op}" needs numbers on both sides.`);
          }
        }
        break;
      }
      case 'math': case 'logic':
        walkExpr(e.left, where); walkExpr(e.right, where); break;
      case 'not': walkExpr(e.expr, where); break;
      case 'nextPlayer': walkExpr(e.from, where); break;
      case 'cardOwner': case 'cardZoneId': walkExpr(e.card, where); break;
      case 'random': walkExpr(e.max, where); break;
      case 'phasePos':
        if (!phaseIds.has(e.phaseId)) err(where, 'Reads the position of a phase that no longer exists.');
        break;
      case 'phaseIs':
        if (!phaseIds.has(e.phaseId)) err(where, 'Checks a phase that no longer exists.');
        break;
      case 'cardTypeIs':
        walkExpr(e.card, where);
        usedTypeIds.add(e.typeId);
        if (!cardTypeIds.has(e.typeId)) err(where, 'Checks a card type that no longer exists.');
        break;
      case 'cardHasTag':
        walkExpr(e.card, where);
        usedTagIds.add(e.tagId);
        if (!cardTagIds.has(e.tagId)) err(where, 'Checks a tag that no longer exists.');
        break;
      case 'filterRef':
        walkExpr(e.card, where);
        usedFilterIds.add(e.filterId);
        if (!filterIds.has(e.filterId)) err(where, 'Uses a saved filter that no longer exists.');
        break;
      case 'num': case 'str': case 'bool': case 'binding':
      case 'currentPlayer': case 'playerCount': case 'turnNumber':
      case 'stackSize': case 'stackTopCard': case 'phaseIndex':
        break;
    }
  }
}
