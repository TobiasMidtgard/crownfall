/**
 * TypesTab — the card vocabulary: primary TYPES (one per card, drives the
 * accent color) and TAGS (any number per card, the rest of the type line).
 * Mirrors the Variables tab's list idiom. Deleting a referenced type/tag
 * warns with the reference counts and requires a confirm; confirming clears
 * card assignments (typeId -> null, tag removed from lists) while conditions
 * that still check the deleted id surface as errors in the Issues list.
 */
import { useState } from 'react';
import type { CardTypeDef, GameDef, TagDef } from '../../shared/types';
import { uid } from '../../shared/defaults';
import { ConfirmModal } from '../common/Modal';
import { removeAt, updateAt } from '../lib';

/** Deep-scan any JSON value for expr nodes `{ kind, [idField]: id }`. */
export function countExprRefs(value: unknown, kind: string, idField: string, id: string): number {
  let n = 0;
  const walk = (v: unknown): void => {
    if (!v || typeof v !== 'object') return;
    if (!Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      if (o.kind === kind && o[idField] === id) n += 1;
    }
    for (const child of Object.values(v)) walk(child);
  };
  walk(value);
  return n;
}

type PendingDelete =
  | { kind: 'type'; id: string; name: string; cards: number; conditions: number }
  | { kind: 'tag'; id: string; name: string; cards: number; conditions: number };

export function TypesTab({ def, onChange }: { def: GameDef; onChange: (def: GameDef) => void }) {
  const types = def.cardTypes ?? [];
  const tags = def.cardTags ?? [];
  const [pending, setPending] = useState<PendingDelete | null>(null);

  const updateType = (i: number, t: CardTypeDef) => onChange({ ...def, cardTypes: updateAt(types, i, t) });
  const updateTag = (i: number, t: TagDef) => onChange({ ...def, cardTags: updateAt(tags, i, t) });

  const deleteType = (id: string) => onChange({
    ...def,
    cardTypes: types.filter((t) => t.id !== id),
    cards: def.cards.map((c) => (c.typeId === id ? { ...c, typeId: null } : c)),
  });
  const deleteTag = (id: string) => onChange({
    ...def,
    cardTags: tags.filter((t) => t.id !== id),
    cards: def.cards.map((c) => (c.tags?.includes(id) ? { ...c, tags: c.tags.filter((x) => x !== id) } : c)),
  });

  const requestDeleteType = (t: CardTypeDef, i: number) => {
    const cards = def.cards.filter((c) => c.typeId === t.id).length;
    const conditions = countExprRefs(def, 'cardTypeIs', 'typeId', t.id);
    if (cards === 0 && conditions === 0) onChange({ ...def, cardTypes: removeAt(types, i) });
    else setPending({ kind: 'type', id: t.id, name: t.name, cards, conditions });
  };
  const requestDeleteTag = (t: TagDef, i: number) => {
    const cards = def.cards.filter((c) => c.tags?.includes(t.id)).length;
    const conditions = countExprRefs(def, 'cardHasTag', 'tagId', t.id);
    if (cards === 0 && conditions === 0) onChange({ ...def, cardTags: removeAt(tags, i) });
    else setPending({ kind: 'tag', id: t.id, name: t.name, cards, conditions });
  };

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>Card types</h2>
        <div className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={() => onChange({ ...def, cardTypes: [...types, { id: uid('ctype'), name: 'New type', color: '#7c5cff' }] })}
        >
          + Add type
        </button>
      </div>
      <p className="faint">
        A card has exactly ONE type — its category and accent color (Treasure, Victory, Action…).
        Assign it on each card in the Cards tab; check it anywhere with the “card is a type” condition.
      </p>

      {types.length === 0 && <p className="muted">No card types yet.</p>}

      {types.map((t, i) => (
        <div className="ed-item" key={t.id}>
          <div className="row" style={{ gap: 8 }}>
            <input
              type="color"
              value={t.color}
              aria-label={`Color of type ${t.name}`}
              title="Accent color"
              style={{ width: 44, height: 34, padding: 2, border: 'none', background: 'transparent', cursor: 'pointer' }}
              onChange={(e) => updateType(i, { ...t, color: e.target.value })}
            />
            <input
              type="text"
              className="input ed-item-name"
              value={t.name}
              aria-label="Type name"
              onChange={(e) => updateType(i, { ...t, name: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-small btn-ghost ed-delete"
              aria-label={`Delete type ${t.name}`}
              onClick={() => requestDeleteType(t, i)}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      <div className="row" style={{ margin: '24px 0 12px' }}>
        <h2 style={{ margin: 0 }}>Tags</h2>
        <div className="spacer" />
        <button
          type="button"
          className="btn"
          onClick={() => onChange({ ...def, cardTags: [...tags, { id: uid('ctag'), name: 'New tag' }] })}
        >
          + Add tag
        </button>
      </div>
      <p className="faint">
        A card can carry ANY number of tags — the rest of its type line (Attack, Reaction, Kingdom…).
        Check them with the “card has tag” condition.
      </p>

      {tags.length === 0 && <p className="muted">No tags yet.</p>}

      {tags.map((t, i) => (
        <div className="ed-item" key={t.id}>
          <div className="row">
            <input
              type="text"
              className="input ed-item-name"
              value={t.name}
              aria-label="Tag name"
              onChange={(e) => updateTag(i, { ...t, name: e.target.value })}
            />
            <button
              type="button"
              className="btn btn-small btn-ghost ed-delete"
              aria-label={`Delete tag ${t.name}`}
              onClick={() => requestDeleteTag(t, i)}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      {pending && (
        <ConfirmModal
          title={pending.kind === 'type' ? `Delete type "${pending.name}"?` : `Delete tag "${pending.name}"?`}
          confirmLabel="Delete anyway"
          message={(
            <>
              <p>
                {pending.cards > 0 && (
                  <>
                    <strong>{pending.cards}</strong> card{pending.cards === 1 ? '' : 's'} {pending.cards === 1 ? 'uses' : 'use'} this {pending.kind}
                    {pending.conditions > 0 ? ' and ' : '. '}
                  </>
                )}
                {pending.conditions > 0 && (
                  <>
                    <strong>{pending.conditions}</strong> condition{pending.conditions === 1 ? '' : 's'} check{pending.conditions === 1 ? 's' : ''} it.
                  </>
                )}
              </p>
              <p className="faint">
                Deleting {pending.kind === 'type' ? 'clears the type from those cards' : 'removes the tag from those cards'}
                {pending.conditions > 0 && ' — the conditions will show as errors in the Issues list until you rebuild them'}.
              </p>
            </>
          )}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            if (pending.kind === 'type') deleteType(pending.id);
            else deleteTag(pending.id);
            setPending(null);
          }}
        />
      )}
    </div>
  );
}
