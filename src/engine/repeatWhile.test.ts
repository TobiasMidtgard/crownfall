/**
 * repeatWhile — the conditional loop: re-checks its condition before every
 * pass ("draw until you have 7"), and a condition that never turns false
 * stops at the loop cap with a report instead of hanging the game.
 */
import { describe, expect, it } from 'vitest';
import type { Block, Expr } from '../shared/types';
import { cdef, cmp, customDeck, harness, makeDef, mv, num, selTop, zone, zr } from './testkit';

const loop = (cond: Expr, body: Block[]): Block => ({ kind: 'repeatWhile', cond, body });

describe('repeatWhile', () => {
  it('runs the body until the condition turns false', async () => {
    const def = makeDef({
      zones: [zone('a'), zone('b')],
      cards: [cdef('c1'), cdef('c2'), cdef('c3')],
      decks: [customDeck('d', 'a', ['c1', 'c2', 'c3'])],
      setup: [loop(
        cmp('>', { kind: 'zoneCount', zone: zr('a') }, num(0)),
        [mv(zr('a'), zr('b'), selTop(1))],
      )],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().zones['a'].cardIds).toHaveLength(0);
    expect(h.state().zones['b'].cardIds).toHaveLength(3);
    expect(h.errors).toEqual([]);
  });

  it('a never-false condition stops at the cap with a report', async () => {
    const def = makeDef({
      zones: [zone('a')],
      cards: [cdef('c1')],
      decks: [customDeck('d', 'a', ['c1'])],
      setup: [loop({ kind: 'bool', value: true }, [])],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.errors.some((m) => m.includes('Repeat-while looped'))).toBe(true);
  });
});
