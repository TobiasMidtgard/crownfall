/**
 * BlockScriptEditor — the visual scripting surface. Edits a Block[] tree.
 * Used by: flow editor (setup/phases), action editor, trigger editor, and the
 * card designer (abilities).
 *
 * v3: TWO views of the same tree, toggled top-right and remembered on the
 * device — "Sentences" (Tablewright-style prose rows: "then move cards …"
 * with inline blanks) and "Graph" (the Unreal-Blueprints node canvas). Both
 * are deterministic projections of the Block[]/Expr tree; the engine/storage
 * format is unchanged and the props contract is identical to v1, so every
 * call site keeps working untouched.
 */
import { useState } from 'react';
import type { Block, GameDef } from '../../shared/types';
import { GraphCanvas } from './GraphCanvas';
import { SentenceScript } from './SentenceScript';
import './graph.css';

export interface BlockScriptEditorProps {
  def: GameDef;
  value: Block[];
  onChange: (blocks: Block[]) => void;
  /** Context bindings available in this script, e.g. ['$card', '$player']. */
  bindings?: string[];
}

type ScriptView = 'sentence' | 'graph';

const VIEW_KEY = 'cardsmith.script-view';

function readView(): ScriptView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'graph' ? 'graph' : 'sentence';
  } catch {
    return 'sentence';
  }
}

export function BlockScriptEditor({ def, value, onChange, bindings = [] }: BlockScriptEditorProps) {
  const [view, setView] = useState<ScriptView>(readView);
  const pick = (v: ScriptView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch { /* device preference only */ }
  };
  return (
    <div className="bse-root">
      <div className="bse-viewbar" role="tablist" aria-label="Script view">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'sentence'}
          className={view === 'sentence' ? 'bse-view on' : 'bse-view'}
          onClick={() => pick('sentence')}
        >
          Sentences
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'graph'}
          className={view === 'graph' ? 'bse-view on' : 'bse-view'}
          onClick={() => pick('graph')}
        >
          Graph
        </button>
      </div>
      {view === 'sentence'
        ? <SentenceScript def={def} value={value} onChange={onChange} bindings={bindings} />
        : <GraphCanvas def={def} value={value} onChange={onChange} bindings={bindings} />}
    </div>
  );
}
