/**
 * Magic: The Gathering duel (example_mtg) — a trimmed two-player Magic with
 * real stack semantics: every spell is a stacked action announced onto a
 * shared "The Stack" zone, instants (and mana taps) are response-speed so
 * they work inside priority windows, and Counterspell cancels the top
 * pending effect — exactly counterspell behavior thanks to LIFO resolution.
 *
 * Simplifications vs. paper Magic, by design of the schema: mana is a single
 * generic pool (any land taps for 1), floating mana empties at your own
 * untap (not each phase), creature damage heals at its controller's untap
 * (not at end of turn), and an empty library deals 3 fatigue damage per
 * draw step instead of an instant loss.
 */
import type { CardDef, Expr, GameDef } from '../shared/types';
import {
  CURRENT, END_PHASE, END_TURN, STACK_SIZE, allOf, announce, anyOf, bnd, cancelTop, cardOwner,
  cardZoneId, changeVar, chooseCard, chooseCardsBlock, chooseOption, countCards, eq, field,
  forEachCard, forEachPlayer, getVar, gt, gte, iff, lte, move, neg, neq, nextPlayer, num, repeat,
  setVar, specific, str, topN, zone, zoneCount,
} from './dsl';

// Zone ids
const DECK = 'mtg_zone_deck';
const HAND = 'mtg_zone_hand';
const LANDS = 'mtg_zone_lands';
const FIELD = 'mtg_zone_field';
const GRAVE = 'mtg_zone_graveyard';
const THESTACK = 'mtg_zone_thestack';

// Variable ids
const LIFE = 'mtg_var_life';
const MANA = 'mtg_var_mana';
const LAND_PLAYED = 'mtg_var_land_played';
const TAPPED = 'mtg_var_tapped';
const SICK = 'mtg_var_sick';
const ATTACKING = 'mtg_var_attacking';
const BLOCKING = 'mtg_var_blocking';
const DAMAGE = 'mtg_var_damage';

// Template field ids
const COST = 'mtg_field_cost';
const CTYPE = 'mtg_field_ctype';
const POWER = 'mtg_field_power';
const TOUGH = 'mtg_field_toughness';
const TEXT = 'mtg_field_text';

function card(
  id: string, name: string, cost: number, ctype: string, power: number, toughness: number, text: string,
): CardDef {
  return {
    id, name, templateId: 'mtg_tpl_card',
    fields: { [COST]: cost, [CTYPE]: ctype, [POWER]: power, [TOUGH]: toughness, [TEXT]: text },
    abilities: [],
  };
}

const CARDS: CardDef[] = [
  card('mtg_card_mountain', 'Mountain', 0, 'land', 0, 0, 'Tap to add 1 mana to your pool.'),
  card('mtg_card_island', 'Island', 0, 'land', 0, 0, 'Tap to add 1 mana to your pool.'),
  card('mtg_card_cadet', 'Eager Cadet', 1, 'creature', 1, 1, 'Fresh out of training and ready to march.'),
  card('mtg_card_bears', 'Grizzly Bears', 2, 'creature', 2, 2, 'Do not get between a bear and its forest.'),
  card('mtg_card_giant', 'Hill Giant', 4, 'creature', 3, 3, 'Tall as the hill he calls home.'),
  card('mtg_card_elemental', 'Air Elemental', 5, 'creature', 4, 4, 'A storm given a will of its own.'),
  card('mtg_card_dragon', 'Shivan Dragon', 6, 'creature', 5, 5, 'The undisputed master of the mountains of Shiv.'),
  card('mtg_card_bolt', 'Lightning Bolt', 1, 'instant', 0, 0, 'Deal 3 damage to a creature or player.'),
  card('mtg_card_divination', 'Divination', 3, 'sorcery', 0, 0, 'Draw 2 cards.'),
  card('mtg_card_counterspell', 'Counterspell', 2, 'instant', 0, 0, 'Cancel the spell on top of the stack.'),
];

const ME = bnd('$player');
const OPP = nextPlayer(bnd('$player'));
const OPP_CUR = nextPlayer(CURRENT);

const ctypeIs = (t: string): Expr => eq(field(bnd('$card'), CTYPE), str(t));
const nameIs = (n: string): Expr => eq(field(bnd('$card'), 'name'), str(n));
const cardVarIs = (varId: string, card: Expr, v: number): Expr => eq(getVar(varId, card), num(v));

export const mtgGame: GameDef = {
  schemaVersion: 1,
  meta: {
    id: 'example_mtg',
    name: 'Magic: The Gathering',
    description:
      'A two-player Magic duel with a real stack: play lands, tap them for mana, and cast '
      + 'creatures and spells. Every spell waits in a priority window where instants like '
      + 'Lightning Bolt and Counterspell can respond — counter your opponent at the last '
      + 'moment, then swing with creatures. First player to 0 life loses.',
    minPlayers: 2,
    maxPlayers: 2,
    accentColor: '#4f8cff',
    builtIn: true,
  },

  variables: [
    { id: LIFE, name: 'Life', scope: 'perPlayer', type: 'number', initial: 20 },
    { id: MANA, name: 'Mana', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: LAND_PLAYED, name: 'Land played this turn', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: TAPPED, name: 'Tapped', scope: 'perCard', type: 'number', initial: 0 },
    { id: SICK, name: 'Summoning sickness', scope: 'perCard', type: 'number', initial: 0 },
    { id: ATTACKING, name: 'Attacking', scope: 'perCard', type: 'number', initial: 0 },
    { id: BLOCKING, name: 'Blocking', scope: 'perCard', type: 'number', initial: 0 },
    { id: DAMAGE, name: 'Damage', scope: 'perCard', type: 'number', initial: 0 },
  ],

  zones: [
    { id: DECK, name: 'Library', owner: 'perPlayer', visibility: 'none', layout: 'stack', area: 'player' },
    { id: HAND, name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'fan', area: 'player' },
    { id: LANDS, name: 'Lands', owner: 'perPlayer', visibility: 'all', layout: 'row', area: 'center' },
    { id: FIELD, name: 'Battlefield', owner: 'perPlayer', visibility: 'all', layout: 'row', area: 'center' },
    { id: GRAVE, name: 'Graveyard', owner: 'perPlayer', visibility: 'topCard', layout: 'stack', area: 'player' },
    { id: THESTACK, name: 'The Stack', owner: 'shared', visibility: 'all', layout: 'row', area: 'center' },
  ],

  decks: [
    {
      id: 'mtg_deck_main',
      name: '30-card duel deck',
      source: {
        kind: 'custom',
        entries: [
          { cardId: 'mtg_card_mountain', count: 7 },
          { cardId: 'mtg_card_island', count: 5 },
          { cardId: 'mtg_card_cadet', count: 3 },
          { cardId: 'mtg_card_bears', count: 3 },
          { cardId: 'mtg_card_giant', count: 3 },
          { cardId: 'mtg_card_elemental', count: 2 },
          { cardId: 'mtg_card_dragon', count: 2 },
          { cardId: 'mtg_card_bolt', count: 2 },
          { cardId: 'mtg_card_divination', count: 2 },
          { cardId: 'mtg_card_counterspell', count: 1 },
        ],
      },
      initialZone: DECK,
      shuffle: true,
    },
  ],

  templates: [
    {
      id: 'mtg_tpl_card',
      name: 'Magic card',
      aspect: 0.714,
      background: 'linear-gradient(168deg, #1c2a45 0%, #121a2e 60%, #0a0e1c 100%)',
      borderColor: '#33476b',
      cornerRadius: 8,
      fields: [
        { id: COST, name: 'Mana cost', type: 'number' },
        { id: CTYPE, name: 'Type', type: 'text' },
        { id: POWER, name: 'Power', type: 'number' },
        { id: TOUGH, name: 'Toughness', type: 'number' },
        { id: TEXT, name: 'Rules text', type: 'text' },
      ],
      elements: [
        { kind: 'box', id: 'mtg_el_name_plate', x: 4, y: 4, w: 70, h: 12, fill: 'rgba(6, 10, 20, 0.72)', radius: 3 },
        {
          kind: 'text', id: 'mtg_el_name', bind: 'name', text: '',
          x: 7, y: 6.5, w: 64, h: 9, fontSize: 6.8, bold: true, italic: false, align: 'left', color: '#e8eefb',
        },
        { kind: 'stat', id: 'mtg_el_cost', bind: COST, x: 77, y: 3, w: 19, h: 13.6, shape: 'circle', bg: '#3b5e9e', color: '#e8f0ff', fontSize: 9 },
        { kind: 'box', id: 'mtg_el_art', x: 7, y: 19, w: 86, h: 30, fill: 'rgba(120, 160, 230, 0.08)', radius: 3 },
        {
          kind: 'text', id: 'mtg_el_type', bind: CTYPE, text: '',
          x: 8, y: 51, w: 84, h: 7, fontSize: 4.8, bold: false, italic: true, align: 'left', color: '#9cb0d4',
        },
        {
          kind: 'text', id: 'mtg_el_rules', bind: TEXT, text: '',
          x: 8, y: 59, w: 84, h: 22, fontSize: 5, bold: false, italic: false, align: 'left', color: '#c5d1e8',
        },
        { kind: 'stat', id: 'mtg_el_power', bind: POWER, x: 56, y: 84, w: 18, h: 12.9, shape: 'shield', bg: '#a33c3c', color: '#ffecec', fontSize: 8 },
        { kind: 'stat', id: 'mtg_el_tough', bind: TOUGH, x: 77, y: 84, w: 18, h: 12.9, shape: 'shield', bg: '#3c7a4e', color: '#eaffef', fontSize: 8 },
      ],
    },
  ],

  cards: CARDS,

  cardState: { rotateVar: TAPPED, badgeVars: [DAMAGE] },

  // Opening hands: 7 cards from each player's own shuffled library.
  setup: [
    forEachPlayer([
      repeat(num(7), [
        move(topN(1), zone(DECK, bnd('$player')), zone(HAND, bnd('$player')), { faceUp: true }),
      ]),
    ]),
  ],

  phases: [
    {
      id: 'mtg_phase_untap',
      name: 'Untap & draw',
      mode: 'auto',
      actionIds: [],
      onEnter: [
        setVar(LAND_PLAYED, num(0)),
        setVar(MANA, num(0)),
        forEachCard(zone(LANDS), null, [setVar(TAPPED, num(0))]),
        forEachCard(zone(FIELD), null, [
          setVar(TAPPED, num(0)),
          setVar(SICK, num(0)),
          setVar(ATTACKING, num(0)),
          setVar(BLOCKING, num(0)),
          setVar(DAMAGE, num(0)),
        ]),
        iff(eq(zoneCount(zone(DECK)), num(0)), [
          changeVar(LIFE, num(-3)),
          announce(CURRENT, "'s library is empty — 3 fatigue damage."),
        ], [
          move(topN(1), zone(DECK), zone(HAND), { faceUp: true }),
        ]),
      ],
    },
    {
      id: 'mtg_phase_main',
      name: 'Main',
      mode: 'manual',
      actionIds: ['mtg_action_land', 'mtg_action_tap', 'mtg_action_cast', 'mtg_action_combat'],
      onEnter: [],
    },
    {
      id: 'mtg_phase_combat',
      name: 'Combat',
      mode: 'manual',
      actionIds: ['mtg_action_attack', 'mtg_action_end_turn'],
      onEnter: [],
    },
  ],

  actions: [
    {
      id: 'mtg_action_land',
      name: 'Play a land',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      legality: allOf(ctypeIs('land'), eq(getVar(LAND_PLAYED), num(0))),
      script: [
        setVar(LAND_PLAYED, num(1)),
        announce(CURRENT, ' plays ', bnd('$card'), '.'),
        move(specific(bnd('$card')), zone(HAND), zone(LANDS), { faceUp: true }),
      ],
    },
    {
      id: 'mtg_action_tap',
      name: 'Tap a land for mana',
      target: { kind: 'cardInZone', zoneId: LANDS, ownerOnly: true },
      // Response speed: mana can be produced inside priority windows too.
      speed: 'response',
      legality: cardVarIs(TAPPED, bnd('$card'), 0),
      script: [
        setVar(TAPPED, num(1), bnd('$card')),
        changeVar(MANA, num(1)),
      ],
    },
    {
      // One Cast action covers everything: it is listed in the Main phase (so
      // sorceries/creatures are castable on your own empty stack) AND it is
      // response speed, where the last legality clause restricts it to instants.
      id: 'mtg_action_cast',
      name: 'Cast a spell',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      speed: 'response',
      legality: allOf(
        neq(field(bnd('$card'), CTYPE), str('land')),
        lte(field(bnd('$card'), COST), getVar(MANA, bnd('$player'))),
        anyOf(eq(STACK_SIZE, num(0)), ctypeIs('instant')),
        // Counterspell needs something on the stack to point at.
        anyOf(neq(field(bnd('$card'), 'name'), str('Counterspell')), gt(STACK_SIZE, num(0))),
      ),
      stacked: true,
      announce: [
        changeVar(MANA, neg(field(bnd('$card'), COST))),
        announce(ME, ' casts ', bnd('$card'), '.'),
        move(specific(bnd('$card')), zone(HAND), zone(THESTACK), { faceUp: true }),
      ],
      script: [
        iff(ctypeIs('creature'), [
          move(specific(bnd('$card')), zone(THESTACK), zone(FIELD), { faceUp: true }),
          setVar(SICK, num(1), bnd('$card')),
        ], [
          iff(nameIs('Lightning Bolt'), [
            iff(eq(zoneCount(zone(FIELD, OPP)), num(0)), [
              changeVar(LIFE, num(-3), OPP),
              announce('Lightning Bolt scorches ', OPP, ' for 3.'),
            ], [
              chooseOption('Lightning Bolt: pick a target', [
                { id: 'face', label: 'The opponent' },
                { id: 'creature', label: 'A creature' },
              ], ME),
              iff(eq(bnd('$choice'), str('face')), [
                changeVar(LIFE, num(-3), OPP),
                announce('Lightning Bolt scorches ', OPP, ' for 3.'),
              ], [
                chooseCard({ who: ME, from: zone(FIELD, OPP), prompt: 'Bolt which creature?' }),
                changeVar(DAMAGE, num(3), bnd('$choice')),
                announce('Lightning Bolt scorches ', bnd('$choice'), ' for 3.'),
              ]),
            ]),
          ]),
          iff(nameIs('Divination'), [
            repeat(num(2), [move(topN(1), zone(DECK), zone(HAND), { faceUp: true })]),
            announce(ME, ' draws 2 cards.'),
          ]),
          iff(nameIs('Counterspell'), [
            announce('Counterspell cancels the spell on top of the stack.'),
            cancelTop(GRAVE),
          ]),
          // Spent spells leave the stack zone for their caster's graveyard.
          move(specific(bnd('$card')), zone(THESTACK), zone(GRAVE), { faceUp: true }),
        ]),
      ],
    },
    {
      id: 'mtg_action_combat',
      name: 'To combat',
      target: { kind: 'none' },
      legality: null,
      script: [END_PHASE],
    },
    {
      id: 'mtg_action_attack',
      name: 'Attack',
      target: { kind: 'none' },
      legality: gt(
        countCards(zone(FIELD), allOf(cardVarIs(TAPPED, bnd('$card'), 0), cardVarIs(SICK, bnd('$card'), 0))),
        num(0),
      ),
      // Deliberately NOT stacked: combat resolves immediately, like a fast game.
      script: [
        chooseCardsBlock({
          from: zone(FIELD),
          filter: allOf(cardVarIs(TAPPED, bnd('$card'), 0), cardVarIs(SICK, bnd('$card'), 0)),
          min: num(0),
          max: num(99),
          prompt: 'Choose your attackers',
          body: [
            setVar(TAPPED, num(1), bnd('$card')),
            setVar(ATTACKING, num(1), bnd('$card')),
          ],
        }),
        forEachCard(zone(FIELD), cardVarIs(ATTACKING, bnd('$card'), 1), [
          chooseCard({
            who: OPP_CUR,
            from: zone(FIELD, OPP_CUR),
            // $card inside the filter is the CANDIDATE blocker (it shadows the attacker).
            filter: allOf(cardVarIs(TAPPED, bnd('$card'), 0), cardVarIs(BLOCKING, bnd('$card'), 0)),
            prompt: 'Block this attacker? (or decline)',
            optional: true,
          }),
          iff(bnd('$choice'), [
            setVar(BLOCKING, num(1), bnd('$choice')),
            changeVar(DAMAGE, field(bnd('$card'), POWER), bnd('$choice')),
            changeVar(DAMAGE, field(bnd('$choice'), POWER), bnd('$card')),
            announce(bnd('$choice'), ' blocks ', bnd('$card'), '.'),
          ], [
            changeVar(LIFE, neg(field(bnd('$card'), POWER)), OPP_CUR),
            announce(bnd('$card'), ' hits ', OPP_CUR, ' for ', field(bnd('$card'), POWER), '.'),
          ]),
        ]),
        forEachCard(zone(FIELD), null, [setVar(ATTACKING, num(0))]),
        forEachCard(zone(FIELD, OPP_CUR), null, [setVar(BLOCKING, num(0))]),
      ],
    },
    {
      id: 'mtg_action_end_turn',
      name: 'End turn',
      target: { kind: 'none' },
      legality: null,
      script: [END_TURN],
    },
  ],

  triggers: [
    {
      id: 'mtg_trigger_death',
      name: 'Lethal damage',
      event: { kind: 'varChanged', varId: DAMAGE },
      condition: allOf(
        eq(cardZoneId(bnd('$card')), str(FIELD)),
        gte(getVar(DAMAGE, bnd('$card')), field(bnd('$card'), TOUGH)),
      ),
      script: [
        announce(bnd('$card'), ' is destroyed.'),
        move(specific(bnd('$card')), zone(FIELD), zone(GRAVE, cardOwner(bnd('$card'))), { faceUp: true }),
        setVar(DAMAGE, num(0), bnd('$card')),
      ],
    },
  ],

  endConditions: [
    {
      id: 'mtg_end_opp_dead',
      name: 'Opponent at 0 life',
      condition: lte(getVar(LIFE, OPP_CUR), num(0)),
      winner: { kind: 'player', player: CURRENT },
    },
    {
      id: 'mtg_end_self_dead',
      name: 'Current player at 0 life',
      condition: lte(getVar(LIFE, CURRENT), num(0)),
      winner: { kind: 'player', player: OPP_CUR },
    },
  ],
};
