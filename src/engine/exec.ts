/**
 * Block interpreter. Scripts run against the live core state; every visible
 * mutation calls notify() and enqueues events for the post-script drain.
 * `endPhase`/`endTurn`/`endGame` unwind via StopScript; the per-settle block
 * budget unwinds via BudgetExceeded. Both are caught at the runScript boundary
 * so nothing ever throws out of the engine.
 */
import type {
  Block, CardSelector, ChoiceAnswer, ChoiceRequest, ChoiceSpec, Expr, Id, RuntimeValue, VariableDef,
  ZoneInstance, ZoneRef,
} from '../shared/types';
import type { Core, Frame } from './internals';
import {
  BudgetExceeded, StopScript, currentPlayer, findZoneOfCard, isPlayerId, notify, report,
  syncStackView, zoneInstanceKey,
} from './internals';
import {
  contextualCardId, contextualPlayerId, evalExpr, resolveZoneInst, scriptCtx, toNum, truthy,
  type EvalCtx,
} from './expr';
import { shuffleInPlace } from './rng';

interface ExecCtx {
  core: Core;
  frames: Frame[];
}

/** Run a script to completion, absorbing control-flow and budget unwinds. */
export async function runScript(core: Core, blocks: Block[], frames: Frame[]): Promise<void> {
  try {
    await execBlocks({ core, frames }, blocks);
  } catch (e) {
    if (e instanceof StopScript) return;
    if (e instanceof BudgetExceeded) {
      if (!core.budgetReported) {
        core.budgetReported = true;
        report(core, 'Script aborted: instruction budget exceeded (possible infinite loop).');
      }
      return;
    }
    // Defensive: unexpected internal errors must not escape the engine.
    report(core, `Internal script error: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function execBlocks(ctx: ExecCtx, blocks: Block[]): Promise<void> {
  for (const b of blocks) {
    if (--ctx.core.budget < 0) throw new BudgetExceeded();
    await execBlock(ctx, b);
  }
}

function ectx(ctx: ExecCtx): EvalCtx {
  return scriptCtx(ctx.core, ctx.frames);
}

// ---------------------------------------------------------------------------
// Card selection & movement
// ---------------------------------------------------------------------------

/** Select from a zone instance for top/bottom/all/filter/random selectors (bottom→top order). */
function selectFromZone(ctx: ExecCtx, inst: ZoneInstance, sel: Exclude<CardSelector, { kind: 'specific' }>): Id[] {
  const e = ectx(ctx);
  switch (sel.kind) {
    case 'all':
      return [...inst.cardIds];
    case 'top': {
      const n = Math.max(0, Math.floor(toNum(e, evalExpr(e, sel.count))));
      return inst.cardIds.slice(Math.max(0, inst.cardIds.length - n));
    }
    case 'bottom': {
      const n = Math.max(0, Math.floor(toNum(e, evalExpr(e, sel.count))));
      return inst.cardIds.slice(0, n);
    }
    case 'filter': {
      const out: Id[] = [];
      for (const cid of inst.cardIds) {
        ctx.frames.push({ $card: cid });
        if (truthy(evalExpr(e, sel.filter))) out.push(cid);
        ctx.frames.pop();
      }
      return out;
    }
    case 'random': {
      const n = Math.max(0, Math.min(inst.cardIds.length, Math.floor(toNum(e, evalExpr(e, sel.count)))));
      // Partial Fisher-Yates over indices, then restore source order.
      const idx = inst.cardIds.map((_, i) => i);
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(ctx.core.rng.next() * (idx.length - i));
        const tmp = idx[i];
        idx[i] = idx[j];
        idx[j] = tmp;
      }
      return idx.slice(0, n).sort((a, b) => a - b).map((i) => inst.cardIds[i]);
    }
  }
}

/**
 * Move a group (in source bottom→top relative order) between instances,
 * preserving relative order, setting facing, enqueueing leave/enter and
 * zoneEmptied events. Same-instance moves just reorder (no events).
 * `tag` is the move's cause (null = untagged): carried on both events and
 * stamped on each card's `moveTag` (rendering surface for per-tag flights).
 */
export function performMove(
  core: Core,
  from: ZoneInstance,
  to: ZoneInstance,
  ids: Id[],
  toPosition: 'top' | 'bottom',
  faceUp: boolean | null,
  tag: string | null = null,
): void {
  if (ids.length === 0) return;
  // Capacity: a full destination takes only what fits (excess stays put).
  if (from.key !== to.key) {
    const zdef = core.def.zones.find((z) => z.id === to.zoneId);
    if (zdef && zdef.capacity != null) {
      const room = Math.max(0, zdef.capacity - to.cardIds.length);
      if (ids.length > room) {
        report(core, `Zone "${zdef.name}" is full (${zdef.capacity}) — ${ids.length - room} card(s) stayed behind.`);
        ids = ids.slice(0, room);
        if (ids.length === 0) return;
      }
    }
  }
  const moving = new Set(ids);
  from.cardIds = from.cardIds.filter((id) => !moving.has(id));
  if (faceUp !== null) {
    for (const id of ids) {
      const card = core.state.cards[id];
      if (card) card.faceUp = faceUp;
    }
  }
  if (toPosition === 'top') to.cardIds.push(...ids);
  else to.cardIds.unshift(...ids);
  if (from.key !== to.key) {
    const moveTags = (core.state.moveTags ??= {});
    for (const id of ids) {
      moveTags[id] = tag;
      core.queue.push({ kind: 'cardLeaveZone', cardId: id, fromZoneId: from.zoneId, toZoneId: to.zoneId, fromOwner: from.ownerId, tag });
      core.queue.push({ kind: 'cardEnterZone', cardId: id, fromZoneId: from.zoneId, toZoneId: to.zoneId, toOwner: to.ownerId, tag });
    }
    if (from.cardIds.length === 0) {
      core.queue.push({ kind: 'zoneEmptied', zoneId: from.zoneId, owner: from.ownerId });
    }
  }
  notify(core);
}

/** Resolve a 'specific' selector to a single existing card id (or null = no-op). */
function resolveSpecificCard(ctx: ExecCtx, cardExpr: Expr): Id | null {
  const v = evalExpr(ectx(ctx), cardExpr);
  if (v === null) return null; // e.g. a declined choice — silently no-op
  if (typeof v !== 'string' || !ctx.core.state.cards[v]) {
    report(ctx.core, `moveCards: "${String(v)}" is not a card.`);
    return null;
  }
  return v;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

interface VarSlot {
  get(): RuntimeValue;
  set(v: RuntimeValue): void;
  playerId: Id | null;
  cardId: Id | null;
}

function resolveVarSlot(ctx: ExecCtx, vd: VariableDef, target: Expr | null): VarSlot | null {
  const core = ctx.core;
  const e = ectx(ctx);
  if (vd.scope === 'global') {
    return {
      get: () => core.state.globalVars[vd.id] ?? null,
      set: (v) => { core.state.globalVars[vd.id] = v; },
      playerId: null,
      cardId: null,
    };
  }
  if (vd.scope === 'perPlayer') {
    const pid = target ? evalExpr(e, target) : contextualPlayerId(e);
    if (!isPlayerId(core, pid)) {
      report(core, `Variable "${vd.name}": target is not a player.`);
      return null;
    }
    const p = core.state.players.find((pl) => pl.id === pid)!;
    return {
      get: () => p.vars[vd.id] ?? null,
      set: (v) => { p.vars[vd.id] = v; },
      playerId: pid,
      cardId: null,
    };
  }
  const cid = target ? evalExpr(e, target) : contextualCardId(e);
  if (typeof cid !== 'string' || !core.state.cards[cid]) {
    report(core, `Variable "${vd.name}": needs a card target (no $card/$self bound).`);
    return null;
  }
  const card = core.state.cards[cid];
  return {
    get: () => card.vars[vd.id] ?? null,
    set: (v) => { card.vars[vd.id] = v; },
    playerId: null,
    cardId: cid,
  };
}

function coerceToVarType(ctx: ExecCtx, vd: VariableDef, v: RuntimeValue): RuntimeValue {
  switch (vd.type) {
    case 'number': return toNum(ectx(ctx), v);
    case 'string': return v === null ? '' : String(v);
    case 'boolean': return truthy(v);
  }
}

function writeVar(ctx: ExecCtx, varId: Id, target: Expr | null, value: RuntimeValue): void {
  const vd = ctx.core.def.variables.find((v) => v.id === varId);
  if (!vd) {
    report(ctx.core, `Unknown variable "${varId}".`);
    return;
  }
  const slot = resolveVarSlot(ctx, vd, target);
  if (!slot) return;
  const next = coerceToVarType(ctx, vd, value);
  if (slot.get() === next) return; // varChanged fires only on actual change
  slot.set(next);
  ctx.core.queue.push({ kind: 'varChanged', varId: vd.id, playerId: slot.playerId, cardId: slot.cardId });
  notify(ctx.core);
}

// ---------------------------------------------------------------------------
// Choices
// ---------------------------------------------------------------------------

function setChoice(ctx: ExecCtx, value: ChoiceAnswer): void {
  // $choice lands in the CURRENT frame so it scopes with loops/branches.
  ctx.frames[ctx.frames.length - 1]['$choice'] = value;
}

/** Parse a 'cards' answer (JSON array string of distinct candidate ids). */
function parseCardsAnswer(req: Extract<ChoiceRequest, { kind: 'cards' }>, a: ChoiceAnswer): Id[] | null {
  if (typeof a !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(a);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.every((x): x is string => typeof x === 'string')) return null;
  const unique = new Set(parsed);
  if (unique.size !== parsed.length) return null;
  if (parsed.length < req.min || parsed.length > req.max) return null;
  if (!parsed.every((cid) => req.cardIds.includes(cid))) return null;
  return parsed;
}

function validAnswer(req: ChoiceRequest, a: ChoiceAnswer): boolean {
  switch (req.kind) {
    case 'card': return (a === null && req.optional) || (typeof a === 'string' && req.cardIds.includes(a));
    case 'option': return typeof a === 'string' && req.options.some((o) => o.id === a);
    case 'player': return typeof a === 'string' && req.playerIds.includes(a);
    case 'yesNo': return typeof a === 'boolean';
    case 'cards': return parseCardsAnswer(req, a) !== null;
    case 'pile': return (a === null && req.optional) || (typeof a === 'string' && req.cardIds.includes(a));
  }
}

function fallbackAnswer(req: ChoiceRequest): ChoiceAnswer {
  switch (req.kind) {
    case 'card': return req.cardIds[0];
    case 'option': return req.options[0].id;
    case 'player': return req.playerIds[0];
    case 'yesNo': return true;
    case 'cards': return JSON.stringify(req.cardIds.slice(0, req.min));
    case 'pile': return req.cardIds[0];
  }
}

/**
 * The one answer a request admits, or undefined when there is a real
 * decision. Auto-resolved requests never reach the choice provider — no
 * sheet, no AI delay, no waiting on a remote seat. Revealed requests are
 * NEVER forced: the choice sheet doubles as the reveal UI, and answering
 * for the player would skip information they are entitled to see.
 */
function forcedAnswer(req: ChoiceRequest): ChoiceAnswer | undefined {
  if ((req.kind === 'card' || req.kind === 'cards' || req.kind === 'pile') && req.revealed === true) {
    return undefined;
  }
  switch (req.kind) {
    case 'card': return !req.optional && req.cardIds.length === 1 ? req.cardIds[0] : undefined;
    case 'option': return req.options.length === 1 ? req.options[0].id : undefined;
    case 'player': return req.playerIds.length === 1 ? req.playerIds[0] : undefined;
    case 'yesNo': return undefined; // two valid answers, always a decision
    case 'cards': return req.min === req.max && req.max === req.cardIds.length
      ? JSON.stringify(req.cardIds)
      : undefined;
    case 'pile': return !req.optional && req.cardIds.length === 1 ? req.cardIds[0] : undefined;
  }
}

async function askChoice(core: Core, req: ChoiceRequest): Promise<ChoiceAnswer> {
  // No real decision ⇒ resolve it ourselves, with a log line so players see
  // why the game moved on without asking.
  const forced = forcedAnswer(req);
  if (forced !== undefined) {
    core.state.log.push({
      turn: core.state.turnNumber,
      text: `${req.prompt} — only one option; resolved automatically.`,
    });
    notify(core);
    return forced;
  }
  core.pendingChoice = true;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let answer: ChoiceAnswer;
      try {
        answer = await core.opts.choiceProvider.resolve(req, structuredClone(core.state));
      } catch (e) {
        report(core, `Choice provider failed: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      if (validAnswer(req, answer)) return answer;
    }
  } finally {
    core.pendingChoice = false;
  }
  report(core, `Choice "${req.prompt}": no valid answer after 3 attempts — using the first candidate.`);
  return fallbackAnswer(req);
}

function resolveAsker(ctx: ExecCtx, who: Expr | null): Id {
  const core = ctx.core;
  if (who) {
    const v = evalExpr(ectx(ctx), who);
    if (isPlayerId(core, v)) return v;
    report(core, 'choose: "who" is not a player — asking the current player.');
  }
  return currentPlayer(core).id;
}

/** Candidate ids from a zone ref + optional filter ($card bound per candidate). */
function filterCandidates(ctx: ExecCtx, from: ZoneRef, filter: Expr | null): Id[] {
  const e = ectx(ctx);
  const inst = resolveZoneInst(e, from);
  let cardIds: Id[] = inst ? [...inst.cardIds] : [];
  if (filter && inst) {
    cardIds = cardIds.filter((cid) => {
      ctx.frames.push({ $card: cid });
      const ok = truthy(evalExpr(e, filter));
      ctx.frames.pop();
      return ok;
    });
  }
  return cardIds;
}

async function execChoose(ctx: ExecCtx, who: Expr | null, spec: ChoiceSpec): Promise<void> {
  const core = ctx.core;
  const askerId = resolveAsker(ctx, who);
  const id = ++core.choiceSeq;

  let req: ChoiceRequest;
  let optional = false;
  switch (spec.kind) {
    case 'card': {
      optional = spec.optional;
      const cardIds = filterCandidates(ctx, spec.from, spec.filter);
      if (cardIds.length === 0) {
        setChoice(ctx, null);
        if (!optional) report(core, `Choice "${spec.prompt}": no cards to choose from.`);
        return;
      }
      req = {
        id, playerId: askerId, kind: 'card', prompt: spec.prompt, cardIds, optional,
        revealed: spec.revealed === true,
      };
      break;
    }
    case 'option': {
      if (spec.options.length === 0) {
        setChoice(ctx, null);
        report(core, `Choice "${spec.prompt}": no options to choose from.`);
        return;
      }
      req = { id, playerId: askerId, kind: 'option', prompt: spec.prompt, options: spec.options.map((o) => ({ ...o })) };
      break;
    }
    case 'player': {
      const playerIds = core.state.players.map((p) => p.id).filter((pid) => spec.includeSelf || pid !== askerId);
      if (playerIds.length === 0) {
        setChoice(ctx, null);
        report(core, `Choice "${spec.prompt}": no players to choose from.`);
        return;
      }
      req = { id, playerId: askerId, kind: 'player', prompt: spec.prompt, playerIds };
      break;
    }
    case 'yesNo':
      req = { id, playerId: askerId, kind: 'yesNo', prompt: spec.prompt };
      break;
  }
  setChoice(ctx, await askChoice(core, req));
}

// ---------------------------------------------------------------------------
// Announce
// ---------------------------------------------------------------------------

/** Player ids render as player names, card instance ids as card names. */
function renderValue(core: Core, v: RuntimeValue): string {
  if (v === null) return '';
  if (typeof v === 'string') {
    const player = core.state.players.find((p) => p.id === v);
    if (player) return player.name;
    const card = core.state.cards[v];
    if (card) return card.name;
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// Block dispatch
// ---------------------------------------------------------------------------

async function execBlock(ctx: ExecCtx, b: Block): Promise<void> {
  const core = ctx.core;
  const e = ectx(ctx);
  switch (b.kind) {
    case 'moveCards': {
      let from: ZoneInstance | null;
      let ids: Id[];
      if (b.cards.kind === 'specific') {
        // The card's ACTUAL zone is the source; the `from` ref is advisory.
        const cid = resolveSpecificCard(ctx, b.cards.card);
        if (cid === null) return;
        from = findZoneOfCard(core.state, cid);
        ids = [cid];
      } else {
        from = resolveZoneInst(e, b.from);
        if (!from) return;
        ids = selectFromZone(ctx, from, b.cards);
      }
      const to = resolveZoneInst(e, b.to);
      if (!from || !to) return;
      performMove(core, from, to, ids, b.toPosition, b.faceUp, b.tag ?? null);
      return;
    }
    case 'draw': {
      // `who` sets the contextual player for owner-less perPlayer zone refs.
      let pushed = false;
      if (b.who) {
        const v = evalExpr(e, b.who);
        if (!isPlayerId(core, v)) {
          report(core, 'draw: "who" is not a player.');
          return;
        }
        ctx.frames.push({ $player: v });
        pushed = true;
      }
      try {
        const e2 = ectx(ctx);
        const count = Math.max(0, Math.floor(toNum(e2, evalExpr(e2, b.count))));
        const from = resolveZoneInst(e2, b.from);
        const to = resolveZoneInst(e2, b.to);
        const refill = b.refillFrom ? resolveZoneInst(e2, b.refillFrom) : null;
        if (!from || !to) return;
        const tag = b.tag ?? 'draw';
        for (let i = 0; i < count; i++) {
          if (from.cardIds.length === 0 && refill && refill.key !== from.key && refill.cardIds.length > 0) {
            // Inline refill: everything face-down into the source, then a
            // seeded shuffle — triggers cannot do this mid-script (events
            // drain only after the script), so the block does it itself.
            performMove(core, refill, from, [...refill.cardIds], 'top', false, null);
            shuffleInPlace(from.cardIds, core.rng);
            notify(core);
          }
          if (from.cardIds.length === 0) break; // both empty — stop early
          // Budget per drawn card: `count` is an expression and must not
          // bypass the runaway-script guard (mirrors `deal`).
          if (--core.budget < 0) throw new BudgetExceeded();
          const top = from.cardIds[from.cardIds.length - 1];
          performMove(core, from, to, [top], 'top', b.faceUp, tag);
        }
      } finally {
        if (pushed) ctx.frames.pop();
      }
      return;
    }
    case 'shuffle': {
      const inst = resolveZoneInst(e, b.zone);
      if (!inst) return;
      shuffleInPlace(inst.cardIds, core.rng);
      notify(core);
      return;
    }
    case 'deal': {
      const from = resolveZoneInst(e, b.from);
      if (!from) return;
      const toDef = core.def.zones.find((z) => z.id === b.toZoneId);
      if (!toDef || toDef.owner !== 'perPlayer') {
        report(core, 'deal: destination must be a per-player zone.');
        return;
      }
      const count = Math.max(0, Math.floor(toNum(e, evalExpr(e, b.count))));
      const n = core.state.players.length;
      outer:
      for (let round = 0; round < count; round++) {
        for (let i = 0; i < n; i++) {
          if (from.cardIds.length === 0) break outer;
          // Each dealt card costs budget — `count` comes from an expression
          // and must not bypass the runaway-script guard.
          if (--core.budget < 0) throw new BudgetExceeded();
          const p = core.state.players[(core.state.currentPlayerIdx + i) % n];
          const dest = core.state.zones[`${toDef.id}:${p.id}`];
          if (dest === from) continue; // dealing a zone into itself is a no-op
          const top = from.cardIds[from.cardIds.length - 1];
          performMove(core, from, dest, [top], 'top', null);
        }
      }
      return;
    }
    case 'setVar': {
      writeVar(ctx, b.varId, b.target, evalExpr(e, b.value));
      return;
    }
    case 'changeVar': {
      const vd = core.def.variables.find((v) => v.id === b.varId);
      if (!vd) {
        report(core, `Unknown variable "${b.varId}".`);
        return;
      }
      const slot = resolveVarSlot(ctx, vd, b.target);
      if (!slot) return;
      const next = toNum(e, slot.get()) + toNum(e, evalExpr(e, b.by));
      writeVar(ctx, b.varId, b.target, next);
      return;
    }
    case 'if': {
      if (truthy(evalExpr(e, b.cond))) await execBlocks(ctx, b.then);
      else await execBlocks(ctx, b.else);
      return;
    }
    case 'repeat': {
      const times = Math.max(0, Math.floor(toNum(e, evalExpr(e, b.times))));
      for (let i = 0; i < times; i++) {
        // Charge per iteration so an expression-sized count (or empty body)
        // cannot spin outside the budget.
        if (--core.budget < 0) throw new BudgetExceeded();
        await execBlocks(ctx, b.body);
      }
      return;
    }
    case 'forEachPlayer': {
      const n = core.state.players.length;
      for (let i = 0; i < n; i++) {
        // 'others' = each OPPONENT: skip the current player (i === 0 is current).
        if (b.scope === 'others' && i === 0) continue;
        const p = core.state.players[(core.state.currentPlayerIdx + i) % n];
        ctx.frames.push({ $player: p.id });
        try {
          await execBlocks(ctx, b.body);
        } finally {
          ctx.frames.pop();
        }
      }
      return;
    }
    case 'forEachCard': {
      const inst = resolveZoneInst(e, b.zone);
      if (!inst) return;
      // Snapshot matching ids BEFORE iterating (body may move cards around).
      const snapshot: Id[] = [];
      for (const cid of inst.cardIds) {
        if (b.filter) {
          ctx.frames.push({ $card: cid });
          const ok = truthy(evalExpr(e, b.filter));
          ctx.frames.pop();
          if (!ok) continue;
        }
        snapshot.push(cid);
      }
      for (const cid of snapshot) {
        ctx.frames.push({ $card: cid });
        try {
          await execBlocks(ctx, b.body);
        } finally {
          ctx.frames.pop();
        }
      }
      return;
    }
    case 'choose':
      await execChoose(ctx, b.who, b.choice);
      return;
    case 'chooseCards': {
      const askerId = resolveAsker(ctx, b.who);
      const candidates = filterCandidates(ctx, b.from, b.filter);
      const min = Math.min(candidates.length, Math.max(0, Math.floor(toNum(e, evalExpr(e, b.min)))));
      const max = Math.min(candidates.length, Math.max(min, Math.floor(toNum(e, evalExpr(e, b.max)))));
      if (candidates.length === 0 || max === 0) {
        if (min > 0) report(core, `Choice "${b.prompt}": no cards to choose from.`);
        return;
      }
      const req: ChoiceRequest = {
        id: ++core.choiceSeq, playerId: askerId, kind: 'cards',
        prompt: b.prompt, cardIds: candidates, min, max, revealed: b.revealed === true,
      };
      const answer = await askChoice(core, req);
      const picked = parseCardsAnswer(req, answer) ?? [];
      for (const cid of picked) {
        ctx.frames.push({ $card: cid });
        try {
          await execBlocks(ctx, b.body);
        } finally {
          ctx.frames.pop();
        }
      }
      return;
    }
    case 'discardTo': {
      const askerId = resolveAsker(ctx, b.who);
      const candidates = filterCandidates(ctx, b.from, null);
      const keep = Math.max(0, Math.floor(toNum(e, evalExpr(e, b.keep))));
      const count = Math.max(0, candidates.length - keep);
      if (count === 0) return; // already at or under the limit
      const fromInst = resolveZoneInst(e, b.from);
      const toInst = resolveZoneInst(e, b.to);
      if (!fromInst || !toInst) return;
      let picked: Id[];
      if (candidates.length <= count) {
        picked = [...candidates]; // must drop everything — no real choice
      } else {
        const req: ChoiceRequest = {
          id: ++core.choiceSeq, playerId: askerId, kind: 'cards',
          prompt: b.prompt, cardIds: candidates, min: count, max: count, revealed: false,
        };
        const answer = await askChoice(core, req);
        picked = parseCardsAnswer(req, answer) ?? [];
      }
      if (picked.length > 0) performMove(core, fromInst, toInst, picked, 'top', true, 'discard');
      return;
    }
    case 'choosePile': {
      const askerId = resolveAsker(ctx, b.who);
      const inst = resolveZoneInst(e, b.from);
      if (!inst) return;
      // Filter, then group by card identity (custom: defId, standard: name)
      // in first-appearance order (bottom→top). The representative is the
      // group's TOP copy (later index wins). Iterates inst.cardIds in array
      // order — deterministic by construction.
      const groups = new Map<string, { rep: Id; count: number }>();
      for (const cid of inst.cardIds) {
        if (b.filter) {
          ctx.frames.push({ $card: cid });
          const ok = truthy(evalExpr(e, b.filter));
          ctx.frames.pop();
          if (!ok) continue;
        }
        const card = core.state.cards[cid];
        if (!card) continue;
        const key = card.defId ?? `name:${card.name}`;
        const g = groups.get(key);
        if (g) {
          g.count += 1;
          g.rep = cid;
        } else {
          groups.set(key, { rep: cid, count: 1 });
        }
      }
      const piles = [...groups.values()];
      if (piles.length === 0) {
        if (!b.optional) report(core, `Choice "${b.prompt}": no piles to choose from.`);
        return;
      }
      const req: ChoiceRequest = {
        id: ++core.choiceSeq, playerId: askerId, kind: 'pile', prompt: b.prompt,
        cardIds: piles.map((p) => p.rep), counts: piles.map((p) => p.count), optional: b.optional,
        revealed: b.revealed === true,
      };
      const answer = await askChoice(core, req);
      if (answer === null) return; // declined (optional) — skip the body
      const picked = typeof answer === 'string' ? answer : req.cardIds[0];
      ctx.frames.push({ $card: picked });
      try {
        await execBlocks(ctx, b.body);
      } finally {
        ctx.frames.pop();
      }
      return;
    }
    case 'triggerAbilities': {
      const v = evalExpr(e, b.card);
      if (v === null) return; // e.g. a declined choice — silently no-op
      if (typeof v !== 'string' || !core.state.cards[v]) {
        report(core, `triggerAbilities: "${String(v)}" is not a card.`);
        return;
      }
      const zdef = core.def.zones.find((z) => z.id === b.zoneId);
      if (!zdef) {
        report(core, `triggerAbilities: unknown zone "${b.zoneId}".`);
        return;
      }
      // Synthetic enterZone firing WITHOUT moving the card: global triggers
      // watching the zone fire too (it IS "played again"), stacked abilities
      // still stack, and the normal drain/budget caps bound cascades.
      const holder = findZoneOfCard(core.state, v);
      const toOwner = zdef.owner === 'shared'
        ? null
        : holder && holder.zoneId === zdef.id ? holder.ownerId : contextualPlayerId(e);
      core.queue.push({
        kind: 'cardEnterZone', cardId: v,
        fromZoneId: holder?.zoneId ?? null, toZoneId: zdef.id, toOwner, tag: 'play',
      });
      return;
    }
    case 'cancelTopEffect': {
      const entry = core.pendingStack.pop();
      if (!entry) {
        report(core, 'cancelTopEffect: the stack is empty.');
        return;
      }
      syncStackView(core);
      core.state.log.push({ turn: core.state.turnNumber, text: `${entry.label} is cancelled.` });
      if (entry.sourceCardId !== null && b.cardTo !== null) {
        const card = core.state.cards[entry.sourceCardId];
        const holder = card ? findZoneOfCard(core.state, entry.sourceCardId) : null;
        const zdef = core.def.zones.find((z) => z.id === b.cardTo);
        if (holder && zdef) {
          // perPlayer destination: the cancelled card goes to ITS OWNER's
          // instance (the player who announced it), falling back contextually.
          const ownerId = zdef.owner === 'perPlayer'
            ? (entry.byPlayerId ?? contextualPlayerId(e))
            : null;
          const dest = core.state.zones[zoneInstanceKey(zdef.id, ownerId)];
          if (dest) performMove(core, holder, dest, [entry.sourceCardId], 'top', null);
        } else if (!zdef) {
          report(core, 'cancelTopEffect: destination zone no longer exists.');
        }
      }
      notify(core);
      return;
    }
    case 'announce': {
      const text = b.parts
        .map((part) => (typeof part === 'string' ? part : renderValue(core, evalExpr(e, part))))
        .join('');
      core.state.log.push({ turn: core.state.turnNumber, text });
      notify(core);
      return;
    }
    case 'flipCards': {
      let ids: Id[];
      if (b.cards.kind === 'specific') {
        const cid = resolveSpecificCard(ctx, b.cards.card);
        ids = cid === null ? [] : [cid];
      } else {
        const inst = resolveZoneInst(e, b.zone);
        if (!inst) return;
        ids = selectFromZone(ctx, inst, b.cards);
      }
      let changed = false;
      for (const cid of ids) {
        const card = core.state.cards[cid];
        if (card && card.faceUp !== b.faceUp) {
          card.faceUp = b.faceUp;
          changed = true;
        }
      }
      if (changed) notify(core);
      return;
    }
    case 'endPhase':
      core.control = 'endPhase';
      throw new StopScript();
    case 'endTurn':
      core.control = 'endTurn';
      throw new StopScript();
    case 'setNextPlayer': {
      const v = evalExpr(e, b.player);
      if (!isPlayerId(core, v)) {
        report(core, 'setNextPlayer: value is not a player.');
        return;
      }
      core.nextPlayerOverride = v;
      return;
    }
    case 'endGame': {
      // Resolve binding-dependent winner expressions NOW, while this script's
      // frames are live — finishGame runs after the unwind with no frames, so
      // a deferred `binding $player` would evaluate to null and force a draw.
      let winner = b.winner;
      if (winner.kind === 'player') {
        const v = evalExpr(e, winner.player);
        winner = { kind: 'player', player: { kind: 'str', value: typeof v === 'string' ? v : '' } };
      }
      core.endGameRequest = winner;
      throw new StopScript();
    }
  }
}
