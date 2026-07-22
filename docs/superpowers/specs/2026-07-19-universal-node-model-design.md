# Universal Node Model — design

**Goal.** Every visual element on a game screen becomes a *node*: it can hold
children, carry conditional style rules, be focused into at any depth, and be
edited to the most minute detail — an image inside a phase dot that only shows
while a variable is set, a per-state recolor of one dot, a custom vector shape
as a button face, the text of a card inside a supply grid. The keeper's words:
"full customizability to the most minute detail."

User approval: direction approved 2026-07-19 ("I want a full universal node
model that supports this level of editing detail. If you think a full rebuild
is needed, do that.").

## 1. Model (src/shared/types.ts)

Three additions to `ScreenElementBase` — all optional, so every existing def
loads unchanged (no migration):

- `children?: ScreenElement[]` — on EVERY kind, not just `group`. Child rects
  stay % of the parent box (the group convention). A shape with children is a
  composite (dot + conditional image); a button with children is a decorated
  button. `group` remains as the "pure container" kind but loses its monopoly.
- `styleRules?: StyleRule[]` where
  `interface StyleRule { when: Expr; style: Partial<LayoutStyle>; }`
  Evaluated in order against the live context (same evaluator as `visible`),
  each matching rule's style patch merges over the last: base style → element
  state style (existing `states`) → matching styleRules, later rules win.
  This answers "color the dot by phase / by variable" without duplicating
  whole states, at any depth.
- Shape gains a kind: `shape: 'path'` with `points: { x: number; y: number }[]`
  (% of the shape's own box, ≥3 points) and `closed: boolean`. v1 renders a
  straight-segment polygon via SVG (fill+stroke from LayoutStyle); curve
  smoothing is a later, additive field.

Explicit non-changes: `states` (rect+style presets) stays; `visible`,
`showForSelector`, part styles, collapsibles all stay. The card TEMPLATE tree
(CardTemplate elements) is a separate tree and is NOT unified in this rebuild —
see §5 for the bridge.

## 2. Runner rendering (src/runner/…, layoutGeometry / ScreenRenderer)

- Extract the group-children recursion into the shared element renderer: after
  a node's own body paints, render `children` inside its box (same absolute→
  relative math groups use). Applies to every kind. Children of a hidden node
  never paint (the existing reachability walk generalizes).
- `styleRules`: resolve in `resolveElementAppearance` (where states already
  merge) so editor preview and runner share one code path.
- `path` shapes render as an inline `<svg><polygon/polyline>` sized to the
  box; hit-testing/keyboard unchanged (the node's rect is the hit box).

## 3. Editor (src/editor/tabs/table/…)

- **Focus anywhere:** `pathToEl` / `deepestGroupAt` / `indexElements` /
  drop-parent resolution generalize from `kind === 'group'` to
  `children != null || kind === 'group'`. Double-click drills into ANY node
  with children; breadcrumbs unchanged. The "👁 Hidden" ghost pass already
  covers hidden children in focus.
- **Child management:** PropertiesPanel gains a Children section on every
  element (add from palette, reorder, delete — the group editor's surface,
  reused). Palette drops while focused inside a node land as its children.
- **styleRules UI:** a rules list on every element — each row is the existing
  WHEN condition builder + a compact style patch editor (the theme/fill
  controls already built for part styles). Preview: the canvas live-preview
  evaluates rules against the sample, so a rule lights up exactly like the
  runner.
- **Path editor:** while a path shape is focused, its points render as
  draggable vertex handles; double-click a segment inserts a point,
  Del removes the selected point (min 3), a Close toggle in the panel.

## 4. Validation (src/shared/validate.ts)

- Walk `children` on every kind (the walker generalizes).
- `styleRules[].when` validated exactly like `visible` exprs.
- `path`: ≥3 points, each 0–100.

## 5. Card-face bridge (separate, after the model ships)

Zone card tiles render card-template faces — a different tree. The bridge:
double-clicking a card tile in a focused zone jumps to the Cards tab with
that template's face in focus and a return breadcrumb to the table (the
`cardsSectionRef` one-shot mechanism already exists). True in-place template
editing inside the table canvas builds on the node model later; the bridge
gives the workflow now.

## 6. Delivery waves (each shippable, each live-verified)

1. **Model + runner:** types, renderer recursion, styleRules resolution,
   path rendering, validation, tests (renderer + validate + conditionModel
   whitelist if needed). No UI yet — defs can already USE the features.
2. **Editor drill + children:** universal focus, Layers full tree, child
   add/reorder/delete, drop-into-focused.
3. **Editor styleRules + path tools:** rules list UI, vertex editing.
4. **Showcase + seed:** rebuild the Dominion seal dots as composites (visual
   parity or better), CHANGES entry, SEED bump, deploy.
5. **Card-face bridge.**

## 7. Testing

- Pure: geometry/appearance helpers (styleRules merge order, children
  absolute-rect math, path point math) unit-tested beside the existing
  layoutGeometry/partStyles tests.
- The Dominion invariant suites must stay green untouched through wave 1-3
  (no def change until wave 4).
- Live verification each wave via the established browser-probe loop.

## 8. Risks

- Renderer recursion on non-group kinds can double-paint if a kind's body
  already fills its box (zones) — children render ABOVE the body by design;
  zones with children are legal but the editor palette will not suggest it.
- Focus/drop generalization touches marquee/snap/reparent paths — the
  screenModel helpers carry the logic and their tests carry the behavior.
- styleRules evaluation cost: bounded by rules count; evaluated only for
  mounted elements (same budget class as `visible`).
