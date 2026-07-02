/**
 * FiltersTab — the reusable named-filter library. Each filter is a condition
 * authored with $card bound (edited with the guided ConditionBuilder) that any
 * other condition can reference via the "matches a saved filter" clause.
 * Validation issues addressed to a filter (dangling ids, reference CYCLES —
 * a loop always evaluates to false at play time) render inline on its row.
 */
import { useMemo, useState } from 'react';
import type { Expr, GameDef, NamedFilterDef } from '../../shared/types';
import { uid } from '../../shared/defaults';
import { validateGameDef } from '../../shared/validate';
import { ConditionBuilder } from '../blocks/ConditionBuilder';
import { ConfirmModal } from '../common/Modal';
import { removeAt, updateAt } from '../lib';
import { countExprRefs } from './TypesTab';

function newFilter(): NamedFilterDef {
  // "Always true" — an honest blank slate the builder shows as "always".
  const condition: Expr = { kind: 'bool', value: true };
  return { id: uid('filter'), name: 'New filter', condition };
}

export function FiltersTab({ def, onChange }: { def: GameDef; onChange: (def: GameDef) => void }) {
  const filters = def.filters ?? [];
  const [pending, setPending] = useState<{ id: string; name: string; refs: number } | null>(null);

  const issuesByFilter = useMemo(() => {
    const all = validateGameDef(def);
    const map = new Map<string, typeof all>();
    for (const f of filters) {
      map.set(f.id, all.filter((i) => i.where === `Filter "${f.name}"` || i.where.startsWith(`Filter "${f.name}" >`)));
    }
    return map;
  }, [def, filters]);

  const update = (i: number, f: NamedFilterDef) => onChange({ ...def, filters: updateAt(filters, i, f) });

  const requestDelete = (f: NamedFilterDef, i: number) => {
    // References OUTSIDE the filter's own condition keep working only while
    // the filter exists — count them all, minus self-references.
    const refs = countExprRefs(def, 'filterRef', 'filterId', f.id) - countExprRefs(f.condition, 'filterRef', 'filterId', f.id);
    if (refs <= 0) onChange({ ...def, filters: removeAt(filters, i) });
    else setPending({ id: f.id, name: f.name, refs });
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Saved filters</h2>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => onChange({ ...def, filters: [...filters, newFilter()] })}>
          + Add filter
        </button>
      </div>
      <p className="faint">
        Name a card condition once (“The basic cards”), then reference it from any other condition
        with the “matches a saved filter” clause. $card is the card being tested.
      </p>

      {filters.length === 0 && <p className="muted">No saved filters yet.</p>}

      {filters.map((f, i) => {
        const issues = issuesByFilter.get(f.id) ?? [];
        return (
          <div className="panel ed-section" key={f.id}>
            <div className="row" style={{ marginBottom: 10 }}>
              <input
                type="text"
                className="input ed-item-name"
                value={f.name}
                aria-label="Filter name"
                onChange={(e) => update(i, { ...f, name: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-small btn-ghost ed-delete"
                aria-label={`Delete filter ${f.name}`}
                onClick={() => requestDelete(f, i)}
              >
                ✕
              </button>
            </div>
            <label className="field">
              <span>A card matches when ($card = the card being tested)</span>
              <ConditionBuilder
                def={def}
                value={f.condition}
                onChange={(condition) => condition && update(i, { ...f, condition })}
                bindings={['$card']}
              />
            </label>
            {issues.map((issue, j) => (
              <div key={j} className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                <span className={issue.severity === 'error' ? 'chip error' : 'chip warn'}>{issue.severity}</span>
                <span>{issue.message}</span>
              </div>
            ))}
          </div>
        );
      })}

      {pending && (
        <ConfirmModal
          title={`Delete filter "${pending.name}"?`}
          confirmLabel="Delete anyway"
          message={(
            <>
              <p><strong>{pending.refs}</strong> condition{pending.refs === 1 ? '' : 's'} reference{pending.refs === 1 ? 's' : ''} this filter.</p>
              <p className="faint">They will show as errors in the Issues list until you rebuild them.</p>
            </>
          )}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            onChange({ ...def, filters: filters.filter((x) => x.id !== pending.id) });
            setPending(null);
          }}
        />
      )}
    </div>
  );
}
