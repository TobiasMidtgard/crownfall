/**
 * Palette — the screen builder's left rail: "+ Add" buttons for every element
 * kind. Zone opens a modal to either PLACE an existing game zone (with a seat
 * picker for per-player zones) or CREATE A NEW GAME ZONE inline
 * (name/owner/visibility/layout — appended to def.zones, element dropped in
 * one step), so authors never have to leave the builder for the Zones tab.
 * Shape/Line are the build-your-own-indicator primitives; Phase track drops
 * a ready-made group of circles + lines pre-wired with phase-logic states.
 */
import { useState } from 'react';
import type { GameDef, ScreenElement, SeatRef, ZoneDef, ZoneLayout, ZoneVisibility } from '../../../shared/types';
import { Modal } from '../../common/Modal';
import {
  makeZoneDef, newButtonElement, newGroupElement, newLineElement, newLogElement,
  newPhaseTrackElement, newShapeElement, newTextElement, newVarTextElement, newZoneElement,
} from './screenModel';

export interface PaletteProps {
  def: GameDef;
  /** Drop a new element onto the screen (selected by the caller). */
  onInsert: (el: ScreenElement) => void;
  /** Inline zone creation: append the zone to def.zones AND drop its element. */
  onCreateZone: (zone: ZoneDef, el: ScreenElement) => void;
  /** FOCUS MODE: name of the focused element — inserts land in its children. */
  focusName?: string | null;
}

export function Palette({ def, onInsert, onCreateZone, focusName = null }: PaletteProps) {
  const [zoneModal, setZoneModal] = useState(false);
  const hasVars = def.variables.some((v) => v.scope !== 'perCard');
  const hasPhases = def.phases.length > 0;

  const item = (label: string, hint: string, onClick: () => void, disabled = false) => (
    <button
      type="button"
      className="btn tt-tray-item"
      onClick={onClick}
      disabled={disabled}
      title={hint}
    >
      {label}
    </button>
  );

  return (
    <div className="tt-tray">
      <h3 className="tt-rail-title">Add elements</h3>
      <section className="tt-tray-section">
        {item('▭ Zone…', 'Show a game zone (or create a new one)', () => setZoneModal(true))}
        {item('Ⓣ Text', 'A static label', () => onInsert(newTextElement()))}
        {item('# Variable', hasVars ? 'A live variable readout' : 'Add a variable first (Variables tab)', () => {
          const el = newVarTextElement(def);
          if (el) onInsert(el);
        }, !hasVars)}
        {item('▸ Button', 'Performs a plain action (or Pass)', () => onInsert(newButtonElement(def)))}
        {item('◯ Circle / shape', 'A styled shape — states change it with the game', () => onInsert(newShapeElement()))}
        {item('╱ Line', 'A connector line (dashes, arrows, diagonals)', () => onInsert(newLineElement()))}
        {item('☰ Game log', 'The chronicle — every move scrolls in, with turn separators', () => onInsert(newLogElement()))}
        {item(
          '⦿ Phase track',
          hasPhases
            ? 'Ready-made circles + lines that follow the turn phases'
            : 'Add phases first (Flow tab)',
          () => {
            const el = newPhaseTrackElement(def);
            if (el) onInsert(el);
          },
          !hasPhases,
        )}
        {item('▦ Group', 'An empty container — drag elements inside', () => onInsert(newGroupElement()))}
      </section>
      <p className="faint tt-tray-empty">
        {focusName
          ? `Focus mode: new elements drop ON TOP of “${focusName}”, centered in its box.`
          : 'New elements drop in the middle of the screen — drag them into place.'}
      </p>
      {zoneModal && (
        <ZoneInsertModal
          def={def}
          onClose={() => setZoneModal(false)}
          onPlace={(zone, seat) => {
            setZoneModal(false);
            onInsert(newZoneElement(zone, seat));
          }}
          onCreate={(name, owner, visibility, layout) => {
            setZoneModal(false);
            const zone = makeZoneDef(name, owner, visibility, layout);
            onCreateZone(zone, newZoneElement(zone, 'viewer'));
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone insert modal: place an existing zone OR create a new game zone inline
// ---------------------------------------------------------------------------

function ZoneInsertModal({ def, onClose, onPlace, onCreate }: {
  def: GameDef;
  onClose: () => void;
  onPlace: (zone: ZoneDef, seat: SeatRef) => void;
  onCreate: (name: string, owner: ZoneDef['owner'], visibility: ZoneVisibility, layout: ZoneLayout) => void;
}) {
  const [mode, setMode] = useState<'pick' | 'create'>(def.zones.length > 0 ? 'pick' : 'create');
  const [zoneId, setZoneId] = useState(def.zones[0]?.id ?? '');
  const [seat, setSeat] = useState<SeatRef>('viewer');
  const [name, setName] = useState('New zone');
  const [owner, setOwner] = useState<ZoneDef['owner']>('shared');
  const [visibility, setVisibility] = useState<ZoneVisibility>('all');
  const [layoutKind, setLayoutKind] = useState<ZoneLayout>('row');

  const zone = def.zones.find((z) => z.id === zoneId) ?? null;
  const opps = Math.max(1, Math.min(3, (def.meta.maxPlayers || 2) - 1));
  const seats: SeatRef[] = ['viewer', ...Array.from({ length: opps }, (_, i) => `opp${i + 1}` as SeatRef)];
  const seatLabels: Record<string, string> = {
    viewer: 'You (the viewer)', opp1: 'Opponent 1', opp2: 'Opponent 2', opp3: 'Opponent 3',
  };

  return (
    <Modal
      title="Add a zone to the screen"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {mode === 'pick' ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!zone}
              onClick={() => { if (zone) onPlace(zone, seat); }}
            >
              Place zone
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onCreate(name, owner, visibility, layoutKind)}
            >
              Create &amp; place
            </button>
          )}
        </>
      )}
    >
      <div className="tt-seg tt-seg-small" role="group" aria-label="Zone source" style={{ marginBottom: 10 }}>
        <button
          type="button"
          className={mode === 'pick' ? 'tt-active' : ''}
          onClick={() => setMode('pick')}
          disabled={def.zones.length === 0}
        >
          Existing zone
        </button>
        <button
          type="button"
          className={mode === 'create' ? 'tt-active' : ''}
          onClick={() => setMode('create')}
        >
          Create a new game zone…
        </button>
      </div>

      {mode === 'pick' && (
        <>
          <label className="field">
            <span>Zone</span>
            <select className="select" value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
              {def.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name} ({z.owner === 'shared' ? 'shared' : 'per player'} · {z.layout})
                </option>
              ))}
            </select>
          </label>
          {zone?.owner === 'perPlayer' && (
            <label className="field">
              <span>Whose copy</span>
              <select className="select" value={seat} onChange={(e) => setSeat(e.target.value as SeatRef)}>
                {seats.map((s) => <option key={s} value={s}>{seatLabels[s]}</option>)}
              </select>
            </label>
          )}
          <p className="faint" style={{ margin: '4px 0 0' }}>
            The same zone can appear more than once — e.g. your copy at the bottom and an
            opponent's copy at the top.
          </p>
        </>
      )}

      {mode === 'create' && (
        <>
          <label className="field">
            <span>Name</span>
            <input type="text" className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Owner</span>
            <select className="select" value={owner} onChange={(e) => setOwner(e.target.value as ZoneDef['owner'])}>
              <option value="shared">Shared (one on the table)</option>
              <option value="perPlayer">Per player (one each)</option>
            </select>
          </label>
          <label className="field">
            <span>Who sees the cards</span>
            <select className="select" value={visibility} onChange={(e) => setVisibility(e.target.value as ZoneVisibility)}>
              <option value="all">Everyone (face up)</option>
              <option value="owner">Owner only (hand)</option>
              <option value="none">No one (face down)</option>
              <option value="topCard">Top card only</option>
            </select>
          </label>
          <label className="field">
            <span>Card arrangement</span>
            <select className="select" value={layoutKind} onChange={(e) => setLayoutKind(e.target.value as ZoneLayout)}>
              <option value="stack">Stack (pile)</option>
              <option value="row">Row</option>
              <option value="fan">Fan (hand)</option>
              <option value="grid">Grid (slots)</option>
            </select>
          </label>
          <p className="faint" style={{ margin: '4px 0 0' }}>
            Creates a real game zone (it appears in the Zones tab too) and drops it on the screen.
          </p>
        </>
      )}
    </Modal>
  );
}
