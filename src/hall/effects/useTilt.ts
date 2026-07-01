/**
 * Pointer-tracking 3D tilt for .tilt cards under the ref'd container: sets
 * --rx/--ry on the inner .card-face. Disabled on hover-less devices; stilled
 * live by reduced motion or calm mode (checked per event, like the original).
 */
import { useEffect, useRef } from 'react';
import { getCalm } from '../state/theme';

export function useTilt<T extends HTMLElement>() {
  const ref = useRef<T>(null);

  useEffect(() => {
    const rootEl = ref.current;
    if (!rootEl) return;
    if (window.matchMedia('(hover: none)').matches) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    const faceOf = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.('.tilt');
      if (!card || !rootEl.contains(card)) return null;
      const face = card.querySelector<HTMLElement>('.card-face');
      return face ? { card, face } : null;
    };

    const move = (e: PointerEvent) => {
      if (reduced.matches || getCalm()) return;
      const hit = faceOf(e);
      if (!hit) return;
      const rect = hit.card.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      hit.face.style.setProperty('--ry', `${(x * 10).toFixed(2)}deg`);
      hit.face.style.setProperty('--rx', `${(-y * 10).toFixed(2)}deg`);
    };

    const out = (e: PointerEvent) => {
      const hit = faceOf(e);
      if (!hit) return;
      hit.face.style.setProperty('--ry', '0deg');
      hit.face.style.setProperty('--rx', '0deg');
    };

    rootEl.addEventListener('pointermove', move);
    rootEl.addEventListener('pointerout', out);
    return () => {
      rootEl.removeEventListener('pointermove', move);
      rootEl.removeEventListener('pointerout', out);
    };
  }, []);

  return ref;
}
