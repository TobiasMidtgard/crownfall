/**
 * Seaside 2E (part A) — Haven, Lighthouse, Astrolabe, Fishing Village,
 * Warehouse, Caravan, Bazaar, Merchant Ship, Wharf.
 *
 * The set's first Duration cards. Deviations from the paper rules:
 *
 * - DURATION PLUMBING (engine): this module ships its OWN duration pair
 *   builder (seaDurationPair) instead of kit.durationPair. The kit helper's
 *   now-half listens on enterZone(In Play) with NO tagFilter while its
 *   later-half marches the card back into In Play with the tag 'play' — that
 *   march re-fires the now-half (bonuses granted twice, the card re-parks in
 *   the DURATION zone, and the cycle repeats every turn; see
 *   seaside2eA.test.ts for the multi-turn probes that pin the CORRECT
 *   behavior). The local pair fixes both ends: the now-half carries
 *   tagFilter 'play' (every genuine play — the play/treasure actions,
 *   Vassal, and Throne Room's synthetic replay — is tagged 'play'), and the
 *   march back is tagged 'duration_return' so nothing counts it as a play
 *   (Conspirator-style played-an-action triggers correctly ignore it, as on
 *   paper). Integrator: kit.durationPair wants the same two-line fix.
 * - DURATION TIMING: "at the start of your next turn" fires at the owner's
 *   next ACTION-PHASE start. Coins/buys granted there persist into the buy
 *   phase (counters only reset at cleanup), so Merchant Ship / Wharf /
 *   Astrolabe pay out as printed.
 * - HAVEN: the set-aside card is tracked with a hidden perCard variable
 *   (dom_var_haven_aside) set when Haven parks it and cleared when it
 *   returns — the later-half retrieves exactly what Haven set aside (even a
 *   Duration card set aside as a plain card), rather than "any non-Duration
 *   card in the zone". A single candidate auto-resolves without a prompt;
 *   with several Havens' cards waiting, the owner picks one per Haven. Every
 *   later-half in THIS module is additionally gated on the card not wearing
 *   the Haven mark, so a Haven-set-aside Duration card can never misfire its
 *   own next-turn half from the DURATION zone (sibling modules built on
 *   kit.durationPair do not carry that guard).
 * - LIGHTHOUSE: paper immunity is automatic; here it is the Moat pattern —
 *   a response-speed action ('dom_action_lighthouse') legal while an Attack
 *   is pending, you are not the attacker, YOUR Lighthouse sits in the
 *   DURATION zone, and you are not already immune. It sets IMMUNE, so the
 *   attack is waved off from the set-aside strip; the shared effectResolved
 *   trigger clears the flag per attack, and the action is legal again for
 *   the next one. The player must actively use it, like revealing a Moat.
 *   Lighthouse does NOT wear the Reaction tag (its type line stays plain
 *   Action, as printed) — the response action alone opens the window.
 * - ASTROLABE: primary type Treasure (treasureNames). Its on-play +$1 rides
 *   the standard treasure action, which pays the card's coin FIELD
 *   (dom_field_coins = 1) before moving it — the now-half therefore grants
 *   only the +1 Buy, then parks the card. The engine has no "play all
 *   treasures" macro action; any such UI affordance drives
 *   dom_action_treasure per card, whose move is tagged 'play' and fires
 *   enterZone abilities (probed). Throne Room cannot replay it (Actions
 *   only), matching paper.
 * - 2-PLAYER TABLE: nothing here reads seating; "another player" in
 *   Lighthouse's rule is the one opponent, which the attacker-excluding
 *   legality already expresses exactly.
 */
import type { AbilityDef, ActionDef, Block, CardDef } from '../../shared/types';
import {
  CURRENT, STACK_SIZE, STACK_TOP, allOf, announce, bnd, changeVar, chooseCardsBlock, countCards,
  eq, forEachCard, getVar, gt, iff, lt, neq, num, setVar, specific, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Haven: 'dom_card_haven',
  Caravan: 'dom_card_caravan',
  'Fishing Village': 'dom_card_fishing_village',
  Lighthouse: 'dom_card_lighthouse',
  'Merchant Ship': 'dom_card_merchant_ship',
  Wharf: 'dom_card_wharf',
  Astrolabe: 'dom_card_astrolabe',
  Bazaar: 'dom_card_bazaar',
  Warehouse: 'dom_card_warehouse',
};

/**
 * Haven's set-aside marker: 1 while Haven holds the card in the DURATION
 * zone, 0 otherwise. perCard — the filter reads each candidate, and parked
 * Duration cards never wear it.
 */
export const HAVEN_MARK = 'dom_var_haven_aside';

/** The action phase's id (the kit keeps phase ids private; this dom_* id is stable). */
const PHASE_ACTION = 'dom_phase_action';

/**
 * The Duration two-step, kit.durationPair's contract with the re-fire fix
 * (see the header): `now` runs when the card is PLAYED (tagFilter 'play'),
 * then the card parks in the DURATION zone so cleanup leaves it out; `later`
 * fires at the owner's next action-phase start and marches the card back to
 * In Play — tagged 'duration_return', which the now-half's tagFilter ignores
 * — where that turn's cleanup discards it normally. A Throne-Roomed replay
 * (synthetic enterZone, tag 'play') repeats `now`, but the park move whiffs
 * (the card already left In Play), so `later` fires exactly once. The
 * later-half is gated on the Haven mark so a Haven-set-aside copy stays
 * inert (it was never played).
 */
function seaDurationPair(
  kit: CardKit, idBase: string, name: string, now: Block[], later: Block[],
): AbilityDef[] {
  const { INPLAY, DURATION } = kit.zones;
  const { OWNER, SELF } = kit;
  return [
    {
      id: `${idBase}_now`, name: `${name} — now`,
      on: 'enterZone', zoneId: INPLAY, phaseId: null, tagFilter: 'play', condition: null,
      script: [
        ...now,
        kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(DURATION, OWNER), 'play', { faceUp: true }),
      ],
    },
    {
      id: `${idBase}_later`, name: `${name} — next turn`,
      on: 'phaseStart', zoneId: DURATION, phaseId: PHASE_ACTION,
      condition: allOf(eq(CURRENT, OWNER), eq(getVar(HAVEN_MARK, SELF), num(0))),
      script: [
        announce(OWNER, "'s ", SELF, ' resolves.'),
        ...later,
        kit.tmove(specific(SELF), zone(DURATION, OWNER), zone(INPLAY, OWNER), 'duration_return', { faceUp: true }),
      ],
    },
  ];
}

function buildCards(kit: CardKit): CardDef[] {
  const { HAND, DISCARD, DURATION } = kit.zones;
  const { ACTIONS, BUYS, COINS, SCRATCH } = kit.vars;
  const { OWNER, CARD } = kit;

  /** "This candidate is a card Haven set aside" ($card rebinds per candidate). */
  const MARKED = eq(getVar(HAVEN_MARK, CARD), num(1));

  /** Haven's retrieval body ($card = the set-aside card). */
  const havenTakeBack: Block[] = [
    setVar(HAVEN_MARK, num(0), CARD),
    announce(OWNER, ' takes the card Haven set aside into their hand.'),
    kit.tmove(specific(CARD), zone(DURATION, OWNER), zone(HAND, OWNER), 'set_aside_return', { faceUp: true }),
  ];

  return [
    kit.cardDef(IDS.Haven, 'Haven', 2, 0, 0,
      '+1 Card. +1 Action. Set aside a card from your hand face down. At the start of your next turn, put it into your hand.',
      seaDurationPair(kit, 'dom_ab_haven', 'Haven', [
        kit.draw(OWNER, 1),
        changeVar(ACTIONS, num(1), OWNER),
        // Guarded: an exhausted deck+discard can leave the hand empty and the
        // mandatory set-aside must not hang on nothing.
        iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
          chooseCardsBlock({
            who: OWNER, from: zone(HAND, OWNER), min: num(1), max: num(1),
            prompt: 'Haven: set aside a card from your hand',
            body: [
              setVar(HAVEN_MARK, num(1), CARD),
              announce(OWNER, ' sets a card aside with Haven.'),
              kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DURATION, OWNER), 'set_aside', { faceUp: false }),
            ],
          }),
        ]),
      ], [
        iff(gt(countCards(zone(DURATION, OWNER), MARKED), num(0)), [
          // The single candidate auto-resolves — no prompt (the common case:
          // one Haven, one set-aside card). Several waiting cards (multiple
          // Havens) prompt a pick per resolving Haven.
          iff(eq(countCards(zone(DURATION, OWNER), MARKED), num(1)), [
            forEachCard(zone(DURATION, OWNER), MARKED, havenTakeBack),
          ], [
            chooseCardsBlock({
              who: OWNER, from: zone(DURATION, OWNER), filter: MARKED,
              min: num(1), max: num(1), revealed: true,
              prompt: 'Haven: choose a set-aside card to put into your hand',
              body: havenTakeBack,
            }),
          ]),
        ], [announce('Haven had nothing set aside.')]),
      ])),

    kit.cardDef(IDS.Caravan, 'Caravan', 4, 0, 0,
      '+1 Card. +1 Action. At the start of your next turn: +1 Card.',
      seaDurationPair(kit, 'dom_ab_caravan', 'Caravan', [
        kit.draw(OWNER, 1),
        changeVar(ACTIONS, num(1), OWNER),
      ], [
        kit.draw(OWNER, 1),
      ])),

    kit.cardDef(IDS['Fishing Village'], 'Fishing Village', 3, 0, 0,
      '+2 Actions. +$1. At the start of your next turn: +1 Action and +$1.',
      seaDurationPair(kit, 'dom_ab_fishing_village', 'Fishing Village', [
        changeVar(ACTIONS, num(2), OWNER),
        changeVar(COINS, num(1), OWNER),
      ], [
        changeVar(ACTIONS, num(1), OWNER),
        changeVar(COINS, num(1), OWNER),
      ])),

    kit.cardDef(IDS.Lighthouse, 'Lighthouse', 2, 0, 0,
      '+1 Action. +$1. Until your next turn, when another player plays an Attack card, you may wave it off (it does not affect you). At the start of your next turn: +$1.',
      seaDurationPair(kit, 'dom_ab_lighthouse', 'Lighthouse', [
        changeVar(ACTIONS, num(1), OWNER),
        changeVar(COINS, num(1), OWNER),
      ], [
        changeVar(COINS, num(1), OWNER),
      ])),

    kit.cardDef(IDS['Merchant Ship'], 'Merchant Ship', 5, 0, 0,
      '+$2. At the start of your next turn: +$2.',
      seaDurationPair(kit, 'dom_ab_merchant_ship', 'Merchant Ship', [
        changeVar(COINS, num(2), OWNER),
      ], [
        changeVar(COINS, num(2), OWNER),
      ])),

    kit.cardDef(IDS.Wharf, 'Wharf', 5, 0, 0,
      '+2 Cards. +1 Buy. At the start of your next turn: +2 Cards and +1 Buy.',
      seaDurationPair(kit, 'dom_ab_wharf', 'Wharf', [
        kit.draw(OWNER, 2),
        changeVar(BUYS, num(1), OWNER),
      ], [
        kit.draw(OWNER, 2),
        changeVar(BUYS, num(1), OWNER),
      ])),

    // The now +$1 is the treasure action paying the coin FIELD (below: coins
    // = 1); the now-half adds only the +1 Buy, then parks (see the header).
    kit.cardDef(IDS.Astrolabe, 'Astrolabe', 3, 1, 0,
      '+$1. +1 Buy. At the start of your next turn: +$1 and +1 Buy.',
      seaDurationPair(kit, 'dom_ab_astrolabe', 'Astrolabe', [
        changeVar(BUYS, num(1), OWNER),
      ], [
        changeVar(COINS, num(1), OWNER),
        changeVar(BUYS, num(1), OWNER),
      ])),

    kit.cardDef(IDS.Bazaar, 'Bazaar', 5, 0, 0,
      '+1 Card. +2 Actions. +$1.', [
        kit.onPlay('dom_ab_bazaar', 'Market day', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
          changeVar(COINS, num(1), OWNER),
        ]),
      ]),

    kit.cardDef(IDS.Warehouse, 'Warehouse', 3, 0, 0,
      '+3 Cards. +1 Action. Discard 3 cards.', [
        kit.onPlay('dom_ab_warehouse', 'Stock rotation', [
          kit.draw(OWNER, 3),
          changeVar(ACTIONS, num(1), OWNER),
          // Discard exactly 3, clamped to the hand when it holds fewer
          // (SCRATCH carries the clamp; the max stays 3 — Steward's pattern).
          setVar(SCRATCH, num(3), OWNER),
          iff(lt(zoneCount(zone(HAND, OWNER)), num(3)), [
            setVar(SCRATCH, zoneCount(zone(HAND, OWNER)), OWNER),
          ]),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER),
              min: getVar(SCRATCH, OWNER), max: num(3),
              prompt: 'Warehouse: discard 3 cards',
              body: [
                announce(OWNER, ' discards ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ],
            }),
          ]),
        ]),
      ]),
  ];
}

export const seaside2eA: ExpansionModule = {
  id: 'seaside2eA',
  setName: 'Seaside',
  piles: [
    { name: 'Haven', cost: 2, count: 10 },
    { name: 'Lighthouse', cost: 2, count: 10 },
    { name: 'Fishing Village', cost: 3, count: 10 },
    { name: 'Astrolabe', cost: 3, count: 10 },
    { name: 'Warehouse', cost: 3, count: 10 },
    { name: 'Caravan', cost: 4, count: 10 },
    { name: 'Bazaar', cost: 5, count: 10 },
    { name: 'Merchant Ship', cost: 5, count: 10 },
    { name: 'Wharf', cost: 5, count: 10 },
  ],
  ids: IDS,
  buildCards,
  treasureNames: ['Astrolabe'],
  variables: [
    {
      id: HAVEN_MARK, name: 'Haven: set aside',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
  ],
  buildActions(kit: CardKit): ActionDef[] {
    const { IMMUNE } = kit.vars;
    return [
      // Lighthouse's wave-off (see the header's deviation note): Moat's
      // response shape, but the revealed card sits in the DURATION zone.
      {
        id: 'dom_action_lighthouse',
        name: 'Lighthouse: wave off the attack',
        target: { kind: 'cardInZone', zoneId: kit.zones.DURATION, ownerOnly: true },
        speed: 'response',
        legality: allOf(
          kit.nameIs('Lighthouse'),
          gt(STACK_SIZE, num(0)),
          kit.hasTag(STACK_TOP, kit.tags.ATTACK),
          neq(bnd('$player'), CURRENT),
          eq(getVar(IMMUNE, bnd('$player')), num(0)),
        ),
        script: [
          setVar(IMMUNE, num(1)),
          announce(bnd('$player'), "'s Lighthouse shines — the attack does not affect them."),
        ],
      },
    ];
  },
};
