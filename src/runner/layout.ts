/**
 * Pure helpers for the table screen: zone bucketing, legal-move indexing,
 * viewer perspective, acting-seat resolution (response windows), screen-
 * layout button gating, burn-zone keys, selector-button selection store
 * (per-device radio sets behind `showForSelector` gating), display text
 * rendering (text parts, change signatures, chronicle rows), template
 * lookup, formatting. No React.
 */
import type {
  CardInstance, CardTemplate, Expr, GameDef, GameState, Id, LogEntry, Move, PlayerState,
  RuntimeValue, ScreenElement, ZoneDef,
} from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import { evalDisplayExpr, isDisplayVisible } from '../engine';
import { resolveSeat } from './layoutGeometry';

/** Random 6-digit seed: runs are reproducible but fresh by default. */
export function rollSeed(): number {
  return 100000 + Math.floor(Math.random() * 900000);
}

/** Mirrors the engine's zone instance keys. */
export function zoneInstKey(zoneId: Id, ownerId: Id | null): string {
  return ownerId === null ? zoneId : `${zoneId}:${ownerId}`;
}

/**
 * localStorage key for a collapsible screen element's collapsed state — the
 * ONE source of truth shared by ScreenRenderer's useCollapsed (which owns
 * the live toggle) and the keyboard system's collapsed-subtree check (which
 * must skip buttons that a collapsed panel never mounts).
 */
export function collapseStorageKey(defId: Id, elId: Id): string {
  return `cardsmith.collapse.${defId}.${elId}`;
}

// ---------------------------------------------------------------------------
// Selector buttons (button role 'selector') — per-device selection store
// ---------------------------------------------------------------------------

/**
 * localStorage key for a selector GROUP's selection — the collapse-key
 * pattern; the stored value is the selected button ELEMENT id. One source of
 * truth shared by the renderer (rn-sel-on + showForSelector gating), the
 * keyboard system (auto selector-flip on a held modifier, shown-set digit
 * filtering) and the editor's canvas preview.
 */
export function selStorageKey(defId: Id, groupId: string): string {
  return `cardsmith.sel.${defId}.${groupId}`;
}

/** In-session mirror of the selection store: freshest value while mounted,
 *  and the WHOLE store where localStorage is unavailable (private mode,
 *  node tests). */
const selMemory = new Map<string, string>();
const selListeners = new Set<() => void>();
let selVersionCounter = 0;

/**
 * Monotonic version bumped by every effective writeSelection — a cheap
 * useSyncExternalStore snapshot for consumers that re-derive from reads
 * (the keyboard target index, the screen renderer's gate context).
 */
export function selectionVersion(): number {
  return selVersionCounter;
}

/** Notify `cb` after any selection write; returns the unsubscribe. */
export function subscribeSelection(cb: () => void): () => void {
  selListeners.add(cb);
  return () => {
    selListeners.delete(cb);
  };
}

/** The stored selected-button element id for a group (null = never set). */
export function readSelection(defId: Id, groupId: string): string | null {
  const key = selStorageKey(defId, groupId);
  const mem = selMemory.get(key);
  if (mem !== undefined) return mem;
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage unavailable — session-only via selMemory
  }
}

/** Persist + broadcast a group's selected button (no-op when unchanged). */
export function writeSelection(defId: Id, groupId: string, buttonId: Id): void {
  if (readSelection(defId, groupId) === buttonId) return;
  selMemory.set(selStorageKey(defId, groupId), buttonId);
  try {
    localStorage.setItem(selStorageKey(defId, groupId), buttonId);
  } catch { /* storage unavailable — the in-session mirror carries it */ }
  selVersionCounter += 1;
  for (const cb of selListeners) cb();
}

/** The trimmed selector-group name of a selector button ('' = not one). */
export function selectorGroupOf(el: ScreenElement): string {
  if (el.kind !== 'button' || el.role !== 'selector') return '';
  return (el.selectorGroup ?? '').trim();
}

/**
 * Every selector button (role 'selector' with a non-empty selectorGroup) in
 * the tree, in PAINT order (array order, depth-first) — the first of a group
 * is that group's default selection. Visibility is NOT resolved here: the
 * radio sets are client chrome, stable across game states.
 */
export function selectorButtons(
  elements: readonly ScreenElement[],
): { id: Id; group: string }[] {
  const out: { id: Id; group: string }[] = [];
  const walk = (els: readonly ScreenElement[]) => {
    for (const el of els) {
      const group = selectorGroupOf(el);
      if (group !== '') out.push({ id: el.id, group });
      if (el.children !== undefined && el.children.length > 0) walk(el.children);
    }
  };
  walk(elements);
  return out;
}

/** Resolved selector state for one screen variant (selectorContextFrom). */
export interface SelectorContext {
  /** selectorGroup name -> the ACTIVE button element id (exactly one). */
  active: ReadonlyMap<string, Id>;
  /** selector button element id -> its selectorGroup name. */
  groupOf: ReadonlyMap<Id, string>;
}

const EMPTY_SELECTOR_CONTEXT: SelectorContext = { active: new Map(), groupOf: new Map() };

/**
 * Resolve every selector group of a tree: the `stored` choice while it names
 * one of the group's buttons, else the FIRST button in paint order (the
 * max-1 invariant holds by construction — `active` maps each group to
 * exactly one id). Pure: `stored` abstracts the store so the editor preview
 * can layer its own override on top.
 */
export function selectorContextFrom(
  elements: readonly ScreenElement[],
  stored: (groupId: string) => string | null,
): SelectorContext {
  const buttons = selectorButtons(elements);
  if (buttons.length === 0) return EMPTY_SELECTOR_CONTEXT;
  const groupOf = new Map<Id, string>();
  const byGroup = new Map<string, Id[]>();
  for (const b of buttons) {
    groupOf.set(b.id, b.group);
    const list = byGroup.get(b.group);
    if (list) list.push(b.id);
    else byGroup.set(b.group, [b.id]);
  }
  const active = new Map<string, Id>();
  for (const [group, ids] of byGroup) {
    const s = stored(group);
    active.set(group, s !== null && ids.includes(s) ? s : ids[0]);
  }
  return { active, groupOf };
}

/** The store-backed context the runner renders right now. */
export function selectorContext(defId: Id, elements: readonly ScreenElement[]): SelectorContext {
  return selectorContextFrom(elements, (group) => readSelection(defId, group));
}

/**
 * The element's `showForSelector` gate: true while the referenced selector
 * button is its group's active selection. Composes with `visible` — callers
 * check both. A dangling / non-selector target leaves the gate OPEN (the
 * element stays visible; validateGameDef warns about the bad reference).
 */
export function selectorGateOpen(sel: SelectorContext, el: ScreenElement): boolean {
  const target = el.showForSelector;
  if (target === undefined) return true;
  const group = sel.groupOf.get(target);
  if (group === undefined) return true; // dangling — warn-only, never hide
  return sel.active.get(group) === target;
}

export function templateOf(def: GameDef, card: CardInstance): CardTemplate | null {
  if (card.templateId === null) return null;
  return def.templates.find((t) => t.id === card.templateId) ?? null;
}

export function formatVarValue(v: RuntimeValue | undefined): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  return String(v);
}

// ---------------------------------------------------------------------------
// Table placement
// ---------------------------------------------------------------------------

export interface ZoneBuckets {
  /** Shared zones — rendered in the middle (a shared zone marked area
   *  'player' has no single seat, so it lands here too, defensively). */
  sharedCenter: ZoneDef[];
  /** perPlayer zones with area 'center': one row per zone, owner captions. */
  perPlayerCenter: ZoneDef[];
  /** perPlayer zones with area 'player': opponent strips + the viewer's area. */
  perPlayerSeat: ZoneDef[];
}

export function bucketZones(def: GameDef): ZoneBuckets {
  const sharedCenter: ZoneDef[] = [];
  const perPlayerCenter: ZoneDef[] = [];
  const perPlayerSeat: ZoneDef[] = [];
  for (const z of def.zones) {
    if (z.owner === 'shared') sharedCenter.push(z);
    else if (z.area === 'center') perPlayerCenter.push(z);
    else perPlayerSeat.push(z);
  }
  return { sharedCenter, perPlayerCenter, perPlayerSeat };
}

// ---------------------------------------------------------------------------
// Screen layout (def.screenLayout)
// ---------------------------------------------------------------------------

/** Card width fallback when an authored element has no cardScale (% of screen width). */
export const DEFAULT_CARD_SCALE = 8;

/** Authored card scale (% of the screen's width) -> px, with a floor so cards stay visible. */
export function cardPxFromScale(screenW: number, cardScale: number | undefined): number {
  return Math.max(24, Math.round((screenW * (cardScale ?? DEFAULT_CARD_SCALE)) / 100));
}

/**
 * Action ids bound to button elements that are currently VISIBLE to the
 * viewer (their own `visible`, every ancestor group's pass, and any
 * `showForSelector` gate along the chain). The automatic action bar filters
 * these out so a move never shows twice; hidden buttons leave their action
 * in the bar so it always stays reachable. Selector-role buttons never
 * perform their bound action, so they never count. Takes the ACTIVE element
 * tree (desktop or mobile variant).
 */
export function visibleButtonActionIds(
  def: GameDef,
  state: GameState,
  elements: readonly ScreenElement[],
  viewerId: Id,
): Set<Id> {
  const out = new Set<Id>();
  const sel = selectorContext(def.meta.id, elements);
  const walk = (els: readonly ScreenElement[]) => {
    for (const el of els) {
      if (!isDisplayVisible(def, state, el.visible ?? null, viewerId)) continue;
      if (!selectorGateOpen(sel, el)) continue;
      if (el.kind === 'button' && el.actionId !== null && el.role !== 'selector') {
        out.add(el.actionId);
      } else if (el.kind === 'group') walk(el.children);
    }
  };
  walk(elements);
  return out;
}

/**
 * Zone INSTANCE keys whose screen elements play the burn choreography on
 * arriving cards (arriveEffect 'burn'), seats resolved for this viewer.
 * Visibility is ignored — a briefly hidden trash zone still burns.
 */
export function burnZoneKeys(
  def: GameDef,
  state: GameState,
  elements: readonly ScreenElement[],
  viewerId: Id,
): Set<string> {
  const out = new Set<string>();
  const playerIds = state.players.map((p) => p.id);
  const walk = (els: readonly ScreenElement[]) => {
    for (const el of els) {
      if (el.kind === 'group') {
        walk(el.children);
        continue;
      }
      if (el.kind !== 'zone' || el.arriveEffect !== 'burn') continue;
      const zone = def.zones.find((z) => z.id === el.zoneId);
      if (!zone) continue;
      if (zone.owner === 'shared') {
        out.add(zoneInstKey(zone.id, null));
        continue;
      }
      if (el.seat === 'shared') continue;
      const pid = resolveSeat(playerIds, viewerId, el.seat, state.currentPlayerIdx);
      if (pid !== null) out.add(zoneInstKey(zone.id, pid));
    }
  };
  walk(elements);
  return out;
}

// ---------------------------------------------------------------------------
// Display text (text parts, change signatures, log rows)
// ---------------------------------------------------------------------------

/**
 * Mirror of announce's renderValue, client-side: player ids render as player
 * names, card instance ids as card names, null as '' — everything else
 * stringifies.
 */
export function renderDisplayValue(state: GameState, v: RuntimeValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') {
    const player = state.players.find((p) => p.id === v);
    if (player) return player.name;
    const card = state.cards[v];
    if (card) return card.name;
  }
  return String(v);
}

/**
 * Resolve a text element's `parts`: string segments pass through, expression
 * segments evaluate with the display evaluator ($viewer bound) and render
 * like announce text (ids → names). A failing expression yields ''.
 */
export function renderTextParts(
  def: GameDef,
  state: GameState,
  parts: readonly (string | Expr)[],
  viewerId: Id,
): string {
  return parts
    .map((p) => (typeof p === 'string' ? p : renderDisplayValue(state, evalDisplayExpr(def, state, p, viewerId))))
    .join('');
}

/** A varText element's current value (undefined = element renders nothing). */
export function varTextValue(
  def: GameDef,
  state: GameState,
  el: Extract<ScreenElement, { kind: 'varText' }>,
  viewerId: Id,
): RuntimeValue | undefined {
  const vd = def.variables.find((v) => v.id === el.varId);
  if (!vd || vd.scope === 'perCard') return undefined;
  if (vd.scope === 'global') return state.globalVars[el.varId];
  if (el.seat === 'shared') return undefined;
  const pid = resolveSeat(state.players.map((p) => p.id), viewerId, el.seat, state.currentPlayerIdx);
  if (pid === null) return undefined;
  return state.players.find((p) => p.id === pid)?.vars[el.varId];
}

/**
 * Signature of an element's resolved CONTENT, used by onChangeAnim: the
 * one-shot retriggers when the resolved text / value / label or the active
 * state id changes — never on unrelated re-renders.
 */
export function elementContentSig(
  def: GameDef,
  state: GameState,
  el: ScreenElement,
  viewerId: Id,
  stateId: Id | null,
): string {
  const st = stateId ?? '';
  switch (el.kind) {
    case 'text': {
      const text = el.parts !== undefined && el.parts.length > 0
        ? renderTextParts(def, state, el.parts, viewerId)
        : el.text;
      return `${st}|${text}`;
    }
    case 'varText':
      return `${st}|${formatVarValue(varTextValue(def, state, el, viewerId))}`;
    case 'shape':
      return `${st}|${el.label ?? ''}`;
    case 'button':
      return `${st}|${el.label}`;
    default:
      return st;
  }
}

export type LogRow =
  | { kind: 'sep'; turn: number }
  | { kind: 'entry'; index: number; turn: number; text: string };

/**
 * Log entries -> render rows for the chronicle ('log' element): with
 * `turnSeparators`, a "Turn N" divider precedes each turn's first entry.
 */
export function logRows(entries: readonly LogEntry[], turnSeparators: boolean): LogRow[] {
  const rows: LogRow[] = [];
  let lastTurn: number | null = null;
  entries.forEach((e, index) => {
    if (turnSeparators && e.turn !== lastTurn) {
      rows.push({ kind: 'sep', turn: e.turn });
      lastTurn = e.turn;
    }
    rows.push({ kind: 'entry', index, turn: e.turn, text: e.text });
  });
  return rows;
}

/**
 * Legal none-target moves (incl. the built-in Pass) keyed by action id —
 * what screen buttons check to enable themselves and perform on tap.
 */
export function noneTargetMoveByAction(def: GameDef, moves: Move[]): Map<Id, Move> {
  const map = new Map<Id, Move>();
  for (const m of moves) {
    if (m.cardId !== undefined) continue;
    if (m.actionId === PASS_ACTION_ID) {
      map.set(m.actionId, m);
      continue;
    }
    const action = def.actions.find((a) => a.id === m.actionId);
    if (action && action.target.kind === 'none') map.set(m.actionId, m);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Acting seat (response windows)
// ---------------------------------------------------------------------------

/**
 * The seat that may act right now: the response-window priority holder while
 * a window is open, else the current player.
 */
export function actingSeat(state: GameState): PlayerState | null {
  if (state.window !== null) {
    return state.players.find((p) => p.id === state.window!.holderId) ?? null;
  }
  return state.players[state.currentPlayerIdx] ?? null;
}

// ---------------------------------------------------------------------------
// Viewer perspective
// ---------------------------------------------------------------------------

/**
 * Whose eyes the table is rendered through: the player answering a pending
 * human choice, else the response-window holder when human, else the current
 * player when human, else the most recent human seat (or the first human).
 * With no human seat at all (all-AI spectate) the viewer is a spectator — an
 * id matching no player — so owner-visibility zones stay face-down while
 * 'all' zones remain visible.
 */
export const SPECTATOR_ID: Id = '';

export function pickViewer(state: GameState, choicePlayerId: Id | null, lastHuman: Id | null): Id {
  const humans = state.players.filter((p) => !p.isAI);
  if (choicePlayerId !== null && humans.some((p) => p.id === choicePlayerId)) return choicePlayerId;
  if (state.window !== null && humans.some((p) => p.id === state.window!.holderId)) {
    return state.window.holderId;
  }
  const cur = state.players[state.currentPlayerIdx];
  if (cur && !cur.isAI) return cur.id;
  if (lastHuman !== null && state.players.some((p) => p.id === lastHuman)) return lastHuman;
  if (humans.length > 0) return humans[0].id;
  return SPECTATOR_ID;
}

// ---------------------------------------------------------------------------
// Legal-move indexing
// ---------------------------------------------------------------------------

function push<K>(map: Map<K, Move[]>, key: K, move: Move): void {
  const list = map.get(key);
  if (list) list.push(move);
  else map.set(key, [move]);
}

/** Card-target moves indexed by card instance id. */
export function movesByCard(moves: Move[]): Map<Id, Move[]> {
  const map = new Map<Id, Move[]>();
  for (const m of moves) {
    if (m.cardId !== undefined) push(map, m.cardId, m);
  }
  return map;
}

/**
 * Zone-target moves indexed by zone INSTANCE key (which instances should
 * pulse and accept taps). The engine's Move for a 'zone' target carries no
 * instance — the script always runs against the ACTING seat's contextual
 * instance (the window holder during a response window, else the current
 * player). So only that instance (or a shared zone's single instance) may
 * be tappable; other players' instances would be misleading tap targets.
 */
export function movesByZoneInstance(def: GameDef, state: GameState, moves: Move[]): Map<string, Move[]> {
  const map = new Map<string, Move[]>();
  const actor = actingSeat(state);
  for (const m of moves) {
    if (m.cardId !== undefined) continue;
    const action = def.actions.find((a) => a.id === m.actionId);
    if (!action) continue;
    const target = action.target;
    if (target.kind !== 'zone') continue;
    const zdef = def.zones.find((z) => z.id === target.zoneId);
    if (!zdef) continue;
    const key = zdef.owner === 'shared'
      ? zoneInstKey(zdef.id, null)
      : actor
        ? zoneInstKey(zdef.id, actor.id)
        : null;
    if (key !== null) push(map, key, m);
  }
  return map;
}

/**
 * Plain-button moves (target 'none') for the bottom action bar. The built-in
 * Pass move (response windows) renders last, as "Pass". Moves whose action id
 * is in `exclude` (visible screen-layout buttons) are dropped — Pass too —
 * so a move never appears both on screen and in the bar.
 */
export function buttonMoves(
  def: GameDef,
  moves: Move[],
  exclude?: ReadonlySet<Id>,
): { move: Move; name: string }[] {
  const out: { move: Move; name: string }[] = [];
  let pass: Move | null = null;
  for (const m of moves) {
    if (m.cardId !== undefined) continue;
    if (exclude?.has(m.actionId)) continue;
    if (m.actionId === PASS_ACTION_ID) {
      pass = m;
      continue;
    }
    const action = def.actions.find((a) => a.id === m.actionId);
    if (!action || action.target.kind !== 'none') continue;
    out.push({ move: m, name: action.name });
  }
  if (pass) out.push({ move: pass, name: 'Pass' });
  return out;
}
