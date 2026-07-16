/**
 * Hinterlands 2E (part B) — Berserker, Cartographer, Cauldron, Haggler,
 * Highway, Inn, Margrave, Souk, Stables, Wheelwright, Witch's Hut,
 * Border Village, Farmland: the set's cost-5/6 half.
 *
 * Hinterlands is THE on-gain set: its signature effects ride cardEnterZone
 * triggers watching both the 'gain' AND 'buy' cause tags (a bought card's
 * move carries only 'buy' — Watchtower/Monkey precedent), with $owner bound
 * to the destination zone's owner (the gainer). House idioms follow the
 * Base/Intrigue/Seaside/Prosperity modules: attack halves are separate
 * `stacked: true` abilities gated per victim on IMMUNE == 0 (the shared
 * effectResolved trigger resets it), look-at effects stage through the hidden
 * shared LOOK zone with `revealed` choices, every mandatory choice is guarded
 * so a session can never hang, and relative cost comparisons ("cheaper than
 * this", "exactly $2 more than it") compare PRINTED costs — a live
 * Bridge/Highway discount shifts both sides equally, so the printed compare
 * is discount-invariant and needs no DISCOUNT term.
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "each other player" is
 * the one opponent everywhere below (forEachOpponent / the neq-GAINER walk).
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - HIGHWAY (prominent): the engine's only cost lever is the GLOBAL per-turn
 *    DISCOUNT variable (Bridge's / Quarry's). Highway raises it by 1 on play,
 *    so every card costs $1 less for the REST OF THE TURN — even if Highway
 *    somehow leaves play early ("while this is in play" is approximated by
 *    "this turn"; Highway stays in play until cleanup anyway, when the
 *    discount resets). Multiple Highways stack, as printed.
 *  - HAGGLER: "while this is in play, when you buy a card" is a 'buy'-tagged
 *    trigger gated on Haggler sitting in the buyer's In Play at the moment of
 *    the buy; each Haggler in play haggles one cheaper non-Victory gain per
 *    buy (cumulative, as ruled). Black Market's under-the-counter sales are
 *    'buy'-tagged and haggle too (Merchant Guild's precedent). The gain is
 *    mandatory when anything qualifies, as printed.
 *  - INN (on-gain): "reveal any number of Action cards from your discard
 *    pile and shuffle them into your deck" moves the picked cards (revealed
 *    via the log and the revealed choice sheet) onto the deck and then
 *    shuffles the WHOLE deck — there is no partial-shuffle primitive. The
 *    just-gained Inn sits in the discard pile and may be picked, as printed.
 *  - CARTOGRAPHER: the kept cards go back on top in a FIXED order (no
 *    reorder primitive — Sentry's precedent); the look stays private (the
 *    LOOK zone is hidden, the choice sheet is revealed to the owner only).
 *  - SOUK: the printed "+$7, -$1 per card in your hand (you can't go below
 *    $0)" floors the DELTA at 0 — max(0, 7 - hand size) — instead of
 *    flooring the running coin total. The two differ only when the owner
 *    holds 8+ cards after playing Souk AND already had coins; the honest
 *    common case is identical.
 *  - CAULDRON: the curse half fires from the on-gain counter trigger — a
 *    per-player "Actions gained this turn" tally (reset at cleanup) that
 *    counts ALL turn long, so three Actions gained BEFORE Cauldron is played
 *    never curse (the ==3 transition happened with no Cauldron in play),
 *    matching the printed ruling. Each Cauldron in play deals a Curse on the
 *    third gain (cumulative, as ruled). Moat: the play of Cauldron opens the
 *    response window (stacked attack half); a revealed Moat sets a this-turn
 *    ward mark the curse trigger honors — the delayed curse itself resolves
 *    inline with NO second response window.
 *  - BERSERKER (on-gain): "if you have an Action in play" counts In Play
 *    AND the owner's parked DURATION cards (Sea Chart's precedent — printed
 *    Durations remain in play between turns). A Haven-set-aside Action would
 *    wrongly count (it is not in play) — marginal and accepted. The on-gain
 *    play is a real 'play'-tagged move, so both on-play halves fire and the
 *    attack opens its response window mid-gain.
 *  - WITCH'S HUT: the two discards are "revealed" via announcements (Shanty
 *    Town's idiom — no persistent reveal primitive). With fewer than 2 cards
 *    to discard, "if they're both Actions" is false and no Curse flies.
 *  - FARMLAND: implemented ON BUY only (this module's contract; the 2022
 *    printing fires on any gain). The trash is mandatory when the hand has
 *    cards and whiffs gracefully on an empty hand; the exactly-$2-more gain
 *    excludes another Farmland, as printed ("but not another copy of
 *    Farmland"), and compares printed costs (exact-cost matches ignore a
 *    live discount — Stonemason/Swindler's precedent).
 */
import type { Block, CardDef, Expr, TriggerDef, VariableDef } from '../../shared/types';
import {
  ALL, add, allOf, announce, bestCard, bnd, changeVar, chooseCard, chooseCardsBlock,
  countCards, discardDownTo, eq, field, forEachCard, forEachOpponent, forEachPlayer, getVar,
  gt, iff, lt, lte, move, neq, not, num, setVar, shuffle, specific, str, sub, topN, zone,
  zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Berserker: 'dom_card_berserker',
  Cartographer: 'dom_card_cartographer',
  Cauldron: 'dom_card_cauldron',
  Haggler: 'dom_card_haggler',
  Highway: 'dom_card_highway',
  Inn: 'dom_card_inn',
  Margrave: 'dom_card_margrave',
  Souk: 'dom_card_souk',
  Stables: 'dom_card_stables',
  Wheelwright: 'dom_card_wheelwright',
  "Witch's Hut": 'dom_card_witchs_hut',
  'Border Village': 'dom_card_border_village',
  Farmland: 'dom_card_farmland',
};

/** Per-player tally of Action cards gained this turn (Cauldron's fuse). */
export const CAULDRON_COUNT_VAR = 'dom_var_cauldron_actions';
/** Per-player this-turn ward: 1 after a Moat waved a Cauldron off. */
export const CAULDRON_WARD_VAR = 'dom_var_cauldron_ward';
/** How many of Witch's Hut's revealed discards were Actions (0/1/2). */
export const WITCHS_HUT_VAR = 'dom_var_witchs_hut_actions';
/** Haggler: the bought card's printed cost (the haggle cap). */
export const HAGGLER_CAP_VAR = 'dom_var_haggler_cap';
/** Farmland: trashed printed cost + 2 (the exact-cost gain target). */
export const FARMLAND_CAP_VAR = 'dom_var_farmland_cap';

/**
 * The official empty-deck reshuffle for effects that TAKE cards off the deck
 * without the `draw` block (Cartographer's look): when `who`'s deck is empty,
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
 * is empty). Unrolled per card, so "top 4" keeps the official per-card
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
  const { SUPPLY, DECK, HAND, DISCARD, LOOK } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, SCRATCH, DISCOUNT } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, PLAYER } = kit;
  const { nameIs } = kit;

  return [
    // BERSERKER — Action – Attack. The cheaper gain is inline; the discard
    // attack is the stacked half (Militia's pattern, Moat-blockable). The
    // on-gain "play this" lives in buildTriggers (header register). "Costing
    // less than this" compares printed costs (discount-invariant — header).
    kit.cardDef(IDS.Berserker, 'Berserker', 5, 0, 0,
      'Gain a card costing less than this. Each other player discards down to 3 cards in hand. When you gain this, if you have an Action in play, play this.', [
        kit.onPlay('dom_ab_berserker_gain', 'Spoils of the raid', [
          iff(gt(countCards(zone(SUPPLY), lt(field(CARD, COST), num(5))), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY),
              filter: lt(field(CARD, COST), num(5)),
              prompt: 'Berserker: gain a card costing less than this',
              body: [
                announce(OWNER, ' seizes ', CARD, ' in the frenzy.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
              ],
            }),
          ], [announce('Nothing in the supply costs less than the Berserker.')]),
        ]),
        kit.onPlay('dom_ab_berserker_attack', 'The war-howl', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              discardDownTo({
                who: PLAYER, from: zone(HAND, PLAYER), to: zone(DISCARD, PLAYER),
                keep: num(3), prompt: 'Berserker: discard down to 3 cards',
              }),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // CARTOGRAPHER — the top 4 stage through the hidden LOOK zone; discard
    // any number (revealed to the owner), the rest go back on top in a FIXED
    // order (header register).
    kit.cardDef(IDS.Cartographer, 'Cartographer', 5, 0, 0,
      '+1 Card. +1 Action. Look at the top 4 cards of your deck. Discard any number of them, then put the rest back on top in any order.', [
        kit.onPlay('dom_ab_cartographer', 'Ink on the frontier', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          ...takeTop(kit, OWNER, zone(LOOK), false),
          ...takeTop(kit, OWNER, zone(LOOK), false),
          ...takeTop(kit, OWNER, zone(LOOK), false),
          ...takeTop(kit, OWNER, zone(LOOK), false),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(LOOK), revealed: true,
              min: num(0), max: num(4),
              prompt: 'Cartographer: discard any number of the top 4 cards of your deck',
              body: [
                announce(OWNER, ' charts ', CARD, ' into the discard pile.'),
                kit.tmove(specific(CARD), zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ],
            }),
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
            ]),
          ], [announce(OWNER, ' has no cards left to map.')]),
        ]),
      ]),

    // CAULDRON — Treasure – Attack, $2 (the coin field, paid by the treasure
    // action). +1 Buy inline; the stacked attack half only announces the brew
    // and records Moat wards — the curse itself fires from the third-Action
    // counter trigger in buildTriggers (header register).
    kit.cardDef(IDS.Cauldron, 'Cauldron', 5, 2, 0,
      '$2. +1 Buy. The third time you gain an Action this turn, each other player gains a Curse.', [
        kit.onPlay('dom_ab_cauldron_buy', 'Stir the pot', [
          changeVar(BUYS, num(1), OWNER),
        ]),
        kit.onPlay('dom_ab_cauldron_attack', 'Something wicked simmers', [
          announce(OWNER, '’s Cauldron simmers — the third Action gained this turn will boil it over.'),
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(1)), [
              setVar(CAULDRON_WARD_VAR, num(1), PLAYER),
              announce(PLAYER, ' wards off the Cauldron — its curses cannot touch them this turn.'),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack;
          // the ward mark carries the immunity to the delayed curse.
        ], true),
      ]),

    // HAGGLER — +$2 on play; the while-in-play buy watcher lives in
    // buildTriggers (header register).
    kit.cardDef(IDS.Haggler, 'Haggler', 5, 0, 0,
      '+$2. While this is in play, when you buy a card, gain a cheaper non-Victory card.', [
        kit.onPlay('dom_ab_haggler', 'Name your price', [
          changeVar(COINS, num(2), OWNER),
        ]),
      ]),

    // HIGHWAY — PROMINENT DEVIATION (header register): the global per-turn
    // DISCOUNT rises by 1 (Bridge/Quarry's lever); cleanup resets it.
    kit.cardDef(IDS.Highway, 'Highway', 5, 0, 0,
      '+1 Card. +1 Action. While this is in play, cards cost $1 less, but not less than $0.', [
        kit.onPlay('dom_ab_highway', 'The road runs on', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(DISCOUNT, num(1)),
          announce(OWNER, '’s Highway cuts every cost by $1 this turn.'),
        ]),
      ]),

    // INN — the play half is exact (discard exactly 2, clamped to the hand —
    // Sea Witch's SCRATCH idiom); the on-gain shuffle lives in buildTriggers.
    kit.cardDef(IDS.Inn, 'Inn', 5, 0, 0,
      '+2 Cards. +2 Actions. Discard 2 cards. When you gain this, look through your discard pile, reveal any number of Action cards from it (which can include this), and shuffle them into your deck.', [
        kit.onPlay('dom_ab_inn', 'A bed and a tale', [
          kit.draw(OWNER, 2),
          changeVar(ACTIONS, num(2), OWNER),
          setVar(SCRATCH, num(2), OWNER),
          iff(lt(zoneCount(zone(HAND, OWNER)), num(2)), [
            setVar(SCRATCH, zoneCount(zone(HAND, OWNER)), OWNER),
          ]),
          iff(gt(getVar(SCRATCH, OWNER), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER),
              min: getVar(SCRATCH, OWNER), max: num(2),
              prompt: 'Inn: discard 2 cards',
              body: [
                announce(OWNER, ' discards ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ],
            }),
          ]),
        ]),
      ]),

    // MARGRAVE — Action – Attack. Cards and the Buy are inline; the
    // draw-then-discard strike is the stacked half. A Moat blocks BOTH the
    // opponent's draw and the discard (the whole attack, as printed).
    kit.cardDef(IDS.Margrave, 'Margrave', 5, 0, 0,
      '+3 Cards. +1 Buy. Each other player draws a card, then discards down to 3 cards in hand.', [
        kit.onPlay('dom_ab_margrave_main', 'Word from the march', [
          kit.draw(OWNER, 3),
          changeVar(BUYS, num(1), OWNER),
        ]),
        kit.onPlay('dom_ab_margrave_attack', 'The border levy', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              announce(PLAYER, ' draws a card, then discards down to 3.'),
              kit.draw(PLAYER, 1),
              discardDownTo({
                who: PLAYER, from: zone(HAND, PLAYER), to: zone(DISCARD, PLAYER),
                keep: num(3), prompt: 'Margrave: discard down to 3 cards',
              }),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // SOUK — +1 Buy, then +$max(0, 7 - hand size) (the DELTA floors at 0 —
    // header register). The on-gain trash lives in buildTriggers.
    kit.cardDef(IDS.Souk, 'Souk', 5, 0, 0,
      '+1 Buy. +$7. -$1 per card in your hand (you can’t go below $0). When you gain this, trash up to 2 cards from your hand.', [
        kit.onPlay('dom_ab_souk', 'A hundred stalls call', [
          changeVar(BUYS, num(1), OWNER),
          setVar(SCRATCH, sub(num(7), zoneCount(zone(HAND, OWNER))), OWNER),
          iff(lt(getVar(SCRATCH, OWNER), num(0)), [setVar(SCRATCH, num(0), OWNER)]),
          changeVar(COINS, getVar(SCRATCH, OWNER), OWNER),
          announce(OWNER, ' haggles +$', getVar(SCRATCH, OWNER), ' out of the souk.'),
        ]),
      ]),

    // STABLES — exact: the optional Treasure discard buys +3 Cards +1 Action.
    kit.cardDef(IDS.Stables, 'Stables', 5, 0, 0,
      'You may discard a Treasure, for +3 Cards and +1 Action.', [
        kit.onPlay('dom_ab_stables', 'Fresh horses', [
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_TREASURE_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_TREASURE_CARD,
              min: num(0), max: num(1),
              prompt: 'Stables: you may discard a Treasure for +3 Cards and +1 Action',
              body: [
                announce(OWNER, ' discards ', CARD, ' for fresh horses.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                kit.draw(OWNER, 3),
                changeVar(ACTIONS, num(1), OWNER),
              ],
            }),
          ], [announce(OWNER, ' has no Treasure to pay the stablehand.')]),
        ]),
      ]),

    // WHEELWRIGHT — the optional discard caps an Action gain at the
    // discarded card's printed cost (relative compare — header note).
    kit.cardDef(IDS.Wheelwright, 'Wheelwright', 5, 0, 0,
      '+1 Card. +1 Action. You may discard a card, to gain an Action card costing as much as it or less.', [
        kit.onPlay('dom_ab_wheelwright', 'Spokes and rims', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(1),
              prompt: 'Wheelwright: you may discard a card to gain an Action costing up to it',
              body: [
                setVar(SCRATCH, field(CARD, COST), OWNER),
                announce(OWNER, ' discards ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                iff(gt(countCards(zone(SUPPLY), allOf(
                  kit.IS_ACTION_CARD,
                  lte(field(CARD, COST), getVar(SCRATCH, OWNER)),
                )), num(0)), [
                  kit.choosePileBlock({
                    who: OWNER, from: zone(SUPPLY),
                    filter: allOf(
                      kit.IS_ACTION_CARD,
                      lte(field(CARD, COST), getVar(SCRATCH, OWNER)),
                    ),
                    prompt: 'Wheelwright: gain an Action card costing up to the discarded card',
                    body: [
                      announce(OWNER, ' gains ', CARD, ' off the workbench.'),
                      kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                    ],
                  }),
                ], [announce('No Action in the supply is cheap enough to build.')]),
              ],
            }),
          ]),
        ]),
      ]),

    // WITCH'S HUT — Action – Attack. Draw 4, discard exactly 2 (revealed via
    // announcements — header register); the stacked half curses only when
    // BOTH discards were Actions (the per-play counter var).
    kit.cardDef(IDS["Witch's Hut"], "Witch's Hut", 5, 0, 0,
      '+4 Cards. Discard 2 cards, revealed. If they’re both Actions, each other player gains a Curse.', [
        kit.onPlay('dom_ab_witchs_hut_main', 'Herbs and hexes', [
          kit.draw(OWNER, 4),
          setVar(WITCHS_HUT_VAR, num(0), OWNER),
          setVar(SCRATCH, num(2), OWNER),
          iff(lt(zoneCount(zone(HAND, OWNER)), num(2)), [
            setVar(SCRATCH, zoneCount(zone(HAND, OWNER)), OWNER),
          ]),
          iff(gt(getVar(SCRATCH, OWNER), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER),
              min: getVar(SCRATCH, OWNER), max: num(2),
              prompt: "Witch's Hut: discard 2 cards (they are revealed)",
              body: [
                announce(OWNER, ' discards ', CARD, ', revealed.'),
                iff(kit.isA(CARD, kit.types.ACTION), [
                  changeVar(WITCHS_HUT_VAR, num(1), OWNER),
                ]),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ],
            }),
          ]),
        ]),
        kit.onPlay('dom_ab_witchs_hut_attack', 'A curse from the chimney', [
          iff(eq(getVar(WITCHS_HUT_VAR, OWNER), num(2)), [
            announce('Both discards were Actions — the hut’s curse takes wing.'),
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
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // BORDER VILLAGE — the play half is exact; the on-gain cheaper gain
    // lives in buildTriggers (printed-cost compare — header note).
    kit.cardDef(IDS['Border Village'], 'Border Village', 6, 0, 0,
      '+1 Card. +2 Actions. When you gain this, gain a cheaper card.', [
        kit.onPlay('dom_ab_border_village', 'Life on the edge', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
        ]),
      ]),

    // FARMLAND — Victory, 2 VP (the VP field; no abilities). The on-BUY
    // remodel lives in buildTriggers (header register).
    kit.cardDef(IDS.Farmland, 'Farmland', 6, 0, 2,
      'Worth 2 victory points. When you buy this, trash a card from your hand and gain a non-Farmland card costing exactly $2 more than it.'),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, DURATION } = kit.zones;
  const { COST } = kit.fields;
  const { CARD, CHOICE, PLAYER } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /**
   * CAULDRON's fuse: every Action-typed 'gain'/'buy' arrival bumps the
   * gainer's this-turn tally; the transition to EXACTLY 3 boils over every
   * Cauldron in the gainer's play area — each deals the (un-warded) opponent
   * a Curse, inline, with no response window (the Moat window opened when
   * the Cauldron was PLAYED — see the module header).
   */
  const cauldronWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_hinterb_cauldron_${tag}`,
    name: `Cauldron: an Action is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.isA(CARD, kit.types.ACTION),
    script: [
      changeVar(CAULDRON_COUNT_VAR, num(1), GAINER),
      iff(allOf(
        eq(getVar(CAULDRON_COUNT_VAR, GAINER), num(3)),
        gt(countCards(zone(INPLAY, GAINER), kit.nameIs('Cauldron')), num(0)),
      ), [
        announce('The third Action of the turn — the Cauldron boils over!'),
        forEachCard(zone(INPLAY, GAINER), kit.nameIs('Cauldron'), [
          forEachPlayer([
            iff(allOf(
              neq(PLAYER, GAINER),
              eq(getVar(CAULDRON_WARD_VAR, PLAYER), num(0)),
              gt(countCards(zone(SUPPLY), kit.nameIs('Curse')), num(0)),
            ), [
              announce(PLAYER, ' gains a Curse from the cauldron.'),
              kit.tmove(
                specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Curse'))),
                zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
              ),
            ]),
          ]),
        ]),
      ]),
    ],
  });

  /**
   * BERSERKER's on-gain play: with an Action in play (In Play + parked
   * DURATION cards — header register), the gained Berserker marches straight
   * to In Play with a real 'play'-tagged move, firing both on-play halves.
   * The specific selector's `from` is advisory — deck- or hand-gained copies
   * are taken from wherever they actually landed.
   */
  const berserkerWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_hinterb_berserker_${tag}`,
    name: `Berserker: ${tag === 'buy' ? 'bought' : 'gained'} with an Action in play`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Berserker'),
    script: [
      iff(gt(add(
        countCards(zone(INPLAY, GAINER), kit.IS_ACTION_CARD),
        countCards(zone(DURATION, GAINER), kit.IS_ACTION_CARD),
      ), num(0)), [
        announce(GAINER, ' has an Action in play — the Berserker charges in at once.'),
        kit.tmove(specific(CARD), zone(DISCARD, GAINER), zone(INPLAY, GAINER), 'play', { faceUp: true }),
      ]),
    ],
  });

  /**
   * INN's on-gain shuffle: any number of Action cards from the discard pile
   * (the just-gained Inn included) go onto the deck, then the WHOLE deck is
   * shuffled (header register). SCRATCH counts the picks so an untouched
   * deck is never shuffled for nothing.
   */
  const innWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_hinterb_inn_${tag}`,
    name: `Inn: ${tag === 'buy' ? 'bought' : 'gained'} — shuffle Actions into the deck`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Inn'),
    script: [
      iff(gt(countCards(zone(DISCARD, GAINER), kit.IS_ACTION_CARD), num(0)), [
        setVar(kit.vars.SCRATCH, num(0), GAINER),
        chooseCardsBlock({
          who: GAINER, from: zone(DISCARD, GAINER), filter: kit.IS_ACTION_CARD,
          min: num(0), max: num(99), revealed: true,
          prompt: 'Inn: shuffle any number of Action cards from your discard pile into your deck',
          body: [
            announce(GAINER, ' reveals ', CARD, ' and shuffles it into their deck.'),
            move(specific(CARD), zone(DISCARD, GAINER), zone(DECK, GAINER), { faceUp: false }),
            changeVar(kit.vars.SCRATCH, num(1), GAINER),
          ],
        }),
        iff(gt(getVar(kit.vars.SCRATCH, GAINER), num(0)), [
          shuffle(zone(DECK, GAINER)),
        ]),
      ]),
    ],
  });

  /** SOUK's on-gain trash: up to 2 cards from the gainer's hand. */
  const soukWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_hinterb_souk_${tag}`,
    name: `Souk: ${tag === 'buy' ? 'bought' : 'gained'} — trash up to 2`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Souk'),
    script: [
      iff(gt(zoneCount(zone(HAND, GAINER)), num(0)), [
        chooseCardsBlock({
          who: GAINER, from: zone(HAND, GAINER), min: num(0), max: num(2),
          prompt: 'Souk: you may trash up to 2 cards from your hand',
          body: [
            announce(GAINER, ' trashes ', CARD, ' at the souk.'),
            kit.tmove(specific(CARD), zone(HAND, GAINER), zone(TRASH), 'trash', { faceUp: true }),
          ],
        }),
      ]),
    ],
  });

  /** BORDER VILLAGE's on-gain: gain a card with a lower PRINTED cost. */
  const borderVillageWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_hinterb_border_village_${tag}`,
    name: `Border Village: ${tag === 'buy' ? 'bought' : 'gained'} — gain a cheaper card`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Border Village'),
    script: [
      iff(gt(countCards(zone(SUPPLY), lt(field(CARD, COST), num(6))), num(0)), [
        kit.choosePileBlock({
          who: GAINER, from: zone(SUPPLY),
          filter: lt(field(CARD, COST), num(6)),
          prompt: 'Border Village: gain a card costing less than this',
          body: [
            announce(GAINER, ' gains ', CARD, ' across the border.'),
            kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, GAINER), 'gain', { faceUp: true }),
          ],
        }),
      ], [announce('Nothing in the supply is cheaper than the Border Village.')]),
    ],
  });

  return [
    cauldronWatch('gain'),
    cauldronWatch('buy'),
    berserkerWatch('gain'),
    berserkerWatch('buy'),
    innWatch('gain'),
    innWatch('buy'),
    soukWatch('gain'),
    soukWatch('buy'),
    borderVillageWatch('gain'),
    borderVillageWatch('buy'),

    // HAGGLER's while-in-play watcher: each Haggler in the buyer's play area
    // haggles one mandatory cheaper non-Victory gain per 'buy'-tagged arrival
    // (the buy action and the Black Market both — Merchant Guild's
    // precedent). The cap is the bought card's PRINTED cost, stashed in a
    // dedicated var so nested gain triggers cannot clobber it between two
    // Hagglers' iterations.
    {
      id: 'dom_trigger_hinterb_haggler_buy',
      name: 'Haggler: a bought card haggles a bonus',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
      condition: null,
      script: [
        iff(gt(countCards(zone(INPLAY, GAINER), kit.nameIs('Haggler')), num(0)), [
          setVar(HAGGLER_CAP_VAR, field(CARD, COST), GAINER),
          forEachCard(zone(INPLAY, GAINER), kit.nameIs('Haggler'), [
            iff(gt(countCards(zone(SUPPLY), allOf(
              not(kit.isA(CARD, kit.types.VICTORY)),
              lt(field(CARD, COST), getVar(HAGGLER_CAP_VAR, GAINER)),
            )), num(0)), [
              kit.choosePileBlock({
                who: GAINER, from: zone(SUPPLY),
                filter: allOf(
                  not(kit.isA(CARD, kit.types.VICTORY)),
                  lt(field(CARD, COST), getVar(HAGGLER_CAP_VAR, GAINER)),
                ),
                prompt: 'Haggler: gain a non-Victory card cheaper than the bought card',
                body: [
                  announce(GAINER, ' haggles a free ', CARD, ' into the deal.'),
                  kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, GAINER), 'gain', { faceUp: true }),
                ],
              }),
            ], [announce('Nothing in the supply is cheap enough to haggle for.')]),
          ]),
        ]),
      ],
    },

    // FARMLAND's on-BUY remodel (header register): mandatory trash (whiffs
    // on an empty hand), then a gain costing EXACTLY $2 more (printed
    // costs), never another Farmland.
    {
      id: 'dom_trigger_hinterb_farmland_buy',
      name: 'Farmland: bought — remodel a hand card by exactly $2',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
      condition: kit.nameIs('Farmland'),
      script: [
        iff(gt(zoneCount(zone(HAND, GAINER)), num(0)), [
          chooseCard({
            who: GAINER, from: zone(HAND, GAINER),
            prompt: 'Farmland: trash a card from your hand',
          }),
          setVar(FARMLAND_CAP_VAR, add(field(CHOICE, COST), num(2)), GAINER),
          announce(GAINER, ' trashes ', CHOICE, ' under the plough.'),
          kit.tmove(specific(CHOICE), zone(HAND, GAINER), zone(TRASH), 'trash', { faceUp: true }),
          iff(gt(countCards(zone(SUPPLY), allOf(
            eq(field(CARD, COST), getVar(FARMLAND_CAP_VAR, GAINER)),
            neq(field(CARD, 'name'), str('Farmland')),
          )), num(0)), [
            kit.choosePileBlock({
              who: GAINER, from: zone(SUPPLY),
              filter: allOf(
                eq(field(CARD, COST), getVar(FARMLAND_CAP_VAR, GAINER)),
                neq(field(CARD, 'name'), str('Farmland')),
              ),
              prompt: 'Farmland: gain a card costing exactly $2 more than the trashed card',
              body: [
                announce(GAINER, ' gains ', CARD, ' for the new fields.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, GAINER), 'gain', { faceUp: true }),
              ],
            }),
          ], [announce('Nothing in the supply costs exactly $2 more — the field lies fallow.')]),
        ], [announce(GAINER, ' has no card to trash — the Farmland changes nothing.')]),
      ],
    },
  ];
}

export const hinterlands2eB: ExpansionModule = {
  id: 'hinterlands2eB',
  setName: 'Hinterlands',

  piles: [
    { name: 'Berserker', cost: 5, count: 10 },
    { name: 'Cartographer', cost: 5, count: 10 },
    { name: 'Cauldron', cost: 5, count: 10 },
    { name: 'Haggler', cost: 5, count: 10 },
    { name: 'Highway', cost: 5, count: 10 },
    { name: 'Inn', cost: 5, count: 10 },
    { name: 'Margrave', cost: 5, count: 10 },
    { name: 'Souk', cost: 5, count: 10 },
    { name: 'Stables', cost: 5, count: 10 },
    { name: 'Wheelwright', cost: 5, count: 10 },
    { name: "Witch's Hut", cost: 5, count: 10 },
    { name: 'Border Village', cost: 6, count: 10 },
    { name: 'Farmland', cost: 6, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Berserker', 'Cauldron', 'Margrave', "Witch's Hut"],
  treasureNames: ['Cauldron'],
  victoryNames: ['Farmland'],

  variables: [
    {
      id: CAULDRON_COUNT_VAR, name: 'Cauldron: Actions gained this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: CAULDRON_WARD_VAR, name: 'Cauldron: warded this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: WITCHS_HUT_VAR, name: "Witch's Hut: Actions discarded",
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: HAGGLER_CAP_VAR, name: 'Haggler: bought-card cost',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: FARMLAND_CAP_VAR, name: 'Farmland: exact-cost target',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  buildCards,
  buildTriggers,

  buildCleanupResets(kit: CardKit): Block[] {
    // Per-turn state fades with the turn, for every seat (Possession-proof).
    return [forEachPlayer([
      setVar(CAULDRON_COUNT_VAR, num(0), kit.PLAYER),
      setVar(CAULDRON_WARD_VAR, num(0), kit.PLAYER),
    ])];
  },
};
