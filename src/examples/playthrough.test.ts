/**
 * Full playthroughs of every example through the REAL engine: a seeded
 * random player takes legal moves until the game finishes. Each game is
 * played on several seeds and checked against game-specific invariants.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, Id } from '../shared/types';
import { playThrough, totalCards, STEP_CAP, type PlaythroughResult } from './testHarness';
import { warGame } from './war';
import { crazyEightsGame } from './crazyEights';
import { heartsGame } from './hearts';
import { clashGame } from './clash';
import { dominionGame } from './dominion';
import { mtgGame } from './mtg';
import { ygoGame } from './ygo';

/** The stack/window games can run long under random play — raise the cap. */
const BIG_CAP = 8000;

function expectCleanFinish(r: PlaythroughResult): void {
  expect(r.errors, 'the def should run without script errors').toEqual([]);
  expect(r.finished, `game should finish (took ${r.steps} steps, cap ${STEP_CAP})`).toBe(true);
  expect(r.state.result).not.toBeNull();
}

function playerVar(state: GameState, playerId: Id, varId: string): number {
  return Number(state.players.find((p) => p.id === playerId)!.vars[varId] ?? 0);
}

describe('War plays to completion', () => {
  it.each([1, 2, 3])('seed %i: a winner emerges and all 52 cards stay on the table', async (seed) => {
    const r = await playThrough(warGame, { seed });
    expectCleanFinish(r);
    expect(r.state.result!.winners.length).toBeGreaterThan(0);
    expect(totalCards(r.state)).toBe(52);
    // The quick variant ends the moment the current player's deck is empty.
    const current = r.state.players[r.state.currentPlayerIdx].id;
    expect(r.state.zones[`war_zone_deck:${current}`].cardIds).toHaveLength(0);
  });
});

describe('Crazy Eights plays to completion', () => {
  it.each([
    { seed: 11, players: 2 },
    { seed: 12, players: 3 },
    { seed: 13, players: 4 },
  ])('seed $seed, $players players: the winner shed their whole hand', async ({ seed, players }) => {
    const r = await playThrough(crazyEightsGame, { seed, playerCount: players });
    expectCleanFinish(r);
    const winners = r.state.result!.winners;
    expect(winners).toHaveLength(1);
    expect(r.state.zones[`c8_zone_hand:${winners[0]}`].cardIds).toHaveLength(0);
    expect(totalCards(r.state)).toBe(52);
  });
});

describe('Hearts plays to completion', () => {
  it.each([21, 22, 23])('seed %i: 26 points were dealt out and the lowest score wins', async (seed) => {
    const r = await playThrough(heartsGame, { seed });
    expectCleanFinish(r);
    const scores = r.state.players.map((p) => Number(p.vars['hearts_var_score'] ?? 0));
    // 13 hearts + 13 for the queen of spades.
    expect(scores.reduce((a, b) => a + b, 0)).toBe(26);
    const min = Math.min(...scores);
    const lowest = r.state.players.filter((_, i) => scores[i] === min).map((p) => p.id);
    expect([...r.state.result!.winners].sort()).toEqual([...lowest].sort());
    // Every card was played out into the Taken piles.
    const taken = r.state.players
      .map((p) => r.state.zones[`hearts_zone_taken:${p.id}`].cardIds.length)
      .reduce((a, b) => a + b, 0);
    expect(taken).toBe(52);
  });
});

describe('Clash plays to completion', () => {
  it.each([31, 32, 33])('seed %i: someone hit 0 life and the survivor won', async (seed) => {
    const r = await playThrough(clashGame, { seed });
    expectCleanFinish(r);
    const winners = r.state.result!.winners;
    expect(winners).toHaveLength(1);
    const loser = r.state.players.find((p) => p.id !== winners[0])!;
    expect(playerVar(r.state, loser.id, 'clash_var_life')).toBeLessThanOrEqual(0);
    expect(playerVar(r.state, winners[0], 'clash_var_life')).toBeGreaterThan(0);
  });
});

describe('Dominion plays to completion', () => {
  // Supply: 65 treasures + 36 victory + 9 kingdom piles of 10, plus each
  // player's 7 Coppers + 3 Estates — nothing ever leaves the table.
  const SUPPLY_TOTAL = 30 + 20 + 15 + 12 + 12 + 12 + 9 * 10;
  it.each([
    { seed: 41, players: 2 },
    { seed: 42, players: 3 },
    { seed: 43, players: 4 },
  ])('seed $seed, $players players: piles ran out and every card is accounted for', async ({ seed, players }) => {
    const r = await playThrough(dominionGame, { seed, playerCount: players, stepCap: BIG_CAP });
    expectCleanFinish(r);
    expect(r.state.result!.winners.length).toBeGreaterThan(0);
    expect(totalCards(r.state)).toBe(SUPPLY_TOTAL + 10 * players);
    // The game only ends when the Provinces ran dry or three piles emptied.
    const provinces = Object.values(r.state.zones)
      .filter((z) => z.zoneId === 'dom_zone_supply')
      .flatMap((z) => z.cardIds)
      .filter((id) => r.state.cards[id].name === 'Province').length;
    const emptyPiles = Number(r.state.globalVars['dom_var_empty_piles'] ?? 0);
    expect(provinces === 0 || emptyPiles >= 3).toBe(true);
  });
});

describe('Magic: The Gathering plays to completion', () => {
  it.each([51, 52, 53])('seed %i: a player was reduced to 0 life (combat or fatigue)', async (seed) => {
    const r = await playThrough(mtgGame, { seed, stepCap: BIG_CAP });
    expectCleanFinish(r);
    const winners = r.state.result!.winners;
    expect(winners).toHaveLength(1);
    const lives = r.state.players.map((p) => Number(p.vars['mtg_var_life'] ?? 0));
    expect(Math.min(...lives)).toBeLessThanOrEqual(0);
    expect(playerVar(r.state, winners[0], 'mtg_var_life')).toBeGreaterThan(0);
  });
});

describe('Yu-Gi-Oh plays to completion', () => {
  it.each([61, 62, 63])('seed %i: the duel ended by life points or deck-out', async (seed) => {
    const r = await playThrough(ygoGame, { seed, stepCap: BIG_CAP });
    expectCleanFinish(r);
    const winners = r.state.result!.winners;
    expect(winners).toHaveLength(1);
    const lps = r.state.players.map((p) => Number(p.vars['ygo_var_lp'] ?? 0));
    const deckedOut = r.state.players.some(
      (p) => r.state.zones[`ygo_zone_deck:${p.id}`].cardIds.length === 0,
    );
    expect(Math.min(...lps) <= 0 || deckedOut).toBe(true);
  });
});
