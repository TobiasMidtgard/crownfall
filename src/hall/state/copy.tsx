/**
 * Keeper copy store + the <Edit> inline component (mason tools, read side).
 *
 * Overrides live at 'crownfall.copy' as { [editId]: string } — the exact key
 * and shape the original editor.js wrote, so existing halls keep their words.
 * Defaults come from source fallbacks (not DOM snapshots): copyText(id, fb)
 * returns the override when one exists and is non-blank.
 *
 * Edit mode is a module store (not persisted). While it is on AND the signed
 * in user is the keeper, <Edit> renders a plaintext contentEditable span in
 * place. React never renders the span's children — text is written
 * imperatively — so typing (which mutates DOM React would otherwise own) is
 * never clobbered by a parent re-render. Keyboard contract preserved from
 * editor.js: Enter commits, Escape restores the focus-time value, emptying
 * reverts to the default; paste is forced to plain text; clicks on editable
 * buttons/links edit instead of firing.
 */
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useUser } from './auth';
import { herald } from '../Heralds';

const KEY = 'crownfall.copy';

const memoryStore = new Map<string, string>();

function readRaw(): string | null {
  try { return window.localStorage.getItem(KEY); }
  catch { return memoryStore.get(KEY) ?? null; }
}
function writeRaw(value: string) {
  try { window.localStorage.setItem(KEY, value); }
  catch { memoryStore.set(KEY, value); }
}

let overrides: Record<string, string> = (() => {
  const raw = readRaw();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch { return {}; }
})();

const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function persist() { writeRaw(JSON.stringify(overrides)); }

export function copyText(id: string, fallback: string): string {
  const v = overrides[id];
  return typeof v === 'string' && v.trim() ? v : fallback;
}

/** Empty/null value deletes the override (the default is not stored). */
export function setCopy(id: string, value: string | null) {
  const next = { ...overrides };
  if (value === null || !value.trim()) delete next[id];
  else next[id] = value;
  overrides = next;
  persist();
  emit();
}

export function resetCopy() {
  overrides = {};
  persist();
  emit();
}

export function useCopy(id: string, fallback: string): string {
  return useSyncExternalStore(subscribe, () => copyText(id, fallback));
}

/* ── edit mode (module store; not persisted) ── */
let editing = false;
const editListeners = new Set<() => void>();
function editSubscribe(l: () => void) { editListeners.add(l); return () => { editListeners.delete(l); }; }

export function isEditMode(): boolean { return editing; }
export function setEditMode(on: boolean) {
  editing = on;
  // crownfall.css keys the dashed edit chrome off body.editing
  document.body.classList.toggle('editing', on);
  editListeners.forEach((l) => l());
}
export function useEditMode(): boolean {
  return useSyncExternalStore(editSubscribe, isEditMode);
}

/* ── the <Edit> component ── */

// Firefox has no 'plaintext-only'; probe once and fall back to 'true'
const supportsPlaintextOnly = (() => {
  if (typeof document === 'undefined') return false;
  const probe = document.createElement('div');
  try { probe.contentEditable = 'plaintext-only'; } catch { return false; }
  return probe.contentEditable === 'plaintext-only';
})();

export interface EditProps {
  id: string;
  fallback: string;
}

export function Edit({ id, fallback }: EditProps) {
  const user = useUser();
  const editModeOn = useEditMode();
  const text = useCopy(id, fallback);
  const ref = useRef<HTMLSpanElement>(null);
  const focusValue = useRef(text);
  const active = editModeOn && !!user?.keeper;

  // Imperative text sync: skipped while the keeper's caret is inside, so
  // saving-on-input never resets the selection.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    if (el.textContent !== text) el.textContent = text;
  });

  if (!active) return <>{text}</>;

  const save = () => {
    const t = ref.current?.textContent ?? '';
    setCopy(id, t.trim() && t !== fallback ? t : null);
  };

  return (
    <span
      ref={ref}
      data-edit={id}
      contentEditable={supportsPlaintextOnly ? 'plaintext-only' : true}
      suppressContentEditableWarning
      spellCheck={false}
      onFocus={() => { focusValue.current = ref.current?.textContent ?? text; }}
      onInput={save}
      onKeyDown={(e) => {
        // arrows/space belong to the caret, not the surrounding control
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          ref.current?.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          if (ref.current) ref.current.textContent = focusValue.current;
          save();
          ref.current?.blur();
        }
      }}
      onKeyUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        // while editing, a click on an editable button/link edits it
        e.preventDefault();
        e.stopPropagation();
      }}
      onPaste={(e) => {
        e.preventDefault();
        const plain = e.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, plain);
      }}
      onBlur={() => {
        const t = (ref.current?.textContent ?? '').trim();
        if (!t) {
          setCopy(id, null);
          if (ref.current) ref.current.textContent = fallback;
          herald('Empty words fall away; the original text returns.');
        }
      }}
    />
  );
}
