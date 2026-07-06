/**
 * Palette presets: the typed registry shape, the Panel switcher's structure
 * (selector row + showForSelector-bound empty panels, fresh ids per build,
 * count clamping, name fallbacks) and the plan's gate — preset output passes
 * validateGameDef with zero errors (and zero selector warnings) on a fresh
 * def.
 */
import { describe, expect, it } from 'vitest';
import type { GameDef, ScreenElement } from '../../../shared/types';
import { newGameDef } from '../../../shared/defaults';
import { validateGameDef } from '../../../shared/validate';
import { selectorContextFrom, selectorGateOpen } from '../../../runner/layout';
import {
  PANEL_SWITCHER_MAX, PANEL_SWITCHER_MIN, SCREEN_PRESETS, columnPreset, gridPreset, panelName,
  panelSwitcherPreset, rowPreset,
} from './presets';

type GroupEl = Extract<ScreenElement, { kind: 'group' }>;
type ButtonEl = Extract<ScreenElement, { kind: 'button' }>;
type PanelSwitcherEl = Extract<ScreenElement, { kind: 'panelSwitcher' }>;

/** The tab buttons / content panels of a built panelSwitcher, by slotId. */
function tabsOf(ps: PanelSwitcherEl): ButtonEl[] {
  return ps.children.filter((c): c is ButtonEl => c.slotId === 'tabs' && c.kind === 'button');
}
function panelsOf(ps: PanelSwitcherEl): GroupEl[] {
  return ps.children.filter((c): c is GroupEl => c.slotId === 'content' && c.kind === 'group');
}

/** All ids in a tree (uniqueness / freshness checks). */
function allIds(elements: readonly ScreenElement[]): string[] {
  const out: string[] = [];
  const walk = (els: readonly ScreenElement[]) => {
    for (const el of els) {
      out.push(el.id);
      if (el.children) walk(el.children);
    }
  };
  walk(elements);
  return out;
}

describe('preset registry', () => {
  it('lists the Panel switcher with the { id, name, params, build } shape', () => {
    expect(SCREEN_PRESETS.length).toBeGreaterThan(0);
    for (const p of SCREEN_PRESETS) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.name).toBe('string');
      expect(typeof p.hint).toBe('string');
      expect(typeof p.build).toBe('function');
    }
    expect(SCREEN_PRESETS.map((p) => p.id)).toContain('panelSwitcher');
    expect(panelSwitcherPreset.params.count).toBeGreaterThanOrEqual(PANEL_SWITCHER_MIN);
    expect(panelSwitcherPreset.params.count).toBeLessThanOrEqual(PANEL_SWITCHER_MAX);
  });
});

describe('panel switcher preset', () => {
  it('builds one panelSwitcher: tabs slot (selector buttons) + content slot (bound empty panels)', () => {
    const els = panelSwitcherPreset.build({ count: 3, names: ['Treasury', 'Victory', 'Kingdom'] });
    expect(els).toHaveLength(1);
    const ps = els[0] as PanelSwitcherEl;
    expect(ps.kind).toBe('panelSwitcher');
    expect(ps.slots.map((s) => s.id)).toEqual(['tabs', 'content']);
    expect(ps.slots[0].accepts).toEqual(['button']);
    expect(ps.slots[0].layout.mode).toBe('row');

    const buttons = tabsOf(ps);
    expect(buttons).toHaveLength(3);
    const group = buttons[0].selectorGroup;
    expect(group).toBeTruthy();
    expect(ps.selectorGroup).toBe(group); // the container shares its tabs' radio set
    for (const [i, b] of buttons.entries()) {
      expect(b.role).toBe('selector');
      expect(b.selectorGroup).toBe(group); // ONE radio set
      expect(b.actionId).toBeNull(); // never a game action
      expect(b.slotId).toBe('tabs');
      expect(b.label).toBe(['Treasury', 'Victory', 'Kingdom'][i]);
    }

    const panels = panelsOf(ps);
    expect(panels).toHaveLength(3);
    for (const [i, p] of panels.entries()) {
      expect(p.children).toEqual([]); // ready to fill
      expect(p.slotId).toBe('content');
      expect(p.showForSelector).toBe(buttons[i].id);
      expect(p.name).toBe(buttons[i].label);
    }

    // The gates behave: exactly the selected button's panel shows.
    const ctx = selectorContextFrom(els, () => buttons[1].id);
    expect(panels.map((p) => selectorGateOpen(ctx, p))).toEqual([false, true, false]);
  });

  it('stamps FRESH ids and a fresh selector group on every build', () => {
    const a = panelSwitcherPreset.build(panelSwitcherPreset.params);
    const b = panelSwitcherPreset.build(panelSwitcherPreset.params);
    const idsA = allIds(a);
    const idsB = allIds(b);
    expect(new Set(idsA).size).toBe(idsA.length); // unique within a build
    expect(idsA.filter((id) => idsB.includes(id))).toEqual([]); // disjoint across builds
    const groupOf = (els: ScreenElement[]) => (els[0] as PanelSwitcherEl).selectorGroup;
    expect(groupOf(a)).not.toBe(groupOf(b)); // two switchers never share a radio set
  });

  it('clamps the count to 2-6 and falls back to "Panel N" names', () => {
    const one = panelSwitcherPreset.build({ count: 1, names: [] });
    expect(tabsOf(one[0] as PanelSwitcherEl)).toHaveLength(2);
    const many = panelSwitcherPreset.build({ count: 99, names: [] });
    expect(tabsOf(many[0] as PanelSwitcherEl)).toHaveLength(6);
    const named = panelSwitcherPreset.build({ count: 3, names: ['Left', '  '] });
    const labels = tabsOf(named[0] as PanelSwitcherEl).map((b) => b.label);
    expect(labels).toEqual(['Left', 'Panel 2', 'Panel 3']);
    expect(panelName([], 4)).toBe('Panel 5');
  });

  it('output passes validateGameDef cleanly on a fresh def', () => {
    const def: GameDef = {
      ...newGameDef('Preset test'),
      screenLayout: {
        aspect: null,
        elements: panelSwitcherPreset.build({ count: 4, names: ['A', 'B', 'C', 'D'] }),
      },
    };
    const issues = validateGameDef(def);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    // No selector-related warnings either — the preset is wired correctly.
    expect(issues.filter((i) => /selector|show only for/i.test(i.message))).toEqual([]);
  });
});

describe('flow container presets (Grid / Row / Column)', () => {
  const validatesClean = (els: ScreenElement[]) => {
    const def: GameDef = { ...newGameDef('Flow test'), screenLayout: { aspect: null, elements: els } };
    expect(validateGameDef(def).filter((i) => i.severity === 'error')).toEqual([]);
  };

  it('grid builds an empty grid group and validates clean', () => {
    const els = gridPreset.build({ columns: 4 });
    expect(els).toHaveLength(1);
    const g = els[0] as GroupEl;
    expect(g.kind).toBe('group');
    expect(g.children).toEqual([]);
    expect(g.layout?.mode).toBe('grid');
    expect(g.layout?.columns).toBe(4);
    validatesClean(els);
  });

  it('row builds an empty row group and validates clean', () => {
    const els = rowPreset.build({ gap: 3 });
    const g = els[0] as GroupEl;
    expect(g.layout?.mode).toBe('row');
    expect(g.layout?.gap).toBe(3);
    expect(g.children).toEqual([]);
    validatesClean(els);
  });

  it('column builds an empty column group and validates clean', () => {
    const els = columnPreset.build({ gap: 1.5 });
    const g = els[0] as GroupEl;
    expect(g.layout?.mode).toBe('column');
    expect(g.layout?.gap).toBe(1.5);
    validatesClean(els);
  });

  it('grid clamps columns to at least 1 and stamps fresh ids', () => {
    expect((gridPreset.build({ columns: 0 })[0] as GroupEl).layout?.columns).toBe(1);
    const a = rowPreset.build({ gap: 2 })[0].id;
    const b = rowPreset.build({ gap: 2 })[0].id;
    expect(a).not.toBe(b);
  });

  it('the registry lists all four presets in palette order', () => {
    expect(SCREEN_PRESETS.map((p) => p.id)).toEqual(['panelSwitcher', 'grid', 'row', 'column']);
  });
});
