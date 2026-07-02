/**
 * graphModel — the pure (DOM-free) model behind the node-graph script editor.
 *
 * The graph is a deterministic PROJECTION of the existing Block[]/Expr tree —
 * the engine/storage format never changes:
 *   - Exec nodes = blocks. The sequence runs left→right; every exec node has
 *     a white exec-in pin (header left) and an exec-out pin (header right)
 *     that continues the parent sequence ("After"). Container blocks expose
 *     extra labeled exec-out pins (If → Then/Else; loops & chooseCards →
 *     Body) whose lanes are laid out BELOW the container, indented one step.
 *   - Data nodes = non-literal expressions, hanging ABOVE/LEFT of their
 *     consumer's typed input pin (one column per expression depth). Literals
 *     (num/str/bool) and enum-ish fields stay inline on the node body and
 *     never become nodes.
 *
 * Layout is recomputed from the tree on every change (same tree → same
 * picture; nothing is persisted). All edit operations are immutable and
 * return a new Block[] tree.
 */
import type { Block, Expr, GameDef } from '../../shared/types';
import { deepClone } from '../../shared/defaults';
import { insertAt, removeAt, updateAt } from '../lib';
import { EXPRS, blockMeta, defaultCardExpr, exprMeta } from './registry';

// ---------------------------------------------------------------------------
// Paths & basic tree access
// ---------------------------------------------------------------------------

export type LaneName = 'then' | 'else' | 'body';

/** Address of a block: indices and lane names, alternating: [1, 'body', 0]. */
export type BlockPath = (number | LaneName)[];

/** Address of an expression: a block plus a chain of slot keys into it. */
export interface ExprPath {
  blockPath: BlockPath;
  /** slots[0] is a property of the block; the rest walk nested Exprs. */
  slots: string[];
}

export function blockNodeId(path: BlockPath): string {
  return `b:${path.join('.')}`;
}

export function exprNodeId(blockPath: BlockPath, slots: string[]): string {
  return `${blockNodeId(blockPath)}/${slots.join('/')}`;
}

/** Lanes (sub-sequences) a container block owns, in display order. */
export function blockLanes(block: Block): { lane: LaneName; label: string }[] {
  switch (block.kind) {
    case 'if': return [{ lane: 'then', label: 'Then' }, { lane: 'else', label: 'Else' }];
    case 'repeat':
    case 'forEachPlayer':
    case 'forEachCard':
    case 'chooseCards':
    case 'choosePile':
      return [{ lane: 'body', label: 'Body' }];
    default: return [];
  }
}

export function getLaneOf(block: Block, lane: LaneName): Block[] {
  if (block.kind === 'if') return lane === 'then' ? block.then : lane === 'else' ? block.else : [];
  if (block.kind === 'repeat' || block.kind === 'forEachPlayer' || block.kind === 'forEachCard'
    || block.kind === 'chooseCards' || block.kind === 'choosePile') {
    return lane === 'body' ? block.body : [];
  }
  return [];
}

function setLaneOf(block: Block, lane: LaneName, blocks: Block[]): Block {
  if (block.kind === 'if') {
    return lane === 'then' ? { ...block, then: blocks } : { ...block, else: blocks };
  }
  if (block.kind === 'repeat' || block.kind === 'forEachPlayer' || block.kind === 'forEachCard'
    || block.kind === 'chooseCards' || block.kind === 'choosePile') {
    return { ...block, body: blocks };
  }
  return block;
}

/** Context bindings a lane adds on top of its parent scope. */
export function laneBindings(block: Block, lane: LaneName): string[] {
  void lane;
  switch (block.kind) {
    case 'forEachPlayer': return ['$player'];
    case 'forEachCard': return ['$card'];
    case 'chooseCards': return ['$card'];
    case 'choosePile': return ['$card'];
    default: return [];
  }
}

export function mergeBindings(base: string[], extra?: string[]): string[] {
  if (!extra || extra.length === 0) return base;
  const out = [...base];
  for (const b of extra) if (!out.includes(b)) out.push(b);
  return out;
}

/** Immutable update of the lane (Block[]) at an even-length lane path. */
function withLane(blocks: Block[], lanePath: BlockPath, fn: (lane: Block[]) => Block[]): Block[] {
  if (lanePath.length === 0) return fn(blocks);
  const idx = lanePath[0] as number;
  const lane = lanePath[1] as LaneName;
  const block = blocks[idx];
  if (!block) return blocks;
  const updated = setLaneOf(block, lane, withLane(getLaneOf(block, lane), lanePath.slice(2), fn));
  return updateAt(blocks, idx, updated);
}

export function getBlockAt(blocks: Block[], path: BlockPath): Block | null {
  let lane = blocks;
  for (let i = 0; i < path.length; i += 2) {
    const block = lane[path[i] as number];
    if (!block) return null;
    if (i === path.length - 1) return block;
    lane = getLaneOf(block, path[i + 1] as LaneName);
  }
  return null;
}

export function updateBlockAt(blocks: Block[], path: BlockPath, next: Block): Block[] {
  const idx = path[path.length - 1] as number;
  return withLane(blocks, path.slice(0, -1), (lane) => updateAt(lane, idx, next));
}

// ---------------------------------------------------------------------------
// Pin typing
// ---------------------------------------------------------------------------

export type PinType = 'number' | 'text' | 'boolean' | 'card' | 'player' | 'zone' | 'any';

/** Color token per data pin type (exec pins are white/text-colored). */
export const PIN_COLOR: Record<PinType, string> = {
  number: '--cat-vars',
  text: '--cat-expr',
  boolean: '--cat-control',
  card: '--cat-cards',
  player: '--cat-players',
  zone: '--cat-game',
  any: '--muted',
};

export function isTypeCompatible(pin: PinType, out: PinType): boolean {
  return pin === 'any' || out === 'any' || pin === out;
}

export function isLiteral(expr: Expr): boolean {
  return expr.kind === 'num' || expr.kind === 'str' || expr.kind === 'bool';
}

function bindingOutType(name: string): PinType {
  if (name === '$card' || name === '$self') return 'card';
  if (name === '$player' || name === '$owner') return 'player';
  if (name === '$fromZone' || name === '$toZone' || name === '$zone') return 'zone';
  if (name === '$tag') return 'text';
  return 'any';
}

/** Value type an expression produces (refined by def where possible). */
export function exprOutType(def: GameDef, expr: Expr): PinType {
  switch (expr.kind) {
    case 'num': case 'random': case 'zoneCount': case 'countCards': case 'sumCards': case 'math':
    case 'turnNumber': case 'playerCount': case 'stackSize':
    case 'phaseIndex': case 'phasePos':
      return 'number';
    case 'str': return 'text';
    case 'bool': case 'compare': case 'logic': case 'not': case 'phaseIs':
    case 'cardTypeIs': case 'cardHasTag': case 'filterRef':
      return 'boolean';
    case 'topCard': case 'bestCard': case 'stackTopCard': return 'card';
    case 'currentPlayer': case 'nextPlayer': case 'cardOwner': return 'player';
    case 'cardZoneId': return 'zone';
    case 'cardField': return 'any';
    case 'getVar': {
      const v = def.variables.find((x) => x.id === expr.varId);
      return v ? (v.type === 'string' ? 'text' : v.type) : 'any';
    }
    case 'binding': return bindingOutType(expr.name);
  }
}

/** Best-known output type per expression KIND (for picker filtering). */
export function exprKindOutType(kind: Expr['kind']): PinType {
  switch (kind) {
    case 'num': case 'random': case 'zoneCount': case 'countCards': case 'sumCards': case 'math':
    case 'turnNumber': case 'playerCount': case 'stackSize':
    case 'phaseIndex': case 'phasePos':
      return 'number';
    case 'str': return 'text';
    case 'bool': case 'compare': case 'logic': case 'not': case 'phaseIs':
    case 'cardTypeIs': case 'cardHasTag': case 'filterRef':
      return 'boolean';
    case 'topCard': case 'bestCard': case 'stackTopCard': return 'card';
    case 'currentPlayer': case 'nextPlayer': case 'cardOwner': return 'player';
    case 'cardZoneId': return 'zone';
    case 'cardField': case 'getVar': case 'binding': return 'any';
  }
}

// ---------------------------------------------------------------------------
// Node rows: pins + inline fields, the single source of truth for both the
// layout (row index → pin position) and the rendered node body.
// ---------------------------------------------------------------------------

export interface DataSlotSpec {
  /** Property name holding the Expr (or Expr|null) on the host block/expr. */
  key: string;
  label: string;
  type: PinType;
  /** Present ⇒ the slot may be null; shown with this label when it is. */
  nullLabel?: string;
  /** Extra bindings available inside this slot's expression (e.g. $card). */
  addBindings?: string[];
}

export type NodeRow =
  | { kind: 'lane'; lane: LaneName; label: string }
  | { kind: 'data'; slot: DataSlotSpec }
  | { kind: 'field'; field: string };

const data = (key: string, label: string, type: PinType, extra?: Partial<DataSlotSpec>): NodeRow =>
  ({ kind: 'data', slot: { key, label, type, ...extra } });
const field = (f: string): NodeRow => ({ kind: 'field', field: f });

function varSlotType(def: GameDef, varId: string): PinType {
  const v = def.variables.find((x) => x.id === varId);
  return v ? (v.type === 'string' ? 'text' : v.type) : 'any';
}

/** Ordered rows of an exec node (pins, then container lane pins last). */
export function execNodeRows(def: GameDef, block: Block): NodeRow[] {
  const lanes = blockLanes(block).map((l): NodeRow => ({ kind: 'lane', lane: l.lane, label: l.label }));
  switch (block.kind) {
    case 'moveCards': return [field('cards'), field('from'), field('to'), field('placement'), field('tag')];
    case 'draw': return [
      data('who', 'Who', 'player', { nullLabel: 'current player' }),
      data('count', 'Count', 'number'),
      field('from'),
      field('refillFrom'),
      field('to'),
      field('facing'),
      field('tag'),
    ];
    case 'shuffle': return [field('zone')];
    case 'deal': return [data('count', 'Count', 'number'), field('from'), field('toZoneId')];
    case 'setVar': return [field('varTarget'), data('value', 'Value', varSlotType(def, block.varId))];
    case 'changeVar': return [field('varTarget'), data('by', 'By', 'number')];
    case 'if': return [data('cond', 'Condition', 'boolean'), ...lanes];
    case 'repeat': return [data('times', 'Times', 'number'), ...lanes];
    case 'forEachPlayer': return [...lanes];
    case 'forEachCard': return [
      field('zone'),
      data('filter', 'Where', 'boolean', { nullLabel: 'every card', addBindings: ['$card'] }),
      ...lanes,
    ];
    case 'choose': return [data('who', 'Who', 'player', { nullLabel: 'current player' }), field('choice')];
    case 'chooseCards': return [
      data('who', 'Who', 'player', { nullLabel: 'current player' }),
      field('from'),
      data('filter', 'Where', 'boolean', { nullLabel: 'any card', addBindings: ['$card'] }),
      data('min', 'Min', 'number'),
      data('max', 'Max', 'number'),
      field('prompt'),
      field('revealed'),
      ...lanes,
    ];
    case 'choosePile': return [
      data('who', 'Who', 'player', { nullLabel: 'current player' }),
      field('from'),
      data('filter', 'Where', 'boolean', { nullLabel: 'any card', addBindings: ['$card'] }),
      field('prompt'),
      field('optional'),
      field('revealed'),
      ...lanes,
    ];
    case 'triggerAbilities': return [data('card', 'Card', 'card'), field('zoneId')];
    case 'cancelTopEffect': return [field('cardTo')];
    case 'announce': return [field('parts')];
    case 'flipCards': return [field('cards'), field('zone'), field('facing')];
    case 'endPhase': case 'endTurn': return [];
    case 'setNextPlayer': return [data('player', 'Player', 'player')];
    case 'endGame': return [field('winner')];
  }
}

/** Ordered rows of a data (expression) node. */
export function exprNodeRows(def: GameDef, expr: Expr): NodeRow[] {
  switch (expr.kind) {
    case 'getVar': {
      const v = def.variables.find((x) => x.id === expr.varId);
      const rows: NodeRow[] = [field('var')];
      if (v?.scope === 'perPlayer') rows.push(data('target', 'Whose', 'player', { nullLabel: 'contextual' }));
      else if (v?.scope === 'perCard') rows.push(data('target', 'Of card', 'card', { nullLabel: 'contextual' }));
      else if (!v && expr.target) rows.push(data('target', 'Of', 'any', { nullLabel: 'contextual' }));
      return rows;
    }
    case 'zoneCount': case 'topCard': return [field('zone')];
    case 'countCards': return [
      field('zone'),
      data('filter', 'Where', 'boolean', { nullLabel: 'every card', addBindings: ['$card'] }),
    ];
    case 'sumCards': return [
      field('fieldId'),
      field('zone'),
      data('filter', 'Where', 'boolean', { nullLabel: 'every card', addBindings: ['$card'] }),
    ];
    case 'bestCard': return [
      field('byField'),
      field('zone'),
      data('filter', 'Where', 'boolean', { nullLabel: 'any card', addBindings: ['$card'] }),
    ];
    case 'cardField': return [data('card', 'Card', 'card'), field('fieldId')];
    case 'cardOwner': case 'cardZoneId': return [data('card', 'Card', 'card')];
    case 'cardTypeIs': return [data('card', 'Card', 'card'), field('typeId')];
    case 'cardHasTag': return [data('card', 'Card', 'card'), field('tagId')];
    case 'filterRef': return [data('card', 'Card', 'card'), field('filterId')];
    case 'nextPlayer': return [data('from', 'After', 'player')];
    case 'math': return [data('left', 'A', 'number'), field('op'), data('right', 'B', 'number')];
    case 'compare': return [data('left', 'A', 'any'), field('op'), data('right', 'B', 'any')];
    case 'logic': return [data('left', 'A', 'boolean'), field('op'), data('right', 'B', 'boolean')];
    case 'not': return [data('expr', 'Value', 'boolean')];
    case 'random': return [data('max', 'Max', 'number')];
    case 'binding': return [field('name')];
    case 'phasePos': case 'phaseIs': return [field('phaseId')];
    default: return [];
  }
}

export function blockDataSlots(def: GameDef, block: Block): DataSlotSpec[] {
  return execNodeRows(def, block).flatMap((r) => (r.kind === 'data' ? [r.slot] : []));
}

export function exprDataSlots(def: GameDef, expr: Expr): DataSlotSpec[] {
  return exprNodeRows(def, expr).flatMap((r) => (r.kind === 'data' ? [r.slot] : []));
}

// ---------------------------------------------------------------------------
// Expressions: reads/writes through slot chains
// ---------------------------------------------------------------------------

type AnyHost = Record<string, unknown>;

function exprInHost(host: Block | Expr, slots: string[]): Expr | null {
  let cur: unknown = host;
  for (const key of slots) {
    if (!cur || typeof cur !== 'object') return null;
    cur = (cur as AnyHost)[key];
  }
  return (cur as Expr | null | undefined) ?? null;
}

function withExprInHost<T extends Block | Expr>(host: T, slots: string[], value: Expr | null): T {
  const [key, ...rest] = slots;
  if (rest.length === 0) return { ...(host as AnyHost), [key]: value } as T;
  const child = (host as AnyHost)[key] as Expr;
  return { ...(host as AnyHost), [key]: withExprInHost(child, rest, value) } as T;
}

export function getExprAt(blocks: Block[], path: ExprPath): Expr | null {
  const block = getBlockAt(blocks, path.blockPath);
  return block ? exprInHost(block, path.slots) : null;
}

/** Replace the expression at a slot path (data-pin connect/disconnect). */
export function setExprAt(blocks: Block[], path: ExprPath, expr: Expr | null): Block[] {
  const block = getBlockAt(blocks, path.blockPath);
  if (!block) return blocks;
  return updateBlockAt(blocks, path.blockPath, withExprInHost(block, path.slots, expr));
}

/** The slot spec a data node plugs into (its consumer's input pin). */
export function consumerSlotOf(def: GameDef, blocks: Block[], path: ExprPath): DataSlotSpec | null {
  const block = getBlockAt(blocks, path.blockPath);
  if (!block) return null;
  const key = path.slots[path.slots.length - 1];
  if (path.slots.length === 1) {
    return blockDataSlots(def, block).find((s) => s.key === key) ?? null;
  }
  const parent = exprInHost(block, path.slots.slice(0, -1));
  if (!parent) return null;
  return exprDataSlots(def, parent).find((s) => s.key === key) ?? null;
}

/** Sensible replacement when a required input is disconnected. */
export function defaultExprForSlot(def: GameDef, slot: DataSlotSpec, bindings: string[]): Expr | null {
  if (slot.nullLabel !== undefined) return null;
  switch (slot.type) {
    case 'number': return { kind: 'num', value: 1 };
    case 'text': return { kind: 'str', value: '' };
    case 'boolean': return { kind: 'bool', value: true };
    case 'card': return defaultCardExpr(def, bindings);
    case 'player': return { kind: 'currentPlayer' };
    case 'zone': case 'any': return { kind: 'num', value: 0 };
  }
}

const EXPR_KIND_SET: Set<string> = new Set(EXPRS.map((m) => m.kind));

/** Number of expression nodes in a subtree (≥2 ⇒ worth confirming a replace). */
export function exprWeight(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  let n = 0;
  if (!Array.isArray(value)) {
    const kind = (value as { kind?: unknown }).kind;
    if (typeof kind === 'string' && EXPR_KIND_SET.has(kind)) n += 1;
  }
  for (const v of Object.values(value)) n += exprWeight(v);
  return n;
}

// ---------------------------------------------------------------------------
// Exec edit operations
// ---------------------------------------------------------------------------

/** Where an exec-out pin points: the insertion location it represents. */
export type ExecPinLoc =
  | { kind: 'start' }                                  // before the first root block
  | { kind: 'after'; path: BlockPath }                 // sequence pin of a block
  | { kind: 'before'; path: BlockPath }                // exec-in side (insert before)
  | { kind: 'lane'; path: BlockPath; lane: LaneName }; // head of a container lane

export function insertBlockAt(blocks: Block[], loc: ExecPinLoc, block: Block): Block[] {
  switch (loc.kind) {
    case 'start': return [block, ...blocks];
    case 'before': {
      const idx = loc.path[loc.path.length - 1] as number;
      return withLane(blocks, loc.path.slice(0, -1), (lane) => insertAt(lane, idx, block));
    }
    case 'after': {
      const idx = loc.path[loc.path.length - 1] as number;
      return withLane(blocks, loc.path.slice(0, -1), (lane) => insertAt(lane, idx + 1, block));
    }
    case 'lane':
      return withLane(blocks, [...loc.path, loc.lane], (lane) => [block, ...lane]);
  }
}

/** Append at the end of the root sequence (toolbar "+", empty-canvas picker). */
export function appendLoc(blocks: Block[]): ExecPinLoc {
  return blocks.length === 0 ? { kind: 'start' } : { kind: 'after', path: [blocks.length - 1] };
}

/**
 * Delete a block; the exec chain re-links around it. With `keepBodies`, a
 * container's lane contents are spliced inline in its place (then+else, or
 * body).
 */
export function removeBlock(blocks: Block[], path: BlockPath, keepBodies: boolean): Block[] {
  const idx = path[path.length - 1] as number;
  return withLane(blocks, path.slice(0, -1), (lane) => {
    const block = lane[idx];
    if (!block) return lane;
    if (!keepBodies) return removeAt(lane, idx);
    const contents = block.kind === 'if' ? [...block.then, ...block.else] : getLaneOf(block, 'body');
    return [...lane.slice(0, idx), ...contents, ...lane.slice(idx + 1)];
  });
}

export function duplicateBlockAt(blocks: Block[], path: BlockPath): Block[] {
  const block = getBlockAt(blocks, path);
  if (!block) return blocks;
  return insertBlockAt(blocks, { kind: 'after', path }, deepClone(block));
}

function isPrefix(prefix: BlockPath, path: BlockPath): boolean {
  return prefix.length <= path.length && prefix.every((v, i) => path[i] === v);
}

function adjustPathAfterRemoval(path: BlockPath, removed: BlockPath): BlockPath {
  const L = removed.length;
  if (
    path.length >= L
    && removed.slice(0, L - 1).every((v, i) => path[i] === v)
    && (path[L - 1] as number) > (removed[L - 1] as number)
  ) {
    const copy = [...path];
    copy[L - 1] = (copy[L - 1] as number) - 1;
    return copy;
  }
  return path;
}

/**
 * Re-route an exec wire: move the block at `fromPath` (with its lanes) so it
 * follows the given pin. Returns null when the move is impossible (the pin
 * lives inside the moved block's own subtree, or the block is missing).
 */
export function moveBlock(blocks: Block[], fromPath: BlockPath, loc: ExecPinLoc): Block[] | null {
  if (loc.kind !== 'start' && isPrefix(fromPath, loc.path)) return null;
  const block = getBlockAt(blocks, fromPath);
  if (!block) return null;
  const without = removeBlock(blocks, fromPath, false);
  const adjusted: ExecPinLoc = loc.kind === 'start'
    ? loc
    : { ...loc, path: adjustPathAfterRemoval(loc.path, fromPath) };
  return insertBlockAt(without, adjusted, block);
}

// ---------------------------------------------------------------------------
// Projection: tree → nodes + wires with deterministic auto-layout
// ---------------------------------------------------------------------------

/** Layout constants (px at zoom 1). */
export const G = {
  EXEC_W: 250, DATA_W: 215, START_W: 104,
  HEADER_H: 34, ROW_H: 34, PAD: 8,
  GAP_X: 64, GAP_Y: 26, LANE_INDENT: 48, LANE_GAP: 26,
  DATA_COL_GAP: 30, DATA_ROW_GAP: 14, MARGIN: 24,
} as const;

export function nodeHeight(rows: NodeRow[]): number {
  return G.HEADER_H + rows.length * G.ROW_H + (rows.length > 0 ? G.PAD : 0);
}

export interface GraphNode {
  id: string;
  role: 'start' | 'exec' | 'data';
  blockPath?: BlockPath;
  exprPath?: ExprPath;
  label: string;
  /** CSS color value, e.g. 'var(--cat-control)'. */
  color: string;
  rows: NodeRow[];
  block?: Block;
  expr?: Expr;
  outType?: PinType;
  /** Context bindings in scope at this node. */
  bindings: string[];
  x: number; y: number; w: number; h: number;
}

export interface PinRef { nodeId: string; pin: string }

export interface Wire {
  id: string;
  kind: 'exec' | 'data';
  /** Data wires: the type used for coloring. */
  type?: PinType;
  from: PinRef;
  to: PinRef;
  x1: number; y1: number; x2: number; y2: number;
}

export interface Graph {
  nodes: GraphNode[];
  wires: Wire[];
  width: number;
  height: number;
}

export function getNode(graph: Graph, id: string): GraphNode | null {
  return graph.nodes.find((n) => n.id === id) ?? null;
}

/** Center of a pin in stage coordinates (must match the CSS row metrics). */
export function pinPosition(node: GraphNode, pin: string): { x: number; y: number } {
  const headerY = node.y + G.HEADER_H / 2;
  if (pin === 'execIn') return { x: node.x, y: headerY };
  if (pin === 'execOut' || pin === 'out') return { x: node.x + node.w, y: headerY };
  const idx = node.rows.findIndex((r) => pin.startsWith('lane:')
    ? r.kind === 'lane' && r.lane === pin.slice(5)
    : r.kind === 'data' && r.slot.key === pin.slice(3));
  const y = node.y + G.HEADER_H + Math.max(0, idx) * G.ROW_H + G.ROW_H / 2;
  return { x: pin.startsWith('in:') ? node.x : node.x + node.w, y };
}

interface DataSpec {
  id: string;
  expr: Expr;
  slots: string[];
  depth: number;
  rows: NodeRow[];
  bindings: string[];
  consumerId: string;
  consumerPin: string;
  outType: PinType;
  pinType: PinType;
  h: number;
  relX: number;
  relY: number;
}

interface RawWire { kind: 'exec' | 'data'; type?: PinType; from: PinRef; to: PinRef }

export function projectGraph(def: GameDef, blocks: Block[], rootBindings: string[] = []): Graph {
  const nodes: GraphNode[] = [];
  const rawWires: RawWire[] = [];

  /** DFS-collect the data nodes hanging off one host (block or expr). */
  function collectData(
    host: Block | Expr, isBlock: boolean, baseSlots: string[], hostId: string,
    blockPath: BlockPath, depth: number, bindings: string[], out: DataSpec[],
  ): void {
    const slots = isBlock ? blockDataSlots(def, host as Block) : exprDataSlots(def, host as Expr);
    for (const slot of slots) {
      const e = (host as unknown as AnyHost)[slot.key] as Expr | null | undefined;
      if (!e || isLiteral(e)) continue;
      const slotBindings = mergeBindings(bindings, slot.addBindings);
      const mySlots = [...baseSlots, slot.key];
      const id = exprNodeId(blockPath, mySlots);
      const rows = exprNodeRows(def, e);
      out.push({
        id, expr: e, slots: mySlots, depth, rows, bindings: slotBindings,
        consumerId: hostId, consumerPin: `in:${slot.key}`,
        outType: exprOutType(def, e), pinType: slot.type,
        h: nodeHeight(rows), relX: 0, relY: 0,
      });
      collectData(e, false, mySlots, id, blockPath, depth + 1, slotBindings, out);
    }
  }

  /** Place a data tree relative to its exec node's top-left (mutates specs). */
  function placeDataTree(specs: DataSpec[]): { leftExtent: number; topExtent: number } {
    if (specs.length === 0) return { leftExtent: 0, topExtent: 0 };
    const byDepth = new Map<number, DataSpec[]>();
    let maxDepth = 1;
    for (const s of specs) {
      const col = byDepth.get(s.depth) ?? [];
      col.push(s);
      byDepth.set(s.depth, col);
      maxDepth = Math.max(maxDepth, s.depth);
    }
    let maxColH = 0;
    for (const [depth, col] of byDepth) {
      const colH = col.reduce((acc, s) => acc + s.h, 0) + (col.length - 1) * G.DATA_ROW_GAP;
      maxColH = Math.max(maxColH, colH);
      let y = -G.GAP_Y - colH; // bottom-aligned just above the consumer
      for (const s of col) {
        s.relX = -(depth - 1) * (G.DATA_W + G.DATA_COL_GAP);
        s.relY = y;
        y += s.h + G.DATA_ROW_GAP;
      }
    }
    return {
      leftExtent: (maxDepth - 1) * (G.DATA_W + G.DATA_COL_GAP),
      topExtent: maxColH + G.GAP_Y,
    };
  }

  function layoutLane(
    lane: Block[], lanePath: BlockPath, x0: number, y0: number,
    bindings: string[], prevPinInit: PinRef | null,
  ): { right: number; bottom: number; firstId: string | null } {
    if (lane.length === 0) return { right: x0, bottom: y0, firstId: null };

    const prelims = lane.map((block, i) => {
      const blockPath = [...lanePath, i] as BlockPath;
      const id = blockNodeId(blockPath);
      const rows = execNodeRows(def, block);
      const specs: DataSpec[] = [];
      collectData(block, true, [], id, blockPath, 1, bindings, specs);
      const { leftExtent, topExtent } = placeDataTree(specs);
      return { block, blockPath, id, rows, specs, leftExtent, topExtent, execH: nodeHeight(rows) };
    });

    const baseline = y0 + Math.max(0, ...prelims.map((p) => p.topExtent));
    let cursor = x0;
    let bottom = baseline;
    let prevPin = prevPinInit;
    let firstId: string | null = null;

    for (const p of prelims) {
      const execX = cursor + p.leftExtent;
      const execY = baseline;
      const meta = blockMeta(p.block.kind);
      nodes.push({
        id: p.id, role: 'exec', blockPath: p.blockPath, label: meta.label,
        color: `var(${meta.color})`, rows: p.rows, block: p.block, bindings,
        x: execX, y: execY, w: G.EXEC_W, h: p.execH,
      });
      firstId ??= p.id;

      for (const s of p.specs) {
        const eMeta = exprMeta(s.expr.kind);
        nodes.push({
          id: s.id, role: 'data', exprPath: { blockPath: p.blockPath, slots: s.slots },
          label: eMeta.label, color: `var(${eMeta.color})`, rows: s.rows, expr: s.expr,
          outType: s.outType, bindings: s.bindings,
          x: execX + s.relX, y: execY + s.relY, w: G.DATA_W, h: s.h,
        });
        rawWires.push({
          kind: 'data',
          type: s.outType !== 'any' ? s.outType : s.pinType,
          from: { nodeId: s.id, pin: 'out' },
          to: { nodeId: s.consumerId, pin: s.consumerPin },
        });
      }

      if (prevPin) rawWires.push({ kind: 'exec', from: prevPin, to: { nodeId: p.id, pin: 'execIn' } });

      let right = execX + G.EXEC_W;
      let below = execY + p.execH;
      for (const ln of blockLanes(p.block)) {
        const sub = layoutLane(
          getLaneOf(p.block, ln.lane), [...p.blockPath, ln.lane],
          execX + G.LANE_INDENT, below + G.LANE_GAP,
          mergeBindings(bindings, laneBindings(p.block, ln.lane)), null,
        );
        if (sub.firstId) {
          rawWires.push({
            kind: 'exec',
            from: { nodeId: p.id, pin: `lane:${ln.lane}` },
            to: { nodeId: sub.firstId, pin: 'execIn' },
          });
          below = sub.bottom;
          right = Math.max(right, sub.right);
        }
      }

      bottom = Math.max(bottom, below);
      cursor = right + G.GAP_X;
      prevPin = { nodeId: p.id, pin: 'execOut' };
    }

    return { right: cursor - G.GAP_X, bottom, firstId };
  }

  const start: GraphNode = {
    id: 'start', role: 'start', label: 'Start', color: 'var(--accent)',
    rows: [], bindings: rootBindings,
    x: G.MARGIN, y: G.MARGIN, w: G.START_W, h: G.HEADER_H,
  };
  nodes.push(start);

  const root = layoutLane(
    blocks, [], G.MARGIN + G.START_W + G.GAP_X, G.MARGIN,
    rootBindings, { nodeId: 'start', pin: 'execOut' },
  );
  if (root.firstId) {
    const first = nodes.find((n) => n.id === root.firstId);
    if (first) start.y = first.y; // top-align Start with the first block
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const wires: Wire[] = [];
  for (const w of rawWires) {
    const fromNode = byId.get(w.from.nodeId);
    const toNode = byId.get(w.to.nodeId);
    if (!fromNode || !toNode) continue;
    const a = pinPosition(fromNode, w.from.pin);
    const b = pinPosition(toNode, w.to.pin);
    wires.push({
      id: `${w.kind}:${w.to.nodeId}|${w.to.pin}`,
      kind: w.kind, type: w.type, from: w.from, to: w.to,
      x1: a.x, y1: a.y, x2: b.x, y2: b.y,
    });
  }

  let width = 0;
  let height = 0;
  for (const n of nodes) {
    width = Math.max(width, n.x + n.w);
    height = Math.max(height, n.y + n.h);
  }
  return { nodes, wires, width: width + G.MARGIN, height: height + G.MARGIN };
}

// ---------------------------------------------------------------------------
// Pin semantics (what connecting/picking on a pin means)
// ---------------------------------------------------------------------------

export type PinDesc =
  | { kind: 'execIn'; path: BlockPath }
  | { kind: 'execOut'; loc: ExecPinLoc }
  | { kind: 'dataIn'; path: ExprPath; slot: DataSlotSpec; bindings: string[] }
  | { kind: 'dataOut'; expr: Expr; outType: PinType };

export function describePin(graph: Graph, ref: PinRef): PinDesc | null {
  const node = getNode(graph, ref.nodeId);
  if (!node) return null;
  if (ref.pin === 'execIn') {
    return node.blockPath ? { kind: 'execIn', path: node.blockPath } : null;
  }
  if (ref.pin === 'execOut') {
    if (node.role === 'start') return { kind: 'execOut', loc: { kind: 'start' } };
    return node.blockPath ? { kind: 'execOut', loc: { kind: 'after', path: node.blockPath } } : null;
  }
  if (ref.pin === 'out') {
    return node.expr ? { kind: 'dataOut', expr: node.expr, outType: node.outType ?? 'any' } : null;
  }
  if (ref.pin.startsWith('lane:') && node.blockPath) {
    return { kind: 'execOut', loc: { kind: 'lane', path: node.blockPath, lane: ref.pin.slice(5) as LaneName } };
  }
  if (ref.pin.startsWith('in:')) {
    const key = ref.pin.slice(3);
    const row = node.rows.find((r) => r.kind === 'data' && r.slot.key === key);
    if (!row || row.kind !== 'data') return null;
    const path: ExprPath = node.role === 'exec'
      ? { blockPath: node.blockPath ?? [], slots: [key] }
      : { blockPath: node.exprPath?.blockPath ?? [], slots: [...(node.exprPath?.slots ?? []), key] };
    return { kind: 'dataIn', path, slot: row.slot, bindings: mergeBindings(node.bindings, row.slot.addBindings) };
  }
  return null;
}

/** Could connecting these two pins (either order) ever succeed? */
export function pinsCompatible(graph: Graph, a: PinRef, b: PinRef): boolean {
  const da = describePin(graph, a);
  const db = describePin(graph, b);
  if (!da || !db) return false;
  const pair = (x: PinDesc, y: PinDesc): boolean => {
    if (x.kind === 'execOut' && y.kind === 'execIn') {
      // Cannot route a block after a pin inside its own subtree.
      return x.loc.kind === 'start' || !isPrefix(y.path, x.loc.path);
    }
    if (x.kind === 'dataOut' && y.kind === 'dataIn') {
      return isTypeCompatible(y.slot.type, x.outType);
    }
    return false;
  };
  return pair(da, db) || pair(db, da);
}
