import { describe, expect, it } from 'vitest';
import type { AbilityDef, TriggerDef } from '../shared/types';
import {
  actionDef, ann, bnd, cdef, cmp, customDeck, cv, fld, harness, makeDef, mv, num, phaseDef, pzone,
  selSpec, selTop, sv, topC, vdef, zone, zr,
} from './testkit';

const trigger = (id: string, event: TriggerDef['event'], over: Partial<TriggerDef> = {}): TriggerDef =>
  ({ id, name: id, event, condition: null, script: [], ...over });

describe('global triggers', () => {
  it('cardEnterZone binds $card/$fromZone/$toZone/$owner', async () => {
    const def = makeDef({
      variables: [
        vdef('what', 'global', 'string', ''), vdef('from', 'global', 'string', ''),
        vdef('to', 'global', 'string', ''), vdef('who', 'global', 'string', ''),
      ],
      zones: [zone('a'), pzone('hand')],
      cards: [cdef('c1'), cdef('c2')],
      decks: [customDeck('d', 'a', ['c1', 'c2'])],
      setup: [mv(zr('a'), zr('hand'), selTop(1))], // contextual owner = current player p0
      triggers: [trigger('t', { kind: 'cardEnterZone', zoneId: 'hand' }, {
        script: [
          sv('what', fld(bnd('$card'), 'name')), sv('from', bnd('$fromZone')),
          sv('to', bnd('$toZone')), sv('who', bnd('$owner')),
        ],
      })],
    });
    const h = harness(def);
    await h.engine.start();
    const g = h.state().globalVars;
    expect(g['what']).toBe('c2');
    expect(g['from']).toBe('a');
    expect(g['to']).toBe('hand');
    expect(g['who']).toBe('p0');
  });

  it('zone-filtered triggers ignore other zones; null zoneId matches any', async () => {
    const def = makeDef({
      variables: [vdef('hits', 'global', 'number', 0), vdef('any', 'global', 'number', 0)],
      zones: [zone('a'), zone('b'), zone('c')],
      cards: [cdef('c1'), cdef('c2')],
      decks: [customDeck('d', 'a', ['c1', 'c2'])],
      setup: [mv(zr('a'), zr('b'), selTop(1)), mv(zr('a'), zr('c'), selTop(1))],
      triggers: [
        trigger('only-b', { kind: 'cardEnterZone', zoneId: 'b' }, { script: [cv('hits', num(1))] }),
        trigger('any', { kind: 'cardEnterZone', zoneId: null }, { script: [cv('any', num(1))] }),
      ],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().globalVars['hits']).toBe(1);
    expect(h.state().globalVars['any']).toBe(2);
  });

  it('zoneEmptied fires once when the zone empties, with $zone/$owner', async () => {
    const def = makeDef({
      variables: [vdef('emptied', 'global', 'string', '')],
      zones: [zone('a'), zone('b')],
      cards: [cdef('c1'), cdef('c2')],
      decks: [customDeck('d', 'a', ['c1', 'c2'])],
      setup: [mv(zr('a'), zr('b'), selTop(1)), mv(zr('a'), zr('b'), selTop(1))],
      triggers: [trigger('t', { kind: 'zoneEmptied', zoneId: 'a' }, {
        script: [sv('emptied', bnd('$zone')), cv('count', num(1))],
      })],
    });
    def.variables.push(vdef('count', 'global', 'number', 0));
    const h = harness(def);
    await h.engine.start();
    expect(h.state().globalVars['emptied']).toBe('a');
    expect(h.state().globalVars['count']).toBe(1);
  });

  it('varChanged fires only on an actual change and respects conditions', async () => {
    const def = makeDef({
      variables: [vdef('x', 'global', 'number', 0), vdef('echo', 'global', 'number', 0)],
      setup: [sv('x', num(0)), sv('x', num(5)), sv('x', num(5)), sv('x', num(6))],
      triggers: [trigger('t', { kind: 'varChanged', varId: 'x' }, {
        condition: cmp('>', { kind: 'getVar', varId: 'x', target: null }, num(0)),
        script: [cv('echo', num(1))],
      })],
    });
    const h = harness(def);
    await h.engine.start();
    // set 0→0 (no change), 0→5 (fires), 5→5 (no change), 5→6 (fires)
    expect(h.state().globalVars['echo']).toBe(2);
  });

  it('turnStart fires each turn with $player bound', async () => {
    const def = makeDef({
      variables: [vdef('starts', 'global', 'number', 0)],
      phases: [phaseDef('main', 'manual', ['pass'])],
      actions: [actionDef('pass', { script: [{ kind: 'endTurn' }] })],
      triggers: [trigger('t', { kind: 'turnStart' }, { script: [cv('starts', num(1)), ann('start: ', bnd('$player'))] })],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().globalVars['starts']).toBe(1);
    expect(h.state().log.map((l) => l.text)).toContain('start: Alice');
    await h.engine.performAction('p0', { actionId: 'pass' });
    expect(h.state().globalVars['starts']).toBe(2);
    expect(h.state().log.map((l) => l.text)).toContain('start: Bob');
  });

  it('triggers cascade: a trigger-made move fires further triggers (drain rounds)', async () => {
    const def = makeDef({
      zones: [zone('a'), zone('b'), zone('c')],
      cards: [cdef('c1')],
      decks: [customDeck('d', 'a', ['c1'])],
      setup: [mv(zr('a'), zr('b'), selTop(1))],
      triggers: [trigger('relay', { kind: 'cardEnterZone', zoneId: 'b' }, {
        script: [mv(zr('b'), zr('c'), selSpec(bnd('$card')))],
      })],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().zones['c'].cardIds).toHaveLength(1);
    expect(h.state().zones['b'].cardIds).toHaveLength(0);
  });
});

describe('card abilities', () => {
  const ability = (id: string, on: AbilityDef['on'], zoneId: string | null, over: Partial<AbilityDef> = {}): AbilityDef =>
    ({ id, name: id, on, zoneId, phaseId: null, condition: null, script: [], ...over });

  it('enterZone abilities run with $self and $owner of the destination', async () => {
    const def = makeDef({
      variables: [vdef('lastSelf', 'global', 'string', ''), vdef('score', 'perPlayer', 'number', 0)],
      zones: [zone('a'), pzone('field')],
      cards: [
        cdef('hero', { power: 3 }, [ability('ab', 'enterZone', 'field', {
          script: [sv('lastSelf', fld(bnd('$self'), 'name')), cv('score', fld(bnd('$self'), 'power'), bnd('$owner'))],
        })]),
        cdef('pawn', { power: 1 }),
      ],
      decks: [customDeck('d', 'a', ['pawn', 'hero'])],
      setup: [
        mv(zr('a'), zr('field', { kind: 'nextPlayer', from: { kind: 'currentPlayer' } }), selTop(1)), // hero → p1's field
        mv(zr('a'), zr('field'), selTop(1)), // pawn → p0's field (no ability)
      ],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().globalVars['lastSelf']).toBe('hero');
    expect(h.state().players[1].vars['score']).toBe(3); // $owner = p1
    expect(h.state().players[0].vars['score']).toBe(0);
  });

  it('enterZone abilities do not fire for other zones', async () => {
    const def = makeDef({
      variables: [vdef('n', 'global', 'number', 0)],
      zones: [zone('a'), zone('b'), zone('c')],
      cards: [cdef('hero', {}, [ability('ab', 'enterZone', 'c', { script: [cv('n', num(1))] })])],
      decks: [customDeck('d', 'a', ['hero'])],
      setup: [mv(zr('a'), zr('b'), selTop(1))],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().globalVars['n']).toBe(0);
  });

  it('turnStart abilities fire only while the card sits in the named zone', async () => {
    const def = makeDef({
      variables: [vdef('ticks', 'global', 'number', 0)],
      zones: [zone('bench'), pzone('field')],
      cards: [cdef('engine-card', {}, [ability('ab', 'turnStart', 'field', { script: [cv('ticks', num(1))] })])],
      decks: [customDeck('d', 'bench', ['engine-card'])],
      phases: [phaseDef('main', 'manual', ['pass', 'play'])],
      actions: [
        actionDef('pass', { script: [{ kind: 'endTurn' }] }),
        actionDef('play', { script: [mv(zr('bench'), zr('field'), selSpec(topC(zr('bench')))), { kind: 'endTurn' }] }),
      ],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().globalVars['ticks']).toBe(0); // turn 1 start: card on bench
    await h.engine.performAction('p0', { actionId: 'play' }); // card → p0's field; turn 2 starts
    expect(h.state().globalVars['ticks']).toBe(1);
    await h.engine.performAction('p1', { actionId: 'pass' }); // turn 3 starts
    expect(h.state().globalVars['ticks']).toBe(2);
  });

  it('ability conditions gate execution', async () => {
    const def = makeDef({
      variables: [vdef('n', 'global', 'number', 0)],
      zones: [zone('a'), zone('b')],
      cards: [cdef('picky', { v: 1 }, [ability('ab', 'enterZone', 'b', {
        condition: cmp('>', fld(bnd('$self'), 'v'), num(5)),
        script: [cv('n', num(1))],
      })])],
      decks: [customDeck('d', 'a', ['picky'])],
      setup: [mv(zr('a'), zr('b'), selTop(1))],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().globalVars['n']).toBe(0);
  });
});
