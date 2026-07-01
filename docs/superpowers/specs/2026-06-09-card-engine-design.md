# Cardsmith — Visual Scripting Card Game Engine

**Date:** 2026-06-09
**Status:** Approved (autonomous build; decisions made per user's standing delegation)

## Goal

A single web app where anyone can **design**, **script**, and **play** nearly any card game — trick-taking, shedding, deck-builders, TCG-style battlers, War-style automatic games — on both mobile and PC. No programming required: rules and card effects are written in a visual block language.

## Approaches considered

| Decision | Options | Pick & why |
|---|---|---|
| Platform | Native (Unity/Godot), Electron, **Web app** | Web: one codebase serves PC + mobile browsers, zero install, matches the user's TS/React/Vite expertise. |
| Visual scripting | Node graph with wires, **Scratch-like stacked blocks** | Blocks stack vertically and edit via tap dialogs — usable on a phone. Wire graphs need precision dragging and lots of screen. |
| Rules execution | Code generation, **JSON-tree interpreter** | Interpreted definitions are serializable, sandboxed, save/load/share as one JSON file, and pause cleanly mid-script for player choices. |
| Multiplayer | Networked server, **hotseat + AI** | Hotseat pass-and-play plus a legal-move AI makes every game fully playable with no backend. Networking is a clean later addition because the engine is already deterministic + snapshot-based. |

## Architecture

```
src/shared/    types.ts — the entire GameDef schema (the contract everything shares)
src/engine/    pure TS, no React: state init, interpreter, expressions, legality, triggers, RNG
src/blocks/    block metadata registry (labels, colors, sockets) driving editor + serialization
src/components/ shared UI: CardView (renders a card from template+data everywhere)
src/designer/  card template editor + card data editor
src/editor/    visual block script editor + game structure editors (zones, vars, phases, actions)
src/runner/    play screen: table auto-layout, choices, hotseat, AI
src/examples/  built-in GameDefs: War, Crazy Eights, Hearts, mini-TCG
src/storage/   localStorage persistence + JSON file export/import
```

**One game = one `GameDef` JSON document.** The engine is a pure interpreter over it; the editors are forms over it; the runner is a view over engine state.

## GameDef schema (the heart)

- **meta** — name, description, player count range.
- **variables** — typed (number/string/boolean), scoped `global | perPlayer | perCard`, with initial values. (Score, trump suit, mana, life — all just variables.)
- **zones** — `shared | perPlayer`; visibility `all | owner | none | topCard`; layout hint `stack | fan | row | grid`; table area hint. Deck, hand, discard, trick pile, battlefield — all just zones.
- **decks** — generators: `standard52` (with optional jokers / stripped ranks) or `custom` (cards listed with counts). Standard cards get built-in `suit`/`rank` fields.
- **cardTemplates + cards** — visual template (layered elements bound to fields) + per-card field values + triggered **abilities** (scripts).
- **flow** — `setup` script, ordered **phases** each with an optional script and a set of enabled player actions, turn order, and **end conditions** (expression → winner expression / ranking).
- **actions** — what a player may do: each has a *legality expression* (evaluated per candidate card/target) and an *effect script*. The engine enumerates legal moves itself → drives both UI highlighting and the AI.
- **triggers** — `on event` + optional condition + script (onCardEnter zone, onTurnStart, onVarChanged, …).

## Block language

Serializable discriminated unions, two kinds:

- **Statements:** moveCards, shuffle, deal, setVar/changeVar, if/else, repeat, forEachPlayer, forEachCard, choose (card/option/player — pauses for input), endPhase, endTurn, endGame, setNextPlayer, announce.
- **Expressions:** literals, variable refs, zoneCount, cardField, arithmetic/comparison/logic, currentPlayer, context bindings (`$card`, `$player`, `$choice`, `$event`), suit/rank helpers, highest/lowest-in-zone.

Execution context carries a binding stack so loops and choices compose. The interpreter is async: `choose` suspends until a ChoiceProvider (human UI or AI) answers. Seeded RNG (mulberry32) makes runs deterministic and testable.

## Card designer

Template editor: card aspect, background, layered elements (text bound to a field, static label, image slot, stat chip, icon row) positioned/sized by drag or numeric inputs. Card editor: spreadsheet-ish field entry, deck count, ability scripts via the block editor. One `CardView` component renders template+data identically in designer, editor previews, and on the table.

## Runner

Generic auto-layout: opponents' zones top, shared zones center, active player's bottom; hand as a fan. Tap a card → legal actions appear as buttons; illegal cards are dimmed (legality comes free from the engine). Choices arrive as bottom sheets. Hotseat shows a pass-device curtain between turns when hidden info exists. AI plays uniformly-random legal moves with a small delay. Everything pointer-events based; 44px+ touch targets.

## Persistence

Games auto-save to localStorage; export/import as `.json` files. Built-in examples load read-only and can be cloned for editing.

## Error handling

- Editors validate references (zone/var/card ids) and show inline warnings; a game with errors can still be saved, not played.
- The interpreter guards against infinite loops (instruction budget per turn) and reports script errors with the block path, never crashing the app.

## Testing

Vitest on the engine: unit tests per statement/expression, legality tests, and full deterministic playthroughs of the example games using scripted choice providers. Verification chain: `npx tsc --noEmit`, `npm test -- --run`, `npm run build`.

## Out of scope (v1)

Networked multiplayer, accounts/sharing servers, image asset libraries (images via URL/upload-to-dataURL only), undo during play, non-card components (boards, dice — though variables cover counters).
