/**
 * Schema v1 → v2 migration: a pure pass-through (every v2 addition is an
 * optional field or new union member), so v1 documents load unchanged apart
 * from the schemaVersion stamp. Both versions pass the storage soundness gate.
 */
import { describe, expect, it } from 'vitest';
import type { GameDef } from './types';
import { SCHEMA_VERSION } from './types';
import { migrateGameDef } from './migrate';
import { isStructurallySound } from '../storage/storage';

function v1Def(): GameDef {
  return {
    schemaVersion: 1,
    meta: { id: 'g1', name: 'Legacy', description: 'A v1 document', minPlayers: 2, maxPlayers: 4 },
    variables: [{ id: 'v1', name: 'score', scope: 'perPlayer', type: 'number', initial: 0 }],
    zones: [
      { id: 'z1', name: 'Deck', owner: 'shared', visibility: 'none', layout: 'stack', area: 'center' },
      { id: 'z2', name: 'Hand', owner: 'perPlayer', visibility: 'owner', layout: 'fan', area: 'player' },
    ],
    decks: [{ id: 'd1', name: 'Main', source: { kind: 'standard52' }, initialZone: 'z1', shuffle: true }],
    templates: [],
    cards: [],
    setup: [{
      kind: 'moveCards', from: { zoneId: 'z1', owner: null }, to: { zoneId: 'z2', owner: null },
      cards: { kind: 'top', count: { kind: 'num', value: 5 } }, toPosition: 'top', faceUp: null,
    }],
    phases: [{ id: 'ph1', name: 'Main', onEnter: [], actionIds: [], mode: 'manual' }],
    actions: [],
    triggers: [{
      id: 't1', name: 'On draw', condition: null,
      event: { kind: 'cardEnterZone', zoneId: 'z2' }, // v1 spec: no tag field
      script: [],
    }],
    endConditions: [],
  };
}

describe('schemaVersion 2 migration', () => {
  it('stamps v1 documents to v2 and changes NOTHING else', () => {
    const original = v1Def();
    const migrated = migrateGameDef(original);
    expect(migrated.schemaVersion).toBe(2);
    expect(SCHEMA_VERSION).toBe(2);
    expect({ ...migrated, schemaVersion: 1 }).toEqual(original);
    // The input document is not mutated.
    expect(original.schemaVersion).toBe(1);
  });

  it('passes v2 documents through untouched', () => {
    const v2 = migrateGameDef(v1Def());
    const again = migrateGameDef(v2);
    expect(again).toEqual(v2);
  });

  it('storage soundness accepts both versions and rejects unknown ones', () => {
    expect(isStructurallySound(v1Def())).toBe(true);
    expect(isStructurallySound(migrateGameDef(v1Def()))).toBe(true);
    const future = { ...v1Def(), schemaVersion: 3 as unknown as 1 };
    expect(isStructurallySound(future)).toBe(false);
  });

  it('keeps migrating legacy tableLayout docs after the version stamp', () => {
    const legacy = v1Def();
    legacy.tableLayout = { board: { z1: { x: 10, y: 10, w: 20, h: 30 } }, seat: {} };
    const migrated = migrateGameDef(legacy);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.tableLayout).toBeUndefined();
    expect(migrated.screenLayout?.elements.some((el) => el.kind === 'zone' && el.zoneId === 'z1')).toBe(true);
  });
});
