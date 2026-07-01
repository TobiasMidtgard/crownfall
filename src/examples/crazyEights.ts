/**
 * Crazy Eights (example_crazy8s) — the classic shedding game, 2-4 players.
 *
 * Match the discard's suit or rank, or play an 8 and call any suit (eights
 * track the called suit in a global `currentSuit` variable). Can't or won't
 * play? Draw one card from the stock instead — either way your turn ends
 * (oneAction phase). When the stock empties, the discard pile (minus its top
 * card) is shuffled back in. First empty hand wins.
 */
import type { GameDef } from '../shared/types';
import {
  and, announce, anyOf, bnd, bottomN, chooseOption, CURRENT, deal, eq, field, getVar, gt, iff, move,
  num, repeat, setVar, shuffle, specific, sub, topCard, topN, zone, zoneCount,
} from './dsl';

// Zone ids
const STOCK = 'c8_zone_stock';
const DISCARD = 'c8_zone_discard';
const HAND = 'c8_zone_hand';

// Variable ids
const CURRENT_SUIT = 'c8_var_current_suit';

export const crazyEightsGame: GameDef = {
  schemaVersion: 1,
  meta: {
    id: 'example_crazy8s',
    name: 'Crazy Eights',
    description:
      'The classic shedding game for 2-4 players. Match the top discard by suit or rank, '
      + 'or play an eight and call any suit you like. No play? Draw a card. '
      + 'First player to empty their hand wins.',
    minPlayers: 2,
    maxPlayers: 4,
    accentColor: '#4f8cff',
    builtIn: true,
  },

  variables: [
    { id: CURRENT_SUIT, name: 'Current suit', scope: 'global', type: 'string', initial: '' },
  ],

  zones: [
    { id: STOCK, name: 'Stock', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
    { id: DISCARD, name: 'Discard', owner: 'shared', visibility: 'topCard', layout: 'stack', area: 'center' },
    { id: HAND, name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'fan', area: 'player' },
  ],

  decks: [
    { id: 'c8_deck_main', name: 'Standard 52', source: { kind: 'standard52' }, initialZone: STOCK, shuffle: true },
  ],

  templates: [],
  cards: [],

  setup: [
    deal(zone(STOCK), HAND, 5),
    move(topN(1), zone(STOCK), zone(DISCARD), { faceUp: true }),
    setVar(CURRENT_SUIT, field(topCard(zone(DISCARD)), 'suit')),
  ],

  phases: [
    {
      id: 'c8_phase_play',
      name: 'Play or draw',
      onEnter: [],
      actionIds: ['c8_action_play', 'c8_action_draw'],
      mode: 'oneAction',
    },
  ],

  actions: [
    {
      id: 'c8_action_play',
      name: 'Play a card',
      target: { kind: 'cardInZone', zoneId: HAND, ownerOnly: true },
      legality: anyOf(
        eq(field(bnd('$card'), 'suit'), getVar(CURRENT_SUIT)),
        eq(field(bnd('$card'), 'rank'), field(topCard(zone(DISCARD)), 'rank')),
        eq(field(bnd('$card'), 'rank'), num(8)),
      ),
      script: [
        // Suit bookkeeping first, then the move — eights ask for a suit call.
        iff(
          eq(field(bnd('$card'), 'rank'), num(8)),
          [
            chooseOption('Choose a suit', [
              { id: 'spades', label: 'Spades' },
              { id: 'hearts', label: 'Hearts' },
              { id: 'diamonds', label: 'Diamonds' },
              { id: 'clubs', label: 'Clubs' },
            ]),
            setVar(CURRENT_SUIT, bnd('$choice')),
            announce(CURRENT, ' plays ', bnd('$card'), ' and calls ', bnd('$choice'), '.'),
          ],
          [
            setVar(CURRENT_SUIT, field(bnd('$card'), 'suit')),
            announce(CURRENT, ' plays ', bnd('$card'), '.'),
          ],
        ),
        move(specific(bnd('$card')), zone(HAND), zone(DISCARD), { faceUp: true }),
      ],
    },
    {
      id: 'c8_action_draw',
      name: 'Draw a card',
      target: { kind: 'zone', zoneId: STOCK, ownerOnly: false },
      legality: gt(zoneCount(zone(STOCK)), num(0)),
      script: [
        // faceUp explicitly: cards reshuffled from the discard were turned
        // face-down, and a face-down card in your own hand is invisible to you.
        move(topN(1), zone(STOCK), zone(HAND), { faceUp: true }),
        announce(CURRENT, ' draws a card.'),
      ],
    },
  ],

  triggers: [
    {
      id: 'c8_trigger_reshuffle',
      name: 'Reshuffle the stock',
      event: { kind: 'zoneEmptied', zoneId: STOCK },
      condition: gt(zoneCount(zone(DISCARD)), num(1)),
      script: [
        // Everything except the top discard goes back; `repeat` evaluates its
        // count once, so the shrinking pile doesn't affect the loop.
        repeat(sub(zoneCount(zone(DISCARD)), num(1)), [
          move(bottomN(1), zone(DISCARD), zone(STOCK), { faceUp: false }),
        ]),
        shuffle(zone(STOCK)),
        announce('The discard pile is shuffled back into the stock.'),
      ],
    },
    {
      // zoneEmptied is edge-triggered: if the stock ran out while the discard
      // held only its top card, no reshuffle happened then — so also refill
      // when a later play grows the discard while the stock sits empty.
      id: 'c8_trigger_reshuffle_late',
      name: 'Reshuffle once the discard regrows',
      event: { kind: 'cardEnterZone', zoneId: DISCARD },
      condition: and(eq(zoneCount(zone(STOCK)), num(0)), gt(zoneCount(zone(DISCARD)), num(1))),
      script: [
        repeat(sub(zoneCount(zone(DISCARD)), num(1)), [
          move(bottomN(1), zone(DISCARD), zone(STOCK), { faceUp: false }),
        ]),
        shuffle(zone(STOCK)),
        announce('The discard pile is shuffled back into the stock.'),
      ],
    },
  ],

  endConditions: [
    {
      id: 'c8_end_hand_empty',
      name: 'A hand is empty',
      condition: eq(zoneCount(zone(HAND)), num(0)),
      winner: { kind: 'player', player: CURRENT },
    },
  ],
};
