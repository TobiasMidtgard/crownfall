# Landscape engine — design (2026-07-17)

The sideboard system that unlocks Adventures (Events), Empires (Landmarks + more Events),
Renaissance (Projects), Menagerie (Ways), and later Plunder (Traits) / Rising Sun
(Prophecies). Written while wave 5/6 (Alchemy + Menagerie kingdom) authors.

## Core idea: landscapes are cards in a shared visible zone

The engine already speaks cards, zones, actions, triggers. A landscape is a CARD:

- New shared zone `dom_zone_landscapes` (visibility all, layout row, area center).
  A wide-aspect card template `dom_tpl_landscape` (fields: cost, text, kind line).
- All landscape card defs ship in the def; a `dom_deck_landscapes` spawns them into a
  hidden `dom_zone_landscape_stock`. `pickLandscapes(def, names)` (pure transform,
  pickKingdom's shape) promotes the chosen 0–2 into `dom_zone_landscapes` at setup.
- Every landscape's triggers/VP terms/actions ship ALWAYS but are gated on
  `countCards(zone(LANDSCAPES), nameIs('Obelisk')) > 0` — presence in the zone is the
  on-switch, exactly like kingdom piles in the supply. No transform re-wiring.

## Per-kind mechanics

- **Event** (buy-phase, repeatable): core action `dom_action_buy_event`, target = a card
  in the landscapes zone, legality `isEvent && BUYS>0 && coins+DISCOUNT >= cost`.
  Script: pay, −1 buy, `triggerAbilities(card, enterZone INPLAY)` WITHOUT moving the
  card (the Captain/playAgain idiom) — each Event carries its effect as an onPlay
  ability. Buy buttons ride the existing pile-click surface (zone element on the strip).
- **Project** (buy once, permanent): per-project per-player flag var. Same buy action
  family (`dom_action_buy_project`), legality adds `flag == 0`; script sets it to 1.
  The project's standing effect = its module triggers gated on the flag. Status chips
  show owned projects (bankChip pattern, visible when flag > 0).
- **Landmark** (passive scoring): buildVpTerms entries gated on presence; when-scoring
  hooks (Obelisk names a pile → per-game var set at setup by the transform).
- **Way** (alternative play): core action `dom_action_play_way`, legality
  `wayPresent && isAction(card in hand) && ACTIONS>0`. Script: −1 action, move the card
  to INPLAY tagged 'play' BUT fire `triggerAbilities` on the WAY card instead of the
  played card (suppressing the card's own onPlay: move UNTAGGED then trigger the Way —
  tag-filtered onPlay abilities won't fire on an untagged move; cleanup still sweeps
  INPLAY by zone, not tag). Way of the Horse/Butterfly return-to-pile are plain moves.
- **Traits / Prophecies**: deferred — Traits need per-pile attachment at setup,
  Prophecies need the sun-token countdown (global var + triggers; likely easy) — both
  designed after the four core kinds ship.

## Setup & UI

- SetupScreen: a "Landscapes" section under the kingdom picker — catalog chips by kind,
  pick up to 2 (official deal is ≤2 total across kinds). `PlayPage.runDef` applies
  `pickLandscapes` after `pickKingdom` (order: kingdom → landscapes → prosperity).
- Table: a landscape strip (desktop: right of the kingdom grid or above the status
  strip; mobile: a fourth supply-switcher tab), visible when the zone holds cards.
  Events/Projects get keyboard-free click-to-buy via the existing zone action surface.
- Codex: landscapes listed under their set with the wide template.

## Testing invariants

- pickLandscapes pure/idempotent, unknown-name throw, watcher untouched (landscapes are
  not piles — never counted by the three-pile rule).
- Event buy: legality gates (buys/coins), effect fires, repeatable same turn.
- Project: once per player, flag persists, standing trigger works, second buy illegal.
- Way: played card's own ability suppressed, Way effect fires, cleanup discards, Throne
  Room interaction documented.
- Central pins: TOTAL_CARDS grows by landscape count; catalog excludes landscapes
  (new LANDSCAPE_NAME_SET); chips unaffected.

## Set order once the engine lands

1. Menagerie Ways (20) — smallest scripts, kingdom already shipped by wave 6.
2. Renaissance Projects (20) + its 25 kingdom cards (Villagers machinery already live).
3. Adventures Events (20) + Tavern mat/tokens for the kingdom cards (reserve-with-call
   = Church-mat idiom + call actions).
4. Empires Landmarks (21) + Events (13); Debt + split piles designed alongside.
5. Plunder Traits, Rising Sun Prophecies (with their sets).
