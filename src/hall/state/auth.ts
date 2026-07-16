/**
 * Hall auth store — accounts, session, demo users.
 *
 * localStorage shapes are preserved verbatim from the original hall (FableTest
 * app.js) so existing browsers keep their accounts:
 *   crownfall.users   { [handle]: { word, name, sigil, victories, games, favorite } }
 *   crownfall.session { handle, name, sigil, keeper?, victories, games, favorite }
 *
 * Zero deps; useSyncExternalStore-style subscription like src/state/store.ts.
 * Falls back to in-memory storage when localStorage is barred.
 */
import { useSyncExternalStore } from 'react';

export type Sigil = 'ember' | 'raven' | 'gilt' | 'veil';

export interface HallUser {
  handle: string;
  name: string;
  sigil: Sigil;
  keeper?: boolean;
  victories: number;
  games: number;
  favorite: string;
}

interface StoredAccount {
  word: string;
  name: string;
  sigil: Sigil;
  victories: number;
  games: number;
  favorite: string;
  keeper?: boolean;
}

const USERS_KEY = 'crownfall.users';
const SESSION_KEY = 'crownfall.session';

/** The names known to the gate. Password ("watchword") checked at signIn. */
const DEMO_USERS: Record<string, StoredAccount> = {
  tobit: {
    word: 'crown', name: 'Tobit, Keeper of the Hall', sigil: 'ember',
    keeper: true, victories: 31, games: 58, favorite: 'First Game',
  },
  wren: {
    word: 'valor', name: 'Lady Wrenfield the Unkind', sigil: 'raven',
    victories: 44, games: 71, favorite: 'Sharp Coins',
  },
  hollis: {
    word: 'oath', name: 'Brother Hollis', sigil: 'veil',
    victories: 19, games: 40, favorite: 'The Witching Hour',
  },
};

const memoryStore = new Map<string, string>();

function read(key: string): string | null {
  try { return window.localStorage.getItem(key); }
  catch { return memoryStore.get(key) ?? null; }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    if (value === null) memoryStore.delete(key);
    else memoryStore.set(key, value);
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = read(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; }
  catch { return fallback; }
}

function loadAccounts(): Record<string, StoredAccount> {
  return readJson<Record<string, StoredAccount>>(USERS_KEY, {});
}

function migrateSession(s: Partial<HallUser> & { handle: string; name: string }): HallUser {
  return {
    handle: s.handle,
    name: s.name,
    sigil: (s.sigil as Sigil) ?? 'ember',
    keeper: s.keeper === true ? true : undefined,
    victories: typeof s.victories === 'number' ? s.victories : 0,
    games: typeof s.games === 'number' ? s.games : (typeof s.victories === 'number' ? s.victories : 0),
    favorite: typeof s.favorite === 'string' ? s.favorite : 'First Game',
  };
}

let session: HallUser | null = (() => {
  const raw = readJson<(Partial<HallUser> & { handle: string; name: string }) | null>(SESSION_KEY, null);
  return raw && raw.handle ? migrateSession(raw) : null;
})();

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function setSession(next: HallUser | null) {
  session = next;
  write(SESSION_KEY, next ? JSON.stringify(next) : null);
  emit();
}

export function getUser(): HallUser | null { return session; }
export function useUser(): HallUser | null {
  return useSyncExternalStore(subscribe, getUser, getUser);
}

export type SignInResult = { ok: true; user: HallUser } | { ok: false; reason: 'unknown-name' | 'wrong-word' };

export function signIn(handle: string, word: string): SignInResult {
  const h = handle.trim().toLowerCase();
  const account = loadAccounts()[h] ?? DEMO_USERS[h];
  if (!account) return { ok: false, reason: 'unknown-name' };
  if (account.word !== word) return { ok: false, reason: 'wrong-word' };
  const user = migrateSession({ handle: h, ...account, keeper: account.keeper });
  setSession(user);
  return { ok: true, user };
}

export type RegisterResult =
  | { ok: true; user: HallUser }
  | { ok: false; reason: 'handle-format' | 'handle-taken' | 'word-short' };

export function register(handle: string, word: string, sigil: Sigil): RegisterResult {
  const h = handle.trim().toLowerCase();
  if (h.length < 3 || !/^[a-z0-9_-]+$/.test(h)) return { ok: false, reason: 'handle-format' };
  if (word.length < 6) return { ok: false, reason: 'word-short' };
  const accounts = loadAccounts();
  if (accounts[h] || DEMO_USERS[h]) return { ok: false, reason: 'handle-taken' };
  const name = `${h.charAt(0).toUpperCase()}${h.slice(1)} of the Yard`;
  const account: StoredAccount = { word, name, sigil, victories: 0, games: 0, favorite: 'First Game' };
  accounts[h] = account;
  write(USERS_KEY, JSON.stringify(accounts));
  const user = migrateSession({ handle: h, ...account });
  setSession(user);
  return { ok: true, user };
}

export function signOut() { setSession(null); }

/** True for the storied demo names — their opening ledgers are hall lore,
 * not records this player earned. */
export function isDemoAccount(handle: string): boolean {
  return handle in DEMO_USERS;
}

/* ── returnTo — where the gate turned a visitor away from ──
 * A gated route stashes its hash before bouncing to #/login; the Gates send
 * the visitor back there on success instead of hard-coding #/tables.
 * sessionStorage: per-tab, survives the redirect, gone with the tab. */

const RETURN_KEY = 'crownfall.returnTo';
let memoryReturnTo: string | null = null;

export function setReturnTo(hash: string) {
  memoryReturnTo = hash;
  try { window.sessionStorage.setItem(RETURN_KEY, hash); } catch { /* memory only */ }
}

export function consumeReturnTo(): string | null {
  let hash = memoryReturnTo;
  try {
    hash = window.sessionStorage.getItem(RETURN_KEY) ?? hash;
    window.sessionStorage.removeItem(RETURN_KEY);
  } catch { /* memory only */ }
  memoryReturnTo = null;
  return hash;
}

/** Patch the session and (for registered accounts) the stored record. */
export function updateUser(patch: Partial<Omit<HallUser, 'handle'>>) {
  if (!session) return;
  const next = { ...session, ...patch };
  setSession(next);
  const accounts = loadAccounts();
  const record = accounts[session.handle];
  if (record) {
    accounts[session.handle] = { ...record, ...patch, word: record.word };
    write(USERS_KEY, JSON.stringify(accounts));
  }
}
