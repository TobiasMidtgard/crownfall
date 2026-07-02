/**
 * validateGameDef — the card vocabulary (wave 1A): dangling type/tag/filter
 * references are errors, filter-reference cycles are errors, and
 * defined-but-unused types/tags/filters warn.
 */
import { describe, expect, it } from 'vitest';
import type { CardDef, Expr, GameDef, NamedFilterDef } from './types';
import { validateGameDef } from './validate';

const card$: Expr = { kind: 'binding', name: '$card' };
const typeIs = (typeId: string): Expr => ({ kind: 'cardTypeIs', card: card$, typeId });
const hasTag = (tagId: string): Expr => ({ kind: 'cardHasTag', card: card$, tagId });
const matches = (filterId: string): Expr => ({ kind: 'filterRef', filterId, card: card$ });
const filt = (id: string, condition: Expr): NamedFilterDef => ({ id, name: id, condition });

function baseDef(over: Partial<GameDef> = {}): GameDef {
  return {
    schemaVersion: 2,
    meta: { id: 'g1', name: 'Vocab', description: '', minPlayers: 2, maxPlayers: 4 },
    variables: [],
    zones: [{ id: 'z1', name: 'Table', owner: 'shared', visibility: 'all', layout: 'row', area: 'center' }],
    decks: [],
    templates: [{
      id: 'tpl', name: 'Card', aspect: 0.714, background: '#fff', borderColor: '#000',
      cornerRadius: 6, elements: [], fields: [],
    }],
    cards: [],
    setup: [],
    phases: [{ id: 'ph1', name: 'Main', onEnter: [], actionIds: ['a1'], mode: 'manual' }],
    actions: [{ id: 'a1', name: 'Play', target: { kind: 'cardInZone', zoneId: 'z1', ownerOnly: false }, legality: null, script: [] }],
    triggers: [],
    endConditions: [{ id: 'ec1', name: 'Done', condition: { kind: 'bool', value: false }, winner: { kind: 'draw' } }],
    cardTypes: [{ id: 'ty1', name: 'Treasure', color: '#c9a227' }],
    cardTags: [{ id: 'tg1', name: 'Attack' }],
    filters: [],
    ...over,
  };
}

const carded = (over: Partial<CardDef>): CardDef => ({
  id: 'c1', name: 'Copper', templateId: 'tpl', fields: {}, abilities: [], ...over,
});

const errorsOf = (def: GameDef) =>
  validateGameDef(def).filter((i) => i.severity === 'error').map((i) => `${i.where}: ${i.message}`);
const warningsOf = (def: GameDef) =>
  validateGameDef(def).filter((i) => i.severity === 'warning').map((i) => `${i.where}: ${i.message}`);

describe('card vocabulary references', () => {
  it('a clean def with used vocabulary has no vocabulary issues', () => {
    const def = baseDef({
      cards: [carded({ typeId: 'ty1', tags: ['tg1'] })],
      filters: [filt('f1', typeIs('ty1'))],
      actions: [{
        id: 'a1', name: 'Play', target: { kind: 'cardInZone', zoneId: 'z1', ownerOnly: false },
        legality: matches('f1'), script: [],
      }],
    });
    expect(errorsOf(def)).toEqual([]);
    expect(warningsOf(def).filter((w) => /type|tag|filter/i.test(w))).toEqual([]);
  });

  it('flags dangling type/tag assignments on cards as errors', () => {
    const def = baseDef({ cards: [carded({ typeId: 'ty_gone', tags: ['tg1', 'tg_gone'] })] });
    const errors = errorsOf(def);
    expect(errors).toContain('Card "Copper": Has a card type that no longer exists.');
    expect(errors).toContain('Card "Copper": Carries a tag that no longer exists.');
  });

  it('flags dangling type/tag/filter ids inside expressions as errors', () => {
    const def = baseDef({
      actions: [{
        id: 'a1', name: 'Play', target: { kind: 'cardInZone', zoneId: 'z1', ownerOnly: false },
        legality: {
          kind: 'logic', op: 'and',
          left: typeIs('ty_gone'),
          right: { kind: 'logic', op: 'and', left: hasTag('tg_gone'), right: matches('f_gone') },
        },
        script: [],
      }],
    });
    const errors = errorsOf(def);
    expect(errors).toContain('Action "Play" > legality: Checks a card type that no longer exists.');
    expect(errors).toContain('Action "Play" > legality: Checks a tag that no longer exists.');
    expect(errors).toContain('Action "Play" > legality: Uses a saved filter that no longer exists.');
  });

  it('walks filter conditions like any other expression', () => {
    const def = baseDef({
      cards: [carded({ typeId: 'ty1', tags: ['tg1'] })],
      filters: [filt('f1', { kind: 'getVar', varId: 'v_gone', target: null })],
      endConditions: [{ id: 'ec1', name: 'Done', condition: matches('f1'), winner: { kind: 'draw' } }],
    });
    expect(errorsOf(def)).toContain('Filter "f1": Reads a variable that no longer exists.');
  });
});

describe('filter cycles', () => {
  it('rejects a two-filter cycle (and reports the chain)', () => {
    const def = baseDef({
      cards: [carded({ typeId: 'ty1', tags: ['tg1'] })],
      filters: [filt('f_a', matches('f_b')), filt('f_b', matches('f_a'))],
      endConditions: [{ id: 'ec1', name: 'Done', condition: matches('f_a'), winner: { kind: 'draw' } }],
    });
    const cycleErrors = errorsOf(def).filter((e) => e.includes('cycle'));
    expect(cycleErrors.length).toBeGreaterThanOrEqual(1);
    expect(cycleErrors[0]).toContain('"f_a"');
    expect(cycleErrors[0]).toContain('"f_b"');
  });

  it('rejects a self-referencing filter', () => {
    const def = baseDef({
      cards: [carded({ typeId: 'ty1', tags: ['tg1'] })],
      filters: [filt('f_self', matches('f_self'))],
      endConditions: [{ id: 'ec1', name: 'Done', condition: matches('f_self'), winner: { kind: 'draw' } }],
    });
    expect(errorsOf(def).some((e) => e.includes('cycle') && e.includes('"f_self"'))).toBe(true);
  });

  it('accepts an acyclic filter chain', () => {
    const def = baseDef({
      cards: [carded({ typeId: 'ty1', tags: ['tg1'] })],
      filters: [
        filt('f_leaf', typeIs('ty1')),
        filt('f_mid', matches('f_leaf')),
        filt('f_top', { kind: 'logic', op: 'or', left: matches('f_mid'), right: matches('f_leaf') }),
      ],
      endConditions: [{ id: 'ec1', name: 'Done', condition: matches('f_top'), winner: { kind: 'draw' } }],
    });
    expect(errorsOf(def)).toEqual([]);
  });
});

describe('unused vocabulary warnings', () => {
  it('warns for defined-but-unused types, tags and filters', () => {
    const def = baseDef({ filters: [filt('f1', { kind: 'bool', value: true })] });
    const warnings = warningsOf(def);
    expect(warnings).toContain('Card type "Treasure": Defined but unused — no card has this type and no condition checks it.');
    expect(warnings).toContain('Tag "Attack": Defined but unused — no card carries this tag and no condition checks it.');
    expect(warnings).toContain('Filter "f1": Defined but unused — nothing references it.');
  });

  it('any card assignment or expression reference counts as use', () => {
    const def = baseDef({
      cards: [carded({ typeId: 'ty1' })],
      filters: [filt('f1', hasTag('tg1'))],
      triggers: [{
        id: 't1', name: 'On play', event: { kind: 'cardEnterZone', zoneId: 'z1' },
        condition: matches('f1'), script: [],
      }],
    });
    expect(warningsOf(def).filter((w) => w.includes('Defined but unused'))).toEqual([]);
  });
});
