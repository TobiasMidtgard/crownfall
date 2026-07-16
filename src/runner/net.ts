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
 * the table and exchange only {t:'move'} / {t:'answer'} frames. A room is
 * single-use: once matched (or cancelled) every later {t:'join'} gets a
 * {t:'full'} refusal and the connection is hung up.
 */
import Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import type { ChoiceAnswer, GameDef, Id, Move } from '../shared/types';

/**
 * In-game frames (relayed decisions). `h` is the lockstep guard: the sender's
 * state fingerprint at the frame's checkpoint (see session.ts). Optional so
 * frames from older builds are tolerated rather than flagged as desync.
 */
export type NetMsg =
  | { t: 'move'; seat: Id; move: Move; h?: number }
  | { t: 'answer'; id: number; answer: ChoiceAnswer; h?: number };

/** Handshake frames. `full`: the room already has its guest — go away nicely. */
type WireMsg =
  | NetMsg
  | { t: 'join'; name: string }
  | { t: 'hello'; def: GameDef; seed: number; seatNames: string[]; guestSeat: number }
  | { t: 'full' };

/** A fatal online fault the session detects and freezes on. */
export interface NetFault {
  kind: 'disconnect' | 'desync';
  message: string;
}

/** What GameSession needs from a connection (also easy to fake in tests). */
export interface NetAdapter {
  send(msg: NetMsg): void;
  onMessage(cb: (msg: NetMsg) => void): void;
  onClose(cb: () => void): void;
  /** Optional: the session reports a fatal lockstep fault it detected (peer
   *  gone, failed send, state divergence) for the host UI to surface. */
  reportFault?(fault: NetFault): void;
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

/** Room-full refusal: give the frame this long to flush before hanging up. */
const REFUSE_CLOSE_MS = 300;

export function rollRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

const peerId = (code: string) => `crownfall-${code.toUpperCase()}`;

/**
 * PeerJS error types -> plain human copy. The raw broker message stays in
 * the console for debugging; the player never sees transport jargon.
 */
function friendlyPeerError(e: { type?: string; message?: string }): Error {
  console.error('[net] peer error:', e.type, e.message);
  switch (e.type) {
    case 'peer-unavailable':
      return new Error('No open table with that code.');
    case 'network':
    case 'socket-error':
    case 'socket-closed':
    case 'server-error':
      return new Error('The connection service is unreachable — check your internet and try again.');
    case 'unavailable-id':
      return new Error('That room code is already in use — try hosting again.');
    case 'browser-incompatible':
      return new Error("This browser can't make peer-to-peer connections — try a recent Chrome, Firefox or Safari.");
    default:
      return new Error('The connection failed — please try again.');
  }
}

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
  /** Resolves when a guest completes the handshake. Rejects on error; stays
   *  pending forever after cancel() (the caller has moved on). */
  match: Promise<MatchStart>;
  /** Close the room: destroys the peer so the code stops resolving, and any
   *  join already in flight is refused instead of matched. */
  cancel(): void;
}

/**
 * Open a room and wait for ONE guest. `def`/`seed`/`hostName` become the
 * authoritative match parameters shipped in the hello. Later joiners (the
 * code shared in a group chat outlives the match) are refused with
 * {t:'full'} and hung up — never a second hello into a ghost game.
 */
export function hostGame(def: GameDef, seed: number, hostName: string): HostHandle {
  const code = rollRoomCode();
  const peer = new Peer(peerId(code));
  let cancelled = false;
  let matched = false;
  const match = new Promise<MatchStart>((resolve, reject) => {
    peer.on('error', (e) => {
      // Post-match (or post-cancel) errors belong to the live link / nobody;
      // destroying here would tear down a game in progress.
      if (cancelled || matched) return;
      peer.destroy();
      reject(friendlyPeerError(e));
    });
    peer.on('connection', (conn) => {
      conn.on('data', (raw) => {
        const msg = raw as WireMsg;
        if (msg.t !== 'join') return;
        if (cancelled || matched) {
          // The room is spoken for: refuse politely, then hang up (the
          // delay lets the refusal flush before the channel dies).
          try {
            conn.send({ t: 'full' } satisfies WireMsg);
          } catch { /* channel already dead — the close alone must do */ }
          setTimeout(() => conn.close(), REFUSE_CLOSE_MS);
          return;
        }
        matched = true;
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
  let settled = false;
  const match = new Promise<MatchStart>((resolve, reject) => {
    const fail = (err: Error) => {
      if (cancelled || settled) return;
      settled = true;
      // PeerJS keeps the peer alive on non-fatal errors (peer-unavailable):
      // destroy explicitly so retries don't stack broker sockets.
      peer.destroy();
      reject(err);
    };
    peer.on('error', (e) => fail(friendlyPeerError(e)));
    peer.on('open', () => {
      // Default (binary) serialization: unlike 'json' it CHUNKS big payloads,
      // and the hello ships the whole GameDef (easily > the SCTP frame cap).
      const conn = peer.connect(peerId(code), { reliable: true });
      conn.on('open', () => conn.send({ t: 'join', name: guestName } satisfies WireMsg));
      conn.on('data', (raw) => {
        const msg = raw as WireMsg;
        if (cancelled || settled) return;
        if (msg.t === 'full') {
          fail(new Error('That table is already in play.'));
          return;
        }
        if (msg.t !== 'hello') return;
        settled = true;
        resolve({
          def: msg.def,
          seed: msg.seed,
          seatNames: msg.seatNames,
          localSeat: msg.guestSeat,
          link: wrap(conn, peer),
        });
      });
      // A close before the hello is the host hanging up (room refused/gone).
      conn.on('close', () => fail(new Error('The host closed the room.')));
      conn.on('error', () => fail(new Error('Could not reach the host.')));
    });
  });
  return { match, cancel: () => { cancelled = true; peer.destroy(); } };
}
