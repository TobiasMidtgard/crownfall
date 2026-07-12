/**
 * Forced-choice auto-resolution: requests that admit exactly ONE valid
 * answer never reach the choice provider — the engine answers them itself
 * (with a log line), so play flows on without a pointless prompt, an AI
 * delay, or a wait on a remote seat. Revealed requests are exempt (the
 * choice sheet doubles as the reveal UI), and anything with a real
 * decision — an optional pick, a yes/no, a min<max range — still asks.
 */
import { describe, expect, it } from 'vitest';
import type { Block, Expr, GameDef } from '../shared/types';
import {
  actionDef, bnd, cdef, cmp, customDeck, harness, makeDef, phaseDef, str, sv,
  vdef, zone, zr, type ScriptedAnswer,
} from './testkit';

const isName = (name: string): Expr =>
  cmp('==', { kind: 'cardField', card: bnd('$card'), fieldId: 'name' }, str(name));

const chooseCard = (filter: Expr | null, optional: boolean): Block => ({
  kind: 'choose',
  who: null,
  choice: { kind: 'card', from: zr('pool'), filter, prompt: 'Pick a card', optional },
});

const takeCards = (filter: Expr | null, min: number, max: number, revealed = false): Block => ({
  kind: 'chooseCards',
  who: null,
  from: zr('pool'),
  filter,
  min: { kind: 'num', value: min },
  max: { kind: 'num', value: max },
  prompt: 'Take cards',
  revealed,
  body: [{ kind: 'changeVar', varId: 'picked', target: null, by: { kind: 'num', value: 1 } }],
});

/** Pool of three cards (a, b, b) the actions choose from. */
function poolDef(): GameDef {
  return makeDef({
    variables: [
      vdef('picked', 'global', 'number', 0),
      vdef('eff', 'global', 'string', ''),
    ],
    zones: [zone('pool')],
    cards: [cdef('a'), cdef('b')],
    decks: [customDeck('d', 'pool', ['a', 'b', 'b'])],
    phases: [phaseDef('main', 'manual', [
      'pickOnly', 'pickOptional', 'takeBoth', 'takeSome', 'revealOne', 'oneOption', 'yesNo',
    ])],
    actions: [
      // Exactly one candidate, mandatory ⇒ forced.
      { ...actionDef('pickOnly'), script: [
        chooseCard(isName('a'), false),
        sv('eff', { kind: 'cardField', card: bnd('$choice'), fieldId: 'name' }),
      ] },
      // One candidate but OPTIONAL ⇒ declining is a real decision — ask.
      { ...actionDef('pickOptional'), script: [chooseCard(isName('a'), true)] },
      // min = max = candidate count ⇒ only one legal subset — forced.
      { ...actionDef('takeBoth'), script: [takeCards(isName('b'), 2, 2)] },
      // A real range ⇒ ask.
      { ...actionDef('takeSome'), script: [takeCards(null, 1, 2)] },
      // Forced by count but REVEALED ⇒ the sheet is the reveal UI — ask.
      { ...actionDef('revealOne'), script: [takeCards(isName('a'), 1, 1, true)] },
      // A single option ⇒ forced.
      { ...actionDef('oneOption'), script: [{
        kind: 'choose', who: null,
        choice: { kind: 'option', prompt: 'Only path', options: [{ id: 'go', label: 'Go' }] },
      }, sv('eff', bnd('$choice'))] },
      // yes/no always has two answers ⇒ always ask.
      { ...actionDef('yesNo'), script: [{
        kind: 'choose', who: null,
        choice: { kind: 'yesNo', prompt: 'Sure?' },
      }] },
    ],
  });
}

async function run(actionId: string, answers: ScriptedAnswer[] = []) {
  const h = harness(poolDef(), { answers });
  await h.engine.start();
  await h.engine.performAction('p0', { actionId });
  return h;
}

describe('forced choices resolve without asking', () => {
  it('a mandatory single-candidate card pick auto-resolves with a log line', async () => {
    const h = await run('pickOnly');
    expect(h.choices.requests).toHaveLength(0);
    expect(h.state().globalVars['eff']).toBe('a');
    expect(h.state().log.some((l) => l.text.includes('resolved automatically'))).toBe(true);
    expect(h.errors).toEqual([]);
  });

  it('an OPTIONAL single-candidate pick still asks (declining is a decision)', async () => {
    const h = await run('pickOptional', [null]);
    expect(h.choices.requests).toHaveLength(1);
    expect(h.errors).toEqual([]);
  });

  it('chooseCards with min = max = all candidates auto-picks them all', async () => {
    const h = await run('takeBoth');
    expect(h.choices.requests).toHaveLength(0);
    expect(h.state().globalVars['picked']).toBe(2); // body ran once per card
    expect(h.errors).toEqual([]);
  });

  it('a real min–max range still asks', async () => {
    const h = await run('takeSome', [
      (req) => (req.kind === 'cards' ? JSON.stringify(req.cardIds.slice(0, 1)) : null),
    ]);
    expect(h.choices.requests).toHaveLength(1);
    expect(h.choices.requests[0].kind).toBe('cards');
    expect(h.errors).toEqual([]);
  });

  it('revealed requests are never auto-resolved (the sheet IS the reveal)', async () => {
    const h = await run('revealOne', [
      (req) => (req.kind === 'cards' ? JSON.stringify(req.cardIds) : null),
    ]);
    expect(h.choices.requests).toHaveLength(1);
    expect(h.errors).toEqual([]);
  });

  it('a single option auto-resolves; yes/no never does', async () => {
    const one = await run('oneOption');
    expect(one.choices.requests).toHaveLength(0);
    expect(one.state().globalVars['eff']).toBe('go');

    const yn = await run('yesNo', [true]);
    expect(yn.choices.requests).toHaveLength(1);
    expect(yn.errors).toEqual([]);
  });
});
