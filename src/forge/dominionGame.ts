/**
 * The hall's flagship table: Dominion, id 'dominion-crownfall' — a Forge
 * creation the lobby actually plays. Built by deep-cloning the Cardsmith
 * example (war-table screenLayout, Militia/Moat stack patterns) and
 * re-expressing it on the schema-v2 vocabulary so all three lobby kingdom
 * sets (src/shared/kingdoms.ts) are playable:
 *
 *   - every card move carries its CAUSE tag (play / buy / gain / trash /
 *     discard / draw / cleanup), so triggers and the runner's per-tag flight
 *     table can react to WHY a card moved;
 *   - the `draw` block (inline seeded reshuffle) replaces the old 4-block
 *     "flip the discard, shuffle, move top 1" macro at every draw site;
 *   - supply gains (Workshop / Remodel / Mine) are ONE `choosePile` block
 *     each — the original's mandatory "choose a pile" pending, straight off
 *     the live supply (the transient PICKROW staging zone is gone);
 *   - the Black Market sells from its stock zone via an optional choosePile
 *     (the whole under-the-counter stock is on offer — the old build staged
 *     3 random cards, a surface the primitive deliberately replaces);
 *   - Throne Room re-fires the chosen card's play moment with
 *     `triggerAbilities` — no more reserve bounce, no zone churn;
 *   - the victory recount is `sumCards` over the four owned zones, run by
 *     the turnEnd trigger plus ONE tagged trigger on every 'gain';
 *   - Moat is typed 'action reaction' and Militia/Witch 'action attack' —
 *     the `contains` op restores the original's multi-type membership;
 *   - IMMUNE resets in ONE `effectResolved` trigger after each attack
 *     resolves (per-attack immunity, no per-card boilerplate);
 *   - inactive kingdom piles wait in a hidden shared RESERVE zone — which is
 *     also the Black Market's stock, so the market sells what the kingdom
 *     doesn't;
 *   - end-of-game timing is unchanged: the supply is judged only at turn
 *     end (GAME_OVER gate), exactly like the original table's engine.
 *
 * The screenLayout is dressed to the DGT extraction spec: the phase seal is
 * a full-plate notched button with lozenge phase dots, a five-state
 * name/hint pair (Action / Buy / foe-breathe / Resolve / Fallen) and a
 * keyboard hint; the supply zones carry Shift/Ctrl/Alt keyboard groups and
 * the hand plain digit badges; the hand fans at 1.6°/step; motion.byTag
 * carries the original's per-event animation table.
 *
 * Every choice a script can open always has at least one candidate (guarded
 * by iff) or is optional, so the random session AI can never hang on one.
 */
import type {
  AbilityDef, Block, CardDef, CardSelector, Expr, GameDef, ScreenElement, ZoneRef,
} from '../shared/types';
import { deepClone } from '../shared/defaults';
import { dominionGame } from '../examples/dominion';
import {
  ALL, CURRENT, STACK_SIZE, TURN_NUMBER, add, allOf, announce, anyOf, bnd, bestCard, changeVar,
  chooseCard, chooseCardsBlock, countCards, eq, field, forEachPlayer, getVar, gt, gte, iff, lte,
  move, mul, neg, neq, nextPlayer, not, num, or, setVar, specific, str, sub, zone, zoneCount,
} from '../examples/dsl';
import { DEFAULT_KINGDOM_ID, kingdomById } from '../shared/kingdoms';
import { DOMINION_GAME_ID } from './seedDominion';

// --- ids (dom_* ids are cloned from the example, new ones join the family) ---

const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';
const DECK = 'dom_zone_deck';
const HAND = 'dom_zone_hand';
const DISCARD = 'dom_zone_discard';
const INPLAY = 'dom_zone_inplay';
/** Unpicked kingdom piles wait here; doubles as the Black Market's stock. */
const RESERVE = 'dom_zone_reserve';

const ACTIONS = 'dom_var_actions';
const BUYS = 'dom_var_buys';
const COINS = 'dom_var_coins';
const VP = 'dom_var_vp';
const IMMUNE = 'dom_var_immune';
const EMPTY_PILES = 'dom_var_empty_piles';
/** Per-player scratch number (Cellar's discard count, Remodel/Mine's cost cap). */
const SCRATCH = 'dom_var_scratch';
/** Set at turn end when the supply says the game is over (see buildDominionDef). */
const GAME_OVER = 'dom_var_game_over';

const COST = 'dom_field_cost';
const CTYPE = 'dom_field_ctype';
const COINS_F = 'dom_field_coins';
const VP_F = 'dom_field_vp';
const TEXT = 'dom_field_text';
/** Display-only type line ("Action – Attack") — CTYPE stays machine-readable. */
const KIND_F = 'dom_field_kind';

const PHASE_ACTION = 'dom_phase_action';
const PHASE_BUY = 'dom_phase_buy';

/** The per-player victory-point variable (read by the hall on game over). */
export const DOMINION_VP_VAR = VP;

const OWNER = bnd('$owner');
const CARD = bnd('$card');
const CHOICE = bnd('$choice');
const PLAYER = bnd('$player');

const nameIs = (name: string): Expr => eq(field(CARD, 'name'), str(name));

const div = (l: Expr, r: Expr): Expr => ({ kind: 'math', op: '/', left: l, right: r });
const mod = (l: Expr, r: Expr): Expr => ({ kind: 'math', op: '%', left: l, right: r });

// --- schema-v2 sugar (dsl.ts belongs to the examples; the forge builds its own) ---

/** moveCards with a cause tag — the move's events carry WHY it happened. */
function tmove(
  cards: CardSelector, from: ZoneRef, to: ZoneRef, moveTag: string,
  opts: { toPosition?: 'top' | 'bottom'; faceUp?: boolean | null } = {},
): Block {
  return {
    kind: 'moveCards', from, to, cards,
    toPosition: opts.toPosition ?? 'top', faceUp: opts.faceUp ?? null, tag: moveTag,
  };
}

/** The draw block: deck → hand with the inline seeded reshuffle, tagged 'draw'. */
function drawN(owner: Expr | null, count: Expr): Block {
  return {
    kind: 'draw', who: null, count,
    from: zone(DECK, owner), refillFrom: zone(DISCARD, owner), to: zone(HAND, owner),
    faceUp: true,
  };
}
const draw = (owner: Expr | null, n: number): Block => drawN(owner, num(n));

/** choosePile: one choice per distinct pile of a (filtered) zone, $card = top copy. */
function choosePileBlock(opts: {
  who?: Expr | null;
  from: ZoneRef;
  filter?: Expr | null;
  prompt: string;
  optional?: boolean;
  body: Block[];
}): Block {
  return {
    kind: 'choosePile', who: opts.who ?? null, from: opts.from, filter: opts.filter ?? null,
    groupBy: 'def', prompt: opts.prompt, optional: opts.optional ?? false, body: opts.body,
  };
}

/** Re-fire a card's In-Play entry WITHOUT moving it (Throne Room). */
const playAgain = (card: Expr): Block =>
  ({ kind: 'triggerAbilities', card, on: 'enterZone', zoneId: INPLAY });

/** Sum a numeric card field over a zone (the VP recount's workhorse). */
const sumCards = (z: ZoneRef, fieldId: string, filter: Expr | null = null): Expr =>
  ({ kind: 'sumCards', zone: z, fieldId, filter });

/** Multi-type membership: CTYPE holds words like 'action attack'. */
const hasType = (card: Expr, word: string): Expr =>
  ({ kind: 'compare', op: 'contains', left: field(card, CTYPE), right: str(word) });

const IS_ACTION_CARD = hasType(CARD, 'action');
const IS_TREASURE_CARD = eq(field(CARD, CTYPE), str('treasure'));

// --- the supply catalogue (build-time truth for counts / watcher) -------------

interface PileSpec {
  name: string;
  cost: number;
  treasure?: boolean;
  /** Cards per pile (basics use the original table's 2-player counts). */
  count: number;
}

const BASIC_PILES: PileSpec[] = [
  { name: 'Copper', cost: 0, treasure: true, count: 46 },
  { name: 'Silver', cost: 3, treasure: true, count: 40 },
  { name: 'Gold', cost: 6, treasure: true, count: 30 },
  { name: 'Estate', cost: 2, count: 8 },
  { name: 'Duchy', cost: 5, count: 8 },
  { name: 'Province', cost: 8, count: 8 },
  { name: 'Curse', cost: 0, count: 10 },
];
const BASIC_NAMES = BASIC_PILES.map((p) => p.name);
const BASIC_NAME_SET = new Set(BASIC_NAMES);

/** Every kingdom card the def knows (union of the three sets + spares). */
const KINGDOM_PILES: PileSpec[] = [
  // Already in the example def.
  { name: 'Moat', cost: 2, count: 10 },
  { name: 'Village', cost: 3, count: 10 },
  { name: 'Woodcutter', cost: 3, count: 10 }, // spare — in no set, Black Market stock
  { name: 'Militia', cost: 4, count: 10 },
  { name: 'Smithy', cost: 4, count: 10 },
  { name: 'Festival', cost: 5, count: 10 },
  { name: 'Laboratory', cost: 5, count: 10 },
  { name: 'Market', cost: 5, count: 10 },
  { name: 'Council Room', cost: 5, count: 10 },
  // Added for the three lobby sets.
  { name: 'Cellar', cost: 2, count: 10 },
  { name: 'Chapel', cost: 2, count: 10 },
  { name: 'Workshop', cost: 3, count: 10 },
  { name: 'Black Market', cost: 3, count: 10 },
  { name: 'Throne Room', cost: 4, count: 10 },
  { name: 'Remodel', cost: 4, count: 10 },
  { name: 'Gardens', cost: 4, count: 10 },
  { name: 'Mine', cost: 5, count: 10 },
  { name: 'Witch', cost: 5, count: 10 },
];
/** Card-def ids for the cards this module adds (example ids stay as they are). */
const NEW_CARD_ID: Record<string, string> = {
  Curse: 'dom_card_curse',
  Cellar: 'dom_card_cellar',
  Chapel: 'dom_card_chapel',
  Workshop: 'dom_card_workshop',
  'Black Market': 'dom_card_black_market',
  'Throne Room': 'dom_card_throne_room',
  Remodel: 'dom_card_remodel',
  Gardens: 'dom_card_gardens',
  Mine: 'dom_card_mine',
  Witch: 'dom_card_witch',
};

/** Example card ids by name (mirrors src/examples/dominion.ts literals). */
const EXAMPLE_CARD_ID: Record<string, string> = {
  Copper: 'dom_card_copper',
  Silver: 'dom_card_silver',
  Gold: 'dom_card_gold',
  Estate: 'dom_card_estate',
  Duchy: 'dom_card_duchy',
  Province: 'dom_card_province',
  Village: 'dom_card_village',
  Smithy: 'dom_card_smithy',
  Market: 'dom_card_market',
  Festival: 'dom_card_festival',
  Laboratory: 'dom_card_laboratory',
  Woodcutter: 'dom_card_woodcutter',
  'Council Room': 'dom_card_council_room',
  Militia: 'dom_card_militia',
  Moat: 'dom_card_moat',
};

const cardIdFor = (name: string): string => NEW_CARD_ID[name] ?? EXAMPLE_CARD_ID[name];

// --- card plumbing ------------------------------------------------------------

/** "When you play this" ability: fires when the card enters In Play. */
function onPlay(id: string, name: string, script: Block[], stacked = false): AbilityDef {
  return { id, name, on: 'enterZone', zoneId: INPLAY, phaseId: null, condition: null, script, stacked };
}

function card(
  name: string, cost: number, ctype: string, coins: number, vp: number, text: string,
  abilities: AbilityDef[] = [],
): CardDef {
  return {
    id: cardIdFor(name), name, templateId: 'dom_tpl_kingdom',
    fields: { [COST]: cost, [CTYPE]: ctype, [COINS_F]: coins, [VP_F]: vp, [TEXT]: text },
    abilities,
  };
}

/**
 * The original's multi-type lines, restored via `contains`: CTYPE holds
 * space-separated words; KIND_F is the pretty display line on the card face.
 */
const CTYPE_OVERRIDE: Record<string, string> = {
  Militia: 'action attack',
  Moat: 'action reaction',
};
const KIND_LABEL: Record<string, string> = {
  treasure: 'Treasure',
  victory: 'Victory',
  curse: 'Curse',
  action: 'Action',
  'action attack': 'Action – Attack',
  'action reaction': 'Action – Reaction',
};

/**
 * Gardens-aware victory recount: `sumCards` of the VP field over everything a
 * player owns, plus 1 VP per 10 owned cards (rounded down) per Gardens. Run
 * by the turnEnd trigger AND one tagged trigger on every 'gain' move.
 */
const OWNED_ZONES = [DECK, HAND, DISCARD, INPLAY];
const ownedTotal: Expr = OWNED_ZONES
  .map((z) => zoneCount(zone(z, PLAYER)))
  .reduce((a, b) => add(a, b));
const gardensTotal: Expr = OWNED_ZONES
  .map((z) => countCards(zone(z, PLAYER), nameIs('Gardens')))
  .reduce((a, b) => add(a, b));
const ownedVpTotal: Expr = OWNED_ZONES
  .map((z) => sumCards(zone(z, PLAYER), VP_F))
  .reduce((a, b) => add(a, b));
const RECOUNT_VP: Block[] = [
  forEachPlayer([
    setVar(VP, ownedVpTotal, PLAYER),
    // floor(total / 10) as (total - total % 10) / 10 — exact integer math.
    changeVar(VP, mul(gardensTotal, div(sub(ownedTotal, mod(ownedTotal, num(10))), num(10))), PLAYER),
  ]),
];

/**
 * The original's mandatory pile-gain pending, now ONE choosePile straight off
 * the live supply (no staging). `whiff` runs when nothing qualifies (matching
 * the original's silent-null auto-resolution).
 */
function gainFromSupply(opts: {
  limit: Expr;
  treasureOnly?: boolean;
  toHand?: boolean;
  prompt: string;
  whiff: Block[];
}): Block[] {
  const filter = opts.treasureOnly
    ? allOf(IS_TREASURE_CARD, lte(field(CARD, COST), opts.limit))
    : lte(field(CARD, COST), opts.limit);
  return [
    iff(gt(countCards(zone(SUPPLY), filter), num(0)), [
      choosePileBlock({
        who: OWNER, from: zone(SUPPLY), filter, prompt: opts.prompt,
        body: [
          announce(OWNER, ' gains ', CARD, '.'),
          tmove(specific(CARD), zone(SUPPLY), zone(opts.toHand ? HAND : DISCARD, OWNER), 'gain', { faceUp: true }),
        ],
      }),
    ], opts.whiff),
  ];
}

// --- the added cards ----------------------------------------------------------

const EXTRA_CARDS: CardDef[] = [
  card('Curse', 0, 'curse', 0, -1, 'Worth −1 victory point.'),
  card('Gardens', 4, 'victory', 0, 0,
    'Worth 1 victory point per 10 cards you own (rounded down).'),
  card('Cellar', 2, 'action', 0, 0,
    'Gain 1 action. Discard any number of cards, then draw that many.', [
      onPlay('dom_ab_cellar', 'Down to the cellar', [
        changeVar(ACTIONS, num(1), OWNER),
        setVar(SCRATCH, num(0), OWNER),
        chooseCardsBlock({
          who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(99),
          prompt: 'Cellar: discard any number of cards, then draw that many',
          body: [
            tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
            changeVar(SCRATCH, num(1), OWNER),
          ],
        }),
        drawN(OWNER, getVar(SCRATCH, OWNER)),
      ]),
    ]),
  card('Chapel', 2, 'action', 0, 0, 'Trash up to 4 cards from your hand.', [
    onPlay('dom_ab_chapel', 'Cleansing rite', [
      chooseCardsBlock({
        who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(4),
        prompt: 'Chapel: choose up to 4 cards to trash',
        body: [
          announce(OWNER, ' trashes ', CARD, '.'),
          tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
        ],
      }),
    ]),
  ]),
  card('Workshop', 3, 'action', 0, 0, 'Gain a card costing up to 4 coins.', [
    onPlay('dom_ab_workshop', 'Commissioned work', gainFromSupply({
      limit: num(4),
      prompt: 'Workshop: gain a card costing up to 4',
      whiff: [announce(OWNER, ' finds nothing to gain.')],
    })),
  ]),
  card('Black Market', 3, 'action', 0, 0,
    '+2 Coins. You may buy a card from the Black Market’s stock.', [
      onPlay('dom_ab_black_market', 'Under the counter', [
        changeVar(COINS, num(2), OWNER),
        iff(gt(zoneCount(zone(RESERVE)), num(0)), [
          choosePileBlock({
            who: OWNER, from: zone(RESERVE),
            filter: lte(field(CARD, COST), getVar(COINS, OWNER)),
            optional: true,
            prompt: 'Black Market: buy a card from under the counter?',
            body: [
              changeVar(COINS, neg(field(CARD, COST)), OWNER),
              announce(OWNER, ' buys ', CARD, ' from the Black Market.'),
              tmove(specific(CARD), zone(RESERVE), zone(DISCARD, OWNER), 'buy', { faceUp: true }),
            ],
          }),
        ], [announce('The Black Market has nothing left to sell.')]),
      ]),
    ]),
  card('Throne Room', 4, 'action', 0, 0,
    'Choose an action card from your hand. Play it twice.', [
      onPlay('dom_ab_throne_room', 'By royal decree', [
        iff(gt(countCards(zone(HAND, OWNER), IS_ACTION_CARD), num(0)), [
          chooseCard({
            who: OWNER, from: zone(HAND, OWNER), filter: IS_ACTION_CARD,
            prompt: 'Throne Room: choose an action to play twice',
          }),
          announce(OWNER, ' plays ', CHOICE, ' twice with Throne Room.'),
          tmove(specific(CHOICE), zone(HAND, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
          // The second play: re-fire the card's In-Play entry without moving
          // it — stacked abilities still stack, nothing bounces through zones.
          playAgain(CHOICE),
        ], [announce(OWNER, ' has no action for the throne.')]),
      ]),
    ]),
  card('Remodel', 4, 'action', 0, 0,
    'Trash a card from your hand. Gain a card costing up to 2 coins more than it.', [
      onPlay('dom_ab_remodel', 'Tear down, build up', [
        iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
          chooseCard({ who: OWNER, from: zone(HAND, OWNER), prompt: 'Remodel: choose a card to trash' }),
          setVar(SCRATCH, add(field(CHOICE, COST), num(2)), OWNER),
          announce(OWNER, ' trashes ', CHOICE, '.'),
          tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
          ...gainFromSupply({
            limit: getVar(SCRATCH, OWNER),
            prompt: 'Remodel: gain a card costing up to 2 more than the trashed card',
            whiff: [announce('Nothing in the supply is cheap enough.')],
          }),
        ], [announce(OWNER, ' has nothing to remodel.')]),
      ]),
    ]),
  card('Mine', 5, 'action', 0, 0,
    'Trash a Treasure from your hand. Gain a Treasure costing up to 3 coins more, into your hand.', [
      onPlay('dom_ab_mine', 'Deep veins', [
        iff(gt(countCards(zone(HAND, OWNER), IS_TREASURE_CARD), num(0)), [
          chooseCard({
            who: OWNER, from: zone(HAND, OWNER), filter: IS_TREASURE_CARD,
            prompt: 'Mine: choose a Treasure to trash',
          }),
          setVar(SCRATCH, add(field(CHOICE, COST), num(3)), OWNER),
          announce(OWNER, ' trashes ', CHOICE, '.'),
          tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
          ...gainFromSupply({
            treasureOnly: true, toHand: true,
            limit: getVar(SCRATCH, OWNER),
            prompt: 'Mine: gain a Treasure into your hand',
            whiff: [announce('No Treasure in the supply is cheap enough.')],
          }),
        ], [announce(OWNER, ' has no Treasure to mine.')]),
      ]),
    ]),
  card('Witch', 5, 'action attack', 0, 0,
    '+2 Cards. Every other player gains a Curse (Moat blocks this).', [
      // Like Militia: the draw is immediate, only the attack half goes
      // through the stack so Moat owners get a response window first.
      onPlay('dom_ab_witch_draw', 'Cackling study', [draw(OWNER, 2)]),
      onPlay('dom_ab_witch_attack', 'Midnight curse', [
        forEachPlayer([
          iff(allOf(neq(PLAYER, OWNER), eq(getVar(IMMUNE, PLAYER), num(0))), [
            iff(gt(countCards(zone(SUPPLY), nameIs('Curse')), num(0)), [
              announce(PLAYER, ' gains a Curse.'),
              tmove(
                specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Curse'))),
                zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
              ),
            ]),
          ]),
        ]),
        // IMMUNE resets in the shared effectResolved trigger, per attack.
      ], true),
    ]),
];

/**
 * The example cards' abilities, re-expressed on the draw block + move tags.
 * Applied over the deep-cloned example defs in buildDominionDef (ids kept).
 * Festival and Woodcutter carry no draws/moves and stay as cloned.
 */
const EXAMPLE_ABILITY_OVERRIDES: Record<string, AbilityDef[]> = {
  Village: [onPlay('dom_ab_village', 'Bustling streets', [
    draw(OWNER, 1),
    changeVar(ACTIONS, num(2), OWNER),
  ])],
  Smithy: [onPlay('dom_ab_smithy', 'Forge ahead', [draw(OWNER, 3)])],
  Market: [onPlay('dom_ab_market', 'Open for business', [
    draw(OWNER, 1),
    changeVar(ACTIONS, num(1), OWNER),
    changeVar(BUYS, num(1), OWNER),
    changeVar(COINS, num(1), OWNER),
  ])],
  Laboratory: [onPlay('dom_ab_laboratory', 'Experiment', [
    draw(OWNER, 2),
    changeVar(ACTIONS, num(1), OWNER),
  ])],
  'Council Room': [onPlay('dom_ab_council', 'Open council', [
    draw(OWNER, 4),
    changeVar(BUYS, num(1), OWNER),
    forEachPlayer([
      iff(neq(PLAYER, OWNER), [draw(PLAYER, 1)]),
    ]),
  ])],
  Militia: [
    // The coins are immediate; only the attack half goes through the stack,
    // so Moat owners get a response window before anyone has to discard.
    onPlay('dom_ab_militia_coins', 'Press-ganged wages', [
      changeVar(COINS, num(2), OWNER),
    ]),
    onPlay('dom_ab_militia_attack', 'Militia raid', [
      forEachPlayer([
        iff(allOf(neq(PLAYER, OWNER), eq(getVar(IMMUNE, PLAYER), num(0))), [
          iff(gt(zoneCount(zone(HAND, PLAYER)), num(3)), [
            chooseCardsBlock({
              who: PLAYER,
              from: zone(HAND, PLAYER),
              min: sub(zoneCount(zone(HAND, PLAYER)), num(3)),
              max: sub(zoneCount(zone(HAND, PLAYER)), num(3)),
              prompt: 'Militia: discard down to 3 cards',
              body: [
                tmove(specific(CARD), zone(HAND, PLAYER), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
              ],
            }),
          ]),
        ]),
      ]),
      // IMMUNE resets in the shared effectResolved trigger, per attack.
    ], true),
  ],
  Moat: [onPlay('dom_ab_moat', 'Across the moat', [draw(OWNER, 2)])],
};

// --- kingdom-pile setup blocks (the tag pickKingdom looks for) ----------------

/**
 * One tagged setup block per active kingdom card: move that card's whole
 * pile from the reserve into the supply. The "tag" is the recognizable
 * shape — a filtered reserve→supply move on the card's name.
 */
function kingdomPileBlock(name: string): Block {
  return move(
    { kind: 'filter', filter: nameIs(name) },
    zone(RESERVE), zone(SUPPLY), { faceUp: true },
  );
}

/** The card name a setup block spawns a kingdom pile for, or null. */
function kingdomPileBlockName(b: Block): string | null {
  if (b.kind !== 'moveCards') return null;
  if (b.from.zoneId !== RESERVE || b.to.zoneId !== SUPPLY) return null;
  if (b.cards.kind !== 'filter') return null;
  const f = b.cards.filter;
  if (f.kind !== 'compare' || f.op !== '==') return null;
  if (f.left.kind !== 'cardField' || f.left.fieldId !== 'name') return null;
  if (f.right.kind !== 'str') return null;
  return f.right.value;
}

/** Empty-pile watcher over the ACTIVE piles (basics + the chosen kingdom). */
function pileWatcherScript(kingdomNames: string[]): Block[] {
  return [
    setVar(EMPTY_PILES, num(0)),
    ...[...BASIC_NAMES, ...kingdomNames].map((n) =>
      iff(eq(countCards(zone(SUPPLY), nameIs(n)), num(0)), [
        changeVar(EMPTY_PILES, num(1)),
      ])),
  ];
}

// --- screen-layout: shared reactive expressions --------------------------------

// Reactive expressions ($viewer bound by the display evaluator).
const VIEWER = bnd('$viewer');
/** It's the viewing seat's own turn. */
const MY_TURN = eq(CURRENT, VIEWER);
/** The turn belongs to some other seat. */
const THEIR_TURN = neq(CURRENT, VIEWER);
/** The seat after the viewer — the foe the top strip shows (opp1). */
const FOE = nextPlayer(VIEWER);

const IN_ACTION: Expr = { kind: 'phaseIs', phaseId: PHASE_ACTION };
const IN_BUY: Expr = { kind: 'phaseIs', phaseId: PHASE_BUY };

/** The turn-end judgement has fallen — the DGT seal's "Fallen" state. */
const GAME_IS_OVER = gte(getVar(GAME_OVER), num(1));
/** No pending effect awaits a response. */
const STACK_QUIET = eq(STACK_SIZE, num(0));

// The DGT seal's five render-states, in its renderPhase() priority order.
const SEAL_RESOLVE = allOf(not(GAME_IS_OVER), gt(STACK_SIZE, num(0)));
const SEAL_FOE = allOf(not(GAME_IS_OVER), STACK_QUIET, THEIR_TURN);
const SEAL_MINE = allOf(not(GAME_IS_OVER), STACK_QUIET, MY_TURN);
const SEAL_ACTION = allOf(not(GAME_IS_OVER), STACK_QUIET, MY_TURN, IN_ACTION);
const SEAL_BUY = allOf(not(GAME_IS_OVER), STACK_QUIET, MY_TURN, IN_BUY);

// Palette — hex approximations of the reference table's OKLCH tokens.
const INK = '#ece4d8';
const ASH = '#a89484';
const BONE_FAINT = 'rgba(236, 228, 216, 0.45)';
const BONE_SOFT = 'rgba(236, 228, 216, 0.85)';

// --- the phase seal (rebuilt to the DGT spec markup) ---------------------------

/**
 * A 5px lozenge phase dot: translucent bone outline, filled solid bone while
 * its phase is current ON the viewer's live turn (the DGT seal lights no dot
 * during resolve / foe turn / game over — data-phase isn't 'action'/'buy').
 */
function sealDot(id: string, name: string, x: number, phaseId: string): ScreenElement {
  return {
    kind: 'shape', id, name, shape: 'diamond',
    rect: { x, y: 13, w: 3.2, h: 4.6 },
    style: { background: 'transparent', borderColor: BONE_FAINT, borderWidth: 1 },
    states: [{
      id: `${id}_current`, name: 'Current phase',
      when: allOf(SEAL_MINE, { kind: 'phaseIs', phaseId }),
      style: { background: INK, borderColor: INK },
    }],
  };
}

/** The seal's name line (Gloock via the skin), one element per render-state. */
function sealName(
  id: string, label: string, when: Expr, color: string, parts?: (string | Expr)[],
): ScreenElement {
  return {
    kind: 'text', id, name: `Seal name — ${label !== '' ? label : 'foe'}`,
    rect: { x: 9, y: 24, w: 82, h: 26 },
    text: label, ...(parts !== undefined ? { parts } : {}),
    fontSize: 1.45, bold: false, align: 'left', color,
    visible: when,
  };
}

/** The seal's hint line (uppercase microcopy), one element per render-state. */
function sealHint(id: string, label: string, when: Expr, color: string): ScreenElement {
  return {
    kind: 'text', id, name: `Seal hint — ${label}`,
    rect: { x: 9, y: 54, w: 82, h: 11 },
    text: label, fontSize: 0.62, bold: false, align: 'left', color,
    visible: when,
  };
}

/**
 * The DGT phase seal, rebuilt to the spec markup: a full-plate notched
 * button (the seal IS the button — Done during Action, End turn otherwise),
 * two lozenge phase dots with current emphasis, a five-state name/hint pair
 * (your Action / your Buy / foe-turn breathe / Resolve / Fallen — priority
 * per the original renderPhase), and the keyboard hint. The dressing
 * (crimson plate, hall/ash foe state, dais resolve state) lives in
 * dominion-skin.css off the runner root's data-phase/data-active hooks.
 */
function sealChildren(): ScreenElement[] {
  const foeName: ScreenElement = {
    ...sealName('dom_el_seal_name_foe', '', SEAL_FOE, ASH, [FOE]),
    // The foe's name breathes while he thinks (2.6s loop while the state
    // holds). 'breathe' is runner-live but not yet in the stored union —
    // see the wave-1 runner report; the cast is the documented bridge.
    onChangeAnim: 'breathe',
    states: [{ id: 'dom_st_seal_foe_breathe', name: 'Foe thinking', when: SEAL_FOE }],
  };
  return [
    // The plate: full-size buttons, phase-gated (End turn also covers the
    // momentary auto Cleanup so the plate never vanishes). Labels are read
    // by AT; visually the overlay texts below carry the seal's face.
    {
      kind: 'button', id: 'dom_el_seal_btn_done', name: 'Done (end actions)',
      rect: { x: 0, y: 0, w: 100, h: 100 },
      actionId: 'dom_action_done', label: 'Done — to Buy phase', fontSize: 1,
      visible: IN_ACTION,
    },
    {
      kind: 'button', id: 'dom_el_seal_btn_end', name: 'End turn',
      rect: { x: 0, y: 0, w: 100, h: 100 },
      actionId: 'dom_action_end_turn', label: 'End turn', fontSize: 1,
      visible: not(IN_ACTION),
    },
    // The two phase dots — Action and Buy; Cleanup has no dot, per the law.
    sealDot('dom_el_seal_dot_action', 'Action dot', 9, PHASE_ACTION),
    sealDot('dom_el_seal_dot_buy', 'Buy dot', 13.8, PHASE_BUY),
    // Name line, five render-states.
    sealName('dom_el_seal_name_action', 'Action', SEAL_ACTION, INK),
    sealName('dom_el_seal_name_buy', 'Buy', SEAL_BUY, INK),
    foeName,
    sealName('dom_el_seal_name_resolve', 'Resolve', SEAL_RESOLVE, ASH),
    sealName('dom_el_seal_name_fallen', 'Fallen', GAME_IS_OVER, INK),
    // Hint line, matching microcopy (uppercase, engraved via size/color).
    sealHint('dom_el_seal_hint_action', 'TO BUY', SEAL_ACTION, BONE_SOFT),
    sealHint('dom_el_seal_hint_buy', 'END TURN', SEAL_BUY, BONE_SOFT),
    sealHint('dom_el_seal_hint_foe', 'TAKES THEIR TURN', SEAL_FOE, ASH),
    sealHint('dom_el_seal_hint_resolve', 'RESPOND BELOW', SEAL_RESOLVE, ASH),
    sealHint('dom_el_seal_hint_fallen', 'MATCH OVER', GAME_IS_OVER, BONE_SOFT),
    // The keyboard hint (the runner's primary-action key is Enter).
    {
      kind: 'text', id: 'dom_el_seal_key', name: 'Seal key hint',
      rect: { x: 73, y: 38, w: 18, h: 22 },
      text: 'ENTER', fontSize: 0.55, bold: false, align: 'center',
      color: 'rgba(236, 228, 216, 0.8)',
      style: { borderColor: 'rgba(236, 228, 216, 0.4)', borderWidth: 1, borderRadius: 2 },
      visible: SEAL_MINE,
    },
  ];
}

/**
 * The seal group's states: no styling of their own (the skin paints off the
 * runner root's data attributes) — they exist so the resolved state CHANGES
 * with every phase/turn/stack transition, which retriggers the group's
 * 'stamp' onChangeAnim (the DGT seal-stamp on every renderPhase).
 */
function sealStates(): NonNullable<ScreenElement['states']> {
  return [
    { id: 'dom_st_seal_over', name: 'Fallen', when: GAME_IS_OVER },
    { id: 'dom_st_seal_resolve', name: 'Resolve', when: gt(STACK_SIZE, num(0)) },
    { id: 'dom_st_seal_foe', name: 'Foe turn', when: THEIR_TURN },
    { id: 'dom_st_seal_action', name: 'Action', when: IN_ACTION },
    { id: 'dom_st_seal_buy', name: 'Buy', when: IN_BUY },
  ];
}

// --- screen-layout touch-ups ----------------------------------------------------

type ZoneEl = Extract<ScreenElement, { kind: 'zone' }>;
type TextEl = Extract<ScreenElement, { kind: 'text' }>;

function patchZoneEl(elements: ScreenElement[], id: string, patch: Partial<ZoneEl>): void {
  for (const el of elements) {
    if (el.id === id && el.kind === 'zone') Object.assign(el, patch);
    const kids = el.kind === 'group' ? el.children : el.children ?? [];
    if (kids.length > 0) patchZoneEl(kids, id, patch);
  }
}

function patchTextEl(elements: ScreenElement[], id: string, patch: Partial<TextEl>): void {
  for (const el of elements) {
    if (el.id === id && el.kind === 'text') Object.assign(el, patch);
    const kids = el.kind === 'group' ? el.children : el.children ?? [];
    if (kids.length > 0) patchTextEl(kids, id, patch);
  }
}

/** Visit the element with this id anywhere in the tree (mutate in place). */
function patchEl(elements: ScreenElement[], id: string, visit: (el: ScreenElement) => void): void {
  for (const el of elements) {
    if (el.id === id) visit(el);
    const kids = el.kind === 'group' ? el.children : el.children ?? [];
    if (kids.length > 0) patchEl(kids, id, visit);
  }
}

/** Remove the element with this id anywhere in the tree. */
function removeEl(elements: ScreenElement[], id: string): void {
  const i = elements.findIndex((e) => e.id === id);
  if (i >= 0) elements.splice(i, 1);
  for (const el of elements) {
    const kids = el.kind === 'group' ? el.children : el.children;
    if (kids !== undefined && kids.length > 0) removeEl(kids, id);
  }
}

/**
 * The round number the TURN ticker shows. The original table numbers ROUNDS
 * (turnNo advances only when play returns to the first seat) while the
 * engine's turnNumber counts every seat's turn, so for this strictly
 * two-seat table: round = floor((turnNumber + 1) / 2), written with the
 * (n − n%2)/2 integer-floor idiom the Gardens recount already uses.
 */
function roundNumberParts(): TextEl['parts'] {
  const next = add(TURN_NUMBER, num(1));
  return ['TURN ', div(sub(next, mod(next, num(2))), num(2))];
}

// Slice filters by NAME so Gardens (a victory-typed kingdom card) stays in
// the kingdom region and Curse joins the victory column, like the original.
const anyName = (names: string[]): Expr => names.map(nameIs).reduce((a, b) => or(a, b));
const IS_BASIC_VICTORY_PILE = anyName(['Estate', 'Duchy', 'Province', 'Curse']);
const IS_KINGDOM_PILE = not(anyName(BASIC_NAMES));

// --- the def -------------------------------------------------------------------

/** Names of every kingdom card the def can put in a supply (validation aid). */
export function kingdomCardNames(def: GameDef): string[] {
  return def.cards.filter((c) => !BASIC_NAME_SET.has(c.name)).map((c) => c.name);
}

/**
 * Build the hall's Dominion def: the Cardsmith example, extended, with the
 * DEFAULT lobby kingdom (First Game) active. Apply pickKingdom for others.
 */
export function buildDominionDef(): GameDef {
  const def = deepClone(dominionGame);

  def.meta = {
    ...def.meta,
    id: DOMINION_GAME_ID,
    name: 'Dominion',
    builtIn: false,
    // The original table is strictly two seats; pile counts match.
    minPlayers: 2,
    maxPlayers: 2,
    description:
      "The hall's flagship table, forged here: the classic deck-builder for two. "
      + 'Buy from a shared supply, grow an engine, and weather Militia raids and '
      + 'midnight Curses — reveal a Moat in the response window to stay safe. '
      + 'The lobby picks one of three kingdom sets; the game ends when the '
      + 'Provinces (or any three piles) run out, and most victory points wins.',
  };

  // New zone: the kingdom reserve (hidden). The old transient PICKROW is
  // gone — choosePile asks straight off the live supply/stock.
  def.zones.push(
    { id: RESERVE, name: 'Reserve', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
  );

  def.variables.push(
    { id: SCRATCH, name: 'Scratch counter', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: GAME_OVER, name: 'Game over pending', scope: 'global', type: 'number', initial: 0, hidden: true },
  );
  // The empty-pile counter (inherited from the example) is bookkeeping too —
  // the table's supply already shows the piles themselves.
  const emptyPilesVar = def.variables.find((v) => v.id === EMPTY_PILES);
  if (emptyPilesVar) emptyPilesVar.hidden = true;

  def.cards.push(...EXTRA_CARDS);

  // Card surgery over the whole catalogue (example clones + the extras):
  // multi-type CTYPE lines, the pretty KIND display field, and the example
  // abilities re-expressed on the draw block + move tags.
  const tpl = def.templates.find((t) => t.id === 'dom_tpl_kingdom');
  if (tpl) {
    tpl.fields.push({ id: KIND_F, name: 'Kind', type: 'text' });
    const typeEl = tpl.elements.find((e) => e.id === 'dom_el_type');
    if (typeEl && typeEl.kind === 'text') typeEl.bind = KIND_F;
  }
  for (const c of def.cards) {
    const ctypeOverride = CTYPE_OVERRIDE[c.name];
    if (ctypeOverride !== undefined) c.fields[CTYPE] = ctypeOverride;
    const ctype = String(c.fields[CTYPE]);
    c.fields[KIND_F] = KIND_LABEL[ctype] ?? ctype;
    const abilities = EXAMPLE_ABILITY_OVERRIDES[c.name];
    if (abilities !== undefined) c.abilities = deepClone(abilities);
  }

  // Decks: basics straight into the supply (original 2-player counts);
  // EVERY kingdom pile into the reserve (setup promotes the active ten).
  // The starter deck (7 Coppers + 3 Estates each) is kept from the example.
  const starter = def.decks.find((d) => d.id === 'dom_deck_starter');
  def.decks = [
    {
      id: 'dom_deck_supply',
      name: 'Basic supply',
      source: {
        kind: 'custom',
        entries: BASIC_PILES.map((p) => ({ cardId: cardIdFor(p.name), count: p.count })),
      },
      initialZone: SUPPLY,
      shuffle: false,
    },
    {
      id: 'dom_deck_kingdom',
      name: 'Kingdom stock',
      source: {
        kind: 'custom',
        entries: KINGDOM_PILES.map((p) => ({ cardId: cardIdFor(p.name), count: p.count })),
      },
      initialZone: RESERVE,
      shuffle: false,
    },
    ...(starter ? [starter] : []),
  ];

  // Setup: promote the default kingdom's piles, then deal opening hands.
  const defaultSet = kingdomById(DEFAULT_KINGDOM_ID);
  def.setup = [
    ...defaultSet.cards.map(kingdomPileBlock),
    forEachPlayer([draw(PLAYER, 5)]),
  ];

  // Actions, re-expressed with cause tags. Playing an action is a 'contains'
  // membership test now (Militia 'action attack' and Moat 'action reaction'
  // both count as actions, like the original's types.includes).
  const play = def.actions.find((a) => a.id === 'dom_action_play');
  if (play) {
    play.legality = allOf(hasType(bnd('$card'), 'action'), gt(getVar(ACTIONS), num(0)));
    play.script = [
      changeVar(ACTIONS, num(-1)),
      announce(CURRENT, ' plays ', bnd('$card'), '.'),
      tmove(specific(bnd('$card')), zone(HAND), zone(INPLAY), 'play', { faceUp: true }),
    ];
  }
  const treasure = def.actions.find((a) => a.id === 'dom_action_treasure');
  if (treasure) {
    treasure.script = [
      changeVar(COINS, field(bnd('$card'), COINS_F)),
      tmove(specific(bnd('$card')), zone(HAND), zone(INPLAY), 'play', { faceUp: true }),
    ];
  }
  const buy = def.actions.find((a) => a.id === 'dom_action_buy');
  if (buy) {
    buy.script = [
      changeVar(COINS, neg(field(CARD, COST))),
      changeVar(BUYS, num(-1)),
      announce(CURRENT, ' buys ', CARD, '.'),
      tmove(specific(CARD), zone(SUPPLY), zone(DISCARD), 'buy', { faceUp: true }),
    ];
  }

  // Cleanup: the sweep is tagged 'cleanup' (the runner's discard-sweep
  // choreography), the redraw is the draw block (tagged 'draw').
  const cleanup = def.phases.find((p) => p.id === 'dom_phase_cleanup');
  if (cleanup) {
    cleanup.onEnter = [
      tmove(ALL, zone(INPLAY), zone(DISCARD), 'cleanup', { faceUp: true }),
      tmove(ALL, zone(HAND), zone(DISCARD), 'cleanup', { faceUp: true }),
      draw(null, 5),
      setVar(ACTIONS, num(1)),
      setVar(BUYS, num(1)),
      setVar(COINS, num(0)),
    ];
  }

  // Triggers: the Gardens-aware recount runs at turn end AND on every
  // tagged 'gain' (Workshop / Remodel / Mine / Witch's Curse) — the old
  // per-site RECOUNT_VP splices are gone. Plain buys recount at turn end
  // (nothing on this table displays live VP mid-turn). IMMUNE resets once,
  // after EVERY attack resolves (effectResolved), so immunity is per-attack
  // without per-card boilerplate. The pile watcher and the end-of-turn
  // judgement keep their exact original timing.
  const recount = def.triggers.find((t) => t.id === 'dom_trigger_vp');
  if (recount) recount.script = deepClone(RECOUNT_VP);
  const watcher = def.triggers.find((t) => t.id === 'dom_trigger_piles');
  if (watcher) watcher.script = pileWatcherScript(defaultSet.cards);
  def.triggers = [
    ...(recount ? [recount] : []),
    {
      id: 'dom_trigger_vp_gain',
      name: 'Recount victory points on a gain',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'gain' },
      condition: null,
      script: deepClone(RECOUNT_VP),
    },
    // End-of-turn timing, matching the original table: engine.js checks the
    // supply only inside endTurn (after cleanup + redraw), never mid-turn.
    // The engine here evaluates endConditions after EVERY settle, so gate
    // them on a pending var that only a turnEnd trigger can raise — placed
    // AFTER the VP recount so the verdict scores the finished turn.
    {
      id: 'dom_trigger_game_over',
      name: 'Judge the supply at turn end',
      event: { kind: 'turnEnd' },
      condition: null,
      script: [
        iff(anyOf(
          eq(countCards(zone(SUPPLY), nameIs('Province')), num(0)),
          gte(getVar(EMPTY_PILES), num(3)),
        ), [setVar(GAME_OVER, num(1))]),
      ],
    },
    ...(watcher ? [watcher] : []),
    {
      id: 'dom_trigger_immune_reset',
      name: 'The attack has resolved — immunity fades',
      event: { kind: 'effectResolved' },
      condition: null,
      script: [forEachPlayer([setVar(IMMUNE, num(0), PLAYER)])],
    },
  ];
  def.endConditions = def.endConditions.map((ec) => ({
    ...ec,
    condition: allOf(gte(getVar(GAME_OVER), num(1)), ec.condition),
  }));

  // Screen layout, to the DGT extraction spec: name-based supply slices with
  // Shift/Ctrl/Alt keyboard groups (+ plain hand digits), the 1.6°/step hand
  // fan, the two appearing in-play rows (own row hides ONLY when the foe is
  // acting AND it is empty; the foe's row floats at the strip's right at
  // 0.82× the table card width), the rebuilt five-state phase seal, the
  // per-move-tag animation table, and TURN tickers that count rounds.
  const layout = def.screenLayout;
  if (layout) {
    patchTextEl(layout.elements, 'dom_el_turn', { parts: roundNumberParts() });
    // Supply slices + keyboard groups; the captions name their modifier keys.
    patchZoneEl(layout.elements, 'dom_el_supply_treasures', { keyGroup: 'shift' });
    patchZoneEl(layout.elements, 'dom_el_supply_victory', {
      cardFilter: IS_BASIC_VICTORY_PILE, rows: 4, cardScale: 4, gap: 0.5, keyGroup: 'ctrl',
    });
    patchZoneEl(layout.elements, 'dom_el_supply_kingdom', {
      cardFilter: IS_KINGDOM_PILE, keyGroup: 'alt',
    });
    patchTextEl(layout.elements, 'dom_el_supply_treasure_label', { text: 'TREASURY · SHIFT' });
    patchTextEl(layout.elements, 'dom_el_supply_victory_label', { text: 'VICTORY · CTRL' });
    patchTextEl(layout.elements, 'dom_el_supply_kingdom_label', { text: 'KINGDOM · ALT' });
    // The hand: always-visible plain digit badges, the original's shallow fan.
    patchZoneEl(layout.elements, 'dom_el_my_hand', { keyGroup: 'plain', fanAngle: 1.6 });
    // Own in-play: visible unless the foe is acting AND the row is empty —
    // the exact original condition (renderPlayRows). No turn-color state:
    // the DGT battlefield row carries no own-turn dressing.
    patchZoneEl(layout.elements, 'dom_el_my_inplay', {
      visible: or(MY_TURN, gt(zoneCount(zone(INPLAY, VIEWER)), num(0))),
      reveal: 'fade',
      states: [],
    });
    // Foe in-play: 0.82× the own-row card width, hanging off the foe strip's
    // right edge (the strip is absolute-positioned, so the row floats where
    // the original's strip would have grown). Visible while the foe acts or
    // still has cards in play — the exact original foePlayWrap condition.
    removeEl(layout.elements, 'dom_el_foe_inplay');
    layout.elements.push({
      kind: 'zone', id: 'dom_el_foe_inplay', name: 'Foe in play',
      rect: { x: 55.5, y: 6.2, w: 27.2, h: 12 },
      zoneId: INPLAY, seat: 'opp1', cardScale: 4.5, gap: 0.5, padding: 0.3, showName: false,
      visible: or(THEIR_TURN, gt(zoneCount(zone(INPLAY, FOE)), num(0))),
      reveal: 'fade',
    });
    // The phase seal, rebuilt to the spec markup with its five render-states.
    patchEl(layout.elements, 'dom_el_seal', (el) => {
      if (el.kind !== 'group') return;
      el.onChangeAnim = 'stamp';
      el.states = sealStates();
      el.children = sealChildren();
    });
    // The original's per-event flight table (motion.byTag): draw 300/22/45ms,
    // play 320/38, buy+gain 340/40/6°, discard & cleanup sweep 320/36/7°/35ms.
    // Untagged moves keep the 430/46 base — which IS the original's default
    // fly (and its foe-play timing); the burn keeps the runner's profile.
    layout.motion = {
      ...(layout.motion ?? {}),
      byTag: {
        draw: { flightMs: 300, arc: 22, spin: 0, staggerMs: 45 },
        play: { flightMs: 320, arc: 38, spin: 0 },
        gain: { flightMs: 340, arc: 40, spin: 6 },
        buy: { flightMs: 340, arc: 40, spin: 6 },
        discard: { flightMs: 320, arc: 36, spin: 7, staggerMs: 35 },
        cleanup: { flightMs: 320, arc: 36, spin: 7, staggerMs: 35 },
      },
    };
    if (layout.mobile) {
      patchTextEl(layout.mobile.elements, 'dom_el_m_turn', { parts: roundNumberParts() });
      // Carousel geometry (verified by rect math at a 375px viewport): the
      // example's 7.8%-tall rows hold ~62px of card room at aspect 0.42,
      // but a cardScale-12 card is ~63px tall BEFORE the carousel's vertical
      // padding and the cost diamond's ~12px overhang — the piles rode over
      // the panel borders. A taller page (aspect 0.38 → these rows ≈ 77px)
      // plus cardScale 10 (37.5×52.5px cards) fits card + diamond + padding
      // inside every frame; dominion-skin.css left-anchors the initial snap.
      layout.mobile.aspect = 0.38;
      patchZoneEl(layout.mobile.elements, 'dom_el_m_supply_victory', {
        cardFilter: IS_BASIC_VICTORY_PILE, display: 'carousel', cardScale: 10,
      });
      patchZoneEl(layout.mobile.elements, 'dom_el_m_supply_kingdom', {
        cardFilter: IS_KINGDOM_PILE, display: 'carousel', cardScale: 10,
      });
      patchZoneEl(layout.mobile.elements, 'dom_el_m_supply_treasures', {
        display: 'carousel', cardScale: 10,
      });
    }
  }

  return def;
}

/**
 * PURE kingdom swap: returns a def whose ACTIVE kingdom supply is exactly
 * `cardNames` (one tagged setup block each), leaving the basic treasure /
 * victory / curse piles — and everything else — alone. Throws on a card
 * name the def doesn't know (e.g. a keeper deleted it in the Forge).
 */
export function pickKingdom(def: GameDef, cardNames: string[]): GameDef {
  const out = deepClone(def);
  const known = new Set(kingdomCardNames(out));
  for (const name of cardNames) {
    if (!known.has(name)) throw new Error(`Unknown kingdom card "${name}".`);
  }
  const keep: Block[] = [];
  let insertAt = -1;
  for (const b of out.setup) {
    if (kingdomPileBlockName(b) === null) keep.push(b);
    else if (insertAt < 0) insertAt = keep.length;
  }
  if (insertAt < 0) insertAt = 0;
  out.setup = [
    ...keep.slice(0, insertAt),
    ...cardNames.map(kingdomPileBlock),
    ...keep.slice(insertAt),
  ];
  const watcher = out.triggers.find((t) => t.id === 'dom_trigger_piles');
  if (watcher) watcher.script = pileWatcherScript(cardNames);
  return out;
}
