/**
 * Adventures — the 5 PILE-TOKEN Events (landscape sideboard, kind 'event'):
 * Plan, Seaway, Lost Arts, Training, Pathfinding.
 *
 * THE TOKEN SYSTEM. A printed Adventures token sits ON a supply pile and
 * modifies every play/buy from it. Here each token is a NON-HIDDEN perPlayer
 * STRING variable holding the marked pile's NAME ('' = unplaced), so the
 * scoreboard can show where everyone's tokens sit:
 *   - dom_var_tok_card   (+1 Card,   placed by Pathfinding $8)
 *   - dom_var_tok_action (+1 Action, placed by Lost Arts $6)
 *   - dom_var_tok_coin   (+$1,       placed by Training $6)
 *   - dom_var_tok_buy    (+1 Buy,    placed by Seaway $5)
 *   - dom_var_tok_trash  (Trashing,  placed by Plan $3)
 * ONE shared 'play'-tagged watcher grants the four bonus tokens: when a card
 * enters In Play tagged 'play' and its name matches one of the PLAYER'S
 * token variables, that bonus fires (a name can match several tokens — each
 * grants, exactly like stacking physical tokens on one pile). A token stays
 * until its Event is bought again (setVar overwrites the pile name — that IS
 * the printed "move the token"). Plan's Trashing token has its own
 * 'gain'/'buy' watcher pair (see below). Tokens never reset at cleanup —
 * the printed tokens sit on their piles for the whole game.
 *
 * Placement matches print: every placement choice is a revealed choosePile
 * over the SUPPLY filtered to Action piles (Seaway's gain-driven placement
 * is filtered to Actions costing up to $4, Bridge-aware).
 *
 * EXCLUDED (with Mission, already excluded in adventuresEvents):
 *  - Ferry ($3): "move your -$2 cost token to an Action Supply pile" is
 *    PER-PLAYER cost modification — the def's only cost lever is the shared
 *    global DISCOUNT (Bridge), which would discount the pile for everyone.
 *    Inexpressible without per-player cost machinery; excluded rather than
 *    faked.
 *  - Inheritance ($7): "your Estates gain the abilities and types of the
 *    set-aside card" needs card morphing (an Estate that IS another card);
 *    no such primitive exists. Excluded.
 *
 * DEVIATIONS register:
 *  - PLAN ships the 2022 errata wording ("When you GAIN a card from that
 *    pile, you may trash a card from your hand") — the watcher pair covers
 *    both 'buy'- and 'gain'-tagged arrivals, so Workshop-style gains from
 *    the marked pile offer the trash too. The 2015 print said "buy" only.
 *  - WAY PLAYS: a card played AS a Way enters In Play on an UNTAGGED move
 *    (that is how the core keeps its own effect silent), so pile-token
 *    bonuses do NOT fire on Way plays. Printed, they would. Throne Room
 *    replays DO grant again (triggerAbilities synthesizes a 'play'-tagged
 *    enterZone event), matching print.
 *  - "FIRST": printed, the token bonus resolves before the card's own
 *    effect. Here the watcher and the card's onPlay ability answer the same
 *    enterZone event and their relative order is an engine detail — totals
 *    always agree; mid-resolution ordering is not guaranteed.
 *  - SEAWAY's token rides the same breath as the gain (printed timing puts
 *    it after on-gain effects resolve — an Innovation-style corner this
 *    table cannot reach).
 *  - EMPTY PILES: a token keeps granting even when its pile runs empty
 *    (matches print — the token sits on the empty pile) because the match
 *    is by NAME, not by pile stock.
 */
import type { CardDef, Expr, TriggerDef, VariableDef } from '../../shared/types';
import {
  CURRENT, add, allOf, announce, bnd, changeVar, chooseCardsBlock, countCards, eq, field,
  getVar, gt, iff, lte, num, setVar, specific, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Plan: 'dom_card_plan',
  Seaway: 'dom_card_seaway',
  'Lost Arts': 'dom_card_lost_arts',
  Training: 'dom_card_training',
  Pathfinding: 'dom_card_pathfinding',
};

// --- the pile tokens (non-hidden perPlayer strings: '' = unplaced) -----------

/** The +1 Card token's pile name (Pathfinding). */
export const TOK_CARD = 'dom_var_tok_card';
/** The +1 Action token's pile name (Lost Arts). */
export const TOK_ACTION = 'dom_var_tok_action';
/** The +$1 token's pile name (Training). */
export const TOK_COIN = 'dom_var_tok_coin';
/** The +1 Buy token's pile name (Seaway). */
export const TOK_BUY = 'dom_var_tok_buy';
/** The Trashing token's pile name (Plan). */
export const TOK_TRASH = 'dom_var_tok_trash';

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, DISCARD } = kit.zones;
  const { DISCOUNT } = kit.vars;
  const { COST } = kit.fields;
  const { CARD } = kit;

  /** Fresh Action-pile filter per call site (defs are stored data — no
   *  shared mutable nodes). */
  const actionPile = (): Expr => kit.isA(CARD, kit.types.ACTION);

  /** The shared placement shape (Lost Arts / Training / Pathfinding / Plan):
   *  a revealed choosePile over the supply's Action piles; the pick's NAME
   *  becomes the token variable's value — that IS the token move. */
  const placeToken = (abId: string, eventName: string, varId: string, tokenLabel: string) =>
    kit.onPlay(abId, eventName, [
      iff(gt(countCards(zone(SUPPLY), actionPile()), num(0)), [
        kit.choosePileBlock({
          who: CURRENT, from: zone(SUPPLY), filter: actionPile(), revealed: true,
          prompt: `${eventName}: move your ${tokenLabel} token to an Action Supply pile`,
          body: [
            setVar(varId, field(CARD, 'name'), CURRENT),
            announce(CURRENT, ` moves their ${tokenLabel} token to the `, CARD, ' pile.'),
          ],
        }),
      ], [announce(`No Action pile in the supply — the ${tokenLabel} token stays put.`)]),
    ]);

  /** Seaway's gain filter: an Action costing up to $4, Bridge-aware. */
  const seawayFilter = (): Expr => allOf(
    kit.isA(CARD, kit.types.ACTION),
    lte(field(CARD, COST), add(num(4), getVar(DISCOUNT))),
  );

  return [
    // PLAN ($3) — the Trashing token (2022 wording — register); the trash
    // offer itself lives in the buildTriggers watcher pair.
    kit.cardDef(IDS.Plan, 'Plan', 3, 0, 0,
      'Event. Move your Trashing token to an Action Supply pile. (When you gain a card from that pile, you may trash a card from your hand.)', [
        placeToken('dom_ab_advt_plan', 'Plan', TOK_TRASH, 'Trashing'),
      ]),

    // SEAWAY ($5) — gain an Action up to $4; the +1 Buy token moves to ITS
    // pile (no immediate +1 Buy on the printed card — verified). If nothing
    // qualifies, nothing is gained and the token stays (printed ruling).
    kit.cardDef(IDS.Seaway, 'Seaway', 5, 0, 0,
      'Event. Gain an Action card costing up to $4. Move your +1 Buy token to its pile. (When you play a card from that pile, you first get +1 Buy.)', [
        kit.onPlay('dom_ab_advt_seaway', 'Seaway', [
          iff(gt(countCards(zone(SUPPLY), seawayFilter()), num(0)), [
            kit.choosePileBlock({
              who: CURRENT, from: zone(SUPPLY), filter: seawayFilter(), revealed: true,
              prompt: 'Seaway: gain an Action card costing up to $4 (your +1 Buy token moves to its pile)',
              body: [
                setVar(TOK_BUY, field(CARD, 'name'), CURRENT),
                announce(CURRENT, ' gains ', CARD, ' and moves their +1 Buy token to its pile.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, CURRENT), 'gain', { faceUp: true }),
              ],
            }),
          ], [announce('No Action in the supply costs $4 or less — the +1 Buy token stays put.')]),
        ]),
      ]),

    // LOST ARTS ($6) — the +1 Action token.
    kit.cardDef(IDS['Lost Arts'], 'Lost Arts', 6, 0, 0,
      'Event. Move your +1 Action token to an Action Supply pile. (When you play a card from that pile, you first get +1 Action.)', [
        placeToken('dom_ab_advt_lost_arts', 'Lost Arts', TOK_ACTION, '+1 Action'),
      ]),

    // TRAINING ($6) — the +$1 token.
    kit.cardDef(IDS.Training, 'Training', 6, 0, 0,
      'Event. Move your +$1 token to an Action Supply pile. (When you play a card from that pile, you first get +$1.)', [
        placeToken('dom_ab_advt_training', 'Training', TOK_COIN, '+$1'),
      ]),

    // PATHFINDING ($8) — the +1 Card token.
    kit.cardDef(IDS.Pathfinding, 'Pathfinding', 8, 0, 0,
      'Event. Move your +1 Card token to an Action Supply pile. (When you play a card from that pile, you first get +1 Card.)', [
        placeToken('dom_ab_advt_pathfinding', 'Pathfinding', TOK_CARD, '+1 Card'),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { HAND, INPLAY, TRASH } = kit.zones;
  /** cardEnterZone binds $owner = the destination zone instance's owner —
   *  the player of a 'play', the gainer of a 'gain'/'buy'. */
  const OWNER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** THE shared pile-token watcher: a card enters In Play tagged 'play';
   *  each of the player's four bonus tokens whose pile name matches grants
   *  its bonus. '' (unplaced) never matches a card name, so absent events
   *  cost nothing. Throne Room's synthetic 'play' events re-fire this —
   *  replays grant again, like the printed tokens. */
  const tokenWatch = (): TriggerDef => ({
    id: 'dom_trigger_advt_pile_tokens',
    name: 'Pile tokens: a card from a marked pile is played',
    event: { kind: 'cardEnterZone', zoneId: INPLAY, tag: 'play' },
    condition: null,
    script: [
      iff(eq(field(kit.CARD, 'name'), getVar(TOK_CARD, OWNER)), [
        announce(OWNER, ' first gets +1 Card (the +1 Card token).'),
        kit.drawN(OWNER, num(1)),
      ]),
      iff(eq(field(kit.CARD, 'name'), getVar(TOK_ACTION, OWNER)), [
        announce(OWNER, ' first gets +1 Action (the +1 Action token).'),
        changeVar(kit.vars.ACTIONS, num(1), OWNER),
      ]),
      iff(eq(field(kit.CARD, 'name'), getVar(TOK_COIN, OWNER)), [
        announce(OWNER, ' first gets +$1 (the +$1 token).'),
        changeVar(kit.vars.COINS, num(1), OWNER),
      ]),
      iff(eq(field(kit.CARD, 'name'), getVar(TOK_BUY, OWNER)), [
        announce(OWNER, ' first gets +1 Buy (the +1 Buy token).'),
        changeVar(kit.vars.BUYS, num(1), OWNER),
      ]),
    ],
  });

  /** PLAN's Trashing token: a card from the marked pile arrives anywhere
   *  tagged 'buy' or 'gain' — its gainer may trash one hand card (the
   *  optional min-0 pick; 2022 wording — register). */
  const planWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_advt_plan_${tag}`,
    name: `Plan: a card from the Trashing-token pile is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        eq(field(kit.CARD, 'name'), getVar(TOK_TRASH, OWNER)),
        gt(zoneCount(zone(HAND, OWNER)), num(0)),
      ), [
        chooseCardsBlock({
          who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(1),
          prompt: 'Plan: you may trash a card from your hand (the Trashing token)',
          body: [
            announce(OWNER, ' trashes ', kit.CARD, ' (the Trashing token).'),
            kit.tmove(specific(kit.CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
          ],
        }),
      ]),
    ],
  });

  return [tokenWatch(), planWatch('buy'), planWatch('gain')];
}

export const adventuresTokens: ExpansionModule = {
  id: 'adventuresTokens',
  setName: 'Adventures',

  piles: [],

  ids: IDS,

  landscapes: [
    { name: 'Plan', cost: 3, kind: 'event' },
    { name: 'Seaway', cost: 5, kind: 'event' },
    { name: 'Lost Arts', cost: 6, kind: 'event' },
    { name: 'Training', cost: 6, kind: 'event' },
    { name: 'Pathfinding', cost: 8, kind: 'event' },
  ],

  variables: [
    {
      id: TOK_CARD, name: '+1 Card token',
      scope: 'perPlayer', type: 'string', initial: '',
    },
    {
      id: TOK_ACTION, name: '+1 Action token',
      scope: 'perPlayer', type: 'string', initial: '',
    },
    {
      id: TOK_COIN, name: '+$1 token',
      scope: 'perPlayer', type: 'string', initial: '',
    },
    {
      id: TOK_BUY, name: '+1 Buy token',
      scope: 'perPlayer', type: 'string', initial: '',
    },
    {
      id: TOK_TRASH, name: 'Trashing token',
      scope: 'perPlayer', type: 'string', initial: '',
    },
  ] as VariableDef[],

  buildCards,
  buildTriggers,
};
