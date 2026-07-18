/**
 * Adventures (part A) — deterministic per-card probes through the REAL
 * engine: the Tavern mat (Reserve park + every call surface), the Traveller
 * stock and both exchange ladders across cleanups (Page -> Treasure Hunter
 * -> Warrior -> Hero -> Champion; Peasant -> Soldier -> Fugitive ->
 * Disciple -> Teacher), Distant Lands' mat-only scoring and its play offer,
 * Royal Carriage replays, Duplicate's on-gain call, Champion's two auras
 * and Teacher's token placement.
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers adventuresA, freshDef() can
 * become a plain static `buildDominionDef` import.
 *
 * TOKEN-VAR STUB: Teacher writes the adventuresTokens module's per-player
 * pile-name vars (dom_var_tok_card / _action / _coin / _buy) by id. That
 * module (agent C) is not registered yet, so THIS SUITE registers a
 * variables-only stand-in when nothing else declares them — the merged def
 * cannot validate without the declarations. Once adventuresTokens lands in
 * expansions.ts the stub becomes a no-op and can be deleted.
 */
import { describe, expect, it } from 'vitest';
import type { EngineHandle, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import type { ExpansionModule } from './kit';
import {
  ADV_GAINED_VAR, TAVERN_ZONE, TOK_ACTION_VAR, TOK_CARD_VAR, TRAVELLER_ZONE, adventuresA,
} from './adventuresA';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

/** Variables-only stand-in for agent C's adventuresTokens module (header). */
const adventuresTokensStub: ExpansionModule = {
  id: 'adventuresTokensStub',
  piles: [],
  ids: {},
  buildCards: () => [],
  variables: [
    { id: 'dom_var_tok_card', name: '+1 Card token: its pile', scope: 'perPlayer', type: 'string', initial: '', hidden: true },
    { id: 'dom_var_tok_action', name: '+1 Action token: its pile', scope: 'perPlayer', type: 'string', initial: '', hidden: true },
    { id: 'dom_var_tok_coin', name: '+$1 token: its pile', scope: 'perPlayer', type: 'string', initial: '', hidden: true },
    { id: 'dom_var_tok_buy', name: '+1 Buy token: its pile', scope: 'perPlayer', type: 'string', initial: '', hidden: true },
  ],
};
const tokensDeclared = EXPANSIONS.some(
  (x) => (x.variables ?? []).some((v) => v.id === 'dom_var_tok_card'),
);
if (!tokensDeclared) EXPANSIONS.push(adventuresTokensStub);
if (!EXPANSIONS.includes(adventuresA)) EXPANSIONS.push(adventuresA);

/** buildDominionDef AFTER registration (see the header note). */
async function freshDef(): Promise<GameDef> {
  const { buildDominionDef } = await import('../dominionGame');
  return buildDominionDef();
}

const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const TAVERN = (p: string) => `${TAVERN_ZONE}:${p}`;
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';
const RESERVE = 'dom_zone_reserve';

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;
const stockCount = (state: GameState, name: string): number =>
  names(state, TRAVELLER_ZONE).filter((n) => n === name).length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, RESERVE);
const fromStock = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, TRAVELLER_ZONE);

/** Setup block: set a per-player number variable (coins for buy probes). */
const giveVar = (varId: string, playerId: string, value: number): GameDef['setup'][number] =>
  ({ kind: 'setVar', varId, target: { kind: 'str', value: playerId }, value: { kind: 'num', value } });

const play = { actionId: 'dom_action_play' };
const noChoices = () => { throw new Error('no choices expected'); };

/** Action → Buy → Cleanup → the turn passes (nothing gets played). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

describe('adventuresA module registration', () => {
  it('validates clean; knows the 11 kingdom piles and the 8-stock Traveller ladder', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const kingdom: Record<string, number> = {
      Page: 2, Peasant: 2, Ratcatcher: 2, 'Coin of the Realm': 2, Guide: 3,
      Duplicate: 4, Miser: 4, 'Distant Lands': 5, 'Royal Carriage': 5,
      Transmogrify: 5, 'Wine Merchant': 5,
    };
    for (const [name, cost] of Object.entries(kingdom)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
    }
    const travellers: Record<string, number> = {
      'Treasure Hunter': 3, Warrior: 4, Hero: 5, Champion: 6,
      Soldier: 3, Fugitive: 4, Disciple: 5, Teacher: 6,
    };
    for (const [name, cost] of Object.entries(travellers)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      // Non-supply stock is nobody's kingdom pile.
      expect(card!.tags).not.toContain('dom_tag_kingdom');
    }
    // Primary types: Coin of the Realm is the Treasure–Reserve, Distant
    // Lands the Victory–Reserve; everything else stays an Action.
    expect(def.cards.find((c) => c.name === 'Coin of the Realm')!.typeId).toBe('dom_type_treasure');
    expect(def.cards.find((c) => c.name === 'Distant Lands')!.typeId).toBe('dom_type_victory');
    for (const name of ['Page', 'Peasant', 'Ratcatcher', 'Guide', 'Duplicate', 'Miser',
      'Royal Carriage', 'Transmogrify', 'Wine Merchant', ...Object.keys(travellers)]) {
      expect(def.cards.find((c) => c.name === name)!.typeId, `${name} is an Action`)
        .toBe('dom_type_action');
    }
    // Type-line tags: the two Traveller attacks.
    for (const name of ['Warrior', 'Soldier']) {
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} is an Attack`)
        .toContain('dom_tag_attack');
    }
    // The Traveller stock: one non-supply deck, 5 copies of each upgrade.
    const stock = def.decks.find((d) => d.initialZone === TRAVELLER_ZONE)!;
    expect(stock).toBeDefined();
    if (stock.source.kind === 'custom') {
      expect(stock.source.entries).toHaveLength(8);
      for (const e of stock.source.entries) expect(e.count).toBe(5);
    }
    // The module's zones: the per-player Tavern mat + the shared stock.
    expect(def.zones.find((z) => z.id === TAVERN_ZONE)?.owner).toBe('perPlayer');
    expect(def.zones.find((z) => z.id === TAVERN_ZONE)?.visibility).toBe('all');
    expect(def.zones.find((z) => z.id === TRAVELLER_ZONE)?.owner).toBe('shared');
    // The picker files the eleven under Adventures; the stock is no pick.
    const { kingdomCatalog } = await import('../dominionGame');
    const catalog = kingdomCatalog(def);
    for (const name of Object.keys(kingdom)) {
      expect(catalog.find((e) => e.name === name)?.expansion, `${name} in Adventures`).toBe('Adventures');
    }
    for (const name of Object.keys(travellers)) {
      expect(catalog.find((e) => e.name === name), `${name} is no kingdom pick`).toBeUndefined();
    }
  });
});

describe('Page (and the exchange window)', () => {
  it('plays for +1 Card +1 Action, then exchanges for a Treasure Hunter at cleanup', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Page'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'yesNo') return true; // take the exchange
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Page') });
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Page + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(names(state, INPLAY('p0'))).toEqual(['Page']);

    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    // The exchange resolved at cleanup START, before the sweep: Page went
    // home to the supply, a Treasure Hunter arrived in the discard.
    expect(names(state, SUPPLY)).toContain('Page');
    expect(names(state, DISCARD('p0'))).toContain('Treasure Hunter');
    expect(stockCount(state, 'Treasure Hunter')).toBe(4);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    expect(errors).toEqual([]);
  });

  it('declining the exchange lets the Page get discarded normally', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Page'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'yesNo') return false;
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Page') });
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, SUPPLY)).not.toContain('Page');
    expect(stockCount(state, 'Treasure Hunter')).toBe(5);
    expect([
      ...names(state, DISCARD('p0')), ...names(state, DECK('p0')), ...names(state, HAND('p0')),
    ]).toContain('Page');
  });
});

describe('Peasant', () => {
  it('+1 Buy +$1, then exchanges for a Soldier', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Peasant'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'yesNo') return true;
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Peasant') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);

    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, SUPPLY)).toContain('Peasant');
    expect(names(state, DISCARD('p0'))).toContain('Soldier');
    expect(stockCount(state, 'Soldier')).toBe(4);
  });
});

describe('Ratcatcher', () => {
  it('parks on the mat, then a turn-start call trashes a hand card', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Ratcatcher'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'yesNo') return true; // call it
      if (req.kind === 'card') return req.cardIds[0]; // trash the first offer
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Ratcatcher') });
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Ratcatcher + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, TAVERN('p0'))).toEqual(['Ratcatcher']);
    expect(count(state, INPLAY('p0'))).toBe(0); // parked, not in play

    // Cleanup spares the mat; the opponent's turn passes; the T3 call fires.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, TAVERN('p0'))).toEqual(['Ratcatcher']);
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    // The call moved it into play (untagged — its play half stayed silent:
    // hand is the redrawn 5 minus the trashed card, no bonus draw).
    expect(names(state, INPLAY('p0'))).toEqual(['Ratcatcher']);
    expect(count(state, TAVERN('p0'))).toBe(0);
    expect(count(state, TRASH)).toBe(1);
    expect(count(state, HAND('p0'))).toBe(4); // 5 redrawn - 1 trashed
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // untouched

    // A called Reserve is swept like any played card at this turn's cleanup.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect([
      ...names(state, DISCARD('p0')), ...names(state, DECK('p0')), ...names(state, HAND('p0')),
    ]).toContain('Ratcatcher');
  });
});

describe('Coin of the Realm', () => {
  it('played as a Treasure it pays $1 and parks on the mat', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Coin of the Realm'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Coin of the Realm'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1); // the coin field
    expect(names(state, TAVERN('p0'))).toEqual(['Coin of the Realm']);
    expect(count(state, INPLAY('p0'))).toBe(0);
  });

  it('called after an Action play for +2 Actions', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Coin of the Realm', TAVERN_ZONE, 'p0'),
      dealNamed('Village'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') {
        // The call offer: call the one parked Coin.
        const coin = req.cardIds.find((id) => state.cards[id].name === 'Coin of the Realm')!;
        return JSON.stringify([coin]);
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    expect(errors).toEqual([]);
    // 1 - 1 (play) + 2 (Village) + 2 (the called Coin) = 4.
    expect(state.players[0].vars['dom_var_actions']).toBe(4);
    expect(names(state, INPLAY('p0'))).toContain('Coin of the Realm');
    expect(count(state, TAVERN('p0'))).toBe(0);
  });
});

describe('Guide', () => {
  it('called at turn start: discard the hand, draw a fresh 5', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Guide', TAVERN_ZONE, 'p0'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'yesNo') return true;
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state = engine.getState();
    expect(errors).toEqual([]);
    // The T1 action-phase start already offered the call (the mat was dealt
    // during setup): the whole hand went to the discard, 5 fresh cards came.
    expect(names(state, INPLAY('p0'))).toEqual(['Guide']);
    expect(count(state, TAVERN('p0'))).toBe(0);
    expect(count(state, HAND('p0'))).toBe(5);
    expect(count(state, DISCARD('p0'))).toBe(5);
    expect(count(state, DECK('p0'))).toBe(0);
  });
});

describe('Duplicate', () => {
  it('called on a gain of a card costing up to $6: gains a copy', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Duplicate', TAVERN_ZONE, 'p0'),
      giveVar('dom_var_coins', 'p0', 5),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') {
        const dup = req.cardIds.find((id) => state.cards[id].name === 'Duplicate')!;
        return JSON.stringify([dup]);
      }
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
    // The bought Silver plus the Duplicate's copy.
    expect(names(state, DISCARD('p0')).filter((n) => n === 'Silver')).toHaveLength(2);
    expect(names(state, INPLAY('p0'))).toEqual(['Duplicate']);
    expect(count(state, TAVERN('p0'))).toBe(0);
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // 5 - 3, the copy is free
  });
});

describe('Miser', () => {
  it('hoards a Copper on the mat, then cashes +$1 per mat Copper', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Village'),
      fromReserve('Miser'),
      fromReserve('Miser'),
      dealNamed('Copper'),
    );
    const options: string[] = ['miser_copper', 'miser_coins'];
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'option') return options.shift()!;
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Miser') });
    state = engine.getState();
    expect(names(state, TAVERN('p0'))).toEqual(['Copper']);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Miser') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1); // 1 mat Copper
    expect(names(state, TAVERN('p0'))).toEqual(['Copper']); // the hoard stays
  });
});

describe('Distant Lands', () => {
  it('the turn-start offer plays it onto the mat for an Action; it scores 4 there', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Distant Lands'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') {
        const dl = req.cardIds.find((id) => state.cards[id].name === 'Distant Lands')!;
        return JSON.stringify([dl]);
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    // The offer fired at the T1 action-phase start: one Action was spent,
    // the card played through In Play and parked on the mat.
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
    expect(names(state, TAVERN('p0'))).toEqual(['Distant Lands']);
    expect(count(state, INPLAY('p0'))).toBe(0);
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    // The turn-end recount: 3 Estates + the 4 VP on the mat.
    expect(state.players[0].vars['dom_var_vp']).toBe(7);
    expect(names(state, TAVERN('p0'))).toEqual(['Distant Lands']); // parked for good
  });

  it('declined it scores nothing, and the core play action refuses it', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Distant Lands'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'cards') return JSON.stringify([]);
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    // Victory-typed: the play action's Actions-only legality refuses it.
    await expect(
      engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Distant Lands') }),
    ).rejects.toThrow();
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp']).toBe(3); // Estates only — 0 off-mat
  });
});

describe('Royal Carriage', () => {
  it('called after an Action: the Action resolves again', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Royal Carriage', TAVERN_ZONE, 'p0'),
      dealNamed('Smithy'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') {
        const rc = req.cardIds.find((id) => state.cards[id].name === 'Royal Carriage')!;
        return JSON.stringify([rc]);
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Smithy') });
    state = engine.getState();
    expect(errors).toEqual([]);
    // 6 - Smithy + 3 (natural) + 2 (the replay — the 10-card deck ran dry
    // with nothing in the discard to reshuffle) = 10; without the replay
    // the hand would hold 8.
    expect(count(state, HAND('p0'))).toBe(10);
    expect(count(state, DECK('p0'))).toBe(0);
    expect(names(state, INPLAY('p0'))).toContain('Royal Carriage');
    expect(count(state, TAVERN('p0'))).toBe(0);
    expect(state.log.some((l) => l.text.includes('calls a Royal Carriage'))).toBe(true);
  });

  it('plays for +1 Action and parks; a declined call changes nothing', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Royal Carriage'), dealNamed('Smithy'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'cards') return JSON.stringify([]); // keep the Carriage
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Royal Carriage') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(names(state, TAVERN('p0'))).toEqual(['Royal Carriage']);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Smithy') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // 7 - RC - Smithy + 3, no replay
    expect(names(state, TAVERN('p0'))).toEqual(['Royal Carriage']); // stayed put
  });
});

describe('Transmogrify', () => {
  it('called at turn start: trash a hand card, gain one costing up to $1 more into the hand', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Transmogrify', TAVERN_ZONE, 'p0'),
      dealNamed('Copper'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'yesNo') return true;
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
      }
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(names(state, INPLAY('p0'))).toEqual(['Transmogrify']);
    expect(count(state, TAVERN('p0'))).toBe(0);
    // 5 + the dealt Copper - trashed + gained-into-hand = 6.
    expect(count(state, HAND('p0'))).toBe(6);
    expect(names(state, HAND('p0'))).toContain('Copper');
  });
});

describe('Wine Merchant', () => {
  it('+1 Buy +$4 and parks; discharges from the mat at cleanup start with $2+ unspent', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Wine Merchant'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'yesNo') return true; // settle up
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Wine Merchant') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(4);
    expect(names(state, TAVERN('p0'))).toEqual(['Wine Merchant']);

    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    // $4 unspent >= $2: the merchant left the mat for the discard pile.
    expect(count(state, TAVERN('p0'))).toBe(0);
    expect(names(state, DISCARD('p0'))).toContain('Wine Merchant');
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    expect(errors).toEqual([]);
  });
});

describe('Treasure Hunter', () => {
  it("gains a Silver per card the opponent gained on their last turn, then exchanges for a Warrior", async () => {
    const def = await freshDef();
    def.setup.push(
      fromStock('Treasure Hunter', 'dom_zone_deck', 'p0'),
      giveVar('dom_var_coins', 'p1', 5),
    );
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'yesNo') return true; // the T3 exchange
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    // T1 (p0): nothing — the cleanup redraw pulls the Treasure Hunter (it
    // sat on top of the deck) into the next hand.
    await passTurn(engine, 'p0');
    let state = engine.getState();
    expect(names(state, HAND('p0'))).toContain('Treasure Hunter');
    // T2 (p1): buys a Silver — one card gained on their turn.
    await engine.performAction('p1', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p1', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Silver'),
    });
    await engine.performAction('p1', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p1', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(state.players[1].vars[ADV_GAINED_VAR]).toBe(1);

    // T3 (p0): the Hunter reads the opponent's last turn — one Silver.
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Treasure Hunter') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, DISCARD('p0')).filter((n) => n === 'Silver')).toHaveLength(1);

    // The cleanup exchange: the Hunter goes home, a Warrior arrives.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Warrior');
    expect(stockCount(state, 'Treasure Hunter')).toBe(5); // 4 after the deal, +1 returned
    expect(stockCount(state, 'Warrior')).toBe(4);
  });
});

describe('Warrior', () => {
  it('strikes once per Traveller in play: top cards fall, $3–$4 ones are trashed', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Page'),
      fromStock('Warrior'),
      dealNamed('Silver', 'dom_zone_deck', 'p1'),
    );
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'yesNo') return true; // both cleanup exchanges
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Page') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Warrior') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // 7 - Page + 1 - Warrior + 2
    // Two Travellers in play (Page + the Warrior itself): two strikes. The
    // topdecked Silver ($3) is trashed; the next card (Copper/Estate) is
    // discarded.
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(count(state, DISCARD('p1'))).toBe(1);
    expect(count(state, DECK('p1'))).toBe(4); // 5 + Silver - 2 struck

    // Both exchanges fire at cleanup: Page -> Treasure Hunter (supply home),
    // Warrior -> Hero (stock home).
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Treasure Hunter');
    expect(names(state, DISCARD('p0'))).toContain('Hero');
    expect(names(state, SUPPLY)).toContain('Page');
    expect(stockCount(state, 'Warrior')).toBe(5); // dealt out, then returned
    expect(stockCount(state, 'Hero')).toBe(4);
    expect(stockCount(state, 'Treasure Hunter')).toBe(4);
  });
});

describe('Hero', () => {
  it('+$2, gains any Treasure, then exchanges for a Champion', async () => {
    const def = await freshDef();
    def.setup.push(fromStock('Hero'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Gold')!;
      }
      if (req.kind === 'yesNo') return true; // the exchange
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Hero') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, DISCARD('p0'))).toContain('Gold');

    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Champion');
    expect(stockCount(state, 'Hero')).toBe(5);
    expect(stockCount(state, 'Champion')).toBe(4);
  });
});

describe('Champion', () => {
  it('plays for +1 Action and parks on the mat for the rest of the game', async () => {
    const def = await freshDef();
    def.setup.push(fromStock('Champion'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Champion') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(names(state, TAVERN('p0'))).toEqual(['Champion']);
    expect(count(state, INPLAY('p0'))).toBe(0);
    // The mat outlives cleanup.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TAVERN('p0'))).toEqual(['Champion']);
  });

  it('grants +1 Action per Action played and waves off attacks while parked', async () => {
    const def = await freshDef();
    def.setup.push(
      fromStock('Champion', TAVERN_ZONE, 'p0'),
      dealNamed('Village'),
      dealNamed('Militia', 'dom_zone_hand', 'p1'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): the action aura — Village pays +2, the Champion +1 more.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(3); // 1 - 1 + 2 + 1
    await passTurn(engine, 'p0');

    // T2 (p1): Militia strikes — the Champion shields p0 without any Moat.
    // Were the immunity to fail, the discard-to-3 choice would reach the
    // no-choice answerer and throw.
    state = engine.getState();
    await engine.performAction('p1', { ...play, cardId: findNamed(state, HAND('p1'), 'Militia') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(state.log.some((l) => l.text.includes('Champion shields'))).toBe(true);
    expect(count(state, HAND('p0'))).toBe(5); // untouched — immune
    expect(state.players[1].vars['dom_var_coins']).toBe(2); // Militia still pays
    // Immunity faded with the attack (the shared effectResolved reset).
    expect(state.players[0].vars['dom_var_immune']).toBe(0);
    expect(names(state, TAVERN('p0'))).toEqual(['Champion']);
  });
});

describe('Soldier', () => {
  it('+$2 (+$1 per other Attack), the opponent discards at 4+ cards; exchanges for Fugitives', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Village'),
      fromStock('Soldier'),
      fromStock('Soldier'),
    );
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'cards') return JSON.stringify([req.cardIds[0]]); // p1's discard
      if (req.kind === 'yesNo') return true; // both exchanges
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Soldier') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // no OTHER attack yet
    expect(count(state, HAND('p1'))).toBe(4); // 5 - 1 discarded
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Soldier') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(5); // 2 + 2 + 1 (other Attack)
    expect(count(state, HAND('p1'))).toBe(3); // 4 >= 4: discards again

    // Both Soldiers exchange for Fugitives at cleanup.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0')).filter((n) => n === 'Fugitive')).toHaveLength(2);
    expect(stockCount(state, 'Soldier')).toBe(5); // both returned
    expect(stockCount(state, 'Fugitive')).toBe(3);
  });
});

describe('Fugitive', () => {
  it('+2 Cards +1 Action, discards a card, then exchanges for a Disciple', async () => {
    const def = await freshDef();
    def.setup.push(fromStock('Fugitive'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'cards') return JSON.stringify([req.cardIds[0]]);
      if (req.kind === 'yesNo') return true;
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Fugitive') });
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Fugitive + 2 - 1 discarded
    expect(state.players[0].vars['dom_var_actions']).toBe(1);

    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Disciple');
    expect(stockCount(state, 'Fugitive')).toBe(5);
    expect(stockCount(state, 'Disciple')).toBe(4);
  });
});

describe('Disciple', () => {
  it('plays an Action twice and gains a copy of it, then exchanges for a Teacher', async () => {
    const def = await freshDef();
    def.setup.push(fromStock('Disciple'), dealNamed('Village'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') {
        const village = req.cardIds.find((id) => state.cards[id].name === 'Village')!;
        return JSON.stringify([village]);
      }
      if (req.kind === 'yesNo') return true;
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Disciple') });
    state = engine.getState();
    expect(errors).toEqual([]);
    // Village resolved twice: +2 Cards, +4 Actions on top of the play cost.
    expect(count(state, HAND('p0'))).toBe(7); // 7 - Disciple - Village + 2
    expect(state.players[0].vars['dom_var_actions']).toBe(4); // 1 - 1 + 2 + 2
    expect(names(state, DISCARD('p0'))).toContain('Village'); // the gained copy
    expect(state.log.some((l) => l.text.includes('plays Village twice'))).toBe(true);

    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Teacher');
    expect(stockCount(state, 'Disciple')).toBe(5);
    expect(stockCount(state, 'Teacher')).toBe(4);
  });
});

describe('Teacher', () => {
  it('parks for good; turn-start calls place +1 tokens on distinct Action piles', async () => {
    const def = await freshDef();
    def.setup.push(fromStock('Teacher'));
    let phase: 'park' | 'first' | 'second' = 'park';
    let secondPile = '';
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'yesNo') return true; // always willing to teach
      if (req.kind === 'option') return phase === 'first' ? 'tok_action' : 'tok_card';
      if (req.kind === 'pile') {
        const offered = req.cardIds.map((id) => state.cards[id].name);
        if (phase === 'first') {
          expect(offered).toContain('Village');
          return req.cardIds.find((id) => state.cards[id].name === 'Village')!;
        }
        // The second placement must exclude the pile already holding a token.
        expect(offered).not.toContain('Village');
        const pick = req.cardIds[0];
        secondPile = state.cards[pick].name;
        return pick;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Teacher') });
    state = engine.getState();
    expect(names(state, TAVERN('p0'))).toEqual(['Teacher']);
    expect(count(state, INPLAY('p0'))).toBe(0);

    // T3 (p0): the first call moves the +1 Action token onto Village.
    phase = 'first';
    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars[TOK_ACTION_VAR]).toBe('Village');
    expect(names(state, TAVERN('p0'))).toEqual(['Teacher']); // parked for good

    // T5 (p0): the second call places the +1 Card token on another pile.
    phase = 'second';
    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(secondPile).not.toBe('');
    expect(state.players[0].vars[TOK_CARD_VAR]).toBe(secondPile);
    expect(state.players[0].vars[TOK_ACTION_VAR]).toBe('Village'); // undisturbed
    expect(names(state, TAVERN('p0'))).toEqual(['Teacher']);
  });
});
