/**
 * Small touch-first form controls shared across the designer:
 * numeric stepper, color field, and a generic segmented control.
 */
import { useState } from 'react';

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/** Numeric stepper: −/+ buttons (44px) around a decimal text input. */
export function Stepper({
  label, value, onChange, step = 0.5, min = 0, max = 100,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  // While focused we keep the raw text so partial input like "1." survives.
  const [text, setText] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));

  return (
    <label className="field dz-stepper-field">
      <span>{label}</span>
      <div className="dz-stepper">
        <button
          type="button"
          className="btn dz-step-btn"
          aria-label={`Decrease ${label}`}
          onClick={() => onChange(clamp(value - step))}
        >
          −
        </button>
        <input
          className="input dz-step-input"
          inputMode="decimal"
          value={text ?? fmt(value)}
          onFocus={() => setText(fmt(value))}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
          onBlur={() => setText(null)}
        />
        <button
          type="button"
          className="btn dz-step-btn"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(clamp(value + step))}
        >
          +
        </button>
      </div>
    </label>
  );
}

/** Color picker + free-text value (keeps non-hex values editable). */
export function ColorField({ label, value, onChange }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const hex = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#888888';
  return (
    <label className="field">
      <span>{label}</span>
      <div className="dz-color-row">
        <input
          type="color"
          className="dz-color-swatch"
          value={hex}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} color picker`}
        />
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}

/** Generic segmented control (radio-style button group). */
export function Segmented<T extends string>({ options, value, onChange, label }: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div className="dz-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'active' : ''}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
