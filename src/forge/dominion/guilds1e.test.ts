/**
 * Guilds 1E — deterministic per-card probes through the REAL engine,
 * including the on-buy overpay loops (a 'buy'-tagged trigger asking "pay $1
 * more?" — see the module's deviation register), the Coffers bank (banked by
 * the cards, spent through the core dom_action_spend_coffer), Baker's
 * one-shot setup trigger and the two stacked attacks (Moat-blockable).
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers guilds1e, freshDef() can become
 * a plain static `buildDominionDef` import.
 */
import { describe, expect, it } from 'vitest';
import type { Block, ChoiceRequest, Expr, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { guilds1e } from './guilds1e';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(guilds1e)) EXPANSIONS.push(guilds1e);
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
/** Top of a stack zone = the END of the cardIds array. */
const topName = (state: GameState, zoneKey: string): string | undefined =>
  names(state, zoneKey).at(-1);
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

describe('guilds1e module registration', () => {
  it('validates clean and knows all thirteen cards with costs, types and pile sizes', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      'Candlestick Maker': 2, Stonemason: 2, Doctor: 3, Masterpiece: 3,
      Advisor: 4, Herald: 4, Plaza: 4, Taxman: 4,
      Baker: 5, Butcher: 5, Journeyman: 5, 'Merchant Guild': 5, Soothsayer: 5,
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
    // Type lines: two attacks, one Treasure-typed card, the rest Actions.
    for (const name of ['Taxman', 'Soothsayer']) {
      expect(def.cards.find((c) => c.name === name)!.tags).toContain('dom_tag_attack');
    }
    expect(def.cards.find((c) => c.name === 'Masterpiece')!.typeId).toBe('dom_type_treasure');
    expect(def.cards.find((c) => c.name === 'Candlestick Maker')!.typeId).toBe('dom_type_action');
    expect(def.cards.find((c) => c.name === 'Merchant Guild')!.typeId).toBe('dom_type_action');
    // The picker's catalog files them under Guilds.
    const { kingdomCatalog } = await import('../dominionGame');
    const catalog = kingdomCatalog(def);
    for (const name of Object.keys(costs)) {
      expect(catalog.find((e) => e.name === name)?.expansion, `${name} in Guilds`).toBe('Guilds');
    }
  });
});

describe('Candlestick Maker', () => {
  it('+1 Action +1 Buy +1 Coffers; the banked token is spent via the core action', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Candlestick Maker'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Candlestick Maker') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coffers']).toBe(1);
    // The CORE spend action cashes the token in the buy phase.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_spend_coffer' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coffers']).toBe(0);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
  });
});

describe('Stonemason', () => {
  it('trashes a hand card and gains 2 cards each costing less than it', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Stonemason'), dealNamed('Silver'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      if (req.kind === 'pile') {
        // "Less than 3": the Silver pile itself (cost 3) must not be offered.
        expect(req.cardIds.map((id) => state.cards[id].name)).not.toContain('Silver');
        return req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Stonemason') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['card', 'pile', 'pile']);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(names(state, DISCARD('p0'))).toEqual(['Estate', 'Estate']);
  });

  it('overpay on buy: each accepted $1 raises the amount; gains 2 exact-cost Actions', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Stonemason'));
    setStartingCoins(def, 6);
    let yesCount = 0;
    const pilePicks: string[] = [];
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'yesNo') {
        yesCount += 1;
        return yesCount <= 2; // overpay exactly $2, then stop
      }
      if (req.kind === 'pile') {
        // Exactly-$2 Action piles on this table: Cellar, Moat — and the
        // promoted Stonemason pile itself (cost 2, Action).
        const offered = req.cardIds.map((id) => state.cards[id].name).sort();
        expect(offered).toEqual(['Cellar', 'Moat', 'Stonemason']);
        const pick = pilePicks.length === 0 ? 'Cellar' : 'Moat';
        pilePicks.push(pick);
        return req.cardIds.find((id) => state.cards[id].name === pick)!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Stonemason'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    // $6 - $2 (Stonemason) - $2 (overpay); the third ask was declined.
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(requests.filter((r) => r.kind === 'yesNo')).toHaveLength(3);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Cellar', 'Moat', 'Stonemason']);
  });
});

describe('Doctor', () => {
  it('names a supply card, reveals 3, trashes the matches and puts the rest back', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Doctor'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
    });
    await engine.start();
    const state0 = engine.getState();
    expect(topName(state0, DECK('p0'))).toBe('Copper');
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Doctor') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Copper', 'Copper']);
    expect(topName(state, DECK('p0'))).toBe('Estate'); // the non-match went back
    expect(count(state, LOOK)).toBe(0);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Doctor, nothing drawn
  });

  it('overpay on buy: each $1 examines the top card (trash / discard / put back)', async () => {
    const def = await freshDef();
    def.setup.push(
      pileToSupply('Doctor'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'),
      dealNamed('Curse', 'dom_zone_deck', 'p0'),
    );
    setStartingCoins(def, 5);
    const requests: ChoiceRequest[] = [];
    let optionCount = 0;
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind === 'yesNo') return true; // the purse (not the answers) ends the loop
      if (req.kind === 'option') {
        optionCount += 1;
        return optionCount === 1 ? 'doc_trash' : 'doc_discard';
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    expect(topName(state, DECK('p0'))).toBe('Curse');
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Doctor'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    // $5 - $3 (Doctor) - $2 (two overpay steps; the loop stops on the empty purse).
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(requests.map((r) => r.kind)).toEqual(['yesNo', 'option', 'yesNo', 'option']);
    expect(names(state, TRASH)).toEqual(['Curse']);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Doctor', 'Estate']);
    expect(count(state, LOOK)).toBe(0);
  });
});

describe('Masterpiece', () => {
  it('is a Treasure worth $1 through the core treasure action', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Masterpiece'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Masterpiece'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Masterpiece']);
  });

  it('overpay on buy: gains a Silver per $1 overpaid', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Masterpiece'));
    setStartingCoins(def, 5);
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return true; // keep paying until the purse is empty
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    const silversBefore = names(state, SUPPLY).filter((n) => n === 'Silver').length;
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Masterpiece'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(0); // 5 - 3 - 2 overpaid
    expect(requests).toHaveLength(2); // the third ask never comes: the purse is empty
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Masterpiece', 'Silver', 'Silver']);
    expect(names(state, SUPPLY).filter((n) => n === 'Silver')).toHaveLength(silversBefore - 2);
  });
});

describe('Advisor', () => {
  it('reveals 3; the opponent picks the discard; the rest join the hand', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Advisor'),
      dealNamed('Silver', 'dom_zone_deck', 'p0'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Advisor') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].playerId).toBe('p1'); // the one opponent chooses
    expect((requests[0] as Extract<ChoiceRequest, { kind: 'card' }>).revealed).toBe(true);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Advisor + Copper + Estate
    expect(names(state, HAND('p0'))).toContain('Estate');
    expect(count(state, LOOK)).toBe(0);
  });
});

describe('Herald', () => {
  it('+1 Card +1 Action, then plays a revealed Action straight off the deck', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Herald'),
      dealNamed('Village', 'dom_zone_deck', 'p0'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Herald') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // Draw took the Copper; the revealed Village was played for free.
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Herald', 'Village']);
    expect(state.players[0].vars['dom_var_actions']).toBe(3); // 1 - 1 + 1 + 2 (Village)
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Herald + Copper + Village's draw
  });

  it('overpay on buy: each $1 topdecks a card from the discard (the Herald itself works)', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Herald'));
    setStartingCoins(def, 5);
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'yesNo') return true;
      if (req.kind === 'cards') {
        return JSON.stringify([req.cardIds.find((id) => state.cards[id].name === 'Herald')!]);
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Herald'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    // $5 - $4 (Herald) - $1 (one overpay step; then the purse is empty).
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(requests.map((r) => r.kind)).toEqual(['yesNo', 'cards']);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(topName(state, DECK('p0'))).toBe('Herald');
  });
});

describe('Plaza', () => {
  it('+1 Card +2 Actions; discarding a Treasure banks a Coffers', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Plaza'), dealNamed('Silver'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify([req.cardIds.find((id) => state.cards[id].name === 'Silver')!]);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Plaza') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.min).toBe(0); // the discard is optional
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    expect(state.players[0].vars['dom_var_coffers']).toBe(1);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
    expect(count(state, HAND('p0'))).toBe(6); // 7 - Plaza + 1 drawn - Silver
  });
});

describe('Taxman', () => {
  it('trashes a Treasure; the 5-card opponent discards a copy; gains +$3 Treasure onto the deck', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Taxman'),
      dealNamed('Silver'),
      dealNamed('Silver', 'dom_zone_hand', 'p1'), // p1: 6 cards, holds a copy
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'cards') {
        return JSON.stringify([req.cardIds.find((id) => state.cards[id].name === 'Silver')!]);
      }
      if (req.kind === 'pile') {
        const offered = req.cardIds.map((id) => state.cards[id].name);
        expect(offered).toContain('Gold'); // cost 6 = 3 + 3, exactly at the cap
        expect(offered).not.toContain('Estate'); // Treasures only
        return req.cardIds.find((id) => state.cards[id].name === 'Gold')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Taxman') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(names(state, DISCARD('p1'))).toEqual(['Silver']); // the auto-picked copy
    expect(count(state, HAND('p1'))).toBe(5);
    expect(topName(state, DECK('p0'))).toBe('Gold'); // gained ONTO the deck
  });

  it('a revealed Moat blocks the discard but never the owner gain', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Taxman'),
      dealNamed('Silver'),
      dealNamed('Silver', 'dom_zone_hand', 'p1'),
      dealNamed('Moat', 'dom_zone_hand', 'p1'), // p1: 7 cards
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') {
        return JSON.stringify([req.cardIds.find((id) => state.cards[id].name === 'Silver')!]);
      }
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Gold')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Taxman') });
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(7); // untouched — immune
    expect(count(state, DISCARD('p1'))).toBe(0);
    expect(topName(state, DECK('p0'))).toBe('Gold'); // the gain is not an attack on them
    expect(state.players[1].vars['dom_var_immune']).toBe(0); // faded with the attack
  });
});

describe('Baker', () => {
  it('setup grants each player a Coffers when the pile is in the supply; play banks another', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Baker'), dealNamed('Baker'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    // The one-shot turnStart trigger fired for the first turn.
    expect(state.players[0].vars['dom_var_coffers']).toBe(1);
    expect(state.players[1].vars['dom_var_coffers']).toBe(1);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Baker') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Baker + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.players[0].vars['dom_var_coffers']).toBe(2);
  });

  it('without the Baker pile in the supply, nobody starts with a token', async () => {
    const def = await freshDef();
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coffers']).toBe(0);
    expect(state.players[1].vars['dom_var_coffers']).toBe(0);
  });
});

describe('Butcher', () => {
  it('banks 2 tokens; trashing + paying tokens raises the gain cap $1 each', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Butcher'), dealNamed('Silver'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'cards') {
        return JSON.stringify([req.cardIds.find((id) => state.cards[id].name === 'Silver')!]);
      }
      if (req.kind === 'yesNo') return true; // pay tokens until the bank runs dry
      if (req.kind === 'pile') {
        const offered = req.cardIds.map((id) => state.cards[id].name);
        expect(offered).toContain('Duchy'); // cost 5 = 3 + 2 tokens
        expect(offered).not.toContain('Gold'); // cost 6 — beyond the cap
        return req.cardIds.find((id) => state.cards[id].name === 'Duchy')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Butcher') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // 0 + 2 banked - 2 paid; the loop stopped by itself on the empty bank.
    expect(state.players[0].vars['dom_var_coffers']).toBe(0);
    expect(requests.filter((r) => r.kind === 'yesNo')).toHaveLength(2);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(names(state, DISCARD('p0'))).toEqual(['Duchy']);
  });
});

describe('Journeyman', () => {
  it('names a card, digs until 3 non-matches join the hand, discards the matches', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Journeyman'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Journeyman') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // Two named Coppers were revealed and discarded; three Estates joined the hand.
    expect(names(state, DISCARD('p0'))).toEqual(['Copper', 'Copper']);
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Journeyman + 3 dug up
    expect(names(state, HAND('p0')).filter((n) => n === 'Estate').length).toBeGreaterThanOrEqual(3);
    expect(count(state, LOOK)).toBe(0);
  });
});

describe('Merchant Guild', () => {
  it('+1 Buy +$1; while in play, every buy banks a Coffers', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Merchant Guild'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Merchant Guild') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.players[0].vars['dom_var_coffers']).toBe(0); // no buy yet
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coffers']).toBe(1);
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coffers']).toBe(2); // one per buy
    expect(state.players[0].vars['dom_var_buys']).toBe(0);
  });
});

describe('Soothsayer', () => {
  it('gains a Gold; the opponent gains a Curse and draws a card', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Soothsayer'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Soothsayer') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(names(state, DISCARD('p0'))).toEqual(['Gold']);
    expect(names(state, DISCARD('p1'))).toEqual(['Curse']);
    expect(count(state, HAND('p1'))).toBe(6); // 5 + the printed draw
    expect(names(state, SUPPLY).filter((n) => n === 'Curse')).toHaveLength(9);
  });

  it('a revealed Moat blocks the Curse (and its draw) but never the Gold', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Soothsayer'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Soothsayer') });
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Gold']);
    expect(count(state, DISCARD('p1'))).toBe(0);
    expect(count(state, HAND('p1'))).toBe(6); // 5 + the dealt Moat, no Curse draw
    expect(names(state, SUPPLY).filter((n) => n === 'Curse')).toHaveLength(10);
    expect(state.players[1].vars['dom_var_immune']).toBe(0);
  });
});
