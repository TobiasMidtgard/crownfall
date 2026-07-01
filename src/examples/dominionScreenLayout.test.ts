/**
 * Dominion war table (screenLayout) — the reference-fidelity showcase, tested
 * against REAL engine states. The layout is render-only, so these tests start
 * the actual engine and evaluate the shipped expressions exactly like the
 * runner does:
 *   - the THREE supply elements slice the ONE shared supply zone into
 *     treasure / victory / kingdom piles via display-only cardFilters,
 *   - the phase seal's stacked phase texts, diamond dots and phase-advance
 *     buttons gate on phaseIndex/phasePos and flip when 'Done' is performed,
 *   - the mobile variant is a tall scrolling Crownfall-style column with
 *     44px+ touch targets,
 *   - the motion spec carries the reference flight values (430/46/4/55).
 */
import { describe, expect, it } from 'vitest';
import type { GameDef, GameState, ScreenElement } from '../shared/types';
import { createEngine, evalDisplayExpr, isDisplayVisible } from '../engine';
import {
  activeScreenVariant, computeStage, filterDisplayCards, groupPiles, resolveElementAppearance,
  resolveMotion,
} from '../runner/layoutGeometry';
import { renderTextParts } from '../runner/layout';
import { validateGameDef } from '../shared/validate';
import { dominionGame } from './dominion';

const SUPPLY_KEY = 'dom_zone_supply';
const CTYPE = 'dom_field_ctype';
const COST = 'dom_field_cost';

// ---------------------------------------------------------------------------
// Harness (same shape as ygoScreenLayout.test.ts: real engine, no choices)
// ---------------------------------------------------------------------------

function started(def: GameDef) {
  const errors: string[] = [];
  const engine = createEngine(def, {
    playerNames: ['Ada', 'Brook'],
    aiSeats: [false, false],
    seed: 7,
    choiceProvider: {
      // These tests never trigger a choice; reaching one is a failure.
      resolve(req) { throw new Error(`unexpected choice: ${req.prompt}`); },
    },
    onUpdate: () => {},
    onScriptError: (m) => errors.push(m),
  });
  return { engine, errors, state: () => engine.getState() };
}

/** Find an element anywhere in a tree (groups included). */
function findIn(elements: ScreenElement[], id: string): ScreenElement {
  const walk = (els: ScreenElement[]): ScreenElement | null => {
    for (const el of els) {
      if (el.id === id) return el;
      if (el.kind === 'group') {
        const hit = walk(el.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  const el = walk(elements);
  if (!el) throw new Error(`no screen element "${id}"`);
  return el;
}

const desktop = () => dominionGame.screenLayout!.elements;
const mobile = () => dominionGame.screenLayout!.mobile!.elements;

function zoneEl(elements: ScreenElement[], id: string): Extract<ScreenElement, { kind: 'zone' }> {
  const el = findIn(elements, id);
  if (el.kind !== 'zone') throw new Error(`"${id}" is not a zone element`);
  return el;
}

/** Name of the state an element currently shows (runner mechanism), or null. */
function stateName(
  state: GameState, el: ScreenElement, viewerId: string,
): string | null {
  const app = resolveElementAppearance(dominionGame, state, el, viewerId);
  if (app.stateId === null) return null;
  const hit = (el.states ?? []).find((s) => s.id === app.stateId);
  if (!hit) throw new Error(`element "${el.name}" matched unknown state ${app.stateId}`);
  return hit.name;
}

/** Every element in a tree, groups included (depth-first). */
function flatten(elements: ScreenElement[]): ScreenElement[] {
  return elements.flatMap((el) => (
    el.kind === 'group' ? [el, ...flatten(el.children)] : [el]
  ));
}

// ---------------------------------------------------------------------------
// Validation + stable ids
// ---------------------------------------------------------------------------

describe('war table validation', () => {
  it('the def (both layout variants included) has zero errors and zero warnings', () => {
    expect(dominionGame.screenLayout).toBeTruthy();
    expect(validateGameDef(dominionGame)).toEqual([]);
  });

  it('every element id is unique across both trees and uses the dom_el_ prefix', () => {
    const ids = [...flatten(desktop()), ...flatten(mobile())].map((el) => el.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^dom_el_/);
  });
});

// ---------------------------------------------------------------------------
// Supply slices: three elements over ONE zone via display-only cardFilters
// ---------------------------------------------------------------------------

describe('war table supply slices', () => {
  it('treasure / victory / kingdom filters partition the spawned supply exactly', async () => {
    const h = started(dominionGame);
    await h.engine.start();
    const state = h.state();
    const supply = state.zones[SUPPLY_KEY];
    // 30+20+15 treasures, 12+12+12 victory, 9 kingdom piles of 10.
    expect(supply.cardIds).toHaveLength(191);

    const treasures = zoneEl(desktop(), 'dom_el_supply_treasures');
    const victory = zoneEl(desktop(), 'dom_el_supply_victory');
    const kingdom = zoneEl(desktop(), 'dom_el_supply_kingdom');
    for (const el of [treasures, victory, kingdom]) {
      expect(el.zoneId).toBe(SUPPLY_KEY);
      expect(el.seat).toBe('shared');
      expect(el.display).toBe('piles');
      expect(el.pileBadgeField).toBe(COST);
      expect(el.cardFilter).toBeTruthy();
    }

    // Evaluate the shipped filters against the live zone, exactly like the
    // renderer ($card bound per candidate, $viewer bound).
    const slice = (el: Extract<ScreenElement, { kind: 'zone' }>) =>
      filterDisplayCards(dominionGame, state, supply.cardIds, el.cardFilter, 'p0');
    const t = slice(treasures);
    const v = slice(victory);
    const k = slice(kingdom);
    expect(t).toHaveLength(65);
    expect(v).toHaveLength(36);
    expect(k).toHaveLength(90);
    // Disjoint union = the whole zone (every card lands in exactly one region).
    expect(new Set([...t, ...v, ...k]).size).toBe(supply.cardIds.length);

    // The slices really are type-pure.
    const ctypes = (ids: string[]) => new Set(ids.map((id) => state.cards[id].fields[CTYPE]));
    expect(ctypes(t)).toEqual(new Set(['treasure']));
    expect(ctypes(v)).toEqual(new Set(['victory']));
    for (const ct of ctypes(k)) expect(['treasure', 'victory']).not.toContain(ct);

    // Pile grouping (what 'piles' display renders): 3 + 3 + 9 piles of 10+.
    expect(groupPiles(t, state.cards)).toHaveLength(3);
    expect(groupPiles(v, state.cards)).toHaveLength(3);
    const kingdomPiles = groupPiles(k, state.cards);
    expect(kingdomPiles).toHaveLength(9);
    for (const pile of kingdomPiles) expect(pile.count).toBe(10);

    // Authored grids: mini columns for treasure/victory, the 5×2 kingdom wall.
    expect([treasures.rows, treasures.columns]).toEqual([3, 1]);
    expect([victory.rows, victory.columns]).toEqual([3, 1]);
    expect([kingdom.rows, kingdom.columns]).toEqual([2, 5]);

    // The mobile rows slice identically (same filters over the same zone).
    const mk = zoneEl(mobile(), 'dom_el_m_supply_kingdom');
    expect(filterDisplayCards(dominionGame, state, supply.cardIds, mk.cardFilter, 'p0')).toEqual(k);
    expect(h.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The phase seal: texts / dots / buttons flip when 'Done' advances the phase
// ---------------------------------------------------------------------------

describe('war table phase seal', () => {
  it('gates phase texts, diamond dots and the stacked buttons across Done', async () => {
    const h = started(dominionGame);
    await h.engine.start();
    let state = h.state();
    expect(state.players[state.currentPlayerIdx].id).toBe('p0');
    expect(state.phaseIdx).toBe(0); // Action (manual)

    const actionText = findIn(desktop(), 'dom_el_seal_phase_action');
    const buyText = findIn(desktop(), 'dom_el_seal_phase_buy');
    const doneBtn = findIn(desktop(), 'dom_el_seal_btn_done');
    const endBtn = findIn(desktop(), 'dom_el_seal_btn_end');
    const actionDot = findIn(desktop(), 'dom_el_seal_dot_action');
    const buyDot = findIn(desktop(), 'dom_el_seal_dot_buy');
    const seal = findIn(desktop(), 'dom_el_seal');

    // Action phase: the 'Action' stamp shows for EVERY seat (phase logic is
    // viewer-free); the buttons additionally gate on the viewer's own turn.
    expect(evalDisplayExpr(dominionGame, state, actionText.visible!, 'p0')).toBe(true);
    expect(evalDisplayExpr(dominionGame, state, actionText.visible!, 'p1')).toBe(true);
    expect(evalDisplayExpr(dominionGame, state, buyText.visible!, 'p0')).toBe(false);
    expect(evalDisplayExpr(dominionGame, state, doneBtn.visible!, 'p0')).toBe(true);
    expect(evalDisplayExpr(dominionGame, state, doneBtn.visible!, 'p1')).toBe(false);
    expect(evalDisplayExpr(dominionGame, state, endBtn.visible!, 'p0')).toBe(false);
    // Dots: Action is current, Buy not yet reached (base outline).
    expect(stateName(state, actionDot, 'p0')).toBe('Current');
    expect(stateName(state, buyDot, 'p0')).toBeNull();
    // The seal group stamps + wears its 'My turn' ring for the turn player.
    expect(seal.onChangeAnim).toBe('stamp');
    expect(stateName(state, seal, 'p0')).toBe('My turn');
    expect(stateName(state, seal, 'p1')).toBeNull();

    // The Done button binds the REAL none-target action the engine offers.
    if (doneBtn.kind !== 'button') throw new Error('done is not a button');
    const done = h.engine.getLegalMoves('p0').find((m) => m.actionId === doneBtn.actionId);
    expect(done).toBeDefined();
    await h.engine.performAction('p0', done!);

    // Buy phase: everything flips.
    state = h.state();
    expect(state.phaseIdx).toBe(1);
    expect(evalDisplayExpr(dominionGame, state, actionText.visible!, 'p0')).toBe(false);
    expect(evalDisplayExpr(dominionGame, state, buyText.visible!, 'p0')).toBe(true);
    expect(evalDisplayExpr(dominionGame, state, doneBtn.visible!, 'p0')).toBe(false);
    expect(evalDisplayExpr(dominionGame, state, endBtn.visible!, 'p0')).toBe(true);
    expect(evalDisplayExpr(dominionGame, state, endBtn.visible!, 'p1')).toBe(false);
    expect(stateName(state, actionDot, 'p0')).toBe('Done');
    expect(stateName(state, buyDot, 'p0')).toBe('Current');

    // The mobile tree is wired to the same engine truth.
    expect(isDisplayVisible(dominionGame, state, findIn(mobile(), 'dom_el_m_phase_buy').visible, 'p0')).toBe(true);
    expect(isDisplayVisible(dominionGame, state, findIn(mobile(), 'dom_el_m_btn_end').visible, 'p0')).toBe(true);
    expect(isDisplayVisible(dominionGame, state, findIn(mobile(), 'dom_el_m_btn_done').visible, 'p0')).toBe(false);
    expect(h.errors).toEqual([]);
  });

  it('passes the seal (and the foe strip) to the other seat on end turn', async () => {
    const h = started(dominionGame);
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'dom_action_done' });
    await h.engine.performAction('p0', { actionId: 'dom_action_end_turn' });

    // Cleanup is auto: discard, redraw, pass — p1 holds the field on turn 2.
    const state = h.state();
    expect(state.players[state.currentPlayerIdx].id).toBe('p1');
    const seal = findIn(desktop(), 'dom_el_seal');
    expect(stateName(state, seal, 'p1')).toBe('My turn');
    expect(stateName(state, seal, 'p0')).toBeNull();
    const foe = findIn(desktop(), 'dom_el_foe');
    expect(stateName(state, foe, 'p0')).toBe('Their turn');
    expect(stateName(state, foe, 'p1')).toBeNull();

    // The dynamic top-strip ticker reads through the display evaluator.
    const turn = findIn(desktop(), 'dom_el_turn');
    if (turn.kind !== 'text') throw new Error('turn counter is not a text');
    expect(turn.onChangeAnim).toBe('flash');
    expect(renderTextParts(dominionGame, state, turn.parts!, 'p0')).toBe('TURN 2');
    // ...and the foe name resolves to the seat after the viewer.
    const foeName = findIn(desktop(), 'dom_el_foe_name');
    if (foeName.kind !== 'text') throw new Error('foe name is not a text');
    expect(renderTextParts(dominionGame, state, foeName.parts!, 'p0')).toBe('Brook');
    expect(renderTextParts(dominionGame, state, foeName.parts!, 'p1')).toBe('Ada');
    expect(h.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Mobile variant: a tall scrolling column with 44px+ targets
// ---------------------------------------------------------------------------

describe('war table mobile variant', () => {
  const layout = dominionGame.screenLayout!;

  it('ships scroll + aspect and is picked below the breakpoint', () => {
    expect(layout.mobile).toBeTruthy();
    expect(layout.mobile!.scroll).toBe(true);
    expect(layout.mobile!.aspect).toBe(0.42);
    expect(layout.mobile!.elements.length).toBeGreaterThan(0);

    const narrow = activeScreenVariant(layout, true);
    expect(narrow.variant).toBe('mobile');
    expect(narrow.scroll).toBe(true);
    const wide = activeScreenVariant(layout, false);
    expect(wide.variant).toBe('desktop');
    expect(wide.scroll).toBe(false);

    // A 390px phone gets a page taller than its viewport (it scrolls).
    const stage = computeStage(390, 700, narrow.aspect, narrow.scroll);
    expect(stage.scrollable).toBe(true);
    expect(stage.h).toBeGreaterThan(700);
  });

  it('keeps the phase buttons at 44px+ on a 390px phone', () => {
    const pageH = computeStage(390, 700, 0.42, true).h;
    for (const id of ['dom_el_m_btn_done', 'dom_el_m_btn_end']) {
      const btn = findIn(mobile(), id);
      expect(btn.kind).toBe('button');
      expect((pageH * btn.rect.h) / 100).toBeGreaterThanOrEqual(44);
    }
  });

  it('stacks the Crownfall column: big hand fan, burn trash, chronicle', () => {
    const hand = zoneEl(mobile(), 'dom_el_m_hand');
    expect(hand.cardScale).toBe(16);
    expect(hand.fanAngle).toBe(3);
    expect(hand.collapseDuplicates).toBe(true);
    const trash = zoneEl(mobile(), 'dom_el_m_trash');
    expect(trash.arriveEffect).toBe('burn');
    expect(trash.style?.borderStyle).toBe('dashed');
    expect(findIn(mobile(), 'dom_el_m_log').kind).toBe('log');
    // The desktop harbor mirrors the same reference details.
    const dHand = zoneEl(desktop(), 'dom_el_my_hand');
    expect(dHand.collapseDuplicates).toBe(true);
    expect(dHand.fanAngle).toBe(2);
    expect(zoneEl(desktop(), 'dom_el_trash').arriveEffect).toBe('burn');
  });
});

// ---------------------------------------------------------------------------
// Motion spec: the reference flight primitive
// ---------------------------------------------------------------------------

describe('war table motion spec', () => {
  it('authors the reference values (430ms / 46px arc / 4° spin / 55ms stagger)', () => {
    expect(dominionGame.screenLayout!.motion).toEqual({
      flightMs: 430, arc: 46, spin: 4, staggerMs: 55,
    });
    expect(resolveMotion(dominionGame.screenLayout!.motion)).toEqual({
      flightMs: 430, arc: 46, spin: 4, staggerMs: 55,
    });
  });
});
