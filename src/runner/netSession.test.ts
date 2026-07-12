/**
 * Online lockstep: two GameSessions linked by an in-memory transport run
 * their own engines from the same (def, seats, seed) and relay moves +
 * choice answers. After every exchange the two states must be BYTE-IDENTICAL
 * (the engine is deterministic in (seed, move stream, answer stream)).
 */
import { describe, expect, it } from 'vitest';
import type { GameDef } from '../shared/types';
import {
  actionDef, bnd, cdef, customDeck, makeDef, mv, phaseDef, selSpec, sv, vdef,
  zone, zr,
} from '../engine/testkit';
import type { NetAdapter, NetMsg } from './net';
import { GameSession, type SeatSetup } from './session';

/** Two linked adapters; delivery is async (microtask) like a real channel. */
function linkPair(): [NetAdapter, NetAdapter] {
  const handlers: Array<((msg: NetMsg) => void) | null> = [null, null];
  const make = (other: number): NetAdapter => ({
    send: (msg) => {
      queueMicrotask(() => handlers[other]?.(msg));
    },
    onMessage: (cb) => {
      handlers[other === 0 ? 1 : 0] = cb;
    },
    onClose: () => undefined,
  });
  return [make(1), make(0)];
}

function raceDef(): GameDef {
  return makeDef({
    variables: [vdef('picked', 'global', 'string', '')],
    zones: [zone('pool'), { id: 'hand', name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'row', area: 'player' }],
    cards: [cdef('a'), cdef('b'), cdef('c'), cdef('d')],
    decks: [customDeck('d', 'pool', ['a', 'b', 'c', 'd'])],
    phases: [phaseDef('main', 'manual', ['grab', 'ask', 'done'])],
    actions: [
      {
        ...actionDef('grab'),
        target: { kind: 'cardInZone', zoneId: 'pool', ownerOnly: false },
        script: [mv(zr('pool'), zr('hand'), selSpec(bnd('$card')))],
      },
      {
        ...actionDef('ask'),
        script: [
          {
            kind: 'choose',
            who: null,
            choice: {
              kind: 'option',
              prompt: 'Pick a path',
              options: [{ id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }],
            },
          },
          sv('picked', bnd('$choice')),
        ],
      },
      { ...actionDef('done'), script: [{ kind: 'endTurn' }] },
    ],
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (cond()) return;
    await flush();
  }
  throw new Error(`timed out waiting for ${what}`);
}

function pair(def: GameDef) {
  const [a, b] = linkPair();
  const hostSeats: SeatSetup[] = [
    { name: 'Ada', isAI: false },
    { name: 'Brook', isAI: false, remote: true },
  ];
  const guestSeats: SeatSetup[] = [
    { name: 'Ada', isAI: false, remote: true },
    { name: 'Brook', isAI: false },
  ];
  const host = new GameSession(def, hostSeats, 7, a);
  const guest = new GameSession(def, guestSeats, 7, b);
  host.begin();
  guest.begin();
  const sameState = () =>
    JSON.stringify(host.engine.getState()) === JSON.stringify(guest.engine.getState());
  return { host, guest, sameState };
}

describe('lockstep multiplayer sessions', () => {
  it('a host move replays on the guest and the states stay identical', async () => {
    const { host, guest, sameState } = pair(raceDef());
    await until(() => host.snapshot.started && guest.snapshot.started, 'both engines started');
    expect(sameState()).toBe(true);

    // Host (p0, the current player) grabs a specific card.
    const move = host.engine.getLegalMoves('p0').find((m) => m.actionId === 'grab')!;
    await host.performHumanMove(move);
    await until(sameState, 'guest to replay the host move');
    expect(guest.engine.getState().zones['hand:p0'].cardIds).toHaveLength(1);

    // The guest cannot act for the remote seat.
    const before = JSON.stringify(guest.engine.getState());
    await guest.performHumanMove(guest.engine.getLegalMoves('p0')[0] ?? { actionId: 'grab' });
    expect(JSON.stringify(guest.engine.getState())).toBe(before);

    host.dispose();
    guest.dispose();
  });

  it('a remote-seat choice waits for the peer answer, then both converge', async () => {
    const { host, guest, sameState } = pair(raceDef());
    await until(() => host.snapshot.started && guest.snapshot.started, 'both engines started');

    // Hand the turn to Brook (p1, local on the GUEST).
    const done = host.engine.getLegalMoves('p0').find((m) => m.actionId === 'done')!;
    await host.performHumanMove(done);
    await until(sameState, 'turn handoff to replay');

    // Brook performs the asking action ON THE GUEST; the guest gets the
    // sheet, the host parks the same request for the remote seat.
    const ask = guest.engine.getLegalMoves('p1').find((m) => m.actionId === 'ask')!;
    const perform = guest.performHumanMove(ask);
    await until(() => guest.snapshot.choice !== null, 'the guest to see the choice sheet');
    expect(guest.snapshot.choice!.kind).toBe('option');

    guest.answerChoice(guest.snapshot.choice!.id, 'right');
    await perform;
    await until(
      () => sameState() && host.engine.getState().globalVars['picked'] === 'right',
      'the answer to relay and both states to converge',
    );

    host.dispose();
    guest.dispose();
  });
});
