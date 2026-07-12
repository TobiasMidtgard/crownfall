/**
 * Base 2E expansion module — deterministic per-card probes through the REAL
 * engine. Cards under test start in the hidden RESERVE (they belong to no
 * lobby kingdom set), so they are dealt with fromZone 'dom_zone_reserve';
 * basics come straight off the supply. Every probe asserts zero script
 * errors alongside the card's outcome.
 */
import { describe, expect, it } from 'vitest';
import type { ChoiceRequest, Expr, GameDef, GameState } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import { buildDominionDef } from '../dominionGame';
import { dealNamed, findNamed, playOutWindows, probeEngine } from './testKit';

const HAND = (p: string) => `dom_zone_hand:${p}`;
const DECK = (p: string) => `dom_zone_deck:${p}`;
const DISCARD = (p: string) => `dom_zone_discard:${p}`;
const INPLAY = (p: string) => `dom_zone_inplay:${p}`;
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';
const LOOK = 'dom_zone_look';

const names = (state: GameState, zoneKey: string): string[] =>
  state.zones[zoneKey].cardIds.map((id) => state.cards[id].name);
/** Top of a stack zone = the END of the cardIds array. */
const topName = (state: GameState, zoneKey: string): string | undefined =>
  names(state, zoneKey).at(-1);
const count = (state: GameState, zoneKey: string): number =>
  state.zones[zoneKey].cardIds.length;

const nameIsExpr = (name: string): Expr => ({
  kind: 'compare', op: '==',
  left: { kind: 'cardField', card: { kind: 'binding', name: '$card' }, fieldId: 'name' },
  right: { kind: 'str', value: name },
});

/** Setup block: move EVERY card matching `filter` between two zones. */
function moveAll(
  fromZone: string, toZone: string,
  opts: { owner?: string; filter?: Expr } = {},
): GameDef['setup'][number] {
  const owner = opts.owner !== undefined ? { kind: 'str', value: opts.owner } as Expr : null;
  return {
    kind: 'moveCards',
    from: { zoneId: fromZone, owner },
    to: { zoneId: toZone, owner },
    cards: opts.filter ? { kind: 'filter', filter: opts.filter } : { kind: 'all' },
    toPosition: 'top',
    faceUp: null,
  };
}

const fromReserve = (name: string, toZone = 'dom_zone_hand', toPlayer: string | null = null) =>
  dealNamed(name, toZone, toPlayer, 'dom_zone_reserve');

const play = { actionId: 'dom_action_play' };

describe('base2e module registration', () => {
  const def = buildDominionDef();

  it('validates clean and knows all ten cards with their costs', () => {
    expect(validateGameDef(def)).toEqual([]);
    const costs: Record<string, number> = {
      Harbinger: 3, Merchant: 3, Vassal: 3, Bureaucrat: 4, Moneylender: 4,
      Poacher: 4, Bandit: 5, Library: 5, Sentry: 5, Artisan: 6,
    };
    for (const [name, cost] of Object.entries(costs)) {
      const card = def.cards.find((c) => c.name === name);
      expect(card, `${name} registered`).toBeDefined();
      expect(card!.fields['dom_field_cost'], `${name} costs ${cost}`).toBe(cost);
    }
    for (const name of ['Bureaucrat', 'Bandit']) {
      expect(def.cards.find((c) => c.name === name)!.tags).toContain('dom_tag_attack');
    }
  });
});

describe('Harbinger', () => {
  it('+1 Card +1 Action; may put a discard-pile card onto the deck (revealed)', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Harbinger'), dealNamed('Silver', 'dom_zone_discard'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      return JSON.stringify([silver]);
    });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Harbinger') });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect((requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>).revealed).toBe(true);
    expect(count(state, HAND('p0'))).toBe(6); // 6 - Harbinger + 1 drawn
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(count(state, DECK('p0'))).toBe(5);
    expect(topName(state, DECK('p0'))).toBe('Silver');
  });

  it('skips the choice entirely when the discard pile is empty', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Harbinger'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Harbinger') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
  });
});

describe('Merchant', () => {
  it('pays +$1 for the FIRST Silver only; the flag resets at cleanup', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Merchant'), dealNamed('Silver'), dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Merchant') });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_actions']).toBe(1); // -1 play, +1 Merchant
    await engine.performAction('p0', { actionId: 'dom_action_done' });

    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Silver'),
    });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(3); // 2 + the Merchant bonus
    expect(state.players[0].vars['dom_var_merchant_silver']).toBe(1);

    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Silver'),
    });
    state = engine.getState();
    expect(state.players[0].vars['dom_var_coins']).toBe(5); // second Silver: no bonus

    await engine.performAction('p0', { actionId: 'dom_action_end_turn' });
    await engine.performAction('p0', { actionId: 'dom_action_cleanup' });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_merchant_silver']).toBe(0);
  });

  it('two Merchants pay +$2 on the one first Silver', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Merchant'), fromReserve('Merchant'), dealNamed('Silver'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    let state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Merchant') });
    state = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state, HAND('p0'), 'Merchant') });
    await engine.performAction('p0', { actionId: 'dom_action_done' });
    state = engine.getState();
    await engine.performAction('p0', {
      actionId: 'dom_action_treasure', cardId: findNamed(state, HAND('p0'), 'Silver'),
    });
    state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(4); // 2 + 1 per Merchant
  });
});

describe('Vassal', () => {
  it('discards the top deck card and may play it when it is an Action', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Vassal'), fromReserve('Merchant', 'dom_zone_deck'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return true;
    });
    await engine.start();
    const state0 = engine.getState();
    expect(topName(state0, DECK('p0'))).toBe('Merchant');
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Vassal') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    // The Merchant was played for free: it drew 1 and gave +1 Action back.
    expect(names(state, INPLAY('p0')).sort()).toEqual(['Merchant', 'Vassal']);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(count(state, HAND('p0'))).toBe(6);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(count(state, DECK('p0'))).toBe(4);
  });

  it('a non-Action top card is just discarded (no choice opens)', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Vassal'), dealNamed('Estate', 'dom_zone_deck'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Vassal') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    expect(names(state, DISCARD('p0'))).toEqual(['Estate']);
    expect(count(state, DECK('p0'))).toBe(5);
  });

  it('an empty deck reshuffles the discard before revealing', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Vassal'), moveAll('dom_zone_deck', 'dom_zone_discard'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    expect(count(state0, DECK('p0'))).toBe(0);
    expect(count(state0, DISCARD('p0'))).toBe(5);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Vassal') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(2);
    // 5 reshuffled in, 1 discarded back out (starters are never Actions).
    expect(count(state, DECK('p0'))).toBe(4);
    expect(count(state, DISCARD('p0'))).toBe(1);
  });
});

describe('Bureaucrat', () => {
  it('gains a Silver onto the deck; the victim topdecks a revealed Victory card', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Bureaucrat'), dealNamed('Estate', 'dom_zone_hand', 'p1'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const estate = req.cardIds.find((id) => state.cards[id].name === 'Estate')!;
      return JSON.stringify([estate]);
    });
    await engine.start();
    const state0 = engine.getState();
    const p1Hand = count(state0, HAND('p1'));
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Bureaucrat') });
    // No reaction in any hand: the window auto-passes and the attack has
    // already resolved (playOutWindows is a no-op then, kept for shape).
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    // The gain half: a Silver from the supply, straight onto p0's deck.
    expect(topName(state, DECK('p0'))).toBe('Silver');
    expect(count(state, DECK('p0'))).toBe(6);
    expect(names(state, SUPPLY).filter((n) => n === 'Silver')).toHaveLength(39);
    // The attack half: p1 revealed an Estate and topdecked it.
    const req = requests.find((r) => r.kind === 'cards') as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.playerId).toBe('p1');
    expect(req.min).toBe(1);
    expect(req.max).toBe(1);
    expect(req.revealed).toBe(true);
    expect(count(state, HAND('p1'))).toBe(p1Hand - 1);
    expect(topName(state, DECK('p1'))).toBe('Estate');
    expect(count(state, DECK('p1'))).toBe(6);
  });

  it('a revealed Moat blocks the topdeck but never the Silver gain', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Bureaucrat'),
      dealNamed('Moat', 'dom_zone_hand', 'p1'),
      dealNamed('Estate', 'dom_zone_hand', 'p1'),
    );
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    const p1Hand = count(state0, HAND('p1'));
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Bureaucrat') });
    await playOutWindows(engine, 'p1');
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p1'))).toBe(p1Hand); // untouched — immune
    expect(count(state, DECK('p1'))).toBe(5);
    expect(topName(state, DECK('p0'))).toBe('Silver'); // the gain is not an attack
    // Immunity faded with the attack (the shared effectResolved reset).
    expect(state.players[1].vars['dom_var_immune']).toBe(0);
  });

  it('a hand with no Victory cards is announced instead', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Bureaucrat'),
      moveAll('dom_zone_hand', 'dom_zone_deck', { owner: 'p1' }),
    );
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    expect(count(state0, HAND('p1'))).toBe(0);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Bureaucrat') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, DECK('p1'))).toBe(10);
    expect(state.log.some((l) => l.text.includes('reveals a hand with no Victory cards'))).toBe(true);
  });
});

describe('Moneylender', () => {
  it('trashing a Copper pays +$3', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Moneylender'), dealNamed('Copper'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify([req.cardIds[0]]);
    });
    await engine.start();
    const state0 = engine.getState();
    const handBefore = count(state0, HAND('p0'));
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Moneylender') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(3);
    expect(names(state, TRASH)).toEqual(['Copper']);
    expect(count(state, HAND('p0'))).toBe(handBefore - 2);
  });

  it('declining trashes nothing and pays nothing', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Moneylender'), dealNamed('Copper'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify([]);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Moneylender') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
    expect(count(state, TRASH)).toBe(0);
  });

  it('no Copper in hand: the choice never opens', async () => {
    const def = buildDominionDef();
    def.setup.push(moveAll('dom_zone_hand', 'dom_zone_deck'), fromReserve('Moneylender'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    expect(names(state0, HAND('p0'))).toEqual(['Moneylender']);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Moneylender') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.players[0].vars['dom_var_coins']).toBe(0);
  });
});

describe('Poacher', () => {
  it('+1 Card +1 Action +$1; no empty piles means no discard', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Poacher'));
    const { engine, errors } = probeEngine(def, () => { throw new Error('no choices expected'); });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Poacher') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(6);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
    expect(count(state, DISCARD('p0'))).toBe(0);
  });

  it('discards one card per empty supply pile', async () => {
    const def = buildDominionDef();
    def.setup.push(
      moveAll(SUPPLY, TRASH, { filter: nameIsExpr('Estate') }),
      moveAll(SUPPLY, TRASH, { filter: nameIsExpr('Duchy') }),
      fromReserve('Poacher'),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      return JSON.stringify(req.cardIds.slice(0, req.min));
    });
    await engine.start();
    expect(engine.getState().globalVars['dom_var_empty_piles']).toBe(2);
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Poacher') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests).toHaveLength(1);
    expect((requests[0] as Extract<ChoiceRequest, { kind: 'cards' }>).min).toBe(2);
    expect(count(state, HAND('p0'))).toBe(4); // 6 after the draw, minus 2
    expect(count(state, DISCARD('p0'))).toBe(2);
    expect(state.players[0].vars['dom_var_coins']).toBe(1);
  });
});

describe('Bandit', () => {
  it('gains a Gold; the victim trashes a revealed non-Copper Treasure and discards the rest', async () => {
    const def = buildDominionDef();
    def.setup.push(
      fromReserve('Bandit'),
      dealNamed('Silver', 'dom_zone_deck', 'p1'),
      dealNamed('Copper', 'dom_zone_deck', 'p1'), // ends on top
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      const silver = req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      return JSON.stringify([silver]);
    });
    await engine.start();
    const state0 = engine.getState();
    expect(count(state0, DECK('p1'))).toBe(7);
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Bandit') });
    await playOutWindows(engine);
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(state.window).toBeNull();
    // The gain half.
    expect(names(state, DISCARD('p0'))).toEqual(['Gold']);
    expect(names(state, SUPPLY).filter((n) => n === 'Gold')).toHaveLength(29);
    // The attack half: top 2 were Copper + Silver — Silver trashed (the only
    // legal pick), Copper discarded, nothing left staged.
    const req = requests.find((r) => r.kind === 'cards') as Extract<ChoiceRequest, { kind: 'cards' }>;
    expect(req.playerId).toBe('p1');
    expect(req.cardIds).toHaveLength(1); // Copper is never offered
    expect(req.revealed).toBe(true);
    expect(names(state, TRASH)).toEqual(['Silver']);
    expect(names(state, DISCARD('p1'))).toEqual(['Copper']);
    expect(count(state, DECK('p1'))).toBe(5);
    expect(count(state, LOOK)).toBe(0);
  });
});

describe('Library', () => {
  it('draws to 7; a kept Action counts toward the 7', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Library'), fromReserve('Merchant', 'dom_zone_deck'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return true; // keep the Merchant
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Library') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7);
    expect(names(state, HAND('p0'))).toContain('Merchant');
    expect(count(state, DECK('p0'))).toBe(4);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(count(state, LOOK)).toBe(0);
  });

  it('a skipped Action is set aside and discarded afterwards', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Library'), fromReserve('Merchant', 'dom_zone_deck'));
    const { engine, errors } = probeEngine(def, (req) => {
      if (req.kind !== 'yesNo') throw new Error(`unexpected ${req.kind} choice`);
      return false; // set the Merchant aside
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Library') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(count(state, HAND('p0'))).toBe(7);
    expect(names(state, HAND('p0'))).not.toContain('Merchant');
    expect(names(state, DISCARD('p0'))).toEqual(['Merchant']);
    expect(count(state, DECK('p0'))).toBe(3);
    expect(count(state, LOOK)).toBe(0);
  });
});

describe('Sentry', () => {
  it('+1 Card +1 Action; trashes/discards any of the top 2, the rest go back on top', async () => {
    const def = buildDominionDef();
    // Deck top after setup (top last): ... Curse, Silver, Copper.
    def.setup.push(
      fromReserve('Sentry'),
      dealNamed('Curse', 'dom_zone_deck'),
      dealNamed('Silver', 'dom_zone_deck'),
      dealNamed('Copper', 'dom_zone_deck'),
    );
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind !== 'cards') throw new Error(`unexpected ${req.kind} choice`);
      if (req.prompt.includes('trash')) {
        const curse = req.cardIds.find((id) => state.cards[id].name === 'Curse')!;
        return JSON.stringify([curse]);
      }
      return JSON.stringify([]); // discard nothing — the Silver goes back
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Sentry') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    // The +1 Card drew the Copper off the top; the look-at saw Silver + Curse.
    expect(names(state, HAND('p0'))).toContain('Copper');
    expect(count(state, HAND('p0'))).toBe(6);
    expect(state.players[0].vars['dom_var_actions']).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests.every((r) => r.kind === 'cards' && r.revealed)).toBe(true);
    expect(names(state, TRASH)).toEqual(['Curse']);
    expect(topName(state, DECK('p0'))).toBe('Silver');
    expect(count(state, DECK('p0'))).toBe(6);
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(count(state, LOOK)).toBe(0);
  });
});

describe('Artisan', () => {
  it('gains a card to hand costing up to $5, then topdecks a hand card', async () => {
    const def = buildDominionDef();
    def.setup.push(fromReserve('Artisan'));
    const requests: ChoiceRequest[] = [];
    const { engine, errors } = probeEngine(def, (req, state) => {
      requests.push(req);
      if (req.kind === 'pile') {
        const offered = req.cardIds.map((id) => state.cards[id].name);
        expect(offered).toContain('Silver'); // cost 3 — within the cap
        expect(offered).toContain('Duchy');  // cost 5 — exactly at it
        expect(offered).not.toContain('Gold'); // cost 6 — beyond it
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      if (req.kind === 'card') {
        return req.cardIds.find((id) => state.cards[id].name === 'Silver')!;
      }
      throw new Error(`unexpected ${req.kind} choice`);
    });
    await engine.start();
    const state0 = engine.getState();
    await engine.performAction('p0', { ...play, cardId: findNamed(state0, HAND('p0'), 'Artisan') });
    const state = engine.getState();
    expect(errors).toEqual([]);
    expect(requests.map((r) => r.kind)).toEqual(['pile', 'card']);
    expect((requests[0] as Extract<ChoiceRequest, { kind: 'pile' }>).optional).toBe(false);
    // Gained to HAND (not the discard), then topdecked.
    expect(count(state, DISCARD('p0'))).toBe(0);
    expect(count(state, HAND('p0'))).toBe(5);
    expect(topName(state, DECK('p0'))).toBe('Silver');
    expect(count(state, DECK('p0'))).toBe(6);
    expect(names(state, SUPPLY).filter((n) => n === 'Silver')).toHaveLength(39);
    expect(state.players[0].vars['dom_var_actions']).toBe(0);
  });
});
