/**
 * Minimal app store (no dependencies): the list of user games plus CRUD.
 * Built-in examples are exposed read-only alongside.
 */
import { useSyncExternalStore } from 'react';
import type { GameDef } from '../shared/types';
import { getPersistedRaw, loadGames, persistGames } from '../storage/storage';
import { exampleGames } from '../examples';
import { deepClone, uid } from '../shared/defaults';

/** localStorage key for user games — must match KEY in src/storage/storage.ts. */
const GAMES_STORAGE_KEY = 'cardsmith.games.v1';

let userGames: GameDef[] = loadGames();
let storageOk = true;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

// Another tab saved/deleted games: refresh our snapshot so tabs don't clobber
// each other's whole-array writes. (Last write wins per game after the sync.)
// loadGames re-parses and deep-validates every stored game — too heavy to run
// per event during an editing tab's autosave burst, so echoes of bytes we
// already hold are skipped and the re-parse is debounced.
const SYNC_DEBOUNCE_MS = 250;
if (typeof window !== 'undefined') {
  let syncTimer: number | undefined;
  window.addEventListener('storage', (e) => {
    // key === null means localStorage.clear(); otherwise only react to our key.
    if (e.key !== null && e.key !== GAMES_STORAGE_KEY) return;
    if (e.key !== null && e.newValue !== null && e.newValue === getPersistedRaw()) return;
    if (syncTimer !== undefined) window.clearTimeout(syncTimer);
    syncTimer = window.setTimeout(() => {
      syncTimer = undefined;
      userGames = loadGames();
      emit();
    }, SYNC_DEBOUNCE_MS);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUserGames(): GameDef[] {
  return useSyncExternalStore(subscribe, () => userGames);
}

export function useStorageOk(): boolean {
  return useSyncExternalStore(subscribe, () => storageOk);
}

export function getGameById(id: string): GameDef | undefined {
  return userGames.find((g) => g.meta.id === id) ?? exampleGames.find((g) => g.meta.id === id);
}

export function isBuiltIn(id: string): boolean {
  return exampleGames.some((g) => g.meta.id === id);
}

/**
 * Insert or replace a user game (built-ins are never written).
 * Returns false when the change could not be persisted (storage full) —
 * the in-memory copy is still updated so the app keeps working.
 */
export function saveGame(def: GameDef): boolean {
  const idx = userGames.findIndex((g) => g.meta.id === def.meta.id);
  // The exact object we already persisted (e.g. a flush firing twice for one
  // edit): skip the whole-array serialization. Retry when the last persist
  // failed — storage may have room again.
  if (idx >= 0 && userGames[idx] === def && storageOk) return true;
  const next = [...userGames];
  if (idx >= 0) next[idx] = def;
  else next.unshift(def);
  userGames = next;
  storageOk = persistGames(userGames);
  emit();
  return storageOk;
}

/**
 * Per-device runner state accumulates under per-game key prefixes (selector
 * choices and collapsed panels — see src/runner/layout.ts). Swept on delete
 * so cloned-and-discarded games don't eat quota forever.
 */
function clearPerGameKeys(id: string): void {
  // Kept coupling-free on purpose (no editor imports in the eager store
  // chunk) — mirrors the designer's clearDesignerKeysForGame prefixes.
  const prefixes = [
    `cardsmith.sel.${id}.`,
    `cardsmith.collapse.${id}.`,
    `cardsmith.discardedLayout.${id}`,
  ];
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && prefixes.some((p) => k.startsWith(p))) localStorage.removeItem(k);
    }
  } catch {
    // Storage unavailable — nothing persisted to clean up.
  }
}

export function deleteGame(id: string): void {
  userGames = userGames.filter((g) => g.meta.id !== id);
  storageOk = persistGames(userGames);
  clearPerGameKeys(id);
  emit();
}

/** Clone any game (typically a built-in example) into an editable user game. */
export function cloneGame(def: GameDef): GameDef {
  const copy = deepClone(def);
  copy.meta = { ...copy.meta, id: uid('game'), name: `${def.meta.name} (copy)`, builtIn: false };
  saveGame(copy);
  return copy;
}
