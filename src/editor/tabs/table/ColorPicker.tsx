/**
 * ColorPicker — a self-contained HSV colour popover for the table designer:
 * a saturation/value field, a hue rail, an alpha rail, a hex/rgba input, a
 * curated heraldic palette, and per-device recent colours. No external deps
 * (the rails are CSS gradients; the thumbs are absolutely positioned). It emits
 * the tersest CSS on every change and pushes the final colour to recents when
 * it closes. Clearing (the ⌀ chip) emits '' so the caller can drop the value.
 */
import { useEffect, useRef, useState } from 'react';
import { cssToHsva, hsvToRgb, hsvaToCss, rgbaToHex, type HSVA } from './color';

/** Curated table palette: crimsons, golds, parchments, felts, inks. */
const PRESETS = [
  '#c8102e', '#8b1a2b', '#e0a83a', '#c9962a', '#f4ecd8', '#e8dcc0',
  '#1d3b2f', '#2e6f4e', '#1c3f5f', '#2f6f9f', '#3a2f5f', '#6a4fa0',
  '#111111', '#3a3a3a', '#7a7a7a', '#c8c8c8', '#ffffff', 'rgba(0,0,0,0.5)',
];

const RECENTS_KEY = 'cardsmith.recent-colors';
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function readRecents(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string').slice(0, 12) : [];
  } catch {
    return [];
  }
}
function pushRecent(css: string): void {
  try {
    const next = [css, ...readRecents().filter((c) => c !== css)].slice(0, 12);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // storage barred — recents just don't persist
  }
}

/** A rail/field the user scrubs: reports the pointer as 0-1 fractions. */
function useScrub(onMove: (fx: number, fy: number) => void) {
  const ref = useRef<HTMLDivElement>(null);
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const at = (cx: number, cy: number) =>
      onMove(clamp01((cx - rect.left) / rect.width), clamp01((cy - rect.top) / rect.height));
    at(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => at(ev.clientX, ev.clientY);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { ref, start };
}

export function ColorPicker({ value, onChange, onClose }: {
  value: string | undefined;
  onChange: (css: string) => void;
  onClose: () => void;
}) {
  const [hsva, setHsva] = useState<HSVA>(() => cssToHsva(value) ?? { h: 152, s: 0.5, v: 0.4, a: 1 });
  const [hexText, setHexText] = useState<string>(() => value ?? '');
  const latest = useRef(hsva);
  latest.current = hsva;

  // Commit the final colour to recents when the popover unmounts.
  useEffect(() => () => { pushRecent(hsvaToCss(latest.current)); }, []);

  const set = (patch: Partial<HSVA>) => {
    const next = { ...latest.current, ...patch };
    setHsva(next);
    const css = hsvaToCss(next);
    setHexText(css);
    onChange(css);
  };

  const sv = useScrub((fx, fy) => set({ s: fx, v: 1 - fy }));
  const hue = useScrub((fx) => set({ h: fx * 360 }));
  const alpha = useScrub((fx) => set({ a: fx }));

  const pick = (css: string) => {
    const parsed = cssToHsva(css);
    if (parsed) { setHsva(parsed); latest.current = parsed; }
    setHexText(css);
    onChange(css);
  };

  const { r, g, b } = hsvToRgb(hsva.h, hsva.s, hsva.v);
  const hueColor = `hsl(${hsva.h}, 100%, 50%)`;
  const solid = `rgb(${r}, ${g}, ${b})`;
  const recents = readRecents();

  return (
    <>
      <div className="tt-cp-backdrop" onPointerDown={onClose} />
      <div className="tt-cp" role="dialog" aria-label="Colour picker" onPointerDown={(e) => e.stopPropagation()}>
        <div
          className="tt-cp-sv"
          ref={sv.ref}
          onPointerDown={sv.start}
          style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), ${hueColor}` }}
        >
          <span className="tt-cp-sv-thumb" style={{ left: `${hsva.s * 100}%`, top: `${(1 - hsva.v) * 100}%`, background: solid }} />
        </div>

        <div className="tt-cp-rail tt-cp-hue" ref={hue.ref} onPointerDown={hue.start}>
          <span className="tt-cp-rail-thumb" style={{ left: `${(hsva.h / 360) * 100}%` }} />
        </div>

        <div className="tt-cp-rail tt-cp-alpha tt-cp-checker" ref={alpha.ref} onPointerDown={alpha.start}>
          <span className="tt-cp-alpha-fill" style={{ background: `linear-gradient(to right, transparent, ${solid})` }} />
          <span className="tt-cp-rail-thumb" style={{ left: `${hsva.a * 100}%` }} />
        </div>

        <div className="tt-cp-row">
          <span className="tt-cp-preview tt-cp-checker"><span style={{ background: hsvaToCss(hsva) }} /></span>
          <input
            className="input tt-cp-hex"
            aria-label="Hex or rgba"
            value={hexText}
            onChange={(e) => { setHexText(e.target.value); const p = cssToHsva(e.target.value); if (p) { setHsva(p); latest.current = p; onChange(e.target.value); } }}
            spellCheck={false}
          />
          <button type="button" className="tt-cp-clear" title="Clear colour" onClick={() => { onChange(''); onClose(); }}>⌀</button>
        </div>

        <div className="tt-cp-swatches">
          {PRESETS.map((c) => (
            <button key={c} type="button" className="tt-cp-swatch tt-cp-checker" title={c} aria-label={c} onClick={() => pick(c)}>
              <span style={{ background: c }} />
            </button>
          ))}
        </div>
        {recents.length > 0 && (
          <div className="tt-cp-swatches tt-cp-recents">
            {recents.map((c, i) => (
              <button key={`${c}-${i}`} type="button" className="tt-cp-swatch tt-cp-checker" title={c} aria-label={`recent ${c}`} onClick={() => pick(c)}>
                <span style={{ background: c }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/** Convenience for callers that want the current value as a #hex (opaque). */
export function displayHex(value: string | undefined): string | null {
  const hsva = cssToHsva(value);
  if (!hsva) return null;
  const { r, g, b } = hsvToRgb(hsva.h, hsva.s, hsva.v);
  return rgbaToHex({ r, g, b, a: hsva.a });
}
