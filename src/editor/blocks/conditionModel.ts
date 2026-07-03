/**
 * conditionModel — the PURE tree model behind the guided ConditionBuilder.
 *
 * A condition is a group ("all of / any of / none of" a list of rows); a row
 * is a leaf clause, a nested group, or a read-only "advanced" row wrapping any
 * Expr outside the clause vocabulary. `compile` turns a tree into the engine's
 * existing Expr format; `parse` turns an Expr back into a tree — recognizing
 * everything compile emits plus the obvious legacy shapes (nested and/or
 * chains fold into flat all/any groups, not(or(…)) becomes a none group,
 * eq(field(card, name), str) joins "name is one of"). Anything else becomes an
 * advanced row that preserves the exact Expr (no data loss, ever).
 *
 * Round-trip property: parse(compile(t)) deep-equals t for every CANONICAL
 * tree. Canonical means:
 *   - nested groups have ≥ 2 rows OR are empty (an empty group compiles to a
 *     bool literal, which parse reads back as an empty group; a 1-row group is
 *     indistinguishable from its row once compiled, so parse dissolves it) —
 *     with one exception: a "none" group whose only row is an all/none GROUP
 *     round-trips, because compile marks it as not(<group>) and nothing else
 *     emits that shape. (none[any[…]] still flattens to the flat none group —
 *     not(or(…)) IS the flat form's own encoding.);
 *   - at most one non-negated "name is one of" clause per card subject per
 *     any/none group (or-chained name equalities merge into one clause);
 *   - no field-compare clause of shape (name == "text") — that IS the 1-name
 *     "name is one of" clause and parses as such.
 *
 * This module is pure data — no React, no GameDef required.
 */
import type { CompareOp, Expr, Id, ZoneRef } from '../../shared/types';

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

export type GroupOp = 'all' | 'any' | 'none';

export interface ConditionGroup {
  kind: 'group';
  op: GroupOp;
  rows: ConditionRow[];
}

/** An Expr the vocabulary cannot express: shown read-only, preserved exactly. */
export interface AdvancedRow {
  kind: 'advanced';
  expr: Expr;
}

export type ConditionRow = Clause | ConditionGroup | AdvancedRow;

/**
 * Leaf clauses — the spec's vocabulary. `card` is the binding name the card
 * clauses read ($card, $self…); `negate` is the structural "not" wrapping one
 * clause. Compare-style clauses use the engine's CompareOp ('contains' =
 * whole-word text membership, legacy multi-word type lines).
 */
export type Clause =
  | { kind: 'isType'; card: string; typeId: Id; negate: boolean }
  | { kind: 'hasTag'; card: string; tagId: Id; negate: boolean }
  | { kind: 'fieldCompare'; card: string; fieldId: Id; op: CompareOp; value: string | number; negate: boolean }
  | { kind: 'nameOneOf'; card: string; names: string[]; negate: boolean }
  | { kind: 'matchesFilter'; card: string; filterId: Id; negate: boolean }
  | { kind: 'phaseIs'; phaseId: Id; negate: boolean }
  /** target = binding name for perPlayer/perCard reads (null = contextual). */
  | { kind: 'varCompare'; varId: Id; target: string | null; op: CompareOp; value: string | number | boolean; negate: boolean }
  /** "[zone] holds [op] [count] cards matching [filter]" (null filter = all). */
  | { kind: 'zoneCountCmp'; zone: ZoneRef; op: CompareOp; count: number; filter: ConditionGroup | null; negate: boolean }
  | { kind: 'turnCompare'; op: CompareOp; value: number; negate: boolean };

export const CLAUSE_KINDS = [
  'isType', 'hasTag', 'fieldCompare', 'nameOneOf', 'matchesFilter',
  'phaseIs', 'varCompare', 'zoneCountCmp', 'turnCompare',
] as const;

export function isClauseRow(row: ConditionRow): row is Clause {
  return row.kind !== 'group' && row.kind !== 'advanced';
}

/** Fresh empty tree (compiles to "always true" / null in allow-null slots). */
export function emptyTree(): ConditionGroup {
  return { kind: 'group', op: 'all', rows: [] };
}

// ---------------------------------------------------------------------------
// compile: tree -> Expr
// ---------------------------------------------------------------------------

const TRUE: Expr = { kind: 'bool', value: true };
const FALSE: Expr = { kind: 'bool', value: false };

const binding = (name: string): Expr => ({ kind: 'binding', name });

const literal = (v: string | number | boolean): Expr =>
  typeof v === 'number' ? { kind: 'num', value: v }
  : typeof v === 'boolean' ? { kind: 'bool', value: v }
  : { kind: 'str', value: v };

const and = (left: Expr, right: Expr): Expr => ({ kind: 'logic', op: 'and', left, right });
const or = (left: Expr, right: Expr): Expr => ({ kind: 'logic', op: 'or', left, right });

const nameEq = (card: string, name: string): Expr => ({
  kind: 'compare', op: '==',
  left: { kind: 'cardField', card: binding(card), fieldId: 'name' },
  right: { kind: 'str', value: name },
});

export function compile(tree: ConditionGroup): Expr {
  return compileGroup(tree);
}

function compileGroup(g: ConditionGroup): Expr {
  const exprs = g.rows.map(compileRow);
  switch (g.op) {
    case 'all': return exprs.length === 0 ? TRUE : exprs.reduce(and);
    case 'any': return exprs.length === 0 ? FALSE : exprs.reduce(or);
    case 'none': return exprs.length === 0 ? TRUE : { kind: 'not', expr: exprs.reduce(or) };
  }
}

export function compileRow(row: ConditionRow): Expr {
  if (row.kind === 'group') return compileGroup(row);
  if (row.kind === 'advanced') return row.expr;
  const base = compileClause(row);
  return row.negate ? { kind: 'not', expr: base } : base;
}

function compileClause(c: Clause): Expr {
  switch (c.kind) {
    case 'isType':
      return { kind: 'cardTypeIs', card: binding(c.card), typeId: c.typeId };
    case 'hasTag':
      return { kind: 'cardHasTag', card: binding(c.card), tagId: c.tagId };
    case 'matchesFilter':
      return { kind: 'filterRef', filterId: c.filterId, card: binding(c.card) };
    case 'fieldCompare':
      return {
        kind: 'compare', op: c.op,
        left: { kind: 'cardField', card: binding(c.card), fieldId: c.fieldId },
        right: literal(c.value),
      };
    case 'nameOneOf':
      return c.names.length === 0 ? FALSE : c.names.map((n) => nameEq(c.card, n)).reduce(or);
    case 'phaseIs':
      return { kind: 'phaseIs', phaseId: c.phaseId };
    case 'varCompare':
      return {
        kind: 'compare', op: c.op,
        left: { kind: 'getVar', varId: c.varId, target: c.target === null ? null : binding(c.target) },
        right: literal(c.value),
      };
    case 'zoneCountCmp':
      return {
        kind: 'compare', op: c.op,
        left: c.filter === null
          ? { kind: 'zoneCount', zone: c.zone }
          : { kind: 'countCards', zone: c.zone, filter: compileGroup(c.filter) },
        right: { kind: 'num', value: c.count },
      };
    case 'turnCompare':
      return { kind: 'compare', op: c.op, left: { kind: 'turnNumber' }, right: { kind: 'num', value: c.value } };
  }
}

// ---------------------------------------------------------------------------
// Empty-group semantics (shared with the builder UI)
// ---------------------------------------------------------------------------

/**
 * What an EMPTY group of this op means: "all of nothing" and "none of
 * nothing" hold vacuously (always); "any of nothing" never holds. The
 * builder's readback, empty-state hint and save logic must all agree with
 * compile on this — compile emits TRUE for empty all/none and FALSE for
 * empty any.
 */
export function emptyGroupReadsAs(op: GroupOp): 'always' | 'never' {
  return op === 'any' ? 'never' : 'always';
}

/**
 * The value the builder's Done button should store for an EDITED tree. In
 * allow-null slots (null = "always") an empty group only collapses to null
 * when it actually MEANS always — an empty "any" group means never and must
 * stay a real FALSE expr, or a stored "never" condition would silently flip
 * to "always". (An UNEDITED open + Done must not call this at all: the modal
 * keeps the original value verbatim so parse/compile canonicalization never
 * rewrites stored data behind the user's back.)
 */
export function commitTree(tree: ConditionGroup, allowNull: boolean): Expr | null {
  if (allowNull && tree.rows.length === 0 && emptyGroupReadsAs(tree.op) === 'always') return null;
  return compile(tree);
}

// ---------------------------------------------------------------------------
// parse: Expr -> tree
// ---------------------------------------------------------------------------

export function parse(expr: Expr): ConditionGroup {
  const row = parseRow(expr);
  if (row.kind === 'group') return row;
  return { kind: 'group', op: 'all', rows: [row] };
}

export function parseRow(expr: Expr): ConditionRow {
  // A bare boolean literal reads as an empty group: true = "all of nothing"
  // (always), false = "any of nothing" (never) — exactly what compile emits
  // for empty groups, so an empty NESTED group round-trips too.
  if (expr.kind === 'bool') return { kind: 'group', op: expr.value ? 'all' : 'any', rows: [] };
  if (expr.kind === 'logic' && expr.op === 'and') {
    return { kind: 'group', op: 'all', rows: flattenLogic(expr, 'and').map(parseRow) };
  }
  if (expr.kind === 'logic' && expr.op === 'or') {
    const rows = parseOrRows(expr);
    // An or-chain that merges into ONE row (all name-equalities on one card)
    // is just that row — "name is one of Copper, Silver, Gold".
    return rows.length === 1 ? rows[0] : { kind: 'group', op: 'any', rows };
  }
  if (expr.kind === 'not') {
    const inner = expr.expr;
    if (inner.kind === 'logic' && inner.op === 'or') {
      const rows = parseOrRows(inner);
      if (rows.length >= 2) return { kind: 'group', op: 'none', rows };
      const only = rows[0];
      if (only !== undefined && isClauseRow(only)) return { ...only, negate: !only.negate };
      return { kind: 'advanced', expr };
    }
    const row = parseRow(inner);
    if (isClauseRow(row)) return { ...row, negate: !row.negate };
    // compileGroup('none', [group]) emits not(<that group>) verbatim — invert
    // it exactly: the inner group becomes the sole row of a none group. This
    // re-reads none[all[…]], none[none[…]] (and legacy not(and(…))) as
    // editable groups instead of degrading them to read-only advanced rows.
    if (row.kind === 'group') return { kind: 'group', op: 'none', rows: [row] };
    return { kind: 'advanced', expr };
  }
  return parseClause(expr) ?? { kind: 'advanced', expr };
}

/** Leaves of a same-op logic chain, in sentence order (any association). */
function flattenLogic(expr: Expr, op: 'and' | 'or'): Expr[] {
  if (expr.kind === 'logic' && expr.op === op) {
    return [...flattenLogic(expr.left, op), ...flattenLogic(expr.right, op)];
  }
  return [expr];
}

/**
 * Rows of an or-chain: every non-negated name-equality on the same card
 * subject merges into one "name is one of" clause (at its first position).
 */
function parseOrRows(expr: Expr): ConditionRow[] {
  const rows: ConditionRow[] = [];
  const nameRowByCard = new Map<string, Extract<Clause, { kind: 'nameOneOf' }>>();
  for (const leaf of flattenLogic(expr, 'or')) {
    const row = parseRow(leaf);
    if (isClauseRow(row) && row.kind === 'nameOneOf' && !row.negate) {
      const existing = nameRowByCard.get(row.card);
      if (existing) {
        existing.names.push(...row.names);
        continue;
      }
      nameRowByCard.set(row.card, row);
    }
    rows.push(row);
  }
  return rows;
}

/** Literal value of an Expr, or undefined when it is not a literal. */
function literalValue(e: Expr): string | number | boolean | undefined {
  if (e.kind === 'num' || e.kind === 'str' || e.kind === 'bool') return e.value;
  return undefined;
}

/** Mirror of each comparison op when the sides swap (contains never flips). */
const FLIP: Partial<Record<CompareOp, CompareOp>> = {
  '==': '==', '!=': '!=', '<': '>', '<=': '>=', '>': '<', '>=': '<=',
};

function parseClause(e: Expr): Clause | null {
  switch (e.kind) {
    case 'cardTypeIs':
      return e.card.kind === 'binding'
        ? { kind: 'isType', card: e.card.name, typeId: e.typeId, negate: false }
        : null;
    case 'cardHasTag':
      return e.card.kind === 'binding'
        ? { kind: 'hasTag', card: e.card.name, tagId: e.tagId, negate: false }
        : null;
    case 'filterRef':
      return e.card.kind === 'binding'
        ? { kind: 'matchesFilter', card: e.card.name, filterId: e.filterId, negate: false }
        : null;
    case 'phaseIs':
      return { kind: 'phaseIs', phaseId: e.phaseId, negate: false };
    case 'compare': {
      const direct = parseSubjectCompare(e.left, e.op, e.right);
      if (direct) return direct;
      // Legacy mirrored shape: literal on the left, subject on the right.
      const flipped = FLIP[e.op];
      if (flipped !== undefined && literalValue(e.left) !== undefined) {
        return parseSubjectCompare(e.right, flipped, e.left);
      }
      return null;
    }
    default:
      return null;
  }
}

function parseSubjectCompare(subject: Expr, op: CompareOp, valueExpr: Expr): Clause | null {
  const value = literalValue(valueExpr);
  if (value === undefined) return null;
  if (subject.kind === 'cardField' && subject.card.kind === 'binding') {
    if (subject.fieldId === 'name' && op === '==' && typeof value === 'string') {
      return { kind: 'nameOneOf', card: subject.card.name, names: [value], negate: false };
    }
    if (typeof value === 'boolean') return null;
    return { kind: 'fieldCompare', card: subject.card.name, fieldId: subject.fieldId, op, value, negate: false };
  }
  if (subject.kind === 'getVar' && (subject.target === null || subject.target.kind === 'binding')) {
    return {
      kind: 'varCompare', varId: subject.varId,
      target: subject.target === null ? null : subject.target.name,
      op, value, negate: false,
    };
  }
  if (op !== 'contains' && typeof value === 'number') {
    if (subject.kind === 'zoneCount') {
      return { kind: 'zoneCountCmp', zone: subject.zone, op, count: value, filter: null, negate: false };
    }
    if (subject.kind === 'countCards') {
      return {
        kind: 'zoneCountCmp', zone: subject.zone, op, count: value,
        filter: subject.filter === null ? null : parse(subject.filter), negate: false,
      };
    }
    if (subject.kind === 'turnNumber') {
      return { kind: 'turnCompare', op, value, negate: false };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Small tree queries (used by the builder + tests)
// ---------------------------------------------------------------------------

/** Every advanced row in the tree, depth-first (nested filters included). */
export function collectAdvanced(tree: ConditionGroup): AdvancedRow[] {
  const out: AdvancedRow[] = [];
  const walkGroup = (g: ConditionGroup) => {
    for (const row of g.rows) {
      if (row.kind === 'group') walkGroup(row);
      else if (row.kind === 'advanced') out.push(row);
      else if (row.kind === 'zoneCountCmp' && row.filter) walkGroup(row.filter);
    }
  };
  walkGroup(tree);
  return out;
}
