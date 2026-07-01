/**
 * Codex card data — the Dominion base set and its promos, lifted verbatim
 * from FableTest app.js (CARDS, TYPE_NAMES, TYPE_PRIORITY, COST_BANDS,
 * COST_LABELS). Data + pure helpers only; the Codex screen renders it.
 */

export type CardType = 'action' | 'attack' | 'reaction' | 'treasure' | 'victory' | 'curse';

export interface CodexCard {
  name: string;
  types: CardType[];
  cost: number;
  /** Treasure coin value — drives the coin-ring art and the coin stat. */
  coin?: number;
  /** Victory/Curse point value — drives the shield stat. */
  vp?: number;
  promo?: boolean;
  /** Effect text or flavor line, shown on the card face. */
  text: string;
}

export const CARDS: CodexCard[] = [
  { name: 'Copper',       types: ['treasure'],           cost: 0, coin: 1,  text: 'The realm runs on it, reluctantly.' },
  { name: 'Silver',       types: ['treasure'],           cost: 3, coin: 2,  text: 'Respectable money for respectable schemes.' },
  { name: 'Gold',         types: ['treasure'],           cost: 6, coin: 3,  text: 'Heavy enough to bend a loyalty.' },
  { name: 'Estate',       types: ['victory'],            cost: 2, vp: 1,    text: 'Land enough to be buried in.' },
  { name: 'Duchy',        types: ['victory'],            cost: 5, vp: 3,    text: 'A duke, a moat, and middling ambitions.' },
  { name: 'Province',     types: ['victory'],            cost: 8, vp: 6,    text: 'The realm itself, deeded and sealed.' },
  { name: 'Gardens',      types: ['victory'],            cost: 4,           text: 'Worth 1 VP for every 10 cards in your deck.' },
  { name: 'Curse',        types: ['curse'],              cost: 0, vp: -1,   text: 'A gift that keeps taking.' },
  { name: 'Cellar',       types: ['action'],             cost: 2, text: '+1 Action. Discard any number of cards, then draw that many.' },
  { name: 'Chapel',       types: ['action'],             cost: 2, text: 'Trash up to four cards from your hand.' },
  { name: 'Moat',         types: ['action', 'reaction'], cost: 2, text: '+2 Cards. Reveal it, and an attack passes you by.' },
  { name: 'Village',      types: ['action'],             cost: 3, text: '+1 Card, +2 Actions.' },
  { name: 'Workshop',     types: ['action'],             cost: 3, text: 'Gain a card costing up to 4.' },
  { name: 'Militia',      types: ['action', 'attack'],   cost: 4, text: '+2 Coins. Each other player discards down to three.' },
  { name: 'Smithy',       types: ['action'],             cost: 4, text: '+3 Cards.' },
  { name: 'Remodel',      types: ['action'],             cost: 4, text: 'Trash a card; gain one costing up to 2 more.' },
  { name: 'Throne Room',  types: ['action'],             cost: 4, text: 'Play an Action from your hand twice.' },
  { name: 'Market',       types: ['action'],             cost: 5, text: '+1 Card, +1 Action, +1 Buy, +1 Coin.' },
  { name: 'Mine',         types: ['action'],             cost: 5, text: 'Trash a Treasure; gain one costing up to 3 more, into your hand.' },
  { name: 'Witch',        types: ['action', 'attack'],   cost: 5, text: '+2 Cards. Each other player gains a Curse.' },
  { name: 'Laboratory',   types: ['action'],             cost: 5, text: '+2 Cards, +1 Action.' },
  { name: 'Festival',     types: ['action'],             cost: 5, text: '+2 Actions, +1 Buy, +2 Coins.' },
  { name: 'Council Room', types: ['action'],             cost: 5, text: '+4 Cards, +1 Buy. Each other player draws a card.' },
  { name: 'Envoy',        types: ['action'],             cost: 4, promo: true, text: 'Reveal five; a rival banishes one; draw the rest.' },
  { name: 'Black Market', types: ['action'],             cost: 3, promo: true, text: 'Buy from beyond the kingdom, at midnight prices.' },
];

export const TYPE_NAMES: Record<CardType, string> = {
  action: 'Action', attack: 'Attack', reaction: 'Reaction',
  treasure: 'Treasure', victory: 'Victory', curse: 'Curse',
};

/** Loudest type wins the card's accent (--rarity-color). */
export const TYPE_PRIORITY: CardType[] = ['curse', 'victory', 'treasure', 'reaction', 'attack', 'action'];

export type CostBand = 'c0-2' | 'c3-4' | 'c5+';

export const COST_BANDS: Record<CostBand, (cost: number) => boolean> = {
  'c0-2': (c) => c <= 2,
  'c3-4': (c) => c >= 3 && c <= 4,
  'c5+': (c) => c >= 5,
};

export const COST_LABELS: Record<CostBand, string> = {
  'c0-2': 'Cost 0–2', 'c3-4': 'Cost 3–4', 'c5+': 'Cost 5+',
};

export function accentType(card: CodexCard): CardType {
  return TYPE_PRIORITY.find((t) => card.types.includes(t)) ?? 'action';
}
