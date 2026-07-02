# Effects-System Gap Analysis — DominionGameTable (original) vs Cardsmith (Crownfall Final)

Basis for the effects-system overhaul: new trigger events + new effect/expression blocks.

Sources read:

- **Side A (original):** `DominionGameTable/js/engine.js` (378 lines), `js/data.js` (325 lines)
- **Side B (ours):** `Crownfall Final/src/engine/{events,exec,engine,internals,legality,expr}.ts`,
  `src/editor/blocks/{registry,NodePicker,NodeBody}.tsx|ts`, `src/shared/{types,validate,migrate}.ts`,
  `src/examples/dominion.ts`, `src/forge/dominionGame.ts`, `src/runner/session.ts`

---

## 0. Architectural framing (why the two vocabularies don't map 1:1)

The original engine is **imperative with a helper API**: each card's `play(g, p)` is a JS function
calling `g.draw / g.gain / g.trashCards / g.attack / g.choose(...)` with closures for continuations.
Its "events" (`draw`, `gain`, `trash`, `play`, `buy`, `moat`, ...) are **UI/animation events only** —
nothing in the rules engine subscribes to them. The only reactive rules (Moat, VP scoring, game end)
are **hard-coded** inside `attack()` / `checkEnd()` / `endTurn()`.

Cardsmith is **declarative and data-driven**: cards carry `AbilityDef`s keyed to a small set of
engine events; scripts are `Block[]` trees interpreted by `exec.ts`; choices go through an async
`ChoiceProvider`; reactions go through a real stack + response window. This means the gap is not
"port the helper API" — it is (a) the original's UI-event vocabulary needs to become **trigger
events with cause semantics**, and (b) the helper API's compound operations (gain-from-supply,
draw-with-reshuffle, play-again, attack-each-foe) need **first-class blocks** so they stop being
5–30-block macro expansions in `dominionGame.ts`.

---

## 1. Side-by-side vocabulary table

### 1a. Effect primitives

| Original (engine.js helper) | Cardsmith equivalent | Status |
|---|---|---|
| `draw(p, n)` — draw n, auto-reshuffling discard→deck per card | `drawN()` macro in dominionGame.ts: `repeat(n, [iff(deckEmpty, [move ALL discard→deck, shuffle]), move top1 deck→hand])` | **WORKAROUND** — 4-block macro repeated per card def; a canonical `draw`/move-with-refill block is missing. Also documents an engine caveat: "triggers cannot refill a deck mid-script" |
| `shuffleDeck(p)` | `shuffle` block | OK |
| `trashCards(p, uids, from)` | `moveCards → TRASH zone` | OK (trash is just a zone) |
| `discardCards(p, uids)` | `moveCards → DISCARD` | OK |
| `revealTop(p)` (with reshuffle) | flip top card / move to a reveal zone / `choose` with `revealed: true` | PARTIAL — expressible but no single "reveal" concept; no Spy-like card in the forge def today |
| `discardFromDeckTop(p, uid)` | `moveCards specific` | OK |
| `gain(p, key, to)` — decrement supply pile, mint into discard/hand/deckTop | **PICK-ROW staging**: `gainFromSupply()` stages 1 representative card per eligible pile into transient `PICKROW` zone via ~25 `iff` blocks, `chooseCard` from it, move rest back | **AWKWARD WORKAROUND** — the single biggest gap. No "choose a pile / choose by filter with proper grouped UX" primitive |
| `choose({type:'cards', min, max, filter})` | `chooseCards` block (min/max/filter/body per pick) | OK — good parity |
| `choose({type:'pile', filter})` — *mandatory* while a legal pile exists | pick-row + `chooseCard` (see above) | **MISSING** as a primitive |
| `choose({type:'decision', options, reveal})` | `choose` kind `'option'` / `'yesNo'` | OK (reveal-a-card-alongside-options is missing but minor) |
| `g.t.actions/buys/coins/potions ± n` (turn resources) | perPlayer vars + `changeVar` | OK (potion = just another var) |
| `attack(p, fn)` — iterate foes, per-foe Moat decision, continuation `done()` | stacked `onPlay` ability + response window + `IMMUNE` perPlayer var, manually reset at the end of every attack script | PARTIAL — works (and is *better*: real priority windows), but immune-reset and "each other player" boilerplate recur in every attack |
| `playAction(uid)` — pay 1 action, hand→inPlay, run `card.play` | `dom_action_play` action + `enterZone(INPLAY)` abilities | OK |
| Throne Room "play it again" | **RESERVE BOUNCE**: move card inPlay→RESERVE→inPlay so `cardEnterZone` fires twice | **AWKWARD WORKAROUND** — visible zone churn, queues *all* enter-zone effects incl. unrelated triggers, breaks for cards that move themselves |
| `card.types: string[]` (action+attack, action+reaction) | single `CTYPE` string field; "is action" = `anyOf(ctype=='action', ctype=='attack')` | **WORKAROUND** — no multi-type membership test; Moat's `reaction` type is dropped entirely |
| `card.vp` static + scoring in `checkEnd` over `allCards(p)` | `RECOUNT_VP` trigger: `forEachPlayer × 4 zones × forEachCard changeVar` — re-run on turnEnd AND manually spliced after every gain site (buy action, Workshop, Remodel, Mine, Black Market, Witch) | **AWKWARD WORKAROUND** — no `cardGained` event to hang the recount on, no sum-a-field-over-zone expression |
| `handCoins(p)` | `sum` of a field over a zone | **MISSING expression** (only `countCards` exists, no sumCardsField) — the forge def sidesteps it by not implementing the original's "buy from action phase auto-plays treasures" convenience |
| `checkEnd()` only inside `endTurn` | endConditions checked after **every** settle → `GAME_OVER` pending var raised by a turnEnd trigger, `AND`-ed into every end condition | **AWKWARD WORKAROUND** — end-condition *timing* is not expressible |
| `emptyPiles()` | `EMPTY_PILES` var recomputed by a `cardLeaveZone(SUPPLY)` trigger listing every pile name | WORKAROUND (verbose but sound); a "count distinct piles/defs in zone" expression would kill it |
| Round numbering (turnNo per full rotation) | `floor((turnNumber+1)/2)` math expr in the layout | minor workaround, display-only |

### 1b. Trigger points / events

| Original event (UI stream) | Cardsmith EngineEvent | Status as a *trigger* |
|---|---|---|
| `turnStart` | `turnStart` (+ `turnEnd`) | OK — ours is richer |
| `phase` | `phaseStart` / `phaseEnd` (+ per-phase filter) | OK — ours is richer |
| `draw` | `cardEnterZone(HAND)` | PARTIAL — fires for *any* entry into hand (gain-to-hand looks identical to draw) |
| `gain` (supply→player, with `to` destination) | — | **MISSING** — no cause; `cardEnterZone(DISCARD)` cannot distinguish gain / discard / cleanup sweep |
| `buy` | — | **MISSING** (distinct from gain in Dominion rules: Talisman, Hoard, contraband...) |
| `trash` | `cardEnterZone(TRASH)` | OK (trash zone is unambiguous) |
| `discard (from hand/deck/play)` | `cardEnterZone(DISCARD)` | PARTIAL — cannot tell discard-from-hand vs gain vs cleanup |
| `play` (+ treasure flag) | `cardEnterZone(INPLAY)` | OK-ish — this *is* the "onPlay" convention; but a replay (Throne Room) can't re-fire it without physically moving the card |
| `shuffle` | — | MISSING (low value as a trigger; fine) |
| `reveal` | — | MISSING (no reveal concept) |
| `moat` (attack blocked) | response-window action script | OK — better than original |
| `pending` | `pendingChoice` flag / ChoiceProvider | OK (infra, not a trigger) |
| `gameOver` | `endConditions` / `endGame` block | OK, minus the timing gate noted above |
| — (n/a) | `zoneEmptied`, `varChanged`, `cardLeaveZone` | Cardsmith-only wins |
| — (hard-coded Moat) | stack: `stacked` abilities/actions, `speed:'response'`, `cancelTopEffect`, `stackSize`/`stackTopCard` | Cardsmith-only wins |
| — | **stack lifecycle events** (`effectPushed` / `effectResolved` / `effectCancelled`) | **MISSING** — attacks can't auto-clean `IMMUNE`; "when this is countered" not expressible |

### 1c. Block/expression inventory (side B, for reference)

- **Blocks (18):** moveCards, shuffle, deal, setVar, changeVar, if, repeat, forEachPlayer,
  forEachCard, choose(card|option|player|yesNo), chooseCards, cancelTopEffect, announce, flipCards,
  endPhase, endTurn, setNextPlayer, endGame.
- **Exprs (23):** num, str, bool, random, getVar, zoneCount, countCards, topCard, bestCard,
  cardField, cardOwner, cardZoneId, currentPlayer, nextPlayer, playerCount, binding, turnNumber,
  math, compare, logic, not, stackSize, stackTopCard, phaseIndex, phasePos, phaseIs.
- **Ability hooks (6):** enterZone, leaveZone, turnStart, turnEnd, phaseStart, phaseEnd
  (turn/phase hooks require a "while in zone").

---

## 2. Prioritized NEW TRIGGER EVENTS

The core insight: `cardEnterZone` carries *where* but not *why*. Dominion (and most card games)
hang rules off the **cause** of a move. Rather than N hard-coded events, add **move tags**: an
optional `tag` on `moveCards` (and on the compound blocks below), carried on the move event.

### P1 — `cardMoved` cause tags (covers cardGained / cardBought / cardTrashed / cardDiscarded / cardPlayed)

- **Schema:** `moveCards` gains `tag?: string | null` (suggested canonical vocabulary surfaced in
  the editor: `gain`, `buy`, `trash`, `discard`, `play`, `draw` — but stored free-form).
- **Payload / EventSpec:** extend the existing events rather than adding parallel ones:
  `{ kind: 'cardEnterZone'; zoneId; tag: string | null }` matching
  `EngineEvent { kind:'cardEnterZone', cardId, fromZoneId, toZoneId, toOwner, tag }`;
  binding `$tag` (or expose via a new `moveTag` expr). `spec.tag === null` = match any (back-compat).
- **Where it fires:** `performMove()` in `src/engine/exec.ts` (lines ~135-143) already enqueues
  `cardLeaveZone`/`cardEnterZone`; thread `tag` through from `execBlock('moveCards')` and every
  compound block. The `buy` action in dominionGame.ts tags its move `buy` (which *is* also a gain —
  either allow multiple tags or tag it `gain` + set a `$viaBuy` follow-up; simplest: one tag, buy
  action uses `gain` for the VP recount plus a separate trigger on the action if needed).
- **Dominion cards unlocked:** the **VP recount** becomes ONE trigger on `cardEnterZone tag:'gain'`
  + `turnEnd` (kills the 6 manual `...RECOUNT_VP` splices); Watchtower / Royal Seal ("when you
  gain a card, you may..."), Border Village, Haggler ("when you buy"), Market Square / Tunnel
  ("when you discard"), Rats / Fortress ("when this is trashed").
- **Ability hook:** widen `AbilityDef.on` with `'enterZone'`+tag filter field (`tagFilter?: string`)
  instead of new `on` values — one field, all causes.

### P2 — `effectResolved` / `effectCancelled` (stack lifecycle)

- **Payload:** `{ kind: 'effectResolved'; label: string; sourceCardId: Id | null; byPlayerId: Id | null }`
  (bindings `$card` = sourceCardId when present, `$player` = byPlayerId).
- **Where:** `resolveTop()` in `src/engine/engine.ts` (~line 199) after the entry's script settles;
  `cancelTopEffect` in exec.ts (~line 543) for the cancelled variant.
- **Dominion use:** auto-reset `IMMUNE` after each attack resolves (today every attack script must
  end with `forEachPlayer([setVar(IMMUNE, 0)])` — Militia and Witch both carry this boilerplate,
  and a future attack that forgets it silently breaks Moat). Also unlocks "when this spell is
  countered" patterns for TCG-style games.

### P3 — `turnEndCheckpoint` — better delivered as end-condition timing, not an event

- Not a new event: add `checkAt?: 'always' | 'turnEnd'` to `EndConditionDef` (default `'always'`).
- **Where:** `checkEndConditions()` in engine.ts gets a `phase: 'settle' | 'turnEnd'` argument;
  `advance()` passes `'turnEnd'` after the turnEnd settle.
- **Dominion use:** deletes the `GAME_OVER` pending var + the `dom_trigger_game_over` trigger +
  the condition rewrite loop in `buildDominionDef()` (dominionGame.ts lines 579-595) — the exact
  original semantics (`checkEnd` only inside `endTurn`) become declarative.

### P4 — `cardsDrawnEmpty` / deck-refill hook — NOT recommended as an event

- The "deck empty → reshuffle discard" rule looks like a `zoneEmptied` trigger, but the engine
  drains events only **after** the running script finishes (documented in dominion.ts header), so a
  trigger can never refill mid-draw. Don't fight the drain model; fix it with the **draw block**
  (§3 P2) which does the refill inline. Keep `zoneEmptied` for end-of-script reactions.

### P5 — `beforeAttack` / `afterAttack` — NOT recommended

- The stack + response window already *is* the before-attack window (strictly more general than the
  original's hard-coded Moat check), and P2 (`effectResolved`) covers "after". Adding attack-specific
  events would bake one genre's taxonomy into the engine. Skip.

---

## 3. Prioritized NEW EFFECT / EXPRESSION BLOCKS

### P1 — `choosePile` (gain-from-supply-by-filter with grouped choice UX)

- **Params:** `{ kind: 'choosePile'; who: Expr | null; from: ZoneRef; filter: Expr | null;
  groupBy: 'def' (fixed for now); prompt: string; optional: boolean; body: Block[] }` — binds
  `$card` (a representative instance, the "top" copy of the chosen group) inside `body`.
- **Semantics:** candidates = one instance per distinct `defId` (or name for standard cards) in the
  zone that passes `filter` ($card bound per candidate). Ask via a new `ChoiceRequest` kind
  `'pile'` (`{ cardIds: Id[], counts: number[] }` so the UI can render × N badges like the supply
  `display:'piles'` mode). Mandatory when `optional:false` and candidates exist (the original's
  "gaining is mandatory while a legal pile exists"); empty candidates → skip body, no report when
  optional.
- **Edge cases:** groups computed at ask time (no staging → no pile-mutation window); deterministic
  group order = first-appearance order in `inst.cardIds`; a filter referencing `$owner` works
  because frames are live.
- **Replaces:** the entire `gainFromSupply()` machine in dominionGame.ts (~25 staged `iff` blocks +
  `PICKROW` zone + move-back) for Workshop, Remodel, Mine, Black Market; Witch's curse-gain
  `bestCard` contortion becomes `moveCards specific(topCard filtered)` or stays as-is.

### P2 — `draw` (move-with-refill)

- **Params:** `{ kind: 'draw'; who: Expr | null; count: Expr; from: ZoneRef; refillFrom: ZoneRef | null;
  to: ZoneRef; faceUp: boolean | null; tag?: string }` (editor default: deck→hand, refill discard).
- **Semantics:** per card — if `from` empty and `refillFrom` non-empty: move all refill→from
  face-down, shuffle (game RNG), then move 1 to `to`. Stops when both empty. Charges budget per
  card like `deal`. Emits tagged move events (`draw`).
- **Edge cases:** refill zone == from zone → skip refill; count ≤ 0 → no-op.
- **Replaces:** the `drawN` macro used ~14 times across dominion.ts / dominionGame.ts; makes
  Cellar/Council Room/Witch/Smithy one block each; kills the most-copied pattern in the codebase.

### P3 — `sumCards` expression (per-card-type counting / handCoins / VP)

- **Params:** `{ kind: 'sumCards'; zone: ZoneRef; fieldId: Id; filter: Expr | null }` → number;
  non-numeric field values count 0.
- **Replaces:** `RECOUNT_VP`'s inner `forEachCard changeVar` loops (VP becomes
  `setVar(VP, sum over 4 zones)`), `handCoins` (original's action-phase buy convenience), Gardens
  (`ownedTotal` stays as summed zoneCounts, fine). Pairs with P1 of §2 so the recount trigger is
  small AND runs in the right places.

### P4 — `triggerAbilities` (play-card-again)

- **Params:** `{ kind: 'triggerAbilities'; card: Expr; on: 'enterZone'; zoneId: Id }` — enqueue a
  synthetic `cardEnterZone` event (fromZoneId = card's current zone, tag `'play'`) WITHOUT moving
  the card. Runs through the normal drain, so stacked abilities still stack.
- **Edge cases:** budget/DRAIN_ROUNDS already bound cascades (Throne Room on Throne Room);
  global triggers listening on that zone ALSO fire — document this (it matches "the card is played
  again"); card no longer exists → report + no-op.
- **Replaces:** Throne Room's **reserve bounce** (dominionGame.ts lines 329-333) — no more visible
  zone churn through the Black Market's stock zone, no accidental leave-zone triggers, and it can't
  strand the card in RESERVE if a nested effect moves it mid-bounce.

### P5 — `contains` compare op (multi-type cards)

- **Params:** extend `CompareOp` with `'contains'` (string left contains substring right,
  case-sensitive; non-strings coerce via String()).
- **Replaces:** `IS_ACTION_CARD = anyOf(ctype=='action', ctype=='attack')`; lets `CTYPE` hold
  `'action attack'` / `'action reaction'` so Moat's reaction type stops being erased and Throne
  Room / play-legality filters read like the original's `types.includes(...)`.
- **Validate note:** `typeOf` returns boolean; warn when either side is statically a number.

### P6 (nice-to-have) — `countPiles` expression

- `{ kind: 'countPiles'; zone: ZoneRef; filter: Expr | null }` → number of distinct defs present.
  Replaces the per-name `EMPTY_PILES` watcher (needs a baseline to diff against, so the watcher
  becomes `setVar(EMPTY_PILES, startingPileCount - countPiles(SUPPLY))` — one block, and
  `pickKingdom` stops rewriting trigger scripts).

### Explicitly NOT needed

- **cost-of-card expression** — `cardField(card, COST)` already covers it (cost is a def field).
- **set-aside / duration** — expressible today: a perPlayer "set aside" zone + `turnStart`-in-zone
  ability. Worth a docs recipe, not a block.
- **reveal** — `choose`'s `revealed: true` + `flipCards` cover the observed uses; revisit if a Spy
  port lands.

---

## 4. Editor & validation implications

- **`src/editor/blocks/registry.ts`:** `BLOCK_ENTRIES` / `EXPR_ENTRIES` are exhaustive keyed records
  over the schema unions — adding kinds to `types.ts` **fails compilation until metadata exists**
  (by design; this is the checklist driver). New entries: `choosePile` + `draw` → category `cards`
  (draw) / `players` (choosePile, like chooseCards), `triggerAbilities` → `cards` or `game`,
  `sumCards`/`countPiles` → expr category `zones`. Add to `BLOCK_ORDER` / `EXPR_ORDER`.
- **`NodePicker`** needs no code changes (renders from registry + category labels), but expr pin
  filtering runs through `graphModel.exprKindOutType` — add `sumCards`/`countPiles` → `'number'`.
- **`NodeBody.tsx` / `slots.tsx`:** per-kind body renderers — zone pickers, expr pins (`count`,
  `min/max`, `filter` with `$card` binding pushed), tag input (datalist of canonical tags), and
  body-slot rendering for `choosePile`'s `body` (mirror `chooseCards`). `exprToText.ts` needs
  human strings for new exprs (it has tests — extend `exprToText.test.ts`).
- **`RulesTab.tsx`:** `EVENT_KINDS` + `makeEvent` gain nothing for P1 (tags extend the existing
  `cardEnterZone` row with an optional "with tag" input); `effectResolved` needs one new row.
  Ability editor (CardsTab) needs the `tagFilter` field next to the existing zone picker.
- **`src/shared/validate.ts`:** `walkBlock` / `walkExpr` switches are exhaustive too — add cases:
  `choosePile` (zone ref, filter, body, warn when `optional:false` and the zone could be empty),
  `draw` (both zone refs; **error** if `refillFrom.zoneId === from.zoneId`), `triggerAbilities`
  (zone exists; **warn** if the target zone hosts global enter-zone triggers — surprise double
  fires), `contains` (type warning), tags (warn on a trigger tag no `moveCards`/`draw` in the def
  ever emits — catches typos, mirrors the existing "never fires" warnings). The `endsGame` scan
  must learn any new block with a `body`.
- **`docs/engine-semantics.md`** (referenced from types.ts) — document tag semantics and the
  synthetic-event rule for `triggerAbilities`.

---

## 5. Risks

- **Determinism (seeded RNG):** all new shuffling/sampling must use `core.rng` (as `shuffle`,
  `random` selector, and `deal` already do). `choosePile` grouping must iterate `inst.cardIds` in
  array order (never `Object.keys(state.cards)`); `draw`'s refill shuffle uses `shuffleInPlace(core.rng)`.
  Legality stays on `silentCtx` (forked RNG) — don't let new exprs consume game RNG during
  enumeration. `futureHash` (stalemate detection) already covers zones/vars/stack; tags add no
  hidden state. Note: session AI uses `Math.random` — engine determinism is "same seed + same
  external answers", unchanged.
- **AI-safety (session.ts must never hang):** `aiAnswer` in `src/runner/session.ts` is an
  exhaustive switch over `ChoiceRequest` — the new `'pile'` kind fails compile until handled (pick
  a uniform random candidate; respect `optional` with the existing decline chance). Also extend
  `validAnswer` + `fallbackAnswer` in exec.ts; the 3-attempt-then-fallback loop already guarantees
  no hang even for a buggy provider. Keep the dominionGame invariant: every choice either has a
  guaranteed candidate (`iff` guard) or `min 0`/`optional` — `choosePile` makes this easier, not harder.
- **Stack / response-window interactions:** `triggerAbilities` enqueues events whose stacked
  abilities push entries — bounded by `STACK_CAP` (100) and `DRAIN_ROUNDS` (50), but a
  Throne-Room-on-Throne-Room chain during a window means `resolveTop → settle → new stack entries →
  window reopens`; that path exists today (Witch's stacked attack) and is tested (`stack.test.ts`) —
  add a test for synthetic events specifically. `effectResolved` must fire AFTER the entry's script
  settles and BEFORE the window-reopen decision, and must not itself be able to cancel the
  already-popped entry (it's gone — `cancelTopEffect` inside an `effectResolved` trigger targets the
  next entry; document). Beware feedback: an `effectResolved` trigger that is itself `stacked`
  creates entry→resolve→entry loops — cap via STACK_CAP is fine, but validate.ts should warn.
- **Budget/cascade:** `draw` charges budget per card (like `deal`); `triggerAbilities` charges one
  block + the drained scripts' own budgets. Cascades from tagged events raise trigger volume —
  the VP-recount trigger moving from turnEnd to every `gain` means more frequent runs; `sumCards`
  keeps each run cheap (one pass vs forEachCard's per-card block charges).
- **Save-compat (schemaVersion):** all proposals are **additive optional fields + new union
  members**, so `schemaVersion: 1` can stay IF the loader is tolerant: old docs load fine (missing
  `tag`/`checkAt` default to null/'always'). The real hazard is **old code reading new docs**
  (hall/forge share localStorage): `exec.ts`'s `execBlock` switch silently no-ops unknown kinds
  (returns undefined) but `registry.ts`'s `blockMeta()` would crash on `BLOCK_ENTRIES[unknown]`.
  Recommendation: bump to `schemaVersion: 2` with a trivial pass-through migration in
  `src/shared/migrate.ts` (which already exists for tableLayout/phaseDots) and make v1→v2 purely
  `{...def, schemaVersion: 2}`; gate the forge's "open" path on `schemaVersion <= 2`. That keeps the
  crash surface explicit instead of silent no-op scripts.
- **dominionGame.ts rewrite risk:** `pickKingdom` pattern-matches setup-block shapes
  (`kingdomPileBlockName`) — any change to how kingdom piles spawn must preserve or migrate that
  tag shape; the pile watcher and `GAME_OVER` deletions change trigger ids that tests
  (`dominionGame.test.ts`, `seedDominion.test.ts`) reference. Land engine features first with
  engine tests, then refactor the def in a separate pass with before/after seeded-game parity runs.

---

## 6. Suggested implementation order

1. `contains` op + `sumCards` (pure expr layer: types → expr.ts → registry → exprToText → validate). Small, unblocks recount cleanup.
2. Move tags on `moveCards` + event/trigger/ability tag filters (`performMove` threading, RulesTab, validate).
3. `draw` block (uses tags; kills the biggest macro).
4. `choosePile` (+ ChoiceRequest 'pile', session.ts aiAnswer, runner choice sheet UI).
5. `triggerAbilities` + `effectResolved` (stack-adjacent, needs the most tests).
6. `checkAt: 'turnEnd'` on end conditions.
7. schemaVersion 2 migration + dominionGame.ts refactor to the new vocabulary (parity-test against current behavior with fixed seeds).
