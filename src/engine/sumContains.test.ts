/**
 * The `sumCards` expression and the `contains` compare op (wave 1a).
 */
import { describe, expect, it } from 'vitest';
import type { Expr, GameDef } from '../shared/types';
import {
  bnd, cdef, cmp, customDeck, fld, harness, makeDef, num, str, sv, vdef, zone,
  zr,
} from './testkit';

const sum = (fieldId: string, filter: Expr | null = null): Expr =>
  ({ kind: 'sumCards', zone: zr('a'), fieldId, filter });

function evalDef(varType: 'number' | 'boolean', value: Expr, over: Partial<GameDef> = {}): GameDef {
  return makeDef({
    variables: [vdef('out', 'global', varType, varType === 'number' ? -1 : false)],
    zones: [zone('a'), zone('b')],
    cards: [
      cdef('copper', { coins: 1, ctype: 'treasure' }),
      cdef('gold', { coins: 3, ctype: 'treasure' }),
      cdef('moat', { coins: 'none', ctype: 'action reaction' }),
    ],
    decks: [customDeck('d', 'a', [['copper', 2], 'gold', 'moat'])],
    setup: [sv('out', value)],
    ...over,
  });
}

async function evalNum(value: Expr, over: Partial<GameDef> = {}) {
  const h = harness(evalDef('number', value, over));
  await h.engine.start();
  return { value: h.state().globalVars['out'], errors: h.errors };
}

async function evalBool(value: Expr) {
  const h = harness(evalDef('boolean', value));
  await h.engine.start();
  return h.state().globalVars['out'];
}

describe('sumCards', () => {
  it('sums a numeric field over the whole zone (non-numeric values count 0)', async () => {
    const r = await evalNum(sum('coins'));
    expect(r.value).toBe(5); // 1 + 1 + 3, moat's "none" counts 0
    expect(r.errors).toEqual([]);
  });

  it('applies the filter with $card bound per candidate', async () => {
    const treasuresOnly = cmp('==', fld(bnd('$card'), 'ctype'), str('treasure'));
    const r = await evalNum(sum('coins', treasuresOnly));
    expect(r.value).toBe(5);
    const goldOnly = cmp('==', fld(bnd('$card'), 'coins'), num(3));
    expect((await evalNum(sum('coins', goldOnly))).value).toBe(3);
  });

  it('empty zones and unknown fields sum to 0', async () => {
    expect((await evalNum({ kind: 'sumCards', zone: zr('b'), fieldId: 'coins', filter: null })).value).toBe(0);
    expect((await evalNum(sum('nope'))).value).toBe(0);
  });
});

describe('contains compare op', () => {
  const has = (left: Expr, right: Expr): Expr => cmp('contains', left, right);

  it('matches whole whitespace-separated words, not substrings', async () => {
    expect(await evalBool(has(str('action attack'), str('action')))).toBe(true);
    expect(await evalBool(has(str('action attack'), str('attack')))).toBe(true);
    expect(await evalBool(has(str('action attack'), str('act')))).toBe(false);
    expect(await evalBool(has(str('action attack'), str('action attack')))).toBe(false);
    expect(await evalBool(has(str('reaction'), str('action')))).toBe(false);
  });

  it('is case-sensitive and null-safe', async () => {
    expect(await evalBool(has(str('Action'), str('action')))).toBe(false);
    // cardField of an empty zone's top card → null → false, no error.
    const nullCard: Expr = { kind: 'cardField', card: { kind: 'topCard', zone: zr('b') }, fieldId: 'ctype' };
    expect(await evalBool(has(nullCard, str('action')))).toBe(false);
  });

  it('reads multi-type card fields (the Moat case)', async () => {
    const moatType = cmp(
      'contains',
      fld({ kind: 'topCard', zone: zr('a') }, 'ctype'), // top of a = moat
      str('reaction'),
    );
    expect(await evalBool(moatType)).toBe(true);
  });

  it('coerces non-strings via String()', async () => {
    expect(await evalBool(has(str('1 2 3'), num(2)))).toBe(true);
    expect(await evalBool(has(num(123), str('123')))).toBe(true);
    expect(await evalBool(has(num(123), str('12')))).toBe(false);
  });
});
