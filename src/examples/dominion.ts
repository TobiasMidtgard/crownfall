/**
 * Dominion (example_dominion) — the classic deck-builder for 2-4 players, and
 * the showcase for the stack/response-window interrupt system in a multiplayer
 * setting: Militia is a stacked attack that opens a response window, and Moat
 * is a response-speed reveal that makes its owner immune before the attack
 * resolves.
 *
 * Card effects are abilities that fire when the card enters the In Play zone.
 * Every multi-card draw uses the inline reshuffle pattern (check for an empty
 * deck BEFORE each single draw) because triggers cannot refill a deck in the
 * middle of a running script — events drain only after the script finishes.
 *
 * Ships the showcase `screenLayout` — the WAR TABLE: a desktop screen built
 * from the viewer's perspective (foe strip with deck/hand-backs/discard
 * tallies, the one shared supply sliced into treasure / victory / kingdom
 * pile regions via display-only cardFilters, a battlefield band with
 * action/buy/coin tickers and the crimson phase seal, a chronicle log rail,
 * and the harbor: deck, fanned collapsing hand, discard and the burning
 * trash) plus a Crownfall-style MOBILE variant (a tall scrolling column).
 * Render-only: the engine never reads it.
 */
import type { AbilityDef, Block, CardDef, Expr, GameDef, LayoutStyle, ScreenElement, ScreenLayout } from '../shared/types';
import {
  ALL, CURRENT, END_PHASE, STACK_SIZE, TURN_NUMBER, allOf, announce, anyOf, bnd, changeVar,
  chooseCardsBlock, countCards, eq, field, forEachCard, forEachPlayer, getVar, gt, gte, iff, lte,
  move, neg, neq, nextPlayer, not, num, repeat, setVar, shuffle, specific, str, sub, topN, zone,
  zoneCount,
} from './dsl';

// Zone ids
const SUPPLY = 'dom_zone_supply';
const TRASH = 'dom_zone_trash';
const DECK = 'dom_zone_deck';
const HAND = 'dom_zone_hand';
const DISCARD = 'dom_zone_discard';
const INPLAY = 'dom_zone_inplay';

// Variable ids
const ACTIONS = 'dom_var_actions';
const BUYS = 'dom_var_buys';
const COINS = 'dom_var_coins';
const VP = 'dom_var_vp';
const IMMUNE = 'dom_var_immune';
const EMPTY_PILES = 'dom_var_empty_piles';

// Template field ids
const COST = 'dom_field_cost';
const CTYPE = 'dom_field_ctype';
const COINS_F = 'dom_field_coins';
const VP_F = 'dom_field_vp';
const TEXT = 'dom_field_text';

/**
 * Inline-reshuffle draw: `owner` draws `n` cards one at a time, flipping the
 * discard pile into a freshly shuffled deck whenever the deck runs dry.
 * Cards always arrive in hand face up so their owner can see them.
 */
function draw(owner: Expr | null, n: number): Block {
  return repeat(num(n), [
    iff(eq(zoneCount(zone(DECK, owner)), num(0)), [
      move(ALL, zone(DISCARD, owner), zone(DECK, owner), { faceUp: false }),
      shuffle(zone(DECK, owner)),
    ]),
    move(topN(1), zone(DECK, owner), zone(HAND, owner), { faceUp: true }),
  ]);
}

/** "When you play this" ability: fires when the card enters In Play. */
function onPlay(id: string, name: string, script: Block[], stacked = false): AbilityDef {
  return { id, name, on: 'enterZone', zoneId: INPLAY, phaseId: null, condition: null, script, stacked };
}

function card(
  id: string, name: string, cost: number, ctype: string, coins: number, vp: number, text: string,
  abilities: AbilityDef[] = [],
): CardDef {
  return {
    id, name, templateId: 'dom_tpl_kingdom',
    fields: { [COST]: cost, [CTYPE]: ctype, [COINS_F]: coins, [VP_F]: vp, [TEXT]: text },
    abilities,
  };
}

const OWNER = bnd('$owner');

const CARDS: CardDef[] = [
  // Treasures (played for coins in the Buy phase; no abilities needed).
  card('dom_card_copper', 'Copper', 0, 'treasure', 1, 0, 'Worth 1 coin.'),
  card('dom_card_silver', 'Silver', 3, 'treasure', 2, 0, 'Worth 2 coins.'),
  card('dom_card_gold', 'Gold', 6, 'treasure', 3, 0, 'Worth 3 coins.'),
  // Victory cards (dead weight until the final count).
  card('dom_card_estate', 'Estate', 2, 'victory', 0, 1, 'Worth 1 victory point.'),
  card('dom_card_duchy', 'Duchy', 5, 'victory', 0, 3, 'Worth 3 victory points.'),
  card('dom_card_province', 'Province', 8, 'victory', 0, 6, 'Worth 6 victory points.'),
  // Kingdom actions.
  card('dom_card_village', 'Village', 3, 'action', 0, 0, 'Draw 1 card. Gain 2 extra actions.', [
    onPlay('dom_ab_village', 'Bustling streets', [
      draw(OWNER, 1),
      changeVar(ACTIONS, num(2), OWNER),
    ]),
  ]),
  card('dom_card_smithy', 'Smithy', 4, 'action', 0, 0, 'Draw 3 cards.', [
    onPlay('dom_ab_smithy', 'Forge ahead', [draw(OWNER, 3)]),
  ]),
  card('dom_card_market', 'Market', 5, 'action', 0, 0, 'Draw 1 card. Gain 1 action, 1 buy and 1 coin.', [
    onPlay('dom_ab_market', 'Open for business', [
      draw(OWNER, 1),
      changeVar(ACTIONS, num(1), OWNER),
      changeVar(BUYS, num(1), OWNER),
      changeVar(COINS, num(1), OWNER),
    ]),
  ]),
  card('dom_card_festival', 'Festival', 5, 'action', 0, 0, 'Gain 2 actions, 1 buy and 2 coins.', [
    onPlay('dom_ab_festival', 'Celebration', [
      changeVar(ACTIONS, num(2), OWNER),
      changeVar(BUYS, num(1), OWNER),
      changeVar(COINS, num(2), OWNER),
    ]),
  ]),
  card('dom_card_laboratory', 'Laboratory', 5, 'action', 0, 0, 'Draw 2 cards. Gain 1 extra action.', [
    onPlay('dom_ab_laboratory', 'Experiment', [
      draw(OWNER, 2),
      changeVar(ACTIONS, num(1), OWNER),
    ]),
  ]),
  card('dom_card_woodcutter', 'Woodcutter', 3, 'action', 0, 0, 'Gain 1 buy and 2 coins.', [
    onPlay('dom_ab_woodcutter', 'Timber', [
      changeVar(BUYS, num(1), OWNER),
      changeVar(COINS, num(2), OWNER),
    ]),
  ]),
  card('dom_card_council_room', 'Council Room', 5, 'action', 0, 0,
    'Draw 4 cards and gain 1 buy. Every other player draws 1 card.', [
      onPlay('dom_ab_council', 'Open council', [
        draw(OWNER, 4),
        changeVar(BUYS, num(1), OWNER),
        forEachPlayer([
          iff(neq(bnd('$player'), OWNER), [draw(bnd('$player'), 1)]),
        ]),
      ]),
    ]),
  card('dom_card_militia', 'Militia', 4, 'attack', 0, 0,
    'Gain 2 coins. Every other player discards down to 3 cards in hand (Moat blocks this).', [
      // The coins are immediate; only the attack half goes through the stack,
      // so Moat owners get a response window before anyone has to discard.
      onPlay('dom_ab_militia_coins', 'Press-ganged wages', [
        changeVar(COINS, num(2), OWNER),
      ]),
      onPlay('dom_ab_militia_attack', 'Militia raid', [
        forEachPlayer([
          iff(allOf(neq(bnd('$player'), OWNER), eq(getVar(IMMUNE, bnd('$player')), num(0))), [
            iff(gt(zoneCount(zone(HAND, bnd('$player'))), num(3)), [
              chooseCardsBlock({
                who: bnd('$player'),
                from: zone(HAND, bnd('$player')),
                min: sub(zoneCount(zone(HAND, bnd('$player'))), num(3)),
                max: sub(zoneCount(zone(HAND, bnd('$player'))), num(3)),
                prompt: 'Militia: discard down to 3 cards',
                body: [
                  move(specific(bnd('$card')), zone(HAND, bnd('$player')), zone(DISCARD, bnd('$player')), { faceUp: true }),
                ],
              }),
            ]),
          ]),
        ]),
        forEachPlayer([setVar(IMMUNE, num(0), bnd('$player'))]),
      ], true),
    ]),
  card('dom_card_moat', 'Moat', 2, 'action', 0, 0,
    'Draw 2 cards. Reaction: reveal from your hand to be immune to an attack.', [
      onPlay('dom_ab_moat', 'Across the moat', [draw(OWNER, 2)]),
    ]),
];

const SUPPLY_NAMES = [
  'Copper', 'Silver', 'Gold', 'Estate', 'Duchy', 'Province',
  'Village', 'Smithy', 'Market', 'Festival', 'Laboratory', 'Woodcutter',
  'Council Room', 'Militia', 'Moat',
];

/** Recount every player's victory points from all cards they own. */
const RECOUNT_VP: Block[] = [
  forEachPlayer([
    setVar(VP, num(0), bnd('$player')),
    ...[DECK, HAND, DISCARD, INPLAY].map((z) =>
      forEachCard(zone(z, bnd('$player')), null, [
        changeVar(VP, field(bnd('$card'), VP_F), bnd('$player')),
      ])),
  ]),
];

// --- The war table (showcase screenLayout) ------------------------------------
//
// Geometry is % of the screen (aspect null = fill the viewport); the mobile
// variant is % of a TALL page (aspect 0.42, scroll). cardScale / fontSize /
// gap / padding are % of the SCREEN WIDTH on both. All ids are stable
// ('dom_el_*' / 'dom_el_m_*') so tests and saved tweaks can address them.

// Phase / action ids referenced by the seal (mirror the def literals below).
const PHASE_ACTION = 'dom_phase_action';
const PHASE_BUY = 'dom_phase_buy';
const ACTION_DONE = 'dom_action_done';
const ACTION_END_TURN = 'dom_action_end_turn';

// Palette — hex approximations of the reference table's OKLCH tokens.
const RAISED = '#211816';
const GROUND = '#2b201c';
const HAIRLINE = '#453530';
const INK = '#ece4d8';
const SECONDARY = '#a89484';
const CRIMSON = '#a3342e';
const CRIMSON_BRIGHT = '#cf4439';
const GOLD = '#d2ab66';
const GREEN = '#4f9e63';

const PANEL: LayoutStyle = {
  background: RAISED, borderColor: HAIRLINE, borderWidth: 1, borderStyle: 'solid', borderRadius: 12,
};
const PILE_PANEL: LayoutStyle = {
  background: GROUND, borderColor: HAIRLINE, borderWidth: 1, borderStyle: 'solid', borderRadius: 10,
};
const TRASH_PANEL: LayoutStyle = {
  background: 'rgba(163, 52, 46, 0.06)', borderColor: HAIRLINE, borderWidth: 1,
  borderStyle: 'dashed', borderRadius: 10,
};

// Reactive expressions ($viewer bound by the display evaluator).
const VIEWER = bnd('$viewer');
/** It's the viewing seat's own turn. */
const MY_TURN = eq(CURRENT, VIEWER);
/** The turn belongs to some other seat. */
const THEIR_TURN = neq(CURRENT, VIEWER);
/** The seat after the viewer — the foe the top strip shows (opp1). */
const FOE = nextPlayer(VIEWER);

const PHASE_IDX: Expr = { kind: 'phaseIndex' };
const phasePosOf = (phaseId: string): Expr => ({ kind: 'phasePos', phaseId });
const IN_ACTION = eq(PHASE_IDX, phasePosOf(PHASE_ACTION));
const IN_BUY = eq(PHASE_IDX, phasePosOf(PHASE_BUY));

// Display-only supply slices ($card bound per candidate by the renderer).
const IS_TREASURE = eq(field(bnd('$card'), CTYPE), str('treasure'));
const IS_VICTORY = eq(field(bnd('$card'), CTYPE), str('victory'));
const IS_KINGDOM = not(anyOf(IS_TREASURE, IS_VICTORY));

/** Engraved-style region caption. */
function caption(
  id: string, text: string, rect: { x: number; y: number; w: number; h: number },
  opts: { fontSize?: number; align?: 'left' | 'center' | 'right' } = {},
): ScreenElement {
  return {
    kind: 'text', id, name: text, rect, text,
    fontSize: opts.fontSize ?? 0.85, align: opts.align ?? 'left', color: SECONDARY,
  };
}

/** A phase dot on the seal: a small diamond wired Current → Done. */
function sealDiamond(id: string, name: string, x: number, phaseId: string): ScreenElement {
  return {
    kind: 'shape', id, name, shape: 'diamond',
    rect: { x, y: 9, w: 10, h: 8 },
    style: { background: 'transparent', borderColor: 'rgba(236, 228, 216, 0.45)', borderWidth: 1 },
    states: [
      {
        id: `${id}_current`, name: 'Current', when: eq(PHASE_IDX, phasePosOf(phaseId)),
        style: { background: GOLD, borderColor: GOLD },
      },
      {
        id: `${id}_done`, name: 'Done', when: gt(PHASE_IDX, phasePosOf(phaseId)),
        style: { background: 'rgba(236, 228, 216, 0.35)', borderColor: 'rgba(236, 228, 216, 0.35)' },
      },
    ],
  };
}

const warTable: ScreenLayout = {
  background: 'radial-gradient(120% 90% at 50% 18%, #211816 0%, #171110 58%, #110c0b 100%)',
  aspect: null,
  motion: { flightMs: 430, arc: 46, spin: 4, staggerMs: 55 },
  elements: [
    // --- top strip (~0-5%) ---------------------------------------------------
    {
      kind: 'text', id: 'dom_el_title', name: 'Title',
      rect: { x: 1.5, y: 1, w: 46, h: 3.2 },
      text: 'Dominion — the war table', fontSize: 1.5, bold: true, align: 'left', color: INK,
    },
    {
      kind: 'text', id: 'dom_el_turn', name: 'Turn counter',
      rect: { x: 66, y: 0.8, w: 32.5, h: 3.6 },
      text: '', parts: ['TURN ', TURN_NUMBER],
      fontSize: 1.6, bold: true, align: 'right', color: GOLD,
      onChangeAnim: 'flash',
    },
    // --- foe strip (~5-11%): the opponent's whole economy at a glance --------
    {
      kind: 'group', id: 'dom_el_foe', name: 'Foe strip',
      rect: { x: 0.8, y: 5.4, w: 82.4, h: 5.8 },
      style: PANEL,
      states: [{
        id: 'dom_st_foe_their_turn', name: 'Their turn', when: THEIR_TURN,
        style: { background: GROUND, borderColor: CRIMSON },
      }],
      children: [
        {
          kind: 'text', id: 'dom_el_foe_name', name: 'Foe name',
          rect: { x: 1.2, y: 24, w: 14, h: 52 },
          text: '', parts: [FOE], fontSize: 1.25, bold: true, align: 'left', color: INK,
        },
        {
          kind: 'zone', id: 'dom_el_foe_deck', name: 'Foe deck',
          rect: { x: 16, y: 8, w: 7, h: 84 },
          zoneId: DECK, seat: 'opp1', cardScale: 2.2, showName: false, showCount: true,
        },
        {
          kind: 'zone', id: 'dom_el_foe_hand', name: 'Foe hand',
          rect: { x: 24, y: 8, w: 24, h: 84 },
          zoneId: HAND, seat: 'opp1', cardScale: 2.2, fanAngle: 0, gap: 1.2, showName: false,
        },
        {
          kind: 'zone', id: 'dom_el_foe_discard', name: 'Foe discard',
          rect: { x: 49, y: 8, w: 7, h: 84 },
          zoneId: DISCARD, seat: 'opp1', cardScale: 2.2, showName: false, showCount: true,
        },
        {
          kind: 'zone', id: 'dom_el_foe_inplay', name: 'Foe in play',
          rect: { x: 57.5, y: 8, w: 41, h: 84 },
          zoneId: INPLAY, seat: 'opp1', cardScale: 2.4, gap: 0.8, showName: false,
          visible: gt(zoneCount(zone(INPLAY, FOE)), num(0)), reveal: 'fade',
        },
      ],
    },
    // --- supply (~12-52%): ONE shared zone, three display slices -------------
    caption('dom_el_supply_treasure_label', 'TREASURY', { x: 1.4, y: 12.4, w: 9.4, h: 1.5 }),
    {
      kind: 'zone', id: 'dom_el_supply_treasures', name: 'Supply — treasures',
      rect: { x: 1, y: 14.2, w: 10.2, h: 37.4 },
      zoneId: SUPPLY, seat: 'shared', display: 'piles', cardFilter: IS_TREASURE,
      pileBadgeField: COST, rows: 3, columns: 1,
      cardScale: 4.5, gap: 0.7, padding: 0.6, showName: false, style: PANEL,
    },
    caption('dom_el_supply_victory_label', 'VICTORY', { x: 12.6, y: 12.4, w: 9.4, h: 1.5 }),
    {
      kind: 'zone', id: 'dom_el_supply_victory', name: 'Supply — victory',
      rect: { x: 12.2, y: 14.2, w: 10.2, h: 37.4 },
      zoneId: SUPPLY, seat: 'shared', display: 'piles', cardFilter: IS_VICTORY,
      pileBadgeField: COST, rows: 3, columns: 1,
      cardScale: 4.5, gap: 0.7, padding: 0.6, showName: false, style: PANEL,
    },
    caption('dom_el_supply_kingdom_label', 'KINGDOM', { x: 23.8, y: 12.4, w: 12, h: 1.5 }),
    {
      kind: 'zone', id: 'dom_el_supply_kingdom', name: 'Supply — kingdom',
      rect: { x: 23.4, y: 14.2, w: 59, h: 37.4 },
      zoneId: SUPPLY, seat: 'shared', display: 'piles', cardFilter: IS_KINGDOM,
      pileBadgeField: COST, rows: 2, columns: 5,
      cardScale: 6, gap: 1, padding: 0.8, showName: false, style: PANEL,
    },
    // --- battlefield (~52-70%): in-play row, tickers, the phase seal ----------
    {
      kind: 'zone', id: 'dom_el_my_inplay', name: 'Your in play',
      rect: { x: 1, y: 53.2, w: 54, h: 16.6 },
      zoneId: INPLAY, seat: 'viewer', cardScale: 5.5, gap: 1, padding: 0.6,
      showName: false, style: PILE_PANEL,
      states: [{
        id: 'dom_st_my_inplay_turn', name: 'My turn', when: MY_TURN,
        style: { borderColor: GREEN, background: 'rgba(79, 158, 99, 0.07)' },
      }],
    },
    {
      kind: 'varText', id: 'dom_el_counter_actions', name: 'Actions ticker',
      rect: { x: 56.2, y: 54.6, w: 3.8, h: 4.4 },
      varId: ACTIONS, seat: 'viewer', fontSize: 2.2, bold: true, align: 'center', color: INK,
      ticker: true,
    },
    caption('dom_el_counter_actions_label', 'ACTIONS', { x: 56.2, y: 59.4, w: 3.8, h: 1.5 }, { fontSize: 0.75, align: 'center' }),
    {
      kind: 'varText', id: 'dom_el_counter_buys', name: 'Buys ticker',
      rect: { x: 60.4, y: 54.6, w: 3.8, h: 4.4 },
      varId: BUYS, seat: 'viewer', fontSize: 2.2, bold: true, align: 'center', color: INK,
      ticker: true,
    },
    caption('dom_el_counter_buys_label', 'BUYS', { x: 60.4, y: 59.4, w: 3.8, h: 1.5 }, { fontSize: 0.75, align: 'center' }),
    {
      kind: 'varText', id: 'dom_el_counter_coins', name: 'Coins ticker',
      rect: { x: 64.6, y: 54.6, w: 3.8, h: 4.4 },
      varId: COINS, seat: 'viewer', fontSize: 2.2, bold: true, align: 'center', color: GOLD,
      ticker: true,
    },
    caption('dom_el_counter_coins_label', 'COINS', { x: 64.6, y: 59.4, w: 3.8, h: 1.5 }, { fontSize: 0.75, align: 'center' }),
    // The phase seal: a crimson plate stamped with the current phase. The
    // GROUP carries the 'My turn' ring (its state change retriggers the
    // stamp); the plate SHAPE brightens underneath via the same expression.
    {
      kind: 'group', id: 'dom_el_seal', name: 'Phase seal',
      rect: { x: 69.4, y: 52.8, w: 13.2, h: 17 },
      onChangeAnim: 'stamp',
      states: [{
        id: 'dom_st_seal_my_turn', name: 'My turn', when: MY_TURN,
        style: { borderColor: CRIMSON_BRIGHT, borderWidth: 2, borderRadius: 18 },
      }],
      children: [
        {
          kind: 'shape', id: 'dom_el_seal_bg', name: 'Seal plate', shape: 'rect',
          rect: { x: 0, y: 0, w: 100, h: 100 },
          style: {
            background: 'linear-gradient(160deg, #6d2420 0%, #4a1a16 100%)',
            borderColor: CRIMSON, borderWidth: 1, borderRadius: 16,
          },
          states: [{
            id: 'dom_st_seal_bg_my_turn', name: 'My turn', when: MY_TURN,
            style: {
              background: `linear-gradient(160deg, ${CRIMSON_BRIGHT} 0%, ${CRIMSON} 100%)`,
              borderColor: CRIMSON_BRIGHT,
            },
          }],
        },
        sealDiamond('dom_el_seal_dot_action', 'Action dot', 36, PHASE_ACTION),
        sealDiamond('dom_el_seal_dot_buy', 'Buy dot', 54, PHASE_BUY),
        {
          kind: 'text', id: 'dom_el_seal_phase_action', name: 'Action phase name',
          rect: { x: 4, y: 22, w: 92, h: 20 },
          text: 'Action', fontSize: 1.8, bold: true, align: 'center', color: INK,
          visible: IN_ACTION, reveal: 'fade',
        },
        {
          kind: 'text', id: 'dom_el_seal_phase_buy', name: 'Buy phase name',
          rect: { x: 4, y: 22, w: 92, h: 20 },
          text: 'Buy', fontSize: 1.8, bold: true, align: 'center', color: INK,
          visible: IN_BUY, reveal: 'fade',
        },
        {
          kind: 'text', id: 'dom_el_seal_hint', name: 'Seal hint',
          rect: { x: 4, y: 44, w: 92, h: 12 },
          text: '', parts: [CURRENT, ' commands the field'],
          fontSize: 0.85, align: 'center', color: 'rgba(236, 228, 216, 0.75)',
        },
        {
          kind: 'button', id: 'dom_el_seal_btn_done', name: 'Done (end actions)',
          rect: { x: 12, y: 60, w: 76, h: 32 },
          actionId: ACTION_DONE, label: 'Done', fontSize: 1.1,
          visible: allOf(MY_TURN, IN_ACTION), reveal: 'fade',
        },
        {
          kind: 'button', id: 'dom_el_seal_btn_end', name: 'End turn',
          rect: { x: 12, y: 60, w: 76, h: 32 },
          actionId: ACTION_END_TURN, label: 'End turn', fontSize: 1.1,
          visible: allOf(MY_TURN, IN_BUY), reveal: 'fade',
        },
      ],
    },
    // --- chronicle (right rail) ----------------------------------------------
    caption('dom_el_chronicle_label', 'CHRONICLE', { x: 84.6, y: 5.6, w: 14.6, h: 1.6 }),
    {
      kind: 'log', id: 'dom_el_chronicle', name: 'Chronicle',
      rect: { x: 84.2, y: 7.6, w: 15, h: 62 },
      fontSize: 0.95, turnSeparators: true, style: PANEL,
      // The DGT chronicle collapses into a right-edge tab (state remembered).
      collapsible: { side: 'right', label: 'Chronicle' },
    },
    // --- harbor (~72-100%): deck | fanned hand | discard | the burning trash --
    caption('dom_el_my_deck_label', 'DECK', { x: 1.5, y: 71.8, w: 9.5, h: 1.4 }, { fontSize: 0.75, align: 'center' }),
    {
      kind: 'zone', id: 'dom_el_my_deck', name: 'Your deck',
      rect: { x: 1.5, y: 73.4, w: 9.5, h: 24.8 },
      zoneId: DECK, seat: 'viewer', cardScale: 6, showName: false, showCount: true,
      style: PILE_PANEL,
    },
    {
      kind: 'zone', id: 'dom_el_my_hand', name: 'Your hand',
      rect: { x: 12.5, y: 71.8, w: 54, h: 27.4 },
      zoneId: HAND, seat: 'viewer', cardScale: 8, fanAngle: 2, collapseDuplicates: true,
      gap: 3.4, showName: false,
    },
    caption('dom_el_my_discard_label', 'DISCARD', { x: 68, y: 71.8, w: 9.5, h: 1.4 }, { fontSize: 0.75, align: 'center' }),
    {
      kind: 'zone', id: 'dom_el_my_discard', name: 'Your discard',
      rect: { x: 68, y: 73.4, w: 9.5, h: 24.8 },
      zoneId: DISCARD, seat: 'viewer', cardScale: 6, showName: false, showCount: true,
      style: PILE_PANEL,
    },
    {
      kind: 'zone', id: 'dom_el_trash', name: 'Trash',
      rect: { x: 85.8, y: 73.4, w: 9.5, h: 24.8 },
      zoneId: TRASH, seat: 'shared', cardScale: 6, showCount: true,
      arriveEffect: 'burn', style: TRASH_PANEL,
    },
  ],
  // --- the Crownfall-style mobile column (below 1024px): a tall page ---------
  mobile: {
    background: 'linear-gradient(180deg, #211816 0%, #171110 32%, #120d0c 100%)',
    aspect: 0.42,
    scroll: true,
    elements: [
      // foe strip (~0-6%)
      {
        kind: 'group', id: 'dom_el_m_foe', name: 'Foe strip',
        rect: { x: 1.5, y: 0.5, w: 97, h: 5 },
        style: PANEL,
        states: [{
          id: 'dom_st_m_foe_their_turn', name: 'Their turn', when: THEIR_TURN,
          style: { background: GROUND, borderColor: CRIMSON },
        }],
        children: [
          {
            kind: 'text', id: 'dom_el_m_foe_name', name: 'Foe name',
            rect: { x: 2, y: 26, w: 28, h: 48 },
            text: '', parts: [FOE], fontSize: 3.2, bold: true, align: 'left', color: INK,
          },
          {
            kind: 'zone', id: 'dom_el_m_foe_deck', name: 'Foe deck',
            rect: { x: 32, y: 10, w: 12, h: 80 },
            zoneId: DECK, seat: 'opp1', cardScale: 4.5, showName: false, showCount: true,
          },
          {
            kind: 'zone', id: 'dom_el_m_foe_hand', name: 'Foe hand',
            rect: { x: 46, y: 10, w: 28, h: 80 },
            zoneId: HAND, seat: 'opp1', cardScale: 4.5, fanAngle: 0, gap: 2, showName: false,
          },
          {
            kind: 'zone', id: 'dom_el_m_foe_discard', name: 'Foe discard',
            rect: { x: 78, y: 10, w: 12, h: 80 },
            zoneId: DISCARD, seat: 'opp1', cardScale: 4.5, showName: false, showCount: true,
          },
        ],
      },
      // supply as three horizontal pile rows (~6-34%)
      caption('dom_el_m_supply_treasure_label', 'TREASURY', { x: 2, y: 6.2, w: 40, h: 1 }, { fontSize: 2.2 }),
      {
        kind: 'zone', id: 'dom_el_m_supply_treasures', name: 'Supply — treasures',
        rect: { x: 1.5, y: 7.4, w: 97, h: 7.8 },
        zoneId: SUPPLY, seat: 'shared', display: 'piles', cardFilter: IS_TREASURE,
        pileBadgeField: COST, rows: 1, columns: null,
        cardScale: 12, gap: 1, padding: 0.8, showName: false, style: PANEL,
      },
      caption('dom_el_m_supply_victory_label', 'VICTORY', { x: 2, y: 15.6, w: 40, h: 1 }, { fontSize: 2.2 }),
      {
        kind: 'zone', id: 'dom_el_m_supply_victory', name: 'Supply — victory',
        rect: { x: 1.5, y: 16.8, w: 97, h: 7.8 },
        zoneId: SUPPLY, seat: 'shared', display: 'piles', cardFilter: IS_VICTORY,
        pileBadgeField: COST, rows: 1, columns: null,
        cardScale: 12, gap: 1, padding: 0.8, showName: false, style: PANEL,
      },
      caption('dom_el_m_supply_kingdom_label', 'KINGDOM', { x: 2, y: 25, w: 40, h: 1 }, { fontSize: 2.2 }),
      {
        kind: 'zone', id: 'dom_el_m_supply_kingdom', name: 'Supply — kingdom',
        rect: { x: 1.5, y: 26.2, w: 97, h: 7.8 },
        zoneId: SUPPLY, seat: 'shared', display: 'piles', cardFilter: IS_KINGDOM,
        pileBadgeField: COST, rows: 1, columns: null,
        cardScale: 10.5, gap: 0.5, padding: 0.8, showName: false, style: PANEL,
      },
      // status band (~34-42%): turn, tickers, phase, the in-flow buttons
      {
        kind: 'text', id: 'dom_el_m_turn', name: 'Turn counter',
        rect: { x: 2, y: 34.6, w: 40, h: 1.6 },
        text: '', parts: ['TURN ', TURN_NUMBER],
        fontSize: 3, bold: true, align: 'left', color: GOLD,
        onChangeAnim: 'flash',
      },
      {
        kind: 'varText', id: 'dom_el_m_counter_actions', name: 'Actions ticker',
        rect: { x: 2, y: 36.6, w: 10, h: 2.6 },
        varId: ACTIONS, seat: 'viewer', fontSize: 4.5, bold: true, align: 'center', color: INK,
        ticker: true,
      },
      caption('dom_el_m_counter_actions_label', 'ACTIONS', { x: 2, y: 39.4, w: 10, h: 1 }, { fontSize: 2, align: 'center' }),
      {
        kind: 'varText', id: 'dom_el_m_counter_buys', name: 'Buys ticker',
        rect: { x: 14, y: 36.6, w: 10, h: 2.6 },
        varId: BUYS, seat: 'viewer', fontSize: 4.5, bold: true, align: 'center', color: INK,
        ticker: true,
      },
      caption('dom_el_m_counter_buys_label', 'BUYS', { x: 14, y: 39.4, w: 10, h: 1 }, { fontSize: 2, align: 'center' }),
      {
        kind: 'varText', id: 'dom_el_m_counter_coins', name: 'Coins ticker',
        rect: { x: 26, y: 36.6, w: 10, h: 2.6 },
        varId: COINS, seat: 'viewer', fontSize: 4.5, bold: true, align: 'center', color: GOLD,
        ticker: true,
      },
      caption('dom_el_m_counter_coins_label', 'COINS', { x: 26, y: 39.4, w: 10, h: 1 }, { fontSize: 2, align: 'center' }),
      {
        kind: 'text', id: 'dom_el_m_phase_action', name: 'Action phase name',
        rect: { x: 40, y: 37, w: 18, h: 2 },
        text: 'Action', fontSize: 3, bold: true, align: 'center', color: INK,
        visible: IN_ACTION, reveal: 'fade',
      },
      {
        kind: 'text', id: 'dom_el_m_phase_buy', name: 'Buy phase name',
        rect: { x: 40, y: 37, w: 18, h: 2 },
        text: 'Buy', fontSize: 3, bold: true, align: 'center', color: INK,
        visible: IN_BUY, reveal: 'fade',
      },
      // 44px+ touch targets: 4.9% of the page ≈ 45px at a 380px-wide phone.
      {
        kind: 'button', id: 'dom_el_m_btn_done', name: 'Done (end actions)',
        rect: { x: 60, y: 36.4, w: 38, h: 4.9 },
        actionId: ACTION_DONE, label: 'Done', fontSize: 3.4,
        visible: allOf(MY_TURN, IN_ACTION), reveal: 'fade',
      },
      {
        kind: 'button', id: 'dom_el_m_btn_end', name: 'End turn',
        rect: { x: 60, y: 36.4, w: 38, h: 4.9 },
        actionId: ACTION_END_TURN, label: 'End turn', fontSize: 3.4,
        visible: allOf(MY_TURN, IN_BUY), reveal: 'fade',
      },
      // viewer in play (~42-52%)
      {
        kind: 'zone', id: 'dom_el_m_inplay', name: 'Your in play',
        rect: { x: 1.5, y: 42.6, w: 97, h: 9 },
        zoneId: INPLAY, seat: 'viewer', cardScale: 12, gap: 1, padding: 0.8,
        showName: false, style: PILE_PANEL,
        states: [{
          id: 'dom_st_m_inplay_turn', name: 'My turn', when: MY_TURN,
          style: { borderColor: GREEN, background: 'rgba(79, 158, 99, 0.07)' },
        }],
      },
      // the LARGE hand fan (~52-72%)
      {
        kind: 'zone', id: 'dom_el_m_hand', name: 'Your hand',
        rect: { x: 1.5, y: 52.4, w: 97, h: 19.4 },
        zoneId: HAND, seat: 'viewer', cardScale: 16, fanAngle: 3, collapseDuplicates: true,
        gap: 6, showName: false,
      },
      // deck / discard / trash row (~72-82%)
      caption('dom_el_m_deck_label', 'DECK', { x: 2, y: 72.4, w: 22, h: 0.9 }, { fontSize: 2, align: 'center' }),
      {
        kind: 'zone', id: 'dom_el_m_deck', name: 'Your deck',
        rect: { x: 2, y: 73.5, w: 22, h: 8 },
        zoneId: DECK, seat: 'viewer', cardScale: 13, showName: false, showCount: true,
        style: PILE_PANEL,
      },
      caption('dom_el_m_discard_label', 'DISCARD', { x: 26, y: 72.4, w: 22, h: 0.9 }, { fontSize: 2, align: 'center' }),
      {
        kind: 'zone', id: 'dom_el_m_discard', name: 'Your discard',
        rect: { x: 26, y: 73.5, w: 22, h: 8 },
        zoneId: DISCARD, seat: 'viewer', cardScale: 13, showName: false, showCount: true,
        style: PILE_PANEL,
      },
      {
        kind: 'zone', id: 'dom_el_m_trash', name: 'Trash',
        rect: { x: 74, y: 73.5, w: 24, h: 8 },
        zoneId: TRASH, seat: 'shared', cardScale: 13, showCount: true,
        arriveEffect: 'burn', style: TRASH_PANEL,
      },
      // chronicle (~82-100%)
      caption('dom_el_m_log_label', 'CHRONICLE', { x: 2, y: 82.6, w: 40, h: 0.9 }, { fontSize: 2.2 }),
      {
        kind: 'log', id: 'dom_el_m_log', name: 'Chronicle',
        rect: { x: 1.5, y: 83.8, w: 97, h: 15.4 },
        fontSize: 3, turnSeparators: true, style: PANEL,
      },
    ],
  },
};

export const dominionGame: GameDef = {
  schemaVersion: 1,
  meta: {
    id: 'example_dominion',
    name: 'Dominion',
    description:
      'The classic deck-builder for 2-4 players. Start with 7 Coppers and 3 Estates, buy '
      + 'treasures, actions and victory cards from a shared supply, and grow an engine. '
      + 'Militia attacks through the stack — reveal a Moat in the response window to stay '
      + 'safe. The game ends when the Provinces (or any three piles) run out; most victory '
      + 'points wins.',
    minPlayers: 2,
    maxPlayers: 4,
    accentColor: '#f5a524',
    builtIn: true,
  },

  variables: [
    { id: ACTIONS, name: 'Actions', scope: 'perPlayer', type: 'number', initial: 1 },
    { id: BUYS, name: 'Buys', scope: 'perPlayer', type: 'number', initial: 1 },
    { id: COINS, name: 'Coins', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: VP, name: 'Victory points', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: IMMUNE, name: 'Immune to the attack', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: EMPTY_PILES, name: 'Empty supply piles', scope: 'global', type: 'number', initial: 0 },
  ],

  zones: [
    { id: SUPPLY, name: 'Supply', owner: 'shared', visibility: 'all', layout: 'grid', area: 'center' },
    { id: TRASH, name: 'Trash', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
    { id: DECK, name: 'Deck', owner: 'perPlayer', visibility: 'none', layout: 'stack', area: 'player' },
    { id: HAND, name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'fan', area: 'player' },
    { id: DISCARD, name: 'Discard', owner: 'perPlayer', visibility: 'topCard', layout: 'stack', area: 'player' },
    { id: INPLAY, name: 'In Play', owner: 'perPlayer', visibility: 'all', layout: 'row', area: 'center' },
  ],

  decks: [
    {
      id: 'dom_deck_supply',
      name: 'Supply piles',
      source: {
        kind: 'custom',
        entries: [
          { cardId: 'dom_card_copper', count: 30 },
          { cardId: 'dom_card_silver', count: 20 },
          { cardId: 'dom_card_gold', count: 15 },
          { cardId: 'dom_card_estate', count: 12 },
          { cardId: 'dom_card_duchy', count: 12 },
          { cardId: 'dom_card_province', count: 12 },
          { cardId: 'dom_card_village', count: 10 },
          { cardId: 'dom_card_smithy', count: 10 },
          { cardId: 'dom_card_market', count: 10 },
          { cardId: 'dom_card_festival', count: 10 },
          { cardId: 'dom_card_laboratory', count: 10 },
          { cardId: 'dom_card_woodcutter', count: 10 },
          { cardId: 'dom_card_council_room', count: 10 },
          { cardId: 'dom_card_militia', count: 10 },
          { cardId: 'dom_card_moat', count: 10 },
        ],
      },
      initialZone: SUPPLY,
      shuffle: false,
    },
    {
      id: 'dom_deck_starter',
      name: 'Starting deck',
      // perPlayer initial zone -> every player gets their own 7 Coppers + 3 Estates.
      source: {
        kind: 'custom',
        entries: [
          { cardId: 'dom_card_copper', count: 7 },
          { cardId: 'dom_card_estate', count: 3 },
        ],
      },
      initialZone: DECK,
      shuffle: true,
    },
  ],

  templates: [
    {
      id: 'dom_tpl_kingdom',
      name: 'Kingdom card',
      aspect: 0.714,
      background: 'linear-gradient(170deg, #3a3424 0%, #221d12 65%, #15110a 100%)',
      borderColor: '#6b5b33',
      cornerRadius: 8,
      fields: [
        { id: COST, name: 'Cost', type: 'number' },
        { id: CTYPE, name: 'Type', type: 'text' },
        { id: COINS_F, name: 'Coins', type: 'number' },
        { id: VP_F, name: 'Victory points', type: 'number' },
        { id: TEXT, name: 'Rules text', type: 'text' },
      ],
      elements: [
        { kind: 'box', id: 'dom_el_name_plate', x: 5, y: 4, w: 90, h: 12, fill: 'rgba(12, 9, 3, 0.72)', radius: 3 },
        {
          kind: 'text', id: 'dom_el_name', bind: 'name', text: '',
          x: 8, y: 6.5, w: 84, h: 9, fontSize: 7.5, bold: true, italic: false, align: 'center', color: '#f3e9cf',
        },
        { kind: 'box', id: 'dom_el_art', x: 8, y: 19, w: 84, h: 30, fill: 'rgba(245, 165, 36, 0.08)', radius: 3 },
        {
          kind: 'text', id: 'dom_el_rules', bind: TEXT, text: '',
          x: 9, y: 52, w: 82, h: 26, fontSize: 5.2, bold: false, italic: false, align: 'center', color: '#d8cdaf',
        },
        {
          kind: 'text', id: 'dom_el_type', bind: CTYPE, text: '',
          x: 28, y: 81, w: 44, h: 7, fontSize: 5, bold: false, italic: true, align: 'center', color: '#a99c79',
        },
        { kind: 'stat', id: 'dom_el_cost', bind: COST, x: 5, y: 83, w: 19, h: 13.6, shape: 'circle', bg: '#b8860b', color: '#fff7e0', fontSize: 9 },
      ],
    },
  ],

  cards: CARDS,

  // Opening hands: everyone draws 5 from their freshly shuffled starter deck.
  setup: [
    forEachPlayer([draw(bnd('$player'), 5)]),
  ],

  phases: [
    {
      id: 'dom_phase_action',
      name: 'Action',
      mode: 'manual',
      actionIds: ['dom_action_play', 'dom_action_done'],
      onEnter: [],
    },
    {
      id: 'dom_phase_buy',
      name: 'Buy',
      mode: 'manual',
      actionIds: ['dom_action_treasure', 'dom_action_buy', 'dom_action_end_turn'],
      onEnter: [],
    },
    {
      id: 'dom_phase_cleanup',
      name: 'Cleanup',
      mode: 'auto',
      actionIds: [],
      onEnter: [
        move(ALL, zone(INPLAY), zone(DISCARD), { faceUp: true }),
        move(ALL, zone(HAND), zone(DISCARD), { faceUp: true }),
        draw(null, 5),
        setVar(ACTIONS, num(1)),
        setVar(BUYS, num(1)),
        setVar(COINS, num(0)),
      ],
    },
  ],

  actions: [
    {
      id: 'dom_action_play',
      name: 'Play an action',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      legality: allOf(
        anyOf(eq(field(bnd('$card'), CTYPE), str('action')), eq(field(bnd('$card'), CTYPE), str('attack'))),
        gt(getVar(ACTIONS), num(0)),
      ),
      script: [
        changeVar(ACTIONS, num(-1)),
        announce(CURRENT, ' plays ', bnd('$card'), '.'),
        move(specific(bnd('$card')), zone(HAND), zone(INPLAY), { faceUp: true }),
      ],
    },
    {
      id: 'dom_action_done',
      name: 'End actions',
      target: { kind: 'none' },
      legality: null,
      script: [END_PHASE],
    },
    {
      id: 'dom_action_treasure',
      name: 'Play a treasure',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      legality: eq(field(bnd('$card'), CTYPE), str('treasure')),
      script: [
        changeVar(COINS, field(bnd('$card'), COINS_F)),
        move(specific(bnd('$card')), zone(HAND), zone(INPLAY), { faceUp: true }),
      ],
    },
    {
      id: 'dom_action_buy',
      name: 'Buy a card',
      target: { kind: 'cardInZone', zoneId: SUPPLY, ownerOnly: false },
      legality: allOf(
        lte(field(bnd('$card'), COST), getVar(COINS)),
        gt(getVar(BUYS), num(0)),
      ),
      script: [
        changeVar(COINS, neg(field(bnd('$card'), COST))),
        changeVar(BUYS, num(-1)),
        announce(CURRENT, ' buys ', bnd('$card'), '.'),
        move(specific(bnd('$card')), zone(SUPPLY), zone(DISCARD), { faceUp: true }),
        // Keep scores live so an end mid-turn (last Province) counts this gain.
        ...RECOUNT_VP,
      ],
    },
    {
      id: 'dom_action_end_turn',
      name: 'End turn',
      target: { kind: 'none' },
      legality: null,
      // endPhase (not endTurn) so the Cleanup phase still discards and redraws.
      script: [END_PHASE],
    },
    {
      id: 'dom_action_reveal_moat',
      name: 'Reveal Moat',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      speed: 'response',
      legality: allOf(
        eq(field(bnd('$card'), 'name'), str('Moat')),
        gt(STACK_SIZE, num(0)),
        eq(getVar(IMMUNE, bnd('$player')), num(0)),
      ),
      script: [
        setVar(IMMUNE, num(1)),
        announce(bnd('$player'), ' reveals Moat and is immune to the attack.'),
      ],
    },
  ],

  triggers: [
    {
      id: 'dom_trigger_vp',
      name: 'Recount victory points',
      event: { kind: 'turnEnd' },
      condition: null,
      script: RECOUNT_VP,
    },
    {
      id: 'dom_trigger_piles',
      name: 'Watch the supply piles',
      event: { kind: 'cardLeaveZone', zoneId: SUPPLY },
      condition: null,
      script: [
        setVar(EMPTY_PILES, num(0)),
        ...SUPPLY_NAMES.map((name) =>
          iff(eq(countCards(zone(SUPPLY), eq(field(bnd('$card'), 'name'), str(name))), num(0)), [
            changeVar(EMPTY_PILES, num(1)),
          ])),
      ],
    },
  ],

  endConditions: [
    {
      id: 'dom_end_provinces',
      name: 'Provinces exhausted',
      condition: eq(countCards(zone(SUPPLY), eq(field(bnd('$card'), 'name'), str('Province'))), num(0)),
      winner: { kind: 'highestVar', varId: VP },
    },
    {
      id: 'dom_end_three_piles',
      name: 'Three supply piles empty',
      condition: gte(getVar(EMPTY_PILES), num(3)),
      winner: { kind: 'highestVar', varId: VP },
    },
  ],

  screenLayout: warTable,
};
