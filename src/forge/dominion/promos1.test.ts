/**
 * Promos — deterministic per-card probes through the REAL engine: Church's
 * mat round-trip across turns, Dismantle's both branches, Envoy's opponent
 * pick, Walled Village's clean-up topdeck (and its stay-put branch),
 * Governor's three modes, Marchland's recount term + on-gain rider, and
 * Captain's supply-play (durations excluded, the pile never shrinks,
 * a commanded attack still opens the Moat window).
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers promos1, freshDef() can become
 * a plain static `buildDominionDef` import.
 */
import { describe, expect, it } from 'vitest';
import type { Block, ChoiceRequest, EngineHandle, Expr, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { CHURCH_ZONE, promos1 } from './promos1';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(promos1)) EXPANSIONS.push(promos1);
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
const CHURCH = (p: string) => `${CHURCH_ZONE}:${p}`;
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

/** Action → Buy → Cleanup → the turn passes (nothing gets played). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

describe('promos1 module registration', () => {
  it('validates clean and knows all seven cards with costs and types', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Church: 3, Dismantle: 4, Envoy: 4, 'Walled Village': 4,
      Governor: 5, Marchland: 5, Captain: 6,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
      // No attacks or reactions in this subset.
      expect(card!.tags).not.toContain('dom_tag_attack');
      expect(card!.tags).not.toContain('dom_tag_reaction');
    }
    // Marchland is Victory-typed; the rest stay Actions (Durations included —
    // no Duration tag exists in the def's vocabulary).
    expect(def.cards.find((c) => c.name === 'Marchland')!.typeId).toBe('dom_type_victory');
    expect(def.cards.find((c) => c.name === 'Church')!.typeId).toBe('dom_type_action');
    expect(def.cards.find((c) => c.name === 'Captain')!.typeId).toBe('dom_type_action');
    // The picker's catalog files them under Promos.
    const { kingdomCatalog } = await import('../dominionGame');
    const catalog = kingdomCatalog(def);
    for (const name of Object.keys(costs)) {
      expect(catalog.find((e) => e.name === name)?.expansion, `${name} in Promos`).toBe('Promos');
    }
  });
});

describe('Church', () => {
  it('sets aside up to 3 face down, returns them next turn, then may trash', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Church'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      if (req.prompt.includes('set aside')) {
        const coppers = req.cardIds.filter((id) => state.cards[id].name === 'Copper').slice(0, 2);
        return JSON.stringify(coppers);
      }
      // The optional trash: burn one returned Copper.
      const copper = req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
      return JSON.stringify([copper]);
    });
    await engine.start();

    // T1 (p0): +1 Action, two Coppers go face down onto the Church mat,
    // then Church itself parks in the DURATION zone.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Church') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, HAND('p0'))).toBe(3); // 6 - Church - 2 set aside
    expect(names(state, CHURCH('p0'))).toEqual(['Copper', 'Copper']);
    for (const id of state.zones[CHURCH('p0')].cardIds) {
      expect(state.cards[id].faceUp).toBe(false);
    }
    expect(names(state, DURATION('p0'))).toEqual(['Church']);

    // Cleanup spares the mat and the parked Church.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(count(state, CHURCH('p0'))).toBe(2);
    expect(names(state, DURATION('p0'))).toEqual(['Church']);
    await passTurn(engine, 'p1');

    // T3 (p0): the mat empties into the hand, one Copper is trashed, and
    // Church marches back to In Play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes('Church resolves'))).toBe(true);
    expect(requests).toHaveLength(2);
    expect(count(state, CHURCH('p0'))).toBe(0);
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + 2 returned - 1 trashed
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(names(state, INPLAY('p0'))).toEqual(['Church']);
    expect(count(state, DURATION('p0'))).toBe(0);

    // T3 cleanup finally discards it like any played card.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect([
      ...names(state, DISCARD('p0')), ...names(state, DECK('p0')), ...names(state, HAND('p0')),
    ]).toContain('Church');
  });
});

describe('Dismantle', () => {
  it('trashing a $3 card gains a cheaper card and a Gold', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Dismantle'), dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Dismantle') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Estate', 'Gold']);
    expect(count(state, HAND('p0'))).toBe(5); // 7 - Dismantle - Silver
    expect(names(state, INPLAY('p0'))).toEqual(['Dismantle']);
  });

  it('trashing a $0 card gains nothing more', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Dismantle'), dealNamed('Copper'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Dismantle') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1); // no gain prompt followed
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(count(state, DISCARD('p0'))).toBe(0);
  });
});

describe('Envoy', () => {
  it('reveals 5; the opponent picks the discard; the rest join the hand', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Envoy'),
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
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Envoy') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].playerId).toBe('p1'); // the one opponent chooses
    expect((requests[0] as Extract<ChoiceRequest, { kind: 'card' }>).revealed).toBe(true);
    expect((requests[0] as Extract<ChoiceRequest, { kind: 'card' }>).cardIds).toHaveLength(5);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
    expect(count(state, HAND('p0'))).toBe(9); // 6 - Envoy + 4 kept
    expect(names(state, HAND('p0'))).toContain('Estate');
    expect(count(state, LOOK)).toBe(0);
    expect(names(state, INPLAY('p0'))).toEqual(['Envoy']);
  });
});

describe('Walled Village', () => {
  it('+1 Card +2 Actions; alone in play it may topdeck at clean-up', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Walled Village'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return true;
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Walled Village') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - WV + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2

    // The yes/no fires at the START of clean-up (before the sweep): the
    // village hops onto the deck, and the redraw brings it straight back.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(topName(state, DECK('p0'))).toBe('Walled Village');
    expect(count(state, INPLAY('p0'))).toBe(0);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p0'))).toContain('Walled Village');
  });

  it('with three Actions in play, no offer is made and it is swept normally', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Walled Village'), fromReserve('Walled Village'), fromReserve('Walled Village'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Walled Village') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Walled Village') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Walled Village') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(4); // 1 - 3 + 6
    expect(count(state, INPLAY('p0'))).toBe(3);
    // Three Actions in play > 2: the condition fails for every copy — the
    // noChoices answerer proves no yes/no ever surfaced, and BEFORE the
    // sweep nothing was topdecked (after it, the reshuffle could put a
    // village anywhere).
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, INPLAY('p0'))).toBe(3); // all three still in play
    expect(topName(state, DECK('p0'))).not.toBe('Walled Village');
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, INPLAY('p0'))).toBe(0); // swept like any played card
  });
});

describe('Governor', () => {
  it('cards mode: the owner draws 3, the opponent draws 1', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Governor'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'gov_cards';
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Governor') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Governor + 3
    expect(count(state, HAND('p1'))).toBe(6); // 5 + 1
  });

  it('gold mode: the owner gains a Gold, the opponent a Silver', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Governor'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'gov_gold';
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Governor') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Gold']);
    expect(names(state, DISCARD('p1'))).toEqual(['Silver']);
  });

  it('remodel mode: the owner upgrades by exactly $2, the opponent may decline', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Governor'), dealNamed('Estate'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'option') return 'gov_remodel';
      if (req.kind === 'cards' && req.playerId === 'p0') {
        const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
        return JSON.stringify([estate]);
      }
      if (req.kind === 'cards' && req.playerId === 'p1') return JSON.stringify([]);
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Smithy')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Governor') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // Estate ($2) → exactly $4: the pile choice offered only cost-4 piles.
    const pileReq = requests.find((r) => r.kind === 'pile') as Extract<ChoiceRequest, { kind: 'pile' }>;
    expect(pileReq).toBeDefined();
    for (const id of pileReq.cardIds) {
      expect(state.cards[id].fields['dom_field_cost'], `${state.cards[id].name} costs 4`).toBe(4);
    }
    expect(names(state, TRASH)).toEqual(['Estate']);
    expect(names(state, DISCARD('p0'))).toEqual(['Smithy']);
    expect(count(state, DISCARD('p1'))).toBe(0); // the opponent declined
  });
});

describe('Marchland', () => {
  it('scores 1 VP per 3 Victory cards owned, per Marchland', async () => {
    const def = await freshDef();
    // p0 owns 3 Estates (starting deck) + 2 Marchlands = 5 Victory cards:
    // floor(5/3) = 1 VP per Marchland → +2, plus the Estates' printed 3.
    def.setup.push(fromReserve('Marchland'), fromReserve('Marchland'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0'); // the recount runs at turn end
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp']).toBe(5); // 3 + 2
    expect(state.players[1].vars['dom_var_vp']).toBe(3); // 3 Estates, no Marchland
  });

  it('on buy: +1 Buy and any number of discards for +$1 each', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Marchland'));
    setStartingCoins(def, 5);
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const coppers = req.cardIds.filter((id) => state.cards[id].name === 'Copper').slice(0, 2);
      return JSON.stringify(coppers);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Marchland'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // 5 - 5 + 2 discards
    expect(state.players[0].vars['dom_var_buys']).toBe(1); // 1 - 1 + 1
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Copper', 'Copper', 'Marchland']);
    expect(count(state, HAND('p0'))).toBe(3);
    // The recount at turn end sees 4 Victory cards → floor(4/3) = 1 extra VP.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp']).toBe(4); // 3 Estates + 1
  });
});

describe('Captain', () => {
  it('plays a supply Action now and next turn, leaving the pile untouched', async () => {
    const def = await freshDef();
    // Promote a Duration (Caravan, $4) and the self-parking Island ($4) so
    // the exclusion filter has something real to hide.
    def.setup.push(fromReserve('Captain'), pileToSupply('Caravan'), pileToSupply('Island'));
    const pilePicks: string[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      const offered = req.cardIds.map((id) => state.cards[id].name);
      expect(offered).toContain('Smithy'); // $4 Action
      expect(offered).toContain('Village'); // $3 Action
      expect(offered).not.toContain('Caravan'); // Duration — excluded
      expect(offered).not.toContain('Island'); // self-parking — excluded
      expect(offered).not.toContain('Mine'); // $5 — over the cap
      expect(offered).not.toContain('Copper'); // not an Action
      const pick = pilePicks.length === 0 ? 'Smithy' : 'Village';
      pilePicks.push(pick);
      return req.cardIds.find((id) => state.cards[id].name === pick)!;
    });
    await engine.start();

    // T1 (p0): the commanded Smithy draws 3 without leaving the supply;
    // Captain parks in the DURATION zone.
    let state = engine.getState();
    const smithies = names(state, SUPPLY).filter((n) => n === 'Smithy').length;
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Captain') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(pilePicks).toEqual(['Smithy']);
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Captain + 3 drawn
    expect(names(state, SUPPLY).filter((n) => n === 'Smithy')).toHaveLength(smithies);
    expect(names(state, DURATION('p0'))).toEqual(['Captain']);
    expect(count(state, INPLAY('p0'))).toBe(0);

    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): the later half commands a Village (+1 Card +2 Actions) and
    // Captain marches back to In Play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(pilePicks).toEqual(['Smithy', 'Village']);
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + Village's draw
    expect(state.players[0].vars['dom_var_actions']).toBe(3); // 1 + 2
    expect(names(state, INPLAY('p0'))).toEqual(['Captain']);
    expect(count(state, DURATION('p0'))).toBe(0);
    const villages = names(state, SUPPLY).filter((n) => n === 'Village').length;
    expect(villages).toBe(10); // the pile never shrank
  });

  it('a commanded Militia still opens the response window and strikes', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Captain'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'pile') {
        return req.cardIds.find((id) => state.cards[id].name === 'Militia')!;
      }
      if (req.kind === 'cards' && req.playerId === 'p1') {
        return JSON.stringify(req.cardIds.slice(0, 2)); // discard down to 3
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Captain') });
    await playOutWindows(engine); // nobody reveals a Moat
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // Militia pays its owner
    expect(count(state, HAND('p1'))).toBe(3); // discarded down to 3
    expect(names(state, SUPPLY).filter((n) => n === 'Militia')).toHaveLength(10);
    expect(names(state, DURATION('p0'))).toEqual(['Captain']);
  });
});
