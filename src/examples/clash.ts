/**
 * Clash (example_clash) — a mini trading-card battler for 2 players, and the
 * showcase for custom card templates + per-card abilities.
 *
 * Each player has their own 20-card creature deck, 20 life, and a mana pool
 * that grows by 1 each turn (capped at 10). A turn is: Draw (auto — ramp +
 * draw, or take 2 fatigue damage on an empty deck), Main (play creatures you
 * can afford, then end your turn), Battle (auto — your creatures hit the
 * opponent's face for their total attack). Reduce the enemy to 0 life to win.
 */
import type { CardDef, GameDef } from '../shared/types';
import {
  announce, bnd, changeVar, CURRENT, eq, field, forEachCard, forEachPlayer, getVar, gt, iff,
  lte, move, neg, nextPlayer, num, repeat, setVar, specific, topN, zone, zoneCount, END_PHASE,
} from './dsl';

// Zone ids
const DECK = 'clash_zone_deck';
const HAND = 'clash_zone_hand';
const FIELD = 'clash_zone_field';

// Variable ids
const LIFE = 'clash_var_life';
const MANA = 'clash_var_mana';
const MAX_MANA = 'clash_var_max_mana';
const DAMAGE = 'clash_var_damage';

// Template field ids
const COST = 'clash_field_cost';
const ATTACK = 'clash_field_attack';
const TEXT = 'clash_field_text';

/** A creature card def; abilities added explicitly where flavor demands. */
function creature(id: string, name: string, cost: number, attack: number, text: string): CardDef {
  return {
    id,
    name,
    templateId: 'clash_tpl_creature',
    fields: { [COST]: cost, [ATTACK]: attack, [TEXT]: text },
    abilities: [],
  };
}

const scout = creature('clash_card_scout', 'Scout', 1, 1, 'When played: draw a card.');
scout.abilities.push({
  id: 'clash_ability_scout_draw',
  name: 'Scouting report',
  on: 'enterZone',
  zoneId: FIELD,
  phaseId: null,
  condition: null,
  script: [
    move(topN(1), zone(DECK, bnd('$owner')), zone(HAND, bnd('$owner'))),
  ],
});

const fireImp = creature('clash_card_fire_imp', 'Fire Imp', 2, 2, 'When played: deal 2 damage to your opponent.');
fireImp.abilities.push({
  id: 'clash_ability_imp_burn',
  name: 'Searing entrance',
  on: 'enterZone',
  zoneId: FIELD,
  phaseId: null,
  condition: null,
  script: [
    changeVar(LIFE, num(-2), nextPlayer(bnd('$owner'))),
    announce(bnd('$self'), ' singes ', nextPlayer(bnd('$owner')), ' for 2 damage.'),
  ],
});

const healer = creature('clash_card_healer', 'Healer', 3, 2, 'When played: restore 3 life to you.');
healer.abilities.push({
  id: 'clash_ability_healer_mend',
  name: 'Soothing light',
  on: 'enterZone',
  zoneId: FIELD,
  phaseId: null,
  condition: null,
  script: [
    changeVar(LIFE, num(3), bnd('$owner')),
    announce(bnd('$self'), ' restores 3 life to ', bnd('$owner'), '.'),
  ],
});

const warBanner = creature('clash_card_war_banner', 'War Banner', 3, 1, 'At the start of your turn: gain 1 extra mana.');
warBanner.abilities.push({
  id: 'clash_ability_banner_rally',
  name: 'Rallying call',
  on: 'turnStart',
  zoneId: FIELD,
  phaseId: null,
  // Fires for any banner on the table — restrict to its controller's turn.
  condition: eq(bnd('$player'), bnd('$owner')),
  script: [
    changeVar(MANA, num(1), bnd('$owner')),
    announce('War Banner grants ', bnd('$owner'), ' an extra mana.'),
  ],
});

const CREATURES: CardDef[] = [
  scout,
  creature('clash_card_wolf_pup', 'Wolf Pup', 1, 2, 'Small, loud, and already chewing on something.'),
  fireImp,
  creature('clash_card_soldier', 'Soldier', 2, 3, 'A steadfast wall of iron and oaths.'),
  healer,
  warBanner,
  creature('clash_card_knight', 'Knight', 4, 4, 'Honor polished to a mirror shine.'),
  creature('clash_card_ogre', 'Ogre', 4, 5, 'Negotiations were brief.'),
  creature('clash_card_assassin', 'Shadow Assassin', 5, 6, 'You will not hear the second strike.'),
  creature('clash_card_dragon', 'Dragon', 6, 7, 'The mountain woke up hungry.'),
];

export const clashGame: GameDef = {
  schemaVersion: 1,
  meta: {
    id: 'example_clash',
    name: 'Clash',
    description:
      'A pocket-sized card battler for 2 players showing off custom cards. Ramp your mana, '
      + 'summon creatures from your own 20-card deck, and swing each turn for their total '
      + 'attack. First player to drop to 0 life loses — running out of cards hurts too.',
    minPlayers: 2,
    maxPlayers: 2,
    accentColor: '#2dd4bf',
    builtIn: true,
  },

  variables: [
    { id: LIFE, name: 'Life', scope: 'perPlayer', type: 'number', initial: 20 },
    { id: MANA, name: 'Mana', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: MAX_MANA, name: 'Max mana', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: DAMAGE, name: 'Battle damage tally', scope: 'global', type: 'number', initial: 0 },
  ],

  zones: [
    { id: DECK, name: 'Deck', owner: 'perPlayer', visibility: 'none', layout: 'stack', area: 'player' },
    { id: HAND, name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'fan', area: 'player' },
    // Both battlefields sit in the center of the table, grouped by owner.
    { id: FIELD, name: 'Field', owner: 'perPlayer', visibility: 'all', layout: 'row', area: 'center' },
  ],

  decks: [
    {
      id: 'clash_deck_creatures',
      name: 'Creature deck',
      // perPlayer initial zone -> every player gets their own full copy.
      source: { kind: 'custom', entries: CREATURES.map((c) => ({ cardId: c.id, count: 2 })) },
      initialZone: DECK,
      shuffle: true,
    },
  ],

  templates: [
    {
      id: 'clash_tpl_creature',
      name: 'Creature',
      aspect: 0.714,
      background: 'linear-gradient(165deg, #233247 0%, #131a29 60%, #0b0e18 100%)',
      borderColor: '#3d5166',
      cornerRadius: 8,
      fields: [
        { id: COST, name: 'Cost', type: 'number' },
        { id: ATTACK, name: 'Attack', type: 'number' },
        { id: TEXT, name: 'Rules text', type: 'text' },
      ],
      elements: [
        { kind: 'box', id: 'clash_el_name_plate', x: 4, y: 4, w: 68, h: 12, fill: 'rgba(7, 11, 19, 0.7)', radius: 3 },
        {
          kind: 'text', id: 'clash_el_name', bind: 'name', text: '',
          x: 7, y: 6.5, w: 62, h: 9, fontSize: 7.5, bold: true, italic: false, align: 'left', color: '#f2f3f8',
        },
        { kind: 'stat', id: 'clash_el_cost', bind: COST, x: 76, y: 3, w: 20, h: 14.3, shape: 'circle', bg: '#2563ad', color: '#eaf2ff', fontSize: 10 },
        { kind: 'box', id: 'clash_el_art', x: 7, y: 19, w: 86, h: 34, fill: 'rgba(125, 170, 220, 0.08)', radius: 3 },
        {
          kind: 'text', id: 'clash_el_rules', bind: TEXT, text: '',
          x: 8, y: 57, w: 84, h: 24, fontSize: 5.5, bold: false, italic: true, align: 'center', color: '#c7d0de',
        },
        { kind: 'stat', id: 'clash_el_attack', bind: ATTACK, x: 5, y: 83, w: 20, h: 14.3, shape: 'shield', bg: '#a33c3c', color: '#ffecec', fontSize: 10 },
      ],
    },
  ],

  cards: CREATURES,

  // Opening hands: 3 cards each off the top of each player's own deck.
  // (`deal` pulls from one shared zone, so per-player decks draw directly.)
  setup: [
    forEachPlayer([
      repeat(num(3), [
        move(topN(1), zone(DECK, bnd('$player')), zone(HAND, bnd('$player'))),
      ]),
    ]),
  ],

  phases: [
    {
      id: 'clash_phase_draw',
      name: 'Draw',
      mode: 'auto',
      actionIds: [],
      onEnter: [
        // Mana ramp: +1 max (cap 10), then refill.
        changeVar(MAX_MANA, num(1)),
        iff(gt(getVar(MAX_MANA), num(10)), [setVar(MAX_MANA, num(10))]),
        setVar(MANA, getVar(MAX_MANA)),
        // Draw — or take fatigue damage on an empty deck.
        iff(
          gt(zoneCount(zone(DECK)), num(0)),
          [move(topN(1), zone(DECK), zone(HAND))],
          [
            changeVar(LIFE, num(-2)),
            announce(CURRENT, ' is out of cards and takes 2 fatigue damage.'),
          ],
        ),
      ],
    },
    {
      id: 'clash_phase_main',
      name: 'Main',
      mode: 'manual',
      actionIds: ['clash_action_play', 'clash_action_end_turn'],
      onEnter: [],
    },
    {
      id: 'clash_phase_battle',
      name: 'Battle',
      mode: 'auto',
      actionIds: [],
      onEnter: [
        setVar(DAMAGE, num(0)),
        forEachCard(zone(FIELD), null, [
          changeVar(DAMAGE, field(bnd('$card'), ATTACK)),
        ]),
        iff(gt(getVar(DAMAGE), num(0)), [
          changeVar(LIFE, neg(getVar(DAMAGE)), nextPlayer(CURRENT)),
          announce(CURRENT, ' attacks for ', getVar(DAMAGE), ' damage.'),
        ]),
      ],
    },
  ],

  actions: [
    {
      id: 'clash_action_play',
      name: 'Play a creature',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      legality: lte(field(bnd('$card'), COST), getVar(MANA)),
      script: [
        changeVar(MANA, neg(field(bnd('$card'), COST))),
        announce(CURRENT, ' plays ', bnd('$card'), '.'),
        move(specific(bnd('$card')), zone(HAND), zone(FIELD), { faceUp: true }),
      ],
    },
    {
      id: 'clash_action_end_turn',
      name: 'End turn',
      target: { kind: 'none' },
      legality: null,
      // endPhase (not endTurn) so the Battle phase still runs.
      script: [END_PHASE],
    },
  ],

  triggers: [],

  // Order matters: if the opponent dropped to 0 this settle, the current
  // player wins even if something also hurt them.
  endConditions: [
    {
      id: 'clash_end_opponent_dead',
      name: 'Opponent defeated',
      condition: lte(getVar(LIFE, nextPlayer(CURRENT)), num(0)),
      winner: { kind: 'player', player: CURRENT },
    },
    {
      id: 'clash_end_self_dead',
      name: 'Current player defeated',
      condition: lte(getVar(LIFE, CURRENT), num(0)),
      winner: { kind: 'player', player: nextPlayer(CURRENT) },
    },
  ],
};
