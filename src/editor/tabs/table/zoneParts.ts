/**
 * zoneParts — the shared contract between the canvas, the inspector and the
 * runner for a zone's editable card-chrome parts ("focus the supply, click
 * the cost badge, edit it"). Keys mirror ZonePartStyles in shared/types.ts.
 */
import type { Id, ScreenElement, ZonePartKey, ZonePartStyle } from '../../../shared/types';

/** A selected card-chrome part of one zone element (editor-only state). */
export interface ZonePartSel {
  elId: Id;
  part: ZonePartKey;
}

export interface ZonePartInfo {
  key: ZonePartKey;
  label: string;
  hint: string;
  /** The part carries text — color / size / bold apply. */
  text: boolean;
}

export const ZONE_PARTS: ZonePartInfo[] = [
  { key: 'pileBadge', label: 'Cost badge', hint: 'The field lozenge on each pile (usually cost)', text: true },
  { key: 'count', label: '× count', hint: 'The × N badge or pill on piles and stacks', text: true },
  { key: 'tileName', label: 'Tile name', hint: 'The name line on compact pile tiles', text: true },
  { key: 'caption', label: 'Caption', hint: 'The zone name + count row', text: true },
  { key: 'empty', label: 'Empty note', hint: 'The placeholder shown when no cards are here', text: true },
];

export function getPartStyle(el: ScreenElement, part: ZonePartKey): ZonePartStyle | undefined {
  return el.kind === 'zone' ? el.partStyles?.[part] : undefined;
}

/** Write one part (undefined/empty clears it); an all-empty map collapses away. */
export function withPartStyle(
  el: ScreenElement, part: ZonePartKey, next: ZonePartStyle | undefined,
): ScreenElement {
  if (el.kind !== 'zone') return el;
  const map = { ...el.partStyles };
  if (next === undefined || Object.keys(next).length === 0) delete map[part];
  else map[part] = next;
  return { ...el, partStyles: Object.keys(map).length > 0 ? map : undefined };
}
