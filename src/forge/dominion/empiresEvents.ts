/**
 * Empires — the 13 Events (landscape sideboard, kind 'event'): Advance,
 * Annex, Banquet, Conquest, Delve, Dominate, Donate, Ritual, Salt the Earth,
 * Tax, Triumph, Wedding, Windfall.
 *
 * An Event's effect is its onPlay ability: the core 'dom_action_buy_event'
 * pays the printed COIN cost, spends a buy and fires the ability IN PLACE —
 * the card never leaves the sideboard, so every Event is rebuyable (Delve is
 * built around that). The buyer is the CURRENT player (the ability's $owner
 * falls back to the current player for a shared-zone card), so scripts below
 * speak CURRENT-relative zones/vars throughout. DEBT-cost events take their
 * debt via changeVar(DEBT) FIRST in the effect: the buy itself only checks
 * coins, and while anyone owes debt the core refuses them every purchase
 * (cards AND events) until 'dom_action_pay_debt' clears it.
 *
 * "This turn" gain counters (Conquest / Triumph): the engine drains
 * enter-zone triggers only AFTER the running script finishes, so an Event
 * reading a trigger-fed counter would miss its OWN gains. The scripts
 * therefore count their own gains inline and add the per-turn counter that
 * the 'gain'/'buy' watchers maintain for everything gained earlier in the
 * turn; the watchers then catch up after the script, keeping the counter
 * right for a second buy of the same Event. Counters reset at every cleanup.
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - DONATE (prominent): printed, the trash party happens AFTER the turn.
 *    Here it resolves IMMEDIATELY when bought: deck + discard + hand merge
 *    into the hand, trash any number, the remainder shuffles into the deck
 *    and 5 cards are drawn. Buy it late in your buy phase — unplayed hand
 *    cards join the shuffle.
 *  - TAX (prominent): the printed per-pile debt-token machinery (setup: 1
 *    debt on every pile; tokens accumulate) is inexpressible — there is no
 *    per-pile counter surface. Closest honest shape: Tax marks ONE supply
 *    pile (a global pile-name variable); the NEXT player to buy from that
 *    pile takes 2 debt and the mark clears. No setup debt, no stacking —
 *    buying Tax again just re-aims the mark.
 *  - ANNEX: near-exact. "Shuffle all but up to 5 cards from your discard
 *    into your deck" is staged through the hidden LOOK zone: pick up to 5 to
 *    leave out, the rest shuffles in, the kept cards return to the discard.
 *  - CONQUEST / TRIUMPH: exact totals; the counters count 'gain' and 'buy'
 *    moves only while the Event is on the table (an unpicked landscape
 *    tracks nothing), so silvers/cards gained BEFORE it joins mid-... (it
 *    joins at setup — in practice the count is turn-complete).
 *  - Events are never Bridge-discounted (core rule: the DISCOUNT applies to
 *    card costs); gains INSIDE events are Bridge-aware via the house filter
 *    idiom (cost <= limit + DISCOUNT), matching every other gainer.
 */
import type {
  Block, CardDef, Expr, TriggerDef, VariableDef,
} from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, bestCard, bnd, changeVar, chooseCard, chooseCardsBlock,
  countCards, eq, field, getVar, gt, iff, lte, move, neq, not, num, setVar, shuffle, specific,
  str, zone, zoneCount, forEachPlayer,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Advance: 'dom_card_advance',
  Annex: 'dom_card_annex',
  Banquet: 'dom_card_banquet',
  Conquest: 'dom_card_conquest',
  Delve: 'dom_card_delve',
  Dominate: 'dom_card_dominate',
  Donate: 'dom_card_donate',
  Ritual: 'dom_card_ritual',
  'Salt the Earth': 'dom_card_salt_the_earth',
  Tax: 'dom_card_tax',
  Triumph: 'dom_card_triumph',
  Wedding: 'dom_card_wedding',
  Windfall: 'dom_card_windfall',
};

/** The landscape sideboard (stable dominionGame.ts literal). */
const LANDSCAPES = 'dom_zone_landscapes';

/** Silvers gained this turn, per player (Conquest) — reset at cleanup. */
export const CONQUEST_SILVERS = 'dom_var_conquest_silvers';
/** Cards gained this turn, per player (Triumph) — reset at cleanup. */
export const TRIUMPH_GAINS = 'dom_var_triumph_gains';
/** The pile Tax marked (global card NAME; '' = no tax outstanding). */
export const TAX_PILE = 'dom_var_tax_pile';

/** Is this Event on the table? (Unpicked landscapes must do nothing.) */
const onTable = (kit: CardKit, name: string): Expr =>
  gt(countCards(zone(LANDSCAPES), kit.nameIs(name)), num(0));

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, LOOK } = kit.zones;
  const { BUYS, SCRATCH, DISCOUNT, VP_TOKENS, DEBT } = kit.vars;
  const { COST } = kit.fields;
  const { CARD, CHOICE } = kit;

  const supplyHas = (name: string): Expr =>
    gt(countCards(zone(SUPPLY), kit.nameIs(name)), num(0));
  /** Top copy of a named supply pile → the current player's discard, tagged 'gain'. */
  const gainTop = (name: string): Block =>
    kit.tmove(
      specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs(name))),
      zone(SUPPLY), zone(DISCARD, CURRENT), 'gain', { faceUp: true },
    );
  /** Bridge-aware "an Action costing up to $6" (Advance) — fresh nodes per call. */
  const actionUpTo6 = (): Expr =>
    allOf(kit.IS_ACTION_CARD, lte(field(CARD, COST), add(num(6), getVar(DISCOUNT))));
  /** Bridge-aware "a non-Victory card costing up to $5" (Banquet). */
  const banquetable = (): Expr => allOf(
    not(kit.isA(CARD, kit.types.VICTORY)),
    lte(field(CARD, COST), add(num(5), getVar(DISCOUNT))),
  );

  return [
    // ADVANCE ($0) — exact: "You may trash an Action card from your hand.
    // If you do, gain an Action card costing up to $6."
    kit.cardDef(IDS.Advance, 'Advance', 0, 0, 0,
      'Event. You may trash an Action card from your hand. If you do, gain an Action card costing up to $6.', [
        kit.onPlay('dom_ab_advance', 'Advance', [
          iff(gt(countCards(zone(HAND, CURRENT), kit.IS_ACTION_CARD), num(0)), [
            chooseCardsBlock({
              who: CURRENT, from: zone(HAND, CURRENT), filter: kit.IS_ACTION_CARD,
              min: num(0), max: num(1),
              prompt: 'Advance: you may trash an Action to gain an Action costing up to $6',
              body: [
                announce(CURRENT, ' trashes ', CARD, ' to Advance.'),
                kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(TRASH), 'trash', { faceUp: true }),
                iff(gt(countCards(zone(SUPPLY), actionUpTo6()), num(0)), [
                  kit.choosePileBlock({
                    who: CURRENT, from: zone(SUPPLY), filter: actionUpTo6(),
                    prompt: 'Advance: gain an Action card costing up to $6',
                    body: [
                      announce(CURRENT, ' gains ', CARD, '.'),
                      kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, CURRENT), 'gain', { faceUp: true }),
                    ],
                  }),
                ], [announce('No Action in the supply costs $6 or less.')]),
              ],
            }),
          ], [announce(CURRENT, ' has no Action card to advance.')]),
        ]),
      ]),

    // ANNEX ($0 + 8 Debt) — near-exact (LOOK staging, header register): take
    // the debt, leave up to 5 discard cards out, shuffle the rest into the
    // deck, gain a Duchy.
    kit.cardDef(IDS.Annex, 'Annex', 0, 0, 0,
      'Event (8 Debt). Look through your discard pile. Shuffle all but up to 5 cards from it into your deck. Gain a Duchy.', [
        kit.onPlay('dom_ab_annex', 'Annex', [
          changeVar(DEBT, num(8), CURRENT),
          announce(CURRENT, ' takes 8 debt for Annex.'),
          iff(gt(zoneCount(zone(DISCARD, CURRENT)), num(0)), [
            chooseCardsBlock({
              who: CURRENT, from: zone(DISCARD, CURRENT), min: num(0), max: num(5),
              revealed: true,
              prompt: 'Annex: leave up to 5 cards out of the shuffle',
              body: [
                move(specific(CARD), zone(DISCARD, CURRENT), zone(LOOK), { faceUp: false }),
              ],
            }),
            move(ALL, zone(DISCARD, CURRENT), zone(DECK, CURRENT), { faceUp: false }),
            shuffle(zone(DECK, CURRENT)),
            move(ALL, zone(LOOK), zone(DISCARD, CURRENT), { faceUp: true }),
          ]),
          iff(supplyHas('Duchy'), [
            announce(CURRENT, ' gains a Duchy.'),
            gainTop('Duchy'),
          ], [announce('No Duchy left to annex.')]),
        ]),
      ]),

    // BANQUET ($3) — exact: gain 2 Coppers and a non-Victory card up to $5.
    kit.cardDef(IDS.Banquet, 'Banquet', 3, 0, 0,
      'Event. Gain 2 Coppers and a non-Victory card costing up to $5.', [
        kit.onPlay('dom_ab_banquet', 'Banquet', [
          ...Array.from({ length: 2 }, () => iff(supplyHas('Copper'), [
            announce(CURRENT, ' gains a Copper.'),
            gainTop('Copper'),
          ])),
          iff(gt(countCards(zone(SUPPLY), banquetable()), num(0)), [
            kit.choosePileBlock({
              who: CURRENT, from: zone(SUPPLY), filter: banquetable(),
              prompt: 'Banquet: gain a non-Victory card costing up to $5',
              body: [
                announce(CURRENT, ' gains ', CARD, ' at the Banquet.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, CURRENT), 'gain', { faceUp: true }),
              ],
            }),
          ], [announce('Nothing non-Victory in the supply costs $5 or less.')]),
        ]),
      ]),

    // CONQUEST ($6) — exact: gain 2 Silvers, +1 VP per Silver gained this
    // turn (the two just gained count inline; earlier silvers ride the
    // per-turn watcher — header note on trigger timing).
    kit.cardDef(IDS.Conquest, 'Conquest', 6, 0, 0,
      "Event. Gain 2 Silvers. +1 VP per Silver you've gained this turn.", [
        kit.onPlay('dom_ab_conquest', 'Conquest', [
          setVar(SCRATCH, num(0), CURRENT),
          ...Array.from({ length: 2 }, () => iff(supplyHas('Silver'), [
            announce(CURRENT, ' gains a Silver.'),
            gainTop('Silver'),
            changeVar(SCRATCH, num(1), CURRENT),
          ])),
          changeVar(VP_TOKENS,
            add(getVar(CONQUEST_SILVERS, CURRENT), getVar(SCRATCH, CURRENT)), CURRENT),
          announce(CURRENT, ' banks 1 VP per Silver gained this turn.'),
        ]),
      ]),

    // DELVE ($2) — exact: +1 Buy, gain a Silver. The +1 Buy replaces the buy
    // the Event spent, so Delve chains as long as the coins last.
    kit.cardDef(IDS.Delve, 'Delve', 2, 0, 0,
      'Event. +1 Buy. Gain a Silver.', [
        kit.onPlay('dom_ab_delve', 'Delve', [
          changeVar(BUYS, num(1), CURRENT),
          iff(supplyHas('Silver'), [
            announce(CURRENT, ' delves up a Silver.'),
            gainTop('Silver'),
          ], [announce('No Silver left to delve for.')]),
        ]),
      ]),

    // DOMINATE ($14) — exact: gain a Province; if you did, +9 VP tokens.
    kit.cardDef(IDS.Dominate, 'Dominate', 14, 0, 0,
      'Event. Gain a Province. If you did, +9 VP.', [
        kit.onPlay('dom_ab_dominate', 'Dominate', [
          iff(supplyHas('Province'), [
            announce(CURRENT, ' gains a Province and banks 9 VP.'),
            gainTop('Province'),
            changeVar(VP_TOKENS, num(9), CURRENT),
          ], [announce('No Province left — Dominate does nothing.')]),
        ]),
      ]),

    // DONATE ($0 + 8 Debt) — PROMINENT DEVIATION (header register): resolves
    // immediately instead of after the turn. Deck + discard join the hand,
    // trash any number, the rest shuffles into the deck, draw 5.
    kit.cardDef(IDS.Donate, 'Donate', 0, 0, 0,
      'Event (8 Debt). Put your deck and discard pile into your hand, trash any number of cards, shuffle the rest into your deck, then draw 5 cards.', [
        kit.onPlay('dom_ab_donate', 'Donate', [
          changeVar(DEBT, num(8), CURRENT),
          announce(CURRENT, ' takes 8 debt for Donate.'),
          move(ALL, zone(DECK, CURRENT), zone(HAND, CURRENT), { faceUp: true }),
          move(ALL, zone(DISCARD, CURRENT), zone(HAND, CURRENT), { faceUp: true }),
          iff(gt(zoneCount(zone(HAND, CURRENT)), num(0)), [
            chooseCardsBlock({
              who: CURRENT, from: zone(HAND, CURRENT),
              min: num(0), max: zoneCount(zone(HAND, CURRENT)),
              prompt: 'Donate: trash any number of cards',
              body: [
                announce(CURRENT, ' donates ', CARD, ' to the trash.'),
                kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(TRASH), 'trash', { faceUp: true }),
              ],
            }),
            move(ALL, zone(HAND, CURRENT), zone(DECK, CURRENT), { faceUp: false }),
            shuffle(zone(DECK, CURRENT)),
            kit.draw(null, 5),
          ]),
        ]),
      ]),

    // RITUAL ($4) — exact: gain a Curse; if you did, trash a hand card for
    // +1 VP per $1 it cost (printed cost — SCRATCH holds it across the move).
    kit.cardDef(IDS.Ritual, 'Ritual', 4, 0, 0,
      'Event. Gain a Curse. If you do, trash a card from your hand. +1 VP per $1 it cost.', [
        kit.onPlay('dom_ab_ritual', 'Ritual', [
          iff(supplyHas('Curse'), [
            announce(CURRENT, ' gains a Curse.'),
            gainTop('Curse'),
            iff(gt(zoneCount(zone(HAND, CURRENT)), num(0)), [
              chooseCard({
                who: CURRENT, from: zone(HAND, CURRENT),
                prompt: 'Ritual: trash a card from your hand (+1 VP per $1 it costs)',
              }),
              setVar(SCRATCH, field(CHOICE, COST), CURRENT),
              announce(CURRENT, ' sacrifices ', CHOICE, ' in the Ritual.'),
              kit.tmove(specific(CHOICE), zone(HAND, CURRENT), zone(TRASH), 'trash', { faceUp: true }),
              changeVar(VP_TOKENS, getVar(SCRATCH, CURRENT), CURRENT),
            ], [announce(CURRENT, ' has no card to sacrifice.')]),
          ], [announce('No Curse left — the Ritual fizzles.')]),
        ]),
      ]),

    // SALT THE EARTH ($4) — exact: +1 VP token, trash a Victory card from
    // the supply.
    kit.cardDef(IDS['Salt the Earth'], 'Salt the Earth', 4, 0, 0,
      'Event. +1 VP. Trash a Victory card from the Supply.', [
        kit.onPlay('dom_ab_salt_the_earth', 'Salt the Earth', [
          changeVar(VP_TOKENS, num(1), CURRENT),
          iff(gt(countCards(zone(SUPPLY), kit.isA(CARD, kit.types.VICTORY)), num(0)), [
            kit.choosePileBlock({
              who: CURRENT, from: zone(SUPPLY), filter: kit.isA(CARD, kit.types.VICTORY),
              prompt: 'Salt the Earth: trash a Victory card from the supply',
              body: [
                announce(CURRENT, ' salts the earth — ', CARD, ' is trashed from the supply.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(TRASH), 'trash', { faceUp: true }),
              ],
            }),
          ], [announce('No Victory card left in the supply to salt.')]),
        ]),
      ]),

    // TAX ($2) — PROMINENT DEVIATION (header register): marks ONE pile; the
    // next buy from it takes 2 debt (the buildTriggers watcher), then the
    // mark clears. No setup debt, no stacking.
    kit.cardDef(IDS.Tax, 'Tax', 2, 0, 0,
      'Event. Choose a Supply pile: the next player to buy a card from it takes 2 Debt.', [
        kit.onPlay('dom_ab_tax', 'Tax', [
          iff(gt(countCards(zone(SUPPLY)), num(0)), [
            kit.choosePileBlock({
              who: CURRENT, from: zone(SUPPLY),
              prompt: 'Tax: choose a pile — the next player to buy from it takes 2 debt',
              body: [
                setVar(TAX_PILE, field(CARD, 'name')),
                announce(CURRENT, ' taxes the ', CARD, ' pile — the next buy from it takes 2 debt.'),
              ],
            }),
          ], [announce('The supply is empty — nothing to tax.')]),
        ]),
      ]),

    // TRIUMPH ($0 + 5 Debt) — exact: gain an Estate; if you did, +1 VP per
    // card gained this turn (the Estate counts inline — header note).
    kit.cardDef(IDS.Triumph, 'Triumph', 0, 0, 0,
      "Event (5 Debt). Gain an Estate. If you did, +1 VP per card you've gained this turn.", [
        kit.onPlay('dom_ab_triumph', 'Triumph', [
          changeVar(DEBT, num(5), CURRENT),
          announce(CURRENT, ' takes 5 debt for Triumph.'),
          iff(supplyHas('Estate'), [
            announce(CURRENT, ' gains an Estate in triumph.'),
            gainTop('Estate'),
            changeVar(VP_TOKENS, add(getVar(TRIUMPH_GAINS, CURRENT), num(1)), CURRENT),
            announce(CURRENT, ' banks 1 VP per card gained this turn.'),
          ], [announce('No Estate left — no triumph today.')]),
        ]),
      ]),

    // WEDDING ($4 + 3 Debt) — exact: +1 VP token, gain a Gold.
    kit.cardDef(IDS.Wedding, 'Wedding', 4, 0, 0,
      'Event (4 Coins + 3 Debt). +1 VP. Gain a Gold.', [
        kit.onPlay('dom_ab_wedding', 'Wedding', [
          changeVar(DEBT, num(3), CURRENT),
          changeVar(VP_TOKENS, num(1), CURRENT),
          announce(CURRENT, ' takes 3 debt and banks 1 VP for the Wedding.'),
          iff(supplyHas('Gold'), [
            announce(CURRENT, ' gains a Gold.'),
            gainTop('Gold'),
          ], [announce('No Gold left for the dowry.')]),
        ]),
      ]),

    // WINDFALL ($5) — exact: if deck AND discard are empty, gain 3 Golds.
    kit.cardDef(IDS.Windfall, 'Windfall', 5, 0, 0,
      'Event. If your deck and discard pile are empty, gain 3 Golds.', [
        kit.onPlay('dom_ab_windfall', 'Windfall', [
          iff(allOf(
            eq(zoneCount(zone(DECK, CURRENT)), num(0)),
            eq(zoneCount(zone(DISCARD, CURRENT)), num(0)),
          ), [
            ...Array.from({ length: 3 }, () => iff(supplyHas('Gold'), [
              announce(CURRENT, ' gains a Gold.'),
              gainTop('Gold'),
            ])),
          ], [announce(CURRENT, "'s deck or discard is not empty — no windfall.")]),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** CONQUEST's per-turn Silver count — only while Conquest is on the table. */
  const conquestWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_conquest_${tag}`,
    name: `Conquest: a Silver is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(onTable(kit, 'Conquest'), kit.nameIs('Silver')), [
        changeVar(CONQUEST_SILVERS, num(1), GAINER),
      ]),
    ],
  });

  /** TRIUMPH's per-turn gain count — only while Triumph is on the table. */
  const triumphWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_triumph_${tag}`,
    name: `Triumph: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(onTable(kit, 'Triumph'), [
        changeVar(TRIUMPH_GAINS, num(1), GAINER),
      ]),
    ],
  });

  /** TAX's collector: the marked pile is bought from — the buyer takes the
   *  2 debt and the mark clears (deviation register in the header). */
  const taxWatch = (): TriggerDef => ({
    id: 'dom_trigger_tax_buy',
    name: 'Tax: the taxed pile is bought from',
    event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
    condition: null,
    script: [
      iff(allOf(
        onTable(kit, 'Tax'),
        neq(getVar(TAX_PILE), str('')),
        eq(field(kit.CARD, 'name'), getVar(TAX_PILE)),
      ), [
        changeVar(kit.vars.DEBT, num(2), GAINER),
        announce(GAINER, ' takes the 2 debt tax on the ', kit.CARD, ' pile.'),
        setVar(TAX_PILE, str('')),
      ]),
    ],
  });

  return [
    conquestWatch('gain'),
    conquestWatch('buy'),
    triumphWatch('gain'),
    triumphWatch('buy'),
    taxWatch(),
  ];
}

export const empiresEvents: ExpansionModule = {
  id: 'empiresEvents',
  setName: 'Empires',

  piles: [],

  ids: IDS,

  landscapes: [
    { name: 'Advance', cost: 0, kind: 'event' },
    { name: 'Annex', cost: 0, kind: 'event' },
    { name: 'Banquet', cost: 3, kind: 'event' },
    { name: 'Conquest', cost: 6, kind: 'event' },
    { name: 'Delve', cost: 2, kind: 'event' },
    { name: 'Dominate', cost: 14, kind: 'event' },
    { name: 'Donate', cost: 0, kind: 'event' },
    { name: 'Ritual', cost: 4, kind: 'event' },
    { name: 'Salt the Earth', cost: 4, kind: 'event' },
    { name: 'Tax', cost: 2, kind: 'event' },
    { name: 'Triumph', cost: 0, kind: 'event' },
    { name: 'Wedding', cost: 4, kind: 'event' },
    { name: 'Windfall', cost: 5, kind: 'event' },
  ],

  variables: [
    {
      id: CONQUEST_SILVERS, name: 'Conquest: Silvers gained this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: TRIUMPH_GAINS, name: 'Triumph: cards gained this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: TAX_PILE, name: 'Tax: the marked pile',
      scope: 'global', type: 'string', initial: '', hidden: true,
    },
  ] as VariableDef[],

  buildCards,
  buildTriggers,

  buildCleanupResets(kit): Block[] {
    return [forEachPlayer([
      setVar(CONQUEST_SILVERS, num(0), kit.PLAYER),
      setVar(TRIUMPH_GAINS, num(0), kit.PLAYER),
    ])];
  },
};
