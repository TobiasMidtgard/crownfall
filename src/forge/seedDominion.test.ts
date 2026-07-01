/**
 * Seeding contract. The vitest env is node (no window/localStorage), so
 * ensureDominionSeed must be a harmless no-op headlessly; the def-building
 * and version plumbing are what we can assert here.
 */
import { describe, expect, it } from 'vitest';
import { getGameById } from '../state/store';
import { DOMINION_GAME_ID, SEED_VERSION, ensureDominionSeed } from './seedDominion';
import { buildDominionDef } from './dominionGame';

describe('ensureDominionSeed (headless)', () => {
  it('no-ops without a window instead of throwing', () => {
    expect(typeof window).toBe('undefined');
    expect(() => ensureDominionSeed()).not.toThrow();
    expect(getGameById(DOMINION_GAME_ID)).toBeUndefined();
  });

  it('exports a live seed version and the stable game id', () => {
    expect(SEED_VERSION).toBeGreaterThanOrEqual(1);
    expect(DOMINION_GAME_ID).toBe('dominion-crownfall');
    expect(buildDominionDef().meta.id).toBe(DOMINION_GAME_ID);
  });
});
