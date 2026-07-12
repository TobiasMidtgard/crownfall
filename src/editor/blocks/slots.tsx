/**
 * Slot editors — the tappable chips inside block sentences, each opening a
 * small modal: zone refs, card selectors, choice specs, announce parts,
 * winner specs, variable targets, and the cycling facing/position chips.
 */
import { useState, type ReactNode } from 'react';
import type {
  CardSelector, ChoiceSpec, Expr, GameDef, WinnerSpec, ZoneRef,
} from '../../shared/types';
import { uid } from '../../shared/defaults';
import { Modal } from '../common/Modal';
import { insertAt, removeAt, updateAt } from '../lib';
import { ConditionBuilder } from './ConditionBuilder';
import {
  ExpressionEditor, NumberExprField, ZoneRefFields,
} from './ExpressionEditor';
import {
  announceToText, choiceToText, exprToText, faceUpText, selectorToText, varName,
  winnerToText, zoneName, zoneRefToText,
} from './exprToText';
import { defaultCardFilter } from './registry';

/** Generic "chip opens a modal" shell shared by the slot editors below. */
function ChipModal({ chipText, title, children, missing }: {
  chipText: string;
  title: string;
  children: (close: () => void) => ReactNode;
  missing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={missing ? 'blk-chip blk-chip-missing' : 'blk-chip'}
        onClick={() => setOpen(true)}
      >
        {chipText}
      </button>
      {open && (
        <Modal
          title={title}
          onClose={() => setOpen(false)}
          footer={<button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>Done</button>}
        >
          {children(() => setOpen(false))}
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export function ZoneRefChip({ def, value, onChange, bindings, title = 'Which zone?' }: {
  def: GameDef;
  value: ZoneRef;
  onChange: (ref: ZoneRef) => void;
  bindings: string[];
  title?: string;
}) {
  const missing = !def.zones.some((z) => z.id === value.zoneId);
  return (
    <ChipModal chipText={zoneRefToText(def, value)} title={title} missing={missing}>
      {() => <ZoneRefFields def={def} value={value} onChange={onChange} bindings={bindings} />}
    </ChipModal>
  );
}

/** Plain zone-id select chip (deal's "to each player's …" slot). */
export function ZoneIdChip({ def, value, onChange, perPlayerOnly = false, title = 'Which zone?' }: {
  def: GameDef;
  value: string;
  onChange: (zoneId: string) => void;
  perPlayerOnly?: boolean;
  title?: string;
}) {
  const zones = perPlayerOnly ? def.zones.filter((z) => z.owner === 'perPlayer') : def.zones;
  const missing = !def.zones.some((z) => z.id === value);
  return (
    <ChipModal chipText={zoneName(def, value)} title={title} missing={missing}>
      {() => (
        <label className="field">
          <span>Zone</span>
          {zones.length === 0 ? (
            <span className="faint">
              {perPlayerOnly ? 'No per-player zones yet — create one on the Systems page.' : 'No zones yet.'}
            </span>
          ) : (
            <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
              {missing && <option value={value}>⚠ missing zone</option>}
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          )}
        </label>
      )}
    </ChipModal>
  );
}

// ---------------------------------------------------------------------------
// Card selector
// ---------------------------------------------------------------------------

const SELECTOR_KINDS: { kind: CardSelector['kind']; label: string; hint: string }[] = [
  { kind: 'top', label: 'Top N', hint: 'The top card(s) of the zone' },
  { kind: 'bottom', label: 'Bottom N', hint: 'The bottom card(s)' },
  { kind: 'random', label: 'Random N', hint: 'Randomly picked card(s)' },
  { kind: 'all', label: 'All', hint: 'Every card in the zone' },
  { kind: 'filter', label: 'Matching…', hint: 'All cards that pass a condition' },
  { kind: 'specific', label: 'One specific card', hint: 'A card from an expression, like $choice' },
];

function makeSelector(def: GameDef, kind: CardSelector['kind'], bindings: string[]): CardSelector {
  const one: Expr = { kind: 'num', value: 1 };
  switch (kind) {
    case 'top': return { kind: 'top', count: one };
    case 'bottom': return { kind: 'bottom', count: one };
    case 'random': return { kind: 'random', count: one };
    case 'all': return { kind: 'all' };
    case 'filter': return { kind: 'filter', filter: defaultCardFilter(def) };
    case 'specific':
      return {
        kind: 'specific',
        card: bindings.includes('$card')
          ? { kind: 'binding', name: '$card' }
          : { kind: 'binding', name: '$choice' },
      };
  }
}

export function CardSelectorChip({ def, value, onChange, bindings, title = 'Which cards?' }: {
  def: GameDef;
  value: CardSelector;
  onChange: (sel: CardSelector) => void;
  bindings: string[];
  title?: string;
}) {
  return (
    <ChipModal chipText={selectorToText(def, value)} title={title}>
      {() => (
        <>
          <label className="field">
            <span>Pick</span>
            <select
              className="select"
              value={value.kind}
              onChange={(e) => onChange(makeSelector(def, e.target.value as CardSelector['kind'], bindings))}
            >
              {SELECTOR_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label} — {k.hint}</option>)}
            </select>
          </label>
          {(value.kind === 'top' || value.kind === 'bottom' || value.kind === 'random') && (
            <label className="field">
              <span>How many</span>
              <NumberExprField
                def={def}
                value={value.count}
                onChange={(count) => onChange({ ...value, count })}
                bindings={bindings}
              />
            </label>
          )}
          {value.kind === 'filter' && (
            <label className="field">
              <span>Cards where ($card = each card)</span>
              <ConditionBuilder
                def={def}
                value={value.filter}
                onChange={(filter) => filter && onChange({ kind: 'filter', filter })}
                bindings={[...bindings, '$card']}
              />
            </label>
          )}
          {value.kind === 'specific' && (
            <label className="field">
              <span>The card</span>
              <ExpressionEditor
                def={def}
                value={value.card}
                onChange={(card) => card && onChange({ kind: 'specific', card })}
                bindings={bindings}
              />
            </label>
          )}
        </>
      )}
    </ChipModal>
  );
}

// ---------------------------------------------------------------------------
// Cycling chips (facing, position)
// ---------------------------------------------------------------------------

/** Tri-state facing chip for moveCards: keep facing → face up → face down. */
export function FaceUpCycleChip({ value, onChange }: {
  value: boolean | null;
  onChange: (v: boolean | null) => void;
}) {
  const next = value === null ? true : value ? false : null;
  return (
    <button
      type="button"
      className="blk-chip"
      title="Tap to change facing"
      onClick={() => onChange(next)}
    >
      {faceUpText(value)}
    </button>
  );
}

/** Boolean facing chip for flipCards. */
export function FaceUpToggleChip({ value, onChange }: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button type="button" className="blk-chip" title="Tap to flip" onClick={() => onChange(!value)}>
      {value ? 'face up' : 'face down'}
    </button>
  );
}

/** Destination position chip for moveCards: on top ↔ on bottom. */
export function PositionChip({ value, onChange }: {
  value: 'top' | 'bottom';
  onChange: (v: 'top' | 'bottom') => void;
}) {
  return (
    <button
      type="button"
      className="blk-chip"
      title="Tap to change position"
      onClick={() => onChange(value === 'top' ? 'bottom' : 'top')}
    >
      {value === 'top' ? 'on top' : 'on bottom'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Variable + target (setVar / changeVar)
// ---------------------------------------------------------------------------

export function VarTargetChip({ def, varId, target, onChange, bindings }: {
  def: GameDef;
  varId: string;
  target: Expr | null;
  onChange: (varId: string, target: Expr | null) => void;
  bindings: string[];
}) {
  const variable = def.variables.find((v) => v.id === varId);
  const chipText = (() => {
    const name = varName(def, varId);
    if (!variable || variable.scope === 'global' || target === null) return name;
    return `${name} of ${exprToText(def, target)}`;
  })();

  return (
    <ChipModal chipText={chipText} title="Which variable?" missing={!variable}>
      {() => (
        <>
          <label className="field">
            <span>Variable</span>
            {def.variables.length === 0 ? (
              <span className="faint">No variables yet — add some on the Systems page.</span>
            ) : (
              <select
                className="select"
                value={varId}
                onChange={(e) => onChange(e.target.value, null)}
              >
                {!variable && <option value={varId}>⚠ missing variable</option>}
                {def.variables.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.scope})</option>)}
              </select>
            )}
          </label>
          {variable?.scope === 'perPlayer' && (
            <PlayerOrCardTarget def={def} mode="player" target={target} onChange={(t) => onChange(varId, t)} bindings={bindings} />
          )}
          {variable?.scope === 'perCard' && (
            <PlayerOrCardTarget def={def} mode="card" target={target} onChange={(t) => onChange(varId, t)} bindings={bindings} />
          )}
        </>
      )}
    </ChipModal>
  );
}

function PlayerOrCardTarget({ def, mode, target, onChange, bindings }: {
  def: GameDef;
  mode: 'player' | 'card';
  target: Expr | null;
  onChange: (t: Expr | null) => void;
  bindings: string[];
}) {
  return (
    <label className="field">
      <span>{mode === 'player' ? 'Whose value' : "Which card's value"}</span>
      <div className="row wrap">
        <ExpressionEditor
          def={def}
          value={target}
          onChange={onChange}
          bindings={bindings}
          allowNull
          nullLabel={mode === 'player' ? 'contextual player' : 'contextual card ($card/$self)'}
        />
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Choice spec (the "choose" block)
// ---------------------------------------------------------------------------

const CHOICE_KINDS: { kind: ChoiceSpec['kind']; label: string }[] = [
  { kind: 'card', label: 'A card from a zone' },
  { kind: 'option', label: 'One of several options' },
  { kind: 'player', label: 'A player' },
  { kind: 'yesNo', label: 'Yes or no' },
];

function makeChoice(def: GameDef, kind: ChoiceSpec['kind'], prev: ChoiceSpec): ChoiceSpec {
  const prompt = prev.prompt || 'Choose';
  switch (kind) {
    case 'card':
      return { kind: 'card', from: { zoneId: def.zones[0]?.id ?? '', owner: null }, filter: null, prompt, optional: false };
    case 'option':
      return { kind: 'option', prompt, options: [{ id: uid('opt'), label: 'Option A' }, { id: uid('opt'), label: 'Option B' }] };
    case 'player':
      return { kind: 'player', prompt, includeSelf: false };
    case 'yesNo':
      return { kind: 'yesNo', prompt };
  }
}

export function ChoiceSpecChip({ def, value, onChange, bindings }: {
  def: GameDef;
  value: ChoiceSpec;
  onChange: (c: ChoiceSpec) => void;
  bindings: string[];
}) {
  return (
    <ChipModal chipText={choiceToText(def, value)} title="What do they choose?">
      {() => (
        <>
          <label className="field">
            <span>Choice type</span>
            <select
              className="select"
              value={value.kind}
              onChange={(e) => onChange(makeChoice(def, e.target.value as ChoiceSpec['kind'], value))}
            >
              {CHOICE_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Prompt shown to the player</span>
            <input
              type="text"
              className="input"
              value={value.prompt}
              onChange={(e) => onChange({ ...value, prompt: e.target.value })}
            />
          </label>
          {value.kind === 'card' && (
            <>
              <ZoneRefFields
                def={def}
                value={value.from}
                onChange={(from) => onChange({ ...value, from })}
                bindings={bindings}
                label="From zone"
              />
              <label className="field">
                <span>Only cards where ($card = each card)</span>
                <ConditionBuilder
                  def={def}
                  value={value.filter}
                  onChange={(filter) => onChange({ ...value, filter })}
                  bindings={[...bindings, '$card']}
                  allowNull
                  nullLabel="any card"
                />
              </label>
              <label className="ed-check">
                <input
                  type="checkbox"
                  checked={value.optional}
                  onChange={(e) => onChange({ ...value, optional: e.target.checked })}
                />
                <span>Optional — the player may decline ($choice becomes empty)</span>
              </label>
            </>
          )}
          {value.kind === 'option' && (
            <div className="ed-subfield">
              <span className="ed-mini-label">Options</span>
              {value.options.map((opt, i) => (
                <div className="ed-subrow" key={opt.id}>
                  <input
                    type="text"
                    className="input"
                    value={opt.label}
                    onChange={(e) => onChange({ ...value, options: updateAt(value.options, i, { ...opt, label: e.target.value }) })}
                  />
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    aria-label="Remove option"
                    onClick={() => onChange({ ...value, options: removeAt(value.options, i) })}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn"
                onClick={() => onChange({ ...value, options: [...value.options, { id: uid('opt'), label: `Option ${String.fromCharCode(65 + value.options.length)}` }] })}
              >
                + Add option
              </button>
            </div>
          )}
          {value.kind === 'player' && (
            <label className="ed-check">
              <input
                type="checkbox"
                checked={value.includeSelf}
                onChange={(e) => onChange({ ...value, includeSelf: e.target.checked })}
              />
              <span>The chooser may pick themselves</span>
            </label>
          )}
        </>
      )}
    </ChipModal>
  );
}

// ---------------------------------------------------------------------------
// Announce parts
// ---------------------------------------------------------------------------

export function AnnouncePartsChip({ def, value, onChange, bindings }: {
  def: GameDef;
  value: (string | Expr)[];
  onChange: (parts: (string | Expr)[]) => void;
  bindings: string[];
}) {
  return (
    <ChipModal chipText={announceToText(def, value)} title="Build the message">
      {() => (
        <>
          <p className="faint">Text pieces and values are joined into one log line. Player and card values show their names.</p>
          {value.map((part, i) => (
            <div className="ed-subrow" key={i}>
              {typeof part === 'string' ? (
                <input
                  type="text"
                  className="input"
                  value={part}
                  placeholder="text…"
                  onChange={(e) => onChange(updateAt<string | Expr>(value, i, e.target.value))}
                />
              ) : (
                <ExpressionEditor
                  def={def}
                  value={part}
                  onChange={(e) => e && onChange(updateAt<string | Expr>(value, i, e))}
                  bindings={bindings}
                />
              )}
              <button
                type="button"
                className="btn btn-small btn-ghost"
                aria-label="Move part up"
                disabled={i === 0}
                onClick={() => onChange(insertAt(removeAt(value, i), i - 1, part))}
              >
                ↑
              </button>
              <button
                type="button"
                className="btn btn-small btn-ghost"
                aria-label="Remove part"
                onClick={() => onChange(removeAt(value, i))}
              >
                ✕
              </button>
            </div>
          ))}
          <div className="row wrap">
            <button type="button" className="btn" onClick={() => onChange([...value, ''])}>
              + Add text
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => onChange([...value, { kind: 'currentPlayer' } satisfies Expr])}
            >
              + Add value
            </button>
          </div>
        </>
      )}
    </ChipModal>
  );
}

// ---------------------------------------------------------------------------
// Winner spec (endGame block + end conditions in the Rules tab)
// ---------------------------------------------------------------------------

export function WinnerSpecFields({ def, value, onChange, bindings }: {
  def: GameDef;
  value: WinnerSpec;
  onChange: (w: WinnerSpec) => void;
  bindings: string[];
}) {
  const firstVarId = def.variables[0]?.id ?? '';
  const setKind = (kind: WinnerSpec['kind']) => {
    switch (kind) {
      case 'player': onChange({ kind: 'player', player: { kind: 'currentPlayer' } }); break;
      case 'highestVar': onChange({ kind: 'highestVar', varId: value.kind === 'lowestVar' ? value.varId : firstVarId }); break;
      case 'lowestVar': onChange({ kind: 'lowestVar', varId: value.kind === 'highestVar' ? value.varId : firstVarId }); break;
      case 'draw': onChange({ kind: 'draw' }); break;
    }
  };
  return (
    <>
      <label className="field">
        <span>Winner</span>
        <select className="select" value={value.kind} onChange={(e) => setKind(e.target.value as WinnerSpec['kind'])}>
          <option value="player">A specific player…</option>
          <option value="highestVar">Player with the highest variable…</option>
          <option value="lowestVar">Player with the lowest variable…</option>
          <option value="draw">Nobody — it's a draw</option>
        </select>
      </label>
      {value.kind === 'player' && (
        <label className="field">
          <span>The player</span>
          <ExpressionEditor
            def={def}
            value={value.player}
            onChange={(player) => player && onChange({ kind: 'player', player })}
            bindings={bindings}
          />
        </label>
      )}
      {(value.kind === 'highestVar' || value.kind === 'lowestVar') && (
        <label className="field">
          <span>Variable (per player, number)</span>
          {def.variables.length === 0 ? (
            <span className="faint">No variables yet — add one on the Systems page.</span>
          ) : (
            <select
              className="select"
              value={value.varId}
              onChange={(e) => onChange({ ...value, varId: e.target.value })}
            >
              {!def.variables.some((v) => v.id === value.varId) && <option value={value.varId}>⚠ missing variable</option>}
              {def.variables.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.scope} {v.type})</option>)}
            </select>
          )}
        </label>
      )}
    </>
  );
}

export function WinnerSpecChip({ def, value, onChange, bindings }: {
  def: GameDef;
  value: WinnerSpec;
  onChange: (w: WinnerSpec) => void;
  bindings: string[];
}) {
  return (
    <ChipModal chipText={winnerToText(def, value)} title="Who wins?">
      {() => <WinnerSpecFields def={def} value={value} onChange={onChange} bindings={bindings} />}
    </ChipModal>
  );
}
