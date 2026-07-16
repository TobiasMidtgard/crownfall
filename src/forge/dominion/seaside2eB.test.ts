/**
 * Seaside 2E (part B) — deterministic per-card probes through the REAL
 * engine, in the base2e.test.ts style: cards under test start in the hidden
 * RESERVE and are dealt with fromZone 'dom_zone_reserve'; every probe asserts
 * zero script errors alongside the card's outcome.
 *
 * REGISTRATION: this module is NOT yet wired into expansions.ts (the
 * integrator does that). buildDominionDef derives its module-scope tables
 * (kingdom piles, type lines, card ids) from the EXPANSIONS array at
 * dominionGame.ts EVALUATION time, so the module is pushed into EXPANSIONS
 * here, at this file's module scope, and dominionGame is then loaded through
 * a dynamic import in beforeAll — none of this file's static imports
 * evaluates dominionGame.ts, so the push always lands first. Once the
 * integrator registers the module, the push becomes a no-op guard and the
 * dynamic import keeps working unchanged.
 *
 * DURATION probes follow the kit.durationPair contract: play → cleanup
 * leaves the card in the DURATION zone (never discarded) → the opponent's
 * turn passes → the owner's next action phase fires the later half → the
 * card is back in In Play → THAT turn's cleanup discards it. Decks are
 * padded with extra Coppers so the final cleanup redraw never reshuffles the
 * just-discarded Duration card out of the discard pile (keeps the last
 * assertion deterministic).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChoiceRequest, Expr, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import { SMUGGLE_VAR, seaside2eB } from './seaside2eB';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(seaside2eB)) EXPANSIONS.push(seaside2eB);

let buildDominionDef: () => GameDef;
beforeAll(async () => {
  ({ buildDominionDef } = await import('../dominionGame'));
});

const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const DURATION = (p: string) => `dom_zone_duration:${p}`;
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
const countOf = (state: GameState, zoneKey: string, name: string): number =>
  names(state, zoneKey).filter((n) => n === name).length;

/** Setup block: move EVERY card matching `filter` between two zones. */
function moveAll(
  fromZone: string, toZone: string,
  opts: { owner?: string; filter?: Expr } = {},
): GameDef['setup'][number] {
  const owner = opts.owner !== undefined ? { kind: 'str', value: opts.owner } as Expr : null;
  return {
    kind: 'moveCards',
    from: { zoneId: fromZone, owner },
    to: { zoneId: toZone, owner },
    cards: opts.filter ? { kind: 'filter', filter: opts.filter } : { kind: 'all' },
    toPosition: 'top',
    faceUp: null,
  };
}

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');

/** Pad the contextual player's deck so late redraws never reshuffle. */
const padDeck = (n: number) => Array.from({ length: n }, () => dealNamed('Copper', 'dom_zone_deck'));

const play = { actionId: 'dom_action_play' };

type Engine = ReturnType<typeof probeEngine>['engine'];

/** Action → Buy → Cleanup → the turn passes (three manual phases). */
async function endTurn(engine: Engine, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

describe('seaside2eB module registration', () => {
  it('validates clean and knows all nine cards with their costs and tags', () => {
    const def = buildDominionDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      'Sea Chart': 3, Lookout: 3, Monkey: 3, Smugglers: 3,
      Blockade: 4, Cutpurse: 4, Corsair: 5, Pirate: 5, 'Sea Witch': 5,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.typeId, `${name} is Action-typed`).toBe('dom_type_action');
    }
    for (const name of ['Blockade', 'Cutpurse', 'Corsair', 'Sea Witch']) {
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} attacks`)
        .toContain('dom_tag_attack');
    }
    // Pirate dropped its printed Reaction half — it must NOT wear the tag.
    expect(def.cards.find((c) => c.name === 'Pirate')!.tags).not.toContain('dom_tag_reaction');
  });
});

describe('Sea Chart', () => {
  it('+1 Card +1 Action; the revealed top card joins the hand when a copy is in play', async () => {
    const def = buildDominionDef();
    // Deck top after setup (top last): ..., Silver, Copper. A Silver waits
    // in the owner's play area, so the reveal (Silver) hits.
    def.setup.push(
      fromReserve('Sea Chart'),
      dealNamed('Silver', 'dom_zone_inplay', 'p0'),
      dealNamed('Silver', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
    );
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Sea Chart') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    // 6 dealt - Sea Chart + 1 drawn (Copper) + the revealed Silver.
    expect(count(state, HAND('p0'))).toBe(7);
    expect(names(state, HAND('p0'))).toContain('Silver');
    expect(count(state, DECK('p0'))).toBe(5);
  });

  it('without a copy in play, the revealed card stays on the deck', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Sea Chart'),
      dealNamed('Silver', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
    );
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Sea Chart') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6);
    expect(topName(state, DECK('p0'))).toBe('Silver');
    expect(count(state, DECK('p0'))).toBe(6);
  });
});

describe('Lookout', () => {
  it('+1 Action; trashes one, discards one and topdecks the last of the top 3', async () => {
    const def = buildDominionDef();
    // Deck top after setup (top last): ..., Curse, Silver, Copper.
    def.setup.push(
      fromReserve('Lookout'),
      dealNamed('Curse', 'dom_zone_deck'),
      dealNamed('Silver', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      const pick = req.prompt.includes('trash') ? 'Curse' : 'Copper';
      return req.cardIds.find((id) => state.cards[id].name === pick)!;
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Lookout') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.kind === 'card' && r.revealed)).toBe(true);
    expect(names(state, TRASH)).toEqual(['Curse']);
    expect(names(state, DISCARD('p0'))).toEqual(['Copper']);
    expect(topName(state, DECK('p0'))).toBe('Silver');
    expect(count(state, DECK('p0'))).toBe(6); // 5 + 3 dealt - drawn 0 - 2 removed
    expect(count(state, LOOK)).toBe(0);
  });
});

describe('Cutpurse', () => {
  it('+2 Coins; the opponent discards a Copper (no choice — Coppers are identical)', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Cutpurse'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    // The starter deal guarantees at least 2 Coppers in any 5-card hand.
    const coppersBefore = countOf(state0, HAND('p1'), 'Copper');
    expect(coppersBefore).toBeGreaterThan(0);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Cutpurse') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(countOf(state, HAND('p1'), 'Copper')).toBe(coppersBefore - 1);
    expect(names(state, DISCARD('p1'))).toEqual(['Copper']);
  });

  it('a Copperless hand is revealed (announced) instead', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Cutpurse'),
      moveAll('dom_zone_hand', 'dom_zone_deck', { owner: 'p1' }),
    );
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    expect(count(state0, HAND('p1'))).toBe(0);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Cutpurse') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(count(state, DISCARD('p1'))).toBe(0);
    expect(state.log.some((l) => l.text.includes('reveals a hand with no Copper'))).toBe(true);
  });
});

describe('Sea Witch (duration lifecycle)', () => {
  it('now: +2 Cards + Curse attack; parks over cleanup; later: +2 then discard 2; returns and is discarded', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Sea Witch'), ...padDeck(10));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, req.min));
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Sea Witch') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    // now: +2 Cards, then the card parks in the DURATION zone.
    expect(count(state, HAND('p0'))).toBe(7); // 6 dealt - played + 2 drawn
    expect(names(state, DURATION('p0'))).toEqual(['Sea Witch']);
    expect(count(state, INPLAY('p0'))).toBe(0);
    // The stacked attack half resolved after the window: one Curse.
    expect(names(state, DISCARD('p1'))).toEqual(['Curse']);

    // Owner's cleanup leaves the parked card alone (NOT discarded).
    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Sea Witch']);
    expect(names(state, DISCARD('p0'))).not.toContain('Sea Witch');

    // The opponent's turn passes; entering the OWNER's next action phase
    // fires the later half: +2 Cards, discard exactly 2, march back In Play.
    await endTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    const discardReqs = requests.filter((r) => r.kind === 'cards');
    expect(discardReqs).toHaveLength(1);
    expect(discardReqs[0].playerId).toBe('p0');
    expect((discardReqs[0] as Extract<ChoiceRequest, { kind: 'cards' }>).min).toBe(2);
    expect(count(state, HAND('p0'))).toBe(5); // 5 redrawn + 2 - 2
    expect(names(state, INPLAY('p0'))).toEqual(['Sea Witch']);
    expect(count(state, DURATION('p0'))).toBe(0);
    // The march back must NOT re-fire the on-play halves: no second Curse,
    // no re-park (the DURATION RE-ENTRY GUARD).
    expect(countOf(state, DISCARD('p1'), 'Curse')).toBe(1);

    // THIS turn's cleanup finally discards it like any played card.
    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Sea Witch');
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(count(state, INPLAY('p0'))).toBe(0);
  });
});

describe('Throne Room + Sea Witch (duration replay)', () => {
  it('now runs twice (and attacks twice), the card parks ONCE, later fires ONCE', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Throne Room'), fromReserve('Sea Witch'), ...padDeck(10));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Sea Witch')!;
      }
      if (req.kind === 'cards') return JSON.stringify(req.cardIds.slice(0, req.min));
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Throne Room') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    // now ran twice: 7 dealt - TR - Sea Witch + 4 drawn.
    expect(count(state, HAND('p0'))).toBe(9);
    // ...but the card parked exactly once.
    expect(names(state, DURATION('p0'))).toEqual(['Sea Witch']);
    expect(names(state, INPLAY('p0'))).toEqual(['Throne Room']);
    // The stacked attack half fired twice — two Curses.
    expect(countOf(state, DISCARD('p1'), 'Curse')).toBe(2);

    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Sea Witch']);

    // later fires ONCE at the owner's next action phase.
    await endTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.filter((r) => r.kind === 'cards')).toHaveLength(1);
    expect(count(state, HAND('p0'))).toBe(5); // 5 redrawn + 2 - 2
    expect(names(state, INPLAY('p0'))).toEqual(['Sea Witch']);
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(countOf(state, DISCARD('p1'), 'Curse')).toBe(2); // no third Curse
  });
});

describe('Corsair', () => {
  it('now +2 Coins and the opponent trashes a Silver from play (before a Gold); later +1 Card', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Corsair'),
      dealNamed('Silver', 'dom_zone_inplay', 'p1'),
      dealNamed('Gold', 'dom_zone_inplay', 'p1'),
      ...padDeck(10),
    );
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Corsair') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    // The Silver goes first; the Gold survives.
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(names(state, INPLAY('p1'))).toEqual(['Gold']);
    expect(names(state, DURATION('p0'))).toEqual(['Corsair']);

    await endTurn(engine, 'p0');
    await endTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + the later draw
    expect(names(state, INPLAY('p0'))).toEqual(['Corsair']);
    expect(count(state, DURATION('p0'))).toBe(0);
    // No re-fired attack on the march back: the Gold is still untrashed.
    expect(names(state, TRASH)).toEqual(['Silver']);

    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DISCARD('p0'))).toContain('Corsair');
  });
});

describe('Blockade', () => {
  it('now gains a card costing up to 4 onto the deck; later the opponent gains a Curse', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Blockade'), ...padDeck(10));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      const offered = req.cardIds.map((id) => state.cards[id].name);
      expect(offered).toContain('Silver'); // cost 3 — within the cap
      expect(offered).toContain('Estate'); // cost 2
      expect(offered).not.toContain('Duchy'); // cost 5 — beyond it
      expect(offered).not.toContain('Gold'); // cost 6
      return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Blockade') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    // Gained straight onto the deck, not the discard.
    expect(topName(state, DECK('p0'))).toBe('Silver');
    expect(names(state, DISCARD('p0'))).toEqual([]);
    expect(names(state, DURATION('p0'))).toEqual(['Blockade']);

    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Blockade']);
    expect(countOf(state, DISCARD('p1'), 'Curse')).toBe(0); // not yet

    // The Curse lands at the START of the owner's next turn.
    await endTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(countOf(state, DISCARD('p1'), 'Curse')).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Blockade']);
    expect(count(state, DURATION('p0'))).toBe(0);

    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DISCARD('p0'))).toContain('Blockade');
    expect(countOf(state, DISCARD('p1'), 'Curse')).toBe(1); // fires only once
  });
});

describe('Monkey', () => {
  it('draws on the OPPONENT’s gains only while parked; later +1 Card; then discards normally', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Monkey'), ...padDeck(10));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Monkey') });
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Monkey']);
    expect(count(state, HAND('p0'))).toBe(5);

    // The owner's OWN gain (buying a Copper) must NOT draw.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(5); // unchanged
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(5); // fresh hand

    // The opponent's buy IS a gain — the parked Monkey draws its owner 1.
    await engine.performAction('p1', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p1', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // +1 from the watcher
    await engine.performAction('p1', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p1', { actionId: 'dom_action_cleanup' });

    // Owner's next action phase: later +1 Card, the Monkey marches back.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7);
    expect(names(state, INPLAY('p0'))).toEqual(['Monkey']);
    expect(count(state, DURATION('p0'))).toBe(0);

    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DISCARD('p0'))).toContain('Monkey');
  });
});

describe('Pirate', () => {
  it('parks over the off-turn, then gains a Gold TO HAND at the next turn start', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Pirate'), ...padDeck(10));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Pirate') });
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Pirate']);

    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Pirate']);
    expect(names(state, HAND('p0'))).not.toContain('Gold');

    await endTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + the Gold
    expect(names(state, HAND('p0'))).toContain('Gold');
    expect(countOf(state, SUPPLY, 'Gold')).toBe(29);
    expect(names(state, INPLAY('p0'))).toEqual(['Pirate']);

    await endTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DISCARD('p0'))).toContain('Pirate');
  });
});

describe('Smugglers', () => {
  it('gains a copy of the opponent’s last cheap gain from the supply', async () => {
    const def = buildDominionDef();
    // Smugglers waits on top of p0's deck so the turn-1 cleanup draws it.
    def.setup.push(fromReserve('Smugglers', 'dom_zone_deck'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    await endTurn(engine, 'p0');
    let state = engine.getState();
    expect(names(state, HAND('p0'))).toContain('Smugglers');

    // The opponent buys a Copper — the recorder remembers it (cost 0 <= 6).
    await engine.performAction('p1', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p1', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    expect(state.players[1].vars[SMUGGLE_VAR]).toBe('Copper');
    await engine.performAction('p1', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p1', { actionId: 'dom_action_cleanup' });

    state = engine.getState();
    const suppliedBefore = countOf(state, SUPPLY, 'Copper');
    const discardBefore = countOf(state, DISCARD('p0'), 'Copper');
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Smugglers') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(countOf(state, SUPPLY, 'Copper')).toBe(suppliedBefore - 1);
    expect(countOf(state, DISCARD('p0'), 'Copper')).toBe(discardBefore + 1);
  });

  it('whiffs gracefully when the opponent has gained nothing yet', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Smugglers'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Smugglers') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(state.log.some((l) => l.text.includes('nothing worth copying'))).toBe(true);
  });
});
