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
 *   - display 'carousel': the same piles laid in ONE horizontally
 *     scroll-snapping row (.rn-carousel/.rn-carouselslot) — the touch-first
 *     mobile supply pattern; taps/glow behave exactly like 'piles'.
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
import { Fragment } from 'react';
import type { GameDef, GameState, Id, Move, VariableDef, ZoneDef, ZoneInstance } from '../shared/types';
import { isCardVisibleTo } from '../engine';
import { CardView } from '../components/CardView';
import type { CardRectRegistry } from './flip';
import type { KeyBadge, KeyboardGroup } from './keyboard';
import { templateOf } from './layout';
import {
  DEFAULT_FAN_ANGLE, fanMarginPx, fanTransform, gridSpec, groupPiles, topLegalCard,
  type CardPile, type FrameCss,
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
  /** Merge identical cards into one × N element ('cards' mode). */
  collapseDuplicates?: boolean;
  /** Fan rotation per card step (0 = flat; default 4). */
  fanAngle?: number;
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
  onCardTap: (cardId: Id) => void;
  onZoneTap: (instKey: string) => void;
}

export type ZoneSize = 'strip' | 'center' | 'hand';
const CARD_WIDTH: Record<ZoneSize, number> = { strip: 44, center: 72, hand: 88 };

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
  const width = cardWidth ?? CARD_WIDTH[size];
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

  const renderCard = (cardId: Id) => (
    <TableCard key={cardId} ctx={ctx} cardId={cardId} width={width} dimInactive={zoneHasLegal} />
  );
  const emptySlot = (
    <div className="rn-empty" style={{ width, height: Math.round(width / 0.714) }}>empty</div>
  );

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

  const fanOn = zone.layout === 'fan' && !isPiles
    && (custom?.fanAngle ?? DEFAULT_FAN_ANGLE) !== 0;
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
    const piles = groupPiles(ids, ctx.state.cards);
    const anyPileLegal = piles.some((p) => topLegalCard(p.cardIds, hasMoves) !== null);
    const pileEl = (p: CardPile) => (
      <SupplyPile
        key={isCarousel ? undefined : p.key}
        ctx={ctx}
        pile={p}
        width={width}
        badgeField={custom?.pileBadgeField ?? null}
        dimWhenIdle={anyPileLegal}
      />
    );
    body = piles.length === 0 ? <></> : isCarousel ? (
      <div
        className="rn-carousel"
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
        <span className={`rn-badge${full ? ' rn-capfull' : ''}`}>
          {cap !== null ? `${realCount}/${cap}` : count}
        </span>
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

  return (
    <div
      className={`rn-zone${tappable ? ' rn-highlight rn-tappable' : ''}${fill ? ' rn-zone-fill' : ''}${full ? ' rn-zfull' : ''}`}
      style={frame}
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      onClick={tappable ? () => ctx.onZoneTap(inst.key) : undefined}
      onKeyDown={tappable ? pressHandler(() => ctx.onZoneTap(inst.key)) : undefined}
    >
      {(caption !== '' || capChip !== null) && (
        <span className="rn-zone-cap">{caption}{capChip}</span>
      )}
      <div className="rn-pop" key={sig}>{body}</div>
    </div>
  );
}

/**
 * One supply pile ('piles' display): the top card's face, a × N badge, an
 * optional field badge (rotated-square lozenge, e.g. cost), pile-level legal
 * glow + tap. The face card handles its own tap when IT is the legal target;
 * the pile handles taps that should reach a buried legal member.
 */
function SupplyPile({ ctx, pile, width, badgeField, dimWhenIdle }: {
  ctx: TableCtx;
  pile: CardPile;
  width: number;
  badgeField: Id | null;
  dimWhenIdle: boolean;
}) {
  const hasMoves = (id: Id) => (ctx.cardMoves.get(id)?.length ?? 0) > 0;
  const topLegal = topLegalCard(pile.cardIds, hasMoves);
  const faceLegal = hasMoves(pile.topId);
  const card = ctx.state.cards[pile.topId];
  const badgeVal = badgeField !== null && card ? card.fields[badgeField] : undefined;
  // The badge lozenge itself is aria-hidden, so its field (e.g. "Cost 3")
  // joins the pile's accessible name instead of vanishing from AT entirely.
  const badgeName = badgeField !== null && card
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
  return (
    <div
      className={`rn-spile${topLegal !== null ? ' rn-pilelegal' : ''}${dimWhenIdle && topLegal === null ? ' rn-piledim' : ''}${pile.count === 0 ? ' rn-pile-empty' : ''}`}
      role={tap ? 'button' : undefined}
      tabIndex={tap ? 0 : undefined}
      aria-label={card ? `${card.name} × ${pile.count}${badgePart}` : undefined}
      onClick={tap}
      onKeyDown={tap ? pressHandler(tap) : undefined}
    >
      <TableCard
        ctx={ctx}
        cardId={pile.topId}
        width={width}
        dimInactive={false}
        nameSuffix={` × ${pile.count}${badgePart}`}
      />
      <span className="rn-badge" aria-hidden="true">× {pile.count}</span>
      {badgeVal !== undefined && badgeVal !== '' && (
        <span className="rn-pilecost" aria-hidden="true"><span>{String(badgeVal)}</span></span>
      )}
    </div>
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
function TableCard({ ctx, cardId, width, dimInactive, nameSuffix }: {
  ctx: TableCtx;
  cardId: Id;
  width: number;
  dimInactive: boolean;
  /** Joined to the accessible name (collapsed × N counts, pile badges). */
  nameSuffix?: string;
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
  const tap = hasMoves
    ? (e: React.SyntheticEvent) => {
        e.stopPropagation(); // don't also fire a zone-target tap
        ctx.onCardTap(cardId);
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
      }}
      role={hasMoves ? 'button' : undefined}
      tabIndex={hasMoves ? 0 : undefined}
      aria-label={`${visible ? card.name : 'Face-down card'}${nameSuffix ?? ''}`}
      onClick={tap}
      onKeyDown={tap ? pressHandler(tap) : undefined}
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
