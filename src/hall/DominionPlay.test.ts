/**
 * Seat order carries the ceremony's Coin of Succession verdict: the engine
 * always starts at seat 0, so &first=foe must put the AI there. Importing the
 * component module headlessly is safe — its module-scope ensureDominionSeed()
 * no-ops without a window.
 */
import { describe, expect, it } from 'vitest';
import { dominionSeats } from './DominionPlay';

describe('dominionSeats', () => {
  it('seats the player first when the coin favors them', () => {
    const seats = dominionSeats('Tobit, Keeper of the Hall', 'The Computer', true);
    expect(seats.map((s) => s.isAI)).toEqual([false, true]);
    expect(seats[0].name).toBe('Tobit, Keeper of the Hall');
    expect(seats[1].name).toBe('The Computer');
  });

  it('seats the foe first when the coin turns away', () => {
    const seats = dominionSeats('Tobit, Keeper of the Hall', 'Lady Wrenfield the Unkind', false);
    expect(seats.map((s) => s.isAI)).toEqual([true, false]);
    expect(seats[0].name).toBe('Lady Wrenfield the Unkind');
    expect(seats[1].name).toBe('Tobit, Keeper of the Hall');
  });
});
