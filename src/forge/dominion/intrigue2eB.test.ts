/**
 * Intrigue 2E (part B) probes — deterministic per-card checks over the full
 * built def. The module's cards start in the hidden RESERVE, so every deal
 * pulls from there; supply/basic cards deal from the live supply.
 */
import { describe, expect, it } from 'vitest';
import type { EngineHandle } from '../../shared/types';
import { bnd, field, matching, move, neq, str, zone } from '../../examples/dsl';
import { buildDominionDef } from '../dominionGame';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

const RESERVE = 'dom_zone_reserve';
const HAND0 = 'dom_zone_hand:p0';

const noChoices = (): never => { throw new Error('no choices expected'); };

async function playFromHand(engine: EngineHandle, name: string): Promise<void> {
  const state = engine.getState();
  const id = findNamed(state, HAND0, name);
  await engine.performAction('p0', { actionId: 'dom_action_play', cardId: id });
}

describe('intrigue2eB card semantics', () => {
  it('Bridge: +1 Buy +$1, and the $1 discount makes a cost-4 pile buyable on 3 coins', async () => {
    const def = buildDominionDef();
    def.variables.find((v) => v.id === 'dom_var_coins')!.initial = 2;
    def.setup.push(dealNamed('Bridge', 'dom_zone_hand', null, RESERVE));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await playFromHand(engine, 'Bridge');
    let state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.globalVars['dom_var_cost_discount']).toBe(1);
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    const buys = engine.getLegalMoves('p0').filter((m) => m.actionId === 'dom_action_buy');
    const buyable = buys.map((m) => state.cards[m.cardId!].name);
    expect(buyable).toContain('Smithy');    // cost 4 — 3 coins + the discount
    expect(buyable).not.toContain('Duchy'); // cost 5 — still out of reach
    const smithy = buys.find((m) => state.cards[m.cardId!].name === 'Smithy')!;
    await engine.performAction('p0', smithy);
    state = engine.getState();
    expect(errors).toEqual([]);
    // Paid the DISCOUNTED price: 4 − 1 = 3 of the 3 coins.
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(state.zones['dom_zone_discard:p0'].cardIds.map((id) => state.cards[id].name))
      .toContain('Smithy');
  });

  it('Conspirator: tally counts this play; the 3rd Action adds +1 Card +1 Action; cleanup resets', async () => {
    const def = buildDominionDef();
    def.variables.find((v) => v.id === 'dom_var_actions')!.initial = 3;
    for (let i = 0; i < 3; i += 1) {
      def.setup.push(dealNamed('Conspirator', 'dom_zone_hand', null, RESERVE));
    }
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await playFromHand(engine, 'Conspirator');
    let state = engine.getState();
    expect(state.players[0].vars['dom_var_actions_played']).toBe(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.zones[HAND0].cardIds).toHaveLength(7); // 8 − 1, no bonus yet
    await playFromHand(engine, 'Conspirator');
    await playFromHand(engine, 'Conspirator');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions_played']).toBe(3);
    expect(state.players[0].vars['dom_var_coins']).toBe(6);
    // 8 − 3 played + the 3rd play's bonus card.
    expect(state.zones[HAND0].cardIds).toHaveLength(6);
    expect(state.zones['dom_zone_deck:p0'].cardIds).toHaveLength(4);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 3 − 3 + 1
    // The tally is per-turn state: cleanup wipes it.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions_played']).toBe(0);
  });

  it('Diplomat: +2 Cards, no +2 Actions when the hand ends up above 5', async () => {
    const def = buildDominionDef();
    def.setup.push(dealNamed('Diplomat', 'dom_zone_hand', null, RESERVE));
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    await playFromHand(engine, 'Diplomat');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.zones[HAND0].cardIds).toHaveLength(7); // 6 − 1 + 2 > 5
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
  });

  it('Diplomat: +2 Actions when the hand is 5 or fewer after drawing', async () => {
    const def = buildDominionDef();
    def.setup.push(
      dealNamed('Diplomat', 'dom_zone_hand', null, RESERVE),
      // Strip the rest of the opening hand back onto the deck: hand = Diplomat.
      move(
        matching(neq(field(bnd('$card'), 'name'), str('Diplomat'))),
        zone('dom_zone_hand', str('p0')), zone('dom_zone_deck', str('p0')),
        { faceUp: false },
      ),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    expect(engine.getState().zones[HAND0].cardIds).toHaveLength(1);
    await playFromHand(engine, 'Diplomat');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.zones[HAND0].cardIds).toHaveLength(2); // 1 − 1 + 2 ≤ 5
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 − 1 + 2
  });

  it('Diplomat reaction: reveal against an attack draws 2 then discards 3 — no immunity', async () => {
    const def = buildDominionDef();
    def.setup.push(
      dealNamed('Militia'),
      dealNamed('Diplomat', 'dom_zone_hand', 'p1', RESERVE),
    );
    const discardMins: number[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      discardMins.push(req.min);
      // Hand order is [5 starters, Diplomat, drawn…]: the first picks are
      // always starters, so the Diplomat itself is never discarded here.
      return JSON.stringify(req.cardIds.slice(0, req.min));
    });
    await engine.start();
    const militia = findNamed(engine.getState(), HAND0, 'Militia');
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: militia });
    // Attack pending; p0 has no responses and is auto-passed to p1.
    let state = engine.getState();
    expect(state.window).not.toBeNull();
    expect(state.window!.holderId).toBe('p1');
    const reveal = engine.getLegalMoves('p1')
      .find((m) => m.actionId === 'dom_action_reveal_diplomat');
    expect(reveal).toBeDefined();
    await engine.performAction('p1', reveal!);
    state = engine.getState();
    // Drew 2 (6 → 8), discarded exactly 3 → 5 in hand; NO Moat-style immunity.
    expect(state.zones['dom_zone_hand:p1'].cardIds).toHaveLength(5);
    expect(state.players[1].vars['dom_var_immune']).toBe(0);
    // Everyone passes — the Militia attack still hits p1: discard down to 3.
    await playOutWindows(engine);
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(state.zones['dom_zone_hand:p1'].cardIds).toHaveLength(3);
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(5); // 3 + 2
    expect(state.zones['dom_zone_deck:p1'].cardIds).toHaveLength(3); // 5 − 2 drawn
    expect(discardMins).toEqual([3, 2]); // Diplomat's exact 3, then Militia's 2
  });

  it('Diplomat then Moat: the reaction draws first, the Moat reveal still blocks the attack', async () => {
    const def = buildDominionDef();
    def.setup.push(
      dealNamed('Militia'),
      dealNamed('Diplomat', 'dom_zone_hand', 'p1', RESERVE),
      dealNamed('Moat', 'dom_zone_hand', 'p1'),
    );
    let cardsRequests = 0;
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      cardsRequests += 1;
      return JSON.stringify(req.cardIds.slice(0, req.min)); // starters first
    });
    await engine.start();
    const militia = findNamed(engine.getState(), HAND0, 'Militia');
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: militia });
    const reveal = engine.getLegalMoves('p1')
      .find((m) => m.actionId === 'dom_action_reveal_diplomat');
    expect(reveal).toBeDefined();
    await engine.performAction('p1', reveal!); // 7 + 2 − 3 = 6 in hand
    // Now reveal for immunity and let the windows run out.
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    // Immune: the Militia never made p1 discard — hand stays at 6, and only
    // the Diplomat's own 3 discards ever happened.
    expect(state.zones['dom_zone_hand:p1'].cardIds).toHaveLength(6);
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(3);
    expect(cardsRequests).toBe(1);
    // Per-attack immunity has already faded (effectResolved reset).
    expect(state.players[1].vars['dom_var_immune']).toBe(0);
  });

  it('Ironworks: gains up to $4 with the type bonus per gained card (duals stack)', async () => {
    const def = buildDominionDef();
    def.variables.find((v) => v.id === 'dom_var_actions')!.initial = 3;
    for (let i = 0; i < 3; i += 1) {
      def.setup.push(dealNamed('Ironworks', 'dom_zone_hand', null, RESERVE));
    }
    const wants = ['Silver', 'Estate', 'Village'];
    let pick = 0;
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      const want = wants[pick];
      pick += 1;
      const id = req.cardIds.find((cid) => state.cards[cid].name === want);
      if (id === undefined) throw new Error(`no ${want} pile offered`);
      return id;
    });
    await engine.start();
    await playFromHand(engine, 'Ironworks'); // gains Silver → +$1
    await playFromHand(engine, 'Ironworks'); // gains Estate → +1 Card
    await playFromHand(engine, 'Ironworks'); // gains Village → +1 Action
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(pick).toBe(3);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 3 − 3 + 1
    expect(state.zones[HAND0].cardIds).toHaveLength(6); // 8 − 3 + 1 drawn
    const gained = state.zones['dom_zone_discard:p0'].cardIds
      .map((id) => state.cards[id].name).sort();
    expect(gained).toEqual(['Estate', 'Silver', 'Village']);
    // Tagged 'gain' recount already priced the Estate in, mid-turn.
    expect(state.players[0].vars['dom_var_vp']).toBe(4);
  });

  it('Mill: +1 Card +1 Action, discards exactly 2 for +$2, and its printed VP scores', async () => {
    const def = buildDominionDef();
    def.setup.push(dealNamed('Mill', 'dom_zone_hand', null, RESERVE));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind === 'option') return 'discard';
      if (req.kind === 'cards') {
        expect(req.min).toBe(2);
        expect(req.max).toBe(2);
        return JSON.stringify(req.cardIds.slice(0, 2));
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await playFromHand(engine, 'Mill');
    let state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.zones[HAND0].cardIds).toHaveLength(4); // 6 − 1 + 1 − 2
    expect(state.zones['dom_zone_discard:p0'].cardIds).toHaveLength(2);
    // The printed 1 VP rides the recount: 3 Estates + the Mill.
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp']).toBe(4);
    expect(state.players[1].vars['dom_var_vp']).toBe(3);
  });

  it('Mill: declining the discard costs nothing and pays nothing', async () => {
    const def = buildDominionDef();
    def.setup.push(dealNamed('Mill', 'dom_zone_hand', null, RESERVE));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'keep';
    });
    await engine.start();
    await playFromHand(engine, 'Mill');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(state.zones[HAND0].cardIds).toHaveLength(6); // 6 − 1 + 1
    expect(state.zones['dom_zone_discard:p0'].cardIds).toHaveLength(0);
  });

  it('Mining Village: +1 Card +2 Actions, and trashing itself pays +$2', async () => {
    const def = buildDominionDef();
    def.setup.push(dealNamed('Mining Village', 'dom_zone_hand', null, RESERVE));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'trash';
    });
    await engine.start();
    await playFromHand(engine, 'Mining Village');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 − 1 + 2
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.zones[HAND0].cardIds).toHaveLength(6); // 6 − 1 + 1
    expect(state.zones['dom_zone_trash'].cardIds.map((id) => state.cards[id].name))
      .toEqual(['Mining Village']);
    expect(state.zones['dom_zone_inplay:p0'].cardIds).toHaveLength(0);
  });

  it('Mining Village: keeping it leaves it in play for no coins', async () => {
    const def = buildDominionDef();
    def.setup.push(dealNamed('Mining Village', 'dom_zone_hand', null, RESERVE));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'keep';
    });
    await engine.start();
    await playFromHand(engine, 'Mining Village');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(state.zones['dom_zone_inplay:p0'].cardIds.map((id) => state.cards[id].name))
      .toEqual(['Mining Village']);
    expect(state.zones['dom_zone_trash'].cardIds).toHaveLength(0);
  });

  it('Secret Passage: the chosen card goes to the deck top or bottom', async () => {
    const def = buildDominionDef();
    def.variables.find((v) => v.id === 'dom_var_actions')!.initial = 2;
    def.setup.push(
      dealNamed('Secret Passage', 'dom_zone_hand', null, RESERVE),
      dealNamed('Secret Passage', 'dom_zone_hand', null, RESERVE),
      // Distinct markers no starter deck contains.
      dealNamed('Duke', 'dom_zone_hand', null, RESERVE),
      dealNamed('Bridge', 'dom_zone_hand', null, RESERVE),
    );
    let stage = 0;
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card') {
        const want = stage === 0 ? 'Duke' : 'Bridge';
        stage += 1;
        const id = req.cardIds.find((cid) => state.cards[cid].name === want);
        if (id === undefined) throw new Error(`no ${want} offered`);
        return id;
      }
      if (req.kind === 'option') return stage === 1 ? 'top' : 'bottom';
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await playFromHand(engine, 'Secret Passage'); // Duke → deck TOP
    let state = engine.getState();
    expect(errors).toEqual([]);
    let deck = state.zones['dom_zone_deck:p0'].cardIds;
    expect(state.cards[deck[deck.length - 1]].name).toBe('Duke'); // top = last
    expect(state.zones[HAND0].cardIds).toHaveLength(9); // 9 − 1 + 2 − 1
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 2 − 1 + 1
    await playFromHand(engine, 'Secret Passage'); // Bridge → deck BOTTOM
    state = engine.getState();
    expect(errors).toEqual([]);
    deck = state.zones['dom_zone_deck:p0'].cardIds;
    expect(state.cards[deck[0]].name).toBe('Bridge'); // bottom = first
    // The topdecked Duke came right back with the second play's +2 Cards.
    expect(state.zones[HAND0].cardIds.map((id) => state.cards[id].name)).toContain('Duke');
  });

  it('Courtier: one bonus per type — Militia gives two picks, Copper one', async () => {
    const def = buildDominionDef();
    def.variables.find((v) => v.id === 'dom_var_actions')!.initial = 2;
    def.setup.push(
      dealNamed('Courtier', 'dom_zone_hand', null, RESERVE),
      dealNamed('Courtier', 'dom_zone_hand', null, RESERVE),
      dealNamed('Militia'),
    );
    const optionAnswers = ['coins', 'gold', 'buy'];
    let cardPicks = 0;
    let optionPicks = 0;
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card') {
        const want = cardPicks === 0 ? 'Militia' : 'Copper';
        cardPicks += 1;
        const id = req.cardIds.find((cid) => state.cards[cid].name === want);
        if (id === undefined) throw new Error(`no ${want} in hand`);
        return id;
      }
      if (req.kind === 'option') {
        const a = optionAnswers[optionPicks];
        optionPicks += 1;
        return a;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    // Reveal Militia (Action – Attack = 2 types): +$3, then gain a Gold.
    await playFromHand(engine, 'Courtier');
    let state = engine.getState();
    expect(errors).toEqual([]);
    expect(optionPicks).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(state.zones['dom_zone_discard:p0'].cardIds.map((id) => state.cards[id].name))
      .toEqual(['Gold']);
    // The revealed Militia stays in hand.
    expect(state.zones[HAND0].cardIds.map((id) => state.cards[id].name)).toContain('Militia');
    // Reveal a Copper (1 type): a single pick — +1 Buy.
    await playFromHand(engine, 'Courtier');
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(optionPicks).toBe(3);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(state.players[0].vars['dom_var_actions']).toBe(0); // 2 − 2, no action pick
  });

  it('Duke: worth 1 VP per Duchy at the recount, and never playable as an Action', async () => {
    const def = buildDominionDef();
    def.setup.push(
      dealNamed('Duke', 'dom_zone_discard', null, RESERVE),
      dealNamed('Duke', 'dom_zone_discard', null, RESERVE),
      dealNamed('Duke', 'dom_zone_hand', null, RESERVE),
      dealNamed('Duchy', 'dom_zone_discard'),
    );
    const { engine, errors } = probeEngine(def, noChoices);
    await engine.start();
    // Victory-typed: the play action never offers it.
    const state0 = engine.getState();
    const playable = engine.getLegalMoves('p0')
      .filter((m) => m.actionId === 'dom_action_play')
      .map((m) => state0.cards[m.cardId!].name);
    expect(playable).not.toContain('Duke');
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // 3 Estates + Duchy (3) + 3 Dukes × 1 Duchy = 9.
    expect(state.players[0].vars['dom_var_vp']).toBe(9);
    expect(state.players[1].vars['dom_var_vp']).toBe(3);
  });
});
