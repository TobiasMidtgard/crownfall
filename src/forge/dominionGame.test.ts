/**
 * The hall's Dominion def: validates clean (zero errors AND zero warnings),
 * hosts all three lobby kingdom sets, is expressed on the schema-v2
 * vocabulary (choosePile / draw / move tags / triggerAbilities / sumCards)
 * plus the type/tag/filter vocabulary (cardTypeIs / cardHasTag / filterRef —
 * spec A §Dominion migration), and each set plays to completion through the
 * REAL engine under the example playthrough harness.
 *
 * SEEDED PARITY — approach: invariants, not exact-fixture equality.
 * Pre-refactor baseline (captured on the PICKROW-era def, same harness,
 * same seeds):
 *   first-game/41:     winners [p0], VP  4/0, turn 109, steps 522
 *   sharp-coins/42:    winners [p0], VP  6/1, turn 105, steps 487
 *   witching-hour/43:  winners [p1], VP -1/5, turn 104, steps 511
 * Post-refactor the same seeds produce different lines for two of the sets
 * (sharp-coins/42 now ends winners [p1], VP 1/2): the supply-gain choice
 * moved from a staged PICKROW 'card' request (candidates in build-time
 * ALL_PILES order) to the choosePile 'pile' request (candidates in
 * live-supply first-appearance order), so the random harness maps the same
 * rand() draw onto a different pile; the Black Market also dropped its
 * 3-random-card staging (a game-RNG consumer) for an optional choosePile
 * over its whole stock. Identical outcomes are impossible by construction,
 * so the playthrough suite asserts invariants — completion, conservation,
 * end reason, winners == the recomputed-VP argmax — and the per-card
 * semantics probes below hand-verify each refactored card.
 */
import { describe, expect, it } from 'vitest';
import type {
  ChoiceRequest, EngineHandle, Expr, GameDef, GameState, ScreenElement,
} from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import { validateGameDef } from '../shared/validate';
import { KINGDOM_SETS } from '../shared/kingdoms';
import { createEngine, isDisplayVisible } from '../engine';
import { playThrough, totalCards } from '../examples/testHarness';
import { renderTextParts } from '../runner/layout';
import { filterDisplayCards } from '../runner/layoutGeometry';
import {
  activeKingdomCards, buildDominionDef, kingdomCardNames, kingdomCatalog, pickKingdom, potionEnabled,
  prosperityEnabled, supportsKingdomPicking, supportsProsperityBasics, withProsperityBasics,
} from './dominionGame';

const BASIC_NAMES = ['Copper', 'Silver', 'Gold', 'Estate', 'Duchy', 'Province', 'Curse'];
/** Basics 46+40+30+8+8+8+10, kingdom stock 205 piles of 10 (18 core + 10 Base
 *  2E + 26 Intrigue 2E + 26 Seaside 2E + 25 Prosperity 2E + 13 Cornucopia +
 *  13 Guilds + 26 Hinterlands 2E + 7 Promos + 11 Alchemy + 30 Menagerie),
 *  Prosperity basics 12+8, starters 2 × 10, 5 Prizes + 30 Horses, 16 Potions,
 *  51 landscape singles (21 Landmarks + 13 Events + 17 Projects). Kingdom
 *  stock includes Renaissance's 25 piles (230 piles total). */
const TOTAL_CARDS = 150 + 2300 + 20 + 20 + 35 + 16 + 51;

const errorsOf = (def: GameDef) =>
  validateGameDef(def).filter((i) => i.severity === 'error');

/** Start a real engine (no choices expected) and return the initial supply. */
async function startedSupply(def: GameDef): Promise<{ names: Set<string>; errors: string[] }> {
  const errors: string[] = [];
  const engine = createEngine(def, {
    playerNames: ['Ada', 'Brook'],
    aiSeats: [false, false],
    seed: 7,
    choiceProvider: {
      resolve(req) { throw new Error(`unexpected choice at setup: ${req.prompt}`); },
    },
    onUpdate: () => {},
    onScriptError: (m) => errors.push(m),
  });
  await engine.start();
  const state = engine.getState();
  const names = new Set(state.zones['dom_zone_supply'].cardIds.map((id) => state.cards[id].name));
  return { names, errors };
}

/** The element with this id anywhere in a screen-element tree. */
function findEl(els: ScreenElement[], id: string): ScreenElement | null {
  for (const el of els) {
    if (el.id === id) return el;
    const kids = el.kind === 'group' ? el.children : el.children ?? [];
    const found = kids.length > 0 ? findEl(kids, id) : null;
    if (found !== null) return found;
  }
  return null;
}

describe('buildDominionDef', () => {
  const def = buildDominionDef();

  it('validates with zero errors AND zero warnings', () => {
    expect(validateGameDef(def)).toEqual([]);
  });

  it('is the seeded, keeper-editable flagship (not a built-in example)', () => {
    expect(def.meta.id).toBe('dominion-crownfall');
    expect(def.meta.name).toBe('Dominion');
    expect(def.meta.builtIn).toBe(false);
    expect(def.meta.minPlayers).toBe(2);
  });

  it('knows every card of every lobby kingdom set (plus the Woodcutter spare)', () => {
    const known = new Set(kingdomCardNames(def));
    for (const set of KINGDOM_SETS) {
      for (const name of set.cards) {
        expect(known, `${set.name} needs ${name}`).toContain(name);
      }
    }
    expect(known).toContain('Woodcutter'); // spare supply option, in no set
  });

  it('spawns kingdom piles via one tagged setup block per card', () => {
    const pileBlocks = def.setup.filter(
      (b) => b.kind === 'moveCards'
        && b.from.zoneId === 'dom_zone_reserve'
        && b.to.zoneId === 'dom_zone_supply',
    );
    expect(pileBlocks).toHaveLength(10);
  });
});

describe('the schema-v2 vocabulary (no staging machinery left)', () => {
  const def = buildDominionDef();
  const json = (v: unknown) => JSON.stringify(v);
  const cardByName = (name: string) => def.cards.find((c) => c.name === name)!;

  it('the PICKROW staging zone is gone; the reserve (market stock) remains', () => {
    expect(def.zones.some((z) => z.id === 'dom_zone_pickrow')).toBe(false);
    expect(def.zones.some((z) => z.id === 'dom_zone_reserve')).toBe(true);
    // No script anywhere still references the deleted zone.
    expect(json(def)).not.toContain('dom_zone_pickrow');
  });

  it('moves carry their cause tags (play / buy / cleanup / draw)', () => {
    const play = def.actions.find((a) => a.id === 'dom_action_play')!;
    expect(json(play.script)).toContain('"tag":"play"');
    const buy = def.actions.find((a) => a.id === 'dom_action_buy')!;
    expect(json(buy.script)).toContain('"tag":"buy"');
    // Cleanup is a manual phase now (Action → Buy → Cleanup): its sweep +
    // redraw live in the dom_action_cleanup script, not the phase onEnter.
    const cleanupAction = def.actions.find((a) => a.id === 'dom_action_cleanup')!;
    expect(json(cleanupAction.script)).toContain('"tag":"cleanup"');
    // Every reshuffling draw is the draw block now — no inline macro left.
    expect(json(cleanupAction.script)).toContain('"kind":"draw"');
    expect(json(def)).not.toContain('"kind":"repeat"');
  });

  it('cleanup is a third manual phase with its own always-legal action', () => {
    const cleanup = def.phases.find((p) => p.id === 'dom_phase_cleanup')!;
    expect(cleanup.mode).toBe('manual');
    expect(cleanup.actionIds).toEqual(['dom_action_cleanup']);
    expect(cleanup.onEnter).toEqual([]);
    const action = def.actions.find((a) => a.id === 'dom_action_cleanup')!;
    expect(action.target).toEqual({ kind: 'none' });
    expect(action.legality).toBeNull(); // always available, so the AI can't hang
    expect(json(action.script)).toContain('"kind":"endPhase"');
  });

  it('supply gains are choosePile; Throne Room is triggerAbilities (no reserve bounce)', () => {
    expect(json(cardByName('Workshop').abilities)).toContain('"kind":"choosePile"');
    expect(json(cardByName('Remodel').abilities)).toContain('"kind":"choosePile"');
    expect(json(cardByName('Mine').abilities)).toContain('"kind":"choosePile"');
    expect(json(cardByName('Black Market').abilities)).toContain('"kind":"choosePile"');
    const throne = json(cardByName('Throne Room').abilities);
    expect(throne).toContain('"kind":"triggerAbilities"');
    expect(throne).not.toContain('dom_zone_reserve');
  });

  it('the VP recount is sumCards, run at turn end + on one tagged gain trigger', () => {
    const turnEnd = def.triggers.find((t) => t.id === 'dom_trigger_vp')!;
    expect(turnEnd.event).toEqual({ kind: 'turnEnd' });
    expect(json(turnEnd.script)).toContain('"kind":"sumCards"');
    // (Cornucopia's Fairgrounds vpTerm legitimately sweeps per-card for its
    // exact distinct-name count — the old per-site staging stays banned via
    // the buy-action check below, not a blanket forEachCard ban.)
    const onGain = def.triggers.find((t) => t.id === 'dom_trigger_vp_gain')!;
    expect(onGain.event).toEqual({ kind: 'cardEnterZone', zoneId: null, tag: 'gain' });
    // The old per-site recount splices are gone from the buy action.
    const buy = def.actions.find((a) => a.id === 'dom_action_buy')!;
    expect(json(buy.script)).not.toContain('dom_var_vp');
  });

  it('IMMUNE resets once, on effectResolved — not per attack script', () => {
    const reset = def.triggers.find((t) => t.id === 'dom_trigger_immune_reset')!;
    expect(reset.event).toEqual({ kind: 'effectResolved' });
    expect(json(reset.script)).toContain('dom_var_immune');
    for (const name of ['Militia', 'Witch']) {
      const attack = cardByName(name).abilities.find((a) => a.stacked === true)!;
      expect(json(attack.script), `${name} attack must not reset IMMUNE itself`)
        .not.toContain('"kind":"setVar","varId":"dom_var_immune"');
    }
  });

  it('defines the type/tag vocabulary + the one named filter (spec A)', () => {
    // Event/Landmark joined with the Empires landscapes (declared only
    // while a registered module ships that kind).
    expect(def.cardTypes?.map((t) => t.name)).toEqual(['Treasure', 'Victory', 'Curse', 'Action', 'Event', 'Landmark', 'Project']);
    // Every type wears its skin-palette accent color.
    for (const t of def.cardTypes!) expect(t.color).toMatch(/^#[0-9a-f]{6}$/);
    // MOAT DECISION (see dominionGame.ts): a card has ONE primary type, so
    // "Action – Reaction" is Action-TYPED with a Reaction TAG and the spec's
    // Reaction TYPE is dropped. Duration stays undeclared until slice D
    // ships a Duration card — an unused tag would be a validation warning.
    expect(def.cardTags?.map((t) => t.name)).toEqual(['Attack', 'Reaction', 'Kingdom', 'Basic']);
    expect(def.filters?.map((f) => f.name)).toEqual(['The basic cards']);
    expect(json(def.filters![0].condition)).toContain('"kind":"cardHasTag"');
  });

  it('every card carries a primary type + tags (basics Basic, kingdom Kingdom)', () => {
    // Non-supply stock (the Prizes) is deliberately untagged — neither a
    // Kingdom pile nor a Basic; Attack still rides when printed (Followers).
    const pickable = new Set([...kingdomCardNames(def), ...BASIC_NAMES, 'Platinum', 'Colony']);
    for (const c of def.cards) {
      expect(c.typeId, `${c.name} is typed`).toBeTruthy();
      if (pickable.has(c.name)) {
        expect(c.tags !== undefined && c.tags.length > 0, `${c.name} is tagged`).toBe(true);
      }
    }
    const typeOf = (n: string) => cardByName(n).typeId;
    for (const n of ['Copper', 'Silver', 'Gold']) expect(typeOf(n)).toBe('dom_type_treasure');
    for (const n of ['Estate', 'Duchy', 'Province']) expect(typeOf(n)).toBe('dom_type_victory');
    expect(typeOf('Curse')).toBe('dom_type_curse');
    for (const n of ['Copper', 'Province', 'Curse']) {
      expect(cardByName(n).tags).toEqual(['dom_tag_basic']);
    }
    // Gardens is victory-TYPED but stays a kingdom card, like the original.
    expect(typeOf('Gardens')).toBe('dom_type_victory');
    expect(cardByName('Gardens').tags).toEqual(['dom_tag_kingdom']);
    for (const n of ['Village', 'Smithy', 'Militia', 'Witch', 'Moat', 'Throne Room']) {
      expect(typeOf(n), `${n} is an action`).toBe('dom_type_action');
    }
    expect(cardByName('Militia').tags).toEqual(['dom_tag_kingdom', 'dom_tag_attack']);
    expect(cardByName('Witch').tags).toEqual(['dom_tag_kingdom', 'dom_tag_attack']);
    expect(cardByName('Moat').tags).toEqual(['dom_tag_kingdom', 'dom_tag_reaction']);
  });

  it('conditions read the vocabulary; the ctype field is scrubbed wholesale', () => {
    // Play/treasure legality = primary-type checks; Moat reveal = has-tag
    // Reaction (any future reaction joins the window by wearing the tag).
    const play = def.actions.find((a) => a.id === 'dom_action_play')!;
    expect(json(play.legality)).toContain('"kind":"cardTypeIs"');
    expect(json(play.legality)).toContain('dom_type_action');
    const treasure = def.actions.find((a) => a.id === 'dom_action_treasure')!;
    expect(json(treasure.legality)).toContain('dom_type_treasure');
    const reveal = def.actions.find((a) => a.id === 'dom_action_reveal_moat')!;
    expect(json(reveal.legality)).toContain('"kind":"cardHasTag"');
    expect(json(reveal.legality)).toContain('dom_tag_reaction');
    // Throne Room filters is-a Action; Mine filters is-a Treasure.
    expect(json(cardByName('Throne Room').abilities)).toContain('"kind":"cardTypeIs"');
    expect(json(cardByName('Mine').abilities)).toContain('dom_type_treasure');
    // The retired machine field is GONE — definition, face binding, values,
    // and every condition that once read it.
    expect(json(def)).not.toContain('dom_field_ctype');
    expect(json(def)).not.toContain('"op":"contains"');
    // The display line stays pretty (the KIND field carries the em-dash text).
    expect(cardByName('Moat').fields['dom_field_kind']).toBe('Action – Reaction');
    expect(cardByName('Militia').fields['dom_field_kind']).toBe('Action – Attack');
    expect(cardByName('Copper').fields['dom_field_kind']).toBe('Treasure');
    expect(cardByName('Gardens').fields['dom_field_kind']).toBe('Victory');
  });
});

describe('pickKingdom', () => {
  const base = buildDominionDef();

  it('is pure and rejects unknown cards', () => {
    const before = JSON.stringify(base);
    const swapped = pickKingdom(base, KINGDOM_SETS[1].cards);
    expect(swapped).not.toBe(base);
    expect(JSON.stringify(base)).toBe(before);
    expect(swapped.meta.id).toBe(base.meta.id);
    expect(() => pickKingdom(base, ['Village', 'Platinum Hoard'])).toThrow(/Platinum Hoard/);
  });

  it.each(KINGDOM_SETS.map((s) => ({ set: s.name, cards: s.cards })))(
    '$set: the supply is exactly the basics + those ten piles',
    async ({ cards }) => {
      const def = pickKingdom(base, cards);
      expect(errorsOf(def)).toEqual([]);
      const { names, errors } = await startedSupply(def);
      expect(errors).toEqual([]);
      // Alchemy sets bring the Potion pile along automatically.
      const expected = potionEnabled(def)
        ? [...BASIC_NAMES, ...cards, 'Potion']
        : [...BASIC_NAMES, ...cards];
      expect([...names].sort()).toEqual(expected.sort());
    },
  );
});

/** Setup block moving ONE named card from the supply to `toZone`. */
function dealNamed(
  name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null,
): GameDef['setup'][number] {
  const nameIs: Expr = {
    kind: 'compare', op: '==',
    left: { kind: 'cardField', card: { kind: 'binding', name: '$card' }, fieldId: 'name' },
    right: { kind: 'str', value: name },
  };
  return {
    kind: 'moveCards',
    from: { zoneId: 'dom_zone_supply', owner: null },
    // owner null = contextual (p0 during setup); a player id targets a seat.
    to: { zoneId: toZone, owner: toPlayer !== null ? { kind: 'str', value: toPlayer } : null },
    cards: {
      kind: 'specific',
      card: {
        kind: 'bestCard', zone: { zoneId: 'dom_zone_supply', owner: null },
        by: 'highest', fieldId: 'dom_field_cost', filter: nameIs,
      },
    },
    toPosition: 'top',
    faceUp: true,
  };
}

function probeEngine(def: GameDef, answer: (req: ChoiceRequest, state: GameState) => string) {
  const errors: string[] = [];
  const engine = createEngine(def, {
    playerNames: ['Ada', 'Brook'],
    aiSeats: [false, false],
    seed: 11,
    choiceProvider: { resolve: (req, state) => Promise.resolve(answer(req, state)) },
    onUpdate: () => {},
    onScriptError: (m) => errors.push(m),
  });
  return { engine, errors };
}

/**
 * Drive open response windows to resolution: every holder passes, except
 * that `revealFor` reveals its Moat ONCE when legal. Handles chained
 * windows (double attacks) up to a guard cap.
 */
async function playOutWindows(engine: EngineHandle, revealFor: string | null = null): Promise<void> {
  let revealed = false;
  for (let guard = 0; guard < 60; guard += 1) {
    const state = engine.getState();
    if (state.window === null) return;
    const holder = state.window.holderId;
    const moves = engine.getLegalMoves(holder);
    const reveal = moves.find((m) => m.actionId === 'dom_action_reveal_moat');
    if (!revealed && revealFor === holder && reveal !== undefined) {
      await engine.performAction(holder, reveal);
      revealed = true;
    } else {
      const pass = moves.find((m) => m.actionId === PASS_ACTION_ID);
      if (pass === undefined) throw new Error('no pass move while a window is open');
      await engine.performAction(holder, pass);
    }
  }
  throw new Error('response window never closed');
}

describe('rebuilt card semantics (deterministic probes)', () => {
  it('Workshop gains from a choosePile off the live supply (tagged gain recounts VP)', async () => {
    const def = buildDominionDef(); // First Game holds Workshop
    def.setup.push(dealNamed('Workshop'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate');
      if (estate === undefined) throw new Error('no Estate pile offered');
      return estate;
    });
    await engine.start();
    let state = engine.getState();
    const workshop = state.zones['dom_zone_hand:p0'].cardIds
      .find((id) => state.cards[id].name === 'Workshop')!;
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: workshop });
    state = engine.getState();
    expect(errors).toEqual([]);
    // One mandatory pile request, one entry per distinct affordable pile.
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'pile' }>;
    expect(req.optional).toBe(false);
    expect(req.counts).toHaveLength(req.cardIds.length);
    const offered = req.cardIds.map((id) => state.cards[id].name);
    expect(offered).toContain('Silver');   // cost 3 — within the cap
    expect(offered).not.toContain('Gold'); // cost 6 — beyond it
    // The Estate landed in the discard, and the tagged-gain trigger already
    // recounted: 3 starter Estates + the gained one, mid-turn.
    const discard = state.zones['dom_zone_discard:p0'].cardIds
      .map((id) => state.cards[id].name);
    expect(discard).toEqual(['Estate']);
    expect(state.players[0].vars['dom_var_vp']).toBe(4);
    expect(state.players[1].vars['dom_var_vp']).toBe(3);
  });

  it('Throne Room plays the chosen action twice via triggerAbilities (Smithy draws 6)', async () => {
    // Sharp Coins carries Throne Room + Smithy. Deal one of each into p0's
    // opening hand; every later draw comes from p0's own 10-card starter
    // deck, so counts are seed-independent.
    const def = pickKingdom(buildDominionDef(), KINGDOM_SETS[1].cards);
    def.setup.push(dealNamed('Throne Room'), dealNamed('Smithy'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      // The only choice is Throne Room's pick: take the Smithy.
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      const smithy = req.cardIds.find((id) => state.cards[id].name === 'Smithy');
      if (!smithy) throw new Error('no Smithy offered');
      return smithy;
    });
    await engine.start();
    let state = engine.getState();
    const hand = state.zones['dom_zone_hand:p0'];
    expect(hand.cardIds).toHaveLength(7); // 5 drawn + the 2 dealt
    const throne = hand.cardIds.find((id) => state.cards[id].name === 'Throne Room')!;
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: throne });
    state = engine.getState();
    expect(errors).toEqual([]);
    // 7 - Throne - Smithy + all 5 remaining deck cards (draw 6 exhausts it).
    expect(state.zones['dom_zone_hand:p0'].cardIds).toHaveLength(10);
    expect(state.zones['dom_zone_deck:p0'].cardIds).toHaveLength(0);
    // The Smithy entered play ONCE — triggerAbilities re-fires without moving.
    const inPlay = state.zones['dom_zone_inplay:p0'].cardIds.map((id) => state.cards[id].name);
    expect(inPlay.sort()).toEqual(['Smithy', 'Throne Room']);
  });

  it('Throne Room + Militia double-fires with a response window per attack', async () => {
    // No lobby set holds both, but the def does — a custom ten works.
    const def = pickKingdom(buildDominionDef(), [
      'Throne Room', 'Militia', 'Moat', 'Village', 'Smithy',
      'Market', 'Festival', 'Laboratory', 'Cellar', 'Chapel',
    ]);
    def.setup.push(dealNamed('Throne Room'), dealNamed('Militia'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') {
        const militia = req.cardIds.find((id) => state.cards[id].name === 'Militia');
        if (!militia) throw new Error('no Militia offered');
        return militia;
      }
      if (req.kind === 'cards') return JSON.stringify(req.cardIds.slice(0, req.min));
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    const throne = state.zones['dom_zone_hand:p0'].cardIds
      .find((id) => state.cards[id].name === 'Throne Room')!;
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: throne });
    // Both attack copies stack; drive every window to resolution (no reveals).
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(state.stack).toHaveLength(0);
    // The inline coins half fired twice; the Militia entered play once.
    expect(state.players[0].vars['dom_var_coins']).toBe(4);
    const inPlay = state.zones['dom_zone_inplay:p0'].cardIds.map((id) => state.cards[id].name);
    expect(inPlay.sort()).toEqual(['Militia', 'Throne Room']);
    // p1 discarded to 3 in the first attack; the second found nothing to take.
    expect(state.zones['dom_zone_hand:p1'].cardIds).toHaveLength(3);
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(2);
    expect(requests.filter((r) => r.kind === 'cards')).toHaveLength(1);
  });

  it('Witch curses through the stack; Moat blocks; immunity resets PER ATTACK', async () => {
    const def = pickKingdom(buildDominionDef(), KINGDOM_SETS[2].cards); // Witching Hour
    def.variables.find((v) => v.id === 'dom_var_actions')!.initial = 2;
    def.setup.push(dealNamed('Witch'), dealNamed('Witch'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    let state = engine.getState();
    const witches = state.zones['dom_zone_hand:p0'].cardIds
      .filter((id) => state.cards[id].name === 'Witch');
    expect(witches).toHaveLength(2);

    // Witch #1: p1 reveals Moat in the response window and stays uncursed.
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: witches[0] });
    expect(engine.getState().window).not.toBeNull();
    await playOutWindows(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(0);
    // effectResolved wiped the immunity the moment the attack resolved.
    expect(state.players[1].vars['dom_var_immune']).toBe(0);

    // Witch #2: p1 keeps the Moat sheathed — the old immunity must NOT linger.
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: witches[1] });
    await playOutWindows(engine); // nobody responds
    state = engine.getState();
    expect(errors).toEqual([]);
    const p1Discard = state.zones['dom_zone_discard:p1'].cardIds
      .map((id) => state.cards[id].name);
    expect(p1Discard).toEqual(['Curse']);
    // The tagged-gain recount already priced the Curse in, mid-turn.
    expect(state.players[1].vars['dom_var_vp']).toBe(2); // 3 Estates − 1 Curse
    expect(state.zones['dom_zone_discard:p0'].cardIds).toHaveLength(0);
  });

  it('Black Market sells from its whole stock via an optional choosePile', async () => {
    // DOCUMENTED SEMANTICS CHANGE from the PICKROW build: the market offers
    // its full under-the-counter stock (one pile per card), not 3 randomly
    // staged copies — the choosePile primitive replaces the staging surface.
    const def = pickKingdom(buildDominionDef(), KINGDOM_SETS[2].cards);
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = 3;
    def.setup.push(dealNamed('Black Market'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      const workshop = req.cardIds.find((id) => state.cards[id].name === 'Workshop');
      if (workshop === undefined) throw new Error('no Workshop under the counter');
      return workshop;
    });
    await engine.start();
    let state = engine.getState();
    const reserveBefore = state.zones['dom_zone_reserve'].cardIds.length;
    const market = state.zones['dom_zone_hand:p0'].cardIds
      .find((id) => state.cards[id].name === 'Black Market')!;
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: market });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'pile' }>;
    expect(req.optional).toBe(true);
    // The stock zone is visibility 'none': the request must reveal the
    // representatives' faces or the human buys blind at a hidden price.
    expect(req.revealed).toBe(true);
    // Every unpicked kingdom pile costing ≤ 5 (3 coins + the 2 gained) waits
    // in the stock: 54 piles − the 10 active − the 3 costing 6 (Artisan,
    // Harem, Nobles) = 41. Recomputed from the pile catalogue so the pin
    // survives future expansions.
    const state2 = engine.getState();
    // Basic reserve stock (Platinum/Colony/Potion) is never on offer — the
    // def filters on the Basic TAG; state card instances don't carry tags,
    // so the recount matches by name.
    const basicStock = new Set(['Platinum', 'Colony', 'Potion']);
    const affordableStock = new Set(
      state2.zones['dom_zone_reserve'].cardIds
        .map((id) => state2.cards[id])
        .filter((c) => Number(c.fields['dom_field_cost']) <= 5 && !basicStock.has(c.name))
        .map((c) => c.name),
    );
    expect(req.cardIds).toHaveLength(affordableStock.size);
    expect(affordableStock.size).toBeGreaterThanOrEqual(41);
    expect(req.counts.every((n) => n === 10)).toBe(true);
    // Paid 3 of the 5 coins; the Workshop landed in the discard as a buy.
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.zones['dom_zone_discard:p0'].cardIds.map((id) => state.cards[id].name))
      .toEqual(['Workshop']);
    expect(state.zones['dom_zone_reserve'].cardIds).toHaveLength(reserveBefore - 1);
  });

  it('Gardens scores 1 VP per 10 owned cards at the recount', async () => {
    // p0 owns 10 starters + 3 Gardens = 13 cards -> floor(13/10) = 1 VP per
    // Gardens (3) + 3 Estates = 6. The recount fires on turn end.
    const def = pickKingdom(buildDominionDef(), KINGDOM_SETS[1].cards);
    def.setup.push(dealNamed('Gardens'), dealNamed('Gardens'), dealNamed('Gardens'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    // Action → Buy → Cleanup → (turn ends, recount fires).
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp']).toBe(6);
    expect(state.players[1].vars['dom_var_vp']).toBe(3); // 3 Estates
  });

  it('draws stamp their cause tag for the runner (moveTags rendering surface)', async () => {
    const def = buildDominionDef();
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state = engine.getState();
    expect(errors).toEqual([]);
    for (const id of state.zones['dom_zone_hand:p0'].cardIds) {
      expect(state.moveTags?.[id]).toBe('draw');
    }
  });
});

describe('end-of-turn timing (the original checks the supply only at turn end)', () => {
  it('a mid-turn last-Province buy does NOT end the game; that turn\'s end does', async () => {
    const def = buildDominionDef();
    // One Province left in the supply; 8 starting coins reach it turn one.
    for (let i = 0; i < 7; i += 1) def.setup.push(dealNamed('Province', 'dom_zone_trash'));
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = 8;
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    const province = state.zones['dom_zone_supply'].cardIds
      .find((id) => state.cards[id].name === 'Province')!;
    await engine.performAction('p0', { actionId: 'dom_action_buy', cardId: province });
    state = engine.getState();
    expect(errors).toEqual([]);
    // The Provinces ran dry mid-buy-phase — but the turn (and its remaining
    // moves) survives until cleanup, like the original table.
    expect(state.zones['dom_zone_supply'].cardIds
      .filter((id) => state.cards[id].name === 'Province')).toHaveLength(0);
    expect(engine.finished).toBe(false);
    expect(state.result).toBeNull();
    expect(engine.getLegalMoves('p0').length).toBeGreaterThan(0);
    // Leaving the buy phase enters Cleanup (manual) — still not over.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(engine.finished).toBe(false);
    expect(state.result).toBeNull();
    // The cleanup step sweeps + redraws + ends the turn; then the end-of-turn
    // judgement fires (the original's supply check runs only at turn end).
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(engine.finished).toBe(true);
    expect(state.result).not.toBeNull();
    expect(state.result!.winners).toEqual(['p0']); // 3 Estates + the Province vs 3 Estates
  });
});

describe('the screen layout speaks the original table\'s language', () => {
  const def = buildDominionDef();
  const els = def.screenLayout!.elements;

  it('keyboard groups: Shift=Treasury, Ctrl=Victory, Alt=Kingdom, plain hand digits', () => {
    const zoneEl = (id: string) => findEl(els, id) as Extract<ScreenElement, { kind: 'zone' }>;
    expect(zoneEl('dom_el_supply_treasures').keyGroup).toBe('shift');
    expect(zoneEl('dom_el_supply_victory').keyGroup).toBe('ctrl');
    expect(zoneEl('dom_el_supply_kingdom').keyGroup).toBe('alt');
    expect(zoneEl('dom_el_my_hand').keyGroup).toBe('plain');
    // The keeper's mock: a FLAT hand strip — every copy visible, no fan tilt.
    expect(zoneEl('dom_el_my_hand').fanAngle).toBe(0);
    expect(zoneEl('dom_el_my_hand').collapseDuplicates).toBe(false);
  });

  it('supply slices resolve through the type/tag exprs: the kingdom slice is EXACTLY the ten piles', async () => {
    // The slices speak the new vocabulary — Treasury "is-a Treasure",
    // Victory "matches The basic cards AND is not a Treasure" (the named
    // filter's consumer), Kingdom "has tag Kingdom" — evaluated here by the
    // runner's own display filter against a REAL started engine.
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state = engine.getState();
    const supplyIds = state.zones['dom_zone_supply'].cardIds;
    const slice = (id: string) => {
      const el = findEl(els, id) as Extract<ScreenElement, { kind: 'zone' }>;
      const names = filterDisplayCards(def, state, supplyIds, el.cardFilter, 'p0')
        .map((cid) => state.cards[cid].name);
      return [...new Set(names)].sort();
    };
    expect(slice('dom_el_supply_treasures')).toEqual(['Copper', 'Gold', 'Silver']);
    expect(slice('dom_el_supply_victory')).toEqual(['Curse', 'Duchy', 'Estate', 'Province']);
    // Ten piles, exactly — the default First Game set, Gardens-style
    // victory-typed kingdom cards included, no basics leaking in.
    expect(slice('dom_el_supply_kingdom')).toEqual([...KINGDOM_SETS[0].cards].sort());
    // The mobile panels carry the same three exprs against the same zone.
    const mEls = def.screenLayout!.mobile!.elements;
    const mKingdom = findEl(mEls, 'dom_el_m_supply_kingdom') as Extract<ScreenElement, { kind: 'zone' }>;
    const mNames = filterDisplayCards(def, state, supplyIds, mKingdom.cardFilter, 'p0')
      .map((cid) => state.cards[cid].name);
    expect([...new Set(mNames)].sort()).toEqual([...KINGDOM_SETS[0].cards].sort());
    expect(errors).toEqual([]);
  });

  it('desktop kingdom is a 5×2 grid of BIG card faces with round cost badges + bottom count pills', () => {
    const zoneEl = (id: string) => findEl(els, id) as Extract<ScreenElement, { kind: 'zone' }>;
    // The keeper's mock: the kingdom shows full card faces (the compact tile
    // stays one Pile-face select away), five columns × two rows, each card
    // wearing a round cost badge top-left and a count pill bottom-center.
    const kingdom = zoneEl('dom_el_supply_kingdom');
    expect(kingdom.pileFace).toBeUndefined();
    expect(kingdom.rows).toBe(2);
    expect(kingdom.columns).toBe(5);
    expect(kingdom.badgeShape).toBe('round');
    expect(kingdom.countBadge).toBe('bottom');
    expect(kingdom.cardStyle?.borderRadius).toBe(10);
    // The basics columns share the badge dress and stay mini card faces.
    for (const id of ['dom_el_supply_treasures', 'dom_el_supply_victory']) {
      expect(zoneEl(id).pileFace).toBeUndefined();
      expect(zoneEl(id).badgeShape).toBe('round');
      expect(zoneEl(id).countBadge).toBe('bottom');
    }
    // Hand and in-play keep full card faces (no pileFace anywhere near them),
    // and the play zone names its empty state.
    expect(zoneEl('dom_el_my_hand').pileFace).toBeUndefined();
    expect(zoneEl('dom_el_my_inplay').pileFace).toBeUndefined();
    expect(zoneEl('dom_el_my_inplay').emptyText).toBe('Play zone empty.');
  });

  it('motion.byTag carries the original per-event animation table', () => {
    expect(def.screenLayout!.motion?.byTag).toEqual({
      draw: { flightMs: 300, arc: 22, spin: 0, staggerMs: 45 },
      play: { flightMs: 320, arc: 38, spin: 0 },
      gain: { flightMs: 340, arc: 40, spin: 6 },
      buy: { flightMs: 340, arc: 40, spin: 6 },
      discard: { flightMs: 320, arc: 36, spin: 7, staggerMs: 35 },
      cleanup: { flightMs: 320, arc: 36, spin: 7, staggerMs: 35 },
    });
    // The base flight stays the original default fly (430ms / 46px arc),
    // which is also its foe-play timing.
    expect(def.screenLayout!.motion?.flightMs).toBe(430);
  });

  it('the seal is a stamped six-state group: three dots, names, hints, key hint, full-plate buttons', () => {
    const seal = findEl(els, 'dom_el_seal')!;
    expect(seal.kind).toBe('group');
    expect(seal.onChangeAnim).toBe('stamp');
    expect(seal.states?.map((s) => s.id)).toEqual([
      'dom_st_seal_over', 'dom_st_seal_resolve', 'dom_st_seal_foe',
      'dom_st_seal_action', 'dom_st_seal_buy', 'dom_st_seal_cleanup',
    ]);
    const kids = (seal as Extract<ScreenElement, { kind: 'group' }>).children;
    const ids = kids.map((k) => k.id);
    for (const id of [
      'dom_el_seal_btn_done', 'dom_el_seal_btn_end', 'dom_el_seal_btn_cleanup',
      'dom_el_seal_dot_action', 'dom_el_seal_dot_buy', 'dom_el_seal_dot_cleanup',
      'dom_el_seal_name_action', 'dom_el_seal_name_buy', 'dom_el_seal_name_cleanup',
      'dom_el_seal_name_foe', 'dom_el_seal_name_resolve', 'dom_el_seal_name_fallen',
      'dom_el_seal_hint_action', 'dom_el_seal_hint_buy', 'dom_el_seal_hint_cleanup',
      'dom_el_seal_hint_foe', 'dom_el_seal_hint_resolve', 'dom_el_seal_hint_fallen',
      'dom_el_seal_key',
    ]) expect(ids, `seal needs ${id}`).toContain(id);
    // The plate buttons fill the whole seal (the DGT seal IS one button).
    const done = kids.find((k) => k.id === 'dom_el_seal_btn_done')!;
    expect(done.rect).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    // The foe name breathes and renders the real seat name.
    const foeName = kids.find((k) => k.id === 'dom_el_seal_name_foe')!;
    expect(foeName.onChangeAnim).toBe('breathe');
    expect(foeName.states).toHaveLength(1);
  });

  it('seal states + play rows resolve correctly against a live engine', async () => {
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state = engine.getState(); // p0's Action phase, stack quiet
    const vis = (id: string, viewer: string) =>
      isDisplayVisible(def, state, findEl(els, id)!.visible ?? null, viewer);
    // The seal reads "Action" for the acting seat, the foe's name for the other.
    expect(vis('dom_el_seal_name_action', 'p0')).toBe(true);
    expect(vis('dom_el_seal_name_buy', 'p0')).toBe(false);
    expect(vis('dom_el_seal_name_foe', 'p0')).toBe(false);
    expect(vis('dom_el_seal_name_action', 'p1')).toBe(false);
    expect(vis('dom_el_seal_name_foe', 'p1')).toBe(true);
    expect(vis('dom_el_seal_key', 'p0')).toBe(true);
    expect(vis('dom_el_seal_key', 'p1')).toBe(false);
    const foeParts = (findEl(els, 'dom_el_seal_name_foe') as Extract<ScreenElement, { kind: 'text' }>).parts!;
    expect(renderTextParts(def, state, foeParts, 'p0')).toBe('Brook');
    expect(renderTextParts(def, state, foeParts, 'p1')).toBe('Ada');
    // Own play zone: ALWAYS visible in the mock layout (it carries the
    // "Play zone empty." note instead of hiding). Foe row keeps the original
    // foePlayWrap condition — shown while the foe acts or has cards out.
    expect(vis('dom_el_my_inplay', 'p0')).toBe(true);
    expect(vis('dom_el_my_inplay', 'p1')).toBe(true);
    expect(vis('dom_el_foe_inplay', 'p1')).toBe(true);
    expect(vis('dom_el_foe_inplay', 'p0')).toBe(false);
    expect(errors).toEqual([]);
  });
});

describe("the mobile variant is the original's pocket table (one viewport)", () => {
  const def = buildDominionDef();
  const m = def.screenLayout!.mobile!;
  const mzone = (id: string) => findEl(m.elements, id) as Extract<ScreenElement, { kind: 'zone' }>;

  it('fills one phone viewport: no page scroll, no locked aspect', () => {
    // The old tall page (aspect 0.38, scroll: true) forced the "I have to
    // scroll" bug; the pocket table stretches over the screen instead.
    expect(m.scroll ?? false).toBe(false);
    expect(m.aspect ?? null).toBeNull();
  });

  it('the supply is a panelSwitcher: tabs slot (selector buttons) + content slot (bound panels)', () => {
    // The deprecated tabbed:true runner chrome is gone from the def source.
    expect(JSON.stringify(def)).not.toContain('"tabbed"');
    const supply = findEl(m.elements, 'dom_el_m_supply') as Extract<ScreenElement, { kind: 'panelSwitcher' }>;
    expect(supply.kind).toBe('panelSwitcher');
    expect(supply.selectorGroup).toBe('dom_el_m_supply');
    expect(supply.slots.map((s) => s.id)).toEqual(['tabs', 'content']);
    expect(supply.slots[0].layout.mode).toBe('row'); // tabs auto-space
    // The tabs slot: three designed buttons, ONE radio group, no actions.
    const buttons = supply.children.filter(
      (c): c is Extract<ScreenElement, { kind: 'button' }> => c.slotId === 'tabs' && c.kind === 'button');
    expect(buttons.map((b) => b.id)).toEqual([
      'dom_el_m_tab_treasury_sel', 'dom_el_m_tab_victory_sel', 'dom_el_m_tab_kingdom_sel',
    ]);
    expect(buttons.map((b) => b.label)).toEqual(['Treasury', 'Victory', 'Kingdom']);
    for (const b of buttons) {
      expect(b.role, `${b.id} switches, never acts`).toBe('selector');
      expect(b.selectorGroup).toBe('dom_el_m_supply');
      expect(b.actionId).toBeNull();
    }
    // The content slot: each panel binds to ITS button and holds ITS slice.
    const panels = supply.children.filter((c) => c.slotId === 'content');
    expect(panels.map((p) => p.name)).toEqual(['Treasury', 'Victory', 'Kingdom']);
    expect(panels.map((p) => p.showForSelector)).toEqual([
      'dom_el_m_tab_treasury_sel', 'dom_el_m_tab_victory_sel', 'dom_el_m_tab_kingdom_sel',
    ]);
    expect(findEl([panels[0]], 'dom_el_m_supply_treasures')).not.toBeNull();
    expect(findEl([panels[1]], 'dom_el_m_supply_victory')).not.toBeNull();
    expect(findEl([panels[2]], 'dom_el_m_supply_kingdom')).not.toBeNull();
  });

  it('supply slices are tile-faced carousels with the DGT digit semantics', () => {
    const slices: Array<[string, string]> = [
      ['dom_el_m_supply_treasures', 'shift'],
      ['dom_el_m_supply_victory', 'ctrl'],
      ['dom_el_m_supply_kingdom', 'alt'],
    ];
    for (const [id, group] of slices) {
      const z = mzone(id);
      expect(z.zoneId, `${id} shows the supply`).toBe('dom_zone_supply');
      expect(z.display, `${id} is a carousel`).toBe('carousel');
      expect(z.pileFace, `${id} wears the compact tile`).toBe('tile');
      expect(z.keyGroup, `${id} keeps its modifier digits`).toBe(group);
      expect(z.pileBadgeField).toBe('dom_field_cost');
    }
    // The hand keeps full card faces, plain always-lit digits and the fan.
    const hand = mzone('dom_el_m_hand');
    expect(hand.keyGroup).toBe('plain');
    expect(hand.pileFace).toBeUndefined();
    expect(hand.fanAngle).toBe(1.6);
    expect(hand.collapseDuplicates).toBe(true);
  });

  it('the chronicle is a collapsed right-edge tab on desktop, absent on mobile; the status bar peeks', () => {
    const noLogs = (els: ScreenElement[]): boolean => els.every((el) => {
      if (el.kind === 'log') return false;
      const kids = el.kind === 'group' ? el.children : el.children ?? [];
      return kids.length === 0 || noLogs(kids);
    });
    // The keeper's mock docks the CHRONICLE tab at the right edge, closed by
    // default; the mobile pocket table still relies on the Log drawer only.
    const chron = findEl(def.screenLayout!.elements, 'dom_el_chronicle')!;
    expect(chron.kind).toBe('log');
    expect(chron.collapsible).toEqual({ side: 'right', label: 'CHRONICLE', startCollapsed: true });
    expect(noLogs(m.elements), 'mobile chronicle gone').toBe(true);
    // The status bar collapses to the safe-area-clear handle after idle.
    expect(def.screenLayout!.statusBar).toBe('peek');
  });

  it('the compact seal keeps the six states and drops the keyboard hint', () => {
    const seal = findEl(m.elements, 'dom_el_m_seal') as Extract<ScreenElement, { kind: 'group' }>;
    expect(seal.onChangeAnim).toBe('stamp');
    expect(seal.states?.map((s) => s.name)).toEqual(['Fallen', 'Resolve', 'Foe turn', 'Action', 'Buy', 'Cleanup']);
    const ids = seal.children.map((k) => k.id);
    for (const suffix of [
      'btn_done', 'btn_end', 'btn_cleanup', 'dot_action', 'dot_buy', 'dot_cleanup',
      'name_action', 'name_buy', 'name_cleanup', 'name_foe', 'name_resolve', 'name_fallen',
      'hint_action', 'hint_buy', 'hint_cleanup', 'hint_foe', 'hint_resolve', 'hint_fallen',
    ]) expect(ids, `mobile seal needs ${suffix}`).toContain(`dom_el_m_seal_${suffix}`);
    // Spec, "Mobile (≤45rem)": .phase-key { display: none; } — no hint chip.
    expect(ids).not.toContain('dom_el_m_seal_key');
    // The plates fill the seal (the DGT seal IS one button), like desktop.
    const done = seal.children.find((k) => k.id === 'dom_el_m_seal_btn_done')!;
    expect(done.rect).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('play rows follow the original appearing rules on the phone too', async () => {
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state = engine.getState(); // p0's Action phase
    const vis = (id: string, viewer: string) =>
      isDisplayVisible(def, state, findEl(m.elements, id)!.visible ?? null, viewer);
    expect(vis('dom_el_m_inplay', 'p0')).toBe(true); // your turn: shown even empty
    expect(vis('dom_el_m_inplay', 'p1')).toBe(false); // foe acting + empty: hidden
    expect(vis('dom_el_m_foe_inplay', 'p1')).toBe(true);
    expect(vis('dom_el_m_foe_inplay', 'p0')).toBe(false);
    expect(errors).toEqual([]);
  });
});

describe('the TURN ticker counts rounds, not per-seat turns', () => {
  /** The parts of a text element anywhere in an element tree. */
  function textParts(els: ScreenElement[], id: string): readonly (string | Expr)[] {
    const el = findEl(els, id);
    return el !== null && el.kind === 'text' ? el.parts ?? [] : [];
  }

  it('dom_el_turn / dom_el_m_turn show the round like the original top bar', async () => {
    const def = buildDominionDef();
    const desktop = textParts(def.screenLayout!.elements, 'dom_el_turn');
    const mobile = textParts(def.screenLayout!.mobile!.elements, 'dom_el_m_turn');
    expect(desktop.length).toBeGreaterThan(0);
    expect(mobile.length).toBeGreaterThan(0);
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const shown = () => renderTextParts(def, engine.getState(), desktop, 'p0');
    const endTurn = async (pid: string) => {
      // Action → Buy → Cleanup → pass (three manual phases now).
      await engine.performAction(pid, { actionId: 'dom_action_done' });
      await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
      await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
    };
    expect(shown()).toBe('TURN 1'); // p0's first turn
    await endTurn('p0');
    expect(shown()).toBe('TURN 1'); // p1 still plays ROUND 1 (original: turnNo 1)
    await endTurn('p1');
    expect(shown()).toBe('TURN 2'); // back to p0 — round 2
    expect(renderTextParts(def, engine.getState(), mobile, 'p0')).toBe('TURN 2');
    expect(errors).toEqual([]);
  });
});

describe('kingdom picker helpers (the setup screen surface)', () => {
  const def = buildDominionDef();

  it('detects swappable-supply defs and reads the active ten', () => {
    expect(supportsKingdomPicking(def)).toBe(true);
    expect([...activeKingdomCards(def)].sort()).toEqual([...KINGDOM_SETS[0].cards].sort());
    // A def without kingdom-pile setup blocks offers no picker.
    expect(supportsKingdomPicking({ ...def, setup: [] })).toBe(false);
  });

  it('catalogs every kingdom card with printed cost + type line, cost-sorted', () => {
    const cat = kingdomCatalog(def);
    expect(cat.map((c) => c.name).sort()).toEqual(kingdomCardNames(def).sort());
    expect(cat.some((c) => c.name === 'Bridge' && c.cost === 4 && c.kind === 'Action')).toBe(true);
    expect(cat.some((c) => c.name === 'Witch' && c.kind === 'Action – Attack')).toBe(true);
    expect(cat.every((c, i, a) => i === 0 || a[i - 1].cost <= c.cost)).toBe(true);
  });

  it('a hand-picked ten round-trips through pickKingdom', () => {
    const ten = kingdomCatalog(def).slice(0, 10).map((c) => c.name);
    const picked = pickKingdom(def, ten);
    expect([...activeKingdomCards(picked)].sort()).toEqual([...ten].sort());
  });

  it('tags every catalog entry with its printed set; Prosperity basics are not picks', () => {
    const cat = kingdomCatalog(def);
    const sets = new Set(cat.map((c) => c.expansion));
    expect([...sets].sort()).toEqual(['Alchemy', 'Base', 'Cornucopia', 'Guilds', 'Hinterlands', 'Intrigue', 'Menagerie', 'Promos', 'Prosperity', 'Renaissance', 'Seaside']);
    expect(cat.filter((c) => c.expansion === 'Intrigue')).toHaveLength(26);
    expect(cat.filter((c) => c.expansion === 'Seaside')).toHaveLength(26);
    expect(cat.filter((c) => c.expansion === 'Prosperity')).toHaveLength(25);
    expect(cat.filter((c) => c.expansion === 'Cornucopia')).toHaveLength(13);
    expect(cat.filter((c) => c.expansion === 'Guilds')).toHaveLength(13);
    expect(cat.filter((c) => c.expansion === 'Hinterlands')).toHaveLength(26);
    expect(cat.filter((c) => c.expansion === 'Promos')).toHaveLength(7);
    expect(cat.filter((c) => c.expansion === 'Alchemy')).toHaveLength(11);
    expect(cat.filter((c) => c.expansion === 'Menagerie')).toHaveLength(30);
    expect(cat.filter((c) => c.expansion === 'Renaissance')).toHaveLength(25);
    // Potion and Horse stock are never kingdom picks.
    expect(cat.some((c) => c.name === 'Potion' || c.name === 'Horse')).toBe(false);
    expect(cat.some((c) => c.name === 'Platinum' || c.name === 'Colony')).toBe(false);
    // Non-supply stock (the five Prizes) is nobody's kingdom pick either.
    expect(cat.some((c) => c.name === 'Princess' || c.name === 'Diadem')).toBe(false);
    expect(kingdomCardNames(def)).not.toContain('Platinum');
    expect(kingdomCardNames(def)).not.toContain('Followers');
  });
});

describe('Prosperity basics toggle (Platinum & Colony)', () => {
  const def = buildDominionDef();

  it('is carried by the def but disabled until toggled', () => {
    expect(supportsProsperityBasics(def)).toBe(true);
    expect(prosperityEnabled(def)).toBe(false);
    expect(def.cards.some((c) => c.name === 'Platinum')).toBe(true);
    expect(def.cards.some((c) => c.name === 'Colony')).toBe(true);
  });

  it('toggles on and off, purely and idempotently', () => {
    const on = withProsperityBasics(def, true);
    expect(prosperityEnabled(on)).toBe(true);
    expect(on.endConditions.some((e) => e.id === 'dom_end_colonies')).toBe(true);
    // The kingdom picker must not mistake the promotion for kingdom picks.
    expect(activeKingdomCards(on)).toEqual(activeKingdomCards(def));
    const onAgain = withProsperityBasics(on, true);
    expect(onAgain.setup).toHaveLength(on.setup.length);
    const off = withProsperityBasics(on, false);
    expect(prosperityEnabled(off)).toBe(false);
    expect(off.endConditions.some((e) => e.id === 'dom_end_colonies')).toBe(false);
    expect(off.setup).toHaveLength(def.setup.length);
    expect(prosperityEnabled(def)).toBe(false); // the input never mutates
  });

  it('survives a pickKingdom AFTER enabling (watcher keeps the piles)', () => {
    const ten = kingdomCatalog(def).slice(0, 10).map((c) => c.name);
    const both = pickKingdom(withProsperityBasics(def, true), ten);
    expect(prosperityEnabled(both)).toBe(true);
    expect([...activeKingdomCards(both)].sort()).toEqual([...ten].sort());
  });

  it('puts 12 Platinum + 8 Colony in the live supply and validates clean', async () => {
    const on = withProsperityBasics(buildDominionDef(), true);
    expect(errorsOf(on)).toEqual([]);
    const { names, errors } = await startedSupply(on);
    expect(errors).toEqual([]);
    expect(names.has('Platinum')).toBe(true);
    expect(names.has('Colony')).toBe(true);
  });

  it('stays out of the supply when disabled', async () => {
    const { names } = await startedSupply(buildDominionDef());
    expect(names.has('Platinum')).toBe(false);
    expect(names.has('Colony')).toBe(false);
  });
});

describe('every lobby set plays to completion (invariant parity)', () => {
  /** Recompute a player's VP from the final zones: fields + the formula
   *  cards (Gardens: 1 per 10 owned; Duke: 1 per Duchy). */
  function computeVp(state: GameState, pid: string): number {
    let vp = 0;
    let owned = 0;
    let gardens = 0;
    let dukes = 0;
    let duchies = 0;
    for (const z of ['dom_zone_deck', 'dom_zone_hand', 'dom_zone_discard', 'dom_zone_inplay']) {
      for (const cid of state.zones[`${z}:${pid}`].cardIds) {
        const card = state.cards[cid];
        owned += 1;
        vp += Number(card.fields['dom_field_vp'] ?? 0);
        if (card.name === 'Gardens') gardens += 1;
        if (card.name === 'Duke') dukes += 1;
        if (card.name === 'Duchy') duchies += 1;
      }
    }
    return vp + gardens * Math.floor(owned / 10) + dukes * duchies;
  }

  // One seed per set to keep the suite quick; the stack games run long
  // under random play, so use the raised cap like the example suite.
  // (Same seeds as the pre-refactor baseline in the header comment.)
  it.each([
    { set: KINGDOM_SETS[0], seed: 41 },
    { set: KINGDOM_SETS[1], seed: 42 },
    { set: KINGDOM_SETS[2], seed: 43 },
    { set: KINGDOM_SETS[3], seed: 44 }, // Deck Top (Base 2E remainder)
    { set: KINGDOM_SETS[4], seed: 45 }, // Underlings (Intrigue 2E)
    { set: KINGDOM_SETS[5], seed: 46 }, // The Grand Scheme (Intrigue 2E)
    { set: KINGDOM_SETS[6], seed: 47 }, // Masters of Deceit (Intrigue 2E)
  ])('$set.name (seed $seed) finishes cleanly with every card accounted for', async ({ set, seed }) => {
    const def = pickKingdom(buildDominionDef(), set.cards);
    const r = await playThrough(def, { seed, stepCap: 8000 });
    expect(r.errors, 'the def should run without script errors').toEqual([]);
    expect(r.finished, `game should finish (took ${r.steps} steps)`).toBe(true);
    expect(r.state.result).not.toBeNull();
    expect(totalCards(r.state)).toBe(TOTAL_CARDS);
    // It only ends when the Provinces ran dry or three piles emptied.
    const provinces = Object.values(r.state.zones)
      .filter((z) => z.zoneId === 'dom_zone_supply')
      .flatMap((z) => z.cardIds)
      .filter((id) => r.state.cards[id].name === 'Province').length;
    const emptyPiles = Number(r.state.globalVars['dom_var_empty_piles'] ?? 0);
    expect(provinces === 0 || emptyPiles >= 3).toBe(true);
    // Winner-logic invariant: the recorded VP vars match a from-scratch
    // recount, and the winners are exactly the max-VP seats.
    const vps = r.state.players.map((p) => ({ id: p.id, vp: computeVp(r.state, p.id) }));
    for (const p of r.state.players) {
      expect(p.vars['dom_var_vp'], `${p.id} VP var matches the recount`)
        .toBe(vps.find((v) => v.id === p.id)!.vp);
    }
    const best = Math.max(...vps.map((v) => v.vp));
    const expectWinners = vps.filter((v) => v.vp === best).map((v) => v.id).sort();
    expect([...r.state.result!.winners].sort()).toEqual(expectWinners);
  });
});
