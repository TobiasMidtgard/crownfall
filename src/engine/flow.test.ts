import { describe, expect, it } from 'vitest';
import type { EndConditionDef, Expr } from '../shared/types';
import {
  actionDef, ann, bnd, boolE, cdef, cmp, curP, customDeck, cv, gv, harness, makeDef, mv, num,
  phaseDef, selTop, sv, vdef, zone, zr,
} from './testkit';

const nextP = (from: Expr): Expr => ({ kind: 'nextPlayer', from });

describe('phase modes', () => {
  it('auto phases run onEnter and advance without input', async () => {
    const def = makeDef({
      zones: [zone('a'), zone('b')],
      cards: [cdef('c1'), cdef('c2')],
      decks: [customDeck('d', 'a', ['c1', 'c2'])],
      phases: [
        phaseDef('draw', 'auto', [], [mv(zr('a'), zr('b'), selTop(1))]),
        phaseDef('main', 'manual', ['idle']),
      ],
    });
    const h = harness(def);
    await h.engine.start();
    const s = h.state();
    expect(s.phaseIdx).toBe(1);
    expect(s.zones['b'].cardIds).toHaveLength(1);
    expect(h.engine.getLegalMoves('p0')).toEqual([{ actionId: 'idle' }]);
  });

  it('oneAction phases advance after exactly one action', async () => {
    const def = makeDef({
      variables: [vdef('n', 'global', 'number', 0)],
      phases: [phaseDef('one', 'oneAction', ['bump']), phaseDef('main', 'manual', ['idle'])],
      actions: [actionDef('bump', { script: [cv('n', num(1))] }), actionDef('idle')],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().phaseIdx).toBe(0);
    await h.engine.performAction('p0', { actionId: 'bump' });
    expect(h.state().phaseIdx).toBe(1);
    expect(h.state().globalVars['n']).toBe(1);
    expect(h.state().currentPlayerIdx).toBe(0); // same turn
  });

  it('manual phases stay until endPhase/endTurn', async () => {
    const def = makeDef({
      variables: [vdef('n', 'global', 'number', 0)],
      phases: [phaseDef('main', 'manual', ['bump', 'done']), phaseDef('after', 'manual', ['idle'])],
      actions: [
        actionDef('bump', { script: [cv('n', num(1))] }),
        actionDef('done', { script: [{ kind: 'endPhase' }] }),
        actionDef('idle'),
      ],
    });
    const h = harness(def);
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'bump' });
    await h.engine.performAction('p0', { actionId: 'bump' });
    expect(h.state().phaseIdx).toBe(0);
    await h.engine.performAction('p0', { actionId: 'done' });
    expect(h.state().phaseIdx).toBe(1);
    expect(h.state().globalVars['n']).toBe(2);
  });

  it('deadlock guard: a phase with zero legal moves auto-advances and logs it', async () => {
    const def = makeDef({
      phases: [phaseDef('stuck', 'oneAction', ['never']), phaseDef('main', 'manual', ['idle'])],
      actions: [actionDef('never', { legality: boolE(false) }), actionDef('idle')],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().phaseIdx).toBe(1);
    expect(h.state().log.some((l) => l.text.includes('no moves'))).toBe(true);
  });

  it('endGame winner expressions see the bindings live at the block site', async () => {
    // "the second player in seating order wins" via forEachPlayer's $player —
    // the winner expr must be resolved BEFORE the script unwinds.
    const def = makeDef({
      variables: [vdef('i', 'global', 'number', 0)],
      phases: [phaseDef('main', 'manual', ['win'])],
      actions: [
        actionDef('win', {
          script: [{
            kind: 'forEachPlayer',
            body: [
              cv('i', num(1)),
              {
                kind: 'if',
                cond: cmp('==', gv('i'), num(2)),
                then: [{ kind: 'endGame', winner: { kind: 'player', player: bnd('$player') } }],
                else: [],
              },
            ],
          }],
        }),
      ],
    });
    const h = harness(def);
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'win' });
    expect(h.state().result?.winners).toEqual(['p1']);
    expect(h.errors).toHaveLength(0);
  });

  it('endTurn from a phaseEnd trigger escalates the advance to a turn transition', async () => {
    const def = makeDef({
      phases: [phaseDef('a', 'manual', ['next']), phaseDef('b', 'manual', ['idle'])],
      actions: [actionDef('next', { script: [{ kind: 'endPhase' }] }), actionDef('idle')],
      triggers: [{
        id: 't', name: 't',
        event: { kind: 'phaseEnd', phaseId: 'a' },
        condition: null,
        script: [{ kind: 'endTurn' }],
      }],
    });
    const h = harness(def);
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'next' });
    // Phase b is skipped entirely: the trigger turned the phase advance into a turn pass.
    expect(h.state().currentPlayerIdx).toBe(1);
    expect(h.state().phaseIdx).toBe(0);
    expect(h.state().turnNumber).toBe(2);
  });

  it('stalemate: a game where nobody can ever act ends in a draw', async () => {
    const def = makeDef({
      phases: [phaseDef('main', 'manual', ['never'])],
      actions: [actionDef('never', { legality: boolE(false) })],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.engine.finished).toBe(true);
    expect(h.state().result).toEqual({ winners: [], text: "It's a draw." });
    expect(h.state().log.some((l) => l.text.includes('Stalemate'))).toBe(true);
    // Detected within a couple of rotations, not by spinning to the cap.
    expect(h.state().turnNumber).toBeLessThan(10);
    expect(h.errors).toHaveLength(0);
  });

  it('stalemate detection is disabled for defs that read turnNumber', async () => {
    const def = makeDef({
      phases: [phaseDef('main', 'manual', ['never'])],
      actions: [actionDef('never', { legality: boolE(false) })],
      endConditions: [{
        id: 'late', name: 'late', winner: { kind: 'draw' },
        condition: cmp('>=', { kind: 'turnNumber' }, num(5000)),
      }],
    });
    const h = harness(def);
    await h.engine.start();
    // No stalemate draw; the transition cap reports instead and the game stalls.
    expect(h.state().result).toBeNull();
    expect(h.errors.some((e) => e.includes('phase transitions'))).toBe(true);
  });

  it('endPhase in onEnter skips the rest of that script and the phase', async () => {
    const def = makeDef({
      variables: [vdef('n', 'global', 'number', 0)],
      phases: [
        phaseDef('skip', 'manual', ['idle'], [{ kind: 'endPhase' }, cv('n', num(99))]),
        phaseDef('main', 'manual', ['idle']),
      ],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.state().phaseIdx).toBe(1);
    expect(h.state().globalVars['n']).toBe(0); // script stopped at endPhase
  });
});

describe('turns', () => {
  const turnDef = () => makeDef({
    phases: [phaseDef('main', 'manual', ['pass', 'steer'])],
    actions: [
      actionDef('pass', { script: [{ kind: 'endTurn' }] }),
      actionDef('steer', { script: [{ kind: 'setNextPlayer', player: nextP(nextP(curP)) }, { kind: 'endTurn' }] }),
    ],
  });

  it('endTurn passes to the next seat and bumps turnNumber', async () => {
    const h = harness(turnDef(), { players: ['A', 'B', 'C'] });
    await h.engine.start();
    expect(h.state().turnNumber).toBe(1);
    await h.engine.performAction('p0', { actionId: 'pass' });
    expect(h.state().currentPlayerIdx).toBe(1);
    expect(h.state().turnNumber).toBe(2);
    expect(h.engine.getLegalMoves('p0')).toEqual([]);
    expect(h.engine.getLegalMoves('p1')).toHaveLength(2);
    // wraps around
    await h.engine.performAction('p1', { actionId: 'pass' });
    await h.engine.performAction('p2', { actionId: 'pass' });
    expect(h.state().currentPlayerIdx).toBe(0);
    expect(h.state().turnNumber).toBe(4);
  });

  it('setNextPlayer overrides the next seat once, then normal order resumes', async () => {
    const h = harness(turnDef(), { players: ['A', 'B', 'C'] });
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'steer' }); // next = seat after seat after p0 = p2
    expect(h.state().currentPlayerIdx).toBe(2);
    await h.engine.performAction('p2', { actionId: 'pass' }); // override consumed → normal: p0
    expect(h.state().currentPlayerIdx).toBe(0);
  });
});

describe('game end', () => {
  it('endGame block ends immediately with a player winner; further moves are illegal', async () => {
    const def = makeDef({
      phases: [phaseDef('main', 'manual', ['win'])],
      actions: [actionDef('win', { script: [{ kind: 'endGame', winner: { kind: 'player', player: curP } }, ann('never')] })],
    });
    const h = harness(def);
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'win' });
    const s = h.state();
    expect(h.engine.finished).toBe(true);
    expect(s.result).toEqual({ winners: ['p0'], text: 'Alice wins!' });
    expect(s.log.some((l) => l.text === 'never')).toBe(false); // endGame stops the script
    expect(h.engine.getLegalMoves('p0')).toEqual([]);
    await expect(h.engine.performAction('p0', { actionId: 'win' })).rejects.toThrow(/Illegal/);
  });

  const scoreEnd = (winner: EndConditionDef['winner']): EndConditionDef => ({
    id: 'e1', name: 'e1', condition: cmp('>=', gv('round'), num(1)), winner,
  });

  const scoreDef = (winner: EndConditionDef['winner'], scores: number[]) => makeDef({
    variables: [vdef('score', 'perPlayer', 'number', 0), vdef('round', 'global', 'number', 0)],
    phases: [phaseDef('main', 'manual', ['go'])],
    actions: [
      actionDef('go', {
        script: [
          ...scores.map((v, i) => {
            let target: Expr = curP;
            for (let k = 0; k < i; k++) target = nextP(target);
            return sv('score', num(v), target);
          }),
          sv('round', num(1)),
        ],
      }),
    ],
    endConditions: [scoreEnd(winner)],
  });

  it('end conditions are checked after the action settles; highestVar picks all tied players', async () => {
    const h = harness(scoreDef({ kind: 'highestVar', varId: 'score' }, [7, 7, 3]), { players: ['A', 'B', 'C'] });
    await h.engine.start();
    expect(h.engine.finished).toBe(false);
    await h.engine.performAction('p0', { actionId: 'go' });
    expect(h.engine.finished).toBe(true);
    expect(h.state().result).toEqual({ winners: ['p0', 'p1'], text: 'A and B win!' });
  });

  it('lowestVar winner', async () => {
    const h = harness(scoreDef({ kind: 'lowestVar', varId: 'score' }, [7, 2, 3]), { players: ['A', 'B', 'C'] });
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'go' });
    expect(h.state().result?.winners).toEqual(['p1']);
  });

  it('draw winner', async () => {
    const h = harness(scoreDef({ kind: 'draw' }, [1, 2]));
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'go' });
    expect(h.state().result).toEqual({ winners: [], text: "It's a draw." });
  });

  it('end conditions evaluate with the CURRENT player as contextual player', async () => {
    // Condition: current player's score >= 5. p0 sets p1's score to 5 — game
    // must NOT end on p0's turn; it ends right after the turn passes to p1.
    const def = makeDef({
      variables: [vdef('score', 'perPlayer', 'number', 0)],
      phases: [phaseDef('main', 'manual', ['give', 'pass'])],
      actions: [
        actionDef('give', { script: [sv('score', num(5), nextP(curP))] }),
        actionDef('pass', { script: [{ kind: 'endTurn' }] }),
      ],
      endConditions: [{
        id: 'e', name: 'e',
        condition: cmp('>=', gv('score'), num(5)), // contextual target → current player
        winner: { kind: 'highestVar', varId: 'score' },
      }],
    });
    const h = harness(def);
    await h.engine.start();
    await h.engine.performAction('p0', { actionId: 'give' });
    expect(h.engine.finished).toBe(false);
    await h.engine.performAction('p0', { actionId: 'pass' });
    expect(h.engine.finished).toBe(true);
    expect(h.state().result?.winners).toEqual(['p1']);
  });

  it('endGame during setup wins before the first phase runs', async () => {
    const def = makeDef({
      setup: [{ kind: 'endGame', winner: { kind: 'draw' } }],
      phases: [phaseDef('main', 'manual', ['idle'], [ann('entered')])],
    });
    const h = harness(def);
    await h.engine.start();
    expect(h.engine.finished).toBe(true);
    expect(h.state().log.some((l) => l.text === 'entered')).toBe(false);
  });
});

describe('engine guards', () => {
  it('start() twice throws', async () => {
    const h = harness(makeDef());
    await h.engine.start();
    await expect(h.engine.start()).rejects.toThrow(/once/);
  });

  it('rejects performAction while another is in flight', async () => {
    let release: ((a: boolean) => void) | null = null;
    const def = makeDef({
      phases: [phaseDef('main', 'manual', ['ask'])],
      actions: [actionDef('ask', { script: [{ kind: 'choose', who: null, choice: { kind: 'yesNo', prompt: '?' } }] })],
    });
    const h = harness(def, { provider: { resolve: () => new Promise((res) => { release = res; }) } });
    await h.engine.start();
    const first = h.engine.performAction('p0', { actionId: 'ask' });
    await expect(h.engine.performAction('p0', { actionId: 'ask' })).rejects.toThrow(/resolving/);
    release!(true);
    await first;
  });

  it('rejects moves from the wrong player or with stray card ids', async () => {
    const h = harness(makeDef());
    await h.engine.start();
    await expect(h.engine.performAction('p1', { actionId: 'idle' })).rejects.toThrow(/Illegal/);
    await expect(h.engine.performAction('p0', { actionId: 'idle', cardId: 'c0' })).rejects.toThrow(/Illegal/);
    await expect(h.engine.performAction('p0', { actionId: 'ghost' })).rejects.toThrow(/Illegal/);
  });
});
