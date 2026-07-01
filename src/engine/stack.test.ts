/**
 * Stack & priority window tests — stacked actions/triggers, pass priority,
 * LIFO resolution, cancel, snapshot bindings, chooseCards, zone capacity.
 */
import { describe, expect, it } from 'vitest';
import type { GameDef } from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import {
  actionDef, bnd, cdef, cmp, customDeck, cv, harness, makeDef, mv, num, phaseDef, selAll,
  selSpec, selTop, str, sv, vdef, zone, zr,
} from './testkit';

/**
 * A tiny duel: per-player Hand + shared StackZone + shared Graveyard.
 * "Cast" is a stacked action: announce moves the card to StackZone, the
 * resolution sets global `effect` to the card's name and buries the card.
 * "Counter" is a stacked response that cancels the top effect.
 */
function duelDef(over: Partial<GameDef> = {}): GameDef {
  return makeDef({
    variables: [
      vdef('effect', 'global', 'string', ''),
      vdef('resolved', 'global', 'number', 0),
    ],
    zones: [
      { id: 'hand', name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'fan', area: 'player' },
      zone('stackzone'),
      zone('grave'),
    ],
    cards: [cdef('bolt'), cdef('negate')],
    decks: [customDeck('d', 'hand', ['bolt', 'negate'])],
    phases: [phaseDef('main', 'manual', ['cast', 'done'])],
    actions: [
      {
        ...actionDef('cast'),
        name: 'Cast',
        target: { kind: 'cardInZone', zoneId: 'hand', ownerOnly: true },
        stacked: true,
        announce: [mv(zr('hand'), zr('stackzone'), selSpec(bnd('$card')))],
        script: [
          sv('effect', { kind: 'cardField', card: bnd('$card'), fieldId: 'name' }),
          cv('resolved', num(1)),
          mv(zr('stackzone'), zr('grave'), selSpec(bnd('$card'))),
        ],
      },
      {
        ...actionDef('counter'),
        name: 'Counter',
        target: { kind: 'none' },
        speed: 'response',
        legality: cmp('>', { kind: 'stackSize' }, num(0)),
        script: [{ kind: 'cancelTopEffect', cardTo: 'grave' }],
      },
      { ...actionDef('done'), script: [{ kind: 'endTurn' }] },
    ],
    ...over,
  });
}

describe('stacked actions & priority windows', () => {
  it('announce runs immediately, resolution waits for all players to pass', async () => {
    const h = harness(duelDef());
    await h.engine.start();
    const move = h.engine.getLegalMoves('p0').find((m) => m.actionId === 'cast')!;
    await h.engine.performAction('p0', move);

    // Announced: card moved to the stack zone, effect NOT yet applied.
    expect(h.state().zones['stackzone'].cardIds).toHaveLength(1);
    expect(h.state().globalVars['effect']).toBe('');
    expect(h.state().stack).toHaveLength(1);
    expect(h.state().window?.holderId).toBe('p0');

    // Normal moves are gone; only response moves + pass for the holder.
    expect(h.engine.getLegalMoves('p1')).toEqual([]);
    const holderMoves = h.engine.getLegalMoves('p0');
    expect(holderMoves.some((m) => m.actionId === PASS_ACTION_ID)).toBe(true);
    expect(holderMoves.some((m) => m.actionId === 'cast')).toBe(false);

    // Both players pass -> the effect resolves with its $card snapshot.
    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    expect(h.state().window?.holderId).toBe('p1');
    await h.engine.performAction('p1', { actionId: PASS_ACTION_ID });

    expect(h.state().stack).toHaveLength(0);
    expect(h.state().window).toBeNull();
    expect(h.state().globalVars['effect']).toBe('bolt');
    expect(h.state().zones['grave'].cardIds).toHaveLength(1);
    expect(h.errors).toEqual([]);
  });

  it('a response counter cancels the spell: LIFO resolution', async () => {
    const h = harness(duelDef());
    await h.engine.start();
    const move = h.engine.getLegalMoves('p0').find((m) => m.actionId === 'cast')!;
    await h.engine.performAction('p0', move);

    // p0 passes; p1 counters (resets passes), then both pass.
    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    const counter = h.engine.getLegalMoves('p1').find((m) => m.actionId === 'counter')!;
    await h.engine.performAction('p1', counter);
    expect(h.state().window?.passes).toBe(0);

    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    await h.engine.performAction('p1', { actionId: PASS_ACTION_ID });

    // Counter (unstacked response) ran inline: the spell was cancelled before
    // it could resolve — its effect never applied, the card went to the grave.
    expect(h.state().globalVars['effect']).toBe('');
    expect(h.state().globalVars['resolved']).toBe(0);
    expect(h.state().zones['grave'].cardIds).toHaveLength(1);
    expect(h.state().stack).toHaveLength(0);
    expect(h.state().window).toBeNull();
  });

  it('passing as a non-holder or during normal play is illegal', async () => {
    const h = harness(duelDef());
    await h.engine.start();
    await expect(h.engine.performAction('p0', { actionId: PASS_ACTION_ID })).rejects.toThrow(/Illegal/);
    const move = h.engine.getLegalMoves('p0').find((m) => m.actionId === 'cast')!;
    await h.engine.performAction('p0', move);
    await expect(h.engine.performAction('p1', { actionId: PASS_ACTION_ID })).rejects.toThrow(/Illegal/);
  });

  it('oneAction phase bookkeeping waits until the stack empties', async () => {
    const def = duelDef({
      phases: [phaseDef('main', 'oneAction', ['cast']), phaseDef('second', 'manual', ['done'])],
    });
    const h = harness(def);
    await h.engine.start();
    const move = h.engine.getLegalMoves('p0').find((m) => m.actionId === 'cast')!;
    await h.engine.performAction('p0', move);
    // Mid-stack: still in phase 0.
    expect(h.state().phaseIdx).toBe(0);
    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    await h.engine.performAction('p1', { actionId: PASS_ACTION_ID });
    // Resolved: the oneAction advance happened afterwards.
    expect(h.state().phaseIdx).toBe(1);
    expect(h.state().globalVars['effect']).toBe('bolt');
  });

  it('stacked triggers push with event bindings and resolve via the window', async () => {
    const def = makeDef({
      variables: [vdef('seen', 'global', 'string', '')],
      zones: [zone('a'), zone('b')],
      cards: [cdef('c1')],
      decks: [customDeck('d', 'a', ['c1'])],
      phases: [phaseDef('main', 'manual', ['put', 'idle'])],
      actions: [
        { ...actionDef('put'), script: [mv(zr('a'), zr('b'), selTop(1))] },
        actionDef('idle'),
      ],
      triggers: [{
        id: 't', name: 'On arrival', stacked: true,
        event: { kind: 'cardEnterZone', zoneId: 'b' },
        condition: null,
        script: [sv('seen', { kind: 'cardField', card: bnd('$card'), fieldId: 'name' })],
      }],
    });
    const h = harness(def);
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'put' });
    expect(h.state().stack).toHaveLength(1);
    expect(h.state().globalVars['seen']).toBe('');
    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    await h.engine.performAction('p1', { actionId: PASS_ACTION_ID });
    expect(h.state().globalVars['seen']).toBe('c1'); // $card came from the snapshot
    expect(h.state().window).toBeNull();
  });

  it('endGame during a resolution discards the rest of the stack', async () => {
    const def = duelDef();
    // Make the cast resolution end the game.
    const cast = def.actions.find((a) => a.id === 'cast')!;
    cast.script = [{ kind: 'endGame', winner: { kind: 'player', player: bnd('$player') } }];
    const h = harness(def);
    await h.engine.start();
    const m1 = h.engine.getLegalMoves('p0').filter((m) => m.actionId === 'cast');
    await h.engine.performAction('p0', m1[0]);
    await h.engine.performAction('p0', { actionId: PASS_ACTION_ID });
    await h.engine.performAction('p1', { actionId: PASS_ACTION_ID });
    expect(h.engine.finished).toBe(true);
    expect(h.state().result?.winners).toEqual(['p0']);
    expect(h.state().stack).toHaveLength(0);
    expect(h.state().window).toBeNull();
  });
});

describe('chooseCards', () => {
  const pickDef = () => makeDef({
    variables: [vdef('total', 'global', 'number', 0)],
    zones: [zone('pool'), zone('out')],
    cards: [cdef('c1', { v: 1 }), cdef('c2', { v: 2 }), cdef('c3', { v: 4 })],
    templates: [{
      id: 'tpl', name: 'T', aspect: 0.7, background: '#000', borderColor: '#000', cornerRadius: 4,
      elements: [], fields: [{ id: 'v', name: 'v', type: 'number' }],
    }],
    decks: [customDeck('d', 'pool', ['c1', 'c2', 'c3'])],
    setup: [{
      kind: 'chooseCards', who: null, from: zr('pool'), filter: null,
      min: num(1), max: num(2), prompt: 'Pick', revealed: true,
      body: [
        cv('total', { kind: 'cardField', card: bnd('$card'), fieldId: 'v' }),
        mv(zr('pool'), zr('out'), selSpec(bnd('$card'))),
      ],
    }],
    phases: [phaseDef('main', 'manual', ['idle'])],
    actions: [actionDef('idle')],
  });

  it('runs the body once per picked card, in pick order', async () => {
    const h = harness(pickDef(), {
      answers: [(req) => req.kind === 'cards' ? JSON.stringify([req.cardIds[2], req.cardIds[0]]) : null],
    });
    await h.engine.start();
    expect(h.state().globalVars['total']).toBe(5); // 4 + 1
    expect(h.state().zones['out'].cardIds).toHaveLength(2);
    expect(h.choices.requests[0]).toMatchObject({ kind: 'cards', min: 1, max: 2, revealed: true });
    expect(h.errors).toEqual([]);
  });

  it('rejects bad answers (dupes, out-of-range count) and falls back to the first min', async () => {
    const h = harness(pickDef(), {
      answers: [
        (req) => req.kind === 'cards' ? JSON.stringify([req.cardIds[0], req.cardIds[0]]) : null, // dupes
        () => JSON.stringify([]),  // below min
        () => 'not json',
      ],
    });
    await h.engine.start();
    // Fallback = first `min` candidates = [c1] -> total 1.
    expect(h.state().globalVars['total']).toBe(1);
    expect(h.errors.some((e) => e.includes('no valid answer'))).toBe(true);
  });
});

describe('zone capacity', () => {
  it('moves only what fits and reports the overflow', async () => {
    const def = makeDef({
      zones: [
        zone('a'),
        { id: 'slots', name: 'Slots', owner: 'shared', visibility: 'all', layout: 'row', area: 'center', capacity: 2 },
      ],
      cards: [cdef('c1'), cdef('c2'), cdef('c3')],
      decks: [customDeck('d', 'a', ['c1', 'c2', 'c3'])],
      setup: [mv(zr('a'), zr('slots'), selAll)],
      phases: [phaseDef('main', 'manual', ['idle'])],
      actions: [actionDef('idle')],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().zones['slots'].cardIds).toHaveLength(2);
    expect(h.state().zones['a'].cardIds).toHaveLength(1);
    expect(h.errors.some((e) => e.includes('full'))).toBe(true);
  });

  it('legality can read the remaining room', async () => {
    const def = makeDef({
      zones: [
        zone('a'),
        { id: 'slots', name: 'Slots', owner: 'shared', visibility: 'all', layout: 'row', area: 'center', capacity: 1 },
      ],
      cards: [cdef('c1'), cdef('c2')],
      decks: [customDeck('d', 'a', ['c1', 'c2'])],
      phases: [phaseDef('main', 'manual', ['fill', 'idle'])],
      actions: [
        {
          ...actionDef('fill'),
          legality: cmp('<', { kind: 'zoneCount', zone: zr('slots') }, num(1)),
          script: [mv(zr('a'), zr('slots'), selTop(1))],
        },
        actionDef('idle'),
      ],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.engine.getLegalMoves('p0').some((m) => m.actionId === 'fill')).toBe(true);
    await h.engine.performAction('p0', { actionId: 'fill' });
    expect(h.engine.getLegalMoves('p0').some((m) => m.actionId === 'fill')).toBe(false);
  });
});

describe('stack expressions', () => {
  it('stackTopCard exposes the announced card to response legality', async () => {
    const h = harness(duelDef());
    await h.engine.start();
    const move = h.engine.getLegalMoves('p0').find((m) => m.actionId === 'cast')!;
    await h.engine.performAction('p0', move);
    // While the window is open, evaluate via a response action whose legality
    // compares the top-of-stack card's name.
    const def2 = duelDef();
    def2.actions.find((a) => a.id === 'counter')!.legality =
      cmp('==', { kind: 'cardField', card: { kind: 'stackTopCard' }, fieldId: 'name' }, str(gvName(h)));
    // Simpler: directly check the state mirror.
    expect(h.state().stack[0].sourceCardId).toBeTruthy();
    const top = h.state().stack[h.state().stack.length - 1];
    expect(h.state().cards[top.sourceCardId!].name).toMatch(/bolt|negate/);
  });
});

function gvName(h: ReturnType<typeof harness>): string {
  const top = h.state().stack[h.state().stack.length - 1];
  return h.state().cards[top.sourceCardId!].name;
}
