/**
 * Deck spawning: standard52 generation and custom card instantiation.
 * Runs at start(), before the setup script. Spawning fires NO events.
 */
import type { CardInstance, DeckDef, Id, RuntimeValue, StandardSuit, ZoneInstance } from '../shared/types';
import type { Core } from './internals';
import { notify, report, zoneInstanceKey } from './internals';
import { shuffleInPlace } from './rng';

const SUITS: StandardSuit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

function rankName(rank: number): string {
  switch (rank) {
    case 11: return 'J';
    case 12: return 'Q';
    case 13: return 'K';
    case 14: return 'A';
    default: return String(rank);
  }
}

function initialCardVars(core: Core): Record<Id, RuntimeValue> {
  const vars: Record<Id, RuntimeValue> = {};
  for (const v of core.def.variables) {
    if (v.scope === 'perCard') vars[v.id] = v.initial;
  }
  return vars;
}

function registerCard(core: Core, card: Omit<CardInstance, 'instanceId' | 'faceUp' | 'vars'>): Id {
  const instanceId = `c${core.instanceSeq++}`;
  core.state.cards[instanceId] = {
    ...card,
    instanceId,
    faceUp: true,
    vars: initialCardVars(core),
  };
  return instanceId;
}

/** Build one full copy of a deck; returns spawned instance ids in deck order. */
function buildDeckCards(core: Core, deck: DeckDef): Id[] {
  const ids: Id[] = [];
  if (deck.source.kind === 'standard52') {
    const excluded = new Set(deck.source.excludeRanks ?? []);
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) {
        if (excluded.has(rank)) continue;
        const rn = rankName(rank);
        const name = `${rn} of ${suit}`;
        ids.push(registerCard(core, {
          defId: null,
          templateId: null,
          name,
          fields: {
            suit,
            rank,
            rankName: rn,
            color: suit === 'hearts' || suit === 'diamonds' ? 'red' : 'black',
            name,
            isJoker: false,
          },
        }));
      }
    }
    for (let j = 0; j < (deck.source.jokers ?? 0); j++) {
      ids.push(registerCard(core, {
        defId: null,
        templateId: null,
        name: 'Joker',
        fields: { suit: '', rank: 15, rankName: 'Joker', color: 'black', name: 'Joker', isJoker: true },
      }));
    }
    return ids;
  }
  for (const entry of deck.source.entries) {
    const def = core.def.cards.find((c) => c.id === entry.cardId);
    if (!def) {
      report(core, `Deck "${deck.name}": card "${entry.cardId}" does not exist — skipped.`);
      continue;
    }
    for (let i = 0; i < entry.count; i++) {
      ids.push(registerCard(core, {
        defId: def.id,
        templateId: def.templateId,
        name: def.name,
        fields: { ...def.fields, name: def.name },
      }));
    }
  }
  return ids;
}

/**
 * Spawn all decks in definition order. perPlayer initial zones get a full
 * independent copy per player; `deck.shuffle` shuffles each instance
 * separately, immediately after that instance is filled.
 */
export function spawnDecks(core: Core): void {
  for (const deck of core.def.decks) {
    const zdef = core.def.zones.find((z) => z.id === deck.initialZone);
    if (!zdef) {
      report(core, `Deck "${deck.name}": starting zone does not exist — skipped.`);
      continue;
    }
    const targets: ZoneInstance[] = zdef.owner === 'shared'
      ? [core.state.zones[zoneInstanceKey(zdef.id, null)]]
      : core.state.players.map((p) => core.state.zones[zoneInstanceKey(zdef.id, p.id)]);
    for (const inst of targets) {
      inst.cardIds.push(...buildDeckCards(core, deck));
      if (deck.shuffle) shuffleInPlace(inst.cardIds, core.rng);
    }
  }
  notify(core);
}
