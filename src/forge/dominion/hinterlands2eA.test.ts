/**
 * Hinterlands 2E (part A) — deterministic per-card probes through the REAL
 * engine: the on-gain reactions (Fool's Gold / Trader / Trail / Nomads) ride
 * 'gain'/'buy'-tagged watchers, the discard reactions (Tunnel / Weaver /
 * Trail) fire on 'discard'-tagged moves ONLY (cleanup's sweep is tagged
 * 'cleanup', probed), Guard Dog's reaction is a response-speed action in an
 * open attack window, and Scheme's topdeck fires at the cleanup-phase start.
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers hinterlands2eA, freshDef() can
 * become a plain static `buildDominionDef` import.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest, EngineHandle, GameDef, GameState } from '../../shared/types';
import { PASS_ACTION_ID } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { bottomN, move, zone } from '../../examples/dsl';
import { EXPANSIONS } from './expansions';
import { FOOLS_GOLD_PLAYED_VAR, hinterlands2eA } from './hinterlands2eA';
import { dealNamed, findNamed, probeEngine } from './testKit';

if (!EXPANSIONS.includes(hinterlands2eA)) EXPANSIONS.push(hinterlands2eA);
/** buildDominionDef AFTER registration (see the header note). */
async function freshDef(): Promise<GameDef> {
  const { buildDominionDef } = await import('../dominionGame');
  return buildDominionDef();
}

const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
/** Top of a stack zone = the END of the cardIds array. */
const topName = (state: GameState, zoneKey: string): string | undefined =>
  names(state, zoneKey).at(-1);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');

/** Setup block: set a per-player number variable (coins for buy probes). */
const giveVar = (varId: string, playerId: string, value: number): GameDef['setup'][number] =>
  ({ kind: 'setVar', varId, target: { kind: 'str', value: playerId }, value: { kind: 'num', value } });

const play = { actionId: 'dom_action_play' };
const noChoices = () => { throw new Error('no choices expected'); };

/** Skip to the buy phase and play the named card via the treasure action. */
async function playTreasure(engine: EngineHandle, pid: string, name: string): Promise<void> {
  const state = engine.getState();
  await engine.performAction(pid, {
    actionId: 'dom_action_treasure', cardId: findNamed(state, HAND(pid), name),
  });
}

/**
 * Drive an open response window: every holder passes, except that `useFor`
 * performs `actionId` ONCE when it is legal (seaside2eA's driveWindow shape —
 * Guard Dog instead of Moat).
 */
async function driveWindow(engine: EngineHandle, useFor: string | null, actionId: string): Promise<void> {
  let used = false;
  for (let guard = 0; guard < 60; guard += 1) {
    const state = engine.getState();
    if (state.window === null) return;
    const holder = state.window.holderId;
    const moves = engine.getLegalMoves(holder);
    const use = moves.find((m) => m.actionId === actionId);
    if (!used && useFor === holder && use !== undefined) {
      await engine.performAction(holder, use);
      used = true;
    } else {
      const pass = moves.find((m) => m.actionId === PASS_ACTION_ID);
      if (pass === undefined) throw new Error('no pass move while a window is open');
      await engine.performAction(holder, pass);
    }
  }
  throw new Error('response window never closed');
}

describe('hinterlands2eA module registration', () => {
  it('validates clean and knows all thirteen cards with costs, types and tags', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Crossroads: 2, "Fool's Gold": 2, Develop: 3, 'Guard Dog': 3, Oasis: 3,
      Scheme: 3, Tunnel: 3, 'Jack of All Trades': 4, Nomads: 4,
      'Spice Merchant': 4, Trader: 4, Trail: 4, Weaver: 4,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
    }
    // Primary types: Fool's Gold is the module's one Treasure, Tunnel its one
    // Victory (2 VP on the field); everything else — including the printed
    // Treasure Weaver (documented deviation) — stays an Action.
    expect(def.cards.find((c) => c.name === "Fool's Gold")!.typeId).toBe('dom_type_treasure');
    expect(def.cards.find((c) => c.name === 'Tunnel')!.typeId).toBe('dom_type_victory');
    expect(def.cards.find((c) => c.name === 'Tunnel')!.fields['dom_field_vp']).toBe(2);
    for (const name of ['Crossroads', 'Develop', 'Guard Dog', 'Oasis', 'Scheme',
      'Jack of All Trades', 'Nomads', 'Spice Merchant', 'Trader', 'Trail', 'Weaver']) {
      expect(def.cards.find((c) => c.name === name)!.typeId, `${name} is an Action`)
        .toBe('dom_type_action');
    }
    // Type-line tags: the six reactions; NOBODY here is an Attack.
    for (const name of ["Fool's Gold", 'Guard Dog', 'Trader', 'Trail', 'Tunnel', 'Weaver']) {
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} is a Reaction`)
        .toContain('dom_tag_reaction');
    }
    for (const name of Object.keys(costs)) {
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} is not an Attack`)
        .not.toContain('dom_tag_attack');
    }
    // Guard Dog's reaction is the module's own response action.
    expect(def.actions.some((a) => a.id === 'dom_action_guard_dog')).toBe(true);
    // Kingdom stock: 10 copies per pile.
    const deck = def.decks.find((d) => d.id === 'dom_deck_kingdom')!;
    expect(deck.source.kind).toBe('custom');
    if (deck.source.kind === 'custom') {
      for (const id of Object.values(hinterlands2eA.ids)) {
        const entry = deck.source.entries.find((en) => en.cardId === id);
        expect(entry, `${id} in the kingdom deck`).toBeDefined();
        expect(entry!.count).toBe(10);
      }
    }
  });
});

describe('Crossroads', () => {
  it('draws per Victory card in hand; only the first play grants +3 Actions', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Crossroads'), fromReserve('Crossroads'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // First play: reveal, draw 1 per Estate in hand, then +3 Actions.
    let state = engine.getState();
    const h0 = count(state, HAND('p0'));
    const d0 = count(state, DECK('p0'));
    const v0 = names(state, HAND('p0')).filter((n) => n === 'Estate').length;
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Crossroads') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(h0 - 1 + Math.min(v0, d0));
    expect(state.players[0].vars['dom_var_actions']).toBe(3); // 1 - 1 + 3

    // Second play the same turn: draws again, but NO actions this time.
    const h1 = count(state, HAND('p0'));
    const d1 = count(state, DECK('p0'));
    const v1 = names(state, HAND('p0')).filter((n) => n === 'Estate').length;
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Crossroads') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(h1 - 1 + Math.min(v1, d1));
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 3 - 1, no bonus
  });
});

describe("Fool's Gold", () => {
  it('pays $1 for the first play, $4 after; the counter fades at cleanup', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve("Fool's Gold"), fromReserve("Fool's Gold"));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', "Fool's Gold");
    let state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    await playTreasure(engine, 'p0', "Fool's Gold");
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(5); // 1 + 4
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars[FOOLS_GOLD_PLAYED_VAR]).toBe(0);
  });

  it("reaction: the other player's Province buy lets the holder trash it for a Gold onto the deck", async () => {
    const def = await freshDef();
    def.setup.push(fromReserve("Fool's Gold", 'dom_zone_hand', 'p1'), giveVar('dom_var_coins', 'p0', 8));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const fg = req.cardIds.find((id) => state.cards[id].name === "Fool's Gold")!;
      return JSON.stringify([fg]);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Province'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].playerId).toBe('p1');
    expect(names(state, DISCARD('p0'))).toContain('Province');
    expect(names(state, TRASH)).toEqual(["Fool's Gold"]);
    expect(topName(state, DECK('p1'))).toBe('Gold');
    expect(count(state, HAND('p1'))).toBe(5); // the FG left the hand
  });
});

describe('Develop', () => {
  it('trashes a Silver, gaining an exact-$4 and an exact-$2 card onto the deck', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Develop'), dealNamed('Silver'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      if (req.kind === 'pile') {
        const smithy = req.cardIds.find((id) => state.cards[id].name === 'Smithy');
        if (smithy !== undefined) return smithy; // the exact-$4 half
        return req.cardIds.find((id) => state.cards[id].name === 'Estate')!; // the exact-$2 half
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Develop') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['card', 'pile', 'pile']);
    expect(names(state, TRASH)).toEqual(['Silver']);
    // Fixed order: the $4 card first, then the $2 card on top of it.
    expect(names(state, DECK('p0')).slice(-2)).toEqual(['Smithy', 'Estate']);
    expect(names(state, DISCARD('p0'))).toEqual([]);
  });
});

describe('Guard Dog', () => {
  it('draws 2, and 2 more when the hand holds 5 or fewer', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Guard Dog'),
      // Bury everything except the Guard Dog: play it from a 1-card hand so
      // the second +2 branch fires (hand after the first draw = 2 ≤ 5).
      move(bottomN(5), zone('dom_zone_hand'), zone('dom_zone_deck'), { faceUp: false }),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(1);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Guard Dog') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(4); // 0 + 2 + 2
    expect(count(state, DECK('p0'))).toBe(6); // 5 + 5 buried - 4 drawn
    expect(names(state, INPLAY('p0'))).toEqual(['Guard Dog']);
  });

  it('reaction: plays from hand inside the attack window, drawing before Militia bites', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Militia', 'dom_zone_hand', 'p0'),
      fromReserve('Guard Dog', 'dom_zone_hand', 'p1'),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      // Militia's discard-to-3 after the window: drop the required count.
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, req.min));
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Militia') });
    await driveWindow(engine, 'p1', 'dom_action_guard_dog');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    // Guard Dog was played first: 6 - 1 + 2 = 7 cards faced the Militia…
    expect(names(state, INPLAY('p1'))).toEqual(['Guard Dog']);
    expect(requests).toHaveLength(1);
    const discardReq = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(discardReq.playerId).toBe('p1');
    expect(discardReq.min).toBe(4); // 7 down to 3
    // …and the attack still landed afterwards.
    expect(count(state, HAND('p1'))).toBe(3);
    expect(count(state, DISCARD('p1'))).toBe(4);
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // Militia's coins
  });
});

describe('Oasis', () => {
  it('+1 Card +1 Action +$1, then discards a card', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Oasis'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const copper = req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
      return JSON.stringify([copper]);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Oasis') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.min).toBe(1);
    expect(req.max).toBe(1);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Oasis + 1 - 1
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, DISCARD('p0'))).toEqual(['Copper']);
  });
});

describe('Scheme', () => {
  it('topdecks a played Action at the cleanup-phase start, ahead of the redraw', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Scheme'), dealNamed('Moat'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const moat = req.cardIds.find((id) => state.cards[id].name === 'Moat')!;
      return JSON.stringify([moat]);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Scheme') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Moat') });
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    // Entering cleanup pops the Scheme choice; the pick rides the deck top.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(topName(state, DECK('p0'))).toBe('Moat');
    // The redraw then deals the Moat straight into the next hand.
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p0'))).toContain('Moat');
    expect(names(state, DISCARD('p0'))).not.toContain('Moat');
    expect(count(state, INPLAY('p0'))).toBe(0);
  });
});

describe('Tunnel', () => {
  it('discarded by Oasis (not cleanup), it reveals for a Gold', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Oasis'), fromReserve('Tunnel'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'cards') {
        const tunnel = req.cardIds.find((id) => state.cards[id].name === 'Tunnel')!;
        return JSON.stringify([tunnel]);
      }
      if (req.kind === 'yesNo') return true;
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Oasis') });
    let state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['cards', 'yesNo']);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Gold', 'Tunnel']);
    expect(names(state, SUPPLY).filter((n) => n === 'Gold')).toHaveLength(29);
    // The cleanup sweep must NOT re-offer the Tunnel (its tag is 'cleanup').
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(2); // no new prompts at cleanup
  });
});

describe('Jack of All Trades', () => {
  it('gains a Silver, discards the looked-at top card, and draws up to 5', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Jack of All Trades'),
      // Thin the hand to 4 (Jack + 3) so the draw-to-5 step has work to do.
      move(bottomN(2), zone('dom_zone_hand'), zone('dom_zone_deck'), { faceUp: false }),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind === 'yesNo') return true; // discard the looked-at card
      if (req.kind === 'cards') return JSON.stringify([]); // decline the trash
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(4);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Jack of All Trades') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(5); // 3, drawn back up to 5
    expect(count(state, DISCARD('p0'))).toBe(2); // the Silver + the discarded top card
    expect(names(state, DISCARD('p0'))).toContain('Silver');
    expect(count(state, DECK('p0'))).toBe(4); // 7 - 1 looked-away - 2 drawn
    expect(names(state, INPLAY('p0'))).toEqual(['Jack of All Trades']);
    expect(count(state, TRASH)).toBe(0); // the optional trash was declined
  });
});

describe('Nomads', () => {
  it('+1 Buy +$2 on play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Nomads'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Nomads') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
  });

  it('+$2 when bought — the coins land mid buy phase', async () => {
    const def = await freshDef();
    // One Nomads copy is promoted into the supply so it can be bought.
    def.setup.push(
      dealNamed('Nomads', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 4),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Nomads'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Nomads');
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // 4 - 4 + 2
  });

  it('+$2 for the trasher when Remodel eats it', async () => {
    const def = await freshDef();
    // Remodel sits in the default (First Game) kingdom — dealt off the supply.
    def.setup.push(dealNamed('Remodel'), fromReserve('Nomads'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Nomads')!;
      }
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Gold')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Remodel') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Nomads']);
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // the trash trigger
    expect(names(state, DISCARD('p0'))).toEqual(['Gold']); // 4 + 2 cost window
  });
});

describe('Spice Merchant', () => {
  it('trashing a Treasure buys +2 Cards and +1 Action', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Spice Merchant'), dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') {
        const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
        return JSON.stringify([silver]);
      }
      if (req.kind === 'option') return 'sm_cards';
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Spice Merchant') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(count(state, HAND('p0'))).toBe(7); // 7 - SM - Silver + 2
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
  });

  it('…or +1 Buy and +$2', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Spice Merchant'), dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') {
        const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
        return JSON.stringify([silver]);
      }
      if (req.kind === 'option') return 'sm_coins';
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Spice Merchant') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(5); // 7 - SM - Silver
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
  });
});

describe('Trader', () => {
  it('trashes a Silver for 3 Silvers from the supply', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Trader'), dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Trader') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver', 'Silver', 'Silver']);
    expect(names(state, SUPPLY).filter((n) => n === 'Silver')).toHaveLength(36); // 40 - 1 dealt - 3
  });

  it('reaction: exchanges a bought Estate for a Silver, the Estate rejoining its pile', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Trader'), giveVar('dom_var_coins', 'p0', 2));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return true;
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    const estatesBefore = names(state, SUPPLY).filter((n) => n === 'Estate').length;
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Estate'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].playerId).toBe('p0');
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
    expect(names(state, SUPPLY).filter((n) => n === 'Estate')).toHaveLength(estatesBefore);
    expect(state.players[0].vars['dom_var_coins']).toBe(0); // the buy still paid
  });
});

describe('Trail', () => {
  it('+1 Card +1 Action on a normal play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Trail'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Trail') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Trail + 1
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
  });

  it('bought: may play itself straight from the gain', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Trail', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 4),
    );
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return true;
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Trail'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, INPLAY('p0'))).toEqual(['Trail']);
    expect(names(state, DISCARD('p0'))).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // its +1 Card fired
  });

  it('trashed by Remodel: doubles back out of the trash as a play', async () => {
    const def = await freshDef();
    // Remodel sits in the default (First Game) kingdom — dealt off the supply.
    def.setup.push(dealNamed('Remodel'), fromReserve('Trail'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Trail')!;
      }
      if (req.kind === 'yesNo') return true;
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Remodel') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, TRASH)).toBe(0); // the Trail escaped
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Remodel', 'Trail']);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']); // Remodel's gain
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + Trail's 1
    expect(count(state, HAND('p0'))).toBe(6); // 7 - Remodel - Trail + Trail's draw
  });
});

describe('Weaver', () => {
  it('gains 2 Silvers when played outright', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Weaver'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'wv_silvers';
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Weaver') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver', 'Silver']);
    expect(names(state, INPLAY('p0'))).toEqual(['Weaver']);
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
  });

  it('discarded by Oasis, it may play itself and weave a $4 gain', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Oasis'), fromReserve('Weaver'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'cards') {
        const weaver = req.cardIds.find((id) => state.cards[id].name === 'Weaver')!;
        return JSON.stringify([weaver]);
      }
      if (req.kind === 'yesNo') return true;
      if (req.kind === 'option') return 'wv_gain';
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Smithy')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Oasis') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['cards', 'yesNo', 'option', 'pile']);
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Oasis', 'Weaver']);
    expect(names(state, DISCARD('p0'))).toEqual(['Smithy']); // the Weaver left, its gain arrived
  });
});
