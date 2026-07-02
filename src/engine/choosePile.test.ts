/**
 * The `choosePile` block (wave 1a): grouped one-per-distinct-card choice from
 * a filtered zone, the 'pile' ChoiceRequest (counts, optional/decline), and
 * the 3-retry/fallback safety net.
 */
import { describe, expect, it } from 'vitest';
import type { Block, GameDef } from '../shared/types';
import {
  bnd, cdef, cmp, customDeck, fld, harness, makeDef, mv, num, selSpec, sv,
  vdef, zone, zr, type ScriptedAnswer,
} from './testkit';

function pileBlock(over: Partial<Extract<Block, { kind: 'choosePile' }>> = {}): Block {
  return {
    kind: 'choosePile', who: null, from: zr('supply'), filter: null,
    groupBy: 'def', prompt: 'Gain a card', optional: false,
    body: [
      sv('picked', fld(bnd('$card'), 'name')),
      mv(zr('supply'), zr('out'), selSpec(bnd('$card'))),
    ],
    ...over,
  };
}

/** Supply bottom→top: x, x, y, z, x — piles x(3), y(1), z(1). */
function pileDef(block: Block, over: Partial<GameDef> = {}): GameDef {
  return makeDef({
    variables: [vdef('picked', 'global', 'string', '(unset)')],
    zones: [zone('supply'), zone('out')],
    cards: [cdef('x', { cost: 1 }), cdef('y', { cost: 2 }), cdef('z', { cost: 5 })],
    decks: [customDeck('d', 'supply', [['x', 2], 'y', 'z', 'x'])],
    setup: [block],
    ...over,
  });
}

describe('choosePile', () => {
  it('offers one pile per distinct def, first-appearance order, top copy as representative', async () => {
    const h = harness(pileDef(pileBlock()), {
      answers: [(req) => (req.kind === 'pile' ? req.cardIds[0] : null)],
    });
    await h.engine.start();
    const req = h.choices.requests[0];
    expect(req.kind).toBe('pile');
    if (req.kind !== 'pile') return;
    expect(req.cardIds).toHaveLength(3);
    expect(req.counts).toEqual([3, 1, 1]); // x first-appears first, then y, z
    expect(req.optional).toBe(false);
    const s = h.state();
    const names = req.cardIds.map((id) => s.cards[id].name);
    expect(names).toEqual(['x', 'y', 'z']);
    // The x representative is the TOP x copy (last in zone order at ask time).
    // Setup zone order was [x, x, y, z, x] — index 4 held the top x.
    expect(s.globalVars['picked']).toBe('x');
    expect(h.state().zones['out'].cardIds).toHaveLength(1);
    expect(h.errors).toEqual([]);
  });

  it('representative is the pile’s top copy', async () => {
    let repId = '';
    const h = harness(pileDef(pileBlock()), {
      answers: [(req) => {
        if (req.kind !== 'pile') return null;
        repId = req.cardIds[0];
        return repId;
      }],
    });
    await h.engine.start();
    // Spawn order = zone order: c0 x, c1 x, c2 y, c3 z, c4 x → top x is c4.
    expect(repId).toBe('c4');
  });

  it('applies the filter before grouping ($card bound per candidate)', async () => {
    const cheap = cmp('<', fld(bnd('$card'), 'cost'), num(3));
    const h = harness(pileDef(pileBlock({ filter: cheap })), {
      answers: [(req) => (req.kind === 'pile' ? req.cardIds[req.cardIds.length - 1] : null)],
    });
    await h.engine.start();
    const req = h.choices.requests[0];
    if (req.kind !== 'pile') throw new Error('expected pile');
    expect(req.counts).toEqual([3, 1]); // z (cost 5) filtered out
    expect(h.state().globalVars['picked']).toBe('y');
  });

  it('optional: declining with null skips the body silently', async () => {
    const h = harness(pileDef(pileBlock({ optional: true })), { answers: [null] });
    await h.engine.start();
    expect(h.state().globalVars['picked']).toBe('(unset)');
    expect(h.state().zones['out'].cardIds).toHaveLength(0);
    expect(h.errors).toEqual([]);
  });

  it('mandatory: declining is re-asked, then falls back to the first pile', async () => {
    const h = harness(pileDef(pileBlock()), { answers: [null, null, null] });
    await h.engine.start();
    expect(h.choices.requests).toHaveLength(3);
    expect(h.state().globalVars['picked']).toBe('x'); // fallback = first pile
    expect(h.errors.some((e) => e.includes('3 attempts'))).toBe(true);
  });

  it('a non-representative instance id is an invalid answer', async () => {
    const answers: ScriptedAnswer[] = [
      'c0', 'c0', // a real x copy, but not the offered representative (c4)
      (req) => (req.kind === 'pile' ? req.cardIds[1] : null),
    ];
    const h = harness(pileDef(pileBlock()), { answers });
    await h.engine.start();
    expect(h.choices.requests).toHaveLength(3);
    expect(h.state().globalVars['picked']).toBe('y');
  });

  it('no piles: optional is silent, mandatory reports', async () => {
    const none = cmp('>', fld(bnd('$card'), 'cost'), num(99));
    const opt = harness(pileDef(pileBlock({ filter: none, optional: true })));
    await opt.engine.start();
    expect(opt.choices.requests).toHaveLength(0);
    expect(opt.errors).toEqual([]);

    const req = harness(pileDef(pileBlock({ filter: none })));
    await req.engine.start();
    expect(req.choices.requests).toHaveLength(0);
    expect(req.errors.some((e) => e.includes('no piles'))).toBe(true);
  });

  it('the request carries the block’s revealed flag (absent/false → false)', async () => {
    const pick: ScriptedAnswer = (req) => (req.kind === 'pile' ? req.cardIds[0] : null);
    // Default: the block has no revealed field — the request says false.
    const hidden = harness(pileDef(pileBlock()), { answers: [pick] });
    await hidden.engine.start();
    const hReq = hidden.choices.requests[0];
    if (hReq.kind !== 'pile') throw new Error('expected pile');
    expect(hReq.revealed).toBe(false);
    // revealed: true (a hidden stock like the Black Market) reaches the UI.
    const shown = harness(pileDef(pileBlock({ revealed: true })), { answers: [pick] });
    await shown.engine.start();
    const sReq = shown.choices.requests[0];
    if (sReq.kind !== 'pile') throw new Error('expected pile');
    expect(sReq.revealed).toBe(true);
  });

  it('asks the player named by who', async () => {
    const nextP = { kind: 'nextPlayer', from: { kind: 'currentPlayer' } } as const;
    const h = harness(pileDef(pileBlock({ who: nextP })), {
      answers: [(req) => (req.kind === 'pile' ? req.cardIds[0] : null)],
    });
    await h.engine.start();
    expect(h.choices.requests[0].playerId).toBe('p1');
  });
});
