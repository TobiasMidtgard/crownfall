# Universal Node Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen element is a fully editable node — conditional style rules and vector path shapes join the model, and the editor can drill into, populate, and restyle the children of ANY element, not just groups.

**Architecture:** The model already carries universal `children` (ScreenElementBase), flow layouts and slots, and the runner already renders them (ScreenRenderer:417). This plan adds the two missing model features (`styleRules`, `path` shape) through the shared appearance resolver so runner and editor preview stay one code path, then generalizes the editor's four group-only chokepoints (hit-descend, focus double-click, drop targets, child-add UI), then ships the editing surfaces (rules list, vertex editor), a Dominion showcase, and the zone→card-template bridge.

**Tech Stack:** TypeScript + React 18, vitest, the in-repo expression evaluator (`evalDisplayExpr` path), SVG for path shapes.

**Ground truth (verified 2026-07-19):**
- `children?: ScreenElement[]` on `ScreenElementBase` — src/shared/types.ts:293.
- Runner renders non-group children — src/runner/ScreenRenderer.tsx:417.
- `pathToEl`/`indexElements`/`canDropInto` are child-generic — src/editor/tabs/table/screenModel.ts:102,160,890.
- Group-only chokepoint: `deepestGroupAt` (screenModel.ts:218, `info.el.kind !== 'group'` at :223); the canvas double-click descend and drop-hover feed off it.
- `resolveElementAppearance` lives in src/runner/layoutGeometry.ts (shared by ScreenRenderer and ScreenCanvas).
- No `styleRules`, no `'path'` shape anywhere yet.

---

## Wave 1 — Model + runner: `styleRules` and `path` (no UI)

### Task 1: `styleRules` in the model

**Files:**
- Modify: `src/shared/types.ts` (ScreenElementBase, ~line 264 after `states`)
- Test: `src/runner/layoutGeometry.test.ts` (extend; create if the appearance tests live elsewhere — search `resolveElementAppearance` first and co-locate)

- [ ] **Step 1: Write the failing test** (merge order: base → state → rules, later rules win)

```ts
import { describe, expect, it } from 'vitest';
import type { ScreenElement } from '../shared/types';
import { resolveElementAppearance } from './layoutGeometry';

// Minimal ctx double: resolveElementAppearance takes (el, ctx-ish) — mirror the
// existing tests' harness in this file for state/visible resolution and reuse
// its ctx builder. The assertions below are the contract:
describe('styleRules', () => {
  it('merges matching rules over base and state styles, later rules win', () => {
    const el = {
      kind: 'shape', id: 'e1', name: 'Dot', shape: 'circle',
      rect: { x: 0, y: 0, w: 10, h: 10 },
      style: { background: '#111111', borderColor: '#222222' },
      styleRules: [
        { when: { kind: 'num', value: 1 }, style: { background: '#333333' } },
        { when: { kind: 'num', value: 0 }, style: { background: '#444444' } },
        { when: { kind: 'num', value: 1 }, style: { borderColor: '#555555' } },
      ],
    } as unknown as ScreenElement;
    const a = resolveElementAppearance(el, ctx /* the file's ctx builder */);
    expect(a.style?.background).toBe('#333333');   // rule 1 wins, rule 2 falsy
    expect(a.style?.borderColor).toBe('#555555');  // rule 3 layered after
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/runner/layoutGeometry.test.ts` → FAIL (`styleRules` unknown / colors unchanged).

- [ ] **Step 3: Add the type** — in `ScreenElementBase` directly under `states`:

```ts
  /**
   * Conditional style patches, evaluated IN ORDER against the live context
   * (same evaluator as `visible`); every matching rule's patch merges over
   * the last — base style → active state style → matching rules. The
   * "recolor the dot while X" primitive at any depth.
   */
  styleRules?: { when: Expr; style: Partial<LayoutStyle> }[];
```

- [ ] **Step 4: Resolve in `resolveElementAppearance`** (src/runner/layoutGeometry.ts) — after the state merge, before return:

```ts
  if (el.styleRules && el.styleRules.length > 0) {
    for (const rule of el.styleRules) {
      if (truthyDisplay(ctx, rule.when)) style = { ...style, ...rule.style };
    }
  }
```
(`truthyDisplay` = whatever this file already uses to evaluate `visible`/state
`when` — reuse that exact helper so editor sample parity is automatic.)

- [ ] **Step 5: Run to verify pass**, then run the editor + runner suites:
`npx vitest run src/runner src/editor` → all green.

- [ ] **Step 6: Commit** — `feat(model): styleRules — conditional style patches on every element`.

### Task 2: validation for `styleRules`

**Files:**
- Modify: `src/shared/validate.ts` (the element walker — find the branch validating `el.visible` and mirror it)
- Test: `src/shared/validate.test.ts`

- [ ] **Step 1: Failing test** — an element with a styleRule referencing a missing variable yields the same class of issue `visible` does:

```ts
it('flags a styleRule whose condition references a missing variable', () => {
  const def = minimalDef(); // the file's existing builder
  def.screenLayout!.elements.push({
    kind: 'text', id: 'e_sr', name: 'T', rect: { x: 0, y: 0, w: 10, h: 10 },
    text: 'x',
    styleRules: [{ when: { kind: 'getVar', varId: 'nope', target: null }, style: {} }],
  } as never);
  const issues = validateGameDef(def);
  expect(issues.some((i) => i.where.includes('e_sr') || i.where.includes('T'))).toBe(true);
});
```

- [ ] **Step 2: fails** → **Step 3: implement** — beside the `el.visible` check:

```ts
    if (el.styleRules) {
      el.styleRules.forEach((r, i) =>
        checkExpr(r.when, `${where} > style rule ${i + 1}`)); // the file's expr checker
    }
```

- [ ] **Step 4: pass + suites** → **Step 5: Commit** `feat(validate): styleRules conditions checked like visible`.

### Task 3: `path` shape kind

**Files:**
- Modify: `src/shared/types.ts` (the shape member of the ScreenElement union — extend its `shape` literal union with `'path'` and add `points?: { x: number; y: number }[]; closed?: boolean;`)
- Modify: `src/runner/ScreenRenderer.tsx` (shape render branch) and, if the editor canvas paints shapes itself, `src/editor/tabs/table/ScreenCanvas.tsx` shape preview (it reuses `shapeClipPath`/`shapeBorderRadius` from layoutGeometry — put path SVG in ONE shared helper `pathShapeSvgProps` in layoutGeometry).
- Modify: `src/shared/validate.ts` (≥3 points, 0–100 each, when `shape === 'path'`).
- Test: `src/runner/layoutGeometry.test.ts` + `src/shared/validate.test.ts`.

- [ ] **Step 1: Failing tests**

```ts
it('path shapes yield an svg polygon spec', () => {
  const pts = [{ x: 50, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  expect(pathShapePoints(pts)).toBe('50,0 100,100 0,100');
});
// validate.test.ts
it('flags a path shape with fewer than 3 points', () => { /* minimalDef + shape path 2 points → issue */ });
```

- [ ] **Step 2: fail** → **Step 3: implement**
  - types: `shape: 'rect' | 'circle' | ... | 'path'` (extend the existing literal list) + the two fields;
  - layoutGeometry: `export const pathShapePoints = (pts: {x:number;y:number}[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');`
  - ScreenRenderer shape branch: when `el.shape === 'path' && el.points`, render
    `<svg viewBox="0 0 100 100" preserveAspectRatio="none" className="rn-shape-path">{el.closed !== false ? <polygon points={pathShapePoints(el.points)} /> : <polyline points={pathShapePoints(el.points)} fill="none" />}</svg>`
    with fill = style.background, stroke = style.borderColor, strokeWidth = style.borderWidth (px), vector-effect="non-scaling-stroke";
  - ScreenCanvas shape preview: same helper, same SVG (editor parity);
  - validate: min points check.

- [ ] **Step 4: suites green** → **Step 5: Commit** `feat(model): vector path shape kind (svg polygon/polyline)`.

## Wave 2 — Editor: drill into ANY node + child management

### Task 4: generalize hit-descend + drop targets

**Files:**
- Modify: `src/editor/tabs/table/screenModel.ts:218` — rename `deepestGroupAt` → `deepestContainerAt`; the filter becomes `const isContainer = info.el.kind === 'group' || (info.el.children?.length ?? 0) > 0; if (!isContainer || exclude.has(id)) continue;` — keep the rotation math untouched; keep an exported alias `deepestGroupAt = deepestContainerAt` for one commit, then update the ~4 call sites in ScreenCanvas and delete the alias.
- Test: `src/editor/tabs/table/screenModel.test.ts` — a button with one child is found by `deepestContainerAt` at its coords; an empty text element is not.

Steps follow the same fail→implement→pass→commit rhythm as Task 1.
Commit: `feat(editor): drill/drop targets treat every childed element as a container`.

### Task 5: double-click focus into childed non-groups + Add-child UI

**Files:**
- Modify: `src/editor/tabs/table/ScreenCanvas.tsx` — the double-tap descend path keys off the drag's `leafId` chain; verify it uses `pathToEl` (already generic) and remove any `kind === 'group'` guard on entering focus (search `focusElement(` call sites).
- Modify: `src/editor/tabs/table/PropertiesPanel.tsx` — a "Children" section for every element: shows child count, an **+ Add child** kind-picker (reuses the palette's element factories from screenModel — `newTextElement`, `newShapeElement`, etc.), reorder (▲▼) and delete rows (the group editor's existing surface — extract it into `ChildrenSection` and render it for all kinds).
- Test: screenModel-level factory reuse needs no new tests; canvas behavior verified live (established practice for canvas interaction).

Commit: `feat(editor): focus + child management on every element kind`.

## Wave 3 — Editing surfaces

### Task 6: styleRules list UI

**Files:**
- Modify: `src/editor/tabs/table/PropertiesPanel.tsx` — a "Style rules" list under the style editor for every element: each row = the WHEN condition builder (the same component `visible` editing uses — search `visible` in PropertiesPanel and reuse) + the compact fill/border/text patch controls (reuse the ZonePartStyle editors from zoneParts wiring) + delete; **+ Add rule** appends `{ when: TRUE_EXPR, style: {} }`.
- The canvas preview already honors rules via Task 1's shared resolver — no canvas change.

Commit: `feat(editor): style-rules editor on every element`.

### Task 7: path vertex editor in focus

**Files:**
- Modify: `src/editor/tabs/table/ScreenCanvas.tsx` — when the FOCUSED element is a path shape: render one draggable handle per point (screen-% → element-% math mirrors the resize handle's), double-click on a segment inserts the midpoint after the nearest vertex, Delete removes the selected vertex while `points.length > 3`; a Close toggle + point list lives in PropertiesPanel's shape section.
- Palette: add "PATH" to the shape choices (screenModel `newShapeElement` variant with a triangle default `[{x:50,y:0},{x:100,y:100},{x:0,y:100}]`).

Commit: `feat(editor): vector path editing — vertex handles, insert/delete, close toggle`.

## Wave 4 — Showcase + ship

### Task 8: Dominion seal dots as composites + deploy

- Rebuild the three/four seal dots in `src/forge/dominionGame.ts` as path-or-circle shapes carrying a styleRule (`phaseIs` → accent fill) — visual parity first, then one showcase flourish (a tiny image child in the Night dot visible only while `IN_NIGHT`).
- SEED_VERSION bump + CHANGES.md entry + full loop (tsc → vitest → build → live probes on both variants → commit → deploy → Pages check).

## Wave 5 — Card-face bridge

### Task 9: zone card tile → card template focus

- In focus on a zone, double-clicking a card TILE (not chrome) navigates to the Cards tab with that card's template face focused (`cardsSectionRef` one-shot, GameEditorPage) and pushes a return crumb ("← back to table") that restores the exact table focus path.
- Live-verify round trip; CHANGES entry.

---

**Execution order:** Tasks 1→2→3 (wave 1) ship together; 4→5 (wave 2) together; 6→7 (wave 3); 8; 9. Full suite + live verification before every deploy; commit per task.
