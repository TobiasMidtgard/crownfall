/**
 * Alchemy (1E) — deterministic per-card probes through the REAL engine, plus
 * the core-integration potion proofs: pickKingdom auto-promotes the Potion
 * pile exactly when a picked card carries a potion cost, the buy action
 * enforces AND spends the potion half, and POTIONS resets at cleanup.
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers alchemy1e, freshDef() can
 * become a plain static `buildDominionDef` import.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest, EngineHandle, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { alchemy1e } from './alchemy1e';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(alchemy1e)) EXPANSIONS.push(alchemy1e);
/** buildDominionDef + kingdom helpers AFTER registration (header note). */
async function dominion(): Promise<typeof import('../dominionGame')> {
  return import('../dominionGame');
}
async function freshDef(): Promise<GameDef> {
  return (await dominion()).buildDominionDef();
}

const SUPPLY = 'dom_zone_supply';
const RESERVE = 'dom_zone_reserve';
const TRASH = 'dom_zone_trash';
const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;
const countNamed = (state: GameState, zoneKey: string, name: string): number =>
  names(state, zoneKey).filter((n) => n === name).length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, RESERVE);

const play = { actionId: 'dom_action_play' };
const noChoices = () => { throw new Error('no choices expected'); };

/** Action → Buy → Cleanup → the turn passes (nothing gets played). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

/** A ten-card kingdom containing Familiar (a potion-cost card). */
const TEN_WITH_FAMILIAR = [
  'Familiar', 'Village', 'Smithy', 'Market', 'Militia',
  'Moat', 'Cellar', 'Chapel', 'Workshop', 'Mine',
];
/** A ten-card, potion-free kingdom. */
const TEN_POTION_FREE = [
  'Gardens', 'Village', 'Smithy', 'Market', 'Militia',
  'Moat', 'Cellar', 'Chapel', 'Workshop', 'Mine',
];

describe('alchemy1e module registration', () => {
  it('validates clean and knows all eleven cards with costs, types and potion halves', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, [coins: number, potion: number]> = {
      Transmute: [0, 1],
      Vineyard: [0, 1],
      Apothecary: [2, 1],
      Herbalist: [2, 0],
      'Scrying Pool': [2, 1],
      University: [2, 1],
      Alchemist: [3, 1],
      Familiar: [3, 1],
      "Philosopher's Stone": [3, 1],
      Golem: [4, 1],
      Apprentice: [5, 0],
    };
    for (const [name, [coins, potion]] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${coins}`).toBe(coins);
      expect(card!.fields['dom_field_cost_potion'], `${name} potion half`).toBe(potion);
      expect(card!.tags).toContain('dom_tag_kingdom');
      if (potion === 1) {
        // The cost badge shows coins only — the text carries the potion half.
        expect(String(card!.fields['dom_field_text']).startsWith('Costs 1 Potion.'),
          `${name} text declares its potion cost`).toBe(true);
      }
    }
    // Primary types + attack tags per the printed type lines.
    const byName = (n: string) => def.cards.find((c) => c.name === n)!;
    expect(byName('Vineyard').typeId).toBe('dom_type_victory');
    expect(byName("Philosopher's Stone").typeId).toBe('dom_type_treasure');
    expect(byName('Familiar').tags).toContain('dom_tag_attack');
    expect(byName('Scrying Pool').tags).toContain('dom_tag_attack');
    expect(byName('Golem').typeId).toBe('dom_type_action');
    // Attack halves are the stacked abilities, and ONLY those.
    for (const n of ['Familiar', 'Scrying Pool']) {
      expect(byName(n).abilities.filter((a) => a.stacked === true)).toHaveLength(1);
    }
  });
});

describe('Potion core integration', () => {
  it('(a) a Familiar kingdom auto-promotes the Potion pile into the supply', async () => {
    const dg = await dominion();
    const def = dg.pickKingdom(await freshDef(), TEN_WITH_FAMILIAR);
    expect(dg.potionEnabled(def)).toBe(true);
    // The pile watcher counts the promoted Potion pile too.
    const watcher = def.triggers.find((t) => t.id === 'dom_trigger_piles')!;
    expect(JSON.stringify(watcher.script)).toContain('"Potion"');
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(countNamed(state, SUPPLY, 'Potion')).toBe(16);
    expect(countNamed(state, RESERVE, 'Potion')).toBe(0);
    expect(countNamed(state, SUPPLY, 'Familiar')).toBe(10);
  });

  it('(b) buying Familiar needs the potion: illegal on 3 coins alone, legal after brewing', async () => {
    const dg = await dominion();
    const def = dg.pickKingdom(await freshDef(), TEN_WITH_FAMILIAR);
    // 3 coins on the counter, a Potion in hand (off the promoted pile).
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = 3;
    def.setup.push(dealNamed('Potion', 'dom_zone_hand', 'p0'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    const familiar = findNamed(state, SUPPLY, 'Familiar');
    // Coins alone can NOT buy it: the potion half is unpaid.
    expect(engine.getLegalMoves('p0')
      .some((m) => m.actionId === 'dom_action_buy' && m.cardId === familiar)).toBe(false);
    await expect(engine.performAction('p0', { actionId: 'dom_action_buy', cardId: familiar }))
      .rejects.toThrow(/Illegal/);
    // Brew: playing the Potion treasure banks 1 potion.
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Potion'),
    });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_potions']).toBe(1);
    // Now the buy is legal — and it spends BOTH currencies.
    await engine.performAction('p0', { actionId: 'dom_action_buy', cardId: familiar });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Familiar');
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(state.players[0].vars['dom_var_potions']).toBe(0);
  });

  it('(c) unspent potions evaporate at cleanup', async () => {
    const dg = await dominion();
    const def = dg.pickKingdom(await freshDef(), TEN_WITH_FAMILIAR);
    def.setup.push(dealNamed('Potion', 'dom_zone_hand', 'p0'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Potion'),
    });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_potions']).toBe(1);
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_potions']).toBe(0);
  });

  it('(d) a potion-free kingdom leaves the Potion pile in the reserve', async () => {
    const dg = await dominion();
    const def = dg.pickKingdom(await freshDef(), TEN_POTION_FREE);
    expect(dg.potionEnabled(def)).toBe(false);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(countNamed(state, SUPPLY, 'Potion')).toBe(0);
    expect(countNamed(state, RESERVE, 'Potion')).toBe(16);
  });
});

describe('Transmute', () => {
  it('a trashed Victory card becomes a Gold', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Transmute'), dealNamed('Estate'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Transmute') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toContain('Estate');
    expect(names(state, DISCARD('p0'))).toContain('Gold');
  });

  it('a trashed Treasure becomes another Transmute (off its supply pile)', async () => {
    const dg = await dominion();
    const ten = ['Transmute', ...TEN_POTION_FREE.slice(1)];
    const def = dg.pickKingdom(await freshDef(), ten);
    def.setup.push(dealNamed('Transmute'), dealNamed('Copper'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Transmute') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toContain('Copper');
    expect(countNamed(state, DISCARD('p0'), 'Transmute')).toBe(1);
    // 10 in the pile − 1 dealt to hand − 1 gained.
    expect(countNamed(state, SUPPLY, 'Transmute')).toBe(8);
  });
});

describe('Vineyard', () => {
  it('the recount pays 1 VP per full 3 Action cards owned, per Vineyard', async () => {
    const def = await freshDef();
    // p0 owns 1 Vineyard + 3 Militias (Actions) on top of 7 Copper 3 Estate.
    def.setup.push(
      fromReserve('Vineyard', 'dom_zone_discard', 'p0'),
      dealNamed('Militia', 'dom_zone_discard', 'p0'),
      dealNamed('Militia', 'dom_zone_discard', 'p0'),
      dealNamed('Militia', 'dom_zone_discard', 'p0'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0'); // turnEnd fires the VP recount
    const state = engine.getState();
    expect(errors).toEqual([]);
    // 3 Estates + floor(3 Actions / 3) × 1 Vineyard = 4.
    expect(state.players[0].vars['dom_var_vp']).toBe(4);
    // The opponent owns no Vineyard: plain 3.
    expect(state.players[1].vars['dom_var_vp']).toBe(3);
  });
});

describe('Apothecary', () => {
  it('+1 Card +1 Action; Coppers and Potions to hand, the rest back on the deck', async () => {
    const def = await freshDef();
    // Deck top after dealing (last dealt topmost): Gold, Copper, Potion,
    // Estate, Silver. The +1 Card takes the Gold; the reveal sees the next 4.
    def.setup.push(
      fromReserve('Apothecary'),
      dealNamed('Silver', 'dom_zone_deck', 'p0'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'),
      fromReserve('Potion', 'dom_zone_deck', 'p0'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
      dealNamed('Gold', 'dom_zone_deck', 'p0'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Apothecary') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 − 1 + 1
    // 6 − Apothecary + Gold (draw) + Copper + Potion (reveal) = 8.
    expect(count(state, HAND('p0'))).toBe(8);
    expect(names(state, HAND('p0'))).toContain('Gold');
    expect(names(state, HAND('p0'))).toContain('Potion');
    // Estate and Silver went back on top of the deck (fixed order; a zone's
    // TOP is the END of its card list).
    expect(names(state, DECK('p0')).slice(-2).sort()).toEqual(['Estate', 'Silver']);
  });
});

describe('Herbalist', () => {
  it('+1 Buy +$1, and at cleanup start may topdeck a played Treasure', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Herbalist'), dealNamed('Silver'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      return JSON.stringify([silver]);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Herbalist') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Silver'),
    });
    // Entering cleanup pops the Herbalist offer; the Silver is topdecked and
    // the redraw pulls it straight into the new hand.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    expect(requests).toHaveLength(1);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p0'))).toContain('Silver');
    expect(names(state, DISCARD('p0'))).not.toContain('Silver');
    expect(names(state, DISCARD('p0'))).toContain('Herbalist');
  });
});

describe('Scrying Pool', () => {
  it('owner-decided reveals for both players, then the Action dig to hand', async () => {
    const def = await freshDef();
    // p0 deck top after dealing: Estate, Militia, Militia, Copper.
    def.setup.push(
      fromReserve('Scrying Pool'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
      dealNamed('Militia', 'dom_zone_deck', 'p0'),
      dealNamed('Militia', 'dom_zone_deck', 'p0'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'),
      dealNamed('Gold', 'dom_zone_deck', 'p1'),
    );
    const options: string[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      options.push(req.prompt);
      // Own Estate: discard it. The opponent's Gold: put it back.
      return options.length === 1 ? 'sp_discard' : 'sp_back';
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Scrying Pool') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(options).toHaveLength(2);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 − 1 + 1
    // The owner's Estate was discarded; the opponent's Gold stayed put on
    // top of their deck (a zone's TOP is the END of its card list).
    expect(names(state, DISCARD('p0'))).toContain('Estate');
    expect(names(state, DECK('p1')).slice(-1)[0]).toBe('Gold');
    // The dig: 2 Militias (Actions) + the stopping Copper all joined the hand.
    expect(countNamed(state, HAND('p0'), 'Militia')).toBe(2);
    expect(count(state, HAND('p0'))).toBe(8); // 6 − Pool + 3
    expect(names(state, INPLAY('p0'))).toEqual(['Scrying Pool']);
  });
});

describe('University', () => {
  it('+2 Actions and an optional Action gain — never a Treasure, never a potion-cost card', async () => {
    const dg = await dominion();
    const def = dg.pickKingdom(await freshDef(), TEN_WITH_FAMILIAR);
    def.setup.push(fromReserve('University'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Militia')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'University') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 − 1 + 2
    expect(names(state, DISCARD('p0'))).toContain('Militia');
    // The offer held Actions only: no Silver (Treasure), no Familiar
    // (potion cost — the official "up to $5" exclusion).
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'pile' }>;
    const offered = req.cardIds.map((id) => state.cards[id].name);
    expect(offered).toContain('Militia');
    expect(offered).not.toContain('Silver');
    expect(offered).not.toContain('Familiar');
    expect(offered).not.toContain('Province');
  });
});

describe('Alchemist', () => {
  it('+2 Cards +1 Action, and topdecks itself at cleanup while a Potion is in play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Alchemist'), fromReserve('Potion'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return true;
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Alchemist') });
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(8); // 7 − Alchemist + 2
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Potion'),
    });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_potions']).toBe(1);
    // Cleanup start: the yes/no fires (a Potion is in play), the Alchemist
    // rides the top of the deck into the redrawn hand; the Potion does not.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p0'))).toContain('Alchemist');
    expect(names(state, DISCARD('p0'))).not.toContain('Alchemist');
    // The Potion was swept off the table like any played card (the redraw
    // may reshuffle it straight into the deck — "not in play" is stable).
    expect(count(state, INPLAY('p0'))).toBe(0);
  });
});

describe('Familiar', () => {
  it('+1 Card +1 Action; the opponent gains a Curse', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Familiar'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Familiar') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 − Familiar + 1
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, DISCARD('p1'))).toContain('Curse');
    expect(countNamed(state, SUPPLY, 'Curse')).toBe(9);
  });

  it('a revealed Moat wards off the Curse', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Familiar'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Familiar') });
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p1'))).not.toContain('Curse');
    expect(countNamed(state, SUPPLY, 'Curse')).toBe(10);
    // Immunity faded with the attack (the shared effectResolved reset).
    expect(state.players[1].vars['dom_var_immune']).toBe(0);
  });
});

describe("Philosopher's Stone", () => {
  it('pays 1 coin per 5 cards across deck + discard, counted at play time', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve("Philosopher's Stone"),
      ...Array.from({ length: 5 }, () => dealNamed('Copper', 'dom_zone_discard', 'p0')),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    const state0 = engine.getState();
    // Deck 5 + discard 5 = 10 cards → +$2.
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state0, HAND('p0'), "Philosopher's Stone"),
    });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, INPLAY('p0'))).toEqual(["Philosopher's Stone"]);
  });
});

describe('Golem', () => {
  it('digs out 2 non-Golem Actions, discards the rest, and plays both in reveal order', async () => {
    const def = await freshDef();
    // p0 deck top after dealing: Copper, Smithy, Estate, Militia — the dig
    // passes Copper and Estate, finds Smithy then Militia.
    def.setup.push(
      fromReserve('Golem'),
      dealNamed('Militia', 'dom_zone_deck', 'p0'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'),
      dealNamed('Smithy', 'dom_zone_deck', 'p0'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
    );
    const { engine, errors } = probeEngine(def, (req) => {
      // Militia's attack: p1 discards down to 3.
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, req.min));
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Golem') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    // Smithy played FIRST (reveal order): its +3 Cards resolved before
    // Militia's coins — the log carries the order.
    const golemPlays = state.log
      .filter((l) => l.text.includes('Golem plays'))
      .map((l) => l.text);
    expect(golemPlays).toHaveLength(2);
    expect(golemPlays[0]).toContain('Smithy');
    expect(golemPlays[1]).toContain('Militia');
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Golem', 'Militia', 'Smithy']);
    // The passed-over Copper and Estate were discarded.
    expect(names(state, DISCARD('p0'))).toContain('Copper');
    expect(names(state, DISCARD('p0'))).toContain('Estate');
    // 6 − Golem + Smithy's 3 = 8; both plays cost no Action (1 − 1 = 0 spent
    // on Golem alone); Militia's +$2 paid.
    expect(count(state, HAND('p0'))).toBe(8);
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    // Militia's attack went through the stack: p1 discarded to 3.
    expect(count(state, HAND('p1'))).toBe(3);
  });
});

describe('Apprentice', () => {
  it('draws nothing for a free card (Copper)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Apprentice'), dealNamed('Copper'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Apprentice') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, TRASH)).toContain('Copper');
    expect(count(state, HAND('p0'))).toBe(5); // 7 − Apprentice − Copper + 0
  });

  it('a potion-cost card draws its coin cost + 2 (Familiar: 3 + 2 = 5)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Apprentice'), fromReserve('Familiar'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Familiar')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Apprentice') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toContain('Familiar');
    expect(count(state, HAND('p0'))).toBe(10); // 7 − Apprentice − Familiar + 5
  });
});
