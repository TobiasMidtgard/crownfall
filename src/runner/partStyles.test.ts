/**
 * Pure tests for zonePartCss — the resolver that turns one authored
 * ZonePartStyle (zone element partStyles) into inline CSS + a hide flag for
 * the runner's zone chrome parts.
 */
import { describe, expect, it } from 'vitest';
import { zonePartCss } from './partStyles';

/** Fake %-of-screen-width -> px conversion (10px per %). */
const fontPx = (pct: number) => pct * 10;

describe('zonePartCss', () => {
  it('passes undefined through (unstyled parts keep stock chrome)', () => {
    expect(zonePartCss(undefined, fontPx)).toBeUndefined();
  });

  it('resolves an empty part to empty CSS, not hidden', () => {
    expect(zonePartCss({}, fontPx)).toEqual({ css: {}, hidden: false });
  });

  it('merges box chrome from style via layoutStyleCss', () => {
    expect(zonePartCss({ style: { background: 'red', borderRadius: 12 } }, fontPx)).toEqual({
      css: { background: 'red', borderRadius: '12px' },
      hidden: false,
    });
  });

  it('layers text knobs over the box chrome', () => {
    const out = zonePartCss(
      { style: { background: 'navy' }, color: '#fff', fontSize: 2, bold: true },
      fontPx,
    );
    expect(out?.css).toEqual({
      background: 'navy',
      color: '#fff',
      fontSize: 20,
      fontWeight: 700,
    });
  });

  it('converts fontSize through the caller-supplied fontPx only when set', () => {
    expect(zonePartCss({ fontSize: 1.5 }, fontPx)?.css.fontSize).toBe(15);
    expect(zonePartCss({ color: '#abc' }, fontPx)?.css.fontSize).toBeUndefined();
  });

  it('emits fontWeight only when bold is authored (true -> 700, false -> 400)', () => {
    expect(zonePartCss({ bold: true }, fontPx)?.css.fontWeight).toBe(700);
    expect(zonePartCss({ bold: false }, fontPx)?.css.fontWeight).toBe(400);
    expect(zonePartCss({ color: '#abc' }, fontPx)?.css.fontWeight).toBeUndefined();
  });

  it('carries the hidden flag (absent -> false)', () => {
    expect(zonePartCss({ hidden: true }, fontPx)?.hidden).toBe(true);
    expect(zonePartCss({ hidden: false }, fontPx)?.hidden).toBe(false);
    expect(zonePartCss({ color: '#abc' }, fontPx)?.hidden).toBe(false);
  });
});
