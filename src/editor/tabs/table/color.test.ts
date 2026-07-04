/**
 * Tests for the colour-picker math: CSS parsing, RGB<->HSV round-trips, and
 * terse formatting (hex when opaque, rgba() when translucent).
 */
import { describe, expect, it } from 'vitest';
import {
  cssToHsva, hsvToRgb, hsvaToCss, parseColor, rgbToHsv, rgbaToCss, rgbaToHex,
} from './color';

describe('parseColor', () => {
  it('parses #rrggbb and #rgb', () => {
    expect(parseColor('#ff8800')).toEqual({ r: 255, g: 136, b: 0, a: 1 });
    expect(parseColor('#f80')).toEqual({ r: 255, g: 136, b: 0, a: 1 });
  });

  it('parses alpha hex (#rrggbbaa and #rgba)', () => {
    expect(parseColor('#ff000080')).toEqual({ r: 255, g: 0, b: 0, a: 128 / 255 });
    expect(parseColor('#f008')).toEqual({ r: 255, g: 0, b: 0, a: 136 / 255 });
  });

  it('parses rgb() and rgba() with comma or space separators', () => {
    expect(parseColor('rgb(10, 20, 30)')).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor('rgba(10 20 30 / 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('rgba(255,255,255,0.35)')).toEqual({ r: 255, g: 255, b: 255, a: 0.35 });
  });

  it('returns null for named colours, var(), gradients, and junk', () => {
    for (const s of ['transparent', 'white', 'var(--accent)', 'linear-gradient(#000,#fff)', '', undefined, null, '#12']) {
      expect(parseColor(s)).toBeNull();
    }
  });
});

describe('formatting', () => {
  it('rgbaToCss: hex when opaque, rgba() when translucent', () => {
    expect(rgbaToCss({ r: 255, g: 136, b: 0, a: 1 })).toBe('#ff8800');
    expect(rgbaToCss({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('rgbaToHex: appends alpha byte only when translucent', () => {
    expect(rgbaToHex({ r: 255, g: 136, b: 0, a: 1 })).toBe('#ff8800');
    expect(rgbaToHex({ r: 255, g: 0, b: 0, a: 0.5 })).toBe('#ff000080');
  });
});

describe('HSV round-trips', () => {
  it('rgb -> hsv -> rgb is stable across the wheel', () => {
    for (const [r, g, b] of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [136, 68, 204], [18, 52, 86], [0, 0, 0], [255, 255, 255]]) {
      const { h, s, v } = rgbToHsv(r, g, b);
      const back = hsvToRgb(h, s, v);
      expect(back).toEqual({ r, g, b });
    }
  });

  it('primary hues land on the wheel', () => {
    expect(rgbToHsv(255, 0, 0).h).toBe(0);
    expect(Math.round(rgbToHsv(0, 255, 0).h)).toBe(120);
    expect(Math.round(rgbToHsv(0, 0, 255).h)).toBe(240);
  });

  it('hsvaToCss carries alpha through', () => {
    expect(hsvaToCss({ h: 0, s: 1, v: 1, a: 1 })).toBe('#ff0000');
    expect(hsvaToCss({ h: 0, s: 1, v: 1, a: 0.5 })).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('never emits NaN channels (a NaN hue collapses to hue 0)', () => {
    expect(hsvToRgb(NaN, 1, 1)).toEqual({ r: 255, g: 0, b: 0 }); // hue 0 = red
    expect(hsvaToCss({ h: NaN, s: 1, v: 1, a: 1 })).toBe('#ff0000');
    expect(rgbaToCss({ r: NaN, g: 10, b: NaN, a: 1 })).toBe('#000a00'); // NaN channels -> 0
  });

  it('cssToHsva returns null for unparseable colours', () => {
    expect(cssToHsva('var(--accent)')).toBeNull();
    const hsva = cssToHsva('#ff0000');
    expect(hsva).not.toBeNull();
    expect(hsva!.h).toBe(0);
    expect(hsva!.s).toBe(1);
    expect(hsva!.v).toBe(1);
  });
});
