/**
 * Base 2E — the ten kingdom cards the built-in def was still missing:
 * Harbinger, Merchant, Vassal, Bureaucrat, Moneylender, Poacher, Bandit,
 * Library, Sentry, Artisan. (The other sixteen Base cards already live in
 * dominionGame.ts.)
 *
 * Idioms follow the dominionGame.ts cookbook: draws are the `draw` block
 * (inline seeded reshuffle), every move carries its cause tag, attack halves
 * are separate `stacked` abilities gated per victim on IMMUNE == 0 (the
 * shared effectResolved trigger resets it), look-at effects stage through
 * the hidden shared LOOK zone with `revealed` choices, and every mandatory
 * choice is guarded so a random session can never hang on one.
 */
import type { Block, Expr, TriggerDef, ZoneRef } from '../../shared/types';
import {
  ALL, add, allOf, announce, bestCard, bnd, changeVar, chooseCard, chooseCardsBlock,
  countCards, discardDownTo, eq, forEachOpponent, forEachPlayer, getVar, gt, iff, lt,
  move, not, num, setVar, shuffle, specific, sub, topCard, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

/** Per-player flag: the first-Silver-this-turn bonus has been paid (Merchant). */
const MERCHANT_FLAG = 'dom_var_merchant_silver';

/**
 * The official empty-deck reshuffle for effects that TAKE cards off the deck
 * without the `draw` block (Vassal / Bandit / Sentry): when `who`'s deck is
 * empty, flip the discard face-down into it and give it a seeded shuffle.
 */
function refillDeck(kit: CardKit, who: Expr): Block {
  const deck = zone(kit.zones.DECK, who);
  return iff(allOf(
    eq(zoneCount(deck), num(0)),
    gt(zoneCount(zone(kit.zones.DISCARD, who)), num(0)),
  ), [
    move(ALL, zone(kit.zones.DISCARD, who), deck, { faceUp: false }),
    shuffle(deck),
  ]);
}

/**
 * Move the top card of `who`'s deck to `to` (reshuffling first when the deck
 * is empty). Unrolled per card, so "top 2" keeps the official per-card
 * reshuffle timing without a repeat block.
 */
function takeTop(kit: CardKit, who: Expr, to: ZoneRef, faceUp: boolean): Block[] {
  const deck = zone(kit.zones.DECK, who);
  return [
    refillDeck(kit, who),
    iff(gt(zoneCount(deck), num(0)), [
      move(topN(1), deck, to, { faceUp }),
    ]),
  ];
}

/** A yes/no question to `who`; the answer lands in $choice as a boolean. */
const yesNo = (who: Expr, prompt: string): Block =>
  ({ kind: 'choose', who, choice: { kind: 'yesNo', prompt } });

const IDS: Record<string, string> = {
  Harbinger: 'dom_card_harbinger',
  Merchant: 'dom_card_merchant',
  Vassal: 'dom_card_vassal',
  Bureaucrat: 'dom_card_bureaucrat',
  Moneylender: 'dom_card_moneylender',
  Poacher: 'dom_card_poacher',
  Bandit: 'dom_card_bandit',
  Library: 'dom_card_library',
  Sentry: 'dom_card_sentry',
  Artisan: 'dom_card_artisan',
};

export const base2e: ExpansionModule = {
  id: 'base2e',

  piles: [
    { name: 'Harbinger', cost: 3, count: 10 },
    { name: 'Merchant', cost: 3, count: 10 },
    { name: 'Vassal', cost: 3, count: 10 },
    { name: 'Bureaucrat', cost: 4, count: 10 },
    { name: 'Moneylender', cost: 4, count: 10 },
    { name: 'Poacher', cost: 4, count: 10 },
    { name: 'Bandit', cost: 5, count: 10 },
    { name: 'Library', cost: 5, count: 10 },
    { name: 'Sentry', cost: 5, count: 10 },
    { name: 'Artisan', cost: 6, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Bureaucrat', 'Bandit'],

  variables: [
    {
      id: MERCHANT_FLAG, name: 'Merchant: first Silver paid',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
  ],

  buildCards(kit) {
    const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK } = kit.zones;
    const { ACTIONS, COINS, IMMUNE, EMPTY_PILES, SCRATCH } = kit.vars;
    const { COST } = kit.fields;
    const { OWNER, CARD, CHOICE, PLAYER } = kit;

    return [
      kit.cardDef(IDS['Harbinger'], 'Harbinger', 3, 0, 0,
        '+1 Card. +1 Action. Look through your discard pile. You may put a card from it onto your deck.', [
          kit.onPlay('dom_ab_harbinger_main', 'Heralded return', [
            kit.draw(OWNER, 1),
            changeVar(ACTIONS, num(1), OWNER),
            iff(gt(zoneCount(zone(DISCARD, OWNER)), num(0)), [
              chooseCardsBlock({
                who: OWNER, from: zone(DISCARD, OWNER), min: num(0), max: num(1),
                revealed: true,
                prompt: 'Harbinger: you may put a card from your discard pile onto your deck',
                body: [
                  announce(OWNER, ' puts ', CARD, ' onto their deck.'),
                  move(specific(CARD), zone(DISCARD, OWNER), zone(DECK, OWNER),
                    { toPosition: 'top', faceUp: false }),
                ],
              }),
            ]),
          ]),
        ]),

      // The +$1 rides on a global trigger (see buildTriggers): the first
      // Silver entering In Play tagged 'play' pays +$1 per Merchant in play.
      kit.cardDef(IDS['Merchant'], 'Merchant', 3, 0, 0,
        '+1 Card. +1 Action. The first time you play a Silver this turn, +$1.', [
          kit.onPlay('dom_ab_merchant_main', 'Open a stall', [
            kit.draw(OWNER, 1),
            changeVar(ACTIONS, num(1), OWNER),
          ]),
        ]),

      kit.cardDef(IDS['Vassal'], 'Vassal', 3, 0, 0,
        '+$2. Discard the top card of your deck. If it’s an Action card, you may play it.', [
          kit.onPlay('dom_ab_vassal_main', 'Sworn service', [
            changeVar(COINS, num(2), OWNER),
            iff(gt(add(zoneCount(zone(DECK, OWNER)), zoneCount(zone(DISCARD, OWNER))), num(0)), [
              refillDeck(kit, OWNER),
              kit.tmove(topN(1), zone(DECK, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              announce(OWNER, ' discards ', topCard(zone(DISCARD, OWNER)), ' from the top of their deck.'),
              iff(kit.isA(topCard(zone(DISCARD, OWNER)), kit.types.ACTION), [
                yesNo(OWNER, 'Vassal: play the discarded Action?'),
                iff(CHOICE, [
                  announce(OWNER, ' plays ', topCard(zone(DISCARD, OWNER)), ' with Vassal.'),
                  kit.tmove(specific(topCard(zone(DISCARD, OWNER))),
                    zone(DISCARD, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
                ]),
              ]),
            ]),
          ]),
        ]),

      kit.cardDef(IDS['Bureaucrat'], 'Bureaucrat', 4, 0, 0,
        'Gain a Silver onto your deck. Each other player reveals a Victory card from their hand '
        + 'and puts it onto their deck (or reveals a hand with no Victory cards).', [
          // The gain is immediate; only the attack half goes through the
          // stack, so Moat owners get a response window first.
          kit.onPlay('dom_ab_bureaucrat_gain', 'Requisition', [
            iff(gt(countCards(zone(SUPPLY), kit.nameIs('Silver')), num(0)), [
              announce(OWNER, ' gains a Silver onto their deck.'),
              kit.tmove(specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Silver'))),
                zone(SUPPLY), zone(DECK, OWNER), 'gain', { toPosition: 'top', faceUp: false }),
            ], [announce('The Silver pile is empty — nothing to requisition.')]),
          ]),
          kit.onPlay('dom_ab_bureaucrat_attack', 'Tax the fiefs', [
            forEachOpponent([
              iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
                iff(gt(countCards(zone(HAND, PLAYER), kit.isA(CARD, kit.types.VICTORY)), num(0)), [
                  chooseCardsBlock({
                    who: PLAYER, from: zone(HAND, PLAYER),
                    filter: kit.isA(CARD, kit.types.VICTORY),
                    min: num(1), max: num(1), revealed: true,
                    prompt: 'Bureaucrat: reveal a Victory card and put it onto your deck',
                    body: [
                      announce(PLAYER, ' reveals ', CARD, ' and puts it onto their deck.'),
                      move(specific(CARD), zone(HAND, PLAYER), zone(DECK, PLAYER),
                        { toPosition: 'top', faceUp: false }),
                    ],
                  }),
                ], [announce(PLAYER, ' reveals a hand with no Victory cards.')]),
              ]),
            ]),
            // IMMUNE resets in the shared effectResolved trigger, per attack.
          ], true),
        ]),

      kit.cardDef(IDS['Moneylender'], 'Moneylender', 4, 0, 0,
        'You may trash a Copper from your hand for +$3.', [
          kit.onPlay('dom_ab_moneylender_main', 'Call in the debt', [
            iff(gt(countCards(zone(HAND, OWNER), kit.nameIs('Copper')), num(0)), [
              chooseCardsBlock({
                who: OWNER, from: zone(HAND, OWNER), filter: kit.nameIs('Copper'),
                min: num(0), max: num(1),
                prompt: 'Moneylender: you may trash a Copper for +$3',
                body: [
                  announce(OWNER, ' trashes a Copper for +$3.'),
                  kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
                  changeVar(COINS, num(3), OWNER),
                ],
              }),
            ]),
          ]),
        ]),

      kit.cardDef(IDS['Poacher'], 'Poacher', 4, 0, 0,
        '+1 Card. +1 Action. +$1. Discard a card per empty Supply pile.', [
          kit.onPlay('dom_ab_poacher_main', 'Poach the commons', [
            kit.draw(OWNER, 1),
            changeVar(ACTIONS, num(1), OWNER),
            changeVar(COINS, num(1), OWNER),
            iff(gt(getVar(EMPTY_PILES), num(0)), [
              // keep = hand - empty piles, clamped at 0 (discardTo no-ops
              // when the hand is already at or under the keep count).
              setVar(SCRATCH, sub(zoneCount(zone(HAND, OWNER)), getVar(EMPTY_PILES)), OWNER),
              iff(lt(getVar(SCRATCH, OWNER), num(0)), [setVar(SCRATCH, num(0), OWNER)]),
              discardDownTo({
                who: OWNER, from: zone(HAND, OWNER), to: zone(DISCARD, OWNER),
                keep: getVar(SCRATCH, OWNER),
                prompt: 'Poacher: discard a card per empty Supply pile',
              }),
            ]),
          ]),
        ]),

      kit.cardDef(IDS['Bandit'], 'Bandit', 5, 0, 0,
        'Gain a Gold. Each other player reveals the top 2 cards of their deck, trashes a revealed '
        + 'Treasure other than Copper, and discards the rest.', [
          kit.onPlay('dom_ab_bandit_gain', 'Plunder', [
            iff(gt(countCards(zone(SUPPLY), kit.nameIs('Gold')), num(0)), [
              announce(OWNER, ' gains a Gold.'),
              kit.tmove(specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Gold'))),
                zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
            ], [announce('The Gold pile is empty — nothing to plunder.')]),
          ]),
          kit.onPlay('dom_ab_bandit_attack', 'Roadside ambush', [
            forEachOpponent([
              iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
                // Reveal the top 2 (per-card reshuffle) into the staging zone.
                ...takeTop(kit, PLAYER, zone(LOOK), true),
                ...takeTop(kit, PLAYER, zone(LOOK), true),
                iff(gt(countCards(zone(LOOK), allOf(kit.IS_TREASURE_CARD, not(kit.nameIs('Copper')))), num(0)), [
                  chooseCardsBlock({
                    who: PLAYER, from: zone(LOOK),
                    filter: allOf(kit.IS_TREASURE_CARD, not(kit.nameIs('Copper'))),
                    min: num(1), max: num(1), revealed: true,
                    prompt: 'Bandit: trash a revealed Treasure other than Copper',
                    body: [
                      announce(PLAYER, ' trashes ', CARD, '.'),
                      kit.tmove(specific(CARD), zone(LOOK), zone(TRASH), 'trash', { faceUp: true }),
                    ],
                  }),
                ]),
                iff(gt(zoneCount(zone(LOOK)), num(0)), [
                  kit.tmove(ALL, zone(LOOK), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
                ]),
              ]),
            ]),
            // IMMUNE resets in the shared effectResolved trigger, per attack.
          ], true),
        ]),

      // DEVIATION (documented): each drawn card stages through LOOK; a drawn
      // Action is announced publicly before the keep/skip question (the
      // engine's yes/no sheet cannot show a card face, so the log names it).
      // Officially only SET-ASIDE cards are revealed; kept ones are private.
      kit.cardDef(IDS['Library'], 'Library', 5, 0, 0,
        'Draw until you have 7 cards in hand, skipping any Action cards you choose to; '
        + 'set those aside, discarding them afterwards.', [
          kit.onPlay('dom_ab_library_main', 'Stock the shelves', [
            {
              kind: 'repeatWhile',
              cond: allOf(
                lt(zoneCount(zone(HAND, OWNER)), num(7)),
                gt(add(zoneCount(zone(DECK, OWNER)), zoneCount(zone(DISCARD, OWNER))), num(0)),
              ),
              body: [
                refillDeck(kit, OWNER),
                // Stage the next card; set-aside Actions pile up UNDER it in
                // LOOK, so topCard(LOOK) is always the card just taken.
                move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: false }),
                iff(kit.isA(topCard(zone(LOOK)), kit.types.ACTION), [
                  announce(OWNER, ' draws ', topCard(zone(LOOK)), ' with Library.'),
                  yesNo(OWNER, 'Library: keep the drawn Action in hand? (No sets it aside)'),
                  iff(CHOICE, [
                    kit.tmove(specific(topCard(zone(LOOK))), zone(LOOK), zone(HAND, OWNER), 'draw', { faceUp: true }),
                  ], [
                    announce(OWNER, ' sets it aside.'),
                  ]),
                ], [
                  kit.tmove(specific(topCard(zone(LOOK))), zone(LOOK), zone(HAND, OWNER), 'draw', { faceUp: true }),
                ]),
              ],
            } as Block,
            // Set-aside Actions (still in LOOK) are discarded afterwards —
            // they never reshuffle back in during the resolution, as printed.
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              kit.tmove(ALL, zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
            ]),
          ]),
        ]),

      // DEVIATION (documented): "put the rest back on top in any order" —
      // the rest go back in a fixed order (no reorder choice primitive).
      kit.cardDef(IDS['Sentry'], 'Sentry', 5, 0, 0,
        '+1 Card. +1 Action. Look at the top 2 cards of your deck. Trash and/or discard '
        + 'any number of them. Put the rest back on top in any order.', [
          kit.onPlay('dom_ab_sentry_main', 'Stand watch', [
            kit.draw(OWNER, 1),
            changeVar(ACTIONS, num(1), OWNER),
            ...takeTop(kit, OWNER, zone(LOOK), false),
            ...takeTop(kit, OWNER, zone(LOOK), false),
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              chooseCardsBlock({
                who: OWNER, from: zone(LOOK), min: num(0), max: num(2), revealed: true,
                prompt: 'Sentry: trash any number of the top 2 cards of your deck',
                body: [
                  announce(OWNER, ' trashes ', CARD, '.'),
                  kit.tmove(specific(CARD), zone(LOOK), zone(TRASH), 'trash', { faceUp: true }),
                ],
              }),
            ]),
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              chooseCardsBlock({
                who: OWNER, from: zone(LOOK), min: num(0), max: num(2), revealed: true,
                prompt: 'Sentry: discard any number of the rest',
                body: [
                  announce(OWNER, ' discards ', CARD, '.'),
                  kit.tmove(specific(CARD), zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                ],
              }),
            ]),
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
            ]),
          ]),
        ]),

      kit.cardDef(IDS['Artisan'], 'Artisan', 6, 0, 0,
        'Gain a card to your hand costing up to $5. Put a card from your hand onto your deck.', [
          kit.onPlay('dom_ab_artisan_main', 'Master craft', [
            ...kit.gainFromSupply({
              limit: num(5), toHand: true,
              prompt: 'Artisan: gain a card to your hand costing up to $5',
              whiff: [announce(OWNER, ' finds nothing to craft.')],
            }),
            iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
              chooseCard({
                who: OWNER, from: zone(HAND, OWNER),
                prompt: 'Artisan: put a card from your hand onto your deck',
              }),
              announce(OWNER, ' puts a card onto their deck.'),
              move(specific(CHOICE), zone(HAND, OWNER), zone(DECK, OWNER),
                { toPosition: 'top', faceUp: false }),
            ]),
          ]),
        ]),
    ];
  },

  buildTriggers(kit): TriggerDef[] {
    const owner = bnd('$owner');
    return [
      {
        id: 'dom_trigger_merchant_silver',
        name: 'Merchant: the first Silver this turn',
        // cardEnterZone binds $card (the moved card) and $owner (the In-Play
        // zone instance's owner — the player who played it).
        event: { kind: 'cardEnterZone', zoneId: kit.zones.INPLAY, tag: 'play' },
        condition: allOf(
          kit.nameIs('Silver'),
          eq(getVar(MERCHANT_FLAG, owner), num(0)),
        ),
        script: [
          // The "first time" is spent whether or not a Merchant is out —
          // a later Merchant cannot collect on a second Silver, as printed.
          setVar(MERCHANT_FLAG, num(1), owner),
          iff(gt(countCards(zone(kit.zones.INPLAY, owner), kit.nameIs('Merchant')), num(0)), [
            changeVar(kit.vars.COINS,
              countCards(zone(kit.zones.INPLAY, owner), kit.nameIs('Merchant')), owner),
            announce(owner, ' gets +$1 per Merchant for the first Silver this turn.'),
          ]),
        ],
      },
    ];
  },

  buildCleanupResets(kit): Block[] {
    return [forEachPlayer([setVar(MERCHANT_FLAG, num(0), kit.PLAYER)])];
  },
};
