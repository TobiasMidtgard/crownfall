/**
 * The hall's Dominion def: validates clean, hosts all three lobby kingdom
 * sets, and each set plays to completion through the REAL engine under the
 * example playthrough harness (seeded random moves + choices).
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest, Expr, GameDef, GameState } from '../shared/types';
import { validateGameDef } from '../shared/validate';
import { KINGDOM_SETS } from '../shared/kingdoms';
import { createEngine } from '../engine';
import { playThrough, totalCards } from '../examples/testHarness';
import { buildDominionDef, kingdomCardNames, pickKingdom } from './dominionGame';

const BASIC_NAMES = ['Copper', 'Silver', 'Gold', 'Estate', 'Duchy', 'Province', 'Curse'];
/** Basics 46+40+30+8+8+8+10, kingdom stock 18 piles of 10, starters 2 × 10. */
const TOTAL_CARDS = 150 + 180 + 20;

const errorsOf = (def: GameDef) =>
  validateGameDef(def).filter((i) => i.severity === 'error');

/** Start a real engine (no choices expected) and return the initial supply. */
async function startedSupply(def: GameDef): Promise<{ names: Set<string>; errors: string[] }> {
  const errors: string[] = [];
  const engine = createEngine(def, {
    playerNames: ['Ada', 'Brook'],
    aiSeats: [false, false],
    seed: 7,
    choiceProvider: {
      resolve(req) { throw new Error(`unexpected choice at setup: ${req.prompt}`); },
    },
    onUpdate: () => {},
    onScriptError: (m) => errors.push(m),
  });
  await engine.start();
  const state = engine.getState();
  const names = new Set(state.zones['dom_zone_supply'].cardIds.map((id) => state.cards[id].name));
  return { names, errors };
}

describe('buildDominionDef', () => {
  const def = buildDominionDef();

  it('validates with zero errors', () => {
    expect(errorsOf(def)).toEqual([]);
  });

  it('is the seeded, keeper-editable flagship (not a built-in example)', () => {
    expect(def.meta.id).toBe('dominion-crownfall');
    expect(def.meta.name).toBe('Dominion');
    expect(def.meta.builtIn).toBe(false);
    expect(def.meta.minPlayers).toBe(2);
  });

  it('knows every card of every lobby kingdom set (plus the Woodcutter spare)', () => {
    const known = new Set(kingdomCardNames(def));
    for (const set of KINGDOM_SETS) {
      for (const name of set.cards) {
        expect(known, `${set.name} needs ${name}`).toContain(name);
      }
    }
    expect(known).toContain('Woodcutter'); // spare supply option, in no set
  });

  it('spawns kingdom piles via one tagged setup block per card', () => {
    const pileBlocks = def.setup.filter(
      (b) => b.kind === 'moveCards'
        && b.from.zoneId === 'dom_zone_reserve'
        && b.to.zoneId === 'dom_zone_supply',
    );
    expect(pileBlocks).toHaveLength(10);
  });
});

describe('pickKingdom', () => {
  const base = buildDominionDef();

  it('is pure and rejects unknown cards', () => {
    const before = JSON.stringify(base);
    const swapped = pickKingdom(base, KINGDOM_SETS[1].cards);
    expect(swapped).not.toBe(base);
    expect(JSON.stringify(base)).toBe(before);
    expect(swapped.meta.id).toBe(base.meta.id);
    expect(() => pickKingdom(base, ['Village', 'Platinum Hoard'])).toThrow(/Platinum Hoard/);
  });

  it.each(KINGDOM_SETS.map((s) => ({ set: s.name, cards: s.cards })))(
    '$set: the supply is exactly the basics + those ten piles',
    async ({ cards }) => {
      const def = pickKingdom(base, cards);
      expect(errorsOf(def)).toEqual([]);
      const { names, errors } = await startedSupply(def);
      expect(errors).toEqual([]);
      expect([...names].sort()).toEqual([...BASIC_NAMES, ...cards].sort());
    },
  );
});

/** Setup block moving ONE named card from the supply to p0's hand. */
function dealNamed(name: string): GameDef['setup'][number] {
  const nameIs: Expr = {
    kind: 'compare', op: '==',
    left: { kind: 'cardField', card: { kind: 'binding', name: '$card' }, fieldId: 'name' },
    right: { kind: 'str', value: name },
  };
  return {
    kind: 'moveCards',
    from: { zoneId: 'dom_zone_supply', owner: null },
    to: { zoneId: 'dom_zone_hand', owner: null }, // contextual = p0 during setup
    cards: {
      kind: 'specific',
      card: {
        kind: 'bestCard', zone: { zoneId: 'dom_zone_supply', owner: null },
        by: 'highest', fieldId: 'dom_field_cost', filter: nameIs,
      },
    },
    toPosition: 'top',
    faceUp: true,
  };
}

function probeEngine(def: GameDef, answer: (req: ChoiceRequest, state: GameState) => string) {
  const errors: string[] = [];
  const engine = createEngine(def, {
    playerNames: ['Ada', 'Brook'],
    aiSeats: [false, false],
    seed: 11,
    choiceProvider: { resolve: (req, state) => Promise.resolve(answer(req, state)) },
    onUpdate: () => {},
    onScriptError: (m) => errors.push(m),
  });
  return { engine, errors };
}

describe('rebuilt card semantics (deterministic probes)', () => {
  it('Throne Room plays the chosen action twice (Smithy draws 6)', async () => {
    // Sharp Coins carries Throne Room + Smithy. Deal one of each into p0's
    // opening hand; every later draw comes from p0's own 10-card starter
    // deck, so counts are seed-independent.
    const def = pickKingdom(buildDominionDef(), KINGDOM_SETS[1].cards);
    def.setup.push(dealNamed('Throne Room'), dealNamed('Smithy'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      // The only choice is Throne Room's pick: take the Smithy.
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      const smithy = req.cardIds.find((id) => state.cards[id].name === 'Smithy');
      if (!smithy) throw new Error('no Smithy offered');
      return smithy;
    });
    await engine.start();
    let state = engine.getState();
    const hand = state.zones['dom_zone_hand:p0'];
    expect(hand.cardIds).toHaveLength(7); // 5 drawn + the 2 dealt
    const throne = hand.cardIds.find((id) => state.cards[id].name === 'Throne Room')!;
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: throne });
    state = engine.getState();
    expect(errors).toEqual([]);
    // 7 - Throne - Smithy + all 5 remaining deck cards (draw 6 exhausts it).
    expect(state.zones['dom_zone_hand:p0'].cardIds).toHaveLength(10);
    expect(state.zones['dom_zone_deck:p0'].cardIds).toHaveLength(0);
    const inPlay = state.zones['dom_zone_inplay:p0'].cardIds.map((id) => state.cards[id].name);
    expect(inPlay.sort()).toEqual(['Smithy', 'Throne Room']);
  });

  it('Gardens scores 1 VP per 10 owned cards at the recount', async () => {
    // p0 owns 10 starters + 3 Gardens = 13 cards -> floor(13/10) = 1 VP per
    // Gardens (3) + 3 Estates = 6. The recount fires on turn end.
    const def = pickKingdom(buildDominionDef(), KINGDOM_SETS[1].cards);
    def.setup.push(dealNamed('Gardens'), dealNamed('Gardens'), dealNamed('Gardens'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp']).toBe(6);
    expect(state.players[1].vars['dom_var_vp']).toBe(3); // 3 Estates
  });
});

describe('every lobby set plays to completion', () => {
  // One seed per set to keep the suite quick; the stack games run long
  // under random play, so use the raised cap like the example suite.
  it.each([
    { set: KINGDOM_SETS[0], seed: 41 },
    { set: KINGDOM_SETS[1], seed: 42 },
    { set: KINGDOM_SETS[2], seed: 43 },
  ])('$set.name (seed $seed) finishes cleanly with every card accounted for', async ({ set, seed }) => {
    const def = pickKingdom(buildDominionDef(), set.cards);
    const r = await playThrough(def, { seed, stepCap: 8000 });
    expect(r.errors, 'the def should run without script errors').toEqual([]);
    expect(r.finished, `game should finish (took ${r.steps} steps)`).toBe(true);
    expect(r.state.result).not.toBeNull();
    expect(r.state.result!.winners.length).toBeGreaterThanOrEqual(0);
    expect(totalCards(r.state)).toBe(TOTAL_CARDS);
    // It only ends when the Provinces ran dry or three piles emptied.
    const provinces = Object.values(r.state.zones)
      .filter((z) => z.zoneId === 'dom_zone_supply')
      .flatMap((z) => z.cardIds)
      .filter((id) => r.state.cards[id].name === 'Province').length;
    const emptyPiles = Number(r.state.globalVars['dom_var_empty_piles'] ?? 0);
    expect(provinces === 0 || emptyPiles >= 3).toBe(true);
  });
});
