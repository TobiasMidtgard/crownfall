/**
 * SystemsTab — the game's structural systems on ONE page: three side-by-side
 * addable lists (Turn phases, Zones, Variables), every item inline-editable
 * with × delete. Replaces the old one-at-a-time Zones / Vars / Flow panels.
 *
 * Phase SCRIPTS and allowed-action whitelists need width, so the phase rows
 * stay compact and "Scripts & actions" (or the pinned Setup script row)
 * opens a full-width detail panel beneath the grid instead.
 */
import { useState } from 'react';
import type { GameDef, PhaseDef, VariableDef, ZoneDef } from '../../shared/types';
import { newPhase, newVariable, newZone } from '../../shared/defaults';
import { BlockScriptEditor } from '../blocks/BlockScriptEditor';
import { ConfirmModal } from '../common/Modal';
import { moveItem, removeAt, updateAt } from '../lib';

const MODE_HINTS: Record<PhaseDef['mode'], string> = {
  auto: 'Runs its script and advances by itself — no player input.',
  oneAction: 'The player makes exactly one move, then the phase ends.',
  manual: 'The player keeps acting until something ends the phase (an "End phase" block, often on a "Done" action).',
};

const VISIBILITY_HINTS: Record<ZoneDef['visibility'], string> = {
  all: 'Everyone sees the cards (when face up).',
  owner: 'Only the owner sees their cards — like a hand.',
  none: 'Nobody sees the cards — like a face-down deck.',
  topCard: 'Only the top card shows — like a discard pile.',
};

/** What the full-width detail panel shows: the setup script or one phase. */
type Detail = 'setup' | { phaseId: string } | null;

export function SystemsTab({ def, onChange }: { def: GameDef; onChange: (def: GameDef) => void }) {
  const [detail, setDetail] = useState<Detail>(null);
  const [deletingZone, setDeletingZone] = useState<number | null>(null);

  const updatePhase = (i: number, phase: PhaseDef) => onChange({ ...def, phases: updateAt(def.phases, i, phase) });
  const updateZone = (i: number, zone: ZoneDef) => onChange({ ...def, zones: updateAt(def.zones, i, zone) });
  const updateVar = (i: number, v: VariableDef) => onChange({ ...def, variables: updateAt(def.variables, i, v) });

  // The detail target may have been deleted out from under us.
  const detailPhaseIndex = detail !== null && detail !== 'setup'
    ? def.phases.findIndex((p) => p.id === detail.phaseId)
    : -1;
  const detailPhase = detailPhaseIndex >= 0 ? def.phases[detailPhaseIndex] : null;

  return (
    <div>
      <div className="row" style={{ marginBottom: 4 }}>
        <h2 style={{ margin: 0 }}>Systems</h2>
      </div>
      <p className="faint">
        Phases define time, zones define where cards live, variables define what the game
        remembers — all on one page. Deep phase logic opens below the grid.
      </p>

      <div className="ed-systems-grid">
        {/* ---- Turn phases -------------------------------------------------- */}
        <div className="panel ed-sys-col">
          <div className="row ed-sys-head">
            <h3 style={{ margin: 0 }}>Turn phases</h3>
            <div className="spacer" />
            <button
              type="button"
              className="btn btn-small"
              onClick={() => onChange({ ...def, phases: [...def.phases, newPhase()] })}
            >
              + Add
            </button>
          </div>
          <p className="faint">Each turn runs these in order, then play passes on.</p>

          <button
            type="button"
            className={`ed-sys-setup${detail === 'setup' ? ' ed-sys-open' : ''}`}
            onClick={() => setDetail(detail === 'setup' ? null : 'setup')}
          >
            <span className="chip">⚙</span>
            <span className="ed-sys-setup-name">Setup script</span>
            <span className="faint">{def.setup.length} block{def.setup.length === 1 ? '' : 's'} ›</span>
          </button>

          {def.phases.length === 0 && <p className="muted">No phases — a game needs at least one.</p>}
          {def.phases.map((phase, i) => {
            const open = detailPhase?.id === phase.id;
            return (
              <div className={`ed-item${open ? ' ed-sys-open' : ''}`} key={phase.id}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <span className="chip accent">{i + 1}</span>
                  <input
                    type="text"
                    className="input ed-item-name"
                    value={phase.name}
                    aria-label="Phase name"
                    onChange={(e) => updatePhase(i, { ...phase, name: e.target.value })}
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
                <label className="field" style={{ marginBottom: 6 }}>
                  <span>How the phase runs</span>
                  <select
                    className="select"
                    value={phase.mode}
                    onChange={(e) => updatePhase(i, { ...phase, mode: e.target.value as PhaseDef['mode'] })}
                  >
                    <option value="auto">Automatic — no player input</option>
                    <option value="oneAction">One action — player makes one move</option>
                    <option value="manual">Manual — until the phase is ended</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-small btn-ghost ed-sys-detail-btn"
                  aria-expanded={open}
                  onClick={() => setDetail(open ? null : { phaseId: phase.id })}
                >
                  {phase.actionIds.length} action{phase.actionIds.length === 1 ? '' : 's'} ·{' '}
                  {phase.onEnter.length} script block{phase.onEnter.length === 1 ? '' : 's'} — edit ›
                </button>
              </div>
            );
          })}
        </div>

        {/* ---- Zones -------------------------------------------------------- */}
        <div className="panel ed-sys-col">
          <div className="row ed-sys-head">
            <h3 style={{ margin: 0 }}>Zones</h3>
            <div className="spacer" />
            <button
              type="button"
              className="btn btn-small"
              onClick={() => onChange({ ...def, zones: [...def.zones, newZone()] })}
            >
              + Add
            </button>
          </div>
          <p className="faint">Where cards live: decks, hands, discard piles, play areas.</p>

          {def.zones.length === 0 && <p className="muted">No zones yet.</p>}
          {def.zones.map((zone, i) => (
            <div className="ed-item" key={zone.id}>
              <div className="row" style={{ marginBottom: 8 }}>
                <input
                  type="text"
                  className="input ed-item-name"
                  value={zone.name}
                  aria-label="Zone name"
                  onChange={(e) => updateZone(i, { ...zone, name: e.target.value })}
                />
                <button
                  type="button"
                  className="btn btn-small btn-ghost ed-delete"
                  onClick={() => setDeletingZone(i)}
                  aria-label="Delete zone"
                >
                  ✕
                </button>
              </div>
              <div className="ed-grid">
                <label className="field">
                  <span>Owner</span>
                  <select
                    className="select"
                    value={zone.owner}
                    onChange={(e) => updateZone(i, { ...zone, owner: e.target.value as ZoneDef['owner'] })}
                  >
                    <option value="shared">Shared — one for the table</option>
                    <option value="perPlayer">Per player</option>
                  </select>
                </label>
                <label className="field">
                  <span>Who sees the cards</span>
                  <select
                    className="select"
                    value={zone.visibility}
                    onChange={(e) => updateZone(i, { ...zone, visibility: e.target.value as ZoneDef['visibility'] })}
                  >
                    <option value="all">Everyone</option>
                    <option value="owner">Owner only</option>
                    <option value="none">Nobody</option>
                    <option value="topCard">Top card only</option>
                  </select>
                </label>
                <label className="field">
                  <span>Layout</span>
                  <select
                    className="select"
                    value={zone.layout}
                    onChange={(e) => updateZone(i, { ...zone, layout: e.target.value as ZoneDef['layout'] })}
                  >
                    <option value="stack">Stack — one pile</option>
                    <option value="fan">Fan — like a hand</option>
                    <option value="row">Row — side by side</option>
                    <option value="grid">Grid</option>
                  </select>
                </label>
                <label className="field">
                  <span>Table area</span>
                  <select
                    className="select"
                    value={zone.area}
                    onChange={(e) => updateZone(i, { ...zone, area: e.target.value as ZoneDef['area'] })}
                  >
                    <option value="center">Center of the table</option>
                    <option value="player">Each player's strip</option>
                  </select>
                </label>
              </div>
              <p className="faint" style={{ margin: 0 }}>{VISIBILITY_HINTS[zone.visibility]}</p>
            </div>
          ))}
        </div>

        {/* ---- Variables ---------------------------------------------------- */}
        <div className="panel ed-sys-col">
          <div className="row ed-sys-head">
            <h3 style={{ margin: 0 }}>Variables</h3>
            <div className="spacer" />
            <button
              type="button"
              className="btn btn-small"
              onClick={() => onChange({ ...def, variables: [...def.variables, newVariable()] })}
            >
              + Add
            </button>
          </div>
          <p className="faint">Score, lives, mana — anything the game must remember.</p>

          {def.variables.length === 0 && <p className="muted">No variables yet.</p>}
          {def.variables.map((v, i) => (
            <div className="ed-item" key={v.id}>
              <div className="row" style={{ marginBottom: 8 }}>
                <input
                  type="text"
                  className="input ed-item-name"
                  value={v.name}
                  aria-label="Variable name"
                  onChange={(e) => updateVar(i, { ...v, name: e.target.value })}
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
                    onChange={(e) => updateVar(i, { ...v, scope: e.target.value as VariableDef['scope'] })}
                  >
                    <option value="global">Global — one value</option>
                    <option value="perPlayer">Per player</option>
                    <option value="perCard">Per card</option>
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
                      updateVar(i, { ...v, type, initial });
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
                      onChange={(e) => updateVar(i, { ...v, initial: Number(e.target.value) || 0 })}
                    />
                  )}
                  {v.type === 'string' && (
                    <input
                      type="text"
                      className="input"
                      value={String(v.initial)}
                      onChange={(e) => updateVar(i, { ...v, initial: e.target.value })}
                    />
                  )}
                  {v.type === 'boolean' && (
                    <select
                      className="select"
                      value={v.initial ? 'yes' : 'no'}
                      onChange={(e) => updateVar(i, { ...v, initial: e.target.value === 'yes' })}
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
                    onChange={(e) => updateVar(i, { ...v, hidden: e.target.value === 'hidden' || undefined })}
                  >
                    <option value="shown">Shown in the status bar</option>
                    <option value="hidden">Hidden — bookkeeping</option>
                  </select>
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ---- Full-width detail: setup script or one phase's deep logic ---- */}
      {detail === 'setup' && (
        <div className="panel ed-section ed-sys-detail">
          <div className="row" style={{ marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Setup script</h3>
            <div className="spacer" />
            <button type="button" className="btn btn-small" onClick={() => setDetail(null)} aria-label="Close detail">✕</button>
          </div>
          <p className="faint">Runs once when a game starts, after decks are spawned and shuffled.</p>
          <BlockScriptEditor def={def} value={def.setup} onChange={(setup) => onChange({ ...def, setup })} bindings={[]} />
        </div>
      )}

      {detailPhase && (
        <div className="panel ed-section ed-sys-detail">
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="chip accent">{detailPhaseIndex + 1}</span>
            <h3 style={{ margin: 0 }}>{detailPhase.name || 'Phase'}</h3>
            <div className="spacer" />
            <button type="button" className="btn btn-small" onClick={() => setDetail(null)} aria-label="Close detail">✕</button>
          </div>
          <p className="faint">{MODE_HINTS[detailPhase.mode]}</p>

          <div className="field">
            <span className="ed-mini-label">When the phase starts</span>
            <BlockScriptEditor
              key={detailPhase.id}
              def={def}
              value={detailPhase.onEnter}
              onChange={(onEnter) => updatePhase(detailPhaseIndex, { ...detailPhase, onEnter })}
              bindings={[]}
            />
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <span className="ed-mini-label">Actions allowed in this phase</span>
            {def.actions.length === 0 ? (
              <p className="faint" style={{ margin: 0 }}>No actions defined yet — create them in the Actions panel.</p>
            ) : (
              def.actions.map((action) => {
                const enabled = detailPhase.actionIds.includes(action.id);
                return (
                  <label className="ed-check" key={action.id}>
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) => updatePhase(detailPhaseIndex, {
                        ...detailPhase,
                        actionIds: e.target.checked
                          ? [...detailPhase.actionIds, action.id]
                          : detailPhase.actionIds.filter((id) => id !== action.id),
                      })}
                    />
                    <span>{action.name}</span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}

      {deletingZone !== null && def.zones[deletingZone] && (
        <ConfirmModal
          title={`Delete zone "${def.zones[deletingZone].name}"?`}
          message="Scripts, decks, and actions that reference this zone will break — the issue checker will flag them so you can fix them."
          onConfirm={() => { onChange({ ...def, zones: removeAt(def.zones, deletingZone) }); setDeletingZone(null); }}
          onCancel={() => setDeletingZone(null)}
        />
      )}
    </div>
  );
}
