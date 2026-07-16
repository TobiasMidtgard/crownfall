/**
 * Tests for the designer's per-device storage: the reusable-component library
 * (add/remove/rename/update and the load filter that drops malformed
 * entries), the discarded-layout stash, and the per-game key sweep that
 * deleteGame runs.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ScreenElement, ScreenLayout } from '../../../shared/types';
import {
  addComponent, clearDesignerKeysForGame, clearDiscardedLayout, loadComponents,
  loadDiscardedLayout, persistComponents, removeComponent, renameComponent,
  stashDiscardedLayout, updateComponentEl,
} from './components';

// The test env is node (no jsdom): shim the localStorage the library reads.
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
} as Storage;

const el = (id: string): ScreenElement => ({
  kind: 'text', id, name: id, rect: { x: 0, y: 0, w: 10, h: 10 }, text: id, fontSize: 2, align: 'center',
});

describe('component library', () => {
  beforeEach(() => localStorage.clear());

  it('add appends with a name fallback; remove drops by id', () => {
    let list = addComponent([], 'c1', 'Badge', el('e1'));
    list = addComponent(list, 'c2', '   ', el('e2')); // blank name -> element name
    expect(list.map((c) => c.name)).toEqual(['Badge', 'e2']);
    expect(removeComponent(list, 'c1').map((c) => c.id)).toEqual(['c2']);
  });

  it('persists and reloads', () => {
    const list = addComponent([], 'c1', 'Badge', el('e1'));
    persistComponents(list);
    expect(loadComponents()).toEqual(list);
  });

  it('drops malformed entries on load', () => {
    localStorage.setItem('cardsmith.components.v1', JSON.stringify([
      { id: 'ok', name: 'Good', el: el('e1') },
      { id: 'bad', name: 'No el' },
      { id: 'bad2', name: 'Junk el', el: { nope: true } },
      'not even an object',
    ]));
    expect(loadComponents().map((c) => c.id)).toEqual(['ok']);
  });

  it('returns [] for absent or corrupt storage', () => {
    expect(loadComponents()).toEqual([]);
    localStorage.setItem('cardsmith.components.v1', '{ broken');
    expect(loadComponents()).toEqual([]);
  });

  it('rename keeps id + element, with the blank-name fallback', () => {
    const list = addComponent(addComponent([], 'c1', 'Badge', el('e1')), 'c2', 'Crest', el('e2'));
    const next = renameComponent(list, 'c1', 'Sigil');
    expect(next.map((c) => c.name)).toEqual(['Sigil', 'Crest']);
    expect(next[0]).toMatchObject({ id: 'c1' });
    expect(next[0].el.id).toBe('e1');
    // Blank falls back to the element's name, like addComponent.
    expect(renameComponent(list, 'c1', '   ')[0].name).toBe('e1');
    // Unknown ids change nothing; the input list is untouched.
    expect(renameComponent(list, 'ghost', 'X')).toEqual(list);
    expect(list[0].name).toBe('Badge');
  });

  it('updateComponentEl replaces the element, keeping id + name', () => {
    const list = addComponent([], 'c1', 'Badge', el('e1'));
    const next = updateComponentEl(list, 'c1', el('e2'));
    expect(next[0]).toMatchObject({ id: 'c1', name: 'Badge' });
    expect(next[0].el.id).toBe('e2');
    // Unknown ids change nothing; the input list is untouched.
    expect(updateComponentEl(list, 'ghost', el('e3'))).toEqual(list);
    expect(list[0].el.id).toBe('e1');
  });
});

describe('discarded-layout stash', () => {
  beforeEach(() => localStorage.clear());

  const layout: ScreenLayout = { aspect: 16 / 9, elements: [el('e1')] };

  it('round-trips a stashed layout per game', () => {
    stashDiscardedLayout('g1', layout);
    expect(loadDiscardedLayout('g1')).toEqual(layout);
    expect(loadDiscardedLayout('g2')).toBeNull();
  });

  it('clear removes the stash; corrupt/shape-less writes load as null', () => {
    stashDiscardedLayout('g1', layout);
    clearDiscardedLayout('g1');
    expect(loadDiscardedLayout('g1')).toBeNull();
    localStorage.setItem('cardsmith.discardedLayout.g1', '{ broken');
    expect(loadDiscardedLayout('g1')).toBeNull();
    localStorage.setItem('cardsmith.discardedLayout.g1', JSON.stringify({ aspect: 1 }));
    expect(loadDiscardedLayout('g1')).toBeNull();
  });
});

describe('clearDesignerKeysForGame', () => {
  beforeEach(() => localStorage.clear());

  it('sweeps the game\'s sel/collapse/stash keys and nothing else', () => {
    localStorage.setItem('cardsmith.sel.g1.supply', 'b1');
    localStorage.setItem('cardsmith.sel.g1.tabs', 'b2');
    localStorage.setItem('cardsmith.collapse.g1.el9', '1');
    localStorage.setItem('cardsmith.discardedLayout.g1', '{"elements":[]}');
    // Other games and device-global stores survive.
    localStorage.setItem('cardsmith.sel.g2.supply', 'b1');
    localStorage.setItem('cardsmith.collapse.g2.el9', '1');
    localStorage.setItem('cardsmith.components.v1', '[]');
    // A prefix-shaped defId never over-matches (g1 vs g11).
    localStorage.setItem('cardsmith.sel.g11.supply', 'b1');
    clearDesignerKeysForGame('g1');
    expect(localStorage.getItem('cardsmith.sel.g1.supply')).toBeNull();
    expect(localStorage.getItem('cardsmith.sel.g1.tabs')).toBeNull();
    expect(localStorage.getItem('cardsmith.collapse.g1.el9')).toBeNull();
    expect(localStorage.getItem('cardsmith.discardedLayout.g1')).toBeNull();
    expect(localStorage.getItem('cardsmith.sel.g2.supply')).toBe('b1');
    expect(localStorage.getItem('cardsmith.collapse.g2.el9')).toBe('1');
    expect(localStorage.getItem('cardsmith.components.v1')).toBe('[]');
    expect(localStorage.getItem('cardsmith.sel.g11.supply')).toBe('b1');
  });
});
