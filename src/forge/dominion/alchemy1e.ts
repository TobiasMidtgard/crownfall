/**
 * Alchemy (1E) — Transmute, Vineyard, Apothecary, Herbalist, Scrying Pool,
 * University, Alchemist, Familiar, Philosopher's Stone, Golem, Apprentice.
 *
 * THE SET'S SECOND CURRENCY: every potion-cost card here sets
 * `fields[COST_POTION] = 1` — the CORE buy action enforces AND spends the
 * potion half (never discounted), the Potion pile itself ships in core
 * (reserve stock, 16 copies) and pickKingdom auto-promotes it into the
 * supply whenever a picked kingdom card carries a potion cost. POTIONS is a
 * core per-player counter, reset at cleanup.
 *
 * EXCLUDED: Possession — taking control of another player's turn needs the
 * extra-turn engine (Outpost's bucket); nothing here can honestly fake it.
 *
 * House idioms follow the Base/Intrigue/Seaside modules: attack halves are
 * separate `stacked: true` abilities gated per victim on IMMUNE == 0 (the
 * shared effectResolved trigger resets it), dug-through cards stage in the
 * hidden shared LOOK zone, "reveal" is an announcement (Shanty Town's
 * idiom), and every mandatory choice is guarded so a session can never hang.
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "each other player" is
 * the one opponent everywhere below (forEachOpponent).
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - COST DISPLAY (every potion-cost card): the cost badge renders coins
 *    only, so each potion-cost card's text field STARTS with "Costs 1
 *    Potion." — the printed potion droplet has no badge slot.
 *  - APOTHECARY: the non-Copper/Potion cards go back on top of the deck in
 *    a FIXED order (the reveal staging's order), not "any order".
 *  - SCRYING POOL: the printed simultaneous top-card reveals resolve
 *    SEQUENTIALLY — the owner's own card first, then the opponent's (both
 *    decisions are the owner's, as printed). The whole body rides the
 *    stacked attack half, so a revealed Moat waves off the opponent's
 *    reveal while the owner's own reveal and the dig still resolve.
 *  - ALCHEMIST: "when you discard this from play" is the phaseStart-of-
 *    cleanup window (Walled Village / Treasury's precedent): at the START
 *    of the owner's cleanup, with a Potion in play, an optional yes/no
 *    topdecks it — the redraw then usually pulls it straight back, the
 *    printed timing's usual outcome.
 *  - HERBALIST: the printed on-discard rider becomes the same cleanup-start
 *    window — each Herbalist in play offers to topdeck ONE Treasure from
 *    play (min 0 / max 1). It does not literally wait for the discard
 *    itself, and a Herbalist leaving play some other way offers nothing.
 *  - TRANSMUTE: a card here has ONE primary type, so the trashed card takes
 *    exactly one branch — Action → Duchy, else Treasure → Transmute, else
 *    Victory → Gold (official multi-type cards would take every matching
 *    branch). Action–Victory duals (Mill, Nobles…) are Action-typed here
 *    and transmute into a Duchy.
 *  - GOLEM: the two found Actions play in REVEAL order (fixed), not the
 *    chooser's, and both enter play before their stacked halves resolve
 *    (attacks found by Golem still open the response window). The
 *    passed-over cards are discarded after the dig, as printed; found
 *    Actions stage in the module's hidden Golem zone so an emptied deck's
 *    mid-dig reshuffle can never re-reveal them.
 *  - APPRENTICE: "+1 Card per $1 it costs" reads the PRINTED cost (Bishop's
 *    precedent — a live Bridge discount is ignored), +2 more when the
 *    trashed card carries a potion cost (the COST_POTION field).
 *  - UNIVERSITY: "costing up to $5" excludes potion-cost cards (the
 *    official ruling — a potion in the cost never fits a coins-only cap);
 *    the coin cap itself is Bridge-aware like every supply gain here.
 *  - PHILOSOPHER'S STONE: Treasure-typed, coin field 0 — the worth is the
 *    on-play ability, counting deck + discard AT PLAY TIME (printed).
 *  - VINEYARD: Victory-typed, printed VP field 0 — its worth is a
 *    buildVpTerms recount term: 1 VP per FULL 3 Action cards owned per
 *    Vineyard, over deck/hand/discard/in-play/duration (cards parked on
 *    other modules' mats are not counted — module boundary).
 */
import type { AbilityDef, Block, CardDef, Expr, ZoneDef } from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, anyOf, bestCard, changeVar, chooseCard,
  chooseCardsBlock, chooseOption, countCards, eq, field, forEachOpponent, getVar, gt, iff,
  lt, lte, matching, move, mul, neq, num, setVar, shuffle, specific, str, sub, topCard,
  topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Transmute: 'dom_card_transmute',
  Vineyard: 'dom_card_vineyard',
  Apothecary: 'dom_card_apothecary',
  Herbalist: 'dom_card_herbalist',
  'Scrying Pool': 'dom_card_scrying_pool',
  University: 'dom_card_university',
  Alchemist: 'dom_card_alchemist',
  Familiar: 'dom_card_familiar',
  "Philosopher's Stone": 'dom_card_philosophers_stone',
  Golem: 'dom_card_golem',
  Apprentice: 'dom_card_apprentice',
};

/** Golem's found-Action staging: hidden and shared (LOOK's twin), so a
 *  mid-dig reshuffle of the emptied deck can never re-reveal a found card. */
export const GOLEM_ZONE = 'dom_zone_golem';

/** The cleanup phase's id (stable dominionGame.ts literal — Promos' idiom). */
const PHASE_CLEANUP = 'dom_phase_cleanup';

/** A yes/no question to `who`; the answer lands in $choice as a boolean. */
const yesNo = (who: Expr, prompt: string): Block =>
  ({ kind: 'choose', who, choice: { kind: 'yesNo', prompt } });

/**
 * The official empty-deck reshuffle for effects that TAKE cards off the deck
 * without the `draw` block (the reveals and digs below): when `who`'s deck
 * is empty, flip the discard face-down into it and give it a seeded shuffle.
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
 * is empty). Unrolled per card, so "top 4" keeps the official per-card
 * reshuffle timing (Sentry's idiom — no repeat block).
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
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, SCRATCH, DISCOUNT } = kit.vars;
  const { COST, COST_POTION } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER, SELF } = kit;
  const { nameIs } = kit;

  /** Stamp the potion half of the cost on a finished card def. */
  const brew = (c: CardDef): CardDef => {
    c.fields[COST_POTION] = 1;
    return c;
  };

  /** Gain the named basic from the supply into `to` (guarded on the pile). */
  const gainNamed = (name: string, to: ReturnType<typeof zone>, who: Expr, note: string, empty: string): Block =>
    iff(gt(countCards(zone(SUPPLY), nameIs(name)), num(0)), [
      announce(who, note),
      kit.tmove(
        specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs(name))),
        zone(SUPPLY), to, 'gain', { faceUp: true },
      ),
    ], [announce(empty)]);

  /** Copper or Potion — Apothecary's take-to-hand filter ($card per candidate). */
  const copperOrPotion = (): Expr => anyOf(nameIs('Copper'), nameIs('Potion'));

  /**
   * SCRYING POOL's per-player reveal (fresh nodes per call — used for the
   * owner AND inside forEachOpponent): reveal the top card (announcement),
   * the OWNER decides discard-or-back.
   */
  const revealTopAndDecide = (who: Expr, label: string): Block[] => [
    refillDeck(kit, who),
    iff(gt(zoneCount(zone(DECK, who)), num(0)), [
      announce(who, ' reveals ', topCard(zone(DECK, who)), ' from the top of their deck.'),
      chooseOption(`Scrying Pool: ${label} revealed top card — discard it or put it back?`, [
        { id: 'sp_discard', label: 'Discard it' },
        { id: 'sp_back', label: 'Put it back' },
      ], OWNER),
      iff(eq(CHOICE, str('sp_discard')), [
        announce(who, ' discards it.'),
        kit.tmove(topN(1), zone(DECK, who), zone(DISCARD, who), 'discard', { faceUp: true }),
      ], [announce('It goes back on top.')]),
    ], [announce(who, ' has no cards to reveal.')]),
  ];

  /** UNIVERSITY's gain filter (fresh nodes per call): an Action costing up
   *  to $5 (Bridge-aware) with NO potion in its cost (the official ruling). */
  const universityFilter = (): Expr => allOf(
    kit.IS_ACTION_CARD,
    lte(field(CARD, COST), add(num(5), getVar(DISCOUNT))),
    eq(field(CARD, COST_POTION), num(0)),
  );

  // ALCHEMIST's clean-up return (see the register): at the START of the
  // owner's cleanup — before the sweep — with a Potion in play, the owner
  // may topdeck it. The move is untagged (no cause vocabulary fits — Walled
  // Village's precedent).
  const alchemistReturn: AbilityDef = {
    id: 'dom_ab_alchemist_return',
    name: 'Alchemist — back to the bench',
    on: 'phaseStart', zoneId: INPLAY, phaseId: PHASE_CLEANUP,
    condition: allOf(
      eq(CURRENT, OWNER),
      gt(countCards(zone(INPLAY, OWNER), nameIs('Potion')), num(0)),
    ),
    script: [
      yesNo(OWNER, 'Alchemist: put it onto your deck? (You have a Potion in play.)'),
      iff(CHOICE, [
        announce(OWNER, "'s Alchemist returns to the top of their deck."),
        move(specific(SELF), zone(INPLAY, OWNER), zone(DECK, OWNER),
          { toPosition: 'top', faceUp: false }),
      ]),
    ],
  };

  // HERBALIST's clean-up rider (see the register): at the start of the
  // owner's cleanup, each Herbalist in play offers to topdeck ONE Treasure
  // from play. Optional (min 0), so it can never hang.
  const herbalistReturn: AbilityDef = {
    id: 'dom_ab_herbalist_return',
    name: 'Herbalist — savings for later',
    on: 'phaseStart', zoneId: INPLAY, phaseId: PHASE_CLEANUP,
    condition: allOf(
      eq(CURRENT, OWNER),
      gt(countCards(zone(INPLAY, OWNER), kit.IS_TREASURE_CARD), num(0)),
    ),
    script: [
      chooseCardsBlock({
        who: OWNER, from: zone(INPLAY, OWNER), filter: kit.IS_TREASURE_CARD,
        min: num(0), max: num(1),
        prompt: 'Herbalist: you may put one of your Treasures from play onto your deck',
        body: [
          announce(OWNER, ' tucks ', CARD, ' onto their deck (Herbalist).'),
          move(specific(CARD), zone(INPLAY, OWNER), zone(DECK, OWNER),
            { toPosition: 'top', faceUp: false }),
        ],
      }),
    ],
  };

  return [
    // TRANSMUTE — the trash is mandatory (guarded on an empty hand); the
    // branch is decided BEFORE the card leaves the hand (SCRATCH encodes
    // it), then exactly one gain fires. ONE primary type per card here —
    // see the register.
    brew(kit.cardDef(IDS.Transmute, 'Transmute', 0, 0, 0,
      'Costs 1 Potion. Trash a card from your hand. If it is an Action card, gain a Duchy; Treasure card, gain a Transmute; Victory card, gain a Gold.', [
        kit.onPlay('dom_ab_transmute', 'Lead into gold', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Transmute: trash a card from your hand',
            }),
            setVar(SCRATCH, num(0), OWNER),
            iff(kit.isA(CHOICE, kit.types.ACTION), [setVar(SCRATCH, num(1), OWNER)]),
            iff(kit.isA(CHOICE, kit.types.TREASURE), [setVar(SCRATCH, num(2), OWNER)]),
            iff(kit.isA(CHOICE, kit.types.VICTORY), [setVar(SCRATCH, num(3), OWNER)]),
            announce(OWNER, ' transmutes ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            iff(eq(getVar(SCRATCH, OWNER), num(1)), [
              gainNamed('Duchy', zone(DISCARD, OWNER), OWNER, ' gains a Duchy.',
                'The Duchy pile is empty — the transmutation fizzles.'),
            ], [
              iff(eq(getVar(SCRATCH, OWNER), num(2)), [
                gainNamed('Transmute', zone(DISCARD, OWNER), OWNER, ' gains a Transmute.',
                  'No Transmute remains in the supply — the transmutation fizzles.'),
              ], [
                iff(eq(getVar(SCRATCH, OWNER), num(3)), [
                  gainNamed('Gold', zone(DISCARD, OWNER), OWNER, ' gains a Gold.',
                    'The Gold pile is empty — the transmutation fizzles.'),
                ], [announce('It was neither Action, Treasure nor Victory — nothing comes of it.')]),
              ]),
            ]),
          ], [announce(OWNER, ' has nothing to transmute.')]),
        ]),
      ])),

    // VINEYARD — Victory-typed (victoryNames), printed VP field 0: the
    // worth is the buildVpTerms recount term (register).
    brew(kit.cardDef(IDS.Vineyard, 'Vineyard', 0, 0, 0,
      'Costs 1 Potion. Worth 1 VP per 3 Action cards you have (round down).')),

    // APOTHECARY — +1 Card +1 Action, reveal the top 4 (per-card reshuffle
    // timing through LOOK), Coppers and Potions to hand ('draw' cause), the
    // rest back on top in a FIXED order (register).
    brew(kit.cardDef(IDS.Apothecary, 'Apothecary', 2, 0, 0,
      'Costs 1 Potion. +1 Card. +1 Action. Reveal the top 4 cards of your deck. Put the revealed Coppers and Potions into your hand. Put the other cards back on top of your deck in any order.', [
        kit.onPlay('dom_ab_apothecary', 'The good stuff', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          iff(gt(countCards(zone(LOOK), copperOrPotion()), num(0)), [
            announce(OWNER, ' takes the revealed Coppers and Potions into their hand.'),
            kit.tmove(matching(copperOrPotion()), zone(LOOK), zone(HAND, OWNER), 'draw', { faceUp: true }),
          ]),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            announce('The rest go back on top of the deck.'),
            move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
          ]),
        ]),
      ])),

    // HERBALIST — +1 Buy +$1 on play; the topdeck rider is the cleanup-start
    // ability above (register). Coin cost only — no potion.
    kit.cardDef(IDS.Herbalist, 'Herbalist', 2, 0, 0,
      '+1 Buy. +$1. When you discard this from play, you may put one of your Treasures from play onto your deck.', [
        kit.onPlay('dom_ab_herbalist', 'Poultices and premiums', [
          changeVar(BUYS, num(1), OWNER),
          changeVar(COINS, num(1), OWNER),
        ]),
        herbalistReturn,
      ]),

    // SCRYING POOL — Action – Attack. +1 Action immediate; the reveals (owner
    // first, then the opponent — both the owner's call) and the Action dig
    // ride the stacked half, so Moat covers the opponent's reveal (register).
    // The dig's found non-Action joins the hand too, as printed.
    brew(kit.cardDef(IDS['Scrying Pool'], 'Scrying Pool', 2, 0, 0,
      "Costs 1 Potion. +1 Action. Each player (including you) reveals the top card of their deck and either discards it or puts it back, your choice. Then reveal cards from your deck until revealing one that isn't an Action. Put all of those revealed cards into your hand.", [
        kit.onPlay('dom_ab_scrying_pool_action', 'Still waters', [
          changeVar(ACTIONS, num(1), OWNER),
        ]),
        kit.onPlay('dom_ab_scrying_pool_attack', 'Deep readings', [
          ...revealTopAndDecide(OWNER, 'your own'),
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              ...revealTopAndDecide(PLAYER, "the opponent's"),
            ]),
          ]),
          setVar(SCRATCH, num(0), OWNER),
          {
            kind: 'repeatWhile',
            cond: eq(getVar(SCRATCH, OWNER), num(0)),
            body: [
              refillDeck(kit, OWNER),
              iff(eq(zoneCount(zone(DECK, OWNER)), num(0)), [
                announce(OWNER, ' has no more cards to reveal.'),
                setVar(SCRATCH, num(1), OWNER),
              ], [
                announce(OWNER, ' reveals ', topCard(zone(DECK, OWNER)), '.'),
                iff(kit.isA(topCard(zone(DECK, OWNER)), kit.types.ACTION), [
                  move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: true }),
                ], [
                  setVar(SCRATCH, num(1), OWNER),
                  kit.draw(OWNER, 1),
                ]),
              ]),
            ],
          } as Block,
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            announce(OWNER, ' takes all the revealed Actions into their hand.'),
            kit.tmove(ALL, zone(LOOK), zone(HAND, OWNER), 'draw', { faceUp: true }),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ])),

    // UNIVERSITY — +2 Actions; the gain is optional and filtered to Actions
    // with no potion cost, coin cap Bridge-aware (register).
    brew(kit.cardDef(IDS.University, 'University', 2, 0, 0,
      'Costs 1 Potion. +2 Actions. You may gain an Action card costing up to 5.', [
        kit.onPlay('dom_ab_university', 'Matriculation', [
          changeVar(ACTIONS, num(2), OWNER),
          iff(gt(countCards(zone(SUPPLY), universityFilter()), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY), filter: universityFilter(), optional: true,
              prompt: 'University: you may gain an Action card costing up to 5',
              body: [
                announce(OWNER, ' gains ', CARD, ' from the University.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
              ],
            }),
          ], [announce('No Action in the supply is cheap enough to study.')]),
        ]),
      ])),

    // ALCHEMIST — +2 Cards +1 Action; the topdeck rider is the cleanup-start
    // yes/no above (register).
    brew(kit.cardDef(IDS.Alchemist, 'Alchemist', 3, 0, 0,
      'Costs 1 Potion. +2 Cards. +1 Action. When you discard this from play, you may put this onto your deck if you have a Potion in play.', [
        kit.onPlay('dom_ab_alchemist', 'Careful distillation', [
          kit.draw(OWNER, 2),
          changeVar(ACTIONS, num(1), OWNER),
        ]),
        alchemistReturn,
      ])),

    // FAMILIAR — Action – Attack, Witch's exact shape: the cantrip half is
    // immediate, the Curse half stacked (Moat-blockable).
    brew(kit.cardDef(IDS.Familiar, 'Familiar', 3, 0, 0,
      'Costs 1 Potion. +1 Card. +1 Action. Each other player gains a Curse.', [
        kit.onPlay('dom_ab_familiar_main', 'A small dark shape', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
        ]),
        kit.onPlay('dom_ab_familiar_attack', 'It hisses a hex', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(gt(countCards(zone(SUPPLY), nameIs('Curse')), num(0)), [
                announce(PLAYER, ' gains a Curse.'),
                kit.tmove(
                  specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Curse'))),
                  zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
                ),
              ]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ])),

    // PHILOSOPHER'S STONE — Treasure, coin field 0: the worth is the on-play
    // ability, counting deck + discard AT PLAY TIME (register). Exact
    // integer floor: (n - n % 5) / 5.
    brew(kit.cardDef(IDS["Philosopher's Stone"], "Philosopher's Stone", 3, 0, 0,
      'Costs 1 Potion. When you play this, count your deck and discard pile. Worth 1 per 5 cards total between them (round down).', [
        kit.onPlay('dom_ab_philosophers_stone', 'Almost the real thing', [
          setVar(SCRATCH,
            add(zoneCount(zone(DECK, OWNER)), zoneCount(zone(DISCARD, OWNER))), OWNER),
          changeVar(COINS,
            kit.div(sub(getVar(SCRATCH, OWNER), kit.mod(getVar(SCRATCH, OWNER), num(5))), num(5)),
            OWNER),
          announce(OWNER, "'s Philosopher's Stone pays 1 coin per 5 cards in their deck and discard."),
        ]),
      ])),

    // GOLEM — the dig stages found Actions in the hidden Golem zone (bottom,
    // so play order = reveal order) and everything else in LOOK; the rest is
    // discarded, then both found Actions play with 'play'-tagged moves that
    // cost no Action and fire every on-play ability (register).
    brew(kit.cardDef(IDS.Golem, 'Golem', 4, 0, 0,
      'Costs 1 Potion. Reveal cards from your deck until you reveal 2 Action cards other than Golems. Discard the other cards, then play the Action cards in either order.', [
        kit.onPlay('dom_ab_golem', 'It obeys', [
          setVar(SCRATCH, num(0), OWNER),
          {
            kind: 'repeatWhile',
            cond: allOf(
              eq(getVar(SCRATCH, OWNER), num(0)),
              lt(zoneCount(zone(GOLEM_ZONE)), num(2)),
            ),
            body: [
              refillDeck(kit, OWNER),
              iff(eq(zoneCount(zone(DECK, OWNER)), num(0)), [
                announce(OWNER, ' runs out of cards to reveal.'),
                setVar(SCRATCH, num(1), OWNER),
              ], [
                announce(OWNER, ' reveals ', topCard(zone(DECK, OWNER)), '.'),
                iff(allOf(
                  kit.isA(topCard(zone(DECK, OWNER)), kit.types.ACTION),
                  neq(field(topCard(zone(DECK, OWNER)), 'name'), str('Golem')),
                ), [
                  move(topN(1), zone(DECK, OWNER), zone(GOLEM_ZONE),
                    { toPosition: 'bottom', faceUp: true }),
                ], [
                  move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: true }),
                ]),
              ]),
            ],
          } as Block,
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            announce(OWNER, ' discards the other revealed cards.'),
            kit.tmove(ALL, zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
          ]),
          // Play the found Actions in reveal order — unrolled ×2 (no repeat).
          iff(gt(zoneCount(zone(GOLEM_ZONE)), num(0)), [
            announce(OWNER, "'s Golem plays ", topCard(zone(GOLEM_ZONE)), '.'),
            kit.tmove(specific(topCard(zone(GOLEM_ZONE))), zone(GOLEM_ZONE), zone(INPLAY, OWNER),
              'play', { faceUp: true }),
          ]),
          iff(gt(zoneCount(zone(GOLEM_ZONE)), num(0)), [
            announce(OWNER, "'s Golem plays ", topCard(zone(GOLEM_ZONE)), '.'),
            kit.tmove(specific(topCard(zone(GOLEM_ZONE))), zone(GOLEM_ZONE), zone(INPLAY, OWNER),
              'play', { faceUp: true }),
          ]),
        ]),
      ])),

    // APPRENTICE — +1 Action, mandatory trash (guarded), draws = PRINTED
    // coin cost, +2 when the card has a potion cost (register). Coin cost
    // only — no potion.
    kit.cardDef(IDS.Apprentice, 'Apprentice', 5, 0, 0,
      '+1 Action. Trash a card from your hand. +1 Card per 1 it costs. +2 Cards if it has a Potion in its cost.', [
        kit.onPlay('dom_ab_apprentice', 'Learning the trade', [
          changeVar(ACTIONS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Apprentice: trash a card from your hand',
            }),
            setVar(SCRATCH, field(CHOICE, COST), OWNER),
            iff(gt(field(CHOICE, COST_POTION), num(0)), [changeVar(SCRATCH, num(2), OWNER)]),
            announce(OWNER, ' trashes ', CHOICE, ' — the apprentice takes notes.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            kit.drawN(OWNER, getVar(SCRATCH, OWNER)),
          ], [announce(OWNER, ' has nothing to teach with.')]),
        ]),
      ]),
  ];
}

export const alchemy1e: ExpansionModule = {
  id: 'alchemy1e',
  setName: 'Alchemy',

  piles: [
    { name: 'Transmute', cost: 0, count: 10 },
    { name: 'Vineyard', cost: 0, count: 10 },
    { name: 'Apothecary', cost: 2, count: 10 },
    { name: 'Herbalist', cost: 2, count: 10 },
    { name: 'Scrying Pool', cost: 2, count: 10 },
    { name: 'University', cost: 2, count: 10 },
    { name: 'Alchemist', cost: 3, count: 10 },
    { name: 'Familiar', cost: 3, count: 10 },
    { name: "Philosopher's Stone", cost: 3, count: 10 },
    { name: 'Golem', cost: 4, count: 10 },
    { name: 'Apprentice', cost: 5, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Scrying Pool', 'Familiar'],
  victoryNames: ['Vineyard'],
  treasureNames: ["Philosopher's Stone"],

  zones: [
    {
      id: GOLEM_ZONE, name: 'Golem',
      owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
    },
  ] as ZoneDef[],

  buildCards,

  buildVpTerms(kit: CardKit): Block[] {
    // Vineyard: 1 VP per FULL 3 Action cards owned per Vineyard ($player is
    // bound by the recount's forEachPlayer). Owned = the core five zones
    // (Marchland's precedent, minus other modules' mats). Fresh nodes per
    // use — the def is keeper-editable stored data.
    const owned = [
      kit.zones.DECK, kit.zones.HAND, kit.zones.DISCARD, kit.zones.INPLAY, kit.zones.DURATION,
    ];
    const ownedCount = (filter: Expr): Expr => owned
      .map((z) => countCards(zone(z, kit.PLAYER), filter))
      .reduce((a, b) => add(a, b));
    const actions = (): Expr => ownedCount(kit.isA(kit.CARD, kit.types.ACTION));
    const vineyards = (): Expr => ownedCount(kit.nameIs('Vineyard'));
    return [
      // Gated on owning one, so the every-gain recount stays cheap when the
      // card is not in the game (Fairgrounds' precedent). floor(a / 3) as
      // (a - a % 3) / 3 — exact integer math.
      iff(gt(vineyards(), num(0)), [
        changeVar(kit.vars.VP,
          mul(vineyards(), kit.div(sub(actions(), kit.mod(actions(), num(3))), num(3))),
          kit.PLAYER),
      ]),
    ];
  },
};
