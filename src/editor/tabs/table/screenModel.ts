/**
 * screenModel — pure helpers for the SCREEN BUILDER (GameDef.screenLayout):
 *   - element-tree indexing (absolute rects, parent chains, depths) — EVERY
 *     element is a potential container (`children` on any kind, rects % of
 *     the parent's box); all walks recurse through children of every kind,
 *   - immutable tree edits (update/remove/reparent/reorder among siblings),
 *   - FOCUS MODE helpers (pathToEl/validFocusPath/insertIntoFocusedChildren:
 *     edit the children ON TOP of one element with super fine 1%-of-its-box
 *     precision),
 *   - group/ungroup with rect conversion (children become group-relative),
 *   - the STARTER layout generated when switching Automatic → Custom,
 *   - element factories incl. inline game-zone creation (and shapes, lines,
 *     ready-made phase tracks via shared/screenTemplates),
 *   - element STATE helpers (add/remove/reorder, editor preview merge),
 *   - inline variable/action creation ("tightly knitted" cross-editing),
 *   - align/distribute for multi-selections,
 *   - deck-composition helpers carried over from v3.
 * No React. Geometry math is imported from src/runner/layoutGeometry and
 * re-exported here so the canvas/panels have ONE coordination point with the
 * runner and the two can never drift.
 */
import type {
  ActionDef, DeckDef, ElementState, GameDef, GameState, Id, LayoutStyle, MotionSpec,
  ScreenElement, ScreenLayout, ScreenVariant, SeatRef, VariableDef, ZoneDef, ZoneLayout,
  ZoneVisibility,
} from '../../../shared/types';
import { PASS_ACTION_ID } from '../../../shared/types';
import { isDisplayVisible } from '../../../engine';
import { newAction, newVariable, uid } from '../../../shared/defaults';
import { phaseTrackGroup } from '../../../shared/screenTemplates';
import {
  absToGroupRel, filterDisplayCards, groupPiles, groupRelToAbs, resolveSeat, type PlainRect,
} from '../../../runner/layoutGeometry';
import {
  readSelection, selectorButtons, selectorContextFrom, selectorGateOpen, zoneInstKey,
} from '../../../runner/layout';

// Shared geometry, re-exported for the canvas and panels (single import point).
export {
  absToGroupRel, fanMarginPx, fitCount, groupRelToAbs, layoutStyleCss, pctToPx, rectContains,
} from '../../../runner/layoutGeometry';
export type { PlainRect } from '../../../runner/layoutGeometry';
// The runner's selector-selection store, re-exported so the panels share the
// runner's ONE source of truth (the same coordination-point pattern as the
// geometry above).
export { readSelection, writeSelection } from '../../../runner/layout';

/** Minimum element size, % of the parent. Groups resize no smaller than 8. */
export const MIN_W = 4;
export const MIN_H = 4;
export const GROUP_MIN = 8;

/** Default card width for zone elements, % of the SCREEN's width. */
export const DEFAULT_CARD_SCALE = 8;

const ROOT_RECT: PlainRect = { x: 0, y: 0, w: 100, h: 100 };

// ---------------------------------------------------------------------------
// Small numeric helpers (carried over from v3)
// ---------------------------------------------------------------------------

/** Clamp to [min,max] and snap to `step` (0.5 steppers etc; 2-decimal fix). */
export function snapStep(v: number, min: number, max: number, step: number): number {
  const snapped = Math.round(v / step) * step;
  return Math.min(max, Math.max(min, Math.round(snapped * 100) / 100));
}

/** Round to 2 decimals (rect conversions keep clean numbers). */
export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export function roundRect(r: PlainRect): PlainRect {
  return { x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) };
}

/** Bounding box of a set of rects (same coordinate space). */
export function boundingRect(rects: readonly PlainRect[]): PlainRect {
  const x1 = Math.min(...rects.map((r) => r.x));
  const y1 = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w));
  const y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x1, y: y1, w: Math.max(0.01, x2 - x1), h: Math.max(0.01, y2 - y1) };
}

// ---------------------------------------------------------------------------
// Containers — EVERY element can carry children (rects % of its box)
// ---------------------------------------------------------------------------

/** Children of ANY element ([] when none) — every element is a container. */
export function elChildren(el: ScreenElement): ScreenElement[] {
  return el.children ?? [];
}

/**
 * Write a children array back. Groups always keep `children` (required by
 * the schema); every other kind drops the key when the array empties.
 */
export function withElChildren(el: ScreenElement, children: ScreenElement[]): ScreenElement {
  if (el.kind === 'group' || children.length > 0) return { ...el, children };
  if (el.children === undefined) return el;
  const { children: _gone, ...rest } = el;
  return rest as ScreenElement;
}

// ---------------------------------------------------------------------------
// Tree indexing
// ---------------------------------------------------------------------------

export interface ElInfo {
  el: ScreenElement;
  parentId: Id | null;
  /** Screen-absolute rect of the parent (screen = 0,0,100,100). */
  parentAbs: PlainRect;
  /** Screen-absolute rect of the element. */
  abs: PlainRect;
  depth: number;
}

/** One walk over the tree: id -> element, parent, absolute rect, depth. */
export function indexElements(elements: ScreenElement[]): Map<Id, ElInfo> {
  const map = new Map<Id, ElInfo>();
  const visit = (els: ScreenElement[], parentId: Id | null, parentAbs: PlainRect, depth: number) => {
    for (const el of els) {
      const abs = groupRelToAbs(el.rect, parentAbs);
      map.set(el.id, { el, parentId, parentAbs, abs, depth });
      if (el.children) visit(el.children, el.id, abs, depth + 1);
    }
  };
  visit(elements, null, ROOT_RECT, 0);
  return map;
}

export function findEl(elements: ScreenElement[], id: Id): ScreenElement | null {
  for (const el of elements) {
    if (el.id === id) return el;
    if (el.children) {
      const hit = findEl(el.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** The sibling array containing `id` (the root array or a parent's children). */
export function siblingsOf(elements: ScreenElement[], id: Id): ScreenElement[] | null {
  if (elements.some((el) => el.id === id)) return elements;
  for (const el of elements) {
    if (el.children) {
      const hit = siblingsOf(el.children, id);
      if (hit) return hit;
    }
  }
  return null;
}

/** Ancestor id chain root → `id` (inclusive), through any container kind. */
export function pathToEl(elements: ScreenElement[], id: Id): Id[] | null {
  for (const el of elements) {
    if (el.id === id) return [el.id];
    if (el.children) {
      const sub = pathToEl(el.children, id);
      if (sub) return [el.id, ...sub];
    }
  }
  return null;
}

/**
 * FOCUS-MODE sanity: the longest prefix of `path` that is still a valid
 * root → descendant chain (deleting the focused element exits focus safely).
 */
export function validFocusPath(elements: ScreenElement[], path: readonly Id[]): Id[] {
  const out: Id[] = [];
  let level = elements;
  for (const id of path) {
    const el = level.find((e) => e.id === id);
    if (!el) break;
    out.push(id);
    level = el.children ?? [];
  }
  return out;
}

/** True when any ancestor of `id` is in `set`. */
export function hasAncestorIn(index: Map<Id, ElInfo>, id: Id, set: ReadonlySet<Id>): boolean {
  let p = index.get(id)?.parentId ?? null;
  while (p !== null) {
    if (set.has(p)) return true;
    p = index.get(p)?.parentId ?? null;
  }
  return false;
}

/** Drop ids whose ancestor is also selected (they move with the ancestor). */
export function pruneNested(index: Map<Id, ElInfo>, ids: readonly Id[]): Id[] {
  const set = new Set(ids);
  return ids.filter((id) => index.has(id) && !hasAncestorIn(index, id, set));
}

/** `ids` plus every descendant of each (exclusion sets for drag targets). */
export function withDescendants(index: Map<Id, ElInfo>, ids: readonly Id[]): Set<Id> {
  const set = new Set(ids);
  for (const id of index.keys()) {
    if (!set.has(id) && hasAncestorIn(index, id, set)) set.add(id);
  }
  return set;
}

/**
 * Deepest GROUP whose absolute rect contains the point (ties: smaller area).
 * Groups nested anywhere count — including inside another element's children
 * — but non-group containers are never drag-join targets: children land on a
 * button/shape/… deliberately, via focus mode, never by drag-drop.
 */
export function deepestGroupAt(
  index: Map<Id, ElInfo>, x: number, y: number, exclude: ReadonlySet<Id>,
): Id | null {
  let best: { id: Id; depth: number; area: number } | null = null;
  for (const [id, info] of index) {
    if (info.el.kind !== 'group' || exclude.has(id)) continue;
    const r = info.abs;
    if (x < r.x || y < r.y || x > r.x + r.w || y > r.y + r.h) continue;
    const area = r.w * r.h;
    if (!best || info.depth > best.depth || (info.depth === best.depth && area < best.area)) {
      best = { id, depth: info.depth, area };
    }
  }
  return best ? best.id : null;
}

// ---------------------------------------------------------------------------
// Immutable tree edits
// ---------------------------------------------------------------------------

/** Map `fn` over the element with `id`, wherever it nests. */
export function updateEl(
  elements: ScreenElement[], id: Id, fn: (el: ScreenElement) => ScreenElement,
): ScreenElement[] {
  let changed = false;
  const out = elements.map((el) => {
    if (el.id === id) {
      changed = true;
      return fn(el);
    }
    if (el.children) {
      const children = updateEl(el.children, id, fn);
      if (children !== el.children) {
        changed = true;
        return { ...el, children };
      }
    }
    return el;
  });
  return changed ? out : elements;
}

/**
 * Remove every element whose id is in `ids` (subtrees go with them). A
 * non-group whose last child goes loses its empty `children` key entirely.
 */
export function removeEls(elements: ScreenElement[], ids: ReadonlySet<Id>): ScreenElement[] {
  let changed = false;
  const out: ScreenElement[] = [];
  for (const el of elements) {
    if (ids.has(el.id)) {
      changed = true;
      continue;
    }
    if (el.children) {
      const children = removeEls(el.children, ids);
      if (children !== el.children) {
        changed = true;
        out.push(withElChildren(el, children));
        continue;
      }
    }
    out.push(el);
  }
  return changed ? out : elements;
}

/** Run `edit` on the sibling array that contains `id` (root or a parent's children). */
function editSiblings(
  elements: ScreenElement[], id: Id, edit: (siblings: ScreenElement[]) => ScreenElement[],
): ScreenElement[] {
  if (elements.some((el) => el.id === id)) return edit(elements);
  let changed = false;
  const out = elements.map((el) => {
    if (!el.children) return el;
    const children = editSiblings(el.children, id, edit);
    if (children !== el.children) {
      changed = true;
      return withElChildren(el, children);
    }
    return el;
  });
  return changed ? out : elements;
}

/**
 * Swap with the array neighbor: 'fwd' = later in the array = closer to the
 * viewer (paint order is back → front). No-op at the ends.
 */
export function reorderSibling(elements: ScreenElement[], id: Id, dir: 'fwd' | 'back'): ScreenElement[] {
  return editSiblings(elements, id, (sibs) => {
    const i = sibs.findIndex((el) => el.id === id);
    const j = dir === 'fwd' ? i + 1 : i - 1;
    if (j < 0 || j >= sibs.length) return sibs;
    const next = sibs.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

/**
 * Drag-reorder: re-seat `dragId` at `targetId`'s position within the SAME
 * sibling array (approaching from the front tucks it behind the target, from
 * behind puts it in front). Cross-array drops are a no-op.
 */
export function placeRelativeEl(elements: ScreenElement[], dragId: Id, targetId: Id): ScreenElement[] {
  if (dragId === targetId) return elements;
  return editSiblings(elements, dragId, (sibs) => {
    const from = sibs.findIndex((el) => el.id === dragId);
    const to = sibs.findIndex((el) => el.id === targetId);
    if (from < 0 || to < 0) return sibs;
    const item = sibs[from];
    const without = sibs.filter((el) => el.id !== dragId);
    const ti = without.findIndex((el) => el.id === targetId);
    const at = from > to ? ti : ti + 1;
    return [...without.slice(0, at), item, ...without.slice(at)];
  });
}

/** Write a screen-absolute rect back into the element's parent space. */
export function setAbsRect(
  elements: ScreenElement[], info: ElInfo, abs: PlainRect,
): ScreenElement[] {
  const rel = roundRect(absToGroupRel(abs, info.parentAbs));
  return updateEl(elements, info.el.id, (el) => ({ ...el, rect: rel }));
}

/**
 * Move an element into another parent (`targetGroupId` null = the screen),
 * keeping its on-screen rect `abs`. Appends to the new parent (frontmost).
 * Refuses cycles (dropping a group into itself / its own subtree).
 */
export function reparentEl(
  elements: ScreenElement[], id: Id, targetGroupId: Id | null, abs: PlainRect,
): ScreenElement[] {
  const el = findEl(elements, id);
  if (!el) return elements;
  if (targetGroupId !== null) {
    if (targetGroupId === id) return elements;
    if (el.children && findEl(el.children, targetGroupId)) return elements;
  }
  const index = indexElements(elements);
  const parentAbs = targetGroupId === null ? ROOT_RECT : index.get(targetGroupId)?.abs;
  if (!parentAbs) return elements;
  const moved: ScreenElement = { ...el, rect: roundRect(absToGroupRel(abs, parentAbs)) };
  const without = removeEls(elements, new Set([id]));
  if (targetGroupId === null) return [...without, moved];
  return updateEl(without, targetGroupId, (p) => withElChildren(p, [...elChildren(p), moved]));
}

/**
 * FOCUS-MODE palette insert: the new element joins the FOCUSED element's
 * children, centered with a ~30×30% rect — 30% of the focused box, not the
 * screen, so it lands at a sensible size whatever is focused.
 */
export function insertIntoFocusedChildren(
  elements: ScreenElement[], focusId: Id, el: ScreenElement,
): ScreenElement[] {
  const centered: ScreenElement = { ...el, rect: { x: 35, y: 35, w: 30, h: 30 } };
  return updateEl(elements, focusId, (p) => withElChildren(p, [...elChildren(p), centered]));
}

// ---------------------------------------------------------------------------
// Group / ungroup
// ---------------------------------------------------------------------------

/**
 * Wrap 2+ SIBLINGS in a new group: the group takes their bounding box, the
 * members' rects convert to group-relative (on-screen positions unchanged).
 * The group is inserted where the frontmost member was. Returns null when the
 * ids aren't siblings of one array.
 */
export function groupSiblings(
  elements: ScreenElement[], ids: readonly Id[],
): { elements: ScreenElement[]; groupId: Id } | null {
  if (ids.length < 2) return null;
  const idSet = new Set(ids);
  let ok = false;
  const groupId = uid('el');
  const edited = editSiblings(elements, ids[0], (sibs) => {
    const members = sibs.filter((el) => idSet.has(el.id));
    if (members.length !== idSet.size) return sibs;
    ok = true;
    const bbox = boundingRect(members.map((m) => m.rect));
    const children = members.map((m) => ({ ...m, rect: roundRect(absToGroupRel(m.rect, bbox)) }));
    const lastIdx = sibs.reduce((acc, el, i) => (idSet.has(el.id) ? i : acc), -1);
    const at = sibs.slice(0, lastIdx).filter((el) => !idSet.has(el.id)).length;
    const rest = sibs.filter((el) => !idSet.has(el.id));
    const group: ScreenElement = { kind: 'group', id: groupId, name: 'Group', rect: roundRect(bbox), children };
    return [...rest.slice(0, at), group, ...rest.slice(at)];
  });
  return ok ? { elements: edited, groupId } : null;
}

/**
 * Dissolve a group: children take its place in the parent array, rects
 * back-converted so nothing moves on screen.
 */
export function ungroupEl(
  elements: ScreenElement[], groupId: Id,
): { elements: ScreenElement[]; childIds: Id[] } | null {
  const g = findEl(elements, groupId);
  if (!g || g.kind !== 'group') return null;
  const childIds = g.children.map((c) => c.id);
  const edited = editSiblings(elements, groupId, (sibs) => {
    const i = sibs.findIndex((el) => el.id === groupId);
    const freed = g.children.map((c) => ({ ...c, rect: roundRect(groupRelToAbs(c.rect, g.rect)) }));
    return [...sibs.slice(0, i), ...freed, ...sibs.slice(i + 1)];
  });
  return { elements: edited, childIds };
}

// ---------------------------------------------------------------------------
// Align / distribute (multi-selection; works across parents via abs space)
// ---------------------------------------------------------------------------

export type AlignOp = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export function alignElements(elements: ScreenElement[], ids: readonly Id[], op: AlignOp): ScreenElement[] {
  const index = indexElements(elements);
  const targets = pruneNested(index, ids).map((id) => index.get(id)!);
  if (targets.length < 2) return elements;
  const bbox = boundingRect(targets.map((t) => t.abs));
  let out = elements;
  for (const t of targets) {
    const a = t.abs;
    const moved = { ...a };
    switch (op) {
      case 'left': moved.x = bbox.x; break;
      case 'center': moved.x = bbox.x + (bbox.w - a.w) / 2; break;
      case 'right': moved.x = bbox.x + bbox.w - a.w; break;
      case 'top': moved.y = bbox.y; break;
      case 'middle': moved.y = bbox.y + (bbox.h - a.h) / 2; break;
      case 'bottom': moved.y = bbox.y + bbox.h - a.h; break;
    }
    out = setAbsRect(out, t, moved);
  }
  return out;
}

/** Equal gaps along the axis; the outermost two elements stay put. */
export function distributeElements(elements: ScreenElement[], ids: readonly Id[], axis: 'h' | 'v'): ScreenElement[] {
  const index = indexElements(elements);
  const targets = pruneNested(index, ids)
    .map((id) => index.get(id)!)
    .sort((a, b) => (axis === 'h' ? a.abs.x + a.abs.w / 2 - (b.abs.x + b.abs.w / 2) : a.abs.y + a.abs.h / 2 - (b.abs.y + b.abs.h / 2)));
  if (targets.length < 3) return elements;
  const size = (r: PlainRect) => (axis === 'h' ? r.w : r.h);
  const start = axis === 'h' ? targets[0].abs.x : targets[0].abs.y;
  const last = targets[targets.length - 1].abs;
  const end = axis === 'h' ? last.x + last.w : last.y + last.h;
  const free = end - start - targets.reduce((s, t) => s + size(t.abs), 0);
  const gap = free / (targets.length - 1);
  let cursor = start;
  let out = elements;
  for (const t of targets) {
    const moved = { ...t.abs };
    if (axis === 'h') moved.x = cursor;
    else moved.y = cursor;
    out = setAbsRect(out, t, moved);
    cursor += size(t.abs) + gap;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aspect presets
// ---------------------------------------------------------------------------

export type AspectPreset = 'landscape' | 'portrait' | 'fill';

export const ASPECT_VALUES: Record<AspectPreset, number | null> = {
  landscape: 16 / 9,
  portrait: 9 / 16,
  fill: null,
};

export function aspectPresetOf(layout: ScreenLayout): AspectPreset {
  const a = layout.aspect ?? null;
  if (a === null) return 'fill';
  return a < 1 ? 'portrait' : 'landscape';
}

// ---------------------------------------------------------------------------
// Layout variants (desktop / mobile) — the editor edits ONE variant at a time
// ---------------------------------------------------------------------------

export type VariantKey = 'desktop' | 'mobile';

/** The phone-frame design aspect (width / height), iPhone-ish 9:19.5. */
export const PHONE_ASPECT = 9 / 19.5;

/** The open variant's element tree ([] when mobile doesn't exist yet). */
export function variantElements(layout: ScreenLayout, variant: VariantKey): ScreenElement[] {
  return variant === 'mobile' ? layout.mobile?.elements ?? [] : layout.elements;
}

/** Write an element tree back into the open variant (no-op mobile when absent). */
export function withVariantElements(
  layout: ScreenLayout, variant: VariantKey, elements: ScreenElement[],
): ScreenLayout {
  if (variant === 'mobile') {
    if (!layout.mobile) return layout;
    return { ...layout, mobile: { ...layout.mobile, elements } };
  }
  return { ...layout, elements };
}

/**
 * Deep-clone an element tree with REGENERATED ids (elements and their states)
 * — seeding the mobile variant from desktop must not duplicate ids across
 * trees, and editor selection is id-based.
 */
export function cloneElementsWithNewIds(elements: ScreenElement[]): ScreenElement[] {
  return elements.map((el) => {
    const cloned: ScreenElement = {
      ...el,
      id: uid('el'),
      rect: { ...el.rect },
      ...(el.states
        ? { states: el.states.map((s) => ({ ...s, id: uid('st'), ...(s.rect ? { rect: { ...s.rect } } : {}) })) }
        : {}),
    };
    if (cloned.children) {
      return { ...cloned, children: cloneElementsWithNewIds(cloned.children) };
    }
    return cloned;
  });
}

/**
 * Seed the mobile variant: a deep desktop copy (new ids, same background) or
 * an empty page. The phone frame itself (9:19.5) is implied — `aspect` stays
 * unset until the author opts into a taller scrolling page.
 */
export function createMobileVariant(layout: ScreenLayout, from: 'copy' | 'empty'): ScreenLayout {
  const mobile: ScreenVariant = from === 'copy'
    ? {
        elements: cloneElementsWithNewIds(layout.elements),
        ...(layout.background !== undefined ? { background: layout.background } : {}),
      }
    : { elements: [] };
  return { ...layout, mobile };
}

export function deleteMobileVariant(layout: ScreenLayout): ScreenLayout {
  const { mobile: _gone, ...rest } = layout;
  return rest;
}

/** Patch mobile-only settings (background/aspect/scroll), pruning empties. */
export function patchMobileVariant(layout: ScreenLayout, patch: Partial<ScreenVariant>): ScreenLayout {
  if (!layout.mobile) return layout;
  const next: ScreenVariant = { ...layout.mobile, ...patch };
  if (next.background === undefined || next.background === '') delete next.background;
  if (next.aspect === undefined || next.aspect === null) delete next.aspect;
  if (next.scroll !== true) delete next.scroll;
  return { ...layout, mobile: next };
}

// ---------------------------------------------------------------------------
// Motion (card-flight tuning; layout-level)
// ---------------------------------------------------------------------------

/**
 * Runner defaults (DGT reference timings) — shown as stepper baselines.
 * Numeric fields only: `byTag` (per-move-tag overrides) is def-authored,
 * not stepper-edited, and rides through patchMotion untouched.
 */
export const MOTION_DEFAULTS: Required<Omit<MotionSpec, 'byTag'>> = {
  flightMs: 430, arc: 46, spin: 4, staggerMs: 55,
};

const MOTION_NUMERIC_KEYS = ['flightMs', 'arc', 'spin', 'staggerMs'] as const;

/**
 * Merge a motion patch into the layout. Values matching the runner default
 * aren't stored (the def stays minimal); an all-default spec (with no byTag
 * overrides) removes the `motion` key entirely.
 */
export function patchMotion(layout: ScreenLayout, patch: Partial<MotionSpec>): ScreenLayout {
  const next: MotionSpec = { ...(layout.motion ?? {}), ...patch };
  MOTION_NUMERIC_KEYS.forEach((k) => {
    if (next[k] === undefined || next[k] === MOTION_DEFAULTS[k]) delete next[k];
  });
  if (next.byTag !== undefined && Object.keys(next.byTag).length === 0) delete next.byTag;
  if (Object.keys(next).length === 0) {
    const { motion: _gone, ...rest } = layout;
    return rest;
  }
  return { ...layout, motion: next };
}

// ---------------------------------------------------------------------------
// Element factories ("+ Add" palette drops; centered, sensible defaults)
// ---------------------------------------------------------------------------

export function zoneElement(
  zone: ZoneDef, seat: SeatRef, rect: PlainRect,
  opts?: { cardScale?: number; name?: string },
): ScreenElement {
  return {
    kind: 'zone',
    id: uid('el'),
    name: opts?.name ?? zone.name,
    rect: { ...rect },
    zoneId: zone.id,
    seat: zone.owner === 'shared' ? 'shared' : seat === 'shared' ? 'viewer' : seat,
    cardScale: opts?.cardScale ?? DEFAULT_CARD_SCALE,
    showName: true,
    ...(zone.layout === 'stack' ? { showCount: true } : {}),
  };
}

export function newZoneElement(zone: ZoneDef, seat: SeatRef): ScreenElement {
  return zoneElement(zone, seat, { x: 38, y: 38, w: 24, h: 24 });
}

export function newTextElement(): ScreenElement {
  return {
    kind: 'text', id: uid('el'), name: 'Text',
    rect: { x: 40, y: 45, w: 20, h: 8 },
    text: 'New text', fontSize: 2, align: 'center',
  };
}

/** Null when the def has no shown-able variable (global/perPlayer). */
export function newVarTextElement(def: GameDef): ScreenElement | null {
  const v = def.variables.find((x) => x.scope !== 'perCard');
  if (!v) return null;
  return {
    kind: 'varText', id: uid('el'), name: `${v.name} readout`,
    rect: { x: 40, y: 46, w: 20, h: 6 },
    varId: v.id, seat: 'viewer', label: `${v.name}: `,
    fontSize: 2, align: 'center', bold: true,
  };
}

export function newButtonElement(def: GameDef): ScreenElement {
  const a = def.actions.find((x) => x.target.kind === 'none');
  return {
    kind: 'button', id: uid('el'), name: a ? a.name : 'Button',
    rect: { x: 42, y: 58, w: 16, h: 8 },
    actionId: a ? a.id : PASS_ACTION_ID,
    label: a ? a.name : 'Pass', fontSize: 1.8,
  };
}

/** A standalone shape — default circle with a subtle border; states restyle it. */
export function newShapeElement(): ScreenElement {
  return {
    kind: 'shape', id: uid('el'), name: 'Shape',
    rect: { x: 45, y: 41, w: 10, h: 18 },
    shape: 'circle',
    style: { background: 'transparent', borderColor: 'var(--border-strong)', borderWidth: 2 },
  };
}

/** A connector line (horizontal by default; color = style.borderColor). */
export function newLineElement(): ScreenElement {
  return {
    kind: 'line', id: uid('el'), name: 'Line',
    rect: { x: 40, y: 48, w: 20, h: 4 },
    orient: 'h', thickness: 2,
    style: { borderColor: 'var(--border-strong)' },
  };
}

/**
 * Ready-made phase track (circles + connector lines pre-wired with
 * current/done states), centered near the top. Null when the def has no
 * phases — the palette disables the entry with a hint.
 */
export function newPhaseTrackElement(def: GameDef): ScreenElement | null {
  return phaseTrackGroup(def, { rect: { x: 20, y: 4, w: 60, h: 10 } });
}

/** The chronicle: a scrolling game-log rail with turn separators. */
export function newLogElement(): ScreenElement {
  return {
    kind: 'log', id: uid('el'), name: 'Game log',
    rect: { x: 68, y: 28, w: 30, h: 44 },
    fontSize: 1.3,
  };
}

export function newGroupElement(): ScreenElement {
  return {
    kind: 'group', id: uid('el'), name: 'Group',
    rect: { x: 34, y: 34, w: 32, h: 32 },
    children: [],
  };
}

// ---------------------------------------------------------------------------
// Dynamic text (text element `parts` — announce-style segments)
// ---------------------------------------------------------------------------

type TextElement = Extract<ScreenElement, { kind: 'text' }>;

/**
 * Toggle a text element between static (`text`) and dynamic (`parts`).
 * ON seeds the segments with the static text; OFF drops `parts`, joining
 * all-string segments back into the label (expression segments are lost —
 * the static text keeps its prior value instead).
 */
export function setTextDynamic(el: TextElement, dynamic: boolean): TextElement {
  if (dynamic) {
    if (el.parts) return el;
    return { ...el, parts: [el.text] };
  }
  if (!el.parts) return el;
  const strings = el.parts.filter((p): p is string => typeof p === 'string');
  const allStrings = strings.length === el.parts.length;
  const { parts: _gone, ...rest } = el;
  return {
    ...rest,
    text: allStrings && strings.join('') !== '' ? strings.join('') : el.text,
  };
}

// ---------------------------------------------------------------------------
// Template fields (pile badge picker)
// ---------------------------------------------------------------------------

/** Card-template fields, deduped by id (badge-able values like cost). */
export function templateFieldOptions(def: GameDef): { id: Id; name: string }[] {
  const seen = new Set<Id>();
  const out: { id: Id; name: string }[] = [];
  const multi = def.templates.length > 1;
  for (const t of def.templates) {
    for (const f of t.fields) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      out.push({ id: f.id, name: multi ? `${f.name} (${t.name})` : f.name });
    }
  }
  return out;
}

/**
 * Inline "create a new game zone" from the screen builder (appended to
 * def.zones). The legacy `area` hint mirrors the owner so the automatic
 * layout keeps making sense.
 */
export function makeZoneDef(
  name: string, owner: ZoneDef['owner'], visibility: ZoneVisibility, layout: ZoneLayout,
): ZoneDef {
  return {
    id: uid('zone'),
    name: name.trim() || 'New zone',
    owner,
    visibility,
    layout,
    area: owner === 'perPlayer' ? 'player' : 'center',
  };
}

// ---------------------------------------------------------------------------
// Element states (conditional appearances; FIRST match wins)
// ---------------------------------------------------------------------------

/** Canonical new state: applies while it's the viewer's turn. */
export function newElementState(): ElementState {
  return {
    id: uid('st'),
    name: 'My turn',
    when: {
      kind: 'compare', op: '==',
      left: { kind: 'currentPlayer' },
      right: { kind: 'binding', name: '$viewer' },
    },
  };
}

export function addElementState(el: ScreenElement, state: ElementState): ScreenElement {
  return { ...el, states: [...(el.states ?? []), state] };
}

/** Removes a state; drops the `states` key entirely when none remain. */
export function removeElementState(el: ScreenElement, stateId: Id): ScreenElement {
  const states = (el.states ?? []).filter((s) => s.id !== stateId);
  if (states.length > 0) return { ...el, states };
  const { states: _gone, ...rest } = el;
  return rest as ScreenElement;
}

/** Map `fn` over one state (name/when/style/rect edits). */
export function updateElementState(
  el: ScreenElement, stateId: Id, fn: (s: ElementState) => ElementState,
): ScreenElement {
  const states = el.states ?? [];
  if (!states.some((s) => s.id === stateId)) return el;
  return { ...el, states: states.map((s) => (s.id === stateId ? fn(s) : s)) };
}

/** Swap with the list neighbor — earlier = higher priority (first match wins). */
export function moveElementState(el: ScreenElement, stateId: Id, dir: 'up' | 'down'): ScreenElement {
  const states = el.states ?? [];
  const i = states.findIndex((s) => s.id === stateId);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= states.length) return el;
  const next = states.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return { ...el, states: next };
}

/**
 * The element's look with one state applied (editor canvas preview; mirrors
 * the runner's merge): state style merges over the base, state rect (when
 * set) replaces position/size. Null/unknown state id = base appearance.
 */
export function applyElementState(
  el: ScreenElement, stateId: Id | null,
): { rect: PlainRect; style: LayoutStyle | undefined } {
  const s = stateId === null ? undefined : el.states?.find((x) => x.id === stateId);
  if (!s) return { rect: el.rect, style: el.style };
  return {
    rect: s.rect ?? el.rect,
    style: s.style ? { ...el.style, ...s.style } : el.style,
  };
}

// ---------------------------------------------------------------------------
// Inline variable / action creation (cross-editing without leaving the builder)
// ---------------------------------------------------------------------------

/** Inline "+ New variable" (appended to def.variables by the caller). */
export function makeVariableDef(
  name: string, scope: 'global' | 'perPlayer', type: 'number' | 'string', initial: number | string,
): VariableDef {
  return { ...newVariable(), name: name.trim() || 'New variable', scope, type, initial };
}

/** Inline "+ New action": a none-target button action (script edited in-place). */
export function makeActionDef(name: string): ActionDef {
  return { ...newAction(), name: name.trim() || 'New action' };
}

// ---------------------------------------------------------------------------
// Starter layout (non-destructive "Custom" switch)
// ---------------------------------------------------------------------------

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** `count` rects in one centered row between x = left..right. */
function rowRects(
  count: number, top: number, h: number, left: number, right: number, maxW: number, gap: number,
): PlainRect[] {
  if (count <= 0) return [];
  const span = right - left;
  const w = Math.max(MIN_W, Math.min(maxW, Math.floor((span - (count - 1) * gap) / count)));
  const total = count * w + (count - 1) * gap;
  const x0 = left + Math.max(0, Math.round((span - total) / 2));
  return Array.from({ length: count }, (_, i) => ({ x: x0 + i * (w + gap), y: top, w, h }));
}

/**
 * The starter screen seeded when the author switches to "Custom":
 *   - shared zones in the middle band (rows of up to 4),
 *   - per-player zones: viewer copies along the bottom, compact opp1 copies
 *     along the top,
 *   - a generated phase track top-center (when the def has phases),
 *   - a button for each none-target action (max 2), bottom-right,
 *   - a varText per perPlayer number variable: viewer bottom-left, opp1
 *     top-left.
 */
export function buildStarterLayout(def: GameDef): ScreenLayout {
  const elements: ScreenElement[] = [];
  const shared = def.zones.filter((z) => z.owner === 'shared');
  const perPlayer = def.zones.filter((z) => z.owner === 'perPlayer');

  // Opponent compact band (top).
  rowRects(perPlayer.length, 7, 13, 18, 82, 14, 2).forEach((rect, i) => {
    elements.push(zoneElement(perPlayer[i], 'opp1', rect, {
      cardScale: 4, name: `${perPlayer[i].name} (opponent)`,
    }));
  });

  // Shared zones, middle band (y 26..62), rows of up to 4.
  const rows = chunk(shared, 4);
  if (rows.length > 0) {
    const rowGap = 3;
    const zh = Math.max(MIN_H, Math.min(30, Math.floor((36 - (rows.length - 1) * rowGap) / rows.length)));
    const blockH = rows.length * zh + (rows.length - 1) * rowGap;
    const startY = 26 + Math.max(0, Math.round((36 - blockH) / 2));
    rows.forEach((row, r) => {
      rowRects(row.length, startY + r * (zh + rowGap), zh, 3, 97, 20, 3).forEach((rect, c) => {
        elements.push(zoneElement(row[c], 'shared', rect));
      });
    });
  }

  // Viewer band (bottom); x 20..84 leaves room for readouts and buttons.
  rowRects(perPlayer.length, 70, 25, 20, 84, 26, 2).forEach((rect, i) => {
    elements.push(zoneElement(perPlayer[i], 'viewer', rect, { cardScale: 9 }));
  });

  // Phase track, top-center (generated circles + lines with phase logic).
  const track = phaseTrackGroup(def, { rect: { x: 20, y: 1, w: 60, h: 6 } });
  if (track) elements.push(track);

  // End-turn-style buttons, bottom-right (max 2).
  def.actions.filter((a) => a.target.kind === 'none').slice(0, 2).forEach((a, i) => {
    elements.push({
      kind: 'button', id: uid('el'), name: a.name, actionId: a.id, label: a.name,
      rect: { x: 85, y: 89 - i * 9, w: 13, h: 7 }, fontSize: 1.8,
    });
  });

  // Per-player number readouts: viewer bottom-left, opp1 top-left.
  def.variables
    .filter((v) => v.scope === 'perPlayer' && v.type === 'number')
    .forEach((v, i) => {
      const common = {
        kind: 'varText' as const, varId: v.id, label: `${v.name}: `,
        fontSize: 1.8, align: 'left' as const, bold: true,
      };
      elements.push({
        ...common, id: uid('el'), name: `${v.name} (you)`, seat: 'viewer',
        rect: { x: 2, y: 95 - i * 4.5, w: 16, h: 4 },
      });
      elements.push({
        ...common, id: uid('el'), name: `${v.name} (opponent)`, seat: 'opp1',
        rect: { x: 2, y: 1 + i * 4.5, w: 16, h: 4 },
      });
    });

  return { aspect: 16 / 9, elements };
}

// ---------------------------------------------------------------------------
// Deck composition helpers (carried over from v3)
// ---------------------------------------------------------------------------

/** Inline "Create deck here" factory: an empty custom deck spawning in `zoneId`. */
export function newCustomDeckAt(zoneName: string, zoneId: Id): DeckDef {
  return {
    id: uid('deck'),
    name: `${zoneName} deck`,
    source: { kind: 'custom', entries: [] },
    initialZone: zoneId,
    shuffle: true,
  };
}

/** Cards a deck spawns (standard52 minus exclusions plus jokers / entry sum). */
export function deckCardCount(deck: DeckDef): number {
  if (deck.source.kind === 'standard52') {
    const excluded = (deck.source.excludeRanks ?? []).length;
    return Math.max(0, (13 - excluded) * 4) + (deck.source.jokers ?? 0);
  }
  return deck.source.entries.reduce((sum, e) => sum + e.count, 0);
}

/** Sample card count for a zone's editor preview (decks spawning there). */
export function zoneSampleCount(def: GameDef, zoneId: Id): number {
  return def.decks.filter((d) => d.initialZone === zoneId).reduce((s, d) => s + deckCardCount(d), 0);
}

// ---------------------------------------------------------------------------
// Live preview (sample-state) resolution — RUNNER PARITY. The canvas preview
// resolves elements against the headless sample snapshot (sampleState.ts)
// exactly like ScreenRenderer: elementRenders' dangling-ref/seat checks plus
// the `visible` display expression, $viewer bound to the sample's seat 0.
// ---------------------------------------------------------------------------

/**
 * Whether the runner would paint this element for `viewerId` in `state`:
 * false for dangling zone/variable refs, a perPlayer element on seat
 * 'shared', a seat beyond the sample's player count (opp2/opp3 in the
 * 2-seat sample), and any falsy `visible` expression. Mirrors
 * ScreenRenderer's elementRenders + isDisplayVisible pair.
 */
export function previewElementVisible(
  def: GameDef, state: GameState, el: ScreenElement, viewerId: Id,
): boolean {
  const playerIds = state.players.map((p) => p.id);
  if (el.kind === 'zone') {
    const zone = def.zones.find((z) => z.id === el.zoneId);
    if (!zone) return false;
    if (zone.owner !== 'shared') {
      if (el.seat === 'shared') return false;
      if (resolveSeat(playerIds, viewerId, el.seat, state.currentPlayerIdx) === null) return false;
    }
  } else if (el.kind === 'varText') {
    const vd = def.variables.find((v) => v.id === el.varId);
    if (!vd || vd.scope === 'perCard') return false;
    if (vd.scope === 'perPlayer') {
      if (el.seat === 'shared') return false;
      if (resolveSeat(playerIds, viewerId, el.seat, state.currentPlayerIdx) === null) return false;
    }
  }
  return isDisplayVisible(def, state, el.visible ?? null, viewerId);
}

/** One pile of a zone element's preview (real cards, grouped by identity). */
export interface ZonePreviewPile {
  name: string;
  count: number;
  /** The pileBadgeField's value on the pile's top card ('' = no badge). */
  badge: string;
}

export interface ZonePreview {
  /** Cards the element shows (cardFilter slice applied, like the runner). */
  count: number;
  /** Piles for 'piles'/'carousel' displays and collapseDuplicates; else null. */
  piles: ZonePreviewPile[] | null;
}

/**
 * Selector buttons (role 'selector' with a group) of one variant tree, in
 * paint order, with their labels — the "Show only for" picker's option list.
 */
export function selectorButtonOptions(
  elements: ScreenElement[],
): { id: Id; label: string; group: string }[] {
  const out: { id: Id; label: string; group: string }[] = [];
  const walk = (els: ScreenElement[]) => {
    for (const el of els) {
      if (el.kind === 'button' && el.role === 'selector') {
        const group = (el.selectorGroup ?? '').trim();
        if (group !== '') out.push({ id: el.id, label: el.label || el.name, group });
      }
      if (el.children) walk(el.children);
    }
  };
  walk(elements);
  return out;
}

/**
 * The preview's "shown under selection" map: previewElementVisible AND the
 * element's showForSelector gate for every element of `index`. Gates resolve
 * against the FULL variant tree with the active button per group picked as:
 *   1. the first selector button in the EDITOR's current selection (`sel`) —
 *      clicking a selector button on the canvas selects it, which switches
 *      its group live;
 *   2. else the device's persisted selection store (the same store the
 *      runner reads; PropertiesPanel writes it whenever a selector button is
 *      selected, so canvas switches stick);
 *   3. else the first button of the group in paint order (runner default).
 */
export function previewShownMap(
  def: GameDef,
  state: GameState,
  index: Map<Id, ElInfo>,
  fullElements: ScreenElement[],
  viewerId: Id,
  sel: readonly Id[],
): Map<Id, boolean> {
  const groupByButton = new Map<Id, string>();
  for (const b of selectorButtons(fullElements)) groupByButton.set(b.id, b.group);
  const override = new Map<string, Id>();
  for (const id of sel) {
    const group = groupByButton.get(id);
    if (group !== undefined && !override.has(group)) override.set(group, id);
  }
  const selCtx = selectorContextFrom(
    fullElements,
    (group) => override.get(group) ?? readSelection(def.meta.id, group),
  );
  const out = new Map<Id, boolean>();
  for (const [id, info] of index) {
    out.set(
      id,
      previewElementVisible(def, state, info.el, viewerId) && selectorGateOpen(selCtx, info.el),
    );
  }
  return out;
}

/**
 * Ids currently HIDDEN by a closed selector gate — the element's own
 * `showForSelector` gate, or any ancestor's — resolved exactly like
 * previewShownMap (editor `sel` override, else the persisted store, else the
 * group's first button). No sample state: this is pure selector logic, so it
 * holds whether the live preview is on or off.
 *
 * Drop-to-join uses it to REFUSE re-nesting a dragged element into a panel that
 * isn't on screen. The Dominion supply stacks its Treasury/Victory/Kingdom
 * panels at one rect; without this, dropping a pile inside the visible panel
 * resolves (on a depth+area tie) to a HIDDEN sibling panel, and the pile —
 * keeping its own `showForSelector` under a differently-gated parent — can then
 * never satisfy both gates and vanishes. You can only drop into what you see.
 */
export function selectorHiddenIds(
  def: GameDef,
  fullElements: ScreenElement[],
  sel: readonly Id[],
): Set<Id> {
  const groupByButton = new Map<Id, string>();
  for (const b of selectorButtons(fullElements)) groupByButton.set(b.id, b.group);
  const override = new Map<string, Id>();
  for (const id of sel) {
    const group = groupByButton.get(id);
    if (group !== undefined && !override.has(group)) override.set(group, id);
  }
  const selCtx = selectorContextFrom(
    fullElements,
    (group) => override.get(group) ?? readSelection(def.meta.id, group),
  );
  // Index the WHOLE tree, not a focused subtree: the ancestor-gate walk below
  // must reach gates ABOVE the drag's editing scope (in focus mode the canvas
  // indexes only the focused element's children, which would hide those gates).
  const index = indexElements(fullElements);
  const ownClosed = new Set<Id>();
  for (const [id, info] of index) {
    if (!selectorGateOpen(selCtx, info.el)) ownClosed.add(id);
  }
  const hidden = new Set<Id>();
  for (const id of index.keys()) {
    let cur: Id | null = id;
    while (cur !== null) {
      if (ownClosed.has(cur)) { hidden.add(id); break; }
      cur = index.get(cur)?.parentId ?? null;
    }
  }
  return hidden;
}

/** True when `r`'s center lies within `box` (drop-parent containment test). */
export function centerInside(r: PlainRect, box: PlainRect): boolean {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  return cx >= box.x && cx <= box.x + box.w && cy >= box.y && cy <= box.y + box.h;
}

/**
 * The drop parent for a single moved element on release:
 *   - `undefined` — keep the current parent (a plain move; no re-nest).
 *   - `null`      — the screen root (the element was dragged clear of its group).
 *   - an `Id`     — join that (visible) group.
 * A drop onto the element's own parent is a plain move. A null hover (no VISIBLE
 * group under the pointer) leaves to the root ONLY if the element was actually
 * dragged out of its parent's box; a null over the parent's own area — e.g. a
 * hidden stacked sibling panel filling that space — keeps the parent, so the
 * element never silently jumps to the root.
 */
export function resolveDropParent(opts: {
  reparentable: boolean;
  hoverGroupId: Id | null;
  origParentId: Id | null;
  primaryRect: PlainRect | undefined;
  origParentAbs: PlainRect | undefined;
}): Id | null | undefined {
  const { reparentable, hoverGroupId, origParentId, primaryRect, origParentAbs } = opts;
  if (!reparentable) return undefined;
  if (hoverGroupId === origParentId) return undefined;
  if (hoverGroupId === null) {
    if (primaryRect && origParentAbs && centerInside(primaryRect, origParentAbs)) return undefined;
    return null;
  }
  return hoverGroupId;
}

/**
 * The REAL contents a zone element shows in the sample state: the resolved
 * zone instance's cards (viewer-relative seat, cardFilter display slice) and
 * — where the element groups by identity — its piles. Null when the runner
 * would render nothing (dangling zone, unresolvable seat, missing instance).
 */
export function zonePreview(
  def: GameDef,
  state: GameState,
  el: Extract<ScreenElement, { kind: 'zone' }>,
  viewerId: Id,
): ZonePreview | null {
  const zone = def.zones.find((z) => z.id === el.zoneId);
  if (!zone) return null;
  let ownerId: Id | null = null;
  if (zone.owner !== 'shared') {
    if (el.seat === 'shared') return null;
    ownerId = resolveSeat(state.players.map((p) => p.id), viewerId, el.seat, state.currentPlayerIdx);
    if (ownerId === null) return null;
  }
  const inst = state.zones[zoneInstKey(zone.id, ownerId)];
  if (!inst) return null;
  const ids = el.cardFilter != null
    ? filterDisplayCards(def, state, inst.cardIds, el.cardFilter, viewerId)
    : [...inst.cardIds];
  const grouped = el.display === 'piles' || el.display === 'carousel'
    || el.collapseDuplicates === true;
  const piles = grouped
    ? groupPiles(ids, state.cards).map((p) => {
        const top = state.cards[p.topId];
        const badge = el.pileBadgeField != null ? top?.fields[el.pileBadgeField] : undefined;
        return {
          name: top?.name ?? '',
          count: p.count,
          badge: badge === undefined || badge === '' ? '' : String(badge),
        };
      })
    : null;
  return { count: ids.length, piles };
}
