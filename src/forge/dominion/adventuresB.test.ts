/**
 * Adventures (part B) — deterministic per-card probes through the REAL
 * engine: the multi-turn Duration halves (Amulet / Caravan Guard / Dungeon /
 * Gear / Bridge Troll / Haunted Woods / Swamp Hag), Hireling firing across
 * three owner turns from its permanent DURATION parking spot, the shared
 * Journey / -1 Card / -$1 tokens (adventuresEvents' vars), the stacked
 * attack windows, and the on-buy/on-gain watchers (Messenger's first-buy
 * gate, Port's pair, Lost City's gift draw).
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers adventuresB (AFTER
 * adventuresEvents, whose shared token vars it reads), freshDef() can
 * become a plain static `buildDominionDef` import.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceAnswer, ChoiceRequest, EngineHandle, GameDef, GameState } from '../../shared/types';
import { PASS_ACTION_ID } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { adventuresB, BUYS_MADE_VAR, GEAR_ZONE, HAUNTED_VAR, HEXED_VAR } from './adventuresB';
import { JOURNEY, MINUS_CARD, MINUS_COIN } from './adventuresEvents';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(adventuresB)) EXPANSIONS.push(adventuresB);
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
const GEAR = (p: string) => `${GEAR_ZONE}:${p}`;
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

/** A queue of one-shot answer functions, consumed request by request. */
function answerQueue(
  ...fns: ((req: ChoiceRequest, state: GameState) => ChoiceAnswer)[]
): (req: ChoiceRequest, state: GameState) => ChoiceAnswer {
  let i = 0;
  return (req, state) => {
    if (i >= fns.length) throw new Error(`unexpected extra ${req.kind} choice: ${req.prompt}`);
    const fn = fns[i];
    i += 1;
    return fn(req, state);
  };
}

/** Answer a 'cards' request with the first N cards of the given name. */
const pickCards = (name: string, n: number) => (req: ChoiceRequest, state: GameState): ChoiceAnswer => {
  if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
  const ids = req.cardIds.filter((id) => state.cards[id].name === name).slice(0, n);
  if (ids.length !== n) throw new Error(`wanted ${n} × ${name}`);
  return JSON.stringify(ids);
};
/** Answer a 'card'/'pile' request with the first candidate of the name. */
const pickOne = (name: string) => (req: ChoiceRequest, state: GameState): ChoiceAnswer => {
  if (req.kind !== 'card' && req.kind !== 'pile') throw new Error(`expected card/pile, got ${req.kind}`);
  const id = req.cardIds.find((cid) => state.cards[cid].name === name);
  if (id === undefined) throw new Error(`no ${name} offered`);
  return id;
};
/** Answer an 'option' request with the given option id. */
const pickOption = (optionId: string) => (req: ChoiceRequest): ChoiceAnswer => {
  if (req.kind !== 'option') throw new Error(`expected option, got ${req.kind}`);
  return optionId;
};
/** Answer any 'card'/'pile' request with its first candidate. */
const firstCard = (req: ChoiceRequest): ChoiceAnswer => {
  if (req.kind !== 'card' && req.kind !== 'pile') throw new Error(`expected card/pile, got ${req.kind}`);
  return req.cardIds[0];
};

/** Action → Buy → Cleanup → the turn passes (nothing gets played). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

/**
 * Drive an open response window: every holder passes, except that `useFor`
 * performs `actionId` ONCE when it is legal (seaside2eA's driveWindow shape
 * — Caravan Guard instead of Moat).
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

describe('adventuresB module registration', () => {
  it('validates clean and knows all nineteen cards with costs, types and tags', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Raze: 2, Amulet: 3, 'Caravan Guard': 3, Dungeon: 3, Gear: 3,
      Magpie: 4, Messenger: 4, Port: 4, Ranger: 4,
      Artificer: 5, 'Bridge Troll': 5, Giant: 5, 'Haunted Woods': 5, 'Lost City': 5,
      Relic: 5, Storyteller: 5, 'Swamp Hag': 5, 'Treasure Trove': 5, Hireling: 6,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
    }
    // Primary types: Relic and Treasure Trove are the module's Treasures
    // (playable by the treasure action, coin field 2); the rest are Actions.
    expect(def.cards.find((c) => c.name === 'Relic')!.typeId).toBe('dom_type_treasure');
    expect(def.cards.find((c) => c.name === 'Relic')!.fields['dom_field_coins']).toBe(2);
    expect(def.cards.find((c) => c.name === 'Treasure Trove')!.typeId).toBe('dom_type_treasure');
    expect(def.cards.find((c) => c.name === 'Treasure Trove')!.fields['dom_field_coins']).toBe(2);
    expect(def.cards.find((c) => c.name === 'Hireling')!.typeId).toBe('dom_type_action');
    // Type-line tags: the five attacks; Caravan Guard the one Reaction.
    for (const name of ['Bridge Troll', 'Giant', 'Haunted Woods', 'Relic', 'Swamp Hag']) {
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} is an Attack`)
        .toContain('dom_tag_attack');
    }
    expect(def.cards.find((c) => c.name === 'Caravan Guard')!.tags).toContain('dom_tag_reaction');
    expect(def.cards.find((c) => c.name === 'Magpie')!.tags).not.toContain('dom_tag_attack');
    // Caravan Guard's reaction is the module's own response action.
    expect(def.actions.some((a) => a.id === 'dom_action_caravan_guard')).toBe(true);
    // Kingdom stock: 10 copies per pile.
    const deck = def.decks.find((d) => d.id === 'dom_deck_kingdom')!;
    expect(deck.source.kind).toBe('custom');
    if (deck.source.kind === 'custom') {
      for (const id of Object.values(adventuresB.ids)) {
        const entry = deck.source.entries.find((en) => en.cardId === id);
        expect(entry, `${id} in the kingdom deck`).toBeDefined();
        expect(entry!.count).toBe(10);
      }
    }
  });
});

describe('Raze', () => {
  it('trashes itself: looks at 2 (its printed cost), keeps 1, discards 1', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Raze'));
    const { engine, errors } = probeEngine(def, answerQueue(
      pickOption('raze_self'),
      firstCard, // keep the first looked-at card
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Raze') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Raze']);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Raze + 1 kept
    expect(count(state, DECK('p0'))).toBe(3); // 5 - 2 looked at
    expect(count(state, DISCARD('p0'))).toBe(1); // the unpicked look
    expect(count(state, INPLAY('p0'))).toBe(0);
  });

  it('trashes a $0 Copper: no look, nothing kept', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Raze'), dealNamed('Copper'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'option') return 'raze_hand';
      if (req.kind === 'card') return req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Raze') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['option', 'card']); // no look choice
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(names(state, INPLAY('p0'))).toEqual(['Raze']);
    expect(count(state, DECK('p0'))).toBe(5); // untouched — $0 buys no look
  });
});

describe('Amulet (Duration)', () => {
  it('trashes now, gains a Silver at the next turn start', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Amulet'), dealNamed('Copper'));
    const { engine, errors } = probeEngine(def, answerQueue(
      pickOption('am_trash'),
      pickOne('Copper'),
      pickOption('am_silver'),
    ));
    await engine.start();

    // T1 (p0): the now half trashes the Copper, then the Amulet parks.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Amulet') });
    state = engine.getState();
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(names(state, DURATION('p0'))).toEqual(['Amulet']);
    expect(count(state, INPLAY('p0'))).toBe(0);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Amulet']); // cleanup spares it
    await passTurn(engine, 'p1');

    // T3 (p0): the later half chooses "gain a Silver"; the Amulet marches back.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Silver');
    expect(names(state, INPLAY('p0'))).toEqual(['Amulet']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Caravan Guard (Duration - Reaction)', () => {
  it('on your own turn: +1 Card +1 Action now, +$1 at the next turn start', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Caravan Guard'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Caravan Guard') });
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(6); // 6 - CG + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(names(state, DURATION('p0'))).toEqual(['Caravan Guard']);

    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Caravan Guard']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });

  it('reaction: plays mid-attack, the off-turn +1 Action is suppressed, +$1 comes home', async () => {
    const def = await freshDef();
    // The CG rides p0's deck top so the T1 cleanup redraw brings it to hand;
    // Militia (default kingdom) goes straight to p1's untouched hand.
    def.setup.push(
      fromReserve('Caravan Guard', 'dom_zone_deck', 'p0'),
      dealNamed('Militia', 'dom_zone_hand', 'p1'),
    );
    const { engine, errors } = probeEngine(def, (req) => {
      // Militia's discard-down-to-3 after the Caravan Guard has played.
      if (req.kind === 'cards') return JSON.stringify(req.cardIds.slice(0, req.min));
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await passTurn(engine, 'p0');
    let state = engine.getState();
    expect(names(state, HAND('p0'))).toContain('Caravan Guard');

    // T2 (p1): Militia attacks; p0 plays the Caravan Guard in the window.
    state = engine.getState();
    await engine.performAction('p1', { ...play, cardId: findNamed(state, HAND('p1'), 'Militia') });
    await driveWindow(engine, 'p0', 'dom_action_caravan_guard');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    // Parked mid-attack; the +1 Card fired, the off-turn +1 Action did not.
    expect(names(state, DURATION('p0'))).toEqual(['Caravan Guard']);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // NOT 2
    // Militia still hit: p0 is down to 3 cards.
    expect(count(state, HAND('p0'))).toBe(3);
    await passTurn(engine, 'p1');

    // T3 (p0): the later +$1, and the Caravan Guard is back in play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Caravan Guard']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Dungeon (Duration)', () => {
  it('+1 Action; +2 Cards then discard 2, on both turns', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Dungeon'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, req.min));
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Dungeon') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Dungeon + 2 - 2
    expect(count(state, DISCARD('p0'))).toBe(2);
    expect(names(state, DURATION('p0'))).toEqual(['Dungeon']);
    const req0 = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req0.min).toBe(2);
    expect(req0.max).toBe(2);

    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(2); // one discard pick per half
    expect(count(state, HAND('p0'))).toBe(5); // 5 redrawn + 2 - 2
    expect(names(state, INPLAY('p0'))).toEqual(['Dungeon']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Gear (Duration)', () => {
  it('sets 2 cards aside face down on the mat; they come home next turn', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Gear'));
    const { engine, errors } = probeEngine(def, answerQueue((req) => {
      if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
      return JSON.stringify(req.cardIds.slice(0, 2)); // set 2 aside
    }));
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Gear') });
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Gear + 2 drawn - 2 aside
    expect(count(state, GEAR('p0'))).toBe(2);
    expect(state.cards[state.zones[GEAR('p0')].cardIds[0]].faceUp).toBe(false);
    expect(names(state, DURATION('p0'))).toEqual(['Gear']);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(count(state, GEAR('p0'))).toBe(2); // the mat survives cleanup
    await passTurn(engine, 'p1');

    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, GEAR('p0'))).toBe(0);
    expect(count(state, HAND('p0'))).toBe(7); // 5 redrawn + 2 from the mat
    expect(names(state, INPLAY('p0'))).toEqual(['Gear']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Magpie', () => {
  it('a revealed Treasure joins the hand', async () => {
    const def = await freshDef();
    // Deck top (last dealt lands on top): Gold — drawn by the +1 Card —
    // then the Silver beneath is the reveal.
    def.setup.push(fromReserve('Magpie'), dealNamed('Silver', 'dom_zone_deck'), dealNamed('Gold', 'dom_zone_deck'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Magpie') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p0'))).toContain('Gold');
    expect(names(state, HAND('p0'))).toContain('Silver');
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Magpie + Gold + Silver
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
  });

  it('a revealed Victory card gains a Magpie and returns to the deck top', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Magpie'),
      dealNamed('Magpie', 'dom_zone_supply', null, 'dom_zone_reserve'),
      dealNamed('Estate', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Magpie') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Magpie']); // the gained copy
    expect(topName(state, DECK('p0'))).toBe('Estate'); // the reveal went back
    expect(names(state, SUPPLY)).not.toContain('Magpie'); // the promoted copy is gone
  });
});

describe('Messenger', () => {
  it('+1 Buy +$2, and may put the deck into the discard pile', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Messenger'));
    const { engine, errors } = probeEngine(def, answerQueue((req) => {
      if (req.kind !== 'yesNo') throw new Error(`expected yesNo, got ${req.kind}`);
      return true;
    }));
    await engine.start();
    const state0 = engine.getState();
    const deckBefore = count(state0, DECK('p0'));
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Messenger') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(count(state, DECK('p0'))).toBe(0);
    expect(count(state, DISCARD('p0'))).toBe(deckBefore);
  });

  it('bought FIRST: gains up to $4 and every rival gets a copy; the counter fades at cleanup', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Messenger', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 4),
    );
    const { engine, errors } = probeEngine(def, answerQueue(pickOne('Silver')));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Messenger'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars[BUYS_MADE_VAR]).toBe(1);
    expect(names(state, DISCARD('p0'))).toContain('Messenger');
    expect(names(state, DISCARD('p0'))).toContain('Silver');
    expect(names(state, DISCARD('p1'))).toEqual(['Silver']); // the rival's copy
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars[BUYS_MADE_VAR]).toBe(0);
  });

  it('bought SECOND: no gain, no copies (the printed first-buy gate)', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Messenger', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 8),
      giveVar('dom_var_buys', 'p0', 2),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Messenger'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toEqual([]); // the gift never fired
    expect(count(state, DISCARD('p1'))).toBe(0);
    expect(state.log.some((l) => l.text.includes('not the first buy'))).toBe(true);
  });
});

describe('Port', () => {
  it('+1 Card +2 Actions on play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Port'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Port') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
  });

  it('buying one gains another (the gained one never re-triggers)', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Port', 'dom_zone_supply', null, 'dom_zone_reserve'),
      dealNamed('Port', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 4),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Port'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0')).filter((n) => n === 'Port')).toHaveLength(2);
    expect(names(state, SUPPLY)).not.toContain('Port'); // both promoted copies left
  });
});

describe('Ranger', () => {
  it('first flip lands face down (no draw); the second pays +5 Cards', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Ranger'), fromReserve('Ranger'), giveVar('dom_var_actions', 'p0', 2));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Ranger') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars[JOURNEY]).toBe(0);
    expect(count(state, HAND('p0'))).toBe(6); // 7 - Ranger, nothing drawn

    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Ranger') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(3);
    expect(state.players[0].vars[JOURNEY]).toBe(1);
    expect(count(state, HAND('p0'))).toBe(10); // 6 - Ranger + 5 drawn
  });
});

describe('Artificer', () => {
  it('discards 2, then gains an exactly-$2 card onto the deck', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Artificer'));
    const { engine, errors } = probeEngine(def, answerQueue(
      (req) => {
        if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
        return JSON.stringify(req.cardIds.slice(0, 2));
      },
      pickOne('Estate'),
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Artificer') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(count(state, DISCARD('p0'))).toBe(2);
    expect(topName(state, DECK('p0'))).toBe('Estate'); // gained onto the deck
    expect(count(state, HAND('p0'))).toBe(4); // 6 - Artificer + 1 drawn - 2 discarded
  });
});

describe('Giant (Attack)', () => {
  it('face-down flip: +$1 and nobody is attacked (the window still opens)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Giant'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Giant') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.players[0].vars[JOURNEY]).toBe(0);
    expect(count(state, DECK('p1'))).toBe(5); // untouched
    expect(count(state, TRASH)).toBe(0);
  });

  it('face-up flip: +$5, a $3-$6 reveal is trashed', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Giant'),
      giveVar(JOURNEY, 'p0', 0), // pre-flipped: this play turns it face up
      dealNamed('Silver', 'dom_zone_deck', 'p1'), // cost 3 — in the range
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Giant') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(5);
    expect(state.players[0].vars[JOURNEY]).toBe(1);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(count(state, DISCARD('p1'))).toBe(0);
  });

  it('face-up flip: a cheap reveal is discarded and grows a Curse', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Giant'),
      giveVar(JOURNEY, 'p0', 0),
      dealNamed('Copper', 'dom_zone_deck', 'p1'), // cost 0 — out of range
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Giant') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, TRASH)).toBe(0);
    expect(names(state, DISCARD('p1'))).toContain('Copper');
    expect(names(state, DISCARD('p1'))).toContain('Curse');
  });
});

describe('Bridge Troll (Duration - Attack)', () => {
  it('tokens the opponent, discounts both of its turns, pays +1 Buy twice', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Bridge Troll'),
      giveVar('dom_var_coins', 'p0', 2),
      dealNamed('Silver', 'dom_zone_hand', 'p1'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): play the troll; the window passes; the opponent is tokened.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Bridge Troll') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(state.players[0].vars['dom_var_buys']).toBe(2); // 1 + 1 now
    expect(state.players[1].vars[MINUS_COIN]).toBe(1);
    expect(state.globalVars['dom_var_cost_discount']).toBe(1);
    expect(names(state, DURATION('p0'))).toEqual(['Bridge Troll']);

    // The discount is real: $2 buys the $3 Silver.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Silver'),
    });
    state = engine.getState();
    expect(names(state, DISCARD('p0'))).toContain('Silver');
    expect(state.players[0].vars['dom_var_coins']).toBe(0); // paid 2, not 3
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });

    // T2 (p1): the -$1 token bites the next Treasure play.
    state = engine.getState();
    expect(state.globalVars['dom_var_cost_discount']).toBe(0); // reset — the troll rests
    await engine.performAction('p1', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p1', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p1'), 'Silver'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[1].vars['dom_var_coins']).toBe(1); // 2 - 1 token
    expect(state.players[1].vars[MINUS_COIN]).toBe(0);
    await engine.performAction('p1', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p1', { actionId: 'dom_action_cleanup' });

    // T3 (p0): the later half — +1 Buy and the discount again, back in play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2); // 1 + 1 later
    expect(state.globalVars['dom_var_cost_discount']).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Bridge Troll']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Haunted Woods (Duration - Attack)', () => {
  it("haunts the opponent's buy (whole hand topdecked), then +3 Cards later", async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Haunted Woods'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): the woods park at once; the opponent is marked.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Haunted Woods') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Haunted Woods']);
    expect(state.players[1].vars[HAUNTED_VAR]).toBe(1);
    await passTurn(engine, 'p0');

    // T2 (p1): the buy topdecks p1's whole hand.
    await engine.performAction('p1', { actionId: 'dom_action_done' });
    state = engine.getState();
    const deckBefore = count(state, DECK('p1'));
    await engine.performAction('p1', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(0);
    expect(count(state, DECK('p1'))).toBe(deckBefore + 5);
    await engine.performAction('p1', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p1', { actionId: 'dom_action_cleanup' });

    // T3 (p0): +3 Cards, the woods clear and march back.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // 5 redrawn + 3
    expect(names(state, INPLAY('p0'))).toEqual(['Haunted Woods']);
    expect(state.players[1].vars[HAUNTED_VAR]).toBe(0);
  });
});

describe('Swamp Hag (Duration - Attack)', () => {
  it("hexes the opponent's buys into Curses, then pays +$3 later", async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Swamp Hag'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Swamp Hag') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Swamp Hag']);
    expect(state.players[1].vars[HEXED_VAR]).toBe(1);
    await passTurn(engine, 'p0');

    // T2 (p1): the buy grows a Curse.
    await engine.performAction('p1', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p1', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p1'))).toContain('Copper');
    expect(names(state, DISCARD('p1'))).toContain('Curse');
    await engine.performAction('p1', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p1', { actionId: 'dom_action_cleanup' });

    // T3 (p0): +$3 and the hag departs.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(names(state, INPLAY('p0'))).toEqual(['Swamp Hag']);
    expect(state.players[1].vars[HEXED_VAR]).toBe(0);
  });

  it('a revealed Moat waves off the whole haunting: no hex, no Curse', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Swamp Hag'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Swamp Hag') });
    await playOutWindows(engine, 'p1'); // p1 reveals the Moat
    state = engine.getState();
    expect(state.players[1].vars[HEXED_VAR]).toBe(0);
    await passTurn(engine, 'p0');

    await engine.performAction('p1', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p1', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p1'))).not.toContain('Curse');
  });
});

describe('Hireling (permanent Duration)', () => {
  it('parks for good and draws +1 Card at the start of every owner turn', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Hireling'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): no immediate effect — it just signs on.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Hireling') });
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Hireling']);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Hireling, nothing drawn
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Hireling']); // cleanup spares it
    await passTurn(engine, 'p1');

    // T3 (p0's 2nd turn): +1 Card, and it STAYS parked.
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + 1
    expect(names(state, DURATION('p0'))).toEqual(['Hireling']);
    expect(count(state, INPLAY('p0'))).toBe(0);
    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T5 (p0's 3rd turn): again — the rest of the game means the rest of it.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6);
    expect(names(state, DURATION('p0'))).toEqual(['Hireling']);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(state.log.filter((l) => l.text.includes('Hireling reports for duty'))).toHaveLength(2);
  });
});

describe('Lost City', () => {
  it('+2 Cards +2 Actions on play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Lost City'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Lost City') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Lost City + 2
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
  });

  it('on gain, each OTHER player draws a card', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Lost City', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 5),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Lost City'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Lost City');
    expect(count(state, HAND('p1'))).toBe(6); // 5 + the gift draw
    expect(count(state, HAND('p0'))).toBe(5); // the gainer draws nothing
  });
});

describe('Relic (Treasure - Attack)', () => {
  it('pays $2 and hands out the -1 Card token: the victim redraws to 4', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Relic'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): played in the buy phase like any Treasure.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Relic'),
    });
    await playOutWindows(engine);
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[1].vars[MINUS_CARD]).toBe(1);
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });

    // T2 (p1) passes; their cleanup redraw spends the token: 5 drawn, 1 back.
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(4);
    expect(state.players[1].vars[MINUS_CARD]).toBe(0);
  });
});

describe('Storyteller', () => {
  it('plays Treasures from hand, then converts every coin into cards', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Storyteller'), dealNamed('Silver'), dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, answerQueue(pickCards('Silver', 2)));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Storyteller') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // $1 (its own) + $4 (two Silvers) = 5 coins, all converted to cards.
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, HAND('p0'))).toBe(10); // 8 - ST - 2 Silvers + 5 drawn
    expect(count(state, DECK('p0'))).toBe(0); // the whole deck of 5 came over
    expect(names(state, INPLAY('p0'))).toEqual(expect.arrayContaining(['Storyteller', 'Silver', 'Silver']));
  });
});

describe('Treasure Trove', () => {
  it('pays $2 and gains a Gold and a Copper', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Treasure Trove'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Treasure Trove'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, DISCARD('p0'))).toContain('Gold');
    expect(names(state, DISCARD('p0'))).toContain('Copper');
    expect(names(state, INPLAY('p0'))).toEqual(['Treasure Trove']);
  });
});
