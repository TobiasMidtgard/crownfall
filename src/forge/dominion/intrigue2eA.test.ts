/**
 * Intrigue 2E (part A) — deterministic probes for Courtyard, Lurker, Pawn,
 * Masquerade, Shanty Town, Steward, Swindler, Wishing Well, Baron.
 *
 * Cards outside the active kingdom start in the hidden reserve, so every
 * probe deals them with fromZone 'dom_zone_reserve'. Named basics (Gold,
 * Estate, Silver…) deal straight from the supply. Seed 11, players p0/p1.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest } from '../../shared/types';
import { buildDominionDef } from '../dominionGame';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

const HAND0 = 'dom_zone_hand:p0';
const HAND1 = 'dom_zone_hand:p1';
const DECK0 = 'dom_zone_deck:p0';
const DECK1 = 'dom_zone_deck:p1';
const DISCARD0 = 'dom_zone_discard:p0';
const DISCARD1 = 'dom_zone_discard:p1';
const TRASH = 'dom_zone_trash';
const RESERVE = 'dom_zone_reserve';

const names = (state: ReturnType<ReturnType<typeof probeEngine>['engine']['getState']>, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);

describe('Intrigue 2E part A (deterministic probes)', () => {
  it('Courtyard draws 3 and puts a chosen card back on top of the deck', async () => {
    const def = buildDominionDef();
    def.setup.push(
      dealNamed('Courtyard', 'dom_zone_hand', null, RESERVE),
      dealNamed('Gold', 'dom_zone_hand'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      const gold = req.cardIds.find((id) => state.cards[id].name === 'Gold');
      if (!gold) throw new Error('no Gold offered');
      return gold;
    });
    await engine.start();
    let state = engine.getState();
    expect(state.zones[HAND0].cardIds).toHaveLength(7); // 5 drawn + 2 dealt
    const courtyard = findNamed(state, HAND0, 'Courtyard');
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: courtyard });
    state = engine.getState();
    expect(errors).toEqual([]);
    // 7 − Courtyard + 3 drawn − 1 put back.
    expect(state.zones[HAND0].cardIds).toHaveLength(8);
    // Deck: 5 − 3 drawn + 1 put back; the Gold sits on TOP (last index).
    const deck = state.zones[DECK0].cardIds;
    expect(deck).toHaveLength(3);
    expect(state.cards[deck[deck.length - 1]].name).toBe('Gold');
    expect(names(state, HAND0)).not.toContain('Gold');
  });

  it('Lurker trashes an Action from the Supply, then a second Lurker gains it from the trash', async () => {
    const def = buildDominionDef();
    def.setup.push(
      dealNamed('Lurker', 'dom_zone_hand', null, RESERVE),
      dealNamed('Lurker', 'dom_zone_hand', null, RESERVE),
    );
    let optionsSeen = 0;
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'option') {
        optionsSeen += 1;
        return optionsSeen === 1 ? 'lurker_trash' : 'lurker_gain';
      }
      if (req.kind === 'pile') {
        const village = req.cardIds.find((id) => state.cards[id].name === 'Village');
        if (!village) throw new Error('no Village pile offered');
        return village;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    const lurkers = state.zones[HAND0].cardIds.filter((id) => state.cards[id].name === 'Lurker');
    expect(lurkers).toHaveLength(2);

    // Lurker #1: trash a Village straight off the live supply.
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: lurkers[0] });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual(['Village']);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 − 1 + 1

    // Lurker #2: gain that Village from the trash (tagged 'gain').
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: lurkers[1] });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, TRASH)).toEqual([]);
    expect(names(state, DISCARD0)).toEqual(['Village']);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
  });

  it('Pawn grants two DIFFERENT bonuses — the second menu drops the first pick', async () => {
    const def = buildDominionDef();
    def.setup.push(dealNamed('Pawn', 'dom_zone_hand', null, RESERVE));
    const optionReqs: Extract<ChoiceRequest, { kind: 'option' }>[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      optionReqs.push(req);
      return optionReqs.length === 1 ? 'pawn_card' : 'pawn_coin';
    });
    await engine.start();
    let state = engine.getState();
    const pawn = findNamed(state, HAND0, 'Pawn');
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: pawn });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(optionReqs).toHaveLength(2);
    expect(optionReqs[0].options.map((o) => o.id)).toEqual([
      'pawn_card', 'pawn_action', 'pawn_buy', 'pawn_coin',
    ]);
    // Exact-different semantics: the first pick is simply not offered again.
    expect(optionReqs[1].options.map((o) => o.id)).toEqual([
      'pawn_action', 'pawn_buy', 'pawn_coin',
    ]);
    expect(state.zones[HAND0].cardIds).toHaveLength(6); // 6 − Pawn + 1 drawn
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(state.players[0].vars['dom_var_actions']).toBe(0); // spent on the play
    expect(state.players[0].vars['dom_var_buys']).toBe(1);
  });

  it('Masquerade passes hand-to-hand around the table, then trashes optionally', async () => {
    const def = buildDominionDef();
    def.setup.push(
      dealNamed('Masquerade', 'dom_zone_hand', null, RESERVE),
      dealNamed('Gold', 'dom_zone_hand'),          // p0 will pass this
      dealNamed('Duchy', 'dom_zone_hand', 'p1'),   // p1 will pass this back
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card') {
        const want = req.playerId === 'p0' ? 'Gold' : 'Duchy';
        const pick = req.cardIds.find((id) => state.cards[id].name === want);
        if (!pick) throw new Error(`no ${want} offered to ${req.playerId}`);
        return pick;
      }
      if (req.kind === 'cards') {
        // The optional trash: bin the Duchy p1 just passed over.
        const duchy = req.cardIds.find((id) => state.cards[id].name === 'Duchy');
        if (!duchy) throw new Error('no Duchy in the trash offer');
        return JSON.stringify([duchy]);
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    let state = engine.getState();
    const masq = findNamed(state, HAND0, 'Masquerade');
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: masq });
    state = engine.getState();
    expect(errors).toEqual([]);
    // p0: 7 − Masquerade + 2 drawn − Gold passed + Duchy received − Duchy trashed.
    expect(state.zones[HAND0].cardIds).toHaveLength(7);
    expect(names(state, HAND0)).not.toContain('Gold');
    expect(names(state, HAND0)).not.toContain('Duchy');
    // p1: 6 − Duchy passed + Gold received.
    expect(state.zones[HAND1].cardIds).toHaveLength(6);
    expect(names(state, HAND1)).toContain('Gold');
    expect(names(state, TRASH)).toEqual(['Duchy']);
  });

  it('Shanty Town gives +2 Actions, and +2 Cards only with no Action in hand', async () => {
    // No Action in hand (starters are all Copper/Estate): the draw fires.
    const def1 = buildDominionDef();
    def1.setup.push(dealNamed('Shanty Town', 'dom_zone_hand', null, RESERVE));
    const probe1 = probeEngine(def1, () => { throw new Error('no choices expected'); });
    await probe1.engine.start();
    let state = probe1.engine.getState();
    const shanty1 = findNamed(state, HAND0, 'Shanty Town');
    await probe1.engine.performAction('p0', { actionId: 'dom_action_play', cardId: shanty1 });
    state = probe1.engine.getState();
    expect(probe1.errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 − 1 + 2
    expect(state.zones[HAND0].cardIds).toHaveLength(7); // 6 − played + 2 drawn

    // A Village in hand: the reveal shows an Action, no draw.
    const def2 = buildDominionDef();
    def2.setup.push(
      dealNamed('Shanty Town', 'dom_zone_hand', null, RESERVE),
      dealNamed('Village', 'dom_zone_hand'),
    );
    const probe2 = probeEngine(def2, () => { throw new Error('no choices expected'); });
    await probe2.engine.start();
    state = probe2.engine.getState();
    const shanty2 = findNamed(state, HAND0, 'Shanty Town');
    await probe2.engine.performAction('p0', { actionId: 'dom_action_play', cardId: shanty2 });
    state = probe2.engine.getState();
    expect(probe2.errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(2);
    expect(state.zones[HAND0].cardIds).toHaveLength(6); // 7 − played, no draw
  });

  it('Steward: each of the three modes works (trash asks for exactly 2)', async () => {
    const run = async (mode: string) => {
      const def = buildDominionDef();
      def.setup.push(dealNamed('Steward', 'dom_zone_hand', null, RESERVE));
      const cardsReqs: Extract<ChoiceRequest, { kind: 'cards' }>[] = [];
      const probe = probeEngine(def, (req) => {
        if (req.kind === 'option') return mode;
        if (req.kind === 'cards') {
          cardsReqs.push(req);
          return JSON.stringify(req.cardIds.slice(0, req.min));
        }
        throw new Error(`unexpected ${req.kind} choice`);
      });
      await probe.engine.start();
      const steward = findNamed(probe.engine.getState(), HAND0, 'Steward');
      await probe.engine.performAction('p0', { actionId: 'dom_action_play', cardId: steward });
      return { state: probe.engine.getState(), errors: probe.errors, cardsReqs };
    };

    const cards = await run('steward_cards');
    expect(cards.errors).toEqual([]);
    expect(cards.state.zones[HAND0].cardIds).toHaveLength(7); // 6 − played + 2

    const coins = await run('steward_coins');
    expect(coins.errors).toEqual([]);
    expect(coins.state.players[0].vars['dom_var_coins']).toBe(2);

    const trash = await run('steward_trash');
    expect(trash.errors).toEqual([]);
    expect(trash.cardsReqs).toHaveLength(1);
    expect(trash.cardsReqs[0].min).toBe(2); // SCRATCH clamp: full hand → exactly 2
    expect(trash.cardsReqs[0].max).toBe(2);
    expect(trash.state.zones[TRASH].cardIds).toHaveLength(2);
    expect(trash.state.zones[HAND0].cardIds).toHaveLength(3); // 6 − played − 2
  });

  it('Swindler trashes the victim’s deck top and the ATTACKER picks the same-cost gain', async () => {
    const def = buildDominionDef();
    def.setup.push(
      dealNamed('Swindler', 'dom_zone_hand', null, RESERVE),
      dealNamed('Silver', 'dom_zone_deck', 'p1'), // a known cost-3 deck top
    );
    const pileReqs: Extract<ChoiceRequest, { kind: 'pile' }>[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      pileReqs.push(req);
      const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver');
      if (!silver) throw new Error('no Silver pile offered');
      return silver;
    });
    await engine.start();
    let state = engine.getState();
    expect(state.zones[DECK1].cardIds).toHaveLength(6); // 5 + the dealt Silver
    const swindler = findNamed(state, HAND0, 'Swindler');
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: swindler });
    await playOutWindows(engine); // nobody reveals
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    expect(state.stack).toHaveLength(0);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    // The attacker chose among EXACTLY the cost-3 piles of the First Game supply.
    expect(pileReqs).toHaveLength(1);
    const offered = pileReqs[0].cardIds.map((id) => state.cards[id].name).sort();
    expect(offered).toEqual(['Silver', 'Village', 'Workshop']);
    // Silver trashed off p1's deck; the chosen Silver gained to p1's discard.
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(names(state, DISCARD1)).toEqual(['Silver']);
    expect(state.zones[DECK1].cardIds).toHaveLength(5);
  });

  it('Swindler: a revealed Moat blocks the swindle entirely', async () => {
    const def = buildDominionDef();
    def.setup.push(
      dealNamed('Swindler', 'dom_zone_hand', null, RESERVE),
      dealNamed('Moat', 'dom_zone_hand', 'p1'),
      dealNamed('Silver', 'dom_zone_deck', 'p1'),
    );
    const { engine, errors } = probeEngine(def, () => {
      throw new Error('no choices expected — the attack was moated');
    });
    await engine.start();
    let state = engine.getState();
    const swindler = findNamed(state, HAND0, 'Swindler');
    await engine.performAction('p0', { actionId: 'dom_action_play', cardId: swindler });
    expect(engine.getState().window).not.toBeNull();
    await playOutWindows(engine, 'p1'); // p1 reveals the Moat
    state = engine.getState();
    expect(errors).toEqual([]);
    // Nothing trashed, nothing gained; the deck top survives; coins still paid.
    expect(state.zones[TRASH].cardIds).toHaveLength(0);
    expect(state.zones[DISCARD1].cardIds).toHaveLength(0);
    expect(state.zones[DECK1].cardIds).toHaveLength(6);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    // Immunity faded the moment the attack resolved (shared effectResolved).
    expect(state.players[1].vars['dom_var_immune']).toBe(0);
  });

  it('Wishing Well: naming the deck top puts it into your hand; a miss leaves it', async () => {
    // HIT: deck is [.., Silver, Province] (Province on top). +1 Card draws the
    // Province; naming Silver then matches the newly revealed top.
    const def1 = buildDominionDef();
    def1.setup.push(
      dealNamed('Wishing Well', 'dom_zone_hand', null, RESERVE),
      dealNamed('Silver', 'dom_zone_deck'),
      dealNamed('Province', 'dom_zone_deck'),
    );
    const pileReqs: Extract<ChoiceRequest, { kind: 'pile' }>[] = [];
    const probe1 = probeEngine(def1, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      pileReqs.push(req);
      const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver');
      if (!silver) throw new Error('no Silver pile to name');
      return silver;
    });
    await probe1.engine.start();
    let state = probe1.engine.getState();
    const well1 = findNamed(state, HAND0, 'Wishing Well');
    await probe1.engine.performAction('p0', { actionId: 'dom_action_play', cardId: well1 });
    state = probe1.engine.getState();
    expect(probe1.errors).toEqual([]);
    // The naming choice shows faces (the supply piles ARE the name list).
    expect(pileReqs[0].revealed).toBe(true);
    expect(state.players[0].vars['dom_var_wish']).toBe('Silver');
    // 6 − played + Province (the +1 Card) + Silver (the granted wish).
    expect(state.zones[HAND0].cardIds).toHaveLength(7);
    expect(names(state, HAND0)).toContain('Province');
    expect(names(state, HAND0)).toContain('Silver');
    expect(state.players[0].vars['dom_var_actions']).toBe(1);

    // MISS: name Copper instead — the Silver stays on top of the deck.
    const def2 = buildDominionDef();
    def2.setup.push(
      dealNamed('Wishing Well', 'dom_zone_hand', null, RESERVE),
      dealNamed('Silver', 'dom_zone_deck'),
      dealNamed('Province', 'dom_zone_deck'),
    );
    const probe2 = probeEngine(def2, (req, state) => {
      if (req.kind !== 'pile') throw new Error(`unexpected ${req.kind} choice`);
      const copper = req.cardIds.find((id) => state.cards[id].name === 'Copper');
      if (!copper) throw new Error('no Copper pile to name');
      return copper;
    });
    await probe2.engine.start();
    state = probe2.engine.getState();
    const well2 = findNamed(state, HAND0, 'Wishing Well');
    await probe2.engine.performAction('p0', { actionId: 'dom_action_play', cardId: well2 });
    state = probe2.engine.getState();
    expect(probe2.errors).toEqual([]);
    expect(state.players[0].vars['dom_var_wish']).toBe('Copper');
    expect(state.zones[HAND0].cardIds).toHaveLength(6); // only the +1 Card
    const deck = state.zones[DECK0].cardIds;
    expect(state.cards[deck[deck.length - 1]].name).toBe('Silver'); // still on top
  });

  it('Baron: discard an Estate for +$4, or decline and gain one instead', async () => {
    // Discard branch.
    const def1 = buildDominionDef();
    def1.setup.push(
      dealNamed('Baron', 'dom_zone_hand', null, RESERVE),
      dealNamed('Estate', 'dom_zone_hand'),
    );
    const probe1 = probeEngine(def1, (req, state) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate');
      if (!estate) throw new Error('no Estate offered');
      return JSON.stringify([estate]);
    });
    await probe1.engine.start();
    let state = probe1.engine.getState();
    const supplyEstates = () =>
      names(probe1.engine.getState(), 'dom_zone_supply').filter((n) => n === 'Estate').length;
    expect(supplyEstates()).toBe(7); // 8 − the dealt one
    const baron1 = findNamed(state, HAND0, 'Baron');
    await probe1.engine.performAction('p0', { actionId: 'dom_action_play', cardId: baron1 });
    state = probe1.engine.getState();
    expect(probe1.errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(4);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(names(state, DISCARD0)).toEqual(['Estate']); // discarded, not gained
    expect(supplyEstates()).toBe(7); // supply untouched
    expect(state.zones[TRASH].cardIds).toHaveLength(0);

    // Decline branch: keep the Estate, gain one from the supply instead.
    const def2 = buildDominionDef();
    def2.setup.push(
      dealNamed('Baron', 'dom_zone_hand', null, RESERVE),
      dealNamed('Estate', 'dom_zone_hand'),
    );
    let sawCardsReq = false;
    const probe2 = probeEngine(def2, (req) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      sawCardsReq = true;
      return JSON.stringify([]);
    });
    await probe2.engine.start();
    state = probe2.engine.getState();
    const baron2 = findNamed(state, HAND0, 'Baron');
    await probe2.engine.performAction('p0', { actionId: 'dom_action_play', cardId: baron2 });
    state = probe2.engine.getState();
    expect(probe2.errors).toEqual([]);
    expect(sawCardsReq).toBe(true); // the offer was made and declined
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(state.players[0].vars['dom_var_buys']).toBe(2);
    expect(names(state, DISCARD0)).toEqual(['Estate']); // the gained copy
    expect(names(state, HAND0)).toContain('Estate');    // the kept copy
    // The tagged 'gain' recount priced it in: 3 starters + dealt + gained.
    expect(state.players[0].vars['dom_var_vp']).toBe(5);
  });
});
