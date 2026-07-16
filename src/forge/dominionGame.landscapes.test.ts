/**
 * The landscape sideboard core (Events / Landmarks) — proven against a
 * SYNTHETIC test module so the machinery is pinned independently of any real
 * landscape set. Registration rides the seaside harness pattern: the module
 * joins EXPANSIONS before buildDominionDef is dynamically imported, so the
 * def in this worker carries the test landscapes while every other suite's
 * pins stay untouched.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Block, GameDef } from '../shared/types';
import { validateGameDef } from '../shared/validate';
import { KINGDOM_SETS } from '../shared/kingdoms';
import {
  changeVar, countCards, gt, iff, num, zone,
} from '../examples/dsl';
import type { CardKit, ExpansionModule } from './dominion/kit';
import { EXPANSIONS } from './dominion/expansions';
import { findNamed, probeEngine } from './dominion/testKit';

const LANDSCAPES = 'dom_zone_landscapes';

const testLandscapes: ExpansionModule = {
  id: 'test_landscapes',
  setName: 'Test',
  piles: [],
  ids: {
    'Test Expedition': 'dom_card_test_expedition',
    'Test Obelisk': 'dom_card_test_obelisk',
  },
  landscapes: [
    { name: 'Test Expedition', cost: 3, kind: 'event' },
    { name: 'Test Obelisk', cost: 0, kind: 'landmark' },
  ],
  buildCards(kit: CardKit) {
    return [
      kit.cardDef('dom_card_test_expedition', 'Test Expedition', 3, 0, 0,
        'Event: draw 2 cards.', [
          kit.onPlay('dom_ab_test_expedition', 'Expedition', [kit.draw(null, 2)]),
        ]),
      kit.cardDef('dom_card_test_obelisk', 'Test Obelisk', 0, 0, 0,
        'Landmark: 2 VP at every recount while on the table.'),
    ];
  },
  buildVpTerms(kit: CardKit): Block[] {
    return [
      iff(gt(countCards(zone(LANDSCAPES), kit.nameIs('Test Obelisk')), num(0)), [
        changeVar(kit.vars.VP, num(2), kit.PLAYER),
      ]),
    ];
  },
};

type Forge = typeof import('./dominionGame');
let forge: Forge;
let base: GameDef;

beforeAll(async () => {
  if (!EXPANSIONS.includes(testLandscapes)) EXPANSIONS.push(testLandscapes);
  forge = await import('./dominionGame');
  base = forge.pickKingdom(forge.buildDominionDef(), KINGDOM_SETS[0].cards);
});

describe('the landscape sideboard core', () => {
  it('validates with zero errors and zero warnings', () => {
    expect(validateGameDef(base)).toEqual([]);
  });

  it('landscapes live in the landscape catalog, never the kingdom catalog', () => {
    const land = forge.landscapeCatalog(base);
    expect(land.map((l) => l.name).sort()).toContain('Test Expedition');
    expect(land.find((l) => l.name === 'Test Expedition')).toMatchObject(
      { cost: 3, kind: 'event', expansion: 'Test' },
    );
    expect(land.find((l) => l.name === 'Test Obelisk')).toMatchObject(
      { kind: 'landmark', expansion: 'Test' },
    );
    const kingdom = forge.kingdomCatalog(base);
    expect(kingdom.some((c) => c.name === 'Test Expedition' || c.name === 'Test Obelisk')).toBe(false);
    expect(forge.kingdomCardNames(base)).not.toContain('Test Obelisk');
  });

  it('pickLandscapes is pure, idempotent, and throws on unknown names', () => {
    const before = JSON.stringify(base);
    const once = forge.pickLandscapes(base, ['Test Expedition']);
    expect(JSON.stringify(base)).toBe(before);
    expect(forge.activeLandscapes(base)).toEqual([]);
    expect(forge.activeLandscapes(once)).toEqual(['Test Expedition']);
    const swapped = forge.pickLandscapes(once, ['Test Obelisk']);
    expect(forge.activeLandscapes(swapped)).toEqual(['Test Obelisk']);
    const cleared = forge.pickLandscapes(swapped, []);
    expect(forge.activeLandscapes(cleared)).toEqual([]);
    expect(validateGameDef(once)).toEqual([]);
    expect(() => forge.pickLandscapes(base, ['Test Expedition', 'Moat'])).toThrow(/Moat/);
  });

  it('an Event buys in place: pays, spends the buy, fires, and stays', async () => {
    const def = forge.pickLandscapes(base, ['Test Expedition', 'Test Obelisk']);
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = 5;
    const { engine, errors } = probeEngine(def, () => {
      throw new Error('no choice expected');
    });
    await engine.start();
    let state = engine.getState();
    expect(state.zones[LANDSCAPES].cardIds).toHaveLength(2);
    const eventId = findNamed(state, LANDSCAPES, 'Test Expedition');

    // Not buyable during the action phase — the buy phase owns the action.
    await expect(
      engine.performAction('p0', { actionId: 'dom_action_buy_event', cardId: eventId }),
    ).rejects.toThrow();

    await engine.performAction('p0', { actionId: 'dom_action_done' });
    const handBefore = engine.getState().zones['dom_zone_hand:p0'].cardIds.length;
    await engine.performAction('p0', { actionId: 'dom_action_buy_event', cardId: eventId });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.zones['dom_zone_hand:p0'].cardIds.length).toBe(handBefore + 2);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars['dom_var_buys']).toBe(0);
    // The Event never leaves the sideboard.
    expect(state.zones[LANDSCAPES].cardIds).toContain(eventId);

    // No buys left — a second purchase is refused.
    await expect(
      engine.performAction('p0', { actionId: 'dom_action_buy_event', cardId: eventId }),
    ).rejects.toThrow();
  });

  it('a Landmark on the table joins every VP recount; absent it does not', async () => {
    const playTurn = async (engine: Awaited<ReturnType<typeof probeEngine>>['engine']) => {
      await engine.performAction('p0', { actionId: 'dom_action_done' });
      await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
      await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    };
    const withMark = forge.pickLandscapes(base, ['Test Obelisk']);
    const a = probeEngine(withMark, () => { throw new Error('no choice expected'); });
    await a.engine.start();
    await playTurn(a.engine);
    expect(a.errors).toEqual([]);
    // Starter deck holds 3 Estates = 3 VP, plus the Obelisk's 2.
    expect(a.engine.getState().players[0].vars['dom_var_vp']).toBe(5);

    const b = probeEngine(base, () => { throw new Error('no choice expected'); });
    await b.engine.start();
    await playTurn(b.engine);
    expect(b.engine.getState().players[0].vars['dom_var_vp']).toBe(3);
  });
});
