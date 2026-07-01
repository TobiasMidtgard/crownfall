/**
 * Event queue drain: after the active script finishes, queued events run
 * matching global triggers (definition order) then card abilities, FIFO.
 * Trigger/ability scripts may enqueue more events; cascades are bounded by
 * DRAIN_ROUNDS per settle.
 */
import type { AbilityDef, Block, CardInstance, EventSpec, Expr, Id } from '../shared/types';
import type { Core, EngineEvent, Frame } from './internals';
import { DRAIN_ROUNDS, currentPlayer, findZoneOfCard, pushStackEntry, report } from './internals';
import { evalExpr, scriptCtx, truthy } from './expr';
import { runScript } from './exec';

function matchesTrigger(spec: EventSpec, ev: EngineEvent): boolean {
  switch (spec.kind) {
    case 'turnStart': case 'turnEnd':
      return ev.kind === spec.kind;
    case 'phaseStart': case 'phaseEnd':
      return ev.kind === spec.kind && (spec.phaseId === null || spec.phaseId === ev.phaseId);
    case 'cardEnterZone':
      return ev.kind === 'cardEnterZone' && (spec.zoneId === null || spec.zoneId === ev.toZoneId);
    case 'cardLeaveZone':
      return ev.kind === 'cardLeaveZone' && (spec.zoneId === null || spec.zoneId === ev.fromZoneId);
    case 'zoneEmptied':
      return ev.kind === 'zoneEmptied' && (spec.zoneId === null || spec.zoneId === ev.zoneId);
    case 'varChanged':
      return ev.kind === 'varChanged' && (spec.varId === null || spec.varId === ev.varId);
  }
}

/** Bindings available in trigger/ability conditions + scripts (see semantics table). */
function eventBindings(ev: EngineEvent): Frame {
  switch (ev.kind) {
    case 'turnStart': case 'turnEnd':
    case 'phaseStart': case 'phaseEnd':
      return { $player: ev.playerId };
    case 'cardEnterZone':
      return { $card: ev.cardId, $fromZone: ev.fromZoneId, $toZone: ev.toZoneId, $owner: ev.toOwner };
    case 'cardLeaveZone':
      return { $card: ev.cardId, $fromZone: ev.fromZoneId, $toZone: ev.toZoneId, $owner: ev.fromOwner };
    case 'zoneEmptied':
      return { $zone: ev.zoneId, $owner: ev.owner };
    case 'varChanged': {
      const frame: Frame = {};
      if (ev.playerId !== null) frame['$player'] = ev.playerId;
      if (ev.cardId !== null) frame['$card'] = ev.cardId;
      return frame;
    }
  }
}

interface EventRuleInfo {
  label: string;
  /** Push onto the stack instead of running inline. */
  stacked: boolean;
  sourceCardId: Id | null;
}

async function runEventScript(
  core: Core, frame: Frame, condition: Expr | null, script: Block[], info: EventRuleInfo,
): Promise<void> {
  const frames: Frame[] = [frame];
  // Conditions always evaluate inline (at event time) — only the SCRIPT defers.
  if (condition !== null && !truthy(evalExpr(scriptCtx(core, frames), condition))) return;
  if (info.stacked) {
    const by = frame['$owner'] ?? frame['$player'];
    pushStackEntry(core, {
      label: info.label,
      sourceCardId: info.sourceCardId,
      byPlayerId: typeof by === 'string' ? by : currentPlayer(core).id,
      script,
      snapshot: frames,
    });
    return;
  }
  await runScript(core, script, frames);
}

function abilityFrame(core: Core, ev: EngineEvent, card: CardInstance): Frame {
  const inst = findZoneOfCard(core.state, card.instanceId);
  return {
    ...eventBindings(ev),
    $self: card.instanceId,
    $owner: inst?.ownerId ?? currentPlayer(core).id,
  };
}

function abilitiesOf(core: Core, card: CardInstance): AbilityDef[] {
  if (card.defId === null) return [];
  return core.def.cards.find((c) => c.id === card.defId)?.abilities ?? [];
}

async function runAbilities(core: Core, ev: EngineEvent): Promise<void> {
  if (ev.kind === 'cardEnterZone' || ev.kind === 'cardLeaveZone') {
    const card = core.state.cards[ev.cardId];
    if (!card) return;
    const on = ev.kind === 'cardEnterZone' ? 'enterZone' : 'leaveZone';
    const evZone = ev.kind === 'cardEnterZone' ? ev.toZoneId : ev.fromZoneId;
    for (const ab of abilitiesOf(core, card)) {
      if (ab.on !== on) continue;
      if (ab.zoneId !== null && ab.zoneId !== evZone) continue;
      await runEventScript(core, abilityFrame(core, ev, card), ab.condition, ab.script, {
        label: `${card.name}: ${ab.name}`, stacked: ab.stacked === true, sourceCardId: card.instanceId,
      });
    }
    return;
  }
  if (ev.kind === 'turnStart' || ev.kind === 'turnEnd' || ev.kind === 'phaseStart' || ev.kind === 'phaseEnd') {
    // Snapshot (card, ability) pairs whose card sits in the ability's zone,
    // then re-check liveness before each run (earlier scripts may move cards).
    const pending: { cardId: Id; ab: AbilityDef }[] = [];
    for (const key of Object.keys(core.state.zones)) {
      const inst = core.state.zones[key];
      for (const cid of inst.cardIds) {
        const card = core.state.cards[cid];
        if (!card) continue;
        for (const ab of abilitiesOf(core, card)) {
          if (ab.on !== ev.kind) continue;
          // Turn/phase abilities REQUIRE a zone ("while in <zone>"); a null
          // zone never fires — matching the editor's warning and validation.
          if (ab.zoneId === null || ab.zoneId !== inst.zoneId) continue;
          if ((ev.kind === 'phaseStart' || ev.kind === 'phaseEnd')
            && ab.phaseId != null && ab.phaseId !== ev.phaseId) continue;
          pending.push({ cardId: cid, ab });
        }
      }
    }
    for (const { cardId, ab } of pending) {
      const card = core.state.cards[cardId];
      if (!card) continue;
      const holder = findZoneOfCard(core.state, cardId);
      if (ab.zoneId === null || holder?.zoneId !== ab.zoneId) continue;
      await runEventScript(core, abilityFrame(core, ev, card), ab.condition, ab.script, {
        label: `${card.name}: ${ab.name}`, stacked: ab.stacked === true, sourceCardId: card.instanceId,
      });
    }
  }
  // zoneEmptied / varChanged have no ability hooks.
}

/** Drain the event queue (FIFO), running triggers then abilities per event. */
export async function drainEvents(core: Core): Promise<void> {
  let rounds = 0;
  while (core.queue.length > 0) {
    if (++rounds > DRAIN_ROUNDS) {
      report(core, `Event cascade exceeded ${DRAIN_ROUNDS} rounds — remaining events dropped.`);
      core.queue.length = 0;
      return;
    }
    const batch = core.queue.splice(0);
    for (const ev of batch) {
      for (const trig of core.def.triggers) {
        if (!matchesTrigger(trig.event, ev)) continue;
        await runEventScript(core, eventBindings(ev), trig.condition, trig.script, {
          label: trig.name, stacked: trig.stacked === true, sourceCardId: null,
        });
      }
      await runAbilities(core, ev);
    }
  }
}
