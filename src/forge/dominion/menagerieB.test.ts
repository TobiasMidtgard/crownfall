/**
 * Menagerie (part B) — deterministic per-card probes through the REAL
 * engine, in the seaside2eB / cornucopia1e test style: cards under test
 * start in the hidden RESERVE (or the live First Game supply) and are dealt
 * with an explicit fromZone; every probe asserts zero script errors
 * alongside the card's outcome.
 *
 * REGISTRATION: neither menagerie module is wired into expansions.ts yet
 * (the integrator does that — menagerieA BEFORE menagerieB). menagerieA
 * declares the shared Exile mats ('dom_zone_exile'), the Horse stock
 * ('dom_zone_horses') and the exile plumbing this module's cards lean on,
 * so BOTH modules are pushed into EXPANSIONS here at module scope, and
 * dominionGame is loaded through a dynamic import in beforeAll (none of
 * this file's static imports evaluates dominionGame.ts, so the pushes
 * always land first).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChoiceRequest, EngineHandle, Expr, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { menagerieA } from './menagerieA';
import { menagerieB } from './menagerieB';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(menagerieA)) EXPANSIONS.push(menagerieA);
if (!EXPANSIONS.includes(menagerieB)) EXPANSIONS.push(menagerieB);

let buildDominionDef: () => GameDef;
beforeAll(async () => {
  ({ buildDominionDef } = await import('../dominionGame'));
});

const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const DURATION = (p: string) => `dom_zone_duration:${p}`;
const EXILE = (p: string) => `dom_zone_exile:${p}`;
const SUPPLY = 'dom_zone_supply';
const HORSES = 'dom_zone_horses';

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;
const countOf = (state: GameState, zoneKey: string, name: string): number =>
  names(state, zoneKey).filter((n) => n === name).length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');

/** $card's name equals `name` (testKit's inline filter shape). */
const nameIsExpr = (name: string): Expr => ({
  kind: 'compare', op: '==',
  left: { kind: 'cardField', card: { kind: 'binding', name: '$card' }, fieldId: 'name' },
  right: { kind: 'str', value: name },
});

/** Setup block: move EVERY card matching the name between two shared zones. */
const moveAllNamed = (name: string, fromZone: string, toZone: string): GameDef['setup'][number] => ({
  kind: 'moveCards',
  from: { zoneId: fromZone, owner: null },
  to: { zoneId: toZone, owner: null },
  cards: { kind: 'filter', filter: nameIsExpr(name) },
  toPosition: 'top',
  faceUp: null,
});

const play = { actionId: 'dom_action_play' };
const noChoices = () => { throw new Error('no choices expected'); };

/** Action → Buy → Cleanup → the turn passes (three manual phases). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

describe('menagerieB module registration', () => {
  it('validates clean and knows all 15 kingdom cards with costs and type lines', () => {
    const def = buildDominionDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Barge: 5, Coven: 5, Displace: 5, Falconer: 5, Fisherman: 5,
      Gatekeeper: 5, 'Hunting Lodge': 5, Kiln: 5, Livery: 5, Mastermind: 5,
      Paddock: 5, Sanctuary: 5, Destrier: 6, Wayfarer: 6, 'Animal Fair': 7,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags, `${name} is a kingdom card`).toContain('dom_tag_kingdom');
      expect(card!.typeId, `${name} is Action-typed`).toBe('dom_type_action');
    }
    expect(def.cards.find((c) => c.name === 'Coven')!.tags).toContain('dom_tag_attack');
    expect(def.cards.find((c) => c.name === 'Gatekeeper')!.tags).toContain('dom_tag_attack');
    expect(def.cards.find((c) => c.name === 'Falconer')!.tags).toContain('dom_tag_reaction');
    // The shared menagerieA surfaces this module leans on exist in the def.
    expect(def.zones.some((z) => z.id === 'dom_zone_exile')).toBe(true);
    expect(def.zones.some((z) => z.id === 'dom_zone_horses')).toBe(true);
  });
});

describe('Barge', () => {
  it('"now" pays +3 Cards +1 Buy immediately and never parks', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Barge'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'barge_now';
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Barge') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Barge + 3 drawn
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(names(state, INPLAY('p0'))).toEqual(['Barge']);
    expect(count(state, DURATION('p0'))).toBe(0);

    // Cleaned up like any played card — no later half ever fires.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(count(state, INPLAY('p0'))).toBe(0);
  });

  it('"later" parks the card and pays at the owner\'s next turn start', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Barge'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'barge_later';
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Barge') });
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Barge, nothing now
    expect(state.players[0].vars['dom_var_buys']).toBe(1);
    expect(names(state, DURATION('p0'))).toEqual(['Barge']);

    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Barge']); // cleanup spares it
    await passTurn(engine, 'p1');

    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // 5 redrawn + 3 later draws
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(names(state, INPLAY('p0'))).toEqual(['Barge']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Coven', () => {
  it('+1 Action +$2; the opponent Exiles a Curse from the Supply', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Coven'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Coven') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, EXILE('p1'))).toEqual(['Curse']);
    expect(countOf(state, SUPPLY, 'Curse')).toBe(9);
    expect(count(state, DISCARD('p1'))).toBe(0); // exiling is NOT gaining
  });

  it('with the Curse pile empty, the opponent discards their Exiled Curses', async () => {
    const def = buildDominionDef();
    def.setup.push(
      moveAllNamed('Curse', 'dom_zone_supply', 'dom_zone_reserve'),
      dealNamed('Curse', 'dom_zone_exile', 'p1', 'dom_zone_reserve'),
      dealNamed('Curse', 'dom_zone_exile', 'p1', 'dom_zone_reserve'),
      fromReserve('Coven'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    expect(countOf(state, EXILE('p1'), 'Curse')).toBe(2);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Coven') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(countOf(state, EXILE('p1'), 'Curse')).toBe(0);
    expect(countOf(state, DISCARD('p1'), 'Curse')).toBe(2);
  });
});

describe('Displace', () => {
  it('exiles a hand card and gains a differently named card costing up to $2 more', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Displace'), dealNamed('Silver'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      if (req.kind === 'pile') {
        // Silver printed cost 3 → cap 5; the exiled name is excluded.
        for (const id of req.cardIds) {
          expect(state.cards[id].fields['dom_field_cost']).toBeLessThanOrEqual(5);
          expect(state.cards[id].name).not.toBe('Silver');
        }
        return req.cardIds.find((id) => state.cards[id].name === 'Duchy')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Displace') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['card', 'pile']);
    expect(names(state, EXILE('p0'))).toEqual(['Silver']);
    expect(names(state, DISCARD('p0'))).toContain('Duchy');
    expect(countOf(state, SUPPLY, 'Duchy')).toBe(7);
    expect(count(state, HAND('p0'))).toBe(5); // 7 - Displace - Silver
  });
});

describe('Falconer', () => {
  it('gains a card costing less than $5 to hand', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Falconer'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      for (const id of req.cardIds) {
        expect(state.cards[id].fields['dom_field_cost']).toBeLessThan(5);
      }
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Falconer') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p0'))).toContain('Silver');
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Falconer + Silver to hand
    expect(countOf(state, SUPPLY, 'Silver')).toBe(39);
  });

  it('reacts to ANY player gaining a multi-type card: the holder may play it', async () => {
    const def = buildDominionDef();
    def.setup.push(
      dealNamed('Workshop'),
      fromReserve('Falconer', 'dom_zone_hand', 'p1'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'pile' && req.playerId === 'p0') {
        // Workshop's gain: pick the Attack-tagged Militia (2 types).
        return req.cardIds.find((id) => state.cards[id].name === 'Militia')!;
      }
      if (req.kind === 'yesNo' && req.playerId === 'p1') return true;
      if (req.kind === 'pile' && req.playerId === 'p1') {
        // The played Falconer's own gain-to-hand.
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      throw new Error(`unexpected ${req.kind} choice for ${req.playerId}`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Workshop') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Militia');
    // The opponent's Falconer flew in response and gained a Silver to hand.
    expect(names(state, INPLAY('p1'))).toEqual(['Falconer']);
    expect(names(state, HAND('p1'))).toContain('Silver');
    expect(count(state, HAND('p1'))).toBe(6); // 6 - Falconer + Silver
  });
});

describe('Fisherman', () => {
  it('+1 Card +1 Action +$1 (flat printed cost — the discount is dropped)', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Fisherman'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Fisherman') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
  });
});

describe('Gatekeeper', () => {
  it('parks; the opponent\'s gained Action is Exiled; later pays +$3', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Gatekeeper'),
      dealNamed('Workshop', 'dom_zone_hand', 'p1'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Militia')!;
    });
    await engine.start();

    // T1 (p0): the strike opens a response window (nobody reacts), then the
    // card parks in the DURATION zone through cleanup.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Gatekeeper') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Gatekeeper']);
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Gatekeeper']);

    // T2 (p1): Workshop gains a Militia — the watched gain lands in Exile.
    state = engine.getState();
    await engine.performAction('p1', { ...play, cardId: findNamed(state, HAND('p1'), 'Workshop') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, EXILE('p1'))).toContain('Militia');
    expect(names(state, DISCARD('p1'))).not.toContain('Militia');
    await passTurn(engine, 'p1');

    // T3 (p0): the later +$3, and the Gatekeeper is back in play — the
    // watch has ended with it.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(names(state, INPLAY('p0'))).toEqual(['Gatekeeper']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });

  it('a Moat reveal shields the whole watch (nothing gets Exiled)', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Gatekeeper'),
      dealNamed('Moat', 'dom_zone_hand', 'p1'),
      dealNamed('Workshop', 'dom_zone_hand', 'p1'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Militia')!;
    });
    await engine.start();

    // T1 (p0): p1 reveals Moat during the strike's window.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Gatekeeper') });
    await playOutWindows(engine, 'p1');
    state = engine.getState();
    expect(state.players[1].vars['dom_var_gatekeeper_immune']).toBe(1);
    await passTurn(engine, 'p0');

    // T2 (p1): the gained Militia stays in the discard — no Exile.
    state = engine.getState();
    await engine.performAction('p1', { ...play, cardId: findNamed(state, HAND('p1'), 'Workshop') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p1'))).toContain('Militia');
    expect(count(state, EXILE('p1'))).toBe(0);
  });
});

describe('Hunting Lodge', () => {
  it('+1 Card +2 Actions, and may discard the hand for +5 Cards', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Hunting Lodge'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return true;
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Hunting Lodge') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    // 6 in hand after the draw, all discarded, 5 redrawn (reshuffle covers).
    expect(count(state, HAND('p0'))).toBe(5);
    expect(count(state, DECK('p0'))).toBe(5);
    expect(count(state, DISCARD('p0'))).toBe(0);
  });
});

describe('Kiln', () => {
  it('the NEXT played card offers a supply copy — not Kiln itself', async () => {
    const def = buildDominionDef();
    def.setup.push(
      dealNamed('Village'), dealNamed('Village'), dealNamed('Village'),
      fromReserve('Kiln'),
    );
    const yesNos: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      yesNos.push(req);
      return true;
    });
    await engine.start();

    // Village, Village, Kiln (arms), Village (consumes: one copy offered).
    for (const name of ['Village', 'Village', 'Kiln', 'Village']) {
      const state = engine.getState();
      await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), name) });
    }
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(yesNos).toHaveLength(1); // Kiln's own play never offers a copy
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars['dom_var_kiln_armed']).toBe(0);
    expect(names(state, DISCARD('p0'))).toContain('Village'); // the gained copy
    expect(countOf(state, SUPPLY, 'Village')).toBe(6); // 10 - 3 dealt - 1 copy
  });
});

describe('Livery', () => {
  it('a gain costing $4+ this turn pays a Horse from the stock', async () => {
    const def = buildDominionDef();
    def.setup.push(dealNamed('Village'), fromReserve('Livery'), dealNamed('Workshop'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Militia')!;
    });
    await engine.start();
    for (const name of ['Village', 'Livery', 'Workshop']) {
      const state = engine.getState();
      await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), name) });
    }
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(names(state, DISCARD('p0'))).toContain('Militia');
    expect(countOf(state, DISCARD('p0'), 'Horse')).toBe(1);
    expect(count(state, HORSES)).toBe(29);
  });
});

describe('Mastermind', () => {
  it('at the next turn start, plays a hand Action three times', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Mastermind'),
      // Five Smithies onto the deck top: the cleanup redraw makes them the
      // next hand, so the later half always finds an Action to triple.
      ...Array.from({ length: 5 }, () => dealNamed('Smithy', 'dom_zone_deck', 'p0')),
    );
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify([req.cardIds[0]]);
    });
    await engine.start();

    // T1 (p0): Mastermind parks through cleanup.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Mastermind') });
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Mastermind']);
    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): the chosen Smithy resolved three times (+9 Cards total) and
    // Mastermind marched back to In Play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes('three times'))).toBe(true);
    expect(count(state, HAND('p0'))).toBe(13); // 5 redrawn - Smithy + 9 drawn
    expect(names(state, INPLAY('p0'))).toContain('Smithy');
    expect(names(state, INPLAY('p0'))).toContain('Mastermind');
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Paddock', () => {
  it('+$2, gains 2 Horses, +1 Action per empty supply pile', async () => {
    const def = buildDominionDef();
    def.setup.push(
      // Empty the Curse pile: the leave-supply watcher recounts EMPTY_PILES.
      moveAllNamed('Curse', 'dom_zone_supply', 'dom_zone_reserve'),
      fromReserve('Paddock'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Paddock') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(countOf(state, DISCARD('p0'), 'Horse')).toBe(2);
    expect(count(state, HORSES)).toBe(28);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1 empty pile
  });
});

describe('Sanctuary', () => {
  it('+1 Card +1 Action +1 Buy, and may Exile a hand card', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Sanctuary'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify([req.cardIds[0]]);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Sanctuary') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(count(state, EXILE('p0'))).toBe(1);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Sanctuary + 1 drawn - 1 exiled
  });
});

describe('Destrier', () => {
  it('+2 Cards +1 Action (flat printed cost — the discount is dropped)', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Destrier'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Destrier') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Destrier + 2 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
  });
});

describe('Wayfarer', () => {
  it('+3 Cards and may gain a Silver', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Wayfarer'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return true;
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Wayfarer') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Wayfarer + 3 drawn
    expect(names(state, DISCARD('p0'))).toContain('Silver');
    expect(countOf(state, SUPPLY, 'Silver')).toBe(39);
  });
});

describe('Animal Fair', () => {
  it('+$4 and +1 Buy per empty supply pile', async () => {
    const def = buildDominionDef();
    def.setup.push(
      moveAllNamed('Curse', 'dom_zone_supply', 'dom_zone_reserve'),
      fromReserve('Animal Fair'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Animal Fair') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(4);
    expect(state.players[0].vars['dom_var_buys']).toBe(2); // 1 + 1 empty pile
  });
});
