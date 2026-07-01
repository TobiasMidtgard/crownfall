/**
 * VariablesTab — typed variables (score, trump suit, mana…) with scope and
 * initial value. The initial-value input adapts to the variable's type.
 */
import type { GameDef, VariableDef } from '../../shared/types';
import { newVariable } from '../../shared/defaults';
import { removeAt, updateAt } from '../lib';

export function VariablesTab({ def, onChange }: { def: GameDef; onChange: (def: GameDef) => void }) {
  const update = (i: number, v: VariableDef) => onChange({ ...def, variables: updateAt(def.variables, i, v) });

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Variables</h2>
        <div className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={() => onChange({ ...def, variables: [...def.variables, newVariable()] })}
        >
          + Add variable
        </button>
      </div>
      <p className="faint">Score, lives, trump suit, mana — anything the game needs to remember.</p>

      {def.variables.length === 0 && <p className="muted">No variables yet.</p>}

      {def.variables.map((v, i) => (
        <div className="ed-item" key={v.id}>
          <div className="row" style={{ marginBottom: 10 }}>
            <input
              type="text"
              className="input ed-item-name"
              value={v.name}
              aria-label="Variable name"
              onChange={(e) => update(i, { ...v, name: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-small btn-ghost ed-delete"
              onClick={() => onChange({ ...def, variables: removeAt(def.variables, i) })}
              aria-label="Delete variable"
            >
              ✕
            </button>
          </div>
          <div className="ed-grid">
            <label className="field">
              <span>Scope</span>
              <select
                className="select"
                value={v.scope}
                onChange={(e) => update(i, { ...v, scope: e.target.value as VariableDef['scope'] })}
              >
                <option value="global">Global — one value for the game</option>
                <option value="perPlayer">Per player — each player has one</option>
                <option value="perCard">Per card — each card has one</option>
              </select>
            </label>
            <label className="field">
              <span>Type</span>
              <select
                className="select"
                value={v.type}
                onChange={(e) => {
                  const type = e.target.value as VariableDef['type'];
                  const initial = type === 'number' ? 0 : type === 'boolean' ? false : '';
                  update(i, { ...v, type, initial });
                }}
              >
                <option value="number">Number</option>
                <option value="string">Text</option>
                <option value="boolean">Yes / no</option>
              </select>
            </label>
            <label className="field">
              <span>Initial value</span>
              {v.type === 'number' && (
                <input
                  type="number"
                  className="input"
                  value={Number(v.initial)}
                  onChange={(e) => update(i, { ...v, initial: Number(e.target.value) || 0 })}
                />
              )}
              {v.type === 'string' && (
                <input
                  type="text"
                  className="input"
                  value={String(v.initial)}
                  onChange={(e) => update(i, { ...v, initial: e.target.value })}
                />
              )}
              {v.type === 'boolean' && (
                <select
                  className="select"
                  value={v.initial ? 'yes' : 'no'}
                  onChange={(e) => update(i, { ...v, initial: e.target.value === 'yes' })}
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              )}
            </label>
            <label className="field">
              <span>At the table</span>
              <select
                className="select"
                value={v.hidden ? 'hidden' : 'shown'}
                onChange={(e) => update(i, { ...v, hidden: e.target.value === 'hidden' || undefined })}
              >
                <option value="shown">Shown in the status bar</option>
                <option value="hidden">Hidden — internal bookkeeping</option>
              </select>
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}
