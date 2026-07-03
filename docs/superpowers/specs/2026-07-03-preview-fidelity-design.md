# Designer preview fidelity — render the real runner, full-bleed stage

**Date:** 2026-07-03 · **Status:** approved direction (user), building.

## Problem (user, on the Dominion mobile table)

The table-designer's live preview does not look like the in-game table: the
phase seal is a different size and shape, the carousel renders as a static grid
(not a scroll-snap carousel), and the bottom bar reserves its own strip so the
authored screen doesn't fill the port. Root cause (confirmed): the designer
re-implements every element with bespoke `tt-*` markup and loads **no** per-game
skin, and the runner's `.rn-table` is a 4-row grid whose stage is only the
`minmax(0,1fr)` row (the action bar row shrinks it).

## Fix

Two coordinated changes so preview and game are the **same components at the
same size**.

### 1 · Runner: full-bleed screen stage, chrome overlays (screen-layout mode only)

- In screen-layout mode the authored screen fills the whole `.rn-table`; the
  action bar (`.rn-bottom`) becomes a bottom **overlay** (floats above the
  status bar, only occupies space it needs, `pointer-events` on its buttons
  only) instead of a reserved grid row. The stage row expands to fill it.
- Status bar: **peek** already overlays (unchanged); **pinned** stays a
  reserved row (so it never covers the bottom of a pinned-bar game's screen).
- Automatic-layout games (no `screenLayout`) keep the existing 4-row grid
  untouched.
- Net: a `peek` screen game (Dominion) → stage = full viewport. A `pinned`
  screen game (MTG/YGO examples) → stage = viewport minus the status row, with
  the action bar overlaid.

### 2 · Designer: render the real ScreenRenderer as the preview visual layer

- With preview ON, mount the runner's real `ScreenRenderer` as a
  `pointer-events: none` background layer, wrapped in `.forge-root` plus the
  same skin class the host applies at play time — `.dominion-skin` when
  `def.meta.id === DOMINION_GAME_ID` (mirrors ForgeApp's play route; there is
  one skinned game). It draws the true seal (notched crimson plate), the real
  `.rn-carousel` scroll-snap tiles, phase-aware glow, everything.
- Feed it a synthetic **read-only** `TableCtx` from the wave-1 sample state:
  `state` = the sample snapshot, `viewerId` = sample seat p0, `cardMoves` /
  `zoneMoves` = empty (nothing legal in the designer), a fresh
  `CardRectRegistry` + `pileMemory`, no-op `onCardTap`/`onZoneTap`, `accent`
  from `meta.accentColor`. Pass the currently-edited variant as the `screen`
  prop (do NOT let ScreenRenderer's own `useNarrowViewport` pick it).
- Keep the existing editor interaction layer exactly as is — selection
  outlines, drag/resize handles, ghosts, guides — but in preview mode its
  `.tt-el` element **bodies render empty/transparent** (hit boxes + handles
  only), so the ScreenRenderer shows through and the editor still selects,
  drags and resizes. Selector clicks continue to write the selection store,
  which re-renders both layers.
- Stage sizing must match the runner so the overlay boxes align with the
  rendered elements: the frame reserves the status-bar height only for
  `pinned` defs (nothing for `peek`, matching the full-bleed runner). Aspect
  handling unchanged (aspect null stretches to the frame; a numeric aspect
  letterboxes identically to the runner's `computeStage`).
- Preview OFF = today's editable `tt-*` design view, unchanged.

## Scope / safety

Automatic-layout runner behavior untouched; pinned-bar screen games keep their
status row; the editor's selection/manipulation code is unchanged (only the
element-body content is swapped for the real render in preview). Sample-state
failure (setup errors) → preview stays off with the existing notice. Extract
the ScreenRenderer mount + synthetic ctx into a new
`src/editor/tabs/table/PreviewStage.tsx` so `ScreenCanvas.tsx` doesn't grow.

## Tests / verify

Existing suite stays green (this is presentation). Live E2E: element handle
boxes align with the rendered seal/tiles; the seal is the notched crimson
plate; the mobile supply is a real scroll-snap carousel; the stage fills the
port with no bottom-bar strip; runner unchanged for the MTG/YGO pinned-bar
example screens.
