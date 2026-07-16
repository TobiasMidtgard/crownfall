/**
 * Hinterlands 2E (part A) — Crossroads, Fool's Gold, Develop, Guard Dog,
 * Oasis, Scheme, Tunnel, Jack of All Trades, Nomads, Spice Merchant, Trader,
 * Trail, Weaver.
 *
 * The set's ON-GAIN / REACTION half. House idioms follow the earlier modules:
 * on-gain reactions are 'gain'/'buy'-tagged cardEnterZone watchers
 * (Watchtower's idiom — a bought card is gained, so both tags are watched),
 * discard reactions watch the 'discard' tag ONLY (the cleanup sweep is tagged
 * 'cleanup', so the printed "other than during Clean-up" is structural, for
 * free), every mandatory choice is guarded so a session can never hang, and
 * numbers that must survive nested triggers ride module-private per-player
 * variables instead of SCRATCH.
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "another player" /
 * "each other player" is the one opponent everywhere below.
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - WEAVER TYPE (prominent): printed "Treasure – Reaction"; here the primary
 *    type is ACTION (integration directive: Fool's Gold is this module's only
 *    treasure-typed card), so Weaver is played in the action phase and costs
 *    an Action. The on-play choice and the discard reaction are unchanged.
 *  - GUARD DOG reaction: "when another player plays an Attack card, you may
 *    first play this from your hand" is a response-speed action (Moat's
 *    shape): legal while an Attack is pending, you are not the attacker, and
 *    a Guard Dog sits in your hand. Playing it costs no Action and its draws
 *    resolve BEFORE the attack does (the response window IS the printed
 *    "first"). The player must actively use it, like revealing a Moat.
 *  - FOOL'S GOLD value: the treasure action pays the printed coin FIELD,
 *    which must be static — FG's field is 0 and the real value rides the
 *    on-play ability (+$1 for the first FG played this turn, +$4 after; a
 *    hidden per-player counter reset at cleanup). A Tiara-doubled FG counts
 *    both plays, as printed.
 *  - FOOL'S GOLD reaction: one prompt per holder (trash ANY NUMBER of FGs
 *    from hand, each gaining a Gold onto the deck) instead of paper's
 *    one-at-a-time reveals; "reveal" is an announcement.
 *  - SCHEME: the printed "this turn, when you discard an Action from play,
 *    you may topdeck it" fires as a phaseStart-of-cleanup ability while
 *    Scheme is in play (Treasury's idiom): one optional pick per Scheme IN
 *    PLAY, moved to the deck top BEFORE the sweep and redraw — so it lands in
 *    the next hand, the printed timing's usual outcome. A Throne-Roomed
 *    Scheme therefore grants ONE topdeck (per card instance, not per play).
 *  - DEVELOP: the two exact-cost gains compare PRINTED costs (Stonemason /
 *    Swindler precedent — a live Bridge discount is ignored on exact-cost
 *    matches) and resolve in a FIXED order ($1 more first, then $1 less)
 *    instead of the printed "in either order".
 *  - TRADER on-play: "gain a Silver per $1 it costs" is unrolled to a
 *    documented cap of 11 Silvers (the dearest supply card — Colony); the
 *    reaction is a 'gain'/'buy' watcher gated OFF gained Silvers (a
 *    Silver-for-Silver swap is pointless and would re-trigger itself). The
 *    swapped card goes back to its supply pile via an UNTAGGED move (the
 *    EMPTY_PILES tally only recomputes when a card LEAVES the supply, so a
 *    refilled pile can stay counted empty until the next supply move), and
 *    the replacement Silver lands in the discard regardless of where the
 *    original gain went. The offer is withheld when the gained card already
 *    left for the trash or the supply (a Watchtower answered first).
 *  - TRAIL: the gain/buy play-offer is withheld when the card already left
 *    for the trash, the supply or in-play (a Watchtower or Trader answered
 *    first — Trader's exchange offer is deliberately ordered BEFORE Trail's
 *    play offer). The trash-reaction plays it from the trash to the CURRENT
 *    player's in-play ("you" = the trasher — also the reading for NOMADS'
 *    trash +$2; in this 2-player world off-turn trashes are the acting
 *    player's doing).
 *  - CROSSROADS: "Victory card" counts primary-type Victory only (Tunnel
 *    counts; sibling-module duals that keep Action/Treasure primaries do
 *    not) — the one-primary-type world's usual knock-on.
 *  - JACK OF ALL TRADES: the look-at-top is announced publicly (Library's
 *    idiom — no private-reveal primitive); the put-back keeps the card's
 *    place on top.
 */
import type {
  AbilityDef, ActionDef, Block, CardDef, Expr, TriggerDef, VariableDef,
} from '../../shared/types';
import {
  ALL, CURRENT, STACK_SIZE, STACK_TOP, add, allOf, announce, bestCard, bnd, cardZoneId,
  changeVar, chooseCard, chooseCardsBlock, chooseOption, countCards, eq, field, forEachPlayer,
  getVar, gt, iff, lt, lte, move, neq, not, num, setVar, shuffle, specific, str, sub, topCard,
  topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Crossroads: 'dom_card_crossroads',
  "Fool's Gold": 'dom_card_fools_gold',
  Develop: 'dom_card_develop',
  'Guard Dog': 'dom_card_guard_dog',
  Oasis: 'dom_card_oasis',
  Scheme: 'dom_card_scheme',
  Tunnel: 'dom_card_tunnel',
  'Jack of All Trades': 'dom_card_jack_of_all_trades',
  Nomads: 'dom_card_nomads',
  'Spice Merchant': 'dom_card_spice_merchant',
  Trader: 'dom_card_trader',
  Trail: 'dom_card_trail',
  Weaver: 'dom_card_weaver',
};

/** Fool's Golds played this turn (0 = the next one is the first); cleanup-reset. */
export const FOOLS_GOLD_PLAYED_VAR = 'dom_var_fools_gold_played';
/** Crossroads played this turn (0 = the next one grants +3 Actions); cleanup-reset. */
export const CROSSROADS_PLAYED_VAR = 'dom_var_crossroads_played';
/** Develop: the trashed card's printed cost (read by both exact-cost gains). */
export const DEVELOP_COST_VAR = 'dom_var_develop_cost';
/** Trader: Silvers still owed by the unrolled gain loop. */
export const TRADER_SILVERS_VAR = 'dom_var_trader_silvers';

/** The documented Trader cap: costs top out at Colony's 11. */
export const TRADER_SILVER_CAP = 11;

/** The action/cleanup phase ids (stable dominionGame.ts literals — Seaside's idiom). */
const PHASE_CLEANUP = 'dom_phase_cleanup';

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
  const { ACTIONS, BUYS, COINS, SCRATCH } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE } = kit;
  const { nameIs } = kit;

  /** Gain the named basic from the supply into `to` (guarded on the pile). */
  const gainNamed = (name: string, to: ReturnType<typeof zone>, who: Expr, note: string, empty: string,
    toPosition?: 'top' | 'bottom'): Block =>
    iff(gt(countCards(zone(SUPPLY), nameIs(name)), num(0)), [
      announce(who, note),
      kit.tmove(
        specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs(name))),
        zone(SUPPLY), to, 'gain', { faceUp: true, ...(toPosition ? { toPosition } : {}) },
      ),
    ], [announce(empty)]);

  /** Develop's exact-cost gain onto the deck (PRINTED costs — see the register). */
  const developGain = (cost: Expr, label: string): Block =>
    iff(gt(countCards(zone(SUPPLY), eq(field(CARD, COST), cost)), num(0)), [
      kit.choosePileBlock({
        who: OWNER, from: zone(SUPPLY),
        filter: eq(field(CARD, COST), cost),
        prompt: `Develop: gain a card costing exactly ${label} onto your deck`,
        body: [
          announce(OWNER, ' develops ', CARD, ' — it goes onto their deck.'),
          kit.tmove(specific(CARD), zone(SUPPLY), zone(DECK, OWNER), 'gain',
            { toPosition: 'top', faceUp: true }),
        ],
      }),
    ], [announce(`No supply card costs exactly ${label} — that half whiffs.`)]);

  // SCHEME's cleanup half (see the register): at the START of the owner's
  // cleanup phase — before the sweep and the redraw — each Scheme in play
  // offers to topdeck one Action from play (Scheme itself qualifies). The
  // topdecked card is then drawn straight back by the redraw, the printed
  // timing's usual outcome. Untagged move: it is not a discard.
  const schemeCleanup: AbilityDef = {
    id: 'dom_ab_scheme_cleanup',
    name: 'Scheme — topdeck at cleanup',
    on: 'phaseStart', zoneId: INPLAY, phaseId: PHASE_CLEANUP,
    condition: eq(CURRENT, OWNER),
    script: [
      iff(gt(countCards(zone(INPLAY, OWNER), kit.IS_ACTION_CARD), num(0)), [
        chooseCardsBlock({
          who: OWNER, from: zone(INPLAY, OWNER), filter: kit.IS_ACTION_CARD,
          min: num(0), max: num(1),
          prompt: 'Scheme: put an Action card from play onto your deck?',
          body: [
            announce(OWNER, ' schemes ', CARD, ' onto their deck.'),
            move(specific(CARD), zone(INPLAY, OWNER), zone(DECK, OWNER),
              { toPosition: 'top', faceUp: false }),
          ],
        }),
      ]),
    ],
  };

  return [
    // CROSSROADS — reveal = announcement; the draw count is taken BEFORE the
    // draws (SCRATCH, Cellar's idiom). DEVIATION (register): "Victory card"
    // counts primary-type Victory only. The +3 Actions is once per turn per
    // PLAY (a Throne-Roomed second play grants none, as printed).
    kit.cardDef(IDS.Crossroads, 'Crossroads', 2, 0, 0,
      'Reveal your hand. +1 Card per Victory card revealed. If this is the first time you played a Crossroads this turn, +3 Actions.', [
        kit.onPlay('dom_ab_crossroads', 'Where the roads meet', [
          announce(OWNER, ' reveals their hand at the crossroads.'),
          setVar(SCRATCH, countCards(zone(HAND, OWNER), kit.isA(CARD, kit.types.VICTORY)), OWNER),
          kit.drawN(OWNER, getVar(SCRATCH, OWNER)),
          iff(eq(getVar(CROSSROADS_PLAYED_VAR, OWNER), num(0)), [
            changeVar(ACTIONS, num(3), OWNER),
            announce(OWNER, ' takes +3 Actions — the first Crossroads this turn.'),
          ]),
          changeVar(CROSSROADS_PLAYED_VAR, num(1), OWNER),
        ]),
      ]),

    // FOOL'S GOLD — Treasure – Reaction. The coin FIELD is 0; the real value
    // rides the ability (register). The Province reaction lives in
    // buildTriggers.
    kit.cardDef(IDS["Fool's Gold"], "Fool's Gold", 2, 0, 0,
      "Worth $1 if it's the first time you played a Fool's Gold this turn, otherwise worth $4. When another player gains a Province, you may trash this from your hand, to gain a Gold onto your deck.", [
        kit.onPlay('dom_ab_fools_gold', 'Glitter or gold', [
          iff(eq(getVar(FOOLS_GOLD_PLAYED_VAR, OWNER), num(0)), [
            changeVar(COINS, num(1), OWNER),
            announce(OWNER, "'s first Fool's Gold pays $1."),
          ], [
            changeVar(COINS, num(4), OWNER),
            announce(OWNER, "'s Fool's Gold pays $4 — fool me twice."),
          ]),
          changeVar(FOOLS_GOLD_PLAYED_VAR, num(1), OWNER),
        ]),
      ]),

    // DEVELOP — trash, then the two exact-cost gains onto the deck.
    // DEVIATIONS (register): printed costs, fixed order (+1 then -1).
    kit.cardDef(IDS.Develop, 'Develop', 3, 0, 0,
      'Trash a card from your hand. Gain two cards onto your deck, with one costing exactly $1 more than it, and one costing exactly $1 less than it, in either order.', [
        kit.onPlay('dom_ab_develop', 'Plans within plans', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Develop: trash a card from your hand',
            }),
            setVar(DEVELOP_COST_VAR, field(CHOICE, COST), OWNER),
            announce(OWNER, ' trashes ', CHOICE, ' to the developers.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            developGain(add(getVar(DEVELOP_COST_VAR, OWNER), num(1)), '$1 more'),
            developGain(sub(getVar(DEVELOP_COST_VAR, OWNER), num(1)), '$1 less'),
          ], [announce(OWNER, ' has nothing to develop.')]),
        ]),
      ]),

    // GUARD DOG — Action – Reaction. The draws are exact; the reaction is the
    // response-speed action in buildActions (register).
    kit.cardDef(IDS['Guard Dog'], 'Guard Dog', 3, 0, 0,
      '+2 Cards. If you have 5 or fewer cards in hand, +2 Cards. When another player plays an Attack card, you may first play this from your hand.', [
        kit.onPlay('dom_ab_guard_dog', 'Hackles up', [
          kit.draw(OWNER, 2),
          iff(lte(zoneCount(zone(HAND, OWNER)), num(5)), [
            announce(OWNER, "'s hand is thin — the Guard Dog fetches 2 more."),
            kit.draw(OWNER, 2),
          ]),
        ]),
      ]),

    // OASIS — exact. The mandatory discard is guarded (an exhausted deck can
    // leave the hand empty) and 'discard'-tagged, so a discarded Tunnel /
    // Weaver / Trail reacts, as printed.
    kit.cardDef(IDS.Oasis, 'Oasis', 3, 0, 0,
      '+1 Card. +1 Action. +$1. Discard a card.', [
        kit.onPlay('dom_ab_oasis', 'Shade and water', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(COINS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(1), max: num(1),
              prompt: 'Oasis: discard a card',
              body: [
                announce(OWNER, ' discards ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ],
            }),
          ]),
        ]),
      ]),

    // SCHEME — the play half is exact; the topdeck rides the cleanup-phase
    // ability above (register: one topdeck per Scheme IN PLAY).
    kit.cardDef(IDS.Scheme, 'Scheme', 3, 0, 0,
      '+1 Card. +1 Action. This turn, you may put one of your Action cards onto your deck when you discard it from play.', [
        kit.onPlay('dom_ab_scheme', 'Lay the groundwork', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          announce(OWNER, ' schemes — an Action may ride the deck at cleanup.'),
        ]),
        schemeCleanup,
      ]),

    // TUNNEL — Victory – Reaction, 2 VP (the VP field; every recount counts
    // it). The discard reaction lives in buildTriggers.
    kit.cardDef(IDS.Tunnel, 'Tunnel', 3, 0, 2,
      'Worth 2 victory points. When you discard this other than during Clean-up, you may reveal it to gain a Gold.'),

    // JACK OF ALL TRADES — the 4-step script. DEVIATION (register): the look
    // is announced publicly.
    kit.cardDef(IDS['Jack of All Trades'], 'Jack of All Trades', 4, 0, 0,
      "Gain a Silver. Look at the top card of your deck; you may discard it. Draw until you have 5 cards in hand. You may trash a card from your hand that is not a Treasure.", [
        kit.onPlay('dom_ab_jack_of_all_trades', 'A bit of everything', [
          // 1. Gain a Silver.
          gainNamed('Silver', zone(DISCARD, OWNER), OWNER, ' gains a Silver.',
            'The Silver pile is empty — no Silver for Jack.'),
          // 2. Look at the top card; you may discard it.
          refillDeck(kit, OWNER),
          iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
            move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: false }),
            announce(OWNER, ' looks at ', topCard(zone(LOOK)), ' on top of their deck.'),
            yesNo(OWNER, 'Jack of All Trades: discard the top card of your deck?'),
            iff(CHOICE, [
              announce(OWNER, ' discards it.'),
              kit.tmove(specific(topCard(zone(LOOK))), zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
            ], [
              move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
            ]),
          ], [announce(OWNER, ' has no cards left to look at.')]),
          // 3. Draw until 5 cards are in hand (clamped at 0 when fuller).
          setVar(SCRATCH, sub(num(5), zoneCount(zone(HAND, OWNER))), OWNER),
          iff(lt(getVar(SCRATCH, OWNER), num(0)), [setVar(SCRATCH, num(0), OWNER)]),
          kit.drawN(OWNER, getVar(SCRATCH, OWNER)),
          // 4. Optionally trash a non-Treasure from hand.
          iff(gt(countCards(zone(HAND, OWNER), not(kit.IS_TREASURE_CARD)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: not(kit.IS_TREASURE_CARD),
              min: num(0), max: num(1),
              prompt: 'Jack of All Trades: you may trash a non-Treasure card from your hand',
              body: [
                announce(OWNER, ' trashes ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              ],
            }),
          ]),
        ]),
      ]),

    // NOMADS — the play half is exact; the on-gain/on-trash +$2 rides the
    // buildTriggers watchers (trash side pays the CURRENT player — register).
    kit.cardDef(IDS.Nomads, 'Nomads', 4, 0, 0,
      '+1 Buy. +$2. When you gain or trash this, +$2.', [
        kit.onPlay('dom_ab_nomads', 'The caravan arrives', [
          changeVar(BUYS, num(1), OWNER),
          changeVar(COINS, num(2), OWNER),
        ]),
      ]),

    // SPICE MERCHANT — exact: the trash is optional; taking it opens the
    // either/or.
    kit.cardDef(IDS['Spice Merchant'], 'Spice Merchant', 4, 0, 0,
      'You may trash a Treasure from your hand. If you do, choose one: +2 Cards and +1 Action; or +1 Buy and +$2.', [
        kit.onPlay('dom_ab_spice_merchant', 'Cinnamon and saffron', [
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_TREASURE_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_TREASURE_CARD,
              min: num(0), max: num(1),
              prompt: 'Spice Merchant: you may trash a Treasure from your hand',
              body: [
                announce(OWNER, ' trashes ', CARD, ' for the spice trade.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
                chooseOption('Spice Merchant: choose one', [
                  { id: 'sm_cards', label: '+2 Cards and +1 Action' },
                  { id: 'sm_coins', label: '+1 Buy and +$2' },
                ], OWNER),
                iff(eq(CHOICE, str('sm_cards')), [
                  kit.draw(OWNER, 2),
                  changeVar(ACTIONS, num(1), OWNER),
                ], [
                  changeVar(BUYS, num(1), OWNER),
                  changeVar(COINS, num(2), OWNER),
                ]),
              ],
            }),
          ], [announce(OWNER, ' has no Treasure for the spice trade.')]),
        ]),
      ]),

    // TRADER — Action – Reaction. The on-play trash is mandatory (guarded on
    // an empty hand); the Silvers arrive one at a time, unrolled to the
    // documented cap of 11 (register). The exchange reaction lives in
    // buildTriggers.
    kit.cardDef(IDS.Trader, 'Trader', 4, 0, 0,
      'Trash a card from your hand. Gain a Silver per $1 it costs. When you gain a card, you may reveal this from your hand, to exchange the card for a Silver.', [
        kit.onPlay('dom_ab_trader', 'Everything has a price', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Trader: trash a card from your hand',
            }),
            setVar(TRADER_SILVERS_VAR, field(CHOICE, COST), OWNER),
            announce(OWNER, ' trashes ', CHOICE, ' — a Silver per $1 it cost.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            ...Array.from({ length: TRADER_SILVER_CAP }, (): Block =>
              iff(gt(getVar(TRADER_SILVERS_VAR, OWNER), num(0)), [
                changeVar(TRADER_SILVERS_VAR, num(-1), OWNER),
                iff(gt(countCards(zone(SUPPLY), nameIs('Silver')), num(0)), [
                  announce(OWNER, ' gains a Silver.'),
                  kit.tmove(
                    specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Silver'))),
                    zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
                  ),
                ], [
                  announce('The Silver pile is empty — the trade is off.'),
                  setVar(TRADER_SILVERS_VAR, num(0), OWNER),
                ]),
              ])),
          ], [announce(OWNER, ' has nothing left to trade.')]),
        ]),
      ]),

    // TRAIL — Action – Reaction. The play half is exact; the gain/trash/
    // discard reactions live in buildTriggers (register).
    kit.cardDef(IDS.Trail, 'Trail', 4, 0, 0,
      '+1 Card. +1 Action. When you gain, trash, or discard this, other than during Clean-up, you may play it.', [
        kit.onPlay('dom_ab_trail', 'Off the beaten path', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
        ]),
      ]),

    // WEAVER — printed Treasure – Reaction; ACTION-typed here (the register's
    // prominent deviation). The discard reaction lives in buildTriggers.
    kit.cardDef(IDS.Weaver, 'Weaver', 4, 0, 0,
      'Gain 2 Silvers or a card costing up to $4. When you discard this other than during Clean-up, you may play it.', [
        kit.onPlay('dom_ab_weaver', 'Warp and weft', [
          chooseOption('Weaver: choose one', [
            { id: 'wv_silvers', label: 'Gain 2 Silvers' },
            { id: 'wv_gain', label: 'Gain a card costing up to $4' },
          ], OWNER),
          iff(eq(CHOICE, str('wv_silvers')), [
            gainNamed('Silver', zone(DISCARD, OWNER), OWNER, ' gains a Silver.',
              'The Silver pile is empty — the loom stands idle.'),
            gainNamed('Silver', zone(DISCARD, OWNER), OWNER, ' gains a Silver.',
              'The Silver pile is empty — the loom stands idle.'),
          ], [
            ...kit.gainFromSupply({
              limit: num(4),
              prompt: 'Weaver: gain a card costing up to $4',
              whiff: [announce('Nothing in the supply is cheap enough to weave.')],
            }),
          ]),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY } = kit.zones;
  const { COINS } = kit.vars;
  const { COST } = kit.fields;
  const { CARD, CHOICE, PLAYER } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer /
   *  discarder (null for the shared trash, where CURRENT stands in). */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /**
   * FOOL'S GOLD's reaction (register): when a Province lands ('gain' AND
   * 'buy' — a bought Province is gained), every OTHER player holding FGs may
   * trash any number of them, each gaining a Gold onto their deck.
   */
  const foolsGoldWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_fools_gold_${tag}`,
    name: `Fool's Gold: a Province is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Province'),
    script: [
      forEachPlayer([
        iff(allOf(
          neq(PLAYER, GAINER),
          gt(countCards(zone(HAND, PLAYER), kit.nameIs("Fool's Gold")), num(0)),
        ), [
          chooseCardsBlock({
            who: PLAYER, from: zone(HAND, PLAYER), filter: kit.nameIs("Fool's Gold"),
            min: num(0), max: num(99),
            prompt: "Fool's Gold: trash any number from your hand — each gains a Gold onto your deck",
            body: [
              announce(PLAYER, " reveals and trashes a Fool's Gold."),
              kit.tmove(specific(CARD), zone(HAND, PLAYER), zone(TRASH), 'trash', { faceUp: true }),
              iff(gt(countCards(zone(SUPPLY), kit.nameIs('Gold')), num(0)), [
                announce(PLAYER, ' gains a Gold onto their deck.'),
                kit.tmove(
                  specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Gold'))),
                  zone(SUPPLY), zone(DECK, PLAYER), 'gain', { toPosition: 'top', faceUp: true },
                ),
              ], [announce('The Gold pile is empty — the trade is off.')]),
            ],
          }),
        ]),
      ]),
    ],
  });

  /** NOMADS' on-gain +$2 (the gainer's turn coins — usable when it is their buy phase). */
  const nomadsGainWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_nomads_${tag}`,
    name: `Nomads: ${tag === 'buy' ? 'bought' : 'gained'} — +$2`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Nomads'),
    script: [
      changeVar(COINS, num(2), GAINER),
      announce(GAINER, ' takes +$2 from the Nomads.'),
    ],
  });

  /**
   * TRADER's exchange reaction (register): a Trader in the GAINER's hand may
   * swap the gained card (never a Silver — the swap's own gain would
   * re-trigger) back to the supply for a Silver. Withheld when the card
   * already left for the trash or the supply (a Watchtower answered first).
   */
  const traderWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_trader_${tag}`,
    name: `Trader: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: neq(field(kit.CARD, 'name'), str('Silver')),
    script: [
      iff(allOf(
        gt(countCards(zone(HAND, GAINER), kit.nameIs('Trader')), num(0)),
        neq(cardZoneId(CARD), str(TRASH)),
        neq(cardZoneId(CARD), str(SUPPLY)),
      ), [
        yesNo(GAINER, 'Trader: reveal it to exchange the gained card for a Silver?'),
        iff(CHOICE, [
          announce(GAINER, ' reveals Trader — the gained ', CARD, ' goes back to the supply.'),
          move(specific(CARD), zone(DISCARD, GAINER), zone(SUPPLY), { faceUp: true }),
          iff(gt(countCards(zone(SUPPLY), kit.nameIs('Silver')), num(0)), [
            announce(GAINER, ' gains a Silver instead.'),
            kit.tmove(
              specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Silver'))),
              zone(SUPPLY), zone(DISCARD, GAINER), 'gain', { faceUp: true },
            ),
          ], [announce('The Silver pile is empty — nothing in exchange.')]),
        ]),
      ]),
    ],
  });

  /**
   * TRAIL's gain/buy/discard play-offer. The guards (register): skip when the
   * card already left for the trash, the supply (Trader / Watchtower answered
   * first) or in-play (already played). specific's `from` is advisory — a
   * Develop gain onto the DECK still plays from wherever it sits.
   */
  const trailWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_trail_${tag}`,
    name: `Trail: ${tag === 'discard' ? 'discarded' : tag === 'buy' ? 'bought' : 'gained'} — play it?`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Trail'),
    script: [
      iff(allOf(
        neq(cardZoneId(CARD), str(TRASH)),
        neq(cardZoneId(CARD), str(SUPPLY)),
        neq(cardZoneId(CARD), str(INPLAY)),
      ), [
        yesNo(GAINER, 'Trail: play it now?'),
        iff(CHOICE, [
          announce(GAINER, ' takes the Trail — it is played.'),
          kit.tmove(specific(CARD), zone(DISCARD, GAINER), zone(INPLAY, GAINER), 'play', { faceUp: true }),
        ]),
      ]),
    ],
  });

  return [
    foolsGoldWatch('gain'),
    foolsGoldWatch('buy'),

    nomadsGainWatch('gain'),
    nomadsGainWatch('buy'),
    // NOMADS trashed: +$2 to the CURRENT player — the trasher (register).
    {
      id: 'dom_trigger_nomads_trash',
      name: 'Nomads: trashed — +$2',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'trash' },
      condition: kit.nameIs('Nomads'),
      script: [
        changeVar(COINS, num(2), CURRENT),
        announce('The Nomads pay +$2 on their way to the trash.'),
      ],
    },

    // TRADER's exchange offer deliberately precedes TRAIL's play offer, so a
    // swapped Trail is safely in the supply before Trail's watcher looks.
    traderWatch('gain'),
    traderWatch('buy'),

    // TUNNEL: discarded outside cleanup ('discard' tag only — the cleanup
    // sweep is tagged 'cleanup') → may reveal to gain a Gold.
    {
      id: 'dom_trigger_tunnel_discard',
      name: 'Tunnel: discarded — reveal for a Gold?',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'discard' },
      condition: kit.nameIs('Tunnel'),
      script: [
        yesNo(GAINER, 'Tunnel: reveal it to gain a Gold?'),
        iff(CHOICE, [
          announce(GAINER, ' reveals the Tunnel.'),
          iff(gt(countCards(zone(SUPPLY), kit.nameIs('Gold')), num(0)), [
            announce(GAINER, ' gains a Gold.'),
            kit.tmove(
              specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Gold'))),
              zone(SUPPLY), zone(DISCARD, GAINER), 'gain', { faceUp: true },
            ),
          ], [announce('The Gold pile is empty — the tunnel leads nowhere.')]),
        ]),
      ],
    },

    // WEAVER: discarded outside cleanup → may play it (the 'play'-tagged move
    // fires its on-play choice normally).
    {
      id: 'dom_trigger_weaver_discard',
      name: 'Weaver: discarded — play it?',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'discard' },
      condition: kit.nameIs('Weaver'),
      script: [
        iff(eq(cardZoneId(CARD), str(DISCARD)), [
          yesNo(GAINER, 'Weaver: play it from your discard pile?'),
          iff(CHOICE, [
            announce(GAINER, ' sets the discarded Weaver to work.'),
            kit.tmove(specific(CARD), zone(DISCARD, GAINER), zone(INPLAY, GAINER), 'play', { faceUp: true }),
          ]),
        ]),
      ],
    },

    trailWatch('gain'),
    trailWatch('buy'),
    trailWatch('discard'),
    // TRAIL trashed: the CURRENT player (the trasher — register) may play it
    // straight out of the trash.
    {
      id: 'dom_trigger_trail_trash',
      name: 'Trail: trashed — play it?',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'trash' },
      condition: kit.nameIs('Trail'),
      script: [
        iff(eq(cardZoneId(CARD), str(TRASH)), [
          yesNo(CURRENT, 'Trail: play it from the trash?'),
          iff(CHOICE, [
            announce('The Trail doubles back out of the trash — it is played.'),
            kit.tmove(specific(CARD), zone(TRASH), zone(INPLAY, CURRENT), 'play', { faceUp: true }),
          ]),
        ]),
      ],
    },
  ];
}

function buildActions(kit: CardKit): ActionDef[] {
  const { HAND, INPLAY } = kit.zones;
  return [
    // GUARD DOG's reaction (register): Moat's response shape — while an
    // Attack is pending and you are not the attacker, play a Guard Dog from
    // your hand; the 'play'-tagged move fires its draws BEFORE the attack
    // resolves, and no Action is spent.
    {
      id: 'dom_action_guard_dog',
      name: 'Guard Dog: play it before the attack',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      speed: 'response',
      legality: allOf(
        kit.nameIs('Guard Dog'),
        gt(STACK_SIZE, num(0)),
        kit.hasTag(STACK_TOP, kit.tags.ATTACK),
        neq(bnd('$player'), CURRENT),
      ),
      script: [
        announce(bnd('$player'), ' looses the Guard Dog ahead of the attack.'),
        kit.tmove(specific(bnd('$card')), zone(HAND, bnd('$player')), zone(INPLAY, bnd('$player')), 'play', { faceUp: true }),
      ],
    },
  ];
}

export const hinterlands2eA: ExpansionModule = {
  id: 'hinterlands2eA',
  setName: 'Hinterlands',

  piles: [
    { name: 'Crossroads', cost: 2, count: 10 },
    { name: "Fool's Gold", cost: 2, count: 10 },
    { name: 'Develop', cost: 3, count: 10 },
    { name: 'Guard Dog', cost: 3, count: 10 },
    { name: 'Oasis', cost: 3, count: 10 },
    { name: 'Scheme', cost: 3, count: 10 },
    { name: 'Tunnel', cost: 3, count: 10 },
    { name: 'Jack of All Trades', cost: 4, count: 10 },
    { name: 'Nomads', cost: 4, count: 10 },
    { name: 'Spice Merchant', cost: 4, count: 10 },
    { name: 'Trader', cost: 4, count: 10 },
    { name: 'Trail', cost: 4, count: 10 },
    { name: 'Weaver', cost: 4, count: 10 },
  ],

  ids: IDS,

  reactionNames: ["Fool's Gold", 'Guard Dog', 'Trader', 'Trail', 'Tunnel', 'Weaver'],
  victoryNames: ['Tunnel'],
  treasureNames: ["Fool's Gold"],

  variables: [
    {
      id: FOOLS_GOLD_PLAYED_VAR, name: "Fool's Gold: played this turn",
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: CROSSROADS_PLAYED_VAR, name: 'Crossroads: played this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: DEVELOP_COST_VAR, name: 'Develop: trashed cost',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: TRADER_SILVERS_VAR, name: 'Trader: Silvers owed',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  buildCards,
  buildTriggers,
  buildActions,

  buildCleanupResets(kit: CardKit): Block[] {
    // The per-turn play counters fade with the turn, for every seat.
    return [forEachPlayer([
      setVar(FOOLS_GOLD_PLAYED_VAR, num(0), kit.PLAYER),
      setVar(CROSSROADS_PLAYED_VAR, num(0), kit.PLAYER),
    ])];
  },
};
