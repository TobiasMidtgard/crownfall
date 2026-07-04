/**
 * ScreenCanvas — the screen builder's stage: ONE zoomable/pannable surface
 * that IS the player's whole game screen (no seat strip). Gestures (ported
 * from the proven v3 canvas):
 *   - drag an element to move (1% snap + smart alignment guides), the
 *     bottom-right handle resizes; dragging a multi-selection moves it as one
 *   - drag empty canvas / space-drag / two-finger = pan; pinch & ctrl-wheel
 *     zoom (25-200%), toolbar − / % / + / Fit / ⛶ and the ASPECT preset
 *   - drop targets resolve to the DEEPEST group under the pointer (hover
 *     highlight); dropping joins, dragging out leaves — groups nest
 *   - shift-click toggles multi-select; clicking empty felt clears it
 *   - double-click/double-tap an element = FOCUS MODE: the element becomes
 *     the whole surface (its chrome as the backdrop) and its CHILDREN are
 *     edited with 1%-of-its-box snapping — super fine detail. A breadcrumb
 *     above the canvas walks back out (Screen › … ; Esc pops one level).
 *
 * Elements preview representatively: zone slot grids honor the REAL layout
 * kind + cardScale/padding/gap/rows/columns (same geometry helpers as the
 * runner via screenModel → layoutGeometry), text/varText/button render with
 * sample values, shapes/lines draw their real chrome (circle/diamond/pill,
 * orient/thickness/dash/arrows), and ƒx-conditional elements dim to 40% with
 * a chip — never invisible in the editor. Elements with reactive STATES show
 * their base appearance plus a ⚡ chip; `statePreview` (editor-only, set from
 * the Properties panel) renders one state's merged style+rect instead.
 *
 * LIVE PREVIEW (toolbar toggle, default ON, remembered for the session in
 * memory only): a headless sample game (sampleState.ts — 2 seats, seed 7)
 * lets the canvas resolve each element EXACTLY like the runner, viewer =
 * sample seat p0: `visible` expressions hide elements (a selected-but-hidden
 * element paints as a dashed ghost outline so Layers picks stay editable),
 * states pick the live rect/style, zone counts/piles read the real sample
 * cards, and varText/text parts interpolate real values. Collapsibles render
 * as their collapsed dock tab with an expand-for-editing toggle while
 * selected (canvas-local). Preview OFF — or a sample the setup fails to
 * build (toggle disabled + notice chip) — is exactly the classic
 * show-everything behavior. `showForSelector` is NOT resolved here yet: the
 * wave-3 selector work composes its gating into the same visibility path.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameDef, GameState, Id, LayoutStyle, ScreenElement, ScreenLayout } from '../../../shared/types';
import { exprToText } from '../../blocks/exprToText';
import { formatVarValue, renderTextParts, varTextValue } from '../../../runner/layout';
import { elementCollapsed } from '../../../runner/keyboard';
import { activeScreenVariant, resolveElementAppearance } from '../../../runner/layoutGeometry';
import { SAMPLE_VIEWER_ID, buildSampleState, sampleSignature } from './sampleState';
import { PreviewStage } from './PreviewStage';
import {
  ASPECT_VALUES, GROUP_MIN, MIN_H, MIN_W, PHONE_ASPECT, absToGroupRel, applyElementState,
  aspectPresetOf, boundingRect, deepestGroupAt, fanMarginPx, fitCount, groupRelToAbs,
  indexElements, layoutStyleCss, pathToEl, pctToPx, previewShownMap, pruneNested,
  resolveDropParent, selectorHiddenIds, variantElements, withDescendants, zonePreview,
  zoneSampleCount,
  type AspectPreset, type PlainRect, type VariantKey, type ZonePreview,
} from './screenModel';
import { shapeBorderRadius, shapeClipPath } from '../../../runner/layoutGeometry';

/** Logical stage width in px at zoom 1. Rects are % of the screen. */
export const SCREEN_W = 1000;
const ROOT_RECT: PlainRect = { x: 0, y: 0, w: 100, h: 100 };
const NO_ELEMENTS: ScreenElement[] = [];

/** Double-tap window for entering focus mode (ms between taps on one element). */
const DOUBLE_TAP_MS = 400;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.25;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Preview-toggle memory for THIS SESSION only (per the spec — never stored). */
let previewSessionDefault = true;

/**
 * The def's sample snapshot for the live preview: undefined while (briefly)
 * building, null when the setup failed (preview unavailable). Memoized per
 * def identity inside buildSampleState, so redraws are free.
 */
function useSampleState(def: GameDef): GameState | null | undefined {
  const [snap, setSnap] = useState<{ sig: string; state: GameState | null } | null>(null);
  const sig = useMemo(() => sampleSignature(def), [def]);
  useEffect(() => {
    let alive = true;
    void buildSampleState(def).then((state) => {
      if (alive) setSnap({ sig, state });
    });
    return () => {
      alive = false;
    };
  }, [def, sig]);
  // Keep the LAST resolved sample visible while a rebuild is pending — never
  // blank to the grey tt-* fallback mid-drop. `undefined` only before the very
  // first sample resolves; a screen-layout-only edit keeps the same signature,
  // so the cached sample resolves to the same object and nothing flickers.
  return snap === null ? undefined : snap.state;
}

/** Alignment-guide snap distance, % of the screen. */
const ALIGN_EPS = 0.7;

interface ViewState { x: number; y: number; z: number }
interface Guide { axis: 'v' | 'h'; pos: number }

interface DragState {
  mode: 'move' | 'resize';
  /** Pruned set being dragged (move) or the single resized id. */
  ids: Id[];
  primary: Id;
  startX: number;
  startY: number;
  /** px per screen-% at drag start. */
  scaleX: number;
  scaleY: number;
  /** Screen surface client origin at drag start (pointer -> screen %). */
  originX: number;
  originY: number;
  origs: { id: Id; abs: PlainRect }[];
  bbox: PlainRect;
  /** ids + their descendants (excluded from snap targets / drop targets). */
  exclude: Set<Id>;
  /** Single move drags may change parents on drop. */
  reparentable: boolean;
  origParentId: Id | null;
  /** Tap on an already-multi-selected element collapses to it on release. */
  tapCollapse: boolean;
  /** Double-tap disambiguation: touch zooms-to-fit, mouse enters focus mode. */
  pointerType: string;
  moved: boolean;
}

interface LiveState {
  mode: 'move' | 'resize';
  ids: Id[];
  rects: Record<Id, PlainRect>;
  hoverGroupId: Id | null;
  guides: Guide[];
}

export interface DragCommit {
  rects: { id: Id; abs: PlainRect }[];
  /** Resolved drop parent for a single moved element (null = the screen); undefined = keep parent. */
  targetGroupId?: Id | null;
}

export interface ScreenCanvasProps {
  def: GameDef;
  layout: ScreenLayout;
  /** Which layout variant the stage shows/edits. */
  variant: VariantKey;
  /** Whether layout.mobile exists (the toolbar toggle offers "+ Mobile"). */
  mobileExists: boolean;
  onVariant: (v: VariantKey) => void;
  sel: Id[];
  onSelect: (ids: Id[]) => void;
  onToggleSelect: (id: Id) => void;
  onCommitDrag: (commit: DragCommit) => void;
  /** Patch one element in place (rotation handle, direct-manipulation edits). */
  onPatchEl: (id: Id, fn: (el: ScreenElement) => ScreenElement) => void;
  onAspect: (preset: AspectPreset) => void;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  /** Editor-only: render this element with one state's merged style+rect. */
  statePreview?: { id: Id; stateId: Id } | null;
  /** FOCUS MODE: id chain root → focused element ([] = whole screen). */
  focusPath: Id[];
  /** Breadcrumb jumps / double-click descend / ✕ Exit focus. */
  onFocusPath: (path: Id[]) => void;
}

export function ScreenCanvas({
  def, layout, variant, mobileExists, onVariant, sel, onSelect, onToggleSelect, onCommitDrag,
  onPatchEl, onAspect, fullscreen, onToggleFullscreen, statePreview = null, focusPath, onFocusPath,
}: ScreenCanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewState>({ x: 12, y: 12, z: 0.5 });

  // ----- live preview (headless sample game) ---------------------------------
  const sample = useSampleState(def);
  const [preview, setPreview] = useState(previewSessionDefault);
  const togglePreview = () => setPreview((p) => {
    previewSessionDefault = !p;
    return !p;
  });
  // Collapsibles temporarily expanded FOR EDITING despite preview (canvas-local).
  const [pvExpanded, setPvExpanded] = useState<ReadonlySet<Id>>(new Set());
  const pvState = preview && sample != null ? sample : null;

  const isMobile = variant === 'mobile';
  const preset = aspectPresetOf(layout);
  const aspect = ASPECT_VALUES[preset] ?? 16 / 9;
  /** Phone viewport height at SCREEN_W (the 9:19.5 frame). */
  const frameH = Math.round(SCREEN_W / PHONE_ASPECT);
  // Mobile: the page is the variant's aspect (scroll pages run taller than
  // the frame); no aspect = exactly one phone screen.
  const pageH = isMobile
    ? Math.round(SCREEN_W / (layout.mobile?.aspect ?? PHONE_ASPECT))
    : Math.round(SCREEN_W / aspect);
  const background = isMobile ? layout.mobile?.background : layout.background;

  const fullElements = variantElements(layout, variant);

  // ----- focus mode: resolve the path; the surface becomes the focused element ---
  const focusTrail: ScreenElement[] = [];
  {
    let level = fullElements;
    for (const id of focusPath) {
      const hit = level.find((e) => e.id === id);
      if (!hit) break;
      focusTrail.push(hit);
      level = hit.children ?? [];
    }
  }
  const focusEl = focusTrail.length > 0 && focusTrail.length === focusPath.length
    ? focusTrail[focusTrail.length - 1]
    : null;

  // The editing tree: the focused element's children, or the whole variant.
  const elements = focusEl ? focusEl.children ?? NO_ELEMENTS : fullElements;

  // ----- real-render preview layer (the runner's ScreenRenderer) -------------
  // With the live preview ON and NOT in focus mode, the runner's own
  // ScreenRenderer paints behind the editor overlay (PreviewStage). The
  // overlay's element bodies then render EMPTY so the true render shows
  // through; only selection outlines, handles, ghosts and guides remain.
  // Focus mode keeps the representative tt-* bodies (the ScreenRenderer draws
  // the whole screen, not one element's magnified interior).
  const previewMode = pvState !== null;
  // The active variant tree for the ScreenRenderer, matching what the canvas
  // edits (desktop vs mobile) — never ScreenRenderer's own media query.
  const activeScreen = useMemo(
    () => activeScreenVariant(layout, variant === 'mobile'),
    [layout, variant],
  );

  // Surface dims. Focused: the stage takes the element's real on-screen
  // aspect, and `unitW` rescales %-of-screen-width units (fontSize, card
  // scale, padding) so previews keep their true relative size, magnified.
  let screenH = pageH;
  let unitW = SCREEN_W;
  let focusAbs: PlainRect | null = null;
  if (focusEl) {
    focusAbs = indexElements(fullElements).get(focusEl.id)?.abs ?? null;
    if (focusAbs) {
      const pxW = Math.max(1, (focusAbs.w / 100) * SCREEN_W);
      const pxH = Math.max(1, (focusAbs.h / 100) * pageH);
      screenH = Math.round(SCREEN_W * (pxH / pxW));
      unitW = SCREEN_W * (100 / Math.max(0.01, focusAbs.w));
    }
  }
  // Focus mode + live preview: the real ScreenRenderer paints the WHOLE screen,
  // sized so the focused element's sub-rect exactly fills the focus frame (the
  // .tt-screen is the element). unitW is the full screen's width in this space;
  // fullH its height; the negative offsets slide the element's corner to the
  // frame origin. The child overlay boxes (% of the frame) then land on the
  // real children, so the detailed view shows the exact in-game components.
  const focusPvFull = focusEl && focusAbs
    ? {
        w: unitW,
        h: (screenH * 100) / Math.max(0.01, focusAbs.h),
        left: -(focusAbs.x / 100) * unitW,
        top: -(focusAbs.y / 100) * ((screenH * 100) / Math.max(0.01, focusAbs.h)),
      }
    : null;
  const scrollPage = !focusEl && isMobile && layout.mobile?.scroll === true && screenH > frameH + 1;

  const index = useMemo(() => indexElements(elements), [elements]);
  const selSet = useMemo(() => new Set(sel), [sel]);
  // Elements hidden by a closed selector gate: never drop targets and never
  // snap targets. Keeps a drag inside the selector panel the user can actually
  // see, instead of silently re-nesting into a stacked, hidden sibling panel.
  const selectorHidden = useMemo(
    () => selectorHiddenIds(def, fullElements, sel),
    [def, fullElements, sel],
  );

  // Runner-parity visibility per element (null = preview off): dangling
  // refs / unresolvable seats / falsy `visible` / closed showForSelector
  // gates, viewer = sample seat p0. Selector gates resolve against the FULL
  // variant tree; the editor selection (`sel`) overrides the persisted
  // selection store, so clicking a selector button on the canvas switches
  // its group's panels live (previewShownMap documents the precedence).
  const pvVisibleMap = useMemo(() => {
    if (pvState === null) return null;
    return previewShownMap(def, pvState, index, fullElements, SAMPLE_VIEWER_ID, sel);
  }, [pvState, index, def, fullElements, sel]);

  /**
   * The preview actually paints this element: it and every ancestor pass
   * visibility, and no ancestor sits collapsed as a dock tab. Selected
   * elements failing this get the dashed ghost outline instead.
   */
  const pvReachable = (id: Id): boolean => {
    if (pvVisibleMap === null) return true;
    let cur: Id | null = id;
    while (cur !== null) {
      if (pvVisibleMap.get(cur) === false) return false;
      const info = index.get(cur);
      if (!info) return false;
      if (cur !== id && info.el.collapsible != null && !pvExpanded.has(cur)) return false;
      cur = info.parentId;
    }
    return true;
  };

  /** Double-click/tap descend: focus the element (full path from the root). */
  const focusElement = (id: Id) => {
    const sub = pathToEl(elements, id);
    if (sub) onFocusPath([...(focusEl ? focusPath : []), ...sub]);
  };

  // ----- fit / zoom ---------------------------------------------------------

  const fit = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    // Tall scroll pages fit to the phone FRAME — pan/scroll reaches the rest.
    const fitH = isMobile && !focusEl ? Math.min(screenH, frameH) : screenH;
    const z = clampZoom(Math.min((rect.width - 24) / SCREEN_W, (rect.height - 48) / fitH));
    setView({
      z,
      x: Math.max(12, (rect.width - SCREEN_W * z) / 2),
      y: Math.max(30, (rect.height - fitH * z) / 2),
    });
  };
  const fitRef = useRef(fit);
  fitRef.current = fit;

  useEffect(() => { fitRef.current(); }, []);
  const focusKey = focusPath.join('>');
  useEffect(() => {
    const raf = requestAnimationFrame(() => fitRef.current());
    return () => cancelAnimationFrame(raf);
  }, [fullscreen, preset, variant, focusKey]);

  /** Center + zoom the view onto one element (touch double-tap). */
  const zoomToFitEl = (id: Id) => {
    const info = index.get(id);
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!info || !rect || rect.width === 0) return;
    const pxW = Math.max(1, (info.abs.w / 100) * SCREEN_W);
    const pxH = Math.max(1, (info.abs.h / 100) * screenH);
    const z = clampZoom(Math.min((rect.width - 48) / pxW, (rect.height - 64) / pxH));
    const cx = ((info.abs.x + info.abs.w / 2) / 100) * SCREEN_W;
    const cy = ((info.abs.y + info.abs.h / 2) / 100) * screenH;
    setView({ z, x: rect.width / 2 - cx * z, y: rect.height / 2 - cy * z });
  };

  const zoomBy = (factor: number) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    setView((v) => {
      const z = clampZoom(v.z * factor);
      const k = z / v.z;
      return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  // ----- space-held pan modifier --------------------------------------------

  const spaceRef = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest?.('input, select, textarea, button, [contenteditable]')) return;
      spaceRef.current = true;
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') spaceRef.current = false; };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ----- element drag (move / resize) ----------------------------------------

  const dragRef = useRef<DragState | null>(null);
  // Mirrored in a ref so pointerup reads the freshest value (state batches).
  const liveRef = useRef<LiveState | null>(null);
  const [live, setLiveState] = useState<LiveState | null>(null);
  const setLive = (v: LiveState | null) => {
    liveRef.current = v;
    setLiveState(v);
  };
  // Live rotation while the knob is dragged (committed to the def on release).
  const [liveRotate, setLiveRotate] = useState<{ id: Id; deg: number } | null>(null);

  /**
   * Drag the rotation knob: spin the element about its centre. The centre in
   * client space is rotation-invariant, so we read it once; each move sets the
   * angle from centre→pointer (knob at the element's top = 0°). Shift snaps 15°.
   */
  const startRotate = (e: React.PointerEvent, id: Id, abs: PlainRect) => {
    if (spaceRef.current || dragRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    const r = screenRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const cx = r.left + ((abs.x + abs.w / 2) / 100) * r.width;
    const cy = r.top + ((abs.y + abs.h / 2) / 100) * r.height;
    const pointerId = e.pointerId;
    const at = (px: number, py: number, shift: boolean) => {
      let deg = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
      deg = ((Math.round(deg) % 360) + 360) % 360;
      if (shift) deg = Math.round(deg / 15) * 15;
      setLiveRotate({ id, deg });
    };
    at(e.clientX, e.clientY, e.shiftKey);
    const onMove = (ev: PointerEvent) => { if (ev.pointerId === pointerId) at(ev.clientX, ev.clientY, ev.shiftKey); };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setLiveRotate((cur) => {
        const deg = cur?.id === id ? cur.deg : null;
        if (deg !== null) onPatchEl(id, (c) => ({ ...c, rotation: deg === 0 ? undefined : deg }));
        return null;
      });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  /**
   * Element drags listen on WINDOW for the pointer stream: the dragged element
   * may be re-rendered/re-parented mid-drag (group member -> screen-level
   * ghost), so element-local listeners would lose the drag.
   */
  const detachRef = useRef<(() => void) | null>(null);
  useEffect(() => () => detachRef.current?.(), []);

  const startDrag = (e: React.PointerEvent, id: Id, mode: 'move' | 'resize') => {
    if (spaceRef.current || dragRef.current) return; // space = pan instead
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey && mode === 'move') {
      onToggleSelect(id);
      return;
    }
    const info = index.get(id);
    const r = screenRef.current?.getBoundingClientRect();
    if (!info || !r || r.width === 0 || r.height === 0) return;

    let ids: Id[];
    let tapCollapse = false;
    if (mode === 'move' && sel.length > 1 && selSet.has(id)) {
      ids = pruneNested(index, sel);
      tapCollapse = true;
    } else {
      ids = [id];
      if (!(selSet.has(id) && sel.length === 1)) onSelect([id]);
    }
    const origs = ids
      .map((x) => ({ id: x, abs: index.get(x)?.abs }))
      .filter((o): o is { id: Id; abs: PlainRect } => o.abs !== undefined);
    if (origs.length === 0) return;

    dragRef.current = {
      mode,
      ids: origs.map((o) => o.id),
      primary: id,
      startX: e.clientX,
      startY: e.clientY,
      scaleX: r.width / 100,
      scaleY: r.height / 100,
      originX: r.left,
      originY: r.top,
      origs,
      bbox: boundingRect(origs.map((o) => o.abs)),
      exclude: new Set([
        ...withDescendants(index, origs.map((o) => o.id)),
        ...selectorHidden,
      ]),
      reparentable: mode === 'move' && origs.length === 1,
      origParentId: info.parentId,
      tapCollapse,
      pointerType: e.pointerType,
      moved: false,
    };
    const pointerId = e.pointerId;
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) moveDragAt(ev.clientX, ev.clientY);
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      detachRef.current?.();
      endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    detachRef.current = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      detachRef.current = null;
    };
  };

  /**
   * Other elements' edges/centers + the surface center: snap targets. While
   * FOCUSED the surface is the element itself, so its edges (0/100) join in
   * — guides against the element's edges/center and sibling children.
   */
  const alignTargets = (exclude: ReadonlySet<Id>): { xs: number[]; ys: number[] } => {
    const xs: number[] = focusEl ? [0, 50, 100] : [50];
    const ys: number[] = focusEl ? [0, 50, 100] : [50];
    for (const [id, info] of index) {
      if (exclude.has(id)) continue;
      xs.push(info.abs.x, info.abs.x + info.abs.w / 2, info.abs.x + info.abs.w);
      ys.push(info.abs.y, info.abs.y + info.abs.h / 2, info.abs.y + info.abs.h);
    }
    return { xs, ys };
  };

  /** Align a moved span: snap edge/center to the nearest target within eps. */
  const alignMove = (raw: number, span: number, targets: number[]): { v: number; guide: number | null } => {
    let best: { dist: number; v: number; guide: number } | null = null;
    for (const t of targets) {
      for (const off of [0, span / 2, span]) {
        const dist = Math.abs(raw + off - t);
        if (dist <= ALIGN_EPS && (best === null || dist < best.dist)) {
          best = { dist, v: t - off, guide: t };
        }
      }
    }
    if (best) {
      return { v: Math.min(Math.max(best.v, 0), Math.max(0, 100 - span)), guide: best.guide };
    }
    return { v: Math.round(raw), guide: null };
  };

  /** Align a resized edge (right/bottom) to the nearest target within eps. */
  const alignEdge = (rawEdge: number, base: number, minSpan: number, targets: number[]): { v: number; guide: number | null } => {
    let best: { dist: number; edge: number } | null = null;
    for (const t of targets) {
      const dist = Math.abs(rawEdge - t);
      if (dist <= ALIGN_EPS && (best === null || dist < best.dist)) best = { dist, edge: t };
    }
    const edge = best ? best.edge : Math.round(rawEdge);
    const span = Math.max(minSpan, Math.min(100 - base, edge - base));
    return { v: span, guide: best && span === best.edge - base ? best.edge : null };
  };

  const moveDragAt = (clientX: number, clientY: number) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (clientX - d.startX) / d.scaleX;
    const dy = (clientY - d.startY) / d.scaleY;
    if (!d.moved && Math.hypot(clientX - d.startX, clientY - d.startY) < 3) return;
    d.moved = true;

    const { xs, ys } = alignTargets(d.exclude);
    const guides: Guide[] = [];
    const rects: Record<Id, PlainRect> = {};

    if (d.mode === 'move') {
      const rawX = Math.min(Math.max(d.bbox.x + dx, 0), Math.max(0, 100 - d.bbox.w));
      const rawY = Math.min(Math.max(d.bbox.y + dy, 0), Math.max(0, 100 - d.bbox.h));
      const ax = alignMove(rawX, d.bbox.w, xs);
      const ay = alignMove(rawY, d.bbox.h, ys);
      if (ax.guide !== null) guides.push({ axis: 'v', pos: ax.guide });
      if (ay.guide !== null) guides.push({ axis: 'h', pos: ay.guide });
      const offX = ax.v - d.bbox.x;
      const offY = ay.v - d.bbox.y;
      for (const o of d.origs) {
        rects[o.id] = { x: o.abs.x + offX, y: o.abs.y + offY, w: o.abs.w, h: o.abs.h };
      }
    } else {
      const orig = d.origs[0].abs;
      const isGroup = index.get(d.primary)?.el.kind === 'group';
      const minW = isGroup ? GROUP_MIN : MIN_W;
      const minH = isGroup ? GROUP_MIN : MIN_H;
      const aw = alignEdge(orig.x + orig.w + dx, orig.x, minW, xs);
      const ah = alignEdge(orig.y + orig.h + dy, orig.y, minH, ys);
      if (aw.guide !== null) guides.push({ axis: 'v', pos: aw.guide });
      if (ah.guide !== null) guides.push({ axis: 'h', pos: ah.guide });
      rects[d.primary] = { x: orig.x, y: orig.y, w: aw.v, h: ah.v };
    }

    // Drop-to-join: the deepest group under the POINTER (single move only).
    let hoverGroupId: Id | null = null;
    if (d.reparentable) {
      const px = (clientX - d.originX) / d.scaleX;
      const py = (clientY - d.originY) / d.scaleY;
      hoverGroupId = deepestGroupAt(index, px, py, d.exclude);
    }

    setLive({ mode: d.mode, ids: d.ids, rects, hoverGroupId, guides });
  };

  // Two quick non-drag taps on one element: mouse double-click = FOCUS it,
  // touch double-tap = ZOOM-TO-FIT it (spec §4 mobile light fixes). Touch
  // never synthesizes dblclick here because pointerdown is prevented.
  const lastTapRef = useRef<{ id: Id; t: number } | null>(null);
  // Empty-canvas touch double-tap = Fit.
  const lastBgTapRef = useRef<number | null>(null);

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    const l = liveRef.current;
    if (d && d.moved && l) {
      // Reparent only when the drop lands in a DIFFERENT visible group; dropping
      // onto its own parent (or a null hover still over the parent's box) is a
      // plain move, never a re-append that reorders siblings or a jump to root.
      const targetGroupId = resolveDropParent({
        reparentable: d.reparentable,
        hoverGroupId: l.hoverGroupId,
        origParentId: d.origParentId,
        primaryRect: l.rects[d.primary],
        origParentAbs: d.origParentId !== null ? index.get(d.origParentId)?.abs : undefined,
      });
      onCommitDrag({
        rects: d.ids
          .filter((id) => l.rects[id] !== undefined)
          .map((id) => ({ id, abs: l.rects[id] })),
        targetGroupId,
      });
      lastTapRef.current = null;
    } else if (d && !d.moved) {
      if (d.tapCollapse) onSelect([d.primary]);
      const now = Date.now();
      const last = lastTapRef.current;
      if (d.mode === 'move' && last && last.id === d.primary && now - last.t < DOUBLE_TAP_MS) {
        lastTapRef.current = null;
        if (d.pointerType === 'touch') zoomToFitEl(d.primary);
        else focusElement(d.primary);
      } else {
        lastTapRef.current = { id: d.primary, t: now };
      }
    }
    setLive(null);
  };

  // ----- canvas pan & pinch ---------------------------------------------------

  const gestureRef = useRef<{
    pointers: Map<number, { x: number; y: number; sx: number; sy: number }>;
    moved: boolean;
    lastPinch: { x: number; y: number; dist: number } | null;
  }>({ pointers: new Map(), moved: false, lastPinch: null });

  const isBackground = (target: EventTarget | null) =>
    spaceRef.current
    || !(target instanceof Element && target.closest('.tt-el, .tt-handle, .tt-toolbar'));

  const onCanvasDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) return;
    if (!isBackground(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const g = gestureRef.current;
    viewportRef.current?.setPointerCapture(e.pointerId);
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (g.pointers.size === 1) g.moved = false;
    g.lastPinch = null;
  };

  const onCanvasMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    const p = g.pointers.get(e.pointerId);
    if (!p) return;
    if (g.pointers.size === 1) {
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (Math.hypot(e.clientX - p.sx, e.clientY - p.sy) > 5) g.moved = true;
      if (dx !== 0 || dy !== 0) setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
      g.pointers.set(e.pointerId, { ...p, x: e.clientX, y: e.clientY });
    } else if (g.pointers.size === 2) {
      g.pointers.set(e.pointerId, { ...p, x: e.clientX, y: e.clientY });
      g.moved = true;
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const [p1, p2] = [...g.pointers.values()];
      const mid = { x: (p1.x + p2.x) / 2 - rect.left, y: (p1.y + p2.y) / 2 - rect.top };
      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
      const last = g.lastPinch;
      if (last) {
        const factor = dist / Math.max(1, last.dist);
        setView((v) => {
          const z = clampZoom(v.z * factor);
          const k = z / v.z;
          return { z, x: mid.x - (last.x - v.x) * k, y: mid.y - (last.y - v.y) * k };
        });
      }
      g.lastPinch = { ...mid, dist };
    }
  };

  const onCanvasUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.delete(e.pointerId);
    g.lastPinch = null;
    if (g.pointers.size === 0 && !g.moved) {
      onSelect([]);
      // Touch double-tap on empty felt = Fit (mobile light fixes).
      if (e.pointerType === 'touch') {
        const now = Date.now();
        if (lastBgTapRef.current !== null && now - lastBgTapRef.current < DOUBLE_TAP_MS) {
          lastBgTapRef.current = null;
          fit();
        } else {
          lastBgTapRef.current = now;
        }
      }
    }
  };

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const factor = Math.exp(-e.deltaY * 0.0015);
        setView((v) => {
          const z = clampZoom(v.z * factor);
          const k = z / v.z;
          return { z, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
        });
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ----- rendering --------------------------------------------------------------

  const liveMoveSet = live?.mode === 'move' ? new Set(live.ids) : null;

  /**
   * One element (recursive for groups). `parentAbs` in screen %; `ghost`
   * renders the live-dragged copy at screen level in absolute coords.
   */
  const renderElement = (el: ScreenElement, parentAbs: PlainRect, ghost: boolean): JSX.Element | null => {
    if (!ghost && liveMoveSet?.has(el.id)) return null; // ghost renders at screen level
    // Live preview: hidden elements are NOT painted (a selected one gets a
    // ghost outline from the previewGhosts pass instead), like the runner.
    if (pvVisibleMap !== null && pvVisibleMap.get(el.id) === false) return null;
    // Appearance: the Properties panel's explicit state preview wins, else
    // the live preview resolves states against the sample (runner parity),
    // else the base look.
    const previewed = statePreview && statePreview.id === el.id
      ? applyElementState(el, statePreview.stateId)
      : pvState !== null
        ? resolveElementAppearance(def, pvState, el, SAMPLE_VIEWER_ID)
        : null;
    const rect = previewed ? previewed.rect : el.rect;
    const style = previewed ? previewed.style : el.style;
    let abs = groupRelToAbs(rect, parentAbs);
    let pos: PlainRect = rect;
    if (ghost) {
      abs = live?.rects[el.id] ?? abs;
      pos = abs;
    } else if (live?.mode === 'resize' && live.rects[el.id]) {
      abs = live.rects[el.id];
      pos = absToGroupRel(abs, parentAbs);
    }
    const isSel = selSet.has(el.id);
    // Live preview: a collapsible renders as its collapsed DOCK TAB (like the
    // runner) until expanded-for-editing while selected (canvas-local state).
    // Only draw the tab when the panel is ACTUALLY collapsed in the real render
    // (same resolution the runner uses) — a default-expanded panel is drawn by
    // the mounted ScreenRenderer as a full panel, so the editor must keep its
    // full-rect hit box there (not a mispositioned edge tab over empty felt).
    if (pvState !== null && !ghost && el.collapsible != null && !pvExpanded.has(el.id)
      && elementCollapsed(def.meta.id, el)) {
      const spec = el.collapsible;
      const vertical = spec.side === 'left' || spec.side === 'right';
      const center = vertical ? pos.y + pos.h / 2 : pos.x + pos.w / 2;
      return (
        <div
          key={el.id}
          className={`tt-el tt-ctab tt-ctab-${spec.side}${isSel ? ' tt-el-selected' : ''}`}
          style={vertical ? { top: `${center}%` } : { left: `${center}%` }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.shiftKey) onToggleSelect(el.id);
            else onSelect([el.id]);
          }}
          role="button"
          aria-label={`${el.name} — collapsed panel (preview); select for the expand toggle`}
        >
          <span className="tt-ctab-label">{spec.label || el.name}</span>
          {isSel && (
            <button
              type="button"
              className="tt-ctab-toggle"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setPvExpanded((s) => new Set(s).add(el.id))}
            >
              ⤢ Expand for editing
            </button>
          )}
        </div>
      );
    }
    const hover = live?.hoverGroupId === el.id;
    const conditional = el.visible != null;
    const hasStates = (el.states?.length ?? 0) > 0;
    // Non-group containers: chip the count (children are edited via focus).
    const childCount = el.kind === 'group' ? 0 : el.children?.length ?? 0;
    // Shapes/lines paint their chrome themselves (circle radius, line color).
    const ownChrome = el.kind === 'shape' || el.kind === 'line';
    const padPx = el.kind === 'zone' ? pctToPx(unitW, el.padding) : undefined;
    // Real-render preview: this .tt-el is a transparent HIT BOX only — its body
    // and chrome (background/border/padding from the kind class + inline style)
    // are suppressed so the ScreenRenderer painting behind shows through. The
    // ghost being dragged still shows its body so the drag reads clearly.
    const asHitbox = previewMode && !ghost;
    const cls = [
      'tt-el',
      `tt-el-${el.kind}`,
      asHitbox ? 'tt-el-pv' : '',
      isSel ? 'tt-el-selected' : '',
      hover ? 'tt-el-hover' : '',
      // Preview resolves ƒx visibility for real — no need to dim survivors.
      conditional && pvState === null ? 'tt-fx-dim' : '',
      ghost ? 'tt-el-drag' : '',
    ].filter(Boolean).join(' ');
    const rotDeg = liveRotate?.id === el.id ? liveRotate.deg : el.rotation;
    return (
      <div
        key={el.id}
        className={cls}
        style={{
          left: `${pos.x}%`, top: `${pos.y}%`, width: `${pos.w}%`, height: `${pos.h}%`,
          ...(rotDeg ? { transform: `rotate(${rotDeg}deg)` } : {}),
          // Hit-box mode: no inline chrome/padding — the real render is behind.
          ...(asHitbox || ownChrome ? {} : layoutStyleCss(style)),
          ...(!asHitbox && padPx !== undefined ? { padding: padPx } : {}),
          ...(ghost ? { zIndex: 1000 } : {}),
        }}
        onPointerDown={(e) => startDrag(e, el.id, 'move')}
        role="button"
        aria-label={`${el.name} — drag to move`}
      >
        {!asHitbox && (
          <ElementBody def={def} el={el} abs={abs} screenH={screenH} screenW={unitW} style={style} sample={pvState} />
        )}
        {el.children?.map((c) => renderElement(c, abs, false))}
        {pvState !== null && el.collapsible != null && isSel && !ghost && (
          <button
            type="button"
            className="tt-ctab-toggle tt-ctab-back"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => setPvExpanded((s) => {
              const next = new Set(s);
              next.delete(el.id);
              return next;
            })}
          >
            ⇥ Preview collapsed
          </button>
        )}
        {(conditional || hasStates || el.collapsible != null || childCount > 0) && (
          <span className="tt-chips" aria-hidden="true">
            {hasStates && <span className="tt-fx" title="Reactive states">⚡</span>}
            {conditional && <span className="tt-fx" title="Visible-when expression">ƒx</span>}
            {el.collapsible != null && <span className="tt-fx" title="Collapsible panel">⇥</span>}
            {childCount > 0 && (
              <span className="tt-fx" title={`${childCount} element${childCount === 1 ? '' : 's'} on top — double-click to edit`}>
                ▦{childCount}
              </span>
            )}
          </span>
        )}
        {isSel && sel.length === 1 && (
          <div
            className="tt-handle"
            onPointerDown={(e) => startDrag(e, el.id, 'resize')}
            aria-label={`Resize ${el.name}`}
          />
        )}
        {isSel && sel.length === 1 && !ghost && (
          <div
            className="tt-rotate-handle"
            onPointerDown={(e) => startRotate(e, el.id, abs)}
            title="Drag to rotate (Shift = 15°)"
            aria-label={`Rotate ${el.name}`}
          />
        )}
      </div>
    );
  };

  const ghosts = live?.mode === 'move'
    ? live.ids.map((id) => {
        const el = index.get(id)?.el;
        return el ? renderElement(el, ROOT_RECT, true) : null;
      })
    : null;

  const tag = focusEl
    ? `Focus — ${focusEl.name} (children snap to 1% of its box)`
    : isMobile
      ? scrollPage
        ? 'Mobile screen — scrolling page (phone 9:19.5)'
        : 'Mobile screen — phone 9:19.5'
      : preset === 'landscape'
        ? 'Game screen — landscape 16:9'
        : preset === 'portrait'
          ? 'Game screen — portrait 9:16'
          : 'Game screen — fills the player’s screen (16:9 preview)';

  // Focused element backdrop: its own chrome at full surface size, inert
  // (pointer-events: none) so empty-felt pan/click-clear keep working. With the
  // live preview on, the zoomed real ScreenRenderer draws it instead — this is
  // only the fallback when the preview is off / the sample failed.
  const backdrop = focusEl && !previewMode ? (() => {
    const previewed = statePreview && statePreview.id === focusEl.id
      ? applyElementState(focusEl, statePreview.stateId)
      : pvState !== null
        ? resolveElementAppearance(def, pvState, focusEl, SAMPLE_VIEWER_ID)
        : null;
    const bStyle = previewed ? previewed.style : focusEl.style;
    const ownChrome = focusEl.kind === 'shape' || focusEl.kind === 'line';
    const bPad = focusEl.kind === 'zone' ? pctToPx(unitW, focusEl.padding) : undefined;
    return (
      <div
        className={`tt-el tt-el-${focusEl.kind} tt-focus-backdrop`}
        style={{
          left: 0, top: 0, width: '100%', height: '100%',
          ...(ownChrome ? {} : layoutStyleCss(bStyle)),
          ...(bPad !== undefined ? { padding: bPad } : {}),
        }}
        aria-hidden="true"
      >
        <ElementBody def={def} el={focusEl} abs={ROOT_RECT} screenH={screenH} screenW={unitW} style={bStyle} sample={pvState} />
      </div>
    );
  })() : null;

  // Selected-but-hidden elements (Layers picks): dashed ghost outlines at
  // their absolute rects, still draggable/resizable so hidden things stay
  // editable while the preview is live.
  const previewGhosts = pvState !== null
    ? sel.filter((id) => index.has(id) && !pvReachable(id)).map((id) => {
        const info = index.get(id)!;
        const abs = live?.rects[id] ?? info.abs;
        return (
          <div
            key={`pv-${id}`}
            className="tt-el tt-pv-ghost tt-el-selected"
            style={{
              left: `${abs.x}%`, top: `${abs.y}%`, width: `${abs.w}%`, height: `${abs.h}%`, zIndex: 950,
            }}
            onPointerDown={(e) => startDrag(e, id, 'move')}
            role="button"
            aria-label={`${info.el.name} — hidden in preview; drag to move`}
          >
            <span className="tt-pv-ghost-tag">{info.el.name} · hidden</span>
            {sel.length === 1 && (
              <div
                className="tt-handle"
                onPointerDown={(e) => startDrag(e, id, 'resize')}
                aria-label={`Resize ${info.el.name}`}
              />
            )}
          </div>
        );
      })
    : null;

  return (
    <div className="tt-canvas-wrap">
      {focusEl && (
        <nav className="tt-crumbs" aria-label="Focus path">
          <button type="button" className="tt-crumb" onClick={() => onFocusPath([])}>
            Screen
          </button>
          {focusTrail.map((t, i) => (
            <span key={t.id} className="tt-crumb-seg">
              <span className="tt-crumb-sep" aria-hidden="true">›</span>
              {i === focusTrail.length - 1 ? (
                <span className="tt-crumb tt-crumb-current" aria-current="true">{t.name}</span>
              ) : (
                <button
                  type="button"
                  className="tt-crumb"
                  onClick={() => onFocusPath(focusPath.slice(0, i + 1))}
                >
                  {t.name}
                </button>
              )}
            </span>
          ))}
          <span className="tt-crumb-hint">double-click a child to refine it · Esc backs out</span>
        </nav>
      )}
      <div
        ref={viewportRef}
        className="tt-canvas"
        role="application"
        aria-label="Game screen canvas"
        onPointerDown={onCanvasDown}
        onPointerMove={onCanvasMove}
        onPointerUp={onCanvasUp}
        onPointerCancel={onCanvasUp}
      >
        <div
          className="tt-stage"
          style={{
            width: SCREEN_W,
            height: screenH,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
            // Inverse zoom: canvas controls (grips, chips, tabs) counter-scale
            // so their on-SCREEN hit areas stay ≥ 44px at any zoom.
            '--tt-hit': String(1 / view.z),
          } as React.CSSProperties}
        >
          <span className="tt-surface-tag" style={{ top: -26 }}>{tag}</span>
          <div
            ref={screenRef}
            className={isMobile && !focusEl ? 'tt-screen tt-screen-mobile' : 'tt-screen'}
            style={{
              width: SCREEN_W, height: screenH,
              ...(background && !focusEl ? { background } : {}),
            }}
          >
            {previewMode && pvState !== null && (
              focusPvFull ? (
                // Focus mode: the real render is the whole screen, sized + offset
                // so the focused element fills the frame, clipped to it.
                <div className="tt-preview-focusclip" aria-hidden="true">
                  <div
                    className="tt-preview-focuswrap"
                    style={{
                      width: focusPvFull.w, height: focusPvFull.h,
                      left: focusPvFull.left, top: focusPvFull.top,
                    }}
                  >
                    <PreviewStage def={def} sample={pvState} screen={activeScreen} />
                  </div>
                </div>
              ) : (
                <PreviewStage def={def} sample={pvState} screen={activeScreen} />
              )
            )}
            {backdrop}
            {elements.map((el) => renderElement(el, ROOT_RECT, false))}
            {ghosts}
            {previewGhosts}
            {scrollPage && (
              <div className="tt-fold" style={{ top: frameH }} aria-hidden="true">
                <span>phone screen ends — players scroll past this line</span>
              </div>
            )}
            {live?.guides.map((g, i) => (
              <div
                key={i}
                className={g.axis === 'v' ? 'tt-guide tt-guide-v' : 'tt-guide tt-guide-h'}
                style={g.axis === 'v' ? { left: `${g.pos}%` } : { top: `${g.pos}%` }}
                aria-hidden="true"
              />
            ))}
          </div>
        </div>
      </div>

      <div className="tt-toolbar">
        <div className="tt-seg tt-seg-small tt-variant-seg" role="group" aria-label="Layout variant">
          <button
            type="button"
            className={isMobile ? '' : 'tt-active'}
            onClick={() => onVariant('desktop')}
          >
            Desktop
          </button>
          <button
            type="button"
            className={isMobile ? 'tt-active' : ''}
            title={mobileExists ? 'Edit the mobile layout' : 'Create a mobile layout'}
            onClick={() => onVariant('mobile')}
          >
            {mobileExists ? 'Mobile' : '＋ Mobile'}
          </button>
        </div>
        {!isMobile && (
          <select
            className="select tt-aspect"
            aria-label="Screen aspect"
            value={preset}
            onChange={(e) => onAspect(e.target.value as AspectPreset)}
          >
            <option value="landscape">Landscape 16:9</option>
            <option value="portrait">Portrait 9:16</option>
            <option value="fill">Fill screen</option>
          </select>
        )}
        {focusEl && (
          <button
            type="button"
            className="btn btn-small"
            aria-label="Exit focus mode"
            title="Exit focus — back to the whole screen"
            onClick={() => onFocusPath([])}
          >
            ✕ Exit focus
          </button>
        )}
        <button
          type="button"
          className={pvState !== null ? 'btn btn-small tt-pv-btn tt-pv-live' : 'btn btn-small tt-pv-btn'}
          aria-pressed={preview}
          disabled={sample === null}
          title={sample === null
            ? 'Preview unavailable — the setup fails to run'
            : preview
              ? 'Live preview: visibility, states and counts resolve against a sample game. Click for the design view (everything paints).'
              : 'Design view: everything paints. Click to preview the live sample game.'}
          onClick={togglePreview}
        >
          {pvState !== null ? '◉ Preview' : '○ Preview'}
        </button>
        {sample === null && (
          <span className="tt-pv-chip" role="status">preview unavailable — setup errors</span>
        )}
        <button
          type="button"
          className="btn btn-small"
          aria-label="Zoom out"
          title="Zoom out"
          disabled={view.z <= MIN_ZOOM}
          onClick={() => zoomBy(1 / ZOOM_STEP)}
        >
          −
        </button>
        <span className="tt-zoom">{Math.round(view.z * 100)}%</span>
        <button
          type="button"
          className="btn btn-small"
          aria-label="Zoom in"
          title="Zoom in"
          disabled={view.z >= MAX_ZOOM}
          onClick={() => zoomBy(ZOOM_STEP)}
        >
          ＋
        </button>
        <button type="button" className="btn btn-small" aria-label="Fit to view" title="Fit to view" onClick={fit}>
          Fit
        </button>
        <button
          type="button"
          className="btn btn-small"
          aria-label={fullscreen ? 'Exit full screen' : 'Edit full screen'}
          title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
          onClick={onToggleFullscreen}
        >
          {fullscreen ? '✕' : '⛶'}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Element bodies — representative previews with sample values
// ---------------------------------------------------------------------------

type ZoneEl = Extract<ScreenElement, { kind: 'zone' }>;
type TextEl = Extract<ScreenElement, { kind: 'text' }>;
type VarTextEl = Extract<ScreenElement, { kind: 'varText' }>;
type ButtonEl = Extract<ScreenElement, { kind: 'button' }>;
type ShapeEl = Extract<ScreenElement, { kind: 'shape' }>;
type LineEl = Extract<ScreenElement, { kind: 'line' }>;
type LogEl = Extract<ScreenElement, { kind: 'log' }>;

function ElementBody({ def, el, abs, screenH, screenW, style, sample }: {
  def: GameDef;
  el: ScreenElement;
  abs: PlainRect;
  screenH: number;
  /**
   * Px that 100% of the SCREEN's width maps to. SCREEN_W normally; larger in
   * focus mode, so %-of-screen units (fontSize, cardScale, padding, gap)
   * preview at their true relative size, magnified with the focused element.
   */
  screenW: number;
  /** Effective style (base, or the previewed state's merge). */
  style: LayoutStyle | undefined;
  /** Live-preview sample state (null = design view: placeholder values). */
  sample: GameState | null;
}) {
  switch (el.kind) {
    case 'zone': return <ZoneBody def={def} el={el} abs={abs} screenH={screenH} screenW={screenW} sample={sample} />;
    case 'text': return <TextBody def={def} el={el} screenW={screenW} sample={sample} />;
    case 'varText': return <VarTextBody def={def} el={el} screenW={screenW} sample={sample} />;
    case 'button': return <ButtonBody el={el} screenW={screenW} />;
    case 'shape': return <ShapeBody el={el} style={style} screenW={screenW} />;
    case 'line': return <LineBody el={el} abs={abs} screenH={screenH} style={style} />;
    case 'log': return <LogBody el={el} screenW={screenW} />;
    case 'group': return <span className="tt-group-name">{el.name}</span>;
  }
}

const SEAT_TAGS: Record<string, string | null> = {
  shared: null, viewer: 'you', opp1: 'opp 1', opp2: 'opp 2', opp3: 'opp 3',
};

function ZoneBody({ def, el, abs, screenH, screenW, sample }: {
  def: GameDef;
  el: ZoneEl;
  abs: PlainRect;
  screenH: number;
  screenW: number;
  sample: GameState | null;
}) {
  const zone = def.zones.find((z) => z.id === el.zoneId);
  if (!zone) {
    return <span className="tt-el-body tt-zone-missing">⚠ zone missing</span>;
  }
  // Live preview: the REAL cards this element shows in the sample game
  // (viewer-relative seat, cardFilter slice, pile grouping — runner parity).
  const real = sample !== null ? zonePreview(def, sample, el, SAMPLE_VIEWER_ID) : null;
  const seatTag = SEAT_TAGS[el.seat] ?? null;
  return (
    <span className="tt-el-body tt-zone-body">
      <span className="tt-item-label">
        {el.showName !== false && zone.name}
        {seatTag && <span className="tt-seat-tag">{seatTag}</span>}
        {el.cardFilter != null && <span className="tt-seat-tag">filtered</span>}
        {el.showCount && (
          <span className="tt-count-tag">×{real !== null ? real.count : zoneSampleCount(def, zone.id)}</span>
        )}
      </span>
      <SlotPreview zone={zone} el={el} abs={abs} screenH={screenH} screenW={screenW} real={real} />
    </span>
  );
}

/**
 * Simulated card slots from the zone's REAL layout settings (runner math).
 * With a live-preview `real`, slot counts, pile ×N badges and pile names come
 * from the sample game instead of placeholders.
 */
function SlotPreview({ zone, el, abs, screenH, screenW, real }: {
  zone: { layout: 'stack' | 'fan' | 'row' | 'grid' };
  el: ZoneEl;
  abs: PlainRect;
  screenH: number;
  screenW: number;
  /** Live-preview contents (null = design view: representative placeholders). */
  real: ZonePreview | null;
}) {
  const padPx = pctToPx(screenW, el.padding) ?? 0;
  const innerW = (abs.w / 100) * SCREEN_W - 2 * padPx;
  const innerH = (abs.h / 100) * screenH - 2 * padPx - 18; // label row
  const cardW = Math.max(8, (screenW * (el.cardScale ?? 8)) / 100);
  const cardH = Math.round(cardW / 0.714);
  const gapPx = pctToPx(screenW, el.gap) ?? 6;
  // Hand-style collapsing: every slot previews as a layered ×N mini-stack.
  const stacked = el.collapseDuplicates === true;
  // Live preview: how many slots the sample really shows (piles when the
  // element groups by identity), capped by what the rect fits.
  const realSlots = real === null ? null : real.piles !== null ? real.piles.length : real.count;
  const cap = (n: number) => (realSlots === null ? n : Math.min(n, realSlots));
  const realBadge = (i: number): string | undefined => {
    const p = real?.piles?.[i];
    return p !== undefined && p.count > 1 ? `×${p.count}` : undefined;
  };

  const slot = (i: number, style?: React.CSSProperties, badge?: string) => (
    <span
      className={stacked ? 'tt-slot tt-slot-x' : 'tt-slot'}
      key={i}
      style={{ width: cardW, height: cardH, ...style }}
    >
      {badge !== undefined && <span className="tt-slot-count">{badge}</span>}
    </span>
  );

  let body: JSX.Element;
  if (el.display === 'piles' || (el.display === 'carousel' && real !== null)) {
    // Piles: one slot per card identity, layered, × N + (optional) corner
    // badge. Live preview: the sample's real piles, names and badge values.
    const cols = el.columns ?? fitCount(innerW, cardW, gapPx, 12);
    const rows = el.rows
      ?? Math.max(1, Math.min(2, Math.floor((innerH + gapPx) / (cardH + gapPx))));
    const piles = real !== null ? real.piles ?? [] : null;
    const n = piles !== null ? piles.length : Math.max(1, cols * rows);
    body = (
      <span
        className="tt-slots"
        style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, max-content)`, gap: gapPx, justifyContent: 'center' }}
      >
        {Array.from({ length: n }, (_, i) => {
          const p = piles !== null ? piles[i] : null;
          return (
            <span className="tt-slot tt-slot-pile" key={i} style={{ width: cardW, height: cardH }}>
              <span className="tt-slot-count">× {p !== null ? p.count : 10 - (i % 3)}</span>
              {(p !== null ? p.badge !== '' : el.pileBadgeField != null) && (
                <span className="tt-slot-badge">{p !== null ? p.badge : 3 + (i % 5)}</span>
              )}
              {p !== null && p.name !== '' && <span className="tt-slot-name">{p.name}</span>}
            </span>
          );
        })}
      </span>
    );
  } else if (zone.layout === 'stack') {
    body = realSlots === 0 ? (
      <span className="tt-slots tt-slots-stack">
        <span className="tt-slot tt-slot-void" style={{ width: cardW, height: cardH }} />
      </span>
    ) : (
      <span className="tt-slots tt-slots-stack">
        <span className="tt-slot tt-slot-under" style={{ width: cardW, height: cardH }} />
        {slot(0, { marginLeft: -cardW + 4, marginTop: -4 }, real !== null ? realBadge(0) : stacked ? '×2' : undefined)}
      </span>
    );
  } else if (zone.layout === 'grid') {
    const cols = el.columns ?? fitCount(innerW, cardW, gapPx, 12);
    const rows = el.rows
      ?? Math.max(1, Math.min(2, Math.floor((innerH + gapPx) / (cardH + gapPx))));
    const n = cap(Math.max(1, cols * rows));
    body = (
      <span
        className="tt-slots"
        style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, max-content)`, gap: gapPx, justifyContent: 'center' }}
      >
        {Array.from({ length: n }, (_, i) =>
          slot(i, undefined, real !== null ? realBadge(i) : stacked && i === 0 ? '×2' : undefined))}
      </span>
    );
  } else if (zone.layout === 'fan') {
    const ml = fanMarginPx(cardW, pctToPx(screenW, el.gap)) ?? -Math.round(cardW * 0.3);
    const step = Math.max(1, cardW + ml);
    const n = cap(Math.max(1, Math.min(8, Math.floor((innerW - cardW) / step) + 1)));
    // Fan quality: per-card rotation + parabolic dip from the center index.
    const angle = el.fanAngle ?? 4;
    const mid = (n - 1) / 2;
    body = (
      <span className="tt-slots tt-slots-fan" style={{ display: 'flex' }}>
        {Array.from({ length: n }, (_, i) => {
          const off = i - mid;
          return slot(i, {
            ...(i > 0 ? { marginLeft: ml } : {}),
            transform: `rotate(${(off * angle).toFixed(1)}deg) translateY(${(off * off * angle * 0.6).toFixed(1)}px)`,
          }, real !== null ? realBadge(i) : stacked && i === Math.floor(mid) ? '×2' : undefined);
        })}
      </span>
    );
  } else {
    const n = cap(fitCount(innerW, cardW, gapPx, 8));
    body = (
      <span className="tt-slots" style={{ display: 'flex', gap: gapPx }}>
        {Array.from({ length: n }, (_, i) =>
          slot(i, undefined, real !== null ? realBadge(i) : stacked && i === 0 ? '×2' : undefined))}
      </span>
    );
  }
  return <span className="tt-preview" aria-hidden="true">{body}</span>;
}

const JUSTIFY: Record<'left' | 'center' | 'right', string> = {
  left: 'flex-start', center: 'center', right: 'flex-end',
};

function textStyle(el: { fontSize: number; color?: string; bold?: boolean; align: 'left' | 'center' | 'right' }, screenW: number): React.CSSProperties {
  return {
    fontSize: (screenW * el.fontSize) / 100,
    fontWeight: el.bold ? 700 : 500,
    color: el.color ?? 'var(--text)',
    textAlign: el.align,
  };
}

function TextBody({ def, el, screenW, sample }: {
  def: GameDef;
  el: TextEl;
  screenW: number;
  sample: GameState | null;
}) {
  // Dynamic text previews its segments: with the live preview they resolve
  // against the sample game exactly like the runner (ids → names); in design
  // view strings render verbatim and expressions as readable ⟨value⟩ chips.
  const content = el.parts
    ? sample !== null
      ? renderTextParts(def, sample, el.parts, SAMPLE_VIEWER_ID)
      : el.parts.map((p, i) =>
          typeof p === 'string'
            ? <span key={i}>{p}</span>
            : <span key={i} className="tt-part-expr">⟨{exprToText(def, p)}⟩</span>)
    : (el.text || 'Text');
  return (
    <span className="tt-el-body tt-text-body" style={{ justifyContent: JUSTIFY[el.align] }}>
      <span style={textStyle(el, screenW)}>{content}</span>
    </span>
  );
}

/** The chronicle: three sample entries (+ a turn separator) at scale. */
function LogBody({ el, screenW }: { el: LogEl; screenW: number }) {
  return (
    <span
      className="tt-el-body tt-log-body"
      style={{ fontSize: (screenW * (el.fontSize ?? 1.3)) / 100 }}
    >
      <span className="tt-log-entry">Robin plays Village</span>
      <span className="tt-log-entry">Robin draws a card</span>
      {el.turnSeparators !== false && <span className="tt-log-sep">— turn 4 —</span>}
      <span className="tt-log-entry">Morgan gains Silver</span>
    </span>
  );
}

function VarTextBody({ def, el, screenW, sample }: {
  def: GameDef;
  el: VarTextEl;
  screenW: number;
  sample: GameState | null;
}) {
  const v = def.variables.find((x) => x.id === el.varId);
  // Live preview: the variable's REAL sample value (viewer-relative seat,
  // the runner's own resolver); design view shows the authored initial.
  const value = sample !== null
    ? formatVarValue(varTextValue(def, sample, el, SAMPLE_VIEWER_ID))
    : v ? String(v.initial) : '⚠';
  return (
    <span className="tt-el-body tt-text-body" style={{ justifyContent: JUSTIFY[el.align] }}>
      <span style={textStyle(el, screenW)}>{`${el.label ?? ''}${value}`}</span>
    </span>
  );
}

function ButtonBody({ el, screenW }: { el: ButtonEl; screenW: number }) {
  return (
    <span className="tt-el-body tt-button-body">
      <span
        className={el.actionId === null ? 'tt-btn-sample tt-btn-unbound' : 'tt-btn-sample'}
        style={{ fontSize: (screenW * (el.fontSize ?? 1.8)) / 100 }}
      >
        {el.label || 'Button'}
      </span>
    </span>
  );
}

/** Any shape kind with the authored style and a centered label. */
function ShapeBody({ el, style, screenW }: { el: ShapeEl; style: LayoutStyle | undefined; screenW: number }) {
  const css = layoutStyleCss(style);
  const radius = shapeBorderRadius(el.shape, style) ?? css.borderRadius;
  const clip = shapeClipPath(el.shape);
  return (
    <span className="tt-el-body tt-shape-body">
      <span
        className="tt-shape"
        style={{
          ...css,
          ...(radius !== undefined ? { borderRadius: radius } : {}),
          ...(clip !== null ? { clipPath: clip } : {}),
        }}
      >
        {el.label && (
          <span className="tt-shape-label" style={{ fontSize: (screenW * (el.fontSize ?? 1.2)) / 100 }}>
            {el.label}
          </span>
        )}
      </span>
    </span>
  );
}

const LINE_FALLBACK = 'rgba(255,255,255,0.35)';

/** Connector line: orient h/v/down/up, thickness, dash, arrow heads (SVG). */
function LineBody({ el, abs, screenH, style }: {
  el: LineEl;
  abs: PlainRect;
  screenH: number;
  style: LayoutStyle | undefined;
}) {
  const w = Math.max(1, (abs.w / 100) * SCREEN_W);
  const h = Math.max(1, (abs.h / 100) * screenH);
  const color = style?.borderColor ?? LINE_FALLBACK;
  const t = Math.max(1, el.thickness);
  const ends = {
    h: { x1: 0, y1: h / 2, x2: w, y2: h / 2 },
    v: { x1: w / 2, y1: 0, x2: w / 2, y2: h },
    down: { x1: 0, y1: 0, x2: w, y2: h },
    up: { x1: 0, y1: h, x2: w, y2: 0 },
  }[el.orient];
  const arrow = el.arrow ?? 'none';
  const markerId = `tt-arrow-${el.id}`;
  const arrowSize = t * 2.5 + 5;
  return (
    <span className="tt-el-body tt-line-body" aria-hidden="true">
      <svg className="tt-line-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {arrow !== 'none' && (
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth={arrowSize}
              markerHeight={arrowSize}
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
            </marker>
          </defs>
        )}
        <line
          x1={ends.x1} y1={ends.y1} x2={ends.x2} y2={ends.y2}
          stroke={color}
          strokeWidth={t}
          strokeDasharray={el.dashed ? `${t * 3} ${t * 2}` : undefined}
          markerEnd={arrow !== 'none' ? `url(#${markerId})` : undefined}
          markerStart={arrow === 'both' ? `url(#${markerId})` : undefined}
        />
      </svg>
    </span>
  );
}
