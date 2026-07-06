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
 *     fanAngle / pileBadgeField / pileFace via ZoneBlock's custom config.
 *   - SELECTOR BUTTONS (button role 'selector'): clicking one writes its
 *     group's CLIENT-side selection (layout's cardsmith.sel store — never a
 *     game action); the active one carries rn-sel-on (skins restyle it).
 *     Elements with `showForSelector` render only while that button is the
 *     selected one of its group — the gate composes with `visible` (both
 *     must hold), so hiding plays the reveal exit like any visibility flip.
 *     The keyboard system flips a selection when a held modifier's zone
 *     lives in a currently-hidden shown-set (keyboard.selectorFlipsForGroup).
 *   - shape elements draw circles/rects/pills via border-radius and diamonds
 *     via a stretched SVG polygon; line elements draw SVG connectors
 *     (h/v/diagonal, dashed, arrowheads) colored by style.borderColor.
 *   - Buttons perform their bound none-target action when it's currently
 *     legal for the viewer; otherwise they render disabled. Unbound buttons
 *     are decorative.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FlowLayout, Id, LayoutStyle, Move, ScreenElement } from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import { isDisplayVisible } from '../engine';
import { prefersReducedMotion } from './flip';
import { subtreeHasKeyGroup } from './keyboard';
import {
  cardPxFromScale, collapseStorageKey, elementContentSig, formatVarValue, logRows,
  renderTextParts, selectionVersion, selectorContext, selectorGateOpen, subscribeSelection,
  writeSelection, zoneInstKey, type SelectorContext,
} from './layout';
import {
  filterDisplayCards, flowChildCss, flowLayoutCss, layoutStyleCss, lineColor, lineEndpoints,
  pctToPx, resolveElementAppearance, resolveSeat, shapeBorderRadius, shapeClipPath, shapePolygon,
  slotRect, textStyleCss, computeStage,
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
    // ResizeObserver deliveries are rAF-aligned and starve while the window
    // is hidden/backgrounded, which could leave the stage at 0×0 until a
    // remount. A window resize listener plus a visibilitychange re-measure
    // re-read the rect directly — cheap and idempotent (the setter bails
    // when nothing changed).
    window.addEventListener('resize', measure);
    document.addEventListener('visibilitychange', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      document.removeEventListener('visibilitychange', measure);
    };
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
  // Selector groups: re-render (and re-resolve every showForSelector gate)
  // whenever any selection writes; the context itself is a cheap tree walk.
  useSyncExternalStore(subscribeSelection, selectionVersion, selectionVersion);
  const selCtx = selectorContext(ctx.def.meta.id, screen.elements);
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
              selCtx={selCtx}
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
function Reveal({ show, anim, rect, frame, dim, inert, rotate, flow, children }: {
  show: boolean;
  anim: ScreenElement['reveal'];
  rect: { x: number; y: number; w: number; h: number };
  frame?: React.CSSProperties;
  /** Keyboard spotlight: this element sits outside the held group. */
  dim?: boolean;
  /** Decorative kind (text/varText/shape): the wrapper never eats pointer
   *  events, so overlay labels can't shadow a button underneath. */
  inert?: boolean;
  /** Rotation in degrees about the element's centre. */
  rotate?: number;
  /** The PARENT's flow layout when this element is a flowed child: the
   *  wrapper drops absolute left/top and lets flex/grid place it. */
  flow?: FlowLayout;
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
  // Rotation composes with any transform the frame already carries (a
  // collapsible slide-in), spinning about the element's own centre.
  const spin = rotate !== undefined && rotate !== 0 ? `rotate(${rotate}deg)` : null;
  const transform = [frame?.transform, spin].filter(Boolean).join(' ') || undefined;
  // A flowed child drops absolute positioning: flex/grid places it. Explicit
  // `flex` overrides `.rn-el > * { flex: 1 }` so item sizing is respected.
  const pos: React.CSSProperties = flow
    ? flowChildCss(flow, rect)
    : { left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` };
  return (
    <div
      className={`rn-el${animClass}${dim === true ? ' rn-kb-dim' : ''}${inert === true ? ' rn-el-inert' : ''}`}
      style={{
        ...pos,
        ...frame,
        ...(transform ? { transform } : {}),
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
 * order is stable; non-collapsible elements just never read it. The storage
 * key is shared with the keyboard system (collapseStorageKey) so Enter's
 * first-button walk sees the same collapsed state this renderer does.
 */
function useCollapsed(defId: Id, elId: Id, startCollapsed: boolean): [boolean, () => void] {
  const key = collapseStorageKey(defId, elId);
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

function ElementView({ ctx, el, selCtx, screenW, buttonMove, onMove, root, flow }: {
  ctx: TableCtx;
  el: ScreenElement;
  /** Resolved selector selections for the ACTIVE screen (showForSelector gates). */
  selCtx: SelectorContext;
  screenW: number;
  buttonMove: ReadonlyMap<Id, Move>;
  onMove: (m: Move) => void;
  /** Top-level element (keyboard spotlight dims at this granularity). */
  root?: boolean;
  /** The parent's flow layout when this element is a flowed child. */
  flow?: FlowLayout;
}) {
  const spec = el.collapsible ?? null;
  const [collapsed, toggleCollapsed] = useCollapsed(
    ctx.def.meta.id, el.id, spec?.startCollapsed === true,
  );
  if (!elementRenders(ctx, el)) return null;
  // showForSelector composes with `visible`: both must hold, and a gate flip
  // plays the element's reveal transition exactly like a visibility toggle.
  const show = isDisplayVisible(ctx.def, ctx.state, el.visible ?? null, ctx.viewerId)
    && selectorGateOpen(selCtx, el);
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
  // shapes and lines paint their own geometry; BUTTONS carry their fill/border/
  // shape on the <button> itself (inline) so an authored Fill beats the skin's
  // plate CSS instead of hiding behind an opaque button background.
  const ownChrome = el.kind === 'zone' || el.kind === 'shape' || el.kind === 'line'
    || el.kind === 'button';
  // A container that FLOWS its own children (Grid/Row/Column groups) gets the
  // flex/grid CSS on its box. Slotted containers (panelSwitcher) flow PER SLOT
  // instead, so they don't take container flow here.
  const containerFlow = el.kind !== 'zone' && el.layout != null
    && !(el.slots !== undefined && el.slots.length > 0);
  const frame = ownChrome
    ? undefined
    : {
        ...(layoutStyleCss(app.style) as React.CSSProperties),
        ...(containerFlow ? (flowLayoutCss(el.layout, screenW) as React.CSSProperties) : {}),
      };
  let body = (
    <ElementBody
      ctx={ctx}
      el={el}
      selCtx={selCtx}
      style={app.style}
      screenW={screenW}
      buttonMove={buttonMove}
      onMove={onMove}
    />
  );
  // Child elements (any kind, not just groups): drawn on top of the parent's
  // box, % of its rect. Groups and panelSwitchers render theirs inside
  // ElementBody already (flow / slots aware).
  if (el.kind !== 'group' && el.kind !== 'panelSwitcher' && el.children && el.children.length > 0) {
    body = (
      <>
        {body}
        {el.children.map((child) => (
          <ElementView
            key={child.id}
            ctx={ctx}
            el={child}
            selCtx={selCtx}
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
  // Display-only kinds never intercept pointer events (a seal label overlay
  // must not eat the plate button's clicks); zone/button/log/group stay
  // interactive, and interactive CHILDREN of a decorative element win their
  // events back via CSS (.rn-el-inert). The collapsible tab/close buttons
  // render outside this wrapper, so collapsibles keep working either way.
  const inert = el.kind === 'text' || el.kind === 'varText' || el.kind === 'shape' || el.kind === 'line';
  return (
    <>
      <Reveal
        show={show}
        anim={el.reveal}
        rect={app.rect}
        frame={spec ? { ...frame, zIndex: 30 } : frame}
        dim={dim}
        inert={inert}
        rotate={el.rotation}
        flow={flow}
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
        ...textStyleCss(el),
        fontWeight: el.fontWeight ?? (el.bold ? 800 : 600),
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

interface ChildCommon {
  ctx: TableCtx;
  selCtx: SelectorContext;
  screenW: number;
  buttonMove: ReadonlyMap<Id, Move>;
  onMove: (m: Move) => void;
}

/**
 * A container's children, laid out by (in priority): its SLOTS — each an
 * absolutely-positioned region that flows its own children — else its flow
 * `layout` — else absolute rects (today's default). The single place both the
 * group and panelSwitcher branches route children.
 */
function ContainerChildren({ el, common }: { el: ScreenElement; common: ChildCommon }) {
  const kids = el.children ?? [];
  if (el.slots !== undefined && el.slots.length > 0) {
    return (
      <>
        {el.slots.map((slot) => {
          const region = slotRect(el, slot.id);
          return (
            <div
              key={slot.id}
              className="rn-slot"
              style={{
                position: 'absolute',
                left: `${region.x}%`,
                top: `${region.y}%`,
                width: `${region.w}%`,
                height: `${region.h}%`,
                ...(flowLayoutCss(slot.layout, common.screenW) as React.CSSProperties),
              }}
            >
              {kids.filter((c) => c.slotId === slot.id).map((child) => (
                <ElementView key={child.id} el={child} flow={slot.layout} {...common} />
              ))}
            </div>
          );
        })}
      </>
    );
  }
  const flow = el.layout ?? undefined;
  return (
    <>
      {kids.map((child) => (
        <ElementView key={child.id} el={child} flow={flow} {...common} />
      ))}
    </>
  );
}

function ElementBody({ ctx, el, selCtx, style, screenW, buttonMove, onMove }: {
  ctx: TableCtx;
  el: ScreenElement;
  selCtx: SelectorContext;
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
            pileFace: el.pileFace,
            collapseDuplicates: el.collapseDuplicates,
            fanAngle: el.fanAngle,
            // Depleted-pile memory is per rendering element: slices of one
            // shared zone must not ghost each other's depleted piles.
            memoryKey: el.id,
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
            ...textStyleCss(el),
            fontWeight: el.fontWeight ?? (el.bold ? 800 : 600),
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
      // The button paints its OWN chrome inline: authored fill/border/radius/
      // shadow (layoutStyleCss) + custom silhouette (shape) + typography. Inline
      // wins over the .rn-sl-btn class and any skin plate, so a Fill shows.
      const shapeCss: React.CSSProperties = {};
      if (el.shape && el.shape !== 'rect') {
        const clip = shapeClipPath(el.shape);
        if (clip) shapeCss.clipPath = clip;
        const r = shapeBorderRadius(el.shape, style);
        if (r !== undefined) shapeCss.borderRadius = r;
      }
      const btnStyle = {
        fontSize,
        ...(layoutStyleCss(style) as React.CSSProperties),
        ...shapeCss,
        ...textStyleCss(el),
      };
      if (el.role === 'selector') {
        // Selector buttons NEVER perform a game action (actionId is ignored):
        // clicking writes the group's client-side selection; the active one
        // carries rn-sel-on (neutral runner dress — skins restyle it).
        const group = (el.selectorGroup ?? '').trim();
        if (group === '') {
          // No group — validation warns; render inert (nothing to switch).
          return <div className="rn-sl-btn rn-sl-deco" style={btnStyle}>{el.label}</div>;
        }
        const on = selCtx.active.get(group) === el.id;
        return (
          <button
            type="button"
            className={`rn-sl-btn rn-sel${on ? ' rn-sel-on' : ''}`}
            style={btnStyle}
            aria-pressed={on}
            onClick={() => writeSelection(def.meta.id, group, el.id)}
          >
            {el.label}
          </button>
        );
      }
      if (el.actionId === null) {
        return <div className="rn-sl-btn rn-sl-deco" style={btnStyle}>{el.label}</div>;
      }
      const move = buttonMove.get(el.actionId);
      const isPass = el.actionId === PASS_ACTION_ID;
      return (
        <button
          type="button"
          className={`rn-sl-btn${isPass && move ? ' rn-sl-pass' : ''}`}
          style={btnStyle}
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
      const polygon = shapePolygon(el.shape);
      if (polygon !== null) {
        // A polygon stretched by viewBox keeps the shape axis-aligned in
        // non-square rects; non-scaling-stroke keeps the border width in px.
        const hasBorder = style?.borderWidth !== undefined || style?.borderColor !== undefined
          || style?.borderStyle !== undefined;
        const strokeW = hasBorder ? (style?.borderWidth ?? 1) : 0;
        const dash = style?.borderStyle === 'dashed' ? '6 4'
          : style?.borderStyle === 'dotted' ? '1.5 3' : undefined;
        return (
          <div className={`rn-sl-shape rn-sl-${el.shape}`} style={{ opacity: style?.opacity }}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <polygon
                points={polygon}
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

    case 'image':
      return el.src
        ? (
          <img
            className="rn-sl-img"
            src={el.src}
            alt={el.alt ?? el.name}
            style={{ width: '100%', height: '100%', objectFit: el.fit ?? 'contain', display: 'block' }}
          />
        )
        : <div className="rn-img-empty" aria-label={el.alt ?? el.name} />;

    case 'group':
    case 'panelSwitcher':
      return (
        <ContainerChildren
          el={el}
          common={{ ctx, selCtx, screenW, buttonMove, onMove }}
        />
      );
  }
}

