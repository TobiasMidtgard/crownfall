/**
 * components — a per-device library of reusable screen elements. The author
 * saves a styled element (with its whole subtree) from the inspector; the
 * palette then drops fresh-id copies onto any table. Stored as JSON in
 * localStorage; malformed entries are dropped on load so a corrupt write can
 * never crash the builder.
 */
import type { ScreenElement } from '../../../shared/types';

export interface SavedComponent {
  id: string;
  name: string;
  /** The stored element tree (cloned with fresh ids on save AND on insert). */
  el: ScreenElement;
}

const KEY = 'cardsmith.components.v1';

/** Shallow soundness: a real element has a string id, name and kind. */
function isElementish(v: unknown): v is ScreenElement {
  if (!v || typeof v !== 'object') return false;
  const e = v as ScreenElement;
  return typeof e.id === 'string' && typeof e.name === 'string' && typeof e.kind === 'string';
}

export function loadComponents(): SavedComponent[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((c): c is SavedComponent =>
      c && typeof c.id === 'string' && typeof c.name === 'string' && isElementish(c.el));
  } catch {
    return [];
  }
}

export function persistComponents(list: SavedComponent[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Quota (giant embedded data) — the in-memory list still works this session.
  }
}

/** Append a component, returning the new list (caller persists + re-renders). */
export function addComponent(list: SavedComponent[], id: string, name: string, el: ScreenElement): SavedComponent[] {
  return [...list, { id, name: name.trim() || el.name || 'Component', el }];
}

export function removeComponent(list: SavedComponent[], id: string): SavedComponent[] {
  return list.filter((c) => c.id !== id);
}
