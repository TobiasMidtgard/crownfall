/**
 * Seeded RNG (mulberry32). Forkable so side-effect-free evaluation
 * (legality checks) can consume random numbers without desyncing the game.
 */

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [1, maxInclusive]. */
  int(maxInclusive: number): number;
  /** Independent copy seeded with the current internal state. */
  fork(): Rng;
}

function make(state: number): Rng {
  let a = state >>> 0;
  const rng: Rng = {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(maxInclusive: number) {
      return Math.floor(rng.next() * maxInclusive) + 1;
    },
    fork() {
      return make(a);
    },
  };
  return rng;
}

export function createRng(seed: number): Rng {
  return make(seed);
}

/** In-place Fisher-Yates shuffle using the given RNG. */
export function shuffleInPlace<T>(arr: T[], rng: Rng): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}
