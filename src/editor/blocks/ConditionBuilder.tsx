/**
 * ConditionBuilder — the guided editor for boolean CONDITIONS (action
 * legality, trigger/ability conditions, end conditions, element visibility,
 * card filters). Replaces the raw ExpressionEditor in those slots: a sentence
 * chip opens a modal where the condition is a group of pick-list clause rows
 * ("all of / any of / none of"), with nested groups, a "not" toggle per
 * clause, and a plain-English readback line (exprToText).
 *
 * The tree ⇄ Expr mapping lives in conditionModel.ts (pure). Anything the
 * vocabulary cannot express renders as a read-only "advanced" row with a
 * replace affordance — existing data is never corrupted or dropped.
 *
 * Clause availability follows the slot's `bindings`: card clauses only where
 * a card binding ($card / $self) is in scope; variable / phase / zone / turn
 * clauses follow the def's lists.
 */
import { useState } from 'react';
import type { CompareOp, Expr, GameDef, VariableDef, ZoneRef } from '../../shared/types';
import { Modal } from '../common/Modal';
import { removeAt, updateAt } from '../lib';
import { ZoneRefFields } from './ExpressionEditor';
import { exprToText, zoneRefToText } from './exprToText';
import {
  compile, emptyTree, parse,
  type Clause, type ConditionGroup, type ConditionRow, type GroupOp,
} from './conditionModel';

export interface ConditionBuilderProps {
  def: GameDef;
  value: Expr | null;
  onChange: (expr: Expr | null) => void;
  /** Context bindings available, e.g. ['$card', '$player']. */
  bindings?: string[];
  /** When true, an empty condition saves as null ("always"). */
  allowNull?: boolean;
  /** Label for the null / empty state, e.g. "Always allowed". */
  nullLabel?: string;
}

export function ConditionBuilder({
  def, value, onChange, bindings = [], allowNull = false, nullLabel,
}: ConditionBuilderProps) {
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
        <ConditionBuilderModal
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

export function ConditionBuilderModal({ def, value, bindings, allowNull, nullLabel, onSave, onCancel }: {
  def: GameDef;
  value: Expr | null;
  bindings: string[];
  allowNull?: boolean;
  nullLabel?: string;
  onSave: (expr: Expr | null) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ConditionGroup>(() => (value ? parse(value) : emptyTree()));

  const save = () => {
    if (draft.rows.length === 0 && allowNull) onSave(null);
    else onSave(compile(draft));
  };

  return (
    <Modal
      title="When is this true?"
      onClose={onCancel}
      footer={(
        <>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          {allowNull && (
            <button type="button" className="btn" onClick={() => onSave(null)}>
              {nullLabel ?? 'Always'}
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={save}>Done</button>
        </>
      )}
    >
      <GroupEditor def={def} group={draft} onChange={setDraft} bindings={bindings} depth={0} />
      <p className="faint" style={{ marginTop: 12 }}>
        = {draft.rows.length === 0 ? (nullLabel ?? 'always') : exprToText(def, compile(draft))}
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Group editor (recursive)
// ---------------------------------------------------------------------------

const GROUP_OPS: { op: GroupOp; label: string }[] = [
  { op: 'all', label: 'All of these hold' },
  { op: 'any', label: 'Any of these holds' },
  { op: 'none', label: 'None of these holds' },
];

function GroupEditor({ def, group, onChange, bindings, depth, onRemove }: {
  def: GameDef;
  group: ConditionGroup;
  onChange: (g: ConditionGroup) => void;
  bindings: string[];
  depth: number;
  /** Present on nested groups: removes the whole group row. */
  onRemove?: () => void;
}) {
  const kinds = availableKinds(def, bindings);
  const setRow = (i: number, row: ConditionRow) => onChange({ ...group, rows: updateAt(group.rows, i, row) });
  const addRow = (row: ConditionRow) => onChange({ ...group, rows: [...group.rows, row] });
  const canUseFilters = (def.filters ?? []).length > 0 && cardSubjects(bindings).length > 0;

  return (
    <div
      style={depth > 0
        ? { borderLeft: '2px solid rgba(148, 134, 255, 0.45)', paddingLeft: 10, margin: '4px 0' }
        : undefined}
    >
      <div className="row wrap" style={{ marginBottom: 8, gap: 6 }}>
        <select
          className="select"
          style={{ width: 'auto' }}
          value={group.op}
          aria-label="Group mode"
          onChange={(e) => onChange({ ...group, op: e.target.value as GroupOp })}
        >
          {GROUP_OPS.map((g) => <option key={g.op} value={g.op}>{g.label}</option>)}
        </select>
        {onRemove && (
          <button type="button" className="btn btn-small btn-ghost" aria-label="Remove group" onClick={onRemove}>
            ✕
          </button>
        )}
      </div>

      {group.rows.length === 0 && (
        <p className="faint" style={{ margin: '4px 0 8px' }}>No conditions yet — this reads as “always”.</p>
      )}

      {group.rows.map((row, i) => {
        const remove = () => onChange({ ...group, rows: removeAt(group.rows, i) });
        if (row.kind === 'group') {
          return (
            <GroupEditor
              key={i}
              def={def}
              group={row}
              onChange={(g) => setRow(i, g)}
              bindings={bindings}
              depth={depth + 1}
              onRemove={remove}
            />
          );
        }
        if (row.kind === 'advanced') {
          return (
            <div key={i} className="row wrap" style={{ gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <span className="xp-chip" style={{ cursor: 'default' }} title="Built with the advanced editor — the guided builder can show it but not edit it.">
                ⚙ {exprToText(def, row.expr)}
              </span>
              <button
                type="button"
                className="btn btn-small"
                title="Discard this advanced condition and build a new one"
                onClick={() => setRow(i, makeDefaultClause(def, bindings))}
              >
                Replace
              </button>
              <button type="button" className="btn btn-small btn-ghost" aria-label="Remove condition" onClick={remove}>✕</button>
            </div>
          );
        }
        return (
          <ClauseRow
            key={i}
            def={def}
            clause={row}
            onChange={(c) => setRow(i, c)}
            onRemove={remove}
            bindings={bindings}
            kinds={kinds}
          />
        );
      })}

      <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
        <button type="button" className="btn btn-small" onClick={() => addRow(makeDefaultClause(def, bindings))}>
          + Condition
        </button>
        <button
          type="button"
          className="btn btn-small"
          title="A nested any-of / none-of group"
          onClick={() => addRow({ kind: 'group', op: 'any', rows: [makeDefaultClause(def, bindings)] })}
        >
          + Any / none group
        </button>
        {canUseFilters && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => addRow({
              kind: 'matchesFilter',
              card: defaultCardSubject(bindings),
              filterId: (def.filters ?? [])[0]?.id ?? '',
              negate: false,
            })}
          >
            + Saved filter
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Clause availability + defaults
// ---------------------------------------------------------------------------

/** Bindings that name a card the card clauses can read. */
const CARD_BINDING_NAMES = ['$card', '$self'];

function cardSubjects(bindings: string[]): string[] {
  return CARD_BINDING_NAMES.filter((b) => bindings.includes(b));
}

function defaultCardSubject(bindings: string[]): string {
  return cardSubjects(bindings)[0] ?? '$card';
}

interface KindOption { kind: Clause['kind']; label: string }

/** Clause kinds this slot can offer (bindings-gated, def-list-gated). */
function availableKinds(def: GameDef, bindings: string[]): KindOption[] {
  const out: KindOption[] = [];
  const hasCard = cardSubjects(bindings).length > 0;
  if (hasCard) {
    if ((def.cardTypes ?? []).length > 0) out.push({ kind: 'isType', label: 'card is a type…' });
    if ((def.cardTags ?? []).length > 0) out.push({ kind: 'hasTag', label: 'card has tag…' });
    out.push({ kind: 'fieldCompare', label: 'card field compares…' });
    out.push({ kind: 'nameOneOf', label: 'card name is one of…' });
    if ((def.filters ?? []).length > 0) out.push({ kind: 'matchesFilter', label: 'card matches a saved filter…' });
  }
  if (def.phases.length > 0) out.push({ kind: 'phaseIs', label: 'it’s a phase…' });
  if (def.variables.length > 0) out.push({ kind: 'varCompare', label: 'a variable compares…' });
  if (def.zones.length > 0) out.push({ kind: 'zoneCountCmp', label: 'a zone holds N cards…' });
  out.push({ kind: 'turnCompare', label: 'turn number compares…' });
  return out;
}

/** First custom card field, else 'rank' (the standard fallback). */
function defaultFieldId(def: GameDef): string {
  for (const t of def.templates) if (t.fields.length > 0) return t.fields[0].id;
  return 'rank';
}

function defaultVarValue(v: VariableDef | undefined): string | number | boolean {
  if (!v) return 0;
  return v.type === 'number' ? 0 : v.type === 'boolean' ? true : '';
}

export function makeClause(def: GameDef, bindings: string[], kind: Clause['kind']): Clause {
  const card = defaultCardSubject(bindings);
  switch (kind) {
    case 'isType':
      return { kind: 'isType', card, typeId: (def.cardTypes ?? [])[0]?.id ?? '', negate: false };
    case 'hasTag':
      return { kind: 'hasTag', card, tagId: (def.cardTags ?? [])[0]?.id ?? '', negate: false };
    case 'fieldCompare':
      return { kind: 'fieldCompare', card, fieldId: defaultFieldId(def), op: '==', value: 0, negate: false };
    case 'nameOneOf':
      return { kind: 'nameOneOf', card, names: [''], negate: false };
    case 'matchesFilter':
      return { kind: 'matchesFilter', card, filterId: (def.filters ?? [])[0]?.id ?? '', negate: false };
    case 'phaseIs':
      return { kind: 'phaseIs', phaseId: def.phases[0]?.id ?? '', negate: false };
    case 'varCompare': {
      const v = def.variables[0];
      return { kind: 'varCompare', varId: v?.id ?? '', target: null, op: '==', value: defaultVarValue(v), negate: false };
    }
    case 'zoneCountCmp':
      return { kind: 'zoneCountCmp', zone: { zoneId: def.zones[0]?.id ?? '', owner: null }, op: '>', count: 0, filter: null, negate: false };
    case 'turnCompare':
      return { kind: 'turnCompare', op: '>=', value: 2, negate: false };
  }
}

function makeDefaultClause(def: GameDef, bindings: string[]): Clause {
  const kinds = availableKinds(def, bindings);
  return makeClause(def, bindings, kinds[0]?.kind ?? 'turnCompare');
}

// ---------------------------------------------------------------------------
// Clause row
// ---------------------------------------------------------------------------

const COMPARE_OPS: [CompareOp, string][] = [
  ['==', 'is'], ['!=', 'is not'], ['<=', 'is at most'], ['>=', 'is at least'],
  ['>', 'is greater than'], ['<', 'is less than'],
];
const FIELD_OPS: [CompareOp, string][] = [...COMPARE_OPS, ['contains', 'contains word']];
const COUNT_OPS: [CompareOp, string][] = [
  ['==', 'exactly'], ['!=', 'any number but'], ['>=', 'at least'], ['<=', 'at most'],
  ['>', 'more than'], ['<', 'fewer than'],
];

function OpSelect({ ops, value, onChange }: {
  ops: [CompareOp, string][];
  value: CompareOp;
  onChange: (op: CompareOp) => void;
}) {
  return (
    <select
      className="select"
      style={{ width: 'auto' }}
      value={value}
      aria-label="Comparison"
      onChange={(e) => onChange(e.target.value as CompareOp)}
    >
      {!ops.some(([op]) => op === value) && <option value={value}>{value}</option>}
      {ops.map(([op, label]) => <option key={op} value={op}>{label}</option>)}
    </select>
  );
}

/** Id select over a {id, name} list, with a missing-id sentinel. */
function IdSelect({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
}) {
  return (
    <select
      className="select"
      style={{ width: 'auto' }}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
    >
      {!options.some((o) => o.id === value) && <option value={value}>⚠ missing {label.toLowerCase()}</option>}
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

function ClauseRow({ def, clause, onChange, onRemove, bindings, kinds }: {
  def: GameDef;
  clause: Clause;
  onChange: (c: Clause) => void;
  onRemove: () => void;
  bindings: string[];
  kinds: KindOption[];
}) {
  return (
    <div className="row wrap" style={{ gap: 6, marginBottom: 6, alignItems: 'center' }}>
      <button
        type="button"
        className={clause.negate ? 'btn btn-small' : 'btn btn-small btn-ghost'}
        aria-pressed={clause.negate}
        title="Flip this condition (NOT)"
        onClick={() => onChange({ ...clause, negate: !clause.negate })}
      >
        not
      </button>
      <select
        className="select"
        style={{ width: 'auto' }}
        value={clause.kind}
        aria-label="Condition type"
        onChange={(e) => onChange({ ...makeClause(def, bindings, e.target.value as Clause['kind']), negate: clause.negate })}
      >
        {!kinds.some((k) => k.kind === clause.kind) && <option value={clause.kind}>{clause.kind}</option>}
        {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
      <ClauseFields def={def} clause={clause} onChange={onChange} bindings={bindings} />
      <button type="button" className="btn btn-small btn-ghost" aria-label="Remove condition" onClick={onRemove}>✕</button>
    </div>
  );
}

/** Subject picker, shown only when more than one card binding is in scope. */
function SubjectSelect({ clause, onChange, bindings }: {
  clause: Extract<Clause, { card: string }>;
  onChange: (c: Clause) => void;
  bindings: string[];
}) {
  const subjects = cardSubjects(bindings);
  const all = subjects.includes(clause.card) ? subjects : [clause.card, ...subjects];
  if (all.length < 2) return null;
  return (
    <select
      className="select"
      style={{ width: 'auto' }}
      value={clause.card}
      aria-label="Which card"
      onChange={(e) => onChange({ ...clause, card: e.target.value })}
    >
      {all.map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
}

function ClauseFields({ def, clause, onChange, bindings }: {
  def: GameDef;
  clause: Clause;
  onChange: (c: Clause) => void;
  bindings: string[];
}) {
  switch (clause.kind) {
    case 'isType':
      return (
        <>
          <SubjectSelect clause={clause} onChange={onChange} bindings={bindings} />
          <span>is a</span>
          <IdSelect label="type" value={clause.typeId} options={def.cardTypes ?? []} onChange={(typeId) => onChange({ ...clause, typeId })} />
        </>
      );
    case 'hasTag':
      return (
        <>
          <SubjectSelect clause={clause} onChange={onChange} bindings={bindings} />
          <span>has tag</span>
          <IdSelect label="tag" value={clause.tagId} options={def.cardTags ?? []} onChange={(tagId) => onChange({ ...clause, tagId })} />
        </>
      );
    case 'matchesFilter':
      return (
        <>
          <SubjectSelect clause={clause} onChange={onChange} bindings={bindings} />
          <span>matches</span>
          <IdSelect label="filter" value={clause.filterId} options={def.filters ?? []} onChange={(filterId) => onChange({ ...clause, filterId })} />
        </>
      );
    case 'fieldCompare':
      return (
        <>
          <SubjectSelect clause={clause} onChange={onChange} bindings={bindings} />
          <FieldIdSelect def={def} value={clause.fieldId} onChange={(fieldId) => onChange({ ...clause, fieldId })} />
          <OpSelect ops={FIELD_OPS} value={clause.op} onChange={(op) => onChange({ ...clause, op })} />
          <LiteralInput
            value={clause.value}
            onChange={(value) => onChange({ ...clause, value })}
          />
        </>
      );
    case 'nameOneOf':
      return (
        <>
          <SubjectSelect clause={clause} onChange={onChange} bindings={bindings} />
          <span>{clause.names.length > 1 ? 'name is one of' : 'name is'}</span>
          {clause.names.map((n, i) => (
            <span key={i} className="row" style={{ gap: 2, alignItems: 'center' }}>
              <input
                type="text"
                className="input"
                style={{ width: 110 }}
                value={n}
                placeholder="card name"
                aria-label={`Name ${i + 1}`}
                onChange={(e) => onChange({ ...clause, names: updateAt(clause.names, i, e.target.value) })}
              />
              {clause.names.length > 1 && (
                <button
                  type="button"
                  className="btn btn-small btn-ghost"
                  aria-label={`Remove name ${i + 1}`}
                  onClick={() => onChange({ ...clause, names: removeAt(clause.names, i) })}
                >
                  ✕
                </button>
              )}
            </span>
          ))}
          <button
            type="button"
            className="btn btn-small btn-ghost"
            title="Add another name"
            onClick={() => onChange({ ...clause, names: [...clause.names, ''] })}
          >
            + name
          </button>
        </>
      );
    case 'phaseIs':
      return (
        <>
          <span>it’s the</span>
          <IdSelect label="phase" value={clause.phaseId} options={def.phases} onChange={(phaseId) => onChange({ ...clause, phaseId })} />
          <span>phase</span>
        </>
      );
    case 'varCompare': {
      const variable = def.variables.find((v) => v.id === clause.varId);
      return (
        <>
          <IdSelect
            label="variable"
            value={clause.varId}
            options={def.variables}
            onChange={(varId) => {
              const next = def.variables.find((v) => v.id === varId);
              onChange({ ...clause, varId, target: null, value: defaultVarValue(next) });
            }}
          />
          {variable && variable.scope !== 'global' && (
            <select
              className="select"
              style={{ width: 'auto' }}
              value={clause.target ?? ''}
              aria-label={variable.scope === 'perPlayer' ? 'Whose value' : "Which card's value"}
              onChange={(e) => onChange({ ...clause, target: e.target.value === '' ? null : e.target.value })}
            >
              <option value="">{variable.scope === 'perPlayer' ? 'of the contextual player' : 'of the contextual card'}</option>
              {clause.target !== null && !bindings.includes(clause.target) && (
                <option value={clause.target}>of {clause.target}</option>
              )}
              {bindings.map((b) => <option key={b} value={b}>of {b}</option>)}
            </select>
          )}
          <OpSelect ops={COMPARE_OPS} value={clause.op} onChange={(op) => onChange({ ...clause, op })} />
          {variable?.type === 'boolean' || typeof clause.value === 'boolean' ? (
            <select
              className="select"
              style={{ width: 'auto' }}
              value={clause.value === true ? 'yes' : 'no'}
              aria-label="Value"
              onChange={(e) => onChange({ ...clause, value: e.target.value === 'yes' })}
            >
              <option value="yes">yes</option>
              <option value="no">no</option>
            </select>
          ) : (
            <LiteralInput value={clause.value as string | number} onChange={(value) => onChange({ ...clause, value })} />
          )}
        </>
      );
    }
    case 'zoneCountCmp':
      return (
        <>
          <ZoneChip def={def} value={clause.zone} onChange={(zone) => onChange({ ...clause, zone })} bindings={bindings} />
          <span>holds</span>
          <OpSelect ops={COUNT_OPS} value={clause.op} onChange={(op) => onChange({ ...clause, op })} />
          <input
            type="number"
            className="input"
            style={{ width: 64 }}
            value={clause.count}
            aria-label="How many cards"
            onChange={(e) => onChange({ ...clause, count: Number(e.target.value) || 0 })}
          />
          <span>cards</span>
          {clause.filter === null ? (
            <button
              type="button"
              className="btn btn-small btn-ghost"
              title="Only count cards matching a condition ($card = each card)"
              onClick={() => onChange({
                ...clause,
                filter: { kind: 'group', op: 'all', rows: [makeDefaultClause(def, [...bindings, '$card'])] },
              })}
            >
              + matching…
            </button>
          ) : (
            <span style={{ flexBasis: '100%' }}>
              <span className="faint">matching ($card = each counted card):</span>
              <GroupEditor
                def={def}
                group={clause.filter}
                onChange={(filter) => onChange({ ...clause, filter })}
                bindings={[...bindings, '$card']}
                depth={1}
                onRemove={() => onChange({ ...clause, filter: null })}
              />
            </span>
          )}
        </>
      );
    case 'turnCompare':
      return (
        <>
          <span>turn number</span>
          <OpSelect ops={COMPARE_OPS} value={clause.op} onChange={(op) => onChange({ ...clause, op })} />
          <input
            type="number"
            className="input"
            style={{ width: 64 }}
            value={clause.value}
            aria-label="Turn number"
            onChange={(e) => onChange({ ...clause, value: Number(e.target.value) || 0 })}
          />
        </>
      );
  }
}

/** Card-field picker: standard52 fields + every template's custom fields. */
function FieldIdSelect({ def, value, onChange }: {
  def: GameDef;
  value: string;
  onChange: (fieldId: string) => void;
}) {
  const standard = ['suit', 'rank', 'rankName', 'color', 'name', 'isJoker'];
  const known = new Set(standard);
  for (const t of def.templates) for (const f of t.fields) known.add(f.id);
  return (
    <select
      className="select"
      style={{ width: 'auto' }}
      value={value}
      aria-label="Card field"
      onChange={(e) => onChange(e.target.value)}
    >
      {!known.has(value) && <option value={value}>{value} (unknown)</option>}
      {def.templates.map((t) => (
        <optgroup key={t.id} label={t.name}>
          {t.fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </optgroup>
      ))}
      <optgroup label="Standard cards">
        {standard.map((f) => <option key={f} value={f}>{f}</option>)}
      </optgroup>
    </select>
  );
}

/** Text-or-number literal with a small type toggle. */
function LiteralInput({ value, onChange }: {
  value: string | number;
  onChange: (v: string | number) => void;
}) {
  const isNum = typeof value === 'number';
  return (
    <span className="row" style={{ gap: 2, alignItems: 'center' }}>
      {isNum ? (
        <input
          type="number"
          className="input"
          style={{ width: 72 }}
          value={value}
          aria-label="Value"
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
      ) : (
        <input
          type="text"
          className="input"
          style={{ width: 110 }}
          value={value}
          placeholder="text…"
          aria-label="Value"
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <button
        type="button"
        className="btn btn-small btn-ghost"
        title={isNum ? 'Compare against text instead' : 'Compare against a number instead'}
        onClick={() => onChange(isNum ? '' : 0)}
      >
        {isNum ? 'Aa' : '#'}
      </button>
    </span>
  );
}

/** Zone chip: opens a small modal with the shared zone/owner fields. */
function ZoneChip({ def, value, onChange, bindings }: {
  def: GameDef;
  value: ZoneRef;
  onChange: (ref: ZoneRef) => void;
  bindings: string[];
}) {
  const [open, setOpen] = useState(false);
  const missing = !def.zones.some((z) => z.id === value.zoneId);
  return (
    <>
      <button
        type="button"
        className={missing ? 'blk-chip blk-chip-missing' : 'blk-chip'}
        onClick={() => setOpen(true)}
      >
        {zoneRefToText(def, value)}
      </button>
      {open && (
        <Modal
          title="Which zone?"
          onClose={() => setOpen(false)}
          footer={<button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>Done</button>}
        >
          <ZoneRefFields def={def} value={value} onChange={onChange} bindings={bindings} />
        </Modal>
      )}
    </>
  );
}
