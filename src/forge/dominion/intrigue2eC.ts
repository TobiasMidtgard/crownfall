/**
 * Intrigue 2E (part C) — Harem, Minion, Nobles, Patrol, Replace, Torturer,
 * Trading Post, Upgrade.
 *
 * Idioms follow dominionGame.ts's EXTRA_CARDS cookbook: inline halves run at
 * play time, attack halves are separate `stacked: true` abilities whose
 * per-victim effects gate on IMMUNE == 0 (Moat), and IMMUNE is never reset
 * here (the shared effectResolved trigger owns that). Per-turn bookkeeping
 * (Minion's chosen mode, Replace's gained-a-Victory flag) lives in hidden
 * perPlayer variables reset by buildCleanupResets.
 */
import type { Block, CardDef, CardSelector, Expr, VariableDef, ZoneRef } from '../../shared/types';
import {
  ALL, add, allOf, announce, anyOf, bestCard, changeVar, chooseCard, chooseCardsBlock,
  chooseOption, countCards, discardDownTo, eq, field, forEachOpponent, forEachPlayer,
  getVar, gt, gte, iff, lt, lte, matching, num, setVar, shuffle, specific, str, sub,
  topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

/** Minion's stashed choice this turn: 0 = unplayed, 1 = +2 Coins, 2 = attack. */
export const MINION_MODE_VAR = 'dom_var_minion_mode';
/** 1 while a Replace this turn gained a Victory card (its curse half reads it). */
export const REPLACE_VICTORY_VAR = 'dom_var_replace_victory';

export const intrigue2eC: ExpansionModule = {
  id: 'intrigue2eC',

  piles: [
    { name: 'Harem', cost: 6, count: 10 },
    { name: 'Minion', cost: 5, count: 10 },
    { name: 'Nobles', cost: 6, count: 10 },
    { name: 'Patrol', cost: 5, count: 10 },
    { name: 'Replace', cost: 5, count: 10 },
    { name: 'Torturer', cost: 5, count: 10 },
    { name: 'Trading Post', cost: 5, count: 10 },
    { name: 'Upgrade', cost: 5, count: 10 },
  ],

  ids: {
    Harem: 'dom_card_harem',
    Minion: 'dom_card_minion',
    Nobles: 'dom_card_nobles',
    Patrol: 'dom_card_patrol',
    Replace: 'dom_card_replace',
    Torturer: 'dom_card_torturer',
    'Trading Post': 'dom_card_trading_post',
    Upgrade: 'dom_card_upgrade',
  },

  attackNames: ['Minion', 'Replace', 'Torturer'],
  treasureNames: ['Harem'],

  variables: [
    {
      id: MINION_MODE_VAR, name: 'Minion mode', scope: 'perPlayer',
      type: 'number', initial: 0, hidden: true,
    },
    {
      id: REPLACE_VICTORY_VAR, name: 'Replace gained a Victory', scope: 'perPlayer',
      type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  buildCards(kit: CardKit): CardDef[] {
    const {
      zones: { SUPPLY, TRASH, DECK, HAND, DISCARD, LOOK },
      vars: { ACTIONS, COINS, IMMUNE, SCRATCH, DISCOUNT },
      fields: { COST, VP_F },
      types: { VICTORY, CURSE },
      OWNER, CARD, CHOICE, PLAYER,
      nameIs, isA, IS_ACTION_CARD, IS_TREASURE_CARD,
      tmove, draw, onPlay, cardDef, choosePileBlock,
    } = kit;

    /** Gain the named basic from the supply into `to` (guarded on the pile). */
    const gainNamed = (name: string, to: ZoneRef, who: Expr, note: string): Block =>
      iff(gt(countCards(zone(SUPPLY), nameIs(name)), num(0)), [
        announce(who, note),
        tmove(
          specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs(name))),
          zone(SUPPLY), to, 'gain', { faceUp: true },
        ),
      ]);

    /** A card is "victory-ish" for Patrol: Victory- or Curse-TYPED, or any
     *  card printed with positive VP (catches Action–Victory Nobles and
     *  Treasure–Victory Harem, whose primary type here can't be Victory). */
    const PATROL_TAKE = anyOf(isA(CARD, VICTORY), isA(CARD, CURSE), gt(field(CARD, VP_F), num(0)));

    return [
      // HAREM — Treasure – Victory. Pure fields: the core treasure action
      // reads the coins field, the recount sums the vp field. No abilities.
      // DEVIATION: primary type is Treasure only (one typeId per card), so
      // type-sensitive effects (Replace's Victory check, buys...) see it as
      // a Treasure, never as a Victory card. Its 2 VP still counts.
      cardDef('dom_card_harem', 'Harem', 6, 2, 2,
        '2 Coins. Worth 2 victory points.'),

      // MINION — Action – Attack. The choice happens at play time (inline);
      // only the attack resolution goes through the stack so Moat owners get
      // their response window first.
      // DEVIATIONS: (1) the choice is made before opponents can reveal Moat
      // (official: chosen during resolution) — materially identical since a
      // reveal changes nothing the chooser can see. (2) The owner's own
      // discard-hand + draw 4 also waits for the window (nothing can alter
      // the owner's hand during it, so the outcome matches). (3) Throne
      // Room + Minion: both stacked halves read the LAST chosen mode.
      cardDef('dom_card_minion', 'Minion', 5, 0, 0,
        '+1 Action. Choose one: +2 Coins; or discard your hand, +4 Cards, and '
        + 'each other player with at least 5 cards in hand discards their hand '
        + 'and draws 4 cards.', [
          onPlay('dom_ab_minion_choice', 'The court decides', [
            changeVar(ACTIONS, num(1), OWNER),
            chooseOption('Minion: choose one', [
              { id: 'coins', label: '+2 Coins' },
              { id: 'attack', label: 'Discard your hand, +4 Cards; foes with 5+ cards do the same' },
            ], OWNER),
            iff(eq(CHOICE, str('coins')), [
              setVar(MINION_MODE_VAR, num(1), OWNER),
              changeVar(COINS, num(2), OWNER),
            ], [
              setVar(MINION_MODE_VAR, num(2), OWNER),
            ]),
          ]),
          onPlay('dom_ab_minion_attack', 'Sweep the table', [
            iff(eq(getVar(MINION_MODE_VAR, OWNER), num(2)), [
              announce(OWNER, ' discards their hand and draws 4.'),
              tmove(ALL, zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              draw(OWNER, 4),
              forEachOpponent([
                iff(allOf(
                  eq(getVar(IMMUNE, PLAYER), num(0)),
                  gte(zoneCount(zone(HAND, PLAYER)), num(5)),
                ), [
                  announce(PLAYER, ' discards their hand and draws 4.'),
                  tmove(ALL, zone(HAND, PLAYER), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
                  draw(PLAYER, 4),
                ]),
              ]),
            ]),
            // IMMUNE resets in the shared effectResolved trigger, per attack.
          ], true),
        ]),

      // NOBLES — Action – Victory, worth 2 VP.
      // DEVIATION: primary type is Action (one typeId per card); the printed
      // 2 VP still scores via the recount's vp-field sum, and Patrol's
      // "victory-ish" filter catches it through vp > 0.
      cardDef('dom_card_nobles', 'Nobles', 6, 0, 2,
        'Worth 2 victory points. Choose one: +3 Cards; or +2 Actions.', [
          onPlay('dom_ab_nobles_choice', 'Noblesse oblige', [
            chooseOption('Nobles: choose one', [
              { id: 'cards', label: '+3 Cards' },
              { id: 'actions', label: '+2 Actions' },
            ], OWNER),
            iff(eq(CHOICE, str('cards')), [
              draw(OWNER, 3),
            ], [
              changeVar(ACTIONS, num(2), OWNER),
            ]),
          ]),
        ]),

      // PATROL — +3 Cards, reveal top 4, Victory cards + Curses to hand.
      // DEVIATIONS: (1) "put the rest back in any order" — the engine puts
      // them back in a fixed order (no reorder choice primitive). (2) When
      // the deck runs short the discard is shuffled in to keep revealing
      // (official timing: reveal what remains, then shuffle and continue —
      // here the remaining deck cards are revealed first too, exactly).
      cardDef('dom_card_patrol', 'Patrol', 5, 0, 0,
        '+3 Cards. Reveal the top 4 cards of your deck. Put the Victory cards '
        + 'and Curses into your hand. Put the rest back in any order.', [
          onPlay('dom_ab_patrol_reveal', 'Walk the walls', [
            draw(OWNER, 3),
            tmove(topN(4), zone(DECK, OWNER), zone(LOOK), 'look', { faceUp: true }),
            iff(allOf(
              lt(zoneCount(zone(LOOK)), num(4)),
              gt(zoneCount(zone(DISCARD, OWNER)), num(0)),
            ), [
              setVar(SCRATCH, sub(num(4), zoneCount(zone(LOOK))), OWNER),
              tmove(ALL, zone(DISCARD, OWNER), zone(DECK, OWNER), 'look'),
              shuffle(zone(DECK, OWNER)),
              tmove(
                { kind: 'top', count: getVar(SCRATCH, OWNER) } as CardSelector,
                zone(DECK, OWNER), zone(LOOK), 'look', { faceUp: true },
              ),
            ]),
            announce(OWNER, ' patrols the top of their deck.'),
            tmove(matching(PATROL_TAKE), zone(LOOK), zone(HAND, OWNER), 'draw', { faceUp: true }),
            tmove(ALL, zone(LOOK), zone(DECK, OWNER), 'look', { toPosition: 'top' }),
          ]),
        ]),

      // REPLACE — Action – Attack, Remodel shape with a typed destination.
      // The whole card can't be stacked (Moat would wrongly block the trash
      // and gain), so the inline half stashes a gained-a-Victory flag and a
      // separate stacked half deals the Curses, IMMUNE-gated per victim.
      // DEVIATIONS: (1) the trash + gain resolve before the response window
      // (Moat can only block the Curses — which is all it may block anyway).
      // (2) The flag resets after the attack resolves (and again at cleanup),
      // so Throne Room + Replace deals ONE round of Curses even if both gains
      // were Victory cards. (3) A gained Harem counts as a Treasure (top of
      // deck), never as a Victory (its engine type is Treasure-only).
      cardDef('dom_card_replace', 'Replace', 5, 0, 0,
        'Trash a card from your hand. Gain a card costing up to 2 Coins more '
        + 'than it. If the gained card is an Action or Treasure, put it onto '
        + 'your deck; if it’s a Victory card, each other player gains a Curse.', [
          onPlay('dom_ab_replace_swap', 'Out with the old', [
            iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
              chooseCard({
                who: OWNER, from: zone(HAND, OWNER),
                prompt: 'Replace: choose a card to trash',
              }),
              setVar(SCRATCH, add(field(CHOICE, COST), num(2)), OWNER),
              announce(OWNER, ' trashes ', CHOICE, '.'),
              tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              iff(gt(countCards(zone(SUPPLY),
                lte(field(CARD, COST), add(getVar(SCRATCH, OWNER), getVar(DISCOUNT)))), num(0)), [
                choosePileBlock({
                  who: OWNER, from: zone(SUPPLY),
                  filter: lte(field(CARD, COST), add(getVar(SCRATCH, OWNER), getVar(DISCOUNT))),
                  prompt: 'Replace: gain a card costing up to 2 more than the trashed card',
                  body: [
                    announce(OWNER, ' gains ', CARD, '.'),
                    iff(anyOf(IS_ACTION_CARD, IS_TREASURE_CARD), [
                      announce(OWNER, ' puts it onto their deck.'),
                      tmove(specific(CARD), zone(SUPPLY), zone(DECK, OWNER), 'gain',
                        { toPosition: 'top', faceUp: true }),
                    ], [
                      tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                    ]),
                    iff(isA(CARD, VICTORY), [setVar(REPLACE_VICTORY_VAR, num(1), OWNER)]),
                  ],
                }),
              ], [announce('Nothing in the supply is cheap enough.')]),
            ], [announce(OWNER, ' has nothing to replace.')]),
          ]),
          onPlay('dom_ab_replace_attack', 'The old regime bites back', [
            iff(eq(getVar(REPLACE_VICTORY_VAR, OWNER), num(1)), [
              forEachOpponent([
                iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
                  gainNamed('Curse', zone(DISCARD, PLAYER), PLAYER, ' gains a Curse.'),
                ]),
              ]),
            ]),
            // The flag fades with the attack (see the card's deviation note);
            // IMMUNE itself resets in the shared effectResolved trigger.
            setVar(REPLACE_VICTORY_VAR, num(0), OWNER),
          ], true),
        ]),

      // TORTURER — Action – Attack. Each victim chooses (even an impossible
      // option, per the official parenthetical): discarding 2 with fewer
      // discards what they have; taking a Curse from an empty pile does
      // nothing.
      cardDef('dom_card_torturer', 'Torturer', 5, 0, 0,
        '+3 Cards. Each other player either discards 2 cards or gains a Curse '
        + 'to their hand, their choice. (They may pick an option they can’t do.)', [
          onPlay('dom_ab_torturer_draw', 'Sharpen the tools', [draw(OWNER, 3)]),
          onPlay('dom_ab_torturer_attack', 'The dungeon door opens', [
            forEachOpponent([
              iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
                chooseOption('Torturer: discard 2 cards, or gain a Curse to your hand', [
                  { id: 'discard', label: 'Discard 2 cards' },
                  { id: 'curse', label: 'Gain a Curse to your hand' },
                ], PLAYER),
                iff(eq(CHOICE, str('discard')), [
                  // keep = max(0, hand - 2), clamped through SCRATCH.
                  setVar(SCRATCH, sub(zoneCount(zone(HAND, PLAYER)), num(2)), PLAYER),
                  iff(lt(getVar(SCRATCH, PLAYER), num(0)), [setVar(SCRATCH, num(0), PLAYER)]),
                  discardDownTo({
                    who: PLAYER, from: zone(HAND, PLAYER), to: zone(DISCARD, PLAYER),
                    keep: getVar(SCRATCH, PLAYER),
                    prompt: 'Torturer: discard 2 cards',
                  }),
                ], [
                  gainNamed('Curse', zone(HAND, PLAYER), PLAYER, ' gains a Curse to their hand.'),
                ]),
              ]),
            ]),
            // IMMUNE resets in the shared effectResolved trigger, per attack.
          ], true),
        ]),

      // TRADING POST — trash exactly min(2, hand); the Silver arrives only
      // when two cards actually burned.
      cardDef('dom_card_trading_post', 'Trading Post', 5, 0, 0,
        'Trash 2 cards from your hand. If you did, gain a Silver to your hand.', [
          onPlay('dom_ab_trading_post_trade', 'Fair exchange', [
            // SCRATCH = min(2, hand size) — the mandatory trash count.
            setVar(SCRATCH, num(2), OWNER),
            iff(lt(zoneCount(zone(HAND, OWNER)), num(2)), [
              setVar(SCRATCH, zoneCount(zone(HAND, OWNER)), OWNER),
            ]),
            iff(gt(getVar(SCRATCH, OWNER), num(0)), [
              chooseCardsBlock({
                who: OWNER, from: zone(HAND, OWNER),
                min: getVar(SCRATCH, OWNER), max: getVar(SCRATCH, OWNER),
                prompt: 'Trading Post: trash 2 cards from your hand',
                body: [
                  announce(OWNER, ' trashes ', CARD, '.'),
                  tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
                ],
              }),
              iff(eq(getVar(SCRATCH, OWNER), num(2)), [
                gainNamed('Silver', zone(HAND, OWNER), OWNER, ' gains a Silver to their hand.'),
              ]),
            ], [announce(OWNER, ' has nothing to trade away.')]),
          ]),
        ]),

      // UPGRADE — Remodel shape with an EXACTLY +1 cost filter.
      // DEVIATION: the exact match compares printed costs (trashed + 1 =
      // candidate). Under a uniform Bridge discount both sides shift equally
      // so the match is unchanged, EXCEPT at the zero floor (e.g. discount 1,
      // trash a Copper: official would allow effective-cost-1 cards; here
      // only printed-cost-1 cards qualify).
      cardDef('dom_card_upgrade', 'Upgrade', 5, 0, 0,
        '+1 Card. +1 Action. Trash a card from your hand. Gain a card costing '
        + 'exactly 1 Coin more than it.', [
          onPlay('dom_ab_upgrade_swap', 'One rung up', [
            draw(OWNER, 1),
            changeVar(ACTIONS, num(1), OWNER),
            iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
              chooseCard({
                who: OWNER, from: zone(HAND, OWNER),
                prompt: 'Upgrade: choose a card to trash',
              }),
              setVar(SCRATCH, add(field(CHOICE, COST), num(1)), OWNER),
              announce(OWNER, ' trashes ', CHOICE, '.'),
              tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              iff(gt(countCards(zone(SUPPLY), eq(field(CARD, COST), getVar(SCRATCH, OWNER))), num(0)), [
                choosePileBlock({
                  who: OWNER, from: zone(SUPPLY),
                  filter: eq(field(CARD, COST), getVar(SCRATCH, OWNER)),
                  prompt: 'Upgrade: gain a card costing exactly 1 more than the trashed card',
                  body: [
                    announce(OWNER, ' gains ', CARD, '.'),
                    tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                  ],
                }),
              ], [announce('Nothing in the supply costs exactly that much.')]),
            ], [announce(OWNER, ' has nothing to upgrade.')]),
          ]),
        ]),
    ];
  },

  buildCleanupResets(kit: CardKit): Block[] {
    // Per-turn stashes fade with the turn, for every seat (Possession-proof).
    return [forEachPlayer([
      setVar(MINION_MODE_VAR, num(0), kit.PLAYER),
      setVar(REPLACE_VICTORY_VAR, num(0), kit.PLAYER),
    ])];
  },
};
