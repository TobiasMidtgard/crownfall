/**
 * Renaissance (part A) — Border Guard, Ducat, Lackeys, Acting Troupe,
 * Cargo Ship, Experiment, Improve, Flag Bearer, Hideout, Inventor,
 * Mountain Village, Patron, Priest.
 *
 * The set's banked resources ARE the core banks: Villagers bank into the core
 * VILLAGERS variable (the core ships the "Spend a Villager" action-phase
 * action + status-strip button) and Coffers into COFFERS, exactly like
 * Guilds. House idioms follow the earlier modules: every mandatory choice is
 * guarded so a session can never hang, look-at effects stage through the
 * hidden shared LOOK zone, numbers that must survive a filter's $card
 * rebinding ride the per-player SCRATCH variable, and no card here is an
 * Attack (no stacked halves in this half of the set).
 *
 * ARTIFACTS (the set's pass-around markers): each Artifact is ONE global
 * string variable holding the current holder's player id ('' = unclaimed).
 * Taking one announces it and overwrites the variable — that IS the
 * pass-around (the previous holder simply stops matching). Effects gate on
 * eq(var, <player>). This module DECLARES ALL FIVE Renaissance artifact
 * variables so the sibling module renaissanceB only reads/writes them:
 *   - dom_var_artifact_flag    (Flag Bearer's Flag — used here)
 *   - dom_var_artifact_horn    (Border Guard's Horn — used here)
 *   - dom_var_artifact_lantern (Border Guard's Lantern — used here)
 *   - dom_var_artifact_key     (Treasurer's Key — renaissanceB)
 *   - dom_var_artifact_chest   (Swashbuckler's Treasure Chest — renaissanceB)
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - CARGO SHIP: built on kit.durationPair, so the ship ALWAYS parks in the
 *    DURATION zone and returns next turn — even when nothing was set aside
 *    (printed, an unused Cargo Ship would be discarded at cleanup). "Once
 *    this turn, when you gain a card" is a per-gain yes/no while the owner
 *    still has an unspent Cargo Ship watch; the set-aside card parks in the
 *    shared DURATION row wearing seaside2eA's Haven mark
 *    (dom_var_haven_aside) — the mark's exact meaning ("set aside as an
 *    inert card; back to the owner's hand at their next turn start") — so a
 *    set-aside Duration card can never misfire its own next-turn half. When
 *    a Haven and a Cargo Ship both hold cards, either retrieval may pick up
 *    the other's card; the net effect is identical (each returns one marked
 *    card to the same hand). A Throne-Roomed Cargo Ship watches two gains,
 *    as printed. The offer is withheld when the gained card was already
 *    trashed (a Watchtower answered first).
 *  - BORDER GUARD: exact for the reveal-2 (reveal-3 with the Lantern), the
 *    pick and the discard. Taking an Artifact requires the FULL reveal count
 *    (2, or 3 with the Lantern) all Actions — a short reveal off an
 *    exhausted deck never qualifies. The Lantern check reads the artifact
 *    var at play time.
 *  - HORN: printed, discarding a Border Guard from play lets you topdeck it
 *    BEFORE the cleanup redraw (you could draw it). Here the watcher fires
 *    on 'cleanup'-tagged discards out of In Play, and the engine drains
 *    events only after the whole cleanup script (sweep + redraw), so the
 *    Border Guard is topdecked AFTER the redraw: it sits on top of the deck
 *    for next turn instead. Once per turn via a per-player flag reset at
 *    cleanup (the reset runs before the drain, so the flag is fresh for each
 *    turn's discards). Mid-turn discards from play (rare) don't trigger it.
 *  - FLAG: "+1 Card when drawing your hand" is +1 draw appended to the
 *    holder's cleanup (they redraw 6 instead of 5) — the printed effect for
 *    the normal case. On TRASH the Flag goes to the CURRENT player (the
 *    trash event carries no per-player attribution for the shared trash
 *    zone); an opponent trashing their own Flag Bearer during your turn
 *    would misdirect it — rare, and gains attribute exactly.
 *  - PRIEST: the rest-of-turn "+$2 when you trash" is a per-player bonus
 *    counter paid by a 'trash' watcher to the CURRENT player (printed: "when
 *    YOU trash"; an opponent's own trash during your turn — e.g. answering a
 *    Bishop — would wrongly pay you; rare). The engine drains the trash
 *    event only after the Priest's script, when the new bonus is already
 *    banked, so the script pre-refunds the $2 its OWN trash would overpay —
 *    net exact for normal play. A Throne-Roomed Priest overpays $2 total
 *    (both trashes settle at the final bonus) — documented, not fixable at
 *    this timing.
 *  - PATRON: the printed reveal rider ("When something causes you to reveal
 *    this, +1 Coffers") is DROPPED — the engine has no reveal event; reveals
 *    are announces. The card keeps its printed text and Reaction tag (type
 *    line "Action – Reaction") for display; nothing here opens on it.
 *  - IMPROVE: fires at the START of the owner's Cleanup phase (the manual
 *    cleanup phase entry — Walled Village's window), when In Play holds
 *    exactly the cards that will be discarded this turn (played Durations
 *    parked at play time; returned ones are legally trashable, as per the
 *    printed "would discard from play this turn" errata). "Costing exactly
 *    $1 more" compares PRINTED costs — a live global discount shifts both
 *    sides equally, so the relation is unchanged.
 *  - EXPERIMENT: "return this to its pile" is a plain move back to the
 *    supply zone (the empty-pile counter recomputes on the next supply
 *    departure). The on-gain chain gains exactly ONE extra Experiment (the
 *    chained copy is marked by a per-player toggle so it never chains again).
 *  - MOUNTAIN VILLAGE: the mandatory take-from-discard is a revealed pick
 *    (the discard is public anyway); with an empty discard it draws 1, per
 *    the printed fallback.
 */
import type { AbilityDef, Block, CardDef, Expr, TriggerDef, VariableDef } from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, bestCard, bnd, cardZoneId, changeVar, chooseCard,
  chooseCardsBlock, chooseOption, countCards, eq, field, forEachCard, forEachPlayer, getVar, gt,
  gte, iff, move, neq, num, setVar, shuffle, specific, str, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';
import { HAVEN_MARK } from './seaside2eA';

const IDS: Record<string, string> = {
  'Border Guard': 'dom_card_border_guard',
  Ducat: 'dom_card_ducat',
  Lackeys: 'dom_card_lackeys',
  'Acting Troupe': 'dom_card_acting_troupe',
  'Cargo Ship': 'dom_card_cargo_ship',
  Experiment: 'dom_card_experiment',
  Improve: 'dom_card_improve',
  'Flag Bearer': 'dom_card_flag_bearer',
  Hideout: 'dom_card_hideout',
  Inventor: 'dom_card_inventor',
  'Mountain Village': 'dom_card_mountain_village',
  Patron: 'dom_card_patron',
  Priest: 'dom_card_priest',
};

// --- the five Renaissance artifact variables (see the header contract) --------
/** The Flag's holder (player id; '' = unclaimed). Flag Bearer takes it. */
export const ARTIFACT_FLAG = 'dom_var_artifact_flag';
/** The Horn's holder. Border Guard's double-Action reveal awards it. */
export const ARTIFACT_HORN = 'dom_var_artifact_horn';
/** The Lantern's holder. Border Guard's double-Action reveal awards it. */
export const ARTIFACT_LANTERN = 'dom_var_artifact_lantern';
/** The Key's holder — declared here, used by renaissanceB (Treasurer). */
export const ARTIFACT_KEY = 'dom_var_artifact_key';
/** The Treasure Chest's holder — declared here, used by renaissanceB. */
export const ARTIFACT_CHEST = 'dom_var_artifact_chest';

/** Unspent Cargo Ship watches this turn (one per Cargo Ship played). */
export const CARGO_WATCH = 'dom_var_cargo_watch';
/** Experiment's chain toggle: 1 = the NEXT Experiment gain is the chained
 *  copy and must not chain again. */
export const EXPERIMENT_CHAIN = 'dom_var_experiment_chain';
/** Priest's rest-of-turn bonus: +$N per trash ( +2 per Priest played). */
export const PRIEST_BONUS = 'dom_var_priest_bonus';
/** The Horn has already sounded this turn (once per turn, reset at cleanup). */
export const HORN_USED = 'dom_var_horn_used';

/** The cleanup phase's id (stable dominionGame.ts literal — Seaside's idiom). */
const PHASE_CLEANUP = 'dom_phase_cleanup';
/** The In-Play zone's id, for $fromZone checks in the Horn watcher. */
const INPLAY_ID = 'dom_zone_inplay';

/** A yes/no question to `who`; the answer lands in $choice as a boolean. */
const yesNo = (who: Expr, prompt: string): Block =>
  ({ kind: 'choose', who, choice: { kind: 'yesNo', prompt } });

/**
 * The official empty-deck reshuffle for effects that TAKE cards off the deck
 * without the `draw` block (Border Guard's reveal): when `who`'s deck is
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
 * is empty). Unrolled per card, so "top 2/3" keeps the official per-card
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
  const { SUPPLY, TRASH, HAND, DISCARD, INPLAY, LOOK, DURATION } = kit.zones;
  const { ACTIONS, BUYS, COINS, SCRATCH, DISCOUNT, COFFERS, VILLAGERS } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE, SELF } = kit;

  /** "This candidate wears the set-aside mark" ($card rebinds per candidate). */
  const MARKED = eq(getVar(HAVEN_MARK, CARD), num(1));

  /** Cargo Ship's retrieval body ($card = the set-aside card). */
  const cargoTakeBack: Block[] = [
    setVar(HAVEN_MARK, num(0), CARD),
    announce(OWNER, ' takes the card set aside on Cargo Ship into their hand.'),
    move(specific(CARD), zone(DURATION, OWNER), zone(HAND, OWNER), { faceUp: true }),
  ];

  // IMPROVE's cleanup window (Walled Village's precedent — see the header):
  // at the START of the owner's Cleanup phase, while Improve is in play, the
  // owner may trash one Action in play (Improve itself qualifies) for a card
  // costing exactly $1 more (printed costs — header note). One window per
  // Improve copy in play, as printed.
  const improveWindow: AbilityDef = {
    id: 'dom_ab_improve_cleanup',
    name: 'Improve — at Clean-up',
    on: 'phaseStart', zoneId: INPLAY, phaseId: PHASE_CLEANUP,
    condition: eq(CURRENT, OWNER),
    script: [
      iff(gt(countCards(zone(INPLAY, OWNER), kit.IS_ACTION_CARD), num(0)), [
        chooseCardsBlock({
          who: OWNER, from: zone(INPLAY, OWNER), filter: kit.IS_ACTION_CARD,
          min: num(0), max: num(1),
          prompt: 'Improve: you may trash an Action in play to gain a card costing exactly $1 more',
          body: [
            setVar(SCRATCH, add(field(CARD, COST), num(1)), OWNER),
            announce(OWNER, ' improves ', CARD, ' away.'),
            kit.tmove(specific(CARD), zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            iff(gt(countCards(zone(SUPPLY), eq(field(CARD, COST), getVar(SCRATCH, OWNER))), num(0)), [
              kit.choosePileBlock({
                who: OWNER, from: zone(SUPPLY),
                filter: eq(field(CARD, COST), getVar(SCRATCH, OWNER)),
                prompt: 'Improve: gain a card costing exactly $1 more than the trashed card',
                body: [
                  announce(OWNER, ' gains ', CARD, '.'),
                  kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                ],
              }),
            ], [announce('Nothing in the supply costs exactly the improved amount.')]),
          ],
        }),
      ]),
    ],
  };

  return [
    // BORDER GUARD — exact (header register for the artifact edge cases).
    // SCRATCH first holds the reveal count (2, or 3 with the Lantern), then
    // flips to the "every revealed card was an Action" verdict before the
    // pick empties the LOOK zone.
    kit.cardDef(IDS['Border Guard'], 'Border Guard', 2, 0, 0,
      '+1 Action. Reveal the top 2 cards of your deck. Put one into your hand and discard the other. If both were Actions, take the Lantern or Horn.', [
        kit.onPlay('dom_ab_border_guard', 'Watch on the wall', [
          changeVar(ACTIONS, num(1), OWNER),
          setVar(SCRATCH, num(2), OWNER),
          iff(eq(getVar(ARTIFACT_LANTERN), OWNER), [
            setVar(SCRATCH, num(3), OWNER),
            announce(OWNER, "'s Lantern lights the road — 3 cards are revealed."),
          ]),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          iff(gte(getVar(SCRATCH, OWNER), num(3)), [
            ...takeTop(kit, OWNER, zone(LOOK), true),
          ]),
          // The verdict must be recorded BEFORE a card leaves for the hand.
          iff(allOf(
            eq(zoneCount(zone(LOOK)), getVar(SCRATCH, OWNER)),
            eq(countCards(zone(LOOK), kit.IS_ACTION_CARD), zoneCount(zone(LOOK))),
          ), [setVar(SCRATCH, num(1), OWNER)], [setVar(SCRATCH, num(0), OWNER)]),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            announce(OWNER, ' reveals the top cards of their deck.'),
            chooseCardsBlock({
              who: OWNER, from: zone(LOOK), min: num(1), max: num(1), revealed: true,
              prompt: 'Border Guard: put one revealed card into your hand',
              body: [
                announce(OWNER, ' takes ', CARD, ' into their hand.'),
                move(specific(CARD), zone(LOOK), zone(HAND, OWNER), { faceUp: true }),
              ],
            }),
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              kit.tmove(ALL, zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
            ]),
          ], [announce(OWNER, ' has no cards left to reveal.')]),
          iff(eq(getVar(SCRATCH, OWNER), num(1)), [
            announce('Every revealed card was an Action!'),
            chooseOption('Border Guard: take an Artifact', [
              { id: 'bg_lantern', label: 'Take the Lantern (your Border Guards reveal 3 cards)' },
              { id: 'bg_horn', label: 'Take the Horn (once per turn, topdeck a Border Guard discarded from play)' },
            ], OWNER),
            iff(eq(CHOICE, str('bg_lantern')), [
              setVar(ARTIFACT_LANTERN, OWNER),
              announce(OWNER, ' takes the Lantern.'),
            ], [
              setVar(ARTIFACT_HORN, OWNER),
              announce(OWNER, ' takes the Horn.'),
            ]),
          ]),
        ]),
      ]),

    // DUCAT — Treasure (treasureNames), coin field 0: its worth is the
    // banked Coffers. The on-gain Copper trash is the buildTriggers watcher.
    kit.cardDef(IDS.Ducat, 'Ducat', 2, 0, 0,
      '+1 Coffers. +1 Buy. When you gain this, you may trash a Copper from your hand.', [
        kit.onPlay('dom_ab_ducat', 'Small coin, quick hands', [
          changeVar(COFFERS, num(1), OWNER),
          changeVar(BUYS, num(1), OWNER),
          announce(OWNER, ' banks a Coffers and takes +1 Buy.'),
        ]),
      ]),

    // LACKEYS — the play half is exact; the on-gain Villagers ride the
    // buildTriggers watcher.
    kit.cardDef(IDS.Lackeys, 'Lackeys', 2, 0, 0,
      '+2 Cards. When you gain this, +2 Villagers.', [
        kit.onPlay('dom_ab_lackeys', 'Idle hands', [
          kit.draw(OWNER, 2),
        ]),
      ]),

    // ACTING TROUPE — exact. The self-trash is guarded on still being in
    // play, so a Throne-Roomed replay grants +8 Villagers and trashes once
    // (the printed ruling — Investment's guard idiom).
    kit.cardDef(IDS['Acting Troupe'], 'Acting Troupe', 3, 0, 0,
      '+4 Villagers. Trash this.', [
        kit.onPlay('dom_ab_acting_troupe', 'The show moves on', [
          changeVar(VILLAGERS, num(4), OWNER),
          announce(OWNER, ' banks 4 Villagers.'),
          iff(eq(cardZoneId(SELF), str(INPLAY)), [
            announce(OWNER, "'s Acting Troupe takes its final bow — it is trashed."),
            kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true }),
          ]),
        ]),
      ]),

    // CARGO SHIP — Duration (kit.durationPair; header register). The now
    // half pays +$2 and adds one gain watch; the gain watchers in
    // buildTriggers offer the set-aside; the later half retrieves one marked
    // card (auto when it is the only one — Haven's idiom).
    kit.cardDef(IDS['Cargo Ship'], 'Cargo Ship', 3, 0, 0,
      '+$2. Once this turn, when you gain a card, you may set it aside face up. At the start of your next turn, put it into your hand.',
      kit.durationPair('dom_ab_cargo_ship', 'Cargo Ship', [
        changeVar(COINS, num(2), OWNER),
        changeVar(CARGO_WATCH, num(1), OWNER),
      ], [
        iff(gt(countCards(zone(DURATION, OWNER), MARKED), num(0)), [
          iff(eq(countCards(zone(DURATION, OWNER), MARKED), num(1)), [
            forEachCard(zone(DURATION, OWNER), MARKED, cargoTakeBack),
          ], [
            chooseCardsBlock({
              who: OWNER, from: zone(DURATION, OWNER), filter: MARKED,
              min: num(1), max: num(1), revealed: true,
              prompt: 'Cargo Ship: choose a set-aside card to put into your hand',
              body: cargoTakeBack,
            }),
          ]),
        ], [announce('The Cargo Ship arrives empty.')]),
      ])),

    // EXPERIMENT — exact. The return is guarded on still being in play (a
    // Throne-Roomed Experiment draws twice and returns once, as printed);
    // the on-gain chain is the buildTriggers watcher.
    kit.cardDef(IDS.Experiment, 'Experiment', 3, 0, 0,
      "+2 Cards. +1 Action. Return this to its pile. When you gain this, gain another Experiment (that doesn't come with another).", [
        kit.onPlay('dom_ab_experiment', 'Trial and error', [
          kit.draw(OWNER, 2),
          changeVar(ACTIONS, num(1), OWNER),
          iff(eq(cardZoneId(SELF), str(INPLAY)), [
            announce(OWNER, "'s Experiment returns to its pile."),
            move(specific(SELF), zone(INPLAY, OWNER), zone(SUPPLY), { faceUp: true }),
          ]),
        ]),
      ]),

    // IMPROVE — the play half is exact; the Clean-up window is the
    // phaseStart ability above (header register).
    kit.cardDef(IDS.Improve, 'Improve', 3, 0, 0,
      '+$2. At the start of Clean-up, you may trash an Action card you would discard from play this turn, to gain a card costing exactly $1 more than it.', [
        kit.onPlay('dom_ab_improve', 'Out with the old', [
          changeVar(COINS, num(2), OWNER),
        ]),
        improveWindow,
      ]),

    // FLAG BEARER — the play half is exact; taking the Flag on gain/trash is
    // the buildTriggers watchers, the Flag's +1 card the cleanup reset.
    kit.cardDef(IDS['Flag Bearer'], 'Flag Bearer', 4, 0, 0,
      '+$2. When you gain or trash this, take the Flag.', [
        kit.onPlay('dom_ab_flag_bearer', 'March the colors', [
          changeVar(COINS, num(2), OWNER),
        ]),
      ]),

    // HIDEOUT — exact. The trashed card keeps answering type checks from the
    // trash, so the Victory test follows the move.
    kit.cardDef(IDS.Hideout, 'Hideout', 4, 0, 0,
      "+1 Card. +2 Actions. Trash a card from your hand. If it's a Victory card, gain a Curse.", [
        kit.onPlay('dom_ab_hideout', 'Down the trapdoor', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Hideout: trash a card from your hand',
            }),
            announce(OWNER, ' trashes ', CHOICE, ' in the Hideout.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            iff(kit.isA(CHOICE, kit.types.VICTORY), [
              iff(gt(countCards(zone(SUPPLY), kit.nameIs('Curse')), num(0)), [
                announce(OWNER, ' hid a Victory card — they gain a Curse.'),
                kit.tmove(
                  specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Curse'))),
                  zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
                ),
              ], [announce('The Curse pile is empty — no price to pay.')]),
            ]),
          ], [announce(OWNER, ' has nothing to hide.')]),
        ]),
      ]),

    // INVENTOR — exact: the gain rides the Bridge-aware core helper, then
    // the global discount deepens by $1 (two Inventors chain to $5 gains).
    kit.cardDef(IDS.Inventor, 'Inventor', 4, 0, 0,
      'Gain a card costing up to $4, then cards cost $1 less this turn.', [
        kit.onPlay('dom_ab_inventor', 'A better mousetrap', [
          ...kit.gainFromSupply({
            limit: num(4),
            prompt: 'Inventor: gain a card costing up to $4',
            whiff: [announce('Nothing in the supply is cheap enough to invent.')],
          }),
          changeVar(DISCOUNT, num(1)),
          announce('Cards cost $1 less this turn.'),
        ]),
      ]),

    // MOUNTAIN VILLAGE — the mandatory discard-pile take, with the printed
    // +1 Card fallback when the discard is empty (header register).
    kit.cardDef(IDS['Mountain Village'], 'Mountain Village', 4, 0, 0,
      '+2 Actions. Look through your discard pile and put a card from it into your hand; if you can’t, +1 Card.', [
        kit.onPlay('dom_ab_mountain_village', 'High road home', [
          changeVar(ACTIONS, num(2), OWNER),
          iff(gt(zoneCount(zone(DISCARD, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(DISCARD, OWNER), revealed: true,
              prompt: 'Mountain Village: put a card from your discard pile into your hand',
            }),
            announce(OWNER, ' takes ', CHOICE, ' from their discard pile.'),
            move(specific(CHOICE), zone(DISCARD, OWNER), zone(HAND, OWNER), { faceUp: true }),
          ], [
            kit.draw(OWNER, 1),
          ]),
        ]),
      ]),

    // PATRON — the play half is exact; the reveal rider is DROPPED (header
    // register: the engine has no reveal event). Reaction-tagged for the
    // printed type line only.
    kit.cardDef(IDS.Patron, 'Patron', 4, 0, 0,
      '+1 Villager. +$2. When something causes you to reveal this (using the word "reveal"), +1 Coffers.', [
        kit.onPlay('dom_ab_patron', 'Deep pockets', [
          changeVar(VILLAGERS, num(1), OWNER),
          changeVar(COINS, num(2), OWNER),
          announce(OWNER, ' banks a Villager.'),
        ]),
      ]),

    // PRIEST — the rest-of-turn bonus is the 'trash' watcher paying
    // PRIEST_BONUS to the current player; the script pre-refunds the $2 its
    // own trash would overpay (header register on the timing).
    kit.cardDef(IDS.Priest, 'Priest', 4, 0, 0,
      '+$2. Trash a card from your hand. For the rest of this turn, when you trash a card, +$2.', [
        kit.onPlay('dom_ab_priest', 'Ashes to ashes', [
          changeVar(COINS, num(2), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Priest: trash a card from your hand',
            }),
            announce(OWNER, ' trashes ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            changeVar(PRIEST_BONUS, num(2), OWNER),
            // The trash above settles AFTER this script, when the watcher
            // pays the NEW bonus — printed, the Priest's own trash predates
            // its rest-of-turn ability, so the $2 overpay is refunded here.
            changeVar(COINS, num(-2), OWNER),
          ], [
            announce(OWNER, ' has nothing to offer up.'),
            changeVar(PRIEST_BONUS, num(2), OWNER),
          ]),
          announce(OWNER, ' gains +$2 from each trash for the rest of the turn.'),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, DURATION } = kit.zones;
  const { COINS, VILLAGERS } = kit.vars;
  const { COST } = kit.fields;
  const { CARD, CHOICE } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** FLAG BEARER on gain/buy: the gainer takes the Flag. */
  const flagGainWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_flag_bearer_${tag}`,
    name: `Flag Bearer: ${tag === 'buy' ? 'bought' : 'gained'} — take the Flag`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Flag Bearer'),
    script: [
      setVar(ARTIFACT_FLAG, GAINER),
      announce(GAINER, ' takes the Flag.'),
    ],
  });

  /** FLAG BEARER on trash: the CURRENT player takes the Flag (header note —
   *  the shared trash zone carries no per-player attribution). */
  const flagTrashWatch = (): TriggerDef => ({
    id: 'dom_trigger_flag_bearer_trash',
    name: 'Flag Bearer: trashed — take the Flag',
    event: { kind: 'cardEnterZone', zoneId: TRASH, tag: 'trash' },
    condition: kit.nameIs('Flag Bearer'),
    script: [
      setVar(ARTIFACT_FLAG, CURRENT),
      announce(CURRENT, ' takes the Flag.'),
    ],
  });

  /** LACKEYS on gain/buy: +2 Villagers to the gainer. */
  const lackeysWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_lackeys_${tag}`,
    name: `Lackeys: ${tag === 'buy' ? 'bought' : 'gained'} — +2 Villagers`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Lackeys'),
    script: [
      changeVar(VILLAGERS, num(2), GAINER),
      announce(GAINER, ' banks 2 Villagers for the Lackeys.'),
    ],
  });

  /** DUCAT on gain/buy: the gainer may trash a Copper from their hand. */
  const ducatWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_ducat_${tag}`,
    name: `Ducat: ${tag === 'buy' ? 'bought' : 'gained'} — Copper trash offer`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Ducat'),
    script: [
      iff(gt(countCards(zone(HAND, GAINER), kit.nameIs('Copper')), num(0)), [
        chooseCardsBlock({
          who: GAINER, from: zone(HAND, GAINER), filter: kit.nameIs('Copper'),
          min: num(0), max: num(1),
          prompt: 'Ducat: you may trash a Copper from your hand',
          body: [
            announce(GAINER, ' trashes a Copper.'),
            kit.tmove(specific(CARD), zone(HAND, GAINER), zone(TRASH), 'trash', { faceUp: true }),
          ],
        }),
      ]),
    ],
  });

  /**
   * EXPERIMENT's chain (header register): a gained Experiment gains one
   * more. The per-player toggle marks the CHAINED copy's own event so it
   * never chains again — and it is only set when the extra copy actually
   * moves, so an empty pile can never wedge the toggle.
   */
  const experimentWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_experiment_${tag}`,
    name: `Experiment: ${tag === 'buy' ? 'bought' : 'gained'} — one more`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Experiment'),
    script: [
      iff(eq(getVar(EXPERIMENT_CHAIN, GAINER), num(1)), [
        setVar(EXPERIMENT_CHAIN, num(0), GAINER),
      ], [
        iff(gt(countCards(zone(SUPPLY), kit.nameIs('Experiment')), num(0)), [
          setVar(EXPERIMENT_CHAIN, num(1), GAINER),
          announce(GAINER, ' gains another Experiment.'),
          kit.tmove(
            specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Experiment'))),
            zone(SUPPLY), zone(DISCARD, GAINER), 'gain', { faceUp: true },
          ),
        ]),
      ]),
    ],
  });

  /**
   * CARGO SHIP's watch (header register): while the gainer has an unspent
   * Cargo Ship watch, each gained card may park in the DURATION zone wearing
   * the set-aside mark. Withheld when the card was already trashed (a
   * Watchtower answered first — prosperity's guard idiom).
   */
  const cargoWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_cargo_ship_${tag}`,
    name: `Cargo Ship: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        gt(getVar(CARGO_WATCH, GAINER), num(0)),
        neq(cardZoneId(CARD), str(TRASH)),
      ), [
        yesNo(GAINER, 'Cargo Ship: set the gained card aside (into your hand next turn)?'),
        iff(CHOICE, [
          changeVar(CARGO_WATCH, num(-1), GAINER),
          setVar(HAVEN_MARK, num(1), CARD),
          announce(GAINER, ' sets the gained ', CARD, ' aside on Cargo Ship.'),
          move(specific(CARD), zone(DISCARD, GAINER), zone(DURATION, GAINER), { faceUp: true }),
        ]),
      ]),
    ],
  });

  /**
   * The HORN (header register): a Border Guard discarded from play at
   * cleanup may return to its owner's deck top — once per turn. Fires after
   * the cleanup redraw (the engine drains events after the whole script),
   * so the card tops the NEXT turn's deck.
   */
  const hornWatch = (): TriggerDef => ({
    id: 'dom_trigger_horn_cleanup',
    name: 'Horn: a Border Guard is discarded from play',
    event: { kind: 'cardEnterZone', zoneId: DISCARD, tag: 'cleanup' },
    condition: allOf(
      kit.nameIs('Border Guard'),
      eq(bnd('$fromZone'), str(INPLAY_ID)),
      eq(getVar(ARTIFACT_HORN), GAINER),
      eq(getVar(HORN_USED, GAINER), num(0)),
    ),
    script: [
      yesNo(GAINER, 'Horn: put the discarded Border Guard onto your deck?'),
      iff(CHOICE, [
        setVar(HORN_USED, num(1), GAINER),
        announce(GAINER, ' sounds the Horn — the Border Guard returns to their deck.'),
        move(specific(CARD), zone(DISCARD, GAINER), zone(DECK, GAINER),
          { toPosition: 'top', faceUp: false }),
      ]),
    ],
  });

  /** PRIEST's rest-of-turn payout (header register on attribution/timing). */
  const priestWatch = (): TriggerDef => ({
    id: 'dom_trigger_priest_trash',
    name: 'Priest: a card is trashed',
    event: { kind: 'cardEnterZone', zoneId: TRASH, tag: 'trash' },
    condition: gt(getVar(PRIEST_BONUS, CURRENT), num(0)),
    script: [
      changeVar(COINS, getVar(PRIEST_BONUS, CURRENT), CURRENT),
      announce(CURRENT, ' takes +$', getVar(PRIEST_BONUS, CURRENT), ' from the Priest.'),
    ],
  });

  return [
    flagGainWatch('gain'),
    flagGainWatch('buy'),
    flagTrashWatch(),
    lackeysWatch('gain'),
    lackeysWatch('buy'),
    ducatWatch('gain'),
    ducatWatch('buy'),
    experimentWatch('gain'),
    experimentWatch('buy'),
    cargoWatch('gain'),
    cargoWatch('buy'),
    hornWatch(),
    priestWatch(),
  ];
}

export const renaissanceA: ExpansionModule = {
  id: 'renaissanceA',
  setName: 'Renaissance',

  piles: [
    { name: 'Border Guard', cost: 2, count: 10 },
    { name: 'Ducat', cost: 2, count: 10 },
    { name: 'Lackeys', cost: 2, count: 10 },
    { name: 'Acting Troupe', cost: 3, count: 10 },
    { name: 'Cargo Ship', cost: 3, count: 10 },
    { name: 'Experiment', cost: 3, count: 10 },
    { name: 'Improve', cost: 3, count: 10 },
    { name: 'Flag Bearer', cost: 4, count: 10 },
    { name: 'Hideout', cost: 4, count: 10 },
    { name: 'Inventor', cost: 4, count: 10 },
    { name: 'Mountain Village', cost: 4, count: 10 },
    { name: 'Patron', cost: 4, count: 10 },
    { name: 'Priest', cost: 4, count: 10 },
  ],

  ids: IDS,

  // Patron's printed type line is "Action – Reaction" (its reveal rider is
  // dropped — module header). No Attacks in this half of the set.
  reactionNames: ['Patron'],
  treasureNames: ['Ducat'],

  variables: [
    // The five artifact holders (module header: renaissanceB reads/writes
    // the Key and Treasure Chest vars; they are DECLARED only here).
    { id: ARTIFACT_FLAG, name: 'Artifact: the Flag', scope: 'global', type: 'string', initial: '', hidden: true },
    { id: ARTIFACT_HORN, name: 'Artifact: the Horn', scope: 'global', type: 'string', initial: '', hidden: true },
    { id: ARTIFACT_LANTERN, name: 'Artifact: the Lantern', scope: 'global', type: 'string', initial: '', hidden: true },
    { id: ARTIFACT_KEY, name: 'Artifact: the Key', scope: 'global', type: 'string', initial: '', hidden: true },
    { id: ARTIFACT_CHEST, name: 'Artifact: the Treasure Chest', scope: 'global', type: 'string', initial: '', hidden: true },
    // Per-turn bookkeeping.
    { id: CARGO_WATCH, name: 'Cargo Ship: unspent watches', scope: 'perPlayer', type: 'number', initial: 0, hidden: true },
    { id: EXPERIMENT_CHAIN, name: 'Experiment: chain toggle', scope: 'perPlayer', type: 'number', initial: 0, hidden: true },
    { id: PRIEST_BONUS, name: 'Priest: per-trash bonus', scope: 'perPlayer', type: 'number', initial: 0, hidden: true },
    { id: HORN_USED, name: 'Horn: sounded this turn', scope: 'perPlayer', type: 'number', initial: 0, hidden: true },
  ] as VariableDef[],

  buildCards,
  buildTriggers,

  buildCleanupResets(kit): Block[] {
    return [
      forEachPlayer([
        setVar(CARGO_WATCH, num(0), kit.PLAYER),
        setVar(EXPERIMENT_CHAIN, num(0), kit.PLAYER),
        setVar(PRIEST_BONUS, num(0), kit.PLAYER),
        setVar(HORN_USED, num(0), kit.PLAYER),
      ]),
      // The FLAG: its holder redraws 6 — one extra draw after the core's 5.
      iff(eq(getVar(ARTIFACT_FLAG), CURRENT), [
        announce(CURRENT, "'s Flag flies — they draw an extra card."),
        kit.draw(null, 1),
      ]),
    ];
  },
};
