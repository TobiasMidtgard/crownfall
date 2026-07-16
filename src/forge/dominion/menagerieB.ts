/**
 * Menagerie (part B) — Barge, Coven, Displace, Falconer, Fisherman,
 * Gatekeeper, Hunting Lodge, Kiln, Livery, Mastermind, Paddock, Sanctuary,
 * Destrier, Wayfarer, Animal Fair.
 *
 * SHARED SURFACES (declared by the sibling module menagerieA — referenced
 * here as string literals, never re-declared): the per-player Exile mat
 * 'dom_zone_exile', the shared Horse stock 'dom_zone_horses' (30 Horses,
 * non-supply), the exile-discard-on-gain trigger and the exile VP term.
 * Register menagerieA BEFORE menagerieB in expansions.ts.
 *
 * House idioms follow the Base/Intrigue/Seaside modules: attack halves are
 * separate `stacked: true` abilities gated per victim on IMMUNE == 0 (the
 * shared effectResolved trigger resets it), every mandatory choice is guarded
 * so a session can never hang, and Duration cards ride kit.durationPair (now
 * fires on 'play'-tagged In-Play entries only; the next-turn march back is
 * tagged 'duration_return', so no re-entry guards are needed).
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "each other player" /
 * "another player" is the one opponent everywhere below (forEachOpponent).
 *
 * EXILING is NOT gaining and NOT discarding (printed ruling — Watchtower and
 * on-gain triggers must not see it), and the def's move-cause vocabulary is
 * fixed (play/buy/cleanup/draw/gain/trash/discard/duration_return), so every
 * move onto an Exile mat below is UNTAGGED.
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - ANIMAL FAIR: ships at its PRINTED cost $7 (the task sheet said 6 — the
 *    printed card is $7, verified). The printed alternative cost ("instead
 *    of paying this card's cost, you may trash an Action card from your
 *    hand") is DROPPED — the buy action's price is core surface; the card is
 *    bought for coins only. The +$4 / +1 Buy per empty pile on-play is exact.
 *  - BARGE: the printed now-or-later choice is a chooseOption on play: the
 *    'now' branch pays +3 Cards +1 Buy immediately and SKIPS parking (the
 *    card is cleaned up this turn, as printed); 'later' parks the card and
 *    the bonus arrives at the owner's next action-phase start. A
 *    Throne-Roomed Barge asks per replay: now+later matches print exactly;
 *    later+later parks once, so the bonus fires ONCE (kit contract; the
 *    printed card would pay twice).
 *  - COVEN: exact. The Curse leaves the SUPPLY for the victim's Exile mat on
 *    an untagged move (not a gain — so Watchtower-style on-gain effects
 *    correctly never see it, the printed ruling). When the Curse pile is
 *    empty the victim instead discards every Curse on their Exile mat
 *    ('discard'-tagged). Moat-blockable (stacked half, IMMUNE-gated).
 *  - DISPLACE: exact. The gain cap is the exiled card's PRINTED cost + 2,
 *    Bridge-aware at gain time (cost <= printed+2+DISCOUNT, the Blockade
 *    idiom); the "differently named" filter compares against the stashed
 *    name of the exiled card.
 *  - FALCONER: "a card with 2 or more types" is approximated as: wears the
 *    Attack or Reaction tag, OR has printed VP > 0 without being
 *    Victory-typed (the Action/Treasure–Victory duals: Mill, Island, Harem,
 *    Nobles…). Duration cards do NOT count (the def has no Duration tag —
 *    Duration-ness is behavioral, see the MOAT DECISION note in
 *    dominionGame.ts). Each holder gets ONE yes/no per qualifying gain and
 *    plays ONE Falconer on a yes (further gains re-offer). "Costing less
 *    than this" compares PRINTED cost < 5 (a live Bridge discount shifts
 *    both sides equally — Remake's precedent). The reaction is a pair of
 *    module triggers on the 'gain' AND 'buy' causes, so it works on anyone's
 *    turn including the holder's own gains, as printed.
 *  - FISHERMAN: the printed dynamic cost ("during your turns, if your
 *    discard pile is empty, this costs $3 less") is inexpressible — flat $5.
 *  - GATEKEEPER (prominent): the printed ongoing duration attack becomes a
 *    parked-card watcher. On play a stacked strike opens the response window
 *    (Moat-revealable) and REMEMBERS each opponent's immunity in a
 *    per-player flag (GATEKEEPER_IMMUNE := IMMUNE at strike time) — a Moat
 *    reveal therefore blocks the WHOLE watch, the printed duration-attack
 *    ruling. While a Gatekeeper sits parked in an opponent's DURATION zone,
 *    every Action- or Treasure-typed card the victim gains ('gain'/'buy')
 *    with no same-named card on their Exile mat is moved onto their Exile
 *    mat (untagged; skipped when the card already left for the trash — the
 *    Watchtower interplay). The flag is one per player, not per Gatekeeper:
 *    with overlapping Gatekeepers a late Moat reveal can shield against an
 *    earlier unblocked copy (and vice versa) until the next strike refreshes
 *    it. The +$3 later half is exact.
 *  - HUNTING LODGE: exact; discarding an empty hand for +5 Cards is allowed
 *    (the official ruling), so the yes/no is offered even on an empty hand.
 *  - KILN: printed says you may gain the copy FIRST (before resolving the
 *    played card); here the copy is offered right AFTER the card enters
 *    play, same play event (visible difference only for cost-of-play
 *    interactions the def lacks). Each Kiln play arms a per-player counter;
 *    the NEXT 'play'-tagged In-Play entry consumes ALL armed instances, one
 *    yes/no copy-offer each (a Throne-Roomed Kiln arms twice, so the next
 *    play offers two copies — the printed cumulative ruling). Throne Room's
 *    synthetic replays are 'play'-tagged and consume the flag too (a replay
 *    IS a play). Copies come from the SUPPLY by name — a played Horse whiffs
 *    (not in the supply) but still consumes, as printed. Reset at cleanup.
 *  - LIVERY: a per-player counter (not an in-play count): each Livery PLAY
 *    this turn adds one Horse per qualifying gain, so a Throne-Roomed Livery
 *    pays two Horses per gain (the printed cumulative ruling). "Costing $4
 *    or more" is Bridge-aware (printed cost >= 4 + DISCOUNT = current cost
 *    >= 4). Horses come from the shared 'dom_zone_horses' stock and whiff
 *    politely when it is empty. Reset at cleanup.
 *  - MASTERMIND: the later half plays a hand Action THREE times via the
 *    Throne Room mechanism (one real 'play'-tagged move + two synthetic
 *    replays). A Throne-Roomed Mastermind runs `now` twice but parks once,
 *    so next turn offers ONE triple-play (kit contract; printed gives two).
 *  - DESTRIER: the printed dynamic cost ("costs $1 less per card you've
 *    gained this turn") is inexpressible — flat $6.
 *  - WAYFARER: the printed dynamic cost ("has the same cost as the last
 *    other card gained this turn") is inexpressible — flat $6. The Silver
 *    gain is an optional yes/no, guarded on the pile.
 */
import type {
  AbilityDef, Block, CardDef, Expr, TriggerDef, VariableDef,
} from '../../shared/types';
import {
  ALL, add, allOf, announce, anyOf, bestCard, bnd, cardZoneId, changeVar, chooseCard,
  chooseCardsBlock, chooseOption, countCards, eq, field, forEachOpponent, forEachPlayer, getVar,
  gt, gte, iff, lt, lte, matching, move, neq, not, num, setVar, specific, str, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Barge: 'dom_card_barge',
  Coven: 'dom_card_coven',
  Displace: 'dom_card_displace',
  Falconer: 'dom_card_falconer',
  Fisherman: 'dom_card_fisherman',
  Gatekeeper: 'dom_card_gatekeeper',
  'Hunting Lodge': 'dom_card_hunting_lodge',
  Kiln: 'dom_card_kiln',
  Livery: 'dom_card_livery',
  Mastermind: 'dom_card_mastermind',
  Paddock: 'dom_card_paddock',
  Sanctuary: 'dom_card_sanctuary',
  Destrier: 'dom_card_destrier',
  Wayfarer: 'dom_card_wayfarer',
  'Animal Fair': 'dom_card_animal_fair',
};

/** menagerieA's per-player Exile mat (referenced, never declared here). */
export const EXILE_ZONE = 'dom_zone_exile';
/** menagerieA's shared Horse stock (referenced, never declared here). */
export const HORSE_ZONE = 'dom_zone_horses';

/** Gatekeeper: 1 while this player Moat-ed the last strike (see register). */
export const GATEKEEPER_IMMUNE = 'dom_var_gatekeeper_immune';
/** Gatekeeper: the gained card's name (filters rebind $card — the stash). */
export const GATEKEEPER_NAME = 'dom_var_gatekeeper_name';
/** Displace: the exiled card's name (the "differently named" filter). */
export const DISPLACE_NAME = 'dom_var_displace_name';
/** Kiln: copies armed for the next play this turn (reset at cleanup). */
export const KILN_ARMED = 'dom_var_kiln_armed';
/** Kiln: the consume loop's countdown. */
export const KILN_TODO = 'dom_var_kiln_todo';
/** Kiln: the played card's name (the supply-copy lookup). */
export const KILN_NAME = 'dom_var_kiln_name';
/** Livery: Livery plays this turn = Horses per qualifying gain (cleanup reset). */
export const LIVERY_COUNT = 'dom_var_livery_count';
/** Livery: the horse-payout loop's countdown. */
export const LIVERY_TODO = 'dom_var_livery_todo';

/** A yes/no question to `who`; the answer lands in $choice as a boolean. */
const yesNo = (who: Expr, prompt: string): Block =>
  ({ kind: 'choose', who, choice: { kind: 'yesNo', prompt } });

/** Gain one Horse from the shared stock into `who`'s discard (guarded). */
function gainHorse(kit: CardKit, who: Expr): Block {
  const { COST } = kit.fields;
  return iff(gt(countCards(zone(HORSE_ZONE), kit.nameIs('Horse')), num(0)), [
    announce(who, ' gains a Horse.'),
    kit.tmove(
      specific(bestCard(zone(HORSE_ZONE), 'highest', COST, kit.nameIs('Horse'))),
      zone(HORSE_ZONE), zone(kit.zones.DISCARD, who), 'gain', { faceUp: true },
    ),
  ], [announce('The Horse pile is empty — no Horse arrives.')]);
}

/**
 * Falconer's "2 or more types" (see the register): Attack- or Reaction-
 * tagged, or a printed-VP dual that is not Victory-typed (Mill/Harem shape).
 */
function multiType(kit: CardKit): Expr {
  const { CARD } = kit;
  return anyOf(
    kit.hasTag(CARD, kit.tags.ATTACK),
    kit.hasTag(CARD, kit.tags.REACTION),
    allOf(
      gt(field(CARD, kit.fields.VP_F), num(0)),
      not(kit.isA(CARD, kit.types.VICTORY)),
    ),
  );
}

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, HAND, DISCARD, INPLAY } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, EMPTY_PILES, SCRATCH, DISCOUNT } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER } = kit;
  const { nameIs } = kit;

  // --- Barge: now-or-later (see the register) ------------------------------
  // kit.durationPair with an EMPTY now leaves the now-half script as exactly
  // [the park move]; the choice wraps it — 'now' pays out and never parks.
  const bargeHalves = kit.durationPair('dom_ab_barge', 'Barge', [], [
    kit.draw(OWNER, 3),
    changeVar(BUYS, num(1), OWNER),
  ]);
  const bargePark = bargeHalves[0].script[0];
  bargeHalves[0].script = [
    chooseOption('Barge: +3 Cards and +1 Buy — now, or at the start of your next turn?', [
      { id: 'barge_now', label: 'Now' },
      { id: 'barge_later', label: 'At the start of your next turn' },
    ], OWNER),
    iff(eq(CHOICE, str('barge_now')), [
      announce(OWNER, ' unloads the Barge at once.'),
      kit.draw(OWNER, 3),
      changeVar(BUYS, num(1), OWNER),
    ], [
      announce(OWNER, '’s Barge sails on — the cargo lands next turn.'),
      bargePark,
    ]),
  ];

  // --- Gatekeeper: duration + remembered-immunity strike (register) --------
  const gatekeeperHalves = kit.durationPair('dom_ab_gatekeeper', 'Gatekeeper', [
    announce(OWNER, '’s Gatekeeper takes post until their next turn.'),
  ], [
    changeVar(COINS, num(3), OWNER),
  ]);
  // The strike must not re-fire on the later half's march back — tagFilter
  // 'play' matches genuine plays only (the march is 'duration_return').
  const gatekeeperStrike: AbilityDef = {
    ...kit.onPlay('dom_ab_gatekeeper_attack', 'Papers, please', [
      forEachOpponent([
        // Remember Moat immunity for the WHOLE watch (register): the flag is
        // read by the gain watcher for as long as the card stays parked.
        setVar(GATEKEEPER_IMMUNE, getVar(IMMUNE, PLAYER), PLAYER),
        iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
          announce(PLAYER, '’s gains are watched by the Gatekeeper.'),
        ], [announce(PLAYER, ' is immune — the Gatekeeper looks away.')]),
      ]),
      // IMMUNE resets in the shared effectResolved trigger, per attack.
    ], true),
    tagFilter: 'play',
  };

  return [
    // BARGE — Duration (register: the now-or-later chooseOption).
    kit.cardDef(IDS.Barge, 'Barge', 5, 0, 0,
      'Either now or at the start of your next turn: +3 Cards and +1 Buy.',
      bargeHalves),

    // COVEN — Action – Attack. +1 Action +$2 inline; the exile half is the
    // stacked attack (Militia's pattern). Exiling is an UNTAGGED move; the
    // empty-pile branch discards the victim's exiled Curses (register).
    kit.cardDef(IDS.Coven, 'Coven', 5, 0, 0,
      '+1 Action. +$2. Each other player Exiles a Curse from the Supply. If they can’t, they discard their Exiled Curses.', [
        kit.onPlay('dom_ab_coven_main', 'Gather the circle', [
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(COINS, num(2), OWNER),
        ]),
        kit.onPlay('dom_ab_coven_attack', 'A curse, set aside for later', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(gt(countCards(zone(SUPPLY), nameIs('Curse')), num(0)), [
                announce(PLAYER, ' Exiles a Curse from the Supply.'),
                move(
                  specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Curse'))),
                  zone(SUPPLY), zone(EXILE_ZONE, PLAYER), { faceUp: true },
                ),
              ], [
                iff(gt(countCards(zone(EXILE_ZONE, PLAYER), nameIs('Curse')), num(0)), [
                  announce(PLAYER, ' discards their Exiled Curses.'),
                  kit.tmove(matching(nameIs('Curse')), zone(EXILE_ZONE, PLAYER),
                    zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
                ], [announce(PLAYER, ' has no Exiled Curses — the coven finds nothing to stir.')]),
              ]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // DISPLACE — exile a hand card (untagged move), gain a differently named
    // card costing up to its printed cost + 2 (Bridge-aware — register).
    kit.cardDef(IDS.Displace, 'Displace', 5, 0, 0,
      'Exile a card from your hand. Gain a differently named card costing up to $2 more than it.', [
        kit.onPlay('dom_ab_displace', 'Moved along', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Displace: Exile a card from your hand',
            }),
            setVar(SCRATCH, add(field(CHOICE, COST), num(2)), OWNER),
            setVar(DISPLACE_NAME, field(CHOICE, 'name'), OWNER),
            announce(OWNER, ' Exiles ', CHOICE, '.'),
            move(specific(CHOICE), zone(HAND, OWNER), zone(EXILE_ZONE, OWNER), { faceUp: true }),
            iff(gt(countCards(zone(SUPPLY), allOf(
              lte(field(CARD, COST), add(getVar(SCRATCH, OWNER), getVar(DISCOUNT))),
              neq(field(CARD, 'name'), getVar(DISPLACE_NAME, OWNER)),
            )), num(0)), [
              kit.choosePileBlock({
                who: OWNER, from: zone(SUPPLY),
                filter: allOf(
                  lte(field(CARD, COST), add(getVar(SCRATCH, OWNER), getVar(DISCOUNT))),
                  neq(field(CARD, 'name'), getVar(DISPLACE_NAME, OWNER)),
                ),
                prompt: 'Displace: gain a differently named card costing up to $2 more',
                body: [
                  announce(OWNER, ' gains ', CARD, '.'),
                  kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                ],
              }),
            ], [announce('Nothing differently named in the supply is cheap enough.')]),
          ], [announce(OWNER, ' has nothing to displace.')]),
        ]),
      ]),

    // FALCONER — Action – Reaction. The gain-to-hand is exact (printed cost
    // < 5 — register); the reaction is the buildTriggers pair below.
    kit.cardDef(IDS.Falconer, 'Falconer', 5, 0, 0,
      'Gain a card to your hand costing less than this. When any player gains a card with 2 or more types (Action, Attack, etc.), you may play this from your hand.', [
        kit.onPlay('dom_ab_falconer', 'Loosed from the glove', [
          iff(gt(countCards(zone(SUPPLY), lt(field(CARD, COST), num(5))), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY),
              filter: lt(field(CARD, COST), num(5)),
              prompt: 'Falconer: gain a card to your hand costing less than $5',
              body: [
                announce(OWNER, ' gains ', CARD, ' to their hand.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(HAND, OWNER), 'gain', { faceUp: true }),
              ],
            }),
          ], [announce('Nothing in the supply is cheap enough for the falcon.')]),
        ]),
      ]),

    // FISHERMAN — flat $5 (dynamic cost dropped — register); on-play exact.
    kit.cardDef(IDS.Fisherman, 'Fisherman', 5, 0, 0,
      '+1 Card. +1 Action. +$1. During your turns, if your discard pile is empty, this costs $3 less.', [
        kit.onPlay('dom_ab_fisherman', 'Lines in the water', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(COINS, num(1), OWNER),
        ]),
      ]),

    // GATEKEEPER — Duration – Attack (register): later +$3; the ongoing
    // exile-watch is the buildTriggers pair, gated on the parked card.
    kit.cardDef(IDS.Gatekeeper, 'Gatekeeper', 5, 0, 0,
      'At the start of your next turn, +$3. Until then, when another player gains an Action or Treasure card they don’t have an Exiled copy of, they Exile it.', [
        ...gatekeeperHalves,
        gatekeeperStrike,
      ]),

    // HUNTING LODGE — exact; the discard offer stands even on an empty hand
    // (the official ruling — register).
    kit.cardDef(IDS['Hunting Lodge'], 'Hunting Lodge', 5, 0, 0,
      '+1 Card. +2 Actions. You may discard your hand, for +5 Cards.', [
        kit.onPlay('dom_ab_hunting_lodge', 'Hounds at the door', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
          yesNo(OWNER, 'Hunting Lodge: discard your hand for +5 Cards?'),
          iff(CHOICE, [
            announce(OWNER, ' discards their hand to the lodge.'),
            kit.tmove(ALL, zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
            kit.draw(OWNER, 5),
          ]),
        ]),
      ]),

    // KILN — +$2 and arm the counter; the copy-offer is the buildTriggers
    // watcher on the next 'play'-tagged In-Play entry (register).
    kit.cardDef(IDS.Kiln, 'Kiln', 5, 0, 0,
      '+$2. The next time you play a card this turn, you may first gain a copy of it.', [
        kit.onPlay('dom_ab_kiln', 'Stoke the fire', [
          changeVar(COINS, num(2), OWNER),
          changeVar(KILN_ARMED, num(1), OWNER),
          announce(OWNER, '’s Kiln heats up — the next card played gets copied.'),
        ]),
      ]),

    // LIVERY — +$3 and count the play; the horse payout is the buildTriggers
    // watcher on qualifying gains (register).
    kit.cardDef(IDS.Livery, 'Livery', 5, 0, 0,
      '+$3. This turn, when you gain a card costing $4 or more, gain a Horse.', [
        kit.onPlay('dom_ab_livery', 'Stables for hire', [
          changeVar(COINS, num(3), OWNER),
          changeVar(LIVERY_COUNT, num(1), OWNER),
        ]),
      ]),

    // MASTERMIND — Duration: later plays a hand Action three times via the
    // Throne Room mechanism (register).
    kit.cardDef(IDS.Mastermind, 'Mastermind', 5, 0, 0,
      'At the start of your next turn, you may play an Action card from your hand three times.',
      kit.durationPair('dom_ab_mastermind', 'Mastermind', [
        announce(OWNER, '’s Mastermind begins to scheme.'),
      ], [
        iff(gt(countCards(zone(HAND, OWNER), kit.IS_ACTION_CARD), num(0)), [
          chooseCardsBlock({
            who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_ACTION_CARD,
            min: num(0), max: num(1),
            prompt: 'Mastermind: you may play an Action card from your hand three times',
            body: [
              announce(OWNER, ' plays ', CARD, ' three times with Mastermind.'),
              kit.tmove(specific(CARD), zone(HAND, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
              // Unrolled ×2 replays: the def bans 'repeat' blocks.
              ...Array.from({ length: 2 }, () => kit.playAgain(CARD)),
            ],
          }),
        ], [announce(OWNER, '’s Mastermind finds no Action to play.')]),
      ])),

    // PADDOCK — exact: reads the core EMPTY_PILES var (City's precedent).
    kit.cardDef(IDS.Paddock, 'Paddock', 5, 0, 0,
      '+$2. Gain 2 Horses. +1 Action per empty Supply pile.', [
        kit.onPlay('dom_ab_paddock', 'Open the gate', [
          changeVar(COINS, num(2), OWNER),
          ...Array.from({ length: 2 }, () => gainHorse(kit, OWNER)),
          changeVar(ACTIONS, getVar(EMPTY_PILES), OWNER),
        ]),
      ]),

    // SANCTUARY — exact; the exile is optional and untagged.
    kit.cardDef(IDS.Sanctuary, 'Sanctuary', 5, 0, 0,
      '+1 Card. +1 Action. +1 Buy. You may Exile a card from your hand.', [
        kit.onPlay('dom_ab_sanctuary', 'A quiet refuge', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(BUYS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(1),
              prompt: 'Sanctuary: you may Exile a card from your hand',
              body: [
                announce(OWNER, ' Exiles ', CARD, '.'),
                move(specific(CARD), zone(HAND, OWNER), zone(EXILE_ZONE, OWNER), { faceUp: true }),
              ],
            }),
          ]),
        ]),
      ]),

    // DESTRIER — flat $6 (dynamic cost dropped — register); on-play exact.
    kit.cardDef(IDS.Destrier, 'Destrier', 6, 0, 0,
      '+2 Cards. +1 Action. During your turns, this costs $1 less per card you’ve gained this turn.', [
        kit.onPlay('dom_ab_destrier', 'A horse of war', [
          kit.draw(OWNER, 2),
          changeVar(ACTIONS, num(1), OWNER),
        ]),
      ]),

    // WAYFARER — flat $6 (dynamic cost dropped — register); the Silver gain
    // is an optional yes/no, guarded on the pile.
    kit.cardDef(IDS.Wayfarer, 'Wayfarer', 6, 0, 0,
      '+3 Cards. You may gain a Silver. This has the same cost as the last other card gained this turn, if any.', [
        kit.onPlay('dom_ab_wayfarer', 'The long road', [
          kit.draw(OWNER, 3),
          iff(gt(countCards(zone(SUPPLY), nameIs('Silver')), num(0)), [
            yesNo(OWNER, 'Wayfarer: gain a Silver?'),
            iff(CHOICE, [
              announce(OWNER, ' gains a Silver.'),
              kit.tmove(
                specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Silver'))),
                zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
              ),
            ]),
          ]),
        ]),
      ]),

    // ANIMAL FAIR — printed cost $7; the alternative pay-by-trashing cost is
    // dropped (register). The on-play is exact.
    kit.cardDef(IDS['Animal Fair'], 'Animal Fair', 7, 0, 0,
      '+$4. +1 Buy per empty Supply pile. Instead of paying this card’s cost, you may trash an Action card from your hand.', [
        kit.onPlay('dom_ab_animal_fair', 'The fair comes to town', [
          changeVar(COINS, num(4), OWNER),
          changeVar(BUYS, getVar(EMPTY_PILES), OWNER),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, TRASH, HAND, DISCARD, INPLAY, DURATION } = kit.zones;
  const { DISCOUNT } = kit.vars;
  const { COST } = kit.fields;
  const { CARD, CHOICE, PLAYER } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer
   *  (for INPLAY entries: the player who played the card). */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /**
   * FALCONER's reaction (register): a qualifying gain by ANY player offers
   * each Falconer-holder one yes/no; a yes plays one Falconer from their
   * hand ('play'-tagged, so its gain-to-hand ability fires normally).
   */
  const falconerWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_falconer_${tag}`,
    name: `Falconer: a multi-type card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: multiType(kit),
    script: [
      forEachPlayer([
        iff(gt(countCards(zone(HAND, PLAYER), kit.nameIs('Falconer')), num(0)), [
          yesNo(PLAYER, 'Falconer: a card with 2 or more types was gained — play Falconer from your hand?'),
          iff(CHOICE, [
            announce(PLAYER, ' sends the Falconer up in response.'),
            kit.tmove(
              specific(bestCard(zone(HAND, PLAYER), 'highest', COST, kit.nameIs('Falconer'))),
              zone(HAND, PLAYER), zone(INPLAY, PLAYER), 'play', { faceUp: true },
            ),
          ]),
        ]),
      ]),
    ],
  });

  /**
   * GATEKEEPER's watch (register): while a Gatekeeper is parked in an
   * OPPONENT's DURATION zone, an Action/Treasure the victim gains with no
   * same-named card on their Exile mat is moved there (untagged; skipped
   * when a Watchtower already trashed it, and when the victim Moat-ed the
   * strike — GATEKEEPER_IMMUNE).
   */
  const gatekeeperWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_gatekeeper_${tag}`,
    name: `Gatekeeper: an Action or Treasure is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: allOf(
      anyOf(kit.isA(CARD, kit.types.ACTION), kit.isA(CARD, kit.types.TREASURE)),
      neq(cardZoneId(CARD), str(TRASH)),
      eq(getVar(GATEKEEPER_IMMUNE, GAINER), num(0)),
    ),
    script: [
      setVar(GATEKEEPER_NAME, field(CARD, 'name'), GAINER),
      forEachPlayer([
        iff(allOf(
          neq(PLAYER, GAINER),
          gt(countCards(zone(DURATION, PLAYER), kit.nameIs('Gatekeeper')), num(0)),
          eq(countCards(zone(EXILE_ZONE, GAINER),
            eq(field(CARD, 'name'), getVar(GATEKEEPER_NAME, GAINER))), num(0)),
          neq(cardZoneId(CARD), str(EXILE_ZONE)),
        ), [
          announce(GAINER, '’s gained card is Exiled by the Gatekeeper.'),
          // The specific selector's `from` is advisory — the card is taken
          // from wherever the gain actually put it (discard, deck or hand).
          move(specific(CARD), zone(DISCARD, GAINER), zone(EXILE_ZONE, GAINER), { faceUp: true }),
        ]),
      ]),
    ],
  });

  /**
   * KILN's copy-offer (register). Triggers run BEFORE abilities on the same
   * event (the engine's drain order), so Kiln's own play sees the counter
   * still un-armed and can never copy itself; the NEXT 'play'-tagged entry
   * (real plays, Falconer/Mastermind plays, Throne Room's synthetic replays)
   * consumes every armed instance, one optional copy each.
   */
  const kilnWatch = (): TriggerDef => ({
    id: 'dom_trigger_kiln_play',
    name: 'Kiln: the next card played this turn',
    event: { kind: 'cardEnterZone', zoneId: INPLAY, tag: 'play' },
    condition: gt(getVar(KILN_ARMED, GAINER), num(0)),
    script: [
      setVar(KILN_NAME, field(CARD, 'name'), GAINER),
      setVar(KILN_TODO, getVar(KILN_ARMED, GAINER), GAINER),
      setVar(KILN_ARMED, num(0), GAINER),
      {
        kind: 'repeatWhile',
        cond: gt(getVar(KILN_TODO, GAINER), num(0)),
        body: [
          changeVar(KILN_TODO, num(-1), GAINER),
          iff(gt(countCards(zone(SUPPLY),
            eq(field(CARD, 'name'), getVar(KILN_NAME, GAINER))), num(0)), [
            yesNo(GAINER, 'Kiln: gain a copy of the card you just played?'),
            iff(CHOICE, [
              announce(GAINER, '’s Kiln fires a copy of the played card.'),
              kit.tmove(
                specific(bestCard(zone(SUPPLY), 'highest', COST,
                  eq(field(CARD, 'name'), getVar(KILN_NAME, GAINER)))),
                zone(SUPPLY), zone(DISCARD, GAINER), 'gain', { faceUp: true },
              ),
            ]),
          ], [announce('The Supply holds no copy for the Kiln.')]),
        ],
      } as Block,
    ],
  });

  /**
   * LIVERY's horse payout (register): a gain whose CURRENT cost is $4+
   * (printed >= 4 + DISCOUNT) pays one Horse per Livery played this turn.
   * A Horse costs $3, so the payout can never recurse.
   */
  const liveryWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_livery_${tag}`,
    name: `Livery: a card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: allOf(
      gt(getVar(LIVERY_COUNT, GAINER), num(0)),
      gte(field(CARD, COST), add(num(4), getVar(DISCOUNT))),
    ),
    script: [
      setVar(LIVERY_TODO, getVar(LIVERY_COUNT, GAINER), GAINER),
      {
        kind: 'repeatWhile',
        cond: gt(getVar(LIVERY_TODO, GAINER), num(0)),
        body: [
          changeVar(LIVERY_TODO, num(-1), GAINER),
          gainHorse(kit, GAINER),
        ],
      } as Block,
    ],
  });

  return [
    falconerWatch('gain'),
    falconerWatch('buy'),
    gatekeeperWatch('gain'),
    gatekeeperWatch('buy'),
    kilnWatch(),
    liveryWatch('gain'),
    liveryWatch('buy'),
  ];
}

export const menagerieB: ExpansionModule = {
  id: 'menagerieB',
  setName: 'Menagerie',

  piles: [
    { name: 'Barge', cost: 5, count: 10 },
    { name: 'Coven', cost: 5, count: 10 },
    { name: 'Displace', cost: 5, count: 10 },
    { name: 'Falconer', cost: 5, count: 10 },
    { name: 'Fisherman', cost: 5, count: 10 },
    { name: 'Gatekeeper', cost: 5, count: 10 },
    { name: 'Hunting Lodge', cost: 5, count: 10 },
    { name: 'Kiln', cost: 5, count: 10 },
    { name: 'Livery', cost: 5, count: 10 },
    { name: 'Mastermind', cost: 5, count: 10 },
    { name: 'Paddock', cost: 5, count: 10 },
    { name: 'Sanctuary', cost: 5, count: 10 },
    { name: 'Destrier', cost: 6, count: 10 },
    { name: 'Wayfarer', cost: 6, count: 10 },
    // Printed cost — see the ANIMAL FAIR register entry.
    { name: 'Animal Fair', cost: 7, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Coven', 'Gatekeeper'],
  reactionNames: ['Falconer'],

  variables: [
    {
      id: GATEKEEPER_IMMUNE, name: 'Gatekeeper: Moat-ed the strike',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: GATEKEEPER_NAME, name: 'Gatekeeper: gained-card name',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: DISPLACE_NAME, name: 'Displace: exiled-card name',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: KILN_ARMED, name: 'Kiln: copies armed this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: KILN_TODO, name: 'Kiln: payout countdown',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: KILN_NAME, name: 'Kiln: played-card name',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: LIVERY_COUNT, name: 'Livery: plays this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: LIVERY_TODO, name: 'Livery: horse countdown',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  buildCards,
  buildTriggers,

  buildCleanupResets(kit: CardKit): Block[] {
    // "This turn" state fades with the turn (Kiln's armed copies, Livery's
    // play count). The Gatekeeper flags deliberately persist — they live as
    // long as the parked card, and every strike refreshes them.
    return [
      forEachPlayer([
        setVar(KILN_ARMED, num(0), kit.PLAYER),
        setVar(LIVERY_COUNT, num(0), kit.PLAYER),
      ]),
    ];
  },
};
