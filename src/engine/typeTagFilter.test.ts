/**
 * Card-vocabulary expressions (wave 1A): cardTypeIs / cardHasTag / filterRef —
 * pure boolean leaves over GameDef.cardTypes / cardTags / filters, with the
 * filterRef cycle guard (caught script error → false, never a hang or throw).
 */
import { describe, expect, it } from 'vitest';
import type { Expr, GameDef, NamedFilterDef } from '../shared/types';
import {
  bnd, boolE, cdef, customDeck, harness, makeDef, std52, sv, topC, vdef, zone,
  zr,
} from './testkit';

const typeIs = (card: Expr, typeId: string): Expr => ({ kind: 'cardTypeIs', card, typeId });
const hasTag = (card: Expr, tagId: string): Expr => ({ kind: 'cardHasTag', card, tagId });
const matches = (filterId: string, card: Expr): Expr => ({ kind: 'filterRef', filterId, card });
const filt = (id: string, condition: Expr): NamedFilterDef => ({ id, name: id, condition });

/** One card per zone (zc=Copper, zm=Militia, zr=Relic), plus all three in 'all'. */
function vocabDef(value: Expr, filters: NamedFilterDef[] = [], over: Partial<GameDef> = {}): GameDef {
  return makeDef({
    variables: [vdef('out', 'global', 'boolean', false)],
    zones: [zone('zc'), zone('zm'), zone('zr'), zone('all'), zone('empty')],
    cardTypes: [
      { id: 'ty_treasure', name: 'Treasure', color: '#c9a227' },
      { id: 'ty_action', name: 'Action', color: '#4477aa' },
    ],
    cardTags: [{ id: 'tg_attack', name: 'Attack' }, { id: 'tg_kingdom', name: 'Kingdom' }],
    filters,
    cards: [
      { ...cdef('Copper', { cost: 0 }), typeId: 'ty_treasure' },
      { ...cdef('Militia', { cost: 4 }), typeId: 'ty_action', tags: ['tg_attack', 'tg_kingdom'] },
      cdef('Relic', { cost: 1 }), // untyped, tagless
    ],
    decks: [
      customDeck('dc', 'zc', ['Copper']),
      customDeck('dm', 'zm', ['Militia']),
      customDeck('dr', 'zr', ['Relic']),
      customDeck('da', 'all', ['Copper', 'Militia', 'Relic']),
    ],
    setup: [sv('out', value)],
    ...over,
  });
}

async function evalBool(value: Expr, filters: NamedFilterDef[] = [], over: Partial<GameDef> = {}) {
  const h = harness(vocabDef(value, filters, over));
  await h.engine.start();
  return { value: h.state().globalVars['out'], errors: h.errors };
}

describe('cardTypeIs', () => {
  it('matches the resolved card def’s primary type', async () => {
    expect(await evalBool(typeIs(topC(zr('zc')), 'ty_treasure'))).toEqual({ value: true, errors: [] });
    expect(await evalBool(typeIs(topC(zr('zc')), 'ty_action'))).toEqual({ value: false, errors: [] });
    expect(await evalBool(typeIs(topC(zr('zm')), 'ty_action'))).toEqual({ value: true, errors: [] });
  });

  it('untyped cards never match any type', async () => {
    expect(await evalBool(typeIs(topC(zr('zr')), 'ty_treasure'))).toEqual({ value: false, errors: [] });
    expect(await evalBool(typeIs(topC(zr('zr')), 'ty_action'))).toEqual({ value: false, errors: [] });
  });

  it('missing cards and standard52 cards (no def) are false, without errors', async () => {
    expect(await evalBool(typeIs(topC(zr('empty')), 'ty_treasure'))).toEqual({ value: false, errors: [] });
    const r = await evalBool(typeIs(topC(zr('std')), 'ty_treasure'), [], {
      zones: [zone('zc'), zone('zm'), zone('zr'), zone('all'), zone('empty'), zone('std')],
      decks: [customDeck('dc', 'zc', ['Copper']), std52('ds', 'std')],
    });
    expect(r).toEqual({ value: false, errors: [] });
  });
});

describe('cardHasTag', () => {
  it('checks membership in the card’s tag list', async () => {
    expect(await evalBool(hasTag(topC(zr('zm')), 'tg_attack'))).toEqual({ value: true, errors: [] });
    expect(await evalBool(hasTag(topC(zr('zm')), 'tg_kingdom'))).toEqual({ value: true, errors: [] });
    expect(await evalBool(hasTag(topC(zr('zc')), 'tg_attack'))).toEqual({ value: false, errors: [] });
  });

  it('cards without a tag list, and missing cards, are false', async () => {
    expect(await evalBool(hasTag(topC(zr('zr')), 'tg_attack'))).toEqual({ value: false, errors: [] });
    expect(await evalBool(hasTag(topC(zr('empty')), 'tg_attack'))).toEqual({ value: false, errors: [] });
  });
});

describe('filterRef', () => {
  const fTreasure = filt('f_treasure', typeIs(bnd('$card'), 'ty_treasure'));
  const fKingdomless = filt('f_kingdomless', { kind: 'not', expr: hasTag(bnd('$card'), 'tg_kingdom') });

  it('evaluates the named filter’s condition with $card rebound to the card', async () => {
    expect(await evalBool(matches('f_treasure', topC(zr('zc'))), [fTreasure]))
      .toEqual({ value: true, errors: [] });
    expect(await evalBool(matches('f_treasure', topC(zr('zm'))), [fTreasure]))
      .toEqual({ value: false, errors: [] });
  });

  it('rebinds $card per candidate inside countCards, shadowing any outer $card', async () => {
    const count: Expr = { kind: 'countCards', zone: zr('all'), filter: matches('f_treasure', bnd('$card')) };
    const r = await evalBool({ kind: 'compare', op: '==', left: count, right: { kind: 'num', value: 1 } }, [fTreasure]);
    expect(r).toEqual({ value: true, errors: [] });
    // Outer $card (Militia via forEachCard) must not leak into the filter.
    const h = harness(vocabDef(boolE(false), [fTreasure], {
      setup: [{
        kind: 'forEachCard', zone: zr('zm'), filter: null,
        body: [sv('out', matches('f_treasure', topC(zr('zc'))))],
      }],
    }));
    await h.engine.start();
    expect(h.state().globalVars['out']).toBe(true);
    expect(h.errors).toEqual([]);
  });

  it('filters can reference other filters', async () => {
    const fBasic = filt('f_basic', {
      kind: 'logic', op: 'and',
      left: matches('f_treasure', bnd('$card')),
      right: matches('f_kingdomless', bnd('$card')),
    });
    const filters = [fTreasure, fKingdomless, fBasic];
    expect(await evalBool(matches('f_basic', topC(zr('zc'))), filters)).toEqual({ value: true, errors: [] });
    expect(await evalBool(matches('f_basic', topC(zr('zm'))), filters)).toEqual({ value: false, errors: [] });
  });

  it('the cycle guard unwinds: the same filter may be used twice side by side', async () => {
    const twice: Expr = {
      kind: 'logic', op: 'and',
      left: matches('f_treasure', topC(zr('zc'))),
      right: matches('f_treasure', topC(zr('zc'))),
    };
    expect(await evalBool(twice, [fTreasure])).toEqual({ value: true, errors: [] });
  });

  it('an unknown filter id reports a script error and yields false', async () => {
    const r = await evalBool(matches('f_gone', topC(zr('zc'))), [fTreasure]);
    expect(r.value).toBe(false);
    expect(r.errors.some((e) => e.includes('Unknown filter'))).toBe(true);
  });

  it('a two-filter cycle yields false via a caught script error (no hang, no throw)', async () => {
    const fa = filt('f_a', matches('f_b', bnd('$card')));
    const fb = filt('f_b', matches('f_a', bnd('$card')));
    const r = await evalBool(matches('f_a', topC(zr('zc'))), [fa, fb]);
    expect(r.value).toBe(false);
    expect(r.errors.some((e) => e.includes('defined in terms of itself'))).toBe(true);
  });

  it('a self-referencing filter yields false the same way', async () => {
    const fSelf = filt('f_self', matches('f_self', bnd('$card')));
    const r = await evalBool(matches('f_self', topC(zr('zc'))), [fSelf]);
    expect(r.value).toBe(false);
    expect(r.errors.some((e) => e.includes('defined in terms of itself'))).toBe(true);
  });
});
