/**
 * Nocturne (Boons half) — deterministic per-card probes through the REAL
 * engine: the Boon/Hex receive contract (the fate zone + receiver stamp),
 * the deck flip with its reshuffle-from-used, every Boon and every Hex at
 * least once, Skulk's hexing through a Moat-able response window, the
 * States (Deluded/Envious cleared at the Buy phase, Envious's exact $1
 * Silver/Gold rule, Lost in the Woods' turn-start offer), Misery's exact
 * -2/-4 VP scoring, Druid's never-rotating set-aside Boons, and the Spirit
 * stock (Will-o'-Wisp / Imp).
 *
 * Determinism: probes stack the Boon/Hex decks by reordering a named card
 * to the top with a same-zone dealNamed (a same-instance move — no events),
 * AFTER the setup shuffle has run (test setup blocks append to def.setup).
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time — so the
 * module is pushed into EXPANSIONS here and buildDominionDef is loaded via
 * dynamic import afterwards (the adventuresB precedent). Once the
 * integrator registers nocturneBoons (BEFORE the other Nocturne modules,
 * which consume the receive contract and state vars declared here),
 * freshDef() can become a plain static import.
 */
import { describe, expect, it } from 'vitest';
import type {
  ChoiceAnswer, ChoiceRequest, EngineHandle, GameDef, GameState,
} from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import {
  BLESSED_VAR, BOON_USED_ZONE, BOON_ZONE, DRUID_ZONE, HEX_USED_ZONE, HEX_ZONE, RIVER_VAR,
  SPIRIT_ZONE, STATE_DELUDED, STATE_ENVIOUS, STATE_LOST_IN_WOODS, STATE_MISERABLE,
  STATE_TWICE_MISERABLE, nocturneBoons,
} from './nocturneBoons';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

if (!EXPANSIONS.includes(nocturneBoons)) EXPANSIONS.push(nocturneBoons);
/** buildDominionDef AFTER registration (see the header note). */
async function freshDef(): Promise<GameDef> {
  const { buildDominionDef } = await import('../dominionGame');
  return buildDominionDef();
}

const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';
const VP = 'dom_var_vp';

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
/** Top of a stack zone = the END of the cardIds array. */
const topName = (state: GameState, zoneKey: string): string | undefined =>
  names(state, zoneKey).at(-1);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');
/** Reorder a named Boon/Hex to the top of its (already shuffled) deck —
 *  a same-instance move, so no events fire. */
const stackBoon = (name: string) => dealNamed(name, BOON_ZONE, null, BOON_ZONE);
const stackHex = (name: string) => dealNamed(name, HEX_ZONE, null, HEX_ZONE);

/** Setup block: set a per-player number variable (coins for buy probes). */
const giveVar = (varId: string, playerId: string, value: number): GameDef['setup'][number] =>
  ({ kind: 'setVar', varId, target: { kind: 'str', value: playerId }, value: { kind: 'num', value } });

const play = { actionId: 'dom_action_play' };
const noChoices = () => { throw new Error('no choices expected'); };

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

/** Answer a 'cards' request with its first `min` candidates. */
const pickMin = (req: ChoiceRequest): ChoiceAnswer => {
  if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
  return JSON.stringify(req.cardIds.slice(0, req.min));
};
/** Answer a 'cards' request with the first N candidates of the given name. */
const pickNamedCards = (name: string, n: number) =>
  (req: ChoiceRequest, state: GameState): ChoiceAnswer => {
    if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
    const ids = req.cardIds.filter((id) => state.cards[id].name === name).slice(0, n);
    if (ids.length !== n) throw new Error(`wanted ${n} × ${name}`);
    return JSON.stringify(ids);
  };
/** Answer a 'cards' request with its first N candidates (N may exceed min). */
const pickFirstCards = (n: number) => (req: ChoiceRequest): ChoiceAnswer => {
  if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
  return JSON.stringify(req.cardIds.slice(0, n));
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
const sayYes = (req: ChoiceRequest): ChoiceAnswer => {
  if (req.kind !== 'yesNo') throw new Error(`expected yesNo, got ${req.kind}`);
  return true;
};
const sayNo = (req: ChoiceRequest): ChoiceAnswer => {
  if (req.kind !== 'yesNo') throw new Error(`expected yesNo, got ${req.kind}`);
  return false;
};
/** Safe fallback for probes whose exact boon is irrelevant: decline what can
 *  be declined, satisfy every minimum with the first candidates. */
const generic = (req: ChoiceRequest): ChoiceAnswer => {
  switch (req.kind) {
    case 'yesNo': return false;
    case 'option': return req.options[0].id;
    case 'cards': return JSON.stringify(req.cardIds.slice(0, req.min));
    case 'card': case 'pile': return req.cardIds[0];
    default: throw new Error(`unexpected ${req.kind} choice`);
  }
};

/** Action → Buy → Cleanup → the turn passes (nothing gets played). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

/** Deal a Bard, stack the named Boon on top, play the Bard. */
async function bardBoon(
  boonName: string,
  extraSetup: GameDef['setup'][number][] = [],
  answer?: (req: ChoiceRequest, state: GameState) => ChoiceAnswer,
): Promise<{ engine: EngineHandle; errors: string[] }> {
  const def = await freshDef();
  def.setup.push(fromReserve('Bard'), stackBoon(boonName), ...extraSetup);
  const { engine, errors } = probeEngine(def, answer ?? noChoices);
  await engine.start();
  const state0 = engine.getState();
  await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Bard') });
  return { engine, errors };
}

/** Deal a Skulk, stack the named Hex, play the Skulk through its window. */
async function skulkHex(
  hexName: string,
  extraSetup: GameDef['setup'][number][] = [],
  answer?: (req: ChoiceRequest, state: GameState) => ChoiceAnswer,
  revealMoatFor: string | null = null,
): Promise<{ engine: EngineHandle; errors: string[] }> {
  const def = await freshDef();
  def.setup.push(fromReserve('Skulk'), stackHex(hexName), ...extraSetup);
  const { engine, errors } = probeEngine(def, answer ?? noChoices);
  await engine.start();
  const state0 = engine.getState();
  await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Skulk') });
  await playOutWindows(engine, revealMoatFor);
  return { engine, errors };
}

describe('nocturneBoons module registration', () => {
  it('validates clean and knows all piles, decks, types and tags', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Druid: 2, Pixie: 2, Tracker: 2, Fool: 3, Bard: 4, 'Blessed Village': 4,
      Skulk: 4, 'Cursed Village': 5, Idol: 5, 'Sacred Grove': 5, Tormentor: 5,
    };
    const deck = def.decks.find((d) => d.id === 'dom_deck_kingdom')!;
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
      if (deck.source.kind === 'custom') {
        const entry = deck.source.entries.find((en) => en.cardId === card!.id);
        expect(entry, `${name} in the kingdom deck`).toBeDefined();
        expect(entry!.count).toBe(10);
      }
    }
    // Idol is the module's Treasure (coin field 2); the three hex/curse
    // givers wear the Attack tag.
    const idol = def.cards.find((c) => c.name === 'Idol')!;
    expect(idol.typeId).toBe('dom_type_treasure');
    expect(idol.fields['dom_field_coins']).toBe(2);
    for (const name of ['Skulk', 'Tormentor', 'Idol']) {
      expect(def.cards.find((c) => c.name === name)!.tags, `${name} is an Attack`)
        .toContain('dom_tag_attack');
    }
    // Boon/Hex decks: 12 single copies each, spawned into their zones.
    const boons = def.decks.find((d) => d.id === 'dom_deck_ns_nocturneBoons_0')!;
    expect(boons.initialZone).toBe(BOON_ZONE);
    if (boons.source.kind === 'custom') {
      expect(boons.source.entries).toHaveLength(12);
      for (const en of boons.source.entries) expect(en.count).toBe(1);
    }
    const hexes = def.decks.find((d) => d.id === 'dom_deck_ns_nocturneBoons_1')!;
    expect(hexes.initialZone).toBe(HEX_ZONE);
    if (hexes.source.kind === 'custom') expect(hexes.source.entries).toHaveLength(12);
    // Spirit stock: Will-o'-Wisp 12, Imp 13 — the ZONE + spawns belong to
    // nocturneNight after integration; this module keeps the card DEFS.
    const spirits = def.decks.find((d) =>
      d.initialZone === SPIRIT_ZONE && d.source.kind === 'custom'
      && d.source.entries.some((en) => en.cardId === def.cards.find((c) => c.name === 'Imp')!.id))!;
    expect(spirits).toBeTruthy();
    if (spirits.source.kind === 'custom') {
      const wow = def.cards.find((c) => c.name === "Will-o'-Wisp")!;
      const imp = def.cards.find((c) => c.name === 'Imp')!;
      expect(spirits.source.entries.find((en) => en.cardId === wow.id)!.count).toBe(12);
      expect(spirits.source.entries.find((en) => en.cardId === imp.id)!.count).toBe(13);
    }
    // The receive contract's plumbing exists: per-player fate zone + stamp.
    expect(def.zones.find((z) => z.id === 'dom_zone_fate')!.owner).toBe('perPlayer');
    expect(def.triggers.some((t) => t.id === 'dom_trigger_noct_fate_receiver')).toBe(true);
  });
});

describe('Bard and the Boon deck', () => {
  it("receives The Sea's Gift: +$2, +1 Card, the Boon rests in the used pile", async () => {
    const { engine, errors } = await bardBoon("The Sea's Gift");
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Bard + 1
    expect(names(state, BOON_USED_ZONE)).toEqual(["The Sea's Gift"]);
    expect(count(state, BOON_ZONE)).toBe(11);
  });

  it('reshuffles the used pile back into an empty Boon deck', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Bard'), {
      kind: 'moveCards',
      from: { zoneId: BOON_ZONE, owner: null },
      to: { zoneId: BOON_USED_ZONE, owner: null },
      cards: { kind: 'all' },
      toPosition: 'top',
      faceUp: true,
    });
    const { engine, errors } = probeEngine(def, generic);
    await engine.start();
    expect(count(engine.getState(), BOON_ZONE)).toBe(0); // drained
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Bard') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // The 12 shuffled back in, 1 flipped and received, resting in used.
    expect(count(state, BOON_ZONE)).toBe(11);
    expect(count(state, BOON_USED_ZONE)).toBe(1);
  });
});

describe('the twelve Boons', () => {
  it("The Field's Gift: +1 Action, +$1", async () => {
    const { engine, errors } = await bardBoon("The Field's Gift");
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(state.players[0].vars['dom_var_coins']).toBe(3); // 2 + 1
  });

  it("The Forest's Gift: +1 Buy, +$1", async () => {
    const { engine, errors } = await bardBoon("The Forest's Gift");
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
  });

  it("The Earth's Gift: discard a Treasure to gain a card costing up to $4", async () => {
    const { engine, errors } = await bardBoon("The Earth's Gift",
      [dealNamed('Silver')],
      answerQueue(pickNamedCards('Silver', 1), pickOne('Smithy')));
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Silver');
    expect(names(state, DISCARD('p0'))).toContain('Smithy');
  });

  it("The Flame's Gift: may trash a card from hand", async () => {
    const { engine, errors } = await bardBoon("The Flame's Gift", [],
      answerQueue(pickNamedCards('Copper', 1)));
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Copper']);
  });

  it("The Moon's Gift: a discard-pile card returns to the deck top", async () => {
    const { engine, errors } = await bardBoon("The Moon's Gift",
      [dealNamed('Silver', 'dom_zone_discard', 'p0')],
      answerQueue(pickNamedCards('Silver', 1)));
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(topName(state, DECK('p0'))).toBe('Silver');
    expect(count(state, DECK('p0'))).toBe(6);
    expect(count(state, DISCARD('p0'))).toBe(0);
  });

  it("The Mountain's Gift: gain a Silver", async () => {
    const { engine, errors } = await bardBoon("The Mountain's Gift");
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(['Silver']);
  });

  it("The River's Gift: +1 Card at the end of this turn (a 6-card next hand)", async () => {
    const { engine, errors } = await bardBoon("The River's Gift");
    let state = engine.getState();
    expect(state.players[0].vars[RIVER_VAR]).toBe(1);
    expect(count(state, HAND('p0'))).toBe(5); // nothing yet
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + the river's card
    expect(state.players[0].vars[RIVER_VAR]).toBe(0);
  });

  it("The Sky's Gift: discard 3 cards to gain a Gold", async () => {
    const { engine, errors } = await bardBoon("The Sky's Gift", [],
      answerQueue(sayYes, pickMin));
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(2); // 6 - Bard - 3
    expect(names(state, DISCARD('p0'))).toContain('Gold');
    expect(count(state, DISCARD('p0'))).toBe(4); // 3 discards + the Gold
  });

  it("The Sun's Gift: look at the top 4, discard some, the rest go back", async () => {
    const { engine, errors } = await bardBoon("The Sun's Gift", [],
      answerQueue(pickFirstCards(2)));
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DISCARD('p0'))).toBe(2);
    expect(count(state, DECK('p0'))).toBe(3); // 5 - 4 looked + 2 returned
  });

  it("The Swamp's Gift: gain a Will-o'-Wisp from the Spirit stock", async () => {
    const { engine, errors } = await bardBoon("The Swamp's Gift");
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toEqual(["Will-o'-Wisp"]);
    expect(names(state, SPIRIT_ZONE).filter((n) => n === "Will-o'-Wisp")).toHaveLength(11);
  });

  it("The Wind's Gift: +2 Cards, discard 2", async () => {
    const { engine, errors } = await bardBoon("The Wind's Gift", [],
      answerQueue(pickMin));
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - Bard + 2 - 2
    expect(count(state, DISCARD('p0'))).toBe(2);
  });
});

describe('Blessed Village', () => {
  it('+1 Card +2 Actions on play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Blessed Village'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Blessed Village') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
  });

  it('bought, Boon received NOW', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Blessed Village', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 4),
      stackBoon("The Sea's Gift"),
    );
    const { engine, errors } = probeEngine(def, answerQueue(pickOption('bv_now')));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Blessed Village'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Blessed Village');
    expect(count(state, HAND('p0'))).toBe(6); // 5 + the Sea's Gift draw
    expect(names(state, BOON_USED_ZONE)).toEqual(["The Sea's Gift"]);
  });

  it('bought, Boon deferred to the start of the next turn', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Blessed Village', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 4),
      stackBoon("The Sea's Gift"),
    );
    const { engine, errors } = probeEngine(def, answerQueue(pickOption('bv_later')));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Blessed Village'),
    });
    state = engine.getState();
    expect(state.players[0].vars[BLESSED_VAR]).toBe(1);
    expect(count(state, BOON_USED_ZONE)).toBe(0); // nothing flipped yet
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars[BLESSED_VAR]).toBe(0);
    expect(count(state, HAND('p0'))).toBe(6); // 5 redrawn + the deferred Sea's Gift
    expect(names(state, BOON_USED_ZONE)).toEqual(["The Sea's Gift"]);
  });
});

describe('Druid', () => {
  it('sets aside 3 Boons at setup and receives one, leaving it there', async () => {
    const { buildDominionDef, pickKingdom } = await import('../dominionGame');
    const def = pickKingdom(buildDominionDef(), [
      'Druid', 'Bard', 'Village', 'Smithy', 'Market',
      'Festival', 'Laboratory', 'Woodcutter', 'Militia', 'Moat',
    ]);
    def.setup.push(dealNamed('Druid'));
    const { engine, errors } = probeEngine(def, generic);
    await engine.start();
    let state = engine.getState();
    expect(count(state, DRUID_ZONE)).toBe(3);
    expect(count(state, BOON_ZONE)).toBe(9);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Druid') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    // The received Boon fired from the fate zone and RETURNED — never rotates.
    expect(count(state, DRUID_ZONE)).toBe(3);
    expect(count(state, BOON_USED_ZONE)).toBe(0);
  });
});

describe('Fool and Lost in the Woods', () => {
  it('takes Lost in the Woods and receives 3 Boons; the state offers a Boon each turn', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Fool'),
      stackBoon("The Forest's Gift"), stackBoon("The Field's Gift"), stackBoon("The Sea's Gift"),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards' && req.prompt.startsWith('Lost in the Woods')) {
        return JSON.stringify(req.cardIds.slice(0, 1));
      }
      return generic(req);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Fool') });
    state = engine.getState();
    expect(state.players[0].vars[STATE_LOST_IN_WOODS]).toBe(1);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Fool + Sea's draw
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + Field's
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // Field's + Forest's
    expect(state.players[0].vars['dom_var_buys']).toBe(2); // 1 + Forest's
    expect(count(state, BOON_USED_ZONE)).toBe(3);

    // Next p0 turn: Lost in the Woods — discard a card, receive a Boon.
    await passTurn(engine, 'p0');
    await passTurn(engine, 'p1');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars[STATE_LOST_IN_WOODS]).toBe(1); // it lingers
    expect(count(state, BOON_USED_ZONE)).toBe(4); // a 4th Boon received
  });
});

describe('Idol (Treasure - Attack - Fate)', () => {
  it('an odd number of Idols in play receives a Boon', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Idol'), stackBoon("The Sea's Gift"));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Idol'),
    });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Idol + Sea's draw
    expect(names(state, BOON_USED_ZONE)).toEqual(["The Sea's Gift"]);
    expect(names(state, DISCARD('p1'))).not.toContain('Curse');
  });

  it('an even number of Idols curses the opponent instead', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Idol'), fromReserve('Idol'), stackBoon("The Sea's Gift"));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Idol'),
    });
    await playOutWindows(engine);
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Idol'),
    });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(4);
    expect(names(state, DISCARD('p1'))).toContain('Curse');
    expect(count(state, BOON_USED_ZONE)).toBe(1); // only the first (odd) play
  });
});

describe('Pixie', () => {
  it('discards the top Boon; trashing the Pixie receives it twice', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Pixie'), stackBoon("The Sea's Gift"));
    const { engine, errors } = probeEngine(def, answerQueue(sayYes));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Pixie') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Pixie']);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Pixie + 1 + Sea's twice
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(names(state, BOON_USED_ZONE)).toEqual(["The Sea's Gift"]);
    expect(count(state, BOON_ZONE)).toBe(11);
  });

  it('declining keeps the Pixie and the Boon stays unreceived', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Pixie'), stackBoon("The Sea's Gift"));
    const { engine, errors } = probeEngine(def, answerQueue(sayNo));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Pixie') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, INPLAY('p0'))).toEqual(['Pixie']);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Pixie + 1 drawn, no receive
    expect(names(state, BOON_USED_ZONE)).toEqual(["The Sea's Gift"]); // flipped only
  });
});

describe('Sacred Grove', () => {
  it('shares a non-+$1 Boon with a willing opponent', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Sacred Grove'), stackBoon("The Sea's Gift"));
    const { engine, errors } = probeEngine(def, answerQueue(sayYes));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Sacred Grove') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Grove + their Sea's draw
    expect(count(state, HAND('p1'))).toBe(6); // 5 + the shared Sea's draw
    expect(names(state, BOON_USED_ZONE)).toEqual(["The Sea's Gift"]);
  });

  it('keeps a +$1 Boon to itself (no share offer)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Sacred Grove'), stackBoon("The Field's Gift"));
    const { engine, errors } = probeEngine(def, noChoices); // proves: no ask
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Sacred Grove') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(4); // 3 + Field's
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + Field's
    expect(count(state, HAND('p1'))).toBe(5); // untouched
  });
});

describe('Tracker', () => {
  it('+$1 and a Boon on play; while in play, gains may be topdecked', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Tracker'), stackBoon("The Field's Gift"));
    const { engine, errors } = probeEngine(def, answerQueue(sayYes));
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Tracker') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(2); // 1 + Field's
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Copper'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(topName(state, DECK('p0'))).toBe('Copper'); // tracked onto the deck
    expect(names(state, DISCARD('p0'))).not.toContain('Copper');
  });
});

describe('Cursed Village', () => {
  it('+2 Actions, draw until 6 cards in hand', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Cursed Village'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Cursed Village') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    expect(count(state, HAND('p0'))).toBe(6); // drew back up to 6
    expect(count(state, DECK('p0'))).toBe(4);
  });

  it('gaining it receives a Hex (Poverty: discard down to 3)', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Cursed Village', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 5),
      stackHex('Poverty'),
    );
    const { engine, errors } = probeEngine(def, answerQueue(pickMin));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Cursed Village'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(3); // Poverty bit the buyer
    expect(names(state, HEX_USED_ZONE)).toEqual(['Poverty']);
    expect(names(state, DISCARD('p0'))).toContain('Cursed Village');
  });
});

describe('Skulk (Attack - Doom)', () => {
  it('hexes the opponent through a passed window (Poverty)', async () => {
    const { engine, errors } = await skulkHex('Poverty', [], (req) => pickMin(req));
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(count(state, HAND('p1'))).toBe(3);
    expect(count(state, DISCARD('p1'))).toBe(2);
    expect(names(state, HEX_USED_ZONE)).toEqual(['Poverty']);
  });

  it('a revealed Moat waves the Hex off entirely', async () => {
    const { engine, errors } = await skulkHex('Poverty',
      [dealNamed('Moat', 'dom_zone_hand', 'p1')], noChoices, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HEX_ZONE)).toBe(12); // nothing flipped
    expect(count(state, HEX_USED_ZONE)).toBe(0);
    expect(count(state, HAND('p1'))).toBe(6); // 5 + Moat, untouched
  });

  it('gaining a Skulk gains a Gold', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Skulk', 'dom_zone_supply', null, 'dom_zone_reserve'),
      giveVar('dom_var_coins', 'p0', 4),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Skulk'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Skulk');
    expect(names(state, DISCARD('p0'))).toContain('Gold');
  });
});

describe('Tormentor (Attack - Doom)', () => {
  it('alone in play: +$2 and an Imp from its pile, no Hex', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Tormentor'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Tormentor') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, DISCARD('p0'))).toEqual(['Imp']);
    expect(names(state, SPIRIT_ZONE).filter((n) => n === 'Imp')).toHaveLength(12);
    expect(count(state, HEX_USED_ZONE)).toBe(0);
  });

  it('with another card in play: the opponent receives the next Hex (Greed)', async () => {
    const def = await freshDef();
    def.setup.push(
      fromReserve('Tormentor'), fromReserve('Tormentor'),
      giveVar('dom_var_actions', 'p0', 2),
      stackHex('Greed'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Tormentor') });
    await playOutWindows(engine);
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Tormentor') });
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(4);
    expect(names(state, DISCARD('p0'))).toEqual(['Imp']); // the first, alone
    expect(names(state, HEX_USED_ZONE)).toEqual(['Greed']); // the second hexed
    expect(topName(state, DECK('p1'))).toBe('Copper'); // Greed's deck-top Copper
    expect(count(state, DECK('p1'))).toBe(6);
  });
});

describe('the Spirits', () => {
  it("Will-o'-Wisp: +1 Card +1 Action, a cheap reveal joins the hand", async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed("Will-o'-Wisp", 'dom_zone_hand', null, SPIRIT_ZONE),
      dealNamed('Estate', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'), // top: drawn by the +1 Card
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), "Will-o'-Wisp") });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Wisp + Copper + Estate ($2 reveal)
    expect(count(state, DECK('p0'))).toBe(5);
  });

  it("Imp: +2 Cards, plays a hand Action with no copy in play, free", async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Imp', 'dom_zone_hand', null, SPIRIT_ZONE),
      dealNamed('Village'),
    );
    const { engine, errors } = probeEngine(def, answerQueue((req, state) => {
      if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
      const village = req.cardIds.find((id) => state.cards[id].name === 'Village');
      if (village === undefined) throw new Error('Village not offered');
      return JSON.stringify([village]);
    }));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Imp') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, INPLAY('p0'))).toEqual(expect.arrayContaining(['Imp', 'Village']));
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - Imp + Village's 2
    expect(count(state, HAND('p0'))).toBe(8); // 7 - Imp + 2 - Village + 1
  });
});

describe('the twelve Hexes', () => {
  it('Bad Omens: the deck collapses; 2 Coppers come back on top', async () => {
    const { engine, errors } = await skulkHex('Bad Omens');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DECK('p1'))).toBe(2);
    expect(names(state, DECK('p1'))).toEqual(['Copper', 'Copper']);
    expect(count(state, DISCARD('p1'))).toBe(3);
  });

  it('Delusion: takes Deluded; it returns at the Buy phase', async () => {
    const { engine, errors } = await skulkHex('Delusion');
    let state = engine.getState();
    expect(state.players[1].vars[STATE_DELUDED]).toBe(1);
    await passTurn(engine, 'p0');
    await engine.performAction('p1', { actionId: 'dom_action_done' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[1].vars[STATE_DELUDED]).toBe(0);
    expect(state.log.some((l) => l.text.includes('returns Deluded'))).toBe(true);
  });

  it('Envy: takes Envious; on return, Silver makes only $1', async () => {
    const { engine, errors } = await skulkHex('Envy',
      [dealNamed('Silver', 'dom_zone_hand', 'p1')]);
    let state = engine.getState();
    expect(state.players[1].vars[STATE_ENVIOUS]).toBe(1);
    await passTurn(engine, 'p0');
    await engine.performAction('p1', { actionId: 'dom_action_done' });
    state = engine.getState();
    expect(state.players[1].vars[STATE_ENVIOUS]).toBe(0); // returned
    await engine.performAction('p1', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p1'), 'Silver'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[1].vars['dom_var_coins']).toBe(1); // $2 - the envy
  });

  it('Famine: reveals 3, discards the Actions, shuffles the rest back', async () => {
    const { engine, errors } = await skulkHex('Famine',
      [dealNamed('Militia', 'dom_zone_deck', 'p1')]);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p1'))).toEqual(['Militia']);
    expect(count(state, DECK('p1'))).toBe(5); // 6 - 3 revealed + 2 back
  });

  it('Fear: with 5 cards in hand, an Action or Treasure is discarded', async () => {
    const { engine, errors } = await skulkHex('Fear', [], (req) => pickMin(req));
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(4);
    expect(count(state, DISCARD('p1'))).toBe(1);
  });

  it('Haunting: with 4+ cards in hand, one goes back on the deck', async () => {
    const { engine, errors } = await skulkHex('Haunting', [], (req) => pickMin(req));
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(4);
    expect(count(state, DECK('p1'))).toBe(6);
  });

  it('Locusts: a trashed Copper grows a Curse', async () => {
    const { engine, errors } = await skulkHex('Locusts',
      [dealNamed('Copper', 'dom_zone_deck', 'p1')]);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(names(state, DISCARD('p1'))).toContain('Curse');
  });

  it('Misery: the first Misery is worth -2 VP, exactly', async () => {
    const { engine, errors } = await skulkHex('Misery');
    let state = engine.getState();
    expect(state.players[1].vars[STATE_MISERABLE]).toBe(1);
    expect(state.players[1].vars[STATE_TWICE_MISERABLE]).toBe(0);
    await passTurn(engine, 'p0'); // the turn-end recount scores it
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[1].vars[VP]).toBe(1); // 3 Estates - 2
    expect(state.players[0].vars[VP]).toBe(3);
  });

  it('Misery again: flips to Twice Miserable, worth -4 VP, exactly', async () => {
    const { engine, errors } = await skulkHex('Misery',
      [giveVar(STATE_MISERABLE, 'p1', 1)]);
    let state = engine.getState();
    expect(state.players[1].vars[STATE_MISERABLE]).toBe(0);
    expect(state.players[1].vars[STATE_TWICE_MISERABLE]).toBe(1);
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[1].vars[VP]).toBe(-1); // 3 Estates - 4
  });

  it('Plague: a Curse lands in the hand', async () => {
    const { engine, errors } = await skulkHex('Plague');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p1'))).toContain('Curse');
    expect(count(state, HAND('p1'))).toBe(6);
  });

  it('War: reveals until a $3-$4 card falls; the rest are discarded', async () => {
    const { engine, errors } = await skulkHex('War', [
      dealNamed('Silver', 'dom_zone_deck', 'p1'), // revealed second, cost 3 — trashed
      dealNamed('Estate', 'dom_zone_deck', 'p1'), // top: revealed first, passed over
    ]);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(names(state, DISCARD('p1'))).toEqual(['Estate']);
    expect(count(state, DECK('p1'))).toBe(5);
  });

  it('Greed is exact (probed via Tormentor) and Delusion/Envy stay exclusive', async () => {
    // A Deluded player receiving Envy keeps Deluded and does NOT take Envious.
    const { engine, errors } = await skulkHex('Envy',
      [giveVar(STATE_DELUDED, 'p1', 1)]);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[1].vars[STATE_DELUDED]).toBe(1);
    expect(state.players[1].vars[STATE_ENVIOUS]).toBe(0);
    expect(names(state, HEX_USED_ZONE)).toEqual(['Envy']);
  });
});
