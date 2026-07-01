/**
 * Ready-made screen-element templates. The phase track is the canonical
 * example of "circles with logic": one labeled circle per phase whose states
 * read the phaseIndex/phasePos expressions — accent-filled while current,
 * dimmed once passed, outlined while upcoming. Because phaseIndex resets
 * when the turn passes, the track resets on end turn by construction.
 *
 * Used by the screen builder's palette AND by the phaseDots migration.
 */
import type { Expr, GameDef, ScreenElement } from './types';
import { uid } from './defaults';

const phaseIndex: Expr = { kind: 'phaseIndex' };
const phasePos = (phaseId: string): Expr => ({ kind: 'phasePos', phaseId });
const cmp = (op: '==' | '>' , left: Expr, right: Expr): Expr => ({ kind: 'compare', op, left, right });

export interface PhaseTrackOptions {
  /** % of the parent. */
  rect: { x: number; y: number; w: number; h: number };
  showNames?: boolean;
  activeColor?: string;
}

/**
 * A group containing one circle per phase (with done/current states),
 * connector lines between them, and optional name labels underneath.
 * Returns null when the def has no phases.
 */
export function phaseTrackGroup(def: GameDef, opts: PhaseTrackOptions): ScreenElement | null {
  const phases = def.phases;
  if (phases.length === 0) return null;
  const active = opts.activeColor ?? 'var(--accent)';
  const showNames = opts.showNames !== false;

  const children: ScreenElement[] = [];
  const n = phases.length;
  // Inside the group: circles sit on a horizontal track. Dot width is sized
  // so n dots + (n-1) line segments share the group's width.
  const dotW = Math.min(14, 100 / (n * 2 - 1));
  const slot = n > 1 ? (100 - dotW) / (n - 1) : 0;
  const dotH = showNames ? 55 : 90;

  phases.forEach((p, i) => {
    const x = n > 1 ? i * slot : (100 - dotW) / 2;
    if (i > 0) {
      children.push({
        kind: 'line',
        id: uid('el'),
        name: `${p.name} link`,
        rect: { x: x - slot + dotW, y: 0, w: slot - dotW, h: dotH },
        orient: 'h',
        thickness: 2,
        style: { borderColor: 'var(--border-strong)' },
        states: [{
          id: uid('st'),
          name: 'Reached',
          when: cmp('>', phaseIndex, phasePos(phases[i - 1].id)),
          style: { borderColor: active },
        }],
      });
    }
    children.push({
      kind: 'shape',
      id: uid('el'),
      name: `${p.name} dot`,
      rect: { x, y: 0, w: dotW, h: dotH },
      shape: 'circle',
      style: { background: 'transparent', borderColor: 'var(--border-strong)', borderWidth: 2 },
      states: [
        {
          id: uid('st'),
          name: 'Current',
          when: cmp('==', phaseIndex, phasePos(p.id)),
          style: { background: active, borderColor: active },
        },
        {
          id: uid('st'),
          name: 'Done',
          when: cmp('>', phaseIndex, phasePos(p.id)),
          style: { background: 'var(--border-strong)', borderColor: 'var(--border-strong)' },
        },
      ],
    });
    if (showNames) {
      children.push({
        kind: 'text',
        id: uid('el'),
        name: `${p.name} label`,
        rect: { x: x - dotW, y: dotH + 10, w: dotW * 3, h: 100 - dotH - 10 },
        text: p.name,
        fontSize: 1,
        align: 'center',
      });
    }
  });

  return {
    kind: 'group',
    id: uid('el'),
    name: 'Phase track',
    rect: opts.rect,
    children,
  };
}
