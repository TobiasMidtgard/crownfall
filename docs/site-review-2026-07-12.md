# Crownfall site review — 2026-07-12

Six parallel reviewers (hall / forge shell / table designer / runner / multiplayer / cross-cutting) + a live browser walk. Every finding marked **bug** survived an independent adversarial verification pass; one claim was refuted and dropped. Effort: S = small, M = medium, L = large.

## HIGH severity

### Codex shows a stale Dominion catalog to returning visitors after every deploy
**bug** · area: hall · effort: S · `src/hall/screens/Codex.tsx:39`

A returning visitor who goes straight to #/codex sees the OLD seeded def from localStorage (e.g. a pre-v12 copy with none of the 36 new Base/Intrigue cards, and a wrong '<N> cards' count in the header copy). Nothing on the hall's eager path calls ensureDominionSeed() — only the lazy DominionPlay and ForgeApp modules do — so the SEED_VERSION bump that CHANGES #7 relies on ('the seed bump shipping now replaces it') never fires on a codex-only visit. This is a concrete mechanism for stale-card sightings like #7.

*Suggested fix:* Call ensureDominionSeed() at the top of the Codex module (seedDominion is already imported for DOMINION_GAME_ID), or inside the def memo before getGameById().

### Storage-full save failures display as "Saving…" forever — silent data loss
**bug** · area: forge-shell · effort: S · `src/editor/GameEditorPage.tsx:181`

When localStorage is full, saveGame() returns false and saveState becomes 'error' (line 91), but the topbar hint only distinguishes 'saved' vs everything-else: `saveState === 'saved' ? 'Saved ✓' : 'Saving…'`. The user keeps editing under a permanent, reassuring "Saving…" while nothing persists — they discover the loss only after a reload. HomePage shows a storage-full banner, but the editor (where the work actually happens) actively lies.

*Suggested fix:* Handle the 'error' state explicitly: a red "⚠ Couldn't save — device storage full" chip plus a one-click "Export game file" escape (exportGame already exists in InfoTab).

### One misclick permanently destroys actions, triggers, end conditions, phases, and variables — no confirm, no undo
**improvement** · area: forge-shell · effort: S · `src/editor/tabs/ActionsTab.tsx:46`

The ✕ on an action (ActionsTab.tsx:46), trigger (RulesTab.tsx:104), end condition (RulesTab.tsx:183), phase (SystemsTab.tsx:119), and variable (SystemsTab.tsx:269) deletes instantly. These items carry whole block scripts, and the Ctrl+Z history covers only ScreenLayout (TableTab.tsx:187 `past: ScreenLayout[]`), so a stray click on a Dominion-sized action script is unrecoverable. Meanwhile zones, decks, types, tags, and filters all get ConfirmModals — the five most script-heavy item kinds are the only unguarded ones.

*Suggested fix:* Reuse ConfirmModal with reference counts (the countExprRefs idiom from TypesTab): confirm at least when the item has a non-empty script or is referenced by phases/buttons/conditions.

### No search in the card list — 90+ Dominion cards behind a template-only filter
**improvement** · area: forge-shell · effort: S · `src/designer/CardsSection.tsx:48`

The Cards grid's only filter is 'by template' (useless for the seeded Dominion, whose ~90 cards share one template). Finding "Militia" to edit means scrolling a huge tile grid and reading every caption. The setup screen's kingdom picker already proved the fix — it has a search box matching name or type line — but the editor, where cards are actually edited, has none.

*Suggested fix:* Add a search input to the dz-cards-toolbar filtering on card name and type/tag names, same idiom as the kingdom picker; keep the template select as a secondary filter.

### Storage-full save failures show an eternal "Saving…" — silent data loss
**bug** · area: designer · effort: S · `src/editor/GameEditorPage.tsx:181`

saveGame() returns false when localStorage quota is exceeded and setSaveState('error') is set (line 91), but the top-bar hint only renders 'Saved ✓' or 'Saving…' — the 'error' state displays as 'Saving…' forever. The easiest trigger is in the table designer itself: the Image inspector (PropertiesPanel.tsx:1951-1963) reads any uploaded file as an unbounded data URL into the def, so one phone photo blows the ~5MB quota. The author keeps editing under a 'Saving…' badge and loses everything on reload.

*Suggested fix:* Render the 'error' state distinctly ('⚠ Couldn't save — storage full', with an Export escape hatch), and guard the image upload: reject/compress files over a threshold (e.g. downscale via canvas) and show the resulting size.

### Game-over scoreboard and opponent chips leak hidden bookkeeping variables
**bug** · area: runner · effort: S · `src/runner/overlays.tsx:87`

Every finished Dominion game ends on a scoreboard where each player's row reads like 'Actions 1 · Buys 1 · Coins 0 · Victory points 34 · Immune to the attack 0 · Scratch counter 0 · Merchant: first Silver paid 0 · Actions played this turn 2 · Minion mode 0 · Replace gained a Victory 0 · Wishing Well: named card —'. The actual score is buried in internal engine bookkeeping. The same unfiltered list feeds VarChips (OpponentsStrip.tsx:64), so classic-layout opponents' panels show the junk chips all game long. The status bar already filters `v.hidden` for globals (TableScreen.tsx:384) — these two surfaces just forgot.

*Suggested fix:* Add `&& !v.hidden` to the perPlayer filters in GameOverOverlay (overlays.tsx:87) and VarChips (OpponentsStrip.tsx:64). Separately mark Dominion's 'Scratch counter' (dominionGame.ts:1282) and 'Immune to the attack' (examples/dominion.ts:676) as hidden — they're bookkeeping too.

### Status-bar ✕ abandons a live game instantly, with no confirmation
**improvement** · area: runner · effort: S · `src/runner/TableScreen.tsx:374`

The ✕ 'Leave game' button sits first in the always-visible status bar, one accidental tap away on a phone. Tapping it navigates home immediately — the whole game state is gone with no undo (sessions aren't persisted), and in online play the opponent's table freezes with a 'disconnected' banner. A 45-minute Dominion game can vanish from one mis-tap while reaching for 'Log' right next to it.

*Suggested fix:* Gate ✕ behind a small confirm ('Leave the game? Progress is lost.') whenever the game has started and isn't finished; skip the confirm once state.result is set.

### Room stays joinable after the match starts — a second joiner gets a ghost game
**bug** · area: multiplayer · effort: S · `src/runner/net.ts:105`

The host shares the code in a group chat; friend A joins and the game starts. Friend B enters the same code later and ALSO receives a full 'hello' (def+seed) — their table mounts and looks live, but the host only wraps the first connection, so B's moves go nowhere and the 'opponent' never acts. B sits at a fake game with no error, forever.

*Suggested fix:* In hostGame, set a matched flag when the first join resolves; for later connections either conn.close() immediately or send a small {t:'full'} frame the joiner maps to 'That table is already in play.' (joinGame needs the matching reject branch).

### Pending host room is never cancelled on unmount or local start — ghost rooms and mid-game hijack
**bug** · area: multiplayer · effort: S · `src/runner/PlayPage.tsx:100`

Two dead ends: (1) Host a room, tap '← Home' — the Peer stays registered under crownfall-CODE, so a friend joining later gets a hello and mounts a table against a host who isn't there. (2) Host a room, then press '▶ Start game' and play locally — the room stays open, and the moment a friend joins, the netMatch branch (line 119) wins the render and your in-progress local game is silently replaced by a fresh online table.

*Suggested fix:* Cancel the pending handle when it can no longer be honored: an unmount cleanup effect that calls online.cancel(), and cancel + clear online inside onStart. Optionally disable Start (or auto-cancel with a note) while online?.mode === 'hosting'.

### Landing page eagerly downloads the entire game catalog (388kB index chunk)
**improvement** · area: crosscutting · effort: S · `src/hall/HallApp.tsx:19`

First visit to the hall (the marketing landing page) downloads a 388kB eager JS chunk that verifiably contains all 54 Dominion kingdom card definitions plus every example game (MTG, Yu-Gi-Oh, Hearts, Crazy Eights...) before anything paints. On a phone or slow connection the themed landing sits on a blank screen while card data for screens the visitor may never open streams in. The App.tsx lazy seams (ForgeApp, DominionPlay) are defeated because HallApp statically imports Codex, which imports buildDominionDef (src/hall/screens/Codex.tsx:16) and state/store -> examples/index.

*Suggested fix:* Make Codex a React.lazy screen inside HallApp (a RouteLoading-style Suspense fallback already exists in App.tsx). That single seam removes both forge/dominion/* and examples/* from the eager graph, roughly halving the landing bundle.

### "Take a seat" play route downloads the whole editor + peerjs (434kB ForgeApp chunk)
**improvement** · area: crosscutting · effort: S · `src/forge/ForgeApp.tsx:14`

The landing hero CTAs point at #/forge/play/dominion-crownfall, but ForgeApp statically imports HomePage, GameEditorPage and PlayPage, so a visitor who only wants to PLAY downloads the 434kB chunk containing the entire table designer, card designer, block-script editor and the peerjs networking library (verified present in ForgeApp-*.js) before the setup screen appears.

*Suggested fix:* React.lazy the three page components inside ForgeApp (and/or dynamic-import peerjs inside net.ts's hostGame/joinGame so it only loads when someone actually goes online). The existing RouteErrorBoundary/Suspense pattern in App.tsx covers the fallback.

### Forge modals lack dialog semantics and focus management; two don't even close on Escape
**improvement** · area: crosscutting · effort: M · `src/editor/common/Modal.tsx:36`

Keyboard and screen-reader users in the editor can Tab straight out of any open modal into the obscured page behind it: editor/common/Modal.tsx renders a plain div with no role="dialog", no aria-modal, no focus trap, and never moves focus in or returns it to the opener. Worse, CardEditorModal (designer/CardEditorModal.tsx:40) and the HomePage delete-confirm (pages/HomePage.tsx:116) are hand-rolled backdrops that don't respond to Escape at all. The runner's sheets (runner/sheets.tsx:80-96) and GameOverOverlay already do all of this correctly, so the app feels inconsistently broken.

*Suggested fix:* Give Modal.tsx the runner-sheet treatment (role=dialog, aria-modal, focus-in on open, Tab wrap, focus restore), then replace the two hand-rolled backdrops in CardEditorModal and HomePage with that shared Modal/ConfirmModal so Escape and focus behave everywhere.

## MEDIUM severity

### Landing page eagerly downloads the entire Dominion def builder because Codex is statically imported
**improvement** · area: hall · effort: S · `src/hall/HallApp.tsx:19`

First paint of the hero waits on a 387 KB index chunk that bundles dominionGame.ts (81 KB src), examples/dominion.ts (38 KB) and all three Intrigue card modules — grep confirms 'Moneylender' lives inside dist/assets/index-*.js, the only script index.html loads. App.tsx's own design comment promises 'three areas, three chunks', but Codex.tsx lines 12-17 (CardView, designerUtils, store, seedDominion, dominionGame) drag the forge into the eager hall bundle; mobile GitHub-Pages visitors feel the slowest possible landing.

*Suggested fix:* React.lazy the Codex screen in HallApp (Suspense fallback in the style of App.tsx's RouteLoading), so the def builder + CardView split into a chunk loaded only on #/codex.

### Sign-in gate on #/play/dominion is inconsistent, and login forgets where you were going
**improvement** · area: hall · effort: M · `src/hall/DominionPlay.tsx:59`

The identical practice-vs-AI match is playable with zero login from the landing hero (#/forge/play/dominion-crownfall — shipped decision #16 removed that wall), yet a bookmarked or shared #/play/dominion?set=…&first=… link bounces to #/login with 'Sign in to reach the tables', and after signing in Login.tsx (lines 105/139) always dumps you at #/tables — the set/foe/first params are gone. A shared match link is a dead end; there is no returnTo mechanism anywhere in the hall.

*Suggested fix:* Either drop the gate for practice launches (matching #16's policy), or stash the intended hash before the redirect and have Login navigate back to it on success instead of hard-coding #/tables.

### 'Create account' CTAs open The Gates on the Sign in tab
**improvement** · area: hall · effort: S · `src/hall/screens/Landing.tsx:196`

The season call-to-arms button says 'Create account' (and even carries data-cta="oath"), but Login.tsx initializes tab='signin' (line 35) with no way to request the oath panel — a newcomer lands on a sign-in form and must notice the second tab themselves. Same for anyone told to 'create an account' to reach the tables.

*Suggested fix:* Support #/login?tab=oath and default the Login tab from it. Note parseHash in App.tsx currently discards the query for hall routes, so hall pages need the params passed through (or Login can read window.location.hash directly).

### Friends panel 'Invite' claims success but sends nothing
**improvement** · area: hall · effort: M · `src/hall/chrome/PanelsHost.tsx:771`

Clicking Invite heralds 'Invitation sent to Ser Calloway of the Eaves.' — a plain success claim with no in-fiction hedge — and then nothing ever happens; a user can sit waiting for a match to start. Meanwhile real room-hosting (PeerJS 6-letter code) already exists one route away on the game setup screen. (Distinct from the tracked 'take a seat' ceremony item: this is the Friends panel's copy overpromising.)

*Suggested fix:* Wire Invite to the real host-a-room flow (open the setup screen's host mode and drop the room code into the chat whisper), or soften the copy to an honest 'coming soon' like the Watch button's 'benches are still being carved'.

### The stack/response system (stacked, speed, announce) is unreachable from the editor UI
**improvement** · area: forge-shell · effort: M · `src/editor/tabs/ActionsTab.tsx:52`

ActionDef.stacked / speed / announce (types.ts:866-873) and TriggerDef.stacked (types.ts:911) power the whole reaction/response-window system (Moat, traps), and validate.ts:157 even warns about announce-without-stacked — yet ActionsTab renders only name/target/legality/script and RulesTab only name/event/condition/script. A user who clones Dominion sees reactions work but can never author their own; the warned-about state is literally impossible to fix (or reach) through the UI.

*Suggested fix:* Add a "Resolves via the stack" toggle + response-speed select to ActionsTab, revealing an Announce script sub-editor when stacked; add a stacked checkbox to triggers in RulesTab.

### Actions and Rules panels render every item fully expanded — a giant scroll instead of the SystemsTab idiom
**improvement** · area: forge-shell · effort: M · `src/editor/tabs/ActionsTab.tsx:30`

Every action renders its complete TargetEditor + ConditionBuilder + BlockScriptEditor inline, and every trigger/end condition does the same in RulesTab. With a Dominion-scale def (a dozen+ actions, triggers holding the pile-watcher script) the panel is a disorienting wall where the item you want is somewhere in thousands of pixels of expanded editors. SystemsTab (the gold standard) solved this: compact inline rows ("N actions · N blocks — edit ›") with one detail area.

*Suggested fix:* Adopt the SystemsTab pattern: compact name + target/event summary rows with inline rename and delete, and a single detail panel for the selected item's condition + script. Also enables a two-column addable grid (Triggers | End conditions) in RulesTab.

### Read-only mode leaves all panel controls enabled but silently inert
**improvement** · area: forge-shell · effort: S · `src/editor/GameEditorPage.tsx:120`

For built-in examples and the keeper-gated Dominion, onChange just returns — but panels never learn they're read-only. A visitor opens Actions, clicks "+ Add action", types into fields, toggles checkboxes: everything looks live and nothing happens. The explanation banner sits over the canvas, not the panel, so once a panel is open there is no visible reason for the dead controls. Only the topbar name input gets a proper readOnly attribute (line 164).

*Suggested fix:* Pass readOnly down to panels and disable/dim their inputs, or overlay open panels with a slim "read-only — Clone & edit to change" strip reusing the banner's CTA.

### Issues list entries aren't clickable — you must hunt down each problem manually
**improvement** · area: forge-shell · effort: M · `src/editor/GameEditorPage.tsx:296`

The Issues modal shows rows like `Action "Buy" > legality — Uses a zone that no longer exists`, but they're plain text. To fix anything you must close the modal, guess which rail section owns the issue, open it, and scroll through the (fully-expanded) list to find the named item. With cascade deletes (zone removal flags every referencing script) that's a long manual scavenger hunt.

*Suggested fix:* Make each issue row a button that opens the owning panel (the `where` prefix — Action/Rule/Filter/Card/Systems — maps 1:1 to a SectionId); even without deep-scroll targeting, landing in the right panel removes most of the hunt. Structured `where` data (section + item id) would enable full jump-to-item later.

### Paste and component-insert in focus mode squash every element to the same centered 30×30 box
**bug** · area: designer · effort: S · `src/editor/tabs/TableTab.tsx:455`

pasteClipboard carefully offsets each pasted rect (+2% per paste), then in focus mode routes through insertIntoFocusedChildren (screenModel.ts:427-432) which overwrites every rect with {x:35,y:35,w:30,h:30}. Copy two differently-sized siblings, focus a panel, Ctrl+V: both land as identical stacked 30×30 boxes — sizes, aspect ratios and relative arrangement destroyed. Saved components inserted while focused get the same squash (a wide phase-track becomes a square).

*Suggested fix:* In insertIntoFocusedChildren, keep the incoming rect (clamped into 0-100 of the focused box) for paste/component inserts, and only apply the centered 30×30 default for brand-new palette elements; preserve relative offsets for multi-paste.

### Undo half-reverts one-click creators, stranding orphan zones/actions and causing "Deck 2" names
**bug** · area: designer · effort: M · `src/editor/tabs/TableTab.tsx:421`

Undo snapshots only screenLayout. Drop a 'Deck' holder (def zone + element in one tap), press Ctrl+Z: the element disappears but the zone def stays in the Systems page; dropping the holder again names it 'Deck 2' (Palette.tsx:54-60 sees the orphan). Same for the counter's '⚡ Create ±1 actions & bind' (screenModel.ts:763-783): undo unbinds the steppers in the layout but the two created actions remain registered in every phase. Users end up with mystery zones/actions they never knowingly kept.

*Suggested fix:* Make history entries capture the def deltas of compound creators (store {zones, actions, phases, screenLayout} for those pushes), or garbage-collect the just-created defs when the paired layout insert is undone.

### No marquee selection — background drag only pans, multi-select is shift-click one-by-one
**improvement** · area: designer · effort: M · `src/editor/tabs/table/ScreenCanvas.tsx:802`

onCanvasDown treats every empty-felt drag as a pan. To align or group a dozen supply piles you must shift-click each one; there is no rubber-band select like every other canvas editor (Figma, Photoshop) — which this designer otherwise emulates (drill-in, guides, align/distribute). Space-drag and wheel/two-finger already cover panning, so plain drag is an underused gesture.

*Suggested fix:* Make plain left-drag on empty felt draw a marquee that selects intersecting top-level elements (of the current scope), keeping space-drag/middle-drag/two-finger for pan.

### Zone inspector is a ~12-section unbroken scroll with niche options above common ones
**improvement** · area: designer · effort: M · `src/editor/tabs/table/PropertiesPanel.tsx:669`

Selecting a zone renders Position, a huge Zone section, a full Card-style StyleSection, 5 Card-part rows, Card filter, arrive effect, Keyboard group, then Style, States, Visibility & animation, Collapsible panel, Deck and Remove — all expanded, always. The everyday toggles 'Show zone name'/'Show card count' sit at the very bottom of the Zone section (lines 889-890), below the niche 'Keyboard group' and 'When cards arrive' controls; finding one setting is a hunt-scroll every time.

*Suggested fix:* Make tt-prop-sections collapsible (persist open state per kind), and reorder: common display toggles first, power features (keyboard group, arrive effect, card filter) into a collapsed 'Advanced' cluster.

### Discarding the custom screen is permanently unrecoverable — switching back seeds a fresh starter
**improvement** · area: designer · effort: M · `src/editor/tabs/TableTab.tsx:100`

Confirming 'Back to the automatic layout?' sets screenLayout to null; the Workspace (which holds the undo history in a ref) unmounts, so Ctrl+Z can never bring the design back, and clicking 'Custom screen' again builds a brand-new starter layout. One misread confirm throws away hours of design with zero recovery path.

*Suggested fix:* Retain the last design instead of deleting it — e.g. keep the layout under a disabled flag (or stash it in the def/localStorage) so re-enabling 'Custom screen' offers 'Restore your previous design' alongside 'Start fresh'.

### Announcement snackbar drops all but the last log line of a batch and truncates long ones
**bug** · area: runner · effort: M · `src/runner/TableScreen.tsx:336`

One engine settle routinely appends several log entries (play Smithy: 'plays Smithy' + 'draws 3 cards'; an attack adds more), but the effect only shows `state.log[length-1]`, so players watching the table see just the final line of what the AI or opponent did. On top of that, .rn-snackbar is `white-space: nowrap` with ellipsis (runner.css:574), so any announcement longer than ~480px is cut mid-sentence — on a phone most attack/reaction lines end in '…'. Players are forced into the Log drawer to know what just happened.

*Suggested fix:* Queue new log entries and show them sequentially (or a two-line pill with '+N more'), and let the pill wrap to 2 lines before ellipsizing. Keep the existing live region so screen readers get every entry.

### A second guest joining an already-full room gets a hello and a permanently frozen table
**bug** · area: runner · effort: S · `src/runner/net.ts:106`

Host shares the room code with two friends. The first join resolves the match, but the host's 'connection' handler stays live and answers EVERY later {t:'join'} with a full {t:'hello'} (net.ts:105-111) — the promise is already resolved, so only the first connection is wrapped. The second friend's client receives the hello, mounts the table, and then waits forever: no moves ever arrive, no error, no banner. It looks like the game started and then hung.

*Suggested fix:* After the first join resolves (or when cancelled), respond to further connections with a rejection frame (e.g. {t:'full'}) and close them; have joinGame surface 'That table is already full.' via the existing error path.

### First hotseat turn opens with a pointless 'Pass the device' curtain
**improvement** · area: runner · effort: S · `src/runner/TableScreen.tsx:164`

In any 2-human hotseat game with hidden zones, the person who just tapped '▶ Start game' is immediately shown a full-screen 'Pass the device to Player 1 — their cards stay hidden…' curtain and must tap 'I'm Player 1 — show my cards' before seeing the table they just started. revealedSeat initializes to null, so the very first render always curtains, even though the starter is obviously holding the device.

*Suggested fix:* Initialize revealedSeat to the initial human viewer's id (the seat that pressed Start is holding the device), so the curtain first appears at the first actual seat handoff.

### Disabled Start/Host buttons explain themselves only via desktop-hover title tooltips
**improvement** · area: runner · effort: S · `src/runner/SetupScreen.tsx:262`

With an incomplete kingdom, '▶ Start game' (line 259-264) and '🌐 Host a room' (line 279-285) render disabled with the reason in a `title` attribute — which never shows on touch devices, and often not at all on disabled elements. A phone user who unpicked a card sees a dead Start button with no visible explanation anywhere near it; the '7 of 10 piles' chip is far up inside the Kingdom panel and may be scrolled offscreen.

*Suggested fix:* When the gate fails, render the reason as visible helper text directly under the button ('Pick exactly 10 kingdom piles first — 7 chosen'), or keep the button enabled and scroll/flash the Kingdom panel on tap.

### Peer-disconnect banner is dismissible, reuses the scriptError channel, and the table isn't actually frozen
**bug** · area: multiplayer · effort: M · `src/runner/session.ts:131`

When the opponent's tab closes, the banner says 'the table is frozen' — but if it's your turn you can keep tapping cards and the local engine happily applies moves into the void. Dismiss the ✕ (or trigger any later script error, which overwrites the same field) and every trace that the game is dead vanishes: the table just looks like the opponent is thinking forever.

*Suggested fix:* Add a dedicated netDown flag to SessionSnapshot: set on net.onClose, have refresh() return no moves while set, and render a persistent (non-dismissible) overlay/banner with a 'Back to setup' action instead of piggybacking on scriptError.

### No desync detection — a failed send or rejected remote frame silently forks the game
**improvement** · area: multiplayer · effort: M · `src/runner/session.ts:185`

In performHumanMove (and runAiMove:335) net.send sits inside the same try/catch as the engine call: if the data channel hiccups mid-send, the move applies locally but never reaches the peer, and the catch comment assumes 'stale move'. drainNet:255 likewise swallows a remote move our engine rejects. Either way the two tables diverge permanently with zero warning — players see different boards and argue about what happened.

*Suggested fix:* Move net.send outside the engine try (or surface its failure), and attach a cheap state fingerprint (e.g. log length + a rolling hash) to every move/answer frame; on mismatch show an honest 'connection out of sync — this match can't continue' surface instead of silence.

### Failed matchmaking leaks live Peer connections; the error screen's Cancel is a no-op
**bug** · area: multiplayer · effort: S · `src/runner/PlayPage.tsx:93`

Type a wrong code → 'No open table with that code.' → Back → retry: each attempt creates a new Peer, and neither joinGame's reject path (net.ts:130 — 'peer-unavailable' is non-fatal, the peer survives) nor failOnline (which replaces the real cancel with () => undefined) destroys the old one. Broker websockets pile up per retry for the whole session.

*Suggested fix:* Destroy the peer inside net.ts's reject handlers (peer-unavailable is non-fatal so PeerJS won't do it), and have failOnline keep the original handle's cancel so 'Back' tears the peer down.

### Setup edits made while 'Waiting for a challenger…' are silently ignored
**improvement** · area: multiplayer · effort: S · `src/runner/PlayPage.tsx:102`

hostGame captures runDef + seed at the click; but while the room waits, the kingdom picker, seed reroll and name field above stay fully interactive. A host who tweaks the kingdom (or rerolls the seed) while waiting gets the OLD kingdom/seed when the friend joins — with no hint anything was discarded.

*Suggested fix:* Either disable/dim the kingdom, seed and seat panels while online is pending (with a 'locked while the room is open' note), or auto-cancel-and-rehost on change.

### Room code has no copy button and no shareable join link
**improvement** · area: multiplayer · effort: S · `src/runner/SetupScreen.tsx:310`

The host must manually transcribe the 6-letter code into a chat app (painful on mobile), and the friend must independently find crown-fall.com, navigate to a game's setup screen, scroll to 'Play online' and type the code. Nothing tells either of them the second half — the most likely first-online-game outcome is 'where do I put this code?'.

*Suggested fix:* Add a 📋 copy button (navigator.clipboard + 'Copied' feedback) and a share link like #/play/<gameId>?join=CODE that PlayPage reads on mount to auto-open the join flow — one pasted URL does everything.

### Whole-def validation runs on every keystroke and every color-scrub pointermove
**improvement** · area: crosscutting · effort: S · `src/editor/GameEditorPage.tsx:128`

Typing in the game-name field or any card field, and especially dragging the ColorPicker's hue/saturation rails (which emit onChange per pointermove, ColorPicker.tsx:80-90), re-runs validateGameDef over the ENTIRE def — a deep walk of every card's ability block trees, all zones, phases and expressions — on every input event. On the seeded Dominion def (86+ cards with block scripts) color scrubbing and fast typing visibly stutter; the 400ms autosave debounce doesn't cover validation.

*Suggested fix:* Debounce the issues computation (reuse the 400ms save debounce or useDeferredValue on draft for the validateGameDef memo). The issues chip updating half a second late is invisible; the input lag is not.

### Autosave rewrites every stored game to localStorage, and every other tab re-parses them all
**improvement** · area: crosscutting · effort: M · `src/storage/storage.ts:53`

persistGames JSON.stringifies the WHOLE games array — the large seeded Dominion def plus every user game, including base64 card images the editor itself warns 'bloat device storage' — on every 400ms autosave flush while editing one game. Each write also fires the storage event in every other open tab, where loadGames re-parses, migrates AND deep-validates every game (isStructurallySound -> validateGameDef, storage.ts:45). With a couple of image-heavy games this is megabytes serialized per pause-in-typing, hastening the quota failure that flips the editor into its 'storage is full' error state.

*Suggested fix:* Store one localStorage key per game (cardsmith.game.v2.<id> plus a small index; migrate cardsmith.games.v1 on first load) so a save serializes only the edited def, and cross-tab sync only reloads the changed key.

### "Cardsmith" leaks into user-facing copy: import errors and export filenames
**improvement** · area: crosscutting · effort: S · `src/storage/storage.ts:76`

A user who has only ever seen 'Crownfall' and 'The Forge' hits Import with a bad file and is told 'Not a valid Cardsmith game file (not JSON).' — a product name that appears nowhere else in the UI, reading like a wrong-app error. Exported games are also named '<game>.cardsmith.json' (storage.ts:66), so the files they share carry the ghost brand too.

*Suggested fix:* Reword both parseImportedGame errors to 'Not a valid Crownfall game file...' and change the export suffix to '.crownfall.json' (keep accepting any .json on import, which already works since import sniffs structure, not filename).

### Kingdom picker: selected tiles are color-only and identical to hover
**improvement** · area: crosscutting · effort: S · `src/runner/runner.css:1775`

In the setup screen's kingdom grid, a picked card gets border-color: var(--accent-2) — the EXACT same border a merely-hovered card gets (runner.css:1775 vs 1777), plus a faint 12% background tint. Mousing across the grid makes unpicked cards look picked, and colorblind/low-vision players have no non-color cue at all (aria-pressed exists but nothing visual). Miscounting which 10 piles you picked means Start stays disabled with no obvious culprit.

*Suggested fix:* Add a visible check glyph to selected tiles (the tag chips in CardEditorModal already use the '✓ ' prefix pattern) and differentiate hover (e.g. dashed or lighter border) from selected (solid + check).

## LOW severity

### New accounts are silently christened '<Handle> of the Yard'
**improvement** · area: hall · effort: S · `src/hall/state/auth.ts:136`

Registering as 'bob' makes every screen call you 'Bob of the Yard' — the Create account panel has a sigil picker but no display-name field, no preview, and no hint that renaming exists (it is buried in the Profile & settings panel behind the profile dropdown).

*Suggested fix:* Add an optional display-name field to the oath panel, or herald once after registration ('You are sworn in as Bob of the Yard — rename yourself under Profile & settings.').

### Chronicle seeds every new player with matches starring 'Tobit'
**improvement** · area: hall · effort: S · `src/hall/screens/Tables.tsx:55`

A brand-new account's chronicle opens with 'Tobit took the realm from Lady Wrenfield…' and 'Tobit over Ser Calloway…' — fixture rows sorted into the same newest-first timeline as the player's real recorded matches, while the profile aside beside them says 0 victories / 0 games. It reads like your own falsified history rather than hall lore.

*Suggested fix:* Personalize the fixture texts to the signed-in name, visually mark them as hall lore, or drop them once the player has real chronicle entries.

### Profile dropdown stays open when keyboard focus tabs out of it
**improvement** · area: hall · effort: S · `src/hall/HallApp.tsx:100`

Keyboard users who Tab past the last menu item (Sign out) move focus into the page while the menu keeps floating over the content — only Escape, arrow keys, or a pointer click outside close it (the outside-close handler listens to pointerdown only).

*Suggested fix:* Close the menu on focusout when e.relatedTarget falls outside rootRef (or trap Tab within the menu the way Summons does).

### Footer still calls Crownfall 'a front-end demonstration' while the site ships a real engine and online multiplayer
**improvement** · area: hall · effort: S · `src/hall/screens/Landing.tsx:242`

The hero and Engine page proclaim 'the Forge is lit' and real P2P play exists, yet the footer on the same landing page disclaims the whole site as 'a front-end demonstration for a card-game platform' — a visitor deciding whether the games are real gets two contradictory answers one scroll apart.

*Suggested fix:* Update the footer note to reflect reality (real engine, real online play, games authored in the Forge) while keeping the Donald X. Vaccarino attribution.

### Card designer still uses native window.confirm/prompt for destructive and naming flows
**improvement** · area: forge-shell · effort: S · `src/designer/TemplatesSection.tsx:66`

Deleting a template — which also deletes every card using it — happens behind an unstyled window.confirm with \n-formatted text (TemplatesSection.tsx:64-66). Same native dialogs for card delete (CardEditorModal.tsx:34), ability delete (AbilitiesEditor.tsx:66), field removal (TemplateSettings.tsx:72), and component naming via window.prompt (Palette.tsx:198, PropertiesPanel.tsx:337, 409). Everywhere else the editor shows the styled ConfirmModal, so these feel broken/jarring, especially on mobile.

*Suggested fix:* Swap them for the shared ConfirmModal (which already supports rich messages for the "N cards will be deleted too" warning) and a small name-input modal for the save/rename-component prompts.

### Stale "tab" copy and dead-end cross-panel hints — the tab bar no longer exists
**improvement** · area: forge-shell · effort: S · `src/editor/tabs/TypesTab.tsx:81`

Hints still direct users to tabs that became rail panels, as plain text with no way to get there: "Assign it on each card in the Cards tab" (TypesTab.tsx:81), "design some in the Cards tab first" (InfoTab.tsx:203), "define them in the Types tab" (CardEditorModal.tsx:132 — its comment admits there's no tab-switch callback), "create them in the Actions panel" (SystemsTab.tsx:387). A new user reads the hint, then scans the UI for a tab bar that isn't there.

*Suggested fix:* Thread an onOpenSection(id) callback from GameEditorPage (openPanel already exists; onOpenCards shows the pattern) into panels, turn the hints into links, and normalize copy to "panel".

### Cards panel always opens on Templates, even when the game is full of cards
**improvement** · area: forge-shell · effort: S · `src/designer/CardsTab.tsx:17`

CardsTab hardcodes useState('templates'), so every visit to the Cards panel — the most common destination for balance tweaks and text fixes — lands on the template designer first, adding a click before you can touch a card. For a Dominion clone that's 1 template vs ~90 cards; the wrong sub-section is the default in exactly the games with the most card edits.

*Suggested fix:* Default the section to 'cards' when def.cards.length > 0 (templates otherwise); keep an explicit prop override so the canvas's "✎ Edit card design" bridge can still land on Templates.

### Focus-mode Box width/height knobs push the zone off-screen (no x/y clamp)
**bug** · area: designer · effort: S · `src/editor/tabs/table/ScreenCanvas.tsx:1841`

The Card-chrome panel's 'Box width'/'Box height' steppers write rect.w/h with min 4, max 100 but never account for rect.x/y — a zone at x=45 stepped to width 100 extends to x+w=145, hanging past the screen edge where players will never see it. The equivalent inspector steppers (PropertiesPanel.tsx:437-438) correctly clamp max to 100−x.

*Suggested fix:* Clamp the knob's max to 100−rect.x (resp. 100−rect.y), or shift x/y down as the box grows so the element stays on screen — matching the inspector steppers' behavior.

### Power gestures and shortcuts are invisible — no shortcuts reference anywhere in the designer
**improvement** · area: designer · effort: S · `src/editor/tabs/table/PropertiesPanel.tsx:178`

The only hints shown are pan/zoom/shift-click (ScreenProps) and the focus breadcrumb's 'Esc backs out'. Ctrl+click deep-select, double-click drill-in vs inline text edit, space-drag pan, Shift=5% nudge, Ctrl+G/Shift+G group, Ctrl+D duplicate, cross-variant copy/paste, Shift=15° rotate snap, and Layers' double-click-name rename are all undiscoverable unless you read the source. Users work the slow way without knowing the fast way exists.

*Suggested fix:* Add a small '⌨' toolbar button opening a shortcuts/gestures cheat-sheet popover (one static component), and mention drill-in and inline text editing in the empty-selection Screen panel hint.

### Component library uses window.prompt/confirm for save, rename and replace
**improvement** · area: designer · effort: M · `src/editor/tabs/TableTab.tsx:380`

⬡ Save (PropertiesPanel.tsx:409), multi-save (line 337), palette rename (Palette.tsx:198), and the replace-existing flow all pop native browser prompts that clash with the app's styled modals, can't be themed, and read badly — 'Replace the saved component "Deck"? Cancel keeps both.' makes Cancel a create action. Insert-with-missing-bindings (TableTab.tsx:409) is a third confirm(). On mobile these native dialogs cover the whole page.

*Suggested fix:* Reuse the existing Modal/ConfirmModal components: one small 'Save component' modal with a name field and an explicit Replace/Keep-both choice when the name collides.

### Canvas never refits on window resize or device rotation
**improvement** · area: designer · effort: S · `src/editor/tabs/table/ScreenCanvas.tsx:430`

Fit reruns only on fullscreen/aspect/variant/focus changes. Resize the browser window, snap it half-screen, or rotate a tablet and the stage stays at the old zoom/offset — often mostly off-screen — until the user finds and clicks the Fit button.

*Suggested fix:* Add a ResizeObserver on the viewport (or a window resize listener) that re-runs fitRef.current() debounced, at least when the user hasn't manually panned/zoomed since the last fit.

### Script-error banner is buried behind open choice sheets and the log drawer
**bug** · area: runner · effort: S · `src/runner/runner.css:585`

.rn-banner sits at z-index 45, below .rn-sheet-backdrop (60), .rn-log (71) and .rn-gameover (80). If a rule errors while a blocking engine choice is open — exactly when script errors tend to fire — the warning banner is dimmed under the sheet's backdrop blur and its dismiss ✕ can't be clicked (the backdrop eats the pointer; blocking sheets have no onClose). The player sees a mysteriously darkened scrap of red at the top they can't interact with.

*Suggested fix:* Raise .rn-banner above the sheet layer (e.g. z-index 65+, or 85 to clear game-over too); it's a transient alert and should never be occluded by other chrome.

### Log drawer lacks the modal manners every other overlay has
**improvement** · area: runner · effort: S · `src/runner/overlays.tsx:141`

Choice sheets and the game-over card both set role=dialog/aria-modal and trap Tab (sheets.tsx:51-79, overlays.tsx:62-83), but the log drawer is a bare aside: a keyboard user who tabs past the ✕ lands on the obscured, backdrop-covered table behind it and can activate cards they can't see; screen readers aren't told the table is inert. Escape and focus-restore work — the trap and dialog semantics are the missing half.

*Suggested fix:* Give the drawer role='dialog' aria-modal='true' and reuse the same Tab-wrap handler the sheets use (it's nearly copy-paste from SheetBase).

### Mobile screen-variant breakpoint is 720px while every doc and comment promises 1024px
**improvement** · area: runner · effort: S · `src/runner/ScreenRenderer.tsx:77`

NARROW_QUERY is '(max-width: 720px)', but TableScreen's contract comment (TableScreen.tsx:9), activeScreenVariant's doc (layoutGeometry.ts:748) and the editor's 'Mobile' preview promise the mobile tree 'below 1024px'. On a 768px iPad or large phone in landscape, players get the dense desktop war table letterboxed down (tiny cards, hover-tuned spacing) even though a touch-first mobile variant exists — and a keeper testing 'mobile below 1024' in the designer can't reproduce what devices actually show.

*Suggested fix:* Pick one number and align code + comments (1024px matches the authored intent and the designer's device preview); alternatively switch on pointer coarseness plus width.

### Multi-action picker title reveals a face-down card's name
**bug** · area: runner · effort: S · `src/runner/TableScreen.tsx:244`

onCardTap sets the ActionPickSheet title to `state.cards[cardId]?.name` without checking visibility. Any custom game with two-plus legal actions targeting a face-down card (blind-flip / memory-style defs — TableCard happily makes face-down cards tappable when they have moves) pops a sheet headlined with the hidden card's real name before the player has chosen to flip it, spoiling the reveal.

*Suggested fix:* Resolve the title through isCardVisibleTo like everywhere else: use the card name only when visible to the viewer, else 'Face-down card' (mirroring the aria-label convention in ZoneViews.tsx:854).

### Raw PeerJS error strings leak into the setup screen
**improvement** · area: multiplayer · effort: S · `src/runner/net.ts:130`

Anything other than a bad code surfaces as 'Connection service: <PeerJS internals>' — e.g. 'Connection service: Lost connection to server.' during a broker outage, or socket-error jargon on flaky wifi. No retry hint, no plain-language cause.

*Suggested fix:* Map the common e.type values ('network', 'server-error', 'socket-error', 'socket-closed', 'unavailable-id') to friendly copy ('The connection service is unreachable — check your internet and try again') and keep the raw message as a small detail line.

### Status-bar ✕ leaves an online match instantly with no confirmation
**improvement** · area: multiplayer · effort: S · `src/runner/TableScreen.tsx:374`

One accidental tap on the ✕ (top-left, easy to hit on mobile) navigates home, unmounts PlayPage and closes the link — the opponent's table freezes with 'the other player disconnected' and there is no way back (no reconnection). A 40-minute Dominion game dies to a mis-tap.

*Suggested fix:* When the session has a net link (and isn't finished), gate the ✕ behind a small confirm ('Leave the match? Your opponent's table will freeze.'); consider a beforeunload prompt for tab closes too.

### document.title never changes — every tab reads "Crownfall — The Hall"
**improvement** · area: crosscutting · effort: S · `src/App.tsx:98`

Open the editor in one tab, a live table in another and the Codex in a third: all three browser tabs, every history entry, and every bookmark read the identical 'Crownfall — The Hall'. Users juggling the Forge and a running game can't tell tabs apart, and Back-button history is an unlabeled wall.

*Suggested fix:* Set document.title in App's hashchange effect per area ('The Forge', 'Codex', 'Playing <game>'), and in GameEditorPage include the game name (it already has draft.meta.name live).

### Card delete uses a native window.confirm while every other delete has a styled confirm
**improvement** · area: crosscutting · effort: S · `src/designer/CardEditorModal.tsx:34`

Deleting a game, a zone, or a component gets the themed ConfirmModal with a red Delete button; deleting a CARD pops the browser's raw OS confirm dialog — jarringly off-brand, unstylable, and it blank-freezes the page (and in some browsers can be suppressed via 'prevent additional dialogs', silently making cards undeletable).

*Suggested fix:* Replace window.confirm with the existing ConfirmModal from editor/common/Modal.tsx (it already stacks correctly over the card modal via the portal + modal stack).

### Deleting a game leaves its per-game localStorage keys behind forever
**improvement** · area: crosscutting · effort: S · `src/state/store.ts:70`

Every game accumulates per-device keys — cardsmith.sel.<defId>.<groupId> (selector choices, runner/layout.ts:49) and cardsmith.collapse.<defId>.<elId> (collapsed panels, layout.ts:34) — but deleteGame only removes the def. Users who iterate by cloning games (each clone gets a fresh uid) accrete orphaned keys indefinitely, quietly eating the same quota whose exhaustion triggers the 'storage is full' banner and failed saves.

*Suggested fix:* In deleteGame, sweep localStorage for keys starting with 'cardsmith.sel.<id>.' and 'cardsmith.collapse.<id>.' and remove them alongside the def.

## Live-walk additions (found by hand in the browser)

- **Dominion's description is stale**: the forge card and setup screen still say 'The lobby picks one of three kingdom sets' — there are seven sets now plus the hand-picker. (def meta in src/forge/dominionGame.ts)
- **Lobby WATCH spectate is not real**: clicking WATCH on the fake open table produces no navigation and no visible feedback in the page body.
- **Lobby profile stats are fixtures** (44 victories / 71 games for demo accounts) presented as real records next to real chronicle entries.

## Already handled during this review

- Focus-mode Box width/height knobs pushing zones off-screen: **fixed and deployed** (commit 684276c) while the review ran.
- .tt-slot CSS class collision in the designer: being fixed in your separate background session.

## Refuted during verification

- No connection timeout anywhere — NAT/ICE failure leaves both sides spinning forever
