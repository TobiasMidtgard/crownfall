/**
 * Nocturne — THE NIGHT CARDS + SPIRITS. Kingdom piles (10 each): Changeling,
 * Cobbler, Crypt, Den of Sin, Devil's Workshop, Exorcist, Ghost Town,
 * Guardian, Monastery, Night Watchman, Raider, Secret Cave, Vampire,
 * Werewolf. Non-supply stock owned by THIS module: the Spirit piles
 * (dom_zone_spirits — Will-o'-Wisp ×12, Imp ×13, Ghost ×6), the Bat roost
 * (dom_zone_bats — Bat ×10, Vampire's exchange partner) and the WISH STOCK
 * (dom_zone_wishes — Wish ×12) which agent C's Leprechaun / Magic Lamp gain
 * from by referencing dom_zone_wishes / dom_card_wish.
 *
 * All printed texts verified against the official Nocturne card list
 * (dominionstrategy.com/card-lists/nocturne-card-list) and the Rio Grande
 * rulebook.
 *
 * THE NIGHT PHASE: every kingdom card here is Night-typed (nightNames), so
 * the core's dom_phase_night exists (between Buy and Cleanup) while this
 * module is registered. Playing a Night card via the core
 * 'dom_action_play_night' costs NO Action; the phase auto-skips for
 * nightless hands (even "end the night" is gated on holding one).
 *
 * THE HEX CONTRACT (agent A — nocturneBoons): Vampire and Werewolf deliver
 * Hexes by replicating A's receive shape with the shared literals: the top
 * card of the Hex deck (dom_zone_hexes) moves to the shared reveal zone
 * dom_zone_fate tagged 'draw' (each Hex card carries its effect as an
 * enterZone ability there), then sweeps to dom_zone_hexes_used; an empty
 * deck reshuffles the used pile back in first, and a still-empty deck whiffs
 * politely. Until nocturneBoons registers those zones the merged def only
 * validates with a zones-only stub (see nocturneNight.test.ts) and the whiff
 * branch is all that runs. Reconcile the receiver-binding handshake with A's
 * final header once it lands.
 *
 * House idioms as in the earlier modules: attack halves are separate
 * `stacked: true` abilities gated per victim on IMMUNE == 0 (the shared
 * effectResolved trigger resets it), watchers watch BOTH 'gain' and 'buy'
 * causes, dug-through cards stage in the hidden shared LOOK zone, exchanges
 * and returns-to-pile are UNTAGGED moves (neither gains nor discards —
 * printed), and every mandatory choice is guarded so a session cannot hang.
 * TWO-PLAYER TABLE: "each other player" is the one opponent.
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - ONE-PRIMARY-TYPE NIGHT (prominent): all FOURTEEN kingdom cards are
 *    Night-typed. WEREWOLF therefore plays at night only — its printed day
 *    mode ("Otherwise, +3 Cards", as an Action) is unreachable and DROPPED.
 *    SECRET CAVE (printed Action–Duration) also plays only at night: its
 *    +1 Card / +1 Action still pay out there, and Throne Room cannot touch
 *    it. Duration-ness stays behavioral (no Duration tag exists).
 *  - SPIRIT / BAT TYPES: the core's non-supply type-line loop never applies
 *    nightNames (kingdom piles only), so GHOST (printed Night–Duration–
 *    Spirit) and BAT (printed Night) are Action-typed here: played in the
 *    Action phase for an Action. Will-o'-Wisp and Imp are printed
 *    Action–Spirit and Wish printed Action — those are EXACT.
 *  - GAINED-THIS-TURN (Devil's Workshop / Monastery): the Goatherd-style
 *    counter — every 'gain'/'buy'-tagged move counts toward the CURRENT
 *    player (off-turn gains attribute to the turn player), reset at that
 *    player's action-phase start. Monastery's steps are unrolled to a cap
 *    of 10 gains.
 *  - RAIDER: "a card you have in play" spans In Play AND the owner's parked
 *    DURATION cards (Horn of Plenty's Sea Chart reading — the parked Raider
 *    itself counts, as printed); "or reveals they can't" is an announcement,
 *    not a card-by-card hand reveal.
 *  - GUARDIAN: paper's automatic until-your-next-turn immunity is the
 *    Lighthouse pattern — an active response-speed wave-off per attack
 *    ('dom_action_guardian') while the copy sits in the DURATION zone.
 *  - CHANGELING: the on-gain exchange (Trader's idiom) is offered only while
 *    the gained card still sits in the gainer's discard pile (gained-to-hand
 *    or topdecked cards keep no offer) and never for a gained Changeling;
 *    the $3+ line is Bridge-aware (current cost). "Gain a copy of a card you
 *    have in play" offers the supply piles whose name matches anything in
 *    In Play or parked DURATION (exact, via per-card marks).
 *  - CRYPT: multiple Crypts' set-asides merge into one pool (each retrieval
 *    draws one from the union); a Crypt whose pool is empty marches back at
 *    the same turn start its last card is retrieved.
 *  - VAMPIRE / WEREWOLF TIMING: the immediate halves (Vampire's gain + Bat
 *    exchange) resolve before the response window opens (Militia's pattern);
 *    the printed order lists the Hexes first.
 *  - EXORCIST: "a cheaper Spirit" compares PRINTED costs (Remake's
 *    precedent — Spirit costs are starred and never Bridge-shifted here).
 *  - NIGHT WATCHMAN: "put the rest back in any order" is chosen one card at
 *    a time — later picks land ABOVE earlier ones.
 *  - GHOST: the second play is skipped (announced) when the set-aside Action
 *    left play during the first resolution (Royal Carriage's guard); a
 *    Duration played by Ghost parks once (the Throne Room contract).
 *  - MAGIC LAMP: Secret Cave's Heirloom belongs to agent C — no Heirloom
 *    setup swap ships here.
 */
import type {
  ActionDef, Block, CardDef, Expr, TriggerDef, VariableDef, ZoneDef,
} from '../../shared/types';
import {
  ALL, CURRENT, STACK_SIZE, STACK_TOP, add, allOf, announce, anyOf, bestCard, bnd,
  cardZoneId, changeVar, chooseCard, chooseCardsBlock, chooseOption, countCards, eq, field,
  forEachCard, forEachOpponent, getVar, gt, gte, iff, lte, move, neq, num, setVar, shuffle,
  specific, str, topCard, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Changeling: 'dom_card_changeling',
  Cobbler: 'dom_card_cobbler',
  Crypt: 'dom_card_crypt',
  'Den of Sin': 'dom_card_den_of_sin',
  "Devil's Workshop": 'dom_card_devils_workshop',
  Exorcist: 'dom_card_exorcist',
  'Ghost Town': 'dom_card_ghost_town',
  Guardian: 'dom_card_guardian',
  Monastery: 'dom_card_monastery',
  'Night Watchman': 'dom_card_night_watchman',
  Raider: 'dom_card_raider',
  'Secret Cave': 'dom_card_secret_cave',
  Vampire: 'dom_card_vampire',
  Werewolf: 'dom_card_werewolf',
  // Non-supply stock.
  "Will-o'-Wisp": 'dom_card_will_o_wisp',
  Imp: 'dom_card_imp',
  Ghost: 'dom_card_ghost',
  Bat: 'dom_card_bat',
  Wish: 'dom_card_wish',
};

/** The shared face-down Spirit stock (Will-o'-Wisp / Imp / Ghost piles). */
export const SPIRIT_ZONE = 'dom_zone_spirits';
/** The Bat roost — Vampire's exchange partner waits here. */
export const BAT_ZONE = 'dom_zone_bats';
/** THE WISH STOCK — declared here for agent C (Leprechaun / Magic Lamp gain
 *  Wishes by referencing this zone id and dom_card_wish). */
export const WISH_ZONE = 'dom_zone_wishes';

/**
 * AGENT A's HEX ZONES (nocturneBoons declares them; referenced here by id —
 * see the header's hex-contract note). The merged def does not validate
 * until that module (or the test stub) supplies the zones.
 */
export const HEX_ZONE = 'dom_zone_hexes';
export const HEX_USED_ZONE = 'dom_zone_hexes_used';
export const FATE_ZONE = 'dom_zone_fate';

/** Cards gained while this player was CURRENT, since their last action-phase
 *  start (Devil's Workshop / Monastery's "gained this turn" memory). */
export const NOCT_GAINED_VAR = 'dom_var_noct_gained';
/** Name stash for the copy-test mark passes (Raider / Imp / Changeling). */
export const NOCT_NAME_VAR = 'dom_var_noct_name';
/** Per-card copy-test mark (reset before every pass). */
export const NOCT_MARK_VAR = 'dom_var_noct_mark';
/** 1 while this Treasure lies under a Crypt in the DURATION zone. */
export const CRYPT_MARK = 'dom_var_crypt_aside';
/** 1 while this Action is a Ghost's set-aside prize; 2 transiently while a
 *  Ghost's later-half is playing it (the promote-then-move dance). */
export const GHOST_MARK = 'dom_var_ghost_aside';

/** seaside2eA's Haven mark, referenced by id (the kit does the same): a
 *  Haven-parked copy was never played, so later-halves stay inert on it. */
const HAVEN_ASIDE = 'dom_var_haven_aside';

/** The action phase's id (stable dominionGame.ts literal — Seaside's idiom). */
const PHASE_ACTION = 'dom_phase_action';

/** A yes/no question to `who`; the answer lands in $choice as a boolean. */
const yesNo = (who: Expr, prompt: string): Block =>
  ({ kind: 'choose', who, choice: { kind: 'yesNo', prompt } });

/** Empty deck → flip the discard in face-down and shuffle (paper reshuffle). */
function refillDeck(kit: CardKit, who: Expr): Block {
  const deck = zone(kit.zones.DECK, who);
  return iff(allOf(
    eq(zoneCount(deck), num(0)),
    gt(zoneCount(zone(kit.zones.DISCARD, who)), num(0)),
  ), [
    move(ALL, zone(kit.zones.DISCARD, who), deck, { faceUp: false }),
    shuffle(deck),
  ]);
}

/** Top card of `who`'s deck → `to` (per-card reshuffle timing, no repeat). */
function takeTop(kit: CardKit, who: Expr, to: ReturnType<typeof zone>, faceUp: boolean): Block[] {
  const deck = zone(kit.zones.DECK, who);
  return [
    refillDeck(kit, who),
    iff(gt(zoneCount(deck), num(0)), [
      move(topN(1), deck, to, { faceUp }),
    ]),
  ];
}

/**
 * THE HEX RECEIVE (agent A's contract, replicated — see the header): flip
 * the used pile back in when the deck is empty, then the top Hex moves to
 * the shared reveal zone tagged 'draw' (the Hex's own enterZone ability
 * fires there) and sweeps to the used pile. A still-empty deck whiffs
 * politely, so the scripts run safely before A's Hex cards exist.
 */
function receiveHex(kit: CardKit, who: Expr): Block[] {
  const hexes = zone(HEX_ZONE);
  const used = zone(HEX_USED_ZONE);
  const fate = zone(FATE_ZONE);
  return [
    iff(allOf(eq(zoneCount(hexes), num(0)), gt(zoneCount(used), num(0))), [
      move(ALL, used, hexes, { faceUp: false }),
      shuffle(hexes),
    ]),
    iff(gt(zoneCount(hexes), num(0)), [
      announce(who, ' receives the next Hex: ', topCard(hexes), '.'),
      kit.tmove(topN(1), hexes, fate, 'draw', { faceUp: true }),
      move(ALL, fate, used, { faceUp: true }),
    ], [announce('The Hex deck is empty — no Hex arrives.')]),
  ];
}

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK, DURATION } = kit.zones;
  const { ACTIONS, COINS, IMMUNE, SCRATCH, DISCOUNT } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER, SELF } = kit;
  const { nameIs } = kit;

  /** "This candidate wears the copy-test mark" (fresh nodes per call). */
  const marked = (): Expr => eq(getVar(NOCT_MARK_VAR, CARD), num(1));
  const cryptMarked = (): Expr => eq(getVar(CRYPT_MARK, CARD), num(1));
  const ghostMarked = (): Expr => eq(getVar(GHOST_MARK, CARD), num(1));
  const ghostPlaying = (): Expr => eq(getVar(GHOST_MARK, CARD), num(2));

  /** Gain the named basic from the supply into `to` (guarded on the pile). */
  const gainNamed = (name: string, who: Expr, note: string, empty: string): Block =>
    iff(gt(countCards(zone(SUPPLY), nameIs(name)), num(0)), [
      announce(who, note),
      kit.tmove(
        specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs(name))),
        zone(SUPPLY), zone(DISCARD, who), 'gain', { faceUp: true },
      ),
    ], [announce(empty)]);

  /**
   * Mark every card of `targetZone` (an owner-bound zone ref factory) whose
   * name matches some card `whose` has in play — In Play AND parked DURATION
   * (the Sea Chart reading; see the register). The stash var carries each
   * in-play name across the inner loop's $card rebinding.
   */
  const markCopiesOf = (
    whose: Expr, stashKey: Expr, targetZone: () => ReturnType<typeof zone>,
  ): Block[] => [
    forEachCard(targetZone(), null, [setVar(NOCT_MARK_VAR, num(0), CARD)]),
    ...[INPLAY, DURATION].map((zid) => forEachCard(zone(zid, whose), null, [
      setVar(NOCT_NAME_VAR, field(CARD, 'name'), stashKey),
      forEachCard(targetZone(), eq(field(CARD, 'name'), getVar(NOCT_NAME_VAR, stashKey)), [
        setVar(NOCT_MARK_VAR, num(1), CARD),
      ]),
    ])),
  ];

  // --- Monastery's step machinery (fresh nodes per step — see the register) --
  const monasteryStep = (idx: number): Block =>
    iff(gte(getVar(NOCT_GAINED_VAR, OWNER), num(idx + 1)), [
      iff(anyOf(
        gt(zoneCount(zone(HAND, OWNER)), num(0)),
        gt(countCards(zone(INPLAY, OWNER), nameIs('Copper')), num(0)),
      ), [
        chooseOption(`Monastery (gain ${idx + 1}): trash something?`, [
          { id: 'mon_hand', label: 'Trash a card from your hand' },
          { id: 'mon_copper', label: 'Trash a Copper you have in play' },
          { id: 'mon_skip', label: 'Trash nothing' },
        ], OWNER),
        iff(eq(CHOICE, str('mon_hand')), [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Monastery: trash a card from your hand',
            }),
            announce(OWNER, ' trashes ', CHOICE, ' at the Monastery.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
          ], [announce(OWNER, ' has nothing in hand to trash.')]),
        ], [
          iff(eq(CHOICE, str('mon_copper')), [
            iff(gt(countCards(zone(INPLAY, OWNER), nameIs('Copper')), num(0)), [
              announce(OWNER, ' trashes a Copper from play at the Monastery.'),
              kit.tmove(
                specific(bestCard(zone(INPLAY, OWNER), 'highest', COST, nameIs('Copper'))),
                zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true },
              ),
            ], [announce(OWNER, ' has no Copper in play to trash.')]),
          ]),
        ]),
      ]),
    ]);

  // --- Night Watchman's put-back step (later picks land above earlier) -----
  const watchmanPutBack = (): Block =>
    iff(gt(zoneCount(zone(LOOK)), num(1)), [
      chooseCard({
        who: OWNER, from: zone(LOOK), revealed: true,
        prompt: 'Night Watchman: put a card back onto your deck (later picks land above it)',
      }),
      move(specific(CHOICE), zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
    ], [
      iff(eq(zoneCount(zone(LOOK)), num(1)), [
        move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
      ]),
    ]);

  /** Vampire's gain window: current cost ≤ $5, never a Vampire (fresh nodes). */
  const vampireRange = (): Expr => allOf(
    lte(field(CARD, COST), add(num(5), getVar(DISCOUNT))),
    neq(field(CARD, 'name'), str('Vampire')),
  );

  return [
    // CHANGELING — Night. Trashes itself first (printed timing), then the
    // copy choice offers the supply piles whose name matches anything in
    // In Play / parked DURATION (the mark pass — register). The on-gain
    // exchange is the module trigger pair.
    kit.cardDef(IDS.Changeling, 'Changeling', 3, 0, 0,
      'Trash this. Gain a copy of a card you have in play. In games using this, when you gain a card costing $3 or more, you may exchange it for a Changeling.', [
        kit.onPlay('dom_ab_changeling', 'A borrowed face', [
          announce(OWNER, "'s Changeling melts into the trash."),
          kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true }),
          ...markCopiesOf(OWNER, OWNER, () => zone(SUPPLY)),
          iff(gt(countCards(zone(SUPPLY), marked()), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY), filter: marked(),
              prompt: 'Changeling: gain a copy of a card you have in play',
              body: [
                announce(OWNER, ' gains ', CARD, ' — the Changeling takes its shape.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
              ],
            }),
          ], [announce('Nothing in play has a supply copy — the Changeling wastes away.')]),
        ]),
      ]),

    // COBBLER — Night – Duration: parks, then gains to hand next turn.
    kit.cardDef(IDS.Cobbler, 'Cobbler', 5, 0, 0,
      'At the start of your next turn, gain a card to your hand costing up to $4.',
      kit.durationPair('dom_ab_cobbler', 'Cobbler', [], [
        ...kit.gainFromSupply({
          limit: num(4), toHand: true,
          prompt: 'Cobbler: gain a card to your hand costing up to $4',
          whiff: [announce('Nothing in the supply fits the last — no shoes tonight.')],
        }),
      ])),

    // CRYPT — Night – Duration. Entombed Treasures wear the perCard mark and
    // wait face down in the DURATION zone; one comes home at each of the
    // owner's turn starts, and the emptied Crypt marches back (register:
    // multiple Crypts share one pool).
    kit.cardDef(IDS.Crypt, 'Crypt', 5, 0, 0,
      'Set aside any number of Treasures you have in play, face down (under this). While any remain, at the start of each of your turns, put one of them into your hand.', [
        kit.onPlay('dom_ab_crypt', 'Down into the dark', [
          iff(gt(countCards(zone(INPLAY, OWNER), kit.IS_TREASURE_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(INPLAY, OWNER), filter: kit.IS_TREASURE_CARD,
              min: num(0), max: num(99),
              prompt: 'Crypt: set aside any number of Treasures you have in play',
              body: [
                announce(OWNER, ' entombs ', CARD, '.'),
                setVar(CRYPT_MARK, num(1), CARD),
                move(specific(CARD), zone(INPLAY, OWNER), zone(DURATION, OWNER), { faceUp: false }),
              ],
            }),
          ]),
          iff(gt(countCards(zone(DURATION, OWNER), cryptMarked()), num(0)), [
            kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(DURATION, OWNER), 'play', { faceUp: true }),
          ], [announce('The Crypt holds nothing — it is left behind.')]),
        ]),
        {
          id: 'dom_ab_crypt_retrieve', name: 'Crypt — one from the vault',
          on: 'phaseStart', zoneId: DURATION, phaseId: PHASE_ACTION,
          condition: allOf(
            eq(CURRENT, OWNER),
            eq(getVar(HAVEN_ASIDE, SELF), num(0)),
            gt(countCards(zone(DURATION, OWNER), eq(getVar(CRYPT_MARK, CARD), num(1))), num(0)),
          ),
          script: [
            iff(eq(countCards(zone(DURATION, OWNER), cryptMarked()), num(1)), [
              forEachCard(zone(DURATION, OWNER), cryptMarked(), [
                setVar(CRYPT_MARK, num(0), CARD),
                announce(OWNER, ' takes ', CARD, ' back from the Crypt.'),
                move(specific(CARD), zone(DURATION, OWNER), zone(HAND, OWNER), { faceUp: true }),
              ]),
            ], [
              chooseCardsBlock({
                who: OWNER, from: zone(DURATION, OWNER), filter: cryptMarked(),
                min: num(1), max: num(1), revealed: true,
                prompt: 'Crypt: put one set-aside Treasure into your hand',
                body: [
                  setVar(CRYPT_MARK, num(0), CARD),
                  announce(OWNER, ' takes ', CARD, ' back from the Crypt.'),
                  move(specific(CARD), zone(DURATION, OWNER), zone(HAND, OWNER), { faceUp: true }),
                ],
              }),
            ]),
          ],
        },
        // Conditions re-check lazily per firing, so this runs the same turn
        // start the retrieval empties the pool (engine events snapshot the
        // pending pairs, then re-evaluate before each run).
        {
          id: 'dom_ab_crypt_empty', name: 'Crypt — nothing left below',
          on: 'phaseStart', zoneId: DURATION, phaseId: PHASE_ACTION,
          condition: allOf(
            eq(CURRENT, OWNER),
            eq(getVar(HAVEN_ASIDE, SELF), num(0)),
            eq(countCards(zone(DURATION, OWNER), eq(getVar(CRYPT_MARK, CARD), num(1))), num(0)),
          ),
          script: [
            announce(OWNER, "'s Crypt stands empty — it returns."),
            kit.tmove(specific(SELF), zone(DURATION, OWNER), zone(INPLAY, OWNER), 'duration_return', { faceUp: true }),
          ],
        },
      ]),

    // DEN OF SIN — Night – Duration; the gain-to-hand rider is a watcher.
    kit.cardDef(IDS['Den of Sin'], 'Den of Sin', 5, 0, 0,
      'At the start of your next turn, +2 Cards. This is gained to your hand (instead of to your discard pile).',
      kit.durationPair('dom_ab_den_of_sin', 'Den of Sin', [], [
        kit.draw(OWNER, 2),
      ])),

    // DEVIL'S WORKSHOP — Night. Branches on the gained-this-turn counter
    // (SNAPSHOTTED first — its own gain must not shift the branch).
    kit.cardDef(IDS["Devil's Workshop"], "Devil's Workshop", 4, 0, 0,
      "If the number of cards you've gained this turn is: 2+, gain an Imp; 1, gain a card costing up to $4; 0, gain a Gold.", [
        kit.onPlay('dom_ab_devils_workshop', 'Forge of the pit', [
          setVar(SCRATCH, getVar(NOCT_GAINED_VAR, OWNER), OWNER),
          iff(gte(getVar(SCRATCH, OWNER), num(2)), [
            iff(gt(countCards(zone(SPIRIT_ZONE), nameIs('Imp')), num(0)), [
              announce(OWNER, ' gains an Imp from the workshop.'),
              kit.tmove(
                specific(bestCard(zone(SPIRIT_ZONE), 'highest', COST, nameIs('Imp'))),
                zone(SPIRIT_ZONE), zone(DISCARD, OWNER), 'gain', { faceUp: true },
              ),
            ], [announce('The Imp stock is empty — the workshop produces nothing.')]),
          ], [
            iff(eq(getVar(SCRATCH, OWNER), num(1)), [
              ...kit.gainFromSupply({
                limit: num(4),
                prompt: "Devil's Workshop: gain a card costing up to $4",
                whiff: [announce('Nothing in the supply is cheap enough for the workshop.')],
              }),
            ], [
              gainNamed('Gold', OWNER, ' gains a Gold from the idle workshop.',
                'The Gold pile is empty — nothing gained.'),
            ]),
          ]),
        ]),
      ]),

    // EXORCIST — Night. Printed-cost ladder over the Spirit piles (register).
    kit.cardDef(IDS.Exorcist, 'Exorcist', 4, 0, 0,
      'Trash a card from your hand. Gain a cheaper Spirit from one of the Spirit piles.', [
        kit.onPlay('dom_ab_exorcist', 'Out, out', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Exorcist: trash a card from your hand',
            }),
            setVar(SCRATCH, field(CHOICE, COST), OWNER),
            announce(OWNER, ' exorcises ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            iff(gt(countCards(zone(SPIRIT_ZONE),
              lte(add(field(CARD, COST), num(1)), getVar(SCRATCH, OWNER))), num(0)), [
              kit.choosePileBlock({
                who: OWNER, from: zone(SPIRIT_ZONE), revealed: true,
                filter: lte(add(field(CARD, COST), num(1)), getVar(SCRATCH, OWNER)),
                prompt: 'Exorcist: gain a cheaper Spirit',
                body: [
                  announce(OWNER, ' calls up ', CARD, '.'),
                  kit.tmove(specific(CARD), zone(SPIRIT_ZONE), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                ],
              }),
            ], [announce('No Spirit is cheap enough to answer.')]),
          ], [announce(OWNER, ' has nothing to exorcise.')]),
        ]),
      ]),

    // GHOST TOWN — Night – Duration; gain-to-hand rider is a watcher.
    kit.cardDef(IDS['Ghost Town'], 'Ghost Town', 3, 0, 0,
      'At the start of your next turn, +1 Card and +1 Action. This is gained to your hand (instead of to your discard pile).',
      kit.durationPair('dom_ab_ghost_town', 'Ghost Town', [], [
        kit.draw(OWNER, 1),
        changeVar(ACTIONS, num(1), OWNER),
      ])),

    // GUARDIAN — Night – Duration. The wave-off is the module's response
    // action (Lighthouse's pattern — register); +$1 next turn; gained to hand.
    kit.cardDef(IDS.Guardian, 'Guardian', 2, 0, 0,
      "Until your next turn, when another player plays an Attack card, it doesn't affect you. At the start of your next turn, +$1. This is gained to your hand (instead of to your discard pile).",
      kit.durationPair('dom_ab_guardian', 'Guardian', [], [
        changeVar(COINS, num(1), OWNER),
      ])),

    // MONASTERY — Night. One optional trash per card gained this turn
    // (unrolled to 10 — register), each from hand OR a Copper in play.
    kit.cardDef(IDS.Monastery, 'Monastery', 2, 0, 0,
      "For each card you've gained this turn, you may trash a card from your hand or a Copper you have in play.", [
        kit.onPlay('dom_ab_monastery', 'Vows kept by moonlight', [
          ...Array.from({ length: 10 }, (_, i) => monasteryStep(i)),
        ]),
      ]),

    // NIGHT WATCHMAN — Night. Top 5 stage face down in LOOK; discard any;
    // the rest go back one at a time (register). Gained to hand (watcher).
    kit.cardDef(IDS['Night Watchman'], 'Night Watchman', 3, 0, 0,
      'Look at the top 5 cards of your deck, discard any of them, and put the rest back in any order. This is gained to your hand (instead of to your discard pile).', [
        kit.onPlay('dom_ab_night_watchman', 'The rounds at midnight', [
          ...takeTop(kit, OWNER, zone(LOOK), false),
          ...takeTop(kit, OWNER, zone(LOOK), false),
          ...takeTop(kit, OWNER, zone(LOOK), false),
          ...takeTop(kit, OWNER, zone(LOOK), false),
          ...takeTop(kit, OWNER, zone(LOOK), false),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(LOOK), min: num(0), max: num(5), revealed: true,
              prompt: 'Night Watchman: discard any of the top 5 cards',
              body: [
                announce(OWNER, ' discards ', CARD, '.'),
                kit.tmove(specific(CARD), zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ],
            }),
            watchmanPutBack(),
            watchmanPutBack(),
            watchmanPutBack(),
            watchmanPutBack(),
            watchmanPutBack(),
          ], [announce(OWNER, ' has no cards left to inspect.')]),
        ]),
      ]),

    // RAIDER — Night – Duration – Attack. The stacked half resolves after
    // the pair-now parks it, so the copy test spans In Play + DURATION
    // (register); +$3 at the next turn start.
    kit.cardDef(IDS.Raider, 'Raider', 6, 0, 0,
      "Each other player with 5 or more cards in hand discards a copy of a card you have in play (or reveals they can't). At the start of your next turn, +$3.", [
        kit.onPlay('dom_ab_raider_attack', 'Torches on the shore', [
          forEachOpponent([
            iff(allOf(
              eq(getVar(IMMUNE, PLAYER), num(0)),
              gte(zoneCount(zone(HAND, PLAYER)), num(5)),
            ), [
              ...markCopiesOf(OWNER, PLAYER, () => zone(HAND, PLAYER)),
              iff(gt(countCards(zone(HAND, PLAYER), marked()), num(0)), [
                chooseCard({
                  who: PLAYER, from: zone(HAND, PLAYER), filter: marked(),
                  prompt: 'Raider: discard a copy of a card the raider has in play',
                }),
                announce(PLAYER, ' discards ', CHOICE, ' to the Raider.'),
                kit.tmove(specific(CHOICE), zone(HAND, PLAYER), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
              ], [announce(PLAYER, ' reveals a hand with no copy of the raider’s cards.')]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
        ...kit.durationPair('dom_ab_raider', 'Raider', [], [
          changeVar(COINS, num(3), OWNER),
        ]),
      ]),

    // SECRET CAVE — printed Action – Duration; Night here (PROMINENT
    // deviation — register). Parks ONLY when the discard happened, so the
    // later +$3 fires exactly when printed.
    kit.cardDef(IDS['Secret Cave'], 'Secret Cave', 3, 0, 0,
      '+1 Card. +1 Action. You may discard 3 cards. If you did, then at the start of your next turn, +$3.', [
        kit.onPlay('dom_ab_secret_cave', 'A lamp in the dark', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          iff(gte(zoneCount(zone(HAND, OWNER)), num(3)), [
            yesNo(OWNER, 'Secret Cave: discard 3 cards for +$3 at the start of your next turn?'),
            iff(CHOICE, [
              chooseCardsBlock({
                who: OWNER, from: zone(HAND, OWNER), min: num(3), max: num(3),
                prompt: 'Secret Cave: discard 3 cards',
                body: [
                  announce(OWNER, ' discards ', CARD, '.'),
                  kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                ],
              }),
              announce(OWNER, "'s Secret Cave keeps its secret until next turn."),
              kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(DURATION, OWNER), 'play', { faceUp: true }),
            ]),
          ]),
        ]),
        {
          id: 'dom_ab_secret_cave_later', name: 'Secret Cave — the hoard',
          on: 'phaseStart', zoneId: DURATION, phaseId: PHASE_ACTION,
          condition: allOf(eq(CURRENT, OWNER), eq(getVar(HAVEN_ASIDE, SELF), num(0))),
          script: [
            announce(OWNER, "'s Secret Cave pays out: +$3."),
            changeVar(COINS, num(3), OWNER),
            kit.tmove(specific(SELF), zone(DURATION, OWNER), zone(INPLAY, OWNER), 'duration_return', { faceUp: true }),
          ],
        },
      ]),

    // VAMPIRE — Night – Attack (printed Doom). Hexes are the stacked half;
    // the gain and the Bat exchange are immediate (register: timing).
    kit.cardDef(IDS.Vampire, 'Vampire', 5, 0, 0,
      'Each other player receives the next Hex. Gain a card costing up to $5 other than a Vampire. Exchange this for a Bat.', [
        kit.onPlay('dom_ab_vampire_attack', 'The thirst', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              ...receiveHex(kit, PLAYER),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
        kit.onPlay('dom_ab_vampire_main', 'A guise for every door', [
          iff(gt(countCards(zone(SUPPLY), vampireRange()), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY), filter: vampireRange(),
              prompt: 'Vampire: gain a card costing up to $5 (not a Vampire)',
              body: [
                announce(OWNER, ' gains ', CARD, '.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
              ],
            }),
          ], [announce('Nothing suitable remains in the supply.')]),
          iff(gt(zoneCount(zone(BAT_ZONE)), num(0)), [
            announce(OWNER, "'s Vampire takes wing — exchanged for a Bat."),
            move(specific(SELF), zone(INPLAY, OWNER), zone(SUPPLY), { faceUp: true }),
            move(
              specific(bestCard(zone(BAT_ZONE), 'highest', COST, nameIs('Bat'))),
              zone(BAT_ZONE), zone(DISCARD, OWNER), { faceUp: true },
            ),
          ], [announce('The Bat roost is empty — the Vampire remains.')]),
        ]),
      ]),

    // WEREWOLF — printed Action – Attack – Night – Doom; Night-only here
    // (PROMINENT deviation — register: the "+3 Cards" day mode is dropped).
    kit.cardDef(IDS.Werewolf, 'Werewolf', 5, 0, 0,
      "If it's your Night phase, each other player receives the next Hex. Otherwise, +3 Cards.", [
        kit.onPlay('dom_ab_werewolf_attack', 'The moon is full', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              ...receiveHex(kit, PLAYER),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // ------------------------- Non-supply stock -----------------------------

    // WILL-O'-WISP + IMP — their card DEFS live in nocturneBoons (the boon
    // module's Swamp's Gift / Tormentor gain them too); THIS module owns the
    // spirit zone + stock spawns and gains them by name.

    // GHOST — printed Night – Duration – Spirit; Action-typed here
    // (register). Digs for an Action, parks with it, plays it twice next
    // turn (the mark-promote dance; Royal Carriage's left-play guard).
    kit.cardDef(IDS.Ghost, 'Ghost', 4, 0, 0,
      'Reveal cards from your deck until you reveal an Action. Discard the other cards and set aside the Action. At the start of your next turn, play it twice. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_ghost', 'Unfinished business', [
          setVar(SCRATCH, num(0), OWNER),
          {
            kind: 'repeatWhile',
            cond: eq(getVar(SCRATCH, OWNER), num(0)),
            body: [
              refillDeck(kit, OWNER),
              iff(eq(zoneCount(zone(DECK, OWNER)), num(0)), [
                announce(OWNER, ' runs out of cards — the Ghost finds no Action.'),
                setVar(SCRATCH, num(2), OWNER),
              ], [
                announce(OWNER, ' reveals ', topCard(zone(DECK, OWNER)), '.'),
                iff(kit.isA(topCard(zone(DECK, OWNER)), kit.types.ACTION), [
                  announce('The Ghost seizes it.'),
                  setVar(GHOST_MARK, num(1), topCard(zone(DECK, OWNER))),
                  move(topN(1), zone(DECK, OWNER), zone(DURATION, OWNER), { faceUp: true }),
                  setVar(SCRATCH, num(1), OWNER),
                ], [
                  move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: true }),
                ]),
              ]),
            ],
          } as Block,
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            kit.tmove(ALL, zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
          ]),
          iff(eq(getVar(SCRATCH, OWNER), num(1)), [
            kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(DURATION, OWNER), 'play', { faceUp: true }),
          ], [announce('With nothing to haunt, the Ghost drifts on.')]),
        ]),
        {
          id: 'dom_ab_ghost_later', name: 'Ghost — the haunting',
          on: 'phaseStart', zoneId: DURATION, phaseId: PHASE_ACTION,
          condition: allOf(
            eq(CURRENT, OWNER),
            eq(getVar(HAVEN_ASIDE, SELF), num(0)),
            gt(countCards(zone(DURATION, OWNER), eq(getVar(GHOST_MARK, CARD), num(1))), num(0)),
          ),
          script: [
            // Promote ONE prize's mark 1→2, so a second Ghost's pick and the
            // hygiene sweep can never touch another Ghost's set-aside.
            setVar(GHOST_MARK, num(2),
              bestCard(zone(DURATION, OWNER), 'highest', COST, ghostMarked())),
            announce(OWNER, "'s Ghost plays its captured Action twice."),
            kit.tmove(
              specific(bestCard(zone(DURATION, OWNER), 'highest', COST, ghostPlaying())),
              zone(DURATION, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true },
            ),
            iff(gt(countCards(zone(INPLAY, OWNER), ghostPlaying()), num(0)), [
              kit.playAgain(bestCard(zone(INPLAY, OWNER), 'highest', COST, ghostPlaying())),
            ], [announce('The Action slipped out of play — the second haunting fizzles.')]),
            forEachCard(zone(INPLAY, OWNER), ghostPlaying(), [setVar(GHOST_MARK, num(0), CARD)]),
            forEachCard(zone(DURATION, OWNER), ghostPlaying(), [setVar(GHOST_MARK, num(0), CARD)]),
            kit.tmove(specific(SELF), zone(DURATION, OWNER), zone(INPLAY, OWNER), 'duration_return', { faceUp: true }),
          ],
        },
      ]),

    // BAT — printed Night; Action-typed here (register). The exchange is
    // mandatory once something was trashed and the Vampire pile has copies.
    kit.cardDef(IDS.Bat, 'Bat', 2, 0, 0,
      'Trash up to 2 cards from your hand. If you trashed at least one, exchange this for a Vampire. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_bat', 'Wings in the rafters', [
          setVar(SCRATCH, num(0), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(2),
              prompt: 'Bat: trash up to 2 cards from your hand',
              body: [
                announce(OWNER, ' trashes ', CARD, '.'),
                changeVar(SCRATCH, num(1), OWNER),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              ],
            }),
          ]),
          iff(allOf(
            gt(getVar(SCRATCH, OWNER), num(0)),
            gt(countCards(zone(SUPPLY), nameIs('Vampire')), num(0)),
          ), [
            announce(OWNER, "'s Bat takes its true shape — exchanged for a Vampire."),
            move(specific(SELF), zone(INPLAY, OWNER), zone(BAT_ZONE), { faceUp: false }),
            move(
              specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Vampire'))),
              zone(SUPPLY), zone(DISCARD, OWNER), { faceUp: true },
            ),
          ]),
        ]),
      ]),

    // WISH — Action (printed; exact). Guarded on still being in play, so a
    // Throne-Roomed replay grants nothing extra (the Wish already flew).
    kit.cardDef(IDS.Wish, 'Wish', 0, 0, 0,
      '+1 Action. Return this to its pile. If you did, gain a card to your hand costing up to $6. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_wish', 'One wish, well spent', [
          changeVar(ACTIONS, num(1), OWNER),
          iff(eq(cardZoneId(SELF), str(INPLAY)), [
            announce(OWNER, "'s Wish returns to its pile."),
            move(specific(SELF), zone(INPLAY, OWNER), zone(WISH_ZONE), { faceUp: false }),
            ...kit.gainFromSupply({
              limit: num(6), toHand: true,
              prompt: 'Wish: gain a card to your hand costing up to $6',
              whiff: [announce('Nothing in the supply grants the wish.')],
            }),
          ], [announce('The Wish had already flown — nothing granted.')]),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, HAND, DISCARD } = kit.zones;
  const { COST } = kit.fields;
  const { CARD, CHOICE } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** The gained-this-turn counter (Goatherd's idiom — see the register). */
  const gainedWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_noct_gained_${tag}`,
    name: `Nocturne: a card is ${tag === 'buy' ? 'bought' : 'gained'} this turn`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [changeVar(NOCT_GAINED_VAR, num(1), CURRENT)],
  });

  /** Ghost Town / Den of Sin / Guardian / Night Watchman: gained to the hand
   *  (instead of the discard pile) — the move is UNTAGGED (the gain already
   *  happened; this only corrects where it landed). */
  const toHandWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_noct_tohand_${tag}`,
    name: `Nocturne: a night card is ${tag === 'buy' ? 'bought' : 'gained'} — straight to the hand`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: anyOf(
      kit.nameIs('Ghost Town'), kit.nameIs('Den of Sin'),
      kit.nameIs('Guardian'), kit.nameIs('Night Watchman'),
    ),
    script: [
      iff(eq(cardZoneId(CARD), str(DISCARD)), [
        announce(GAINER, "'s ", CARD, ' slips straight into their hand.'),
        move(specific(CARD), zone(DISCARD, GAINER), zone(HAND, GAINER), { faceUp: true }),
      ]),
    ],
  });

  /** CHANGELING's exchange (Trader's idiom — see the register): a gained
   *  card at current cost $3+, still in the discard, may swap for a
   *  Changeling while the pile is in the supply with copies. Both moves
   *  UNTAGGED — an exchange is neither a gain nor a discard (printed). */
  const changelingWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_noct_changeling_${tag}`,
    name: `Changeling: a card is ${tag === 'buy' ? 'bought' : 'gained'} — exchange it?`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        gt(countCards(zone(SUPPLY), kit.nameIs('Changeling')), num(0)),
        gte(field(CARD, COST), add(num(3), getVar(kit.vars.DISCOUNT))),
        neq(field(CARD, 'name'), str('Changeling')),
        eq(cardZoneId(CARD), str(DISCARD)),
      ), [
        yesNo(GAINER, 'Changeling: exchange the card you just gained for a Changeling?'),
        iff(CHOICE, [
          announce(GAINER, ' exchanges ', CARD, ' for a Changeling.'),
          move(specific(CARD), zone(DISCARD, GAINER), zone(SUPPLY), { faceUp: true }),
          move(
            specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Changeling'))),
            zone(SUPPLY), zone(DISCARD, GAINER), { faceUp: true },
          ),
        ]),
      ]),
    ],
  });

  return [
    // The counter resets at the CURRENT player's action-phase start (their
    // turn's tally begins anew) — registered before the watchers.
    {
      id: 'dom_trigger_noct_gained_reset',
      name: 'Nocturne: a new turn begins — the gained-this-turn count resets',
      event: { kind: 'phaseStart', phaseId: PHASE_ACTION },
      condition: null,
      script: [setVar(NOCT_GAINED_VAR, num(0), CURRENT)],
    },
    gainedWatch('gain'),
    gainedWatch('buy'),
    // The to-hand rider decides before the Changeling offer, so a card gained
    // to the hand keeps no exchange (register).
    toHandWatch('gain'),
    toHandWatch('buy'),
    changelingWatch('gain'),
    changelingWatch('buy'),
  ];
}

export const nocturneNight: ExpansionModule = {
  id: 'nocturneNight',
  setName: 'Nocturne',

  piles: [
    { name: 'Guardian', cost: 2, count: 10 },
    { name: 'Monastery', cost: 2, count: 10 },
    { name: 'Changeling', cost: 3, count: 10 },
    { name: 'Ghost Town', cost: 3, count: 10 },
    { name: 'Night Watchman', cost: 3, count: 10 },
    { name: 'Secret Cave', cost: 3, count: 10 },
    { name: "Devil's Workshop", cost: 4, count: 10 },
    { name: 'Exorcist', cost: 4, count: 10 },
    { name: 'Cobbler', cost: 5, count: 10 },
    { name: 'Crypt', cost: 5, count: 10 },
    { name: 'Den of Sin', cost: 5, count: 10 },
    { name: 'Vampire', cost: 5, count: 10 },
    { name: 'Werewolf', cost: 5, count: 10 },
    { name: 'Raider', cost: 6, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Raider', 'Vampire', 'Werewolf'],
  nightNames: [
    'Changeling', 'Cobbler', 'Crypt', 'Den of Sin', "Devil's Workshop",
    'Exorcist', 'Ghost Town', 'Guardian', 'Monastery', 'Night Watchman',
    'Raider', 'Secret Cave', 'Vampire', 'Werewolf',
  ],

  variables: [
    {
      id: NOCT_GAINED_VAR, name: 'Nocturne: cards gained this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: NOCT_NAME_VAR, name: 'Nocturne: name stash',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: NOCT_MARK_VAR, name: 'Nocturne: copy-test mark',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
    {
      id: CRYPT_MARK, name: 'Crypt: entombed',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
    {
      id: GHOST_MARK, name: 'Ghost: set aside',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  zones: [
    {
      id: SPIRIT_ZONE, name: 'Spirits',
      owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
    },
    {
      id: BAT_ZONE, name: 'Bats',
      owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
    },
    {
      id: WISH_ZONE, name: 'Wishes',
      owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
    },
  ] as ZoneDef[],

  nonSupply: [
    {
      zoneId: SPIRIT_ZONE,
      piles: [
        { name: "Will-o'-Wisp", cost: 0, count: 12 },
        { name: 'Imp', cost: 2, count: 13 },
        { name: 'Ghost', cost: 4, count: 6 },
      ],
    },
    {
      zoneId: BAT_ZONE,
      piles: [
        { name: 'Bat', cost: 2, count: 10 },
      ],
    },
    {
      zoneId: WISH_ZONE,
      piles: [
        { name: 'Wish', cost: 0, count: 12 },
      ],
    },
  ],

  buildCards,
  buildTriggers,

  buildActions(kit: CardKit): ActionDef[] {
    const { IMMUNE } = kit.vars;
    return [
      // Guardian's wave-off (see the register): Lighthouse's response shape —
      // legal while an Attack is pending, you are not the attacker, YOUR
      // Guardian sits in the DURATION zone and you are not already immune.
      {
        id: 'dom_action_guardian',
        name: 'Guardian: stand the watch',
        target: { kind: 'cardInZone', zoneId: kit.zones.DURATION, ownerOnly: true },
        speed: 'response',
        legality: allOf(
          kit.nameIs('Guardian'),
          gt(STACK_SIZE, num(0)),
          kit.hasTag(STACK_TOP, kit.tags.ATTACK),
          neq(bnd('$player'), CURRENT),
          eq(getVar(IMMUNE, bnd('$player')), num(0)),
        ),
        script: [
          setVar(IMMUNE, num(1)),
          announce(bnd('$player'), "'s Guardian stands watch — the attack does not affect them."),
        ],
      },
    ];
  },
};
