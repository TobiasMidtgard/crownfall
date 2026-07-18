/**
 * Nocturne (the rest) — THE HEIRLOOM HALF + REMAINDER: Cemetery, Conclave,
 * Faithful Hound, Leprechaun, Necromancer, Pooka, Shepherd, Tragic Hero,
 * plus ALL SEVEN HEIRLOOMS (Haunted Mirror, Lucky Coin, Goat, Cursed Gold,
 * Magic Lamp, Pasture, Pouch — this module owns the whole heirloom plumbing,
 * including the swaps for the sibling modules' kingdom cards) and the three
 * ZOMBIES (Zombie Apprentice / Mason / Spy), seeded into the trash at setup.
 * All printed texts verified against the Dominion Strategy card list, the
 * official preview articles and the KingdomCreator set data (the wiki proper
 * is bot-walled).
 *
 * CROSS-MODULE CONTRACT (this wave's three siblings):
 *  - Agent A (nocturneBoons) owns the Hex machinery. This module RECEIVES a
 *    Hex (Leprechaun) by replicating the agreed receive shape: draw 1 from
 *    dom_zone_hexes into the shared reveal zone dom_zone_fate (the draw
 *    block's refillFrom = dom_zone_hexes_used gives the used pile the
 *    boon-deck reshuffle), the move is tagged 'draw' so the Hex card's own
 *    enterZone(dom_zone_fate) ability fires, then everything in the fate
 *    zone moves to dom_zone_hexes_used. Reconcile the literals with A's
 *    module header when it lands; the whole receive is runtime-gated on the
 *    hex decks actually holding cards, so it whiffs politely (announced)
 *    while A is mid-flight. A also owns the Fool / Pixie / Tracker piles
 *    whose heirlooms (Lucky Coin / Goat / Pouch) live HERE — the swap gates
 *    on the pile being in the supply, so it stays dormant until A registers.
 *  - Agent B (nocturneNight) owns the Spirit/Wish stocks. This module
 *    references dom_zone_wishes (Leprechaun, Magic Lamp gain Wishes off its
 *    top) and dom_zone_ghosts (Haunted Mirror's on-trash Ghost) by those
 *    literals, gated on the stock being non-empty. B (or A) also owns the
 *    Secret Cave pile whose heirloom (Magic Lamp) lives here.
 *  - The merged def does NOT validate until A and B declare those zones —
 *    the test suite pushes zones-only stand-ins when nothing else declares
 *    them (the adventuresA test's stub precedent).
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - LEPRECHAUN'S TYPE (prominent): the wave brief slotted Leprechaun into
 *    nightNames, but the printed card is ACTION – DOOM (verified three ways:
 *    the Dominion Strategy card list, the official preview #4 article, and
 *    KingdomCreator's set data — isAction: true, isNight: false). It ships
 *    here as a plain Action played in the action phase, and this module
 *    ships NO Night cards (nightNames stays absent; the sibling
 *    nocturneNight module owns the Night phase's cards and probes).
 *  - SUBTYPES: Doom / Heirloom / Zombie / Spirit are display-only riders in
 *    the one-primary-type world — heirlooms are Treasure-typed
 *    (treasureNames), Pasture's Victory half is a buildVpTerms recount term
 *    (1 VP per Estate owned per Pasture; printed VP field 0). MODULE
 *    BOUNDARY: other modules' "is a Victory card" tests (Victory-typed or
 *    printed VP > 0) do NOT see Pasture; this module's own Shepherd
 *    special-cases it by name.
 *  - LEPRECHAUN: "receive a Hex" is SELF-inflicted (verified) — no Attack
 *    tag, no response window, IMMUNE is never consulted. "Exactly 7 cards
 *    in play" counts the owner's In Play zone PLUS their parked DURATION
 *    cards (printed Durations stay in play between turns — Walled Village's
 *    precedent), excluding Haven-marked set-asides (never played). The
 *    count runs at script time: reactions to the gained Gold (Sheepdog)
 *    resolve after the whole script on this table, so they cannot pump the
 *    count the way the printed timing allows. With exactly 7 in play and an
 *    empty Wish stock, nothing arrives (and no Hex either — printed).
 *  - NECROMANCER: "turning it face down for the turn" is a hidden perCard
 *    mark (dom_var_necro_played) — the filter excludes marked cards and
 *    every cleanup wipes the marks off the trash (buildCleanupResets), so
 *    each trash Action is playable once per turn, as printed. "Non-Duration"
 *    is a registry NAME list (no Duration tag exists — Duration-ness is
 *    behavioral, the Captain's precedent), which ALSO excludes cards whose
 *    unguarded self-moves would displace the trash copy (Island, Horse, the
 *    Adventures Reserves, Champion/Teacher, Village Green — the specific
 *    selector's `from` is advisory). Guarded self-trashers (Experiment) and
 *    trash-again one-shots (Mining Village, Embargo) stay playable: their
 *    self-trash resolves trash→trash, i.e. the card stays put, matching the
 *    official "it's already in the trash" rulings. Sibling-module Durations
 *    (Secret Cave, the Night-Durations) are excluded by name/type.
 *  - FAITHFUL HOUND: the set-aside waits in the owner's DURATION zone under
 *    a perCard mark (dom_var_hound_aside) and returns via a turnEnd ability
 *    — i.e. AFTER the cleanup redraw, so the owner starts the next turn
 *    with 6 cards (the printed outcome). The reaction watches the 'discard'
 *    cause only (the cleanup sweep is tagged 'cleanup', so "other than
 *    during Clean-up" is structural; discardTo — Militia — tags 'discard'
 *    and is covered).
 *  - HAUNTED MIRROR: the trash watcher attributes the trash to the CURRENT
 *    player (the shared trash has no owner binding — Goatherd's precedent),
 *    so an off-turn trash offers the mirror's Ghost to the turn player. The
 *    offer only appears while an Action is in hand AND the Ghost stock has
 *    cards (discarding for nothing is never offered).
 *  - CONCLAVE: per-candidate "no copy of it in play" filters cannot nest
 *    (one $card binding), so the pick is any hand Action and the check runs
 *    after (name stash + countCards over In Play AND parked DURATION cards,
 *    Haven-marked excluded); a pick with a copy already in play whiffs with
 *    an announce and the card stays in hand.
 *  - MAGIC LAMP: "at least 6 cards you have exactly 1 copy of in play"
 *    counts singleton NAMES across In Play + unmarked DURATION (each card
 *    that is the only copy of its name counts itself exactly once).
 *  - HEIRLOOM SWAP (buildSetup): for each heirloom whose kingdom pile IS IN
 *    THE SUPPLY after promotion, every player's swapped starter Copper goes
 *    to the hidden RESERVE (not back onto the Copper pile) and the heirloom
 *    shuffles into their deck. 2-player stock: 2 copies per heirloom.
 *  - ZOMBIES: spawned into a hidden stock zone and moved to the trash by
 *    buildSetup ONLY when Necromancer's pile is in the supply (the printed
 *    setup) — plain kingdoms never see Zombies in the trash (a Lurker there
 *    could otherwise fish them out). The seeding moves are untagged (setup
 *    is not a trash event).
 *  - TRAGIC HERO: a Throne-Roomed second resolution finds the card already
 *    in the trash — the self-trash whiffs in place and the Treasure is
 *    still gained (the official ruling).
 */
import type {
  Block, CardDef, Expr, TriggerDef, VariableDef, ZoneDef,
} from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, anyOf, bestCard, bnd, cardZoneId, changeVar, chooseCard,
  chooseCardsBlock, countCards, eq, field, forEachCard, forEachPlayer, getVar, gt, gte, iff, lte,
  move, mul, neq, num, setVar, shuffle, specific, str, topN, zone, zoneCount,
} from '../../examples/dsl';
import { HAVEN_MARK } from './seaside2eA';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  // Kingdom piles.
  Cemetery: 'dom_card_cemetery',
  Conclave: 'dom_card_conclave',
  'Faithful Hound': 'dom_card_faithful_hound',
  Leprechaun: 'dom_card_leprechaun',
  Necromancer: 'dom_card_necromancer',
  Pooka: 'dom_card_pooka',
  Shepherd: 'dom_card_shepherd',
  'Tragic Hero': 'dom_card_tragic_hero',
  // Heirlooms (non-supply, one per player at game start).
  'Haunted Mirror': 'dom_card_haunted_mirror',
  'Lucky Coin': 'dom_card_lucky_coin',
  Goat: 'dom_card_goat',
  'Cursed Gold': 'dom_card_cursed_gold',
  'Magic Lamp': 'dom_card_magic_lamp',
  Pasture: 'dom_card_pasture',
  Pouch: 'dom_card_pouch',
  // Zombies (non-supply, seeded into the trash with Necromancer).
  'Zombie Apprentice': 'dom_card_zombie_apprentice',
  'Zombie Mason': 'dom_card_zombie_mason',
  'Zombie Spy': 'dom_card_zombie_spy',
};

/** The hidden heirloom stock (2 copies each — strictly two seats). */
export const HEIRLOOM_ZONE = 'dom_zone_heirlooms';
/** The hidden Zombie stock; buildSetup moves it to the trash with Necromancer. */
export const ZOMBIE_ZONE = 'dom_zone_zombies';

/**
 * AGENT A's Hex machinery (nocturneBoons) — referenced by literal id only
 * (see the contract note in the header). The merged def needs A registered.
 */
export const HEX_ZONE = 'dom_zone_hexes';
export const HEX_USED_ZONE = 'dom_zone_hexes_used';
export const FATE_ZONE = 'dom_zone_fate';
/** AGENT B's stocks (nocturneNight) — referenced by literal id only.
 *  Ghosts live INSIDE B's shared spirit stock (integration reconciliation:
 *  B declared dom_zone_spirits holding Wisp/Imp/Ghost, not a ghost zone). */
export const WISH_ZONE = 'dom_zone_wishes';
export const GHOST_ZONE = 'dom_zone_spirits';

/** Name stash (Conclave's no-copy check, Magic Lamp's singleton count). */
export const NOC_NAME_VAR = 'dom_var_noc_name';
/** Counter (Magic Lamp's singleton total). */
export const NOC_COUNT_VAR = 'dom_var_noc_count';
/** Necromancer's "face down for the turn" mark (perCard; cleanup wipes it). */
export const NECRO_MARK = 'dom_var_necro_played';
/** Faithful Hound's set-aside mark (perCard; cleared on the turnEnd return). */
export const HOUND_MARK = 'dom_var_hound_aside';

/** The seven heirloom pairings (kingdom pile → heirloom), verified. Fool /
 *  Pixie / Tracker belong to agent A, Secret Cave to the sibling modules —
 *  the swap gates on the pile being in the supply, so foreign pairs stay
 *  dormant until their module registers AND the kingdom includes the pile. */
const HEIRLOOM_PAIRS: { pile: string; heirloom: string }[] = [
  { pile: 'Cemetery', heirloom: 'Haunted Mirror' },
  { pile: 'Fool', heirloom: 'Lucky Coin' },
  { pile: 'Pixie', heirloom: 'Goat' },
  { pile: 'Pooka', heirloom: 'Cursed Gold' },
  { pile: 'Secret Cave', heirloom: 'Magic Lamp' },
  { pile: 'Shepherd', heirloom: 'Pasture' },
  { pile: 'Tracker', heirloom: 'Pouch' },
];

/**
 * Names Necromancer must never play (see the register): the registry's
 * Duration cards plus unguarded self-movers whose advisory-`from` moves
 * would displace the trash copy. Treasure/Victory/Night-typed entries are
 * already excluded by the Action-type filter; ambiguous ones are listed
 * anyway for clarity.
 */
export const NECROMANCER_EXCLUDED: string[] = [
  // Seaside 2E Durations (A: Astrolabe is Treasure-typed; listed piecemeal).
  'Haven', 'Lighthouse', 'Fishing Village', 'Caravan', 'Merchant Ship', 'Wharf',
  'Monkey', 'Blockade', 'Corsair', 'Pirate', 'Sea Witch',
  'Sailor', 'Tide Pools', 'Tactician',
  // Seaside's self-parking Island.
  'Island',
  // Promos.
  'Church', 'Captain',
  // Adventures part B Durations.
  'Amulet', 'Caravan Guard', 'Dungeon', 'Gear', 'Bridge Troll',
  'Haunted Woods', 'Swamp Hag', 'Hireling',
  // Menagerie Durations + the self-returning Horse.
  'Village Green', 'Barge', 'Gatekeeper', 'Mastermind', 'Horse',
  // Renaissance Durations.
  'Cargo Ship', 'Research',
  // Adventures part A: unguarded self-parkers (Reserves + the permanents).
  'Ratcatcher', 'Guide', 'Duplicate', 'Royal Carriage', 'Transmogrify',
  'Wine Merchant', 'Teacher', 'Champion',
  // Nocturne siblings: the Action–Duration cave (Night cards are Night-typed).
  'Secret Cave',
];

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

/**
 * RECEIVE A HEX (the wave contract's agreed shape — see the header): the
 * draw block moves the top Hex into the shared fate zone tagged 'draw'
 * (firing the Hex card's own enterZone ability, agent A's surface),
 * reshuffling the used pile back in when the deck runs dry; afterwards the
 * fate zone empties into the used pile. Runtime-gated so a table without
 * A's Hexes whiffs politely.
 */
function receiveHex(kit: CardKit, who: Expr): Block[] {
  return [
    iff(gt(add(zoneCount(zone(HEX_ZONE)), zoneCount(zone(HEX_USED_ZONE))), num(0)), [
      announce(who, ' receives a Hex.'),
      {
        kind: 'draw', who: null, count: num(1),
        from: zone(HEX_ZONE), refillFrom: zone(HEX_USED_ZONE), to: zone(FATE_ZONE),
        faceUp: true,
      },
      forEachCard(zone(FATE_ZONE), null, [
        announce(who, ' suffers ', kit.CARD, '.'),
      ]),
      move(ALL, zone(FATE_ZONE), zone(HEX_USED_ZONE), { faceUp: true }),
    ], [announce('No Hexes on this table — the spite fizzles.')]),
  ];
}

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK, DURATION } = kit.zones;
  const { ACTIONS, BUYS, COINS, SCRATCH, DISCOUNT } = kit.vars;
  const { COST, VP_F } = kit.fields;
  const { OWNER, CARD, CHOICE, SELF } = kit;
  const { nameIs } = kit;

  /** Gain the named basic from the supply into `to` (guarded on the pile). */
  const gainNamed = (name: string, to: ReturnType<typeof zone>, who: Expr, note: string, empty: string): Block =>
    iff(gt(countCards(zone(SUPPLY), nameIs(name)), num(0)), [
      announce(who, note),
      kit.tmove(
        specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs(name))),
        zone(SUPPLY), to, 'gain', { faceUp: true },
      ),
    ], [announce(empty)]);

  /** "This DURATION candidate was not Haven-set-aside" (fresh nodes). */
  const havenFree = (): Expr => eq(getVar(HAVEN_MARK, CARD), num(0));

  /** The owner's cards in play: In Play + parked Durations (register). */
  const inPlayCount = (): Expr => add(
    zoneCount(zone(INPLAY, OWNER)),
    countCards(zone(DURATION, OWNER), havenFree()),
  );

  /** Copies of the stashed name the owner has in play (register: In Play +
   *  unmarked DURATION — fresh nodes per call). */
  const stashedInPlay = (): Expr => add(
    countCards(zone(INPLAY, OWNER), eq(field(CARD, 'name'), getVar(NOC_NAME_VAR, OWNER))),
    countCards(zone(DURATION, OWNER), allOf(
      eq(field(CARD, 'name'), getVar(NOC_NAME_VAR, OWNER)), havenFree(),
    )),
  );

  /** Shepherd's "Victory card": the dual test + Pasture by name (register). */
  const shepherdVictory = (): Expr => anyOf(
    kit.isA(CARD, kit.types.VICTORY),
    gt(field(CARD, VP_F), num(0)),
    nameIs('Pasture'),
  );

  /** Necromancer's target filter (fresh nodes per call). */
  const necroFilter = (): Expr => allOf(
    kit.IS_ACTION_CARD,
    eq(getVar(NECRO_MARK, CARD), num(0)),
    ...NECROMANCER_EXCLUDED.map((n) => neq(field(CARD, 'name'), str(n))),
  );

  /** Magic Lamp's singleton census over one zone (stash + combined count). */
  const lampCensus = (over: ReturnType<typeof zone>, filter: Expr | null): Block =>
    forEachCard(over, filter, [
      setVar(NOC_NAME_VAR, field(CARD, 'name'), OWNER),
      iff(eq(stashedInPlay(), num(1)), [
        changeVar(NOC_COUNT_VAR, num(1), OWNER),
      ]),
    ]);

  return [
    // ---------------------------------------------------------------- Cemetery
    // CEMETERY — Victory, 2 VP. The on-gain trash is the buildTriggers
    // watcher pair ('gain' + 'buy' — a bought card is gained).
    kit.cardDef(IDS.Cemetery, 'Cemetery', 4, 0, 2,
      'Worth 2 VP. When you gain this, trash up to 4 cards from your hand.'),

    // ---------------------------------------------------------------- Conclave
    // CONCLAVE — the no-copy check runs AFTER the pick (register): the stash
    // holds the picked name, the count spans In Play + parked Durations.
    kit.cardDef(IDS.Conclave, 'Conclave', 4, 0, 0,
      "+$2. You may play an Action card from your hand that you don't have a copy of in play. If you do, +1 Action.", [
        kit.onPlay('dom_ab_conclave', 'The hooded circle convenes', [
          changeVar(COINS, num(2), OWNER),
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_ACTION_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_ACTION_CARD,
              min: num(0), max: num(1),
              prompt: 'Conclave: you may play an Action you have no copy of in play',
              body: [
                setVar(NOC_NAME_VAR, field(CARD, 'name'), OWNER),
                iff(eq(stashedInPlay(), num(0)), [
                  announce(OWNER, ' plays ', CARD, ' with the Conclave.'),
                  kit.tmove(specific(CARD), zone(HAND, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
                  changeVar(ACTIONS, num(1), OWNER),
                ], [
                  announce(OWNER, ' already has a copy in play — the Conclave stays silent.'),
                ]),
              ],
            }),
          ], [announce(OWNER, ' has no Action for the Conclave.')]),
        ]),
      ]),

    // ---------------------------------------------------------- Faithful Hound
    // FAITHFUL HOUND — Action – Reaction. The draw is exact; the discard
    // reaction is the buildTriggers watcher ('discard' cause only), the
    // return is the turnEnd ability below (register).
    kit.cardDef(IDS['Faithful Hound'], 'Faithful Hound', 2, 0, 0,
      '+2 Cards. When you discard this other than during Clean-up, you may set it aside, and put it into your hand at end of turn.', [
        kit.onPlay('dom_ab_faithful_hound', 'A good dog', [
          kit.draw(OWNER, 2),
        ]),
        {
          id: 'dom_ab_faithful_hound_return', name: 'Faithful Hound — home at end of turn',
          on: 'turnEnd', zoneId: DURATION, phaseId: null,
          condition: eq(getVar(HOUND_MARK, SELF), num(1)),
          script: [
            setVar(HOUND_MARK, num(0), SELF),
            announce(OWNER, "'s Faithful Hound bounds back to their hand."),
            move(specific(SELF), zone(DURATION, OWNER), zone(HAND, OWNER), { faceUp: true }),
          ],
        },
      ]),

    // -------------------------------------------------------------- Leprechaun
    // LEPRECHAUN — Action – Doom (VERIFIED — see the register: NOT a Night
    // card). The Hex is self-inflicted: no Attack tag, no window.
    kit.cardDef(IDS.Leprechaun, 'Leprechaun', 3, 0, 0,
      'Gain a Gold. If you have exactly 7 cards in play, gain a Wish from its pile. Otherwise, receive a Hex.', [
        kit.onPlay('dom_ab_leprechaun', 'A pot of gold, a price', [
          gainNamed('Gold', zone(DISCARD, OWNER), OWNER, ' gains a Gold.',
            'The Gold pile is empty — the Leprechaun shrugs.'),
          iff(eq(inPlayCount(), num(7)), [
            iff(gt(zoneCount(zone(WISH_ZONE)), num(0)), [
              announce(OWNER, ' has exactly 7 cards in play — a Wish is granted!'),
              kit.tmove(topN(1), zone(WISH_ZONE), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
            ], [announce('Exactly 7 in play, but the Wish stock is empty — nothing arrives (and no Hex).')]),
          ], [
            ...receiveHex(kit, OWNER),
          ]),
        ]),
      ]),

    // ------------------------------------------------------------- Necromancer
    // NECROMANCER — plays a trash Action in place via kit.playAgain (the
    // Captain's idiom); "face down for the turn" is the perCard mark and
    // "non-Duration" the name list (register).
    kit.cardDef(IDS.Necromancer, 'Necromancer', 4, 0, 0,
      'Play a face-up, non-Duration Action card from the trash, turning it face down for the turn, leaving it there.', [
        kit.onPlay('dom_ab_necromancer', 'Raise the fallen', [
          iff(gt(countCards(zone(TRASH), necroFilter()), num(0)), [
            chooseCard({
              who: OWNER, from: zone(TRASH), filter: necroFilter(), revealed: true,
              prompt: 'Necromancer: play a non-Duration Action from the trash (it stays there)',
            }),
            setVar(NECRO_MARK, num(1), CHOICE),
            announce(OWNER, ' raises ', CHOICE, ' from the trash — face down for the turn.'),
            kit.playAgain(CHOICE),
          ], [announce('Nothing face-up in the trash answers the call.')]),
        ]),
      ]),

    // ------------------------------------------------------------------- Pooka
    // POOKA — the optional trash pays +4 Cards; Cursed Gold is never offered.
    kit.cardDef(IDS.Pooka, 'Pooka', 5, 0, 0,
      'You may trash a Treasure other than Cursed Gold from your hand, for +4 Cards.', [
        kit.onPlay('dom_ab_pooka', 'A shape in the dark', [
          iff(gt(countCards(zone(HAND, OWNER), allOf(
            kit.IS_TREASURE_CARD, neq(field(CARD, 'name'), str('Cursed Gold')),
          )), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER),
              filter: allOf(kit.IS_TREASURE_CARD, neq(field(CARD, 'name'), str('Cursed Gold'))),
              min: num(0), max: num(1),
              prompt: 'Pooka: you may trash a Treasure (not Cursed Gold) for +4 Cards',
              body: [
                announce(OWNER, ' feeds ', CARD, ' to the Pooka.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
                kit.draw(OWNER, 4),
              ],
            }),
          ], [announce(OWNER, ' has no Treasure the Pooka will take.')]),
        ]),
      ]),

    // ---------------------------------------------------------------- Shepherd
    // SHEPHERD — reveal-discard any number of Victory cards for +2 Cards
    // each (Pasture qualifies by name — register).
    kit.cardDef(IDS.Shepherd, 'Shepherd', 4, 0, 0,
      '+1 Action. Discard any number of Victory cards, revealed. +2 Cards per card discarded.', [
        kit.onPlay('dom_ab_shepherd', 'The flock at dusk', [
          changeVar(ACTIONS, num(1), OWNER),
          setVar(SCRATCH, num(0), OWNER),
          iff(gt(countCards(zone(HAND, OWNER), shepherdVictory()), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: shepherdVictory(),
              min: num(0), max: num(99), revealed: true,
              prompt: 'Shepherd: discard any number of Victory cards, revealed — +2 Cards each',
              body: [
                announce(OWNER, ' reveals and discards ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                changeVar(SCRATCH, num(1), OWNER),
              ],
            }),
          ]),
          kit.drawN(OWNER, mul(getVar(SCRATCH, OWNER), num(2))),
        ]),
      ]),

    // ------------------------------------------------------------- Tragic Hero
    // TRAGIC HERO — the 8-card check reads the hand AFTER the draw; a
    // Throne-Roomed replay's self-trash whiffs in place (register).
    kit.cardDef(IDS['Tragic Hero'], 'Tragic Hero', 5, 0, 0,
      '+3 Cards. +1 Buy. If you have 8 or more cards in hand (after drawing), trash this and gain a Treasure.', [
        kit.onPlay('dom_ab_tragic_hero', 'Glory, then the fall', [
          kit.draw(OWNER, 3),
          changeVar(BUYS, num(1), OWNER),
          iff(gte(zoneCount(zone(HAND, OWNER)), num(8)), [
            announce(OWNER, "'s Tragic Hero falls — trashed, leaving a Treasure."),
            kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            ...kit.gainFromSupply({
              treasureOnly: true, limit: num(99),
              prompt: 'Tragic Hero: gain a Treasure',
              whiff: [announce('No Treasure remains to inherit.')],
            }),
          ]),
        ]),
      ]),

    // ============================================================ Heirlooms ==
    // HAUNTED MIRROR — Treasure – Heirloom (Cemetery). The $1 rides the coin
    // FIELD; the on-trash Ghost offer is the buildTriggers watcher.
    kit.cardDef(IDS['Haunted Mirror'], 'Haunted Mirror', 0, 1, 0,
      '$1. When you trash this, you may discard an Action card, to gain a Ghost from its pile.'),

    // LUCKY COIN — Treasure – Heirloom (Fool — agent A's pile).
    kit.cardDef(IDS['Lucky Coin'], 'Lucky Coin', 4, 1, 0,
      '$1. When you play this, gain a Silver.', [
        kit.onPlay('dom_ab_lucky_coin', 'Heads again', [
          gainNamed('Silver', zone(DISCARD, OWNER), OWNER, ' gains a Silver.',
            'The Silver pile is empty — no luck today.'),
        ]),
      ]),

    // GOAT — Treasure – Heirloom (Pixie — agent A's pile).
    kit.cardDef(IDS.Goat, 'Goat', 2, 1, 0,
      '$1. When you play this, you may trash a card from your hand.', [
        kit.onPlay('dom_ab_goat', 'It eats anything', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(1),
              prompt: 'Goat: you may trash a card from your hand',
              body: [
                announce(OWNER, "'s Goat devours ", CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              ],
            }),
          ]),
        ]),
      ]),

    // CURSED GOLD — Treasure – Heirloom (Pooka). $3 on the coin field; the
    // Curse is mandatory (guarded on the pile).
    kit.cardDef(IDS['Cursed Gold'], 'Cursed Gold', 4, 3, 0,
      '$3. When you play this, gain a Curse.', [
        kit.onPlay('dom_ab_cursed_gold', 'It always costs more', [
          gainNamed('Curse', zone(DISCARD, OWNER), OWNER, ' gains a Curse — the gold exacts its price.',
            'The Curse pile is empty — the gold stays quiet.'),
        ]),
      ]),

    // MAGIC LAMP — Treasure – Heirloom (Secret Cave — a sibling's pile). The
    // singleton census spans In Play + unmarked DURATION (register); the
    // three Wish gains are unrolled and individually guarded.
    kit.cardDef(IDS['Magic Lamp'], 'Magic Lamp', 0, 1, 0,
      '$1. When you play this, if there are at least 6 cards that you have exactly 1 copy of in play, trash this. If you do, gain 3 Wishes from their pile.', [
        kit.onPlay('dom_ab_magic_lamp', 'Rub gently', [
          setVar(NOC_COUNT_VAR, num(0), OWNER),
          lampCensus(zone(INPLAY, OWNER), null),
          lampCensus(zone(DURATION, OWNER), havenFree()),
          iff(gte(getVar(NOC_COUNT_VAR, OWNER), num(6)), [
            announce(OWNER, "'s Magic Lamp glows — six lone cards in play! It is spent."),
            kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            ...Array.from({ length: 3 }, () => iff(gt(zoneCount(zone(WISH_ZONE)), num(0)), [
              announce(OWNER, ' gains a Wish.'),
              kit.tmove(topN(1), zone(WISH_ZONE), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
            ], [announce('The Wish stock is empty — a wish unfulfilled.')])),
          ]),
        ]),
      ]),

    // PASTURE — Treasure – Victory – Heirloom (Shepherd). Primary Treasure;
    // the Victory half is the buildVpTerms recount term (printed VP 0 here).
    kit.cardDef(IDS.Pasture, 'Pasture', 2, 1, 0,
      '$1. Worth 1 VP per Estate you have.'),

    // POUCH — Treasure – Heirloom (Tracker — agent A's pile).
    kit.cardDef(IDS.Pouch, 'Pouch', 2, 1, 0,
      '$1. +1 Buy.', [
        kit.onPlay('dom_ab_pouch', 'Room for one more coin', [
          changeVar(BUYS, num(1), OWNER),
        ]),
      ]),

    // ============================================================== Zombies ==
    // Played from the trash by Necromancer; $owner resolves to the current
    // player (the trash is shared — the Captain's supply-play precedent).
    kit.cardDef(IDS['Zombie Apprentice'], 'Zombie Apprentice', 3, 0, 0,
      'You may trash an Action card from your hand, for +3 Cards and +1 Action. (This starts the game in the trash.)', [
        kit.onPlay('dom_ab_zombie_apprentice', 'Still taking notes', [
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_ACTION_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_ACTION_CARD,
              min: num(0), max: num(1),
              prompt: 'Zombie Apprentice: you may trash an Action for +3 Cards and +1 Action',
              body: [
                announce(OWNER, ' trashes ', CARD, ' for the apprentice.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
                kit.draw(OWNER, 3),
                changeVar(ACTIONS, num(1), OWNER),
              ],
            }),
          ], [announce(OWNER, ' has no Action to teach the apprentice.')]),
        ]),
      ]),

    // ZOMBIE MASON — the mandatory deck-top trash stages through LOOK (the
    // cost + 1 cap is Bridge-aware, Dismantle's precedent); the gain is
    // optional (printed "you may").
    kit.cardDef(IDS['Zombie Mason'], 'Zombie Mason', 3, 0, 0,
      'Trash the top card of your deck. You may gain a card costing up to $1 more than it. (This starts the game in the trash.)', [
        kit.onPlay('dom_ab_zombie_mason', 'Bricks for the boneyard', [
          refillDeck(kit, OWNER),
          iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
            move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: true }),
            forEachCard(zone(LOOK), null, [
              setVar(SCRATCH, add(field(CARD, COST), num(1)), OWNER),
              announce(OWNER, "'s Zombie Mason trashes ", CARD, ' off the deck.'),
              kit.tmove(specific(CARD), zone(LOOK), zone(TRASH), 'trash', { faceUp: true }),
            ]),
            iff(gt(countCards(zone(SUPPLY),
              lte(field(CARD, COST), add(getVar(SCRATCH, OWNER), getVar(DISCOUNT)))), num(0)), [
              kit.choosePileBlock({
                who: OWNER, from: zone(SUPPLY),
                filter: lte(field(CARD, COST), add(getVar(SCRATCH, OWNER), getVar(DISCOUNT))),
                optional: true,
                prompt: 'Zombie Mason: gain a card costing up to $1 more than the trashed card?',
                body: [
                  announce(OWNER, ' gains ', CARD, '.'),
                  kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                ],
              }),
            ], [announce('Nothing in the supply fits the mason’s budget.')]),
          ], [announce(OWNER, ' has no deck for the mason to quarry.')]),
        ]),
      ]),

    // ZOMBIE SPY — the look is private (LOOK stays face down); picking the
    // revealed card discards it, declining puts it back on top.
    kit.cardDef(IDS['Zombie Spy'], 'Zombie Spy', 3, 0, 0,
      '+1 Card. +1 Action. Look at the top card of your deck. Discard it or put it back. (This starts the game in the trash.)', [
        kit.onPlay('dom_ab_zombie_spy', 'It never blinks', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          refillDeck(kit, OWNER),
          iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
            move(topN(1), zone(DECK, OWNER), zone(LOOK), { faceUp: false }),
            chooseCardsBlock({
              who: OWNER, from: zone(LOOK), min: num(0), max: num(1), revealed: true,
              prompt: 'Zombie Spy: discard the top card of your deck? (Leave it unpicked to put it back.)',
              body: [
                announce(OWNER, ' discards the top card of their deck.'),
                kit.tmove(specific(CARD), zone(LOOK), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ],
            }),
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
            ]),
          ]),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { TRASH, HAND, DISCARD, DURATION } = kit.zones;
  const { CARD, CHOICE } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer
   *  (per-player destinations only; the shared trash binds nothing). */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** CEMETERY gained/bought: trash up to 4 from the gainer's hand. */
  const cemeteryWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_noc_cemetery_${tag}`,
    name: `Cemetery: ${tag === 'buy' ? 'bought' : 'gained'} — trash up to 4?`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Cemetery'),
    script: [
      iff(gt(zoneCount(zone(HAND, GAINER)), num(0)), [
        chooseCardsBlock({
          who: GAINER, from: zone(HAND, GAINER), min: num(0), max: num(4),
          prompt: 'Cemetery: trash up to 4 cards from your hand',
          body: [
            announce(GAINER, ' buries ', CARD, '.'),
            kit.tmove(specific(CARD), zone(HAND, GAINER), zone(TRASH), 'trash', { faceUp: true }),
          ],
        }),
      ]),
    ],
  });

  return [
    cemeteryWatch('gain'),
    cemeteryWatch('buy'),

    // FAITHFUL HOUND discarded outside cleanup ('discard' cause only — the
    // sweep is tagged 'cleanup'): offer the set-aside. The guard skips
    // copies that went somewhere other than a discard pile (Tunnel's idiom);
    // the turnEnd return is the ability on the card itself.
    {
      id: 'dom_trigger_noc_hound_discard',
      name: 'Faithful Hound: discarded — set it aside?',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'discard' },
      condition: kit.nameIs('Faithful Hound'),
      script: [
        iff(eq(cardZoneId(CARD), str(DISCARD)), [
          yesNo(GAINER, 'Faithful Hound: set it aside, to return to your hand at end of turn?'),
          iff(CHOICE, [
            announce(GAINER, ' sets the Faithful Hound aside until end of turn.'),
            setVar(HOUND_MARK, num(1), CARD),
            move(specific(CARD), zone(DISCARD, GAINER), zone(DURATION, GAINER), { faceUp: true }),
          ]),
        ]),
      ],
    },

    // HAUNTED MIRROR trashed: discard an Action to gain a Ghost. The shared
    // trash has no owner binding, so the offer goes to the CURRENT player
    // (Goatherd's precedent — register); gated on the Ghost stock so a
    // pointless discard is never offered.
    {
      id: 'dom_trigger_noc_mirror_trash',
      name: 'Haunted Mirror: trashed — a Ghost stirs',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'trash' },
      condition: kit.nameIs('Haunted Mirror'),
      script: [
        iff(allOf(
          eq(cardZoneId(CARD), str(TRASH)),
          gt(countCards(zone(HAND, CURRENT), kit.IS_ACTION_CARD), num(0)),
          // The shared spirit stock also holds Wisps and Imps — count and
          // gain GHOSTS by name (integration reconciliation).
          gt(countCards(zone(GHOST_ZONE), kit.nameIs('Ghost')), num(0)),
        ), [
          chooseCardsBlock({
            who: CURRENT, from: zone(HAND, CURRENT), filter: kit.IS_ACTION_CARD,
            min: num(0), max: num(1),
            prompt: 'Haunted Mirror: discard an Action card to gain a Ghost?',
            body: [
              announce(CURRENT, ' discards ', CARD, ' to the shattered mirror.'),
              kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(DISCARD, CURRENT), 'discard', { faceUp: true }),
              announce(CURRENT, ' gains a Ghost.'),
              kit.tmove(
                specific(bestCard(zone(GHOST_ZONE), 'highest', kit.fields.COST, kit.nameIs('Ghost'))),
                zone(GHOST_ZONE), zone(DISCARD, CURRENT), 'gain', { faceUp: true },
              ),
            ],
          }),
        ]),
      ],
    },
  ];
}

function buildSetup(kit: CardKit): Block[] {
  const { SUPPLY, TRASH, DECK, HAND, RESERVE } = kit.zones;
  const { COST } = kit.fields;
  const { PLAYER } = kit;
  const { nameIs } = kit;

  /** One heirloom's swap: gated on its kingdom pile being IN THE SUPPLY
   *  (after promotion); each player's starter Copper leaves for the hidden
   *  RESERVE (hand fallback for exotic setups — at stock setup the deal has
   *  not happened yet, so the deck holds everything) and the heirloom
   *  shuffles into their deck. */
  const swapFor = (pile: string, heirloom: string): Block =>
    iff(gt(countCards(zone(SUPPLY), nameIs(pile)), num(0)), [
      announce(`Heirloom: each player swaps a starting Copper for a ${heirloom} (${pile}).`),
      forEachPlayer([
        iff(gt(countCards(zone(DECK, PLAYER), nameIs('Copper')), num(0)), [
          move(
            specific(bestCard(zone(DECK, PLAYER), 'highest', COST, nameIs('Copper'))),
            zone(DECK, PLAYER), zone(RESERVE), { faceUp: false },
          ),
        ], [
          iff(gt(countCards(zone(HAND, PLAYER), nameIs('Copper')), num(0)), [
            move(
              specific(bestCard(zone(HAND, PLAYER), 'highest', COST, nameIs('Copper'))),
              zone(HAND, PLAYER), zone(RESERVE), { faceUp: false },
            ),
          ]),
        ]),
        iff(gt(countCards(zone(HEIRLOOM_ZONE), nameIs(heirloom)), num(0)), [
          move(
            specific(bestCard(zone(HEIRLOOM_ZONE), 'highest', COST, nameIs(heirloom))),
            zone(HEIRLOOM_ZONE), zone(DECK, PLAYER), { faceUp: false },
          ),
        ]),
        shuffle(zone(DECK, PLAYER)),
      ]),
    ]);

  return [
    ...HEIRLOOM_PAIRS.map((p) => swapFor(p.pile, p.heirloom)),
    // The Zombies march into the trash only when Necromancer's pile is in
    // the supply (the printed setup). Untagged — setup is not a trash event.
    iff(gt(countCards(zone(SUPPLY), nameIs('Necromancer')), num(0)), [
      announce('Necromancer setup: the three Zombies shamble into the trash.'),
      move(ALL, zone(ZOMBIE_ZONE), zone(TRASH), { faceUp: true }),
    ]),
  ];
}

export const nocturneRest: ExpansionModule = {
  id: 'nocturneRest',
  setName: 'Nocturne',

  piles: [
    { name: 'Faithful Hound', cost: 2, count: 10 },
    { name: 'Leprechaun', cost: 3, count: 10 },
    { name: 'Cemetery', cost: 4, count: 10 },
    { name: 'Conclave', cost: 4, count: 10 },
    { name: 'Necromancer', cost: 4, count: 10 },
    { name: 'Shepherd', cost: 4, count: 10 },
    { name: 'Pooka', cost: 5, count: 10 },
    { name: 'Tragic Hero', cost: 5, count: 10 },
  ],

  ids: IDS,

  // Leprechaun's Hex is self-inflicted (verified) — no attacks in this half.
  attackNames: [],
  reactionNames: ['Faithful Hound'],
  victoryNames: ['Cemetery'],
  treasureNames: [
    'Haunted Mirror', 'Lucky Coin', 'Goat', 'Cursed Gold', 'Magic Lamp',
    'Pasture', 'Pouch',
  ],

  variables: [
    {
      id: NOC_NAME_VAR, name: 'Nocturne: name stash',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: NOC_COUNT_VAR, name: 'Nocturne: singleton counter',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: NECRO_MARK, name: 'Necromancer: played this turn',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
    {
      id: HOUND_MARK, name: 'Faithful Hound: set aside',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  zones: [
    {
      id: HEIRLOOM_ZONE, name: 'Heirloom stock',
      owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
    },
    {
      id: ZOMBIE_ZONE, name: 'Zombie stock',
      owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
    },
  ] as ZoneDef[],

  nonSupply: [
    {
      zoneId: HEIRLOOM_ZONE,
      piles: [
        // 2-player table: one per seat.
        { name: 'Haunted Mirror', cost: 0, count: 2 },
        { name: 'Lucky Coin', cost: 4, count: 2 },
        { name: 'Goat', cost: 2, count: 2 },
        { name: 'Cursed Gold', cost: 4, count: 2 },
        { name: 'Magic Lamp', cost: 0, count: 2 },
        { name: 'Pasture', cost: 2, count: 2 },
        { name: 'Pouch', cost: 2, count: 2 },
      ],
    },
    {
      zoneId: ZOMBIE_ZONE,
      piles: [
        { name: 'Zombie Apprentice', cost: 3, count: 1 },
        { name: 'Zombie Mason', cost: 3, count: 1 },
        { name: 'Zombie Spy', cost: 3, count: 1 },
      ],
    },
  ],

  buildCards,
  buildTriggers,
  buildSetup,

  buildVpTerms(kit: CardKit): Block[] {
    // PASTURE: 1 VP per Estate you have, per Pasture ($player is bound by
    // the recount's forEachPlayer). "You have" walks the core owned zones
    // (deck / hand / discard / in-play / duration); cards parked on OTHER
    // modules' mats (Exile, Island, Tavern…) are outside the boundary.
    const owned = [
      kit.zones.DECK, kit.zones.HAND, kit.zones.DISCARD, kit.zones.INPLAY, kit.zones.DURATION,
    ];
    const countOwned = (name: string): Expr => owned
      .map((z) => countCards(zone(z, kit.PLAYER), kit.nameIs(name)))
      .reduce((a, b) => add(a, b));
    return [
      changeVar(kit.vars.VP, mul(countOwned('Estate'), countOwned('Pasture')), kit.PLAYER),
    ];
  },

  buildCleanupResets(kit: CardKit): Block[] {
    // Necromancer's face-down marks fade with the turn (register).
    return [
      forEachCard(zone(kit.zones.TRASH), null, [
        setVar(NECRO_MARK, num(0), kit.CARD),
      ]),
    ];
  },
};
