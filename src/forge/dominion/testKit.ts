/**
 * Shared test harness for Dominion expansion-module suites — the same
 * dealNamed / probeEngine / playOutWindows trio the main dominionGame.test.ts
 * probes use, importable so per-expansion test files stay self-contained.
 *
 * NOTE: cards OUTSIDE the active kingdom live in the hidden RESERVE at game
 * start — deal them with `fromZone: 'dom_zone_reserve'`, or build the def
 * through `pickKingdom(def, [...ten names incl. the card])` when the test
 * exercises buying/supply behavior.
 */
import { createEngine } from '../../engine';
import type {
  ChoiceAnswer, ChoiceRequest, EngineHandle, Expr, GameDef, GameState,
} from '../../shared/types';
import { PASS_ACTION_ID } from '../../shared/types';

/** Setup block moving ONE named card from `fromZone` to `toZone`. */
export function dealNamed(
  name: string,
  toZone = 'dom_zone_hand',
  toPlayer: string | null = null,
  fromZone = 'dom_zone_supply',
): GameDef['setup'][number] {
  const nameIs: Expr = {
    kind: 'compare', op: '==',
    left: { kind: 'cardField', card: { kind: 'binding', name: '$card' }, fieldId: 'name' },
    right: { kind: 'str', value: name },
  };
  return {
    kind: 'moveCards',
    from: { zoneId: fromZone, owner: null },
    // owner null = contextual (p0 during setup); a player id targets a seat.
    to: { zoneId: toZone, owner: toPlayer !== null ? { kind: 'str', value: toPlayer } : null },
    cards: {
      kind: 'specific',
      card: {
        kind: 'bestCard', zone: { zoneId: fromZone, owner: null },
        by: 'highest', fieldId: 'dom_field_cost', filter: nameIs,
      },
    },
    toPosition: 'top',
    faceUp: true,
  };
}

/** A two-human engine whose choices are answered by the given function. */
export function probeEngine(
  def: GameDef,
  answer: (req: ChoiceRequest, state: GameState) => ChoiceAnswer,
): { engine: EngineHandle; errors: string[] } {
  const errors: string[] = [];
  const engine = createEngine(def, {
    playerNames: ['Ada', 'Brook'],
    aiSeats: [false, false],
    seed: 11,
    choiceProvider: { resolve: (req, state) => Promise.resolve(answer(req, state)) },
    onUpdate: () => undefined,
    onScriptError: (m) => errors.push(m),
  });
  return { engine, errors };
}

/**
 * Drive open response windows to resolution: every holder passes, except
 * that `revealFor` reveals its Moat ONCE when legal. Handles chained
 * windows (double attacks) up to a guard cap.
 */
export async function playOutWindows(engine: EngineHandle, revealFor: string | null = null): Promise<void> {
  let revealed = false;
  for (let guard = 0; guard < 60; guard += 1) {
    const state = engine.getState();
    if (state.window === null) return;
    const holder = state.window.holderId;
    const moves = engine.getLegalMoves(holder);
    const reveal = moves.find((m) => m.actionId === 'dom_action_reveal_moat');
    if (!revealed && revealFor === holder && reveal !== undefined) {
      await engine.performAction(holder, reveal);
      revealed = true;
    } else {
      const pass = moves.find((m) => m.actionId === PASS_ACTION_ID);
      if (pass === undefined) throw new Error('no pass move while a window is open');
      await engine.performAction(holder, pass);
    }
  }
  throw new Error('response window never closed');
}

/** Card instance id of the named card in a zone instance (throws if absent). */
export function findNamed(state: GameState, zoneKey: string, name: string): string {
  const id = state.zones[zoneKey]?.cardIds.find((cid) => state.cards[cid].name === name);
  if (id === undefined) throw new Error(`no "${name}" in ${zoneKey}`);
  return id;
}
