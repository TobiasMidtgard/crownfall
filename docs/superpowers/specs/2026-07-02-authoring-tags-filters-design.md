# Authoring redesign — Slice A: card types, tags & the guided condition builder

**Date:** 2026-07-02 · **Status:** approved design, ready for an implementation plan.

## Why

The Cardsmith engine is already capable (20 effect blocks, 24 expressions, 9
trigger events, response windows, per-card state), but authoring a *condition*
means hand-building a boolean expression tree. The pain case is the Dominion
Kingdom filter:

```
not( name = "Copper" or name = "Silver" or name = "Gold"
     or name = "Estate" or name = "Duchy" or name = "Province" or name = "Curse" )
```

There are no card **types/tags** as a real concept (Dominion fakes it with a
`dom_field_ctype` text field), and no **reusable filters**, so the same logic is
rebuilt everywhere. This slice replaces condition authoring with a guided,
pick-list builder over a real type/tag vocabulary, with a small named-filter
library. It is the foundation later slices (hover menus, attack warnings,
durations, new card types) build on.

## Decisions (settled with the user)

1. **Primary type + tags.** A card has exactly one **type** (drives category and
   accent color) plus any number of **tags** — a real "type line" (*Action –
   Attack*).
2. **The guided builder becomes the editing surface** for conditions — the raw
   boolean-tree editor is retired from condition slots. It stays a friendly
   editor over the engine's existing expression format (no engine rewrite).
3. **Reusable named filters** are in from the start.

## Architecture

Conditions remain `Expr` values the engine already evaluates — nothing about
runtime evaluation changes structurally. The redesign is **additive data** +
**a new editor** + **a few new leaf expression kinds** so types/tags/filters
are first-class:

### Schema additions (`src/shared/types.ts`)

- `GameDef.cardTypes?: CardTypeDef[]` — `{ id, name, color }`. A card's single
  category; `color` is a CSS color for the card's accent.
- `GameDef.cardTags?: TagDef[]` — `{ id, name }`. Multi-assign labels.
- `GameDef.filters?: NamedFilterDef[]` — `{ id, name, condition: Expr }`. The
  reusable library; `condition` is authored with `$card` bound.
- `CardDef.typeId?: Id | null` and `CardDef.tags?: Id[]` — per-card assignment.

All optional → every existing `GameDef` (schemaVersion 2) loads unchanged; a
card with no `typeId`/`tags` simply has none. `migrateGameDef` seeds the three
lists to `[]` when absent (pure, idempotent); no version bump required.

### New expression kinds (leaf reads over the new data)

Added to the `Expr` union, `src/engine/expr.ts` evaluator, `registry.ts`
metadata, and `exprToText.ts` sentences:

- `cardTypeIs { card: Expr; typeId: Id }` → boolean (`card`'s `typeId` equals).
- `cardHasTag { card: Expr; tagId: Id }` → boolean (`tagId` ∈ `card.tags`).
- `filterRef { filterId: Id; card: Expr }` → boolean — evaluate the named
  filter's `condition` with `$card` bound to `card`. **Cycle-guarded:** the
  evaluator tracks a resolving-filter set on the eval context; re-entering a
  filter already on the stack throws a caught script error and yields `false`,
  and `validateGameDef` reports the cycle at author time.

These are pure, deterministic, and consume no RNG. `contains` (already present)
still covers multi-word text fields for legacy defs.

## The guided condition builder (`src/editor/blocks/ConditionBuilder.tsx`, new)

Replaces `ExpressionEditor` in every **condition** slot: action legality
(`ActionsTab`), trigger condition (`RulesTab`), ability condition
(`AbilitiesEditor`), card-slice display `cardFilter` and element `visible`
(`PropertiesPanel`), and `CardSelector.filter` / choice filters (`slots.tsx`).

**Shape.** A condition is a group: **all of** / **any of** / **none of** a list
of rows; a row is either a leaf clause or a nested group. Each leaf is
*subject + predicate + value* rendered as a sentence with pick-list chips, and a
plain-English readback (via `exprToText`) shows under the group.

**Clause vocabulary** (covers the full useful condition space, so no raw escape
hatch is needed):

- Card, when `$card` is in scope: **is a** [type]; **has tag** [tag]; its
  **[field]** [is / is not / at most / at least / greater than / less than]
  [number or text]; its **name is one of** [name chips]; **matches** [named
  filter].
- Gameplay, always: it's the **[phase]** phase; a **[variable]** [compare]
  [value]; a **[zone]** holds [compare] [n] cards **matching** [sub-condition];
  **turn number** [compare] [n].
- Structural: nested **all / any / none** group; **not** wraps a single clause.

**Compilation.** Each row maps to the existing `Expr` primitives
(`cardTypeIs`/`cardHasTag`/`filterRef`/`compare`/`logic`/`not`/`countCards`/
`getVar`/`phaseIs`/`cardField`/…). The builder both **writes** these and
**parses** an existing `Expr` back into rows.

**Legacy / unrepresentable exprs.** Any `Expr` the parser recognizes renders as
rows. Anything outside the builder's vocabulary (e.g. a value-math expression
nested inside a condition from a hand-authored legacy def) renders as a single
**read-only "advanced condition" row** showing its `exprToText` sentence, with a
"replace" affordance to clear and rebuild it. This honors "no raw editor"
without ever corrupting or dropping existing data.

**Context-awareness.** The available subjects depend on the bindings the slot
provides (the same `bindings` prop `ExpressionEditor` already receives): the
card clauses appear only where `$card` is bound; `$player`/`$owner`/`$viewer`
gate their rows likewise.

## The two list editors

- **Types & tags** — a panel (sibling of the Variables tab) to add / rename /
  recolor types and add / rename tags, mirroring `VariablesTab`'s list UX.
  Deleting a type/tag warns if any card or filter references it.
- **Filters** — a panel listing named filters; each row's condition is edited
  with the very same `ConditionBuilder`. New filter → author its condition →
  reference it anywhere via the "matches [filter]" clause.

**Card designer** (`src/designer`): the card editor gains a **type**
single-select and a **tags** multi-select, populated from the game's lists.

## Scope boundary

This slice replaces raw authoring for **conditions** (boolean yes/no filters).
**Value** expressions *inside* effect blocks (numbers/cards, e.g. "gain a card
costing up to *$card cost + 2*") keep the existing node/block editor — a
different surface, not the boolean tree, and the concern of later effect-focused
slices. Runtime type→accent-color rendering is a small nice-to-have noted for
implementation but not required for this slice's success.

## Dominion migration (the proof)

Rebuild the hall's `dominion-crownfall` def (`src/forge/dominionGame.ts` +
`src/examples/dominion.ts` template) onto the new system:

- Define types **Treasure, Victory, Curse, Action, Reaction** (colors = the
  card-type palette already in the skin) and tags **Attack, Kingdom, Basic,
  Duration**(reserved). Assign per card: Copper/Silver/Gold → Treasure;
  Estate/Duchy/Province → Victory; Curse → Curse; Militia/Witch → Action +
  Attack; Moat → Action + Reaction; the rest → Action; kingdom cards get the
  Kingdom tag, basics the Basic tag.
- Retire `dom_field_ctype` as a filter key (keep a display-only type line via
  the existing `dom_field_kind`). Rebuild every condition through the builder:
  the Kingdom slice filter becomes "card **has tag** Kingdom" (or "**is not**
  Basic"); `IS_TREASURE`/`IS_ACTION_CARD`/Moat/Militia legality become type/tag
  clauses; add a named filter **The basic cards**.
- Bump `SEED_VERSION` so stored copies re-seed. All three kingdom-set
  playthroughs must still complete with identical outcomes (semantics
  preserved — only the *authoring* of the same conditions changes).

Other examples (MTG, YGO, Hearts, Clash, War, Crazy Eights) are **untouched**:
their field-based conditions still evaluate, and they simply have no types/tags.

## Testing

- Engine: `cardTypeIs` / `cardHasTag` / `filterRef` evaluation; filter-cycle
  rejection (author-time validate + runtime caught-error → false); `migrate`
  seeds the three lists idempotently.
- Editor: `ConditionBuilder` round-trips every clause it can express (compile →
  parse → identical rows); unrepresentable expr → read-only advanced row (no
  data loss).
- Def: Dominion validates with zero errors/warnings; the three seeded
  playthroughs finish with unchanged winners/scores/turn counts; the Kingdom
  slice still shows exactly the ten kingdom piles.
- Full suite + `tsc` + build stay green.

## File-size note (targeted, not a refactor)

`ConditionBuilder` is a **new** file, not an addition to the already-large
`ExpressionEditor.tsx` (647 lines) or `PropertiesPanel.tsx` (1820). Per-clause
row editors live in small sibling components so no single file balloons.

## Out of scope (later slices)

Hover / long-press context menus (B), authorable attack warnings + reaction
prompts (C), Duration cards + reusable card-behavior bundles + new card types
(D). Tags defined here (Attack, Reaction, Duration) are the vocabulary those
slices key off.
