/**
 * GameSession — the non-React glue around one engine run.
 *
 * Responsibilities:
 *  - routes ChoiceRequests by seat: AI seats auto-answer after a short delay,
 *    human seats surface the request in the snapshot for the UI to resolve;
 *  - schedules AI moves (uniform random legal move, ~700ms apart) and keeps
 *    the loop going after every settle;
 *  - recomputes legal moves whenever the engine goes idle — for the ACTING
 *    seat: during a response window that is the priority holder (any seat,
 *    human or AI), otherwise the current player. AI holders auto-pass (or
 *    occasionally respond) after the usual delay;
 *  - publishes immutable snapshots for React's useSyncExternalStore;
 *  - online: guards the lockstep. Every relayed frame carries a state
 *    fingerprint; a mismatch, a rejected remote move, a failed send or the
 *    peer vanishing sets `netDown` — the table freezes (no moves, no
 *    answers) instead of silently forking, and the fault is reported to the
 *    host UI via the adapter's optional reportFault.
 *
 * The session never throws: a rejected performAction (stale move) just
 * refreshes the legal moves.
 */
import { createEngine } from '../engine';
import type {
  ChoiceAnswer, ChoiceRequest, EngineHandle, GameDef, GameState, Move,
} from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import { actingSeat } from './layout';
import type { NetAdapter, NetFault, NetMsg } from './net';

export interface SeatSetup {
  name: string;
  isAI: boolean;
  /**
   * Online play: this seat is decided on the OTHER client — its moves and
   * choice answers arrive over the net adapter instead of local input.
   * (On the guest, the host's AI seats are also marked remote: AI runs on
   * exactly one client and relays, since its randomness is unseeded.)
   */
  remote?: boolean;
}

export interface SessionSnapshot {
  state: GameState;
  /** Choice currently waiting on a HUMAN answer (AI choices auto-resolve). */
  choice: ChoiceRequest | null;
  /** Legal moves for the current player when human and idle, else []. */
  moves: Move[];
  /** True while the engine is resolving (setup, a human tap, an AI move). */
  busy: boolean;
  started: boolean;
  finished: boolean;
  /** Latest non-fatal script problem (dismissible banner). */
  scriptError: string | null;
  /** The online link is dead or the two tables diverged: local play stops
   *  (no moves, no answers) and the host UI shows a persistent surface. */
  netDown: NetFault | null;
  /** start() blew up — the definition is unplayable. */
  fatalError: string | null;
}

const AI_MOVE_DELAY_MS = 700;
const AI_CHOICE_DELAY_MS = 500;
/** Chance an AI declines an optional card choice instead of picking. */
const AI_DECLINE_CHANCE = 0.1;
/** Chance an AI holder takes a legal response action instead of passing. */
const AI_RESPONSE_CHANCE = 0.35;

/**
 * Lockstep fingerprint: FNV-1a over the serialized state. Cheap and
 * deterministic — a tripwire for divergence, not cryptography. Both engines
 * build their states through identical code paths, so key order matches
 * (the same property determinism.test.ts leans on).
 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function stateHash(state: GameState): number {
  return fnv1a(JSON.stringify(state));
}

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/** AI holding priority: mostly pass, sometimes take a response action. */
function aiWindowMove(moves: Move[]): Move {
  const pass = moves.find((m) => m.actionId === PASS_ACTION_ID);
  const rest = moves.filter((m) => m.actionId !== PASS_ACTION_ID);
  if (!pass) return randomItem(moves);
  if (rest.length === 0 || Math.random() >= AI_RESPONSE_CHANCE) return pass;
  return randomItem(rest);
}

/** Uniform random answer among the offered candidates. */
function aiAnswer(req: ChoiceRequest): ChoiceAnswer {
  switch (req.kind) {
    case 'card':
      if (req.optional && Math.random() < AI_DECLINE_CHANCE) return null;
      return randomItem(req.cardIds);
    case 'pile':
      if (req.optional && Math.random() < AI_DECLINE_CHANCE) return null;
      return randomItem(req.cardIds);
    case 'option':
      return randomItem(req.options).id;
    case 'player':
      return randomItem(req.playerIds);
    case 'yesNo':
      return Math.random() < 0.5;
    case 'cards': {
      const count = req.min + Math.floor(Math.random() * (req.max - req.min + 1));
      const pool = [...req.cardIds];
      const picked: string[] = [];
      while (picked.length < count && pool.length > 0) {
        picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
      }
      return JSON.stringify(picked);
    }
  }
}

export class GameSession {
  readonly engine: EngineHandle;
  snapshot: SessionSnapshot;

  private readonly aiSeats: boolean[];
  private readonly remoteSeats: boolean[];
  private readonly net: NetAdapter | null;
  private listeners = new Set<() => void>();
  private notifyScheduled = false;
  private disposed = false;
  private begun = false;
  /** A performAction is currently running (human tap or AI move). */
  private inFlight = false;
  private aiMoveTimer: ReturnType<typeof setTimeout> | null = null;
  private aiChoiceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Pending human choice: request id, resolver, and the ask-time state
   *  hash (the lockstep checkpoint relayed with the answer). */
  private humanAnswer: { id: number; resolve: (a: ChoiceAnswer) => void; h: number } | null = null;
  /** Choices awaiting a REMOTE seat's answer, by request id, with the hash
   *  our own ask-time state produced (the peer's must match). */
  private remoteAnswers = new Map<number, { resolve: (a: ChoiceAnswer) => void; expect: number }>();
  /** Remote answers that arrived before our engine asked (ordering slack). */
  private earlyAnswers = new Map<number, { answer: ChoiceAnswer; h?: number }>();
  /** Remote moves waiting for the engine to go idle. */
  private netQueue: Extract<NetMsg, { t: 'move' }>[] = [];

  constructor(def: GameDef, seats: SeatSetup[], seed: number, net: NetAdapter | null = null) {
    this.aiSeats = seats.map((s) => s.isAI);
    this.remoteSeats = seats.map((s) => s.remote === true);
    this.net = net;
    if (net) {
      net.onMessage((msg) => this.handleNet(msg));
      net.onClose(() => this.netFault('disconnect',
        "The other player disconnected — this match can't continue."));
    }
    this.engine = createEngine(def, {
      playerNames: seats.map((s) => s.name),
      aiSeats: this.aiSeats,
      seed,
      choiceProvider: { resolve: (req, state) => this.resolveChoice(req, state) },
      onUpdate: (state) => this.patch({ state, finished: this.engine.finished }),
      onScriptError: (message) => this.patch({ scriptError: message }),
    });
    this.snapshot = {
      state: this.engine.getState(),
      choice: null,
      moves: [],
      busy: true,
      started: false,
      finished: false,
      scriptError: null,
      netDown: null,
      fatalError: null,
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Kick the game off. Idempotent (StrictMode re-runs effects). */
  begin(): void {
    if (this.begun) return;
    this.begun = true;
    this.engine.start()
      .then(() => this.patch({ started: true }))
      .catch((e: unknown) => {
        this.patch({ fatalError: e instanceof Error ? e.message : String(e), busy: false });
      })
      .finally(() => this.refresh());
  }

  /** Perform a move tapped by the acting human seat (window holder or current player). */
  async performHumanMove(move: Move): Promise<void> {
    if (this.disposed || this.inFlight || this.humanAnswer !== null || this.engine.finished) return;
    if (this.snapshot.netDown !== null) return; // frozen table — no forking
    const state = this.engine.getState();
    const actor = actingSeat(state);
    if (!actor || actor.isAI || this.isRemote(actor.id)) return;
    this.inFlight = true;
    this.patch({ moves: [], busy: true });
    let applied = false;
    try {
      await this.engine.performAction(actor.id, move);
      applied = true;
    } catch {
      // The move went stale (raced a state change) — refresh re-syncs.
    } finally {
      this.inFlight = false;
    }
    // Lockstep: the peer replays this exact move on its own engine; the hash
    // is the settled state both engines must now agree on. Relayed OUTSIDE
    // the engine try so a transport failure surfaces instead of reading as
    // a stale move.
    if (applied && this.net) this.relay({ t: 'move', seat: actor.id, move, h: this.settledHash() });
    this.refresh();
  }

  /**
   * Answer the pending human choice from the UI. `requestId` must match the
   * ChoiceRequest being answered: a double-tap or an answer for an already
   * resolved (stale) request is silently ignored, so it can never leak into
   * the NEXT prompt.
   */
  answerChoice(requestId: number, answer: ChoiceAnswer): void {
    if (this.snapshot.netDown !== null) return; // frozen table
    const pending = this.humanAnswer;
    if (!pending || pending.id !== requestId) return;
    this.humanAnswer = null;
    this.patch({ choice: null });
    // Lockstep: the peer's engine is waiting on the same request id. The
    // hash was taken at the ask — both engines paused on that exact state.
    this.relay({ t: 'answer', id: requestId, answer, h: pending.h });
    pending.resolve(answer);
  }

  dismissScriptError(): void {
    this.patch({ scriptError: null });
  }

  dispose(): void {
    this.disposed = true;
    if (this.aiMoveTimer !== null) clearTimeout(this.aiMoveTimer);
    if (this.aiChoiceTimer !== null) clearTimeout(this.aiChoiceTimer);
    this.listeners.clear();
  }

  // -------------------------------------------------------------------------

  private isRemote(playerId: string): boolean {
    return this.remoteSeats[Number(playerId.slice(1))] === true;
  }

  /** The current settled engine state's fingerprint. */
  private settledHash(): number {
    return stateHash(this.engine.getState());
  }

  /**
   * Freeze the table on a fatal online fault (first fault wins): no more
   * moves or answers apply locally, and the host UI is told to show its
   * persistent surface. Deliberately NOT the dismissible scriptError banner.
   */
  private netFault(kind: NetFault['kind'], message: string): void {
    if (this.disposed || this.snapshot.netDown !== null) return;
    const fault: NetFault = { kind, message };
    this.patch({ netDown: fault, moves: [] });
    this.net?.reportFault?.(fault);
  }

  /** Relay a lockstep frame; a throwing transport means the peer can no
   *  longer mirror this game — surface it rather than fork silently. */
  private relay(msg: NetMsg): void {
    if (!this.net || this.snapshot.netDown !== null) return;
    try {
      this.net.send(msg);
    } catch (e) {
      console.error('[session] relay failed:', e);
      this.netFault('disconnect', "A move never reached the other player — this match can't continue.");
    }
  }

  /** Lockstep tripwire: both engines must agree byte-for-byte at every
   *  checkpoint. `theirs` is undefined when the peer runs an older build
   *  without hashes — tolerate rather than false-alarm. */
  private checkHash(theirs: number | undefined, ours: number): void {
    if (theirs === undefined || theirs === ours) return;
    this.netFault('desync', "The two tables are out of sync — this match can't continue.");
  }

  /** Inbound lockstep frames from the other client. */
  private handleNet(msg: NetMsg): void {
    if (this.disposed || this.snapshot.netDown !== null) return;
    if (msg.t === 'answer') {
      const pending = this.remoteAnswers.get(msg.id);
      if (pending !== undefined) {
        this.remoteAnswers.delete(msg.id);
        this.checkHash(msg.h, pending.expect);
        if (this.snapshot.netDown === null) pending.resolve(msg.answer);
      } else {
        // Arrived before our engine asked — hold it (ids are engine-global).
        this.earlyAnswers.set(msg.id, { answer: msg.answer, h: msg.h });
      }
      return;
    }
    this.netQueue.push(msg);
    void this.drainNet();
  }

  /** Apply queued remote moves whenever the engine is idle. */
  private async drainNet(): Promise<void> {
    if (this.disposed || this.inFlight || this.engine.finished) return;
    if (this.snapshot.netDown !== null) return;
    if (this.humanAnswer !== null || this.remoteAnswers.size > 0) return; // mid-choice
    const msg = this.netQueue.shift();
    if (msg === undefined) return;
    this.inFlight = true;
    this.patch({ moves: [], busy: true });
    let applied = false;
    try {
      await this.engine.performAction(msg.seat, msg.move);
      applied = true;
    } catch (e) {
      // The peer applied this move BEFORE relaying it: our engine refusing
      // it means the two tables have already diverged.
      console.error('[session] remote move rejected:', e);
      this.netFault('desync', "The two tables are out of sync — this match can't continue.");
    } finally {
      this.inFlight = false;
    }
    if (applied) this.checkHash(msg.h, this.settledHash());
    this.refresh();
  }

  private resolveChoice(req: ChoiceRequest, state: GameState): Promise<ChoiceAnswer> {
    if (this.disposed) return new Promise<ChoiceAnswer>(() => undefined); // dead session: never settles
    const seatIdx = Number(req.playerId.slice(1));
    // The ask-time state is this request's lockstep checkpoint: both engines
    // pause on the same request id holding byte-identical state.
    const askHash = this.net ? stateHash(state) : 0;
    if (this.remoteSeats[seatIdx]) {
      // The answer is decided on the other client. It may already be here
      // (the peer resolved and sent before our engine asked).
      const early = this.earlyAnswers.get(req.id);
      if (early !== undefined) {
        this.earlyAnswers.delete(req.id);
        this.checkHash(early.h, askHash);
        // A detected fork freezes the engine mid-settle rather than playing on.
        if (this.snapshot.netDown !== null) return new Promise<ChoiceAnswer>(() => undefined);
        return Promise.resolve(early.answer);
      }
      this.patch({ state, moves: [] });
      return new Promise<ChoiceAnswer>((resolve) => {
        this.remoteAnswers.set(req.id, { resolve, expect: askHash });
      });
    }
    if (this.aiSeats[seatIdx]) {
      return new Promise<ChoiceAnswer>((resolve) => {
        this.aiChoiceTimer = setTimeout(() => {
          this.aiChoiceTimer = null;
          const answer = aiAnswer(req);
          // The AI lives on THIS client only; relay its decision.
          this.relay({ t: 'answer', id: req.id, answer, h: askHash });
          resolve(answer);
        }, AI_CHOICE_DELAY_MS);
      });
    }
    // Human seat: surface the request; the state clone is current as of the ask.
    this.patch({ state, choice: req, moves: [] });
    return new Promise<ChoiceAnswer>((resolve) => {
      this.humanAnswer = { id: req.id, resolve, h: askHash };
    });
  }

  /** After every settle: re-sync state + legal moves, keep the AI loop going. */
  private refresh(): void {
    if (this.disposed || this.snapshot.fatalError) return;
    const state = this.engine.getState();
    const actor = actingSeat(state);
    const idle = !this.inFlight && this.humanAnswer === null;
    const moves = actor && !actor.isAI && !this.isRemote(actor.id) && idle
      && !this.engine.finished && this.snapshot.netDown === null
      ? this.engine.getLegalMoves(actor.id)
      : [];
    this.patch({ state, moves, busy: !idle, finished: this.engine.finished });
    this.maybeScheduleAiMove();
    void this.drainNet();
  }

  private maybeScheduleAiMove(): void {
    if (this.disposed || this.engine.finished || this.inFlight) return;
    if (this.snapshot.netDown !== null) return; // frozen table — the AI stops too
    if (this.humanAnswer !== null || this.aiMoveTimer !== null || !this.snapshot.started) return;
    const actor = actingSeat(this.snapshot.state);
    // AI runs on the client that OWNS the seat (never for remote mirrors).
    if (!actor || !actor.isAI || this.isRemote(actor.id)) return;
    this.aiMoveTimer = setTimeout(() => {
      this.aiMoveTimer = null;
      void this.runAiMove();
    }, AI_MOVE_DELAY_MS);
  }

  private async runAiMove(): Promise<void> {
    if (this.disposed || this.engine.finished || this.inFlight || this.humanAnswer !== null) return;
    if (this.snapshot.netDown !== null) return;
    const state = this.engine.getState();
    const actor = actingSeat(state);
    if (!actor || !actor.isAI) return;
    const moves = this.engine.getLegalMoves(actor.id);
    if (moves.length === 0) return; // engine auto-skips dead phases; nothing to do
    const move = state.window !== null ? aiWindowMove(moves) : randomItem(moves);
    this.inFlight = true;
    this.patch({ busy: true });
    let applied = false;
    try {
      await this.engine.performAction(actor.id, move);
      applied = true;
    } catch {
      // Stale move — refresh below re-syncs.
    } finally {
      this.inFlight = false;
    }
    // The AI lives on THIS client only; relay its move (with the settled
    // hash) outside the engine try — see performHumanMove.
    if (applied && this.net) this.relay({ t: 'move', seat: actor.id, move, h: this.settledHash() });
    this.refresh();
  }

  /** Replace the snapshot and notify subscribers (coalesced per microtask). */
  private patch(p: Partial<SessionSnapshot>): void {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...p };
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    queueMicrotask(() => {
      this.notifyScheduled = false;
      if (this.disposed) return;
      for (const l of this.listeners) l();
    });
  }
}
