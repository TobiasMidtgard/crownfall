# Changes I Need

> Scratch list for changes I want made to Crownfall. Add items freely — one bullet is fine.
> Claude reads this file to pick up work. Anything under **Done** is finished and can be deleted.

**How to use:** jot the change under the right area. If you know the card / screen / file, say so — it saves a hunt. Priority tags optional: `[now]` `[soon]` `[whenever]`. `(large)` = multi-wave effort, worth scoping first. `❓` = Claude needs a detail before acting.

---

## 🔥 Open — things I want changed

### Table designer / editor
- **#14 — One cohesive design screen, not multiple tabs.** `(large)` Merge the separate tabs (table / cards / blocks) into a single unified design surface. *Sets the frame for most items below — probably scope this first.*
- **#3 — Group selection drills in on double-click.** Single click selects the whole group; double-click steps into the next nested group, and again down to the item (Figma/Illustrator style). *Today it dives straight to the deepest item.*
- **#4 — Keyboard shortcuts.** `(large-ish)` Full set: Ctrl+Z undo, Ctrl+Y redo, Ctrl+C copy, Ctrl+V paste, Ctrl+X cut, Ctrl+D duplicate, arrow-key nudge, Delete, group/ungroup. Needs a real undo/history stack + clipboard model.
- **#6 — Save a color to my theme.** Let me pin a custom color into a reusable theme palette / swatches, so I'm not re-picking it each time.
- **#9 — Vector drawing of custom shapes.** `(large)` A pen/vector tool for arbitrary shapes, beyond the preset shape kinds.
- **#8/#10 leftovers** — drag-to-reorder inside a flow container directly **on the canvas** (works via Layers panel today); migrate the **desktop** supply to the new layout system.

### Nodes / scripting
- **#13 — Fix the nodes; make them more functional + more of them.** The block library needs to be broader and more diverse — more block kinds covering more mechanics/UI, and the existing ones made more capable.
- **#12 — Deeper scripting ↔ UI integration.** `(large)` Wire the block system to the visual layer: control the **announce** banner (style/position/duration), **custom card UI**, **button → script** bindings, and more.

### Cards / rules (Forge)
- **#7 — Cards of type Treasure (and Victory) don't render.** ❓ **Could not reproduce** (2026-07-06): checked the Codex, the editor card list, a NEW card created with type Treasure, the designer canvas piles, and a live game — every type renders. Most likely your local Dominion was the stale seed-v8 copy; the seed bump shipping now replaces it. **If it still fails after this deploy, note exactly where you see it (which screen + which card).** The "more refined card layout control" half stays open (folds into #14's card editor work).

### Game runner / setup
- **#2 — Create the supply from the game's main menu.** Assemble the supply (which kingdom piles are in play) at game launch — pick from existing cards **and** build brand-new piles. Surface options wherever possible (pile size, cost, which set, random vs hand-picked).

---

## ✅ Done (delete once confirmed shipped)
- **Militia "cancel" prompt** — fixed in the engine (`8a8b3dc`): players with no possible response are auto-passed, so the attacker never sees a Pass prompt on their own attack; response windows land directly on players who can actually react (Moat/Counterspell/traps) and stacks with no possible responders resolve instantly.
- **#5 — no scrollbars on cards** (`32a1429`): cards in authored zones are measured + width-clamped to genuinely fit their rect (fans by height, grids by rows×columns); zone containers clip instead of scrolling.
- **#16 — hero CTAs** (`32a1429`): "Play Dominion" / "Take a seat" go straight to the Dominion setup screen (no login wall).
- **#1 + #11 — exact-WYSIWYG canvas** (`9513b84`): the ⚡/ƒx/⇥/count badge chips are gone from the canvas (still in Layers), and nothing is labeled "preview" anymore — context bar is "Board state".
- **#15 — Codex unified with the engine** (`da2b22c`): the Codex loads the real (keeper-edited) Dominion def and renders through the same CardView + template as the game; filter chips come from the def's types/tags.
- **Reusable "for each opponent" + "discard down to N" blocks**, Militia rebuilt to use them (`04fcb14`).
- **SEED_VERSION → 10**: pushes the rebuilt Militia + def fixes to existing games (overwrites local edits to the built-in Dominion — approved).
- **#8 (smart containers + typed slots) + #10 (robust grid)** — the "layout backbone" wave (merged `83fbc06`): `FlowLayout` on any container (Grid/Row/Column), typed slots, `panelSwitcher` + `image` elements; Dominion mobile supply migrated as proof. Leftovers tracked above.
