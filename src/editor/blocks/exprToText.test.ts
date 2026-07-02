/**
 * Tests for the registry factories (every Block/Expr kind has a sound default)
 * and exprToText (every Expr kind renders readable text; key sentences exact).
 */
import { describe, expect, it } from 'vitest';
import type { Block, Expr, GameDef } from '../../shared/types';
import { validateGameDef } from '../../shared/validate';
import {
  announceToText, exprToText, faceUpText, selectorToText, winnerToText, zoneRefToText,
} from './exprToText';
import { BLOCKS, EXPRS, blockMeta, exprMeta } from './registry';

function fixture(): GameDef {
  return {
    schemaVersion: 1,
    meta: { id: 'g1', name: 'Hearts', description: '', minPlayers: 3, maxPlayers: 5 },
    variables: [
      { id: 'v_lead', name: 'lead suit', scope: 'global', type: 'string', initial: '' },
      { id: 'v_score', name: 'score', scope: 'perPlayer', type: 'number', initial: 0 },
    ],
    zones: [
      { id: 'z_trick', name: 'Trick', owner: 'shared', visibility: 'all', layout: 'row', area: 'center' },
      { id: 'z_hand', name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'fan', area: 'player' },
    ],
    decks: [],
    templates: [],
    cards: [],
    setup: [],
    phases: [{ id: 'ph_main', name: 'Main', onEnter: [], actionIds: [], mode: 'manual' }],
    actions: [],
    triggers: [],
    endConditions: [],
    cardTypes: [{ id: 'ty_treasure', name: 'Treasure', color: '#c9a227' }],
    cardTags: [{ id: 'tg_attack', name: 'Attack' }],
    filters: [{ id: 'f_basics', name: 'The basic cards', condition: { kind: 'bool', value: true } }],
  };
}

const ALL_BLOCK_KINDS: Block['kind'][] = [
  'moveCards', 'draw', 'shuffle', 'deal', 'setVar', 'changeVar', 'if', 'repeat',
  'forEachPlayer', 'forEachCard', 'choose', 'chooseCards', 'choosePile',
  'triggerAbilities', 'announce', 'flipCards', 'cancelTopEffect', 'endPhase',
  'endTurn', 'setNextPlayer', 'endGame',
];

const ALL_EXPR_KINDS: Expr['kind'][] = [
  'num', 'str', 'bool', 'getVar', 'zoneCount', 'cardField', 'topCard',
  'binding', 'currentPlayer', 'playerCount', 'turnNumber', 'nextPlayer',
  'cardOwner', 'cardZoneId', 'math', 'compare', 'logic', 'not', 'bestCard',
  'countCards', 'sumCards', 'random', 'stackSize', 'stackTopCard',
  'cardTypeIs', 'cardHasTag', 'filterRef',
];

describe('registry block factories', () => {
  it('covers every Block kind exactly once', () => {
    expect([...BLOCKS.map((m) => m.kind)].sort()).toEqual([...ALL_BLOCK_KINDS].sort());
  });

  it.each(ALL_BLOCK_KINDS)('%s factory builds a valid default block', (kind) => {
    const def = fixture();
    const meta = blockMeta(kind);
    const block = meta.make(def);
    expect(block.kind).toBe(kind);
    expect(meta.label.length).toBeGreaterThan(0);
    expect(meta.description.length).toBeGreaterThan(0);
    expect(meta.color.startsWith('--cat-')).toBe(true);
    // A default block dropped into a healthy game must not introduce errors.
    const errors = validateGameDef({ ...def, setup: [block] }).filter((i) => i.severity === 'error');
    expect(errors).toEqual([]);
  });
});

describe('registry expression factories', () => {
  it('covers every Expr kind exactly once', () => {
    expect([...EXPRS.map((m) => m.kind)].sort()).toEqual([...ALL_EXPR_KINDS].sort());
  });

  it.each(ALL_EXPR_KINDS)('%s factory builds and renders text', (kind) => {
    const def = fixture();
    const meta = exprMeta(kind);
    const expr = meta.make(def, ['$card', '$player']);
    expect(expr.kind).toBe(kind);
    const text = exprToText(def, expr);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
  });

  it('binding factory falls back to $choice with no context bindings', () => {
    const expr = exprMeta('binding').make(fixture(), []);
    expect(expr).toEqual({ kind: 'binding', name: '$choice' });
  });
});

describe('exprToText', () => {
  const def = fixture();
  const cardSuit: Expr = {
    kind: 'cardField', card: { kind: 'binding', name: '$card' }, fieldId: 'suit',
  };
  const leadSuit: Expr = { kind: 'getVar', varId: 'v_lead', target: null };

  it('renders the Hearts follow-suit rule as a readable sentence', () => {
    const followSuit: Expr = {
      kind: 'logic', op: 'or',
      left: {
        kind: 'logic', op: 'or',
        left: {
          kind: 'compare', op: '==',
          left: { kind: 'zoneCount', zone: { zoneId: 'z_trick', owner: null } },
          right: { kind: 'num', value: 0 },
        },
        right: { kind: 'compare', op: '==', left: cardSuit, right: leadSuit },
      },
      right: {
        kind: 'compare', op: '==',
        left: {
          kind: 'countCards',
          zone: { zoneId: 'z_hand', owner: null },
          filter: { kind: 'compare', op: '==', left: cardSuit, right: leadSuit },
        },
        right: { kind: 'num', value: 0 },
      },
    };
    expect(exprToText(def, followSuit)).toBe(
      'card count in Trick = 0 OR suit of $card = lead suit OR '
      + 'count of cards in Hand (mine) where suit of $card = lead suit = 0',
    );
  });

  it('renders zone refs with owner context', () => {
    expect(zoneRefToText(def, { zoneId: 'z_trick', owner: null })).toBe('Trick');
    expect(zoneRefToText(def, { zoneId: 'z_hand', owner: null })).toBe('Hand (mine)');
    expect(zoneRefToText(def, { zoneId: 'z_hand', owner: { kind: 'binding', name: '$player' } })).toBe('Hand ($player)');
    expect(zoneRefToText(def, { zoneId: 'z_hand', owner: { kind: 'currentPlayer' } })).toBe('Hand (current player)');
    expect(zoneRefToText(def, { zoneId: 'nope', owner: null })).toContain('missing');
  });

  it('renders per-player variable reads with a target', () => {
    expect(exprToText(def, { kind: 'getVar', varId: 'v_score', target: { kind: 'binding', name: '$player' } }))
      .toBe('score of $player');
    expect(exprToText(def, { kind: 'getVar', varId: 'gone', target: null })).toContain('missing');
  });

  it('parenthesizes only where the sentence could mis-read', () => {
    const and: Expr = { kind: 'logic', op: 'and', left: { kind: 'bool', value: true }, right: { kind: 'bool', value: false } };
    const or: Expr = { kind: 'logic', op: 'or', left: and, right: { kind: 'bool', value: true } };
    expect(exprToText(def, or)).toBe('(yes AND no) OR yes');
    const sum: Expr = { kind: 'math', op: '+', left: { kind: 'num', value: 1 }, right: { kind: 'num', value: 2 } };
    expect(exprToText(def, { kind: 'compare', op: '>', left: sum, right: { kind: 'num', value: 2 } })).toBe('1 + 2 > 2');
    expect(exprToText(def, { kind: 'math', op: '*', left: sum, right: { kind: 'num', value: 3 } })).toBe('(1 + 2) × 3');
  });

  it('renders the remaining helpers readably', () => {
    expect(selectorToText(def, { kind: 'top', count: { kind: 'num', value: 1 } })).toBe('top 1');
    expect(selectorToText(def, { kind: 'all' })).toBe('all');
    expect(selectorToText(def, { kind: 'specific', card: { kind: 'binding', name: '$choice' } })).toBe('$choice');
    expect(faceUpText(null)).toBe('keep facing');
    expect(faceUpText(true)).toBe('face up');
    expect(winnerToText(def, { kind: 'highestVar', varId: 'v_score' })).toBe('highest score');
    expect(winnerToText(def, { kind: 'draw' })).toBe('a draw');
    expect(announceToText(def, ['Trick won by', { kind: 'currentPlayer' }])).toBe('Trick won by [current player]');
    expect(exprToText(def, { kind: 'bestCard', zone: { zoneId: 'z_trick', owner: null }, by: 'highest', fieldId: 'rank', filter: null }))
      .toBe('highest rank card in Trick');
    expect(exprToText(def, { kind: 'random', max: { kind: 'num', value: 6 } })).toBe('random 1 to 6');
  });

  it('renders the card vocabulary with names from the def, ids as fallback', () => {
    const card: Expr = { kind: 'binding', name: '$card' };
    expect(exprToText(def, { kind: 'cardTypeIs', card, typeId: 'ty_treasure' })).toBe('$card is a Treasure');
    expect(exprToText(def, { kind: 'cardHasTag', card, tagId: 'tg_attack' })).toBe('$card has tag Attack');
    expect(exprToText(def, { kind: 'filterRef', filterId: 'f_basics', card })).toBe('$card matches The basic cards');
    // Dangling ids fall back to the raw id (validate flags them separately).
    expect(exprToText(def, { kind: 'cardTypeIs', card, typeId: 'ty_gone' })).toBe('$card is a ty_gone');
    expect(exprToText(def, { kind: 'cardHasTag', card, tagId: 'tg_gone' })).toBe('$card has tag tg_gone');
    expect(exprToText(def, { kind: 'filterRef', filterId: 'f_gone', card })).toBe('$card matches f_gone');
  });

  it('renders sumCards and the contains op readably', () => {
    expect(exprToText(def, { kind: 'sumCards', zone: { zoneId: 'z_hand', owner: null }, fieldId: 'rank', filter: null }))
      .toBe('sum of rank in Hand (mine)');
    expect(exprToText(def, {
      kind: 'sumCards', zone: { zoneId: 'z_trick', owner: null }, fieldId: 'rank',
      filter: { kind: 'compare', op: '==', left: cardSuit, right: { kind: 'str', value: 'hearts' } },
    })).toBe('sum of rank in Trick where suit of $card = "hearts"');
    expect(exprToText(def, {
      kind: 'compare', op: 'contains',
      left: { kind: 'cardField', card: { kind: 'binding', name: '$card' }, fieldId: 'suit' },
      right: { kind: 'str', value: 'action' },
    })).toBe('suit of $card contains "action"');
  });
});
