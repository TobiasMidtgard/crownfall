/**
 * Seeding contract. The vitest env is node (no window/localStorage), so
 * ensureDominionSeed must be a harmless no-op headlessly; the def-building
 * and version plumbing are what we can assert here. A minimal window stub
 * whose localStorage always throws then exercises the storage-barred paths:
 * the in-memory stamp (seed once, never overwrite in-session edits) and the
 * delete tombstone. These tests share module state and run in order.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteGame, getGameById, saveGame } from '../state/store';
import {
  DOMINION_GAME_ID, SEED_VERSION, ensureDominionSeed, markDominionSeedDeleted,
} from './seedDominion';
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

describe('ensureDominionSeed (storage-barred window)', () => {
  const barred = {
    getItem(): string | null { throw new Error('storage barred'); },
    setItem(): void { throw new Error('storage barred'); },
    removeItem(): void { throw new Error('storage barred'); },
  };

  beforeAll(() => {
    (globalThis as Record<string, unknown>).window = { localStorage: barred };
  });
  afterAll(() => {
    delete (globalThis as Record<string, unknown>).window;
    deleteGame(DOMINION_GAME_ID);
  });

  it('seeds into the in-memory store when the stamp cannot be read', () => {
    ensureDominionSeed();
    expect(getGameById(DOMINION_GAME_ID)).toBeDefined();
  });

  it('does not overwrite in-session edits on later calls (in-memory stamp)', () => {
    const edited = buildDominionDef();
    edited.meta = { ...edited.meta, name: 'Dominion, Reforged' };
    saveGame(edited);
    ensureDominionSeed(); // e.g. the second lazy chunk loading mid-session
    expect(getGameById(DOMINION_GAME_ID)?.meta.name).toBe('Dominion, Reforged');
  });

  it('respects an explicit delete: the tombstone blocks re-seeding', () => {
    markDominionSeedDeleted();
    deleteGame(DOMINION_GAME_ID);
    ensureDominionSeed();
    expect(getGameById(DOMINION_GAME_ID)).toBeUndefined();
  });
});
