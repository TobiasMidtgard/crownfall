/**
 * The Dominion table —
 * #/play/dominion?set=<kingdom>&foe=<name>&seat=<open|practice>&first=<you|foe>
 *
 * The lobby ceremony lands here. It plays the SEEDED Forge def (keeper edits
 * in the Forge change this table), falling back to a fresh build when the
 * seed is missing or the stored copy can't host the chosen kingdom set.
 * Both seat modes ('practice' and 'open') play locally against the AI foe.
 * Sign-in is the one gate for play: like The Tables, signed-out visitors are
 * heralded and turned toward #/login.
 *
 * Mounts TableScreen directly (no SetupScreen). Seat order carries the
 * ceremony's Coin of Succession verdict — the engine starts at seat 0, so
 * whoever draws first sits there ('foe' seats the AI first; absent or
 * anything else, the player). On game over the match is chronicled exactly
 * once (TableScreen fires onGameOver once per mount; Play again remounts
 * with a fresh seed, keeping the set, foe and first player).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { herald } from './Heralds';
import { getUser, updateUser, useUser } from './state/auth';
import { recordMatch } from './state/chronicle';

export interface DominionPlayProps {
  params: URLSearchParams;
  navigate: (hash: string) => void;
}

// Once per load of this (lazy) chunk, before first render: the hall's table
// must exist even if the Forge was never opened this session.
ensureDominionSeed();

/** Seat order is turn order (the engine starts at seat 0): the ceremony's
 * Coin of Succession decides who draws first. The human is the !isAI seat. */
export function dominionSeats(youName: string, foeName: string, youFirst: boolean): SeatSetup[] {
  const you: SeatSetup = { name: youName, isAI: false };
  const rival: SeatSetup = { name: foeName, isAI: true };
  return youFirst ? [you, rival] : [rival, you];
}

export default function DominionPlay({ params, navigate }: DominionPlayProps) {
  const user = useUser();
  const kingdom = kingdomById(params.get('set'));
  const foe = params.get('foe')?.trim() || 'The Computer';
  const youFirst = params.get('first') !== 'foe';

  // The same gate as The Tables: play is for the signed-in only.
  const turnedAway = useRef(false); // herald once, even under StrictMode's double effect
  useEffect(() => {
    if (!user && !turnedAway.current) {
      turnedAway.current = true;
      herald('Sign in to reach the tables.');
      navigate('#/login');
    }
  }, [user, navigate]);

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

  // getUser() (not the reactive user) on purpose: the post-match ledger bump
  // changes the user object, and new seats would remount the table mid-verdict.
  const seats = useMemo<SeatSetup[]>(
    () => dominionSeats(getUser()?.name ?? 'You', foe, youFirst),
    [foe, youFirst],
  );

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
    // Seat order carries the coin verdict, so the human is found by kind.
    const me = state.players.find((p) => !p.isAI);
    const them = state.players.find((p) => p.isAI);
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
      // The chronicle counts rounds (the original table's turn numbering);
      // the engine's turnNumber ticks once per seat.
      turns: Math.ceil(state.turnNumber / state.players.length),
    });
    const user = getUser();
    if (user) {
      updateUser({
        games: user.games + 1,
        victories: user.victories + (outcome === 'victory' ? 1 : 0),
      });
    }
  }, [kingdom]);

  if (!user) return null;

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
        homeLabel="Back to the tables"
      />
    </div>
  );
}
