/**
 * Best-effort migration of the deprecated v3 `tableLayout` (board + seat
 * strip) into the v4 `screenLayout` element tree. Idempotent: defs that
 * already have a screenLayout, or no tableLayout, pass through unchanged.
 *
 * Mapping (coarse by design — authors fine-tune in the screen builder):
 *  - board occupies the middle band of the screen (y 16..74);
 *  - groups become group elements with their members (group-relative rects
 *    carry over directly);
 *  - each seat zone becomes a viewer element in the bottom band (y 78..100)
 *    and a compact opp1 copy in the top band (y 0..13);
 *  - styles, padding/gap/columns, card scales and z-order carry over.
 */
import type {
  GameDef, LayoutRect, ScreenElement, SeatRef, TableLayout,
} from './types';
import { SCHEMA_VERSION } from './types';
import { uid } from './defaults';
import { phaseTrackGroup } from './screenTemplates';

const BOARD_TOP = 16;
const BOARD_HEIGHT = 58;

function bandRect(r: { x: number; y: number; w: number; h: number }, top: number, height: number) {
  return {
    x: r.x,
    y: Math.round((top + (r.y / 100) * height) * 10) / 10,
    w: r.w,
    h: Math.round(((r.h / 100) * height) * 10) / 10,
  };
}

function zoneEl(
  def: GameDef, zoneId: string, r: LayoutRect, seat: SeatRef,
  rect: { x: number; y: number; w: number; h: number },
): ScreenElement {
  const zone = def.zones.find((z) => z.id === zoneId);
  return {
    kind: 'zone',
    id: uid('el'),
    name: zone ? `${zone.name}${seat === 'opp1' ? ' (opponent)' : ''}` : zoneId,
    rect,
    zoneId,
    seat: zone?.owner === 'shared' ? 'shared' : seat,
    cardScale: r.cardScale,
    showName: r.showName,
    style: r.style,
    padding: r.padding,
    gap: r.gap,
    columns: r.columns ?? undefined,
  };
}

function migrateLayout(def: GameDef, tl: TableLayout): ScreenElement[] {
  const elements: ScreenElement[] = [];
  const groups = tl.groups ?? [];
  const order = tl.order ?? [...groups.map((g) => g.id), ...Object.keys(tl.board)];
  const placed = new Set<string>();

  for (const id of order) {
    const group = groups.find((g) => g.id === id);
    if (group && !placed.has(id)) {
      placed.add(id);
      const children: ScreenElement[] = [];
      for (const [zid, r] of Object.entries(tl.board)) {
        if (r.groupId !== group.id || placed.has(zid)) continue;
        placed.add(zid);
        // Group children stay group-relative.
        children.push(zoneEl(def, zid, r, 'viewer', { x: r.x, y: r.y, w: r.w, h: r.h }));
      }
      elements.push({
        kind: 'group',
        id: group.id,
        name: group.name,
        rect: bandRect(group.rect, BOARD_TOP, BOARD_HEIGHT),
        style: group.style,
        children,
      });
      continue;
    }
    const r = tl.board[id];
    if (r && !placed.has(id) && r.groupId == null) {
      placed.add(id);
      elements.push(zoneEl(def, id, r, 'viewer', bandRect(r, BOARD_TOP, BOARD_HEIGHT)));
    }
  }
  // Anything order missed.
  for (const [zid, r] of Object.entries(tl.board)) {
    if (placed.has(zid) || r.groupId != null) continue;
    elements.push(zoneEl(def, zid, r, 'viewer', bandRect(r, BOARD_TOP, BOARD_HEIGHT)));
  }

  for (const [zid, r] of Object.entries(tl.seat)) {
    elements.push(zoneEl(def, zid, r, 'opp1', bandRect(r, 0, 13)));
    elements.push(zoneEl(def, zid, r, 'viewer', bandRect(r, 78, 22)));
  }
  return elements;
}

/**
 * The removed v4.0 phase-dots element, kept structurally so old saved
 * documents still parse and convert.
 */
type LegacyPhaseDots = Omit<Extract<ScreenElement, { kind: 'text' }>, 'kind' | 'text' | 'fontSize' | 'align'> & {
  kind: 'phaseDots';
  showNames?: boolean;
  activeColor?: string;
};
type AnyElement = ScreenElement | LegacyPhaseDots;

/** Replace removed phaseDots elements with generated phase-track groups. */
function migratePhaseDots(def: GameDef, elements: AnyElement[]): ScreenElement[] {
  return elements.map((el): ScreenElement => {
    if (el.kind === 'group') {
      return { ...el, children: migratePhaseDots(def, el.children) };
    }
    if (el.kind !== 'phaseDots') return el;
    const track = phaseTrackGroup(def, {
      rect: el.rect,
      showNames: el.showNames,
      activeColor: el.activeColor,
    });
    return track
      ? { ...track, id: el.id, name: el.name, visible: el.visible, reveal: el.reveal }
      : { kind: 'text', id: el.id, name: el.name, rect: el.rect, text: '', fontSize: 1, align: 'center' };
  });
}

function hasPhaseDots(elements: AnyElement[]): boolean {
  return elements.some((el) =>
    el.kind === 'phaseDots' || (el.kind === 'group' && hasPhaseDots(el.children as AnyElement[])));
}

/** Migrate in place-of: returns a NEW def when migration applies. */
export function migrateGameDef(def: GameDef): GameDef {
  let out = def;
  if (out.schemaVersion !== SCHEMA_VERSION) {
    // v1 → v2 is a pure pass-through: every v2 addition (move tags, draw /
    // choosePile / triggerAbilities blocks, effectResolved, sumCards,
    // 'contains') is an optional field or a new union member, so v1
    // documents load unchanged apart from the stamp.
    out = { ...out, schemaVersion: SCHEMA_VERSION };
  }
  if (out.tableLayout && !out.screenLayout) {
    const tl = out.tableLayout;
    out = {
      ...out,
      tableLayout: undefined,
      screenLayout: {
        background: tl.background,
        aspect: null,
        elements: migrateLayout(out, tl),
      },
    };
  } else if (out.tableLayout && out.screenLayout) {
    out = { ...out, tableLayout: undefined };
  }
  if (out.screenLayout && hasPhaseDots(out.screenLayout.elements)) {
    out = {
      ...out,
      screenLayout: {
        ...out.screenLayout,
        elements: migratePhaseDots(out, out.screenLayout.elements),
      },
    };
  }
  // Card vocabulary (types / tags / named filters): seed absent lists to []
  // so editors can append without null checks. Additive — no version bump.
  if (!out.cardTypes || !out.cardTags || !out.filters) {
    out = {
      ...out,
      cardTypes: out.cardTypes ?? [],
      cardTags: out.cardTags ?? [],
      filters: out.filters ?? [],
    };
  }
  return out;
}
