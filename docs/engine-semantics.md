# Cardsmith engine semantics

Authoritative behavior spec for `src/engine`. The schema lives in
`src/shared/types.ts`; this document pins down every runtime behavior so the
engine, the example games, and the tests agree exactly.

## Lifecycle

`createEngine(def, opts)` → `start()`:

1. Create players `p0..pN-1` from `opts.playerNames`/`aiSeats`; init `perPlayer` vars from defs; init global vars.
2. Spawn decks, in definition order:
   - `standard52`: 52 cards (suits in order spades, hearts, diamonds, clubs; ranks 2..14), minus `excludeRanks`, plus `jokers` jokers (rank 15, suit `''`, rankName `'Joker'`, color `'black'`, isJoker true). Built-in fields per card: `suit`, `rank`, `rankName` (`'2'..'10','J','Q','K','A'`), `color` (`'red'` for hearts/diamonds), `name` (e.g. `"Q of hearts"`), `isJoker`.
   - `custom`: for each entry, `count` copies of the card def (fields copied; `name` field always present from def name; `templateId` set).
   - Target zone: the deck's `initialZone`. If that zone is `perPlayer`, EACH player's instance receives a full independent copy of the deck.
   - Cards spawn `faceUp: true` (zone visibility provides secrecy — see Visibility). `perCard` vars initialized on every instance.
   - If `deck.shuffle`, shuffle that zone (each per-player instance separately).
3. Run the `setup` script with `currentPlayerIdx = 0`, then drain events, then check end conditions.
4. Enter turn 1, phase 0 (run phase `onEnter`, fire `turnStart` + `phaseStart` events, honor phase mode).

`turnNumber` starts at 1 and increments every time the turn passes to the next player.

## Zones

- Zone instance keys: shared → `zoneId`; perPlayer → `zoneId:playerId`.
- `cardIds[0]` is the BOTTOM, last is the TOP.
- `ZoneRef.owner: null` resolves to the **contextual player**: the `$player` binding if set, else the current player. A `ZoneRef` to a shared zone ignores `owner`.

## Script execution

- Scripts run with a **binding frame stack**. Base bindings depend on context (see Triggers/Abilities/Actions). `forEachPlayer` binds `$player` (seating order, starting at current player); `forEachCard` binds `$card` (snapshot of matching ids taken before the loop); `choose` sets `$choice` in the current frame.
- **Control flow**: `endPhase`, `endTurn`, `endGame` stop the current script immediately (like a return); the transition itself happens after pending events drain. `endGame` wins over everything.
- **Budget**: at most 10 000 block executions and 50 event-drain rounds per "settle" (action / setup / transition). Exceeding it aborts the script with `onScriptError` and the game continues.
- Script errors (bad refs, type junk) report via `onScriptError` and skip the failing block; they never throw out of the engine.

## Blocks

- `moveCards`: resolve `from`/`to` instances; pick cards by selector; move as a group **preserving relative order** (source top stays on top when `toPosition: 'top'`; group goes under when `'bottom'`). `faceUp: null` keeps each card's facing. For `specific` selectors the card's *actual* current zone is used as the source (the `from` ref is advisory). Selectors: `top`/`bottom`/`random` take `count` (clamped to available); `filter` binds `$card` per candidate; `all` takes everything.
- **Move-cause tags**: `moveCards` (and `draw`) carry an optional `tag` (free-form string; canonical vocabulary `gain`/`buy`/`trash`/`discard`/`play`/`draw`/`cleanup`). The tag rides on the move's `cardEnterZone`/`cardLeaveZone` events (`null` for untagged moves): trigger `EventSpec`s and ability `tagFilter`s with a tag match only moves carrying exactly that tag; a null/absent filter matches any move. Scripts read the cause via the `$tag` binding. The engine also stamps `state.moveTags[cardId]` with each card's most recent move tag (rendering surface for per-tag flight tuning; never read back by rules).
- `draw { who, count, from, refillFrom, to, faceUp, tag }`: move `count` cards one at a time from the top of `from` to `to`. Whenever `from` is empty and `refillFrom` (optional) is not, ALL of `refillFrom` moves into `from` face-down (untagged move) and is shuffled with the game RNG, then drawing continues; stops early when both are empty. A refill ref resolving to the source instance is skipped. Each drawn card charges budget (like `deal`) and emits move events tagged `tag` (default `'draw'`). `who` (player expr, null = contextual) sets the contextual player for owner-less zone refs.
- `choosePile { who, from, filter, groupBy: 'def', prompt, optional, body }`: the (filtered, `$card` bound per candidate) zone's cards group into one pile per distinct identity — custom cards by `defId`, standard cards by name — in first-appearance order (bottom→top), each represented by its TOP copy. Asks `who` via a `'pile'` ChoiceRequest (`cardIds` = representatives, `counts` = pile sizes); the answer is a representative id (or null to decline when `optional`). `body` runs once with `$card` = the chosen representative. No piles: optional is silent, mandatory reports and skips. Groups are computed at ask time (no staging zone). The usual 3-retry/first-pile-fallback applies.
- `triggerAbilities { card, on: 'enterZone', zoneId }`: enqueue a **synthetic** `cardEnterZone` event for `zoneId` tagged `'play'` WITHOUT moving the card (`fromZoneId` = its current zone; `toOwner` = its holder's owner when it already sits in that zone, else the contextual player). It drains normally, so the card's enter-zone abilities re-fire, **global triggers watching that zone also fire** (it *is* "the card is played again"), and stacked abilities still stack; cascades are bounded by DRAIN_ROUNDS/STACK_CAP. A null card expr is a silent no-op; a non-card value or unknown zone reports and no-ops. No `cardLeaveZone` is emitted and `state.moveTags` is untouched.
- `shuffle`: Fisher-Yates with the game RNG.
- `deal`: from a shared (or resolved) zone, round-robin starting at the current player: one card from the top to each player's instance of `toZoneId`, repeated `count` times (each player gets `count` cards). Stops early when the source empties. Facing kept.
- `setVar`/`changeVar`: `target` (player expr for perPlayer, card expr for perCard) — when null, perPlayer uses contextual player, perCard uses `$card` then `$self` (error if neither bound). `changeVar` adds `by` numerically.
- `choose`: `who: null` = current player. Build candidates (card: zone+filter; player: all players, `includeSelf` toggles asker's own seat). **Empty candidates**: optional → `$choice = null`, continue; required → `$choice = null`, report script warning, continue (authors should guard with `zoneCount`/`countCards`). Answers are validated against the offered set; an invalid answer is re-requested (3 attempts, then first candidate).
- `announce`: join parts; expression parts that evaluate to a player id render as the player's name; a card instance id renders as the card's name. Append `{ turn, text }` to `state.log`.
- `flipCards`: set `faceUp` on selected cards in place.
- `setNextPlayer`: overrides who takes the next turn (consumed by the next turn transition).
- `if`/`repeat`/`forEachPlayer`/`forEachCard`: as expected; `repeat` count clamped to ≥0.

## Expressions

- Numeric ops coerce with `Number()`; `null` coerces to 0; `NaN` reports a script error and yields 0. `/` by 0 → 0 with script error. `compare` `==`/`!=` are value equality on primitives; `<` etc. numeric. `logic`/`not` use JS truthiness.
- `compare` op `'contains'`: **whole-word membership** for multi-value text fields — true when the RIGHT value equals one of the whitespace-separated words of the LEFT value (case-sensitive; the left is trimmed and split on runs of whitespace). `"action attack" contains "action"` → true; `contains "act"` → false. Non-strings coerce via `String()`; null on either side → false.
- `sumCards { zone, fieldId, filter }`: sum of a numeric card field over a zone's (filtered, `$card` bound per candidate) cards. Non-numeric / missing values contribute 0; missing zone → 0.
- `cardField` on a null card → null. Unknown field → null.
- `topCard` of empty zone → null. `bestCard`: numeric compare of `fieldId` among (filtered) cards; empty → null; ties → the one nearest the top.
- `countCards`: filter binds `$card` per candidate (shadows outer `$card`).
- `cardOwner`: owner of the holding zone instance (null for shared). `cardZoneId`: the zone def id.
- `nextPlayer`: seat after the given player (wraps).
- `getVar` target resolution mirrors `setVar`.
- `random`: uniform int in `[1, max]` from the game RNG.
- `phaseIndex`: the current phase's 0-based index (resets when the turn
  passes). `phasePos(phaseId)`: that phase's 0-based position in the turn
  order (-1 when it no longer exists). Together they express "has been /
  is current / not yet" for any phase, in any expression context.
- `binding` on an unset name → null + script error report.

## Phases & turns

- Phase entry: fire `phaseStart` event, run `onEnter`, drain events. Then:
  - `auto`: advance to the next phase immediately (no input). 
  - `oneAction`: wait for ONE legal action, then auto-advance.
  - `manual`: wait; only `endPhase`/`endTurn` blocks (or zero legal moves) advance.
- **Deadlock guard**: in `oneAction`/`manual` phases, if the current player has zero legal moves, the engine auto-advances the phase (logging it).
- **Stalemate rule**: while deadlock-skipping, if a full rotation (players × phases) passes with zero legal moves at every stop and the future-relevant state (vars, zones, card facing, RNG cursor, cycle position — but not `turnNumber` or the log) is identical to the previous rotation, the game provably cannot progress and ends immediately as a draw ("Stalemate — no player can act."). Games whose scripts read `turnNumber` are exempt (their future may depend on it); they fall back to the transition cap below.
- **Transition cap**: at most 1000 phase transitions per settle without player input; exceeding it reports a script error and stalls gracefully.
- Advancing past the last phase ends the turn: fire `turnEnd`, move to `setNextPlayer` override (consumed) or the next seat, `turnNumber++`, fire `turnStart`, enter phase 0.
- End conditions are checked after setup and after every settle (action resolved, phase/turn transition). First matching condition ends the game. `highestVar`/`lowestVar` winners: all tied players win (winners array).

## Actions & legality

`getLegalMoves(playerId)`: empty unless `playerId` is the current player, the game is running, and no choice is pending. For each action id in the current phase:

- `cardInZone`: candidates = cards in the target zone (for perPlayer zones: the current player's instance when `ownerOnly`, else **every** player's instance). Each candidate evaluates `legality` with `$card` bound; null legality = legal. → moves `{ actionId, cardId }`.
- `zone` / `none`: evaluate `legality` once (no `$card`); → `{ actionId }`.

`performAction` validates the move against `getLegalMoves`, then runs the action script with `$card` bound (for card targets), drains events, checks end conditions, then applies phase-mode advancement (`oneAction`). It rejects (throws) on illegal moves — the UI should only offer legal ones.

## Triggers & abilities (events)

Mutations enqueue events; after the active script finishes, the engine drains the queue (FIFO), running matching global triggers (definition order) then card abilities. Trigger/ability scripts may enqueue more events (bounded by the drain budget).

Event bindings available in `condition` and `script`:

| event | bindings |
|---|---|
| `cardEnterZone` / `cardLeaveZone` | `$card`, `$fromZone`, `$toZone` (zone def ids or null), `$owner` (dest/src zone owner or null), `$tag` (move-cause tag or null) |
| `zoneEmptied` | `$zone` (zone def id), `$owner` |
| `varChanged` | `$player` (for perPlayer), `$card` (for perCard) |
| `turnStart`/`turnEnd` | `$player` (whose turn) |
| `phaseStart`/`phaseEnd` | `$player` (current player) |
| `effectResolved` | `$card` (the entry's source card, when present), `$player` (who pushed it, when known) |

Abilities additionally bind `$self` (the card) and `$owner` (the holding zone instance's owner, else current player). Ability matching: `enterZone`/`leaveZone` fire when **this card** enters/leaves `zoneId`; turn/phase abilities fire when the card is currently in `zoneId` (any owner's instance).

`varChanged` fires only when the value actually changes. Zone-scoped event specs with `zoneId: null` match any zone; `phaseId: null` any phase; `varId: null` any variable.

## Visibility (`isCardVisibleTo`)

- zone `all`: visible to everyone iff the card is `faceUp`.
- zone `owner`: visible to the zone instance's owner iff `faceUp`; never to others.
- zone `none`: never visible.
- zone `topCard`: the top card visible to everyone iff `faceUp`; the rest never.

## Stack & priority (interrupt system)

Off by default: games with no `stacked` actions/triggers never enter this
machinery and behave exactly as the sections above describe.

- **Pending stack.** Engine state gains `stack: StackEntry[]` (top = last).
  `StackEntry = { id, label, sourceCardId | null, script, snapshot }` where
  `snapshot` is the binding-frame stack captured at push time (deep-cloned).
- **Stacked actions.** An `ActionDef` with `stacked: true`: `performAction`
  validates legality as usual, runs its `announce` script immediately (pay
  costs, move the card — typically to a zone the game treats as "the stack"),
  then pushes the resolution `script` with a snapshot of the bindings live at
  the END of announce ($card included), then opens a response window. The
  action's `script` does NOT run yet.
- **Stacked triggers/abilities.** With `stacked: true`, when their event+
  condition match, instead of running inline they push their script + event
  bindings snapshot onto the stack. The push happens at the point the inline
  run would have happened (same drain ordering). After the current settle
  completes, if anything was pushed and no window is open, a response window
  opens.
- **Response windows.** Engine state gains
  `window: { holderIdx, consecutivePasses } | null`. While a window is open:
  - `getLegalMoves(holder)` returns: every action whose `speed` is
    `'response'` and whose legality passes (any phase's action list — response
    actions are global), plus the built-in pass move `{ actionId: '__pass' }`.
    All other players get `[]`. Normal-speed actions are never offered while
    the stack is non-empty or a window is open.
  - Priority order starts at the turn player and proceeds in seating order.
  - Performing a response action (stacked or not) resets `consecutivePasses`
    to 0 and moves priority to the next player. A stacked response pushes
    (LIFO) like any stacked action.
  - Passing increments `consecutivePasses` and moves priority on. When every
    player has passed consecutively (`consecutivePasses === playerCount`):
    pop the top entry, run its script with its snapshot frames, settle
    (triggers may push more), then: stack non-empty → reopen the window
    (priority back to the turn player, passes reset); stack empty → close the
    window and resume normal play (the phase machine continues where it was).
- **Cancel.** Block `cancelTopEffect { cardTo }`: removes the top stack entry
  without running it; if the entry has a source card and `cardTo` names a
  zone, the card moves there (contextual owner rules apply). No-op + script
  warning when the stack is empty. (Run from a response action's own
  resolution, the "top" at resolution time is the next entry below — i.e. the
  thing it was cast in response to — which is exactly counterspell behavior.)
- **Expressions.** `stackSize` → number; `stackTopCard` → the top entry's
  source card id or null (spell-speed/legality rules read its fields).
- **`effectResolved` lifecycle event.** After a popped entry's script runs and
  settles (all its cascades included), and BEFORE the window-reopen decision,
  the engine fires `effectResolved { label, sourceCardId, byPlayerId }`.
  Cancelled entries never fire it. The resolved entry is already gone, so a
  `cancelTopEffect` inside a listener targets the NEXT entry. A `stacked`
  listener pushes a new entry whose resolution fires `effectResolved` again —
  guard it with a condition (validation warns; STACK_CAP bounds the loop).
  Typical use: reset per-attack flags (IMMUNE) after every attack resolves.
- **End conditions** are still checked after every settle, including between
  resolutions. `endGame` inside a resolution wins immediately; the rest of the
  stack is discarded.
- **Budgets.** Each resolution gets a fresh block budget (it is a settle).
  The stack depth is capped at 100 entries; pushes beyond report a script
  error and are dropped.

## Multi-select choice (`chooseCards`)

Block `chooseCards { who, from, filter, min, max, prompt, revealed, body }`:
builds candidates like `choose` (zone + filter); asks `who` (null = current
player) to pick between `min` and `max` cards (expressions, clamped to
candidates; max < 1 ⇒ no-op). `body` then runs once per picked card in pick
order with `$card` bound. No list values exist anywhere. `revealed: true`
shows candidates' faces to the chooser in the UI regardless of normal
visibility (deck searches); it does not change state facing. The single-card
`choose` gains the same `revealed` flag. ChoiceRequest gains
`{ kind: 'cards', cardIds, min, max, revealed }`; the answer is a JSON array
string of instance ids (`ChoiceAnswer` stays a string) — the engine validates
ids, bounds, and uniqueness with the usual 3-retry rule, falling back to the
first `min` candidates.

## Pile choice (`choosePile`)

ChoiceRequest kind `'pile'`: `{ cardIds, counts, optional }` where
`cardIds[i]` is pile i's representative (its top copy) and `counts[i]` its
size (for × N badges). The answer is a representative id, or null to decline
when optional; any other card id — even a real member of a pile — is invalid.
Fallback after 3 bad answers: the first pile. See the `choosePile` block above
for grouping semantics.

## Zone capacity & card state rendering

- `ZoneDef.capacity?: number` — a move that would exceed capacity moves only
  what fits (excess cards stay put, one script warning). Deals skip full
  zones. Legality expressions read `zoneCount` as usual.
- `GameDef.cardState?: { rotateVar?, badgeVars? }` — pure rendering contract:
  the runner rotates a card 90° while its perCard `rotateVar` is truthy and
  shows each `badgeVars` value as a chip on the card (hidden when 0/empty).
  The engine ignores this section entirely.

## RNG & determinism

`mulberry32(seed)`. Same def + same seed + same choice answers ⇒ identical game. `getState()`/`onUpdate` deliver deep clones; `onUpdate` fires after every visible mutation (card moves, flips, var changes, log entries, phase/turn changes, game end). `choosePile` grouping iterates zone order (never object-key order); `draw`'s refill shuffle consumes game RNG — all new sampling stays on `core.rng`.

## Schema versioning

`GameDef.schemaVersion` is `1 | 2` (current: `SCHEMA_VERSION = 2`). v2 added
move-cause tags, `draw`, `choosePile`, `triggerAbilities`, `effectResolved`,
`sumCards` and the `'contains'` op — all additive optional fields / new union
members, so v1 documents load unchanged: `migrateGameDef` stamps them to v2
(pure pass-through) and the storage soundness gate accepts both versions.
