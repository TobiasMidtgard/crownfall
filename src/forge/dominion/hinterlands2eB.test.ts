/**
 * Hinterlands 2E (part B) — deterministic per-card probes through the REAL
 * engine: the set's signature on-gain effects (Berserker's self-play, Inn's
 * discard-pile shuffle, Souk's trash, Border Village's bonus gain, Farmland's
 * on-buy remodel) ride the module's 'gain'/'buy' cardEnterZone watchers;
 * Cauldron's third-Action fuse and its Moat ward; Highway's global discount;
 * Haggler's while-in-play buy bonus; and the two stacked hand attacks
 * (Berserker / Margrave, Moat-blockable).
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers hinterlands2eB, freshDef() can
 * become a plain static `buildDominionDef` import.
 */
import { describe, expect, it } from 'vitest';
import type { Block, ChoiceRequest, EngineHandle, Expr, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { hinterlands2eB } from './hinterlands2eB';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(hinterlands2eB)) EXPANSIONS.push(hinterlands2eB);
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
const LOOK = 'dom_zone_look';

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');

const nameIsExpr = (name: string): Expr => ({
  kind: 'compare', op: '==',
  left: { kind: 'cardField', card: { kind: 'binding', name: '$card' }, fieldId: 'name' },
  right: { kind: 'str', value: name },
});
/** Setup block promoting a whole reserve pile into the live supply. */
const pileToSupply = (name: string): Block => ({
  kind: 'moveCards',
  from: { zoneId: 'dom_zone_reserve', owner: null },
  to: { zoneId: 'dom_zone_supply', owner: null },
  cards: { kind: 'filter', filter: nameIsExpr(name) },
  toPosition: 'top',
  faceUp: true,
});

const play = { actionId: 'dom_action_play' };
const noChoices = () => { throw new Error('no choices expected'); };

/** Give the buy-phase probes a fixed purse without playing treasures. */
function setStartingCoins(def: GameDef, coins: number): void {
  def.variables.find((v) => v.id === 'dom_var_coins')!.initial = coins;
}

/** Skip to the buy phase and play the named card via the treasure action. */
async function playTreasure(engine: EngineHandle, pid: string, name: string): Promise<void> {
  const state = engine.getState();
  await engine.performAction(pid, {
    actionId: 'dom_action_treasure', cardId: findNamed(state, HAND(pid), name),
  });
}

describe('hinterlands2eB module registration', () => {
  it('validates clean and knows all thirteen cards with costs, types and pile sizes', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Berserker: 5, Cartographer: 5, Cauldron: 5, Haggler: 5, Highway: 5,
      Inn: 5, Margrave: 5, Souk: 5, Stables: 5, Wheelwright: 5,
      "Witch's Hut": 5, 'Border Village': 6, Farmland: 6,
    };
    const kingdomDeck = def.decks.find((d) => d.id === 'dom_deck_kingdom')!;
    expect(kingdomDeck.source.kind).toBe('custom');
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
      const entry = (kingdomDeck.source as Extract<GameDef['decks'][number]['source'], { kind: 'custom' }>)
        .entries.find((en) => en.cardId === card!.id);
      expect(entry?.count, `${name} pile of 10`).toBe(10);
    }
    // Type lines: four attacks; Cauldron is a Treasure-typed attack; Farmland
    // is Victory-typed worth 2 VP; everything else stays an Action.
    for (const name of ['Berserker', 'Cauldron', 'Margrave', "Witch's Hut"]) {
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} is an Attack`)
        .toContain('dom_tag_attack');
    }
    const cauldron = def.cards.find((c) => c.name === 'Cauldron')!;
    expect(cauldron.typeId).toBe('dom_type_treasure');
    expect(cauldron.fields['dom_field_coins']).toBe(2);
    const farmland = def.cards.find((c) => c.name === 'Farmland')!;
    expect(farmland.typeId).toBe('dom_type_victory');
    expect(farmland.fields['dom_field_vp']).toBe(2);
    for (const name of ['Cartographer', 'Haggler', 'Highway', 'Inn', 'Souk', 'Stables', 'Wheelwright', 'Border Village']) {
      expect(def.cards.find((c) => c.name === name)!.typeId, `${name} is an Action`)
        .toBe('dom_type_action');
    }
    // The picker's catalog files them under Hinterlands.
    const { kingdomCatalog } = await import('../dominionGame');
    const catalog = kingdomCatalog(def);
    for (const name of Object.keys(costs)) {
      expect(catalog.find((e) => e.name === name)?.expansion, `${name} in Hinterlands`).toBe('Hinterlands');
    }
  });
});

describe('Berserker', () => {
  it('played: gains a cheaper card and the opponent discards down to 3', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Berserker'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'pile') {
        // Everything offered must cost less than 5 (printed costs).
        for (const id of req.cardIds) {
          expect(state.cards[id].fields['dom_field_cost']).toBeLessThan(5);
        }
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      if (req.kind === 'cards') return JSON.stringify(req.cardIds.slice(0, 2));
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Berserker') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(requests.map((r) => r.kind)).toEqual(['pile', 'cards']);
    expect(requests[1].playerId).toBe('p1');
    expect(names(state, DISCARD('p0'))).toContain('Silver');
    expect(names(state, INPLAY('p0'))).toEqual(['Berserker']);
    expect(count(state, HAND('p1'))).toBe(3);
    expect(count(state, DISCARD('p1'))).toBe(2);
  });

  it('on gain with an Action in play: plays itself straight from the buy', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Berserker'), dealNamed('Village'));
    setStartingCoins(def, 5);
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      if (req.kind === 'cards') return JSON.stringify(req.cardIds.slice(0, 2));
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    // Village first, so an Action is in play when the Berserker is bought.
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Berserker'),
    });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(state.players[0].vars['dom_var_coins']).toBe(0); // 5 - 5
    expect(state.log.some((l) => l.text.includes('charges in at once'))).toBe(true);
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Berserker', 'Village']);
    expect(names(state, DISCARD('p0'))).toContain('Silver'); // its on-play gain
    expect(count(state, HAND('p1'))).toBe(3); // the attack still landed
  });

  it('on gain with NO Action in play: stays in the discard pile', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Berserker'));
    setStartingCoins(def, 5);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Berserker'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(names(state, DISCARD('p0'))).toEqual(['Berserker']);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(count(state, HAND('p1'))).toBe(5); // no attack fired
  });
});

describe('Cartographer', () => {
  it('+1 Card +1 Action; discards 2 of the top 4 and puts the rest back', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Cartographer'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, 2));
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Cartographer') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.min).toBe(0);
    expect(req.max).toBe(4);
    expect(req.cardIds).toHaveLength(4);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Cartographer + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(count(state, DISCARD('p0'))).toBe(2);
    expect(count(state, DECK('p0'))).toBe(2); // 5 - 1 drawn - 4 looked + 2 back
    expect(count(state, LOOK)).toBe(0);
  });
});

describe('Cauldron', () => {
  it('$2 +1 Buy; the third Action gained this turn curses the opponent once', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Cauldron'),
      dealNamed('Village'), dealNamed('Workshop'), dealNamed('Workshop'),
    );
    setStartingCoins(def, 4);
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'pile') {
        // Both Workshops gain a Village — Action gains #1 and #2.
        return req.cardIds.find((id) => state.cards[id].name === 'Village')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Workshop') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Workshop') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_cauldron_actions']).toBe(2);
    expect(names(state, DISCARD('p1'))).not.toContain('Curse'); // no Cauldron in play yet
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Cauldron');
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(6); // 4 + the $2 field
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    // Buying the Cellar is Action gain #3 — the cauldron boils over.
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Cellar'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p1')).filter((n) => n === 'Curse')).toHaveLength(1);
    // Action gain #4 adds no second Curse.
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Cellar'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_cauldron_actions']).toBe(4);
    expect(names(state, DISCARD('p1')).filter((n) => n === 'Curse')).toHaveLength(1);
    // The fuse resets with the turn.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_cauldron_actions']).toBe(0);
  });

  it('a Moat revealed to the played Cauldron wards off the later curse', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Cauldron'),
      dealNamed('Village'), dealNamed('Workshop'), dealNamed('Workshop'),
      dealNamed('Moat', 'dom_zone_hand', 'p1'),
    );
    setStartingCoins(def, 4);
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Village')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Workshop') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Workshop') });
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Cauldron');
    await playOutWindows(engine, 'p1'); // p1 reveals the Moat
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[1].vars['dom_var_cauldron_ward']).toBe(1);
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Cellar'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_cauldron_actions']).toBe(3);
    expect(names(state, DISCARD('p1'))).not.toContain('Curse'); // warded
  });
});

describe('Haggler', () => {
  it('+$2; a buy while it is in play gains a cheaper non-Victory card', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Haggler'));
    setStartingCoins(def, 3);
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      // Only non-Victory piles cheaper than the bought Silver ($3) qualify.
      const offered = req.cardIds.map((id) => state.cards[id].name);
      expect(offered).not.toContain('Estate');
      return req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Haggler') });
    let state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(5); // 3 + 2
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Silver'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // the haggle is free
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Copper', 'Silver']);
  });
});

describe('Highway', () => {
  it('+1 Card +1 Action and a $1 global discount that fades at cleanup', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Highway'));
    setStartingCoins(def, 2);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Highway') });
    let state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(6);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.globalVars['dom_var_cost_discount']).toBe(1);
    // Silver costs 3; with the $1 discount the $2 purse pays for it.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Silver'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(names(state, DISCARD('p0'))).toContain('Silver');
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.globalVars['dom_var_cost_discount']).toBe(0);
  });
});

describe('Inn', () => {
  it('+2 Cards +2 Actions, then discards exactly 2', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Inn'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, 2));
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Inn') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.min).toBe(2);
    expect(req.max).toBe(2);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Inn + 2 - 2
    expect(state.players[0].vars['dom_var_actions']).toBe(2);
    expect(count(state, DISCARD('p0'))).toBe(2);
  });

  it('on gain: shuffles chosen Actions (itself included) from the discard into the deck', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Inn'), dealNamed('Village', 'dom_zone_discard', 'p0'));
    setStartingCoins(def, 5);
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      // Both Actions in the discard — the Village AND the just-bought Inn.
      const offered = req.cardIds.map((id) => state.cards[id].name).sort();
      expect(offered).toEqual(['Inn', 'Village']);
      return JSON.stringify(req.cardIds);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Inn'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(names(state, DECK('p0'))).toContain('Inn');
    expect(names(state, DECK('p0'))).toContain('Village');
    expect(count(state, DECK('p0'))).toBe(7); // 5 + the two shuffled in
    expect(count(state, DISCARD('p0'))).toBe(0);
  });
});

describe('Margrave', () => {
  it('+3 Cards +1 Buy; the opponent draws one then discards down to 3', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Margrave'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, 3));
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Margrave') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Margrave + 3
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(requests).toHaveLength(1);
    expect(requests[0].playerId).toBe('p1');
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.min).toBe(3); // 6 cards after the draw, keep 3
    expect(count(state, HAND('p1'))).toBe(3);
    expect(count(state, DISCARD('p1'))).toBe(3);
  });

  it('a revealed Moat blocks both the draw and the discard', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Margrave'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Margrave') });
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(6); // 5 + the dealt Moat, untouched
    expect(count(state, DISCARD('p1'))).toBe(0);
    expect(count(state, HAND('p0'))).toBe(8); // the owner still draws
  });
});

describe('Souk', () => {
  it('+1 Buy and +$7 minus $1 per card left in hand', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Souk'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Souk') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    // 5 cards left after playing Souk: +$7 - $5 = +$2.
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
  });

  it('the coin delta floors at $0 with a huge hand', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Souk'),
      dealNamed('Copper'), dealNamed('Copper'), dealNamed('Copper'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Souk') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // 8 cards left in hand: 7 - 8 < 0 → the delta clamps to +$0.
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
  });

  it('on gain: trashes up to 2 cards from the hand', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Souk'));
    setStartingCoins(def, 5);
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, 2));
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Souk'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, TRASH)).toBe(2);
    expect(count(state, HAND('p0'))).toBe(3);
    expect(names(state, DISCARD('p0'))).toEqual(['Souk']);
  });
});

describe('Stables', () => {
  it('discarding a Treasure buys +3 Cards and +1 Action', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Stables'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const copper = req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
      return JSON.stringify([copper]);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Stables') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Stables - Copper + 3
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(names(state, DISCARD('p0'))).toEqual(['Copper']);
  });
});

describe('Wheelwright', () => {
  it('+1 Card +1 Action; discarding a card gains an Action costing up to it', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Wheelwright'), dealNamed('Silver'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'cards') {
        const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
        return JSON.stringify([silver]);
      }
      if (req.kind === 'pile') {
        // Only Action piles costing up to the Silver's $3 qualify.
        for (const id of req.cardIds) {
          expect(state.cards[id].fields['dom_field_cost']).toBeLessThanOrEqual(3);
        }
        return req.cardIds.find((id) => state.cards[id].name === 'Village')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Wheelwright') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['cards', 'pile']);
    expect(count(state, HAND('p0'))).toBe(6); // 7 - Wheelwright + 1 - Silver
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Silver', 'Village']);
  });
});

describe("Witch's Hut", () => {
  it('+4 Cards; two Action discards send the opponent a Curse', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve("Witch's Hut"), dealNamed('Village'), dealNamed('Village'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const villages = req.cardIds.filter((id) => state.cards[id].name === 'Village');
      return JSON.stringify(villages.slice(0, 2));
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), "Witch's Hut") });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(count(state, HAND('p0'))).toBe(9); // 8 - Hut + 4 - 2
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Village', 'Village']);
    expect(state.log.some((l) => l.text.includes('revealed'))).toBe(true);
    expect(names(state, DISCARD('p1'))).toContain('Curse');
  });

  it('a mixed discard pair sends no Curse', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve("Witch's Hut"), dealNamed('Village'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const village = req.cardIds.find((id) => state.cards[id].name === 'Village')!;
      const copper = req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
      return JSON.stringify([village, copper]);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), "Witch's Hut") });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p1'))).not.toContain('Curse');
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Copper', 'Village']);
  });
});

describe('Border Village', () => {
  it('+1 Card +2 Actions on play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Border Village'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Border Village') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6);
    expect(state.players[0].vars['dom_var_actions']).toBe(2);
  });

  it('on gain: gains a cheaper card too', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Border Village'));
    setStartingCoins(def, 6);
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      for (const id of req.cardIds) {
        expect(state.cards[id].fields['dom_field_cost']).toBeLessThan(6);
      }
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Border Village'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Border Village', 'Silver']);
  });
});

describe('Farmland', () => {
  it('on buy: trashes a hand card and gains a non-Farmland card costing exactly $2 more', async () => {
    const def = await freshDef();
    // A Smithy ($4) in hand makes the exact-cost target $6 — the price band
    // where the Farmland pile itself must be excluded from the gain.
    def.setup.push(pileToSupply('Farmland'), dealNamed('Smithy'));
    setStartingCoins(def, 6);
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Smithy')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Farmland'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    // Gold is the ONLY exactly-$6 pile once Farmland is excluded, so the
    // gain auto-resolves without a pile request — the auto-resolution itself
    // proves the "never another Farmland" filter (two piles would prompt).
    expect(requests.map((r) => r.kind)).toEqual(['card']);
    expect(state.log.some((l) => l.text.includes('only one option'))).toBe(true);
    expect(names(state, TRASH)).toEqual(['Smithy']);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Farmland', 'Gold']);
    // The recount at turn end scores the Farmland's 2 VP.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp']).toBe(5); // 3 Estates + Farmland
  });
});
