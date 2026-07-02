# DominionGameTable — Interactive Design Implementation Spec

Source: `C:\Users\Tobit\Documents\ProgrammingProjects\DominionGameTable` (index.html, styles.css, js/ui.js, js/input.js, js/anim.js, js/main.js, js/engine.js, js/data.js, DESIGN.md, PRODUCT.md). This is an exact blueprint; every value below is copied from the source, not approximated.

---

## 0. Global design language (prerequisites everything else references)

### Tokens (`:root`, OKLCH)

```css
--abyss: oklch(0.13 0.012 20);          /* page ground */
--hall: oklch(0.165 0.014 20);          /* raised surface */
--dais: oklch(0.21 0.018 22);           /* higher surface */
--rule: oklch(0.30 0.025 22);           /* hairline border */
--rule-soft: oklch(0.24 0.02 22);
--bone: oklch(0.93 0.012 75);           /* primary text */
--bone-dim: oklch(0.82 0.015 70);
--ash: oklch(0.68 0.018 40);            /* secondary text */
--crimson: oklch(0.50 0.20 22);
--crimson-bright: oklch(0.60 0.225 24);
--crimson-deep: oklch(0.34 0.13 20);
--crimson-whisper: oklch(0.50 0.20 22 / 0.12);
--aurum: oklch(0.78 0.10 85);           /* treasure/gold */
--verdict: oklch(0.62 0.14 145);        /* victory/green */
--azure: oklch(0.68 0.10 240);          /* reaction */
--umbra: oklch(0.58 0.14 310);          /* curse */
--display: "Gloock", "Georgia", serif;
--grotesk: "Schibsted Grotesk", "Segoe UI", system-ui, sans-serif;
--out-expo: cubic-bezier(0.16, 1, 0.3, 1);   /* THE easing, used everywhere */
--notch: 10px;
--notch-sm: 6px;
--card-ratio: 59 / 91;
--card-w: min(clamp(7rem, 8.6vw, 8.8rem), 11.5vh);        /* hand card */
--table-card-w: min(clamp(4.2rem, 5.4vw, 5.4rem), 7.4vh); /* in-play card */
--pile-w: clamp(4.7rem, 5.9vw, 5.7rem);
--pile-w-k: min(clamp(6rem, 8.4vw, 8.4rem), 12.3vh);      /* kingdom pile */
```

### The notch (signature button shape)

All "seal" buttons (`.btn`, `.phase-seal`, `.selection-bar`, mobile `.tab-slider`) use this clip-path — corners cut diagonally at **top-left** and **bottom-right**:

```css
clip-path: polygon(
  var(--notch) 0, 100% 0, 100% calc(100% - var(--notch)),
  calc(100% - var(--notch)) 100%, 0 100%, 0 var(--notch)
);
```
(`--notch-sm: 6px` variant for `.ghost-btn` and the mobile tab slider.)

### Card-type accent routing

`data-accent` attribute on card/pile elements sets `--accent`:

```css
[data-accent="treasure"] { --accent: var(--aurum); }
[data-accent="victory"]  { --accent: var(--verdict); }
[data-accent="curse"]    { --accent: var(--umbra); }
[data-accent="reaction"] { --accent: var(--azure); }
[data-accent="action"], [data-accent="attack"] { --accent: var(--bone-dim); }
```

Accent priority (`DGT.accentType`): curse > treasure > victory > reaction > attack > action.

### Global focus/selection

```css
:focus-visible { outline: 2px solid var(--crimson-bright); outline-offset: 2px; }
::selection { background: var(--crimson); color: var(--bone); }
```

### Body state attributes (drive most conditional styling)

- `body[data-phase]` = engine phase: `"action" | "buy"` (set every `renderPhase`).
- `body[data-active]` = `"you" | "foe" | "over"`.
- `body[data-kbzone]` = `"treasure" | "victory" | "kingdom"` while a modifier is held (deleted otherwise).
- `body.chron-collapsed`, `body.header-peek` (mobile) — chrome toggles.

---

## 1. THE PHASE SEAL

### 1.1 Markup (exact, from index.html)

```html
<button class="phase-seal" id="phaseSeal">
  <span class="phase-dots" aria-hidden="true"><i class="dot-action"></i><i class="dot-buy"></i></span>
  <span class="phase-name" id="phaseName">Action</span>
  <span class="phase-hint" id="phaseHint">to Buy phase</span>
  <kbd class="phase-key">Space</kbd>
</button>
```

It sits inside `.command-row` (right-aligned in the battlefield band), next to the counters. There are exactly **two** dots — Action and Buy. Cleanup has **no dot** and no seal state; it is a transient engine event only.

### 1.2 CSS (complete)

```css
.phase-seal {
  position: relative;
  display: flex; flex-direction: column;
  align-items: flex-start; justify-content: center;
  gap: 0.1rem;
  min-width: clamp(11rem, 14vw, 14rem);
  padding: 0.55rem 1.2rem 0.6rem;
  background: var(--crimson);
  color: var(--bone);
  clip-path: polygon(var(--notch) 0, 100% 0, 100% calc(100% - var(--notch)),
                     calc(100% - var(--notch)) 100%, 0 100%, 0 var(--notch));
  transition: background-color 0.3s var(--out-expo), color 0.3s var(--out-expo);
}
.phase-seal:hover:not(:disabled)  { background: oklch(0.43 0.175 22); }  /* darker crimson */
.phase-seal:active:not(:disabled) { background: var(--crimson-deep); }

.phase-dots { display: flex; gap: 0.35rem; margin-bottom: 0.25rem; }
.phase-dots i {
  width: 5px; height: 5px;
  rotate: 45deg;                                   /* lozenge, not circle */
  border: 1px solid oklch(0.93 0.012 75 / 0.45);   /* translucent bone outline */
  transition: background-color 0.25s var(--out-expo), border-color 0.25s var(--out-expo);
}
/* current-phase emphasis: the matching dot fills solid bone */
.phase-seal[data-phase="action"] .dot-action,
.phase-seal[data-phase="buy"]    .dot-buy { background: var(--bone); border-color: var(--bone); }
.phase-seal:disabled .phase-dots { opacity: 0.4; }

.phase-name { font-family: var(--display); font-size: 1.25rem; line-height: 1.05; }  /* Gloock */
.phase-hint { font-size: 0.6rem; font-weight: 600; letter-spacing: 0.16em;
              text-transform: uppercase; opacity: 0.85; }
.phase-key  { position: absolute; right: 0.7rem; top: 50%; translate: 0 -50%;
              border-color: oklch(0.93 0.012 75 / 0.4); color: oklch(0.93 0.012 75 / 0.8); }
              /* inherits kbd base: 0.62rem, 600, ls 0.08em, uppercase, 1px border, 2px radius */

.phase-seal:disabled { background: var(--dais); color: var(--ash); }
.phase-seal:disabled .phase-key { opacity: 0; }

/* foe's turn: seal goes cold — hall ground, inset hairline, no fill */
.phase-seal[data-phase="foe"] { background: var(--hall); color: var(--ash);
                                box-shadow: inset 0 0 0 1px var(--rule-soft); }
/* the foe's name breathes while he thinks */
.phase-seal[data-phase="foe"] .phase-name { animation: foe-breathe 2.6s var(--out-expo) infinite; }
@keyframes foe-breathe { 50% { opacity: 0.45; } }

/* stamp on phase change */
.phase-seal.stamp { animation: seal-stamp 0.5s var(--out-expo); }
@keyframes seal-stamp {
  0%   { scale: 1.07; filter: brightness(1.5); }
  100% { scale: 1;    filter: brightness(1); }
}
```

Mobile (≤45rem): `.phase-seal { min-width: 0; padding: 0.45rem 0.9rem 0.5rem; }`, `.phase-name { font-size: 1.05rem; }`, `.phase-key { display: none; }`.

Keyboard focus uses the global `:focus-visible` 2px crimson-bright outline. Disabled cursor is `default` (global `button:disabled`).

### 1.3 State machine (`renderPhase()` in ui.js — exact conditions, in priority order)

| Condition | `data-phase` | Name | Hint | disabled |
|---|---|---|---|---|
| `g.over` | `over` | `Fallen` | `new match` | **no** |
| `g.pending && pending.player.human` | `resolve` | `Resolve` | `confirm below` if `pending.type==="cards" && (max>1 || min===0)`, else `choose a target` | **yes** |
| `g.active===1` OR pending belongs to AI | `foe` | `Mordrane` | `takes his turn` | **yes** |
| `g.phase==="action"` | `action` | `Action` | `to Buy` | no |
| else (buy) | `buy` | `Buy` | `end turn` | no |

Notes: `data-phase="over"` has no dedicated CSS, so the "Fallen / new match" seal renders in the default crimson fill with **neither dot lit** (same for `resolve` and `foe`). `renderPhase` also sets `body.dataset.phase = g.phase` and `body.dataset.active = over ? "over" : active===0 ? "you" : "foe"`, and toggles the "Play all treasures" ghost button: shown iff `!g.over && !g.pending && g.active===0 && hand contains a treasure`.

### 1.4 Click behavior (`onSeal()`)

```
if game over:
    if verdict modal is hidden but still built → re-show it
    else → start a new match
else if a pending choice exists → confirmSelection()   (only acts for a human
        "cards" pending with min ≤ selected ≤ max; otherwise a no-op — the seal
        is disabled in these states anyway, this is the keyboard path)
else if it's the foe's turn → nothing
else → g.endPhase(): action → buy;  buy → cleanup + end turn
```

### 1.5 Phase-change animation

On every engine `phase` event and `turnStart` event, ui.js calls `A().stamp(els.phaseSeal)`: remove `.stamp`, force reflow (`void el.offsetWidth`), re-add `.stamp` → plays `seal-stamp` (0.5s out-expo, scale 1.07→1, brightness 1.5→1). Background/color changes ride the 0.3s out-expo transition. After a decision modal resolves, focus is handed to the seal: `els.phaseSeal.focus({ preventScroll: true })` (if not disabled).

---

## 2. THE KEYBOARD SYSTEM (js/input.js)

One `keydown`/`keyup` pair on `window`; `blur` and `visibilitychange` clear held modifiers.

### 2.1 Held modifiers — zone marking

State: `const held = { shift:false, ctrl:false, alt:false }` set on `e.key === "Shift" | "Control" | "Alt"` keydown (Alt also `e.preventDefault()` to suppress the browser menu), cleared on keyup/blur/visibilitychange.

Zone priority (`zoneOf()`): **alt → "kingdom"**, else **ctrl → "victory"**, else **shift → "treasure"**, else null.

`applyZone()` sets `document.body.dataset.kbzone = zone` (or deletes it). On mobile it additionally calls `DGT.ui.setSupplyTab(zone)` to flip the supply carousel to that tab. Opening a decision modal deletes `data-kbzone`.

**What gets marked** (styles.css):

```css
/* everything dims… */
body[data-kbzone] .supply-group,
body[data-kbzone] .harbor,
body[data-kbzone] .battlefield .play-row,
body[data-kbzone] .command-row { opacity: 0.3; }

/* …except the held zone */
body[data-kbzone="treasure"] #groupTreasure,
body[data-kbzone="victory"]  #groupVictory,
body[data-kbzone="kingdom"]  #groupKingdom,
body[data-kbzone="hand"]     .harbor { opacity: 1; }   /* NOTE: "hand" is dead CSS —
                                                          input.js never sets it */

/* the zone label lights crimson */
body[data-kbzone="treasure"] #groupTreasure .zone-label,
body[data-kbzone="victory"]  #groupVictory .zone-label,
body[data-kbzone="kingdom"]  #groupKingdom .zone-label { color: var(--crimson-bright); }

/* and every pile in the zone gets a lit digit badge */
body[data-kbzone="treasure"] #groupTreasure .key-badge,
body[data-kbzone="victory"]  #groupVictory .key-badge,
body[data-kbzone="kingdom"]  #groupKingdom .key-badge {
  opacity: 1; scale: 1.25;
  color: var(--bone);
  border-color: var(--crimson-bright);
  background: var(--crimson-deep);
}
```

The zone labels in markup carry a `<kbd class="zone-key">` naming their modifier: `Treasure Shift`, `Victory Ctrl`, `Kingdom Alt` (`.zone-key { opacity: 0.75; }`).

**Key badge — markup + CSS.** Every hand card and supply pile is built with `<span class="key-badge">D</span>` as its last-but-one child (digit `D` from `digitFor(i)`: index 0–8 → "1"–"9", index 9 → "0", index ≥10 → "" i.e. unaddressable):

```css
.key-badge {
  position: absolute; right: 0.3rem; bottom: 0.3rem;
  min-width: 1.15rem; height: 1.15rem;
  display: grid; place-items: center;
  font-size: 0.62rem; font-weight: 700;
  color: var(--ash);
  border: 1px solid var(--rule);
  background: var(--abyss);
  transition: all 0.2s var(--out-expo);
}
.pile .key-badge { opacity: 0; scale: 0.8; }   /* hidden until its zone is held */
.hand .key-badge { opacity: 0.85; }            /* hand badges are ALWAYS visible */
```

So: hand digits are permanently discoverable at 85% opacity; supply digits appear only while their modifier is held (fade/scale in over 0.2s out-expo, since `transition: all` covers opacity and scale).

### 2.2 Digit keys

Digits are read from **`e.code`** via `/^(?:Digit|Numpad)(\d)$/` (layout-independent, numpad works). `0` maps to index 9 (the tenth item). Handler always `e.preventDefault()`.

Routing (when no overlay is open):

```
zone = e.altKey ? "kingdom" : e.ctrlKey ? "victory" : e.shiftKey ? "treasure" : zoneOf()
```
(the live event flags win; the `held` state is fallback, so a digit struck while the modifier is physically down always routes correctly).

- **No zone** → `ui.onHandDigit(idx)` → identical to clicking the idx-th **hand stack** (see §2.5). Context-sensitive: in free play it plays the card; during a `cards` pending it selects/deselects it.
- **Zone** → look up the pile key in display order and call `ui.onPileClick(key, /*viaKey=*/true)`:
  - `TREASURE_ROW = ["copper","silver","gold","platinum","potion"]` (Shift+1…5)
  - `VICTORY_ROW = ["estate","duchy","province","colony","curse"]` (Ctrl+1…5)
  - `KINGDOM_ROW` = the ten kingdom piles in table order (Alt+1…9, Alt+0 = tenth)
  - `viaKey=true` skips the mobile "first tap focuses the carousel" step.
  - Context-sensitive: buys the pile in free play, answers a `pile` pending (gain target) during resolution; illegal → refuse shake.

### 2.3 Full binding table (in evaluation order inside `onKeydown`)

| Key | Guard | Effect |
|---|---|---|
| `Shift`/`Control`/`Alt` (keydown) | always (returns early) | set held flag, apply kbzone |
| any key | focus is in INPUT/TEXTAREA/contentEditable | ignored entirely |
| `Tab` | keymap or modal open | **focus trap**: cycle the overlay's enabled `<button>`s (Shift+Tab reverses); wraps |
| `?` | always | toggle the keymap overlay |
| any | keymap open | `Escape`/`Enter`/`Space` close it; everything else swallowed |
| digits | inspector modal open | — (see next rows) |
| `Escape`/`Enter`/`Space` | inspector modal open | close inspector |
| `Enter` | end screen open | new match |
| `Escape` | end screen open | hide verdict ("survey the field") |
| digit `d` | decision modal open | choose option `d` (0→10) if `1 ≤ d ≤ options.length` |
| `Enter`/`Space` | decision modal open, no button focused | activate the primary (or first) option |
| digit | table (no overlay) | hand/pile routing per §2.2 |
| `Space`/`Enter` | table, no button focused (`interactiveFocused()` checks BUTTON/A/INPUT/TEXTAREA) | if human `cards` pending → `confirmSelection()`; else `onSeal()` |
| `a`/`A` | table, no button focused | Play all treasures |
| `s`/`S` | table, no button focused | cycle speed 1×/2×/⚡ (persisted to `localStorage["dgt-speed"]`) |
| `Escape` | table | 1) close the mobile chronicle sheet if open; else 2) if human `cards` pending with `min===0` → `skipSelection()` |
| `Shift`/`Control`/`Alt` (keyup) | always | clear held flag, remove kbzone |

**Remap summary during prompts:** when a `cards` prompt is open, digits still address hand stacks but now toggle selection; Space/Enter become Confirm; Esc becomes Skip (only if optional). When a `pile` prompt is open, modifier+digit answers with that pile. When a `decision` modal is open, digits 1–9 map to option buttons (each option button renders its own `<kbd>N</kbd>`), Enter/Space fire the primary.

**Keyboard/mouse interplay:** keys and clicks converge on the same handlers (`onGroupClick`, `onPileClick`, `onSeal`) so state marking is identical. `interactiveFocused()` prevents Space/Enter double-firing a focused button (native activation wins). Hover drives only the chronicle preview panel and CSS hover lifts; keyboard never moves hover. `:focus-visible` gives keyboard users the crimson outline; modal open moves focus to the primary button, modal close returns focus to the phase seal.

### 2.4 'Marked' visual treatments (target marking, ui.js `updateTargets()` + CSS)

Class semantics (applied to `.card` in hand and `.pile` in supply):

```css
.is-legal {                       /* a legal target for the current prompt */
  cursor: pointer;
  border-color: var(--crimson) !important;
  animation: legal-pulse 1.5s var(--out-expo) infinite;
}
@keyframes legal-pulse {
  0%,100% { box-shadow: inset 0 0 0 1px oklch(0.13 0.012 20), 0 0 4px var(--crimson-whisper); }
  50%     { box-shadow: inset 0 0 0 1px oklch(0.13 0.012 20), 0 0 20px oklch(0.50 0.20 22 / 0.4); }
}
.card.is-legal:hover, .pile.is-legal:hover {
  translate: 0 -0.7rem;
  animation-play-state: paused;
  border-color: var(--crimson-bright) !important;
}

.is-selected {                    /* chosen in a multi-select */
  border-color: var(--crimson-bright) !important;
  background: linear-gradient(160deg, oklch(0.23 0.05 22), oklch(0.17 0.03 20) 55%);
  translate: 0 -0.85rem !important;
  rotate: 0deg !important;        /* cancels the hand fan */
}
.is-selected .sel-check { opacity: 1; scale: 1; }

.is-dimmed { opacity: 0.4; filter: grayscale(0.45); pointer-events: none; }
```

`.sel-check` (in every card's markup): absolute top/right 0.3rem, min-width/height 1.2rem, crimson bg, bone text, 0.72rem/700, hidden at `opacity:0; scale:0.6` with 0.2s out-expo transitions. Its text: `"✦"` when exactly 1 of a stack is chosen, the count (`"2"`, `"3"`…) when more.

Marking logic per state:
- **Free play (your turn, no pending):** hand stacks get `.is-playable` iff (action card ∧ action phase ∧ actions>0) ∨ treasure. `.is-playable:hover/:focus-visible`: `translate 0 -0.7rem; rotate 0; border-color: var(--crimson); box-shadow: inset hairline + 0 14px 30px black-50% + 0 0 16px var(--crimson-whisper)`.
- **`cards` pending:** per hand stack — `.is-dimmed` if no legal uid in the stack; `.is-selected` if ≥1 chosen; `.is-legal` if it still has unchosen legal uids and capacity remains (`sel.size < pend.max`).
- **`pile` pending:** each pile gets `.is-legal` (count>0 ∧ passes filter) or `.is-dimmed`; **all hand cards dim**. On mobile the supply tab auto-switches to the first tab containing a legal pile.
- All marks cleared by `clearTargetMarks()` before each update.

---

## 3. THE PLAY AREA ("In play" band)

### 3.1 Two separate rows — whose cards, and when (verified in `renderPlayRows()`)

There are **two** play rows, one per side of the table, not one switching row:

- `#ownPlayWrap` (`.play-row.own-play`, label "In play") lives in the `.battlefield` band beside the counters/seal. Visibility: `els.ownPlayWrap.hidden = (g.active === 1 && g.players[0].inPlay.length === 0)`. So it is **always visible on your turn (even empty)** and hidden during the foe's turn **only because your in-play is empty then** (cleanup sweeps it before the turn passes). It does *not* switch to show the foe's plays. The user's claim is functionally right but the mechanism is "hide when foe is active AND own play empty", not "hide when foe is active".
- `#foePlayWrap` (`.play-row.foe-play`, label "Their play", `hidden` in initial markup) lives inside the **foe strip** at the top, right-aligned beside Mordrane's banner. Visibility: `els.foePlayWrap.hidden = !(g.active === 1 || g.players[1].inPlay.length > 0)`.

`.play-row[hidden] { display: none !important; }` — a genuinely collapsed zone (no reserved space), it *appears* when it first gains content/relevance.

### 3.2 Layout

```css
.play-cards { display: flex; align-items: flex-start; gap: 0.4rem;
              min-height: calc(var(--table-card-w) * 91 / 59); }  /* band never collapses while visible */
.play-cards .card { width: var(--table-card-w); }
.own-play .play-cards { overflow-x: auto; scrollbar-width: none; }  /* + hidden webkit scrollbar */
.foe-strip .play-cards { justify-content: flex-end; min-height: 0; overflow-x: auto; }
.foe-strip .foe-play .card { width: calc(var(--table-card-w) * 0.82); }  /* mobile: 0.70× */
.foe-strip .zone-label { display: none; }  /* foe row shows no label in the strip */
```

Cards render in **play order, one element per card — duplicates do NOT stack in play** (no piling; three played Coppers = three separate small cards). Stacking-into-piles exists only in the *hand* (§5.2). Each in-play card is a non-interactive `div.card.card--bare.card--inspect` (`cursor: zoom-in`) whose click opens the inspector.

**Treasure-play grouping:** none visually — each treasure flies and lands individually (a `play` event per card). Grouping exists only as the "Play all treasures `A`" ghost button and the engine convenience that buying/clicking during action phase auto-plays hand treasures first.

### 3.3 Cleanup

`endTurn()` emits `phase:"cleanup"`, then a `discard` event for every in-play card (`from:"play"`) and every hand card (`from:"hand"`), logs "`{name}` sweeps the table clean.", draws 5, then `turnStart`. The UI batches consecutive discards: your sweep animates each card flying from its play/hand slot to the discard spot with 35ms stagger, 320ms, arc 36px, spin 7° (non-blocking); the DOM rows are re-rendered (emptied) at flight start. The own-play wrap then hides (empty + foe active) until your next turn.

---

## 4. ANIMATIONS (js/anim.js + CSS)

### 4.1 Infrastructure

- All flights are **overlay clones** in `#fxLayer` (`position: fixed; inset: 0; z-index: 200; pointer-events: none; overflow: hidden;`). Game state never waits for animation correctness, only visibility.
- Clone wrapper `.fx-card { position:absolute; left:0; top:0; will-change: transform, opacity, filter; }`, inner card gets `box-shadow: 0 18px 50px oklch(0.04 0.01 20 / 0.7)`.
- Card-back clone `.fx-back`: `linear-gradient(150deg, oklch(0.27 0.09 20), oklch(0.19 0.05 20) 70%)`, 1px rule border, card ratio, inset crest SVG at `inset:14%` colored `oklch(0.5 0.16 22 / 0.85)`.
- Easing: `EASE = "cubic-bezier(0.16, 1, 0.3, 1)"` for fly/burn/reveal; embers use `cubic-bezier(0.2, 0.7, 0.4, 1)`; refuse uses `ease-out`. Web Animations API, `fill: "forwards"`, element removed on finish.
- **Speed system:** `normal` (1×), `fast` (durations ÷ 1.9), `blitz` (`skip()` → every animation resolves immediately). Also skipped whenever `document.hidden` (background tabs never stall). `wait(ms)` → `ms/1.9` on fast, `min(ms,40)` if reduced/skipped.
- **Arrival veil (z-layering trick):** a uid mid-flight is added to an `arriving` Set; the destination re-renders immediately but the real element is `visibility:hidden` until the clone lands (`unveil`). Re-renders can replace DOM freely mid-flight because the veil is keyed by uid, not element.
- **No sound hooks exist anywhere.**

### 4.2 `fly(opts)` — the core flight

Three-keyframe transform arc, `transform-origin: top left`:
- offset 0: `translate(from.left, from.top) scale(fromRect.width / naturalWidth) rotate(0)`
- offset 0.5: midpoint XY, lifted by `arcY` px (default **46**), scale averaged, `rotate(spin/2)`
- offset 1: `translate(to.left, to.top) scale(toRect.width / naturalWidth) rotate(spin)`, `opacity: 0` if `fade:true`

Default duration **430ms**; reduced-motion → 90ms and `arcY = 0`.

### 4.3 Per-event choreography (ui.js callers — exact numbers)

| Event | From → To | Stagger | Duration | arcY | Spin | Blocking? | Notes |
|---|---|---|---|---|---|---|---|
| Your draw | deck spot → hand slot | 45ms | 300 | 22 | 0 | **no** (input never blocked by your draws) | face-up card clone; veil/unveil |
| Foe draw | foe deck tally → foe hand (20×28 target, clone width 26) | 60ms | 320 | 14 | 0 | yes | card backs |
| Your discard | play/hand/deck slot → discard spot | 35ms | 320 | 36 | 7° | no | consecutive discards batched per player |
| Foe discard | foe play/hand/deck → foe discard tally | 55ms | 380 | 20 | 0 | yes | `fade: true` (dissolves into the tally) |
| Your play | hand slot → own-play slot | — | 320 | 38 | 0 | no | veil at destination |
| Foe play | foe hand → foe play slot (clone width 120) | — | 430 | 36 | 0 | yes | destination hidden until landing |
| Buy/gain → your hand | pile → hand slot (width 130) | — | 340 | 40 | 0 | no | |
| Gain → your deck-top / discard | pile → deck/discard spot (width 130) | — | 340 | 40 | 6° | no | |
| Foe gain | pile → foe discard tally (width 110) | — | 430 | 40 | 0 | yes | fade |
| Shuffle (both) | discard → deck, 3 back-clones | 50ms | 260 | 24 | 0 | foe only | "riffle" of three backs |
| Trash (the burn) | hand/play slot → trash brazier | 55ms | fly 420 + char 620 | 70 | 6° | foe only | see §4.4 |
| Reveal | held above deck (yours) / foe deck | — | hold 1100 (moat: 950) | — | — | yes | see §4.5; width 132 desktop / 110 mobile |
| Phase change | — | — | 0.5s stamp | — | — | no | `seal-stamp` |
| Turn start | — | — | stamp + banner + `wait(260)` | — | — | yes | |
| Game over | — | — | `wait(500)` then end screen | — | — | yes | |

### 4.4 The burn (`burn`)

1. `fly` to the trash spot: **420ms**, arcY **70**, spin **6°**.
2. Char in place (**620ms**, EASE, transform-origin center):
   ```
   0%:   brightness(1)    saturate(1)    opacity 1     scale(1)
   25%:  brightness(1.9)  saturate(1.6)  opacity 1     scale(1.02)      ← flash
   60%:  brightness(0.18) saturate(0.4)  opacity 0.85  scale(0.94)      ← char
   100%: brightness(0.05)                opacity 0     scale(0.78) translateY(8px)
   ```
3. **Embers** burst at the trash spot's center — only fired by the *last* card of a multi-trash group, count `min(30, 12 + 5×groupSize)`. Each ember: 3–7.5px lozenge (`rotate:45deg`, `--crimson-bright`; 30% chance `--aurum` gold), spawn scatter ±13px x / ±9px y, drifts `dx ∈ ±45px`, `dy ∈ −45..−155px`, duration 650–1250ms, easing `cubic-bezier(0.2,0.7,0.4,1)`, keyframes rotate 45°→95°(50%)→150°, opacity 1→0.9→0.
4. Trash spot flame stays lit afterward: `.trash-spot.lit .spot-flame { color: var(--crimson-bright); filter: drop-shadow(0 0 8px var(--crimson)); }`.
5. Reduced motion: whole burn collapses to a 90ms fading fly; embers skipped.

### 4.5 `revealHold` (Spy/Witch reveals, Moat reaction)

Clone appears centered above the source rect (`y = max(8, rect.top − width×1.4×0.35)`), keyframes: enter from `y+14px, scale 0.9, opacity 0` → full at offset 0.18 → hold to 0.82 → exit to `y−10px, scale 0.96, opacity 0`. Duration = `hold` param (1100ms standard, 950ms for Moat) ÷ speed factor; reduced → 400ms. Skipped when the reveal is about to be shown full-size in the human's own decision modal.

### 4.6 CSS micro-animations

- **Counter bump** (any counter change): `counter-bump 0.45s var(--out-expo)` — at 30%: `scale: 1.35; color: var(--crimson-bright)` (coin counter uses `counter-bump-gold`, scale only, keeps aurum). Retriggered via reflow hack.
- **Log entry**: `log-in 0.4s var(--out-expo)` from `opacity:0; translate: 0 0.4rem`.
- **Selection bar**: `bar-in 0.4s var(--out-expo)` from `opacity:0; translate:-50% 0.6rem`.
- **Modal veil**: `veil-in 0.35s` (opacity); **panel**: `panel-in 0.45s` from `opacity:0; translate:0 1.1rem`. Keymap: 0.3s/0.4s.
- **Turn banner**: `banner-pass 1.5s var(--out-expo)` — `0%: opacity 0, translate(-50%,-42%), scale .96` → `16%: opacity 1, centered, scale 1` → hold to `76%` → `100%: opacity 0`.
- **Refuse shake** (illegal click/keypress, `A().refuse(el)`): WAAPI `translateX 0 → −5px → 4px → −2px → 0`, **280ms ease-out**; skipped under reduced motion.
- **Mobile tab slider**: width/translate 0.35s out-expo.

### 4.7 Reduced motion (`@media (prefers-reduced-motion: reduce)`)

```css
*, *::before, *::after { animation-duration: 0.01ms !important;
                         animation-iteration-count: 1 !important;
                         transition-duration: 0.12s !important; }
.is-legal { animation: none; box-shadow: 0 0 14px oklch(0.50 0.20 22 / 0.35); }  /* static glow */
.phase-seal[data-phase="foe"] .phase-name { animation: none; }
```
Plus JS: `fly` 90ms no-arc, `burn` → fade, embers/refuse skipped, reveal 400ms, `wait` clamped to 40ms. Mobile carousels hold cards steady (`scale:1; opacity:1 !important`) and mark focus by crimson border instead.

---

## 5. EVERYTHING ELSE DISTINCTIVE

### 5.1 Card anatomy (build from `cardInner()`)

```html
<button|div class="card card--bare" data-uid data-key data-accent="…">
  <span class="card-cost">3</span>          <!-- lozenge: rotated-45° square ::before,
                                                 abyss fill, 1.5px accent border;
                                                 1.55rem box, Gloock 0.85rem, top/left −0.5rem -->
  <span class="card-art">…inline SVG…</span>
  <span class="card-name">Militia</span>    <!-- Gloock clamp(0.78rem, 1vw, 0.92rem) -->
  <span class="card-kind">Action – Attack</span>  <!-- 0.52rem 600 ls .15em uppercase, accent color -->
  [<span class="card-rules">…</span>]       <!-- only on preview/modal clones -->
  [<span class="key-badge">4</span>]
  <span class="sel-check"></span>
</button>
```

Card ground: `linear-gradient(160deg, oklch(0.19 0.018 22), oklch(0.15 0.014 20) 55%)`, 1px `--rule` border, double-inset hairline `inset 0 0 0 1px oklch(0.13 0.012 20)` + `0 10px 26px oklch(0.05 0.01 20 / 0.5)` drop. Transitions on translate/rotate/border-color/box-shadow/opacity/filter, all 0.3s out-expo. `.card--bare` lets the art flex-fill (hand/play/pile clones); rules text appears only in preview/inspector/modal clones.

**Hand fan:** each stack `i` of `n` gets `--fan = i − (n−1)/2`; `rotate: calc(var(--fan) * 1.6deg)`, `translate: 0 calc(abs(fan) * 0.32rem)` — a shallow arc, ends dipping. Hover/selection cancel the rotation.

### 5.2 Hand stacks

Equal cards in hand collapse into one element (`.card-stack`) with two offset ghost layers: `::before { translate: 4px 4px; opacity: 0.75; }`, `::after { translate: 8px 8px; opacity: 0.4; }` (same gradient/border as the card), plus `<span class="stack-count">×3</span>` (absolute top −0.55rem / right −0.45rem, Gloock 0.8rem, dais bg, rule border). Hand sort: actions (cost desc) → treasures (value desc) → victory (VP desc) → curses. Digits address **stacks**. Clicking/keying a stack during multi-select **cycles**: each press selects one more copy; when the stack (or the prompt's max) is spent, the next press unwinds the whole stack's selections.

### 5.3 Supply piles

`makePile`: `<button class="pile" data-key data-accent>` with `.pile-cost` (lozenge, −0.45rem offsets, 1.45rem), `.pile-art` (46% height), `.pile-name` (Gloock), `.pile-count` (Gloock 0.78rem ash, `::before { content: "× "; }`), `.key-badge`. Ground gradient as cards, `aspect-ratio: 59/91`.

- Hover: `translate: 0 -3px; border-color: var(--accent…)`.
- `.is-affordable:not(:disabled) { border-color: oklch(0.4 0.1 22); }` (subtle crimson-warm) — computed vs `coins` (buy phase) or `coins + hand treasure value` (action phase), requires your turn, no pending, buys > 0.
- **Buy-phase gold light** (the "reachable" cue):
  ```css
  body[data-phase="buy"][data-active="you"] .pile.is-affordable:not(.is-empty) {
    border-color: oklch(0.6 0.085 85);
    box-shadow: inset 0 0 0 1px oklch(0.13 0.012 20), 0 0 16px oklch(0.78 0.10 85 / 0.22);
  }
  ```
  plus `cursor: pointer`.
- **Empty pile:** `.pile.is-empty { opacity: 0.28; filter: grayscale(0.9); }`, art at 0.35 opacity, `.pile-name { text-decoration: line-through; text-decoration-color: var(--ash); }`. Piles stay in place (no removal).
- Desktop: Treasure & Victory render as **mini cards** (no names; cost lozenge 1rem at −0.3rem; count chip bottom-left on `oklch(0.13 0.012 20 / 0.85)`), stacked in vertical columns with vertical-rl rotated labels, column height locked to the kingdom's two rows (`--basics-h`); kingdom is a 5×2 grid of `--pile-w-k`.

### 5.4 Hover preview + inspector + afford line

- Desktop `pointerover` on any `.card[data-key]`/`.pile[data-key]` renders a full-rules clone into the chronicle's `.preview` slot (min-height one card; empty state shows a `✦` in `--rule`). Piles append `.preview-afford` — aurum uppercase microcopy from `affordLine()`: `Affordable now` / `Play N treasure(s) to afford` / `Out of reach this turn` / `Pile exhausted`.
- Right-click (contextmenu, prevented) or touch long-press (**480ms**, cancelled by >12px movement; the trailing click is suppressed via a capture-phase handler) opens the **inspector**: a `reckoning--inspect` modal, words left (name Gloock 1.75rem, kind accent-colored, rules 0.98rem/1.6 max 34ch, cost lozenge 1.7rem + "to buy"), bare card right at `clamp(10rem, 26vw, 12.5rem)`; supply hits add "N left in the supply" + afford line. Esc/Enter/Space/backdrop/× close it.

### 5.5 Selection bar (multi-select prompts)

Fixed, horizontally centered, `bottom: calc(var(--card-w) * 91/59 + 3.2rem)` (above the hand), z-120, hall bg, rule border, notched clip, `0 16px 44px` shadow, `bar-in` entry. Contents: prompt (`0.85rem` bone-dim) + count (Gloock, crimson-bright, "2 of 4") + Confirm (`btn-primary`; disabled and relabeled `Choose N more` until `min` met) + Skip (`btn-ghost`; only when `min === 0`). Single-pick prompts (min=1,max=1) hide Confirm entirely — clicking a legal card resolves instantly.

### 5.6 Decision modal ("The Reckoning")

`#modalRoot.reckoning`: fixed veil `oklch(0.1 0.012 20 / 0.94)` + radial crimson glow, z-150. Panel `min(94vw, 30rem)`, hall bg, rule border, `0 30px 80px` shadow. Head: lozenge glyph + Gloock 1.25rem title, hairline underneath. Optional revealed cards row (full-rules clones at `1.05 × --card-w`). Options row right-aligned: notched buttons each with `<kbd>N</kbd>`; primary is crimson. Primary auto-focused on open; Tab trapped; digits/Enter answer (§2.3). Opening clears `data-kbzone`.

### 5.7 Foe strip & turn-change presentation

- Foe strip: crest + "Mordrane / the veiled count", deck & discard tallies (Gloock numbers), hand as overlapping 17×25px `.back-chip`s (margin-left −7px, gradient backs with inset red hairline).
- His turn: `.foe-strip.is-active { border-bottom-color: var(--crimson); background: linear-gradient(100deg, var(--crimson-whisper), transparent 55%), var(--hall); box-shadow: 0 8px 26px var(--crimson-whisper); }` (0.3s out-expo).
- Turn banner (fixed, 36% viewport height, Gloock `clamp(1.9rem, 5vw, 3.4rem)`): "Your move" (bone) / "Mordrane takes the floor" (`data-who="foe"` → crimson-bright), `banner-pass` 1.5s, pointer-events none.
- Your-turn cues: `body[data-active="you"] .harbor { border-top-color: oklch(0.42 0.13 22); }`; foe's turn dims your hand: `body[data-active="foe"] .hand { opacity: 0.78; filter: saturate(0.85); }` with `cursor: default` on cards.
- AI pacing between moves: 700/360/110ms (normal/fast/blitz); decision answers 620/320/90ms.

### 5.8 Victory / defeat

After `gameOver` + 500ms wait: reckoning panel titled `The crown is yours` / `The crown falls to Mordrane` / `The crown is contested`, two `.score-col`s (winner: crimson border + `linear-gradient(170deg, var(--crimson-whisper), transparent 65%)`), VP in Gloock **2.3rem crimson-bright** with "N VP · M cards" small, per-card breakdown rows (Colony→Curse). Actions: "Survey the field" (ghost; hides the modal to inspect the final table — the phase seal, now `Fallen / new match`, re-summons the verdict) and "New match" (primary, `Enter`). Log carries the full verdict text.

### 5.9 Chronicle (log)

Right rail `clamp(13rem, 16vw, 17rem)`. Entries 0.78rem ash; card names auto-wrapped in `<strong>` (bone-dim, 600) via a name-regex; turn headers (`Turn N` / `takes the floor`) get `.log-turn` — top hairline, uppercase 0.66rem engraved style. Auto-scrolls to bottom. Collapsible to a 2.3rem rail (state persisted `localStorage["dgt-chron"]`); mobile: slide-up sheet (70dvh, 0.4s out-expo) behind a fixed toggle button.

### 5.10 Immediate-command feel (worth porting verbatim)

Commands execute against the engine instantly even while earlier animations are mid-flight; the running `step()` loop drains freshly queued events at its tail, so play never waits for theater. Illegal attempts are answered by the engine's refusal plus the 280ms shake on the offending element. Your own draws/plays/discards/burns never block input; only foe actions and reveals are awaited (paced for legibility).

---

## Appendix: things that do NOT exist (so you don't invent them)

- No sounds/audio hooks of any kind.
- No cleanup dot/state on the phase seal (Action and Buy only; "cleanup" is a momentary engine event that just re-stamps the seal).
- No stacking of duplicate cards in the play area (hand only).
- No `data-kbzone="hand"` setter (the CSS rule for it is dead code).
- No drag-and-drop; click/tap/digit only.
- No hover tooltips — the chronicle preview panel and the inspector modal serve that role.
