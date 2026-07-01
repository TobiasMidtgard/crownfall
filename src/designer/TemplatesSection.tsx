/**
 * TemplatesSection — template tile strip (select/add/duplicate/delete) and
 * the template editor: canvas + element panel + inspector + settings + fields.
 */
import { useState } from 'react';
import type { GameDef } from '../shared/types';
import { newTemplate } from '../shared/defaults';
import { CardView } from '../components/CardView';
import { TemplateCanvas } from './TemplateCanvas';
import { ElementPanel } from './ElementPanel';
import { ElementInspector } from './ElementInspector';
import { FieldSchemaEditor, TemplateSettings } from './TemplateSettings';
import {
  cardsUsingTemplate, deleteTemplate, duplicateTemplate, sampleCard, setElementRect, updateElement,
} from './designerUtils';

export function TemplatesSection({ def, onChange }: {
  def: GameDef;
  onChange: (def: GameDef) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(def.templates[0]?.id ?? null);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);

  // Fall back to the first template if the selected one was deleted elsewhere.
  const template = def.templates.find((t) => t.id === selectedId) ?? def.templates[0] ?? null;
  const selectedEl = template?.elements.find((el) => el.id === selectedElId) ?? null;

  const selectTemplate = (id: string) => {
    setSelectedId(id);
    setSelectedElId(null);
  };

  const addTemplate = () => {
    const tpl = newTemplate();
    onChange({ ...def, templates: [...def.templates, tpl] });
    selectTemplate(tpl.id);
  };

  const duplicate = () => {
    if (!template) return;
    const { def: next, newId } = duplicateTemplate(def, template.id);
    onChange(next);
    if (newId) selectTemplate(newId);
  };

  const remove = () => {
    if (!template) return;
    const used = cardsUsingTemplate(def, template.id).length;
    const msg = used > 0
      ? `Delete template "${template.name}"?\n\n${used} card(s) use it and will be deleted too. This cannot be undone.`
      : `Delete template "${template.name}"?`;
    if (!window.confirm(msg)) return;
    const next = deleteTemplate(def, template.id);
    onChange(next);
    selectTemplate(next.templates[0]?.id ?? '');
  };

  return (
    <div className="dz-section">
      <div className="dz-tpl-strip">
        {def.templates.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`dz-tpl-tile${t.id === template?.id ? ' dz-tpl-tile-selected' : ''}`}
            onClick={() => selectTemplate(t.id)}
          >
            <CardView card={sampleCard(t)} template={t} width={64} />
            <span className="dz-tpl-name">{t.name}</span>
          </button>
        ))}
        <button type="button" className="dz-tpl-tile dz-tpl-tile-add" onClick={addTemplate}>
          <span className="dz-tpl-add-plus" aria-hidden>+</span>
          <span className="dz-tpl-name">New template</span>
        </button>
      </div>

      {template ? (
        <>
          <div className="row wrap dz-tpl-toolbar">
            <span className="dz-toolbar-title">{template.name}</span>
            <span className="spacer" />
            <button type="button" className="btn" onClick={duplicate}>Duplicate</button>
            <button type="button" className="btn btn-danger" onClick={remove}>Delete</button>
          </div>
          <div className="dz-tpl-editor">
            <div className="dz-canvas-col">
              <TemplateCanvas
                template={template}
                selectedId={selectedElId}
                onSelect={setSelectedElId}
                onCommitRect={(elId, rect) => onChange(setElementRect(def, template.id, elId, rect))}
              />
              <p className="faint dz-canvas-hint">
                Tap an element to select it. Drag to move; use the corner handle to resize.
              </p>
            </div>
            <div className="dz-side-col">
              <ElementPanel
                def={def}
                template={template}
                selectedId={selectedElId}
                onSelect={setSelectedElId}
                onChange={onChange}
              />
              {selectedEl && (
                <ElementInspector
                  template={template}
                  element={selectedEl}
                  onReplace={(el) => onChange(updateElement(def, template.id, el.id, () => el))}
                />
              )}
              <TemplateSettings key={template.id} def={def} template={template} onChange={onChange} />
              <FieldSchemaEditor def={def} template={template} onChange={onChange} />
            </div>
          </div>
        </>
      ) : (
        <div className="empty-state">
          <p>No card templates yet.</p>
          <p className="faint">A template is the visual layout custom cards are drawn with.</p>
          <button type="button" className="btn btn-primary" onClick={addTemplate}>+ New template</button>
        </div>
      )}
    </div>
  );
}
