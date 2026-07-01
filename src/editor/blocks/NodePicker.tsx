/**
 * NodePicker — the categorized, searchable "add a node" sheet (bottom sheet
 * on mobile via the shared Modal). Two modes:
 *   - 'block': pick an exec node (a Block) — used from exec pins, the
 *     toolbar "+", empty-canvas double-tap/right-click, and the Start pin.
 *   - 'expr': pick a data node (an Expr) for a typed input pin — the list is
 *     FILTERED to expressions whose output is compatible with the pin.
 */
import { useMemo, useState } from 'react';
import type { Block, Expr, GameDef } from '../../shared/types';
import { Modal } from '../common/Modal';
import {
  BLOCKS, BLOCK_CATEGORY_LABELS, EXPRS, EXPR_CATEGORY_LABELS,
  type BlockMeta, type ExprMeta,
} from './registry';
import { exprKindOutType, isTypeCompatible, type PinType } from './graphModel';

export type NodePickerRequest =
  | { mode: 'block'; title?: string; onPick: (block: Block) => void }
  | { mode: 'expr'; title?: string; pinType: PinType; bindings: string[]; onPick: (expr: Expr) => void };

export function NodePicker({ def, request, onClose }: {
  def: GameDef;
  request: NodePickerRequest;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const matches = (label: string, description: string) =>
    q === '' || `${label} ${description}`.toLowerCase().includes(q);

  const groups = useMemo(() => {
    if (request.mode === 'block') {
      return BLOCK_CATEGORY_LABELS.map((cat) => ({
        label: cat.label,
        items: BLOCKS.filter((m) => m.category === cat.id) as (BlockMeta | ExprMeta)[],
      }));
    }
    const compatible = EXPRS.filter((m) => isTypeCompatible(request.pinType, exprKindOutType(m.kind)));
    return EXPR_CATEGORY_LABELS.map((cat) => ({
      label: cat.label,
      items: compatible.filter((m) => m.category === cat.id) as (BlockMeta | ExprMeta)[],
    }));
  }, [request]);

  const pick = (meta: BlockMeta | ExprMeta) => {
    if (request.mode === 'block') request.onPick((meta as BlockMeta).make(def));
    else request.onPick((meta as ExprMeta).make(def, request.bindings));
  };

  const title = request.title ?? (request.mode === 'block' ? 'Add a node' : 'Pick a value node');
  let empty = true;

  return (
    <Modal title={title} onClose={onClose}>
      <input
        type="search"
        className="input gr-search"
        placeholder="Search nodes…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search nodes"
      />
      {groups.map((group) => {
        const items = group.items.filter((m) => matches(m.label, m.description));
        if (items.length === 0) return null;
        empty = false;
        return (
          <div key={group.label}>
            <div className="blk-pick-cat">{group.label}</div>
            {items.map((m) => (
              <button key={m.kind} type="button" className="blk-pick-row" onClick={() => pick(m)}>
                <span className="blk-dot" style={{ background: `var(${m.color})` }} />
                <span className="blk-pick-text">
                  <span className="blk-pick-label">{m.label}</span>
                  <span className="blk-pick-desc">{m.description}</span>
                </span>
              </button>
            ))}
          </div>
        );
      })}
      {empty && <p className="faint">Nothing matches “{query}”.</p>}
    </Modal>
  );
}
