/**
 * Seeds the hall's flagship game — Dominion, id 'dominion-crownfall' — into
 * the Forge's user storage so the keeper can edit it and the hall plays the
 * edited copy.
 *
 * Versioning: 'crownfall.seed.dominion' stamps the SEED_VERSION that last
 * seeded. Keeper edits survive normal loads (present + stamp current = no-op);
 * bumping SEED_VERSION intentionally overwrites with a fresh build and
 * re-stamps. Bump it whenever buildDominionDef changes shape.
 *
 * Headless-safe: without a window (vitest node env) this is a no-op.
 */
import { getGameById, saveGame } from '../state/store';
import { buildDominionDef } from './dominionGame';

export const DOMINION_GAME_ID = 'dominion-crownfall';
export const SEED_VERSION = 1;

const STAMP_KEY = 'crownfall.seed.dominion';

export function ensureDominionSeed(): void {
  if (typeof window === 'undefined') return;
  let stamped = 0;
  try {
    stamped = Number(window.localStorage.getItem(STAMP_KEY) ?? 0);
  } catch {
    // Storage barred — treat as never stamped; the seed lives in memory only.
  }
  const current = Number.isFinite(stamped) && stamped >= SEED_VERSION;
  if (current && getGameById(DOMINION_GAME_ID) !== undefined) return;
  saveGame(buildDominionDef());
  try {
    window.localStorage.setItem(STAMP_KEY, String(SEED_VERSION));
  } catch {
    // Memory-only session; next load re-seeds, which is harmless.
  }
}
