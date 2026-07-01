/**
 * The Tables — the hall's Dominion lobby, full port of FableTest's tables
 * screen. Auth-guarded (herald + redirect to #/login). Two columns: the
 * sticky profile aside (live ledger — updateUser bumps victories/games after
 * real matches) and three lobby blocks: open tables (fixtures; own-hosted
 * rows hidden), set a table (kingdom + seat radiogroups with roving tabindex
 * and arrow-key wrap, tonight's suggestion, live summary), and the chronicle
 * (real recorded matches merged with the original fixture rows — the fixtures
 * anchored to the first visit — in one newest-first timeline).
 *
 * 'Set the table' / 'Take the seat' open the ceremony (chrome/Summons.tsx),
 * which launches the real match at #/play/dominion. Stores are
 * useSyncExternalStore-backed, so the ledger and chronicle re-read on return
 * from the table without any caching here.
 */
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { herald } from '../Heralds';
import { signOut, useUser, type Sigil } from '../state/auth';
import { Edit, setEditMode, useCopy } from '../state/copy';
import { useChronicle, type ChronicleEntry } from '../state/chronicle';
import { KINGDOM_SETS, kingdomById, type KingdomSet } from '../../shared/kingdoms';
import { closeAllPanels } from '../chrome/PanelsHost';
import { Summons, type SummonsRequest } from '../chrome/Summons';

const SIGIL_TITLES: Record<Sigil, string> = {
  ember: 'The Ember', raven: 'The Raven', gilt: 'The Gilt', veil: 'The Veil',
};

interface OpenTable {
  host: { name: string; sigil: Sigil };
  kingdom: string;
  open: boolean;
  opponent?: string;
  note?: string;
}

/** Lobby fixtures from the original hall (app.js OPEN_TABLES). */
const OPEN_TABLES: OpenTable[] = [
  {
    host: { name: 'Lady Wrenfield the Unkind', sigil: 'raven' },
    kingdom: 'sharp-coins', open: true, note: 'No mercy. No refunds.',
  },
  {
    host: { name: 'Brother Hollis', sigil: 'veil' },
    kingdom: 'first-game', open: false, opponent: 'Ser Calloway of the Eaves',
  },
];

/**
 * The original fixture history. Each row is anchored `nights` before the
 * hall's first visit, so fixtures age like real entries (no eternal 'Last
 * night') and merge into one chronologically sorted timeline with them.
 */
const CHRONICLE_FIXTURES = [
  { nights: 1, text: 'Tobit took the realm from Lady Wrenfield, 5 provinces to 3.', kingdom: 'Sharp Coins', turns: 19 },
  { nights: 1, text: 'Brother Hollis stole it from Tobit on the final turn, 4 to 4 by duchies.', kingdom: 'First Game', turns: 23 },
  { nights: 3, text: 'Lady Wrenfield cursed her way past Brother Hollis, 5 to 2.', kingdom: 'The Witching Hour', turns: 17 },
  { nights: 7, text: 'Tobit over Ser Calloway, by a single estate.', kingdom: 'First Game', turns: 26 },
];

const ANCHOR_KEY = 'crownfall.chronicle.anchor';
let memoryAnchor: string | null = null;

/** First-visit timestamp the fixture dates hang off; set once, then stable.
 * Storage-barred sessions hold it in module memory instead. */
function chronicleAnchor(): number {
  let iso = memoryAnchor;
  try { iso = window.localStorage.getItem(ANCHOR_KEY) ?? iso; } catch { /* memory only */ }
  if (!iso || Number.isNaN(new Date(iso).getTime())) {
    iso = new Date().toISOString();
    try { window.localStorage.setItem(ANCHOR_KEY, iso); } catch { /* memory only */ }
  }
  memoryAnchor = iso;
  return new Date(iso).getTime();
}

/* ── chronicle voice ── */

function chronicleText(e: ChronicleEntry): string {
  const [mine, theirs] = e.score;
  if (e.outcome === 'victory') return `${e.player} took the realm from ${e.foe}, ${mine} points to ${theirs}.`;
  if (e.outcome === 'defeat') return `${e.foe} held the realm against ${e.player}, ${theirs} points to ${mine}.`;
  return mine === theirs
    ? `${e.player} and ${e.foe} split the realm, ${mine} points apiece.`
    : `${e.player} and ${e.foe} split the realm, ${mine} to ${theirs}.`;
}

const NIGHT_WORDS = ['Two', 'Three', 'Four', 'Five', 'Six'];

function chronicleWhen(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Some night past';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const nights = Math.max(0, Math.round((startOfDay(new Date()) - startOfDay(then)) / 86400000));
  if (nights === 0) return 'Tonight';
  if (nights === 1) return 'Last night';
  if (nights <= 6) return `${NIGHT_WORDS[nights - 2]} nights past`;
  if (nights <= 13) return 'A week past';
  return `${Math.round(nights / 7)} weeks past`;
}

/* ── radiogroup keyboard: roving tabindex with arrow-key wrap ── */

function radioArrows(e: ReactKeyboardEvent<HTMLElement>) {
  if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(e.key)) return;
  // arrows belong to the caret while the keeper edits a label in here
  const active = document.activeElement as HTMLElement | null;
  if (active?.closest('[data-edit]')) return;
  e.preventDefault();
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]'));
  const idx = items.indexOf(active as HTMLElement);
  const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
  const next = items[(idx + delta + items.length) % items.length];
  if (next) { next.focus(); next.click(); }
}

/* ── screen ── */

export function Tables({ navigate }: { navigate: (hash: string) => void }) {
  const user = useUser();
  const turnedAway = useRef(false); // herald once, even under StrictMode's double effect
  const [kingdomId, setKingdomId] = useState<string>(KINGDOM_SETS[0].id);
  const [seat, setSeat] = useState<'open' | 'practice'>('open');
  const [summons, setSummons] = useState<SummonsRequest | null>(null);
  const [tonight] = useState(() => KINGDOM_SETS[new Date().getDay() % KINGDOM_SETS.length]);
  const chronicle = useChronicle();
  const [anchor] = useState(chronicleAnchor);

  // One timeline: real entries and anchored fixtures, newest first, labels
  // aging together — a fresh match can never sit below 'Last night'.
  const chronicleRows = [
    ...chronicle.map((e) => ({
      key: e.id,
      date: new Date(e.when).getTime() || 0,
      when: chronicleWhen(e.when),
      text: chronicleText(e),
      kingdom: e.kingdom,
      turns: e.turns,
    })),
    ...CHRONICLE_FIXTURES.map((c) => {
      const date = anchor - c.nights * 86400000;
      return {
        key: c.text,
        date,
        when: chronicleWhen(new Date(date).toISOString()),
        text: c.text,
        kingdom: c.kingdom,
        turns: c.turns,
      };
    }),
  ].sort((a, b) => b.date - a.date);

  const selected = kingdomById(kingdomId);
  const selectedName = useCopy(`kingdom-name-${selected.id}`, selected.name);
  const tonightName = useCopy(`kingdom-name-${tonight.id}`, tonight.name);

  useEffect(() => {
    if (!user && !turnedAway.current) {
      turnedAway.current = true;
      herald('Sign in to reach the tables.');
      navigate('#/login');
    }
  }, [user, navigate]);

  if (!user) return null;

  const visibleTables = OPEN_TABLES.filter((t) => t.host.name !== user.name);

  const onSignOut = () => {
    turnedAway.current = true; // a deliberate leave — the guard stays quiet
    closeAllPanels();
    setEditMode(false);
    signOut();
    herald('Signed out. The gates remember.');
    navigate('#/');
  };

  return (
    <section className="screen" data-screen="tables" aria-labelledby="tables-title">
      <div className="tables">
        <aside className="hall-profile" aria-label="Your standing">
          <svg className="profile-crest" aria-hidden="true"><use href={`#crest-${user.sigil}`} /></svg>
          {/* Not a heading: the aside precedes the page's h1 in DOM order,
              and it is already named by the aria-label above. */}
          <p className="profile-name" style={{ margin: 0 }}>
            {user.name}{' '}
            {user.keeper && (
              <svg className="keeper-crown" aria-hidden="true"><use href="#glyph-crown-small" /></svg>
            )}
          </p>
          <div className="profile-ledger">
            <div><span>Sigil</span><strong>{SIGIL_TITLES[user.sigil]}</strong></div>
            <div><span>Victories</span><strong>{user.victories.toLocaleString()}</strong></div>
            <div><span>Games at table</span><strong>{user.games.toLocaleString()}</strong></div>
            <div><span>Favorite kingdom</span><strong>{user.favorite}</strong></div>
          </div>
          <button className="profile-signout" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </aside>

        <div className="tables-main" data-blocks="lobby">
          <header className="tables-head">
            <p className="eyebrow"><Edit id="tables-eyebrow" fallback="The tables · Dominion" /></p>
            <h1 className="section-title" id="tables-title" tabIndex={-1}>
              <Edit id="tables-title" fallback="Who's at the table?" />
            </h1>
          </header>

          <div data-block="lobby-open" data-block-name="Open tables">
            <h2 className="lobby-subhead eyebrow"><Edit id="tables-open-head" fallback="Open tables" /></h2>
            <ul className="open-tables">
              {visibleTables.length ? (
                visibleTables.map((t) => (
                  <OpenTableRow
                    key={t.host.name}
                    table={t}
                    onJoin={() => setSummons({ kind: 'join', kingdomId: t.kingdom, foe: t.host })}
                  />
                ))
              ) : (
                <li className="tables-empty">
                  No table stands open tonight. Set your own; the heralds will carry word.
                </li>
              )}
            </ul>
          </div>

          <div data-block="lobby-set" data-block-name="Set a table">
            <h2 className="lobby-subhead eyebrow"><Edit id="tables-set-head" fallback="Set a table" /></h2>

            <p className="tonight">
              The heralds favor <strong>{tonightName}</strong> tonight.{' '}
              <button className="tonight-set" type="button" onClick={() => setKingdomId(tonight.id)}>
                Set it out
              </button>
            </p>

            <div
              className="kingdom-pick"
              role="radiogroup"
              aria-label="Kingdom set"
              aria-orientation="horizontal"
              onKeyDown={radioArrows}
            >
              {KINGDOM_SETS.map((k) => (
                <DeckBanner
                  key={k.id}
                  set={k}
                  checked={kingdomId === k.id}
                  onPick={() => setKingdomId(k.id)}
                />
              ))}
            </div>

            <div className="kingdom-preview">
              <span className="preview-label">On the table:</span>
              {selected.cards.map((name) => (
                <span className="kingdom-chip" key={name}>{name}</span>
              ))}
            </div>

            <div
              className="seat-pick"
              role="radiogroup"
              aria-label="Opponent"
              aria-orientation="horizontal"
              onKeyDown={radioArrows}
            >
              <button
                className="seat-option"
                type="button"
                role="radio"
                aria-checked={seat === 'open'}
                tabIndex={seat === 'open' ? 0 : -1}
                onClick={() => setSeat('open')}
              >
                <span className="seat-name"><Edit id="seat-open-name" fallback="Open seat" /></span>
                <span className="seat-desc">
                  <Edit id="seat-open-desc" fallback="Word goes to your companions; whoever answers, sits." />
                </span>
              </button>
              <button
                className="seat-option"
                type="button"
                role="radio"
                aria-checked={seat === 'practice'}
                tabIndex={seat === 'practice' ? 0 : -1}
                onClick={() => setSeat('practice')}
              >
                <span className="seat-name">
                  <Edit id="seat-practice-name" fallback="Practice — play the Computer" />
                </span>
                <span className="seat-desc">
                  <Edit id="seat-practice-desc" fallback="The Computer takes the seat at once." />
                </span>
              </button>
            </div>

            <div className="table-begin">
              <p className="table-summary" aria-live="polite">
                The kingdom of <strong>{selectedName}</strong>,{' '}
                {seat === 'practice' ? 'against the Computer' : 'with one seat left open'}.
              </p>
              <button
                className="btn btn-primary btn-large"
                type="button"
                onClick={() => setSummons({ kind: seat === 'practice' ? 'practice' : 'open', kingdomId })}
              >
                <Edit id="tables-set-cta" fallback="Set the table" />
              </button>
            </div>
          </div>

          <div data-block="lobby-chronicle" data-block-name="The chronicle">
            <h2 className="lobby-subhead eyebrow"><Edit id="tables-chronicle-head" fallback="The chronicle" /></h2>
            <ol className="chronicle">
              {chronicleRows.map((r) => (
                <li className="chronicle-row" key={r.key}>
                  <span className="chronicle-when">{r.when}</span>
                  <span className="chronicle-text">{r.text}</span>
                  <span className="chronicle-meta">{r.kingdom} · {r.turns} turns</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {summons && (
        <Summons request={summons} navigate={navigate} onClose={() => setSummons(null)} />
      )}
    </section>
  );
}

/* ── pieces ── */

function OpenTableRow({ table, onJoin }: { table: OpenTable; onJoin: () => void }) {
  const k = kingdomById(table.kingdom);
  const kName = useCopy(`kingdom-name-${k.id}`, k.name);
  return (
    <li className={table.open ? 'table-row' : 'table-row is-full'}>
      <svg className="table-crest" aria-hidden="true"><use href={`#crest-${table.host.sigil}`} /></svg>
      <div className="table-info">
        <span className="table-host">
          {table.host.name}{table.open ? '' : ` vs ${table.opponent}`}
        </span>
        <span className="table-meta">
          {kName} · {table.open ? 'one seat open' : 'seats full'}
          {table.note ? ` · “${table.note}”` : ''}
        </span>
      </div>
      {table.open ? (
        <button
          className="btn btn-primary"
          type="button"
          aria-label={`Take the seat at ${table.host.name}'s table: ${kName}`}
          onClick={onJoin}
        >
          Take the seat
        </button>
      ) : (
        <button
          className="btn btn-ghost"
          type="button"
          aria-label={`Watch ${table.host.name} against ${table.opponent}: ${kName}`}
          onClick={() => herald('The spectator benches are still being carved. Soon.')}
        >
          Watch
        </button>
      )}
    </li>
  );
}

function DeckBanner({ set, checked, onPick }: { set: KingdomSet; checked: boolean; onPick: () => void }) {
  return (
    <button
      className="deck"
      type="button"
      role="radio"
      aria-checked={checked}
      tabIndex={checked ? 0 : -1}
      onClick={onPick}
    >
      <svg aria-hidden="true"><use href={`#${set.icon}`} /></svg>
      <span className="deck-name"><Edit id={`kingdom-name-${set.id}`} fallback={set.name} /></span>
      <span className="deck-motto"><Edit id={`kingdom-motto-${set.id}`} fallback={set.motto} /></span>
      <span className="deck-count"><Edit id={`kingdom-count-${set.id}`} fallback="10 kingdom cards" /></span>
    </button>
  );
}
