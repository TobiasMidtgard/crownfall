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
  PANEL_SWITCHER_MAX, PANEL_SWITCHER_MIN, SCREEN_PRESETS, panelName, panelSwitcherPreset,
} from './presets';

type GroupEl = Extract<ScreenElement, { kind: 'group' }>;
type ButtonEl = Extract<ScreenElement, { kind: 'button' }>;

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
  it('builds one wrapper: a selector-button row + one bound EMPTY panel per button', () => {
    const els = panelSwitcherPreset.build({ count: 3, names: ['Treasury', 'Victory', 'Kingdom'] });
    expect(els).toHaveLength(1);
    const wrapper = els[0] as GroupEl;
    expect(wrapper.kind).toBe('group');
    expect(wrapper.children).toHaveLength(4); // button row + 3 panels

    const bar = wrapper.children[0] as GroupEl;
    expect(bar.kind).toBe('group');
    expect(bar.rect).toEqual({ x: 0, y: 0, w: 100, h: 12 });
    const buttons = bar.children as ButtonEl[];
    expect(buttons).toHaveLength(3);
    const group = buttons[0].selectorGroup;
    expect(group).toBeTruthy();
    for (const [i, b] of buttons.entries()) {
      expect(b.kind).toBe('button');
      expect(b.role).toBe('selector');
      expect(b.selectorGroup).toBe(group); // ONE radio set
      expect(b.actionId).toBeNull(); // never a game action
      expect(b.label).toBe(['Treasury', 'Victory', 'Kingdom'][i]);
    }

    const panels = wrapper.children.slice(1) as GroupEl[];
    for (const [i, p] of panels.entries()) {
      expect(p.kind).toBe('group');
      expect(p.children).toEqual([]); // ready to fill
      expect(p.rect).toEqual({ x: 0, y: 12, w: 100, h: 88 });
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
    const groupOf = (els: ScreenElement[]) =>
      ((els[0] as GroupEl).children[0] as GroupEl).children
        .map((btn) => (btn as ButtonEl).selectorGroup)[0];
    expect(groupOf(a)).not.toBe(groupOf(b)); // two switchers never share a radio set
  });

  it('clamps the count to 2-6 and falls back to "Panel N" names', () => {
    const one = panelSwitcherPreset.build({ count: 1, names: [] });
    expect(((one[0] as GroupEl).children[0] as GroupEl).children).toHaveLength(2);
    const many = panelSwitcherPreset.build({ count: 99, names: [] });
    expect(((many[0] as GroupEl).children[0] as GroupEl).children).toHaveLength(6);
    const named = panelSwitcherPreset.build({ count: 3, names: ['Left', '  '] });
    const labels = ((named[0] as GroupEl).children[0] as GroupEl).children
      .map((btn) => (btn as ButtonEl).label);
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
