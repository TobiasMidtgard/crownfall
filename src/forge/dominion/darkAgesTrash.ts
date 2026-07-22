/**
 * Dark Ages (the trash half) — Altar, Bandit Camp, Cultist, Fortress,
 * Ironmonger, Junk Dealer, Procession, Rats (the famous 20-card pile). All
 * printed texts verified against the UltraBoardGames Dark Ages card list and
 * the Dominion Strategy card list (the wiki proper is bot-walled);
 * Procession carries its official errata wording ("non-Duration").
 *
 * House idioms follow the earlier modules: the attack half (Cultist) is a
 * separate `stacked: true` ability gated per victim on IMMUNE == 0 (the
 * shared effectResolved trigger resets it), on-trash riders are
 * 'trash'-tagged cardEnterZone watchers (so they fire on trashes from
 * ANYWHERE — hand, deck, In Play), dug-through cards stage in the hidden
 * shared LOOK zone, and every mandatory choice is guarded so a session can
 * never hang.
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "each other player" is
 * the one opponent everywhere below.
 *
 * CROSS-MODULE CONTRACT (this wave's three siblings):
 *  - Agent A (darkAgesRuins) owns the Ruins cards + spawn and the shared
 *    Spoils stock. This module references BOTH by literal zone id only:
 *    Bandit Camp gains the top card of dom_zone_spoils, Cultist's victims
 *    gain the top card of dom_zone_ruins — each runtime-gated on the stock
 *    holding cards, so it whiffs politely (announced) while A is mid-flight.
 *    The merged def does NOT validate until A declares those zones — the
 *    test suite pushes zones-only stand-ins when nothing else declares them
 *    (the adventuresA / nocturneRest stub precedent).
 *  - Agent B (darkAgesKnights) owns the Knights side pile and the
 *    Madman/Mercenary stocks — nothing here touches them.
 *  - REGISTRATION ORDER: darkAgesTrash joins expansions.ts AFTER
 *    darkAgesRuins (A declares the zones this module's scripts reference).
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - ON-TRASH ATTRIBUTION (Cultist's +3 Cards, Rats' +1 Card, Fortress's
 *    return): the shared trash binds no owner (cardOwner reads the holding
 *    zone's owner — null in the trash; Goatherd / Haunted Mirror precedent),
 *    so the rider resolves for the CURRENT player. On-turn trashes (the
 *    overwhelming case — Chapel, Junk Dealer, Rats, Procession) attributes
 *    exactly; an OFF-turn trash (a sibling
 *    Knight trashing the victim's Fortress) would attribute to the turn
 *    player instead of the card's owner.
 *  - CULTIST: the "you may play a Cultist from your hand" offer rides the
 *    TAIL of the stacked attack's resolve script, so it comes after the
 *    Ruins are dealt (printed order); each chained Cultist opens its own
 *    response window (Black Cat's chained-window precedent). The chain play
 *    is free (a 'play'-tagged move spends no Action), as printed.
 *  - PROCESSION: "non-Duration" is a registry NAME list (no Duration tag
 *    exists — Duration-ness is behavioral, the Captain/Necromancer
 *    precedent). The trash is guarded on the played card still being IN
 *    PLAY: a card that moved itself away (Horse to its stock, a Reserve to
 *    the Tavern mat, a self-trasher already in the trash) is NOT trashed
 *    and the gain still happens — the official lose-track ruling, and the
 *    printed Procession+Horse combo works exactly. "Exactly $1 more"
 *    compares PRINTED costs: the global DISCOUNT (Bridge/Quarry) lowers
 *    both sides equally, so the comparison is discount-invariant. A
 *    Procession-played attack resolves its stacked half after the whole
 *    Procession script (trash + gain) — this table's standing stack timing.
 *  - RATS: "(or reveal a hand of all Rats)" is an announcement (Shanty
 *    Town's idiom — no private-reveal primitive). The gained Rats comes off
 *    the SUPPLY pile, guarded, so a Rats played while its pile is empty (or
 *    absent) multiplies no further, announced.
 *  - IRONMONGER: the reveal stages through the shared LOOK zone with public
 *    announces. The Action/Treasure bonuses are granted BEFORE the discard
 *    decision (pure counter grants — order-invariant); the Victory card's
 *    +1 Card is DEFERRED until the revealed card is discarded or put back,
 *    so a kept Victory card is drawn by its own bonus (printed timing).
 *    "Victory card" = Victory-typed OR printed VP > 0 (the dual test —
 *    Groom's precedent), so a Harem grants both +$1 and +1 Card and a Mill
 *    grants both +1 Action and +1 Card, as printed. Curse is neither type,
 *    granting nothing — as printed.
 *  - ALTAR: the gain is unconditional — an empty hand skips only the trash
 *    (two independent printed sentences, the official ruling).
 *  - FORTRESS: "put it into your hand" is the 'trash'-tag watcher marching
 *    the card back out of the trash (untagged move — returning is no listed
 *    cause, so no gain/discard watcher mistakes it). The trash itself DID
 *    happen: every other on-trash watcher (Goatherd's counter, agent A's
 *    Market Square…) still sees the 'trash'-tagged move, as printed.
 */
import type {
  Block, CardDef, Expr, TriggerDef, VariableDef,
} from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, anyOf, bestCard, cardZoneId, changeVar, chooseCard,
  chooseCardsBlock, countCards, eq, field, forEachCard, forEachOpponent, getVar, gt, iff, move,
  neq, num, setVar, shuffle, specific, str, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Altar: 'dom_card_altar',
  'Bandit Camp': 'dom_card_bandit_camp',
  Cultist: 'dom_card_cultist',
  Fortress: 'dom_card_fortress',
  Ironmonger: 'dom_card_ironmonger',
  'Junk Dealer': 'dom_card_junk_dealer',
  Procession: 'dom_card_procession',
  Rats: 'dom_card_rats',
};

/**
 * AGENT A's stocks (darkAgesRuins) — referenced by literal id only (see the
 * contract note in the header). The merged def needs A registered first.
 */
export const SPOILS_ZONE = 'dom_zone_spoils';
export const RUINS_ZONE = 'dom_zone_ruins';

/** Procession's exact-cost stash (a filter's $card rebinding would lose the
 *  trashed card's cost — Remodel's SCRATCH idiom, but module-private so a
 *  doubled Cellar/Remodel can never clobber it; written AFTER the double
 *  play so even a nested Procession resolves first). */
export const DAT_COST_VAR = 'dom_var_dat_cost';
/** Ironmonger's deferred Victory draw flag (the +1 Card waits until the
 *  revealed card is discarded or put back — printed timing). */
export const DAT_FLAG_VAR = 'dom_var_dat_flag';

/**
 * Names Procession must never play — the registry's Action-typed DURATION
 * cards (printed "non-Duration"; Duration-ness is behavioral, so a name
 * list is the Captain/Necromancer precedent — keep in sync with
 * nocturneRest.NECROMANCER_EXCLUDED's Duration entries). Treasure/Night-
 * typed Durations (Astrolabe, the Night-Durations) are already excluded by
 * the Action-type filter. Unlike Necromancer, self-movers (Horse, Island,
 * the Reserves) STAY playable here: Procession's trash is guarded on the
 * card still being in play, so their self-moves are safe and the printed
 * combos work.
 */
export const PROCESSION_EXCLUDED: string[] = [
  // Seaside 2E.
  'Haven', 'Lighthouse', 'Fishing Village', 'Caravan', 'Merchant Ship', 'Wharf',
  'Monkey', 'Blockade', 'Corsair', 'Pirate', 'Sea Witch',
  'Sailor', 'Tide Pools', 'Tactician',
  // Promos.
  'Church', 'Captain',
  // Adventures part B.
  'Amulet', 'Caravan Guard', 'Dungeon', 'Gear', 'Bridge Troll',
  'Haunted Woods', 'Swamp Hag', 'Hireling',
  // Menagerie.
  'Village Green', 'Barge', 'Gatekeeper', 'Mastermind',
  // Renaissance.
  'Cargo Ship', 'Research',
  // Nocturne (the Action–Duration cave; Night cards are Night-typed).
  'Secret Cave',
];

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

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK } = kit.zones;
  const { ACTIONS, COINS, IMMUNE } = kit.vars;
  const { COST, VP_F } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER } = kit;
  const { nameIs } = kit;

  /** "Is a Victory card" in the one-primary-type world (see the register):
   *  Victory-typed OR printed VP > 0 (catches Mill/Harem-style duals). */
  const victoryCard = (): Expr => anyOf(
    kit.isA(CARD, kit.types.VICTORY),
    gt(field(CARD, VP_F), num(0)),
  );

  /** Procession's target filter (fresh nodes per call — the def is stored
   *  data, scripts must not share mutable block objects). */
  const processionFilter = (): Expr => allOf(
    kit.IS_ACTION_CARD,
    ...PROCESSION_EXCLUDED.map((n) => neq(field(CARD, 'name'), str(n))),
  );

  /** Procession's gain filter: an Action at EXACTLY the stashed printed
   *  cost (discount-invariant — see the register). Fresh nodes per call. */
  const processionGain = (): Expr => allOf(
    kit.IS_ACTION_CARD,
    eq(field(CARD, COST), getVar(DAT_COST_VAR, OWNER)),
  );

  /** "A card other than a Rats" (fresh nodes per call). */
  const nonRats = (): Expr => neq(field(CARD, 'name'), str('Rats'));

  return [
    // ------------------------------------------------------------------- Altar
    // ALTAR — the trash is mandatory but guarded; the gain is unconditional
    // (two independent printed sentences — register).
    kit.cardDef(IDS.Altar, 'Altar', 6, 0, 0,
      'Trash a card from your hand. Gain a card costing up to $5.', [
        kit.onPlay('dom_ab_altar', 'An offering is demanded', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Altar: trash a card from your hand',
            }),
            announce(OWNER, ' offers ', CHOICE, ' at the Altar.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
          ], [announce(OWNER, ' has nothing to offer — the Altar still provides.')]),
          ...kit.gainFromSupply({
            limit: num(5),
            prompt: 'Altar: gain a card costing up to $5',
            whiff: [announce('Nothing in the supply costs up to $5 — the Altar stays silent.')],
          }),
        ]),
      ]),

    // ------------------------------------------------------------- Bandit Camp
    // BANDIT CAMP — exact; the Spoils comes off agent A's shared stock,
    // runtime-gated (register).
    kit.cardDef(IDS['Bandit Camp'], 'Bandit Camp', 5, 0, 0,
      '+1 Card. +2 Actions. Gain a Spoils from the Spoils pile.', [
        kit.onPlay('dom_ab_bandit_camp', 'Divide the loot', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
          iff(gt(zoneCount(zone(SPOILS_ZONE)), num(0)), [
            announce(OWNER, ' gains a Spoils.'),
            kit.tmove(topN(1), zone(SPOILS_ZONE), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
          ], [announce('The Spoils are spent — the camp stands empty-handed.')]),
        ]),
      ]),

    // ----------------------------------------------------------------- Cultist
    // CULTIST — Action – Attack – Looter (Looter is a display rider in the
    // one-primary-type world). Draw inline; the attack half is stacked with
    // the chain offer at its tail (printed order — register). The on-trash
    // +3 Cards is the buildTriggers watcher.
    kit.cardDef(IDS.Cultist, 'Cultist', 5, 0, 0,
      '+2 Cards. Each other player gains a Ruins. You may play a Cultist from your hand. When you trash this, +3 Cards.', [
        kit.onPlay('dom_ab_cultist_draw', 'Whispers in the dark', [
          kit.draw(OWNER, 2),
        ]),
        kit.onPlay('dom_ab_cultist_attack', 'The circle chants', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(gt(zoneCount(zone(RUINS_ZONE)), num(0)), [
                announce(PLAYER, ' gains a Ruins.'),
                kit.tmove(topN(1), zone(RUINS_ZONE), zone(DISCARD, PLAYER), 'gain', { faceUp: true }),
              ], [announce('The Ruins are exhausted — nothing left to inflict.')]),
            ]),
          ]),
          // The chain: after the Ruins are dealt, the owner may play another
          // Cultist from hand, free (its own attack opens a fresh window).
          iff(gt(countCards(zone(HAND, OWNER), nameIs('Cultist')), num(0)), [
            yesNo(OWNER, 'Cultist: play another Cultist from your hand? (It costs no Action.)'),
            iff(CHOICE, [
              announce(OWNER, ' lets another Cultist join the chant.'),
              kit.tmove(
                specific(bestCard(zone(HAND, OWNER), 'highest', COST, nameIs('Cultist'))),
                zone(HAND, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true },
              ),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // ---------------------------------------------------------------- Fortress
    // FORTRESS — the play half is exact; the trashed-but-returns rider is
    // the buildTriggers watcher (register).
    kit.cardDef(IDS.Fortress, 'Fortress', 4, 0, 0,
      '+1 Card. +2 Actions. When you trash this, put it into your hand.', [
        kit.onPlay('dom_ab_fortress', 'Walls that hold', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
        ]),
      ]),

    // -------------------------------------------------------------- Ironmonger
    // IRONMONGER — the reveal stages through LOOK; Action/Treasure bonuses
    // land immediately, the Victory draw waits for the discard-or-back
    // decision so a kept Victory card is drawn by its own bonus (register).
    kit.cardDef(IDS.Ironmonger, 'Ironmonger', 4, 0, 0,
      '+1 Card. +1 Action. Reveal the top card of your deck; you may discard it. Either way, if it is an Action card, +1 Action; Treasure card, +$1; Victory card, +1 Card.', [
        kit.onPlay('dom_ab_ironmonger', 'Sorting the stock', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          setVar(DAT_FLAG_VAR, num(0), OWNER),
          refillDeck(kit, OWNER),
          iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
            move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: true }),
            forEachCard(zone(LOOK), null, [
              announce(OWNER, ' reveals ', CARD, ' off their deck.'),
              iff(kit.isA(CARD, kit.types.ACTION), [
                announce(OWNER, ' finds an Action: +1 Action.'),
                changeVar(ACTIONS, num(1), OWNER),
              ]),
              iff(kit.isA(CARD, kit.types.TREASURE), [
                announce(OWNER, ' finds a Treasure: +$1.'),
                changeVar(COINS, num(1), OWNER),
              ]),
              iff(victoryCard(), [
                announce(OWNER, ' finds a Victory card: +1 Card (after deciding).'),
                setVar(DAT_FLAG_VAR, num(1), OWNER),
              ]),
            ]),
            chooseCardsBlock({
              who: OWNER, from: zone(LOOK), min: num(0), max: num(1), revealed: true,
              prompt: 'Ironmonger: discard the revealed card? (Leave it unpicked to put it back.)',
              body: [
                announce(OWNER, ' discards the revealed ', CARD, '.'),
                kit.tmove(specific(CARD), zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ],
            }),
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
            ]),
            iff(eq(getVar(DAT_FLAG_VAR, OWNER), num(1)), [
              kit.draw(OWNER, 1),
              setVar(DAT_FLAG_VAR, num(0), OWNER),
            ]),
          ], [announce(OWNER, ' has no deck left to reveal from.')]),
        ]),
      ]),

    // ------------------------------------------------------------- Junk Dealer
    // JUNK DEALER — exact; the trash is mandatory, guarded.
    kit.cardDef(IDS['Junk Dealer'], 'Junk Dealer', 5, 0, 0,
      '+1 Card. +1 Action. +$1. Trash a card from your hand.', [
        kit.onPlay('dom_ab_junk_dealer', 'Everything has a price', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(COINS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Junk Dealer: trash a card from your hand',
            }),
            announce(OWNER, ' junks ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
          ], [announce(OWNER, ' has no junk left to deal.')]),
        ]),
      ]),

    // -------------------------------------------------------------- Procession
    // PROCESSION — errata wording ("non-Duration", the name list); the
    // double play rides the Throne Room mechanism, the trash is guarded on
    // the card still being in play, and the gain compares printed costs
    // exactly (all three in the register).
    kit.cardDef(IDS.Procession, 'Procession', 4, 0, 0,
      'You may play a non-Duration Action card from your hand twice. Trash it. Gain an Action card costing exactly $1 more than it.', [
        kit.onPlay('dom_ab_procession', 'March it to its end', [
          iff(gt(countCards(zone(HAND, OWNER), processionFilter()), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: processionFilter(),
              min: num(0), max: num(1),
              prompt: 'Procession: you may play a non-Duration Action twice — it is then trashed for an upgrade',
              body: [
                announce(OWNER, ' plays ', CARD, ' twice in the procession.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
                kit.playAgain(CARD),
                // The stash is written AFTER the plays (a nested Procession
                // has fully resolved by now) and read straight away.
                setVar(DAT_COST_VAR, add(field(CARD, COST), num(1)), OWNER),
                iff(eq(cardZoneId(CARD), str(INPLAY)), [
                  announce(OWNER, "'s procession trashes ", CARD, '.'),
                  kit.tmove(specific(CARD), zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true }),
                ], [announce('The card moved on — the procession cannot trash it (the gain still comes).')]),
                iff(gt(countCards(zone(SUPPLY), processionGain()), num(0)), [
                  kit.choosePileBlock({
                    who: OWNER, from: zone(SUPPLY), filter: processionGain(),
                    prompt: 'Procession: gain an Action costing exactly $1 more than the played card',
                    body: [
                      announce(OWNER, ' gains ', CARD, '.'),
                      kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                    ],
                  }),
                ], [announce('No Action in the supply costs exactly $1 more — nothing gained.')]),
              ],
            }),
          ], [announce(OWNER, ' has no Action fit for the procession.')]),
        ]),
      ]),

    // -------------------------------------------------------------------- Rats
    // RATS — the 20-card pile (piles spec). Gain guarded on the supply pile;
    // the trash filter excludes Rats; the all-Rats hand is an announcement
    // (register). The on-trash +1 Card is the buildTriggers watcher.
    kit.cardDef(IDS.Rats, 'Rats', 4, 0, 0,
      '+1 Card. +1 Action. Gain a Rats. Trash a card from your hand other than a Rats (or reveal a hand of all Rats). When you trash this, +1 Card.', [
        kit.onPlay('dom_ab_rats', 'They multiply', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          iff(gt(countCards(zone(SUPPLY), nameIs('Rats')), num(0)), [
            announce(OWNER, ' gains a Rats.'),
            kit.tmove(
              specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Rats'))),
              zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
            ),
          ], [announce('The Rats pile is empty — they can multiply no further.')]),
          iff(gt(countCards(zone(HAND, OWNER), nonRats()), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER), filter: nonRats(),
              prompt: 'Rats: trash a card from your hand other than a Rats',
            }),
            announce(OWNER, "'s Rats gnaw ", CHOICE, ' to shreds.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
          ], [announce(OWNER, ' reveals a hand of all Rats — nothing else to trash.')]),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { TRASH, HAND } = kit.zones;
  const { CARD } = kit;

  // Fresh nodes per trigger — triggers must not share mutable block objects
  // (the def is keeper-editable stored data). All three watchers key on the
  // 'trash' cause tag with zoneId null, so they fire on trashes from ANY
  // zone (hand, deck top, In Play); the cardZoneId guard skips copies whose
  // move was redirected before arrival. Attribution goes to the CURRENT
  // player (the shared trash binds no owner — register).

  return [
    // CULTIST trashed: +3 Cards.
    {
      id: 'dom_trigger_dat_cultist_trash',
      name: 'Cultist: trashed — +3 Cards',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'trash' },
      condition: kit.nameIs('Cultist'),
      script: [
        iff(eq(cardZoneId(CARD), str(TRASH)), [
          announce(CURRENT, ' draws 3 cards for the fallen Cultist.'),
          kit.drawN(CURRENT, num(3)),
        ]),
      ],
    },

    // FORTRESS trashed: it marches back to the hand (untagged — returning
    // is no listed cause; the trash itself already happened and every other
    // trash watcher has its event).
    {
      id: 'dom_trigger_dat_fortress_trash',
      name: 'Fortress: trashed — it returns to hand',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'trash' },
      condition: kit.nameIs('Fortress'),
      script: [
        iff(eq(cardZoneId(CARD), str(TRASH)), [
          announce('The Fortress stands — it returns to ', CURRENT, "'s hand."),
          move(specific(CARD), zone(TRASH), zone(HAND, CURRENT), { faceUp: true }),
        ]),
      ],
    },

    // RATS trashed: +1 Card.
    {
      id: 'dom_trigger_dat_rats_trash',
      name: 'Rats: trashed — +1 Card',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'trash' },
      condition: kit.nameIs('Rats'),
      script: [
        iff(eq(cardZoneId(CARD), str(TRASH)), [
          announce(CURRENT, ' draws a card for the trashed Rats.'),
          kit.drawN(CURRENT, num(1)),
        ]),
      ],
    },
  ];
}

export const darkAgesTrash: ExpansionModule = {
  id: 'darkAgesTrash',
  setName: 'Dark Ages',

  piles: [
    { name: 'Fortress', cost: 4, count: 10 },
    { name: 'Ironmonger', cost: 4, count: 10 },
    { name: 'Procession', cost: 4, count: 10 },
    // The printed Rats pile holds 20 copies regardless of player count.
    { name: 'Rats', cost: 4, count: 20 },
    { name: 'Bandit Camp', cost: 5, count: 10 },
    { name: 'Cultist', cost: 5, count: 10 },
    { name: 'Junk Dealer', cost: 5, count: 10 },
    { name: 'Altar', cost: 6, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Cultist'],

  variables: [
    {
      id: DAT_COST_VAR, name: 'Dark Ages (trash): cost stash',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: DAT_FLAG_VAR, name: 'Dark Ages (trash): deferred draw flag',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  buildCards,
  buildTriggers,
};
