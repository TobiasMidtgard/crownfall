/**
 * BlockScriptEditor — the visual scripting surface. Edits a Block[] tree.
 * Used by: flow editor (setup/phases), action editor, trigger editor, and the
 * card designer (abilities).
 *
 * v2: renders an Unreal-Blueprints-style node graph (GraphCanvas). The graph
 * is a deterministic projection of the Block[]/Expr tree — same data, new
 * view; the engine/storage format is unchanged. The props contract is
 * identical to v1, so every call site keeps working untouched.
 */
import type { Block, GameDef } from '../../shared/types';
import { GraphCanvas } from './GraphCanvas';
import './graph.css';

export interface BlockScriptEditorProps {
  def: GameDef;
  value: Block[];
  onChange: (blocks: Block[]) => void;
  /** Context bindings available in this script, e.g. ['$card', '$player']. */
  bindings?: string[];
}

export function BlockScriptEditor({ def, value, onChange, bindings = [] }: BlockScriptEditorProps) {
  return <GraphCanvas def={def} value={value} onChange={onChange} bindings={bindings} />;
}
