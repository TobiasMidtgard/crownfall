/**
 * Minimal app store (no dependencies): the list of user games plus CRUD.
 * Built-in examples are exposed read-only alongside.
 */
import { useSyncExternalStore } from 'react';
import type { GameDef } from '../shared/types';
import { loadGames, persistGames } from '../storage/storage';
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
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    // key === null means localStorage.clear(); otherwise only react to our key.
    if (e.key !== null && e.key !== GAMES_STORAGE_KEY) return;
    userGames = loadGames();
    emit();
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
  const next = [...userGames];
  if (idx >= 0) next[idx] = def;
  else next.unshift(def);
  userGames = next;
  storageOk = persistGames(userGames);
  emit();
  return storageOk;
}

export function deleteGame(id: string): void {
  userGames = userGames.filter((g) => g.meta.id !== id);
  storageOk = persistGames(userGames);
  emit();
}

/** Clone any game (typically a built-in example) into an editable user game. */
export function cloneGame(def: GameDef): GameDef {
  const copy = deepClone(def);
  copy.meta = { ...copy.meta, id: uid('game'), name: `${def.meta.name} (copy)`, builtIn: false };
  saveGame(copy);
  return copy;
}
