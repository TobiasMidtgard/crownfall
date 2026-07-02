# Table designer usability — live preview, selector buttons, peek status bar

**Date:** 2026-07-02 · **Status:** approved design, ready for an implementation
plan. Companion to `2026-07-02-authoring-tags-filters-design.md` (Slice A);
this spec covers the table-designer + runner-chrome feedback batch.

## The problems (from the user's screenshots)

1. The designer canvas renders every element unconditionally: all six phase-seal
   faces draw stacked (the seal looks nothing like the game), tabbed panels
   draw overlaid, and there is no tab bar in-canvas at all.
2. The chronicle log element renders in its OPEN state — a 73%-tall sheet parked
   mid-canvas — and duplicates the runner status bar's Log drawer at runtime.
3. The built-in tab bar is invisible/uneditable in the designer, and authors
   cannot design their own switcher buttons.
4. The designer is awkward on a phone (25% zoom, tiny targets).

## Decisions (settled with the user)

- **Chronicle element is removed** from the Dominion screens; the runner's Log
  drawer is the one history. The status bar becomes a **peek bar**: hidden
  until hover (desktop) or drag-up (touch), with the drag zone kept clear of
  the phone's home-indicator swipe.
- **Selector buttons replace the built-in tab bar** — authors design their own
  switcher buttons — with **macros (insert presets)** so a working switcher is
  one click in any game.
- **Mobile editing gets light fixes now**; a deep touch-first editor pass is
  deferred.

## 1 · Live-preview canvas

`ScreenCanvas` gains a **Preview** toggle (default ON):

- A **sample game state** is produced once per def revision by running the
  def's setup headlessly (the engine is pure + seeded: 2 seats, fixed seed,
  engine.start(), snapshot). Script errors → preview falls back to OFF with a
  small notice. Cached; rebuilt when zones/decks/setup/variables change.
- With preview ON, the canvas evaluates each element's `visible` expression
  and `states` against the sample state (`$viewer` = seat 0), exactly like the
  runner: one seal face shows, conditional styles apply, count badges show
  real numbers. Selection/manipulation still works on visible elements; the
  Layers panel remains the way to reach hidden ones (hidden elements show a
  ghost outline when selected there).
- **Collapsibles render collapsed** (their dock tab) with an expand-for-edit
  toggle on selection.
- **Selector-bound elements** (see §2) show only the active selection's set;
  clicking a selector button in the canvas switches it, which is also how you
  edit each panel.
- Preview OFF = today's show-everything behavior, for wiring things up.

## 2 · Selector buttons (replaces tabbed groups)

**Model.** Button elements gain `role: 'action' | 'selector'` (default
`action`):

- A **selector** button carries `selectorGroup: string`. Buttons sharing a
  group form a radio set: exactly one is selected (max 1 — the user's
  requirement), selection is CLIENT state (not game state), persisted per
  device at `cardsmith.sel.<defId>.<groupId>` (same pattern as the old tab
  key). First button in paint order is the default.
- Any element gains optional `showForSelector?: Id` — the element renders only
  while that selector button is selected. Composes with `visible` (both must
  hold).
- Runner: selected buttons get `rn-sel-on` (skins style the active state);
  clicking sets selection — it never performs a game action. Keyboard: the
  existing keyGroup modifier flip now selects the selector button whose bound
  panel contains that keyGroup zone (parity with the old tab auto-flip);
  digits target only elements visible under the current selection.
- **Migration** (`migrateGameDef`, pure + idempotent): every `tabbed: true`
  group converts to a plain group containing a generated row of selector
  buttons (one per panel child, labeled by the panel's name) + the panels
  bound via `showForSelector`. The `tabbed` flag and the runner's
  `rn-tabbar`/`rn-tabslider` rendering are then removed. Old stored defs load
  and behave identically.
- **Editor**: PropertiesPanel — buttons get a Selector toggle + group name;
  every element gets "Show only for [selector button]" (picker lists selector
  buttons in the same screen). Validation warns on: a selector group with zero
  buttons selected-able, `showForSelector` pointing at a non-selector button,
  and elements bound to a button in another variant.

**Macros — insert presets.** The Palette gains a **Presets** section. A preset
is a parameterized factory `(params) → ScreenElement[]` stamped with fresh ids.
Shipped now:

- **Panel switcher** — asks for panel count + names; inserts N selector buttons
  in a row + N bound panel groups, ready to restyle and fill.

The preset list is a typed registry so later presets (harbor row, phase seal,
counter strip) can join without editor surgery.

**Dominion migration.** The mobile supply's tabbed group becomes three designed
selector buttons (styled per the DGT tab-slider dress: notched crimson active
plate, engraved labels) + the three bound carousel panels. Desktop unchanged
(no tabs there). `SEED_VERSION` bump.

## 3 · Peek status bar + chronicle removal

- The Dominion def drops its chronicle log elements (desktop + mobile); the
  Log drawer is the history. (The `log` element kind itself stays — other
  games may still want an on-board log.)
- `ScreenLayout.statusBar?: 'pinned' | 'peek'` (default `pinned` — no other
  game changes). With `peek`, the runner's status bar:
  - collapses to a slim handle strip (grabber + turn/phase glyph) after ~2s of
    inactivity;
  - expands on hover or click (desktop), or **drag-up / tap** (touch);
  - the handle strip sits **above the safe area**: `bottom:
    calc(env(safe-area-inset-bottom) + 16px)` minimum, so the drag-up gesture
    never collides with the phone's app-exit swipe;
  - is keyboard/AT-safe: the bar expands on any focus within it, and the
    handle is a labeled button ("Show game bar");
  - reduced-motion/calm: no slide animation, instant show/hide.
- Dominion sets `statusBar: 'peek'` on both variants.

## 4 · Mobile designer light fixes

- Canvas touch targets (selection handles, resize grips, chips) ≥ 44px at any
  zoom.
- Double-tap an element → zoom-to-fit that element; double-tap empty canvas →
  Fit.
- The properties panel opens as a bottom sheet on ≤720px viewports (same
  breakpoint the runner uses).
- Deep touch-first editing (gesture redesign, phone-tested end-to-end) is
  explicitly deferred.

## Testing

- Sample-state builder: setup runs headlessly, deterministic snapshot, script
  error → graceful preview-off. Exactly one seal face visible against the
  sample state (pinned via `isDisplayVisible` like the runner tests).
- Selector groups: store read/write/subscribe + persistence key; max-1
  invariant; keyboard flip parity; `tabbed` migration idempotent and
  behavior-preserving (assert the migrated tree renders the same panels).
- Panel-switcher preset output passes `validateGameDef` with zero errors.
- Peek bar: expands on focus; handle bottom offset respects safe-area minimum;
  pinned default untouched for other games.
- Dominion: playthroughs green after chronicle removal + switcher migration;
  no `tabbed` flag remains in the def; `SEED_VERSION` bumped.
- Full suite + tsc + build green.

## Out of scope

Deep mobile editor UX; skin-aware (dominion-skin.css) rendering inside the
designer canvas — preview fidelity comes from evaluating state, not from
loading per-game CSS; new presets beyond Panel switcher; Slices B/C/D of the
authoring redesign (hover menus, attack warnings, durations).
