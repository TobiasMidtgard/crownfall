/**
 * Persistence: user games live in localStorage; export/import as .json files.
 */
import type { GameDef } from '../shared/types';
import { migrateGameDef } from '../shared/migrate';
import { validateGameDef } from '../shared/validate';

const KEY = 'cardsmith.games.v1';

/**
 * Raw JSON last read from or written to our key. Lets persistGames skip
 * writes whose bytes storage already holds (no quota churn, no storage
 * events waking other tabs) and lets the cross-tab listener in state/store
 * skip re-parsing an echo of the state it already has.
 */
let lastRaw: string | null = null;

export function getPersistedRaw(): string | null {
  return lastRaw;
}

/**
 * Structural soundness check: every collection the editors/engine/validators
 * iterate must actually be an array, and meta must be intact. A doc passing
 * this cannot crash validateGameDef/exprToText — it may still have validation
 * errors, which the issue checker reports normally.
 */
export function isStructurallySound(g: unknown): g is GameDef {
  if (!g || typeof g !== 'object') return false;
  const d = g as GameDef;
  if (d.schemaVersion !== 1 && d.schemaVersion !== 2) return false;
  if (!d.meta || typeof d.meta !== 'object' || typeof d.meta.id !== 'string' || !d.meta.id) return false;
  if (typeof d.meta.name !== 'string' || typeof d.meta.minPlayers !== 'number' || typeof d.meta.maxPlayers !== 'number') return false;
  const arrays: (keyof GameDef)[] = [
    'variables', 'zones', 'decks', 'templates', 'cards', 'setup', 'phases', 'actions', 'triggers', 'endConditions',
  ];
  if (!arrays.every((k) => Array.isArray(d[k]))) return false;
  // Entries the editors index into without guards.
  if (!d.zones.every((z) => z && typeof z.id === 'string')) return false;
  if (!d.phases.every((p) => p && typeof p.id === 'string' && Array.isArray(p.onEnter) && Array.isArray(p.actionIds))) return false;
  if (!d.templates.every((t) => t && typeof t.id === 'string' && Array.isArray(t.elements) && Array.isArray(t.fields))) return false;
  if (!d.cards.every((c) => c && typeof c.id === 'string' && Array.isArray(c.abilities) && !!c.fields)) return false;
  try {
    validateGameDef(d); // deep walk — throws only on malformed expression trees
    return true;
  } catch {
    return false;
  }
}

export function loadGames(): GameDef[] {
  try {
    const raw = localStorage.getItem(KEY);
    lastRaw = raw;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isStructurallySound).map(migrateGameDef);
  } catch {
    return [];
  }
}

export function persistGames(games: GameDef[]): boolean {
  try {
    const json = JSON.stringify(games); // serialized once — compared, then written
    if (json === lastRaw) return true; // bytes already in storage — skip the write
    localStorage.setItem(KEY, json);
    lastRaw = json;
    return true;
  } catch {
    // Quota exceeded (usually giant card images) or the stringify itself blew
    // the string limit. The app keeps working in-memory; callers surface it.
    return false;
  }
}

export function exportGame(def: GameDef): void {
  const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${def.meta.name.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'game'}.crownfall.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseImportedGame(text: string): GameDef {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Not a valid Crownfall game file (not JSON).');
  }
  if (!isStructurallySound(parsed)) {
    throw new Error('Not a valid Crownfall game file (missing or corrupted sections).');
  }
  return migrateGameDef(parsed);
}
