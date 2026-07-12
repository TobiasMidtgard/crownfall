/**
 * GameEditorPage — ONE game-engine screen (#14). The WYSIWYG table canvas is
 * the editor: it stays mounted as the whole surface, and every other section
 * (Info | Cards | Types | Zones | Variables | Flow | Actions | Rules |
 * Filters) opens as a slide-over panel from the section rail on the left —
 * design the screen and tune rules/cards/zones side by side, no page swaps.
 * Heavy sections (Cards, Flow, Actions, Rules) open wide by default; ⇤/⤢
 * toggles the width, ✕ (or the rail button again) closes.
 * Loads the game by id, autosaves edits to the store (~400ms debounce),
 * validates live, and opens built-in examples read-only with "Clone & edit".
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameDef, ValidationIssue } from '../shared/types';
import { deepClone } from '../shared/defaults';
import { validateGameDef } from '../shared/validate';
import { cloneGame, getGameById, saveGame } from '../state/store';
import { CardsTab } from '../designer/CardsTab';
import { Modal } from './common/Modal';
import { EdIcon, type EdIconName } from './common/icons';
import { InfoTab } from './tabs/InfoTab';
import { TableTab } from './tabs/TableTab';
import { TypesTab } from './tabs/TypesTab';
import { ZonesTab } from './tabs/ZonesTab';
import { VariablesTab } from './tabs/VariablesTab';
import { FlowTab } from './tabs/FlowTab';
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
  { id: 'zones', label: 'Zones', icon: 'zone' },
  { id: 'variables', label: 'Vars', icon: 'variable' },
  { id: 'flow', label: 'Flow', icon: 'flow' },
  { id: 'actions', label: 'Actions', icon: 'actions' },
  { id: 'rules', label: 'Rules', icon: 'rules' },
  { id: 'filters', label: 'Filters', icon: 'filters' },
] as const satisfies readonly { id: string; label: string; icon: EdIconName }[];

type SectionId = (typeof SECTIONS)[number]['id'];

/** Sections that host big surfaces (card grids, node graphs) open wide. */
const WIDE_BY_DEFAULT: ReadonlySet<SectionId> = new Set(['cards', 'flow', 'actions', 'rules']);

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
      pendingRef.current = null;
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
      if (pendingRef.current) {
        saveGame(pendingRef.current);
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

  const issues = useMemo(() => (draft ? validateGameDef(draft) : []), [draft]);

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
        <span className="faint ed-save-hint">
          {readOnly ? 'read-only' : saveState === 'saved' ? 'Saved ✓' : 'Saving…'}
        </span>
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
                <button
                  type="button"
                  className="btn btn-small btn-primary"
                  onClick={() => {
                    const copy = cloneGame(draft);
                    navigate(`#/edit/${copy.meta.id}`);
                  }}
                >
                  Clone &amp; edit
                </button>
              </div>
            )}
            <TableTab
              def={draft}
              onChange={onChange}
              // Idempotent open (openPanel is the rail's TOGGLE — jumping to
              // Cards from the canvas must never close an already-open panel).
              onOpenCards={() => { setWide(WIDE_BY_DEFAULT.has('cards')); setPanel('cards'); }}
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
                {panel === 'info' && <InfoTab def={draft} onChange={onChange} />}
                {panel === 'cards' && <CardsTab def={draft} onChange={onChange} />}
                {panel === 'types' && <TypesTab def={draft} onChange={onChange} />}
                {panel === 'zones' && <ZonesTab def={draft} onChange={onChange} />}
                {panel === 'variables' && <VariablesTab def={draft} onChange={onChange} />}
                {panel === 'flow' && <FlowTab def={draft} onChange={onChange} />}
                {panel === 'actions' && <ActionsTab def={draft} onChange={onChange} />}
                {panel === 'rules' && <RulesTab def={draft} onChange={onChange} />}
                {panel === 'filters' && <FiltersTab def={draft} onChange={onChange} />}
              </div>
            </section>
          )}
        </div>
      </main>

      {issuesOpen && (
        <IssuesModal issues={issues} onClose={() => setIssuesOpen(false)} />
      )}
    </>
  );
}

function IssuesModal({ issues, onClose }: { issues: ValidationIssue[]; onClose: () => void }) {
  return (
    <Modal
      title="Issues"
      onClose={onClose}
      footer={<button type="button" className="btn btn-primary" onClick={onClose}>Close</button>}
    >
      <p className="faint">Errors block playing the game; warnings are advice.</p>
      {issues.map((issue, i) => (
        <div className="ed-issue" key={i}>
          <span className={issue.severity === 'error' ? 'chip error' : 'chip warn'}>
            {issue.severity}
          </span>
          <div>
            <div className="ed-issue-where">{issue.where}</div>
            <div>{issue.message}</div>
          </div>
        </div>
      ))}
    </Modal>
  );
}
