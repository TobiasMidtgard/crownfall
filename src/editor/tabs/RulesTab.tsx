/**
 * RulesTab — (1) triggers: "when X happens, if …, do …" and
 * (2) end conditions: "the game ends when …, the winner is …".
 * Two addable columns (the SystemsTab idiom); rows stay compact
 * (name + event/winner summary) and one expands at a time for editing.
 */
import { useState } from 'react';
import type { EndConditionDef, EventSpec, Expr, GameDef, TriggerDef, WinnerSpec } from '../../shared/types';
import { newTrigger, uid } from '../../shared/defaults';
import { BlockScriptEditor } from '../blocks/BlockScriptEditor';
import { ConditionBuilder } from '../blocks/ConditionBuilder';
import { ConfirmModal } from '../common/Modal';
import { WinnerSpecFields } from '../blocks/slots';
import { removeAt, updateAt } from '../lib';

const EVENT_KINDS: { kind: EventSpec['kind']; label: string }[] = [
  { kind: 'turnStart', label: 'A turn starts' },
  { kind: 'turnEnd', label: 'A turn ends' },
  { kind: 'phaseStart', label: 'A phase starts' },
  { kind: 'phaseEnd', label: 'A phase ends' },
  { kind: 'cardEnterZone', label: 'A card enters a zone' },
  { kind: 'cardLeaveZone', label: 'A card leaves a zone' },
  { kind: 'zoneEmptied', label: 'A zone becomes empty' },
  { kind: 'varChanged', label: 'A variable changes' },
  { kind: 'effectResolved', label: 'A stacked effect resolves' },
];

function makeEvent(kind: EventSpec['kind']): EventSpec {
  switch (kind) {
    case 'turnStart': return { kind: 'turnStart' };
    case 'turnEnd': return { kind: 'turnEnd' };
    case 'phaseStart': return { kind: 'phaseStart', phaseId: null };
    case 'phaseEnd': return { kind: 'phaseEnd', phaseId: null };
    case 'cardEnterZone': return { kind: 'cardEnterZone', zoneId: null, tag: null };
    case 'cardLeaveZone': return { kind: 'cardLeaveZone', zoneId: null, tag: null };
    case 'zoneEmptied': return { kind: 'zoneEmptied', zoneId: null };
    case 'varChanged': return { kind: 'varChanged', varId: null };
    case 'effectResolved': return { kind: 'effectResolved' };
  }
}

/** Bindings available to a trigger's condition/script (docs/engine-semantics.md). */
function eventBindings(def: GameDef, ev: EventSpec): string[] {
  switch (ev.kind) {
    case 'cardEnterZone':
    case 'cardLeaveZone':
      return ['$card', '$fromZone', '$toZone', '$owner', '$tag'];
    case 'zoneEmptied':
      return ['$zone', '$owner'];
    case 'effectResolved':
      return ['$card', '$player'];
    case 'varChanged': {
      const scope = ev.varId ? def.variables.find((v) => v.id === ev.varId)?.scope : undefined;
      if (scope === 'perPlayer') return ['$player'];
      if (scope === 'perCard') return ['$card'];
      if (scope === 'global') return [];
      return ['$player', '$card'];
    }
    case 'turnStart':
    case 'turnEnd':
    case 'phaseStart':
    case 'phaseEnd':
      return ['$player'];
  }
}

/** One-line "when" summary for a collapsed trigger row. */
function eventSummary(def: GameDef, ev: EventSpec): string {
  const base = EVENT_KINDS.find((k) => k.kind === ev.kind)?.label ?? ev.kind;
  switch (ev.kind) {
    case 'phaseStart':
    case 'phaseEnd': {
      const name = ev.phaseId ? def.phases.find((p) => p.id === ev.phaseId)?.name : null;
      return name ? `${base}: ${name}` : base;
    }
    case 'cardEnterZone':
    case 'cardLeaveZone':
    case 'zoneEmptied': {
      const name = ev.zoneId ? def.zones.find((z) => z.id === ev.zoneId)?.name : null;
      return name ? `${base}: ${name}` : base;
    }
    case 'varChanged': {
      const name = ev.varId ? def.variables.find((v) => v.id === ev.varId)?.name : null;
      return name ? `${base}: ${name}` : base;
    }
    default:
      return base;
  }
}

/** One-line "winner" summary for a collapsed end-condition row. */
function winnerSummary(def: GameDef, w: WinnerSpec): string {
  switch (w.kind) {
    case 'draw': return 'ends in a draw';
    case 'player': return 'a chosen player wins';
    case 'highestVar': return `highest ${def.variables.find((v) => v.id === w.varId)?.name ?? '?'} wins`;
    case 'lowestVar': return `lowest ${def.variables.find((v) => v.id === w.varId)?.name ?? '?'} wins`;
  }
}

function newEndCondition(def: GameDef): EndConditionDef {
  const firstZone = def.zones[0];
  const condition: Expr = firstZone
    ? { kind: 'compare', op: '==', left: { kind: 'zoneCount', zone: { zoneId: firstZone.id, owner: null } }, right: { kind: 'num', value: 0 } }
    : { kind: 'bool', value: false };
  return { id: uid('end'), name: 'New end condition', condition, winner: { kind: 'draw' } };
}

type Deleting = { kind: 'trigger' | 'end'; index: number } | null;

export function RulesTab({ def, onChange }: { def: GameDef; onChange: (def: GameDef) => void }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Deleting>(null);

  const updateTrigger = (i: number, t: TriggerDef) => onChange({ ...def, triggers: updateAt(def.triggers, i, t) });
  const updateEnd = (i: number, ec: EndConditionDef) => onChange({ ...def, endConditions: updateAt(def.endConditions, i, ec) });

  const addTrigger = () => {
    const trigger = newTrigger();
    onChange({ ...def, triggers: [...def.triggers, trigger] });
    setOpenId(trigger.id);
  };
  const addEnd = () => {
    const ec = newEndCondition(def);
    onChange({ ...def, endConditions: [...def.endConditions, ec] });
    setOpenId(ec.id);
  };

  const requestDeleteTrigger = (i: number) => {
    const trigger = def.triggers[i];
    // Empty just-added triggers go without ceremony; real ones confirm —
    // there is no undo for def edits.
    if (trigger.script.length === 0 && trigger.condition === null) {
      onChange({ ...def, triggers: removeAt(def.triggers, i) });
    } else {
      setDeleting({ kind: 'trigger', index: i });
    }
  };

  const deletingTrigger = deleting?.kind === 'trigger' ? def.triggers[deleting.index] : undefined;
  const deletingEnd = deleting?.kind === 'end' ? def.endConditions[deleting.index] : undefined;

  return (
    <div>
      <div className="ed-systems-grid">
        {/* ---- Triggers ---------------------------------------------------- */}
        <div className="panel ed-sys-col">
          <div className="row ed-sys-head">
            <h3 style={{ margin: 0 }}>Triggers</h3>
            <div className="spacer" />
            <button type="button" className="btn btn-small" onClick={addTrigger}>
              + Add
            </button>
          </div>
          <p className="faint">Rules that fire automatically: when something happens, optionally check a condition, then run a script.</p>

          {def.triggers.length === 0 && <p className="muted">No triggers yet.</p>}

          {def.triggers.map((trigger, i) => {
            const open = openId === trigger.id;
            const bindings = eventBindings(def, trigger.event);
            return (
              <div className={`ed-item${open ? ' ed-sys-open' : ''}`} key={trigger.id}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <input
                    type="text"
                    className="input ed-item-name"
                    value={trigger.name}
                    aria-label="Trigger name"
                    onChange={(e) => updateTrigger(i, { ...trigger, name: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-small btn-ghost ed-delete"
                    aria-label="Delete trigger"
                    onClick={() => requestDeleteTrigger(i)}
                  >
                    ✕
                  </button>
                </div>

                <button
                  type="button"
                  className="btn btn-small btn-ghost ed-sys-detail-btn"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : trigger.id)}
                >
                  {eventSummary(def, trigger.event)} · {trigger.script.length} block{trigger.script.length === 1 ? '' : 's'}
                  {trigger.stacked ? ' · via the stack' : ''}
                  {' '}— edit ›
                </button>

                {open && (
                  <div className="ed-item-detail">
                    <div className="ed-grid">
                      <label className="field">
                        <span>When</span>
                        <select
                          className="select"
                          value={trigger.event.kind}
                          onChange={(e) => updateTrigger(i, { ...trigger, event: makeEvent(e.target.value as EventSpec['kind']) })}
                        >
                          {EVENT_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
                        </select>
                      </label>
                      <EventSubSelect def={def} event={trigger.event} onChange={(event) => updateTrigger(i, { ...trigger, event })} />
                    </div>
                    {bindings.length > 0 && (
                      <p className="faint">Available here: {bindings.join(', ')}</p>
                    )}

                    <label className="field">
                      <span>Only if</span>
                      <ConditionBuilder
                        def={def}
                        value={trigger.condition}
                        onChange={(condition) => updateTrigger(i, { ...trigger, condition })}
                        bindings={bindings}
                        allowNull
                        nullLabel="Always"
                      />
                    </label>

                    <label className="ed-check">
                      <input
                        type="checkbox"
                        checked={!!trigger.stacked}
                        onChange={(e) => updateTrigger(i, { ...trigger, stacked: e.target.checked || undefined })}
                      />
                      <span>Resolves via the stack — players may respond before the script runs</span>
                    </label>

                    <div className="field" style={{ marginBottom: 0 }}>
                      <span className="ed-mini-label">Do</span>
                      <BlockScriptEditor
                        def={def}
                        value={trigger.script}
                        onChange={(script) => updateTrigger(i, { ...trigger, script })}
                        bindings={bindings}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ---- End conditions ---------------------------------------------- */}
        <div className="panel ed-sys-col">
          <div className="row ed-sys-head">
            <h3 style={{ margin: 0 }}>End conditions</h3>
            <div className="spacer" />
            <button type="button" className="btn btn-small" onClick={addEnd}>
              + Add
            </button>
          </div>
          <p className="faint">Checked after every action and trigger — the first match ends the game.</p>

          {def.endConditions.length === 0 && (
            <p className="muted">No end conditions. The game can also be ended by an "End game" block in any script.</p>
          )}

          {def.endConditions.map((ec, i) => {
            const open = openId === ec.id;
            return (
              <div className={`ed-item${open ? ' ed-sys-open' : ''}`} key={ec.id}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <input
                    type="text"
                    className="input ed-item-name"
                    value={ec.name}
                    aria-label="End condition name"
                    onChange={(e) => updateEnd(i, { ...ec, name: e.target.value })}
                  />
                  <button
                    type="button"
                    className="btn btn-small btn-ghost ed-delete"
                    aria-label="Delete end condition"
                    onClick={() => setDeleting({ kind: 'end', index: i })}
                  >
                    ✕
                  </button>
                </div>

                <button
                  type="button"
                  className="btn btn-small btn-ghost ed-sys-detail-btn"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : ec.id)}
                >
                  {winnerSummary(def, ec.winner)} — edit ›
                </button>

                {open && (
                  <div className="ed-item-detail">
                    <label className="field">
                      <span>The game ends when</span>
                      <ConditionBuilder
                        def={def}
                        value={ec.condition}
                        onChange={(condition) => condition && updateEnd(i, { ...ec, condition })}
                        bindings={[]}
                        requireRowsMessage="Pick a condition — an empty one would end the game immediately."
                      />
                    </label>
                    <WinnerSpecFields
                      def={def}
                      value={ec.winner}
                      onChange={(winner) => updateEnd(i, { ...ec, winner })}
                      bindings={[]}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {deletingTrigger && deleting && (
        <ConfirmModal
          title={`Delete trigger "${deletingTrigger.name}"?`}
          message={(
            <p>
              Its condition and script ({deletingTrigger.script.length} block{deletingTrigger.script.length === 1 ? '' : 's'})
              are deleted with it — there is no undo.
            </p>
          )}
          onConfirm={() => { onChange({ ...def, triggers: removeAt(def.triggers, deleting.index) }); setDeleting(null); }}
          onCancel={() => setDeleting(null)}
        />
      )}

      {deletingEnd && deleting && (
        <ConfirmModal
          title={`Delete end condition "${deletingEnd.name}"?`}
          message={<p>Its game-over check and winner rule are deleted with it — there is no undo.</p>}
          onConfirm={() => { onChange({ ...def, endConditions: removeAt(def.endConditions, deleting.index) }); setDeleting(null); }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function EventSubSelect({ def, event, onChange }: {
  def: GameDef;
  event: EventSpec;
  onChange: (e: EventSpec) => void;
}) {
  switch (event.kind) {
    case 'phaseStart':
    case 'phaseEnd':
      return (
        <label className="field">
          <span>Which phase</span>
          <select
            className="select"
            value={event.phaseId ?? ''}
            onChange={(e) => onChange({ ...event, phaseId: e.target.value || null })}
          >
            <option value="">Any phase</option>
            {def.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      );
    case 'cardEnterZone':
    case 'cardLeaveZone':
      return (
        <>
          <label className="field">
            <span>Which zone</span>
            <select
              className="select"
              value={event.zoneId ?? ''}
              onChange={(e) => onChange({ ...event, zoneId: e.target.value || null })}
            >
              <option value="">Any zone</option>
              {def.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>With move tag</span>
            <input
              type="text"
              className="input"
              value={event.tag ?? ''}
              placeholder="any move (e.g. gain, play, draw)"
              title="Only fire for moves carrying exactly this cause tag. Canonical tags: gain, buy, trash, discard, play, draw, cleanup. Empty = any move."
              onChange={(e) => onChange({ ...event, tag: e.target.value === '' ? null : e.target.value })}
            />
          </label>
        </>
      );
    case 'zoneEmptied':
      return (
        <label className="field">
          <span>Which zone</span>
          <select
            className="select"
            value={event.zoneId ?? ''}
            onChange={(e) => onChange({ ...event, zoneId: e.target.value || null })}
          >
            <option value="">Any zone</option>
            {def.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </label>
      );
    case 'varChanged':
      return (
        <label className="field">
          <span>Which variable</span>
          <select
            className="select"
            value={event.varId ?? ''}
            onChange={(e) => onChange({ ...event, varId: e.target.value || null })}
          >
            <option value="">Any variable</option>
            {def.variables.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      );
    case 'turnStart':
    case 'turnEnd':
    case 'effectResolved':
      return null;
  }
}
