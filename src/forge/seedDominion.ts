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
 * Deleting: an explicit Forge delete records a tombstone (the version deleted
 * at) that keeps ensureDominionSeed from resurrecting the game — the delete
 * dialog's "permanent" promise holds, and #/play/dominion falls back to a
 * stock build. A SEED_VERSION bump clears the tombstone and re-seeds.
 *
 * Both marks are mirrored in module memory so a storage-barred session
 * (Safari 'Block all cookies' etc.) seeds exactly once — never overwriting
 * the keeper's in-session edits — and a barred delete sticks until reload.
 *
 * Headless-safe: without a window (vitest node env) this is a no-op.
 */
import { getGameById, saveGame } from '../state/store';
import { buildDominionDef } from './dominionGame';

export const DOMINION_GAME_ID = 'dominion-crownfall';
export const SEED_VERSION = 12;

const STAMP_KEY = 'crownfall.seed.dominion';
const TOMBSTONE_KEY = 'crownfall.seed.dominion.deleted';

// In-session floors for the two marks — the source of truth when storage is barred.
let memoryStamp = 0;
let memoryTombstone = 0;

/** The stored mark or the in-session floor, whichever is higher. */
function readMark(key: string, memory: number): number {
  let mark = memory;
  try {
    const stored = Number(window.localStorage.getItem(key) ?? 0);
    if (Number.isFinite(stored) && stored > mark) mark = stored;
  } catch {
    // Storage barred — the in-memory mark still guards this session.
  }
  return mark;
}

export function ensureDominionSeed(): void {
  if (typeof window === 'undefined') return;
  // The keeper's explicit delete stands until the seed version moves past it.
  if (readMark(TOMBSTONE_KEY, memoryTombstone) >= SEED_VERSION) return;
  const current = readMark(STAMP_KEY, memoryStamp) >= SEED_VERSION;
  if (current && getGameById(DOMINION_GAME_ID) !== undefined) return;
  saveGame(buildDominionDef());
  memoryStamp = SEED_VERSION;
  memoryTombstone = 0;
  try {
    window.localStorage.setItem(STAMP_KEY, String(SEED_VERSION));
    window.localStorage.removeItem(TOMBSTONE_KEY);
  } catch {
    // Memory-only session; the module marks above keep this seed singular.
  }
}

/**
 * Record the keeper's explicit delete of the seeded def (the Forge home calls
 * this alongside deleteGame): ensureDominionSeed becomes a no-op until
 * SEED_VERSION bumps past the tombstone.
 */
export function markDominionSeedDeleted(): void {
  if (typeof window === 'undefined') return;
  memoryTombstone = SEED_VERSION;
  try {
    window.localStorage.setItem(TOMBSTONE_KEY, String(SEED_VERSION));
  } catch {
    // Memory-only session; the module mark holds until reload.
  }
}
