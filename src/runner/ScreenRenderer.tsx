/**
 * ScreenRenderer — the authored single-page game screen (def.screenLayout),
 * rendered live from the VIEWER's perspective.
 *
 *   - TableScreen picks the ACTIVE variant (desktop, or the mobile tree below
 *     1024px — useNarrowViewport) and passes it in as an ActiveScreen.
 *   - The stage fills the table area; a numeric `aspect` letterboxes a fixed
 *     w/h stage centered in it, null stretches to fill. Mobile variants with
 *     `scroll` render a tall in-flow page (height = width / aspect) that the
 *     area scrolls vertically; fixed overlays (sheets/banners) stay put.
 *   - Elements render recursively; array order = paint order (later = on
 *     top). Rects are % of the parent (screen or group); padding/gap/
 *     cardScale/fontSize are % of the SCREEN width so phones and desktops
 *     share the authored design.
 *   - Seat refs resolve viewer-relative (layoutGeometry.resolveSeat); seats
 *     beyond the player count render nothing; 'current' follows the acting
 *     turn (the element rebinds to the mover every turn).
 *   - `visible` display expressions gate each element; toggles play the
 *     element's reveal transition (exit runs before unmount).
 *   - Element STATES (resolveElementAppearance): the first state whose `when`
 *     holds merges its style over the base and may replace the rect; the
 *     wrapper CSS-transitions position/size/colors so changes morph smoothly.
 *     States compose with `visible` (visibility mounts, states style). They
 *     re-evaluate per engine snapshot (React render), never per anim frame.
 *   - onChangeAnim ('stamp'/'flash') replays a one-shot whenever the
 *     element's resolved content or active state changes (elementContentSig);
 *     'breathe' instead loops (2.6s foe-breathe) WHILE any state matches.
 *   - Keyboard spotlight (ctx.keySpotlight, keyboard.tsx): while a keyGroup
 *     modifier is held, every TOP-LEVEL element whose subtree lacks a zone of
 *     that group gets `rn-kb-dim` (opacity 0.3, CSS-transitioned).
 *   - text elements with `parts` interpolate display expressions (ids render
 *     as names, like announce); varText readouts bump on value change
 *     (ticker, default on); 'log' renders the scrolling chronicle with
 *     turn separators and bottom-anchored autoscroll.
 *   - zone elements honor display 'piles' / cardFilter / collapseDuplicates /
 *     fanAngle / pileBadgeField via ZoneBlock's custom config.
 *   - shape elements draw circles/rects/pills via border-radius and diamonds
 *     via a stretched SVG polygon; line elements draw SVG connectors
 *     (h/v/diagonal, dashed, arrowheads) colored by style.borderColor.
 *   - Buttons perform their bound none-target action when it's currently
 *     legal for the viewer; otherwise they render disabled. Unbound buttons
 *     are decorative.
 */
import { useEffect, useRef, useState } from 'react';
import type { Id, LayoutStyle, Move, ScreenElement } from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import { isDisplayVisible } from '../engine';
import { prefersReducedMotion } from './flip';
import { subtreeHasKeyGroup } from './keyboard';
import {
  cardPxFromScale, elementContentSig, formatVarValue, logRows, renderTextParts, zoneInstKey,
} from './layout';
import {
  filterDisplayCards, layoutStyleCss, lineColor, lineEndpoints, pctToPx,
  resolveElementAppearance, resolveSeat, shapeBorderRadius, computeStage,
  type ActiveScreen,
} from './layoutGeometry';
import { ZoneBlock, type TableCtx } from './ZoneViews';

/** How long exit reveal animations run before the element unmounts. */
const REVEAL_MS = 180;

/** The mobile-variant breakpoint (matches the original table's 45rem/720px). */
const NARROW_QUERY = '(max-width: 720px)';

/** True at/below 720px (live media query; false where matchMedia is missing). */
export function useNarrowViewport(): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [narrow, setNarrow] = useState(() => supported && window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    if (!supported) return;
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange); // older WebKit
    return () => mq.removeListener(onChange);
  }, [supported]);
  return narrow;
}

function useMeasuredSize(): [React.RefObject<HTMLDivElement>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

export function ScreenRenderer({ ctx, screen, buttonMove, onMove }: {
  ctx: TableCtx;
  /** The active variant (desktop or mobile), picked by the caller. */
  screen: ActiveScreen;
  /** Legal none-target move per action id (incl. Pass) for the viewer. */
  buttonMove: ReadonlyMap<Id, Move>;
  onMove: (m: Move) => void;
}) {
  const [ref, area] = useMeasuredSize();
  const stage = computeStage(area.w, area.h, screen.aspect, screen.scroll);
  return (
    <div className={`rn-screenarea${stage.scrollable ? ' rn-scrollpage' : ''}`} ref={ref}>
      {stage.w > 0 && stage.h > 0 && (
        <div
          className="rn-screen"
          style={{
            left: stage.left,
            top: stage.top,
            width: stage.w,
            height: stage.h,
            ...(screen.background ? { background: screen.background } : {}),
          }}
        >
          {screen.elements.map((el) => (
            <ElementView
              key={el.id}
              ctx={ctx}
              el={el}
              screenW={stage.w}
              buttonMove={buttonMove}
              onMove={onMove}
              root
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reveal transitions
// ---------------------------------------------------------------------------

/**
 * Mount/unmount with the element's reveal transition: entering plays the
 * `rn-rv-<anim>` animation (incl. on first appearance); leaving keeps the
 * node briefly with `rn-rv-<anim>-out` before removal. 'none' is instant.
 */
function Reveal({ show, anim, rect, frame, dim, children }: {
  show: boolean;
  anim: ScreenElement['reveal'];
  rect: { x: number; y: number; w: number; h: number };
  frame?: React.CSSProperties;
  /** Keyboard spotlight: this element sits outside the held group. */
  dim?: boolean;
  children: React.ReactNode;
}) {
  const [present, setPresent] = useState(show);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (show) {
      setPresent(true);
      setClosing(false);
      return;
    }
    if (!present) return;
    if (anim === undefined || anim === 'none' || prefersReducedMotion()) {
      setClosing(false);
      setPresent(false);
      return;
    }
    setClosing(true);
    const t = window.setTimeout(() => {
      setClosing(false);
      setPresent(false);
    }, REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [show, anim, present]);

  if (!present) return null;
  const animClass = anim !== undefined && anim !== 'none'
    ? ` rn-rv-${anim}${closing ? '-out' : ''}`
    : '';
  return (
    <div
      className={`rn-el${animClass}${dim === true ? ' rn-kb-dim' : ''}`}
      style={{
        left: `${rect.x}%`,
        top: `${rect.y}%`,
        width: `${rect.w}%`,
        height: `${rect.h}%`,
        ...frame,
      }}
    >
      {children}
    </div>
  );
}

/**
 * onChangeAnim wrapper: replays the one-shot (`rn-anim-stamp` / `rn-anim-
 * flash`) whenever the content signature changes, by remounting the wrapper
 * with the class re-added (the retrigger idiom). First render never animates.
 */
function ChangeAnim({ sig, anim, children }: {
  sig: string;
  anim: 'stamp' | 'flash';
  children: React.ReactNode;
}) {
  const prev = useRef(sig);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prev.current !== sig) {
      prev.current = sig;
      setN((v) => v + 1);
    }
  }, [sig]);
  return (
    <div className={`rn-changewrap${n > 0 ? ` rn-anim-${anim}` : ''}`} key={n}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

/**
 * False when the element can never show anything for this table (dangling
 * refs, or a seat beyond the player count) — the whole element (chrome
 * included) is skipped, per the "gracefully render nothing" contract.
 */
function elementRenders(ctx: TableCtx, el: ScreenElement): boolean {
  const playerIds = ctx.state.players.map((p) => p.id);
  switch (el.kind) {
    case 'zone': {
      const zone = ctx.def.zones.find((z) => z.id === el.zoneId);
      if (!zone) return false;
      if (zone.owner === 'shared') return true;
      if (el.seat === 'shared') return false;
      return resolveSeat(playerIds, ctx.viewerId, el.seat, ctx.state.currentPlayerIdx) !== null;
    }
    case 'varText': {
      const vd = ctx.def.variables.find((v) => v.id === el.varId);
      if (!vd || vd.scope === 'perCard') return false;
      if (vd.scope === 'global') return true;
      if (el.seat === 'shared') return false;
      return resolveSeat(playerIds, ctx.viewerId, el.seat, ctx.state.currentPlayerIdx) !== null;
    }
    default:
      return true;
  }
}

/**
 * Collapsed/expanded state for a collapsible element, persisted per game +
 * element on the device (the DGT chronicle pattern). Always called so hook
 * order is stable; non-collapsible elements just never read it.
 */
function useCollapsed(defId: Id, elId: Id, startCollapsed: boolean): [boolean, () => void] {
  const key = `cardsmith.collapse.${defId}.${elId}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(key);
      if (saved !== null) return saved === '1';
    } catch { /* storage unavailable — session-only */ }
    return startCollapsed;
  });
  const toggle = () => setCollapsed((c) => {
    try {
      localStorage.setItem(key, c ? '0' : '1');
    } catch { /* ignore */ }
    return !c;
  });
  return [collapsed, toggle];
}

const COLLAPSE_GLYPH = { left: '‹', right: '›', top: '⌃', bottom: '⌄' } as const;

function ElementView({ ctx, el, screenW, buttonMove, onMove, root }: {
  ctx: TableCtx;
  el: ScreenElement;
  screenW: number;
  buttonMove: ReadonlyMap<Id, Move>;
  onMove: (m: Move) => void;
  /** Top-level element (keyboard spotlight dims at this granularity). */
  root?: boolean;
}) {
  const spec = el.collapsible ?? null;
  const [collapsed, toggleCollapsed] = useCollapsed(
    ctx.def.meta.id, el.id, spec?.startCollapsed === true,
  );
  if (!elementRenders(ctx, el)) return null;
  const show = isDisplayVisible(ctx.def, ctx.state, el.visible ?? null, ctx.viewerId);
  // States: first match picks the rect/style this element currently shows.
  const app = resolveElementAppearance(ctx.def, ctx.state, el, ctx.viewerId);

  // Collapsed: the element shrinks to a tab docked at its side of the screen
  // (visibility expressions still gate the tab).
  if (spec && collapsed) {
    if (!show) return null;
    const vertical = spec.side === 'left' || spec.side === 'right';
    const center = vertical ? app.rect.y + app.rect.h / 2 : app.rect.x + app.rect.w / 2;
    return (
      <button
        type="button"
        className={`rn-collapse-tab rn-collapse-tab-${spec.side}`}
        style={vertical ? { top: `${center}%` } : { left: `${center}%` }}
        aria-expanded={false}
        onClick={toggleCollapsed}
      >
        {spec.label || el.name}
      </button>
    );
  }

  // Zone chrome is drawn by ZoneBlock itself (frame + padding around cards);
  // shapes and lines paint their own geometry instead of the wrapper box.
  const ownChrome = el.kind === 'zone' || el.kind === 'shape' || el.kind === 'line';
  const frame = ownChrome ? undefined : (layoutStyleCss(app.style) as React.CSSProperties);
  let body = (
    <ElementBody
      ctx={ctx}
      el={el}
      style={app.style}
      screenW={screenW}
      buttonMove={buttonMove}
      onMove={onMove}
    />
  );
  // Child elements (any kind, not just groups): drawn on top of the parent's
  // box, % of its rect. Groups render theirs inside ElementBody already.
  if (el.kind !== 'group' && el.children && el.children.length > 0) {
    body = (
      <>
        {body}
        {el.children.map((child) => (
          <ElementView
            key={child.id}
            ctx={ctx}
            el={child}
            screenW={screenW}
            buttonMove={buttonMove}
            onMove={onMove}
          />
        ))}
      </>
    );
  }
  if (spec) {
    // Expanded collapsible: slide in from its edge; panel floats above peers.
    body = <div className={`rn-collapse-open rn-from-${spec.side}`}>{body}</div>;
  }
  // 'breathe' is a state-held loop, not a change one-shot ('breathe' rides the
  // same field; the stored union gains it via the editor — see keyboard/wave-1).
  const changeAnim = el.onChangeAnim !== undefined && el.onChangeAnim !== 'none'
    ? el.onChangeAnim as 'stamp' | 'flash' | 'breathe'
    : null;
  // Keyboard spotlight: dim top-level elements outside the held group.
  const spotlight = ctx.keySpotlight ?? null;
  const dim = root === true && spotlight !== null && !subtreeHasKeyGroup(el, spotlight);
  return (
    <>
      <Reveal
        show={show}
        anim={el.reveal}
        rect={app.rect}
        frame={spec ? { ...frame, zIndex: 30 } : frame}
        dim={dim}
      >
        {changeAnim === 'breathe'
          ? (
            // The foe-breathe idle: loops while ANY element state matches
            // (e.g. the seal's "foe turn" state); base appearance sits still.
            <div className={`rn-changewrap${app.stateId !== null ? ' rn-anim-breathe' : ''}`}>
              {body}
            </div>
          )
          : changeAnim !== null
            ? (
              <ChangeAnim
                sig={elementContentSig(ctx.def, ctx.state, el, ctx.viewerId, app.stateId)}
                anim={changeAnim}
              >
                {body}
              </ChangeAnim>
            )
            : body}
      </Reveal>
      {spec && show && (
        <button
          type="button"
          className="rn-collapse-close"
          style={{
            left: `${spec.side === 'left' ? app.rect.x : app.rect.x + app.rect.w}%`,
            top: `${spec.side === 'bottom' ? app.rect.y + app.rect.h : app.rect.y}%`,
            transform: `translate(${spec.side === 'left' ? '0' : '-100%'}, ${spec.side === 'bottom' ? '-100%' : '0'})`,
          }}
          aria-expanded
          aria-label={`Collapse ${spec.label || el.name}`}
          onClick={toggleCollapsed}
        >
          {COLLAPSE_GLYPH[spec.side]}
        </button>
      )}
    </>
  );
}

/** varText readout with the ticker bump (scale + accent flash on change). */
function VarTextView({ ctx, el, screenW }: {
  ctx: TableCtx;
  el: Extract<ScreenElement, { kind: 'varText' }>;
  screenW: number;
}) {
  const { def, state } = ctx;
  // Resolve like the classic renderer: dangling/per-card/seatless = nothing;
  // a merely-unset value still renders ('—').
  const vd = def.variables.find((v) => v.id === el.varId);
  let invalid = false;
  let value;
  if (!vd || vd.scope === 'perCard') {
    invalid = true;
  } else if (vd.scope === 'global') {
    value = state.globalVars[el.varId];
  } else if (el.seat === 'shared') {
    invalid = true;
  } else {
    const pid = resolveSeat(
      state.players.map((p) => p.id), ctx.viewerId, el.seat, state.currentPlayerIdx,
    );
    if (pid === null) invalid = true;
    else value = state.players.find((p) => p.id === pid)?.vars[el.varId];
  }
  const text = formatVarValue(value);
  const ticker = el.ticker !== false;
  const prev = useRef(text);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (prev.current !== text) {
      prev.current = text;
      if (ticker) setN((v) => v + 1);
    }
  }, [text, ticker]);
  if (invalid) return null;
  return (
    <div
      className="rn-sl-text"
      style={{
        fontSize: Math.max(9, (screenW * el.fontSize) / 100),
        textAlign: el.align,
        color: el.color,
        fontWeight: el.bold ? 800 : 600,
      }}
    >
      {el.label !== undefined && el.label !== '' && (
        <span className="rn-sl-varlabel">{el.label}</span>
      )}
      <span key={n} className={n > 0 && ticker ? 'rn-ticker-bump' : undefined}>
        {text}
      </span>
    </div>
  );
}

/** The chronicle: bottom-anchored scrolling log with turn separators. */
function LogView({ ctx, el, screenW }: {
  ctx: TableCtx;
  el: Extract<ScreenElement, { kind: 'log' }>;
  screenW: number;
}) {
  const entries = ctx.state.log;
  const rows = logRows(entries, el.turnSeparators !== false);
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = bodyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [entries.length]);
  return (
    <div
      className="rn-sl-log"
      ref={bodyRef}
      style={{ fontSize: Math.max(9, (screenW * (el.fontSize ?? 1.1)) / 100) }}
      aria-label="Game log"
    >
      {rows.map((r) => (r.kind === 'sep'
        ? <div className="rn-sl-logsep" key={`t${r.turn}`}>Turn {r.turn}</div>
        : <div className="rn-sl-logentry" key={r.index}>{r.text}</div>))}
    </div>
  );
}

function ElementBody({ ctx, el, style, screenW, buttonMove, onMove }: {
  ctx: TableCtx;
  el: ScreenElement;
  /** State-resolved style (matched state merged over the element's base). */
  style: LayoutStyle | undefined;
  screenW: number;
  buttonMove: ReadonlyMap<Id, Move>;
  onMove: (m: Move) => void;
}) {
  const { def, state } = ctx;
  const playerIds = state.players.map((p) => p.id);
  const px = (pct: number | undefined) => pctToPx(screenW, pct);

  switch (el.kind) {
    case 'zone': {
      const zone = def.zones.find((z) => z.id === el.zoneId);
      if (!zone) return null;
      let ownerId: Id | null = null;
      let ownerName: string | null = null;
      if (zone.owner === 'perPlayer') {
        if (el.seat === 'shared') return null; // validation error — skip
        ownerId = resolveSeat(playerIds, ctx.viewerId, el.seat, state.currentPlayerIdx);
        if (ownerId === null) return null; // seat exceeds player count
        if (el.seat !== 'viewer') {
          ownerName = state.players.find((p) => p.id === ownerId)?.name ?? null;
        }
      }
      const inst = state.zones[zoneInstKey(zone.id, ownerId)];
      if (!inst) return null;
      const caption = el.showName === false
        ? ''
        : ownerName !== null ? `${ownerName} · ${zone.name}` : zone.name;
      // Display slice (cardFilter): applies in BOTH display modes.
      const sliceIds = el.cardFilter != null
        ? filterDisplayCards(def, state, inst.cardIds, el.cardFilter, ctx.viewerId)
        : undefined;
      return (
        <ZoneBlock
          ctx={ctx}
          zone={zone}
          inst={inst}
          size="center"
          caption={caption}
          cardWidth={cardPxFromScale(screenW, el.cardScale)}
          fill
          custom={{
            frame: layoutStyleCss(style),
            padPx: px(el.padding),
            gapPx: px(el.gap),
            rows: el.rows,
            columns: el.columns,
            showCount: el.showCount,
            display: el.display,
            cardIds: sliceIds,
            pileBadgeField: el.pileBadgeField ?? null,
            collapseDuplicates: el.collapseDuplicates,
            fanAngle: el.fanAngle,
          }}
        />
      );
    }

    case 'text': {
      const text = el.parts !== undefined && el.parts.length > 0
        ? renderTextParts(def, state, el.parts, ctx.viewerId)
        : el.text;
      return (
        <div
          className="rn-sl-text"
          style={{
            fontSize: Math.max(9, (screenW * el.fontSize) / 100),
            textAlign: el.align,
            color: el.color,
            fontWeight: el.bold ? 800 : 600,
          }}
        >
          {text}
        </div>
      );
    }

    case 'varText':
      return <VarTextView ctx={ctx} el={el} screenW={screenW} />;

    case 'log':
      return <LogView ctx={ctx} el={el} screenW={screenW} />;

    case 'button': {
      const fontSize = el.fontSize !== undefined
        ? Math.max(9, (screenW * el.fontSize) / 100)
        : undefined;
      if (el.actionId === null) {
        return <div className="rn-sl-btn rn-sl-deco" style={{ fontSize }}>{el.label}</div>;
      }
      const move = buttonMove.get(el.actionId);
      const isPass = el.actionId === PASS_ACTION_ID;
      return (
        <button
          type="button"
          className={`rn-sl-btn${isPass && move ? ' rn-sl-pass' : ''}`}
          style={{ fontSize }}
          disabled={move === undefined}
          onClick={move !== undefined ? () => onMove(move) : undefined}
        >
          {el.label}
        </button>
      );
    }

    case 'shape': {
      const css = layoutStyleCss(style) as React.CSSProperties;
      const radius = shapeBorderRadius(el.shape, style);
      if (radius !== undefined) css.borderRadius = radius;
      const label = el.label !== undefined && el.label !== ''
        ? (
          <span
            className="rn-sl-shapelabel"
            style={{ fontSize: Math.max(9, (screenW * (el.fontSize ?? 1.2)) / 100) }}
          >
            {el.label}
          </span>
        )
        : null;
      if (el.shape === 'diamond') {
        // A polygon stretched by viewBox keeps the diamond axis-aligned in
        // non-square rects; non-scaling-stroke keeps the border width in px.
        const hasBorder = style?.borderWidth !== undefined || style?.borderColor !== undefined
          || style?.borderStyle !== undefined;
        const strokeW = hasBorder ? (style?.borderWidth ?? 1) : 0;
        const dash = style?.borderStyle === 'dashed' ? '6 4'
          : style?.borderStyle === 'dotted' ? '1.5 3' : undefined;
        return (
          <div className="rn-sl-shape rn-sl-diamond">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polygon
                points="50,0 100,50 50,100 0,50"
                vectorEffect="non-scaling-stroke"
                strokeWidth={strokeW}
                strokeDasharray={dash}
                style={{
                  fill: style?.background ?? 'transparent',
                  stroke: strokeW > 0
                    ? (style?.borderColor ?? 'rgba(255,255,255,0.35)')
                    : 'none',
                }}
              />
            </svg>
            {label}
          </div>
        );
      }
      return <div className="rn-sl-shape" style={css}>{label}</div>;
    }

    case 'line': {
      const color = lineColor(style);
      const p = lineEndpoints(el.orient);
      const arrow = el.arrow ?? 'none';
      const markerId = `rn-lm-${el.id}`;
      const thickness = Math.max(1, el.thickness);
      return (
        <svg className="rn-sl-line" width="100%" height="100%" aria-hidden="true">
          {arrow !== 'none' && (
            <defs>
              {/* Sized in strokeWidth units so heads scale with thickness;
                  auto-start-reverse flips the same head at the start. */}
              <marker
                id={markerId}
                markerWidth="7"
                markerHeight="7"
                refX="6"
                refY="3.5"
                orient="auto-start-reverse"
                markerUnits="strokeWidth"
              >
                <path d="M0,0 L7,3.5 L0,7 Z" style={{ fill: color }} />
              </marker>
            </defs>
          )}
          <line
            x1={`${p.x1}%`}
            y1={`${p.y1}%`}
            x2={`${p.x2}%`}
            y2={`${p.y2}%`}
            style={{ stroke: color }}
            strokeWidth={thickness}
            strokeDasharray={el.dashed ? `${thickness * 2.5} ${thickness * 1.8}` : undefined}
            strokeLinecap={el.dashed ? 'butt' : 'round'}
            markerEnd={arrow !== 'none' ? `url(#${markerId})` : undefined}
            markerStart={arrow === 'both' ? `url(#${markerId})` : undefined}
          />
        </svg>
      );
    }

    case 'group':
      return (
        <>
          {el.children.map((child) => (
            <ElementView
              key={child.id}
              ctx={ctx}
              el={child}
              screenW={screenW}
              buttonMove={buttonMove}
              onMove={onMove}
            />
          ))}
        </>
      );
  }
}
