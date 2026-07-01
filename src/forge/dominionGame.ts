/**
 * The hall's flagship table: Dominion, id 'dominion-crownfall' — a Forge
 * creation the lobby actually plays. Built by deep-cloning the Cardsmith
 * example (war-table screenLayout, Militia/Moat stack patterns, the inline
 * reshuffle draw) and extending it so all three lobby kingdom sets
 * (src/shared/kingdoms.ts) are playable:
 *
 *   - adds Cellar, Chapel, Workshop, Throne Room, Remodel-companions Gardens,
 *     Mine, Witch and Black Market (plus a Curse card + pile) with the
 *     ORIGINAL DominionGameTable's costs/effects/counts where that table had
 *     the card, and standard base-set semantics where it didn't;
 *   - kingdom piles spawn via one tagged setup block per card (reserve →
 *     supply, filtered by name), so pickKingdom() can swap the active ten
 *     surgically while basics (treasure / victory / curse) stay put;
 *   - inactive kingdom piles wait in a hidden shared RESERVE zone — which is
 *     also the Black Market's stock, so the market sells what the kingdom
 *     doesn't;
 *   - supply gains (Workshop / Remodel / Mine / Black Market) stage ONE
 *     representative card per eligible pile into a transient PICK ROW and
 *     choose from that — the original's "choose a pile" pending, and it keeps
 *     choice sheets to one card per pile instead of one per copy;
 *   - the victory-point recount understands Gardens (1 VP per 10 owned cards,
 *     rounded down, per Gardens);
 *   - the mobile variant's three supply slices use the 'carousel' display
 *     (the original table's under-720px scroll-snap supply).
 *
 * Every choice a script can open always has at least one candidate (guarded
 * by iff) or a min of 0, so the random session AI can never hang on one.
 */
import type {
  AbilityDef, Block, CardDef, CardSelector, Expr, GameDef, ScreenElement,
} from '../shared/types';
import { deepClone } from '../shared/defaults';
import { dominionGame } from '../examples/dominion';
import {
  ALL, CURRENT, TURN_NUMBER, add, allOf, announce, anyOf, bnd, bestCard, changeVar, chooseCard,
  chooseCardsBlock, countCards, eq, field, forEachCard, forEachPlayer, getVar, gt, gte, iff, lte,
  move, mul, neg, neq, not, num, or, repeat, setVar, shuffle, specific, str, sub, topN, zone,
  zoneCount,
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
/** Transient gain-choice row: one card per eligible pile. */
const PICKROW = 'dom_zone_pickrow';

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

/** The per-player victory-point variable (read by the hall on game over). */
export const DOMINION_VP_VAR = VP;

const OWNER = bnd('$owner');
const CARD = bnd('$card');
const CHOICE = bnd('$choice');
const PLAYER = bnd('$player');

const nameIs = (name: string): Expr => eq(field(CARD, 'name'), str(name));
const IS_ACTION_CARD = anyOf(eq(field(CARD, CTYPE), str('action')), eq(field(CARD, CTYPE), str('attack')));
const IS_TREASURE_CARD = eq(field(CARD, CTYPE), str('treasure'));

const div = (l: Expr, r: Expr): Expr => ({ kind: 'math', op: '/', left: l, right: r });
const mod = (l: Expr, r: Expr): Expr => ({ kind: 'math', op: '%', left: l, right: r });
const randomN = (n: number): CardSelector => ({ kind: 'random', count: num(n) });

// --- the supply catalogue (build-time truth for staging / counts / watcher) ---

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
const ALL_PILES = [...BASIC_PILES, ...KINGDOM_PILES];

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

// --- script helpers (the example's patterns, reused exactly) -----------------

/** Inline-reshuffle draw with an expression count (the example's `draw`). */
function drawN(owner: Expr | null, n: Expr): Block {
  return repeat(n, [
    iff(eq(zoneCount(zone(DECK, owner)), num(0)), [
      move(ALL, zone(DISCARD, owner), zone(DECK, owner), { faceUp: false }),
      shuffle(zone(DECK, owner)),
    ]),
    move(topN(1), zone(DECK, owner), zone(HAND, owner), { faceUp: true }),
  ]);
}
const draw = (owner: Expr | null, n: number): Block => drawN(owner, num(n));

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
 * Gardens-aware victory recount: static VP fields over everything a player
 * owns, plus 1 VP per 10 owned cards (rounded down) per Gardens.
 */
const OWNED_ZONES = [DECK, HAND, DISCARD, INPLAY];
const ownedTotal: Expr = OWNED_ZONES
  .map((z) => zoneCount(zone(z, PLAYER)))
  .reduce((a, b) => add(a, b));
const gardensTotal: Expr = OWNED_ZONES
  .map((z) => countCards(zone(z, PLAYER), nameIs('Gardens')))
  .reduce((a, b) => add(a, b));
const RECOUNT_VP: Block[] = [
  forEachPlayer([
    setVar(VP, num(0), PLAYER),
    ...OWNED_ZONES.map((z) =>
      forEachCard(zone(z, PLAYER), null, [
        changeVar(VP, field(CARD, VP_F), PLAYER),
      ])),
    // floor(total / 10) as (total - total % 10) / 10 — exact integer math.
    changeVar(VP, mul(gardensTotal, div(sub(ownedTotal, mod(ownedTotal, num(10))), num(10))), PLAYER),
  ]),
];

/**
 * The original's mandatory pile-gain pending: stage one representative card
 * of every stocked pile within the cost cap into the pick row, choose one
 * (a pile, effectively), gain it, return the rest. `whiff` runs when nothing
 * qualifies (matching the original's silent-null auto-resolution).
 */
function gainFromSupply(opts: {
  limit: Expr;
  treasureOnly?: boolean;
  toHand?: boolean;
  prompt: string;
  whiff: Block[];
}): Block[] {
  const eligible = ALL_PILES.filter((p) => !opts.treasureOnly || p.treasure === true);
  return [
    ...eligible.map((p) => iff(
      allOf(lte(num(p.cost), opts.limit), gt(countCards(zone(SUPPLY), nameIs(p.name)), num(0))),
      [move(
        specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs(p.name))),
        zone(SUPPLY), zone(PICKROW), { faceUp: true },
      )],
    )),
    iff(gt(zoneCount(zone(PICKROW)), num(0)), [
      chooseCard({ who: OWNER, from: zone(PICKROW), prompt: opts.prompt, revealed: true }),
      announce(OWNER, ' gains ', CHOICE, '.'),
      move(specific(CHOICE), zone(PICKROW), zone(opts.toHand ? HAND : DISCARD, OWNER), { faceUp: true }),
      move(ALL, zone(PICKROW), zone(SUPPLY), { faceUp: true }),
      ...RECOUNT_VP,
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
            move(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), { faceUp: true }),
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
          move(specific(CARD), zone(HAND, OWNER), zone(TRASH), { faceUp: true }),
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
    '+2 Coins. Reveal 3 cards from the Black Market; you may buy one of them.', [
      onPlay('dom_ab_black_market', 'Under the counter', [
        changeVar(COINS, num(2), OWNER),
        iff(gt(zoneCount(zone(RESERVE)), num(0)), [
          move(randomN(3), zone(RESERVE), zone(PICKROW), { faceUp: true }),
          chooseCardsBlock({
            who: OWNER, from: zone(PICKROW),
            filter: lte(field(CARD, COST), getVar(COINS, OWNER)),
            min: num(0), max: num(1), revealed: true,
            prompt: 'Black Market: buy one of the revealed cards?',
            body: [
              changeVar(COINS, neg(field(CARD, COST)), OWNER),
              announce(OWNER, ' buys ', CARD, ' from the Black Market.'),
              move(specific(CARD), zone(PICKROW), zone(DISCARD, OWNER), { faceUp: true }),
              ...RECOUNT_VP,
            ],
          }),
          move(ALL, zone(PICKROW), zone(RESERVE), { faceUp: true }),
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
          move(specific(CHOICE), zone(HAND, OWNER), zone(INPLAY, OWNER), { faceUp: true }),
          // Bounce through the reserve so the card ENTERS In Play twice —
          // each entry queues its on-play ability, so it resolves twice.
          move(specific(CHOICE), zone(INPLAY, OWNER), zone(RESERVE), { faceUp: true }),
          move(specific(CHOICE), zone(RESERVE), zone(INPLAY, OWNER), { faceUp: true }),
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
          move(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), { faceUp: true }),
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
          move(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), { faceUp: true }),
          ...gainFromSupply({
            treasureOnly: true, toHand: true,
            limit: getVar(SCRATCH, OWNER),
            prompt: 'Mine: gain a Treasure into your hand',
            whiff: [announce('No Treasure in the supply is cheap enough.')],
          }),
        ], [announce(OWNER, ' has no Treasure to mine.')]),
      ]),
    ]),
  card('Witch', 5, 'attack', 0, 0,
    '+2 Cards. Every other player gains a Curse (Moat blocks this).', [
      // Like Militia: the draw is immediate, only the attack half goes
      // through the stack so Moat owners get a response window first.
      onPlay('dom_ab_witch_draw', 'Cackling study', [draw(OWNER, 2)]),
      onPlay('dom_ab_witch_attack', 'Midnight curse', [
        forEachPlayer([
          iff(allOf(neq(PLAYER, OWNER), eq(getVar(IMMUNE, PLAYER), num(0))), [
            iff(gt(countCards(zone(SUPPLY), nameIs('Curse')), num(0)), [
              announce(PLAYER, ' gains a Curse.'),
              move(
                specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Curse'))),
                zone(SUPPLY), zone(DISCARD, PLAYER), { faceUp: true },
              ),
            ]),
          ]),
        ]),
        forEachPlayer([setVar(IMMUNE, num(0), PLAYER)]),
        ...RECOUNT_VP,
      ], true),
    ]),
];

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

  // New zones: the kingdom reserve (hidden) and the transient pick row.
  def.zones.push(
    { id: RESERVE, name: 'Reserve', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
    { id: PICKROW, name: 'Pick row', owner: 'shared', visibility: 'all', layout: 'row', area: 'center' },
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

  // Buy keeps the example's shape but recounts with the Gardens-aware script.
  const buy = def.actions.find((a) => a.id === 'dom_action_buy');
  if (buy) {
    buy.script = [
      changeVar(COINS, neg(field(CARD, COST))),
      changeVar(BUYS, num(-1)),
      announce(CURRENT, ' buys ', CARD, '.'),
      move(specific(CARD), zone(SUPPLY), zone(DISCARD), { faceUp: true }),
      ...RECOUNT_VP,
    ];
  }

  // Triggers: Gardens-aware recount; pile watcher over the ACTIVE piles only.
  const recount = def.triggers.find((t) => t.id === 'dom_trigger_vp');
  if (recount) recount.script = deepClone(RECOUNT_VP);
  const watcher = def.triggers.find((t) => t.id === 'dom_trigger_piles');
  if (watcher) watcher.script = pileWatcherScript(defaultSet.cards);

  // End-of-turn timing, matching the original table: engine.js checks the
  // supply only inside endTurn (after cleanup + redraw), never mid-turn. The
  // engine here evaluates endConditions after EVERY settle, so gate them on a
  // pending var that only a turnEnd trigger can raise — placed AFTER the VP
  // recount so the verdict scores the finished turn. A mid-turn last-Province
  // buy (or a Remodel emptying a third pile) no longer forfeits the rest of
  // the turn, which could flip the winner.
  const vpIdx = def.triggers.findIndex((t) => t.id === 'dom_trigger_vp');
  def.triggers.splice(vpIdx + 1, 0, {
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
  });
  def.endConditions = def.endConditions.map((ec) => ({
    ...ec,
    condition: allOf(gte(getVar(GAME_OVER), num(1)), ec.condition),
  }));

  // Screen layout: name-based supply slices (desktop + mobile), a 4-row
  // victory column (Curse joins it), the carousel mobile supply, and TURN
  // tickers that count rounds like the original's top bar.
  const layout = def.screenLayout;
  if (layout) {
    patchTextEl(layout.elements, 'dom_el_turn', { parts: roundNumberParts() });
    patchZoneEl(layout.elements, 'dom_el_supply_victory', {
      cardFilter: IS_BASIC_VICTORY_PILE, rows: 4, cardScale: 4, gap: 0.5,
    });
    patchZoneEl(layout.elements, 'dom_el_supply_kingdom', { cardFilter: IS_KINGDOM_PILE });
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
