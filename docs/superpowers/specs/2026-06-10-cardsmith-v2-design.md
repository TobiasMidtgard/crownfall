# Cardsmith v2 — Node graphs, interrupts, table layouts

**Date:** 2026-06-10
**Status:** Approved (user chose: graph-only scripting; full interrupt systems)
**Goal:** Recreate Dominion, Magic: The Gathering, and Yu-Gi-Oh as built-in
games, with an Unreal-Blueprints-style node graph as THE scripting surface and
a per-game table (UI) layout editor.

## 1. Node-graph script editor (replaces the block stack editor)

- **Same data, new view.** Scripts remain the existing `Block[]`/`Expr` trees —
  the engine, validation, examples, and storage formats do not change. The
  graph is a deterministic auto-laid-out projection: exec flow runs left to
  right; each block is an exec node; expression trees hang off their consumer's
  input pins as pure data nodes.
- **Pins.** Exec pins (white, in: left / out: right). Container blocks expose
  multiple exec outs: `If` → *Then / Else / After*; `Repeat`, `For Each …` →
  *Body / After* (UE's ForEach = Loop Body / Completed). The *After* pin keeps
  tree semantics (no goto-graphs). Data pins are typed (number, text, boolean,
  card, player, zone) and color-coded.
- **Editing.** Drag (mouse) or tap-tap (touch) to connect pins; dropping a wire
  on empty canvas opens a search/category node picker filtered to compatible
  pins. Literal fields (numbers, text, zone selects) render inline on node
  bodies. Node ops: add, delete, duplicate, disconnect wire. Canvas: pan, pinch
  /wheel zoom, fit-view; minimap on desktop.
- **Fan-out = UE pure-node semantics.** A data output wired to N inputs is
  compiled by duplicating the subtree per consumer — identical to Blueprints
  re-evaluating pure nodes per use (matters for `random`). Layout is recomputed
  from the tree, so duplicated chains display duplicated; a hint explains this
  the first time. Free node placement (with persisted positions) is a later
  follow-up via an engine-ignored `editorMeta` section.
- **Kept:** the chip-based ExpressionEditor for standalone single expressions
  (action legality, trigger/ability conditions, end conditions). Graphs are for
  scripts; a one-expression graph canvas would be worse on every device.
- The GraphScriptEditor keeps BlockScriptEditor's exact props contract
  (`{ def, value: Block[], onChange, bindings }`) so all call sites are
  unchanged; the old stacked-block component is deleted.

## 2. Interrupt system (the stack / chains / reactions)

One engine-level mechanism serves MTG's stack, YGO's chains, and Dominion
reactions:

- **Stacked actions.** `ActionDef` gains `stacked?: boolean` and
  `announce?: Block[]`. Performing a stacked action runs `announce`
  immediately (pay costs, move the card to a stack zone), pushes
  `{ script, bindingsSnapshot, sourceCard }` onto the engine's pending stack,
  and opens a **response window** instead of resolving.
- **Stacked triggers.** `TriggerDef`/`AbilityDef` gain `stacked?: boolean` —
  their scripts push onto the stack instead of running inline (MTG triggered
  abilities). Default `false`: every existing game behaves exactly as before.
- **Response windows / priority.** During a window, `getLegalMoves` offers only
  actions with `speed: 'response'` (new ActionDef field, default `'normal'`)
  plus a built-in **Pass** move (`{ actionId: '__pass' }`). Priority order:
  turn player first, then seating order; any action resets the pass count;
  all-pass → pop + resolve the top stack entry (LIFO) with its snapshot
  bindings → settle → if the stack is non-empty, reopen the window, else
  resume normal play. Normal-speed actions are never offered while the stack
  is non-empty.
- **New blocks/exprs.** Block `cancelTopEffect { cardTo: zoneId | null }`
  (counter/negate: drops the top entry, moving its card if any). Exprs
  `stackSize`, `stackTopCard` (→ card or null, so spell-speed rules are just
  legality expressions over card fields).
- **Multi-select choice.** Block `chooseCards { who, from, filter, min, max,
  prompt, revealed, body }` — runs `body` once per picked card ($card bound,
  pick order), avoiding list-valued bindings entirely. Used for tributes,
  discard-to-N, attacker/blocker declaration, deck searches (`revealed: true`
  shows face-down candidates to the chooser only). Single-card `choose` also
  gains `revealed`.
- **Zone capacity.** `ZoneDef.capacity?: number` — moves beyond capacity are
  skipped with a script warning; legality can read `zoneCount < capacity`.
- **Card orientation & badges.** `GameDef.cardState?: { rotateVar?: varId;
  badgeVars?: varId[] }` — per-card boolean rotates the rendered card 90°
  (tap / defense position); badge vars render as chips on the card. Engine
  ignores it; runner renders it; setVar drives it.

The engine-semantics doc gains a "Stack & priority" chapter pinning ordering,
snapshot semantics, and budget rules; the engine test suite grows matching
coverage (announce/resolve split, LIFO, pass-reset, cancel, snapshot bindings,
chooseCards min/max + revealed, capacity).

## 3. Table layout editor ("game UI editor")

- `GameDef.tableLayout?` (optional — absent ⇒ today's auto-layout):
  `{ background; board: Record<zoneId, Rect>; seat: Record<zoneId, Rect>;
  cardScale per zone; showName/showCount flags }` where `Rect` is % of the
  board area (shared zones) or of a seat strip (perPlayer zones, instantiated
  per player; opponents' strips rendered rotated/compacted).
- Editor: a new "Table" tab — canvas with drag/resize (same pointer machinery
  as the card template designer), seat-strip preview for min/max players,
  per-zone inspector, background picker, "reset to auto" button.
- Runner: positions zones per layout when present; the current player's seat
  strip docks at the bottom; everything stays % based so phone and desktop
  share layouts.

## 4. Example games (built-in, real names, paraphrased effect text, no copied art)

- **Dominion** — base-set economy: one shared Supply zone (grid), Copper/Silver
  /Gold, Estate/Duchy/Province, ~8 kingdom cards incl. Militia (attack via the
  stack) and Moat (response reveal → immunity), actions/buys/coins as
  variables, cleanup + reshuffle triggers, VP recount trigger, 3-pile/Province
  end conditions.
- **Magic: The Gathering** — two 30-card mono/duo-color decks: lands (tap for
  mana via rotateVar), creatures (summoning sickness badge, combat with
  sequential blocker pairing), sorceries, instants + Counterspell
  (`cancelTopEffect`) on the stack; 20 life; fatigue rule for empty decks.
- **Yu-Gi-Oh** — classic duel: 5-slot monster/spell-trap zones (capacity),
  normal summon once per turn, tribute summon via `chooseCards`, attack/defense
  positions (rotateVar) and face-down sets, battle phase with position rules,
  traps set face-down activatable at response speed, chains via the stack;
  8000 LP.

Each ships with deterministic integration tests (validation clean, seeded
random playthroughs reach a finish, interrupt paths exercised: a counter
actually counters, a trap chains off an attack, Moat blanks Militia).

## Build order

1. Land + verify the in-flight v1 review fixes (runner / editor agents).
2. Engine: interrupt system + chooseCards + capacity + cardState + new exprs;
   semantics doc + tests first-class.
3. Graph editor (replaces BlockScriptEditor, same props).
4. Table layout editor + runner layout/orientation/badge rendering.
5. The three games + integration tests.
6. Full verification chain + browser pass on mobile & desktop sizes.

## Out of scope (unchanged or explicitly deferred)

Networked play; free node placement with persisted positions; MTG layers/
replacement effects and YGO once-per-chain edge rules beyond what the stack
expresses; copied card art or rules text.
