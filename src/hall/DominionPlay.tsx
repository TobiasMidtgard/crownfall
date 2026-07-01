/**
 * The Dominion table — #/play/dominion?set=<kingdom>&foe=<name>&seat=<open|practice>
 *
 * The lobby ceremony lands here. It plays the SEEDED Forge def (keeper edits
 * in the Forge change this table), falling back to a fresh build when the
 * seed is missing or the stored copy can't host the chosen kingdom set.
 * Both seat modes ('practice' and 'open') play locally against the AI foe.
 *
 * Mounts TableScreen directly (no SetupScreen): seat 0 is the signed-in
 * player, seat 1 the AI foe. On game over the match is chronicled exactly
 * once (TableScreen fires onGameOver once per mount; Play again remounts
 * with a fresh seed, keeping the set and foe).
 */
import { useCallback, useMemo, useState } from 'react';
import '../styles.css';
import '../forge/dominion-skin.css';
import type { GameState } from '../shared/types';
import { TableScreen } from '../runner/TableScreen';
import { rollSeed } from '../runner/layout';
import type { SeatSetup } from '../runner/session';
import { getGameById } from '../state/store';
import { kingdomById } from '../shared/kingdoms';
import { DOMINION_GAME_ID, ensureDominionSeed } from '../forge/seedDominion';
import { DOMINION_VP_VAR, buildDominionDef, pickKingdom } from '../forge/dominionGame';
import { getUser, updateUser } from './state/auth';
import { recordMatch } from './state/chronicle';

export interface DominionPlayProps {
  params: URLSearchParams;
  navigate: (hash: string) => void;
}

// Once per load of this (lazy) chunk, before first render: the hall's table
// must exist even if the Forge was never opened this session.
ensureDominionSeed();

export default function DominionPlay({ params, navigate }: DominionPlayProps) {
  const kingdom = kingdomById(params.get('set'));
  const foe = params.get('foe')?.trim() || 'The Computer';

  const def = useMemo(() => {
    const stored = getGameById(DOMINION_GAME_ID);
    try {
      return pickKingdom(stored ?? buildDominionDef(), kingdom.cards);
    } catch {
      // The keeper's edited copy no longer knows a card this set needs —
      // play the stock build rather than a broken table.
      return pickKingdom(buildDominionDef(), kingdom.cards);
    }
  }, [kingdom]);

  const seats = useMemo<SeatSetup[]>(() => [
    { name: getUser()?.name ?? 'You', isAI: false },
    { name: foe, isAI: true },
  ], [foe]);

  // Fresh seed per match; Play again remounts the table with a new one.
  const [round, setRound] = useState(() => ({ n: 1, seed: rollSeed() }));
  const playAgain = useCallback(() => setRound((r) => ({ n: r.n + 1, seed: rollSeed() })), []);

  // The runner navigates in Forge terms; remap into the hall's routes.
  const nav = useCallback((hash: string) => {
    if (hash === '#/' || hash === '#') {
      navigate('#/tables');
    } else if (hash.startsWith('#/edit/')) {
      navigate(`#/forge/edit/${hash.slice('#/edit/'.length)}`);
    } else {
      navigate(hash);
    }
  }, [navigate]);

  const onGameOver = useCallback(({ state }: { result: GameState['result']; state: GameState }) => {
    const me = state.players[0];
    const them = state.players[1];
    if (!me || !them) return;
    const winners = state.result?.winners ?? [];
    const outcome: 'victory' | 'defeat' | 'draw' =
      winners.length === 1 && winners[0] === me.id ? 'victory'
        : winners.length === 1 && winners[0] === them.id ? 'defeat'
          : 'draw';
    const vp = (p: typeof me) => Number(p.vars[DOMINION_VP_VAR] ?? 0);
    recordMatch({
      player: me.name,
      foe: them.name,
      kingdom: kingdom.name,
      outcome,
      score: [vp(me), vp(them)],
      turns: state.turnNumber,
    });
    const user = getUser();
    if (user) {
      updateUser({
        games: user.games + 1,
        victories: user.victories + (outcome === 'victory' ? 1 : 0),
      });
    }
  }, [kingdom]);

  return (
    <div className="forge-root dominion-skin">
      <TableScreen
        key={round.n}
        def={def}
        seats={seats}
        seed={round.seed}
        navigate={nav}
        onPlayAgain={playAgain}
        onBackToSetup={() => navigate('#/tables')}
        onGameOver={onGameOver}
      />
    </div>
  );
}
