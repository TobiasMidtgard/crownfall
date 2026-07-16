/**
 * TemplateSettings — name/aspect/colors/corner radius of a template,
 * plus the field schema editor (add/rename/retype/remove fields).
 */
import { useState } from 'react';
import type { CardFieldDef, GameDef, CardTemplate } from '../shared/types';
import { ConfirmModal } from '../editor/common/Modal';
import { ColorField, Segmented, Stepper } from './controls';
import {
  cardsWithFieldValue, newField, patchField, patchTemplate, removeField,
} from './designerUtils';

const ASPECT_PRESETS = [
  { value: '0.714', label: 'Poker' },
  { value: '1', label: 'Square' },
  { value: '1.4', label: 'Landscape' },
  { value: 'custom', label: 'Custom' },
] as const;

export function TemplateSettings({ def, template, onChange }: {
  def: GameDef;
  template: CardTemplate;
  onChange: (def: GameDef) => void;
}) {
  const matched = ASPECT_PRESETS.find((p) => p.value !== 'custom' && Math.abs(Number(p.value) - template.aspect) < 0.0005);
  const [customAspect, setCustomAspect] = useState(!matched);
  const segValue = customAspect || !matched ? 'custom' : matched.value;
  const patch = (p: Partial<CardTemplate>) => onChange(patchTemplate(def, template.id, p));

  return (
    <div className="dz-side-panel">
      <h3 className="dz-panel-title">Template</h3>
      <label className="field">
        <span>Name</span>
        <input className="input" value={template.name} onChange={(e) => patch({ name: e.target.value })} />
      </label>
      <label className="field">
        <span>Aspect (width / height)</span>
        <Segmented
          label="Card aspect"
          options={ASPECT_PRESETS}
          value={segValue}
          onChange={(v) => {
            if (v === 'custom') {
              setCustomAspect(true);
            } else {
              setCustomAspect(false);
              patch({ aspect: Number(v) });
            }
          }}
        />
      </label>
      {segValue === 'custom' && (
        <Stepper label="Custom aspect" value={template.aspect} step={0.05} min={0.3} max={3}
          onChange={(aspect) => patch({ aspect })} />
      )}
      <ColorField label="Background" value={template.background} onChange={(background) => patch({ background })} />
      <ColorField label="Border color" value={template.borderColor} onChange={(borderColor) => patch({ borderColor })} />
      <Stepper label="Corner radius %" value={template.cornerRadius} min={0} max={30}
        onChange={(cornerRadius) => patch({ cornerRadius })} />
    </div>
  );
}

export function FieldSchemaEditor({ def, template, onChange }: {
  def: GameDef;
  template: CardTemplate;
  onChange: (def: GameDef) => void;
}) {
  const [pendingRemove, setPendingRemove] = useState<CardFieldDef | null>(null);
  const boundEls = pendingRemove
    ? template.elements.filter((el) => el.kind !== 'box' && el.bind === pendingRemove.id).length
    : 0;
  const cardCount = pendingRemove ? cardsWithFieldValue(def, pendingRemove.id) : 0;

  return (
    <div className="dz-side-panel">
      <h3 className="dz-panel-title">Card fields</h3>
      {template.fields.length === 0 && (
        <p className="faint">No fields yet. Fields hold each card&#39;s data (cost, attack, artwork…).</p>
      )}
      {template.fields.map((f) => (
        <div key={f.id} className="dz-field-row">
          <input
            className="input"
            value={f.name}
            aria-label="Field name"
            onChange={(e) => onChange(patchField(def, template.id, f.id, { name: e.target.value }))}
          />
          <select
            className="select dz-field-type"
            value={f.type}
            aria-label="Field type"
            onChange={(e) => onChange(patchField(def, template.id, f.id, { type: e.target.value as CardFieldDef['type'] }))}
          >
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="image">Image</option>
          </select>
          <button type="button" className="btn dz-icon-btn" aria-label={`Remove field ${f.name}`} onClick={() => setPendingRemove(f)}>
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => onChange(patchTemplate(def, template.id, { fields: [...template.fields, newField()] }))}
      >
        + Add field
      </button>
      {pendingRemove && (
        <ConfirmModal
          title={`Remove field "${pendingRemove.name}"?`}
          confirmLabel="Remove"
          message={(
            <>
              <p>
                This unbinds <strong>{boundEls}</strong> template element{boundEls === 1 ? '' : 's'} and
                deletes its value from <strong>{cardCount}</strong> card{cardCount === 1 ? '' : 's'}.
              </p>
              <p className="faint">This cannot be undone.</p>
            </>
          )}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            onChange(removeField(def, template.id, pendingRemove.id));
            setPendingRemove(null);
          }}
        />
      )}
    </div>
  );
}
