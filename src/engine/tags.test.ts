/**
 * Move-cause tags (wave 1a): tagged moveCards, trigger/ability tag filters,
 * the $tag binding, back-compat of untagged moves, and the public
 * state.moveTags rendering surface.
 */
import { describe, expect, it } from 'vitest';
import type { AbilityDef, GameDef, TriggerDef } from '../shared/types';
import {
  bnd, cdef, customDeck, cv, harness, makeDef, mv, num, selTop, sv, vdef, zone,
  zr,
} from './testkit';

const trigger = (id: string, event: TriggerDef['event'], over: Partial<TriggerDef> = {}): TriggerDef =>
  ({ id, name: id, event, condition: null, script: [], ...over });

function tagDef(over: Partial<GameDef> = {}): GameDef {
  return makeDef({
    variables: [
      vdef('gains', 'global', 'number', 0),
      vdef('any', 'global', 'number', 0),
      vdef('lastTag', 'global', 'string', '(unset)'),
    ],
    zones: [zone('a'), zone('b')],
    cards: [cdef('c1'), cdef('c2'), cdef('c3')],
    decks: [customDeck('d', 'a', ['c1', 'c2', 'c3'])],
    triggers: [
      trigger('gains-only', { kind: 'cardEnterZone', zoneId: 'b', tag: 'gain' }, {
        script: [cv('gains', num(1))],
      }),
      trigger('any-move', { kind: 'cardEnterZone', zoneId: 'b' }, {
        script: [cv('any', num(1)), sv('lastTag', bnd('$tag'))],
      }),
    ],
    ...over,
  });
}

describe('move-cause tags', () => {
  it('tag-filtered triggers fire only for moves carrying that tag', async () => {
    const def = tagDef({
      setup: [
        mv(zr('a'), zr('b'), selTop(1)),                 // untagged
        mv(zr('a'), zr('b'), selTop(1), { tag: 'gain' }), // tagged gain
        mv(zr('a'), zr('b'), selTop(1), { tag: 'play' }), // tagged play
      ],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().globalVars['gains']).toBe(1); // only the gain-tagged move
    expect(h.state().globalVars['any']).toBe(3);   // untagged spec matches every move
    expect(h.errors).toEqual([]);
  });

  it('binds $tag on enter/leave events (null for untagged moves)', async () => {
    const untagged = harness(tagDef({ setup: [mv(zr('a'), zr('b'), selTop(1))] }));
    await untagged.engine.start();
    expect(untagged.state().globalVars['lastTag']).toBe(''); // null → '' via string coercion

    const tagged = harness(tagDef({ setup: [mv(zr('a'), zr('b'), selTop(1), { tag: 'discard' })] }));
    await tagged.engine.start();
    expect(tagged.state().globalVars['lastTag']).toBe('discard');
  });

  it('cardLeaveZone specs filter on the tag too', async () => {
    const def = tagDef({
      setup: [
        mv(zr('a'), zr('b'), selTop(1), { tag: 'trash' }),
        mv(zr('a'), zr('b'), selTop(1)),
      ],
      triggers: [
        trigger('left-trash', { kind: 'cardLeaveZone', zoneId: 'a', tag: 'trash' }, {
          script: [cv('gains', num(1))],
        }),
      ],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().globalVars['gains']).toBe(1);
  });

  it('ability tagFilter gates enter-zone abilities by cause', async () => {
    const ability = (tagFilter: string | null): AbilityDef => ({
      id: 'ab', name: 'ab', on: 'enterZone', zoneId: 'b', tagFilter,
      condition: null, script: [cv('gains', num(1))],
    });
    const base = {
      variables: [vdef('gains', 'global', 'number', 0)],
      zones: [zone('a'), zone('b')],
      decks: [customDeck('d', 'a', ['w'])],
      setup: [mv(zr('a'), zr('b'), selTop(1), { tag: 'gain' })],
    };
    const match = harness(makeDef({ ...base, cards: [cdef('w', {}, [ability('gain')])] }));
    await match.engine.start();
    expect(match.state().globalVars['gains']).toBe(1);

    const miss = harness(makeDef({ ...base, cards: [cdef('w', {}, [ability('play')])] }));
    await miss.engine.start();
    expect(miss.state().globalVars['gains']).toBe(0);

    const any = harness(makeDef({ ...base, cards: [cdef('w', {}, [ability(null)])] }));
    await any.engine.start();
    expect(any.state().globalVars['gains']).toBe(1);
  });

  it('stamps state.moveTags per card (null for untagged, latest move wins)', async () => {
    const def = tagDef({
      setup: [
        mv(zr('a'), zr('b'), selTop(1), { tag: 'gain' }), // c3 → b tagged
        mv(zr('a'), zr('b'), selTop(1)),                  // c2 → b untagged
        mv(zr('b'), zr('a'), selTop(1), { tag: 'discard' }), // c2 back, retagged
      ],
    });
    const h = harness(def);
    await h.engine.start();
    const s = h.state();
    const byName = (name: string) =>
      Object.values(s.cards).find((c) => c.name === name)!.instanceId;
    expect(s.moveTags?.[byName('c3')]).toBe('gain');
    expect(s.moveTags?.[byName('c2')]).toBe('discard'); // latest move wins
    expect(s.moveTags?.[byName('c1')]).toBeUndefined(); // never moved
  });
});
