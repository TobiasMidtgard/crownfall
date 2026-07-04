/**
 * gradient — pure helpers for the fill editor: build a CSS gradient string from
 * structured stops, and best-effort parse one back (so re-opening an element
 * restores its stops). Anything we can't read returns null and the editor
 * starts from a sensible default. Comma-splitting is paren-aware so rgba()/hsl()
 * stops survive intact.
 */

export interface GradientStop {
  /** CSS colour. */
  color: string;
  /** Position along the gradient, 0-100. */
  pos: number;
}

export interface Gradient {
  kind: 'linear' | 'radial';
  /** Linear angle in degrees (ignored for radial). */
  angle: number;
  stops: GradientStop[];
}

/** Split on top-level commas only (commas inside (…) stay put). */
export function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  if (cur.trim() !== '') out.push(cur.trim());
  return out;
}

/** Structured gradient -> CSS. Stops are sorted by position. */
export function gradientToCss(g: Gradient): string {
  const stops = g.stops
    .slice()
    .sort((a, b) => a.pos - b.pos)
    .map((s) => `${s.color} ${Math.round(s.pos)}%`)
    .join(', ');
  return g.kind === 'radial'
    ? `radial-gradient(circle at center, ${stops})`
    : `linear-gradient(${Math.round(g.angle)}deg, ${stops})`;
}

/** One "colour pos%" token -> a stop (pos optional; default supplied by caller). */
function parseStop(token: string, fallbackPos: number): GradientStop | null {
  const m = token.match(/^(.*?)\s+(-?\d+(?:\.\d+)?)%$/);
  if (m) return { color: m[1].trim(), pos: Number(m[2]) };
  if (token === '') return null;
  return { color: token, pos: fallbackPos };
}

/** Best-effort parse of a CSS gradient. null when the string isn't one. */
export function parseGradient(css: string | undefined | null): Gradient | null {
  if (typeof css !== 'string') return null;
  const s = css.trim();
  const m = s.match(/^(linear|radial)-gradient\((.*)\)$/s);
  if (!m) return null;
  const kind = m[1] as 'linear' | 'radial';
  const parts = splitTopLevel(m[2]);
  if (parts.length < 2) return null;
  let angle = kind === 'linear' ? 180 : 0;
  let stopParts = parts;
  const first = parts[0];
  const angleMatch = first.match(/^(-?\d+(?:\.\d+)?)deg$/);
  if (angleMatch) {
    angle = Number(angleMatch[1]);
    stopParts = parts.slice(1);
  } else if (/^(to\s|circle|ellipse|at\s|closest|farthest)/.test(first)) {
    // a shape/direction keyword we don't model — drop it, keep the stops.
    stopParts = parts.slice(1);
  }
  const stops: GradientStop[] = [];
  stopParts.forEach((p, i) => {
    const pos = stopParts.length === 1 ? 0 : (i / (stopParts.length - 1)) * 100;
    const stop = parseStop(p, pos);
    if (stop) stops.push(stop);
  });
  if (stops.length < 2) return null;
  return { kind, angle, stops };
}

/** A default 2-stop gradient seeded from a base colour (or a neutral ramp). */
export function defaultGradient(base: string | undefined): Gradient {
  const from = base && !base.includes('gradient') ? base : '#c8102e';
  return { kind: 'linear', angle: 180, stops: [{ color: from, pos: 0 }, { color: '#111111', pos: 100 }] };
}
