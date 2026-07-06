/**
 * Screen-layout runner logic, against REAL engine states (testkit harness):
 *   - visibility gating of screen buttons (display expressions incl. $viewer
 *     and ancestor groups),
 *   - button gating vs the viewer's legal moves,
 *   - automatic action-bar dedupe (visible buttons leave the bar; Pass too),
 *   - seat refs resolving to real perPlayer zone instances,
 *   - element STATES: first-match-wins appearance resolution ($viewer bound),
 *     style merge over the base, rect override, phaseIndex/phasePos tracks,
 *   - display-only card filters ($card substituted per candidate),
 *   - burn-zone instance keys (arriveEffect 'burn', seats resolved),
 *   - text parts + display value rendering (ids -> names, like announce),
 *   - onChangeAnim content signatures and chronicle log rows.
 */
import { describe, expect, it } from 'vitest';
import type {
  ElementState, Expr, GameDef, GameState, Move, ScreenElement, ScreenLayout,
} from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import {
  actionDef, bnd, cdef, cmp, customDeck, fld, gv, harness, makeDef, num, phaseDef, pzone, str,
  vdef, zone,
} from '../engine/testkit';
import {
  applyExternalSelection, burnZoneKeys, buttonMoves, elementContentSig, logRows,
  noneTargetMoveByAction, readSelection, renderDisplayValue, renderTextParts, selStorageKey,
  selectionVersion, selectorContextFrom, selectorGateOpen, subscribeSelection,
  visibleButtonActionIds, writeSelection, zoneInstKey,
} from './layout';
import { filterDisplayCards, resolveElementAppearance, resolveSeat } from './layoutGeometry';

const rect = { x: 0, y: 0, w: 20, h: 10 };

/**
 * Buttons: "shout" always on screen; "endit" inside a group only shown while
 * the global `night` is true; "cheer" only while the VIEWER's lp > 0.
 * "draw" is a zone-target action (never a button / bar entry).
 */
function screenDef(): GameDef {
  const layout: ScreenLayout = {
    aspect: null,
    elements: [
      { kind: 'zone', id: 'el_hand', name: 'Opp hand', rect, zoneId: 'hand', seat: 'opp1' },
      { kind: 'button', id: 'el_shout', name: 'Shout', rect, actionId: 'shout', label: 'Shout' },
      {
        kind: 'group',
        id: 'el_night',
        name: 'Night controls',
        rect,
        visible: gv('night'),
        children: [
          { kind: 'button', id: 'el_endit', name: 'End it', rect, actionId: 'endit', label: 'End it' },
        ],
      },
      {
        kind: 'button',
        id: 'el_cheer',
        name: 'Cheer',
        rect,
        visible: cmp('>', gv('lp', bnd('$viewer')), num(0)),
        actionId: 'cheer',
        label: 'Cheer',
      },
    ],
  };
  return makeDef({
    variables: [
      vdef('night', 'global', 'boolean', false),
      vdef('lp', 'perPlayer', 'number', 8000),
    ],
    zones: [zone('deck'), pzone('hand')],
    phases: [phaseDef('main', 'manual', ['draw', 'shout', 'endit', 'cheer'])],
    actions: [
      actionDef('draw', { target: { kind: 'zone', zoneId: 'deck', ownerOnly: false } }),
      actionDef('shout'),
      actionDef('endit'),
      actionDef('cheer'),
    ],
    screenLayout: layout,
  });
}

/** Same state with the global `night` flipped on (display eval is read-only). */
function atNight(state: GameState): GameState {
  return { ...state, globalVars: { ...state.globalVars, night: true } };
}

describe('visibility gating (visibleButtonActionIds)', () => {
  it('collects only buttons whose element AND ancestors are visible', async () => {
    const def = screenDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    const layout = def.screenLayout!;

    // Day: the night group hides "endit"; lp 8000 > 0 keeps "cheer".
    expect(visibleButtonActionIds(def, state, layout.elements, 'p0'))
      .toEqual(new Set(['shout', 'cheer']));
    // Night: the group reveals its child button.
    expect(visibleButtonActionIds(def, atNight(state), layout.elements, 'p0'))
      .toEqual(new Set(['shout', 'endit', 'cheer']));
  });

  it('evaluates $viewer per seat (per-player visibility)', async () => {
    const def = screenDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    const layout = def.screenLayout!;
    // p0 hits 0 lp -> their "cheer" button disappears; p1 keeps it.
    const broke: GameState = {
      ...state,
      players: state.players.map((p) => (
        p.id === 'p0' ? { ...p, vars: { ...p.vars, lp: 0 } } : p
      )),
    };
    expect(visibleButtonActionIds(def, broke, layout.elements, 'p0')).toEqual(new Set(['shout']));
    expect(visibleButtonActionIds(def, broke, layout.elements, 'p1')).toEqual(new Set(['shout', 'cheer']));
  });
});

describe('button gating vs legal moves + action-bar dedupe', () => {
  it('screen buttons enable from the legal none-target moves only', async () => {
    const def = screenDef();
    const h = harness(def);
    await h.engine.start();
    const moves = h.engine.getLegalMoves('p0');
    expect(moves).toContainEqual({ actionId: 'shout' });
    expect(moves).toContainEqual({ actionId: 'draw' });

    const byAction = noneTargetMoveByAction(def, moves);
    // Plain buttons only — the zone-target "draw" can never bind to a button.
    expect([...byAction.keys()].sort()).toEqual(['cheer', 'endit', 'shout']);
    expect(byAction.get('shout')).toEqual({ actionId: 'shout' });
    // Not the player's turn -> no moves -> every button disabled.
    expect(noneTargetMoveByAction(def, h.engine.getLegalMoves('p1')).size).toBe(0);
  });

  it('the automatic bar drops moves covered by a VISIBLE screen button', async () => {
    const def = screenDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    const moves = h.engine.getLegalMoves('p0');

    // No screen layout exclusions: all none-target moves reach the bar.
    expect(buttonMoves(def, moves).map((b) => b.move.actionId))
      .toEqual(['shout', 'endit', 'cheer']);
    // Day screen: "shout"/"cheer" are on screen; hidden "endit" stays in the
    // bar so the move is still reachable.
    const day = visibleButtonActionIds(def, state, def.screenLayout!.elements, 'p0');
    expect(buttonMoves(def, moves, day).map((b) => b.move.actionId)).toEqual(['endit']);
    // Night screen: every none-target move has a visible button -> empty bar.
    const night = visibleButtonActionIds(def, atNight(state), def.screenLayout!.elements, 'p0');
    expect(buttonMoves(def, moves, night)).toEqual([]);
  });

  it('Pass dedupes like any other button-bound move', () => {
    const def = screenDef();
    const moves: Move[] = [{ actionId: PASS_ACTION_ID }];
    expect(buttonMoves(def, moves).map((b) => b.name)).toEqual(['Pass']);
    expect(buttonMoves(def, moves, new Set([PASS_ACTION_ID]))).toEqual([]);
    // ...and is offered to screen buttons bound to it.
    expect(noneTargetMoveByAction(def, moves).get(PASS_ACTION_ID))
      .toEqual({ actionId: PASS_ACTION_ID });
  });

  it('card-target moves never index as button moves', () => {
    const def = screenDef();
    const moves: Move[] = [{ actionId: 'shout', cardId: 'c1' }];
    expect(noneTargetMoveByAction(def, moves).size).toBe(0);
    expect(buttonMoves(def, moves)).toEqual([]);
  });
});

describe('element states (resolveElementAppearance)', () => {
  const baseRect = { x: 5, y: 5, w: 20, h: 10 };
  const bigRect = { x: 0, y: 0, w: 40, h: 20 };
  const baseStyle = { background: '#111', borderColor: '#888' };

  function shapeEl(states: ElementState[] | undefined): ScreenElement {
    return {
      kind: 'shape', id: 'el_dot', name: 'Dot', rect: baseRect, shape: 'circle',
      style: baseStyle, states,
    };
  }

  /** States: [night -> red + bigRect] then [viewer lp > 0 -> blue border]. */
  const nightState: ElementState = {
    id: 'st_night', name: 'Night', when: gv('night'),
    style: { background: 'red' }, rect: bigRect,
  };
  const aliveState: ElementState = {
    id: 'st_alive', name: 'Alive',
    when: cmp('>', gv('lp', bnd('$viewer')), num(0)),
    style: { borderColor: 'blue' },
  };

  async function startedState(): Promise<{ def: GameDef; state: GameState }> {
    const def = screenDef();
    const h = harness(def);
    await h.engine.start();
    return { def, state: h.state() };
  }

  it('no states (or no match) -> base rect/style, stateId null', async () => {
    const { def, state } = await startedState();
    expect(resolveElementAppearance(def, state, shapeEl(undefined), 'p0'))
      .toEqual({ rect: baseRect, style: baseStyle, stateId: null });
    // night is false and lp is forced to 0 -> neither state matches.
    const broke: GameState = {
      ...state,
      players: state.players.map((p) => ({ ...p, vars: { ...p.vars, lp: 0 } })),
    };
    expect(resolveElementAppearance(def, broke, shapeEl([nightState, aliveState]), 'p0'))
      .toEqual({ rect: baseRect, style: baseStyle, stateId: null });
  });

  it('the FIRST matching state wins when several hold', async () => {
    const { def, state } = await startedState();
    // At night both states hold -> the night state (listed first) applies.
    const app = resolveElementAppearance(def, atNight(state), shapeEl([nightState, aliveState]), 'p0');
    expect(app.stateId).toBe('st_night');
    // Reversed order, same truths -> the other one wins.
    const flipped = resolveElementAppearance(
      def, atNight(state), shapeEl([aliveState, nightState]), 'p0',
    );
    expect(flipped.stateId).toBe('st_alive');
  });

  it('the matched style merges OVER the base style', async () => {
    const { def, state } = await startedState();
    // lp 8000 > 0 -> alive state: borderColor overridden, background kept.
    const app = resolveElementAppearance(def, state, shapeEl([nightState, aliveState]), 'p0');
    expect(app.stateId).toBe('st_alive');
    expect(app.style).toEqual({ background: '#111', borderColor: 'blue' });
    // Night state overrides background and keeps the base border.
    const night = resolveElementAppearance(def, atNight(state), shapeEl([nightState]), 'p0');
    expect(night.style).toEqual({ background: 'red', borderColor: '#888' });
  });

  it('a state rect replaces the base rect; rect-less states keep it', async () => {
    const { def, state } = await startedState();
    const night = resolveElementAppearance(def, atNight(state), shapeEl([nightState]), 'p0');
    expect(night.rect).toEqual(bigRect);
    const alive = resolveElementAppearance(def, state, shapeEl([aliveState]), 'p0');
    expect(alive.rect).toEqual(baseRect);
    // rect: null is the explicit "no override" spelling.
    const nullRect = resolveElementAppearance(
      def, state, shapeEl([{ ...aliveState, rect: null }]), 'p0',
    );
    expect(nullRect.rect).toEqual(baseRect);
  });

  it('binds $viewer to the viewer (per-seat appearances)', async () => {
    const { def, state } = await startedState();
    // p0 at 0 lp: their dot falls back to base; p1 still matches.
    const broke: GameState = {
      ...state,
      players: state.players.map((p) => (
        p.id === 'p0' ? { ...p, vars: { ...p.vars, lp: 0 } } : p
      )),
    };
    const el = shapeEl([aliveState]);
    expect(resolveElementAppearance(def, broke, el, 'p0').stateId).toBeNull();
    expect(resolveElementAppearance(def, broke, el, 'p1').stateId).toBe('st_alive');
  });

  it('a failing when-expression skips the state instead of throwing', async () => {
    const { def, state } = await startedState();
    const el = shapeEl([
      { id: 'st_bad', name: 'Bad', when: gv('no_such_var'), style: { background: 'red' } },
      aliveState,
    ]);
    expect(resolveElementAppearance(def, state, el, 'p0').stateId).toBe('st_alive');
  });

  it('phaseIndex/phasePos states track real phases (current/done/upcoming)', async () => {
    const phaseIndex: Expr = { kind: 'phaseIndex' };
    const phasePos = (phaseId: string): Expr => ({ kind: 'phasePos', phaseId });
    const dot = (phaseId: string): ScreenElement => ({
      kind: 'shape', id: `el_${phaseId}`, name: phaseId, rect: baseRect, shape: 'circle',
      style: baseStyle,
      states: [
        { id: 'st_cur', name: 'Current', when: cmp('==', phaseIndex, phasePos(phaseId)) },
        { id: 'st_done', name: 'Done', when: cmp('>', phaseIndex, phasePos(phaseId)) },
      ],
    });
    // 'idle' keeps each phase waiting for input (else the engine skips it).
    const def = makeDef({
      zones: [zone('deck')],
      phases: [phaseDef('draw', 'manual', ['idle']), phaseDef('main', 'manual', ['idle'])],
    });
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    expect(state.phaseIdx).toBe(0);

    // Phase 0 ("draw"): its dot is current, "main" is upcoming (no match).
    expect(resolveElementAppearance(def, state, dot('draw'), 'p0').stateId).toBe('st_cur');
    expect(resolveElementAppearance(def, state, dot('main'), 'p0').stateId).toBeNull();
    // Phase 1: "draw" flips to done, "main" becomes current.
    const later: GameState = { ...state, phaseIdx: 1 };
    expect(resolveElementAppearance(def, later, dot('draw'), 'p0').stateId).toBe('st_done');
    expect(resolveElementAppearance(def, later, dot('main'), 'p0').stateId).toBe('st_cur');
  });
});

describe('seat refs against real zone instances', () => {
  it('resolves viewer/opp seats to engine zone instance keys', async () => {
    const def = screenDef();
    const h = harness(def, { players: ['Alice', 'Bob'] });
    await h.engine.start();
    const state = h.state();
    const ids = state.players.map((p) => p.id);

    expect(resolveSeat(ids, 'p0', 'viewer', state.currentPlayerIdx)).toBe('p0');
    const opp = resolveSeat(ids, 'p0', 'opp1', state.currentPlayerIdx);
    expect(opp).toBe('p1');
    expect(state.zones[zoneInstKey('hand', opp)]).toBeDefined();
    expect(state.zones[zoneInstKey('hand', 'p0')]).toBeDefined();
    expect(state.zones[zoneInstKey('deck', null)]).toBeDefined();
    // 2-player table: opp2/opp3 elements skip rendering.
    expect(resolveSeat(ids, 'p0', 'opp2', state.currentPlayerIdx)).toBeNull();
    expect(resolveSeat(ids, 'p0', 'opp3', state.currentPlayerIdx)).toBeNull();
  });

  it("'current' rebinds to the acting seat's instance as the turn passes", async () => {
    const def = screenDef();
    const h = harness(def, { players: ['Alice', 'Bob'] });
    await h.engine.start();
    const state = h.state();
    const ids = state.players.map((p) => p.id);

    // Whoever views, 'current' follows state.currentPlayerIdx.
    const now = resolveSeat(ids, 'p1', 'current', state.currentPlayerIdx);
    expect(now).toBe(ids[state.currentPlayerIdx]);
    expect(state.zones[zoneInstKey('hand', now)]).toBeDefined();
    const passed: GameState = { ...state, currentPlayerIdx: 1 };
    expect(resolveSeat(ids, 'p0', 'current', passed.currentPlayerIdx)).toBe('p1');
    expect(resolveSeat(ids, 'p1', 'current', passed.currentPlayerIdx)).toBe('p1');
  });
});

/** A shared supply of priced cards + per-player hands + a shared trash. */
function supplyDef(): GameDef {
  return makeDef({
    zones: [zone('supply'), pzone('hand'), zone('trash')],
    cards: [cdef('copper', { cost: 0 }), cdef('silver', { cost: 3 }), cdef('gold', { cost: 6 })],
    decks: [customDeck('d', 'supply', [['copper', 2], ['silver', 1], ['gold', 1]])],
  });
}

describe('display-only card filters (filterDisplayCards)', () => {
  it('slices a real zone by a $card expression without touching state', async () => {
    const def = supplyDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    const ids = state.zones.supply.cardIds;
    expect(ids).toHaveLength(4);

    const cheap = filterDisplayCards(
      def, state, ids, cmp('<=', fld(bnd('$card'), 'cost'), num(3)), 'p0',
    );
    expect(cheap.map((id) => state.cards[id].name).sort()).toEqual(['copper', 'copper', 'silver']);
    expect(state.zones.supply.cardIds).toHaveLength(4); // untouched

    const rich = filterDisplayCards(
      def, state, ids, cmp('>', fld(bnd('$card'), 'cost'), num(3)), 'p0',
    );
    expect(rich.map((id) => state.cards[id].name)).toEqual(['gold']);
  });

  it('null filter keeps every card; $viewer stays bound inside the filter', async () => {
    const def = supplyDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    const ids = state.zones.supply.cardIds;

    expect(filterDisplayCards(def, state, ids, null, 'p0')).toEqual([...ids]);
    const mine: Expr = cmp('==', bnd('$viewer'), str('p0'));
    expect(filterDisplayCards(def, state, ids, mine, 'p0')).toEqual([...ids]);
    expect(filterDisplayCards(def, state, ids, mine, 'p1')).toEqual([]);
  });

  it('a failing filter hides cards instead of throwing (display contract)', async () => {
    const def = supplyDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    expect(filterDisplayCards(def, state, state.zones.supply.cardIds, gv('no_such'), 'p0'))
      .toEqual([]);
  });
});

describe('burn zone instance keys (burnZoneKeys)', () => {
  const rect = { x: 0, y: 0, w: 10, h: 10 };

  it('collects shared + seat-resolved instances, walking groups', async () => {
    const def = supplyDef();
    const h = harness(def); // Alice (p0), Bob (p1)
    await h.engine.start();
    const state = h.state();
    const elements: ScreenElement[] = [
      { kind: 'zone', id: 'z1', name: 'Trash', rect, zoneId: 'trash', seat: 'shared', arriveEffect: 'burn' },
      {
        kind: 'group',
        id: 'g1',
        name: 'Harbor',
        rect,
        children: [
          { kind: 'zone', id: 'z2', name: 'Hand', rect, zoneId: 'hand', seat: 'viewer', arriveEffect: 'burn' },
        ],
      },
      { kind: 'zone', id: 'z3', name: 'Opp hand', rect, zoneId: 'hand', seat: 'opp1', arriveEffect: 'none' },
      // Seat beyond the table and dangling zone ids resolve to nothing.
      { kind: 'zone', id: 'z4', name: 'Ghost seat', rect, zoneId: 'hand', seat: 'opp3', arriveEffect: 'burn' },
      { kind: 'zone', id: 'z5', name: 'Ghost zone', rect, zoneId: 'gone', seat: 'shared', arriveEffect: 'burn' },
      { kind: 'zone', id: 'z6', name: 'Supply', rect, zoneId: 'supply', seat: 'shared' },
    ];
    expect(burnZoneKeys(def, state, elements, 'p1')).toEqual(new Set(['trash', 'hand:p1']));
    expect(burnZoneKeys(def, state, elements, 'p0')).toEqual(new Set(['trash', 'hand:p0']));
  });
});

describe('display text rendering (renderDisplayValue / renderTextParts)', () => {
  it('player and card ids render as names; plain values stringify', async () => {
    const def = supplyDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    expect(renderDisplayValue(state, 'p0')).toBe('Alice');
    expect(renderDisplayValue(state, 'p1')).toBe('Bob');
    const cardId = state.zones.supply.cardIds[0];
    expect(renderDisplayValue(state, cardId)).toBe(state.cards[cardId].name);
    expect(renderDisplayValue(state, 'no-such-id')).toBe('no-such-id');
    expect(renderDisplayValue(state, 7)).toBe('7');
    expect(renderDisplayValue(state, true)).toBe('true');
    expect(renderDisplayValue(state, null)).toBe('');
  });

  it('parts interpolate display expressions like announce', async () => {
    const def = supplyDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    expect(renderTextParts(def, state, ['TURN ', { kind: 'turnNumber' }], 'p0')).toBe('TURN 1');
    expect(renderTextParts(def, state, [{ kind: 'currentPlayer' }, ' to play'], 'p0'))
      .toBe('Alice to play');
    const top: Expr = { kind: 'topCard', zone: { zoneId: 'supply', owner: null } };
    expect(renderTextParts(def, state, ['Top: ', top], 'p0')).toBe('Top: gold');
    // A failing expression renders as '' instead of breaking the line.
    expect(renderTextParts(def, state, ['x', gv('no_such'), 'y'], 'p0')).toBe('xy');
  });
});

describe('onChangeAnim content signatures (elementContentSig)', () => {
  const rect = { x: 0, y: 0, w: 10, h: 10 };

  it('text parts + varText values + state ids feed the signature', async () => {
    const def = screenDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();

    const textEl: ScreenElement = {
      kind: 'text', id: 't', name: 't', rect, text: 'static',
      parts: ['night=', gv('night')], fontSize: 2, align: 'left',
    };
    const day = elementContentSig(def, state, textEl, 'p0', null);
    const night = elementContentSig(def, atNight(state), textEl, 'p0', null);
    expect(day).not.toBe(night);
    expect(day).toContain('night=false');
    // The active state id changes the signature even with identical text.
    expect(elementContentSig(def, state, textEl, 'p0', 'stA')).not.toBe(day);

    const lpEl: ScreenElement = {
      kind: 'varText', id: 'v', name: 'v', rect, varId: 'lp', seat: 'viewer',
      fontSize: 2, align: 'left',
    };
    const before = elementContentSig(def, state, lpEl, 'p0', null);
    const drained: GameState = {
      ...state,
      players: state.players.map((p) => (p.id === 'p0' ? { ...p, vars: { ...p.vars, lp: 0 } } : p)),
    };
    expect(elementContentSig(def, drained, lpEl, 'p0', null)).not.toBe(before);
    expect(elementContentSig(def, drained, lpEl, 'p1', null)).toBe(before); // other seat untouched

    // Elements without text content key on the state id alone.
    const dot: ScreenElement = { kind: 'shape', id: 's', name: 's', rect, shape: 'circle' };
    expect(elementContentSig(def, state, dot, 'p0', null))
      .not.toBe(elementContentSig(def, state, dot, 'p0', 'st1'));
  });

  it('a text element without parts keys on its static text', async () => {
    const def = screenDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    const el: ScreenElement = {
      kind: 'text', id: 't', name: 't', rect, text: 'SEAL', fontSize: 2, align: 'center',
    };
    expect(elementContentSig(def, state, el, 'p0', null)).toBe('|SEAL');
  });
});

// ---------------------------------------------------------------------------
// Selector buttons: selection store + context resolution + gating
// ---------------------------------------------------------------------------

/** A selector radio set (group `g`) + one loose selector of another group. */
function selectorEls(prefix: string, group: string): ScreenElement[] {
  const btn = (id: string, label: string): ScreenElement => ({
    kind: 'button', id: `${prefix}_${id}`, name: label, rect, actionId: null,
    label, role: 'selector', selectorGroup: group,
  });
  return [
    {
      kind: 'group',
      id: `${prefix}_bar`,
      name: 'Switcher',
      rect,
      children: [btn('b1', 'One'), btn('b2', 'Two'), btn('b3', 'Three')],
    },
    {
      kind: 'button', id: `${prefix}_other`, name: 'Other', rect, actionId: null,
      label: 'Other', role: 'selector', selectorGroup: `${group}_other`,
    },
  ];
}

describe('selector buttons (selection store + resolution + gating)', () => {
  it('selStorageKey mirrors the collapse-key pattern', () => {
    expect(selStorageKey('game1', 'supply')).toBe('cardsmith.sel.game1.supply');
  });

  it('write/read roundtrip works without localStorage; unchanged writes are no-ops', () => {
    // Node env: no localStorage — the in-session mirror carries everything.
    expect(readSelection('g', 'sw1')).toBeNull();
    let pings = 0;
    const off = subscribeSelection(() => { pings += 1; });
    const v0 = selectionVersion();
    writeSelection('g', 'sw1', 'btnA');
    expect(readSelection('g', 'sw1')).toBe('btnA');
    expect(selectionVersion()).toBe(v0 + 1);
    expect(pings).toBe(1);
    writeSelection('g', 'sw1', 'btnA'); // unchanged: no bump, no ping
    expect(selectionVersion()).toBe(v0 + 1);
    expect(pings).toBe(1);
    writeSelection('g', 'sw1', 'btnB');
    expect(readSelection('g', 'sw1')).toBe('btnB');
    expect(pings).toBe(2);
    off();
    writeSelection('g', 'sw1', 'btnC');
    expect(pings).toBe(2); // unsubscribed
  });

  it('selectorContextFrom: stored wins while valid, else the FIRST in paint order', () => {
    const els = selectorEls('sc', 'swA');
    // No stored choice: the first button of each group (nested walk order).
    const fresh = selectorContextFrom(els, () => null);
    expect(fresh.active.get('swA')).toBe('sc_b1');
    expect(fresh.active.get('swA_other')).toBe('sc_other');
    expect(fresh.groupOf.get('sc_b2')).toBe('swA');
    // Stored + valid wins; a stale id (button deleted) falls back to first.
    const stored = selectorContextFrom(els, (g) => (g === 'swA' ? 'sc_b3' : null));
    expect(stored.active.get('swA')).toBe('sc_b3');
    const stale = selectorContextFrom(els, (g) => (g === 'swA' ? 'ghost' : null));
    expect(stale.active.get('swA')).toBe('sc_b1');
  });

  it('max-1 invariant: every group maps to exactly ONE active button', () => {
    const els = selectorEls('mx', 'swB');
    const ctx = selectorContextFrom(els, (g) => (g === 'swB' ? 'mx_b2' : null));
    // One entry per group; b2 selected means b1/b3 are NOT active.
    expect([...ctx.active.keys()].sort()).toEqual(['swB', 'swB_other']);
    expect(ctx.active.get('swB')).toBe('mx_b2');
    const activeOfB = ['mx_b1', 'mx_b2', 'mx_b3'].filter(
      (id) => ctx.active.get('swB') === id,
    );
    expect(activeOfB).toEqual(['mx_b2']);
  });

  it('non-selector buttons and group-less selectors never join a radio set', () => {
    const els: ScreenElement[] = [
      { kind: 'button', id: 'a1', name: 'Act', rect, actionId: 'shout', label: 'Act' },
      { kind: 'button', id: 'a2', name: 'NoGroup', rect, actionId: null, label: 'NG', role: 'selector' },
      { kind: 'button', id: 'a3', name: 'Blank', rect, actionId: null, label: 'B', role: 'selector', selectorGroup: '  ' },
      { kind: 'button', id: 'a4', name: 'Real', rect, actionId: null, label: 'R', role: 'selector', selectorGroup: 'swC' },
    ];
    const ctx = selectorContextFrom(els, () => null);
    expect([...ctx.groupOf.keys()]).toEqual(['a4']);
    expect(ctx.active.get('swC')).toBe('a4');
  });

  it('selectorGateOpen: gates to the active button; dangling targets stay open', () => {
    const els = selectorEls('gt', 'swD');
    const ctx = selectorContextFrom(els, () => null); // b1 active
    const panel = (showFor: string | undefined): ScreenElement => ({
      kind: 'text', id: 'tx', name: 'T', rect, text: 't', fontSize: 2, align: 'left',
      ...(showFor !== undefined ? { showForSelector: showFor } : {}),
    });
    expect(selectorGateOpen(ctx, panel(undefined))).toBe(true);
    expect(selectorGateOpen(ctx, panel('gt_b1'))).toBe(true);
    expect(selectorGateOpen(ctx, panel('gt_b2'))).toBe(false);
    // Dangling / non-selector target: warn-only — the element stays shown.
    expect(selectorGateOpen(ctx, panel('no_such_button'))).toBe(true);
  });

  it('visibleButtonActionIds: selector buttons never count; gated buttons stay in the bar', async () => {
    const def = screenDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    const els: ScreenElement[] = [
      // A selector button carrying a (ignored) actionId must NOT claim it.
      {
        kind: 'button', id: 'sb1', name: 'Sel', rect, actionId: 'shout',
        label: 'Sel', role: 'selector', selectorGroup: 'vb_sw',
      },
      {
        kind: 'button', id: 'sb2', name: 'Sel2', rect, actionId: null,
        label: 'Sel2', role: 'selector', selectorGroup: 'vb_sw',
      },
      // Bound to sb2 (NOT the default sb1): hidden -> its action stays in the bar.
      {
        kind: 'group', id: 'vb_panel2', name: 'P2', rect, showForSelector: 'sb2',
        children: [
          { kind: 'button', id: 'vb_endit', name: 'End it', rect, actionId: 'endit', label: 'End it' },
        ],
      },
      // Bound to the default sb1: visible.
      {
        kind: 'group', id: 'vb_panel1', name: 'P1', rect, showForSelector: 'sb1',
        children: [
          { kind: 'button', id: 'vb_cheer', name: 'Cheer', rect, actionId: 'cheer', label: 'Cheer' },
        ],
      },
    ];
    expect(visibleButtonActionIds(def, state, els, 'p0')).toEqual(new Set(['cheer']));
    // Switch to sb2: the panels swap which action is on screen.
    writeSelection(def.meta.id, 'vb_sw', 'sb2');
    expect(visibleButtonActionIds(def, state, els, 'p0')).toEqual(new Set(['endit']));
  });

  // Cross-tab sync: the 'storage' listener funnels into applyExternalSelection
  // (node has no storage events — the seam is exercised directly).
  describe('applyExternalSelection (cross-tab storage events)', () => {
    it('mirrors another tab\'s write over a shadowing in-session value and notifies', () => {
      writeSelection('gx', 'swX', 'btnLocal'); // this tab has written: memory shadows
      let pings = 0;
      const off = subscribeSelection(() => { pings += 1; });
      const v0 = selectionVersion();
      applyExternalSelection(selStorageKey('gx', 'swX'), 'btnRemote');
      expect(readSelection('gx', 'swX')).toBe('btnRemote'); // shadow updated
      expect(selectionVersion()).toBe(v0 + 1);
      expect(pings).toBe(1);
      off();
    });

    it('ignores non-selection keys and already-mirrored values', () => {
      writeSelection('gy', 'swY', 'btnA');
      let pings = 0;
      const off = subscribeSelection(() => { pings += 1; });
      const v0 = selectionVersion();
      applyExternalSelection('cardsmith.games.v1', 'whatever'); // games store, not ours
      applyExternalSelection('unrelated.key', 'x');
      applyExternalSelection(selStorageKey('gy', 'swY'), 'btnA'); // no change
      expect(selectionVersion()).toBe(v0);
      expect(pings).toBe(0);
      expect(readSelection('gy', 'swY')).toBe('btnA');
      off();
    });

    it('a removed key drops the mirror; key null (clear) drops everything', () => {
      writeSelection('gz', 'swZ', 'btnB');
      applyExternalSelection(selStorageKey('gz', 'swZ'), null);
      // Node env: no localStorage behind the mirror -> back to never-set.
      expect(readSelection('gz', 'swZ')).toBeNull();

      writeSelection('gz', 'swZ', 'btnC');
      let pings = 0;
      const off = subscribeSelection(() => { pings += 1; });
      applyExternalSelection(null, null); // localStorage.clear() elsewhere
      expect(readSelection('gz', 'swZ')).toBeNull();
      expect(pings).toBe(1);
      off();
    });
  });
});

describe('chronicle rows (logRows)', () => {
  const entries = [
    { turn: 1, text: 'Alice drew' },
    { turn: 1, text: 'Alice played copper' },
    { turn: 2, text: 'Bob drew' },
  ];

  it('inserts a Turn divider before each turn’s first entry', () => {
    expect(logRows(entries, true)).toEqual([
      { kind: 'sep', turn: 1 },
      { kind: 'entry', index: 0, turn: 1, text: 'Alice drew' },
      { kind: 'entry', index: 1, turn: 1, text: 'Alice played copper' },
      { kind: 'sep', turn: 2 },
      { kind: 'entry', index: 2, turn: 2, text: 'Bob drew' },
    ]);
  });

  it('turnSeparators off renders entries only; empty logs render nothing', () => {
    expect(logRows(entries, false).every((r) => r.kind === 'entry')).toBe(true);
    expect(logRows(entries, false)).toHaveLength(3);
    expect(logRows([], true)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// panelSwitcher recursion: the visible-actions + burn-zone walks must descend
// into a panelSwitcher's children, not only into `group`s (review fix).
// ---------------------------------------------------------------------------

describe('panelSwitcher is walked by visibleButtonActionIds + burnZoneKeys', () => {
  const rect = { x: 0, y: 0, w: 10, h: 10 };

  function switcherDef(): GameDef {
    const ps: ScreenElement = {
      kind: 'panelSwitcher', id: 'ps', name: 'Switcher', rect, selectorGroup: 'g',
      slots: [
        { id: 'tabs', name: 'Tabs', accepts: ['button'], layout: { mode: 'row' } },
        { id: 'content', name: 'Content', single: true, layout: { mode: 'column' } },
      ],
      children: [
        {
          kind: 'button', id: 'tab_a', name: 'A', rect, actionId: null, label: 'A',
          role: 'selector', selectorGroup: 'g', slotId: 'tabs',
        },
        {
          kind: 'group', id: 'panel_a', name: 'Panel A', rect,
          showForSelector: 'tab_a', slotId: 'content',
          children: [
            { kind: 'button', id: 'b1', name: 'Act', rect, actionId: 'act', label: 'Act' },
            { kind: 'zone', id: 'zt', name: 'Trash', rect, zoneId: 'trash', seat: 'shared', arriveEffect: 'burn' },
          ],
        },
      ],
    };
    return makeDef({
      zones: [zone('trash'), pzone('hand')],
      phases: [phaseDef('main', 'manual', ['act'])],
      actions: [actionDef('act')],
      screenLayout: { aspect: null, elements: [ps] },
    });
  }

  it('counts an action button inside a (default-selected) content panel', async () => {
    const def = switcherDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    // The panelSwitcher and its first tab's panel are visible by default, so
    // the nested action button's move IS a visible screen control (and must
    // therefore leave the auto action bar).
    expect(visibleButtonActionIds(def, state, def.screenLayout!.elements, 'p0'))
      .toEqual(new Set(['act']));
  });

  it('collects a burn zone nested in a content panel', async () => {
    const def = switcherDef();
    const h = harness(def);
    await h.engine.start();
    const state = h.state();
    expect(burnZoneKeys(def, state, def.screenLayout!.elements, 'p0'))
      .toEqual(new Set(['trash']));
  });
});
