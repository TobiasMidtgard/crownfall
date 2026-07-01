/**
 * Headless smoke tests for GameSession: the AI loop drives a game to
 * completion, human choices/moves route through the snapshot, response
 * windows route to the priority holder (human Pass button, AI auto-pass),
 * and multi-select 'cards' choices round-trip.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Block, GameDef } from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import {
  actionDef, cdef, cmp, customDeck, cv, makeDef, mv, num, phaseDef, pzone, selSpec, selTop, std52,
  vdef, zcount, zone, zr, bnd, sv,
} from '../engine/testkit';
import { GameSession } from './session';

/** Tiny race: shared deck of 4 aces, "draw" moves one to your pile and scores
 *  a point; the game ends when the deck empties (highest score wins). */
function raceDef(): GameDef {
  return makeDef({
    variables: [vdef('score', 'perPlayer', 'number', 0)],
    zones: [zone('deck', { visibility: 'none' }), pzone('won', { layout: 'stack' })],
    decks: [std52('d', 'deck', { excludeRanks: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] })],
    phases: [phaseDef('main', 'oneAction', ['draw'])],
    actions: [actionDef('draw', {
      target: { kind: 'zone', zoneId: 'deck', ownerOnly: false },
      legality: cmp('>', zcount(zr('deck')), num(0)),
      script: [mv(zr('deck'), zr('won'), selTop(1)), cv('score', num(1))],
    })],
    endConditions: [{
      id: 'end',
      name: 'deck empty',
      condition: cmp('==', zcount(zr('deck')), num(0)),
      winner: { kind: 'highestVar', varId: 'score' },
    }],
  });
}

const realTick = () => new Promise((r) => setTimeout(r, 0));

describe('GameSession', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('plays an all-AI game to completion via the AI loop', async () => {
    vi.useFakeTimers();
    const session = new GameSession(raceDef(), [
      { name: 'Bot A', isAI: true },
      { name: 'Bot B', isAI: true },
    ], 7);
    session.begin();
    // 4 draws at ~700ms apart, generous slack.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(session.snapshot.started).toBe(true);
    expect(session.snapshot.finished).toBe(true);
    // 4 aces split 2/2 -> both players tie as winners.
    expect(session.snapshot.state.result?.winners).toEqual(['p0', 'p1']);
    session.dispose();
  });

  it('routes a human choice into the snapshot and resumes on answer', async () => {
    const chooseOption: Block = {
      kind: 'choose',
      who: null,
      choice: { kind: 'option', prompt: 'Pick one', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] },
    };
    const def = makeDef({
      variables: [vdef('picked', 'global', 'string', '')],
      setup: [chooseOption, sv('picked', bnd('$choice'))],
    });
    const session = new GameSession(def, [{ name: 'Human', isAI: false }], 1);
    session.begin();
    await realTick();

    expect(session.snapshot.choice?.kind).toBe('option');
    expect(session.snapshot.choice?.playerId).toBe('p0');
    const reqId = session.snapshot.choice!.id;
    // A stale answer (wrong request id) must be ignored…
    session.answerChoice(reqId + 99, 'a');
    await realTick();
    expect(session.snapshot.choice?.id).toBe(reqId);
    // …the matching one resolves it.
    session.answerChoice(reqId, 'b');
    await realTick();

    expect(session.snapshot.choice).toBeNull();
    expect(session.snapshot.started).toBe(true);
    expect(session.snapshot.state.globalVars['picked']).toBe('b');
    // Human turn, idle action offered.
    expect(session.snapshot.moves).toEqual([{ actionId: 'idle' }]);
    session.dispose();
  });

  it('offers legal moves to a human and performs them', async () => {
    const def = raceDef();
    const session = new GameSession(def, [{ name: 'Human', isAI: false }], 3);
    session.begin();
    await realTick();

    expect(session.snapshot.moves).toEqual([{ actionId: 'draw' }]);
    await session.performHumanMove({ actionId: 'draw' });
    expect(session.snapshot.state.zones['won:p0'].cardIds).toHaveLength(1);
    expect(session.snapshot.state.players[0].vars['score']).toBe(1);

    // A stale/illegal move is swallowed and legal moves re-synced.
    await session.performHumanMove({ actionId: 'nope' });
    expect(session.snapshot.moves).toEqual([{ actionId: 'draw' }]);
    session.dispose();
  });

  it('routes a response window to the holder; AI seats pass it to resolution', async () => {
    // "cast" is stacked: announce moves the top card to the stack zone, the
    // resolution sets `effect` and buries it. No response actions exist, so
    // the AI holder's only legal move is the built-in Pass.
    const def = makeDef({
      variables: [vdef('effect', 'global', 'string', '')],
      zones: [zone('source'), zone('stackzone'), zone('grave')],
      cards: [cdef('bolt')],
      decks: [customDeck('d', 'source', ['bolt'])],
      phases: [phaseDef('main', 'manual', ['cast', 'idle'])],
      actions: [
        {
          ...actionDef('cast'),
          legality: cmp('>', zcount(zr('source')), num(0)),
          stacked: true,
          announce: [mv(zr('source'), zr('stackzone'), selTop(1))],
          script: [sv('effect', { kind: 'str', value: 'resolved' }), mv(zr('stackzone'), zr('grave'), selTop(1))],
        },
        actionDef('idle'),
      ],
    });
    vi.useFakeTimers();
    const session = new GameSession(def, [
      { name: 'Human', isAI: false },
      { name: 'Bot', isAI: true },
    ], 11);
    session.begin();
    await vi.advanceTimersByTimeAsync(50);
    expect(session.snapshot.moves).toContainEqual({ actionId: 'cast' });

    await session.performHumanMove({ actionId: 'cast' });
    // Announced but unresolved: entry on the stack, window open on the caster.
    expect(session.snapshot.state.stack).toHaveLength(1);
    expect(session.snapshot.state.window?.holderId).toBe('p0');
    expect(session.snapshot.state.globalVars['effect']).toBe('');
    // The human holder is offered the built-in Pass as a legal move.
    expect(session.snapshot.moves).toContainEqual({ actionId: PASS_ACTION_ID });

    await session.performHumanMove({ actionId: PASS_ACTION_ID });
    expect(session.snapshot.state.window?.holderId).toBe('p1');
    // The AI holder (NOT the current player) auto-passes after its delay,
    // which completes the rotation and resolves the top of the stack.
    await vi.advanceTimersByTimeAsync(5000);
    expect(session.snapshot.state.window).toBeNull();
    expect(session.snapshot.state.stack).toHaveLength(0);
    expect(session.snapshot.state.globalVars['effect']).toBe('resolved');
    expect(session.snapshot.state.zones['grave'].cardIds).toHaveLength(1);
    session.dispose();
  });

  it("round-trips a multi-select 'cards' choice through the snapshot", async () => {
    const def = makeDef({
      zones: [zone('pool'), zone('out')],
      cards: [cdef('c1'), cdef('c2'), cdef('c3')],
      decks: [customDeck('d', 'pool', ['c1', 'c2', 'c3'])],
      setup: [{
        kind: 'chooseCards', who: null, from: zr('pool'), filter: null,
        min: num(1), max: num(2), prompt: 'Pick', revealed: true,
        body: [mv(zr('pool'), zr('out'), selSpec(bnd('$card')))],
      }],
    });
    const session = new GameSession(def, [{ name: 'Human', isAI: false }], 2);
    session.begin();
    await realTick();

    const choice = session.snapshot.choice;
    expect(choice).toMatchObject({ kind: 'cards', playerId: 'p0', min: 1, max: 2, revealed: true });
    if (choice?.kind !== 'cards') throw new Error('expected a cards choice');
    // Answer in pick order (last candidate first) — JSON array string.
    session.answerChoice(choice.id, JSON.stringify([choice.cardIds[2], choice.cardIds[0]]));
    await realTick();

    expect(session.snapshot.choice).toBeNull();
    expect(session.snapshot.state.zones['out'].cardIds).toHaveLength(2);
    expect(session.snapshot.state.zones['pool'].cardIds).toHaveLength(1);
    session.dispose();
  });
});
