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
 * The working switcher, one click: a wrapper group holding a selector-button
 * row (one `role: 'selector'` button per panel, sharing a fresh
 * selectorGroup) and N empty panel groups bound to their buttons via
 * `showForSelector` — exactly the shape the tabbed-group migration produces,
 * ready to restyle and fill. The first button is the default selection.
 */
export const panelSwitcherPreset: ScreenPreset<PanelSwitcherParams> = {
  id: 'panelSwitcher',
  name: '⧉ Panel switcher',
  hint: 'Selector buttons + panels that swap in place — pick how many and name them',
  params: { count: 3, names: [] },
  build: ({ count, names }) => {
    const n = Math.max(PANEL_SWITCHER_MIN, Math.min(PANEL_SWITCHER_MAX, Math.round(count)));
    // The selectorGroup NAME is fresh per insert so two switchers on one
    // screen never share a radio set.
    const group = uid('switch');
    const buttonIds = Array.from({ length: n }, () => uid('el'));
    const w = round2(100 / n);
    const buttons: ScreenElement[] = buttonIds.map((id, i) => ({
      kind: 'button',
      id,
      name: panelName(names, i),
      rect: { x: round2(i * (100 / n)), y: 0, w, h: 100 },
      actionId: null,
      label: panelName(names, i),
      fontSize: 1.6,
      role: 'selector',
      selectorGroup: group,
    }));
    const panels: ScreenElement[] = buttonIds.map((buttonId, i) => ({
      kind: 'group',
      id: uid('el'),
      name: panelName(names, i),
      rect: { ...PANEL_RECT },
      showForSelector: buttonId,
      children: [],
    }));
    return [{
      kind: 'group',
      id: uid('el'),
      name: 'Panel switcher',
      rect: { x: 20, y: 20, w: 60, h: 60 },
      children: [
        {
          kind: 'group',
          id: uid('el'),
          name: 'Switcher buttons',
          rect: { ...SELBAR_RECT },
          children: buttons,
        },
        ...panels,
      ],
    }];
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** Every shipped preset, in palette order. */
export const SCREEN_PRESETS = [panelSwitcherPreset] as const;
