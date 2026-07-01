/**
 * Legal-move enumeration.
 *
 * Cheap and side-effect free: legality expressions evaluate against the live
 * state with a FORKED RNG (so a `random` inside a legality expression cannot
 * consume game RNG and desync determinism) and a silent error sink (a failing
 * expression simply yields "not legal").
 *
 * Two modes:
 *  - normal play: the current phase's action list, for the current player;
 *  - response windows: every action with speed 'response' (phase lists do not
 *    apply), for the priority holder — `$player` is bound to the actor so
 *    contextual zone owners resolve to them.
 */
import type { ActionDef, Id, Move, ZoneInstance } from '../shared/types';
import type { Core } from './internals';
import { currentPlayer, zoneInstanceKey } from './internals';
import { evalExpr, silentCtx, truthy } from './expr';

function movesForAction(core: Core, action: ActionDef, actorId: Id): Move[] {
  const moves: Move[] = [];
  if (action.target.kind === 'cardInZone') {
    const zdef = core.def.zones.find((z) => z.id === (action.target as { zoneId: Id }).zoneId);
    if (!zdef) return moves;
    const insts: (ZoneInstance | undefined)[] = zdef.owner === 'shared'
      ? [core.state.zones[zoneInstanceKey(zdef.id, null)]]
      : action.target.ownerOnly
        ? [core.state.zones[zoneInstanceKey(zdef.id, actorId)]]
        : core.state.players.map((p) => core.state.zones[zoneInstanceKey(zdef.id, p.id)]);
    for (const inst of insts) {
      if (!inst) continue;
      for (const cardId of inst.cardIds) {
        const legal = action.legality === null
          || truthy(evalExpr(silentCtx(core, [{ $player: actorId, $card: cardId }]), action.legality));
        if (legal) moves.push({ actionId: action.id, cardId });
      }
    }
  } else {
    const legal = action.legality === null
      || truthy(evalExpr(silentCtx(core, [{ $player: actorId }]), action.legality));
    if (legal) moves.push({ actionId: action.id });
  }
  return moves;
}

/** Moves offered during normal play (no open response window). */
export function enumerateMoves(core: Core): Move[] {
  if (core.finished) return [];
  const phase = core.def.phases[core.state.phaseIdx];
  if (!phase) return [];
  const moves: Move[] = [];
  const cur = currentPlayer(core);
  for (const actionId of phase.actionIds) {
    const action = core.def.actions.find((a) => a.id === actionId);
    if (!action) continue;
    moves.push(...movesForAction(core, action, cur.id));
  }
  return moves;
}

/** Response-speed moves for the priority holder (the Pass move is added by the engine). */
export function enumerateResponseMoves(core: Core, holderId: Id): Move[] {
  if (core.finished) return [];
  const moves: Move[] = [];
  for (const action of core.def.actions) {
    if (action.speed !== 'response') continue;
    moves.push(...movesForAction(core, action, holderId));
  }
  return moves;
}
