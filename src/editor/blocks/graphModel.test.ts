/**
 * graphModel tests — pure logic, no DOM:
 *   - tree → graph projection (node/pin/wire lists, bindings, layout
 *     invariants, determinism) for a representative script (if + forEachCard
 *     + nested chooseCards)
 *   - edit operations (insert after a pin, delete relinks the chain, connect
 *     a data pin replaces the expression, container lane insertion, move)
 *     round-trip back to the expected Block[] JSON
 */
import { describe, expect, it } from 'vitest';
import type { Block, Expr, GameDef } from '../../shared/types';
import { deepClone } from '../../shared/defaults';
import {
  appendLoc, blockDataSlots, blockNodeId, describePin, duplicateBlockAt,
  execNodeRows, exprKindOutType, exprNodeId, exprNodeRows, exprWeight,
  getBlockAt, getExprAt, getNode, insertBlockAt, moveBlock, pinsCompatible,
  projectGraph, removeBlock, setExprAt,
} from './graphModel';

function fixture(): GameDef {
  return {
    schemaVersion: 1,
    meta: { id: 'g1', name: 'Test', description: '', minPlayers: 2, maxPlayers: 4 },
    variables: [
      { id: 'v_lead', name: 'lead suit', scope: 'global', type: 'string', initial: '' },
      { id: 'v_score', name: 'score', scope: 'perPlayer', type: 'number', initial: 0 },
    ],
    zones: [
      { id: 'z_trick', name: 'Trick', owner: 'shared', visibility: 'all', layout: 'row', area: 'center' },
      { id: 'z_hand', name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'fan', area: 'player' },
    ],
    decks: [],
    templates: [],
    cards: [],
    setup: [],
    phases: [{ id: 'ph_main', name: 'Main', onEnter: [], actionIds: [], mode: 'manual' }],
    actions: [],
    triggers: [],
    endConditions: [],
  };
}

const num = (value: number): Expr => ({ kind: 'num', value });

const condExpr = (): Expr => ({
  kind: 'compare', op: '==',
  left: { kind: 'zoneCount', zone: { zoneId: 'z_trick', owner: null } },
  right: num(0),
});

const cardFilter = (): Expr => ({
  kind: 'compare', op: '==',
  left: { kind: 'cardField', card: { kind: 'binding', name: '$card' }, fieldId: 'suit' },
  right: { kind: 'str', value: 'hearts' },
});

/** if + forEachCard + nested chooseCards — the representative script. */
function script(): Block[] {
  return [
    {
      kind: 'if', cond: condExpr(),
      then: [{ kind: 'shuffle', zone: { zoneId: 'z_trick', owner: null } }],
      else: [],
    },
    {
      kind: 'forEachCard', zone: { zoneId: 'z_hand', owner: null }, filter: null,
      body: [
        {
          kind: 'chooseCards', who: null, from: { zoneId: 'z_hand', owner: null },
          filter: cardFilter(), min: num(1), max: num(2),
          prompt: 'Pick cards', revealed: false,
          body: [{ kind: 'endPhase' }],
        },
      ],
    },
    { kind: 'endTurn' },
  ];
}

describe('projection: tree → nodes + wires', () => {
  const def = fixture();

  it('creates one exec node per block, plus Start, plus data nodes for non-literal exprs', () => {
    const g = projectGraph(def, script(), []);
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(ids).toEqual(new Set([
      'start',
      'b:0', 'b:0.then.0', 'b:1', 'b:1.body.0', 'b:1.body.0.body.0', 'b:2',
      'b:0/cond', 'b:0/cond/left',
      'b:1.body.0/filter', 'b:1.body.0/filter/left', 'b:1.body.0/filter/left/card',
    ]));
    // Literals (num/str/bool) stay inline — no nodes for min/max/right.
    expect(ids.has('b:1.body.0/min')).toBe(false);
    expect(ids.has('b:0/cond/right')).toBe(false);
  });

  it('wires the exec chain, container lanes, and data inputs', () => {
    const g = projectGraph(def, script(), []);
    const execWires = g.wires
      .filter((w) => w.kind === 'exec')
      .map((w) => `${w.from.nodeId}.${w.from.pin}->${w.to.nodeId}`);
    expect(new Set(execWires)).toEqual(new Set([
      'start.execOut->b:0',
      'b:0.lane:then->b:0.then.0',
      'b:0.execOut->b:1',                       // After continues the sequence
      'b:1.lane:body->b:1.body.0',
      'b:1.body.0.lane:body->b:1.body.0.body.0',
      'b:1.execOut->b:2',
    ]));
    const dataWires = g.wires
      .filter((w) => w.kind === 'data')
      .map((w) => `${w.from.nodeId}->${w.to.nodeId}:${w.to.pin}`);
    expect(new Set(dataWires)).toEqual(new Set([
      'b:0/cond->b:0:in:cond',
      'b:0/cond/left->b:0/cond:in:left',
      'b:1.body.0/filter->b:1.body.0:in:filter',
      'b:1.body.0/filter/left->b:1.body.0/filter:in:left',
      'b:1.body.0/filter/left/card->b:1.body.0/filter/left:in:card', // $card binding node
    ]));
  });

  it('scopes bindings: container lanes add them, filter slots add $card', () => {
    const g = projectGraph(def, script(), ['$self']);
    expect(getNode(g, 'b:0')?.bindings).toEqual(['$self']);
    expect(getNode(g, 'b:1.body.0')?.bindings).toEqual(['$self', '$card']);       // forEachCard body
    expect(getNode(g, 'b:1.body.0.body.0')?.bindings).toEqual(['$self', '$card']); // chooseCards body (dedup)
    expect(getNode(g, 'b:1.body.0/filter')?.bindings).toContain('$card');          // filter slot
    expect(getNode(g, 'b:0/cond')?.bindings).toEqual(['$self']);
  });

  it('lays out deterministically with exec left→right, lanes below, data above', () => {
    const a = projectGraph(def, script(), []);
    const b = projectGraph(def, script(), []);
    expect(JSON.parse(JSON.stringify(a))).toEqual(JSON.parse(JSON.stringify(b)));

    const node = (id: string) => getNode(a, id)!;
    // Exec chain advances in x, top-aligned on the lane baseline.
    expect(node('b:1').x).toBeGreaterThan(node('b:0').x);
    expect(node('b:2').x).toBeGreaterThan(node('b:1').x);
    expect(node('b:0').y).toBe(node('b:1').y);
    expect(node('b:2').y).toBe(node('b:1').y);
    // Lanes stack below their container, indented right.
    expect(node('b:0.then.0').y).toBeGreaterThan(node('b:0').y + node('b:0').h);
    expect(node('b:0.then.0').x).toBeGreaterThan(node('b:0').x);
    expect(node('b:1.body.0').y).toBeGreaterThan(node('b:1').y + node('b:1').h);
    // Data nodes sit fully above their consumer; depth pushes left.
    const cond = node('b:0/cond');
    expect(cond.y + cond.h).toBeLessThanOrEqual(node('b:0').y);
    expect(node('b:0/cond/left').x).toBeLessThan(cond.x);
    // Everything stays inside the reported bounds.
    for (const n of a.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.y).toBeGreaterThanOrEqual(0);
      expect(n.x + n.w).toBeLessThanOrEqual(a.width);
      expect(n.y + n.h).toBeLessThanOrEqual(a.height);
    }
    // Wire endpoints land on node edges.
    for (const w of a.wires) {
      expect(Number.isFinite(w.x1 + w.y1 + w.x2 + w.y2)).toBe(true);
    }
  });

  it('projects an empty script as just the Start node', () => {
    const g = projectGraph(fixture(), [], []);
    expect(g.nodes.map((n) => n.id)).toEqual(['start']);
    expect(g.wires).toEqual([]);
  });
});

describe('exec node rows (pins + lanes)', () => {
  const def = fixture();

  it('chooseCards exposes who/filter/min/max pins and a Body lane', () => {
    const rows = execNodeRows(def, script()[1] && (script()[1] as Extract<Block, { kind: 'forEachCard' }>).body[0]);
    const dataKeys = rows.flatMap((r) => (r.kind === 'data' ? [r.slot.key] : []));
    expect(dataKeys).toEqual(['who', 'filter', 'min', 'max']);
    expect(rows[rows.length - 1]).toEqual({ kind: 'lane', lane: 'body', label: 'Body' });
  });

  it('if exposes Then and Else lanes after the condition pin', () => {
    const rows = execNodeRows(def, script()[0]);
    expect(rows).toEqual([
      { kind: 'data', slot: { key: 'cond', label: 'Condition', type: 'boolean' } },
      { kind: 'lane', lane: 'then', label: 'Then' },
      { kind: 'lane', lane: 'else', label: 'Else' },
    ]);
  });

  it('setVar value pin takes its type from the variable', () => {
    const slots = blockDataSlots(def, { kind: 'setVar', varId: 'v_score', target: null, value: num(0) });
    expect(slots).toEqual([{ key: 'value', label: 'Value', type: 'number' }]);
  });

  it('choosePile exposes who/filter pins and a Body lane binding $card', () => {
    const block: Block = {
      kind: 'choosePile', who: null, from: { zoneId: 'z_trick', owner: null }, filter: null,
      groupBy: 'def', prompt: 'Gain', optional: false, body: [{ kind: 'endPhase' }],
    };
    const rows = execNodeRows(def, block);
    const dataKeys = rows.flatMap((r) => (r.kind === 'data' ? [r.slot.key] : []));
    expect(dataKeys).toEqual(['who', 'filter']);
    expect(rows[rows.length - 1]).toEqual({ kind: 'lane', lane: 'body', label: 'Body' });
    const g = projectGraph(def, [block], []);
    expect(getNode(g, 'b:0.body.0')?.bindings).toEqual(['$card']);
  });

  it('draw exposes who/count pins plus zone, facing and tag fields', () => {
    const block: Block = {
      kind: 'draw', who: null, count: num(1),
      from: { zoneId: 'z_trick', owner: null }, refillFrom: null,
      to: { zoneId: 'z_hand', owner: null }, faceUp: null,
    };
    const rows = execNodeRows(def, block);
    expect(rows.flatMap((r) => (r.kind === 'data' ? [r.slot.key] : []))).toEqual(['who', 'count']);
    expect(rows.flatMap((r) => (r.kind === 'field' ? [r.field] : [])))
      .toEqual(['from', 'refillFrom', 'to', 'facing', 'tag']);
  });

  it('sumCards is a number-typed data node', () => {
    expect(exprKindOutType('sumCards')).toBe('number');
    const rows = exprNodeRows(def, { kind: 'sumCards', zone: { zoneId: 'z_hand', owner: null }, fieldId: 'rank', filter: null });
    const filterRow = rows.find((r) => r.kind === 'data');
    expect(filterRow).toEqual({
      kind: 'data',
      slot: { key: 'filter', label: 'Where', type: 'boolean', nullLabel: 'every card', addBindings: ['$card'] },
    });
  });
});

describe('edit operations (round-trip to Block[] JSON)', () => {
  const def = fixture();

  it('inserts after an exec pin (the chain re-routes through the new node)', () => {
    const next = insertBlockAt(script(), { kind: 'after', path: [0] }, { kind: 'endPhase' });
    expect(next.map((b) => b.kind)).toEqual(['if', 'endPhase', 'forEachCard', 'endTurn']);
  });

  it('inserts at Start and before a block', () => {
    expect(insertBlockAt(script(), { kind: 'start' }, { kind: 'endPhase' })[0].kind).toBe('endPhase');
    const next = insertBlockAt(script(), { kind: 'before', path: [2] }, { kind: 'endPhase' });
    expect(next.map((b) => b.kind)).toEqual(['if', 'forEachCard', 'endPhase', 'endTurn']);
  });

  it('inserts at the head of a container lane', () => {
    const next = insertBlockAt(script(), { kind: 'lane', path: [0], lane: 'else' }, { kind: 'endTurn' });
    const ifBlock = next[0] as Extract<Block, { kind: 'if' }>;
    expect(ifBlock.else.map((b) => b.kind)).toEqual(['endTurn']);
    // deep lane insertion
    const deep = insertBlockAt(script(), { kind: 'lane', path: [1, 'body', 0], lane: 'body' }, { kind: 'endTurn' });
    const cc = getBlockAt(deep, [1, 'body', 0]) as Extract<Block, { kind: 'chooseCards' }>;
    expect(cc.body.map((b) => b.kind)).toEqual(['endTurn', 'endPhase']);
  });

  it('appendLoc targets the end of the root sequence', () => {
    const s = script();
    expect(insertBlockAt(s, appendLoc(s), { kind: 'endPhase' }).map((b) => b.kind))
      .toEqual(['if', 'forEachCard', 'endTurn', 'endPhase']);
    expect(appendLoc([])).toEqual({ kind: 'start' });
  });

  it('delete re-links the exec chain around the removed node', () => {
    expect(removeBlock(script(), [1], false).map((b) => b.kind)).toEqual(['if', 'endTurn']);
    const nested = removeBlock(script(), [1, 'body', 0], false);
    const fe = nested[1] as Extract<Block, { kind: 'forEachCard' }>;
    expect(fe.body).toEqual([]);
  });

  it('delete keep-contents splices lane bodies inline', () => {
    const s = script();
    // forEachCard keeps its chooseCards child in its place
    expect(removeBlock(s, [1], true).map((b) => b.kind)).toEqual(['if', 'chooseCards', 'endTurn']);
    // if splices then + else
    const withElse = insertBlockAt(s, { kind: 'lane', path: [0], lane: 'else' }, { kind: 'endPhase' });
    expect(removeBlock(withElse, [0], true).map((b) => b.kind))
      .toEqual(['shuffle', 'endPhase', 'forEachCard', 'endTurn']);
  });

  it('duplicate inserts a deep copy right after the original', () => {
    const next = duplicateBlockAt(script(), [0]);
    expect(next.map((b) => b.kind)).toEqual(['if', 'if', 'forEachCard', 'endTurn']);
    expect(next[1]).toEqual(next[0]);
    expect(next[1]).not.toBe(next[0]);
  });

  it('moveBlock re-routes an exec wire (connect out → existing in)', () => {
    // Connect if.After → endTurn.in: endTurn moves right after the if.
    const next = moveBlock(script(), [2], { kind: 'after', path: [0] });
    expect(next?.map((b) => b.kind)).toEqual(['if', 'endTurn', 'forEachCard']);
    // Same-lane index adjustment when moving forward.
    const fwd = moveBlock(script(), [0], { kind: 'after', path: [1] });
    expect(fwd?.map((b) => b.kind)).toEqual(['forEachCard', 'if', 'endTurn']);
    // Into a lane.
    const intoLane = moveBlock(script(), [2], { kind: 'lane', path: [0], lane: 'else' });
    const ifBlock = intoLane?.[0] as Extract<Block, { kind: 'if' }>;
    expect(ifBlock.else.map((b) => b.kind)).toEqual(['endTurn']);
    expect(intoLane?.map((b) => b.kind)).toEqual(['if', 'forEachCard']);
  });

  it('moveBlock refuses to route a block inside its own subtree', () => {
    expect(moveBlock(script(), [1], { kind: 'lane', path: [1], lane: 'body' })).toBeNull();
    expect(moveBlock(script(), [1], { kind: 'after', path: [1, 'body', 0] })).toBeNull();
  });

  it('setExprAt replaces a data input (connecting a data pin)', () => {
    const s = script();
    const replaced = setExprAt(s, { blockPath: [0], slots: ['cond'] }, { kind: 'bool', value: true });
    expect((replaced[0] as Extract<Block, { kind: 'if' }>).cond).toEqual({ kind: 'bool', value: true });
    // Nested slot on a data node (compare.left inside chooseCards.filter).
    const deep = setExprAt(s, { blockPath: [1, 'body', 0], slots: ['filter', 'left'] }, num(7));
    const cc = getBlockAt(deep, [1, 'body', 0]) as Extract<Block, { kind: 'chooseCards' }>;
    expect((cc.filter as Extract<Expr, { kind: 'compare' }>).left).toEqual(num(7));
    // Disconnect a nullable pin back to null.
    const cleared = setExprAt(deep, { blockPath: [1, 'body', 0], slots: ['filter'] }, null);
    expect((getBlockAt(cleared, [1, 'body', 0]) as Extract<Block, { kind: 'chooseCards' }>).filter).toBeNull();
    // Original tree untouched (immutability).
    expect(s).toEqual(script());
  });

  it('getExprAt reads through slot chains', () => {
    const s = script();
    expect(getExprAt(s, { blockPath: [0], slots: ['cond'] })).toEqual(condExpr());
    expect(getExprAt(s, { blockPath: [0], slots: ['cond', 'right'] })).toEqual(num(0));
    expect(getExprAt(s, { blockPath: [1], slots: ['filter'] })).toBeNull();
  });

  it('fan-out copies: wiring one output to a second input clones the subtree', () => {
    const s = script();
    const g = projectGraph(def, s, []);
    const desc = describePin(g, { nodeId: 'b:0/cond', pin: 'out' });
    expect(desc?.kind).toBe('dataOut');
    if (desc?.kind !== 'dataOut') return;
    const clone = deepClone(desc.expr);
    const next = setExprAt(s, { blockPath: [1, 'body', 0], slots: ['filter'] }, clone);
    const cc = getBlockAt(next, [1, 'body', 0]) as Extract<Block, { kind: 'chooseCards' }>;
    expect(cc.filter).toEqual(condExpr());
    expect((next[0] as Extract<Block, { kind: 'if' }>).cond).toEqual(condExpr()); // source untouched
  });
});

describe('pin semantics & compatibility', () => {
  const def = fixture();

  it('describes exec and data pins with their tree locations', () => {
    const g = projectGraph(def, script(), []);
    expect(describePin(g, { nodeId: 'start', pin: 'execOut' })).toEqual({ kind: 'execOut', loc: { kind: 'start' } });
    expect(describePin(g, { nodeId: 'b:1', pin: 'execOut' }))
      .toEqual({ kind: 'execOut', loc: { kind: 'after', path: [1] } });
    expect(describePin(g, { nodeId: 'b:1', pin: 'lane:body' }))
      .toEqual({ kind: 'execOut', loc: { kind: 'lane', path: [1], lane: 'body' } });
    expect(describePin(g, { nodeId: 'b:2', pin: 'execIn' })).toEqual({ kind: 'execIn', path: [2] });
    const dataIn = describePin(g, { nodeId: 'b:1.body.0', pin: 'in:filter' });
    expect(dataIn?.kind).toBe('dataIn');
    if (dataIn?.kind === 'dataIn') {
      expect(dataIn.path).toEqual({ blockPath: [1, 'body', 0], slots: ['filter'] });
      expect(dataIn.slot.type).toBe('boolean');
      expect(dataIn.bindings).toContain('$card');
    }
  });

  it('checks exec/data pin compatibility, including type and cycle rules', () => {
    const g = projectGraph(def, script(), []);
    const out = (nodeId: string, pin = 'execOut') => ({ nodeId, pin });
    expect(pinsCompatible(g, out('b:0'), { nodeId: 'b:2', pin: 'execIn' })).toBe(true);
    expect(pinsCompatible(g, { nodeId: 'b:2', pin: 'execIn' }, out('b:0'))).toBe(true); // order-insensitive
    // A container cannot be routed after a pin inside itself.
    expect(pinsCompatible(g, out('b:1', 'lane:body'), { nodeId: 'b:1', pin: 'execIn' })).toBe(false);
    // boolean output → boolean input ok; → number input not.
    expect(pinsCompatible(g, { nodeId: 'b:0/cond', pin: 'out' }, { nodeId: 'b:1.body.0', pin: 'in:filter' })).toBe(true);
    expect(pinsCompatible(g, { nodeId: 'b:0/cond', pin: 'out' }, { nodeId: 'b:1.body.0', pin: 'in:min' })).toBe(false);
    // number output (zoneCount) → number input ok.
    expect(pinsCompatible(g, { nodeId: 'b:0/cond/left', pin: 'out' }, { nodeId: 'b:1.body.0', pin: 'in:max' })).toBe(true);
    // exec pins never pair with data pins.
    expect(pinsCompatible(g, out('b:0'), { nodeId: 'b:1.body.0', pin: 'in:filter' })).toBe(false);
  });
});

describe('misc model helpers', () => {
  it('exprWeight counts expression nodes in a subtree', () => {
    expect(exprWeight(num(1))).toBe(1);
    expect(exprWeight(condExpr())).toBe(3); // compare + zoneCount + num
    expect(exprWeight(cardFilter())).toBe(4); // compare + cardField + binding + str
  });

  it('node id helpers are stable and path-derived', () => {
    expect(blockNodeId([1, 'body', 0])).toBe('b:1.body.0');
    expect(exprNodeId([0], ['cond', 'left'])).toBe('b:0/cond/left');
  });
});
