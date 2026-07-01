/**
 * Read-only expression evaluation for DISPLAY purposes (screen-layout
 * `visible` expressions, future computed labels). Evaluates against a public
 * GameState snapshot with `$viewer` bound — no Core, no RNG consumption, no
 * error reporting (a failing expression simply yields null → hidden).
 */
import type { Expr, GameDef, GameState, Id, RuntimeValue } from '../shared/types';
import type { Core } from './internals';
import { evalExpr, truthy, type EvalCtx } from './expr';
import { createRng } from './rng';

/**
 * The evaluator only ever touches def/state/pendingStack (plus state-derived
 * helpers) on the core — this shim provides exactly those, mirroring the
 * public stack view so stackSize/stackTopCard read correctly.
 */
function displayCore(def: GameDef, state: GameState): Core {
  const shim = {
    def,
    state,
    pendingStack: state.stack.map((s) => ({ ...s, script: [], snapshot: [] })),
  };
  return shim as unknown as Core;
}

export function evalDisplayExpr(
  def: GameDef,
  state: GameState,
  expr: Expr,
  viewerId: Id,
): RuntimeValue {
  const ctx: EvalCtx = {
    core: displayCore(def, state),
    frames: [{ $viewer: viewerId, $player: viewerId }],
    rng: createRng(state.seed),
    report: () => {},
  };
  try {
    return evalExpr(ctx, expr);
  } catch {
    return null;
  }
}

/** Convenience: truthiness of a display expression (null expr = visible). */
export function isDisplayVisible(
  def: GameDef,
  state: GameState,
  expr: Expr | null | undefined,
  viewerId: Id,
): boolean {
  if (expr == null) return true;
  return truthy(evalDisplayExpr(def, state, expr, viewerId));
}
