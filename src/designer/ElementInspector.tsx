/**
 * ElementInspector — edits the selected template element: position/size
 * steppers plus kind-specific controls (binding, typography, colors, shape…).
 */
import type { CardTemplate, TemplateElement } from '../shared/types';
import { ColorField, Segmented, Stepper } from './controls';
import { ELEMENT_KIND_LABEL } from './designerUtils';

export function ElementInspector({ template, element, onReplace }: {
  template: CardTemplate;
  element: TemplateElement;
  /** Replace the element wholesale (kind never changes here). */
  onReplace: (el: TemplateElement) => void;
}) {
  return (
    <div className="dz-inspector">
      <h3 className="dz-panel-title">{ELEMENT_KIND_LABEL[element.kind]}</h3>
      <div className="dz-rect-grid">
        <Stepper label="X %" value={element.x} onChange={(x) => onReplace({ ...element, x })} />
        <Stepper label="Y %" value={element.y} onChange={(y) => onReplace({ ...element, y })} />
        <Stepper label="Width %" value={element.w} min={2} onChange={(w) => onReplace({ ...element, w })} />
        <Stepper label="Height %" value={element.h} min={2} onChange={(h) => onReplace({ ...element, h })} />
      </div>
      <KindControls template={template} element={element} onReplace={onReplace} />
    </div>
  );
}

function KindControls({ template, element, onReplace }: {
  template: CardTemplate;
  element: TemplateElement;
  onReplace: (el: TemplateElement) => void;
}) {
  switch (element.kind) {
    case 'text': {
      const el = element;
      return (
        <>
          <BindSelect
            label="Shows"
            template={template}
            value={el.bind}
            nullLabel="Static text"
            fieldTypes={['text', 'number']}
            includeName
            onChange={(bind) => onReplace({ ...el, bind })}
          />
          {el.bind === null && (
            <label className="field">
              <span>Text</span>
              <input className="input" value={el.text} onChange={(e) => onReplace({ ...el, text: e.target.value })} />
            </label>
          )}
          <div className="dz-rect-grid">
            <Stepper label="Font size %" value={el.fontSize} min={2} max={40}
              onChange={(fontSize) => onReplace({ ...el, fontSize })} />
            <label className="field">
              <span>Style</span>
              <div className="dz-toggle-row">
                <button
                  type="button"
                  className={`btn dz-toggle${el.bold ? ' dz-toggle-on' : ''}`}
                  aria-pressed={el.bold}
                  onClick={() => onReplace({ ...el, bold: !el.bold })}
                >
                  <b>B</b>
                </button>
                <button
                  type="button"
                  className={`btn dz-toggle${el.italic ? ' dz-toggle-on' : ''}`}
                  aria-pressed={el.italic}
                  onClick={() => onReplace({ ...el, italic: !el.italic })}
                >
                  <i>I</i>
                </button>
              </div>
            </label>
          </div>
          <label className="field">
            <span>Align</span>
            <Segmented
              label="Text align"
              options={[
                { value: 'left', label: 'Left' },
                { value: 'center', label: 'Center' },
                { value: 'right', label: 'Right' },
              ] as const}
              value={el.align}
              onChange={(align) => onReplace({ ...el, align })}
            />
          </label>
          <ColorField label="Color" value={el.color} onChange={(color) => onReplace({ ...el, color })} />
        </>
      );
    }
    case 'stat': {
      const el = element;
      return (
        <>
          <BindSelect
            label="Shows"
            template={template}
            value={el.bind}
            nullLabel="(no value)"
            fieldTypes={['text', 'number']}
            includeName
            onChange={(bind) => onReplace({ ...el, bind })}
          />
          <label className="field">
            <span>Shape</span>
            <Segmented
              label="Stat shape"
              options={[
                { value: 'circle', label: 'Circle' },
                { value: 'square', label: 'Square' },
                { value: 'shield', label: 'Shield' },
              ] as const}
              value={el.shape}
              onChange={(shape) => onReplace({ ...el, shape })}
            />
          </label>
          <ColorField label="Background" value={el.bg} onChange={(bg) => onReplace({ ...el, bg })} />
          <ColorField label="Text color" value={el.color} onChange={(color) => onReplace({ ...el, color })} />
          <Stepper label="Font size %" value={el.fontSize} min={2} max={40}
            onChange={(fontSize) => onReplace({ ...el, fontSize })} />
        </>
      );
    }
    case 'image': {
      const el = element;
      return (
        <>
          <BindSelect
            label="Source"
            template={template}
            value={el.bind}
            nullLabel="Static URL"
            fieldTypes={['image']}
            includeName={false}
            onChange={(bind) => onReplace({ ...el, bind })}
          />
          {el.bind === null && (
            <label className="field">
              <span>Image URL</span>
              <input
                className="input"
                value={el.src}
                placeholder="https://… or data URL"
                onChange={(e) => onReplace({ ...el, src: e.target.value })}
              />
            </label>
          )}
          <label className="field">
            <span>Fit</span>
            <Segmented
              label="Image fit"
              options={[
                { value: 'cover', label: 'Cover' },
                { value: 'contain', label: 'Contain' },
              ] as const}
              value={el.fit}
              onChange={(fit) => onReplace({ ...el, fit })}
            />
          </label>
          <Stepper label="Corner radius %" value={el.radius} min={0} max={50}
            onChange={(radius) => onReplace({ ...el, radius })} />
        </>
      );
    }
    case 'box': {
      const el = element;
      return (
        <>
          <ColorField label="Fill" value={el.fill} onChange={(fill) => onReplace({ ...el, fill })} />
          <Stepper label="Corner radius %" value={el.radius} min={0} max={50}
            onChange={(radius) => onReplace({ ...el, radius })} />
        </>
      );
    }
  }
}

/** Dropdown over template fields (+ optional built-in 'name', + a null option). */
function BindSelect({ label, template, value, nullLabel, fieldTypes, includeName, onChange }: {
  label: string;
  template: CardTemplate;
  value: string | null;
  nullLabel: string;
  fieldTypes: ('text' | 'number' | 'image')[];
  includeName: boolean;
  onChange: (bind: string | null) => void;
}) {
  const fields = template.fields.filter((f) => fieldTypes.includes(f.type));
  // A previously-bound field that no longer matches (deleted/retyped) still
  // needs to appear so the select shows the truth instead of lying.
  const stale = value !== null && value !== 'name' && !fields.some((f) => f.id === value);
  return (
    <label className="field">
      <span>{label}</span>
      <select
        className="select"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      >
        <option value="">{nullLabel}</option>
        {includeName && <option value="name">Name (built-in)</option>}
        {fields.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
        {stale && <option value={value}>(missing field)</option>}
      </select>
    </label>
  );
}
