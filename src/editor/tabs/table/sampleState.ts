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
 *   - Memoized by a SIGNATURE over only the parts the sample run depends on
 *     (everything except the screen layout). The editor deep-clones the whole
 *     draft on every change, so dragging or restyling a screen element would
 *     otherwise mint a new def object and needlessly re-run the engine — and
 *     blank the preview to the grey fallback for a frame. Excluding the screen
 *     layout means presentation edits reuse the cached sample instantly.
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

const cache = new Map<string, Promise<GameState | null>>();
/** Bound the cache — each meaningful edit mints a new signature. */
const CACHE_LIMIT = 6;

/**
 * A stable key over only the parts the sample RUN depends on. `screenLayout`
 * and the deprecated `tableLayout` are pure presentation — excluding them means
 * a rect drag / restyle reuses the cached sample rather than re-running the
 * engine. Computed only when the def changes (a drop / a real edit), never per
 * drag frame (the drag itself mutates canvas-local state, not the def).
 */
export function sampleSignature(def: GameDef): string {
  const { screenLayout: _s, tableLayout: _t, ...game } = def;
  return JSON.stringify(game);
}

/**
 * The def's sample snapshot (null = the setup failed; preview unavailable).
 * Same game-signature in = the same promise (the SAME snapshot object) out, so
 * screen-layout-only changes never rebuild.
 */
export function buildSampleState(def: GameDef): Promise<GameState | null> {
  const sig = sampleSignature(def);
  let p = cache.get(sig);
  if (p === undefined) {
    p = runSample(def);
    cache.set(sig, p);
    if (cache.size > CACHE_LIMIT) {
      const oldest = cache.keys().next().value; // Map keeps insertion order
      if (oldest !== undefined) cache.delete(oldest);
    }
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
