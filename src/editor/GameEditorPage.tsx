/**
 * GameEditorPage — ONE game-engine screen (#14). The WYSIWYG table canvas is
 * the editor: it stays mounted as the whole surface, and every other section
 * (Info | Cards | Types | Systems | Actions | Rules | Filters) opens as a
 * slide-over panel from the section rail on the left —
 * design the screen and tune rules/cards/zones side by side, no page swaps.
 * Heavy sections (Cards, Systems, Actions, Rules) open wide by default; ⇤/⤢
 * toggles the width, ✕ (or the rail button again) closes.
 * Loads the game by id, autosaves edits to the store (~400ms debounce),
 * validates live, and opens built-in examples read-only with "Clone & edit".
 */
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import type { GameDef, ValidationIssue } from '../shared/types';
import { deepClone } from '../shared/defaults';
import { validateGameDef } from '../shared/validate';
import { cloneGame, getGameById, saveGame } from '../state/store';
import { exportGame } from '../storage/storage';
import { CardsTab } from '../designer/CardsTab';
import { Modal } from './common/Modal';
import { EdIcon, type EdIconName } from './common/icons';
import { InfoTab } from './tabs/InfoTab';
import { TableTab } from './tabs/TableTab';
import { TypesTab } from './tabs/TypesTab';
import { SystemsTab } from './tabs/SystemsTab';
import { ActionsTab } from './tabs/ActionsTab';
import { RulesTab } from './tabs/RulesTab';
import { FiltersTab } from './tabs/FiltersTab';
import './editor.css';

export interface GameEditorPageProps {
  gameId: string;
  /** Navigate helper: '#/' home, `#/play/${id}` etc. */
  navigate: (hash: string) => void;
  /**
   * Force the editor open read-only even for a saveable game (a host
   * permission layer, e.g. the hall's keeper gate). `readOnlyNote` replaces
   * the built-in-example banner text; the "Clone & edit" escape still works.
   */
  readOnly?: boolean;
  readOnlyNote?: string;
}

const SECTIONS = [
  // 'info' opens from the topbar gear (the mockup's settings slot), not the rail.
  { id: 'info', label: 'Info', icon: 'info' },
  { id: 'cards', label: 'Cards', icon: 'cards' },
  { id: 'types', label: 'Types', icon: 'types' },
  // Phases + zones + variables live together on one addable-lists page.
  { id: 'systems', label: 'Systems', icon: 'flow' },
  { id: 'actions', label: 'Actions', icon: 'actions' },
  { id: 'rules', label: 'Rules', icon: 'rules' },
  { id: 'filters', label: 'Filters', icon: 'filters' },
] as const satisfies readonly { id: string; label: string; icon: EdIconName }[];

type SectionId = (typeof SECTIONS)[number]['id'];

/** Sections that host big surfaces (card grids, node graphs) open wide. */
const WIDE_BY_DEFAULT: ReadonlySet<SectionId> = new Set(['cards', 'systems', 'actions', 'rules']);

const SAVE_DEBOUNCE_MS = 400;

export function GameEditorPage({ gameId, navigate, readOnly: forcedReadOnly, readOnlyNote }: GameEditorPageProps) {
  const [draft, setDraft] = useState<GameDef | null>(() => {
    const game = getGameById(gameId);
    return game ? deepClone(game) : null;
  });
  const [panel, setPanel] = useState<SectionId | null>(null);
  const [wide, setWide] = useState(false);
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'error'>('saved');
  const [issuesOpen, setIssuesOpen] = useState(false);

  const readOnly = !!draft?.meta.builtIn || !!forcedReadOnly;

  const openPanel = (id: SectionId) => {
    setPanel((cur) => {
      if (cur === id) return null; // rail button toggles
      setWide(WIDE_BY_DEFAULT.has(id));
      return id;
    });
  };

  // Debounced autosave; refs let the unmount flush see the latest state.
  const timerRef = useRef<number | undefined>(undefined);
  const pendingRef = useRef<GameDef | null>(null);

  const flushSave = () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
    if (pendingRef.current) {
      const ok = saveGame(pendingRef.current);
      // Keep the unsaved def on failure so Retry (and the unload flush) can
      // try again — clearing it would make the error state a dead end.
      if (ok) pendingRef.current = null;
      setSaveState(ok ? 'saved' : 'error');
    }
  };

  // Flush any unsaved edit when leaving the page.
  useEffect(() => () => {
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    if (pendingRef.current) saveGame(pendingRef.current);
  }, []);

  // Flush the pending debounced save synchronously when the tab is closed,
  // refreshed, or backgrounded ('pagehide'; 'beforeunload' as a fallback for
  // browsers that don't fire pagehide reliably).
  useEffect(() => {
    const flushNow = () => {
      // Clear only on success: pagehide also fires on backgrounding, and a
      // failed save must stay retryable if the page comes back.
      if (pendingRef.current && saveGame(pendingRef.current)) {
        pendingRef.current = null;
      }
    };
    window.addEventListener('pagehide', flushNow);
    window.addEventListener('beforeunload', flushNow);
    return () => {
      window.removeEventListener('pagehide', flushNow);
      window.removeEventListener('beforeunload', flushNow);
    };
  }, []);

  const onChange = (next: GameDef) => {
    if (readOnly) return; // built-in examples are never edited or saved
    setDraft(next);
    pendingRef.current = next;
    setSaveState('pending');
    if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  };

  // Whole-def validation deep-walks every card ability, zone, phase and
  // expression — far too heavy for every keystroke or color-scrub pointermove.
  // Deferring the input keeps typing responsive; the issues chip catches up
  // the moment input pauses.
  const deferredDraft = useDeferredValue(draft);
  const issues = useMemo(() => (deferredDraft ? validateGameDef(deferredDraft) : []), [deferredDraft]);

  if (!draft) {
    return (
      <main className="app-main">
        <div className="page">
          <div className="empty-state">
            <p style={{ fontSize: '1.05rem', fontWeight: 600 }}>Game not found</p>
            <p>It may have been deleted on this device.</p>
            <button type="button" className="btn btn-primary" onClick={() => navigate('#/')}>← Back to your games</button>
          </div>
        </div>
      </main>
    );
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.length - errorCount;
  const panelLabel = SECTIONS.find((s) => s.id === panel)?.label ?? '';

  const cloneAndEdit = () => {
    const copy = cloneGame(draft);
    navigate(`#/edit/${copy.meta.id}`);
  };

  // Idempotent open (openPanel is the rail's TOGGLE — jumping here from an
  // issue row or a cross-panel hint must never close an already-open panel).
  const jumpToPanel = (id: SectionId) => {
    setWide(WIDE_BY_DEFAULT.has(id));
    setPanel(id);
  };

  // The canvas's "Edit card design" bridge lands on Templates (the faces live
  // there); rail opens keep CardsTab's own card-count default. One-shot.
  const cardsSectionRef = useRef<'templates' | 'cards' | undefined>(undefined);
  const consumeCardsSection = () => {
    const s = cardsSectionRef.current;
    cardsSectionRef.current = undefined;
    return s;
  };

  return (
    <>
      <header className="app-topbar ed-topbar">
        <button
          type="button"
          className="ed-crumb"
          onClick={() => { flushSave(); navigate('#/'); }}
          title="Back to your games"
        >
          Projects
        </button>
        <span className="ed-crumb-sep" aria-hidden="true">›</span>
        <input
          type="text"
          className="ed-name"
          value={draft.meta.name}
          readOnly={readOnly}
          aria-label="Game name"
          onChange={(e) => onChange({ ...draft, meta: { ...draft.meta, name: e.target.value } })}
        />
        {/* The canvas tools (variant, aspect, undo/redo, zoom, fit, fullscreen)
            portal in here from ScreenCanvas — one top bar, mockup-style. */}
        <div id="ed-tools-slot" className="ed-tools-slot" />
        {issues.length > 0 && (
          <button
            type="button"
            className={errorCount > 0 ? 'chip error ed-issues' : 'chip warn ed-issues'}
            onClick={() => setIssuesOpen(true)}
          >
            {errorCount > 0 ? `⚠ ${errorCount} error${errorCount === 1 ? '' : 's'}` : `${warningCount} warning${warningCount === 1 ? '' : 's'}`}
          </button>
        )}
        {!readOnly && saveState === 'error' ? (
          <span className="ed-save-error" role="alert">
            <span aria-hidden="true">⚠</span>
            <span className="ed-save-error-text">Couldn't save — device storage may be full</span>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                // A failed flush keeps pendingRef, but cover the cold path too.
                if (!pendingRef.current) pendingRef.current = draft;
                flushSave();
              }}
            >
              Retry
            </button>
            <button
              type="button"
              className="btn btn-small"
              title="Download the game as a file so nothing is lost"
              onClick={() => exportGame(draft)}
            >
              ⇩ Export
            </button>
          </span>
        ) : (
          <span className="faint ed-save-hint">
            {readOnly ? 'read-only' : saveState === 'saved' ? 'Saved ✓' : 'Saving…'}
          </span>
        )}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => { flushSave(); navigate(`#/play/${draft.meta.id}`); }}
        >
          ▶ Play
        </button>
        <button
          type="button"
          className="btn btn-ghost ed-gear"
          aria-label="Game info & settings"
          title="Game info & settings"
          onClick={() => openPanel('info')}
        >
          <EdIcon name="gear" size={18} />
        </button>
      </header>

      <main className="app-main ed-single-main">
        <div className="ed-shell">
          <nav className="ed-rail" aria-label="Game sections">
            {SECTIONS.filter((s) => s.id !== 'info').map((s) => (
              <button
                key={s.id}
                type="button"
                className={panel === s.id ? 'active' : ''}
                onClick={() => openPanel(s.id)}
                aria-pressed={panel === s.id}
                title={panel === s.id ? `Close ${s.label}` : s.label}
              >
                <span className="ed-rail-icon"><EdIcon name={s.icon} size={19} /></span>
                <span className="ed-rail-label">{s.label}</span>
              </button>
            ))}
          </nav>

          <div className="ed-work">
            {readOnly && (
              <div className="ed-banner">
                <span>{readOnlyNote ?? 'This is a built-in example — open it to learn, but edits aren\'t saved.'}</span>
                <button type="button" className="btn btn-small btn-primary" onClick={cloneAndEdit}>
                  Clone &amp; edit
                </button>
              </div>
            )}
            <TableTab
              def={draft}
              onChange={onChange}
              onOpenCards={() => { cardsSectionRef.current = 'templates'; jumpToPanel('cards'); }}
            />
          </div>

          {panel !== null && (
            <section className={wide ? 'ed-panel ed-panel-wide' : 'ed-panel'} aria-label={`${panelLabel} panel`}>
              <header className="ed-panel-head">
                <h3>{panelLabel}</h3>
                <div className="spacer" />
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setWide((w) => !w)}
                  title={wide ? 'Narrow panel' : 'Widen panel'}
                  aria-label={wide ? 'Narrow panel' : 'Widen panel'}
                >
                  {wide ? '⇤' : '⤢'}
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => setPanel(null)}
                  aria-label={`Close ${panelLabel}`}
                >
                  ✕
                </button>
              </header>
              <div className="ed-panel-body">
                {readOnly && (
                  <div className="ed-banner ed-panel-readonly">
                    <span>Read-only — clone the game to make changes.</span>
                    <button type="button" className="btn btn-small btn-primary" onClick={cloneAndEdit}>
                      Clone &amp; edit
                    </button>
                  </div>
                )}
                {/* fieldset[disabled] switches off every control inside the
                    panel in read-only mode — no silently inert inputs. */}
                <fieldset className="ed-panel-fieldset" disabled={readOnly}>
                  {panel === 'info' && <InfoTab def={draft} onChange={onChange} />}
                  {panel === 'cards' && (
                    <CardsTab
                      def={draft}
                      onChange={onChange}
                      initialSection={consumeCardsSection()}
                    />
                  )}
                  {panel === 'types' && <TypesTab def={draft} onChange={onChange} />}
                  {panel === 'systems' && <SystemsTab def={draft} onChange={onChange} />}
                  {panel === 'actions' && <ActionsTab def={draft} onChange={onChange} onOpenSystems={() => jumpToPanel('systems')} />}
                  {panel === 'rules' && <RulesTab def={draft} onChange={onChange} />}
                  {panel === 'filters' && <FiltersTab def={draft} onChange={onChange} />}
                </fieldset>
              </div>
            </section>
          )}
        </div>
      </main>

      {issuesOpen && (
        <IssuesModal
          issues={issues}
          onClose={() => setIssuesOpen(false)}
          onOpen={(id) => { jumpToPanel(id); setIssuesOpen(false); }}
        />
      )}
    </>
  );
}

/**
 * Map a validation issue's `where` prefix to the panel that owns the item.
 * Returns null for issues that live on the canvas itself (table layout,
 * mobile screen, card-state chrome) — those rows stay plain text.
 */
function sectionForIssue(where: string): SectionId | null {
  if (where.startsWith('Game info') || where.startsWith('Deck "')) return 'info';
  if (where.startsWith('Card type "') || where.startsWith('Tag "')) return 'types';
  if (where.startsWith('Card state')) return null;
  if (where.startsWith('Card "')) return 'cards';
  if (where.startsWith('Systems') || where.startsWith('Phase "') || where.startsWith('Zone "')) return 'systems';
  if (where.startsWith('Action "')) return 'actions';
  if (where.startsWith('Rule "') || where.startsWith('End condition "')) return 'rules';
  if (where.startsWith('Filter "')) return 'filters';
  return null;
}

function IssuesModal({ issues, onClose, onOpen }: {
  issues: ValidationIssue[];
  onClose: () => void;
  onOpen: (id: SectionId) => void;
}) {
  return (
    <Modal
      title="Issues"
      onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Close</button>}
    >
      <p className="faint">Errors block playing the game; warnings are advice. Click an issue to open the panel it lives in.</p>
      {issues.map((issue, i) => {
        const section = sectionForIssue(issue.where);
        const body = (
          <>
            <span className={issue.severity === 'error' ? 'chip error' : 'chip warn'}>
              {issue.severity}
            </span>
            <div>
              <div className="ed-issue-where">{issue.where}</div>
              <div>{issue.message}</div>
            </div>
          </>
        );
        return section ? (
          <button type="button" className="ed-issue ed-issue-btn" key={i} onClick={() => onOpen(section)}>
            {body}
            <span className="ed-issue-go" aria-hidden="true">›</span>
          </button>
        ) : (
          <div className="ed-issue" key={i}>{body}</div>
        );
      })}
    </Modal>
  );
}
