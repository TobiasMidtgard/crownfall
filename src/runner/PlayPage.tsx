/**
 * PlayPage — game setup (player count/names/AI seats) then the live table:
 * auto-laid-out zones, hand, legal-action buttons, choice sheets, hotseat
 * pass-device curtain, AI turns, game-over screen.
 */
import { useMemo, useState } from 'react';
import { validateGameDef } from '../shared/validate';
import { getGameById } from '../state/store';
import { rollSeed } from './layout';
import { FatalScreen } from './overlays';
import type { SeatSetup } from './session';
import { SetupScreen } from './SetupScreen';
import { TableScreen } from './TableScreen';
import './runner.css';

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

export function PlayPage({ gameId, navigate }: PlayPageProps) {
  const def = getGameById(gameId);
  const issues = useMemo(() => (def ? validateGameDef(def) : []), [def]);
  const [run, setRun] = useState<RunConfig | null>(null);

  if (!def) {
    return (
      <FatalScreen
        title="Game not found"
        message="This game doesn't exist on this device — it may have been deleted."
        onHome={() => navigate('#/')}
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
      />
    );
  }

  return (
    <TableScreen
      key={run.runId}
      def={def}
      seats={run.seats}
      seed={run.seed}
      navigate={navigate}
      onPlayAgain={() => setRun((r) => (r ? { seats: r.seats, seed: rollSeed(), runId: r.runId + 1 } : r))}
      onBackToSetup={() => setRun(null)}
    />
  );
}
