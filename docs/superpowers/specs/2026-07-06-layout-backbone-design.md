# Layout backbone — auto-layout, typed slots, Grid & Image

**Date:** 2026-07-06
**Status:** Approved design, ready to plan
**Part of:** the multi-wave `gui-editor-upgrade` effort (make the table designer Photoshop-like). Backlog items **#8** (smart containers with snap slots) and **#10** (robust grid element).

## 1. Goal

Give `GameDef.screenLayout` a real layout engine. Today every `ScreenElement` is a hand-placed absolute `rect` (% of parent) and nothing reflows; the only auto-layout in the codebase lays out *cards inside a single zone*. This wave adds:

1. **`FlowLayout`** — an optional field on any container element. When set, the container *flows* its children (row / column / grid, with gap, padding, justify, align, wrap) instead of positioning each child by absolute rect.
2. **Grid / Row / Column** palette items — containers pre-seeded with a `FlowLayout`.
3. **Typed slots** (`SlotDef` + child `slotId` + `accepts`) — a container advertises named, type-constrained sub-regions, each with its own flow layout; children snap into a slot.
4. **`panelSwitcher`** — a first-class smart container (tabs slot + content slot) that auto-manages the existing selector wiring, so authoring is "drop tabs, drop content" instead of hand-wiring selector buttons.
5. **`image`** — a new element kind (inline data-URL or pasted URL, `object-fit`).
6. **Dominion migration as proof** — rebuild the flagship's supply band on the new containers (desktop → flow Row of the three slices; mobile → `panelSwitcher`), bump `SEED_VERSION`.

Everything renders **identically in the runner and the WYSIWYG editor canvas** because all layout CSS is emitted from the single shared coordination point, `src/runner/layoutGeometry.ts`.

## 2. Non-goals & the backward-compatibility invariant

- **Not** author-defined arbitrary slots in v1 — slots ship via the two preset templates (`panelSwitcher`, button content-slot) plus a generic underlying model. Free-form slot authoring is a later wave.
- **Not** an asset store — images are inline data URLs / URLs (no backend).
- **Not** a rewrite of the fan/pile/zone card-layout engine — those stay zone-internal.
- **INVARIANT — absolute positioning is the default.** An element with **no** `layout` and **no** `slots` behaves exactly as today (absolute `rect`). No existing stored def changes behavior. `migrateGameDef` performs **no** auto-conversion of old groups to flow (explicitly forbidden — no surprise reflow). The new fields are optional additions / new union members, so old JSON parses unchanged (same class as the v1→v2 additions; **no `SCHEMA_VERSION` transform required**).

## 3. Data model (`src/shared/types.ts`)

### 3.1 `FlowLayout`

New interface (placed near `LayoutStyle`, exported):

```ts
export interface FlowLayout {
  mode: 'row' | 'column' | 'grid';
  /** Between-item spacing, % of screen width. */
  gap?: number;
  /** Inset from the container edge, % of screen width. */
  padding?: number;
  /** Main-axis distribution. */
  justify?: 'start' | 'center' | 'end' | 'between' | 'around';
  /** Cross-axis alignment. */
  align?: 'start' | 'center' | 'end' | 'stretch';
  /** row/column: wrap onto new lines. */
  wrap?: boolean;
  /** grid: fixed track counts (absent = auto). */
  columns?: number | null;
  rows?: number | null;
  /** grid: minimum item width (% screen) → auto-fill/wrap grid. */
  autoFit?: number | null;
  /** How children are sized on the cross axis / within cells. */
  itemSize?: 'auto' | 'uniform' | 'stretch';
}
```

Added to `ScreenElementBase` as `layout?: FlowLayout` (alongside the other optional fields like `rotation`, `states`). Field name is **`layout`** (matches the approved design; `el.style` remains the `LayoutStyle` visual style — distinct axis).

**Child interpretation when a container has `layout`:** each child's `rect.x`/`rect.y` are **ignored** (the flow computes position); `rect.w`/`rect.h` are the child's *basis size* under `itemSize:'auto'`, equalized under `'uniform'`, or stretched to fill the cross axis under `'stretch'`. Rects are **kept in the JSON** (not zeroed) so toggling flow off restores a sensible absolute layout and existing editor read/write paths keep working.

### 3.2 `SlotDef` + `slotId`

```ts
export interface SlotDef {
  id: Id;                       // stable within the container
  name: string;                 // "Tabs", "Content"
  accepts?: ScreenElement['kind'][];  // type filter; absent = any kind
  layout: FlowLayout;           // how this slot flows its own children
  rect?: { x: number; y: number; w: number; h: number };  // slot region, % of container
  single?: boolean;             // holds at most one visible child (content areas)
}
```

Added to `ScreenElementBase`: `slots?: SlotDef[]`. Each child gains `slotId?: Id` (added to `ScreenElementBase`) binding it to a slot on its parent. A child whose `slotId` matches no parent slot is **orphaned** (validation warning; the editor prevents this on slot delete). A container with `slots` routes children by `slotId`; children without `slotId` in a slotted container render in the container's own `layout`/absolute space (back-compat fallback).

### 3.3 New kinds

```ts
// panelSwitcher: a slotted smart container. Its tab children are REAL
// role:'selector' buttons; its content children use REAL showForSelector.
// Runtime = generic slot+flow rendering + the existing global selector gate.
| (ScreenElementBase & {
    kind: 'panelSwitcher';
    slots: SlotDef[];   // exactly two: 'tabs' and 'content'
    /** The shared selectorGroup name its tab buttons belong to. */
    selectorGroup: string;
  })

// image: inline picture.
| (ScreenElementBase & {
    kind: 'image';
    src: string;                 // data URL or remote URL
    fit?: 'contain' | 'cover' | 'fill' | 'none';
    alt?: string;
  })
```

**Button content-slot:** the existing `button` kind gains an implicit `content` slot (accepts `text` / `image` / `shape`, centered) — modeled by allowing a button to carry `slots`/child `slotId` like any container; no new required field. A button with a `content` child renders that child centered inside its silhouette.

## 4. CSS emission — the single coordination point (`layoutGeometry.ts`)

All flow CSS originates here so runner and canvas never drift (the file's stated contract).

```ts
export interface FlowCss {
  display?: 'flex' | 'grid';
  flexDirection?: 'row' | 'column';
  flexWrap?: 'wrap';
  gap?: string;                 // px (from pctToPx(screenW, gap))
  padding?: string;             // px
  justifyContent?: string;
  alignItems?: string;
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridAutoFlow?: 'column';
}

/** FlowLayout → CSS. screenW converts % gap/padding to px. Absent = {}. */
export function flowLayoutCss(layout: FlowLayout | undefined, screenW: number): FlowCss
```

- `row`/`column` → `display:flex`, `flexDirection`, `flexWrap`, gap/padding, justify→`justify-content` (`between`→`space-between`, `around`→`space-around`), align→`align-items`.
- `grid` → `display:grid`. Reuse the existing `gridSpec(rows, columns)` for fixed tracks; when `autoFit` is set, emit `gridTemplateColumns: repeat(auto-fill, minmax(<autoFit%→px>, 1fr))`.
- Child sizing (`itemSize`) is emitted per-child (a small `flowItemCss(layout, child)` helper): `uniform` → equal flex-basis; `stretch` → `align-self:stretch`; `auto` → basis from `rect.w`/`rect.h`.

`slotRect(container, slotId, screenW)` computes a slot's absolute region from `slot.rect` (or the container box when absent) — used by the editor to hit-test drops and draw slot chrome.

## 5. Runner rendering (`ScreenRenderer.tsx`)

- **Container with `layout`:** the element wrapper (the `Reveal`/`.rn-el` box) emits `flowLayoutCss(el.layout, screenW)` and **omits the per-child absolute `left/top/width/height`** styling for its children; children render in document order (array order = flow order). A `.rn-el-flow` class flips the wrapper to `position:relative`. State/opacity transitions stay on `.rn-el`; layout changes are instant.
- **Container with `slots`:** children are grouped by `slotId` into one flow region per slot (`slotRect` positions the region; `flowLayoutCss(slot.layout)` flows the slot's children). Children with no `slotId` fall back to overlay (back-compat).
- **`panelSwitcher`:** renders as a slotted flow container — `tabs` slot flows its selector buttons, `content` slot renders its panels. **No bespoke gating**: the tab buttons are real `role:'selector'` buttons and the panels carry real `showForSelector`, so the *existing* `selectorGateOpen` / selector store path already shows exactly one panel. The kind exists for editor identity + auto-wiring, not new runtime logic.
- **`image`:** `<img src={el.src} alt={el.alt ?? el.name} style={{width:'100%',height:'100%',objectFit: el.fit ?? 'contain'}}/>`; a placeholder box when `src` is empty. `.rn-el` sizing (rect) unchanged.
- **Zones ignore `layout`.** A zone lays out *cards* via its own zone layout; it has no child elements to flow. `containerCanFlow(el)` is true only for `group` / `panelSwitcher` / `button` (content-slot). Validation warns if `layout` is set on a `zone`.

## 6. Editor

### 6.1 `screenModel.ts`
- Factories: `newImageElement()`, `newFlowGroup(mode, name)` (Grid/Row/Column presets), `newPanelSwitcher(names)` (delegates to the upgraded preset), plus `containerCanFlow(el)` and `slotChildrenOf(el, slotId)` helpers.
- `isFlowChild(index, id)` — true when the element's parent has `layout` (used to switch drag behavior and suppress handles).
- Reparent/drop: `reparentEl` and `deepestGroupAt` gain an `accepts` check — a drop into a slotted/flow container is refused when the target slot's `accepts` excludes the dragged kind.
- Reorder-in-flow reuses the existing `placeRelativeEl` (sibling reorder = flow order). `groupSiblings`/`ungroupEl` preserve `layout`/`slots`/`slotId`.

### 6.2 `presets.ts`
- **Upgrade `panelSwitcherPreset`** to build a `kind:'panelSwitcher'` element: a `tabs` slot (row `FlowLayout`, `accepts:['button']`) holding the selector buttons, and a `content` slot (`single`, accepts any) holding the panels. The buttons keep `role:'selector'` + a fresh `selectorGroup`; panels keep `showForSelector`. This replaces the hand-computed `x: i*(100/n)` button spacing with flow auto-spacing.
- **Add** `gridPreset`, `rowPreset`, `columnPreset` (params: columns/gap) to `SCREEN_PRESETS`, each building a `group` with the matching `layout`.

### 6.3 `Palette.tsx`
- New "+ Add" items: **Grid**, **Row**, **Column**, **Image** (call the factories). Panel switcher stays in the Presets section (now building the new kind).
- Image insert: a small file-input → `FileReader.readAsDataURL` capture (or paste-URL field), mirroring the existing zone-insert modal pattern.

### 6.4 `PropertiesPanel.tsx`
- **Layout section** (shown when `containerCanFlow(el)`): mode segmented control; steppers for gap/padding/columns/rows/autoFit; checks for wrap; selects for justify/align/itemSize. Patches `el.layout`.
- **Image section** (`el.kind==='image'`): src upload/URL field, fit select, alt text.
- **Panel-switcher section**: manage tabs (add/remove/rename a panel = add/remove a selector button + its bound content panel). Slots themselves are preset, not free-authored, in v1.

### 6.5 `ScreenCanvas.tsx` (WYSIWYG)
- Render flow containers/slots via the **same** `flowLayoutCss`/`slotRect` (parity with runner).
- **Drag inside a flow container = reorder** (drop indicator between siblings; pointer position → sibling index by flow direction), not free XY move. On drop, `placeRelativeEl`. Drag **out** leaves the container.
- **Drop into a flow container/slot** appends at the drop position; the slot `accepts` filter shows a no-drop cue and refuses incompatible kinds.
- **Suppress move handles** (and snap-alignment targets) for flowed children — position is layout-driven; resize handles still set basis `rect.w/h`.
- **Slot boundaries** render as subtle **editor-only** chrome (hidden in the real game — respects the WYSIWYG rule, backlog #11). Image kind renders on-canvas identically to the runner.

## 7. Dominion migration — the proof (`dominionGame.ts`, `examples/dominion.ts`, `seedDominion.ts`)

Migration lives in the **seed builder** (`buildDominionDef` / the example screen), triggered by **`SEED_VERSION` 8 → 9** (re-seed). It does **not** go in `migrateGameDef`. Gameplay/zone data model is untouched — this is display-layer only.

- **Desktop supply band → flow Row.** The three side-by-side supply-slice zones (Treasury/Victory/Kingdom, today hand-placed at `x:1 / 12.2 / 23.4`) become children of a `group` with `layout:{mode:'row', gap, align:'stretch'}`, so they auto-space and all stay visible. *Non-regressive* — desktop keeps showing all three. Proves the flow Row engine on real elements.
- **Mobile supply → `panelSwitcher`.** The mobile variant already uses a hand-built selector-bar + `showForSelector` panels; formalize it as the new `panelSwitcher` kind (flow-laid tabs). Non-regressive (mobile is already tabbed). Proves `panelSwitcher` + slots + flow-row tabs.
- **Hand fan is left as-is.** It is a *zone card fan* (no child elements), so `FlowLayout` does not apply; we do not fake a migration there. (Backlog #5 — fan container sizing/scrollbars — is a separate zone-rendering fix, out of scope here; not claimed as a side effect.)
- Element **ids are preserved** where they exist (the three slice zones keep their ids; new wrapper/`panelSwitcher`/selector ids are added). Pinned tests that assert the old parent/rects update to assert the new tree.

## 8. Validation (`validate.ts`)
- `layout` on a `zone` → warning (ignored at runtime).
- `SlotDef.accepts` entries must be valid element kinds; child `slotId` must reference an existing slot on its parent (else orphan warning).
- `panelSwitcher` must have `tabs` + `content` slots; its tab children must be `role:'selector'` sharing its `selectorGroup`.
- `image.src` present; (optional) flag non-data external URLs per product preference (kept as a warning, not a hard error, in v1).

## 9. Testing
- **`layoutGeometry.test.ts`** — `flowLayoutCss` for all modes (flex/grid, gap/padding→px, justify/align mapping, autoFit template), `flowItemCss` sizing, `slotRect`.
- **`screenModel.test.ts`** — factories, `containerCanFlow`, `slotChildrenOf`, reorder-in-flow via `placeRelativeEl`, drop `accepts` rejection, group/ungroup preserving `layout`/`slots`/`slotId`, `isFlowChild`.
- **`screenLayout.test.ts` (runner)** — a container with `layout` emits flow CSS and drops absolute child styling; slots route by `slotId`; `panelSwitcher` shows exactly one panel via the existing selector gate; `image` renders.
- **`presets.test.ts`** — upgraded `panelSwitcherPreset` + new grid/row/column presets build and pass `validateGameDef` with zero errors; fresh ids per build.
- **`migrate.test.ts`** — a def carrying the new optional fields round-trips **unchanged** (idempotent, no auto-flow conversion).
- **`dominionGame.test.ts` / `dominionScreenLayout.test.ts`** — existing gameplay/structure tests stay green; desktop supply Row + mobile `panelSwitcher` asserted; `SEED_VERSION` is 9.
- **`sampleState.test.ts` / `validate.test.ts`** — memoization survives the new fields; new validation rules covered.

## 10. Decisions resolved (reader conflicts)
1. **Field name `layout`** (not `flowLayout`) — matches the approved design; distinct from `el.style: LayoutStyle`.
2. **`panelSwitcher` is a new kind but a thin one** — reuses the existing selector store + `showForSelector` gate + the existing preset shape; the only new runtime is generic slot+flow rendering (needed anyway). No renderer-synthesized selector state.
3. **Migration is additive; no `SCHEMA_VERSION` transform, no auto-flow of old groups.** Dominion changes ride `SEED_VERSION` 8→9 in the seed builder, not `migrateGameDef`.
4. **Dominion proof differs per viewport to avoid a regression** — desktop supply → flow Row (all slices visible); mobile supply → `panelSwitcher`. The hand fan is not migrated (zone card layout, not element flow); #5 is not claimed as fixed here.
5. **Zones ignore `layout`** — flow applies to child *elements*, and zones hold cards, not child elements.

## 11. Risks
- **Canvas/runner drift** — mitigated by routing 100% of flow CSS through `flowLayoutCss`/`slotRect` and a parity test.
- **Flagship regression** — Dominion is test-pinned (500+ tests); the migration is display-only and per-viewport non-regressive; a `SEED_VERSION` bump overwrites keeper edits to the built-in Dominion (flag in release notes).
- **Drag-model complexity** — flow reorder vs absolute move vs slot drop is the trickiest editor surface; covered by `screenModel` unit tests plus live verification.

## 12. Build order (slices for the plan)
1. **Model + CSS** — types (`FlowLayout`/`SlotDef`/`slotId`/`panelSwitcher`/`image`), `flowLayoutCss`/`flowItemCss`/`slotRect` + tests. (Pure, no UI.)
2. **Runner render** — flow containers, slots, `panelSwitcher`, `image` in `ScreenRenderer` + `runner.css` + tests.
3. **Editor model + palette + presets** — factories, `containerCanFlow`, drop/reorder/accepts in `screenModel`, Grid/Row/Column + Image palette, upgraded panelSwitcher preset + tests.
4. **Properties + canvas** — Layout/Image/Panel sections; canvas flow rendering, reorder-drag, slot chrome, handle suppression.
5. **Dominion proof** — desktop supply Row + mobile panelSwitcher, `SEED_VERSION` 8→9, update pinned tests; live verify.
6. **Validation + polish** — validate rules, adversarial review, verification.
