/**
 * exprToText — renders any Expr (and the related slot specs) as a short,
 * readable sentence. Shared by the expression chips, the block editor rows,
 * and the tests, so the whole editor "reads like language" consistently.
 *
 * Example output for a Hearts follow-suit legality:
 *   card count in Trick = 0 OR suit of $card = lead suit OR
 *   count of cards in Hand (mine) where suit of $card = lead suit = 0
 */
import type {
  CardSelector, ChoiceSpec, CompareOp, Expr, GameDef, MathOp, WinnerSpec, ZoneRef,
} from '../../shared/types';

const COMPARE_TEXT: Record<CompareOp, string> = {
  '==': '=', '!=': '≠', '<': '<', '<=': '≤', '>': '>', '>=': '≥',
};
const MATH_TEXT: Record<MathOp, string> = { '+': '+', '-': '−', '*': '×', '/': '÷', '%': 'mod' };

export function zoneName(def: GameDef, zoneId: string): string {
  return def.zones.find((z) => z.id === zoneId)?.name ?? '⚠ missing zone';
}

export function varName(def: GameDef, varId: string): string {
  return def.variables.find((v) => v.id === varId)?.name ?? '⚠ missing variable';
}

export function phaseName(def: GameDef, phaseId: string): string {
  return def.phases.find((p) => p.id === phaseId)?.name ?? '⚠ missing phase';
}

/** Standard52 field ids ('suit', 'rank'…) double as their display names. */
export function fieldName(def: GameDef, fieldId: string): string {
  for (const t of def.templates) {
    const f = t.fields.find((fd) => fd.id === fieldId);
    if (f) return f.name;
  }
  return fieldId;
}

function ownerText(def: GameDef, owner: Expr | null): string {
  if (owner === null) return 'mine';
  if (owner.kind === 'currentPlayer') return 'current player';
  if (owner.kind === 'binding') return owner.name;
  return exprToText(def, owner);
}

export function zoneRefToText(def: GameDef, ref: ZoneRef): string {
  const zone = def.zones.find((z) => z.id === ref.zoneId);
  if (!zone) return '⚠ missing zone';
  if (zone.owner === 'shared') return zone.name;
  return `${zone.name} (${ownerText(def, ref.owner)})`;
}

type ParentKind = 'math' | 'compare' | 'logic-and' | 'logic-or' | 'not';

/** Parenthesize a child only where the sentence would otherwise mis-read. */
function child(def: GameDef, e: Expr, parent: ParentKind): string {
  const t = exprToText(def, e);
  switch (parent) {
    case 'math':
      return e.kind === 'math' || e.kind === 'compare' || e.kind === 'logic' ? `(${t})` : t;
    case 'compare':
      return e.kind === 'logic' ? `(${t})` : t;
    case 'logic-and':
      return e.kind === 'logic' && e.op === 'or' ? `(${t})` : t;
    case 'logic-or':
      return e.kind === 'logic' && e.op === 'and' ? `(${t})` : t;
    case 'not':
      return e.kind === 'logic' || e.kind === 'compare' || e.kind === 'math' ? `(${t})` : t;
  }
}

export function exprToText(def: GameDef, expr: Expr): string {
  switch (expr.kind) {
    case 'num': return String(expr.value);
    case 'str': return `"${expr.value}"`;
    case 'bool': return expr.value ? 'yes' : 'no';
    case 'getVar': {
      const name = varName(def, expr.varId);
      return expr.target ? `${name} of ${exprToText(def, expr.target)}` : name;
    }
    case 'zoneCount': return `card count in ${zoneRefToText(def, expr.zone)}`;
    case 'cardField': return `${fieldName(def, expr.fieldId)} of ${exprToText(def, expr.card)}`;
    case 'topCard': return `top card of ${zoneRefToText(def, expr.zone)}`;
    case 'binding': return expr.name;
    case 'currentPlayer': return 'current player';
    case 'playerCount': return 'player count';
    case 'turnNumber': return 'turn number';
    case 'nextPlayer': return `player after ${exprToText(def, expr.from)}`;
    case 'cardOwner': return `owner of ${exprToText(def, expr.card)}`;
    case 'cardZoneId': return `zone of ${exprToText(def, expr.card)}`;
    case 'math':
      return `${child(def, expr.left, 'math')} ${MATH_TEXT[expr.op]} ${child(def, expr.right, 'math')}`;
    case 'compare':
      return `${child(def, expr.left, 'compare')} ${COMPARE_TEXT[expr.op]} ${child(def, expr.right, 'compare')}`;
    case 'logic': {
      const p: ParentKind = expr.op === 'and' ? 'logic-and' : 'logic-or';
      return `${child(def, expr.left, p)} ${expr.op.toUpperCase()} ${child(def, expr.right, p)}`;
    }
    case 'not': return `not ${child(def, expr.expr, 'not')}`;
    case 'bestCard': {
      const base = `${expr.by} ${fieldName(def, expr.fieldId)} card in ${zoneRefToText(def, expr.zone)}`;
      return expr.filter ? `${base} where ${exprToText(def, expr.filter)}` : base;
    }
    case 'countCards': {
      const base = `count of cards in ${zoneRefToText(def, expr.zone)}`;
      return expr.filter ? `${base} where ${exprToText(def, expr.filter)}` : base;
    }
    case 'random': return `random 1 to ${exprToText(def, expr.max)}`;
    case 'stackSize': return 'stack size';
    case 'stackTopCard': return 'top of stack';
    case 'phaseIndex': return 'current phase #';
    case 'phasePos': {
      const phase = def.phases.find((p) => p.id === expr.phaseId);
      return `position of ${phase ? `"${phase.name}"` : 'a missing phase'}`;
    }
    case 'phaseIs': {
      const phase = def.phases.find((p) => p.id === expr.phaseId);
      return `phase is ${phase ? `"${phase.name}"` : 'a missing phase'}`;
    }
  }
}

// --- Slot spec texts (used by block sentence chips) ------------------------

export function selectorToText(def: GameDef, sel: CardSelector): string {
  switch (sel.kind) {
    case 'top': return `top ${exprToText(def, sel.count)}`;
    case 'bottom': return `bottom ${exprToText(def, sel.count)}`;
    case 'random': return `${exprToText(def, sel.count)} random`;
    case 'all': return 'all';
    case 'filter': return `matching ${exprToText(def, sel.filter)}`;
    case 'specific': return exprToText(def, sel.card);
  }
}

export function faceUpText(v: boolean | null): string {
  return v === null ? 'keep facing' : v ? 'face up' : 'face down';
}

export function choiceToText(def: GameDef, c: ChoiceSpec): string {
  switch (c.kind) {
    case 'card': {
      const filter = c.filter ? ` where ${exprToText(def, c.filter)}` : '';
      return `a card from ${zoneRefToText(def, c.from)}${filter}${c.optional ? ' (may skip)' : ''}`;
    }
    case 'option':
      return c.options.length
        ? `an option: ${c.options.map((o) => o.label).join(' / ')}`
        : 'an option (none yet)';
    case 'player': return c.includeSelf ? 'a player' : 'another player';
    case 'yesNo': return 'yes or no';
  }
}

export function winnerToText(def: GameDef, w: WinnerSpec): string {
  switch (w.kind) {
    case 'player': return exprToText(def, w.player);
    case 'highestVar': return `highest ${varName(def, w.varId)}`;
    case 'lowestVar': return `lowest ${varName(def, w.varId)}`;
    case 'draw': return 'a draw';
  }
}

export function announceToText(def: GameDef, parts: (string | Expr)[]): string {
  if (parts.length === 0) return '(empty message)';
  return parts.map((p) => (typeof p === 'string' ? p : `[${exprToText(def, p)}]`)).join(' ');
}
