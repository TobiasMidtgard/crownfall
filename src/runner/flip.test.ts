/**
 * Pure tests for the FLIP layer's flight diff (flip.tsx diffFlights — the
 * React hook around it is exercised live): container changes become flights
 * only when BOTH rects are known, so cards whose source element is no longer
 * rendered (a selector flip hid its panel and the re-baseline dropped the
 * rect) or whose destination isn't rendered appear in place instead of
 * flying from coordinates another panel now occupies. Also: the per-update
 * cap, burn-zone marking and move-tag stamping.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, Id } from '../shared/types';
import { diffFlights, type Box } from './flip';

const box = (left: number, top: number): Box => ({ left, top, width: 40, height: 60 });
/** diffFlights only reads state through moveTagOf (defensive): a stub works. */
const bareState = {} as GameState;
const taggedState = (tags: Record<Id, string>) =>
  ({ moveTags: tags } as unknown as GameState);

describe('diffFlights', () => {
  it('flies cards whose zone instance changed and both rects are known', () => {
    const prev = new Map([['c1', 'deck'], ['c2', 'deck']]);
    const next = new Map([['c1', 'hand:p0'], ['c2', 'deck']]);
    const prevRects = new Map([['c1', box(0, 0)], ['c2', box(10, 0)]]);
    const rects = new Map([['c1', box(100, 200)], ['c2', box(10, 0)]]);
    const flights = diffFlights(bareState, prev, next, prevRects, rects);
    expect(flights).toHaveLength(1);
    expect(flights[0]).toMatchObject({
      cardId: 'c1', from: box(0, 0), to: box(100, 200), order: 0, burn: false, tag: null,
    });
  });

  it('skips cards with a missing source rect (hidden panel: appear, no flight)', () => {
    // The selector-flip case: c1 moved out of a panel the flip just hid —
    // the re-baseline dropped its rect, so it must NOT fly from stale
    // coordinates that another panel now occupies.
    const prev = new Map([['c1', 'treasury']]);
    const next = new Map([['c1', 'discard:p1']]);
    const rects = new Map([['c1', box(300, 300)]]);
    expect(diffFlights(bareState, prev, next, new Map(), rects)).toEqual([]);
  });

  it('skips cards with a missing destination rect, unknown cards and non-moves', () => {
    const prev = new Map([['c1', 'a'], ['c2', 'a']]);
    const next = new Map([['c1', 'b'], ['c2', 'a'], ['cNew', 'a']]);
    const prevRects = new Map([['c1', box(0, 0)], ['c2', box(10, 0)], ['cNew', box(20, 0)]]);
    // c1's destination unrendered; c2 didn't move; cNew wasn't tracked before.
    const rects = new Map([['c2', box(10, 0)], ['cNew', box(20, 0)]]);
    expect(diffFlights(bareState, prev, next, prevRects, rects)).toEqual([]);
  });

  it('caps at 12 flights per update, ordered for the stagger', () => {
    const ids = Array.from({ length: 15 }, (_, i) => `c${i}`);
    const prev = new Map(ids.map((id): [Id, string] => [id, 'a']));
    const next = new Map(ids.map((id): [Id, string] => [id, 'b']));
    const prevRects = new Map(ids.map((id, i): [Id, Box] => [id, box(i, 0)]));
    const rects = new Map(ids.map((id, i): [Id, Box] => [id, box(i, 100)]));
    const flights = diffFlights(bareState, prev, next, prevRects, rects);
    expect(flights).toHaveLength(12); // MAX_FLIGHTS
    expect(flights.map((f) => f.order)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    // Every key unique (fresh clone identity per flight).
    expect(new Set(flights.map((f) => f.key)).size).toBe(12);
  });

  it('marks burn-zone arrivals and stamps the move-cause tag', () => {
    const prev = new Map([['c1', 'hand:p0'], ['c2', 'hand:p0']]);
    const next = new Map([['c1', 'trash'], ['c2', 'discard:p0']]);
    const prevRects = new Map([['c1', box(0, 0)], ['c2', box(10, 0)]]);
    const rects = new Map([['c1', box(0, 100)], ['c2', box(10, 100)]]);
    const flights = diffFlights(
      taggedState({ c1: 'trash', c2: 'discard' }), prev, next, prevRects, rects, new Set(['trash']),
    );
    expect(flights).toHaveLength(2);
    const byId = new Map(flights.map((f) => [f.cardId, f]));
    expect(byId.get('c1')).toMatchObject({ burn: true, tag: 'trash' });
    expect(byId.get('c2')).toMatchObject({ burn: false, tag: 'discard' });
  });
});
