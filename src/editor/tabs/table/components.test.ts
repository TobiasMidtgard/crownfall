/**
 * Tests for the reusable-component library: add/remove and the load filter
 * that drops malformed entries.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ScreenElement } from '../../../shared/types';
import { addComponent, loadComponents, persistComponents, removeComponent } from './components';

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
});
