/**
 * Top strip: one compact panel per non-viewer player — name, AI/Human chip,
 * their per-player variables, and their seat-area zones in miniature.
 * The current player's panel gets a highlight ring; the response-window
 * priority holder's panel pulses with the accent.
 */
import type { GameDef, Id, PlayerState, ZoneDef } from '../shared/types';
import { formatVarValue, zoneInstKey } from './layout';
import { ZoneBlock, type TableCtx } from './ZoneViews';

export function OpponentsStrip({ ctx, seatZones, currentPlayerId, holderId }: {
  ctx: TableCtx;
  seatZones: ZoneDef[];
  currentPlayerId: Id | null;
  /** Response-window priority holder (null when no window is open). */
  holderId?: Id | null;
}) {
  const others = ctx.state.players.filter((p) => p.id !== ctx.viewerId);
  if (others.length === 0) return null;
  return (
    <div className="rn-opponents">
      {others.map((p) => (
        <OpponentPanel
          key={p.id}
          ctx={ctx}
          player={p}
          seatZones={seatZones}
          isCurrent={p.id === currentPlayerId}
          isHolder={p.id === (holderId ?? null)}
        />
      ))}
    </div>
  );
}

function OpponentPanel({ ctx, player, seatZones, isCurrent, isHolder }: {
  ctx: TableCtx;
  player: PlayerState;
  seatZones: ZoneDef[];
  isCurrent: boolean;
  isHolder: boolean;
}) {
  return (
    <div className={`rn-opp${isCurrent ? ' rn-current' : ''}${isHolder ? ' rn-priority' : ''}`}>
      <div className="rn-opp-head">
        <span className="rn-opp-name">{player.name}</span>
        <span className="chip">{player.isAI ? 'AI' : 'Human'}</span>
        {isHolder && <span className="chip accent">priority</span>}
      </div>
      <VarChips def={ctx.def} player={player} />
      <div className="rn-opp-zones">
        {seatZones.map((z) => {
          const inst = ctx.state.zones[zoneInstKey(z.id, player.id)];
          if (!inst) return null;
          return <ZoneBlock key={z.id} ctx={ctx} zone={z} inst={inst} size="strip" caption={z.name} />;
        })}
      </div>
    </div>
  );
}

/** A player's per-player variable values as chips (e.g. score). */
export function VarChips({ def, player }: { def: GameDef; player: PlayerState }) {
  const perPlayerVars = def.variables.filter((v) => v.scope === 'perPlayer');
  if (perPlayerVars.length === 0) return null;
  return (
    <span className="rn-varchips">
      {perPlayerVars.map((v) => (
        <span className="chip" key={v.id}>{v.name}: {formatVarValue(player.vars[v.id])}</span>
      ))}
    </span>
  );
}
