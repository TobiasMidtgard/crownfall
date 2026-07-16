/**
 * ActionsTab — player-initiated moves: what they tap (a card in a zone, a
 * zone, or a plain button), when it's legal, and what happens.
 * Rows stay compact (name + target summary — the SystemsTab idiom); one
 * expands at a time for the full target/legality/stack/script editors.
 */
import { useState } from 'react';
import type { ActionDef, ActionTarget, GameDef } from '../../shared/types';
import { newAction } from '../../shared/defaults';
import { BlockScriptEditor } from '../blocks/BlockScriptEditor';
import { ConditionBuilder } from '../blocks/ConditionBuilder';
import { ConfirmModal } from '../common/Modal';
import { removeAt, updateAt } from '../lib';

function targetSummary(def: GameDef, target: ActionTarget): string {
  if (target.kind === 'none') return 'A button';
  const zoneName = def.zones.find((z) => z.id === target.zoneId)?.name ?? '⚠ missing zone';
  return target.kind === 'cardInZone' ? `Tap a card in ${zoneName}` : `Tap ${zoneName}`;
}

export function ActionsTab({ def, onChange, onOpenSystems }: {
  def: GameDef;
  onChange: (def: GameDef) => void;
  /** Opens the Systems panel (cross-panel hint link). */
  onOpenSystems?: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);

  const update = (i: number, action: ActionDef) => onChange({ ...def, actions: updateAt(def.actions, i, action) });

  const addAction = () => {
    const action = newAction();
    onChange({ ...def, actions: [...def.actions, action] });
    setOpenId(action.id);
  };

  const requestDelete = (i: number) => {
    const action = def.actions[i];
    // Freshly-added empty actions delete without ceremony; anything carrying
    // a script, a legality check, or a phase reference gets a confirm —
    // there is no undo for def edits.
    const trivial = action.script.length === 0
      && (action.announce?.length ?? 0) === 0
      && action.legality === null
      && !def.phases.some((p) => p.actionIds.includes(action.id));
    if (trivial) onChange({ ...def, actions: removeAt(def.actions, i) });
    else setDeleting(i);
  };

  const deletingAction = deleting !== null ? def.actions[deleting] : undefined;
  const deletingPhaseRefs = deletingAction
    ? def.phases.filter((p) => p.actionIds.includes(deletingAction.id)).length
    : 0;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Actions</h2>
        <div className="spacer" />
        <button type="button" className="btn" onClick={addAction}>
          + Add action
        </button>
      </div>
      <p className="faint">
        The moves a player can make. Enable them per phase in the{' '}
        {onOpenSystems
          ? <button type="button" className="ed-link" onClick={onOpenSystems}>Systems panel</button>
          : 'Systems panel'}
        . The engine offers an action only where its legality check passes — that also powers the AI.
      </p>

      {def.actions.length === 0 && <p className="muted">No actions yet — players will have nothing to do.</p>}

      {def.actions.map((action, i) => {
        const open = openId === action.id;
        const bindings = action.target.kind === 'cardInZone' ? ['$card'] : [];
        return (
          <div className={`ed-item${open ? ' ed-sys-open' : ''}`} key={action.id}>
            <div className="row" style={{ marginBottom: 8 }}>
              <input
                type="text"
                className="input ed-item-name"
                value={action.name}
                aria-label="Action name"
                onChange={(e) => update(i, { ...action, name: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-small btn-ghost ed-delete"
                aria-label="Delete action"
                onClick={() => requestDelete(i)}
              >
                ✕
              </button>
            </div>

            <button
              type="button"
              className="btn btn-small btn-ghost ed-sys-detail-btn"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : action.id)}
            >
              {targetSummary(def, action.target)} · {action.script.length} block{action.script.length === 1 ? '' : 's'}
              {action.stacked ? ' · via the stack' : ''}
              {action.speed === 'response' ? ' · response' : ''}
              {' '}— edit ›
            </button>

            {open && (
              <div className="ed-item-detail">
                <TargetEditor def={def} value={action.target} onChange={(target) => update(i, { ...action, target })} />

                <label className="field">
                  <span>When is it allowed?{action.target.kind === 'cardInZone' ? ' ($card = the tapped card)' : ''}</span>
                  <ConditionBuilder
                    def={def}
                    value={action.legality}
                    onChange={(legality) => update(i, { ...action, legality })}
                    bindings={bindings}
                    allowNull
                    nullLabel="Always allowed"
                  />
                </label>

                <label className="field">
                  <span>When is it offered?</span>
                  <select
                    className="select"
                    value={action.speed ?? 'normal'}
                    onChange={(e) => update(i, { ...action, speed: e.target.value === 'response' ? 'response' : undefined })}
                  >
                    <option value="normal">On the player's own turn — a normal move</option>
                    <option value="response">As a response — only while something is waiting on the stack</option>
                  </select>
                </label>

                <label className="ed-check">
                  <input
                    type="checkbox"
                    checked={!!action.stacked}
                    onChange={(e) => update(i, { ...action, stacked: e.target.checked || undefined })}
                  />
                  <span>Resolves via the stack — other players get a chance to respond before it happens</span>
                </label>

                {action.stacked && (
                  <div className="field">
                    <span className="ed-mini-label">Announce — runs right away</span>
                    <p className="faint" style={{ marginTop: 0 }}>
                      Pay costs and move the card here; the "What happens" script below waits on the stack
                      until every player passes.
                    </p>
                    <BlockScriptEditor
                      def={def}
                      value={action.announce ?? []}
                      onChange={(announce) => update(i, { ...action, announce })}
                      bindings={bindings}
                    />
                  </div>
                )}

                <div className="field" style={{ marginBottom: 0 }}>
                  <span className="ed-mini-label">What happens</span>
                  <BlockScriptEditor
                    def={def}
                    value={action.script}
                    onChange={(script) => update(i, { ...action, script })}
                    bindings={bindings}
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}

      {deletingAction && deleting !== null && (
        <ConfirmModal
          title={`Delete action "${deletingAction.name}"?`}
          message={(
            <>
              <p>
                Its legality check and script ({deletingAction.script.length} block{deletingAction.script.length === 1 ? '' : 's'})
                are deleted with it — there is no undo.
              </p>
              {deletingPhaseRefs > 0 && (
                <p>
                  {deletingPhaseRefs} phase{deletingPhaseRefs === 1 ? ' still offers' : 's still offer'} this action;
                  the issue checker will flag {deletingPhaseRefs === 1 ? 'it' : 'them'} so you can fix {deletingPhaseRefs === 1 ? 'it' : 'them'}.
                </p>
              )}
            </>
          )}
          onConfirm={() => { onChange({ ...def, actions: removeAt(def.actions, deleting) }); setDeleting(null); }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function TargetEditor({ def, value, onChange }: {
  def: GameDef;
  value: ActionTarget;
  onChange: (t: ActionTarget) => void;
}) {
  const zoneId = value.kind === 'none' ? '' : value.zoneId;
  const zone = def.zones.find((z) => z.id === zoneId);

  const setKind = (kind: ActionTarget['kind']) => {
    if (kind === value.kind) return;
    if (kind === 'none') onChange({ kind: 'none' });
    else onChange({ kind, zoneId: zoneId || (def.zones[0]?.id ?? ''), ownerOnly: value.kind !== 'none' ? value.ownerOnly : true });
  };

  return (
    <>
      <label className="field">
        <span>What the player taps</span>
        <select className="select" value={value.kind} onChange={(e) => setKind(e.target.value as ActionTarget['kind'])}>
          <option value="cardInZone">A card in a zone</option>
          <option value="zone">A zone (e.g. a draw pile)</option>
          <option value="none">Just a button</option>
        </select>
      </label>
      {value.kind !== 'none' && (
        <>
          <label className="field">
            <span>Zone</span>
            <select
              className="select"
              value={value.zoneId}
              onChange={(e) => onChange({ ...value, zoneId: e.target.value })}
            >
              {!zone && <option value={value.zoneId}>⚠ missing zone</option>}
              {def.zones.map((z) => (
                <option key={z.id} value={z.id}>{z.name}{z.owner === 'perPlayer' ? ' (per player)' : ''}</option>
              ))}
            </select>
          </label>
          {zone?.owner === 'perPlayer' && (
            <label className="ed-check">
              <input
                type="checkbox"
                checked={value.ownerOnly}
                onChange={(e) => onChange({ ...value, ownerOnly: e.target.checked })}
              />
              <span>Only their own copy of the zone (unchecked = any player's)</span>
            </label>
          )}
        </>
      )}
    </>
  );
}
