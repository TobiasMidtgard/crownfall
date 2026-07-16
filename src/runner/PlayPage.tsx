/**
 * PlayPage — game setup (player count/names/AI seats) then the live table:
 * auto-laid-out zones, hand, legal-action buttons, choice sheets, hotseat
 * pass-device curtain, AI turns, game-over screen.
 *
 * ONLINE PLAY: the setup screen can host or join a room (net.ts — WebRTC
 * lockstep, no server). The host's def + seed are authoritative: the guest
 * plays on the def it RECEIVES, so locally-edited games stay in sync. Each
 * device pins the table to its own seat (viewAs) — no hotseat curtain.
 * Fatal online faults (peer gone, states diverged) surface HERE as a
 * persistent overlay over the table — the session freezes moves, this page
 * offers the only exit (back to setup).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { validateGameDef } from '../shared/validate';
import { KINGDOM_SETS } from '../shared/kingdoms';
import { getGameById } from '../state/store';
import {
  activeKingdomCards, kingdomCatalog, pickKingdom, supportsKingdomPicking,
} from '../forge/dominionGame';
import { rollSeed } from './layout';
import { hostGame, joinGame, type MatchStart, type NetAdapter, type NetFault } from './net';
import { FatalScreen } from './overlays';
import type { SeatSetup } from './session';
import { SetupScreen, type OnlineStatus } from './SetupScreen';
import { TableScreen } from './TableScreen';
import './runner.css';

/** How many piles a kingdom takes (the preset sets are the source of truth). */
const KINGDOM_SIZE = 10;

export interface PlayPageProps {
  gameId: string;
  navigate: (hash: string) => void;
}

interface RunConfig {
  seats: SeatSetup[];
  seed: number;
  /** Bumped on "Play again" so the table remounts with a fresh engine. */
  runId: number;
}

interface OnlinePending {
  status: OnlineStatus;
  cancel: () => void;
}

export function PlayPage({ gameId, navigate }: PlayPageProps) {
  const def = getGameById(gameId);
  const issues = useMemo(() => (def ? validateGameDef(def) : []), [def]);
  const [run, setRun] = useState<RunConfig | null>(null);
  const [online, setOnline] = useState<OnlinePending | null>(null);
  const [netMatch, setNetMatch] = useState<MatchStart | null>(null);
  const [netFault, setNetFault] = useState<NetFault | null>(null);
  // After the verdict the link going quiet is expected — no fault alarm.
  const matchOverRef = useRef(false);

  // ----- the Kingdom picker (defs whose setup swaps supply piles) -----
  const kingdomable = useMemo(() => (def ? supportsKingdomPicking(def) : false), [def]);
  const [kingdomCards, setKingdomCards] = useState<string[] | null>(null); // null = def's own
  const pickerData = useMemo(() => {
    if (!def || !kingdomable) return null;
    return {
      catalog: kingdomCatalog(def),
      sets: KINGDOM_SETS,
      size: KINGDOM_SIZE,
      value: kingdomCards ?? activeKingdomCards(def),
    };
  }, [def, kingdomable, kingdomCards]);
  /** The def the TABLE runs: the stored def with the chosen kingdom applied. */
  const runDef = useMemo(() => {
    if (!def || !kingdomable || kingdomCards === null) return def;
    const active = activeKingdomCards(def);
    const same = active.length === kingdomCards.length
      && kingdomCards.every((n) => active.includes(n));
    try {
      return same ? def : pickKingdom(def, kingdomCards);
    } catch {
      return def; // an unknown name (keeper deleted a card) — fall back
    }
  }, [def, kingdomable, kingdomCards]);

  // Leaving an online table (or the page) hangs up the link.
  useEffect(() => () => {
    netMatch?.link.close();
  }, [netMatch]);

  // Generation stamp for online attempts: cancelling (or starting a local
  // game) bumps it, so a match resolving in that same instant is refused and
  // hung up instead of hijacking the table.
  const onlineGenRef = useRef(0);

  // A pending room can't be honored once this page is gone: tear it down so
  // a later joiner isn't greeted by a host who no longer exists.
  const onlineRef = useRef<OnlinePending | null>(null);
  onlineRef.current = online;
  useEffect(() => () => {
    onlineGenRef.current++;
    onlineRef.current?.cancel();
  }, []);

  // The table's transport, with a fault tap: the session reports disconnects
  // and desyncs here so THIS page can freeze the match under a persistent
  // overlay (TableScreen itself only knows the snapshot).
  const tableNet = useMemo<NetAdapter | null>(() => {
    if (!netMatch) return null;
    const link = netMatch.link;
    return {
      send: (m) => link.send(m),
      onMessage: (cb) => link.onMessage(cb),
      onClose: (cb) => link.onClose(cb),
      reportFault: (f) => {
        if (!matchOverRef.current) setNetFault(f);
      },
    };
  }, [netMatch]);

  // Online seats: this device's seat is local, every other seat plays over
  // the wire. Memoized: a re-render (e.g. the fault overlay appearing) must
  // NOT hand TableScreen a fresh array, or its session effect would restart
  // the whole game.
  const netSeats = useMemo<SeatSetup[] | null>(() => (
    netMatch
      ? netMatch.seatNames.map((name, i) => ({
        name,
        isAI: false,
        remote: i !== netMatch.localSeat,
      }))
      : null
  ), [netMatch]);

  if (!def) {
    return (
      <FatalScreen
        title="Game not found"
        message="This game doesn't exist on this device — it may have been deleted."
        onHome={() => navigate('#/')}
      />
    );
  }

  // Keep the handle's REAL cancel on the error screen so Back/Cancel tears
  // the peer down instead of leaking a broker socket per retry.
  const failOnline = (cancel: () => void) => (e: unknown) => {
    setOnline({
      status: { mode: 'error', message: e instanceof Error ? e.message : String(e) },
      cancel,
    });
  };

  /** Adopt a resolved match — unless the attempt was abandoned meanwhile. */
  const adoptMatch = (gen: number) => (m: MatchStart) => {
    if (onlineGenRef.current !== gen) {
      m.link.close();
      return;
    }
    matchOverRef.current = false;
    setNetFault(null);
    setOnline(null);
    setNetMatch(m);
  };

  const startHost = (hostName: string, seed: number) => {
    const gen = ++onlineGenRef.current;
    // The HOST's def is authoritative online — ship the chosen kingdom.
    const h = hostGame(runDef ?? def, seed, hostName);
    setOnline({ status: { mode: 'hosting', code: h.code }, cancel: h.cancel });
    h.match.then(adoptMatch(gen)).catch((e: unknown) => {
      if (onlineGenRef.current === gen) failOnline(h.cancel)(e);
    });
  };

  const startJoin = (code: string, guestName: string) => {
    const gen = ++onlineGenRef.current;
    const j = joinGame(code, guestName);
    setOnline({ status: { mode: 'joining' }, cancel: j.cancel });
    j.match.then(adoptMatch(gen)).catch((e: unknown) => {
      if (onlineGenRef.current === gen) failOnline(j.cancel)(e);
    });
  };

  if (netMatch && netSeats) {
    // Both clients run the HOST's def/seed; this device's seat is local,
    // every other seat plays over the wire.
    const leaveMatch = () => {
      // The [netMatch] effect above closes the old link on state change.
      setNetMatch(null);
      setNetFault(null);
      matchOverRef.current = false;
    };
    return (
      <>
        <TableScreen
          key="online"
          def={netMatch.def}
          seats={netSeats}
          seed={netMatch.seed}
          navigate={navigate}
          net={tableNet}
          viewAs={`p${netMatch.localSeat}`}
          onGameOver={() => { matchOverRef.current = true; }}
          onPlayAgain={leaveMatch}
          onBackToSetup={leaveMatch}
        />
        {netFault && <NetFaultOverlay fault={netFault} onBackToSetup={leaveMatch} />}
      </>
    );
  }

  if (!run) {
    return (
      <SetupScreen
        def={def}
        issues={issues}
        navigate={navigate}
        onStart={(seats, seed) => {
          // A local start abandons any open room — cancel it so a late
          // joiner can't hijack the in-progress table.
          onlineGenRef.current++;
          online?.cancel();
          setOnline(null);
          setRun({ seats, seed, runId: 1 });
        }}
        online={online?.status ?? null}
        onHost={startHost}
        onJoin={startJoin}
        onCancelOnline={() => {
          onlineGenRef.current++;
          online?.cancel();
          setOnline(null);
        }}
        kingdom={pickerData === null ? null : { ...pickerData, onChange: setKingdomCards }}
      />
    );
  }

  return (
    <TableScreen
      key={run.runId}
      def={runDef ?? def}
      seats={run.seats}
      seed={run.seed}
      navigate={navigate}
      onPlayAgain={() => setRun((r) => (r ? { seats: r.seats, seed: rollSeed(), runId: r.runId + 1 } : r))}
      onBackToSetup={() => setRun(null)}
    />
  );
}

/**
 * Fatal online fault surface: the peer vanished or the lockstep diverged.
 * Deliberately NOT dismissible — the session has already frozen the table
 * (no legal moves while netDown) and there is nothing to resume; the only
 * exit is back to setup. Rendered over TableScreen with a z-index above
 * every table layer (sheets 60, log 71, game-over 80).
 */
function NetFaultOverlay({ fault, onBackToSetup }: {
  fault: NetFault;
  onBackToSetup: () => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    btnRef.current?.focus();
  }, []);
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="rn-netfault-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(10, 10, 18, 0.72)',
      }}
      // One control — keep focus on it instead of tabbing the dead table.
      onKeyDown={(e) => {
        if (e.key === 'Tab') e.preventDefault();
      }}
    >
      <div className="panel" style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
        <h2 id="rn-netfault-title" style={{ margin: '0 0 8px' }}>
          {fault.kind === 'desync' ? 'Out of sync' : 'Connection lost'}
        </h2>
        <p className="muted" style={{ margin: '0 0 16px' }}>{fault.message}</p>
        <button ref={btnRef} className="btn btn-primary" onClick={onBackToSetup}>
          Back to setup
        </button>
      </div>
    </div>
  );
}
