/**
 * LayersPanel — nested front-to-back tree mirroring screenLayout.elements
 * (top row = frontmost = LAST in the array, like Photoshop). Groups — and
 * ANY element carrying children — are expandable folders; rows select
 * (shift-click adds), double-clicking a row FOCUSES the element on the
 * canvas while double-clicking its NAME renames inline, ▲▼ and desktop
 * row-drag reorder among SIBLINGS only. Elements with a visible-when
 * expression carry a small ƒx badge (visibility is expression-driven —
 * there is no eye toggle); elements with reactive states carry a ⚡ badge.
 * In focus mode the workspace passes just the focused element, so its row
 * renders as the root of the scoped subtree.
 */
import { useState } from 'react';
import type { Id, ScreenElement } from '../../../shared/types';

const ICONS: Record<ScreenElement['kind'], string> = {
  zone: '▭', text: 'T', varText: '#', button: '▸', counter: '±', shape: '◯', line: '╱', log: '☰',
  group: '▦', panelSwitcher: '⧉', image: '🖼',
};

export interface LayersPanelProps {
  elements: ScreenElement[];
  sel: Id[];
  /** Plain click → select; shift-click → toggle into the multi-selection. */
  onSelect: (id: Id, additive: boolean) => void;
  /** Swap with the sibling in front of / behind this element. */
  onMoveLayer: (id: Id, dir: 'fwd' | 'back') => void;
  /** Drag-reorder: re-seat dragId at targetId's position (same siblings). */
  onDropLayer: (dragId: Id, targetId: Id) => void;
  onRename: (id: Id, name: string) => void;
  /** Double-click a row → FOCUS the element on the canvas (edit its children). */
  onFocus: (id: Id) => void;
}

export function LayersPanel({ elements, sel, onSelect, onMoveLayer, onDropLayer, onRename, onFocus }: LayersPanelProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<Id>>(new Set());
  const [dragId, setDragId] = useState<Id | null>(null);
  const [editing, setEditing] = useState<{ id: Id; value: string } | null>(null);

  const toggleCollapse = (id: Id) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  const commitRename = () => {
    if (editing) onRename(editing.id, editing.value.trim() || 'Element');
    setEditing(null);
  };

  const row = (el: ScreenElement, depth: number, seq: Id[], displayIdx: number) => {
    const active = sel.includes(el.id);
    const isEditing = editing?.id === el.id;
    const expandable = el.kind === 'group' || (el.children?.length ?? 0) > 0;
    return (
      <div
        key={el.id}
        className={`tt-layer${active ? ' tt-layer-active' : ''}${depth > 0 ? ' tt-layer-child' : ''}`}
        style={depth > 1 ? { marginLeft: 18 * depth } : undefined}
        onDoubleClick={(e) => {
          // Row double-click focuses; name/buttons keep their own dblclicks.
          if (isEditing) return;
          if (e.target instanceof Element && e.target.closest('button, input')) return;
          e.stopPropagation();
          onFocus(el.id);
        }}
        draggable={!isEditing}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', el.id);
          setDragId(el.id);
        }}
        onDragEnd={() => setDragId(null)}
        onDragOver={(e) => {
          if (dragId !== null && dragId !== el.id && seq.includes(dragId)) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId !== null && dragId !== el.id && seq.includes(dragId)) onDropLayer(dragId, el.id);
          setDragId(null);
        }}
        onClick={(e) => onSelect(el.id, e.shiftKey)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !isEditing) {
            e.preventDefault();
            onSelect(el.id, e.shiftKey);
          }
        }}
      >
        {expandable && (
          <button
            type="button"
            className="tt-layer-btn tt-layer-chev"
            aria-label={collapsed.has(el.id) ? `Expand ${el.name}` : `Collapse ${el.name}`}
            aria-expanded={!collapsed.has(el.id)}
            onClick={(e) => { e.stopPropagation(); toggleCollapse(el.id); }}
          >
            {collapsed.has(el.id) ? '▸' : '▾'}
          </button>
        )}
        <span className="tt-layer-icon" aria-hidden="true">{ICONS[el.kind]}</span>
        {isEditing ? (
          <input
            type="text"
            className="input tt-layer-rename"
            value={editing.value}
            autoFocus
            aria-label={`Rename ${el.name}`}
            onChange={(e) => setEditing({ id: el.id, value: e.target.value })}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setEditing(null);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="tt-layer-name"
            title="Double-click to rename"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditing({ id: el.id, value: el.name });
            }}
          >
            {el.name}
          </span>
        )}
        {(el.states?.length ?? 0) > 0 && <span className="tt-layer-fx" title="Reactive states">⚡</span>}
        {el.visible != null && <span className="tt-layer-fx" title="Visible-when expression">ƒx</span>}
        <span className="tt-layer-btns">
          <button
            type="button"
            className="tt-layer-btn"
            aria-label={`Bring ${el.name} forward`}
            disabled={displayIdx <= 0}
            onClick={(e) => { e.stopPropagation(); onMoveLayer(el.id, 'fwd'); }}
          >
            ▲
          </button>
          <button
            type="button"
            className="tt-layer-btn"
            aria-label={`Send ${el.name} backward`}
            disabled={displayIdx >= seq.length - 1}
            onClick={(e) => { e.stopPropagation(); onMoveLayer(el.id, 'back'); }}
          >
            ▼
          </button>
        </span>
      </div>
    );
  };

  /** One sibling level, front-to-back (reverse of the array). */
  const level = (siblings: ScreenElement[], depth: number): JSX.Element[] => {
    const display = siblings.slice().reverse();
    const seq = display.map((el) => el.id);
    return display.map((el, i) => {
      const kids = el.children ?? [];
      // ANY element with children expands like a group folder.
      if (el.kind !== 'group' && kids.length === 0) return row(el, depth, seq, i);
      const open = !collapsed.has(el.id);
      return (
        <div key={el.id} className="tt-layer-folder">
          {row(el, depth, seq, i)}
          {open && kids.length > 0 && level(kids, depth + 1)}
          {open && el.kind === 'group' && kids.length === 0 && (
            <p className="faint tt-layer-emptygrp" style={{ marginLeft: 26 + 18 * depth }}>
              Empty — drag elements inside.
            </p>
          )}
        </div>
      );
    });
  };

  if (elements.length === 0) {
    return <p className="faint tt-layers-empty">Nothing on the screen yet — add elements from the palette.</p>;
  }

  return (
    <div className="tt-layers" role="list" aria-label="Screen layers, front to back">
      {level(elements, 0)}
    </div>
  );
}
