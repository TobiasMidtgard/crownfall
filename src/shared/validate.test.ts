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

describe('end conditions', () => {
  it('flags a literal-true end condition as an error (the game would end at the deal)', () => {
    const def = baseDef({
      cards: [carded({ typeId: 'ty1', tags: ['tg1'] })],
      endConditions: [{ id: 'ec1', name: 'Oops', condition: { kind: 'bool', value: true }, winner: { kind: 'draw' } }],
    });
    expect(errorsOf(def)).toContain(
      'End condition "Oops": The condition is always true — the game would end immediately after setup. Pick a real condition.',
    );
  });

  it('does not flag a literal-false end condition (never fires, but not a start-of-game trap)', () => {
    // baseDef's default end condition is bool false.
    expect(errorsOf(baseDef()).filter((e) => e.includes('always true'))).toEqual([]);
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

// ---------------------------------------------------------------------------
// Layout backbone: flow / slot / panelSwitcher / image validation
// ---------------------------------------------------------------------------

describe('layout backbone validation', () => {
  const screenDef = (elements: unknown[]): GameDef =>
    baseDef({ screenLayout: { aspect: null, elements: elements as never } });

  it('warns when a zone carries a flow layout', () => {
    const def = screenDef([
      { kind: 'zone', id: 'e1', name: 'Table zone', rect: { x: 0, y: 0, w: 20, h: 20 },
        zoneId: 'z1', seat: 'shared', layout: { mode: 'row' } },
    ]);
    expect(warningsOf(def).some((w) => /Layout is ignored on a zone/.test(w))).toBe(true);
  });

  it('warns when a child names a slot the container does not have', () => {
    const def = screenDef([
      { kind: 'panelSwitcher', id: 'ps', name: 'PS', rect: { x: 0, y: 0, w: 40, h: 40 },
        selectorGroup: 'g',
        slots: [
          { id: 'tabs', name: 'Tabs', accepts: ['button'], layout: { mode: 'row' } },
          { id: 'content', name: 'Content', layout: { mode: 'column' } },
        ],
        children: [
          { kind: 'text', id: 't1', name: 'Stray', rect: { x: 0, y: 0, w: 10, h: 5 },
            text: 'x', fontSize: 2, align: 'center', slotId: 'nope' },
        ] },
    ]);
    expect(warningsOf(def).some((w) => /slot "nope", which this container has no slot for/.test(w))).toBe(true);
  });

  it('errors when a panel switcher is missing the tabs or content slot', () => {
    const def = screenDef([
      { kind: 'panelSwitcher', id: 'ps', name: 'PS', rect: { x: 0, y: 0, w: 40, h: 40 },
        selectorGroup: 'g',
        slots: [{ id: 'tabs', name: 'Tabs', layout: { mode: 'row' } }],
        children: [] },
    ]);
    expect(errorsOf(def).some((e) => /panel switcher needs a "tabs" slot and a "content" slot/.test(e))).toBe(true);
  });

  it('warns when an image has no source', () => {
    const def = screenDef([
      { kind: 'image', id: 'i1', name: 'Pic', rect: { x: 0, y: 0, w: 10, h: 10 }, src: '' },
    ]);
    expect(warningsOf(def).some((w) => /Image has no source/.test(w))).toBe(true);
  });

  it('a well-formed grid group + image with a src produce no new errors', () => {
    const def = screenDef([
      { kind: 'group', id: 'g1', name: 'Grid', rect: { x: 0, y: 0, w: 40, h: 40 },
        layout: { mode: 'grid', columns: 3, gap: 2 }, children: [] },
      { kind: 'image', id: 'i1', name: 'Pic', rect: { x: 50, y: 0, w: 10, h: 10 }, src: 'data:,', fit: 'contain' },
    ]);
    expect(errorsOf(def)).toEqual([]);
  });
});

describe('styleRules validation (universal node model)', () => {
  const screenDef = (elements: unknown[]): GameDef =>
    baseDef({ screenLayout: { aspect: null, elements: elements as never } });

  it('flags a styleRule whose condition references a missing variable', () => {
    const def = screenDef([
      { kind: 'text', id: 'e_sr', name: 'Ruled text', rect: { x: 0, y: 0, w: 10, h: 10 },
        text: 'x',
        styleRules: [{ when: { kind: 'getVar', varId: 'no_such_var', target: null }, style: {} }] },
    ]);
    const all = validateGameDef(def).map((i) => `${i.where}: ${i.message}`);
    expect(all.some((s) => s.includes('style rule 1'))).toBe(true);
  });

  it('accepts a styleRule over a real variable', () => {
    const def = screenDef([
      { kind: 'text', id: 'e_ok', name: 'Ruled ok', rect: { x: 0, y: 0, w: 10, h: 10 },
        text: 'x',
        styleRules: [{ when: { kind: 'num', value: 1 }, style: { background: '#123456' } }] },
    ]);
    expect(validateGameDef(def).filter((i) => i.where.includes('style rule'))).toEqual([]);
  });
});
