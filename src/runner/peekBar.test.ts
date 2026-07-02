/**
 * Pure tests for the peek status-bar decision logic (screenLayout.statusBar
 * === 'peek'): the "may collapse now" predicate with its overlay/finished/
 * focus-within guards, the timer-delay math, the drag-up threshold and the
 * condensed handle label. TableScreen consumes these unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  collapseDelay, dragUpExceeded, mayCollapse, PEEK_DRAG_THRESHOLD_PX, PEEK_IDLE_MS,
  peekHandleLabel, type PeekGuards,
} from './peekBar';

const clear: PeekGuards = { overlayOpen: false, finished: false, focusWithin: false };

describe('mayCollapse', () => {
  it('collapses once idle reaches the threshold with all guards clear', () => {
    expect(mayCollapse(clear, 1000, 1000 + PEEK_IDLE_MS)).toBe(true);
    expect(mayCollapse(clear, 1000, 1000 + PEEK_IDLE_MS - 1)).toBe(false);
  });

  it('never collapses while a sheet/choice/dialog is open', () => {
    expect(mayCollapse({ ...clear, overlayOpen: true }, 0, PEEK_IDLE_MS * 10)).toBe(false);
  });

  it('never collapses after the game finished', () => {
    expect(mayCollapse({ ...clear, finished: true }, 0, PEEK_IDLE_MS * 10)).toBe(false);
  });

  it('never collapses while focus is inside the bar', () => {
    expect(mayCollapse({ ...clear, focusWithin: true }, 0, PEEK_IDLE_MS * 10)).toBe(false);
  });
});

describe('collapseDelay', () => {
  it('returns the remaining idle time', () => {
    expect(collapseDelay(clear, 1000, 1500)).toBe(PEEK_IDLE_MS - 500);
  });

  it('clamps to zero when already past due', () => {
    expect(collapseDelay(clear, 0, PEEK_IDLE_MS * 10)).toBe(0);
  });

  it('does not schedule while any guard is up', () => {
    const raised: PeekGuards[] = [
      { ...clear, overlayOpen: true },
      { ...clear, finished: true },
      { ...clear, focusWithin: true },
    ];
    for (const g of raised) expect(collapseDelay(g, 0, PEEK_IDLE_MS * 10)).toBeNull();
  });
});

describe('dragUpExceeded', () => {
  it('fires only past the upward threshold', () => {
    expect(dragUpExceeded(100, 100 - PEEK_DRAG_THRESHOLD_PX)).toBe(false);
    expect(dragUpExceeded(100, 100 - PEEK_DRAG_THRESHOLD_PX - 1)).toBe(true);
  });

  it('ignores downward movement', () => {
    expect(dragUpExceeded(100, 140)).toBe(false);
  });
});

describe('peekHandleLabel', () => {
  it('condenses turn + phase', () => {
    expect(peekHandleLabel(3, 'Buy')).toBe('T3 - Buy');
  });

  it('omits the phase when none is active', () => {
    expect(peekHandleLabel(7, null)).toBe('T7');
  });
});
