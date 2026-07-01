# Crownfall

A hall for card games — one static web app, three rooms:

- **The Hall** — the face and antechamber. An epic landing, the oath (sign-in),
  **The Tables** (a lobby where you set a table, pick a kingdom, and get seated),
  a Dominion card **Codex**, herald announcements, and freely dockable panels
  (chat, companions, settings). The hall's owner — the keeper — carries the
  mason tools: an in-page edit mode for rewriting the hall's copy, reordering
  its sections, and rehanging its banner (five color themes).
- **The Forge** (`#/forge`) — a full visual card-game engine (Cardsmith):
  design cards, script rules with blocks, lay out the table screen, and play —
  hotseat or against AI. Ships with example games (War, Crazy Eights, Hearts,
  Clash, Dominion, MTG- and YGO-likes).
- **The Table** (`#/play/dominion`) — the flagship match: Dominion against the
  Clockwork Squire (AI), with the hall's three kingdom sets. The game itself is
  a Forge creation, seeded into the Forge as **Dominion** (`dominion-crownfall`)
  — edit it there and the hall plays your edit.

Everything is client-side: no server, no accounts beyond `localStorage`,
hash routing, one deployable `dist/`.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build → dist/
npm test -- --run  # engine + game + hall test suite
```

Demo logins: `tobit` / `crown` (the keeper) · `wren` / `valor` · `hollis` / `oath`.

## Project map

```
src/hall/       the hall: screens, chrome (nav, panels, mason tools), state
src/forge/      the Forge mount, the seeded Dominion def, its table skin
src/shared/     GameDef schema, validation, kingdom sets (the contract)
src/engine/     the deterministic, seeded rules interpreter (pure TS)
src/editor/     game editor + visual block scripting
src/designer/   card template & card data designer
src/runner/     the play screen (screen layouts, AI seats, choices, mobile)
src/examples/   built-in games + tests that play them to completion
```

## Provenance

Crownfall Final unifies three sibling projects: *FableTest* (the hall front-end),
*DominionGameTable* (the original solo Dominion table — its rules, card data, and
table dress live on in the seeded Forge def and its skin), and *CargGameEngine /
Cardsmith* (the engine, editor, and runner). Design language per `FableTest`'s
DESIGN.md: committed crimson on warm near-black, Gloock + Schibsted Grotesk,
ceremony over decoration.

## Deploy

Pushes to `main` build and deploy to **GitHub Pages** via
`.github/workflows/deploy.yml`. The Vite base is relative (`./`) and routing is
hash-based, so the same build also serves from any static host or the local
dev tunnel.
