/**
 * Schema v1 → v2 migration: a pure pass-through (every v2 addition is an
 * optional field or new union member), so v1 documents load unchanged apart
 * from the schemaVersion stamp. Both versions pass the storage soundness gate.
 * Plus the deprecated `tabbed: true` group conversion: a generated selector-
 * button row + showForSelector-bound panels, deterministic ids, idempotent.
 */
import { describe, expect, it } from 'vitest';
import type { GameDef, ScreenElement } from './types';
import { SCHEMA_VERSION } from './types';
import { migrateGameDef } from './migrate';
import { isStructurallySound } from '../storage/storage';
import { selectorContextFrom, selectorGateOpen } from '../runner/layout';

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
  it('stamps v1 documents to v2 and changes nothing else beyond seeding the vocabulary lists', () => {
    const original = v1Def();
    const migrated = migrateGameDef(original);
    expect(migrated.schemaVersion).toBe(2);
    expect(SCHEMA_VERSION).toBe(2);
    expect({ ...migrated, schemaVersion: 1 })
      .toEqual({ ...original, cardTypes: [], cardTags: [], filters: [] });
    // The input document is not mutated.
    expect(original.schemaVersion).toBe(1);
    expect(original.cardTypes).toBeUndefined();
  });

  it('passes v2 documents through untouched', () => {
    const v2 = migrateGameDef(v1Def());
    const again = migrateGameDef(v2);
    expect(again).toEqual(v2);
  });

  it('seeds absent cardTypes/cardTags/filters to [] — pure and idempotent', () => {
    const migrated = migrateGameDef(v1Def());
    expect(migrated.cardTypes).toEqual([]);
    expect(migrated.cardTags).toEqual([]);
    expect(migrated.filters).toEqual([]);
    expect(migrateGameDef(migrated)).toEqual(migrated);
  });

  it('preserves existing vocabulary lists exactly', () => {
    const authored: GameDef = {
      ...migrateGameDef(v1Def()),
      cardTypes: [{ id: 'ty1', name: 'Treasure', color: '#c9a227' }],
      cardTags: [{ id: 'tg1', name: 'Attack' }],
      filters: [{ id: 'f1', name: 'The basic cards', condition: { kind: 'bool', value: true } }],
    };
    const out = migrateGameDef(authored);
    expect(out.cardTypes).toEqual(authored.cardTypes);
    expect(out.cardTags).toEqual(authored.cardTags);
    expect(out.filters).toEqual(authored.filters);
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

// ---------------------------------------------------------------------------
// Tabbed groups (deprecated) → selector-button rows
// ---------------------------------------------------------------------------

const rect = { x: 0, y: 0, w: 20, h: 10 };

function textPanel(id: string, name: string): ScreenElement {
  return {
    kind: 'text', id, name, rect: { x: 5, y: 5, w: 90, h: 90 },
    text: name, fontSize: 2, align: 'left',
  };
}

/** A def with a tabbed group in BOTH variants (mobile nests its group). */
function tabbedDef(): GameDef {
  return {
    ...migrateGameDef(v1Def()),
    screenLayout: {
      aspect: null,
      elements: [
        {
          kind: 'group', id: 'tabs', name: 'Market', rect: { x: 10, y: 20, w: 60, h: 50 },
          tabbed: true,
          children: [
            textPanel('pa', 'Treasury'),
            textPanel('pb', 'Victory'),
            textPanel('pc', 'Kingdom'),
          ],
        },
        textPanel('loose', 'Untouched'),
      ],
      mobile: {
        elements: [{
          kind: 'group', id: 'mwrap', name: 'Wrapper', rect,
          children: [{
            kind: 'group', id: 'mtabs', name: 'Pocket market', rect, tabbed: true,
            children: [textPanel('mpa', 'A'), textPanel('mpb', 'B')],
          }],
        }],
      },
    },
  };
}

type GroupEl = Extract<ScreenElement, { kind: 'group' }>;

describe('tabbed → selector migration', () => {
  it('converts a tabbed group into a selector row + bound panels (deterministic ids)', () => {
    const out = migrateGameDef(tabbedDef());
    const group = out.screenLayout!.elements[0] as GroupEl;
    // The group keeps its identity and rect; the flag is GONE (not false).
    expect(group.id).toBe('tabs');
    expect(group.rect).toEqual({ x: 10, y: 20, w: 60, h: 50 });
    expect('tabbed' in group).toBe(false);
    // Children: the generated selector-button row, then the original panels.
    expect(group.children).toHaveLength(4);
    const selbar = group.children[0] as GroupEl;
    expect(selbar.id).toBe('tabs_selbar');
    expect(selbar.rect).toEqual({ x: 0, y: 0, w: 100, h: 12 });
    expect(selbar.children.map((b) => b.id)).toEqual(['pa_sel', 'pb_sel', 'pc_sel']);
    for (const [i, b] of selbar.children.entries()) {
      expect(b.kind).toBe('button');
      if (b.kind !== 'button') continue;
      expect(b.role).toBe('selector');
      expect(b.selectorGroup).toBe('tabs');
      expect(b.actionId).toBeNull();
      expect(b.label).toBe(['Treasury', 'Victory', 'Kingdom'][i]); // label = panel name
      expect(b.rect.w).toBeCloseTo(100 / 3, 1);
    }
    // Panels: original content, re-seated under the row, bound to their button.
    const panels = group.children.slice(1);
    expect(panels.map((p) => p.id)).toEqual(['pa', 'pb', 'pc']);
    for (const p of panels) {
      expect(p.rect).toEqual({ x: 0, y: 12, w: 100, h: 88 });
      expect(p.showForSelector).toBe(`${p.id}_sel`);
      expect(p.kind).toBe('text'); // content untouched
    }
    // Elements outside the tabbed group pass through unchanged.
    expect(out.screenLayout!.elements[1]).toEqual(textPanel('loose', 'Untouched'));
  });

  it('converts NESTED tabbed groups in the mobile variant too', () => {
    const out = migrateGameDef(tabbedDef());
    const wrapper = out.screenLayout!.mobile!.elements[0] as GroupEl;
    const mtabs = wrapper.children[0] as GroupEl;
    expect('tabbed' in mtabs).toBe(false);
    expect(mtabs.children.map((c) => c.id)).toEqual(['mtabs_selbar', 'mpa', 'mpb']);
    expect(mtabs.children[1].showForSelector).toBe('mpa_sel');
  });

  it('renders the same panel content per selection (behavior parity)', () => {
    const out = migrateGameDef(tabbedDef());
    const elements = out.screenLayout!.elements;
    const group = elements[0] as GroupEl;
    const panels = group.children.slice(1);
    // Default (no stored selection): the FIRST panel shows — like the old
    // tab bar's first-visible default.
    const fresh = selectorContextFrom(elements, () => null);
    expect(panels.map((p) => selectorGateOpen(fresh, p))).toEqual([true, false, false]);
    // Each stored button shows exactly ITS panel (max 1 at a time).
    for (const picked of panels) {
      const ctx = selectorContextFrom(elements, () => `${picked.id}_sel`);
      for (const p of panels) {
        expect(selectorGateOpen(ctx, p)).toBe(p.id === picked.id);
      }
    }
  });

  it('is idempotent: a second migrate changes nothing', () => {
    const once = migrateGameDef(tabbedDef());
    const twice = migrateGameDef(once);
    expect(twice).toEqual(once);
    // Same object back when nothing needs converting (pure fast path).
    expect(twice.screenLayout).toBe(once.screenLayout);
  });

  it('a tabbed group with no children just drops the flag', () => {
    const def: GameDef = {
      ...migrateGameDef(v1Def()),
      screenLayout: {
        aspect: null,
        elements: [{ kind: 'group', id: 'empty', name: 'Empty', rect, tabbed: true, children: [] }],
      },
    };
    const out = migrateGameDef(def);
    const g = out.screenLayout!.elements[0] as GroupEl;
    expect('tabbed' in g).toBe(false);
    expect(g.children).toEqual([]);
  });
});
