import { describe, expect, it } from 'vitest';
import { isCardVisibleTo } from './index';
import {
  actionDef, bnd, boolE, cdef, cmp, customDeck, cv, fld, harness, idByName, makeDef, mv, num,
  phaseDef, pzone, rnd, selSpec, selTop, std52, sv, vdef, zone, zr,
} from './testkit';

describe('legality enumeration', () => {
  it('cardInZone with ownerOnly=true offers the current player cards passing the filter', async () => {
    const def = makeDef({
      zones: [pzone('hand')],
      cards: [cdef('lo', { v: 1 }), cdef('hi', { v: 9 })],
      decks: [customDeck('d', 'hand', ['lo', 'hi'])], // perPlayer: both players get copies
      phases: [phaseDef('main', 'manual', ['play'])],
      actions: [actionDef('play', {
        target: { kind: 'cardInZone', zoneId: 'hand', ownerOnly: true },
        legality: cmp('>', fld(bnd('$card'), 'v'), num(5)),
      })],
    });
    const h = harness(def);
    await h.engine.start();
    const moves = h.engine.getLegalMoves('p0');
    expect(moves).toHaveLength(1);
    const s = h.state();
    expect(s.zones['hand:p0'].cardIds).toContain(moves[0].cardId);
    expect(s.cards[moves[0].cardId!].name).toBe('hi');
  });

  it('cardInZone with ownerOnly=false enumerates every player instance', async () => {
    const def = makeDef({
      zones: [pzone('field')],
      cards: [cdef('c')],
      decks: [customDeck('d', 'field', [['c', 2]])],
      phases: [phaseDef('main', 'manual', ['zap'])],
      actions: [actionDef('zap', { target: { kind: 'cardInZone', zoneId: 'field', ownerOnly: false } })],
    });
    const h = harness(def);
    await h.engine.start();
    const moves = h.engine.getLegalMoves('p0');
    expect(moves).toHaveLength(4); // 2 cards × 2 players
    const s = h.state();
    const fromP1 = moves.filter((m) => s.zones['field:p1'].cardIds.includes(m.cardId!));
    expect(fromP1).toHaveLength(2);
  });

  it('zone and none targets evaluate legality once', async () => {
    const def = makeDef({
      zones: [zone('deck')],
      cards: [cdef('c')],
      decks: [customDeck('d', 'deck', ['c'])],
      phases: [phaseDef('main', 'manual', ['draw', 'knock'])],
      actions: [
        actionDef('draw', {
          target: { kind: 'zone', zoneId: 'deck', ownerOnly: false },
          legality: cmp('>', { kind: 'zoneCount', zone: zr('deck') }, num(0)),
          script: [mv(zr('deck'), zr('deck'), selTop(0))],
        }),
        actionDef('knock', { legality: boolE(true) }),
      ],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.engine.getLegalMoves('p0')).toEqual([{ actionId: 'draw' }, { actionId: 'knock' }]);
    expect(h.engine.getLegalMoves('p1')).toEqual([]); // not their turn
  });

  it('is side-effect free: random in legality uses a forked RNG', async () => {
    const def = makeDef({
      zones: [zone('deck')],
      decks: [std52('d', 'deck', { shuffle: true })],
      phases: [phaseDef('main', 'manual', ['maybe', 'mix'])],
      actions: [
        actionDef('maybe', { legality: cmp('>=', rnd(6), num(1)) }),
        actionDef('mix', { script: [{ kind: 'shuffle', zone: zr('deck') }] }),
      ],
    });
    const play = async (extraLegalityCalls: number) => {
      const h = harness(def, { seed: 11 });
      await h.engine.start();
      for (let i = 0; i < extraLegalityCalls; i++) h.engine.getLegalMoves('p0');
      await h.engine.performAction('p0', { actionId: 'mix' });
      return JSON.stringify(h.state());
    };
    expect(await play(0)).toBe(await play(25));
  });
});

describe('isCardVisibleTo', () => {
  it('implements the visibility table', async () => {
    const def = makeDef({
      zones: [
        zone('open', { visibility: 'all' }),
        pzone('hand', { visibility: 'owner' }),
        zone('deck', { visibility: 'none' }),
        zone('discard', { visibility: 'topCard' }),
      ],
      cards: [cdef('o1'), cdef('h1'), cdef('n1'), cdef('t1'), cdef('t2'), cdef('o2')],
      decks: [
        customDeck('da', 'open', ['o1', 'o2']),
        customDeck('db', 'deck', ['n1']),
        customDeck('dc', 'discard', ['t1', 't2']),
      ],
      // o2 (top of 'open') moves into the current player's (p0) hand.
      setup: [mv(zr('open'), zr('hand'), selTop(1))],
    });
    const h = harness(def);
    await h.engine.start();
    const s = h.state();
    const d = h.engine.def;
    const vis = (name: string, viewer: string) => isCardVisibleTo(d, s, idByName(s, name), viewer);

    expect(vis('o1', 'p0')).toBe(true);   // all + faceUp → everyone
    expect(vis('o1', 'p1')).toBe(true);
    expect(vis('o2', 'p0')).toBe(true);   // owner zone, owner sees faceUp card
    expect(vis('o2', 'p1')).toBe(false);  // never others
    expect(vis('n1', 'p0')).toBe(false);  // none: never
    expect(vis('n1', 'p1')).toBe(false);
    expect(vis('t2', 'p0')).toBe(true);   // topCard: top visible to everyone
    expect(vis('t2', 'p1')).toBe(true);
    expect(vis('t1', 'p0')).toBe(false);  // rest never
  });

  it('face-down cards are hidden even in all/owner/topCard zones', async () => {
    const def = makeDef({
      zones: [zone('open', { visibility: 'all' }), zone('discard', { visibility: 'topCard' })],
      cards: [cdef('o1'), cdef('t1')],
      decks: [customDeck('da', 'open', ['o1']), customDeck('db', 'discard', ['t1'])],
      setup: [
        { kind: 'flipCards', zone: zr('open'), cards: { kind: 'all' }, faceUp: false },
        { kind: 'flipCards', zone: zr('discard'), cards: { kind: 'all' }, faceUp: false },
      ],
    });
    const h = harness(def);
    await h.engine.start();
    const s = h.state();
    expect(isCardVisibleTo(h.engine.def, s, idByName(s, 'o1'), 'p0')).toBe(false);
    expect(isCardVisibleTo(h.engine.def, s, idByName(s, 't1'), 'p1')).toBe(false);
  });
});

describe('budgets', () => {
  it('aborts a runaway repeat with onScriptError and the game survives', async () => {
    const def = makeDef({
      variables: [vdef('n', 'global', 'number', 0)],
      setup: [{ kind: 'repeat', times: num(1_000_000), body: [cv('n', num(1))] }],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.errors.some((e) => e.includes('budget'))).toBe(true);
    expect(h.state().globalVars['n']).toBeGreaterThan(0); // partial progress kept
    // Engine still playable:
    expect(h.engine.getLegalMoves('p0')).toEqual([{ actionId: 'idle' }]);
    await h.engine.performAction('p0', { actionId: 'idle' });
    expect(h.engine.finished).toBe(false);
  });
});

describe('determinism', () => {
  it('same def + seed + answers produce byte-identical final state', async () => {
    const def = makeDef({
      variables: [vdef('luck', 'global', 'number', 0), vdef('score', 'perPlayer', 'number', 0)],
      zones: [zone('deck', { visibility: 'none' }), pzone('hand', { visibility: 'owner' }), zone('table')],
      decks: [std52('d', 'deck', { shuffle: true })],
      setup: [{ kind: 'deal', from: zr('deck'), toZoneId: 'hand', count: num(5) }],
      phases: [phaseDef('main', 'oneAction', ['play'])],
      actions: [actionDef('play', {
        target: { kind: 'cardInZone', zoneId: 'hand', ownerOnly: true },
        script: [
          mv(zr('hand'), zr('table'), selSpec(bnd('$card'))),
          sv('luck', rnd(100)),
          { kind: 'choose', who: null, choice: { kind: 'yesNo', prompt: 'Bonus?' } },
          { kind: 'if', cond: bnd('$choice'), then: [cv('score', num(1))], else: [] },
          { kind: 'endTurn' },
        ],
      })],
      endConditions: [{
        id: 'e', name: 'e',
        condition: cmp('>=', { kind: 'zoneCount', zone: zr('table') }, num(4)),
        winner: { kind: 'highestVar', varId: 'score' },
      }],
    });
    const play = async () => {
      const h = harness(def, { seed: 123, answers: [true, false, true, false] });
      await h.engine.start();
      while (!h.engine.finished) {
        const pid = h.state().players[h.state().currentPlayerIdx].id;
        const moves = h.engine.getLegalMoves(pid);
        await h.engine.performAction(pid, moves[0]);
      }
      return { json: JSON.stringify(h.state()), updates: h.updates.length, errors: h.errors };
    };
    const a = await play();
    const b = await play();
    expect(a.errors).toEqual([]);
    expect(a.json).toBe(b.json);
    expect(a.updates).toBe(b.updates);
    const final = JSON.parse(a.json) as { result: { winners: string[] } | null };
    expect(final.result).not.toBeNull();
  });

  it('getState returns deep clones (mutating a snapshot cannot corrupt the engine)', async () => {
    const def = makeDef({ zones: [zone('deck')], decks: [std52('d', 'deck')] });
    const h = harness(def);
    await h.engine.start();
    const snap = h.engine.getState();
    snap.zones['deck'].cardIds.length = 0;
    snap.players[0].name = 'Mallory';
    const fresh = h.engine.getState();
    expect(fresh.zones['deck'].cardIds).toHaveLength(52);
    expect(fresh.players[0].name).toBe('Alice');
  });
});
