/**
 * Prosperity 2E (part B) — Magnate, Mint, Rabble, Vault, War Chest,
 * Grand Market, Hoard, Bank, Expand, Forge, King's Court, Peddler.
 *
 * House idioms follow the Base/Intrigue/Seaside modules: attack halves are
 * separate `stacked: true` abilities gated per victim on IMMUNE == 0 (the
 * shared effectResolved trigger resets it), look-at effects stage through the
 * hidden shared LOOK zone, every mandatory choice is guarded so a session can
 * never hang, and numbers that must survive a filter's $card rebinding ride
 * the per-player SCRATCH variable (names ride module string vars).
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "the player to your
 * left" (War Chest) IS the one opponent (nextPlayer(OWNER)).
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - GRAND MARKET (prominent): the printed "You can't buy this if you have
 *    any Coppers in play" is NOT enforced — buy legality is one central
 *    action shared by every pile and per-card buy restrictions are not
 *    expressible without touching it. Grand Market is simply a $6 buy here.
 *  - PEDDLER (prominent): the printed "$2 less per Action card you have in
 *    play during your Buy phase" is a dynamic per-card cost the engine
 *    cannot express (COST is a static field read by the central buy action).
 *    Peddler is a flat $8 here; the printed self-discount text stays on the
 *    card face as flavor of what the paper card does.
 *  - WAR CHEST: "names a card" is picking a pile from the live supply
 *    (Wishing Well's idiom — only supply cards can be named), and the
 *    exclusion memory is ONE name per player (the most recent card named for
 *    your War Chests this turn, reset at cleanup) — a second War Chest in
 *    one turn only excludes the latest naming, not the whole list.
 *  - RABBLE: the reveal is a face-up pass through the shared LOOK zone; the
 *    non-Action/non-Treasure remainder goes back on top in a FIXED order
 *    (there is no reorder-choice primitive; paper lets the victim choose).
 *  - VAULT: an opponent with fewer than 2 cards in hand is skipped entirely
 *    (paper lets a 1-card hand discard without drawing — dropped).
 *  - FORGE: "exactly equal" compares PRINTED costs — a live Bridge discount
 *    is ignored (Swindler's precedent). A zero total mandates gaining a $0
 *    card when one is available (the paper ruling, honored naturally).
 *  - MINT (on-buy): trashes the buyer's Treasures from In Play only — parked
 *    Duration Treasures are spared, which IS the 2E ruling ("trash all
 *    non-Duration Treasures you have in play").
 *  - BANK / "in play": counts the owner's In Play AND parked DURATION cards
 *    (Sea Chart's reading — printed Durations remain in play between turns).
 *  - KING'S COURT x Duration: the kit's Throne Room contract — `now` runs
 *    three times, the card parks once, `later` fires once.
 */
import type { Block, CardDef, Expr, TriggerDef, VariableDef } from '../../shared/types';
import {
  ALL, add, allOf, announce, anyOf, bestCard, bnd, changeVar, chooseCard, chooseCardsBlock,
  chooseOption, countCards, eq, field, forEachCard, forEachOpponent, getVar, gt, gte, iff,
  lte, matching, move, neq, nextPlayer, num, setVar, shuffle, specific, str, topN, zone,
  zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

/** Mint's revealed Treasure (a name — strings cannot ride the numeric SCRATCH). */
export const MINT_VAR = 'dom_var_mint_copy';
/** War Chest: the LAST card named for this player's War Chests this turn. */
export const WARCHEST_VAR = 'dom_var_war_chest_named';

const IDS: Record<string, string> = {
  Magnate: 'dom_card_magnate',
  Mint: 'dom_card_mint',
  Rabble: 'dom_card_rabble',
  Vault: 'dom_card_vault',
  'War Chest': 'dom_card_war_chest',
  'Grand Market': 'dom_card_grand_market',
  Hoard: 'dom_card_hoard',
  Bank: 'dom_card_bank',
  Expand: 'dom_card_expand',
  Forge: 'dom_card_forge',
  "King's Court": 'dom_card_kings_court',
  Peddler: 'dom_card_peddler',
};

/**
 * The official empty-deck reshuffle for effects that TAKE cards off the deck
 * without the `draw` block (Rabble's reveal): when `who`'s deck is empty,
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
 * is empty). Unrolled per card, so "top 3" keeps the official per-card
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
  const { ACTIONS, BUYS, COINS, IMMUNE, SCRATCH, DISCOUNT } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER } = kit;

  /** "In play" for Bank: the owner's In Play row plus parked Durations. */
  const treasuresInPlay: Expr = add(
    countCards(zone(INPLAY, OWNER), kit.IS_TREASURE_CARD),
    countCards(zone(DURATION, OWNER), kit.IS_TREASURE_CARD),
  );

  /** War Chest's gain filter: costs up to 5 (Bridge-aware), not the named card. */
  const warChestFilter: Expr = allOf(
    lte(field(CARD, COST), add(num(5), getVar(DISCOUNT))),
    neq(field(CARD, 'name'), getVar(WARCHEST_VAR, OWNER)),
  );

  return [
    // MAGNATE — exact. The reveal is an announcement (Shanty Town's idiom);
    // the draw count is fixed BEFORE any card is drawn (the draw block
    // evaluates its count up front), matching paper.
    kit.cardDef(IDS.Magnate, 'Magnate', 5, 0, 0,
      'Reveal your hand. +1 Card per Treasure in it.', [
        kit.onPlay('dom_ab_magnate', 'Old money talks', [
          announce(OWNER, ' reveals their hand.'),
          kit.drawN(OWNER, countCards(zone(HAND, OWNER), kit.IS_TREASURE_CARD)),
        ]),
      ]),

    // MINT — on-play: reveal a Treasure from your hand, gain a copy (the
    // name rides MINT_VAR past the supply filter's $card rebinding; the gain
    // whiffs when the pile is empty). The on-buy trash-all-Treasures half is
    // a module trigger (buildTriggers) on the 'buy' cause tag.
    kit.cardDef(IDS.Mint, 'Mint', 5, 0, 0,
      'You may reveal a Treasure card from your hand. Gain a copy of it. When you buy this, trash all non-Duration Treasures you have in play.', [
        kit.onPlay('dom_ab_mint', 'Struck fresh', [
          setVar(MINT_VAR, str(''), OWNER),
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_TREASURE_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_TREASURE_CARD,
              min: num(0), max: num(1),
              prompt: 'Mint: you may reveal a Treasure to gain a copy of it',
              body: [
                setVar(MINT_VAR, field(CARD, 'name'), OWNER),
                announce(OWNER, ' reveals ', CARD, '.'),
              ],
            }),
          ]),
          iff(neq(getVar(MINT_VAR, OWNER), str('')), [
            iff(gt(countCards(zone(SUPPLY),
              eq(field(CARD, 'name'), getVar(MINT_VAR, OWNER))), num(0)), [
              announce(OWNER, ' mints a fresh copy.'),
              kit.tmove(
                specific(bestCard(zone(SUPPLY), 'highest', COST,
                  eq(field(CARD, 'name'), getVar(MINT_VAR, OWNER)))),
                zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
              ),
            ], [announce('The supply has no copy left to mint.')]),
          ]),
        ]),
      ]),

    // RABBLE — Action – Attack. The draw is immediate; only the attack half
    // goes through the stack (Militia's pattern) so Moat owners get their
    // response window. DEVIATION: the remainder returns in a fixed order.
    kit.cardDef(IDS.Rabble, 'Rabble', 5, 0, 0,
      '+3 Cards. Each other player reveals the top 3 cards of their deck, discards the revealed Actions and Treasures, and puts the rest back in any order they choose.', [
        kit.onPlay('dom_ab_rabble_draw', 'Strength in numbers', [
          kit.draw(OWNER, 3),
        ]),
        kit.onPlay('dom_ab_rabble_attack', 'The mob at the gates', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              ...takeTop(kit, PLAYER, zone(LOOK), true),
              ...takeTop(kit, PLAYER, zone(LOOK), true),
              ...takeTop(kit, PLAYER, zone(LOOK), true),
              announce(PLAYER, ' reveals the top cards of their deck.'),
              iff(gt(countCards(zone(LOOK),
                anyOf(kit.IS_ACTION_CARD, kit.IS_TREASURE_CARD)), num(0)), [
                announce(PLAYER, ' discards the revealed Actions and Treasures.'),
                kit.tmove(
                  matching(anyOf(kit.IS_ACTION_CARD, kit.IS_TREASURE_CARD)),
                  zone(LOOK), zone(DISCARD, PLAYER), 'discard', { faceUp: true },
                ),
              ]),
              iff(gt(zoneCount(zone(LOOK)), num(0)), [
                move(ALL, zone(LOOK), zone(DECK, PLAYER), { toPosition: 'top', faceUp: false }),
              ]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // VAULT — +2 Cards, discard any number for +$1 each; then each other
    // player may (yes/no) discard exactly 2 to draw 1. Not an attack: no
    // stack, no response window, the opponents' part is their own choice.
    // DEVIATION: an opponent holding fewer than 2 cards is skipped.
    kit.cardDef(IDS.Vault, 'Vault', 5, 0, 0,
      '+2 Cards. Discard any number of cards for +$1 each. Each other player may discard 2 cards, to draw a card.', [
        kit.onPlay('dom_ab_vault', 'Down among the strongboxes', [
          kit.draw(OWNER, 2),
          chooseCardsBlock({
            who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(99),
            prompt: 'Vault: discard any number of cards for +$1 each',
            body: [
              announce(OWNER, ' discards ', CARD, ' (+$1).'),
              kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              changeVar(COINS, num(1), OWNER),
            ],
          }),
          forEachOpponent([
            iff(gte(zoneCount(zone(HAND, PLAYER)), num(2)), [
              chooseOption('Vault: discard 2 cards to draw a card?', [
                { id: 'vault_yes', label: 'Discard 2 cards, draw 1' },
                { id: 'vault_no', label: 'Keep your hand' },
              ], PLAYER),
              iff(eq(CHOICE, str('vault_yes')), [
                chooseCardsBlock({
                  who: PLAYER, from: zone(HAND, PLAYER), min: num(2), max: num(2),
                  prompt: 'Vault: discard 2 cards',
                  body: [
                    announce(PLAYER, ' discards ', CARD, '.'),
                    kit.tmove(specific(CARD), zone(HAND, PLAYER), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
                  ],
                }),
                kit.draw(PLAYER, 1),
              ]),
            ]),
          ]),
        ]),
      ]),

    // WAR CHEST — Treasure (produces no coins itself). 2-player reading:
    // "the player to your left" = the opponent, who names a supply pile;
    // the owner then gains a card costing up to 5 that isn't the named card.
    // DEVIATION (header register): one-name memory, supply-only naming.
    kit.cardDef(IDS['War Chest'], 'War Chest', 5, 0, 0,
      "The player to your left names a card. Gain a card costing up to $5 that hasn't been named for War Chests this turn.", [
        kit.onPlay('dom_ab_war_chest', 'Spoils spoken for', [
          iff(gt(zoneCount(zone(SUPPLY)), num(0)), [
            kit.choosePileBlock({
              who: nextPlayer(OWNER), from: zone(SUPPLY), revealed: true,
              prompt: 'War Chest: name a card (the owner cannot gain it)',
              body: [
                setVar(WARCHEST_VAR, field(CARD, 'name'), OWNER),
                announce(nextPlayer(OWNER), ' names ', CARD, ' for the War Chest.'),
              ],
            }),
            iff(gt(countCards(zone(SUPPLY), warChestFilter), num(0)), [
              kit.choosePileBlock({
                who: OWNER, from: zone(SUPPLY), filter: warChestFilter,
                prompt: 'War Chest: gain a card costing up to 5 (not the named card)',
                body: [
                  announce(OWNER, ' gains ', CARD, ' from the war chest.'),
                  kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                ],
              }),
            ], [announce('Nothing affordable is left unnamed — the chest stays shut.')]),
          ]),
        ]),
      ]),

    // GRAND MARKET — the four bonuses are exact. PROMINENT DEVIATION (header
    // register): the Copper-in-play buy restriction is not enforced.
    kit.cardDef(IDS['Grand Market'], 'Grand Market', 6, 0, 0,
      "+1 Card. +1 Action. +1 Buy. +$2. You can't buy this if you have any Coppers in play.", [
        kit.onPlay('dom_ab_grand_market', 'The high bazaar', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(BUYS, num(1), OWNER),
          changeVar(COINS, num(2), OWNER),
        ]),
      ]),

    // HOARD — Treasure worth $2 (the coin FIELD pays it); the while-in-play
    // Gold-on-Victory-buy watcher is a module trigger (buildTriggers) that
    // grants one Gold PER Hoard in the buyer's In Play row.
    kit.cardDef(IDS.Hoard, 'Hoard', 6, 2, 0,
      '$2. While this is in play, when you buy a Victory card, gain a Gold.'),

    // BANK — Treasure with a 0 coin field: the whole payout is the on-play
    // count of the owner's Treasures in play (In Play + parked DURATION,
    // see the header register) — Bank itself already sits in In Play when
    // the ability fires, so "counting this" is automatic.
    kit.cardDef(IDS.Bank, 'Bank', 7, 0, 0,
      "When you play this, it's worth $1 per Treasure you have in play (counting this).", [
        kit.onPlay('dom_ab_bank', 'Compound interest', [
          changeVar(COINS, treasuresInPlay, OWNER),
        ]),
      ]),

    // EXPAND — Remodel's exact shape with a +3 window (SCRATCH carries the
    // cap past the supply filter's $card rebinding; gainFromSupply is
    // Bridge-aware and whiffs gracefully).
    kit.cardDef(IDS.Expand, 'Expand', 7, 0, 0,
      'Trash a card from your hand. Gain a card costing up to $3 more than it.', [
        kit.onPlay('dom_ab_expand', 'Bigger plans', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({ who: OWNER, from: zone(HAND, OWNER), prompt: 'Expand: choose a card to trash' }),
            setVar(SCRATCH, add(field(CHOICE, COST), num(3)), OWNER),
            announce(OWNER, ' trashes ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            ...kit.gainFromSupply({
              limit: getVar(SCRATCH, OWNER),
              prompt: 'Expand: gain a card costing up to 3 more than the trashed card',
              whiff: [announce('Nothing in the supply is cheap enough.')],
            }),
          ], [announce(OWNER, ' has nothing to expand.')]),
        ]),
      ]),

    // FORGE — trash any number (SCRATCH accumulates the PRINTED costs, read
    // before each card leaves the hand), then a MANDATORY exact-cost gain
    // when one exists — a zero total must take a $0 card (the paper ruling).
    // DEVIATION (header register): printed costs, Bridge ignored.
    kit.cardDef(IDS.Forge, 'Forge', 7, 0, 0,
      'Trash any number of cards from your hand. Gain a card with cost exactly equal to the total cost in coins of the trashed cards.', [
        kit.onPlay('dom_ab_forge', 'Hammer and anvil', [
          setVar(SCRATCH, num(0), OWNER),
          chooseCardsBlock({
            who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(99),
            prompt: 'Forge: trash any number of cards from your hand',
            body: [
              announce(OWNER, ' trashes ', CARD, '.'),
              changeVar(SCRATCH, field(CARD, COST), OWNER),
              kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            ],
          }),
          iff(gt(countCards(zone(SUPPLY), eq(field(CARD, COST), getVar(SCRATCH, OWNER))), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY),
              filter: eq(field(CARD, COST), getVar(SCRATCH, OWNER)),
              prompt: 'Forge: gain a card costing exactly the total trashed',
              body: [
                announce(OWNER, ' forges ', CARD, '.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
              ],
            }),
          ], [announce('No card in the supply costs exactly that — nothing is forged.')]),
        ]),
      ]),

    // KING'S COURT — Throne Room's exact pattern, one play plus TWO
    // synthetic replays (unrolled — no repeat block). "You may": the pick is
    // a 0-or-1 chooseCards, so declining is always legal.
    kit.cardDef(IDS["King's Court"], "King's Court", 7, 0, 0,
      'You may play an Action card from your hand three times.', [
        kit.onPlay('dom_ab_kings_court', 'Thrice by royal decree', [
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_ACTION_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_ACTION_CARD,
              min: num(0), max: num(1),
              prompt: "King's Court: you may play an Action card three times",
              body: [
                announce(OWNER, ' plays ', CARD, " three times with King's Court."),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
                kit.playAgain(CARD),
                kit.playAgain(CARD),
              ],
            }),
          ], [announce(OWNER, ' has no Action for the court.')]),
        ]),
      ]),

    // PEDDLER — the bonuses are exact. PROMINENT DEVIATION (header
    // register): flat printed cost 8, no dynamic buy-phase self-discount.
    kit.cardDef(IDS.Peddler, 'Peddler', 8, 0, 0,
      '+1 Card. +1 Action. +$1. During your Buy phase, this costs $2 less per Action card you have in play, but not less than $0.', [
        kit.onPlay('dom_ab_peddler', 'Wares for every alley', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(COINS, num(1), OWNER),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, TRASH, INPLAY, DISCARD } = kit.zones;
  const { COST } = kit.fields;
  const { CARD } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the buyer. */
  const BUYER = bnd('$owner');

  return [
    // MINT (on-buy): buying a Mint trashes all the buyer's Treasures in
    // play. In-Play only — parked Duration Treasures are spared, which is
    // the 2E ruling ("non-Duration Treasures").
    {
      id: 'dom_trigger_mint_buy',
      name: 'Mint: buying it trashes your Treasures in play',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
      condition: eq(field(CARD, 'name'), str('Mint')),
      script: [
        iff(gt(countCards(zone(INPLAY, BUYER), kit.IS_TREASURE_CARD), num(0)), [
          announce(BUYER, ' trashes all their Treasures in play — the Mint takes the old coin.'),
          kit.tmove(
            matching(kit.IS_TREASURE_CARD),
            zone(INPLAY, BUYER), zone(TRASH), 'trash', { faceUp: true },
          ),
        ]),
      ],
    },
    // HOARD: buying a Victory card gains the buyer a Gold per Hoard they
    // have in play. Only 'buy'-tagged moves count (paper: bought, not merely
    // gained); forEachCard hands out one Gold per Hoard, no repeat block.
    {
      id: 'dom_trigger_hoard_buy',
      name: 'Hoard: buying a Victory card gains a Gold',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
      condition: kit.isA(CARD, kit.types.VICTORY),
      script: [
        forEachCard(zone(INPLAY, BUYER), kit.nameIs('Hoard'), [
          iff(gt(countCards(zone(SUPPLY), kit.nameIs('Gold')), num(0)), [
            announce(BUYER, ' gains a Gold — the Hoard grows.'),
            kit.tmove(
              specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Gold'))),
              zone(SUPPLY), zone(DISCARD, BUYER), 'gain', { faceUp: true },
            ),
          ], [announce('The Gold pile is empty — the Hoard gains nothing.')]),
        ]),
      ],
    },
  ];
}

export const prosperity2eB: ExpansionModule = {
  id: 'prosperity2eB',
  setName: 'Prosperity',

  piles: [
    { name: 'Magnate', cost: 5, count: 10 },
    { name: 'Mint', cost: 5, count: 10 },
    { name: 'Rabble', cost: 5, count: 10 },
    { name: 'Vault', cost: 5, count: 10 },
    { name: 'War Chest', cost: 5, count: 10 },
    { name: 'Grand Market', cost: 6, count: 10 },
    { name: 'Hoard', cost: 6, count: 10 },
    { name: 'Bank', cost: 7, count: 10 },
    { name: 'Expand', cost: 7, count: 10 },
    { name: 'Forge', cost: 7, count: 10 },
    { name: "King's Court", cost: 7, count: 10 },
    { name: 'Peddler', cost: 8, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Rabble'],
  treasureNames: ['Bank', 'Hoard', 'War Chest'],

  variables: [
    {
      id: MINT_VAR, name: 'Mint: revealed Treasure',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: WARCHEST_VAR, name: 'War Chest: named this turn',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
  ] as VariableDef[],

  buildCards,
  buildTriggers,

  buildCleanupResets(): Block[] {
    // "…named for War Chests THIS TURN": the memory fades with the turn.
    return [setVar(WARCHEST_VAR, str(''))];
  },
};
