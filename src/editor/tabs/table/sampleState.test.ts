/**
 * Tests for the live-preview sample game: buildSampleState runs the def
 * headlessly (2 sample seats, fixed seed 7) with identity memoization and a
 * null fallback on setup failures, and the canvas preview's resolution
 * helpers (previewElementVisible / zonePreview) match the runner — pinned
 * against the seeded Dominion def: exactly one seal name face is visible for
 * viewer p0 at start.
 */
import { describe, expect, it } from 'vitest';
import type { GameState, ScreenElement } from '../../../shared/types';
import { newGameDef } from '../../../shared/defaults';
import { buildDominionDef } from '../../../forge/dominionGame';
import { SAMPLE_VIEWER_ID, buildSampleState } from './sampleState';
import { previewElementVisible, zonePreview } from './screenModel';

type ZoneEl = Extract<ScreenElement, { kind: 'zone' }>;

function flatten(els: readonly ScreenElement[]): ScreenElement[] {
  return els.flatMap((el) => [el, ...(el.children ? flatten(el.children) : [])]);
}

const rect = { x: 0, y: 0, w: 10, h: 10 };

describe('buildSampleState', () => {
  it('runs the def headlessly: two human sample seats, engine ids p0/p1', async () => {
    const state = await buildSampleState(buildDominionDef());
    expect(state).not.toBeNull();
    expect(state!.players.map((p) => p.name)).toEqual(['Sample A', 'Sample B']);
    expect(state!.players.map((p) => p.id)).toEqual([SAMPLE_VIEWER_ID, 'p1']);
    expect(state!.players.every((p) => !p.isAI)).toBe(true);
  });

  it('memoizes by game signature — the same def yields the SAME snapshot', async () => {
    const def = newGameDef('Sample memo');
    const a = await buildSampleState(def);
    const b = await buildSampleState(def);
    expect(a).not.toBeNull();
    expect(b).toBe(a);
  });

  it('caches by game content, not object identity — equal defs share the snapshot', async () => {
    const def = buildDominionDef();
    const a = await buildSampleState(structuredClone(def));
    const b = await buildSampleState(structuredClone(def));
    expect(a).not.toBeNull();
    expect(b).toBe(a); // distinct objects, equal game content → the cached run
  });

  it('a screen-layout-only change reuses the sample (no needless rebuild)', async () => {
    // The fix that stops the preview greying out on a rect drag: the screen
    // layout is excluded from the signature, so changing it must not rebuild.
    const def = buildDominionDef();
    const a = await buildSampleState(def);
    const moved = structuredClone(def);
    moved.screenLayout!.background = '#123456';
    (moved.screenLayout!.elements[0] as { rect: { x: number } }).rect.x += 5;
    const b = await buildSampleState(moved);
    expect(b).toBe(a);
  });

  it('yields null when the setup reports a script error', async () => {
    const def = newGameDef('Broken setup');
    def.setup = [{ kind: 'shuffle', zone: { zoneId: 'zone_nope', owner: null } }];
    expect(await buildSampleState(def)).toBeNull();
  });
});

describe('preview resolution (runner parity) against the seeded Dominion def', () => {
  it('shows exactly one seal name face for viewer p0 at start', async () => {
    const def = buildDominionDef();
    const state = (await buildSampleState(def))!;
    expect(state).not.toBeNull();
    const els = flatten(def.screenLayout!.elements);
    const faces = els.filter((el) => el.id.startsWith('dom_el_seal_name_'));
    expect(faces.length).toBeGreaterThan(1); // all six stacked faces exist…
    const visible = faces.filter((el) => previewElementVisible(def, state, el, SAMPLE_VIEWER_ID));
    // …but at start (p0's turn, Action phase, quiet stack) only Action shows.
    expect(visible.map((el) => el.id)).toEqual(['dom_el_seal_name_action']);
  });

  it("reads the viewer's real hand from the sample (5-card Dominion opener)", async () => {
    const def = buildDominionDef();
    const state = (await buildSampleState(def))!;
    const els = flatten(def.screenLayout!.elements);
    const hand = els.find(
      (el): el is ZoneEl => el.kind === 'zone' && el.seat === 'viewer'
        && def.zones.find((z) => z.id === el.zoneId)?.name === 'Hand',
    )!;
    expect(hand).toBeDefined();
    expect(zonePreview(def, state, hand, SAMPLE_VIEWER_ID)!.count).toBe(5);
  });

  it('groups pile/carousel displays into the real sample piles', async () => {
    const def = buildDominionDef();
    const state = (await buildSampleState(def))!;
    // The Dominion supply switcher (grouped display) lives in the MOBILE tree.
    const els = [
      ...flatten(def.screenLayout!.elements),
      ...flatten(def.screenLayout!.mobile?.elements ?? []),
    ];
    const supply = els.find(
      (el): el is ZoneEl =>
        el.kind === 'zone' && (el.display === 'piles' || el.display === 'carousel'),
    )!;
    expect(supply).toBeDefined();
    const real = zonePreview(def, state, supply, SAMPLE_VIEWER_ID)!;
    expect(real.piles).not.toBeNull();
    expect(real.piles!.length).toBeGreaterThan(0);
    expect(real.piles!.every((p) => p.count >= 1 && p.name !== '')).toBe(true);
  });

  it('hides seats beyond the 2-seat sample and dangling refs (runner parity)', async () => {
    const def = newGameDef('Seat parity');
    const state = (await buildSampleState(def)) as GameState;
    expect(state).not.toBeNull();
    const hand = def.zones.find((z) => z.owner === 'perPlayer')!;
    const opp2: ZoneEl = { kind: 'zone', id: 'e1', name: 'x', rect, zoneId: hand.id, seat: 'opp2' };
    expect(previewElementVisible(def, state, opp2, SAMPLE_VIEWER_ID)).toBe(false);
    expect(zonePreview(def, state, opp2, SAMPLE_VIEWER_ID)).toBeNull();
    const opp1: ZoneEl = { ...opp2, seat: 'opp1' };
    expect(previewElementVisible(def, state, opp1, SAMPLE_VIEWER_ID)).toBe(true);
    const dangling: ZoneEl = { ...opp1, zoneId: 'zone_nope' };
    expect(previewElementVisible(def, state, dangling, SAMPLE_VIEWER_ID)).toBe(false);
    const missingVar: ScreenElement = {
      kind: 'varText', id: 'e2', name: 'v', rect, varId: 'var_nope', seat: 'viewer',
      fontSize: 2, align: 'left',
    };
    expect(previewElementVisible(def, state, missingVar, SAMPLE_VIEWER_ID)).toBe(false);
  });
});
