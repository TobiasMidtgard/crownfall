/**
 * Intrigue 2E (part C) — deterministic per-card probes for Harem, Minion,
 * Nobles, Patrol, Replace, Torturer, Trading Post and Upgrade, run through
 * the REAL engine with scripted choice answers. The cards live in the hidden
 * reserve at game start (they're outside the default kingdom), so setups
 * deal them from 'dom_zone_reserve'.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest, EngineHandle, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { ALL, move, zone } from '../../examples/dsl';
import { buildDominionDef } from '../dominionGame';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);

async function playFromHand(engine: EngineHandle, name: string): Promise<void> {
  const cardId = findNamed(engine.getState(), 'dom_zone_hand:p0', name);
  await engine.performAction('p0', { actionId: 'dom_action_play', cardId });
}

describe('intrigue2eC wiring', () => {
  it('the merged def still validates with zero errors', () => {
    const def = buildDominionDef();
    expect(validateGameDef(def).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('type lines: Harem is a Treasure, the three attacks wear the Attack tag', () => {
    const def = buildDominionDef();
    const by = (n: string) => def.cards.find((c) => c.name === n)!;
    expect(by('Harem').typeId).toBe('dom_type_treasure');
    expect(by('Harem').fields['dom_field_kind']).toBe('Treasure');
    for (const n of ['Minion', 'Replace', 'Torturer']) {
      expect(by(n).tags, `${n} attacks`).toContain('dom_tag_attack');
      expect(by(n).typeId).toBe('dom_type_action');
    }
    expect(by('Nobles').typeId).toBe('dom_type_action');
    expect(by('Nobles').fields['dom_field_vp']).toBe(2);
  });
});

describe('Harem', () => {
  it('plays as a 2-coin treasure and scores its printed 2 VP at the recount', async () => {
    const def = buildDominionDef();
    const harem = def.cards.find((c) => c.name === 'Harem')!;
    expect(harem.fields['dom_field_coins']).toBe(2);
    expect(harem.fields['dom_field_vp']).toBe(2);
    expect(harem.abilities).toEqual([]);
    def.setup.push(fromReserve('Harem'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const cardId = findNamed(engine.getState(), 'dom_zone_hand:p0', 'Harem');
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    await engine.performAction('p0', { actionId: 'dom_action_treasure', cardId });
    let state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, 'dom_zone_inplay:p0')).toEqual(['Harem']);
    // Turn end: the recount sums the vp field — 3 starter Estates + Harem.
    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_vp']).toBe(5);
  });
});

describe('Minion', () => {
  it('+1 Action; choosing +2 Coins pays out and leaves every hand alone', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Minion'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'coins';
    });
    await engine.start();
    await playFromHand(engine, 'Minion');
    await playOutWindows(engine); // the attack half stacks even in coins mode
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 − play + 1
    expect(state.players[0].vars['dom_var_minion_mode']).toBe(1);
    expect(state.zones['dom_zone_hand:p0'].cardIds).toHaveLength(5);
    expect(state.zones['dom_zone_hand:p1'].cardIds).toHaveLength(5);
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(0);
  });

  it('the attack mode: owner and 5+-card foes discard their hands and draw 4', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Minion'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'attack';
    });
    await engine.start();
    await playFromHand(engine, 'Minion');
    // Nobody holds a reaction, so the response window auto-passes shut and
    // the attack resolves; playOutWindows is a no-op safety net here.
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_minion_mode']).toBe(2);
    // p0: the 5 remaining cards hit the discard, 4 came back.
    expect(state.zones['dom_zone_discard:p0'].cardIds).toHaveLength(5);
    expect(state.zones['dom_zone_hand:p0'].cardIds).toHaveLength(4);
    // p1 held 5 (≥ 5): same fate.
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(5);
    expect(state.zones['dom_zone_hand:p1'].cardIds).toHaveLength(4);
  });

  it('a revealed Moat keeps the victim whole; immunity fades after the attack', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Minion'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'attack';
    });
    await engine.start();
    await playFromHand(engine, 'Minion');
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    // p1 (6 cards, would qualify) is immune: hand untouched, nothing discarded.
    expect(state.zones['dom_zone_hand:p1'].cardIds).toHaveLength(6);
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(0);
    // The owner's half still resolved.
    expect(state.zones['dom_zone_hand:p0'].cardIds).toHaveLength(4);
    expect(state.zones['dom_zone_discard:p0'].cardIds).toHaveLength(5);
    // effectResolved wiped the immunity once the attack resolved.
    expect(state.players[1].vars['dom_var_immune']).toBe(0);
  });
});

describe('Nobles', () => {
  it('+3 Cards branch', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Nobles'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'cards';
    });
    await engine.start();
    await playFromHand(engine, 'Nobles');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.zones['dom_zone_hand:p0'].cardIds).toHaveLength(8); // 6 − 1 + 3
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
  });

  it('+2 Actions branch', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Nobles'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'actions';
    });
    await engine.start();
    await playFromHand(engine, 'Nobles');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.zones['dom_zone_hand:p0'].cardIds).toHaveLength(5);
    expect(state.players[0].vars['dom_var_actions']).toBe(2); // 1 − play + 2
  });
});

describe('Patrol', () => {
  it('draws 3, pulls Victory cards / Curses / vp-bearing hybrids from the top 4', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Patrol'),
      // Deck from the top after these pushes: 3 Coppers (draw fodder), then
      // the reveal four — Copper, Harem, Curse, Estate — then the 5 starters.
      dealNamed('Estate', 'dom_zone_deck'),
      dealNamed('Curse', 'dom_zone_deck'),
      fromReserve('Harem', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
    );
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    await playFromHand(engine, 'Patrol');
    const state = engine.getState();
    expect(errors).toEqual([]);
    const hand = names(state, 'dom_zone_hand:p0');
    // 5 opening + Patrol − played + 3 drawn + 3 pulled from the reveal.
    expect(hand).toHaveLength(11);
    expect(hand.filter((n) => n === 'Curse')).toHaveLength(1);
    expect(hand.filter((n) => n === 'Harem')).toHaveLength(1); // vp > 0 qualifies
    // The one non-victory reveal (Copper) went back on top of the deck.
    const deck = state.zones['dom_zone_deck:p0'].cardIds;
    expect(deck).toHaveLength(6);
    expect(state.cards[deck[deck.length - 1]].name).toBe('Copper');
    // The staging zone drained completely.
    expect(state.zones['dom_zone_look'].cardIds).toHaveLength(0);
  });

  it('keeps going when the deck runs short (no hang, staging drained)', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Patrol'),
      // Sweep p0's remaining 5-card deck into the discard: the +3 draw must
      // reshuffle it back, leaving only 2 cards for the 4-card reveal.
      move(ALL, zone('dom_zone_deck'), zone('dom_zone_discard')),
    );
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    await playFromHand(engine, 'Patrol');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.zones['dom_zone_look'].cardIds).toHaveLength(0);
    expect(state.zones['dom_zone_discard:p0'].cardIds).toHaveLength(0);
    // Conservation: 10 starters + Patrol, one of them in play.
    const hand = state.zones['dom_zone_hand:p0'].cardIds.length;
    const deck = state.zones['dom_zone_deck:p0'].cardIds.length;
    expect(hand + deck).toBe(10);
    expect(deck).toBeLessThanOrEqual(2);
  });
});

describe('Replace', () => {
  it('trashes, gains an Action/Treasure ONTO THE DECK, deals no Curse', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Replace'), dealNamed('Estate', 'dom_zone_hand'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') {
        const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate');
        if (estate === undefined) throw new Error('no Estate to trash');
        return estate;
      }
      if (req.kind === 'pile') {
        const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver');
        if (silver === undefined) throw new Error('no Silver pile offered');
        return silver;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await playFromHand(engine, 'Replace');
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    // Estate (2) caps the gain at 4: Silver offered, Gold not.
    const pileReq = requests.find((r): r is Extract<ChoiceRequest, { kind: 'pile' }> => r.kind === 'pile')!;
    const offered = pileReq.cardIds.map((id) => state.cards[id].name);
    expect(offered).toContain('Silver');
    expect(offered).not.toContain('Gold');
    // The Silver — a Treasure — landed on TOP of the deck, not in the discard.
    const deck = state.zones['dom_zone_deck:p0'].cardIds;
    expect(state.cards[deck[deck.length - 1]].name).toBe('Silver');
    expect(names(state, 'dom_zone_discard:p0')).toEqual([]);
    expect(names(state, 'dom_zone_trash')).toEqual(['Estate']);
    // No Victory gained: no Curses, and the flag never lingered.
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(0);
    expect(state.players[0].vars['dom_var_replace_victory']).toBe(0);
  });

  it('gaining a Victory card discards it and curses the foe through the stack', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Replace'), dealNamed('Estate', 'dom_zone_hand'));
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card' || req.kind === 'pile') {
        const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate');
        if (estate === undefined) throw new Error('no Estate offered');
        return estate;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await playFromHand(engine, 'Replace');
    await playOutWindows(engine); // nobody reveals — the Curse lands
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, 'dom_zone_trash')).toEqual(['Estate']);
    expect(names(state, 'dom_zone_discard:p0')).toEqual(['Estate']); // the gain
    expect(names(state, 'dom_zone_discard:p1')).toEqual(['Curse']);
    // The tagged-gain recount priced everything mid-turn.
    // p0: 3 starter Estates + the dealt one − trashed + gained = 4.
    expect(state.players[0].vars['dom_var_vp']).toBe(4);
    expect(state.players[1].vars['dom_var_vp']).toBe(2); // 3 Estates − Curse
    // The flag fades with the attack.
    expect(state.players[0].vars['dom_var_replace_victory']).toBe(0);
  });

  it('a revealed Moat blocks the Curse but never the trash/gain', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Replace'),
      dealNamed('Estate', 'dom_zone_hand'),
      dealNamed('Moat', 'dom_zone_hand', 'p1'),
    );
    const { engine, errors } = probeEngine(def, (req, state) => {
      if (req.kind === 'card' || req.kind === 'pile') {
        const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate');
        if (estate === undefined) throw new Error('no Estate offered');
        return estate;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await playFromHand(engine, 'Replace');
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, 'dom_zone_trash')).toEqual(['Estate']);   // Moat can't stop this
    expect(names(state, 'dom_zone_discard:p0')).toEqual(['Estate']); // nor this
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(0); // only this
    expect(state.players[0].vars['dom_var_replace_victory']).toBe(0);
    expect(state.players[1].vars['dom_var_immune']).toBe(0);
  });
});

describe('Torturer', () => {
  it('+3 Cards; the victim may discard 2 (their pick, asked of THEM)', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Torturer'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind === 'option') return 'discard';
      if (req.kind === 'cards') return JSON.stringify(req.cardIds.slice(0, req.min));
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await playFromHand(engine, 'Torturer');
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.zones['dom_zone_hand:p0'].cardIds).toHaveLength(8); // 6 − 1 + 3
    expect(state.zones['dom_zone_hand:p1'].cardIds).toHaveLength(3);
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(2);
    const opt = requests.find((r) => r.kind === 'option')!;
    expect(opt.playerId).toBe('p1'); // the victim chooses, not the torturer
  });

  it('the victim may take the Curse INTO THEIR HAND instead', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Torturer'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'option') throw new Error(`unexpected ${req.kind} choice`);
      return 'curse';
    });
    await engine.start();
    await playFromHand(engine, 'Torturer');
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    const hand = names(state, 'dom_zone_hand:p1');
    expect(hand).toHaveLength(6); // 5 + the Curse, in hand not discard
    expect(hand.filter((n) => n === 'Curse')).toHaveLength(1);
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(0);
    expect(state.players[1].vars['dom_var_vp']).toBe(2); // gain-recount fired
  });

  it('a revealed Moat suffers neither option (no choice even asked)', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Torturer'), dealNamed('Moat', 'dom_zone_hand', 'p1'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await playFromHand(engine, 'Torturer');
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toEqual([]); // the IMMUNE gate sits before the choice
    expect(state.zones['dom_zone_hand:p1'].cardIds).toHaveLength(6); // 5 + Moat
    expect(state.zones['dom_zone_discard:p1'].cardIds).toHaveLength(0);
    expect(state.zones['dom_zone_hand:p0'].cardIds).toHaveLength(8); // draw stands
  });
});

describe('Trading Post', () => {
  it('trashes exactly 2 and gains a Silver INTO THE HAND', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Trading Post'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const coppers = req.cardIds.filter((id) => state.cards[id].name === 'Copper').slice(0, 2);
      if (coppers.length < 2) throw new Error('no 2 Coppers to trash');
      return JSON.stringify(coppers);
    });
    await engine.start();
    await playFromHand(engine, 'Trading Post');
    const state = engine.getState();
    expect(errors).toEqual([]);
    const req = requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.min).toBe(2);
    expect(req.max).toBe(2);
    expect(names(state, 'dom_zone_trash')).toEqual(['Copper', 'Copper']);
    const hand = names(state, 'dom_zone_hand:p0');
    expect(hand).toHaveLength(4); // 6 − played − 2 trashed + Silver
    expect(hand.filter((n) => n === 'Silver')).toHaveLength(1);
    expect(state.zones['dom_zone_discard:p0'].cardIds).toHaveLength(0);
  });

  it('with only one card in hand: trash it, gain NO Silver', async () => {
    const def = buildDominionDef();
    def.setup.push(
      // Sweep the opening hand back into the deck, then deal exactly one
      // Copper beside the Trading Post.
      move(ALL, zone('dom_zone_hand'), zone('dom_zone_deck')),
      dealNamed('Copper', 'dom_zone_hand'),
      fromReserve('Trading Post'),
    );
    // min = max = candidates (1 Copper) ⇒ the choice is forced — no request.
    const { engine, errors } = probeEngine(def, (req) => {
      throw new Error(`forced choice should auto-resolve, got ${req.kind}`);
    });
    await engine.start();
    await playFromHand(engine, 'Trading Post');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(names(state, 'dom_zone_trash')).toEqual(['Copper']);
    expect(state.zones['dom_zone_hand:p0'].cardIds).toHaveLength(0); // no Silver
    expect(state.zones['dom_zone_discard:p0'].cardIds).toHaveLength(0);
  });
});

describe('Upgrade', () => {
  it('+1 Card +1 Action; trash an Estate, gain a card costing EXACTLY 3', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Upgrade'), dealNamed('Estate', 'dom_zone_hand'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'card') {
        const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate');
        if (estate === undefined) throw new Error('no Estate to trash');
        return estate;
      }
      if (req.kind === 'pile') {
        const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver');
        if (silver === undefined) throw new Error('no Silver pile offered');
        return silver;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    await playFromHand(engine, 'Upgrade');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // 1 − play + 1
    // EXACT cost: the First Game supply offers only the cost-3 piles.
    const pileReq = requests.find((r): r is Extract<ChoiceRequest, { kind: 'pile' }> => r.kind === 'pile')!;
    const offered = pileReq.cardIds.map((id) => state.cards[id].name).sort();
    expect(offered).toEqual(['Silver', 'Village', 'Workshop']);
    expect(names(state, 'dom_zone_trash')).toEqual(['Estate']);
    expect(names(state, 'dom_zone_discard:p0')).toEqual(['Silver']);
    expect(state.zones['dom_zone_hand:p0'].cardIds).toHaveLength(6); // 7 − 1 + 1 − 1
  });

  it('whiffs (no gain choice at all) when nothing costs exactly 1 more', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Upgrade'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'card') throw new Error(`unexpected ${req.kind} choice`);
      // Trash a Copper (cost 0): nothing in the supply costs exactly 1.
      const copper = req.cardIds.find((id) => state.cards[id].name === 'Copper');
      if (copper === undefined) throw new Error('no Copper to trash');
      return copper;
    });
    await engine.start();
    await playFromHand(engine, 'Upgrade');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['card']); // no pile request
    expect(names(state, 'dom_zone_trash')).toEqual(['Copper']);
    expect(state.zones['dom_zone_discard:p0'].cardIds).toHaveLength(0);
  });
});
