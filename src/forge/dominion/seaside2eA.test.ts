/**
 * Seaside 2E (part A) — deterministic per-card probes through the REAL
 * engine, including the multi-turn Duration probes: play → cleanup leaves
 * the card in the DURATION zone → the opponent's turn passes → the owner's
 * next action phase fires the later half and marches the card back to In
 * Play → that turn's cleanup discards it. Plus the Throne Room x Duration
 * probe (now runs twice, the card parks once, later fires once).
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers seaside2eA, freshDef() can
 * become a plain static `buildDominionDef` import.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest, EngineHandle, GameDef, GameState } from '../../shared/types';
import { PASS_ACTION_ID } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { HAVEN_MARK, seaside2eA } from './seaside2eA';
import { dealNamed, findNamed, probeEngine } from './testKit';

if (!EXPANSIONS.includes(seaside2eA)) EXPANSIONS.push(seaside2eA);
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

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');

const play = { actionId: 'dom_action_play' };
const noChoices = () => { throw new Error('no choices expected'); };

/** Action → Buy → Cleanup → the turn passes (nothing gets played). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

/**
 * Drive an open response window: every holder passes, except that `useFor`
 * performs `actionId` ONCE when it is legal (testKit's playOutWindows shape,
 * with the response action configurable — Lighthouse instead of Moat).
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

describe('seaside2eA module registration', () => {
  it('validates clean and knows all nine cards with their costs and types', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Haven: 2, Lighthouse: 2, 'Fishing Village': 3, Astrolabe: 3, Warehouse: 3,
      Caravan: 4, Bazaar: 5, 'Merchant Ship': 5, Wharf: 5,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
    }
    // Astrolabe is treasure-TYPED (playable by the treasure action); the
    // other durations stay Actions, and Lighthouse wears NO Reaction tag —
    // its wave-off is the module's own response action.
    expect(def.cards.find((c) => c.name === 'Astrolabe')!.typeId).toBe('dom_type_treasure');
    expect(def.cards.find((c) => c.name === 'Haven')!.typeId).toBe('dom_type_action');
    expect(def.cards.find((c) => c.name === 'Lighthouse')!.tags).not.toContain('dom_tag_reaction');
    expect(def.actions.some((a) => a.id === 'dom_action_lighthouse')).toBe(true);
  });
});

describe('Bazaar', () => {
  it('+1 Card +2 Actions +$1', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Bazaar'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Bazaar') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Bazaar + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Bazaar']);
  });
});

describe('Warehouse', () => {
  it('+3 Cards +1 Action, then discards exactly 3', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Warehouse'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, 3));
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Warehouse') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.min).toBe(3);
    expect(req.max).toBe(3);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Warehouse + 3 - 3
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(count(state, DISCARD('p0'))).toBe(3);
  });
});

describe('Caravan (the canonical Duration probe)', () => {
  it('parks through cleanup, draws at the next turn start, then gets discarded', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Caravan'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): the now half — +1 Card +1 Action — then the card parks.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Caravan') });
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(6);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, DURATION('p0'))).toEqual(['Caravan']);
    expect(count(state, INPLAY('p0'))).toBe(0);

    // T1 cleanup leaves it in the DURATION zone — NOT discarded.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Caravan']);
    expect(names(state, DISCARD('p0'))).not.toContain('Caravan');

    // T2: the opponent's turn passes without touching it.
    await passTurn(engine, 'p1');

    // T3 (p0): the later half fired at the action-phase start — +1 Card,
    // ONCE — and the card marched back to In Play (no now-half re-fire:
    // hand stays 6, actions stay at the turn's 1).
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes('Caravan resolves'))).toBe(true);
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + 1 later draw
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Caravan']);
    expect(count(state, DURATION('p0'))).toBe(0);

    // T3 cleanup finally discards it like any played card (the redraw may
    // immediately reshuffle the discard, so "back in the deck cycle" is the
    // stable claim — and it is nowhere a Duration would linger).
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect([
      ...names(state, DISCARD('p0')), ...names(state, DECK('p0')), ...names(state, HAND('p0')),
    ]).toContain('Caravan');
  });
});

describe('Fishing Village', () => {
  it('now +2 Actions +$1; later +1 Action +$1', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Fishing Village'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Fishing Village') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, DURATION('p0'))).toEqual(['Fishing Village']);

    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 + 1 later
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Fishing Village']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Merchant Ship', () => {
  it('pays +$2 now and +$2 at the next turn start', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Merchant Ship'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Merchant Ship') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, DURATION('p0'))).toEqual(['Merchant Ship']);

    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    // Granted at the action-phase start, spendable through the buy phase.
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, INPLAY('p0'))).toEqual(['Merchant Ship']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Wharf', () => {
  it('+2 Cards +1 Buy now, and again at the next turn start', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Wharf'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Wharf') });
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Wharf + 2 drawn
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(names(state, DURATION('p0'))).toEqual(['Wharf']);

    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 5 redrawn + 2 later draws
    expect(state.players[0].vars['dom_var_buys']).toBe(2); // 1 + 1 later
    expect(names(state, INPLAY('p0'))).toEqual(['Wharf']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Astrolabe', () => {
  it('played by the treasure action: the enterZone ability fires and parks it', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Astrolabe'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): treasures are played in the buy phase. The treasure action
    // pays the coin field (+$1) and its move — tagged 'play', the same move
    // any "play all treasures" affordance issues per card — fires the
    // enterZone now-half: +1 Buy, then the card parks.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Astrolabe'),
    });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(names(state, DURATION('p0'))).toEqual(['Astrolabe']);
    expect(count(state, INPLAY('p0'))).toBe(0);

    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Astrolabe']); // cleanup spares it

    await passTurn(engine, 'p1');

    // T3 (p0): later pays +$1 +1 Buy and the card is back in play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(names(state, INPLAY('p0'))).toEqual(['Astrolabe']);
    expect(count(state, DURATION('p0'))).toBe(0);

    // Discarded at T3's cleanup (the redraw may reshuffle it straight into
    // the deck — "back in the deck cycle" is the stable claim).
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect([
      ...names(state, DISCARD('p0')), ...names(state, DECK('p0')), ...names(state, HAND('p0')),
    ]).toContain('Astrolabe');
  });
});

describe('Haven', () => {
  it('sets a card aside face down; the single candidate auto-returns to hand', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Haven'), dealNamed('Silver'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      return JSON.stringify([silver]);
    });
    await engine.start();

    // T1 (p0): +1 Card +1 Action, the picked Silver goes face-down into the
    // DURATION zone wearing the Haven mark, then Haven itself parks.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Haven') });
    state = engine.getState();
    expect(requests).toHaveLength(1);
    expect(count(state, HAND('p0'))).toBe(6); // 7 - Haven + 1 drawn - Silver
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, DURATION('p0'))).toEqual(['Silver', 'Haven']);
    const silverId = findNamed(state, DURATION('p0'), 'Silver');
    expect(state.cards[silverId].faceUp).toBe(false);
    expect(state.cards[silverId].vars[HAVEN_MARK]).toBe(1);

    // Cleanup spares both; the opponent's turn passes.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Silver', 'Haven']);
    await passTurn(engine, 'p1');

    // T3 (p0): the ONE marked candidate auto-resolves — no second prompt —
    // and Haven marches back to In Play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(names(state, HAND('p0'))).toContain('Silver');
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + the Silver
    expect(state.cards[silverId].vars[HAVEN_MARK]).toBe(0);
    expect(names(state, INPLAY('p0'))).toEqual(['Haven']);
    expect(count(state, DURATION('p0'))).toBe(0);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Haven');
  });

  it('a set-aside Duration card stays inert and returns to hand (the mark guard)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Haven'), fromReserve('Caravan'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const caravan = req.cardIds.find((id) => state.cards[id].name === 'Caravan')!;
      return JSON.stringify([caravan]);
    });
    await engine.start();

    // T1 (p0): Haven sets aside the (unplayed) Caravan.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Haven') });
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Caravan', 'Haven']);

    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): the Caravan must NOT fire its own later half from the zone —
    // it comes back to hand as a plain card (no ghost draw, no In-Play trip).
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes('Caravan resolves'))).toBe(false);
    expect(names(state, HAND('p0'))).toContain('Caravan');
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + the Caravan
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Haven']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Lighthouse', () => {
  it('waves off an attack from the DURATION zone, then pays its later +$1', async () => {
    const def = await freshDef();
    // Militia sits in the default (First Game) kingdom — dealt off the supply.
    def.setup.push(fromReserve('Lighthouse'), dealNamed('Militia', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): +1 Action +$1, then Lighthouse parks.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Lighthouse') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, DURATION('p0'))).toEqual(['Lighthouse']);
    await passTurn(engine, 'p0');

    // T2 (p1): Militia attacks; p0 waves it off from the set-aside strip.
    // Were the immunity to fail, the discard-to-3 choice would fire and the
    // no-choice answerer would throw.
    state = engine.getState();
    await engine.performAction('p1', { ...play, cardId: findNamed(state, HAND('p1'), 'Militia') });
    await driveWindow(engine, 'p0', 'dom_action_lighthouse');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(state.log.some((l) => l.text.includes('Lighthouse shines'))).toBe(true);
    expect(count(state, HAND('p0'))).toBe(5); // untouched — immune
    expect(state.players[1].vars['dom_var_coins']).toBe(2); // Militia's coins still pay
    // Immunity faded with the attack (the shared effectResolved reset).
    expect(state.players[0].vars['dom_var_immune']).toBe(0);
    await passTurn(engine, 'p1');

    // T3 (p0): the later +$1, and Lighthouse is back in play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Lighthouse']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Throne Room x Duration', () => {
  it('replaying a Caravan runs now twice, parks it once, and fires later once', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Throne Room'), fromReserve('Caravan'));
    // The Caravan is the hand's only Action, so Throne Room's single-card
    // pick auto-resolves ("only one option") — no choice ever reaches us.
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): Throne Room plays the Caravan twice — the now half runs twice
    // (+2 Cards +2 Actions total), but the card parks exactly once.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Throne Room') });
    state = engine.getState();
    expect(state.log.some((l) => l.text.includes('plays Caravan twice'))).toBe(true);
    expect(count(state, HAND('p0'))).toBe(7); // 7 - TR - Caravan + 2 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    expect(names(state, INPLAY('p0'))).toEqual(['Throne Room']);
    expect(names(state, DURATION('p0'))).toEqual(['Caravan']);

    // Cleanup discards the Throne Room (the redraw may reshuffle it right
    // into the deck); the parked Caravan stays put.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect([
      ...names(state, DISCARD('p0')), ...names(state, DECK('p0')), ...names(state, HAND('p0')),
    ]).toContain('Throne Room');
    expect(names(state, DURATION('p0'))).toEqual(['Caravan']);
    await passTurn(engine, 'p1');

    // T3 (p0): later fires ONCE — one extra card, one march back to In Play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.filter((l) => l.text.includes('Caravan resolves'))).toHaveLength(1);
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + 1 later draw
    expect(names(state, INPLAY('p0'))).toEqual(['Caravan']);
    expect(count(state, DURATION('p0'))).toBe(0);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect([
      ...names(state, DISCARD('p0')), ...names(state, DECK('p0')), ...names(state, HAND('p0')),
    ]).toContain('Caravan');
  });
});
