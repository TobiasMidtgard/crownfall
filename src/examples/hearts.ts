/**
 * Hearts, light (example_hearts) — trick-taking for exactly 4 players.
 *
 * Light ruleset: no passing, any lead is allowed (no 2-of-clubs opening, no
 * "hearts broken" rule), but following suit is enforced when you can. The
 * highest card of the led suit takes the trick and leads next. Every heart
 * taken is 1 point, the queen of spades is 13 — LOWEST score wins when the
 * hands run out.
 */
import type { GameDef } from '../shared/types';
import {
  add, ALL, and, announce, anyOf, bestCard, bnd, changeVar, countCards, CURRENT, deal, eq, field,
  getVar, iff, move, mul, num, PLAYER_COUNT, setNextPlayer, setVar, specific, str, zone, zoneCount,
} from './dsl';

// Zone ids
const STOCK = 'hearts_zone_stock';
const TRICK = 'hearts_zone_trick';
const HAND = 'hearts_zone_hand';
const TAKEN = 'hearts_zone_taken';

// Variable ids
const LEAD_SUIT = 'hearts_var_lead_suit';
const SCORE = 'hearts_var_score';
const PLAYED_BY = 'hearts_var_played_by';
const TRICK_WINNER = 'hearts_var_trick_winner';

export const heartsGame: GameDef = {
  schemaVersion: 1,
  meta: {
    id: 'example_hearts',
    name: 'Hearts',
    description:
      'Trick-taking for exactly 4 players, light rules: follow the led suit if you can; '
      + 'the highest card of that suit takes the trick and leads next. Each heart you take '
      + 'is worth 1 point and the queen of spades a painful 13 — lowest total wins.',
    minPlayers: 4,
    maxPlayers: 4,
    accentColor: '#7c5cff',
    builtIn: true,
  },

  variables: [
    { id: LEAD_SUIT, name: 'Lead suit', scope: 'global', type: 'string', initial: '' },
    { id: TRICK_WINNER, name: 'Trick winner', scope: 'global', type: 'string', initial: '' },
    { id: SCORE, name: 'Points taken', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: PLAYED_BY, name: 'Played by', scope: 'perCard', type: 'string', initial: '' },
  ],

  zones: [
    { id: STOCK, name: 'Stock', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
    { id: TRICK, name: 'Trick', owner: 'shared', visibility: 'all', layout: 'row', area: 'center' },
    { id: HAND, name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'fan', area: 'player' },
    { id: TAKEN, name: 'Taken', owner: 'perPlayer', visibility: 'none', layout: 'stack', area: 'player' },
  ],

  decks: [
    { id: 'hearts_deck_main', name: 'Standard 52', source: { kind: 'standard52' }, initialZone: STOCK, shuffle: true },
  ],

  templates: [],
  cards: [],

  setup: [
    deal(zone(STOCK), HAND, 13),
  ],

  phases: [
    {
      id: 'hearts_phase_play',
      name: 'Play a card',
      onEnter: [],
      actionIds: ['hearts_action_play'],
      mode: 'oneAction',
    },
  ],

  actions: [
    {
      id: 'hearts_action_play',
      name: 'Play',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      legality: anyOf(
        // Leading: anything goes.
        eq(zoneCount(zone(TRICK)), num(0)),
        // Following: the led suit...
        eq(field(bnd('$card'), 'suit'), getVar(LEAD_SUIT)),
        // ...or anything if void in it ($card rebinds inside the filter).
        eq(countCards(zone(HAND), eq(field(bnd('$card'), 'suit'), getVar(LEAD_SUIT))), num(0)),
      ),
      script: [
        iff(eq(zoneCount(zone(TRICK)), num(0)), [
          setVar(LEAD_SUIT, field(bnd('$card'), 'suit')),
        ]),
        setVar(PLAYED_BY, CURRENT, bnd('$card')),
        move(specific(bnd('$card')), zone(HAND), zone(TRICK), { faceUp: true }),
      ],
    },
  ],

  triggers: [
    {
      id: 'hearts_trigger_take',
      name: 'Take the trick',
      event: { kind: 'cardEnterZone', zoneId: TRICK },
      // A trick is complete when everyone has played one card.
      condition: eq(zoneCount(zone(TRICK)), PLAYER_COUNT),
      script: [
        // Highest card of the led suit wins (the lead always matches, so this
        // is never null).
        setVar(TRICK_WINNER, getVar(
          PLAYED_BY,
          bestCard(zone(TRICK), 'highest', 'rank', eq(field(bnd('$card'), 'suit'), getVar(LEAD_SUIT))),
        )),
        // 1 point per heart, 13 for the queen of spades.
        changeVar(
          SCORE,
          add(
            countCards(zone(TRICK), eq(field(bnd('$card'), 'suit'), str('hearts'))),
            mul(num(13), countCards(zone(TRICK), and(
              eq(field(bnd('$card'), 'rank'), num(12)),
              eq(field(bnd('$card'), 'suit'), str('spades')),
            ))),
          ),
          getVar(TRICK_WINNER),
        ),
        announce(getVar(TRICK_WINNER), ' takes the trick.'),
        move(ALL, zone(TRICK), zone(TAKEN, getVar(TRICK_WINNER)), { faceUp: false }),
        setVar(LEAD_SUIT, str('')),
        setNextPlayer(getVar(TRICK_WINNER)),
      ],
    },
  ],

  endConditions: [
    {
      id: 'hearts_end_hands_empty',
      name: 'All cards played',
      condition: and(
        eq(zoneCount(zone(HAND)), num(0)),
        eq(zoneCount(zone(TRICK)), num(0)),
      ),
      winner: { kind: 'lowestVar', varId: SCORE },
    },
  ],
};
