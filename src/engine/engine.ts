/**
 * Engine orchestration: state init, the turn/phase machine, performAction,
 * end-condition checks, and the public EngineHandle.
 */
import type {
  EngineHandle, EngineOptions, GameDef, GameState, Id, Move, WinnerSpec,
} from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import type { Core, Frame } from './internals';
import {
  consumeControl, currentPlayer, isPlayerId, notify, pushStackEntry, report, resetBudget,
  syncStackView, zoneInstanceKey, BLOCK_BUDGET,
} from './internals';
import { createRng } from './rng';
import { spawnDecks } from './spawn';
import { runScript } from './exec';
import { drainEvents } from './events';
import { enumerateMoves, enumerateResponseMoves } from './legality';
import { evalExpr, scriptCtx, truthy } from './expr';

/** Safety net: max phase transitions per proceed() so a fully-deadlocked
 *  game (every phase auto-skipped, no end condition) cannot hang the app. */
const MAX_TRANSITIONS = 1000;

function initialState(def: GameDef, opts: EngineOptions): GameState {
  const players = opts.playerNames.map((name, i) => {
    const vars: Record<Id, GameState['globalVars'][string]> = {};
    for (const v of def.variables) if (v.scope === 'perPlayer') vars[v.id] = v.initial;
    return { id: `p${i}`, name, isAI: Boolean(opts.aiSeats[i]), vars };
  });
  const globalVars: GameState['globalVars'] = {};
  for (const v of def.variables) if (v.scope === 'global') globalVars[v.id] = v.initial;
  const zones: GameState['zones'] = {};
  for (const z of def.zones) {
    if (z.owner === 'shared') {
      const key = zoneInstanceKey(z.id, null);
      zones[key] = { key, zoneId: z.id, ownerId: null, cardIds: [] };
    } else {
      for (const p of players) {
        const key = zoneInstanceKey(z.id, p.id);
        zones[key] = { key, zoneId: z.id, ownerId: p.id, cardIds: [] };
      }
    }
  }
  return {
    seed: opts.seed,
    players,
    globalVars,
    zones,
    cards: {},
    currentPlayerIdx: 0,
    phaseIdx: 0,
    turnNumber: 1,
    moveTags: {},
    log: [],
    result: null,
    stack: [],
    window: null,
  };
}

function finishGame(core: Core, spec: WinnerSpec): void {
  if (core.finished) return;
  let winners: Id[] = [];
  switch (spec.kind) {
    case 'player': {
      const v = evalExpr(scriptCtx(core, [{}]), spec.player);
      if (isPlayerId(core, v)) winners = [v];
      else report(core, 'endGame: winner expression is not a player — declaring a draw.');
      break;
    }
    case 'highestVar':
    case 'lowestVar': {
      const vd = core.def.variables.find((v) => v.id === spec.varId);
      if (!vd || vd.scope !== 'perPlayer' || vd.type !== 'number') {
        report(core, 'endGame: winner-by-variable needs a per-player number variable — declaring a draw.');
        break;
      }
      const values = core.state.players.map((p) => {
        const n = Number(p.vars[spec.varId] ?? 0);
        return Number.isNaN(n) ? 0 : n;
      });
      const best = spec.kind === 'highestVar' ? Math.max(...values) : Math.min(...values);
      winners = core.state.players.filter((_, i) => values[i] === best).map((p) => p.id);
      break;
    }
    case 'draw':
      break;
  }
  const names = winners.map((id) => core.state.players.find((p) => p.id === id)!.name);
  const text = names.length === 0
    ? "It's a draw."
    : `${names.join(' and ')} win${names.length === 1 ? 's' : ''}!`;
  core.finished = true;
  // The game is over: pending effects never resolve, windows close.
  core.pendingStack = [];
  syncStackView(core);
  core.state.window = null;
  core.state.result = { winners, text };
  core.state.log.push({ turn: core.state.turnNumber, text });
  notify(core);
}

function checkEndConditions(core: Core): void {
  if (core.finished) return;
  for (const ec of core.def.endConditions) {
    if (truthy(evalExpr(scriptCtx(core, [{}]), ec.condition))) {
      finishGame(core, ec.winner);
      return;
    }
  }
}

/** Drain events, then resolve endGame requests / end conditions. */
async function settle(core: Core): Promise<void> {
  await drainEvents(core);
  if (core.endGameRequest) {
    const spec = core.endGameRequest;
    core.endGameRequest = null;
    finishGame(core, spec);
    return;
  }
  checkEndConditions(core);
}

/**
 * Leave the current phase: fire phaseEnd, then either step to the next phase
 * or (on the last phase / explicit endTurn) run the turn transition.
 */
async function advance(core: Core, toTurn: boolean): Promise<void> {
  const state = core.state;
  const phase = core.def.phases[state.phaseIdx];
  if (phase) {
    core.queue.push({ kind: 'phaseEnd', phaseId: phase.id, playerId: currentPlayer(core).id });
    await settle(core);
    if (core.finished) return;
    // A phaseEnd trigger may itself issue endTurn — honor it by escalating
    // this advance to a turn transition (endPhase is already in progress).
    if (consumeControl(core) === 'endTurn') toTurn = true;
  }
  if (toTurn || state.phaseIdx >= core.def.phases.length - 1) {
    core.queue.push({ kind: 'turnEnd', playerId: currentPlayer(core).id });
    await settle(core);
    if (core.finished) return;
    if (consumeControl(core) !== 'none') {
      report(core, 'endPhase/endTurn inside a turn-end rule is ignored — the turn is already ending.');
    }
    const n = state.players.length;
    let nextIdx = (state.currentPlayerIdx + 1) % n;
    if (core.nextPlayerOverride !== null) {
      const i = state.players.findIndex((p) => p.id === core.nextPlayerOverride);
      if (i >= 0) nextIdx = i;
      else report(core, 'setNextPlayer: stored player no longer exists.');
      core.nextPlayerOverride = null; // consumed
    }
    state.currentPlayerIdx = nextIdx;
    state.turnNumber++;
    state.phaseIdx = 0;
    notify(core);
    core.queue.push({ kind: 'turnStart', playerId: currentPlayer(core).id });
  } else {
    state.phaseIdx++;
    notify(core);
  }
}

/**
 * Fingerprint of everything that can influence the game's future: variables,
 * zone contents, card facing/vars, position in the turn cycle, the pending
 * stack, and the RNG cursor (via a fork, so nothing is consumed). turnNumber
 * and the log are deliberately excluded — see the stalemate check in proceed().
 */
function futureHash(core: Core): string {
  const s = core.state;
  return JSON.stringify([
    core.rng.fork().next(),
    s.globalVars,
    s.players.map((p) => p.vars),
    Object.values(s.zones).map((z) => [z.key, z.cardIds]),
    Object.values(s.cards).map((c) => [c.faceUp, c.vars]),
    s.currentPlayerIdx,
    s.phaseIdx,
    core.pendingStack.length,
  ]);
}

// ---------------------------------------------------------------------------
// Stack & priority windows (see docs/engine-semantics.md "Stack & priority")
// ---------------------------------------------------------------------------

/** Open a response window (priority to the turn player) if anything is pending. */
function maybeOpenWindow(core: Core): boolean {
  if (core.finished || core.state.window !== null || core.pendingStack.length === 0) return false;
  core.state.window = { holderId: currentPlayer(core).id, passes: 0 };
  notify(core);
  return true;
}

/** Resolve the top pending entry; returns when it (and its triggers) settled. */
async function resolveTop(core: Core): Promise<void> {
  const entry = core.pendingStack.pop();
  syncStackView(core);
  if (!entry) return;
  core.state.window = null;
  core.state.log.push({ turn: core.state.turnNumber, text: `${entry.label} resolves.` });
  notify(core);
  resetBudget(core);
  core.control = 'none';
  await runScript(core, entry.script, entry.snapshot);
  await settle(core);
  if (core.finished) return;
  // Stack lifecycle: effectResolved fires AFTER the entry's script settles
  // and BEFORE the caller's window-reopen decision. The entry is already
  // popped — a cancelTopEffect in a listener targets the NEXT entry.
  core.queue.push({
    kind: 'effectResolved', label: entry.label,
    sourceCardId: entry.sourceCardId, byPlayerId: entry.byPlayerId,
  });
  await settle(core);
}

/**
 * After a window closes with an empty stack, resume the interrupted
 * normal-play bookkeeping.
 */
async function resumeAfterStack(core: Core): Promise<void> {
  const after = core.afterStack;
  core.afterStack = 'none';
  if (core.finished) return;
  if (after === 'endTurn' || after === 'advancePhase') {
    await advance(core, after === 'endTurn');
    if (core.finished) return;
    if (maybeOpenWindow(core)) {
      // Triggers during the transition stacked more work; the new phase's
      // entry runs once that resolves.
      core.afterStack = 'enterPhase';
      return;
    }
    await proceed(core, true);
  } else if (after === 'enterPhase') {
    await proceed(core, true);
  } else {
    await proceed(core, false);
  }
}

/**
 * One pass of priority. When everyone has passed consecutively, resolve the
 * top entry, then either reopen the window (stack non-empty) or resume play.
 */
async function passPriority(core: Core): Promise<void> {
  const win = core.state.window;
  if (!win) return;
  win.passes += 1;
  const n = core.state.players.length;
  if (win.passes < n) {
    const idx = core.state.players.findIndex((p) => p.id === win.holderId);
    win.holderId = core.state.players[(idx + 1) % n].id;
    notify(core);
    return;
  }
  await resolveTop(core);
  if (core.finished) return;
  // Resolution scripts may defer phase control until the stack empties.
  const ctl = consumeControl(core);
  if (ctl === 'endTurn') core.afterStack = 'endTurn';
  else if (ctl === 'endPhase') core.afterStack = 'advancePhase';
  if (core.pendingStack.length > 0) {
    core.state.window = { holderId: currentPlayer(core).id, passes: 0 };
    notify(core);
    return;
  }
  core.state.window = null;
  notify(core);
  await resumeAfterStack(core);
}

/**
 * Auto-pass while the priority holder has no response moves: a player who
 * cannot possibly respond is never prompted — their pass is implied. Only
 * players actually holding a live response (a Reaction, an instant, a trap)
 * ever see the window. Without this, the player who just played an attack
 * got a lone Pass prompt on their own effect, which read as "cancel".
 * Bounded like proceed(): a trigger loop that kept restacking forever would
 * otherwise spin here instead of at a human's Pass button.
 */
async function autoPassMoveless(core: Core): Promise<void> {
  let steps = 0;
  while (!core.finished && core.state.window) {
    if (enumerateResponseMoves(core, core.state.window.holderId).length > 0) return;
    if (++steps > MAX_TRANSITIONS) {
      report(core, `Stopped after ${MAX_TRANSITIONS} automatic passes without player input (possible trigger loop).`);
      return;
    }
    await passPriority(core);
  }
}

/**
 * Run the phase machine until the engine waits for player input or the game
 * ends. `entering = true` runs the current phase's entry (phaseStart +
 * onEnter); `false` resumes mid-phase (deadlock check only).
 */
async function proceed(core: Core, entering: boolean): Promise<void> {
  let transitions = 0;
  // Stalemate detection: if a full rotation of players × phases passes with
  // zero legal moves at every stop AND the future-relevant state is identical
  // to the previous rotation, the game provably can never progress (the
  // engine is deterministic) — end it as a draw instead of spinning to the
  // transition cap. Games reading turnNumber are exempt (their future can
  // depend on the excluded counter).
  let skipStreak = 0;
  let rotationHash: string | null = null;
  const rotation = Math.max(1, core.state.players.length * core.def.phases.length);
  while (!core.finished) {
    const phase = core.def.phases[core.state.phaseIdx];
    if (!phase) {
      report(core, 'The game has no phases — nothing to play.');
      return;
    }
    if (++transitions > MAX_TRANSITIONS) {
      report(core, `Stopped after ${MAX_TRANSITIONS} phase transitions without player input (possible infinite loop).`);
      return;
    }
    if (entering) {
      resetBudget(core);
      core.control = 'none';
      core.queue.push({ kind: 'phaseStart', phaseId: phase.id, playerId: currentPlayer(core).id });
      await runScript(core, phase.onEnter, [{}]);
      await settle(core);
      if (core.finished) return;
      // Stacked triggers during phase entry open a response window; normal
      // play resumes here (mid-phase) once the stack empties.
      if (maybeOpenWindow(core)) {
        core.afterStack = 'none';
        return;
      }
      const ctl = consumeControl(core);
      if (ctl === 'endTurn') {
        await advance(core, true);
        continue;
      }
      if (ctl === 'endPhase' || phase.mode === 'auto') {
        await advance(core, false);
        continue;
      }
    }
    // oneAction/manual: deadlock guard — zero legal moves auto-advances.
    if (enumerateMoves(core).length === 0) {
      skipStreak++;
      if (!core.usesTurnNumber && skipStreak % rotation === 0) {
        const h = futureHash(core);
        if (h === rotationHash) {
          core.state.log.push({
            turn: core.state.turnNumber,
            text: 'Stalemate — no player can act.',
          });
          finishGame(core, { kind: 'draw' });
          return;
        }
        rotationHash = h;
      }
      core.state.log.push({
        turn: core.state.turnNumber,
        text: `${currentPlayer(core).name} has no moves — ${phase.name} skipped.`,
      });
      notify(core);
      await advance(core, false);
      entering = true;
      continue;
    }
    return;
  }
}

export function createEngine(def: GameDef, opts: EngineOptions): EngineHandle {
  // Clone so later editor mutations cannot affect a running game.
  const ownDef = structuredClone(def);
  const core: Core = {
    def: ownDef,
    state: initialState(ownDef, opts),
    opts,
    rng: createRng(opts.seed),
    queue: [],
    budget: BLOCK_BUDGET,
    budgetReported: false,
    control: 'none',
    endGameRequest: null,
    nextPlayerOverride: null,
    pendingChoice: false,
    started: false,
    busy: false,
    finished: false,
    choiceSeq: 0,
    instanceSeq: 0,
    usesTurnNumber: JSON.stringify(def).includes('"kind":"turnNumber"'),
    pendingStack: [],
    stackSeq: 0,
    afterStack: 'none',
  };
  let startCalled = false;

  function getLegalMoves(playerId: Id): Move[] {
    if (!core.started || core.finished || core.busy || core.pendingChoice) return [];
    const win = core.state.window;
    if (win) {
      if (playerId !== win.holderId) return [];
      return [...enumerateResponseMoves(core, win.holderId), { actionId: PASS_ACTION_ID }];
    }
    if (playerId !== currentPlayer(core).id) return [];
    return enumerateMoves(core);
  }

  async function start(): Promise<void> {
    if (startCalled) throw new Error('start() may only be called once.');
    startCalled = true;
    core.busy = true;
    try {
      spawnDecks(core);
      resetBudget(core);
      core.control = 'none';
      await runScript(core, ownDef.setup, [{}]);
      await settle(core);
      core.started = true;
      if (core.finished) return;
      core.queue.push({ kind: 'turnStart', playerId: currentPlayer(core).id });
      if (maybeOpenWindow(core)) {
        // Stacked triggers fired during setup; enter the first phase after.
        core.afterStack = 'enterPhase';
        await autoPassMoveless(core);
        return;
      }
      await proceed(core, true);
      await autoPassMoveless(core);
    } finally {
      core.busy = false;
    }
  }

  async function performAction(playerId: Id, move: Move): Promise<void> {
    if (core.busy) throw new Error('Another action is still resolving.');
    const legal = getLegalMoves(playerId);
    if (!legal.some((m) => m.actionId === move.actionId && m.cardId === move.cardId)) {
      throw new Error(`Illegal move: ${move.actionId}${move.cardId ? ` on ${move.cardId}` : ''}`);
    }
    core.busy = true;
    try {
      if (move.actionId === PASS_ACTION_ID) {
        await passPriority(core);
        await autoPassMoveless(core);
        return;
      }
      const action = ownDef.actions.find((a) => a.id === move.actionId)!;
      const win = core.state.window;
      const actorId = win ? win.holderId : currentPlayer(core).id;
      resetBudget(core);
      core.control = 'none';
      const frames: Frame[] = [{
        $player: actorId,
        ...(move.cardId !== undefined ? { $card: move.cardId } : {}),
      }];

      if (action.stacked) {
        // Announce now (costs, card movement), resolve later via the stack.
        await runScript(core, action.announce ?? [], frames);
        await settle(core);
        if (core.finished) return;
        pushStackEntry(core, {
          label: action.name,
          sourceCardId: move.cardId ?? null,
          byPlayerId: actorId,
          script: action.script,
          snapshot: frames,
        });
      } else {
        await runScript(core, action.script, frames);
        await settle(core);
        if (core.finished) return;
      }
      const ctl = consumeControl(core);

      if (win) {
        // Response action: priority passes on, consecutive passes reset.
        // (Phase control flags do not apply inside a window.)
        const w = core.state.window;
        if (w) {
          w.passes = 0;
          const idx = core.state.players.findIndex((p) => p.id === w.holderId);
          w.holderId = core.state.players[(idx + 1) % core.state.players.length].id;
          notify(core);
        }
        await autoPassMoveless(core);
        return;
      }

      const phase = ownDef.phases[core.state.phaseIdx];
      const after: Core['afterStack'] = ctl === 'endTurn' ? 'endTurn'
        : (ctl === 'endPhase' || phase?.mode === 'oneAction') ? 'advancePhase'
        : 'none';
      // Anything pending (this action if stacked, or stacked triggers it set
      // off) opens a window; the phase bookkeeping waits for the stack.
      if (maybeOpenWindow(core)) {
        core.afterStack = after;
        await autoPassMoveless(core);
        return;
      }
      if (after === 'endTurn' || after === 'advancePhase') {
        await advance(core, after === 'endTurn');
        if (core.finished) return;
        if (maybeOpenWindow(core)) {
          core.afterStack = 'enterPhase';
          await autoPassMoveless(core);
          return;
        }
        await proceed(core, true);
      } else {
        await proceed(core, false);
      }
      // proceed(entering) can itself open a window during phase entry.
      await autoPassMoveless(core);
    } finally {
      core.busy = false;
    }
  }

  return {
    def: ownDef,
    start,
    getLegalMoves,
    performAction,
    getState: () => structuredClone(core.state),
    get finished() {
      return core.finished;
    },
  };
}
