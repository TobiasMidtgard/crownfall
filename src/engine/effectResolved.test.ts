/**
 * The `effectResolved` stack-lifecycle event (wave 1a): fires after a pending
 * entry's script settles, before the window-reopen decision; binds $card /
 * $player; never fires for cancelled entries.
 */
import { describe, expect, it } from 'vitest';
import type { GameDef, TriggerDef } from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import {
  actionDef, bnd, cdef, cmp, customDeck, cv, fld, harness, makeDef, mv, num,
  phaseDef, selSpec, sv, vdef, zone, zr,
} from './testkit';

const resolvedTrigger = (over: Partial<TriggerDef> = {}): TriggerDef => ({
  id: 'on-resolved', name: 'on-resolved', condition: null,
  event: { kind: 'effectResolved' },
  script: [cv('resolved', num(1))],
  ...over,
});

/** Stacked "cast": announce moves the card to the stack zone, resolution buries it. */
function duelDef(over: Partial<GameDef> = {}): GameDef {
  return makeDef({
    variables: [
      vdef('resolved', 'global', 'number', 0),
      vdef('who', 'global', 'string', ''),
      vdef('what', 'global', 'string', ''),
      vdef('entered', 'global', 'number', 0),
      vdef('orderOk', 'global', 'boolean', false),
    ],
    zones: [zone('hand'), zone('stackzone'), zone('grave')],
    cards: [cdef('bolt')],
    decks: [customDeck('d', 'hand', ['bolt'])],
    phases: [phaseDef('main', 'manual', ['cast', 'idle'])],
    actions: [
      {
        ...actionDef('cast'),
        target: { kind: 'cardInZone', zoneId: 'hand', ownerOnly: false },
        stacked: true,
        announce: [mv(zr('hand'), zr('stackzone'), selSpec(bnd('$card')))],
        script: [mv(zr('stackzone'), zr('grave'), selSpec(bnd('$card')))],
      },
      {
        ...actionDef('counter'),
        speed: 'response',
        legality: cmp('>', { kind: 'stackSize' }, num(0)),
        script: [{ kind: 'cancelTopEffect', cardTo: 'grave' }],
      },
      actionDef('idle'),
    ],
    triggers: [resolvedTrigger()],
    ...over,
  });
}

async function castAndPass(h: ReturnType<typeof harness>) {
  const move = h.engine.getLegalMoves('p0').find((m) => m.actionId === 'cast')!;
  await h.engine.performAction('p0', move);
  await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
  await h.engine.performAction('p1', { actionId: PASS_ACTION_ID });
}

describe('effectResolved', () => {
  it('fires once per resolved entry with $card and $player bound', async () => {
    const def = duelDef();
    def.triggers = [resolvedTrigger({
      script: [
        cv('resolved', num(1)),
        sv('who', bnd('$player')),
        sv('what', fld(bnd('$card'), 'name')),
      ],
    })];
    const h = harness(def);
    await h.engine.start();
    await castAndPass(h);
    expect(h.state().globalVars['resolved']).toBe(1);
    expect(h.state().globalVars['who']).toBe('p0');    // who announced it
    expect(h.state().globalVars['what']).toBe('bolt'); // the source card
    expect(h.errors).toEqual([]);
  });

  it('fires AFTER the entry script settled (its cascades ran first)', async () => {
    const def = duelDef();
    def.triggers = [
      {
        id: 'on-grave', name: 'on-grave', condition: null,
        event: { kind: 'cardEnterZone', zoneId: 'grave' },
        script: [cv('entered', num(1))],
      },
      resolvedTrigger({
        // True only if the enter-zone cascade already ran when this fires.
        script: [sv('orderOk', cmp('==', { kind: 'getVar', varId: 'entered', target: null }, num(1)))],
      }),
    ];
    const h = harness(def);
    await h.engine.start();
    await castAndPass(h);
    expect(h.state().globalVars['entered']).toBe(1);
    expect(h.state().globalVars['orderOk']).toBe(true);
  });

  it('fires before the window-reopen decision: a stacked listener reopens the window', async () => {
    const def = duelDef();
    def.triggers = [resolvedTrigger({
      stacked: true,
      // Guard so the loop stops after one echo (STACK_CAP would bound it anyway).
      condition: cmp('<', { kind: 'getVar', varId: 'resolved', target: null }, num(1)),
    })];
    const h = harness(def);
    await h.engine.start();
    await castAndPass(h);
    // The listener stacked during effectResolved → the window reopened for it.
    expect(h.state().stack).toHaveLength(1);
    expect(h.state().window?.holderId).toBe('p0');
    expect(h.state().globalVars['resolved']).toBe(0);
    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    await h.engine.performAction('p1', { actionId: PASS_ACTION_ID });
    expect(h.state().globalVars['resolved']).toBe(1);
    expect(h.state().stack).toHaveLength(0);
    expect(h.state().window).toBeNull();
  });

  it('cancelled entries never fire effectResolved', async () => {
    const h = harness(duelDef());
    await h.engine.start();
    const move = h.engine.getLegalMoves('p0').find((m) => m.actionId === 'cast')!;
    await h.engine.performAction('p0', move);
    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    const counter = h.engine.getLegalMoves('p1').find((m) => m.actionId === 'counter')!;
    await h.engine.performAction('p1', counter); // cancels the cast inline
    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    await h.engine.performAction('p1', { actionId: PASS_ACTION_ID });
    expect(h.state().stack).toHaveLength(0);
    expect(h.state().globalVars['resolved']).toBe(0); // nothing ever RESOLVED
  });
});
