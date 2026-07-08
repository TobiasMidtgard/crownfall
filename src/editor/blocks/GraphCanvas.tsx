/**
 * GraphCanvas — the interactive node-graph surface.
 *
 * Renders the deterministic projection from graphModel (HTML nodes over SVG
 * bézier wires), and turns gestures into immutable Block[] edits:
 *   - tap pin → tap compatible pin connects (touch-first); tapping the same
 *     armed pin opens the node picker for it
 *   - drag from a pin (desktop) → release on a pin connects; release on
 *     empty canvas opens the picker FILTERED to compatible nodes, inserting
 *     and connecting in one step
 *   - exec connects re-route the chain (moveBlock); data connects replace
 *     the slot's expression (confirm when discarding a non-trivial subtree)
 *   - pan (drag empty space), pinch / ctrl-wheel zoom, fit-to-view
 */
import {
  useCallback, useEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Block, Expr, GameDef } from '../../shared/types';
import { deepClone } from '../../shared/defaults';
import { ConfirmModal } from '../common/Modal';
import { exprToText } from './exprToText';
import {
  PIN_COLOR, appendLoc, blockLanes, consumerSlotOf, defaultExprForSlot,
  describePin, duplicateBlockAt, exprWeight, getExprAt, getLaneOf, getNode,
  insertBlockAt, isLiteral, mergeBindings, moveBlock, pinPosition,
  pinsCompatible, projectGraph, removeBlock, setExprAt, updateBlockAt,
  type DataSlotSpec, type ExecPinLoc, type ExprPath, type GraphNode,
  type PinRef, type Wire,
} from './graphModel';
import { ExecFieldControl, ExprFieldControl, InlineSlotValue } from './NodeBody';
import { NodePicker } from './NodePicker';

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
/** Step factor for the toolbar − / + zoom buttons. */
const ZOOM_STEP = 1.25;

const withChoice = (bindings: string[]): string[] =>
  bindings.includes('$choice') ? bindings : [...bindings, '$choice'];

type PickerState =
  | { mode: 'block'; loc: ExecPinLoc }
  | { mode: 'expr'; path: ExprPath; slot: DataSlotSpec; bindings: string[] };

interface ViewState { x: number; y: number; z: number }

export function GraphCanvas({ def, value, onChange, bindings }: {
  def: GameDef;
  value: Block[];
  onChange: (blocks: Block[]) => void;
  bindings: string[];
}) {
  const graph = useMemo(() => projectGraph(def, value, bindings), [def, value, bindings]);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [view, setView] = useState<ViewState>({ x: 16, y: 12, z: 1 });
  const [fullscreen, setFullscreen] = useState(false);
  const [armed, setArmed] = useState<PinRef | null>(null);
  const [drag, setDrag] = useState<{ from: PinRef; x: number; y: number } | null>(null);
  const [picker, setPicker] = useState<PickerState | null>(null);
  const [wireMenu, setWireMenu] = useState<{ wire: Wire; x: number; y: number } | null>(null);
  const [nodeMenu, setNodeMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; run: () => void } | null>(null);

  // Any committed edit invalidates pin/wire references.
  useEffect(() => {
    setArmed(null);
    setDrag(null);
    setWireMenu(null);
    setNodeMenu(null);
  }, [value]);

  const wired = useMemo(() => {
    const s = new Set<string>();
    for (const w of graph.wires) {
      s.add(`${w.from.nodeId}|${w.from.pin}`);
      s.add(`${w.to.nodeId}|${w.to.pin}`);
    }
    return s;
  }, [graph]);

  // --- coordinate helpers ---------------------------------------------------

  const clientToStage = (cx: number, cy: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: cx, y: cy };
    return { x: (cx - rect.left - view.x) / view.z, y: (cy - rect.top - view.y) / view.z };
  };

  const fit = useCallback((width: number, height: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const z = clampZoom(Math.min((rect.width - 24) / width, (rect.height - 24) / height, 1));
    setView({
      z,
      x: Math.max(8, (rect.width - width * z) / 2),
      y: Math.max(8, (rect.height - height * z) / 2),
    });
  }, []);

  const graphSize = useRef({ w: graph.width, h: graph.height });
  graphSize.current = { w: graph.width, h: graph.height };
  useEffect(() => { fit(graphSize.current.w, graphSize.current.h); }, [fit]);

  /** Zoom by a factor around the canvas center (toolbar − / + buttons). */
  const zoomBy = (factor: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    const cx = rect ? rect.width / 2 : 0;
    const cy = rect ? rect.height / 2 : 0;
    setView((v) => {
      const z = clampZoom(v.z * factor);
      const k = z / v.z;
      return { z, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
    });
  };

  // Fullscreen is a fixed overlay (the native Fullscreen API is unavailable on
  // iOS for arbitrary elements). Re-fit once the canvas has its new size, and
  // let Escape exit — but only when no modal/menu sits on top.
  const overlaysOpen = picker !== null || confirm !== null || wireMenu !== null || nodeMenu !== null;
  const toggleFullscreen = () => {
    setFullscreen((f) => !f);
    requestAnimationFrame(() => fit(graphSize.current.w, graphSize.current.h));
  };
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || overlaysOpen) return;
      e.stopPropagation();
      setFullscreen(false);
      requestAnimationFrame(() => fit(graphSize.current.w, graphSize.current.h));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, overlaysOpen, fit]);

  // Keep the page behind the overlay from scrolling while fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  // --- connect / picker logic -----------------------------------------------

  const replaceExpr = (path: ExprPath, next: Expr | null) => {
    const old = getExprAt(value, path);
    const apply = () => onChange(setExprAt(value, path, next));
    if (old && !isLiteral(old) && exprWeight(old) >= 2) {
      setConfirm({ message: `This replaces “${exprToText(def, old)}”.`, run: apply });
    } else {
      apply();
    }
  };

  const tryConnect = (a: PinRef, b: PinRef): boolean => {
    const da = describePin(graph, a);
    const db = describePin(graph, b);
    if (!da || !db) return false;
    const [out, inn] =
      da.kind === 'execOut' && db.kind === 'execIn' ? [da, db]
      : db.kind === 'execOut' && da.kind === 'execIn' ? [db, da]
      : da.kind === 'dataOut' && db.kind === 'dataIn' ? [da, db]
      : db.kind === 'dataOut' && da.kind === 'dataIn' ? [db, da]
      : [null, null];
    if (!out || !inn) return false;
    if (out.kind === 'execOut' && inn.kind === 'execIn') {
      const next = moveBlock(value, inn.path, out.loc);
      if (!next) return false;
      onChange(next);
      return true;
    }
    if (out.kind === 'dataOut' && inn.kind === 'dataIn') {
      if (!pinsCompatible(graph, a, b)) return false;
      replaceExpr(inn.path, deepClone(out.expr));
      return true;
    }
    return false;
  };

  const openPickerForPin = (ref: PinRef) => {
    const desc = describePin(graph, ref);
    if (!desc) return;
    if (desc.kind === 'execOut') setPicker({ mode: 'block', loc: desc.loc });
    else if (desc.kind === 'execIn') setPicker({ mode: 'block', loc: { kind: 'before', path: desc.path } });
    else if (desc.kind === 'dataIn') setPicker({ mode: 'expr', path: desc.path, slot: desc.slot, bindings: desc.bindings });
  };

  const openAppendPicker = () => setPicker({ mode: 'block', loc: appendLoc(value) });

  // --- pin pointer interactions ----------------------------------------------

  const pressRef = useRef<{ ref: PinRef; x: number; y: number; dragging: boolean } | null>(null);

  const onPinDown = (e: ReactPointerEvent<HTMLButtonElement>, ref: PinRef) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pressRef.current = { ref, x: e.clientX, y: e.clientY, dragging: false };
  };

  const onPinMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    if (!press) return;
    if (!press.dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 7) {
      press.dragging = true;
    }
    if (press.dragging) {
      const p = clientToStage(e.clientX, e.clientY);
      setDrag({ from: press.ref, x: p.x, y: p.y });
    }
  };

  const onPinUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const press = pressRef.current;
    pressRef.current = null;
    if (!press) return;
    if (!press.dragging) {
      // Tap: arm → connect; tapping the armed pin again opens the picker.
      if (armed && armed.nodeId === press.ref.nodeId && armed.pin === press.ref.pin) {
        setArmed(null);
        openPickerForPin(press.ref);
      } else if (armed) {
        if (!tryConnect(armed, press.ref)) setArmed(press.ref);
        else setArmed(null);
      } else {
        setArmed(press.ref);
      }
      return;
    }
    setDrag(null);
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const pinEl = el?.closest('[data-pin]') as HTMLElement | null;
    if (pinEl?.dataset.node && pinEl.dataset.pin) {
      tryConnect(press.ref, { nodeId: pinEl.dataset.node, pin: pinEl.dataset.pin });
    } else if (el && canvasRef.current?.contains(el)) {
      openPickerForPin(press.ref);
    }
  };

  // --- canvas pan & pinch -----------------------------------------------------

  const gestureRef = useRef<{
    pointers: Map<number, { x: number; y: number; sx: number; sy: number }>;
    moved: boolean;
    lastPinch: { x: number; y: number; dist: number } | null;
  }>({ pointers: new Map(), moved: false, lastPinch: null });

  const isBackground = (target: EventTarget | null) =>
    !(target instanceof Element && target.closest('.gr-node, .gr-float, .gr-wirehit'));

  const onCanvasDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isBackground(e.target)) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const g = gestureRef.current;
    canvasRef.current?.setPointerCapture(e.pointerId);
    g.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    if (g.pointers.size === 1) g.moved = false;
    g.lastPinch = null;
  };

  const onCanvasMove = (e: ReactPointerEvent<HTMLDivElement>) => {
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
      const rect = canvasRef.current?.getBoundingClientRect();
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

  const onCanvasUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.delete(e.pointerId);
    g.lastPinch = null;
    if (g.pointers.size === 0 && !g.moved) {
      setArmed(null);
      setWireMenu(null);
      setNodeMenu(null);
    }
  };

  useEffect(() => {
    const el = canvasRef.current;
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

  // --- node / wire actions -----------------------------------------------------

  const deleteNode = (node: GraphNode, keepBodies: boolean) => {
    if (node.role === 'exec' && node.blockPath) {
      onChange(removeBlock(value, node.blockPath, keepBodies));
    } else if (node.role === 'data' && node.exprPath) {
      const slot = consumerSlotOf(def, value, node.exprPath);
      if (slot) onChange(setExprAt(value, node.exprPath, defaultExprForSlot(def, slot, node.bindings)));
    }
  };

  const pinState = (ref: PinRef): 'armed' | 'compat' | 'dim' | undefined => {
    const source = drag?.from ?? armed;
    if (!source) return undefined;
    if (source.nodeId === ref.nodeId && source.pin === ref.pin) return 'armed';
    return pinsCompatible(graph, source, ref) ? 'compat' : 'dim';
  };

  // --- rendering ----------------------------------------------------------------

  const pin = (nodeId: string, pinName: string, side: 'l' | 'r', opts?: { exec?: boolean; color?: string }) => {
    const ref: PinRef = { nodeId, pin: pinName };
    const state = pinState(ref);
    const cls = [
      'gr-pin', `gr-pin-${side}`,
      opts?.exec ? 'gr-pin-exec' : '',
      wired.has(`${nodeId}|${pinName}`) ? 'gr-pin-wired' : '',
      state ? `gr-pin-${state}` : '',
    ].filter(Boolean).join(' ');
    return (
      <button
        type="button"
        className={cls}
        style={opts?.color ? { '--pin-c': `var(${opts.color})` } as CSSProperties : undefined}
        data-node={nodeId}
        data-pin={pinName}
        aria-label={`${pinName} pin`}
        onPointerDown={(e) => onPinDown(e, ref)}
        onPointerMove={onPinMove}
        onPointerUp={onPinUp}
      />
    );
  };

  const renderNode = (node: GraphNode) => {
    const nodeBindings = withChoice(node.bindings);
    const host = (node.block ?? node.expr) as unknown as Record<string, unknown> | undefined;
    // The WHEN / IF / DO reading line (Deckhand's visual-scripting language):
    // the entry node is WHEN this script runs, `if` gates are IF, every other
    // step is DO. Data nodes stay untagged — they are values, not steps.
    const tag = node.role === 'start' ? 'when'
      : node.role === 'exec' ? (node.block?.kind === 'if' ? 'if' : 'do')
        : null;
    return (
      <div
        key={node.id}
        className={`gr-node gr-node-${node.role}${tag !== null ? ` gr-tagged-${tag}` : ''}`}
        style={{ left: node.x, top: node.y, width: node.w, height: node.h, '--node-c': node.color } as CSSProperties}
      >
        <div className="gr-head">
          {node.role === 'exec' && pin(node.id, 'execIn', 'l', { exec: true })}
          {tag !== null && <span className={`gr-tag gr-tag-${tag}`}>{tag.toUpperCase()}</span>}
          <span className="gr-title">{node.role === 'start' ? 'this runs' : node.label}</span>
          {node.role !== 'start' && (
            <button
              type="button"
              className="gr-menu-btn"
              aria-label="Node menu"
              onClick={(e) => { e.stopPropagation(); setNodeMenu(nodeMenu === node.id ? null : node.id); }}
            >
              ⋯
            </button>
          )}
          {(node.role === 'exec' || node.role === 'start') && pin(node.id, 'execOut', 'r', { exec: true })}
          {node.role === 'data' && pin(node.id, 'out', 'r', { color: PIN_COLOR[node.outType ?? 'any'] })}
        </div>
        {node.rows.map((row, i) => {
          if (row.kind === 'lane') {
            return (
              <div key={i} className="gr-row gr-row-lane">
                <span className="gr-rlabel">{row.label}</span>
                {pin(node.id, `lane:${row.lane}`, 'r', { exec: true })}
              </div>
            );
          }
          if (row.kind === 'data') {
            const v = (host?.[row.slot.key] ?? null) as Expr | null;
            const isWired = v !== null && !isLiteral(v);
            return (
              <div key={i} className="gr-row" title={v ? exprToText(def, v) : undefined}>
                {pin(node.id, `in:${row.slot.key}`, 'l', { color: PIN_COLOR[row.slot.type] })}
                <span className="gr-rlabel">{row.slot.label}</span>
                {!isWired && (
                  <InlineSlotValue
                    def={def}
                    slot={row.slot}
                    value={v}
                    bindings={mergeBindings(nodeBindings, row.slot.addBindings)}
                    onChange={(expr) => {
                      const path: ExprPath = node.role === 'exec'
                        ? { blockPath: node.blockPath ?? [], slots: [row.slot.key] }
                        : { blockPath: node.exprPath?.blockPath ?? [], slots: [...(node.exprPath?.slots ?? []), row.slot.key] };
                      onChange(setExprAt(value, path, expr));
                    }}
                  />
                )}
              </div>
            );
          }
          return (
            <div key={i} className="gr-row gr-row-field">
              {node.role === 'exec' && node.block && node.blockPath ? (
                <ExecFieldControl
                  def={def}
                  block={node.block}
                  fieldKey={row.field}
                  bindings={nodeBindings}
                  onChange={(nb) => onChange(updateBlockAt(value, node.blockPath ?? [], nb))}
                />
              ) : node.expr && node.exprPath ? (
                <ExprFieldControl
                  def={def}
                  expr={node.expr}
                  fieldKey={row.field}
                  bindings={nodeBindings}
                  onChange={(ne) => onChange(setExprAt(value, node.exprPath as ExprPath, ne))}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    );
  };

  const wirePath = (x1: number, y1: number, x2: number, y2: number) => {
    const k = Math.max(28, Math.min(90, Math.abs(x2 - x1) * 0.5 + Math.abs(y2 - y1) * 0.2));
    return `M ${x1} ${y1} C ${x1 + k} ${y1}, ${x2 - k} ${y2}, ${x2} ${y2}`;
  };

  const menuNode = nodeMenu ? getNode(graph, nodeMenu) : null;
  const menuHasContents = menuNode?.block
    ? blockLanes(menuNode.block).some((l) => menuNode.block && getLaneOf(menuNode.block, l.lane).length > 0)
    : false;

  const dragSource = drag ? getNode(graph, drag.from.nodeId) : null;
  const dragStart = drag && dragSource ? pinPosition(dragSource, drag.from.pin) : null;

  return (
    <div className={fullscreen ? 'gr-wrap gr-wrap-full' : 'gr-wrap'}>
      <div
        ref={canvasRef}
        className="gr-canvas"
        role="application"
        aria-label="Script graph"
        onPointerDown={onCanvasDown}
        onPointerMove={onCanvasMove}
        onPointerUp={onCanvasUp}
        onPointerCancel={onCanvasUp}
        onDoubleClick={(e) => { if (isBackground(e.target)) openAppendPicker(); }}
        onContextMenu={(e) => { if (isBackground(e.target)) { e.preventDefault(); openAppendPicker(); } }}
      >
        <div className="gr-stage" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
          <svg className="gr-wires" width={graph.width} height={graph.height}>
            {graph.wires.map((w) => (
              <g key={w.id}>
                <path
                  className={w.kind === 'exec' ? 'gr-wire gr-wire-exec' : 'gr-wire gr-wire-data'}
                  style={w.kind === 'data' ? { stroke: `var(${PIN_COLOR[w.type ?? 'any']})` } : undefined}
                  d={wirePath(w.x1, w.y1, w.x2, w.y2)}
                />
                <path
                  className="gr-wirehit"
                  d={wirePath(w.x1, w.y1, w.x2, w.y2)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setWireMenu({ wire: w, x: (w.x1 + w.x2) / 2, y: (w.y1 + w.y2) / 2 });
                  }}
                />
              </g>
            ))}
            {drag && dragStart && (
              <path className="gr-wire gr-wire-ghost" d={wirePath(dragStart.x, dragStart.y, drag.x, drag.y)} />
            )}
          </svg>

          {graph.nodes.map(renderNode)}

          {wireMenu && (
            <div className="gr-float" style={{ left: wireMenu.x, top: wireMenu.y }}>
              {wireMenu.wire.kind === 'exec' ? (
                <button
                  type="button"
                  onClick={() => {
                    const desc = describePin(graph, wireMenu.wire.from);
                    setWireMenu(null);
                    if (desc?.kind === 'execOut') setPicker({ mode: 'block', loc: desc.loc });
                  }}
                >
                  ＋ Insert node here
                </button>
              ) : (
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    const desc = describePin(graph, wireMenu.wire.to);
                    setWireMenu(null);
                    if (desc?.kind === 'dataIn') {
                      onChange(setExprAt(value, desc.path, defaultExprForSlot(def, desc.slot, desc.bindings)));
                    }
                  }}
                >
                  ✕ Disconnect
                </button>
              )}
            </div>
          )}

          {menuNode && (
            <div className="gr-float" style={{ left: menuNode.x + menuNode.w + 6, top: menuNode.y }}>
              {menuNode.role === 'exec' && menuNode.blockPath && (
                <>
                  <button type="button" onClick={() => onChange(duplicateBlockAt(value, menuNode.blockPath ?? []))}>
                    ⧉ Duplicate
                  </button>
                  {menuHasContents && (
                    <button type="button" onClick={() => deleteNode(menuNode, true)}>
                      ✕ Delete, keep contents
                    </button>
                  )}
                  <button type="button" className="danger" onClick={() => deleteNode(menuNode, false)}>
                    ✕ Delete{menuHasContents ? ' with contents' : ''}
                  </button>
                </>
              )}
              {menuNode.role === 'data' && (
                <button type="button" className="danger" onClick={() => deleteNode(menuNode, false)}>
                  ✕ Disconnect &amp; reset
                </button>
              )}
            </div>
          )}
        </div>

        {value.length === 0 && (
          <div className="gr-hint">Tap the <strong>Start</strong> pin (or double-tap the canvas) to add your first block.</div>
        )}
      </div>

      <div className="gr-toolbar">
        <button type="button" className="btn btn-small" onClick={openAppendPicker}>＋ Node</button>
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
        <span className="gr-zoom">{Math.round(view.z * 100)}%</span>
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
        <button
          type="button"
          className="btn btn-small"
          aria-label="Fit graph to view"
          title="Fit to view"
          onClick={() => fit(graph.width, graph.height)}
        >
          Fit
        </button>
        <button
          type="button"
          className="btn btn-small"
          aria-label={fullscreen ? 'Exit full screen' : 'Edit full screen'}
          title={fullscreen ? 'Exit full screen (Esc)' : 'Full screen'}
          onClick={toggleFullscreen}
        >
          {fullscreen ? '✕' : '⛶'}
        </button>
      </div>

      {picker && picker.mode === 'block' && (
        <NodePicker
          def={def}
          request={{
            mode: 'block',
            onPick: (b) => {
              onChange(insertBlockAt(value, picker.loc, b));
              setPicker(null);
            },
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {picker && picker.mode === 'expr' && (
        <NodePicker
          def={def}
          request={{
            mode: 'expr',
            pinType: picker.slot.type,
            bindings: withChoice(picker.bindings),
            onPick: (e) => {
              setPicker(null);
              replaceExpr(picker.path, e);
            },
          }}
          onClose={() => setPicker(null)}
        />
      )}
      {confirm && (
        <ConfirmModal
          title="Replace expression?"
          message={<p>{confirm.message}</p>}
          confirmLabel="Replace"
          onConfirm={() => { confirm.run(); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
