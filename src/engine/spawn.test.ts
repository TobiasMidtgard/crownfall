import { describe, expect, it } from 'vitest';
import { cdef, customDeck, harness, makeDef, std52, vdef, zone, pzone } from './testkit';

describe('deck spawning', () => {
  it('spawns a full standard52 deck in canonical order when unshuffled', async () => {
    const def = makeDef({ zones: [zone('deck')], decks: [std52('d', 'deck')] });
    const h = harness(def);
    await h.engine.start();
    const s = h.state();
    const ids = s.zones['deck'].cardIds;
    expect(ids).toHaveLength(52);
    expect(Object.keys(s.cards)).toHaveLength(52);
    const bottom = s.cards[ids[0]];
    expect(bottom.fields).toMatchObject({ suit: 'spades', rank: 2, rankName: '2', color: 'black', isJoker: false });
    const top = s.cards[ids[51]];
    expect(top.fields).toMatchObject({ suit: 'clubs', rank: 14, rankName: 'A', name: 'A of clubs' });
    const qh = Object.values(s.cards).find((c) => c.name === 'Q of hearts')!;
    expect(qh.fields).toMatchObject({ suit: 'hearts', rank: 12, rankName: 'Q', color: 'red' });
    expect(Object.values(s.cards).every((c) => c.faceUp)).toBe(true);
    expect(bottom.defId).toBeNull();
    expect(bottom.templateId).toBeNull();
  });

  it('honors excludeRanks and jokers', async () => {
    const def = makeDef({ zones: [zone('deck')], decks: [std52('d', 'deck', { jokers: 2, excludeRanks: [2, 3] })] });
    const h = harness(def);
    await h.engine.start();
    const s = h.state();
    const ids = s.zones['deck'].cardIds;
    expect(ids).toHaveLength(52 - 8 + 2);
    const jokers = ids.map((id) => s.cards[id]).filter((c) => c.fields['isJoker'] === true);
    expect(jokers).toHaveLength(2);
    expect(jokers[0].fields).toMatchObject({ rank: 15, suit: '', rankName: 'Joker', color: 'black', name: 'Joker' });
    expect(ids.map((id) => s.cards[id]).some((c) => c.fields['rank'] === 2 || c.fields['rank'] === 3)).toBe(false);
    // Jokers spawn after the suited cards.
    expect(s.cards[ids[ids.length - 1]].name).toBe('Joker');
  });

  it('spawns custom decks with counts, copied fields, and the name field', async () => {
    const def = makeDef({
      zones: [zone('deck')],
      cards: [cdef('goblin', { atk: 2 }), cdef('dragon', { atk: 9 })],
      decks: [customDeck('d', 'deck', [['goblin', 3], ['dragon', 1]])],
    });
    const h = harness(def);
    await h.engine.start();
    const s = h.state();
    const cards = s.zones['deck'].cardIds.map((id) => s.cards[id]);
    expect(cards).toHaveLength(4);
    expect(cards.filter((c) => c.name === 'goblin')).toHaveLength(3);
    const dragon = cards.find((c) => c.name === 'dragon')!;
    expect(dragon.fields).toEqual({ atk: 9, name: 'dragon' });
    expect(dragon.defId).toBe('dragon');
    expect(dragon.templateId).toBe('tpl');
  });

  it('gives EVERY player an independent full copy for perPlayer initial zones', async () => {
    const def = makeDef({ zones: [pzone('lib')], decks: [std52('d', 'lib')] });
    const h = harness(def, { players: ['A', 'B', 'C'] });
    await h.engine.start();
    const s = h.state();
    expect(Object.keys(s.cards)).toHaveLength(156);
    const a = s.zones['lib:p0'].cardIds;
    const b = s.zones['lib:p1'].cardIds;
    expect(a).toHaveLength(52);
    expect(b).toHaveLength(52);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });

  it('initializes perCard variables on every spawned instance', async () => {
    const def = makeDef({
      variables: [vdef('hp', 'perCard', 'number', 5)],
      zones: [zone('deck')],
      cards: [cdef('imp')],
      decks: [customDeck('d', 'deck', [['imp', 2]])],
    });
    const h = harness(def);
    await h.engine.start();
    const s = h.state();
    for (const card of Object.values(s.cards)) expect(card.vars['hp']).toBe(5);
  });

  it('shuffles deterministically by seed', async () => {
    const def = makeDef({ zones: [zone('deck')], decks: [std52('d', 'deck', { shuffle: true })] });
    const run = async (seed: number) => {
      const h = harness(def, { seed });
      await h.engine.start();
      const s = h.state();
      return s.zones['deck'].cardIds.map((id) => s.cards[id].name);
    };
    const a = await run(7);
    const b = await run(7);
    const c = await run(8);
    expect(a).toEqual(b);
    expect(c).not.toEqual(a);
    expect([...a].sort()).toEqual([...c].sort()); // same multiset, different order
  });

  it('shuffles each perPlayer copy separately', async () => {
    const def = makeDef({ zones: [pzone('lib')], decks: [std52('d', 'lib', { shuffle: true })] });
    const h = harness(def);
    await h.engine.start();
    const s = h.state();
    const orderA = s.zones['lib:p0'].cardIds.map((id) => s.cards[id].name);
    const orderB = s.zones['lib:p1'].cardIds.map((id) => s.cards[id].name);
    expect(orderA).not.toEqual(orderB);
  });
});
