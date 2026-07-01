/**
 * Interrupt-system surfaces: the pending-effects STACK panel (entries
 * bottom→top, top highlighted "resolving next") and the response-window
 * PRIORITY banner ("waiting on <name> — respond or pass").
 * Stack entries are public mirrors (label, source card, owner); the mini
 * card's facing still resolves through isCardVisibleTo.
 */
import { isCardVisibleTo } from '../engine';
import { CardView } from '../components/CardView';
import { templateOf } from './layout';
import type { TableCtx } from './ZoneViews';

export function StackPanel({ ctx }: { ctx: TableCtx }) {
  const stack = ctx.state.stack;
  if (stack.length === 0) return null;
  return (
    // Keying by the top entry's id pulses the panel cheaply on push AND pop.
    <div
      className="rn-stackpanel rn-pop"
      key={`${stack.length}:${stack[stack.length - 1].id}`}
      role="region"
      aria-label="Pending effects"
    >
      <span className="rn-stack-title">Stack · {stack.length} pending</span>
      <div className="rn-stack-entries">
        {stack.map((entry, i) => {
          const top = i === stack.length - 1;
          const card = entry.sourceCardId !== null ? ctx.state.cards[entry.sourceCardId] : null;
          const by = entry.byPlayerId !== null
            ? ctx.state.players.find((p) => p.id === entry.byPlayerId)?.name ?? null
            : null;
          return (
            <div key={entry.id} className={`rn-stack-entry${top ? ' rn-stack-top' : ''}`}>
              {card && (
                <CardView
                  card={{
                    name: card.name,
                    templateId: card.templateId,
                    fields: card.fields,
                    faceUp: isCardVisibleTo(ctx.def, ctx.state, card.instanceId, ctx.viewerId),
                  }}
                  template={templateOf(ctx.def, card)}
                  width={34}
                  accent={ctx.accent}
                />
              )}
              <div className="rn-stack-meta">
                <span className="rn-stack-label">{entry.label}</span>
                {by !== null && <span className="rn-stack-by">{by}</span>}
                {top && <span className="rn-stack-next">resolving next</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Banner shown while a response window is open. */
export function PriorityBanner({ ctx }: { ctx: TableCtx }) {
  const win = ctx.state.window;
  if (!win) return null;
  const name = ctx.state.players.find((p) => p.id === win.holderId)?.name ?? win.holderId;
  return (
    <div className="rn-respond" role="status">
      Waiting on <b>{name}</b> — respond or pass
    </div>
  );
}
