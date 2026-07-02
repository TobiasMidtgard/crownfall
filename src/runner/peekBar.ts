/**
 * peekBar — pure decision logic for the peek status bar
 * (screenLayout.statusBar === 'peek'), extracted from TableScreen so the
 * collapse rules are unit-testable without a DOM. The bar may collapse only
 * after PEEK_IDLE_MS of no pointer/keyboard activity within it, and never
 * while a sheet/choice/dialog is open, the game is finished, or focus is
 * inside the bar (collapsing then would hide an active surface or steal
 * focus).
 */

export const PEEK_IDLE_MS = 2000;
export const PEEK_DRAG_THRESHOLD_PX = 12;

export interface PeekGuards {
  /** A sheet/choice/dialog (or the log drawer) is open — the bar must stay. */
  overlayOpen: boolean;
  /** The game is over — the bar stays visible with the result. */
  finished: boolean;
  /** Focus is inside the bar — collapsing would steal it. */
  focusWithin: boolean;
}

function armed(g: PeekGuards): boolean {
  return !g.overlayOpen && !g.finished && !g.focusWithin;
}

/** The "may collapse now" predicate: every guard clear AND idle long enough. */
export function mayCollapse(g: PeekGuards, lastActivity: number, now: number): boolean {
  return armed(g) && now - lastActivity >= PEEK_IDLE_MS;
}

/**
 * Milliseconds until the collapse timer should next fire, or null while a
 * guard holds the bar open (re-arm when the guard clears).
 */
export function collapseDelay(g: PeekGuards, lastActivity: number, now: number): number | null {
  if (!armed(g)) return null;
  return Math.max(0, lastActivity + PEEK_IDLE_MS - now);
}

/** Handle drag-up: expand once the pointer has risen past the threshold. */
export function dragUpExceeded(startY: number, y: number): boolean {
  return startY - y > PEEK_DRAG_THRESHOLD_PX;
}

/** Condensed turn/phase text for the collapsed handle, e.g. "T3 - Buy". */
export function peekHandleLabel(turnNumber: number, phaseName: string | null): string {
  return phaseName === null ? `T${turnNumber}` : `T${turnNumber} - ${phaseName}`;
}
