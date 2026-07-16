/**
 * components — the designer's per-device localStorage: a library of reusable
 * screen elements (the author saves a styled element with its whole subtree
 * from the inspector; the palette then drops fresh-id copies onto any table),
 * the discarded-layout stash (a safety copy kept when a custom screen is
 * discarded, so "Custom screen" can offer to restore it), and the per-game
 * key sweeper deleteGame runs. Malformed entries are dropped on load so a
 * corrupt write can never crash the builder.
 */
import type { Id, ScreenElement, ScreenLayout } from '../../../shared/types';

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

/** Rename an entry (blank falls back like addComponent), keeping its element. */
export function renameComponent(list: SavedComponent[], id: string, name: string): SavedComponent[] {
  return list.map((c) => (c.id === id ? { ...c, name: name.trim() || c.el.name || 'Component' } : c));
}

/** Replace an entry's stored element (re-save in place), keeping id + name. */
export function updateComponentEl(list: SavedComponent[], id: string, el: ScreenElement): SavedComponent[] {
  return list.map((c) => (c.id === id ? { ...c, el } : c));
}

// ---------------------------------------------------------------------------
// Discarded-layout stash — "Back to the automatic layout?" keeps a device-
// local safety copy, so switching to Custom again can offer to restore it
// ---------------------------------------------------------------------------

const DISCARD_PREFIX = 'cardsmith.discardedLayout.';

/** Keep the layout the author just discarded (best effort — quota may bite). */
export function stashDiscardedLayout(defId: Id, layout: ScreenLayout): void {
  try {
    localStorage.setItem(DISCARD_PREFIX + defId, JSON.stringify(layout));
  } catch {
    // Quota — the discard proceeds; there's just nothing to restore later.
  }
}

/** The stashed layout for a game, or null (never stashed / corrupt write). */
export function loadDiscardedLayout(defId: Id): ScreenLayout | null {
  try {
    const raw = localStorage.getItem(DISCARD_PREFIX + defId);
    if (raw === null) return null;
    const v = JSON.parse(raw) as ScreenLayout;
    if (!v || typeof v !== 'object' || !Array.isArray(v.elements)) return null;
    return v;
  } catch {
    return null;
  }
}

export function clearDiscardedLayout(defId: Id): void {
  try {
    localStorage.removeItem(DISCARD_PREFIX + defId);
  } catch { /* storage unavailable — nothing stashed anyway */ }
}

// ---------------------------------------------------------------------------
// Per-game key sweep (deleteGame)
// ---------------------------------------------------------------------------

/**
 * Remove every per-game designer/runner-preference key this device holds for
 * `defId`: selector choices (cardsmith.sel.<defId>.*), collapsed panels
 * (cardsmith.collapse.<defId>.*) and the discarded-layout stash. The store's
 * deleteGame calls this so deleted (and clone-abandoned) games stop accreting
 * orphaned keys against the quota. The component library is device-global by
 * design and is never swept.
 */
export function clearDesignerKeysForGame(defId: Id): void {
  const prefixes = [`cardsmith.sel.${defId}.`, `cardsmith.collapse.${defId}.`];
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== null && (prefixes.some((p) => k.startsWith(p)) || k === DISCARD_PREFIX + defId)) {
        doomed.push(k);
      }
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch { /* storage unavailable — nothing to sweep */ }
}
