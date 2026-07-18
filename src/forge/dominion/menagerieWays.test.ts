/**
 * menagerieWays — deterministic probes for the 18 Menagerie Ways through the
 * REAL engine: the Way-substitution core (the played card's own effect stays
 * silent, the Way's fires instead), the two-Ways chooser, the absent-Way
 * negative, per-Way effect probes and the Turtle's next-turn replay.
 *
 * REGISTRATION NOTE: the module is pushed into EXPANSIONS here and
 * buildDominionDef is loaded via dynamic import afterwards (dominionGame.ts
 * reads EXPANSIONS at module-evaluation time) — the seaside harness pattern.
 * Once the integrator registers menagerieWays in expansions.ts, freshDef()
 * can become a plain static import.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { ChoiceRequest, EngineHandle, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { KINGDOM_SETS } from '../../shared/kingdoms';
import { EXPANSIONS } from './expansions';
import {
  FROG_MARK, SEAL_TURN_VAR, SQUIRREL_TURN_VAR, TURTLE_MARK, menagerieWays,
} from './menagerieWays';
import { dealNamed, findNamed, probeEngine } from './testKit';

if (!EXPANSIONS.includes(menagerieWays)) EXPANSIONS.push(menagerieWays);

type Forge = typeof import('../dominionGame');
let forge: Forge;
let base: GameDef;

beforeAll(async () => {
  forge = await import('../dominionGame');
  base = forge.pickKingdom(forge.buildDominionDef(), KINGDOM_SETS[0].cards);
});

const LANDSCAPES = 'dom_zone_landscapes';
const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const DURATION = (p: string) => `dom_zone_duration:${p}`;
const EXILE = (p: string) => `dom_zone_exile:${p}`;

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;
const supplyCount = (state: GameState, name: string): number =>
  names(state, 'dom_zone_supply').filter((n) => n === name).length;

const noChoices = () => { throw new Error('no choices expected'); };

/** A def with the given Ways on the table and a Smithy dealt to p0's hand. */
function wayDef(ways: string[], withSmithy = true): GameDef {
  const def = forge.pickLandscapes(base, ways);
  if (withSmithy) def.setup.push(dealNamed('Smithy'));
  return def;
}

/** Play p0's Smithy through 'dom_action_play_way'. */
async function playSmithyAsWay(engine: EngineHandle): Promise<void> {
  const smithy = findNamed(engine.getState(), HAND('p0'), 'Smithy');
  await engine.performAction('p0', { actionId: 'dom_action_play_way', cardId: smithy });
}

/** Action → Buy → Cleanup → the turn passes (nothing gets played). */
async function passTurn(engine: EngineHandle, pid: string): Promise<void> {
  await engine.performAction(pid, { actionId: 'dom_action_done' });
  await engine.performAction(pid, { actionId: 'dom_action_end_turn' });
  await engine.performAction(pid, { actionId: 'dom_action_cleanup' });
}

describe('menagerieWays module registration', () => {
  it('validates with zero errors and zero warnings, bare and with Ways picked', () => {
    expect(validateGameDef(base)).toEqual([]);
    expect(validateGameDef(forge.pickLandscapes(base, ['Way of the Ox', 'Way of the Sheep'])))
      .toEqual([]);
  });

  it('ships 18 Ways in the landscape catalog and none in the kingdom catalog', () => {
    const land = forge.landscapeCatalog(base);
    const ways = land.filter((l) => l.expansion === 'Menagerie' && l.kind === 'way');
    expect(ways.map((w) => w.name).sort()).toEqual([
      'Way of the Butterfly', 'Way of the Camel', 'Way of the Frog', 'Way of the Goat',
      'Way of the Horse', 'Way of the Mole', 'Way of the Monkey', 'Way of the Mule',
      'Way of the Otter', 'Way of the Owl', 'Way of the Ox', 'Way of the Pig',
      'Way of the Rat', 'Way of the Seal', 'Way of the Sheep', 'Way of the Squirrel',
      'Way of the Turtle', 'Way of the Worm',
    ]);
    expect(ways.every((w) => w.cost === 0)).toBe(true);
    // The two stated exclusions never ship anywhere.
    for (const absent of ['Way of the Chameleon', 'Way of the Mouse']) {
      expect(land.some((l) => l.name === absent)).toBe(false);
      expect(base.cards.some((c) => c.name === absent)).toBe(false);
    }
    const kingdom = forge.kingdomCatalog(base);
    expect(kingdom.some((c) => c.name.startsWith('Way of the'))).toBe(false);
    // Ways wear the Way primary type.
    expect(base.cards.find((c) => c.name === 'Way of the Ox')!.typeId).toBe('dom_type_way');
  });
});

describe('the Way substitution core', () => {
  it('without a Way on the table, dom_action_play_way is not legal', async () => {
    const def = forge.pickLandscapes(base, []);
    def.setup.push(dealNamed('Smithy'));
    const { engine } = probeEngine(def, noChoices);
    await engine.start();
    const state = engine.getState();
    const smithy = findNamed(state, HAND('p0'), 'Smithy');
    expect(engine.getLegalMoves('p0').some((m) => m.actionId === 'dom_action_play_way'))
      .toBe(false);
    await expect(
      engine.performAction('p0', { actionId: 'dom_action_play_way', cardId: smithy }),
    ).rejects.toThrow();
  });

  it('a lone Way substitutes end-to-end: Smithy stays silent, the Sheep pays $2', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Sheep']), noChoices);
    await engine.start();
    const handBefore = count(engine.getState(), HAND('p0'));
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    // Smithy's +3 Cards stayed silent; the Sheep's +$2 fired instead.
    expect(count(state, HAND('p0'))).toBe(handBefore - 1);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars['dom_var_actions']).toBe(0); // the play cost 1
    expect(names(state, INPLAY('p0'))).toEqual(['Smithy']);
    // The Way card itself never leaves the sideboard.
    expect(names(state, LANDSCAPES)).toContain('Way of the Sheep');
  });

  it('two Ways on the table: the chooser picks which one fires', async () => {
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(
      wayDef(['Way of the Ox', 'Way of the Sheep']),
      (req, state) => {
        requests.push(req);
        if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
        return req.cardIds.find((id) => state.cards[id].name === 'Way of the Ox')!;
      },
    );
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0].kind).toBe('pile');
    expect(requests[0].prompt).toBe('Play it as which Way?');
    // The Ox fired (+2 Actions), the Sheep did not (no coins).
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
  });
});

describe('Way of the Butterfly', () => {
  it('returns the played card to its pile and gains at exactly $1 more', async () => {
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(wayDef(['Way of the Butterfly']), (req, state) => {
      requests.push(req);
      if (req.kind === 'yesNo') return true;
      if (req.kind === 'pile') {
        // Smithy costs $4 — every offered pile must cost EXACTLY $5.
        const offered = req.cardIds.map((id) => state.cards[id].name);
        for (const name of offered) {
          expect(base.cards.find((c) => c.name === name)!.fields['dom_field_cost'],
            `${name} costs exactly $5`).toBe(5);
        }
        expect(offered).toContain('Duchy');
        return req.cardIds.find((id) => state.cards[id].name === 'Duchy')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    expect(supplyCount(engine.getState(), 'Smithy')).toBe(9); // one dealt out
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['yesNo', 'pile']);
    // The Smithy went home; the Duchy arrived.
    expect(supplyCount(state, 'Smithy')).toBe(10);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(names(state, DISCARD('p0'))).toEqual(['Duchy']);
  });

  it('declining the return gains nothing and leaves the card in play', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Butterfly']), (req) => {
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return false;
    });
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, INPLAY('p0'))).toEqual(['Smithy']);
    expect(supplyCount(state, 'Smithy')).toBe(9);
    expect(count(state, DISCARD('p0'))).toBe(0);
  });
});

describe('Way of the Camel', () => {
  it('exiles a Gold from the Supply', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Camel']), noChoices);
    await engine.start();
    const goldBefore = supplyCount(engine.getState(), 'Gold');
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, EXILE('p0'))).toEqual(['Gold']);
    expect(supplyCount(state, 'Gold')).toBe(goldBefore - 1);
  });
});

describe('Way of the Frog', () => {
  it('+1 Action now; at cleanup the discarded card hops onto the deck', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Frog']), noChoices);
    await engine.start();
    await playSmithyAsWay(engine);
    let state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    const smithy = findNamed(state, INPLAY('p0'), 'Smithy');
    expect(state.cards[smithy].vars[FROG_MARK]).toBe(1);

    // Cleanup sweeps it to the discard; the watcher then topdecks it (after
    // the 5-card redraw exactly drained the deck — the register's timing).
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, DECK('p0'))).toEqual(['Smithy']);
    expect(state.cards[smithy].vars[FROG_MARK]).toBe(0);
  });
});

describe('Way of the Goat', () => {
  it('trashes a card from your hand', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Goat']), (req) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      return req.cardIds[0];
    });
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, 'dom_zone_trash')).toBe(1);
    expect(count(state, HAND('p0'))).toBe(4); // 6 - Smithy - the trashed card
  });
});

describe('Way of the Horse', () => {
  it('+2 Cards +1 Action, and the played card returns to its supply pile', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Horse']), noChoices);
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Smithy + 2 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(supplyCount(state, 'Smithy')).toBe(10);
  });

  it('an actual Horse heads home to the Horse stock, not the Supply', async () => {
    const def = forge.pickLandscapes(base, ['Way of the Horse']);
    def.setup.push(dealNamed('Horse', 'dom_zone_hand', null, 'dom_zone_horses'));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    let state = engine.getState();
    expect(count(state, 'dom_zone_horses')).toBe(29);
    const horse = findNamed(state, HAND('p0'), 'Horse');
    await engine.performAction('p0', { actionId: 'dom_action_play_way', cardId: horse });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, 'dom_zone_horses')).toBe(30);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect(names(state, 'dom_zone_supply')).not.toContain('Horse');
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Horse + 2 drawn
  });
});

describe('Way of the Mole', () => {
  it('+1 Action, discards the hand, then draws 3', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Mole']), noChoices);
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(count(state, DISCARD('p0'))).toBe(5); // the 5 remaining hand cards
    expect(count(state, HAND('p0'))).toBe(3);
  });
});

describe('Way of the Monkey', () => {
  it('+1 Buy, +$1', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Monkey']), noChoices);
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
  });
});

describe('Way of the Mule', () => {
  it('+1 Action, +$1', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Mule']), noChoices);
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
  });
});

describe('Way of the Otter', () => {
  it('+2 Cards', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Otter']), noChoices);
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7); // 6 - Smithy + 2 drawn
  });
});

describe('Way of the Owl', () => {
  it('draws up to 6 cards in hand', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Owl']), noChoices);
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 5 after the play, +1 to reach 6
    expect(count(state, DECK('p0'))).toBe(4);
  });
});

describe('Way of the Ox', () => {
  it('+2 Actions', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Ox']), noChoices);
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 - 1 + 2
  });
});

describe('Way of the Pig', () => {
  it('+1 Card, +1 Action', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Pig']), noChoices);
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Smithy + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 - 1 + 1
  });
});

describe('Way of the Rat', () => {
  it('discarding a Treasure gains a supply copy of the played card — and the verified print grants NO +Action/+Buy', async () => {
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(wayDef(['Way of the Rat']), (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const copper = req.cardIds.find((id) => state.cards[id].name === 'Copper')!;
      return JSON.stringify([copper]);
    });
    await engine.start();
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    // The verified card face is JUST the copy-gain — no +1 Action, no +1 Buy.
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
    expect(state.players[0].vars['dom_var_buys']).toBe(1);
    expect(names(state, DISCARD('p0')).sort()).toEqual(['Copper', 'Smithy']);
    expect(supplyCount(state, 'Smithy')).toBe(8); // 10 - dealt - the copy
    expect(count(state, HAND('p0'))).toBe(4); // 6 - Smithy - Copper
  });
});

describe('Way of the Seal', () => {
  it('+$1, and this turn gained cards may go onto the deck; the flag fades at cleanup', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Seal']), (req) => {
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return true;
    });
    await engine.start();
    await playSmithyAsWay(engine);
    let state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.players[0].vars[SEAL_TURN_VAR]).toBe(1);

    // Buy a Copper: it lands in the discard, then the Seal offer topdecks it.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    const copper = findNamed(state, 'dom_zone_supply', 'Copper');
    await engine.performAction('p0', { actionId: 'dom_action_buy', cardId: copper });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(count(state, DECK('p0'))).toBe(6); // 5 + the topdecked Copper
    expect(names(state, DECK('p0'))).toContain('Copper');

    // The flag is per-turn: gone after cleanup.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars[SEAL_TURN_VAR]).toBe(0);
  });
});

describe('Way of the Squirrel', () => {
  it('nothing now; +2 Cards after the cleanup redraw', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Squirrel']), noChoices);
    await engine.start();
    await playSmithyAsWay(engine);
    let state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(5); // no instant draw
    expect(state.players[0].vars[SQUIRREL_TURN_VAR]).toBe(1);

    // Cleanup: redraw 5, THEN the squirrel's 2 — a 7-card next hand.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7);
    expect(state.players[0].vars[SQUIRREL_TURN_VAR]).toBe(0);
  });
});

describe('Way of the Turtle', () => {
  it('sets the played card aside and replays it at the next turn start, for free', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Turtle']), noChoices);
    await engine.start();

    // T1 (p0): the Smithy parks — no draw, marks on, the Action spent.
    await playSmithyAsWay(engine);
    let state = engine.getState();
    expect(count(state, HAND('p0'))).toBe(5);
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
    expect(names(state, DURATION('p0'))).toEqual(['Smithy']);
    expect(count(state, INPLAY('p0'))).toBe(0);
    const smithy = findNamed(state, DURATION('p0'), 'Smithy');
    expect(state.cards[smithy].vars[TURTLE_MARK]).toBe(1);
    // The Haven-aside shield keeps a parked Duration card's later-half inert.
    expect(state.cards[smithy].vars['dom_var_haven_aside']).toBe(1);

    // T1 cleanup spares the parked card; the opponent's turn passes.
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(names(state, DURATION('p0'))).toEqual(['Smithy']);
    await passTurn(engine, 'p1');

    // T3 (p0): the Smithy comes out of its shell and PLAYS — +3 Cards on top
    // of the redrawn 5, no Action spent, marks cleared.
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.log.some((l) => l.text.includes('plays the set-aside'))).toBe(true);
    expect(names(state, INPLAY('p0'))).toEqual(['Smithy']);
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(count(state, HAND('p0'))).toBe(8); // 5 redrawn + Smithy's 3
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.cards[smithy].vars[TURTLE_MARK]).toBe(0);
    expect(state.cards[smithy].vars['dom_var_haven_aside']).toBe(0);

    // T3 cleanup discards it like any played card (the redraw may reshuffle
    // it straight into the deck — "back in the deck cycle" is the stable
    // claim, and nowhere a set-aside card would linger).
    await passTurn(engine, 'p0');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DURATION('p0'))).toBe(0);
    expect(count(state, INPLAY('p0'))).toBe(0);
    expect([
      ...names(state, DISCARD('p0')), ...names(state, DECK('p0')), ...names(state, HAND('p0')),
    ]).toContain('Smithy');
  });
});

describe('Way of the Worm', () => {
  it('exiles an Estate from the Supply', async () => {
    const { engine, errors } = probeEngine(wayDef(['Way of the Worm']), noChoices);
    await engine.start();
    const estatesBefore = supplyCount(engine.getState(), 'Estate');
    await playSmithyAsWay(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, EXILE('p0'))).toEqual(['Estate']);
    expect(supplyCount(state, 'Estate')).toBe(estatesBefore - 1);
  });
});
