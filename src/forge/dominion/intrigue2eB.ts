/**
 * Intrigue 2E (part B) — Bridge, Conspirator, Diplomat, Ironworks, Mill,
 * Mining Village, Secret Passage, Courtier, Duke.
 *
 * Documented approximations (each also noted at its card):
 *  - Diplomat's reaction is its own response-speed action. Because the core
 *    reveal-Moat action legality is "has the Reaction tag", a tagged Diplomat
 *    can ALSO be revealed through dom_action_reveal_moat for Moat-style
 *    immunity (core-side surface; this module cannot edit that action).
 *  - Mill is officially Action–Victory; a card here has ONE primary type, so
 *    Mill stays Action-typed and its victory-ness is the printed VP field
 *    (the recount sums it). Its discard is all-or-nothing: exactly 2 or
 *    decline (no pointless 1-card discard for nothing).
 *  - Secret Passage's "anywhere in your deck" is approximated as top/bottom.
 *  - Courtier may pick the SAME bonus more than once (official: each choice
 *    must be different); type count = primary type + Attack tag + Reaction
 *    tag + (printed VP > 0 on a non-Victory-typed card) — a faithful mirror
 *    of the engine's one-primary-type world.
 *  - Ironworks' "Victory card" test is Victory-typed OR printed VP > 0, so
 *    Gardens/Duke (VP 0 printed) and duals like Mill/Harem all qualify.
 */
import type {
  ActionDef, Block, CardDef, Expr, TriggerDef, VariableDef,
} from '../../shared/types';
import {
  ALL, CURRENT, STACK_SIZE, STACK_TOP, add, allOf, announce, anyOf, bnd, bestCard, cardZoneId,
  changeVar, chooseCard, chooseCardsBlock, chooseOption, countCards, discardDownTo, eq, field,
  forEachPlayer, getVar, gt, gte, iff, lte, mul, neq, not, num, setVar, specific, str, sub, zone,
  zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

/** Per-player count of Action cards played this turn (Conspirator's tally). */
export const CONSPIRATOR_ACTIONS_VAR = 'dom_var_actions_played';

const SELF: Expr = bnd('$self');
const OPTION: Expr = bnd('$choice');

const IDS: Record<string, string> = {
  Bridge: 'dom_card_bridge',
  Conspirator: 'dom_card_conspirator',
  Courtier: 'dom_card_courtier',
  Diplomat: 'dom_card_diplomat',
  Duke: 'dom_card_duke',
  Ironworks: 'dom_card_ironworks',
  Mill: 'dom_card_mill',
  'Mining Village': 'dom_card_mining_village',
  'Secret Passage': 'dom_card_secret_passage',
};

/** Owned zones for Duke's recount term (mirrors RECOUNT_VP_BODY's world). */
function ownedCount(kit: CardKit, name: string): Expr {
  return [kit.zones.DECK, kit.zones.HAND, kit.zones.DISCARD, kit.zones.INPLAY]
    .map((z) => countCards(zone(z, kit.PLAYER), kit.nameIs(name)))
    .reduce((a, b) => add(a, b));
}

function buildCards(kit: CardKit): CardDef[] {
  const { ACTIONS, BUYS, COINS, DISCOUNT, SCRATCH } = kit.vars;
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK } = kit.zones;
  const { COST, VP_F } = kit.fields;

  // Bridge-aware cap, exactly like the core gainFromSupply: a discount lowers
  // every cost this turn, so "cost ≤ 4" reads "cost ≤ 4 + discount".
  const ironworksFilter = lte(field(kit.CARD, COST), add(num(4), getVar(DISCOUNT)));
  // "Victory card": Victory-typed OR printed VP > 0 (covers Gardens/Duke at
  // VP 0 printed via the type, and Action/Treasure duals via the VP field).
  const gainedIsVictory = anyOf(
    kit.isA(kit.CARD, kit.types.VICTORY),
    gt(field(kit.CARD, VP_F), num(0)),
  );

  return [
    kit.cardDef(IDS.Bridge, 'Bridge', 4, 0, 0,
      '+1 Buy. +$1. This turn, cards (everywhere) cost $1 less, but not less than $0.', [
        // The buy action, supply gains and the cleanup reset are already
        // DISCOUNT-aware core-side; the card only raises the discount.
        kit.onPlay('dom_ab_bridge_main', 'Toll of the span', [
          changeVar(BUYS, num(1), kit.OWNER),
          changeVar(COINS, num(1), kit.OWNER),
          changeVar(DISCOUNT, num(1)),
        ]),
      ]),

    kit.cardDef(IDS.Conspirator, 'Conspirator', 4, 0, 0,
      "+$2. If you've played 3 or more Actions this turn (counting this), +1 Card and +1 Action.", [
        // The tally trigger (buildTriggers) runs BEFORE this ability on the
        // same enter-In-Play event, so the check already counts this play —
        // and Throne Room's synthetic re-play fires the trigger too.
        kit.onPlay('dom_ab_conspirator_main', 'Backroom whispers', [
          changeVar(COINS, num(2), kit.OWNER),
          iff(gte(getVar(CONSPIRATOR_ACTIONS_VAR, kit.OWNER), num(3)), [
            kit.draw(kit.OWNER, 1),
            changeVar(ACTIONS, num(1), kit.OWNER),
          ]),
        ]),
      ]),

    kit.cardDef(IDS.Diplomat, 'Diplomat', 4, 0, 0,
      '+2 Cards. If you have 5 or fewer cards in hand (after drawing), +2 Actions. '
      + 'When another player plays an Attack card, you may first reveal this from a '
      + 'hand of 5 or more cards, to draw 2 cards then discard 3.', [
        kit.onPlay('dom_ab_diplomat_main', 'Careful courtesy', [
          kit.draw(kit.OWNER, 2),
          iff(lte(zoneCount(zone(HAND, kit.OWNER)), num(5)), [
            changeVar(ACTIONS, num(2), kit.OWNER),
          ]),
        ]),
      ]),

    kit.cardDef(IDS.Ironworks, 'Ironworks', 4, 0, 0,
      'Gain a card costing up to $4. If the gained card is an Action card, +1 Action; '
      + 'Treasure card, +$1; Victory card, +1 Card.', [
        // Inline choosePile (not gainFromSupply): the bonuses need $card
        // AFTER the gain, inside the same body.
        kit.onPlay('dom_ab_ironworks_main', 'Commission the works', [
          iff(gt(countCards(zone(SUPPLY), ironworksFilter), num(0)), [
            kit.choosePileBlock({
              who: kit.OWNER, from: zone(SUPPLY), filter: ironworksFilter,
              prompt: 'Ironworks: gain a card costing up to $4',
              body: [
                announce(kit.OWNER, ' gains ', kit.CARD, ' with Ironworks.'),
                kit.tmove(specific(kit.CARD), zone(SUPPLY), zone(DISCARD, kit.OWNER), 'gain', { faceUp: true }),
                // Duals stack: every matching line applies.
                iff(kit.isA(kit.CARD, kit.types.ACTION), [changeVar(ACTIONS, num(1), kit.OWNER)]),
                iff(kit.isA(kit.CARD, kit.types.TREASURE), [changeVar(COINS, num(1), kit.OWNER)]),
                iff(gainedIsVictory, [kit.draw(kit.OWNER, 1)]),
              ],
            }),
          ], [announce(kit.OWNER, ' finds nothing the Ironworks can make.')]),
        ]),
      ]),

    // Officially Action–Victory: primary type stays Action (it must be
    // playable); the printed VP field carries the 1 VP (recount sums it).
    kit.cardDef(IDS.Mill, 'Mill', 4, 0, 1,
      '+1 Card. +1 Action. You may discard 2 cards, for +$2. Worth 1 VP.', [
        kit.onPlay('dom_ab_mill_main', 'Grist for the mill', [
          kit.draw(kit.OWNER, 1),
          changeVar(ACTIONS, num(1), kit.OWNER),
          // Exact-2 or decline: the yes/no gate plus a min-2/max-2 pick.
          // (With fewer than 2 cards in hand the offer is skipped — the
          // official "discard fewer for nothing" corner is not offered.)
          iff(gte(zoneCount(zone(HAND, kit.OWNER)), num(2)), [
            chooseOption('Mill: discard 2 cards for +$2?', [
              { id: 'discard', label: 'Discard 2 cards for +$2' },
              { id: 'keep', label: 'Keep your hand' },
            ], kit.OWNER),
            iff(eq(OPTION, str('discard')), [
              chooseCardsBlock({
                who: kit.OWNER, from: zone(HAND, kit.OWNER), min: num(2), max: num(2),
                prompt: 'Mill: discard exactly 2 cards',
                body: [
                  kit.tmove(specific(kit.CARD), zone(HAND, kit.OWNER), zone(DISCARD, kit.OWNER), 'discard', { faceUp: true }),
                ],
              }),
              changeVar(COINS, num(2), kit.OWNER),
            ]),
          ]),
        ]),
      ]),

    kit.cardDef(IDS['Mining Village'], 'Mining Village', 4, 0, 0,
      '+1 Card. +2 Actions. You may trash this for +$2.', [
        kit.onPlay('dom_ab_mining_village_main', 'Vein under the square', [
          kit.draw(kit.OWNER, 1),
          changeVar(ACTIONS, num(2), kit.OWNER),
          // Throne-Room-safe: on the second (synthetic) play the card may
          // already be in the trash — the offer only stands while it is
          // actually in play.
          iff(eq(cardZoneId(SELF), str(INPLAY)), [
            chooseOption('Mining Village: trash it for +$2?', [
              { id: 'trash', label: 'Trash Mining Village for +$2' },
              { id: 'keep', label: 'Keep it in play' },
            ], kit.OWNER),
            iff(eq(OPTION, str('trash')), [
              announce(kit.OWNER, ' trashes Mining Village for +$2.'),
              kit.tmove(specific(SELF), zone(INPLAY, kit.OWNER), zone(TRASH), 'trash', { faceUp: true }),
              changeVar(COINS, num(2), kit.OWNER),
            ]),
          ]),
        ]),
      ]),

    // "Anywhere in your deck" is approximated as top OR bottom (the engine
    // has no arbitrary-position insert). The picked card stages through the
    // hidden LOOK zone so the card choice happens before the placement one.
    kit.cardDef(IDS['Secret Passage'], 'Secret Passage', 4, 0, 0,
      '+2 Cards. +1 Action. Take a card from your hand and put it anywhere in your deck.', [
        kit.onPlay('dom_ab_secret_passage_main', 'Through hidden halls', [
          kit.draw(kit.OWNER, 2),
          changeVar(ACTIONS, num(1), kit.OWNER),
          iff(gt(zoneCount(zone(HAND, kit.OWNER)), num(0)), [
            chooseCard({
              who: kit.OWNER, from: zone(HAND, kit.OWNER),
              prompt: 'Secret Passage: put a card into your deck',
            }),
            kit.tmove(specific(kit.CHOICE), zone(HAND, kit.OWNER), zone(LOOK), 'look'),
            chooseOption('Secret Passage: where in your deck?', [
              { id: 'top', label: 'On top of your deck' },
              { id: 'bottom', label: 'On the bottom of your deck' },
            ], kit.OWNER),
            iff(eq(OPTION, str('top')),
              [kit.tmove(ALL, zone(LOOK), zone(DECK, kit.OWNER), 'topdeck', { toPosition: 'top', faceUp: false })],
              [kit.tmove(ALL, zone(LOOK), zone(DECK, kit.OWNER), 'topdeck', { toPosition: 'bottom', faceUp: false })]),
          ]),
        ]),
      ]),

    kit.cardDef(IDS.Courtier, 'Courtier', 5, 0, 0,
      'Reveal a card from your hand. For each type it has (up to 4), choose one: '
      + '+1 Action; or +1 Buy; or +$3; or gain a Gold. The choices must be different.', [
        // Type count = primary type (always 1) + Attack tag + Reaction tag +
        // (printed VP > 0 on a non-Victory-typed dual). DEVIATION: repeats
        // are allowed — the engine has no "different each time" choice.
        kit.onPlay('dom_ab_courtier_main', 'A word in the right ear', [
          iff(gt(zoneCount(zone(HAND, kit.OWNER)), num(0)), [
            chooseCard({
              who: kit.OWNER, from: zone(HAND, kit.OWNER),
              prompt: 'Courtier: reveal a card from your hand',
            }),
            announce(kit.OWNER, ' reveals ', kit.CHOICE, '.'),
            setVar(SCRATCH, num(1), kit.OWNER),
            iff(kit.hasTag(kit.CHOICE, kit.tags.ATTACK), [changeVar(SCRATCH, num(1), kit.OWNER)]),
            iff(kit.hasTag(kit.CHOICE, kit.tags.REACTION), [changeVar(SCRATCH, num(1), kit.OWNER)]),
            iff(allOf(gt(field(kit.CHOICE, VP_F), num(0)), not(kit.isA(kit.CHOICE, kit.types.VICTORY))), [
              changeVar(SCRATCH, num(1), kit.OWNER),
            ]),
            {
              kind: 'repeatWhile',
              cond: gt(getVar(SCRATCH, kit.OWNER), num(0)),
              body: [
                chooseOption('Courtier: choose a bonus', [
                  { id: 'action', label: '+1 Action' },
                  { id: 'buy', label: '+1 Buy' },
                  { id: 'coins', label: '+$3' },
                  { id: 'gold', label: 'Gain a Gold' },
                ], kit.OWNER),
                iff(eq(OPTION, str('action')), [changeVar(ACTIONS, num(1), kit.OWNER)]),
                iff(eq(OPTION, str('buy')), [changeVar(BUYS, num(1), kit.OWNER)]),
                iff(eq(OPTION, str('coins')), [changeVar(COINS, num(3), kit.OWNER)]),
                iff(eq(OPTION, str('gold')), [
                  iff(gt(countCards(zone(SUPPLY), kit.nameIs('Gold')), num(0)), [
                    announce(kit.OWNER, ' gains a Gold.'),
                    kit.tmove(
                      specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Gold'))),
                      zone(SUPPLY), zone(DISCARD, kit.OWNER), 'gain', { faceUp: true },
                    ),
                  ], [announce('The supply has no Gold left.')]),
                ]),
                changeVar(SCRATCH, num(-1), kit.OWNER),
              ],
            } as Block,
          ], [announce(kit.OWNER, ' has nothing to show the Courtier.')]),
        ]),
      ]),

    // Victory-typed (victoryNames), printed VP 0 — the worth comes from the
    // buildVpTerms recount term (1 VP per Duchy, per Duke owned).
    kit.cardDef(IDS.Duke, 'Duke', 5, 0, 0, 'Worth 1 VP per Duchy you have.'),
  ];
}

export const intrigue2eB: ExpansionModule = {
  id: 'intrigue2eB',
  piles: [
    { name: 'Bridge', cost: 4, count: 10 },
    { name: 'Conspirator', cost: 4, count: 10 },
    { name: 'Courtier', cost: 5, count: 10 },
    { name: 'Diplomat', cost: 4, count: 10 },
    { name: 'Duke', cost: 5, count: 10 },
    { name: 'Ironworks', cost: 4, count: 10 },
    { name: 'Mill', cost: 4, count: 10 },
    { name: 'Mining Village', cost: 4, count: 10 },
    { name: 'Secret Passage', cost: 4, count: 10 },
  ],
  ids: IDS,
  buildCards,
  attackNames: [],
  reactionNames: ['Diplomat'],
  victoryNames: ['Duke'],

  variables: [
    {
      id: CONSPIRATOR_ACTIONS_VAR, name: 'Actions played this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  buildTriggers(kit: CardKit): TriggerDef[] {
    return [
      // Every Action card entering In Play with the 'play' cause bumps its
      // player's tally — including Throne Room's synthetic re-play, which
      // enqueues the same tagged event. $owner = the In-Play zone's owner.
      {
        id: 'dom_trigger_conspirator_count',
        name: 'Tally actions played this turn',
        event: { kind: 'cardEnterZone', zoneId: kit.zones.INPLAY, tag: 'play' },
        condition: kit.isA(kit.CARD, kit.types.ACTION),
        script: [changeVar(CONSPIRATOR_ACTIONS_VAR, num(1), bnd('$owner'))],
      },
    ];
  },

  buildActions(kit: CardKit): ActionDef[] {
    return [
      // Diplomat's reaction: while another player's Attack is pending, its
      // holder (hand of 5+) may reveal it to draw 2 then discard 3. It does
      // NOT grant immunity. NOTE: because Diplomat wears the Reaction tag,
      // the core dom_action_reveal_moat (legality = has-tag Reaction) can
      // ALSO target it for Moat-style immunity — a core-side surface this
      // module cannot narrow.
      {
        id: 'dom_action_reveal_diplomat',
        name: 'Reveal Diplomat',
        target: { kind: 'cardInZone', zoneId: kit.zones.HAND, ownerOnly: true },
        speed: 'response',
        legality: allOf(
          kit.nameIs('Diplomat'),
          gt(STACK_SIZE, num(0)),
          kit.hasTag(STACK_TOP, kit.tags.ATTACK),
          neq(bnd('$player'), CURRENT),
          gte(zoneCount(zone(kit.zones.HAND, kit.PLAYER)), num(5)),
        ),
        script: [
          announce(kit.PLAYER, ' reveals Diplomat: draws 2 cards, then discards 3.'),
          kit.draw(kit.PLAYER, 2),
          // Exactly 3: keep = (hand size after drawing) − 3.
          discardDownTo({
            who: kit.PLAYER,
            from: zone(kit.zones.HAND, kit.PLAYER),
            to: zone(kit.zones.DISCARD, kit.PLAYER),
            keep: sub(zoneCount(zone(kit.zones.HAND, kit.PLAYER)), num(3)),
            prompt: 'Diplomat: discard 3 cards',
          }),
        ],
      },
    ];
  },

  buildVpTerms(kit: CardKit): Block[] {
    // Duke: 1 VP per Duchy, per Duke owned ($player bound by the recount's
    // forEachPlayer — mirror of the Gardens term in RECOUNT_VP_BODY).
    return [
      changeVar(kit.vars.VP, mul(ownedCount(kit, 'Duke'), ownedCount(kit, 'Duchy')), kit.PLAYER),
    ];
  },

  buildCleanupResets(kit: CardKit): Block[] {
    return [
      forEachPlayer([setVar(CONSPIRATOR_ACTIONS_VAR, num(0), kit.PLAYER)]),
    ];
  },
};
