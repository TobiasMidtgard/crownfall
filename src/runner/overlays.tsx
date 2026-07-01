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

/** Thin-stroke geometric verdict marks (all drawn ornament is inline SVG). */
function VictoryMark() {
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M8 33 L8 15 L17 24 L24 11 L31 24 L40 15 L40 33 Z" />
        <path d="M8 38 H40" />
      </g>
    </svg>
  );
}

function DrawMark() {
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" aria-hidden="true" focusable="false">
      <g fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="18" cy="24" r="10" />
        <circle cx="30" cy="24" r="10" />
      </g>
    </svg>
  );
}

export function GameOverOverlay({ def, state, onPlayAgain, onHome, homeLabel = 'Home' }: {
  def: GameDef;
  state: GameState;
  onPlayAgain: () => void;
  onHome: () => void;
  /** Label for the leave-the-table action — hosts name the real destination. */
  homeLabel?: string;
}) {
  // Modal manners: focus lands on the card when the verdict appears (the
  // control the player last pressed is now behind aria-modal), and Tab cycles
  // inside the dialog instead of walking the obscured table.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    cardRef.current?.focus();
  }, []);
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const card = cardRef.current;
    if (!card) return;
    const focusables = Array.from(card.querySelectorAll<HTMLElement>('button:not(:disabled)'));
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    // indexOf is -1 while focus sits on the card itself (tabIndex -1): both
    // directions wrap instead of escaping.
    const idx = focusables.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey) {
      if (idx <= 0) {
        e.preventDefault();
        focusables[focusables.length - 1].focus();
      }
    } else if (idx === -1 || idx === focusables.length - 1) {
      e.preventDefault();
      focusables[0].focus();
    }
  };
  const result = state.result;
  if (!result) return null;
  const winnerNames = result.winners.map((id) => state.players.find((p) => p.id === id)?.name ?? id);
  const perVars = def.variables.filter((v) => v.scope === 'perPlayer');
  return (
    <div
      className="rn-gameover"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rn-go-title"
      onKeyDown={trapTab}
    >
      <div className="rn-gameover-card" tabIndex={-1} ref={cardRef}>
        <div className="rn-go-glyph">{result.winners.length > 0 ? <VictoryMark /> : <DrawMark />}</div>
        <h2 id="rn-go-title">{result.winners.length > 0 ? winnerNames.join(' & ') : "It's a draw"}</h2>
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
          <button className="btn" onClick={onHome}>{homeLabel}</button>
          <button className="btn btn-primary" onClick={onPlayAgain}>Play again</button>
        </div>
      </div>
    </div>
  );
}

/** Slide-over with every log entry; keeps itself scrolled to the newest. */
export function LogDrawer({ entries, onClose }: { entries: LogEntry[]; onClose: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  // Take focus on open (so Escape works immediately) and hand it back to the
  // opener — the status-bar Log button — on close.
  useEffect(() => {
    const opener = document.activeElement;
    drawerRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length]);
  return (
    <>
      <div className="rn-log-backdrop" onClick={onClose} />
      <aside
        className="rn-log"
        aria-label="Game log"
        tabIndex={-1}
        ref={drawerRef}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
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

/**
 * Announcement pill for new log entries. The role=status container stays
 * permanently mounted (a live region must exist BEFORE its content changes
 * for screen readers to announce reliably — inserting a region already
 * holding text is routinely dropped); only the styled pill inside comes and
 * goes, keyed per message so the entry animation replays.
 */
export function Snackbar({ text, seq }: { text: string; seq: number }) {
  return (
    <div className="rn-snackwrap" role="status">
      {text !== '' && <div className="rn-snackbar" key={seq}>{text}</div>}
    </div>
  );
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
export function FatalScreen({ title, message, onHome, onRetry, retryLabel, homeLabel = 'Home' }: {
  title: string;
  message: string;
  onHome: () => void;
  onRetry?: () => void;
  retryLabel?: string;
  /** Label for the leave-the-table action — hosts name the real destination. */
  homeLabel?: string;
}) {
  return (
    <div className="rn-root rn-fatal">
      <div className="panel rn-fatal-card">
        <h2>{title}</h2>
        <p className="muted">{message}</p>
        <div className="rn-sheet-row">
          {onRetry && <button className="btn" onClick={onRetry}>{retryLabel ?? 'Back'}</button>}
          <button className="btn btn-primary" onClick={onHome}>{homeLabel}</button>
        </div>
      </div>
    </div>
  );
}
