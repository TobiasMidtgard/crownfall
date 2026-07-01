/**
 * Every built-in example must validate with ZERO errors (and, as authored,
 * zero warnings) and carry stable built-in metadata. The Yu-Gi-Oh duel mat
 * (the showcase screenLayout) additionally gets structural checks: unique
 * stable element ids, buttons bound to real none-target actions, NO deprecated
 * phaseDots anywhere, and a generated phase-track group (one circle per phase
 * wired with Current/Done states).
 */
import { describe, expect, it } from 'vitest';
import type { ScreenElement } from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import { validateGameDef } from '../shared/validate';
import { exampleGames } from './index';
import { ygoGame } from './ygo';

const cases = exampleGames.map((def) => [def.meta.name, def] as const);

describe('example game validation', () => {
  it.each(cases)('%s has zero validation errors', (_name, def) => {
    const errors = validateGameDef(def).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });

  it.each(cases)('%s has zero validation warnings', (_name, def) => {
    // Stricter than required: the shipped examples should be pristine.
    expect(validateGameDef(def)).toEqual([]);
  });

  it('ships the seven examples with stable ids', () => {
    expect(exampleGames.map((g) => g.meta.id)).toEqual([
      'example_war',
      'example_crazy8s',
      'example_hearts',
      'example_clash',
      'example_dominion',
      'example_mtg',
      'example_ygo',
    ]);
  });

  it.each(cases)('%s carries built-in metadata', (_name, def) => {
    expect(def.schemaVersion).toBe(1);
    expect(def.meta.builtIn).toBe(true);
    expect(def.meta.accentColor).toMatch(/^#[0-9a-f]{6}$/i);
    expect(def.meta.description.length).toBeGreaterThan(40);
    expect(def.meta.minPlayers).toBeGreaterThanOrEqual(2);
    expect(def.meta.maxPlayers).toBeGreaterThanOrEqual(def.meta.minPlayers);
  });
});

/** Every element in the tree, groups included (depth-first). */
function flattenElements(elements: ScreenElement[]): ScreenElement[] {
  return elements.flatMap((el) => (
    el.kind === 'group' ? [el, ...flattenElements(el.children)] : [el]
  ));
}

describe('Yu-Gi-Oh duel mat (screenLayout)', () => {
  const layout = ygoGame.screenLayout;
  const els = layout ? flattenElements(layout.elements) : [];

  it('ships a screen layout that validates with zero errors and zero warnings', () => {
    expect(layout).toBeTruthy();
    expect(layout!.elements.length).toBeGreaterThan(0);
    expect(validateGameDef(ygoGame)).toEqual([]);
  });

  /** The generated phase-track group (stable id; children carry uid() ids). */
  function track(): Extract<ScreenElement, { kind: 'group' }> {
    const el = els.find((e) => e.id === 'ygo_el_phase_track');
    if (!el || el.kind !== 'group') throw new Error('no ygo_el_phase_track group');
    return el;
  }

  it('every element id is unique; authored ids use the stable ygo_el_ prefix', () => {
    const ids = els.map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    // The phase track's CHILDREN come out of the generator with uid() ids —
    // unique within the def but not stable, so they are exempt from the
    // prefix check (and deliberately never hardcoded anywhere).
    const generated = new Set(flattenElements(track().children).map((el) => el.id));
    for (const el of els) {
      if (generated.has(el.id)) continue;
      expect(el.id).toMatch(/^ygo_el_/);
    }
  });

  it('replaces the deprecated phaseDots element entirely', () => {
    expect(JSON.stringify(ygoGame)).not.toContain('phaseDots');
  });

  it('ships a generated phase track: one Current/Done circle per phase, linked', () => {
    const children = track().children;
    const dots = children.filter(
      (el): el is Extract<ScreenElement, { kind: 'shape' }> => el.kind === 'shape',
    );
    // One circle per phase, in turn order, each wired Current -> Done.
    expect(dots.map((d) => d.name)).toEqual(ygoGame.phases.map((p) => `${p.name} dot`));
    for (const dot of dots) {
      expect(dot.shape).toBe('circle');
      expect((dot.states ?? []).map((s) => s.name)).toEqual(['Current', 'Done']);
    }
    // Joined by n-1 connector lines, labeled with the phase names beneath.
    const lines = children.filter((el) => el.kind === 'line');
    expect(lines).toHaveLength(ygoGame.phases.length - 1);
    const labels = children.filter((el) => el.kind === 'text');
    expect(labels.map((l) => l.name)).toEqual(ygoGame.phases.map((p) => `${p.name} label`));
  });

  it('every button binds an existing none-target action (or the built-in pass)', () => {
    const buttons = els.filter(
      (el): el is Extract<ScreenElement, { kind: 'button' }> => el.kind === 'button',
    );
    // To battle / End turn / Pass at minimum.
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    for (const b of buttons) {
      expect(b.actionId, `button "${b.name}" is decorative`).not.toBeNull();
      if (b.actionId === PASS_ACTION_ID) continue;
      const action = ygoGame.actions.find((a) => a.id === b.actionId);
      expect(action, `button "${b.name}" -> ${b.actionId}`).toBeDefined();
      expect(action!.target.kind).toBe('none');
    }
  });

  it('covers both duelists: every per-player zone shows for viewer and opp1 only', () => {
    const zoneEls = els.filter(
      (el): el is Extract<ScreenElement, { kind: 'zone' }> => el.kind === 'zone',
    );
    // 5 zones x 2 seats = the full mat (deck/hand/monsters/spelltrap/grave).
    expect(zoneEls).toHaveLength(10);
    const seats = new Set(zoneEls.map((el) => el.seat));
    // A 2-player duel: opp2/opp3 (and 'shared') never appear.
    expect([...seats].sort()).toEqual(['opp1', 'viewer']);
    for (const zid of ygoGame.zones.map((z) => z.id)) {
      expect(zoneEls.filter((el) => el.zoneId === zid).map((el) => el.seat).sort())
        .toEqual(['opp1', 'viewer']);
    }
  });
});
