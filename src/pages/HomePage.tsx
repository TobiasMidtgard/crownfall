/**
 * HomePage — your games + built-in examples, new/import/export/delete.
 */
import { useRef, useState } from 'react';
import { exampleGames } from '../examples';
import { newGameDef } from '../shared/defaults';
import type { GameDef } from '../shared/types';
import { exportGame, parseImportedGame } from '../storage/storage';
import { cloneGame, deleteGame, saveGame, useStorageOk, useUserGames } from '../state/store';

export function HomePage({ navigate }: { navigate: (hash: string) => void }) {
  const games = useUserGames();
  const storageOk = useStorageOk();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<GameDef | null>(null);

  const createGame = () => {
    const def = newGameDef();
    saveGame(def);
    navigate(`#/edit/${def.meta.id}`);
  };

  const onImportFile = async (file: File) => {
    try {
      const def = parseImportedGame(await file.text());
      // Imported file may collide with an existing id; re-home it as a copy.
      if (games.some((g) => g.meta.id === def.meta.id) || exampleGames.some((g) => g.meta.id === def.meta.id)) {
        cloneGame(def);
      } else {
        def.meta.builtIn = false;
        saveGame(def);
      }
      setImportError(null);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not read that file.');
    }
  };

  return (
    <div className="page">
      {!storageOk && (
        <div className="panel" style={{ borderColor: 'var(--warning)', marginBottom: 16 }}>
          ⚠ Changes could not be saved to this device (storage is full). Export your games to files to keep them safe.
        </div>
      )}

      <div className="row" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Your games</h1>
        <div className="spacer" />
        <button className="btn" onClick={() => fileRef.current?.click()}>Import</button>
        <button className="btn btn-primary" onClick={createGame}>+ New game</button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onImportFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {importError && <p style={{ color: 'var(--danger)' }}>{importError}</p>}

      {games.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: '1.05rem', fontWeight: 600 }}>No games yet</p>
          <p>Create a game from scratch, or open an example below and hit “Clone &amp; edit” to see how it’s built.</p>
          <button className="btn btn-primary" onClick={createGame}>Create your first game</button>
        </div>
      ) : (
        <div className="game-grid">
          {games.map((g) => (
            <GameTile
              key={g.meta.id}
              game={g}
              onPlay={() => navigate(`#/play/${g.meta.id}`)}
              onEdit={() => navigate(`#/edit/${g.meta.id}`)}
              onExport={() => exportGame(g)}
              onDelete={() => setConfirmDelete(g)}
            />
          ))}
        </div>
      )}

      <h2 style={{ margin: '28px 0 12px' }}>Example games</h2>
      <p className="muted" style={{ marginTop: -8 }}>
        Built with the same blocks you have — open one to learn, clone it to remix.
      </p>
      <div className="game-grid">
        {exampleGames.map((g) => (
          <GameTile
            key={g.meta.id}
            game={g}
            onPlay={() => navigate(`#/play/${g.meta.id}`)}
            onEdit={() => navigate(`#/edit/${g.meta.id}`)}
            onClone={() => {
              const copy = cloneGame(g);
              navigate(`#/edit/${copy.meta.id}`);
            }}
          />
        ))}
      </div>

      {confirmDelete && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">Delete “{confirmDelete.meta.name}”?</div>
            <div className="modal-body">
              This permanently removes the game and all its cards from this device.
            </div>
            <div className="modal-footer">
              <button className="btn" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button
                className="btn btn-danger"
                onClick={() => { deleteGame(confirmDelete.meta.id); setConfirmDelete(null); }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GameTile({ game, onPlay, onEdit, onExport, onDelete, onClone }: {
  game: GameDef;
  onPlay: () => void;
  onEdit: () => void;
  onExport?: () => void;
  onDelete?: () => void;
  onClone?: () => void;
}) {
  const players = game.meta.minPlayers === game.meta.maxPlayers
    ? `${game.meta.minPlayers}p`
    : `${game.meta.minPlayers}–${game.meta.maxPlayers}p`;
  return (
    <div className="game-tile" role="group">
      <div className="row">
        <h3 style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {game.meta.name}
        </h3>
        <span className="chip">{players}</span>
        {game.meta.builtIn && <span className="chip accent">example</span>}
      </div>
      <div className="desc">{game.meta.description || 'No description.'}</div>
      <div className="row wrap">
        <button className="btn btn-small btn-primary" onClick={onPlay}>▶ Play</button>
        <button className="btn btn-small" onClick={onEdit}>{game.meta.builtIn ? 'View' : 'Edit'}</button>
        {onClone && <button className="btn btn-small" onClick={onClone}>Clone &amp; edit</button>}
        {onExport && <button className="btn btn-small btn-ghost" onClick={onExport}>Export</button>}
        {onDelete && <button className="btn btn-small btn-ghost" style={{ color: 'var(--danger)' }} onClick={onDelete}>Delete</button>}
      </div>
    </div>
  );
}
