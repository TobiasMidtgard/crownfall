/**
 * Empires Events — engine probes for all 13 Events through the REAL engine:
 * each Event is promoted onto the table with pickLandscapes and bought via
 * the core 'dom_action_buy_event' (which fires the effect IN PLACE), plus
 * the debt cycle the sideboard core demands: a debt-cost Event leaves the
 * buyer owing, every further purchase (card AND event) is refused while the
 * debt stands, and 'dom_action_pay_debt' clears it $1 at a time.
 *
 * REGISTRATION NOTE: the module is pushed into EXPANSIONS before
 * buildDominionDef is dynamically imported (the seaside harness pattern), so
 * this worker's def carries the Empires Events while other suites' pins stay
 * untouched.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  ChoiceAnswer, ChoiceRequest, EngineHandle, GameDef, GameState,
} from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { ALL, move, zone } from '../../examples/dsl';
import { EXPANSIONS } from './expansions';
import { CONQUEST_SILVERS, TAX_PILE, TRIUMPH_GAINS, empiresEvents } from './empiresEvents';
import { dealNamed, findNamed, probeEngine } from './testKit';

if (!EXPANSIONS.includes(empiresEvents)) EXPANSIONS.push(empiresEvents);

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
const DECK = (p: string) => `dom_zone_deck:${p}`;
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
/** Single-card choice → the candidate whose name matches. */
const pickCard = (name: string): Answerer => (req, state) => {
  if (req.kind !== 'card') throw new Error(`expected a card choice, got ${req.kind}`);
  const id = req.cardIds.find((cid) => state.cards[cid].name === name);
  if (id === undefined) throw new Error(`card "${name}" not offered`);
  return id;
};
/** Multi-select → every candidate whose name is in `wanted` (with repeats). */
const pickCards = (...wanted: string[]): Answerer => (req, state) => {
  if (req.kind !== 'cards') throw new Error(`expected a cards choice, got ${req.kind}`);
  const pool = [...wanted];
  const ids: string[] = [];
  for (const cid of req.cardIds) {
    const at = pool.indexOf(state.cards[cid].name);
    if (at >= 0) { ids.push(cid); pool.splice(at, 1); }
  }
  if (pool.length > 0) throw new Error(`cards not offered: ${pool.join(', ')}`);
  return JSON.stringify(ids);
};

async function toBuyPhase(engine: EngineHandle): Promise<void> {
  await engine.performAction('p0', { actionId: 'dom_action_done' });
}
async function buyEvent(engine: EngineHandle, name: string): Promise<void> {
  const id = findNamed(engine.getState(), LANDSCAPES, name);
  await engine.performAction('p0', { actionId: 'dom_action_buy_event', cardId: id });
}
async function buyCard(engine: EngineHandle, name: string): Promise<void> {
  const id = findNamed(engine.getState(), SUPPLY, name);
  await engine.performAction('p0', { actionId: 'dom_action_buy', cardId: id });
}

describe('empiresEvents module registration', () => {
  it('validates with zero errors and zero warnings, unpicked and picked', () => {
    expect(validateGameDef(base)).toEqual([]);
    expect(validateGameDef(forge.pickLandscapes(base, ['Dominate', 'Tax']))).toEqual([]);
  });

  it('ships all 13 Events in the landscape catalog, never the kingdom catalog', () => {
    const land = forge.landscapeCatalog(base);
    const expected: Record<string, number> = {
      Advance: 0, Annex: 0, Banquet: 3, Conquest: 6, Delve: 2, Dominate: 14,
      Donate: 0, Ritual: 4, 'Salt the Earth': 4, Tax: 2, Triumph: 0,
      Wedding: 4, Windfall: 5,
    };
    for (const [name, cost] of Object.entries(expected)) {
      expect(land.find((l) => l.name === name), `${name} in the catalog`).toMatchObject(
        { cost, kind: 'event', expansion: 'Empires' },
      );
      expect(base.cards.find((c) => c.name === name)!.typeId).toBe('dom_type_event');
    }
    const kingdom = forge.kingdomCardNames(base);
    for (const name of Object.keys(expected)) expect(kingdom).not.toContain(name);
  });
});

describe('Advance', () => {
  it('trashes an Action from hand for an Action costing up to $6', async () => {
    const def = tableWith(['Advance']);
    def.setup.push(dealNamed('Village'));
    const { engine, errors } = probeEngine(def, scripted(
      pickCards('Village'),
      pickPile('Festival'),
    ));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Advance');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Village']);
    expect(names(state, DISCARD('p0'))).toEqual(['Festival']);
    expect(pv(state, 'dom_var_buys')).toBe(0);
    // The Event stays on the table (bought in place).
    expect(names(state, LANDSCAPES)).toContain('Advance');
  });
});

describe('Annex', () => {
  it('takes 8 debt, shuffles all but the kept discard into the deck, gains a Duchy', async () => {
    const def = tableWith(['Annex']);
    def.setup.push(
      dealNamed('Silver', 'dom_zone_discard'),
      dealNamed('Gold', 'dom_zone_discard'),
    );
    const { engine, errors } = probeEngine(def, scripted(pickCards('Gold')));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Annex');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_debt')).toBe(8);
    // The Gold stayed out, the Silver shuffled in, the Duchy arrived.
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Duchy', 'Gold']);
    expect(names(state, DECK('p0'))).toContain('Silver');
    expect(count(state, DECK('p0'))).toBe(6);
  });
});

describe('Banquet', () => {
  it('gains 2 Coppers and a non-Victory card costing up to $5', async () => {
    const def = tableWith(['Banquet'], { coins: 3 });
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      return pickPile('Silver')(req, state);
    });
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Banquet');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_coins')).toBe(0);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Copper', 'Copper', 'Silver']);
    // The pile choice offered no Victory cards and nothing over $5.
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'pile' }>;
    const offered = req.cardIds.map((cid) => engine.getState().cards[cid].name);
    expect(offered).not.toContain('Estate');
    expect(offered).not.toContain('Duchy');
    expect(offered).not.toContain('Province');
    expect(offered).not.toContain('Gold'); // $6 — over the cap
  });
});

describe('Conquest', () => {
  it('gains 2 Silvers and banks 1 VP per Silver gained this turn', async () => {
    // Buy a Silver first: the watcher counts it, then Conquest adds its own
    // two inline — 3 VP total.
    const def = tableWith(['Conquest'], { coins: 9, buys: 3 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await buyCard(engine, 'Silver');
    let state = engine.getState();
    expect(pv(state, CONQUEST_SILVERS)).toBe(1);
    await buyEvent(engine, 'Conquest');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver', 'Silver', 'Silver']);
    expect(pv(state, 'dom_var_vp_tokens')).toBe(3);
    expect(pv(state, CONQUEST_SILVERS)).toBe(3); // the watcher caught up
    expect(pv(state, 'dom_var_coins')).toBe(0);
  });

  it('an ABSENT Conquest tracks nothing (the presence gate)', async () => {
    const def = tableWith([], { coins: 3, buys: 2 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await buyCard(engine, 'Silver');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, LANDSCAPES)).toBe(0);
    expect(pv(state, CONQUEST_SILVERS)).toBe(0);
    expect(pv(state, TRIUMPH_GAINS)).toBe(0);
  });
});

describe('Delve', () => {
  it('replaces its own buy — chains while the coins last', async () => {
    const def = tableWith(['Delve'], { coins: 4, buys: 1 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Delve');
    let state = engine.getState();
    expect(pv(state, 'dom_var_buys')).toBe(1); // 1 - 1 + 1
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
    await buyEvent(engine, 'Delve'); // the Event never left the table
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_coins')).toBe(0);
    expect(pv(state, 'dom_var_buys')).toBe(1);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver', 'Silver']);
    expect(names(state, LANDSCAPES)).toContain('Delve');
  });
});

describe('Dominate', () => {
  it('gains a Province and banks 9 VP', async () => {
    const def = tableWith(['Dominate'], { coins: 14 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Dominate');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Province']);
    expect(pv(state, 'dom_var_vp_tokens')).toBe(9);
    expect(pv(state, 'dom_var_coins')).toBe(0);
  });
});

describe('Donate', () => {
  it('merges deck + discard into the hand, trashes the picks, reshuffles and draws 5', async () => {
    const def = tableWith(['Donate']);
    const { engine, errors } = probeEngine(def, scripted(
      pickCards('Copper', 'Copper', 'Copper', 'Copper', 'Copper', 'Copper', 'Copper'),
    ));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Donate');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_debt')).toBe(8);
    // Starter deck = 7 Copper + 3 Estate: all Coppers donated, the 3 Estates
    // shuffled and redrawn (only 3 cards remain to draw).
    expect(names(state, TRASH)).toEqual(Array.from({ length: 7 }, () => 'Copper'));
    expect(names(state, HAND('p0'))).toEqual(['Estate', 'Estate', 'Estate']);
    expect(count(state, DECK('p0'))).toBe(0);
    expect(count(state, DISCARD('p0'))).toBe(0);
  });
});

describe('Ritual', () => {
  it('gains a Curse, trashes a hand card, banks its cost in VP', async () => {
    const def = tableWith(['Ritual'], { coins: 4 });
    def.setup.push(dealNamed('Gold'));
    const { engine, errors } = probeEngine(def, scripted(pickCard('Gold')));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Ritual');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Curse']);
    expect(names(state, TRASH)).toEqual(['Gold']);
    expect(pv(state, 'dom_var_vp_tokens')).toBe(6); // Gold costs $6
  });
});

describe('Salt the Earth', () => {
  it('banks 1 VP and trashes a Victory card straight from the supply', async () => {
    const def = tableWith(['Salt the Earth'], { coins: 4 });
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      return pickPile('Province')(req, state);
    });
    await engine.start();
    const provincesBefore = count(engine.getState(), SUPPLY);
    await toBuyPhase(engine);
    await buyEvent(engine, 'Salt the Earth');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_vp_tokens')).toBe(1);
    expect(names(state, TRASH)).toEqual(['Province']);
    expect(count(state, SUPPLY)).toBe(provincesBefore - 1);
    // Only Victory piles were on offer.
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'pile' }>;
    const offered = req.cardIds.map((cid) => state.cards[cid].name).sort();
    expect(offered).toEqual(['Duchy', 'Estate', 'Province']);
  });
});

describe('Tax', () => {
  it('marks a pile; the next buy from it takes 2 debt, then the mark clears', async () => {
    const def = tableWith(['Tax'], { coins: 5, buys: 3 });
    const { engine, errors } = probeEngine(def, scripted(pickPile('Silver')));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Tax');
    let state = engine.getState();
    expect(state.globalVars[TAX_PILE]).toBe('Silver');
    expect(pv(state, 'dom_var_debt')).toBe(0); // the taxer owes nothing
    await buyCard(engine, 'Silver');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_debt')).toBe(2); // the buyer took the tax
    expect(state.globalVars[TAX_PILE]).toBe(''); // the mark cleared
    // The fresh debt blocks the next purchase.
    await expect(buyCard(engine, 'Copper')).rejects.toThrow();
  });
});

describe('Triumph', () => {
  it('takes 5 debt, gains an Estate, banks 1 VP per card gained this turn', async () => {
    const def = tableWith(['Triumph'], { coins: 3, buys: 3 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await buyCard(engine, 'Silver'); // 1 card gained before the Event
    await buyEvent(engine, 'Triumph');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_debt')).toBe(5);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Estate', 'Silver']);
    expect(pv(state, 'dom_var_vp_tokens')).toBe(2); // the Silver + the Estate
    expect(pv(state, TRIUMPH_GAINS)).toBe(2); // the watcher caught up
  });
});

describe('Wedding + the debt cycle (the sideboard contract)', () => {
  it('leaves the buyer in debt, refuses every purchase, pays down, then buys again', async () => {
    const def = tableWith(['Wedding', 'Delve'], { coins: 10, buys: 5 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);

    await buyEvent(engine, 'Wedding');
    let state = engine.getState();
    expect(pv(state, 'dom_var_coins')).toBe(6);
    expect(pv(state, 'dom_var_debt')).toBe(3);
    expect(pv(state, 'dom_var_vp_tokens')).toBe(1);
    expect(names(state, DISCARD('p0'))).toEqual(['Gold']);
    expect(pv(state, 'dom_var_buys')).toBe(4); // buys remain — debt is the only block

    // While owing: a CARD buy and an EVENT buy are both refused.
    await expect(buyCard(engine, 'Copper')).rejects.toThrow();
    await expect(buyEvent(engine, 'Delve')).rejects.toThrow();

    // The core pay-down action clears it $1 at a time.
    await engine.performAction('p0', { actionId: 'dom_action_pay_debt' });
    await engine.performAction('p0', { actionId: 'dom_action_pay_debt' });
    state = engine.getState();
    expect(pv(state, 'dom_var_debt')).toBe(1);
    await expect(buyCard(engine, 'Copper')).rejects.toThrow(); // still owing $1
    await engine.performAction('p0', { actionId: 'dom_action_pay_debt' });
    state = engine.getState();
    expect(pv(state, 'dom_var_debt')).toBe(0);
    expect(pv(state, 'dom_var_coins')).toBe(3);

    // Debt cleared: both purchase kinds work again.
    await buyEvent(engine, 'Delve');
    await buyCard(engine, 'Copper');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Copper', 'Gold', 'Silver']);
  });
});

describe('Windfall', () => {
  it('gains 3 Golds when deck and discard are both empty', async () => {
    const def = tableWith(['Windfall'], { coins: 5 });
    // After the setup draw, sweep the rest of the deck into the hand.
    def.setup.push(move(ALL, zone('dom_zone_deck'), zone('dom_zone_hand'), { faceUp: true }));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    expect(count(engine.getState(), DECK('p0'))).toBe(0);
    await toBuyPhase(engine);
    await buyEvent(engine, 'Windfall');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Gold', 'Gold', 'Gold']);
  });

  it('whiffs when the deck is not empty', async () => {
    const def = tableWith(['Windfall'], { coins: 5 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Windfall');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(pv(state, 'dom_var_coins')).toBe(0); // the price is still paid
  });
});
