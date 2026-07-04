/**
 * Pure geometry/style helpers for authored screen layouts (def.screenLayout),
 * shared between the RUNNER (real rendering) and the SCREEN BUILDER's canvas
 * preview so the two can never drift. No React.
 *
 * Conventions:
 *   - Element rects are % (0-100) of their PARENT (the screen or a group).
 *     Group children are stored relative to the group's rect; the conversion
 *     helpers translate both ways (used by group/ungroup and previews).
 *   - padding/gap/cardScale/fontSize are % of the SCREEN's width; px
 *     conversion takes the measured stage width.
 *   - Paint order (z) is array order — no explicit z-index needed.
 *   - Seat refs resolve relative to the viewer in seating order.
 *   - Element STATES resolve here too (resolveElementAppearance): the first
 *     state whose `when` holds picks the rect/style the element shows.
 */
import type {
  Expr, GameDef, GameState, Id, LayoutStyle, MotionSpec, ScreenElement, ScreenLayout, SeatRef,
  ShapeKind,
} from '../shared/types';
import { isDisplayVisible } from '../engine';

export interface PlainRect { x: number; y: number; w: number; h: number }

// ---------------------------------------------------------------------------
// Parent-relative <-> absolute rect conversion (groups)
// ---------------------------------------------------------------------------

/** A rect stored as % of `parent` -> % of the parent's own container. */
export function groupRelToAbs(rel: PlainRect, parent: PlainRect): PlainRect {
  return {
    x: parent.x + (rel.x / 100) * parent.w,
    y: parent.y + (rel.y / 100) * parent.h,
    w: (rel.w / 100) * parent.w,
    h: (rel.h / 100) * parent.h,
  };
}

/** An absolute rect -> % of `parent` (inverse of groupRelToAbs). */
export function absToGroupRel(abs: PlainRect, parent: PlainRect): PlainRect {
  const gw = Math.max(0.0001, parent.w);
  const gh = Math.max(0.0001, parent.h);
  return {
    x: ((abs.x - parent.x) / gw) * 100,
    y: ((abs.y - parent.y) / gh) * 100,
    w: (abs.w / gw) * 100,
    h: (abs.h / gh) * 100,
  };
}

/** True when `inner` lies fully inside `outer` (edges may touch). */
export function rectContains(outer: PlainRect, inner: PlainRect): boolean {
  return inner.x >= outer.x && inner.y >= outer.y
    && inner.x + inner.w <= outer.x + outer.w
    && inner.y + inner.h <= outer.y + outer.h;
}

// ---------------------------------------------------------------------------
// Seat resolution (viewer-relative)
// ---------------------------------------------------------------------------

/**
 * Seats after the viewer for 'oppN', 0 for 'viewer'; null for 'shared' AND
 * for 'current' (which has no fixed viewer offset — it follows the turn).
 */
export function seatOffset(seat: SeatRef): number | null {
  switch (seat) {
    case 'viewer': return 0;
    case 'opp1': return 1;
    case 'opp2': return 2;
    case 'opp3': return 3;
    case 'shared': return null;
    case 'current': return null;
  }
}

/**
 * The player a seat ref shows, relative to `viewerId` in seating order
 * (wrapping past the last seat). 'current' ignores the viewer entirely and
 * rebinds to the acting turn's seat (`currentIdx` = state.currentPlayerIdx),
 * so an element bound to it follows the mover. Returns null when the ref is
 * 'shared' or the seat exceeds the player count (the element should render
 * nothing). A viewer not seated at the table (spectator) watches from seat
 * 0's perspective.
 */
export function resolveSeat(
  playerIds: readonly Id[],
  viewerId: Id,
  seat: SeatRef,
  currentIdx: number,
): Id | null {
  if (seat === 'current') return playerIds[currentIdx] ?? null;
  const off = seatOffset(seat);
  if (off === null || off >= playerIds.length) return null;
  const vi = Math.max(0, playerIds.indexOf(viewerId));
  return playerIds[(vi + off) % playerIds.length];
}

// ---------------------------------------------------------------------------
// Element states -> current appearance
// ---------------------------------------------------------------------------

/** What an element currently looks like after its states are resolved. */
export interface ElementAppearance {
  /** % of the parent — the matched state's rect, else the element's own. */
  rect: PlainRect;
  /** The matched state's style merged over the base style. */
  style: LayoutStyle | undefined;
  /** Id of the state that matched; null = base appearance (no match). */
  stateId: Id | null;
}

/**
 * Resolve which appearance a screen element currently shows: walk `states`
 * top-down and apply the FIRST whose `when` is truthy (display evaluation
 * with `$viewer` bound to viewerId — same binding as `visible`). The matched
 * state's style merges OVER the base style; its rect (when set) replaces the
 * base rect. No states / no match = the base appearance. Pure: evaluate once
 * per engine snapshot, never per animation frame.
 */
export function resolveElementAppearance(
  def: GameDef,
  state: GameState,
  el: ScreenElement,
  viewerId: Id,
): ElementAppearance {
  for (const st of el.states ?? []) {
    if (!isDisplayVisible(def, state, st.when, viewerId)) continue;
    return {
      rect: st.rect ?? el.rect,
      style: st.style ? { ...el.style, ...st.style } : el.style,
      stateId: st.id,
    };
  }
  return { rect: el.rect, style: el.style, stateId: null };
}

// ---------------------------------------------------------------------------
// Shape & line geometry
// ---------------------------------------------------------------------------

/** Polygon shapes drawn by clipping / SVG (0-100 viewBox vertices). */
const SHAPE_POLYGONS: Partial<Record<ShapeKind, string>> = {
  diamond: '50,0 100,50 50,100 0,50',
  hexagon: '25,0 75,0 100,50 75,100 25,100 0,50',
  star: '50,2 61,38 98,38 68,60 79,96 50,74 21,96 32,60 2,38 39,38',
};

export const SHAPE_KINDS: ShapeKind[] = [
  'rect', 'rounded', 'pill', 'circle', 'diamond', 'hexagon', 'star',
];

/** SVG polygon `points` for polygon shapes (diamond/hexagon/star); else null. */
export function shapePolygon(shape: ShapeKind): string | null {
  return SHAPE_POLYGONS[shape] ?? null;
}

/** A CSS clip-path polygon(...) for polygon shapes; null for radius shapes. */
export function shapeClipPath(shape: ShapeKind): string | null {
  const pts = SHAPE_POLYGONS[shape];
  if (!pts) return null;
  const poly = pts.split(' ').map((p) => {
    const [x, y] = p.split(',');
    return `${x}% ${y}%`;
  }).join(', ');
  return `polygon(${poly})`;
}

/**
 * Corner rounding for a radius shape: circles/pills round themselves, rounded
 * takes a soft preset, plain rects keep the authored style radius. Polygon
 * shapes (diamond/hexagon/star) draw their own geometry — no CSS radius.
 */
export function shapeBorderRadius(
  shape: ShapeKind,
  style: LayoutStyle | undefined,
): string | undefined {
  switch (shape) {
    case 'circle': return '50%';
    case 'pill': return '9999px';
    case 'rounded': return '16px';
    case 'diamond':
    case 'hexagon':
    case 'star':
      return undefined;
    case 'rect':
    default:
      return style?.borderRadius !== undefined ? `${style.borderRadius}px` : undefined;
  }
}

export type LineOrient = 'h' | 'v' | 'down' | 'up';

export interface LineEndpoints { x1: number; y1: number; x2: number; y2: number }

/**
 * Endpoints of a line element inside its rect, in % of the rect:
 * 'h'/'v' run across the middle, 'down' = TL→BR, 'up' = BL→TR.
 */
export function lineEndpoints(orient: LineOrient): LineEndpoints {
  switch (orient) {
    case 'h': return { x1: 0, y1: 50, x2: 100, y2: 50 };
    case 'v': return { x1: 50, y1: 0, x2: 50, y2: 100 };
    case 'down': return { x1: 0, y1: 0, x2: 100, y2: 100 };
    case 'up': return { x1: 0, y1: 100, x2: 100, y2: 0 };
  }
}

/** Stroke color for a line element (style.borderColor, falling back to the token). */
export function lineColor(style: LayoutStyle | undefined): string {
  return style?.borderColor ?? 'var(--border-strong)';
}

// ---------------------------------------------------------------------------
// Style -> CSS
// ---------------------------------------------------------------------------

/** Subset of CSSProperties we produce (kept React-free for pure tests). */
export interface FrameCss {
  background?: string;
  border?: string;
  borderRadius?: string;
  opacity?: number;
  boxShadow?: string;
}

/** One ShadowSpec -> a CSS box-shadow layer. */
export function shadowCss(sh: { x: number; y: number; blur: number; spread?: number; color: string; inset?: boolean }): string {
  const inset = sh.inset ? 'inset ' : '';
  return `${inset}${sh.x}px ${sh.y}px ${sh.blur}px ${sh.spread ?? 0}px ${sh.color}`;
}

/**
 * Authored LayoutStyle -> inline CSS. Only authored properties are emitted,
 * so defaults (the runner's dashed zone chrome, the editor's item chrome)
 * survive untouched until the author overrides them. borderWidth 0 emits
 * 'none' so authors can explicitly remove default chrome. Per-corner radius
 * overrides the uniform one; opacity and box-shadows pass straight through.
 */
export function layoutStyleCss(style: LayoutStyle | undefined): FrameCss {
  const css: FrameCss = {};
  if (!style) return css;
  if (style.background) css.background = style.background;
  const hasBorder = style.borderWidth !== undefined || style.borderColor !== undefined
    || style.borderStyle !== undefined;
  if (hasBorder) {
    const width = style.borderWidth ?? 1;
    css.border = width <= 0
      ? 'none'
      : `${width}px ${style.borderStyle ?? 'solid'} ${style.borderColor ?? 'rgba(255,255,255,0.35)'}`;
  }
  if (style.borderRadii !== undefined) {
    css.borderRadius = style.borderRadii.map((r) => `${r}px`).join(' ');
  } else if (style.borderRadius !== undefined) {
    css.borderRadius = `${style.borderRadius}px`;
  }
  if (style.opacity !== undefined) css.opacity = style.opacity;
  if (style.shadows !== undefined && style.shadows.length > 0) {
    css.boxShadow = style.shadows.map(shadowCss).join(', ');
  }
  return css;
}

// ---------------------------------------------------------------------------
// Spacing (% of screen width -> px)
// ---------------------------------------------------------------------------

/** % of the screen's width -> px (rounded; undefined passes through). */
export function pctToPx(screenW: number, pct: number | undefined): number | undefined {
  return pct === undefined ? undefined : Math.round((screenW * pct) / 100);
}

/**
 * Fan layouts overlap successive cards. An authored `gap` means "how much of
 * each covered card stays visible": successive card LEFT edges sit gap px
 * apart, i.e. margin-left = gap - cardWidth (negative = overlap).
 * Undefined gap = keep the renderer's default overlap.
 */
export function fanMarginPx(cardW: number, gapPx: number | undefined): number | undefined {
  return gapPx === undefined ? undefined : Math.round(gapPx - cardW);
}

/** Fixed-count grid template (undefined when the count is unset/invalid). */
export function gridTemplate(count: number | null | undefined): string | undefined {
  if (count == null || count < 1) return undefined;
  return `repeat(${Math.round(count)}, max-content)`;
}

/**
 * Authored rows × columns -> CSS grid templates. Columns fix the column
 * count (cards fill row by row); rows WITHOUT columns flow column-major so
 * "rows: 2" really shows 2 rows. Null when neither is authored (auto grid).
 */
export interface GridSpec {
  columns?: string;
  rows?: string;
  autoFlow?: 'column';
}

export function gridSpec(
  rows: number | null | undefined,
  columns: number | null | undefined,
): GridSpec | null {
  const c = gridTemplate(columns);
  const r = gridTemplate(rows);
  if (c === undefined && r === undefined) return null;
  const spec: GridSpec = {};
  if (c !== undefined) spec.columns = c;
  if (r !== undefined) spec.rows = r;
  if (c === undefined && r !== undefined) spec.autoFlow = 'column';
  return spec;
}

/**
 * How many card slots of `cardW` fit in `spanPx` with `gapPx` spacing
 * (>= 1 so empty zones still preview one slot; capped by `max`).
 */
export function fitCount(spanPx: number, cardW: number, gapPx: number, max = 8): number {
  if (cardW <= 0) return 1;
  const n = Math.floor((spanPx + gapPx) / (cardW + gapPx));
  return Math.max(1, Math.min(max, n));
}

// ---------------------------------------------------------------------------
// Display-only card filters (zone element cardFilter)
// ---------------------------------------------------------------------------

/**
 * A copy of `expr` with every `$card` binding replaced by the card instance
 * id as a string literal (card refs ARE ids), so display evaluation — which
 * only binds `$viewer` — can run a per-candidate filter client-side.
 */
export function bindCardExpr(expr: Expr, cardId: Id): Expr {
  const sub = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(sub);
    if (node !== null && typeof node === 'object') {
      const rec = node as Record<string, unknown>;
      if (rec.kind === 'binding' && rec.name === '$card') {
        return { kind: 'str', value: cardId };
      }
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rec)) out[k] = sub(v);
      return out;
    }
    return node;
  };
  return sub(expr) as Expr;
}

/**
 * The display slice of a zone's cards: ids whose `filter` ($card bound per
 * candidate, $viewer bound) is truthy. Null/absent filter keeps everything.
 * Display-only — game logic always sees the whole zone.
 */
export function filterDisplayCards(
  def: GameDef,
  state: GameState,
  cardIds: readonly Id[],
  filter: Expr | null | undefined,
  viewerId: Id,
): Id[] {
  if (filter == null) return [...cardIds];
  return cardIds.filter((id) => isDisplayVisible(def, state, bindCardExpr(filter, id), viewerId));
}

// ---------------------------------------------------------------------------
// Pile / duplicate grouping ('piles' display, collapseDuplicates)
// ---------------------------------------------------------------------------

/** The card facts grouping needs (CardInstance satisfies this). */
export interface PileCardLike {
  defId: Id | null;
  name: string;
}

/** One pile of same-identity cards inside a zone. */
export interface CardPile {
  /** Identity key: the card's defId, or `std:<name>` for standard cards. */
  key: string;
  /** Member instance ids in zone order (bottom → top). */
  cardIds: Id[];
  /** The pile's face: its TOP (last) member. */
  topId: Id;
  count: number;
  /** Count-0 placeholders only: the facing REMEMBERED from when the pile was
   *  last live — stable while the departed copy wanders through other zones.
   *  Live piles omit it (the renderer resolves facing per snapshot). */
  faceUp?: boolean;
}

/** Grouping identity: custom cards by def, standard cards by name. */
export function cardIdentity(card: PileCardLike): string {
  return card.defId ?? `std:${card.name}`;
}

/**
 * Group a zone's (already display-sliced) cards into piles by card identity,
 * in order of first appearance (bottom → top). Ids without a card instance
 * are skipped. Used by the 'piles' display AND collapseDuplicates.
 */
export function groupPiles(
  cardIds: readonly Id[],
  cards: Readonly<Record<Id, PileCardLike>>,
): CardPile[] {
  const byKey = new Map<string, CardPile>();
  for (const id of cardIds) {
    const card = cards[id];
    if (!card) continue;
    const key = cardIdentity(card);
    const pile = byKey.get(key);
    if (pile) {
      pile.cardIds.push(id);
      pile.topId = id;
      pile.count += 1;
    } else {
      byKey.set(key, { key, cardIds: [id], topId: id, count: 1 });
    }
  }
  return [...byKey.values()];
}

/** What the depleted-pile memory keeps per identity: the last-seen top card
 *  and its facing while the pile was still live (the placeholder's face). */
export interface PileMemoryEntry {
  topId: Id;
  faceUp: boolean;
}

/**
 * groupPiles + a session memory of pile identities: live piles refresh
 * `memory` (identity key -> last-seen top card id + facing; insertion order
 * = first appearance), and identities remembered from earlier whose cards
 * have ALL left the zone come back as count-0 placeholder piles — so a
 * depleted supply pile grays out in place (.rn-pile-empty) instead of
 * vanishing. Output order = memory insertion order (first appearance, stable
 * across depletion and refill); brand-new identities append in zone order.
 *
 * `zoneCardIds` is the UNFILTERED zone contents when `cardIds` is a display
 * slice (cardFilter): an identity still present in the zone but filtered out
 * of the slice is OMITTED (and stays remembered) — filtered ≠ depleted.
 *
 * `faceUp` resolves a live top card's facing (viewer-bound); the memory
 * snapshots it so a placeholder's face stays STABLE after depletion instead
 * of re-resolving against wherever the departed copy currently sits.
 *
 * The caller owns `memory` (a per-ELEMENT ref map in the VIEW layer — one
 * per rendering screen element, so slices of a shared zone never ghost each
 * other's depleted piles; never engine state, never persisted); this helper
 * mutates it.
 */
export function groupPilesRemembered(
  cardIds: readonly Id[],
  cards: Readonly<Record<Id, PileCardLike>>,
  memory: Map<string, PileMemoryEntry>,
  zoneCardIds: readonly Id[] = cardIds,
  faceUp: (id: Id) => boolean = () => true,
): CardPile[] {
  const live = new Map(groupPiles(cardIds, cards).map((p) => [p.key, p]));
  for (const p of live.values()) memory.set(p.key, { topId: p.topId, faceUp: faceUp(p.topId) });
  // Identities still physically in the zone (display-filtered, not depleted).
  const present = new Set<string>();
  if (zoneCardIds !== cardIds) {
    for (const id of zoneCardIds) {
      const card = cards[id];
      if (card) present.add(cardIdentity(card));
    }
  }
  const out: CardPile[] = [];
  for (const [key, mem] of memory) {
    const pile = live.get(key);
    if (pile) out.push(pile);
    else if (!present.has(key)) {
      out.push({ key, cardIds: [], topId: mem.topId, count: 0, faceUp: mem.faceUp });
    }
  }
  return out;
}

/**
 * The TOPMOST member with a legal move — what tapping the pile performs.
 * Null when no member is currently a legal target.
 */
export function topLegalCard(cardIds: readonly Id[], hasMoves: (id: Id) => boolean): Id | null {
  for (let i = cardIds.length - 1; i >= 0; i -= 1) {
    if (hasMoves(cardIds[i])) return cardIds[i];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fan geometry (per-card rotation + parabolic dip)
// ---------------------------------------------------------------------------

/** Degrees of rotation per card step when the element doesn't author one. */
export const DEFAULT_FAN_ANGLE = 4;

export interface FanTransform {
  /** Rotation in degrees (negative = left of center). */
  rot: number;
  /** Downward dip in px (parabolic: 0 at center, growing to the edges). */
  dy: number;
}

/**
 * Per-card fan transform from the centered index (i − (n−1)/2): rotation of
 * `fanAngle`° per step (default 4) and a parabolic dip scaled to the card
 * width. fanAngle 0 = flat (no rotation, no dip).
 */
export function fanTransform(
  index: number,
  count: number,
  cardW: number,
  fanAngle?: number,
): FanTransform {
  const angle = fanAngle ?? DEFAULT_FAN_ANGLE;
  if (angle === 0 || count < 2) return { rot: 0, dy: 0 };
  const c = index - (count - 1) / 2;
  return {
    rot: c * angle,
    dy: c * c * cardW * 0.0045 * angle,
  };
}

// ---------------------------------------------------------------------------
// Motion spec + speed control
// ---------------------------------------------------------------------------

/** The reference easing used by flights and one-shots (ease-out-expo). */
export const EASE_OUT_EXPO = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** One flight's worth of tuning numbers (the base, or one tag's override). */
export interface FlightTuning {
  flightMs: number;
  arc: number;
  spin: number;
  staggerMs: number;
}

/** Authored spec resolved: base numbers plus the per-move-tag override table. */
export interface ResolvedMotion extends FlightTuning {
  /** Per-tag overrides; absent when the spec authored none. */
  byTag?: Readonly<Record<string, Partial<FlightTuning>>>;
}

/** Card-flight defaults (the reference primitive). */
export const MOTION_DEFAULTS: FlightTuning = { flightMs: 430, arc: 46, spin: 4, staggerMs: 55 };

/** Flight overrides for cards arriving in a burn zone. */
export const BURN_FLIGHT = { flightMs: 420, arc: 70, spin: 6 } as const;

/** In-place char choreography length after a burn flight lands. */
export const BURN_CHAR_MS = 620;

/** Authored motion spec merged over the defaults. */
export function resolveMotion(spec: MotionSpec | null | undefined): ResolvedMotion {
  const base: ResolvedMotion = {
    flightMs: spec?.flightMs ?? MOTION_DEFAULTS.flightMs,
    arc: spec?.arc ?? MOTION_DEFAULTS.arc,
    spin: spec?.spin ?? MOTION_DEFAULTS.spin,
    staggerMs: spec?.staggerMs ?? MOTION_DEFAULTS.staggerMs,
  };
  return spec?.byTag !== undefined ? { ...base, byTag: spec.byTag } : base;
}

/**
 * Flight numbers for one move-cause tag: the tag's byTag entry overrides the
 * base numbers field-by-field (draw 300/22, play 320/38, …); an untagged move
 * or an unlisted tag keeps the base.
 */
export function motionForTag(m: ResolvedMotion, tag: string | null | undefined): FlightTuning {
  const over = tag != null ? m.byTag?.[tag] : undefined;
  if (over === undefined) return m;
  return {
    flightMs: over.flightMs ?? m.flightMs,
    arc: over.arc ?? m.arc,
    spin: over.spin ?? m.spin,
    staggerMs: over.staggerMs ?? m.staggerMs,
  };
}

/** Runner animation speed: 1× / 2× (durations ÷ 1.9) / instant (skip clones). */
export type SpeedSetting = '1x' | '2x' | 'instant';

/** Sanitize a persisted value back into a SpeedSetting (default 1×). */
export function asSpeed(v: unknown): SpeedSetting {
  return v === '2x' || v === 'instant' ? v : '1x';
}

/** The next setting the status-bar toggle cycles to. */
export function nextSpeed(s: SpeedSetting): SpeedSetting {
  return s === '1x' ? '2x' : s === '2x' ? 'instant' : '1x';
}

/**
 * Duration multiplier for a speed setting: 1× = 1, 2× = 1/1.9, instant = 0
 * (callers skip clones entirely instead of animating 0ms).
 */
export function speedFactor(s: SpeedSetting): number {
  return s === '1x' ? 1 : s === '2x' ? 1 / 1.9 : 0;
}

/** Scale an animation duration/delay by the speed factor (rounded). */
export function scaleMs(ms: number, factor: number): number {
  return Math.round(ms * factor);
}

// ---------------------------------------------------------------------------
// Screen variants (desktop / mobile) + stage geometry
// ---------------------------------------------------------------------------

/** The element tree + chrome the runner actually shows for one viewport. */
export interface ActiveScreen {
  variant: 'desktop' | 'mobile';
  elements: ScreenElement[];
  background?: string;
  aspect: number | null;
  /** True = a tall vertically-scrolling page (mobile scroll + aspect). */
  scroll: boolean;
}

/**
 * Pick the layout tree for the current viewport: the mobile variant renders
 * below 1024px when authored (background falls back to the desktop's; aspect
 * and scroll are the variant's own), else the desktop tree. Scroll only
 * engages with a positive numeric aspect (the page needs a height).
 */
export function activeScreenVariant(layout: ScreenLayout, narrow: boolean): ActiveScreen {
  const mobile = layout.mobile ?? null;
  if (narrow && mobile) {
    const aspect = mobile.aspect ?? null;
    return {
      variant: 'mobile',
      elements: mobile.elements,
      background: mobile.background ?? layout.background,
      aspect,
      scroll: mobile.scroll === true && aspect !== null && aspect > 0,
    };
  }
  return {
    variant: 'desktop',
    elements: layout.elements,
    background: layout.background,
    aspect: layout.aspect ?? null,
    scroll: false,
  };
}

/** Where the stage sits inside the measured table area. */
export interface StageBox {
  left: number;
  top: number;
  w: number;
  h: number;
  /** The stage is a tall in-flow page; the area scrolls vertically. */
  scrollable: boolean;
}

/**
 * Stage geometry: scroll pages span the full width and derive their height
 * from the aspect (w / aspect — usually taller than the viewport); a numeric
 * aspect letterboxes a centered stage; null fills the area.
 */
export function computeStage(
  areaW: number,
  areaH: number,
  aspect: number | null,
  scroll: boolean,
): StageBox {
  if (areaW <= 0 || areaH <= 0) return { left: 0, top: 0, w: 0, h: 0, scrollable: false };
  if (scroll && aspect !== null && aspect > 0) {
    return { left: 0, top: 0, w: areaW, h: Math.round(areaW / aspect), scrollable: true };
  }
  if (aspect !== null && aspect > 0) {
    const w = Math.min(areaW, areaH * aspect);
    const h = w / aspect;
    return {
      left: Math.round((areaW - w) / 2),
      top: Math.round((areaH - h) / 2),
      w: Math.round(w),
      h: Math.round(h),
      scrollable: false,
    };
  }
  return { left: 0, top: 0, w: areaW, h: areaH, scrollable: false };
}
