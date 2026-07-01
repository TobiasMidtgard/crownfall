/**
 * FLIP card-move animation, shared by the automatic AND screen layouts.
 *
 * Every rendered table card registers its DOM node in a CardRectRegistry
 * (ref callbacks keyed by card instance id). After each committed state
 * change, useCardFlights compares each card's zone instance against the
 * previous state: cards whose container changed AND whose old + new rects are
 * both known become "flights" — transient overlay clones that tween from the
 * old rect to the new one while the real destination card stays VEILED until
 * landing. Face changes simply render the NEW facing on the clone.
 *
 * The flight is the reference 3-keyframe arc (ease-out-expo): source rect →
 * midpoint raised by `arc`px at half spin with averaged scale → target rect
 * at full spin. ScreenLayout.motion tunes flightMs/arc/spin/staggerMs
 * (defaults 430/46/4/55); the automatic layout uses the defaults. Flights
 * started by one update stagger by `staggerMs`. Cards arriving in a burn
 * zone (arriveEffect 'burn') fly with the burn profile (420ms, arc 70,
 * spin 6) then char in place (~620ms brightness flash → darken → collapse)
 * under 12-16 rising ember particles.
 *
 * Constraints honored: at most MAX_FLIGHTS concurrent clones per update (the
 * rest just appear), prefers-reduced-motion collapses every flight to a 90ms
 * fade-in at the destination, the 'instant' speed setting skips clones
 * entirely (the hook is disabled), and the overlay never intercepts input.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { GameState, Id } from '../shared/types';
import { isCardVisibleTo } from '../engine';
import { CardView } from '../components/CardView';
import { templateOf } from './layout';
import {
  asSpeed, BURN_CHAR_MS, BURN_FLIGHT, EASE_OUT_EXPO, scaleMs,
  type ResolvedMotion, type SpeedSetting,
} from './layoutGeometry';
import type { TableCtx } from './ZoneViews';

const MAX_FLIGHTS = 12;
/** Reduced motion: flights collapse to this fade at the destination. */
const REDUCED_FADE_MS = 90;
/** No-WAAPI fallback: just hold the veil briefly. */
const FALLBACK_MS = 200;

export interface Box { left: number; top: number; width: number; height: number }

export interface Flight {
  key: number;
  cardId: Id;
  from: Box;
  to: Box;
  /** Index within the update's batch — flights stagger by staggerMs each. */
  order: number;
  /** The destination zone plays the burn choreography on arrival. */
  burn: boolean;
}

/**
 * True when the player asked for stillness: the OS-level reduced-motion
 * preference, or a host app's reduce-animations setting signalled by a
 * `calm` class on <html> (the class — not any host import — is the
 * contract). Checked live so a mid-game toggle applies immediately.
 */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('calm')) {
    return true;
  }
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// ---------------------------------------------------------------------------
// Speed persistence (status-bar 1× / 2× / instant toggle)
// ---------------------------------------------------------------------------

export const SPEED_KEY = 'cardsmith.speed';

export function loadSpeed(): SpeedSetting {
  try {
    return asSpeed(window.localStorage.getItem(SPEED_KEY));
  } catch {
    return '1x';
  }
}

export function saveSpeed(s: SpeedSetting): void {
  try {
    window.localStorage.setItem(SPEED_KEY, s);
  } catch {
    // Storage unavailable (private mode) — the toggle still works in-session.
  }
}

// ---------------------------------------------------------------------------
// Card rect registry
// ---------------------------------------------------------------------------

/**
 * Live map of card instance id -> rendered DOM node, plus the "hidden while a
 * clone is in flight" set. Hiding is imperative (style.visibility) so flights
 * never re-render the table; attach() re-applies it across remounts.
 */
export class CardRectRegistry {
  private els = new Map<Id, HTMLElement>();
  private hidden = new Set<Id>();

  /** Ref-callback target for every rendered table card. */
  attach(id: Id, el: HTMLElement | null): void {
    if (el === null) {
      this.els.delete(id);
      return;
    }
    this.els.set(id, el);
    el.style.visibility = this.hidden.has(id) ? 'hidden' : '';
  }

  /** Viewport rects of every registered card (skips unlaid-out nodes). */
  capture(): Map<Id, Box> {
    const out = new Map<Id, Box>();
    for (const [id, el] of this.els) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        out.set(id, { left: r.left, top: r.top, width: r.width, height: r.height });
      }
    }
    return out;
  }

  hide(id: Id): void {
    this.hidden.add(id);
    const el = this.els.get(id);
    if (el) el.style.visibility = 'hidden';
  }

  unhide(id: Id): void {
    this.hidden.delete(id);
    const el = this.els.get(id);
    if (el) el.style.visibility = '';
  }
}

/** Card instance id -> zone instance key, from the public state. */
function containerMap(state: GameState): Map<Id, string> {
  const map = new Map<Id, string>();
  for (const inst of Object.values(state.zones)) {
    for (const id of inst.cardIds) map.set(id, inst.key);
  }
  return map;
}

let flightSeq = 0;

/**
 * Watches `state` for cards that changed zone instance and turns them into
 * flights. `enabled` false (hotseat curtain up — nothing is mounted — or the
 * instant speed setting) clears everything and re-baselines, so stale rects
 * never replay after the reveal. `burnKeys` marks destination zone instances
 * whose arrivals burn.
 */
export function useCardFlights(
  state: GameState,
  registry: CardRectRegistry,
  enabled: boolean,
  burnKeys?: ReadonlySet<string>,
): [Flight[], (key: number) => void] {
  const [flights, setFlights] = useState<Flight[]>([]);
  const prevContainers = useRef<Map<Id, string> | null>(null);
  const prevRects = useRef<Map<Id, Box>>(new Map());

  useLayoutEffect(() => {
    if (!enabled) {
      prevContainers.current = null;
      prevRects.current = new Map();
      setFlights((cur) => (cur.length > 0 ? [] : cur));
      return;
    }
    const containers = containerMap(state);
    const rects = registry.capture();
    const prev = prevContainers.current;
    const started: Flight[] = [];
    if (prev !== null) {
      for (const [cardId, instKey] of containers) {
        if (started.length >= MAX_FLIGHTS) break;
        const was = prev.get(cardId);
        if (was === undefined || was === instKey) continue;
        const from = prevRects.current.get(cardId);
        const to = rects.get(cardId);
        if (!from || !to) continue;
        flightSeq += 1;
        started.push({
          key: flightSeq,
          cardId,
          from,
          to,
          order: started.length,
          burn: burnKeys?.has(instKey) ?? false,
        });
      }
    }
    prevContainers.current = containers;
    prevRects.current = rects;
    if (started.length > 0) {
      // A card already in flight that moves again gets a fresh clone.
      setFlights((cur) => [
        ...cur.filter((f) => !started.some((s) => s.cardId === f.cardId)),
        ...started,
      ]);
    }
  }, [state, registry, enabled, burnKeys]);

  const finish = (key: number) => setFlights((cur) => cur.filter((f) => f.key !== key));
  return [flights, finish];
}

// ---------------------------------------------------------------------------
// Flight rendering
// ---------------------------------------------------------------------------

/** Fixed overlay hosting the in-flight card clones. Never blocks input. */
export function FlightLayer({ ctx, flights, registry, motion, factor, onDone }: {
  ctx: TableCtx;
  flights: Flight[];
  registry: CardRectRegistry;
  /** Resolved motion spec (screen layout's, or the defaults). */
  motion: ResolvedMotion;
  /** Speed multiplier applied to every duration/delay (1 or 1/1.9). */
  factor: number;
  onDone: (key: number) => void;
}) {
  if (flights.length === 0) return null;
  return (
    <div className="rn-flightlayer" aria-hidden="true">
      {flights.map((f) => (
        <FlightCard
          key={f.key}
          ctx={ctx}
          flight={f}
          registry={registry}
          motion={motion}
          factor={factor}
          onDone={onDone}
        />
      ))}
    </div>
  );
}

interface EmberSpec {
  id: number;
  dx: number;
  dy: number;
  size: number;
  gold: boolean;
  durMs: number;
}

/** 12-16 rising ember particles: small rotated squares, ~30% gold. */
function makeEmbers(factor: number): EmberSpec[] {
  const n = 12 + Math.floor(Math.random() * 5);
  return Array.from({ length: n }, (_, id) => ({
    id,
    dx: Math.round(Math.random() * 90 - 45),
    dy: -45 - Math.round(Math.random() * 110),
    size: 3 + Math.random() * 4.5,
    gold: Math.random() < 0.3,
    durMs: Math.max(1, scaleMs(650 + Math.random() * 600, factor)),
  }));
}

function FlightCard({ ctx, flight, registry, motion, factor, onDone }: {
  ctx: TableCtx;
  flight: Flight;
  registry: CardRectRegistry;
  motion: ResolvedMotion;
  factor: number;
  onDone: (key: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [embers, setEmbers] = useState<EmberSpec[] | null>(null);

  useLayoutEffect(() => {
    registry.hide(flight.cardId);
    let live = true;
    const anims: Animation[] = [];
    const timers: number[] = [];
    const done = () => {
      if (!live) return;
      live = false;
      registry.unhide(flight.cardId);
      onDone(flight.key);
    };
    const node = ref.current;
    if (!node || typeof node.animate !== 'function') {
      timers.push(window.setTimeout(done, FALLBACK_MS));
    } else if (prefersReducedMotion()) {
      // Reduced motion: no travel — a quick fade-in at the destination.
      const fade = node.animate(
        [{ opacity: 0 }, { opacity: 1 }],
        { duration: REDUCED_FADE_MS, easing: 'ease-out', fill: 'both' },
      );
      fade.onfinish = done;
      anims.push(fade);
    } else {
      const m = flight.burn ? BURN_FLIGHT : motion;
      const duration = Math.max(1, scaleMs(m.flightMs, factor));
      const delay = scaleMs(flight.order * motion.staggerMs, factor);
      const dx = flight.from.left - flight.to.left;
      const dy = flight.from.top - flight.to.top;
      const sx = flight.to.width > 0 ? flight.from.width / flight.to.width : 1;
      const sy = flight.to.height > 0 ? flight.from.height / flight.to.height : 1;
      const fly = node.animate([
        { transform: `translate(${dx}px, ${dy}px) rotate(0deg) scale(${sx}, ${sy})` },
        {
          transform: `translate(${dx / 2}px, ${dy / 2 - m.arc}px) `
            + `rotate(${m.spin / 2}deg) scale(${(1 + sx) / 2}, ${(1 + sy) / 2})`,
          offset: 0.5,
        },
        { transform: `translate(0px, 0px) rotate(${m.spin}deg) scale(1, 1)` },
      ], { duration, delay, easing: EASE_OUT_EXPO, fill: 'both' });
      anims.push(fly);
      if (!flight.burn) {
        fly.onfinish = done;
      } else {
        fly.onfinish = () => {
          if (!live) return;
          // Landed in a burn zone: char in place + embers; the real card
          // stays veiled until the husk is swept away.
          const specs = makeEmbers(factor);
          setEmbers(specs);
          const charMs = Math.max(1, scaleMs(BURN_CHAR_MS, factor));
          const char = node.animate([
            { filter: 'brightness(1)', transform: `rotate(${m.spin}deg) scale(1) translateY(0px)` },
            { filter: 'brightness(1.9)', offset: 0.25 },
            { filter: 'brightness(0.18)', offset: 0.6 },
            { filter: 'brightness(0.05)', transform: `rotate(${m.spin}deg) scale(0.78) translateY(8px)` },
          ], { duration: charMs, easing: 'ease-in', fill: 'forwards' });
          anims.push(char);
          const hold = Math.max(charMs, ...specs.map((s) => s.durMs));
          timers.push(window.setTimeout(done, hold + 60));
        };
      }
    }
    return () => {
      // Replaced or unmounted mid-flight: restore the real card quietly.
      if (live) {
        live = false;
        registry.unhide(flight.cardId);
      }
      for (const a of anims) a.cancel();
      for (const t of timers) window.clearTimeout(t);
    };
    // The flight is immutable — animate exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const card = ctx.state.cards[flight.cardId];
  if (!card) return null;
  const visible = isCardVisibleTo(ctx.def, ctx.state, flight.cardId, ctx.viewerId);
  return (
    <div
      ref={ref}
      className="rn-flight"
      style={{
        left: flight.to.left,
        top: flight.to.top,
        width: flight.to.width,
        height: flight.to.height,
        transformOrigin: 'top left',
      }}
    >
      <CardView
        card={{ name: card.name, templateId: card.templateId, fields: card.fields, faceUp: visible }}
        template={templateOf(ctx.def, card)}
        width={flight.to.width}
        accent={ctx.accent}
      />
      {embers !== null && (
        <div className="rn-embers" aria-hidden="true">
          {embers.map((e) => (
            <span
              key={e.id}
              className="rn-ember"
              style={{
                width: e.size,
                height: e.size,
                background: e.gold ? '#ffd166' : '#ff7a45',
                animationDuration: `${e.durMs}ms`,
                '--rn-ember-dx': `${e.dx}px`,
                '--rn-ember-dy': `${e.dy}px`,
              } as React.CSSProperties}
            />
          ))}
        </div>
      )}
    </div>
  );
}
