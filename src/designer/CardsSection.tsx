/**
 * CardsSection — toolbar (template filter, name/type-line search, add card,
 * count) + card grid; tapping a card opens the CardEditorModal.
 */
import { useState } from 'react';
import type { GameDef } from '../shared/types';
import { newCard } from '../shared/defaults';
import { CardView } from '../components/CardView';
import { CardEditorModal } from './CardEditorModal';
import { cardPreview } from './designerUtils';

export function CardsSection({ def, onChange, onGoTemplates }: {
  def: GameDef;
  onChange: (def: GameDef) => void;
  /** Switch to the Templates sub-section (for the no-templates empty state). */
  onGoTemplates: () => void;
}) {
  const [filter, setFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const types = def.cardTypes ?? [];
  const tags = def.cardTags ?? [];
  const q = query.trim().toLowerCase();
  const byTemplate = filter === 'all' ? def.cards : def.cards.filter((c) => c.templateId === filter);
  // Search matches the card name or its type line (type + tag names),
  // same idiom as the setup screen's kingdom picker.
  const filtered = q === '' ? byTemplate : byTemplate.filter((c) =>
    c.name.toLowerCase().includes(q)
    || types.some((t) => t.id === c.typeId && t.name.toLowerCase().includes(q))
    || (c.tags ?? []).some((id) => tags.some((t) => t.id === id && t.name.toLowerCase().includes(q))));
  const total = def.cards.length;
  const summary = filter === 'all' && q === ''
    ? `${total} card${total === 1 ? '' : 's'}`
    : `${filtered.length} of ${total} card${total === 1 ? '' : 's'}`;

  const addCard = () => {
    const tpl = (filter !== 'all' ? def.templates.find((t) => t.id === filter) : undefined)
      ?? def.templates[0];
    if (!tpl) return;
    const card = newCard(tpl);
    onChange({ ...def, cards: [...def.cards, card] });
    setEditingId(card.id);
  };

  if (def.templates.length === 0) {
    return (
      <div className="empty-state">
        <p>Cards need a template first.</p>
        <p className="faint">A template defines a card&#39;s look and its data fields.</p>
        <button type="button" className="btn btn-primary" onClick={onGoTemplates}>Create a template</button>
      </div>
    );
  }

  return (
    <div className="dz-section">
      <div className="row wrap dz-cards-toolbar">
        <select
          className="select dz-filter-select"
          value={filter}
          aria-label="Filter by template"
          onChange={(e) => setFilter(e.target.value)}
        >
          <option value="all">All templates</option>
          {def.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input
          className="input dz-card-search"
          type="search"
          placeholder={`Search ${total} card${total === 1 ? '' : 's'}…`}
          aria-label="Search cards by name or type line"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="chip">{summary}</span>
        <span className="spacer" />
        <button type="button" className="btn btn-primary" onClick={addCard}>+ Add card</button>
      </div>

      {filtered.length === 0 ? (
        <div className="empty-state">
          {q !== '' ? (
            <>
              <p>Nothing matches &ldquo;{query.trim()}&rdquo;.</p>
              <button type="button" className="btn" onClick={() => setQuery('')}>Clear search</button>
            </>
          ) : (
            <>
              <p>{filter === 'all' ? 'No cards yet.' : 'No cards use this template.'}</p>
              <button type="button" className="btn btn-primary" onClick={addCard}>+ Add card</button>
            </>
          )}
        </div>
      ) : (
        <div className="dz-card-grid">
          {filtered.map((c) => (
            <button key={c.id} type="button" className="dz-card-tile" onClick={() => setEditingId(c.id)}>
              <CardView
                card={cardPreview(c)}
                template={def.templates.find((t) => t.id === c.templateId) ?? null}
                width={120}
              />
              <span className="dz-card-tile-name">{c.name}</span>
            </button>
          ))}
        </div>
      )}

      {editingId !== null && (
        <CardEditorModal
          def={def}
          cardId={editingId}
          onChange={onChange}
          onClose={() => setEditingId(null)}
          onSwitchCard={setEditingId}
        />
      )}
    </div>
  );
}
