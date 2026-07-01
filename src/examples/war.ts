/**
 * War (example_war) — the classic automatic battle game, 2 players.
 *
 * Each turn the current player flips the top card of their deck into the
 * shared Battle zone. Once both players have flipped (a global `flips`
 * counter reaches 2), a trigger resolves the battle: the highest rank takes
 * both flips plus the whole Pot into its owner's Won pile; a tie declares
 * "War!" and moves the tied cards into the Pot for the NEXT battle to claim
 * (keeping the pot out of the Battle zone is what guarantees every later
 * battle can resolve — otherwise an ace-ace tie could never be beaten).
 * Quick variant: the game ends the moment a player's deck runs out; most
 * cards won wins.
 */
import type { GameDef } from '../shared/types';
import {
  ALL, CURRENT, announce, bestCard, bnd, changeVar, countCards, deal, eq, field, getVar, gt, gte,
  iff, move, num, setVar, topCard, topN, zone, zoneCount,
} from './dsl';

// Zone ids
const STOCK = 'war_zone_stock';
const DECK = 'war_zone_deck';
const WON = 'war_zone_won';
const BATTLE = 'war_zone_battle';
const POT = 'war_zone_pot';

// Variable ids
const FLIPS = 'war_var_flips';
const PLAYED_BY = 'war_var_played_by';
const SCORE = 'war_var_score';
const WAR_RANK = 'war_var_rank';
const WINNER = 'war_var_winner';

export const warGame: GameDef = {
  schemaVersion: 1,
  meta: {
    id: 'example_war',
    name: 'War',
    description:
      'The classic battle of luck for 2 players. Flip the top card of your deck each turn — '
      + 'highest rank takes the pot, ties mean WAR and the pot keeps growing. '
      + 'When a deck runs dry, whoever has won the most cards takes the game.',
    minPlayers: 2,
    maxPlayers: 2,
    accentColor: '#e5484d',
    builtIn: true,
  },

  variables: [
    { id: FLIPS, name: 'Flips this battle', scope: 'global', type: 'number', initial: 0 },
    { id: WAR_RANK, name: 'Best rank in battle', scope: 'global', type: 'number', initial: 0 },
    { id: WINNER, name: 'Battle winner', scope: 'global', type: 'string', initial: '' },
    { id: PLAYED_BY, name: 'Played by', scope: 'perCard', type: 'string', initial: '' },
    { id: SCORE, name: 'Cards won', scope: 'perPlayer', type: 'number', initial: 0 },
  ],

  zones: [
    { id: STOCK, name: 'Stock', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
    { id: BATTLE, name: 'Battle', owner: 'shared', visibility: 'all', layout: 'row', area: 'center' },
    { id: POT, name: 'War pot', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
    { id: DECK, name: 'Deck', owner: 'perPlayer', visibility: 'none', layout: 'stack', area: 'player' },
    { id: WON, name: 'Won', owner: 'perPlayer', visibility: 'none', layout: 'stack', area: 'player' },
  ],

  decks: [
    { id: 'war_deck_main', name: 'Standard 52', source: { kind: 'standard52' }, initialZone: STOCK, shuffle: true },
  ],

  templates: [],
  cards: [],

  // Split the shuffled stock evenly: 26 cards to each player's deck.
  setup: [
    deal(zone(STOCK), DECK, 26),
  ],

  phases: [
    { id: 'war_phase_flip', name: 'Flip', onEnter: [], actionIds: ['war_action_flip'], mode: 'oneAction' },
  ],

  actions: [
    {
      id: 'war_action_flip',
      name: 'Flip a card',
      target: { kind: 'zone', zoneId: DECK, ownerOnly: true },
      legality: gt(zoneCount(zone(DECK)), num(0)),
      script: [
        move(topN(1), zone(DECK), zone(BATTLE), { faceUp: true }),
        // Remember who flipped it (read back when the battle resolves).
        setVar(PLAYED_BY, CURRENT, topCard(zone(BATTLE))),
        changeVar(FLIPS, num(1)),
      ],
    },
  ],

  triggers: [
    {
      id: 'war_trigger_resolve',
      name: 'Resolve battle',
      event: { kind: 'cardEnterZone', zoneId: BATTLE },
      condition: gte(getVar(FLIPS), num(2)),
      script: [
        setVar(WAR_RANK, field(bestCard(zone(BATTLE), 'highest', 'rank'), 'rank')),
        iff(
          // The two flips tied for the highest rank -> war: stash them in the
          // Pot so the NEXT battle (compared only among its own two flips)
          // decides who takes everything. ($card is rebound per candidate
          // inside the filter, so the best rank is staged in a global first.)
          gt(countCards(zone(BATTLE), eq(field(bnd('$card'), 'rank'), getVar(WAR_RANK))), num(1)),
          [
            move(ALL, zone(BATTLE), zone(POT), { faceUp: false }),
            announce('War! The pot grows to ', zoneCount(zone(POT)), ' cards.'),
            setVar(FLIPS, num(0)),
          ],
          [
            setVar(WINNER, getVar(PLAYED_BY, bestCard(zone(BATTLE), 'highest', 'rank'))),
            announce(getVar(WINNER), ' wins the battle and takes ', zoneCount(zone(BATTLE)), ' + ', zoneCount(zone(POT)), ' cards.'),
            changeVar(SCORE, zoneCount(zone(BATTLE)), getVar(WINNER)),
            changeVar(SCORE, zoneCount(zone(POT)), getVar(WINNER)),
            move(ALL, zone(BATTLE), zone(WON, getVar(WINNER)), { faceUp: false }),
            move(ALL, zone(POT), zone(WON, getVar(WINNER)), { faceUp: false }),
            setVar(FLIPS, num(0)),
          ],
        ),
      ],
    },
  ],

  endConditions: [
    {
      id: 'war_end_deck_empty',
      name: 'A deck ran out',
      condition: eq(zoneCount(zone(DECK)), num(0)),
      winner: { kind: 'highestVar', varId: SCORE },
    },
  ],
};
