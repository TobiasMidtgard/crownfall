/**
 * Adventures — the 12 TOKEN-FREE Events (landscape sideboard, kind 'event'):
 * Alms, Borrow, Quest, Save, Scouting Party, Travelling Fair, Bonfire,
 * Expedition, Pilgrimage, Ball, Raid, Trade.
 *
 * An Event's effect is its onPlay ability: the core 'dom_action_buy_event'
 * pays the printed coin cost, spends a buy and fires the ability IN PLACE —
 * the card never leaves the sideboard. The buyer is the CURRENT player (the
 * ability's $owner falls back to the current player for a shared-zone card),
 * so every script below speaks CURRENT-relative zones/vars, exactly like
 * empiresEvents.
 *
 * EXCLUDED here (verified against the official card list):
 *  - Plan / Seaway / Lost Arts / Training / Pathfinding now SHIP in the
 *    sibling adventuresTokens module (per-player pile-name token vars).
 *  - Ferry ($3): per-player COST modification is inexpressible (the only
 *    cost lever is the shared global discount).
 *  - Inheritance ($7): Estates-become-copies needs card morphing.
 *  - Mission ($4): extra turns (the extra-turn bucket).
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - ONCE PER TURN (Alms / Borrow / Save / Pilgrimage): printed, a second
 *    purchase that turn is FORBIDDEN outright. The core buy-event action is
 *    shared and cannot carry per-event legality, so here the second buy is
 *    ACCEPTED (cost + buy still paid) and the effect whiffs with an
 *    announcement. Don't buy them twice.
 *  - -1 CARD token (Borrow / Raid): printed, the token sits on your deck and
 *    shrinks your NEXT draw wherever it happens (even a mid-turn Smithy).
 *    Here it shrinks your next CLEANUP redraw only: after the 5-card redraw
 *    the top card of the hand — the LAST card drawn, since the draw block
 *    stacks each card on top — returns to the top of the deck, which is
 *    order-exact "drew 4". Mid-turn draws are never affected.
 *  - -$1 token (Ball): printed, it eats $1 from your next +$ of any kind.
 *    Here it fires on your next TREASURE play (the buildTriggers watcher);
 *    +$ from Action cards does not consume it. It persists across turns
 *    until spent, like the real token.
 *  - TRAVELLING FAIR: the topdeck offer fires only while the gained card is
 *    still in your discard pile (gains straight to hand/deck — Mine,
 *    Bureaucrat — are already where you want them; a Watchtower/Trader
 *    response that moved the card first also withdraws the offer).
 *  - PILGRIMAGE: the Journey token is a per-player boolean (starts face up,
 *    flips on every use — first use flips it DOWN and whiffs, exactly like
 *    the printed token). "Differently named" is NOT enforced: picking two
 *    same-named in-play cards gains two copies (the printed card forbids
 *    the duplicate pick).
 *  - SCOUTING PARTY: the 2 kept cards go back on top in their original
 *    relative order (no reorder choice surface).
 *  - QUEST: an unmeetable pledge (no Attack in hand, fewer than 2 Curses,
 *    fewer than 6 cards) whiffs with an announcement instead of the official
 *    "discard what you can, no Gold" partial resolution.
 *  - BONFIRE: ships the printed 2015 text ("Trash up to 2 cards you have in
 *    play" — the task's shape); the 2019 errata ("up to 2 Coppers you have
 *    in play") is NOT applied.
 *  - RAID: the per-Silver gains are unrolled to a cap of 12 Silvers in play
 *    (no repeat block); more than 12 in play still gains only 12.
 *  - SAVE: the set-aside card returns to your hand at cleanup AFTER the
 *    redraw (and after the -1 Card return, so it can never be the card the
 *    token puts back).
 */
import type {
  Block, CardDef, Expr, TriggerDef, VariableDef, ZoneDef,
} from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, bestCard, bnd, cardZoneId, changeVar, chooseCard,
  chooseCardsBlock, chooseOption, countCards, eq, field, forEachOpponent, forEachPlayer,
  getVar, gt, gte, iff, lte, move, num, setVar, shuffle, specific, str, sub, topN, zone,
  zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Alms: 'dom_card_alms',
  Borrow: 'dom_card_borrow',
  Quest: 'dom_card_quest',
  Save: 'dom_card_save',
  'Scouting Party': 'dom_card_scouting_party',
  'Travelling Fair': 'dom_card_travelling_fair',
  Bonfire: 'dom_card_bonfire',
  Expedition: 'dom_card_expedition',
  Pilgrimage: 'dom_card_pilgrimage',
  Ball: 'dom_card_ball',
  Raid: 'dom_card_raid',
  Trade: 'dom_card_trade',
};

/** The landscape sideboard (stable dominionGame.ts literal). */
const LANDSCAPES = 'dom_zone_landscapes';

/** Save's per-player set-aside mat (back to the hand at cleanup). */
export const SAVE_ZONE = 'dom_zone_adv_save';

// --- per-player state (all hidden bookkeeping, empiresEvents' precedent) ------

/** Once-per-turn latches — reset at every cleanup. */
export const ALMS_USED = 'dom_var_adv_alms_used';
export const BORROW_USED = 'dom_var_adv_borrow_used';
export const SAVE_USED = 'dom_var_adv_save_used';
export const PILGRIMAGE_USED = 'dom_var_adv_pilgrimage_used';
/** Travelling Fair's per-turn topdeck window — reset at cleanup. */
export const TFAIR_ACTIVE = 'dom_var_adv_travelling_fair';
/** The -1 Card token (Borrow / Raid): consumed at the next cleanup redraw. */
export const MINUS_CARD = 'dom_var_adv_minus_card';
/** The -$1 token (Ball): consumed at the next Treasure play. */
export const MINUS_COIN = 'dom_var_adv_minus_coin';
/** Expedition's banked bonus draw (+2 per buy): consumed at cleanup. */
export const EXPEDITION_BONUS = 'dom_var_adv_expedition';
/** The Journey token: 1 = face up (the printed start), 0 = face down. */
export const JOURNEY = 'dom_var_adv_journey';
/** Pilgrimage's name stash (the copy-gain filter reads it across $card rebinds). */
export const PILGRIMAGE_NAME = 'dom_var_adv_pilgrimage_name';

/** Is this Event on the table? (Unpicked landscapes must do nothing.) */
const onTable = (kit: CardKit, name: string): Expr =>
  gt(countCards(zone(LANDSCAPES), kit.nameIs(name)), num(0));

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK } = kit.zones;
  const { BUYS, COINS, SCRATCH, DISCOUNT } = kit.vars;
  const { COST } = kit.fields;
  const { CARD, CHOICE } = kit;

  const supplyHas = (name: string): Expr =>
    gt(countCards(zone(SUPPLY), kit.nameIs(name)), num(0));
  /** Top copy of a named supply pile → the current player's discard, tagged 'gain'. */
  const gainTop = (name: string): Block =>
    kit.tmove(
      specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs(name))),
      zone(SUPPLY), zone(DISCARD, CURRENT), 'gain', { faceUp: true },
    );
  /** Bridge-aware "gain a card costing up to $cap" — fresh nodes per call. */
  const gainUpTo = (cap: number, prompt: string): Block[] => {
    const filter = (): Expr => lte(field(CARD, COST), add(num(cap), getVar(DISCOUNT)));
    return [
      iff(gt(countCards(zone(SUPPLY), filter()), num(0)), [
        kit.choosePileBlock({
          who: CURRENT, from: zone(SUPPLY), filter: filter(), prompt,
          body: [
            announce(CURRENT, ' gains ', CARD, '.'),
            kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, CURRENT), 'gain', { faceUp: true }),
          ],
        }),
      ], [announce(`Nothing in the supply costs $${cap} or less.`)]),
    ];
  };
  /** The official empty-deck reshuffle for non-`draw` deck takes (base2e's). */
  const refillDeck = (): Block => iff(allOf(
    eq(zoneCount(zone(DECK, CURRENT)), num(0)),
    gt(zoneCount(zone(DISCARD, CURRENT)), num(0)),
  ), [
    move(ALL, zone(DISCARD, CURRENT), zone(DECK, CURRENT), { faceUp: false }),
    shuffle(zone(DECK, CURRENT)),
  ]);
  /** Top of the current player's deck → LOOK (per-card reshuffle timing). */
  const takeTopToLook = (): Block[] => [
    refillDeck(),
    iff(gt(zoneCount(zone(DECK, CURRENT)), num(0)), [
      move(topN(1), zone(DECK, CURRENT), zone(LOOK), { faceUp: false }),
    ]),
  ];

  return [
    // ALMS ($0) — once/turn (register): if no Treasures in play, gain up to $4.
    kit.cardDef(IDS.Alms, 'Alms', 0, 0, 0,
      'Event. Once per turn: If you have no Treasures in play, gain a card costing up to $4.', [
        kit.onPlay('dom_ab_adv_alms', 'Alms', [
          iff(eq(getVar(ALMS_USED, CURRENT), num(0)), [
            setVar(ALMS_USED, num(1), CURRENT),
            iff(eq(countCards(zone(INPLAY, CURRENT), kit.IS_TREASURE_CARD), num(0)), [
              ...gainUpTo(4, 'Alms: gain a card costing up to $4'),
            ], [announce(CURRENT, ' has Treasures in play — no alms today.')]),
          ], [announce(CURRENT, ' already used Alms this turn — no effect.')]),
        ]),
      ]),

    // BORROW ($0) — once/turn: +1 Buy; if the -1 Card token is off your deck,
    // take it for +$1 (the token = MINUS_CARD, spent at your next cleanup
    // redraw — register).
    kit.cardDef(IDS.Borrow, 'Borrow', 0, 0, 0,
      "Event. Once per turn: +1 Buy. If your -1 Card token isn't on your deck, put it there and +$1.", [
        kit.onPlay('dom_ab_adv_borrow', 'Borrow', [
          iff(eq(getVar(BORROW_USED, CURRENT), num(0)), [
            setVar(BORROW_USED, num(1), CURRENT),
            changeVar(BUYS, num(1), CURRENT),
            iff(eq(getVar(MINUS_CARD, CURRENT), num(0)), [
              setVar(MINUS_CARD, num(1), CURRENT),
              changeVar(COINS, num(1), CURRENT),
              announce(CURRENT, ' puts the -1 Card token on their deck for +$1.'),
            ], [announce(CURRENT, "'s -1 Card token is already on their deck.")]),
          ], [announce(CURRENT, ' already used Borrow this turn — no effect.')]),
        ]),
      ]),

    // QUEST ($0) — pledge an Attack / two Curses / six cards for a Gold. An
    // unmeetable pledge whiffs (register). CHOICE-safe: else-chained so no
    // inner choose can clobber $choice before a later comparison.
    kit.cardDef(IDS.Quest, 'Quest', 0, 0, 0,
      'Event. You may discard an Attack, two Curses, or six cards. If you do, gain a Gold.', [
        kit.onPlay('dom_ab_adv_quest', 'Quest', [
          chooseOption('Quest: what will you offer for a Gold?', [
            { id: 'quest_attack', label: 'Discard an Attack card' },
            { id: 'quest_curses', label: 'Discard two Curses' },
            { id: 'quest_six', label: 'Discard six cards' },
            { id: 'quest_pass', label: 'Nothing — decline the quest' },
          ], CURRENT),
          iff(eq(CHOICE, str('quest_attack')), [
            iff(gt(countCards(zone(HAND, CURRENT), kit.hasTag(CARD, kit.tags.ATTACK)), num(0)), [
              chooseCardsBlock({
                who: CURRENT, from: zone(HAND, CURRENT),
                filter: kit.hasTag(CARD, kit.tags.ATTACK), min: num(1), max: num(1),
                prompt: 'Quest: discard an Attack card',
                body: [
                  announce(CURRENT, ' discards ', CARD, ' for the Quest.'),
                  kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(DISCARD, CURRENT), 'discard', { faceUp: true }),
                ],
              }),
              iff(supplyHas('Gold'), [
                announce(CURRENT, ' completes the Quest and gains a Gold.'),
                gainTop('Gold'),
              ], [announce('No Gold left to quest for.')]),
            ], [announce(CURRENT, ' has no Attack card — the Quest fails.')]),
          ], [
            iff(eq(CHOICE, str('quest_curses')), [
              iff(gte(countCards(zone(HAND, CURRENT), kit.isA(CARD, kit.types.CURSE)), num(2)), [
                chooseCardsBlock({
                  who: CURRENT, from: zone(HAND, CURRENT),
                  filter: kit.isA(CARD, kit.types.CURSE), min: num(2), max: num(2),
                  prompt: 'Quest: discard two Curses',
                  body: [
                    announce(CURRENT, ' discards ', CARD, ' for the Quest.'),
                    kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(DISCARD, CURRENT), 'discard', { faceUp: true }),
                  ],
                }),
                iff(supplyHas('Gold'), [
                  announce(CURRENT, ' completes the Quest and gains a Gold.'),
                  gainTop('Gold'),
                ], [announce('No Gold left to quest for.')]),
              ], [announce(CURRENT, ' does not hold two Curses — the Quest fails.')]),
            ], [
              iff(eq(CHOICE, str('quest_six')), [
                iff(gte(zoneCount(zone(HAND, CURRENT)), num(6)), [
                  chooseCardsBlock({
                    who: CURRENT, from: zone(HAND, CURRENT), min: num(6), max: num(6),
                    prompt: 'Quest: discard six cards',
                    body: [
                      announce(CURRENT, ' discards ', CARD, ' for the Quest.'),
                      kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(DISCARD, CURRENT), 'discard', { faceUp: true }),
                    ],
                  }),
                  iff(supplyHas('Gold'), [
                    announce(CURRENT, ' completes the Quest and gains a Gold.'),
                    gainTop('Gold'),
                  ], [announce('No Gold left to quest for.')]),
                ], [announce(CURRENT, ' holds fewer than six cards — the Quest fails.')]),
              ], [announce(CURRENT, ' declines the Quest.')]),
            ]),
          ]),
        ]),
      ]),

    // SAVE ($1) — once/turn: +1 Buy, set a hand card aside (face down on the
    // Save mat); it returns to the hand at cleanup AFTER the redraw.
    kit.cardDef(IDS.Save, 'Save', 1, 0, 0,
      'Event. Once per turn: +1 Buy. Set aside a card from your hand, and put it into your hand at end of turn (after drawing).', [
        kit.onPlay('dom_ab_adv_save', 'Save', [
          iff(eq(getVar(SAVE_USED, CURRENT), num(0)), [
            setVar(SAVE_USED, num(1), CURRENT),
            changeVar(BUYS, num(1), CURRENT),
            iff(gt(zoneCount(zone(HAND, CURRENT)), num(0)), [
              chooseCard({
                who: CURRENT, from: zone(HAND, CURRENT),
                prompt: 'Save: set aside a card (back in your hand at end of turn)',
              }),
              announce(CURRENT, ' sets a card aside with Save.'),
              move(specific(CHOICE), zone(HAND, CURRENT), zone(SAVE_ZONE, CURRENT), { faceUp: false }),
            ], [announce(CURRENT, ' has no card to save.')]),
          ], [announce(CURRENT, ' already used Save this turn — no effect.')]),
        ]),
      ]),

    // SCOUTING PARTY ($2) — +1 Buy; look at the top 5, discard 3, the rest
    // back on top (original order — register).
    kit.cardDef(IDS['Scouting Party'], 'Scouting Party', 2, 0, 0,
      'Event. +1 Buy. Look at the top 5 cards of your deck. Discard 3 and put the rest back in any order.', [
        kit.onPlay('dom_ab_adv_scouting_party', 'Scouting Party', [
          changeVar(BUYS, num(1), CURRENT),
          ...takeTopToLook(), ...takeTopToLook(), ...takeTopToLook(),
          ...takeTopToLook(), ...takeTopToLook(),
          iff(gte(zoneCount(zone(LOOK)), num(4)), [
            chooseCardsBlock({
              who: CURRENT, from: zone(LOOK), min: num(3), max: num(3), revealed: true,
              prompt: 'Scouting Party: discard 3 of the top 5 cards of your deck',
              body: [
                announce(CURRENT, ' discards ', CARD, '.'),
                kit.tmove(specific(CARD), zone(LOOK), zone(DISCARD, CURRENT), 'discard', { faceUp: true }),
              ],
            }),
            move(ALL, zone(LOOK), zone(DECK, CURRENT), { toPosition: 'top', faceUp: false }),
          ], [
            // 3 or fewer cards in the whole deck+discard: all are discarded
            // (the official short-deck ruling — nothing goes back).
            announce(CURRENT, ' scouts what little remains — it is all discarded.'),
            kit.tmove(ALL, zone(LOOK), zone(DISCARD, CURRENT), 'discard', { faceUp: true }),
          ]),
        ]),
      ]),

    // TRAVELLING FAIR ($2) — +2 Buys; this turn's gains may be topdecked
    // (the buildTriggers watcher + per-turn flag; discard-only — register).
    kit.cardDef(IDS['Travelling Fair'], 'Travelling Fair', 2, 0, 0,
      'Event. +2 Buys. When you gain a card this turn, you may put it onto your deck.', [
        kit.onPlay('dom_ab_adv_travelling_fair', 'Travelling Fair', [
          changeVar(BUYS, num(2), CURRENT),
          setVar(TFAIR_ACTIVE, num(1), CURRENT),
          announce(CURRENT, ' may topdeck cards gained this turn.'),
        ]),
      ]),

    // BONFIRE ($3) — printed 2015 text: trash up to 2 cards you have IN PLAY
    // (the 2019 Coppers-only errata is not applied — register).
    kit.cardDef(IDS.Bonfire, 'Bonfire', 3, 0, 0,
      'Event. Trash up to 2 cards you have in play.', [
        kit.onPlay('dom_ab_adv_bonfire', 'Bonfire', [
          iff(gt(zoneCount(zone(INPLAY, CURRENT)), num(0)), [
            chooseCardsBlock({
              who: CURRENT, from: zone(INPLAY, CURRENT), min: num(0), max: num(2),
              prompt: 'Bonfire: trash up to 2 cards you have in play',
              body: [
                announce(CURRENT, ' burns ', CARD, ' on the Bonfire.'),
                kit.tmove(specific(CARD), zone(INPLAY, CURRENT), zone(TRASH), 'trash', { faceUp: true }),
              ],
            }),
          ], [announce(CURRENT, ' has nothing in play to burn.')]),
        ]),
      ]),

    // EXPEDITION ($3) — +2 cards at this turn's cleanup redraw; stacks when
    // bought twice (the banked counter, spent by buildCleanupResets).
    kit.cardDef(IDS.Expedition, 'Expedition', 3, 0, 0,
      'Event. Draw 2 extra cards for your next hand.', [
        kit.onPlay('dom_ab_adv_expedition', 'Expedition', [
          changeVar(EXPEDITION_BONUS, num(2), CURRENT),
          announce(CURRENT, ' will draw 2 extra cards for their next hand.'),
        ]),
      ]),

    // PILGRIMAGE ($4) — once/turn: flip the Journey token; face up = gain
    // copies of up to 3 in-play cards (duplicates not blocked — register).
    kit.cardDef(IDS.Pilgrimage, 'Pilgrimage', 4, 0, 0,
      "Event. Once per turn: Turn your Journey token over; then if it's face up, choose up to 3 differently named cards you have in play and gain a copy of each.", [
        kit.onPlay('dom_ab_adv_pilgrimage', 'Pilgrimage', [
          iff(eq(getVar(PILGRIMAGE_USED, CURRENT), num(0)), [
            setVar(PILGRIMAGE_USED, num(1), CURRENT),
            setVar(JOURNEY, sub(num(1), getVar(JOURNEY, CURRENT)), CURRENT),
            iff(eq(getVar(JOURNEY, CURRENT), num(1)), [
              announce(CURRENT, "'s Journey token turns face up."),
              iff(gt(zoneCount(zone(INPLAY, CURRENT)), num(0)), [
                chooseCardsBlock({
                  who: CURRENT, from: zone(INPLAY, CURRENT), min: num(0), max: num(3),
                  prompt: 'Pilgrimage: choose up to 3 cards in play to gain copies of',
                  body: [
                    setVar(PILGRIMAGE_NAME, field(CARD, 'name'), CURRENT),
                    iff(gt(countCards(zone(SUPPLY),
                      eq(field(CARD, 'name'), getVar(PILGRIMAGE_NAME, CURRENT))), num(0)), [
                      announce(CURRENT, ' gains a copy of ', CARD, '.'),
                      kit.tmove(
                        specific(bestCard(zone(SUPPLY), 'highest', COST,
                          eq(field(CARD, 'name'), getVar(PILGRIMAGE_NAME, CURRENT)))),
                        zone(SUPPLY), zone(DISCARD, CURRENT), 'gain', { faceUp: true },
                      ),
                    ], [announce('No copy left in the supply.')]),
                  ],
                }),
              ], [announce(CURRENT, ' has nothing in play to copy.')]),
            ], [announce(CURRENT, "'s Journey token turns face down — nothing happens.")]),
          ], [announce(CURRENT, ' already used Pilgrimage this turn — no effect.')]),
        ]),
      ]),

    // BALL ($5) — take the -$1 token (spent on your next Treasure play —
    // register), gain 2 cards each up to $4.
    kit.cardDef(IDS.Ball, 'Ball', 5, 0, 0,
      'Event. Take your -$1 token. Gain 2 cards each costing up to $4.', [
        kit.onPlay('dom_ab_adv_ball', 'Ball', [
          iff(eq(getVar(MINUS_COIN, CURRENT), num(0)), [
            setVar(MINUS_COIN, num(1), CURRENT),
            announce(CURRENT, ' takes the -$1 token.'),
          ]),
          ...gainUpTo(4, 'Ball: gain a card costing up to $4 (first of two)'),
          ...gainUpTo(4, 'Ball: gain a card costing up to $4 (second of two)'),
        ]),
      ]),

    // RAID ($5) — a Silver per Silver in play (unrolled, cap 12 — register);
    // every opponent takes the -1 Card token (their next cleanup redraws 4).
    kit.cardDef(IDS.Raid, 'Raid', 5, 0, 0,
      'Event. Gain a Silver per Silver you have in play. Each other player puts their -1 Card token on their deck.', [
        kit.onPlay('dom_ab_adv_raid', 'Raid', [
          setVar(SCRATCH, countCards(zone(INPLAY, CURRENT), kit.nameIs('Silver')), CURRENT),
          ...Array.from({ length: 12 }, (_, i) => iff(allOf(
            gte(getVar(SCRATCH, CURRENT), num(i + 1)), supplyHas('Silver'),
          ), [
            announce(CURRENT, ' raids a Silver.'),
            gainTop('Silver'),
          ])),
          forEachOpponent([
            setVar(MINUS_CARD, num(1), kit.PLAYER),
          ]),
          announce('Each other player puts their -1 Card token on their deck.'),
        ]),
      ]),

    // TRADE ($5) — trash up to 2 hand cards, a Silver per trashed card.
    kit.cardDef(IDS.Trade, 'Trade', 5, 0, 0,
      'Event. Trash up to 2 cards from your hand. Gain a Silver per card you trashed.', [
        kit.onPlay('dom_ab_adv_trade', 'Trade', [
          setVar(SCRATCH, num(0), CURRENT),
          iff(gt(zoneCount(zone(HAND, CURRENT)), num(0)), [
            chooseCardsBlock({
              who: CURRENT, from: zone(HAND, CURRENT), min: num(0), max: num(2),
              prompt: 'Trade: trash up to 2 cards from your hand (a Silver per card)',
              body: [
                announce(CURRENT, ' trades away ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(TRASH), 'trash', { faceUp: true }),
                changeVar(SCRATCH, num(1), CURRENT),
              ],
            }),
            ...Array.from({ length: 2 }, (_, i) => iff(allOf(
              gte(getVar(SCRATCH, CURRENT), num(i + 1)), supplyHas('Silver'),
            ), [
              announce(CURRENT, ' gains a Silver in trade.'),
              gainTop('Silver'),
            ])),
          ], [announce(CURRENT, ' has no cards to trade.')]),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { DECK, DISCARD, INPLAY } = kit.zones;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** TRAVELLING FAIR's topdeck offer — only while the Event is on the table,
   *  the gainer's per-turn flag is up and the card still sits in their
   *  discard (a Watchtower/Trader answer that moved it withdraws the offer). */
  const fairWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_adv_fair_${tag}`,
    name: `Travelling Fair: a card is ${tag === 'buy' ? 'bought' : 'gained'} — topdeck it?`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        onTable(kit, 'Travelling Fair'),
        gt(getVar(TFAIR_ACTIVE, GAINER), num(0)),
        eq(cardZoneId(kit.CARD), str(DISCARD)),
      ), [
        chooseOption('Travelling Fair: put the gained card onto your deck?', [
          { id: 'tfair_keep', label: 'Leave it in the discard pile' },
          { id: 'tfair_deck', label: 'Put it onto your deck' },
        ], GAINER),
        iff(eq(kit.CHOICE, str('tfair_deck')), [
          announce(GAINER, ' puts the gained ', kit.CARD, ' onto their deck.'),
          move(specific(kit.CARD), zone(DISCARD, GAINER), zone(DECK, GAINER),
            { toPosition: 'top', faceUp: false }),
        ]),
      ]),
    ],
  });

  /** BALL's -$1 token: the holder's next Treasure play yields $1 less. */
  const minusCoinWatch = (): TriggerDef => ({
    id: 'dom_trigger_adv_minus_coin',
    name: 'The -$1 token: a Treasure is played',
    event: { kind: 'cardEnterZone', zoneId: INPLAY, tag: 'play' },
    condition: null,
    script: [
      iff(allOf(
        onTable(kit, 'Ball'),
        gt(getVar(MINUS_COIN, GAINER), num(0)),
        kit.IS_TREASURE_CARD,
      ), [
        changeVar(kit.vars.COINS, num(-1), GAINER),
        setVar(MINUS_COIN, num(0), GAINER),
        announce(GAINER, ' spends the -$1 token (one coin less).'),
      ]),
    ],
  });

  return [fairWatch('gain'), fairWatch('buy'), minusCoinWatch()];
}

export const adventuresEvents: ExpansionModule = {
  id: 'adventuresEvents',
  setName: 'Adventures',

  piles: [],

  ids: IDS,

  landscapes: [
    { name: 'Alms', cost: 0, kind: 'event' },
    { name: 'Borrow', cost: 0, kind: 'event' },
    { name: 'Quest', cost: 0, kind: 'event' },
    { name: 'Save', cost: 1, kind: 'event' },
    { name: 'Scouting Party', cost: 2, kind: 'event' },
    { name: 'Travelling Fair', cost: 2, kind: 'event' },
    { name: 'Bonfire', cost: 3, kind: 'event' },
    { name: 'Expedition', cost: 3, kind: 'event' },
    { name: 'Pilgrimage', cost: 4, kind: 'event' },
    { name: 'Ball', cost: 5, kind: 'event' },
    { name: 'Raid', cost: 5, kind: 'event' },
    { name: 'Trade', cost: 5, kind: 'event' },
  ],

  variables: [
    {
      id: ALMS_USED, name: 'Alms: used this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: BORROW_USED, name: 'Borrow: used this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: SAVE_USED, name: 'Save: used this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: PILGRIMAGE_USED, name: 'Pilgrimage: used this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: TFAIR_ACTIVE, name: 'Travelling Fair: topdeck window this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: MINUS_CARD, name: 'The -1 Card token (next cleanup redraws 4)',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: MINUS_COIN, name: 'The -$1 token (next Treasure yields $1 less)',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: EXPEDITION_BONUS, name: 'Expedition: extra cards at cleanup',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: JOURNEY, name: 'Journey token (1 = face up)',
      scope: 'perPlayer', type: 'number', initial: 1, hidden: true,
    },
    {
      id: PILGRIMAGE_NAME, name: 'Pilgrimage: the pile being copied',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
  ] as VariableDef[],

  zones: [
    {
      id: SAVE_ZONE, name: 'Save',
      owner: 'perPlayer', visibility: 'owner', layout: 'row', area: 'player',
    },
  ] as ZoneDef[],

  buildCards,
  buildTriggers,

  buildCleanupResets(kit): Block[] {
    const { DECK, HAND } = kit.zones;
    // These run AFTER the core cleanup redraw of 5 and BEFORE the phase
    // ends, in this order: Expedition's bonus draw, the -1 Card return (the
    // hand's top card = the LAST card drawn goes back — order-exact "drew
    // one fewer"), then Save's set-aside comes home (after drawing, and
    // never the card the token puts back). Per-turn latches reset last.
    return [
      iff(gt(getVar(EXPEDITION_BONUS, CURRENT), num(0)), [
        announce(CURRENT, ' draws extra cards for the Expedition.'),
        kit.drawN(null, getVar(EXPEDITION_BONUS, CURRENT)),
        setVar(EXPEDITION_BONUS, num(0), CURRENT),
      ]),
      iff(gt(getVar(MINUS_CARD, CURRENT), num(0)), [
        iff(gt(zoneCount(zone(HAND, CURRENT)), num(0)), [
          announce(CURRENT, ' returns a card to their deck (the -1 Card token).'),
          move(topN(1), zone(HAND, CURRENT), zone(DECK, CURRENT),
            { toPosition: 'top', faceUp: false }),
        ]),
        setVar(MINUS_CARD, num(0), CURRENT),
      ]),
      iff(gt(zoneCount(zone(SAVE_ZONE, CURRENT)), num(0)), [
        announce(CURRENT, ' takes the card set aside with Save into their hand.'),
        move(ALL, zone(SAVE_ZONE, CURRENT), zone(HAND, CURRENT), { faceUp: true }),
      ]),
      forEachPlayer([
        setVar(ALMS_USED, num(0), kit.PLAYER),
        setVar(BORROW_USED, num(0), kit.PLAYER),
        setVar(SAVE_USED, num(0), kit.PLAYER),
        setVar(PILGRIMAGE_USED, num(0), kit.PLAYER),
        setVar(TFAIR_ACTIVE, num(0), kit.PLAYER),
      ]),
    ];
  },
};
