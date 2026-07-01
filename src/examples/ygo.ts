/**
 * Yu-Gi-Oh classic duel (example_ygo) — two duelists, 8000 life points, and
 * face-down traps that fire through the response window: summons, spells and
 * attack declarations are stacked actions, so a set Trap Hole can swallow a
 * fresh summon and Mirror Force can wipe an attacker's whole offense before
 * the attack lands.
 *
 * Simplifications: one global "pending effect type" string drives trap
 * timing (the stack here is never deeper than one announcement plus inline
 * trap responses), monsters are always face-up (attack vs. defense position
 * only), and set spells stay set (spells are played from hand).
 *
 * Ships the showcase `screenLayout` — a full duel mat with mirrored 5-slot
 * monster / spell-trap grids, LP readouts, a generated phase track (circles
 * wired with phaseIndex/phasePos states) and a composite "Duel controls"
 * group whose buttons gate on display expressions. The mat is turn-REACTIVE:
 * element states glow the viewer's field on their own turn, brighten the
 * opponent band while it is theirs, and pop the Pass button on priority.
 */
import type { CardDef, Expr, GameDef, PhaseDef, ScreenElement, ScreenLayout } from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import { phaseTrackGroup } from '../shared/screenTemplates';
import {
  CURRENT, END_PHASE, END_TURN, STACK_SIZE, STACK_TOP, TURN_NUMBER, allOf, announce, anyOf, bnd,
  cancelTop, changeVar, chooseCard, chooseCardsBlock, endGamePlayer, eq, field, flip, forEachCard,
  forEachPlayer, getVar, gt, gte, iff, lt, lte, move, neg, nextPlayer, not, num, repeat, setVar,
  specific, str, sub, topN, zone, zoneCount,
} from './dsl';

// Zone ids
const DECK = 'ygo_zone_deck';
const HAND = 'ygo_zone_hand';
const MONSTERS = 'ygo_zone_monsters';
const SPELLTRAP = 'ygo_zone_spelltrap';
const GRAVE = 'ygo_zone_graveyard';

// Variable ids
const LP = 'ygo_var_lp';
const SUMMONED = 'ygo_var_summoned';
const DEFENSE = 'ygo_var_defense';
const IS_SET = 'ygo_var_is_set';
const ATTACKED = 'ygo_var_attacked';
const PENDING = 'ygo_var_pending_type';

// Template field ids
const LEVEL = 'ygo_field_level';
const ATK = 'ygo_field_atk';
const DEF = 'ygo_field_def';
const CTYPE = 'ygo_field_ctype';
const TEXT = 'ygo_field_text';

function card(
  id: string, name: string, level: number, atk: number, def: number, ctype: string, text: string,
): CardDef {
  return {
    id, name, templateId: 'ygo_tpl_duel',
    fields: { [LEVEL]: level, [ATK]: atk, [DEF]: def, [CTYPE]: ctype, [TEXT]: text },
    abilities: [],
  };
}

const CARDS: CardDef[] = [
  card('ygo_card_dark_magician', 'Dark Magician', 7, 2500, 2100, 'monster',
    'The ultimate wizard in terms of attack and defense. Tribute 2 monsters to summon.'),
  card('ygo_card_summoned_skull', 'Summoned Skull', 6, 2500, 1200, 'monster',
    'A fiend that strikes with lightning. Tribute 1 monster to summon.'),
  card('ygo_card_la_jinn', 'La Jinn the Mystical Genie of the Lamp', 4, 1800, 1000, 'monster',
    'A genie that obeys its master without question.'),
  card('ygo_card_celtic_guardian', 'Celtic Guardian', 4, 1400, 1200, 'monster',
    'An elf swordsman trained to cut down any attacker.'),
  card('ygo_card_stone_soldier', 'Giant Soldier of Stone', 3, 1300, 2000, 'monster',
    'A towering stone wall — best left in defense position.'),
  card('ygo_card_mystical_elf', 'Mystical Elf', 4, 800, 2000, 'monster',
    'A delicate elf whose prayers form an impressive barrier.'),
  card('ygo_card_dark_hole', 'Dark Hole', 0, 0, 0, 'spell',
    'Destroy every monster on both sides of the field.'),
  card('ygo_card_pot_of_greed', 'Pot of Greed', 0, 0, 0, 'spell',
    'Draw 2 cards from your deck.'),
  card('ygo_card_trap_hole', 'Trap Hole', 0, 0, 0, 'trap',
    'When a monster with 1000 or more ATK is summoned: destroy it.'),
  card('ygo_card_mirror_force', 'Mirror Force', 0, 0, 0, 'trap',
    'When an attack is declared: destroy all of the attacker\'s attack-position monsters.'),
];

const ME = bnd('$player');
const OPP = nextPlayer(bnd('$player'));

const ctypeIs = (t: string): Expr => eq(field(bnd('$card'), CTYPE), str(t));
const nameIs = (n: string): Expr => eq(field(bnd('$card'), 'name'), str(n));
const ATK_OF = (card: Expr): Expr => field(card, ATK);
const DEF_OF = (card: Expr): Expr => field(card, DEF);

// --- Turn structure -----------------------------------------------------------
//
// Hoisted out of the GameDef literal so the duel mat below can GENERATE its
// phase track from the same phase list (one source of truth for ids/names).

const PHASES: PhaseDef[] = [
  {
    id: 'ygo_phase_draw',
    name: 'Draw',
    mode: 'auto',
    actionIds: [],
    onEnter: [
      iff(eq(zoneCount(zone(DECK)), num(0)), [
        announce(CURRENT, ' has no cards left to draw — they lose the duel.'),
        endGamePlayer(nextPlayer(CURRENT)),
      ], [
        move(topN(1), zone(DECK), zone(HAND), { faceUp: true }),
      ]),
    ],
  },
  {
    id: 'ygo_phase_main',
    name: 'Main',
    mode: 'manual',
    actionIds: [
      'ygo_action_summon', 'ygo_action_tribute', 'ygo_action_switch',
      'ygo_action_set', 'ygo_action_spell', 'ygo_action_battle',
    ],
    onEnter: [],
  },
  {
    id: 'ygo_phase_battle',
    name: 'Battle',
    mode: 'manual',
    actionIds: ['ygo_action_attack', 'ygo_action_end_turn'],
    onEnter: [],
  },
];

// --- The duel mat (showcase screenLayout) ------------------------------------
//
// Designed from the VIEWER's perspective (rects are % of the screen; aspect
// null = fill the viewport): the opponent's band on top, the two mirrored
// field grids around the phase track, the viewer's band at the bottom. The
// 'Duel controls' group composites the phase buttons with a caption; its
// buttons hide behind display expressions ($viewer-aware) and auto-disable
// through legality, so the mat stays clean off-turn.
//
// REACTIVE states (first match wins, evaluated with $viewer bound):
//   - the viewer's monster/spell rows glow accent while it's THEIR turn,
//   - the opponent band brightens while the turn belongs to the other seat,
//   - the Pass button turns accent while a response window holds priority,
//   - the generated phase track marks each phase Current/Done via
//     phaseIndex/phasePos (and resets on end turn by construction).

/** Visible only while it's the viewing seat's own turn. */
const MY_TURN: Expr = eq(CURRENT, bnd('$viewer'));
/** The mirror image: the turn belongs to some other seat. */
const THEIR_TURN: Expr = not(eq(CURRENT, bnd('$viewer')));
/** Visible only while a response window is open (something is on the stack). */
const WINDOW_OPEN: Expr = gt(STACK_SIZE, num(0));

const ACCENT = '#b15cff';
const FIELD_STYLE = {
  background: 'rgba(177, 92, 255, 0.05)',
  borderColor: 'rgba(177, 92, 255, 0.3)',
  borderWidth: 1,
  borderStyle: 'solid' as const,
  borderRadius: 12,
};
const TRAP_STYLE = {
  background: 'rgba(177, 92, 255, 0.03)',
  borderColor: 'rgba(177, 92, 255, 0.2)',
  borderWidth: 1,
  borderStyle: 'dashed' as const,
  borderRadius: 12,
};
const PILE_STYLE = { background: 'rgba(255, 255, 255, 0.04)', borderRadius: 10 };

// The generated phase track (replaces the deprecated phaseDots element): one
// labeled circle per phase pre-wired with Current/Done states. The generator
// uid()s its CHILD ids (unique within the def, deterministic only per import),
// so the GROUP gets a stable spread-overridden id the tests can address.
const phaseTrack: ScreenElement = {
  ...phaseTrackGroup({ phases: PHASES } as GameDef, {
    rect: { x: 4, y: 46, w: 50, h: 5 },
    showNames: true,
    activeColor: ACCENT,
  })!,
  id: 'ygo_el_phase_track',
  name: 'Phase track',
};

const duelMat: ScreenLayout = {
  background: 'linear-gradient(180deg, #1d1233 0%, #140c22 48%, #0b0714 100%)',
  aspect: null,
  elements: [
    // --- opponent band (top ~22%) -------------------------------------------
    // Grouped so ONE state can brighten the whole strip while the turn is the
    // other seat's (child rects are % of the group's rect).
    {
      kind: 'group', id: 'ygo_el_opp_band', name: 'Opponent band',
      rect: { x: 0, y: 0, w: 100, h: 20 },
      states: [{
        id: 'ygo_st_opp_band_their_turn', name: 'Their turn', when: THEIR_TURN,
        style: {
          background: 'rgba(177, 92, 255, 0.06)',
          borderColor: 'rgba(177, 92, 255, 0.3)',
          borderWidth: 1, borderStyle: 'solid', borderRadius: 14,
        },
      }],
      children: [
        {
          kind: 'varText', id: 'ygo_el_opp_lp', name: 'Opponent LP',
          rect: { x: 2, y: 10, w: 19, h: 32.5 },
          varId: LP, seat: 'opp1', label: 'LP ',
          fontSize: 3, bold: true, align: 'left', color: '#f3ecff',
        },
        {
          kind: 'zone', id: 'ygo_el_opp_hand', name: 'Opponent hand',
          rect: { x: 22, y: 4, w: 53, h: 97.5 },
          zoneId: HAND, seat: 'opp1', cardScale: 5, gap: 2.4, showName: false,
        },
        {
          kind: 'zone', id: 'ygo_el_opp_deck', name: 'Opponent deck',
          rect: { x: 76.5, y: 6, w: 10.5, h: 92.5 },
          zoneId: DECK, seat: 'opp1', cardScale: 5.5, showName: false, showCount: true,
          style: PILE_STYLE,
        },
        {
          kind: 'zone', id: 'ygo_el_opp_grave', name: 'Opponent graveyard',
          rect: { x: 88, y: 6, w: 10.5, h: 92.5 },
          zoneId: GRAVE, seat: 'opp1', cardScale: 5.5, showName: false, showCount: true,
          style: PILE_STYLE,
        },
      ],
    },
    // --- opponent field: monsters, spells & traps beneath them ---------------
    {
      kind: 'zone', id: 'ygo_el_opp_monsters', name: 'Opponent monsters',
      rect: { x: 9, y: 21.5, w: 82, h: 11.5 },
      zoneId: MONSTERS, seat: 'opp1', rows: 1, columns: 5,
      cardScale: 6, gap: 1.2, padding: 0.6, style: FIELD_STYLE,
    },
    {
      kind: 'zone', id: 'ygo_el_opp_spelltrap', name: 'Opponent spells & traps',
      rect: { x: 9, y: 33.5, w: 82, h: 9.5 },
      zoneId: SPELLTRAP, seat: 'opp1', rows: 1, columns: 5,
      cardScale: 5.4, gap: 1.2, padding: 0.6, style: TRAP_STYLE,
    },
    // --- middle strip ---------------------------------------------------------
    phaseTrack,
    // --- viewer field: spells & traps, then monsters (mirror) ------------------
    // Both rows carry a 'My turn' state: an accent glow that follows the turn
    // marker home (state style merges OVER the base TRAP/FIELD chrome).
    {
      kind: 'zone', id: 'ygo_el_my_spelltrap', name: 'Your spells & traps',
      rect: { x: 9, y: 54, w: 82, h: 9.5 },
      zoneId: SPELLTRAP, seat: 'viewer', rows: 1, columns: 5,
      cardScale: 5.4, gap: 1.2, padding: 0.6, style: TRAP_STYLE,
      states: [{
        id: 'ygo_st_my_spelltrap_turn', name: 'My turn', when: MY_TURN,
        style: { borderColor: 'rgba(177, 92, 255, 0.6)', background: 'rgba(177, 92, 255, 0.06)' },
      }],
    },
    {
      kind: 'zone', id: 'ygo_el_my_monsters', name: 'Your monsters',
      rect: { x: 9, y: 64, w: 82, h: 11.5 },
      zoneId: MONSTERS, seat: 'viewer', rows: 1, columns: 5,
      cardScale: 6, gap: 1.2, padding: 0.6, style: FIELD_STYLE,
      states: [{
        id: 'ygo_st_my_monsters_turn', name: 'My turn', when: MY_TURN,
        style: { borderColor: ACCENT, background: 'rgba(177, 92, 255, 0.1)' },
      }],
    },
    // --- viewer band (bottom ~24%) ----------------------------------------------
    {
      kind: 'zone', id: 'ygo_el_my_hand', name: 'Your hand',
      rect: { x: 2, y: 76.5, w: 56, h: 23 },
      zoneId: HAND, seat: 'viewer', cardScale: 8.5, gap: 4, showName: false,
    },
    {
      kind: 'zone', id: 'ygo_el_my_deck', name: 'Your deck',
      rect: { x: 59.5, y: 77.5, w: 10.5, h: 18.5 },
      zoneId: DECK, seat: 'viewer', cardScale: 5.5, showName: false, showCount: true,
      style: PILE_STYLE,
    },
    {
      kind: 'zone', id: 'ygo_el_my_grave', name: 'Your graveyard',
      rect: { x: 71, y: 77.5, w: 10.5, h: 18.5 },
      zoneId: GRAVE, seat: 'viewer', cardScale: 5.5, showName: false, showCount: true,
      style: PILE_STYLE,
    },
    {
      kind: 'varText', id: 'ygo_el_my_lp', name: 'Your LP',
      rect: { x: 82.5, y: 78, w: 15.5, h: 7 },
      varId: LP, seat: 'viewer', label: 'LP ',
      fontSize: 3, bold: true, align: 'right', color: '#f3ecff',
    },
    // --- duel controls (composite group, painted on top) -------------------------
    {
      kind: 'group', id: 'ygo_el_controls', name: 'Duel controls',
      rect: { x: 56, y: 43.5, w: 42, h: 10 },
      children: [
        {
          kind: 'text', id: 'ygo_el_controls_label', name: 'Controls label',
          rect: { x: 0, y: 0, w: 100, h: 24 },
          text: 'Duel controls', fontSize: 1.1, align: 'center', color: '#8d7cae',
        },
        {
          kind: 'button', id: 'ygo_el_btn_battle', name: 'To battle',
          rect: { x: 1, y: 28, w: 32, h: 70 },
          actionId: 'ygo_action_battle', label: 'To battle',
          visible: MY_TURN, reveal: 'fade',
        },
        {
          kind: 'button', id: 'ygo_el_btn_end_turn', name: 'End turn',
          rect: { x: 34, y: 28, w: 32, h: 70 },
          actionId: 'ygo_action_end_turn', label: 'End turn',
          visible: MY_TURN, reveal: 'fade',
        },
        {
          kind: 'button', id: 'ygo_el_btn_pass', name: 'Pass',
          rect: { x: 67, y: 28, w: 32, h: 70 },
          actionId: PASS_ACTION_ID, label: 'Pass',
          visible: WINDOW_OPEN, reveal: 'scale',
          // Accent pop while priority is live (the same window that reveals
          // it — so the button always arrives hot).
          states: [{
            id: 'ygo_st_pass_priority', name: 'Priority', when: WINDOW_OPEN,
            style: { background: ACCENT, borderRadius: 10 },
          }],
        },
      ],
    },
  ],
};

export const ygoGame: GameDef = {
  schemaVersion: 1,
  meta: {
    id: 'example_ygo',
    name: 'Yu-Gi-Oh',
    description:
      'A classic two-player duel: 8000 life points, normal and tribute summons, attack or '
      + 'defense position, and face-down traps. Summons, spells and attacks all pass through '
      + 'a response window — spring Trap Hole on a freshly summoned monster or wipe an '
      + 'assault with Mirror Force. Win by zeroing your opponent\'s life points or letting '
      + 'them deck out.',
    minPlayers: 2,
    maxPlayers: 2,
    accentColor: '#b15cff',
    builtIn: true,
  },

  variables: [
    { id: LP, name: 'Life points', scope: 'perPlayer', type: 'number', initial: 8000 },
    { id: SUMMONED, name: 'Summoned this turn', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: DEFENSE, name: 'Defense position', scope: 'perCard', type: 'number', initial: 0 },
    { id: IS_SET, name: 'Set face-down', scope: 'perCard', type: 'number', initial: 0 },
    { id: ATTACKED, name: 'Attacked this turn', scope: 'perCard', type: 'number', initial: 0 },
    { id: PENDING, name: 'Pending effect type', scope: 'global', type: 'string', initial: '' },
  ],

  zones: [
    { id: DECK, name: 'Deck', owner: 'perPlayer', visibility: 'none', layout: 'stack', area: 'player' },
    { id: HAND, name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'fan', area: 'player' },
    { id: MONSTERS, name: 'Monster zone', owner: 'perPlayer', visibility: 'all', layout: 'grid', area: 'center', capacity: 5 },
    { id: SPELLTRAP, name: 'Spell & trap zone', owner: 'perPlayer', visibility: 'all', layout: 'grid', area: 'center', capacity: 5 },
    { id: GRAVE, name: 'Graveyard', owner: 'perPlayer', visibility: 'topCard', layout: 'stack', area: 'player' },
  ],

  decks: [
    {
      id: 'ygo_deck_main',
      name: 'Duel deck',
      source: {
        kind: 'custom',
        entries: [
          { cardId: 'ygo_card_dark_magician', count: 2 },
          { cardId: 'ygo_card_summoned_skull', count: 2 },
          { cardId: 'ygo_card_la_jinn', count: 3 },
          { cardId: 'ygo_card_celtic_guardian', count: 3 },
          { cardId: 'ygo_card_stone_soldier', count: 3 },
          { cardId: 'ygo_card_mystical_elf', count: 3 },
          { cardId: 'ygo_card_dark_hole', count: 2 },
          { cardId: 'ygo_card_pot_of_greed', count: 2 },
          { cardId: 'ygo_card_trap_hole', count: 2 },
          { cardId: 'ygo_card_mirror_force', count: 2 },
        ],
      },
      initialZone: DECK,
      shuffle: true,
    },
  ],

  templates: [
    {
      id: 'ygo_tpl_duel',
      name: 'Duel card',
      aspect: 0.714,
      background: 'linear-gradient(170deg, #2e2140 0%, #1c1428 60%, #110b1a 100%)',
      borderColor: '#54407a',
      cornerRadius: 8,
      fields: [
        { id: LEVEL, name: 'Level', type: 'number' },
        { id: ATK, name: 'ATK', type: 'number' },
        { id: DEF, name: 'DEF', type: 'number' },
        { id: CTYPE, name: 'Type', type: 'text' },
        { id: TEXT, name: 'Effect text', type: 'text' },
      ],
      elements: [
        { kind: 'box', id: 'ygo_el_name_plate', x: 4, y: 4, w: 92, h: 11, fill: 'rgba(10, 6, 16, 0.75)', radius: 3 },
        {
          kind: 'text', id: 'ygo_el_name', bind: 'name', text: '',
          x: 6, y: 6, w: 88, h: 8, fontSize: 5.6, bold: true, italic: false, align: 'left', color: '#f0e7fb',
        },
        {
          kind: 'text', id: 'ygo_el_star', bind: null, text: '★',
          x: 76, y: 16.5, w: 8, h: 7, fontSize: 5.4, bold: false, italic: false, align: 'right', color: '#e8b64c',
        },
        {
          kind: 'text', id: 'ygo_el_level', bind: LEVEL, text: '',
          x: 85, y: 16.5, w: 10, h: 7, fontSize: 5.4, bold: true, italic: false, align: 'left', color: '#e8b64c',
        },
        { kind: 'box', id: 'ygo_el_art', x: 8, y: 25, w: 84, h: 30, fill: 'rgba(177, 92, 255, 0.08)', radius: 3 },
        {
          kind: 'text', id: 'ygo_el_type', bind: CTYPE, text: '',
          x: 8, y: 57, w: 84, h: 6, fontSize: 4.6, bold: false, italic: true, align: 'left', color: '#b39cd9',
        },
        {
          kind: 'text', id: 'ygo_el_rules', bind: TEXT, text: '',
          x: 8, y: 64, w: 84, h: 18, fontSize: 4.6, bold: false, italic: false, align: 'left', color: '#cfc2e6',
        },
        { kind: 'stat', id: 'ygo_el_atk', bind: ATK, x: 52, y: 84, w: 21, h: 12.2, shape: 'square', bg: '#8a3038', color: '#ffe9ea', fontSize: 6.2 },
        { kind: 'stat', id: 'ygo_el_def', bind: DEF, x: 75, y: 84, w: 21, h: 12.2, shape: 'square', bg: '#2f5a8a', color: '#e6f1ff', fontSize: 6.2 },
      ],
    },
  ],

  cards: CARDS,

  cardState: { rotateVar: DEFENSE, badgeVars: [] },

  // Opening hands: 5 cards each from their own shuffled deck.
  setup: [
    forEachPlayer([
      repeat(num(5), [
        move(topN(1), zone(DECK, bnd('$player')), zone(HAND, bnd('$player')), { faceUp: true }),
      ]),
    ]),
  ],

  phases: PHASES,

  actions: [
    {
      id: 'ygo_action_summon',
      name: 'Normal summon',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      stacked: true,
      legality: allOf(
        ctypeIs('monster'),
        lte(field(bnd('$card'), LEVEL), num(4)),
        eq(getVar(SUMMONED, bnd('$player')), num(0)),
        lt(zoneCount(zone(MONSTERS, bnd('$player'))), num(5)),
      ),
      announce: [
        setVar(SUMMONED, num(1)),
        setVar(PENDING, str('summon')),
        announce(ME, ' summons ', bnd('$card'), '.'),
        move(specific(bnd('$card')), zone(HAND), zone(MONSTERS), { faceUp: true }),
      ],
      // The summon "effect" is empty — the stack entry exists so set traps
      // get a window to respond before the monster is safely on the field.
      script: [
        announce(bnd('$card'), ' stands ready.'),
      ],
    },
    {
      id: 'ygo_action_tribute',
      name: 'Tribute summon',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      stacked: true,
      legality: allOf(
        ctypeIs('monster'),
        gte(field(bnd('$card'), LEVEL), num(5)),
        eq(getVar(SUMMONED, bnd('$player')), num(0)),
        anyOf(
          allOf(lte(field(bnd('$card'), LEVEL), num(6)), gte(zoneCount(zone(MONSTERS, bnd('$player'))), num(1))),
          gte(zoneCount(zone(MONSTERS, bnd('$player'))), num(2)),
        ),
      ),
      announce: [
        setVar(SUMMONED, num(1)),
        setVar(PENDING, str('summon')),
        iff(gte(field(bnd('$card'), LEVEL), num(7)), [
          chooseCardsBlock({
            from: zone(MONSTERS), min: num(2), max: num(2), prompt: 'Tribute 2 monsters',
            body: [move(specific(bnd('$card')), zone(MONSTERS), zone(GRAVE), { faceUp: true })],
          }),
        ], [
          chooseCardsBlock({
            from: zone(MONSTERS), min: num(1), max: num(1), prompt: 'Tribute 1 monster',
            body: [move(specific(bnd('$card')), zone(MONSTERS), zone(GRAVE), { faceUp: true })],
          }),
        ]),
        announce(ME, ' tribute summons ', bnd('$card'), '.'),
        move(specific(bnd('$card')), zone(HAND), zone(MONSTERS), { faceUp: true }),
      ],
      script: [
        announce(bnd('$card'), ' stands ready.'),
      ],
    },
    {
      id: 'ygo_action_switch',
      name: 'Switch position',
      target: { kind: 'cardInZone', zoneId: MONSTERS, ownerOnly: true },
      legality: eq(getVar(ATTACKED, bnd('$card')), num(0)),
      script: [
        setVar(DEFENSE, sub(num(1), getVar(DEFENSE, bnd('$card'))), bnd('$card')),
        announce(bnd('$card'), ' switches position.'),
      ],
    },
    {
      id: 'ygo_action_set',
      name: 'Set a spell or trap',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      legality: allOf(
        anyOf(ctypeIs('spell'), ctypeIs('trap')),
        lt(zoneCount(zone(SPELLTRAP, bnd('$player'))), num(5)),
      ),
      script: [
        setVar(IS_SET, num(1), bnd('$card')),
        announce(ME, ' sets a card face-down.'),
        move(specific(bnd('$card')), zone(HAND), zone(SPELLTRAP), { faceUp: false }),
      ],
    },
    {
      id: 'ygo_action_spell',
      name: 'Play a spell',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      stacked: true,
      legality: allOf(
        ctypeIs('spell'),
        lt(zoneCount(zone(SPELLTRAP, bnd('$player'))), num(5)),
      ),
      announce: [
        setVar(PENDING, str('spell')),
        announce(ME, ' plays ', bnd('$card'), '.'),
        move(specific(bnd('$card')), zone(HAND), zone(SPELLTRAP), { faceUp: true }),
      ],
      script: [
        iff(nameIs('Dark Hole'), [
          announce('Dark Hole swallows every monster on the field.'),
          forEachPlayer([
            forEachCard(zone(MONSTERS, bnd('$player')), null, [
              move(specific(bnd('$card')), zone(MONSTERS, bnd('$player')), zone(GRAVE, bnd('$player')), { faceUp: true }),
            ]),
          ]),
        ]),
        iff(nameIs('Pot of Greed'), [
          announce(ME, ' draws 2 cards.'),
          repeat(num(2), [move(topN(1), zone(DECK), zone(HAND), { faceUp: true })]),
        ]),
        move(specific(bnd('$card')), zone(SPELLTRAP), zone(GRAVE), { faceUp: true }),
      ],
    },
    {
      id: 'ygo_action_trap',
      name: 'Activate a trap',
      target: { kind: 'cardInZone', zoneId: SPELLTRAP, ownerOnly: true },
      speed: 'response',
      legality: allOf(
        ctypeIs('trap'),
        eq(getVar(IS_SET, bnd('$card')), num(1)),
        gt(STACK_SIZE, num(0)),
        anyOf(
          allOf(
            nameIs('Trap Hole'),
            eq(getVar(PENDING), str('summon')),
            gte(field(STACK_TOP, ATK), num(1000)),
          ),
          allOf(nameIs('Mirror Force'), eq(getVar(PENDING), str('attack'))),
        ),
      ),
      script: [
        setVar(IS_SET, num(0), bnd('$card')),
        flip(zone(SPELLTRAP), specific(bnd('$card')), true),
        announce(ME, ' activates ', bnd('$card'), '!'),
        iff(nameIs('Trap Hole'), [
          // Cancels the summon; the monster drops into its summoner's grave.
          cancelTop(GRAVE),
          announce('The summoned monster falls into the Trap Hole.'),
        ]),
        iff(nameIs('Mirror Force'), [
          // Cancels the attack (the attacker goes to its owner's grave), then
          // shatters the turn player's remaining attack-position monsters.
          cancelTop(GRAVE),
          forEachCard(zone(MONSTERS, CURRENT), eq(getVar(DEFENSE, bnd('$card')), num(0)), [
            move(specific(bnd('$card')), zone(MONSTERS, CURRENT), zone(GRAVE, CURRENT), { faceUp: true }),
          ]),
          announce('Mirror Force shatters the assault.'),
        ]),
        move(specific(bnd('$card')), zone(SPELLTRAP), zone(GRAVE), { faceUp: true }),
      ],
    },
    {
      id: 'ygo_action_attack',
      name: 'Attack',
      target: { kind: 'cardInZone', zoneId: MONSTERS, ownerOnly: true },
      stacked: true,
      legality: allOf(
        eq(getVar(DEFENSE, bnd('$card')), num(0)),
        eq(getVar(ATTACKED, bnd('$card')), num(0)),
        gte(TURN_NUMBER, num(2)),
      ),
      announce: [
        setVar(PENDING, str('attack')),
        setVar(ATTACKED, num(1), bnd('$card')),
        announce(ME, ' attacks with ', bnd('$card'), '.'),
      ],
      script: [
        iff(eq(zoneCount(zone(MONSTERS, OPP)), num(0)), [
          changeVar(LP, neg(ATK_OF(bnd('$card'))), OPP),
          announce(bnd('$card'), ' attacks directly for ', ATK_OF(bnd('$card')), '!'),
        ], [
          chooseCard({ who: ME, from: zone(MONSTERS, OPP), prompt: 'Attack which monster?' }),
          iff(eq(getVar(DEFENSE, bnd('$choice')), num(1)), [
            // Versus defense position: no life damage to the defender's owner.
            iff(gt(ATK_OF(bnd('$card')), DEF_OF(bnd('$choice'))), [
              announce(bnd('$choice'), ' is destroyed behind its defense.'),
              move(specific(bnd('$choice')), zone(MONSTERS, OPP), zone(GRAVE, OPP), { faceUp: true }),
            ], [
              iff(gt(DEF_OF(bnd('$choice')), ATK_OF(bnd('$card'))), [
                changeVar(LP, neg(sub(DEF_OF(bnd('$choice')), ATK_OF(bnd('$card')))), ME),
                announce(bnd('$card'), ' bounces off ', bnd('$choice'), '.'),
              ]),
            ]),
          ], [
            // Attack position battle: compare ATK values.
            iff(gt(ATK_OF(bnd('$card')), ATK_OF(bnd('$choice'))), [
              changeVar(LP, neg(sub(ATK_OF(bnd('$card')), ATK_OF(bnd('$choice')))), OPP),
              announce(bnd('$choice'), ' is destroyed.'),
              move(specific(bnd('$choice')), zone(MONSTERS, OPP), zone(GRAVE, OPP), { faceUp: true }),
            ], [
              iff(gt(ATK_OF(bnd('$choice')), ATK_OF(bnd('$card'))), [
                changeVar(LP, neg(sub(ATK_OF(bnd('$choice')), ATK_OF(bnd('$card')))), ME),
                announce(bnd('$card'), ' is destroyed in battle.'),
                move(specific(bnd('$card')), zone(MONSTERS, ME), zone(GRAVE, ME), { faceUp: true }),
              ], [
                announce('Both monsters are destroyed.'),
                move(specific(bnd('$choice')), zone(MONSTERS, OPP), zone(GRAVE, OPP), { faceUp: true }),
                move(specific(bnd('$card')), zone(MONSTERS, ME), zone(GRAVE, ME), { faceUp: true }),
              ]),
            ]),
          ]),
        ]),
      ],
    },
    {
      id: 'ygo_action_battle',
      name: 'To battle',
      target: { kind: 'none' },
      legality: null,
      script: [END_PHASE],
    },
    {
      id: 'ygo_action_end_turn',
      name: 'End turn',
      target: { kind: 'none' },
      legality: null,
      script: [END_TURN],
    },
  ],

  triggers: [
    {
      id: 'ygo_trigger_turn_end',
      name: 'Reset turn flags',
      event: { kind: 'turnEnd' },
      condition: null,
      script: [
        setVar(SUMMONED, num(0), bnd('$player')),
        forEachCard(zone(MONSTERS, bnd('$player')), null, [
          setVar(ATTACKED, num(0), bnd('$card')),
        ]),
      ],
    },
  ],

  endConditions: [
    {
      id: 'ygo_end_opp_dead',
      name: 'Opponent at 0 LP',
      condition: lte(getVar(LP, nextPlayer(CURRENT)), num(0)),
      winner: { kind: 'player', player: CURRENT },
    },
    {
      id: 'ygo_end_self_dead',
      name: 'Current player at 0 LP',
      condition: lte(getVar(LP, CURRENT), num(0)),
      winner: { kind: 'player', player: nextPlayer(CURRENT) },
    },
  ],

  screenLayout: duelMat,
};
