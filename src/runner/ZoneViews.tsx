/**
 * Zone rendering for the table, driven by the zone's layout hint:
 *   stack -> pile (top card + count badge, only the top card in the DOM)
 *   row   -> spread with gaps        fan -> overlapping spread
 *   grid  -> wrapping grid
 * Three sizes: opponent strip minis (44px), center table (72px), hand (88px);
 * custom layouts override the size per zone via `cardWidth` (from cardScale).
 * Facing always goes through isCardVisibleTo from the viewer's perspective.
 *
 * Screen-layout extras (ZoneCustom):
 *   - cardIds: the display slice (cardFilter applied upstream) — game logic
 *     still sees the whole zone; legal glow only lights visible cards.
 *   - display 'piles': cards group by identity (defId / standard name) into
 *     supply piles — top card + "× N" badge + optional rotated-lozenge field
 *     badge; the grid honors rows/columns/gap; a pile glows when ANY member
 *     is a legal target and tapping performs on the TOPMOST legal one.
 *     Identities seen this table mount are remembered (ctx.pileMemory), so a
 *     DEPLETED pile stays in place as a grayed count-0 placeholder
 *     (.rn-pile-empty, non-tappable) instead of vanishing.
 *   - display 'carousel': the same piles laid in ONE horizontally
 *     scroll-snapping row (.rn-carousel/.rn-carouselslot) — the touch-first
 *     mobile supply pattern; taps/glow behave exactly like 'piles'.
 *   - pileFace 'tile' (piles AND carousel): each pile renders the DGT
 *     compact tile (.rn-ptile — cost lozenge, name, × count; no card face)
 *     instead of the CardView top card. Same handlers and marking classes
 *     as the card-face path; depleted identities gray out as tiles too.
 *   - collapseDuplicates: hand-style merge of identical cards into one card
 *     with a × N badge and offset shadow layers.
 *   - fan zones rotate/dip per card (fanTransform; fanAngle 0 = flat) with a
 *     straight hover/press lift.
 *
 * Card state (def.cardState): cards whose perCard rotate var is truthy render
 * rotated 90° (the wrapper swaps its occupied width/height so rows stay
 * aligned); badge vars render as chips on the card (hidden when 0/''/false).
 * Zones with a capacity show "n/cap" and flag fullness subtly.
 */
import { Fragment, useLayoutEffect, useState } from 'react';
import type { GameDef, GameState, Id, Move, VariableDef, ZoneDef, ZoneInstance } from '../shared/types';
import { isCardVisibleTo } from '../engine';
import { CardView } from '../components/CardView';
import type { CardRectRegistry } from './flip';
import type { KeyBadge, KeyboardGroup } from './keyboard';
import { templateOf } from './layout';
import {
  DEFAULT_FAN_ANGLE, fanMarginPx, fanTransform, gridSpec, groupPiles, groupPilesRemembered,
  topLegalCard, type CardPile, type FrameCss, type PileMemoryEntry,
} from './layoutGeometry';

/**
 * Authored chrome + spacing for a zone element in a screen layout (absent =
 * the classic defaults): frame = LayoutStyle as CSS, padPx insets the
 * contents, gapPx spaces cards (fan: visible slice per card), rows × columns
 * fix the grid template, showCount always shows the card-count chip.
 */
export interface ZoneCustom {
  frame?: FrameCss;
  padPx?: number;
  gapPx?: number;
  rows?: number | null;
  columns?: number | null;
  showCount?: boolean;
  /** 'piles' groups by card identity (supply boards); 'carousel' is those
   *  piles in one scroll-snapping row. Default 'cards'. */
  display?: 'cards' | 'piles' | 'carousel';
  /** Display slice of the zone (cardFilter applied upstream). */
  cardIds?: Id[];
  /** Piles: card field rendered as a rotated-square corner badge. */
  pileBadgeField?: Id | null;
  /** Badge chip shape: 'diamond' (default) or 'round'. */
  badgeShape?: 'diamond' | 'round';
  /** × N count placement on piles/stacks: corner (default) / bottom / none. */
  countBadge?: 'corner' | 'bottom' | 'none';
  /** Per-element chrome merged over each card face / pile tile. */
  cardFrame?: FrameCss;
  /** Placeholder copy while the element shows no cards (default 'empty'). */
  emptyText?: string;
  /** Piles/carousel face: 'tile' renders the DGT compact pile tile
   *  (.rn-ptile — cost lozenge, name, × count) instead of the card
   *  template's face. Default 'card'. */
  pileFace?: 'card' | 'tile';
  /** Merge identical cards into one × N element ('cards' mode). */
  collapseDuplicates?: boolean;
  /** Fan rotation per card step (0 = flat; default 4). */
  fanAngle?: number;
  /** Scopes the depleted-pile memory to the RENDERING ELEMENT (the screen
   *  element id): several elements can slice one shared zone instance with
   *  disjoint cardFilters, and a pile depleted from one slice must not ghost
   *  a count-0 placeholder into the others. Absent = per-instance memory. */
  memoryKey?: string;
}

/** Everything a zone needs to render + react to taps, bundled once per frame. */
export interface TableCtx {
  def: GameDef;
  state: GameState;
  viewerId: Id;
  accent: string;
  /** Legal card-target moves by card instance id (empty when input is off). */
  cardMoves: ReadonlyMap<Id, Move[]>;
  /** Legal zone-target moves by zone instance key. */
  zoneMoves: ReadonlyMap<string, Move[]>;
  /** perCard var that rotates the card 90° while truthy (def.cardState). */
  rotateVar: Id | null;
  /** perCard vars rendered as chips on the card (def.cardState). */
  badgeVars: VariableDef[];
  /** FLIP registry: every rendered table card reports its DOM node here. */
  cardRects: CardRectRegistry;
  /** Keyboard digit badges by rendered FACE card id (keyboard.tsx). */
  keyBadges?: ReadonlyMap<Id, KeyBadge>;
  /** Keyboard group whose modifier is held (its badges light up). */
  keySpotlight?: KeyboardGroup | null;
  /** Pile identities seen this table mount, per element+instance key
   *  (identity -> last-seen top card id + facing) — backs depleted-pile
   *  placeholders. View-layer session memory only: never engine state,
   *  never persisted. */
  pileMemory: Map<string, Map<string, PileMemoryEntry>>;
  /** Tap handlers double as the illegal-tap path: with no legal moves on the
   *  target, TableScreen shakes `el` (.rn-refuse) instead of performing. */
  onCardTap: (cardId: Id, el?: HTMLElement | null) => void;
  onZoneTap: (instKey: string, el?: HTMLElement | null) => void;
}

export type ZoneSize = 'strip' | 'center' | 'hand';
const CARD_WIDTH: Record<ZoneSize, number> = { strip: 44, center: 72, hand: 88 };

/**
 * Largest card width that fits an authored zone rect (fill mode): height
 * bounds single-line layouts (stack/row/fan/carousel); grids and pile boards
 * bound by rows AND columns. Floored at 24px — a degenerate rect clips (the
 * fill CSS hides overflow) rather than rendering unreadable cards.
 */
function fitCardWidth(opts: {
  gridLike: boolean;
  fanOn: boolean;
  /** Fan rotation per step — a FLAT fan (0°) needs no arc headroom. */
  fanAngle?: number;
  box: { w: number; h: number };
  aspect: number;
  count: number;
  gap: number;
  rows: number | null;
  columns: number | null;
}): number {
  const { box, aspect } = opts;
  // Vertical chrome inside the body: fan dip/lift room, badge overhang.
  const pad = opts.fanOn && (opts.fanAngle ?? 4) !== 0 ? 20 : 8;
  const availH = Math.max(0, box.h - pad);
  if (opts.gridLike) {
    const cols = opts.columns;
    const rows = opts.rows ?? (cols !== null ? Math.max(1, Math.ceil(opts.count / cols)) : 1);
    const byH = ((availH - (rows - 1) * opts.gap) / rows) * aspect;
    const byW = cols !== null ? (box.w - (cols - 1) * opts.gap - 4) / cols : Number.POSITIVE_INFINITY;
    return Math.max(24, Math.floor(Math.min(byH, byW)));
  }
  return Math.max(24, Math.floor(availH * aspect));
}

/**
 * Keyboard activation for role=button divs: Enter/Space act, with the
 * default cancelled — otherwise Space also page-scrolls the nearest
 * scrollable ancestor (native buttons suppress that for free; divs don't).
 */
function pressHandler(act: (e: React.SyntheticEvent) => void) {
  return (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      act(e);
    }
  };
}

export function ZoneBlock({ ctx, zone, inst, size, caption, cardWidth, fill, custom }: {
  ctx: TableCtx;
  zone: ZoneDef;
  inst: ZoneInstance;
  size: ZoneSize;
  /** '' hides the caption (custom layouts with showName off). */
  caption: string;
  /** Explicit card width in px (custom layouts); overrides `size`. */
  cardWidth?: number;
  /** Stretch to fill an absolutely-positioned layout rect. */
  fill?: boolean;
  /** Authored style + spacing (custom layouts). */
  custom?: ZoneCustom;
}) {
  const baseWidth = cardWidth ?? CARD_WIDTH[size];
  const tappable = (ctx.zoneMoves.get(inst.key)?.length ?? 0) > 0;
  // The display slice (cardFilter); legal glow only considers visible cards.
  const ids = custom?.cardIds ?? inst.cardIds;
  const hasMoves = (id: Id) => (ctx.cardMoves.get(id)?.length ?? 0) > 0;
  const zoneHasLegal = ids.some(hasMoves);
  const cap = zone.capacity ?? null;
  const count = ids.length;
  const realCount = inst.cardIds.length;
  const full = cap !== null && realCount >= cap;
  // Remounting the body when contents change gives a cheap "pop" animation.
  const sig = `${count}:${count > 0 ? ids[count - 1] : ''}`;
  const isPiles = custom?.display === 'piles';
  const isCarousel = custom?.display === 'carousel';
  const fanOn = zone.layout === 'fan' && !isPiles
    && (custom?.fanAngle ?? DEFAULT_FAN_ANGLE) !== 0;

  // Fit-to-zone (authored rects): measure the body box and clamp the card
  // width so cards genuinely FIT the rect — no clipped faces, no scrollbars.
  // The body (.rn-pop) remounts on content change, so the node is tracked in
  // state and the observer re-attaches with it.
  const [popEl, setPopEl] = useState<HTMLDivElement | null>(null);
  const [popBox, setPopBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (fill !== true || popEl === null) return;
    const update = () => setPopBox((prev) => {
      const w = popEl.clientWidth;
      const h = popEl.clientHeight;
      return prev !== null && prev.w === w && prev.h === h ? prev : { w, h };
    });
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(popEl);
    return () => ro.disconnect();
  }, [fill, popEl]);
  const card0 = count > 0 ? ctx.state.cards[ids[0]] : undefined;
  const width = fill === true && popBox !== null
    ? Math.min(baseWidth, fitCardWidth({
        gridLike: (zone.layout === 'grid' || isPiles) && !isCarousel,
        fanOn,
        fanAngle: custom?.fanAngle,
        box: popBox,
        aspect: card0 !== undefined ? templateOf(ctx.def, card0)?.aspect ?? 0.714 : 0.714,
        count: isPiles || isCarousel ? groupPiles(ids, ctx.state.cards).length : count,
        gap: custom?.gapPx ?? 6,
        rows: custom?.rows ?? null,
        columns: custom?.columns ?? null,
      }))
    : baseWidth;

  const renderCard = (cardId: Id) => (
    <TableCard
      key={cardId}
      ctx={ctx}
      cardId={cardId}
      width={width}
      dimInactive={zoneHasLegal}
      refuseTap={!tappable}
      frame={custom?.cardFrame}
    />
  );
  // Authored emptyText renders as a free-flowing note (the "Play zone
  // empty." pattern); the default keeps the card-shaped dashed slot.
  const emptySlot = custom?.emptyText !== undefined
    ? <div className="rn-empty rn-empty-note">{custom.emptyText}</div>
    : <div className="rn-empty" style={{ width, height: Math.round(width / 0.714) }}>empty</div>;

  // Authored spacing (screen layouts): gap on rows/grids; fans overlap via a
  // CSS var (margin-left = gap - cardWidth, see layoutGeometry.fanMarginPx).
  const gapPx = custom?.gapPx;
  const fanMl = zone.layout === 'fan' ? fanMarginPx(width, gapPx) : undefined;
  const grid = zone.layout === 'grid' || isPiles ? gridSpec(custom?.rows, custom?.columns) : null;
  const gridStyle: React.CSSProperties | undefined = grid
    ? {
        display: 'grid',
        gridTemplateColumns: grid.columns,
        gridTemplateRows: grid.rows,
        gridAutoFlow: grid.autoFlow,
        justifyContent: 'center',
        alignContent: 'center',
        gap: gapPx ?? 6,
      }
    : gapPx !== undefined ? { gap: gapPx } : undefined;

  // Collapse identical cards (hand-style); each item renders once with × N.
  const collapse = custom?.collapseDuplicates === true && !isPiles && !isCarousel;
  interface RenderItem { key: string; cardId: Id; n: number; memberIds: readonly Id[] }
  const items: RenderItem[] = collapse
    ? groupPiles(ids, ctx.state.cards).map((p) => ({
        key: p.key, cardId: p.topId, n: p.count, memberIds: p.cardIds,
      }))
    : ids.map((id) => ({ key: id, cardId: id, n: 1, memberIds: [id] }));

  const renderItem = (it: RenderItem, i: number) => {
    // A collapsed group's face stays bright while ANY member is legal.
    const groupLegal = it.n > 1 && topLegalCard(it.memberIds, hasMoves) !== null;
    const card = (
      <TableCard
        ctx={ctx}
        cardId={it.cardId}
        width={width}
        dimInactive={zoneHasLegal && !groupLegal}
        // The × N badge is aria-hidden and the other members never enter the
        // DOM, so the count rides the face card's accessible name.
        nameSuffix={it.n > 1 ? ` × ${it.n}` : undefined}
        // Refuse illegal taps only when nothing above would handle them (a
        // tappable zone or a buried-legal collapsed group performs instead).
        refuseTap={!tappable && !groupLegal}
      />
    );
    const body = it.n > 1
      ? <CollapsedGroup ctx={ctx} item={it} width={width}>{card}</CollapsedGroup>
      : card;
    if (!fanOn) return <Fragment key={it.key}>{body}</Fragment>;
    const t = fanTransform(i, items.length, width, custom?.fanAngle);
    return (
      <div
        key={it.key}
        className="rn-fanslot"
        style={{
          '--rn-fan-rot': `${t.rot}deg`,
          '--rn-fan-dy': `${t.dy}px`,
        } as React.CSSProperties}
      >
        {body}
      </div>
    );
  };

  let body: JSX.Element;
  if (isPiles || isCarousel) {
    // Supply piles: group by identity; an empty zone renders nothing.
    // 'carousel' renders the same piles in one scroll-snapping row.
    // Identities seen earlier this table mount whose cards all left come
    // back as depleted count-0 placeholders. The memory is scoped per
    // RENDERING ELEMENT (custom.memoryKey) + instance: several screen
    // elements can slice one shared zone with disjoint cardFilters, and a
    // depletion must only placehold in the slice that showed the pile.
    const memKey = custom?.memoryKey !== undefined
      ? `${custom.memoryKey}|${inst.key}`
      : inst.key;
    let memory = ctx.pileMemory.get(memKey);
    if (!memory) {
      memory = new Map();
      ctx.pileMemory.set(memKey, memory);
    }
    const piles = groupPilesRemembered(
      ids, ctx.state.cards, memory, inst.cardIds,
      // Facing snapshot while live (viewer-bound) — keeps a later
      // placeholder's face stable however the departed copy travels.
      (id) => isCardVisibleTo(ctx.def, ctx.state, id, ctx.viewerId),
    );
    const anyPileLegal = piles.some((p) => topLegalCard(p.cardIds, hasMoves) !== null);
    const pileEl = (p: CardPile) => (
      <SupplyPile
        key={isCarousel ? undefined : p.key}
        ctx={ctx}
        pile={p}
        width={width}
        badgeField={custom?.pileBadgeField ?? null}
        badgeShape={custom?.badgeShape}
        countBadge={custom?.countBadge}
        cardFrame={custom?.cardFrame}
        face={custom?.pileFace ?? 'card'}
        dimWhenIdle={anyPileLegal}
        refusable={!tappable}
      />
    );
    // Piles render nothing when empty — unless the author wrote emptyText.
    // A carousel whose piles all FIT the frame centers them as a group
    // (no scroll, no snap-padding); an overflowing one keeps the snap-to-
    // center behavior. Until the box is measured, assume overflow so
    // nothing jumps on first paint.
    const carouselFits = popBox !== null
      && piles.length * width + (piles.length - 1) * (gapPx ?? 10) <= popBox.w;
    body = piles.length === 0 ? (custom?.emptyText !== undefined ? emptySlot : <></>) : isCarousel ? (
      <div
        className={`rn-carousel${carouselFits ? ' rn-carousel-fit' : ''}`}
        style={{
          // Centers the snapped pile: inline padding = 50% - half a card.
          '--rn-carousel-half': `${Math.round(width / 2)}px`,
          ...(gapPx !== undefined ? { gap: gapPx } : {}),
        } as React.CSSProperties}
      >
        {piles.map((p) => (
          <div className="rn-carouselslot" key={p.key}>{pileEl(p)}</div>
        ))}
      </div>
    ) : (
      <div className="rn-gridz rn-piles" style={gridStyle}>
        {piles.map(pileEl)}
      </div>
    );
  } else if (zone.layout === 'stack') {
    body = (
      <div className="rn-pile">
        {count > 0 ? renderCard(ids[count - 1]) : emptySlot}
        {custom?.countBadge !== 'none' && (
          <span className={`rn-badge${custom?.countBadge === 'bottom' ? ' rn-badge-bc' : ''}${full ? ' rn-capfull' : ''}`}>
            {cap !== null ? `${realCount}/${cap}` : count}
          </span>
        )}
      </div>
    );
  } else if (zone.layout === 'grid') {
    body = (
      <div className="rn-gridz" style={gridStyle}>
        {count > 0 ? items.map(renderItem) : emptySlot}
      </div>
    );
  } else {
    const fanGapped = zone.layout === 'fan' && fanMl !== undefined;
    body = (
      <div
        className={`rn-spread rn-z-${size}${zone.layout === 'fan' ? ' rn-fanned' : ''}${fanGapped ? ' rn-gapped' : ''}`}
        style={fanGapped
          ? { '--rn-fan-ml': `${fanMl}px` } as React.CSSProperties
          : zone.layout === 'row' && gapPx !== undefined ? { gap: gapPx } : undefined}
      >
        {count > 0 ? items.map(renderItem) : emptySlot}
      </div>
    );
  }

  const capChip = (cap !== null || custom?.showCount === true) && zone.layout !== 'stack'
    ? (
      <span className={`rn-capcount${full ? ' rn-capfull' : ''}`}>
        {cap !== null ? `${realCount}/${cap}` : count}
      </span>
    )
    : null;

  const frame: React.CSSProperties | undefined = custom && (custom.frame || custom.padPx !== undefined)
    ? { ...custom.frame, ...(custom.padPx !== undefined ? { padding: custom.padPx } : {}) }
    : undefined;

  // Illegal ZONE taps (no zone-target moves) still reach TableScreen so it
  // can refuse-shake the frame — but only genuine zone taps: clicks landing
  // on card-level targets (face-down backs, depleted placeholders — which
  // swallow their own taps, collapsed-group chrome, empty slots) are either
  // handled at card level or deliberately silent (face-down/decorative).
  const refuseZoneTap = (e: React.MouseEvent) => {
    const t = e.target as Element;
    if (t.closest('.rn-cardwrap, .rn-spile, .rn-ptile, .rn-collapse, .rn-empty') !== null) return;
    ctx.onZoneTap(inst.key, e.currentTarget as HTMLElement);
  };
  return (
    <div
      className={`rn-zone${tappable ? ' rn-highlight rn-tappable' : ''}${fill ? ' rn-zone-fill' : ''}${full ? ' rn-zfull' : ''}`}
      style={frame}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      onClick={tappable ? () => ctx.onZoneTap(inst.key) : refuseZoneTap}
      onKeyDown={tappable ? pressHandler(() => ctx.onZoneTap(inst.key)) : undefined}
    >
      {(caption !== '' || capChip !== null) && (
        <span className="rn-zone-cap">{caption}{capChip}</span>
      )}
      <div className="rn-pop" key={sig} ref={fill === true ? setPopEl : undefined}>{body}</div>
    </div>
  );
}

/**
 * One supply pile ('piles' display): the top card's face, a × N badge, an
 * optional field badge (rotated-square lozenge, e.g. cost), pile-level legal
 * glow + tap. The face card handles its own tap when IT is the legal target;
 * the pile handles taps that should reach a buried legal member — and, when
 * NO member is legal (`refusable`), forwards the tap so TableScreen can
 * refuse-shake the pile. A count-0 pile (a remembered, depleted identity)
 * renders as a grayed non-tappable placeholder: the face goes through
 * CardView directly — never TableCard — so the representative card, which
 * now lives elsewhere, doesn't double-register in the FLIP rect registry.
 */
function SupplyPile({ ctx, pile, width, badgeField, badgeShape, countBadge, cardFrame, face, dimWhenIdle, refusable }: {
  ctx: TableCtx;
  pile: CardPile;
  width: number;
  badgeField: Id | null;
  /** Badge chip shape: 'diamond' (default) or 'round'. */
  badgeShape?: 'diamond' | 'round';
  /** × N placement: 'corner' (default) / 'bottom' / 'none'. */
  countBadge?: 'corner' | 'bottom' | 'none';
  /** Per-element chrome merged over the card face / tile plate. */
  cardFrame?: FrameCss;
  /** 'tile' renders the compact DGT pile tile instead of the card face. */
  face?: 'card' | 'tile';
  dimWhenIdle: boolean;
  /** No enclosing tappable zone: illegal pile taps may refuse-shake. */
  refusable: boolean;
}) {
  const card = ctx.state.cards[pile.topId];
  if (!card) return null;
  if (face === 'tile') {
    return (
      <TilePile
        ctx={ctx}
        pile={pile}
        width={width}
        badgeField={badgeField}
        badgeShape={badgeShape}
        countBadge={countBadge}
        cardFrame={cardFrame}
        dimWhenIdle={dimWhenIdle}
        refusable={refusable}
      />
    );
  }
  const badgeVal = badgeField !== null ? card.fields[badgeField] : undefined;
  const badgeCls = `rn-pilecost${badgeShape === 'round' ? ' rn-pilecost-round' : ''}`;
  const badgeChip = badgeVal !== undefined && badgeVal !== ''
    ? <span className={badgeCls} aria-hidden="true"><span>{String(badgeVal)}</span></span>
    : null;
  const countCls = `rn-badge${countBadge === 'bottom' ? ' rn-badge-bc' : ''}`;
  const visible = isCardVisibleTo(ctx.def, ctx.state, pile.topId, ctx.viewerId);

  if (pile.count === 0) {
    // Depleted placeholder: the last-seen face at 0.28/grayscale (runner.css
    // .rn-pile-empty). Facing is the SNAPSHOT the memory took while the pile
    // was live (pile.faceUp) — stable however the departed copy travels
    // through other zones, and it leaks nothing that wasn't already shown
    // here. Taps are deliberately silent: with no enclosing tappable zone
    // the placeholder swallows the click so it can't bubble to the zone
    // frame and refuse-shake the whole panel; inside a tappable zone the
    // tap bubbles and performs the zone move like the rest of the frame.
    const shown = pile.faceUp ?? visible;
    const template = templateOf(ctx.def, card);
    return (
      <div
        className="rn-spile rn-pile-empty"
        role="img"
        aria-label={`${shown ? card.name : 'Face-down card'}, depleted`}
        onClick={refusable ? (e) => e.stopPropagation() : undefined}
      >
        <CardView
          card={{ name: card.name, templateId: card.templateId, fields: card.fields, faceUp: shown }}
          template={template}
          width={width}
          accent={ctx.accent}
        />
        {countBadge !== 'none' && <span className={countCls} aria-hidden="true">× 0</span>}
        {badgeChip}
      </div>
    );
  }

  const hasMoves = (id: Id) => (ctx.cardMoves.get(id)?.length ?? 0) > 0;
  const topLegal = topLegalCard(pile.cardIds, hasMoves);
  const faceLegal = hasMoves(pile.topId);
  // The badge lozenge itself is aria-hidden, so its field (e.g. "Cost 3")
  // joins the pile's accessible name instead of vanishing from AT entirely.
  const badgeName = badgeField !== null
    ? templateOf(ctx.def, card)?.fields.find((f) => f.id === badgeField)?.name
    : undefined;
  const badgePart = badgeVal !== undefined && badgeVal !== ''
    ? `, ${badgeName !== undefined ? `${badgeName} ` : ''}${String(badgeVal)}`
    : '';
  const tap = topLegal !== null && !faceLegal
    ? (e: React.SyntheticEvent) => {
        e.stopPropagation(); // don't also fire a zone-target tap
        ctx.onCardTap(topLegal);
      }
    : undefined;
  // Illegal tap on a face-up pile with no legal member: forward to the card
  // tap path with the PILE's node so the whole pile (badges included) shakes.
  const refuse = topLegal === null && refusable && visible
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        ctx.onCardTap(pile.topId, e.currentTarget as HTMLElement);
      }
    : undefined;
  return (
    <div
      className={`rn-spile${topLegal !== null ? ' rn-pilelegal' : ''}${dimWhenIdle && topLegal === null ? ' rn-piledim' : ''}`}
      role={tap ? 'button' : undefined}
      tabIndex={tap ? 0 : undefined}
      aria-label={`${card.name} × ${pile.count}${badgePart}`}
      onClick={tap ?? refuse}
      onKeyDown={tap ? pressHandler(tap) : undefined}
    >
      <TableCard
        ctx={ctx}
        cardId={pile.topId}
        width={width}
        dimInactive={false}
        nameSuffix={` × ${pile.count}${badgePart}`}
        frame={cardFrame}
      />
      {countBadge !== 'none' && (
        <span className={countCls} aria-hidden="true">× {pile.count}</span>
      )}
      {badgeChip}
    </div>
  );
}

/**
 * Compact pile tile (zone `pileFace: 'tile'` — the DGT makePile look): one
 * `<button class="rn-ptile">` plate carrying the cost lozenge
 * (.rn-ptile-cost, the badgeField value), the card name (.rn-ptile-name),
 * the count (.rn-ptile-count, "× N" via its ::before) and the keyboard
 * digit badge slot — no card face. Behaviors mirror the card-face path with
 * the SAME class names: .rn-glow when the face itself is legal,
 * .rn-pilelegal when ANY member is, .rn-piledim when idle among legal
 * peers, .rn-pile-empty (grayed, click-swallowing) at count 0; illegal taps
 * refuse-shake through the same onCardTap path. The live tile registers as
 * the top card's FLIP rect so buys still fly out of it. The border stays
 * NEUTRAL (--border-strong): there is no generic "card type" field, so the
 * tile exposes `data-card` (the face's name, face-up only) and skins route
 * accent colors from it.
 */
function TilePile({ ctx, pile, width, badgeField, badgeShape, countBadge, cardFrame, dimWhenIdle, refusable }: {
  ctx: TableCtx;
  pile: CardPile;
  width: number;
  badgeField: Id | null;
  badgeShape?: 'diamond' | 'round';
  countBadge?: 'corner' | 'bottom' | 'none';
  cardFrame?: FrameCss;
  dimWhenIdle: boolean;
  /** No enclosing tappable zone: illegal pile taps may refuse-shake. */
  refusable: boolean;
}) {
  const card = ctx.state.cards[pile.topId];
  if (!card) return null;
  const visible = isCardVisibleTo(ctx.def, ctx.state, pile.topId, ctx.viewerId);
  const depleted = pile.count === 0;
  // Placeholders keep the facing SNAPSHOT taken while the pile was live
  // (see the card-face branch above) — never re-resolved.
  const shown = depleted ? pile.faceUp ?? visible : visible;
  const name = shown ? card.name : 'Face-down card';
  const badgeVal = badgeField !== null && shown ? card.fields[badgeField] : undefined;
  const costChip = badgeVal !== undefined && badgeVal !== ''
    ? (
      <span
        className={`rn-ptile-cost${badgeShape === 'round' ? ' rn-ptile-cost-round' : ''}`}
        aria-hidden="true"
      >
        {String(badgeVal)}
      </span>
    )
    : null;
  const countCls = `rn-ptile-count${countBadge === 'none' ? ' rn-ptile-count-off' : ''}`;
  const badgeName = badgeField !== null
    ? templateOf(ctx.def, card)?.fields.find((f) => f.id === badgeField)?.name
    : undefined;
  const badgePart = badgeVal !== undefined && badgeVal !== ''
    ? `, ${badgeName !== undefined ? `${badgeName} ` : ''}${String(badgeVal)}`
    : '';

  if (depleted) {
    // Depleted placeholder tile: same greying + click behavior as the
    // card-face branch (swallows its own taps when refusable so the zone
    // frame doesn't shake; bubbles inside a tappable zone). No FLIP
    // registration — the remembered face now lives elsewhere.
    return (
      <div
        className="rn-ptile rn-pile-empty"
        role="img"
        aria-label={`${name}, depleted`}
        style={{ width, ...cardFrame }}
        data-card={shown ? card.name : undefined}
        onClick={refusable ? (e) => e.stopPropagation() : undefined}
      >
        {costChip}
        <span className="rn-ptile-name" aria-hidden="true">{name}</span>
        <span className={countCls} aria-hidden="true">0</span>
      </div>
    );
  }

  const hasMoves = (id: Id) => (ctx.cardMoves.get(id)?.length ?? 0) > 0;
  const topLegal = topLegalCard(pile.cardIds, hasMoves);
  const faceLegal = hasMoves(pile.topId);
  const keyBadge = ctx.keyBadges?.get(pile.topId);
  // One handler covers face-legal, buried-legal AND the refuse path — the
  // same onCardTap the card faces converge on (TableScreen shakes the whole
  // tile on illegal taps). Face-down tiles with no legal member stay silent;
  // without a handler the tap bubbles to a tappable zone frame like any
  // other pile chrome.
  const tap = topLegal !== null
    ? (e: React.SyntheticEvent) => {
        e.stopPropagation(); // don't also fire a zone-target tap
        ctx.onCardTap(topLegal, e.currentTarget as HTMLElement);
      }
    : refusable && visible
      ? (e: React.SyntheticEvent) => {
          e.stopPropagation();
          ctx.onCardTap(pile.topId, e.currentTarget as HTMLElement);
        }
      : undefined;
  return (
    <button
      type="button"
      ref={(node) => ctx.cardRects.attach(pile.topId, node)}
      className={`rn-ptile${faceLegal ? ' rn-glow' : ''}${topLegal !== null ? ' rn-pilelegal' : ''}${dimWhenIdle && topLegal === null ? ' rn-piledim' : ''}`}
      style={{ width, ...cardFrame }}
      data-card={visible ? card.name : undefined}
      aria-label={`${name} × ${pile.count}${badgePart}`}
      // Handler-less tiles stay clickable (bubbling) but leave the tab order.
      tabIndex={tap !== undefined ? 0 : -1}
      onClick={tap}
    >
      {costChip}
      <span className="rn-ptile-name" aria-hidden="true">{name}</span>
      <span className={countCls} aria-hidden="true">{pile.count}</span>
      {keyBadge !== undefined && (
        <kbd
          className={`rn-keybadge${keyBadge.group === 'plain' ? ' rn-keybadge-plain' : ''}${ctx.keySpotlight === keyBadge.group ? ' rn-keybadge-lit' : ''}`}
          aria-hidden="true"
        >
          {keyBadge.digit}
        </kbd>
      )}
    </button>
  );
}

/**
 * collapseDuplicates wrapper: layered shadow offsets behind the face + × N.
 * Tapping reaches the TOPMOST legal member when the face itself isn't the
 * legal one (per-card state can differ between "identical" cards).
 */
function CollapsedGroup({ ctx, item, width, children }: {
  ctx: TableCtx;
  item: { cardId: Id; n: number; memberIds: readonly Id[] };
  width: number;
  children: React.ReactNode;
}) {
  const hasMoves = (id: Id) => (ctx.cardMoves.get(id)?.length ?? 0) > 0;
  const topLegal = topLegalCard(item.memberIds, hasMoves);
  const faceLegal = hasMoves(item.cardId);
  const buriedLegal = topLegal !== null && !faceLegal;
  const radius = Math.max(4, width * 0.06);
  const face = ctx.state.cards[item.cardId];
  const faceName = face !== undefined && isCardVisibleTo(ctx.def, ctx.state, item.cardId, ctx.viewerId)
    ? face.name
    : 'Face-down card';
  const tap = buriedLegal
    ? (e: React.SyntheticEvent) => {
        e.stopPropagation();
        ctx.onCardTap(topLegal);
      }
    : undefined;
  return (
    <div
      className={`rn-collapse${buriedLegal ? ' rn-grouplegal' : ''}`}
      role={tap ? 'button' : undefined}
      tabIndex={tap ? 0 : undefined}
      aria-label={tap ? `${faceName} × ${item.n}` : undefined}
      onClick={tap}
      onKeyDown={tap ? pressHandler(tap) : undefined}
    >
      {item.n > 2 && (
        <div className="rn-cshadow rn-cshadow2" style={{ borderRadius: radius }} aria-hidden="true" />
      )}
      <div className="rn-cshadow rn-cshadow1" style={{ borderRadius: radius }} aria-hidden="true" />
      {children}
      <span className="rn-badge" aria-hidden="true">× {item.n}</span>
    </div>
  );
}

/** Truthy for badge purposes: hide 0, '', false, null/undefined. */
function badgeVisible(v: unknown): boolean {
  return !(v === 0 || v === '' || v === false || v === null || v === undefined);
}

/**
 * One card on the table: visibility-resolved facing, glow + tap when legal,
 * rotation + badge chips from def.cardState.
 */
function TableCard({ ctx, cardId, width, dimInactive, nameSuffix, refuseTap, frame }: {
  ctx: TableCtx;
  cardId: Id;
  width: number;
  dimInactive: boolean;
  /** Joined to the accessible name (collapsed × N counts, pile badges). */
  nameSuffix?: string;
  /** Forward move-less taps on a FACE-UP card so TableScreen can refuse-
   *  shake it. Only set when nothing above (a tappable zone, a legal pile
   *  or collapsed group) would handle the bubbled tap itself. */
  refuseTap?: boolean;
  /** Per-element chrome (zone cardStyle) merged over the face wrapper. */
  frame?: FrameCss;
}) {
  const card = ctx.state.cards[cardId];
  if (!card) return null;
  const hasMoves = (ctx.cardMoves.get(cardId)?.length ?? 0) > 0;
  // Keyboard digit badge (keyed by the rendered face, so piles and collapsed
  // stacks — which render their face through TableCard — carry it too).
  const keyBadge = ctx.keyBadges?.get(cardId);
  const visible = isCardVisibleTo(ctx.def, ctx.state, cardId, ctx.viewerId);
  const template = templateOf(ctx.def, card);
  const height = Math.round(width / (template?.aspect ?? 0.714));
  const rotated = ctx.rotateVar !== null && badgeVisible(card.vars[ctx.rotateVar]);
  const badges = ctx.badgeVars
    .map((v) => ({ v, val: card.vars[v.id] }))
    .filter(({ val }) => badgeVisible(val));
  // Face-down cards never refuse (decorative backs stay silent); refuse-only
  // taps are pointer-only — no role/tabIndex, the card is not interactive.
  const tap = hasMoves || (refuseTap === true && visible)
    ? (e: React.SyntheticEvent) => {
        e.stopPropagation(); // don't also fire a zone-target tap
        ctx.onCardTap(cardId, e.currentTarget as HTMLElement);
      }
    : undefined;
  return (
    <div
      ref={(el) => ctx.cardRects.attach(cardId, el)}
      className={`rn-cardwrap${hasMoves ? ' rn-glow' : ''}${rotated ? ' rn-rotated' : ''}`}
      style={{
        borderRadius: Math.max(4, width * 0.06),
        cursor: hasMoves ? 'pointer' : undefined,
        // Rotated cards occupy a swapped box so rows/fans stay aligned.
        ...(rotated ? { width: height, height: width } : {}),
        // Zone cardStyle: per-element chrome merged over the face wrapper.
        // No overflow clipping — key badges and state chips hang off the
        // corners and must survive an authored radius.
        ...frame,
      }}
      role={hasMoves ? 'button' : undefined}
      tabIndex={hasMoves ? 0 : undefined}
      aria-label={`${visible ? card.name : 'Face-down card'}${nameSuffix ?? ''}`}
      onClick={tap}
      onKeyDown={hasMoves && tap ? pressHandler(tap) : undefined}
    >
      <div className="rn-rotor" style={rotated ? { width, height } : undefined}>
        <CardView
          card={{ name: card.name, templateId: card.templateId, fields: card.fields, faceUp: visible }}
          template={template}
          width={width}
          accent={ctx.accent}
          dimmed={dimInactive && !hasMoves}
        />
      </div>
      {badges.length > 0 && (
        <span className="rn-badges" aria-hidden="true">
          {badges.map(({ v, val }) => (
            <span className="rn-cardbadge" key={v.id} title={v.name}>
              {typeof val === 'boolean' ? v.name : String(val)}
            </span>
          ))}
        </span>
      )}
      {keyBadge !== undefined && (
        <kbd
          className={`rn-keybadge${keyBadge.group === 'plain' ? ' rn-keybadge-plain' : ''}${ctx.keySpotlight === keyBadge.group ? ' rn-keybadge-lit' : ''}`}
          aria-hidden="true"
        >
          {keyBadge.digit}
        </kbd>
      )}
    </div>
  );
}
