/**
 * Seaside 2E (part B) — Sea Chart, Lookout, Monkey, Smugglers, Blockade,
 * Cutpurse, Corsair, Pirate, Sea Witch.
 *
 * House idioms follow the Base/Intrigue modules: attack halves are separate
 * `stacked: true` abilities gated per victim on IMMUNE == 0 (the shared
 * effectResolved trigger resets it), look-at effects stage through the hidden
 * shared LOOK zone with `revealed` choices, every mandatory choice is guarded
 * so a session can never hang, and Duration cards ride kit.durationPair (now
 * runs on play, the card parks in the DURATION zone, later fires at the
 * owner's next action-phase start and the card marches back to In Play where
 * that turn's cleanup discards it).
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "the player to your
 * left/right" IS the one opponent everywhere below (forEachOpponent /
 * nextPlayer(OWNER)).
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - DURATION RE-ENTRY GUARD (all five Duration cards): the later half's
 *    march back to In Play is a real 'play'-tagged move, and unguarded
 *    enterZone(In Play) abilities would re-fire on it — the now half would
 *    re-park the card forever and attack halves would strike every turn. So
 *    every on-play ability of a Duration card here carries the condition
 *    $fromZone != DURATION. Throne Room's synthetic replay reports
 *    $fromZone = In Play, so a Throne-Roomed Duration still repeats `now`
 *    (and parks only once; `later` fires once — the kit's documented
 *    contract).
 *  - No Duration TAG exists in the def's type vocabulary (see the MOAT
 *    DECISION note in dominionGame.ts) — these cards' type lines read
 *    "Action" / "Action – Attack"; Duration-ness is purely behavioral.
 *  - Duration later-halves resolve inline at the owner's action-phase start
 *    with NO response window, so Moat cannot react to Blockade's Curse.
 *  - CUTPURSE: "reveals their hand" is an announcement (Shanty Town's
 *    idiom — no persistent reveal primitive); the discarded Copper is
 *    auto-picked (all Coppers are identical, so no choice is needed).
 *  - CORSAIR: the printed ongoing watcher ("until then, each other player
 *    trashes the first Silver or Gold they play each turn") is not
 *    expressible; instead, on play the opponent trashes a Silver from their
 *    In Play, else a Gold, else nothing (stacked, Moat-blockable). In a
 *    2-player game the opponent's In Play is usually empty on your turn, so
 *    this attack mostly matters against other Durations / Treasures dealt
 *    into play by effects.
 *  - BLOCKADE (prominent): the printed card sets the gained card aside and
 *    curses players who gain copies of it. Here the set-aside is replaced
 *    wholesale — now: gain a card costing up to 4 ONTO YOUR DECK; later: the
 *    opponent gains a Curse (unconditionally, no copy-watching, and no
 *    response window — see above).
 *  - MONKEY: 2-player reading of "the player to your right" = the opponent.
 *    A module trigger watches BOTH 'gain' and 'buy' cause tags (a bought
 *    card is gained) and gives the owner +1 Card per Monkey parked in their
 *    DURATION zone at that moment.
 *  - PIRATE: the printed reaction half ("when any player gains a Treasure,
 *    you may play this from your hand") is omitted — pure Duration, later
 *    gains a Gold to your hand. Deliberately NOT tagged Reaction.
 *  - SMUGGLERS: the printed "a card costing up to $6 gained on their last
 *    turn" is approximated by a hidden per-player string remembering the
 *    LAST card (one card, not all of them) each player gained ('gain' or
 *    'buy' tagged) whose printed cost was <= 6 AT GAIN TIME. The memory is
 *    never reset, so it can reach back beyond the opponent's most recent
 *    turn. Gains costing > 6 do NOT overwrite a remembered cheaper card
 *    (mirroring the printed cap). Smugglers gains the supply copy by name
 *    and whiffs gracefully when nothing is remembered or the pile is gone.
 *  - SEA CHART: "a copy of it in play" counts the owner's In Play AND
 *    parked DURATION cards (printed Durations stay in play between turns).
 *  - SEA WITCH: the later half's "discard 2" is clamped to the hand size.
 */
import type { AbilityDef, Block, CardDef, Expr, TriggerDef, VariableDef } from '../../shared/types';
import {
  ALL, add, allOf, announce, bestCard, bnd, changeVar, chooseCard, chooseCardsBlock,
  countCards, eq, field, forEachOpponent, forEachPlayer, getVar, gt, iff, lt, lte,
  move, neq, nextPlayer, num, setVar, shuffle, specific, str, topCard, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

/** Per-player memory: the LAST card (name) this player gained costing <= 6. */
export const SMUGGLE_VAR = 'dom_var_smugglers_last';

const IDS: Record<string, string> = {
  'Sea Chart': 'dom_card_sea_chart',
  Lookout: 'dom_card_lookout',
  Monkey: 'dom_card_monkey',
  Smugglers: 'dom_card_smugglers',
  Blockade: 'dom_card_blockade',
  Cutpurse: 'dom_card_cutpurse',
  Corsair: 'dom_card_corsair',
  Pirate: 'dom_card_pirate',
  'Sea Witch': 'dom_card_sea_witch',
};

/**
 * The official empty-deck reshuffle for effects that TAKE cards off the deck
 * without the `draw` block (Lookout / Sea Chart's reveal): when `who`'s deck
 * is empty, flip the discard face-down into it and give it a seeded shuffle.
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
  const { ACTIONS, COINS, IMMUNE, SCRATCH, DISCOUNT } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER } = kit;
  const { nameIs } = kit;

  /**
   * The DURATION RE-ENTRY GUARD (see the header register): true unless this
   * enterZone event is the later half's march back from the DURATION zone.
   */
  const NOT_FROM_DURATION: Expr = neq(bnd('$fromZone'), str(DURATION));

  /** kit.durationPair with the now half gated on the re-entry guard. */
  const durationHalves = (idBase: string, name: string, now: Block[], later: Block[]): AbilityDef[] => {
    const [nowHalf, laterHalf] = kit.durationPair(idBase, name, now, later);
    return [{ ...nowHalf, condition: NOT_FROM_DURATION }, laterHalf];
  };

  /** A stacked on-play attack half that must not re-fire on the march back. */
  const guardedAttack = (id: string, name: string, script: Block[]): AbilityDef =>
    ({ ...kit.onPlay(id, name, script, true), condition: NOT_FROM_DURATION });

  /** Gain the named basic from the supply into `to` (guarded on the pile). */
  const gainNamed = (name: string, to: ReturnType<typeof zone>, who: Expr, note: string, empty: string): Block =>
    iff(gt(countCards(zone(SUPPLY), nameIs(name)), num(0)), [
      announce(who, note),
      kit.tmove(
        specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs(name))),
        zone(SUPPLY), to, 'gain', { faceUp: true },
      ),
    ], [announce(empty)]);

  return [
    // SEA CHART — +1 Card +1 Action; reveal the top card, to hand if a copy
    // is in play. DEVIATION: "in play" counts In Play AND the owner's parked
    // DURATION cards (printed Durations remain in play between turns).
    kit.cardDef(IDS['Sea Chart'], 'Sea Chart', 3, 0, 0,
      '+1 Card. +1 Action. Reveal the top card of your deck. If you have a copy of it in play, put it into your hand.', [
        kit.onPlay('dom_ab_sea_chart', 'X marks the swell', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          refillDeck(kit, OWNER),
          iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
            announce(OWNER, ' reveals ', topCard(zone(DECK, OWNER)), '.'),
            iff(gt(add(
              countCards(zone(INPLAY, OWNER),
                eq(field(CARD, 'name'), field(topCard(zone(DECK, OWNER)), 'name'))),
              countCards(zone(DURATION, OWNER),
                eq(field(CARD, 'name'), field(topCard(zone(DECK, OWNER)), 'name'))),
            ), num(0)), [
              announce('A matching card is in play — the revealed card joins their hand.'),
              kit.draw(OWNER, 1),
            ], [announce('No copy in play; the card stays on the deck.')]),
          ], [announce(OWNER, ' has no cards left to reveal.')]),
        ]),
      ]),

    // LOOKOUT — exact. With fewer than 3 cards left the steps degrade
    // gracefully (trash first, then discard, then topdeck whatever remains),
    // matching the official short-deck ruling.
    kit.cardDef(IDS.Lookout, 'Lookout', 3, 0, 0,
      '+1 Action. Look at the top 3 cards of your deck. Trash one of them. Discard one of them. Put the other one back on top of your deck.', [
        kit.onPlay('dom_ab_lookout', 'Eyes on the horizon', [
          changeVar(ACTIONS, num(1), OWNER),
          ...takeTop(kit, OWNER, zone(LOOK), false),
          ...takeTop(kit, OWNER, zone(LOOK), false),
          ...takeTop(kit, OWNER, zone(LOOK), false),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(LOOK), revealed: true,
              prompt: 'Lookout: trash one of the top 3 cards of your deck',
            }),
            announce(OWNER, ' trashes ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(LOOK), zone(TRASH), 'trash', { faceUp: true }),
          ]),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(LOOK), revealed: true,
              prompt: 'Lookout: discard one of them',
            }),
            announce(OWNER, ' discards ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
          ]),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
          ]),
        ]),
      ]),

    // MONKEY — Duration. later: +1 Card. The gain-watcher lives in
    // buildTriggers: while a Monkey is parked in YOUR DURATION zone, every
    // card the OPPONENT gains (tags 'gain' AND 'buy' — a bought card is
    // gained) draws you 1 per parked Monkey (2p reading of "the player to
    // your right").
    kit.cardDef(IDS.Monkey, 'Monkey', 3, 0, 0,
      'Until your next turn, when the other player gains a card, +1 Card. At the start of your next turn, +1 Card.',
      durationHalves('dom_ab_monkey', 'Monkey', [
        announce(OWNER, '’s Monkey climbs the rigging to watch.'),
      ], [
        kit.draw(OWNER, 1),
      ])),

    // SMUGGLERS — DEVIATION (see the header register): gains the supply copy
    // of the LAST card costing up to 6 that the opponent gained (a hidden
    // per-player string written by the gain/buy triggers below); the memory
    // is one card and never resets. Whiffs gracefully.
    kit.cardDef(IDS.Smugglers, 'Smugglers', 3, 0, 0,
      'Gain a copy of the last card costing up to 6 that the other player gained.', [
        kit.onPlay('dom_ab_smugglers', 'Off the night boat', [
          iff(gt(countCards(zone(SUPPLY),
            eq(field(CARD, 'name'), getVar(SMUGGLE_VAR, nextPlayer(OWNER)))), num(0)), [
            announce(OWNER, ' smuggles a copy of the neighbour’s haul.'),
            kit.tmove(
              specific(bestCard(zone(SUPPLY), 'highest', COST,
                eq(field(CARD, 'name'), getVar(SMUGGLE_VAR, nextPlayer(OWNER))))),
              zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
            ),
          ], [announce('The smugglers have nothing worth copying.')]),
        ]),
      ]),

    // BLOCKADE — Duration – Attack. PROMINENT DEVIATION (header register):
    // the printed set-aside/copy-watcher is replaced — now: gain a card
    // costing up to 4 onto your deck (Bridge-aware cap); later: the opponent
    // gains a Curse (no response window at duration resolution, so Moat
    // cannot block it; no IMMUNE gate — immunity is always spent by then).
    kit.cardDef(IDS.Blockade, 'Blockade', 4, 0, 0,
      'Gain a card costing up to 4 onto your deck. At the start of your next turn, the other player gains a Curse.',
      durationHalves('dom_ab_blockade', 'Blockade', [
        iff(gt(countCards(zone(SUPPLY),
          lte(field(CARD, COST), add(num(4), getVar(DISCOUNT)))), num(0)), [
          kit.choosePileBlock({
            who: OWNER, from: zone(SUPPLY),
            filter: lte(field(CARD, COST), add(num(4), getVar(DISCOUNT))),
            prompt: 'Blockade: gain a card costing up to 4 onto your deck',
            body: [
              announce(OWNER, ' blockades ', CARD, ' — it goes onto their deck.'),
              kit.tmove(specific(CARD), zone(SUPPLY), zone(DECK, OWNER), 'gain',
                { toPosition: 'top', faceUp: true }),
            ],
          }),
        ], [announce('Nothing in the supply is cheap enough to blockade.')]),
      ], [
        forEachOpponent([
          gainNamed('Curse', zone(DISCARD, PLAYER), PLAYER, ' gains a Curse from the blockade.',
            'The Curse pile is empty — the blockade passes quietly.'),
        ]),
      ])),

    // CUTPURSE — Action – Attack. Coins are immediate; only the attack half
    // goes through the stack (Militia's pattern) so Moat owners get their
    // response window. DEVIATION: the "reveal" is an announcement, and the
    // Copper is auto-discarded (all Coppers are identical — no choice).
    kit.cardDef(IDS.Cutpurse, 'Cutpurse', 4, 0, 0,
      '+2 Coins. Each other player discards a Copper (or reveals a hand with no Copper).', [
        kit.onPlay('dom_ab_cutpurse_coins', 'Quick fingers', [
          changeVar(COINS, num(2), OWNER),
        ]),
        kit.onPlay('dom_ab_cutpurse_attack', 'A hand in every pocket', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(gt(countCards(zone(HAND, PLAYER), nameIs('Copper')), num(0)), [
                announce(PLAYER, ' discards a Copper.'),
                kit.tmove(
                  specific(bestCard(zone(HAND, PLAYER), 'highest', COST, nameIs('Copper'))),
                  zone(HAND, PLAYER), zone(DISCARD, PLAYER), 'discard', { faceUp: true },
                ),
              ], [announce(PLAYER, ' reveals a hand with no Copper.')]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // CORSAIR — Duration – Attack. DEVIATION (header register): the printed
    // ongoing trash-watcher becomes an on-play strike — the opponent trashes
    // a Silver from their In Play, else a Gold, else nothing (stacked, so
    // Moat can block it).
    kit.cardDef(IDS.Corsair, 'Corsair', 5, 0, 0,
      '+2 Coins. At the start of your next turn, +1 Card. Each other player trashes a Silver from play (a Gold if they have no Silver).', [
        ...durationHalves('dom_ab_corsair', 'Corsair', [
          changeVar(COINS, num(2), OWNER),
        ], [
          kit.draw(OWNER, 1),
        ]),
        guardedAttack('dom_ab_corsair_attack', 'Raiders on the tradewinds', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(gt(countCards(zone(INPLAY, PLAYER), nameIs('Silver')), num(0)), [
                announce(PLAYER, ' trashes a Silver from play.'),
                kit.tmove(
                  specific(bestCard(zone(INPLAY, PLAYER), 'highest', COST, nameIs('Silver'))),
                  zone(INPLAY, PLAYER), zone(TRASH), 'trash', { faceUp: true },
                ),
              ], [
                iff(gt(countCards(zone(INPLAY, PLAYER), nameIs('Gold')), num(0)), [
                  announce(PLAYER, ' trashes a Gold from play.'),
                  kit.tmove(
                    specific(bestCard(zone(INPLAY, PLAYER), 'highest', COST, nameIs('Gold'))),
                    zone(INPLAY, PLAYER), zone(TRASH), 'trash', { faceUp: true },
                  ),
                ], [announce(PLAYER, ' has no Silver or Gold in play.')]),
              ]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ]),
      ]),

    // PIRATE — Duration. DEVIATION (header register): the printed reaction
    // half is omitted — pure duration, later gains a Gold to your hand. Not
    // tagged Reaction (it offers no reveal).
    kit.cardDef(IDS.Pirate, 'Pirate', 5, 0, 0,
      'At the start of your next turn, gain a Gold to your hand.',
      durationHalves('dom_ab_pirate', 'Pirate', [
        announce(OWNER, ' sends the pirates hunting.'),
      ], [
        gainNamed('Gold', zone(HAND, OWNER), OWNER, ' gains a Gold to their hand.',
          'The Gold pile is empty — the pirates return empty-handed.'),
      ])),

    // SEA WITCH — Duration – Attack. The Curse half is a separate stacked
    // ability (Witch's pattern); later draws 2 then discards exactly 2,
    // clamped to the hand (Steward's SCRATCH idiom).
    kit.cardDef(IDS['Sea Witch'], 'Sea Witch', 5, 0, 0,
      '+2 Cards. Each other player gains a Curse. At the start of your next turn, +2 Cards, then discard 2 cards.', [
        ...durationHalves('dom_ab_sea_witch', 'Sea Witch', [
          kit.draw(OWNER, 2),
        ], [
          kit.draw(OWNER, 2),
          setVar(SCRATCH, num(2), OWNER),
          iff(lt(zoneCount(zone(HAND, OWNER)), num(2)), [
            setVar(SCRATCH, zoneCount(zone(HAND, OWNER)), OWNER),
          ]),
          iff(gt(getVar(SCRATCH, OWNER), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER),
              min: getVar(SCRATCH, OWNER), max: num(2),
              prompt: 'Sea Witch: discard 2 cards',
              body: [
                announce(OWNER, ' discards ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ],
            }),
          ]),
        ]),
        guardedAttack('dom_ab_sea_witch_attack', 'A curse on the tide', [
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
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { DURATION } = kit.zones;
  const { COST } = kit.fields;
  const { CARD, PLAYER } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** Monkey: the opponent's gain draws the owner 1 per parked Monkey. */
  const monkeyWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_monkey_${tag}`,
    name: `Monkey: the other player ${tag === 'buy' ? 'buys' : 'gains'} a card`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      forEachPlayer([
        iff(allOf(
          neq(PLAYER, GAINER),
          gt(countCards(zone(DURATION, PLAYER), kit.nameIs('Monkey')), num(0)),
        ), [
          announce(PLAYER, '’s Monkey chatters — +1 Card per Monkey.'),
          kit.drawN(PLAYER, countCards(zone(DURATION, PLAYER), kit.nameIs('Monkey'))),
        ]),
      ]),
    ],
  });

  /** Smugglers: remember the gainer's LAST gain with printed cost <= 6. */
  const smuggleWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_smugglers_${tag}`,
    name: `Smugglers: remember the last ${tag === 'buy' ? 'bought' : 'gained'} card`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: lte(field(CARD, COST), num(6)),
    script: [setVar(SMUGGLE_VAR, field(CARD, 'name'), GAINER)],
  });

  return [
    monkeyWatch('gain'),
    monkeyWatch('buy'),
    smuggleWatch('gain'),
    smuggleWatch('buy'),
  ];
}

export const seaside2eB: ExpansionModule = {
  id: 'seaside2eB',
  setName: 'Seaside',

  piles: [
    { name: 'Sea Chart', cost: 3, count: 10 },
    { name: 'Lookout', cost: 3, count: 10 },
    { name: 'Monkey', cost: 3, count: 10 },
    { name: 'Smugglers', cost: 3, count: 10 },
    { name: 'Blockade', cost: 4, count: 10 },
    { name: 'Cutpurse', cost: 4, count: 10 },
    { name: 'Corsair', cost: 5, count: 10 },
    { name: 'Pirate', cost: 5, count: 10 },
    { name: 'Sea Witch', cost: 5, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Blockade', 'Cutpurse', 'Corsair', 'Sea Witch'],

  variables: [
    {
      id: SMUGGLE_VAR, name: 'Smugglers: last cheap gain',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
  ] as VariableDef[],

  buildCards,
  buildTriggers,
};
