/**
 * Menagerie (part A) — deterministic per-card probes through the REAL
 * engine: the Horse stock round-trip, the Exile mat (exiling, the shared
 * discard-exiled-copies rule, the printed-VP term), the on-gain reactions
 * (Black Cat / Sleigh / Sheepdog and the Camel Train / Cavalry / Hostelry
 * riders), Village Green's now-or-later Duration plus its discard-to-play
 * reaction, and the two attacks' response windows.
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers menagerieA, freshDef() can
 * become a plain static `buildDominionDef` import.
 */
import { describe, expect, it } from 'vitest';
import type { Block, ChoiceRequest, EngineHandle, Expr, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { EXILE_ZONE, GOATHERD_TRASHED_VAR, HORSE_ZONE, menagerieA } from './menagerieA';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(menagerieA)) EXPANSIONS.push(menagerieA);
/** buildDominionDef AFTER registration (see the header note). */
async function freshDef(): Promise<GameDef> {
  const { buildDominionDef } = await import('../dominionGame');
  return buildDominionDef();
}

const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const DURATION = (p: string) => `dom_zone_duration:${p}`;
const EXILE = (p: string) => `${EXILE_ZONE}:${p}`;
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

/** Skip to the buy phase and play the named card via the treasure action. */
async function playTreasure(engine: EngineHandle, pid: string, name: string): Promise<void> {
  const state = engine.getState();
  await engine.performAction(pid, {
    actionId: 'dom_action_treasure', cardId: findNamed(state, HAND(pid), name),
  });
}

/** Action → Buy → Cleanup → the turn passes (nothing gets played). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

describe('menagerieA module registration', () => {
  it('validates clean and knows all fifteen kingdom cards plus the Horse stock', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      'Black Cat': 2, Sleigh: 2, Supplies: 2,
      'Camel Train': 3, Goatherd: 3, Scrap: 3, Sheepdog: 3, 'Snowy Village': 3, Stockpile: 3,
      'Bounty Hunter': 4, Cardinal: 4, Cavalry: 4, Groom: 4, Hostelry: 4, 'Village Green': 4,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
    }
    // Primary types: Supplies and Stockpile are the module's Treasures;
    // everything else stays an Action (Village Green's Duration-ness is
    // behavioral — no Duration tag exists in the def's vocabulary).
    expect(def.cards.find((c) => c.name === 'Supplies')!.typeId).toBe('dom_type_treasure');
    expect(def.cards.find((c) => c.name === 'Stockpile')!.typeId).toBe('dom_type_treasure');
    for (const name of ['Black Cat', 'Sleigh', 'Camel Train', 'Goatherd', 'Scrap', 'Sheepdog',
      'Snowy Village', 'Bounty Hunter', 'Cardinal', 'Cavalry', 'Groom', 'Hostelry', 'Village Green']) {
      expect(def.cards.find((c) => c.name === name)!.typeId, `${name} is an Action`)
        .toBe('dom_type_action');
    }
    // Type-line tags: two attacks, four reactions.
    for (const name of ['Black Cat', 'Cardinal']) {
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} is an Attack`)
        .toContain('dom_tag_attack');
    }
    for (const name of ['Black Cat', 'Sleigh', 'Sheepdog', 'Village Green']) {
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} is a Reaction`)
        .toContain('dom_tag_reaction');
    }
    for (const name of Object.keys(costs)) {
      if (name === 'Black Cat' || name === 'Cardinal') continue;
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} is not an Attack`)
        .not.toContain('dom_tag_attack');
    }
    // The Horse: an Action, but nobody's kingdom pile — 30 copies of
    // non-supply stock spawned into the shared Horse zone.
    const horse = def.cards.find((c) => c.name === 'Horse')!;
    expect(horse.typeId).toBe('dom_type_action');
    expect(horse.tags).not.toContain('dom_tag_kingdom');
    const horseDeck = def.decks.find((d) => d.id === 'dom_deck_ns_menagerieA_0')!;
    expect(horseDeck).toBeDefined();
    expect(horseDeck.initialZone).toBe(HORSE_ZONE);
    if (horseDeck.source.kind === 'custom') {
      expect(horseDeck.source.entries).toEqual([{ cardId: 'dom_card_horse', count: 30 }]);
    }
    // The module's zones: the per-player Exile mat + the shared Horse stock.
    expect(def.zones.find((z) => z.id === EXILE_ZONE)?.owner).toBe('perPlayer');
    expect(def.zones.find((z) => z.id === HORSE_ZONE)?.owner).toBe('shared');
    // The picker files the fifteen under Menagerie; the Horse is no pick.
    const { kingdomCatalog } = await import('../dominionGame');
    const catalog = kingdomCatalog(def);
    for (const name of Object.keys(costs)) {
      expect(catalog.find((e) => e.name === name)?.expansion, `${name} in Menagerie`).toBe('Menagerie');
    }
    expect(catalog.find((e) => e.name === 'Horse')).toBeUndefined();
  });
});

describe('Horse', () => {
  it('+2 Cards +1 Action, then returns itself to the stock', async () => {
    const def = await freshDef();
    def.setup.push(dealNamed('Horse', 'dom_zone_hand', null, HORSE_ZONE));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    expect(count(state, HORSE_ZONE)).toBe(29);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Horse') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Horse + 2 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(count(state, HORSE_ZONE)).toBe(30); // back in the stock
  });
});

describe('Black Cat', () => {
  it('played on your own turn: +2 Cards and no Curses', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Black Cat'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Black Cat') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Black Cat + 2 drawn
    expect(count(state, DISCARD('p1'))).toBe(0); // it IS the owner's turn
  });

  it("reacts to the opponent's Victory gain and curses them off-turn", async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Black Cat', 'dom_zone_hand', 'p1'),
      giveVar('dom_var_coins', 'p0', 2),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind === 'yesNo') return true; // pounce
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Estate'),
    });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests[0].playerId).toBe('p1');
    expect(names(state, INPLAY('p1'))).toEqual(['Black Cat']);
    expect(count(state, HAND('p1'))).toBe(7); // 6 - Black Cat + 2 drawn
    // Off-turn play: "each other player" is the CURRENT player — p0.
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Curse', 'Estate']);
  });
});

describe('Sleigh', () => {
  it('gains 2 Horses on play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Sleigh'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Sleigh') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Horse', 'Horse']);
    expect(count(state, HORSE_ZONE)).toBe(28);
  });

  it('reaction: discards itself to topdeck the gained card', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Sleigh'), giveVar('dom_var_coins', 'p0', 3));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind === 'option') return 'sleigh_deck';
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Silver'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(topName(state, DECK('p0'))).toBe('Silver'); // rode onto the deck
    expect(names(state, DISCARD('p0'))).toEqual(['Sleigh']);
    expect(count(state, HAND('p0'))).toBe(5); // the Sleigh left the hand
  });
});

describe('Supplies', () => {
  it('$1 and a Horse onto the deck when played', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Supplies'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Supplies');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(topName(state, DECK('p0'))).toBe('Horse');
    expect(count(state, HORSE_ZONE)).toBe(29);
    expect(names(state, INPLAY('p0'))).toEqual(['Supplies']);
  });
});

describe('Camel Train', () => {
  it('exiles a non-Victory card from the Supply', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Camel Train'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      // Victory piles are filtered out of the offer.
      const offered = req.cardIds.map((id) => state.cards[id].name);
      expect(offered).not.toContain('Estate');
      expect(offered).not.toContain('Province');
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Camel Train') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(names(state, EXILE('p0'))).toEqual(['Silver']);
    expect(names(state, SUPPLY).filter((n) => n === 'Silver')).toHaveLength(39);
  });

  it('on gain: exiles a Gold from the Supply', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Camel Train'), giveVar('dom_var_coins', 'p0', 3));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Camel Train'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, EXILE('p0'))).toEqual(['Gold']);
    expect(names(state, SUPPLY).filter((n) => n === 'Gold')).toHaveLength(29);
    expect(names(state, DISCARD('p0'))).toEqual(['Camel Train']);
  });
});

describe('Goatherd', () => {
  it("draws for the opponent's last-turn trashes; the counter resets on their next turn", async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Goatherd'), dealNamed('Silver'),
      fromReserve('Goatherd', 'dom_zone_hand', 'p1'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      // p0 trashes the Silver; p1 declines the trash.
      const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver');
      return JSON.stringify(silver !== undefined && req.playerId === 'p0' ? [silver] : []);
    });
    await engine.start();

    // T1 (p0): trash a Silver; the opponent trashed nothing last turn.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Goatherd') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(count(state, HAND('p0'))).toBe(5); // 7 - Goatherd - Silver, no draw
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.players[0].vars[GOATHERD_TRASHED_VAR]).toBe(1);
    await passTurn(engine, 'p0');

    // T2 (p1): declines the trash, draws 1 for p0's one trash last turn.
    state = engine.getState();
    await engine.performAction('p1', { ...play, cardId: findNamed(state, HAND('p1'), 'Goatherd') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(6); // 6 - Goatherd + 1 drawn
    await passTurn(engine, 'p1');

    // p0's next action phase resets THEIR counter.
    state = engine.getState();
    expect(state.players[0].vars[GOATHERD_TRASHED_VAR]).toBe(0);
  });
});

describe('Scrap', () => {
  it('trashes a Silver for exactly 3 different picks (printed order)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Scrap'), dealNamed('Silver'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      if (req.kind === 'yesNo') return true; // take the first three benefits
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Scrap') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // One trash pick, then three yes/no benefit picks — then the picks ran out.
    expect(requests.map((r) => r.kind)).toEqual(['card', 'yesNo', 'yesNo', 'yesNo']);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(count(state, HAND('p0'))).toBe(6); // 7 - Scrap - Silver + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(state.players[0].vars['dom_var_buys']).toBe(2); // 1 + 1
    expect(state.players[0].vars['dom_var_coins']).toBe(0); // the 4th pick never fired
  });
});

describe('Sheepdog', () => {
  it('+2 Cards when played normally', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Sheepdog'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Sheepdog') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Sheepdog + 2 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
  });

  it('reaction: plays from hand when its holder gains a card', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Sheepdog'), giveVar('dom_var_coins', 'p0', 3));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds); // play the one Sheepdog
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Silver'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Sheepdog']);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Sheepdog + 2 drawn
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
  });
});

describe('Snowy Village', () => {
  it('+1 Card +4 Actions +1 Buy (the ignore-further-actions rider is dropped)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Snowy Village'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Snowy Village') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Snowy Village + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(4); // 1 - 1 + 4
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
  });
});

describe('Stockpile & the shared exile-discard rule', () => {
  it('$3 +1 Buy and exiles itself; gaining another offers the discharge', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Stockpile'), dealNamed('Stockpile'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind === 'yesNo') return true; // discharge the exiled copy
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await playTreasure(engine, 'p0', 'Stockpile');
    let state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(state.players[0].vars['dom_var_buys']).toBe(2); // 1 + 1
    expect(names(state, EXILE('p0'))).toEqual(['Stockpile']);
    expect(count(state, INPLAY('p0'))).toBe(0);

    // Buying a Stockpile (same name) offers to discard the exiled copy.
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Stockpile'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(count(state, EXILE('p0'))).toBe(0);
    expect(names(state, DISCARD('p0'))).toEqual(['Stockpile', 'Stockpile']);
  });
});

describe('Bounty Hunter', () => {
  it('pays $3 for the first exiled copy only', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Bounty Hunter'), fromReserve('Bounty Hunter'),
      dealNamed('Estate'), dealNamed('Estate'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
    });
    await engine.start();

    // First hunt: no Estate in Exile yet — the bounty pays.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Bounty Hunter') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(names(state, EXILE('p0'))).toEqual(['Estate']);

    // Second hunt: a copy already sits in Exile — no bounty.
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Bounty Hunter') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3); // unchanged
    expect(names(state, EXILE('p0'))).toEqual(['Estate', 'Estate']);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 -1 +1 -1 +1
  });
});

describe('Cardinal', () => {
  it('the victim reveals their top 2, exiles the $3–$6 one and discards the rest', async () => {
    const def = await freshDef();
    // p1's deck top: Estate (dealt last), then Silver below it.
    def.setup.push(
      fromReserve('Cardinal'),
      dealNamed('Silver', 'dom_zone_deck', 'p1'),
      dealNamed('Estate', 'dom_zone_deck', 'p1'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Cardinal') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, EXILE('p1'))).toEqual(['Silver']); // in range
    expect(names(state, DISCARD('p1'))).toEqual(['Estate']); // the rest
    expect(count(state, 'dom_zone_look')).toBe(0);
  });
});

describe('Cavalry', () => {
  it('gains 2 Horses on play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Cavalry'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Cavalry') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Horse', 'Horse']);
    expect(count(state, HORSE_ZONE)).toBe(28);
  });

  it('on gain: +2 Cards and +1 Buy (no phase rewind — documented)', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Cavalry'), giveVar('dom_var_coins', 'p0', 4));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Cavalry'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 5 + 2 drawn
    expect(state.players[0].vars['dom_var_buys']).toBe(1); // 1 - 1 + 1
    expect(names(state, DISCARD('p0'))).toEqual(['Cavalry']);
  });
});

describe('Groom', () => {
  it('gaining an Action also gains a Horse', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Groom'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      // Militia sits in the default (First Game) kingdom.
      return req.cardIds.find((id) => state.cards[id].name === 'Militia')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Groom') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Horse', 'Militia']);
    expect(count(state, HORSE_ZONE)).toBe(29);
  });

  it('gaining a Victory card gives +1 Card and +1 Action', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Groom'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Groom') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Estate']);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Groom + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
  });
});

describe('Hostelry', () => {
  it('+1 Card +2 Actions when played', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Hostelry'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Hostelry') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Hostelry + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
  });

  it('on gain: discards Treasures for that many Horses', async () => {
    const def = await freshDef();
    def.setup.push(
      pileToSupply('Hostelry'), giveVar('dom_var_coins', 'p0', 4),
      dealNamed('Copper'), dealNamed('Copper'),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const coppers = req.cardIds.filter((id) => state.cards[id].name === 'Copper');
      return JSON.stringify(coppers.slice(0, 2));
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Hostelry'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(count(state, HAND('p0'))).toBe(5); // 7 - 2 discarded
    expect(names(state, DISCARD('p0')).sort()).toEqual(
      ['Copper', 'Copper', 'Horse', 'Horse', 'Hostelry']);
    expect(count(state, HORSE_ZONE)).toBe(28);
  });
});

describe('Village Green', () => {
  it('"now": +1 Card +2 Actions immediately, staying in play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Village Green'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'vg_now';
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Village Green') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - VG + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    expect(names(state, INPLAY('p0'))).toEqual(['Village Green']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });

  it('"later": parks through cleanup and pays at the next turn start', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Village Green'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'vg_later';
    });
    await engine.start();

    // T1 (p0): the card parks; no bonus yet.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village Green') });
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(5);
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
    expect(names(state, DURATION('p0'))).toEqual(['Village Green']);
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Village Green']); // cleanup spares it
    await passTurn(engine, 'p1');

    // T3 (p0): +1 Card +2 Actions, and the card marched back to In Play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + 1
    expect(state.players[0].vars['dom_var_actions']).toBe(3); // 1 + 2
    expect(names(state, INPLAY('p0'))).toEqual(['Village Green']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });

  it('discharged from Exile (a non-cleanup discard), it may be revealed and played', async () => {
    const def = await freshDef();
    // One Green waits in Exile; the pile joins the supply AFTER that deal.
    def.setup.push(
      fromReserve('Village Green', 'dom_zone_exile'),
      pileToSupply('Village Green'),
      giveVar('dom_var_coins', 'p0', 4),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind === 'yesNo') return true; // discharge, then reveal to play
      if (req.kind === 'option') return 'vg_now';
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    expect(names(state, EXILE('p0'))).toEqual(['Village Green']);

    // Buying a Village Green: the shared rule discards the exiled copy
    // ('discard'-tagged), and the discard reaction plays it right away.
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Village Green'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['yesNo', 'yesNo', 'option']);
    expect(count(state, EXILE('p0'))).toBe(0);
    expect(names(state, INPLAY('p0'))).toEqual(['Village Green']); // the discharged copy
    expect(names(state, DISCARD('p0'))).toEqual(['Village Green']); // the bought copy
    expect(count(state, HAND('p0'))).toBe(6); // 5 + the "now" draw

    // The cleanup sweep must NOT re-offer it (its tag is 'cleanup').
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(3);
    expect(count(state, INPLAY('p0'))).toBe(0);
  });
});

describe('Exile scoring', () => {
  it('exiled cards score their printed VP at the recount', async () => {
    const def = await freshDef();
    def.setup.push(dealNamed('Estate', 'dom_zone_exile'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0'); // the recount runs at turn end
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp']).toBe(4); // 3 Estates + 1 exiled
    expect(state.players[1].vars['dom_var_vp']).toBe(3);
  });
});
