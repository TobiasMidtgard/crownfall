/**
 * TemplateCanvas — large CardView preview of a template with sample data,
 * plus a 1:1 overlay of selectable/drag/resize hit areas per element.
 *
 * Pointer events with setPointerCapture so mouse and touch behave the same;
 * px deltas convert to % of card size, clamped to the card and snapped to 0.5%.
 */
import { useEffect, useRef, useState } from 'react';
import type { CardTemplate } from '../shared/types';
import { CardView } from '../components/CardView';
import { clampPct, sampleCard, type Rect } from './designerUtils';

interface DragState {
  elId: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  orig: Rect;
}

export function TemplateCanvas({ template, selectedId, onSelect, onCommitRect }: {
  template: CardTemplate;
  selectedId: string | null;
  onSelect: (elId: string | null) => void;
  /** Fired once when a drag/resize ends. */
  onCommitRect: (elId: string, rect: Rect) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cardW, setCardW] = useState(320);
  const cardH = cardW / template.aspect;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setCardW(Math.max(1, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dragRef = useRef<DragState | null>(null);
  // Mirrored in a ref so pointerup can read the freshest value (state batches).
  const liveRef = useRef<({ elId: string } & Rect) | null>(null);
  const [live, setLiveState] = useState<({ elId: string } & Rect) | null>(null);
  const setLive = (v: ({ elId: string } & Rect) | null) => {
    liveRef.current = v;
    setLiveState(v);
  };

  // While dragging, preview the template with the dragged element's live rect.
  const previewTemplate: CardTemplate = live
    ? {
        ...template,
        elements: template.elements.map((el) =>
          el.id === live.elId ? { ...el, x: live.x, y: live.y, w: live.w, h: live.h } : el),
      }
    : template;

  const startDrag = (e: React.PointerEvent, elId: string, orig: Rect, mode: 'move' | 'resize') => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(elId);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { elId, mode, startX: e.clientX, startY: e.clientY, orig };
  };

  const moveDrag = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = ((e.clientX - d.startX) / cardW) * 100;
    const dy = ((e.clientY - d.startY) / cardH) * 100;
    const rect: Rect = d.mode === 'move'
      ? {
          x: clampPct(d.orig.x + dx, 0, Math.max(0, 100 - d.orig.w)),
          y: clampPct(d.orig.y + dy, 0, Math.max(0, 100 - d.orig.h)),
          w: d.orig.w,
          h: d.orig.h,
        }
      : {
          x: d.orig.x,
          y: d.orig.y,
          w: clampPct(d.orig.w + dx, 2, Math.max(2, 100 - d.orig.x)),
          h: clampPct(d.orig.h + dy, 2, Math.max(2, 100 - d.orig.y)),
        };
    setLive({ elId: d.elId, ...rect });
  };

  const endDrag = () => {
    const d = dragRef.current;
    dragRef.current = null;
    const r = liveRef.current;
    if (d && r && r.elId === d.elId) {
      onCommitRect(d.elId, { x: r.x, y: r.y, w: r.w, h: r.h });
    }
    setLive(null);
  };

  return (
    <div className="dz-canvas-wrap" ref={wrapRef}>
      <CardView card={sampleCard(previewTemplate)} template={previewTemplate} width={cardW} />
      <div
        className="dz-canvas-overlay"
        style={{ width: cardW, height: cardH }}
        onPointerDown={(e) => {
          // Tap on empty card area = deselect.
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        {previewTemplate.elements.map((el) => {
          const isSel = el.id === selectedId;
          return (
            <div
              key={el.id}
              className={`dz-el-hit${isSel ? ' dz-el-hit-selected' : ''}`}
              style={{ left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%` }}
              onPointerDown={(e) => startDrag(e, el.id, { x: el.x, y: el.y, w: el.w, h: el.h }, 'move')}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              role="button"
              aria-label={`Element at ${el.x}%, ${el.y}%`}
            >
              {isSel && (
                <div
                  className="dz-resize-handle"
                  onPointerDown={(e) => startDrag(e, el.id, { x: el.x, y: el.y, w: el.w, h: el.h }, 'resize')}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  aria-label="Resize element"
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
