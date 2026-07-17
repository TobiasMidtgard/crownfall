/**
 * Empires Landmarks — engine probes for all 21 Landmarks through the REAL
 * engine: the scoring Landmarks are exercised by dealing a deck shape and
 * letting the turn-end recount judge it; the in-game awards (Aqueduct,
 * Arena, Basilica, Battlefield, Colonnade, Defiled Shrine, Labyrinth,
 * Mountain Pass, Tomb, Baths) are driven through real buys / plays /
 * cleanups and read off the VP_TOKENS bank. Absent-landscape negative
 * checks: Tomb's trash and Baths' quiet turn award nothing when the
 * Landmark is not on the table.
 *
 * REGISTRATION NOTE: the module is pushed into EXPANSIONS before
 * dominionGame is dynamically imported (the seaside harness pattern) —
 * dominionGame reads EXPANSIONS at module-evaluation time.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChoiceRequest, EngineHandle, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import {
  AQUEDUCT_GOLD, AQUEDUCT_POOL, AQUEDUCT_SILVER, ARENA_POOL, LABYRINTH_POOL, OBELISK_NAME,
  PASS_DONE, SHRINE_FEED, SHRINE_POOL, empiresLandmarks,
} from './empiresLandmarks';
import { dealNamed, findNamed, probeEngine } from './testKit';

if (!EXPANSIONS.includes(empiresLandmarks)) EXPANSIONS.push(empiresLandmarks);

type Forge = typeof import('../dominionGame');
let forge: Forge;
beforeAll(async () => {
  /** Import AFTER registration (see the header note). */
  forge = await import('../dominionGame');
});

const SUPPLY = 'dom_zone_supply';
const LANDS = 'dom_zone_landscapes';
const HAND = (p: string) => `dom_zone_hand:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;

const ALL_LANDMARKS = [
  'Aqueduct', 'Arena', 'Bandit Fort', 'Basilica', 'Baths', 'Battlefield', 'Colonnade',
  'Defiled Shrine', 'Fountain', 'Keep', 'Labyrinth', 'Mountain Pass', 'Museum', 'Obelisk',
  'Orchard', 'Palace', 'Tomb', 'Tower', 'Triumphal Arch', 'Wall', 'Wolf Den',
];

const noChoices = () => { throw new Error('no choice expected'); };

/** A fresh def with the given landmarks on the table (First Game kingdom). */
function landDef(names: string[]): GameDef {
  return forge.pickLandscapes(forge.buildDominionDef(), names);
}
const setCoins = (def: GameDef, n: number) => {
  def.variables.find((v) => v.id === 'dom_var_coins')!.initial = n;
};
const setBuys = (def: GameDef, n: number) => {
  def.variables.find((v) => v.id === 'dom_var_buys')!.initial = n;
};
const vp = (state: GameState, i: number) => state.players[i].vars['dom_var_vp'];
const tokens = (state: GameState, i: number) => state.players[i].vars['dom_var_vp_tokens'];

/** Action → Buy → Cleanup → the turn passes (nothing gets played). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}
/** End the (already entered) buy phase and clean up. */
async function endTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}
async function buy(engine: EngineHandle, pid: string, name: string): Promise<void> {
  const id = findNamed(engine.getState(), SUPPLY, name);
  await engine.performAction(pid, { actionId: 'dom_action_buy', cardId: id });
}

describe('empiresLandmarks module registration', () => {
  it('validates clean, with and without the landmarks on the table', () => {
    const def = forge.buildDominionDef();
    expect(validateGameDef(def)).toEqual([]);
    expect(validateGameDef(forge.pickLandscapes(def, ALL_LANDMARKS))).toEqual([]);
  });

  it('all 21 Landmarks live in the landscape catalog, never the kingdom catalog', () => {
    const def = forge.buildDominionDef();
    const land = forge.landscapeCatalog(def);
    for (const name of ALL_LANDMARKS) {
      expect(land.find((l) => l.name === name), `${name} in the catalog`).toMatchObject(
        { cost: 0, kind: 'landmark', expansion: 'Empires' },
      );
    }
    const kingdom = forge.kingdomCatalog(def);
    expect(kingdom.some((c) => ALL_LANDMARKS.includes(c.name))).toBe(false);
    expect(def.cards.find((c) => c.name === 'Wolf Den')!.typeId).toBe('dom_type_landmark');
  });

  it('all 21 ship together on one table and a quiet turn recounts sanely', async () => {
    const def = landDef(ALL_LANDMARKS);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    expect(engine.getState().zones[LANDS].cardIds).toHaveLength(21);
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    // p0: 3 Estates + Baths' 2 chips (no gains) + Museum 2x2 distinct names
    // (Copper, Estate) + Keep's tied Copper split (+5). Everything else is 0.
    expect(vp(state, 0)).toBe(14);
    // p1: same deck, no Baths chips yet.
    expect(vp(state, 1)).toBe(12);
  });
});

describe('Aqueduct', () => {
  it('a gained Silver feeds it; a gained Victory card takes the VP', async () => {
    const def = landDef(['Aqueduct']);
    setCoins(def, 5);
    setBuys(def, 2);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await buy(engine, 'p0', 'Silver');
    let state = engine.getState();
    expect(state.globalVars[AQUEDUCT_SILVER]).toBe(7);
    expect(state.globalVars[AQUEDUCT_POOL]).toBe(1);
    expect(tokens(state, 0)).toBe(0);
    await buy(engine, 'p0', 'Estate');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.globalVars[AQUEDUCT_POOL]).toBe(0);
    expect(state.globalVars[AQUEDUCT_GOLD]).toBe(8);
    expect(tokens(state, 0)).toBe(1);
    await endTurn(engine, 'p0');
    state = engine.getState();
    // 3 starter Estates + the bought Estate + the 1 banked chip.
    expect(vp(state, 0)).toBe(5);
  });
});

describe('Arena', () => {
  it('offers an Action discard at the buy phase start and pays 2 VP', async () => {
    const def = landDef(['Arena']);
    def.setup.push(dealNamed('Village'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const village = req.cardIds.find((id) => state.cards[id].name === 'Village')!;
      return JSON.stringify([village]);
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.min).toBe(0);
    expect(req.max).toBe(1);
    expect(tokens(state, 0)).toBe(2);
    expect(state.globalVars[ARENA_POOL]).toBe(2);
    expect(state.zones[DISCARD('p0')].cardIds.map((id) => state.cards[id].name)).toContain('Village');
  });
});

describe('Bandit Fort', () => {
  it('-2 VP per owned Silver and Gold at the recount', async () => {
    const def = landDef(['Bandit Fort']);
    def.setup.push(dealNamed('Silver'), dealNamed('Gold'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(vp(state, 0)).toBe(-1); // 3 Estates - 2 - 2
    expect(vp(state, 1)).toBe(3); // untouched deck
  });
});

describe('Basilica', () => {
  it('pays 2 VP on a gain that leaves $2 or more', async () => {
    const def = landDef(['Basilica']);
    setCoins(def, 5);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await buy(engine, 'p0', 'Silver'); // $5 - $3 = $2 left
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(tokens(state, 0)).toBe(2);
  });

  it('pays nothing when less than $2 remains', async () => {
    const def = landDef(['Basilica']);
    setCoins(def, 4);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await buy(engine, 'p0', 'Silver'); // $4 - $3 = $1 left
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(tokens(state, 0)).toBe(0);
  });
});

describe('Baths', () => {
  it('pays 2 VP at cleanup after a turn without gains — and the chips score', async () => {
    const def = landDef(['Baths']);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(tokens(state, 0)).toBe(2);
    expect(vp(state, 0)).toBe(5); // 3 Estates + the 2 chips
  });

  it('pays nothing after a turn with a gain', async () => {
    const def = landDef(['Baths']);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await buy(engine, 'p0', 'Copper');
    await endTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(tokens(state, 0)).toBe(0);
  });

  it('absent from the table, a quiet turn awards nothing (negative check)', async () => {
    const def = forge.buildDominionDef();
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(tokens(state, 0)).toBe(0);
    expect(vp(state, 0)).toBe(3);
  });
});

describe('Battlefield', () => {
  it('pays 2 VP when a Victory card is gained', async () => {
    const def = landDef(['Battlefield']);
    setCoins(def, 2);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await buy(engine, 'p0', 'Estate');
    let state = engine.getState();
    expect(errors).toEqual([]);
    expect(tokens(state, 0)).toBe(2);
    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(vp(state, 0)).toBe(6); // 4 Estates + 2 chips
  });
});

describe('Colonnade', () => {
  it('pays 2 VP for buying an Action with a copy of it in play', async () => {
    const def = landDef(['Colonnade']);
    def.setup.push(dealNamed('Village'));
    setCoins(def, 3);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_play', cardId: findNamed(state, HAND('p0'), 'Village'),
    });
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await buy(engine, 'p0', 'Village');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(tokens(state, 0)).toBe(2);
  });

  it('pays nothing without a copy in play', async () => {
    const def = landDef(['Colonnade']);
    setCoins(def, 3);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await buy(engine, 'p0', 'Village');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(tokens(state, 0)).toBe(0);
  });
});

describe('Defiled Shrine', () => {
  it('a gained Action feeds it; buying a Curse takes the VP', async () => {
    const def = landDef(['Defiled Shrine']);
    setCoins(def, 3);
    setBuys(def, 2);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await buy(engine, 'p0', 'Village');
    let state = engine.getState();
    expect(state.globalVars[SHRINE_FEED]).toBe(1);
    expect(state.globalVars[SHRINE_POOL]).toBe(1);
    expect(tokens(state, 0)).toBe(0);
    await buy(engine, 'p0', 'Curse');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.globalVars[SHRINE_POOL]).toBe(0);
    expect(tokens(state, 0)).toBe(1);
    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(vp(state, 0)).toBe(3); // 3 Estates - 1 Curse + 1 chip
  });
});

describe('Fountain', () => {
  it('a flat 15 VP with ten or more Coppers', async () => {
    const def = landDef(['Fountain']);
    def.setup.push(dealNamed('Copper'), dealNamed('Copper'), dealNamed('Copper'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(vp(state, 0)).toBe(18); // 3 Estates + 15 (10 Coppers)
    expect(vp(state, 1)).toBe(3); // 7 Coppers — no bonus
  });
});

describe('Keep', () => {
  it('5 VP per differently named Treasure held most-or-tied', async () => {
    const def = landDef(['Keep']);
    def.setup.push(dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    // p0: Coppers tied 7v7 (+5) and the lone Silver 1v0 (+5).
    expect(vp(state, 0)).toBe(13);
    // p1: the Copper tie only.
    expect(vp(state, 1)).toBe(8);
  });
});

describe('Labyrinth', () => {
  it('pays 2 VP on exactly the 2nd gain of the turn', async () => {
    const def = landDef(['Labyrinth']);
    setBuys(def, 3);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await buy(engine, 'p0', 'Copper');
    expect(tokens(engine.getState(), 0)).toBe(0);
    await buy(engine, 'p0', 'Copper');
    let state = engine.getState();
    expect(tokens(state, 0)).toBe(2);
    expect(state.globalVars[LABYRINTH_POOL]).toBe(2);
    await buy(engine, 'p0', 'Copper'); // the 3rd gain pays nothing
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(tokens(state, 0)).toBe(2);
  });
});

describe('Mountain Pass', () => {
  it('offers the first Province gainer 8 Debt for 8 VP, once per game', async () => {
    const def = landDef(['Mountain Pass']);
    setCoins(def, 8);
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return true;
    });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await buy(engine, 'p0', 'Province');
    let state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(tokens(state, 0)).toBe(8);
    expect(state.players[0].vars['dom_var_debt']).toBe(8);
    expect(state.globalVars[PASS_DONE]).toBe(1);
    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(vp(state, 0)).toBe(17); // 3 Estates + 6 Province + 8 chips

    // p1 buys the SECOND Province (their initial $8 was never spent) — the
    // Pass stays crossed, no second offer.
    await engine.performAction('p1', { actionId: 'dom_action_done' });
    await buy(engine, 'p1', 'Province');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(tokens(state, 1)).toBe(0);
  });
});

describe('Museum', () => {
  it('2 VP per differently named owned card', async () => {
    const def = landDef(['Museum']);
    def.setup.push(dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(vp(state, 0)).toBe(9); // 3 Estates + 2x3 (Copper, Estate, Silver)
    expect(vp(state, 1)).toBe(7); // 3 + 2x2
  });
});

describe('Obelisk', () => {
  it('locks the costliest Action pile at the first recount and pays 2 per copy', async () => {
    const def = landDef(['Obelisk']);
    // One copy of EVERY 5-cost First Game Action — +2 whichever pile locks.
    def.setup.push(dealNamed('Market'), dealNamed('Mine'), dealNamed('Festival'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(['Market', 'Mine', 'Festival']).toContain(state.globalVars[OBELISK_NAME]);
    expect(vp(state, 0)).toBe(5); // 3 Estates + 2
    expect(vp(state, 1)).toBe(3);
  });
});

describe('Orchard', () => {
  it('4 VP per differently named Action owned three or more times', async () => {
    const def = landDef(['Orchard']);
    def.setup.push(dealNamed('Village'), dealNamed('Village'), dealNamed('Village'), dealNamed('Smithy'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(vp(state, 0)).toBe(7); // 3 Estates + 4 (3 Villages; the lone Smithy pays nothing)
  });
});

describe('Palace', () => {
  it('3 VP per full Copper-Silver-Gold set', async () => {
    const def = landDef(['Palace']);
    def.setup.push(dealNamed('Silver'), dealNamed('Silver'), dealNamed('Gold'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(vp(state, 0)).toBe(6); // 3 Estates + 3x min(7, 2, 1)
    expect(vp(state, 1)).toBe(3); // no Silver/Gold — no set
  });
});

describe('Tomb', () => {
  const remodelAnswers = (req: ChoiceRequest, state: GameState) => {
    if (req.kind === 'card') {
      // Trash an Estate when one is in hand, else whatever comes first.
      return req.cardIds.find((id) => state.cards[id].name === 'Estate') ?? req.cardIds[0];
    }
    if (req.kind === 'pile') return req.cardIds[0];
    throw new Error(`unexpected ${req.kind} choice`);
  };

  it('banks 1 VP when a card is trashed', async () => {
    const def = landDef(['Tomb']);
    def.setup.push(dealNamed('Remodel'));
    const { engine, errors } = probeEngine(def, remodelAnswers);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_play', cardId: findNamed(state0, HAND('p0'), 'Remodel'),
    });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(tokens(state, 0)).toBe(1);
  });

  it('absent from the table, the same trash banks nothing (negative check)', async () => {
    const def = forge.buildDominionDef();
    def.setup.push(dealNamed('Remodel'));
    const { engine, errors } = probeEngine(def, remodelAnswers);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_play', cardId: findNamed(state0, HAND('p0'), 'Remodel'),
    });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(tokens(state, 0)).toBe(0);
  });
});

describe('Tower', () => {
  it('1 VP per owned non-Victory card from an empty supply pile', async () => {
    const def = landDef(['Tower']);
    // Shrink the Village pile to 2 and take both — the pile sits empty.
    const villageId = def.cards.find((c) => c.name === 'Village')!.id;
    const kingdomDeck = def.decks.find((d) => d.id === 'dom_deck_kingdom')!;
    if (kingdomDeck.source.kind !== 'custom') throw new Error('unexpected deck source');
    kingdomDeck.source.entries.find((e) => e.cardId === villageId)!.count = 2;
    def.setup.push(dealNamed('Village'), dealNamed('Village'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    expect(engine.getState().zones[SUPPLY].cardIds
      .filter((id) => engine.getState().cards[id].name === 'Village')).toHaveLength(0);
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(vp(state, 0)).toBe(5); // 3 Estates + 2 Villages off the empty pile
    expect(vp(state, 1)).toBe(3);
  });
});

describe('Triumphal Arch', () => {
  it('3 VP per copy of the 2nd most common Action', async () => {
    const def = landDef(['Triumphal Arch']);
    def.setup.push(dealNamed('Village'), dealNamed('Village'), dealNamed('Smithy'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(vp(state, 0)).toBe(6); // 3 Estates + 3x1 (Smithy behind 2 Villages)
    expect(vp(state, 1)).toBe(3); // no Actions at all
  });

  it('a tie for most counts as the 2nd most (the printed tie rule)', async () => {
    const def = landDef(['Triumphal Arch']);
    def.setup.push(dealNamed('Village'), dealNamed('Village'), dealNamed('Smithy'), dealNamed('Smithy'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(vp(state, 0)).toBe(9); // 3 Estates + 3x2 (2-2 tie at the top)
  });
});

describe('Wall', () => {
  it('-1 VP per card beyond the 15th', async () => {
    const def = landDef(['Wall']);
    def.setup.push(...Array.from({ length: 7 }, () => dealNamed('Copper')));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(vp(state, 0)).toBe(1); // 3 Estates - 2 (17 cards)
    expect(vp(state, 1)).toBe(3); // 10 cards — no penalty
  });
});

describe('Wolf Den', () => {
  it('-3 VP per card owned in exactly one copy', async () => {
    const def = landDef(['Wolf Den']);
    def.setup.push(dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(vp(state, 0)).toBe(0); // 3 Estates - 3 (the lone Silver)
    expect(vp(state, 1)).toBe(3); // 7 Coppers / 3 Estates — no singletons
  });
});
