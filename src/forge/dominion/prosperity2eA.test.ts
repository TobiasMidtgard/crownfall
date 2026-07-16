/**
 * Prosperity 2E (part A) — deterministic per-card probes through the REAL
 * engine: the VP-chip earners (Bishop / Monument / Collection / Investment)
 * bank into VP_TOKENS and the turn-end recount re-adds the bank; Quarry
 * drives the global DISCOUNT; Watchtower's and Tiara's on-gain reactions ride
 * the module's cardEnterZone watchers; Clerk's reaction half fires at the
 * owner's action-phase start.
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers prosperity2eA, freshDef() can
 * become a plain static `buildDominionDef` import.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest, EngineHandle, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { prosperity2eA } from './prosperity2eA';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(prosperity2eA)) EXPANSIONS.push(prosperity2eA);
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

const play = { actionId: 'dom_action_play' };
const noChoices = () => { throw new Error('no choices expected'); };

/** Action → Buy → Cleanup → the turn passes (nothing gets played). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

/** Skip to the buy phase and play the named card via the treasure action. */
async function playTreasure(engine: EngineHandle, pid: string, name: string): Promise<void> {
  const state = engine.getState();
  await engine.performAction(pid, {
    actionId: 'dom_action_treasure', cardId: findNamed(state, HAND(pid), name),
  });
}

describe('prosperity2eA module registration', () => {
  it('validates clean and knows all thirteen cards with costs, types and tags', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Anvil: 3, Watchtower: 3, Bishop: 4, Clerk: 4, Investment: 4, Monument: 4,
      Quarry: 4, Tiara: 4, "Worker's Village": 4, Charlatan: 5, City: 5,
      Collection: 5, 'Crystal Ball': 5,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
    }
    // Primary types: the six Treasures play from the buy phase, the rest
    // stay Actions.
    for (const name of ['Anvil', 'Investment', 'Quarry', 'Tiara', 'Collection', 'Crystal Ball']) {
      expect(def.cards.find((c) => c.name === name)!.typeId, `${name} is a Treasure`)
        .toBe('dom_type_treasure');
    }
    for (const name of ['Watchtower', 'Bishop', 'Clerk', 'Monument', "Worker's Village", 'Charlatan', 'City']) {
      expect(def.cards.find((c) => c.name === name)!.typeId, `${name} is an Action`)
        .toBe('dom_type_action');
    }
    // Type-line tags: Clerk is Action–Attack–Reaction, Charlatan an Attack,
    // Watchtower a Reaction — and Bishop is correctly NOT an Attack.
    for (const name of ['Clerk', 'Charlatan']) {
      expect(def.cards.find((c) => c.name === name)!.tags).toContain('dom_tag_attack');
    }
    for (const name of ['Clerk', 'Watchtower']) {
      expect(def.cards.find((c) => c.name === name)!.tags).toContain('dom_tag_reaction');
    }
    expect(def.cards.find((c) => c.name === 'Bishop')!.tags).not.toContain('dom_tag_attack');
    // Kingdom stock: 10 copies per pile.
    const deck = def.decks.find((d) => d.id === 'dom_deck_kingdom')!;
    expect(deck.source.kind).toBe('custom');
    if (deck.source.kind === 'custom') {
      for (const id of Object.values(prosperity2eA.ids)) {
        const entry = deck.source.entries.find((en) => en.cardId === id);
        expect(entry, `${id} in the kingdom deck`).toBeDefined();
        expect(entry!.count).toBe(10);
      }
    }
  });
});

describe("Worker's Village", () => {
  it('+1 Card +2 Actions +1 Buy', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve("Worker's Village"));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), "Worker's Village") });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - WV + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(names(state, INPLAY('p0'))).toEqual(["Worker's Village"]);
  });
});

describe('Monument', () => {
  it('+$2 and a permanent VP chip the turn-end recount re-adds', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Monument'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Monument') });
    let state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars['dom_var_vp_tokens']).toBe(1);
    // The recount (turn end) = 3 starter Estates + the banked chip.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp']).toBe(4);
  });
});

describe('City', () => {
  it('level 1: +1 Card +2 Actions with no empty piles', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('City'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'City') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - City + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(state.players[0].vars['dom_var_buys']).toBe(1);
  });

  it('level 3: two empty piles add +1 Card, +$1 and +1 Buy', async () => {
    const def = await freshDef();
    // Preset the watcher's tally (it recomputes only when a card LEAVES the
    // supply, which nothing here does before City resolves).
    def.setup.push(fromReserve('City'), {
      kind: 'setVar', varId: 'dom_var_empty_piles', target: null, value: { kind: 'num', value: 2 },
    });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'City') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - City + 2 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
  });
});

describe('Watchtower', () => {
  it('draws until 6 cards are in hand', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Watchtower'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Watchtower') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Watchtower = 5, drawn up to 6
    expect(count(state, DECK('p0'))).toBe(4);
    expect(state.players[0].vars['dom_var_actions']).toBe(0); // no +Action
  });

  it('reaction: a bought card can be trashed straight from the gain', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Watchtower'),
      dealNamed('Copper'), dealNamed('Copper'), dealNamed('Copper'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'wt_trash';
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Copper');
    await playTreasure(engine, 'p0', 'Copper');
    await playTreasure(engine, 'p0', 'Copper');
    let state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Silver'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].playerId).toBe('p0');
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(names(state, DISCARD('p0'))).not.toContain('Silver');
    expect(state.players[0].vars['dom_var_coins']).toBe(0); // the buy still paid
  });
});

describe('Bishop', () => {
  it('+$1 +1 chip, half the trashed cost in chips, opponent may trash too', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Bishop'), dealNamed('Estate'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') {
        // p0 trashes the Estate (cost 2 → +1 more chip).
        return req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
      }
      if (req.kind === 'cards') {
        // p1 accepts the optional trash.
        return JSON.stringify([req.cardIds[0]]);
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Bishop') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['card', 'cards']);
    expect(requests[1].playerId).toBe('p1');
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.players[0].vars['dom_var_vp_tokens']).toBe(2); // 1 flat + floor(2/2)
    expect(count(state, TRASH)).toBe(2); // p0's Estate + p1's card
    expect(names(state, TRASH)).toContain('Estate');
    expect(count(state, HAND('p1'))).toBe(4);
    // No response window: Bishop is not an Attack.
    expect(state.window).toBeNull();
  });
});

describe('Clerk', () => {
  it('attack: +$2 and the 5-card opponent topdecks a card of their choice', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Clerk'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      // T1's phase entry offers the hand-dealt Clerk its free start-of-turn
      // play — DECLINE it here, this probe plays it as a normal Action.
      if (req.kind === 'yesNo') return false;
      if (req.kind === 'card') return req.cardIds[0];
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Clerk') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars['dom_var_actions']).toBe(0); // a normal play
    expect(requests.map((r) => r.kind)).toEqual(['yesNo', 'card']);
    expect(requests[1].playerId).toBe('p1');
    expect(count(state, HAND('p1'))).toBe(4);
    expect(count(state, DECK('p1'))).toBe(6);
  });

  it('reaction: at the start of your turn a Clerk in hand may play itself free', async () => {
    const def = await freshDef();
    // Dealt to the DECK TOP so the T1 cleanup redraw brings it into the hand
    // p0 holds at their NEXT action-phase start.
    def.setup.push(fromReserve('Clerk', 'dom_zone_deck', 'p0'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind === 'yesNo') return true;
      if (req.kind === 'card') return req.cardIds[0];
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await passTurn(engine, 'p0'); // T1 — the redraw picks the Clerk up
    await passTurn(engine, 'p1'); // T2 — T3's phase entry pops the yes/no
    await playOutWindows(engine); // the free play stacked its attack half
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(requests.map((r) => r.kind)).toEqual(['yesNo', 'card']);
    expect(names(state, INPLAY('p0'))).toEqual(['Clerk']);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // no Action spent
    // p1's T2 cleanup redraw emptied their deck; the topdecked card is now
    // its only resident.
    expect(count(state, HAND('p1'))).toBe(4);
    expect(count(state, DECK('p1'))).toBe(1);
  });
});

describe('Anvil', () => {
  it('$1; discarding a Treasure gains a card costing up to $4', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Anvil'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') {
        const copper = req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
        return JSON.stringify([copper]);
      }
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Anvil');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1); // the coin field
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Copper', 'Silver']);
    expect(names(state, INPLAY('p0'))).toEqual(['Anvil']);
  });
});

describe('Investment', () => {
  it('trashes a card, then +$1', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Investment'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'card') return req.cardIds[0];
      if (req.kind === 'option') return 'inv_coin';
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Investment');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1); // coin field 0 + $1
    expect(state.players[0].vars['dom_var_vp_tokens']).toBe(0);
    expect(count(state, TRASH)).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Investment']);
  });

  it('trashes itself for 1 VP per differently named Treasure in hand', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Investment'), dealNamed('Silver'), dealNamed('Estate'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
      }
      if (req.kind === 'option') return 'inv_trash';
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Investment');
    const state = engine.getState();
    expect(errors).toEqual([]);
    // The hand holds Coppers + the dealt Silver: exactly 2 distinct names
    // (three Coppers still count once — the mark sweep).
    expect(state.players[0].vars['dom_var_vp_tokens']).toBe(2);
    expect(names(state, TRASH).sort()).toEqual(['Estate', 'Investment']);
    expect(count(state, INPLAY('p0'))).toBe(0);
  });
});

describe('Quarry', () => {
  it('raises the global discount by 2; a Silver then costs $1', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Quarry'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Quarry');
    let state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.globalVars['dom_var_cost_discount']).toBe(2);
    // Silver costs 3; with the $2 discount the single coin pays for it.
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Silver'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(names(state, DISCARD('p0'))).toContain('Silver');
    // The discount fades with the turn.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.globalVars['dom_var_cost_discount']).toBe(0);
  });
});

describe('Tiara', () => {
  it('+1 Buy; plays a Treasure twice; topdecks a gained card on a yes', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Tiara'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'cards') {
        const copper = req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
        return JSON.stringify([copper]);
      }
      if (req.kind === 'yesNo') return true;
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Tiara');
    let state = engine.getState();
    expect(errors).toEqual([]);
    // The doubled Copper paid its coin field twice.
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Copper', 'Tiara']);
    // A bought card may hop onto the deck while Tiara is in play.
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Estate'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['cards', 'yesNo']);
    expect(topName(state, DECK('p0'))).toBe('Estate');
    expect(names(state, DISCARD('p0'))).not.toContain('Estate');
    expect(state.players[0].vars['dom_var_buys']).toBe(1);
  });
});

describe('Charlatan', () => {
  it('+$3 and the other player gains a Curse', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Charlatan'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Charlatan') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(names(state, DISCARD('p1'))).toContain('Curse');
    expect(names(state, SUPPLY).filter((n) => n === 'Curse')).toHaveLength(9);
  });

  it('a revealed Moat waves the Curse off', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Charlatan'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Charlatan') });
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3); // coins still pay
    expect(names(state, DISCARD('p1'))).not.toContain('Curse');
    expect(names(state, SUPPLY).filter((n) => n === 'Curse')).toHaveLength(10);
  });
});

describe('Collection', () => {
  it('$2 +1 Buy; banks 1 VP per Action gained while in play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Collection'), dealNamed('Copper'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Collection');
    await playTreasure(engine, 'p0', 'Copper');
    let state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(3); // $2 field + Copper
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    // Buying the Action banks a chip…
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Village'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp_tokens']).toBe(1);
    // …but a non-Action buy does not.
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp_tokens']).toBe(1);
    expect(names(state, DISCARD('p0'))).toContain('Village');
  });
});

describe('Crystal Ball', () => {
  it('may PLAY a looked-at Action without spending an Action', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Crystal Ball'), fromReserve('Monument', 'dom_zone_deck'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'cb_play';
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Crystal Ball');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'option' }>;
    expect(req.options.map((o) => o.id))
      .toEqual(['cb_back', 'cb_trash', 'cb_discard', 'cb_play']);
    // $1 from the coin field + the Monument's +$2, plus its VP chip.
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_vp_tokens']).toBe(1);
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Crystal Ball', 'Monument']);
    expect(count(state, DECK('p0'))).toBe(5);
  });

  it('a Victory card offers no play option; discarding it works', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Crystal Ball'), dealNamed('Estate', 'dom_zone_deck'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'cb_discard';
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Crystal Ball');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'option' }>;
    expect(req.options.map((o) => o.id)).toEqual(['cb_back', 'cb_trash', 'cb_discard']);
    expect(names(state, DISCARD('p0'))).toEqual(['Estate']);
    expect(count(state, DECK('p0'))).toBe(5);
  });
});
