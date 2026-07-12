/**
 * Pre-game setup: validation gate (errors block, warnings collapse), seat
 * configuration (count stepper, names, Human/AI toggles), and a reproducible
 * random seed with a reroll button.
 */
import { useState } from 'react';
import type { GameDef, ValidationIssue } from '../shared/types';
import { rollSeed } from './layout';
import type { SeatSetup } from './session';

function makeSeats(count: number, prev: SeatSetup[] = []): SeatSetup[] {
  // Seat 0 defaults to the (presumably present) human; extra seats to AI.
  return Array.from({ length: count }, (_, i) => prev[i] ?? { name: `Player ${i + 1}`, isAI: i !== 0 });
}

/** PlayPage's online-matchmaking status, rendered inside the setup screen. */
export type OnlineStatus =
  | { mode: 'hosting'; code: string }
  | { mode: 'joining' }
  | { mode: 'error'; message: string };

export function SetupScreen({ def, issues, navigate, onStart, online, onHost, onJoin, onCancelOnline }: {
  def: GameDef;
  issues: ValidationIssue[];
  navigate: (hash: string) => void;
  onStart: (seats: SeatSetup[], seed: number) => void;
  /** Current online-matchmaking state (null = idle). */
  online?: OnlineStatus | null;
  /** Open a room: this device becomes seat 1, a joiner becomes seat 2. */
  onHost?: (hostName: string, seed: number) => void;
  /** Join a room by its code. */
  onJoin?: (code: string, guestName: string) => void;
  onCancelOnline?: () => void;
}) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const minP = Math.max(1, def.meta.minPlayers);
  const maxP = Math.max(minP, def.meta.maxPlayers);
  const [seats, setSeats] = useState<SeatSetup[]>(() => makeSeats(Math.min(Math.max(minP, 2), maxP)));
  const [seed, setSeed] = useState(rollSeed);
  const [showWarnings, setShowWarnings] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const allAI = seats.every((s) => s.isAI);
  const myName = (seats[0]?.name ?? '').trim() || 'Player 1';
  const onlineCapable = onHost !== undefined && onJoin !== undefined
    && errors.length === 0 && minP <= 2 && maxP >= 2;

  const setCount = (n: number) => {
    const next = Math.min(maxP, Math.max(minP, n));
    setSeats((prev) => makeSeats(next, prev));
  };
  const updateSeat = (i: number, patch: Partial<SeatSetup>) => {
    setSeats((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  };
  const start = () => {
    onStart(seats.map((s, i) => ({ ...s, name: s.name.trim() || `Player ${i + 1}` })), seed);
  };

  return (
    <div className="rn-setup">
      <div className="page">
        <div className="row" style={{ marginBottom: 10 }}>
          <button className="btn btn-ghost" onClick={() => navigate('#/')}>← Home</button>
        </div>
        <h1 style={{ marginBottom: 4 }}>{def.meta.name.trim() || 'Untitled game'}</h1>
        {def.meta.description && <p className="muted">{def.meta.description}</p>}
        <p className="faint" style={{ marginBottom: 16 }}>
          {minP === maxP ? `${minP} players` : `${minP}–${maxP} players`}
        </p>

        {errors.length > 0 && (
          <div className="panel rn-issues" style={{ borderColor: 'var(--danger)', marginBottom: 14 }}>
            <h3 style={{ color: 'var(--danger)' }}>This game can't start yet</h3>
            <ul>
              {errors.map((e, i) => (
                <li key={i}><span className="rn-issue-where">{e.where}:</span> {e.message}</li>
              ))}
            </ul>
            <button className="btn" onClick={() => navigate(`#/edit/${def.meta.id}`)}>Open in editor</button>
          </div>
        )}

        {warnings.length > 0 && (
          <div className="panel rn-issues" style={{ borderColor: 'var(--warning)', marginBottom: 14, padding: 8 }}>
            <button
              className="btn btn-ghost"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              aria-expanded={showWarnings}
              onClick={() => setShowWarnings((v) => !v)}
            >
              {showWarnings ? '▾' : '▸'} ⚠ {warnings.length} warning{warnings.length === 1 ? '' : 's'} — playable anyway
            </button>
            {showWarnings && (
              <ul>
                {warnings.map((w, i) => (
                  <li key={i}><span className="rn-issue-where">{w.where}:</span> {w.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="panel" style={{ marginBottom: 14 }}>
          <label className="field" style={{ marginBottom: 6 }}><span>Players</span></label>
          <div className="rn-stepper">
            <button
              className="btn"
              onClick={() => setCount(seats.length - 1)}
              disabled={seats.length <= minP}
              aria-label="Fewer players"
            >
              −
            </button>
            <span className="rn-stepper-num">{seats.length}</span>
            <button
              className="btn"
              onClick={() => setCount(seats.length + 1)}
              disabled={seats.length >= maxP}
              aria-label="More players"
            >
              +
            </button>
          </div>
          {seats.map((s, i) => (
            <div className="rn-seat" key={i}>
              <input
                className="input"
                value={s.name}
                maxLength={20}
                placeholder={`Player ${i + 1}`}
                aria-label={`Player ${i + 1} name`}
                onChange={(e) => updateSeat(i, { name: e.target.value })}
              />
              <div className="rn-seg" role="group" aria-label={`Player ${i + 1} controller`}>
                <button className={s.isAI ? '' : 'rn-active'} onClick={() => updateSeat(i, { isAI: false })}>
                  Human
                </button>
                <button className={s.isAI ? 'rn-active' : ''} onClick={() => updateSeat(i, { isAI: true })}>
                  AI
                </button>
              </div>
            </div>
          ))}
          {allAI && (
            <p className="faint" style={{ marginTop: 6 }}>All seats are AI — you'll be spectating.</p>
          )}
        </div>

        <div className="panel" style={{ marginBottom: 14 }}>
          <label className="field" style={{ marginBottom: 4 }}><span>Random seed</span></label>
          <div className="row">
            <span className="rn-seed">{seed}</span>
            <div className="spacer" />
            <button className="btn" onClick={() => setSeed(rollSeed())}>🎲 Reroll</button>
          </div>
          <p className="faint" style={{ margin: '6px 0 0' }}>Same seed, same shuffles — handy for replays.</p>
        </div>

        <button className="btn btn-primary rn-start" disabled={errors.length > 0} onClick={start}>
          {allAI ? '▶ Watch the AIs play' : '▶ Start game'}
        </button>

        {onlineCapable && (
          <div className="panel" style={{ marginTop: 14 }}>
            <label className="field" style={{ marginBottom: 4 }}><span>Play online</span></label>
            {online == null && (
              <>
                <p className="faint" style={{ margin: '0 0 10px' }}>
                  Two devices, one table: host a room and share its code, or join with
                  a code. You play as "{myName}" (seat 1's name above). Peer-to-peer —
                  no account, no server.
                </p>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={() => onHost!(myName, seed)}>
                    🌐 Host a room
                  </button>
                  <div className="spacer" />
                  <input
                    className="input"
                    style={{ width: 130, textTransform: 'uppercase' }}
                    value={joinCode}
                    maxLength={6}
                    placeholder="CODE"
                    aria-label="Room code"
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  />
                  <button
                    className="btn"
                    disabled={joinCode.trim().length < 6}
                    onClick={() => onJoin!(joinCode.trim(), myName)}
                  >
                    Join
                  </button>
                </div>
              </>
            )}
            {online?.mode === 'hosting' && (
              <div>
                <p style={{ margin: '0 0 6px' }}>
                  Room open — share this code:{' '}
                  <strong className="rn-seed" style={{ fontSize: '1.4rem', letterSpacing: '0.2em' }}>
                    {online.code}
                  </strong>
                </p>
                <p className="faint" style={{ margin: '0 0 10px' }}>
                  Waiting for a challenger… the game starts the moment they join.
                </p>
                <button className="btn" onClick={onCancelOnline}>Cancel</button>
              </div>
            )}
            {online?.mode === 'joining' && (
              <div>
                <p style={{ margin: '0 0 10px' }}>Reaching the host's table…</p>
                <button className="btn" onClick={onCancelOnline}>Cancel</button>
              </div>
            )}
            {online?.mode === 'error' && (
              <div>
                <p style={{ margin: '0 0 10px', color: 'var(--danger)' }}>{online.message}</p>
                <button className="btn" onClick={onCancelOnline}>Back</button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
