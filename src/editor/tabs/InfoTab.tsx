/**
 * InfoTab — game metadata (name, description, players, accent color),
 * the deck manager, and JSON export.
 */
import { useState } from 'react';
import type { DeckDef, DeckSource, GameDef } from '../../shared/types';
import { newDeck } from '../../shared/defaults';
import { exportGame } from '../../storage/storage';
import { ConfirmModal } from '../common/Modal';
import { removeAt, updateAt } from '../lib';

const RANK_LABELS: [number, string][] = [
  [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7'], [8, '8'],
  [9, '9'], [10, '10'], [11, 'J'], [12, 'Q'], [13, 'K'], [14, 'A'],
];

export function InfoTab({ def, onChange }: { def: GameDef; onChange: (def: GameDef) => void }) {
  const meta = def.meta;
  const setMeta = (patch: Partial<GameDef['meta']>) => onChange({ ...def, meta: { ...meta, ...patch } });

  return (
    <div>
      <div className="panel ed-section">
        <h2>Game info</h2>
        <label className="field">
          <span>Name</span>
          <input type="text" className="input" value={meta.name} onChange={(e) => setMeta({ name: e.target.value })} />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea
            className="input"
            value={meta.description}
            placeholder="How is it played? What's the goal?"
            onChange={(e) => setMeta({ description: e.target.value })}
          />
        </label>
        <div className="ed-grid">
          <label className="field">
            <span>Min players</span>
            <input
              type="number" className="input" min={1} max={8}
              value={meta.minPlayers}
              onChange={(e) => setMeta({ minPlayers: clampPlayers(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Max players</span>
            <input
              type="number" className="input" min={1} max={8}
              value={meta.maxPlayers}
              onChange={(e) => setMeta({ maxPlayers: clampPlayers(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Accent color</span>
            <div className="row">
              <input
                type="color"
                className="ed-color-input"
                value={normalizeColor(meta.accentColor)}
                onChange={(e) => setMeta({ accentColor: e.target.value })}
                aria-label="Accent color picker"
              />
              <input
                type="text"
                className="input"
                value={meta.accentColor ?? ''}
                placeholder="#7c5cff"
                onChange={(e) => setMeta({ accentColor: e.target.value })}
              />
            </div>
          </label>
        </div>
        <button type="button" className="btn" onClick={() => exportGame(def)}>⇩ Export game file</button>
      </div>

      <div className="panel ed-section">
        <div className="row" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Decks</h2>
          <div className="spacer" />
          <button
            type="button"
            className="btn"
            onClick={() => onChange({ ...def, decks: [...def.decks, newDeck(def.zones[0]?.id ?? '')] })}
          >
            + Add deck
          </button>
        </div>
        <p className="faint">Decks spawn into their starting zone when a game begins.</p>
        {def.decks.length === 0 && <p className="muted">No decks — the table starts empty.</p>}
        {def.decks.map((deck, i) => (
          <DeckEditor
            key={deck.id}
            def={def}
            deck={deck}
            onChange={(d) => onChange({ ...def, decks: updateAt(def.decks, i, d) })}
            onDelete={() => onChange({ ...def, decks: removeAt(def.decks, i) })}
          />
        ))}
      </div>
    </div>
  );
}

function clampPlayers(raw: string): number {
  const n = Math.round(Number(raw) || 1);
  return Math.max(1, Math.min(8, n));
}

function normalizeColor(c: string | undefined): string {
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#7c5cff';
}

function DeckEditor({ def, deck, onChange, onDelete }: {
  def: GameDef;
  deck: DeckDef;
  onChange: (deck: DeckDef) => void;
  onDelete: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const src = deck.source;
  const initialZone = def.zones.find((z) => z.id === deck.initialZone);

  const setSourceKind = (kind: DeckSource['kind']) => {
    if (kind === src.kind) return;
    onChange({ ...deck, source: kind === 'standard52' ? { kind: 'standard52' } : { kind: 'custom', entries: [] } });
  };

  return (
    <div className="ed-item">
      <div className="row" style={{ marginBottom: 10 }}>
        <input
          type="text"
          className="input ed-item-name"
          value={deck.name}
          aria-label="Deck name"
          onChange={(e) => onChange({ ...deck, name: e.target.value })}
        />
        <button type="button" className="btn btn-small btn-ghost ed-delete" onClick={() => setConfirming(true)} aria-label="Delete deck">✕</button>
      </div>

      <div className="ed-seg" role="group" aria-label="Deck source">
        <button
          type="button"
          className={src.kind === 'standard52' ? 'ed-seg-btn active' : 'ed-seg-btn'}
          onClick={() => setSourceKind('standard52')}
        >
          Standard 52 cards
        </button>
        <button
          type="button"
          className={src.kind === 'custom' ? 'ed-seg-btn active' : 'ed-seg-btn'}
          onClick={() => setSourceKind('custom')}
        >
          Custom cards
        </button>
      </div>

      {src.kind === 'standard52' && (
        <>
          <label className="field" style={{ maxWidth: 200 }}>
            <span>Jokers</span>
            <input
              type="number" className="input" min={0} max={8}
              value={src.jokers ?? 0}
              onChange={(e) => {
                const jokers = Math.max(0, Math.min(8, Math.round(Number(e.target.value) || 0)));
                onChange({ ...deck, source: { ...src, jokers: jokers || undefined } });
              }}
            />
          </label>
          <div className="field">
            <span className="ed-mini-label">Excluded ranks (tap to remove from the deck)</span>
            <div className="row wrap">
              {RANK_LABELS.map(([rank, label]) => {
                const excluded = src.excludeRanks?.includes(rank) ?? false;
                return (
                  <button
                    key={rank}
                    type="button"
                    className={excluded ? 'ed-rank-chip excluded' : 'ed-rank-chip'}
                    aria-pressed={excluded}
                    onClick={() => {
                      const prev = src.excludeRanks ?? [];
                      const next = excluded ? prev.filter((r) => r !== rank) : [...prev, rank].sort((a, b) => a - b);
                      onChange({ ...deck, source: { ...src, excludeRanks: next.length ? next : undefined } });
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {src.kind === 'custom' && (
        <div className="field">
          <span className="ed-mini-label">Cards in this deck</span>
          {def.cards.length === 0 ? (
            <p className="faint">No custom cards yet — design some in the Cards tab first.</p>
          ) : (
            <>
              {src.entries.map((entry, i) => (
                <div className="ed-subrow" key={i}>
                  <select
                    className="select"
                    value={entry.cardId}
                    onChange={(e) => onChange({
                      ...deck,
                      source: { ...src, entries: updateAt(src.entries, i, { ...entry, cardId: e.target.value }) },
                    })}
                  >
                    {!def.cards.some((c) => c.id === entry.cardId) && <option value={entry.cardId}>⚠ missing card</option>}
                    {def.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <input
                    type="number"
                    className="input ed-num-input"
                    min={1}
                    aria-label="Copies"
                    value={entry.count}
                    onChange={(e) => onChange({
                      ...deck,
                      source: {
                        ...src,
                        entries: updateAt(src.entries, i, { ...entry, count: Math.max(1, Math.round(Number(e.target.value) || 1)) }),
                      },
                    })}
                  />
                  <button
                    type="button"
                    className="btn btn-small btn-ghost"
                    aria-label="Remove card entry"
                    onClick={() => onChange({ ...deck, source: { ...src, entries: removeAt(src.entries, i) } })}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn"
                onClick={() => onChange({
                  ...deck,
                  source: { ...src, entries: [...src.entries, { cardId: def.cards[0].id, count: 1 }] },
                })}
              >
                + Add card
              </button>
            </>
          )}
        </div>
      )}

      <div className="ed-grid" style={{ marginTop: 10 }}>
        <label className="field">
          <span>Starts in zone</span>
          <select
            className="select"
            value={deck.initialZone}
            onChange={(e) => onChange({ ...deck, initialZone: e.target.value })}
          >
            {!initialZone && <option value={deck.initialZone}>⚠ missing zone</option>}
            {def.zones.map((z) => (
              <option key={z.id} value={z.id}>{z.name}{z.owner === 'perPlayer' ? ' (per player)' : ''}</option>
            ))}
          </select>
        </label>
        <label className="ed-check">
          <input
            type="checkbox"
            checked={deck.shuffle}
            onChange={(e) => onChange({ ...deck, shuffle: e.target.checked })}
          />
          <span>Shuffle after spawning</span>
        </label>
      </div>
      {initialZone?.owner === 'perPlayer' && (
        <p className="faint">This zone is per player — every player receives a full copy of the deck.</p>
      )}

      {confirming && (
        <ConfirmModal
          title={`Delete deck "${deck.name}"?`}
          message="The deck definition is removed; zones and scripts are untouched."
          onConfirm={() => { setConfirming(false); onDelete(); }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  );
}
