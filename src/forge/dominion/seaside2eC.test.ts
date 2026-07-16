/**
 * Seaside 2E (part C) — deterministic per-card probes through the REAL
 * engine (dealNamed / probeEngine, seed 11). Cards under test start in the
 * hidden RESERVE (they belong to no lobby kingdom set) and are dealt with
 * fromZone 'dom_zone_reserve'. Every probe asserts zero script errors.
 *
 * REGISTRATION: seaside2eC is not wired into expansions.ts yet (the
 * integrator does that). dominionGame.ts builds its module-level tables
 * (KINGDOM_PILES, TYPE_LINE, EXPANSION_CARD_ID…) from EXPANSIONS at IMPORT
 * time, so the module is pushed into the array BEFORE dominionGame is
 * evaluated — hence the top-level dynamic import below. Vitest isolates
 * module registries per test file, so the push never leaks to other suites.
 */
import { describe, expect, it } from 'vitest';
import type {
  ChoiceRequest, EngineHandle, Expr, GameDef, GameState,
} from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import {
  BOUGHT_VICTORY_VAR, ISLAND_ZONE, NATIVE_VILLAGE_ZONE, seaside2eC,
} from './seaside2eC';
import { dealNamed, findNamed, probeEngine } from './testKit';

if (!EXPANSIONS.some((x) => x.id === seaside2eC.id)) EXPANSIONS.push(seaside2eC);
const { buildDominionDef } = await import('../dominionGame');

const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const DURATION = (p: string) => `dom_zone_duration:${p}`;
const ISLAND = (p: string) => `${ISLAND_ZONE}:${p}`;
const NATIVE = (p: string) => `${NATIVE_VILLAGE_ZONE}:${p}`;
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;

/** Setup block: move EVERY card matching between two zones (base2e idiom). */
function moveAll(fromZone: string, toZone: string, owner?: string): GameDef['setup'][number] {
  const who = owner !== undefined ? ({ kind: 'str', value: owner } as Expr) : null;
  return {
    kind: 'moveCards',
    from: { zoneId: fromZone, owner: who },
    to: { zoneId: toZone, owner: who },
    cards: { kind: 'all' },
    toPosition: 'top',
    faceUp: null,
  };
}

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');

const play = { actionId: 'dom_action_play' };

/** done → end turn → cleanup: pass the rest of `pid`'s turn. */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

describe('seaside2eC module registration', () => {
  const def = buildDominionDef();

  it('validates clean and knows all eight cards with their costs', () => {
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      'Native Village': 2, Island: 4, Salvager: 4, Sailor: 4,
      'Tide Pools': 4, 'Treasure Map': 4, Tactician: 5, Treasury: 5,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
    }
  });

  it('contributes the two per-player mats and the Treasury flag', () => {
    const island = def.zones.find((z) => z.id === ISLAND_ZONE);
    expect(island).toMatchObject({ owner: 'perPlayer', visibility: 'all', layout: 'row', area: 'player' });
    const native = def.zones.find((z) => z.id === NATIVE_VILLAGE_ZONE);
    expect(native).toMatchObject({ owner: 'perPlayer', visibility: 'owner' });
    expect(def.variables.some((v) => v.id === BOUGHT_VICTORY_VAR)).toBe(true);
  });

  it('Island is Action-typed with printed VP 2 (documented deviation)', () => {
    const island = def.cards.find((c) => c.name === 'Island')!;
    expect(island.typeId).toBe('dom_type_action'); // playable — NOT Victory-typed
    expect(island.fields['dom_field_vp']).toBe(2);
  });
});

describe('Island', () => {
  it('mats itself plus a chosen hand card; both score at the recount', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Island'), dealNamed('Estate'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Island') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(names(state, ISLAND('p0')).sort()).toEqual(['Estate', 'Island']);
    expect(count(state, INPLAY('p0'))).toBe(0); // Island left play for the mat
    expect(count(state, HAND('p0'))).toBe(5); // 7 - Island played - Estate matted

    // The turn-end recount scores the mat: 3 owned Estates (starter 3 + the
    // dealt one - the matted one) + mat Island 2 + mat Estate 1 = 6 VP.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, ISLAND('p0')).sort()).toEqual(['Estate', 'Island']); // cleanup never sweeps the mat
    expect(state.players[0].vars['dom_var_vp']).toBe(6);
    expect(state.players[1].vars['dom_var_vp']).toBe(3);
  });

  it('with an empty hand only Island itself is set aside (no choice opens)', async () => {
    const def = buildDominionDef();
    def.setup.push(moveAll('dom_zone_hand', 'dom_zone_deck', 'p0'), fromReserve('Island'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    expect(names(state0, HAND('p0'))).toEqual(['Island']);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Island') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, ISLAND('p0'))).toEqual(['Island']);
    expect(count(state, HAND('p0'))).toBe(0);
  });
});

describe('Native Village', () => {
  it('+2 Actions; stashes the deck top face down, then a second play scoops the mat', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Native Village'), fromReserve('Native Village'));
    let optionCalls = 0;
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      optionCalls += 1;
      return optionCalls === 1 ? 'nv_stash' : 'nv_take';
    });
    await engine.start();
    let state = engine.getState();
    const deckTopId = state.zones[DECK('p0')].cardIds.at(-1)!;

    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Native Village') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 play + 2
    expect(state.zones[NATIVE('p0')].cardIds).toEqual([deckTopId]);
    expect(state.cards[deckTopId].faceUp).toBe(false);
    expect(count(state, DECK('p0'))).toBe(4);

    const handBefore = count(state, HAND('p0'));
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Native Village') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(optionCalls).toBe(2);
    expect(count(state, NATIVE('p0'))).toBe(0);
    // played the second copy (-1) and took the stashed card back (+1)
    expect(count(state, HAND('p0'))).toBe(handBefore);
    expect(state.zones[HAND('p0')].cardIds).toContain(deckTopId);
    expect(state.players[0].vars['dom_var_actions']).toBe(3);
  });
});

describe('Salvager', () => {
  it('+1 Buy; trashes a hand card for its printed cost in coins', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Salvager'), dealNamed('Estate'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
    });
    await engine.start();
    const state0 = engine.getState();
    const handBefore = count(state0, HAND('p0'));
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Salvager') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // Estate's printed cost
    expect(names(state, TRASH)).toEqual(['Estate']);
    expect(count(state, HAND('p0'))).toBe(handBefore - 2);
  });

  it('an empty hand grants the Buy and trashes nothing', async () => {
    const def = buildDominionDef();
    def.setup.push(moveAll('dom_zone_hand', 'dom_zone_deck', 'p0'), fromReserve('Salvager'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Salvager') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(count(state, TRASH)).toBe(0);
  });
});

describe('Treasure Map', () => {
  it('trashing BOTH maps banks 4 Golds onto the deck', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Treasure Map'), fromReserve('Treasure Map'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Treasure Map') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Treasure Map', 'Treasure Map']);
    expect(count(state, INPLAY('p0'))).toBe(0); // the played copy went to the trash
    expect(count(state, DECK('p0'))).toBe(9); // 5 + 4 Golds
    expect(names(state, DECK('p0')).slice(-4)).toEqual(['Gold', 'Gold', 'Gold', 'Gold']);
    expect(names(state, SUPPLY).filter((n) => n === 'Gold')).toHaveLength(26);
    expect(count(state, HAND('p0'))).toBe(5); // 7 - played - the trashed second map
  });

  it('a lone map trashes itself and gains nothing', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Treasure Map'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Treasure Map') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Treasure Map']);
    expect(names(state, DECK('p0'))).not.toContain('Gold');
    expect(names(state, SUPPLY).filter((n) => n === 'Gold')).toHaveLength(30);
  });
});

describe('Tactician (Duration)', () => {
  it('discards the hand, waits out the off-turn, then +5 Cards +1 Buy +1 Action', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Tactician'));
    // Pad the deck so no probe leg needs a mid-assert reshuffle.
    for (let i = 0; i < 10; i += 1) def.setup.push(dealNamed('Copper', 'dom_zone_deck'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Tactician') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(0); // the whole hand went
    expect(count(state, DISCARD('p0'))).toBe(5);
    expect(names(state, DURATION('p0'))).toEqual(['Tactician']); // parked, not in play
    expect(count(state, INPLAY('p0'))).toBe(0);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Tactician']); // cleanup left it out
    expect(names(state, DISCARD('p0'))).not.toContain('Tactician');

    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    // p0's action phase began: the later half fired and the card marched back.
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(names(state, INPLAY('p0'))).toEqual(['Tactician']);
    expect(count(state, HAND('p0'))).toBe(10); // 5 redrawn + 5 from Tactician
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_actions']).toBe(2);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Tactician'); // normal cleanup now
    expect(count(state, DURATION('p0'))).toBe(0);
  });

  it('an empty hand does nothing and does NOT park — no next-turn bonus', async () => {
    const def = buildDominionDef();
    def.setup.push(moveAll('dom_zone_hand', 'dom_zone_deck', 'p0'), fromReserve('Tactician'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    let state = engine.getState();
    expect(names(state, HAND('p0'))).toEqual(['Tactician']);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Tactician') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, INPLAY('p0'))).toEqual(['Tactician']); // stayed in play
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(count(state, DISCARD('p0'))).toBe(0);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DISCARD('p0'))).toContain('Tactician'); // swept like any action

    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(5); // no +5
    expect(state.players[0].vars['dom_var_buys']).toBe(1);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
  });
});

describe('Sailor (Duration)', () => {
  it('+1 Action now; +$2 and an optional trash at the start of the next turn', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Sailor'));
    for (let i = 0; i < 5; i += 1) def.setup.push(dealNamed('Copper', 'dom_zone_deck'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify([req.cardIds[0]]); // accept the optional trash
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Sailor') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 play + 1
    expect(names(state, DURATION('p0'))).toEqual(['Sailor']);
    expect(count(state, INPLAY('p0'))).toBe(0);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Sailor']); // survived cleanup

    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const trashReq = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(trashReq.min).toBe(0); // "may" — declining is legal
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(count(state, TRASH)).toBe(1);
    expect(count(state, HAND('p0'))).toBe(4);
    expect(names(state, INPLAY('p0'))).toEqual(['Sailor']);
    expect(count(state, DURATION('p0'))).toBe(0);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Sailor');
  });
});

describe('Tide Pools (Duration)', () => {
  it('+3 Cards +1 Action now; discards 2 at the start of the next turn', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Tide Pools'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, 2));
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Tide Pools') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // 6 - played + 3
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, DURATION('p0'))).toEqual(['Tide Pools']);
    expect(count(state, INPLAY('p0'))).toBe(0);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Tide Pools']); // NOT discarded
    expect(names(state, DISCARD('p0'))).not.toContain('Tide Pools');

    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect((requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>).min).toBe(2);
    expect(count(state, HAND('p0'))).toBe(3); // 5 redrawn - 2 discarded
    expect(count(state, DISCARD('p0'))).toBe(2);
    expect(names(state, INPLAY('p0'))).toEqual(['Tide Pools']); // marched back
    expect(count(state, DURATION('p0'))).toBe(0);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Tide Pools'); // that cleanup discards it
  });
});

describe('Throne Room + a Duration', () => {
  it('Tide Pools: now runs twice, the card parks once, later fires once', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Throne Room'),
      fromReserve('Tide Pools'),
      dealNamed('Copper', 'dom_zone_deck'), // 6 in the deck: two full draws of 3
    );
    let discardRequests = 0;
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Tide Pools')!;
      }
      if (req.kind === 'cards') {
        discardRequests += 1;
        return JSON.stringify(req.cardIds.slice(0, 2));
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Throne Room') });
    state = engine.getState();
    expect(errors).toEqual([]);
    // Now ran twice: 7 - Throne Room - Tide Pools + 3 + 3 = 11 cards, +2 Actions.
    expect(count(state, HAND('p0'))).toBe(11);
    expect(state.players[0].vars['dom_var_actions']).toBe(2);
    // ...but the card parked exactly ONCE.
    expect(names(state, DURATION('p0'))).toEqual(['Tide Pools']);
    expect(names(state, INPLAY('p0'))).toEqual(['Throne Room']);

    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(discardRequests).toBe(1); // later fired exactly once
    expect(names(state, INPLAY('p0'))).toEqual(['Tide Pools']);
    expect(count(state, DURATION('p0'))).toBe(0);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Tide Pools');
  });
});

describe('Treasury', () => {
  it('+1 Card +1 Action +$1; with no Victory bought it rides the deck into the next hand', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Treasury'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Treasury') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - played + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    // Topdecked at the cleanup phase's start (deck was then Treasury + 4),
    // so the 5-card redraw pulled it straight back — the printed outcome.
    expect(names(state, HAND('p0'))).toContain('Treasury');
    expect(names(state, DISCARD('p0'))).not.toContain('Treasury');
    expect(state.players[0].vars[BOUGHT_VICTORY_VAR]).toBe(0);
  });

  it('buying a Victory card keeps Treasury in the discard; the flag resets after', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Treasury'),
      dealNamed('Copper'), dealNamed('Copper'),
      dealNamed('Copper', 'dom_zone_deck'), // keeps the cleanup redraw reshuffle-free
    );
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Treasury') });
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Copper'),
    });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Copper'),
    });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(3); // Treasury 1 + 2 Coppers
    const estateId = state.zones[SUPPLY].cardIds.find((id) => state.cards[id].name === 'Estate')!;
    await engine.performAction('p0', { actionId: 'dom_action_buy', cardId: estateId });
    state = engine.getState();
    expect(state.players[0].vars[BOUGHT_VICTORY_VAR]).toBe(1); // the flag went up

    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Treasury'); // no return this turn
    expect(names(state, HAND('p0'))).not.toContain('Treasury');
    expect(state.players[0].vars[BOUGHT_VICTORY_VAR]).toBe(0); // reset at cleanup
  });
});
