/**
 * Store + storage persistence contract: truthful saveGame results, skipping
 * of redundant serialization/writes, the per-game key sweep on delete, and
 * Crownfall (not Cardsmith) branding in import errors. The test env is node:
 * localStorage is shimmed BEFORE the store module — which reads storage at
 * import time — is pulled in. These tests share module state and run in order.
 */
import { describe, expect, it } from 'vitest';
import { deepClone, newGameDef } from '../shared/defaults';

const mem = new Map<string, string>();
let failWrites = false;
let setItemCalls = 0;
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    setItemCalls += 1;
    if (failWrites) throw new Error('quota exceeded');
    mem.set(k, String(v));
  },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
} as Storage;

const store = await import('./store');
const storage = await import('../storage/storage');

const GAMES_KEY = 'cardsmith.games.v1';
const alpha = newGameDef('Alpha');
const beta = newGameDef('Beta');

describe('saveGame persistence contract', () => {
  it('persists and reports success', () => {
    expect(store.saveGame(alpha)).toBe(true);
    expect(mem.get(GAMES_KEY)).toContain(alpha.meta.id);
  });

  it('re-saving the identical object skips the write entirely', () => {
    const before = setItemCalls;
    expect(store.saveGame(alpha)).toBe(true);
    expect(setItemCalls).toBe(before);
  });

  it('a content-identical copy skips the storage write (byte compare)', () => {
    const before = setItemCalls;
    expect(store.saveGame(deepClone(alpha))).toBe(true);
    expect(setItemCalls).toBe(before);
  });

  it('returns false when the write throws, true again once storage frees up', () => {
    failWrites = true;
    expect(store.saveGame(beta)).toBe(false);
    failWrites = false;
    // Same reference, but the last persist failed — must retry, not skip.
    expect(store.saveGame(beta)).toBe(true);
    expect(mem.get(GAMES_KEY)).toContain(beta.meta.id);
  });
});

describe('deleteGame per-game key sweep', () => {
  it('removes the deleted game\'s sel/collapse keys and nothing else', () => {
    mem.set(`cardsmith.sel.${beta.meta.id}.supply`, 'b1');
    mem.set(`cardsmith.collapse.${beta.meta.id}.panel`, '1');
    mem.set(`cardsmith.sel.${alpha.meta.id}.supply`, 'b2');
    mem.set('cardsmith.components.v1', '[]');
    store.deleteGame(beta.meta.id);
    expect(store.getGameById(beta.meta.id)).toBeUndefined();
    expect(mem.has(`cardsmith.sel.${beta.meta.id}.supply`)).toBe(false);
    expect(mem.has(`cardsmith.collapse.${beta.meta.id}.panel`)).toBe(false);
    expect(mem.has(`cardsmith.sel.${alpha.meta.id}.supply`)).toBe(true);
    expect(mem.has('cardsmith.components.v1')).toBe(true);
  });
});

describe('import error branding', () => {
  it('speaks Crownfall on both failure paths', () => {
    expect(() => storage.parseImportedGame('{ nope')).toThrow('Not a valid Crownfall game file (not JSON).');
    expect(() => storage.parseImportedGame('{"schemaVersion":9}'))
      .toThrow('Not a valid Crownfall game file (missing or corrupted sections).');
  });
});
