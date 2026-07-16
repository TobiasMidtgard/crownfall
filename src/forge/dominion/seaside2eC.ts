/**
 * Seaside 2E (part C) — Native Village, Island, Salvager, Sailor, Tide Pools,
 * Treasure Map, Tactician, Treasury.
 *
 * Deviation register (each also noted at its card):
 *  - Island is officially Action–Victory; a card here has ONE primary type
 *    and Victory-typed cards can never be played (dom_action_play's legality
 *    is Action-typed and phases only offer their listed actions), so Island
 *    follows Mill's precedent: Action-TYPED with printed VP 2. It is
 *    deliberately NOT in victoryNames — the owned-zone recount and the mat
 *    term in buildVpTerms both sum the VP field, so it scores 2 wherever it
 *    sits. Flag for the integrator: the task sheet asked for
 *    victoryNames: ['Island'], which would make the card unplayable.
 *  - Island mat cards stay on the mat for good (no game-end return move);
 *    the recount reads the mat directly, which scores identically.
 *  - Treasure Map auto-picks the second Map to trash (all copies are
 *    identical — no choice is surfaced). "Trash this" is guarded on the card
 *    still being in play, so a Throne-Roomed replay can trash a further hand
 *    Map but can never reach 2 trashes in one resolution again — exactly one
 *    4-Gold payout per pair, matching the printed ruling.
 *  - Treasury's return is AUTOMATIC (the printed "may" offers no choice
 *    here): a phaseStart-of-cleanup ability, live while Treasury is in
 *    In Play, hops it onto the deck unless its owner bought a Victory-TYPED
 *    card this turn — it is then drawn back with the cleanup redraw, the
 *    printed timing's usual outcome. "Bought" = any 'buy'-tagged move (the
 *    buy action and the Black Market), tracked by a hidden per-player flag
 *    reset in buildCleanupResets. Printed-VP Action duals (Mill, Island) are
 *    not Victory-typed and do NOT block the return — a knock-on of the
 *    one-primary-type world.
 *  - Salvager pays the PRINTED cost of the trashed card (a live Bridge
 *    discount is ignored; the official card uses the current cost).
 *  - Sailor is simplified to spec: now +1 Action; next turn +$2 and you may
 *    trash a card from your hand. The printed on-gain half ("once this turn,
 *    you may play a Duration card when you gain it") is omitted — the engine
 *    has no on-gain play hook.
 *  - Tactician only discards-and-parks with at least 1 card in hand (the
 *    printed rule): the hand size is stashed in SCRATCH before the discard
 *    and the durationPair park move is re-wrapped in that guard, so an
 *    empty-hand play does nothing and is cleaned up normally (no next-turn
 *    bonus).
 *  - 2-player table: none of these cards reference left/right neighbours, so
 *    no seat-order approximations were needed.
 *
 * CORE BUG WORKED AROUND (integrator: consider fixing kit.durationPair):
 * the shipped durationPair tags the later-half's march back to In Play
 * 'play', and its now-half ability (enterZone In Play with NO tag filter)
 * re-fires on that very move — the duration re-runs `now`, re-parks, and
 * loops one full cycle per turn forever. This module builds its Duration
 * halves with a local clone (durationHalves below) whose now-half only
 * fires on 'play'-tagged entries and whose march back is tagged 'return'.
 * Same contract otherwise; swap back to kit.durationPair once fixed.
 */
import type {
  AbilityDef, Block, CardDef, Expr, TriggerDef, VariableDef, ZoneDef,
} from '../../shared/types';
import {
  ALL, CURRENT, allOf, announce, bestCard, bnd, cardZoneId, changeVar, chooseCard,
  chooseCardsBlock, chooseOption, countCards, eq, field, forEachPlayer, getVar, gt, iff, lt, num,
  setVar, shuffle, specific, str, topCard, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  'Native Village': 'dom_card_native_village',
  Island: 'dom_card_island',
  Salvager: 'dom_card_salvager',
  Sailor: 'dom_card_sailor',
  'Tide Pools': 'dom_card_tide_pools',
  'Treasure Map': 'dom_card_treasure_map',
  Tactician: 'dom_card_tactician',
  Treasury: 'dom_card_treasury',
};

/** The Island mat — set-aside cards score via buildVpTerms at every recount. */
export const ISLAND_ZONE = 'dom_zone_island';
/** The Native Village mat — face-down stash only its owner may see. */
export const NATIVE_VILLAGE_ZONE = 'dom_zone_native_village';
/** Treasury's flag: this player bought a Victory-typed card this turn. */
export const BOUGHT_VICTORY_VAR = 'dom_var_bought_victory';

/**
 * Core phase ids — stable dominionGame.ts literals. The kit exposes no phase
 * ids; the core durationPair hardcodes the action phase the same way.
 */
const PHASE_ACTION = 'dom_phase_action';
const PHASE_CLEANUP = 'dom_phase_cleanup';

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, DURATION } = kit.zones;
  const { ACTIONS, BUYS, COINS, SCRATCH } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE, SELF } = kit;

  /** Empty deck → flip the discard in face-down and shuffle (paper reshuffle). */
  const reshuffleIfEmpty = (owner: Expr): Block =>
    iff(eq(zoneCount(zone(DECK, owner)), num(0)), [
      kit.tmove(ALL, zone(DISCARD, owner), zone(DECK, owner), 'reshuffle', { faceUp: false }),
      shuffle(zone(DECK, owner)),
    ]);

  /**
   * LOCAL CLONE of kit.durationPair — see the CORE BUG note in the header:
   * the now-half fires only on 'play'-tagged In-Play entries (real plays and
   * Throne Room's synthetic re-play), so the later-half's march back (tagged
   * 'return') cannot re-trigger it. Contract otherwise identical.
   */
  const durationHalves = (
    idBase: string, name: string, now: Block[], later: Block[],
  ): AbilityDef[] => [
    {
      id: `${idBase}_now`, name: `${name} — now`,
      on: 'enterZone', zoneId: INPLAY, phaseId: null, tagFilter: 'play',
      condition: null,
      script: [
        ...now,
        // A Throne-Roomed re-play re-runs `now` while the card already sits
        // in DURATION — the specific-move then finds nothing in In Play and
        // whiffs, so the card parks exactly once (later fires once).
        kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(DURATION, OWNER), 'play',
          { faceUp: true }),
      ],
    },
    {
      id: `${idBase}_later`, name: `${name} — next turn`,
      on: 'phaseStart', zoneId: DURATION, phaseId: PHASE_ACTION,
      condition: eq(CURRENT, OWNER),
      script: [
        announce(OWNER, "'s ", SELF, ' resolves.'),
        ...later,
        kit.tmove(specific(SELF), zone(DURATION, OWNER), zone(INPLAY, OWNER), 'return',
          { faceUp: true }),
      ],
    },
  ];

  // --- Tactician (Duration) ----------------------------------------------
  // The hand size rides SCRATCH so the park can be made conditional: with an
  // empty hand the card does nothing, does NOT park, and is swept at cleanup
  // (so its next-turn half never fires — it only lives in the DURATION zone).
  const tactician = durationHalves('dom_ab_tactician', 'Tactician', [
    setVar(SCRATCH, zoneCount(zone(HAND, OWNER)), OWNER),
    iff(gt(getVar(SCRATCH, OWNER), num(0)), [
      announce(OWNER, ' discards their whole hand to the Tactician.'),
      kit.tmove(ALL, zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
    ], [
      announce(OWNER, "'s Tactician finds an empty hand — nothing happens."),
    ]),
  ], [
    kit.draw(OWNER, 5),
    changeVar(BUYS, num(1), OWNER),
    changeVar(ACTIONS, num(1), OWNER),
  ]);
  // durationHalves appends the park move LAST in the now-half; re-wrap it in
  // the SCRATCH guard taken above (a Throne-Roomed replay sees an already
  // emptied hand — SCRATCH 0 — and the specific-move would whiff anyway).
  const tacticianPark = tactician[0].script.pop() as Block;
  tactician[0].script.push(iff(gt(getVar(SCRATCH, OWNER), num(0)), [tacticianPark]));

  // --- Treasury's cleanup return (automatic — see the deviation register) --
  const treasuryReturn: AbilityDef = {
    id: 'dom_ab_treasury_return',
    name: 'Treasury returns to the deck',
    on: 'phaseStart',
    zoneId: INPLAY,
    phaseId: PHASE_CLEANUP,
    // Fires at the START of the owner's cleanup phase, BEFORE the sweep and
    // the redraw — so the topdecked Treasury is drawn straight back into the
    // next hand, the printed timing's usual outcome. The flag is still live
    // here (buildCleanupResets clears it inside the cleanup action itself).
    condition: allOf(
      eq(CURRENT, OWNER),
      eq(getVar(BOUGHT_VICTORY_VAR, OWNER), num(0)),
    ),
    script: [
      announce(OWNER, "'s Treasury slips back onto their deck."),
      kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(DECK, OWNER), 'topdeck',
        { toPosition: 'top', faceUp: false }),
    ],
  };

  return [
    kit.cardDef(IDS['Native Village'], 'Native Village', 2, 0, 0,
      '+2 Actions. Choose one: put the top card of your deck face down on your '
      + 'Native Village mat; or put all the cards from your mat into your hand.', [
        kit.onPlay('dom_ab_native_village', 'The village hoard', [
          changeVar(ACTIONS, num(2), OWNER),
          chooseOption('Native Village: choose one', [
            { id: 'nv_stash', label: 'Put the top card of your deck onto your mat (face down)' },
            { id: 'nv_take', label: 'Put all the cards from your mat into your hand' },
          ], OWNER),
          iff(eq(CHOICE, str('nv_stash')), [
            // Paper reshuffle first; an exhausted deck+discard just whiffs.
            reshuffleIfEmpty(OWNER),
            iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
              announce(OWNER, ' tucks the top card of their deck onto the Native Village mat.'),
              kit.tmove(specific(topCard(zone(DECK, OWNER))), zone(DECK, OWNER),
                zone(NATIVE_VILLAGE_ZONE, OWNER), 'mat', { faceUp: false }),
            ], [announce(OWNER, ' has no card left to set aside.')]),
          ], [
            announce(OWNER, ' scoops the Native Village mat into their hand.'),
            kit.tmove(ALL, zone(NATIVE_VILLAGE_ZONE, OWNER), zone(HAND, OWNER), 'mat', { faceUp: true }),
          ]),
        ]),
      ]),

    // DEVIATION (Island): Action-typed with printed VP 2 (see the register);
    // the mat and the card score through the VP field at every recount.
    kit.cardDef(IDS.Island, 'Island', 4, 0, 2,
      'Put this and a card from your hand onto your Island mat. Worth 2 VP.', [
        kit.onPlay('dom_ab_island', 'Retreat to the island', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Island: put a card from your hand onto your Island mat',
            }),
            announce(OWNER, ' sets aside ', CHOICE, ' on their Island mat.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(ISLAND_ZONE, OWNER), 'mat',
              { faceUp: true }),
          ], [announce(OWNER, ' has no card to bring along — the Island alone is set aside.')]),
          // Island itself parks on the mat. A Throne-Roomed replay finds it
          // already there and the specific-move whiffs (one park, two picks).
          kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(ISLAND_ZONE, OWNER), 'mat',
            { faceUp: true }),
        ]),
      ]),

    // DEVIATION (Salvager): pays the PRINTED cost — a live Bridge discount
    // is ignored (the official card reads the current cost).
    kit.cardDef(IDS.Salvager, 'Salvager', 4, 0, 0,
      '+1 Buy. Trash a card from your hand. +$ equal to its cost.', [
        kit.onPlay('dom_ab_salvager', 'Stripped for parts', [
          changeVar(BUYS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Salvager: trash a card from your hand for its cost in coin',
            }),
            // Stash the printed cost BEFORE the move (belt and braces against
            // later $card/context rebinding idioms).
            setVar(SCRATCH, field(CHOICE, COST), OWNER),
            announce(OWNER, ' trashes ', CHOICE, ' and salvages its cost in coin.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            changeVar(COINS, getVar(SCRATCH, OWNER), OWNER),
          ], [announce(OWNER, ' has nothing to salvage.')]),
        ]),
      ]),

    // DEVIATION (Sailor): simplified — now +1 Action; next turn +$2 and you
    // may trash a card from your hand. The printed on-gain play half is
    // omitted (no on-gain play hook in the engine).
    kit.cardDef(IDS.Sailor, 'Sailor', 4, 0, 0,
      '+1 Action. At the start of your next turn, +$2 and you may trash a card from your hand.',
      durationHalves('dom_ab_sailor', 'Sailor', [
        changeVar(ACTIONS, num(1), OWNER),
      ], [
        changeVar(COINS, num(2), OWNER),
        iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
          chooseCardsBlock({
            who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(1),
            prompt: 'Sailor: you may trash a card from your hand',
            body: [
              announce(OWNER, ' trashes ', CARD, '.'),
              kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            ],
          }),
        ]),
      ])),

    kit.cardDef(IDS['Tide Pools'], 'Tide Pools', 4, 0, 0,
      '+3 Cards. +1 Action. At the start of your next turn, discard 2 cards.',
      durationHalves('dom_ab_tide_pools', 'Tide Pools', [
        kit.draw(OWNER, 3),
        changeVar(ACTIONS, num(1), OWNER),
      ], [
        // Discard exactly 2, clamped to the hand when it holds fewer
        // (Steward's idiom — SCRATCH carries the clamp, the max stays 2).
        setVar(SCRATCH, num(2), OWNER),
        iff(lt(zoneCount(zone(HAND, OWNER)), num(2)), [
          setVar(SCRATCH, zoneCount(zone(HAND, OWNER)), OWNER),
        ]),
        iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
          chooseCardsBlock({
            who: OWNER, from: zone(HAND, OWNER),
            min: getVar(SCRATCH, OWNER), max: num(2),
            prompt: 'Tide Pools: discard 2 cards',
            body: [
              announce(OWNER, ' discards ', CARD, '.'),
              kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
            ],
          }),
        ]),
      ])),

    // DEVIATION (Treasure Map): the second Map is auto-picked (all copies
    // identical); see the register for the Throne Room ruling.
    kit.cardDef(IDS['Treasure Map'], 'Treasure Map', 4, 0, 0,
      'Trash this and a Treasure Map from your hand. If you trashed 2 Treasure Maps, '
      + 'gain 4 Golds onto your deck.', [
        kit.onPlay('dom_ab_treasure_map', 'X marks the spot', [
          // SCRATCH counts the Maps trashed BY THIS RESOLUTION — reset first.
          setVar(SCRATCH, num(0), OWNER),
          iff(eq(cardZoneId(SELF), str(INPLAY)), [
            announce(OWNER, ' trashes Treasure Map.'),
            kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            changeVar(SCRATCH, num(1), OWNER),
          ]),
          iff(gt(countCards(zone(HAND, OWNER), kit.nameIs('Treasure Map')), num(0)), [
            announce(OWNER, ' trashes a Treasure Map from their hand.'),
            kit.tmove(
              specific(bestCard(zone(HAND, OWNER), 'highest', COST, kit.nameIs('Treasure Map'))),
              zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true },
            ),
            changeVar(SCRATCH, num(1), OWNER),
          ], [announce(OWNER, ' holds no second map — the treasure stays buried.')]),
          iff(eq(getVar(SCRATCH, OWNER), num(2)), [
            announce(OWNER, ' pieces the maps together — 4 Golds onto their deck!'),
            // Unrolled ×4: the def bans 'repeat' blocks (schema-v2 vocabulary).
            ...Array.from({ length: 4 }, () =>
              iff(gt(countCards(zone(SUPPLY), kit.nameIs('Gold')), num(0)), [
                kit.tmove(
                  specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Gold'))),
                  zone(SUPPLY), zone(DECK, OWNER), 'gain', { toPosition: 'top', faceUp: false },
                ),
              ], [announce('The supply is out of Gold.')])),
          ]),
        ]),
      ]),

    kit.cardDef(IDS.Tactician, 'Tactician', 5, 0, 0,
      'If you have at least one card in hand: discard your hand, and at the start '
      + 'of your next turn, +5 Cards, +1 Action and +1 Buy.',
      tactician),

    // DEVIATION (Treasury): automatic return — see the register.
    kit.cardDef(IDS.Treasury, 'Treasury', 5, 0, 0,
      '+1 Card. +1 Action. +$1. At the end of your turn, if you didn’t buy a '
      + 'Victory card, this goes back on top of your deck.', [
        kit.onPlay('dom_ab_treasury', 'The crown’s coffers', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(COINS, num(1), OWNER),
        ]),
        treasuryReturn,
      ]),
  ];
}

export const seaside2eC: ExpansionModule = {
  id: 'seaside2eC',
  setName: 'Seaside',
  piles: [
    { name: 'Native Village', cost: 2, count: 10 },
    { name: 'Island', cost: 4, count: 10 },
    { name: 'Salvager', cost: 4, count: 10 },
    { name: 'Sailor', cost: 4, count: 10 },
    { name: 'Tide Pools', cost: 4, count: 10 },
    { name: 'Treasure Map', cost: 4, count: 10 },
    { name: 'Tactician', cost: 5, count: 10 },
    { name: 'Treasury', cost: 5, count: 10 },
  ],
  ids: IDS,
  buildCards,
  // NOTE: Island is deliberately NOT in victoryNames — a Victory-typed card
  // can never be played here (see the deviation register at the top).

  variables: [
    {
      id: BOUGHT_VICTORY_VAR, name: 'Treasury: bought a Victory card this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  zones: [
    {
      id: ISLAND_ZONE, name: 'Island',
      owner: 'perPlayer', visibility: 'all', layout: 'row', area: 'player',
    },
    {
      id: NATIVE_VILLAGE_ZONE, name: 'Native Village',
      owner: 'perPlayer', visibility: 'owner', layout: 'row', area: 'player',
    },
  ] as ZoneDef[],

  buildTriggers(kit: CardKit): TriggerDef[] {
    return [
      // Any 'buy'-tagged arrival of a Victory-typed card raises the buyer's
      // flag ($owner = the destination zone's owner: the buyer's discard for
      // both the buy action and the Black Market). Read by Treasury's
      // phaseStart-of-cleanup return ability; reset in buildCleanupResets.
      {
        id: 'dom_trigger_treasury_victory_buy',
        name: 'Treasury: remember a bought Victory card',
        event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
        condition: kit.isA(kit.CARD, kit.types.VICTORY),
        script: [setVar(BOUGHT_VICTORY_VAR, num(1), bnd('$owner'))],
      },
    ];
  },

  buildVpTerms(kit: CardKit): Block[] {
    // Everything on the Island mat scores its printed VP field ($player is
    // bound by the recount's forEachPlayer): Island itself (2) plus whatever
    // it took along (an Estate keeps its 1, a Copper adds 0).
    return [
      changeVar(kit.vars.VP,
        kit.sumCards(zone(ISLAND_ZONE, kit.PLAYER), kit.fields.VP_F), kit.PLAYER),
    ];
  },

  buildCleanupResets(kit: CardKit): Block[] {
    // Safe ordering: Treasury's return already fired at the cleanup phase's
    // START; this reset runs inside the cleanup ACTION, after the decision.
    return [
      forEachPlayer([setVar(BOUGHT_VICTORY_VAR, num(0), kit.PLAYER)]),
    ];
  },
};
