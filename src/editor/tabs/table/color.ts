/**
 * color — pure color math for the table designer's rich colour picker. No
 * React, no DOM: parse a CSS colour string into RGBA, convert between RGB and
 * HSV, and format back to the tersest CSS (hex when opaque, rgba() otherwise).
 * Anything the parser can't read (named colours, var(), gradients) returns
 * null so the caller keeps the raw string in its free-text field untouched.
 */

/** r,g,b in 0-255; a in 0-1. */
export interface RGBA { r: number; g: number; b: number; a: number; }
/** h in 0-360; s,v,a in 0-1. */
export interface HSVA { h: number; s: number; v: number; a: number; }

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const to255 = (n: number) => clamp(Math.round(n), 0, 255);
const hex2 = (n: number) => to255(n).toString(16).padStart(2, '0');

/**
 * Parse a CSS colour into RGBA. Handles #rgb / #rgba / #rrggbb / #rrggbbaa and
 * rgb()/rgba() (comma or space separated, alpha as 0-1 or NN%). Returns null
 * for anything else (named colours, var(), gradients) — the caller then leaves
 * the value as authored.
 */
export function parseColor(css: string | undefined | null): RGBA | null {
  if (typeof css !== 'string') return null;
  const s = css.trim().toLowerCase();
  if (s === '') return null;
  if (s[0] === '#') {
    const h = s.slice(1);
    const expand = (str: string) => str.split('').map((c) => c + c).join('');
    let full: string | null = null;
    if (h.length === 3 || h.length === 4) full = expand(h);
    else if (h.length === 6 || h.length === 8) full = h;
    if (full === null || /[^0-9a-f]/.test(full)) return null;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    const a = full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const parts = m[1].split(/[,/\s]+/).filter((p) => p !== '');
    if (parts.length < 3) return null;
    const num = (p: string) => (p.endsWith('%') ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const r = num(parts[0]);
    const g = num(parts[1]);
    const b = num(parts[2]);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    let a = 1;
    if (parts[3] !== undefined) {
      a = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
      if (Number.isNaN(a)) a = 1;
    }
    return { r: to255(r), g: to255(g), b: to255(b), a: clamp(a, 0, 1) };
  }
  return null;
}

/** #rrggbb, or #rrggbbaa when alpha < 1. */
export function rgbaToHex(c: RGBA): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return c.a >= 1 ? base : base + hex2(c.a * 255);
}

/** The tersest CSS: #rrggbb when opaque, else rgba(r, g, b, a). */
export function rgbaToCss(c: RGBA): string {
  if (c.a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  const a = Math.round(c.a * 1000) / 1000;
  return `rgba(${to255(c.r)}, ${to255(c.g)}, ${to255(c.b)}, ${a})`;
}

export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s, v: max };
}

export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const c = v * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh >= 0 && hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return { r: to255((r + m) * 255), g: to255((g + m) * 255), b: to255((b + m) * 255) };
}

/** HSVA -> the tersest CSS string. */
export function hsvaToCss(c: HSVA): string {
  const { r, g, b } = hsvToRgb(c.h, c.s, c.v);
  return rgbaToCss({ r, g, b, a: c.a });
}

/** CSS string -> HSVA, or null when the string isn't a plain colour. */
export function cssToHsva(css: string | undefined | null): HSVA | null {
  const rgba = parseColor(css);
  if (rgba === null) return null;
  const { h, s, v } = rgbToHsv(rgba.r, rgba.g, rgba.b);
  return { h, s, v, a: rgba.a };
}
