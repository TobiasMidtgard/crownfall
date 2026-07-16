/**
 * Promos — Church, Dismantle, Envoy, Walled Village, Governor, Marchland,
 * Captain: the playable Promo subset.
 *
 * EXCLUDED PROMOS (they wait for their mechanics):
 *  - Black Market already ships in the core def (the RESERVE stock sale).
 *  - Stash needs deck-position placement (put it anywhere in your deck).
 *  - Sauna / Avanto needs split piles.
 *  - Prince's permanent set-aside replay needs engine work.
 *
 * House idioms follow the Base/Intrigue/Seaside modules: look-at effects
 * stage through the hidden shared LOOK zone with `revealed` choices, every
 * mandatory choice is guarded so a session can never hang, and Duration
 * cards ride kit.durationPair (now runs on play — tagFilter 'play' — the
 * card parks in the DURATION zone, later fires at the owner's next
 * action-phase start and the card marches back to In Play tagged
 * 'duration_return', where that turn's cleanup discards it).
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "the player to your
 * left" (Envoy) IS the one opponent (nextPlayer(OWNER)).
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - CHURCH: the set-aside cards wait on a per-player Church mat zone
 *    (dom_zone_church, owner-visible, face down) instead of under the card.
 *    With SEVERAL Churches parked, the FIRST later-half to resolve returns
 *    the WHOLE mat (per-mat, not per-Church tracking — Native Village's
 *    scoop idiom). Cards on the mat still score their printed VP at every
 *    recount (buildVpTerms), so a game ending mid-duration loses nothing.
 *  - CAPTAIN (prominent): "play a card from the Supply, leaving it there"
 *    rides kit.playAgain — a synthetic 'play'-tagged enterZone(In Play)
 *    event that never moves the card, so the supply copy stays exactly
 *    where it is ("leaving it there", as printed) while its on-play
 *    abilities fire for the Captain's owner (the current player). Because
 *    the def has NO Duration tag (Duration-ness is behavioral — see the
 *    MOAT DECISION note in dominionGame.ts), "non-Duration" is a NAME
 *    exclusion list over the registry's Duration cards (plus Church and
 *    Captain itself). Island is ALSO excluded: its unguarded self-park move
 *    would displace the supply copy onto the mat (an accidental gain — the
 *    specific selector's `from` is advisory). The $4 cap is Bridge-aware
 *    (current cost, like every supply gain here). Both halves run the same
 *    routine ("now and at the start of your next turn"). A Throne-Roomed
 *    Captain repeats the now half twice but parks once, so later fires
 *    once (the kit's documented contract). An attack played this way is
 *    stacked as usual, so Moat owners get their response window.
 *  - WALLED VILLAGE: the printed clean-up window is the phaseStart-of-
 *    cleanup hook (Treasury's precedent) — it fires at the START of the
 *    owner's cleanup phase, BEFORE the sweep and the redraw, as an optional
 *    yes/no; a topdecked Walled Village is then drawn straight back with
 *    the redraw, the printed timing's usual outcome. "No more than one
 *    other Action card in play" counts Action cards in the owner's In Play
 *    PLUS their parked DURATION cards (printed Durations stay in play
 *    between turns), Walled Village itself included: total <= 2.
 *  - GOVERNOR: exact, resolving in seat order from the owner. The
 *    "costing exactly $1 ($2) more" gains compare PRINTED costs
 *    (Swindler/Stonemason's precedent — a live Bridge discount is ignored
 *    on exact-cost matches). Correctly NOT an Attack (printed): no
 *    response window opens.
 *  - DISMANTLE: "gain a cheaper card" is kit.gainFromSupply with limit
 *    printed-cost − 1 (a Bridge-aware cap — Stonemason's precedent); the
 *    Gold gain whiffs politely on an empty pile.
 *  - ENVOY: the reveal stages through the shared LOOK zone publicly
 *    (Advisor's idiom); the rest join the hand with the 'draw' cause.
 *  - MARCHLAND: Victory-typed (victoryNames) with printed VP 0 — its worth
 *    is a buildVpTerms recount term: 1 VP per 3 Victory cards owned
 *    (rounded down) per Marchland. "You have" = deck / hand / discard /
 *    in-play / duration + the Church mat; cards parked on OTHER modules'
 *    mats (Island, Native Village) are not counted (module boundary). The
 *    printed on-gain rider ("when you gain this") is a pair of module
 *    triggers on the 'gain' AND 'buy' causes (a bought card is gained):
 *    +1 Buy, then discard any number of cards for +$1 each (Cellar's
 *    any-number idiom, cap 99).
 */
import type { AbilityDef, Block, CardDef, Expr, TriggerDef, ZoneDef } from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, bestCard, bnd, changeVar, chooseCard, chooseCardsBlock,
  chooseOption, countCards, eq, field, forEachPlayer, getVar, gt, gte, iff, lte, move, mul, neq,
  nextPlayer, num, setVar, shuffle, specific, str, sub, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Church: 'dom_card_church',
  Dismantle: 'dom_card_dismantle',
  Envoy: 'dom_card_envoy',
  'Walled Village': 'dom_card_walled_village',
  Governor: 'dom_card_governor',
  Marchland: 'dom_card_marchland',
  Captain: 'dom_card_captain',
};

/** The Church mat — set-aside cards wait here until the owner's next turn. */
export const CHURCH_ZONE = 'dom_zone_church';

/**
 * Names the Captain must never play (see the register): the registry's
 * Duration cards (no Duration TAG exists — Duration-ness is behavioral),
 * Church and Captain itself, and Island (whose unguarded self-park move
 * would displace the supply copy — the specific selector's advisory `from`).
 */
export const CAPTAIN_EXCLUDED: string[] = [
  // Seaside 2E part A (Astrolabe is Treasure-typed anyway; listed for completeness).
  'Haven', 'Lighthouse', 'Fishing Village', 'Astrolabe', 'Caravan', 'Merchant Ship', 'Wharf',
  // Seaside 2E part B.
  'Monkey', 'Blockade', 'Corsair', 'Pirate', 'Sea Witch',
  // Seaside 2E part C (+ the self-parking Island).
  'Sailor', 'Tide Pools', 'Tactician', 'Island',
  // This module's own Durations.
  'Church', 'Captain',
];

/** The cleanup phase's id (stable dominionGame.ts literal — Seaside's idiom). */
const PHASE_CLEANUP = 'dom_phase_cleanup';

/** A yes/no question to `who`; the answer lands in $choice as a boolean. */
const yesNo = (who: Expr, prompt: string): Block =>
  ({ kind: 'choose', who, choice: { kind: 'yesNo', prompt } });

/**
 * The official empty-deck reshuffle for effects that TAKE cards off the deck
 * without the `draw` block (Envoy's reveal): when `who`'s deck is empty,
 * flip the discard face-down into it and give it a seeded shuffle.
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
 * is empty). Unrolled per card, so "top 5" keeps the official per-card
 * reshuffle timing (Sentry's idiom).
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
  const { ACTIONS, SCRATCH, DISCOUNT } = kit.vars;
  const { COST } = kit.fields;
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

  /** Captain's target filter (fresh nodes per call — used by both halves). */
  const captainFilter = (): Expr => allOf(
    kit.IS_ACTION_CARD,
    lte(field(CARD, COST), add(num(4), getVar(DISCOUNT))),
    ...CAPTAIN_EXCLUDED.map((n) => neq(field(CARD, 'name'), str(n))),
  );

  /**
   * Captain's routine (see the register): pick a qualifying supply pile and
   * fire its top copy's on-play abilities WITHOUT moving it — the card is
   * played "leaving it there". $owner binds to the current player (the
   * Captain's owner — both halves run on their turn).
   */
  const captainCommand = (): Block[] => [
    iff(gt(countCards(zone(SUPPLY), captainFilter()), num(0)), [
      kit.choosePileBlock({
        who: OWNER, from: zone(SUPPLY), filter: captainFilter(),
        prompt: 'Captain: play a non-Duration Action from the supply costing up to $4 (it stays there)',
        body: [
          announce(OWNER, ' commands ', CARD, ' from the supply.'),
          kit.playAgain(CARD),
        ],
      }),
    ], [announce('Nothing in the supply answers the Captain’s command.')]),
  ];

  // WALLED VILLAGE's clean-up return (see the register): at the START of the
  // owner's cleanup phase — before the sweep — if no more than 2 Action
  // cards are in play (itself included; parked Durations count), the owner
  // may topdeck it. The move is untagged (no cause vocabulary fits; Clerk's
  // topdeck idiom).
  const walledVillageReturn: AbilityDef = {
    id: 'dom_ab_walled_village_return',
    name: 'Walled Village — back behind the walls',
    on: 'phaseStart', zoneId: INPLAY, phaseId: PHASE_CLEANUP,
    condition: allOf(
      eq(CURRENT, OWNER),
      lte(add(
        countCards(zone(INPLAY, OWNER), kit.IS_ACTION_CARD),
        countCards(zone(DURATION, OWNER), kit.IS_ACTION_CARD),
      ), num(2)),
    ),
    script: [
      yesNo(OWNER, 'Walled Village: put it onto your deck?'),
      iff(CHOICE, [
        announce(OWNER, "'s Walled Village returns to the top of their deck."),
        move(specific(SELF), zone(INPLAY, OWNER), zone(DECK, OWNER),
          { toPosition: 'top', faceUp: false }),
      ]),
    ],
  };

  return [
    // CHURCH — Duration. DEVIATION (register): the set-aside cards wait on
    // the per-player Church mat; the later half scoops the WHOLE mat, then
    // offers the optional trash. Both choices are optional/guarded.
    kit.cardDef(IDS.Church, 'Church', 3, 0, 0,
      '+1 Action. Set aside up to 3 cards from your hand face down. At the start of your next turn, put them into your hand, then you may trash a card from your hand.',
      kit.durationPair('dom_ab_church', 'Church', [
        changeVar(ACTIONS, num(1), OWNER),
        iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
          chooseCardsBlock({
            who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(3),
            prompt: 'Church: set aside up to 3 cards from your hand (face down, back next turn)',
            body: [
              announce(OWNER, ' sets a card aside with Church.'),
              move(specific(CARD), zone(HAND, OWNER), zone(CHURCH_ZONE, OWNER), { faceUp: false }),
            ],
          }),
        ]),
      ], [
        iff(gt(zoneCount(zone(CHURCH_ZONE, OWNER)), num(0)), [
          announce(OWNER, ' takes the cards set aside with Church into their hand.'),
          move(ALL, zone(CHURCH_ZONE, OWNER), zone(HAND, OWNER), { faceUp: true }),
        ], [announce('Church had nothing set aside.')]),
        iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
          chooseCardsBlock({
            who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(1),
            prompt: 'Church: you may trash a card from your hand',
            body: [
              announce(OWNER, ' trashes ', CARD, '.'),
              kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            ],
          }),
        ]),
      ])),

    // DISMANTLE — the trash is mandatory (guarded on an empty hand); the
    // printed cost is stashed in SCRATCH before the move. "A cheaper card"
    // = gainFromSupply with limit cost−1 (Bridge-aware — register).
    kit.cardDef(IDS.Dismantle, 'Dismantle', 4, 0, 0,
      'Trash a card from your hand. If it costs $1 or more, gain a cheaper card and a Gold.', [
        kit.onPlay('dom_ab_dismantle', 'Sold for parts', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Dismantle: trash a card from your hand',
            }),
            setVar(SCRATCH, field(CHOICE, COST), OWNER),
            announce(OWNER, ' dismantles ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            iff(gte(getVar(SCRATCH, OWNER), num(1)), [
              ...kit.gainFromSupply({
                limit: sub(getVar(SCRATCH, OWNER), num(1)),
                prompt: 'Dismantle: gain a card costing less than the trashed card',
                whiff: [announce('Nothing in the supply is cheap enough to salvage.')],
              }),
              gainNamed('Gold', zone(DISCARD, OWNER), OWNER, ' gains a Gold from the wreckage.',
                'The Gold pile is empty — no bonus from the wreckage.'),
            ], [announce('It cost nothing — nothing more happens.')]),
          ], [announce(OWNER, ' has nothing to dismantle.')]),
        ]),
      ]),

    // ENVOY — 2-player reading: "the player to your left" IS the opponent,
    // who picks the discarded card from the revealed five (Advisor's shape).
    kit.cardDef(IDS.Envoy, 'Envoy', 4, 0, 0,
      'Reveal the top 5 cards of your deck. The player to your left chooses one. Discard that one and put the rest into your hand.', [
        kit.onPlay('dom_ab_envoy', 'Dispatches from abroad', [
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            announce(OWNER, ' reveals the top cards of their deck.'),
            chooseCard({
              who: nextPlayer(OWNER), from: zone(LOOK), revealed: true,
              prompt: 'Envoy: choose the revealed card the owner must discard',
            }),
            announce(nextPlayer(OWNER), ' makes ', OWNER, ' discard ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              kit.tmove(ALL, zone(LOOK), zone(HAND, OWNER), 'draw', { faceUp: true }),
            ]),
          ], [announce(OWNER, ' has no cards left to reveal.')]),
        ]),
      ]),

    // WALLED VILLAGE — the play half is exact; the clean-up return is the
    // phaseStart-of-cleanup ability above (register).
    kit.cardDef(IDS['Walled Village'], 'Walled Village', 4, 0, 0,
      '+1 Card. +2 Actions. At the start of Clean-up, if you have this and no more than one other Action card in play, you may put this onto your deck.', [
        kit.onPlay('dom_ab_walled_village', 'Safe behind the walls', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
        ]),
        walledVillageReturn,
      ]),

    // GOVERNOR — exact (register): the owner gets the parenthesised
    // version, everyone resolves in seat order from the owner. The
    // exact-cost gains compare PRINTED costs. Not an Attack (printed).
    kit.cardDef(IDS.Governor, 'Governor', 5, 0, 0,
      '+1 Action. Choose one; you get the version in parentheses: Each player gets +1 (+3) Cards; or each player gains a Silver (Gold); or each player may trash a card from their hand and gain a card costing exactly $1 ($2) more.', [
        kit.onPlay('dom_ab_governor', 'The governor decrees', [
          changeVar(ACTIONS, num(1), OWNER),
          chooseOption('Governor: choose one (you get the stronger version)', [
            { id: 'gov_cards', label: 'Each player draws 1 card (you draw 3)' },
            { id: 'gov_gold', label: 'Each player gains a Silver (you gain a Gold)' },
            { id: 'gov_remodel', label: 'Each player may trash a hand card and gain one costing exactly $1 more ($2 for you)' },
          ], OWNER),
          iff(eq(CHOICE, str('gov_cards')), [
            forEachPlayer([
              iff(eq(PLAYER, OWNER), [kit.draw(PLAYER, 3)], [kit.draw(PLAYER, 1)]),
            ]),
          ], [
            iff(eq(CHOICE, str('gov_gold')), [
              forEachPlayer([
                iff(eq(PLAYER, OWNER), [
                  gainNamed('Gold', zone(DISCARD, PLAYER), PLAYER, ' gains a Gold by decree.',
                    'The Gold pile is empty — the decree pays nothing.'),
                ], [
                  gainNamed('Silver', zone(DISCARD, PLAYER), PLAYER, ' gains a Silver by decree.',
                    'The Silver pile is empty — the decree pays nothing.'),
                ]),
              ]),
            ], [
              // gov_remodel: each player MAY trash; the upgrade cap rides
              // SCRATCH (per-player) — printed cost + 2 for the owner, + 1
              // for everyone else; the gain wants the EXACT amount.
              forEachPlayer([
                iff(gt(zoneCount(zone(HAND, PLAYER)), num(0)), [
                  chooseCardsBlock({
                    who: PLAYER, from: zone(HAND, PLAYER), min: num(0), max: num(1),
                    prompt: 'Governor: you may trash a card to gain one costing exactly $1 more ($2 for the governor)',
                    body: [
                      iff(eq(PLAYER, OWNER),
                        [setVar(SCRATCH, add(field(CARD, COST), num(2)), PLAYER)],
                        [setVar(SCRATCH, add(field(CARD, COST), num(1)), PLAYER)]),
                      announce(PLAYER, ' trashes ', CARD, '.'),
                      kit.tmove(specific(CARD), zone(HAND, PLAYER), zone(TRASH), 'trash', { faceUp: true }),
                      iff(gt(countCards(zone(SUPPLY),
                        eq(field(CARD, COST), getVar(SCRATCH, PLAYER))), num(0)), [
                        kit.choosePileBlock({
                          who: PLAYER, from: zone(SUPPLY),
                          filter: eq(field(CARD, COST), getVar(SCRATCH, PLAYER)),
                          prompt: 'Governor: gain a card costing exactly the upgraded amount',
                          body: [
                            announce(PLAYER, ' gains ', CARD, '.'),
                            kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true }),
                          ],
                        }),
                      ], [announce('Nothing in the supply costs exactly that much — no upgrade.')]),
                    ],
                  }),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),

    // MARCHLAND — Victory-typed (victoryNames), printed VP 0: the worth is
    // the buildVpTerms recount term; the on-gain rider is the pair of
    // buildTriggers watchers (register).
    kit.cardDef(IDS.Marchland, 'Marchland', 5, 0, 0,
      'Worth 1 VP per 3 Victory cards you have (round down). When you gain this, +1 Buy, and discard any number of cards for +$1 each.'),

    // CAPTAIN — Duration. PROMINENT DEVIATION (register): both halves run
    // the same supply-play routine via kit.playAgain — the supply copy is
    // played "leaving it there"; Durations and Island are excluded by name.
    kit.cardDef(IDS.Captain, 'Captain', 6, 0, 0,
      'Now and at the start of your next turn: Play a non-Duration Action card from the Supply costing up to $4, leaving it there.',
      kit.durationPair('dom_ab_captain', 'Captain', captainCommand(), captainCommand())),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { HAND, DISCARD } = kit.zones;
  const { BUYS, COINS } = kit.vars;
  const { CARD } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** MARCHLAND's on-gain rider: +1 Buy, discard any number for +$1 each. */
  const marchlandWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_marchland_${tag}`,
    name: `Marchland: ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Marchland'),
    script: [
      changeVar(BUYS, num(1), GAINER),
      announce(GAINER, ' gains Marchland: +1 Buy, and may discard cards for +$1 each.'),
      iff(gt(zoneCount(zone(HAND, GAINER)), num(0)), [
        chooseCardsBlock({
          who: GAINER, from: zone(HAND, GAINER), min: num(0), max: num(99),
          prompt: 'Marchland: discard any number of cards for +$1 each',
          body: [
            announce(GAINER, ' discards ', CARD, ' for +$1.'),
            kit.tmove(specific(CARD), zone(HAND, GAINER), zone(DISCARD, GAINER), 'discard', { faceUp: true }),
            changeVar(COINS, num(1), GAINER),
          ],
        }),
      ]),
    ],
  });

  return [
    marchlandWatch('gain'),
    marchlandWatch('buy'),
  ];
}

export const promos1: ExpansionModule = {
  id: 'promos1',
  setName: 'Promos',

  piles: [
    { name: 'Church', cost: 3, count: 10 },
    { name: 'Dismantle', cost: 4, count: 10 },
    { name: 'Envoy', cost: 4, count: 10 },
    { name: 'Walled Village', cost: 4, count: 10 },
    { name: 'Governor', cost: 5, count: 10 },
    { name: 'Marchland', cost: 5, count: 10 },
    { name: 'Captain', cost: 6, count: 10 },
  ],

  ids: IDS,

  victoryNames: ['Marchland'],

  zones: [
    {
      id: CHURCH_ZONE, name: 'Church',
      owner: 'perPlayer', visibility: 'owner', layout: 'row', area: 'player',
    },
  ] as ZoneDef[],

  buildCards,
  buildTriggers,

  buildVpTerms(kit: CardKit): Block[] {
    // Owned zones for Marchland's recount term: the core five (mirroring
    // RECOUNT_VP_BODY's world, Duke's precedent) plus this module's Church
    // mat. $player is bound by the recount's forEachPlayer.
    const owned = [
      kit.zones.DECK, kit.zones.HAND, kit.zones.DISCARD, kit.zones.INPLAY, kit.zones.DURATION,
      CHURCH_ZONE,
    ];
    const ownedCount = (filter: Expr): Expr => owned
      .map((z) => countCards(zone(z, kit.PLAYER), filter))
      .reduce((a, b) => add(a, b));
    const victories = ownedCount(kit.isA(kit.CARD, kit.types.VICTORY));
    const marchlands = ownedCount(kit.nameIs('Marchland'));
    return [
      // Cards Church set aside still score their printed VP (a game ending
      // mid-duration loses nothing — Island's mat precedent).
      changeVar(kit.vars.VP,
        kit.sumCards(zone(CHURCH_ZONE, kit.PLAYER), kit.fields.VP_F), kit.PLAYER),
      // Marchland: floor(victories / 3) VP each — exact integer math,
      // (v - v % 3) / 3 (the Gardens term's shape).
      changeVar(kit.vars.VP,
        mul(marchlands, kit.div(sub(victories, kit.mod(victories, num(3))), num(3))),
        kit.PLAYER),
    ];
  },
};
