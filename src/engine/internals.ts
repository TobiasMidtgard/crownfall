/**
 * Internal engine plumbing shared by all engine modules: the mutable core,
 * the event queue payloads, binding frames, control-flow sentinels, budgets.
 */
import type {
  EngineOptions, GameDef, GameState, Id, PlayerState, RuntimeValue, WinnerSpec, ZoneInstance,
} from '../shared/types';
import type { Rng } from './rng';

/** One binding frame ($card, $player, $choice, ...). Frames stack; lookup walks top-down. */
export type Frame = Record<string, RuntimeValue>;

export type EngineEvent =
  | { kind: 'turnStart' | 'turnEnd'; playerId: Id }
  | { kind: 'phaseStart' | 'phaseEnd'; phaseId: Id; playerId: Id }
  | { kind: 'cardEnterZone'; cardId: Id; fromZoneId: Id | null; toZoneId: Id; toOwner: Id | null }
  | { kind: 'cardLeaveZone'; cardId: Id; fromZoneId: Id; toZoneId: Id | null; fromOwner: Id | null }
  | { kind: 'zoneEmptied'; zoneId: Id; owner: Id | null }
  | { kind: 'varChanged'; varId: Id; playerId: Id | null; cardId: Id | null };

/** Max block executions per settle (action / setup / transition). */
export const BLOCK_BUDGET = 10_000;
/** Max event-drain cascade rounds per settle. */
export const DRAIN_ROUNDS = 50;
/** Max pending stack entries; pushes beyond report + drop. */
export const STACK_CAP = 100;

/** Engine-internal pending effect (state.stack mirrors the public fields). */
export interface StackEntry {
  id: number;
  label: string;
  sourceCardId: Id | null;
  byPlayerId: Id | null;
  script: import('../shared/types').Block[];
  /** Binding frames captured at push time. */
  snapshot: Frame[];
}

export interface Core {
  def: GameDef;
  state: GameState;
  opts: EngineOptions;
  rng: Rng;
  queue: EngineEvent[];
  /** Remaining block executions in the current settle. */
  budget: number;
  budgetReported: boolean;
  control: 'none' | 'endPhase' | 'endTurn';
  endGameRequest: WinnerSpec | null;
  nextPlayerOverride: Id | null;
  pendingChoice: boolean;
  started: boolean;
  busy: boolean;
  finished: boolean;
  choiceSeq: number;
  instanceSeq: number;
  /**
   * True when any script in the def reads `turnNumber`. Such games may
   * legitimately idle through many no-move turns waiting for a turn-count
   * gate, so the stalemate fast-path is disabled for them (the transition
   * cap still applies).
   */
  usesTurnNumber: boolean;
  /** Pending effects (top = last). state.stack mirrors the public fields. */
  pendingStack: StackEntry[];
  stackSeq: number;
  /** Normal-play bookkeeping to resume once the stack empties. */
  afterStack: AfterStack;
}

/** What resumes after the last stack entry resolves and the window closes. */
export type AfterStack = 'none' | 'advancePhase' | 'endTurn' | 'enterPhase';

/** Keep the public state.stack mirror in sync with the internal stack. */
export function syncStackView(core: Core): void {
  core.state.stack = core.pendingStack.map((s) => ({
    id: s.id, label: s.label, sourceCardId: s.sourceCardId, byPlayerId: s.byPlayerId,
  }));
}

/** Push a pending effect (stacked action resolution / stacked trigger). */
export function pushStackEntry(
  core: Core,
  entry: Omit<StackEntry, 'id' | 'snapshot'> & { snapshot: Frame[] },
): void {
  if (core.pendingStack.length >= STACK_CAP) {
    report(core, `Stack is full (${STACK_CAP} pending effects) — "${entry.label}" dropped.`);
    return;
  }
  core.pendingStack.push({
    ...entry,
    id: ++core.stackSeq,
    snapshot: structuredClone(entry.snapshot),
  });
  syncStackView(core);
  core.state.log.push({ turn: core.state.turnNumber, text: `${entry.label} goes on the stack.` });
  notify(core);
}

/** Thrown by endPhase/endTurn/endGame to unwind the current script like a return. */
export class StopScript extends Error {
  constructor() { super('stop'); }
}

/** Thrown when the per-settle block budget runs out. */
export class BudgetExceeded extends Error {
  constructor() { super('budget exceeded'); }
}

export function report(core: Core, msg: string): void {
  core.opts.onScriptError?.(msg);
}

/** Deliver a deep-cloned snapshot after a visible mutation. */
export function notify(core: Core): void {
  core.opts.onUpdate(structuredClone(core.state));
}

export function resetBudget(core: Core): void {
  core.budget = BLOCK_BUDGET;
  core.budgetReported = false;
}

/** Read-and-reset the endPhase/endTurn control flag. */
export function consumeControl(core: Core): Core['control'] {
  const ctl = core.control;
  core.control = 'none';
  return ctl;
}

export function currentPlayer(core: Core): PlayerState {
  return core.state.players[core.state.currentPlayerIdx];
}

export function isPlayerId(core: Core, v: RuntimeValue): v is Id {
  return typeof v === 'string' && core.state.players.some((p) => p.id === v);
}

export function zoneInstanceKey(zoneId: Id, ownerId: Id | null): string {
  return ownerId === null ? zoneId : `${zoneId}:${ownerId}`;
}

/** Zone instance currently holding the card (cards are always in exactly one zone). */
export function findZoneOfCard(state: GameState, cardId: Id): ZoneInstance | null {
  for (const key of Object.keys(state.zones)) {
    const inst = state.zones[key];
    if (inst.cardIds.includes(cardId)) return inst;
  }
  return null;
}
