/**
 * The `draw` block (wave 1a): count/from/refillFrom/to with inline seeded
 * reshuffle when the source runs dry — replaces the 4-block reshuffle macro.
 */
import { describe, expect, it } from 'vitest';
import type { Block, Expr, GameDef, ZoneRef } from '../shared/types';
import {
  cdef, customDeck, cv, harness, makeDef, namesIn, num, pzone, vdef, zone, zr,
} from './testkit';

function drawB(over: Partial<Extract<Block, { kind: 'draw' }>> = {}): Block {
  return {
    kind: 'draw', who: null, count: num(1),
    from: zr('deck'), refillFrom: zr('discard') as ZoneRef | null, to: zr('hand'),
    faceUp: null, ...over,
  };
}

function drawDef(setup: Block[], over: Partial<GameDef> = {}): GameDef {
  return makeDef({
    zones: [zone('deck', { visibility: 'none' }), zone('discard'), pzone('hand')],
    cards: [cdef('c1'), cdef('c2'), cdef('c3'), cdef('c4'), cdef('c5')],
    decks: [
      customDeck('d1', 'deck', ['c1']),
      customDeck('d2', 'discard', ['c2', 'c3', 'c4', 'c5']),
    ],
    setup,
    ...over,
  });
}

describe('draw block', () => {
  it('draws from the top, one card at a time', async () => {
    const def = drawDef([drawB({ count: num(1), refillFrom: null })]);
    const h = harness(def);
    await h.engine.start();
    expect(namesIn(h.state(), 'hand:p0')).toEqual(['c1']);
    expect(h.state().zones['deck'].cardIds).toHaveLength(0);
    expect(h.errors).toEqual([]);
  });

  it('refills from the refill zone (face-down, shuffled) when the source runs dry', async () => {
    const def = drawDef([drawB({ count: num(3) })]);
    const h = harness(def, { seed: 7 });
    await h.engine.start();
    const s = h.state();
    expect(s.zones['hand:p0'].cardIds).toHaveLength(3); // 1 from deck + 2 after refill
    expect(s.zones['discard'].cardIds).toHaveLength(0); // whole discard shuffled in
    expect(s.zones['deck'].cardIds).toHaveLength(2);
    // Refilled cards land face-down in the source.
    for (const cid of s.zones['deck'].cardIds) {
      expect(s.cards[cid].faceUp).toBe(false);
    }
    expect(h.errors).toEqual([]);
  });

  it('reshuffle is deterministic: same seed → same order, different seed diverges', async () => {
    const run = async (seed: number) => {
      const h = harness(drawDef([drawB({ count: num(5) })]), { seed });
      await h.engine.start();
      return namesIn(h.state(), 'hand:p0');
    };
    const a = await run(11);
    const b = await run(11);
    expect(b).toEqual(a);
    expect(a).toHaveLength(5);
    const c = await run(12);
    expect(c).not.toEqual(a); // sanity: the shuffle actually depends on the seed
  });

  it('stops early when source and refill are both empty (no error)', async () => {
    const def = drawDef([drawB({ count: num(99) })]);
    const h = harness(def);
    await h.engine.start();
    expect(h.state().zones['hand:p0'].cardIds).toHaveLength(5);
    expect(h.errors).toEqual([]);
  });

  it('a refill zone that resolves to the source instance is skipped', async () => {
    const def = drawDef([drawB({ count: num(3), refillFrom: zr('deck') })]);
    const h = harness(def);
    await h.engine.start();
    expect(h.state().zones['hand:p0'].cardIds).toHaveLength(1); // deck had 1; no self-refill
    expect(h.errors).toEqual([]);
  });

  it('emits move events tagged "draw" by default; a custom tag overrides', async () => {
    const counter = (tag: string): GameDef['triggers'] => [{
      id: 't', name: 't', condition: null,
      event: { kind: 'cardEnterZone', zoneId: 'hand', tag },
      script: [cv('n', num(1))],
    }];
    const base = (setup: Block[], tag: string) => drawDef(setup, {
      variables: [vdef('n', 'global', 'number', 0)],
      triggers: counter(tag),
    });
    const draws = harness(base([drawB({ count: num(1), refillFrom: null })], 'draw'));
    await draws.engine.start();
    expect(draws.state().globalVars['n']).toBe(1);

    const custom = harness(base([drawB({ count: num(1), refillFrom: null, tag: 'deal' })], 'deal'));
    await custom.engine.start();
    expect(custom.state().globalVars['n']).toBe(1);

    const miss = harness(base([drawB({ count: num(1), refillFrom: null, tag: 'deal' })], 'draw'));
    await miss.engine.start();
    expect(miss.state().globalVars['n']).toBe(0);
  });

  it('`who` sets the contextual player for owner-less perPlayer refs', async () => {
    const nextP: Expr = { kind: 'nextPlayer', from: { kind: 'currentPlayer' } };
    const def = drawDef([drawB({ count: num(2), who: nextP })]);
    const h = harness(def);
    await h.engine.start();
    expect(h.state().zones['hand:p1'].cardIds).toHaveLength(2);
    expect(h.state().zones['hand:p0'].cardIds).toHaveLength(0);
  });

  it('count ≤ 0 and a bogus who are safe no-ops', async () => {
    const zeroed = harness(drawDef([drawB({ count: num(0) })]));
    await zeroed.engine.start();
    expect(zeroed.state().zones['hand:p0'].cardIds).toHaveLength(0);
    expect(zeroed.errors).toEqual([]);

    const bogus = harness(drawDef([drawB({ who: { kind: 'str', value: 'nobody' } })]));
    await bogus.engine.start();
    expect(bogus.state().zones['hand:p0'].cardIds).toHaveLength(0);
    expect(bogus.errors.some((e) => e.includes('who'))).toBe(true);
  });
});
