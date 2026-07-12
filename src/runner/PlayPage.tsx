/**
 * PlayPage — game setup (player count/names/AI seats) then the live table:
 * auto-laid-out zones, hand, legal-action buttons, choice sheets, hotseat
 * pass-device curtain, AI turns, game-over screen.
 *
 * ONLINE PLAY: the setup screen can host or join a room (net.ts — WebRTC
 * lockstep, no server). The host's def + seed are authoritative: the guest
 * plays on the def it RECEIVES, so locally-edited games stay in sync. Each
 * device pins the table to its own seat (viewAs) — no hotseat curtain.
 */
import { useEffect, useMemo, useState } from 'react';
import { validateGameDef } from '../shared/validate';
import { KINGDOM_SETS } from '../shared/kingdoms';
import { getGameById } from '../state/store';
import {
  activeKingdomCards, kingdomCatalog, pickKingdom, supportsKingdomPicking,
} from '../forge/dominionGame';
import { rollSeed } from './layout';
import { hostGame, joinGame, type MatchStart } from './net';
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

  if (!def) {
    return (
      <FatalScreen
        title="Game not found"
        message="This game doesn't exist on this device — it may have been deleted."
        onHome={() => navigate('#/')}
      />
    );
  }

  const failOnline = (e: unknown) => {
    setOnline({
      status: { mode: 'error', message: e instanceof Error ? e.message : String(e) },
      cancel: () => undefined,
    });
  };

  const startHost = (hostName: string, seed: number) => {
    // The HOST's def is authoritative online — ship the chosen kingdom.
    const h = hostGame(runDef ?? def, seed, hostName);
    setOnline({ status: { mode: 'hosting', code: h.code }, cancel: h.cancel });
    h.match.then((m) => {
      setOnline(null);
      setNetMatch(m);
    }).catch(failOnline);
  };

  const startJoin = (code: string, guestName: string) => {
    const j = joinGame(code, guestName);
    setOnline({ status: { mode: 'joining' }, cancel: j.cancel });
    j.match.then((m) => {
      setOnline(null);
      setNetMatch(m);
    }).catch(failOnline);
  };

  if (netMatch) {
    // Both clients run the HOST's def/seed; this device's seat is local,
    // every other seat plays over the wire.
    const seats: SeatSetup[] = netMatch.seatNames.map((name, i) => ({
      name,
      isAI: false,
      remote: i !== netMatch.localSeat,
    }));
    return (
      <TableScreen
        key="online"
        def={netMatch.def}
        seats={seats}
        seed={netMatch.seed}
        navigate={navigate}
        net={netMatch.link}
        viewAs={`p${netMatch.localSeat}`}
        onPlayAgain={() => setNetMatch(null)}
        onBackToSetup={() => setNetMatch(null)}
      />
    );
  }

  if (!run) {
    return (
      <SetupScreen
        def={def}
        issues={issues}
        navigate={navigate}
        onStart={(seats, seed) => setRun({ seats, seed, runId: 1 })}
        online={online?.status ?? null}
        onHost={startHost}
        onJoin={startJoin}
        onCancelOnline={() => {
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
