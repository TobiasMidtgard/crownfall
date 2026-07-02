/**
 * The `triggerAbilities` block (wave 1a): synthetic play-tagged enterZone
 * events WITHOUT moving the card (Throne Room), including stacked abilities
 * through nested response windows and cascade bounding.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, Block, GameDef } from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import {
  actionDef, bnd, cdef, customDeck, cv, harness, makeDef, num, phaseDef, sv,
  vdef, zone, zr,
} from './testkit';

const again = (over: Partial<Extract<Block, { kind: 'triggerAbilities' }>> = {}): Block => ({
  kind: 'triggerAbilities', card: { kind: 'topCard', zone: zr('field') },
  on: 'enterZone', zoneId: 'field', ...over,
});

const ability = (over: Partial<AbilityDef> = {}): AbilityDef => ({
  id: 'ab', name: 'ab', on: 'enterZone', zoneId: 'field', condition: null,
  script: [cv('plays', num(1))], ...over,
});

function throneDef(ab: AbilityDef, over: Partial<GameDef> = {}): GameDef {
  return makeDef({
    variables: [vdef('plays', 'global', 'number', 0), vdef('leaves', 'global', 'number', 0)],
    zones: [zone('field'), zone('elsewhere')],
    cards: [cdef('village', {}, [ab])],
    decks: [customDeck('d', 'field', ['village'])],
    phases: [phaseDef('main', 'manual', ['throne', 'idle'])],
    actions: [
      { ...actionDef('throne'), script: [again()] },
      actionDef('idle'),
    ],
    triggers: [{
      id: 'watch-leave', name: 'watch-leave', condition: null,
      event: { kind: 'cardLeaveZone', zoneId: null },
      script: [cv('leaves', num(1))],
    }],
    ...over,
  });
}

describe('triggerAbilities', () => {
  it('re-fires enter-zone abilities without moving the card (no leave events)', async () => {
    const h = harness(throneDef(ability()));
    await h.engine.start();
    expect(h.state().globalVars['plays']).toBe(0); // spawning fires no events
    await h.engine.performAction('p0', { actionId: 'throne' });
    expect(h.state().globalVars['plays']).toBe(1);
    expect(h.state().globalVars['leaves']).toBe(0); // the card never moved
    expect(h.state().zones['field'].cardIds).toHaveLength(1);
    await h.engine.performAction('p0', { actionId: 'throne' });
    expect(h.state().globalVars['plays']).toBe(2);
    expect(h.errors).toEqual([]);
  });

  it('the synthetic event is tagged "play": tag filters and $tag see it', async () => {
    const def = throneDef(ability({ tagFilter: 'play' }), {
      variables: [
        vdef('plays', 'global', 'number', 0), vdef('leaves', 'global', 'number', 0),
        vdef('tag', 'global', 'string', ''), vdef('gains', 'global', 'number', 0),
      ],
    });
    def.triggers.push(
      {
        id: 'tagged', name: 'tagged', condition: null,
        event: { kind: 'cardEnterZone', zoneId: 'field', tag: 'play' },
        script: [sv('tag', bnd('$tag'))],
      },
      {
        id: 'gains', name: 'gains', condition: null,
        event: { kind: 'cardEnterZone', zoneId: 'field', tag: 'gain' },
        script: [cv('gains', num(1))],
      },
    );
    const h = harness(def);
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'throne' });
    expect(h.state().globalVars['plays']).toBe(1);   // ability (no filter mismatch)
    expect(h.state().globalVars['tag']).toBe('play'); // global trigger also fired
    expect(h.state().globalVars['gains']).toBe(0);    // other tags do not
  });

  it('stacked abilities triggered synthetically stack and resolve via the window', async () => {
    const h = harness(throneDef(ability({ stacked: true })));
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'throne' });
    expect(h.state().stack).toHaveLength(1);
    expect(h.state().window?.holderId).toBe('p0');
    expect(h.state().globalVars['plays']).toBe(0); // deferred to resolution
    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    await h.engine.performAction('p1', { actionId: PASS_ACTION_ID });
    expect(h.state().stack).toHaveLength(0);
    expect(h.state().window).toBeNull();
    expect(h.state().globalVars['plays']).toBe(1);
    expect(h.errors).toEqual([]);
  });

  it('a nested window: resolving one synthetic firing can stack another', async () => {
    // The stacked ability's RESOLUTION triggers the abilities again — the
    // second synthetic firing stacks a new entry and the window reopens.
    const onceMore = ability({
      stacked: true,
      condition: { kind: 'compare', op: '<', left: { kind: 'getVar', varId: 'plays', target: null }, right: num(2) },
      script: [cv('plays', num(1)), again()],
    });
    const h = harness(throneDef(onceMore));
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'throne' });
    expect(h.state().stack).toHaveLength(1);
    // Resolve entry 1 → its script re-fires → entry 2 stacks → window reopens.
    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    await h.engine.performAction('p1', { actionId: PASS_ACTION_ID });
    expect(h.state().globalVars['plays']).toBe(1);
    expect(h.state().stack).toHaveLength(1);
    expect(h.state().window?.holderId).toBe('p0');
    // Resolve entry 2 — its condition now fails, the chain stops cleanly.
    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    await h.engine.performAction('p1', { actionId: PASS_ACTION_ID });
    expect(h.state().globalVars['plays']).toBe(2);
    expect(h.state().stack).toHaveLength(0);
    expect(h.state().window).toBeNull();
    expect(h.errors).toEqual([]);
  });

  it('an unbounded self-retrigger is cut off by the drain cap (no hang)', async () => {
    const loop = ability({ script: [cv('plays', num(1)), again()] });
    const h = harness(throneDef(loop));
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'throne' });
    expect(h.errors.some((e) => e.includes('cascade'))).toBe(true);
    expect(h.state().globalVars['plays']).toBeGreaterThan(1);
  });

  it('missing zone / non-card values report and no-op; null is silent', async () => {
    const def = throneDef(ability());
    def.actions.find((a) => a.id === 'throne')!.script = [
      again({ zoneId: 'nope' }),
      again({ card: { kind: 'str', value: 'ghost' } }),
      again({ card: { kind: 'topCard', zone: zr('elsewhere') } }), // empty zone → null
    ];
    const h = harness(def);
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'throne' });
    expect(h.state().globalVars['plays']).toBe(0);
    expect(h.errors.some((e) => e.includes('unknown zone'))).toBe(true);
    expect(h.errors.some((e) => e.includes('is not a card'))).toBe(true);
    expect(h.errors).toHaveLength(2); // the null card was silent
  });
});
