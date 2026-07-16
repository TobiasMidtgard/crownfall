/**
 * Guilds 1E — Candlestick Maker, Stonemason, Doctor, Masterpiece, Advisor,
 * Herald, Plaza, Taxman, Baker, Butcher, Journeyman, Merchant Guild,
 * Soothsayer.
 *
 * House idioms follow the Base/Intrigue/Seaside modules: attack halves are
 * separate `stacked: true` abilities gated per victim on IMMUNE == 0 (the
 * shared effectResolved trigger resets it), look-at effects stage through the
 * hidden shared LOOK zone, and every mandatory choice is guarded so a session
 * can never hang on an empty prompt.
 *
 * COIN TOKENS: the set's tokens ARE the core COFFERS bank (dom_var_coffers).
 * Cards here only BANK them (changeVar); the core already ships the
 * "Spend a Coffer" buy-phase action + status-strip button that cashes one
 * token for +$1.
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "the player to your
 * left" (Advisor) IS the one opponent (nextPlayer(OWNER)).
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - OVERPAY (Stonemason / Doctor / Masterpiece / Herald — prominent): true
 *    declare-at-buy overpay is not part of the core buy action. Closest
 *    honest approximation: a 'buy'-tagged trigger fires when the bought card
 *    lands (buy action AND Black Market sales carry the tag) and offers an
 *    optional "pay $1 more?" yes/no loop, UNROLLED to a documented cap of
 *    OVERPAY_CAP = 8 steps per purchase (no repeat blocks). Each accepted
 *    step pays $1 from the turn's coins and immediately grants that card's
 *    per-$ effect (Doctor / Masterpiece / Herald), or raises the declared
 *    amount (Stonemason, which gains its two Action cards after the loop).
 *    Differences from paper: the amount is decided incrementally instead of
 *    declared up front, the steps resolve after the card is gained rather
 *    than as part of paying, and the total is capped at $8.
 *  - STONEMASON overpay: "each costing the amount you overpaid" compares
 *    PRINTED costs (Swindler's precedent — a live Bridge discount is ignored
 *    on the exact-cost match). The on-play "costing less than it" gains ride
 *    kit.gainFromSupply with limit cost-1 and stay Bridge-aware.
 *  - DOCTOR / JOURNEYMAN: "name a card" is Wishing Well's idiom — the player
 *    picks a pile from the live supply (revealed), so only names currently
 *    present in the supply can be named (paper allows naming anything).
 *  - DOCTOR: the put-back goes on top in a FIXED order (no reorder
 *    primitive — Sentry's precedent). The overpay "look at the top card" is
 *    announced to the log (public — the option sheet cannot show a card
 *    face; Library's precedent).
 *  - TAXMAN: the trashed Treasure's name and the gain cap ride hidden
 *    per-player vars between the immediate trash half and the stacked attack
 *    half; a victim's discarded copy is auto-picked (all copies are
 *    identical, no choice), and "reveals a hand without it" is an
 *    announcement. Skipping the trash skips the attack AND the gain, per the
 *    printed ruling. The gain compares Bridge-adjusted current costs.
 *  - BAKER setup: the printed "Setup: each player takes a Coin token" runs
 *    as a one-shot turnStart trigger on the game's first turn, gated on the
 *    Baker pile actually sitting in the active supply.
 *  - BUTCHER: "pay any number of Coin tokens" is a yes/no-per-token loop,
 *    unrolled to the same documented cap of 8 tokens per resolution.
 *  - MERCHANT GUILD: "while this is in play, when you buy a card" is a
 *    'buy'-tagged trigger that pays +1 Coffers per Merchant Guild in the
 *    buyer's In Play at the moment of each buy. Black Market's
 *    under-the-counter sales are 'buy'-tagged and pay out too (they are
 *    buys).
 *  - SOOTHSAYER: the Curse-taker's "+1 Card" resolves inside the attack
 *    (no extra response window between the Curse and the draw).
 */
import type { Block, CardDef, Expr, TriggerDef, VariableDef } from '../../shared/types';
import {
  ALL, add, allOf, announce, bestCard, bnd, changeVar, chooseCard, chooseCardsBlock, chooseOption,
  countCards, eq, field, forEachOpponent, forEachPlayer, getVar, gt, gte, iff, lte, move, neq,
  nextPlayer, num, setVar, shuffle, specific, str, sub, topCard, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  'Candlestick Maker': 'dom_card_candlestick_maker',
  Stonemason: 'dom_card_stonemason',
  Doctor: 'dom_card_doctor',
  Masterpiece: 'dom_card_masterpiece',
  Advisor: 'dom_card_advisor',
  Herald: 'dom_card_herald',
  Plaza: 'dom_card_plaza',
  Taxman: 'dom_card_taxman',
  Baker: 'dom_card_baker',
  Butcher: 'dom_card_butcher',
  Journeyman: 'dom_card_journeyman',
  'Merchant Guild': 'dom_card_merchant_guild',
  Soothsayer: 'dom_card_soothsayer',
};

/** Doctor's / Journeyman's named card; Taxman's trashed Treasure (a name). */
export const GUILDS_NAMED_VAR = 'dom_var_guilds_named';
/** Stonemason's declared overpay total ($1 per accepted step). */
export const GUILDS_OVERPAY_VAR = 'dom_var_guilds_overpay';
/** Taxman's gain cap (trashed printed cost + 3); -1 = nothing was trashed. */
export const TAXMAN_CAP_VAR = 'dom_var_taxman_cap';
/** Baker's printed setup has run (one-shot, global). */
export const BAKER_SETUP_VAR = 'dom_var_baker_setup_done';

/**
 * The documented overpay/token cap: every "pay $1 more?" loop here is
 * unrolled to this many optional steps (the def bans repeat blocks).
 */
export const OVERPAY_CAP = 8;

/** A yes/no question to `who`; the answer lands in $choice as a boolean. */
const yesNo = (who: Expr, prompt: string): Block =>
  ({ kind: 'choose', who, choice: { kind: 'yesNo', prompt } });

/**
 * The official empty-deck reshuffle for effects that TAKE cards off the deck
 * without the `draw` block: when `who`'s deck is empty, flip the discard
 * face-down into it and give it a seeded shuffle.
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

/**
 * The overpay loop (see the header register): while the buyer still has
 * coins, ask "pay $1 more?"; a yes pays the $1, runs one `step`, and nests
 * the next ask — a no (or empty purse, or the cap) ends the loop. `step` is
 * a factory so every nesting level gets fresh block objects.
 */
function overpayChain(
  kit: CardKit, buyer: Expr, prompt: string, step: () => Block[], depth: number,
): Block[] {
  if (depth === 0) return [announce(buyer, ' has hit the $8 overpay cap.')];
  return [
    iff(gt(getVar(kit.vars.COINS, buyer), num(0)), [
      yesNo(buyer, prompt),
      iff(bnd('$choice'), [
        changeVar(kit.vars.COINS, num(-1), buyer),
        ...step(),
        ...overpayChain(kit, buyer, prompt, step, depth - 1),
      ]),
    ]),
  ];
}

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, SCRATCH, DISCOUNT, COFFERS } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER } = kit;

  /** "$card wears the name this player recorded" (fresh node per call). */
  const namedBy = (who: Expr): Expr => eq(field(CARD, 'name'), getVar(GUILDS_NAMED_VAR, who));

  /**
   * Butcher's token loop: while the owner still has Coffers, ask to cash one
   * into +$1 of gain cap (SCRATCH). Unrolled to the documented 8-token cap.
   */
  const butcherTokens = (depth: number): Block[] => {
    if (depth === 0) return [announce(OWNER, ' has hit the 8-token cap.')];
    return [
      iff(gt(getVar(COFFERS, OWNER), num(0)), [
        yesNo(OWNER, 'Butcher: pay a Coin token to raise the gain cap by $1?'),
        iff(CHOICE, [
          changeVar(COFFERS, num(-1), OWNER),
          changeVar(SCRATCH, num(1), OWNER),
          announce(OWNER, ' pays a Coin token — the cap is now $', getVar(SCRATCH, OWNER), '.'),
          ...butcherTokens(depth - 1),
        ]),
      ]),
    ];
  };

  return [
    // CANDLESTICK MAKER — exact. "Take a Coin token" banks a core Coffers.
    kit.cardDef(IDS['Candlestick Maker'], 'Candlestick Maker', 2, 0, 0,
      '+1 Action. +1 Buy. Take a Coin token.', [
        kit.onPlay('dom_ab_candlestick_maker', 'Wax and wick', [
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(BUYS, num(1), OWNER),
          changeVar(COFFERS, num(1), OWNER),
          announce(OWNER, ' takes a Coin token.'),
        ]),
      ]),

    // STONEMASON — the on-play half is exact ("less than it" = printed cost
    // minus 1, Bridge-aware through gainFromSupply). The on-buy overpay half
    // lives in buildTriggers (see the header register).
    kit.cardDef(IDS.Stonemason, 'Stonemason', 2, 0, 0,
      'Trash a card from your hand. Gain 2 cards each costing less than it. When you buy this, you may overpay for it. If you do, gain 2 Action cards each costing the amount you overpaid.', [
        kit.onPlay('dom_ab_stonemason', 'Chisel and split', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Stonemason: trash a card from your hand',
            }),
            setVar(SCRATCH, sub(field(CHOICE, COST), num(1)), OWNER),
            announce(OWNER, ' trashes ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            ...kit.gainFromSupply({
              limit: getVar(SCRATCH, OWNER),
              prompt: 'Stonemason: gain the first card costing less than the trashed card',
              whiff: [announce('Nothing in the supply costs less than the trashed card.')],
            }),
            ...kit.gainFromSupply({
              limit: getVar(SCRATCH, OWNER),
              prompt: 'Stonemason: gain the second card costing less than the trashed card',
              whiff: [announce('Nothing in the supply costs less than the trashed card.')],
            }),
          ], [announce(OWNER, ' has nothing to split.')]),
        ]),
      ]),

    // DOCTOR — "name a card" is a revealed supply-pile pick (Wishing Well's
    // idiom, see the register); the put-back order is fixed (Sentry's
    // precedent). The overpay half lives in buildTriggers.
    kit.cardDef(IDS.Doctor, 'Doctor', 3, 0, 0,
      'Name a card. Reveal the top 3 cards of your deck. Trash the matches. Put the rest back on top in any order. When you buy this, you may overpay for it. For each $1 you overpaid, look at the top card of your deck; trash it, discard it, or put it back.', [
        kit.onPlay('dom_ab_doctor', 'The examination', [
          iff(gt(zoneCount(zone(SUPPLY)), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY), revealed: true,
              prompt: 'Doctor: name a card (its copies will be trashed)',
              body: [
                setVar(GUILDS_NAMED_VAR, field(CARD, 'name'), OWNER),
                announce(OWNER, ' names ', CARD, '.'),
              ],
            }),
            ...takeTop(kit, OWNER, zone(LOOK), true),
            ...takeTop(kit, OWNER, zone(LOOK), true),
            ...takeTop(kit, OWNER, zone(LOOK), true),
            announce(OWNER, ' reveals the top cards of their deck.'),
            iff(gt(countCards(zone(LOOK), namedBy(OWNER)), num(0)), [
              announce(OWNER, ' trashes the matches.'),
              kit.tmove({ kind: 'filter', filter: namedBy(OWNER) },
                zone(LOOK), zone(TRASH), 'trash', { faceUp: true }),
            ], [announce('No revealed card matches the named one.')]),
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
            ]),
          ], [announce('The supply is empty — nothing can be named.')]),
        ]),
      ]),

    // MASTERPIECE — Treasure (treasureNames): the on-play +$1 is the coin
    // FIELD paid by the core treasure action (Astrolabe's precedent), so the
    // card needs no abilities. The overpay half lives in buildTriggers.
    kit.cardDef(IDS.Masterpiece, 'Masterpiece', 3, 1, 0,
      '$1. When you buy this, you may overpay for it. Gain a Silver per $1 you overpaid.'),

    // ADVISOR — 2-player reading: "the player to your left" IS the opponent,
    // who picks the discarded card from the revealed three.
    kit.cardDef(IDS.Advisor, 'Advisor', 4, 0, 0,
      '+1 Action. Reveal the top 3 cards of your deck. The player to your left chooses one of them. Discard that card. Put the other cards into your hand.', [
        kit.onPlay('dom_ab_advisor', 'Counsel of rivals', [
          changeVar(ACTIONS, num(1), OWNER),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            chooseCard({
              who: nextPlayer(OWNER), from: zone(LOOK), revealed: true,
              prompt: 'Advisor: choose the revealed card the owner must discard',
            }),
            announce(nextPlayer(OWNER), ' makes ', OWNER, ' discard ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              kit.tmove(ALL, zone(LOOK), zone(HAND, OWNER), 'draw', { faceUp: true }),
            ]),
          ], [announce(OWNER, ' has no cards left to reveal.')]),
        ]),
      ]),

    // HERALD — the revealed Action is played straight off the deck (a
    // 'play'-tagged move, Vassal's idiom — its abilities fire normally).
    // The overpay half lives in buildTriggers.
    kit.cardDef(IDS.Herald, 'Herald', 4, 0, 0,
      '+1 Card. +1 Action. Reveal the top card of your deck. If it is an Action, play it. When you buy this, you may overpay for it. For each $1 you overpaid, put any card from your discard pile on top of your deck.', [
        kit.onPlay('dom_ab_herald', 'Cry the news', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          refillDeck(kit, OWNER),
          iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
            announce(OWNER, ' reveals ', topCard(zone(DECK, OWNER)), '.'),
            iff(kit.isA(topCard(zone(DECK, OWNER)), kit.types.ACTION), [
              announce(OWNER, ' plays it with the Herald.'),
              kit.tmove(specific(topCard(zone(DECK, OWNER))),
                zone(DECK, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
            ], [announce('It is not an Action — it stays on the deck.')]),
          ], [announce(OWNER, ' has no cards left to reveal.')]),
        ]),
      ]),

    // PLAZA — exact.
    kit.cardDef(IDS.Plaza, 'Plaza', 4, 0, 0,
      '+1 Card. +2 Actions. You may discard a Treasure card. If you do, take a Coin token.', [
        kit.onPlay('dom_ab_plaza', 'Square of trades', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_TREASURE_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_TREASURE_CARD,
              min: num(0), max: num(1),
              prompt: 'Plaza: you may discard a Treasure for a Coin token',
              body: [
                announce(OWNER, ' discards ', CARD, ' for a Coin token.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                changeVar(COFFERS, num(1), OWNER),
              ],
            }),
          ]),
        ]),
      ]),

    // TAXMAN — Action – Attack. The optional trash is immediate (records the
    // copy's name + the gain cap in hidden vars); only the attack + gain half
    // goes through the stack (Militia's pattern, so Moat owners get their
    // window). Skipping the trash skips the attack AND the gain.
    kit.cardDef(IDS.Taxman, 'Taxman', 4, 0, 0,
      'You may trash a Treasure from your hand. Each other player with 5 or more cards in hand discards a copy of it (or reveals a hand without it). Gain a Treasure onto your deck costing up to $3 more than it.', [
        kit.onPlay('dom_ab_taxman_trash', 'The assessor calls', [
          setVar(TAXMAN_CAP_VAR, num(-1), OWNER),
          setVar(GUILDS_NAMED_VAR, str(''), OWNER),
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_TREASURE_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_TREASURE_CARD,
              min: num(0), max: num(1),
              prompt: 'Taxman: you may trash a Treasure from your hand',
              body: [
                setVar(GUILDS_NAMED_VAR, field(CARD, 'name'), OWNER),
                setVar(TAXMAN_CAP_VAR, add(field(CARD, COST), num(3)), OWNER),
                announce(OWNER, ' trashes ', CARD, ' for the tax rolls.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              ],
            }),
          ]),
        ]),
        kit.onPlay('dom_ab_taxman_attack', 'Levy the fiefs', [
          iff(gte(getVar(TAXMAN_CAP_VAR, OWNER), num(0)), [
            forEachOpponent([
              iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
                iff(gte(zoneCount(zone(HAND, PLAYER)), num(5)), [
                  iff(gt(countCards(zone(HAND, PLAYER), namedBy(OWNER)), num(0)), [
                    announce(PLAYER, ' discards a copy of the taxed Treasure.'),
                    kit.tmove(
                      specific(bestCard(zone(HAND, PLAYER), 'highest', COST, namedBy(OWNER))),
                      zone(HAND, PLAYER), zone(DISCARD, PLAYER), 'discard', { faceUp: true },
                    ),
                  ], [announce(PLAYER, ' reveals a hand without a copy.')]),
                ], [announce(PLAYER, ' has fewer than 5 cards in hand — the taxman passes by.')]),
              ]),
            ]),
            iff(gt(countCards(zone(SUPPLY), allOf(
              kit.IS_TREASURE_CARD,
              lte(field(CARD, COST), add(getVar(TAXMAN_CAP_VAR, OWNER), getVar(DISCOUNT))),
            )), num(0)), [
              kit.choosePileBlock({
                who: OWNER, from: zone(SUPPLY),
                filter: allOf(
                  kit.IS_TREASURE_CARD,
                  lte(field(CARD, COST), add(getVar(TAXMAN_CAP_VAR, OWNER), getVar(DISCOUNT))),
                ),
                prompt: 'Taxman: gain a Treasure onto your deck costing up to $3 more than the trashed one',
                body: [
                  announce(OWNER, ' gains ', CARD, ' onto their deck.'),
                  kit.tmove(specific(CARD), zone(SUPPLY), zone(DECK, OWNER), 'gain',
                    { toPosition: 'top', faceUp: true }),
                ],
              }),
            ], [announce('No Treasure in the supply is cheap enough — nothing gained.')]),
          ], [announce(OWNER, ' taxed nothing — the levy is waived.')]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // BAKER — the play half is exact; the printed setup line is the one-shot
    // turnStart trigger in buildTriggers (see the register).
    kit.cardDef(IDS.Baker, 'Baker', 5, 0, 0,
      '+1 Card. +1 Action. Take a Coin token. Setup: Each player takes a Coin token.', [
        kit.onPlay('dom_ab_baker', 'Fresh loaves', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(COFFERS, num(1), OWNER),
          announce(OWNER, ' takes a Coin token.'),
        ]),
      ]),

    // BUTCHER — "pay any number of Coin tokens" is the unrolled 8-token loop
    // (see the register). SCRATCH carries the cap: trashed cost + $1/token.
    kit.cardDef(IDS.Butcher, 'Butcher', 5, 0, 0,
      'Take 2 Coin tokens. You may trash a card from your hand and then pay any number of Coin tokens. If you did trash a card, gain a card with a cost of up to the cost of the trashed card plus the number of Coin tokens you paid.', [
        kit.onPlay('dom_ab_butcher', 'To the block', [
          changeVar(COFFERS, num(2), OWNER),
          announce(OWNER, ' takes 2 Coin tokens.'),
          setVar(SCRATCH, num(-1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(1),
              prompt: 'Butcher: you may trash a card from your hand',
              body: [
                setVar(SCRATCH, field(CARD, COST), OWNER),
                announce(OWNER, ' trashes ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              ],
            }),
          ]),
          iff(gte(getVar(SCRATCH, OWNER), num(0)), [
            ...butcherTokens(OVERPAY_CAP),
            ...kit.gainFromSupply({
              limit: getVar(SCRATCH, OWNER),
              prompt: 'Butcher: gain a card costing up to the trashed cost plus the tokens paid',
              whiff: [announce('Nothing in the supply is cheap enough.')],
            }),
          ]),
        ]),
      ]),

    // JOURNEYMAN — "name a card" is the revealed supply-pile pick (see the
    // register). The dig is a repeatWhile: non-matches go straight to hand,
    // matches wait in LOOK and are discarded at the end, as printed.
    kit.cardDef(IDS.Journeyman, 'Journeyman', 5, 0, 0,
      'Name a card. Reveal cards from the top of your deck until you reveal 3 cards that are not the named card. Put those cards into your hand and discard the rest.', [
        kit.onPlay('dom_ab_journeyman', 'The long road', [
          iff(gt(zoneCount(zone(SUPPLY)), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY), revealed: true,
              prompt: 'Journeyman: name a card (revealed copies will be discarded)',
              body: [
                setVar(GUILDS_NAMED_VAR, field(CARD, 'name'), OWNER),
                announce(OWNER, ' names ', CARD, '.'),
              ],
            }),
            setVar(SCRATCH, num(0), OWNER),
            {
              kind: 'repeatWhile',
              cond: allOf(
                gt(num(3), getVar(SCRATCH, OWNER)),
                gt(add(zoneCount(zone(DECK, OWNER)), zoneCount(zone(DISCARD, OWNER))), num(0)),
              ),
              body: [
                refillDeck(kit, OWNER),
                iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
                  move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: true }),
                  announce(OWNER, ' reveals ', topCard(zone(LOOK)), '.'),
                  iff(neq(field(topCard(zone(LOOK)), 'name'), getVar(GUILDS_NAMED_VAR, OWNER)), [
                    kit.tmove(specific(topCard(zone(LOOK))), zone(LOOK), zone(HAND, OWNER), 'draw',
                      { faceUp: true }),
                    changeVar(SCRATCH, num(1), OWNER),
                  ]),
                ]),
              ],
            } as Block,
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              announce(OWNER, ' discards the named copies.'),
              kit.tmove(ALL, zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
            ]),
          ], [announce('The supply is empty — nothing can be named.')]),
        ]),
      ]),

    // MERCHANT GUILD — the play half is exact; "while this is in play, when
    // you buy a card, take a Coin token" is the 'buy'-tagged trigger in
    // buildTriggers (one Coffers per Merchant Guild in play, per buy).
    kit.cardDef(IDS['Merchant Guild'], 'Merchant Guild', 5, 0, 0,
      '+1 Buy. +$1. While this is in play, when you buy a card, take a Coin token.', [
        kit.onPlay('dom_ab_merchant_guild', 'Guild dues', [
          changeVar(BUYS, num(1), OWNER),
          changeVar(COINS, num(1), OWNER),
        ]),
      ]),

    // SOOTHSAYER — Action – Attack. The Gold is immediate; the Curse half is
    // stacked (Witch's pattern). A victim who actually gains the Curse draws
    // a card, as printed; an empty Curse pile grants no draw.
    kit.cardDef(IDS.Soothsayer, 'Soothsayer', 5, 0, 0,
      'Gain a Gold. Each other player gains a Curse. Each player who did draws a card.', [
        kit.onPlay('dom_ab_soothsayer_gold', 'Read the omens', [
          iff(gt(countCards(zone(SUPPLY), kit.nameIs('Gold')), num(0)), [
            announce(OWNER, ' gains a Gold.'),
            kit.tmove(
              specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Gold'))),
              zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
            ),
          ], [announce('The Gold pile is empty — the omens promise nothing.')]),
        ]),
        kit.onPlay('dom_ab_soothsayer_attack', 'Dark prophecy', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(gt(countCards(zone(SUPPLY), kit.nameIs('Curse')), num(0)), [
                announce(PLAYER, ' gains a Curse — and draws a card.'),
                kit.tmove(
                  specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Curse'))),
                  zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
                ),
                kit.draw(PLAYER, 1),
              ], [announce('The Curse pile is empty — no doom to deal.')]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, TRASH, DECK, DISCARD, INPLAY, LOOK } = kit.zones;
  const { COFFERS } = kit.vars;
  const { COST } = kit.fields;
  const { CARD, PLAYER } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the buyer. */
  const BUYER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** One overpay trigger: fires when `name` is bought, runs the yes/no loop. */
  const overpayTrigger = (
    name: string, id: string, prompt: string, step: () => Block[],
    wrap: (chain: Block[]) => Block[] = (chain) => chain,
  ): TriggerDef => ({
    id,
    name: `${name}: overpay on buy`,
    event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
    condition: kit.nameIs(name),
    script: wrap(overpayChain(kit, BUYER, prompt, step, OVERPAY_CAP)),
  });

  /** Doctor's per-$ step: look at the top card — trash / discard / put back. */
  const doctorStep = (): Block[] => [
    refillDeck(kit, BUYER),
    iff(gt(zoneCount(zone(DECK, BUYER)), num(0)), [
      move(topN(1), zone(DECK, BUYER), zone(LOOK), { faceUp: false }),
      // DEVIATION: the look is announced to the log (public) — the option
      // sheet cannot show a card face (Library's precedent).
      announce(BUYER, ' looks at ', topCard(zone(LOOK)), '.'),
      chooseOption('Doctor: the top card of your deck — trash it, discard it, or put it back?', [
        { id: 'doc_trash', label: 'Trash it' },
        { id: 'doc_discard', label: 'Discard it' },
        { id: 'doc_back', label: 'Put it back' },
      ], BUYER),
      iff(eq(bnd('$choice'), str('doc_trash')), [
        announce(BUYER, ' trashes ', topCard(zone(LOOK)), '.'),
        kit.tmove(specific(topCard(zone(LOOK))), zone(LOOK), zone(TRASH), 'trash', { faceUp: true }),
      ], [
        iff(eq(bnd('$choice'), str('doc_discard')), [
          announce(BUYER, ' discards ', topCard(zone(LOOK)), '.'),
          kit.tmove(specific(topCard(zone(LOOK))), zone(LOOK), zone(DISCARD, BUYER), 'discard',
            { faceUp: true }),
        ], [
          move(specific(topCard(zone(LOOK))), zone(LOOK), zone(DECK, BUYER),
            { toPosition: 'top', faceUp: false }),
        ]),
      ]),
    ], [announce(BUYER, ' has no cards left to examine.')]),
  ];

  /** Masterpiece's per-$ step: gain a Silver. */
  const masterpieceStep = (): Block[] => [
    iff(gt(countCards(zone(SUPPLY), kit.nameIs('Silver')), num(0)), [
      announce(BUYER, ' gains a Silver for the overpay.'),
      kit.tmove(
        specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Silver'))),
        zone(SUPPLY), zone(DISCARD, BUYER), 'gain', { faceUp: true },
      ),
    ], [announce('The Silver pile is empty — the overpay buys nothing.')]),
  ];

  /** Herald's per-$ step: topdeck any card from the discard (the bought
   *  Herald itself is already there and may be picked, as officially ruled). */
  const heraldStep = (): Block[] => [
    iff(gt(zoneCount(zone(DISCARD, BUYER)), num(0)), [
      chooseCardsBlock({
        who: BUYER, from: zone(DISCARD, BUYER), min: num(1), max: num(1), revealed: true,
        prompt: 'Herald: put a card from your discard pile onto your deck',
        body: [
          announce(BUYER, ' puts ', CARD, ' onto their deck.'),
          move(specific(CARD), zone(DISCARD, BUYER), zone(DECK, BUYER),
            { toPosition: 'top', faceUp: false }),
        ],
      }),
    ], [announce(BUYER, "'s discard pile is empty — nothing to put back.")]),
  ];

  /** Stonemason's exact-cost Action gain (PRINTED cost — see the register). */
  const stonemasonGain = (which: string): Block[] => [
    iff(gt(countCards(zone(SUPPLY), allOf(
      kit.IS_ACTION_CARD,
      eq(field(CARD, COST), getVar(GUILDS_OVERPAY_VAR, BUYER)),
    )), num(0)), [
      kit.choosePileBlock({
        who: BUYER, from: zone(SUPPLY),
        filter: allOf(
          kit.IS_ACTION_CARD,
          eq(field(CARD, COST), getVar(GUILDS_OVERPAY_VAR, BUYER)),
        ),
        prompt: `Stonemason: gain the ${which} Action card costing exactly the overpaid amount`,
        body: [
          announce(BUYER, ' gains ', CARD, '.'),
          kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, BUYER), 'gain', { faceUp: true }),
        ],
      }),
    ], [announce('No Action card in the supply costs exactly the overpaid amount.')]),
  ];

  return [
    overpayTrigger('Doctor', 'dom_trigger_guilds_overpay_doctor',
      'Doctor: pay $1 more to examine the top card of your deck?', doctorStep),
    overpayTrigger('Masterpiece', 'dom_trigger_guilds_overpay_masterpiece',
      'Masterpiece: pay $1 more to gain a Silver?', masterpieceStep),
    overpayTrigger('Herald', 'dom_trigger_guilds_overpay_herald',
      'Herald: pay $1 more to topdeck a card from your discard pile?', heraldStep),
    overpayTrigger('Stonemason', 'dom_trigger_guilds_overpay_stonemason',
      'Stonemason: overpay $1 more? (you will gain 2 Action cards costing exactly the total)',
      () => [
        changeVar(GUILDS_OVERPAY_VAR, num(1), BUYER),
        announce(BUYER, ' has overpaid $', getVar(GUILDS_OVERPAY_VAR, BUYER), ' for the Stonemason.'),
      ],
      (chain) => [
        setVar(GUILDS_OVERPAY_VAR, num(0), BUYER),
        ...chain,
        iff(gt(getVar(GUILDS_OVERPAY_VAR, BUYER), num(0)), [
          ...stonemasonGain('first'),
          ...stonemasonGain('second'),
        ]),
      ]),

    // MERCHANT GUILD's while-in-play watcher: every 'buy'-tagged arrival
    // (the buy action and the Black Market both) pays the buyer +1 Coffers
    // per Merchant Guild currently in their In Play.
    {
      id: 'dom_trigger_guilds_merchant_guild',
      name: 'Merchant Guild: a Coin token per buy',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
      condition: null,
      script: [
        iff(gt(countCards(zone(INPLAY, BUYER), kit.nameIs('Merchant Guild')), num(0)), [
          changeVar(COFFERS, countCards(zone(INPLAY, BUYER), kit.nameIs('Merchant Guild')), BUYER),
          announce(BUYER, ' takes a Coin token from the Merchant Guild.'),
        ]),
      ],
    },

    // BAKER's printed setup, as a one-shot first-turn trigger (see the
    // register): fires once, and only when the Baker pile is actually in
    // the active supply.
    {
      id: 'dom_trigger_guilds_baker_setup',
      name: 'Baker: each player starts with a Coin token',
      event: { kind: 'turnStart' },
      condition: null,
      script: [
        iff(allOf(
          eq(getVar(BAKER_SETUP_VAR), num(0)),
          gt(countCards(zone(SUPPLY), kit.nameIs('Baker')), num(0)),
        ), [
          setVar(BAKER_SETUP_VAR, num(1)),
          announce('Baker: each player takes a Coin token.'),
          forEachPlayer([changeVar(COFFERS, num(1), PLAYER)]),
        ]),
      ],
    },
  ];
}

export const guilds1e: ExpansionModule = {
  id: 'guilds1e',
  setName: 'Guilds',

  piles: [
    { name: 'Candlestick Maker', cost: 2, count: 10 },
    { name: 'Stonemason', cost: 2, count: 10 },
    { name: 'Doctor', cost: 3, count: 10 },
    { name: 'Masterpiece', cost: 3, count: 10 },
    { name: 'Advisor', cost: 4, count: 10 },
    { name: 'Herald', cost: 4, count: 10 },
    { name: 'Plaza', cost: 4, count: 10 },
    { name: 'Taxman', cost: 4, count: 10 },
    { name: 'Baker', cost: 5, count: 10 },
    { name: 'Butcher', cost: 5, count: 10 },
    { name: 'Journeyman', cost: 5, count: 10 },
    { name: 'Merchant Guild', cost: 5, count: 10 },
    { name: 'Soothsayer', cost: 5, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Taxman', 'Soothsayer'],
  treasureNames: ['Masterpiece'],

  variables: [
    {
      id: GUILDS_NAMED_VAR, name: 'Guilds: named card',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: GUILDS_OVERPAY_VAR, name: 'Stonemason: overpaid amount',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: TAXMAN_CAP_VAR, name: 'Taxman: gain cap',
      scope: 'perPlayer', type: 'number', initial: -1, hidden: true,
    },
    {
      id: BAKER_SETUP_VAR, name: 'Baker: setup done',
      scope: 'global', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  buildCards,
  buildTriggers,
};
