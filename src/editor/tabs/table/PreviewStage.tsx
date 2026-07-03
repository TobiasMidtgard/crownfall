/**
 * PreviewStage — mounts the runner's REAL ScreenRenderer as the table
 * designer's live-preview visual layer, so the preview draws the exact same
 * components at the exact same size as the in-game table (the true phase seal,
 * the scroll-snap carousel, phase-aware glow — everything the runner draws).
 *
 * It builds a synthetic, READ-ONLY TableCtx from the wave-1 sample state:
 *   - state    = the sample snapshot (buildSampleState, memoized per def)
 *   - viewerId = SAMPLE_VIEWER_ID (seat p0) — the seat the designer previews
 *   - cardMoves / zoneMoves = empty (nothing is legal in the designer)
 *   - a FRESH CardRectRegistry + pileMemory Map (never touches the runner's)
 *   - onCardTap / onZoneTap = no-ops (the editor overlay owns all interaction)
 *   - accent from meta.accentColor (the runner's default otherwise)
 *   - rotateVar / badgeVars from def.cardState (card rotation + chips)
 *   - keyBadges / keySpotlight omitted (no keyboard system in the designer)
 *
 * The whole subtree is wrapped in `.forge-root` (Cardsmith's scoped tokens) +
 * `.dominion-skin` for the seeded Dominion def — mirroring the play route in
 * ForgeApp so the skin's `.rn-*` rules apply — and is `pointer-events: none`:
 * the editor's element overlay above it handles selection/drag/resize. The
 * caller (ScreenCanvas) passes the CURRENTLY-EDITED variant as `screen`, so we
 * never rely on ScreenRenderer's own viewport media query to pick it.
 *
 * dominion-skin.css is imported here so the editor chunk bundles it (the
 * editor lives inside `.forge-root` but the skin sheet is only loaded by
 * ForgeApp's play route). It is scoped under `.dominion-skin`, so it is inert
 * for every other game.
 */
import { useMemo, useRef } from 'react';
import type { GameDef, GameState } from '../../../shared/types';
import { ScreenRenderer } from '../../../runner/ScreenRenderer';
import { CardRectRegistry } from '../../../runner/flip';
import type { TableCtx } from '../../../runner/ZoneViews';
import type { ActiveScreen, PileMemoryEntry } from '../../../runner/layoutGeometry';
import { DOMINION_GAME_ID } from '../../../forge/seedDominion';
import { SAMPLE_VIEWER_ID } from './sampleState';
// Bundle the skin into the editor chunk; scoped under .dominion-skin (inert
// otherwise). See the file comment above.
import '../../../forge/dominion-skin.css';

/** The runner's fallback accent when a def sets none (mirrors TableScreen). */
const DEFAULT_ACCENT = '#7c5cff';

export function PreviewStage({ def, sample, screen }: {
  def: GameDef;
  /** The wave-1 sample snapshot (never null here — the caller gates on it). */
  sample: GameState;
  /** The active variant tree the canvas is currently showing/editing. */
  screen: ActiveScreen;
}) {
  // A fresh registry + pile memory per mount: purely local to the preview,
  // never shared with a live runner. The registry only collects DOM nodes for
  // FLIP flights (which never fire here) and the pile memory backs depleted
  // placeholders; both are harmless read-only scratch in the designer.
  const registryRef = useRef<CardRectRegistry | null>(null);
  registryRef.current ??= new CardRectRegistry();
  const pileMemoryRef = useRef<Map<string, Map<string, PileMemoryEntry>> | null>(null);
  pileMemoryRef.current ??= new Map();

  const rotateVar = def.cardState?.rotateVar ?? null;
  const badgeVars = useMemo(
    () => (def.cardState?.badgeVars ?? [])
      .map((id) => def.variables.find((v) => v.id === id))
      .filter((v): v is NonNullable<typeof v> => v !== undefined),
    [def],
  );

  const ctx: TableCtx = useMemo(
    () => ({
      def,
      state: sample,
      viewerId: SAMPLE_VIEWER_ID,
      accent: def.meta.accentColor ?? DEFAULT_ACCENT,
      cardMoves: EMPTY_CARD_MOVES,
      zoneMoves: EMPTY_ZONE_MOVES,
      rotateVar,
      badgeVars,
      cardRects: registryRef.current!,
      pileMemory: pileMemoryRef.current!,
      onCardTap: noop,
      onZoneTap: noop,
    }),
    [def, sample, rotateVar, badgeVars],
  );

  const skinned = def.meta.id === DOMINION_GAME_ID;
  return (
    <div className={`tt-preview-stage forge-root${skinned ? ' dominion-skin' : ''}`} aria-hidden="true">
      <ScreenRenderer
        ctx={ctx}
        screen={screen}
        buttonMove={EMPTY_BUTTON_MOVE}
        onMove={noop}
      />
    </div>
  );
}

// Stable empty singletons — nothing is legal in the designer, so these never
// change and keep the ctx memo's identity steady.
const EMPTY_CARD_MOVES: TableCtx['cardMoves'] = new Map();
const EMPTY_ZONE_MOVES: TableCtx['zoneMoves'] = new Map();
const EMPTY_BUTTON_MOVE: React.ComponentProps<typeof ScreenRenderer>['buttonMove'] = new Map();
function noop() {}
