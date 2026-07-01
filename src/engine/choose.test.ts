import { describe, expect, it } from 'vitest';
import type { Block, ChoiceSpec, Expr } from '../shared/types';
import {
  bnd, cdef, cmp, customDeck, fld, harness, idByName, makeDef, num, str, sv, vdef, zone, zr,
  type ScriptedAnswer,
} from './testkit';

function choose(choice: ChoiceSpec, who: Expr | null = null): Block {
  return { kind: 'choose', who, choice };
}

const cardChoice = (over: Partial<Extract<ChoiceSpec, { kind: 'card' }>> = {}): ChoiceSpec => ({
  kind: 'card', from: zr('a'), filter: null, prompt: 'Pick', optional: false, ...over,
});

/** Game with zone 'a' holding c1..c3 (v=1..3); $choice is copied into global 'picked'. */
function chooseDef(choice: ChoiceSpec, varType: 'string' | 'boolean' = 'string') {
  return makeDef({
    variables: [vdef('picked', 'global', varType, varType === 'string' ? '(unset)' : false)],
    zones: [zone('a')],
    cards: [cdef('c1', { v: 1 }), cdef('c2', { v: 2 }), cdef('c3', { v: 3 })],
    decks: [customDeck('d', 'a', ['c1', 'c2', 'c3'])],
    setup: [choose(choice), sv('picked', bnd('$choice'))],
  });
}

async function run(choice: ChoiceSpec, answers: ScriptedAnswer[], varType: 'string' | 'boolean' = 'string') {
  const h = harness(chooseDef(choice, varType), { answers });
  await h.engine.start();
  return h;
}

describe('choose', () => {
  it('card choice offers filtered candidates and binds $choice', async () => {
    const filter = cmp('>', fld(bnd('$card'), 'v'), num(1));
    const h = await run(cardChoice({ filter }), [(req) => (req.kind === 'card' ? req.cardIds[0] : null)]);
    const s = h.state();
    expect(h.choices.requests).toHaveLength(1);
    const req = h.choices.requests[0];
    expect(req.kind).toBe('card');
    if (req.kind === 'card') {
      expect(req.cardIds).toEqual([idByName(s, 'c2'), idByName(s, 'c3')]);
      expect(req.playerId).toBe('p0');
      expect(req.prompt).toBe('Pick');
    }
    expect(s.globalVars['picked']).toBe(idByName(s, 'c2'));
    expect(h.errors).toEqual([]);
  });

  it('optional card choice may be declined with null', async () => {
    const h = await run(cardChoice({ optional: true }), [null]);
    expect(h.state().globalVars['picked']).toBe(''); // null coerced to '' by setVar
    expect(h.errors).toEqual([]);
  });

  it('declining a REQUIRED card choice is re-asked, then falls back to the first candidate', async () => {
    const h = await run(cardChoice(), [null, null, null]);
    const s = h.state();
    expect(h.choices.requests).toHaveLength(3);
    expect(s.globalVars['picked']).toBe(idByName(s, 'c1'));
    expect(h.errors.some((e) => e.includes('3 attempts'))).toBe(true);
  });

  it('empty candidates: optional yields null silently, required reports', async () => {
    const none = cmp('>', fld(bnd('$card'), 'v'), num(99));
    const opt = await run(cardChoice({ filter: none, optional: true }), []);
    expect(opt.choices.requests).toHaveLength(0);
    expect(opt.errors).toEqual([]);

    const req = await run(cardChoice({ filter: none }), []);
    expect(req.choices.requests).toHaveLength(0);
    expect(req.state().globalVars['picked']).toBe('');
    expect(req.errors.some((e) => e.includes('no cards'))).toBe(true);
  });

  it('invalid answers are retried (3 attempts) before falling back', async () => {
    const h = await run(cardChoice(), ['bogus', 'bogus', 'bogus']);
    const s = h.state();
    expect(h.choices.requests).toHaveLength(3);
    expect(s.globalVars['picked']).toBe(idByName(s, 'c1'));
  });

  it('option choice validates against the offered ids', async () => {
    const spec: ChoiceSpec = { kind: 'option', prompt: 'Mode', options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] };
    const h = await run(spec, ['nope', 'y']);
    expect(h.state().globalVars['picked']).toBe('y');
    expect(h.choices.requests).toHaveLength(2);
  });

  it('yesNo binds a boolean', async () => {
    const h = await run({ kind: 'yesNo', prompt: 'Sure?' }, [false], 'boolean');
    expect(h.state().globalVars['picked']).toBe(false);
  });

  it('player choice respects includeSelf and the asker (who)', async () => {
    const spec: ChoiceSpec = { kind: 'player', prompt: 'Target', includeSelf: false };
    const h = await run(spec, ['p1']);
    const req = h.choices.requests[0];
    expect(req.kind).toBe('player');
    if (req.kind === 'player') expect(req.playerIds).toEqual(['p1']); // asker p0 excluded
    expect(h.state().globalVars['picked']).toBe('p1');

    const inclusive = await run({ ...spec, includeSelf: true }, ['p0']);
    const r2 = inclusive.choices.requests[0];
    if (r2.kind === 'player') expect(r2.playerIds).toEqual(['p0', 'p1']);
  });

  it('asks the player named by `who`', async () => {
    const def = chooseDef(cardChoice());
    def.setup = [choose(cardChoice(), { kind: 'nextPlayer', from: { kind: 'currentPlayer' } }), sv('picked', str('done'))];
    const h = harness(def, { answers: [(req) => (req.kind === 'card' ? req.cardIds[0] : null)] });
    await h.engine.start();
    expect(h.choices.requests[0].playerId).toBe('p1');
  });

  it('blocks getLegalMoves while a choice is pending', async () => {
    let release: ((a: string) => void) | null = null;
    const def = makeDef({
      zones: [zone('a')],
      cards: [cdef('c1')],
      decks: [customDeck('d', 'a', ['c1'])],
      setup: [choose(cardChoice())],
    });
    const h = harness(def, {
      provider: {
        resolve: (req) => new Promise((res) => {
          release = (a) => res(a);
          // capture a valid card id for later
          void req;
        }),
      },
    });
    const started = h.engine.start();
    await Promise.resolve(); // let setup reach the choice
    expect(h.engine.getLegalMoves('p0')).toEqual([]);
    release!(idByName(h.engine.getState(), 'c1'));
    await started;
    expect(h.engine.getLegalMoves('p0')).toHaveLength(1);
  });
});
