# Crownfall Final — merge design (rebuild)

**Date:** 2026-07-01 · **Status:** approved design, rebuilt from the 2026-06-22 merge
(user-approved in that session; directory was wiped, this rebuilds it per the recorded
spec plus the source projects' own PRODUCT/DESIGN docs).

## Purpose & continuity

Crownfall is one hall with three rooms, each from one source project:

| Room | Source | Role in the story |
|---|---|---|
| **The Hall** (`src/hall`) | FableTest | The face and antechamber: landing, oath (login), The Tables, Codex, heralds, panels, keeper's mason tools. |
| **The Forge** (`#/forge`) | CargGameEngine ("Cardsmith") | The engine berth made real: where the hall's games are designed, scripted, and test-played. |
| **The Table** (`#/play/dominion`) | DominionGameTable | The flagship match — Dominion vs the Clockwork Squire — *itself a Forge creation* (a seeded, keeper-editable GameDef). |

The load-bearing continuity change vs FableTest: the lobby ceremony's dead-end
("The engine is still being forged") now **launches a real match**. Setting a table
(practice, or open seat after the fake matchmaking finds a foe) navigates to
`#/play/dominion?set=<kingdom>&foe=<name>` and plays the seeded Dominion def with an
AI opponent. The `#/engine` berth page remains but now announces the Forge is lit,
CTA → `#/forge`.

## Architecture

Vite + React 18 + TS, fully static (hash routing, localStorage), one bundle deployable
to GitHub Pages (`base: './'`) and the crown-fall.com tunnel (port 5173).

- **Skeleton = Cardsmith as-is.** Its `src/` layout is preserved verbatim (engine,
  runner, editor, designer, examples, shared, state, storage) because ~312 headless
  tests import deep relative paths and pin dominion screen-element ids. New code only
  *adds* directories: `src/hall/**`, `src/forge/**`.
- **Routing (App.tsx, hand-rolled hash router):**
  - Hall (eager, light first paint): `#/` landing · `#/login` · `#/tables` · `#/codex` · `#/engine`
  - Table (lazy chunk): `#/play/dominion` → `src/hall/DominionPlay.tsx`
  - Forge (lazy chunk): `#/forge` (home) · `#/forge/edit/:id` · `#/forge/play/:id` → `src/forge/ForgeApp.tsx`
- **CSS containment:** Cardsmith's `src/styles.css` globals are scoped under
  `.forge-root` (`:root` tokens → `.forge-root`, `body`/element rules →
  `.forge-root`-prefixed; its `.btn/.panel/.chip/...` primitives likewise). The hall
  brings its own `crownfall.css` (FableTest port, OKLCH tokens, Gloock + Schibsted
  Grotesk from Google Fonts in index.html). Only true globals kept: box-sizing reset,
  `html,body,#root` margins/height. `DominionPlay` wraps the runner in
  `.forge-root.dominion-skin` so runner primitives resolve while `dominion-skin.css`
  re-dresses the table heraldically.
- **Storage namespaces:** hall keys `crownfall.*` (accounts, session, copy, theme,
  workspace) coexist with Cardsmith's `cardsmith.games.v1` (+`cardsmith.speed`,
  collapse keys). No renames — both keys are load-bearing in two modules each.

## The hall port (FableTest → React)

Faithful port of the five screens + chrome, per the mapper's behavior map
(scratchpad `map-hall.json`): landing (ember canvas, reveal choreography, tilt fan,
section order), login tabs with flavored validation, The Tables (fixtures, kingdom
banners, seat choice, summary), ceremony overlay (searching → coin flip → field, now
with a real "To the table" launch), codex (25 cards, procedural SVG art, filters),
engine berth, heralds, panels (float/dock/pin, workspace persistence), mason tools
(keeper copy editing via `<Edit id fallback>` over `copyText/setCopy`, section
reorder/shelve, five banner themes, restore-armed-twice), demo logins tobit/crown
(keeper) · wren/valor · hollis/oath. Plain-language copy rewrites from the previous
merge are kept ("Take the Oath"→"Create account", "Watchword"→"Password", "The
Clockwork Squire"→"Computer" in functional text, "Reshape the hall"→"Edit this page"),
preserving proper nouns and world flavor in headings/prose.

## Dominion (designer-driven, per the user's recorded preference)

- `src/forge/dominionGame.ts` — `buildDominionDef()`: extends the Cardsmith example
  (15 cards, war-table screenLayout) with the extra base-set kingdom cards so **all
  three lobby sets** (First Game, Sharp Coins, The Witching Hour) are playable;
  kingdom-pile setup blocks are tagged per card so `pickKingdom(def, cards[])` can
  swap sets surgically.
- `src/forge/seedDominion.ts` — seeds id `dominion-crownfall` into user storage with a
  `SEED_VERSION` stamp (bump → re-seed). The hall plays the *stored* def, so keeper
  edits in the Forge change the hall's table. The stock example stays available.
- **Runner extensions** (rebuilt; lost with the wipe): `carousel` zone display mode
  (`.rn-carousel`/`.rn-carouselslot` + TableTab toggle) for the mobile supply,
  `NARROW_QUERY` lowered to 720px to match the original table's breakpoint, CardView
  tags template elements `.cv-<id>` so `dominion-skin.css` can rotate the cost stat
  into the original's diamond.
- `src/hall/DominionPlay.tsx` — parses `?set=&foe=`, applies `pickKingdom`, mounts
  `TableScreen` (seat 0 = signed-in player, seat 1 = AI foe), Play-again + Back to
  the tables; match results append to the chronicle.

## Verification

`npm run build` (tsc + vite) clean · `npm test` all passing (baseline 397 + new tests
for seed/pickKingdom/carousel/hall stores) · live preview structural checks on every
route (screenshots hang headlessly per prior session — use DOM/computed-style checks)
· lazy-chunk check (forge/runner code absent from the entry chunk).

## Publish

git init → initial commit → `gh repo create` (TobiasMidtgard, public) → push.
GitHub Actions workflow builds on push to main and deploys `dist/` to GitHub Pages.
Hash routing + relative base means no SPA-fallback tricks needed. Local dev stays
`npm run dev` on 5173 (crown-fall.com tunnel allowed in vite.config).

## Out of scope (recorded)

The bespoke verbatim React port of DominionGameTable's table (`src/dominion/` in the
old merge, kept-but-not-live) is not rebuilt: one live implementation, the
designer-driven one, per the user's last recorded preference and today's "cohesive"
brief. The original's look is carried by the war-table layout + skin instead.
Known prior simplifications kept: mason reorder/shelve covers landing sections; the
session AI is the runner's generic random bot, not a ported strategy AI.
