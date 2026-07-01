/**
 * The Ceremony (summons overlay) — the matchmaking rite, ported from FableTest
 * app.js (renderSearching / renderSeated).
 *
 *   searching  open-seat only: rotating ring, flavor lines, mm:ss clock;
 *              after 3.6–5.4s a seat-taker answers → found
 *   found      versus plate + the Coin of Succession 3D flip (youFirst is
 *              decided before the animation; verdict text lands at ~2200ms,
 *              700ms under reduced motion or calm). 'To the table' launches
 *              the REAL match at #/play/dominion, carrying the coin's verdict
 *              as &first=you|foe — the table seats the first player at seat 0.
 *              Practice foes omit the foe param (the table defaults to 'The
 *              Computer'). The old 'field' confirmation stage is gone: it was
 *              a relic of the fake engine's dead-end launch, and cutting it
 *              keeps a practice match within three clicks of #/tables.
 *
 * role=dialog aria-modal, body scroll locked, Esc closes, Tab is trapped,
 * focus returns to the opener on close. All timers live inside effects and
 * clear on stage change and unmount.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { herald } from '../Heralds';
import { Edit, useCopy } from '../state/copy';
import { getCalm } from '../state/theme';
import { getUser, type Sigil } from '../state/auth';
import { kingdomById } from '../../shared/kingdoms';

export interface SummonsFoe {
  name: string;
  sigil?: Sigil;
  /** The machine opponent — gear glyph instead of a sigil crest. */
  gear?: boolean;
}

export interface SummonsRequest {
  /** open: search for a foe · join: sit at a host's table · practice: the Computer. */
  kind: 'open' | 'join' | 'practice';
  kingdomId: string;
  /** Join mode: the host whose seat you take. */
  foe?: SummonsFoe;
}

const THE_COMPUTER: SummonsFoe = { name: 'The Computer', gear: true };

/** The hall's cast — whoever answers an open seat (self excluded). */
const SEAT_TAKERS: SummonsFoe[] = [
  { name: 'Lady Wrenfield the Unkind', sigil: 'raven' },
  { name: 'Brother Hollis', sigil: 'veil' },
  { name: 'Ser Calloway of the Eaves', sigil: 'raven' },
  { name: 'Mathilde, Tithe-Sworn', sigil: 'gilt' },
  { name: 'Aldric Emberguard', sigil: 'ember' },
];

const SUMMON_LINES = [
  'Word goes to your companions…',
  'A chair scrapes in a far keep…',
  'Someone counts their coppers…',
  'The kettle is put on…',
  'A deck is cut, somewhere, in anticipation…',
];

const SIGIL_NAMES: Record<Sigil, string> = {
  ember: 'the Ember', raven: 'the Raven', gilt: 'the Gilt', veil: 'the Veil',
};

type Stage =
  | { at: 'searching' }
  | { at: 'found'; foe: SummonsFoe; seatLine: string; youFirst: boolean };

export interface SummonsProps {
  request: SummonsRequest;
  navigate: (hash: string) => void;
  onClose: () => void;
}

export function Summons({ request, navigate, onClose }: SummonsProps) {
  const user = getUser();
  const kingdom = kingdomById(request.kingdomId);
  const kingdomName = useCopy(`kingdom-name-${kingdom.id}`, kingdom.name);

  const [stage, setStage] = useState<Stage>(() => {
    if (request.kind === 'practice') {
      return {
        at: 'found', foe: THE_COMPUTER,
        seatLine: 'The Computer winds itself and sits.',
        youFirst: Math.random() < 0.5,
      };
    }
    if (request.kind === 'join' && request.foe) {
      return {
        at: 'found', foe: request.foe,
        seatLine: `You take the seat across from ${request.foe.name}.`,
        youFirst: Math.random() < 0.5,
      };
    }
    return { at: 'searching' };
  });

  const [seconds, setSeconds] = useState(0);
  const [lineIdx, setLineIdx] = useState(0);
  const [coinCast, setCoinCast] = useState(false);
  const [verdictShown, setVerdictShown] = useState(false);

  const overlayRef = useRef<HTMLDivElement>(null);
  const withdrawRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const lastFocus = useRef<Element | null>(null);

  // scroll lock + focus restoration (declared first so the opener is captured
  // before any stage effect moves focus into the overlay)
  useEffect(() => {
    lastFocus.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
      const el = lastFocus.current;
      if (el instanceof HTMLElement && el.isConnected) el.focus();
    };
  }, []);

  // Esc closes; Tab stays inside.
  // An <Edit> caret swallows its own Escape first — the ladder holds.
  const stageAt = stage.at;
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        herald('You clear the table. The heralds apologize on your behalf.');
        onClose();
      } else if (e.key === 'Tab') {
        const overlay = overlayRef.current;
        if (!overlay) return;
        const focusables = Array.from(overlay.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        )).filter((el) => !el.hidden && !el.closest('[aria-hidden="true"]'));
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // searching: clock tick, flavor rotation, and the answering foe
  useEffect(() => {
    if (stageAt !== 'searching') return;
    const clock = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    const rotate = window.setInterval(
      () => setLineIdx((i) => (i + 1) % SUMMON_LINES.length), 2300);
    const wait = window.setTimeout(() => {
      const self = getUser()?.name;
      const candidates = SEAT_TAKERS.filter((c) => c.name !== self);
      const foe = candidates[Math.floor(Math.random() * candidates.length)];
      setStage({
        at: 'found', foe,
        seatLine: `${foe.name} answers, and sits.`,
        youFirst: Math.random() < 0.5,
      });
    }, 3600 + Math.random() * 1800);
    return () => {
      window.clearInterval(clock);
      window.clearInterval(rotate);
      window.clearTimeout(wait);
    };
  }, [stageAt]);

  // found: cast the coin, then let the verdict land
  useEffect(() => {
    if (stageAt !== 'found') return;
    const quick = window.matchMedia('(prefers-reduced-motion: reduce)').matches || getCalm();
    const cast = window.setTimeout(() => setCoinCast(true), 500);
    const verdict = window.setTimeout(() => setVerdictShown(true), quick ? 700 : 2200);
    return () => {
      window.clearTimeout(cast);
      window.clearTimeout(verdict);
    };
  }, [stageAt]);

  // stage focus: the cancel button while searching, the title thereafter
  useEffect(() => {
    if (stageAt === 'searching') withdrawRef.current?.focus();
    else titleRef.current?.focus();
  }, [stageAt]);

  // The Coin of Succession's verdict rides along: the table must open on the
  // turn the ceremony announced, not always the player's.
  const launch = (foe: SummonsFoe, youFirst: boolean) => {
    const first = youFirst ? 'you' : 'foe';
    navigate(foe.gear
      ? `#/play/dominion?set=${kingdom.id}&seat=practice&first=${first}`
      : `#/play/dominion?set=${kingdom.id}&foe=${encodeURIComponent(foe.name)}&seat=open&first=${first}`);
  };

  const closeWith = (message: string) => {
    herald(message);
    onClose();
  };

  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

  return (
    <div
      className="summons"
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="summons-title"
      data-stage={stage.at}
    >
      <div className="summons-stage">
        {stage.at === 'searching' && (
          <>
            <div className="summons-ring-wrap">
              <svg className="summons-ring" viewBox="0 0 100 100" aria-hidden="true">
                <circle cx="50" cy="50" r="48" />
              </svg>
              <svg className="summons-crest" aria-hidden="true"><use href="#mark-crownfall" /></svg>
            </div>
            <h2 className="summons-title" id="summons-title">
              <Edit id="summons-search-title" fallback="The table is set" />
            </h2>
            <p className="summons-line">{SUMMON_LINES[lineIdx]}</p>
            <p className="summons-timer">
              <span>{clock}</span>{' '}
              <span><Edit id="summons-wait-note" fallback="with the candles lit" /></span>
            </p>
            <div className="summons-cancel">
              <button
                className="btn btn-ghost"
                type="button"
                ref={withdrawRef}
                onClick={() => closeWith('You clear the table. The heralds apologize on your behalf.')}
              >
                <Edit id="summons-withdraw-label" fallback="Clear the table" />
              </button>
            </div>
          </>
        )}

        {stage.at === 'found' && (
          <>
            <p className="eyebrow">{kingdomName} · the seats are filled</p>
            <h2 className="summons-title" id="summons-title" tabIndex={-1} ref={titleRef}>
              {stage.seatLine}
            </h2>
            <div className="versus">
              <div className="versus-side">
                <svg aria-hidden="true"><use href={`#crest-${user?.sigil ?? 'ember'}`} /></svg>
                <span className="versus-name">{user?.name ?? 'You'}</span>
                <span className="versus-tag">Sigil of {SIGIL_NAMES[user?.sigil ?? 'ember']}</span>
              </div>
              <span className="versus-divider" aria-hidden="true">✕</span>
              <div className="versus-side is-foe">
                <svg aria-hidden="true">
                  <use href={stage.foe.gear ? '#glyph-gear' : `#crest-${stage.foe.sigil ?? 'ember'}`} />
                </svg>
                <span className="versus-name">{stage.foe.name}</span>
                <span className="versus-tag">
                  {stage.foe.gear ? 'Computer' : `Sigil of ${SIGIL_NAMES[stage.foe.sigil ?? 'ember']}`}
                </span>
              </div>
            </div>
            <div className="coin-wrap">
              <div
                className={coinCast ? 'coin is-cast' : 'coin'}
                style={{ '--coin-final': stage.youFirst ? '1080deg' : '1260deg' } as CSSProperties}
              >
                <div className="coin-side coin-front">
                  <svg aria-hidden="true"><use href="#glyph-crown-small" /></svg>
                </div>
                <div className="coin-side coin-back">
                  <svg aria-hidden="true"><use href="#glyph-sword" /></svg>
                </div>
              </div>
            </div>
            <p className="coin-verdict" aria-live="polite">
              {verdictShown
                ? (stage.youFirst
                  ? 'The coin favors you. You draw first.'
                  : 'The coin turns away. Your rival draws first.')
                : 'The Coin of Succession is cast…'}
            </p>
            <div className="summons-actions">
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => launch(stage.foe, stage.youFirst)}
              >
                <Edit id="summons-enter-label" fallback="To the table" />
              </button>
              <button
                className="btn btn-ghost"
                type="button"
                onClick={() => closeWith(stage.foe.gear
                  ? 'The Computer winds down, unoffended.'
                  : `You rise. ${stage.foe.name} pockets the coin.`)}
              >
                <Edit id="summons-leave-label" fallback="Rise and leave" />
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}
