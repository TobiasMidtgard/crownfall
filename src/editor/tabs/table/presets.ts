/**
 * presets — the palette's INSERT PRESETS: parameterized factories producing
 * ready-made element assemblies with fresh ids on every build. The registry
 * is typed so later presets (harbor row, phase seal, counter strip) join
 * without editor surgery: add an entry here, give it a param dialog in
 * Palette (or reuse a generic one) and it appears in the Presets section.
 * Pure — no React, no def mutation; the caller inserts the returned
 * elements. Every preset's output must pass validateGameDef with zero
 * errors on a fresh def (pinned in presets.test.ts).
 */
import type { ScreenElement } from '../../../shared/types';
import { uid } from '../../../shared/defaults';

/** One palette preset: `build` stamps FRESH ids on every call. */
export interface ScreenPreset<P> {
  id: string;
  /** Palette entry label. */
  name: string;
  /** Palette entry tooltip. */
  hint: string;
  /** Default parameters (the insert dialog seeds from these). */
  params: P;
  /** Fresh, self-contained elements ready to insert (new uids per call). */
  build: (params: P) => ScreenElement[];
}

// ---------------------------------------------------------------------------
// Panel switcher — N selector buttons + N bound (empty) panels
// ---------------------------------------------------------------------------

export interface PanelSwitcherParams {
  /** How many panels (clamped to 2–6). */
  count: number;
  /** Panel names; missing entries fall back to "Panel N". */
  names: string[];
}

export const PANEL_SWITCHER_MIN = 2;
export const PANEL_SWITCHER_MAX = 6;

/** The generated button row's slice of the wrapper (top, 12% tall). */
const SELBAR_RECT = { x: 0, y: 0, w: 100, h: 12 };
/** Each panel fills the wrapper under the button row (mirrors migration). */
const PANEL_RECT = { x: 0, y: 12, w: 100, h: 88 };

const round2 = (v: number) => Math.round(v * 100) / 100;

export function panelName(names: readonly string[], i: number): string {
  const raw = names[i];
  return raw !== undefined && raw.trim() !== '' ? raw.trim() : `Panel ${i + 1}`;
}

/**
 * The working switcher, one click: a `panelSwitcher` container with two typed
 * slots — `tabs` (a row FlowLayout that auto-spaces one `role: 'selector'`
 * button per panel, sharing a fresh selectorGroup) and `content` (the bound
 * panels, gated by `showForSelector`). The runner renders it over the existing
 * selector gate — the buttons and panels are REAL selector/showForSelector
 * elements — so exactly one panel shows. The first button is the default.
 */
export const panelSwitcherPreset: ScreenPreset<PanelSwitcherParams> = {
  id: 'panelSwitcher',
  name: '⧉ Panel switcher',
  hint: 'Tabs that swap panels in place — pick how many and name them',
  params: { count: 3, names: [] },
  build: ({ count, names }) => {
    const n = Math.max(PANEL_SWITCHER_MIN, Math.min(PANEL_SWITCHER_MAX, Math.round(count)));
    // The selectorGroup NAME is fresh per insert so two switchers on one
    // screen never share a radio set.
    const selectorGroup = uid('switch');
    const tabIds = Array.from({ length: n }, () => uid('el'));
    const tabs: ScreenElement[] = tabIds.map((id, i) => ({
      kind: 'button',
      id,
      name: panelName(names, i),
      // Position within the tabs slot is flow-driven; rect is only the basis.
      rect: { x: 0, y: 0, w: round2(100 / n), h: 100 },
      actionId: null,
      label: panelName(names, i),
      fontSize: 1.6,
      role: 'selector',
      selectorGroup,
      slotId: 'tabs',
    }));
    const panels: ScreenElement[] = tabIds.map((tabId, i) => ({
      kind: 'group',
      id: uid('el'),
      name: panelName(names, i),
      rect: { ...PANEL_RECT },
      showForSelector: tabId,
      slotId: 'content',
      children: [],
    }));
    return [{
      kind: 'panelSwitcher',
      id: uid('el'),
      name: 'Panel switcher',
      rect: { x: 20, y: 20, w: 60, h: 60 },
      selectorGroup,
      slots: [
        { id: 'tabs', name: 'Tabs', accepts: ['button'], rect: { ...SELBAR_RECT }, layout: { mode: 'row', itemSize: 'uniform' } },
        { id: 'content', name: 'Content', single: true, rect: { ...PANEL_RECT }, layout: { mode: 'column' } },
      ],
      children: [...tabs, ...panels],
    }];
  },
};

// ---------------------------------------------------------------------------
// Flow containers — Grid / Row / Column (empty groups pre-seeded with a layout)
// ---------------------------------------------------------------------------

export const gridPreset: ScreenPreset<{ columns: number }> = {
  id: 'grid',
  name: '▦ Grid',
  hint: 'Auto-spacing grid — set the number of columns',
  params: { columns: 3 },
  build: ({ columns }) => [{
    kind: 'group', id: uid('el'), name: 'Grid',
    rect: { x: 20, y: 20, w: 60, h: 40 },
    layout: { mode: 'grid', columns: Math.max(1, Math.round(columns)), gap: 2, padding: 1 },
    children: [],
  }],
};

export const rowPreset: ScreenPreset<{ gap: number }> = {
  id: 'row',
  name: '▭ Row',
  hint: 'Horizontal auto-spacing row',
  params: { gap: 2 },
  build: ({ gap }) => [{
    kind: 'group', id: uid('el'), name: 'Row',
    rect: { x: 20, y: 42, w: 60, h: 14 },
    layout: { mode: 'row', gap, padding: 1 },
    children: [],
  }],
};

export const columnPreset: ScreenPreset<{ gap: number }> = {
  id: 'column',
  name: '▯ Column',
  hint: 'Vertical auto-spacing column',
  params: { gap: 2 },
  build: ({ gap }) => [{
    kind: 'group', id: uid('el'), name: 'Column',
    rect: { x: 40, y: 20, w: 20, h: 50 },
    layout: { mode: 'column', gap, padding: 1 },
    children: [],
  }],
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Every shipped preset, in palette order. */
export const SCREEN_PRESETS = [panelSwitcherPreset, gridPreset, rowPreset, columnPreset] as const;
