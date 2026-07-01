# Cardsmith — single-page game screen builder

**Date:** 2026-06-11
**Status:** Approved (user-directed)
**Replaces:** the board + seat-strip table layout (v3) with one full-screen design.

## What the user asked for

A "super advanced webpage builder" for the whole game screen: add zones from
inside the editor, grids with selectable rows × columns + spacing + borders,
composite groups (e.g. button + text + phase-dot indicator as one element),
effects (card-move animations, general animations), conditional hiding of
elements until needed, no seat strip — a single-page editor for the entire
game.

## Model: `GameDef.screenLayout` — an ordered element tree

The screen is designed from the VIEWER's perspective. Coordinates are % of
the parent (screen or group). Paint order = array order (back → front).

Element kinds (`ScreenElement`, discriminated union, all sharing id/name/rect/
style/visible/reveal):

- **zone** — renders a game zone instance; `seat: 'shared' | 'viewer' |
  'opp1' | 'opp2' | 'opp3'` picks the instance relative to the viewer
  (seating order). Per-zone `cardScale`, `showName`, `showCount`, `padding`,
  `gap`, and **`rows` × `columns`** for grid placement.
- **text** — static label (font size % of screen width, color, align, bold).
- **varText** — live variable readout (`varId` + `seat`), optional label
  prefix ("Life: 20").
- **button** — bound to a none-target action id (incl. the built-in pass);
  taps perform the action; renders disabled when it isn't currently legal
  for the viewer. The automatic action bar only shows none-target moves that
  have NO button bound to them.
- **phaseDots** — the phase indicator: one dot per phase, active phase
  highlighted, optional names.
- **group** — composite container with `children: ScreenElement[]` (nested,
  recursive); moves/hides/animates as one element.

Shared:

- `visible: Expr | null` — a DISPLAY EXPRESSION evaluated read-only against
  the public GameState with `$viewer` bound to the viewing player. The engine
  exports `evalDisplayExpr(def, state, expr, viewerId)` (pure, no RNG
  consumption, silent errors → falsy). Hidden elements mount/unmount with the
  element's `reveal` transition.
- `reveal: 'none' | 'fade' | 'scale' | 'slide-up' | 'slide-down'`.
- `style: LayoutStyle` (border color/width/style/radius + background).

`ScreenLayout = { background?, aspect? (null = fill viewport), elements }`.

## Animations

- **Card movement**: a runner-wide FLIP layer — card instance DOM rects are
  captured across state changes; moved cards tween (~220 ms) from old to new
  rect, face state crossfades. Works in automatic AND custom layouts.
  Honors `prefers-reduced-motion`.
- **Reveal transitions**: visibility toggles animate per the element's
  `reveal` (exit plays before unmount).

## Editor (the "webpage builder")

Evolves the v3 workspace: single full-screen canvas (aspect presets 16:9 /
9:16 / fill preview), element palette (Zone — existing or **create a new game
zone inline** (name/owner/visibility/layout, appended to `def.zones`), Text,
Variable, Button, Phase dots, Group), shift-click **multi-select** with
Group/Ungroup, nested Layers tree, Properties incl. rows×columns steppers,
visibility via the ExpressionEditor (bindings `['$viewer']`), reveal pickers,
deck composition (kept from v3). Seat-strip canvas removed.

## Compatibility & runner

- Old `tableLayout` docs are migrated best-effort to `screenLayout` at load/
  import (board zones → shared elements; seat zones → viewer + opp1
  copies); the deprecated field and v3 renderer are then removed.
- No `screenLayout` ⇒ today's automatic runner layout (unchanged).
- System overlays stay: choice sheets, hotseat curtain, stack panel, priority
  banner, log drawer, game-over.
- A custom Yu-Gi-Oh **duel mat** ships as the showcase: monster/spell grids
  (rows × columns), LP varText per seat, phase buttons + dots, traps hidden
  until set, card-move animation across the mat.
