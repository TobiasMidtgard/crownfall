/**
 * Empires — the 21 Landmarks (landscape sideboard, kind 'landmark').
 *
 * A Landmark has NO ability: its rules ride gated buildTriggers /
 * buildVpTerms / buildCleanupResets contributions, every one of which checks
 * the card is actually sitting in the landscapes zone — an unpicked Landmark
 * is completely inert. Scoring Landmarks add to the core VP recount (the VP
 * var is rebuilt from scratch every recount); in-game awards bank into the
 * core VP_TOKENS chips, which every recount re-adds.
 *
 * TWO-PLAYER TABLE: the def is strictly two seats; Keep's "each other
 * player" is the one opponent (nextPlayer).
 *
 * DEVIATIONS register (details in the per-landmark comments):
 *  - THE 6-VP-PER-PLAYER POOLS (Arena, Basilica, Baths, Battlefield,
 *    Colonnade, Labyrinth): each carries a hidden global paid-out counter
 *    capped at 12 VP — 6 VP x the table's two seats, the printed total.
 *    The per-player earmark is NOT modelled: one player can drain all 12.
 *  - AQUEDUCT is exact for the standard board: hidden counters model the
 *    8 VP on the Silver pile, the 8 VP on the Gold pile and the VP resting
 *    on the Aqueduct itself. Only Silver and Gold ever carry pile VP (as
 *    printed — setup puts VP nowhere else).
 *  - DEFILED SHRINE (approximation): the printed 2 VP on EACH non-Gathering
 *    Action supply pile is pooled into ONE global 20-VP feed (2 VP x the
 *    ten kingdom piles). A kingdom with non-Action piles slightly
 *    over-supplies the feed; per-pile depletion is not tracked. "When you
 *    buy a Curse, take the VP" is exact (buys only, as printed — a Witch's
 *    Curse moves nothing).
 *  - BASILICA / COLONNADE use the 2022 errata'd wordings ("when you GAIN a
 *    card, if you have $2 or more left" / "when you GAIN an Action card, if
 *    you have a copy of it in play"), so both watch 'gain' AND 'buy' moves.
 *  - BATHS / LABYRINTH: "in one of your turns" — a gain counts only while
 *    the gainer is the turn player, tracked in one shared per-turn counter
 *    (Baths pays at cleanup when it is still 0; Labyrinth pays when it hits
 *    exactly 2). Cards gained on the opponent's turn count for nobody.
 *  - MOUNTAIN PASS (prominent approximation): the printed after-the-turn
 *    debt AUCTION (each player bids up to 40 Debt, high bidder +8 VP) is
 *    inexpressible here. Closest honest shape: the FIRST Province gainer is
 *    immediately offered "take 8 Debt for +8 VP", the opponent is skipped,
 *    and the Pass fires exactly once per game whether or not the offer is
 *    taken.
 *  - TOMB: the engine does not bind "who trashed" on a shared-zone entry,
 *    so the chip goes to the CURRENT player — exact for self-trashes and
 *    attacker-driven trashes (Swindler-likes, officially the attacker's
 *    trash), wrong only for an opponent's voluntary off-turn trash
 *    (Bishop's offer credits the turn player instead).
 *  - OBELISK (approximation): the printed random Action supply pile becomes
 *    the COSTLIEST Action card in the supply at the first VP recount — the
 *    name locks into a hidden global at first evaluation (turn 1, before
 *    any pile can empty) and never changes. No Action pile in the kingdom =
 *    Obelisk scores nothing.
 *  - TOWER: "non-Victory card from an empty supply pile" = an owned
 *    non-Victory card wearing the Kingdom or Basic tag whose name has zero
 *    copies left in the supply. A reserve card bought off the Black Market
 *    (never a supply pile here) would wrongly count once its name reads
 *    empty — accepted and documented.
 *  - "VICTORY CARD" (Aqueduct's take / Battlefield) = Victory-TYPED or
 *    printed VP > 0, catching Harem/Mill-style duals in this port's
 *    one-primary-type world (the Cornucopia idiom).
 *  - TRIUMPHAL ARCH is exact, including the tie rule: when two or more
 *    Action names tie for most, the 2nd-most count equals the most.
 */
import type {
  Block, CardDef, Expr, TriggerDef, VariableDef,
} from '../../shared/types';
import {
  CURRENT, add, allOf, announce, anyOf, bestCard, bnd, changeVar, chooseCardsBlock, countCards,
  eq, field, forEachCard, getVar, gt, gte, iff, lt, mul, nextPlayer, not, num, setVar, specific,
  str, sub, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Aqueduct: 'dom_card_aqueduct',
  Arena: 'dom_card_arena',
  'Bandit Fort': 'dom_card_bandit_fort',
  Basilica: 'dom_card_basilica',
  Baths: 'dom_card_baths',
  Battlefield: 'dom_card_battlefield',
  Colonnade: 'dom_card_colonnade',
  'Defiled Shrine': 'dom_card_defiled_shrine',
  Fountain: 'dom_card_fountain',
  Keep: 'dom_card_keep',
  Labyrinth: 'dom_card_labyrinth',
  'Mountain Pass': 'dom_card_mountain_pass',
  Museum: 'dom_card_museum',
  Obelisk: 'dom_card_obelisk',
  Orchard: 'dom_card_orchard',
  Palace: 'dom_card_palace',
  Tomb: 'dom_card_tomb',
  Tower: 'dom_card_tower',
  'Triumphal Arch': 'dom_card_triumphal_arch',
  Wall: 'dom_card_wall',
  'Wolf Den': 'dom_card_wolf_den',
};

/** The landscape sideboard (stable dominionGame.ts literal — kit keeps it private). */
const LANDSCAPES = 'dom_zone_landscapes';
/** The buy phase's id (stable dominionGame.ts literal — Seaside's idiom). */
const PHASE_BUY = 'dom_phase_buy';

// --- hidden bookkeeping (exported so the module's probes can read them) --------

/** Paid-out counters for the printed 6-VP-per-player pools (cap 12 = 6 x 2 seats). */
export const ARENA_POOL = 'dom_var_emp_arena_pool';
export const BASILICA_POOL = 'dom_var_emp_basilica_pool';
export const BATHS_POOL = 'dom_var_emp_baths_pool';
export const BATTLEFIELD_POOL = 'dom_var_emp_battlefield_pool';
export const COLONNADE_POOL = 'dom_var_emp_colonnade_pool';
export const LABYRINTH_POOL = 'dom_var_emp_labyrinth_pool';
/** Aqueduct's pile caches (8 VP each, as printed) + the VP resting on it. */
export const AQUEDUCT_SILVER = 'dom_var_emp_aqueduct_silver';
export const AQUEDUCT_GOLD = 'dom_var_emp_aqueduct_gold';
export const AQUEDUCT_POOL = 'dom_var_emp_aqueduct_pool';
/** Defiled Shrine: VP moved onto it so far (cap 20 — the register) + resting VP. */
export const SHRINE_FEED = 'dom_var_emp_shrine_feed';
export const SHRINE_POOL = 'dom_var_emp_shrine_pool';
/** 1 once the Mountain Pass has fired (it fires once per game). */
export const PASS_DONE = 'dom_var_emp_pass_done';
/** Obelisk's locked pile name ('' until the first recount — the register). */
export const OBELISK_NAME = 'dom_var_emp_obelisk_name';
/** Cards the player gained during their own turn (Baths / Labyrinth), reset at cleanup. */
export const TURN_GAINS = 'dom_var_emp_turn_gains';
/** The recount sweeps' scratch: a name stash + three tallies + a per-card mark. */
export const EMP_NAME = 'dom_var_emp_name';
export const EMP_TALLY = 'dom_var_emp_tally';
export const EMP_AUX = 'dom_var_emp_aux';
export const EMP_AUX2 = 'dom_var_emp_aux2';
export const EMP_MARK = 'dom_var_emp_mark';

/** "<Name> is on the table" — the presence gate every contribution wears. */
const onTable = (kit: CardKit, name: string): Expr =>
  gt(countCards(zone(LANDSCAPES), kit.nameIs(name)), num(0));

/** Owned zones — mirrors the core recount's walk (DURATION included). */
const OWNED_ZONE_IDS = (kit: CardKit): string[] => [
  kit.zones.DECK, kit.zones.HAND, kit.zones.DISCARD, kit.zones.INPLAY, kit.zones.DURATION,
];

/** "Is a Victory card" in the one-primary-type world (the register). */
const victoryish = (kit: CardKit, card: Expr): Expr => anyOf(
  kit.isA(card, kit.types.VICTORY),
  gt(field(card, kit.fields.VP_F), num(0)),
);

function buildCards(kit: CardKit): CardDef[] {
  const t = (name: string, text: string): CardDef =>
    kit.cardDef(IDS[name], name, 0, 0, 0, text);
  return [
    t('Aqueduct', 'When you gain a Treasure, move 1 VP from its pile to this. When you gain a Victory card, take the VP from this. Setup: Put 8 VP on the Silver and Gold piles.'),
    t('Arena', 'At the start of your Buy phase, you may discard an Action card. If you do, take 2 VP from here. Setup: Put 6 VP here per player.'),
    t('Bandit Fort', 'When scoring, -2 VP for each Silver and each Gold you have.'),
    t('Basilica', 'When you gain a card, if you have $2 or more left, take 2 VP from here. Setup: Put 6 VP here per player.'),
    t('Baths', 'When you end your turn without having gained a card, take 2 VP from here. Setup: Put 6 VP here per player.'),
    t('Battlefield', 'When you gain a Victory card, take 2 VP from here. Setup: Put 6 VP here per player.'),
    t('Colonnade', 'When you gain an Action card, if you have a copy of it in play, take 2 VP from here. Setup: Put 6 VP here per player.'),
    t('Defiled Shrine', 'When you gain an Action, move 1 VP from its pile to this. When you buy a Curse, take the VP from this. Setup: Put 2 VP on each non-Gathering Action Supply pile.'),
    t('Fountain', 'When scoring, 15 VP if you have at least 10 Coppers.'),
    t('Keep', 'When scoring, 5 VP per differently named Treasure you have, if you have more copies of it than each other player, or are tied for the most.'),
    t('Labyrinth', 'When you gain a 2nd card in one of your turns, take 2 VP from here. Setup: Put 6 VP here per player.'),
    t('Mountain Pass', 'When you are the first player to gain a Province, after that turn, each player bids once, up to 40 Debt, ending with you. High bidder gets +8 VP and takes the Debt they bid.'),
    t('Museum', 'When scoring, 2 VP per differently named card you have.'),
    t('Obelisk', 'When scoring, 2 VP per card you have from the chosen pile. Setup: Choose a random Action Supply pile.'),
    t('Orchard', 'When scoring, 4 VP per differently named Action card you have 3 or more copies of.'),
    t('Palace', 'When scoring, 3 VP per set you have of Copper - Silver - Gold.'),
    t('Tomb', 'When you trash a card, +1 VP.'),
    t('Tower', 'When scoring, 1 VP per non-Victory card you have from an empty Supply pile.'),
    t('Triumphal Arch', "When scoring, 3 VP per copy you have of the 2nd most common Action card among your cards. (If it's a tie, count either.)"),
    t('Wall', 'When scoring, -1 VP per card you have after the first 15.'),
    t('Wolf Den', 'When scoring, -3 VP per card you have exactly one copy of.'),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { HAND, DISCARD, INPLAY, TRASH } = kit.zones;
  const { COINS, VP_TOKENS, DEBT } = kit.vars;
  const { CARD, CHOICE } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');
  /** phaseStart binds $player = the player whose phase started. */
  const P = bnd('$player');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** Pay 2 VP out of a capped pool (the 6-VP-per-player wells — register). */
  const payFromPool = (poolVar: string, who: Expr, note: string): Block =>
    iff(lt(getVar(poolVar), num(12)), [
      changeVar(poolVar, num(2)),
      changeVar(VP_TOKENS, num(2), who),
      announce(who, note),
    ]);

  /**
   * AQUEDUCT — exact (register): a gained Silver/Gold moves 1 VP from its
   * pile cache onto the Aqueduct; a gained Victory card takes what rests
   * there. A dual Treasure-Victory resolves feed-then-take in one pass.
   */
  const aqueduct = (tag: string): TriggerDef => ({
    id: `dom_trigger_emp_aqueduct_${tag}`,
    name: `Aqueduct: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(onTable(kit, 'Aqueduct'), [
        iff(allOf(kit.nameIs('Silver'), gt(getVar(AQUEDUCT_SILVER), num(0))), [
          changeVar(AQUEDUCT_SILVER, num(-1)),
          changeVar(AQUEDUCT_POOL, num(1)),
          announce('Aqueduct: 1 VP flows from the Silver pile onto the Aqueduct.'),
        ]),
        iff(allOf(kit.nameIs('Gold'), gt(getVar(AQUEDUCT_GOLD), num(0))), [
          changeVar(AQUEDUCT_GOLD, num(-1)),
          changeVar(AQUEDUCT_POOL, num(1)),
          announce('Aqueduct: 1 VP flows from the Gold pile onto the Aqueduct.'),
        ]),
        iff(allOf(victoryish(kit, CARD), gt(getVar(AQUEDUCT_POOL), num(0))), [
          changeVar(VP_TOKENS, getVar(AQUEDUCT_POOL), GAINER),
          announce(GAINER, ' takes the VP resting on the Aqueduct.'),
          setVar(AQUEDUCT_POOL, num(0)),
        ]),
      ]),
    ],
  });

  /** BATTLEFIELD — 2 VP per Victory card gained, while the pool lasts. */
  const battlefield = (tag: string): TriggerDef => ({
    id: `dom_trigger_emp_battlefield_${tag}`,
    name: `Battlefield: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(onTable(kit, 'Battlefield'), victoryish(kit, CARD)), [
        payFromPool(BATTLEFIELD_POOL, GAINER, ' takes 2 VP from the Battlefield.'),
      ]),
    ],
  });

  /** BASILICA — errata'd wording (register): any gain with $2 or more left. */
  const basilica = (tag: string): TriggerDef => ({
    id: `dom_trigger_emp_basilica_${tag}`,
    name: `Basilica: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(onTable(kit, 'Basilica'), gte(getVar(COINS, GAINER), num(2))), [
        payFromPool(BASILICA_POOL, GAINER, ' takes 2 VP from the Basilica.'),
      ]),
    ],
  });

  /**
   * COLONNADE — errata'd wording (register): an Action gained while a copy
   * of it is in play. The gained card's name rides the stash so the in-play
   * count's filter (whose $card rebinds per candidate) can compare it.
   */
  const colonnade = (tag: string): TriggerDef => ({
    id: `dom_trigger_emp_colonnade_${tag}`,
    name: `Colonnade: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(onTable(kit, 'Colonnade'), kit.isA(CARD, kit.types.ACTION)), [
        setVar(EMP_NAME, field(CARD, 'name'), GAINER),
        iff(gt(countCards(zone(INPLAY, GAINER),
          eq(field(CARD, 'name'), getVar(EMP_NAME, GAINER))), num(0)), [
          payFromPool(COLONNADE_POOL, GAINER, ' takes 2 VP from the Colonnade.'),
        ]),
      ]),
    ],
  });

  /**
   * BATHS + LABYRINTH's shared per-turn gain counter (register): counts only
   * while the gainer is the turn player. Labyrinth pays on exactly the 2nd.
   */
  const turnGains = (tag: string): TriggerDef => ({
    id: `dom_trigger_emp_turn_gains_${tag}`,
    name: `Baths/Labyrinth: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        anyOf(onTable(kit, 'Baths'), onTable(kit, 'Labyrinth')),
        eq(GAINER, CURRENT),
      ), [
        changeVar(TURN_GAINS, num(1), GAINER),
        iff(allOf(onTable(kit, 'Labyrinth'), eq(getVar(TURN_GAINS, GAINER), num(2))), [
          payFromPool(LABYRINTH_POOL, GAINER, ' takes 2 VP from the Labyrinth.'),
        ]),
      ]),
    ],
  });

  /** DEFILED SHRINE's feed — 1 VP per Action gained, out of the 20-VP pool. */
  const shrineFeed = (tag: string): TriggerDef => ({
    id: `dom_trigger_emp_shrine_${tag}`,
    name: `Defiled Shrine: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        onTable(kit, 'Defiled Shrine'),
        kit.isA(CARD, kit.types.ACTION),
        lt(getVar(SHRINE_FEED), num(20)),
      ), [
        changeVar(SHRINE_FEED, num(1)),
        changeVar(SHRINE_POOL, num(1)),
        announce('Defiled Shrine: 1 VP settles onto the Shrine.'),
      ]),
    ],
  });

  /** DEFILED SHRINE's take — buying a Curse (buys ONLY, as printed). */
  const shrineCurse: TriggerDef = {
    id: 'dom_trigger_emp_shrine_curse',
    name: 'Defiled Shrine: a Curse is bought',
    event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
    condition: null,
    script: [
      iff(allOf(
        onTable(kit, 'Defiled Shrine'),
        kit.nameIs('Curse'),
        gt(getVar(SHRINE_POOL), num(0)),
      ), [
        changeVar(VP_TOKENS, getVar(SHRINE_POOL), GAINER),
        announce(GAINER, ' takes the VP from the Defiled Shrine.'),
        setVar(SHRINE_POOL, num(0)),
      ]),
    ],
  };

  /** TOMB — +1 VP per trash, to the CURRENT player (deviation — register). */
  const tomb: TriggerDef = {
    id: 'dom_trigger_emp_tomb',
    name: 'Tomb: a card is trashed',
    event: { kind: 'cardEnterZone', zoneId: TRASH, tag: 'trash' },
    condition: null,
    script: [
      iff(onTable(kit, 'Tomb'), [
        changeVar(VP_TOKENS, num(1), CURRENT),
        announce(CURRENT, ' takes 1 VP at the Tomb.'),
      ]),
    ],
  };

  /** MOUNTAIN PASS — the one-shot 8-Debt-for-8-VP offer (deviation — register). */
  const mountainPass = (tag: string): TriggerDef => ({
    id: `dom_trigger_emp_pass_${tag}`,
    name: `Mountain Pass: a Province is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        onTable(kit, 'Mountain Pass'),
        kit.nameIs('Province'),
        eq(getVar(PASS_DONE), num(0)),
      ), [
        setVar(PASS_DONE, num(1)),
        announce(GAINER, ' reaches the Mountain Pass with the first Province.'),
        {
          kind: 'choose', who: GAINER,
          choice: { kind: 'yesNo', prompt: 'Mountain Pass: take 8 Debt for +8 VP?' },
        },
        iff(CHOICE, [
          changeVar(DEBT, num(8), GAINER),
          changeVar(VP_TOKENS, num(8), GAINER),
          announce(GAINER, ' takes 8 Debt for 8 VP at the Mountain Pass.'),
        ], [announce(GAINER, ' declines the Mountain Pass.')]),
      ]),
    ],
  });

  /** ARENA — at the buy phase's start, discard an Action for 2 VP (optional). */
  const arena: TriggerDef = {
    id: 'dom_trigger_emp_arena',
    name: 'Arena: the buy phase begins',
    event: { kind: 'phaseStart', phaseId: PHASE_BUY },
    condition: null,
    script: [
      iff(allOf(
        onTable(kit, 'Arena'),
        lt(getVar(ARENA_POOL), num(12)),
        gt(countCards(zone(HAND, P), kit.IS_ACTION_CARD), num(0)),
      ), [
        chooseCardsBlock({
          who: P, from: zone(HAND, P), filter: kit.IS_ACTION_CARD,
          min: num(0), max: num(1),
          prompt: 'Arena: you may discard an Action card to take 2 VP',
          body: [
            announce(P, ' discards ', CARD, ' before the Arena crowd.'),
            kit.tmove(specific(CARD), zone(HAND, P), zone(DISCARD, P), 'discard', { faceUp: true }),
            changeVar(ARENA_POOL, num(2)),
            changeVar(VP_TOKENS, num(2), P),
            announce(P, ' takes 2 VP from the Arena.'),
          ],
        }),
      ]),
    ],
  };

  return [
    aqueduct('gain'), aqueduct('buy'),
    battlefield('gain'), battlefield('buy'),
    basilica('gain'), basilica('buy'),
    colonnade('gain'), colonnade('buy'),
    turnGains('gain'), turnGains('buy'),
    shrineFeed('gain'), shrineFeed('buy'),
    shrineCurse,
    tomb,
    mountainPass('gain'), mountainPass('buy'),
    arena,
  ];
}

function buildVpTerms(kit: CardKit): Block[] {
  const { SUPPLY } = kit.zones;
  const { VP } = kit.vars;
  const { COST } = kit.fields;
  const { CARD, PLAYER } = kit;
  const zones = OWNED_ZONE_IDS(kit);

  /** Count the player's owned cards matching `filter` (fresh nodes per call). */
  const owned = (filter: Expr | null): Expr => zones
    .map((zid) => countCards(zone(zid, PLAYER), filter === null ? null : filter))
    .reduce((a, b) => add(a, b));
  const ownedNamed = (name: string): Expr => owned(kit.nameIs(name));
  /** Owned cards sharing the stashed name ($card rebinds inside the filter). */
  const namesakes = (): Expr => zones
    .map((zid) => countCards(zone(zid, PLAYER),
      eq(field(CARD, 'name'), getVar(EMP_NAME, PLAYER))))
    .reduce((a, b) => add(a, b));
  /** The OPPONENT's copies of the stashed name (two-seat Keep — register). */
  const theirNamesakes = (): Expr => zones
    .map((zid) => countCards(zone(zid, nextPlayer(PLAYER)),
      eq(field(CARD, 'name'), getVar(EMP_NAME, PLAYER))))
    .reduce((a, b) => add(a, b));
  const ownedTotal = (): Expr => zones
    .map((zid) => zoneCount(zone(zid, PLAYER)))
    .reduce((a, b) => add(a, b));

  /**
   * EXACT distinct-name visit (the Cornucopia mark-sweep idiom): reset every
   * candidate's mark, then walk the candidates — `perName` runs once per
   * DISTINCT name (when no already-marked namesake exists), with the name
   * stashed in EMP_NAME. `filterOf` must mint fresh nodes per call.
   */
  const sweepDistinct = (filterOf: (() => Expr) | null, perName: () => Block[]): Block[] => {
    const markedNamesake = (): Expr => zones
      .map((zid) => countCards(zone(zid, PLAYER), allOf(
        eq(getVar(EMP_MARK, CARD), num(1)),
        eq(field(CARD, 'name'), getVar(EMP_NAME, PLAYER)),
      )))
      .reduce((a, b) => add(a, b));
    return [
      ...zones.map((zid) => forEachCard(zone(zid, PLAYER), filterOf === null ? null : filterOf(), [
        setVar(EMP_MARK, num(0), CARD),
      ])),
      ...zones.map((zid) => forEachCard(zone(zid, PLAYER), filterOf === null ? null : filterOf(), [
        setVar(EMP_NAME, field(CARD, 'name'), PLAYER),
        iff(eq(markedNamesake(), num(0)), perName()),
        setVar(EMP_MARK, num(1), CARD),
      ])),
    ];
  };

  const isAction = (): Expr => kit.isA(CARD, kit.types.ACTION);
  const isTreasure = (): Expr => kit.isA(CARD, kit.types.TREASURE);

  return [
    // BANDIT FORT — -2 VP per Silver and per Gold owned.
    iff(onTable(kit, 'Bandit Fort'), [
      changeVar(VP, mul(num(-2), add(ownedNamed('Silver'), ownedNamed('Gold'))), PLAYER),
    ]),

    // FOUNTAIN — a flat 15 VP with 10+ Coppers (15 or nothing, as ruled).
    iff(allOf(onTable(kit, 'Fountain'), gte(ownedNamed('Copper'), num(10))), [
      changeVar(VP, num(15), PLAYER),
    ]),

    // KEEP — 5 VP per differently named owned Treasure with most-or-tied
    // copies against the one opponent (two-seat reading — register).
    iff(onTable(kit, 'Keep'), sweepDistinct(isTreasure, () => [
      iff(gte(namesakes(), theirNamesakes()), [changeVar(VP, num(5), PLAYER)]),
    ])),

    // MUSEUM — 2 VP per differently named owned card (exact mark sweep).
    iff(onTable(kit, 'Museum'), sweepDistinct(null, () => [
      changeVar(VP, num(2), PLAYER),
    ])),

    // OBELISK — the pile name locks in at the first recount (register),
    // then 2 VP per owned copy of it.
    iff(onTable(kit, 'Obelisk'), [
      iff(allOf(
        eq(getVar(OBELISK_NAME), str('')),
        gt(countCards(zone(SUPPLY), kit.IS_ACTION_CARD), num(0)),
      ), [
        setVar(OBELISK_NAME,
          field(bestCard(zone(SUPPLY), 'highest', COST, kit.IS_ACTION_CARD), 'name')),
      ]),
      changeVar(VP,
        mul(num(2), owned(eq(field(CARD, 'name'), getVar(OBELISK_NAME)))),
        PLAYER),
    ]),

    // ORCHARD — 4 VP per differently named Action owned 3+ times.
    iff(onTable(kit, 'Orchard'), sweepDistinct(isAction, () => [
      iff(gte(namesakes(), num(3)), [changeVar(VP, num(4), PLAYER)]),
    ])),

    // PALACE — 3 VP per Copper+Silver+Gold set: 3 x min of the three counts.
    iff(onTable(kit, 'Palace'), [
      setVar(EMP_TALLY, ownedNamed('Copper'), PLAYER),
      iff(lt(ownedNamed('Silver'), getVar(EMP_TALLY, PLAYER)), [
        setVar(EMP_TALLY, ownedNamed('Silver'), PLAYER),
      ]),
      iff(lt(ownedNamed('Gold'), getVar(EMP_TALLY, PLAYER)), [
        setVar(EMP_TALLY, ownedNamed('Gold'), PLAYER),
      ]),
      changeVar(VP, mul(num(3), getVar(EMP_TALLY, PLAYER)), PLAYER),
    ]),

    // TOWER — 1 VP per owned non-Victory Kingdom/Basic card whose supply
    // pile is empty (the tag clause excludes non-supply stock — register).
    iff(onTable(kit, 'Tower'), zones.map((zid) => forEachCard(
      zone(zid, PLAYER),
      allOf(
        not(victoryish(kit, CARD)),
        anyOf(kit.hasTag(CARD, kit.tags.KINGDOM), kit.hasTag(CARD, 'dom_tag_basic')),
      ),
      [
        setVar(EMP_NAME, field(CARD, 'name'), PLAYER),
        iff(eq(countCards(zone(SUPPLY),
          eq(field(CARD, 'name'), getVar(EMP_NAME, PLAYER))), num(0)), [
          changeVar(VP, num(1), PLAYER),
        ]),
      ],
    ))),

    // TRIUMPHAL ARCH — 3 VP per copy of the 2nd most common owned Action
    // name. Pass 1: the max count M1 (EMP_AUX). Pass 2: the runner-up M2
    // (EMP_AUX2) + how many names sit AT the max (EMP_TALLY); a 2+ tie at
    // the top makes the runner-up equal the max (the printed tie rule).
    iff(onTable(kit, 'Triumphal Arch'), [
      setVar(EMP_AUX, num(0), PLAYER),
      ...sweepDistinct(isAction, () => [
        iff(gt(namesakes(), getVar(EMP_AUX, PLAYER)), [
          setVar(EMP_AUX, namesakes(), PLAYER),
        ]),
      ]),
      setVar(EMP_AUX2, num(0), PLAYER),
      setVar(EMP_TALLY, num(0), PLAYER),
      ...sweepDistinct(isAction, () => [
        iff(eq(namesakes(), getVar(EMP_AUX, PLAYER)), [
          changeVar(EMP_TALLY, num(1), PLAYER),
        ], [
          iff(gt(namesakes(), getVar(EMP_AUX2, PLAYER)), [
            setVar(EMP_AUX2, namesakes(), PLAYER),
          ]),
        ]),
      ]),
      iff(gte(getVar(EMP_TALLY, PLAYER), num(2)), [
        setVar(EMP_AUX2, getVar(EMP_AUX, PLAYER), PLAYER),
      ]),
      changeVar(VP, mul(num(3), getVar(EMP_AUX2, PLAYER)), PLAYER),
    ]),

    // WALL — -1 VP per owned card beyond the 15th.
    iff(allOf(onTable(kit, 'Wall'), gt(ownedTotal(), num(15))), [
      changeVar(VP, sub(num(15), ownedTotal()), PLAYER),
    ]),

    // WOLF DEN — -3 VP per owned card that is its owner's only copy (a
    // count-1 name is visited exactly once, so no marks are needed).
    iff(onTable(kit, 'Wolf Den'), zones.map((zid) => forEachCard(zone(zid, PLAYER), null, [
      setVar(EMP_NAME, field(CARD, 'name'), PLAYER),
      iff(eq(namesakes(), num(1)), [changeVar(VP, num(-3), PLAYER)]),
    ]))),
  ];
}

function buildCleanupResets(kit: CardKit): Block[] {
  const { VP_TOKENS } = kit.vars;
  return [
    // BATHS — pays at the turn's own cleanup (before the turn-end recount,
    // so the final turn's chips still score) when nothing was gained.
    iff(allOf(
      onTable(kit, 'Baths'),
      eq(getVar(TURN_GAINS, CURRENT), num(0)),
      lt(getVar(BATHS_POOL), num(12)),
    ), [
      changeVar(BATHS_POOL, num(2)),
      changeVar(VP_TOKENS, num(2), CURRENT),
      announce(CURRENT, ' gained nothing this turn and takes 2 VP from the Baths.'),
    ]),
    // The shared per-turn gain counter fades with the turn.
    setVar(TURN_GAINS, num(0), CURRENT),
  ];
}

export const empiresLandmarks: ExpansionModule = {
  id: 'empiresLandmarks',
  setName: 'Empires',

  piles: [],

  ids: IDS,

  landscapes: [
    { name: 'Aqueduct', cost: 0, kind: 'landmark' },
    { name: 'Arena', cost: 0, kind: 'landmark' },
    { name: 'Bandit Fort', cost: 0, kind: 'landmark' },
    { name: 'Basilica', cost: 0, kind: 'landmark' },
    { name: 'Baths', cost: 0, kind: 'landmark' },
    { name: 'Battlefield', cost: 0, kind: 'landmark' },
    { name: 'Colonnade', cost: 0, kind: 'landmark' },
    { name: 'Defiled Shrine', cost: 0, kind: 'landmark' },
    { name: 'Fountain', cost: 0, kind: 'landmark' },
    { name: 'Keep', cost: 0, kind: 'landmark' },
    { name: 'Labyrinth', cost: 0, kind: 'landmark' },
    { name: 'Mountain Pass', cost: 0, kind: 'landmark' },
    { name: 'Museum', cost: 0, kind: 'landmark' },
    { name: 'Obelisk', cost: 0, kind: 'landmark' },
    { name: 'Orchard', cost: 0, kind: 'landmark' },
    { name: 'Palace', cost: 0, kind: 'landmark' },
    { name: 'Tomb', cost: 0, kind: 'landmark' },
    { name: 'Tower', cost: 0, kind: 'landmark' },
    { name: 'Triumphal Arch', cost: 0, kind: 'landmark' },
    { name: 'Wall', cost: 0, kind: 'landmark' },
    { name: 'Wolf Den', cost: 0, kind: 'landmark' },
  ],

  variables: [
    { id: ARENA_POOL, name: 'Arena: VP paid out', scope: 'global', type: 'number', initial: 0, hidden: true },
    { id: BASILICA_POOL, name: 'Basilica: VP paid out', scope: 'global', type: 'number', initial: 0, hidden: true },
    { id: BATHS_POOL, name: 'Baths: VP paid out', scope: 'global', type: 'number', initial: 0, hidden: true },
    { id: BATTLEFIELD_POOL, name: 'Battlefield: VP paid out', scope: 'global', type: 'number', initial: 0, hidden: true },
    { id: COLONNADE_POOL, name: 'Colonnade: VP paid out', scope: 'global', type: 'number', initial: 0, hidden: true },
    { id: LABYRINTH_POOL, name: 'Labyrinth: VP paid out', scope: 'global', type: 'number', initial: 0, hidden: true },
    { id: AQUEDUCT_SILVER, name: 'Aqueduct: VP on the Silver pile', scope: 'global', type: 'number', initial: 8, hidden: true },
    { id: AQUEDUCT_GOLD, name: 'Aqueduct: VP on the Gold pile', scope: 'global', type: 'number', initial: 8, hidden: true },
    { id: AQUEDUCT_POOL, name: 'Aqueduct: VP resting on it', scope: 'global', type: 'number', initial: 0, hidden: true },
    { id: SHRINE_FEED, name: 'Defiled Shrine: VP moved so far', scope: 'global', type: 'number', initial: 0, hidden: true },
    { id: SHRINE_POOL, name: 'Defiled Shrine: VP resting on it', scope: 'global', type: 'number', initial: 0, hidden: true },
    { id: PASS_DONE, name: 'Mountain Pass: already crossed', scope: 'global', type: 'number', initial: 0, hidden: true },
    { id: OBELISK_NAME, name: 'Obelisk: the chosen pile', scope: 'global', type: 'string', initial: '', hidden: true },
    { id: TURN_GAINS, name: 'Cards gained this turn', scope: 'perPlayer', type: 'number', initial: 0, hidden: true },
    { id: EMP_NAME, name: 'Empires: name under the lens', scope: 'perPlayer', type: 'string', initial: '', hidden: true },
    { id: EMP_TALLY, name: 'Empires: sweep tally', scope: 'perPlayer', type: 'number', initial: 0, hidden: true },
    { id: EMP_AUX, name: 'Empires: sweep aux', scope: 'perPlayer', type: 'number', initial: 0, hidden: true },
    { id: EMP_AUX2, name: 'Empires: sweep aux 2', scope: 'perPlayer', type: 'number', initial: 0, hidden: true },
    { id: EMP_MARK, name: 'Empires: counted', scope: 'perCard', type: 'number', initial: 0, hidden: true },
  ] as VariableDef[],

  buildCards,
  buildTriggers,
  buildVpTerms,
  buildCleanupResets,
};
