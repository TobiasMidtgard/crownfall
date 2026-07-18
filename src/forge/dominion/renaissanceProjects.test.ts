/**
 * Renaissance Projects — deterministic per-project probes through the REAL
 * engine: the claim flow (buy sets the non-hidden flag, pays the printed
 * cost, refuses a re-claim by the same player, still lets the opponent claim
 * it), one standing-effect probe per shipped project, and the absent-project
 * negatives (an unpicked/unclaimed project does exactly nothing).
 *
 * REGISTRATION NOTE (the Seaside harness pattern): this module is not in
 * expansions.ts yet, and dominionGame.ts reads EXPANSIONS at MODULE-
 * EVALUATION time — so the module is pushed into EXPANSIONS here and
 * buildDominionDef is loaded via dynamic import afterwards. Once the
 * integrator registers renaissanceProjects, freshDef() can become a plain
 * static import.
 *
 * COIN LOGISTICS: cleanup zeroes the turn's coins, so only each player's
 * FIRST turn sees the raised `initial` coins — later-turn purchases are
 * funded through the core Coffers bank (initial coffers + the buy-phase
 * spend action), which persists across turns.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest, EngineHandle, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { renaissanceProjects } from './renaissanceProjects';
import { dealNamed, findNamed, probeEngine } from './testKit';

if (!EXPANSIONS.includes(renaissanceProjects)) EXPANSIONS.push(renaissanceProjects);
/** buildDominionDef AFTER registration (see the header note). */
async function freshDef(): Promise<GameDef> {
  const { buildDominionDef } = await import('../dominionGame');
  return buildDominionDef();
}

/** A def with the named projects on the table and funded probe players. */
async function projectDef(
  names: string[],
  opts: { coins?: number; buys?: number; coffers?: number } = {},
): Promise<GameDef> {
  const forge = await import('../dominionGame');
  const def = forge.pickLandscapes(forge.buildDominionDef(), names);
  if (opts.coins !== undefined) def.variables.find((v) => v.id === 'dom_var_coins')!.initial = opts.coins;
  if (opts.buys !== undefined) def.variables.find((v) => v.id === 'dom_var_buys')!.initial = opts.buys;
  if (opts.coffers !== undefined) def.variables.find((v) => v.id === 'dom_var_coffers')!.initial = opts.coffers;
  return def;
}

const LANDSCAPES = 'dom_zone_landscapes';
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';
const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;

const noChoices = () => { throw new Error('no choice expected'); };

/** Action phase → Buy phase. */
const toBuy = (engine: EngineHandle, pid: string) =>
  engine.performAction(pid, { actionId: 'dom_action_done' });
/** Buy phase → Cleanup → the turn passes (turn-start rules for the NEXT
 *  player fire inside the cleanup call). */
async function endTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}
/** A whole turn in which nothing is played or bought. */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await toBuy(engine, pid);
  await endTurn(engine, pid);
}
/** Claim a project off the sideboard (must already be in the Buy phase). */
async function buyProject(engine: EngineHandle, pid: string, slug: string, name: string): Promise<void> {
  const cardId = findNamed(engine.getState(), LANDSCAPES, name);
  await engine.performAction(pid, { actionId: `dom_action_buy_project_${slug}`, cardId });
}
/** Buy a supply card by name (must already be in the Buy phase). */
async function buyCard(engine: EngineHandle, pid: string, name: string): Promise<void> {
  const cardId = findNamed(engine.getState(), SUPPLY, name);
  await engine.performAction(pid, { actionId: 'dom_action_buy', cardId });
}
/** Cash `n` Coffers into coins (buy phase). */
async function spendCoffers(engine: EngineHandle, pid: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await engine.performAction(pid, { actionId: 'dom_action_spend_coffer' });
  }
}

const fromSupplyToDeck = (name: string, times: number) =>
  Array.from({ length: times }, () => dealNamed(name, 'dom_zone_deck', 'p0'));

describe('renaissanceProjects module registration', () => {
  it('validates with zero errors and warnings; 17 projects in the landscape catalog', async () => {
    const forge = await import('../dominionGame');
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);

    const costs: Record<string, number> = {
      Cathedral: 3, 'City Gate': 3, Pageant: 3, Sewers: 3,
      Exploration: 4, Fair: 4, Silos: 4, 'Sinister Plot': 4,
      Academy: 5, Guildhall: 5, Piazza: 5, 'Road Network': 5,
      Barracks: 6, 'Crop Rotation': 6, Innovation: 6, Canal: 7, Citadel: 8,
    };
    const land = forge.landscapeCatalog(def);
    for (const [name, cost] of Object.entries(costs)) {
      expect(land.find((l) => l.name === name), name).toMatchObject(
        { cost, kind: 'project', expansion: 'Renaissance' },
      );
    }
    // Projects are landscapes, never kingdom picks.
    expect(forge.kingdomCatalog(def).some((c) => costs[c.name] !== undefined)).toBe(false);
    // The documented exclusions really are excluded.
    for (const gone of ['Fleet', 'Star Chart', 'Capitalism']) {
      expect(def.cards.some((c) => c.name === gone), gone).toBe(false);
    }
    // A def with projects on the table stays warning-free too.
    expect(validateGameDef(forge.pickLandscapes(def, ['Fair', 'Citadel']))).toEqual([]);
  });
});

describe('the claim flow (Fair)', () => {
  it('pays and flags; same player refused; the opponent can still claim; +1 Buy fires', async () => {
    const def = await projectDef(['Fair'], { coins: 9, buys: 2 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // Not buyable during the action phase — the buy phase owns the actions.
    await expect(buyProject(engine, 'p0', 'fair', 'Fair')).rejects.toThrow();

    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'fair', 'Fair');
    let state = engine.getState();
    expect(state.players[0].vars['dom_var_proj_fair']).toBe(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(5); // 9 - 4
    expect(state.players[0].vars['dom_var_buys']).toBe(1); // 2 - 1
    // The project never leaves the sideboard.
    expect(names(state, LANDSCAPES)).toContain('Fair');

    // A buy remains, coins remain — the re-claim is refused by the FLAG.
    await expect(buyProject(engine, 'p0', 'fair', 'Fair')).rejects.toThrow();
    await endTurn(engine, 'p0');

    // The opponent claims the very same project on their turn.
    await toBuy(engine, 'p1');
    await buyProject(engine, 'p1', 'fair', 'Fair');
    state = engine.getState();
    expect(state.players[1].vars['dom_var_proj_fair']).toBe(1);
    expect(state.players[1].vars['dom_var_coins']).toBe(5);
    await endTurn(engine, 'p1');

    // T3 (p0): the standing effect — +1 Buy at the turn start.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
  });
});

describe('absent projects', () => {
  it('no sideboard: the buy action has no target and no rule ever fires', async () => {
    const def = await freshDef();
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = 9;
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    await toBuy(engine, 'p0');
    await expect(
      engine.performAction('p0', { actionId: 'dom_action_buy_project_fair' }),
    ).rejects.toThrow();
    await endTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): every project rule stayed silent (noChoices would have thrown
    // on any prompt) and no counter moved.
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.players[0].vars['dom_var_buys']).toBe(1);
    expect(state.players[0].vars['dom_var_coffers']).toBe(0);
    expect(state.players[0].vars['dom_var_villagers']).toBe(0);
    expect(state.players[0].vars['dom_var_proj_fair']).toBe(0);
    expect(count(state, HAND('p0'))).toBe(5);
  });
});

describe('Barracks', () => {
  it('+1 Action at the owner turn start only — the opponent gets nothing', async () => {
    const def = await projectDef(['Barracks'], { coins: 9 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'barracks', 'Barracks');
    await endTurn(engine, 'p0');

    // T2 (p1): no flag — actions stay at 1.
    let state = engine.getState();
    expect(state.players[1].vars['dom_var_actions']).toBe(1);
    await passTurn(engine, 'p1');

    // T3 (p0): the owner musters +1 Action.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2);
    expect(state.players[1].vars['dom_var_actions']).toBe(1);
  });
});

describe('Cathedral', () => {
  it('trashes a hand card at every owner turn start (mandatory)', async () => {
    const def = await projectDef(['Cathedral'], { coins: 9 });
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'card' || !req.prompt.includes('Cathedral')) {
        throw new Error(`unexpected ${req.kind} choice: ${req.prompt}`);
      }
      return req.cardIds[0];
    });
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'cathedral', 'Cathedral');
    await endTurn(engine, 'p0');
    await passTurn(engine, 'p1'); // p1 is never prompted (no flag)

    // T3 (p0): one card gone from the fresh hand into the trash.
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(count(state, HAND('p0'))).toBe(4);
    expect(count(state, TRASH)).toBe(1);
  });
});

describe('City Gate', () => {
  it('+1 Card, then topdecks one', async () => {
    const def = await projectDef(['City Gate'], { coins: 9 });
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'card' || !req.prompt.includes('City Gate')) {
        throw new Error(`unexpected ${req.kind} choice: ${req.prompt}`);
      }
      return req.cardIds[0];
    });
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'city_gate', 'City Gate');
    await endTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): drew to 6 (the empty deck refilled from the discard), then
    // topdecked one — hand 5, deck 5.
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(count(state, HAND('p0'))).toBe(5);
    expect(count(state, DECK('p0'))).toBe(5);
  });
});

describe('Pageant', () => {
  it('at the owner Buy-phase end: pay $1 for +1 Coffers; silent for the other player', async () => {
    const def = await projectDef(['Pageant'], { coins: 9 });
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'yesNo' || !req.prompt.includes('Pageant')) {
        throw new Error(`unexpected ${req.kind} choice: ${req.prompt}`);
      }
      return true;
    });
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'pageant', 'Pageant'); // coins 9 → 6
    // Ending the buy phase enters Cleanup — Pageant asks NOW, before the
    // counters reset.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    let state = engine.getState();
    expect(requests).toHaveLength(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(5); // 6 - 1
    expect(state.players[0].vars['dom_var_coffers']).toBe(1);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });

    // T2 (p1): flagless — no prompt at their buy-phase end.
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(state.players[1].vars['dom_var_coffers']).toBe(0);
  });
});

describe('Exploration', () => {
  it('pays +1 Coffers +1 Villager when no CARD was bought; buying a card spoils it', async () => {
    const def = await projectDef(['Exploration'], { coins: 9 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): buying the PROJECT is not buying a card — the bonus pays out.
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'exploration', 'Exploration'); // $4
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    let state = engine.getState();
    expect(state.players[0].vars['dom_var_coffers']).toBe(1);
    expect(state.players[0].vars['dom_var_villagers']).toBe(1);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    // The per-turn bought flag reset with the cleanup.
    expect(engine.getState().players[0].vars['dom_var_ren_bought_card']).toBe(0);

    await passTurn(engine, 'p1');

    // T3 (p0): buying a Copper (a CARD) spoils the bonus.
    await toBuy(engine, 'p0');
    await buyCard(engine, 'p0', 'Copper'); // $0 — affordable on 0 coins
    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coffers']).toBe(1); // unchanged
    expect(state.players[0].vars['dom_var_villagers']).toBe(1);
  });
});

describe('Academy', () => {
  it('+1 Villager per Action gained — only for the owner', async () => {
    const def = await projectDef(['Academy'], { coins: 9, coffers: 3 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'academy', 'Academy'); // $5
    await endTurn(engine, 'p0');

    // T2 (p1): buys an Action with no Academy — no Villager.
    await toBuy(engine, 'p1');
    await buyCard(engine, 'p1', 'Village');
    await endTurn(engine, 'p1');
    let state = engine.getState();
    expect(state.players[1].vars['dom_var_villagers']).toBe(0);

    // T3 (p0): the owner buys an Action — +1 Villager.
    await toBuy(engine, 'p0');
    await spendCoffers(engine, 'p0', 3);
    await buyCard(engine, 'p0', 'Village');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_villagers']).toBe(1);
  });
});

describe('Guildhall', () => {
  it('+1 Coffers per Treasure gained — only for the owner', async () => {
    const def = await projectDef(['Guildhall'], { coins: 9, coffers: 3 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'guildhall', 'Guildhall'); // $5
    await endTurn(engine, 'p0');

    // T2 (p1): buys a Silver with no Guildhall — coffers stay at the initial 3.
    await toBuy(engine, 'p1');
    await buyCard(engine, 'p1', 'Silver');
    await endTurn(engine, 'p1');
    let state = engine.getState();
    expect(state.players[1].vars['dom_var_coffers']).toBe(3);

    // T3 (p0): spend 3 Coffers for $3, buy a Silver — the Guildhall banks 1.
    await toBuy(engine, 'p0');
    await spendCoffers(engine, 'p0', 3); // coffers 3 → 0, coins 0 → 3
    await buyCard(engine, 'p0', 'Silver');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coffers']).toBe(1); // 0 + 1
  });
});

describe('Road Network', () => {
  it('the owner draws when the OTHER player gains a Victory card; never off their own', async () => {
    const def = await projectDef(['Road Network'], { coins: 9, coffers: 2 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'road_network', 'Road Network'); // $5
    await endTurn(engine, 'p0');

    // T2 (p1): buys an Estate — the OWNER (p0) draws mid-turn.
    await toBuy(engine, 'p1');
    await buyCard(engine, 'p1', 'Estate');
    let state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(6); // 5 + the Road Network draw
    expect(count(state, HAND('p1'))).toBe(5); // p1 drew nothing
    await endTurn(engine, 'p1');

    // T3 (p0): the owner's OWN Victory gain draws nobody anything.
    await toBuy(engine, 'p0');
    await spendCoffers(engine, 'p0', 2);
    await buyCard(engine, 'p0', 'Estate');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // unchanged by the own gain
    expect(count(state, HAND('p1'))).toBe(5);
  });
});

describe('Crop Rotation', () => {
  it('may discard a Victory card at the turn start for +2 Cards', async () => {
    const def = await projectDef(['Crop Rotation'], { coins: 9 });
    // Five Estates land on the deck top → they are the T3 hand.
    def.setup.push(...fromSupplyToDeck('Estate', 5));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards' || !req.prompt.includes('Crop Rotation')) {
        throw new Error(`unexpected ${req.kind} choice: ${req.prompt}`);
      }
      return JSON.stringify([req.cardIds[0]]);
    });
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'crop_rotation', 'Crop Rotation'); // $6
    await endTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): hand was 5 Estates — discard one, draw two.
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(count(state, HAND('p0'))).toBe(6); // 5 - 1 + 2
    expect(names(state, DISCARD('p0'))).toContain('Estate');
  });
});

describe('Silos', () => {
  it('discards any number of Coppers at the turn start and redraws that many', async () => {
    const def = await projectDef(['Silos'], { coins: 9 });
    // Five Coppers land on the deck top → they are the T3 hand.
    def.setup.push(...fromSupplyToDeck('Copper', 5));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards' || !req.prompt.includes('Silos')) {
        throw new Error(`unexpected ${req.kind} choice: ${req.prompt}`);
      }
      return JSON.stringify(req.cardIds); // discard every Copper
    });
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'silos', 'Silos'); // $4
    await endTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): all 5 Coppers discarded, 5 fresh cards drawn.
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.min).toBe(0);
    expect(count(state, HAND('p0'))).toBe(5); // 5 - 5 + 5
    expect(count(state, DISCARD('p0'))).toBe(10); // T1's hand + the 5 Coppers
  });
});

describe('Sinister Plot', () => {
  it('adds a token one turn, cashes all tokens for cards another', async () => {
    const def = await projectDef(['Sinister Plot'], { coins: 9 });
    let plotAnswers = 0;
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option' || !req.prompt.includes('Sinister Plot')) {
        throw new Error(`unexpected ${req.kind} choice: ${req.prompt}`);
      }
      plotAnswers += 1;
      return plotAnswers === 1 ? 'plot_add' : 'plot_cash';
    });
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'sinister_plot', 'Sinister Plot'); // $4
    await endTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): a token is added — no draw.
    let state = engine.getState();
    expect(state.players[0].vars['dom_var_ren_sinister_tokens']).toBe(1);
    expect(count(state, HAND('p0'))).toBe(5);
    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T5 (p0): the plot pays off — +1 Card per token, tokens cleared.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(plotAnswers).toBe(2);
    expect(state.players[0].vars['dom_var_ren_sinister_tokens']).toBe(0);
    expect(count(state, HAND('p0'))).toBe(6); // 5 + 1 cashed token
  });
});

describe('Piazza', () => {
  it('plays a revealed Action off the deck top without spending an Action', async () => {
    const def = await projectDef(['Piazza'], { coins: 9 });
    // Ten Villages on the deck: five become the T3 hand at T1's cleanup, and
    // a Village is guaranteed on top of the deck at the T3 turn start.
    def.setup.push(...fromSupplyToDeck('Village', 10));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'piazza', 'Piazza'); // $5
    await endTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): the top Village is revealed and PLAYED — +1 Card +2 Actions
    // land, no Action was spent.
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, INPLAY('p0'))).toEqual(['Village']);
    expect(state.players[0].vars['dom_var_actions']).toBe(3); // 1 + 2
    expect(count(state, HAND('p0'))).toBe(6); // 5 + the Village's draw
  });

  it('a non-Action reveal stays on the deck (and the empty deck refills first)', async () => {
    const def = await projectDef(['Piazza'], { coins: 9 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'piazza', 'Piazza');
    await endTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): the deck was empty, refilled from the discard; the starter
    // deck holds only Coppers/Estates, so nothing is played.
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(count(state, DECK('p0'))).toBe(5); // the refilled discard
    expect(count(state, HAND('p0'))).toBe(5);
    expect(state.log.some((l) => l.text.includes('not an Action'))).toBe(true);
  });
});

describe('Innovation', () => {
  it('offers to play the FIRST Action gained on your turn; the second gain is silent', async () => {
    const def = await projectDef(['Innovation'], { coins: 12, buys: 3 });
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'yesNo' || !req.prompt.includes('Innovation')) {
        throw new Error(`unexpected ${req.kind} choice: ${req.prompt}`);
      }
      return true;
    });
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'innovation', 'Innovation'); // $6, coins 12 → 6

    // First Action buy: the offer fires and the Village plays immediately —
    // +1 Card +2 Actions, straight out of the discard.
    await buyCard(engine, 'p0', 'Village'); // coins 6 → 3
    let state = engine.getState();
    expect(requests).toHaveLength(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Village']);
    expect(count(state, HAND('p0'))).toBe(6); // 5 + the Village's draw
    expect(state.players[0].vars['dom_var_actions']).toBe(3); // 1 + 2
    expect(state.players[0].vars['dom_var_ren_innovation_used']).toBe(1);

    // Second Action buy the same turn: no offer — the card stays put.
    await buyCard(engine, 'p0', 'Village'); // coins 3 → 0
    state = engine.getState();
    expect(requests).toHaveLength(1);
    expect(names(state, DISCARD('p0'))).toContain('Village');
    await endTurn(engine, 'p0');

    // The once-per-turn chance resets with the cleanup.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_ren_innovation_used']).toBe(0);
  });
});

describe('Citadel', () => {
  it('the first Action played this turn plays twice', async () => {
    const def = await projectDef(['Citadel'], { coins: 9 });
    // A Smithy + 4 Coppers become the T3 hand.
    def.setup.push(
      dealNamed('Smithy', 'dom_zone_deck', 'p0'),
      ...fromSupplyToDeck('Copper', 4),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'citadel', 'Citadel'); // $8
    await endTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): play the Smithy — Citadel echoes it: +3 Cards, twice.
    let state = engine.getState();
    expect(names(state, HAND('p0'))).toContain('Smithy');
    await engine.performAction('p0', {
      actionId: 'dom_action_play', cardId: findNamed(state, HAND('p0'), 'Smithy'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes('Citadel echoes'))).toBe(true);
    expect(count(state, HAND('p0'))).toBe(10); // 5 - Smithy + 3 + 3
    expect(state.players[0].vars['dom_var_actions']).toBe(0); // one play, one Action
    expect(names(state, INPLAY('p0'))).toEqual(['Smithy']);
    expect(state.players[0].vars['dom_var_ren_citadel_used']).toBe(1);
  });
});

describe('Sewers (with Cathedral)', () => {
  it("Cathedral's trash triggers ONE optional Sewers trash — no self-chain", async () => {
    const def = await projectDef(['Cathedral', 'Sewers'], { coins: 9, buys: 2 });
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind === 'card' && req.prompt.includes('Cathedral')) return req.cardIds[0];
      if (req.kind === 'cards' && req.prompt.includes('Sewers')) {
        return JSON.stringify([req.cardIds[0]]);
      }
      throw new Error(`unexpected ${req.kind} choice: ${req.prompt}`);
    });
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'cathedral', 'Cathedral'); // $3
    await buyProject(engine, 'p0', 'sewers', 'Sewers'); // $3
    await endTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): Cathedral trashes one; the Sewers rides along ONCE — its own
    // trash wears the mark and must not re-open the offer.
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(2);
    expect(count(state, TRASH)).toBe(2);
    expect(count(state, HAND('p0'))).toBe(3); // 5 - Cathedral's - Sewers'
  });
});

describe('Canal', () => {
  it('discounts the owner turns by $1 and fades at cleanup', async () => {
    const def = await projectDef(['Canal'], { coins: 9, coffers: 3 });
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toBuy(engine, 'p0');
    await buyProject(engine, 'p0', 'canal', 'Canal'); // $7 — never self-discounted
    expect(engine.getState().players[0].vars['dom_var_coins']).toBe(2);
    await endTurn(engine, 'p0');

    // T2 (p1): the flagless player's turn carries no discount.
    expect(engine.getState().globalVars['dom_var_cost_discount']).toBe(0);
    await passTurn(engine, 'p1');

    // T3 (p0): the Canal raised the discount at the turn start — a $3
    // Village costs $2.
    let state = engine.getState();
    expect(state.globalVars['dom_var_cost_discount']).toBe(1);
    await toBuy(engine, 'p0');
    await spendCoffers(engine, 'p0', 3); // coins 0 → 3
    await buyCard(engine, 'p0', 'Village');
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(1); // 3 - (3 - 1)
    await endTurn(engine, 'p0');

    // The discount died with the turn.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.globalVars['dom_var_cost_discount']).toBe(0);
  });
});
