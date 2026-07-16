/**
 * Online lockstep: two GameSessions linked by an in-memory transport run
 * their own engines from the same (def, seats, seed) and relay moves +
 * choice answers. After every exchange the two states must be BYTE-IDENTICAL
 * (the engine is deterministic in (seed, move stream, answer stream)).
 *
 * Also covered here: the lockstep tripwire (state hashes on relayed frames,
 * a mismatch freezes the table as a desync), the dedicated disconnect state,
 * and the room lifecycle against a mocked PeerJS (full-room refusal,
 * cancelled rooms, friendly error copy).
 */
import { describe, expect, it, vi } from 'vitest';
import Peer from 'peerjs';
import type { GameDef } from '../shared/types';
import {
  actionDef, bnd, cdef, customDeck, makeDef, mv, phaseDef, selSpec, sv, vdef,
  zone, zr,
} from '../engine/testkit';
import { hostGame, joinGame, type NetAdapter, type NetFault, type NetMsg } from './net';
import { GameSession, type SeatSetup } from './session';

// ---------------------------------------------------------------------------
// Mocked PeerJS: net.ts drives Peer/DataConnection purely through .on/.send/
// .close/.destroy/.connect, so tiny emitters stand in for the real thing.
vi.mock('peerjs', () => {
  class FakeEmitter {
    private handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    on(ev: string, cb: (...args: unknown[]) => void) {
      const list = this.handlers.get(ev) ?? [];
      list.push(cb);
      this.handlers.set(ev, list);
      return this;
    }
    emit(ev: string, ...args: unknown[]) {
      for (const cb of this.handlers.get(ev) ?? []) cb(...args);
    }
  }
  class FakeDataConnection extends FakeEmitter {
    sent: unknown[] = [];
    closed = false;
    send(data: unknown) { this.sent.push(data); }
    close() {
      this.closed = true;
      this.emit('close');
    }
  }
  class FakePeer extends FakeEmitter {
    static instances: FakePeer[] = [];
    id?: string;
    destroyed = false;
    lastConn: FakeDataConnection | null = null;
    constructor(id?: string) {
      super();
      this.id = id;
      FakePeer.instances.push(this);
    }
    connect() {
      this.lastConn = new FakeDataConnection();
      return this.lastConn;
    }
    destroy() { this.destroyed = true; }
    reconnect() { /* noop */ }
  }
  return { default: FakePeer };
});

interface Emits {
  on(ev: string, cb: (...args: unknown[]) => void): unknown;
  emit(ev: string, ...args: unknown[]): void;
}
interface FakeConnLike extends Emits {
  sent: Array<{ t: string }>;
  closed: boolean;
}
interface FakePeerLike extends Emits {
  destroyed: boolean;
  lastConn: FakeConnLike | null;
}
/** The FakePeer most recently constructed by net.ts. */
function lastPeer(): FakePeerLike {
  const all = (Peer as unknown as { instances: FakePeerLike[] }).instances;
  return all[all.length - 1];
}

/** A guest-side connection the test hands to the host's 'connection' event. */
function makeGuestConn() {
  const handlers = new Map<string, ((arg?: unknown) => void)[]>();
  return {
    sent: [] as Array<{ t: string }>,
    closed: false,
    on(ev: string, cb: (arg?: unknown) => void) {
      const list = handlers.get(ev) ?? [];
      list.push(cb);
      handlers.set(ev, list);
    },
    emit(ev: string, arg?: unknown) {
      for (const cb of handlers.get(ev) ?? []) cb(arg);
    },
    send(data: unknown) { this.sent.push(data as { t: string }); },
    close() {
      this.closed = true;
      this.emit('close');
    },
  };
}

// ---------------------------------------------------------------------------

/** A linked adapter that can also simulate its transport dropping. */
interface SeverableAdapter extends NetAdapter {
  /** Fires this side's onClose, like the peer's tab closing. */
  sever(): void;
}

/** Two linked adapters; delivery is async (microtask) like a real channel. */
function linkPair(): [SeverableAdapter, SeverableAdapter] {
  const handlers: Array<((msg: NetMsg) => void) | null> = [null, null];
  const closers: Array<(() => void) | null> = [null, null];
  const make = (self: 0 | 1, other: 0 | 1): SeverableAdapter => ({
    send: (msg) => {
      queueMicrotask(() => handlers[other]?.(msg));
    },
    onMessage: (cb) => {
      handlers[self] = cb;
    },
    onClose: (cb) => {
      closers[self] = cb;
    },
    sever: () => closers[self]?.(),
  });
  return [make(0, 1), make(1, 0)];
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

const hostSeats = (): SeatSetup[] => [
  { name: 'Ada', isAI: false },
  { name: 'Brook', isAI: false, remote: true },
];
const guestSeats = (): SeatSetup[] => [
  { name: 'Ada', isAI: false, remote: true },
  { name: 'Brook', isAI: false },
];

function pair(def: GameDef) {
  const [a, b] = linkPair();
  const host = new GameSession(def, hostSeats(), 7, a);
  const guest = new GameSession(def, guestSeats(), 7, b);
  host.begin();
  guest.begin();
  const sameState = () =>
    JSON.stringify(host.engine.getState()) === JSON.stringify(guest.engine.getState());
  return { host, guest, sameState, links: [a, b] as const };
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
    // Matching hashes: neither side saw a desync.
    expect(host.snapshot.netDown).toBeNull();
    expect(guest.snapshot.netDown).toBeNull();

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
    expect(host.snapshot.netDown).toBeNull();
    expect(guest.snapshot.netDown).toBeNull();

    host.dispose();
    guest.dispose();
  });

  it('a peer disconnect freezes the table via netDown, not the dismissible scriptError', async () => {
    const { host, guest, links } = pair(raceDef());
    await until(() => host.snapshot.started && guest.snapshot.started, 'both engines started');
    expect(host.snapshot.moves.length).toBeGreaterThan(0);

    links[0].sever(); // the host's transport drops
    await until(() => host.snapshot.netDown !== null, 'the host to notice the drop');
    expect(host.snapshot.netDown!.kind).toBe('disconnect');
    expect(host.snapshot.scriptError).toBeNull();
    expect(host.snapshot.moves).toEqual([]);

    // Local taps are refused while the link is down — no forking into the void.
    const before = JSON.stringify(host.engine.getState());
    await host.performHumanMove({ actionId: 'grab' });
    expect(JSON.stringify(host.engine.getState())).toBe(before);

    host.dispose();
    guest.dispose();
  });

  it('a state-hash mismatch freezes the receiver with a desync fault', async () => {
    const [a, b] = linkPair();
    // Corrupt the lockstep hash in transit: the receiver must notice the fork.
    const tampered: NetAdapter = {
      send: (msg) => a.send(msg.t === 'move' ? { ...msg, h: ((msg.h ?? 0) ^ 1) >>> 0 } : msg),
      onMessage: (cb) => a.onMessage(cb),
      onClose: (cb) => a.onClose(cb),
    };
    const faults: NetFault[] = [];
    b.reportFault = (f) => faults.push(f);
    const host = new GameSession(raceDef(), hostSeats(), 7, tampered);
    const guest = new GameSession(raceDef(), guestSeats(), 7, b);
    host.begin();
    guest.begin();
    await until(() => host.snapshot.started && guest.snapshot.started, 'both engines started');

    const move = host.engine.getLegalMoves('p0').find((m) => m.actionId === 'grab')!;
    await host.performHumanMove(move);
    await until(() => guest.snapshot.netDown !== null, 'the guest to detect the desync');
    expect(guest.snapshot.netDown!.kind).toBe('desync');
    expect(faults.map((f) => f.kind)).toContain('desync');
    // Frozen: no legal moves surface and local taps are refused.
    expect(guest.snapshot.moves).toEqual([]);
    const before = JSON.stringify(guest.engine.getState());
    await guest.performHumanMove({ actionId: 'grab' });
    expect(JSON.stringify(guest.engine.getState())).toBe(before);

    host.dispose();
    guest.dispose();
  });

  it('tolerates hash-less frames from an older peer build', async () => {
    const [a, b] = linkPair();
    const strip = (ad: NetAdapter): NetAdapter => ({
      send: (msg) => {
        const bare = { ...msg };
        delete bare.h;
        ad.send(bare);
      },
      onMessage: (cb) => ad.onMessage(cb),
      onClose: (cb) => ad.onClose(cb),
    });
    const host = new GameSession(raceDef(), hostSeats(), 7, strip(a));
    const guest = new GameSession(raceDef(), guestSeats(), 7, strip(b));
    host.begin();
    guest.begin();
    await until(() => host.snapshot.started && guest.snapshot.started, 'both engines started');

    const move = host.engine.getLegalMoves('p0').find((m) => m.actionId === 'grab')!;
    await host.performHumanMove(move);
    await until(
      () => JSON.stringify(host.engine.getState()) === JSON.stringify(guest.engine.getState())
        && guest.engine.getState().zones['hand:p0'].cardIds.length === 1,
      'the guest to replay the hash-less move',
    );
    expect(host.snapshot.netDown).toBeNull();
    expect(guest.snapshot.netDown).toBeNull();

    host.dispose();
    guest.dispose();
  });
});

describe('room lifecycle (mocked peerjs)', () => {
  it('refuses a second joiner once the match starts', async () => {
    const h = hostGame(raceDef(), 7, 'Ada');
    const roomPeer = lastPeer();

    const first = makeGuestConn();
    roomPeer.emit('connection', first);
    first.emit('data', { t: 'join', name: 'Brook' });
    const m = await h.match;
    expect(m.seatNames).toEqual(['Ada', 'Brook']);
    expect(first.sent[0].t).toBe('hello');

    // Friend B enters the shared code after the game started.
    const second = makeGuestConn();
    roomPeer.emit('connection', second);
    second.emit('data', { t: 'join', name: 'Late' });
    expect(second.sent).toEqual([{ t: 'full' }]); // refusal, never a hello
    await new Promise((r) => setTimeout(r, 450)); // REFUSE_CLOSE_MS flush grace
    expect(second.closed).toBe(true);
  });

  it('a guest hitting a full room gets plain copy and tears its peer down', async () => {
    const j = joinGame('ABCDEF', 'Late');
    const guestPeer = lastPeer();
    guestPeer.emit('open');
    const conn = guestPeer.lastConn!;
    conn.emit('open');
    expect(conn.sent[0]).toEqual({ t: 'join', name: 'Late' });

    conn.emit('data', { t: 'full' });
    await expect(j.match).rejects.toThrow('That table is already in play.');
    expect(guestPeer.destroyed).toBe(true); // no leaked broker socket
  });

  it('a cancelled room (local start / page left) refuses a join instead of matching', async () => {
    const h = hostGame(raceDef(), 7, 'Ada');
    const roomPeer = lastPeer();

    h.cancel(); // PlayPage: '▶ Start game' locally, or unmount
    expect(roomPeer.destroyed).toBe(true);

    // A join already mid-flight when the room died still gets refused.
    const conn = makeGuestConn();
    roomPeer.emit('connection', conn);
    conn.emit('data', { t: 'join', name: 'Late' });
    expect(conn.sent).toEqual([{ t: 'full' }]);

    let settled = false;
    void h.match.then(() => { settled = true; }, () => { settled = true; });
    await flush();
    expect(settled).toBe(false); // the ghost match can never start
  });

  it('maps raw PeerJS errors to plain human copy (raw stays in the console)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const j = joinGame('ABCDEF', 'Ann');
    const guestPeer = lastPeer();
    guestPeer.emit('error', Object.assign(new Error('Lost connection to server.'), { type: 'socket-closed' }));
    await expect(j.match).rejects.toThrow(
      'The connection service is unreachable — check your internet and try again.',
    );
    expect(guestPeer.destroyed).toBe(true);
    expect(errSpy).toHaveBeenCalled(); // the raw message is preserved for debugging
    errSpy.mockRestore();
  });
});
