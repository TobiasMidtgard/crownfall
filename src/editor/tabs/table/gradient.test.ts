/**
 * Tests for the fill editor's gradient helpers: build, paren-aware split, and
 * best-effort parse (including a round-trip with rgba() stops).
 */
import { describe, expect, it } from 'vitest';
import { defaultGradient, gradientToCss, parseGradient, splitTopLevel, type Gradient } from './gradient';

describe('splitTopLevel', () => {
  it('splits on top-level commas only, keeping (...) intact', () => {
    expect(splitTopLevel('180deg, rgba(0,0,0,0.5) 0%, #fff 100%')).toEqual([
      '180deg', 'rgba(0,0,0,0.5) 0%', '#fff 100%',
    ]);
  });
});

describe('gradientToCss', () => {
  it('builds a linear gradient with sorted stops', () => {
    const g: Gradient = { kind: 'linear', angle: 90, stops: [{ color: '#fff', pos: 100 }, { color: '#000', pos: 0 }] };
    expect(gradientToCss(g)).toBe('linear-gradient(90deg, #000 0%, #fff 100%)');
  });

  it('builds a radial gradient', () => {
    const g: Gradient = { kind: 'radial', angle: 0, stops: [{ color: '#a00', pos: 0 }, { color: '#000', pos: 100 }] };
    expect(gradientToCss(g)).toBe('radial-gradient(circle at center, #a00 0%, #000 100%)');
  });
});

describe('parseGradient', () => {
  it('parses a linear gradient with an angle', () => {
    const g = parseGradient('linear-gradient(45deg, #000 0%, #fff 100%)');
    expect(g).toEqual({ kind: 'linear', angle: 45, stops: [{ color: '#000', pos: 0 }, { color: '#fff', pos: 100 }] });
  });

  it('parses rgba() stops without splitting their commas', () => {
    const g = parseGradient('linear-gradient(180deg, rgba(0,0,0,0.5) 0%, #fff 100%)');
    expect(g!.stops[0]).toEqual({ color: 'rgba(0,0,0,0.5)', pos: 0 });
  });

  it('drops a shape keyword and keeps stops for radial', () => {
    const g = parseGradient('radial-gradient(circle at center, #a00 0%, #000 100%)');
    expect(g).toEqual({ kind: 'radial', angle: 0, stops: [{ color: '#a00', pos: 0 }, { color: '#000', pos: 100 }] });
  });

  it('round-trips build -> parse', () => {
    const g: Gradient = { kind: 'linear', angle: 120, stops: [{ color: '#c8102e', pos: 0 }, { color: '#111111', pos: 100 }] };
    expect(parseGradient(gradientToCss(g))).toEqual(g);
  });

  it('returns null for solids, non-gradients, and junk', () => {
    for (const s of ['#fff', 'red', 'var(--x)', undefined, null, 'linear-gradient(#000)']) {
      expect(parseGradient(s)).toBeNull();
    }
  });
});

describe('defaultGradient', () => {
  it('seeds the first stop from a solid base', () => {
    expect(defaultGradient('#00ff00').stops[0].color).toBe('#00ff00');
  });
  it('ignores a gradient base and falls back', () => {
    expect(defaultGradient('linear-gradient(#000,#fff)').stops[0].color).toBe('#c8102e');
  });
});
