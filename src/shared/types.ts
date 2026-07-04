/**
 * Cardsmith — shared schema.
 *
 * A whole game is one serializable `GameDef` document. The engine interprets
 * it; the editors are forms over it; the runner is a view over engine state.
 * Every type here must remain JSON-serializable (no functions, no classes).
 */

export type Id = string;

/** Runtime value produced by expressions. PlayerRef/CardRef are ids. */
export type RuntimeValue = number | string | boolean | null;

// ---------------------------------------------------------------------------
// Game definition
// ---------------------------------------------------------------------------

/**
 * Current schema version. v2 adds move-cause tags, the draw / choosePile /
 * triggerAbilities blocks, the effectResolved event, the sumCards expression
 * and the 'contains' compare op — all additive, so v1 documents load
 * unchanged (migrateGameDef stamps them to v2).
 */
export const SCHEMA_VERSION = 2;

export interface GameDef {
  schemaVersion: 1 | 2;
  meta: GameMeta;
  variables: VariableDef[];
  zones: ZoneDef[];
  decks: DeckDef[];
  templates: CardTemplate[];
  /** Custom card definitions (referenced by custom decks). */
  cards: CardDef[];
  /** Script run once at game start (after decks spawn into their zones). */
  setup: Block[];
  /** Ordered phases of one player's turn. After the last phase, play passes on. */
  phases: PhaseDef[];
  /** Player-initiated moves, referenced from phases. */
  actions: ActionDef[];
  /** Global event-driven rules. */
  triggers: TriggerDef[];
  /** Checked after every action/trigger resolution; first match ends the game. */
  endConditions: EndConditionDef[];
  /** Card primary types (one per card via CardDef.typeId). Seeded [] by migrate. */
  cardTypes?: CardTypeDef[];
  /** Card tags (multi-assign via CardDef.tags). Seeded [] by migrate. */
  cardTags?: TagDef[];
  /** Reusable named filters (see NamedFilterDef). Seeded [] by migrate. */
  filters?: NamedFilterDef[];
  /**
   * Rendering contract for per-card state (engine ignores it): a perCard
   * boolean var that rotates the card 90° while truthy (tapped / defense
   * position), and perCard vars shown as chips on the card (counters).
   */
  cardState?: CardStateSpec;
  /** @deprecated v3 layout — auto-migrated into screenLayout at load. */
  tableLayout?: TableLayout | null;
  /** Authored game screen (v4); absent = the runner's automatic layout. */
  screenLayout?: ScreenLayout | null;
}

export interface CardStateSpec {
  rotateVar: Id | null;
  badgeVars: Id[];
}

/**
 * Shape of a shape element or a custom button. Radius shapes (rect/rounded/
 * pill/circle) round via border-radius; polygon shapes (diamond/hexagon/star)
 * clip to a polygon. 'rect' + a style radius covers arbitrary rounded rects.
 */
export type ShapeKind = 'rect' | 'rounded' | 'pill' | 'circle' | 'diamond' | 'hexagon' | 'star';

/** One box-shadow layer (drop shadow, or an inner glow when inset). */
export interface ShadowSpec {
  /** Offset in px. */
  x: number;
  y: number;
  /** Blur radius in px. */
  blur: number;
  /** Spread in px (grows/shrinks the shadow). */
  spread?: number;
  /** CSS colour. */
  color: string;
  /** Inner shadow instead of a drop shadow. */
  inset?: boolean;
}

/** Typography shared by the text-bearing kinds (text, varText, button labels).
 *  All optional; absent = the runner/skin default. fontSize/color/align/bold
 *  stay on the individual kinds (they predate this and are sometimes required). */
export interface TextStyle {
  /** CSS font-family stack (e.g. 'Georgia, serif'). */
  fontFamily?: string;
  /** 100-900. */
  fontWeight?: number;
  italic?: boolean;
  /** Letter spacing in px (may be negative). */
  letterSpacing?: number;
  /** Unitless line-height multiplier. */
  lineHeight?: number;
  /** Render the text uppercased. */
  uppercase?: boolean;
}

/** Visual chrome shared by every screen element (zones, groups, buttons, …). */
export interface LayoutStyle {
  /** CSS color/gradient. Absent = transparent. */
  background?: string;
  borderColor?: string;
  /** Border width in px (rendered at any board size; 0 = none). */
  borderWidth?: number;
  borderStyle?: 'solid' | 'dashed' | 'dotted';
  /** Uniform corner radius in px. */
  borderRadius?: number;
  /** Per-corner radius [top-left, top-right, bottom-right, bottom-left] in px;
   *  overrides borderRadius when present. */
  borderRadii?: [number, number, number, number];
  /** Element opacity 0-1 (1 = opaque; absent = opaque). */
  opacity?: number;
  /** Box shadows, painted front-to-back (CSS order). */
  shadows?: ShadowSpec[];
}

/** Rect in % (0-100) of its container (the board, a group, or a seat strip). */
export interface LayoutRect {
  x: number; y: number; w: number; h: number;
  /** Card width inside the zone, % of the BOARD's width. */
  cardScale?: number;
  showName?: boolean;
  /** Border / background / radius chrome. */
  style?: LayoutStyle;
  /** Inner padding between the zone's edge and its cards, % of board width. */
  padding?: number;
  /** Gap between cards in row/grid/fan layouts, % of board width. */
  gap?: number;
  /** Grid-layout zones: fixed column count (absent/null = auto-fill). */
  columns?: number | null;
  /** Board zones only: when set, x/y/w/h are % of that group's rect. */
  groupId?: Id | null;
}

/** A named container on the board ("category"): zones inside move with it. */
export interface LayoutGroup {
  id: Id;
  name: string;
  /** % of the board. */
  rect: { x: number; y: number; w: number; h: number };
  style?: LayoutStyle;
  showName?: boolean;
}

/** @deprecated v3 layout — migrated to ScreenLayout at load; remove with the v3 renderer. */
export interface TableLayout {
  /** Board background (CSS color/gradient). Defaults to the felt token. */
  background?: string;
  /** Shared zones (and perPlayer zones with area 'center'), on the board. */
  board: Record<Id, LayoutRect>;
  /** perPlayer 'player'-area zones, within each player's seat strip. */
  seat: Record<Id, LayoutRect>;
  /** Board-level groups; board zones join one via LayoutRect.groupId. */
  groups?: LayoutGroup[];
  /** Back-to-front z-order of board zone ids and group ids (absent = def order). */
  order?: Id[];
}

// ---------------------------------------------------------------------------
// Screen layout (v4) — the single-page game screen, designed from the
// VIEWER's perspective. Paint order = array order (back → front).
// ---------------------------------------------------------------------------

/**
 * Which player's zone instance / variable an element shows, relative to the
 * viewer: 'viewer' = the viewing seat, 'oppN' = the Nth seat after the viewer
 * in seating order. 'shared' for shared zones (ignored elsewhere).
 */
/** 'current' follows the acting turn: the element rebinds to whichever
 *  player's turn it is (e.g. an in-play row that always shows the mover). */
export type SeatRef = 'shared' | 'viewer' | 'current' | 'opp1' | 'opp2' | 'opp3';

export type RevealAnim = 'none' | 'fade' | 'scale' | 'slide-up' | 'slide-down';

/**
 * A conditional appearance for a screen element. The FIRST state whose
 * `when` holds (display evaluation, `$viewer` bound) applies: `style` merges
 * over the element's base style; `rect` (when set) replaces its position and
 * size. The runner animates state changes smoothly.
 */
export interface ElementState {
  id: Id;
  name: string;
  when: Expr;
  style?: LayoutStyle;
  rect?: { x: number; y: number; w: number; h: number } | null;
}

/** Fields shared by every screen element. Rect is % of the PARENT (screen or group). */
export interface ScreenElementBase {
  id: Id;
  /** Label shown in the Layers panel. */
  name: string;
  rect: { x: number; y: number; w: number; h: number };
  style?: LayoutStyle;
  /**
   * Display expression: the element renders only while this is truthy.
   * Evaluated read-only against the public GameState with `$viewer` bound
   * (see evalDisplayExpr in the engine). null = always visible.
   */
  visible?: Expr | null;
  /** Transition used when `visible` toggles (and on first appearance). */
  reveal?: RevealAnim;
  /** Conditional appearances (first match wins). */
  states?: ElementState[];
  /**
   * Render only while this selector BUTTON (a 'selector'-role button element
   * in the same screen) is the selected one of its group. Composes with
   * `visible` — both must hold. Absent = always (subject to `visible`).
   */
  showForSelector?: Id;
  /**
   * Retriggerable one-shot played when the element's resolved content or
   * active state changes ('stamp' = scale 1.07 + brightness flash).
   */
  onChangeAnim?: 'none' | 'stamp' | 'flash' | 'breathe';
  /**
   * Collapsible panel (the chronicle pattern): collapsed, the element shrinks
   * to a tab button docked at `side`; tapping slides the element open over
   * its neighbors. Collapsed state persists per game on the device.
   */
  collapsible?: {
    side: 'left' | 'right' | 'top' | 'bottom';
    /** Tab label; defaults to the element's name. */
    label?: string;
    startCollapsed?: boolean;
  } | null;
  /**
   * Child elements drawn ON TOP of this element — rects are % of THIS
   * element's box (a dot on a button, a label on a shape). Children move,
   * hide and animate with their parent. Groups use the same mechanism
   * (theirs is required); edit children via the builder's focus mode.
   */
  children?: ScreenElement[];
}

export type ScreenElement =
  | (ScreenElementBase & {
      kind: 'zone';
      zoneId: Id;
      seat: SeatRef;
      /** Card width, % of SCREEN width. */
      cardScale?: number;
      showName?: boolean;
      showCount?: boolean;
      /** Inner padding / card gap, % of screen width. */
      padding?: number;
      gap?: number;
      /** Grid placement: fixed rows/columns (absent or null = auto). */
      rows?: number | null;
      columns?: number | null;
      /**
       * 'cards' (default) renders each card; 'piles' groups by card def —
       * one pile per def with a × N badge (supply boards); 'carousel' lays
       * those piles in one horizontally scroll-snapping row (mobile supply).
       */
      display?: 'cards' | 'piles' | 'carousel';
      /**
       * Display-only filter ($card bound per candidate): several elements can
       * show different slices of ONE zone (treasure / victory / kingdom
       * regions of a single supply). Does not affect game logic.
       */
      cardFilter?: Expr | null;
      /** Piles: card field rendered as a corner badge (e.g. cost). */
      pileBadgeField?: Id | null;
      /** Hand-style zones: merge identical cards into one × N element. */
      collapseDuplicates?: boolean;
      /** Fan zones: degrees of rotation per card step (0 = flat; default ~4). */
      fanAngle?: number;
      /** Cards arriving in this zone play an effect ('burn' = char + embers). */
      arriveEffect?: 'none' | 'burn';
      /**
       * Keyboard spotlight group (DGT-style): holding the modifier dims every
       * other zone and shows digit badges on this zone's tappable cards;
       * 'plain' badges without a modifier. Absent = no keyboard marking.
       */
      keyGroup?: 'plain' | 'shift' | 'ctrl' | 'alt';
      /**
       * Piles/carousel face style: 'tile' renders the DGT compact pile tile
       * (accent-bordered plate, cost lozenge, name, × count — no full card
       * face) instead of the card template. Default 'card'.
       */
      pileFace?: 'card' | 'tile';
    })
  | (ScreenElementBase & TextStyle & {
      kind: 'text';
      text: string;
      /**
       * Dynamic text: segments evaluated with the display evaluator
       * ($viewer bound); player/card ids render as names. Overrides `text`
       * when present ("TURN " + turn number, the phase seal's hint line).
       */
      parts?: (string | Expr)[];
      /** % of screen width. */
      fontSize: number;
      color?: string;
      align: 'left' | 'center' | 'right';
      bold?: boolean;
    })
  | (ScreenElementBase & TextStyle & {
      kind: 'varText';
      varId: Id;
      /** Whose value (perPlayer vars); ignored for globals. */
      seat: SeatRef;
      /** Optional prefix, e.g. "Life: ". */
      label?: string;
      fontSize: number;
      color?: string;
      align: 'left' | 'center' | 'right';
      bold?: boolean;
      /** Bump (scale + accent flash) when the value changes. Default true. */
      ticker?: boolean;
    })
  | (ScreenElementBase & TextStyle & {
      kind: 'button';
      /** A none-target ActionDef id, or PASS_ACTION_ID. null = unbound (decorative). */
      actionId: Id | null;
      label: string;
      fontSize?: number;
      /** Custom silhouette (clips fill + label). Absent = a rounded rect. */
      shape?: ShapeKind;
      /**
       * 'selector' buttons switch CLIENT-side view state instead of performing
       * a game action (actionId is ignored): buttons sharing a selectorGroup
       * form a radio set — exactly one selected, persisted per device at
       * cardsmith.sel.<defId>.<groupId>; the first in paint order is the
       * default. Elements opt into a selection via showForSelector. The
       * runner marks the active one rn-sel-on. Default role: 'action'.
       */
      role?: 'action' | 'selector';
      /** The radio-set name this selector button belongs to (role 'selector'). */
      selectorGroup?: string;
    })
  /** A styled shape; states drive its fill/border (indicators, slots, markers). */
  | (ScreenElementBase & {
      kind: 'shape';
      shape: ShapeKind;
      /** Optional centered label (e.g. a phase name). */
      label?: string;
      /** % of screen width. */
      fontSize?: number;
    })
  /** A connector line drawn inside the rect (flow diagrams, phase tracks). */
  | (ScreenElementBase & {
      kind: 'line';
      /** 'h' | 'v' across the rect's middle; 'down' = TL→BR, 'up' = BL→TR. */
      orient: 'h' | 'v' | 'down' | 'up';
      /** px. */
      thickness: number;
      dashed?: boolean;
      arrow?: 'none' | 'end' | 'both';
    })
  /** The chronicle: a scrolling game-log panel with entry-in animation. */
  | (ScreenElementBase & {
      kind: 'log';
      /** % of screen width. */
      fontSize?: number;
      /** Show "Turn N" separators between turns. Default true. */
      turnSeparators?: boolean;
    })
  | (ScreenElementBase & {
      kind: 'group';
      children: ScreenElement[];
      /**
       * @deprecated Replaced by selector buttons (button `role: 'selector'`
       * + `showForSelector`): migrateGameDef converts `tabbed: true` groups
       * into a generated selector-button row plus bound panels on load, so
       * the runner never sees this flag. Kept only so old stored JSON still
       * parses.
       */
      tabbed?: boolean;
    });

/** Card-flight tuning (DGT-style WAAPI clones). All optional. */
export interface MotionSpec {
  /** Flight duration ms (default 430). */
  flightMs?: number;
  /** Midpoint arc lift px (default 46). */
  arc?: number;
  /** End rotation deg (default 4). */
  spin?: number;
  /** Stagger between grouped flights ms (default 55). */
  staggerMs?: number;
  /**
   * Per-move-cause overrides keyed by the move's tag ('draw', 'play',
   * 'gain', 'discard', …): each overrides the base numbers for flights whose
   * move carries that tag, so a draw can be brisk while a gain lingers.
   */
  byTag?: Record<string, { flightMs?: number; arc?: number; spin?: number; staggerMs?: number }>;
}

/** An alternate element tree for narrow screens (below 1024px). */
export interface ScreenVariant {
  background?: string;
  /**
   * Like ScreenLayout.aspect; additionally `scroll: true` with a numeric
   * aspect renders a tall page that scrolls vertically (stacked mobile
   * column) instead of letterboxing.
   */
  aspect?: number | null;
  scroll?: boolean;
  elements: ScreenElement[];
}

export interface ScreenLayout {
  /** Screen background (CSS color/gradient). Defaults to the felt token. */
  background?: string;
  /**
   * Design aspect (width/height). null/absent = fill the viewport (rects
   * stretch like a responsive page); a number locks the aspect (letterboxed).
   */
  aspect?: number | null;
  elements: ScreenElement[];
  /** Card-flight tuning for this screen. */
  motion?: MotionSpec;
  /** Alternate layout for narrow screens (<1024px). Absent = same layout. */
  mobile?: ScreenVariant | null;
  /**
   * The runner status bar. 'pinned' (default) = always visible. 'peek' =
   * collapses to a slim safe-area-clear handle after ~2s idle; expands on
   * hover / tap / drag-up / any focus within (reduced-motion: instant).
   */
  statusBar?: 'pinned' | 'peek';
}

export interface GameMeta {
  id: Id;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /** Accent color used for card backs and table theming. */
  accentColor?: string;
  /** True for bundled examples (read-only; clone to edit). */
  builtIn?: boolean;
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

export type VarScope = 'global' | 'perPlayer' | 'perCard';
export type VarType = 'number' | 'string' | 'boolean';

export interface VariableDef {
  id: Id;
  name: string;
  scope: VarScope;
  type: VarType;
  initial: number | string | boolean;
  /** Internal bookkeeping: never shown as a chip in the table's status bar. */
  hidden?: boolean;
}

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------

export type ZoneVisibility = 'all' | 'owner' | 'none' | 'topCard';
export type ZoneLayout = 'stack' | 'fan' | 'row' | 'grid';

export interface ZoneDef {
  id: Id;
  name: string;
  /** 'perPlayer' creates one instance of this zone per player. */
  owner: 'shared' | 'perPlayer';
  visibility: ZoneVisibility;
  layout: ZoneLayout;
  /** Table placement hint: 'player' renders in each player's strip, 'center' in the middle. */
  area: 'center' | 'player';
  /**
   * Max cards per instance (e.g. Yu-Gi-Oh's 5 monster slots). Moves beyond
   * capacity move only what fits (one script warning). Null/absent = unlimited.
   */
  capacity?: number | null;
}

// ---------------------------------------------------------------------------
// Decks & cards
// ---------------------------------------------------------------------------

export type StandardSuit = 'spades' | 'hearts' | 'diamonds' | 'clubs';

export type DeckSource =
  /** Classic 52-card deck. rank: 2..14 (11=J,12=Q,13=K,14=A). */
  | { kind: 'standard52'; jokers?: number; excludeRanks?: number[] }
  | { kind: 'custom'; entries: { cardId: Id; count: number }[] };

export interface DeckDef {
  id: Id;
  name: string;
  source: DeckSource;
  /**
   * Zone the deck spawns into at setup. If that zone is perPlayer, EVERY
   * player receives a full copy of the deck (e.g. personal TCG decks).
   */
  initialZone: Id;
  /** Shuffle after spawning (before the setup script runs). */
  shuffle: boolean;
}

/**
 * Built-in fields available on standard52 cards (usable as `fieldId`):
 *   'suit' -> StandardSuit, 'rank' -> 2..14, 'rankName' -> '2'..'10','J','Q','K','A',
 *   'color' -> 'red' | 'black', 'name' -> e.g. "Q of hearts", 'isJoker' -> boolean (rank 15).
 * Custom cards additionally always expose 'name'.
 */
export const STANDARD_FIELDS = ['suit', 'rank', 'rankName', 'color', 'name', 'isJoker'] as const;

export interface CardFieldDef {
  id: Id;
  name: string;
  type: 'text' | 'number' | 'image';
}

export interface CardDef {
  id: Id;
  name: string;
  templateId: Id;
  /** Values keyed by CardFieldDef id. Image fields hold a URL or data URL. */
  fields: Record<Id, string | number>;
  abilities: AbilityDef[];
  /** The card's single primary type (see GameDef.cardTypes). null/absent = untyped. */
  typeId?: Id | null;
  /** Any number of tags (see GameDef.cardTags) — the rest of the type line. */
  tags?: Id[];
}

/**
 * A card's primary category ("Action", "Treasure"…): exactly one per card,
 * drives the card's accent color. Authored in the Types & tags panel.
 */
export interface CardTypeDef {
  id: Id;
  name: string;
  /** CSS color for the type's accent (borders, type line). */
  color: string;
}

/** A multi-assign card label ("Attack", "Kingdom"…) — the type line's rest. */
export interface TagDef {
  id: Id;
  name: string;
}

/**
 * A reusable named condition ("The basic cards"): authored once in the
 * Filters panel, referenced anywhere via the filterRef expression.
 * `condition` is authored with $card bound. Cycles are rejected by
 * validateGameDef and evaluate to false at runtime.
 */
export interface NamedFilterDef {
  id: Id;
  name: string;
  condition: Expr;
}

/** Per-card triggered script. Runs with $self = this card, $owner = its zone's owner (or current player). */
export interface AbilityDef {
  id: Id;
  name: string;
  on: 'enterZone' | 'leaveZone' | 'turnStart' | 'turnEnd' | 'phaseStart' | 'phaseEnd';
  /**
   * For enter/leaveZone: the zone in question.
   * For turn/phase events: the zone the card must currently be in for the ability to be live.
   */
  zoneId: Id | null;
  /** For phaseStart/phaseEnd: restrict to a phase (null = any). */
  phaseId?: Id | null;
  /**
   * For enter/leaveZone: only fire when the move carries this cause tag
   * (see MOVE_TAGS). null/absent = any move (tagged or not).
   */
  tagFilter?: string | null;
  condition: Expr | null;
  script: Block[];
  /** Push onto the stack instead of running inline. */
  stacked?: boolean;
}

// ---------------------------------------------------------------------------
// Card visual templates
// ---------------------------------------------------------------------------

/**
 * Element coordinates (x, y, w, h) are percentages of card size (0-100).
 * Font sizes are percentages of card WIDTH, so cards scale to any pixel size.
 */
export type TemplateElement =
  | {
      kind: 'text';
      id: Id;
      /** Card field to display, or null to show the static `text`. */
      bind: Id | null;
      text: string;
      x: number; y: number; w: number; h: number;
      fontSize: number;
      bold: boolean;
      italic: boolean;
      align: 'left' | 'center' | 'right';
      color: string;
    }
  | {
      kind: 'stat';
      id: Id;
      bind: Id | null;
      x: number; y: number; w: number; h: number;
      shape: 'circle' | 'square' | 'shield';
      bg: string;
      color: string;
      fontSize: number;
    }
  | {
      kind: 'image';
      id: Id;
      /** Image field to display, or null to use the static `src`. */
      bind: Id | null;
      src: string;
      x: number; y: number; w: number; h: number;
      fit: 'cover' | 'contain';
      radius: number;
    }
  | {
      kind: 'box';
      id: Id;
      x: number; y: number; w: number; h: number;
      fill: string;
      radius: number;
    };

export interface CardTemplate {
  id: Id;
  name: string;
  /** width / height. Poker card = 0.714. */
  aspect: number;
  background: string;
  borderColor: string;
  cornerRadius: number;
  elements: TemplateElement[];
  fields: CardFieldDef[];
}

// ---------------------------------------------------------------------------
// Flow: phases, actions, triggers, end conditions
// ---------------------------------------------------------------------------

export interface PhaseDef {
  id: Id;
  name: string;
  /** Script run when the phase begins (for the current player). */
  onEnter: Block[];
  /** Actions the current player may take during this phase. */
  actionIds: Id[];
  /**
   * 'auto' — run onEnter then advance immediately (no player input).
   * 'oneAction' — phase ends automatically after the first action resolves.
   * 'manual' — player may take any number of actions; an `endPhase`/`endTurn`
   *            block (often via a "Done" action) moves things along.
   */
  mode: 'auto' | 'oneAction' | 'manual';
}

export type ActionTarget =
  /** Player picks a card from a zone. In legality/script, $card = the pick. */
  | { kind: 'cardInZone'; zoneId: Id; ownerOnly: boolean }
  /** Player taps a zone (e.g. draw pile). */
  | { kind: 'zone'; zoneId: Id; ownerOnly: boolean }
  /** A plain button (pass, knock, flip...). */
  | { kind: 'none' };

export interface ActionDef {
  id: Id;
  name: string;
  target: ActionTarget;
  /**
   * Evaluated per candidate (with $card bound for cardInZone targets).
   * null = always legal. The action is offered if ANY candidate passes.
   */
  legality: Expr | null;
  script: Block[];
  /**
   * 'normal' (default): offered during the player's own turn phases.
   * 'response': offered ONLY while a response window is open (instants,
   * traps, reactions) — to whichever player holds priority.
   */
  speed?: 'normal' | 'response';
  /**
   * Stacked actions resolve via the stack: performing one runs `announce`
   * immediately (pay costs, move the card), pushes `script` + the live
   * bindings, then opens a response window. See docs/engine-semantics.md.
   */
  stacked?: boolean;
  announce?: Block[];
}

/** The built-in pass move offered while a response window is open. */
export const PASS_ACTION_ID = '__pass';

export type EventSpec =
  | { kind: 'turnStart' }
  | { kind: 'turnEnd' }
  | { kind: 'phaseStart'; phaseId: Id | null }
  | { kind: 'phaseEnd'; phaseId: Id | null }
  /**
   * $card, plus $fromZone/$toZone zone ids and $tag (the move's cause tag or
   * null), bound in condition+script. `tag` filters on the move's cause:
   * null/absent matches ANY move (back-compat), a string matches only moves
   * carrying exactly that tag.
   */
  | { kind: 'cardEnterZone'; zoneId: Id | null; tag?: string | null }
  | { kind: 'cardLeaveZone'; zoneId: Id | null; tag?: string | null }
  /** Fires when a zone instance becomes empty. $owner bound for perPlayer zones. */
  | { kind: 'zoneEmptied'; zoneId: Id | null }
  | { kind: 'varChanged'; varId: Id | null }
  /**
   * Fires after a pending stack entry's script resolves and settles, BEFORE
   * the response window reopens. Binds $card (the entry's source card, when
   * present) and $player (who pushed it, when known). Cancelled entries do
   * NOT fire this. A `cancelTopEffect` inside this rule targets the NEXT
   * entry (the resolved one is already gone).
   */
  | { kind: 'effectResolved' };

export interface TriggerDef {
  id: Id;
  name: string;
  event: EventSpec;
  condition: Expr | null;
  script: Block[];
  /** Push the script onto the stack instead of running inline (MTG-style triggered abilities). */
  stacked?: boolean;
}

export type WinnerSpec =
  | { kind: 'player'; player: Expr }
  | { kind: 'highestVar'; varId: Id }
  | { kind: 'lowestVar'; varId: Id }
  | { kind: 'draw' };

export interface EndConditionDef {
  id: Id;
  name: string;
  condition: Expr;
  winner: WinnerSpec;
}

// ---------------------------------------------------------------------------
// Blocks (statements)
// ---------------------------------------------------------------------------

/**
 * Reference to a zone instance. For perPlayer zones, `owner` resolves the
 * player; when null the engine uses the contextual player ($player binding
 * if set, else the current player).
 */
export interface ZoneRef {
  zoneId: Id;
  owner: Expr | null;
}

export type CardSelector =
  | { kind: 'top'; count: Expr }
  | { kind: 'bottom'; count: Expr }
  | { kind: 'all' }
  /** All cards matching a filter ($card bound per candidate). */
  | { kind: 'filter'; filter: Expr }
  /** One specific card from an expression (e.g. $choice, $card). */
  | { kind: 'specific'; card: Expr }
  | { kind: 'random'; count: Expr };

export type ChoiceSpec =
  | { kind: 'card'; from: ZoneRef; filter: Expr | null; prompt: string; optional: boolean; revealed?: boolean }
  | { kind: 'option'; prompt: string; options: { id: string; label: string }[] }
  | { kind: 'player'; prompt: string; includeSelf: boolean }
  | { kind: 'yesNo'; prompt: string };

/**
 * Canonical move-cause tags surfaced in the editor (stored free-form).
 * A tagged move carries its tag on the cardEnterZone/cardLeaveZone events so
 * triggers/abilities can react to WHY a card moved, not just where.
 */
export const MOVE_TAGS = ['gain', 'buy', 'trash', 'discard', 'play', 'draw', 'cleanup'] as const;

export type Block =
  /** `tag`: optional cause tag carried on the move's events (see MOVE_TAGS). */
  | { kind: 'moveCards'; from: ZoneRef; to: ZoneRef; cards: CardSelector; toPosition: 'top' | 'bottom'; faceUp: boolean | null; tag?: string | null }
  | { kind: 'shuffle'; zone: ZoneRef }
  /** Deal `count` cards from a shared zone to each player's instance of a perPlayer zone, round-robin. */
  | { kind: 'deal'; from: ZoneRef; toZoneId: Id; count: Expr }
  | { kind: 'setVar'; varId: Id; target: Expr | null; value: Expr }
  | { kind: 'changeVar'; varId: Id; target: Expr | null; by: Expr }
  | { kind: 'if'; cond: Expr; then: Block[]; else: Block[] }
  | { kind: 'repeat'; times: Expr; body: Block[] }
  /** Binds $player. Iterates in seating order starting from the current player. */
  | { kind: 'forEachPlayer'; body: Block[] }
  /** Binds $card. Snapshot of matching cards taken before iterating. */
  | { kind: 'forEachCard'; zone: ZoneRef; filter: Expr | null; body: Block[] }
  /** Pauses for input from `who` (a player expr; null = current player). Result bound to $choice. */
  | { kind: 'choose'; who: Expr | null; choice: ChoiceSpec }
  /**
   * Multi-select: `who` picks min..max cards from the (filtered) zone, then
   * `body` runs once per picked card in pick order with $card bound.
   * `revealed` shows candidates' faces to the chooser (deck searches).
   */
  | { kind: 'chooseCards'; who: Expr | null; from: ZoneRef; filter: Expr | null; min: Expr; max: Expr; prompt: string; revealed: boolean; body: Block[] }
  /**
   * Pile choice (supply gains): the (filtered) zone's cards are grouped into
   * one pile per distinct card identity (custom cards by defId, standard
   * cards by name), in first-appearance order (bottom→top). `who` picks one
   * pile; `body` runs once with $card bound to that pile's TOP copy.
   * Mandatory while any pile exists unless `optional` (decline = skip body).
   * Groups are computed at ask time — no staging zone, no mutation window.
   */
  | { kind: 'choosePile'; who: Expr | null; from: ZoneRef; filter: Expr | null; groupBy: 'def'; prompt: string; optional: boolean; revealed?: boolean; body: Block[] }
  /**
   * Draw with inline refill: move `count` cards one at a time from the top of
   * `from` to `to`. Whenever `from` is empty and `refillFrom` is not, ALL of
   * `refillFrom` moves into `from` face-down and is shuffled (seeded game
   * RNG) before drawing continues; stops early when both are empty. Each
   * drawn card charges budget and emits move events tagged `tag` (default
   * 'draw'). `who` sets the contextual player for owner-less zone refs.
   */
  | { kind: 'draw'; who: Expr | null; count: Expr; from: ZoneRef; refillFrom: ZoneRef | null; to: ZoneRef; faceUp: boolean | null; tag?: string | null }
  /**
   * Re-fire a card's enter-zone moment WITHOUT moving it (Throne Room):
   * enqueues a synthetic cardEnterZone event for `zoneId` tagged 'play'
   * (fromZoneId = the card's current zone). Runs through the normal drain,
   * so stacked abilities still stack — and global triggers watching that
   * zone ALSO fire (it IS "the card is played again"). Missing card = no-op.
   */
  | { kind: 'triggerAbilities'; card: Expr; on: 'enterZone'; zoneId: Id }
  /**
   * Counter/negate: drop the top pending stack entry without running it; its
   * source card (if any) moves to `cardTo` (null = leave the card alone).
   */
  | { kind: 'cancelTopEffect'; cardTo: Id | null }
  | { kind: 'announce'; parts: (string | Expr)[] }
  | { kind: 'flipCards'; zone: ZoneRef; cards: CardSelector; faceUp: boolean }
  | { kind: 'endPhase' }
  | { kind: 'endTurn' }
  /** Overrides who takes the next turn (e.g. trick winner leads). */
  | { kind: 'setNextPlayer'; player: Expr }
  | { kind: 'endGame'; winner: WinnerSpec };

// ---------------------------------------------------------------------------
// Expressions
// ---------------------------------------------------------------------------

export type MathOp = '+' | '-' | '*' | '/' | '%';
/**
 * 'contains' = whole-word membership for multi-value text fields: true when
 * the RIGHT value appears as a whole whitespace-separated word inside the
 * LEFT value (case-sensitive). "action attack" contains "action" → true;
 * "action attack" contains "act" → false. Non-strings coerce via String();
 * null on either side → false.
 */
export type CompareOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'contains';

export type Expr =
  | { kind: 'num'; value: number }
  | { kind: 'str'; value: string }
  | { kind: 'bool'; value: boolean }
  /** Read a variable. `target` = player/card expr for perPlayer/perCard scopes (null = contextual). */
  | { kind: 'getVar'; varId: Id; target: Expr | null }
  | { kind: 'zoneCount'; zone: ZoneRef }
  /** Field of a card (card expr -> card instance id). Works with built-in standard52 fields. */
  | { kind: 'cardField'; card: Expr; fieldId: Id }
  /** Top card of a zone (card instance id, or null when empty). */
  | { kind: 'topCard'; zone: ZoneRef }
  /** Context binding: '$card' | '$player' | '$choice' | '$self' | '$owner' | '$fromZone' | '$toZone' | '$zone' */
  | { kind: 'binding'; name: string }
  | { kind: 'currentPlayer' }
  | { kind: 'playerCount' }
  | { kind: 'turnNumber' }
  /** Player seated after the given player. */
  | { kind: 'nextPlayer'; from: Expr }
  /** Owner of the zone holding this card (null for shared zones). */
  | { kind: 'cardOwner'; card: Expr }
  /** Zone id of the zone holding this card. */
  | { kind: 'cardZoneId'; card: Expr }
  | { kind: 'math'; op: MathOp; left: Expr; right: Expr }
  | { kind: 'compare'; op: CompareOp; left: Expr; right: Expr }
  | { kind: 'logic'; op: 'and' | 'or'; left: Expr; right: Expr }
  | { kind: 'not'; expr: Expr }
  /** Card with highest/lowest numeric `fieldId` in a zone (null if zone empty / nothing matches). */
  | { kind: 'bestCard'; zone: ZoneRef; by: 'highest' | 'lowest'; fieldId: Id; filter: Expr | null }
  /**
   * Number of cards in a zone matching a filter (null filter = all).
   * NOTE: inside the filter, $card is rebound to each candidate (shadowing
   * any outer $card binding) — compare against variables, not outer $card.
   */
  | { kind: 'countCards'; zone: ZoneRef; filter: Expr | null }
  /**
   * Sum of a numeric card field over a zone's (filtered) cards → number.
   * Non-numeric / missing field values count 0. Filter binds $card per
   * candidate (shadowing, like countCards).
   */
  | { kind: 'sumCards'; zone: ZoneRef; fieldId: Id; filter: Expr | null }
  /** Uniform random integer in [1, max]. Uses the seeded game RNG. */
  | { kind: 'random'; max: Expr }
  /** Number of pending (unresolved) effects on the stack. */
  | { kind: 'stackSize' }
  /** Source card of the top pending stack entry (null when empty / cardless). */
  | { kind: 'stackTopCard' }
  /** Index of the CURRENT phase (0-based). Resets when the turn passes. */
  | { kind: 'phaseIndex' }
  /**
   * Index of a phase in the turn order (0-based; -1 if it no longer exists).
   * "has been" = phaseIndex > phasePos, "is current" = ==, "not yet" = <.
   */
  | { kind: 'phasePos'; phaseId: Id }
  /** True while the named phase is the current phase (sugar for the == above). */
  | { kind: 'phaseIs'; phaseId: Id }
  /**
   * True when the card's resolved def has this primary type (CardDef.typeId).
   * An untyped card (no typeId), a standard52 card, or a missing card → false.
   */
  | { kind: 'cardTypeIs'; card: Expr; typeId: Id }
  /** True when `tagId` is among the card's tags (CardDef.tags). Tagless or missing card → false. */
  | { kind: 'cardHasTag'; card: Expr; tagId: Id }
  /**
   * Evaluate the named filter's condition (GameDef.filters) with $card
   * rebound to `card` → boolean. Cycle-guarded: re-entering a filter already
   * resolving on this evaluation reports a script error and yields false
   * (never throws); validateGameDef rejects cycles at author time.
   */
  | { kind: 'filterRef'; filterId: Id; card: Expr };

// ---------------------------------------------------------------------------
// Runtime state (produced/owned by the engine, consumed by the runner)
// ---------------------------------------------------------------------------

export interface CardInstance {
  /** Unique per game run. */
  instanceId: Id;
  /** Custom card def id, or null for generated standard cards. */
  defId: Id | null;
  templateId: Id | null;
  name: string;
  /** Resolved fields (standard cards get suit/rank/etc, custom get their def fields). */
  fields: Record<string, string | number | boolean>;
  faceUp: boolean;
  vars: Record<Id, RuntimeValue>;
}

export interface ZoneInstance {
  /** `${zoneId}` for shared, `${zoneId}:${playerId}` for perPlayer. */
  key: string;
  zoneId: Id;
  ownerId: Id | null;
  /** Index 0 = BOTTOM, last = TOP. */
  cardIds: Id[];
}

export interface PlayerState {
  id: Id; // 'p0', 'p1', ...
  name: string;
  isAI: boolean;
  vars: Record<Id, RuntimeValue>;
}

export interface LogEntry {
  turn: number;
  text: string;
}

export interface GameResult {
  /** Winner player ids ([] = draw). */
  winners: Id[];
  text: string;
}

/** Public mirror of a pending stack entry (scripts/snapshots stay engine-internal). */
export interface StackEntryView {
  id: number;
  label: string;
  sourceCardId: Id | null;
  /** Player who pushed it (announced the action / controlled the trigger). */
  byPlayerId: Id | null;
}

export interface ResponseWindowView {
  /** Player currently holding priority. */
  holderId: Id;
  passes: number;
}

export interface GameState {
  seed: number;
  players: PlayerState[];
  globalVars: Record<Id, RuntimeValue>;
  zones: Record<string, ZoneInstance>;
  cards: Record<Id, CardInstance>;
  currentPlayerIdx: number;
  phaseIdx: number;
  turnNumber: number;
  /**
   * Cause tag of the move that most recently placed each card in its current
   * zone (null = untagged move; absent key = never moved). Rendering surface
   * for per-tag flight tuning (MotionSpec.byTag / flip layer) — the engine
   * writes it in performMove and never reads it back.
   */
  moveTags?: Record<Id, string | null>;
  log: LogEntry[];
  result: GameResult | null;
  /** Pending (unresolved) effects, bottom→top. Empty in games that never stack. */
  stack: StackEntryView[];
  /** Open response window, or null during normal play. */
  window: ResponseWindowView | null;
}

// ---------------------------------------------------------------------------
// Engine contract (implemented by src/engine, consumed by the runner & tests)
// ---------------------------------------------------------------------------

/** A legal move a player can make right now. */
export interface Move {
  actionId: Id;
  /** For cardInZone targets. */
  cardId?: Id;
}

export type ChoiceRequest =
  | { id: number; playerId: Id; kind: 'card'; prompt: string; cardIds: Id[]; optional: boolean; revealed?: boolean }
  | { id: number; playerId: Id; kind: 'option'; prompt: string; options: { id: string; label: string }[] }
  | { id: number; playerId: Id; kind: 'player'; prompt: string; playerIds: Id[] }
  | { id: number; playerId: Id; kind: 'yesNo'; prompt: string }
  /** Multi-select: answer with a JSON array string of min..max distinct ids from cardIds. */
  | { id: number; playerId: Id; kind: 'cards'; prompt: string; cardIds: Id[]; min: number; max: number; revealed?: boolean }
  /**
   * Pile choice: cardIds[i] is pile i's representative (top copy), counts[i]
   * its size (for × N badges). Answer with a representative id, or null to
   * decline when optional.
   */
  | { id: number; playerId: Id; kind: 'pile'; prompt: string; cardIds: Id[]; counts: number[]; optional: boolean; revealed?: boolean };

/**
 * Answer: card instance id | option id | player id | boolean | null (declined
 * optional card) | JSON array string of card ids (for 'cards' requests).
 */
export type ChoiceAnswer = string | boolean | null;

export interface ChoiceProvider {
  resolve(req: ChoiceRequest, state: GameState): Promise<ChoiceAnswer>;
}

export interface EngineOptions {
  playerNames: string[];
  aiSeats: boolean[];
  seed: number;
  choiceProvider: ChoiceProvider;
  /** Called after every visible state change (moves, var changes, phase/turn changes...). */
  onUpdate: (state: GameState) => void;
  /** Non-fatal script problems (bad refs, budget exceeded). */
  onScriptError?: (message: string) => void;
}

export interface EngineHandle {
  readonly def: GameDef;
  /** Runs deck spawning + setup script + enters the first phase. */
  start(): Promise<void>;
  /** Enumerate legal moves for a player (empty unless it's their turn). */
  getLegalMoves(playerId: Id): Move[];
  /** Validate + run an action. Resolves when the script and resulting triggers settle. */
  performAction(playerId: Id, move: Move): Promise<void>;
  getState(): GameState;
  readonly finished: boolean;
}

// ---------------------------------------------------------------------------
// Validation (shared between editors and engine)
// ---------------------------------------------------------------------------

export interface ValidationIssue {
  severity: 'error' | 'warning';
  /** Human-readable location, e.g. "Phase 'Draw' > onEnter > block 2". */
  where: string;
  message: string;
}
