/**
 * Pure tests for the shared layout geometry helpers (parent-relative rect
 * conversion, seat resolution, style->CSS, grid templates incl. rows, spacing
 * px math, pile/duplicate grouping, fan transforms, motion spec + speed,
 * screen variant picking, stage geometry) used by both the runner and the
 * screen builder's canvas preview.
 */
import { describe, expect, it } from 'vitest';
import type { ScreenElement, ScreenLayout } from '../shared/types';
import {
  absToGroupRel, activeScreenVariant, asSpeed, cardIdentity, computeStage, fanMarginPx,
  fanTransform, fitCount, flowChildCss, flowLayoutCss, gridSpec, gridTemplate, groupPiles,
  groupPilesRemembered, groupRelToAbs, layoutStyleCss, lineColor, lineEndpoints, MOTION_DEFAULTS,
  motionForTag, nextSpeed, pctToPx, rectContains, resolveMotion, resolveSeat, scaleMs, seatOffset,
  SHAPE_KINDS, shapeBorderRadius, shapeClipPath, shapePolygon, slotRect, speedFactor, textStyleCss,
  topLegalCard, type PileMemoryEntry,
} from './layoutGeometry';

const parent = { x: 20, y: 10, w: 50, h: 40 };

describe('parent-relative rect conversion', () => {
  it('converts parent-relative to absolute', () => {
    // rel (10%, 20%, 40%, 50%) of a 50x40 parent at (20,10)
    expect(groupRelToAbs({ x: 10, y: 20, w: 40, h: 50 }, parent)).toEqual({
      x: 25, y: 18, w: 20, h: 20,
    });
  });

  it('round-trips abs -> rel -> abs', () => {
    const abs = { x: 33, y: 17, w: 12, h: 9 };
    const rel = absToGroupRel(abs, parent);
    const back = groupRelToAbs(rel, parent);
    expect(back.x).toBeCloseTo(abs.x, 6);
    expect(back.y).toBeCloseTo(abs.y, 6);
    expect(back.w).toBeCloseTo(abs.w, 6);
    expect(back.h).toBeCloseTo(abs.h, 6);
  });

  it('does not divide by zero on degenerate parents', () => {
    const rel = absToGroupRel({ x: 5, y: 5, w: 5, h: 5 }, { x: 0, y: 0, w: 0, h: 0 });
    expect(Number.isFinite(rel.x)).toBe(true);
    expect(Number.isFinite(rel.w)).toBe(true);
  });

  it('rectContains accepts touching edges and rejects overflow', () => {
    expect(rectContains(parent, { x: 20, y: 10, w: 50, h: 40 })).toBe(true);
    expect(rectContains(parent, { x: 30, y: 20, w: 10, h: 10 })).toBe(true);
    expect(rectContains(parent, { x: 65, y: 20, w: 10, h: 10 })).toBe(false);
    expect(rectContains(parent, { x: 19, y: 10, w: 10, h: 10 })).toBe(false);
  });
});

describe('seat resolution', () => {
  const seats = ['p0', 'p1', 'p2'];

  it("'viewer' is the viewer's own seat", () => {
    expect(resolveSeat(seats, 'p1', 'viewer', 0)).toBe('p1');
  });

  it('oppN counts seats after the viewer, wrapping past the last seat', () => {
    expect(resolveSeat(seats, 'p1', 'opp1', 0)).toBe('p2');
    expect(resolveSeat(seats, 'p1', 'opp2', 0)).toBe('p0'); // wrapped
    expect(resolveSeat(seats, 'p2', 'opp1', 0)).toBe('p0'); // wrapped
    expect(resolveSeat(seats, 'p0', 'opp2', 0)).toBe('p2');
  });

  it('seats beyond the player count resolve to null (element renders nothing)', () => {
    expect(resolveSeat(seats, 'p0', 'opp3', 0)).toBeNull();
    expect(resolveSeat(['p0', 'p1'], 'p0', 'opp2', 0)).toBeNull();
    expect(resolveSeat(['p0'], 'p0', 'opp1', 0)).toBeNull();
  });

  it("'shared' never resolves to a player", () => {
    expect(resolveSeat(seats, 'p0', 'shared', 0)).toBeNull();
    expect(seatOffset('shared')).toBeNull();
  });

  it("'current' follows the acting turn, ignoring the viewer", () => {
    expect(resolveSeat(seats, 'p0', 'current', 0)).toBe('p0');
    expect(resolveSeat(seats, 'p0', 'current', 1)).toBe('p1');
    expect(resolveSeat(seats, 'p2', 'current', 1)).toBe('p1'); // any viewer, same seat
    expect(resolveSeat(seats, '', 'current', 2)).toBe('p2'); // spectators too
    expect(seatOffset('current')).toBeNull(); // no fixed viewer offset
  });

  it("'current' with an out-of-range index resolves nothing", () => {
    expect(resolveSeat(seats, 'p0', 'current', 3)).toBeNull();
    expect(resolveSeat([], 'p0', 'current', 0)).toBeNull();
  });

  it('a spectator viewer (not seated) watches from seat 0', () => {
    expect(resolveSeat(seats, '', 'viewer', 0)).toBe('p0');
    expect(resolveSeat(seats, '', 'opp1', 0)).toBe('p1');
  });

  it('an empty table resolves nothing', () => {
    expect(resolveSeat([], 'p0', 'viewer', 0)).toBeNull();
  });
});

describe('layoutStyleCss', () => {
  it('emits nothing for absent styles', () => {
    expect(layoutStyleCss(undefined)).toEqual({});
    expect(layoutStyleCss({})).toEqual({});
  });

  it('emits only authored properties', () => {
    expect(layoutStyleCss({ background: 'red' })).toEqual({ background: 'red' });
    expect(layoutStyleCss({ borderRadius: 12 })).toEqual({ borderRadius: '12px' });
  });

  it('builds a border from any border field, defaulting the rest', () => {
    expect(layoutStyleCss({ borderColor: '#fff', borderWidth: 2, borderStyle: 'dashed' }))
      .toEqual({ border: '2px dashed #fff' });
    expect(layoutStyleCss({ borderColor: '#abc' }).border).toBe('1px solid #abc');
  });

  it('borderWidth 0 removes the border explicitly', () => {
    expect(layoutStyleCss({ borderWidth: 0 }).border).toBe('none');
  });

  it('per-corner radii override the uniform radius', () => {
    expect(layoutStyleCss({ borderRadius: 8, borderRadii: [10, 0, 10, 0] }).borderRadius)
      .toBe('10px 0px 10px 0px');
    expect(layoutStyleCss({ borderRadius: 8 }).borderRadius).toBe('8px');
  });

  it('emits opacity and box-shadow (drop + inset)', () => {
    expect(layoutStyleCss({ opacity: 0.5 }).opacity).toBe(0.5);
    expect(layoutStyleCss({ shadows: [{ x: 0, y: 4, blur: 12, spread: 2, color: '#000' }] }).boxShadow)
      .toBe('0px 4px 12px 2px #000');
    expect(layoutStyleCss({ shadows: [
      { x: 0, y: 2, blur: 6, color: 'rgba(0,0,0,0.5)' },
      { x: 0, y: 0, blur: 4, color: '#fff', inset: true },
    ] }).boxShadow).toBe('0px 2px 6px 0px rgba(0,0,0,0.5), inset 0px 0px 4px 0px #fff');
  });

  it('an empty shadows array emits no box-shadow', () => {
    expect(layoutStyleCss({ shadows: [] }).boxShadow).toBeUndefined();
  });
});

describe('textStyleCss', () => {
  it('emits nothing for absent typography', () => {
    expect(textStyleCss(undefined)).toEqual({});
    expect(textStyleCss({})).toEqual({});
  });

  it('emits only authored typography, mapping to CSS', () => {
    expect(textStyleCss({
      fontFamily: 'Georgia, serif', fontWeight: 700, italic: true,
      letterSpacing: 2, lineHeight: 1.4, uppercase: true,
    })).toEqual({
      fontFamily: 'Georgia, serif', fontWeight: 700, fontStyle: 'italic',
      letterSpacing: '2px', lineHeight: 1.4, textTransform: 'uppercase',
    });
  });

  it('omits italic/uppercase when false and lets 0 spacing pass', () => {
    expect(textStyleCss({ italic: false, uppercase: false, letterSpacing: 0 }))
      .toEqual({ letterSpacing: '0px' });
  });
});

describe('grid template math', () => {
  it('gridTemplate only for explicit counts', () => {
    expect(gridTemplate(3)).toBe('repeat(3, max-content)');
    expect(gridTemplate(null)).toBeUndefined();
    expect(gridTemplate(undefined)).toBeUndefined();
    expect(gridTemplate(0)).toBeUndefined();
  });

  it('gridSpec: columns alone fix the column count (row-major flow)', () => {
    expect(gridSpec(null, 5)).toEqual({ columns: 'repeat(5, max-content)' });
  });

  it('gridSpec: rows + columns fix both templates', () => {
    expect(gridSpec(2, 5)).toEqual({
      rows: 'repeat(2, max-content)',
      columns: 'repeat(5, max-content)',
    });
  });

  it('gridSpec: rows WITHOUT columns flow column-major so the row count holds', () => {
    expect(gridSpec(2, null)).toEqual({
      rows: 'repeat(2, max-content)',
      autoFlow: 'column',
    });
  });

  it('gridSpec: nothing authored = auto grid (null)', () => {
    expect(gridSpec(null, null)).toBeNull();
    expect(gridSpec(undefined, undefined)).toBeNull();
    expect(gridSpec(0, 0)).toBeNull();
  });
});

describe('shape & line geometry', () => {
  it('radius shapes round themselves regardless of the authored style', () => {
    expect(shapeBorderRadius('circle', { borderRadius: 4 })).toBe('50%');
    expect(shapeBorderRadius('pill', undefined)).toBe('9999px');
    expect(shapeBorderRadius('rounded', undefined)).toBe('16px');
  });

  it('plain rects keep the authored radius (or none)', () => {
    expect(shapeBorderRadius('rect', { borderRadius: 12 })).toBe('12px');
    expect(shapeBorderRadius('rect', {})).toBeUndefined();
    expect(shapeBorderRadius('rect', undefined)).toBeUndefined();
  });

  it('polygon shapes draw their own geometry (no CSS radius, real clip-path)', () => {
    for (const s of ['diamond', 'hexagon', 'star'] as const) {
      expect(shapeBorderRadius(s, { borderRadius: 12 })).toBeUndefined();
      expect(shapePolygon(s)).not.toBeNull();
      expect(shapeClipPath(s)).toMatch(/^polygon\(/);
    }
    // Diamond clip is the four cardinal points.
    expect(shapeClipPath('diamond')).toBe('polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)');
  });

  it('radius shapes have no polygon / clip-path', () => {
    for (const s of ['rect', 'rounded', 'pill', 'circle'] as const) {
      expect(shapePolygon(s)).toBeNull();
      expect(shapeClipPath(s)).toBeNull();
    }
  });

  it('SHAPE_KINDS lists the seven silhouettes + the custom path', () => {
    expect(SHAPE_KINDS).toEqual(['rect', 'rounded', 'pill', 'circle', 'diamond', 'hexagon', 'star', 'path']);
  });

  it('line endpoints: h/v cross the middle, down = TL→BR, up = BL→TR', () => {
    expect(lineEndpoints('h')).toEqual({ x1: 0, y1: 50, x2: 100, y2: 50 });
    expect(lineEndpoints('v')).toEqual({ x1: 50, y1: 0, x2: 50, y2: 100 });
    expect(lineEndpoints('down')).toEqual({ x1: 0, y1: 0, x2: 100, y2: 100 });
    expect(lineEndpoints('up')).toEqual({ x1: 0, y1: 100, x2: 100, y2: 0 });
  });

  it('line color = style.borderColor, falling back to the border token', () => {
    expect(lineColor({ borderColor: '#f0f' })).toBe('#f0f');
    expect(lineColor({})).toBe('var(--border-strong)');
    expect(lineColor(undefined)).toBe('var(--border-strong)');
  });
});

describe('spacing math', () => {
  it('pctToPx converts % of screen width', () => {
    expect(pctToPx(1000, 2)).toBe(20);
    expect(pctToPx(1000, undefined)).toBeUndefined();
  });

  it('fanMarginPx: gap = visible slice per card (negative margin overlaps)', () => {
    expect(fanMarginPx(80, 20)).toBe(-60);
    expect(fanMarginPx(80, undefined)).toBeUndefined();
  });

  it('fitCount floors, clamps to [1, max]', () => {
    expect(fitCount(300, 80, 10)).toBe(3); // 3*80 + 2*10 = 260 <= 300
    expect(fitCount(50, 80, 10)).toBe(1);
    expect(fitCount(10000, 80, 10, 8)).toBe(8);
  });
});

describe('pile / duplicate grouping', () => {
  const cards = {
    c1: { defId: 'copper', name: 'Copper' },
    c2: { defId: 'copper', name: 'Copper' },
    c3: { defId: 'copper', name: 'Copper' },
    e1: { defId: 'estate', name: 'Estate' },
    qh1: { defId: null, name: 'Q of hearts' },
    qh2: { defId: null, name: 'Q of hearts' },
    ks1: { defId: null, name: 'K of spades' },
  };

  it('identity: custom cards by defId, standard cards by name', () => {
    expect(cardIdentity(cards.c1)).toBe('copper');
    expect(cardIdentity(cards.qh1)).toBe('std:Q of hearts');
  });

  it('groups in first-appearance order, top = last member (zone order)', () => {
    const piles = groupPiles(['c1', 'e1', 'c2', 'qh1', 'c3', 'qh2'], cards);
    expect(piles.map((p) => p.key)).toEqual(['copper', 'estate', 'std:Q of hearts']);
    const copper = piles[0];
    expect(copper.cardIds).toEqual(['c1', 'c2', 'c3']);
    expect(copper.topId).toBe('c3');
    expect(copper.count).toBe(3);
    expect(piles[1]).toEqual({ key: 'estate', cardIds: ['e1'], topId: 'e1', count: 1 });
    expect(piles[2].count).toBe(2);
  });

  it('two different standard cards never merge; unknown ids are skipped', () => {
    const piles = groupPiles(['qh1', 'ks1', 'ghost', 'qh2'], cards);
    expect(piles.map((p) => p.key)).toEqual(['std:Q of hearts', 'std:K of spades']);
    expect(piles[0].count).toBe(2);
  });

  it('empty zone groups to no piles', () => {
    expect(groupPiles([], cards)).toEqual([]);
  });

  it('topLegalCard picks the TOPMOST legal member (or null)', () => {
    const legal = new Set(['c1', 'c2']);
    expect(topLegalCard(['c1', 'c2', 'c3'], (id) => legal.has(id))).toBe('c2');
    expect(topLegalCard(['c3'], (id) => legal.has(id))).toBeNull();
    expect(topLegalCard([], () => true)).toBeNull();
  });
});

describe('depleted-pile memory (groupPilesRemembered)', () => {
  const cards = {
    c1: { defId: 'copper', name: 'Copper' },
    c2: { defId: 'copper', name: 'Copper' },
    e1: { defId: 'estate', name: 'Estate' },
    s1: { defId: 'silver', name: 'Silver' },
  };

  it('first sight matches groupPiles and seeds the memory (last-seen tops + facing)', () => {
    const memory = new Map<string, PileMemoryEntry>();
    const piles = groupPilesRemembered(['c1', 'e1', 'c2'], cards, memory);
    expect(piles).toEqual(groupPiles(['c1', 'e1', 'c2'], cards));
    expect([...memory.entries()]).toEqual([
      ['copper', { topId: 'c2', faceUp: true }],
      ['estate', { topId: 'e1', faceUp: true }],
    ]);
  });

  it('a depleted identity stays as a count-0 placeholder, in place', () => {
    const memory = new Map<string, PileMemoryEntry>();
    groupPilesRemembered(['c1', 'e1'], cards, memory);
    const piles = groupPilesRemembered(['e1'], cards, memory); // copper gone
    expect(piles.map((p) => [p.key, p.count])).toEqual([['copper', 0], ['estate', 1]]);
    // The placeholder's face is the last-seen top member, remembered facing.
    expect(piles[0]).toEqual({ key: 'copper', cardIds: [], topId: 'c1', count: 0, faceUp: true });
  });

  it('placeholder facing is the snapshot taken while LIVE, never re-resolved', () => {
    const memory = new Map<string, PileMemoryEntry>();
    // While the pile stood here its top was visible…
    groupPilesRemembered(['c1'], cards, memory, ['c1'], () => true);
    // …after depletion the resolver would now say hidden (the departed copy
    // was buried in a hidden zone) — the placeholder keeps the snapshot.
    const piles = groupPilesRemembered([], cards, memory, [], () => false);
    expect(piles).toEqual([{ key: 'copper', cardIds: [], topId: 'c1', count: 0, faceUp: true }]);
    // And a pile that was face DOWN while live depletes into a face-down
    // placeholder (nothing hidden leaks through the memory).
    const hidden = new Map<string, PileMemoryEntry>();
    groupPilesRemembered(['e1'], cards, hidden, ['e1'], () => false);
    expect(groupPilesRemembered([], cards, hidden, [])[0].faceUp).toBe(false);
  });

  it('keeps first-appearance order stable as piles deplete and new ones arrive', () => {
    const memory = new Map<string, PileMemoryEntry>();
    groupPilesRemembered(['c1', 'e1'], cards, memory);
    // Both remembered piles empty out; a brand-new identity appears.
    const piles = groupPilesRemembered(['s1'], cards, memory);
    expect(piles.map((p) => [p.key, p.count])).toEqual([
      ['copper', 0], ['estate', 0], ['silver', 1],
    ]);
  });

  it('a refilled identity comes back live at its original spot', () => {
    const memory = new Map<string, PileMemoryEntry>();
    groupPilesRemembered(['c1', 'e1'], cards, memory);
    groupPilesRemembered(['e1'], cards, memory); // copper depleted…
    const piles = groupPilesRemembered(['e1', 'c2'], cards, memory); // …and back
    expect(piles.map((p) => [p.key, p.count])).toEqual([['copper', 1], ['estate', 1]]);
    expect(piles[0].topId).toBe('c2'); // fresh top, and the memory follows it
    expect(memory.get('copper')).toEqual({ topId: 'c2', faceUp: true });
  });

  it('display-filtered identities are omitted, never shown as depleted', () => {
    const memory = new Map<string, PileMemoryEntry>();
    groupPilesRemembered(['c1', 'e1'], cards, memory, ['c1', 'e1']);
    // Estate is filtered from the display slice but still IN the zone -> no
    // pile and no placeholder; copper truly left the zone -> placeholder.
    const piles = groupPilesRemembered([], cards, memory, ['e1']);
    expect(piles.map((p) => [p.key, p.count])).toEqual([['copper', 0]]);
    // Back on the slice, estate reappears live where it always was.
    const back = groupPilesRemembered(['e1'], cards, memory, ['e1']);
    expect(back.map((p) => [p.key, p.count])).toEqual([['copper', 0], ['estate', 1]]);
  });

  it('per-ELEMENT memories: a depletion only placeholds in the slice that showed it', () => {
    // One shared zone rendered through two slice elements with disjoint
    // display filters — each element owns its own memory map (ZoneBlock
    // keys ctx.pileMemory by element + instance).
    const victory = new Map<string, PileMemoryEntry>();
    const treasury = new Map<string, PileMemoryEntry>();
    const zone = ['c1', 'e1'];
    groupPilesRemembered(['e1'], cards, victory, zone);
    groupPilesRemembered(['c1'], cards, treasury, zone);
    // The estate pile depletes (its cards leave the zone entirely).
    const after = ['c1'];
    expect(groupPilesRemembered([], cards, victory, after).map((p) => [p.key, p.count]))
      .toEqual([['estate', 0]]);
    // The treasury slice never showed estate: no ghost placeholder leaks in.
    expect(groupPilesRemembered(['c1'], cards, treasury, after).map((p) => [p.key, p.count]))
      .toEqual([['copper', 1]]);
  });

  it('an empty memory and an empty zone group to nothing', () => {
    expect(groupPilesRemembered([], cards, new Map())).toEqual([]);
  });
});

describe('fan transforms', () => {
  it('the center card of an odd fan stays flat', () => {
    expect(fanTransform(2, 5, 88)).toEqual({ rot: 0, dy: 0 });
  });

  it('rotation steps by the default 4° per centered index', () => {
    expect(fanTransform(0, 5, 88).rot).toBe(-8);
    expect(fanTransform(4, 5, 88).rot).toBe(8);
    expect(fanTransform(3, 5, 88).rot).toBe(4);
  });

  it('an authored fanAngle replaces the default step', () => {
    expect(fanTransform(0, 3, 88, 10).rot).toBe(-10);
    expect(fanTransform(2, 3, 88, 10).rot).toBe(10);
  });

  it('fanAngle 0 = flat (no rotation, no dip)', () => {
    expect(fanTransform(0, 7, 88, 0)).toEqual({ rot: 0, dy: 0 });
    expect(fanTransform(6, 7, 88, 0)).toEqual({ rot: 0, dy: 0 });
  });

  it('the dip is parabolic and symmetric (edges dip more than inner cards)', () => {
    const edge = fanTransform(0, 5, 88);
    const inner = fanTransform(1, 5, 88);
    const otherEdge = fanTransform(4, 5, 88);
    expect(edge.dy).toBeGreaterThan(inner.dy);
    expect(inner.dy).toBeGreaterThan(0);
    expect(edge.dy).toBeCloseTo(otherEdge.dy, 6);
    expect(edge.dy).toBeCloseTo(4 * inner.dy, 6); // (±2)² vs (±1)²
  });

  it('single cards and flat counts never transform', () => {
    expect(fanTransform(0, 1, 88)).toEqual({ rot: 0, dy: 0 });
    expect(fanTransform(0, 0, 88)).toEqual({ rot: 0, dy: 0 });
  });
});

describe('motion spec + speed control', () => {
  it('resolveMotion defaults to the reference primitive (430/46/4/55, no tags)', () => {
    expect(resolveMotion(undefined)).toEqual(MOTION_DEFAULTS);
    expect(resolveMotion(null)).toEqual({ flightMs: 430, arc: 46, spin: 4, staggerMs: 55 });
  });

  it('authored fields override individually, the rest keep defaults', () => {
    expect(resolveMotion({ flightMs: 600 }))
      .toEqual({ flightMs: 600, arc: 46, spin: 4, staggerMs: 55 });
    expect(resolveMotion({ arc: 70, spin: 6, staggerMs: 0 }))
      .toEqual({ flightMs: 430, arc: 70, spin: 6, staggerMs: 0 });
  });

  it('resolveMotion keeps an authored byTag table (absent otherwise)', () => {
    expect(resolveMotion({ flightMs: 600 }).byTag).toBeUndefined();
    expect(resolveMotion({ byTag: { draw: { flightMs: 300 } } }).byTag)
      .toEqual({ draw: { flightMs: 300 } });
  });

  it('motionForTag: a tagged flight takes its byTag numbers over the base', () => {
    const m = resolveMotion({
      flightMs: 400,
      byTag: { draw: { flightMs: 300, arc: 22, staggerMs: 45 }, play: { arc: 38 } },
    });
    expect(motionForTag(m, 'draw'))
      .toEqual({ flightMs: 300, arc: 22, spin: 4, staggerMs: 45 });
    // Partial override: unset fields keep the base numbers.
    expect(motionForTag(m, 'play'))
      .toEqual({ flightMs: 400, arc: 38, spin: 4, staggerMs: 55 });
  });

  it('motionForTag: untagged moves and unlisted tags keep the base', () => {
    const m = resolveMotion({ byTag: { draw: { flightMs: 300 } } });
    expect(motionForTag(m, null)).toMatchObject({ flightMs: 430, arc: 46 });
    expect(motionForTag(m, undefined)).toMatchObject({ flightMs: 430 });
    expect(motionForTag(m, 'gain')).toMatchObject({ flightMs: 430 });
    expect(motionForTag(resolveMotion(undefined), 'draw')).toMatchObject({ flightMs: 430 });
  });

  it('speedFactor: 1× = 1, 2× = 1/1.9, instant = 0 (skip clones)', () => {
    expect(speedFactor('1x')).toBe(1);
    expect(speedFactor('2x')).toBeCloseTo(1 / 1.9, 9);
    expect(speedFactor('instant')).toBe(0);
  });

  it('scaleMs scales and rounds durations', () => {
    expect(scaleMs(430, 1)).toBe(430);
    expect(scaleMs(430, 1 / 1.9)).toBe(226);
    expect(scaleMs(55, 1 / 1.9)).toBe(29);
    expect(scaleMs(430, 0)).toBe(0);
  });

  it('asSpeed sanitizes persisted values; nextSpeed cycles the toggle', () => {
    expect(asSpeed('2x')).toBe('2x');
    expect(asSpeed('instant')).toBe('instant');
    expect(asSpeed('warp')).toBe('1x');
    expect(asSpeed(null)).toBe('1x');
    expect(nextSpeed('1x')).toBe('2x');
    expect(nextSpeed('2x')).toBe('instant');
    expect(nextSpeed('instant')).toBe('1x');
  });
});

describe('screen variants + stage geometry', () => {
  const el = (id: string): ScreenElement => ({
    kind: 'shape', id, name: id, rect: { x: 0, y: 0, w: 10, h: 10 }, shape: 'circle',
  });
  const desktop: ScreenLayout = {
    background: 'navy',
    aspect: 1.6,
    elements: [el('d1'), el('d2')],
  };

  it('without a mobile variant the desktop tree renders at every width', () => {
    expect(activeScreenVariant(desktop, false)).toEqual({
      variant: 'desktop', elements: desktop.elements, background: 'navy', aspect: 1.6, scroll: false,
    });
    expect(activeScreenVariant(desktop, true).variant).toBe('desktop');
    expect(activeScreenVariant(desktop, true).elements).toBe(desktop.elements);
  });

  it('a narrow viewport picks the mobile tree; a wide one ignores it', () => {
    const layout: ScreenLayout = {
      ...desktop,
      mobile: { background: 'black', aspect: 0.4, scroll: true, elements: [el('m1')] },
    };
    const mobile = activeScreenVariant(layout, true);
    expect(mobile.variant).toBe('mobile');
    expect(mobile.elements.map((e) => e.id)).toEqual(['m1']);
    expect(mobile.background).toBe('black');
    expect(mobile.aspect).toBe(0.4);
    expect(mobile.scroll).toBe(true);
    expect(activeScreenVariant(layout, false).variant).toBe('desktop');
  });

  it("the mobile background falls back to the desktop's; aspect does not", () => {
    const layout: ScreenLayout = { ...desktop, mobile: { elements: [el('m1')] } };
    const mobile = activeScreenVariant(layout, true);
    expect(mobile.background).toBe('navy');
    expect(mobile.aspect).toBeNull(); // fill — never inherits the desktop aspect
    expect(mobile.scroll).toBe(false);
  });

  it('scroll only engages with a positive numeric aspect', () => {
    const noAspect: ScreenLayout = { ...desktop, mobile: { scroll: true, elements: [] } };
    expect(activeScreenVariant(noAspect, true).scroll).toBe(false);
    const withAspect: ScreenLayout = {
      ...desktop, mobile: { scroll: true, aspect: 0.5, elements: [] },
    };
    expect(activeScreenVariant(withAspect, true).scroll).toBe(true);
  });

  it('computeStage: null aspect fills the area', () => {
    expect(computeStage(800, 600, null, false))
      .toEqual({ left: 0, top: 0, w: 800, h: 600, scrollable: false });
  });

  it('computeStage: a numeric aspect letterboxes a centered stage', () => {
    expect(computeStage(1000, 500, 1, false))
      .toEqual({ left: 250, top: 0, w: 500, h: 500, scrollable: false });
    expect(computeStage(500, 1000, 1, false))
      .toEqual({ left: 0, top: 250, w: 500, h: 500, scrollable: false });
  });

  it('computeStage: scroll pages span the width, height = width / aspect', () => {
    expect(computeStage(390, 700, 0.5, true))
      .toEqual({ left: 0, top: 0, w: 390, h: 780, scrollable: true });
  });

  it('computeStage: zero-sized areas produce an empty stage', () => {
    expect(computeStage(0, 600, 1, true)).toEqual({ left: 0, top: 0, w: 0, h: 0, scrollable: false });
  });
});

// ---------------------------------------------------------------------------
// FlowLayout CSS (Tasks 2-3)
// ---------------------------------------------------------------------------

describe('flowLayoutCss', () => {
  it('returns {} for undefined', () => {
    expect(flowLayoutCss(undefined, 1000)).toEqual({});
  });
  it('row -> flex row with px gap/padding + justify/align/wrap', () => {
    const css = flowLayoutCss(
      { mode: 'row', gap: 2, padding: 1, justify: 'between', align: 'center', wrap: true }, 1000);
    expect(css.display).toBe('flex');
    expect(css.flexDirection).toBe('row');
    expect(css.gap).toBe('20px');
    expect(css.padding).toBe('10px');
    expect(css.justifyContent).toBe('space-between');
    expect(css.alignItems).toBe('center');
    expect(css.flexWrap).toBe('wrap');
  });
  it('column -> flex column', () => {
    expect(flowLayoutCss({ mode: 'column' }, 1000).flexDirection).toBe('column');
  });
  it('grid with fixed columns', () => {
    const css = flowLayoutCss({ mode: 'grid', columns: 3, gap: 1 }, 1000);
    expect(css.display).toBe('grid');
    expect(css.gridTemplateColumns).toBe('repeat(3, max-content)');
    expect(css.gap).toBe('10px');
  });
  it('grid rows without columns flows column-major', () => {
    const css = flowLayoutCss({ mode: 'grid', rows: 2 }, 1000);
    expect(css.gridTemplateRows).toBe('repeat(2, max-content)');
    expect(css.gridAutoFlow).toBe('column');
  });
  it('grid autoFit -> auto-fill minmax', () => {
    const css = flowLayoutCss({ mode: 'grid', autoFit: 8 }, 1000);
    expect(css.gridTemplateColumns).toBe('repeat(auto-fill, minmax(80px, 1fr))');
  });
});

describe('flowChildCss', () => {
  it('grid child: relative only (the cell sizes it)', () => {
    expect(flowChildCss({ mode: 'grid' }, { w: 10, h: 10 })).toEqual({ position: 'relative' });
  });
  it('uniform: flex 1 1 0, no explicit size', () => {
    expect(flowChildCss({ mode: 'row', itemSize: 'uniform' }, { w: 10, h: 5 }))
      .toEqual({ position: 'relative', flex: '1 1 0' });
  });
  it('auto: basis from rect w/h, flex 0 0 auto (beats .rn-el>*{flex:1})', () => {
    expect(flowChildCss({ mode: 'row' }, { w: 16, h: 8 }))
      .toEqual({ position: 'relative', flex: '0 0 auto', width: '16%', height: '8%' });
  });
  it('stretch: adds cross-axis stretch', () => {
    expect(flowChildCss({ mode: 'row', itemSize: 'stretch' }, { w: 16, h: 8 }).alignSelf).toBe('stretch');
  });
});

describe('slotRect', () => {
  const psEl = {
    kind: 'panelSwitcher', id: 'p', name: 'P', rect: { x: 10, y: 10, w: 40, h: 40 },
    selectorGroup: 'g', children: [],
    slots: [{ id: 'tabs', name: 'Tabs', layout: { mode: 'row' }, rect: { x: 0, y: 0, w: 100, h: 12 } }],
  } as ScreenElement;
  it('returns the slot region as % of the container', () => {
    expect(slotRect(psEl, 'tabs')).toEqual({ x: 0, y: 0, w: 100, h: 12 });
  });
  it('missing slot -> the whole box', () => {
    expect(slotRect(psEl, 'nope')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});
