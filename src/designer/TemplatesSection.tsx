/**
 * TemplatesSection — the card designer, Deckhand-style: a tool rail of
 * one-click element tiles on the left, the live card canvas in the middle
 * (tap to select, drag to move, corner handle to resize, a compact chip
 * strip for overlapping elements), and ONE context-sensitive inspector on
 * the right — the selected element's controls, or the card's settings and
 * fields when nothing is selected. No modals, no stacked panels.
 */
import { useState } from 'react';
import type { GameDef } from '../shared/types';
import { newTemplate } from '../shared/defaults';
import { CardView } from '../components/CardView';
import { ConfirmModal } from '../editor/common/Modal';
import { EdIcon, type EdIconName } from '../editor/common/icons';
import { TemplateCanvas } from './TemplateCanvas';
import { ElementInspector } from './ElementInspector';
import { FieldSchemaEditor, TemplateSettings } from './TemplateSettings';
import {
  TOOL_HINT, TOOL_KINDS, TOOL_LABEL, cardsUsingTemplate, deleteElement, deleteTemplate,
  duplicateTemplate, elementLabel, moveElement, newToolElement, patchTemplate, sampleCard,
  setElementRect, updateElement, type ToolKind,
} from './designerUtils';

const TOOL_ICON: Record<ToolKind, EdIconName> = {
  text: 'text', stat: 'stat', image: 'image', box: 'box', circle: 'ellipse', line: 'line',
};

const CHIP_ICON: Record<string, EdIconName> = {
  text: 'text', stat: 'stat', image: 'image', box: 'box',
};

export function TemplatesSection({ def, onChange }: {
  def: GameDef;
  onChange: (def: GameDef) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(def.templates[0]?.id ?? null);
  const [selectedElId, setSelectedElId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string; used: number } | null>(null);

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
    setPendingDelete({
      id: template.id,
      name: template.name,
      used: cardsUsingTemplate(def, template.id).length,
    });
  };

  const addTool = (tool: ToolKind) => {
    if (!template) return;
    const el = newToolElement(tool, template.aspect);
    onChange(patchTemplate(def, template.id, { elements: [...template.elements, el] }));
    setSelectedElId(el.id);
  };

  const removeSelected = () => {
    if (!template || !selectedEl) return;
    setSelectedElId(null);
    onChange(deleteElement(def, template.id, selectedEl.id));
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
        <div className="dz-tpl-editor">
          <div className="dz-tools" role="toolbar" aria-label="Add card elements">
            {TOOL_KINDS.map((tool) => (
              <button
                key={tool}
                type="button"
                className="tt-pal"
                title={TOOL_HINT[tool]}
                onClick={() => addTool(tool)}
              >
                <EdIcon name={TOOL_ICON[tool]} />
                <span>{TOOL_LABEL[tool]}</span>
              </button>
            ))}
          </div>

          <div className="dz-canvas-col">
            <TemplateCanvas
              template={template}
              selectedId={selectedElId}
              onSelect={setSelectedElId}
              onCommitRect={(elId, rect) => onChange(setElementRect(def, template.id, elId, rect))}
            />
            {template.elements.length > 0 && (
              <div className="dz-el-chips" role="listbox" aria-label="Template elements (topmost last)">
                {template.elements.map((el) => (
                  <button
                    key={el.id}
                    type="button"
                    className={`dz-el-chip${el.id === selectedElId ? ' dz-el-chip-selected' : ''}`}
                    title={elementLabel(el, template)}
                    aria-selected={el.id === selectedElId}
                    role="option"
                    onClick={() => setSelectedElId(el.id === selectedElId ? null : el.id)}
                  >
                    <EdIcon name={CHIP_ICON[el.kind] ?? 'box'} size={15} />
                  </button>
                ))}
              </div>
            )}
            <p className="faint dz-canvas-hint">
              Tap the card (or a chip below it) to select an element — drag to move, corner
              handle to resize. The tools on the left drop new elements.
            </p>
          </div>

          <div className="dz-side-col">
            {selectedEl ? (
              <>
                <div className="dz-el-actions">
                  <button
                    type="button"
                    className="btn btn-small"
                    title="Bring forward"
                    onClick={() => onChange(moveElement(def, template.id, selectedEl.id, 1))}
                  >
                    ▲ Front
                  </button>
                  <button
                    type="button"
                    className="btn btn-small"
                    title="Send back"
                    onClick={() => onChange(moveElement(def, template.id, selectedEl.id, -1))}
                  >
                    ▼ Back
                  </button>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn btn-small dz-danger-text"
                    onClick={removeSelected}
                  >
                    ✕ Delete
                  </button>
                </div>
                <ElementInspector
                  template={template}
                  element={selectedEl}
                  onReplace={(el) => onChange(updateElement(def, template.id, el.id, () => el))}
                />
              </>
            ) : (
              <>
                <TemplateSettings key={template.id} def={def} template={template} onChange={onChange} />
                <FieldSchemaEditor def={def} template={template} onChange={onChange} />
                <div className="dz-el-actions">
                  <button type="button" className="btn btn-small" onClick={duplicate}>Duplicate template</button>
                  <span className="spacer" />
                  <button type="button" className="btn btn-small dz-danger-text" onClick={remove}>✕ Delete</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <p>No card templates yet.</p>
          <p className="faint">A template is the visual layout custom cards are drawn with.</p>
          <button type="button" className="btn btn-primary" onClick={addTemplate}>+ New template</button>
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          title={`Delete template "${pendingDelete.name}"?`}
          message={pendingDelete.used > 0 ? (
            <>
              <p>
                <strong>{pendingDelete.used}</strong> card{pendingDelete.used === 1 ? ' uses' : 's use'} it
                and will be deleted too.
              </p>
              <p className="faint">This cannot be undone.</p>
            </>
          ) : (
            <p>This cannot be undone.</p>
          )}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => {
            const next = deleteTemplate(def, pendingDelete.id);
            onChange(next);
            selectTemplate(next.templates[0]?.id ?? '');
            setPendingDelete(null);
          }}
        />
      )}
    </div>
  );
}
