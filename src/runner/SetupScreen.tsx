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

export function SetupScreen({ def, issues, navigate, onStart }: {
  def: GameDef;
  issues: ValidationIssue[];
  navigate: (hash: string) => void;
  onStart: (seats: SeatSetup[], seed: number) => void;
}) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const minP = Math.max(1, def.meta.minPlayers);
  const maxP = Math.max(minP, def.meta.maxPlayers);
  const [seats, setSeats] = useState<SeatSetup[]>(() => makeSeats(Math.min(Math.max(minP, 2), maxP)));
  const [seed, setSeed] = useState(rollSeed);
  const [showWarnings, setShowWarnings] = useState(false);
  const allAI = seats.every((s) => s.isAI);

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
      </div>
    </div>
  );
}
