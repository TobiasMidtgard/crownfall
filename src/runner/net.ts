/**
 * net — online multiplayer transport (WebRTC data channels via PeerJS's
 * free cloud broker; no game server anywhere).
 *
 * ARCHITECTURE: deterministic lockstep. The engine is fully seeded (no
 * Math.random inside src/engine) and serialized, so a run is completely
 * determined by (def, seat order, seed, the stream of moves, the stream of
 * choice answers) — proven by determinism.test.ts. Both clients therefore
 * run their OWN engine from the same (def, seats, seed) and simply relay
 * every locally-decided move / choice answer; the states never diverge.
 * AI seats run on the HOST only (session AI uses unseeded randomness) and
 * their decisions are relayed like any other.
 *
 * HANDSHAKE: the host opens a Peer under `crownfall-<CODE>` and waits; the
 * guest connects and sends {t:'join', name}; the host answers {t:'hello'}
 * carrying the WHOLE GameDef (so locally-edited defs stay in sync), the
 * seed, the seat names and the guest's seat index. Both sides then mount
 * the table and exchange only {t:'move'} / {t:'answer'} frames.
 */
import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { ChoiceAnswer, GameDef, Id, Move } from '../shared/types';

/** In-game frames (relayed decisions). */
export type NetMsg =
  | { t: 'move'; seat: Id; move: Move }
  | { t: 'answer'; id: number; answer: ChoiceAnswer };

/** Handshake frames. */
type WireMsg =
  | NetMsg
  | { t: 'join'; name: string }
  | { t: 'hello'; def: GameDef; seed: number; seatNames: string[]; guestSeat: number };

/** What GameSession needs from a connection (also easy to fake in tests). */
export interface NetAdapter {
  send(msg: NetMsg): void;
  onMessage(cb: (msg: NetMsg) => void): void;
  onClose(cb: () => void): void;
}

export interface NetLink extends NetAdapter {
  close(): void;
}

export interface MatchStart {
  def: GameDef;
  seed: number;
  seatNames: string[];
  /** The LOCAL player's seat index on this client. */
  localSeat: number;
  link: NetLink;
}

/** Unambiguous room-code alphabet (no 0/O/1/I). */
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function rollRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

const peerId = (code: string) => `crownfall-${code.toUpperCase()}`;

function wrap(conn: DataConnection, peer: Peer): NetLink {
  let onMsg: ((msg: NetMsg) => void) | null = null;
  let onGone: (() => void) | null = null;
  conn.on('data', (raw) => {
    const msg = raw as WireMsg;
    if ((msg.t === 'move' || msg.t === 'answer') && onMsg) onMsg(msg);
  });
  const gone = () => { if (onGone) onGone(); };
  conn.on('close', gone);
  conn.on('error', gone);
  peer.on('disconnected', () => peer.reconnect());
  return {
    send: (msg) => conn.send(msg),
    onMessage: (cb) => { onMsg = cb; },
    onClose: (cb) => { onGone = cb; },
    close: () => {
      conn.close();
      peer.destroy();
    },
  };
}

export interface HostHandle {
  code: string;
  /** Resolves when a guest completes the handshake. Rejects on cancel/error. */
  match: Promise<MatchStart>;
  cancel(): void;
}

/**
 * Open a room and wait for one guest. `def`/`seed`/`hostName` become the
 * authoritative match parameters shipped in the hello.
 */
export function hostGame(def: GameDef, seed: number, hostName: string): HostHandle {
  const code = rollRoomCode();
  const peer = new Peer(peerId(code));
  let cancelled = false;
  const match = new Promise<MatchStart>((resolve, reject) => {
    peer.on('error', (e) => reject(new Error(`Connection service: ${e.message}`)));
    peer.on('connection', (conn) => {
      conn.on('data', (raw) => {
        const msg = raw as WireMsg;
        if (msg.t !== 'join' || cancelled) return;
        const seatNames = [hostName, msg.name || 'Challenger'];
        conn.send({ t: 'hello', def, seed, seatNames, guestSeat: 1 } satisfies WireMsg);
        resolve({ def, seed, seatNames, localSeat: 0, link: wrap(conn, peer) });
      });
    });
  });
  return {
    code,
    match,
    cancel: () => {
      cancelled = true;
      peer.destroy();
    },
  };
}

/** Join a hosted room by code; resolves once the hello arrives. */
export function joinGame(code: string, guestName: string): { match: Promise<MatchStart>; cancel(): void } {
  const peer = new Peer();
  let cancelled = false;
  const match = new Promise<MatchStart>((resolve, reject) => {
    peer.on('error', (e) => reject(new Error(
      e.type === 'peer-unavailable' ? 'No open table with that code.' : `Connection service: ${e.message}`,
    )));
    peer.on('open', () => {
      // Default (binary) serialization: unlike 'json' it CHUNKS big payloads,
      // and the hello ships the whole GameDef (easily > the SCTP frame cap).
      const conn = peer.connect(peerId(code), { reliable: true });
      conn.on('open', () => conn.send({ t: 'join', name: guestName } satisfies WireMsg));
      conn.on('data', (raw) => {
        const msg = raw as WireMsg;
        if (msg.t !== 'hello' || cancelled) return;
        resolve({
          def: msg.def,
          seed: msg.seed,
          seatNames: msg.seatNames,
          localSeat: msg.guestSeat,
          link: wrap(conn, peer),
        });
      });
      conn.on('error', () => reject(new Error('Could not reach the host.')));
    });
  });
  return { match, cancel: () => { cancelled = true; peer.destroy(); } };
}
