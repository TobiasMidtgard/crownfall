/**
 * ExpressionEditor — builds/edits a single Expr tree via touch-friendly
 * pickers. Shows the expression as a readable sentence chip; tapping opens
 * the builder. Used for action legality, trigger/ability conditions, and
 * end conditions. Children are edited recursively as nested chips.
 *
 * Also exports the building blocks reused by the block slot editors:
 * ExprBuilderModal, ZoneRefFields, NumberExprField, FieldSelect.
 */
import { useState } from 'react';
import type { Expr, GameDef, ZoneRef } from '../../shared/types';
import { STANDARD_FIELDS } from '../../shared/types';
import { Modal } from '../common/Modal';
import { exprToText } from './exprToText';
import { EXPRS, EXPR_CATEGORY_LABELS, exprMeta } from './registry';

export interface ExpressionEditorProps {
  def: GameDef;
  value: Expr | null;
  onChange: (expr: Expr | null) => void;
  /** Context bindings available, e.g. ['$card', '$player']. */
  bindings?: string[];
  /** When true, the value may be cleared to null ("always"/"none"). */
  allowNull?: boolean;
  /** Label for the null state, e.g. "Always allowed". */
  nullLabel?: string;
}

/** The bindings on offer: the context's plus $choice (set by "Ask to choose"). */
function withChoice(bindings: string[]): string[] {
  return bindings.includes('$choice') ? bindings : [...bindings, '$choice'];
}

export function ExpressionEditor({
  def, value, onChange, bindings = [], allowNull = false, nullLabel,
}: ExpressionEditorProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={value ? 'xp-chip' : 'xp-chip xp-chip-empty'}
        onClick={() => setOpen(true)}
      >
        {value ? exprToText(def, value) : (nullLabel ?? 'always')}
      </button>
      {open && (
        <ExprBuilderModal
          def={def}
          value={value}
          bindings={bindings}
          allowNull={allowNull}
          nullLabel={nullLabel}
          onCancel={() => setOpen(false)}
          onSave={(e) => { setOpen(false); onChange(e); }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Builder modal
// ---------------------------------------------------------------------------

const hasLeftRight = (e: Expr): e is Extract<Expr, { left: Expr; right: Expr }> =>
  e.kind === 'math' || e.kind === 'compare' || e.kind === 'logic';

export function ExprBuilderModal({ def, value, bindings, allowNull, nullLabel, onSave, onCancel }: {
  def: GameDef;
  value: Expr | null;
  bindings: string[];
  allowNull?: boolean;
  nullLabel?: string;
  onSave: (expr: Expr | null) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Expr | null>(value);
  const [picking, setPicking] = useState(value === null);
  const allBindings = withChoice(bindings);

  const pick = (kind: Expr['kind']) => {
    const next = exprMeta(kind).make(def, allBindings);
    // Switching between compare/math/logic keeps the operands you built.
    if (draft && hasLeftRight(draft) && hasLeftRight(next)) {
      (next as { left: Expr; right: Expr }).left = draft.left;
      (next as { left: Expr; right: Expr }).right = draft.right;
    }
    setDraft(next);
    setPicking(false);
  };

  return (
    <Modal
      title={picking ? 'Pick a value' : 'Edit value'}
      onClose={onCancel}
      footer={(
        <>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          {allowNull && (
            <button type="button" className="btn" onClick={() => onSave(null)}>
              {nullLabel ?? 'None'}
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary"
            disabled={picking || draft === null}
            onClick={() => draft && onSave(draft)}
          >
            Done
          </button>
        </>
      )}
    >
      {picking || draft === null ? (
        <ExprKindPicker onPick={pick} />
      ) : (
        <>
          <div className="xp-preview">
            <span className="xp-preview-text">{exprToText(def, draft)}</span>
            <button type="button" className="btn" onClick={() => setPicking(true)}>
              Change kind
            </button>
          </div>
          <ExprFields def={def} draft={draft} setDraft={setDraft} bindings={allBindings} />
        </>
      )}
    </Modal>
  );
}

function ExprKindPicker({ onPick }: { onPick: (kind: Expr['kind']) => void }) {
  return (
    <div>
      {EXPR_CATEGORY_LABELS.map((cat) => {
        const items = EXPRS.filter((m) => m.category === cat.id);
        if (items.length === 0) return null;
        return (
          <div key={cat.id}>
            <div className="blk-pick-cat">{cat.label}</div>
            {items.map((m) => (
              <button key={m.kind} type="button" className="blk-pick-row" onClick={() => onPick(m.kind)}>
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-kind field editors
// ---------------------------------------------------------------------------

function ExprFields({ def, draft, setDraft, bindings }: {
  def: GameDef;
  draft: Expr;
  setDraft: (e: Expr) => void;
  bindings: string[];
}) {
  switch (draft.kind) {
    case 'num':
      return (
        <label className="field">
          <span>Number</span>
          <input
            type="number"
            className="input"
            value={draft.value}
            onChange={(e) => setDraft({ kind: 'num', value: Number(e.target.value) || 0 })}
          />
        </label>
      );
    case 'str':
      return (
        <label className="field">
          <span>Text</span>
          <input
            type="text"
            className="input"
            value={draft.value}
            placeholder="e.g. hearts"
            onChange={(e) => setDraft({ kind: 'str', value: e.target.value })}
          />
        </label>
      );
    case 'bool':
      return (
        <div className="ed-seg" role="group" aria-label="Yes or no">
          <button
            type="button"
            className={draft.value ? 'ed-seg-btn active' : 'ed-seg-btn'}
            onClick={() => setDraft({ kind: 'bool', value: true })}
          >
            Yes
          </button>
          <button
            type="button"
            className={!draft.value ? 'ed-seg-btn active' : 'ed-seg-btn'}
            onClick={() => setDraft({ kind: 'bool', value: false })}
          >
            No
          </button>
        </div>
      );
    case 'random':
      return (
        <label className="field">
          <span>Maximum (result is 1 … max)</span>
          <NumberExprField def={def} value={draft.max} onChange={(max) => setDraft({ ...draft, max })} bindings={bindings} />
        </label>
      );
    case 'phasePos':
    case 'phaseIs': {
      const kind = draft.kind;
      return (
        <label className="field">
          <span>Phase</span>
          <select
            className="select"
            value={draft.phaseId}
            onChange={(e) => setDraft({ kind, phaseId: e.target.value })}
          >
            {!def.phases.some((p) => p.id === draft.phaseId) && (
              <option value={draft.phaseId}>⚠ missing phase</option>
            )}
            {def.phases.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>
      );
    }
    case 'getVar': {
      const variable = def.variables.find((v) => v.id === draft.varId);
      return (
        <>
          <label className="field">
            <span>Variable</span>
            {def.variables.length === 0 ? (
              <span className="faint">No variables yet — add some on the Systems page.</span>
            ) : (
              <select
                className="select"
                value={draft.varId}
                onChange={(e) => setDraft({ kind: 'getVar', varId: e.target.value, target: null })}
              >
                {!def.variables.some((v) => v.id === draft.varId) && <option value={draft.varId}>⚠ missing variable</option>}
                {def.variables.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.scope})</option>)}
              </select>
            )}
          </label>
          {variable?.scope === 'perPlayer' && (
            <TargetPicker
              def={def} mode="player" label="Whose value"
              value={draft.target} onChange={(target) => setDraft({ ...draft, target })} bindings={bindings}
            />
          )}
          {variable?.scope === 'perCard' && (
            <TargetPicker
              def={def} mode="card" label="Which card's value"
              value={draft.target} onChange={(target) => setDraft({ ...draft, target })} bindings={bindings}
            />
          )}
        </>
      );
    }
    case 'zoneCount':
      return <ZoneRefFields def={def} value={draft.zone} onChange={(zone) => setDraft({ ...draft, zone })} bindings={bindings} />;
    case 'topCard':
      return <ZoneRefFields def={def} value={draft.zone} onChange={(zone) => setDraft({ ...draft, zone })} bindings={bindings} />;
    case 'countCards':
      return (
        <>
          <ZoneRefFields def={def} value={draft.zone} onChange={(zone) => setDraft({ ...draft, zone })} bindings={bindings} />
          <label className="field">
            <span>Only count cards where ($card = each card)</span>
            <ExpressionEditor
              def={def}
              value={draft.filter}
              onChange={(filter) => setDraft({ ...draft, filter })}
              bindings={[...bindings, '$card']}
              allowNull
              nullLabel="count every card"
            />
          </label>
        </>
      );
    case 'sumCards':
      return (
        <>
          <FieldSelect def={def} value={draft.fieldId} onChange={(fieldId) => setDraft({ ...draft, fieldId })} label="Field to sum (non-numbers count 0)" />
          <ZoneRefFields def={def} value={draft.zone} onChange={(zone) => setDraft({ ...draft, zone })} bindings={bindings} />
          <label className="field">
            <span>Only sum cards where ($card = each card)</span>
            <ExpressionEditor
              def={def}
              value={draft.filter}
              onChange={(filter) => setDraft({ ...draft, filter })}
              bindings={[...bindings, '$card']}
              allowNull
              nullLabel="sum every card"
            />
          </label>
        </>
      );
    case 'bestCard':
      return (
        <>
          <div className="ed-seg" role="group" aria-label="Highest or lowest">
            <button
              type="button"
              className={draft.by === 'highest' ? 'ed-seg-btn active' : 'ed-seg-btn'}
              onClick={() => setDraft({ ...draft, by: 'highest' })}
            >
              Highest
            </button>
            <button
              type="button"
              className={draft.by === 'lowest' ? 'ed-seg-btn active' : 'ed-seg-btn'}
              onClick={() => setDraft({ ...draft, by: 'lowest' })}
            >
              Lowest
            </button>
          </div>
          <FieldSelect def={def} value={draft.fieldId} onChange={(fieldId) => setDraft({ ...draft, fieldId })} label="By field" />
          <ZoneRefFields def={def} value={draft.zone} onChange={(zone) => setDraft({ ...draft, zone })} bindings={bindings} />
          <label className="field">
            <span>Only among cards where ($card = each card)</span>
            <ExpressionEditor
              def={def}
              value={draft.filter}
              onChange={(filter) => setDraft({ ...draft, filter })}
              bindings={[...bindings, '$card']}
              allowNull
              nullLabel="any card"
            />
          </label>
        </>
      );
    case 'cardField':
      return (
        <>
          <label className="field">
            <span>Card</span>
            <ExpressionEditor
              def={def}
              value={draft.card}
              onChange={(card) => card && setDraft({ ...draft, card })}
              bindings={bindings}
            />
          </label>
          <FieldSelect def={def} value={draft.fieldId} onChange={(fieldId) => setDraft({ ...draft, fieldId })} label="Field" />
        </>
      );
    case 'cardOwner':
    case 'cardZoneId':
      return (
        <label className="field">
          <span>Card</span>
          <ExpressionEditor
            def={def}
            value={draft.card}
            onChange={(card) => card && setDraft({ ...draft, card })}
            bindings={bindings}
          />
        </label>
      );
    case 'cardTypeIs':
      return (
        <>
          <label className="field">
            <span>Card</span>
            <ExpressionEditor
              def={def}
              value={draft.card}
              onChange={(card) => card && setDraft({ ...draft, card })}
              bindings={bindings}
            />
          </label>
          <VocabSelect
            label="Type"
            value={draft.typeId}
            options={def.cardTypes ?? []}
            emptyHint="No card types yet — add some in the Types tab."
            onChange={(typeId) => setDraft({ ...draft, typeId })}
          />
        </>
      );
    case 'cardHasTag':
      return (
        <>
          <label className="field">
            <span>Card</span>
            <ExpressionEditor
              def={def}
              value={draft.card}
              onChange={(card) => card && setDraft({ ...draft, card })}
              bindings={bindings}
            />
          </label>
          <VocabSelect
            label="Tag"
            value={draft.tagId}
            options={def.cardTags ?? []}
            emptyHint="No tags yet — add some in the Types tab."
            onChange={(tagId) => setDraft({ ...draft, tagId })}
          />
        </>
      );
    case 'filterRef':
      return (
        <>
          <label className="field">
            <span>Card</span>
            <ExpressionEditor
              def={def}
              value={draft.card}
              onChange={(card) => card && setDraft({ ...draft, card })}
              bindings={bindings}
            />
          </label>
          <VocabSelect
            label="Filter"
            value={draft.filterId}
            options={def.filters ?? []}
            emptyHint="No saved filters yet — add one in the Filters panel."
            onChange={(filterId) => setDraft({ ...draft, filterId })}
          />
        </>
      );
    case 'binding':
      return (
        <label className="field">
          <span>Context value</span>
          <select
            className="select"
            value={draft.name}
            onChange={(e) => setDraft({ kind: 'binding', name: e.target.value })}
          >
            {!bindings.includes(draft.name) && <option value={draft.name}>{draft.name}</option>}
            {bindings.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
      );
    case 'currentPlayer':
      return <p className="faint">The player whose turn it is right now.</p>;
    case 'playerCount':
      return <p className="faint">The number of players in this game.</p>;
    case 'turnNumber':
      return <p className="faint">The current turn number (the first turn is 1).</p>;
    case 'nextPlayer':
      return (
        <label className="field">
          <span>The player after</span>
          <ExpressionEditor
            def={def}
            value={draft.from}
            onChange={(from) => from && setDraft({ ...draft, from })}
            bindings={bindings}
          />
        </label>
      );
    case 'math':
      return (
        <PairFields
          def={def} bindings={bindings}
          left={draft.left} right={draft.right}
          op={draft.op}
          ops={[['+', '+ add'], ['-', '− subtract'], ['*', '× multiply'], ['/', '÷ divide'], ['%', 'mod remainder']]}
          onChange={(left, op, right) => setDraft({ kind: 'math', op: op as typeof draft.op, left, right })}
        />
      );
    case 'compare':
      return (
        <PairFields
          def={def} bindings={bindings}
          left={draft.left} right={draft.right}
          op={draft.op}
          ops={[['==', '= equals'], ['!=', '≠ not equal'], ['<', '< less than'], ['<=', '≤ at most'], ['>', '> greater than'], ['>=', '≥ at least'], ['contains', 'contains word — right value is a whole word in the left text']]}
          onChange={(left, op, right) => setDraft({ kind: 'compare', op: op as typeof draft.op, left, right })}
        />
      );
    case 'logic':
      return (
        <PairFields
          def={def} bindings={bindings}
          left={draft.left} right={draft.right}
          op={draft.op}
          ops={[['and', 'AND — both must hold'], ['or', 'OR — either is enough']]}
          onChange={(left, op, right) => setDraft({ kind: 'logic', op: op as typeof draft.op, left, right })}
        />
      );
    case 'not':
      return (
        <label className="field">
          <span>Is NOT true</span>
          <ExpressionEditor
            def={def}
            value={draft.expr}
            onChange={(expr) => expr && setDraft({ ...draft, expr })}
            bindings={bindings}
          />
        </label>
      );
  }
}

function PairFields({ def, bindings, left, right, op, ops, onChange }: {
  def: GameDef;
  bindings: string[];
  left: Expr;
  right: Expr;
  op: string;
  ops: [string, string][];
  onChange: (left: Expr, op: string, right: Expr) => void;
}) {
  return (
    <>
      <label className="field">
        <span>Left</span>
        <ExpressionEditor def={def} value={left} onChange={(e) => e && onChange(e, op, right)} bindings={bindings} />
      </label>
      <label className="field">
        <span>Operation</span>
        <select className="select" value={op} onChange={(e) => onChange(left, e.target.value, right)}>
          {ops.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </label>
      <label className="field">
        <span>Right</span>
        <ExpressionEditor def={def} value={right} onChange={(e) => e && onChange(left, op, e)} bindings={bindings} />
      </label>
    </>
  );
}

/**
 * Card-vocabulary picker (types / tags / saved filters): a plain id select
 * over the def's list, with a missing-entry sentinel and a hint pointing at
 * the authoring panel while the list is still empty.
 */
function VocabSelect({ label, value, options, emptyHint, onChange }: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  emptyHint: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {options.length === 0 ? (
        <span className="faint">{emptyHint}</span>
      ) : (
        <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
          {!options.some((o) => o.id === value) && (
            <option value={value}>⚠ missing {label.toLowerCase()}</option>
          )}
          {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      )}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Shared field editors (also used by the block slot modals)
// ---------------------------------------------------------------------------

/** Card field picker: standard52 fields plus every template's custom fields. */
export function FieldSelect({ def, value, onChange, label }: {
  def: GameDef;
  value: string;
  onChange: (fieldId: string) => void;
  label: string;
}) {
  const known = new Set<string>(STANDARD_FIELDS);
  for (const t of def.templates) for (const f of t.fields) known.add(f.id);
  return (
    <label className="field">
      <span>{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {!known.has(value) && <option value={value}>{value} (unknown)</option>}
        <optgroup label="Standard cards">
          {STANDARD_FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
        </optgroup>
        {def.templates.map((t) => (
          <optgroup key={t.id} label={t.name}>
            {t.fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/**
 * Player/card target picker for perPlayer/perCard slots (variable targets,
 * zone owners): contextual default, current player, context bindings, or a
 * custom expression.
 */
export function TargetPicker({ def, mode, label, value, onChange, bindings }: {
  def: GameDef;
  mode: 'player' | 'card';
  label: string;
  value: Expr | null;
  onChange: (target: Expr | null) => void;
  bindings: string[];
}) {
  const selectValue =
    value === null ? 'ctx'
    : value.kind === 'currentPlayer' ? 'current'
    : value.kind === 'binding' ? `b:${value.name}`
    : 'custom';

  const contextualLabel = mode === 'player'
    ? 'Contextual player (whoever the script is about)'
    : 'Contextual card ($card / $self)';

  return (
    <label className="field">
      <span>{label}</span>
      <select
        className="select"
        value={selectValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'ctx') onChange(null);
          else if (v === 'current') onChange({ kind: 'currentPlayer' });
          else if (v.startsWith('b:')) onChange({ kind: 'binding', name: v.slice(2) });
          else onChange(value && selectValue === 'custom' ? value : { kind: 'currentPlayer' });
        }}
      >
        <option value="ctx">{contextualLabel}</option>
        {mode === 'player' && <option value="current">Current player</option>}
        {bindings.map((b) => <option key={b} value={`b:${b}`}>{b}</option>)}
        <option value="custom">Custom expression…</option>
      </select>
      {selectValue === 'custom' && (
        <div className="ed-subfield">
          <ExpressionEditor def={def} value={value} onChange={(e) => e && onChange(e)} bindings={bindings} />
        </div>
      )}
    </label>
  );
}

/** Zone reference editor: zone select + owner picker for perPlayer zones. */
export function ZoneRefFields({ def, value, onChange, bindings, label = 'Zone' }: {
  def: GameDef;
  value: ZoneRef;
  onChange: (ref: ZoneRef) => void;
  bindings: string[];
  label?: string;
}) {
  const zone = def.zones.find((z) => z.id === value.zoneId);
  return (
    <>
      <label className="field">
        <span>{label}</span>
        <select
          className="select"
          value={value.zoneId}
          onChange={(e) => {
            const nextZone = def.zones.find((z) => z.id === e.target.value);
            onChange({
              zoneId: e.target.value,
              owner: nextZone?.owner === 'perPlayer' ? value.owner : null,
            });
          }}
        >
          {!zone && <option value={value.zoneId}>⚠ missing zone</option>}
          {def.zones.map((z) => (
            <option key={z.id} value={z.id}>{z.name}{z.owner === 'perPlayer' ? ' (per player)' : ''}</option>
          ))}
        </select>
      </label>
      {zone?.owner === 'perPlayer' && (
        <TargetPicker
          def={def} mode="player" label="Whose copy of the zone"
          value={value.owner}
          onChange={(owner) => onChange({ ...value, owner })}
          bindings={bindings}
        />
      )}
    </>
  );
}

/** Numeric slot: a literal number input, or switch to a full expression. */
export function NumberExprField({ def, value, onChange, bindings }: {
  def: GameDef;
  value: Expr;
  onChange: (expr: Expr) => void;
  bindings: string[];
}) {
  const [builderOpen, setBuilderOpen] = useState(false);
  return (
    <div className="row wrap">
      {value.kind === 'num' ? (
        <>
          <input
            type="number"
            className="input ed-num-input"
            value={value.value}
            onChange={(e) => onChange({ kind: 'num', value: Number(e.target.value) || 0 })}
          />
          <button type="button" className="btn btn-ghost" onClick={() => setBuilderOpen(true)}>
            ƒ use expression…
          </button>
        </>
      ) : (
        <>
          <ExpressionEditor def={def} value={value} onChange={(e) => e && onChange(e)} bindings={bindings} />
          <button type="button" className="btn btn-ghost" onClick={() => onChange({ kind: 'num', value: 1 })}>
            # use plain number
          </button>
        </>
      )}
      {builderOpen && (
        <ExprBuilderModal
          def={def}
          value={value}
          bindings={bindings}
          onCancel={() => setBuilderOpen(false)}
          onSave={(e) => { setBuilderOpen(false); if (e) onChange(e); }}
        />
      )}
    </div>
  );
}
