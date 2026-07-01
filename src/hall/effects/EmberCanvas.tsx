/**
 * Ember particles for the landing hero. Reads --ember-warm/--ember-gold as
 * "R G B" triplets from the :root tokens (re-read when the banner theme
 * changes), scales for devicePixelRatio, and sleeps when the tab hides,
 * motion is reduced, or calm mode stills the hall. Route pauses come free:
 * the canvas only mounts on the landing screen.
 */
import { useEffect, useRef } from 'react';
import { useCalm, useTheme } from '../state/theme';

interface Particle {
  x: number;
  y: number;
  r: number;
  speed: number;
  drift: number;
  gold: boolean;
  phase: number;
}

export function EmberCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const calm = useCalm();
  const theme = useTheme(); // effect re-runs on banner change to re-read inks

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || calm) return;
    const host = canvas.parentElement;
    const ctx = canvas.getContext('2d');
    if (!host || !ctx) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const cs = getComputedStyle(document.documentElement);
    const warmInk = cs.getPropertyValue('--ember-warm').trim() || '196 62 58';
    const goldInk = cs.getPropertyValue('--ember-gold').trim() || '212 168 98';

    let raf: number | null = null;
    let particles: Particle[] = [];

    function seed(rect: DOMRect) {
      const count = Math.min(70, Math.floor(rect.width / 18));
      particles = Array.from({ length: count }, () => ({
        x: Math.random() * rect.width,
        y: Math.random() * rect.height,
        r: 0.6 + Math.random() * 1.6,
        speed: 0.15 + Math.random() * 0.45,
        drift: Math.random() * Math.PI * 2,
        gold: Math.random() < 0.14,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    function size() {
      if (!canvas || !host || !ctx) return;
      const rect = host.getBoundingClientRect();
      // width/height assignment resets the transform, so the DPR scale never compounds
      canvas.width = rect.width * devicePixelRatio;
      canvas.height = rect.height * devicePixelRatio;
      ctx.scale(devicePixelRatio, devicePixelRatio);
      seed(rect);
    }

    function frame(t: number) {
      if (!host || !ctx) return;
      const rect = host.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      for (const p of particles) {
        p.y -= p.speed;
        p.x += Math.sin(t / 1800 + p.drift) * 0.18;
        if (p.y < -4) { p.y = rect.height + 4; p.x = Math.random() * rect.width; }
        const flicker = 0.35 + 0.3 * Math.sin(t / 480 + p.phase);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgb(${p.gold ? goldInk : warmInk} / ${flicker})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    }

    function wake() {
      if (raf !== null || reduced.matches || document.hidden) return;
      size();
      raf = requestAnimationFrame(frame);
    }
    function sleep() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
    }

    const onResize = () => { if (raf !== null) { sleep(); wake(); } };
    const onVisibility = () => { if (document.hidden) sleep(); else wake(); };
    const onReduced = () => { if (reduced.matches) sleep(); else wake(); };

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    reduced.addEventListener('change', onReduced);
    wake();

    return () => {
      sleep();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      reduced.removeEventListener('change', onReduced);
    };
  }, [calm, theme]);

  return <canvas ref={ref} className="hero-embers" aria-hidden="true" />;
}
