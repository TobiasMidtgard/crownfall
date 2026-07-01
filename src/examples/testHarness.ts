/**
 * Test-only playthrough harness for the example games: a seeded local RNG, a
 * uniformly-random ChoiceProvider, and a loop that plays random legal moves
 * through the REAL engine until the game finishes (or a step cap trips).
 * One RNG stream drives both choices and move picks, so a (gameSeed,
 * choiceSeed) pair fully determines an entire run.
 */
import type { ChoiceProvider, ChoiceRequest, GameDef, GameState } from '../shared/types';
import { createEngine } from '../engine';

export const STEP_CAP = 4000;

/** mulberry32 — local copy so tests don't reach into engine internals. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}

/** Answers every choice uniformly at random from the offered candidates. */
export function randomChoiceProvider(rand: () => number): ChoiceProvider {
  return {
    resolve(req: ChoiceRequest) {
      switch (req.kind) {
        case 'card': return Promise.resolve(pick(rand, req.cardIds));
        case 'option': return Promise.resolve(pick(rand, req.options).id);
        case 'player': return Promise.resolve(pick(rand, req.playerIds));
        case 'yesNo': return Promise.resolve(rand() < 0.5);
        case 'cards': {
          // Random count in [min, max], random distinct picks.
          const count = req.min + Math.floor(rand() * (req.max - req.min + 1));
          const pool = [...req.cardIds];
          const picked: string[] = [];
          while (picked.length < count && pool.length > 0) {
            picked.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
          }
          return Promise.resolve(JSON.stringify(picked));
        }
      }
    },
  };
}

export interface PlaythroughResult {
  finished: boolean;
  steps: number;
  state: GameState;
  /** Script errors reported by the engine — a clean def produces none. */
  errors: string[];
}

const NAMES = ['Ada', 'Brook', 'Caro', 'Dex'];

export async function playThrough(
  def: GameDef,
  opts: { seed: number; choiceSeed?: number; playerCount?: number; stepCap?: number },
): Promise<PlaythroughResult> {
  const players = NAMES.slice(0, opts.playerCount ?? def.meta.minPlayers);
  const rand = seededRandom(opts.choiceSeed ?? (opts.seed * 7919 + 17));
  const cap = opts.stepCap ?? STEP_CAP;
  const errors: string[] = [];
  const engine = createEngine(def, {
    playerNames: players,
    aiSeats: players.map(() => false),
    seed: opts.seed,
    choiceProvider: randomChoiceProvider(rand),
    onUpdate: () => {},
    onScriptError: (m) => errors.push(m),
  });

  await engine.start();
  let steps = 0;
  while (!engine.finished && steps < cap) {
    const state = engine.getState();
    // While a response window is open the PRIORITY HOLDER acts (response
    // moves + the built-in pass move); otherwise it's the turn player.
    const actor = state.window
      ? state.window.holderId
      : state.players[state.currentPlayerIdx].id;
    const moves = engine.getLegalMoves(actor);
    // The engine's deadlock guard should make this unreachable while the
    // game is running; callers assert `finished` to surface it as a failure.
    if (moves.length === 0) break;
    await engine.performAction(actor, pick(rand, moves));
    steps++;
  }
  return { finished: engine.finished, steps, state: engine.getState(), errors };
}

/** Total cards on the table, across every zone instance. */
export function totalCards(state: GameState): number {
  return Object.values(state.zones).reduce((n, z) => n + z.cardIds.length, 0);
}
