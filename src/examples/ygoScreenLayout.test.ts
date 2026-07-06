/**
 * Yu-Gi-Oh duel mat — display-expression gating AND element states against
 * REAL engine states. The layout is render-only (the engine never reads it),
 * so these tests start the actual engine and evaluate the shipped `visible`
 * expressions through isDisplayVisible and the shipped `states` through
 * resolveElementAppearance, exactly like the runner's ScreenRenderer does:
 *   - 'To battle' / 'End turn' show only for the turn player's viewer,
 *   - 'Pass' hides while the stack is empty, shows (accent-hot via its
 *     'Priority' state) once a window opens,
 *   - the generated phase track marks dots Done/Current as phases pass and
 *     resets when the turn ends (phaseIndex resets by construction),
 *   - the viewer's field rows glow 'My turn' only through the turn player's
 *     eyes while the opponent band brightens through the other seat's,
 *   - every zone element resolves to a live zone instance for a 2p duel.
 */
import { describe, expect, it } from 'vitest';
import type { GameDef, GameState, ScreenElement } from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import { createEngine, isDisplayVisible } from '../engine';
import { resolveElementAppearance } from '../runner/layoutGeometry';
import { ygoGame } from './ygo';

// ---------------------------------------------------------------------------
// Harness (same shape as interrupts.test.ts: real engine, scripted seats)
// ---------------------------------------------------------------------------

function started(def: GameDef) {
  const errors: string[] = [];
  const engine = createEngine(def, {
    playerNames: ['Ada', 'Brook'],
    aiSeats: [false, false],
    seed: 11,
    choiceProvider: {
      // These scripts never reach a choice; anything else is a test failure.
      resolve(req) { throw new Error(`unexpected choice: ${req.prompt}`); },
    },
    onUpdate: () => {},
    onScriptError: (m) => errors.push(m),
  });
  return { engine, errors, state: () => engine.getState() };
}

/** Find an element anywhere in the mat's tree (groups included). */
function findEl(def: GameDef, id: string): ScreenElement {
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
  const el = walk(def.screenLayout?.elements ?? []);
  if (!el) throw new Error(`no screen element "${id}"`);
  return el;
}

/**
 * Name of the state an element currently shows (first `when` match, viewer
 * bound — the runner's exact mechanism), or null for the base appearance.
 * Matched by NAME because the generated phase-track children carry uid() ids.
 */
function stateName(
  def: GameDef, state: GameState, el: ScreenElement, viewerId: string,
): string | null {
  const app = resolveElementAppearance(def, state, el, viewerId);
  if (app.stateId === null) return null;
  const hit = (el.states ?? []).find((s) => s.id === app.stateId);
  if (!hit) throw new Error(`element "${el.name}" matched unknown state ${app.stateId}`);
  return hit.name;
}

/** A child of the generated phase track, addressed by deterministic name. */
function trackChild(def: GameDef, name: string): ScreenElement {
  const track = findEl(def, 'ygo_el_phase_track');
  if (track.kind !== 'group') throw new Error('phase track is not a group');
  const el = track.children.find((c) => c.name === name);
  if (!el) throw new Error(`no phase-track child "${name}"`);
  return el;
}

/** De-randomized deck: the opening hand is all La Jinns (level 4, 1800 ATK). */
function fixedYgo(): GameDef {
  const def = structuredClone(ygoGame);
  const deck = def.decks[0];
  deck.shuffle = false;
  // Cards spawn in entry order (last = top of the deck = the opening hand):
  // p0 opens with 4 La Jinn + Trap Hole, so a set trap can hold the window
  // open on their own summon (moveless holders are auto-passed).
  deck.source = {
    kind: 'custom',
    entries: [
      { cardId: 'ygo_card_mystical_elf', count: 20 },
      { cardId: 'ygo_card_la_jinn', count: 4 },
      { cardId: 'ygo_card_trap_hole', count: 1 },
    ],
  };
  return def;
}

// ---------------------------------------------------------------------------
// Turn gating: currentPlayer == $viewer
// ---------------------------------------------------------------------------

describe('duel mat turn-button gating', () => {
  it('To battle / End turn are visible only through the turn player\'s eyes', async () => {
    const h = started(ygoGame);
    await h.engine.start();
    const state = h.state();
    expect(state.players[state.currentPlayerIdx].id).toBe('p0');

    for (const id of ['ygo_el_btn_battle', 'ygo_el_btn_end_turn']) {
      const btn = findEl(ygoGame, id);
      expect(btn.visible, `${id} must be turn-gated`).toBeTruthy();
      expect(isDisplayVisible(ygoGame, state, btn.visible!, 'p0')).toBe(true);
      expect(isDisplayVisible(ygoGame, state, btn.visible!, 'p1')).toBe(false);
    }
    // The mat chrome itself is ungated: zones, phase track and the controls
    // group render for every seat (only the buttons inside it gate).
    for (const id of ['ygo_el_my_monsters', 'ygo_el_opp_hand', 'ygo_el_phase_track', 'ygo_el_controls']) {
      const el = findEl(ygoGame, id);
      expect(isDisplayVisible(ygoGame, state, el.visible ?? null, 'p1')).toBe(true);
    }
    expect(h.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Window gating: stackSize > 0
// ---------------------------------------------------------------------------

describe('duel mat Pass-button gating', () => {
  it('Pass hides on an empty stack and shows for BOTH seats once a window opens', async () => {
    const def = fixedYgo();
    const h = started(def);
    await h.engine.start();
    const pass = findEl(def, 'ygo_el_btn_pass');
    expect(pass.kind).toBe('button');
    if (pass.kind === 'button') expect(pass.actionId).toBe(PASS_ACTION_ID);

    // Normal play: nothing pending, the Pass button stays off the mat (and
    // its 'Priority' state — same stackSize gate — is dormant too).
    let state = h.state();
    expect(state.stack).toHaveLength(0);
    expect(isDisplayVisible(def, state, pass.visible!, 'p0')).toBe(false);
    expect(isDisplayVisible(def, state, pass.visible!, 'p1')).toBe(false);
    expect(stateName(def, state, pass, 'p0')).toBeNull();

    // p0 sets Trap Hole first: their own live response keeps the window
    // open on the summon (holders with no response moves are auto-passed).
    const set = h.engine.getLegalMoves('p0').find((m) => m.actionId === 'ygo_action_set');
    expect(set).toBeDefined();
    await h.engine.performAction('p0', set!);

    // p0 normal-summons La Jinn — a stacked action: announce runs, the
    // summon goes on the stack and a response window opens.
    const summon = h.engine.getLegalMoves('p0').find((m) => m.actionId === 'ygo_action_summon');
    expect(summon).toBeDefined();
    await h.engine.performAction('p0', summon!);

    state = h.state();
    expect(state.stack).toHaveLength(1);
    expect(state.window?.holderId).toBe('p0');
    // The Pass button surfaces for every seat; WHO may press it is the
    // runner's legality gate (buttons auto-disable without the move).
    expect(isDisplayVisible(def, state, pass.visible!, 'p0')).toBe(true);
    expect(isDisplayVisible(def, state, pass.visible!, 'p1')).toBe(true);
    // ...and it arrives HOT: the 'Priority' state paints it accent for both.
    for (const viewer of ['p0', 'p1']) {
      expect(stateName(def, state, pass, viewer)).toBe('Priority');
      expect(resolveElementAppearance(def, state, pass, viewer).style?.background).toBe('#b15cff');
    }
    // ...and the priority holder really has the built-in pass move to bind.
    expect(h.engine.getLegalMoves('p0')).toContainEqual({ actionId: PASS_ACTION_ID });
    expect(h.engine.getLegalMoves('p1')).toEqual([]);

    // Turn gating is unaffected mid-window: it is still p0's turn.
    const battle = findEl(def, 'ygo_el_btn_battle');
    expect(isDisplayVisible(def, state, battle.visible!, 'p0')).toBe(true);
    expect(isDisplayVisible(def, state, battle.visible!, 'p1')).toBe(false);
    expect(h.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Phase track states: Done / Current / not-yet, resetting on end turn
// ---------------------------------------------------------------------------

describe('duel mat phase track', () => {
  it('marks dots Done/Current mid-turn and resets when the turn passes', async () => {
    const h = started(ygoGame);
    await h.engine.start();
    let state = h.state();
    // The auto Draw phase has already run and advanced: Main is current.
    expect(state.phaseIdx).toBe(1);
    expect(stateName(ygoGame, state, trackChild(ygoGame, 'Draw dot'), 'p0')).toBe('Done');
    expect(stateName(ygoGame, state, trackChild(ygoGame, 'Main dot'), 'p0')).toBe('Current');
    // Battle is not-yet: no state matches, the dot keeps its base outline.
    expect(stateName(ygoGame, state, trackChild(ygoGame, 'Battle dot'), 'p0')).toBeNull();
    // Connector lines: lit INTO Main (Draw passed), dark INTO Battle.
    expect(stateName(ygoGame, state, trackChild(ygoGame, 'Main link'), 'p0')).toBe('Reached');
    expect(stateName(ygoGame, state, trackChild(ygoGame, 'Battle link'), 'p0')).toBeNull();
    // The track reads the same for both seats — phase logic is viewer-free.
    expect(stateName(ygoGame, state, trackChild(ygoGame, 'Main dot'), 'p1')).toBe('Current');

    // Enter the Battle phase: the marker moves one dot to the right.
    const battle = h.engine.getLegalMoves('p0').find((m) => m.actionId === 'ygo_action_battle');
    expect(battle).toBeDefined();
    await h.engine.performAction('p0', battle!);
    state = h.state();
    expect(state.phaseIdx).toBe(2);
    expect(stateName(ygoGame, state, trackChild(ygoGame, 'Main dot'), 'p0')).toBe('Done');
    expect(stateName(ygoGame, state, trackChild(ygoGame, 'Battle dot'), 'p0')).toBe('Current');
    expect(stateName(ygoGame, state, trackChild(ygoGame, 'Battle link'), 'p0')).toBe('Reached');

    // End the turn: phaseIndex resets by construction, so the track snaps
    // back (p1's auto Draw has already advanced it to Main again).
    const end = h.engine.getLegalMoves('p0').find((m) => m.actionId === 'ygo_action_end_turn');
    expect(end).toBeDefined();
    await h.engine.performAction('p0', end!);
    state = h.state();
    expect(state.players[state.currentPlayerIdx].id).toBe('p1');
    expect(state.phaseIdx).toBe(1);
    expect(stateName(ygoGame, state, trackChild(ygoGame, 'Battle dot'), 'p0')).toBeNull();
    expect(stateName(ygoGame, state, trackChild(ygoGame, 'Main dot'), 'p0')).toBe('Current');
    expect(h.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Turn-reactive states: 'My turn' field glow / 'Their turn' opponent band
// ---------------------------------------------------------------------------

describe('duel mat turn-reactive states', () => {
  it("glows the viewer's field on their turn and the opponent band on the other seat's", async () => {
    const h = started(ygoGame);
    await h.engine.start();
    const state = h.state();
    expect(state.players[state.currentPlayerIdx].id).toBe('p0');

    // The viewer's own rows light up ONLY through the turn player's eyes.
    for (const id of ['ygo_el_my_monsters', 'ygo_el_my_spelltrap']) {
      const el = findEl(ygoGame, id);
      expect(stateName(ygoGame, state, el, 'p0'), `${id} for the turn player`).toBe('My turn');
      expect(stateName(ygoGame, state, el, 'p1'), `${id} off-turn`).toBeNull();
    }
    // Merge semantics: the state's accent borderColor lands OVER the base
    // chrome (borderStyle survives), and states restyle without moving rects.
    const monsters = findEl(ygoGame, 'ygo_el_my_monsters');
    const app = resolveElementAppearance(ygoGame, state, monsters, 'p0');
    expect(app.style?.borderColor).toBe('#b15cff');
    expect(app.style?.borderStyle).toBe('solid');
    expect(app.rect).toEqual(monsters.rect);

    // The opponent band brightens for p1 (the seat WATCHING p0 act) and
    // stays calm for the turn player's own viewer.
    const band = findEl(ygoGame, 'ygo_el_opp_band');
    expect(band.kind).toBe('group');
    expect(stateName(ygoGame, state, band, 'p1')).toBe('Their turn');
    expect(stateName(ygoGame, state, band, 'p0')).toBeNull();
    expect(h.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Seat refs against the real 2-player table
// ---------------------------------------------------------------------------

describe('duel mat zone elements', () => {
  it('every zone element maps onto a live engine zone instance', async () => {
    const h = started(ygoGame);
    await h.engine.start();
    const state = h.state();

    // Viewer-relative seats for p0's perspective in seating order.
    const seatPlayer: Partial<Record<string, string>> = { viewer: 'p0', opp1: 'p1' };
    const walk = (els: ScreenElement[]): void => {
      for (const el of els) {
        if (el.kind === 'group') { walk(el.children); continue; }
        if (el.kind !== 'zone') continue;
        const owner = seatPlayer[el.seat];
        expect(owner, `element "${el.name}" uses seat ${el.seat} in a 2p duel`).toBeDefined();
        expect(state.zones[`${el.zoneId}:${owner}`], `instance for "${el.name}"`).toBeDefined();
      }
    };
    walk(ygoGame.screenLayout!.elements);

    // The field rows are real 5-slot grids matching the zones' capacity.
    for (const id of [
      'ygo_el_opp_monsters', 'ygo_el_my_monsters',
      'ygo_el_opp_spelltrap', 'ygo_el_my_spelltrap',
    ]) {
      const el = findEl(ygoGame, id);
      expect(el.kind).toBe('zone');
      if (el.kind === 'zone') {
        expect(el.rows).toBe(1);
        expect(el.columns).toBe(5);
        expect(ygoGame.zones.find((z) => z.id === el.zoneId)?.capacity).toBe(5);
      }
    }
    expect(h.errors).toEqual([]);
  });
});
