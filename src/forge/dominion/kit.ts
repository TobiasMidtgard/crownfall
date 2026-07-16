/**
 * The Dominion card kit — the typed surface expansion modules code against.
 *
 * dominionGame.ts constructs ONE CardKit from its private helpers and hands
 * it to every ExpansionModule factory, so expansion files never import the
 * (module-private) plumbing and never touch shared tables. See the card
 * cookbook in dominionGame.ts for the idioms behind each helper.
 */
import type {
  ActionDef, AbilityDef, Block, CardDef, CardSelector, Expr, TriggerDef, VariableDef, ZoneDef,
  ZoneRef,
} from '../../shared/types';

export interface PileSpec {
  name: string;
  cost: number;
  treasure?: boolean;
  /** Cards per pile (kingdom piles are 10). */
  count: number;
}

export interface CardKit {
  /** Zone ids: SUPPLY/TRASH shared; DECK/HAND/DISCARD/INPLAY per player;
   *  RESERVE = unpicked kingdom stock; LOOK = shared staging for look-at /
   *  set-aside effects (Sentry, Bandit, Library, Patrol); DURATION = where
   *  duration cards wait out the off-turn (see durationPair). */
  zones: {
    SUPPLY: string; TRASH: string; DECK: string; HAND: string;
    DISCARD: string; INPLAY: string; RESERVE: string; LOOK: string;
    DURATION: string;
  };
  vars: {
    ACTIONS: string; BUYS: string; COINS: string; VP: string;
    IMMUNE: string; EMPTY_PILES: string; SCRATCH: string;
    /** Global cost reduction this turn (Bridge); reset at cleanup. */
    DISCOUNT: string;
    /** Per-player VP chips (Bishop, Monument…): added to every recount,
     *  never reset — earn with changeVar(VP_TOKENS, n, who). */
    VP_TOKENS: string;
    /** Per-player banked coins (Guilds/Renaissance): the core ships a
     *  "Spend a Coffer" buy-phase action + status-strip button. */
    COFFERS: string;
    /** Per-player banked actions (Renaissance): core spend action too. */
    VILLAGERS: string;
  };
  fields: { COST: string; COINS_F: string; VP_F: string; TEXT: string };
  types: { ACTION: string; TREASURE: string; VICTORY: string; CURSE: string };
  tags: { ATTACK: string; REACTION: string; KINGDOM: string };

  /** Context bindings: $owner (ability owner), $card, $choice, $player,
   *  $self (the ability's own card — duration moves, Island, Treasure Map). */
  OWNER: Expr; CARD: Expr; CHOICE: Expr; PLAYER: Expr; SELF: Expr;

  nameIs(name: string): Expr;
  isA(card: Expr, typeId: string): Expr;
  hasTag(card: Expr, tagId: string): Expr;
  IS_ACTION_CARD: Expr;
  IS_TREASURE_CARD: Expr;
  div(l: Expr, r: Expr): Expr;
  mod(l: Expr, r: Expr): Expr;
  /** Sum a numeric card field over a zone. */
  sumCards(z: ZoneRef, fieldId: string, filter?: Expr | null): Expr;

  /** moveCards with a cause tag ('gain'/'trash'/'discard'/'play'/…). */
  tmove(
    cards: CardSelector, from: ZoneRef, to: ZoneRef, moveTag: string,
    opts?: { toPosition?: 'top' | 'bottom'; faceUp?: boolean | null },
  ): Block;
  /** Deck → hand with the inline seeded reshuffle, tagged 'draw'. */
  drawN(owner: Expr | null, count: Expr): Block;
  draw(owner: Expr | null, n: number): Block;
  choosePileBlock(opts: {
    who?: Expr | null; from: ZoneRef; filter?: Expr | null; prompt: string;
    optional?: boolean; revealed?: boolean; body: Block[];
  }): Block;
  /** Re-fire a card's In-Play entry WITHOUT moving it (Throne Room). */
  playAgain(card: Expr): Block;
  /** "When you play this": ability firing on entering In Play.
   *  `stacked: true` ONLY for attack halves (opens the response window). */
  onPlay(id: string, name: string, script: Block[], stacked?: boolean): AbilityDef;
  /** A card def (explicit id — register it in the module's `ids` map too). */
  cardDef(
    id: string, name: string, cost: number, coins: number, vp: number,
    text: string, abilities?: AbilityDef[],
  ): CardDef;
  /** The one true supply-gain: guarded choosePile, 'gain' tag, whiff branch. */
  gainFromSupply(opts: {
    limit: Expr; treasureOnly?: boolean; toHand?: boolean;
    prompt: string; whiff: Block[];
  }): Block[];
  /**
   * A Duration card's two halves. `now` runs on play, then the card parks in
   * the DURATION zone (so cleanup leaves it out); `later` fires at the
   * owner's next action-phase start and the card marches back to In Play
   * (that turn's cleanup discards it normally). Throne Room deviation: a
   * re-play repeats `now` but the card parks only once, so `later` fires once.
   */
  durationPair(idBase: string, name: string, now: Block[], later: Block[]): AbilityDef[];
}

/** One expansion's contribution, merged by buildDominionDef. */
export interface ExpansionModule {
  /** Stable slug, e.g. 'base2e'. */
  id: string;
  /** The printed set's display name ('Base', 'Intrigue', 'Seaside' …) —
   *  drives the setup screen's expansion filter chips. */
  setName?: string;
  /** New kingdom piles (count 10 each). */
  piles: PileSpec[];
  /** Card name → dom_card_* id (globally unique). */
  ids: Record<string, string>;
  buildCards(kit: CardKit): CardDef[];
  /** Names whose type line adds Attack / Reaction tags. */
  attackNames?: string[];
  reactionNames?: string[];
  /** Names whose PRIMARY type is Victory (Duke) / Treasure (Harem). */
  victoryNames?: string[];
  treasureNames?: string[];
  /** Extra per-player/global variables the cards need (hidden bookkeeping). */
  variables?: VariableDef[];
  /** Extra zones the cards need (per-player mats: Island, Native Village). */
  zones?: ZoneDef[];
  /**
   * Non-supply stock (Cornucopia's Prizes, Menagerie's Horses, Spoils…):
   * spawned into the named zone at setup, never a kingdom pick — excluded
   * from the catalog, the picker and the empty-pile watcher. Names still
   * need TYPE_LINE membership via the attack/victory/treasure name lists.
   */
  nonSupply?: { zoneId: string; piles: PileSpec[] }[];
  buildTriggers?(kit: CardKit): TriggerDef[];
  /** Extra actions (e.g. a card's own response-speed reaction). */
  buildActions?(kit: CardKit): ActionDef[];
  /** Extra per-player VP recount terms ($player bound changeVar blocks). */
  buildVpTerms?(kit: CardKit): Block[];
  /** Per-turn state resets appended to the cleanup action's script. */
  buildCleanupResets?(kit: CardKit): Block[];
}
