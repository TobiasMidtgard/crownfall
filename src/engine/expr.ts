/**
 * Expression evaluator. Evaluation is side-effect free except for RNG
 * consumption by `random`; callers that must not consume game RNG
 * (legality enumeration) pass a forked RNG via `silentCtx`.
 */
import type { CardDef, CardInstance, Expr, Id, RuntimeValue, ZoneInstance, ZoneRef } from '../shared/types';
import type { Core, Frame } from './internals';
import { currentPlayer, isPlayerId, report, zoneInstanceKey, findZoneOfCard } from './internals';
import type { Rng } from './rng';

export interface EvalCtx {
  core: Core;
  frames: Frame[];
  rng: Rng;
  report: (msg: string) => void;
  /**
   * Named-filter ids currently resolving in this evaluation (filterRef cycle
   * guard). Created lazily on first filterRef; re-entering an id already in
   * the set reports a script error and yields false instead of recursing.
   */
  resolvingFilters?: Set<Id>;
}

/** Context for scripts: uses the game RNG and reports errors. */
export function scriptCtx(core: Core, frames: Frame[]): EvalCtx {
  return { core, frames, rng: core.rng, report: (m) => report(core, m) };
}

/**
 * Context for legality/read-only evaluation: `random` draws from a FORKED
 * RNG (so enumeration cannot desync determinism) and errors are swallowed
 * (a failing legality expression just means "not legal").
 */
export function silentCtx(core: Core, frames: Frame[]): EvalCtx {
  return { core, frames, rng: core.rng.fork(), report: () => {} };
}

export function truthy(v: RuntimeValue): boolean {
  return Boolean(v);
}

export function toNum(ctx: EvalCtx, v: RuntimeValue): number {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  if (Number.isNaN(n)) {
    ctx.report(`Expected a number, got "${String(v)}" — using 0.`);
    return 0;
  }
  return n;
}

/** Find a binding walking the frame stack top-down. Distinguishes unset from null. */
export function lookupBinding(frames: Frame[], name: string): { found: boolean; value: RuntimeValue } {
  for (let i = frames.length - 1; i >= 0; i--) {
    if (name in frames[i]) return { found: true, value: frames[i][name] };
  }
  return { found: false, value: null };
}

/** Contextual player: $player binding if set to a player id, else the current player. */
export function contextualPlayerId(ctx: EvalCtx): Id {
  const b = lookupBinding(ctx.frames, '$player');
  if (b.found && isPlayerId(ctx.core, b.value)) return b.value;
  return currentPlayer(ctx.core).id;
}

/** Resolve a ZoneRef to a live zone instance (null + report on bad refs). */
export function resolveZoneInst(ctx: EvalCtx, ref: ZoneRef): ZoneInstance | null {
  const zdef = ctx.core.def.zones.find((z) => z.id === ref.zoneId);
  if (!zdef) {
    ctx.report(`Unknown zone "${ref.zoneId}".`);
    return null;
  }
  if (zdef.owner === 'shared') return ctx.core.state.zones[zoneInstanceKey(zdef.id, null)] ?? null;
  let pid: Id;
  if (ref.owner) {
    const v = evalExpr(ctx, ref.owner);
    if (!isPlayerId(ctx.core, v)) {
      ctx.report(`Zone "${zdef.name}" owner did not resolve to a player.`);
      return null;
    }
    pid = v;
  } else {
    pid = contextualPlayerId(ctx);
  }
  return ctx.core.state.zones[zoneInstanceKey(zdef.id, pid)] ?? null;
}

function asCard(ctx: EvalCtx, v: RuntimeValue): CardInstance | null {
  if (v === null) return null;
  if (typeof v === 'string') {
    const card = ctx.core.state.cards[v];
    if (card) return card;
  }
  ctx.report(`Value "${String(v)}" is not a card.`);
  return null;
}

/** Card to use for perCard var access when target is null: $card, then $self. */
export function contextualCardId(ctx: EvalCtx): Id | null {
  for (const name of ['$card', '$self']) {
    const b = lookupBinding(ctx.frames, name);
    if (b.found && typeof b.value === 'string' && ctx.core.state.cards[b.value]) return b.value;
  }
  return null;
}

function getVarValue(ctx: EvalCtx, varId: Id, target: Expr | null): RuntimeValue {
  const vd = ctx.core.def.variables.find((v) => v.id === varId);
  if (!vd) {
    ctx.report(`Unknown variable "${varId}".`);
    return null;
  }
  if (vd.scope === 'global') return ctx.core.state.globalVars[vd.id] ?? null;
  if (vd.scope === 'perPlayer') {
    const pid = target ? evalExpr(ctx, target) : contextualPlayerId(ctx);
    if (!isPlayerId(ctx.core, pid)) {
      ctx.report(`Variable "${vd.name}" target is not a player.`);
      return null;
    }
    const p = ctx.core.state.players.find((pl) => pl.id === pid)!;
    return p.vars[vd.id] ?? null;
  }
  // perCard
  const cid = target ? evalExpr(ctx, target) : contextualCardId(ctx);
  if (typeof cid !== 'string' || !ctx.core.state.cards[cid]) {
    ctx.report(`Variable "${vd.name}" needs a card (no $card/$self bound).`);
    return null;
  }
  return ctx.core.state.cards[cid].vars[vd.id] ?? null;
}

export function evalExpr(ctx: EvalCtx, e: Expr): RuntimeValue {
  switch (e.kind) {
    case 'num': return e.value;
    case 'str': return e.value;
    case 'bool': return e.value;
    case 'getVar': return getVarValue(ctx, e.varId, e.target);
    case 'zoneCount': {
      const inst = resolveZoneInst(ctx, e.zone);
      return inst ? inst.cardIds.length : 0;
    }
    case 'cardField': {
      const v = evalExpr(ctx, e.card);
      if (v === null) return null;
      const card = asCard(ctx, v);
      if (!card) return null;
      const f = card.fields[e.fieldId];
      return f === undefined ? null : f;
    }
    case 'topCard': {
      const inst = resolveZoneInst(ctx, e.zone);
      if (!inst || inst.cardIds.length === 0) return null;
      return inst.cardIds[inst.cardIds.length - 1];
    }
    case 'binding': {
      const b = lookupBinding(ctx.frames, e.name);
      if (!b.found) {
        ctx.report(`Binding "${e.name}" is not set here.`);
        return null;
      }
      return b.value;
    }
    case 'currentPlayer': return currentPlayer(ctx.core).id;
    case 'playerCount': return ctx.core.state.players.length;
    case 'turnNumber': return ctx.core.state.turnNumber;
    case 'nextPlayer': {
      const v = evalExpr(ctx, e.from);
      const idx = ctx.core.state.players.findIndex((p) => p.id === v);
      if (idx < 0) {
        ctx.report('nextPlayer: value is not a player.');
        return null;
      }
      return ctx.core.state.players[(idx + 1) % ctx.core.state.players.length].id;
    }
    case 'cardOwner': {
      const card = asCard(ctx, evalExpr(ctx, e.card));
      if (!card) return null;
      const inst = findZoneOfCard(ctx.core.state, card.instanceId);
      return inst ? inst.ownerId : null;
    }
    case 'cardZoneId': {
      const card = asCard(ctx, evalExpr(ctx, e.card));
      if (!card) return null;
      const inst = findZoneOfCard(ctx.core.state, card.instanceId);
      return inst ? inst.zoneId : null;
    }
    case 'math': {
      const l = toNum(ctx, evalExpr(ctx, e.left));
      const r = toNum(ctx, evalExpr(ctx, e.right));
      switch (e.op) {
        case '+': return l + r;
        case '-': return l - r;
        case '*': return l * r;
        case '/':
          if (r === 0) { ctx.report('Division by zero — using 0.'); return 0; }
          return l / r;
        case '%':
          if (r === 0) { ctx.report('Modulo by zero — using 0.'); return 0; }
          return l % r;
      }
      return 0;
    }
    case 'compare': {
      if (e.op === '==' || e.op === '!=') {
        const l = evalExpr(ctx, e.left);
        const r = evalExpr(ctx, e.right);
        return e.op === '==' ? l === r : l !== r;
      }
      if (e.op === 'contains') {
        // Whole-word membership: right appears as a whitespace-separated
        // word inside left ("action attack" contains "action", not "act").
        const l = evalExpr(ctx, e.left);
        const r = evalExpr(ctx, e.right);
        if (l === null || r === null) return false;
        return String(l).trim().split(/\s+/).includes(String(r));
      }
      const l = toNum(ctx, evalExpr(ctx, e.left));
      const r = toNum(ctx, evalExpr(ctx, e.right));
      switch (e.op) {
        case '<': return l < r;
        case '<=': return l <= r;
        case '>': return l > r;
        case '>=': return l >= r;
      }
      return false;
    }
    case 'logic': {
      const l = truthy(evalExpr(ctx, e.left));
      // Short-circuit: the right side only evaluates when it can matter.
      if (e.op === 'and') return l ? truthy(evalExpr(ctx, e.right)) : false;
      return l ? true : truthy(evalExpr(ctx, e.right));
    }
    case 'not': return !truthy(evalExpr(ctx, e.expr));
    case 'bestCard': {
      const inst = resolveZoneInst(ctx, e.zone);
      if (!inst) return null;
      let bestId: Id | null = null;
      let bestVal = 0;
      for (const cid of inst.cardIds) {
        if (e.filter) {
          ctx.frames.push({ $card: cid });
          const ok = truthy(evalExpr(ctx, e.filter));
          ctx.frames.pop();
          if (!ok) continue;
        }
        const card = ctx.core.state.cards[cid];
        const val = Number(card?.fields[e.fieldId]);
        if (Number.isNaN(val)) continue;
        // >= / <= so ties resolve to the card nearest the TOP (later index).
        if (bestId === null || (e.by === 'highest' ? val >= bestVal : val <= bestVal)) {
          bestId = cid;
          bestVal = val;
        }
      }
      return bestId;
    }
    case 'countCards': {
      const inst = resolveZoneInst(ctx, e.zone);
      if (!inst) return 0;
      if (!e.filter) return inst.cardIds.length;
      let n = 0;
      for (const cid of inst.cardIds) {
        ctx.frames.push({ $card: cid });
        if (truthy(evalExpr(ctx, e.filter))) n++;
        ctx.frames.pop();
      }
      return n;
    }
    case 'sumCards': {
      const inst = resolveZoneInst(ctx, e.zone);
      if (!inst) return 0;
      let sum = 0;
      for (const cid of inst.cardIds) {
        if (e.filter) {
          ctx.frames.push({ $card: cid });
          const ok = truthy(evalExpr(ctx, e.filter));
          ctx.frames.pop();
          if (!ok) continue;
        }
        const card = ctx.core.state.cards[cid];
        const val = Number(card?.fields[e.fieldId]);
        if (!Number.isNaN(val)) sum += val; // non-numeric values count 0
      }
      return sum;
    }
    case 'random': {
      const max = Math.floor(toNum(ctx, evalExpr(ctx, e.max)));
      if (max < 1) {
        ctx.report('random: max must be at least 1 — using 0.');
        return 0;
      }
      return ctx.rng.int(max);
    }
    case 'stackSize':
      return ctx.core.pendingStack.length;
    case 'stackTopCard': {
      const top = ctx.core.pendingStack[ctx.core.pendingStack.length - 1];
      return top?.sourceCardId ?? null;
    }
    case 'phaseIndex':
      return ctx.core.state.phaseIdx;
    case 'phasePos':
      return ctx.core.def.phases.findIndex((p) => p.id === e.phaseId);
    case 'phaseIs': {
      const pos = ctx.core.def.phases.findIndex((p) => p.id === e.phaseId);
      return pos >= 0 && pos === ctx.core.state.phaseIdx;
    }
    case 'cardTypeIs': {
      const cdef = resolveCardDef(ctx, e.card);
      // Untyped cards (and standard52 cards, which have no def) never match.
      return (cdef?.typeId ?? null) === e.typeId;
    }
    case 'cardHasTag': {
      const cdef = resolveCardDef(ctx, e.card);
      return (cdef?.tags ?? []).includes(e.tagId);
    }
    case 'filterRef': {
      const filter = (ctx.core.def.filters ?? []).find((f) => f.id === e.filterId);
      if (!filter) {
        ctx.report(`Unknown filter "${e.filterId}" — treating it as false.`);
        return false;
      }
      const resolving = (ctx.resolvingFilters ??= new Set());
      if (resolving.has(e.filterId)) {
        ctx.report(`Filter "${filter.name}" is defined in terms of itself — treating it as false.`);
        return false;
      }
      const card = evalExpr(ctx, e.card);
      resolving.add(e.filterId);
      ctx.frames.push({ $card: card });
      try {
        return truthy(evalExpr(ctx, filter.condition));
      } finally {
        ctx.frames.pop();
        resolving.delete(e.filterId);
      }
    }
  }
}

/** CardDef behind a card expression (null for missing / standard52 / untracked cards). */
function resolveCardDef(ctx: EvalCtx, cardExpr: Expr): CardDef | null {
  const v = evalExpr(ctx, cardExpr);
  if (v === null) return null;
  const card = asCard(ctx, v);
  if (!card || card.defId === null) return null;
  return ctx.core.def.cards.find((c) => c.id === card.defId) ?? null;
}
