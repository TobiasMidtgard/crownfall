/**
 * Tiny typed constructors for the block language, used by the example game
 * definitions. Pure sugar: every helper returns exactly one literal node from
 * src/shared/types, so the resulting GameDefs are plain JSON documents.
 */
import type {
  ActionDef, ActionTarget, Block, CardSelector, CompareOp, Expr, Id, MathOp, ZoneRef,
} from '../shared/types';

// --- expressions -------------------------------------------------------------

export const num = (value: number): Expr => ({ kind: 'num', value });
export const str = (value: string): Expr => ({ kind: 'str', value });
export const bnd = (name: string): Expr => ({ kind: 'binding', name });

export const CURRENT: Expr = { kind: 'currentPlayer' };
export const PLAYER_COUNT: Expr = { kind: 'playerCount' };
export const TURN_NUMBER: Expr = { kind: 'turnNumber' };
/** Number of pending (unresolved) effects on the stack. */
export const STACK_SIZE: Expr = { kind: 'stackSize' };
/** Source card of the top pending stack entry (null when empty/cardless). */
export const STACK_TOP: Expr = { kind: 'stackTopCard' };

export const cardOwner = (card: Expr): Expr => ({ kind: 'cardOwner', card });
export const cardZoneId = (card: Expr): Expr => ({ kind: 'cardZoneId', card });

export const zone = (zoneId: Id, owner: Expr | null = null): ZoneRef => ({ zoneId, owner });
export const zoneCount = (z: ZoneRef): Expr => ({ kind: 'zoneCount', zone: z });
export const topCard = (z: ZoneRef): Expr => ({ kind: 'topCard', zone: z });
export const field = (card: Expr, fieldId: Id): Expr => ({ kind: 'cardField', card, fieldId });
export const getVar = (varId: Id, target: Expr | null = null): Expr => ({ kind: 'getVar', varId, target });
export const nextPlayer = (from: Expr): Expr => ({ kind: 'nextPlayer', from });

const cmp = (op: CompareOp, left: Expr, right: Expr): Expr => ({ kind: 'compare', op, left, right });
export const eq = (l: Expr, r: Expr): Expr => cmp('==', l, r);
export const neq = (l: Expr, r: Expr): Expr => cmp('!=', l, r);
export const gt = (l: Expr, r: Expr): Expr => cmp('>', l, r);
export const gte = (l: Expr, r: Expr): Expr => cmp('>=', l, r);
export const lt = (l: Expr, r: Expr): Expr => cmp('<', l, r);
export const lte = (l: Expr, r: Expr): Expr => cmp('<=', l, r);

const math = (op: MathOp, left: Expr, right: Expr): Expr => ({ kind: 'math', op, left, right });
export const add = (l: Expr, r: Expr): Expr => math('+', l, r);
export const sub = (l: Expr, r: Expr): Expr => math('-', l, r);
export const mul = (l: Expr, r: Expr): Expr => math('*', l, r);
/** Numeric negation, e.g. for "deal N damage" changeVar deltas. */
export const neg = (e: Expr): Expr => sub(num(0), e);

export const and = (left: Expr, right: Expr): Expr => ({ kind: 'logic', op: 'and', left, right });
export const or = (left: Expr, right: Expr): Expr => ({ kind: 'logic', op: 'or', left, right });
export const not = (expr: Expr): Expr => ({ kind: 'not', expr });
/** Left-folded OR over 2+ alternatives. */
export const anyOf = (first: Expr, ...rest: Expr[]): Expr => rest.reduce((acc, e) => or(acc, e), first);
/** Left-folded AND over 2+ requirements. */
export const allOf = (first: Expr, ...rest: Expr[]): Expr => rest.reduce((acc, e) => and(acc, e), first);

export const bestCard = (z: ZoneRef, by: 'highest' | 'lowest', fieldId: Id, filter: Expr | null = null): Expr =>
  ({ kind: 'bestCard', zone: z, by, fieldId, filter });
export const countCards = (z: ZoneRef, filter: Expr | null = null): Expr =>
  ({ kind: 'countCards', zone: z, filter });

// --- card selectors ----------------------------------------------------------

export const topN = (n: number): CardSelector => ({ kind: 'top', count: num(n) });
export const bottomN = (n: number): CardSelector => ({ kind: 'bottom', count: num(n) });
export const ALL: CardSelector = { kind: 'all' };
export const specific = (card: Expr): CardSelector => ({ kind: 'specific', card });
/** Every card matching a filter ($card bound per candidate). */
export const matching = (filter: Expr): CardSelector => ({ kind: 'filter', filter });

// --- blocks ------------------------------------------------------------------

export const move = (
  cards: CardSelector,
  from: ZoneRef,
  to: ZoneRef,
  opts: { toPosition?: 'top' | 'bottom'; faceUp?: boolean | null } = {},
): Block => ({ kind: 'moveCards', from, to, cards, toPosition: opts.toPosition ?? 'top', faceUp: opts.faceUp ?? null });

export const shuffle = (z: ZoneRef): Block => ({ kind: 'shuffle', zone: z });
export const deal = (from: ZoneRef, toZoneId: Id, count: number): Block =>
  ({ kind: 'deal', from, toZoneId, count: num(count) });

export const setVar = (varId: Id, value: Expr, target: Expr | null = null): Block =>
  ({ kind: 'setVar', varId, target, value });
export const changeVar = (varId: Id, by: Expr, target: Expr | null = null): Block =>
  ({ kind: 'changeVar', varId, target, by });

export const iff = (cond: Expr, then: Block[], otherwise: Block[] = []): Block =>
  ({ kind: 'if', cond, then, else: otherwise });
export const repeat = (times: Expr, body: Block[]): Block => ({ kind: 'repeat', times, body });
export const forEachPlayer = (body: Block[]): Block => ({ kind: 'forEachPlayer', body });
export const forEachCard = (z: ZoneRef, filter: Expr | null, body: Block[]): Block =>
  ({ kind: 'forEachCard', zone: z, filter, body });

export const chooseOption = (
  prompt: string,
  options: { id: string; label: string }[],
  who: Expr | null = null,
): Block => ({ kind: 'choose', who, choice: { kind: 'option', prompt, options } });

/** Single-card choice; $choice = the picked card (or null when declined/empty). */
export const chooseCard = (opts: {
  who?: Expr | null;
  from: ZoneRef;
  filter?: Expr | null;
  prompt: string;
  optional?: boolean;
  revealed?: boolean;
}): Block => ({
  kind: 'choose',
  who: opts.who ?? null,
  choice: {
    kind: 'card', from: opts.from, filter: opts.filter ?? null, prompt: opts.prompt,
    optional: opts.optional ?? false, ...(opts.revealed ? { revealed: true } : {}),
  },
});

/** Multi-select: `who` picks min..max cards, then body runs per pick with $card bound. */
export const chooseCardsBlock = (opts: {
  who?: Expr | null;
  from: ZoneRef;
  filter?: Expr | null;
  min: Expr;
  max: Expr;
  prompt: string;
  revealed?: boolean;
  body: Block[];
}): Block => ({
  kind: 'chooseCards',
  who: opts.who ?? null,
  from: opts.from,
  filter: opts.filter ?? null,
  min: opts.min,
  max: opts.max,
  prompt: opts.prompt,
  revealed: opts.revealed ?? false,
  body: opts.body,
});

/** Counter/negate the top pending effect; its source card moves to `cardTo` (null = stays). */
export const cancelTop = (cardTo: Id | null): Block => ({ kind: 'cancelTopEffect', cardTo });

export const flip = (z: ZoneRef, cards: CardSelector, faceUp: boolean): Block =>
  ({ kind: 'flipCards', zone: z, cards, faceUp });

export const announce = (...parts: (string | Expr)[]): Block => ({ kind: 'announce', parts });
export const setNextPlayer = (player: Expr): Block => ({ kind: 'setNextPlayer', player });
export const endGamePlayer = (player: Expr): Block =>
  ({ kind: 'endGame', winner: { kind: 'player', player } });

export const END_PHASE: Block = { kind: 'endPhase' };
export const END_TURN: Block = { kind: 'endTurn' };

// --- action definitions --------------------------------------------------------

/**
 * An action that resolves via the stack: `announce` runs immediately when the
 * action is taken (pay costs, move the card), `resolve` is pushed as a pending
 * effect and runs once every player has passed in the response window.
 */
export const stackedAction = (a: {
  id: Id;
  name: string;
  target: ActionTarget;
  legality?: Expr | null;
  announce: Block[];
  resolve: Block[];
  speed?: 'normal' | 'response';
}): ActionDef => ({
  id: a.id,
  name: a.name,
  target: a.target,
  legality: a.legality ?? null,
  script: a.resolve,
  announce: a.announce,
  stacked: true,
  ...(a.speed ? { speed: a.speed } : {}),
});
