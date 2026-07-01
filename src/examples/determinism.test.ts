/**
 * Determinism: the same game seed + the same choice/move seed must reproduce
 * the exact same final state, byte for byte. (mulberry32 RNG + a fixed
 * answer stream fully determine a run.)
 */
import { describe, expect, it } from 'vitest';
import { playThrough } from './testHarness';
import { warGame } from './war';
import { clashGame } from './clash';

describe('seeded runs are reproducible', () => {
  it.each([
    ['War', warGame],
    ['Clash', clashGame],
  ] as const)('%s: identical seeds give identical final states', async (_name, def) => {
    const a = await playThrough(def, { seed: 99, choiceSeed: 7 });
    const b = await playThrough(def, { seed: 99, choiceSeed: 7 });
    expect(a.finished).toBe(true);
    expect(b.steps).toBe(a.steps);
    expect(JSON.stringify(b.state)).toBe(JSON.stringify(a.state));
  });

  it('different seeds actually diverge (sanity check)', async () => {
    const a = await playThrough(warGame, { seed: 99, choiceSeed: 7 });
    const b = await playThrough(warGame, { seed: 100, choiceSeed: 7 });
    expect(JSON.stringify(b.state.zones)).not.toBe(JSON.stringify(a.state.zones));
  });
});
