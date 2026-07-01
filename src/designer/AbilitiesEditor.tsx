/**
 * AbilitiesEditor — per-card triggered scripts. Each ability: name, event,
 * zone (the zone entered/left, or "while in zone" for turn/phase events),
 * optional phase, a condition expression, and a block script.
 * Scripts run with $self = this card, $owner = its controller.
 */
import type { AbilityDef, CardDef, GameDef } from '../shared/types';
import { BlockScriptEditor } from '../editor/blocks/BlockScriptEditor';
import { ExpressionEditor } from '../editor/blocks/ExpressionEditor';
import { newAbility } from './designerUtils';

const ABILITY_BINDINGS = ['$self', '$owner'];

const EVENT_OPTIONS: { value: AbilityDef['on']; label: string }[] = [
  { value: 'enterZone', label: 'When it enters a zone' },
  { value: 'leaveZone', label: 'When it leaves a zone' },
  { value: 'turnStart', label: 'At turn start' },
  { value: 'turnEnd', label: 'At turn end' },
  { value: 'phaseStart', label: 'At phase start' },
  { value: 'phaseEnd', label: 'At phase end' },
];

export function AbilitiesEditor({ def, card, onAbilities }: {
  def: GameDef;
  card: CardDef;
  onAbilities: (abilities: AbilityDef[]) => void;
}) {
  const update = (id: string, patch: Partial<AbilityDef>) =>
    onAbilities(card.abilities.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const changeEvent = (a: AbilityDef, on: AbilityDef['on']) => {
    const isZoneEvent = on === 'enterZone' || on === 'leaveZone';
    const isPhase = on === 'phaseStart' || on === 'phaseEnd';
    update(a.id, {
      on,
      // turn/phase abilities are only live while the card sits in a zone, so
      // default to the first zone instead of leaving the required pick empty.
      zoneId: !isZoneEvent && a.zoneId === null ? (def.zones[0]?.id ?? null) : a.zoneId,
      phaseId: isPhase ? (a.phaseId ?? null) : null,
    });
  };

  return (
    <div className="dz-abilities">
      <h3 className="dz-panel-title">Abilities</h3>
      {card.abilities.length === 0 && (
        <p className="faint">No abilities. Abilities are scripts on this card that run on game events.</p>
      )}
      {card.abilities.map((a) => {
        const isZoneEvent = a.on === 'enterZone' || a.on === 'leaveZone';
        const isPhase = a.on === 'phaseStart' || a.on === 'phaseEnd';
        return (
          <div key={a.id} className="dz-ability">
            <div className="row">
              <input
                className="input"
                value={a.name}
                aria-label="Ability name"
                onChange={(e) => update(a.id, { name: e.target.value })}
              />
              <button
                type="button"
                className="btn btn-ghost dz-icon-btn dz-danger-text"
                aria-label={`Delete ability ${a.name}`}
                onClick={() => {
                  if (window.confirm(`Delete ability "${a.name}"?`)) {
                    onAbilities(card.abilities.filter((x) => x.id !== a.id));
                  }
                }}
              >
                ✕
              </button>
            </div>
            <div className="dz-ability-grid">
              <label className="field">
                <span>Event</span>
                <select
                  className="select"
                  value={a.on}
                  onChange={(e) => changeEvent(a, e.target.value as AbilityDef['on'])}
                >
                  {EVENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </label>
              <label className="field">
                <span>{isZoneEvent ? 'Zone' : 'While in zone (required)'}</span>
                <select
                  className="select"
                  value={a.zoneId ?? ''}
                  onChange={(e) => update(a.id, { zoneId: e.target.value === '' ? null : e.target.value })}
                >
                  <option value="">{isZoneEvent ? 'Any zone' : 'Choose a zone…'}</option>
                  {def.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                </select>
              </label>
              {isPhase && (
                <label className="field">
                  <span>Phase</span>
                  <select
                    className="select"
                    value={a.phaseId ?? ''}
                    onChange={(e) => update(a.id, { phaseId: e.target.value === '' ? null : e.target.value })}
                  >
                    <option value="">Any phase</option>
                    {def.phases.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </label>
              )}
            </div>
            {!isZoneEvent && a.zoneId === null && (
              <span className="chip warn">Pick the zone this ability is active in — it never fires otherwise.</span>
            )}
            <div className="field">
              <span className="dz-field-label">Condition</span>
              <ExpressionEditor
                def={def}
                value={a.condition}
                onChange={(condition) => update(a.id, { condition })}
                bindings={ABILITY_BINDINGS}
                allowNull
                nullLabel="Always"
              />
            </div>
            <div className="field">
              <span className="dz-field-label">Effect</span>
              <BlockScriptEditor
                def={def}
                value={a.script}
                onChange={(script) => update(a.id, { script })}
                bindings={ABILITY_BINDINGS}
              />
            </div>
          </div>
        );
      })}
      <button
        type="button"
        className="btn"
        onClick={() => onAbilities([...card.abilities, newAbility(def)])}
      >
        + Add ability
      </button>
    </div>
  );
}
