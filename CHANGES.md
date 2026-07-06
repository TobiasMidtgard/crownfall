# Changes I Need

> Scratch list for changes I want made to Crownfall. Add items freely — one bullet is fine.
> Claude reads this file to pick up work. Anything under **Done** is finished and can be deleted.

**How to use:** jot the change under the right area. If you know the card / screen / file, say so — it saves a hunt. Priority tags optional: `[now]` `[soon]` `[whenever]`. `(large)` = multi-wave effort, worth scoping first. `❓` = Claude needs a detail before acting.

---

## 🔥 Open — things I want changed

### Table designer / editor
- **#1 — Remove the preview button.** No separate preview; the one view already is the game screen.
- **#14 — One cohesive design screen, not multiple tabs.** `(large)` Merge the separate tabs (table / cards / blocks) into a single unified design surface. *Sets the frame for most items below — probably scope this first.*
- **#11 — Kill all the "fx" icons; the designer must show exact gameplay.** Remove the placeholder/indicator glyphs that appear in the designer but not in-game, so it's pixel-exact WYSIWYG. (Related to #1.)
- **#3 — Group selection drills in on double-click.** Single click selects the whole group; double-click steps into the next nested group, and again down to the item (Figma/Illustrator style). *Today it dives straight to the deepest item.*
- **#4 — Keyboard shortcuts.** `(large-ish)` Full set: Ctrl+Z undo, Ctrl+Y redo, Ctrl+C copy, Ctrl+V paste, Ctrl+X cut, Ctrl+D duplicate, arrow-key nudge, Delete, group/ungroup. Needs a real undo/history stack + clipboard model.
- **#6 — Save a color to my theme.** Let me pin a custom color into a reusable theme palette / swatches, so I'm not re-picking it each time.
- **#8 — Smart container elements with snap slots.** `(large)` Elements gain typed slots that other elements snap into and that auto-space:
  - *Panel switcher* → one slot for the tab buttons (auto-spaces them) + a content area I can drop text / buttons / grids / cards / images into.
  - *Button* → a snap slot for its text / image / shape.
  - General model: containers advertise slots; children snap in; layout reflows.
- **#9 — Vector drawing of custom shapes.** `(large)` A pen/vector tool for arbitrary shapes, beyond the preset shape kinds.
- **#10 — A robust grid element.** Proper grid layout (rows/cols, gaps, auto-fill/wrap) — the backbone for supply/hand/card rows.

### Nodes / scripting
- **#13 — Fix the nodes; make them more functional + more of them.** The block library needs to be broader and more diverse — more block kinds covering more mechanics/UI, and the existing ones made more capable.
- **#12 — Deeper scripting ↔ UI integration.** `(large)` Wire the block system to the visual layer: control the **announce** banner (style/position/duration), **custom card UI**, **button → script** bindings, and more.

### Cards / rules (Forge)
- **#7 — Cards of type Treasure (and Victory) don't render.** The card fails to draw for these types — fix the rendering, and give finer control over card element layout while in there. *(Note: Treasure/Victory render fine in the Codex — so this bug is specific to the table designer's card view, not the card model.)*
- **#15 — Codex cards must be the SAME cards + design as the engine.** Today the Codex renders from a hardcoded parallel list (`src/hall/screens/codexCards.ts`, "lifted verbatim from FableTest") via `CardView.tsx` — divorced from the real playable Dominion def (`src/forge/dominionGame.ts`) the engine/editor/runner use. They drift (engine edits never reach the Codex; the Codex still describes cards as static text) and they're drawn by different components. Make the Codex pull the **same card data** (one source of truth) and use the **same card-design component** as the game — so a card looks and reads identically in the Codex, the editor's Cards tab, and in play. *(Related: #7, #11, #14.)*
- **[now] Militia "cancel" bug.** Playing Militia shows a prompt on my *own* attack that looks cancelable. The opponent's discard should just happen; the attacker shouldn't be asked anything. ❓ *Need your exact repro — what you clicked & saw.*

### Game runner / setup
- **#2 — Create the supply from the game's main menu.** Assemble the supply (which kingdom piles are in play) at game launch — pick from existing cards **and** build brand-new piles. Surface options wherever possible (pile size, cost, which set, random vs hand-picked).
- **#5 — No scrollbars on cards + fix card-fan sizing.** Cards should never render a scrollbar. Root cause seen live: the hand fan (`rn-spread rn-fanned`) collapses to a ~17px-tall sliver while its cards are ~51px, so cards get **clipped and** a scrollbar appears — hiding `overflow` alone would just hide clipped content. So: fix the fan/pile container sizing so cards actually fit, *then* clip overflow. Same overflow seen on the supply piles (`rn-gridz rn-piles`). Applies in the runner and the designer.
- **#16 — Hero CTAs dead-end at the login wall.** The hall's main **"Play Dominion"** and **"Take a seat"** buttons route to `#/tables`, which renders the sign-in "Gates" screen — not a game. (The Forge's ▶ Play launches fine, so only the hero CTAs are affected.) The front-door "Play" button shouldn't look broken. ❓ *Decide: send it straight to a playable/demo table, or keep the login gate but make it clearly a sign-in step?*

---

## 🤔 Decisions I need to make
- **Push improved Militia to my existing games?** The rebuilt (simpler) Militia only reaches already-created games if the Dominion seed is re-pushed — which **overwrites any local edits** to the built-in Dominion. Options: (a) bump seed version → everyone gets it, edits lost; (b) leave it → I delete my Dominion and reload to re-seed just mine.

---

## ✅ Done (delete once confirmed shipped)
- Reusable **"for each opponent"** block + **"discard down to N"** block, and Militia rebuilt to use them (committed, not yet deployed).
