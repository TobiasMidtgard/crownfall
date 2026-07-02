/**
 * NodeBody — the inline controls rendered on node bodies (UE-style inline
 * pins): literal inputs on unwired data pins, and the enum-ish/rich fields
 * (zone selects, var targets, card selectors, choice specs…) that never
 * become data nodes. Reuses the existing slot chips + ExpressionEditor so
 * rich fields open the same modals as before.
 */
import type { ReactNode } from 'react';
import type { Block, Expr, GameDef } from '../../shared/types';
import { STANDARD_FIELDS } from '../../shared/types';
import { ExpressionEditor } from './ExpressionEditor';
import {
  AnnouncePartsChip, CardSelectorChip, ChoiceSpecChip, FaceUpCycleChip,
  FaceUpToggleChip, PositionChip, VarTargetChip, WinnerSpecChip, ZoneIdChip,
  ZoneRefChip,
} from './slots';
import type { DataSlotSpec } from './graphModel';

const Label = ({ children }: { children: ReactNode }) => <span className="gr-flabel">{children}</span>;

// ---------------------------------------------------------------------------
// Inline value on an unwired data pin: literal input or null placeholder.
// ---------------------------------------------------------------------------

export function InlineSlotValue({ def, slot, value, bindings, onChange }: {
  def: GameDef;
  slot: DataSlotSpec;
  value: Expr | null;
  bindings: string[];
  onChange: (expr: Expr | null) => void;
}) {
  if (value === null) {
    return (
      <ExpressionEditor
        def={def}
        value={null}
        onChange={onChange}
        bindings={bindings}
        allowNull={slot.nullLabel !== undefined}
        nullLabel={slot.nullLabel}
      />
    );
  }
  switch (value.kind) {
    case 'num':
      return (
        <input
          type="number"
          className="input gr-inline-num"
          value={value.value}
          aria-label={slot.label}
          onChange={(e) => onChange({ kind: 'num', value: Number(e.target.value) || 0 })}
        />
      );
    case 'str':
      return (
        <input
          type="text"
          className="input gr-inline-text"
          value={value.value}
          aria-label={slot.label}
          onChange={(e) => onChange({ kind: 'str', value: e.target.value })}
        />
      );
    case 'bool':
      return (
        <button
          type="button"
          className="blk-chip"
          title="Tap to flip"
          onClick={() => onChange({ kind: 'bool', value: !value.value })}
        >
          {value.value ? 'yes' : 'no'}
        </button>
      );
    default:
      return null; // non-literal values are wired data nodes, not inline
  }
}

// ---------------------------------------------------------------------------
// Compact field selects shared by exec + data nodes
// ---------------------------------------------------------------------------

function InlineFieldSelect({ def, value, onChange, label }: {
  def: GameDef;
  value: string;
  onChange: (fieldId: string) => void;
  label: string;
}) {
  const known = new Set<string>(STANDARD_FIELDS);
  for (const t of def.templates) for (const f of t.fields) known.add(f.id);
  return (
    <select className="gr-select" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
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
  );
}

/** Free-form move-cause tag (canonical vocabulary in the tooltip). */
function MoveTagInput({ value, placeholder, onChange }: {
  value: string;
  placeholder: string;
  onChange: (raw: string) => void;
}) {
  return (
    <input
      type="text"
      className="input gr-inline-text"
      value={value}
      aria-label="Move tag"
      placeholder={placeholder}
      title="Cause tag carried on the move's enter/leave events — triggers and abilities can filter on it. Canonical: gain, buy, trash, discard, play, draw, cleanup."
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

// ---------------------------------------------------------------------------
// Exec node field rows
// ---------------------------------------------------------------------------

export function ExecFieldControl({ def, block, fieldKey, bindings, onChange }: {
  def: GameDef;
  block: Block;
  fieldKey: string;
  bindings: string[];
  onChange: (block: Block) => void;
}) {
  switch (block.kind) {
    case 'moveCards':
      if (fieldKey === 'cards') {
        return <><Label>cards</Label><CardSelectorChip def={def} value={block.cards} onChange={(cards) => onChange({ ...block, cards })} bindings={bindings} /></>;
      }
      if (fieldKey === 'from') {
        return <><Label>from</Label><ZoneRefChip def={def} value={block.from} onChange={(from) => onChange({ ...block, from })} bindings={bindings} title="From which zone?" /></>;
      }
      if (fieldKey === 'to') {
        return <><Label>to</Label><ZoneRefChip def={def} value={block.to} onChange={(to) => onChange({ ...block, to })} bindings={bindings} title="To which zone?" /></>;
      }
      if (fieldKey === 'placement') {
        return (
          <>
            <PositionChip value={block.toPosition} onChange={(toPosition) => onChange({ ...block, toPosition })} />
            <FaceUpCycleChip value={block.faceUp} onChange={(faceUp) => onChange({ ...block, faceUp })} />
          </>
        );
      }
      if (fieldKey === 'tag') {
        return (
          <>
            <Label>tag</Label>
            <MoveTagInput
              value={block.tag ?? ''}
              placeholder="no tag"
              onChange={(raw) => onChange({ ...block, tag: raw === '' ? null : raw })}
            />
          </>
        );
      }
      return null;
    case 'draw':
      if (fieldKey === 'from') {
        return <><Label>from</Label><ZoneRefChip def={def} value={block.from} onChange={(from) => onChange({ ...block, from })} bindings={bindings} title="Draw from which zone?" /></>;
      }
      if (fieldKey === 'refillFrom') {
        return (
          <>
            <Label>refill</Label>
            {block.refillFrom === null ? (
              <button
                type="button"
                className="blk-chip"
                title="When the source runs out, shuffle this zone in and keep drawing"
                onClick={() => onChange({
                  ...block,
                  refillFrom: { zoneId: def.zones.find((z) => z.id !== block.from.zoneId)?.id ?? '', owner: null },
                })}
              >
                no refill
              </button>
            ) : (
              <>
                <ZoneRefChip
                  def={def}
                  value={block.refillFrom}
                  onChange={(refillFrom) => onChange({ ...block, refillFrom })}
                  bindings={bindings}
                  title="Reshuffle which zone in when the source runs out?"
                />
                <button
                  type="button"
                  className="blk-chip"
                  aria-label="Remove the refill zone"
                  title="Remove the refill zone"
                  onClick={() => onChange({ ...block, refillFrom: null })}
                >
                  ✕
                </button>
              </>
            )}
          </>
        );
      }
      if (fieldKey === 'to') {
        return <><Label>to</Label><ZoneRefChip def={def} value={block.to} onChange={(to) => onChange({ ...block, to })} bindings={bindings} title="Draw into which zone?" /></>;
      }
      if (fieldKey === 'facing') {
        return <FaceUpCycleChip value={block.faceUp} onChange={(faceUp) => onChange({ ...block, faceUp })} />;
      }
      if (fieldKey === 'tag') {
        return (
          <>
            <Label>tag</Label>
            <MoveTagInput
              value={block.tag ?? ''}
              placeholder="draw"
              onChange={(raw) => onChange({ ...block, tag: raw === '' ? undefined : raw })}
            />
          </>
        );
      }
      return null;
    case 'shuffle':
      return <><Label>zone</Label><ZoneRefChip def={def} value={block.zone} onChange={(zone) => onChange({ ...block, zone })} bindings={bindings} /></>;
    case 'deal':
      if (fieldKey === 'from') {
        return <><Label>from</Label><ZoneRefChip def={def} value={block.from} onChange={(from) => onChange({ ...block, from })} bindings={bindings} title="Deal from which zone?" /></>;
      }
      if (fieldKey === 'toZoneId') {
        return <><Label>to each</Label><ZoneIdChip def={def} value={block.toZoneId} onChange={(toZoneId) => onChange({ ...block, toZoneId })} perPlayerOnly title="Deal into which zone?" /></>;
      }
      return null;
    case 'setVar':
    case 'changeVar':
      return (
        <>
          <Label>var</Label>
          <VarTargetChip
            def={def}
            varId={block.varId}
            target={block.target}
            onChange={(varId, target) => onChange({ ...block, varId, target })}
            bindings={bindings}
          />
        </>
      );
    case 'forEachCard':
      return <><Label>in</Label><ZoneRefChip def={def} value={block.zone} onChange={(zone) => onChange({ ...block, zone })} bindings={bindings} /></>;
    case 'choose':
      return <><Label>picks</Label><ChoiceSpecChip def={def} value={block.choice} onChange={(choice) => onChange({ ...block, choice })} bindings={bindings} /></>;
    case 'chooseCards':
      if (fieldKey === 'from') {
        return <><Label>from</Label><ZoneRefChip def={def} value={block.from} onChange={(from) => onChange({ ...block, from })} bindings={bindings} title="Choose from which zone?" /></>;
      }
      if (fieldKey === 'prompt') {
        return (
          <>
            <Label>prompt</Label>
            <input
              type="text"
              className="input gr-inline-text"
              value={block.prompt}
              aria-label="Prompt shown to the player"
              onChange={(e) => onChange({ ...block, prompt: e.target.value })}
            />
          </>
        );
      }
      if (fieldKey === 'revealed') {
        return (
          <button
            type="button"
            className="blk-chip"
            title="Show face-down candidates to the chooser?"
            onClick={() => onChange({ ...block, revealed: !block.revealed })}
          >
            {block.revealed ? 'revealed to chooser' : 'faces stay hidden'}
          </button>
        );
      }
      return null;
    case 'choosePile':
      if (fieldKey === 'from') {
        return <><Label>from</Label><ZoneRefChip def={def} value={block.from} onChange={(from) => onChange({ ...block, from })} bindings={bindings} title="Group which zone into piles?" /></>;
      }
      if (fieldKey === 'prompt') {
        return (
          <>
            <Label>prompt</Label>
            <input
              type="text"
              className="input gr-inline-text"
              value={block.prompt}
              aria-label="Prompt shown to the player"
              onChange={(e) => onChange({ ...block, prompt: e.target.value })}
            />
          </>
        );
      }
      if (fieldKey === 'optional') {
        return (
          <button
            type="button"
            className="blk-chip"
            title="Mandatory: must pick a pile while any exists. Optional: may decline (the body is skipped)."
            onClick={() => onChange({ ...block, optional: !block.optional })}
          >
            {block.optional ? 'may decline' : 'must pick'}
          </button>
        );
      }
      if (fieldKey === 'revealed') {
        return (
          <button
            type="button"
            className="blk-chip"
            title="Show face-down piles' representatives to the chooser? (a hidden stock like the Black Market)"
            onClick={() => onChange({ ...block, revealed: block.revealed !== true })}
          >
            {block.revealed === true ? 'revealed to chooser' : 'faces stay hidden'}
          </button>
        );
      }
      return null;
    case 'triggerAbilities':
      return (
        <>
          <Label>as entering</Label>
          <ZoneIdChip
            def={def}
            value={block.zoneId}
            onChange={(zoneId) => onChange({ ...block, zoneId })}
            title="Fire the card's enter-zone abilities for which zone?"
          />
        </>
      );
    case 'cancelTopEffect':
      return (
        <>
          <Label>card to</Label>
          <select
            className="gr-select"
            value={block.cardTo ?? ''}
            aria-label="Move the canceled card to"
            onChange={(e) => onChange({ ...block, cardTo: e.target.value === '' ? null : e.target.value })}
          >
            <option value="">leave in place</option>
            {def.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </>
      );
    case 'announce':
      return <><Label>say</Label><AnnouncePartsChip def={def} value={block.parts} onChange={(parts) => onChange({ ...block, parts })} bindings={bindings} /></>;
    case 'flipCards':
      if (fieldKey === 'cards') {
        return <><Label>cards</Label><CardSelectorChip def={def} value={block.cards} onChange={(cards) => onChange({ ...block, cards })} bindings={bindings} /></>;
      }
      if (fieldKey === 'zone') {
        return <><Label>in</Label><ZoneRefChip def={def} value={block.zone} onChange={(zone) => onChange({ ...block, zone })} bindings={bindings} /></>;
      }
      if (fieldKey === 'facing') {
        return <FaceUpToggleChip value={block.faceUp} onChange={(faceUp) => onChange({ ...block, faceUp })} />;
      }
      return null;
    case 'endGame':
      return <><Label>winner</Label><WinnerSpecChip def={def} value={block.winner} onChange={(winner) => onChange({ ...block, winner })} bindings={bindings} /></>;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Data node field rows
// ---------------------------------------------------------------------------

const MATH_OPS: [string, string][] = [['+', '+ add'], ['-', '− subtract'], ['*', '× multiply'], ['/', '÷ divide'], ['%', 'mod remainder']];
const COMPARE_OPS: [string, string][] = [['==', '= equals'], ['!=', '≠ not equal'], ['<', '< less than'], ['<=', '≤ at most'], ['>', '> greater than'], ['>=', '≥ at least'], ['contains', 'contains word']];
const LOGIC_OPS: [string, string][] = [['and', 'AND'], ['or', 'OR']];

export function ExprFieldControl({ def, expr, fieldKey, bindings, onChange }: {
  def: GameDef;
  expr: Expr;
  fieldKey: string;
  bindings: string[];
  onChange: (expr: Expr) => void;
}) {
  switch (expr.kind) {
    case 'getVar':
      return (
        <>
          <Label>var</Label>
          <select
            className="gr-select"
            value={expr.varId}
            aria-label="Variable"
            onChange={(e) => onChange({ kind: 'getVar', varId: e.target.value, target: null })}
          >
            {!def.variables.some((v) => v.id === expr.varId) && <option value={expr.varId}>⚠ missing</option>}
            {def.variables.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.scope})</option>)}
          </select>
        </>
      );
    case 'zoneCount':
    case 'topCard':
    case 'countCards':
      return <><Label>zone</Label><ZoneRefChip def={def} value={expr.zone} onChange={(zone) => onChange({ ...expr, zone })} bindings={bindings} /></>;
    case 'sumCards':
      if (fieldKey === 'fieldId') {
        return (
          <>
            <Label>sum</Label>
            <InlineFieldSelect def={def} value={expr.fieldId} onChange={(fieldId) => onChange({ ...expr, fieldId })} label="Field to sum" />
          </>
        );
      }
      return <><Label>in</Label><ZoneRefChip def={def} value={expr.zone} onChange={(zone) => onChange({ ...expr, zone })} bindings={bindings} /></>;
    case 'phasePos':
    case 'phaseIs': {
      const kind = expr.kind;
      return (
        <>
          <Label>phase</Label>
          <select
            className="gr-select"
            value={expr.phaseId}
            aria-label="Phase"
            onChange={(e) => onChange({ kind, phaseId: e.target.value })}
          >
            {!def.phases.some((p) => p.id === expr.phaseId) && <option value={expr.phaseId}>⚠ missing</option>}
            {def.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </>
      );
    }
    case 'bestCard':
      if (fieldKey === 'byField') {
        return (
          <>
            <select
              className="gr-select"
              value={expr.by}
              aria-label="Highest or lowest"
              onChange={(e) => onChange({ ...expr, by: e.target.value as 'highest' | 'lowest' })}
            >
              <option value="highest">highest</option>
              <option value="lowest">lowest</option>
            </select>
            <InlineFieldSelect def={def} value={expr.fieldId} onChange={(fieldId) => onChange({ ...expr, fieldId })} label="By field" />
          </>
        );
      }
      return <><Label>in</Label><ZoneRefChip def={def} value={expr.zone} onChange={(zone) => onChange({ ...expr, zone })} bindings={bindings} /></>;
    case 'cardField':
      return (
        <>
          <Label>field</Label>
          <InlineFieldSelect def={def} value={expr.fieldId} onChange={(fieldId) => onChange({ ...expr, fieldId })} label="Field" />
        </>
      );
    case 'math':
      return <OpSelect value={expr.op} ops={MATH_OPS} onChange={(op) => onChange({ ...expr, op: op as typeof expr.op })} />;
    case 'compare':
      return <OpSelect value={expr.op} ops={COMPARE_OPS} onChange={(op) => onChange({ ...expr, op: op as typeof expr.op })} />;
    case 'logic':
      return <OpSelect value={expr.op} ops={LOGIC_OPS} onChange={(op) => onChange({ ...expr, op: op as typeof expr.op })} />;
    case 'binding':
      return (
        <select
          className="gr-select"
          value={expr.name}
          aria-label="Context value"
          onChange={(e) => onChange({ kind: 'binding', name: e.target.value })}
        >
          {!bindings.includes(expr.name) && <option value={expr.name}>{expr.name}</option>}
          {bindings.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
      );
    default:
      return null;
  }
}

function OpSelect({ value, ops, onChange }: {
  value: string;
  ops: [string, string][];
  onChange: (op: string) => void;
}) {
  return (
    <select className="gr-select" value={value} aria-label="Operation" onChange={(e) => onChange(e.target.value)}>
      {ops.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
    </select>
  );
}
