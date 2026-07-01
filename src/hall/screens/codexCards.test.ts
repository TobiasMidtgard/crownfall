import { describe, expect, it } from 'vitest';
import { CARDS, COST_BANDS, TYPE_NAMES, TYPE_PRIORITY, accentType } from './codexCards';

describe('codex cards', () => {
  it('records the base set and promos in full: 25 cards, unique names', () => {
    expect(CARDS).toHaveLength(25);
    expect(new Set(CARDS.map((c) => c.name)).size).toBe(25);
  });

  it('every card has known types, a non-negative cost, and face text', () => {
    for (const card of CARDS) {
      expect(card.types.length).toBeGreaterThan(0);
      for (const t of card.types) expect(TYPE_NAMES[t]).toBeTruthy();
      expect(card.cost).toBeGreaterThanOrEqual(0);
      expect(card.text.length).toBeGreaterThan(0);
    }
  });

  it('cost bands are disjoint and exhaustive over every card cost', () => {
    for (const card of CARDS) {
      const bands = (Object.keys(COST_BANDS) as Array<keyof typeof COST_BANDS>)
        .filter((b) => COST_BANDS[b](card.cost));
      expect(bands).toHaveLength(1);
    }
  });

  it('accent follows type priority: loudest type wins the rarity color', () => {
    expect(TYPE_PRIORITY).toHaveLength(6);
    expect(accentType(CARDS.find((c) => c.name === 'Moat')!)).toBe('reaction');
    expect(accentType(CARDS.find((c) => c.name === 'Witch')!)).toBe('attack');
    expect(accentType(CARDS.find((c) => c.name === 'Curse')!)).toBe('curse');
    expect(accentType(CARDS.find((c) => c.name === 'Market')!)).toBe('action');
  });

  it('type and cost filters AND-combine (actions costing 5+)', () => {
    const matches = CARDS.filter((c) => c.types.includes('action') && COST_BANDS['c5+'](c.cost));
    expect(matches.map((c) => c.name)).toEqual(
      ['Market', 'Mine', 'Witch', 'Laboratory', 'Festival', 'Council Room'],
    );
  });

  it('exactly two promos: Black Market and Envoy', () => {
    expect(CARDS.filter((c) => c.promo).map((c) => c.name).sort()).toEqual(['Black Market', 'Envoy']);
  });
});
