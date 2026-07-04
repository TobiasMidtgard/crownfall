/**
 * Tests for the screen builder's pure model: the starter layout generator,
 * group/ungroup rect conversion (on-screen positions preserved), sibling
 * reorder (layers ▲▼ / drag), the shape/line/phase-track factories, element
 * STATE helpers (add/remove/reorder + the editor preview merge), inline
 * zone/variable/action creation, reparenting, align/distribute, and the deck
 * helpers carried over from v3.
 */
import { describe, expect, it } from 'vitest';
import type {
  ActionDef, DeckDef, ElementState, Expr, GameDef, PhaseDef, ScreenElement, ScreenLayout,
  VariableDef, ZoneDef,
} from '../../../shared/types';
import { newGameDef } from '../../../shared/defaults';
import { harness, makeDef, zone } from '../../../engine/testkit';
import {
  MOTION_DEFAULTS, PHONE_ASPECT, addElementState, alignElements, applyElementState,
  buildStarterLayout, cloneElementsWithNewIds, createMobileVariant, deckCardCount,
  deepestGroupAt, deleteMobileVariant, distributeElements, findEl, groupSiblings,
  indexElements, insertIntoFocusedChildren, makeActionDef, makeVariableDef, makeZoneDef,
  moveElementState, newCustomDeckAt, newElementState, newLineElement, newLogElement,
  newPhaseTrackElement, newShapeElement, patchMobileVariant, patchMotion, pathToEl,
  placeRelativeEl, previewShownMap, pruneNested, removeElementState, removeEls,
  reorderSibling, reparentEl, resolveDropParent, selectorButtonOptions, selectorHiddenIds, setTextDynamic,
  siblingsOf, snapStep,
  templateFieldOptions, ungroupEl, updateEl, updateElementState, validFocusPath,
  variantElements, withDescendants, withVariantElements, writeSelection,
} from './screenModel';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

function el(id: string, r = rect(10, 10, 20, 10)): ScreenElement {
  return { kind: 'text', id, name: id, rect: r, text: id, fontSize: 2, align: 'center' };
}

function grp(id: string, r: { x: number; y: number; w: number; h: number }, children: ScreenElement[]): ScreenElement {
  return { kind: 'group', id, name: id, rect: r, children };
}

function richDef(): GameDef {
  const base = newGameDef('Screen test'); // shared Deck + Discard, perPlayer Hand
  const none1: ActionDef = { id: 'a1', name: 'End turn', target: { kind: 'none' }, legality: null, script: [] };
  const targeted: ActionDef = {
    id: 'a2', name: 'Play card', target: { kind: 'cardInZone', zoneId: base.zones[1].id, ownerOnly: true }, legality: null, script: [],
  };
  const none2: ActionDef = { id: 'a3', name: 'Knock', target: { kind: 'none' }, legality: null, script: [] };
  const none3: ActionDef = { id: 'a4', name: 'Surrender', target: { kind: 'none' }, legality: null, script: [] };
  const score: VariableDef = { id: 'v1', name: 'Score', scope: 'perPlayer', type: 'number', initial: 0 };
  const pot: VariableDef = { id: 'v2', name: 'Pot', scope: 'global', type: 'number', initial: 0 };
  const motto: VariableDef = { id: 'v3', name: 'Motto', scope: 'perPlayer', type: 'string', initial: '' };
  return { ...base, actions: [none1, targeted, none2, none3], variables: [score, pot, motto] };
}

// ---------------------------------------------------------------------------
// Starter layout generator
// ---------------------------------------------------------------------------

describe('buildStarterLayout', () => {
  const def = richDef();
  const layout = buildStarterLayout(def);
  const els = layout.elements;
  const zones = els.filter((e): e is Extract<ScreenElement, { kind: 'zone' }> => e.kind === 'zone');

  it('places shared zones in the middle band, seat "shared"', () => {
    const shared = zones.filter((z) => z.seat === 'shared');
    expect(shared.map((z) => z.zoneId).sort()).toEqual(
      def.zones.filter((z) => z.owner === 'shared').map((z) => z.id).sort(),
    );
    for (const z of shared) {
      expect(z.rect.y).toBeGreaterThanOrEqual(26);
      expect(z.rect.y + z.rect.h).toBeLessThanOrEqual(62);
    }
  });

  it('gives per-player zones a viewer copy (bottom) and a compact opp1 copy (top)', () => {
    const hand = def.zones.find((z) => z.owner === 'perPlayer')!;
    const copies = zones.filter((z) => z.zoneId === hand.id);
    expect(copies.map((c) => c.seat).sort()).toEqual(['opp1', 'viewer']);
    const viewer = copies.find((c) => c.seat === 'viewer')!;
    const opp = copies.find((c) => c.seat === 'opp1')!;
    expect(viewer.rect.y).toBeGreaterThanOrEqual(65);
    expect(opp.rect.y + opp.rect.h).toBeLessThanOrEqual(25);
    expect((opp.cardScale ?? 8)).toBeLessThan(viewer.cardScale ?? 8);
  });

  it('adds a generated phase track top-center (never the deprecated phaseDots)', () => {
    expect(JSON.stringify(els)).not.toContain('phaseDots');
    const tracks = els.filter(
      (e): e is Extract<ScreenElement, { kind: 'group' }> => e.kind === 'group' && e.name === 'Phase track',
    );
    expect(tracks).toHaveLength(1);
    expect(tracks[0].rect.x + tracks[0].rect.w / 2).toBe(50);
    expect(tracks[0].rect.y).toBeLessThan(8);
    // One wired dot per phase (the base def has its single Main phase).
    expect(tracks[0].children.filter((c) => c.kind === 'shape')).toHaveLength(def.phases.length);
  });

  it('adds a bottom-right button per none-target action, max 2', () => {
    const buttons = els.filter((e): e is Extract<ScreenElement, { kind: 'button' }> => e.kind === 'button');
    expect(buttons).toHaveLength(2);
    expect(buttons.map((b) => b.actionId)).toEqual(['a1', 'a3']); // first two none-target, a2 skipped
    for (const b of buttons) {
      expect(b.rect.x).toBeGreaterThanOrEqual(80);
      expect(b.rect.y).toBeGreaterThanOrEqual(75);
    }
  });

  it('adds varText pairs for perPlayer NUMBER vars only (viewer bottom-left, opp1 top-left)', () => {
    const reads = els.filter((e): e is Extract<ScreenElement, { kind: 'varText' }> => e.kind === 'varText');
    expect(reads).toHaveLength(2); // v1 only — v2 is global, v3 is a string
    expect(reads.every((r) => r.varId === 'v1')).toBe(true);
    const viewer = reads.find((r) => r.seat === 'viewer')!;
    const opp = reads.find((r) => r.seat === 'opp1')!;
    expect(viewer.rect.x).toBeLessThan(10);
    expect(viewer.rect.y).toBeGreaterThan(85);
    expect(opp.rect.x).toBeLessThan(10);
    expect(opp.rect.y).toBeLessThan(10);
  });

  it('produces unique ids and a 16:9 aspect', () => {
    const ids = els.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(layout.aspect).toBeCloseTo(16 / 9);
  });

  it('handles an empty def without exploding', () => {
    const empty = { ...newGameDef('E'), zones: [] as ZoneDef[], actions: [], variables: [] };
    const l = buildStarterLayout(empty);
    expect(l.elements.filter((e) => e.kind === 'zone')).toHaveLength(0);
    // The default def still has its Main phase, so the track appears…
    expect(l.elements.filter((e) => e.kind === 'group' && e.name === 'Phase track')).toHaveLength(1);
    // …while a def WITHOUT phases simply skips it.
    const bare = buildStarterLayout({ ...empty, phases: [] });
    expect(bare.elements.filter((e) => e.kind === 'group')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Shape / line / phase-track factories
// ---------------------------------------------------------------------------

const phase = (id: string, name: string): PhaseDef => ({ id, name, onEnter: [], actionIds: [], mode: 'manual' });

describe('shape / line / phase-track factories', () => {
  it('newShapeElement drops a circle with a subtle border', () => {
    const s = newShapeElement();
    expect(s.kind).toBe('shape');
    if (s.kind !== 'shape') return;
    expect(s.id.startsWith('el_')).toBe(true);
    expect(s.shape).toBe('circle');
    expect(s.style).toMatchObject({ borderColor: 'var(--border-strong)', borderWidth: 2 });
  });

  it('newLineElement drops a horizontal 2px line', () => {
    const l = newLineElement();
    expect(l.kind).toBe('line');
    if (l.kind !== 'line') return;
    expect(l.id.startsWith('el_')).toBe(true);
    expect(l.orient).toBe('h');
    expect(l.thickness).toBe(2);
    expect(l.dashed).toBeUndefined();
    expect(l.style?.borderColor).toBeTruthy(); // the line's color source
  });

  it('newPhaseTrackElement inserts a centered 60×10 group of wired dots + links', () => {
    const def = { ...newGameDef('T'), phases: [phase('pa', 'Draw'), phase('pb', 'Main'), phase('pc', 'End')] };
    const track = newPhaseTrackElement(def);
    expect(track).not.toBeNull();
    if (!track || track.kind !== 'group') throw new Error('expected a group');
    expect(track.rect).toEqual({ x: 20, y: 4, w: 60, h: 10 });
    const shapes = track.children.filter((c) => c.kind === 'shape');
    const lines = track.children.filter((c) => c.kind === 'line');
    expect(shapes).toHaveLength(3); // one circle per phase
    expect(lines).toHaveLength(2); // joined by connector lines
    // Dots are pre-wired with Current/Done states; links with a Reached state.
    expect(shapes.every((c) => (c.states ?? []).length === 2)).toBe(true);
    expect(lines.every((c) => (c.states ?? []).length === 1)).toBe(true);
  });

  it('newPhaseTrackElement is null when the def has no phases (palette disables it)', () => {
    expect(newPhaseTrackElement({ ...newGameDef('T'), phases: [] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Element states (conditional appearances; first match wins)
// ---------------------------------------------------------------------------

const st = (id: string): ElementState => ({ id, name: id, when: { kind: 'bool', value: true } });

describe('element state helpers', () => {
  const base = el('subject');

  it('newElementState: uid id and the canonical "my turn" condition', () => {
    const s = newElementState();
    expect(s.id.startsWith('st_')).toBe(true);
    expect(s.when).toEqual({
      kind: 'compare', op: '==',
      left: { kind: 'currentPlayer' },
      right: { kind: 'binding', name: '$viewer' },
    });
    expect(s.style).toBeUndefined();
    expect(s.rect).toBeUndefined();
  });

  it('add appends in priority order; remove drops the key when none remain', () => {
    const two = addElementState(addElementState(base, st('a')), st('b'));
    expect(two.states!.map((s) => s.id)).toEqual(['a', 'b']);
    const one = removeElementState(two, 'a');
    expect(one.states!.map((s) => s.id)).toEqual(['b']);
    const none = removeElementState(one, 'b');
    expect('states' in none).toBe(false);
  });

  it('move swaps with the list neighbor and no-ops at the edges', () => {
    const three = { ...base, states: [st('a'), st('b'), st('c')] };
    expect(moveElementState(three, 'c', 'up').states!.map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(moveElementState(three, 'a', 'down').states!.map((s) => s.id)).toEqual(['b', 'a', 'c']);
    expect(moveElementState(three, 'a', 'up')).toBe(three);
    expect(moveElementState(three, 'c', 'down')).toBe(three);
    expect(moveElementState(three, 'ghost', 'up')).toBe(three);
  });

  it('update patches exactly one state, immutably', () => {
    const two = { ...base, states: [st('a'), st('b')] };
    const next = updateElementState(two, 'b', (s) => ({ ...s, name: 'Renamed' }));
    expect(next.states![1].name).toBe('Renamed');
    expect(next.states![0]).toBe(two.states![0]);
    expect(updateElementState(two, 'ghost', (s) => ({ ...s, name: 'X' }))).toBe(two);
  });

  it('applyElementState merges the state style OVER the base and swaps the rect', () => {
    const subject: ScreenElement = {
      ...base,
      style: { background: 'red', borderWidth: 1 },
      states: [{
        id: 'x', name: 'X',
        when: { kind: 'bool', value: true },
        style: { background: 'blue' },
        rect: { x: 1, y: 2, w: 3, h: 4 },
      }, {
        id: 'y', name: 'Y',
        when: { kind: 'bool', value: true },
      }],
    };
    const on = applyElementState(subject, 'x');
    expect(on.style).toEqual({ background: 'blue', borderWidth: 1 });
    expect(on.rect).toEqual({ x: 1, y: 2, w: 3, h: 4 });
    // A state without overrides previews as the base.
    const plain = applyElementState(subject, 'y');
    expect(plain.style).toBe(subject.style);
    expect(plain.rect).toBe(subject.rect);
    // Null / unknown ids = base appearance.
    expect(applyElementState(subject, null).rect).toBe(subject.rect);
    expect(applyElementState(subject, 'ghost').style).toBe(subject.style);
  });
});

// ---------------------------------------------------------------------------
// Inline variable / action creation (tightly knitted cross-editing)
// ---------------------------------------------------------------------------

describe('makeVariableDef / makeActionDef', () => {
  it('builds a variable with a var_ id and the chosen scope/type/initial', () => {
    const v = makeVariableDef('Mana', 'perPlayer', 'number', 3);
    expect(v.id.startsWith('var_')).toBe(true);
    expect(v).toMatchObject({ name: 'Mana', scope: 'perPlayer', type: 'number', initial: 3 });
    const t = makeVariableDef('   ', 'global', 'string', 'hello');
    expect(t.name).toBe('New variable');
    expect(t).toMatchObject({ scope: 'global', type: 'string', initial: 'hello' });
  });

  it('builds a none-target action ready for a button binding', () => {
    const a = makeActionDef('Knock');
    expect(a.id.startsWith('action_')).toBe(true);
    expect(a.name).toBe('Knock');
    expect(a.target).toEqual({ kind: 'none' });
    expect(a.legality).toBeNull();
    expect(a.script).toEqual([]);
    expect(makeActionDef('  ').name).toBe('New action');
  });
});

// ---------------------------------------------------------------------------
// Group / ungroup rect conversion
// ---------------------------------------------------------------------------

describe('groupSiblings / ungroupEl', () => {
  const a = el('a', rect(10, 10, 20, 10));
  const b = el('b', rect(40, 30, 10, 20));
  const c = el('c', rect(70, 70, 10, 10));

  it('wraps siblings: group takes the bounding box, children stay put on screen', () => {
    const grouped = groupSiblings([a, b, c], ['a', 'b'])!;
    expect(grouped).not.toBeNull();
    const index = indexElements(grouped.elements);
    const g = index.get(grouped.groupId)!;
    expect(g.abs).toEqual(rect(10, 10, 40, 40));
    // On-screen positions unchanged after the relative conversion.
    expect(index.get('a')!.abs).toEqual(rect(10, 10, 20, 10));
    expect(index.get('b')!.abs).toEqual(rect(40, 30, 10, 20));
    // Stored child rects are group-relative.
    const stored = (index.get(grouped.groupId)!.el as Extract<ScreenElement, { kind: 'group' }>).children;
    expect(stored.find((x) => x.id === 'a')!.rect).toEqual(rect(0, 0, 50, 25));
    expect(stored.find((x) => x.id === 'b')!.rect).toEqual(rect(75, 50, 25, 50));
  });

  it('inserts the group where the frontmost member was', () => {
    const grouped = groupSiblings([a, c, b], ['a', 'b'])!;
    expect(grouped.elements.map((e) => e.id)).toEqual(['c', grouped.groupId]);
  });

  it('refuses non-siblings and undersized selections', () => {
    const tree = [grp('g', rect(0, 0, 50, 50), [a]), b];
    expect(groupSiblings(tree, ['a', 'b'])).toBeNull();
    expect(groupSiblings([a, b], ['a'])).toBeNull();
  });

  it('ungroup restores screen-absolute rects in place', () => {
    const grouped = groupSiblings([a, b, c], ['a', 'b'])!;
    // [a, b, c] grouping a+b puts the group at b's (frontmost member) slot: [g, c].
    expect(grouped.elements.map((e) => e.id)).toEqual([grouped.groupId, 'c']);
    const result = ungroupEl(grouped.elements, grouped.groupId)!;
    expect(result.childIds).toEqual(['a', 'b']);
    expect(result.elements.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    const index = indexElements(result.elements);
    expect(index.get('a')!.abs).toEqual(rect(10, 10, 20, 10));
    expect(index.get('b')!.abs).toEqual(rect(40, 30, 10, 20));
  });

  it('group → ungroup round-trips nested groups too', () => {
    const inner = grp('inner', rect(20, 20, 40, 40), [el('x', rect(25, 25, 50, 50))]);
    const grouped = groupSiblings([inner, c], ['inner', 'c'])!;
    const before = indexElements([inner, c]).get('x')!.abs;
    const after = indexElements(grouped.elements).get('x')!.abs;
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    expect(after.w).toBeCloseTo(before.w, 1);
    expect(after.h).toBeCloseTo(before.h, 1);
  });
});

// ---------------------------------------------------------------------------
// Sibling reorder (paint order is back → front = array order)
// ---------------------------------------------------------------------------

describe('reorderSibling / placeRelativeEl', () => {
  const tree = [
    el('a'), el('b'),
    grp('g', rect(0, 0, 60, 60), [el('m1'), el('m2'), el('m3')]),
  ];

  it('swaps with the array neighbor at root level', () => {
    expect(reorderSibling(tree, 'a', 'fwd').map((e) => e.id)).toEqual(['b', 'a', 'g']);
    expect(reorderSibling(tree, 'a', 'back')).toBe(tree); // no-op at the back
    expect(reorderSibling(tree, 'g', 'fwd')).toBe(tree); // no-op at the front
  });

  it('reorders inside a group without touching the root', () => {
    const next = reorderSibling(tree, 'm1', 'fwd');
    const g = next.find((e) => e.id === 'g') as Extract<ScreenElement, { kind: 'group' }>;
    expect(g.children.map((x) => x.id)).toEqual(['m2', 'm1', 'm3']);
    expect(next.map((e) => e.id)).toEqual(['a', 'b', 'g']);
  });

  it('drag-reorder takes the target position (front/behind by approach)', () => {
    expect(placeRelativeEl(tree, 'a', 'g').map((e) => e.id)).toEqual(['b', 'g', 'a']);
    expect(placeRelativeEl(tree, 'g', 'a').map((e) => e.id)).toEqual(['g', 'a', 'b']);
  });

  it('ignores cross-array drops and self-drops', () => {
    expect(placeRelativeEl(tree, 'm1', 'a')).toBe(tree);
    expect(placeRelativeEl(tree, 'a', 'a')).toBe(tree);
  });
});

// ---------------------------------------------------------------------------
// Reparenting (drag into / out of groups)
// ---------------------------------------------------------------------------

describe('reparentEl', () => {
  const tree = [grp('g', rect(50, 50, 50, 50), []), el('a', rect(0, 0, 10, 10))];

  it('drops into a group with a group-relative rect, appended frontmost', () => {
    const next = reparentEl(tree, 'a', 'g', rect(50, 50, 10, 10));
    const g = next.find((e) => e.id === 'g') as Extract<ScreenElement, { kind: 'group' }>;
    expect(g.children.map((x) => x.id)).toEqual(['a']);
    expect(g.children[0].rect).toEqual(rect(0, 0, 20, 20));
    expect(indexElements(next).get('a')!.abs).toEqual(rect(50, 50, 10, 10));
  });

  it('drags out to the screen (root), keeping the on-screen rect', () => {
    const inTree = reparentEl(tree, 'a', 'g', rect(50, 50, 10, 10));
    const out = reparentEl(inTree, 'a', null, rect(20, 20, 10, 10));
    expect(out.map((e) => e.id)).toEqual(['g', 'a']);
    expect(indexElements(out).get('a')!.abs).toEqual(rect(20, 20, 10, 10));
  });

  it('refuses cycles (a group into its own subtree)', () => {
    const nested = [grp('outer', rect(0, 0, 80, 80), [grp('innerG', rect(10, 10, 50, 50), [])])];
    expect(reparentEl(nested, 'outer', 'innerG', rect(0, 0, 40, 40))).toBe(nested);
    expect(reparentEl(nested, 'outer', 'outer', rect(0, 0, 40, 40))).toBe(nested);
  });
});

// ---------------------------------------------------------------------------
// Selection helpers / removal
// ---------------------------------------------------------------------------

describe('removeEls / pruneNested', () => {
  const tree = [grp('g', rect(0, 0, 50, 50), [el('m1'), el('m2')]), el('a')];

  it('removes nested elements and whole subtrees', () => {
    expect(removeEls(tree, new Set(['m1'])).map((e) => e.id)).toEqual(['g', 'a']);
    const gone = removeEls(tree, new Set(['g']));
    expect(gone.map((e) => e.id)).toEqual(['a']);
    expect(indexElements(gone).has('m1')).toBe(false);
  });

  it('pruneNested drops ids whose ancestor is also selected', () => {
    const index = indexElements(tree);
    expect(pruneNested(index, ['g', 'm1', 'a'])).toEqual(['g', 'a']);
  });
});

// ---------------------------------------------------------------------------
// Align / distribute
// ---------------------------------------------------------------------------

describe('alignElements / distributeElements', () => {
  it('aligns lefts in SCREEN space even across parents', () => {
    const tree = [
      grp('g', rect(50, 0, 50, 100), [el('m', rect(0, 0, 20, 10))]), // abs x 50
      el('a', rect(10, 50, 10, 10)),
    ];
    const next = alignElements(tree, ['m', 'a'], 'left');
    const index = indexElements(next);
    expect(index.get('m')!.abs.x).toBe(10);
    expect(index.get('a')!.abs.x).toBe(10);
  });

  it('distributes horizontal gaps equally, outermost staying put', () => {
    const tree = [el('a', rect(0, 0, 10, 10)), el('b', rect(12, 0, 10, 10)), el('c', rect(70, 0, 10, 10))];
    const next = distributeElements(tree, ['a', 'b', 'c'], 'h');
    const index = indexElements(next);
    expect(index.get('a')!.abs.x).toBe(0);
    expect(index.get('b')!.abs.x).toBe(35);
    expect(index.get('c')!.abs.x).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// Inline zone creation
// ---------------------------------------------------------------------------

describe('makeZoneDef', () => {
  it('builds a valid zone with a zone_ id and owner-matched area hint', () => {
    const z = makeZoneDef('Battlefield', 'perPlayer', 'all', 'grid');
    expect(z.id.startsWith('zone_')).toBe(true);
    expect(z).toMatchObject({ name: 'Battlefield', owner: 'perPlayer', visibility: 'all', layout: 'grid', area: 'player' });
    expect(makeZoneDef('Pot', 'shared', 'topCard', 'stack').area).toBe('center');
  });

  it('falls back to a name for whitespace input', () => {
    expect(makeZoneDef('   ', 'shared', 'all', 'row').name).toBe('New zone');
  });
});

// ---------------------------------------------------------------------------
// Deck helpers (carried over from v3) + stepper snap
// ---------------------------------------------------------------------------

describe('deck helpers', () => {
  const base = { id: 'd', name: 'D', initialZone: 'z', shuffle: true };

  it('standard 52 minus exclusions plus jokers', () => {
    const d: DeckDef = { ...base, source: { kind: 'standard52' } };
    expect(deckCardCount(d)).toBe(52);
    expect(deckCardCount({ ...base, source: { kind: 'standard52', jokers: 2, excludeRanks: [2, 3] } }))
      .toBe(52 - 8 + 2);
  });

  it('custom = sum of entry counts', () => {
    expect(deckCardCount({
      ...base,
      source: { kind: 'custom', entries: [{ cardId: 'a', count: 3 }, { cardId: 'b', count: 21 }] },
    })).toBe(24);
  });

  it('newCustomDeckAt spawns empty in the zone', () => {
    const d = newCustomDeckAt('Library', 'z9');
    expect(d.initialZone).toBe('z9');
    expect(d.source).toEqual({ kind: 'custom', entries: [] });
  });
});

describe('snapStep', () => {
  it('snaps to fractional steps without float dust and clamps', () => {
    expect(snapStep(1.26, 0, 10, 0.5)).toBe(1.5);
    expect(snapStep(0.1 + 0.2, 0, 10, 0.5)).toBe(0.5);
    expect(snapStep(99, 0, 10, 0.5)).toBe(10);
    expect(snapStep(-3, 0, 10, 0.5)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Mobile variant (clone with id regeneration, create/delete, scoped edits)
// ---------------------------------------------------------------------------

/** Every element in tree order (depth-first), groups included. */
function flatten(els: ScreenElement[]): ScreenElement[] {
  return els.flatMap((e) => [e, ...(e.kind === 'group' ? flatten(e.children) : [])]);
}

describe('cloneElementsWithNewIds', () => {
  const stateful: ScreenElement = { ...el('m1', rect(5, 5, 30, 20)), states: [st('s1'), st('s2')] };
  const tree: ScreenElement[] = [
    el('a', rect(0, 0, 20, 10)),
    grp('g', rect(10, 10, 60, 60), [stateful, grp('inner', rect(0, 0, 40, 40), [el('x')])]),
  ];

  it('regenerates EVERY element id (nested groups included), uniquely', () => {
    const cloned = cloneElementsWithNewIds(tree);
    const before = flatten(tree).map((e) => e.id);
    const after = flatten(cloned).map((e) => e.id);
    expect(after).toHaveLength(before.length);
    expect(new Set(after).size).toBe(after.length);
    for (const id of after) {
      expect(before).not.toContain(id);
      expect(id.startsWith('el_')).toBe(true);
    }
  });

  it('keeps names, kinds and rects; on-screen geometry is identical', () => {
    const cloned = cloneElementsWithNewIds(tree);
    const a = flatten(tree);
    const b = flatten(cloned);
    expect(b.map((e) => e.name)).toEqual(a.map((e) => e.name));
    expect(b.map((e) => e.kind)).toEqual(a.map((e) => e.kind));
    expect(b.map((e) => e.rect)).toEqual(a.map((e) => e.rect));
    // Rects are fresh objects (no shared references between the trees).
    expect(b[0].rect).not.toBe(a[0].rect);
  });

  it('regenerates state ids too, preserving names and conditions', () => {
    const cloned = cloneElementsWithNewIds(tree);
    const orig = flatten(tree).find((e) => e.name === 'm1')!;
    const copy = flatten(cloned).find((e) => e.name === 'm1')!;
    expect(copy.states).toHaveLength(2);
    expect(copy.states!.map((s) => s.name)).toEqual(orig.states!.map((s) => s.name));
    expect(copy.states!.map((s) => s.when)).toEqual(orig.states!.map((s) => s.when));
    for (let i = 0; i < 2; i++) {
      expect(copy.states![i].id).not.toBe(orig.states![i].id);
      expect(copy.states![i].id.startsWith('st_')).toBe(true);
    }
  });
});

describe('createMobileVariant / deleteMobileVariant', () => {
  const layout: ScreenLayout = {
    aspect: 16 / 9,
    background: 'navy',
    elements: [el('a'), grp('g', rect(0, 0, 50, 50), [el('m')])],
  };

  it('copy: deep-clones the desktop tree with new ids and carries the background', () => {
    const next = createMobileVariant(layout, 'copy');
    expect(next.mobile).toBeDefined();
    expect(next.mobile!.background).toBe('navy');
    expect(next.mobile!.elements).toHaveLength(2);
    expect(flatten(next.mobile!.elements).map((e) => e.name))
      .toEqual(flatten(layout.elements).map((e) => e.name));
    // No id appears in BOTH trees (the validator's per-tree uniqueness).
    const desktopIds = new Set(flatten(next.elements).map((e) => e.id));
    for (const e of flatten(next.mobile!.elements)) expect(desktopIds.has(e.id)).toBe(false);
    // Desktop untouched; no aspect/scroll forced on the new variant.
    expect(next.elements).toBe(layout.elements);
    expect(next.mobile!.aspect).toBeUndefined();
    expect(next.mobile!.scroll).toBeUndefined();
  });

  it('empty: a blank phone page without inherited background', () => {
    const next = createMobileVariant(layout, 'empty');
    expect(next.mobile!.elements).toEqual([]);
    expect(next.mobile!.background).toBeUndefined();
  });

  it('delete removes the mobile key entirely', () => {
    const withMobile = createMobileVariant(layout, 'copy');
    const gone = deleteMobileVariant(withMobile);
    expect('mobile' in gone).toBe(false);
    expect(gone.elements).toBe(layout.elements);
  });
});

describe('variantElements / withVariantElements', () => {
  const layout: ScreenLayout = {
    elements: [el('d1')],
    mobile: { elements: [el('m1')] },
  };

  it('reads the open variant ([] when mobile is absent)', () => {
    expect(variantElements(layout, 'desktop').map((e) => e.id)).toEqual(['d1']);
    expect(variantElements(layout, 'mobile').map((e) => e.id)).toEqual(['m1']);
    expect(variantElements({ elements: [el('d1')] }, 'mobile')).toEqual([]);
  });

  it('writes ONLY the open variant tree', () => {
    const viaDesktop = withVariantElements(layout, 'desktop', [el('d2')]);
    expect(viaDesktop.elements.map((e) => e.id)).toEqual(['d2']);
    expect(viaDesktop.mobile!.elements.map((e) => e.id)).toEqual(['m1']);
    const viaMobile = withVariantElements(layout, 'mobile', [el('m2')]);
    expect(viaMobile.elements.map((e) => e.id)).toEqual(['d1']);
    expect(viaMobile.mobile!.elements.map((e) => e.id)).toEqual(['m2']);
    // Writing mobile when the variant doesn't exist is a no-op.
    const absent: ScreenLayout = { elements: [el('d1')] };
    expect(withVariantElements(absent, 'mobile', [el('m2')])).toBe(absent);
  });
});

describe('patchMobileVariant', () => {
  const base: ScreenLayout = { elements: [], mobile: { elements: [el('m')] } };

  it('merges settings and prunes empties (background/aspect/scroll)', () => {
    const a = patchMobileVariant(base, { scroll: true, aspect: PHONE_ASPECT / 2 });
    expect(a.mobile!.scroll).toBe(true);
    expect(a.mobile!.aspect).toBeCloseTo(PHONE_ASPECT / 2);
    const b = patchMobileVariant(a, { scroll: undefined, aspect: undefined, background: '' });
    expect('scroll' in b.mobile!).toBe(false);
    expect('aspect' in b.mobile!).toBe(false);
    expect('background' in b.mobile!).toBe(false);
    expect(b.mobile!.elements.map((e) => e.id)).toEqual(['m']);
  });

  it('no-ops when the mobile variant is absent', () => {
    const absent: ScreenLayout = { elements: [] };
    expect(patchMobileVariant(absent, { scroll: true })).toBe(absent);
  });
});

// ---------------------------------------------------------------------------
// Motion patch helpers
// ---------------------------------------------------------------------------

describe('patchMotion', () => {
  const layout: ScreenLayout = { elements: [] };

  it('writes non-default values and merges with existing motion', () => {
    const a = patchMotion(layout, { flightMs: 600 });
    expect(a.motion).toEqual({ flightMs: 600 });
    const b = patchMotion(a, { arc: 70, spin: 6 });
    expect(b.motion).toEqual({ flightMs: 600, arc: 70, spin: 6 });
  });

  it('drops keys set back to the runner default (the def stays minimal)', () => {
    const a = patchMotion(patchMotion(layout, { flightMs: 600, staggerMs: 80 }), {
      flightMs: MOTION_DEFAULTS.flightMs,
    });
    expect(a.motion).toEqual({ staggerMs: 80 });
  });

  it('removes the motion key entirely when everything is default', () => {
    const a = patchMotion(layout, { flightMs: 600 });
    const b = patchMotion(a, { flightMs: 430 });
    expect('motion' in b).toBe(false);
    // An all-default patch on a motionless layout never adds the key.
    expect('motion' in patchMotion(layout, { arc: MOTION_DEFAULTS.arc })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dynamic text (parts) toggle conversion + the log factory
// ---------------------------------------------------------------------------

describe('setTextDynamic', () => {
  const subject = el('t') as Extract<ScreenElement, { kind: 'text' }>;

  it('ON seeds the segments with the static text (idempotent)', () => {
    const dynamic = setTextDynamic(subject, true);
    expect(dynamic.parts).toEqual(['t']);
    expect(dynamic.text).toBe('t'); // static label kept underneath
    expect(setTextDynamic(dynamic, true)).toBe(dynamic);
  });

  it('OFF joins all-string parts back into the label and drops `parts`', () => {
    const dynamic = { ...subject, parts: ['TURN ', '4'] };
    const flat = setTextDynamic(dynamic, false);
    expect('parts' in flat).toBe(false);
    expect(flat.text).toBe('TURN 4');
    expect(setTextDynamic(subject, false)).toBe(subject); // already static
  });

  it('OFF with expression segments keeps the prior static text instead', () => {
    const dynamic = {
      ...subject,
      parts: ['TURN ', { kind: 'turnNumber' } satisfies Expr],
    };
    const flat = setTextDynamic(dynamic, false);
    expect('parts' in flat).toBe(false);
    expect(flat.text).toBe('t');
  });
});

// ---------------------------------------------------------------------------
// Children of NON-GROUP elements (focus-mode containers) — every walk must
// recurse through `el.children` whatever the kind
// ---------------------------------------------------------------------------

/** A button carrying children (the focus-mode "elements on top" case). */
function btn(id: string, r = rect(10, 10, 20, 10), children?: ScreenElement[]): ScreenElement {
  return {
    kind: 'button', id, name: id, rect: r, actionId: null, label: id,
    ...(children ? { children } : {}),
  };
}

/** Depth-first flatten through children of EVERY kind. */
function flattenAll(els: ScreenElement[]): ScreenElement[] {
  return els.flatMap((e) => [e, ...(e.children ? flattenAll(e.children) : [])]);
}

describe('generalized tree walks (every element is a potential container)', () => {
  const dot = el('dot', rect(70, 10, 20, 30));
  const tree = [btn('seal', rect(40, 40, 20, 10), [dot]), el('plain')];

  it('indexElements walks a button\'s children: abs is % of the BUTTON\'s box', () => {
    const index = indexElements(tree);
    const info = index.get('dot')!;
    expect(info.parentId).toBe('seal');
    expect(info.depth).toBe(1);
    // (70,10,20,30)% of the button box (40,40,20,10) → screen-absolute.
    expect(info.abs).toEqual(rect(54, 41, 4, 3));
  });

  it('findEl / siblingsOf reach into non-group children', () => {
    expect(findEl(tree, 'dot')?.id).toBe('dot');
    expect(siblingsOf(tree, 'dot')!.map((e) => e.id)).toEqual(['dot']);
  });

  it('updateEl patches a nested child immutably, leaving unrelated roots alone', () => {
    const next = updateEl(tree, 'dot', (e) => ({ ...e, name: 'Renamed' }));
    expect(findEl(next, 'dot')!.name).toBe('Renamed');
    expect(findEl(tree, 'dot')!.name).toBe('dot');
    expect(next.find((e) => e.id === 'plain')).toBe(tree.find((e) => e.id === 'plain'));
  });

  it('pruneNested drops a child whose non-group parent is selected too', () => {
    const index = indexElements(tree);
    expect(pruneNested(index, ['seal', 'dot'])).toEqual(['seal']);
  });

  it('reorderSibling / placeRelativeEl work inside a button\'s children', () => {
    const t = [btn('seal', rect(0, 0, 100, 100), [el('a'), el('b'), el('c')])];
    const fwd = reorderSibling(t, 'a', 'fwd');
    expect(findEl(fwd, 'seal')!.children!.map((c) => c.id)).toEqual(['b', 'a', 'c']);
    const placed = placeRelativeEl(t, 'a', 'c');
    expect(findEl(placed, 'seal')!.children!.map((c) => c.id)).toEqual(['b', 'c', 'a']);
    // Cross-array drops still refuse (button child ↔ root).
    const cross = [...t, el('out')];
    expect(placeRelativeEl(cross, 'a', 'out')).toBe(cross);
  });

  it('removeEls reaches nested children; the LAST child gone drops the key (groups keep [])', () => {
    const t = [
      btn('seal', rect(0, 0, 50, 50), [el('only')]),
      grp('g', rect(50, 50, 50, 50), [el('m')]),
    ];
    const next = removeEls(t, new Set(['only', 'm']));
    const seal = next.find((e) => e.id === 'seal')!;
    expect('children' in seal).toBe(false);
    const g = next.find((e) => e.id === 'g')!;
    expect(g.kind).toBe('group');
    expect(g.children).toEqual([]);
    // Removing one of two keeps the survivor.
    const two = [btn('b2', rect(0, 0, 50, 50), [el('x1'), el('x2')])];
    const kept = removeEls(two, new Set(['x1']));
    expect(kept[0].children!.map((c) => c.id)).toEqual(['x2']);
  });

  it('reparentEl moves a button child into a nested group / out to the root, abs preserved', () => {
    const t = [btn('seal', rect(0, 0, 100, 100), [grp('innerG', rect(0, 0, 50, 50), []), el('d', rect(60, 60, 10, 10))])];
    const joined = reparentEl(t, 'd', 'innerG', rect(10, 10, 10, 10));
    const innerG = findEl(joined, 'innerG')!;
    expect(innerG.children!.map((c) => c.id)).toEqual(['d']);
    expect(indexElements(joined).get('d')!.abs).toEqual(rect(10, 10, 10, 10));
    const out = reparentEl(joined, 'd', null, rect(80, 80, 10, 10));
    expect(out.map((e) => e.id)).toEqual(['seal', 'd']);
    expect(indexElements(out).get('d')!.abs).toEqual(rect(80, 80, 10, 10));
  });

  it('reparentEl refuses cycles through non-group children', () => {
    const t = [btn('seal', rect(0, 0, 100, 100), [grp('innerG', rect(0, 0, 50, 50), [])]), el('a')];
    expect(reparentEl(t, 'seal', 'innerG', rect(0, 0, 40, 40))).toBe(t);
  });

  it('deepestGroupAt sees groups nested in non-group children but never the non-group itself', () => {
    const t = [btn('seal', rect(0, 0, 100, 100), [grp('innerG', rect(0, 0, 50, 50), [])])];
    const index = indexElements(t);
    expect(deepestGroupAt(index, 10, 10, new Set())).toBe('innerG');
    expect(deepestGroupAt(index, 80, 80, new Set())).toBeNull(); // over the button only
  });

  it('deepestGroupAt hit-tests a rotated group in its own frame', () => {
    // A wide-thin group (40×10 at y 45-55, centre 50,50) rotated 90° becomes
    // tall-thin. (50,35) is OUTSIDE the axis-aligned box (y<45) but INSIDE the
    // rotated silhouette; the −rotation point map recovers it.
    const t: ScreenElement[] = [{ kind: 'group', id: 'g', name: 'g', rect: rect(30, 45, 40, 10), rotation: 90, children: [] }];
    const index = indexElements(t);
    expect(deepestGroupAt(index, 50, 35, new Set())).toBe('g');
    // A point far outside the rotated silhouette still misses.
    expect(deepestGroupAt(index, 5, 5, new Set())).toBeNull();
  });

  it('groupSiblings wraps two button children in-place; ungroup frees them back', () => {
    const t = [btn('seal', rect(0, 0, 100, 100), [el('a', rect(10, 10, 10, 10)), el('b', rect(30, 30, 20, 20))])];
    const grouped = groupSiblings(t, ['a', 'b'])!;
    expect(grouped).not.toBeNull();
    const seal = grouped.elements[0];
    expect(seal.children).toHaveLength(1);
    expect(seal.children![0].kind).toBe('group');
    // On-screen positions preserved through the button's box.
    expect(indexElements(grouped.elements).get('a')!.abs).toEqual(rect(10, 10, 10, 10));
    const un = ungroupEl(grouped.elements, grouped.groupId)!;
    expect(un.elements[0].children!.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('ungrouping an EMPTY group that is a button child prunes the empty children key', () => {
    const t = [btn('seal', rect(0, 0, 100, 100), [grp('inner', rect(0, 0, 40, 40), [])])];
    const un = ungroupEl(t, 'inner')!;
    expect('children' in un.elements[0]).toBe(false);
  });

  it('cloneElementsWithNewIds regenerates ids inside non-group children too', () => {
    const t = [btn('seal', rect(0, 0, 50, 50), [el('d1'), grp('inner', rect(0, 0, 40, 40), [el('deep')])])];
    const cloned = cloneElementsWithNewIds(t);
    const before = flattenAll(t).map((e) => e.id);
    const after = flattenAll(cloned).map((e) => e.id);
    expect(after).toHaveLength(before.length);
    expect(new Set(after).size).toBe(after.length);
    for (const id of after) {
      expect(before).not.toContain(id);
      expect(id.startsWith('el_')).toBe(true);
    }
    expect(flattenAll(cloned).map((e) => e.name)).toEqual(flattenAll(t).map((e) => e.name));
  });

  it('cloneElementsWithNewIds remaps showForSelector to the cloned selector id', () => {
    const t: ScreenElement[] = [{
      kind: 'group', id: 'sw', name: 'sw', rect: rect(0, 0, 100, 100), children: [
        { kind: 'button', id: 'bA', name: 'A', rect: rect(0, 0, 20, 10), actionId: null, label: 'A', role: 'selector', selectorGroup: 'g' },
        { kind: 'group', id: 'pA', name: 'pA', rect: rect(0, 20, 100, 80), showForSelector: 'bA', children: [] },
      ],
    }];
    const cloned = cloneElementsWithNewIds(t);
    const clonedButton = cloned[0].children!.find((c) => c.kind === 'button')!;
    const clonedPanel = cloned[0].children!.find((c) => c.kind === 'group')!;
    // The panel now points at the CLONED button, not the original 'bA'.
    expect(clonedPanel.showForSelector).toBe(clonedButton.id);
    expect(clonedPanel.showForSelector).not.toBe('bA');
  });

  it('cloneElementsWithNewIds leaves an OUTSIDE showForSelector reference alone', () => {
    const t: ScreenElement[] = [{ kind: 'group', id: 'p', name: 'p', rect: rect(0, 0, 50, 50), showForSelector: 'external_btn', children: [] }];
    expect(cloneElementsWithNewIds(t)[0].showForSelector).toBe('external_btn');
  });
});

// ---------------------------------------------------------------------------
// Focus-mode helpers (paths, validity, palette insertion)
// ---------------------------------------------------------------------------

describe('pathToEl / validFocusPath', () => {
  const tree = [grp('g', rect(0, 0, 100, 100), [btn('seal', rect(0, 0, 50, 50), [el('dot')])])];

  it('pathToEl returns the root→element id chain through any container kind', () => {
    expect(pathToEl(tree, 'dot')).toEqual(['g', 'seal', 'dot']);
    expect(pathToEl(tree, 'seal')).toEqual(['g', 'seal']);
    expect(pathToEl(tree, 'g')).toEqual(['g']);
    expect(pathToEl(tree, 'ghost')).toBeNull();
  });

  it('validFocusPath keeps the longest valid prefix', () => {
    expect(validFocusPath(tree, ['g', 'seal', 'dot'])).toEqual(['g', 'seal', 'dot']);
    expect(validFocusPath(tree, ['g', 'ghost'])).toEqual(['g']);
    expect(validFocusPath(tree, ['seal'])).toEqual([]); // exists, but not at the root
    expect(validFocusPath(tree, [])).toEqual([]);
  });

  it('deleting the focused element trims the path (focus exits safely)', () => {
    const without = removeEls(tree, new Set(['seal']));
    expect(validFocusPath(without, ['g', 'seal', 'dot'])).toEqual(['g']);
  });
});

describe('insertIntoFocusedChildren', () => {
  it('appends to the focused element\'s children with the centered ~30×30% rect', () => {
    const t = [btn('seal', rect(40, 40, 20, 10))];
    const next = insertIntoFocusedChildren(t, 'seal', el('dot', rect(1, 2, 3, 4)));
    const seal = next[0];
    expect(seal.children).toHaveLength(1);
    expect(seal.children![0].id).toBe('dot');
    expect(seal.children![0].rect).toEqual(rect(35, 35, 30, 30));
  });

  it('appends AFTER existing children (frontmost) and works for groups and nested focus targets', () => {
    const t = [grp('g', rect(0, 0, 100, 100), [btn('seal', rect(0, 0, 50, 50), [el('d1')])])];
    const next = insertIntoFocusedChildren(t, 'seal', el('d2'));
    expect(findEl(next, 'seal')!.children!.map((c) => c.id)).toEqual(['d1', 'd2']);
    const intoGroup = insertIntoFocusedChildren(t, 'g', el('d3'));
    expect(findEl(intoGroup, 'g')!.children!.map((c) => c.id)).toEqual(['seal', 'd3']);
  });

  it('no-ops for an unknown focus id', () => {
    const t = [btn('seal', rect(0, 0, 50, 50))];
    expect(insertIntoFocusedChildren(t, 'ghost', el('d'))).toBe(t);
  });
});

describe('newLogElement / templateFieldOptions', () => {
  it('drops a game-log element with sensible defaults', () => {
    const log = newLogElement();
    expect(log.kind).toBe('log');
    if (log.kind !== 'log') return;
    expect(log.id.startsWith('el_')).toBe(true);
    expect(log.name).toBe('Game log');
    expect(log.fontSize).toBeGreaterThan(0);
    expect(log.turnSeparators).toBeUndefined(); // absent = true (separators on)
  });

  it('templateFieldOptions lists template fields, deduped by id', () => {
    const def = newGameDef('T');
    expect(templateFieldOptions(def)).toEqual(
      def.templates.flatMap((t) => t.fields).map((f) => ({ id: f.id, name: f.name })),
    );
    const twoTemplates: GameDef = {
      ...def,
      templates: [
        { id: 'tp1', name: 'Card', aspect: 0.714, background: '#fff', borderColor: '#000', cornerRadius: 8, elements: [], fields: [{ id: 'cost', name: 'Cost', type: 'number' }] },
        { id: 'tp2', name: 'Hero', aspect: 0.714, background: '#fff', borderColor: '#000', cornerRadius: 8, elements: [], fields: [{ id: 'cost', name: 'Cost', type: 'number' }, { id: 'atk', name: 'Attack', type: 'number' }] },
      ],
    };
    expect(templateFieldOptions(twoTemplates).map((f) => f.id)).toEqual(['cost', 'atk']);
  });
});

// ---------------------------------------------------------------------------
// Live preview: selector gating (previewShownMap) + the picker's option list
// ---------------------------------------------------------------------------

describe('selectorButtonOptions / previewShownMap', () => {
  const rect = { x: 0, y: 0, w: 20, h: 10 };
  const selBtn = (id: string, label: string, group: string): ScreenElement => ({
    kind: 'button', id, name: label, rect, actionId: null, label,
    role: 'selector', selectorGroup: group,
  });
  const panel = (id: string, showFor: string, visible?: Expr): ScreenElement => ({
    kind: 'group', id, name: id, rect, showForSelector: showFor,
    ...(visible !== undefined ? { visible } : {}), children: [],
  });

  /** Two selector buttons (group swP) + their panels; pB additionally hidden. */
  function previewTree(hidePB: boolean): ScreenElement[] {
    return [
      {
        kind: 'group', id: 'bar', name: 'Bar', rect,
        children: [selBtn('bA', 'A', 'swP'), selBtn('bB', 'B', 'swP')],
      },
      panel('pA', 'bA'),
      panel('pB', 'bB', hidePB ? { kind: 'bool', value: false } as Expr : undefined),
      { kind: 'text', id: 'always', name: 'Always', rect, text: 'x', fontSize: 2, align: 'left' },
    ];
  }

  it('selectorButtonOptions lists role:selector buttons (paint order, labels, groups)', () => {
    const tree = previewTree(false);
    expect(selectorButtonOptions(tree)).toEqual([
      { id: 'bA', label: 'A', group: 'swP' },
      { id: 'bB', label: 'B', group: 'swP' },
    ]);
    // Non-selector buttons and blank groups are not offered.
    const noisy: ScreenElement[] = [
      { kind: 'button', id: 'x1', name: 'X', rect, actionId: null, label: 'X' },
      { kind: 'button', id: 'x2', name: 'Y', rect, actionId: null, label: 'Y', role: 'selector', selectorGroup: ' ' },
    ];
    expect(selectorButtonOptions(noisy)).toEqual([]);
  });

  it('previewShownMap: default selection shows the FIRST button panel only', async () => {
    const def = makeDef({ zones: [zone('deck')] });
    const h = harness(def);
    await h.engine.start();
    const tree = previewTree(false);
    const map = previewShownMap(def, h.state(), indexElements(tree), tree, 'p0', []);
    expect(map.get('pA')).toBe(true);
    expect(map.get('pB')).toBe(false);
    expect(map.get('always')).toBe(true);
    expect(map.get('bA')).toBe(true); // the buttons themselves always paint
    expect(map.get('bB')).toBe(true);
  });

  it('previewShownMap: the EDITOR selection overrides the store (canvas click switches)', async () => {
    const def = makeDef({ zones: [zone('deck')] });
    const h = harness(def);
    await h.engine.start();
    const tree = previewTree(false);
    // Selecting bB on the canvas flips the group live, before any store write.
    const map = previewShownMap(def, h.state(), indexElements(tree), tree, 'p0', ['bB']);
    expect(map.get('pA')).toBe(false);
    expect(map.get('pB')).toBe(true);
    // Selecting a non-selector element changes nothing.
    const noop = previewShownMap(def, h.state(), indexElements(tree), tree, 'p0', ['always']);
    expect(noop.get('pA')).toBe(true);
  });

  it('previewShownMap: the persisted store carries the switch once selection moves on', async () => {
    const def = makeDef({ zones: [zone('deck')] });
    const h = harness(def);
    await h.engine.start();
    const tree = previewTree(false);
    // PropertiesPanel writes the store whenever a selector button is selected.
    writeSelection(def.meta.id, 'swP', 'bB');
    const map = previewShownMap(def, h.state(), indexElements(tree), tree, 'p0', ['pB']);
    expect(map.get('pA')).toBe(false);
    expect(map.get('pB')).toBe(true);
  });

  it('previewShownMap composes with `visible` (both must hold)', async () => {
    const def = makeDef({ zones: [zone('deck')] });
    const h = harness(def);
    await h.engine.start();
    const tree = previewTree(true); // pB visible:false
    const map = previewShownMap(def, h.state(), indexElements(tree), tree, 'p0', ['bB']);
    expect(map.get('pB')).toBe(false); // gate open, visibility closed
  });

  // selectorHiddenIds: the drop/snap-target gate. No sample state — pure
  // selector logic, so it holds preview on or off.
  it('selectorHiddenIds: default hides the non-active panel; editor override flips it', () => {
    const def = newGameDef('hid');
    const tree = previewTree(false);
    const hidden = selectorHiddenIds(def, tree, []); // bA active (first button)
    expect(hidden.has('pB')).toBe(true);
    expect(hidden.has('pA')).toBe(false);
    expect(hidden.has('always')).toBe(false);
    expect(hidden.has('bA')).toBe(false); // the buttons themselves always paint
    const flipped = selectorHiddenIds(def, tree, ['bB']);
    expect(flipped.has('pA')).toBe(true);
    expect(flipped.has('pB')).toBe(false);
  });

  it('selectorHiddenIds: a closed panel drags its whole subtree into the hidden set', () => {
    const def = newGameDef('hid-sub');
    const tree: ScreenElement[] = [
      { kind: 'group', id: 'bar', name: 'Bar', rect, children: [selBtn('bA', 'A', 'sw'), selBtn('bB', 'B', 'sw')] },
      { kind: 'group', id: 'pA', name: 'pA', rect, showForSelector: 'bA', children: [el('zA')] },
      {
        kind: 'group', id: 'pB', name: 'pB', rect, showForSelector: 'bB',
        children: [{ kind: 'group', id: 'gB', name: 'gB', rect, children: [el('zB')] }],
      },
    ];
    const hidden = selectorHiddenIds(def, tree, []); // bA active → pB closed
    expect([...hidden].sort()).toEqual(['gB', 'pB', 'zB']); // gate own + ancestor
    expect(hidden.has('zA')).toBe(false); // pA open, so its child shows
  });

  it('drop-target gating: a drag in the visible panel never resolves to a stacked hidden one', () => {
    const def = newGameDef('stack');
    // pHidden (showFor bA) and pShown (showFor bB) share ONE rect — the stacked
    // Dominion supply pattern. pHidden is FIRST, so a naive depth+area tie-break
    // wrongly grabs it; the hidden-gate exclusion sends the drop to what's shown.
    const box = { x: 0, y: 20, w: 100, h: 60 };
    const child = { x: 10, y: 30, w: 20, h: 20 };
    const tree: ScreenElement[] = [
      {
        kind: 'group', id: 'bar', name: 'Bar', rect: { x: 0, y: 0, w: 100, h: 15 },
        children: [selBtn('bA', 'A', 'sw'), selBtn('bB', 'B', 'sw')],
      },
      { kind: 'group', id: 'pHidden', name: 'pHidden', rect: box, showForSelector: 'bA', children: [{ ...el('zHidden'), rect: child }] },
      { kind: 'group', id: 'pShown', name: 'pShown', rect: box, showForSelector: 'bB', children: [{ ...el('zShown'), rect: child }] },
    ];
    const idx = indexElements(tree);
    const hidden = selectorHiddenIds(def, tree, ['bB']); // activate pShown
    expect(hidden.has('pHidden')).toBe(true);
    const exclude = new Set([...withDescendants(idx, ['zShown']), ...hidden]);
    expect(deepestGroupAt(idx, 50, 50, exclude)).toBe('pShown');
    // Guard against regression: without the gate exclusion the tie picks pHidden.
    const naive = withDescendants(idx, ['zShown']);
    expect(deepestGroupAt(idx, 50, 50, naive)).toBe('pHidden');
  });

  it('selectorHiddenIds resolves gates over the FULL tree even from a focused scope', () => {
    // Finding-1 guard: the ancestor gate lives ABOVE where a focus-mode canvas
    // would index. selectorHiddenIds builds its own full-tree index, so the
    // closed ancestor is still detected regardless of the editor's focus scope.
    const def = newGameDef('focus-gate');
    const tree: ScreenElement[] = [
      { kind: 'group', id: 'bar', name: 'Bar', rect, children: [selBtn('bA', 'A', 'sw'), selBtn('bB', 'B', 'sw')] },
      {
        kind: 'group', id: 'pB', name: 'pB', rect, showForSelector: 'bB', // closed while bA active
        children: [{ kind: 'group', id: 'inner', name: 'inner', rect, children: [el('leaf')] }],
      },
    ];
    const hidden = selectorHiddenIds(def, tree, []); // bA active → pB closed
    expect(hidden.has('inner')).toBe(true);
    expect(hidden.has('leaf')).toBe(true);
  });
});

describe('resolveDropParent (drop-to-join guard)', () => {
  const box = { x: 0, y: 0, w: 100, h: 100 };
  const inside = { x: 40, y: 40, w: 10, h: 10 };
  const outside = { x: 200, y: 200, w: 10, h: 10 };

  it('non-reparentable drags never re-nest (multi-select / resize)', () => {
    expect(resolveDropParent({ reparentable: false, hoverGroupId: 'g', origParentId: null, primaryRect: inside, origParentAbs: box })).toBeUndefined();
  });

  it('a drop onto the element’s own parent is a plain move', () => {
    expect(resolveDropParent({ reparentable: true, hoverGroupId: 'p', origParentId: 'p', primaryRect: inside, origParentAbs: box })).toBeUndefined();
  });

  it('a drop into a DIFFERENT visible group joins it', () => {
    expect(resolveDropParent({ reparentable: true, hoverGroupId: 'other', origParentId: 'p', primaryRect: inside, origParentAbs: box })).toBe('other');
  });

  it('a null hover while still inside the parent box keeps the parent (no jump to root)', () => {
    expect(resolveDropParent({ reparentable: true, hoverGroupId: null, origParentId: 'p', primaryRect: inside, origParentAbs: box })).toBeUndefined();
  });

  it('a null hover dragged CLEAR of the parent leaves to the screen root', () => {
    expect(resolveDropParent({ reparentable: true, hoverGroupId: null, origParentId: 'p', primaryRect: outside, origParentAbs: box })).toBeNull();
  });

  it('a null hover for a root-level element stays at root', () => {
    expect(resolveDropParent({ reparentable: true, hoverGroupId: null, origParentId: null, primaryRect: inside, origParentAbs: undefined })).toBeUndefined();
  });
});
