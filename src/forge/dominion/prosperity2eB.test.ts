/**
 * Prosperity 2E (part B) — deterministic per-card probes through the REAL
 * engine: Magnate, Mint (both halves), Rabble (hit + Moat), Vault, War
 * Chest, Grand Market, Hoard, Bank, Expand, Forge (incl. the zero-total
 * ruling), King's Court, Peddler.
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers prosperity2eB, freshDef() can
 * become a plain static `buildDominionDef` import.
 */
import { describe, expect, it } from 'vitest';
import type { GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { MINT_VAR, WARCHEST_VAR, prosperity2eB } from './prosperity2eB';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(prosperity2eB)) EXPANSIONS.push(prosperity2eB);
/** buildDominionDef AFTER registration (see the header note). */
async function freshDef(): Promise<GameDef> {
  const { buildDominionDef } = await import('../dominionGame');
  return buildDominionDef();
}

const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';
const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');

const play = { actionId: 'dom_action_play' };
const noChoices = () => { throw new Error('no choices expected'); };

describe('prosperity2eB module registration', () => {
  it('validates clean and knows all twelve cards with their costs and types', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Magnate: 5, Mint: 5, Rabble: 5, Vault: 5, 'War Chest': 5,
      'Grand Market': 6, Hoard: 6, Bank: 7, Expand: 7, Forge: 7,
      "King's Court": 7, Peddler: 8,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
    }
    // Type lines: three Treasures, one Attack, the rest plain Actions.
    for (const treasure of ['Bank', 'Hoard', 'War Chest']) {
      expect(def.cards.find((c) => c.name === treasure)!.typeId).toBe('dom_type_treasure');
    }
    expect(def.cards.find((c) => c.name === 'Rabble')!.tags).toContain('dom_tag_attack');
    expect(def.cards.find((c) => c.name === 'Rabble')!.typeId).toBe('dom_type_action');
    expect(def.cards.find((c) => c.name === "King's Court")!.typeId).toBe('dom_type_action');
    // Hoard's printed $2 rides the coin field.
    expect(def.cards.find((c) => c.name === 'Hoard')!.fields['dom_field_coins']).toBe(2);
    // Twelve piles of 10 in the module's catalogue.
    expect(prosperity2eB.piles).toHaveLength(12);
    for (const pile of prosperity2eB.piles) expect(pile.count).toBe(10);
  });
});

describe('Magnate', () => {
  it('reveals the hand and draws +1 Card per Treasure in it', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Magnate'), dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(7); // 5 drawn + Magnate + Silver
    const deckBefore = count(state, DECK('p0')); // 5
    // Treasures that will be in hand AFTER Magnate leaves it.
    const treasures = names(state, HAND('p0'))
      .filter((n) => n === 'Copper' || n === 'Silver' || n === 'Gold').length;
    const expectedDraw = Math.min(treasures, deckBefore);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Magnate') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes('reveals their hand'))).toBe(true);
    expect(count(state, HAND('p0'))).toBe(7 - 1 + expectedDraw);
    expect(names(state, INPLAY('p0'))).toEqual(['Magnate']);
  });
});

describe('Mint', () => {
  it('on play: reveals a Treasure from hand and gains a supply copy', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Mint'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const copper = req.cardIds.find((id) => state.cards[id].name === 'Copper');
      if (!copper) throw new Error('no Copper offered to reveal');
      return JSON.stringify([copper]);
    });
    await engine.start();
    let state = engine.getState();
    const coppersInSupply = names(state, SUPPLY).filter((n) => n === 'Copper').length;
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Mint') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars[MINT_VAR]).toBe('Copper');
    // The revealed Copper STAYS in hand; the gained copy lands in the discard.
    expect(names(state, DISCARD('p0'))).toEqual(['Copper']);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Mint, nothing else moved
    expect(names(state, SUPPLY).filter((n) => n === 'Copper')).toHaveLength(coppersInSupply - 1);
  });

  it('on buy: trashes all the buyer’s Treasures in play', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Mint', 'dom_zone_supply'), // one buyable Mint in the supply
      dealNamed('Gold'),
      dealNamed('Gold'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Gold'),
    });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Gold'),
    });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(6);
    expect(names(state, INPLAY('p0'))).toEqual(['Gold', 'Gold']);
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Mint'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Gold', 'Gold']); // both trashed
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(names(state, DISCARD('p0'))).toEqual(['Mint']);
    expect(state.players[0].vars['dom_var_coins']).toBe(1); // 6 - 5
  });
});

describe('Rabble', () => {
  it('+3 Cards; the victim discards revealed Actions/Treasures, the rest go back', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Rabble'),
      // Dealt bottom-up: the LAST deal sits on top → reveal order
      // Copper, Duchy, Silver.
      dealNamed('Silver', 'dom_zone_deck', 'p1'),
      dealNamed('Duchy', 'dom_zone_deck', 'p1'),
      dealNamed('Copper', 'dom_zone_deck', 'p1'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    expect(count(state, DECK('p1'))).toBe(8); // 5 + the 3 dealt
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Rabble') });
    await playOutWindows(engine); // nobody reveals a Moat
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Rabble + 3 drawn
    // Copper + Silver discarded; the Duchy went back on top of the deck.
    expect(names(state, DISCARD('p1'))).toHaveLength(2);
    expect(names(state, DISCARD('p1'))).toContain('Copper');
    expect(names(state, DISCARD('p1'))).toContain('Silver');
    const deck = state.zones[DECK('p1')].cardIds;
    expect(deck).toHaveLength(6); // 8 - 3 revealed + 1 back
    expect(state.cards[deck[deck.length - 1]].name).toBe('Duchy');
  });

  it('a revealed Moat blocks the reveal-and-discard entirely', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Rabble'),
      dealNamed('Moat', 'dom_zone_hand', 'p1'),
      dealNamed('Silver', 'dom_zone_deck', 'p1'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Rabble') });
    expect(engine.getState().window).not.toBeNull();
    await playOutWindows(engine, 'p1'); // p1 reveals the Moat
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // the draw half still fires
    expect(count(state, DECK('p1'))).toBe(6); // untouched
    expect(count(state, DISCARD('p1'))).toBe(0);
    expect(state.players[1].vars['dom_var_immune']).toBe(0); // reset per attack
  });
});

describe('Vault', () => {
  it('+2 Cards, +$1 per discard; the opponent trades 2 discards for a draw', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Vault'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'cards' && req.playerId === 'p0') return JSON.stringify(req.cardIds.slice(0, 2));
      if (req.kind === 'option' && req.playerId === 'p1') return 'vault_yes';
      if (req.kind === 'cards' && req.playerId === 'p1') {
        expect(req.min).toBe(2);
        expect(req.max).toBe(2);
        return JSON.stringify(req.cardIds.slice(0, 2));
      }
      throw new Error(`unexpected ${req.kind} choice for ${req.playerId}`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Vault') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Vault + 2 drawn - 2 discarded
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // +$1 per discard
    expect(count(state, DISCARD('p0'))).toBe(2);
    expect(count(state, HAND('p1'))).toBe(4); // 5 - 2 + 1 drawn
    expect(count(state, DISCARD('p1'))).toBe(2);
  });
});

describe('War Chest', () => {
  it('the opponent names a card; the owner gains up to 5 excluding it', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('War Chest'));
    const gainOffers: string[][] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      if (req.playerId === 'p1') {
        const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver');
        if (!silver) throw new Error('no Silver pile to name');
        return silver;
      }
      gainOffers.push(req.cardIds.map((id) => state.cards[id].name));
      const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate');
      if (!estate) throw new Error('no Estate pile offered');
      return estate;
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'War Chest'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars[WARCHEST_VAR]).toBe('Silver');
    expect(state.players[0].vars['dom_var_coins']).toBe(0); // worth no coins itself
    // The gain offer: everything costing <= 5 EXCEPT the named Silver.
    expect(gainOffers).toHaveLength(1);
    expect(gainOffers[0]).not.toContain('Silver');
    expect(gainOffers[0]).not.toContain('Gold'); // 6 > 5
    expect(gainOffers[0]).toContain('Estate');
    expect(names(state, DISCARD('p0'))).toEqual(['Estate']);
    expect(names(state, INPLAY('p0'))).toEqual(['War Chest']);
  });
});

describe('Grand Market', () => {
  it('+1 Card +1 Action +1 Buy +$2', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Grand Market'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Grand Market') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - played + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
  });
});

describe('Hoard', () => {
  it('buying a Victory card with Hoard in play gains a Gold; a non-Victory buy does not', async () => {
    // Victory buy: the Estate arrives with a Gold alongside.
    const def1 = await freshDef();
    def1.setup.push(fromReserve('Hoard'));
    const probe1 = probeEngine(def1, noChoices);
    await probe1.engine.start();
    await probe1.engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = probe1.engine.getState();
    await probe1.engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Hoard'),
    });
    state = probe1.engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // the printed $2
    await probe1.engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Estate'),
    });
    state = probe1.engine.getState();
    expect(probe1.errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toHaveLength(2);
    expect(names(state, DISCARD('p0'))).toContain('Estate');
    expect(names(state, DISCARD('p0'))).toContain('Gold');

    // Non-Victory buy: no Gold.
    const def2 = await freshDef();
    def2.setup.push(fromReserve('Hoard'));
    const probe2 = probeEngine(def2, noChoices);
    await probe2.engine.start();
    await probe2.engine.performAction('p0', { actionId: 'dom_action_done' });
    state = probe2.engine.getState();
    await probe2.engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Hoard'),
    });
    state = probe2.engine.getState();
    await probe2.engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = probe2.engine.getState();
    expect(probe2.errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Copper']);
  });
});

describe('Bank', () => {
  it('pays +$1 per Treasure in play, counting itself', async () => {
    // Two Coppers first: Bank counts three Treasures.
    const def1 = await freshDef();
    def1.setup.push(fromReserve('Bank'), dealNamed('Copper'), dealNamed('Copper'));
    const probe1 = probeEngine(def1, noChoices);
    await probe1.engine.start();
    await probe1.engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = probe1.engine.getState();
    await probe1.engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Copper'),
    });
    state = probe1.engine.getState();
    await probe1.engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Copper'),
    });
    state = probe1.engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    await probe1.engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Bank'),
    });
    state = probe1.engine.getState();
    expect(probe1.errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(5); // 2 + 3 (Bank counts itself)

    // Bank alone: exactly $1.
    const def2 = await freshDef();
    def2.setup.push(fromReserve('Bank'));
    const probe2 = probeEngine(def2, noChoices);
    await probe2.engine.start();
    await probe2.engine.performAction('p0', { actionId: 'dom_action_done' });
    state = probe2.engine.getState();
    await probe2.engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Bank'),
    });
    state = probe2.engine.getState();
    expect(probe2.errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
  });
});

describe('Expand', () => {
  it('trashes a card and gains one costing up to 3 more', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Expand'), dealNamed('Estate'));
    const pileOffers: string[][] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card') {
        const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate');
        if (!estate) throw new Error('no Estate offered to trash');
        return estate;
      }
      if (req.kind === 'pile') {
        pileOffers.push(req.cardIds.map((id) => state.cards[id].name));
        const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver');
        if (!silver) throw new Error('no Silver pile offered');
        return silver;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Expand') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Estate']);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
    // The window is 2 + 3 = 5: Gold (6) must not be offered, Duchy (5) is.
    expect(pileOffers).toHaveLength(1);
    expect(pileOffers[0]).not.toContain('Gold');
    expect(pileOffers[0]).toContain('Duchy');
  });
});

describe('Forge', () => {
  it('trashes any number and gains a card of exactly the total cost', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Forge'), dealNamed('Estate'), dealNamed('Silver'));
    const pileOffers: string[][] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') {
        const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
        const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
        return JSON.stringify([estate, silver]); // 2 + 3 = 5
      }
      if (req.kind === 'pile') {
        pileOffers.push(req.cardIds.map((id) => state.cards[id].name));
        const duchy = req.cardIds.find((id) => state.cards[id].name === 'Duchy');
        if (!duchy) throw new Error('no Duchy pile offered');
        return duchy;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Forge') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toHaveLength(2);
    expect(names(state, TRASH)).toContain('Estate');
    expect(names(state, TRASH)).toContain('Silver');
    expect(names(state, DISCARD('p0'))).toEqual(['Duchy']);
    // EXACT cost 5 — nothing cheaper or dearer was offered.
    expect(pileOffers).toHaveLength(1);
    expect(pileOffers[0]).not.toContain('Silver'); // 3
    expect(pileOffers[0]).not.toContain('Gold');   // 6
    expect(pileOffers[0]).toContain('Duchy');      // 5
  });

  it('trashing nothing mandates gaining a $0 card (the paper ruling)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Forge'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') return JSON.stringify([]); // trash nothing
      if (req.kind === 'pile') {
        // Only the $0 piles qualify.
        const offered = req.cardIds.map((id) => state.cards[id].name).sort();
        expect(offered).toEqual(['Copper', 'Curse']);
        const copper = req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
        return copper;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Forge') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, TRASH)).toBe(0);
    expect(names(state, DISCARD('p0'))).toEqual(['Copper']);
  });
});

describe("King's Court", () => {
  it('plays the chosen Action three times (one entry + two replays)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve("King's Court"), dealNamed('Village'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const village = req.cardIds.find((id) => state.cards[id].name === 'Village');
      if (!village) throw new Error('no Village offered');
      return JSON.stringify([village]);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), "King's Court") });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes("three times with King's Court"))).toBe(true);
    // 7 - KC - Village + 3 drawn (one per Village play).
    expect(count(state, HAND('p0'))).toBe(8);
    // 1 - 1 (KC) + 2 per Village play = 6.
    expect(state.players[0].vars['dom_var_actions']).toBe(6);
    // The Village entered play ONCE — no extra copies materialised.
    expect(names(state, INPLAY('p0')).sort()).toEqual(["King's Court", 'Village']);
  });

  it('declining the pick is legal ("you may")', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve("King's Court"), dealNamed('Village'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify([]);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), "King's Court") });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, INPLAY('p0'))).toEqual(["King's Court"]);
    expect(names(state, HAND('p0'))).toContain('Village'); // still in hand
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
  });
});

describe('Peddler', () => {
  it('costs a flat 8 (documented deviation) and grants +1 Card +1 Action +$1', async () => {
    const def = await freshDef();
    expect(def.cards.find((c) => c.name === 'Peddler')!.fields['dom_field_cost']).toBe(8);
    def.setup.push(fromReserve('Peddler'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Peddler') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - played + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
  });
});
