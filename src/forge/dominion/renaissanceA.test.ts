/**
 * Renaissance (part A) — deterministic per-card probes through the REAL
 * engine: the artifact vars (Flag / Horn / Lantern pass-around), the Cargo
 * Ship duration + set-aside flow, Experiment's return-and-chain, Improve's
 * cleanup window, and the Priest trash-bonus timing.
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards. Once the integrator registers renaissanceA, freshDef() can
 * become a plain static `buildDominionDef` import.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceAnswer, ChoiceRequest, EngineHandle, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import {
  ARTIFACT_CHEST, ARTIFACT_FLAG, ARTIFACT_HORN, ARTIFACT_KEY, ARTIFACT_LANTERN,
  CARGO_WATCH, PRIEST_BONUS, renaissanceA,
} from './renaissanceA';
import { HAVEN_MARK } from './seaside2eA';
import { dealNamed, findNamed, probeEngine } from './testKit';

if (!EXPANSIONS.includes(renaissanceA)) EXPANSIONS.push(renaissanceA);
/** buildDominionDef + kingdom helpers AFTER registration (header note). */
async function dominion(): Promise<typeof import('../dominionGame')> {
  return import('../dominionGame');
}
async function freshDef(): Promise<GameDef> {
  return (await dominion()).buildDominionDef();
}

const SUPPLY = 'dom_zone_supply';
const RESERVE = 'dom_zone_reserve';
const TRASH = 'dom_zone_trash';
const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const DURATION = (p: string) => `dom_zone_duration:${p}`;

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;
const countNamed = (state: GameState, zoneKey: string, name: string): number =>
  names(state, zoneKey).filter((n) => n === name).length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, RESERVE);

/**
 * Give `pid` an artifact at setup. A SETUP BLOCK, not a `.initial` edit: the
 * def shares the module's VariableDef objects, so mutating `initial` on one
 * test's def would leak into every later freshDef() in this worker.
 */
const holdArtifact = (varId: string, pid: string): GameDef['setup'][number] =>
  ({ kind: 'setVar', varId, target: null, value: { kind: 'str', value: pid } });

const play = { actionId: 'dom_action_play' };
const noChoices = () => { throw new Error('no choices expected'); };

/** Action → Buy → Cleanup → the turn passes (nothing gets played). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

type Handler = (req: ChoiceRequest, state: GameState) => ChoiceAnswer | undefined;
/** Route each request to the first handler that answers it; throw otherwise. */
const dispatch = (...handlers: Handler[]) =>
  (req: ChoiceRequest, state: GameState): ChoiceAnswer => {
    for (const h of handlers) {
      const a = h(req, state);
      if (a !== undefined) return a;
    }
    throw new Error(`unhandled ${req.kind} choice: "${req.prompt}"`);
  };
const onPrompt = (
  prefix: string, fn: (req: ChoiceRequest, state: GameState) => ChoiceAnswer,
): Handler => (req, state) => (req.prompt.startsWith(prefix) ? fn(req, state) : undefined);
/** First offered card id with the given name (throws when absent). */
const offered = (req: ChoiceRequest, state: GameState, name: string): string => {
  const ids = 'cardIds' in req ? req.cardIds : [];
  const id = ids.find((cid) => state.cards[cid].name === name);
  if (id === undefined) throw new Error(`no "${name}" offered for "${req.prompt}"`);
  return id;
};

/** The module's ten cheapest piles — a legal pickKingdom set for buy probes. */
const TEN_A = [
  'Border Guard', 'Ducat', 'Lackeys', 'Acting Troupe', 'Cargo Ship',
  'Experiment', 'Improve', 'Flag Bearer', 'Hideout', 'Inventor',
];

describe('renaissanceA module registration', () => {
  it('validates clean and knows all thirteen cards, types and artifact vars', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      'Border Guard': 2, Ducat: 2, Lackeys: 2,
      'Acting Troupe': 3, 'Cargo Ship': 3, Experiment: 3, Improve: 3,
      'Flag Bearer': 4, Hideout: 4, Inventor: 4, 'Mountain Village': 4, Patron: 4, Priest: 4,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
      // No Attacks in this half of the set.
      expect(card!.tags).not.toContain('dom_tag_attack');
      expect(card!.abilities.every((a) => a.stacked !== true)).toBe(true);
    }
    // Ducat is treasure-TYPED (played by the treasure action); Patron wears
    // the printed Reaction tag (its reveal rider is dropped — module header).
    const byName = (n: string) => def.cards.find((c) => c.name === n)!;
    expect(byName('Ducat').typeId).toBe('dom_type_treasure');
    expect(byName('Patron').typeId).toBe('dom_type_action');
    expect(byName('Patron').tags).toContain('dom_tag_reaction');
    expect(byName('Border Guard').typeId).toBe('dom_type_action');
    // The Cargo Ship duration pair.
    expect(byName('Cargo Ship').abilities.map((a) => a.id).sort()).toEqual(
      ['dom_ab_cargo_ship_later', 'dom_ab_cargo_ship_now'],
    );
    // ALL FIVE artifact vars are declared here (renaissanceB only reads/writes).
    const varIds = def.variables.map((v) => v.id);
    for (const vid of [ARTIFACT_FLAG, ARTIFACT_HORN, ARTIFACT_LANTERN, ARTIFACT_KEY, ARTIFACT_CHEST]) {
      expect(varIds, `${vid} declared`).toContain(vid);
    }
  });
});

describe('Border Guard', () => {
  it('+1 Action; reveals 2, one to hand, the other discarded — no artifact for non-Actions', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Border Guard'),
      dealNamed('Silver', 'dom_zone_deck', 'p0'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'), // dealt last — top of deck
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      return dispatch(
        onPrompt('Border Guard: put one', (r, s) => JSON.stringify([offered(r, s, 'Estate')])),
      )(req, state);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Border Guard') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1); // the pick only — never the artifact option
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, HAND('p0'))).toContain('Estate');
    expect(count(state, HAND('p0'))).toBe(6); // 5 + BG - played + Estate
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
  });

  it('a double-Action reveal awards the Lantern or Horn (the artifact var)', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Border Guard'),
      dealNamed('Village', 'dom_zone_deck', 'p0'),
      dealNamed('Village', 'dom_zone_deck', 'p0'),
    );
    const { engine, errors } = probeEngine(def, dispatch(
      onPrompt('Border Guard: put one', (r) => JSON.stringify(('cardIds' in r ? r.cardIds : []).slice(0, 1))),
      onPrompt('Border Guard: take an Artifact', () => 'bg_horn'),
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Border Guard') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.globalVars[ARTIFACT_HORN]).toBe('p0');
    expect(state.globalVars[ARTIFACT_LANTERN]).toBe('');
    expect(names(state, HAND('p0'))).toContain('Village');
  });

  it('the Lantern makes it reveal 3 — and a mixed reveal takes nothing', async () => {
    const def = await freshDef();
    def.setup.push(
      holdArtifact(ARTIFACT_LANTERN, 'p0'),
      fromReserve('Border Guard'),
      dealNamed('Village', 'dom_zone_deck', 'p0'),
      dealNamed('Village', 'dom_zone_deck', 'p0'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      return dispatch(
        onPrompt('Border Guard: put one', (r, s) => JSON.stringify([offered(r, s, 'Estate')])),
      )(req, state);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Border Guard') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    const pick = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(pick.cardIds).toHaveLength(3); // Lantern: 3 revealed, not 2
    expect(names(state, HAND('p0'))).toContain('Estate');
    expect(countNamed(state, DISCARD('p0'), 'Village')).toBe(2);
    // Two of three were Actions — no artifact changes hands.
    expect(state.globalVars[ARTIFACT_HORN]).toBe('');
  });

  it('the Horn topdecks a Border Guard discarded from play at cleanup (once)', async () => {
    const def = await freshDef();
    def.setup.push(
      holdArtifact(ARTIFACT_HORN, 'p0'),
      fromReserve('Border Guard'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
    );
    const { engine, errors } = probeEngine(def, dispatch(
      onPrompt('Border Guard: put one', (r) => JSON.stringify(('cardIds' in r ? r.cardIds : []).slice(0, 1))),
      onPrompt('Horn:', () => true),
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Border Guard') });
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    // Drained after the redraw (module header): the Guard tops the NEXT deck.
    expect(names(state, DECK('p0'))).toEqual(['Border Guard']);
    expect(names(state, DISCARD('p0'))).not.toContain('Border Guard');
  });
});

describe('Ducat', () => {
  it('plays as a Treasure: +1 Coffers and +1 Buy, no coins', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Ducat'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Ducat'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coffers']).toBe(1);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(names(state, INPLAY('p0'))).toEqual(['Ducat']);
  });

  it('on buy, offers to trash a Copper from hand', async () => {
    const dg = await dominion();
    const def = dg.pickKingdom(await freshDef(), TEN_A);
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = 5;
    def.setup.push(dealNamed('Copper')); // guarantee a Copper in hand
    const { engine, errors } = probeEngine(def, dispatch(
      onPrompt('Ducat: you may trash a Copper', (r, s) => JSON.stringify([offered(r, s, 'Copper')])),
    ));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Ducat'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(names(state, DISCARD('p0'))).toContain('Ducat');
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
  });
});

describe('Lackeys', () => {
  it('+2 Cards on play — the Villagers come only from the gain', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Lackeys'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Lackeys') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 5 + Lackeys - played + 2
    expect(state.players[0].vars['dom_var_villagers']).toBe(0);
  });

  it('+2 Villagers to the gainer on buy', async () => {
    const dg = await dominion();
    const def = dg.pickKingdom(await freshDef(), TEN_A);
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = 5;
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    const state0 = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state0, SUPPLY, 'Lackeys'),
    });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_villagers']).toBe(2);
    expect(state.players[1].vars['dom_var_villagers']).toBe(0);
  });
});

describe('Acting Troupe', () => {
  it('+4 Villagers, then trashes itself', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Acting Troupe'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Acting Troupe') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_villagers']).toBe(4);
    expect(names(state, TRASH)).toEqual(['Acting Troupe']);
    expect(count(state, INPLAY('p0'))).toBe(0);
  });
});

describe('Cargo Ship', () => {
  it('+$2 now; a bought card parks marked, and lands in hand next turn', async () => {
    const def = await freshDef();
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = 1;
    def.setup.push(fromReserve('Cargo Ship'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      return dispatch(onPrompt('Cargo Ship: set the gained card aside', () => true))(req, state);
    });
    await engine.start();

    // T1 (p0): +$2 (1 + 2 = 3 buys a Silver), the ship parks at once.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Cargo Ship') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(state.players[0].vars[CARGO_WATCH]).toBe(1);
    expect(names(state, DURATION('p0'))).toEqual(['Cargo Ship']);
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Silver'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1); // the one yes/no
    expect([...names(state, DURATION('p0'))].sort()).toEqual(['Cargo Ship', 'Silver']);
    expect(names(state, DISCARD('p0'))).not.toContain('Silver');
    const silverId = findNamed(state, DURATION('p0'), 'Silver');
    expect(state.cards[silverId].vars[HAVEN_MARK]).toBe(1);

    // Cleanup spares both; the watch resets with the turn.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect([...names(state, DURATION('p0'))].sort()).toEqual(['Cargo Ship', 'Silver']);
    expect(state.players[0].vars[CARGO_WATCH]).toBe(0);
    await passTurn(engine, 'p1');

    // T3 (p0): the single marked card auto-returns to hand, the ship marches
    // back to In Play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1); // no extra prompt for the lone candidate
    expect(state.log.some((l) => l.text.includes('Cargo Ship resolves'))).toBe(true);
    expect(names(state, HAND('p0'))).toContain('Silver');
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + the Silver
    expect(state.cards[silverId].vars[HAVEN_MARK]).toBe(0);
    expect(names(state, INPLAY('p0'))).toEqual(['Cargo Ship']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Experiment', () => {
  it('+2 Cards +1 Action, then returns to its pile', async () => {
    const dg = await dominion();
    const def = dg.pickKingdom(await freshDef(), TEN_A);
    def.setup.push(dealNamed('Experiment')); // off the live pile: 10 → 9
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    expect(countNamed(state, SUPPLY, 'Experiment')).toBe(9);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Experiment') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 5 + Experiment - played + 2
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(countNamed(state, SUPPLY, 'Experiment')).toBe(10); // back on the pile
  });

  it('buying one gains a second (and the chain stops there)', async () => {
    const dg = await dominion();
    const def = dg.pickKingdom(await freshDef(), TEN_A);
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = 5;
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    const state0 = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state0, SUPPLY, 'Experiment'),
    });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(countNamed(state, DISCARD('p0'), 'Experiment')).toBe(2);
    expect(countNamed(state, SUPPLY, 'Experiment')).toBe(8);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
  });
});

describe('Improve', () => {
  it('+$2 on play; at cleanup-start trades an Action in play for one costing exactly $1 more', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Improve'), dealNamed('Village'));
    let gained = '';
    const { engine, errors } = probeEngine(def, dispatch(
      onPrompt('Improve: you may trash an Action', (r, s) => JSON.stringify([offered(r, s, 'Village')])),
      onPrompt('Improve: gain a card costing exactly', (r, s) => {
        const ids = 'cardIds' in r ? r.cardIds : [];
        const four = ids.find((cid) => s.cards[cid].fields['dom_field_cost'] === 4)!;
        expect(four).toBeDefined();
        gained = s.cards[four].name;
        return four;
      }),
    ));
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Improve') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' }); // cleanup starts: the window
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Village']);
    expect(gained).not.toBe('');
    expect(names(state, DISCARD('p0'))).toContain(gained);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    expect(errors).toEqual([]);
  });
});

describe('Flag Bearer', () => {
  it('buying it takes the Flag, and the Flag holder redraws 6 at cleanup', async () => {
    const dg = await dominion();
    const def = dg.pickKingdom(await freshDef(), TEN_A);
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = 5;
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Flag Bearer'),
    });
    state = engine.getState();
    expect(state.globalVars[ARTIFACT_FLAG]).toBe('p0');
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // the Flag: 5 + 1
    // The opponent flies no Flag — a plain 5-card redraw.
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(5);
  });

  it('trashing it also takes the Flag', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Chapel'), fromReserve('Flag Bearer'));
    const { engine, errors } = probeEngine(def, dispatch(
      onPrompt('Chapel: choose up to 4', (r, s) => JSON.stringify([offered(r, s, 'Flag Bearer')])),
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Chapel') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Flag Bearer']);
    expect(state.globalVars[ARTIFACT_FLAG]).toBe('p0');
  });
});

describe('Hideout', () => {
  it('+1 Card +2 Actions; trashing a Victory card gains a Curse', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Hideout'), dealNamed('Estate'));
    const { engine, errors } = probeEngine(def, dispatch(
      onPrompt('Hideout: trash a card', (r, s) => offered(r, s, 'Estate')),
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Hideout') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    expect(count(state, HAND('p0'))).toBe(6); // 5 + Hideout + Estate - played + 1 - trashed
    expect(names(state, TRASH)).toEqual(['Estate']);
    expect(names(state, DISCARD('p0'))).toEqual(['Curse']);
  });

  it('trashing a non-Victory card gains nothing', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Hideout'), dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, dispatch(
      onPrompt('Hideout: trash a card', (r, s) => offered(r, s, 'Silver')),
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Hideout') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(count(state, DISCARD('p0'))).toBe(0);
  });
});

describe('Inventor', () => {
  it('gains up to $4, then deepens the discount — a second Inventor reaches $5', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Inventor'), fromReserve('Inventor'), dealNamed('Village'));
    const picks: string[] = [];
    const { engine, errors } = probeEngine(def, dispatch(
      onPrompt('Inventor: gain a card', (r, s) => {
        const ids = 'cardIds' in r ? r.cardIds : [];
        // First resolve: nothing over $4 qualifies; second: $5 is in reach.
        const want = picks.length === 0 ? 4 : 5;
        if (picks.length === 0) {
          expect(ids.some((cid) => Number(s.cards[cid].fields['dom_field_cost']) === 5)).toBe(false);
        }
        const pick = ids.find((cid) => Number(s.cards[cid].fields['dom_field_cost']) === want)!;
        expect(pick, `a $${want} pile is offered`).toBeDefined();
        picks.push(s.cards[pick].name);
        return pick;
      }),
    ));
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Inventor') });
    state = engine.getState();
    expect(state.globalVars['dom_var_cost_discount']).toBe(1);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Inventor') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.globalVars['dom_var_cost_discount']).toBe(2);
    expect(picks).toHaveLength(2);
    for (const name of picks) expect(names(state, DISCARD('p0'))).toContain(name);
  });
});

describe('Mountain Village', () => {
  it('+2 Actions and takes a card from the discard pile when it can', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Mountain Village'), dealNamed('Silver', 'dom_zone_discard', 'p0'));
    const { engine, errors } = probeEngine(def, dispatch(
      onPrompt('Mountain Village:', (r, s) => offered(r, s, 'Silver')),
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Mountain Village') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2);
    expect(names(state, HAND('p0'))).toContain('Silver');
    expect(count(state, HAND('p0'))).toBe(6); // 5 + MV - played + Silver
    expect(count(state, DISCARD('p0'))).toBe(0);
  });

  it('with an empty discard pile it draws 1 instead', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Mountain Village'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Mountain Village') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2);
    expect(count(state, HAND('p0'))).toBe(6); // 5 + MV - played + 1 drawn
  });
});

describe('Patron', () => {
  it('+1 Villager and +$2 (the reveal rider is dropped — module header)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Patron'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Patron') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_villagers']).toBe(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
  });
});

describe('Priest', () => {
  it("its own trash pays nothing extra; later trashes pay the bonus; cleanup resets it", async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Village'), fromReserve('Priest'), fromReserve('Chapel'),
      dealNamed('Estate'), dealNamed('Copper'),
    );
    const { engine, errors } = probeEngine(def, dispatch(
      onPrompt('Priest: trash a card', (r, s) => offered(r, s, 'Estate')),
      onPrompt('Chapel: choose up to 4', (r, s) => JSON.stringify([offered(r, s, 'Copper')])),
    ));
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Priest') });
    state = engine.getState();
    // +$2 flat; the Priest's OWN trash nets no bonus (the pre-refund).
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars[PRIEST_BONUS]).toBe(2);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Chapel') });
    state = engine.getState();
    expect(errors).toEqual([]);
    // Chapel's trash happened under the Priest: +$2.
    expect(state.players[0].vars['dom_var_coins']).toBe(4);
    expect([...names(state, TRASH)].sort()).toEqual(['Copper', 'Estate']);
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars[PRIEST_BONUS]).toBe(0);
  });
});
