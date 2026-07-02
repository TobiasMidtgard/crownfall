/**
 * sampleState — the screen builder's headless SAMPLE GAME. The canvas
 * preview needs a real GameState to resolve `visible` expressions, element
 * states and zone contents exactly like the runner, so we run the def once
 * with the pure seeded engine (2 human seats "Sample A"/"Sample B", fixed
 * seed 7, engine.start()) and snapshot the result.
 *
 *   - Deterministic: fixed seats + fixed seed, so the same def always yields
 *     the same snapshot (engine player ids are p0/p1 — the preview's viewer
 *     is SAMPLE_VIEWER_ID).
 *   - Memoized by def IDENTITY (WeakMap). The editor deep-clones the draft
 *     on every change, so a new def object — and only a new def object —
 *     naturally rebuilds the sample.
 *   - Any failure yields null (preview disabled with a notice): a throwing
 *     createEngine/start, a script error reported during deck spawn / setup /
 *     first-phase entry, or a setup that requests an interactive choice
 *     (the sample's choice provider refuses — there is nobody to answer).
 * No React.
 */
import type { GameDef, GameState } from '../../../shared/types';
import { createEngine } from '../../../engine';

/** The seat the preview renders through (engine ids are `p<index>`). */
export const SAMPLE_VIEWER_ID = 'p0';

/** Fixed sample-run seed: previews are reproducible across sessions. */
export const SAMPLE_SEED = 7;

const cache = new WeakMap<GameDef, Promise<GameState | null>>();

/**
 * The def's sample snapshot (null = the setup failed; preview unavailable).
 * Same def object in = the same promise — and therefore the SAME snapshot
 * object — out.
 */
export function buildSampleState(def: GameDef): Promise<GameState | null> {
  let p = cache.get(def);
  if (!p) {
    p = runSample(def);
    cache.set(def, p);
  }
  return p;
}

async function runSample(def: GameDef): Promise<GameState | null> {
  let failed = false;
  try {
    const engine = createEngine(def, {
      playerNames: ['Sample A', 'Sample B'],
      aiSeats: [false, false],
      seed: SAMPLE_SEED,
      choiceProvider: {
        resolve: () => {
          throw new Error('Sample preview: setup may not request choices.');
        },
      },
      onUpdate: () => {},
      onScriptError: () => {
        failed = true;
      },
    });
    await engine.start();
    return failed ? null : engine.getState();
  } catch {
    return null;
  }
}
