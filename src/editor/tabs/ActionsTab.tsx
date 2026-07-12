/**
 * ActionsTab — player-initiated moves: what they tap (a card in a zone, a
 * zone, or a plain button), when it's legal, and what happens.
 */
import type { ActionDef, ActionTarget, GameDef } from '../../shared/types';
import { newAction } from '../../shared/defaults';
import { BlockScriptEditor } from '../blocks/BlockScriptEditor';
import { ConditionBuilder } from '../blocks/ConditionBuilder';
import { removeAt, updateAt } from '../lib';

export function ActionsTab({ def, onChange }: { def: GameDef; onChange: (def: GameDef) => void }) {
  const update = (i: number, action: ActionDef) => onChange({ ...def, actions: updateAt(def.actions, i, action) });

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Actions</h2>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => onChange({ ...def, actions: [...def.actions, newAction()] })}>
          + Add action
        </button>
      </div>
      <p className="faint">
        The moves a player can make. Enable them per phase on the Systems page. The engine offers an action
        only where its legality check passes — that also powers the AI.
      </p>

      {def.actions.length === 0 && <p className="muted">No actions yet — players will have nothing to do.</p>}

      {def.actions.map((action, i) => {
        const bindings = action.target.kind === 'cardInZone' ? ['$card'] : [];
        return (
          <div className="panel ed-section" key={action.id}>
            <div className="row" style={{ marginBottom: 10 }}>
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
                onClick={() => onChange({ ...def, actions: removeAt(def.actions, i) })}
              >
                ✕
              </button>
            </div>

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
        );
      })}
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
