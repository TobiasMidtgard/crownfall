/**
 * Persistence: user games live in localStorage; export/import as .json files.
 */
import type { GameDef } from '../shared/types';
import { migrateGameDef } from '../shared/migrate';
import { validateGameDef } from '../shared/validate';

const KEY = 'cardsmith.games.v1';

/**
 * Structural soundness check: every collection the editors/engine/validators
 * iterate must actually be an array, and meta must be intact. A doc passing
 * this cannot crash validateGameDef/exprToText — it may still have validation
 * errors, which the issue checker reports normally.
 */
export function isStructurallySound(g: unknown): g is GameDef {
  if (!g || typeof g !== 'object') return false;
  const d = g as GameDef;
  if (d.schemaVersion !== 1) return false;
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
    localStorage.setItem(KEY, JSON.stringify(games));
    return true;
  } catch {
    // Quota exceeded (usually giant card images). The app keeps working in-memory.
    return false;
  }
}

export function exportGame(def: GameDef): void {
  const blob = new Blob([JSON.stringify(def, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${def.meta.name.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'game'}.cardsmith.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseImportedGame(text: string): GameDef {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Not a valid Cardsmith game file (not JSON).');
  }
  if (!isStructurallySound(parsed)) {
    throw new Error('Not a valid Cardsmith game file (missing or corrupted sections).');
  }
  return migrateGameDef(parsed);
}
