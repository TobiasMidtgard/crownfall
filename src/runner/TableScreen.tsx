/**
 * TableScreen — a live game. Owns the GameSession lifecycle and renders the
 * felt table with tap-to-act wiring, choice sheets, the hotseat curtain, log
 * drawer, announcement snackbar and the game-over overlay.
 *
 * Two table modes share the status bar and every overlay:
 *   - def.screenLayout set -> the authored single-page screen (ScreenRenderer)
 *     with the action bar filtered down to moves no visible screen button
 *     already covers. Below 1024px an authored mobile variant replaces the
 *     desktop tree (activeScreenVariant). (The deprecated tableLayout never
 *     renders — it is migrated to screenLayout upstream at load.)
 *   - otherwise -> the classic automatic layout (opponents strip / shared
 *     center / viewer area).
 * Card moves animate in BOTH modes via the FLIP layer (see flip.tsx), tuned
 * by the layout's motion spec and the persisted status-bar speed toggle
 * (1× / 2× / instant — instant skips clones entirely).
 *
 * Screen mode also mounts the keyboard system (keyboard.tsx): keyGroup zones
 * get digit badges + modifier spotlighting, Enter fires the first enabled
 * screen button; everything suspends while a sheet/choice/dialog is open.
 * The root carries data-phase (phase id) and data-active ('you'/'foe'/'over')
 * so skin CSS can scope phase/turn-conditional styling.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
// TableScreen owns its stylesheet: hosts that mount the table directly
// (the hall's DominionPlay) must get the runner CSS without PlayPage.
import './runner.css';
import type { GameDef, GameState, Id, Move } from '../shared/types';
import { PASS_ACTION_ID } from '../shared/types';
import {
  actingSeat, bucketZones, burnZoneKeys, buttonMoves, formatVarValue, movesByCard,
  movesByZoneInstance, noneTargetMoveByAction, pickViewer, visibleButtonActionIds, zoneInstKey,
} from './layout';
import {
  activeScreenVariant, nextSpeed, resolveMotion, speedFactor, type SpeedSetting,
} from './layoutGeometry';
import { useTableKeyboard } from './keyboard';
import { GameSession, type SeatSetup, type SessionSnapshot } from './session';
import { OpponentsStrip, VarChips } from './OpponentsStrip';
import { ZoneBlock, type TableCtx } from './ZoneViews';
import { ScreenRenderer, useNarrowViewport } from './ScreenRenderer';
import { CardRectRegistry, FlightLayer, loadSpeed, saveSpeed, useCardFlights } from './flip';
import { PriorityBanner, StackPanel } from './StackPanel';
import { ActionPickSheet, ChoiceSheet } from './sheets';
import {
  Curtain, ErrorBanner, FatalScreen, GameOverOverlay, LogDrawer, Snackbar,
} from './overlays';

export function TableScreen({ def, seats, seed, navigate, onPlayAgain, onBackToSetup, onGameOver, homeLabel }: {
  def: GameDef;
  seats: SeatSetup[];
  seed: number;
  navigate: (hash: string) => void;
  onPlayAgain: () => void;
  onBackToSetup: () => void;
  /** Fired once, when the session first reports the game finished. */
  onGameOver?: (summary: { result: GameState['result']; state: GameState }) => void;
  /** Label for the leave-the-table overlay action (default 'Home') — hosts
   *  whose onHome lands elsewhere name the real destination. */
  homeLabel?: string;
}) {
  // The session is created in an effect (not render) so StrictMode's double
  // mount creates/disposes cleanly — engine.start() may only run once.
  const [session, setSession] = useState<GameSession | null>(null);
  useEffect(() => {
    const s = new GameSession(def, seats, seed);
    setSession(s);
    s.begin();
    return () => s.dispose();
  }, [def, seats, seed]);

  const subscribe = useCallback(
    (cb: () => void) => (session ? session.subscribe(cb) : () => undefined),
    [session],
  );
  const snap = useSyncExternalStore(subscribe, () => session?.snapshot ?? null);

  // Game-over notification: once per mount (play-again remounts with a key).
  const gameOverFired = useRef(false);
  useEffect(() => {
    if (gameOverFired.current || !snap || !snap.finished) return;
    gameOverFired.current = true;
    onGameOver?.({ result: snap.state.result, state: snap.state });
  }, [snap, onGameOver]);

  if (!session || !snap) {
    return <div className="rn-root rn-loading">Setting up the table…</div>;
  }
  if (snap.fatalError) {
    return (
      <FatalScreen
        title="This game couldn't start"
        message={snap.fatalError}
        onRetry={onBackToSetup}
        retryLabel="Back to setup"
        onHome={() => navigate('#/')}
        homeLabel={homeLabel}
      />
    );
  }
  return (
    <Table
      def={def}
      session={session}
      snap={snap}
      navigate={navigate}
      onPlayAgain={onPlayAgain}
      homeLabel={homeLabel}
    />
  );
}

function Table({ def, session, snap, navigate, onPlayAgain, homeLabel }: {
  def: GameDef;
  session: GameSession;
  snap: SessionSnapshot;
  navigate: (hash: string) => void;
  onPlayAgain: () => void;
  homeLabel?: string;
}) {
  const state = snap.state;
  const accent = def.meta.accentColor ?? '#7c5cff';
  const buckets = useMemo(() => bucketZones(def), [def]);
  const screen = def.screenLayout ?? null;
  // The active variant: the mobile tree below 1024px when authored.
  const narrow = useNarrowViewport();
  const active = useMemo(
    () => (screen ? activeScreenVariant(screen, narrow) : null),
    [screen, narrow],
  );
  const current = state.players.length > 0 ? state.players[state.currentPlayerIdx] : null;
  const phase = state.phaseIdx < def.phases.length ? def.phases[state.phaseIdx] : null;
  const holderId = state.window?.holderId ?? null;

  // ----- viewer perspective + hotseat privacy curtain -----
  const lastHumanRef = useRef<Id | null>(null);
  const viewerId = pickViewer(state, snap.choice?.playerId ?? null, lastHumanRef.current);
  const viewer = state.players.find((p) => p.id === viewerId) ?? null;
  const viewerIsHuman = viewer !== null && !viewer.isAI;
  useEffect(() => {
    if (viewerIsHuman) lastHumanRef.current = viewerId;
  });
  const humanSeats = state.players.filter((p) => !p.isAI).length;
  const needsPrivacy = humanSeats > 1 && def.zones.some((z) => z.visibility === 'owner');
  const [revealedSeat, setRevealedSeat] = useState<Id | null>(null);
  const showCurtain = needsPrivacy && viewerIsHuman && !snap.finished && revealedSeat !== viewerId;

  // ----- legal-move indexes (empty unless a human may act right now) -----
  const cardMoves = useMemo(() => movesByCard(snap.moves), [snap.moves]);
  const zoneMoves = useMemo(
    () => movesByZoneInstance(def, state, snap.moves),
    [def, state, snap.moves],
  );
  // Screen mode: moves shown as enabled screen buttons leave the bottom bar.
  const screenButtonIds = useMemo(
    () => (active ? visibleButtonActionIds(def, state, active.elements, viewerId) : undefined),
    [def, state, active, viewerId],
  );
  const barMoves = useMemo(
    () => buttonMoves(def, snap.moves, screenButtonIds),
    [def, snap.moves, screenButtonIds],
  );
  const screenButtonMove = useMemo(
    () => noneTargetMoveByAction(def, snap.moves),
    [def, snap.moves],
  );

  const [pick, setPick] = useState<{ title: string; moves: Move[] } | null>(null);
  useEffect(() => setPick(null), [snap.moves]); // legal moves changed -> picker is stale

  const doMove = useCallback((m: Move) => {
    setPick(null);
    void session.performHumanMove(m);
  }, [session]);

  const onCardTap = useCallback((cardId: Id) => {
    const ms = cardMoves.get(cardId);
    if (!ms || ms.length === 0) return;
    if (ms.length === 1) doMove(ms[0]);
    else setPick({ title: state.cards[cardId]?.name ?? 'Choose an action', moves: ms });
  }, [cardMoves, doMove, state]);

  const onZoneTap = useCallback((instKey: string) => {
    const ms = zoneMoves.get(instKey);
    if (!ms || ms.length === 0) return;
    if (ms.length === 1) {
      doMove(ms[0]);
      return;
    }
    const zoneId = state.zones[instKey]?.zoneId;
    setPick({ title: def.zones.find((z) => z.id === zoneId)?.name ?? 'Zone', moves: ms });
  }, [zoneMoves, doMove, state, def]);

  // Card-state rendering contract (rotation + badges), resolved once per def.
  const rotateVar = def.cardState?.rotateVar ?? null;
  const badgeVars = useMemo(
    () => (def.cardState?.badgeVars ?? [])
      .map((id) => def.variables.find((v) => v.id === id))
      .filter((v): v is NonNullable<typeof v> => v !== undefined),
    [def],
  );

  // ----- FLIP card-move animation (automatic AND screen layouts) -----
  // Speed toggle: 1× / 2× / instant, persisted across sessions.
  const [speed, setSpeedState] = useState<SpeedSetting>(() => loadSpeed());
  const setSpeed = useCallback((s: SpeedSetting) => {
    setSpeedState(s);
    saveSpeed(s);
  }, []);
  const factor = speedFactor(speed);
  const motion = useMemo(() => resolveMotion(screen?.motion), [screen]);
  const burnKeys = useMemo(
    () => (active ? burnZoneKeys(def, state, active.elements, viewerId) : undefined),
    [def, state, active, viewerId],
  );
  const registryRef = useRef<CardRectRegistry | null>(null);
  registryRef.current ??= new CardRectRegistry();
  const cardRects = registryRef.current;
  const [flights, finishFlight] = useCardFlights(
    state,
    cardRects,
    !showCurtain && speed !== 'instant',
    burnKeys,
  );

  // ----- keyboard system (desktop only; keyGroup zones, Enter = first seal) --
  const [logOpen, setLogOpen] = useState(false);
  const choice = snap.choice;
  // Any sheet/choice/dialog (or the curtain) suspends the bindings; digit
  // selection of sheet options keeps working via [data-choice-digit].
  const overlayOpen = pick !== null || choice !== null || logOpen
    || state.result !== null || showCurtain;
  const keyboard = useTableKeyboard({
    def,
    state,
    viewerId,
    elements: active?.elements ?? null,
    cardMoves,
    buttonMove: screenButtonMove,
    overlayOpen,
    humanCanAct: snap.moves.length > 0 && !snap.finished,
    narrow,
    onActivateCard: onCardTap,
    onMove: doMove,
  });

  const ctx: TableCtx = useMemo(
    () => ({
      def, state, viewerId, accent, cardMoves, zoneMoves, rotateVar, badgeVars, cardRects,
      keyBadges: keyboard.badges, keySpotlight: keyboard.spotlight,
      onCardTap, onZoneTap,
    }),
    [def, state, viewerId, accent, cardMoves, zoneMoves, rotateVar, badgeVars, cardRects,
      keyboard.badges, keyboard.spotlight, onCardTap, onZoneTap],
  );

  // ----- announcement snackbar from new log entries -----
  const [snack, setSnack] = useState<{ text: string; n: number } | null>(null);
  const logLenRef = useRef(state.log.length);
  useEffect(() => {
    if (state.log.length > logLenRef.current) {
      setSnack({ text: state.log[state.log.length - 1].text, n: state.log.length });
    }
    logLenRef.current = state.log.length;
  }, [state.log]);
  useEffect(() => {
    if (snack === null) return;
    const t = window.setTimeout(() => setSnack(null), 2600);
    return () => window.clearTimeout(t);
  }, [snack]);

  const globalVars = def.variables.filter((v) => v.scope === 'global');

  // Screen-reader page heading: the table itself has no visible headings
  // until the game-over h2, so heading navigation needs this landmark.
  const tableHeading = (
    <h1 className="rn-vh">
      {def.meta.name} — {state.players.map((p) => p.name).join(' vs ')}
    </h1>
  );

  // While the hotseat curtain is up the table is NOT rendered at all (render
  // replacement, not an overlay): the hidden hand never enters the DOM or the
  // accessibility tree, so nothing behind the curtain can be read or
  // keyboard-activated — including at the curtain->reveal boundary.
  if (showCurtain && viewer) {
    return (
      <div className="rn-root">
        {tableHeading}
        {snap.scriptError && (
          <ErrorBanner message={snap.scriptError} onDismiss={() => session.dismissScriptError()} />
        )}
        <Curtain name={viewer.name} onReady={() => setRevealedSeat(viewerId)} />
      </div>
    );
  }

  const statusBar = (
    <div className="rn-status">
      <button className="btn rn-statusbtn" onClick={() => navigate('#/')} aria-label="Leave game">✕</button>
      <span className="rn-stat">Turn {state.turnNumber}</span>
      {phase && <span className="rn-stat">{phase.name}</span>}
      {current && <span className={`chip${current.isAI ? '' : ' accent'}`}>{current.name}</span>}
      {current?.isAI && !snap.finished && <span className="chip rn-thinking">thinking…</span>}
      {!snap.started && !snap.finished && <span className="chip">setting up…</span>}
      <div className="spacer" />
      {globalVars
        // Empty-string globals are internal bookkeeping (e.g. a pending-effect
        // tag between announcements) — noise until they hold something.
        .filter((v) => !v.hidden && state.globalVars[v.id] !== '')
        .map((v) => (
          <span className="chip" key={v.id}>{v.name}: {formatVarValue(state.globalVars[v.id])}</span>
        ))}
      <button
        className="btn rn-statusbtn rn-speedbtn"
        onClick={() => setSpeed(nextSpeed(speed))}
        title={`Animation speed: ${speed === '1x' ? 'normal' : speed === '2x' ? 'fast' : 'instant'}`}
        aria-label={`Animation speed: ${speed === '1x' ? 'normal' : speed === '2x' ? 'fast' : 'instant'} — tap to change`}
      >
        {speed === '1x' ? '1×' : speed === '2x' ? '2×' : 'max'}
      </button>
      <button className="btn rn-statusbtn" onClick={() => setLogOpen(true)}>Log</button>
    </div>
  );

  // Skin hooks (DGT body[data-phase]/[data-active] pattern): the current
  // phase id and whether the ACTING seat (window holder, else the current
  // player) is the viewer — lets skin CSS scope phase/turn styling, e.g. a
  // buy-phase rn-glow-gold retarget of the supply's legal glow.
  const actor = actingSeat(state);
  const activeAttr = state.result !== null ? 'over'
    : actor !== null && actor.id === viewerId ? 'you' : 'foe';

  const actionBar = barMoves.length > 0 && (
    <div className="rn-actionbar">
      {barMoves.map(({ move, name }) => (
        <button
          className={`btn btn-primary${move.actionId === PASS_ACTION_ID ? ' rn-passbtn' : ''}`}
          key={move.actionId}
          onClick={() => doMove(move)}
        >
          {name}
        </button>
      ))}
    </div>
  );

  return (
    <div className="rn-root" data-phase={phase?.id} data-active={activeAttr}>
      {tableHeading}
      <div className="rn-table">
        {active ? (
          <section className="rn-screenhost">
            <ScreenRenderer ctx={ctx} screen={active} buttonMove={screenButtonMove} onMove={doMove} />
            {(state.window !== null || state.stack.length > 0) && (
              <div className="rn-screen-system">
                {state.window && <PriorityBanner ctx={ctx} />}
                {state.stack.length > 0 && <StackPanel ctx={ctx} />}
              </div>
            )}
          </section>
        ) : (
          <>
            <OpponentsStrip
              ctx={ctx}
              seatZones={buckets.perPlayerSeat}
              currentPlayerId={current?.id ?? null}
              holderId={holderId}
            />

            <section className="rn-center">
              {state.window && <PriorityBanner ctx={ctx} />}
              {state.stack.length > 0 && <StackPanel ctx={ctx} />}
              {buckets.sharedCenter.length > 0 && (
                <div className="rn-center-zones">
                  {buckets.sharedCenter.map((z) => {
                    const inst = state.zones[zoneInstKey(z.id, null)];
                    if (!inst) return null;
                    return <ZoneBlock key={z.id} ctx={ctx} zone={z} inst={inst} size="center" caption={z.name} />;
                  })}
                </div>
              )}
              {buckets.perPlayerCenter.map((z) => (
                <div className="rn-center-zones" key={z.id}>
                  {state.players.map((p) => {
                    const inst = state.zones[zoneInstKey(z.id, p.id)];
                    if (!inst) return null;
                    return (
                      <ZoneBlock
                        key={p.id}
                        ctx={ctx}
                        zone={z}
                        inst={inst}
                        size="center"
                        caption={`${p.name} · ${z.name}`}
                      />
                    );
                  })}
                </div>
              ))}
            </section>
          </>
        )}

        {statusBar}

        {active ? (
          actionBar && <section className="rn-bottom rn-screenbar">{actionBar}</section>
        ) : (
          <section className={`rn-bottom${viewer && holderId === viewer.id ? ' rn-priority' : ''}`}>
            {viewer && (
              <div className="rn-bottom-head">
                <span className="rn-bottom-name">
                  {viewer.name}
                  {!viewer.isAI && holderId === viewer.id ? ' — respond or pass'
                    : viewer.id === current?.id && !viewer.isAI ? ' — your turn' : ''}
                </span>
                <VarChips def={def} player={viewer} />
              </div>
            )}
            {buckets.perPlayerSeat.length > 0 && (
              <div className="rn-bottom-zones">
                {viewer && buckets.perPlayerSeat.map((z) => {
                  const inst = state.zones[zoneInstKey(z.id, viewer.id)];
                  if (!inst) return null;
                  return (
                    <ZoneBlock
                      key={z.id}
                      ctx={ctx}
                      zone={z}
                      inst={inst}
                      size={z.layout === 'fan' ? 'hand' : 'center'}
                      caption={z.name}
                    />
                  );
                })}
              </div>
            )}
            {actionBar}
          </section>
        )}
      </div>

      <FlightLayer
        ctx={ctx}
        flights={flights}
        registry={cardRects}
        motion={motion}
        factor={factor}
        onDone={finishFlight}
      />

      {snap.scriptError && (
        <ErrorBanner message={snap.scriptError} onDismiss={() => session.dismissScriptError()} />
      )}
      {/* Always mounted: the live region must exist before a message lands. */}
      <Snackbar text={snack?.text ?? ''} seq={snack?.n ?? 0} />

      {pick && (
        <ActionPickSheet
          def={def}
          title={pick.title}
          moves={pick.moves}
          onPick={doMove}
          onCancel={() => setPick(null)}
        />
      )}
      {choice && !pick && (
        <ChoiceSheet
          def={def}
          state={state}
          choice={choice}
          accent={accent}
          onAnswer={(a) => session.answerChoice(choice.id, a)}
        />
      )}
      {logOpen && <LogDrawer entries={state.log} onClose={() => setLogOpen(false)} />}
      {state.result && (
        <GameOverOverlay
          def={def}
          state={state}
          onPlayAgain={onPlayAgain}
          onHome={() => navigate('#/')}
          homeLabel={homeLabel}
        />
      )}
    </div>
  );
}
