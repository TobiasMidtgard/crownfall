/**
 * Engine entry point. `createEngine` builds a ready-to-start EngineHandle
 * from a GameDef. See src/shared/types.ts for the full contract and
 * docs/engine-semantics.md for exact runtime behavior.
 */
import type { GameDef, GameState, Id } from '../shared/types';
import { findZoneOfCard } from './internals';

export { createEngine } from './engine';
export { evalDisplayExpr, isDisplayVisible } from './display';

/** True if `viewerId` may see the face of the given card right now. */
export function isCardVisibleTo(def: GameDef, state: GameState, cardInstanceId: Id, viewerId: Id): boolean {
  const card = state.cards[cardInstanceId];
  if (!card) return false;
  const inst = findZoneOfCard(state, cardInstanceId);
  if (!inst) return false;
  const zdef = def.zones.find((z) => z.id === inst.zoneId);
  if (!zdef) return false;
  switch (zdef.visibility) {
    case 'all':
      return card.faceUp;
    case 'owner':
      return inst.ownerId === viewerId && card.faceUp;
    case 'none':
      return false;
    case 'topCard':
      return inst.cardIds[inst.cardIds.length - 1] === cardInstanceId && card.faceUp;
  }
}
