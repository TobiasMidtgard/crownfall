/**
 * CardEditorModal — edits one card: live preview, name, type + tags (the
 * card's type line, from the game's Types tab), template field values
 * (text / number / image-with-upload), abilities, duplicate/delete.
 */
import { useRef, useState } from 'react';
import type { CardDef, GameDef } from '../shared/types';
import { CardView } from '../components/CardView';
import { AbilitiesEditor } from './AbilitiesEditor';
import { cardPreview, deleteCard, duplicateCard, patchCard, setCardField } from './designerUtils';

/** ~200 KB of binary ≈ 273k chars of base64 data URL. */
const BIG_IMAGE_CHARS = 272000;

export function CardEditorModal({ def, cardId, onChange, onClose, onSwitchCard }: {
  def: GameDef;
  cardId: string;
  onChange: (def: GameDef) => void;
  onClose: () => void;
  /** Used after "Duplicate" to continue editing the copy. */
  onSwitchCard: (cardId: string) => void;
}) {
  const card = def.cards.find((c) => c.id === cardId);
  if (!card) return null;
  const template = def.templates.find((t) => t.id === card.templateId) ?? null;

  const duplicate = () => {
    const { def: next, newId } = duplicateCard(def, card.id);
    onChange(next);
    if (newId) onSwitchCard(newId);
  };

  const remove = () => {
    if (!window.confirm(`Delete card "${card.name}"? It is also removed from any decks.`)) return;
    onChange(deleteCard(def, card.id));
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal dz-card-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          Edit card
          <span className="spacer" />
          <button type="button" className="btn btn-ghost dz-icon-btn" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="dz-card-preview">
            <CardView card={cardPreview(card)} template={template} width={240} />
          </div>
          {!template && (
            <span className="chip error">This card&#39;s template no longer exists — pick a new one by recreating the card.</span>
          )}
          <label className="field">
            <span>Name</span>
            <input
              className="input"
              value={card.name}
              onChange={(e) => onChange(patchCard(def, card.id, { name: e.target.value }))}
            />
          </label>
          <TypeLineFields def={def} card={card} onChange={onChange} />
          {template?.fields.map((f) => {
            const raw = card.fields[f.id];
            switch (f.type) {
              case 'number':
                return (
                  <NumberField
                    key={f.id}
                    label={f.name}
                    value={typeof raw === 'number' ? raw : Number(raw) || 0}
                    onCommit={(n) => onChange(setCardField(def, card.id, f.id, n))}
                  />
                );
              case 'image':
                return (
                  <ImageFieldInput
                    key={f.id}
                    label={f.name}
                    value={String(raw ?? '')}
                    onCommit={(v) => onChange(setCardField(def, card.id, f.id, v))}
                  />
                );
              default:
                return (
                  <label key={f.id} className="field">
                    <span>{f.name}</span>
                    <input
                      className="input"
                      value={String(raw ?? '')}
                      onChange={(e) => onChange(setCardField(def, card.id, f.id, e.target.value))}
                    />
                  </label>
                );
            }
          })}
          <AbilitiesEditor
            def={def}
            card={card}
            onAbilities={(abilities) => onChange(patchCard(def, card.id, { abilities }))}
          />
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={duplicate}>Duplicate</button>
          <button type="button" className="btn btn-danger" onClick={remove}>Delete</button>
          <span className="spacer" />
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

/**
 * The card's type line: a TYPE single-select ("Untyped" allowed) and TAGS
 * multi-select chips, populated from the game's Types tab. While the game
 * defines no types/tags there is nothing to pick, so a one-line hint points
 * at the Types tab instead (plain text — this modal has no tab-switch
 * callback to make it a live link).
 */
function TypeLineFields({ def, card, onChange }: {
  def: GameDef;
  card: CardDef;
  onChange: (def: GameDef) => void;
}) {
  const types = def.cardTypes ?? [];
  const tags = def.cardTags ?? [];
  const cardTags = card.tags ?? [];
  if (types.length === 0 && tags.length === 0) {
    return (
      <p className="faint" style={{ margin: '4px 0' }}>
        This game has no card types or tags yet — define them in the Types tab to give cards a type line.
      </p>
    );
  }

  const toggleTag = (tagId: string) => {
    const next = cardTags.includes(tagId) ? cardTags.filter((t) => t !== tagId) : [...cardTags, tagId];
    onChange(patchCard(def, card.id, { tags: next }));
  };

  return (
    <>
      {types.length > 0 && (
        <label className="field">
          <span>Type</span>
          <select
            className="select"
            value={card.typeId ?? ''}
            onChange={(e) => onChange(patchCard(def, card.id, { typeId: e.target.value === '' ? null : e.target.value }))}
          >
            <option value="">Untyped</option>
            {card.typeId != null && !types.some((t) => t.id === card.typeId) && (
              <option value={card.typeId}>⚠ missing type</option>
            )}
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      )}
      {tags.length > 0 && (
        <div className="field">
          <span className="dz-field-label">Tags</span>
          <div className="row wrap" style={{ gap: 6 }}>
            {tags.map((t) => {
              const on = cardTags.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  className={on ? 'btn btn-small btn-primary' : 'btn btn-small'}
                  aria-pressed={on}
                  onClick={() => toggleTag(t.id)}
                >
                  {on ? '✓ ' : ''}{t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function NumberField({ label, value, onCommit }: {
  label: string;
  value: number;
  onCommit: (n: number) => void;
}) {
  // Raw text kept while focused so clearing/typing "-" doesn't snap back.
  const [text, setText] = useState<string | null>(null);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        className="input"
        type="number"
        inputMode="decimal"
        value={text ?? String(value)}
        onFocus={() => setText(String(value))}
        onChange={(e) => {
          setText(e.target.value);
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) onCommit(n);
        }}
        onBlur={() => setText(null)}
      />
    </label>
  );
}

function ImageFieldInput({ label, value, onCommit }: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const isBig = value.startsWith('data:') && value.length > BIG_IMAGE_CHARS;

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') onCommit(reader.result);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <div className="field">
      <span className="dz-field-label">{label}</span>
      <div className="dz-image-row">
        <input
          className="input"
          value={value}
          placeholder="https://… or upload below"
          onChange={(e) => onCommit(e.target.value)}
        />
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>Upload</button>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
      </div>
      {isBig && (
        <span className="chip warn">
          Large image (~{Math.round((value.length * 0.75) / 1024)} KB) — big images bloat device storage.
        </span>
      )}
    </div>
  );
}
