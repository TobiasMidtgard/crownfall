/**
 * Pre-game setup: validation gate (errors block, warnings collapse), seat
 * configuration (count stepper, names, Human/AI toggles), and a reproducible
 * random seed with a reroll button.
 */
import { useEffect, useState } from 'react';
import type { GameDef, ValidationIssue } from '../shared/types';
import type { KingdomSet } from '../shared/kingdoms';
import { rollSeed } from './layout';
import type { SeatSetup } from './session';

/** The setup screen's Kingdom picker: catalog + presets, injected by the
 *  host page (PlayPage) for defs whose setup supports kingdom swapping. */
export interface KingdomPicker {
  /** Every pickable card: name + printed cost + type line, cost-sorted. */
  catalog: { name: string; cost: number; kind: string; expansion?: string }[];
  /** Preset sets (exactly ten names each). */
  sets: KingdomSet[];
  /** How many cards a kingdom needs (Dominion: 10). */
  size: number;
  /** The currently selected names. */
  value: string[];
  onChange: (cards: string[]) => void;
  /** Prosperity basics (Platinum & Colony) toggle — absent when the def
   *  doesn't carry them. */
  prosperity?: { value: boolean; onChange: (on: boolean) => void } | null;
  /** Landscape sideboard picker (Events / Landmarks) — absent while the
   *  def ships no landscape cards. */
  landscapes?: {
    catalog: { name: string; cost: number; kind: string; expansion?: string }[];
    value: string[];
    onChange: (names: string[]) => void;
    /** Most landscapes one table takes (the official deal: 2). */
    max: number;
  } | null;
}

function makeSeats(count: number, prev: SeatSetup[] = []): SeatSetup[] {
  // Seat 0 defaults to the (presumably present) human; extra seats to AI.
  return Array.from({ length: count }, (_, i) => prev[i] ?? { name: `Player ${i + 1}`, isAI: i !== 0 });
}

/** PlayPage's online-matchmaking status, rendered inside the setup screen. */
export type OnlineStatus =
  | { mode: 'hosting'; code: string }
  | { mode: 'joining' }
  | { mode: 'error'; message: string };

export function SetupScreen({ def, issues, navigate, onStart, online, onHost, onJoin, onCancelOnline, kingdom }: {
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
  /** Kingdom picker data (null/absent = the def has no swappable supply). */
  kingdom?: KingdomPicker | null;
}) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const minP = Math.max(1, def.meta.minPlayers);
  const maxP = Math.max(minP, def.meta.maxPlayers);
  const [seats, setSeats] = useState<SeatSetup[]>(() => makeSeats(Math.min(Math.max(minP, 2), maxP)));
  const [seed, setSeed] = useState(rollSeed);
  const [showWarnings, setShowWarnings] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [cardSearch, setCardSearch] = useState('');
  // Kingdom grid scope: one printed set, or every card ('All').
  const [expansionFilter, setExpansionFilter] = useState('All');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(t);
  }, [copied]);
  const allAI = seats.every((s) => s.isAI);
  const myName = (seats[0]?.name ?? '').trim() || 'Player 1';
  const onlineCapable = onHost !== undefined && onJoin !== undefined
    && errors.length === 0 && minP <= 2 && maxP >= 2;
  const kingdomReady = kingdom == null || kingdom.value.length === kingdom.size;
  // The def + seed ship at the host/join click, so later edits would be
  // silently discarded — lock the form (visibly) while a room is pending.
  const onlineLocked = online != null && online.mode !== 'error';
  const lockedPanel = `panel${onlineLocked ? ' rn-setup-locked' : ''}`;
  // Disabled buttons can't show title tooltips on touch — the gate reason
  // renders as visible helper text under the Start button instead.
  const startNote = onlineLocked
    ? 'The room below is open — cancel it to start a local game.'
    : errors.length > 0
      ? 'Fix the errors above to start.'
      : kingdom != null && !kingdomReady
        ? `Pick exactly ${kingdom.size} kingdom piles first — ${kingdom.value.length} chosen.`
        : null;

  const copyCode = () => {
    if (online?.mode !== 'hosting' || !navigator.clipboard) return;
    navigator.clipboard.writeText(online.code)
      .then(() => setCopied(true))
      .catch(() => undefined); // clipboard blocked — the code stays selectable
  };

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

        <div className={lockedPanel} style={{ marginBottom: 14 }}>
          <label className="field" style={{ marginBottom: 6 }}><span>Players</span></label>
          <div className="rn-stepper">
            <button
              className="btn"
              onClick={() => setCount(seats.length - 1)}
              disabled={seats.length <= minP || onlineLocked}
              aria-label="Fewer players"
            >
              −
            </button>
            <span className="rn-stepper-num">{seats.length}</span>
            <button
              className="btn"
              onClick={() => setCount(seats.length + 1)}
              disabled={seats.length >= maxP || onlineLocked}
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
                disabled={onlineLocked}
                onChange={(e) => updateSeat(i, { name: e.target.value })}
              />
              <div className="rn-seg" role="group" aria-label={`Player ${i + 1} controller`}>
                <button
                  className={s.isAI ? '' : 'rn-active'}
                  disabled={onlineLocked}
                  onClick={() => updateSeat(i, { isAI: false })}
                >
                  Human
                </button>
                <button
                  className={s.isAI ? 'rn-active' : ''}
                  disabled={onlineLocked}
                  onClick={() => updateSeat(i, { isAI: true })}
                >
                  AI
                </button>
              </div>
            </div>
          ))}
          {allAI && (
            <p className="faint" style={{ marginTop: 6 }}>All seats are AI — you'll be spectating.</p>
          )}
        </div>

        {kingdom != null && (() => {
          const picked = new Set(kingdom.value);
          const activeSet = kingdom.sets.find((s) =>
            s.cards.length === kingdom.value.length && s.cards.every((c) => picked.has(c)));
          const toggle = (name: string) => {
            if (picked.has(name)) kingdom.onChange(kingdom.value.filter((n) => n !== name));
            else if (kingdom.value.length < kingdom.size) kingdom.onChange([...kingdom.value, name]);
          };
          const randomTen = () => {
            const pool = kingdom.catalog.map((c) => c.name);
            for (let i = pool.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [pool[i], pool[j]] = [pool[j], pool[i]];
            }
            kingdom.onChange(pool.slice(0, kingdom.size).sort());
          };
          // Expansion filter chips render only when the catalog spans sets.
          const expansions = [...new Set(kingdom.catalog.map((c) => c.expansion ?? ''))]
            .filter((x) => x !== '');
          const inExpansion = (c: { expansion?: string }) =>
            expansionFilter === 'All' || (c.expansion ?? '') === expansionFilter;
          const q = cardSearch.trim().toLowerCase();
          const shown = kingdom.catalog.filter((c) => inExpansion(c)
            && (q === '' || c.name.toLowerCase().includes(q) || c.kind.toLowerCase().includes(q)));
          return (
            <div className={lockedPanel} style={{ marginBottom: 14 }}>
              <div className="row" style={{ alignItems: 'baseline', gap: 10 }}>
                <label className="field" style={{ marginBottom: 4 }}><span>Kingdom</span></label>
                <span className={`chip${kingdomReady ? '' : ' warn'}`}>
                  {kingdom.value.length} of {kingdom.size} piles
                </span>
                <div className="spacer" />
                <button className="btn" disabled={onlineLocked} onClick={randomTen}>
                  🎲 Random {kingdom.size}
                </button>
              </div>
              <div className="rn-kchips">
                {kingdom.sets.map((s) => (
                  <button
                    key={s.id}
                    className={`btn rn-kset${activeSet?.id === s.id ? ' rn-kset-on' : ''}`}
                    title={s.motto}
                    disabled={onlineLocked}
                    onClick={() => kingdom.onChange([...s.cards])}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
              {expansions.length > 1 && (
                <div className="rn-kexp" role="group" aria-label="Filter by expansion">
                  {['All', ...expansions].map((x) => (
                    <button
                      key={x}
                      className={`btn btn-small${expansionFilter === x ? ' rn-kexp-on' : ''}`}
                      aria-pressed={expansionFilter === x}
                      onClick={() => setExpansionFilter(x)}
                    >
                      {x === 'All'
                        ? `All (${kingdom.catalog.length})`
                        : `${x} (${kingdom.catalog.filter((c) => (c.expansion ?? '') === x).length})`}
                    </button>
                  ))}
                </div>
              )}
              <input
                className="input"
                style={{ margin: '8px 0' }}
                type="search"
                placeholder={`Search ${kingdom.catalog.length} cards…`}
                aria-label="Search kingdom cards"
                value={cardSearch}
                onChange={(e) => setCardSearch(e.target.value)}
              />
              <div className="rn-kgrid" role="group" aria-label="Kingdom cards">
                {shown.map((c) => {
                  const on = picked.has(c.name);
                  const full = !on && kingdom.value.length >= kingdom.size;
                  return (
                    <button
                      key={c.name}
                      className={`rn-kcard${on ? ' rn-kcard-on' : ''}`}
                      aria-pressed={on}
                      disabled={full || onlineLocked}
                      title={full ? `The kingdom already holds ${kingdom.size} piles — remove one first.` : c.kind}
                      onClick={() => toggle(c.name)}
                    >
                      <span className="rn-kcost">{c.cost}</span>
                      <span className="rn-kname">
                        {/* Non-color selected cue (hover shares the accent border). */}
                        {on && <span className="rn-kcheck" aria-hidden="true">✓ </span>}
                        {c.name}
                      </span>
                      <span className="rn-kkind">{c.kind}</span>
                    </button>
                  );
                })}
                {shown.length === 0 && <p className="faint">Nothing matches “{cardSearch}”.</p>}
              </div>
              <p className="faint" style={{ margin: '8px 0 0' }}>
                Pick a preset or build your own supply — exactly {kingdom.size} piles take the
                table. Unpicked cards wait in the reserve (the Black Market's stock).
              </p>
              {kingdom.prosperity != null && (
                <label className="rn-kprosperity">
                  <input
                    type="checkbox"
                    checked={kingdom.prosperity.value}
                    disabled={onlineLocked}
                    onChange={(e) => kingdom.prosperity?.onChange(e.target.checked)}
                  />
                  <span>
                    <strong>Prosperity basics</strong> — add Platinum (9<span aria-hidden="true">🪙</span>,
                    worth 5) and Colony (11<span aria-hidden="true">🪙</span>, 10 VP) to the supply.
                    The game also ends when the Colonies run out.
                  </span>
                </label>
              )}
              {kingdom.landscapes != null && kingdom.landscapes.catalog.length > 0 && (() => {
                const land = kingdom.landscapes;
                return (
                  <div className="rn-klandscapes">
                    <h4>
                      Landscapes
                      <span className="rn-kland-cap"> — Events buy from the sideboard, Landmarks
                        just score; pick up to {land.max}.</span>
                    </h4>
                    <div className="rn-kland-grid" role="group" aria-label="Pick landscapes">
                      {land.catalog.map((l) => {
                        const on = land.value.includes(l.name);
                        const full = !on && land.value.length >= land.max;
                        return (
                          <button
                            key={l.name}
                            type="button"
                            className={`btn btn-small rn-kland${on ? ' rn-kland-on' : ''}`}
                            aria-pressed={on}
                            disabled={onlineLocked || full}
                            onClick={() => land.onChange(on
                              ? land.value.filter((n) => n !== l.name)
                              : [...land.value, l.name])}
                          >
                            {on ? '✓ ' : ''}{l.name}
                            <span className="rn-kland-kind">
                              {l.kind}{l.cost > 0 ? ` · ${l.cost}` : ''}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          );
        })()}

        <div className={lockedPanel} style={{ marginBottom: 14 }}>
          <label className="field" style={{ marginBottom: 4 }}><span>Random seed</span></label>
          <div className="row">
            <span className="rn-seed">{seed}</span>
            <div className="spacer" />
            <button className="btn" disabled={onlineLocked} onClick={() => setSeed(rollSeed())}>
              🎲 Reroll
            </button>
          </div>
          <p className="faint" style={{ margin: '6px 0 0' }}>Same seed, same shuffles — handy for replays.</p>
        </div>

        <button
          className="btn btn-primary rn-start"
          disabled={errors.length > 0 || !kingdomReady || onlineLocked}
          onClick={start}
        >
          {allAI ? '▶ Watch the AIs play' : '▶ Start game'}
        </button>
        {startNote && <p className="rn-gatenote">{startNote}</p>}

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
                  <button
                    className="btn btn-primary"
                    disabled={!kingdomReady}
                    onClick={() => onHost!(myName, seed)}
                  >
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
                {!kingdomReady && kingdom != null && (
                  <p className="rn-gatenote">
                    Finish the kingdom first — the host's supply is what both players
                    get ({kingdom.value.length} of {kingdom.size} piles picked).
                  </p>
                )}
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
                  Players, kingdom and seed are locked while the room is open —
                  cancel to change them.
                </p>
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn" onClick={copyCode}>
                    {copied ? '✓ Copied' : '📋 Copy code'}
                  </button>
                  <button className="btn" onClick={onCancelOnline}>Cancel</button>
                </div>
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
