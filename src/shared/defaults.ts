/**
 * Factory helpers producing valid default objects for every schema entity.
 * Used by the Home page ("New game"), all editors, and tests.
 */
import type {
  ActionDef, CardDef, CardTemplate, GameDef, PhaseDef, TriggerDef, VariableDef, ZoneDef, DeckDef,
} from './types';

let counter = 0;
/** Unique-enough id: readable prefix + base36 time + counter. */
export function uid(prefix: string): string {
  counter = (counter + 1) % 1296;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}`;
}

export function newGameDef(name = 'Untitled Game'): GameDef {
  const deckZone: ZoneDef = {
    id: uid('zone'), name: 'Deck', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
  };
  const hand: ZoneDef = {
    id: uid('zone'), name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'fan', area: 'player',
  };
  const discard: ZoneDef = {
    id: uid('zone'), name: 'Discard', owner: 'shared', visibility: 'topCard', layout: 'stack', area: 'center',
  };
  const mainPhase: PhaseDef = { id: uid('phase'), name: 'Main', onEnter: [], actionIds: [], mode: 'manual' };
  return {
    schemaVersion: 1,
    meta: {
      id: uid('game'),
      name,
      description: '',
      minPlayers: 2,
      maxPlayers: 4,
      accentColor: '#7c5cff',
    },
    variables: [],
    zones: [deckZone, hand, discard],
    decks: [{
      id: uid('deck'), name: 'Main deck', source: { kind: 'standard52' }, initialZone: deckZone.id, shuffle: true,
    }],
    templates: [],
    cards: [],
    setup: [],
    phases: [mainPhase],
    actions: [],
    triggers: [],
    endConditions: [],
  };
}

export function newZone(): ZoneDef {
  return { id: uid('zone'), name: 'New zone', owner: 'shared', visibility: 'all', layout: 'row', area: 'center' };
}

export function newVariable(): VariableDef {
  return { id: uid('var'), name: 'New variable', scope: 'global', type: 'number', initial: 0 };
}

export function newDeck(initialZone: string): DeckDef {
  return { id: uid('deck'), name: 'New deck', source: { kind: 'standard52' }, initialZone, shuffle: true };
}

export function newPhase(): PhaseDef {
  return { id: uid('phase'), name: 'New phase', onEnter: [], actionIds: [], mode: 'manual' };
}

export function newAction(): ActionDef {
  return { id: uid('action'), name: 'New action', target: { kind: 'none' }, legality: null, script: [] };
}

export function newTrigger(): TriggerDef {
  return { id: uid('trigger'), name: 'New rule', event: { kind: 'turnStart' }, condition: null, script: [] };
}

export function newTemplate(): CardTemplate {
  const nameField = { id: uid('field'), name: 'Name', type: 'text' as const };
  return {
    id: uid('tpl'),
    name: 'New template',
    aspect: 0.714,
    background: '#1d2030',
    borderColor: '#3a3f58',
    cornerRadius: 8,
    fields: [nameField],
    elements: [
      {
        kind: 'text', id: uid('el'), bind: nameField.id, text: '',
        x: 6, y: 5, w: 88, h: 12, fontSize: 9, bold: true, italic: false, align: 'left', color: '#f2f3f8',
      },
    ],
  };
}

export function newCard(template: CardTemplate): CardDef {
  const fields: Record<string, string | number> = {};
  for (const f of template.fields) fields[f.id] = f.type === 'number' ? 0 : '';
  return { id: uid('card'), name: 'New card', templateId: template.id, fields, abilities: [] };
}

/** Deep-clone any JSON-serializable value (GameDefs, blocks, state). */
export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
