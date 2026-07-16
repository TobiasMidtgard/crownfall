/**
 * Cornucopia (1E) — Hamlet, Fortune Teller, Menagerie, Farming Village,
 * Horse Traders, Remake, Tournament, Young Witch, Harvest, Horn of Plenty,
 * Hunting Party, Jester, Fairgrounds — plus the five Prizes (Bag of Gold,
 * Diadem, Followers, Princess, Trusty Steed) as NON-SUPPLY stock in a hidden
 * shared Prize zone, won through Tournament.
 *
 * House idioms follow the Base/Intrigue/Seaside modules: attack halves are
 * separate `stacked: true` abilities gated per victim on IMMUNE == 0 (the
 * shared effectResolved trigger resets it), dug-through cards stage in the
 * hidden shared LOOK zone and are discarded from there, "reveal" is an
 * announcement (Shanty Town's idiom), and every mandatory choice is guarded
 * so a session can never hang.
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "each other player" is
 * the one opponent everywhere below (forEachOpponent).
 *
 * DEVIATIONS register (details at each card):
 *  - YOUNG WITCH: the printed Setup adds an 11th kingdom pile whose cards are
 *    Bane cards — a setup-time concept this def's fixed kingdom promotion
 *    cannot express, so the Bane is OMITTED entirely: there is no "reveal a
 *    Bane" escape and the Curse half is a plain Moat-blockable attack.
 *  - "VICTORY CARD" TESTS (Fortune Teller / Jester / Horn of Plenty): a card
 *    here has ONE primary type, so official Action–Victory duals (Mill,
 *    Nobles, Island…) are Action-typed with a printed-VP field. The test is
 *    "Victory-typed OR printed VP > 0" (Ironworks' precedent), so duals
 *    behave as printed. Fortune Teller additionally stops on Curse-typed
 *    cards, as printed.
 *  - DISTINCT-NAME COUNTS (Menagerie / Harvest / Horn of Plenty /
 *    Fairgrounds): countCards cannot count distinct names in one expression,
 *    so the module counts them EXACTLY with blocks — a hidden per-card mark
 *    plus a per-player name stash; each pass resets its own marks, then
 *    visits every card and counts it only when no already-visited card
 *    shares its name. The tally is exact (NOT an approximation); the
 *    Fairgrounds recount term is gated on owning a Fairgrounds so the
 *    every-gain recount stays cheap when the card is not in the game.
 *    The recount uses its own stash/tally pair (dom_var_fair_*) so it can
 *    never clobber an ability's in-flight count.
 *  - HORN OF PLENTY: "in play" counts In Play AND the owner's parked
 *    DURATION cards (printed Durations remain in play between turns — Sea
 *    Chart's reading). The cost cap is Bridge-aware (cost <= distinct +
 *    DISCOUNT), like every core supply gain. The Victory self-trash is
 *    guarded on the Horn still being in play.
 *  - JESTER: "a copy of the discarded card" is the supply pile's top copy by
 *    name — an emptied pile means no copy, as printed. The you-or-them menu
 *    goes to Jester's owner.
 *  - TOURNAMENT (not an Attack, correctly so): the printed simultaneous
 *    reveals resolve SEQUENTIALLY — the opponent decides first, then the
 *    owner. The Prize is picked off the face-down Prize stock through a
 *    revealed pile choice; once the Province is discarded the gain is
 *    mandatory (it whiffs only when the Prizes AND the Duchy pile are both
 *    empty). Prize gains go onto the deck, as printed.
 *  - HORSE TRADERS: the reaction is its own response-speed action
 *    (Diplomat's shape): while another player's Attack is pending, its
 *    holder may set it aside into the DURATION zone; a hidden per-card mark
 *    remembers it was set aside (a Haven-parked copy stays inert), and at
 *    the owner's next action-phase start it draws them 1 card and returns to
 *    hand. It grants NO immunity — as printed, it simply is not in hand when
 *    the attack resolves (Militia then hits a 1-smaller hand). The core
 *    reveal-Moat action cannot target it (that legality is name-gated).
 *  - PRINCESS: "while this is in play" is approximated as a flat this-turn
 *    cost reduction (+2 on the shared Bridge DISCOUNT, reset at cleanup).
 *    A Throne-Roomed Princess stacks the discount to 4 (officially it would
 *    stay 2) and grants a second +1 Buy (that part is printed behavior).
 *  - TRUSTY STEED: the two (different) choices resolve in the order picked,
 *    not in the printed list order (official rulings resolve listed order).
 *  - REMAKE: "costing exactly $1 more" compares PRINTED costs (Upgrade's
 *    precedent) — a live Bridge discount shifts both sides equally except at
 *    the zero floor.
 *  - ATTACK TIMING (Fortune Teller / Young Witch / Jester / Followers): the
 *    immediate halves (coins, draws, the Estate gain) resolve before the
 *    response window opens — Militia's pattern, shared by every attack here.
 *  - FAIRGROUNDS: Victory-typed, printed VP field 0 (Gardens/Duke's shape);
 *    its worth arrives through the buildVpTerms recount term — 2 VP per FULL
 *    5 differently named cards owned (deck/hand/discard/in-play/duration),
 *    per Fairgrounds owned.
 */
import type {
  AbilityDef, ActionDef, Block, CardDef, Expr, VariableDef, ZoneDef,
} from '../../shared/types';
import {
  ALL, CURRENT, STACK_SIZE, STACK_TOP, add, allOf, announce, anyOf, bestCard, bnd,
  cardZoneId, changeVar, chooseCard, chooseCardsBlock, chooseOption, countCards,
  discardDownTo, eq, field, forEachCard, forEachOpponent, getVar, gt, iff, lt, lte,
  move, mul, neq, num, setVar, shuffle, specific, str, sub, topCard, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Hamlet: 'dom_card_hamlet',
  'Fortune Teller': 'dom_card_fortune_teller',
  Menagerie: 'dom_card_menagerie',
  'Farming Village': 'dom_card_farming_village',
  'Horse Traders': 'dom_card_horse_traders',
  Remake: 'dom_card_remake',
  Tournament: 'dom_card_tournament',
  'Young Witch': 'dom_card_young_witch',
  Harvest: 'dom_card_harvest',
  'Horn of Plenty': 'dom_card_horn_of_plenty',
  'Hunting Party': 'dom_card_hunting_party',
  Jester: 'dom_card_jester',
  Fairgrounds: 'dom_card_fairgrounds',
  // Prizes (non-supply stock, one copy each).
  'Bag of Gold': 'dom_card_bag_of_gold',
  Diadem: 'dom_card_diadem',
  Followers: 'dom_card_followers',
  Princess: 'dom_card_princess',
  'Trusty Steed': 'dom_card_trusty_steed',
};

/** The shared face-down Prize stock Tournament awards from. */
export const PRIZE_ZONE = 'dom_zone_prizes';

/** Ability-time name stash for the distinct-name passes + Jester's copy. */
export const CORN_NAME_VAR = 'dom_var_corn_name';
/** Per-card "already visited" mark for the distinct-name passes. */
export const CORN_MARK_VAR = 'dom_var_corn_mark';
/** Ability-time distinct tally (Harvest, Horn of Plenty). */
export const CORN_DISTINCT_VAR = 'dom_var_corn_distinct';
/** The Fairgrounds RECOUNT's own stash/tally pair — the recount fires on
 *  every 'gain' and must never clobber an ability's in-flight count. */
export const FAIR_NAME_VAR = 'dom_var_fair_name';
export const FAIR_DISTINCT_VAR = 'dom_var_fair_distinct';
/** 1 while THIS Horse Traders was set aside by its own reaction. */
export const HORSE_TRADERS_MARK = 'dom_var_horse_traders_aside';

/** The action phase's id (stable dominionGame.ts literal; kit keeps phase ids private). */
const PHASE_ACTION = 'dom_phase_action';

/** Owned zones — mirrors the core recount's OWNED_ZONES walk. */
const OWNED_ZONE_IDS = (kit: CardKit): string[] => [
  kit.zones.DECK, kit.zones.HAND, kit.zones.DISCARD, kit.zones.INPLAY, kit.zones.DURATION,
];

/**
 * The official empty-deck reshuffle for effects that TAKE cards off the deck
 * without the `draw` block: when `who`'s deck is empty, flip the discard
 * face-down into it and give it a seeded shuffle (base2e's helper).
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
 * is empty). Unrolled per card — official per-card reshuffle timing, no
 * repeat block (Sentry's idiom).
 */
function takeTop(kit: CardKit, who: Expr, toZoneId: string, faceUp: boolean): Block[] {
  const deck = zone(kit.zones.DECK, who);
  return [
    refillDeck(kit, who),
    iff(gt(zoneCount(deck), num(0)), [
      move(topN(1), deck, zone(toZoneId), { faceUp }),
    ]),
  ];
}

/**
 * EXACT distinct-name count over the given zones, written into `tallyVar`
 * (perPlayer, keyed to `who`). Pure blocks: reset every card's mark, then
 * visit each card — it counts when NO already-visited card shares its name
 * (the per-player `nameVar` stashes the outer card's name so the inner
 * countCards filter, whose $card rebinds per candidate, can compare against
 * it). O(cards²) filter evals — callers gate where it matters.
 */
function countDistinct(
  kit: CardKit, zoneIds: string[], zoneOwner: Expr | null,
  who: Expr, nameVar: string, tallyVar: string,
): Block[] {
  const { CARD } = kit;
  const markedSameName = (): Expr => zoneIds
    .map((zid) => countCards(zone(zid, zoneOwner), allOf(
      eq(getVar(CORN_MARK_VAR, CARD), num(1)),
      eq(field(CARD, 'name'), getVar(nameVar, who)),
    )))
    .reduce((a, b) => add(a, b));
  return [
    setVar(tallyVar, num(0), who),
    ...zoneIds.map((zid) => forEachCard(zone(zid, zoneOwner), null, [
      setVar(CORN_MARK_VAR, num(0), CARD),
    ])),
    ...zoneIds.map((zid) => forEachCard(zone(zid, zoneOwner), null, [
      setVar(nameVar, field(CARD, 'name'), who),
      iff(eq(markedSameName(), num(0)), [changeVar(tallyVar, num(1), who)]),
      setVar(CORN_MARK_VAR, num(1), CARD),
    ])),
  ];
}

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK, DURATION } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, SCRATCH, DISCOUNT } = kit.vars;
  const { COST, VP_F } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER, SELF } = kit;

  /** "Is a Victory card" in the one-primary-type world (see the register):
   *  Victory-typed OR printed VP > 0 (catches Mill/Nobles/Harem duals). */
  const victoryCard = (card: Expr): Expr => anyOf(
    kit.isA(card, kit.types.VICTORY),
    gt(field(card, VP_F), num(0)),
  );
  /** Fortune Teller's stop: a Victory card or a Curse. */
  const stopCard = (card: Expr): Expr => anyOf(
    kit.isA(card, kit.types.VICTORY),
    kit.isA(card, kit.types.CURSE),
    gt(field(card, VP_F), num(0)),
  );

  /** Gain the named basic from the supply into `to` (guarded on the pile). */
  const gainNamed = (
    name: string, to: ReturnType<typeof zone>, who: Expr, note: string, empty: string,
    opts: { toPosition?: 'top' | 'bottom'; faceUp?: boolean } = {},
  ): Block =>
    iff(gt(countCards(zone(SUPPLY), kit.nameIs(name)), num(0)), [
      announce(who, note),
      kit.tmove(
        specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs(name))),
        zone(SUPPLY), to, 'gain',
        { toPosition: opts.toPosition ?? 'top', faceUp: opts.faceUp ?? true },
      ),
    ], [announce(empty)]);

  /**
   * Else-chain over option ids (intrigue2eA's Pawn helper): sibling
   * conditions are decided before any branch's nested choose runs.
   */
  const optionChain = (ids: string[], handle: (id: string) => Block[]): Block[] => {
    const [head, ...rest] = ids;
    if (rest.length === 0) return handle(head);
    return [iff(eq(CHOICE, str(head)), handle(head), optionChain(rest, handle))];
  };

  // --- Trusty Steed plumbing ----------------------------------------------
  const TS_OPTIONS = [
    { id: 'ts_cards', label: '+2 Cards' },
    { id: 'ts_actions', label: '+2 Actions' },
    { id: 'ts_coins', label: '+$2' },
    { id: 'ts_silvers', label: 'Gain 4 Silvers and put your deck into your discard pile' },
  ];
  /** Fresh nodes per call — branches must not share mutable block objects. */
  const tsGrant = (id: string): Block[] => {
    switch (id) {
      case 'ts_cards': return [kit.draw(OWNER, 2)];
      case 'ts_actions': return [changeVar(ACTIONS, num(2), OWNER)];
      case 'ts_coins': return [changeVar(COINS, num(2), OWNER)];
      default: return [
        announce(OWNER, ' whistles — 4 Silvers gallop in.'),
        // Unrolled ×4: the def bans 'repeat' blocks.
        ...Array.from({ length: 4 }, () =>
          iff(gt(countCards(zone(SUPPLY), kit.nameIs('Silver')), num(0)), [
            kit.tmove(
              specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Silver'))),
              zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
            ),
          ], [announce('The supply is out of Silver.')])),
        announce(OWNER, ' pours their deck into their discard pile.'),
        kit.tmove(ALL, zone(DECK, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
      ];
    }
  };

  // --- Remake's one pass (fresh nodes per call — it runs twice) ------------
  const remakePass = (): Block =>
    iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
      chooseCard({
        who: OWNER, from: zone(HAND, OWNER),
        prompt: 'Remake: trash a card from your hand',
      }),
      setVar(SCRATCH, add(field(CHOICE, COST), num(1)), OWNER),
      announce(OWNER, ' trashes ', CHOICE, '.'),
      kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
      iff(gt(countCards(zone(SUPPLY), eq(field(CARD, COST), getVar(SCRATCH, OWNER))), num(0)), [
        kit.choosePileBlock({
          who: OWNER, from: zone(SUPPLY),
          filter: eq(field(CARD, COST), getVar(SCRATCH, OWNER)),
          prompt: 'Remake: gain a card costing exactly $1 more than the trashed card',
          body: [
            announce(OWNER, ' gains ', CARD, '.'),
            kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
          ],
        }),
      ], [announce('Nothing in the supply costs exactly that much.')]),
    ], [announce(OWNER, ' has nothing to remake.')]);

  // --- Tournament's prize-or-Duchy award (runs inside the Province body) ---
  const pickPrize = (): Block => kit.choosePileBlock({
    who: OWNER, from: zone(PRIZE_ZONE), revealed: true,
    prompt: 'Tournament: choose your Prize (it goes onto your deck)',
    body: [
      announce(OWNER, ' claims ', CARD, ' as their prize!'),
      kit.tmove(specific(CARD), zone(PRIZE_ZONE), zone(DECK, OWNER), 'gain',
        { toPosition: 'top', faceUp: false }),
    ],
  });
  const gainDuchyToDeck = (): Block => gainNamed(
    'Duchy', zone(DECK, OWNER), OWNER,
    ' gains a Duchy onto their deck.',
    'The Duchy pile is empty — nothing gained.',
    { toPosition: 'top', faceUp: false },
  );
  const awardPrizeOrDuchy: Block[] = [
    iff(gt(zoneCount(zone(PRIZE_ZONE)), num(0)), [
      iff(gt(countCards(zone(SUPPLY), kit.nameIs('Duchy')), num(0)), [
        chooseOption('Tournament: gain a Prize or a Duchy (onto your deck)?', [
          { id: 'tourn_prize', label: 'Gain a Prize' },
          { id: 'tourn_duchy', label: 'Gain a Duchy' },
        ], OWNER),
        iff(eq(CHOICE, str('tourn_prize')), [pickPrize()], [gainDuchyToDeck()]),
      ], [pickPrize()]),
    ], [
      iff(gt(countCards(zone(SUPPLY), kit.nameIs('Duchy')), num(0)),
        [gainDuchyToDeck()],
        [announce('No Prize and no Duchy remains — nothing gained.')]),
    ]),
  ];

  // --- Horse Traders' next-turn return (see the register) ------------------
  const horseTradersReturn: AbilityDef = {
    id: 'dom_ab_horse_traders_return',
    name: 'Horse Traders — return',
    on: 'phaseStart',
    zoneId: DURATION,
    phaseId: PHASE_ACTION,
    // Only a copy the REACTION set aside (mark 1) returns — a Haven-parked
    // Horse Traders wears no mark and stays inert.
    condition: allOf(eq(CURRENT, OWNER), eq(getVar(HORSE_TRADERS_MARK, SELF), num(1))),
    script: [
      setVar(HORSE_TRADERS_MARK, num(0), SELF),
      announce(OWNER, ' takes the set-aside Horse Traders back into their hand (+1 Card).'),
      kit.draw(OWNER, 1),
      kit.tmove(specific(SELF), zone(DURATION, OWNER), zone(HAND, OWNER), 'duration_return',
        { faceUp: true }),
    ],
  };

  /** Discard exactly N, clamped to the hand (Steward's SCRATCH idiom). */
  const discardExactly = (n: number, prompt: string): Block[] => [
    setVar(SCRATCH, num(n), OWNER),
    iff(lt(zoneCount(zone(HAND, OWNER)), num(n)), [
      setVar(SCRATCH, zoneCount(zone(HAND, OWNER)), OWNER),
    ]),
    iff(gt(getVar(SCRATCH, OWNER), num(0)), [
      chooseCardsBlock({
        who: OWNER, from: zone(HAND, OWNER),
        min: getVar(SCRATCH, OWNER), max: num(n),
        prompt,
        body: [
          announce(OWNER, ' discards ', CARD, '.'),
          kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
        ],
      }),
    ]),
  ];

  return [
    // HAMLET — exact. Both discards are optional (min 0 / max 1) and pay
    // their bonus inside the pick's body.
    kit.cardDef(IDS.Hamlet, 'Hamlet', 2, 0, 0,
      '+1 Card. +1 Action. You may discard a card for +1 Action. You may discard a card for +1 Buy.', [
        kit.onPlay('dom_ab_hamlet', 'Life on the green', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(1),
              prompt: 'Hamlet: you may discard a card for +1 Action',
              body: [
                announce(OWNER, ' discards ', CARD, ' for +1 Action.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                changeVar(ACTIONS, num(1), OWNER),
              ],
            }),
          ]),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(1),
              prompt: 'Hamlet: you may discard a card for +1 Buy',
              body: [
                announce(OWNER, ' discards ', CARD, ' for +1 Buy.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                changeVar(BUYS, num(1), OWNER),
              ],
            }),
          ]),
        ]),
      ]),

    // FORTUNE TELLER — Action – Attack. Coins immediate; the dig is the
    // stacked half (Militia's pattern). The victim's revealed non-stops
    // stage in LOOK and are discarded; the stop card STAYS on the deck (it
    // was never moved). Stop test: Victory-typed / Curse-typed / printed
    // VP > 0 (see the register).
    kit.cardDef(IDS['Fortune Teller'], 'Fortune Teller', 3, 0, 0,
      '+$2. Each other player reveals cards from the top of their deck until they reveal a Victory card or a Curse. They put it on top and discard the rest.', [
        kit.onPlay('dom_ab_fortune_teller_coins', 'Crossed palms', [
          changeVar(COINS, num(2), OWNER),
        ]),
        kit.onPlay('dom_ab_fortune_teller_attack', 'A dark omen', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              setVar(SCRATCH, num(0), PLAYER),
              {
                kind: 'repeatWhile',
                cond: eq(getVar(SCRATCH, PLAYER), num(0)),
                body: [
                  refillDeck(kit, PLAYER),
                  iff(eq(zoneCount(zone(DECK, PLAYER)), num(0)), [
                    announce(PLAYER, ' has no more cards to reveal.'),
                    setVar(SCRATCH, num(1), PLAYER),
                  ], [
                    announce(PLAYER, ' reveals ', topCard(zone(DECK, PLAYER)), '.'),
                    iff(stopCard(topCard(zone(DECK, PLAYER))), [
                      announce(PLAYER, ' puts it back on top of their deck.'),
                      setVar(SCRATCH, num(1), PLAYER),
                    ], [
                      move(topN(1), zone(DECK, PLAYER), zone(LOOK), { faceUp: true }),
                    ]),
                  ]),
                ],
              } as Block,
              iff(gt(zoneCount(zone(LOOK)), num(0)), [
                kit.tmove(ALL, zone(LOOK), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
              ]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // MENAGERIE — exact: the duplicate test is a block pass over the hand
    // (per-player name stash; a name appearing more than once flags SCRATCH).
    // An empty hand is vacuously all-different (+3), the official ruling.
    kit.cardDef(IDS.Menagerie, 'Menagerie', 3, 0, 0,
      '+1 Action. Reveal your hand. If the revealed cards all have different names, +3 Cards. Otherwise, +1 Card.', [
        kit.onPlay('dom_ab_menagerie', 'Open the cages', [
          changeVar(ACTIONS, num(1), OWNER),
          announce(OWNER, ' reveals their hand.'),
          setVar(SCRATCH, num(0), OWNER),
          forEachCard(zone(HAND, OWNER), null, [
            setVar(CORN_NAME_VAR, field(CARD, 'name'), OWNER),
            iff(gt(countCards(zone(HAND, OWNER),
              eq(field(CARD, 'name'), getVar(CORN_NAME_VAR, OWNER))), num(1)), [
              setVar(SCRATCH, num(1), OWNER),
            ]),
          ]),
          iff(eq(getVar(SCRATCH, OWNER), num(0)), [
            announce('All different names — the full menagerie parades: +3 Cards.'),
            kit.draw(OWNER, 3),
          ], [
            announce('A duplicate spoils the show: +1 Card.'),
            kit.draw(OWNER, 1),
          ]),
        ]),
      ]),

    // FARMING VILLAGE — exact. The found Action/Treasure sits on top of the
    // deck when the dig stops, so the draw block takes exactly it; the
    // passed-over cards stage in LOOK and are discarded. Running out of
    // cards ends the dig with nothing to hand (official).
    kit.cardDef(IDS['Farming Village'], 'Farming Village', 4, 0, 0,
      '+2 Actions. Reveal cards from the top of your deck until you reveal an Action or Treasure card. Put that card into your hand and discard the other cards.', [
        kit.onPlay('dom_ab_farming_village', 'Hands in the soil', [
          changeVar(ACTIONS, num(2), OWNER),
          setVar(SCRATCH, num(0), OWNER),
          {
            kind: 'repeatWhile',
            cond: eq(getVar(SCRATCH, OWNER), num(0)),
            body: [
              refillDeck(kit, OWNER),
              iff(eq(zoneCount(zone(DECK, OWNER)), num(0)), [
                announce(OWNER, ' runs out of cards to reveal.'),
                setVar(SCRATCH, num(1), OWNER),
              ], [
                announce(OWNER, ' reveals ', topCard(zone(DECK, OWNER)), '.'),
                iff(anyOf(
                  kit.isA(topCard(zone(DECK, OWNER)), kit.types.ACTION),
                  kit.isA(topCard(zone(DECK, OWNER)), kit.types.TREASURE),
                ), [
                  announce('It goes into their hand.'),
                  setVar(SCRATCH, num(1), OWNER),
                  kit.draw(OWNER, 1),
                ], [
                  move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: true }),
                ]),
              ]),
            ],
          } as Block,
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            kit.tmove(ALL, zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
          ]),
        ]),
      ]),

    // HORSE TRADERS — Action – Reaction. On play: +1 Buy +$3, discard
    // exactly 2 (clamped). The reaction is the module's response-speed
    // action (buildActions) + the return ability above (see the register).
    kit.cardDef(IDS['Horse Traders'], 'Horse Traders', 4, 0, 0,
      '+1 Buy. +$3. Discard 2 cards. When another player plays an Attack card, you may set this aside from your hand. If you do, then at the start of your next turn, +1 Card and return this to your hand.', [
        kit.onPlay('dom_ab_horse_traders_main', 'Honest dealing, mostly', [
          changeVar(BUYS, num(1), OWNER),
          changeVar(COINS, num(3), OWNER),
          ...discardExactly(2, 'Horse Traders: discard 2 cards'),
        ]),
        horseTradersReturn,
      ]),

    // REMAKE — the Upgrade shape, twice (unrolled — no repeat block).
    kit.cardDef(IDS.Remake, 'Remake', 4, 0, 0,
      'Do this twice: Trash a card from your hand, then gain a card costing exactly $1 more than it.', [
        kit.onPlay('dom_ab_remake', 'Twice-turned cloth', [
          remakePass(),
          remakePass(),
        ]),
      ]),

    // TOURNAMENT — see the register: sequential reveals (opponent first),
    // Prize picked from the face-down stock via a revealed pile choice.
    kit.cardDef(IDS.Tournament, 'Tournament', 4, 0, 0,
      '+1 Action. Each player may reveal a Province from their hand. If you do, discard it and gain any Prize (from the Prize pile) or a Duchy, onto your deck. If no one else does, +1 Card and +$1.', [
        kit.onPlay('dom_ab_tournament', 'To the lists', [
          changeVar(ACTIONS, num(1), OWNER),
          // SCRATCH flags "an opponent revealed a Province" — reset first.
          setVar(SCRATCH, num(0), OWNER),
          forEachOpponent([
            iff(gt(countCards(zone(HAND, PLAYER), kit.nameIs('Province')), num(0)), [
              chooseOption('Tournament: reveal a Province from your hand?', [
                { id: 'tourn_reveal', label: 'Reveal a Province' },
                { id: 'tourn_keep', label: 'Reveal nothing' },
              ], PLAYER),
              iff(eq(CHOICE, str('tourn_reveal')), [
                announce(PLAYER, ' reveals a Province.'),
                setVar(SCRATCH, num(1), OWNER),
              ]),
            ]),
          ]),
          iff(gt(countCards(zone(HAND, OWNER), kit.nameIs('Province')), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.nameIs('Province'),
              min: num(0), max: num(1),
              prompt: 'Tournament: you may reveal a Province — discard it for a Prize or a Duchy',
              body: [
                announce(OWNER, ' reveals and discards a Province.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                ...awardPrizeOrDuchy,
              ],
            }),
          ]),
          iff(eq(getVar(SCRATCH, OWNER), num(0)), [
            announce(OWNER, ' rides uncontested: +1 Card and +$1.'),
            kit.draw(OWNER, 1),
            changeVar(COINS, num(1), OWNER),
          ]),
        ]),
      ]),

    // YOUNG WITCH — Action – Attack. PROMINENT DEVIATION (register): the
    // Bane setup pile is omitted, so there is no Bane-reveal escape — the
    // Curse half is a plain Moat-blockable attack.
    kit.cardDef(IDS['Young Witch'], 'Young Witch', 4, 0, 0,
      '+2 Cards. Discard 2 cards. Each other player may reveal a Bane card from their hand; if they don’t, they gain a Curse. Setup: Add an extra Kingdom card pile costing $2 or $3 to the Supply. Cards from that pile are Bane cards.', [
        kit.onPlay('dom_ab_young_witch_main', 'Apprentice hexes', [
          kit.draw(OWNER, 2),
          ...discardExactly(2, 'Young Witch: discard 2 cards'),
        ]),
        kit.onPlay('dom_ab_young_witch_attack', 'A first curse, well practiced', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(gt(countCards(zone(SUPPLY), kit.nameIs('Curse')), num(0)), [
                announce(PLAYER, ' gains a Curse.'),
                kit.tmove(
                  specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Curse'))),
                  zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
                ),
              ]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // HARVEST — exact: top 4 stage in LOOK (per-card reshuffle timing), the
    // distinct-name pass tallies them, +$1 each, then all are discarded.
    kit.cardDef(IDS.Harvest, 'Harvest', 5, 0, 0,
      'Reveal the top 4 cards of your deck, then discard them. +$1 per differently named card revealed.', [
        kit.onPlay('dom_ab_harvest', 'Count the sheaves', [
          ...takeTop(kit, OWNER, LOOK, true),
          ...takeTop(kit, OWNER, LOOK, true),
          ...takeTop(kit, OWNER, LOOK, true),
          ...takeTop(kit, OWNER, LOOK, true),
          ...countDistinct(kit, [LOOK], null, OWNER, CORN_NAME_VAR, CORN_DISTINCT_VAR),
          announce(OWNER, ' reveals the harvest — +$1 per differently named card.'),
          changeVar(COINS, getVar(CORN_DISTINCT_VAR, OWNER), OWNER),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            kit.tmove(ALL, zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
          ]),
        ]),
      ]),

    // HORN OF PLENTY — Treasure worth $0 (the coin field pays nothing; the
    // gain is the enterZone ability). Distinct count spans In Play + the
    // owner's parked DURATION cards, counting the Horn itself (it has
    // already entered In Play when the ability fires). Victory test and the
    // guarded self-trash per the register.
    kit.cardDef(IDS['Horn of Plenty'], 'Horn of Plenty', 5, 0, 0,
      'When you play this, gain a card costing up to $1 per differently named card you have in play, counting this. If it’s a Victory card, trash this.', [
        kit.onPlay('dom_ab_horn_of_plenty', 'The horn tips over', [
          ...countDistinct(kit, [INPLAY, DURATION], OWNER, OWNER, CORN_NAME_VAR, CORN_DISTINCT_VAR),
          iff(gt(countCards(zone(SUPPLY),
            lte(field(CARD, COST), add(getVar(CORN_DISTINCT_VAR, OWNER), getVar(DISCOUNT)))), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY),
              filter: lte(field(CARD, COST), add(getVar(CORN_DISTINCT_VAR, OWNER), getVar(DISCOUNT))),
              prompt: 'Horn of Plenty: gain a card costing up to $1 per differently named card in play',
              body: [
                announce(OWNER, ' gains ', CARD, ' from the Horn of Plenty.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                iff(victoryCard(CARD), [
                  iff(eq(cardZoneId(SELF), str(INPLAY)), [
                    announce('The horn is spent on glory — Horn of Plenty is trashed.'),
                    kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true }),
                  ]),
                ]),
              ],
            }),
          ], [announce('Nothing in the supply is cheap enough for the horn.')]),
        ]),
      ]),

    // HUNTING PARTY — exact: +1 Card +1 Action, reveal the hand
    // (announcement), then dig until a card that is NOT a duplicate of one
    // in hand (name compare against the live hand); it is drawn, the
    // passed-over duplicates are discarded from LOOK.
    kit.cardDef(IDS['Hunting Party'], 'Hunting Party', 5, 0, 0,
      '+1 Card. +1 Action. Reveal your hand. Reveal cards from your deck until you reveal one that isn’t a duplicate of one in your hand. Put it into your hand and discard the rest.', [
        kit.onPlay('dom_ab_hunting_party', 'The hunt is on', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          announce(OWNER, ' reveals their hand.'),
          setVar(SCRATCH, num(0), OWNER),
          {
            kind: 'repeatWhile',
            cond: eq(getVar(SCRATCH, OWNER), num(0)),
            body: [
              refillDeck(kit, OWNER),
              iff(eq(zoneCount(zone(DECK, OWNER)), num(0)), [
                announce(OWNER, ' runs out of cards to reveal.'),
                setVar(SCRATCH, num(1), OWNER),
              ], [
                announce(OWNER, ' reveals ', topCard(zone(DECK, OWNER)), '.'),
                iff(eq(countCards(zone(HAND, OWNER),
                  eq(field(CARD, 'name'), field(topCard(zone(DECK, OWNER)), 'name'))), num(0)), [
                  announce('Something new — it joins their hand.'),
                  setVar(SCRATCH, num(1), OWNER),
                  kit.draw(OWNER, 1),
                ], [
                  move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: true }),
                ]),
              ]),
            ],
          } as Block,
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            kit.tmove(ALL, zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
          ]),
        ]),
      ]),

    // JESTER — Action – Attack. Coins immediate; the stacked half discards
    // each victim's top card: a Victory card means a Curse for them,
    // anything else a supply copy for whoever the OWNER picks (register).
    kit.cardDef(IDS.Jester, 'Jester', 5, 0, 0,
      '+$2. Each other player discards the top card of their deck. If it’s a Victory card, they gain a Curse; otherwise they gain a copy of the discarded card, or you do, your choice.', [
        kit.onPlay('dom_ab_jester_coins', 'A coin for a laugh', [
          changeVar(COINS, num(2), OWNER),
        ]),
        kit.onPlay('dom_ab_jester_attack', 'The joke lands', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              refillDeck(kit, PLAYER),
              iff(gt(zoneCount(zone(DECK, PLAYER)), num(0)), [
                setVar(CORN_NAME_VAR, field(topCard(zone(DECK, PLAYER)), 'name'), PLAYER),
                announce(PLAYER, ' discards ', topCard(zone(DECK, PLAYER)), ' from the top of their deck.'),
                iff(victoryCard(topCard(zone(DECK, PLAYER))), [
                  kit.tmove(topN(1), zone(DECK, PLAYER), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
                  iff(gt(countCards(zone(SUPPLY), kit.nameIs('Curse')), num(0)), [
                    announce(PLAYER, ' gains a Curse.'),
                    kit.tmove(
                      specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Curse'))),
                      zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
                    ),
                  ]),
                ], [
                  kit.tmove(topN(1), zone(DECK, PLAYER), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
                  iff(gt(countCards(zone(SUPPLY),
                    eq(field(CARD, 'name'), getVar(CORN_NAME_VAR, PLAYER))), num(0)), [
                    chooseOption('Jester: who gains a copy of the discarded card?', [
                      { id: 'jester_me', label: 'I gain the copy' },
                      { id: 'jester_them', label: 'They gain the copy' },
                    ], OWNER),
                    iff(eq(CHOICE, str('jester_me')), [
                      announce(OWNER, ' gains the copy.'),
                      kit.tmove(
                        specific(bestCard(zone(SUPPLY), 'highest', COST,
                          eq(field(CARD, 'name'), getVar(CORN_NAME_VAR, PLAYER)))),
                        zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
                      ),
                    ], [
                      announce(PLAYER, ' gains the copy.'),
                      kit.tmove(
                        specific(bestCard(zone(SUPPLY), 'highest', COST,
                          eq(field(CARD, 'name'), getVar(CORN_NAME_VAR, PLAYER)))),
                        zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
                      ),
                    ]),
                  ], [announce('The supply holds no copy to gain.')]),
                ]),
              ], [announce(PLAYER, ' has no cards left to discard.')]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // FAIRGROUNDS — Victory-typed, printed VP field 0; scored by the
    // buildVpTerms recount term (2 VP per full 5 distinct names owned, per
    // Fairgrounds owned — an EXACT count, see the register).
    kit.cardDef(IDS.Fairgrounds, 'Fairgrounds', 6, 0, 0,
      'Worth 2 VP per 5 differently named cards you have (round down).'),

    // --- The Prizes (non-supply, one copy each, cost 0) ---------------------

    kit.cardDef(IDS['Bag of Gold'], 'Bag of Gold', 0, 0, 0,
      '+1 Action. Gain a Gold, putting it on top of your deck. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_bag_of_gold', 'Heavier than it looks', [
          changeVar(ACTIONS, num(1), OWNER),
          gainNamed('Gold', zone(DECK, OWNER), OWNER,
            ' gains a Gold onto their deck.',
            'The Gold pile is empty — the bag holds air.',
            { toPosition: 'top', faceUp: false }),
        ]),
      ]),

    // DIADEM — Treasure. The $2 rides the coin FIELD (the treasure action
    // pays it); the ability adds +$1 per unused Action (the live counter).
    kit.cardDef(IDS.Diadem, 'Diadem', 0, 2, 0,
      'Worth $2. When you play this, +$1 per unused Action you have (Action, not Action card). (This is not in the Supply.)', [
        kit.onPlay('dom_ab_diadem', 'The weight of the crown', [
          iff(gt(getVar(ACTIONS, OWNER), num(0)), [
            announce(OWNER, ' converts their unused Actions to coin.'),
            changeVar(COINS, getVar(ACTIONS, OWNER), OWNER),
          ]),
        ]),
      ]),

    // FOLLOWERS — Action – Attack. Draw + Estate gain immediate; the Curse
    // and the discard-to-3 are the stacked half (Militia's pattern).
    kit.cardDef(IDS.Followers, 'Followers', 0, 0, 0,
      '+2 Cards. Gain an Estate. Each other player gains a Curse and discards down to 3 cards in hand. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_followers_main', 'The entourage arrives', [
          kit.draw(OWNER, 2),
          gainNamed('Estate', zone(DISCARD, OWNER), OWNER,
            ' gains an Estate.',
            'The Estate pile is empty — no new holdings.'),
        ]),
        kit.onPlay('dom_ab_followers_attack', 'The crowd turns ugly', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(gt(countCards(zone(SUPPLY), kit.nameIs('Curse')), num(0)), [
                announce(PLAYER, ' gains a Curse.'),
                kit.tmove(
                  specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Curse'))),
                  zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
                ),
              ]),
              discardDownTo({
                who: PLAYER, from: zone(HAND, PLAYER), to: zone(DISCARD, PLAYER),
                keep: num(3),
                prompt: 'Followers: discard down to 3 cards in hand',
              }),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // PRINCESS — DEVIATION (register): "while this is in play" becomes a
    // flat this-turn discount on the shared Bridge DISCOUNT (cleanup resets
    // it core-side; costs floor at 0 core-side too).
    kit.cardDef(IDS.Princess, 'Princess', 0, 0, 0,
      '+1 Buy. While this is in play, cards cost $2 less, but not less than $0. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_princess', 'A royal favor', [
          changeVar(BUYS, num(1), OWNER),
          announce('By royal decree, cards cost $2 less this turn.'),
          changeVar(DISCOUNT, num(2)),
        ]),
      ]),

    // TRUSTY STEED — choose two DIFFERENT (the second menu never offers the
    // first pick — Pawn's idiom). DEVIATION (register): bonuses resolve in
    // the order picked, not the printed order.
    kit.cardDef(IDS['Trusty Steed'], 'Trusty Steed', 0, 0, 0,
      'Choose two: +2 Cards; +2 Actions; +$2; or gain 4 Silvers and put your deck into your discard pile. The choices must be different. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_trusty_steed', 'Hooves like thunder', [
          chooseOption('Trusty Steed: choose your first boon', TS_OPTIONS, OWNER),
          ...optionChain(TS_OPTIONS.map((o) => o.id), (first) => {
            const rest = TS_OPTIONS.filter((o) => o.id !== first);
            return [
              ...tsGrant(first),
              chooseOption('Trusty Steed: choose a different second boon', rest, OWNER),
              ...optionChain(rest.map((o) => o.id), (second) => tsGrant(second)),
            ];
          }),
        ]),
      ]),
  ];
}

export const cornucopia1e: ExpansionModule = {
  id: 'cornucopia1e',
  setName: 'Cornucopia',

  piles: [
    { name: 'Hamlet', cost: 2, count: 10 },
    { name: 'Fortune Teller', cost: 3, count: 10 },
    { name: 'Menagerie', cost: 3, count: 10 },
    { name: 'Farming Village', cost: 4, count: 10 },
    { name: 'Horse Traders', cost: 4, count: 10 },
    { name: 'Remake', cost: 4, count: 10 },
    { name: 'Tournament', cost: 4, count: 10 },
    { name: 'Young Witch', cost: 4, count: 10 },
    { name: 'Harvest', cost: 5, count: 10 },
    { name: 'Horn of Plenty', cost: 5, count: 10 },
    { name: 'Hunting Party', cost: 5, count: 10 },
    { name: 'Jester', cost: 5, count: 10 },
    { name: 'Fairgrounds', cost: 6, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Fortune Teller', 'Young Witch', 'Jester', 'Followers'],
  reactionNames: ['Horse Traders'],
  victoryNames: ['Fairgrounds'],
  treasureNames: ['Horn of Plenty', 'Diadem'],

  variables: [
    {
      id: CORN_NAME_VAR, name: 'Cornucopia: name stash',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: CORN_MARK_VAR, name: 'Cornucopia: distinct-count mark',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
    {
      id: CORN_DISTINCT_VAR, name: 'Cornucopia: distinct tally',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: FAIR_NAME_VAR, name: 'Fairgrounds: recount name stash',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: FAIR_DISTINCT_VAR, name: 'Fairgrounds: recount distinct tally',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: HORSE_TRADERS_MARK, name: 'Horse Traders: set aside',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  zones: [
    {
      id: PRIZE_ZONE, name: 'Prizes',
      owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
    },
  ] as ZoneDef[],

  nonSupply: [
    {
      zoneId: PRIZE_ZONE,
      piles: [
        { name: 'Bag of Gold', cost: 0, count: 1 },
        { name: 'Diadem', cost: 0, count: 1 },
        { name: 'Followers', cost: 0, count: 1 },
        { name: 'Princess', cost: 0, count: 1 },
        { name: 'Trusty Steed', cost: 0, count: 1 },
      ],
    },
  ],

  buildCards,

  buildActions(kit: CardKit): ActionDef[] {
    const { HAND, DURATION } = kit.zones;
    return [
      // Horse Traders' set-aside (see the register): Diplomat's response
      // shape — legal while another player's Attack is pending and this
      // card sits in the holder's hand. NO immunity is granted.
      {
        id: 'dom_action_horse_traders',
        name: 'Horse Traders: set it aside',
        target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
        speed: 'response',
        legality: allOf(
          kit.nameIs('Horse Traders'),
          gt(STACK_SIZE, num(0)),
          kit.hasTag(STACK_TOP, kit.tags.ATTACK),
          neq(bnd('$player'), CURRENT),
        ),
        script: [
          setVar(HORSE_TRADERS_MARK, num(1), kit.CARD),
          announce(kit.PLAYER, ' sets Horse Traders aside until their next turn.'),
          move(specific(kit.CARD), zone(HAND, kit.PLAYER), zone(DURATION, kit.PLAYER),
            { faceUp: true }),
        ],
      },
    ];
  },

  buildVpTerms(kit: CardKit): Block[] {
    // Fairgrounds: 2 VP per FULL 5 differently named cards owned, per
    // Fairgrounds owned ($player bound by the recount's forEachPlayer).
    // Gated on owning one so the every-gain recount stays cheap otherwise;
    // the distinct pass is EXACT (see countDistinct).
    const owned = OWNED_ZONE_IDS(kit);
    const fairCount = (): Expr => owned
      .map((zid) => countCards(zone(zid, kit.PLAYER), kit.nameIs('Fairgrounds')))
      .reduce((a, b) => add(a, b));
    const distinct = (): Expr => getVar(FAIR_DISTINCT_VAR, kit.PLAYER);
    return [
      iff(gt(fairCount(), num(0)), [
        ...countDistinct(kit, owned, kit.PLAYER, kit.PLAYER, FAIR_NAME_VAR, FAIR_DISTINCT_VAR),
        // floor(distinct / 5) as (d - d % 5) / 5 — exact integer math.
        changeVar(kit.vars.VP,
          mul(fairCount(),
            mul(num(2), kit.div(sub(distinct(), kit.mod(distinct(), num(5))), num(5)))),
          kit.PLAYER),
      ]),
    ];
  },
};
