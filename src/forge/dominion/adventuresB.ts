/**
 * Adventures (part B) — the set's 19 kingdom piles: Raze, Amulet, Caravan
 * Guard, Dungeon, Gear, Magpie, Messenger, Port, Ranger, Artificer, Bridge
 * Troll, Giant, Haunted Woods, Lost City, Relic, Storyteller, Swamp Hag,
 * Treasure Trove, Hireling. (The set's Travellers and Reserve cards wait on
 * the tavern-mat/call system; the token Events ride adventuresEvents.)
 *
 * House idioms follow the earlier modules: Durations ride kit.durationPair
 * (now runs on the 'play'-tagged In-Play entry, the card parks in the
 * DURATION zone, later fires at the owner's next action-phase start and the
 * card marches back tagged 'duration_return'), attack halves are separate
 * `stacked: true` abilities gated per victim on IMMUNE == 0 (the shared
 * effectResolved trigger resets it), on-gain/on-buy riders are tagged
 * cardEnterZone watchers, dug-through cards stage in the hidden shared LOOK
 * zone, and every mandatory choice is guarded so a session can never hang.
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "each other player" is
 * the one opponent, and a victim's attacker is nextPlayer(victim) (the
 * Haunted Woods / Swamp Hag watchers read the parked card there).
 *
 * SHARED ADVENTURES TOKENS (owned by adventuresEvents, reused by id here):
 *  - JOURNEY (Ranger / Giant, and that module's Pilgrimage): ONE per-player
 *    token, starts face up — every user flips the same token, as printed.
 *  - MINUS_CARD (Relic, and Borrow / Raid): the -1 Card token. That module's
 *    documented approximation applies: it shrinks the holder's next CLEANUP
 *    redraw only (the last card drawn returns to the deck) — a mid-turn
 *    Smithy is never affected.
 *  - MINUS_COIN (Bridge Troll, and Ball): the -$1 token — one physical token
 *    per player, as printed, so the var is shared. adventuresEvents' spender
 *    is gated on the Ball EVENT being on the table, so THIS module ships its
 *    own always-on spender with identical behavior (next TREASURE play pays
 *    $1 less; +$ from Actions never spends it). With both watchers live,
 *    whichever runs first consumes the token and the other reads it spent.
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - STORYTELLER ships the printed 2015 text (+1 Action, +$1, play up to 3
 *    Treasures, then pay ALL your $ for +1 Card each — the 2022 errata is
 *    not applied). The chosen Treasures are played by script: their coin
 *    FIELD is paid explicitly and the 'play'-tagged move fires their on-play
 *    abilities (a Duration treasure parks; the -$1 token can bite).
 *  - MESSENGER: "first buy in a turn" rides a per-player bought-this-turn
 *    counter (a 'buy'-tag watcher registered BEFORE Messenger's own, reset
 *    at cleanup). Event purchases move no card, so they never bump the
 *    counter — a bought Event does not spoil "first buy" here (on paper it
 *    would).
 *  - BRIDGE TROLL: "while this is in play, cards cost $1 less on your turns"
 *    = each half grants +1 global DISCOUNT for its own turn (Bridge's
 *    precedent; cleanup resets it, so the interim opponent turn is
 *    untouched — exactly "on your turns"). Throne Room: the now-half runs
 *    twice (+2 Buys and a -$2 discount this turn — printed keeps -$1); the
 *    card parks once, so next turn is +1 Buy once (printed: twice).
 *  - HAUNTED WOODS / SWAMP HAG: the until-your-next-turn attack is a
 *    stacked play half that MARKS each non-immune opponent (a Moat or
 *    Lighthouse waves off the whole duration — printed timing); the
 *    'buy'-tag watcher punishes marked buyers only while the card sits
 *    parked in the attacker's DURATION zone; the later half lifts the
 *    marks. The punishment lands AFTER the bought card reaches the discard
 *    (on paper the Curse arrives first — same cards, adjacent timing).
 *  - GIANT: the response window opens on EVERY play (the attack half is
 *    stacked) — even a face-down flip that attacks nobody, so a Moat
 *    revealed then is wasted. The $3–$6 trash range is current-cost
 *    (Bridge-aware, Cardinal's precedent).
 *  - HIRELING parks in the DURATION zone FOREVER: its later half draws at
 *    the start of every owner turn and never marches back, so cleanup never
 *    touches it (it still scores its printed 0 VP from the zone walk).
 *    Throne Room deviation: the replay repeats the (empty) now-half but the
 *    card parks only once, so a Throne-Roomed Hireling still yields ONE
 *    card per turn (printed: two).
 *  - GEAR: the set-asides wait on the per-player Gear mat (Church's mat
 *    precedent); with SEVERAL Gears parked, the FIRST later half to resolve
 *    returns the WHOLE mat. Mat cards score their printed VP at every
 *    recount, so a game ending mid-duration loses nothing.
 *  - CARAVAN GUARD: the reaction is a response-speed action (Guard Dog's
 *    precedent) that plays it from the hand mid-attack; the printed
 *    "(+1 Action has no effect if it's not your turn)" is exact — the +1
 *    Action only lands when the play happens on the owner's turn. "Another
 *    player plays an Attack" is modeled as "the attacker is the CURRENT
 *    player" (the house response shape), so an off-turn Black Cat attack
 *    does not open the window for the current player.
 *  - RAZE: "look at one card per $1 it costs" reads the trashed card's
 *    PRINTED cost, unrolled to a cap of 11 (Colony's cost — no repeat
 *    blocks). A Throne-Roomed Raze that already trashed itself whiffs the
 *    second self-trash (the advisory `from`) yet still looks at 2.
 *  - MAGPIE: "Action or Victory card" = Action-typed, Victory-typed, or
 *    printed VP > 0; the Treasure check wins first, so a Harem-style
 *    Treasure–Victory goes to the hand WITHOUT gaining a Magpie (printed
 *    duals would do both). A non-Treasure reveal returns to the deck top.
 *  - ARTIFICER: the exact-cost gain compares PRINTED costs (Governor's
 *    exact-match precedent — a live Bridge discount is ignored).
 *  - PORT ships a 10-card pile like every pile here (printed: 12).
 */
import type {
  ActionDef, AbilityDef, Block, CardDef, Expr, TriggerDef, VariableDef, ZoneDef,
} from '../../shared/types';
import {
  ALL, CURRENT, STACK_SIZE, STACK_TOP, add, allOf, announce, anyOf, bestCard, bnd, changeVar,
  chooseCard, chooseCardsBlock, chooseOption, countCards, eq, field, forEachCard, forEachOpponent,
  forEachPlayer, getVar, gt, gte, iff, lt, lte, move, neq, nextPlayer, num, setVar, shuffle,
  specific, str, sub, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';
import { JOURNEY, MINUS_CARD, MINUS_COIN } from './adventuresEvents';
import { HAVEN_MARK } from './seaside2eA';

const IDS: Record<string, string> = {
  Raze: 'dom_card_raze',
  Amulet: 'dom_card_amulet',
  'Caravan Guard': 'dom_card_caravan_guard',
  Dungeon: 'dom_card_dungeon',
  Gear: 'dom_card_gear',
  Magpie: 'dom_card_magpie',
  Messenger: 'dom_card_messenger',
  Port: 'dom_card_port',
  Ranger: 'dom_card_ranger',
  Artificer: 'dom_card_artificer',
  'Bridge Troll': 'dom_card_bridge_troll',
  Giant: 'dom_card_giant',
  'Haunted Woods': 'dom_card_haunted_woods',
  'Lost City': 'dom_card_lost_city',
  Relic: 'dom_card_relic',
  Storyteller: 'dom_card_storyteller',
  'Swamp Hag': 'dom_card_swamp_hag',
  'Treasure Trove': 'dom_card_treasure_trove',
  Hireling: 'dom_card_hireling',
};

/** Gear's per-player set-aside mat (back to the hand at the next turn start). */
export const GEAR_ZONE = 'dom_zone_advb_gear';

// --- per-player state (hidden bookkeeping) ------------------------------------

/** Haunted Woods' mark: this player buys under the haunting. */
export const HAUNTED_VAR = 'dom_var_advb_haunted';
/** Swamp Hag's mark: this player's buys grow Curses. */
export const HEXED_VAR = 'dom_var_advb_hexed';
/** Buys made this turn (Messenger's first-buy gate) — reset at cleanup. */
export const BUYS_MADE_VAR = 'dom_var_advb_buys_made';
/** Name stash for Messenger's copy-gain (read across $card rebinds). */
export const ADVB_NAME_VAR = 'dom_var_advb_name';

/** The action phase's id (stable dominionGame.ts literal — Seaside's idiom). */
const PHASE_ACTION = 'dom_phase_action';

/** A yes/no question to `who`; the answer lands in $choice as a boolean. */
const yesNo = (who: Expr, prompt: string): Block =>
  ({ kind: 'choose', who, choice: { kind: 'yesNo', prompt } });

/** Empty deck → flip the discard in face-down and shuffle (paper reshuffle). */
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
 * is empty). Unrolled per card — official per-card reshuffle timing, no
 * repeat block (Sentry's idiom).
 */
function takeTop(kit: CardKit, who: Expr, to: ReturnType<typeof zone>, faceUp: boolean): Block[] {
  const deck = zone(kit.zones.DECK, who);
  return [
    refillDeck(kit, who),
    iff(gt(zoneCount(deck), num(0)), [
      move(topN(1), deck, to, { faceUp }),
    ]),
  ];
}

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK, DURATION } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, SCRATCH, DISCOUNT } = kit.vars;
  const { COST, COINS_F, VP_F } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER, SELF } = kit;
  const { nameIs } = kit;

  /** Gain the named basic from the supply into `to` (guarded on the pile). */
  const gainNamed = (name: string, to: ReturnType<typeof zone>, who: Expr, note: string, empty: string): Block =>
    iff(gt(countCards(zone(SUPPLY), nameIs(name)), num(0)), [
      announce(who, note),
      kit.tmove(
        specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs(name))),
        zone(SUPPLY), to, 'gain', { faceUp: true },
      ),
    ], [announce(empty)]);

  // --- AMULET's choose-one, shared by both halves (fresh nodes per call).
  // CHOICE-safe: else-chained, so the inner trash pick can never clobber a
  // later comparison (Quest's idiom).
  const amuletPick = (): Block[] => [
    chooseOption('Amulet: choose one', [
      { id: 'am_coin', label: '+$1' },
      { id: 'am_trash', label: 'Trash a card from your hand' },
      { id: 'am_silver', label: 'Gain a Silver' },
    ], OWNER),
    iff(eq(CHOICE, str('am_coin')), [
      announce(OWNER, ' takes +$1 from the Amulet.'),
      changeVar(COINS, num(1), OWNER),
    ], [
      iff(eq(CHOICE, str('am_trash')), [
        iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
          chooseCard({
            who: OWNER, from: zone(HAND, OWNER),
            prompt: 'Amulet: trash a card from your hand',
          }),
          announce(OWNER, ' trashes ', CHOICE, '.'),
          kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
        ], [announce(OWNER, ' has nothing to trash.')]),
      ], [
        gainNamed('Silver', zone(DISCARD, OWNER), OWNER, ' gains a Silver from the Amulet.',
          'The Silver pile is empty — nothing gained.'),
      ]),
    ]),
  ];

  // --- DUNGEON's half: +2 Cards, then discard exactly 2 (clamped to the
  // hand via SCRATCH — Warehouse's idiom). Fresh nodes per call.
  const dungeonHalf = (): Block[] => [
    kit.draw(OWNER, 2),
    setVar(SCRATCH, num(2), OWNER),
    iff(lt(zoneCount(zone(HAND, OWNER)), num(2)), [
      setVar(SCRATCH, zoneCount(zone(HAND, OWNER)), OWNER),
    ]),
    iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
      chooseCardsBlock({
        who: OWNER, from: zone(HAND, OWNER),
        min: getVar(SCRATCH, OWNER), max: num(2),
        prompt: 'Dungeon: discard 2 cards',
        body: [
          announce(OWNER, ' discards ', CARD, '.'),
          kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
        ],
      }),
    ]),
  ];

  // --- BRIDGE TROLL's now/next-turn half (see the register): +1 Buy, and
  // this turn's global discount (Bridge's precedent, reset at cleanup).
  const trollHalf = (): Block[] => [
    changeVar(BUYS, num(1), OWNER),
    changeVar(DISCOUNT, num(1)),
    announce('Bridge Troll: +1 Buy, and cards cost $1 less this turn.'),
  ];

  // --- RAZE's dig: look at PRINTED-cost cards off the deck top (unrolled to
  // 11 — Colony), keep one, discard the rest. Fresh nodes per call.
  const razeLook = (): Block[] => [
    ...Array.from({ length: 11 }, (_, i) => iff(gte(getVar(SCRATCH, OWNER), num(i + 1)), [
      ...takeTop(kit, OWNER, zone(LOOK), false),
    ])),
    iff(gt(zoneCount(zone(LOOK)), num(0)), [
      chooseCard({
        who: OWNER, from: zone(LOOK), revealed: true,
        prompt: 'Raze: put one of the looked-at cards into your hand',
      }),
      announce(OWNER, ' keeps one of the looked-at cards.'),
      move(specific(CHOICE), zone(LOOK), zone(HAND, OWNER), { faceUp: true }),
      iff(gt(zoneCount(zone(LOOK)), num(0)), [
        kit.tmove(ALL, zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
      ]),
    ], [announce('The razing paid for no look at the deck.')]),
  ];
  const razeSelf = (): Block[] => [
    setVar(SCRATCH, field(SELF, COST), OWNER),
    announce(OWNER, ' razes the Raze itself.'),
    kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true }),
    ...razeLook(),
  ];

  /** "Is a Victory card" in the one-primary-type world (Groom's dual test). */
  const victoryCard = (card: Expr): Expr => anyOf(
    kit.isA(card, kit.types.VICTORY),
    gt(field(card, VP_F), num(0)),
  );

  /** GIANT's trash window: current cost $3–$6 (Bridge-aware — Cardinal). */
  const giantRange = (): Expr => allOf(
    gte(field(CARD, COST), add(num(3), getVar(DISCOUNT))),
    lte(field(CARD, COST), add(num(6), getVar(DISCOUNT))),
  );

  // --- HIRELING's permanent pair (see the register): the now half only
  // parks; the later half fires at the start of EVERY owner turn — no march
  // back, no discard, for the rest of the game. The Haven-mark gate keeps a
  // Haven-set-aside Hireling inert (it was never played).
  const hirelingAbilities: AbilityDef[] = [
    {
      id: 'dom_ab_hireling_now', name: 'Hireling — signed on for good',
      on: 'enterZone', zoneId: INPLAY, phaseId: null, tagFilter: 'play', condition: null,
      script: [
        announce(OWNER, "'s Hireling signs on for the rest of the game."),
        kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(DURATION, OWNER), 'play', { faceUp: true }),
      ],
    },
    {
      id: 'dom_ab_hireling_every_turn', name: 'Hireling — every turn',
      on: 'phaseStart', zoneId: DURATION, phaseId: PHASE_ACTION,
      condition: allOf(eq(CURRENT, OWNER), eq(getVar(HAVEN_MARK, SELF), num(0))),
      script: [
        announce(OWNER, "'s Hireling reports for duty: +1 Card."),
        kit.draw(OWNER, 1),
      ],
    },
  ];

  return [
    // RAZE — +1 Action; trash this or a hand card; look at printed-cost
    // cards; keep one, discard the rest (register: cost cap 11, self-whiff
    // on a Throne replay).
    kit.cardDef(IDS.Raze, 'Raze', 2, 0, 0,
      '+1 Action. Trash this or a card from your hand. Look at one card from the top of your deck per $1 it costs. Put one of them into your hand and discard the rest.', [
        kit.onPlay('dom_ab_raze', 'Burn it down', [
          changeVar(ACTIONS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseOption('Raze: trash which?', [
              { id: 'raze_self', label: 'Trash Raze itself' },
              { id: 'raze_hand', label: 'Trash a card from your hand' },
            ], OWNER),
            iff(eq(CHOICE, str('raze_self')), razeSelf(), [
              chooseCard({
                who: OWNER, from: zone(HAND, OWNER),
                prompt: 'Raze: trash a card from your hand',
              }),
              setVar(SCRATCH, field(CHOICE, COST), OWNER),
              announce(OWNER, ' razes ', CHOICE, '.'),
              kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              ...razeLook(),
            ]),
          ], razeSelf()),
        ]),
      ]),

    // AMULET — Duration: the same choose-one now and next turn.
    kit.cardDef(IDS.Amulet, 'Amulet', 3, 0, 0,
      'Now and at the start of your next turn, choose one: +$1; or trash a card from your hand; or gain a Silver.',
      kit.durationPair('dom_ab_amulet', 'Amulet', amuletPick(), amuletPick())),

    // CARAVAN GUARD — Duration – Reaction: +1 Card now (+1 Action only on
    // your own turn — the printed parenthetical, exact); +$1 next turn. The
    // mid-attack play is the module's response action (register).
    kit.cardDef(IDS['Caravan Guard'], 'Caravan Guard', 3, 0, 0,
      "+1 Card. +1 Action. At the start of your next turn, +$1. When another player plays an Attack card, you may play this from your hand. (+1 Action has no effect if it's not your turn.)",
      kit.durationPair('dom_ab_caravan_guard', 'Caravan Guard', [
        kit.draw(OWNER, 1),
        iff(eq(CURRENT, OWNER), [
          changeVar(ACTIONS, num(1), OWNER),
        ], [announce('Played off-turn: the +1 Action has no effect (as printed).')]),
      ], [
        changeVar(COINS, num(1), OWNER),
      ])),

    // DUNGEON — Duration: +1 Action; +2 Cards then discard 2, both turns.
    kit.cardDef(IDS.Dungeon, 'Dungeon', 3, 0, 0,
      '+1 Action. Now and at the start of your next turn: +2 Cards, then discard 2 cards.',
      kit.durationPair('dom_ab_dungeon', 'Dungeon', [
        changeVar(ACTIONS, num(1), OWNER),
        ...dungeonHalf(),
      ], dungeonHalf())),

    // GEAR — Duration: +2 Cards; set aside up to 2 on the Gear mat, back at
    // the next turn start (register: the first later half scoops the mat).
    kit.cardDef(IDS.Gear, 'Gear', 3, 0, 0,
      '+2 Cards. Set aside up to 2 cards from your hand face down. At the start of your next turn, put them into your hand.',
      kit.durationPair('dom_ab_gear', 'Gear', [
        kit.draw(OWNER, 2),
        iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
          chooseCardsBlock({
            who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(2),
            prompt: 'Gear: set aside up to 2 cards (face down, back next turn)',
            body: [
              announce(OWNER, ' sets a card aside with Gear.'),
              move(specific(CARD), zone(HAND, OWNER), zone(GEAR_ZONE, OWNER), { faceUp: false }),
            ],
          }),
        ]),
      ], [
        iff(gt(zoneCount(zone(GEAR_ZONE, OWNER)), num(0)), [
          announce(OWNER, ' takes the cards set aside with Gear into their hand.'),
          move(ALL, zone(GEAR_ZONE, OWNER), zone(HAND, OWNER), { faceUp: true }),
        ], [announce('Gear had nothing set aside.')]),
      ])),

    // MAGPIE — the reveal stages through LOOK: a Treasure joins the hand, an
    // Action/Victory reveal gains a Magpie and returns to the deck top
    // (register: the Treasure check wins on duals).
    kit.cardDef(IDS.Magpie, 'Magpie', 4, 0, 0,
      "+1 Card. +1 Action. Reveal the top card of your deck. If it's a Treasure, put it into your hand. If it's an Action or Victory card, gain a Magpie.", [
        kit.onPlay('dom_ab_magpie', 'Shiny things', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            forEachCard(zone(LOOK), null, [announce(OWNER, ' reveals ', CARD, '.')]),
            iff(gt(countCards(zone(LOOK), kit.IS_TREASURE_CARD), num(0)), [
              announce(OWNER, ' pockets the revealed Treasure.'),
              move(ALL, zone(LOOK), zone(HAND, OWNER), { faceUp: true }),
            ], [
              iff(gt(countCards(zone(LOOK), anyOf(kit.IS_ACTION_CARD, victoryCard(CARD))), num(0)), [
                iff(gt(countCards(zone(SUPPLY), nameIs('Magpie')), num(0)), [
                  announce(OWNER, ' gains another Magpie.'),
                  kit.tmove(
                    specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Magpie'))),
                    zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
                  ),
                ], [announce('The Magpie pile is empty — nothing gained.')]),
              ]),
              move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
            ]),
          ], [announce(OWNER, ' has no card left to reveal.')]),
        ]),
      ]),

    // MESSENGER — +1 Buy +$2, may dump the deck ('discard'-tagged, so
    // discard reactions fire — printed timing); the first-buy rider is a
    // watcher (register).
    kit.cardDef(IDS.Messenger, 'Messenger', 4, 0, 0,
      '+1 Buy. +$2. You may put your deck into your discard pile. When this is your first buy in a turn, gain a card costing up to $4, and each other player gains a copy of it.', [
        kit.onPlay('dom_ab_messenger', 'Word travels fast', [
          changeVar(BUYS, num(1), OWNER),
          changeVar(COINS, num(2), OWNER),
          iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
            yesNo(OWNER, 'Messenger: put your deck into your discard pile?'),
            iff(CHOICE, [
              announce(OWNER, ' puts their deck into their discard pile.'),
              kit.tmove(ALL, zone(DECK, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
            ]),
          ]),
        ]),
      ]),

    // PORT — the buy rider is a watcher (a second Port, 'gain'-tagged, so it
    // never re-triggers — printed).
    kit.cardDef(IDS.Port, 'Port', 4, 0, 0,
      '+1 Card. +2 Actions. When you buy this, gain another Port.', [
        kit.onPlay('dom_ab_port', 'Safe harbor', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
        ]),
      ]),

    // RANGER — flips the shared Journey token; face up pays +5 Cards.
    kit.cardDef(IDS.Ranger, 'Ranger', 4, 0, 0,
      "+1 Buy. Turn your Journey token over (it starts face up); then if it's face up, +5 Cards.", [
        kit.onPlay('dom_ab_ranger', 'Into the wild', [
          changeVar(BUYS, num(1), OWNER),
          setVar(JOURNEY, sub(num(1), getVar(JOURNEY, OWNER)), OWNER),
          iff(eq(getVar(JOURNEY, OWNER), num(1)), [
            announce(OWNER, "'s Journey token turns face up — +5 Cards."),
            kit.draw(OWNER, 5),
          ], [announce(OWNER, "'s Journey token turns face down.")]),
        ]),
      ]),

    // ARTIFICER — discard any number, then MAY gain an exact-printed-cost
    // card onto the deck (register).
    kit.cardDef(IDS.Artificer, 'Artificer', 5, 0, 0,
      '+1 Card. +1 Action. +$1. Discard any number of cards. You may gain a card costing exactly $1 per card discarded, putting it onto your deck.', [
        kit.onPlay('dom_ab_artificer', 'Made to order', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(COINS, num(1), OWNER),
          setVar(SCRATCH, num(0), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(99),
              prompt: 'Artificer: discard any number of cards ($1 of crafting each)',
              body: [
                announce(OWNER, ' discards ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                changeVar(SCRATCH, num(1), OWNER),
              ],
            }),
          ]),
          iff(gt(countCards(zone(SUPPLY), eq(field(CARD, COST), getVar(SCRATCH, OWNER))), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY),
              filter: eq(field(CARD, COST), getVar(SCRATCH, OWNER)), optional: true,
              prompt: 'Artificer: you may gain a card costing exactly $1 per discard, onto your deck',
              body: [
                announce(OWNER, ' gains ', CARD, ' onto their deck.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(DECK, OWNER), 'gain',
                  { toPosition: 'top', faceUp: false }),
              ],
            }),
          ], [announce('Nothing in the supply costs exactly that much.')]),
        ]),
      ]),

    // BRIDGE TROLL — Duration – Attack: the token attack is the stacked
    // half; +1 Buy and the turn discount ride both duration halves
    // (register: token + discount approximations).
    kit.cardDef(IDS['Bridge Troll'], 'Bridge Troll', 5, 0, 0,
      'Each other player takes their -$1 token. Now and at the start of your next turn: +1 Buy. While this is in play, cards cost $1 less on your turns, but not less than $0.', [
        kit.onPlay('dom_ab_bridge_troll_attack', 'The toll is taken', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(eq(getVar(MINUS_COIN, PLAYER), num(0)), [
                setVar(MINUS_COIN, num(1), PLAYER),
                announce(PLAYER, ' takes the -$1 token.'),
              ], [announce(PLAYER, ' already holds the -$1 token.')]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
        ...kit.durationPair('dom_ab_bridge_troll', 'Bridge Troll', trollHalf(), trollHalf()),
      ]),

    // GIANT — Attack: flip the Journey token; down pays +$1, up pays +$5 and
    // stomps (register: the window opens on every play; Bridge-aware range).
    kit.cardDef(IDS.Giant, 'Giant', 5, 0, 0,
      "Turn your Journey token over (it starts face up). If it's face down, +$1. If it's face up, +$5, and each other player reveals the top card of their deck, trashes it if it costs from $3 to $6, and otherwise discards it and gains a Curse.", [
        kit.onPlay('dom_ab_giant_attack', 'Fee, fie, foe', [
          setVar(JOURNEY, sub(num(1), getVar(JOURNEY, OWNER)), OWNER),
          iff(eq(getVar(JOURNEY, OWNER), num(0)), [
            announce(OWNER, "'s Journey token turns face down — +$1."),
            changeVar(COINS, num(1), OWNER),
          ], [
            announce(OWNER, "'s Journey token turns face up — +$5, and the Giant stomps."),
            changeVar(COINS, num(5), OWNER),
            forEachOpponent([
              iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
                ...takeTop(kit, PLAYER, zone(LOOK), true),
                iff(gt(zoneCount(zone(LOOK)), num(0)), [
                  forEachCard(zone(LOOK), null, [announce(PLAYER, ' reveals ', CARD, '.')]),
                  iff(gt(countCards(zone(LOOK), giantRange()), num(0)), [
                    announce('The Giant crushes it — trashed.'),
                    kit.tmove(ALL, zone(LOOK), zone(TRASH), 'trash', { faceUp: true }),
                  ], [
                    kit.tmove(ALL, zone(LOOK), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
                    iff(gt(countCards(zone(SUPPLY), nameIs('Curse')), num(0)), [
                      announce(PLAYER, ' gains a Curse.'),
                      kit.tmove(
                        specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Curse'))),
                        zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
                      ),
                    ], [announce('The Curse pile is empty — no Curse.')]),
                  ]),
                ], [announce(PLAYER, ' has nothing to reveal.')]),
              ]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // HAUNTED WOODS — Duration – Attack: the stacked half marks each
    // non-immune opponent; the 'buy' watcher topdecks marked buyers' hands
    // while this sits parked; the later half draws 3 and lifts the marks.
    kit.cardDef(IDS['Haunted Woods'], 'Haunted Woods', 5, 0, 0,
      'Until your next turn, when any other player buys a card, they put their hand onto their deck in any order. At the start of your next turn: +3 Cards.', [
        kit.onPlay('dom_ab_haunted_woods_attack', 'A dread settles', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              setVar(HAUNTED_VAR, num(1), PLAYER),
              announce(PLAYER, ' is haunted until the woods clear.'),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
        ...kit.durationPair('dom_ab_haunted_woods', 'Haunted Woods', [], [
          kit.draw(OWNER, 3),
          forEachOpponent([setVar(HAUNTED_VAR, num(0), PLAYER)]),
          announce('The Haunted Woods clear.'),
        ]),
      ]),

    // LOST CITY — the on-gain draw for the others is a watcher pair.
    kit.cardDef(IDS['Lost City'], 'Lost City', 5, 0, 0,
      '+2 Cards. +2 Actions. When you gain this, each other player draws a card.', [
        kit.onPlay('dom_ab_lost_city', 'Streets of gold', [
          kit.draw(OWNER, 2),
          changeVar(ACTIONS, num(2), OWNER),
        ]),
      ]),

    // RELIC — Treasure – Attack: the $2 rides the coin FIELD (the treasure
    // action pays it); the stacked half hands out -1 Card tokens (register:
    // the shared next-cleanup approximation).
    kit.cardDef(IDS.Relic, 'Relic', 5, 2, 0,
      '$2. When you play this, each other player puts their -1 Card token on their deck.', [
        kit.onPlay('dom_ab_relic_attack', 'An unwholesome charm', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              setVar(MINUS_CARD, num(1), PLAYER),
              announce(PLAYER, ' puts the -1 Card token on their deck.'),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // STORYTELLER — printed 2015 text (register): plays up to 3 Treasures by
    // script (their coin fields paid, their on-play abilities fire), then
    // converts EVERY coin to cards.
    kit.cardDef(IDS.Storyteller, 'Storyteller', 5, 0, 0,
      '+1 Action. +$1. Play up to 3 Treasures from your hand. Then pay all of your $; +1 Card per $1 you paid.', [
        kit.onPlay('dom_ab_storyteller', 'Tales by the fire', [
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(COINS, num(1), OWNER),
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_TREASURE_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_TREASURE_CARD,
              min: num(0), max: num(3),
              prompt: 'Storyteller: play up to 3 Treasures from your hand',
              body: [
                announce(OWNER, ' plays ', CARD, '.'),
                changeVar(COINS, field(CARD, COINS_F), OWNER),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
              ],
            }),
          ]),
          announce(OWNER, ' pays every coin for pages of the tale.'),
          kit.drawN(OWNER, getVar(COINS, OWNER)),
          setVar(COINS, num(0), OWNER),
        ]),
      ]),

    // SWAMP HAG — Duration – Attack: the stacked half hexes each non-immune
    // opponent; the 'buy' watcher grows Curses while this sits parked; the
    // later half pays +$3 and lifts the hex.
    kit.cardDef(IDS['Swamp Hag'], 'Swamp Hag', 5, 0, 0,
      'Until your next turn, when any other player buys a card, they gain a Curse. At the start of your next turn: +$3.', [
        kit.onPlay('dom_ab_swamp_hag_attack', 'The bog remembers', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              setVar(HEXED_VAR, num(1), PLAYER),
              announce(PLAYER, ' is hexed until the hag departs.'),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
        ...kit.durationPair('dom_ab_swamp_hag', 'Swamp Hag', [], [
          changeVar(COINS, num(3), OWNER),
          forEachOpponent([setVar(HEXED_VAR, num(0), PLAYER)]),
          announce('The Swamp Hag departs.'),
        ]),
      ]),

    // TREASURE TROVE — Treasure: $2 on the coin field; the play rider gains
    // a Gold and a Copper (guarded, whiffing politely per pile).
    kit.cardDef(IDS['Treasure Trove'], 'Treasure Trove', 5, 2, 0,
      '$2. When you play this, gain a Gold and a Copper.', [
        kit.onPlay('dom_ab_treasure_trove', 'Glittering hoard', [
          gainNamed('Gold', zone(DISCARD, OWNER), OWNER, ' gains a Gold from the trove.',
            'The Gold pile is empty — no Gold from the trove.'),
          gainNamed('Copper', zone(DISCARD, OWNER), OWNER, ' gains a Copper from the trove.',
            'The Copper pile is empty — no Copper from the trove.'),
        ]),
      ]),

    // HIRELING — the permanent Duration (register): parks forever, +1 Card
    // at the start of every owner turn.
    kit.cardDef(IDS.Hireling, 'Hireling', 6, 0, 0,
      'At the start of each of your turns for the rest of the game: +1 Card. (This stays in play.)',
      hirelingAbilities),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, DECK, HAND, DISCARD, INPLAY, DURATION } = kit.zones;
  const { COINS } = kit.vars;
  const { COST } = kit.fields;
  const { CARD, PLAYER } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** Count every buy toward Messenger's first-buy gate. MUST be registered
   *  before messengerWatch: both fire on the same 'buy' event in def order,
   *  and Messenger's own buy has to read the fresh count (== 1). */
  const buysMadeWatch = (): TriggerDef => ({
    id: 'dom_trigger_advb_buys_made',
    name: 'Adventures: a buy is counted for the turn',
    event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
    condition: null,
    script: [changeVar(BUYS_MADE_VAR, num(1), GAINER)],
  });

  /** MESSENGER bought as the FIRST buy: gain up to $4, everyone gets a copy. */
  const messengerWatch = (): TriggerDef => ({
    id: 'dom_trigger_messenger_buy',
    name: 'Messenger: bought — the news spreads',
    event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
    condition: kit.nameIs('Messenger'),
    script: [
      iff(eq(getVar(BUYS_MADE_VAR, GAINER), num(1)), [
        iff(gt(countCards(zone(SUPPLY),
          lte(field(CARD, COST), add(num(4), getVar(kit.vars.DISCOUNT)))), num(0)), [
          kit.choosePileBlock({
            who: GAINER, from: zone(SUPPLY),
            filter: lte(field(CARD, COST), add(num(4), getVar(kit.vars.DISCOUNT))),
            prompt: 'Messenger: gain a card costing up to $4 — each other player gains a copy',
            body: [
              setVar(ADVB_NAME_VAR, field(CARD, 'name'), GAINER),
              announce(GAINER, ' gains ', CARD, ' — and every rival gets a copy.'),
              kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, GAINER), 'gain', { faceUp: true }),
              forEachPlayer([
                iff(neq(PLAYER, GAINER), [
                  iff(gt(countCards(zone(SUPPLY),
                    eq(field(CARD, 'name'), getVar(ADVB_NAME_VAR, GAINER))), num(0)), [
                    announce(PLAYER, ' gains a copy.'),
                    kit.tmove(
                      specific(bestCard(zone(SUPPLY), 'highest', COST,
                        eq(field(CARD, 'name'), getVar(ADVB_NAME_VAR, GAINER)))),
                      zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
                    ),
                  ], [announce('No copy left for ', PLAYER, '.')]),
                ]),
              ]),
            ],
          }),
        ], [announce('Nothing in the supply costs $4 or less.')]),
      ], [announce('Messenger was not the first buy this turn — no gift.')]),
    ],
  });

  /** PORT bought: a second Port follows ('gain'-tagged — never re-fires). */
  const portWatch = (): TriggerDef => ({
    id: 'dom_trigger_port_buy',
    name: 'Port: bought — a second Port follows',
    event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
    condition: kit.nameIs('Port'),
    script: [
      iff(gt(countCards(zone(SUPPLY), kit.nameIs('Port')), num(0)), [
        announce(GAINER, ' gains another Port.'),
        kit.tmove(
          specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Port'))),
          zone(SUPPLY), zone(DISCARD, GAINER), 'gain', { faceUp: true },
        ),
      ], [announce('The Port pile is empty — no second Port.')]),
    ],
  });

  /** LOST CITY gained: each OTHER player draws a card. */
  const lostCityWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_lost_city_${tag}`,
    name: `Lost City: ${tag === 'buy' ? 'bought' : 'gained'} — the others draw`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Lost City'),
    script: [
      forEachPlayer([
        iff(neq(PLAYER, GAINER), [
          announce(PLAYER, ' draws a card for the Lost City.'),
          kit.draw(PLAYER, 1),
        ]),
      ]),
    ],
  });

  /** HAUNTED WOODS: a haunted player's buy topdecks their whole hand while
   *  the woods sit parked in the attacker's DURATION zone (two seats: the
   *  attacker is nextPlayer(victim)). */
  const hauntedWatch = (): TriggerDef => ({
    id: 'dom_trigger_haunted_woods_buy',
    name: 'Haunted Woods: a haunted player buys',
    event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
    condition: null,
    script: [
      iff(allOf(
        gt(getVar(HAUNTED_VAR, GAINER), num(0)),
        gt(countCards(zone(DURATION, nextPlayer(GAINER)), kit.nameIs('Haunted Woods')), num(0)),
        gt(zoneCount(zone(HAND, GAINER)), num(0)),
      ), [
        announce(GAINER, ' puts their whole hand onto their deck (Haunted Woods).'),
        move(ALL, zone(HAND, GAINER), zone(DECK, GAINER), { toPosition: 'top', faceUp: false }),
      ]),
    ],
  });

  /** SWAMP HAG: a hexed player's buy grows a Curse while the hag is parked. */
  const swampHagWatch = (): TriggerDef => ({
    id: 'dom_trigger_swamp_hag_buy',
    name: 'Swamp Hag: a hexed player buys',
    event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
    condition: null,
    script: [
      iff(allOf(
        gt(getVar(HEXED_VAR, GAINER), num(0)),
        gt(countCards(zone(DURATION, nextPlayer(GAINER)), kit.nameIs('Swamp Hag')), num(0)),
      ), [
        iff(gt(countCards(zone(SUPPLY), kit.nameIs('Curse')), num(0)), [
          announce(GAINER, ' gains a Curse from the Swamp Hag.'),
          kit.tmove(
            specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Curse'))),
            zone(SUPPLY), zone(DISCARD, GAINER), 'gain', { faceUp: true },
          ),
        ], [announce('The Curse pile is empty — the hag hisses harmlessly.')]),
      ]),
    ],
  });

  /** The -$1 token, spent on the holder's next TREASURE play. Always-on
   *  twin of adventuresEvents' Ball-gated spender (see the header): if that
   *  one fires first the token reads spent here, and vice versa. */
  const minusCoinWatch = (): TriggerDef => ({
    id: 'dom_trigger_advb_minus_coin',
    name: 'The -$1 token: a Treasure is played',
    event: { kind: 'cardEnterZone', zoneId: INPLAY, tag: 'play' },
    condition: null,
    script: [
      iff(allOf(
        gt(getVar(MINUS_COIN, GAINER), num(0)),
        kit.IS_TREASURE_CARD,
      ), [
        changeVar(COINS, num(-1), GAINER),
        setVar(MINUS_COIN, num(0), GAINER),
        announce(GAINER, ' spends the -$1 token (one coin less).'),
      ]),
    ],
  });

  return [
    buysMadeWatch(), // BEFORE messengerWatch — see its note.
    messengerWatch(),
    portWatch(),
    lostCityWatch('gain'),
    lostCityWatch('buy'),
    hauntedWatch(),
    swampHagWatch(),
    minusCoinWatch(),
  ];
}

export const adventuresB: ExpansionModule = {
  id: 'adventuresB',
  setName: 'Adventures',

  piles: [
    { name: 'Raze', cost: 2, count: 10 },
    { name: 'Amulet', cost: 3, count: 10 },
    { name: 'Caravan Guard', cost: 3, count: 10 },
    { name: 'Dungeon', cost: 3, count: 10 },
    { name: 'Gear', cost: 3, count: 10 },
    { name: 'Magpie', cost: 4, count: 10 },
    { name: 'Messenger', cost: 4, count: 10 },
    { name: 'Port', cost: 4, count: 10 },
    { name: 'Ranger', cost: 4, count: 10 },
    { name: 'Artificer', cost: 5, count: 10 },
    { name: 'Bridge Troll', cost: 5, count: 10 },
    { name: 'Giant', cost: 5, count: 10 },
    { name: 'Haunted Woods', cost: 5, count: 10 },
    { name: 'Lost City', cost: 5, count: 10 },
    { name: 'Relic', cost: 5, count: 10 },
    { name: 'Storyteller', cost: 5, count: 10 },
    { name: 'Swamp Hag', cost: 5, count: 10 },
    { name: 'Treasure Trove', cost: 5, count: 10 },
    { name: 'Hireling', cost: 6, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Bridge Troll', 'Giant', 'Haunted Woods', 'Relic', 'Swamp Hag'],
  reactionNames: ['Caravan Guard'],
  treasureNames: ['Relic', 'Treasure Trove'],

  variables: [
    {
      id: HAUNTED_VAR, name: 'Haunted Woods: haunted until the woods clear',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: HEXED_VAR, name: 'Swamp Hag: hexed until the hag departs',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: BUYS_MADE_VAR, name: 'Messenger: buys made this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: ADVB_NAME_VAR, name: 'Messenger: the pile being copied',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
  ] as VariableDef[],

  zones: [
    {
      id: GEAR_ZONE, name: 'Gear',
      owner: 'perPlayer', visibility: 'owner', layout: 'row', area: 'player',
    },
  ] as ZoneDef[],

  buildCards,
  buildTriggers,

  buildActions(kit: CardKit): ActionDef[] {
    return [
      // CARAVAN GUARD's reaction (see the register): Guard Dog's response
      // shape — while another player's Attack is pending, play it from the
      // hand; the 'play'-tagged move fires the now half (which parks it),
      // and no Action is spent. NO immunity is granted.
      {
        id: 'dom_action_caravan_guard',
        name: 'Caravan Guard: play it before the attack',
        target: { kind: 'cardInZone', zoneId: kit.zones.HAND, ownerOnly: true },
        speed: 'response',
        legality: allOf(
          kit.nameIs('Caravan Guard'),
          gt(STACK_SIZE, num(0)),
          kit.hasTag(STACK_TOP, kit.tags.ATTACK),
          neq(bnd('$player'), CURRENT),
        ),
        script: [
          announce(bnd('$player'), ' plays a Caravan Guard in response.'),
          kit.tmove(specific(bnd('$card')),
            zone(kit.zones.HAND, bnd('$player')), zone(kit.zones.INPLAY, bnd('$player')),
            'play', { faceUp: true }),
        ],
      },
    ];
  },

  buildVpTerms(kit: CardKit): Block[] {
    // Cards Gear set aside still score their printed VP at every recount
    // (Church's mat precedent — a game ending mid-duration loses nothing).
    return [
      changeVar(kit.vars.VP,
        kit.sumCards(zone(GEAR_ZONE, kit.PLAYER), kit.fields.VP_F), kit.PLAYER),
    ];
  },

  buildCleanupResets(kit: CardKit): Block[] {
    // Messenger's first-buy counter fades with the turn. The haunt/hex
    // marks do NOT reset here — their later halves lift them ("until your
    // next turn" outlives this cleanup).
    return [
      forEachPlayer([
        setVar(BUYS_MADE_VAR, num(0), kit.PLAYER),
      ]),
    ];
  },
};
