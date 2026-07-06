# Layout Backbone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an auto-layout engine (FlowLayout) with typed slots, a `panelSwitcher` and `image` element kind, and Grid/Row/Column palette items to the table designer, then migrate Dominion's supply band as proof.

**Architecture:** `FlowLayout` is an optional field on any container `ScreenElement`; when present the container flows its children via CSS flex/grid, all emitted from the single shared coordination point `src/runner/layoutGeometry.ts` so the runner and the editor canvas never drift. Typed `SlotDef`s route children by `slotId`; `panelSwitcher` is a thin kind over the existing selector-button machinery. Absent `layout`/`slots` = today's absolute positioning, unchanged.

**Tech Stack:** TypeScript, React 18, Vite, Vitest. Pure-geometry-first (test math without React), then wire render.

**Spec:** `docs/superpowers/specs/2026-07-06-layout-backbone-design.md`

**Commands:** test = `npm run test -- <path>` (vitest); typecheck/build = `npm run build`. Run from repo root.

**Backward-compat invariant (every task must preserve):** an element with no `layout` and no `slots` renders exactly as before. No `migrateGameDef` auto-conversion. New fields are optional / new union members — old JSON parses unchanged.

---

## Phase 1 — Model + CSS (pure, no React)

### Task 1: Types — FlowLayout, SlotDef, fields, new kinds

**Files:**
- Modify: `src/shared/types.ts` (`ScreenElementBase` ~199-246; `ScreenElement` union ~248-383)
- Test: `src/editor/tabs/table/screenModel.test.ts` (add a construction test)

- [ ] **Step 1: Write the failing test** — append to `screenModel.test.ts`:

```ts
import type { FlowLayout, ScreenElement } from '../../../shared/types';

describe('layout-backbone types', () => {
  it('a group can carry a FlowLayout and slotted children', () => {
    const layout: FlowLayout = { mode: 'grid', gap: 2, columns: 3, itemSize: 'uniform' };
    const el: ScreenElement = {
      kind: 'group', id: 'g1', name: 'Grid', rect: { x: 0, y: 0, w: 50, h: 50 },
      layout, children: [
        { kind: 'text', id: 't1', name: 'T', rect: { x: 0, y: 0, w: 10, h: 5 },
          text: 'hi', fontSize: 2, align: 'center', slotId: 'content' },
      ],
    };
    expect(el.layout?.mode).toBe('grid');
    expect(el.children?.[0].slotId).toBe('content');
  });

  it('image and panelSwitcher are valid kinds', () => {
    const img: ScreenElement = { kind: 'image', id: 'i1', name: 'Img',
      rect: { x: 0, y: 0, w: 10, h: 10 }, src: 'data:,', fit: 'contain' };
    const ps: ScreenElement = { kind: 'panelSwitcher', id: 'p1', name: 'PS',
      rect: { x: 0, y: 0, w: 40, h: 40 }, selectorGroup: 'grp',
      slots: [
        { id: 'tabs', name: 'Tabs', accepts: ['button'], layout: { mode: 'row' } },
        { id: 'content', name: 'Content', single: true, layout: { mode: 'column' } },
      ], children: [] };
    expect(img.kind).toBe('image');
    expect(ps.slots).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (compile error: `FlowLayout` not exported, `layout`/`slotId`/`image`/`panelSwitcher` unknown).
Run: `npm run test -- src/editor/tabs/table/screenModel.test.ts`

- [ ] **Step 3: Implement** — in `src/shared/types.ts`, add the interfaces just above `ScreenElementBase`:

```ts
export interface FlowLayout {
  mode: 'row' | 'column' | 'grid';
  gap?: number;          // % of screen width
  padding?: number;      // % of screen width
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  align?: 'start' | 'center' | 'end' | 'stretch';
  wrap?: boolean;
  columns?: number | null;
  rows?: number | null;
  autoFit?: number | null;   // grid: min item width (% screen) → auto-fill
  itemSize?: 'auto' | 'uniform' | 'stretch';
}

export interface SlotDef {
  id: Id;
  name: string;
  accepts?: ScreenElement['kind'][];
  layout: FlowLayout;
  rect?: { x: number; y: number; w: number; h: number };
  single?: boolean;
}
```

Inside `ScreenElementBase` add (after `children?`):

```ts
  /** Auto-layout: flow children (row/column/grid) instead of absolute rects. */
  layout?: FlowLayout;
  /** Typed sub-regions; children route in via their slotId. */
  slots?: SlotDef[];
  /** Which parent slot this element occupies (parent must declare it). */
  slotId?: Id;
```

In the `ScreenElement` union, after the `group` member add:

```ts
  | (ScreenElementBase & {
      kind: 'panelSwitcher';
      slots: SlotDef[];          // 'tabs' + 'content'
      selectorGroup: string;
    })
  | (ScreenElementBase & {
      kind: 'image';
      src: string;
      fit?: 'contain' | 'cover' | 'fill' | 'none';
      alt?: string;
    })
```

- [ ] **Step 4: Run — expect PASS.** Run: `npm run test -- src/editor/tabs/table/screenModel.test.ts`
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(types): FlowLayout, SlotDef, slotId, panelSwitcher & image kinds"`

---

### Task 2: `flowLayoutCss` in layoutGeometry

**Files:**
- Modify: `src/runner/layoutGeometry.ts` (add after `layoutStyleCss`; export `FlowCss` + `flowLayoutCss`; also re-export from `screenModel.ts`'s geometry re-export block if used there)
- Test: `src/runner/layoutGeometry.test.ts`

- [ ] **Step 1: Write the failing test**:

```ts
import { flowLayoutCss } from './layoutGeometry';

describe('flowLayoutCss', () => {
  it('returns {} for undefined', () => {
    expect(flowLayoutCss(undefined, 1000)).toEqual({});
  });
  it('row → flex row with px gap/padding', () => {
    const css = flowLayoutCss({ mode: 'row', gap: 2, padding: 1, justify: 'between', align: 'center', wrap: true }, 1000);
    expect(css.display).toBe('flex');
    expect(css.flexDirection).toBe('row');
    expect(css.gap).toBe('20px');        // 2% of 1000
    expect(css.padding).toBe('10px');
    expect(css.justifyContent).toBe('space-between');
    expect(css.alignItems).toBe('center');
    expect(css.flexWrap).toBe('wrap');
  });
  it('column → flex column', () => {
    expect(flowLayoutCss({ mode: 'column' }, 1000).flexDirection).toBe('column');
  });
  it('grid with fixed columns', () => {
    const css = flowLayoutCss({ mode: 'grid', columns: 3, gap: 1 }, 1000);
    expect(css.display).toBe('grid');
    expect(css.gridTemplateColumns).toBe('repeat(3, max-content)');
    expect(css.gap).toBe('10px');
  });
  it('grid autoFit → auto-fill minmax', () => {
    const css = flowLayoutCss({ mode: 'grid', autoFit: 8 }, 1000);
    expect(css.gridTemplateColumns).toBe('repeat(auto-fill, minmax(80px, 1fr))');
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`flowLayoutCss` not exported).
- [ ] **Step 3: Implement** in `layoutGeometry.ts` (reuse existing `pctToPx`, `gridTemplate`):

```ts
export interface FlowCss {
  display?: 'flex' | 'grid';
  flexDirection?: 'row' | 'column';
  flexWrap?: 'wrap';
  gap?: string;
  padding?: string;
  justifyContent?: string;
  alignItems?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridAutoFlow?: 'column';
}

const JUSTIFY: Record<NonNullable<FlowLayout['justify']>, string> = {
  start: 'flex-start', center: 'center', end: 'flex-end',
  between: 'space-between', around: 'space-around',
};
const ALIGN: Record<NonNullable<FlowLayout['align']>, string> = {
  start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch',
};

export function flowLayoutCss(layout: FlowLayout | undefined, screenW: number): FlowCss {
  if (!layout) return {};
  const css: FlowCss = {};
  const gapPx = pctToPx(screenW, layout.gap);
  const padPx = pctToPx(screenW, layout.padding);
  if (gapPx !== undefined) css.gap = `${gapPx}px`;
  if (padPx !== undefined) css.padding = `${padPx}px`;
  if (layout.justify) css.justifyContent = JUSTIFY[layout.justify];
  if (layout.align) css.alignItems = ALIGN[layout.align];
  if (layout.mode === 'grid') {
    css.display = 'grid';
    if (layout.autoFit != null && layout.autoFit > 0) {
      const min = Math.round((screenW * layout.autoFit) / 100);
      css.gridTemplateColumns = `repeat(auto-fill, minmax(${min}px, 1fr))`;
    } else {
      const c = gridTemplate(layout.columns);
      const r = gridTemplate(layout.rows);
      if (c) css.gridTemplateColumns = c;
      if (r) css.gridTemplateRows = r;
      if (!c && r) css.gridAutoFlow = 'column';
    }
  } else {
    css.display = 'flex';
    css.flexDirection = layout.mode;
    if (layout.wrap) css.flexWrap = 'wrap';
  }
  return css;
}
```

Add `FlowLayout` to the type import at the top of `layoutGeometry.ts`.

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(geometry): flowLayoutCss — FlowLayout → flex/grid CSS"`

---

### Task 3: `flowItemCss` + `slotRect`

**Files:** Modify `src/runner/layoutGeometry.ts`; Test `src/runner/layoutGeometry.test.ts`

- [ ] **Step 1: Write the failing test**:

```ts
import { flowItemCss, slotRect } from './layoutGeometry';
import type { ScreenElement } from '../shared/types';

describe('flowItemCss', () => {
  it('uniform → equal basis (flex:1)', () => {
    expect(flowItemCss({ mode: 'row', itemSize: 'uniform' })).toMatchObject({ flex: '1 1 0' });
  });
  it('stretch → align-self stretch', () => {
    expect(flowItemCss({ mode: 'row', itemSize: 'stretch' })).toMatchObject({ alignSelf: 'stretch' });
  });
  it('auto → no forced sizing', () => {
    expect(flowItemCss({ mode: 'row' })).toEqual({});
  });
});

describe('slotRect', () => {
  const el = {
    kind: 'panelSwitcher', id: 'p', name: 'P', rect: { x: 10, y: 10, w: 40, h: 40 },
    selectorGroup: 'g',
    slots: [{ id: 'tabs', name: 'Tabs', layout: { mode: 'row' }, rect: { x: 0, y: 0, w: 100, h: 12 } }],
    children: [],
  } as ScreenElement;
  it('returns the slot region as % of the container', () => {
    expect(slotRect(el, 'tabs')).toEqual({ x: 0, y: 0, w: 100, h: 12 });
  });
  it('missing slot → full container box', () => {
    expect(slotRect(el, 'nope')).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** in `layoutGeometry.ts`:

```ts
export function flowItemCss(layout: FlowLayout): { flex?: string; alignSelf?: string } {
  if (layout.itemSize === 'uniform') return { flex: '1 1 0' };
  if (layout.itemSize === 'stretch') return { alignSelf: 'stretch' };
  return {};
}

/** A slot's region as % of its container (slot.rect, or the full box). */
export function slotRect(el: ScreenElement, slotId: string): PlainRect {
  const slot = (el.slots ?? []).find((s) => s.id === slotId);
  return slot?.rect ?? { x: 0, y: 0, w: 100, h: 100 };
}
```

Ensure `ScreenElement` is imported in `layoutGeometry.ts` (it already is).

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(geometry): flowItemCss + slotRect"`

---

## Phase 2 — Runner render

### Task 4: Render a container with `layout` (flow, drop absolute child styling)

**Files:**
- Modify: `src/runner/ScreenRenderer.tsx` (the element wrapper — where each element's inline `left/top/width/height` % is applied, and where `el.children` recurse), `src/runner/runner.css` (add `.rn-el-flow`)
- Test: `src/runner/screenLayout.test.ts`

**READ FIRST:** open `ScreenRenderer.tsx`; find the component that wraps each element (applies the abs rect inline) and the child-recursion. Determine the measured stage width source (the renderer already converts % → px for zones; reuse it as `screenW`).

- [ ] **Step 1: Write the failing test** (render helper — mirror an existing test in `screenLayout.test.ts`; a container with `layout` must set `display:flex` on its box and its children must NOT carry absolute `left/top`). Follow the file's existing render-and-query pattern; assert:
  - a group with `layout:{mode:'row',gap:2}` renders with `display:flex` on its element box;
  - its child element box has no inline `left`/`top`.
  - a group WITHOUT `layout` still renders children with absolute `left`/`top` (back-compat).

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** In the element wrapper: compute `const hasFlow = 'layout' in el && el.layout != null && el.kind !== 'zone';` When `hasFlow`, merge `flowLayoutCss(el.layout, screenW)` into the box style, add class `rn-el-flow`, and render children **without** the per-child absolute `left/top/width/height` (children get `flowItemCss(el.layout)` + their `rect.w/h` as basis when `itemSize==='auto'`). When `!hasFlow`, keep today's absolute path untouched. In `runner.css`:

```css
.rn-el-flow { position: relative; }
```

Keep `.rn-el` transitions; flow layout changes are not animated.

- [ ] **Step 4: Run — expect PASS**; also run `npm run test -- src/runner/screenLayout.test.ts src/runner/layoutGeometry.test.ts`.
- [ ] **Step 5: Commit** — `git commit -am "feat(runner): flow-layout containers render via flex/grid"`

---

### Task 5: Render typed slots (route children by `slotId`)

**Files:** Modify `src/runner/ScreenRenderer.tsx`; Test `src/runner/screenLayout.test.ts`

- [ ] **Step 1: Write the failing test** — a container with `slots:[{id:'a',...},{id:'b',...}]` and children carrying `slotId:'a'|'b'` renders each child inside the matching slot region (assert two `.rn-slot` regions exist and children nest correctly). A child with no `slotId` falls back to overlay.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** When `el.slots?.length`, render one `<div className="rn-slot">` per slot, positioned via `slotRect(el, slot.id)` (abs % inside the container) with `flowLayoutCss(slot.layout, screenW)`; inside each, render `el.children.filter(c => c.slotId === slot.id)`. Children with no matching slot render in the container overlay (existing path). Guard: slots + `layout` coexist (layout lays out the slots' own box only when slots absent).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(runner): typed slots route children by slotId"`

---

### Task 6: Render `panelSwitcher`

**Files:** Modify `src/runner/ScreenRenderer.tsx`; Test `src/runner/screenLayout.test.ts`

- [ ] **Step 1: Write the failing test** — build a `panelSwitcher` whose `tabs` slot holds two `role:'selector'` buttons (sharing its `selectorGroup`) and whose `content` slot holds two groups with `showForSelector` bound to each button. Render; assert exactly one content panel is visible for the default selection, and switching selection (via the existing selection store `writeSelection`) flips it. Reuse the selector-store test helpers already in `screenLayout.test.ts`.
- [ ] **Step 2: Run — expect FAIL** (panelSwitcher kind not handled → falls through / errors).
- [ ] **Step 3: Implement.** Add a `panelSwitcher` branch in the element-body switch that renders exactly like a slotted flow container (Task 5 path): tabs slot flows the buttons, content slot renders the panels. **Do not** add gating logic — the buttons are real selectors and the panels use real `showForSelector`, so the existing `selectorGateOpen` path (already applied to every child) shows one panel. The branch exists only so the kind renders (and to apply the container box/rect + optional `layout`).
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(runner): render panelSwitcher over existing selector gate"`

---

### Task 7: Render `image`

**Files:** Modify `src/runner/ScreenRenderer.tsx`; Test `src/runner/screenLayout.test.ts`

- [ ] **Step 1: Write the failing test** — an `image` element with a data-URL `src` renders an `<img>` with that `src` and `object-fit` from `fit` (default `contain`); empty `src` renders a placeholder box (no `<img>` / no console error).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Add an `image` branch in the element-body switch:

```tsx
case 'image':
  return el.src
    ? <img src={el.src} alt={el.alt ?? el.name}
        style={{ width: '100%', height: '100%', objectFit: el.fit ?? 'contain', display: 'block' }} />
    : <div className="rn-img-empty" aria-label={el.alt ?? el.name} />;
```

Add a subtle `.rn-img-empty` placeholder style to `runner.css`.

- [ ] **Step 4: Run — expect PASS**; run the whole runner suite `npm run test -- src/runner`.
- [ ] **Step 5: Commit** — `git commit -am "feat(runner): image element kind"`

---

## Phase 3 — Editor model + palette + presets

### Task 8: screenModel factories & helpers

**Files:** Modify `src/editor/tabs/table/screenModel.ts`; Test `src/editor/tabs/table/screenModel.test.ts`

- [ ] **Step 1: Write the failing test**:

```ts
import { newImageElement, newFlowGroup, containerCanFlow, slotChildrenOf } from './screenModel';

it('newFlowGroup seeds a group with the right mode', () => {
  const g = newFlowGroup('grid', 'Grid');
  expect(g.kind).toBe('group');
  expect(g.layout?.mode).toBe('grid');
  expect(g.children).toEqual([]);
});
it('newImageElement is an empty image', () => {
  expect(newImageElement().kind).toBe('image');
});
it('containerCanFlow: groups/panelSwitcher/button yes, zone no', () => {
  expect(containerCanFlow({ kind: 'group' } as any)).toBe(true);
  expect(containerCanFlow({ kind: 'zone' } as any)).toBe(false);
});
it('slotChildrenOf filters by slotId', () => {
  const el = { children: [{ id: 'a', slotId: 'x' }, { id: 'b', slotId: 'y' }] } as any;
  expect(slotChildrenOf(el, 'x').map((c: any) => c.id)).toEqual(['a']);
});
```

- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** in `screenModel.ts`:

```ts
export function containerCanFlow(el: ScreenElement): boolean {
  return el.kind === 'group' || el.kind === 'panelSwitcher' || el.kind === 'button';
}
export function slotChildrenOf(el: ScreenElement, slotId: string): ScreenElement[] {
  return (el.children ?? []).filter((c) => c.slotId === slotId);
}
export function isFlowChild(index: Map<Id, ElInfo>, id: Id): boolean {
  const pid = index.get(id)?.parentId ?? null;
  return pid !== null && index.get(pid)?.el.layout != null;
}
const FLOW_DEFAULTS = { row: { gap: 2, padding: 1 }, column: { gap: 2, padding: 1 }, grid: { gap: 2, padding: 1, columns: 3 } } as const;
export function newFlowGroup(mode: 'row' | 'column' | 'grid', name: string): ScreenElement {
  return { kind: 'group', id: uid('el'), name, rect: { x: 30, y: 30, w: 40, h: 30 },
    layout: { mode, ...FLOW_DEFAULTS[mode] }, children: [] };
}
export function newImageElement(): ScreenElement {
  return { kind: 'image', id: uid('el'), name: 'Image', rect: { x: 40, y: 40, w: 20, h: 20 }, src: '', fit: 'contain' };
}
```

- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(editor): flow/image factories + container helpers"`

---

### Task 9: Drop `accepts` filter + preserve layout on group/ungroup

**Files:** Modify `src/editor/tabs/table/screenModel.ts` (`reparentEl`, `deepestGroupAt`); Test `screenModel.test.ts`

- [ ] **Step 1: Write the failing test** — dropping a `zone` into a slot with `accepts:['button']` is refused (`reparentEl` returns the tree unchanged / a new `canDropInto(target, kind, slotId)` returns false); dropping a `button` succeeds. `ungroupEl`/`groupSiblings` keep `layout` on the surviving elements.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** a pure `canDropInto(target: ScreenElement, kind: ScreenElement['kind'], slotId?: Id): boolean` (true when no slots, else the matched slot's `accepts` allows `kind`); call it inside `reparentEl` before appending (return `elements` unchanged when false) and inside `deepestGroupAt`/drop resolution to skip rejecting targets. Verify `groupSiblings` copies members verbatim (it already spreads `...m`, so `layout` survives) — add an assertion.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(editor): slot accepts filter on drop"`

---

### Task 10: Presets — upgrade panelSwitcher, add Grid/Row/Column

**Files:** Modify `src/editor/tabs/table/presets.ts`; Test `src/editor/tabs/table/presets.test.ts`

- [ ] **Step 1: Write the failing test** — `panelSwitcherPreset.build({count:3,names:['A','B','C']})` returns a single `kind:'panelSwitcher'` element with `slots` `tabs`+`content`, a `selectorGroup`, three `role:'selector'` buttons (slotId `tabs`, sharing the group) and three content panels (slotId `content`, each `showForSelector` a tab id); passes `validateGameDef` with zero errors. `gridPreset`/`rowPreset`/`columnPreset` each build a `group` with the right `layout` and pass validate.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement.** Rewrite `panelSwitcherPreset.build` to emit the new kind:

```ts
build: ({ count, names }) => {
  const n = Math.max(PANEL_SWITCHER_MIN, Math.min(PANEL_SWITCHER_MAX, Math.round(count)));
  const selectorGroup = uid('switch');
  const tabIds = Array.from({ length: n }, () => uid('el'));
  const tabs: ScreenElement[] = tabIds.map((id, i) => ({
    kind: 'button', id, name: panelName(names, i), rect: { x: 0, y: 0, w: 100 / n, h: 100 },
    actionId: null, label: panelName(names, i), fontSize: 1.6,
    role: 'selector', selectorGroup, slotId: 'tabs',
  }));
  const panels: ScreenElement[] = tabIds.map((tabId, i) => ({
    kind: 'group', id: uid('el'), name: panelName(names, i), rect: { ...PANEL_RECT },
    showForSelector: tabId, slotId: 'content', children: [],
  }));
  return [{
    kind: 'panelSwitcher', id: uid('el'), name: 'Panel switcher',
    rect: { x: 20, y: 20, w: 60, h: 60 }, selectorGroup,
    slots: [
      { id: 'tabs', name: 'Tabs', accepts: ['button'], rect: { ...SELBAR_RECT }, layout: { mode: 'row', itemSize: 'uniform' } },
      { id: 'content', name: 'Content', single: true, rect: { ...PANEL_RECT }, layout: { mode: 'column' } },
    ],
    children: [...tabs, ...panels],
  }];
},
```

Add three presets and extend the registry:

```ts
export const gridPreset: ScreenPreset<{ columns: number }> = {
  id: 'grid', name: '▦ Grid', hint: 'Auto-spacing grid (set columns)',
  params: { columns: 3 },
  build: ({ columns }) => [{ kind: 'group', id: uid('el'), name: 'Grid',
    rect: { x: 20, y: 20, w: 60, h: 40 }, layout: { mode: 'grid', columns, gap: 2, padding: 1 }, children: [] }],
};
export const rowPreset: ScreenPreset<{ gap: number }> = {
  id: 'row', name: '▭ Row', hint: 'Horizontal auto-spacing row',
  params: { gap: 2 },
  build: ({ gap }) => [{ kind: 'group', id: uid('el'), name: 'Row',
    rect: { x: 20, y: 40, w: 60, h: 14 }, layout: { mode: 'row', gap, padding: 1 }, children: [] }],
};
export const columnPreset: ScreenPreset<{ gap: number }> = {
  id: 'column', name: '▯ Column', hint: 'Vertical auto-spacing column',
  params: { gap: 2 },
  build: ({ gap }) => [{ kind: 'group', id: uid('el'), name: 'Column',
    rect: { x: 40, y: 20, w: 20, h: 50 }, layout: { mode: 'column', gap, padding: 1 }, children: [] }],
};
export const SCREEN_PRESETS = [panelSwitcherPreset, gridPreset, rowPreset, columnPreset] as const;
```

- [ ] **Step 4: Run — expect PASS**; run `npm run test -- src/editor/tabs/table/presets.test.ts`.
- [ ] **Step 5: Commit** — `git commit -am "feat(editor): panelSwitcher preset → kind; Grid/Row/Column presets"`

---

### Task 11: Palette entries + Image insert

**Files:** Modify `src/editor/tabs/table/Palette.tsx`; Test: manual/live (Palette is React UI). Add a light render test if the file has one.

**READ FIRST:** open `Palette.tsx`; find the "+ Add" item helper and the Presets section loop.

- [ ] **Step 1:** Add "+ Add" buttons **Grid** (`onInsert(newFlowGroup('grid','Grid'))`), **Row** (`newFlowGroup('row','Row')`), **Column** (`newFlowGroup('column','Column')`), **Image** (`newImageElement()`). Grid/Row/Column also appear via presets (with param dialogs) — keep both; the "+ Add" gives a one-click default.
- [ ] **Step 2:** Image insert with an asset picker: a file `<input type="file" accept="image/*">` whose `onChange` runs `FileReader.readAsDataURL` and inserts `{ ...newImageElement(), src: dataUrl }`, plus a "paste URL" text field. Mirror the existing zone-insert modal pattern in this file.
- [ ] **Step 3:** Wire preset param dialogs for grid/row/column if the file routes presets through a modal (follow the panelSwitcher modal path).
- [ ] **Step 4: Verify** — `npm run build` (typecheck) passes; live-verify insertion in Task 13's preview pass.
- [ ] **Step 5: Commit** — `git commit -am "feat(editor): Grid/Row/Column/Image palette entries + image upload"`

---

## Phase 4 — Properties + canvas

### Task 12: PropertiesPanel — Layout, Image, Panel sections

**Files:** Modify `src/editor/tabs/table/PropertiesPanel.tsx`; Test: build/typecheck + live.

**READ FIRST:** open `PropertiesPanel.tsx`; find the per-kind section dispatch and copy the `ShapeSection` pattern (a `patch` helper + `<section className="tt-prop-section">`).

- [ ] **Step 1:** Add `LayoutSection` shown when `containerCanFlow(el)`: a mode segmented control (row/column/grid); steppers gap/padding; grid-only steppers columns/rows/autoFit; a wrap checkbox; justify/align/itemSize selects. Patch via `onPatchEl(el.id, c => ({ ...c, layout: { ...(c.layout ?? { mode: 'row' }), ...p } }))`. A "None" mode removes `layout` (back to absolute).
- [ ] **Step 2:** Add `ImageSection` for `el.kind==='image'`: file-upload → data URL, paste-URL field, `fit` select (contain/cover/fill/none), alt text.
- [ ] **Step 3:** Add `PanelSwitcherSection` for `el.kind==='panelSwitcher'`: list tabs; "+ Tab" adds a selector button (slotId `tabs`, shared `selectorGroup`) + a bound content panel (slotId `content`, `showForSelector`); "−" removes the pair; rename edits the button label + panel name.
- [ ] **Step 4: Verify** — `npm run build` passes; live-verify in Task 13.
- [ ] **Step 5: Commit** — `git commit -am "feat(editor): Layout/Image/PanelSwitcher property sections"`

---

### Task 13: ScreenCanvas — flow render, reorder drag, slot chrome, handles, image

**Files:** Modify `src/editor/tabs/table/ScreenCanvas.tsx`; Verify: preview (live).

**READ FIRST:** open `ScreenCanvas.tsx`; locate `renderElement`, the element-body dispatch, `startDrag`/`moveDragAt`/`endDrag`, `deepestGroupAt`/`resolveDropParent`, and the handle-rendering block.

- [ ] **Step 1: Flow render parity.** In `renderElement`, when an element has `layout` (and isn't a zone), style its box with `flowLayoutCss(el.layout, stageW)` + `rn-el-flow`, and render children without absolute `left/top` (mirror runner Task 4). When it has `slots`, render slot regions like the runner (Task 5). Image kind renders `<img>` like the runner (Task 7). This keeps the canvas WYSIWYG-identical.
- [ ] **Step 2: Reorder drag.** In `startDrag`, if the element `isFlowChild`, set a `flowMode:'reorder'` flag. In `moveDragAt` under `flowMode`, ignore free XY; compute the target sibling index from pointer position along the flow axis and show a drop-indicator line between siblings. In `endDrag`, call `placeRelativeEl(elements, dragId, targetSiblingId)` instead of a rect move.
- [ ] **Step 3: Drop `accepts`.** In the drop-target resolution, skip flow/slot containers where `canDropInto(target, dragKind, slotId)` is false (show a no-drop cue). On accept into a slotted container, set the child's `slotId` to the hovered slot.
- [ ] **Step 4: Suppress handles / snap for flowed children.** Where move/resize/rotate handles render, skip the move+rotate handles when `isFlowChild` (keep resize → basis `rect.w/h`); exclude flowed siblings from snap-alignment targets.
- [ ] **Step 5: Slot chrome (editor-only).** When a selected element has `slots`, draw subtle dashed boundaries + slot-name labels for each `slotRect` — editor chrome only, never emitted to the runner.
- [ ] **Step 6: Verify (live).** Start the dev server (preview_start "dominion"/the pinned config), open the designer, insert a Row and drop 3 buttons → they auto-space; drag to reorder → order changes; insert an Image with a data URL → renders; confirm canvas matches runner. Screenshot for the user.
- [ ] **Step 7: Commit** — `git commit -am "feat(canvas): flow render, reorder-drag, slot chrome, image"`

---

## Phase 5 — Dominion proof

### Task 14: Desktop supply band → flow Row

**Files:** Modify `src/forge/dominionGame.ts` (supply patch, ~1414-1431) and/or `src/examples/dominion.ts` (supply els ~333-356); Test `src/forge/dominionGame.test.ts` / `src/examples/dominionScreenLayout.test.ts`.

**READ FIRST:** confirm the three supply-slice zone elements and their ids; check whether they're built in the example or patched in `buildDominionDef`.

- [ ] **Step 1: Write the failing test** — after `buildDominionDef()`, the three supply slices (Treasury/Victory/Kingdom) are children of a `group` with `layout.mode==='row'`; all three keep their ids, `cardFilter`, `keyGroup`, `pileFace`. Desktop shows all three (none gated by a selector).
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — wrap the three desktop supply-slice zones in a `group` with `layout:{mode:'row', gap:2, align:'stretch'}` (children `slotId` unset — plain flow, no slots). Preserve every zone property and id; only the parent/positioning representation changes.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(dominion): desktop supply band as flow Row"`

---

### Task 15: Mobile supply → panelSwitcher

**Files:** Modify `src/forge/dominionGame.ts` (mobile supply build); Test `src/forge/dominionGame.test.ts` (mobile supply tests).

- [ ] **Step 1: Write the failing test** — the mobile supply is a `kind:'panelSwitcher'` with `tabs`(3 selector buttons Treasury/Victory/Kingdom) + `content`(3 panels), sharing one `selectorGroup`; each panel holds the matching supply-slice zone; the existing selector-gate behavior (one panel visible) holds.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** — replace the hand-built mobile selector-bar + panels with the new `panelSwitcher` kind (reuse `panelSwitcherPreset.build` shape or construct directly). Preserve the zone slices' ids/properties.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(dominion): mobile supply as panelSwitcher"`

---

### Task 16: Bump SEED_VERSION + reconcile pinned tests

**Files:** Modify `src/forge/seedDominion.ts:26` (8→9); update any pinned screen-structure tests in `dominionGame.test.ts` / `dominionScreenLayout.test.ts`.

- [ ] **Step 1:** Change `SEED_VERSION = 8` → `9`.
- [ ] **Step 2:** Run the full Dominion + examples suites: `npm run test -- src/forge src/examples`. Fix any structure assertions that pinned the old supply rects/parents to the new tree (ids preserved → most gameplay tests unaffected).
- [ ] **Step 3:** Run the FULL suite `npm run test` — expect all green (was 703+; now includes new tests).
- [ ] **Step 4: Commit** — `git commit -am "chore(dominion): SEED_VERSION 9; reconcile pinned layout tests"`

---

## Phase 6 — Validation + polish

### Task 17: Validation rules

**Files:** Modify `src/shared/validate.ts`; Test `src/shared/validate.test.ts`.

**READ FIRST:** find the screen-element validation walk in `validate.ts`.

- [ ] **Step 1: Write the failing test** — validate flags: `layout` on a `zone` (warning); a child `slotId` with no matching parent slot (warning); a `panelSwitcher` missing `tabs`/`content` (error); an `image` with empty `src` (warning). Valid new elements produce zero errors.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the rules in the element walk, following the file's existing error/warning helpers.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** — `git commit -am "feat(validate): layout/slot/panelSwitcher/image rules"`

---

### Task 18: Parity test + full verification

**Files:** Test `src/runner/layoutGeometry.test.ts` (or a new `parity` test); no src change expected.

- [ ] **Step 1:** Add a parity assertion: for a set of `FlowLayout`s, the CSS the canvas would emit equals `flowLayoutCss(...)` (both call the same function — assert they import the one function; a guard test that documents the invariant).
- [ ] **Step 2:** `npm run build` — typecheck/bundle clean.
- [ ] **Step 3:** `npm run test` — entire suite green.
- [ ] **Step 4: Live verify** — dev server: designer round-trip (insert Grid/Row/Column/Image/Panel switcher, drag-reorder, drop into slots), then play Dominion (desktop supply shows all 3 slices as a row; mobile supply tabs switch). Screenshot both for the user.
- [ ] **Step 5: Commit** — `git commit -am "test: flow CSS parity; full suite green"`

---

## Self-review checklist (run before execution)
- **Spec coverage:** FlowLayout (T1-2), grid (T2), slots (T3,5), panelSwitcher (T1,6,10,15), image (T1,7,11), Grid/Row/Column palette (T8,10,11), properties (T12), canvas drag/slots (T13), Dominion proof (T14-16), validation (T17), parity (T18). ✔
- **Backward-compat:** every render task keeps the no-`layout` path untouched; no migrate auto-conversion. ✔
- **Type consistency:** `flowLayoutCss(layout, screenW)`, `flowItemCss(layout)`, `slotRect(el, slotId)`, `containerCanFlow`, `slotChildrenOf`, `canDropInto`, `newFlowGroup`, `newImageElement` — names used consistently across tasks. ✔
