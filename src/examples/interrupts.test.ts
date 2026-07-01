/**
 * Deterministic interrupt-system tests for the three TCG examples, played
 * through the REAL engine with scripted move sequences (like engine/stack
 * tests). Decks are de-randomized per test (shuffle off, curated entry order:
 * cards spawn in entry order, so the LAST entries are the top of the deck and
 * become the opening hand) — every other rule comes straight from the def.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest, GameDef, GameState, Id } from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import { createEngine } from '../engine';
import { bestCard, bnd, eq, field, move, specific, str, zone } from './dsl';
import { dominionGame } from './dominion';
import { mtgGame } from './mtg';
import { ygoGame } from './ygo';

// ---------------------------------------------------------------------------
// Local scripted harness
// ---------------------------------------------------------------------------

function scripted(def: GameDef, playerCount: number) {
  const errors: string[] = [];
  const requests: ChoiceRequest[] = [];
  const engine = createEngine(def, {
    playerNames: ['Ada', 'Brook', 'Caro'].slice(0, playerCount),
    aiSeats: new Array(playerCount).fill(false),
    seed: 7,
    choiceProvider: {
      resolve(req) {
        requests.push(req);
        // The only choice these scripts expect is a multi-select; answer with
        // the first `min` candidates. Anything else fails the errors check.
        if (req.kind === 'cards') return Promise.resolve(JSON.stringify(req.cardIds.slice(0, req.min)));
        throw new Error(`unexpected choice: ${req.prompt}`);
      },
    },
    onUpdate: () => {},
    onScriptError: (m) => errors.push(m),
  });
  return { engine, errors, requests, state: () => engine.getState() };
}

function cardsIn(state: GameState, zoneKey: string): string[] {
  return state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
}

type Engine = ReturnType<typeof scripted>['engine'];

/** Perform the named action, optionally on the (first) card with this name. */
async function act(engine: Engine, playerId: Id, actionId: string, cardName?: string): Promise<void> {
  const state = engine.getState();
  const moves = engine.getLegalMoves(playerId).filter((m) => m.actionId === actionId);
  const chosen = cardName
    ? moves.find((m) => m.cardId !== undefined && state.cards[m.cardId].name === cardName)
    : moves[0];
  if (!chosen) {
    throw new Error(`no legal "${actionId}"${cardName ? ` on ${cardName}` : ''} for ${playerId}`);
  }
  await engine.performAction(playerId, chosen);
}

function pass(engine: Engine, playerId: Id): Promise<void> {
  return engine.performAction(playerId, { actionId: PASS_ACTION_ID });
}

// ---------------------------------------------------------------------------
// (a) MTG: Counterspell cancels Divination in the response window
// ---------------------------------------------------------------------------

describe('MTG interrupt: Counterspell vs Divination', () => {
  function fixedMtg(): GameDef {
    const def = structuredClone(mtgGame);
    const deck = def.decks[0];
    deck.shuffle = false;
    // Bottom-to-top spawn order; the top 7 (5 Islands + Divination +
    // Counterspell) become each player's opening hand, mountains get drawn.
    deck.source = {
      kind: 'custom',
      entries: [
        { cardId: 'mtg_card_mountain', count: 13 },
        { cardId: 'mtg_card_island', count: 5 },
        { cardId: 'mtg_card_divination', count: 1 },
        { cardId: 'mtg_card_counterspell', count: 1 },
      ],
    };
    return def;
  }

  it('cancelled Divination draws nothing and both spells hit the graveyards', async () => {
    const h = scripted(fixedMtg(), 2);
    await h.engine.start();

    // Two full rounds of land drops (p0 and p1 reach 2 lands each) ...
    for (let round = 0; round < 2; round++) {
      for (const pid of ['p0', 'p1'] as const) {
        await act(h.engine, pid, 'mtg_action_land', 'Island');
        await act(h.engine, pid, 'mtg_action_combat');
        await act(h.engine, pid, 'mtg_action_end_turn');
      }
    }
    // ... then p0's third turn: drop the third Island and stay in Main.
    await act(h.engine, 'p0', 'mtg_action_land', 'Island');

    // p0: float 3 mana, cast Divination -> it goes on the stack, window opens.
    for (let i = 0; i < 3; i++) await act(h.engine, 'p0', 'mtg_action_tap');
    const deckBefore = h.state().zones['mtg_zone_deck:p0'].cardIds.length;
    const handBefore = h.state().zones['mtg_zone_hand:p0'].cardIds.length;
    await act(h.engine, 'p0', 'mtg_action_cast', 'Divination');

    expect(h.state().stack).toHaveLength(1);
    expect(h.state().window?.holderId).toBe('p0');
    expect(cardsIn(h.state(), 'mtg_zone_thestack')).toEqual(['Divination']);
    // Only response-speed moves + the pass move are offered to the holder.
    const holderMoves = h.engine.getLegalMoves('p0');
    expect(holderMoves.some((m) => m.actionId === PASS_ACTION_ID)).toBe(true);
    expect(holderMoves.some((m) => m.actionId === 'mtg_action_land')).toBe(false);
    expect(h.engine.getLegalMoves('p1')).toEqual([]);

    // p1 responds in the window: tap two Islands, then cast Counterspell.
    await pass(h.engine, 'p0');
    expect(h.engine.getLegalMoves('p1').some((m) => m.actionId === 'mtg_action_tap')).toBe(true);
    await act(h.engine, 'p1', 'mtg_action_tap');
    await pass(h.engine, 'p0');
    await act(h.engine, 'p1', 'mtg_action_tap');
    await pass(h.engine, 'p0');
    await act(h.engine, 'p1', 'mtg_action_cast', 'Counterspell');
    expect(h.state().stack).toHaveLength(2);

    // Everyone passes: Counterspell resolves first (LIFO) and cancels.
    await pass(h.engine, 'p0');
    await pass(h.engine, 'p1');

    const s = h.state();
    expect(s.stack).toHaveLength(0);
    expect(s.window).toBeNull();
    expect(s.zones['mtg_zone_thestack'].cardIds).toHaveLength(0);
    expect(cardsIn(s, 'mtg_zone_graveyard:p0')).toEqual(['Divination']);
    expect(cardsIn(s, 'mtg_zone_graveyard:p1')).toEqual(['Counterspell']);
    // No cards were drawn: hand only lost the cast Divination, deck untouched.
    expect(s.zones['mtg_zone_hand:p0'].cardIds).toHaveLength(handBefore - 1);
    expect(s.zones['mtg_zone_deck:p0'].cardIds).toHaveLength(deckBefore);
    expect(h.requests).toHaveLength(0);
    expect(h.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (b) Yu-Gi-Oh: Trap Hole cancels a Normal Summon
// ---------------------------------------------------------------------------

describe('Yu-Gi-Oh interrupt: Trap Hole vs La Jinn', () => {
  const LA_JINN = 'La Jinn the Mystical Genie of the Lamp';

  function fixedYgo(): GameDef {
    const def = structuredClone(ygoGame);
    const deck = def.decks[0];
    deck.shuffle = false;
    // Opening hand (top 5): 3 Celtic Guardians + Trap Hole + La Jinn.
    deck.source = {
      kind: 'custom',
      entries: [
        { cardId: 'ygo_card_mystical_elf', count: 19 },
        { cardId: 'ygo_card_la_jinn', count: 1 },
        { cardId: 'ygo_card_trap_hole', count: 1 },
        { cardId: 'ygo_card_celtic_guardian', count: 3 },
      ],
    };
    return def;
  }

  it('the summon is cancelled and La Jinn lands in its owner\'s graveyard', async () => {
    const h = scripted(fixedYgo(), 2);
    await h.engine.start();

    // p0 turn: set Trap Hole face-down, then pass the turn.
    await act(h.engine, 'p0', 'ygo_action_set', 'Trap Hole');
    expect(h.state().zones['ygo_zone_spelltrap:p0'].cardIds).toHaveLength(1);
    const trapId = h.state().zones['ygo_zone_spelltrap:p0'].cardIds[0];
    expect(h.state().cards[trapId].faceUp).toBe(false);
    await act(h.engine, 'p0', 'ygo_action_battle');
    await act(h.engine, 'p0', 'ygo_action_end_turn');

    // p1 turn: normal-summon La Jinn (1800 ATK) -> stacked, window opens.
    await act(h.engine, 'p1', 'ygo_action_summon', LA_JINN);
    expect(h.state().stack).toHaveLength(1);
    expect(h.state().window?.holderId).toBe('p1');
    expect(cardsIn(h.state(), 'ygo_zone_monsters:p1')).toEqual([LA_JINN]);

    // p1 holds priority and passes; p0 springs the trap (inline response).
    await pass(h.engine, 'p1');
    const trapMoves = h.engine.getLegalMoves('p0').filter((m) => m.actionId === 'ygo_action_trap');
    expect(trapMoves).toHaveLength(1);
    await h.engine.performAction('p0', trapMoves[0]);

    // The summon entry was cancelled on the spot.
    expect(h.state().stack).toHaveLength(0);
    expect(cardsIn(h.state(), 'ygo_zone_monsters:p1')).toEqual([]);
    expect(cardsIn(h.state(), 'ygo_zone_graveyard:p1')).toEqual([LA_JINN]);
    expect(cardsIn(h.state(), 'ygo_zone_graveyard:p0')).toEqual(['Trap Hole']);
    expect(h.state().zones['ygo_zone_spelltrap:p0'].cardIds).toHaveLength(0);

    // Close the (now empty) window; nothing resolves.
    await pass(h.engine, 'p1');
    await pass(h.engine, 'p0');
    const s = h.state();
    expect(s.window).toBeNull();
    // The summon's resolution never ran.
    expect(s.log.some((l) => l.text.includes('stands ready'))).toBe(false);
    // The normal summon for the turn is still spent — it WAS declared.
    expect(s.players.find((p) => p.id === 'p1')!.vars['ygo_var_summoned']).toBe(1);
    expect(h.errors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (c) Dominion: Moat blocks Militia for one player, the third still discards
// ---------------------------------------------------------------------------

describe('Dominion interrupt: Moat vs Militia (3 players)', () => {
  function fixedDominion(): GameDef {
    const def = structuredClone(dominionGame);
    // Hand out the key cards from the supply during setup: bestCard picks one
    // specific Militia/Moat copy (all tie on cost; nearest the top wins).
    const grab = (cardName: string, playerId: string) => move(
      // NOTE: the def's field ids are prefixed — 'cost' alone would NaN out
      // every candidate inside bestCard and silently grab nothing.
      specific(bestCard(zone('dom_zone_supply'), 'highest', 'dom_field_cost',
        eq(field(bnd('$card'), 'name'), str(cardName)))),
      zone('dom_zone_supply'),
      zone('dom_zone_hand', str(playerId)),
      { faceUp: true },
    );
    def.setup = [...def.setup, grab('Militia', 'p0'), grab('Moat', 'p1')];
    return def;
  }

  it('the Moat player keeps 5+ cards while the third player discards to 3', async () => {
    const h = scripted(fixedDominion(), 3);
    await h.engine.start();

    expect(h.state().zones['dom_zone_hand:p0'].cardIds).toHaveLength(6); // 5 + Militia
    expect(h.state().zones['dom_zone_hand:p1'].cardIds).toHaveLength(6); // 5 + Moat
    expect(h.state().zones['dom_zone_hand:p2'].cardIds).toHaveLength(5);

    // p0 plays Militia: +2 coins immediately, the attack goes on the stack.
    await act(h.engine, 'p0', 'dom_action_play', 'Militia');
    expect(h.state().stack).toHaveLength(1);
    expect(h.state().window?.holderId).toBe('p0');
    expect(h.state().players[0].vars['dom_var_coins']).toBe(2);

    // Priority rotates from the turn player: p0 passes, p1 reveals Moat.
    await pass(h.engine, 'p0');
    const reveal = h.engine.getLegalMoves('p1').filter((m) => m.actionId === 'dom_action_reveal_moat');
    expect(reveal).toHaveLength(1);
    await h.engine.performAction('p1', reveal[0]);
    expect(h.state().players[1].vars['dom_var_immune']).toBe(1);

    // p2 has no reaction — everyone passes and the Militia attack resolves.
    expect(h.engine.getLegalMoves('p2').map((m) => m.actionId)).toEqual([PASS_ACTION_ID]);
    await pass(h.engine, 'p2');
    await pass(h.engine, 'p0');
    await pass(h.engine, 'p1');

    const s = h.state();
    expect(s.stack).toHaveLength(0);
    expect(s.window).toBeNull();
    // p1 was immune: full hand kept (Moat itself stays in hand on a reveal).
    expect(s.zones['dom_zone_hand:p1'].cardIds).toHaveLength(6);
    // p2 discarded down to 3, the discards landed in p2's discard pile.
    expect(s.zones['dom_zone_hand:p2'].cardIds).toHaveLength(3);
    expect(s.zones['dom_zone_discard:p2'].cardIds).toHaveLength(2);
    // p0 only lost the played Militia.
    expect(s.zones['dom_zone_hand:p0'].cardIds).toHaveLength(5);
    expect(cardsIn(s, 'dom_zone_inplay:p0')).toEqual(['Militia']);
    // The immunity flag is consumed by the resolution.
    expect(s.players[1].vars['dom_var_immune']).toBe(0);
    // Exactly one choice was asked: p2's forced discard.
    expect(h.requests).toHaveLength(1);
    expect(h.requests[0]).toMatchObject({ kind: 'cards', playerId: 'p2', min: 2, max: 2 });
    expect(h.errors).toEqual([]);
  });
});
