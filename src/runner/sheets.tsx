/**
 * Bottom sheets: blocking choice prompts from the engine (card / option /
 * player / yes-no / multi-select cards / pile) and the action picker shown
 * when several actions apply to the same tapped card or zone.
 *
 * `revealed` choices show candidates face up to the answering human
 * regardless of normal zone visibility (deck searches).
 *
 * Every candidate button carries `data-choice-digit` (DOM order, 1-based,
 * "0" = the tenth) — the runner's keyboard system bridges number keys to a
 * click on the matching button. Items past the tenth have no digit.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ChoiceAnswer, ChoiceRequest, GameDef, GameState, Id, Move } from '../shared/types';
import { isCardVisibleTo } from '../engine';
import { CardView } from '../components/CardView';
import { templateOf } from './layout';

/** Keyboard digit for the i-th candidate: 1–9, "0" for the tenth, none after. */
function choiceDigit(i: number): string | undefined {
  if (i < 9) return String(i + 1);
  return i === 9 ? '0' : undefined;
}

function SheetBase({ who, title, onClose, children }: {
  who?: string;
  title: string;
  /** Omitted for blocking sheets (engine choices can't be dismissed). */
  onClose?: () => void;
  children: ReactNode;
}) {
  // Move focus into the dialog when it opens so keyboard/assistive users
  // aren't soft-locked on the (inert) table behind a blocking sheet, and hand
  // it back to the opener when the sheet closes (if it's still in the DOM —
  // the card that opened a picker may have moved by then).
  const sheetRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    const sheet = sheetRef.current;
    if (sheet) {
      const first = sheet.querySelector<HTMLElement>('button:not(:disabled)');
      (first ?? sheet).focus();
    }
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  // Modal manners: Tab cycles inside the dialog instead of walking the
  // obscured table; Escape dismisses the sheets that CAN be dismissed
  // (engine choices are blocking and pass no onClose).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && onClose) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const focusables = Array.from(sheet.querySelectorAll<HTMLElement>(
      'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    ));
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    // indexOf is -1 while focus sits on the sheet itself (tabIndex -1): both
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
  return (
    <div className="rn-sheet-backdrop" onClick={onClose} onKeyDown={onKeyDown}>
      <div
        className="rn-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
      >
        {who && <div className="rn-sheet-who">{who}</div>}
        <div className="rn-sheet-prompt">{title}</div>
        {children}
      </div>
    </div>
  );
}

/** Blocking sheet for an engine ChoiceRequest aimed at a human seat. */
export function ChoiceSheet({ def, state, choice, accent, onAnswer }: {
  def: GameDef;
  state: GameState;
  choice: ChoiceRequest;
  accent: string;
  onAnswer: (a: ChoiceAnswer) => void;
}) {
  const who = state.players.find((p) => p.id === choice.playerId)?.name ?? choice.playerId;
  return (
    <SheetBase who={`${who} decides`} title={choice.prompt}>
      {choice.kind === 'card' && (
        <>
          <div className="rn-sheet-cards">
            {choice.cardIds.map((id, i) => {
              const card = state.cards[id];
              if (!card) return null;
              const faceUp = choice.revealed === true || isCardVisibleTo(def, state, id, choice.playerId);
              return (
                <button
                  key={id}
                  type="button"
                  className="rn-cardbtn"
                  data-choice-digit={choiceDigit(i)}
                  aria-label={`Choose ${faceUp ? card.name : 'face-down card'}`}
                  onClick={() => onAnswer(id)}
                >
                  <CardView
                    card={{
                      name: card.name,
                      templateId: card.templateId,
                      fields: card.fields,
                      faceUp,
                    }}
                    template={templateOf(def, card)}
                    width={88}
                    accent={accent}
                  />
                </button>
              );
            })}
          </div>
          {choice.optional && (
            <button className="btn" onClick={() => onAnswer(null)}>Skip</button>
          )}
        </>
      )}
      {choice.kind === 'pile' && (
        // Piles as mini-cards: the representative's face (its template shows
        // cost etc.) plus a × N badge from the per-pile counts.
        <PileChoiceSheet def={def} state={state} choice={choice} accent={accent} onAnswer={onAnswer} />
      )}
      {choice.kind === 'option' && (
        <div className="rn-sheet-options">
          {choice.options.map((o, i) => (
            <button className="btn" key={o.id} data-choice-digit={choiceDigit(i)} onClick={() => onAnswer(o.id)}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      {choice.kind === 'player' && (
        <div className="rn-sheet-options">
          {choice.playerIds.map((pid, i) => (
            <button className="btn" key={pid} data-choice-digit={choiceDigit(i)} onClick={() => onAnswer(pid)}>
              {state.players.find((p) => p.id === pid)?.name ?? pid}
            </button>
          ))}
        </div>
      )}
      {choice.kind === 'yesNo' && (
        <div className="rn-sheet-row">
          <button className="btn" onClick={() => onAnswer(false)}>No</button>
          <button className="btn btn-primary" onClick={() => onAnswer(true)}>Yes</button>
        </div>
      )}
      {choice.kind === 'cards' && (
        // Keyed by request id so back-to-back multi-selects never share state.
        <CardsPicker key={choice.id} def={def} state={state} choice={choice} accent={accent} onAnswer={onAnswer} />
      )}
    </SheetBase>
  );
}

/**
 * Multi-select ('cards') body: tap to toggle, pick order shown on the ring
 * (the engine runs the body in pick order), Confirm enabled once the count
 * is within min–max. Answers with a JSON array string of instance ids.
 */
function CardsPicker({ def, state, choice, accent, onAnswer }: {
  def: GameDef;
  state: GameState;
  choice: Extract<ChoiceRequest, { kind: 'cards' }>;
  accent: string;
  onAnswer: (a: ChoiceAnswer) => void;
}) {
  const [picked, setPicked] = useState<Id[]>([]);
  const toggle = (id: Id) => setPicked((prev) => {
    if (prev.includes(id)) return prev.filter((x) => x !== id);
    return prev.length >= choice.max ? prev : [...prev, id];
  });
  const inRange = picked.length >= choice.min && picked.length <= choice.max;
  const need = choice.min === choice.max
    ? `exactly ${choice.min}`
    : `${choice.min}–${choice.max}`;
  return (
    <>
      <div className="rn-msel-req" aria-live="polite">
        Pick {need} card{choice.max === 1 ? '' : 's'} · <b>{picked.length}</b> selected
      </div>
      <div className="rn-sheet-cards">
        {choice.cardIds.map((id, i) => {
          const card = state.cards[id];
          if (!card) return null;
          const faceUp = choice.revealed === true || isCardVisibleTo(def, state, id, choice.playerId);
          const idx = picked.indexOf(id);
          return (
            <button
              key={id}
              type="button"
              className={`rn-cardbtn rn-mselbtn${idx >= 0 ? ' rn-msel-on' : ''}`}
              data-choice-digit={choiceDigit(i)}
              aria-pressed={idx >= 0}
              aria-label={`${idx >= 0 ? 'Deselect' : 'Select'} ${faceUp ? card.name : 'face-down card'}`}
              onClick={() => toggle(id)}
            >
              <CardView
                card={{ name: card.name, templateId: card.templateId, fields: card.fields, faceUp }}
                template={templateOf(def, card)}
                width={88}
                accent={accent}
              />
              {idx >= 0 && <span className="rn-msel-count">{idx + 1}</span>}
            </button>
          );
        })}
      </div>
      <button
        className="btn btn-primary"
        disabled={!inRange}
        onClick={() => onAnswer(JSON.stringify(picked))}
      >
        Confirm{picked.length > 0 ? ` (${picked.length})` : ''}
      </button>
    </>
  );
}

/**
 * Pile choice ('pile') body: one mini-card per pile (the representative's
 * face — its template carries cost etc.) with a × N count badge; tapping a
 * pile answers with its representative id. Skip appears when optional.
 */
export function PileChoiceSheet({ def, state, choice, accent, onAnswer }: {
  def: GameDef;
  state: GameState;
  choice: Extract<ChoiceRequest, { kind: 'pile' }>;
  accent: string;
  onAnswer: (a: ChoiceAnswer) => void;
}) {
  return (
    <>
      <div className="rn-sheet-cards">
        {choice.cardIds.map((id, i) => {
          const card = state.cards[id];
          if (!card) return null;
          // `revealed` piles show their face regardless of zone visibility
          // (a hidden stock put on offer, e.g. Black Market) — same contract
          // as the card/cards choices.
          const faceUp = choice.revealed === true || isCardVisibleTo(def, state, id, choice.playerId);
          const count = choice.counts[i] ?? 0;
          return (
            <button
              key={id}
              type="button"
              className="rn-cardbtn rn-mselbtn rn-pilebtn"
              data-choice-digit={choiceDigit(i)}
              aria-label={`Choose ${faceUp ? card.name : 'face-down pile'} (${count} in pile)`}
              onClick={() => onAnswer(id)}
            >
              <CardView
                card={{ name: card.name, templateId: card.templateId, fields: card.fields, faceUp }}
                template={templateOf(def, card)}
                width={88}
                accent={accent}
              />
              <span className="rn-msel-count rn-pile-count">×{count}</span>
            </button>
          );
        })}
      </div>
      {choice.optional && (
        <button className="btn" onClick={() => onAnswer(null)}>Skip</button>
      )}
    </>
  );
}

/** Picker when one tap target has several legal actions. Dismissible. */
export function ActionPickSheet({ def, title, moves, onPick, onCancel }: {
  def: GameDef;
  title: string;
  moves: Move[];
  onPick: (m: Move) => void;
  onCancel: () => void;
}) {
  return (
    <SheetBase who="Choose an action" title={title} onClose={onCancel}>
      <div className="rn-sheet-options">
        {moves.map((m, i) => (
          <button
            className="btn btn-primary"
            key={i}
            data-choice-digit={choiceDigit(i)}
            onClick={() => onPick(m)}
          >
            {def.actions.find((a) => a.id === m.actionId)?.name ?? m.actionId}
          </button>
        ))}
      </div>
      <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
    </SheetBase>
  );
}
