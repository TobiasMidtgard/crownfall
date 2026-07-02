# Table fidelity + effects overhaul — design

**Date:** 2026-07-02 · **Basis:** the exact-spec extraction of DominionGameTable
(`2026-07-02-dgt-table-design-spec.md`) and the effects gap analysis
(`2026-07-02-effects-gap-analysis.md`). Goal per the user: the hall's Dominion
table matches the original's design — the phase seal with turn-phase
indicators, Ctrl/Shift/Alt pile marking with number-key selection, the
appearing in-play rows shown for the acting turn, and the original's
animations — and the engine gains the triggers/effects the original's card
vocabulary needs.

## Principles

- **Generic first.** Every runner/engine capability lands as a native
  Cardsmith feature (usable by any GameDef, editable in the editor); the
  Dominion def then *uses* it. No Dominion-only branches in the runner.
- **The extraction is the law** for visuals/timings: exact values from the
  spec doc, adapted only where the runner's architecture demands (e.g. seat
  names instead of "Mordrane").
- **Engine before def.** `pickKingdom` pattern-matches setup blocks, so the
  dominionGame refactor lands after the engine features, gated by seeded
  playthrough parity for all three kingdom sets.

## Wave 1a — engine overhaul (new triggers + effects)

Per the gap analysis top-5, all additive, `schemaVersion` bumped to 2 with a
pass-through migration:

1. **Move-cause tags**: optional `tag` on card-moving blocks
   (`'gain'|'buy'|'trash'|'discard'|'play'|'draw'|'cleanup'`), carried on
   `cardEnterZone`/`cardLeaveZone` payloads; triggers/abilities gain an
   optional tag filter. Fires in `performMove`.
2. **`choosePile` block**: one-choice-per-distinct-card from a filtered zone
   (optional/mandatory, `$card` bound in body), new `'pile'` ChoiceRequest
   kind with per-pile counts. Session AI answers it; a runner PileChoiceSheet
   renders it. Replaces the PICKROW staging machine.
3. **`draw` block**: count/from/refillFrom/to with inline seeded reshuffle —
   replaces the 4-block reshuffle macro (~14 uses).
4. **`triggerAbilities` block** (re-fire a card's play ability without moving
   it — Throne Room) **+ `effectResolved` event** (stack-entry lifecycle, for
   post-attack cleanup like IMMUNE resets).
5. **`sumCards` expression** (sum numeric field over filtered zone) and a
   `contains` compare op for multi-type fields (restores Moat's dual typing,
   kills the VP forEach loops).

Editor: registry metadata, NodeBody/NodePicker/exprToText/graphModel cases,
RulesTab event kinds. Exhaustive switches make omissions compile errors.
Determinism: all new sampling through `core.rng`. AI-safety: `aiAnswer` +
`validAnswer`/`fallbackAnswer` handle `'pile'`.

## Wave 1b — runner fidelity (generic features)

1. **Keyboard system** (new `src/runner/keyboard.tsx`, wired by TableScreen,
   desktop only): held **Shift/Ctrl/Alt** spotlight zone groups (others dim to
   0.3 opacity) with on-card **key badges** (digit via `e.code`, 0 = tenth;
   lit state scale 1.25); **digits** activate the badged card/pile's single
   legal move; **Enter** = primary seal action, **Esc** per the existing
   ladder; bindings pause while a sheet/choice is open; badges and spotlight
   groups are def-driven — a zone screen-element gains optional
   `keyGroup?: 'shift'|'ctrl'|'alt'|'plain'` (types.ts, PropertiesPanel
   picker) so ANY game can mark its zones.
2. **SeatRef `'current'`** (types.ts already updated): resolveSeat + callers
   rebind the element to the acting player each turn — powers "the play area
   shows the current turn's cards".
3. **Phase seal**: zone/group states already exist; what's missing is the
   original's *stamp* transition (scale 1.07 / brightness 1.5, 0.5s) on phase
   change and the foe-breathe idle (2.6s) — add as `onChangeAnim` variants
   (`'stamp'`, `'breathe'`) in ScreenRenderer + runner.css.
4. **Animation parity**: motion spec gains per-move-tag overrides
   (`motion.byTag: { play: {flightMs,arc,spin,staggerMs}, ... }`) consumed by
   the FLIP layer, so draw 300/45, play 320/38, gain 340/40, discard 320/36,
   burn unchanged; counter-bump exists (rn-ticker-bump).

## Wave 2 — the Dominion def + skin (after wave 1)

- Cards refactored to the new vocabulary (choosePile, draw, tags,
  triggerAbilities, sumCards); PICKROW/RESERVE machinery deleted; VP recount
  becomes one tagged-gain trigger; end-at-turn-end logic kept.
- Screen layout: own **In play** row (hides only when foe acting AND own row
  empty — exact original condition, via element `visible` Expr) + foe in-play
  row in the foe strip at 0.82× card width bound to seat `'current'`/opp as
  per spec; supply pile buy-phase gold glow + empty-pile 0.28/grayscale states;
  seal five-state texts (Action/Buy/foe-turn/resolve/fallen) via varText
  expressions with the real foe name; keyGroups: Shift=Treasury, Ctrl=Victory,
  Alt=Kingdom; hand fan 1.6deg/0.32rem.
- dominion-skin.css: seal CSS to spec (lozenge dots, bone current-phase fill,
  hover/active/disabled/foe states), key-badge styling, spotlight dimming,
  refuse-shake, burn/char embers per spec timings.
- `SEED_VERSION` bump; seeded parity tests: all 3 sets play to completion on
  the same seeds as before the refactor.

## File ownership (parallel-safety)

- **Engine agent**: src/engine/**, src/shared/{types,validate,migrate}.ts,
  src/editor/blocks/**, src/editor/tabs/RulesTab.tsx, src/runner/session.ts,
  src/runner/sheets.tsx.
- **Runner agent**: src/runner/{keyboard.tsx(new), ScreenRenderer, ZoneViews,
  TableScreen, flip, layout, layoutGeometry, runner.css},
  src/editor/tabs/table/PropertiesPanel.tsx (seat picker + keyGroup),
  types.ts is engine-agent's — the runner agent requests additions via the
  orchestrator (SeatRef 'current' pre-landed; `keyGroup` + `motion.byTag` are
  pre-landed too or engine-agent adds on request).
- **Def agent (wave 2)**: src/forge/dominionGame.ts(+test), dominion-skin.css,
  seedDominion.ts (version bump).

## Verification

Full suite green at each wave; seeded parity for the def refactor; live E2E:
keyboard marking/selection, seal states through a full turn cycle, play-area
visibility during the AI's turn, animation timings sampled via computed
styles; mobile regression check (carousels unaffected; keyboard inert).
