/**
 * Full-screen overlays and transient surfaces: the hotseat pass-device
 * curtain, game-over screen, log drawer, announcement snackbar, script-error
 * banner, and the fatal error screen.
 */
import { useEffect, useRef } from 'react';
import type { GameDef, GameState, LogEntry } from '../shared/types';
import { formatVarValue } from './layout';

/** Opaque privacy curtain shown before revealing a different human's view. */
export function Curtain({ name, onReady }: { name: string; onReady: () => void }) {
  return (
    <div className="rn-curtain">
      <div className="rn-curtain-glyph">🂠</div>
      <h2>Pass the device to {name}</h2>
      <p className="muted">Their cards stay hidden until they're holding the device.</p>
      <button className="btn btn-primary rn-curtain-btn" onClick={onReady}>
        I'm {name} — show my cards
      </button>
    </div>
  );
}

export function GameOverOverlay({ def, state, onPlayAgain, onHome }: {
  def: GameDef;
  state: GameState;
  onPlayAgain: () => void;
  onHome: () => void;
}) {
  const result = state.result;
  if (!result) return null;
  const winnerNames = result.winners.map((id) => state.players.find((p) => p.id === id)?.name ?? id);
  const perVars = def.variables.filter((v) => v.scope === 'perPlayer');
  return (
    <div className="rn-gameover" role="dialog" aria-modal="true">
      <div className="rn-gameover-card">
        <div className="rn-go-glyph">{result.winners.length > 0 ? '🏆' : '🤝'}</div>
        <h2>{result.winners.length > 0 ? winnerNames.join(' & ') : "It's a draw"}</h2>
        <p className="muted">{result.text}</p>
        {perVars.length > 0 && (
          <div className="rn-final">
            {state.players.map((p) => (
              <div className="rn-final-row" key={p.id}>
                <span className="rn-final-name">{p.name}</span>
                <span className="rn-final-vals">
                  {perVars.map((v) => `${v.name} ${formatVarValue(p.vars[v.id])}`).join(' · ')}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="rn-sheet-row rn-go-actions">
          <button className="btn" onClick={onHome}>Home</button>
          <button className="btn btn-primary" onClick={onPlayAgain}>Play again</button>
        </div>
      </div>
    </div>
  );
}

/** Slide-over with every log entry; keeps itself scrolled to the newest. */
export function LogDrawer({ entries, onClose }: { entries: LogEntry[]; onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);
  return (
    <>
      <div className="rn-log-backdrop" onClick={onClose} />
      <aside className="rn-log" aria-label="Game log">
        <div className="rn-log-head">
          Game log
          <div className="spacer" />
          <button className="btn rn-statusbtn" onClick={onClose} aria-label="Close log">✕</button>
        </div>
        <div className="rn-log-body" ref={bodyRef}>
          {entries.length === 0 && <p className="muted">Nothing has happened yet.</p>}
          {entries.map((e, i) => (
            <div className="rn-log-entry" key={i}>
              <span className="rn-log-turn">T{e.turn}</span>
              {e.text}
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}

export function Snackbar({ text }: { text: string }) {
  return <div className="rn-snackbar" role="status">{text}</div>;
}

export function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="rn-banner" role="alert">
      <span className="rn-banner-msg">⚠ {message}</span>
      <button className="btn rn-statusbtn" onClick={onDismiss} aria-label="Dismiss error">✕</button>
    </div>
  );
}

/** Readable dead-end screen (game missing, engine failed to start). */
export function FatalScreen({ title, message, onHome, onRetry, retryLabel }: {
  title: string;
  message: string;
  onHome: () => void;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="rn-root rn-fatal">
      <div className="panel rn-fatal-card">
        <h2>{title}</h2>
        <p className="muted">{message}</p>
        <div className="rn-sheet-row">
          {onRetry && <button className="btn" onClick={onRetry}>{retryLabel ?? 'Back'}</button>}
          <button className="btn btn-primary" onClick={onHome}>Home</button>
        </div>
      </div>
    </div>
  );
}
