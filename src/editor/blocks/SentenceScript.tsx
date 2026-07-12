/**
 * SentenceScript — the Tablewright-style prose view of a Block[] script.
 *
 * A SECOND projection of the same tree the node graph edits (graphModel's
 * BlockPath ops; the storage format never changes): every block renders as
 * one sentence — "then <verb> <blank> <blank> …" — whose blanks are the same
 * inline (value, onChange) controls the graph uses (ExecFieldControl,
 * InlineSlotValue, ExpressionEditor), so both views stay lossless and in
 * sync. Container lanes (if/then/else, loop bodies) indent beneath their
 * sentence with a spine, Tablewright-style.
 *
 * The sentence row schema comes from execNodeRows — the graph's own single
 * source of truth — so new block kinds appear here automatically; SLOT_WORDS
 * only swaps a data slot's label for a nicer connective word.
 */
import { useState } from 'react';
import type { Block, Expr, GameDef } from '../../shared/types';
import { ExpressionEditor } from './ExpressionEditor';
import { ExecFieldControl, InlineSlotValue } from './NodeBody';
import { NodePicker } from './NodePicker';
import { blockMeta } from './registry';
import {
  type BlockPath, type DataSlotSpec, type ExecPinLoc, type LaneName,
  blockLanes, execNodeRows, getLaneOf, insertBlockAt, laneBindings,
  mergeBindings, moveBlock, removeBlock, updateBlockAt,
} from './graphModel';

export interface SentenceScriptProps {
  def: GameDef;
  value: Block[];
  onChange: (blocks: Block[]) => void;
  bindings?: string[];
}

/** Nicer connective words for data slots, by block kind then slot key. */
const SLOT_WORDS: Partial<Record<Block['kind'], Record<string, string>>> = {
  draw: { who: 'who', count: '×' },
  deal: { count: '×' },
  if: { cond: '' },
  repeat: { times: '×' },
  repeatWhile: { cond: '' },
  forEachCard: { filter: 'where' },
  chooseCards: { who: 'who', filter: 'where', min: 'min', max: 'max' },
  choosePile: { who: 'who', filter: 'where' },
  discardTo: { who: 'who', keep: 'keep' },
  choose: { who: 'who' },
  setVar: { value: 'to' },
  changeVar: { by: 'by' },
  triggerAbilities: { card: 'card' },
  setNextPlayer: { player: '' },
};

/** The sentence's leading keyword — Tablewright's brass "then"/"if". */
function keywordOf(block: Block): string {
  if (block.kind === 'if') return 'if';
  return 'then';
}

/** Lane captions read as prose ("then do / else", "do" for bodies). */
function laneWord(block: Block, lane: LaneName): string {
  if (block.kind === 'if') return lane === 'then' ? 'then' : 'else';
  return 'do';
}

/** The verb phrase after the keyword (label lowercased; if reads bare). */
function verbOf(block: Block): string {
  if (block.kind === 'if') return '';
  return blockMeta(block.kind).label.toLowerCase();
}

interface PickState {
  /** Where the picked block gets inserted. */
  loc: ExecPinLoc;
}

export function SentenceScript({ def, value, onChange, bindings = [] }: SentenceScriptProps) {
  const [pick, setPick] = useState<PickState | null>(null);

  return (
    <div className="sn-script">
      <SentenceLane
        def={def}
        root={value}
        lanePath={[]}
        blocks={value}
        bindings={bindings}
        onChange={onChange}
        onAdd={(loc) => setPick({ loc })}
      />
      {pick !== null && (
        <NodePicker
          def={def}
          request={{
            mode: 'block',
            title: 'Add an effect',
            onPick: (block) => {
              onChange(insertBlockAt(value, pick.loc, block));
              setPick(null);
            },
          }}
          onClose={() => setPick(null)}
        />
      )}
    </div>
  );
}

/** One lane (the root sequence or a container body), sentences + add line. */
function SentenceLane({ def, root, lanePath, blocks, bindings, onChange, onAdd }: {
  def: GameDef;
  /** The WHOLE tree (edit ops address into it via paths). */
  root: Block[];
  /** Path prefix of this lane ([] = root; [i, 'body'] = a container lane). */
  lanePath: BlockPath;
  /** The blocks living in this lane. */
  blocks: Block[];
  bindings: string[];
  onChange: (blocks: Block[]) => void;
  onAdd: (loc: ExecPinLoc) => void;
}) {
  const addLoc: ExecPinLoc = blocks.length === 0
    ? (lanePath.length === 0
      ? { kind: 'start' as const }
      : { kind: 'lane' as const, path: lanePath.slice(0, -1), lane: lanePath[lanePath.length - 1] as LaneName })
    : { kind: 'after' as const, path: [...lanePath, blocks.length - 1] };
  return (
    <>
      {blocks.map((block, i) => (
        <SentenceRow
          key={i}
          def={def}
          root={root}
          path={[...lanePath, i]}
          block={block}
          index={i}
          laneLen={blocks.length}
          bindings={bindings}
          onChange={onChange}
          onAdd={onAdd}
        />
      ))}
      <div className="sn-addline">
        <button type="button" className="btn btn-small" onClick={() => onAdd(addLoc)}>
          ＋ {lanePath.length === 0 && blocks.length === 0 ? 'first effect' : 'effect'}
        </button>
      </div>
    </>
  );
}

function SentenceRow({ def, root, path, block, index, laneLen, bindings, onChange, onAdd }: {
  def: GameDef;
  root: Block[];
  path: BlockPath;
  block: Block;
  index: number;
  laneLen: number;
  bindings: string[];
  onChange: (blocks: Block[]) => void;
  onAdd: (loc: ExecPinLoc) => void;
}) {
  const rows = execNodeRows(def, block);
  const lanes = blockLanes(block);
  const words = SLOT_WORDS[block.kind] ?? {};
  const patchBlock = (next: Block) => onChange(updateBlockAt(root, path, next));
  const patchSlot = (slot: DataSlotSpec, expr: Expr | null) =>
    patchBlock({ ...(block as unknown as Record<string, unknown>), [slot.key]: expr } as unknown as Block);
  const move = (dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= laneLen) return;
    const loc = dir === -1
      ? { kind: 'before' as const, path: [...path.slice(0, -1), target] }
      : { kind: 'after' as const, path: [...path.slice(0, -1), target] };
    const next = moveBlock(root, path, loc);
    if (next !== null) onChange(next);
  };
  const laneCount = lanes.reduce((n, l) => n + getLaneOf(block, l.lane).length, 0);

  return (
    <div className="sn-block">
      <div className="sn-line">
        <span className={`sn-kw sn-kw-${keywordOf(block)}`}>{keywordOf(block)}</span>
        {verbOf(block) !== '' && <span className="sn-verb">{verbOf(block)}</span>}
        {rows.map((row, ri) => {
          if (row.kind === 'lane') return null; // lanes render below the line
          if (row.kind === 'field') {
            // ExecFieldControl brings its own connective label (gr-flabel).
            return (
              <span className="sn-bit" key={ri}>
                <ExecFieldControl
                  def={def}
                  block={block}
                  fieldKey={row.field}
                  bindings={bindings}
                  onChange={patchBlock}
                />
              </span>
            );
          }
          const word = words[row.slot.key] ?? row.slot.label.toLowerCase();
          const slotValue = ((block as unknown as Record<string, unknown>)[row.slot.key] ?? null) as Expr | null;
          const slotBindings = mergeBindings(bindings, row.slot.addBindings);
          const literal = slotValue === null
            || slotValue.kind === 'num' || slotValue.kind === 'str' || slotValue.kind === 'bool';
          return (
            <span className="sn-bit" key={ri}>
              {word !== '' && <span className="sn-word">{word}</span>}
              {literal
                ? (
                  <InlineSlotValue
                    def={def}
                    slot={row.slot}
                    value={slotValue}
                    bindings={slotBindings}
                    onChange={(expr) => patchSlot(row.slot, expr)}
                  />
                )
                : (
                  <ExpressionEditor
                    def={def}
                    value={slotValue}
                    onChange={(expr) => patchSlot(row.slot, expr)}
                    bindings={slotBindings}
                    allowNull={row.slot.nullLabel !== undefined}
                    nullLabel={row.slot.nullLabel}
                  />
                )}
            </span>
          );
        })}
        <span className="sn-tools">
          <button type="button" className="sn-mini" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => move(-1)}>↑</button>
          <button type="button" className="sn-mini" title="Move down" aria-label="Move down" disabled={index === laneLen - 1} onClick={() => move(1)}>↓</button>
          <button
            type="button"
            className="sn-mini sn-mini-del"
            title={laneCount > 0 ? `Remove (and the ${laneCount} step${laneCount === 1 ? '' : 's'} inside)` : 'Remove'}
            aria-label="Remove step"
            onClick={() => onChange(removeBlock(root, path, false))}
          >
            ✕
          </button>
        </span>
      </div>
      {lanes.map(({ lane }) => (
        <div className="sn-lane" key={lane}>
          <span className="sn-lane-word">{laneWord(block, lane)}</span>
          <div className="sn-lane-body">
            <SentenceLane
              def={def}
              root={root}
              lanePath={[...path, lane]}
              blocks={getLaneOf(block, lane)}
              bindings={mergeBindings(bindings, laneBindings(block, lane))}
              onChange={onChange}
              onAdd={onAdd}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
