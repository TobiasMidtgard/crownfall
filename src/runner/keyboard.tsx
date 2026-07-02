/**
 * Keyboard system for authored game screens (the DGT §2/§3 semantics, made
 * generic). Mounted by TableScreen via useTableKeyboard; desktop only — the
 * whole system is inert on touch devices (hover: none) and below the narrow
 * breakpoint (the mobile variant).
 *
 * Model (all def-driven, no game-specific branches):
 *   - Zone screen elements opt in with `keyGroup: 'shift'|'ctrl'|'alt'|'plain'`.
 *     Every group's currently-tappable rendered items (piles / collapsed
 *     stacks / single cards — mirrors ZoneBlock's item derivation) get digit
 *     badges assigned by DOM (paint) order: 1–9, then 0 as the tenth.
 *   - Holding a group's modifier SPOTLIGHTS it: every top-level screen
 *     element whose subtree lacks a zone of that group dims to 0.3 opacity
 *     (class `rn-kb-dim`, applied by ScreenRenderer) and the group's badges
 *     light (`rn-keybadge-lit`: scale 1.25, accent tokens).
 *   - Digits (via e.code, Digit/Numpad, layout-independent) activate the
 *     badged item: its single legal move runs, or the existing multi-move
 *     picker opens — identical to tapping it. No modifier routes to the
 *     'plain' group (the hand); a held/live modifier routes to its group
 *     (alt > ctrl > shift, live event flags first — DGT §2.2).
 *   - Enter performs the FIRST enabled screen button in paint order (the
 *     seal's Done / End turn), unless an interactive element has focus
 *     (native activation wins).
 *   - While any sheet/choice/dialog is open every binding SUSPENDS except
 *     digit selection of sheet options, bridged by clicking the sheet's
 *     `[data-choice-digit="N"]` buttons (stamped by the choice sheets).
 *   - Badges and the spotlight only render while a human may act.
 *   - Nothing is persisted.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameDef, GameState, Id, Move, ScreenElement } from '../shared/types';
import { isDisplayVisible } from '../engine';
import { zoneInstKey } from './layout';
import { filterDisplayCards, groupPiles, resolveSeat, topLegalCard } from './layoutGeometry';

export type ModifierGroup = 'shift' | 'ctrl' | 'alt';
export type KeyboardGroup = ModifierGroup | 'plain';

/** A digit badge shown on a rendered card face. */
export interface KeyBadge {
  digit: string;
  group: KeyboardGroup;
}

/** One digit-addressable item: the rendered face + what activating it taps. */
export interface KeyTarget {
  /** The card whose rendered face carries the badge (pile/stack top). */
  faceId: Id;
  /** The member a digit press actually activates (topmost legal). */
  activateId: Id;
  digit: string;
}

/** Ordered targets per group + the badge map ZoneViews renders from. */
export interface KeyTargetIndex {
  groups: ReadonlyMap<KeyboardGroup, readonly KeyTarget[]>;
  /** By face card id (first group to claim a face wins). */
  badges: ReadonlyMap<Id, KeyBadge>;
  /** Modifier groups that exist in the layout (spotlightable). */
  present: ReadonlySet<ModifierGroup>;
}

const EMPTY_INDEX: KeyTargetIndex = {
  groups: new Map(),
  badges: new Map(),
  present: new Set(),
};

// ---------------------------------------------------------------------------
// Pure helpers (DOM-free; unit-tested in keyboard.test.ts)
// ---------------------------------------------------------------------------

/** Digit label for the Nth target: 0–8 → '1'–'9', 9 → '0', beyond → null. */
export function digitForIndex(i: number): string | null {
  if (i < 0 || i > 9) return null;
  return i === 9 ? '0' : String(i + 1);
}

/**
 * Key code → target index (layout-independent, numpad included):
 * Digit1/Numpad1 → 0 … Digit9 → 8, Digit0 → 9 (the tenth). Null otherwise.
 */
export function indexFromCode(code: string): number | null {
  const m = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (m === null) return null;
  const d = Number(m[1]);
  return d === 0 ? 9 : d - 1;
}

export interface HeldModifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
}

/** The group a held-modifier set marks (alt > ctrl > shift — DGT priority). */
export function heldGroup(held: HeldModifiers): ModifierGroup | null {
  return held.alt ? 'alt' : held.ctrl ? 'ctrl' : held.shift ? 'shift' : null;
}

/**
 * The group a digit press routes to: live event flags win (a digit struck
 * while the modifier is physically down always routes correctly), the held
 * state is fallback, no modifier at all = the 'plain' group.
 */
export function groupForDigit(live: HeldModifiers, held: HeldModifiers): KeyboardGroup {
  return live.alt ? 'alt'
    : live.ctrl ? 'ctrl'
      : live.shift ? 'shift'
        : heldGroup(held) ?? 'plain';
}

/**
 * Walk the active element tree in paint order and index every keyGroup
 * zone's tappable items: piles ('piles'/'carousel' display) and collapsed
 * duplicate stacks contribute their face with the TOPMOST legal member as
 * the activation target; stack-layout zones contribute the top card; other
 * layouts contribute each legal card. Items beyond the tenth per group are
 * unaddressable (dropped). Invisible elements (their `visible` expression,
 * viewer-bound) contribute nothing.
 */
export function computeKeyTargets(
  def: GameDef,
  state: GameState,
  elements: readonly ScreenElement[],
  viewerId: Id,
  hasMoves: (cardId: Id) => boolean,
): KeyTargetIndex {
  const playerIds = state.players.map((p) => p.id);
  const raw = new Map<KeyboardGroup, { faceId: Id; activateId: Id }[]>();
  const present = new Set<ModifierGroup>();

  const collect = (el: Extract<ScreenElement, { kind: 'zone' }>, group: KeyboardGroup) => {
    const zone = def.zones.find((z) => z.id === el.zoneId);
    if (!zone) return;
    let ownerId: Id | null = null;
    if (zone.owner === 'perPlayer') {
      if (el.seat === 'shared') return;
      ownerId = resolveSeat(playerIds, viewerId, el.seat, state.currentPlayerIdx);
      if (ownerId === null) return;
    }
    const inst = state.zones[zoneInstKey(zone.id, ownerId)];
    if (!inst) return;
    const ids = el.cardFilter != null
      ? filterDisplayCards(def, state, inst.cardIds, el.cardFilter, viewerId)
      : inst.cardIds;
    // Rendered items in DOM order — mirrors ZoneBlock's derivation exactly.
    const isPiles = el.display === 'piles' || el.display === 'carousel';
    let items: { face: Id; members: readonly Id[] }[];
    if (isPiles) {
      items = groupPiles(ids, state.cards).map((p) => ({ face: p.topId, members: p.cardIds }));
    } else if (zone.layout === 'stack') {
      const top = ids.length > 0 ? ids[ids.length - 1] : null;
      items = top !== null ? [{ face: top, members: [top] }] : [];
    } else if (el.collapseDuplicates === true) {
      items = groupPiles(ids, state.cards).map((p) => ({ face: p.topId, members: p.cardIds }));
    } else {
      items = ids.map((id) => ({ face: id, members: [id] }));
    }
    const list = raw.get(group) ?? [];
    for (const it of items) {
      const target = topLegalCard(it.members, hasMoves);
      if (target === null) continue;
      list.push({ faceId: it.face, activateId: target });
    }
    raw.set(group, list);
  };

  const walk = (els: readonly ScreenElement[]) => {
    for (const el of els) {
      if (!isDisplayVisible(def, state, el.visible ?? null, viewerId)) continue;
      if (el.kind === 'zone' && el.keyGroup !== undefined) {
        if (el.keyGroup !== 'plain') present.add(el.keyGroup);
        collect(el, el.keyGroup);
      }
      if (el.children !== undefined && el.children.length > 0) walk(el.children);
    }
  };
  walk(elements);

  const groups = new Map<KeyboardGroup, KeyTarget[]>();
  const badges = new Map<Id, KeyBadge>();
  for (const [group, list] of raw) {
    const targets: KeyTarget[] = [];
    for (let i = 0; i < list.length; i += 1) {
      const digit = digitForIndex(i);
      if (digit === null) break; // beyond the tenth: unaddressable
      const t = { ...list[i], digit };
      targets.push(t);
      if (!badges.has(t.faceId)) badges.set(t.faceId, { digit, group });
    }
    groups.set(group, targets);
  }
  return { groups, badges, present };
}

/**
 * True when the element's subtree contains a zone of the given keyboard
 * group — such top-level elements stay bright during that group's spotlight.
 */
export function subtreeHasKeyGroup(el: ScreenElement, group: KeyboardGroup): boolean {
  if (el.kind === 'zone' && el.keyGroup === group) return true;
  return (el.children ?? []).some((c) => subtreeHasKeyGroup(c, group));
}

/**
 * The first ENABLED screen button in paint order (visibility-gated like the
 * renderer) and its legal move — what Enter performs. Null when none.
 */
export function firstEnabledButtonMove(
  def: GameDef,
  state: GameState,
  elements: readonly ScreenElement[],
  viewerId: Id,
  buttonMove: ReadonlyMap<Id, Move>,
): Move | null {
  for (const el of elements) {
    if (!isDisplayVisible(def, state, el.visible ?? null, viewerId)) continue;
    if (el.kind === 'button' && el.actionId !== null) {
      const move = buttonMove.get(el.actionId);
      if (move !== undefined) return move;
    }
    if (el.children !== undefined && el.children.length > 0) {
      const nested = firstEnabledButtonMove(def, state, el.children, viewerId, buttonMove);
      if (nested !== null) return nested;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// React glue (window listeners + live wiring)
// ---------------------------------------------------------------------------

/** What TableScreen threads into the renderer (badges via ctx, dim classes). */
export interface KeyboardWiring {
  /** Modifier group currently spotlit (held + allowed), or null. */
  spotlight: ModifierGroup | null;
  /** Digit badges by rendered face card id (empty while suspended). */
  badges: ReadonlyMap<Id, KeyBadge>;
}

const NO_MODIFIERS: HeldModifiers = { shift: false, ctrl: false, alt: false };
const NO_BADGES: ReadonlyMap<Id, KeyBadge> = new Map();

/** True where a hover-capable pointer exists (keyboard play is desktop-only). */
function useHoverCapable(): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [capable, setCapable] = useState(
    () => supported && !window.matchMedia('(hover: none)').matches,
  );
  useEffect(() => {
    if (!supported) return;
    const mq = window.matchMedia('(hover: none)');
    const onChange = () => setCapable(!mq.matches);
    onChange();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange); // older WebKit
    return () => mq.removeListener(onChange);
  }, [supported]);
  return capable;
}

/** Focus sits on something that handles Enter/Space itself (native wins). */
function interactiveFocused(): boolean {
  const el = typeof document !== 'undefined' ? document.activeElement : null;
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'BUTTON' || tag === 'A' || tag === 'INPUT' || tag === 'TEXTAREA'
    || tag === 'SELECT' || el.isContentEditable || el.getAttribute('role') === 'button';
}

/** The event target is a text-entry surface — ignore the key entirely. */
function typingTarget(e: KeyboardEvent): boolean {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return false;
  return t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

export function useTableKeyboard(opts: {
  def: GameDef;
  state: GameState;
  viewerId: Id;
  /** Active screen elements; null = classic layout (keyboard stays inert). */
  elements: readonly ScreenElement[] | null;
  /** Legal card-target moves (as in TableCtx). */
  cardMoves: ReadonlyMap<Id, Move[]>;
  /** Legal none-target move per action id (screen buttons; incl. Pass). */
  buttonMove: ReadonlyMap<Id, Move>;
  /** Any sheet/choice/dialog open: bindings suspend, digits go to the sheet. */
  overlayOpen: boolean;
  /** A human may act right now (badges/spotlight render only then). */
  humanCanAct: boolean;
  /** Below the narrow breakpoint (mobile variant) — keyboard inert. */
  narrow: boolean;
  /** Same handler taps use: single legal move or the multi-move picker. */
  onActivateCard: (cardId: Id) => void;
  onMove: (m: Move) => void;
}): KeyboardWiring {
  const {
    def, state, viewerId, elements, cardMoves, buttonMove,
    overlayOpen, humanCanAct, narrow, onActivateCard, onMove,
  } = opts;
  const hoverCapable = useHoverCapable();
  const enabled = hoverCapable && !narrow && elements !== null;

  const [held, setHeld] = useState<HeldModifiers>(NO_MODIFIERS);

  const index = useMemo<KeyTargetIndex>(() => {
    if (!enabled || !humanCanAct) return EMPTY_INDEX;
    return computeKeyTargets(
      def, state, elements, viewerId,
      (id) => (cardMoves.get(id)?.length ?? 0) > 0,
    );
  }, [enabled, humanCanAct, def, state, elements, viewerId, cardMoves]);

  // Everything the (stable) listeners need, refreshed per render.
  const live = useRef({
    def, state, viewerId, elements, buttonMove, overlayOpen, humanCanAct,
    index, held, onActivateCard, onMove,
  });
  live.current = {
    def, state, viewerId, elements, buttonMove, overlayOpen, humanCanAct,
    index, held, onActivateCard, onMove,
  };

  useEffect(() => {
    if (!enabled) {
      setHeld(NO_MODIFIERS);
      return;
    }
    const setFlag = (key: string, down: boolean): boolean => {
      const flag = key === 'Shift' ? 'shift' : key === 'Control' ? 'ctrl' : key === 'Alt' ? 'alt' : null;
      if (flag === null) return false;
      setHeld((h) => (h[flag] === down ? h : { ...h, [flag]: down }));
      return true;
    };
    const clearHeld = () => setHeld((h) => (h.shift || h.ctrl || h.alt ? NO_MODIFIERS : h));

    const onKeyDown = (e: KeyboardEvent) => {
      const s = live.current;
      if (typingTarget(e)) return;
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt') {
        if (e.key === 'Alt') e.preventDefault(); // keep the browser menu shut
        setFlag(e.key, true);
        return;
      }
      const idx = indexFromCode(e.code);
      if (s.overlayOpen) {
        // Suspended — except digit selection of the open sheet's options.
        if (idx !== null) {
          const digit = digitForIndex(idx);
          const btn = digit !== null
            ? document.querySelector<HTMLButtonElement>(`[data-choice-digit="${digit}"]`)
            : null;
          if (btn !== null && !btn.disabled) {
            e.preventDefault();
            btn.click();
          }
        }
        return;
      }
      if (!s.humanCanAct) return;
      if (idx !== null) {
        const group = groupForDigit(
          { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey },
          s.held,
        );
        const target = s.index.groups.get(group)?.[idx];
        if (target !== undefined) {
          e.preventDefault();
          s.onActivateCard(target.activateId);
        }
        return;
      }
      if (e.key === 'Enter') {
        if (interactiveFocused() || s.elements === null) return;
        const move = firstEnabledButtonMove(s.def, s.state, s.elements, s.viewerId, s.buttonMove);
        if (move !== null) {
          e.preventDefault();
          s.onMove(move);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      setFlag(e.key, false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeld);
    document.addEventListener('visibilitychange', clearHeld);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearHeld);
      document.removeEventListener('visibilitychange', clearHeld);
    };
  }, [enabled]);

  const heldNow = heldGroup(held);
  const active = enabled && humanCanAct && !overlayOpen;
  const spotlight = active && heldNow !== null && index.present.has(heldNow) ? heldNow : null;
  return {
    spotlight,
    badges: active ? index.badges : NO_BADGES,
  };
}
