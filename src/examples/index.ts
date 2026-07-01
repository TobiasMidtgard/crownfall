/**
 * Built-in example games. Each lives in its own file and returns a complete
 * GameDef with meta.builtIn = true and a stable meta.id ('example_*').
 */
import type { GameDef } from '../shared/types';
import { warGame } from './war';
import { crazyEightsGame } from './crazyEights';
import { heartsGame } from './hearts';
import { clashGame } from './clash';
import { dominionGame } from './dominion';
import { mtgGame } from './mtg';
import { ygoGame } from './ygo';

export const exampleGames: GameDef[] = [
  warGame, crazyEightsGame, heartsGame, clashGame, dominionGame, mtgGame, ygoGame,
];
