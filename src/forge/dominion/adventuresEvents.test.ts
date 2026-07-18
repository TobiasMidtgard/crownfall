/**
 * Adventures Events — engine probes for the 12 token-free Events through the
 * REAL engine: each Event is promoted onto the table with pickLandscapes and
 * bought via the core 'dom_action_buy_event' (which fires the effect IN
 * PLACE). The cleanup-shape probes drive full turns so the modified redraws
 * (Expedition's +2, the -1 Card token's "redraw 4", Save's homecoming) are
 * observed ACROSS a real cleanup, and the mini-token watchers (Travelling
 * Fair's topdeck window, Ball's -$1) are exercised plus their
 * absent-landscape negatives.
 *
 * REGISTRATION NOTE: the module is pushed into EXPANSIONS before
 * buildDominionDef is dynamically imported (the seaside harness pattern), so
 * this worker's def carries the Adventures Events while other suites' pins
 * stay untouched.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type {
  ChoiceAnswer, ChoiceRequest, EngineHandle, GameDef, GameState,
} from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import {
  ALMS_USED, EXPEDITION_BONUS, JOURNEY, MINUS_CARD, MINUS_COIN, SAVE_ZONE,
  TFAIR_ACTIVE, adventuresEvents,
} from './adventuresEvents';
import { dealNamed, findNamed, probeEngine } from './testKit';

if (!EXPANSIONS.includes(adventuresEvents)) EXPANSIONS.push(adventuresEvents);

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
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const SAVE = (p: string) => `${SAVE_ZONE}:${p}`;

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
/** Multi-select → the first `n` offered candidates, whatever they are. */
const pickFirstCards = (n: number): Answerer => (req) => {
  if (req.kind !== 'cards') throw new Error(`expected a cards choice, got ${req.kind}`);
  return JSON.stringify(req.cardIds.slice(0, n));
};
/** Option choice → the given option id. */
const pickOption = (optionId: string): Answerer => (req) => {
  if (req.kind !== 'option') throw new Error(`expected an option choice, got ${req.kind}`);
  return optionId;
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
async function playTreasure(engine: EngineHandle, name: string, pid = 'p0'): Promise<void> {
  const id = findNamed(engine.getState(), HAND(pid), name);
  await engine.performAction(pid, { actionId: 'dom_action_treasure', cardId: id });
}
/** End the buy phase and clean up (the manual cleanup phase's one action). */
async function endTurn(engine: EngineHandle, pid = 'p0'): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

describe('adventuresEvents module registration', () => {
  it('validates with zero errors and zero warnings, unpicked and picked', () => {
    expect(validateGameDef(base)).toEqual([]);
    expect(validateGameDef(forge.pickLandscapes(base, ['Alms', 'Raid', 'Travelling Fair']))).toEqual([]);
  });

  it('ships all 12 Events in the landscape catalog, never the kingdom catalog', () => {
    const land = forge.landscapeCatalog(base);
    const expected: Record<string, number> = {
      Alms: 0, Borrow: 0, Quest: 0, Save: 1, 'Scouting Party': 2,
      'Travelling Fair': 2, Bonfire: 3, Expedition: 3, Pilgrimage: 4,
      Ball: 5, Raid: 5, Trade: 5,
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

describe('Alms', () => {
  it('gains a card up to $4 with no Treasures in play; once per turn only', async () => {
    const def = tableWith(['Alms'], { buys: 2 });
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      return pickPile('Silver')(req, state);
    });
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Alms');
    let state = engine.getState();
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
    // The pile offer respected the $4 cap.
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'pile' }>;
    const offered = req.cardIds.map((cid) => state.cards[cid].name);
    expect(offered).not.toContain('Gold'); // $6 — over the cap
    expect(offered).not.toContain('Duchy'); // $5 — over the cap
    // Second buy the same turn: accepted but whiffs (register).
    await buyEvent(engine, 'Alms');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
    expect(pv(state, ALMS_USED)).toBe(1);
  });

  it('whiffs while a Treasure is in play', async () => {
    const def = tableWith(['Alms']);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await playTreasure(engine, 'Copper'); // the starter hand always holds Coppers
    await buyEvent(engine, 'Alms');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DISCARD('p0'))).toBe(0);
  });
});

describe('Borrow', () => {
  it('+1 Buy and +$1 with the -1 Card token; the next cleanup redraws 4', async () => {
    const def = tableWith(['Borrow'], { coins: 0, buys: 1 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Borrow');
    let state = engine.getState();
    expect(pv(state, 'dom_var_buys')).toBe(1); // 1 - 1 + 1
    expect(pv(state, 'dom_var_coins')).toBe(1);
    expect(pv(state, MINUS_CARD)).toBe(1);
    // A second Borrow the same turn does nothing (once per turn — register).
    await buyEvent(engine, 'Borrow');
    state = engine.getState();
    expect(pv(state, 'dom_var_buys')).toBe(0); // spent, not replaced
    expect(pv(state, 'dom_var_coins')).toBe(1);
    // Across the cleanup: the redraw is 4, the token is spent.
    await endTurn(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(4);
    expect(pv(state, MINUS_CARD)).toBe(0);
    // The card the token returned waits on top of the deck.
    expect(count(state, DECK('p0'))).toBe(1);
  });
});

describe('Quest', () => {
  it('discards two Curses for a Gold', async () => {
    const def = tableWith(['Quest']);
    def.setup.push(dealNamed('Curse'), dealNamed('Curse'));
    const { engine, errors } = probeEngine(def, scripted(
      pickOption('quest_curses'),
      pickCards('Curse', 'Curse'),
    ));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Quest');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Curse', 'Curse', 'Gold']);
  });

  it('an unmeetable pledge whiffs — no discard, no Gold (register)', async () => {
    const def = tableWith(['Quest']);
    const { engine, errors } = probeEngine(def, scripted(pickOption('quest_six')));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Quest'); // the 5-card starter hand cannot pledge six
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(count(state, HAND('p0'))).toBe(5);
  });
});

describe('Save', () => {
  it('sets a card aside and returns it to the hand after the cleanup redraw', async () => {
    const def = tableWith(['Save'], { coins: 1 });
    const { engine, errors } = probeEngine(def, scripted(pickCard('Copper')));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Save');
    let state = engine.getState();
    expect(pv(state, 'dom_var_buys')).toBe(1); // 1 - 1 + 1
    expect(count(state, HAND('p0'))).toBe(4);
    expect(names(state, SAVE('p0'))).toEqual(['Copper']);
    await endTurn(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // the redraw of 5 + the saved card
    expect(count(state, SAVE('p0'))).toBe(0);
  });
});

describe('Scouting Party', () => {
  it('+1 Buy; looks at the top 5, discards 3, puts the rest back on top', async () => {
    const def = tableWith(['Scouting Party'], { coins: 2 });
    const { engine, errors } = probeEngine(def, scripted(pickFirstCards(3)));
    await engine.start();
    expect(count(engine.getState(), DECK('p0'))).toBe(5); // starter deck after the deal
    await toBuyPhase(engine);
    await buyEvent(engine, 'Scouting Party');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_buys')).toBe(1); // 1 - 1 + 1
    expect(count(state, DISCARD('p0'))).toBe(3);
    expect(count(state, DECK('p0'))).toBe(2);
    expect(count(state, 'dom_zone_look')).toBe(0);
  });
});

describe('Travelling Fair', () => {
  it('+2 Buys; gained cards this turn may be topdecked', async () => {
    const def = tableWith(['Travelling Fair'], { coins: 6 });
    const { engine, errors } = probeEngine(def, scripted(
      pickOption('tfair_deck'),
      pickOption('tfair_keep'),
    ));
    await engine.start();
    const deckBefore = count(engine.getState(), DECK('p0'));
    await toBuyPhase(engine);
    await buyEvent(engine, 'Travelling Fair');
    let state = engine.getState();
    expect(pv(state, 'dom_var_buys')).toBe(2); // 1 - 1 + 2
    expect(pv(state, TFAIR_ACTIVE)).toBe(1);
    // First gain rides to the deck top; the second stays in the discard.
    await buyCard(engine, 'Silver');
    state = engine.getState();
    expect(count(state, DECK('p0'))).toBe(deckBefore + 1);
    expect(names(state, DECK('p0')).at(-1)).toBe('Silver'); // the zone top
    expect(count(state, DISCARD('p0'))).toBe(0);
    await buyCard(engine, 'Copper');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Copper']);
  });

  it('an ABSENT Travelling Fair never prompts on a gain (the presence gate)', async () => {
    const def = tableWith([], { coins: 3 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await buyCard(engine, 'Silver');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, LANDSCAPES)).toBe(0);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
    expect(pv(state, TFAIR_ACTIVE)).toBe(0);
  });
});

describe('Bonfire', () => {
  it('trashes up to 2 cards from IN PLAY', async () => {
    const def = tableWith(['Bonfire'], { coins: 3 });
    const { engine, errors } = probeEngine(def, scripted(pickCards('Copper', 'Copper')));
    await engine.start();
    await toBuyPhase(engine);
    await playTreasure(engine, 'Copper');
    await playTreasure(engine, 'Copper');
    await buyEvent(engine, 'Bonfire');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Copper', 'Copper']);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(pv(state, 'dom_var_coins')).toBe(2); // 3 + 2 played - 3 paid
  });
});

describe('Expedition', () => {
  it('bought twice: the cleanup redraw is 5 + 4', async () => {
    const def = tableWith(['Expedition'], { coins: 6, buys: 2 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Expedition');
    await buyEvent(engine, 'Expedition');
    let state = engine.getState();
    expect(pv(state, EXPEDITION_BONUS)).toBe(4);
    await endTurn(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(9);
    expect(pv(state, EXPEDITION_BONUS)).toBe(0); // spent, not carried over
  });

  it('stacks with Borrow across the same cleanup: 5 + 2 - 1', async () => {
    const def = tableWith(['Expedition', 'Borrow'], { coins: 2, buys: 2 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Borrow'); // +$1 → $3, the -1 Card token
    await buyEvent(engine, 'Expedition'); // $3 paid
    await endTurn(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6);
  });
});

describe('Pilgrimage', () => {
  it('face-up Journey token: gains copies of up to 3 in-play cards', async () => {
    const def = tableWith(['Pilgrimage'], { coins: 4 });
    def.setup.push(dealNamed('Silver'));
    // Start the token face DOWN so this (once-per-turn) buy flips it UP.
    def.variables.find((v) => v.id === JOURNEY)!.initial = 0;
    const { engine, errors } = probeEngine(def, scripted(pickCards('Copper', 'Silver')));
    await engine.start();
    await toBuyPhase(engine);
    await playTreasure(engine, 'Copper');
    await playTreasure(engine, 'Silver');
    await buyEvent(engine, 'Pilgrimage'); // $4 + $1 + $2 - $4 = $3 left
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, JOURNEY)).toBe(1);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Copper', 'Silver']);
    expect(pv(state, 'dom_var_coins')).toBe(3);
  });

  it('the printed start (face up): the first buy flips it down and whiffs', async () => {
    const def = tableWith(['Pilgrimage'], { coins: 4 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await playTreasure(engine, 'Copper');
    await buyEvent(engine, 'Pilgrimage'); // a card IS in play — still no gain
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, JOURNEY)).toBe(0);
    expect(count(state, DISCARD('p0'))).toBe(0);
  });
});

describe('Ball', () => {
  it('takes the -$1 token and gains 2 cards up to $4; the next Treasure pays it', async () => {
    const def = tableWith(['Ball'], { coins: 5 });
    const { engine, errors } = probeEngine(def, scripted(
      pickPile('Silver'),
      pickPile('Estate'),
    ));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Ball');
    let state = engine.getState();
    expect(pv(state, MINUS_COIN)).toBe(1);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Estate', 'Silver']);
    expect(pv(state, 'dom_var_coins')).toBe(0);
    // The next Treasure play yields $1 less and spends the token.
    await playTreasure(engine, 'Copper');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_coins')).toBe(0); // +$1 - $1
    expect(pv(state, MINUS_COIN)).toBe(0);
    // Spent: a further Copper pays normally.
    await playTreasure(engine, 'Copper');
    expect(pv(engine.getState(), 'dom_var_coins')).toBe(1);
  });

  it('an ABSENT Ball never eats a coin (the presence gate)', async () => {
    const def = tableWith([]);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await playTreasure(engine, 'Copper');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(pv(state, 'dom_var_coins')).toBe(1);
    expect(pv(state, MINUS_COIN)).toBe(0);
  });
});

describe('Raid', () => {
  it('a Silver per Silver in play; every opponent redraws 4 at their cleanup', async () => {
    const def = tableWith(['Raid'], { coins: 5 });
    def.setup.push(dealNamed('Silver'), dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuyPhase(engine);
    await playTreasure(engine, 'Silver');
    await playTreasure(engine, 'Silver');
    await buyEvent(engine, 'Raid'); // $5 + $4 - $5
    let state = engine.getState();
    expect(names(state, DISCARD('p0'))).toEqual(['Silver', 'Silver']);
    expect(pv(state, MINUS_CARD, 0)).toBe(0); // the raider is untouched
    expect(pv(state, MINUS_CARD, 1)).toBe(1);
    // The raider's own cleanup redraws the full 5.
    await endTurn(engine);
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(5);
    // The victim's next cleanup redraws 4 and spends the token.
    await toBuyPhase(engine, 'p1');
    await endTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(4);
    expect(pv(state, MINUS_CARD, 1)).toBe(0);
  });
});

describe('Trade', () => {
  it('trashes up to 2 hand cards for a Silver each', async () => {
    const def = tableWith(['Trade'], { coins: 5 });
    const { engine, errors } = probeEngine(def, scripted(pickCards('Copper', 'Copper')));
    await engine.start();
    await toBuyPhase(engine);
    await buyEvent(engine, 'Trade');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Copper', 'Copper']);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver', 'Silver']);
    expect(count(state, HAND('p0'))).toBe(3);
  });
});
