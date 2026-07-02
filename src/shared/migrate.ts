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

// ---------------------------------------------------------------------------
// Tabbed groups (deprecated group.tabbed) → selector buttons
// ---------------------------------------------------------------------------

/** The generated selector-button row's slice of the group (top, 12% tall). */
const SELBAR_RECT = { x: 0, y: 0, w: 100, h: 12 };
/** Each former panel fills the rest of the group under the button row. */
const PANEL_RECT = { x: 0, y: 12, w: 100, h: 88 };

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Convert every `tabbed: true` group into the selector-button pattern the
 * runner renders today: the group keeps its rect; its children become a
 * generated selector-button row (`<groupId>_selbar`, one `role: 'selector'`
 * button `<panelId>_sel` per panel, `selectorGroup` = the group's id, label
 * = the panel's name) followed by the original panels, each bound via
 * `showForSelector` to its button and re-seated at the panel slice (their
 * authored rects were IGNORED by the old tabbed runtime). Ids derive from
 * existing ids, so the conversion is deterministic — and idempotent, since
 * the `tabbed` flag is dropped. Walks every container kind (nested tabbed
 * groups inside panels convert too).
 */
function migrateTabbedGroups(elements: ScreenElement[]): ScreenElement[] {
  return elements.map((el): ScreenElement => {
    const children = el.children !== undefined && el.children.length > 0
      ? migrateTabbedGroups(el.children)
      : el.children;
    if (el.kind !== 'group' || el.tabbed !== true) {
      return children === el.children ? el : { ...el, children } as ScreenElement;
    }
    const { tabbed: _gone, ...group } = el;
    const panels = children ?? [];
    if (panels.length === 0) return { ...group, children: [] };
    const w = round2(100 / panels.length);
    const selbar: ScreenElement = {
      kind: 'group',
      id: `${el.id}_selbar`,
      name: `${el.name} switcher`,
      rect: { ...SELBAR_RECT },
      children: panels.map((p, i): ScreenElement => ({
        kind: 'button',
        id: `${p.id}_sel`,
        name: p.name,
        rect: { x: round2(i * (100 / panels.length)), y: 0, w, h: 100 },
        actionId: null,
        label: p.name,
        role: 'selector',
        selectorGroup: el.id,
      })),
    };
    return {
      ...group,
      children: [
        selbar,
        ...panels.map((p): ScreenElement => ({
          ...p,
          rect: { ...PANEL_RECT },
          showForSelector: `${p.id}_sel`,
        })),
      ],
    };
  });
}

function hasTabbed(elements: ScreenElement[]): boolean {
  return elements.some((el) =>
    (el.kind === 'group' && el.tabbed === true)
    || (el.children !== undefined && hasTabbed(el.children)));
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
  // Tabbed groups (deprecated) → selector-button rows, in BOTH variants.
  if (out.screenLayout) {
    const sl = out.screenLayout;
    const mobile = sl.mobile ?? null;
    const deskTabbed = hasTabbed(sl.elements);
    const mobTabbed = mobile !== null && hasTabbed(mobile.elements);
    if (deskTabbed || mobTabbed) {
      out = {
        ...out,
        screenLayout: {
          ...sl,
          elements: deskTabbed ? migrateTabbedGroups(sl.elements) : sl.elements,
          ...(mobTabbed && mobile !== null
            ? { mobile: { ...mobile, elements: migrateTabbedGroups(mobile.elements) } }
            : {}),
        },
      };
    }
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
