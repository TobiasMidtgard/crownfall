import { describe, expect, it } from 'vitest';
import type { Block, GameDef } from '../shared/types';
import {
  ann, bnd, cdef, cmp, curP, customDeck, cv, fld, gv, harness, idByName, makeDef, math, mv, namesIn,
  num, pzone, selAll, selBottom, selFilter, selRandom, selSpec, selTop, str, sv, topC, vdef, zone, zr,
} from './testkit';

/** Zones a..e spawn five cards c1(bottom)..c5(top) into 'a'. */
function twoZones(setup: Block[], extra: Partial<GameDef> = {}): GameDef {
  return makeDef({
    zones: [zone('a'), zone('b')],
    cards: [cdef('c1', { v: 1 }), cdef('c2', { v: 2 }), cdef('c3', { v: 3 }), cdef('c4', { v: 4 }), cdef('c5', { v: 5 })],
    decks: [customDeck('d', 'a', ['c1', 'c2', 'c3', 'c4', 'c5'])],
    setup,
    ...extra,
  });
}

async function runSetup(setup: Block[], extra: Partial<GameDef> = {}) {
  const h = harness(twoZones(setup, extra));
  await h.engine.start();
  return h;
}

describe('moveCards', () => {
  it('moves top N preserving order (source top stays on top)', async () => {
    const h = await runSetup([mv(zr('a'), zr('b'), selTop(2))]);
    expect(namesIn(h.state(), 'a')).toEqual(['c1', 'c2', 'c3']);
    expect(namesIn(h.state(), 'b')).toEqual(['c4', 'c5']);
  });

  it('moves bottom N', async () => {
    const h = await runSetup([mv(zr('a'), zr('b'), selBottom(2))]);
    expect(namesIn(h.state(), 'a')).toEqual(['c3', 'c4', 'c5']);
    expect(namesIn(h.state(), 'b')).toEqual(['c1', 'c2']);
  });

  it('moves all', async () => {
    const h = await runSetup([mv(zr('a'), zr('b'), selAll)]);
    expect(namesIn(h.state(), 'a')).toEqual([]);
    expect(namesIn(h.state(), 'b')).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('moves by filter ($card bound per candidate)', async () => {
    const h = await runSetup([mv(zr('a'), zr('b'), selFilter(cmp('>', fld(bnd('$card'), 'v'), num(3))))]);
    expect(namesIn(h.state(), 'a')).toEqual(['c1', 'c2', 'c3']);
    expect(namesIn(h.state(), 'b')).toEqual(['c4', 'c5']);
  });

  it("moves a specific card from its ACTUAL zone (the from ref is advisory)", async () => {
    // `from` says zone b, but the top card of a lives in a — engine uses a.
    const h = await runSetup([mv(zr('b'), zr('b'), selSpec(topC(zr('a'))))]);
    expect(namesIn(h.state(), 'a')).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(namesIn(h.state(), 'b')).toEqual(['c5']);
  });

  it('moves N random cards deterministically, preserving relative order', async () => {
    const pick = async (seed: number) => {
      const h = harness(twoZones([mv(zr('a'), zr('b'), selRandom(2))]), { seed });
      await h.engine.start();
      return namesIn(h.state(), 'b');
    };
    const a = await pick(1);
    expect(a).toHaveLength(2);
    expect(await pick(1)).toEqual(a);
    // Relative order from the source is preserved (c-numbers ascend).
    const nums = a.map((n) => Number(n.slice(1)));
    expect(nums[0]).toBeLessThan(nums[1]);
  });

  it('clamps top count to what is available', async () => {
    const h = await runSetup([mv(zr('a'), zr('b'), selTop(99))]);
    expect(namesIn(h.state(), 'b')).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('inserts under the pile with toPosition bottom, keeping group order', async () => {
    const h = await runSetup([
      mv(zr('a'), zr('b'), selBottom(2)),                          // b: c1,c2
      mv(zr('a'), zr('b'), selTop(2), { toPosition: 'bottom' }),   // group c4,c5 goes UNDER
    ]);
    expect(namesIn(h.state(), 'b')).toEqual(['c4', 'c5', 'c1', 'c2']);
  });

  it('applies faceUp; null keeps each card facing', async () => {
    const h = await runSetup([
      mv(zr('a'), zr('b'), selTop(2), { faceUp: false }),
      mv(zr('a'), zr('b'), selTop(1)), // faceUp null — stays face up
    ]);
    const s = h.state();
    expect(s.cards[idByName(s, 'c4')].faceUp).toBe(false);
    expect(s.cards[idByName(s, 'c5')].faceUp).toBe(false);
    expect(s.cards[idByName(s, 'c3')].faceUp).toBe(true);
  });
});

describe('flipCards', () => {
  it('flips selected cards in place', async () => {
    const h = await runSetup([{ kind: 'flipCards', zone: zr('a'), cards: selTop(2), faceUp: false }]);
    const s = h.state();
    expect(namesIn(s, 'a')).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(s.cards[idByName(s, 'c5')].faceUp).toBe(false);
    expect(s.cards[idByName(s, 'c1')].faceUp).toBe(true);
  });
});

describe('shuffle block', () => {
  it('is deterministic by seed', async () => {
    const order = async (seed: number) => {
      const h = harness(twoZones([{ kind: 'shuffle', zone: zr('a') }]), { seed });
      await h.engine.start();
      return namesIn(h.state(), 'a');
    };
    expect(await order(3)).toEqual(await order(3));
    expect(await order(3)).not.toEqual(await order(4));
  });
});

describe('deal', () => {
  const dealDef = (count: number, players: string[]) => makeDef({
    zones: [zone('deck'), pzone('hand')],
    cards: [cdef('c1'), cdef('c2'), cdef('c3'), cdef('c4'), cdef('c5'), cdef('c6'), cdef('c7')],
    decks: [customDeck('d', 'deck', ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])],
    setup: [{ kind: 'deal', from: zr('deck'), toZoneId: 'hand', count: num(count) }],
  });

  it('deals round-robin from the top, starting at the current player', async () => {
    const h = harness(dealDef(2, ['A', 'B', 'C']), { players: ['A', 'B', 'C'] });
    await h.engine.start();
    const s = h.state();
    expect(namesIn(s, 'hand:p0')).toEqual(['c7', 'c4']);
    expect(namesIn(s, 'hand:p1')).toEqual(['c6', 'c3']);
    expect(namesIn(s, 'hand:p2')).toEqual(['c5', 'c2']);
    expect(namesIn(s, 'deck')).toEqual(['c1']);
  });

  it('stops early when the source runs out', async () => {
    const h = harness(dealDef(5, ['A', 'B', 'C']), { players: ['A', 'B', 'C'] });
    await h.engine.start();
    const s = h.state();
    expect(namesIn(s, 'hand:p0')).toHaveLength(3);
    expect(namesIn(s, 'hand:p1')).toHaveLength(2);
    expect(namesIn(s, 'hand:p2')).toHaveLength(2);
    expect(namesIn(s, 'deck')).toEqual([]);
  });
});

describe('variables', () => {
  it('set/change global vars', async () => {
    const h = harness(makeDef({
      variables: [vdef('n', 'global', 'number', 0)],
      setup: [sv('n', num(4)), cv('n', num(3))],
    }));
    await h.engine.start();
    expect(h.state().globalVars['n']).toBe(7);
  });

  it('perPlayer vars: explicit target and contextual ($player, else current player)', async () => {
    const h = harness(makeDef({
      variables: [vdef('score', 'perPlayer', 'number', 0)],
      setup: [
        sv('score', num(10)),                                    // contextual → current player p0
        sv('score', num(20), { kind: 'nextPlayer', from: curP }), // explicit → p1
        { kind: 'forEachPlayer', body: [cv('score', num(1))] },   // contextual → $player
      ],
    }));
    await h.engine.start();
    const s = h.state();
    expect(s.players[0].vars['score']).toBe(11);
    expect(s.players[1].vars['score']).toBe(21);
  });

  it('perCard vars: contextual uses $card, then $self; errors without either', async () => {
    const h = await runSetup(
      [
        { kind: 'forEachCard', zone: zr('a'), filter: null, body: [sv('mark', fld(bnd('$card'), 'v'))] },
        sv('mark', num(9)), // no $card/$self bound → script error, skipped
      ],
      { variables: [vdef('mark', 'perCard', 'number', 0)] },
    );
    const s = h.state();
    expect(s.cards[idByName(s, 'c3')].vars['mark']).toBe(3);
    expect(h.errors.some((e) => e.includes('mark'))).toBe(true);
  });

  it('coerces to the declared type', async () => {
    const h = harness(makeDef({
      variables: [vdef('s', 'global', 'string', ''), vdef('b', 'global', 'boolean', false)],
      setup: [sv('s', num(5)), sv('b', num(1))],
    }));
    await h.engine.start();
    expect(h.state().globalVars['s']).toBe('5');
    expect(h.state().globalVars['b']).toBe(true);
  });
});

describe('control structures', () => {
  it('if takes the matching branch', async () => {
    const h = harness(makeDef({
      variables: [vdef('n', 'global', 'number', 0)],
      setup: [
        { kind: 'if', cond: cmp('==', num(1), num(1)), then: [sv('n', num(1))], else: [sv('n', num(2))] },
        { kind: 'if', cond: cmp('==', num(1), num(2)), then: [], else: [cv('n', num(10))] },
      ],
    }));
    await h.engine.start();
    expect(h.state().globalVars['n']).toBe(11);
  });

  it('repeat runs N times and clamps negatives to 0', async () => {
    const h = harness(makeDef({
      variables: [vdef('n', 'global', 'number', 0)],
      setup: [
        { kind: 'repeat', times: num(4), body: [cv('n', num(1))] },
        { kind: 'repeat', times: num(-2), body: [cv('n', num(100))] },
      ],
    }));
    await h.engine.start();
    expect(h.state().globalVars['n']).toBe(4);
  });

  it('forEachPlayer iterates seating order from the current player', async () => {
    const h = harness(
      makeDef({ setup: [{ kind: 'forEachPlayer', body: [ann(bnd('$player'))] }] }),
      { players: ['A', 'B', 'C'] },
    );
    await h.engine.start();
    expect(h.state().log.map((l) => l.text)).toEqual(['A', 'B', 'C']);
  });

  it('forEachCard snapshots matches before iterating and binds $card', async () => {
    // Move each card with v >= 3 — moving mid-loop must not skip candidates.
    const h = await runSetup([{
      kind: 'forEachCard', zone: zr('a'), filter: cmp('>=', fld(bnd('$card'), 'v'), num(3)),
      body: [mv(zr('a'), zr('b'), selSpec(bnd('$card')))],
    }]);
    expect(namesIn(h.state(), 'b')).toEqual(['c3', 'c4', 'c5']);
  });
});

describe('announce', () => {
  it('renders player ids and card ids as names', async () => {
    const h = await runSetup([ann('Hi ', curP, ', top is ', topC(zr('a')), ' #', math('+', num(1), num(2)))]);
    expect(h.state().log[0]).toEqual({ turn: 1, text: 'Hi Alice, top is c5 #3' });
  });
});

describe('expression edge cases', () => {
  it('division by zero reports and yields 0; getVar of unknown reports null', async () => {
    const h = harness(makeDef({
      variables: [vdef('n', 'global', 'number', 1)],
      setup: [sv('n', math('/', num(5), num(0))), sv('n', gv('ghost'))],
    }));
    await h.engine.start();
    expect(h.state().globalVars['n']).toBe(0);
    expect(h.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('countCards and bestCard work with filters', async () => {
    const h = await runSetup(
      [
        sv('n', { kind: 'countCards', zone: zr('a'), filter: cmp('>', fld(bnd('$card'), 'v'), num(2)) }),
        sv('best', fld({ kind: 'bestCard', zone: zr('a'), by: 'highest', fieldId: 'v', filter: cmp('<', fld(bnd('$card'), 'v'), num(5)) }, 'name')),
      ],
      { variables: [vdef('n', 'global', 'number', 0), vdef('best', 'global', 'string', '')] },
    );
    expect(h.state().globalVars['n']).toBe(3);
    expect(h.state().globalVars['best']).toBe('c4');
  });

  it('unset bindings report and yield null', async () => {
    const h = harness(makeDef({
      variables: [vdef('s', 'global', 'string', 'x')],
      setup: [sv('s', bnd('$choice'))],
    }));
    await h.engine.start();
    expect(h.state().globalVars['s']).toBe('');
    expect(h.errors.some((e) => e.includes('$choice'))).toBe(true);
  });

  it('string compare and logic ops', async () => {
    const h = harness(makeDef({
      variables: [vdef('b', 'global', 'boolean', false)],
      setup: [sv('b', { kind: 'logic', op: 'and', left: cmp('==', str('x'), str('x')), right: { kind: 'not', expr: boolFalse() } })],
    }));
    await h.engine.start();
    expect(h.state().globalVars['b']).toBe(true);
  });
});

function boolFalse() {
  return { kind: 'bool', value: false } as const;
}
