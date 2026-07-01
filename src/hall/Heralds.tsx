/**
 * Heralds — the hall's announcements (toasts). herald(message) is callable
 * from anywhere; <HeraldsRegion/> (rendered once by HallApp) shows the queue
 * top-center in an aria-live region. 4200ms auto-dismiss with a short leave
 * animation; instant under reduced motion.
 */
import { useSyncExternalStore } from 'react';

interface HeraldNote {
  id: number;
  message: string;
  leaving: boolean;
}

let seq = 0;
let notes: HeraldNote[] = [];
const listeners = new Set<() => void>();

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
function update(next: HeraldNote[]) { notes = next; listeners.forEach((l) => l()); }
function getNotes() { return notes; }

export function herald(message: string) {
  const id = ++seq;
  update([...notes, { id, message, leaving: false }]);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.setTimeout(() => {
    if (reduced) { update(notes.filter((n) => n.id !== id)); return; }
    update(notes.map((n) => (n.id === id ? { ...n, leaving: true } : n)));
    // leave animation is 0.4s; remove just after it settles
    window.setTimeout(() => update(notes.filter((n) => n.id !== id)), 450);
  }, 4200);
}

export function HeraldsRegion() {
  const list = useSyncExternalStore(subscribe, getNotes);
  return (
    <div className="heralds" aria-live="polite">
      {list.map((n) => (
        <div key={n.id} className={n.leaving ? 'herald is-leaving' : 'herald'}>
          <svg aria-hidden="true"><use href="#glyph-lozenge" /></svg>
          <p>{n.message}</p>
        </div>
      ))}
    </div>
  );
}
