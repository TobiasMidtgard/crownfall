/**
 * FlowTab — the setup script plus the ordered list of turn phases:
 * per phase a name, mode, "when phase starts" script, and the actions a
 * player may take during it.
 */
import type { GameDef, PhaseDef } from '../../shared/types';
import { newPhase } from '../../shared/defaults';
import { BlockScriptEditor } from '../blocks/BlockScriptEditor';
import { moveItem, removeAt, updateAt } from '../lib';

const MODE_HINTS: Record<PhaseDef['mode'], string> = {
  auto: 'Runs its script and advances by itself — no player input.',
  oneAction: 'The player makes exactly one move, then the phase ends.',
  manual: 'The player keeps acting until something ends the phase (an "End phase" block, often on a "Done" action).',
};

export function FlowTab({ def, onChange }: { def: GameDef; onChange: (def: GameDef) => void }) {
  const update = (i: number, phase: PhaseDef) => onChange({ ...def, phases: updateAt(def.phases, i, phase) });

  return (
    <div>
      <div className="panel ed-section">
        <h2>Setup script</h2>
        <p className="faint">Runs once when a game starts, after decks are spawned and shuffled.</p>
        <BlockScriptEditor def={def} value={def.setup} onChange={(setup) => onChange({ ...def, setup })} bindings={[]} />
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Turn phases</h2>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => onChange({ ...def, phases: [...def.phases, newPhase()] })}>
          + Add phase
        </button>
      </div>
      <p className="faint">Each turn runs these phases in order, then play passes to the next player.</p>

      {def.phases.length === 0 && <p className="muted">No phases — a game needs at least one.</p>}

      {def.phases.map((phase, i) => (
        <div className="panel ed-section" key={phase.id}>
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="chip accent">{i + 1}</span>
            <input
              type="text"
              className="input ed-item-name"
              value={phase.name}
              aria-label="Phase name"
              onChange={(e) => update(i, { ...phase, name: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-small btn-ghost ed-tool"
              disabled={i === 0}
              aria-label="Move phase up"
              onClick={() => onChange({ ...def, phases: moveItem(def.phases, i, i - 1) })}
            >
              ↑
            </button>
            <button
              type="button"
              className="btn btn-small btn-ghost ed-tool"
              disabled={i === def.phases.length - 1}
              aria-label="Move phase down"
              onClick={() => onChange({ ...def, phases: moveItem(def.phases, i, i + 1) })}
            >
              ↓
            </button>
            <button
              type="button"
              className="btn btn-small btn-ghost ed-delete"
              aria-label="Delete phase"
              onClick={() => onChange({ ...def, phases: removeAt(def.phases, i) })}
            >
              ✕
            </button>
          </div>

          <label className="field">
            <span>How the phase runs</span>
            <select
              className="select"
              value={phase.mode}
              onChange={(e) => update(i, { ...phase, mode: e.target.value as PhaseDef['mode'] })}
            >
              <option value="auto">Automatic — no player input</option>
              <option value="oneAction">One action — player makes one move</option>
              <option value="manual">Manual — player acts until the phase is ended</option>
            </select>
          </label>
          <p className="faint">{MODE_HINTS[phase.mode]}</p>

          <div className="field">
            <span className="ed-mini-label">When the phase starts</span>
            <BlockScriptEditor
              def={def}
              value={phase.onEnter}
              onChange={(onEnter) => update(i, { ...phase, onEnter })}
              bindings={[]}
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <span className="ed-mini-label">Actions allowed in this phase</span>
            {def.actions.length === 0 ? (
              <p className="faint" style={{ margin: 0 }}>No actions defined yet — create them in the Actions tab.</p>
            ) : (
              def.actions.map((action) => {
                const enabled = phase.actionIds.includes(action.id);
                return (
                  <label className="ed-check" key={action.id}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => update(i, {
                        ...phase,
                        actionIds: e.target.checked
                          ? [...phase.actionIds, action.id]
                          : phase.actionIds.filter((id) => id !== action.id),
                      })}
                    />
                    <span>{action.name}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
