# Authoring Slice A + Table-Designer Usability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (adapted: parallel WAVES of subagents with orchestrator review + a full-tree
> gate — `npx tsc --noEmit` + `npx vitest run` — between waves). Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> **Format note:** tasks are wave-scoped agent briefs with exact file
> ownership, interfaces, and test gates; the two committed specs carry the
> detailed semantics and are the source of truth wherever this plan references
> them. Execution is autonomous end-to-end per the user's instruction.

**Goal:** Implement both approved specs — card types/tags + the guided
condition builder + named filters (`2026-07-02-authoring-tags-filters-design.md`),
and the designer live preview + selector buttons + peek status bar + mobile
light fixes (`2026-07-02-table-designer-usability-design.md`) — ending with the
Dominion def migrated, everything reviewed, verified live, and deployed.

**Architecture:** Additive schema on `GameDef` (types/tags/filters,
selector-button fields, `statusBar`), three new leaf `Expr` kinds evaluated by
the existing engine, a new `ConditionBuilder` editor replacing raw condition
editing, client-side selector-group state replacing the built-in tab bar (with
a migration), a peek variant of the runner status bar, and a sample-state-driven
preview mode in the screen canvas. Engine format unchanged at runtime; every
existing game keeps loading and playing.

**Tech stack:** the repo's own — Vite + React 18 + TS, vitest, the pure seeded
engine. Zero new dependencies.

---

### Task 0 (orchestrator, inline): pre-land non-breaking schema

**Files:** Modify `src/shared/types.ts` only.

- [ ] Add optional, non-union-breaking fields (no switch/Record breakage):
  `CardTypeDef { id; name; color }`, `TagDef { id; name }`,
  `NamedFilterDef { id; name; condition: Expr }`;
  `GameDef.cardTypes?/cardTags?/filters?`; `CardDef.typeId?: Id | null`,
  `CardDef.tags?: Id[]`; button element `role?: 'action' | 'selector'` +
  `selectorGroup?: string`; `ScreenElementBase.showForSelector?: Id`;
  `ScreenLayout.statusBar?: 'pinned' | 'peek'`. Doc comments = the specs'
  wording (they are the contract for every later agent).
- [ ] Gate: `npx tsc --noEmit` clean (fields are optional; nothing consumes
  them yet). Commit.

### Wave 1 — three parallel agents (disjoint files)

**Task 1A: engine vocabulary (spec A §Schema/§Expressions/§Testing)**

**Files:** Own `src/shared/types.ts` (Expr union additions ONLY),
`src/shared/validate.ts`, `src/shared/migrate.ts`, `src/engine/**` (+ new
tests), `src/editor/blocks/{registry.ts, exprToText.ts, graphModel.ts}`
(+ their tests), `src/editor/blocks/ExpressionEditor.tsx` (field editors for
the three kinds — it remains the VALUE-expression editor).

- [ ] Add `Expr` kinds `cardTypeIs { card; typeId }`, `cardHasTag { card;
  tagId }`, `filterRef { filterId; card }`; evaluator cases (pure, no RNG);
  filterRef resolves the named filter's condition with `$card` rebound and a
  resolving-set cycle guard (re-entry → caught script error → false).
- [ ] `validateGameDef`: dangling typeId/tagId/filterId references; filter
  cycles (DFS over filterRef edges); warnings for unused types/tags/filters.
- [ ] `migrateGameDef`: seed `cardTypes/cardTags/filters` to `[]` when absent
  (pure, idempotent, no schemaVersion bump).
- [ ] Registry metadata + exprToText sentences ("card is a Treasure", "card
  has tag Attack", "matches filter The basic cards") + graphModel outTypes
  (boolean) for all three; ExpressionEditor pickers (type/tag/filter selects
  populated from the def).
- [ ] Tests: evaluation of all three kinds (incl. card with no type/tags),
  cycle rejection (validate error + runtime false), migrate idempotence,
  exprToText/graphModel/registry completeness. Gate: scoped vitest green,
  tsc clean. Commit.

**Task 1B: canvas live preview + mobile light fixes (spec B §1/§4)**

**Files:** Own `src/editor/tabs/table/{ScreenCanvas.tsx, screenModel.ts,
LayersPanel.tsx, table.css, PropertiesPanel.tsx (presentation only: bottom
sheet + touch targets), + tests}`, new
`src/editor/tabs/table/sampleState.ts`.

- [ ] `sampleState.ts`: build a snapshot by running the def headlessly
  (`createEngine`, 2 seats, fixed seed 7, `start()`); memoized per def
  revision; script error → `null` (preview disabled + notice chip).
- [ ] Preview toggle (default ON) in the canvas toolbar: with a sample state,
  evaluate `visible` + `states` per element (viewer = seat 0, same
  `isDisplayVisible`/`resolveElementAppearance` the runner uses); hidden
  elements unrendered (ghost outline when selected via Layers); collapsibles
  render as their collapsed dock tab with an expand-for-edit toggle on
  selection; zone counts/varText read the sample state.
- [ ] Mobile light fixes: canvas handles/grips/chips ≥44px touch targets;
  double-tap element → zoom-to-fit it, double-tap empty → Fit; PropertiesPanel
  becomes a bottom sheet ≤720px.
- [ ] Tests: sampleState determinism + error fallback; preview visibility
  resolution pinned against the Dominion seal (exactly one face). Gate +
  commit.

**Task 1C: peek status bar (spec B §3, runner half)**

**Files:** Own `src/runner/TableScreen.tsx`, `src/runner/runner.css`
(+ a small `src/runner/peekBar.test.ts` for pure helpers if extracted).

- [ ] Consume `def.screenLayout.statusBar` (default `'pinned'` — identical
  behavior). `'peek'`: bar collapses after ~2s idle to a slim handle strip
  (labeled button "Show game bar", grabber + turn/phase glyph) positioned
  `bottom: calc(env(safe-area-inset-bottom) + 16px)` minimum; expands on
  hover/click/tap/drag-up/any focus within; auto-collapses on idle again;
  reduced-motion + `html.calm` = instant, no slide.
- [ ] Gate: full runner tests green (pinned default untouched). Commit.

**Wave gate:** full `tsc` + `vitest` + `npm run build`; orchestrator reviews
reports; fix or re-dispatch before Wave 2.

### Wave 2 — one agent

**Task 2: the guided ConditionBuilder (spec A §Builder/§List editors)**

**Files:** Create `src/editor/blocks/ConditionBuilder.tsx` + sibling row
components (`conditionRows/` if useful) + `conditionModel.ts` (pure
compile/parse) + tests; new `src/editor/tabs/TypesTab.tsx` and
`src/editor/tabs/FiltersTab.tsx` (+ GameEditorPage tab wiring); Modify
condition SLOTS to use it: `src/editor/tabs/ActionsTab.tsx` (legality),
`src/editor/tabs/RulesTab.tsx` (trigger condition + end conditions),
`src/designer/AbilitiesEditor.tsx`, `src/editor/blocks/slots.tsx`
(CardSelector.filter/choice filters), `src/editor/tabs/table/PropertiesPanel.tsx`
(`visible` + `cardFilter` slots), `src/designer/CardEditorModal.tsx` (type
single-select + tags multi-select).

- [ ] `conditionModel.ts`: row/group tree ⇄ `Expr` compile + parse per the
  spec's clause vocabulary (all/any/none groups, card clauses incl. "name is
  one of" → or-chain, matches-filter, phase/variable/zone-count/turn rows,
  not-wrap); anything unparseable → `{ kind: 'advanced', expr }` row
  (read-only sentence via exprToText + replace affordance). Round-trip
  property: parse(compile(rows)) ≡ rows for every clause type.
- [ ] `ConditionBuilder.tsx`: sentence-chip rows, add-condition/add-group/
  use-saved-filter affordances, plain-English readback line, context-aware
  clause availability from the slot's `bindings` prop.
- [ ] Replace `ExpressionEditor` in every condition slot listed above
  (ExpressionEditor itself remains for VALUE expressions inside blocks).
- [ ] TypesTab (add/rename/recolor types; add/rename tags; delete warns on
  references) + FiltersTab (named filters list, each edited with the builder);
  card designer pickers.
- [ ] Tests: round-trip suite, advanced-row fallback (no data loss), slot
  swaps compile to identical `Expr` for representative existing conditions.
  Gate + commit.

### Wave 3 — one agent

**Task 3: selector buttons + presets, tab bar retired (spec B §2)**

**Files:** Own `src/runner/{layout.ts, ScreenRenderer.tsx, ZoneViews.tsx,
keyboard.tsx, runner.css, + tests}`, `src/shared/migrate.ts` (tabbed →
selector conversion), `src/shared/validate.ts` (selector warnings),
`src/editor/tabs/table/{PropertiesPanel.tsx, Palette.tsx, screenModel.ts}`,
new `src/editor/tabs/table/presets.ts`.

- [ ] Selection store: `cardsmith.sel.<defId>.<groupId>` (read/write/subscribe
  + in-session fallback; value = selected button element id; default = first
  selector in paint order).
- [ ] Runner: `role: 'selector'` buttons toggle selection (never a game
  action; `rn-sel-on` on the active one); `showForSelector` gates rendering
  (composes with `visible`); keyboard modifier flip selects the button whose
  bound set contains the held keyGroup zone; digits target only currently
  shown elements. Remove `rn-tabbar`/`rn-tabslider`/`TabbedGroup` rendering +
  CSS + the `tabbed` runtime path.
- [ ] `migrateGameDef`: `tabbed: true` group → selector-button row + panels
  bound via `showForSelector` (pure, idempotent, ids deterministic from the
  group id); keep behavior identical (assert in test).
- [ ] Editor: Selector toggle + group name on buttons; "Show only for
  [selector]" picker on every element; validation warnings per spec.
  `presets.ts` typed registry + **Panel switcher** preset (param: panel count
  + names) inserted from a new Palette "Presets" section; output passes
  `validateGameDef` with zero errors.
- [ ] Tests: store, max-1 invariant, migration idempotence + rendering parity,
  keyboard flip, preset validity. Gate + commit. (dominion-skin.css keeps its
  now-dead tab rules until Task 4 restyles the switcher.)

### Wave 4 — one agent

**Task 4: Dominion migration (spec A §Dominion + spec B §2-Dominion/§3-def)**

**Files:** Own `src/forge/{dominionGame.ts, dominionGame.test.ts,
dominion-skin.css, seedDominion.ts (SEED_VERSION bump only)}`,
`src/examples/dominion.ts` template additions ONLY if the pinned example tests
allow (prefer forge-side patching).

- [ ] Types (Treasure/Victory/Curse/Action/Reaction, colors = skin palette) +
  tags (Attack/Kingdom/Basic/Duration-reserved) + per-card assignment; named
  filter "The basic cards"; every condition rebuilt through the new
  vocabulary (`cardTypeIs`/`cardHasTag`/`filterRef` — the Kingdom slice is
  one tag clause); `dom_field_ctype` retired from conditions (display line
  stays via `dom_field_kind`).
- [ ] Chronicle log elements removed (both variants); `statusBar: 'peek'` on
  the layout; mobile supply switcher = three designed selector buttons (DGT
  tab-slider dress via skin: notched crimson active plate, engraved labels) +
  three bound carousel panels; skin's old rn-tab rules replaced by
  `rn-sel-on` styling.
- [ ] Single `SEED_VERSION` bump. Tests updated: type/tag assertions replace
  ctype ones; switcher structure; no `tabbed` flag; all three kingdom-set
  playthroughs complete with unchanged winners/scores/turns; kingdom slice
  still exactly ten piles. Gate + commit.

### Wave 5 — quality + ship (orchestrator)

- [ ] Adversarial review workflow over the whole diff (find → verify, the
  session's established pattern); fix confirmed findings (fix agents by file
  ownership).
- [ ] Live E2E on the preview server, desktop + 390×844: builder round-trip on
  a real Dominion condition; Types/Filters tabs; canvas preview (one seal
  face, tabs-as-buttons switching, collapsed chronicle gone); peek bar
  hide/reveal + safe-area offset; selector switcher + keyboard flip at the
  table; a played turn.
- [ ] Full gate (`tsc`, `vitest`, `build`) → commit → push → `npm run deploy`
  → confirm the live hash flips.
- [ ] Update memory (`crownfall-merge.md`), mark tasks complete, **ping the
  user** (PushNotification) with the summary.
