# Cardsmith — reactive screen elements (states, shapes, lines, phase logic)

**Date:** 2026-06-11 · **Status:** Approved (user-directed) · Extends the
screen builder (same-day spec).

## What the user asked for

The table should be able to CHANGE depending on whose turn it is; replace the
canned phase-dots element with plain circles that carry author-defined logic
("has this phase passed / is it current / not yet"); lines and graphs to show
branching; dots that reset on turn end; more versatility (custom variables,
actions) — everything feeling like one tightly knitted engine.

## 1. Element STATES — the table reacts to the game

Every screen element gains `states?: ElementState[]`:

```
ElementState = { id, name, when: Expr, style?: LayoutStyle,
                 rect?: {x,y,w,h} | null }
```

The first state whose `when` holds (display evaluation, `$viewer` bound)
applies: its `style` merges over the element's base style, its `rect` (if
set) replaces the element's position/size. The runner animates the change
(CSS transitions on position, size and colors), so "enlarge my hand and glow
my field on MY turn" is two states with `current player = $viewer`. States
compose with `visible` (which still mounts/unmounts with the reveal anim).

## 2. Shapes & lines — build your own indicators and diagrams

- **shape**: `circle | rect | diamond | pill`, optional centered `label`
  (+fontSize); fill/border/radius come from `style` and react via states.
- **line**: a connector drawn inside the element's rect — `orient: 'h' | 'v'
  | 'down' (TL→BR) | 'up' (BL→TR)`, `thickness`, `dashed`, `arrow: none |
  end | both`; color = `style.borderColor`. Circles + lines + labels =
  phase tracks, branching flow diagrams, anything.
- The built-in `phaseDots` element kind is REMOVED. Old documents migrate to
  a generated phase-track group automatically.

## 3. Phase logic — new engine expressions (usable EVERYWHERE)

- `phaseIndex` → the current phase's index (0-based). Resets when the turn
  passes — so phase dots "reset on end turn" by construction.
- `phasePos(phaseId)` → the index of a phase in the turn order.

"Has been": `phaseIndex > phasePos(X)` · "is current": `==` · "not yet":
`<`. These are ordinary expressions — also valid in legality, triggers,
scripts — not a display-only gimmick.

## 4. Phase track template

A palette entry ("Phase track") inserts a ready-made GROUP: one labeled
circle per phase pre-wired with done/current states (accent fill when
current, dim when passed, outline when upcoming) joined by lines. Authors
then restyle/rearrange it like any other elements. The same generator powers
phaseDots migration. Generator lives in `src/shared/screenTemplates.ts`.

## 5. Tightly knitted: inline creation & cross-editing

- varText properties: "+ New variable" creates a variable without leaving
  the builder.
- button properties: "+ New action" (none-target) — and **Edit script…**
  opens the action's effect script in the node-graph editor inside a modal.
- zone elements already create zones/decks inline (kept).

## 6. Showcase

The Yu-Gi-Oh mat replaces its phaseDots with a generated phase track and
adds turn-reactive states (viewer field border glows on the viewer's turn;
opponent band dims while it's not their turn).
