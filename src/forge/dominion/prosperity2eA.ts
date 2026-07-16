/**
 * Prosperity 2E (part A) — Anvil, Watchtower, Bishop, Clerk, Investment,
 * Monument, Quarry, Tiara, Worker's Village, Charlatan, City, Collection,
 * Crystal Ball.
 *
 * The set's VP-chip cards (Bishop / Monument / Collection / Investment) bank
 * into the core VP_TOKENS variable — every recount re-adds the bank, so the
 * chips are permanent, exactly like the printed tokens. House idioms follow
 * the Base/Intrigue/Seaside modules: attack halves are separate
 * `stacked: true` abilities gated per victim on IMMUNE == 0 (the shared
 * effectResolved trigger resets it), every mandatory choice is guarded so a
 * session can never hang, and numbers that must survive a filter's $card
 * rebinding ride the per-player SCRATCH variable.
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "each other player" is
 * the one opponent everywhere below (forEachOpponent).
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - QUARRY (prominent): the engine's only cost lever is the GLOBAL per-turn
 *    DISCOUNT variable (Bridge's). Quarry raises it by 2 on play, so this
 *    turn EVERY card — not just Actions — costs $2 less (buys, Anvil/Workshop
 *    gains, everything Bridge-aware), and the discount holds for the rest of
 *    the turn even if Quarry somehow leaves play. Cleanup resets it. Two
 *    Quarries stack to $4 off, as printed for Actions.
 *  - CHARLATAN: the printed static "In games using this, Curse is also a
 *    Treasure worth $1" is DROPPED — a card here has ONE fixed primary type
 *    def-wide and the treasure action's legality is core surface this module
 *    cannot edit. The attack half (each other player gains a Curse) is exact.
 *  - TIARA: the printed ongoing "when you play a Treasure, you may play it
 *    twice" becomes a ONE-SHOT on resolution — you may play ONE Treasure from
 *    your hand twice (its coin field is paid twice and its on-play abilities
 *    re-fire via the Throne Room mechanism; a doubled Duration treasure parks
 *    once and its next-turn half fires once — the kit's documented contract).
 *    The gain-topdeck half matches print via a while-Tiara-is-in-play watcher
 *    on 'gain' AND 'buy' moves ("this turn" = Tiara in play, which holds
 *    until cleanup); the offer is withheld when the gained card was already
 *    trashed by a Watchtower answered first.
 *  - WATCHTOWER (reaction): no reveal action — while a Watchtower is in the
 *    GAINER's hand, every 'gain'/'buy' move opens a keep / topdeck / trash
 *    prompt to the gainer (chooseOption; keep = decline). The gained card is
 *    named in the shared log (no private-reveal primitive), and a Watchtower
 *    gained straight to the hand counts as "in hand" for its own gain.
 *  - CLERK (reaction): at the owner's action-phase start each Clerk in hand
 *    asks a yes/no; yes plays it free (no Action spent, the attack half
 *    stacks and opens the response window) — the printed timing. Declining
 *    is per-turn-start (you cannot change your mind later that turn).
 *  - INVESTMENT: "differently named Treasure" is counted EXACTLY via a
 *    hidden per-card mark sweep (first copy of each name counts once); the
 *    "reveal your hand" is an announcement (Shanty Town's idiom). The
 *    self-trash is guarded on Investment still being in play, so a
 *    Tiara-doubled Investment cannot trash itself twice.
 *  - CRYSTAL BALL: the looked-at card is announced publicly (Library's
 *    idiom — officially the look is private). Playing it pays a Treasure's
 *    coin field / fires an Action's abilities without spending an Action,
 *    exactly as printed.
 *  - BISHOP: exact, and correctly NOT an Attack (no response window) — the
 *    opponents' optional trashes resolve sequentially in seat order.
 */
import type {
  AbilityDef, Block, CardDef, Expr, TriggerDef, VariableDef,
} from '../../shared/types';
import {
  ALL, CURRENT, allOf, announce, anyOf, bestCard, bnd, cardZoneId, changeVar, chooseCard,
  chooseCardsBlock, chooseOption, countCards, eq, field, forEachCard, forEachOpponent, getVar,
  gt, gte, iff, lt, move, mul, neq, num, setVar, shuffle, specific, str, sub, topCard, topN,
  zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Anvil: 'dom_card_anvil',
  Watchtower: 'dom_card_watchtower',
  Bishop: 'dom_card_bishop',
  Clerk: 'dom_card_clerk',
  Investment: 'dom_card_investment',
  Monument: 'dom_card_monument',
  Quarry: 'dom_card_quarry',
  Tiara: 'dom_card_tiara',
  "Worker's Village": 'dom_card_workers_village',
  Charlatan: 'dom_card_charlatan',
  City: 'dom_card_city',
  Collection: 'dom_card_collection',
  'Crystal Ball': 'dom_card_crystal_ball',
};

/**
 * Investment's distinct-name sweep: a per-card mark set on each hand Treasure
 * already counted, so the second Copper finds a marked namesake and adds
 * nothing. Cleared immediately after the count — never survives the script.
 */
export const INVESTMENT_MARK = 'dom_var_investment_mark';
/** The name under the mark-sweep's lens (strings cannot ride SCRATCH). */
export const INVESTMENT_NAME = 'dom_var_investment_name';

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

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, EMPTY_PILES, SCRATCH, DISCOUNT, VP_TOKENS } = kit.vars;
  const { COST, COINS_F } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER, SELF } = kit;

  // Clerk's reaction half: at the OWNER's action-phase start, each Clerk in
  // their hand offers to play itself for free. The 'play'-tagged move fires
  // both on-play halves (coins inline, the attack stacked — the engine opens
  // the response window for stacked effects raised during phase entry).
  const clerkReact: AbilityDef = {
    id: 'dom_ab_clerk_react',
    name: 'Clerk — start of turn',
    on: 'phaseStart', zoneId: HAND, phaseId: PHASE_ACTION,
    condition: eq(CURRENT, OWNER),
    script: [
      yesNo(OWNER, 'Clerk: play it from your hand now? (It costs no Action.)'),
      iff(CHOICE, [
        announce(OWNER, ' plays Clerk at the start of their turn.'),
        kit.tmove(specific(SELF), zone(HAND, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
      ]),
    ],
  };

  return [
    // ANVIL — Treasure, $1 (the coin field, paid by the treasure action).
    // The discard is optional; the gain rides the core Bridge-aware helper.
    kit.cardDef(IDS.Anvil, 'Anvil', 3, 1, 0,
      '$1. You may discard a Treasure, to gain a card costing up to $4.', [
        kit.onPlay('dom_ab_anvil', 'Strike while hot', [
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_TREASURE_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_TREASURE_CARD,
              min: num(0), max: num(1),
              prompt: 'Anvil: you may discard a Treasure to gain a card costing up to $4',
              body: [
                announce(OWNER, ' discards ', CARD, ' at the Anvil.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                ...kit.gainFromSupply({
                  limit: num(4),
                  prompt: 'Anvil: gain a card costing up to $4',
                  whiff: [announce('Nothing in the supply is cheap enough to forge.')],
                }),
              ],
            }),
          ]),
        ]),
      ]),

    // WATCHTOWER — the main half is exact (draw up to 6, clamped at 0 when
    // the hand is already fuller). The reaction half lives in buildTriggers
    // (see the header register).
    kit.cardDef(IDS.Watchtower, 'Watchtower', 3, 0, 0,
      'Draw until you have 6 cards in hand. When you gain a card, you may reveal this from your hand, to either trash that card or put it onto your deck.', [
        kit.onPlay('dom_ab_watchtower', 'Eyes on every road', [
          setVar(SCRATCH, sub(num(6), zoneCount(zone(HAND, OWNER))), OWNER),
          iff(lt(getVar(SCRATCH, OWNER), num(0)), [setVar(SCRATCH, num(0), OWNER)]),
          kit.drawN(OWNER, getVar(SCRATCH, OWNER)),
        ]),
      ]),

    // BISHOP — +1 chip flat, then half the trashed card's printed cost
    // (floored: (c - c%2)/2 — exact integer math). Not an Attack (printed):
    // the opponents' optional trashes open no response window.
    kit.cardDef(IDS.Bishop, 'Bishop', 4, 0, 0,
      '+$1. +1 VP. Trash a card from your hand. +1 VP per $2 it costs (round down). Each other player may trash a card from their hand.', [
        kit.onPlay('dom_ab_bishop', 'Tithes and offerings', [
          changeVar(COINS, num(1), OWNER),
          changeVar(VP_TOKENS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Bishop: trash a card from your hand',
            }),
            setVar(SCRATCH, field(CHOICE, COST), OWNER),
            announce(OWNER, ' trashes ', CHOICE, ' before the Bishop.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            changeVar(VP_TOKENS,
              kit.div(sub(getVar(SCRATCH, OWNER), kit.mod(getVar(SCRATCH, OWNER), num(2))), num(2)),
              OWNER),
          ], [announce(OWNER, ' has nothing to offer the Bishop.')]),
          forEachOpponent([
            iff(gt(zoneCount(zone(HAND, PLAYER)), num(0)), [
              chooseCardsBlock({
                who: PLAYER, from: zone(HAND, PLAYER), min: num(0), max: num(1),
                prompt: 'Bishop: you may trash a card from your hand',
                body: [
                  announce(PLAYER, ' trashes ', CARD, '.'),
                  kit.tmove(specific(CARD), zone(HAND, PLAYER), zone(TRASH), 'trash', { faceUp: true }),
                ],
              }),
            ]),
          ]),
        ]),
      ]),

    // CLERK — Action–Attack–Reaction. Coins inline, attack stacked (Moat
    // window), reaction = the phaseStart yes/no above (header register).
    kit.cardDef(IDS.Clerk, 'Clerk', 4, 0, 0,
      '+$2. Each other player with 5 or more cards in hand puts one onto their deck. At the start of your turn, you may play this from your hand.', [
        kit.onPlay('dom_ab_clerk_coins', 'Ledgers balanced', [
          changeVar(COINS, num(2), OWNER),
        ]),
        kit.onPlay('dom_ab_clerk_attack', 'An audit is announced', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(gte(zoneCount(zone(HAND, PLAYER)), num(5)), [
                chooseCard({
                  who: PLAYER, from: zone(HAND, PLAYER),
                  prompt: 'Clerk: put a card from your hand onto your deck',
                }),
                announce(PLAYER, ' puts a card onto their deck.'),
                move(specific(CHOICE), zone(HAND, PLAYER), zone(DECK, PLAYER),
                  { toPosition: 'top', faceUp: false }),
              ], [announce(PLAYER, ' has fewer than 5 cards in hand — the Clerk moves on.')]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
        clerkReact,
      ]),

    // INVESTMENT — Treasure. The trash is mandatory (guarded on an empty
    // hand); the distinct-Treasure count is the mark sweep (header register).
    kit.cardDef(IDS.Investment, 'Investment', 4, 0, 0,
      'Trash a card from your hand. Choose one: +$1; or trash this to reveal your hand for +1 VP per differently named Treasure there.', [
        kit.onPlay('dom_ab_investment', 'Sound speculation', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Investment: trash a card from your hand',
            }),
            announce(OWNER, ' trashes ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
          ], [announce(OWNER, ' has nothing left to invest.')]),
          chooseOption('Investment: choose one', [
            { id: 'inv_coin', label: '+$1' },
            { id: 'inv_trash', label: 'Trash Investment: +1 VP per differently named Treasure in your hand' },
          ], OWNER),
          iff(eq(CHOICE, str('inv_coin')), [
            changeVar(COINS, num(1), OWNER),
          ], [
            // Guarded on still being in play (a Tiara-doubled Investment may
            // already sit in the trash — the second pick then whiffs).
            iff(eq(cardZoneId(SELF), str(INPLAY)), [
              announce(OWNER, ' trashes Investment and reveals their hand.'),
              kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              setVar(SCRATCH, num(0), OWNER),
              forEachCard(zone(HAND, OWNER), kit.IS_TREASURE_CARD, [
                setVar(INVESTMENT_NAME, field(CARD, 'name'), OWNER),
                iff(eq(countCards(zone(HAND, OWNER), allOf(
                  eq(field(CARD, 'name'), getVar(INVESTMENT_NAME, OWNER)),
                  eq(getVar(INVESTMENT_MARK, CARD), num(1)),
                )), num(0)), [
                  changeVar(SCRATCH, num(1), OWNER),
                ]),
                setVar(INVESTMENT_MARK, num(1), CARD),
              ]),
              forEachCard(zone(HAND, OWNER), kit.IS_TREASURE_CARD, [
                setVar(INVESTMENT_MARK, num(0), CARD),
              ]),
              changeVar(VP_TOKENS, getVar(SCRATCH, OWNER), OWNER),
              announce(OWNER, ' banks 1 VP per differently named Treasure.'),
            ], [announce('Investment is no longer in play — nothing to trash.')]),
          ]),
        ]),
      ]),

    // MONUMENT — exact. The chip is permanent (VP_TOKENS never resets).
    kit.cardDef(IDS.Monument, 'Monument', 4, 0, 0,
      '+$2. +1 VP.', [
        kit.onPlay('dom_ab_monument', 'Stone remembers', [
          changeVar(COINS, num(2), OWNER),
          changeVar(VP_TOKENS, num(1), OWNER),
        ]),
      ]),

    // QUARRY — Treasure, $1. PROMINENT DEVIATION (header register): raises
    // the global per-turn DISCOUNT by 2 — every card (not just Actions)
    // costs $2 less this turn; cleanup resets it.
    kit.cardDef(IDS.Quarry, 'Quarry', 4, 1, 0,
      '$1. While this is in play, Action cards cost $2 less, but not less than $0.', [
        kit.onPlay('dom_ab_quarry', 'Cut from the mountain', [
          changeVar(DISCOUNT, num(2)),
          announce(OWNER, "'s Quarry cuts costs by $2 this turn."),
        ]),
      ]),

    // TIARA — Treasure. +1 Buy now; one Treasure from hand may be played
    // TWICE (deviation: one-shot — header register). The gain-topdeck half
    // is the buildTriggers watcher.
    kit.cardDef(IDS.Tiara, 'Tiara', 4, 0, 0,
      '+1 Buy. This turn, when you gain a card, you may put it onto your deck. You may play a Treasure from your hand twice.', [
        kit.onPlay('dom_ab_tiara', 'A crown at play', [
          changeVar(BUYS, num(1), OWNER),
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_TREASURE_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_TREASURE_CARD,
              min: num(0), max: num(1),
              prompt: 'Tiara: you may play a Treasure from your hand twice',
              body: [
                announce(OWNER, ' plays ', CARD, ' twice with Tiara.'),
                // The coin field is paid manually, twice (the treasure ACTION
                // is not driving this play); on-play abilities fire from the
                // tagged move, then once more via the Throne Room mechanism.
                changeVar(COINS, mul(num(2), field(CARD, COINS_F)), OWNER),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
                kit.playAgain(CARD),
              ],
            }),
          ]),
        ]),
      ]),

    // WORKER'S VILLAGE — exact.
    kit.cardDef(IDS["Worker's Village"], "Worker's Village", 4, 0, 0,
      '+1 Card. +2 Actions. +1 Buy.', [
        kit.onPlay('dom_ab_workers_village', 'Hammer and haul', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
          changeVar(BUYS, num(1), OWNER),
        ]),
      ]),

    // CHARLATAN — Action–Attack. Coins inline, Curses stacked (Witch's
    // pattern). DEVIATION: the "Curse is also a Treasure worth $1" static is
    // dropped (header register).
    kit.cardDef(IDS.Charlatan, 'Charlatan', 5, 0, 0,
      '+$3. Each other player gains a Curse. (In games using this, Curse is also a Treasure worth $1.)', [
        kit.onPlay('dom_ab_charlatan_coins', 'Snake oil, going cheap', [
          changeVar(COINS, num(3), OWNER),
        ]),
        kit.onPlay('dom_ab_charlatan_attack', 'The grift spreads', [
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

    // CITY — exact: reads the core EMPTY_PILES var, which the pile watcher
    // recomputes on every card leaving the supply.
    kit.cardDef(IDS.City, 'City', 5, 0, 0,
      '+1 Card. +2 Actions. If there are one or more empty Supply piles, +1 Card. If there are two or more, +$1 and +1 Buy.', [
        kit.onPlay('dom_ab_city', 'The city grows', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
          iff(gte(getVar(EMPTY_PILES), num(1)), [kit.draw(OWNER, 1)]),
          iff(gte(getVar(EMPTY_PILES), num(2)), [
            changeVar(COINS, num(1), OWNER),
            changeVar(BUYS, num(1), OWNER),
          ]),
        ]),
      ]),

    // COLLECTION — Treasure, $2 (coin field) +1 Buy; the Action-gain chip
    // rides the buildTriggers watcher (1 chip per Collection in play).
    kit.cardDef(IDS.Collection, 'Collection', 5, 2, 0,
      '$2. +1 Buy. This turn, when you gain an Action card, +1 VP.', [
        kit.onPlay('dom_ab_collection', 'One of everything', [
          changeVar(BUYS, num(1), OWNER),
        ]),
      ]),

    // CRYSTAL BALL — Treasure, $1 +1 Buy; the top card stages through the
    // hidden LOOK zone and is announced (deviation — header register).
    kit.cardDef(IDS['Crystal Ball'], 'Crystal Ball', 5, 1, 0,
      "$1. +1 Buy. Look at the top card of your deck. You may trash it, discard it, or, if it's an Action or Treasure, play it.", [
        kit.onPlay('dom_ab_crystal_ball', 'Gaze into the glass', [
          changeVar(BUYS, num(1), OWNER),
          refillDeck(kit, OWNER),
          iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
            move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: false }),
            announce(OWNER, ' peers at ', topCard(zone(LOOK)), ' in the Crystal Ball.'),
            iff(anyOf(
              kit.isA(topCard(zone(LOOK)), kit.types.ACTION),
              kit.isA(topCard(zone(LOOK)), kit.types.TREASURE),
            ), [
              chooseOption('Crystal Ball: the top card of your deck', [
                { id: 'cb_back', label: 'Leave it on your deck' },
                { id: 'cb_trash', label: 'Trash it' },
                { id: 'cb_discard', label: 'Discard it' },
                { id: 'cb_play', label: 'Play it' },
              ], OWNER),
            ], [
              chooseOption('Crystal Ball: the top card of your deck', [
                { id: 'cb_back', label: 'Leave it on your deck' },
                { id: 'cb_trash', label: 'Trash it' },
                { id: 'cb_discard', label: 'Discard it' },
              ], OWNER),
            ]),
            iff(eq(CHOICE, str('cb_trash')), [
              announce(OWNER, ' trashes ', topCard(zone(LOOK)), '.'),
              kit.tmove(specific(topCard(zone(LOOK))), zone(LOOK), zone(TRASH), 'trash', { faceUp: true }),
            ], [
              iff(eq(CHOICE, str('cb_discard')), [
                announce(OWNER, ' discards ', topCard(zone(LOOK)), '.'),
                kit.tmove(specific(topCard(zone(LOOK))), zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ], [
                iff(eq(CHOICE, str('cb_play')), [
                  // A Treasure pays its coin field (the treasure action's
                  // payment); an Action plays without spending an Action.
                  iff(kit.isA(topCard(zone(LOOK)), kit.types.TREASURE), [
                    changeVar(COINS, field(topCard(zone(LOOK)), COINS_F), OWNER),
                  ]),
                  announce(OWNER, ' plays ', topCard(zone(LOOK)), ' off the top of their deck.'),
                  kit.tmove(specific(topCard(zone(LOOK))), zone(LOOK), zone(INPLAY, OWNER), 'play', { faceUp: true }),
                ], [
                  move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
                ]),
              ]),
            ]),
          ], [announce(OWNER, "'s Crystal Ball shows only fog — no cards left.")]),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { TRASH, DECK, HAND, DISCARD, INPLAY } = kit.zones;
  const { VP_TOKENS } = kit.vars;
  const { CARD, CHOICE } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /**
   * WATCHTOWER's reaction (header register): while a Watchtower is in the
   * gainer's hand, offer keep / topdeck / trash for the gained card. The
   * moves use the specific selector, whose `from` is advisory — the card is
   * taken from wherever it actually sits (discard, deck or hand gains all
   * work), so ONE move per outcome suffices.
   */
  const watchtowerWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_watchtower_${tag}`,
    name: `Watchtower: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(gt(countCards(zone(HAND, GAINER), kit.nameIs('Watchtower')), num(0)), [
        announce(GAINER, "'s Watchtower eyes the gained ", CARD, '.'),
        chooseOption('Watchtower: what happens to the gained card?', [
          { id: 'wt_keep', label: 'Keep it where it is' },
          { id: 'wt_deck', label: 'Reveal Watchtower: put it onto your deck' },
          { id: 'wt_trash', label: 'Reveal Watchtower: trash it' },
        ], GAINER),
        iff(eq(CHOICE, str('wt_deck')), [
          announce(GAINER, ' reveals Watchtower and puts the gained card onto their deck.'),
          move(specific(CARD), zone(DISCARD, GAINER), zone(DECK, GAINER),
            { toPosition: 'top', faceUp: false }),
        ], [
          iff(eq(CHOICE, str('wt_trash')), [
            announce(GAINER, ' reveals Watchtower and trashes the gained card.'),
            kit.tmove(specific(CARD), zone(DISCARD, GAINER), zone(TRASH), 'trash', { faceUp: true }),
          ]),
        ]),
      ]),
    ],
  });

  /**
   * TIARA's gain half: while a Tiara is in the gainer's play area ("this
   * turn"), each gained card may be topdecked. Withheld when the card was
   * already trashed (a Watchtower answered first) — the specific-move's
   * advisory `from` would otherwise pull it back out of the trash.
   */
  const tiaraWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_tiara_${tag}`,
    name: `Tiara: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        gt(countCards(zone(INPLAY, GAINER), kit.nameIs('Tiara')), num(0)),
        neq(cardZoneId(CARD), str(TRASH)),
      ), [
        yesNo(GAINER, 'Tiara: put the gained card onto your deck?'),
        iff(CHOICE, [
          announce(GAINER, ' puts the gained card onto their deck (Tiara).'),
          move(specific(CARD), zone(DISCARD, GAINER), zone(DECK, GAINER),
            { toPosition: 'top', faceUp: false }),
        ]),
      ]),
    ],
  });

  /**
   * COLLECTION's chip: an Action gained while N Collections are in the
   * gainer's play area banks N VP. Location of the gained card is
   * irrelevant (a Watchtower-trashed Action was still gained, as printed).
   */
  const collectionWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_collection_${tag}`,
    name: `Collection: an Action is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        kit.isA(CARD, kit.types.ACTION),
        gt(countCards(zone(INPLAY, GAINER), kit.nameIs('Collection')), num(0)),
      ), [
        changeVar(VP_TOKENS, countCards(zone(INPLAY, GAINER), kit.nameIs('Collection')), GAINER),
        announce(GAINER, ' banks VP with Collection.'),
      ]),
    ],
  });

  return [
    watchtowerWatch('gain'),
    watchtowerWatch('buy'),
    tiaraWatch('gain'),
    tiaraWatch('buy'),
    collectionWatch('gain'),
    collectionWatch('buy'),
  ];
}

export const prosperity2eA: ExpansionModule = {
  id: 'prosperity2eA',
  setName: 'Prosperity',

  piles: [
    { name: 'Anvil', cost: 3, count: 10 },
    { name: 'Watchtower', cost: 3, count: 10 },
    { name: 'Bishop', cost: 4, count: 10 },
    { name: 'Clerk', cost: 4, count: 10 },
    { name: 'Investment', cost: 4, count: 10 },
    { name: 'Monument', cost: 4, count: 10 },
    { name: 'Quarry', cost: 4, count: 10 },
    { name: 'Tiara', cost: 4, count: 10 },
    { name: "Worker's Village", cost: 4, count: 10 },
    { name: 'Charlatan', cost: 5, count: 10 },
    { name: 'City', cost: 5, count: 10 },
    { name: 'Collection', cost: 5, count: 10 },
    { name: 'Crystal Ball', cost: 5, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Clerk', 'Charlatan'],
  reactionNames: ['Watchtower', 'Clerk'],
  treasureNames: ['Anvil', 'Investment', 'Quarry', 'Tiara', 'Collection', 'Crystal Ball'],

  variables: [
    {
      id: INVESTMENT_MARK, name: 'Investment: counted',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
    {
      id: INVESTMENT_NAME, name: 'Investment: name under the lens',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
  ] as VariableDef[],

  buildCards,
  buildTriggers,
};
