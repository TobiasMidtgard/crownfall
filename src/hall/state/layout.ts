/**
 * Landing section layout — read side of the mason tools (write side arrives
 * with wave 2's mason bar, through setSectionLayout below).
 *
 * Persists inside 'crownfall.layout' — the original editor.js key, which also
 * carries a 'blocks' member this module does not own; writes preserve any
 * keys it does not understand.
 */
import { useSyncExternalStore } from 'react';

export type SectionId = 'library' | 'cards' | 'way' | 'call';
export const SECTION_ORDER: SectionId[] = ['library', 'cards', 'way', 'call'];

const KEY = 'crownfall.layout';

export interface SectionLayout {
  order: SectionId[];
  shelved: SectionId[];
}

function isSection(v: unknown): v is SectionId {
  return typeof v === 'string' && (SECTION_ORDER as string[]).includes(v);
}

function readStored(): Record<string, unknown> {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch { return {}; }
}

function load(): SectionLayout {
  const stored = readStored();
  const order = Array.isArray(stored.order) ? stored.order.filter(isSection) : [];
  const shelved = Array.isArray(stored.shelved) ? stored.shelved.filter(isSection) : [];
  // sections missing from an older stored order fall back into their places
  return {
    order: [...order, ...SECTION_ORDER.filter((s) => !order.includes(s))],
    shelved,
  };
}

let layout: SectionLayout = load();

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

export function getSectionLayout(): SectionLayout { return layout; }
export function useSectionLayout(): SectionLayout {
  return useSyncExternalStore(subscribe, getSectionLayout);
}

export function setSectionLayout(patch: Partial<SectionLayout>) {
  layout = { ...layout, ...patch };
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      ...readStored(), // keep blocks (and anything else) intact
      order: layout.order,
      shelved: layout.shelved,
    }));
  } catch { /* memory only */ }
  emit();
}

/** Mason "restore the original" wipes the whole layout key (blocks included). */
export function resetSectionLayout() {
  layout = { order: [...SECTION_ORDER], shelved: [] };
  try { window.localStorage.removeItem(KEY); } catch { /* memory only */ }
  emit();
}
