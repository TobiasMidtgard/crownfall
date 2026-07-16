/**
 * The hall's three kingdom sets (lobby banners ↔ Dominion supply).
 * Canonical data lifted from the original hall (FableTest app.js KINGDOMS).
 * Shared by the lobby (src/hall) and the Dominion def (src/forge) — keep this
 * module dependency-free so neither side drags the other into its chunk.
 */
export interface KingdomSet {
  id: string;
  name: string;
  /** Hall icon symbol id (see src/hall Icons). */
  icon: string;
  motto: string;
  /** Exactly ten kingdom card names. */
  cards: string[];
}

export const KINGDOM_SETS: KingdomSet[] = [
  {
    id: 'first-game', name: 'First Game', icon: 'crest-dominion',
    motto: 'Ten cards. Every lesson.',
    cards: ['Cellar', 'Market', 'Militia', 'Mine', 'Moat', 'Remodel', 'Smithy', 'Village', 'Workshop', 'Festival'],
  },
  {
    id: 'sharp-coins', name: 'Sharp Coins', icon: 'glyph-coin',
    motto: 'Silver buys. Gold forgives.',
    cards: ['Chapel', 'Laboratory', 'Market', 'Festival', 'Council Room', 'Throne Room', 'Mine', 'Workshop', 'Gardens', 'Smithy'],
  },
  {
    id: 'witching-hour', name: 'The Witching Hour', icon: 'crest-veil',
    motto: 'Curses, dealt at midnight.',
    cards: ['Witch', 'Moat', 'Chapel', 'Cellar', 'Village', 'Laboratory', 'Throne Room', 'Council Room', 'Remodel', 'Black Market'],
  },
  {
    id: 'deck-top', name: 'Deck Top', icon: 'crest-dominion',
    motto: 'The crown watches every draw.',
    cards: ['Harbinger', 'Merchant', 'Vassal', 'Bureaucrat', 'Moneylender', 'Poacher', 'Bandit', 'Library', 'Sentry', 'Artisan'],
  },
  {
    id: 'underlings', name: 'Underlings', icon: 'glyph-coin',
    motto: 'Every court needs its schemers.',
    cards: ['Courtyard', 'Lurker', 'Pawn', 'Masquerade', 'Shanty Town', 'Steward', 'Swindler', 'Wishing Well', 'Baron', 'Bridge'],
  },
  {
    id: 'grand-scheme', name: 'The Grand Scheme', icon: 'crest-veil',
    motto: 'Plans within plans within plans.',
    cards: ['Conspirator', 'Diplomat', 'Ironworks', 'Mill', 'Mining Village', 'Secret Passage', 'Courtier', 'Duke', 'Harem', 'Minion'],
  },
  {
    id: 'deceit', name: 'Masters of Deceit', icon: 'crest-veil',
    motto: 'Smile, trade, replace.',
    cards: ['Nobles', 'Patrol', 'Replace', 'Torturer', 'Trading Post', 'Upgrade', 'Village', 'Smithy', 'Moat', 'Market'],
  },
  {
    id: 'high-tide', name: 'High Tide', icon: 'crest-dominion',
    motto: 'What the sea sets aside, it returns.',
    cards: ['Haven', 'Fishing Village', 'Warehouse', 'Caravan', 'Cutpurse', 'Island', 'Salvager', 'Merchant Ship', 'Tactician', 'Wharf'],
  },
  {
    id: 'deep-currents', name: 'Deep Currents', icon: 'crest-veil',
    motto: 'The tide keeps its own ledger.',
    cards: ['Astrolabe', 'Lighthouse', 'Lookout', 'Sea Chart', 'Monkey', 'Smugglers', 'Blockade', 'Sea Witch', 'Treasury', 'Bazaar'],
  },
];

export const DEFAULT_KINGDOM_ID = 'first-game';

export function kingdomById(id: string | null | undefined): KingdomSet {
  return KINGDOM_SETS.find((k) => k.id === id) ?? KINGDOM_SETS[0];
}
