/**
 * Dark Ages (the trash half) — deterministic per-card probes through the
 * REAL engine: Altar's trash-and-gain, Bandit Camp's Spoils, the Cultist
 * chain (Ruins to the victim, the free follow-up play, Moat immunity, the
 * on-trash +3 Cards), Fortress surviving its own trash (from the hand AND
 * from In Play via Procession), Ironmonger's three reveal branches, Junk
 * Dealer, Procession's exact-$1 upgrade + Duration exclusion, and Rats'
 * 20-card pile, self-replication, non-Rats trash, all-Rats whiff and
 * on-trash draw.
 *
 * REGISTRATION NOTE: this module is not in expansions.ts yet, and
 * dominionGame.ts reads EXPANSIONS at MODULE-EVALUATION time — so the
 * module is pushed into EXPANSIONS here and buildDominionDef is loaded via
 * dynamic import afterwards (the adventuresB / nocturneRest precedent).
 *
 * SIBLING STUBS: darkAgesTrash references agent A's stocks
 * (dom_zone_spoils / dom_zone_ruins) by literal id. While darkAgesRuins is
 * mid-flight, THIS SUITE registers guarded stand-ins (zones + inert stock
 * cards) — the merged def cannot validate without the zone declarations.
 * Once darkAgesRuins lands in expansions.ts the stubs become no-ops and can
 * be deleted; the probes assert stock COUNTS (not stub card names), so they
 * hold against A's real Spoils/Ruins cards too.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceAnswer, ChoiceRequest, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { EXPANSIONS } from './expansions';
import type { ExpansionModule } from './kit';
import { RUINS_ZONE, SPOILS_ZONE, darkAgesTrash } from './darkAgesTrash';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

/** Zones-and-stock stand-in for agent A's darkAgesRuins module (header). */
const needSpoils = !EXPANSIONS.some((x) => (x.zones ?? []).some((z) => z.id === SPOILS_ZONE));
const needRuins = !EXPANSIONS.some((x) => (x.zones ?? []).some((z) => z.id === RUINS_ZONE));
if (needSpoils || needRuins) {
  const ruinsStub: ExpansionModule = {
    id: 'darkAgesRuinsStub',
    piles: [],
    ids: {
      ...(needSpoils ? { 'Stub Spoils': 'dom_card_stub_spoils' } : {}),
      ...(needRuins ? { 'Stub Ruins': 'dom_card_stub_ruins' } : {}),
    },
    buildCards: (kit) => [
      ...(needSpoils ? [kit.cardDef('dom_card_stub_spoils', 'Stub Spoils', 0, 0, 0,
        '(Stand-in Spoils with no effect.)')] : []),
      ...(needRuins ? [kit.cardDef('dom_card_stub_ruins', 'Stub Ruins', 0, 0, 0,
        '(Stand-in Ruins with no effect.)')] : []),
    ],
    zones: [
      ...(needSpoils ? [{
        id: SPOILS_ZONE, name: 'Spoils stock',
        owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
      } as const] : []),
      ...(needRuins ? [{
        id: RUINS_ZONE, name: 'Ruins stock',
        owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
      } as const] : []),
    ],
    nonSupply: [
      ...(needSpoils ? [{ zoneId: SPOILS_ZONE, piles: [{ name: 'Stub Spoils', cost: 0, count: 15 }] }] : []),
      ...(needRuins ? [{ zoneId: RUINS_ZONE, piles: [{ name: 'Stub Ruins', cost: 0, count: 10 }] }] : []),
    ],
  };
  EXPANSIONS.push(ruinsStub);
}
if (!EXPANSIONS.includes(darkAgesTrash)) EXPANSIONS.push(darkAgesTrash);

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
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');

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
/** Answer a yes/no with yes. */
const answerYes = (req: ChoiceRequest): ChoiceAnswer => {
  if (req.kind !== 'yesNo') throw new Error(`expected yesNo, got ${req.kind}`);
  return true;
};

describe('darkAgesTrash module registration', () => {
  it('validates clean and knows the piles (Rats at 20)', async () => {
    const def = await freshDef();
    expect(validateGameDef(def)).toEqual([]);

    const costs: Record<string, number> = {
      Fortress: 4, Ironmonger: 4, Procession: 4, Rats: 4,
      'Bandit Camp': 5, Cultist: 5, 'Junk Dealer': 5, Altar: 6,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
      expect(card!.typeId, `${name} is an Action`).toBe('dom_type_action');
      expect(card!.tags).toContain('dom_tag_kingdom');
    }
    // Cultist is the module's one Attack; nothing here is a Reaction.
    expect(def.cards.find((c) => c.name === 'Cultist')!.tags).toContain('dom_tag_attack');
    for (const name of Object.keys(costs)) {
      if (name !== 'Cultist') {
        expect(def.cards.find((c) => c.name === name)!.tags).not.toContain('dom_tag_attack');
      }
      expect(def.cards.find((c) => c.name === name)!.tags).not.toContain('dom_tag_reaction');
    }

    // Kingdom stock: 10 per pile — except the printed 20-card Rats pile.
    const kingdomDeck = def.decks.find((d) => d.id === 'dom_deck_kingdom')!;
    expect(kingdomDeck.source.kind).toBe('custom');
    if (kingdomDeck.source.kind === 'custom') {
      for (const name of Object.keys(costs)) {
        const entry = kingdomDeck.source.entries.find(
          (en) => en.cardId === darkAgesTrash.ids[name]);
        expect(entry, `${name} in the kingdom deck`).toBeDefined();
        expect(entry!.count).toBe(name === 'Rats' ? 20 : 10);
      }
    }
  });
});

describe('Altar', () => {
  it('trashes a hand card and gains a card costing up to $5', async () => {
    const def = await freshDef(kingdomWith('Altar'));
    def.setup.push(dealNamed('Altar'));
    const { engine, errors } = probeEngine(def, answerQueue(
      pickOne('Copper'),
      pickOne('Duchy'),
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Altar') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(names(state, DISCARD('p0'))).toContain('Duchy');
    expect(count(state, HAND('p0'))).toBe(4); // 6 - Altar - Copper
  });
});

describe('Bandit Camp', () => {
  it('+1 Card, +2 Actions and a Spoils off the shared stock', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Bandit Camp'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    const spoilsBefore = count(state0, SPOILS_ZONE);
    expect(spoilsBefore).toBeGreaterThan(0);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Bandit Camp') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    expect(count(state, HAND('p0'))).toBe(6); // 5 + 1 dealt - played + 1 drawn
    expect(count(state, SPOILS_ZONE)).toBe(spoilsBefore - 1);
    expect(count(state, DISCARD('p0'))).toBe(1); // the gained Spoils
  });
});

describe('Cultist', () => {
  it('draws 2, the opponent gains a Ruins, and a chained Cultist repeats it all', async () => {
    const def = await freshDef(kingdomWith('Cultist'));
    def.setup.push(dealNamed('Cultist'), dealNamed('Cultist'));
    const { engine, errors } = probeEngine(def, answerQueue(answerYes));
    await engine.start();
    const state0 = engine.getState();
    const ruinsBefore = count(state0, RUINS_ZONE);
    expect(ruinsBefore).toBeGreaterThanOrEqual(2);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Cultist') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    // Both Cultists resolved: 2 Ruins inflicted, 4 cards drawn, no Action
    // spent on the chained play.
    expect(names(state, INPLAY('p0'))).toEqual(['Cultist', 'Cultist']);
    expect(count(state, RUINS_ZONE)).toBe(ruinsBefore - 2);
    expect(count(state, DISCARD('p1'))).toBe(2);
    expect(count(state, HAND('p0'))).toBe(9); // 5 + 2 dealt - 2 played + 4 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(0); // 1 - 1, chain free
  });

  it('a revealed Moat blocks the Ruins', async () => {
    const def = await freshDef(kingdomWith('Cultist'));
    def.setup.push(dealNamed('Cultist'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    const ruinsBefore = count(state0, RUINS_ZONE);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Cultist') });
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, RUINS_ZONE)).toBe(ruinsBefore); // immune — no Ruins
    expect(count(state, DISCARD('p1'))).toBe(0);
    expect(count(state, HAND('p0'))).toBe(7); // 5 + 1 dealt - played + 2 drawn
  });

  it('trashed (Chapel): +3 Cards fire off the trash-tagged move', async () => {
    const def = await freshDef(kingdomWith('Cultist'));
    def.setup.push(dealNamed('Chapel'), dealNamed('Cultist'));
    const { engine, errors } = probeEngine(def, answerQueue(pickCards('Cultist', 1)));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Chapel') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Cultist']);
    expect(count(state, HAND('p0'))).toBe(8); // 5 + 2 dealt - Chapel - Cultist + 3
  });
});

describe('Fortress', () => {
  it('plays for +1 Card and +2 Actions', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Fortress'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Fortress') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - played + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
  });

  it('trashed from the hand (Chapel): it returns to the hand instead', async () => {
    const def = await freshDef(kingdomWith('Chapel'));
    def.setup.push(dealNamed('Chapel'), fromReserve('Fortress'));
    const { engine, errors } = probeEngine(def, answerQueue(pickCards('Fortress', 1)));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Chapel') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, TRASH)).toBe(0);
    expect(names(state, HAND('p0'))).toContain('Fortress');
    expect(count(state, HAND('p0'))).toBe(6); // 5 + 2 dealt - Chapel - Fortress + returned
  });

  it('trashed from In Play (Procession): it survives and the upgrade still comes', async () => {
    const def = await freshDef(kingdomWith());
    def.setup.push(fromReserve('Procession'), fromReserve('Fortress'));
    const { engine, errors } = probeEngine(def, answerQueue(
      pickCards('Fortress', 1),
      pickOne('Market'), // exactly $5 — $1 more than the $4 Fortress
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Procession') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, TRASH)).toBe(0);
    expect(names(state, INPLAY('p0'))).toEqual(['Procession']);
    expect(names(state, HAND('p0'))).toContain('Fortress'); // marched back
    expect(names(state, DISCARD('p0'))).toContain('Market');
    // 5 + 2 dealt - Procession - Fortress + 2 drawn (double play) + returned.
    expect(count(state, HAND('p0'))).toBe(8);
    expect(state.players[0].vars['dom_var_actions']).toBe(4); // 1 - 1 + 2 + 2
  });
});

describe('Ironmonger', () => {
  it('a revealed Victory card kept on top is drawn by its own +1 Card', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Estate', 'dom_zone_deck'), // the reveal target…
      dealNamed('Copper', 'dom_zone_deck'), // …under the card the +1 draws
      fromReserve('Ironmonger'),
    );
    const { engine, errors } = probeEngine(def, answerQueue(declineCards));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Ironmonger') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // 5 + 1 dealt - played + 1 drawn (Copper) + 1 drawn (the kept Estate).
    expect(count(state, HAND('p0'))).toBe(7);
    expect(names(state, HAND('p0'))).toContain('Estate');
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, DECK('p0'))).toBe(5); // 5 + 2 planted - 2 drawn
  });

  it('a revealed Treasure pays +$1 and may be discarded', async () => {
    const def = await freshDef();
    def.setup.push(
      dealNamed('Silver', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
      fromReserve('Ironmonger'),
    );
    const { engine, errors } = probeEngine(def, answerQueue(pickCards('Silver', 1)));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Ironmonger') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(names(state, DISCARD('p0'))).toContain('Silver');
    expect(count(state, HAND('p0'))).toBe(6); // 5 + 1 dealt - played + 1 drawn
  });

  it('a revealed Action grants +1 Action and can go back on top', async () => {
    const def = await freshDef(kingdomWith());
    def.setup.push(
      dealNamed('Moat', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
      fromReserve('Ironmonger'),
    );
    const { engine, errors } = probeEngine(def, answerQueue(declineCards));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Ironmonger') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 1 + 1
    expect(names(state, DECK('p0'))).toContain('Moat'); // put back
    expect(names(state, HAND('p0'))).not.toContain('Moat');
    expect(count(state, DECK('p0'))).toBe(6); // 5 + 2 planted - 1 drawn
  });
});

describe('Junk Dealer', () => {
  it('+1 Card, +1 Action, +$1 and a mandatory hand trash', async () => {
    const def = await freshDef();
    def.setup.push(fromReserve('Junk Dealer'));
    const { engine, errors } = probeEngine(def, answerQueue(pickOne('Copper')));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Junk Dealer') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - played + 1 drawn - trashed
  });
});

describe('Procession', () => {
  it('plays an Action twice, trashes it, and upgrades at exactly +$1', async () => {
    const def = await freshDef(kingdomWith());
    def.setup.push(fromReserve('Procession'), dealNamed('Moat'));
    const { engine, errors } = probeEngine(def, answerQueue(
      pickCards('Moat', 1),
      pickOne('Village'), // exactly $3 — $1 more than the $2 Moat
    ));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Procession') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Moat']);
    expect(names(state, DISCARD('p0'))).toContain('Village');
    expect(names(state, INPLAY('p0'))).toEqual(['Procession']);
    expect(count(state, HAND('p0'))).toBe(9); // 5 + 2 dealt - 2 played + 4 drawn
  });

  it('excludes Durations: a hand with only a Caravan gets no offer', async () => {
    const def = await freshDef(kingdomWith());
    def.setup.push(fromReserve('Procession'), fromReserve('Caravan'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Procession') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, HAND('p0'))).toContain('Caravan'); // never offered
    expect(count(state, TRASH)).toBe(0);
    expect(state.log.some((l) => l.text.includes('no Action fit for the procession'))).toBe(true);
  });
});

describe('Rats', () => {
  it('self-replicates off the 20-card pile and trashes a non-Rats card', async () => {
    const def = await freshDef(kingdomWith('Rats'));
    def.setup.push(dealNamed('Rats'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`expected card, got ${req.kind}`);
      // The trash pick must never offer a Rats.
      expect(req.cardIds.map((id) => state.cards[id].name)).not.toContain('Rats');
      return pickOne('Copper')(req, state);
    });
    await engine.start();
    const state0 = engine.getState();
    expect(names(state0, SUPPLY).filter((n) => n === 'Rats')).toHaveLength(19); // 20 - 1 dealt
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Rats') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DISCARD('p0'))).toContain('Rats'); // the gained copy
    expect(names(state, SUPPLY).filter((n) => n === 'Rats')).toHaveLength(18);
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(count(state, HAND('p0'))).toBe(5); // 6 - played + 1 drawn - trashed
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
  });

  it('an all-Rats hand whiffs the trash with an announcement', async () => {
    const def = await freshDef(kingdomWith('Rats'));
    def.setup.push(
      // Empty the opening hand back into the deck, then hold only Rats.
      {
        kind: 'moveCards',
        from: { zoneId: 'dom_zone_hand', owner: null },
        to: { zoneId: 'dom_zone_deck', owner: null },
        cards: { kind: 'all' },
        toPosition: 'bottom', faceUp: false,
      },
      dealNamed('Rats'), dealNamed('Rats'),
      dealNamed('Rats', 'dom_zone_deck'), // the +1 Card draws another Rats
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Rats') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, TRASH)).toBe(0);
    expect(names(state, HAND('p0'))).toEqual(['Rats', 'Rats']); // nothing trashed
    expect(names(state, DISCARD('p0'))).toContain('Rats'); // still self-replicates
    expect(state.log.some((l) => l.text.includes('hand of all Rats'))).toBe(true);
  });

  it('trashed (Chapel): +1 Card fires off the trash-tagged move', async () => {
    const def = await freshDef(kingdomWith('Rats'));
    def.setup.push(dealNamed('Chapel'), dealNamed('Rats'));
    const { engine, errors } = probeEngine(def, answerQueue(pickCards('Rats', 1)));
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Chapel') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Rats']);
    expect(count(state, HAND('p0'))).toBe(6); // 5 + 2 dealt - Chapel - Rats + 1
  });
});
