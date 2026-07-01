/**
 * The keeper's mason tools — the frame around edit mode (editor.js port).
 * MasonBar: fixed bottom toolbar with the five banner seals, the armed-twice
 * "Reset all changes", and Done. MasonSectionPlate: the per-section control
 * plate (name, move up/down, hide) Landing renders in edit mode. In-place
 * text editing itself lives in state/copy.tsx (<Edit>) — not here.
 */
import { useEffect, useRef, useState } from 'react';
import { herald } from '../Heralds';
import { useUser } from '../state/auth';
import { resetCopy, setEditMode, useEditMode } from '../state/copy';
import { setTheme, useTheme, type HallTheme } from '../state/theme';
import {
  resetSectionLayout,
  setSectionLayout,
  useSectionLayout,
  type SectionId,
} from '../state/layout';

/* ── the banner seals (shared with the settings panel) ── */

const THEME_LABELS: Record<HallTheme, string> = {
  crimson: 'Crimson',
  aurum: 'Aurum',
  verdant: 'Verdant',
  azure: 'Azure',
  umbral: 'Umbral',
};
const THEME_IDS = Object.keys(THEME_LABELS) as HallTheme[];

export function ThemeSeals({ groupLabel }: { groupLabel: string }) {
  const theme = useTheme();
  return (
    <div className="mason-themes" role="group" aria-label={groupLabel}>
      {THEME_IDS.map((t) => (
        <button
          key={t}
          type="button"
          data-theme-pick={t}
          aria-pressed={theme === t}
          aria-label={`${THEME_LABELS[t]} theme`}
          onClick={() => {
            setTheme(t);
            herald(`${THEME_LABELS[t]} theme applied. The hall is rehung.`);
          }}
        >
          <span className="swatch" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/* ── the bar ── */

const ARM_WINDOW_MS = 4000;

export function MasonBar() {
  const editing = useEditMode();
  const user = useUser();
  const [armed, setArmed] = useState(false);
  const timerRef = useRef<number | null>(null);

  const disarm = () => {
    setArmed(false);
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  // leaving edit mode (or unmounting) always disarms the seal
  useEffect(() => {
    if (!editing) disarm();
  }, [editing]);
  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  if (!editing || !user?.keeper) return null;

  const onRestore = () => {
    if (!armed) {
      setArmed(true);
      timerRef.current = window.setTimeout(() => {
        setArmed(false);
        timerRef.current = null;
      }, ARM_WINDOW_MS);
      return;
    }
    disarm();
    resetCopy();
    resetSectionLayout();
    setTheme('crimson');
    herald('All changes are reset. The hall stands as it was first built.');
  };

  const onDone = () => {
    setEditMode(false);
    // the editing chrome under the caret is about to vanish: reseat focus
    document.querySelector<HTMLElement>('.hall-root .profile-trigger')?.focus();
  };

  return (
    <div className="mason-bar" role="region" aria-label="Editing this page">
      <svg aria-hidden="true"><use href="#glyph-crown-small" /></svg>
      <span className="mason-label">Editing this page</span>
      <ThemeSeals groupLabel="Theme" />
      <button
        id="mason-restore"
        className={`btn btn-ghost${armed ? ' is-armed' : ''}`}
        type="button"
        aria-label={armed ? 'Armed: click again to reset every change' : undefined}
        onClick={onRestore}
      >
        {armed ? 'Click again to confirm' : 'Reset all changes'}
      </button>
      <button className="btn btn-primary" type="button" onClick={onDone}>
        Done
      </button>
    </div>
  );
}

/* ── section control plates (rendered by Landing inside each section) ── */

const SECTION_NAMES: Record<SectionId, string> = {
  library: 'The library',
  cards: 'The cards',
  way: 'The way of the deck',
  call: 'The call to arms',
};

export function MasonSectionPlate({ id }: { id: SectionId }) {
  const editing = useEditMode();
  const user = useUser();
  const { order, shelved } = useSectionLayout();
  if (!editing || !user?.keeper) return null;

  const name = SECTION_NAMES[id];
  const isShelved = shelved.includes(id);

  const refocus = (act: string) => {
    // the section list re-renders in its new order; reseat focus afterwards
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-section="${id}"] [data-mason="${act}"]`)
        ?.focus();
    });
  };

  const move = (delta: -1 | 1) => {
    const next = [...order];
    const i = next.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= next.length) {
      herald(delta < 0 ? 'It already stands first.' : 'It already stands last.');
      return;
    }
    [next[i], next[j]] = [next[j], next[i]];
    setSectionLayout({ order: next });
    refocus(delta < 0 ? 'up' : 'down');
  };

  const toggleShelve = () => {
    const on = !isShelved;
    setSectionLayout({ shelved: on ? [...shelved, id] : shelved.filter((s) => s !== id) });
    herald(on ? `${name} is hidden. Visitors will not see it.` : `${name} is visible again.`);
    refocus('shelve');
  };

  return (
    <div className="mason-controls" role="group" aria-label={`${name}: section controls`}>
      <span className="mason-section-name">{name}</span>
      <button type="button" data-mason="up" aria-label={`Move ${name} up`} onClick={() => move(-1)}>
        <svg aria-hidden="true"><use href="#glyph-chevron-up" /></svg>
      </button>
      <button type="button" data-mason="down" aria-label={`Move ${name} down`} onClick={() => move(1)}>
        <svg aria-hidden="true"><use href="#glyph-chevron-down" /></svg>
      </button>
      <button
        type="button"
        data-mason="shelve"
        aria-pressed={isShelved}
        aria-label={`Hide ${name} from visitors`}
        onClick={toggleShelve}
      >
        <svg aria-hidden="true"><use href="#glyph-veil-small" /></svg>
      </button>
    </div>
  );
}
