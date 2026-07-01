/**
 * Test-only helpers: compact GameDef builders, a scripted ChoiceProvider,
 * and an engine harness that records updates + script errors.
 */
import type {
  AbilityDef, ActionDef, Block, CardDef, CardSelector, ChoiceAnswer, ChoiceRequest, ChoiceProvider,
  CompareOp, DeckDef, Expr, GameDef, GameState, Id, MathOp, PhaseDef, VariableDef, VarScope, VarType,
  ZoneDef, ZoneRef,
} from '../shared/types';
import { createEngine } from './engine';

// --- def builders -----------------------------------------------------------

export function zone(id: string, over: Partial<ZoneDef> = {}): ZoneDef {
  return { id, name: id, owner: 'shared', visibility: 'all', layout: 'stack', area: 'center', ...over };
}

export function pzone(id: string, over: Partial<ZoneDef> = {}): ZoneDef {
  return zone(id, { owner: 'perPlayer', area: 'player', ...over });
}

export function vdef(id: string, scope: VarScope, type: VarType, initial: number | string | boolean): VariableDef {
  return { id, name: id, scope, type, initial };
}

export function cdef(id: string, fields: Record<string, string | number> = {}, abilities: AbilityDef[] = []): CardDef {
  return { id, name: id, templateId: 'tpl', fields, abilities };
}

/** entries: card id (count 1) or [cardId, count]. */
export function customDeck(id: string, initialZone: string, entries: (string | [string, number])[], shuffle = false): DeckDef {
  return {
    id, name: id, initialZone, shuffle,
    source: {
      kind: 'custom',
      entries: entries.map((e) => (typeof e === 'string' ? { cardId: e, count: 1 } : { cardId: e[0], count: e[1] })),
    },
  };
}

export function std52(id: string, initialZone: string, over: Partial<DeckDef> & { jokers?: number; excludeRanks?: number[] } = {}): DeckDef {
  const { jokers, excludeRanks, ...rest } = over;
  return { id, name: id, source: { kind: 'standard52', jokers, excludeRanks }, initialZone, shuffle: false, ...rest };
}

export function phaseDef(id: string, mode: PhaseDef['mode'], actionIds: string[], onEnter: Block[] = []): PhaseDef {
  return { id, name: id, mode, actionIds, onEnter };
}

export function actionDef(id: string, over: Partial<ActionDef> = {}): ActionDef {
  return { id, name: id, target: { kind: 'none' }, legality: null, script: [], ...over };
}

/** Minimal def: one manual phase with an always-legal "idle" action so the engine waits for input. */
export function makeDef(over: Partial<GameDef> = {}): GameDef {
  return {
    schemaVersion: 1,
    meta: { id: 'g', name: 'Test', description: '', minPlayers: 1, maxPlayers: 8 },
    variables: [],
    zones: [],
    decks: [],
    templates: [],
    cards: [],
    setup: [],
    phases: [phaseDef('main', 'manual', ['idle'])],
    actions: [actionDef('idle')],
    triggers: [],
    endConditions: [],
    ...over,
  };
}

// --- expression builders -----------------------------------------------------

export const num = (value: number): Expr => ({ kind: 'num', value });
export const str = (value: string): Expr => ({ kind: 'str', value });
export const boolE = (value: boolean): Expr => ({ kind: 'bool', value });
export const bnd = (name: string): Expr => ({ kind: 'binding', name });
export const curP: Expr = { kind: 'currentPlayer' };
export const zr = (zoneId: string, owner: Expr | null = null): ZoneRef => ({ zoneId, owner });
export const gv = (varId: string, target: Expr | null = null): Expr => ({ kind: 'getVar', varId, target });
export const fld = (card: Expr, fieldId: string): Expr => ({ kind: 'cardField', card, fieldId });
export const cmp = (op: CompareOp, left: Expr, right: Expr): Expr => ({ kind: 'compare', op, left, right });
export const math = (op: MathOp, left: Expr, right: Expr): Expr => ({ kind: 'math', op, left, right });
export const zcount = (ref: ZoneRef): Expr => ({ kind: 'zoneCount', zone: ref });
export const topC = (ref: ZoneRef): Expr => ({ kind: 'topCard', zone: ref });
export const rnd = (max: number): Expr => ({ kind: 'random', max: num(max) });

// --- selector / block builders -----------------------------------------------

export const selTop = (n: number): CardSelector => ({ kind: 'top', count: num(n) });
export const selBottom = (n: number): CardSelector => ({ kind: 'bottom', count: num(n) });
export const selAll: CardSelector = { kind: 'all' };
export const selFilter = (filter: Expr): CardSelector => ({ kind: 'filter', filter });
export const selSpec = (card: Expr): CardSelector => ({ kind: 'specific', card });
export const selRandom = (n: number): CardSelector => ({ kind: 'random', count: num(n) });

export function mv(from: ZoneRef, to: ZoneRef, cards: CardSelector, over: Partial<{ toPosition: 'top' | 'bottom'; faceUp: boolean | null }> = {}): Block {
  return { kind: 'moveCards', from, to, cards, toPosition: 'top', faceUp: null, ...over };
}

export const sv = (varId: string, value: Expr, target: Expr | null = null): Block => ({ kind: 'setVar', varId, target, value });
export const cv = (varId: string, by: Expr, target: Expr | null = null): Block => ({ kind: 'changeVar', varId, target, by });
export const ann = (...parts: (string | Expr)[]): Block => ({ kind: 'announce', parts });

// --- choice provider -----------------------------------------------------------

export type ScriptedAnswer = ChoiceAnswer | ((req: ChoiceRequest) => ChoiceAnswer);

export class ScriptedChoices implements ChoiceProvider {
  readonly requests: ChoiceRequest[] = [];
  private answers: ScriptedAnswer[];

  constructor(answers: ScriptedAnswer[] = []) {
    this.answers = [...answers];
  }

  resolve(req: ChoiceRequest): Promise<ChoiceAnswer> {
    this.requests.push(req);
    const a = this.answers.length > 0 ? this.answers.shift()! : null;
    return Promise.resolve(typeof a === 'function' ? a(req) : a);
  }
}

// --- harness --------------------------------------------------------------------

export interface Harness {
  engine: ReturnType<typeof createEngine>;
  errors: string[];
  updates: GameState[];
  choices: ScriptedChoices;
  state(): GameState;
}

export function harness(
  def: GameDef,
  o: { players?: string[]; seed?: number; answers?: ScriptedAnswer[]; provider?: ChoiceProvider } = {},
): Harness {
  const players = o.players ?? ['Alice', 'Bob'];
  const errors: string[] = [];
  const updates: GameState[] = [];
  const choices = new ScriptedChoices(o.answers ?? []);
  const engine = createEngine(def, {
    playerNames: players,
    aiSeats: players.map(() => false),
    seed: o.seed ?? 42,
    choiceProvider: o.provider ?? choices,
    onUpdate: (s) => updates.push(s),
    onScriptError: (m) => errors.push(m),
  });
  return { engine, errors, updates, choices, state: () => engine.getState() };
}

// --- state inspection ----------------------------------------------------------

/** Card names in a zone instance, bottom→top. */
export function namesIn(state: GameState, zoneKey: string): string[] {
  return (state.zones[zoneKey]?.cardIds ?? []).map((id) => state.cards[id].name);
}

export function idByName(state: GameState, name: string): Id {
  const card = Object.values(state.cards).find((c) => c.name === name);
  if (!card) throw new Error(`no card named ${name}`);
  return card.instanceId;
}
