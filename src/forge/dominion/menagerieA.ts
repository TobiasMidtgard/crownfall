/**
 * Menagerie (part A) — Black Cat, Sleigh, Supplies, Camel Train, Goatherd,
 * Scrap, Sheepdog, Snowy Village, Stockpile, Bounty Hunter, Cardinal,
 * Cavalry, Groom, Hostelry, Village Green — plus the set's SHARED
 * INFRASTRUCTURE, owned by THIS module: the per-player Exile mat
 * (dom_zone_exile), the shared Horse stock (dom_zone_horses, 30 Horses as
 * non-supply stock), the exile-discard rule, and the exile VP term.
 *
 * House idioms follow the earlier modules: attack halves are separate
 * `stacked: true` abilities gated per victim on IMMUNE == 0 (the shared
 * effectResolved trigger resets it), on-gain reactions are 'gain'/'buy'-
 * tagged cardEnterZone watchers (a bought card is gained, so both tags are
 * watched), discard reactions watch the 'discard' tag ONLY (the cleanup
 * sweep is tagged 'cleanup', so "other than during Clean-up" is structural),
 * dug-through cards stage in the hidden shared LOOK zone, and every
 * mandatory choice is guarded so a session can never hang.
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "each other player" /
 * "the player to your right" is the one opponent everywhere below.
 *
 * EXILE (the set mechanic, built once here):
 *  - Exiling a card is an UNTAGGED move onto the owner's Exile mat — exiling
 *    is neither gaining nor discarding, so no watcher fires on it (a Village
 *    Green sent to Exile does NOT get its discard reaction, as printed).
 *  - The printed discard-from-Exile rule is ONE shared watcher pair (tags
 *    'gain' + 'buy'): when a player gains a card while same-named copies sit
 *    on their Exile mat, they may discard ALL those copies to their discard
 *    pile (announced; the moves are 'discard'-tagged, so a Village Green
 *    discharged from Exile still offers its play reaction — printed timing).
 *  - Exiled cards score their PRINTED VP at every recount (buildVpTerms sums
 *    the VP field over the mat). MODULE BOUNDARY: count-style scorers from
 *    other modules (Gardens, Fairgrounds, Marchland…) walk the core owned
 *    zones only and do NOT see Exile.
 *  - HORSE: "+2 Cards, +1 Action, return this to its pile" — the return is
 *    an untagged move back to the Horse stock (returning is no listed cause).
 *    Gaining a Horse moves ONE card off the stock ('gain'-tagged) and whiffs
 *    politely when the stock is empty.
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - SNOWY VILLAGE (prominent): "Ignore any further +Actions you get this
 *    turn" is DROPPED — the engine has no way to intercept other cards'
 *    counter grants. The card plays as a plain +1 Card +4 Actions +1 Buy
 *    (announced at play so the table knows).
 *  - CAVALRY: the printed "and if it's your Buy phase return to your Action
 *    phase" is DROPPED — no phase rewind exists. +2 Cards and +1 Buy on gain
 *    are exact.
 *  - BLACK CAT: the reaction offer is one yes/no per Victory-card gain per
 *    holder, playing ONE Black Cat (officially each copy could chain into
 *    the same gain). The curse half is stacked, so a response window opens
 *    even off-turn; the core Moat reveal carries no not-your-turn gate, so
 *    the current player CAN still Moat an off-turn Black Cat.
 *  - SLEIGH: one offer per gain (it discards one Sleigh); "that card" is
 *    moved from wherever it landed (the specific selector's advisory from),
 *    so deck-gained cards can still be pulled to hand, as printed.
 *  - SHEEPDOG: the gain-watcher offers to play ANY NUMBER of Sheepdogs from
 *    the holder's hand at once; Sheepdogs drawn BY those plays get no late
 *    offer for the same gain (officially they would).
 *  - GOATHERD: "per card the player to your right trashed on their last
 *    turn" is approximated with a per-player counter: every 'trash'-tagged
 *    move counts toward the CURRENT player, and the counter resets at that
 *    player's next action-phase start. Off-turn trashes (an attack trashing
 *    the victim's card) therefore attribute to the turn player.
 *  - SCRAP: "choose a different thing per $1" resolves the six benefits in
 *    PRINTED ORDER (official rulings resolve listed order anyway): each is
 *    a yes/no while picks remain, turning mandatory once the picks remaining
 *    equal the options remaining — exactly N different things, no repeats.
 *  - CARDINAL: the $3–$6 exile range is Bridge-aware (current cost); the
 *    reveal stages through the shared LOOK zone with public announces.
 *  - GROOM: type riders in the one-primary-type world — the Action rider
 *    keys off the primary Action type; the Victory rider off Victory-typed
 *    OR printed VP > 0 (Ironworks' precedent), so an Action–Victory dual
 *    (Mill) triggers both riders, as printed.
 *  - CAMEL TRAIN: "non-Victory" = NOT (Victory-typed or printed VP > 0).
 *  - VILLAGE GREEN: now-or-later Duration on the kit's durationPair plumbing
 *    (the later half marches back tagged 'duration_return'); a Throne-Roomed
 *    copy asks the now/later question again on the replay and parks at most
 *    once, so the later half fires at most once.
 */
import type {
  AbilityDef, Block, CardDef, Expr, TriggerDef, VariableDef, ZoneDef,
} from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, anyOf, bestCard, bnd, cardZoneId, changeVar, chooseCard,
  chooseCardsBlock, chooseOption, countCards, eq, field, forEachCard, forEachOpponent,
  forEachPlayer, getVar, gt, gte, iff, lte, matching, move, neq, nextPlayer, not, num, setVar,
  shuffle, specific, str, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  'Black Cat': 'dom_card_black_cat',
  Sleigh: 'dom_card_sleigh',
  Supplies: 'dom_card_supplies',
  'Camel Train': 'dom_card_camel_train',
  Goatherd: 'dom_card_goatherd',
  Scrap: 'dom_card_scrap',
  Sheepdog: 'dom_card_sheepdog',
  'Snowy Village': 'dom_card_snowy_village',
  Stockpile: 'dom_card_stockpile',
  'Bounty Hunter': 'dom_card_bounty_hunter',
  Cardinal: 'dom_card_cardinal',
  Cavalry: 'dom_card_cavalry',
  Groom: 'dom_card_groom',
  Hostelry: 'dom_card_hostelry',
  'Village Green': 'dom_card_village_green',
  // Non-supply stock.
  Horse: 'dom_card_horse',
};

/** The per-player Exile mat — the whole set's parking lot. */
export const EXILE_ZONE = 'dom_zone_exile';
/** The shared face-down Horse stock (30 Horses, never a kingdom pile). */
export const HORSE_ZONE = 'dom_zone_horses';

/** Name stash for the exile-discard match and Bounty Hunter's copy test. */
export const MENAG_NAME_VAR = 'dom_var_menag_name';
/** Scrap's picks-remaining counter / Bounty Hunter's had-a-copy count. */
export const MENAG_COUNT_VAR = 'dom_var_menag_count';
/** Cards trashed while this player was the CURRENT player, since their last
 *  action-phase start (Goatherd's "trashed on their last turn" memory). */
export const GOATHERD_TRASHED_VAR = 'dom_var_goatherd_trashed';

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

/**
 * Gain ONE Horse off the shared stock ('gain'-tagged, so every gain watcher
 * — Sleigh, Sheepdog, the exile-discard rule — reacts as printed), whiffing
 * politely when the stock is empty. `to: 'deck'` topdecks it (Supplies).
 */
function gainHorse(kit: CardKit, who: Expr, opts: { toDeck?: boolean } = {}): Block {
  return iff(gt(zoneCount(zone(HORSE_ZONE)), num(0)), [
    announce(who, opts.toDeck === true
      ? ' gains a Horse onto their deck.'
      : ' gains a Horse.'),
    kit.tmove(topN(1), zone(HORSE_ZONE),
      opts.toDeck === true ? zone(kit.zones.DECK, who) : zone(kit.zones.DISCARD, who),
      'gain',
      { toPosition: 'top', faceUp: opts.toDeck !== true }),
  ], [announce('The Horse stock is empty — no Horse arrives.')]);
}

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, HAND, DISCARD, INPLAY, LOOK, DURATION } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, DISCOUNT } = kit.vars;
  const { COST, VP_F } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER, SELF } = kit;
  const { nameIs } = kit;

  /** "Is a Victory card" in the one-primary-type world (see the register):
   *  Victory-typed OR printed VP > 0 (catches Mill/Nobles-style duals). */
  const victoryCard = (card: Expr): Expr => anyOf(
    kit.isA(card, kit.types.VICTORY),
    gt(field(card, VP_F), num(0)),
  );

  /** Gain the named basic from the supply into `to` (guarded on the pile). */
  const gainNamed = (name: string, to: ReturnType<typeof zone>, who: Expr, note: string, empty: string): Block =>
    iff(gt(countCards(zone(SUPPLY), nameIs(name)), num(0)), [
      announce(who, note),
      kit.tmove(
        specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs(name))),
        zone(SUPPLY), to, 'gain', { faceUp: true },
      ),
    ], [announce(empty)]);

  // --- Scrap's pick machinery (see the register) ---------------------------
  // Benefits resolve in printed order; each is optional while picks remain,
  // turning MANDATORY once picks remaining >= options remaining (so exactly
  // N different things always resolve — the printed contract, no repeats).
  const scrapPick = (idx: number, label: string, grant: () => Block[]): Block =>
    iff(gt(getVar(MENAG_COUNT_VAR, OWNER), num(0)), [
      iff(gte(getVar(MENAG_COUNT_VAR, OWNER), num(6 - idx)), [
        announce(OWNER, ` must take ${label} — as many picks as options remain.`),
        changeVar(MENAG_COUNT_VAR, num(-1), OWNER),
        ...grant(),
      ], [
        yesNo(OWNER, `Scrap: take ${label}?`),
        iff(CHOICE, [
          announce(OWNER, ` takes ${label}.`),
          changeVar(MENAG_COUNT_VAR, num(-1), OWNER),
          ...grant(),
        ]),
      ]),
    ]);

  // --- Village Green's now-or-later pair (see the register) ----------------
  // The kit pair supplies the shapes (now: tagFilter 'play'; later: Haven-
  // gated phaseStart march back tagged 'duration_return'); the now script is
  // replaced with the printed choice — "later" parks the card, "now" pays
  // out immediately and the card stays in play for a normal cleanup.
  const vgPair = kit.durationPair('dom_ab_village_green', 'Village Green', [], [
    kit.draw(OWNER, 1),
    changeVar(ACTIONS, num(2), OWNER),
  ]);
  const vgNow: AbilityDef = {
    ...vgPair[0],
    script: [
      chooseOption('Village Green: +1 Card and +2 Actions — now, or at the start of your next turn?', [
        { id: 'vg_now', label: 'Now' },
        { id: 'vg_later', label: 'At the start of my next turn' },
      ], OWNER),
      iff(eq(CHOICE, str('vg_now')), [
        kit.draw(OWNER, 1),
        changeVar(ACTIONS, num(2), OWNER),
      ], [
        announce(OWNER, "'s Village Green waits for their next turn."),
        kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(DURATION, OWNER), 'play', { faceUp: true }),
      ]),
    ],
  };

  /** Cardinal's exile window: current cost $3–$6 (Bridge-aware, register). */
  const cardinalRange = (): Expr => allOf(
    gte(field(CARD, COST), add(num(3), getVar(DISCOUNT))),
    lte(field(CARD, COST), add(num(6), getVar(DISCOUNT))),
  );

  return [
    // BLACK CAT — Action – Attack – Reaction. The draw is immediate; the
    // curse half is stacked and gated on "it isn't your turn" (the printed
    // rider), striking every non-owner (forEachPlayer — forEachOpponent
    // would skip the CURRENT player, the very victim of an off-turn play).
    // The play-on-Victory-gain reaction lives in buildTriggers.
    kit.cardDef(IDS['Black Cat'], 'Black Cat', 2, 0, 0,
      "+2 Cards. If it isn't your turn, each other player gains a Curse. When another player gains a Victory card, you may play this from your hand.", [
        kit.onPlay('dom_ab_black_cat_draw', 'Nine lives, two cards', [
          kit.draw(OWNER, 2),
        ]),
        kit.onPlay('dom_ab_black_cat_attack', 'A hiss in the dark', [
          iff(neq(CURRENT, OWNER), [
            forEachPlayer([
              iff(allOf(neq(PLAYER, OWNER), eq(getVar(IMMUNE, PLAYER), num(0))), [
                iff(gt(countCards(zone(SUPPLY), nameIs('Curse')), num(0)), [
                  announce(PLAYER, ' gains a Curse.'),
                  kit.tmove(
                    specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Curse'))),
                    zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
                  ),
                ]),
              ]),
            ]),
          ], [announce('The Black Cat purrs — it is its owner’s turn, no Curses.')]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // SLEIGH — Action – Reaction. On play: gain 2 Horses (unrolled). The
    // gain-reaction (discard this to move the gained card) is a watcher.
    kit.cardDef(IDS.Sleigh, 'Sleigh', 2, 0, 0,
      'Gain 2 Horses. When you gain a card, you may discard this, to put that card into your hand or onto your deck.', [
        kit.onPlay('dom_ab_sleigh', 'Hitch up the team', [
          gainHorse(kit, OWNER),
          gainHorse(kit, OWNER),
        ]),
      ]),

    // SUPPLIES — Treasure. The $1 rides the coin FIELD (the treasure action
    // pays it); the ability topdecks a Horse.
    kit.cardDef(IDS.Supplies, 'Supplies', 2, 1, 0,
      '$1. When you play this, gain a Horse onto your deck.', [
        kit.onPlay('dom_ab_supplies', 'Provisions for the road', [
          gainHorse(kit, OWNER, { toDeck: true }),
        ]),
      ]),

    // CAMEL TRAIN — exile a non-Victory supply card (untagged move — exiling
    // is not gaining); the on-gain Gold exile is a watcher.
    kit.cardDef(IDS['Camel Train'], 'Camel Train', 3, 0, 0,
      'Exile a non-Victory card from the Supply. When you gain this, Exile a Gold from the Supply.', [
        kit.onPlay('dom_ab_camel_train', 'The caravan sets out', [
          iff(gt(countCards(zone(SUPPLY), not(victoryCard(CARD))), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY), filter: not(victoryCard(CARD)),
              prompt: 'Camel Train: exile a non-Victory card from the Supply',
              body: [
                announce(OWNER, ' exiles ', CARD, ' from the Supply.'),
                move(specific(CARD), zone(SUPPLY), zone(EXILE_ZONE, OWNER), { faceUp: true }),
              ],
            }),
          ], [announce('Only Victory cards remain — the camels leave empty.')]),
        ]),
      ]),

    // GOATHERD — the optional trash is exact; the draw reads the opponent's
    // trashed-last-turn counter (the module watcher — see the register).
    kit.cardDef(IDS.Goatherd, 'Goatherd', 3, 0, 0,
      '+1 Action. You may trash a card from your hand. +1 Card per card the player to your right trashed on their last turn.', [
        kit.onPlay('dom_ab_goatherd', 'Tending the herd', [
          changeVar(ACTIONS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(1),
              prompt: 'Goatherd: you may trash a card from your hand',
              body: [
                announce(OWNER, ' trashes ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              ],
            }),
          ]),
          iff(gt(getVar(GOATHERD_TRASHED_VAR, nextPlayer(OWNER)), num(0)), [
            announce(OWNER, ' draws for the neighbour’s trashing.'),
            kit.drawN(OWNER, getVar(GOATHERD_TRASHED_VAR, nextPlayer(OWNER))),
          ]),
        ]),
      ]),

    // SCRAP — mandatory trash (guarded), then exactly min(cost, 6) DIFFERENT
    // benefits in printed order (the forced-pick machinery — register).
    kit.cardDef(IDS.Scrap, 'Scrap', 3, 0, 0,
      'Trash a card from your hand. Choose a different thing per $1 it costs: +1 Card; +1 Action; +1 Buy; +$1; gain a Silver; gain a Horse.', [
        kit.onPlay('dom_ab_scrap', 'Sold for scrap', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Scrap: trash a card from your hand',
            }),
            setVar(MENAG_COUNT_VAR, field(CHOICE, COST), OWNER),
            iff(gt(getVar(MENAG_COUNT_VAR, OWNER), num(6)), [
              setVar(MENAG_COUNT_VAR, num(6), OWNER),
            ]),
            announce(OWNER, ' scraps ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            scrapPick(0, '+1 Card', () => [kit.draw(OWNER, 1)]),
            scrapPick(1, '+1 Action', () => [changeVar(ACTIONS, num(1), OWNER)]),
            scrapPick(2, '+1 Buy', () => [changeVar(BUYS, num(1), OWNER)]),
            scrapPick(3, '+$1', () => [changeVar(COINS, num(1), OWNER)]),
            scrapPick(4, 'gain a Silver', () => [
              gainNamed('Silver', zone(DISCARD, OWNER), OWNER, ' gains a Silver.',
                'The Silver pile is empty — nothing gained.'),
            ]),
            scrapPick(5, 'gain a Horse', () => [gainHorse(kit, OWNER)]),
          ], [announce(OWNER, ' has nothing to scrap.')]),
        ]),
      ]),

    // SHEEPDOG — Action – Reaction. The draw is exact; the play-on-gain
    // reaction is a watcher (any number of hand Sheepdogs per gain).
    kit.cardDef(IDS.Sheepdog, 'Sheepdog', 3, 0, 0,
      '+2 Cards. When you gain a card, you may play this from your hand.', [
        kit.onPlay('dom_ab_sheepdog', 'Ears up', [
          kit.draw(OWNER, 2),
        ]),
      ]),

    // SNOWY VILLAGE — PROMINENT DEVIATION (register): the "ignore further
    // +Actions" rider is dropped; the announce keeps the table honest.
    kit.cardDef(IDS['Snowy Village'], 'Snowy Village', 3, 0, 0,
      '+1 Card. +4 Actions. +1 Buy. Ignore any further +Actions you get this turn.', [
        kit.onPlay('dom_ab_snowy_village', 'Snowed in', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(4), OWNER),
          changeVar(BUYS, num(1), OWNER),
          announce('Snowy Village: on this table, further +Actions still count.'),
        ]),
      ]),

    // STOCKPILE — Treasure worth $3 (the coin field pays it); +1 Buy, then
    // it exiles itself (untagged move out of In Play).
    kit.cardDef(IDS.Stockpile, 'Stockpile', 3, 3, 0,
      '$3. +1 Buy. When you play this, Exile it.', [
        kit.onPlay('dom_ab_stockpile', 'Off the books', [
          changeVar(BUYS, num(1), OWNER),
          announce(OWNER, ' exiles the Stockpile.'),
          move(specific(SELF), zone(INPLAY, OWNER), zone(EXILE_ZONE, OWNER), { faceUp: true }),
        ]),
      ]),

    // BOUNTY HUNTER — the had-a-copy test runs BEFORE the exile move (the
    // printed timing: the bounty pays when this made it the first copy).
    kit.cardDef(IDS['Bounty Hunter'], 'Bounty Hunter', 4, 0, 0,
      "+1 Action. Exile a card from your hand. If you didn't have a copy of it in Exile, +$3.", [
        kit.onPlay('dom_ab_bounty_hunter', 'Wanted, alive', [
          changeVar(ACTIONS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Bounty Hunter: exile a card from your hand',
            }),
            setVar(MENAG_NAME_VAR, field(CHOICE, 'name'), OWNER),
            setVar(MENAG_COUNT_VAR, countCards(zone(EXILE_ZONE, OWNER),
              eq(field(CARD, 'name'), getVar(MENAG_NAME_VAR, OWNER))), OWNER),
            announce(OWNER, ' exiles ', CHOICE, '.'),
            move(specific(CHOICE), zone(HAND, OWNER), zone(EXILE_ZONE, OWNER), { faceUp: true }),
            iff(eq(getVar(MENAG_COUNT_VAR, OWNER), num(0)), [
              announce(OWNER, ' collects the bounty: +$3.'),
              changeVar(COINS, num(3), OWNER),
            ], [announce('A copy already sat in Exile — no bounty.')]),
          ], [announce(OWNER, ' has nothing to exile.')]),
        ]),
      ]),

    // CARDINAL — Action – Attack. Each victim reveals their top 2 through
    // the LOOK zone, exiles one at current cost $3–$6 (their pick, mandatory
    // when possible), and discards the rest.
    kit.cardDef(IDS.Cardinal, 'Cardinal', 4, 0, 0,
      'Each other player reveals the top 2 cards of their deck, Exiles one costing from $3 to $6, and discards the rest.', [
        kit.onPlay('dom_ab_cardinal_attack', 'The red hat points', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              ...takeTop(kit, PLAYER, zone(LOOK), true),
              ...takeTop(kit, PLAYER, zone(LOOK), true),
              forEachCard(zone(LOOK), null, [
                announce(PLAYER, ' reveals ', CARD, '.'),
              ]),
              iff(gt(countCards(zone(LOOK), cardinalRange()), num(0)), [
                chooseCard({
                  who: PLAYER, from: zone(LOOK), filter: cardinalRange(), revealed: true,
                  prompt: 'Cardinal: exile a revealed card costing from $3 to $6',
                }),
                announce(PLAYER, ' exiles ', CHOICE, '.'),
                move(specific(CHOICE), zone(LOOK), zone(EXILE_ZONE, PLAYER), { faceUp: true }),
              ], [announce('Nothing revealed sits in the $3–$6 range.')]),
              iff(gt(zoneCount(zone(LOOK)), num(0)), [
                kit.tmove(ALL, zone(LOOK), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
              ]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // CAVALRY — gain 2 Horses on play; the on-gain rider is a watcher.
    // DEVIATION (register): no phase rewind on a buy-phase gain.
    kit.cardDef(IDS.Cavalry, 'Cavalry', 4, 0, 0,
      "Gain 2 Horses. When you gain this, +2 Cards, +1 Buy, and if it's your Buy phase return to your Action phase.", [
        kit.onPlay('dom_ab_cavalry', 'Mount up', [
          gainHorse(kit, OWNER),
          gainHorse(kit, OWNER),
        ]),
      ]),

    // GROOM — Bridge-aware $4 cap; the type riders fire off the gained card
    // (duals can fire two riders — register).
    kit.cardDef(IDS.Groom, 'Groom', 4, 0, 0,
      "Gain a card costing up to $4. If it's an Action card, gain a Horse. If it's a Treasure card, gain a Silver. If it's a Victory card, +1 Card and +1 Action.", [
        kit.onPlay('dom_ab_groom', 'A good match', [
          iff(gt(countCards(zone(SUPPLY),
            lte(field(CARD, COST), add(num(4), getVar(DISCOUNT)))), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY),
              filter: lte(field(CARD, COST), add(num(4), getVar(DISCOUNT))),
              prompt: 'Groom: gain a card costing up to $4',
              body: [
                announce(OWNER, ' gains ', CARD, '.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                iff(kit.isA(CARD, kit.types.ACTION), [
                  gainHorse(kit, OWNER),
                ]),
                iff(kit.isA(CARD, kit.types.TREASURE), [
                  gainNamed('Silver', zone(DISCARD, OWNER), OWNER, ' gains a Silver.',
                    'The Silver pile is empty — nothing gained.'),
                ]),
                iff(victoryCard(CARD), [
                  announce(OWNER, ' grooms a Victory: +1 Card and +1 Action.'),
                  kit.draw(OWNER, 1),
                  changeVar(ACTIONS, num(1), OWNER),
                ]),
              ],
            }),
          ], [announce('Nothing in the supply is cheap enough to groom.')]),
        ]),
      ]),

    // HOSTELRY — the play half is exact; the on-gain Treasures-for-Horses
    // offer is a watcher.
    kit.cardDef(IDS.Hostelry, 'Hostelry', 4, 0, 0,
      '+1 Card. +2 Actions. When you gain this, you may discard any number of Treasures, revealed, to gain that many Horses.', [
        kit.onPlay('dom_ab_hostelry', 'Room and board', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
        ]),
      ]),

    // VILLAGE GREEN — Action – Duration – Reaction (no Duration tag exists in
    // the def's vocabulary — Duration-ness is behavioral). Now-or-later pair
    // above; the discard reaction is a watcher (Tunnel's idiom).
    kit.cardDef(IDS['Village Green'], 'Village Green', 4, 0, 0,
      'Either now or at the start of your next turn, +1 Card and +2 Actions. When you discard this other than during Clean-up, you may reveal it to play it.', [
        vgNow,
        vgPair[1],
      ]),

    // HORSE — non-supply stock. The return is an untagged move back to the
    // stock; a Throne-Roomed Horse repeats the bonuses and the second return
    // finds it already home (the specific selector's advisory from).
    kit.cardDef(IDS.Horse, 'Horse', 3, 0, 0,
      '+2 Cards. +1 Action. Return this to its pile. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_horse', 'Hoofbeats', [
          kit.draw(OWNER, 2),
          changeVar(ACTIONS, num(1), OWNER),
          announce(OWNER, "'s Horse returns to its pile."),
          move(specific(SELF), zone(INPLAY, OWNER), zone(HORSE_ZONE), { faceUp: false }),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY } = kit.zones;
  const { BUYS } = kit.vars;
  const { COST } = kit.fields;
  const { CARD, CHOICE, PLAYER } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /**
   * THE SET'S SHARED EXILE-DISCARD RULE (built once here, for every card):
   * when a player gains a card while same-named copies sit on their Exile
   * mat, they may discard ALL those copies ('discard'-tagged, so discard
   * reactions like Village Green still fire off the mat — printed timing).
   */
  const exileDischargeWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_menag_exile_${tag}`,
    name: `Exile: a card is ${tag === 'buy' ? 'bought' : 'gained'} — discard the exiled copies?`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      setVar(MENAG_NAME_VAR, field(CARD, 'name'), GAINER),
      iff(gt(countCards(zone(EXILE_ZONE, GAINER),
        eq(field(CARD, 'name'), getVar(MENAG_NAME_VAR, GAINER))), num(0)), [
        yesNo(GAINER, 'Exile: discard ALL exiled copies of the card you just gained?'),
        iff(CHOICE, [
          announce(GAINER, ' discards every exiled copy of ', CARD, '.'),
          kit.tmove(
            matching(eq(field(CARD, 'name'), getVar(MENAG_NAME_VAR, GAINER))),
            zone(EXILE_ZONE, GAINER), zone(DISCARD, GAINER), 'discard', { faceUp: true },
          ),
        ]),
      ]),
    ],
  });

  /** CAMEL TRAIN gained: exile a Gold from the Supply (untagged move). */
  const camelTrainWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_camel_train_${tag}`,
    name: `Camel Train: ${tag === 'buy' ? 'bought' : 'gained'} — a Gold heads to Exile`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Camel Train'),
    script: [
      iff(gt(countCards(zone(SUPPLY), kit.nameIs('Gold')), num(0)), [
        announce(GAINER, ' exiles a Gold from the Supply.'),
        move(specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Gold'))),
          zone(SUPPLY), zone(EXILE_ZONE, GAINER), { faceUp: true }),
      ], [announce('The Gold pile is empty — nothing to exile.')]),
    ],
  });

  /** CAVALRY gained: +2 Cards, +1 Buy (the phase rewind is dropped — register). */
  const cavalryWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_cavalry_${tag}`,
    name: `Cavalry: ${tag === 'buy' ? 'bought' : 'gained'} — +2 Cards, +1 Buy`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Cavalry'),
    script: [
      announce(GAINER, ' gains Cavalry: +2 Cards and +1 Buy.'),
      kit.drawN(GAINER, num(2)),
      changeVar(BUYS, num(1), GAINER),
    ],
  });

  /** HOSTELRY gained: discard any number of Treasures for that many Horses. */
  const hostelryWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_hostelry_${tag}`,
    name: `Hostelry: ${tag === 'buy' ? 'bought' : 'gained'} — Treasures for Horses?`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Hostelry'),
    script: [
      iff(gt(countCards(zone(HAND, GAINER), kit.IS_TREASURE_CARD), num(0)), [
        chooseCardsBlock({
          who: GAINER, from: zone(HAND, GAINER), filter: kit.IS_TREASURE_CARD,
          min: num(0), max: num(99),
          prompt: 'Hostelry: discard any number of Treasures — a Horse for each',
          body: [
            announce(GAINER, ' reveals and discards ', CARD, ' at the Hostelry.'),
            kit.tmove(specific(CARD), zone(HAND, GAINER), zone(DISCARD, GAINER), 'discard', { faceUp: true }),
            gainHorse(kit, GAINER),
          ],
        }),
      ]),
    ],
  });

  /**
   * SLEIGH's reaction: a Sleigh in the gainer's hand may be discarded to put
   * the gained card into their hand or onto their deck. Withheld when the
   * gained card already left for the trash or the supply (a Watchtower /
   * Trader answered first). One offer per gain (register).
   */
  const sleighWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_sleigh_${tag}`,
    name: `Sleigh: a card is ${tag === 'buy' ? 'bought' : 'gained'} — move it?`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        gt(countCards(zone(HAND, GAINER), kit.nameIs('Sleigh')), num(0)),
        neq(cardZoneId(CARD), str(TRASH)),
        neq(cardZoneId(CARD), str(SUPPLY)),
      ), [
        chooseOption('Sleigh: discard it to move the card you just gained?', [
          { id: 'sleigh_keep', label: 'Keep the Sleigh — the gain stays put' },
          { id: 'sleigh_hand', label: 'Discard the Sleigh: the gained card goes to your hand' },
          { id: 'sleigh_deck', label: 'Discard the Sleigh: the gained card goes onto your deck' },
        ], GAINER),
        iff(neq(CHOICE, str('sleigh_keep')), [
          announce(GAINER, ' discards a Sleigh.'),
          kit.tmove(
            specific(bestCard(zone(HAND, GAINER), 'highest', COST, kit.nameIs('Sleigh'))),
            zone(HAND, GAINER), zone(DISCARD, GAINER), 'discard', { faceUp: true },
          ),
          iff(eq(CHOICE, str('sleigh_hand')), [
            announce('The gained ', CARD, ' rides into their hand.'),
            move(specific(CARD), zone(DISCARD, GAINER), zone(HAND, GAINER), { faceUp: true }),
          ], [
            announce('The gained ', CARD, ' rides onto their deck.'),
            move(specific(CARD), zone(DISCARD, GAINER), zone(DECK, GAINER),
              { toPosition: 'top', faceUp: false }),
          ]),
        ]),
      ]),
    ],
  });

  /** SHEEPDOG's reaction: play any number of hand Sheepdogs on a gain. */
  const sheepdogWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_sheepdog_${tag}`,
    name: `Sheepdog: a card is ${tag === 'buy' ? 'bought' : 'gained'} — play it?`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(gt(countCards(zone(HAND, GAINER), kit.nameIs('Sheepdog')), num(0)), [
        chooseCardsBlock({
          who: GAINER, from: zone(HAND, GAINER), filter: kit.nameIs('Sheepdog'),
          min: num(0), max: num(99),
          prompt: 'Sheepdog: play any number of Sheepdogs from your hand?',
          body: [
            announce(GAINER, ' lets a Sheepdog off the leash.'),
            kit.tmove(specific(CARD), zone(HAND, GAINER), zone(INPLAY, GAINER), 'play', { faceUp: true }),
          ],
        }),
      ]),
    ],
  });

  /**
   * BLACK CAT's reaction: another player's Victory-card gain lets each
   * holder play one Black Cat from hand ("Victory card" = Victory-typed or
   * printed VP > 0 — the register's dual test).
   */
  const blackCatWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_black_cat_${tag}`,
    name: `Black Cat: a Victory card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: anyOf(
      kit.isA(CARD, kit.types.VICTORY),
      gt(field(CARD, kit.fields.VP_F), num(0)),
    ),
    script: [
      forEachPlayer([
        iff(allOf(
          neq(PLAYER, GAINER),
          gt(countCards(zone(HAND, PLAYER), kit.nameIs('Black Cat')), num(0)),
        ), [
          yesNo(PLAYER, 'Black Cat: play it from your hand?'),
          iff(CHOICE, [
            announce(PLAYER, "'s Black Cat pounces."),
            kit.tmove(
              specific(bestCard(zone(HAND, PLAYER), 'highest', COST, kit.nameIs('Black Cat'))),
              zone(HAND, PLAYER), zone(INPLAY, PLAYER), 'play', { faceUp: true },
            ),
          ]),
        ]),
      ]),
    ],
  });

  return [
    // The exiled-copies discharge decides first, then the gained card's own
    // riders, then the reactions that move or answer the gain.
    exileDischargeWatch('gain'),
    exileDischargeWatch('buy'),
    camelTrainWatch('gain'),
    camelTrainWatch('buy'),
    cavalryWatch('gain'),
    cavalryWatch('buy'),
    hostelryWatch('gain'),
    hostelryWatch('buy'),
    sleighWatch('gain'),
    sleighWatch('buy'),
    sheepdogWatch('gain'),
    sheepdogWatch('buy'),
    blackCatWatch('gain'),
    blackCatWatch('buy'),

    // VILLAGE GREEN: discarded outside cleanup ('discard' tag only — the
    // cleanup sweep is tagged 'cleanup') → may reveal to play it (Tunnel's
    // idiom; the guard skips copies that went somewhere other than a
    // discard pile).
    {
      id: 'dom_trigger_village_green_discard',
      name: 'Village Green: discarded — play it?',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'discard' },
      condition: kit.nameIs('Village Green'),
      script: [
        iff(eq(cardZoneId(CARD), str(DISCARD)), [
          yesNo(GAINER, 'Village Green: reveal it to play it?'),
          iff(CHOICE, [
            announce(GAINER, ' reveals the Village Green — it is played.'),
            kit.tmove(specific(CARD), zone(DISCARD, GAINER), zone(INPLAY, GAINER), 'play', { faceUp: true }),
          ]),
        ]),
      ],
    },

    // GOATHERD's memory (register): every trash counts toward the CURRENT
    // player; the counter resets at that player's next action-phase start,
    // so an opponent's Goatherd reads a full last turn.
    {
      id: 'dom_trigger_goatherd_trash',
      name: 'Goatherd: a card was trashed this turn',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'trash' },
      condition: null,
      script: [changeVar(GOATHERD_TRASHED_VAR, num(1), CURRENT)],
    },
    {
      id: 'dom_trigger_goatherd_reset',
      name: 'Goatherd: a new turn begins',
      event: { kind: 'phaseStart', phaseId: PHASE_ACTION },
      condition: null,
      script: [setVar(GOATHERD_TRASHED_VAR, num(0), CURRENT)],
    },
  ];
}

export const menagerieA: ExpansionModule = {
  id: 'menagerieA',
  setName: 'Menagerie',

  piles: [
    { name: 'Black Cat', cost: 2, count: 10 },
    { name: 'Sleigh', cost: 2, count: 10 },
    { name: 'Supplies', cost: 2, count: 10 },
    { name: 'Camel Train', cost: 3, count: 10 },
    { name: 'Goatherd', cost: 3, count: 10 },
    { name: 'Scrap', cost: 3, count: 10 },
    { name: 'Sheepdog', cost: 3, count: 10 },
    { name: 'Snowy Village', cost: 3, count: 10 },
    { name: 'Stockpile', cost: 3, count: 10 },
    { name: 'Bounty Hunter', cost: 4, count: 10 },
    { name: 'Cardinal', cost: 4, count: 10 },
    { name: 'Cavalry', cost: 4, count: 10 },
    { name: 'Groom', cost: 4, count: 10 },
    { name: 'Hostelry', cost: 4, count: 10 },
    { name: 'Village Green', cost: 4, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Black Cat', 'Cardinal'],
  reactionNames: ['Black Cat', 'Sleigh', 'Sheepdog', 'Village Green'],
  treasureNames: ['Supplies', 'Stockpile'],

  variables: [
    {
      id: MENAG_NAME_VAR, name: 'Menagerie: name stash',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: MENAG_COUNT_VAR, name: 'Menagerie: pick counter',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: GOATHERD_TRASHED_VAR, name: 'Goatherd: trashed this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  zones: [
    {
      id: EXILE_ZONE, name: 'Exile',
      owner: 'perPlayer', visibility: 'all', layout: 'row', area: 'player',
    },
    {
      id: HORSE_ZONE, name: 'Horse stock',
      owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
    },
  ] as ZoneDef[],

  nonSupply: [
    {
      zoneId: HORSE_ZONE,
      piles: [
        { name: 'Horse', cost: 3, count: 30 },
      ],
    },
  ],

  buildCards,
  buildTriggers,

  buildVpTerms(kit: CardKit): Block[] {
    // Exiled cards still score their PRINTED VP at every recount ($player
    // bound by the recount's forEachPlayer — Island's mat precedent). NOTE
    // the module boundary: Gardens/Fairgrounds-style COUNTS never see Exile.
    return [
      changeVar(kit.vars.VP,
        kit.sumCards(zone(EXILE_ZONE, kit.PLAYER), kit.fields.VP_F), kit.PLAYER),
    ];
  },
};
