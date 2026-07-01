import { describe, expect, it } from 'vitest';
import { phaseTrackGroup } from './screenTemplates';
import { migrateGameDef } from './migrate';
import { validateGameDef } from './validate';
import { newGameDef, newPhase } from './defaults';
import type { GameDef, ScreenElement } from './types';

function threePhaseDef(): GameDef {
  const def = newGameDef('Track test');
  def.phases = [
    { ...newPhase(), id: 'ph_a', name: 'Draw' },
    { ...newPhase(), id: 'ph_b', name: 'Main' },
    { ...newPhase(), id: 'ph_c', name: 'Battle' },
  ];
  return def;
}

describe('phaseTrackGroup', () => {
  it('builds one stateful circle per phase, joined by reactive lines', () => {
    const def = threePhaseDef();
    const track = phaseTrackGroup(def, { rect: { x: 10, y: 40, w: 80, h: 12 } })!;
    expect(track.kind).toBe('group');
    const children = (track as Extract<ScreenElement, { kind: 'group' }>).children;
    const shapes = children.filter((c) => c.kind === 'shape');
    const lines = children.filter((c) => c.kind === 'line');
    const labels = children.filter((c) => c.kind === 'text');
    expect(shapes).toHaveLength(3);
    expect(lines).toHaveLength(2);
    expect(labels.map((l) => (l as Extract<ScreenElement, { kind: 'text' }>).text)).toEqual(['Draw', 'Main', 'Battle']);
    // Each dot: Current (==) then Done (>) states reading phaseIndex/phasePos.
    for (const s of shapes) {
      expect(s.states).toHaveLength(2);
      expect(JSON.stringify(s.states)).toContain('"phaseIndex"');
      expect(JSON.stringify(s.states)).toContain('"phasePos"');
    }
    // The whole thing validates inside the def.
    def.screenLayout = { elements: [track] };
    expect(validateGameDef(def).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('returns null for a def with no phases', () => {
    const def = threePhaseDef();
    def.phases = [];
    expect(phaseTrackGroup(def, { rect: { x: 0, y: 0, w: 50, h: 10 } })).toBeNull();
  });
});

describe('phaseDots migration', () => {
  it('replaces phaseDots (even nested) with a phase-track group, keeping id/visibility', () => {
    const def = threePhaseDef();
    def.screenLayout = {
      elements: [{
        kind: 'group',
        id: 'g1',
        name: 'HUD',
        rect: { x: 0, y: 0, w: 100, h: 20 },
        // A legacy phaseDots element as persisted by the removed schema —
        // structurally cast since the kind no longer exists in the union.
        children: [{
          kind: 'phaseDots',
          id: 'pd1',
          name: 'Phases',
          rect: { x: 20, y: 0, w: 60, h: 100 },
          showNames: true,
          visible: { kind: 'bool', value: true },
        } as unknown as ScreenElement],
      }],
    };
    const out = migrateGameDef(def);
    const hud = out.screenLayout!.elements[0] as Extract<ScreenElement, { kind: 'group' }>;
    const replaced = hud.children[0];
    expect(replaced.kind).toBe('group');
    expect(replaced.id).toBe('pd1');
    expect(replaced.name).toBe('Phases');
    expect(replaced.visible).toEqual({ kind: 'bool', value: true });
    expect(JSON.stringify(out)).not.toContain('phaseDots');
  });
});
