/**
 * Nocturne (Night cards + Spirits) — deterministic per-card probes through
 * the REAL engine: the Night phase machinery (appears after Buy, plays cost
 * no Action, auto-skips for nightless hands), the Night-Duration parks and
 * next-turn halves, the gain-to-hand riders, Changeling's exchange,
 * Exorcist's cost ladder, Ghost's double replay, and the Vampire/Werewolf
 * hex-attack windows.
 *
 * REGISTRATION NOTE: the module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time — so the module
 * is pushed into EXPANSIONS here and buildDominionDef is loaded via dynamic
 * import afterwards (adventuresB's pattern).
 *
 * HEX STUB: Vampire/Werewolf reference agent A's (nocturneBoons) hex zones
 * by id. Until that module registers, a zones-only stub supplies
 * dom_zone_hexes / dom_zone_hexes_used / dom_zone_fate so the merged def
 * validates; the receive script then whiffs politely on the empty deck. The
 * stub is GUARDED on the zones being absent, and the hex assertions are
 * conditional on the deck's contents, so this suite keeps passing once the
 * real nocturneBoons lands with actual Hex cards.
 */
import { describe, expect, it } from 'vitest';
import type {
  ChoiceAnswer, ChoiceRequest, EngineHandle, GameDef, GameState,
} from '../../shared/types';
import { PASS_ACTION_ID } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import type { ExpansionModule } from './kit';
import { EXPANSIONS } from './expansions';
import {
  BAT_ZONE, FATE_ZONE, HEX_USED_ZONE, HEX_ZONE, SPIRIT_ZONE, WISH_ZONE, nocturneNight,
} from './nocturneNight';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

/** Zones-only stand-in for nocturneBoons' hex surface (see the header). */
const hexStub: ExpansionModule = {
  id: 'nocturneBoonsHexStub',
  piles: [],
  ids: {},
  buildCards: () => [],
  zones: [
    { id: HEX_ZONE, name: 'Hexes', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
    { id: HEX_USED_ZONE, name: 'Hexes discard', owner: 'shared', visibility: 'all', layout: 'stack', area: 'center' },
    { id: FATE_ZONE, name: 'Fate', owner: 'shared', visibility: 'all', layout: 'row', area: 'center' },
  ],
};

const declaresHexZones = (x: ExpansionModule): boolean =>
  (x.zones ?? []).some((z) => z.id === HEX_ZONE);
if (!EXPANSIONS.some(declaresHexZones)) EXPANSIONS.push(hexStub);
if (!EXPANSIONS.includes(nocturneNight)) EXPANSIONS.push(nocturneNight);

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
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
/** Top of a stack zone = the END of the cardIds array. */
const topName = (state: GameState, zoneKey: string): string | undefined =>
  names(state, zoneKey).at(-1);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');
const fromSpirits = (name: string, toZone = 'dom_zone_hand') =>
  dealNamed(name, toZone, null, SPIRIT_ZONE);

/** Setup block: set a per-player number variable (coins for buy probes). */
const giveVar = (varId: string, playerId: string, value: number): GameDef['setup'][number] =>
  ({ kind: 'setVar', varId, target: { kind: 'str', value: playerId }, value: { kind: 'num', value } });

const play = { actionId: 'dom_action_play' };
const playNight = { actionId: 'dom_action_play_night' };
const noChoices = () => { throw new Error('no choices expected'); };

const phaseId = (def: GameDef, state: GameState): string => def.phases[state.phaseIdx].id;

/** A queue of one-shot answer functions, consumed request by request. */
function answerQueue(
  ...fns: ((req: ChoiceRequest, state: GameState) => ChoiceAnswer)[]
): (req: ChoiceRequest, state: GameState) => ChoiceAnswer {
  let i = 0;
  return (req, state) => {
    if (i >= fns.length) throw new Error(`unexpected extra ${req.kind} choice: ${req.prompt}`);
    const fn = fns[i];
    i += 1;
    return fn(req, state);
  };
}

/** Answer a 'cards' request with the first N cards of the given name. */
const pickCards = (name: string, n: number) => (req: ChoiceRequest, state: GameState): ChoiceAnswer => {
  if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
  const ids = req.cardIds.filter((id) => state.cards[id].name === name).slice(0, n);
  if (ids.length !== n) throw new Error(`wanted ${n} × ${name}`);
  return JSON.stringify(ids);
};
/** Answer a 'card'/'pile' request with the first candidate of the name. */
const pickOne = (name: string) => (req: ChoiceRequest, state: GameState): ChoiceAnswer => {
  if (req.kind !== 'card' && req.kind !== 'pile') throw new Error(`expected card/pile, got ${req.kind}`);
  const id = req.cardIds.find((cid) => state.cards[cid].name === name);
  if (id === undefined) throw new Error(`no ${name} offered`);
  return id;
};
/** Answer an 'option' request with the given option id. */
const pickOption = (optionId: string) => (req: ChoiceRequest): ChoiceAnswer => {
  if (req.kind !== 'option') throw new Error(`expected option, got ${req.kind}`);
  return optionId;
};
/** Answer a yes/no request. */
const sayYes = (req: ChoiceRequest): ChoiceAnswer => {
  if (req.kind !== 'yesNo') throw new Error(`expected yesNo, got ${req.kind}`);
  return true;
};
const sayNo = (req: ChoiceRequest): ChoiceAnswer => {
  if (req.kind !== 'yesNo') throw new Error(`expected yesNo, got ${req.kind}`);
  return false;
};

/**
 * Permissive fallback for probes that may cross agent A's real Hex content
 * once nocturneBoons registers: any unexpected request gets a safe default.
 */
const permissive = (req: ChoiceRequest): ChoiceAnswer => {
  switch (req.kind) {
    case 'yesNo': return false;
    case 'option': return req.options[0].id;
    case 'card': case 'pile': return req.cardIds[0] ?? null;
    case 'cards': return JSON.stringify(req.cardIds.slice(0, req.min));
    case 'player': return req.playerIds[0];
    default: return null;
  }
};

/** Action → Buy → (Night auto-skips) → Cleanup → the turn passes. */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

/** End the Action + Buy phases, landing in Night (the hand must hold one). */
async function toNight(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
}

/**
 * Drive an open response window: every holder passes, except that `useFor`
 * performs `actionId` ONCE when it is legal (adventuresB's driveWindow).
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

describe('nocturneNight module registration', () => {
  it('validates clean and knows all nineteen cards with costs, types and tags', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Guardian: 2, Monastery: 2,
      Changeling: 3, 'Ghost Town': 3, 'Night Watchman': 3, 'Secret Cave': 3,
      "Devil's Workshop": 4, Exorcist: 4,
      Cobbler: 5, Crypt: 5, 'Den of Sin': 5, Vampire: 5, Werewolf: 5,
      Raider: 6,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
      // The one-primary-type world: every kingdom card here is Night-typed.
      expect(card!.typeId, `${name} is a Night card`).toBe('dom_type_night');
    }
    for (const name of ['Raider', 'Vampire', 'Werewolf']) {
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} is an Attack`)
        .toContain('dom_tag_attack');
    }
    expect(def.cards.find((c) => c.name === 'Monastery')!.tags).not.toContain('dom_tag_attack');
    // Non-supply stock: Action-typed (Will-o'-Wisp/Imp/Wish printed so;
    // Ghost/Bat the documented deviation), no Kingdom tag.
    for (const name of ["Will-o'-Wisp", 'Imp', 'Ghost', 'Bat', 'Wish']) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.typeId).toBe('dom_type_action');
      expect(card!.tags).not.toContain('dom_tag_kingdom');
    }
    // The Night phase sits between Buy and Cleanup, with its two actions.
    const phaseIds = def.phases.map((p) => p.id);
    expect(phaseIds).toContain('dom_phase_night');
    expect(phaseIds.indexOf('dom_phase_night')).toBe(phaseIds.indexOf('dom_phase_cleanup') - 1);
    expect(phaseIds.indexOf('dom_phase_night')).toBeGreaterThan(phaseIds.indexOf('dom_phase_buy'));
    expect(def.actions.some((a) => a.id === 'dom_action_play_night')).toBe(true);
    expect(def.actions.some((a) => a.id === 'dom_action_end_night')).toBe(true);
    expect(def.actions.some((a) => a.id === 'dom_action_guardian')).toBe(true);
    // Kingdom stock: 10 copies per pile.
    const deck = def.decks.find((d) => d.id === 'dom_deck_kingdom')!;
    expect(deck.source.kind).toBe('custom');
    if (deck.source.kind === 'custom') {
      for (const name of Object.keys(costs)) {
        const id = nocturneNight.ids[name];
        const entry = deck.source.entries.find((en) => en.cardId === id);
        expect(entry, `${id} in the kingdom deck`).toBeDefined();
        expect(entry!.count).toBe(10);
      }
    }
  });

  it('spawns the Spirit, Bat and Wish stocks at their printed counts', async () => {
    const def = await freshDef();
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, SPIRIT_ZONE)).toBe(31); // 12 + 13 + 6
    expect(names(state, SPIRIT_ZONE).filter((n) => n === "Will-o'-Wisp")).toHaveLength(12);
    expect(names(state, SPIRIT_ZONE).filter((n) => n === 'Imp')).toHaveLength(13);
    expect(names(state, SPIRIT_ZONE).filter((n) => n === 'Ghost')).toHaveLength(6);
    expect(names(state, BAT_ZONE).filter((n) => n === 'Bat')).toHaveLength(10);
    expect(names(state, WISH_ZONE).filter((n) => n === 'Wish')).toHaveLength(12);
  });
});

describe('the Night phase', () => {
  it('appears after Buy, night plays cost no Action, and it closes when the last Night card is played', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Ghost Town'), fromReserve('Monastery'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    await toNight(engine, 'p0');
    let state = engine.getState();
    expect(phaseId(def, state)).toBe('dom_phase_night');
    // Both night plays and the explicit end are on offer.
    const moves = engine.getLegalMoves('p0');
    expect(moves.some((m) => m.actionId === 'dom_action_play_night')).toBe(true);
    expect(moves.some((m) => m.actionId === 'dom_action_end_night')).toBe(true);

    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Ghost Town') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // no Action spent
    expect(names(state, DURATION('p0'))).toEqual(['Ghost Town']); // parked
    expect(phaseId(def, state)).toBe('dom_phase_night'); // Monastery still in hand

    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Monastery') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    // The hand is nightless now — the phase auto-advances to Cleanup.
    expect(phaseId(def, state)).toBe('dom_phase_cleanup');
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });

    // p1's nightless turn: the phase auto-skips entirely.
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes('Night skipped'))).toBe(true);

    // T3 (p0): Ghost Town's later half — +1 Card and +1 Action.
    state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + 1
    expect(state.players[0].vars['dom_var_actions']).toBe(2);
    expect(names(state, INPLAY('p0'))).toEqual(['Ghost Town']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });

  it('"end the night" leaves the phase with a Night card still in hand', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Ghost Town'), fromReserve('Monastery'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Monastery') });
    state = engine.getState();
    expect(phaseId(def, state)).toBe('dom_phase_night');
    await engine.performAction('p0', { actionId: 'dom_action_end_night' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(phaseId(def, state)).toBe('dom_phase_cleanup');
    expect(names(state, HAND('p0'))).toContain('Ghost Town'); // kept for later
  });

  it('Night cards are invisible to the day play action', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Werewolf'), fromReserve('Monastery'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state = engine.getState();
    const wolf = findNamed(state, HAND('p0'), 'Werewolf');
    const monastery = findNamed(state, HAND('p0'), 'Monastery');
    const moves = engine.getLegalMoves('p0');
    expect(moves.some((m) => m.actionId === 'dom_action_play' && m.cardId === wolf)).toBe(false);
    expect(moves.some((m) => m.actionId === 'dom_action_play' && m.cardId === monastery)).toBe(false);
    expect(moves.some((m) => m.actionId === 'dom_action_play_night')).toBe(false); // not at day
    expect(errors).toEqual([]);
  });
});

describe('Changeling', () => {
  it('trashes itself and gains a copy of a card in play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Changeling'), dealNamed('Village', 'dom_zone_inplay'));
    // One pile matches (Village) — the unrevealed pile choice auto-resolves.
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Changeling') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Changeling']);
    expect(names(state, DISCARD('p0'))).toEqual(['Village']);
  });

  it('with nothing in play, the Changeling still trashes and whiffs politely', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Changeling'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Changeling') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Changeling']);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(state.log.some((l) => l.text.includes('wastes away'))).toBe(true);
  });

  it('on gaining a $3+ card, offers the exchange for a Changeling', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Changeling', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 3),
    );
    const { engine, errors } = probeEngine(def, answerQueue(sayYes));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    const silverBefore = names(state, SUPPLY).filter((n) => n === 'Silver').length;
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Silver'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Changeling']);
    expect(names(state, DISCARD('p0'))).not.toContain('Silver');
    // The Silver went home; the promoted Changeling copy left the supply.
    expect(names(state, SUPPLY).filter((n) => n === 'Silver')).toHaveLength(silverBefore);
    expect(names(state, SUPPLY)).not.toContain('Changeling');
  });

  it('a gained $0 Copper offers no exchange', async () => {
    const def = await freshDef();
    def.setup.push(dealNamed('Changeling', 'dom_zone_supply', null, 'dom_zone_reserve'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Copper']);
  });
});

describe('Cobbler (Night - Duration)', () => {
  it('parks at night, gains to hand costing up to $4 at the next turn start', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Cobbler'));
    const { engine, errors } = probeEngine(def, answerQueue(pickOne('Silver')));
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Cobbler') });
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Cobbler']);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    await passTurn(engine, 'p1');

    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p0'))).toContain('Silver'); // gained TO HAND
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + the Silver
    expect(names(state, INPLAY('p0'))).toEqual(['Cobbler']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Crypt (Night - Duration)', () => {
  it('entombs in-play Treasures and returns one per turn start', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Crypt'), dealNamed('Copper'), dealNamed('Copper'));
    const { engine, errors } = probeEngine(def, answerQueue(
      pickCards('Copper', 2), // entomb both played Coppers
      pickCards('Copper', 1), // T3: retrieve one (two candidates)
    ));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Copper'),
    });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Copper'),
    });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Crypt') });
    state = engine.getState();
    expect(names(state, DURATION('p0')).sort()).toEqual(['Copper', 'Copper', 'Crypt']);
    expect(count(state, INPLAY('p0'))).toBe(0);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(count(state, DURATION('p0'))).toBe(3); // cleanup spares the vault
    await passTurn(engine, 'p1');

    // T3 (p0): one Copper comes home; the Crypt stays with the other.
    state = engine.getState();
    expect(names(state, HAND('p0'))).toContain('Copper');
    expect(names(state, DURATION('p0')).sort()).toEqual(['Copper', 'Crypt']);
    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T5 (p0): the last Copper auto-retrieves and the empty Crypt returns.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(names(state, INPLAY('p0'))).toEqual(['Crypt']);
  });

  it('with no Treasures in play it stays out and is cleaned up normally', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Crypt'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Crypt') });
    state = engine.getState();
    expect(names(state, INPLAY('p0'))).toEqual(['Crypt']); // left behind
    expect(count(state, DURATION('p0'))).toBe(0);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, INPLAY('p0'))).toBe(0); // swept like any card
  });
});

describe('Den of Sin (Night - Duration)', () => {
  it('is gained to the hand instead of the discard pile', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Den of Sin', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 5),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Den of Sin'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p0'))).toContain('Den of Sin');
    expect(count(state, DISCARD('p0'))).toBe(0);
  });

  it('parks at night and draws 2 at the next turn start', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Den of Sin'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Den of Sin') });
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Den of Sin']);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 5 redrawn + 2
    expect(names(state, INPLAY('p0'))).toEqual(['Den of Sin']);
  });
});

describe("Devil's Workshop", () => {
  it('0 cards gained: a Gold', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve("Devil's Workshop"));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), "Devil's Workshop") });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Gold']);
  });

  it('1 card gained: a card costing up to $4', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve("Devil's Workshop"));
    const { engine, errors } = probeEngine(def, answerQueue(pickOne('Silver')));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), "Devil's Workshop") });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Copper', 'Silver']);
  });

  it('2+ cards gained: an Imp from the Spirit stock', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve("Devil's Workshop"), giveVar('dom_var_buys', 'p0', 2));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), "Devil's Workshop") });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Imp');
    expect(count(state, SPIRIT_ZONE)).toBe(30); // 31 - the Imp
  });
});

describe('Exorcist', () => {
  it('trashing a Gold opens all three Spirit piles', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Exorcist'), dealNamed('Gold'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') return pickOne('Gold')(req, state);
      if (req.kind === 'pile') return pickOne('Ghost')(req, state);
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Exorcist') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Gold']);
    expect(names(state, DISCARD('p0'))).toEqual(['Ghost']);
    const pileReq = requests.find((r) => r.kind === 'pile') as Extract<ChoiceRequest, { kind: 'pile' }>;
    const offered = pileReq.cardIds.map((id) => state.cards[id].name).sort();
    expect(offered).toEqual(['Ghost', 'Imp', "Will-o'-Wisp"]);
  });

  it('trashing an Estate offers only the Will-o\'-Wisp', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Exorcist'), dealNamed('Estate'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') return pickOne('Estate')(req, state);
      if (req.kind === 'pile') return pickOne("Will-o'-Wisp")(req, state);
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Exorcist') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(["Will-o'-Wisp"]);
    const pileReq = requests.find((r) => r.kind === 'pile') as Extract<ChoiceRequest, { kind: 'pile' }>;
    expect(pileReq.cardIds.map((id) => state.cards[id].name)).toEqual(["Will-o'-Wisp"]);
  });

  it('trashing a Copper finds no cheaper Spirit', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Exorcist'), dealNamed('Copper'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') return pickOne('Copper')(req, state);
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Exorcist') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['card']); // no pile offer
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(count(state, SPIRIT_ZONE)).toBe(31); // untouched
  });
});

describe('Guardian (Night - Duration)', () => {
  it('is gained to the hand', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Guardian', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 2),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Guardian'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p0'))).toContain('Guardian');
    expect(count(state, DISCARD('p0'))).toBe(0);
  });

  it('waves off an attack from the DURATION zone, then pays +$1', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Guardian'), dealNamed('Militia', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();

    // T1 (p0): the Guardian parks at night.
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Guardian') });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Guardian']);

    // T2 (p1): Militia attacks; p0 stands the watch in the window.
    state = engine.getState();
    await engine.performAction('p1', { ...play, cardId: findNamed(state, HAND('p1'), 'Militia') });
    await driveWindow(engine, 'p0', 'dom_action_guardian');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(count(state, HAND('p0'))).toBe(5); // untouched — waved off
    await passTurn(engine, 'p1');

    // T3 (p0): +$1 and the Guardian is back in play.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, INPLAY('p0'))).toEqual(['Guardian']);
  });
});

describe('Monastery', () => {
  it('one optional trash per card gained: hand card and in-play Copper', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Monastery'), dealNamed('Copper'), giveVar('dom_var_buys', 'p0', 2));
    const { engine, errors } = probeEngine(def, answerQueue(
      pickOption('mon_copper'),
      pickOption('mon_hand'),
      pickOne('Estate'),
    ));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    // One Copper into play, two bought — 2 gains this turn.
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Copper'),
    });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    const estatesInHand = names(state, HAND('p0')).filter((n) => n === 'Estate').length;
    expect(estatesInHand).toBeGreaterThan(0); // the probe trashes one
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Monastery') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH).sort()).toEqual(['Copper', 'Estate']);
    expect(count(state, INPLAY('p0'))).toBe(1); // Monastery; the Copper burned
    expect(names(state, INPLAY('p0'))).toEqual(['Monastery']);
  });

  it('with nothing gained this turn it does nothing at all', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Monastery'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Monastery') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, TRASH)).toBe(0);
  });
});

describe('Night Watchman', () => {
  it('is gained to the hand', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Night Watchman', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 3),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Night Watchman'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p0'))).toContain('Night Watchman');
    expect(count(state, DISCARD('p0'))).toBe(0);
  });

  it('looks at the top 5, discards some, and puts the rest back in a chosen order', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Night Watchman'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind === 'cards') return JSON.stringify(req.cardIds.slice(0, 2)); // discard 2
      if (req.kind === 'card') return req.cardIds[0]; // put back, first candidate each time
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    expect(count(state, DECK('p0'))).toBe(5);
    await toNight(engine, 'p0');
    state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Night Watchman') });
    state = engine.getState();
    expect(errors).toEqual([]);
    // 5 looked at: 2 discarded, 3 back on the deck (2 picks + 1 auto).
    expect(requests.map((r) => r.kind)).toEqual(['cards', 'card', 'card']);
    expect(count(state, DISCARD('p0'))).toBe(2);
    expect(count(state, DECK('p0'))).toBe(3);
    expect(count(state, 'dom_zone_look')).toBe(0);
    expect(names(state, INPLAY('p0'))).toEqual(['Night Watchman']);
  });
});

describe('Raider (Night - Duration - Attack)', () => {
  it('the victim discards a copy of an in-play card, then +$3 later', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Raider'), dealNamed('Copper'));
    const { engine, errors } = probeEngine(def, answerQueue(pickOne('Copper')));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    // A Copper into play — the raid's copy target.
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Copper'),
    });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Raider') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(4); // 5 - the raided Copper
    expect(names(state, DISCARD('p1'))).toEqual(['Copper']);
    expect(names(state, DURATION('p0'))).toEqual(['Raider']); // parked
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    await passTurn(engine, 'p1');

    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(names(state, INPLAY('p0'))).toEqual(['Raider']);
  });

  it("a victim with no copy reveals they can't and keeps their hand", async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Raider'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    // Nothing in play but the parked Raider itself — p1 holds no Raider.
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Raider') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(5); // untouched
    expect(state.log.some((l) => l.text.includes('no copy'))).toBe(true);
  });

  it('a revealed Moat blocks the raid', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Raider'), dealNamed('Copper'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Copper'),
    });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Raider') });
    await playOutWindows(engine, 'p1'); // p1 reveals the Moat
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(6); // 5 + the dealt Moat, untouched
    expect(count(state, DISCARD('p1'))).toBe(0);
  });
});

describe('Secret Cave (printed Action - Duration; Night here)', () => {
  it('+1 Card +1 Action; discarding 3 parks it for +$3 next turn', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Secret Cave'));
    const { engine, errors } = probeEngine(def, answerQueue(
      sayYes,
      (req) => {
        if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
        return JSON.stringify(req.cardIds.slice(0, 3));
      },
    ));
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Secret Cave') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 + 1 (unused at night)
    expect(count(state, HAND('p0'))).toBe(3); // 6 - SC + 1 drawn - 3 discarded
    expect(names(state, DURATION('p0'))).toEqual(['Secret Cave']);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    await passTurn(engine, 'p1');

    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(names(state, INPLAY('p0'))).toEqual(['Secret Cave']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });

  it('declining the discard leaves it out for a normal cleanup', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Secret Cave'));
    const { engine, errors } = probeEngine(def, answerQueue(sayNo));
    await engine.start();
    await toNight(engine, 'p0');
    let state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Secret Cave') });
    state = engine.getState();
    expect(names(state, INPLAY('p0'))).toEqual(['Secret Cave']);
    expect(count(state, DURATION('p0'))).toBe(0);
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(0); // no later half
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Vampire (Night - Attack)', () => {
  it('gains up to $5 (not a Vampire), exchanges itself for a Bat, and hexes through the window', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Vampire'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'pile') {
        const silver = req.cardIds.find((cid) => state.cards[cid].name === 'Silver');
        if (silver !== undefined) {
          // The gain window never offers a Vampire.
          expect(req.cardIds.map((cid) => state.cards[cid].name)).not.toContain('Vampire');
          return silver;
        }
      }
      return permissive(req); // agent A's hex content, once it lands
    });
    await engine.start();
    let state = engine.getState();
    const hexesBefore = count(state, HEX_ZONE) + count(state, HEX_USED_ZONE);
    await toNight(engine, 'p0');
    state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Vampire') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Silver');
    expect(names(state, DISCARD('p0'))).toContain('Bat');
    expect(names(state, SUPPLY)).toContain('Vampire'); // went home in the exchange
    expect(count(state, BAT_ZONE)).toBe(9);
    if (hexesBefore > 0) {
      // The real hex deck (agent A registered): one hex cycled to the used pile.
      expect(count(state, HEX_USED_ZONE)).toBeGreaterThan(0);
      expect(count(state, HEX_ZONE) + count(state, HEX_USED_ZONE)).toBe(hexesBefore);
    } else {
      expect(state.log.some((l) => l.text.includes('Hex deck is empty'))).toBe(true);
    }
  });
});

describe('Werewolf (Night - Attack; day mode dropped)', () => {
  it('hexes each other player at night; a revealed Moat stays safe', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Werewolf'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, permissive);
    await engine.start();
    let state = engine.getState();
    const usedBefore = count(state, HEX_USED_ZONE);
    await toNight(engine, 'p0');
    state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Werewolf') });
    await playOutWindows(engine, 'p1'); // p1 reveals the Moat
    state = engine.getState();
    expect(errors).toEqual([]);
    // The immune victim never receives: no hex cycled, no whiff announce.
    expect(count(state, HEX_USED_ZONE)).toBe(usedBefore);
    expect(state.log.some((l) => l.text.includes('receives the next Hex'))).toBe(false);
    expect(names(state, INPLAY('p0'))).toEqual(['Werewolf']); // no Duration half
  });

  it('an unshielded victim gets the receive (whiffing politely without agent A)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Werewolf'));
    const { engine, errors } = probeEngine(def, permissive);
    await engine.start();
    let state = engine.getState();
    const hexesBefore = count(state, HEX_ZONE) + count(state, HEX_USED_ZONE);
    await toNight(engine, 'p0');
    state = engine.getState();
    await engine.performAction('p0', { ...playNight, cardId: findNamed(state, HAND('p0'), 'Werewolf') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    if (hexesBefore > 0) {
      expect(count(state, HEX_USED_ZONE)).toBeGreaterThan(0);
    } else {
      expect(state.log.some((l) => l.text.includes('Hex deck is empty'))).toBe(true);
    }
  });
});

describe("Will-o'-Wisp (Action - Spirit)", () => {
  it('draws, then a cheap reveal joins the hand', async () => {
    const def = await freshDef();
    def.setup.push(
      fromSpirits("Will-o'-Wisp"),
      dealNamed('Estate', 'dom_zone_deck'), // beneath — the reveal, cost 2
      dealNamed('Copper', 'dom_zone_deck'), // top — drawn by the +1 Card
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), "Will-o'-Wisp") });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Wisp + Copper + Estate
    expect(names(state, HAND('p0'))).toContain('Estate');
  });

  it('an expensive reveal stays on the deck', async () => {
    const def = await freshDef();
    def.setup.push(
      fromSpirits("Will-o'-Wisp"),
      dealNamed('Gold', 'dom_zone_deck'), // beneath — the reveal, cost 6
      dealNamed('Copper', 'dom_zone_deck'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), "Will-o'-Wisp") });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // only the Copper drawn
    expect(topName(state, DECK('p0'))).toBe('Gold');
  });
});

describe('Imp (Action - Spirit)', () => {
  it('+2 Cards; offers only Actions with no copy in play, and plays one free', async () => {
    const def = await freshDef();
    def.setup.push(
      fromSpirits('Imp'),
      dealNamed('Village', 'dom_zone_inplay'), // a Village already in play
      dealNamed('Village'), // hand copy — must NOT be offered
      dealNamed('Smithy'), // no copy in play — offered
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
      const offered = req.cardIds.map((cid) => state.cards[cid].name);
      expect(offered).toContain('Smithy');
      expect(offered).not.toContain('Village');
      return JSON.stringify([req.cardIds.find((cid) => state.cards[cid].name === 'Smithy')!]);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Imp') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    // 8 dealt (5 + Imp + Village + Smithy) - Imp + 2 drawn - Smithy + 3 drawn = 11.
    expect(count(state, HAND('p0'))).toBe(11);
    expect(state.players[0].vars['dom_var_actions']).toBe(0); // Imp cost 1, Smithy free
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Imp', 'Smithy', 'Village']);
  });
});

describe('Ghost (printed Night - Duration - Spirit; Action here)', () => {
  it('digs to an Action, parks with it, and plays it twice next turn', async () => {
    const def = await freshDef();
    def.setup.push(
      fromSpirits('Ghost'),
      dealNamed('Village', 'dom_zone_deck'), // beneath — the seized Action
      dealNamed('Copper', 'dom_zone_deck'), // top — dug through
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Ghost') });
    state = engine.getState();
    expect(names(state, DURATION('p0')).sort()).toEqual(['Ghost', 'Village']);
    expect(names(state, DISCARD('p0'))).toEqual(['Copper']); // dug through
    expect(count(state, INPLAY('p0'))).toBe(0);
    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');

    // T3 (p0): the Village plays twice — +2 Cards, +4 Actions total.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(5); // 1 + 2 + 2
    expect(count(state, HAND('p0'))).toBe(7); // 5 redrawn + 1 + 1
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Ghost', 'Village']);
    expect(count(state, DURATION('p0'))).toBe(0);
  });

  it('finding no Action, it drifts on and is cleaned up normally', async () => {
    const def = await freshDef();
    def.setup.push(fromSpirits('Ghost')); // deck: only Coppers/Estates
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Ghost') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, INPLAY('p0'))).toEqual(['Ghost']); // never parked
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(count(state, DECK('p0'))).toBe(0); // dug through everything
  });
});

describe('Bat', () => {
  it('trashing at least one exchanges it for a Vampire', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Bat', 'dom_zone_hand', null, BAT_ZONE),
      dealNamed('Vampire', 'dom_zone_supply', null, 'dom_zone_reserve'),
      dealNamed('Copper'), dealNamed('Copper'),
    );
    const { engine, errors } = probeEngine(def, answerQueue(pickCards('Copper', 2)));
    await engine.start();
    const state0 = engine.getState();
    expect(count(state0, BAT_ZONE)).toBe(9); // one dealt out
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Bat') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Copper', 'Copper']);
    expect(names(state, DISCARD('p0'))).toEqual(['Vampire']);
    expect(names(state, SUPPLY)).not.toContain('Vampire');
    expect(count(state, BAT_ZONE)).toBe(10); // the Bat flew home
    expect(count(state, INPLAY('p0'))).toBe(0);
  });

  it('trashing nothing keeps the Bat', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Bat', 'dom_zone_hand', null, BAT_ZONE),
      dealNamed('Vampire', 'dom_zone_supply', null, 'dom_zone_reserve'),
    );
    const { engine, errors } = probeEngine(def, answerQueue((req) => {
      if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
      return JSON.stringify([]);
    }));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Bat') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, INPLAY('p0'))).toEqual(['Bat']);
    expect(names(state, SUPPLY)).toContain('Vampire'); // no exchange
    expect(count(state, DISCARD('p0'))).toBe(0);
  });
});

describe('Wish', () => {
  it('returns to its pile and gains a card to hand costing up to $6', async () => {
    const def = await freshDef();
    def.setup.push(dealNamed('Wish', 'dom_zone_hand', null, WISH_ZONE));
    const { engine, errors } = probeEngine(def, answerQueue(pickOne('Gold')));
    await engine.start();
    const state0 = engine.getState();
    expect(count(state0, WISH_ZONE)).toBe(11); // one dealt out
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Wish') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, WISH_ZONE)).toBe(12); // flew home
    expect(names(state, HAND('p0'))).toContain('Gold'); // gained TO HAND
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Wish + Gold
    expect(count(state, INPLAY('p0'))).toBe(0);
  });
});
