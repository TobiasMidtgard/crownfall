# Cardsmith — reference-screen fidelity (DominionGameTable + Crownfall)

**Date:** 2026-06-11 · **Status:** Approved (user-directed)
**Goal:** the user's two reference projects' game screens must be reproducible
with the canvas editor alone: DominionGameTable's war table + animations,
Crownfall's mobile friendliness. Research reports: workflow wf_02790d53.

## Capability gaps being closed

### 1. Zone display upgrades (zone element)
- `display?: 'cards' | 'piles'` — piles groups the zone's cards by card def:
  one pile per def showing the top card, a "× N" count badge, and an optional
  `pileBadgeField` (field id rendered as a corner badge — the cost lozenge).
  Pile grids honor rows/columns/gap/padding. Legal-move glow applies per pile
  (any legal card in the pile lights it).
- `collapseDuplicates?: boolean` — hand-style zones merge equal cards into
  one element with a × N badge and layered shadow offsets (DGT hand).
- Fan quality: fan zones render per-card rotation + parabolic arc from the
  index (i − (n−1)/2: ~4°/step rotate, dip, pressed/hover lift) — automatic,
  with `fanAngle?: number` to tune (0 = flat).

### 2. Motion system
- `ScreenLayout.motion?: { flightMs?: number; arc?: number; spin?: number;
  staggerMs?: number }` (defaults 430 / 46 / 4 / 55). Card flights become the
  DGT primitive: 3-keyframe WAAPI clone — source rect → midpoint raised by
  `arc`px at half spin → target rect at full spin, scale interpolated between
  source/target sizes, ease-out-expo, destination veiled until landing.
  Grouped moves in one update stagger by `staggerMs`.
- Zone `arriveEffect?: 'none' | 'burn'` — burn plays the DGT trash
  choreography on arrival: char keyframes (brightness flash → darken →
  collapse, ~620ms) + 12-16 rising ember particles (30% gold).
- varText `ticker?: boolean` (default true) — value changes bump
  (scale 1.35 + accent flash @30%, 0.45s).
- Element `onChangeAnim?: 'none' | 'stamp' | 'flash'` — a retriggerable
  one-shot (scale 1.07 + brightness flash) whenever the element's resolved
  text/state changes (the phase seal).
- Runner speed control in the status bar: 1× / 2× / instant (scales all
  durations + staggers; instant skips clones). `prefers-reduced-motion`
  collapses flights to fades (kept).

### 3. Per-breakpoint layouts (Crownfall mobile)
- `ScreenLayout.mobile?: { elements; background?; aspect?; scroll?: boolean }`
  — an alternate element tree used below 1024px (Crownfall's single JS
  breakpoint). `scroll: true` + numeric `aspect` make a tall page that
  scrolls vertically (Crownfall's stacked document-scroll column); otherwise
  fill/letterbox as today.
- Editor: a Desktop / Mobile variant toggle in the toolbar; "Start from
  desktop copy" seeding; everything else (palette, layers, properties) works
  on whichever variant is open.

### 4. New element capabilities
- `log` element kind — the chronicle: scrolling game log with entry-in
  animation and turn separators, placeable like any element.
- text element `parts?: (string | Expr)[]` — expression interpolation via
  the display evaluator ("TURN " + turnNumber, the seal's hint line);
  plain `text` remains for static labels.

### 5. Already covered (no change)
Expression states (playable/legal/selected/dim/region restyling), phase
dots (shape+line states with phaseIndex/phasePos), buttons gated by
legality, capacity badges, FLIP base layer, reveal anims, $viewer logic.

## Out of scope (documented, not built)
Keyboard-shortcut overlays/veils, hover preview rail, web-audio synth,
CSS-3D tilt, coverflow physics, score screens. These are app chrome, not
layout vocabulary.

## Showcase (the proof)
The Dominion example ships BOTH reference screens as authored layouts:
- **Desktop**: DGT war table — foe strip (deck/hand-backs/discard tallies),
  3-column supply (mini treasure/victory pile columns + 5×2 kingdom pile
  grid with cost badges), battlefield band (in-play row, action/buy/coin
  tickers, notched phase-seal group with stamp + phase dots), chronicle log
  rail, harbor (deck spot, fanned collapsing hand, discard showing its top
  card, trash zone with the burn).
- **Mobile** (<1024px): Crownfall-style stacked scroll column — compact foe
  strip, supply as horizontally scrollable pile rows, in-flow status band,
  full hand fan bottom.
Validation clean; integration tests assert layout invariants + state
expressions against live engine snapshots.
