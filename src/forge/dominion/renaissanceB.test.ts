/**
 * Renaissance (part B) — deterministic per-card probes through the REAL
 * engine: the Research mat duration round-trip (set-asides return at the
 * next turn start and score at recounts meanwhile), the Coffers/Villagers
 * banks (banked by the cards, spent through the core actions), the two
 * stacked attacks (Moat-blockable) and the two artifacts (the Key's turn
 * start +$1, the Treasure Chest's buy-phase Gold).
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time — so the module
 * is pushed into EXPANSIONS here and buildDominionDef is loaded via dynamic
 * import afterwards. The sibling renaissanceA DECLARES the five artifact
 * variables this module's Key/Treasure Chest machinery reads, so it is
 * pushed too (includes-guarded). While that file is not on disk yet
 * (parallel authoring), a minimal stub declares the two vars renaissanceB
 * references under the documented contract (global string, holder's player
 * id, '' = unclaimed) so this suite stays self-sufficient; the dynamic
 * import picks the real module up automatically once it lands. Once the
 * integrator registers both, freshDef() can become a plain static
 * `buildDominionDef` import and the stub can go.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Block, ChoiceRequest, EngineHandle, Expr, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import type { ExpansionModule } from './kit';
import { ARTIFACT_CHEST, ARTIFACT_KEY, RESEARCH_ZONE, renaissanceB } from './renaissanceB';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

/** The two artifact vars under the documented renaissanceA contract (see
 *  the header) — used only while the sibling file is not on disk yet. */
const ARTIFACT_STUB: ExpansionModule = {
  id: 'renaissanceA_artifact_stub',
  setName: 'Renaissance',
  piles: [],
  ids: {},
  buildCards: () => [],
  variables: [
    {
      id: ARTIFACT_KEY, name: 'Artifact: the Key',
      scope: 'global', type: 'string', initial: '', hidden: true,
    },
    {
      id: ARTIFACT_CHEST, name: 'Artifact: the Treasure Chest',
      scope: 'global', type: 'string', initial: '', hidden: true,
    },
  ],
};

beforeAll(async () => {
  if (!EXPANSIONS.includes(renaissanceB)) EXPANSIONS.push(renaissanceB);
  try {
    // Non-literal specifier: resolved at runtime (the file may not exist
    // yet — see the header), so neither tsc nor the transform pins it.
    const sibling = './renaissanceA';
    const a = (await import(sibling)) as { renaissanceA: ExpansionModule };
    if (!EXPANSIONS.includes(a.renaissanceA)) EXPANSIONS.push(a.renaissanceA);
  } catch {
    if (!EXPANSIONS.some((x) => x.id === ARTIFACT_STUB.id)) EXPANSIONS.push(ARTIFACT_STUB);
  }
});

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
const RESEARCH = (p: string) => `${RESEARCH_ZONE}:${p}`;
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

describe('renaissanceB module registration', () => {
  it('validates clean and knows all twelve cards with costs, types and tags', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Research: 4, 'Silk Merchant': 4,
      'Old Witch': 5, Recruiter: 5, Scepter: 5, Scholar: 5, Sculptor: 5, Seer: 5,
      Spices: 5, Swashbuckler: 5, Treasurer: 5, Villain: 5,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
      expect(card!.tags, `${name} ships no reaction`).not.toContain('dom_tag_reaction');
    }
    // Spices is the group's one Treasure; Scepter stays an Action (the
    // module's prominent deviation); the two attacks wear the tag.
    expect(def.cards.find((c) => c.name === 'Spices')!.typeId).toBe('dom_type_treasure');
    expect(def.cards.find((c) => c.name === 'Scepter')!.typeId).toBe('dom_type_action');
    expect(def.cards.find((c) => c.name === 'Old Witch')!.tags).toContain('dom_tag_attack');
    expect(def.cards.find((c) => c.name === 'Villain')!.tags).toContain('dom_tag_attack');
    expect(def.cards.find((c) => c.name === 'Research')!.typeId).toBe('dom_type_action');
    // The Research mat and the two artifact triggers are merged in.
    expect(def.zones.some((z) => z.id === RESEARCH_ZONE)).toBe(true);
    expect(def.triggers.some((t) => t.id === 'dom_trigger_artifact_key')).toBe(true);
    expect(def.triggers.some((t) => t.id === 'dom_trigger_artifact_chest')).toBe(true);
  });
});

describe('Research', () => {
  it('trashes, sets aside 1 card per $1 on the mat, scores it, and returns them next turn', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Research'),
      dealNamed('Silver'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'), // deck top → first set-aside
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();

    // T1 (p0): +1 Action, trash the Silver ($3) → 3 cards face down on the
    // mat (the dealt Estate among them), then Research parks.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Research') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(count(state, RESEARCH('p0'))).toBe(3);
    expect(names(state, RESEARCH('p0'))).toContain('Estate');
    expect(count(state, HAND('p0'))).toBe(5); // 5 + 2 dealt - Research - Silver
    expect(names(state, DURATION('p0'))).toEqual(['Research']);

    // The set-aside Estate still scores at the turn-end recount:
    // 3 starter Estates + the dealt one on the mat = 4 VP.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp']).toBe(4);
    expect(count(state, RESEARCH('p0'))).toBe(3); // cleanup spares the mat

    await passTurn(engine, 'p1');

    // T3 (p0): the later half scoops the whole mat into the hand and
    // Research marches back to In Play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes('Research resolves'))).toBe(true);
    expect(count(state, RESEARCH('p0'))).toBe(0);
    expect(count(state, HAND('p0'))).toBe(8); // 5 redrawn + 3 set-asides
    expect(names(state, INPLAY('p0'))).toEqual(['Research']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Silk Merchant', () => {
  it('+2 Cards +1 Buy on play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Silk Merchant'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Silk Merchant') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Silk Merchant + 2 drawn
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
  });

  it('bought: the buyer banks +1 Coffers and +1 Villager', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Silk Merchant'));
    setStartingCoins(def, 4);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Silk Merchant'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Silk Merchant']);
    expect(state.players[0].vars['dom_var_coffers']).toBe(1);
    expect(state.players[0].vars['dom_var_villagers']).toBe(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
  });

  it('trashed (Chapel): the trasher banks +1 Coffers and +1 Villager', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Chapel'), fromReserve('Silk Merchant'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const silk = req.cardIds.find((id) => state.cards[id].name === 'Silk Merchant')!;
      return JSON.stringify([silk]);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Chapel') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Silk Merchant']);
    expect(state.players[0].vars['dom_var_coffers']).toBe(1);
    expect(state.players[0].vars['dom_var_villagers']).toBe(1);
  });
});

describe('Old Witch', () => {
  it('+3 Cards; the victim gains a Curse and may trash a hand Curse inside the attack', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Old Witch'), dealNamed('Curse', 'dom_zone_hand', 'p1'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards' || req.playerId !== 'p1') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify([req.cardIds[0]]); // trash the hand Curse
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Old Witch') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Old Witch + 3 drawn
    // The gained Curse sits in the discard; the trashed one came from hand.
    expect(names(state, DISCARD('p1'))).toEqual(['Curse']);
    expect(names(state, TRASH)).toEqual(['Curse']);
    expect(count(state, HAND('p1'))).toBe(5); // 5 + dealt Curse - trashed Curse
    expect(requests).toHaveLength(1);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.min).toBe(0); // the self-heal is optional
    expect(req.max).toBe(1);
    // 10 Curses - 1 dealt to p1's hand - 1 gained by p1.
    expect(names(state, SUPPLY).filter((n) => n === 'Curse')).toHaveLength(8);
  });

  it('a revealed Moat waves the whole attack off', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Old Witch'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Old Witch') });
    await playOutWindows(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // the draw half still pays
    expect(count(state, DISCARD('p1'))).toBe(0); // no Curse gained
    expect(count(state, TRASH)).toBe(0);
    expect(count(state, HAND('p1'))).toBe(6); // 5 + the Moat, untouched
  });
});

describe('Recruiter', () => {
  it('+2 Cards, trashes a hand card and banks +1 Villager per $1 it cost', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Recruiter'), dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Recruiter') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(state.players[0].vars['dom_var_villagers']).toBe(3); // Silver costs $3
    expect(count(state, HAND('p0'))).toBe(7); // 7 - Recruiter + 2 - Silver
    expect(state.players[0].vars['dom_var_actions']).toBe(0);

    // The bank cashes through the core spend action: +1 Action per Villager.
    await engine.performAction('p0', { actionId: 'dom_action_spend_villager' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.players[0].vars['dom_var_villagers']).toBe(2);
  });
});

describe('Scepter', () => {
  it('with nothing to replay it resolves as +$2 without a prompt', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Scepter'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Scepter') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, INPLAY('p0'))).toEqual(['Scepter']);
  });

  it('the +$2 option pays even when a replay was available', async () => {
    const def = await freshDef();
    def.setup.push(dealNamed('Village'), fromReserve('Scepter'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'scepter_coins';
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Scepter') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
  });

  it('replays an Action still in play (never itself) via the Throne mechanism', async () => {
    const def = await freshDef();
    def.setup.push(dealNamed('Village'), dealNamed('Smithy'), fromReserve('Scepter'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'option') return 'scepter_replay';
      if (req.kind === 'cards') {
        // Scepter itself is excluded from the candidates.
        const offered = req.cardIds.map((id) => state.cards[id].name).sort();
        expect(offered).toEqual(['Smithy', 'Village']);
        return JSON.stringify([req.cardIds.find((id) => state.cards[id].name === 'Smithy')!]);
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Village') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Smithy') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Scepter') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['option', 'cards']);
    expect(state.log.some((l) => l.text.includes('replays'))).toBe(true);
    // 5 + 3 dealt; Village −1+1, Smithy −1+3, Scepter −1, replayed Smithy
    // +1 (the 10-card deck is exhausted: only 1 card was left to draw).
    expect(count(state, HAND('p0'))).toBe(10);
    expect(count(state, DECK('p0'))).toBe(0);
    expect(state.players[0].vars['dom_var_coins']).toBe(0); // replay ≠ +$2
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Scepter', 'Smithy', 'Village']);
  });
});

describe('Scholar', () => {
  it('discards the whole hand, then draws 7', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Scholar'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Scholar') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // 5 discarded, 5 drawn off the deck, reshuffle folds the discard back
    // in, 2 more drawn: hand 7, deck 3, discard empty.
    expect(count(state, HAND('p0'))).toBe(7);
    expect(count(state, DECK('p0'))).toBe(3);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(names(state, INPLAY('p0'))).toEqual(['Scholar']);
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
  });
});

describe('Sculptor', () => {
  it('gains a Treasure to the HAND and banks +1 Villager', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Sculptor'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();
    const state0 = engine.getState();
    const silversBefore = names(state0, SUPPLY).filter((n) => n === 'Silver').length;
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Sculptor') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Sculptor + the Silver
    expect(names(state, HAND('p0'))).toContain('Silver');
    expect(count(state, DISCARD('p0'))).toBe(0); // to hand, not the discard
    expect(state.players[0].vars['dom_var_villagers']).toBe(1);
    expect(names(state, SUPPLY).filter((n) => n === 'Silver')).toHaveLength(silversBefore - 1);
  });

  it('a non-Treasure gain banks no Villager', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Sculptor'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Sculptor') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6);
    expect(state.players[0].vars['dom_var_villagers']).toBe(0);
    expect(names(state, SUPPLY).filter((n) => n === 'Estate')).toHaveLength(7); // 8 - 1
  });
});

describe('Seer', () => {
  it('+1 Card +1 Action; the $2–$4 reveals join the hand, the rest go back on top', async () => {
    const def = await freshDef();
    // Deck top after setup (last dealt = top): Copper, Silver, Estate, Gold.
    def.setup.push(
      fromReserve('Seer'),
      dealNamed('Gold', 'dom_zone_deck', 'p0'),
      dealNamed('Estate', 'dom_zone_deck', 'p0'),
      dealNamed('Silver', 'dom_zone_deck', 'p0'),
      dealNamed('Copper', 'dom_zone_deck', 'p0'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Seer') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // +1 Card drew the Copper; Silver ($3) and Estate ($2) joined the hand;
    // the Gold ($6) went back on top of the deck in place.
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Seer + Copper + Silver + Estate
    expect(names(state, HAND('p0'))).toContain('Silver');
    expect(topName(state, DECK('p0'))).toBe('Gold');
    expect(count(state, LOOK)).toBe(0);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
  });
});

describe('Spices', () => {
  it('plays as a Treasure: $2 (the coin field) and +1 Buy (the on-play half)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Spices'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Spices'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(names(state, INPLAY('p0'))).toEqual(['Spices']);
  });

  it('bought: the buyer banks +2 Coffers', async () => {
    const def = await freshDef();
    def.setup.push(pileToSupply('Spices'));
    setStartingCoins(def, 5);
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Spices'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Spices']);
    expect(state.players[0].vars['dom_var_coffers']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
  });
});

describe('Swashbuckler', () => {
  it('+3 Cards; a non-empty discard pays +1 Coffers; at 4 Coffers the Treasure Chest arrives, and it pays a Gold at the buy phase', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Swashbuckler'), dealNamed('Copper', 'dom_zone_discard', 'p0'));
    def.variables.find((v) => v.id === 'dom_var_coffers')!.initial = 3;
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Swashbuckler') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Swashbuckler + 3 drawn
    expect(state.players[0].vars['dom_var_coffers']).toBe(4);
    expect(state.globalVars[ARTIFACT_CHEST]).toBe('p0');

    // The Treasure Chest pays out at the holder's buy-phase start.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes('opens the Treasure Chest'))).toBe(true);
    expect(names(state, DISCARD('p0'))).toContain('Gold');
    expect(state.players[0].vars['dom_var_coffers']).toBe(4); // the Gold is a gain, not Coffers
  });

  it('an empty discard pile pays nothing and no artifact moves', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Swashbuckler'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Swashbuckler') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8);
    expect(state.players[0].vars['dom_var_coffers']).toBe(0);
    expect(state.globalVars[ARTIFACT_CHEST]).toBe('');

    // No Chest, no Gold at the buy phase.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).not.toContain('Gold');
  });
});

describe('Treasurer', () => {
  it('+$3 and the trash option trashes a Treasure from the hand', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Treasurer'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'option') return 'treasurer_trash';
      if (req.kind === 'card') return req.cardIds[0]; // candidates are Treasures only
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Treasurer') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(count(state, TRASH)).toBe(1);
    expect(names(state, TRASH)).toEqual(['Copper']); // the starter hand's only Treasures
  });

  it('the gain option pulls a Treasure out of the TRASH into the hand, tagged as a gain', async () => {
    const def = await freshDef();
    def.setup.push(dealNamed('Silver', 'dom_zone_trash'), fromReserve('Treasurer'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'option') return 'treasurer_gain';
      if (req.kind === 'card') return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    expect(names(state0, TRASH)).toEqual(['Silver']);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Treasurer') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(count(state, TRASH)).toBe(0);
    expect(names(state, HAND('p0'))).toContain('Silver');
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Treasurer + the Silver
  });

  it('the Key option takes the Key; the holder gets +$1 at their turn starts only', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Treasurer'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'option') return 'treasurer_key';
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    expect(state.globalVars[ARTIFACT_KEY]).toBe('');
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Treasurer') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(state.globalVars[ARTIFACT_KEY]).toBe('p0');

    // p1's turn start pays them nothing…
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(state.players[1].vars['dom_var_coins']).toBe(0);
    // …but p0's next turn start pays +$1.
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.log.some((l) => l.text.includes('takes +$1 from the Key'))).toBe(true);
  });
});

describe('Villain', () => {
  it('+2 Coffers; a victim with 5+ cards discards one costing $2 or more', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Villain'), dealNamed('Silver', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card' || req.playerId !== 'p1') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Villain') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coffers']).toBe(2);
    expect(names(state, DISCARD('p1'))).toEqual(['Silver']);
    expect(count(state, HAND('p1'))).toBe(5); // 5 + dealt Silver - discarded
  });

  it('a revealed Moat waves the discard demand off', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Villain'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Villain') });
    await playOutWindows(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coffers']).toBe(2); // the bank half still pays
    expect(count(state, DISCARD('p1'))).toBe(0);
    expect(count(state, HAND('p1'))).toBe(6); // untouched
  });
});
