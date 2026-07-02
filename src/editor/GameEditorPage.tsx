/**
 * GameEditorPage — tabbed editor over one GameDef:
 * Info | Cards | Types | Zones | Table | Variables | Flow | Actions | Rules | Filters.
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

const TABS = [
  { id: 'info', label: 'Info' },
  { id: 'cards', label: 'Cards' },
  { id: 'types', label: 'Types' },
  { id: 'zones', label: 'Zones' },
  { id: 'table', label: 'Table' },
  { id: 'variables', label: 'Variables' },
  { id: 'flow', label: 'Flow' },
  { id: 'actions', label: 'Actions' },
  { id: 'rules', label: 'Rules' },
  { id: 'filters', label: 'Filters' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const SAVE_DEBOUNCE_MS = 400;

export function GameEditorPage({ gameId, navigate, readOnly: forcedReadOnly, readOnlyNote }: GameEditorPageProps) {
  const [draft, setDraft] = useState<GameDef | null>(() => {
    const game = getGameById(gameId);
    return game ? deepClone(game) : null;
  });
  const [tab, setTab] = useState<TabId>('info');
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'error'>('saved');
  const [issuesOpen, setIssuesOpen] = useState(false);

  const readOnly = !!draft?.meta.builtIn || !!forcedReadOnly;

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

  return (
    <>
      <header className="app-topbar ed-topbar">
        <button type="button" className="btn btn-ghost ed-back" onClick={() => { flushSave(); navigate('#/'); }} aria-label="Back to home">
          ←
        </button>
        <input
          type="text"
          className="ed-name"
          value={draft.meta.name}
          readOnly={readOnly}
          aria-label="Game name"
          onChange={(e) => onChange({ ...draft, meta: { ...draft.meta, name: e.target.value } })}
        />
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
      </header>

      <nav className="tabbar">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="app-main">
        <div className="page ed-page">
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

          {tab === 'info' && <InfoTab def={draft} onChange={onChange} />}
          {tab === 'cards' && <CardsTab def={draft} onChange={onChange} />}
          {tab === 'types' && <TypesTab def={draft} onChange={onChange} />}
          {tab === 'zones' && <ZonesTab def={draft} onChange={onChange} />}
          {tab === 'table' && <TableTab def={draft} onChange={onChange} />}
          {tab === 'variables' && <VariablesTab def={draft} onChange={onChange} />}
          {tab === 'flow' && <FlowTab def={draft} onChange={onChange} />}
          {tab === 'actions' && <ActionsTab def={draft} onChange={onChange} />}
          {tab === 'rules' && <RulesTab def={draft} onChange={onChange} />}
          {tab === 'filters' && <FiltersTab def={draft} onChange={onChange} />}
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
