/**
 * Staggered reveal choreography: observes every .reveal under the ref'd
 * element (threshold 0.12; the per-element --i index staggers the delay in
 * CSS). Reduced motion and calm mode reveal everything at once.
 */
import { useEffect, useRef } from 'react';
import { useCalm } from '../state/theme';

export function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const calm = useCalm();

  useEffect(() => {
    const rootEl = ref.current;
    if (!rootEl) return;
    const targets = Array.from(rootEl.querySelectorAll<HTMLElement>('.reveal'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || calm || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-revealed'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-revealed');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    targets.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [calm]);

  return ref;
}
