/**
 * Banner theme + calm mode. localStorage keys and shapes are the original
 * hall's ('crownfall.theme' JSON string, absent = crimson; 'crownfall.calm'
 * JSON boolean) so existing browsers keep their hangings. Applied to <html>
 * on module load — data-theme drives the :root token overrides in
 * crownfall.css, and the calm class stills embers/tilt/reveal/animations.
 */
import { useSyncExternalStore } from 'react';

export type HallTheme = 'crimson' | 'aurum' | 'verdant' | 'azure' | 'umbral';

const THEME_KEY = 'crownfall.theme';
const CALM_KEY = 'crownfall.calm';
const BANNERS: HallTheme[] = ['aurum', 'verdant', 'azure', 'umbral'];

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

let theme: HallTheme = (() => {
  const raw = read(THEME_KEY);
  if (!raw) return 'crimson';
  try {
    const parsed = JSON.parse(raw) as unknown;
    return BANNERS.includes(parsed as HallTheme) ? (parsed as HallTheme) : 'crimson';
  } catch { return 'crimson'; }
})();

let calm: boolean = (() => {
  const raw = read(CALM_KEY);
  if (!raw) return false;
  try { return !!JSON.parse(raw); } catch { return false; }
})();

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

function apply() {
  const rootEl = document.documentElement;
  if (theme === 'crimson') rootEl.removeAttribute('data-theme');
  else rootEl.setAttribute('data-theme', theme);
  rootEl.classList.toggle('calm', calm);
}

// the hangings greet every visitor: applied at load, not first render
apply();

export function getTheme(): HallTheme { return theme; }
export function useTheme(): HallTheme {
  return useSyncExternalStore(subscribe, getTheme);
}
export function setTheme(next: HallTheme) {
  theme = next;
  // crimson is the hall's own color: absence of the key, not a value
  write(THEME_KEY, next === 'crimson' ? null : JSON.stringify(next));
  apply();
  emit();
}

export function getCalm(): boolean { return calm; }
export function useCalm(): boolean {
  return useSyncExternalStore(subscribe, getCalm);
}
export function setCalm(on: boolean) {
  calm = on;
  write(CALM_KEY, JSON.stringify(on));
  apply();
  emit();
}
