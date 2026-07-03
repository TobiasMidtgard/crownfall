/**
 * Pure keyboard-system tests (DOM-free — the React glue in keyboard.tsx is
 * exercised live, not here): digit label/code mapping incl. Digit0 as the
 * tenth, modifier routing, badge/target assignment by DOM (paint) order
 * across keyGroup zones against REAL engine states, spotlight subtree
 * checks, Enter's first-enabled-button walk, selector-group shown-set
 * filtering + auto selector-flips, and the flip layer's defensive move-tag
 * reader. (Node env: the selection store falls back to its in-session map.)
 */
import { describe, expect, it } from 'vitest';
import type { GameDef, GameState, Id, Move, ScreenElement } from '../shared/types';
import { cdef, customDeck, harness, makeDef, pzone, zone } from '../engine/testkit';
import {
  computeKeyTargets, digitForIndex, elementCollapsed, firstEnabledButtonMove, groupForDigit,
  heldGroup, indexFromCode, selectorFlipsForGroup, subtreeHasKeyGroup,
} from './keyboard';
import { writeSelection } from './layout';
import { moveTagOf } from './flip';

const rect = { x: 0, y: 0, w: 10, h: 10 };

describe('digit mapping', () => {
  it('digitForIndex: 0-8 → 1-9, 9 → 0 (the tenth), beyond → null', () => {
    expect(digitForIndex(0)).toBe('1');
    expect(digitForIndex(8)).toBe('9');
    expect(digitForIndex(9)).toBe('0');
    expect(digitForIndex(10)).toBeNull();
    expect(digitForIndex(-1)).toBeNull();
  });

  it('indexFromCode reads e.code (layout-independent, numpad included)', () => {
    expect(indexFromCode('Digit1')).toBe(0);
    expect(indexFromCode('Digit9')).toBe(8);
    expect(indexFromCode('Digit0')).toBe(9);
    expect(indexFromCode('Numpad1')).toBe(0);
    expect(indexFromCode('Numpad0')).toBe(9);
    expect(indexFromCode('KeyA')).toBeNull();
    expect(indexFromCode('Enter')).toBeNull();
  });

  it('modifier routing: alt > ctrl > shift, live flags win, plain fallback', () => {
    const none = { shift: false, ctrl: false, alt: false };
    expect(heldGroup(none)).toBeNull();
    expect(heldGroup({ ...none, shift: true })).toBe('shift');
    expect(heldGroup({ shift: true, ctrl: true, alt: true })).toBe('alt');
    expect(groupForDigit(none, none)).toBe('plain');
    expect(groupForDigit({ ...none, ctrl: true }, none)).toBe('ctrl');
    // Live event flags win over the held state…
    expect(groupForDigit({ ...none, ctrl: true }, { ...none, alt: true })).toBe('ctrl');
    // …but a still-held modifier routes even when the digit event lost it.
    expect(groupForDigit(none, { ...none, shift: true })).toBe('shift');
  });
});

// ---------------------------------------------------------------------------
// Badge/target assignment against real engine states
// ---------------------------------------------------------------------------

/** 12 distinct two-copy supply piles + per-player hands (3× copper, estate). */
function kbDef(): GameDef {
  const kinds = Array.from({ length: 12 }, (_, i) => cdef(`k${i}`));
  return makeDef({
    zones: [
      zone('supply', { layout: 'grid' }),
      pzone('hand', { layout: 'fan' }),
      pzone('deck', { layout: 'stack' }),
    ],
    cards: [...kinds, cdef('copper'), cdef('estate')],
    decks: [
      customDeck('ds', 'supply', kinds.map((k) => [k.id, 2] as [string, number])),
      customDeck('dh', 'hand', [['copper', 3], ['estate', 1]]),
      customDeck('dd', 'deck', ['copper', 'estate']),
    ],
  });
}

function kbElements(): ScreenElement[] {
  return [
    {
      kind: 'zone', id: 'el_supply', name: 'Supply', rect,
      zoneId: 'supply', seat: 'shared', display: 'piles', keyGroup: 'shift',
    },
    {
      kind: 'group', id: 'el_grp', name: 'Bottom band', rect,
      children: [
        {
          kind: 'zone', id: 'el_hand', name: 'Hand', rect,
          zoneId: 'hand', seat: 'viewer', collapseDuplicates: true, keyGroup: 'plain',
        },
      ],
    },
    { kind: 'zone', id: 'el_deck', name: 'Deck', rect, zoneId: 'deck', seat: 'viewer', keyGroup: 'ctrl' },
    {
      kind: 'zone', id: 'el_ghost', name: 'Ghost', rect,
      zoneId: 'supply', seat: 'shared', keyGroup: 'alt',
      visible: { kind: 'bool', value: false },
    },
  ];
}

async function kbState(): Promise<{ def: GameDef; state: GameState }> {
  const def = kbDef();
  const h = harness(def, { players: ['Alice', 'Bob'] });
  await h.engine.start();
  return { def, state: h.state() };
}

const namesOf = (state: GameState, ids: readonly Id[]) => ids.map((id) => state.cards[id].name);

describe('computeKeyTargets (badge assignment by DOM order)', () => {
  it('assigns 1-9 then 0 per group in DOM order; the 11th+ are unaddressable', async () => {
    const { def, state } = await kbState();
    const idx = computeKeyTargets(def, state, kbElements(), 'p0', () => true);

    const shift = idx.groups.get('shift')!;
    expect(shift).toHaveLength(10); // 12 piles, ten addressable
    expect(shift.map((t) => t.digit)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']);
    expect(namesOf(state, shift.map((t) => t.faceId)))
      .toEqual(['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9']);
    // Pile faces are the TOP copy; badges land on the faces.
    const supply = state.zones['supply'].cardIds;
    expect(shift[0].faceId).toBe(supply[1]); // k0's second (top) copy
    expect(idx.badges.get(shift[9].faceId)).toEqual({ digit: '0', group: 'shift' });
  });

  it('collapsed hand stacks badge their face and activate the topmost legal member', async () => {
    const { def, state } = await kbState();
    const hand = state.zones['hand:p0'].cardIds; // copper, copper, copper, estate
    const legal = new Set([hand[0], hand[3]]); // only the FIRST copper + the estate
    const idx = computeKeyTargets(def, state, kbElements(), 'p0', (id) => legal.has(id));

    const plain = idx.groups.get('plain')!;
    expect(plain).toHaveLength(2);
    // Copper stack: face = last copper (the rendered face), activate = the buried legal one.
    expect(plain[0].faceId).toBe(hand[2]);
    expect(plain[0].activateId).toBe(hand[0]);
    expect(plain[0].digit).toBe('1');
    expect(plain[1]).toMatchObject({ faceId: hand[3], activateId: hand[3], digit: '2' });
    expect(idx.badges.get(hand[2])).toEqual({ digit: '1', group: 'plain' });
  });

  it('skips items with no legal member (digits stay dense in DOM order)', async () => {
    const { def, state } = await kbState();
    const supply = state.zones['supply'].cardIds;
    const k1Copies = new Set(supply.filter((id) => state.cards[id].name === 'k1'));
    const idx = computeKeyTargets(
      def, state, kbElements(), 'p0',
      (id) => supply.includes(id) && !k1Copies.has(id),
    );
    const shift = idx.groups.get('shift')!;
    expect(shift).toHaveLength(10); // 11 legal piles → ten addressable
    expect(namesOf(state, shift.map((t) => t.faceId)))
      .toEqual(['k0', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7', 'k8', 'k9', 'k10']);
  });

  it('stack zones address only the top card; invisible elements contribute nothing', async () => {
    const { def, state } = await kbState();
    const deck = state.zones['deck:p0'].cardIds; // copper (bottom), estate (top)
    const all = computeKeyTargets(def, state, kbElements(), 'p0', () => true);
    expect(all.groups.get('ctrl')).toHaveLength(1);
    expect(all.groups.get('ctrl')![0].faceId).toBe(deck[1]);
    // The 'alt' ghost element is invisible: no group, not spotlightable.
    expect(all.groups.get('alt')).toBeUndefined();
    expect(all.present.has('alt')).toBe(false);
    expect(all.present.has('shift')).toBe(true);
    expect(all.present.has('ctrl')).toBe(true);

    // Only a BURIED deck card legal → the pile face has no legal member: no target.
    const buriedOnly = computeKeyTargets(
      def, state, kbElements(), 'p0', (id) => id === deck[0],
    );
    expect(buriedOnly.groups.get('ctrl') ?? []).toHaveLength(0);
  });

  it("a 'current' seat zone follows the acting turn, not the viewer", async () => {
    const { def, state } = await kbState();
    const els: ScreenElement[] = [{
      kind: 'zone', id: 'el_cur', name: 'Current hand', rect,
      zoneId: 'hand', seat: 'current', keyGroup: 'plain',
    }];
    const p0Hand = new Set(state.zones['hand:p0'].cardIds);
    const now = computeKeyTargets(def, state, els, 'p1', () => true);
    for (const t of now.groups.get('plain')!) expect(p0Hand.has(t.faceId)).toBe(true);

    const passed: GameState = { ...state, currentPlayerIdx: 1 };
    const p1Hand = new Set(state.zones['hand:p1'].cardIds);
    const later = computeKeyTargets(def, passed, els, 'p1', () => true);
    for (const t of later.groups.get('plain')!) expect(p1Hand.has(t.faceId)).toBe(true);
  });
});

describe('spotlight subtree check (subtreeHasKeyGroup)', () => {
  it('finds keyGroup zones at any depth; other elements dim', () => {
    const els = kbElements();
    expect(subtreeHasKeyGroup(els[0], 'shift')).toBe(true);
    expect(subtreeHasKeyGroup(els[0], 'ctrl')).toBe(false);
    // The hand sits inside a group: the group stays bright for 'plain'.
    expect(subtreeHasKeyGroup(els[1], 'plain')).toBe(true);
    expect(subtreeHasKeyGroup(els[1], 'shift')).toBe(false);
    expect(subtreeHasKeyGroup(els[2], 'ctrl')).toBe(true);
  });
});

describe('Enter → first enabled screen button', () => {
  it('walks paint order, skipping invisible trees and buttons without a legal move', async () => {
    const { def, state } = await kbState();
    const els: ScreenElement[] = [
      { kind: 'button', id: 'b_deco', name: 'Deco', rect, actionId: null, label: 'Deco' },
      { kind: 'button', id: 'b_dead', name: 'Dead', rect, actionId: 'a_dead', label: 'Dead' },
      {
        kind: 'group', id: 'g_hidden', name: 'Hidden', rect,
        visible: { kind: 'bool', value: false },
        children: [
          { kind: 'button', id: 'b_hidden', name: 'H', rect, actionId: 'a_live', label: 'H' },
        ],
      },
      {
        kind: 'group', id: 'g_seal', name: 'Seal', rect,
        children: [
          { kind: 'button', id: 'b_live', name: 'Done', rect, actionId: 'a_live', label: 'Done' },
        ],
      },
      { kind: 'button', id: 'b_late', name: 'Late', rect, actionId: 'a_late', label: 'Late' },
    ];
    const live: Move = { actionId: 'a_live' };
    const late: Move = { actionId: 'a_late' };
    const moves = new Map<Id, Move>([['a_live', live], ['a_late', late]]);

    expect(firstEnabledButtonMove(def, state, els, 'p0', moves)).toBe(live);
    // Without the seal's move, Enter falls through to the next enabled button.
    expect(firstEnabledButtonMove(def, state, els, 'p0', new Map([['a_late', late]]))).toBe(late);
    expect(firstEnabledButtonMove(def, state, els, 'p0', new Map())).toBeNull();
  });

  it('skips subtrees whose collapsible is collapsed (their buttons never mount)', async () => {
    const { def, state } = await kbState();
    const els: ScreenElement[] = [
      {
        kind: 'group', id: 'g_dock', name: 'Dock', rect,
        collapsible: { side: 'left' },
        children: [
          { kind: 'button', id: 'b_docked', name: 'Pass', rect, actionId: 'a_pass', label: 'Pass' },
        ],
      },
      { kind: 'button', id: 'b_seal', name: 'Done', rect, actionId: 'a_done', label: 'Done' },
    ];
    const pass: Move = { actionId: 'a_pass' };
    const done: Move = { actionId: 'a_done' };
    const moves = new Map<Id, Move>([['a_pass', pass], ['a_done', done]]);

    // Expanded (the default predicate): paint order wins as before.
    expect(firstEnabledButtonMove(def, state, els, 'p0', moves)).toBe(pass);
    // Collapsed: the docked button is not rendered — Enter reaches the seal.
    expect(firstEnabledButtonMove(def, state, els, 'p0', moves, (el) => el.id === 'g_dock'))
      .toBe(done);
    // A collapsed BUTTON element itself is skipped too (renders as a tab).
    const solo: ScreenElement[] = [{
      kind: 'button', id: 'b_solo', name: 'Solo', rect, actionId: 'a_pass', label: 'Solo',
      collapsible: { side: 'right' },
    }];
    expect(firstEnabledButtonMove(def, state, solo, 'p0', moves, (el) => el.id === 'b_solo'))
      .toBeNull();
  });

  it('elementCollapsed: never for non-collapsibles; startCollapsed is the storageless default', () => {
    const plain: ScreenElement = {
      kind: 'button', id: 'b1', name: 'B', rect, actionId: 'a', label: 'B',
    };
    // Node test env has no localStorage: the walk falls back to the authored
    // default — exactly what a fresh device shows.
    expect(elementCollapsed('g', plain)).toBe(false);
    expect(elementCollapsed('g', { ...plain, collapsible: { side: 'left' } })).toBe(false);
    expect(elementCollapsed('g', {
      ...plain, collapsible: { side: 'left', startCollapsed: true },
    })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Selector groups: shown-set digits + auto selector-flips
// ---------------------------------------------------------------------------

/**
 * A selector-switched market (the migrated tabbed shape): a button row whose
 * two selector buttons gate panel A (shift supply piles) and panel B (the
 * alt hand) via showForSelector. Ids are prefixed per test (`sg1`, `sg2`, …)
 * because the selection store is module-global in-session state and
 * def.meta.id is always 'g' here.
 */
function selectorElements(groupId: string): ScreenElement[] {
  const btn = (id: string, label: string): ScreenElement => ({
    kind: 'button', id, name: label, rect, actionId: null, label,
    role: 'selector', selectorGroup: groupId,
  });
  return [
    {
      kind: 'group', id: groupId, name: 'Market', rect,
      children: [
        {
          kind: 'group', id: `${groupId}_selbar`, name: 'Market switcher', rect,
          children: [btn(`${groupId}_pa_sel`, 'Treasure'), btn(`${groupId}_pb_sel`, 'Kingdom')],
        },
        {
          kind: 'group', id: `${groupId}_pa`, name: 'Treasure', rect,
          showForSelector: `${groupId}_pa_sel`,
          children: [{
            kind: 'zone', id: `${groupId}_za`, name: 'Supply', rect,
            zoneId: 'supply', seat: 'shared', display: 'piles', keyGroup: 'shift',
          }],
        },
        {
          kind: 'group', id: `${groupId}_pb`, name: 'Kingdom', rect,
          showForSelector: `${groupId}_pb_sel`,
          children: [{
            kind: 'zone', id: `${groupId}_zb`, name: 'Hand', rect,
            zoneId: 'hand', seat: 'viewer', keyGroup: 'alt',
          }],
        },
      ],
    },
  ];
}

describe('selector groups (shown-set digit filtering + auto selector-flip)', () => {
  it('computeKeyTargets: targets/badges follow the SHOWN set; present stays layout-wide', async () => {
    const { def, state } = await kbState();
    const els = selectorElements('sg1');
    // No stored selection: the first button (Treasure) is the default. The
    // gated-out Kingdom panel contributes NO targets — but its modifier
    // group is still present (the digit-swallow set is pre-gate: Alt+3
    // aimed at the flipped-away panel must not reach the browser).
    const first = computeKeyTargets(def, state, els, 'p0', () => true);
    expect(first.present.has('shift')).toBe(true);
    expect(first.present.has('alt')).toBe(true);
    expect(first.groups.get('alt')).toBeUndefined();
    expect(first.groups.get('shift')!.length).toBeGreaterThan(0);

    // Select Kingdom: only the alt zone contributes targets now, and shift
    // stays in the swallow set the same way.
    writeSelection(def.meta.id, 'sg1', 'sg1_pb_sel');
    const flipped = computeKeyTargets(def, state, els, 'p0', () => true);
    expect(flipped.present.has('shift')).toBe(true);
    expect(flipped.groups.get('shift')).toBeUndefined();
    expect(flipped.present.has('alt')).toBe(true);
    expect(flipped.groups.get('alt')!.length).toBeGreaterThan(0);
  });

  it('a gated-out group is a swallowed no-op: present without any target', async () => {
    // The exact leak scenario: hold Ctrl, the panel gets flipped away (a
    // manual tab click mid-hold), press Digit3. The keydown handler swallows
    // any digit routed to a PRESENT modifier group, then finds no target —
    // so present must say yes while groups says no.
    const { def, state } = await kbState();
    const els = selectorElements('sg6');
    const group = els[0] as Extract<ScreenElement, { kind: 'group' }>;
    // Rewire panel B's zone to ctrl for a distinct group name.
    const pb = group.children[2] as Extract<ScreenElement, { kind: 'group' }>;
    pb.children = [{ ...(pb.children[0] as Extract<ScreenElement, { kind: 'zone' }>), keyGroup: 'ctrl' }];
    const idx = computeKeyTargets(def, state, els, 'p0', () => true); // Treasure shown
    expect(idx.present.has('ctrl')).toBe(true); // swallow Ctrl+digit…
    expect(idx.groups.get('ctrl')).toBeUndefined(); // …but activate nothing
    expect([...idx.badges.values()].every((b) => b.group !== 'ctrl')).toBe(true);
  });

  it('selectorFlipsForGroup: selects the button whose shown set holds the modifier zone', async () => {
    const { def, state } = await kbState();
    const els = selectorElements('sg2');
    // Treasure (shift) is the default: alt demands a flip, shift none.
    expect(selectorFlipsForGroup(def, state, els, 'p0', 'alt'))
      .toEqual([{ selectorGroup: 'sg2', buttonId: 'sg2_pb_sel' }]);
    expect(selectorFlipsForGroup(def, state, els, 'p0', 'shift')).toEqual([]);
    // Once the flip persists, alt is home and shift asks to come back.
    writeSelection(def.meta.id, 'sg2', 'sg2_pb_sel');
    expect(selectorFlipsForGroup(def, state, els, 'p0', 'alt')).toEqual([]);
    expect(selectorFlipsForGroup(def, state, els, 'p0', 'shift'))
      .toEqual([{ selectorGroup: 'sg2', buttonId: 'sg2_pa_sel' }]);
    // ctrl lives nowhere in the group: nothing flips.
    expect(selectorFlipsForGroup(def, state, els, 'p0', 'ctrl')).toEqual([]);
  });

  it('hidden panels never take digits or flips; a stale selection falls back', async () => {
    const { def, state } = await kbState();
    const els = selectorElements('sg3');
    const group = els[0] as Extract<ScreenElement, { kind: 'group' }>;
    group.children[2] = { ...group.children[2], visible: { kind: 'bool', value: false } };
    // The alt zone hides with its panel (display `visible`): no flip…
    expect(selectorFlipsForGroup(def, state, els, 'p0', 'alt')).toEqual([]);
    // …and a deleted button's stored selection falls back to the default, so
    // the shift panel still contributes its digits.
    writeSelection(def.meta.id, 'sg3', 'ghost_button');
    const idx = computeKeyTargets(def, state, els, 'p0', () => true);
    expect(idx.present.has('alt')).toBe(false);
    expect(idx.present.has('shift')).toBe(true);
  });

  it('a zone gated by TWO selector groups flips both', async () => {
    const { def, state } = await kbState();
    const btn = (id: string, group: string): ScreenElement => ({
      kind: 'button', id, name: id, rect, actionId: null, label: id,
      role: 'selector', selectorGroup: group,
    });
    const els: ScreenElement[] = [
      btn('sg4a_1', 'sg4a'), btn('sg4a_2', 'sg4a'),
      btn('sg4b_1', 'sg4b'), btn('sg4b_2', 'sg4b'),
      {
        kind: 'group', id: 'sg4_outer', name: 'Outer', rect, showForSelector: 'sg4a_2',
        children: [{
          kind: 'group', id: 'sg4_inner', name: 'Inner', rect, showForSelector: 'sg4b_2',
          children: [{
            kind: 'zone', id: 'sg4_z', name: 'Hand', rect,
            zoneId: 'hand', seat: 'viewer', keyGroup: 'alt',
          }],
        }],
      },
    ];
    expect(selectorFlipsForGroup(def, state, els, 'p0', 'alt')).toEqual([
      { selectorGroup: 'sg4a', buttonId: 'sg4a_2' },
      { selectorGroup: 'sg4b', buttonId: 'sg4b_2' },
    ]);
  });

  it('Enter skips gated-out buttons and NEVER lands on a selector button', async () => {
    const { def, state } = await kbState();
    const els: ScreenElement[] = [
      // A selector button bound to a legal action id must not take Enter.
      {
        kind: 'button', id: 'sg5_sel1', name: 'One', rect, actionId: 'a1',
        label: 'One', role: 'selector', selectorGroup: 'sg5',
      },
      {
        kind: 'button', id: 'sg5_sel2', name: 'Two', rect, actionId: null,
        label: 'Two', role: 'selector', selectorGroup: 'sg5',
      },
      {
        kind: 'button', id: 'sg5_b1', name: 'Do one', rect, actionId: 'a1',
        label: 'Do one', showForSelector: 'sg5_sel1',
      },
      {
        kind: 'button', id: 'sg5_b2', name: 'Do two', rect, actionId: 'a2',
        label: 'Do two', showForSelector: 'sg5_sel2',
      },
    ];
    const m1: Move = { actionId: 'a1' };
    const m2: Move = { actionId: 'a2' };
    const moves = new Map<Id, Move>([['a1', m1], ['a2', m2]]);
    // Default selection (One): its panel button takes Enter — not the
    // selector button carrying the same action id.
    expect(firstEnabledButtonMove(def, state, els, 'p0', moves)).toBe(m1);
    // With One's move gone, Two's button stays unreachable: gated out.
    expect(firstEnabledButtonMove(def, state, els, 'p0', new Map([['a2', m2]]))).toBeNull();
    // Selecting Two mounts it.
    writeSelection(def.meta.id, 'sg5', 'sg5_sel2');
    expect(firstEnabledButtonMove(def, state, els, 'p0', moves)).toBe(m2);
  });
});

describe('moveTagOf (flip layer, defensive read of state.moveTags)', () => {
  it('returns the stamped tag, and null when absent/blank/missing', async () => {
    const { state } = await kbState();
    const [c0, c1] = state.zones['hand:p0'].cardIds;
    expect(moveTagOf(state, c0)).toBeNull(); // engine feature not landed: no map
    const tagged = {
      ...state,
      moveTags: { [c0]: 'draw', [c1]: '' },
    } as GameState;
    expect(moveTagOf(tagged, c0)).toBe('draw');
    expect(moveTagOf(tagged, c1)).toBeNull(); // blank = untagged
    expect(moveTagOf(tagged, 'ghost')).toBeNull();
  });
});
