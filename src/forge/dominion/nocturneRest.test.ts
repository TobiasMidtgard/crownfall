/**
 * Nocturne (the rest) — deterministic per-card probes through the REAL
 * engine: the heirloom swap (positive via Tracker/Pooka piles, negative on a
 * plain kingdom), the Zombies seeded into the trash with Necromancer,
 * Necromancer playing trash Zombies in place (with the once-per-turn mark
 * and its cleanup reset), Cemetery's on-gain trash, Pasture's recount term,
 * Leprechaun's Gold/Wish/self-Hex branches, and every heirloom's play
 * moment.
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time (pile
 * catalogue, type lines, card-id map) — so the module is pushed into
 * EXPANSIONS here and buildDominionDef is loaded via dynamic import
 * afterwards (the adventuresB precedent).
 *
 * SIBLING STUBS: nocturneRest references agent A's Hex zones
 * (dom_zone_hexes / dom_zone_hexes_used / dom_zone_fate, plus the Fool /
 * Pixie / Tracker piles for the heirloom gates) and agent B's stocks
 * (dom_zone_wishes / dom_zone_ghosts). While those modules are mid-flight,
 * THIS SUITE registers guarded stand-ins (zones + inert stock cards + a
 * plain Tracker pile) — the merged def cannot validate without the zone
 * declarations. Once nocturneBoons / nocturneNight land in expansions.ts
 * the stubs become no-ops and can be deleted; the Hex probe keeps its
 * strict assertions for stub mode only and stays permissive against A's
 * real Hex effects.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceAnswer, ChoiceRequest, EngineHandle, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import type { ExpansionModule } from './kit';
import {
  GHOST_ZONE, HEIRLOOM_ZONE, HEX_USED_ZONE, HEX_ZONE, HOUND_MARK, NECRO_MARK, WISH_ZONE,
  ZOMBIE_ZONE, nocturneRest,
} from './nocturneRest';
import { dealNamed, findNamed, probeEngine } from './testKit';

/** Zones-and-stock stand-in for agent A's nocturneBoons module (header). */
const boonsStub: ExpansionModule = {
  id: 'nocturneBoonsStub',
  piles: [
    // A plain Tracker pile so the Pouch swap probe has its kingdom gate.
    { name: 'Tracker', cost: 2, count: 10 },
  ],
  ids: { Tracker: 'dom_card_stub_tracker', 'Stub Hex': 'dom_card_stub_hex' },
  buildCards: (kit) => [
    kit.cardDef('dom_card_stub_tracker', 'Tracker', 2, 0, 0,
      '(Stand-in for the nocturneBoons pile — the real card is on its way.)'),
    kit.cardDef('dom_card_stub_hex', 'Stub Hex', 0, 0, 0,
      '(Stand-in Hex with no effect.)'),
  ],
  zones: [
    { id: HEX_ZONE, name: 'Hexes', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
    { id: HEX_USED_ZONE, name: 'Hexes (used)', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
    { id: 'dom_zone_fate', name: 'Fate', owner: 'shared', visibility: 'all', layout: 'row', area: 'center' },
  ],
  nonSupply: [
    { zoneId: HEX_ZONE, piles: [{ name: 'Stub Hex', cost: 0, count: 3 }] },
  ],
};

/** Stock stand-in for agent B's nocturneNight module (Wish/Ghost stocks). */
const nightStub: ExpansionModule = {
  id: 'nocturneNightStub',
  piles: [],
  ids: { Wish: 'dom_card_stub_wish', Ghost: 'dom_card_stub_ghost' },
  buildCards: (kit) => [
    kit.cardDef('dom_card_stub_wish', 'Wish', 0, 0, 0, '(Stand-in Wish with no effect.)'),
    kit.cardDef('dom_card_stub_ghost', 'Ghost', 4, 0, 0, '(Stand-in Ghost with no effect.)'),
  ],
  zones: [
    { id: WISH_ZONE, name: 'Wishes', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
    { id: GHOST_ZONE, name: 'Ghosts', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
  ],
  nonSupply: [
    { zoneId: WISH_ZONE, piles: [{ name: 'Wish', cost: 0, count: 12 }] },
    { zoneId: GHOST_ZONE, piles: [{ name: 'Ghost', cost: 4, count: 6 }] },
  ],
};

const hexesDeclared = EXPANSIONS.some((x) => (x.zones ?? []).some((z) => z.id === HEX_ZONE));
const stocksDeclared = EXPANSIONS.some((x) => (x.zones ?? []).some((z) => z.id === WISH_ZONE));
if (!hexesDeclared) EXPANSIONS.push(boonsStub);
if (!stocksDeclared) EXPANSIONS.push(nightStub);
if (!EXPANSIONS.includes(nocturneRest)) EXPANSIONS.push(nocturneRest);
/** True while agent A's real Hexes are absent (strict hex assertions apply). */
const usingBoonsStub = !hexesDeclared;

/** buildDominionDef AFTER registration; optional kingdom pick. */
async function freshDef(kingdom?: string[]): Promise<GameDef> {
  const mod = await import('../dominionGame');
  const def = mod.buildDominionDef();
  return kingdom ? mod.pickKingdom(def, kingdom) : def;
}

/** Ten-card kingdom: the targets up front, base fillers behind. */
const FILLERS = ['Moat', 'Village', 'Smithy', 'Militia', 'Market', 'Cellar', 'Chapel', 'Workshop', 'Mine', 'Witch'];
const kingdomWith = (...targets: string[]): string[] =>
  [...targets, ...FILLERS.filter((f) => !targets.includes(f))].slice(0, 10);

const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const DURATION = (p: string) => `dom_zone_duration:${p}`;
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');
const fromStock = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, HEIRLOOM_ZONE);

/** Setup block: set a per-player number variable (coins/actions for probes). */
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
/** Decline a min-0 'cards' request. */
const declineCards = (req: ChoiceRequest): ChoiceAnswer => {
  if (req.kind !== 'cards') throw new Error(`expected cards, got ${req.kind}`);
  return JSON.stringify([]);
};
/** Best-effort answer for foreign prompts (agent A's live Hex effects). */
const permissive = (req: ChoiceRequest): ChoiceAnswer => {
  switch (req.kind) {
    case 'yesNo': return false;
    case 'option': return req.options[0].id;
    case 'cards': return JSON.stringify(req.cardIds.slice(0, req.min));
    case 'player': return req.playerIds[0];
    default: return req.cardIds[0];
  }
};

/** Action → Buy → (auto-skipped Night, if a sibling shipped one) → Cleanup. */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

describe('nocturneRest module registration', () => {
  it('validates clean and knows the piles, heirlooms and zombies', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);

    const costs: Record<string, number> = {
      'Faithful Hound': 2, Leprechaun: 3, Cemetery: 4, Conclave: 4,
      Necromancer: 4, Shepherd: 4, Pooka: 5, 'Tragic Hero': 5,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.tags).toContain('dom_tag_kingdom');
    }
    // Cemetery is the module's Victory card (printed VP 2 on the field).
    expect(def.cards.find((c) => c.name === 'Cemetery')!.typeId).toBe('dom_type_victory');
    expect(def.cards.find((c) => c.name === 'Cemetery')!.fields['dom_field_vp']).toBe(2);
    // LEPRECHAUN IS ACTION – DOOM (verified — not a Night card, not an
    // Attack: the Hex is self-inflicted).
    expect(def.cards.find((c) => c.name === 'Leprechaun')!.typeId).toBe('dom_type_action');
    expect(def.cards.find((c) => c.name === 'Leprechaun')!.tags).not.toContain('dom_tag_attack');
    // Faithful Hound is the one Reaction.
    expect(def.cards.find((c) => c.name === 'Faithful Hound')!.tags).toContain('dom_tag_reaction');

    // The seven heirlooms: Treasure-typed non-supply with their coin fields.
    const heirlooms: Record<string, { cost: number; coins: number }> = {
      'Haunted Mirror': { cost: 0, coins: 1 },
      'Lucky Coin': { cost: 4, coins: 1 },
      Goat: { cost: 2, coins: 1 },
      'Cursed Gold': { cost: 4, coins: 3 },
      'Magic Lamp': { cost: 0, coins: 1 },
      Pasture: { cost: 2, coins: 1 },
      Pouch: { cost: 2, coins: 1 },
    };
    for (const [name, f] of Object.entries(heirlooms)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.typeId, `${name} is a Treasure`).toBe('dom_type_treasure');
      expect(card!.fields['dom_field_cost']).toBe(f.cost);
      expect(card!.fields['dom_field_coins']).toBe(f.coins);
      expect(card!.tags, `${name} is no kingdom pile`).not.toContain('dom_tag_kingdom');
    }
    // Pasture's Victory half is the recount term — printed VP field stays 0.
    expect(def.cards.find((c) => c.name === 'Pasture')!.fields['dom_field_vp']).toBe(0);

    // Kingdom stock: 10 per pile; heirloom stock: 2 each; zombies: 1 each.
    const kingdomDeck = def.decks.find((d) => d.id === 'dom_deck_kingdom')!;
    expect(kingdomDeck.source.kind).toBe('custom');
    if (kingdomDeck.source.kind === 'custom') {
      for (const name of Object.keys(costs)) {
        const entry = kingdomDeck.source.entries.find(
          (en) => en.cardId === nocturneRest.ids[name]);
        expect(entry, `${name} in the kingdom deck`).toBeDefined();
        expect(entry!.count).toBe(10);
      }
    }
    const heirloomDeck = def.decks.find((d) => d.initialZone === HEIRLOOM_ZONE)!;
    expect(heirloomDeck).toBeDefined();
    if (heirloomDeck.source.kind === 'custom') {
      expect(heirloomDeck.source.entries).toHaveLength(7);
      for (const en of heirloomDeck.source.entries) expect(en.count).toBe(2);
    }
    const zombieDeck = def.decks.find((d) => d.initialZone === ZOMBIE_ZONE)!;
    expect(zombieDeck).toBeDefined();
    if (zombieDeck.source.kind === 'custom') {
      expect(zombieDeck.source.entries).toHaveLength(3);
      for (const en of zombieDeck.source.entries) expect(en.count).toBe(1);
    }
    for (const z of ['Zombie Apprentice', 'Zombie Mason', 'Zombie Spy']) {
      const card = def.cards.find((c) => c.name === z)!;
      expect(card.fields['dom_field_cost']).toBe(3);
      expect(card.typeId).toBe('dom_type_action');
    }
  });
});

describe('heirloom swap (buildSetup)', () => {
  it('swaps a starter Copper per active heirloom pile (Pouch via Tracker, Cursed Gold via Pooka)', async () => {
    const def = await freshDef(kingdomWith('Tracker', 'Pooka'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state = engine.getState();
    expect(errors).toEqual([]);
    for (const p of ['p0', 'p1']) {
      const owned = [...names(state, DECK(p)), ...names(state, HAND(p))];
      expect(owned.filter((n) => n === 'Copper')).toHaveLength(5); // 7 - 2 swapped
      expect(owned.filter((n) => n === 'Pouch')).toHaveLength(1);
      expect(owned.filter((n) => n === 'Cursed Gold')).toHaveLength(1);
      expect(owned.filter((n) => n === 'Estate')).toHaveLength(3);
    }
    // 2 copies × 2 heirlooms left the 14-card stock.
    expect(count(state, HEIRLOOM_ZONE)).toBe(10);
  });

  it('absent piles swap nothing: a plain kingdom keeps all 7 Coppers', async () => {
    const def = await freshDef(kingdomWith());
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state = engine.getState();
    expect(errors).toEqual([]);
    for (const p of ['p0', 'p1']) {
      const owned = [...names(state, DECK(p)), ...names(state, HAND(p))];
      expect(owned.filter((n) => n === 'Copper')).toHaveLength(7);
      expect(owned).toHaveLength(10);
    }
    expect(count(state, HEIRLOOM_ZONE)).toBe(14);
    expect(count(state, TRASH)).toBe(0); // no Necromancer — no Zombies either
  });
});

describe('Necromancer and the Zombies', () => {
  it('setup seeds the three Zombies into the trash with Necromancer in the supply', async () => {
    const def = await freshDef(kingdomWith('Necromancer'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH).sort()).toEqual(['Zombie Apprentice', 'Zombie Mason', 'Zombie Spy']);
    expect(count(state, ZOMBIE_ZONE)).toBe(0);
  });

  it('plays a trash Zombie in place, marks it for the turn, and cleanup clears the marks', async () => {
    const def = await freshDef(kingdomWith('Necromancer'));
    def.setup.push(
      dealNamed('Necromancer'), dealNamed('Necromancer'),
      giveVar('dom_var_actions', 'p0', 2),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') {
        const want = requests.filter((r) => r.kind === 'card').length === 1
          ? 'Zombie Spy' : 'Zombie Apprentice';
        const id = req.cardIds.find((cid) => state.cards[cid].name === want);
        if (id === undefined) throw new Error(`no ${want} offered`);
        return id;
      }
      if (req.kind === 'cards') return JSON.stringify(req.cardIds.slice(0, 1));
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();

    // First Necromancer raises Zombie Spy: +1 Card +1 Action, the look-at
    // discards the top deck card; the Spy never leaves the trash.
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Necromancer') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toContain('Zombie Spy');
    expect(count(state, HAND('p0'))).toBe(7); // 5 + 2 dealt - played + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 2 - 1 + 1
    expect(count(state, DISCARD('p0'))).toBe(1); // the spied-out top card
    const spyId = findNamed(state, TRASH, 'Zombie Spy');
    expect(state.cards[spyId].vars[NECRO_MARK]).toBe(1);

    // The second Necromancer must NOT offer the marked Spy again.
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Necromancer') });
    state = engine.getState();
    expect(errors).toEqual([]);
    const secondPick = requests.filter((r) => r.kind === 'card')[1];
    expect(secondPick).toBeDefined();
    const offered = (secondPick as Extract<ChoiceRequest, { kind: 'card' }>).cardIds
      .map((id) => state.cards[id].name);
    expect(offered).not.toContain('Zombie Spy');
    expect(offered).toContain('Zombie Apprentice');
    expect(offered).toContain('Zombie Mason');
    // Apprentice found no Action in hand — it whiffs politely, stays marked.
    const apprenticeId = findNamed(state, TRASH, 'Zombie Apprentice');
    expect(state.cards[apprenticeId].vars[NECRO_MARK]).toBe(1);
    expect(names(state, TRASH).sort()).toEqual(['Zombie Apprentice', 'Zombie Mason', 'Zombie Spy']);

    // Cleanup wipes the face-down marks off the trash.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.cards[spyId].vars[NECRO_MARK]).toBe(0);
    expect(state.cards[apprenticeId].vars[NECRO_MARK]).toBe(0);
  });

  it('Zombie Apprentice trashes a hand Action for +3 Cards +1 Action', async () => {
    const def = await freshDef(kingdomWith('Necromancer'));
    def.setup.push(dealNamed('Necromancer'), dealNamed('Moat')); // Moat sits in the SUPPLY (a filler pick)
    const { engine, errors } = probeEngine(def, answerQueue(
      pickOne('Zombie Apprentice'),
      pickCards('Moat', 1),
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Necromancer') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toContain('Moat');
    expect(count(state, HAND('p0'))).toBe(8); // 7 - Necromancer - Moat + 3
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(names(state, TRASH)).toContain('Zombie Apprentice'); // never left
  });

  it('Zombie Mason trashes the deck top and may gain up to $1 more', async () => {
    const def = await freshDef(kingdomWith('Necromancer'));
    def.setup.push(dealNamed('Necromancer'), dealNamed('Silver', 'dom_zone_deck'));
    const { engine, errors } = probeEngine(def, answerQueue(
      pickOne('Zombie Mason'),
      pickOne('Silver'), // the supply gain (cap $3 + 1 = $4)
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Necromancer') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toContain('Silver'); // the deck top, trashed
    expect(names(state, DISCARD('p0'))).toContain('Silver'); // the gained copy
    expect(count(state, DECK('p0'))).toBe(5); // 5 + planted Silver - trashed
  });
});

describe('Cemetery', () => {
  it('buying it trashes up to 4 from hand; the recount adds its printed 2 VP', async () => {
    const def = await freshDef(kingdomWith('Cemetery'));
    def.setup.push(giveVar('dom_var_coins', 'p0', 4));
    const { engine, errors } = probeEngine(def, answerQueue(
      pickCards('Copper', 1),
    ));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_buy', cardId: findNamed(state, SUPPLY, 'Cemetery'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(names(state, DISCARD('p0'))).toContain('Cemetery');
    expect(count(state, HAND('p0'))).toBe(4);
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    // 3 Estates + the Cemetery's printed 2 (the Haunted Mirror swap adds no VP).
    expect(state.players[0].vars['dom_var_vp']).toBe(5);
  });
});

describe('Conclave', () => {
  it('+$2 and plays a hand Action it has no copy of in play, for +1 Action', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Conclave'), dealNamed('Moat')); // Moat is in the default kingdom's supply
    const { engine, errors } = probeEngine(def, answerQueue(pickCards('Moat', 1)));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Conclave') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Conclave', 'Moat']);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, HAND('p0'))).toBe(7); // 7 - Conclave - Moat + 2 drawn
  });

  it('a copy already in play whiffs: the pick stays in hand, no bonus Action', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Moat'), dealNamed('Moat'), fromReserve('Conclave'),
      giveVar('dom_var_actions', 'p0', 2),
    );
    const { engine, errors } = probeEngine(def, answerQueue(pickCards('Moat', 1)));
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Moat') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Conclave') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Conclave', 'Moat']);
    expect(names(state, HAND('p0'))).toContain('Moat'); // the whiffed pick stayed
    expect(state.players[0].vars['dom_var_actions']).toBe(0); // 2 - 1 - 1, no bonus
    expect(state.log.some((l) => l.text.includes('already has a copy in play'))).toBe(true);
  });
});

describe('Faithful Hound', () => {
  it('draws 2 on play', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Faithful Hound'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Faithful Hound') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Hound + 2
  });

  it('discarded outside Clean-up: waits set aside and returns at end of turn', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Warehouse'), fromReserve('Faithful Hound'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'cards') {
        // Warehouse's discard 3 — the Hound plus two others.
        const hound = req.cardIds.find((id) => state.cards[id].name === 'Faithful Hound');
        if (hound === undefined) throw new Error('no Hound to discard');
        const others = req.cardIds.filter((id) => id !== hound).slice(0, 2);
        return JSON.stringify([hound, ...others]);
      }
      if (req.kind === 'yesNo') return true; // set the Hound aside
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Warehouse') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DURATION('p0'))).toEqual(['Faithful Hound']);
    const houndId = findNamed(state, DURATION('p0'), 'Faithful Hound');
    expect(state.cards[houndId].vars[HOUND_MARK]).toBe(1);
    expect(count(state, DISCARD('p0'))).toBe(2); // the two ordinary discards

    // End of turn: cleanup redraws 5, THEN the Hound comes home — 6 cards.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(names(state, HAND('p0'))).toContain('Faithful Hound');
    expect(count(state, HAND('p0'))).toBe(6);
    expect(state.cards[houndId].vars[HOUND_MARK]).toBe(0);
  });

  it('the Clean-up sweep offers nothing (its cause tag is cleanup, not discard)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Faithful Hound'));
    const { engine, errors } = probeEngine(def, noChoices); // any prompt throws
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Faithful Hound');
    expect(count(state, DURATION('p0'))).toBe(0);
  });
});

describe('Leprechaun (Action – Doom, verified)', () => {
  it('plays in the ACTION phase: gains a Gold and, off-count, hexes ITSELF (no window)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Leprechaun'));
    const { engine, errors } = probeEngine(def, usingBoonsStub ? noChoices : permissive);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Leprechaun') });
    const state = engine.getState();
    if (usingBoonsStub) expect(errors).toEqual([]);
    expect(state.window).toBeNull(); // self-hex: never an attack window
    expect(names(state, DISCARD('p0'))).toContain('Gold');
    // 1 card in play ≠ 7 → one Hex cycled deck → fate → used pile.
    expect(count(state, HEX_USED_ZONE)).toBe(1);
    expect(state.log.some((l) => l.text.includes('receives a Hex'))).toBe(true);
  });

  it('with exactly 7 cards in play it gains a Wish instead', async () => {
    const def = await freshDef();
    def.setup.push(
      ...Array.from({ length: 6 }, () => dealNamed('Moat')),
      fromReserve('Leprechaun'),
      giveVar('dom_var_actions', 'p0', 7),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    for (let i = 0; i < 6; i += 1) {
      const state = engine.getState();
      await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Moat') });
    }
    let state = engine.getState();
    expect(count(state, INPLAY('p0'))).toBe(6);
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Leprechaun') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Gold');
    expect(names(state, DISCARD('p0'))).toContain('Wish');
    expect(count(state, HEX_USED_ZONE)).toBe(0); // no Hex on a lucky day
  });
});

describe('Pooka', () => {
  it('trashes a non-Cursed-Gold Treasure for +4 Cards (Cursed Gold never offered)', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Pooka'), dealNamed('Silver'), fromStock('Cursed Gold'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const offered = req.cardIds.map((id) => state.cards[id].name);
      expect(offered).not.toContain('Cursed Gold');
      expect(offered).toContain('Silver');
      return pickCards('Silver', 1)(req, state);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Pooka') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(count(state, HAND('p0'))).toBe(10); // 8 - Pooka - Silver + 4
  });
});

describe('Shepherd and Pasture', () => {
  it('discards Victory cards, revealed, for +2 Cards each', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Shepherd'), dealNamed('Estate'), dealNamed('Estate'));
    const { engine, errors } = probeEngine(def, answerQueue(pickCards('Estate', 2)));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Shepherd') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(names(state, DISCARD('p0')).filter((n) => n === 'Estate')).toHaveLength(2);
    expect(count(state, HAND('p0'))).toBe(9); // 8 - Shepherd - 2 + 4
    expect(count(state, DECK('p0'))).toBe(1); // 5 - 4 drawn
  });

  it('Pasture scores 1 VP per Estate at the recount (heirloom of Shepherd)', async () => {
    const def = await freshDef(kingdomWith('Shepherd'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await passTurn(engine, 'p0');
    const state = engine.getState();
    expect(errors).toEqual([]);
    const owned = [...names(state, DECK('p0')), ...names(state, HAND('p0')), ...names(state, DISCARD('p0'))];
    expect(owned.filter((n) => n === 'Pasture')).toHaveLength(1);
    // 3 Estates printed + 3 × 1 Pasture VP = 6.
    expect(state.players[0].vars['dom_var_vp']).toBe(6);
  });
});

describe('Tragic Hero', () => {
  it('with 8+ cards after drawing: trashes itself and gains a Treasure', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Tragic Hero'));
    const { engine, errors } = probeEngine(def, answerQueue(pickOne('Gold')));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Tragic Hero') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(8); // 6 - Hero + 3 → the tragedy fires
    expect(names(state, TRASH)).toEqual(['Tragic Hero']);
    expect(names(state, DISCARD('p0'))).toContain('Gold');
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
  });

  it('with fewer than 8 it survives in play', async () => {
    const def = await freshDef();
    def.setup.push(
      // Thin the hand to 3 BEFORE dealing the Hero, so 3 + Hero + 3 drawn = 6.
      {
        kind: 'moveCards',
        from: { zoneId: 'dom_zone_hand', owner: null },
        to: { zoneId: 'dom_zone_deck', owner: null },
        cards: { kind: 'top', count: { kind: 'num', value: 2 } },
        toPosition: 'bottom', faceUp: false,
      },
      fromReserve('Tragic Hero'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Tragic Hero') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 4 - Hero + 3
    expect(names(state, INPLAY('p0'))).toEqual(['Tragic Hero']);
    expect(count(state, TRASH)).toBe(0);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
  });
});

describe('the heirlooms at play', () => {
  it('Pouch: $1 on the field and +1 Buy', async () => {
    const def = await freshDef();
    def.setup.push(fromStock('Pouch'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Pouch'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
  });

  it('Cursed Gold: $3 and a mandatory Curse', async () => {
    const def = await freshDef();
    def.setup.push(fromStock('Cursed Gold'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Cursed Gold'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(names(state, DISCARD('p0'))).toContain('Curse');
  });

  it('Lucky Coin: $1 and a Silver', async () => {
    const def = await freshDef();
    def.setup.push(fromStock('Lucky Coin'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Lucky Coin'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, DISCARD('p0'))).toContain('Silver');
  });

  it('Goat: $1 and an optional hand trash', async () => {
    const def = await freshDef();
    def.setup.push(fromStock('Goat'));
    const { engine, errors } = probeEngine(def, answerQueue(pickCards('Copper', 1)));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Goat'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, TRASH)).toEqual(['Copper']);
  });

  it('Magic Lamp: six lone cards in play trash it for 3 Wishes', async () => {
    const def = await freshDef();
    def.setup.push(
      fromStock('Magic Lamp'), fromStock('Goat'), fromStock('Cursed Gold'),
      dealNamed('Silver'), dealNamed('Gold'),
    );
    const { engine, errors } = probeEngine(def, answerQueue(declineCards));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    // Copper, Silver, Gold, Goat (decline the trash), Cursed Gold: five
    // singletons in play — the Lamp itself is the sixth.
    for (const name of ['Copper', 'Silver', 'Gold', 'Goat', 'Cursed Gold', 'Magic Lamp']) {
      const state = engine.getState();
      await engine.performAction('p0', {
        actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), name),
      });
    }
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toContain('Magic Lamp');
    expect(names(state, DISCARD('p0')).filter((n) => n === 'Wish')).toHaveLength(3);
    expect(state.players[0].vars['dom_var_coins']).toBe(11); // 1+2+3+1+3+1
  });

  it('Magic Lamp with fewer than six singletons stays in play, wishless', async () => {
    const def = await freshDef();
    def.setup.push(fromStock('Magic Lamp'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Copper'),
    });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Magic Lamp'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, INPLAY('p0'))).toContain('Magic Lamp');
    expect(count(state, TRASH)).toBe(0);
    expect(names(state, DISCARD('p0'))).not.toContain('Wish');
  });

  it('Haunted Mirror trashed: discard an Action to gain a Ghost', async () => {
    const def = await freshDef();
    def.setup.push(fromStock('Goat'), fromStock('Haunted Mirror'), dealNamed('Moat'));
    const { engine, errors } = probeEngine(def, answerQueue(
      pickCards('Haunted Mirror', 1), // Goat's trash
      pickCards('Moat', 1),           // the mirror's discard
    ));
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    let state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Goat'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Haunted Mirror']);
    expect(names(state, DISCARD('p0'))).toContain('Moat');
    expect(names(state, DISCARD('p0'))).toContain('Ghost');
  });
});
