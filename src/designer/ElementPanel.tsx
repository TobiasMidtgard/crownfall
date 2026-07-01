/**
 * ElementPanel — layer list of a template's elements (topmost first),
 * with select / raise / lower / delete, and the "Add element" picker.
 */
import { useState } from 'react';
import type { CardTemplate, GameDef, TemplateElement } from '../shared/types';
import {
  ELEMENT_ICON, ELEMENT_KINDS, ELEMENT_KIND_LABEL, deleteElement, elementLabel,
  moveElement, newElement, patchTemplate, type ElementKind,
} from './designerUtils';

const KIND_HINT: Record<ElementKind, string> = {
  text: 'A line or block of text, static or bound to a field',
  stat: 'A number badge (cost, attack, health…)',
  image: 'Artwork from a URL or an image field',
  box: 'A colored rectangle (banners, panels)',
};

export function ElementPanel({ def, template, selectedId, onSelect, onChange }: {
  def: GameDef;
  template: CardTemplate;
  selectedId: string | null;
  onSelect: (elId: string | null) => void;
  onChange: (def: GameDef) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Show topmost element first, like a layers panel.
  const layers = [...template.elements].reverse();

  const add = (kind: ElementKind) => {
    const el = newElement(kind, template.aspect);
    onChange(patchTemplate(def, template.id, { elements: [...template.elements, el] }));
    onSelect(el.id);
    setPickerOpen(false);
  };

  const remove = (el: TemplateElement) => {
    if (!window.confirm(`Delete this ${ELEMENT_KIND_LABEL[el.kind].toLowerCase()} element?`)) return;
    if (selectedId === el.id) onSelect(null);
    onChange(deleteElement(def, template.id, el.id));
  };

  return (
    <div className="dz-side-panel">
      <h3 className="dz-panel-title">Elements</h3>
      {layers.length === 0 && <p className="faint">No elements. Add one to start designing.</p>}
      {layers.map((el, i) => (
        <div
          key={el.id}
          className={`dz-layer-row${el.id === selectedId ? ' dz-layer-row-selected' : ''}`}
        >
          <button type="button" className="dz-layer-main" onClick={() => onSelect(el.id)}>
            <span className="dz-layer-icon" aria-hidden>{ELEMENT_ICON[el.kind]}</span>
            <span className="dz-layer-label">{elementLabel(el, template)}</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost dz-icon-btn"
            aria-label="Raise element"
            disabled={i === 0}
            onClick={() => onChange(moveElement(def, template.id, el.id, 1))}
          >
            ▲
          </button>
          <button
            type="button"
            className="btn btn-ghost dz-icon-btn"
            aria-label="Lower element"
            disabled={i === layers.length - 1}
            onClick={() => onChange(moveElement(def, template.id, el.id, -1))}
          >
            ▼
          </button>
          <button
            type="button"
            className="btn btn-ghost dz-icon-btn dz-danger-text"
            aria-label="Delete element"
            onClick={() => remove(el)}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => setPickerOpen(true)}>+ Add element</button>

      {pickerOpen && (
        <div className="modal-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">Add element</div>
            <div className="modal-body">
              {ELEMENT_KINDS.map((kind) => (
                <button key={kind} type="button" className="dz-picker-option" onClick={() => add(kind)}>
                  <span className="dz-layer-icon" aria-hidden>{ELEMENT_ICON[kind]}</span>
                  <span className="dz-picker-text">
                    <span className="dz-picker-title">{ELEMENT_KIND_LABEL[kind]}</span>
                    <span className="faint">{KIND_HINT[kind]}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn" onClick={() => setPickerOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
