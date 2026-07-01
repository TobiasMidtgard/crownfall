import { describe, expect, it } from 'vitest';
import { evalDisplayExpr, isDisplayVisible } from './display';
import {
  actionDef, bnd, cmp, curP, harness, makeDef, num, phaseDef, vdef, zcount, zone, zr,
} from './testkit';

describe('evalDisplayExpr', () => {
  const def = makeDef({
    variables: [vdef('life', 'perPlayer', 'number', 20)],
    zones: [zone('pile')],
    phases: [phaseDef('main', 'manual', ['idle'])],
    actions: [actionDef('idle')],
  });

  it('evaluates read-only against a public snapshot with $viewer bound', async () => {
    const h = harness(def);
    await h.engine.start();
    const state = h.engine.getState();

    // $viewer is bound to the asking seat.
    expect(evalDisplayExpr(def, state, bnd('$viewer'), 'p1')).toBe('p1');
    // "it's my turn" — the canonical visibility condition.
    expect(evalDisplayExpr(def, state, cmp('==', curP, bnd('$viewer')), 'p0')).toBe(true);
    expect(evalDisplayExpr(def, state, cmp('==', curP, bnd('$viewer')), 'p1')).toBe(false);
    // Zone/var reads work; stackSize mirrors the public stack view (empty).
    expect(evalDisplayExpr(def, state, zcount(zr('pile')), 'p0')).toBe(0);
    expect(evalDisplayExpr(def, state, { kind: 'getVar', varId: 'life', target: bnd('$viewer') }, 'p1')).toBe(20);
    expect(evalDisplayExpr(def, state, { kind: 'stackSize' }, 'p0')).toBe(0);
    // Evaluation must not mutate the snapshot.
    expect(JSON.stringify(h.engine.getState())).toBe(JSON.stringify(state));
  });

  it('phaseIndex / phasePos express has-been, is-current, not-yet', async () => {
    const multiDef = makeDef({
      phases: [
        phaseDef('a', 'manual', ['next']),
        phaseDef('b', 'manual', ['next']),
        phaseDef('c', 'manual', ['idle']),
      ],
      actions: [
        { ...actionDef('next'), script: [{ kind: 'endPhase' }] },
        actionDef('idle'),
      ],
    });
    const h = harness(multiDef);
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'next' }); // now in phase b
    const state = h.engine.getState();
    const pos = (id: string) => ({ kind: 'phasePos', phaseId: id } as const);
    const idx = { kind: 'phaseIndex' } as const;
    expect(evalDisplayExpr(multiDef, state, cmp('>', idx, pos('a')), 'p0')).toBe(true);  // a has been
    expect(evalDisplayExpr(multiDef, state, cmp('==', idx, pos('b')), 'p0')).toBe(true); // b is current
    expect(evalDisplayExpr(multiDef, state, cmp('<', idx, pos('c')), 'p0')).toBe(true);  // c not yet
    expect(evalDisplayExpr(multiDef, state, pos('missing'), 'p0')).toBe(-1);
    // The phaseIs sugar: only the current phase is true; missing phases never are.
    expect(evalDisplayExpr(multiDef, state, { kind: 'phaseIs', phaseId: 'b' }, 'p0')).toBe(true);
    expect(evalDisplayExpr(multiDef, state, { kind: 'phaseIs', phaseId: 'a' }, 'p0')).toBe(false);
    expect(evalDisplayExpr(multiDef, state, { kind: 'phaseIs', phaseId: 'missing' }, 'p0')).toBe(false);
  });

  it('isDisplayVisible: null = visible, errors/junk = hidden, truthiness otherwise', async () => {
    const h = harness(def);
    await h.engine.start();
    const state = h.engine.getState();
    expect(isDisplayVisible(def, state, null, 'p0')).toBe(true);
    expect(isDisplayVisible(def, state, undefined, 'p0')).toBe(true);
    expect(isDisplayVisible(def, state, num(1), 'p0')).toBe(true);
    expect(isDisplayVisible(def, state, num(0), 'p0')).toBe(false);
    // Unset binding evaluates to null silently -> hidden, no throw.
    expect(isDisplayVisible(def, state, bnd('$card'), 'p0')).toBe(false);
  });
});
