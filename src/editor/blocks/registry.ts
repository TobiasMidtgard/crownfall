/**
 * Block & expression registry: one metadata entry per Block/Expr kind —
 * category, color token, human label, plain-language description, and a
 * factory producing a sensible default instance for the current GameDef.
 *
 * The keyed records below are exhaustive over the schema unions, so adding a
 * kind to src/shared/types.ts fails compilation here until it gets metadata.
 */
import type { Block, Expr, GameDef, ZoneRef } from '../../shared/types';

export type BlockCategory = 'cards' | 'vars' | 'control' | 'players' | 'game';
export type ExprCategory = 'values' | 'vars' | 'zones' | 'cards' | 'players' | 'game' | 'logic';

export interface BlockMeta {
  kind: Block['kind'];
  category: BlockCategory;
  /** CSS custom property token, e.g. '--cat-cards'. */
  color: string;
  label: string;
  description: string;
  make: (def: GameDef) => Block;
}

export interface ExprMeta {
  kind: Expr['kind'];
  category: ExprCategory;
  color: string;
  label: string;
  description: string;
  make: (def: GameDef, bindings: string[]) => Expr;
}

const BLOCK_COLOR: Record<BlockCategory, string> = {
  cards: '--cat-cards',
  vars: '--cat-vars',
  control: '--cat-control',
  players: '--cat-players',
  game: '--cat-game',
};

const EXPR_COLOR: Record<ExprCategory, string> = {
  values: '--cat-expr',
  vars: '--cat-vars',
  zones: '--cat-cards',
  cards: '--cat-cards',
  players: '--cat-players',
  game: '--cat-game',
  logic: '--cat-control',
};

export const BLOCK_CATEGORY_LABELS: { id: BlockCategory; label: string }[] = [
  { id: 'cards', label: 'Cards' },
  { id: 'vars', label: 'Variables' },
  { id: 'control', label: 'Control' },
  { id: 'players', label: 'Players' },
  { id: 'game', label: 'Game' },
];

export const EXPR_CATEGORY_LABELS: { id: ExprCategory; label: string }[] = [
  { id: 'values', label: 'Values' },
  { id: 'vars', label: 'Variables' },
  { id: 'zones', label: 'Zones' },
  { id: 'cards', label: 'Cards' },
  { id: 'players', label: 'Players' },
  { id: 'game', label: 'Game' },
  { id: 'logic', label: 'Compare · Math · Logic' },
];

// --- factory helpers --------------------------------------------------------

const num = (value: number): Expr => ({ kind: 'num', value });

function firstZoneRef(def: GameDef): ZoneRef {
  return { zoneId: def.zones[0]?.id ?? '', owner: null };
}

function secondZoneRef(def: GameDef): ZoneRef {
  return { zoneId: (def.zones[1] ?? def.zones[0])?.id ?? '', owner: null };
}

function firstPerPlayerZoneId(def: GameDef): string {
  return (def.zones.find((z) => z.owner === 'perPlayer') ?? def.zones[0])?.id ?? '';
}

function firstSharedZoneRef(def: GameDef): ZoneRef {
  return { zoneId: (def.zones.find((z) => z.owner === 'shared') ?? def.zones[0])?.id ?? '', owner: null };
}

/** First zone whose name matches, else null (draw block defaults). */
function zoneRefByName(def: GameDef, pattern: RegExp): ZoneRef | null {
  const zone = def.zones.find((z) => pattern.test(z.name));
  return zone ? { zoneId: zone.id, owner: null } : null;
}

/** Sensible default comparison: "card count in <first zone> = 0". */
export function defaultCompare(def: GameDef): Expr {
  return { kind: 'compare', op: '==', left: { kind: 'zoneCount', zone: firstZoneRef(def) }, right: num(0) };
}

/** Default card expr: prefer a card binding from context, else a zone's top card. */
export function defaultCardExpr(def: GameDef, bindings: string[]): Expr {
  if (bindings.includes('$card')) return { kind: 'binding', name: '$card' };
  if (bindings.includes('$self')) return { kind: 'binding', name: '$self' };
  return { kind: 'topCard', zone: firstZoneRef(def) };
}

/** Default per-card filter: "rank of $card = 14" (reads sensibly, easy to edit). */
export function defaultCardFilter(def: GameDef): Expr {
  void def;
  return {
    kind: 'compare', op: '==',
    left: { kind: 'cardField', card: { kind: 'binding', name: '$card' }, fieldId: 'rank' },
    right: num(14),
  };
}

// --- blocks ------------------------------------------------------------------

type BlockEntry = { category: BlockCategory; label: string; description: string; make: (def: GameDef) => Block };

const BLOCK_ENTRIES: { [K in Block['kind']]: BlockEntry } = {
  moveCards: {
    category: 'cards', label: 'Move cards',
    description: 'Move cards from one zone to another.',
    make: (def) => ({
      kind: 'moveCards', from: firstZoneRef(def), to: secondZoneRef(def),
      cards: { kind: 'top', count: num(1) }, toPosition: 'top', faceUp: null,
    }),
  },
  draw: {
    category: 'cards', label: 'Draw cards',
    description: 'Move cards one at a time (deck → hand), reshuffling a refill zone in when the source runs out. Moves are tagged "draw".',
    make: (def) => {
      const from = zoneRefByName(def, /deck|draw|library|stock/i) ?? firstZoneRef(def);
      const refill = zoneRefByName(def, /discard|grave/i);
      return {
        kind: 'draw', who: null, count: num(1), from,
        refillFrom: refill && refill.zoneId !== from.zoneId ? refill : null,
        to: zoneRefByName(def, /hand/i) ?? secondZoneRef(def),
        faceUp: null, tag: 'draw',
      };
    },
  },
  deal: {
    category: 'cards', label: 'Deal',
    description: 'Deal cards from a pile to every player, round-robin.',
    make: (def) => ({ kind: 'deal', from: firstSharedZoneRef(def), toZoneId: firstPerPlayerZoneId(def), count: num(1) }),
  },
  shuffle: {
    category: 'cards', label: 'Shuffle',
    description: 'Shuffle all cards in a zone.',
    make: (def) => ({ kind: 'shuffle', zone: firstZoneRef(def) }),
  },
  flipCards: {
    category: 'cards', label: 'Flip cards',
    description: 'Turn cards face up or face down where they are.',
    make: (def) => ({ kind: 'flipCards', zone: firstZoneRef(def), cards: { kind: 'all' }, faceUp: true }),
  },
  setVar: {
    category: 'vars', label: 'Set variable',
    description: 'Set a variable to a value.',
    make: (def) => ({ kind: 'setVar', varId: def.variables[0]?.id ?? '', target: null, value: num(0) }),
  },
  changeVar: {
    category: 'vars', label: 'Change variable',
    description: 'Add to (or subtract from) a number variable.',
    make: (def) => ({ kind: 'changeVar', varId: def.variables[0]?.id ?? '', target: null, by: num(1) }),
  },
  if: {
    category: 'control', label: 'If / else',
    description: 'Run blocks only when a condition holds.',
    make: (def) => ({ kind: 'if', cond: defaultCompare(def), then: [], else: [] }),
  },
  repeat: {
    category: 'control', label: 'Repeat',
    description: 'Run blocks a number of times.',
    make: () => ({ kind: 'repeat', times: num(2), body: [] }),
  },
  forEachPlayer: {
    category: 'control', label: 'For each player',
    description: 'Run blocks once per player ($player), from the current player. Flip the chip to "each opponent" to skip the current player (attacks).',
    make: () => ({ kind: 'forEachPlayer', body: [] }),
  },
  forEachCard: {
    category: 'control', label: 'For each card',
    description: 'Run blocks once per matching card ($card) in a zone.',
    make: (def) => ({ kind: 'forEachCard', zone: firstZoneRef(def), filter: null, body: [] }),
  },
  choose: {
    category: 'players', label: 'Ask to choose',
    description: 'Pause and let a player pick a card, option, player, or yes/no. The answer becomes $choice.',
    make: (def) => ({
      kind: 'choose', who: null,
      choice: { kind: 'card', from: firstZoneRef(def), filter: null, prompt: 'Choose a card', optional: false },
    }),
  },
  chooseCards: {
    category: 'players', label: 'Ask to choose several cards',
    description: 'Let a player pick several cards (between a minimum and maximum), then run blocks once per picked card ($card).',
    make: (def) => ({
      kind: 'chooseCards', who: null, from: firstZoneRef(def), filter: null,
      min: num(1), max: num(1), prompt: 'Choose cards', revealed: false, body: [],
    }),
  },
  discardTo: {
    category: 'players', label: 'Discard down to N',
    description: 'A player keeps N cards in a zone and discards the rest into another zone (their choice which) — e.g. Militia’s “discard down to 3”.',
    make: (def) => ({
      kind: 'discardTo', who: null, from: firstZoneRef(def), to: secondZoneRef(def),
      keep: num(3), prompt: 'Discard down to 3 cards',
    }),
  },
  choosePile: {
    category: 'players', label: 'Ask to choose a pile',
    description: 'Group a zone into piles of identical cards (a supply); the player picks one pile, then blocks run with $card = its top copy.',
    make: (def) => ({
      kind: 'choosePile', who: null, from: firstSharedZoneRef(def), filter: null,
      groupBy: 'def', prompt: 'Choose a pile', optional: false, revealed: false, body: [],
    }),
  },
  triggerAbilities: {
    category: 'cards', label: 'Trigger card abilities',
    description: 'Fire a card’s enter-zone moment again WITHOUT moving it (play it again, like Throne Room). The event is tagged "play".',
    make: (def) => ({
      kind: 'triggerAbilities', card: { kind: 'binding', name: '$card' },
      on: 'enterZone', zoneId: def.zones[0]?.id ?? '',
    }),
  },
  cancelTopEffect: {
    category: 'game', label: 'Cancel top effect',
    description: 'Counter/negate: remove the top pending effect from the stack without resolving it.',
    make: () => ({ kind: 'cancelTopEffect', cardTo: null }),
  },
  setNextPlayer: {
    category: 'players', label: 'Set next player',
    description: 'Choose who takes the next turn (e.g. the trick winner leads).',
    make: () => ({ kind: 'setNextPlayer', player: { kind: 'currentPlayer' } }),
  },
  announce: {
    category: 'game', label: 'Announce',
    description: 'Write a message to the game log.',
    make: () => ({ kind: 'announce', parts: ['Something happened!'] }),
  },
  endPhase: {
    category: 'game', label: 'End phase',
    description: 'End the current phase immediately.',
    make: () => ({ kind: 'endPhase' }),
  },
  endTurn: {
    category: 'game', label: 'End turn',
    description: 'End the current turn immediately.',
    make: () => ({ kind: 'endTurn' }),
  },
  endGame: {
    category: 'game', label: 'End game',
    description: 'Finish the game and declare the winner.',
    make: (def) => {
      const numberVar = def.variables.find((v) => v.type === 'number');
      return {
        kind: 'endGame',
        winner: numberVar ? { kind: 'highestVar', varId: numberVar.id } : { kind: 'draw' },
      };
    },
  },
};

const BLOCK_ORDER: Block['kind'][] = [
  'moveCards', 'draw', 'deal', 'shuffle', 'flipCards', 'triggerAbilities',
  'setVar', 'changeVar',
  'if', 'repeat', 'forEachPlayer', 'forEachCard',
  'choose', 'chooseCards', 'choosePile', 'setNextPlayer',
  'announce', 'cancelTopEffect', 'endPhase', 'endTurn', 'endGame',
];

export const BLOCKS: BlockMeta[] = BLOCK_ORDER.map((kind) => {
  const e = BLOCK_ENTRIES[kind];
  return { kind, category: e.category, color: BLOCK_COLOR[e.category], label: e.label, description: e.description, make: e.make };
});

export function blockMeta(kind: Block['kind']): BlockMeta {
  const e = BLOCK_ENTRIES[kind];
  return { kind, category: e.category, color: BLOCK_COLOR[e.category], label: e.label, description: e.description, make: e.make };
}

// --- expressions -------------------------------------------------------------

type ExprEntry = { category: ExprCategory; label: string; description: string; make: (def: GameDef, bindings: string[]) => Expr };

const EXPR_ENTRIES: { [K in Expr['kind']]: ExprEntry } = {
  num: {
    category: 'values', label: 'Number', description: 'A plain number.',
    make: () => num(0),
  },
  str: {
    category: 'values', label: 'Text', description: 'A piece of text, like "hearts".',
    make: () => ({ kind: 'str', value: '' }),
  },
  bool: {
    category: 'values', label: 'Yes / no', description: 'A fixed yes or no.',
    make: () => ({ kind: 'bool', value: true }),
  },
  random: {
    category: 'values', label: 'Random number', description: 'A random whole number from 1 up to a maximum.',
    make: () => ({ kind: 'random', max: num(6) }),
  },
  getVar: {
    category: 'vars', label: 'Variable', description: 'Read the value of a variable.',
    make: (def) => ({ kind: 'getVar', varId: def.variables[0]?.id ?? '', target: null }),
  },
  zoneCount: {
    category: 'zones', label: 'Card count', description: 'How many cards a zone holds.',
    make: (def) => ({ kind: 'zoneCount', zone: firstZoneRef(def) }),
  },
  countCards: {
    category: 'zones', label: 'Count matching cards', description: 'How many cards in a zone match a condition.',
    make: (def) => ({ kind: 'countCards', zone: firstZoneRef(def), filter: defaultCardFilter(def) }),
  },
  sumCards: {
    category: 'zones', label: 'Sum a card field',
    description: 'Add up a number field across a zone’s (matching) cards — hand coin totals, victory points. Non-numbers count 0.',
    make: (def) => ({ kind: 'sumCards', zone: firstZoneRef(def), fieldId: 'rank', filter: null }),
  },
  topCard: {
    category: 'zones', label: 'Top card', description: 'The card on top of a zone.',
    make: (def) => ({ kind: 'topCard', zone: firstZoneRef(def) }),
  },
  stackSize: {
    category: 'game', label: 'Stack size', description: 'How many effects are waiting to resolve on the stack.',
    make: () => ({ kind: 'stackSize' }),
  },
  stackTopCard: {
    category: 'game', label: 'Top of stack', description: 'The card whose effect is on top of the stack (if any).',
    make: () => ({ kind: 'stackTopCard' }),
  },
  phaseIs: {
    category: 'game', label: 'Current phase is…', description: 'True while the turn is in a specific phase — the go-to check for phase-dependent visibility.',
    make: (def) => ({ kind: 'phaseIs', phaseId: def.phases[0]?.id ?? '' }),
  },
  phaseIndex: {
    category: 'game', label: 'Current phase number', description: 'Which phase the turn is in (first phase = 0). Resets when the turn passes.',
    make: () => ({ kind: 'phaseIndex' }),
  },
  phasePos: {
    category: 'game', label: 'Position of phase', description: 'Where a phase sits in the turn order (first = 0) — compare with the current phase number.',
    make: (def) => ({ kind: 'phasePos', phaseId: def.phases[0]?.id ?? '' }),
  },
  bestCard: {
    category: 'zones', label: 'Best card', description: 'The card with the highest or lowest value of a field in a zone.',
    make: (def) => ({ kind: 'bestCard', zone: firstZoneRef(def), by: 'highest', fieldId: 'rank', filter: null }),
  },
  cardField: {
    category: 'cards', label: 'Field of card', description: 'Read a card’s field (suit, rank, or a custom field).',
    make: (def, bindings) => ({ kind: 'cardField', card: defaultCardExpr(def, bindings), fieldId: 'rank' }),
  },
  cardOwner: {
    category: 'cards', label: 'Card owner', description: 'The player whose zone holds the card.',
    make: (def, bindings) => ({ kind: 'cardOwner', card: defaultCardExpr(def, bindings) }),
  },
  cardZoneId: {
    category: 'cards', label: 'Card’s zone', description: 'The zone the card is currently in.',
    make: (def, bindings) => ({ kind: 'cardZoneId', card: defaultCardExpr(def, bindings) }),
  },
  cardTypeIs: {
    category: 'cards', label: 'Card is a type',
    description: 'True when the card’s primary type matches (e.g. "is a Treasure"). Types live in the Types tab.',
    make: (def, bindings) => ({ kind: 'cardTypeIs', card: defaultCardExpr(def, bindings), typeId: def.cardTypes?.[0]?.id ?? '' }),
  },
  cardHasTag: {
    category: 'cards', label: 'Card has tag',
    description: 'True when the card carries a tag (e.g. "has tag Attack"). Tags live in the Types tab.',
    make: (def, bindings) => ({ kind: 'cardHasTag', card: defaultCardExpr(def, bindings), tagId: def.cardTags?.[0]?.id ?? '' }),
  },
  filterRef: {
    category: 'cards', label: 'Matches a saved filter',
    description: 'True when the card matches a reusable named filter from the Filters panel.',
    make: (def, bindings) => ({ kind: 'filterRef', filterId: def.filters?.[0]?.id ?? '', card: defaultCardExpr(def, bindings) }),
  },
  currentPlayer: {
    category: 'players', label: 'Current player', description: 'The player whose turn it is.',
    make: () => ({ kind: 'currentPlayer' }),
  },
  nextPlayer: {
    category: 'players', label: 'Next player after', description: 'The player seated after another player.',
    make: () => ({ kind: 'nextPlayer', from: { kind: 'currentPlayer' } }),
  },
  playerCount: {
    category: 'players', label: 'Player count', description: 'How many players are in the game.',
    make: () => ({ kind: 'playerCount' }),
  },
  binding: {
    category: 'players', label: 'Context value', description: 'A value from the surrounding context, like $card or $player.',
    make: (_def, bindings) => ({ kind: 'binding', name: bindings[0] ?? '$choice' }),
  },
  turnNumber: {
    category: 'game', label: 'Turn number', description: 'The current turn number (starts at 1).',
    make: () => ({ kind: 'turnNumber' }),
  },
  compare: {
    category: 'logic', label: 'Compare',
    description: 'Compare two values (=, ≠, <, ≤, >, ≥) — or "contains word": true when the right value is a whole space-separated word inside the left text ("action attack" contains "action", not "act").',
    make: (def) => defaultCompare(def),
  },
  math: {
    category: 'logic', label: 'Math', description: 'Add, subtract, multiply, divide, or remainder.',
    make: () => ({ kind: 'math', op: '+', left: num(0), right: num(1) }),
  },
  logic: {
    category: 'logic', label: 'And / or', description: 'Combine two yes/no conditions.',
    make: (def) => ({ kind: 'logic', op: 'and', left: defaultCompare(def), right: defaultCompare(def) }),
  },
  not: {
    category: 'logic', label: 'Not', description: 'Flip a yes/no condition.',
    make: () => ({ kind: 'not', expr: { kind: 'bool', value: true } }),
  },
};

const EXPR_ORDER: Expr['kind'][] = [
  'num', 'str', 'bool', 'random',
  'getVar',
  'zoneCount', 'countCards', 'sumCards', 'topCard', 'bestCard',
  'cardField', 'cardOwner', 'cardZoneId', 'cardTypeIs', 'cardHasTag', 'filterRef',
  'currentPlayer', 'nextPlayer', 'playerCount', 'binding',
  'turnNumber', 'stackSize', 'stackTopCard',
  'compare', 'math', 'logic', 'not',
];

export const EXPRS: ExprMeta[] = EXPR_ORDER.map((kind) => {
  const e = EXPR_ENTRIES[kind];
  return { kind, category: e.category, color: EXPR_COLOR[e.category], label: e.label, description: e.description, make: e.make };
});

export function exprMeta(kind: Expr['kind']): ExprMeta {
  const e = EXPR_ENTRIES[kind];
  return { kind, category: e.category, color: EXPR_COLOR[e.category], label: e.label, description: e.description, make: e.make };
}
