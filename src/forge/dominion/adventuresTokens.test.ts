/**
 * Adventures pile-token Events — engine probes through the REAL engine: each
 * Event is promoted onto the table with pickLandscapes and bought via the
 * core 'dom_action_buy_event' (which fires the effect IN PLACE). The probes
 * pin: every token placed by its Event (the revealed Action-pile choice),
 * the bonus firing ONLY for the token's owner and ONLY on the marked pile's
 * plays, token relocation on a re-buy, Plan's optional trash on both the
 * 'buy' and the 'gain' path, and the absent-event negatives.
 *
 * REGISTRATION NOTE: the module is pushed into EXPANSIONS before
 * buildDominionDef is dynamically imported (the seaside harness pattern), so
 * this worker's def carries the token Events while other suites' pins stay
 * untouched.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  ChoiceAnswer, ChoiceRequest, EngineHandle, GameDef, GameState,
} from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import {
  TOK_ACTION, TOK_BUY, TOK_CARD, TOK_COIN, TOK_TRASH, adventuresTokens,
} from './adventuresTokens';
import { dealNamed, findNamed, probeEngine } from './testKit';

if (!EXPANSIONS.includes(adventuresTokens)) EXPANSIONS.push(adventuresTokens);

type Forge = typeof import('../dominionGame');
let forge: Forge;
let base: GameDef;

beforeAll(async () => {
  forge = await import('../dominionGame');
  base = forge.buildDominionDef();
});

const LANDSCAPES = 'dom_zone_landscapes';
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';
const HAND = (p: string) => `dom_zone_hand:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;
const pv = (state: GameState, varId: string, seat = 0): unknown =>
  state.players[seat].vars[varId];

/** A picked-landscapes def with per-player initial coins/buys overridden. */
function tableWith(landscapes: string[], opts: { coins?: number; buys?: number } = {}): GameDef {
  const def = forge.pickLandscapes(base, landscapes);
  if (opts.coins !== undefined) {
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = opts.coins;
  }
  if (opts.buys !== undefined) {
    def.variables.find((v) => v.id === 'dom_var_buys')!.initial = opts.buys;
  }
  return def;
}

/** Setup block: the named supply card onto a player's DECK TOP (so the
 *  previous cleanup's redraw of five delivers it into their next hand). */
const toDeckTop = (name: string, player: string | null = null) =>
  dealNamed(name, 'dom_zone_deck', player);

type Answerer = (req: ChoiceRequest, state: GameState) => ChoiceAnswer;

/** Answer choices in order; throws on extras or a kind mismatch. */
function scripted(...steps: Answerer[]): Answerer {
  let i = 0;
  return (req, state) => {
    if (i >= steps.length) throw new Error(`unexpected extra choice: ${req.prompt}`);
    return steps[i++](req, state);
  };
}
const noChoices: Answerer = (req) => {
  throw new Error(`no choice expected, got: ${req.prompt}`);
};
/** Pile choice → the representative whose name matches. */
const pickPile = (name: string): Answerer => (req, state) => {
  if (req.kind !== 'pile') throw new Error(`expected a pile choice, got ${req.kind}`);
  const id = req.cardIds.find((cid) => state.cards[cid].name === name);
  if (id === undefined) throw new Error(`pile "${name}" not offered`);
  return id;
};
/** Multi-select → the first `n` offered candidates, whatever they are. */
const pickFirstCards = (n: number): Answerer => (req) => {
  if (req.kind !== 'cards') throw new Error(`expected a cards choice, got ${req.kind}`);
  return JSON.stringify(req.cardIds.slice(0, n));
};
/** Multi-select → decline (legal when min is 0). */
const declineCards: Answerer = (req) => {
  if (req.kind !== 'cards') throw new Error(`expected a cards choice, got ${req.kind}`);
  return JSON.stringify([]);
};

async function toBuyPhase(engine: EngineHandle, pid = 'p0'): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
}
async function buyEvent(engine: EngineHandle, name: string, pid = 'p0'): Promise<void> {
  const id = findNamed(engine.getState(), LANDSCAPES, name);
  await engine.performAction(pid, { actionId: 'dom_action_buy_event', cardId: id });
}
async function buyCard(engine: EngineHandle, name: string, pid = 'p0'): Promise<void> {
  const id = findNamed(engine.getState(), SUPPLY, name);
  await engine.performAction(pid, { actionId: 'dom_action_buy', cardId: id });
}
async function playAction(engine: EngineHandle, name: string, pid = 'p0'): Promise<void> {
  const id = findNamed(engine.getState(), HAND(pid), name);
  await engine.performAction(pid, { actionId: 'dom_action_play', cardId: id });
}
/** End the buy phase and clean up (the manual cleanup phase's one action). */
async function endTurn(engine: EngineHandle, pid = 'p0'): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}
/** A whole turn where `pid` does nothing at all. */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await toBuyPhase(engine, pid);
  await endTurn(engine, pid);
}

describe('adventuresTokens module registration', () => {
  it('validates with zero errors and zero warnings, unpicked and picked', () => {
    expect(validateGameDef(base)).toEqual([]);
    expect(validateGameDef(forge.pickLandscapes(
      base, ['Plan', 'Seaway', 'Lost Arts', 'Training', 'Pathfinding'],
    ))).toEqual([]);
  });

  it('ships all 5 token Events in the landscape catalog, never the kingdom catalog', () => {
    const land = forge.landscapeCatalog(base);
    const expected: Record<string, number> = {
      Plan: 3, Seaway: 5, 'Lost Arts': 6, Training: 6, Pathfinding: 8,
    };
    for (const [name, cost] of Object.entries(expected)) {
      expect(land.find((l) => l.name === name), `${name} in the catalog`).toMatchObject(
        { cost, kind: 'event', expansion: 'Adventures' },
      );
      expect(base.cards.find((c) => c.name === name)!.typeId).toBe('dom_type_event');
    }
    const kingdom = forge.kingdomCardNames(base);
    for (const name of Object.keys(expected)) expect(kingdom).not.toContain(name);
  });
});

describe('Lost Arts (+1 Action token)', () => {
  it('places on an Action pile, relocates on a re-buy, and grants only its owner on the marked pile', async () => {
    const def = tableWith(['Lost Arts'], { coins: 12, buys: 2 });
    def.setup.push(toDeckTop('Village'), toDeckTop('Smithy'), toDeckTop('Village', 'p1'));
    const requests: ChoiceRequest[] = [];
    const answer = scripted(pickPile('Smithy'), pickPile('Village'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      return answer(req, state);
    });
    await engine.start();

    // T1 (p0): first buy marks the Smithy pile; the offer is Actions only.
    await toBuyPhase(engine);
    await buyEvent(engine, 'Lost Arts');
    let state = engine.getState();
    expect(pv(state, TOK_ACTION)).toBe('Smithy');
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'pile' }>;
    const offered = req.cardIds.map((cid) => state.cards[cid].name);
    expect(offered).toContain('Smithy');
    expect(offered).toContain('Village');
    expect(offered).not.toContain('Copper'); // Treasure — not an Action pile
    expect(offered).not.toContain('Estate'); // Victory — not an Action pile
    // Re-buy the same turn: the token MOVES (relocation, not accumulation).
    await buyEvent(engine, 'Lost Arts');
    state = engine.getState();
    expect(pv(state, TOK_ACTION)).toBe('Village');
    await endTurn(engine);
    await passTurn(engine, 'p1');

    // T3 (p0): the marked Village grants +1 Action; the abandoned Smithy
    // pile grants nothing.
    await playAction(engine, 'Village');
    state = engine.getState();
    expect(pv(state, 'dom_var_actions')).toBe(3); // 1 - 1 + 2 + 1 token
    await playAction(engine, 'Smithy');
    state = engine.getState();
    expect(pv(state, 'dom_var_actions')).toBe(2); // 3 - 1, no token bonus
    await toBuyPhase(engine);
    await endTurn(engine);

    // T4 (p1): p1 plays from p0's marked pile — no cross-owner bonus.
    await playAction(engine, 'Village', 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_actions', 1)).toBe(2); // 1 - 1 + 2, no token
    expect(pv(state, TOK_ACTION, 1)).toBe(''); // p1 never placed a token
  });
});

describe('Pathfinding (+1 Card token)', () => {
  it('a play from the marked pile first draws one extra card', async () => {
    const def = tableWith(['Pathfinding'], { coins: 8 });
    def.setup.push(toDeckTop('Smithy'));
    const { engine, errors } = probeEngine(def, scripted(pickPile('Smithy')));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Pathfinding');
    let state = engine.getState();
    expect(pv(state, TOK_CARD)).toBe('Smithy');
    await endTurn(engine);
    await passTurn(engine, 'p1');

    // T3 (p0): Smithy's +3 Cards plus the token's +1.
    await playAction(engine, 'Smithy');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // 5 - Smithy + 3 + 1 token
    expect(pv(state, 'dom_var_actions')).toBe(0); // no stray Action bonus
  });
});

describe('Training (+$1 token)', () => {
  it('a play from the marked pile first pays +$1', async () => {
    const def = tableWith(['Training'], { coins: 6 });
    def.setup.push(toDeckTop('Village'));
    const { engine, errors } = probeEngine(def, scripted(pickPile('Village')));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Training');
    let state = engine.getState();
    expect(pv(state, TOK_COIN)).toBe('Village');
    await endTurn(engine);
    await passTurn(engine, 'p1');

    // T3 (p0): coins were reset to 0 at cleanup; the token pays the only $1.
    await playAction(engine, 'Village');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_coins')).toBe(1); // 0 + 1 token
    expect(pv(state, 'dom_var_actions')).toBe(2); // 1 - 1 + 2, no extra
  });
});

describe('Seaway (+1 Buy token)', () => {
  it('gains an Action up to $4 (no immediate +1 Buy) and marks its pile', async () => {
    const def = tableWith(['Seaway'], { coins: 5 });
    def.setup.push(toDeckTop('Smithy'));
    const requests: ChoiceRequest[] = [];
    const answer = scripted(pickPile('Smithy'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      return answer(req, state);
    });
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Seaway');
    let state = engine.getState();
    expect(pv(state, TOK_BUY)).toBe('Smithy');
    expect(names(state, DISCARD('p0'))).toEqual(['Smithy']); // the gain
    expect(pv(state, 'dom_var_buys')).toBe(0); // 1 - 1: the print has no +1 Buy
    expect(pv(state, 'dom_var_coins')).toBe(0);
    // The gain offer respected both the Action filter and the $4 cap.
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'pile' }>;
    const offered = req.cardIds.map((cid) => state.cards[cid].name);
    expect(offered).toContain('Smithy'); // $4 Action
    expect(offered).not.toContain('Market'); // $5 — over the cap
    expect(offered).not.toContain('Mine'); // $5 — over the cap
    expect(offered).not.toContain('Silver'); // Treasure — not an Action
    await endTurn(engine);
    await passTurn(engine, 'p1');

    // T3 (p0): a play from the marked pile first gets +1 Buy.
    await playAction(engine, 'Smithy');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_buys')).toBe(2); // 1 + 1 token
    expect(count(state, HAND('p0'))).toBe(7); // 5 - Smithy + 3, no card bonus
  });
});

describe('Plan (the Trashing token)', () => {
  it('BUYING from the marked pile offers the optional hand trash; other piles stay silent', async () => {
    const def = tableWith(['Plan'], { coins: 7, buys: 3 });
    const { engine, errors } = probeEngine(def, scripted(
      pickPile('Smithy'),
      pickFirstCards(1),
    ));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Plan'); // $3
    let state = engine.getState();
    expect(pv(state, TOK_TRASH)).toBe('Smithy');
    // Buying from the marked pile: the optional trash fires (accepted).
    await buyCard(engine, 'Smithy'); // $4
    state = engine.getState();
    expect(count(state, TRASH)).toBe(1); // one starter card burned
    expect(count(state, HAND('p0'))).toBe(4);
    expect(names(state, DISCARD('p0'))).toContain('Smithy');
    // Buying from an UNMARKED pile: no offer (scripted would throw on one).
    await buyCard(engine, 'Copper'); // $0, the third buy
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, TRASH)).toBe(1);
    expect(names(state, DISCARD('p0'))).toContain('Copper');
  });

  it('GAINING from the marked pile (Workshop) offers the trash too; declining trashes nothing', async () => {
    const def = tableWith(['Plan'], { coins: 3 });
    def.setup.push(toDeckTop('Workshop'));
    const { engine, errors } = probeEngine(def, scripted(
      pickPile('Smithy'), // Plan's placement
      pickPile('Smithy'), // Workshop's gain
      declineCards, // Plan's trash offer, declined
    ));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Plan');
    expect(pv(engine.getState(), TOK_TRASH)).toBe('Smithy');
    await endTurn(engine);
    await passTurn(engine, 'p1');

    // T3 (p0): Workshop gains a Smithy — tagged 'gain', not 'buy' — and the
    // Trashing token still asks (the 2022 wording); the decline holds.
    await playAction(engine, 'Workshop');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Smithy');
    expect(count(state, TRASH)).toBe(0);
    expect(count(state, HAND('p0'))).toBe(4); // 5 - Workshop, nothing trashed
  });
});

describe('absent events (the negatives)', () => {
  it('with no token Events on the table, plays and buys trigger nothing', async () => {
    const def = tableWith([], { coins: 3 });
    def.setup.push(toDeckTop('Smithy'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): a plain buy — no Plan offer.
    await toBuyPhase(engine);
    await buyCard(engine, 'Silver');
    await endTurn(engine);
    await passTurn(engine, 'p1');

    // T3 (p0): a plain Smithy play — no token bonuses of any kind.
    await playAction(engine, 'Smithy');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, LANDSCAPES)).toBe(0);
    expect(count(state, HAND('p0'))).toBe(7); // 5 - Smithy + 3, nothing extra
    expect(pv(state, 'dom_var_actions')).toBe(0); // 1 - 1
    expect(pv(state, 'dom_var_coins')).toBe(0);
    expect(pv(state, 'dom_var_buys')).toBe(1);
    for (const varId of [TOK_CARD, TOK_ACTION, TOK_COIN, TOK_BUY, TOK_TRASH]) {
      expect(pv(state, varId, 0)).toBe('');
      expect(pv(state, varId, 1)).toBe('');
    }
  });
});
