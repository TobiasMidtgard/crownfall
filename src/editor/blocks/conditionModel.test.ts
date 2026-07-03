/**
 * conditionModel tests:
 *  1. Round-trip — parse(compile(t)) deep-equals t for every clause kind,
 *     negation, group op and nesting (canonical trees).
 *  2. Legacy parsing — and/or chains fold flat, not(or(…)) becomes a none
 *     group, name-equality or-chains merge into "name is one of", mirrored
 *     compares flip, unrepresentable exprs become advanced rows (exact expr
 *     preserved — no data loss).
 *  3. The CURRENT Dominion def — every condition surface parses; the
 *     IS_TREASURE-style field compares and the basic-name chains land in
 *     clause rows, and everything that falls to an advanced row is one of the
 *     documented out-of-vocabulary shapes.
 */
import { describe, expect, it } from 'vitest';
import type { Expr, GameDef, ScreenElement } from '../../shared/types';
import { buildDominionDef } from '../../forge/dominionGame';
import {
  collectAdvanced, compile, parse,
  type Clause, type ConditionGroup, type ConditionRow,
} from './conditionModel';

const group = (op: ConditionGroup['op'], rows: ConditionRow[]): ConditionGroup =>
  ({ kind: 'group', op, rows });
const all = (rows: ConditionRow[]) => group('all', rows);

const roundTrip = (t: ConditionGroup) => expect(parse(compile(t))).toEqual(t);

// ---------------------------------------------------------------------------
// 1. Round-trip
// ---------------------------------------------------------------------------

describe('round-trip: parse(compile(t)) equals t', () => {
  const clauses: [string, Clause][] = [
    ['isType', { kind: 'isType', card: '$card', typeId: 't_treasure', negate: false }],
    ['isType on $self', { kind: 'isType', card: '$self', typeId: 't_action', negate: false }],
    ['hasTag', { kind: 'hasTag', card: '$card', tagId: 'tag_attack', negate: false }],
    ['matchesFilter', { kind: 'matchesFilter', card: '$card', filterId: 'f_basics', negate: false }],
    ['fieldCompare ==', { kind: 'fieldCompare', card: '$card', fieldId: 'cost', op: '==', value: 3, negate: false }],
    ['fieldCompare !=', { kind: 'fieldCompare', card: '$card', fieldId: 'cost', op: '!=', value: 0, negate: false }],
    ['fieldCompare <=', { kind: 'fieldCompare', card: '$card', fieldId: 'cost', op: '<=', value: 4, negate: false }],
    ['fieldCompare >=', { kind: 'fieldCompare', card: '$card', fieldId: 'cost', op: '>=', value: 2, negate: false }],
    ['fieldCompare <', { kind: 'fieldCompare', card: '$card', fieldId: 'cost', op: '<', value: 9, negate: false }],
    ['fieldCompare >', { kind: 'fieldCompare', card: '$card', fieldId: 'cost', op: '>', value: 1, negate: false }],
    ['fieldCompare contains (text)', { kind: 'fieldCompare', card: '$card', fieldId: 'ctype', op: 'contains', value: 'action', negate: false }],
    ['fieldCompare text value', { kind: 'fieldCompare', card: '$card', fieldId: 'suit', op: '==', value: 'hearts', negate: false }],
    ['nameOneOf single', { kind: 'nameOneOf', card: '$card', names: ['Copper'], negate: false }],
    ['nameOneOf multi', { kind: 'nameOneOf', card: '$card', names: ['Copper', 'Silver', 'Gold'], negate: false }],
    ['phaseIs', { kind: 'phaseIs', phaseId: 'ph_buy', negate: false }],
    ['varCompare number', { kind: 'varCompare', varId: 'v_actions', target: null, op: '>', value: 0, negate: false }],
    ['varCompare targeted', { kind: 'varCompare', varId: 'v_immune', target: '$player', op: '==', value: 0, negate: false }],
    ['varCompare boolean', { kind: 'varCompare', varId: 'v_flag', target: null, op: '==', value: true, negate: false }],
    ['varCompare text', { kind: 'varCompare', varId: 'v_lead', target: null, op: '==', value: 'hearts', negate: false }],
    ['zoneCountCmp no filter', { kind: 'zoneCountCmp', zone: { zoneId: 'z_deck', owner: null }, op: '>', count: 0, filter: null, negate: false }],
    ['zoneCountCmp owned zone', { kind: 'zoneCountCmp', zone: { zoneId: 'z_hand', owner: { kind: 'binding', name: '$viewer' } }, op: '>=', count: 3, filter: null, negate: false }],
    ['zoneCountCmp with filter', {
      kind: 'zoneCountCmp', zone: { zoneId: 'z_supply', owner: null }, op: '==', count: 0,
      filter: all([{ kind: 'nameOneOf', card: '$card', names: ['Province'], negate: false }]),
      negate: false,
    }],
    ['turnCompare', { kind: 'turnCompare', op: '>=', value: 2, negate: false }],
  ];

  for (const [name, clause] of clauses) {
    it(`clause: ${name}`, () => roundTrip(all([clause])));
    it(`clause negated: ${name}`, () => roundTrip(all([{ ...clause, negate: true }])));
  }

  it('empty all group (always)', () => roundTrip(all([])));
  it('empty any group (never)', () => roundTrip(group('any', [])));

  it('flat all group with several rows', () => roundTrip(all([
    { kind: 'fieldCompare', card: '$card', fieldId: 'ctype', op: 'contains', value: 'action', negate: false },
    { kind: 'varCompare', varId: 'v_actions', target: null, op: '>', value: 0, negate: false },
    { kind: 'turnCompare', op: '>', value: 1, negate: false },
  ])));

  it('top-level any group', () => roundTrip(group('any', [
    { kind: 'phaseIs', phaseId: 'ph_buy', negate: false },
    { kind: 'phaseIs', phaseId: 'ph_action', negate: false },
  ])));

  it('top-level none group', () => roundTrip(group('none', [
    { kind: 'isType', card: '$card', typeId: 't_curse', negate: false },
    { kind: 'hasTag', card: '$card', tagId: 'tag_basic', negate: false },
  ])));

  it('nested any group inside all', () => roundTrip(all([
    { kind: 'varCompare', varId: 'v_actions', target: null, op: '>', value: 0, negate: false },
    group('any', [
      { kind: 'isType', card: '$card', typeId: 't_action', negate: false },
      { kind: 'hasTag', card: '$card', tagId: 'tag_attack', negate: false },
    ]),
  ])));

  it('nested none group inside all', () => roundTrip(all([
    { kind: 'phaseIs', phaseId: 'ph_action', negate: false },
    group('none', [
      { kind: 'nameOneOf', card: '$card', names: ['Curse'], negate: false },
      { kind: 'isType', card: '$card', typeId: 't_victory', negate: false },
    ]),
  ])));

  it('nested all group inside any', () => roundTrip(group('any', [
    { kind: 'turnCompare', op: '==', value: 1, negate: false },
    all([
      { kind: 'phaseIs', phaseId: 'ph_buy', negate: false },
      { kind: 'varCompare', varId: 'v_buys', target: null, op: '>', value: 0, negate: false },
    ]),
  ])));

  it('negated multi-name "name is one of" (the kingdom-filter shape)', () => roundTrip(all([
    { kind: 'nameOneOf', card: '$card', names: ['Copper', 'Silver', 'Gold', 'Estate', 'Duchy', 'Province', 'Curse'], negate: true },
  ])));

  it('mixed any group: names merge back into position', () => roundTrip(group('any', [
    { kind: 'nameOneOf', card: '$card', names: ['Moat', 'Militia'], negate: false },
    { kind: 'isType', card: '$card', typeId: 't_treasure', negate: false },
  ])));

  it('advanced row preserves the exact expr', () => {
    const weird: Expr = {
      kind: 'compare', op: '<=',
      left: { kind: 'cardField', card: { kind: 'binding', name: '$card' }, fieldId: 'cost' },
      right: { kind: 'getVar', varId: 'v_coins', target: null }, // dynamic value: out of vocabulary
    };
    const tree = all([{ kind: 'advanced', expr: weird }]);
    const compiled = compile(tree);
    expect(compiled).toBe(weird); // single advanced row compiles to the expr itself
    roundTrip(tree);
  });

  it('deep mix: clauses + nested groups + advanced', () => {
    const weird: Expr = { kind: 'math', op: '+', left: { kind: 'num', value: 1 }, right: { kind: 'num', value: 2 } };
    roundTrip(all([
      { kind: 'varCompare', varId: 'v_game_over', target: null, op: '>=', value: 1, negate: true },
      group('any', [
        { kind: 'zoneCountCmp', zone: { zoneId: 'z_supply', owner: null }, op: '==', count: 0, filter: all([{ kind: 'nameOneOf', card: '$card', names: ['Province'], negate: false }]), negate: false },
        group('none', [
          { kind: 'hasTag', card: '$card', tagId: 'tag_kingdom', negate: false },
          { kind: 'advanced', expr: weird },
        ]),
      ]),
    ]));
  });
});

// ---------------------------------------------------------------------------
// 2. Legacy shapes
// ---------------------------------------------------------------------------

const bnd = (name: string): Expr => ({ kind: 'binding', name });
const num = (value: number): Expr => ({ kind: 'num', value });
const str = (value: string): Expr => ({ kind: 'str', value });
const field = (card: Expr, fieldId: string): Expr => ({ kind: 'cardField', card, fieldId });
const cmp = (op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'contains', left: Expr, right: Expr): Expr =>
  ({ kind: 'compare', op, left, right });
const andE = (left: Expr, right: Expr): Expr => ({ kind: 'logic', op: 'and', left, right });
const orE = (left: Expr, right: Expr): Expr => ({ kind: 'logic', op: 'or', left, right });
const notE = (expr: Expr): Expr => ({ kind: 'not', expr });
const nameIs = (n: string): Expr => cmp('==', field(bnd('$card'), 'name'), str(n));

describe('parsing legacy shapes', () => {
  it('nested and-chains fold into one flat all group (any association)', () => {
    const a = cmp('>', { kind: 'getVar', varId: 'v', target: null }, num(0));
    const b = cmp('==', { kind: 'turnNumber' }, num(1));
    const c: Expr = { kind: 'phaseIs', phaseId: 'ph' };
    const left = parse(andE(andE(a, b), c));
    const right = parse(andE(a, andE(b, c)));
    expect(left).toEqual(right);
    expect(left.op).toBe('all');
    expect(left.rows).toHaveLength(3);
  });

  it('not(or(a, b)) becomes a none group', () => {
    const tree = parse(notE(orE(
      cmp('==', field(bnd('$card'), 'suit'), str('hearts')),
      { kind: 'cardTypeIs', card: bnd('$card'), typeId: 't1' },
    )));
    expect(tree).toEqual(group('none', [
      { kind: 'fieldCompare', card: '$card', fieldId: 'suit', op: '==', value: 'hearts', negate: false },
      { kind: 'isType', card: '$card', typeId: 't1', negate: false },
    ]));
  });

  it('an or-chain of name equalities joins one "name is one of" clause', () => {
    const tree = parse(orE(orE(nameIs('Copper'), nameIs('Silver')), nameIs('Gold')));
    expect(tree).toEqual(all([
      { kind: 'nameOneOf', card: '$card', names: ['Copper', 'Silver', 'Gold'], negate: false },
    ]));
  });

  it('not(or(name chain)) reads as a single negated name-one-of clause', () => {
    const tree = parse(notE(orE(nameIs('Copper'), nameIs('Silver'))));
    expect(tree).toEqual(all([
      { kind: 'nameOneOf', card: '$card', names: ['Copper', 'Silver'], negate: true },
    ]));
  });

  it('name equalities on DIFFERENT cards do not merge', () => {
    const other: Expr = cmp('==', field(bnd('$self'), 'name'), str('Moat'));
    const tree = parse(orE(nameIs('Copper'), other));
    expect(tree.op).toBe('any');
    expect(tree.rows).toHaveLength(2);
  });

  it('mirrored compares flip (literal on the left)', () => {
    expect(parse(cmp('<', num(0), { kind: 'getVar', varId: 'v', target: null }))).toEqual(all([
      { kind: 'varCompare', varId: 'v', target: null, op: '>', value: 0, negate: false },
    ]));
  });

  it('not over a single clause toggles its negate flag', () => {
    expect(parse(notE({ kind: 'cardHasTag', card: bnd('$card'), tagId: 'tag1' }))).toEqual(all([
      { kind: 'hasTag', card: '$card', tagId: 'tag1', negate: true },
    ]));
  });

  it('bool literals parse as empty groups (true = always, false = never)', () => {
    expect(parse({ kind: 'bool', value: true })).toEqual(all([]));
    expect(parse({ kind: 'bool', value: false })).toEqual(group('any', []));
  });

  it('countCards / zoneCount compares both land in the zone clause', () => {
    const zc = parse(cmp('>', { kind: 'zoneCount', zone: { zoneId: 'z', owner: null } }, num(0)));
    expect(zc.rows[0]).toMatchObject({ kind: 'zoneCountCmp', filter: null });
    const cc = parse(cmp('==', { kind: 'countCards', zone: { zoneId: 'z', owner: null }, filter: nameIs('Province') }, num(0)));
    expect(cc.rows[0]).toMatchObject({
      kind: 'zoneCountCmp',
      filter: all([{ kind: 'nameOneOf', card: '$card', names: ['Province'], negate: false }]),
    });
  });

  it('unrepresentable exprs fall to advanced rows, expr intact', () => {
    // not(and(…)) has no group form in the vocabulary.
    const na = notE(andE(nameIs('Copper'), nameIs('Silver')));
    const t1 = parse(na);
    expect(t1.rows).toEqual([{ kind: 'advanced', expr: na }]);
    // A compare between two dynamic values.
    const dyn = cmp('==', { kind: 'currentPlayer' }, bnd('$viewer'));
    expect(parse(dyn).rows).toEqual([{ kind: 'advanced', expr: dyn }]);
    // cardTypeIs over a non-binding card expr.
    const top: Expr = { kind: 'cardTypeIs', card: { kind: 'topCard', zone: { zoneId: 'z', owner: null } }, typeId: 't' };
    expect(parse(top).rows).toEqual([{ kind: 'advanced', expr: top }]);
    // Advanced rows re-compile to the exact original expr — zero data loss.
    expect(compile(parse(na))).toBe(na);
    expect(compile(parse(dyn))).toBe(dyn);
  });
});

// ---------------------------------------------------------------------------
// 3. The current Dominion def
// ---------------------------------------------------------------------------

interface Named { where: string; expr: Expr }

/** Every condition SURFACE the builder now owns (states excluded — not swapped). */
function collectConditions(def: GameDef): Named[] {
  const out: Named[] = [];
  for (const a of def.actions) if (a.legality) out.push({ where: `action ${a.id}`, expr: a.legality });
  for (const t of def.triggers) if (t.condition) out.push({ where: `trigger ${t.id}`, expr: t.condition });
  for (const ec of def.endConditions) out.push({ where: `end ${ec.id}`, expr: ec.condition });
  for (const c of def.cards) {
    for (const ab of c.abilities) if (ab.condition) out.push({ where: `ability ${ab.id}`, expr: ab.condition });
  }
  const walkEls = (els: ScreenElement[], where: string) => {
    for (const el of els) {
      if (el.visible) out.push({ where: `${where} ${el.id} visible`, expr: el.visible });
      if (el.kind === 'zone' && el.cardFilter) out.push({ where: `${where} ${el.id} cardFilter`, expr: el.cardFilter });
      if (el.children) walkEls(el.children, where);
    }
  };
  if (def.screenLayout) {
    walkEls(def.screenLayout.elements, 'screen');
    if (def.screenLayout.mobile) walkEls(def.screenLayout.mobile.elements, 'mobile');
  }
  return out;
}

/**
 * The DOCUMENTED out-of-vocabulary shapes in the Dominion def — everything
 * else must parse into clause rows:
 *  - stack-size checks (eq/gt over stackSize): the seal's Resolve state and
 *    Moat's response-window gate;
 *  - player-identity compares (currentPlayer vs $viewer): MY_TURN/THEIR_TURN;
 *  - compares whose RIGHT side is a dynamic value, not a literal (buy
 *    legality's "cost of $card ≤ coins" — the vocabulary's field/variable
 *    clauses compare against numbers or text only).
 */
function isDocumentedAdvanced(e: Expr): boolean {
  if (e.kind !== 'compare') return false;
  const kinds = [e.left.kind, e.right.kind];
  if (kinds.includes('stackSize')) return true;
  if (kinds.includes('currentPlayer') || kinds.includes('nextPlayer')) return true;
  if (e.right.kind === 'getVar' || e.right.kind === 'zoneCount' || e.right.kind === 'cardField') return true;
  return false;
}

describe('parsing the current Dominion def', () => {
  const def = buildDominionDef();

  it('play legality parses into clause rows (is-a type + variable)', () => {
    const play = def.actions.find((a) => a.id === 'dom_action_play')!;
    expect(parse(play.legality!)).toEqual(all([
      { kind: 'isType', card: '$card', typeId: 'dom_type_action', negate: false },
      { kind: 'varCompare', varId: 'dom_var_actions', target: null, op: '>', value: 0, negate: false },
    ]));
    // …and compiles back to the identical Expr (left-folded chain).
    expect(compile(parse(play.legality!))).toEqual(play.legality);
  });

  it('treasure legality is an IS_TREASURE-style type clause', () => {
    const treasure = def.actions.find((a) => a.id === 'dom_action_treasure')!;
    expect(parse(treasure.legality!)).toEqual(all([
      { kind: 'isType', card: '$card', typeId: 'dom_type_treasure', negate: false },
    ]));
  });

  it('the kingdom slice filter is ONE "has tag" row; victory rides the named filter', () => {
    const findEl = (els: ScreenElement[], id: string): ScreenElement | null => {
      for (const el of els) {
        if (el.id === id) return el;
        if (el.children) {
          const hit = findEl(el.children, id);
          if (hit) return hit;
        }
      }
      return null;
    };
    const sliceFilter = (id: string) => {
      const el = findEl(def.screenLayout!.elements, id);
      expect(el?.kind).toBe('zone');
      return el?.kind === 'zone' ? el.cardFilter : null;
    };
    const kingdom = sliceFilter('dom_el_supply_kingdom');
    expect(parse(kingdom!)).toEqual(all([
      { kind: 'hasTag', card: '$card', tagId: 'dom_tag_kingdom', negate: false },
    ]));
    expect(compile(parse(kingdom!))).toEqual(kingdom);
    // The victory column: "matches The basic cards" AND "is not a Treasure".
    const victory = sliceFilter('dom_el_supply_victory');
    expect(parse(victory!)).toEqual(all([
      { kind: 'matchesFilter', card: '$card', filterId: 'dom_filter_basic', negate: false },
      { kind: 'isType', card: '$card', typeId: 'dom_type_treasure', negate: true },
    ]));
    expect(compile(parse(victory!))).toEqual(victory);
  });

  it('end conditions parse fully (variable gate + Province pile count)', () => {
    for (const ec of def.endConditions) {
      const tree = parse(ec.condition);
      expect(collectAdvanced(tree)).toEqual([]);
    }
    const provinces = def.endConditions.find((ec) => ec.id === 'dom_end_provinces')!;
    expect(parse(provinces.condition)).toEqual(all([
      { kind: 'varCompare', varId: 'dom_var_game_over', target: null, op: '>=', value: 1, negate: false },
      {
        kind: 'zoneCountCmp', zone: { zoneId: 'dom_zone_supply', owner: null }, op: '==', count: 0,
        filter: all([{ kind: 'nameOneOf', card: '$card', names: ['Province'], negate: false }]),
        negate: false,
      },
    ]));
  });

  it('Moat legality: has-tag Reaction + immunity parse; only the stack gate is advanced', () => {
    const moat = def.actions.find((a) => a.id === 'dom_action_reveal_moat')!;
    const tree = parse(moat.legality!);
    expect(tree.op).toBe('all');
    const kinds = tree.rows.map((r) => r.kind);
    expect(kinds).toContain('hasTag');
    expect(kinds).toContain('varCompare');
    const advanced = collectAdvanced(tree);
    expect(advanced).toHaveLength(1);
    expect(advanced[0].expr).toMatchObject({ kind: 'compare', left: { kind: 'stackSize' } });
  });

  it('every condition surface parses; advanced rows only where documented', () => {
    const conditions = collectConditions(def);
    expect(conditions.length).toBeGreaterThan(10);
    const undocumented: string[] = [];
    for (const { where, expr } of conditions) {
      for (const row of collectAdvanced(parse(expr))) {
        if (!isDocumentedAdvanced(row.expr)) undocumented.push(where);
      }
    }
    expect(undocumented).toEqual([]);
  });
});
