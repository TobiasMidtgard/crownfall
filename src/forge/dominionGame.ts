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
 *   - the card catalogue speaks the REAL type/tag vocabulary now (spec A):
 *     types Treasure / Victory / Curse / Action, tags Attack / Reaction /
 *     Kingdom / Basic, the named filter "The basic cards" — and every
 *     condition reads cardTypeIs / cardHasTag / filterRef instead of the
 *     retired dom_field_ctype text field (dom_field_kind still carries the
 *     pretty "Action – Attack" display line);
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
 * non-scrolling viewport — foe strip with their appearing play row, the
 * supply switcher (three DESIGNED selector buttons over one bound
 * Treasury/Victory/Kingdom tile carousel at a time — spec B §2), the
 * battlefield band with the compact seal (no keyboard hint), the hand fan
 * and the harbor spots. The chronicle elements are GONE from both variants
 * (spec B §3): the runner's Log drawer is the one history, and the status
 * bar peeks (screenLayout.statusBar 'peek') instead of pinning.
 *
 * Every choice a script can open always has at least one candidate (guarded
 * by iff) or is optional, so the random session AI can never hang on one.
 */
import type {
  AbilityDef, Block, CardDef, CardSelector, CardTypeDef, Expr, GameDef, LayoutStyle,
  ScreenElement, ScreenVariant, TagDef, ZoneRef,
} from '../shared/types';
import { deepClone } from '../shared/defaults';
import { dominionGame } from '../examples/dominion';
import {
  ALL, CURRENT, END_PHASE, STACK_SIZE, TURN_NUMBER, add, allOf, announce, anyOf, bnd, bestCard,
  changeVar, chooseCard, chooseCardsBlock, countCards, discardDownTo, eq, field, forEachOpponent,
  forEachPlayer, getVar, gt, gte,
  iff, lte, move, mul, neg, neq, nextPlayer, not, num, or, setVar, specific, str, sub, zone, zoneCount,
} from '../examples/dsl';
import { DEFAULT_KINGDOM_ID, kingdomById } from '../shared/kingdoms';
import { DOMINION_GAME_ID } from './seedDominion';
import type { CardKit, PileSpec } from './dominion/kit';
import { EXPANSIONS } from './dominion/expansions';

// --- ids (dom_* ids are cloned from the example, new ones join the family) ---

const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';
const DECK = 'dom_zone_deck';
const HAND = 'dom_zone_hand';
const DISCARD = 'dom_zone_discard';
const INPLAY = 'dom_zone_inplay';
/** Unpicked kingdom piles wait here; doubles as the Black Market's stock. */
const RESERVE = 'dom_zone_reserve';
/** Shared staging for look-at / set-aside effects (Sentry, Bandit, Library). */
const LOOK = 'dom_zone_look';

const ACTIONS = 'dom_var_actions';
const BUYS = 'dom_var_buys';
const COINS = 'dom_var_coins';
const VP = 'dom_var_vp';
const IMMUNE = 'dom_var_immune';
const EMPTY_PILES = 'dom_var_empty_piles';
/** Per-player scratch number (Cellar's discard count, Remodel/Mine's cost cap). */
const SCRATCH = 'dom_var_scratch';
/** Global cost reduction this turn (Bridge); reset at cleanup. Costs floor at 0. */
const DISCOUNT = 'dom_var_cost_discount';
/** Set at turn end when the supply says the game is over (see buildDominionDef). */
const GAME_OVER = 'dom_var_game_over';

const COST = 'dom_field_cost';
/**
 * The RETIRED machine-type text field: conditions read the real type/tag
 * vocabulary now and the face renders KIND_F, so buildDominionDef scrubs
 * this field (definition + every value) from the cloned example wholesale —
 * it would be data feeding nothing.
 */
const CTYPE = 'dom_field_ctype';
const COINS_F = 'dom_field_coins';
const VP_F = 'dom_field_vp';
const TEXT = 'dom_field_text';
/** Display-only type line ("Action – Attack"), derived from typeId + tags. */
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

// --- the type/tag vocabulary (spec A §Dominion migration) ----------------------

/**
 * MOAT DECISION — the original card is "Action – Reaction", but a card here
 * has exactly ONE primary type (CardDef.typeId). Moat's primary type is
 * Action (Throne Room can play it, it costs an action to play), so Reaction
 * rides as a TAG and the spec's Reaction TYPE is dropped from the list:
 * nothing could ever carry it as a primary without ceasing to be an Action.
 * The reveal-Moat legality checks the tag; later slices (attack warnings,
 * reaction prompts) key off the same tag.
 *
 * DURATION — the spec reserves a Duration tag, but validateGameDef warns on
 * defined-but-unused tags and this def ships validating with ZERO warnings,
 * so the tag is NOT pre-declared: slice D introduces it together with the
 * first Duration card (adding a tag is one row in the Types & tags panel).
 */
const TYPE_TREASURE = 'dom_type_treasure';
const TYPE_VICTORY = 'dom_type_victory';
const TYPE_CURSE = 'dom_type_curse';
const TYPE_ACTION = 'dom_type_action';
const TAG_ATTACK = 'dom_tag_attack';
const TAG_REACTION = 'dom_tag_reaction';
const TAG_KINGDOM = 'dom_tag_kingdom';
const TAG_BASIC = 'dom_tag_basic';
/** The named filter "The basic cards" (condition: card has tag Basic). */
const FILTER_BASIC = 'dom_filter_basic';

/** Type accents = hex twins of the skin's OKLCH palette (aurum / verdict / umbra / bone). */
const CARD_TYPES: CardTypeDef[] = [
  { id: TYPE_TREASURE, name: 'Treasure', color: '#d2ab66' },
  { id: TYPE_VICTORY, name: 'Victory', color: '#4f9e63' },
  { id: TYPE_CURSE, name: 'Curse', color: '#9460b7' },
  { id: TYPE_ACTION, name: 'Action', color: '#ece4d8' },
];
const CARD_TAGS: TagDef[] = [
  { id: TAG_ATTACK, name: 'Attack' },
  { id: TAG_REACTION, name: 'Reaction' },
  { id: TAG_KINGDOM, name: 'Kingdom' },
  { id: TAG_BASIC, name: 'Basic' },
];

const isA = (card: Expr, typeId: string): Expr => ({ kind: 'cardTypeIs', card, typeId });
const hasTag = (card: Expr, tagId: string): Expr => ({ kind: 'cardHasTag', card, tagId });
const matchesFilter = (filterId: string, card: Expr): Expr => ({ kind: 'filterRef', filterId, card });

const IS_ACTION_CARD = isA(CARD, TYPE_ACTION);
const IS_TREASURE_CARD = isA(CARD, TYPE_TREASURE);

// --- the supply catalogue (build-time truth for counts / watcher) -------------
// PileSpec now lives in dominion/kit.ts (expansion modules speak it too).

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
  // Expansion modules contribute the rest (Base 2E remainder, Intrigue 2E…).
  ...EXPANSIONS.flatMap((x) => x.piles),
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

const EXPANSION_CARD_ID: Record<string, string> = Object.assign({}, ...EXPANSIONS.map((x) => x.ids));

const cardIdFor = (name: string): string =>
  NEW_CARD_ID[name] ?? EXAMPLE_CARD_ID[name] ?? EXPANSION_CARD_ID[name];

// --- per-card type lines (typeId + tags, built from the pile catalogues) -------

interface TypeLine { typeId: string; tags: string[] }

/**
 * Every card's type line: basics wear Basic (treasure piles → Treasure,
 * Curse → Curse, the rest → Victory); kingdom cards wear Kingdom (Gardens is
 * victory-TYPED but stays a kingdom card, exactly like the original);
 * Militia/Witch add Attack, Moat adds Reaction (see the MOAT DECISION note).
 */
const TYPE_LINE: Record<string, TypeLine> = {};
for (const p of BASIC_PILES) {
  TYPE_LINE[p.name] = {
    typeId: p.treasure === true ? TYPE_TREASURE : p.name === 'Curse' ? TYPE_CURSE : TYPE_VICTORY,
    tags: [TAG_BASIC],
  };
}
// Type-line membership: the module's own attacks/reactions plus expansion
// contributions. Primary types default to Action; Gardens-style victory
// cards and Harem-style treasures are named explicitly.
const ATTACK_NAMES = new Set(['Militia', 'Witch', ...EXPANSIONS.flatMap((x) => x.attackNames ?? [])]);
const REACTION_NAMES = new Set(['Moat', ...EXPANSIONS.flatMap((x) => x.reactionNames ?? [])]);
const VICTORY_NAMES = new Set(['Gardens', ...EXPANSIONS.flatMap((x) => x.victoryNames ?? [])]);
const TREASURE_NAMES = new Set(EXPANSIONS.flatMap((x) => x.treasureNames ?? []));
for (const p of KINGDOM_PILES) {
  const tags = [TAG_KINGDOM];
  if (ATTACK_NAMES.has(p.name)) tags.push(TAG_ATTACK);
  if (REACTION_NAMES.has(p.name)) tags.push(TAG_REACTION);
  TYPE_LINE[p.name] = {
    typeId: VICTORY_NAMES.has(p.name) ? TYPE_VICTORY
      : TREASURE_NAMES.has(p.name) ? TYPE_TREASURE
        : TYPE_ACTION,
    tags,
  };
}

/** The pretty display line for KIND_F: "Treasure", "Action – Attack"… */
function kindLabelFor(line: TypeLine): string {
  const typeName = CARD_TYPES.find((t) => t.id === line.typeId)!.name;
  const extras = line.tags
    .filter((t) => t === TAG_ATTACK || t === TAG_REACTION)
    .map((t) => CARD_TAGS.find((d) => d.id === t)!.name);
  return [typeName, ...extras].join(' – ');
}

// --- card plumbing ------------------------------------------------------------

/** "When you play this" ability: fires when the card enters In Play. */
function onPlay(id: string, name: string, script: Block[], stacked = false): AbilityDef {
  return { id, name, on: 'enterZone', zoneId: INPLAY, phaseId: null, condition: null, script, stacked };
}

/**
 * A forge-added card. No CTYPE value: typeId / tags / the KIND_F display
 * line are assigned to EVERY card (example clones + these) by the surgery
 * loop in buildDominionDef, off the one TYPE_LINE table.
 */
function card(
  name: string, cost: number, coins: number, vp: number, text: string,
  abilities: AbilityDef[] = [],
): CardDef {
  return {
    id: cardIdFor(name), name, templateId: 'dom_tpl_kingdom',
    fields: { [COST]: cost, [COINS_F]: coins, [VP_F]: vp, [TEXT]: text },
    abilities,
  };
}

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
/** The per-player recount body; expansions append Duke-style terms. */
const RECOUNT_VP_BODY: Block[] = [
  setVar(VP, ownedVpTotal, PLAYER),
  // floor(total / 10) as (total - total % 10) / 10 — exact integer math.
  changeVar(VP, mul(gardensTotal, div(sub(ownedTotal, mod(ownedTotal, num(10))), num(10))), PLAYER),
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
  // Bridge-aware: a discount lowers every card's cost this turn, so
  // "cost ≤ limit" becomes "cost ≤ limit + discount" (floors at the check).
  const cap = add(opts.limit, getVar(DISCOUNT));
  const filter = opts.treasureOnly
    ? allOf(IS_TREASURE_CARD, lte(field(CARD, COST), cap))
    : lte(field(CARD, COST), cap);
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

// --- the expansion kit: hands the private plumbing to dominion/ modules --------

const KIT: CardKit = {
  zones: { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, RESERVE, LOOK },
  vars: { ACTIONS, BUYS, COINS, VP, IMMUNE, EMPTY_PILES, SCRATCH, DISCOUNT },
  fields: { COST, COINS_F, VP_F, TEXT },
  types: { ACTION: TYPE_ACTION, TREASURE: TYPE_TREASURE, VICTORY: TYPE_VICTORY, CURSE: TYPE_CURSE },
  tags: { ATTACK: TAG_ATTACK, REACTION: TAG_REACTION, KINGDOM: TAG_KINGDOM },
  OWNER, CARD, CHOICE, PLAYER,
  nameIs, isA, hasTag, IS_ACTION_CARD, IS_TREASURE_CARD, div, mod, sumCards,
  tmove, drawN, draw, choosePileBlock, playAgain, onPlay,
  cardDef: (id, name, cost, coins, vp, text, abilities = []) => ({
    id, name, templateId: 'dom_tpl_kingdom',
    fields: { [COST]: cost, [COINS_F]: coins, [VP_F]: vp, [TEXT]: text },
    abilities,
  }),
  gainFromSupply,
};

// --- the added cards ----------------------------------------------------------

const EXTRA_CARDS: CardDef[] = [
  card('Curse', 0, 0, -1, 'Worth −1 victory point.'),
  card('Gardens', 4, 0, 0,
    'Worth 1 victory point per 10 cards you own (rounded down).'),
  card('Cellar', 2, 0, 0,
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
  card('Chapel', 2, 0, 0, 'Trash up to 4 cards from your hand.', [
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
  card('Workshop', 3, 0, 0, 'Gain a card costing up to 4 coins.', [
    onPlay('dom_ab_workshop', 'Commissioned work', gainFromSupply({
      limit: num(4),
      prompt: 'Workshop: gain a card costing up to 4',
      whiff: [announce(OWNER, ' finds nothing to gain.')],
    })),
  ]),
  card('Black Market', 3, 0, 0,
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
  card('Throne Room', 4, 0, 0,
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
  card('Remodel', 4, 0, 0,
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
  card('Mine', 5, 0, 0,
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
  card('Witch', 5, 0, 0,
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
      // Each OPPONENT (forEachOpponent skips the owner) who isn't Moat-immune
      // discards down to 3 — they choose which, and it no-ops at ≤3 cards.
      forEachOpponent([
        iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
          discardDownTo({
            who: PLAYER,
            from: zone(HAND, PLAYER),
            to: zone(DISCARD, PLAYER),
            keep: num(3),
            prompt: 'Militia: discard down to 3 cards',
          }),
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
    // The foe's name breathes while he thinks (2.6s loop while the state holds).
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

// Slice filters on the type/tag vocabulary (the old name chains are gone).
// Victory column = the basic cards that are not treasures — Estate / Duchy /
// Province + Curse, so Gardens (a victory-TYPED kingdom card) stays in the
// kingdom region and Curse joins the victory column, like the original. This
// slice is also the named filter's consumer: "The basic cards" earns its keep
// through filterRef instead of sitting unused in the library.
const IS_BASIC_VICTORY_PILE = allOf(matchesFilter(FILTER_BASIC, CARD), not(IS_TREASURE_CARD));
/** Kingdom slice = ONE tag clause (the spec's poster child). */
const IS_KINGDOM_PILE = hasTag(CARD, TAG_KINGDOM);

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

/** The mobile supply's radio-set id — the three tab buttons share it. */
const M_SUPPLY_GROUP = 'dom_el_m_supply';

/**
 * One DESIGNED selector button of the supply switcher (spec B §2): a third
 * of the selector row, role 'selector' (clicking switches the bound panel,
 * never a game action — the runner marks the active one rn-sel-on).
 * dominion-skin.css dresses the row per the DGT tab-slider: engraved
 * uppercase labels, ash → bone, the ACTIVE button wearing the notched
 * crimson plate. fontSize 2.7% of the ~390px stage ≈ 10.5px — the original
 * .supply-tabs 0.66rem label.
 */
function mSupplyTab(panelId: string, label: string, i: number): ScreenElement {
  return {
    kind: 'button', id: `${panelId}_sel`, name: `${label} selector`,
    // Position is flow-driven inside the panelSwitcher's 'tabs' slot (row,
    // itemSize uniform → equal thirds); rect is only the fallback basis.
    rect: { x: i * 33.33, y: 0, w: i === 2 ? 33.34 : 33.33, h: 100 },
    actionId: null, label, fontSize: 2.7,
    role: 'selector', selectorGroup: M_SUPPLY_GROUP, slotId: 'tabs',
  };
}

/**
 * One panel of the supply switcher: a group bound to ITS selector button
 * via showForSelector (exactly one panel renders at a time), holding that
 * slice's carousel of DGT pile tiles under the selector row. Digit badges
 * 1–9/0 ride the keyGroup (Shift/Ctrl/Alt, like the desktop slices), and
 * the held modifier flips the switcher to this panel — the runner's
 * keyboard flip selects the button whose bound panel holds the keyGroup
 * zone (selectorFlipsForGroup).
 */
function mSupplyPanel(
  panelId: string, label: string, zoneElId: string,
  filter: Expr, keyGroup: 'shift' | 'ctrl' | 'alt',
): ScreenElement {
  return {
    kind: 'group', id: panelId, name: label,
    // Fills the panelSwitcher's 'content' slot (which already sits below the
    // tabs); flow ignores x/y, uses w/h as the basis so it fills the slot.
    rect: { x: 0, y: 0, w: 100, h: 100 },
    showForSelector: `${panelId}_sel`,
    slotId: 'content',
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
 *   - the supply SWITCHER: three designed selector buttons over one bound
 *     Treasury / Victory / Kingdom tile carousel at a time (spec B §2);
 *   - the battlefield band: TURN + tickers left, the compact seal right
 *     (no keyboard hint), and the appearing in-play row;
 *   - the hand fan (thumb-reachable, plain digit badges);
 *   - the harbor's compact deck / discard / trash spots.
 * No chronicle: the Log drawer is the history (spec B §3), and the peeking
 * status bar's handle keeps the strip below the harbor clear.
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
      // --- the supply switcher (~8-38%): one bound panel at a time ------------
      // Three designed selector buttons over three showForSelector-bound
      // carousel panels (spec B §2 — the retired `tabbed: true` runner
      // chrome is replaced by real, restylable def elements). Treasury is
      // first in paint order, so it is the default selection.
      {
        kind: 'panelSwitcher', id: M_SUPPLY_GROUP, name: 'Supply',
        rect: { x: 1.5, y: 8.4, w: 97, h: 29.8 },
        selectorGroup: M_SUPPLY_GROUP,
        slots: [
          { id: 'tabs', name: 'Tabs', accepts: ['button'], rect: { x: 0, y: 0, w: 100, h: 13 }, layout: { mode: 'row', itemSize: 'uniform' } },
          { id: 'content', name: 'Content', single: true, rect: { x: 0, y: 13, w: 100, h: 87 }, layout: { mode: 'column' } },
        ],
        children: [
          mSupplyTab('dom_el_m_tab_treasury', 'Treasury', 0),
          mSupplyTab('dom_el_m_tab_victory', 'Victory', 1),
          mSupplyTab('dom_el_m_tab_kingdom', 'Kingdom', 2),
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
      // NO chronicle element (spec B §3): the runner's Log drawer is the one
      // history, and the strip below the harbor stays clear for the peeking
      // status bar's handle.
    ],
  };
}

// --- the def -------------------------------------------------------------------

/** Names of every kingdom card the def can put in a supply (validation aid). */
export function kingdomCardNames(def: GameDef): string[] {
  return def.cards.filter((c) => !BASIC_NAME_SET.has(c.name)).map((c) => c.name);
}

/**
 * True when the def's setup swaps kingdom piles (the pickKingdom shape) —
 * the game setup screen shows its Kingdom picker exactly then.
 */
export function supportsKingdomPicking(def: GameDef): boolean {
  return def.setup.some((b) => kingdomPileBlockName(b) !== null);
}

/** The card names the def's setup currently promotes into the supply. */
export function activeKingdomCards(def: GameDef): string[] {
  return def.setup
    .map(kingdomPileBlockName)
    .filter((n): n is string => n !== null);
}

/** One picker row per pickable kingdom card: name + printed cost + type line. */
export interface KingdomCatalogEntry {
  name: string;
  cost: number;
  /** The display type line ("Action – Attack"). */
  kind: string;
}

export function kingdomCatalog(def: GameDef): KingdomCatalogEntry[] {
  return def.cards
    .filter((c) => !BASIC_NAME_SET.has(c.name))
    .map((c) => ({
      name: c.name,
      cost: Number(c.fields[COST] ?? 0),
      kind: String(c.fields[KIND_F] ?? ''),
    }))
    .sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
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
    // Look-at staging (Sentry/Bandit/Library): cards visit briefly during a
    // revealed choice, then leave — no screen element shows the zone itself.
    { id: LOOK, name: 'Aside', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
  );

  def.variables.push(
    { id: SCRATCH, name: 'Scratch counter', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: GAME_OVER, name: 'Game over pending', scope: 'global', type: 'number', initial: 0, hidden: true },
    { id: DISCOUNT, name: 'Cost discount', scope: 'global', type: 'number', initial: 0, hidden: true },
    ...EXPANSIONS.flatMap((x) => x.variables ?? []),
  );
  // The empty-pile counter (inherited from the example) is bookkeeping too —
  // the table's supply already shows the piles themselves.
  const emptyPilesVar = def.variables.find((v) => v.id === EMPTY_PILES);
  if (emptyPilesVar) emptyPilesVar.hidden = true;

  def.cards.push(...EXTRA_CARDS, ...EXPANSIONS.flatMap((x) => x.buildCards(KIT)));

  // The type/tag vocabulary + the one named filter (spec A §Dominion
  // migration). Deep-cloned: the def is keeper-editable stored data and must
  // never share mutable rows with this module's constants.
  def.cardTypes = deepClone(CARD_TYPES);
  def.cardTags = deepClone(CARD_TAGS);
  def.filters = [
    { id: FILTER_BASIC, name: 'The basic cards', condition: hasTag(CARD, TAG_BASIC) },
  ];

  // Card surgery over the whole catalogue (example clones + the extras):
  // every card gets its typeId + tags + the pretty KIND display line off the
  // one TYPE_LINE table; the retired CTYPE text field is scrubbed wholesale
  // (definition, face binding and every value — nothing reads it anymore);
  // the example abilities are re-expressed on the draw block + move tags.
  const tpl = def.templates.find((t) => t.id === 'dom_tpl_kingdom');
  if (tpl) {
    tpl.fields = tpl.fields.filter((f) => f.id !== CTYPE);
    tpl.fields.push({ id: KIND_F, name: 'Kind', type: 'text' });
    const typeEl = tpl.elements.find((e) => e.id === 'dom_el_type');
    if (typeEl && typeEl.kind === 'text') typeEl.bind = KIND_F;
  }
  for (const c of def.cards) {
    delete c.fields[CTYPE];
    const line = TYPE_LINE[c.name];
    c.typeId = line.typeId;
    c.tags = [...line.tags];
    c.fields[KIND_F] = kindLabelFor(line);
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

  // Actions, re-expressed with cause tags. Play/treasure legality speaks the
  // primary type now (is-a Action / is-a Treasure — Militia, Witch and Moat
  // are all Action-TYPED; Attack and Reaction ride as tags), and revealing a
  // Moat is a has-tag Reaction check: any future reaction card joins the
  // response window by wearing the tag, no legality edit needed.
  const play = def.actions.find((a) => a.id === 'dom_action_play');
  if (play) {
    play.legality = allOf(IS_ACTION_CARD, gt(getVar(ACTIONS), num(0)));
    play.script = [
      changeVar(ACTIONS, num(-1)),
      announce(CURRENT, ' plays ', bnd('$card'), '.'),
      tmove(specific(bnd('$card')), zone(HAND), zone(INPLAY), 'play', { faceUp: true }),
    ];
  }
  const treasure = def.actions.find((a) => a.id === 'dom_action_treasure');
  if (treasure) {
    treasure.legality = IS_TREASURE_CARD;
    treasure.script = [
      changeVar(COINS, field(bnd('$card'), COINS_F)),
      tmove(specific(bnd('$card')), zone(HAND), zone(INPLAY), 'play', { faceUp: true }),
    ];
  }
  const revealMoat = def.actions.find((a) => a.id === 'dom_action_reveal_moat');
  if (revealMoat) {
    // Moat's blanket immunity belongs to MOAT alone: reactions with their own
    // effects (Diplomat) carry the Reaction tag for display/warnings but ship
    // their own response-speed actions — without the name check, "reveal
    // Moat" could target a Diplomat and grant immunity it doesn't offer.
    revealMoat.legality = allOf(
      nameIs('Moat'),
      hasTag(CARD, TAG_REACTION),
      gt(STACK_SIZE, num(0)),
      eq(getVar(IMMUNE, bnd('$player')), num(0)),
    );
  }
  const buy = def.actions.find((a) => a.id === 'dom_action_buy');
  if (buy) {
    // Bridge-aware: "reduced cost ≤ coins" checked as "cost ≤ coins +
    // discount" (no clamping needed on the check side); the PAY side clamps
    // at 0 via SCRATCH — Dominion costs never drop below zero.
    buy.legality = allOf(
      gt(getVar(BUYS), num(0)),
      lte(field(CARD, COST), add(getVar(COINS), getVar(DISCOUNT))),
    );
    buy.script = [
      setVar(SCRATCH, sub(field(CARD, COST), getVar(DISCOUNT))),
      iff(lte(getVar(SCRATCH), num(0)), [setVar(SCRATCH, num(0))]),
      changeVar(COINS, neg(getVar(SCRATCH))),
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
    script: [
      ...cleanupSweep,
      // Per-turn state fades with the turn: the Bridge discount + whatever
      // the expansion cards track (Merchant's first-Silver flag, Conspirator's
      // actions-played counter, Minion's stashed choice…).
      setVar(DISCOUNT, num(0)),
      ...EXPANSIONS.flatMap((x) => x.buildCleanupResets?.(KIT) ?? []),
      END_PHASE,
    ],
  });
  def.actions.push(...EXPANSIONS.flatMap((x) => x.buildActions?.(KIT) ?? []));

  // Triggers: the Gardens-aware recount runs at turn end AND on every
  // tagged 'gain' (Workshop / Remodel / Mine / Witch's Curse) — the old
  // per-site RECOUNT_VP splices are gone. Plain buys recount at turn end
  // (nothing on this table displays live VP mid-turn). IMMUNE resets once,
  // after EVERY attack resolves (effectResolved), so immunity is per-attack
  // without per-card boilerplate. The pile watcher and the end-of-turn
  // judgement keep their exact original timing.
  const recountVpScript: Block[] = [forEachPlayer([
    ...RECOUNT_VP_BODY,
    ...EXPANSIONS.flatMap((x) => x.buildVpTerms?.(KIT) ?? []),
  ])];
  const recount = def.triggers.find((t) => t.id === 'dom_trigger_vp');
  if (recount) recount.script = deepClone(recountVpScript);
  const watcher = def.triggers.find((t) => t.id === 'dom_trigger_piles');
  if (watcher) watcher.script = pileWatcherScript(defaultSet.cards);
  def.triggers = [
    ...(recount ? [recount] : []),
    {
      id: 'dom_trigger_vp_gain',
      name: 'Recount victory points on a gain',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'gain' },
      condition: null,
      script: deepClone(recountVpScript),
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
    ...EXPANSIONS.flatMap((x) => x.buildTriggers?.(KIT) ?? []),
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
    const els = layout.elements;
    patchTextEl(els, 'dom_el_turn', { parts: roundNumberParts() });

    // ------ the keeper's mock (war table v2) --------------------------------
    // Three labeled supply columns (underlined headers + gold hairline
    // separators) over a status strip (phase seal + ACTIONS/BUYS/COINS
    // chips), a realm header band, the play-zone harbor and a flat hand
    // strip. Everything is authored elements — no skin-only chrome.
    const HDR_GOLD = '#d2ab66';
    const HDR_GREEN = '#8fbf8f';
    const HDR_RED = '#e0697a';
    const HAIR = 'rgba(210, 171, 102, 0.26)';
    const BAND_BG = '#191210';
    const BAND_BORDER = '#352a20';
    const GOLD_CARD_EDGE = { borderColor: 'rgba(210, 171, 102, 0.5)', borderWidth: 1, borderRadius: 9 };

    removeEl(els, 'dom_el_title');

    // Foe strip: a slim top band; the TURN ticker sits to its right.
    patchEl(els, 'dom_el_foe', (el) => {
      el.rect = { x: 0.8, y: 0.7, w: 82, h: 4.8 };
      el.style = { background: BAND_BG, borderColor: BAND_BORDER, borderWidth: 1, borderRadius: 8 };
    });
    patchTextEl(els, 'dom_el_turn', { rect: { x: 84, y: 1.7, w: 14.6, h: 2.6 }, fontSize: 1.25 });

    // Supply columns: headers, underlines, hairline separators, slices.
    patchTextEl(els, 'dom_el_supply_treasure_label', {
      text: 'TREASURES', rect: { x: 1.2, y: 7, w: 14.2, h: 2 },
      fontSize: 1, bold: true, align: 'left', color: HDR_GOLD, letterSpacing: 1.2,
    });
    patchZoneEl(els, 'dom_el_supply_treasures', {
      rect: { x: 1.2, y: 10.6, w: 14.6, h: 44 },
      cardFilter: IS_TREASURE_CARD, keyGroup: 'shift',
      rows: null, columns: 1, cardScale: 5.2, gap: 1.8, padding: 1,
      style: undefined, showName: false,
      countBadge: 'bottom', badgeShape: 'round',
      cardStyle: { ...GOLD_CARD_EDGE, borderColor: 'rgba(210, 171, 102, 0.4)' },
    });
    patchTextEl(els, 'dom_el_supply_victory_label', {
      text: 'VICTORY', rect: { x: 18, y: 7, w: 14.2, h: 2 },
      fontSize: 1, bold: true, align: 'left', color: HDR_GREEN, letterSpacing: 1.2,
    });
    patchZoneEl(els, 'dom_el_supply_victory', {
      rect: { x: 18, y: 10.6, w: 14.6, h: 44 },
      cardFilter: IS_BASIC_VICTORY_PILE, keyGroup: 'ctrl',
      rows: null, columns: 1, cardScale: 4.7, gap: 1.4, padding: 1,
      style: undefined, showName: false,
      countBadge: 'bottom', badgeShape: 'round',
      cardStyle: { ...GOLD_CARD_EDGE, borderColor: 'rgba(143, 191, 143, 0.35)' },
    });
    patchTextEl(els, 'dom_el_supply_kingdom_label', {
      text: 'KINGDOM ACTION CARDS', rect: { x: 34.8, y: 7, w: 40, h: 2 },
      fontSize: 1, bold: true, align: 'left', color: HDR_RED, letterSpacing: 1.2,
    });
    // The kingdom as BIG CARD FACES, 5 × 2 — the mock's centerpiece (the
    // compact tile look remains one Pile-face select away).
    patchZoneEl(els, 'dom_el_supply_kingdom', {
      rect: { x: 34.8, y: 10.6, w: 64, h: 44 },
      cardFilter: IS_KINGDOM_PILE, keyGroup: 'alt',
      pileFace: undefined, rows: 2, columns: 5, cardScale: 7.3, gap: 1.8, padding: 1,
      style: undefined, showName: false,
      countBadge: 'bottom', badgeShape: 'round',
      cardStyle: { ...GOLD_CARD_EDGE, borderRadius: 10 },
    });
    const underline = (id: string, x: number, w: number, color: string): ScreenElement => ({
      kind: 'line', id, name: `${id.replace('dom_el_', '').replace(/_/g, ' ')}`,
      rect: { x, y: 9.4, w, h: 0.5 }, orient: 'h', thickness: 1,
      style: { borderColor: color },
    });
    els.push(
      underline('dom_el_hdr_line_treasures', 1.2, 14.2, 'rgba(210, 171, 102, 0.55)'),
      underline('dom_el_hdr_line_victory', 18, 14.2, 'rgba(143, 191, 143, 0.5)'),
      underline('dom_el_hdr_line_kingdom', 34.8, 64, 'rgba(224, 105, 122, 0.45)'),
      {
        kind: 'line', id: 'dom_el_sep_tv', name: 'Column separator',
        rect: { x: 16.5, y: 7, w: 0.4, h: 47.6 }, orient: 'v', thickness: 1,
        style: { borderColor: HAIR },
      },
      {
        kind: 'line', id: 'dom_el_sep_vk', name: 'Column separator',
        rect: { x: 33.4, y: 7, w: 0.4, h: 47.6 }, orient: 'v', thickness: 1,
        style: { borderColor: HAIR },
      },
    );

    // Status strip: the phase seal reshaped into a wide plate (dots right,
    // name/hint inline) + the three counter chips beside it.
    patchEl(els, 'dom_el_seal', (el) => {
      if (el.kind !== 'group') return;
      el.rect = { x: 0.8, y: 56.4, w: 19, h: 5.8 };
      el.onChangeAnim = 'stamp';
      el.states = sealStates(false);
      el.children = sealChildren(false);
      const strip: [string, { x: number; y: number; w: number; h: number }][] = [
        ['dot_action', { x: 68, y: 28, w: 3.2, h: 40 }],
        ['dot_buy', { x: 73.6, y: 28, w: 3.2, h: 40 }],
        ['dot_cleanup', { x: 79.2, y: 28, w: 3.2, h: 40 }],
        ['key', { x: 86.5, y: 26, w: 10.5, h: 46 }],
      ];
      for (const [cid, r] of strip) patchEl(el.children, `dom_el_seal_${cid}`, (d) => { d.rect = { ...r }; });
      for (const nid of ['name_action', 'name_buy', 'name_cleanup', 'name_foe', 'name_resolve', 'name_fallen']) {
        patchEl(el.children, `dom_el_seal_${nid}`, (t) => {
          t.rect = { x: 5, y: 12, w: 58, h: 50 };
          if (t.kind === 'text') t.fontSize = 1.15;
        });
      }
      for (const hid of ['hint_action', 'hint_buy', 'hint_cleanup', 'hint_foe', 'hint_resolve', 'hint_fallen']) {
        patchEl(el.children, `dom_el_seal_${hid}`, (t) => {
          t.rect = { x: 5, y: 64, w: 58, h: 24 };
          if (t.kind === 'text') t.fontSize = 0.55;
        });
      }
    });
    const chip = (id: string, x: number, tint: string, soft: string) => {
      patchEl(els, id, (el) => {
        if (el.kind !== 'varText') return;
        el.rect = { x, y: 56.4, w: 5.6, h: 5.8 };
        el.fontSize = 1.9;
        el.style = { background: soft, borderColor: tint, borderWidth: 1, borderRadius: 10 };
      });
      patchTextEl(els, `${id}_label`, {
        rect: { x, y: 60.3, w: 5.6, h: 1.3 }, fontSize: 0.62, align: 'center', color: tint,
      });
    };
    chip('dom_el_counter_actions', 21.4, '#a68cff', 'rgba(124, 92, 255, 0.10)');
    chip('dom_el_counter_buys', 27.6, HDR_GREEN, 'rgba(79, 158, 99, 0.10)');
    chip('dom_el_counter_coins', 33.8, GOLD, 'rgba(210, 171, 102, 0.10)');

    // Realm header band: "<You>'S REALM" + the ACTIVE TURN chip + drop hint.
    els.push(
      {
        kind: 'shape', id: 'dom_el_realm_bar', name: 'Realm bar', shape: 'rect',
        rect: { x: 0.8, y: 63.4, w: 98.4, h: 3.6 },
        style: { background: BAND_BG, borderColor: BAND_BORDER, borderWidth: 1, borderRadius: 8 },
      },
      {
        kind: 'text', id: 'dom_el_realm_name', name: 'Realm name',
        rect: { x: 2, y: 64.2, w: 24, h: 2.2 },
        text: 'YOUR REALM', parts: [VIEWER, "'S REALM"],
        fontSize: 1.05, bold: true, align: 'left', color: INK,
        letterSpacing: 1, uppercase: true,
      },
      {
        kind: 'text', id: 'dom_el_realm_active', name: 'Active turn chip',
        rect: { x: 21, y: 64.1, w: 8.4, h: 2.2 },
        text: 'ACTIVE TURN', fontSize: 0.68, bold: true, align: 'center', color: '#69d18c',
        style: {
          background: 'rgba(105, 209, 140, 0.12)',
          borderColor: 'rgba(105, 209, 140, 0.55)', borderWidth: 1, borderRadius: 999,
        },
        visible: MY_TURN, reveal: 'fade',
      },
      {
        kind: 'text', id: 'dom_el_realm_hint', name: 'Realm hint',
        rect: { x: 31, y: 64.4, w: 46, h: 1.8 },
        text: '— drop a hand card to play, or a supply card to buy',
        fontSize: 0.72, align: 'left', color: ASH,
        visible: MY_TURN,
      },
    );

    // Harbor band: DECK tile (blue-striped), the PLAY ZONE, DISCARD + TRASH.
    patchTextEl(els, 'dom_el_my_deck_label', {
      rect: { x: 1.2, y: 68.2, w: 7, h: 1.3 }, fontSize: 0.7, align: 'center',
    });
    patchZoneEl(els, 'dom_el_my_deck', {
      rect: { x: 1.2, y: 69.8, w: 7, h: 13 }, cardScale: 4.4,
      style: {
        background: 'repeating-linear-gradient(45deg, #16283a 0 8px, #0f1c29 8px 16px)',
        borderColor: '#2e4a66', borderWidth: 1, borderRadius: 8,
      },
    });
    patchZoneEl(els, 'dom_el_my_inplay', {
      rect: { x: 9.4, y: 68.2, w: 66.4, h: 14.6 },
      cardScale: 5.4, padding: 1,
      style: { background: '#150e0a', borderColor: BAND_BORDER, borderWidth: 1, borderRadius: 10 },
      emptyText: 'Play zone empty.',
      states: [],
    });
    els.push({
      kind: 'text', id: 'dom_el_my_inplay_label', name: 'Play zone label',
      rect: { x: 10.6, y: 69, w: 12, h: 1.2 },
      text: 'PLAY ZONE', fontSize: 0.65, bold: true, align: 'left', color: ASH,
      letterSpacing: 1.4, uppercase: true,
    });
    patchTextEl(els, 'dom_el_my_discard_label', {
      rect: { x: 77, y: 68.2, w: 9.6, h: 1.3 }, fontSize: 0.7, align: 'center', color: '#e8a04c',
    });
    patchZoneEl(els, 'dom_el_my_discard', {
      rect: { x: 77, y: 69.8, w: 9.6, h: 13 }, cardScale: 4.4,
      style: { background: '#1a120c', borderColor: '#5a3b1e', borderWidth: 1, borderRadius: 8 },
      emptyText: 'empty',
    });
    patchZoneEl(els, 'dom_el_trash', {
      rect: { x: 88, y: 69.8, w: 9.6, h: 13 }, cardScale: 4.4,
      emptyText: 'empty',
    });
    els.push({
      kind: 'text', id: 'dom_el_trash_label', name: 'Trash label',
      rect: { x: 88, y: 68.2, w: 9.6, h: 1.3 },
      text: 'TRASH', fontSize: 0.7, bold: true, align: 'center', color: HDR_RED,
      letterSpacing: 1.4, uppercase: true,
    });

    // Hand strip: a flat row of individual cards on its own panel (the mock
    // shows every copy — no × N collapsing, no fan tilt).
    els.push({
      kind: 'text', id: 'dom_el_my_hand_label', name: 'Hand label',
      rect: { x: 1.2, y: 84.2, w: 6, h: 1.2 },
      text: 'HAND', fontSize: 0.65, bold: true, align: 'left', color: ASH,
      letterSpacing: 1.4, uppercase: true,
    });
    patchZoneEl(els, 'dom_el_my_hand', {
      rect: { x: 0.8, y: 85.4, w: 98.4, h: 14.1 },
      keyGroup: 'plain', fanAngle: 0, collapseDuplicates: false,
      // Fan-layout gap = how much of each covered card stays visible, so a
      // flat NON-overlapping strip needs gap ≥ cardScale (plus breathing room).
      cardScale: 6.4, gap: 7.2, padding: 0.5,
      style: { background: '#150e0a', borderColor: BAND_BORDER, borderWidth: 1, borderRadius: 10 },
    });

    // Foe in-play floats over the kingdom's top edge while the foe acts or
    // still has cards out — the original foePlayWrap condition.
    removeEl(els, 'dom_el_foe_inplay');
    els.push({
      kind: 'zone', id: 'dom_el_foe_inplay', name: 'Foe in play',
      rect: { x: 55.5, y: 5.8, w: 27.2, h: 11 },
      zoneId: INPLAY, seat: 'opp1', cardScale: 4.5, gap: 0.5, padding: 0.3, showName: false,
      style: { background: BAND_BG, borderColor: BAND_BORDER, borderWidth: 1, borderRadius: 8 },
      visible: or(THEIR_TURN, gt(zoneCount(zone(INPLAY, FOE)), num(0))),
      reveal: 'fade',
    });

    // The chronicle returns as the mock's right-edge tab: a collapsible log
    // docked at CHRONICLE, closed by default. The status bar still peeks.
    removeEl(els, 'dom_el_chronicle');
    removeEl(els, 'dom_el_chronicle_label');
    els.push({
      kind: 'log', id: 'dom_el_chronicle', name: 'Chronicle',
      rect: { x: 79, y: 7, w: 20, h: 47.6 },
      fontSize: 0.95, turnSeparators: true,
      style: { background: BAND_BG, borderColor: BAND_BORDER, borderWidth: 1, borderRadius: 10 },
      collapsible: { side: 'right', label: 'CHRONICLE', startCollapsed: true },
    });
    layout.statusBar = 'peek';
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
    // authors the whole pocket table (supply switcher, compact seal) from
    // scratch.
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
