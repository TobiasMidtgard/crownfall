/**
 * ZonesTab — list and edit the game's zones (deck piles, hands, discard,
 * battlefield…). Deleting warns because scripts may reference the zone.
 */
import { useState } from 'react';
import type { GameDef, ZoneDef } from '../../shared/types';
import { newZone } from '../../shared/defaults';
import { ConfirmModal } from '../common/Modal';
import { removeAt, updateAt } from '../lib';

const VISIBILITY_HINTS: Record<ZoneDef['visibility'], string> = {
  all: 'Everyone sees the cards (when face up).',
  owner: 'Only the owner sees their cards — like a hand.',
  none: 'Nobody sees the cards — like a face-down deck.',
  topCard: 'Only the top card shows — like a discard pile.',
};

export function ZonesTab({ def, onChange }: { def: GameDef; onChange: (def: GameDef) => void }) {
  const [deleting, setDeleting] = useState<number | null>(null);

  const update = (i: number, zone: ZoneDef) => onChange({ ...def, zones: updateAt(def.zones, i, zone) });

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Zones</h2>
        <div className="spacer" />
        <button type="button" className="btn" onClick={() => onChange({ ...def, zones: [...def.zones, newZone()] })}>
          + Add zone
        </button>
      </div>
      <p className="faint">Zones are the places cards live: decks, hands, discard piles, play areas.</p>

      {def.zones.map((zone, i) => (
        <div className="ed-item" key={zone.id}>
          <div className="row" style={{ marginBottom: 10 }}>
            <input
              type="text"
              className="input ed-item-name"
              value={zone.name}
              aria-label="Zone name"
              onChange={(e) => update(i, { ...zone, name: e.target.value })}
            />
            <button type="button" className="btn btn-small btn-ghost ed-delete" onClick={() => setDeleting(i)} aria-label="Delete zone">✕</button>
          </div>
          <div className="ed-grid">
            <label className="field">
              <span>Owner</span>
              <select
                className="select"
                value={zone.owner}
                onChange={(e) => update(i, { ...zone, owner: e.target.value as ZoneDef['owner'] })}
              >
                <option value="shared">Shared — one for the table</option>
                <option value="perPlayer">Per player — each player gets one</option>
              </select>
            </label>
            <label className="field">
              <span>Who sees the cards</span>
              <select
                className="select"
                value={zone.visibility}
                onChange={(e) => update(i, { ...zone, visibility: e.target.value as ZoneDef['visibility'] })}
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
                onChange={(e) => update(i, { ...zone, layout: e.target.value as ZoneDef['layout'] })}
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
                onChange={(e) => update(i, { ...zone, area: e.target.value as ZoneDef['area'] })}
              >
                <option value="center">Center of the table</option>
                <option value="player">Each player's strip</option>
              </select>
            </label>
          </div>
          <p className="faint" style={{ margin: 0 }}>{VISIBILITY_HINTS[zone.visibility]}</p>
        </div>
      ))}

      {deleting !== null && def.zones[deleting] && (
        <ConfirmModal
          title={`Delete zone "${def.zones[deleting].name}"?`}
          message="Scripts, decks, and actions that reference this zone will break — the issue checker will flag them so you can fix them."
          onConfirm={() => { onChange({ ...def, zones: removeAt(def.zones, deleting) }); setDeleting(null); }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
