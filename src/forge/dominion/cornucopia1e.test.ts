/**
 * Cornucopia (1E) — deterministic per-card probes through the REAL engine,
 * in the seaside2eB.test.ts style: cards under test start in the hidden
 * RESERVE (or the Prize stock) and are dealt with an explicit fromZone;
 * every probe asserts zero script errors alongside the card's outcome.
 *
 * REGISTRATION: this module is NOT yet wired into expansions.ts (the
 * integrator does that). buildDominionDef derives its module-scope tables
 * (kingdom piles, type lines, card ids, non-supply decks) from the
 * EXPANSIONS array at dominionGame.ts EVALUATION time, so the module is
 * pushed into EXPANSIONS here, at this file's module scope, and dominionGame
 * is loaded through a dynamic import in beforeAll — none of this file's
 * static imports evaluates dominionGame.ts, so the push always lands first.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChoiceRequest, EngineHandle, Expr, GameDef, GameState } from '../../shared/types';
import { PASS_ACTION_ID } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { cornucopia1e } from './cornucopia1e';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(cornucopia1e)) EXPANSIONS.push(cornucopia1e);

let buildDominionDef: () => GameDef;
let kingdomCatalog: (def: GameDef) => { name: string; expansion: string }[];
beforeAll(async () => {
  ({ buildDominionDef, kingdomCatalog } = await import('../dominionGame'));
});

const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const DURATION = (p: string) => `dom_zone_duration:${p}`;
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';
const LOOK = 'dom_zone_look';
const PRIZES = 'dom_zone_prizes';

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
/** Top of a stack zone = the END of the cardIds array. */
const topName = (state: GameState, zoneKey: string): string | undefined =>
  names(state, zoneKey).at(-1);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;
const countOf = (state: GameState, zoneKey: string, name: string): number =>
  names(state, zoneKey).filter((n) => n === name).length;

/** Setup block: move EVERY card matching `filter` between two zones. */
function moveAll(
  fromZone: string, toZone: string,
  opts: { owner?: string; filter?: Expr } = {},
): GameDef['setup'][number] {
  const owner = opts.owner !== undefined ? { kind: 'str', value: opts.owner } as Expr : null;
  return {
    kind: 'moveCards',
    from: { zoneId: fromZone, owner },
    to: { zoneId: toZone, owner },
    cards: opts.filter ? { kind: 'filter', filter: opts.filter } : { kind: 'all' },
    toPosition: 'top',
    faceUp: null,
  };
}

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');
const fromPrizes = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, PRIZES);

const play = { actionId: 'dom_action_play' };
const noChoices = () => { throw new Error('no choices expected'); };

/** Action → Buy → Cleanup → the turn passes (three manual phases). */
async function endTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

/**
 * Drive an open response window: every holder passes, except that `useFor`
 * performs `actionId` ONCE when it is legal (seaside2eA's driveWindow —
 * Horse Traders instead of Moat).
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

describe('cornucopia1e module registration', () => {
  it('validates clean and knows all 13 kingdom cards with costs and type lines', () => {
    const def = buildDominionDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Hamlet: 2, 'Fortune Teller': 3, Menagerie: 3, 'Farming Village': 4,
      'Horse Traders': 4, Remake: 4, Tournament: 4, 'Young Witch': 4,
      Harvest: 5, 'Horn of Plenty': 5, 'Hunting Party': 5, Jester: 5, Fairgrounds: 6,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags, `${name} is a kingdom card`).toContain('dom_tag_kingdom');
    }
    // Primary types: Fairgrounds is Victory-typed (Gardens' shape), Horn of
    // Plenty and Diadem are Treasure-typed, the rest stay Actions.
    expect(def.cards.find((c) => c.name === 'Fairgrounds')!.typeId).toBe('dom_type_victory');
    expect(def.cards.find((c) => c.name === 'Horn of Plenty')!.typeId).toBe('dom_type_treasure');
    expect(def.cards.find((c) => c.name === 'Diadem')!.typeId).toBe('dom_type_treasure');
    expect(def.cards.find((c) => c.name === 'Hamlet')!.typeId).toBe('dom_type_action');
    for (const name of ['Fortune Teller', 'Young Witch', 'Jester', 'Followers']) {
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} attacks`)
        .toContain('dom_tag_attack');
    }
    expect(def.cards.find((c) => c.name === 'Horse Traders')!.tags).toContain('dom_tag_reaction');
    expect(def.actions.some((a) => a.id === 'dom_action_horse_traders')).toBe(true);
    // The kingdom stock carries ten copies of each new pile.
    const kingdomDeck = def.decks.find((d) => d.id === 'dom_deck_kingdom')!;
    for (const name of Object.keys(costs)) {
      const cardId = def.cards.find((c) => c.name === name)!.id;
      const entry = kingdomDeck.source.kind === 'custom'
        ? kingdomDeck.source.entries.find((e) => e.cardId === cardId) : undefined;
      expect(entry?.count, `${name} pile of 10`).toBe(10);
    }
  });

  it('ships the five Prizes as non-supply stock: 1 copy each, cost 0, no kingdom tag', () => {
    const def = buildDominionDef();
    const prizeNames = ['Bag of Gold', 'Diadem', 'Followers', 'Princess', 'Trusty Steed'];
    for (const name of prizeNames) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs 0`).toBe(0);
      expect(card!.tags, `${name} is nobody's pile`).not.toContain('dom_tag_kingdom');
    }
    // The prize deck spawns straight into the module's shared zone.
    const prizeDeck = def.decks.find((d) => d.initialZone === PRIZES);
    expect(prizeDeck).toBeDefined();
    expect(prizeDeck!.source.kind).toBe('custom');
    if (prizeDeck!.source.kind === 'custom') {
      expect(prizeDeck!.source.entries).toHaveLength(5);
      expect(prizeDeck!.source.entries.every((e) => e.count === 1)).toBe(true);
    }
    expect(def.zones.some((z) => z.id === PRIZES)).toBe(true);
    // Prizes are invisible to the kingdom picker; the 13 piles are in it.
    const catalog = kingdomCatalog(def);
    const catalogNames = catalog.map((e) => e.name);
    for (const name of prizeNames) expect(catalogNames).not.toContain(name);
    expect(catalogNames).toContain('Hamlet');
    expect(catalog.find((e) => e.name === 'Hamlet')!.expansion).toBe('Cornucopia');
  });
});

describe('Hamlet', () => {
  it('+1 Card +1 Action, then two optional discards pay +1 Action and +1 Buy', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Hamlet'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, 1));
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Hamlet') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.kind === 'cards' && r.min === 0 && r.max === 1)).toBe(true);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 1 + 1
    expect(state.players[0].vars['dom_var_buys']).toBe(2); // 1 + 1
    expect(count(state, HAND('p0'))).toBe(4); // 6 - Hamlet + 1 drawn - 2 discarded
    expect(count(state, DISCARD('p0'))).toBe(2);
  });
});

describe('Fortune Teller', () => {
  it('+$2; the victim digs to a Victory card, keeps it on top and discards the rest', async () => {
    const def = buildDominionDef();
    // p1's deck top after setup (top last): ..., Estate, Copper, Silver.
    def.setup.push(
      fromReserve('Fortune Teller'),
      dealNamed('Estate', 'dom_zone_deck', 'p1'),
      dealNamed('Copper', 'dom_zone_deck', 'p1'),
      dealNamed('Silver', 'dom_zone_deck', 'p1'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Fortune Teller') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    // Silver and Copper were dug past; the Estate stops the dig on top.
    expect(topName(state, DECK('p1'))).toBe('Estate');
    expect(names(state, DISCARD('p1')).sort()).toEqual(['Copper', 'Silver']);
    expect(count(state, DECK('p1'))).toBe(6); // 5 starter + 3 dealt - 2 dug
    expect(count(state, LOOK)).toBe(0);
  });
});

describe('Menagerie', () => {
  it('a hand with duplicates draws only 1', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Menagerie'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    // The starter hand (Coppers/Estates) always holds at least two Coppers.
    expect(countOf(state0, HAND('p0'), 'Copper')).toBeGreaterThan(1);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Menagerie') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Menagerie + 1
    expect(state.log.some((l) => l.text.includes('duplicate'))).toBe(true);
  });

  it('an all-different hand draws 3', async () => {
    const def = buildDominionDef();
    def.setup.push(
      moveAll('dom_zone_hand', 'dom_zone_deck', { owner: 'p0' }),
      fromReserve('Menagerie'),
      dealNamed('Silver'),
      dealNamed('Gold'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    expect(count(state0, HAND('p0'))).toBe(3);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Menagerie') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(5); // Silver + Gold + 3 drawn
    expect(state.log.some((l) => l.text.includes('All different'))).toBe(true);
  });
});

describe('Farming Village', () => {
  it('+2 Actions; digs to the first Treasure, hands it over and discards the rest', async () => {
    const def = buildDominionDef();
    // p0's deck top after setup (top last): ..., Silver, Estate, Curse.
    def.setup.push(
      fromReserve('Farming Village'),
      dealNamed('Silver', 'dom_zone_deck'),
      dealNamed('Estate', 'dom_zone_deck'),
      dealNamed('Curse', 'dom_zone_deck'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Farming Village') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    expect(names(state, HAND('p0'))).toContain('Silver');
    expect(count(state, HAND('p0'))).toBe(6); // 6 - played + the Silver
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Curse', 'Estate']);
    expect(count(state, LOOK)).toBe(0);
  });
});

describe('Horse Traders', () => {
  it('on play: +1 Buy +$3, discard exactly 2', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Horse Traders'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, req.min));
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Horse Traders') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect((requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>).min).toBe(2);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(count(state, HAND('p0'))).toBe(3); // 6 - played - 2 discarded
    expect(count(state, DISCARD('p0'))).toBe(2);
  });

  it('reaction: set aside past a Militia (no immunity), then +1 Card and back to hand', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Horse Traders', 'dom_zone_hand', 'p1'),
      dealNamed('Militia', 'dom_zone_hand', 'p0'),
    );
    const { engine, errors } = probeEngine(def, (req) => {
      // Militia's discard-to-3 (the attack still hits — no immunity).
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, req.min));
    });
    await engine.start();
    let state = engine.getState();
    expect(count(state, HAND('p1'))).toBe(6);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Militia') });
    await driveWindow(engine, 'p1', 'dom_action_horse_traders');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    // Set aside into the DURATION zone; Militia still forced 5 → 3.
    expect(names(state, DURATION('p1'))).toEqual(['Horse Traders']);
    expect(count(state, HAND('p1'))).toBe(3);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);

    // The owner's next action phase: +1 Card and the card returns to hand.
    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DURATION('p1'))).toBe(0);
    expect(names(state, HAND('p1'))).toContain('Horse Traders');
    expect(count(state, HAND('p1'))).toBe(5); // 3 kept + 1 drawn + the card back
  });
});

describe('Remake', () => {
  it('twice: trash from hand, gain exactly $1 more (whiffing when nothing matches)', async () => {
    const def = buildDominionDef();
    def.setup.push(
      moveAll('dom_zone_hand', 'dom_zone_deck', { owner: 'p0' }),
      fromReserve('Remake'),
      dealNamed('Estate'),
      dealNamed('Copper'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card') {
        // Trash the Estate first (cost 2 → gain at 3), then the Copper
        // (cost 0 → nothing in the supply costs exactly 1: whiff).
        const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate');
        return estate ?? req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
      }
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Remake') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH).sort()).toEqual(['Copper', 'Estate']);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
    expect(count(state, HAND('p0'))).toBe(0);
    expect(state.log.some((l) => l.text.includes('costs exactly that much'))).toBe(true);
  });
});

describe('Tournament', () => {
  it('uncontested: discard a Province for a Prize onto the deck, plus +1 Card +$1', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Tournament'), dealNamed('Province'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'cards') return JSON.stringify(req.cardIds.slice(0, 1)); // reveal the Province
      if (req.kind === 'option') return 'tourn_prize';
      if (req.kind === 'pile') {
        expect(req.revealed).toBe(true);
        expect(req.cardIds.map((id) => state.cards[id].name).sort()).toEqual(
          ['Bag of Gold', 'Diadem', 'Followers', 'Princess', 'Trusty Steed'],
        );
        return req.cardIds.find((id) => state.cards[id].name === 'Trusty Steed')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    expect(count(state, PRIZES)).toBe(5);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Tournament') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['cards', 'option', 'pile']);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(names(state, DISCARD('p0'))).toEqual(['Province']);
    expect(count(state, PRIZES)).toBe(4);
    // Nobody else revealed: +1 Card and +$1 — and the +1 Card draws the
    // Prize just gained onto the deck (the official interaction).
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(count(state, HAND('p0'))).toBe(6); // 7 - Tournament - Province + 1 drawn
    expect(names(state, HAND('p0'))).toContain('Trusty Steed');
  });

  it('a revealed opposing Province blocks the +1 Card +$1 bonus', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Tournament'),
      dealNamed('Province'),
      dealNamed('Province', 'dom_zone_hand', 'p1'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'option') {
        if (req.options.some((o) => o.id === 'tourn_reveal')) return 'tourn_reveal';
        return 'tourn_prize';
      }
      if (req.kind === 'cards') return JSON.stringify(req.cardIds.slice(0, 1));
      if (req.kind === 'pile') return req.cardIds.find((id) => state.cards[id].name === 'Bag of Gold')!;
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Tournament') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes('reveals a Province'))).toBe(true);
    expect(topName(state, DECK('p0'))).toBe('Bag of Gold');
    // The opponent's reveal kills the bonus — no coin, no extra card.
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(count(state, HAND('p0'))).toBe(5); // 7 - Tournament - Province
    // The opponent only SHOWED the Province — it stays in their hand.
    expect(names(state, HAND('p1'))).toContain('Province');
  });
});

describe('Young Witch', () => {
  it('+2 Cards, discard 2; the opponent gains a Curse (no Bane escape — see the module header)', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Young Witch'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, req.min));
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Young Witch') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect((requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>).min).toBe(2);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - played + 2 - 2
    expect(names(state, DISCARD('p1'))).toEqual(['Curse']);
    expect(countOf(state, SUPPLY, 'Curse')).toBe(9);
  });

  it('a revealed Moat blocks the Curse', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Young Witch'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, req.min));
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Young Witch') });
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DISCARD('p1'))).toBe(0);
    expect(countOf(state, SUPPLY, 'Curse')).toBe(10);
  });
});

describe('Harvest', () => {
  it('reveals the top 4, pays +$1 per distinct name, then discards them', async () => {
    const def = buildDominionDef();
    // Top 4 after setup (top last): Copper, Copper, Silver, Estate → 3 names.
    def.setup.push(
      fromReserve('Harvest'),
      dealNamed('Estate', 'dom_zone_deck'),
      dealNamed('Silver', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Harvest') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3); // Copper, Silver, Estate
    expect(count(state, DISCARD('p0'))).toBe(4);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Copper', 'Copper', 'Estate', 'Silver']);
    expect(count(state, LOOK)).toBe(0);
    expect(count(state, DECK('p0'))).toBe(5); // the starter rest, untouched
  });
});

describe('Horn of Plenty', () => {
  it('caps the gain at $1 per differently named card in play; a Victory gain trashes it', async () => {
    const def = buildDominionDef();
    // In play: Village, Village, Silver — with the Horn itself: 3 names.
    def.setup.push(
      fromReserve('Horn of Plenty'),
      dealNamed('Village', 'dom_zone_inplay', 'p0'),
      dealNamed('Village', 'dom_zone_inplay', 'p0'),
      dealNamed('Silver', 'dom_zone_inplay', 'p0'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      const offered = req.cardIds.map((id) => state.cards[id].name);
      expect(offered).toContain('Silver'); // cost 3 — at the cap
      expect(offered).toContain('Estate'); // cost 2
      expect(offered).toContain('Village'); // cost 3
      expect(offered).not.toContain('Smithy'); // cost 4 — beyond it
      expect(offered).not.toContain('Duchy'); // cost 5
      expect(offered).not.toContain('Gold'); // cost 6
      return req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Horn of Plenty'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(0); // worth $0
    expect(names(state, DISCARD('p0'))).toEqual(['Estate']);
    // The Estate is a Victory card — the Horn burned itself.
    expect(names(state, TRASH)).toEqual(['Horn of Plenty']);
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Silver', 'Village', 'Village']);
  });

  it('a non-Victory gain leaves the Horn in play', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Horn of Plenty'),
      dealNamed('Village', 'dom_zone_inplay', 'p0'),
      dealNamed('Silver', 'dom_zone_inplay', 'p0'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Horn of Plenty'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
    expect(count(state, TRASH)).toBe(0);
    expect(names(state, INPLAY('p0'))).toContain('Horn of Plenty');
  });
});

describe('Hunting Party', () => {
  it('digs past duplicates of the hand and pockets the first new name', async () => {
    const def = buildDominionDef();
    // Hand: Hunting Party, Copper, Estate. Deck top (top last): Silver,
    // Copper, Copper → the +1 Card draws a Copper; the dig skips the next
    // Copper (duplicate) and stops at the Silver.
    def.setup.push(
      moveAll('dom_zone_hand', 'dom_zone_deck', { owner: 'p0' }),
      fromReserve('Hunting Party'),
      dealNamed('Copper'),
      dealNamed('Estate'),
      dealNamed('Silver', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    expect(count(state0, HAND('p0'))).toBe(3);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Hunting Party') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, HAND('p0')).sort()).toEqual(['Copper', 'Copper', 'Estate', 'Silver']);
    expect(names(state, DISCARD('p0'))).toEqual(['Copper']); // the dug-past duplicate
    expect(count(state, LOOK)).toBe(0);
  });
});

describe('Jester', () => {
  it('a discarded Victory card means a Curse for the victim', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Jester'), dealNamed('Estate', 'dom_zone_deck', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Jester') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, DISCARD('p1')).sort()).toEqual(['Curse', 'Estate']);
  });

  it('otherwise the OWNER chooses who gains the supply copy', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Jester'), dealNamed('Silver', 'dom_zone_deck', 'p1'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'jester_me';
    });
    await engine.start();
    const state0 = engine.getState();
    const silverBefore = countOf(state0, SUPPLY, 'Silver');
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Jester') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].playerId).toBe('p0'); // the Jester's owner picks
    expect(names(state, DISCARD('p1'))).toEqual(['Silver']); // the discarded one
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']); // the copy
    expect(countOf(state, SUPPLY, 'Silver')).toBe(silverBefore - 1);
  });
});

describe('Fairgrounds', () => {
  it('scores 2 VP per full 5 differently named cards owned, per Fairgrounds', async () => {
    const def = buildDominionDef();
    // p0 owns 10 distinct names: Copper + Estate (starters) + these eight.
    def.setup.push(
      fromReserve('Fairgrounds', 'dom_zone_deck'),
      dealNamed('Silver', 'dom_zone_deck'),
      dealNamed('Gold', 'dom_zone_deck'),
      dealNamed('Duchy', 'dom_zone_deck'),
      dealNamed('Curse', 'dom_zone_deck'),
      dealNamed('Village', 'dom_zone_deck'),
      dealNamed('Smithy', 'dom_zone_deck'),
      dealNamed('Moat', 'dom_zone_deck'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await endTurn(engine, 'p0'); // the turnEnd recount scores the deck
    const state = engine.getState();
    expect(errors).toEqual([]);
    // Printed VP: 3 Estates (3) + Duchy (3) - Curse (1) = 5; Fairgrounds
    // term: 1 Fairgrounds × 2 VP × floor(10 distinct / 5) = 4. Total 9.
    expect(state.players[0].vars['dom_var_vp']).toBe(9);
    // The opponent owns no Fairgrounds — plain 3 Estates.
    expect(state.players[1].vars['dom_var_vp']).toBe(3);
  });
});

describe('Bag of Gold (Prize)', () => {
  it('+1 Action; gains a Gold onto the deck', async () => {
    const def = buildDominionDef();
    def.setup.push(fromPrizes('Bag of Gold'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    expect(count(state, PRIZES)).toBe(4); // one prize dealt out
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Bag of Gold') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(topName(state, DECK('p0'))).toBe('Gold');
    expect(countOf(state, SUPPLY, 'Gold')).toBe(29);
  });
});

describe('Diadem (Prize)', () => {
  it('worth $2 plus $1 per unused Action', async () => {
    const def = buildDominionDef();
    def.setup.push(fromPrizes('Diadem'), dealNamed('Village'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    // Village first: 1 - 1 + 2 = 2 unused Actions.
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(2);
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Diadem'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(4); // $2 field + 2 Actions
  });
});

describe('Followers (Prize)', () => {
  it('+2 Cards, gains an Estate; the opponent takes a Curse and discards to 3', async () => {
    const def = buildDominionDef();
    def.setup.push(fromPrizes('Followers'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, req.min));
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Followers') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - played + 2 drawn
    expect(names(state, DISCARD('p0'))).toEqual(['Estate']);
    expect(count(state, HAND('p1'))).toBe(3);
    expect(names(state, DISCARD('p1'))).toContain('Curse');
    expect(count(state, DISCARD('p1'))).toBe(3); // the Curse + 2 discards
  });
});

describe('Princess (Prize)', () => {
  it('+1 Buy and a $2 discount this turn (an Estate becomes free)', async () => {
    const def = buildDominionDef();
    def.setup.push(fromPrizes('Princess'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Princess') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    // Estate costs 2 → 0 under the royal discount.
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Estate'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Estate']);
    expect(state.players[0].vars['dom_var_coins']).toBe(0); // paid nothing
    expect(state.players[0].vars['dom_var_buys']).toBe(1);
  });
});

describe('Trusty Steed (Prize)', () => {
  it('grants two DIFFERENT boons; the Silvers option dumps the deck into the discard', async () => {
    const def = buildDominionDef();
    def.setup.push(fromPrizes('Trusty Steed'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return req.options.some((o) => o.id === 'ts_cards') && requests.length === 1
        ? 'ts_cards' : 'ts_silvers';
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Trusty Steed') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(2);
    // The second menu never offers the first pick — "must be different".
    const second = requests[1] as Extract<ChoiceRequest, { kind: 'option' }>;
    expect(second.options).toHaveLength(3);
    expect(second.options.some((o) => o.id === 'ts_cards')).toBe(false);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - played + 2 drawn
    expect(count(state, DECK('p0'))).toBe(0); // the deck poured out
    expect(countOf(state, DISCARD('p0'), 'Silver')).toBe(4);
    expect(count(state, DISCARD('p0'))).toBe(7); // 4 Silvers + 3 remaining deck cards
    expect(countOf(state, SUPPLY, 'Silver')).toBe(36);
  });
});
