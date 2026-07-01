/**
 * The chronicle — real match history, written by the Dominion table on game
 * over and read by The Tables lobby (rendered above the fixture flavor rows).
 * Stored at crownfall.chronicle (new key; the original hall had fixtures only).
 */
import { useSyncExternalStore } from 'react';

export interface ChronicleEntry {
  id: string;
  /** Signed-in player's name at the time of the match. */
  player: string;
  foe: string;
  kingdom: string;
  outcome: 'victory' | 'defeat' | 'draw';
  /** Final victory points, player first. */
  score: [number, number];
  turns: number;
  when: string; // ISO timestamp
}

const KEY = 'crownfall.chronicle';
const MAX_ENTRIES = 40;

let entries: ChronicleEntry[] = (() => {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as ChronicleEntry[]) : [];
    return Array.isArray(parsed) ? parsed.filter((e) => e && e.id && e.foe) : [];
  } catch {
    return [];
  }
})();

const listeners = new Set<() => void>();
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function getEntries() { return entries; }

export function useChronicle(): ChronicleEntry[] {
  return useSyncExternalStore(subscribe, getEntries, getEntries);
}

export function recordMatch(entry: Omit<ChronicleEntry, 'id' | 'when'>) {
  const full: ChronicleEntry = {
    ...entry,
    id: `m_${Date.now().toString(36)}_${entries.length}`,
    when: new Date().toISOString(),
  };
  entries = [full, ...entries].slice(0, MAX_ENTRIES);
  try { window.localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* memory only */ }
  listeners.forEach((l) => l());
}
