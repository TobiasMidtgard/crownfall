/**
 * Nocturne (Boons half) — Bard, Blessed Village, Druid, Fool, Idol, Pixie,
 * Sacred Grove, Tracker, Cursed Village, Skulk, Tormentor — plus the set's
 * SHARED INFRASTRUCTURE, owned by THIS module: the Boon and Hex decks, the
 * per-player Fate reveal zone and its receive contract, the five States
 * (as per-player flag vars), and the Spirit stock (Will-o'-Wisp + Imp).
 * All printed texts verified against the official Nocturne card list
 * (dominionstrategy.com card lists / the Rio Grande rulebook).
 *
 * ============================ RECEIVE CONTRACT =============================
 * (Sibling Nocturne modules — agents B and C — replicate EXACTLY this shape;
 * the zone/var ids below are the canonical literals.)
 *
 *   Receiving the next Boon for player P is ONE `draw` block:
 *     { kind: 'draw', who: null, count: num(1),
 *       from:  zone('dom_zone_boons'), refillFrom: zone('dom_zone_boons_used'),
 *       to:    zone('dom_zone_fate', P), faceUp: true }
 *   (the draw block's tag defaults to 'draw'; the inline refill is the
 *   printed shuffle-the-discards reshuffle). Hexes: the same block with
 *   'dom_zone_hexes' / 'dom_zone_hexes_used'. This module exports
 *   receiveBoon(who) / receiveHex(who) building exactly that node.
 *
 *   dom_zone_fate is a PER-PLAYER reveal zone (not shared — deliberately):
 *   the move's destination instance encodes WHO receives. The module trigger
 *   'dom_trigger_noct_fate_receiver' (cardEnterZone dom_zone_fate, tag
 *   'draw') stamps that per-event receiver ($owner = the fate instance's
 *   owner) into the GLOBAL string var 'dom_var_fate_receiver' — triggers see
 *   the true per-event owner, which ability frames do not once the card has
 *   moved on. Every Boon/Hex card then carries its printed effect as an
 *   ability on enterZone of dom_zone_fate with tagFilter 'draw', reads the
 *   receiver EXCLUSIVELY from dom_var_fate_receiver (never $owner), and, as
 *   its last block, parks itself on its used pile — gated on still sitting
 *   in the fate zone, so a script that already moved the card elsewhere
 *   (Druid returns the set-aside Boon) keeps custody.
 *
 *   Receiving a SPECIFIC Boon (Druid, Pixie) is a 'draw'-tagged tmove of
 *   that card into zone('dom_zone_fate', P); receiving it twice (Pixie) is
 *   move-in / move-out(untagged) / move-in again — each tagged entry fires
 *   the effect once when the event queue drains.
 *
 *   STATES are per-player number flag vars DECLARED HERE, referenced by id:
 *     dom_var_state_deluded, dom_var_state_envious, dom_var_state_miserable,
 *     dom_var_state_twice_miserable, dom_var_state_lost_in_woods.
 *   Miserable / Twice Miserable score -2 / -4 VP via buildVpTerms (EXACT).
 *
 *   SPIRITS: the shared stock zone 'dom_zone_spirits' is declared here with
 *   Will-o'-Wisp (12) and Imp (13). A sibling module that needs Ghost (or
 *   more spirits) adds its own nonSupply piles into THIS zone id.
 * ===========================================================================
 *
 * House idioms follow the earlier modules: attack halves are separate
 * `stacked: true` abilities gated per victim on IMMUNE == 0 (the shared
 * effectResolved trigger resets it), on-gain riders are 'gain'/'buy'-tagged
 * cardEnterZone watchers, dug-through cards stage in the hidden shared LOOK
 * zone, and every mandatory choice is guarded so a session can never hang.
 * TWO-PLAYER TABLE: "each other player" is the one opponent everywhere.
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - HEIRLOOMS (prominent): Fool's Lucky Coin, Pixie's Goat and Tracker's
 *    Pouch are OMITTED entirely — no Heirloom treasures exist and starting
 *    decks stay 7 Copper + 3 Estates. The printed "Heirloom: …" lines stay
 *    on the card texts for fidelity.
 *  - TYPE LINES: Boons, Hexes and Spirits are Action-typed in the
 *    one-primary-type world (no Fate/Doom/Spirit/Boon/Hex types — the type
 *    table is a shared file). Boons/Hexes never reach hands or decks, so
 *    the type is display-only; Will-o'-Wisp and Imp genuinely are Actions.
 *  - "KEEP UNTIL CLEAN-UP" (The Field's / The Forest's Gift): resolved
 *    immediately and discarded to the used pile at once — the counters they
 *    grant persist to the Buy phase anyway (they only reset at cleanup), so
 *    the effect is printed-exact; only the physical don't-recycle-yet rule
 *    is dropped (the Boon deck cycles marginally faster). The River's Gift
 *    is EXACT: a pending-draw counter pays +1 Card during that very turn's
 *    cleanup (after the redraw — a 6-card next hand for the turn player).
 *  - BLESSED VILLAGE: printed "take a Boon" shows you the Boon before the
 *    now-or-later choice; here the deferred choice receives whatever tops
 *    the deck at your next turn start (identity unknown until then), and
 *    deferred receives cap at 3 pending per player.
 *  - FOOL: "receive the Boons in any order" → received in deck order (no
 *    ordering pick). Lost in the Woods is exact: a single-holder flag, and
 *    its turn-start discard-for-a-Boon offer is the module trigger.
 *  - DRUID: exact — the 3 set-aside Boons are set aside at setup (gated on
 *    Druid being in the supply after promotion) and NEVER rotate: a Druid
 *    play fires the chosen Boon from the fate zone and returns it.
 *  - SACRED GROVE: "doesn't give +$1" is keyed by name (The Field's Gift /
 *    The Forest's Gift, the only +$1 Boons); the opponent's shared receive
 *    resolves after the owner's (printed order anyway). On a >2P table only
 *    the first accepting opponent could receive — moot on this 2-seat def.
 *  - IDOL: the odd/even Idol count for the Curse half is read when the
 *    stacked attack RESOLVES (post-window); the response window opens even
 *    on an odd (Boon) play — Giant's precedent. The Boon half is unstacked.
 *  - TORMENTOR: "no other cards in play" counts In Play plus parked
 *    DURATION cards (printed Durations remain in play), read at the stacked
 *    half's resolution.
 *  - DELUDED: the printed can't-buy-Actions rule is ANNOUNCED, not engine-
 *    enforced (the core buy action is shared-file territory — see
 *    whitelistNeeds). ENVIOUS is EXACT: returning it arms a this-turn flag
 *    and a compensating trigger drops every Silver/Gold play to $1.
 *  - MISERY: EXACT — first Misery sets Miserable (-2 VP), a second flips it
 *    to Twice Miserable (-4 VP), further Miseries do nothing.
 *  - THE SUN'S GIFT: "put the rest back in any order" — the kept cards
 *    return in their revealed order (no ordering pick).
 *  - LOCUSTS: "shares a type with it" = shares the PRIMARY type (the
 *    one-primary-type world); "cheaper" compares printed costs (Remake's
 *    precedent). Copper/Estate → Curse is exact.
 *  - PIXIE: a Throne-Roomed replay discards a second Boon but cannot trash
 *    the already-trashed copy (the trash offer is zone-guarded).
 *  - COST WINDOWS (War's $3–$4, Will-o'-Wisp's $2) are Bridge-aware
 *    (current cost), Warrior's idiom.
 */
import type {
  AbilityDef, Block, CardDef, Expr, TriggerDef, VariableDef, ZoneDef,
} from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, anyOf, bestCard, bnd, cardZoneId, changeVar,
  chooseCard, chooseCardsBlock, chooseOption, countCards, discardDownTo, eq, field,
  forEachCard, forEachOpponent, forEachPlayer, getVar, gt, gte, iff, lt, lte, matching,
  move, mul, neq, num, setVar, shuffle, specific, str, sub, topCard, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  // Kingdom piles.
  Bard: 'dom_card_bard',
  'Blessed Village': 'dom_card_blessed_village',
  Druid: 'dom_card_druid',
  Fool: 'dom_card_fool',
  Idol: 'dom_card_idol',
  Pixie: 'dom_card_pixie',
  'Sacred Grove': 'dom_card_sacred_grove',
  Tracker: 'dom_card_tracker',
  'Cursed Village': 'dom_card_cursed_village',
  Skulk: 'dom_card_skulk',
  Tormentor: 'dom_card_tormentor',
  // Spirits (non-supply stock).
  "Will-o'-Wisp": 'dom_card_will_o_wisp',
  Imp: 'dom_card_imp',
  // The 12 Boons (non-supply, one copy each, shuffled into the Boon deck).
  "The Earth's Gift": 'dom_card_boon_earth',
  "The Field's Gift": 'dom_card_boon_field',
  "The Flame's Gift": 'dom_card_boon_flame',
  "The Forest's Gift": 'dom_card_boon_forest',
  "The Moon's Gift": 'dom_card_boon_moon',
  "The Mountain's Gift": 'dom_card_boon_mountain',
  "The River's Gift": 'dom_card_boon_river',
  "The Sea's Gift": 'dom_card_boon_sea',
  "The Sky's Gift": 'dom_card_boon_sky',
  "The Sun's Gift": 'dom_card_boon_sun',
  "The Swamp's Gift": 'dom_card_boon_swamp',
  "The Wind's Gift": 'dom_card_boon_wind',
  // The 12 Hexes.
  'Bad Omens': 'dom_card_hex_bad_omens',
  Delusion: 'dom_card_hex_delusion',
  Envy: 'dom_card_hex_envy',
  Famine: 'dom_card_hex_famine',
  Fear: 'dom_card_hex_fear',
  Greed: 'dom_card_hex_greed',
  Haunting: 'dom_card_hex_haunting',
  Locusts: 'dom_card_hex_locusts',
  Misery: 'dom_card_hex_misery',
  Plague: 'dom_card_hex_plague',
  Poverty: 'dom_card_hex_poverty',
  War: 'dom_card_hex_war',
};

// --- The canonical Nocturne ids (the cross-module contract) ------------------

/** The face-down Boon deck (shuffled at setup by buildSetup). */
export const BOON_ZONE = 'dom_zone_boons';
/** Received Boons rest here face up; the deck reshuffles from it when empty. */
export const BOON_USED_ZONE = 'dom_zone_boons_used';
/** The face-down Hex deck (shuffled at setup by buildSetup). */
export const HEX_ZONE = 'dom_zone_hexes';
/** Received Hexes rest here face up. */
export const HEX_USED_ZONE = 'dom_zone_hexes_used';
/** PER-PLAYER reveal zone a received Boon/Hex resolves from (see contract). */
export const FATE_ZONE = 'dom_zone_fate';
/** Druid's three set-aside Boons (setup; they never rotate). */
export const DRUID_ZONE = 'dom_zone_druid_boons';
/** The shared Spirit stock (Will-o'-Wisp 12, Imp 13; siblings may add Ghost). */
export const SPIRIT_ZONE = 'dom_zone_spirits';

/** GLOBAL string: the player id receiving the Boon/Hex currently resolving —
 *  stamped per enter-fate event by dom_trigger_noct_fate_receiver. */
export const FATE_RECEIVER_VAR = 'dom_var_fate_receiver';

/** The five States, as per-player 0/1 flags (public — the table shows them). */
export const STATE_DELUDED = 'dom_var_state_deluded';
export const STATE_ENVIOUS = 'dom_var_state_envious';
export const STATE_MISERABLE = 'dom_var_state_miserable';
export const STATE_TWICE_MISERABLE = 'dom_var_state_twice_miserable';
export const STATE_LOST_IN_WOODS = 'dom_var_state_lost_in_woods';

/** Hidden bookkeeping. */
export const NOCT_NAME_VAR = 'dom_var_noct_name';
export const NOCT_COUNT_VAR = 'dom_var_noct_count';
export const NOCT_MARK_VAR = 'dom_var_noct_mark';
/** The River's Gift: pending +1 Card draws paid at this turn's cleanup. */
export const RIVER_VAR = 'dom_var_noct_river';
/** Blessed Village: Boons deferred to the owner's next turn start (cap 3). */
export const BLESSED_VAR = 'dom_var_noct_blessed';
/** Envious returned this turn: Silver and Gold make $1 (reset at cleanup). */
export const ENVIOUS_NOW_VAR = 'dom_var_noct_envious_now';

/** Stable dominionGame.ts phase ids (Seaside's idiom — the kit keeps them private). */
const PHASE_ACTION = 'dom_phase_action';
const PHASE_BUY = 'dom_phase_buy';

/**
 * THE RECEIVE SHAPE (see the contract header): the next Boon for `who` flips
 * off the deck into their fate zone, tagged 'draw' (the block's default),
 * with the printed reshuffle-from-used inline.
 */
export const receiveBoon = (who: Expr): Block => ({
  kind: 'draw', who: null, count: num(1),
  from: zone(BOON_ZONE), refillFrom: zone(BOON_USED_ZONE),
  to: zone(FATE_ZONE, who), faceUp: true,
});
export const receiveHex = (who: Expr): Block => ({
  kind: 'draw', who: null, count: num(1),
  from: zone(HEX_ZONE), refillFrom: zone(HEX_USED_ZONE),
  to: zone(FATE_ZONE, who), faceUp: true,
});

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

/** Gain the named basic from the supply for `who` (guarded on the pile). */
function gainNamed(
  kit: CardKit, who: Expr, name: string, note: string, empty: string,
  dest: { zoneId?: string; toPosition?: 'top' | 'bottom'; faceUp?: boolean } = {},
): Block {
  const { SUPPLY, DISCARD } = kit.zones;
  const { COST } = kit.fields;
  return iff(gt(countCards(zone(SUPPLY), kit.nameIs(name)), num(0)), [
    announce(who, note),
    kit.tmove(
      specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs(name))),
      zone(SUPPLY), zone(dest.zoneId ?? DISCARD, who), 'gain',
      { toPosition: dest.toPosition ?? 'top', faceUp: dest.faceUp ?? true },
    ),
  ], [announce(empty)]);
}

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK, DURATION } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, DISCOUNT } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER, SELF } = kit;
  const { nameIs } = kit;

  /** The receiving player — stamped per event by the fate-receiver trigger.
   *  Boon/Hex scripts use THIS, never $owner (see the contract header). */
  const RECEIVER: Expr = getVar(FATE_RECEIVER_VAR);

  /**
   * A Boon/Hex effect ability per the receive contract: fires on the
   * 'draw'-tagged entry into the fate zone, resolves for RECEIVER, then
   * parks itself on its used pile — unless a script already moved it
   * elsewhere (Druid's set-aside Boons keep their seat).
   */
  const fateAbility = (idSlug: string, name: string, usedZone: string, effect: Block[]): AbilityDef => ({
    id: `dom_ab_${idSlug}`, name: `${name} — received`,
    on: 'enterZone', zoneId: FATE_ZONE, phaseId: null, tagFilter: 'draw', condition: null,
    script: [
      announce(RECEIVER, ' receives ', SELF, '.'),
      ...effect,
      iff(eq(cardZoneId(SELF), str(FATE_ZONE)), [
        move(specific(SELF), zone(FATE_ZONE, RECEIVER), zone(usedZone), { faceUp: true }),
      ]),
    ],
  });
  const boonCard = (name: string, slug: string, text: string, effect: Block[]): CardDef =>
    kit.cardDef(IDS[name], name, 0, 0, 0, text, [
      fateAbility(`boon_${slug}`, name, BOON_USED_ZONE, effect),
    ]);
  const hexCard = (name: string, slug: string, text: string, effect: Block[]): CardDef =>
    kit.cardDef(IDS[name], name, 0, 0, 0, text, [
      fateAbility(`hex_${slug}`, name, HEX_USED_ZONE, effect),
    ]);

  /** Discard exactly N (clamped to the hand) for RECEIVER — Steward's idiom
   *  on the module's own counter, keyed to the receiver. */
  const discardExactly = (n: number, prompt: string): Block[] => [
    setVar(NOCT_COUNT_VAR, num(n), RECEIVER),
    iff(lt(zoneCount(zone(HAND, RECEIVER)), num(n)), [
      setVar(NOCT_COUNT_VAR, zoneCount(zone(HAND, RECEIVER)), RECEIVER),
    ]),
    iff(gt(getVar(NOCT_COUNT_VAR, RECEIVER), num(0)), [
      chooseCardsBlock({
        who: RECEIVER, from: zone(HAND, RECEIVER),
        min: getVar(NOCT_COUNT_VAR, RECEIVER), max: num(n),
        prompt,
        body: [
          announce(RECEIVER, ' discards ', CARD, '.'),
          kit.tmove(specific(CARD), zone(HAND, RECEIVER), zone(DISCARD, RECEIVER), 'discard', { faceUp: true }),
        ],
      }),
    ]),
  ];

  /** Locusts' typed gain: a strictly cheaper supply card of the given
   *  primary type (printed costs — see the register). */
  const locustsGain = (typeId: string): Block[] => [
    iff(gt(countCards(zone(SUPPLY), allOf(
      kit.isA(CARD, typeId),
      lt(field(CARD, COST), getVar(NOCT_COUNT_VAR, RECEIVER)),
    )), num(0)), [
      kit.choosePileBlock({
        who: RECEIVER, from: zone(SUPPLY),
        filter: allOf(
          kit.isA(CARD, typeId),
          lt(field(CARD, COST), getVar(NOCT_COUNT_VAR, RECEIVER)),
        ),
        prompt: 'Locusts: gain a cheaper card sharing a type with the trashed card',
        body: [
          announce(RECEIVER, ' gains ', CARD, '.'),
          kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, RECEIVER), 'gain', { faceUp: true }),
        ],
      }),
    ], [announce('Nothing cheaper shares its type — the locusts leave nothing behind.')]),
  ];
  /** Locusts: announce + trash the top card of RECEIVER's deck. */
  const locustsTrashTop = (): Block[] => [
    announce(RECEIVER, ' trashes ', topCard(zone(DECK, RECEIVER)), ' to the Locusts.'),
    kit.tmove(topN(1), zone(DECK, RECEIVER), zone(TRASH), 'trash', { faceUp: true }),
  ];

  /** War's $3–$4 window on the deck's top card (current cost — Warrior's idiom). */
  const warRange = (): Expr => allOf(
    gte(field(topCard(zone(DECK, RECEIVER)), COST), add(num(3), getVar(DISCOUNT))),
    lte(field(topCard(zone(DECK, RECEIVER)), COST), add(num(4), getVar(DISCOUNT))),
  );

  return [
    // ======================================================= Kingdom piles ==

    // BARD — Action – Fate. Exact.
    kit.cardDef(IDS.Bard, 'Bard', 4, 0, 0,
      '+$2. Receive a Boon.', [
        kit.onPlay('dom_ab_bard', 'A song for the road', [
          changeVar(COINS, num(2), OWNER),
          receiveBoon(OWNER),
        ]),
      ]),

    // BLESSED VILLAGE — Action – Fate. The play half is exact; the on-gain
    // now-or-later Boon is the module watcher pair (see the register: the
    // deferred Boon's identity stays unknown until it is received).
    kit.cardDef(IDS['Blessed Village'], 'Blessed Village', 4, 0, 0,
      '+1 Card. +2 Actions. When you gain this, take a Boon. Receive it now or at the start of your next turn.', [
        kit.onPlay('dom_ab_blessed_village', 'Bells over the rooftops', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(2), OWNER),
        ]),
      ]),

    // DRUID — Action – Fate. The chosen set-aside Boon fires from the fate
    // zone and RETURNS to the set-aside row (the fate ability's self-park is
    // zone-guarded, so the Boon never reaches the used pile) — the printed
    // "leaving it there". Setup lives in buildSetup, gated on the pile.
    kit.cardDef(IDS.Druid, 'Druid', 2, 0, 0,
      '+1 Buy. Receive one of the set-aside Boons, leaving it there. Setup: Set aside the top 3 Boons face up.', [
        kit.onPlay('dom_ab_druid', 'Rites under the oak', [
          changeVar(BUYS, num(1), OWNER),
          iff(gt(zoneCount(zone(DRUID_ZONE)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(DRUID_ZONE), revealed: true,
              prompt: 'Druid: receive which of the set-aside Boons?',
            }),
            kit.tmove(specific(CHOICE), zone(DRUID_ZONE), zone(FATE_ZONE, OWNER), 'draw', { faceUp: true }),
            move(specific(CHOICE), zone(FATE_ZONE, OWNER), zone(DRUID_ZONE), { faceUp: true }),
          ], [announce('No Boons were set aside — Druid was not in the supply at setup.')]),
        ]),
      ]),

    // FOOL — Action – Fate. Lost in the Woods is the single-holder flag; the
    // three Boons arrive in deck order (register). Heirloom omitted (register).
    kit.cardDef(IDS.Fool, 'Fool', 3, 0, 0,
      "If you aren't the player with Lost in the Woods, take it, take 3 Boons, and receive the Boons in any order. Heirloom: Lucky Coin.", [
        kit.onPlay('dom_ab_fool', 'Bells on his cap', [
          iff(eq(getVar(STATE_LOST_IN_WOODS, OWNER), num(1)), [
            announce(OWNER, ' is already Lost in the Woods — the Fool capers in vain.'),
          ], [
            forEachPlayer([
              iff(neq(PLAYER, OWNER), [setVar(STATE_LOST_IN_WOODS, num(0), PLAYER)]),
            ]),
            setVar(STATE_LOST_IN_WOODS, num(1), OWNER),
            announce(OWNER, ' wanders off — they take Lost in the Woods and 3 Boons.'),
            receiveBoon(OWNER),
            receiveBoon(OWNER),
            receiveBoon(OWNER),
          ]),
        ]),
      ]),

    // IDOL — Treasure – Attack – Fate. The $2 rides the coin FIELD (the
    // treasure action pays it). Odd → Boon (unstacked); even → the stacked
    // Curse half, parity re-read at resolution (register).
    kit.cardDef(IDS.Idol, 'Idol', 5, 2, 0,
      '$2. When you play this, if you then have an odd number of Idols in play, receive a Boon; if an even number, each other player gains a Curse.', [
        kit.onPlay('dom_ab_idol_boon', 'The idol smiles', [
          iff(eq(kit.mod(countCards(zone(INPLAY, OWNER), nameIs('Idol')), num(2)), num(1)), [
            announce(OWNER, "'s Idols number odd — a Boon."),
            receiveBoon(OWNER),
          ]),
        ]),
        kit.onPlay('dom_ab_idol_attack', 'The idol frowns', [
          iff(eq(kit.mod(countCards(zone(INPLAY, OWNER), nameIs('Idol')), num(2)), num(0)), [
            forEachOpponent([
              iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
                gainNamed(kit, PLAYER, 'Curse', ' gains a Curse from the frowning Idol.',
                  'The Curse pile is empty — the Idol frowns at nothing.'),
              ]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // PIXIE — Action – Fate. The top Boon is discarded UNRECEIVED; trashing
    // the Pixie receives that specific Boon twice (two tagged entries into
    // the fate zone — each fires the effect once). Heirloom omitted.
    kit.cardDef(IDS.Pixie, 'Pixie', 2, 0, 0,
      '+1 Card. +1 Action. Discard the top Boon. You may trash this to receive that Boon twice. Heirloom: Goat.', [
        kit.onPlay('dom_ab_pixie', 'A flit of luck', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          // Manual refill (the flip is not a receive, so no draw block).
          iff(allOf(
            eq(zoneCount(zone(BOON_ZONE)), num(0)),
            gt(zoneCount(zone(BOON_USED_ZONE)), num(0)),
          ), [
            move(ALL, zone(BOON_USED_ZONE), zone(BOON_ZONE), { faceUp: false }),
            shuffle(zone(BOON_ZONE)),
          ]),
          iff(gt(zoneCount(zone(BOON_ZONE)), num(0)), [
            move(topN(1), zone(BOON_ZONE), zone(BOON_USED_ZONE), { faceUp: true }),
            announce(OWNER, ' discards ', topCard(zone(BOON_USED_ZONE)), ' from the Boon deck.'),
            // A replayed (Throne-Roomed) Pixie has already left In Play —
            // the trash offer is zone-guarded (register).
            iff(eq(cardZoneId(SELF), str(INPLAY)), [
              yesNo(OWNER, 'Pixie: trash it to receive that Boon twice?'),
              iff(CHOICE, [
                announce(OWNER, ' trashes the Pixie for a double gift.'),
                kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(TRASH), 'trash', { faceUp: true }),
                kit.tmove(specific(topCard(zone(BOON_USED_ZONE))),
                  zone(BOON_USED_ZONE), zone(FATE_ZONE, OWNER), 'draw', { faceUp: true }),
                move(specific(topCard(zone(FATE_ZONE, OWNER))),
                  zone(FATE_ZONE, OWNER), zone(BOON_USED_ZONE), { faceUp: true }),
                kit.tmove(specific(topCard(zone(BOON_USED_ZONE))),
                  zone(BOON_USED_ZONE), zone(FATE_ZONE, OWNER), 'draw', { faceUp: true }),
              ]),
            ]),
          ], [announce('The Boon deck and its discards are empty — nothing to flip.')]),
        ]),
      ]),

    // SACRED GROVE — Action – Fate. The share test is by name (the two +$1
    // Boons); the opponent's receive is a second tagged entry (register).
    kit.cardDef(IDS['Sacred Grove'], 'Sacred Grove', 5, 0, 0,
      "+1 Buy. +$3. Receive a Boon. If it doesn't give +$1, each other player may receive it.", [
        kit.onPlay('dom_ab_sacred_grove', 'Under the old boughs', [
          changeVar(BUYS, num(1), OWNER),
          changeVar(COINS, num(3), OWNER),
          receiveBoon(OWNER),
          iff(gt(zoneCount(zone(FATE_ZONE, OWNER)), num(0)), [
            iff(anyOf(
              eq(field(topCard(zone(FATE_ZONE, OWNER)), 'name'), str("The Field's Gift")),
              eq(field(topCard(zone(FATE_ZONE, OWNER)), 'name'), str("The Forest's Gift")),
            ), [
              announce('The grove keeps its +$1 gift for its caller alone.'),
            ], [
              forEachOpponent([
                iff(gt(zoneCount(zone(FATE_ZONE, OWNER)), num(0)), [
                  yesNo(PLAYER, 'Sacred Grove: receive the same Boon too?'),
                  iff(CHOICE, [
                    announce(PLAYER, " shares in the grove's gift."),
                    kit.tmove(specific(topCard(zone(FATE_ZONE, OWNER))),
                      zone(FATE_ZONE, OWNER), zone(FATE_ZONE, PLAYER), 'draw', { faceUp: true }),
                  ]),
                ]),
              ]),
            ]),
          ], [announce('No Boon remained to receive.')]),
        ]),
      ]),

    // TRACKER — Action – Fate. +$1 and a Boon on play; the while-in-play
    // topdeck-your-gains offer is the module watcher pair. Heirloom omitted.
    kit.cardDef(IDS.Tracker, 'Tracker', 2, 0, 0,
      '+$1. Receive a Boon. While this is in play, when you gain a card, you may put that card onto your deck. Heirloom: Pouch.', [
        kit.onPlay('dom_ab_tracker', 'Reading the signs', [
          changeVar(COINS, num(1), OWNER),
          receiveBoon(OWNER),
        ]),
      ]),

    // CURSED VILLAGE — Action – Doom. Draw-until-6 is exact; the on-gain
    // Hex is the module watcher pair (your own gain — no attack window).
    kit.cardDef(IDS['Cursed Village'], 'Cursed Village', 5, 0, 0,
      '+2 Actions. Draw until you have 6 cards in hand. When you gain this, receive a Hex.', [
        kit.onPlay('dom_ab_cursed_village', 'Lanterns against the dark', [
          changeVar(ACTIONS, num(2), OWNER),
          setVar(NOCT_COUNT_VAR, sub(num(6), zoneCount(zone(HAND, OWNER))), OWNER),
          iff(gt(getVar(NOCT_COUNT_VAR, OWNER), num(0)), [
            kit.drawN(OWNER, getVar(NOCT_COUNT_VAR, OWNER)),
          ]),
        ]),
      ]),

    // SKULK — Action – Attack – Doom. +1 Buy immediate; the Hex half is
    // stacked (Moat-able); the on-gain Gold is a watcher.
    kit.cardDef(IDS.Skulk, 'Skulk', 4, 0, 0,
      '+1 Buy. Each other player receives the next Hex. When you gain this, gain a Gold.', [
        kit.onPlay('dom_ab_skulk_buy', 'Slipping between shadows', [
          changeVar(BUYS, num(1), OWNER),
        ]),
        kit.onPlay('dom_ab_skulk_attack', 'Something follows you home', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              announce(PLAYER, ' must receive the next Hex.'),
              receiveHex(PLAYER),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // TORMENTOR — Action – Attack – Doom. +$2 immediate; the either/or half
    // is stacked, its condition read at resolution (register): alone in
    // play (In Play + parked Durations) → an Imp; otherwise the Hex.
    kit.cardDef(IDS.Tormentor, 'Tormentor', 5, 0, 0,
      '+$2. If you have no other cards in play, gain an Imp from its pile. Otherwise, each other player receives the next Hex.', [
        kit.onPlay('dom_ab_tormentor_coins', 'A bargain struck', [
          changeVar(COINS, num(2), OWNER),
        ]),
        kit.onPlay('dom_ab_tormentor_attack', 'The price is named', [
          iff(eq(add(zoneCount(zone(INPLAY, OWNER)), zoneCount(zone(DURATION, OWNER))), num(1)), [
            iff(gt(countCards(zone(SPIRIT_ZONE), nameIs('Imp')), num(0)), [
              announce(OWNER, ' torments no one — an Imp answers instead.'),
              kit.tmove(
                specific(bestCard(zone(SPIRIT_ZONE), 'highest', COST, nameIs('Imp'))),
                zone(SPIRIT_ZONE), zone(DISCARD, OWNER), 'gain', { faceUp: true },
              ),
            ], [announce('The Imp pile is empty — no spirit answers.')]),
          ], [
            forEachOpponent([
              iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
                announce(PLAYER, ' must receive the next Hex.'),
                receiveHex(PLAYER),
              ]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // ============================================================ Spirits ==

    // WILL-O'-WISP — Action – Spirit (non-supply). The $2 window is current
    // cost (Bridge-aware, register); the reveal stays on top otherwise.
    kit.cardDef(IDS["Will-o'-Wisp"], "Will-o'-Wisp", 0, 0, 0,
      '+1 Card. +1 Action. Reveal the top card of your deck. If it costs $2 or less, put it into your hand. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_will_o_wisp', 'A pale light off the path', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          refillDeck(kit, OWNER),
          iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
            announce(OWNER, ' reveals ', topCard(zone(DECK, OWNER)), '.'),
            iff(lte(field(topCard(zone(DECK, OWNER)), COST), add(num(2), getVar(DISCOUNT))), [
              announce('It costs $2 or less — it follows the light into their hand.'),
              kit.draw(OWNER, 1),
            ], [announce('Too heavy for the wisp — it stays on top of the deck.')]),
          ], [announce(OWNER, ' has no card left to reveal.')]),
        ]),
      ]),

    // IMP — Action – Spirit (non-supply). The no-copy-in-play filter is
    // EXACT via the per-card mark pass (Cornucopia's stash idiom); playing
    // the chosen Action costs no Action (the tagged move alone).
    kit.cardDef(IDS.Imp, 'Imp', 2, 0, 0,
      "+2 Cards. You may play an Action card from your hand that you don't have a copy of in play. (This is not in the Supply.)", [
        kit.onPlay('dom_ab_imp', 'Mischief afoot', [
          kit.draw(OWNER, 2),
          forEachCard(zone(HAND, OWNER), kit.IS_ACTION_CARD, [
            setVar(NOCT_NAME_VAR, field(CARD, 'name'), OWNER),
            setVar(NOCT_MARK_VAR, num(0), CARD),
            iff(eq(countCards(zone(INPLAY, OWNER),
              eq(field(CARD, 'name'), getVar(NOCT_NAME_VAR, OWNER))), num(0)), [
              setVar(NOCT_MARK_VAR, num(1), CARD),
            ]),
          ]),
          iff(gt(countCards(zone(HAND, OWNER),
            allOf(kit.IS_ACTION_CARD, eq(getVar(NOCT_MARK_VAR, CARD), num(1)))), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER),
              filter: allOf(kit.IS_ACTION_CARD, eq(getVar(NOCT_MARK_VAR, CARD), num(1))),
              min: num(0), max: num(1),
              prompt: "Imp: play an Action you don't have a copy of in play?",
              body: [
                announce(OWNER, ' plays ', CARD, " at the Imp's urging."),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
              ],
            }),
          ], [announce(OWNER, ' has no fresh Action for the Imp.')]),
        ]),
      ]),

    // ============================================================== Boons ==

    boonCard("The Earth's Gift", 'earth',
      'You may discard a Treasure to gain a card costing up to $4.', [
        iff(gt(countCards(zone(HAND, RECEIVER), kit.IS_TREASURE_CARD), num(0)), [
          chooseCardsBlock({
            who: RECEIVER, from: zone(HAND, RECEIVER), filter: kit.IS_TREASURE_CARD,
            min: num(0), max: num(1),
            prompt: "The Earth's Gift: discard a Treasure to gain a card costing up to $4?",
            body: [
              announce(RECEIVER, ' discards ', CARD, ' to the earth.'),
              kit.tmove(specific(CARD), zone(HAND, RECEIVER), zone(DISCARD, RECEIVER), 'discard', { faceUp: true }),
              iff(gt(countCards(zone(SUPPLY),
                lte(field(CARD, COST), add(num(4), getVar(DISCOUNT)))), num(0)), [
                kit.choosePileBlock({
                  who: RECEIVER, from: zone(SUPPLY),
                  filter: lte(field(CARD, COST), add(num(4), getVar(DISCOUNT))),
                  prompt: "The Earth's Gift: gain a card costing up to $4",
                  body: [
                    announce(RECEIVER, ' gains ', CARD, '.'),
                    kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, RECEIVER), 'gain', { faceUp: true }),
                  ],
                }),
              ], [announce('Nothing in the supply is cheap enough.')]),
            ],
          }),
        ], [announce(RECEIVER, ' holds no Treasure for the earth.')]),
      ]),

    // Keep-until-Clean-up: resolved immediately (register) — the counters
    // persist to the Buy phase anyway.
    boonCard("The Field's Gift", 'field',
      '+1 Action. +$1. (Keep this until Clean-up.)', [
        changeVar(ACTIONS, num(1), RECEIVER),
        changeVar(COINS, num(1), RECEIVER),
      ]),

    boonCard("The Flame's Gift", 'flame',
      'You may trash a card from your hand.', [
        iff(gt(zoneCount(zone(HAND, RECEIVER)), num(0)), [
          chooseCardsBlock({
            who: RECEIVER, from: zone(HAND, RECEIVER), min: num(0), max: num(1),
            prompt: "The Flame's Gift: trash a card from your hand?",
            body: [
              announce(RECEIVER, ' feeds ', CARD, ' to the flames.'),
              kit.tmove(specific(CARD), zone(HAND, RECEIVER), zone(TRASH), 'trash', { faceUp: true }),
            ],
          }),
        ]),
      ]),

    boonCard("The Forest's Gift", 'forest',
      '+1 Buy. +$1. (Keep this until Clean-up.)', [
        changeVar(BUYS, num(1), RECEIVER),
        changeVar(COINS, num(1), RECEIVER),
      ]),

    boonCard("The Moon's Gift", 'moon',
      'Look through your discard pile. You may put a card from it onto your deck.', [
        iff(gt(zoneCount(zone(DISCARD, RECEIVER)), num(0)), [
          chooseCardsBlock({
            who: RECEIVER, from: zone(DISCARD, RECEIVER), min: num(0), max: num(1), revealed: true,
            prompt: "The Moon's Gift: put a card from your discard pile onto your deck?",
            body: [
              announce(RECEIVER, ' lifts ', CARD, ' back onto their deck by moonlight.'),
              move(specific(CARD), zone(DISCARD, RECEIVER), zone(DECK, RECEIVER),
                { toPosition: 'top', faceUp: false }),
            ],
          }),
        ], [announce('The discard pile is empty — the moon finds nothing.')]),
      ]),

    boonCard("The Mountain's Gift", 'mountain',
      'Gain a Silver.', [
        gainNamed(kit, RECEIVER, 'Silver', ' gains a Silver from the mountain.',
          'The Silver pile is empty — the mountain gives nothing.'),
      ]),

    // EXACT via the pending counter: +1 Card during this turn's cleanup,
    // after the redraw (see buildCleanupResets and the register).
    boonCard("The River's Gift", 'river',
      '+1 Card at the end of this turn. (Keep this until Clean-up.)', [
        announce(RECEIVER, ' will draw +1 Card at the end of this turn.'),
        changeVar(RIVER_VAR, num(1), RECEIVER),
      ]),

    boonCard("The Sea's Gift", 'sea',
      '+1 Card.', [
        kit.drawN(RECEIVER, num(1)),
      ]),

    boonCard("The Sky's Gift", 'sky',
      'You may discard 3 cards to gain a Gold.', [
        iff(gte(zoneCount(zone(HAND, RECEIVER)), num(3)), [
          yesNo(RECEIVER, "The Sky's Gift: discard 3 cards to gain a Gold?"),
          iff(CHOICE, [
            chooseCardsBlock({
              who: RECEIVER, from: zone(HAND, RECEIVER), min: num(3), max: num(3),
              prompt: "The Sky's Gift: discard 3 cards",
              body: [
                announce(RECEIVER, ' discards ', CARD, ' to the sky.'),
                kit.tmove(specific(CARD), zone(HAND, RECEIVER), zone(DISCARD, RECEIVER), 'discard', { faceUp: true }),
              ],
            }),
            gainNamed(kit, RECEIVER, 'Gold', ' gains a Gold from the sky.',
              'The Gold pile is empty — the sky gives nothing.'),
          ]),
        ], [announce(RECEIVER, ' has fewer than 3 cards — the sky passes over.')]),
      ]),

    // The kept cards return in revealed order (register).
    boonCard("The Sun's Gift", 'sun',
      'Look at the top 4 cards of your deck. Discard any number of them and put the rest back in any order.', [
        ...takeTop(kit, RECEIVER, zone(LOOK), false),
        ...takeTop(kit, RECEIVER, zone(LOOK), false),
        ...takeTop(kit, RECEIVER, zone(LOOK), false),
        ...takeTop(kit, RECEIVER, zone(LOOK), false),
        iff(gt(zoneCount(zone(LOOK)), num(0)), [
          chooseCardsBlock({
            who: RECEIVER, from: zone(LOOK), min: num(0), max: num(4), revealed: true,
            prompt: "The Sun's Gift: discard any number of the top 4 cards of your deck",
            body: [
              announce(RECEIVER, ' discards ', CARD, ' under the sun.'),
              kit.tmove(specific(CARD), zone(LOOK), zone(DISCARD, RECEIVER), 'discard', { faceUp: true }),
            ],
          }),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            move(ALL, zone(LOOK), zone(DECK, RECEIVER), { toPosition: 'top', faceUp: false }),
          ]),
        ], [announce(RECEIVER, ' has no cards for the sun to warm.')]),
      ]),

    boonCard("The Swamp's Gift", 'swamp',
      "Gain a Will-o'-Wisp from its pile.", [
        iff(gt(countCards(zone(SPIRIT_ZONE), nameIs("Will-o'-Wisp")), num(0)), [
          announce(RECEIVER, " gains a Will-o'-Wisp from the swamp."),
          kit.tmove(
            specific(bestCard(zone(SPIRIT_ZONE), 'highest', COST, nameIs("Will-o'-Wisp"))),
            zone(SPIRIT_ZONE), zone(DISCARD, RECEIVER), 'gain', { faceUp: true },
          ),
        ], [announce("The Will-o'-Wisp pile is empty — the swamp lies dark.")]),
      ]),

    boonCard("The Wind's Gift", 'wind',
      '+2 Cards. Discard 2 cards.', [
        kit.drawN(RECEIVER, num(2)),
        ...discardExactly(2, "The Wind's Gift: discard 2 cards"),
      ]),

    // ============================================================== Hexes ==

    hexCard('Bad Omens', 'bad_omens',
      "Put your deck into your discard pile. Look through it and put 2 Coppers from it onto your deck (or reveal you can't).", [
        iff(gt(zoneCount(zone(DECK, RECEIVER)), num(0)), [
          announce(RECEIVER, "'s deck collapses into their discard pile."),
          kit.tmove(ALL, zone(DECK, RECEIVER), zone(DISCARD, RECEIVER), 'discard', { faceUp: true }),
        ]),
        // The whole discard is searched (the deck just joined it) — printed.
        ...Array.from({ length: 2 }, () =>
          iff(gt(countCards(zone(DISCARD, RECEIVER), nameIs('Copper')), num(0)), [
            move(specific(bestCard(zone(DISCARD, RECEIVER), 'highest', COST, nameIs('Copper'))),
              zone(DISCARD, RECEIVER), zone(DECK, RECEIVER), { toPosition: 'top', faceUp: false }),
          ])),
        iff(lt(zoneCount(zone(DECK, RECEIVER)), num(2)), [
          announce(RECEIVER, ' reveals they cannot find 2 Coppers.'),
        ], [announce(RECEIVER, ' starts over on 2 Coppers.')]),
      ]),

    hexCard('Delusion', 'delusion',
      "If you don't have Deluded or Envious, take Deluded.", [
        iff(allOf(
          eq(getVar(STATE_DELUDED, RECEIVER), num(0)),
          eq(getVar(STATE_ENVIOUS, RECEIVER), num(0)),
        ), [
          setVar(STATE_DELUDED, num(1), RECEIVER),
          announce(RECEIVER, ' takes Deluded.'),
        ], [announce(RECEIVER, ' is already Deluded or Envious — nothing changes.')]),
      ]),

    hexCard('Envy', 'envy',
      "If you don't have Deluded or Envious, take Envious.", [
        iff(allOf(
          eq(getVar(STATE_DELUDED, RECEIVER), num(0)),
          eq(getVar(STATE_ENVIOUS, RECEIVER), num(0)),
        ), [
          setVar(STATE_ENVIOUS, num(1), RECEIVER),
          announce(RECEIVER, ' takes Envious.'),
        ], [announce(RECEIVER, ' is already Deluded or Envious — nothing changes.')]),
      ]),

    hexCard('Famine', 'famine',
      'Reveal the top 3 cards of your deck. Discard the Actions. Shuffle the rest into your deck.', [
        ...takeTop(kit, RECEIVER, zone(LOOK), true),
        ...takeTop(kit, RECEIVER, zone(LOOK), true),
        ...takeTop(kit, RECEIVER, zone(LOOK), true),
        forEachCard(zone(LOOK), null, [
          announce(RECEIVER, ' reveals ', CARD, ' to the famine.'),
        ]),
        iff(gt(countCards(zone(LOOK), kit.IS_ACTION_CARD), num(0)), [
          announce('The famine takes the Actions.'),
          kit.tmove(matching(kit.IS_ACTION_CARD), zone(LOOK), zone(DISCARD, RECEIVER), 'discard', { faceUp: true }),
        ]),
        iff(gt(zoneCount(zone(LOOK)), num(0)), [
          move(ALL, zone(LOOK), zone(DECK, RECEIVER), { faceUp: false }),
          shuffle(zone(DECK, RECEIVER)),
        ]),
      ]),

    hexCard('Fear', 'fear',
      "If you have at least 5 cards in hand, discard an Action or Treasure (or reveal you can't).", [
        iff(gte(zoneCount(zone(HAND, RECEIVER)), num(5)), [
          iff(gt(countCards(zone(HAND, RECEIVER),
            anyOf(kit.IS_ACTION_CARD, kit.IS_TREASURE_CARD)), num(0)), [
            chooseCardsBlock({
              who: RECEIVER, from: zone(HAND, RECEIVER),
              filter: anyOf(kit.IS_ACTION_CARD, kit.IS_TREASURE_CARD),
              min: num(1), max: num(1),
              prompt: 'Fear: discard an Action or Treasure',
              body: [
                announce(RECEIVER, ' discards ', CARD, ' in fear.'),
                kit.tmove(specific(CARD), zone(HAND, RECEIVER), zone(DISCARD, RECEIVER), 'discard', { faceUp: true }),
              ],
            }),
          ], [announce(RECEIVER, ' reveals a hand with no Action or Treasure.')]),
        ], [announce(RECEIVER, ' has fewer than 5 cards in hand — Fear passes.')]),
      ]),

    hexCard('Greed', 'greed',
      'Gain a Copper onto your deck.', [
        gainNamed(kit, RECEIVER, 'Copper', ' gains a Copper onto their deck, greedily.',
          'The Copper pile is empty — greed goes hungry.',
          { zoneId: DECK, toPosition: 'top', faceUp: false }),
      ]),

    hexCard('Haunting', 'haunting',
      'If you have at least 4 cards in hand, put one of them onto your deck.', [
        iff(gte(zoneCount(zone(HAND, RECEIVER)), num(4)), [
          chooseCardsBlock({
            who: RECEIVER, from: zone(HAND, RECEIVER), min: num(1), max: num(1),
            prompt: 'Haunting: put a card from your hand onto your deck',
            body: [
              announce(RECEIVER, ' returns a card to their deck, haunted.'),
              move(specific(CARD), zone(HAND, RECEIVER), zone(DECK, RECEIVER),
                { toPosition: 'top', faceUp: false }),
            ],
          }),
        ], [announce(RECEIVER, ' has fewer than 4 cards in hand — the ghosts pass by.')]),
      ]),

    hexCard('Locusts', 'locusts',
      "Trash the top card of your deck. If it's Copper or Estate, gain a Curse. Otherwise, gain a cheaper card that shares a type with it.", [
        refillDeck(kit, RECEIVER),
        iff(eq(zoneCount(zone(DECK, RECEIVER)), num(0)), [
          announce(RECEIVER, ' has no card for the locusts to devour.'),
        ], [
          setVar(NOCT_COUNT_VAR, field(topCard(zone(DECK, RECEIVER)), COST), RECEIVER),
          iff(anyOf(
            eq(field(topCard(zone(DECK, RECEIVER)), 'name'), str('Copper')),
            eq(field(topCard(zone(DECK, RECEIVER)), 'name'), str('Estate')),
          ), [
            ...locustsTrashTop(),
            gainNamed(kit, RECEIVER, 'Curse', ' gains a Curse from the swarm.',
              'The Curse pile is empty — the swarm moves on.'),
          ], [
            // Branch on the primary type BEFORE trashing (the top changes).
            iff(kit.isA(topCard(zone(DECK, RECEIVER)), kit.types.ACTION), [
              ...locustsTrashTop(), ...locustsGain(kit.types.ACTION),
            ], [
              iff(kit.isA(topCard(zone(DECK, RECEIVER)), kit.types.TREASURE), [
                ...locustsTrashTop(), ...locustsGain(kit.types.TREASURE),
              ], [
                iff(kit.isA(topCard(zone(DECK, RECEIVER)), kit.types.VICTORY), [
                  ...locustsTrashTop(), ...locustsGain(kit.types.VICTORY),
                ], [
                  ...locustsTrashTop(), ...locustsGain(kit.types.CURSE),
                ]),
              ]),
            ]),
          ]),
        ]),
      ]),

    // EXACT: first Misery → Miserable (-2 VP); a second flips it to Twice
    // Miserable (-4 VP); further Miseries change nothing (buildVpTerms).
    hexCard('Misery', 'misery',
      'If this is your first Misery this game, take Miserable. Otherwise, flip it over to Twice Miserable.', [
        iff(allOf(
          eq(getVar(STATE_MISERABLE, RECEIVER), num(0)),
          eq(getVar(STATE_TWICE_MISERABLE, RECEIVER), num(0)),
        ), [
          setVar(STATE_MISERABLE, num(1), RECEIVER),
          announce(RECEIVER, ' takes Miserable (-2 VP).'),
        ], [
          iff(eq(getVar(STATE_MISERABLE, RECEIVER), num(1)), [
            setVar(STATE_MISERABLE, num(0), RECEIVER),
            setVar(STATE_TWICE_MISERABLE, num(1), RECEIVER),
            announce(RECEIVER, ' flips to Twice Miserable (-4 VP).'),
          ], [announce(RECEIVER, ' is already Twice Miserable — misery has no depths left.')]),
        ]),
      ]),

    hexCard('Plague', 'plague',
      'Gain a Curse to your hand.', [
        gainNamed(kit, RECEIVER, 'Curse', ' gains a Curse to their hand — plague.',
          'The Curse pile is empty — the plague passes.',
          { zoneId: HAND, faceUp: true }),
      ]),

    hexCard('Poverty', 'poverty',
      'Discard down to 3 cards in hand.', [
        discardDownTo({
          who: RECEIVER, from: zone(HAND, RECEIVER), to: zone(DISCARD, RECEIVER),
          keep: num(3),
          prompt: 'Poverty: discard down to 3 cards in hand',
        }),
      ]),

    hexCard('War', 'war',
      'Reveal cards from your deck until revealing one costing $3 or $4. Trash it and discard the rest.', [
        setVar(NOCT_COUNT_VAR, num(0), RECEIVER),
        {
          kind: 'repeatWhile',
          cond: eq(getVar(NOCT_COUNT_VAR, RECEIVER), num(0)),
          body: [
            refillDeck(kit, RECEIVER),
            iff(eq(zoneCount(zone(DECK, RECEIVER)), num(0)), [
              announce(RECEIVER, ' has no more cards to reveal — the war ends.'),
              setVar(NOCT_COUNT_VAR, num(1), RECEIVER),
            ], [
              announce(RECEIVER, ' reveals ', topCard(zone(DECK, RECEIVER)), ' to the war.'),
              iff(warRange(), [
                announce('It falls in battle — trashed.'),
                kit.tmove(topN(1), zone(DECK, RECEIVER), zone(TRASH), 'trash', { faceUp: true }),
                setVar(NOCT_COUNT_VAR, num(1), RECEIVER),
              ], [
                move(topN(1), zone(DECK, RECEIVER), zone(LOOK), { faceUp: true }),
              ]),
            ]),
          ],
        } as Block,
        iff(gt(zoneCount(zone(LOOK)), num(0)), [
          kit.tmove(ALL, zone(LOOK), zone(DISCARD, RECEIVER), 'discard', { faceUp: true }),
        ]),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY } = kit.zones;
  const { COINS } = kit.vars;
  const { COINS_F } = kit.fields;
  const { CARD, CHOICE } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer
   *  (for the fate zone: the receiver). */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** BLESSED VILLAGE gained: a Boon, now or at the next turn's start. */
  const blessedWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_noct_blessed_${tag}`,
    name: `Blessed Village: ${tag === 'buy' ? 'bought' : 'gained'} — a Boon, now or later`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Blessed Village'),
    script: [
      chooseOption('Blessed Village: receive the Boon now, or at the start of your next turn?', [
        { id: 'bv_now', label: 'Receive it now' },
        { id: 'bv_later', label: 'At the start of my next turn' },
      ], GAINER),
      iff(eq(CHOICE, str('bv_now')), [
        receiveBoon(GAINER),
      ], [
        announce(GAINER, ' will receive a Boon at the start of their next turn.'),
        changeVar(BLESSED_VAR, num(1), GAINER),
      ]),
    ],
  });

  /** CURSED VILLAGE gained: receive a Hex (your own gain — no window). */
  const cursedWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_noct_cursed_${tag}`,
    name: `Cursed Village: ${tag === 'buy' ? 'bought' : 'gained'} — receive a Hex`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Cursed Village'),
    script: [
      announce(GAINER, ' must receive a Hex for the Cursed Village.'),
      receiveHex(GAINER),
    ],
  });

  /** SKULK gained: gain a Gold. */
  const skulkWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_noct_skulk_${tag}`,
    name: `Skulk: ${tag === 'buy' ? 'bought' : 'gained'} — a Gold rides along`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Skulk'),
    script: [
      gainNamed(kit, GAINER, 'Gold', ' gains a Gold with the Skulk.',
        'The Gold pile is empty — the Skulk arrives alone.'),
    ],
  });

  /** TRACKER in play: every gain may be put onto the deck (withheld when the
   *  gain already left for the trash/supply or landed on the deck). */
  const trackerWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_noct_tracker_${tag}`,
    name: `Tracker: a card is ${tag === 'buy' ? 'bought' : 'gained'} — onto the deck?`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        gt(countCards(zone(INPLAY, GAINER), kit.nameIs('Tracker')), num(0)),
        neq(cardZoneId(CARD), str(TRASH)),
        neq(cardZoneId(CARD), str(SUPPLY)),
        neq(cardZoneId(CARD), str(DECK)),
      ), [
        yesNo(GAINER, 'Tracker: put the card you just gained onto your deck?'),
        iff(CHOICE, [
          announce(GAINER, ' tracks ', CARD, ' onto their deck.'),
          move(specific(CARD), zone(DISCARD, GAINER), zone(DECK, GAINER),
            { toPosition: 'top', faceUp: false }),
        ]),
      ]),
    ],
  });

  return [
    // THE RECEIVE CONTRACT's receiver stamp (see the module header): global
    // triggers see the true per-event $owner, and triggers run before the
    // arriving card's own ability for the same event — so every Boon/Hex
    // ability reads an accurate receiver even in multi-receive scripts.
    {
      id: 'dom_trigger_noct_fate_receiver',
      name: 'Fate: a Boon or Hex arrives — note who receives it',
      event: { kind: 'cardEnterZone', zoneId: FATE_ZONE, tag: 'draw' },
      condition: null,
      script: [setVar(FATE_RECEIVER_VAR, bnd('$owner'))],
    },

    blessedWatch('gain'),
    blessedWatch('buy'),
    // The deferred Blessed Village Boon(s) arrive at the owner's next
    // action-phase start (cap 3 pending — the register).
    {
      id: 'dom_trigger_noct_blessed_due',
      name: 'Blessed Village: the deferred Boon arrives',
      event: { kind: 'phaseStart', phaseId: PHASE_ACTION },
      condition: gt(getVar(BLESSED_VAR, CURRENT), num(0)),
      script: [
        announce(CURRENT, ' receives the deferred Blessed Village Boon.'),
        ...Array.from({ length: 3 }, (_, i) =>
          iff(gte(getVar(BLESSED_VAR, CURRENT), num(i + 1)), [receiveBoon(CURRENT)])),
        setVar(BLESSED_VAR, num(0), CURRENT),
      ],
    },

    cursedWatch('gain'),
    cursedWatch('buy'),
    skulkWatch('gain'),
    skulkWatch('buy'),
    trackerWatch('gain'),
    trackerWatch('buy'),

    // DELUDED returns at the Buy phase start. DEVIATION (register): the
    // can't-buy-Actions rule is announced, not engine-enforced.
    {
      id: 'dom_trigger_noct_deluded_return',
      name: 'Deluded: the delusion lifts at the Buy phase',
      event: { kind: 'phaseStart', phaseId: PHASE_BUY },
      condition: eq(getVar(STATE_DELUDED, CURRENT), num(1)),
      script: [
        setVar(STATE_DELUDED, num(0), CURRENT),
        announce(CURRENT, ' returns Deluded — they may buy no Action cards this turn (table-enforced; see the module notes).'),
      ],
    },
    // ENVIOUS returns at the Buy phase start and arms the this-turn flag…
    {
      id: 'dom_trigger_noct_envious_return',
      name: 'Envy: the envy takes hold at the Buy phase',
      event: { kind: 'phaseStart', phaseId: PHASE_BUY },
      condition: eq(getVar(STATE_ENVIOUS, CURRENT), num(1)),
      script: [
        setVar(STATE_ENVIOUS, num(0), CURRENT),
        setVar(ENVIOUS_NOW_VAR, num(1), CURRENT),
        announce(CURRENT, ' returns Envious — Silver and Gold make $1 this turn.'),
      ],
    },
    // …and the compensating trigger makes every Silver/Gold play worth
    // exactly $1 (the treasure action already paid the coin field). EXACT.
    {
      id: 'dom_trigger_noct_envious_bite',
      name: 'Envious: Silver and Gold make $1',
      event: { kind: 'cardEnterZone', zoneId: INPLAY, tag: 'play' },
      condition: anyOf(kit.nameIs('Silver'), kit.nameIs('Gold')),
      script: [
        iff(eq(getVar(ENVIOUS_NOW_VAR, GAINER), num(1)), [
          announce(GAINER, "'s ", CARD, ' makes only $1 (Envious).'),
          changeVar(COINS, sub(num(1), field(CARD, COINS_F)), GAINER),
        ]),
      ],
    },

    // LOST IN THE WOODS (Fool's state): at the holder's turn start, they may
    // discard a card to receive a Boon.
    {
      id: 'dom_trigger_noct_lost_in_woods',
      name: 'Lost in the Woods: discard a card to receive a Boon?',
      event: { kind: 'phaseStart', phaseId: PHASE_ACTION },
      condition: eq(getVar(STATE_LOST_IN_WOODS, CURRENT), num(1)),
      script: [
        iff(gt(zoneCount(zone(HAND, CURRENT)), num(0)), [
          chooseCardsBlock({
            who: CURRENT, from: zone(HAND, CURRENT), min: num(0), max: num(1),
            prompt: 'Lost in the Woods: discard a card to receive a Boon?',
            body: [
              announce(CURRENT, ' discards ', CARD, ' deep in the woods.'),
              kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(DISCARD, CURRENT), 'discard', { faceUp: true }),
              receiveBoon(CURRENT),
            ],
          }),
        ]),
      ],
    },
  ];
}

export const nocturneBoons: ExpansionModule = {
  id: 'nocturneBoons',
  setName: 'Nocturne',

  piles: [
    { name: 'Druid', cost: 2, count: 10 },
    { name: 'Pixie', cost: 2, count: 10 },
    { name: 'Tracker', cost: 2, count: 10 },
    { name: 'Fool', cost: 3, count: 10 },
    { name: 'Bard', cost: 4, count: 10 },
    { name: 'Blessed Village', cost: 4, count: 10 },
    { name: 'Skulk', cost: 4, count: 10 },
    { name: 'Cursed Village', cost: 5, count: 10 },
    { name: 'Idol', cost: 5, count: 10 },
    { name: 'Sacred Grove', cost: 5, count: 10 },
    { name: 'Tormentor', cost: 5, count: 10 },
  ],

  ids: IDS,

  // Hex-givers attack opponents (Skulk / Tormentor); Idol curses them.
  attackNames: ['Skulk', 'Tormentor', 'Idol'],
  treasureNames: ['Idol'],

  variables: [
    {
      id: FATE_RECEIVER_VAR, name: 'Fate: current receiver',
      scope: 'global', type: 'string', initial: '', hidden: true,
    },
    // The five States — public flags, shown by the table.
    { id: STATE_DELUDED, name: 'Deluded', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: STATE_ENVIOUS, name: 'Envious', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: STATE_MISERABLE, name: 'Miserable', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: STATE_TWICE_MISERABLE, name: 'Twice Miserable', scope: 'perPlayer', type: 'number', initial: 0 },
    { id: STATE_LOST_IN_WOODS, name: 'Lost in the Woods', scope: 'perPlayer', type: 'number', initial: 0 },
    // Hidden bookkeeping.
    {
      id: NOCT_NAME_VAR, name: 'Nocturne: name stash',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: NOCT_COUNT_VAR, name: 'Nocturne: scratch counter',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: NOCT_MARK_VAR, name: "Imp: playable mark",
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
    {
      id: RIVER_VAR, name: "The River's Gift: pending end-of-turn draws",
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: BLESSED_VAR, name: 'Blessed Village: deferred Boons',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: ENVIOUS_NOW_VAR, name: 'Envious: active this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  zones: [
    {
      id: BOON_ZONE, name: 'Boons',
      owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
    },
    {
      id: BOON_USED_ZONE, name: 'Boons (received)',
      owner: 'shared', visibility: 'all', layout: 'stack', area: 'center',
    },
    {
      id: HEX_ZONE, name: 'Hexes',
      owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
    },
    {
      id: HEX_USED_ZONE, name: 'Hexes (received)',
      owner: 'shared', visibility: 'all', layout: 'stack', area: 'center',
    },
    {
      id: FATE_ZONE, name: 'Fate',
      owner: 'perPlayer', visibility: 'all', layout: 'row', area: 'player',
    },
    {
      id: DRUID_ZONE, name: "Druid's Boons",
      owner: 'shared', visibility: 'all', layout: 'row', area: 'center',
    },
    // INTEGRATION NOTE: dom_zone_spirits itself is declared by
    // nocturneNight (which stocks it); this module only references the id.
  ] as ZoneDef[],

  nonSupply: [
    {
      zoneId: BOON_ZONE,
      piles: [
        "The Earth's Gift", "The Field's Gift", "The Flame's Gift", "The Forest's Gift",
        "The Moon's Gift", "The Mountain's Gift", "The River's Gift", "The Sea's Gift",
        "The Sky's Gift", "The Sun's Gift", "The Swamp's Gift", "The Wind's Gift",
      ].map((name) => ({ name, cost: 0, count: 1 })),
    },
    {
      zoneId: HEX_ZONE,
      piles: [
        'Bad Omens', 'Delusion', 'Envy', 'Famine', 'Fear', 'Greed',
        'Haunting', 'Locusts', 'Misery', 'Plague', 'Poverty', 'War',
      ].map((name) => ({ name, cost: 0, count: 1 })),
    },
    // INTEGRATION NOTE: the Spirit stock (zone + Will-o'-Wisp/Imp cards)
    // is DECLARED BY nocturneNight — this module only references the ids.
  ],

  buildCards,
  buildTriggers,

  buildSetup(kit: CardKit): Block[] {
    // The nonSupply deck spawner never shuffles — the Boon/Hex decks get
    // their printed setup shuffle here (before hands are dealt). Druid's
    // three set-aside Boons are gated on the pile actually being in the
    // supply (the promotion has already run; pickKingdom keeps this block).
    return [
      shuffle(zone(BOON_ZONE)),
      shuffle(zone(HEX_ZONE)),
      iff(gt(countCards(zone(kit.zones.SUPPLY), kit.nameIs('Druid')), num(0)), [
        announce('Druid sets aside the top 3 Boons.'),
        move(topN(3), zone(BOON_ZONE), zone(DRUID_ZONE), { faceUp: true }),
      ]),
    ];
  },

  buildVpTerms(kit: CardKit): Block[] {
    // Miserable / Twice Miserable: -2 / -4 VP at every recount ($player is
    // bound by the recount's forEachPlayer). EXACT.
    return [
      changeVar(kit.vars.VP, mul(getVar(STATE_MISERABLE, kit.PLAYER), num(-2)), kit.PLAYER),
      changeVar(kit.vars.VP, mul(getVar(STATE_TWICE_MISERABLE, kit.PLAYER), num(-4)), kit.PLAYER),
    ];
  },

  buildCleanupResets(kit: CardKit): Block[] {
    // The River's Gift pays its +1 Card at THIS turn's cleanup (after the
    // redraw — the turn player nets a 6-card next hand, printed-exact; an
    // off-turn receiver draws the extra card into their waiting hand).
    // Envious's this-turn flag fades with the turn.
    return [
      forEachPlayer([
        iff(gt(getVar(RIVER_VAR, kit.PLAYER), num(0)), [
          announce(kit.PLAYER, " draws for The River's Gift."),
          kit.drawN(kit.PLAYER, getVar(RIVER_VAR, kit.PLAYER)),
          setVar(RIVER_VAR, num(0), kit.PLAYER),
        ]),
        setVar(ENVIOUS_NOW_VAR, num(0), kit.PLAYER),
      ]),
    ];
  },
};
