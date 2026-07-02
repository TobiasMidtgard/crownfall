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
 * carries the original's per-event animation table. The MOBILE variant is
 * rebuilt to the original's phone design (styles.css ≤45rem): ONE
 * non-scrolling viewport — foe strip with their appearing play row, ONE
 * tabbed supply group (Treasury/Victory/Kingdom tile carousels), the
 * battlefield band with the compact seal (no keyboard hint), the hand fan,
 * the harbor spots, and the chronicle as a collapsible bottom sheet.
 *
 * Every choice a script can open always has at least one candidate (guarded
 * by iff) or is optional, so the random session AI can never hang on one.
 */
import type {
  AbilityDef, Block, CardDef, CardSelector, Expr, GameDef, LayoutStyle, ScreenElement,
  ScreenVariant, ZoneRef,
} from '../shared/types';
import { deepClone } from '../shared/defaults';
import { dominionGame } from '../examples/dominion';
import {
  ALL, CURRENT, END_PHASE, STACK_SIZE, TURN_NUMBER, add, allOf, announce, anyOf, bnd, bestCard,
  changeVar, chooseCard, chooseCardsBlock, countCards, eq, field, forEachPlayer, getVar, gt, gte,
  iff, lte, move, mul, neg, neq, nextPlayer, not, num, or, setVar, specific, str, sub, zone, zoneCount,
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
const PHASE_CLEANUP = 'dom_phase_cleanup';

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
  /** Show the representatives' faces to the chooser even in a hidden zone. */
  revealed?: boolean;
  body: Block[];
}): Block {
  return {
    kind: 'choosePile', who: opts.who ?? null, from: opts.from, filter: opts.filter ?? null,
    groupBy: 'def', prompt: opts.prompt, optional: opts.optional ?? false,
    revealed: opts.revealed ?? false, body: opts.body,
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
            // RESERVE is visibility 'none': without the reveal the sheet
            // renders indistinguishable card backs and the buy is blind.
            revealed: true,
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
const IN_CLEANUP: Expr = { kind: 'phaseIs', phaseId: PHASE_CLEANUP };

// The harbor spots show only when they hold cards (deck/discard are the
// viewer's; the trash is shared) — no empty boxes standing around.
const HAS_DECK = gt(zoneCount(zone(DECK, VIEWER)), num(0));
const HAS_DISCARD = gt(zoneCount(zone(DISCARD, VIEWER)), num(0));
const HAS_TRASH = gt(zoneCount(zone(TRASH)), num(0));

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
const SEAL_CLEANUP = allOf(not(GAME_IS_OVER), STACK_QUIET, MY_TURN, IN_CLEANUP);

// Palette — hex approximations of the reference table's OKLCH tokens.
const INK = '#ece4d8';
const ASH = '#a89484';
const GOLD = '#d2ab66';
const BONE_FAINT = 'rgba(236, 228, 216, 0.45)';
const BONE_SOFT = 'rgba(236, 228, 216, 0.85)';

// --- the phase seal (rebuilt to the DGT spec markup) ---------------------------

/** Rect of a seal child, % of the seal group's box. */
interface SealRect { x: number; y: number; w: number; h: number }

/**
 * A 5px lozenge phase dot: translucent bone outline, filled solid bone while
 * its phase is current ON the viewer's live turn (the DGT seal lights no dot
 * during resolve / foe turn / game over — data-phase isn't 'action'/'buy').
 */
function sealDot(id: string, name: string, phaseId: string, rect: SealRect): ScreenElement {
  return {
    kind: 'shape', id, name, shape: 'diamond',
    rect,
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
  id: string, label: string, when: Expr, color: string,
  rect: SealRect, fontSize: number, parts?: (string | Expr)[],
): ScreenElement {
  return {
    kind: 'text', id, name: `Seal name — ${label !== '' ? label : 'foe'}`,
    rect,
    text: label, ...(parts !== undefined ? { parts } : {}),
    fontSize, bold: false, align: 'left', color,
    visible: when,
  };
}

/** The seal's hint line (uppercase microcopy), one element per render-state. */
function sealHint(
  id: string, label: string, when: Expr, color: string,
  rect: SealRect, fontSize: number,
): ScreenElement {
  return {
    kind: 'text', id, name: `Seal hint — ${label}`,
    rect,
    text: label, fontSize, bold: false, align: 'left', color,
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
 *
 * `m` builds the MOBILE seal to the spec's "Mobile (≤45rem)" line: the box
 * is tighter (the group rect), the name reads 1.05rem (fontSize is % of the
 * SCREEN width — the phone stage is ~390px wide, so 4.3% ≈ 16.8px) and the
 * keyboard hint is GONE (`.phase-key { display: none; }` — useTableKeyboard
 * is inert below the narrow breakpoint anyway). Ids gain the m_ prefix so
 * both trees stay addressable.
 */
function sealChildren(m: boolean): ScreenElement[] {
  const id = (s: string) => (m ? `dom_el_m_seal_${s}` : `dom_el_seal_${s}`);
  const nameFs = m ? 4.3 : 1.45;
  const hintFs = m ? 2.4 : 0.62;
  // % of the seal group's box: the mobile group is ~148×56px vs the
  // desktop's ~185×136px, so the same 5px dot / text line needs different
  // percentages there.
  const dotY = m ? 8 : 13;
  const dotW = m ? 3.4 : 3.2;
  const dotH = m ? 9 : 4.6;
  const dot1X = 9;
  const dotGap = m ? 5.4 : 4.8;
  const dot2X = dot1X + dotGap;
  const dot3X = dot1X + dotGap * 2;
  const nameRect: SealRect = m
    ? { x: 9, y: 22, w: 82, h: 42 }
    : { x: 9, y: 24, w: 82, h: 26 };
  const hintRect: SealRect = m
    ? { x: 9, y: 68, w: 82, h: 20 }
    : { x: 9, y: 54, w: 82, h: 11 };
  const foeName: ScreenElement = {
    ...sealName(id('name_foe'), '', SEAL_FOE, ASH, nameRect, nameFs, [FOE]),
    // The foe's name breathes while he thinks (2.6s loop while the state
    // holds). 'breathe' is runner-live but not yet in the stored union —
    // see the wave-1 runner report; the cast is the documented bridge.
    onChangeAnim: 'breathe',
    states: [{
      id: m ? 'dom_st_m_seal_foe_breathe' : 'dom_st_seal_foe_breathe',
      name: 'Foe thinking', when: SEAL_FOE,
    }],
  };
  return [
    // The plate: full-size buttons, phase-gated (End turn also covers the
    // momentary auto Cleanup so the plate never vanishes). Labels are read
    // by AT; visually the overlay texts below carry the seal's face.
    // One plate button per phase (exactly one is visible at a time — the
    // three phases partition the turn). Labels are read by AT; the overlay
    // texts below carry the seal's visible face.
    {
      kind: 'button', id: id('btn_done'), name: 'Done (end actions)',
      rect: { x: 0, y: 0, w: 100, h: 100 },
      actionId: 'dom_action_done', label: 'Done — to the buy phase', fontSize: 1,
      visible: IN_ACTION,
    },
    {
      kind: 'button', id: id('btn_end'), name: 'Done buying (to cleanup)',
      rect: { x: 0, y: 0, w: 100, h: 100 },
      actionId: 'dom_action_end_turn', label: 'Done buying — to cleanup', fontSize: 1,
      visible: IN_BUY,
    },
    {
      kind: 'button', id: id('btn_cleanup'), name: 'Clean up and end the turn',
      rect: { x: 0, y: 0, w: 100, h: 100 },
      actionId: 'dom_action_cleanup', label: 'End turn', fontSize: 1,
      visible: IN_CLEANUP,
    },
    // The three phase dots — Action, Buy, Cleanup.
    sealDot(id('dot_action'), 'Action dot', PHASE_ACTION, { x: dot1X, y: dotY, w: dotW, h: dotH }),
    sealDot(id('dot_buy'), 'Buy dot', PHASE_BUY, { x: dot2X, y: dotY, w: dotW, h: dotH }),
    sealDot(id('dot_cleanup'), 'Cleanup dot', PHASE_CLEANUP, { x: dot3X, y: dotY, w: dotW, h: dotH }),
    // Name line, six render-states.
    sealName(id('name_action'), 'Action', SEAL_ACTION, INK, nameRect, nameFs),
    sealName(id('name_buy'), 'Buy', SEAL_BUY, INK, nameRect, nameFs),
    sealName(id('name_cleanup'), 'Cleanup', SEAL_CLEANUP, INK, nameRect, nameFs),
    foeName,
    sealName(id('name_resolve'), 'Resolve', SEAL_RESOLVE, ASH, nameRect, nameFs),
    sealName(id('name_fallen'), 'Fallen', GAME_IS_OVER, INK, nameRect, nameFs),
    // Hint line, matching microcopy (uppercase, engraved via size/color).
    sealHint(id('hint_action'), 'TO BUY', SEAL_ACTION, BONE_SOFT, hintRect, hintFs),
    sealHint(id('hint_buy'), 'TO CLEANUP', SEAL_BUY, BONE_SOFT, hintRect, hintFs),
    sealHint(id('hint_cleanup'), 'END TURN', SEAL_CLEANUP, BONE_SOFT, hintRect, hintFs),
    sealHint(id('hint_foe'), 'TAKES THEIR TURN', SEAL_FOE, ASH, hintRect, hintFs),
    sealHint(id('hint_resolve'), 'RESPOND BELOW', SEAL_RESOLVE, ASH, hintRect, hintFs),
    sealHint(id('hint_fallen'), 'MATCH OVER', GAME_IS_OVER, BONE_SOFT, hintRect, hintFs),
    // The keyboard hint (the runner's primary-action key is Enter) — DESKTOP
    // ONLY, per the spec's mobile seal. A labeled rect SHAPE rather than a
    // text element: the def language can't see device capabilities, and the
    // label span (.rn-sl-shapelabel) is the seal's only class-reachable
    // hook — dominion-skin.css uses it to hide the chip under (hover: none),
    // where useTableKeyboard never attaches and ENTER would advertise a dead
    // key. Painted result is unchanged (the border box moves from the
    // wrapper's inline style to the shape).
    ...(m ? [] : [{
      kind: 'shape', id: id('key'), name: 'Seal key hint', shape: 'rect',
      rect: { x: 73, y: 38, w: 18, h: 22 },
      label: 'ENTER', fontSize: 0.55,
      style: {
        background: 'transparent',
        borderColor: 'rgba(236, 228, 216, 0.4)', borderWidth: 1, borderRadius: 2,
      },
      visible: SEAL_MINE,
    } satisfies ScreenElement]),
  ];
}

/**
 * The seal group's states: no styling of their own (the skin paints off the
 * runner root's data attributes) — they exist so the resolved state CHANGES
 * with every phase/turn/stack transition, which retriggers the group's
 * 'stamp' onChangeAnim (the DGT seal-stamp on every renderPhase).
 */
function sealStates(m: boolean): NonNullable<ScreenElement['states']> {
  const id = (s: string) => (m ? `dom_st_m_seal_${s}` : `dom_st_seal_${s}`);
  return [
    { id: id('over'), name: 'Fallen', when: GAME_IS_OVER },
    { id: id('resolve'), name: 'Resolve', when: gt(STACK_SIZE, num(0)) },
    { id: id('foe'), name: 'Foe turn', when: THEIR_TURN },
    { id: id('action'), name: 'Action', when: IN_ACTION },
    { id: id('buy'), name: 'Buy', when: IN_BUY },
    { id: id('cleanup'), name: 'Cleanup', when: IN_CLEANUP },
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

// --- the mobile variant (the original's pocket table, ≤45rem) -------------------

// Warm-black panel chrome, hex twins of the war table's PANEL/PILE_PANEL.
const M_PANEL: LayoutStyle = {
  background: '#211816', borderColor: '#453530', borderWidth: 1,
  borderStyle: 'solid', borderRadius: 10,
};
const M_GROUND: LayoutStyle = {
  background: '#2b201c', borderColor: '#453530', borderWidth: 1,
  borderStyle: 'solid', borderRadius: 8,
};
const M_TRASH: LayoutStyle = {
  background: 'rgba(163, 52, 46, 0.06)', borderColor: '#453530', borderWidth: 1,
  borderStyle: 'dashed', borderRadius: 8,
};

/** Engraved micro-caption under a ticker value. */
function mLabel(id: string, text: string, x: number, y: number, w: number): ScreenElement {
  return {
    kind: 'text', id, name: text, rect: { x, y, w, h: 1.6 },
    text, fontSize: 1.9, bold: false, align: 'center', color: ASH,
  };
}

/**
 * One panel of the tabbed supply: a group named EXACTLY like its tab label
 * (the runner's tab bar reads the direct children's names), holding that
 * slice's carousel of DGT pile tiles. The panel fills the group — the
 * runner's tabbed chrome owns the bar and seats the active panel under it.
 * Digit badges 1–9/0 ride the keyGroup (Shift/Ctrl/Alt, like the desktop
 * slices), and the held modifier flips the group to this panel.
 */
function mSupplyPanel(
  panelId: string, label: string, zoneElId: string,
  filter: Expr, keyGroup: 'shift' | 'ctrl' | 'alt',
): ScreenElement {
  return {
    kind: 'group', id: panelId, name: label,
    rect: { x: 0, y: 0, w: 100, h: 100 },
    children: [{
      kind: 'zone', id: zoneElId, name: `Supply — ${label.toLowerCase()}`,
      rect: { x: 0, y: 0, w: 100, h: 100 },
      zoneId: SUPPLY, seat: 'shared', display: 'carousel', pileFace: 'tile',
      cardFilter: filter, pileBadgeField: COST, keyGroup,
      // Tile width, % of the ~390px phone stage: 18% ≈ 70px — the original
      // makePile anatomy, sized so the tile (aspect 59/91 ≈ 108px tall) clears
      // the ~150px carousel with headroom. Treasury (3 piles) and Victory (4)
      // fit the frame without scrolling; Kingdom's ten swipe with scroll-snap
      // (dominion-skin.css anchors the snap at 'start', opening ON the first).
      cardScale: 18, gap: 2.5, showName: false,
    }],
  };
}

/**
 * The mobile variant, rebuilt to the ORIGINAL's phone design (styles.css
 * `@media (max-width: 45rem)`): ONE non-scrolling viewport. aspect null +
 * scroll false stretch the stage over the whole screen ("the pocket table
 * never scrolls: it fits, or it shrinks"), and the rects budget the height
 * the way the original's flex column did. Top to bottom:
 *   - the compact foe strip — banner, deck/hand/discard tallies, and THEIR
 *     play row appearing at the right (0.7× cards, the foePlayWrap rule);
 *   - the TABBED supply: one panel at a time behind a notched tab bar
 *     (Treasury / Victory / Kingdom tile carousels);
 *   - the battlefield band: TURN + tickers left, the compact seal right
 *     (no keyboard hint), and the appearing in-play row;
 *   - the hand fan (thumb-reachable, plain digit badges);
 *   - the harbor's compact deck / discard / trash spots;
 *   - the chronicle as a bottom sheet behind a docked toggle (the runner's
 *     collapsible, side 'bottom' — the closest generic shape of the
 *     original's 70dvh slide-up sheet; it opens over ~73% of the screen).
 */
function buildMobileScreen(): ScreenVariant {
  return {
    background: 'linear-gradient(180deg, #211816 0%, #171110 32%, #120d0c 100%)',
    aspect: null,
    scroll: false,
    elements: [
      // --- foe strip (~0-8%) --------------------------------------------------
      {
        kind: 'group', id: 'dom_el_m_foe', name: 'Foe strip',
        rect: { x: 1.5, y: 0.7, w: 97, h: 7 },
        style: M_PANEL,
        states: [{
          id: 'dom_st_m_foe_their_turn', name: 'Their turn', when: THEIR_TURN,
          style: { background: '#2b201c', borderColor: '#a3342e' },
        }],
        children: [
          {
            kind: 'text', id: 'dom_el_m_foe_name', name: 'Foe name',
            rect: { x: 2, y: 22, w: 22, h: 56 },
            text: '', parts: [FOE], fontSize: 3.1, bold: true, align: 'left', color: INK,
          },
          {
            kind: 'zone', id: 'dom_el_m_foe_deck', name: 'Foe deck',
            rect: { x: 25, y: 6, w: 9, h: 88 },
            zoneId: DECK, seat: 'opp1', cardScale: 4, showName: false, showCount: true,
          },
          {
            kind: 'zone', id: 'dom_el_m_foe_hand', name: 'Foe hand',
            rect: { x: 35.5, y: 6, w: 16, h: 88 },
            zoneId: HAND, seat: 'opp1', cardScale: 4, fanAngle: 0, gap: 0.8, showName: false,
          },
          {
            kind: 'zone', id: 'dom_el_m_foe_discard', name: 'Foe discard',
            rect: { x: 53, y: 6, w: 9, h: 88 },
            zoneId: DISCARD, seat: 'opp1', cardScale: 4, showName: false, showCount: true,
          },
          // Their play row: 0.70× the in-play card (the original's mobile
          // .foe-play factor), right-aligned, APPEARING exactly like the
          // original foePlayWrap — while the foe acts or still has cards out.
          {
            kind: 'zone', id: 'dom_el_m_foe_inplay', name: 'Foe in play',
            rect: { x: 63.5, y: 4, w: 34.5, h: 92 },
            zoneId: INPLAY, seat: 'opp1', cardScale: 7, gap: 0.5, padding: 0.3, showName: false,
            visible: or(THEIR_TURN, gt(zoneCount(zone(INPLAY, FOE)), num(0))),
            reveal: 'fade',
          },
        ],
      },
      // --- the TABBED supply (~8-38%): one panel at a time --------------------
      {
        kind: 'group', id: 'dom_el_m_supply', name: 'Supply',
        rect: { x: 1.5, y: 8.4, w: 97, h: 29.8 },
        tabbed: true,
        children: [
          mSupplyPanel('dom_el_m_tab_treasury', 'Treasury', 'dom_el_m_supply_treasures', IS_TREASURE_CARD, 'shift'),
          mSupplyPanel('dom_el_m_tab_victory', 'Victory', 'dom_el_m_supply_victory', IS_BASIC_VICTORY_PILE, 'ctrl'),
          mSupplyPanel('dom_el_m_tab_kingdom', 'Kingdom', 'dom_el_m_supply_kingdom', IS_KINGDOM_PILE, 'alt'),
        ],
      },
      // --- battlefield band (~39-49%): TURN, tickers, the compact seal --------
      {
        kind: 'text', id: 'dom_el_m_turn', name: 'Turn counter',
        rect: { x: 2, y: 39.4, w: 30, h: 2.4 },
        text: '', parts: roundNumberParts(),
        fontSize: 2.8, bold: true, align: 'left', color: GOLD,
        onChangeAnim: 'flash',
      },
      {
        kind: 'varText', id: 'dom_el_m_counter_actions', name: 'Actions ticker',
        rect: { x: 2, y: 42.6, w: 9, h: 3.6 },
        varId: ACTIONS, seat: 'viewer', fontSize: 4.2, bold: true, align: 'center', color: INK,
        ticker: true,
      },
      mLabel('dom_el_m_counter_actions_label', 'ACTIONS', 2, 46.6, 9),
      {
        kind: 'varText', id: 'dom_el_m_counter_buys', name: 'Buys ticker',
        rect: { x: 13, y: 42.6, w: 9, h: 3.6 },
        varId: BUYS, seat: 'viewer', fontSize: 4.2, bold: true, align: 'center', color: INK,
        ticker: true,
      },
      mLabel('dom_el_m_counter_buys_label', 'BUYS', 13, 46.6, 9),
      {
        kind: 'varText', id: 'dom_el_m_counter_coins', name: 'Coins ticker',
        rect: { x: 24, y: 42.6, w: 9, h: 3.6 },
        varId: COINS, seat: 'viewer', fontSize: 4.2, bold: true, align: 'center', color: GOLD,
        ticker: true,
      },
      mLabel('dom_el_m_counter_coins_label', 'COINS', 24, 46.6, 9),
      // The compact seal (spec "Mobile (≤45rem)": tighter box, 1.05rem name,
      // no key hint) — same five render-states, same stamp on every change.
      {
        kind: 'group', id: 'dom_el_m_seal', name: 'Phase seal',
        rect: { x: 60, y: 39.4, w: 38, h: 8.6 },
        onChangeAnim: 'stamp',
        states: sealStates(true),
        children: sealChildren(true),
      },
      // Own in-play: visible on your turn even empty; hidden only while the
      // foe acts AND the row is empty — the exact renderPlayRows condition.
      {
        kind: 'zone', id: 'dom_el_m_inplay', name: 'Your in play',
        rect: { x: 1.5, y: 49.4, w: 97, h: 9.8 },
        zoneId: INPLAY, seat: 'viewer', cardScale: 10, gap: 1, padding: 0.5,
        showName: false, style: M_GROUND,
        visible: or(MY_TURN, gt(zoneCount(zone(INPLAY, VIEWER)), num(0))),
        reveal: 'fade',
      },
      // --- the hand fan (~60-79%) ---------------------------------------------
      // Full card faces (only supply piles wear tiles); the 14%-of-width gap
      // keeps ~55px of every stack visible, so a five-stack hand needs no
      // horizontal scrolling at 390px.
      {
        kind: 'zone', id: 'dom_el_m_hand', name: 'Your hand',
        rect: { x: 1.5, y: 59.8, w: 97, h: 19 },
        zoneId: HAND, seat: 'viewer', cardScale: 16, fanAngle: 1.6, collapseDuplicates: true,
        gap: 14, showName: false, keyGroup: 'plain',
      },
      // --- the harbor (~80-90%): compact deck / discard / trash spots ---------
      // The harbor spots appear only when they hold cards (the original's
      // "a zone shows up when it first gains content") — no empty deck /
      // discard / trash boxes cluttering the table.
      {
        kind: 'zone', id: 'dom_el_m_deck', name: 'Your deck',
        rect: { x: 2, y: 79.6, w: 22, h: 10.4 },
        zoneId: DECK, seat: 'viewer', cardScale: 7.5, showName: true, showCount: true,
        style: M_GROUND, visible: HAS_DECK, reveal: 'fade',
      },
      {
        kind: 'zone', id: 'dom_el_m_discard', name: 'Your discard',
        rect: { x: 26, y: 79.6, w: 22, h: 10.4 },
        zoneId: DISCARD, seat: 'viewer', cardScale: 7.5, showName: true, showCount: true,
        style: M_GROUND, visible: HAS_DISCARD, reveal: 'fade',
      },
      {
        kind: 'zone', id: 'dom_el_m_trash', name: 'Trash',
        rect: { x: 74, y: 79.6, w: 24, h: 10.4 },
        zoneId: TRASH, seat: 'shared', cardScale: 7.5, showName: true, showCount: true,
        arriveEffect: 'burn', style: M_TRASH, visible: HAS_TRASH, reveal: 'fade',
      },
      // --- the chronicle: a bottom sheet behind a docked toggle ---------------
      // Collapsed (the default) it is ONLY the bottom-center tab — the strip
      // below the harbor stays clear for it. Open, it slides over ~73% of
      // the screen, the nearest collapsible gets to the original's 70dvh.
      {
        kind: 'log', id: 'dom_el_m_log', name: 'Chronicle',
        rect: { x: 0, y: 27, w: 100, h: 73 },
        fontSize: 3.2, turnSeparators: true,
        style: { background: '#211816', borderColor: '#453530', borderWidth: 1, borderRadius: 0 },
        collapsible: { side: 'bottom', label: 'Chronicle', startCollapsed: true },
      },
    ],
  };
}

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

  // Cleanup is its own MANUAL phase now (Action → Buy → Cleanup, three dots on
  // the seal): entering it leaves your played cards and hand on the table to
  // review; the seal's "End turn" fires dom_action_cleanup, which sweeps them
  // to the discard (tagged 'cleanup'), redraws five (the draw block, tagged
  // 'draw'), resets the counters, and ends the phase — which, being the last
  // phase, passes the turn (so the turnEnd VP recount + supply judgement keep
  // their exact timing).
  const cleanupSweep: Block[] = [
    tmove(ALL, zone(INPLAY), zone(DISCARD), 'cleanup', { faceUp: true }),
    tmove(ALL, zone(HAND), zone(DISCARD), 'cleanup', { faceUp: true }),
    draw(null, 5),
    setVar(ACTIONS, num(1)),
    setVar(BUYS, num(1)),
    setVar(COINS, num(0)),
  ];
  const cleanup = def.phases.find((p) => p.id === PHASE_CLEANUP);
  if (cleanup) {
    cleanup.mode = 'manual';
    cleanup.actionIds = ['dom_action_cleanup'];
    cleanup.onEnter = [];
  }
  def.actions.push({
    id: 'dom_action_cleanup',
    name: 'Clean up',
    target: { kind: 'none' },
    legality: null,
    script: [...cleanupSweep, END_PHASE],
  });

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
    // The kingdom wears the DGT compact pile TILE on desktop too — the
    // original's desktop kingdom was a 5×2 grid of makePile plates (name,
    // cost lozenge, × count; --pile-w-k), not full card faces. cardScale
    // 6.5 (~91px at a 1400px stage) reaches the original's clamp band while
    // two tile rows still fit the unchanged panel rect. Treasury/Victory
    // stay card-faced: the original's desktop basics were MINI CARDS (§5.3).
    patchZoneEl(layout.elements, 'dom_el_supply_kingdom', {
      cardFilter: IS_KINGDOM_PILE, keyGroup: 'alt', pileFace: 'tile', cardScale: 6.5,
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
    // The harbor spots (and their captions) appear only when they hold cards —
    // no empty deck / discard / trash boxes standing around.
    patchZoneEl(layout.elements, 'dom_el_my_deck', { visible: HAS_DECK, reveal: 'fade' });
    patchTextEl(layout.elements, 'dom_el_my_deck_label', { visible: HAS_DECK });
    patchZoneEl(layout.elements, 'dom_el_my_discard', { visible: HAS_DISCARD, reveal: 'fade' });
    patchTextEl(layout.elements, 'dom_el_my_discard_label', { visible: HAS_DISCARD });
    patchZoneEl(layout.elements, 'dom_el_trash', { visible: HAS_TRASH, reveal: 'fade' });
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
      el.states = sealStates(false);
      el.children = sealChildren(false);
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
    // The mobile variant is REBUILT, not patched: the example's tall scroll
    // page (aspect 0.38) buried the supply carousels down a scrolling column
    // — the original's phone design is one fixed viewport. buildMobileScreen
    // authors the whole pocket table (tabbed supply, compact seal, chronicle
    // sheet) from scratch.
    layout.mobile = buildMobileScreen();
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
