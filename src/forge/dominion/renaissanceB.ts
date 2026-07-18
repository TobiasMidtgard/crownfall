/**
 * Renaissance (part B) — Research, Silk Merchant, Old Witch, Recruiter,
 * Scepter, Scholar, Sculptor, Seer, Spices, Swashbuckler, Treasurer, Villain.
 *
 * The set's banked-resource cards speak the core banks directly: Villagers
 * (dom_var_villagers — Recruiter / Silk Merchant / Sculptor) and Coffers
 * (dom_var_coffers — Silk Merchant / Spices / Swashbuckler / Villain); the
 * core ships the spend actions and status-strip buttons for both. House
 * idioms follow the Base/Intrigue/Seaside modules: attack halves are separate
 * `stacked: true` abilities gated per victim on IMMUNE == 0 (the shared
 * effectResolved trigger resets it), look-at effects stage through the hidden
 * shared LOOK zone, and every mandatory choice is guarded so a session can
 * never hang on an empty prompt.
 *
 * ARTIFACTS (the Key / the Treasure Chest): the five Renaissance artifact
 * variables are declared ONCE, by the sibling module renaissanceA — this
 * module only reads/writes 'dom_var_artifact_key' (Treasurer) and
 * 'dom_var_artifact_chest' (Swashbuckler) by their literal ids and must NOT
 * redeclare them. Contract: each var is a GLOBAL STRING holding the holder's
 * player id ('' = unclaimed); taking an artifact is one setVar (it leaves the
 * previous holder automatically). This module ships the two standing
 * triggers for ITS artifacts: the Key pays the holder +$1 at their turn
 * start; the Treasure Chest gains the holder a Gold at their buy-phase
 * start. Integrator: register renaissanceA (the declarations) alongside —
 * renaissanceB alone references undeclared variables and will not validate.
 *
 * TWO-PLAYER TABLE: the def is strictly two seats, so "each other player"
 * (Old Witch / Villain) is the one opponent (forEachOpponent).
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - SCEPTER (prominent): printed, Scepter is a TREASURE played in the buy
 *    phase. This group's type roster fixes it as an ACTION (a card here has
 *    ONE primary type; treasureNames carries only Spices), so it costs an
 *    Action to play and Throne Room CAN replay it (impossible on paper).
 *    "An Action you played this turn that's still in play" is approximated
 *    as "an Action in your In Play area": a Duration played THIS turn has
 *    already parked in the DURATION zone and is NOT targetable (paper: it
 *    is), while a Duration back from its off-turn IS targetable — replaying
 *    it re-runs its on-play and parks it for another round trip (the kit's
 *    documented Throne-x-Duration contract). Other Scepters are excluded
 *    from the replay targets (paper-exact — a Scepter cannot replay a
 *    Scepter — and it forecloses player-driven replay loops). With no legal
 *    target the card resolves as +$2 without a prompt.
 *  - RESEARCH: the set-aside cards wait face down on a per-player Research
 *    mat zone (dom_zone_research — the Church mat idiom) instead of under
 *    the card, riding kit.durationPair. With SEVERAL Researches parked, the
 *    FIRST later-half to resolve scoops the WHOLE mat (per-mat, not
 *    per-card tracking — Church/Native Village's precedent; all later
 *    halves fire at the same turn start, so the outcome is identical). The
 *    "per $1 it costs" loop is unrolled to RESEARCH_CAP = 11 set-asides
 *    (Colony, the registry's priciest coin cost — no repeat blocks). Mat
 *    cards still score their printed VP at every recount (buildVpTerms), so
 *    a game ending mid-duration loses nothing.
 *  - SILK MERCHANT on-trash: the +1 Coffers / +1 Villager go to the CURRENT
 *    player — the one doing the trashing (Nomads' precedent; matches the
 *    official ruling "the player trashing it takes the bonus").
 *  - PRINTED COSTS: "per $1 it costs" (Research / Recruiter), Seer's
 *    $2-to-$4 band and Villain's "costing $2 or more" read the printed COST
 *    field (Bishop/Ritual/Swindler's precedent — a live Bridge discount is
 *    ignored); potion cost halves are likewise ignored (the house cost
 *    idiom). Sculptor's gain cap IS Bridge-aware (cost <= $4 + DISCOUNT,
 *    kit.gainFromSupply's shape).
 *  - SEER: the reveal stages publicly through the shared LOOK zone and the
 *    put-back goes on top in a FIXED order (no reorder primitive — Sentry /
 *    Doctor's precedent).
 *  - OLD WITCH: the victim's "may trash a Curse from their hand" resolves
 *    INSIDE the attack, per victim (no separate reaction window — the group
 *    spec ships no reaction here); the just-gained Curse is in the discard,
 *    so only hand Curses qualify, as printed.
 *  - VILLAIN: "(or reveals they can't)" is an announcement (Shanty Town's
 *    idiom).
 *  - TREASURER: "gain a Treasure from the trash" is a 'gain'-tagged move out
 *    of the shared TRASH zone straight to the hand, so on-gain watchers
 *    (Watchtower, Spices' own rider…) fire exactly as printed.
 */
import type { Block, CardDef, Expr, TriggerDef, ZoneDef } from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, bestCard, bnd, changeVar, chooseCard, chooseCardsBlock,
  chooseOption, countCards, eq, field, forEachOpponent, getVar, gt, gte, iff, lte, matching, move,
  neq, not, num, setVar, shuffle, specific, str, topN, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Research: 'dom_card_research',
  'Silk Merchant': 'dom_card_silk_merchant',
  'Old Witch': 'dom_card_old_witch',
  Recruiter: 'dom_card_recruiter',
  Scepter: 'dom_card_scepter',
  Scholar: 'dom_card_scholar',
  Sculptor: 'dom_card_sculptor',
  Seer: 'dom_card_seer',
  Spices: 'dom_card_spices',
  Swashbuckler: 'dom_card_swashbuckler',
  Treasurer: 'dom_card_treasurer',
  Villain: 'dom_card_villain',
};

/** The Research mat — set-aside cards wait here until the owner's next turn. */
export const RESEARCH_ZONE = 'dom_zone_research';

/**
 * The artifact holder variables — DECLARED BY renaissanceA (global string,
 * holder's player id, '' = unclaimed; see the header). Referenced here by
 * their literal ids only.
 */
export const ARTIFACT_KEY = 'dom_var_artifact_key';
export const ARTIFACT_CHEST = 'dom_var_artifact_chest';

/**
 * Research's documented set-aside cap: the per-$1 loop is unrolled to this
 * many steps (Colony's $11 — the registry's priciest coin cost; the def bans
 * repeat blocks).
 */
export const RESEARCH_CAP = 11;

/** The buy phase's id (stable dominionGame.ts literal — Seaside's idiom). */
const PHASE_BUY = 'dom_phase_buy';

/**
 * The official empty-deck reshuffle for effects that TAKE cards off the deck
 * without the `draw` block: when `who`'s deck is empty, flip the discard
 * face-down into it and give it a seeded shuffle.
 */
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
 * Move the top card of `who`'s deck to `to` (reshuffling first when the deck
 * is empty). Unrolled per card, so "top 3" keeps the official per-card
 * reshuffle timing (Sentry's idiom).
 */
function takeTop(kit: CardKit, who: Expr, to: ReturnType<typeof zone>, faceUp: boolean): Block[] {
  const deck = zone(kit.zones.DECK, who);
  return [
    refillDeck(kit, who),
    iff(gt(zoneCount(deck), num(0)), [
      move(topN(1), deck, to, { faceUp }),
    ]),
  ];
}

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD, INPLAY, LOOK } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, SCRATCH, DISCOUNT, COFFERS, VILLAGERS } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER } = kit;

  // Fresh nodes per use (expressions are stored data — factories keep every
  // site's block tree independent).

  /** "$card is a Curse" (Old Witch's self-heal). */
  const isCurse = (): Expr => kit.isA(CARD, kit.types.CURSE);
  /** Villain's target: printed cost $2 or more (register). */
  const costly = (): Expr => gte(field(CARD, COST), num(2));
  /** Seer's band: printed cost $2 to $4 (register). */
  const seerBand = (): Expr => allOf(gte(field(CARD, COST), num(2)), lte(field(CARD, COST), num(4)));
  /** Sculptor's Bridge-aware gain cap (the house gain idiom). */
  const sculptable = (): Expr => lte(field(CARD, COST), add(num(4), getVar(DISCOUNT)));
  /** Scepter's replay targets: Actions in play, never another Scepter (register). */
  const replayable = (): Expr => allOf(kit.IS_ACTION_CARD, not(kit.nameIs('Scepter')));

  return [
    // RESEARCH — Action–Duration (behavioral, like every kit.durationPair
    // card). The set-asides wait on the per-player Research mat; the later
    // half scoops the whole mat (deviation register). The trash is mandatory
    // (guarded); the per-$1 loop is unrolled to RESEARCH_CAP.
    kit.cardDef(IDS.Research, 'Research', 4, 0, 0,
      '+1 Action. Trash a card from your hand. Per $1 it costs, set aside a card from your deck face down. At the start of your next turn, put those cards into your hand.',
      kit.durationPair('dom_ab_research', 'Research', [
        changeVar(ACTIONS, num(1), OWNER),
        iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
          chooseCard({
            who: OWNER, from: zone(HAND, OWNER),
            prompt: 'Research: trash a card from your hand (set aside 1 card per $1 it costs)',
          }),
          setVar(SCRATCH, field(CHOICE, COST), OWNER),
          announce(OWNER, ' trashes ', CHOICE, ' for Research.'),
          kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
          announce(OWNER, ' sets aside a card per $1 it cost.'),
          ...Array.from({ length: RESEARCH_CAP }, (): Block => iff(gt(getVar(SCRATCH, OWNER), num(0)), [
            changeVar(SCRATCH, num(-1), OWNER),
            refillDeck(kit, OWNER),
            iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
              move(topN(1), zone(DECK, OWNER), zone(RESEARCH_ZONE, OWNER), { faceUp: false }),
            ]),
          ])),
        ], [announce(OWNER, ' has no card to trash — nothing is set aside.')]),
      ], [
        iff(gt(zoneCount(zone(RESEARCH_ZONE, OWNER)), num(0)), [
          announce(OWNER, ' takes the cards Research set aside into their hand.'),
          move(ALL, zone(RESEARCH_ZONE, OWNER), zone(HAND, OWNER), { faceUp: true }),
        ], [announce('Research had nothing set aside.')]),
      ])),

    // SILK MERCHANT — the play half is exact; the on-gain / on-trash rider
    // is the pair of buildTriggers watchers (trash pays CURRENT — register).
    kit.cardDef(IDS['Silk Merchant'], 'Silk Merchant', 4, 0, 0,
      '+2 Cards. +1 Buy. When you gain or trash this, +1 Coffers and +1 Villager.', [
        kit.onPlay('dom_ab_silk_merchant', 'Bolts of samite', [
          kit.draw(OWNER, 2),
          changeVar(BUYS, num(1), OWNER),
        ]),
      ]),

    // OLD WITCH — Action–Attack. The draw is immediate; the Curse half is
    // stacked (Witch's pattern) and carries the victim's optional self-heal
    // INSIDE the attack (register): the just-gained Curse sits in the
    // discard, so only hand Curses can be trashed, as printed.
    kit.cardDef(IDS['Old Witch'], 'Old Witch', 5, 0, 0,
      '+3 Cards. Each other player gains a Curse and may trash a Curse from their hand.', [
        kit.onPlay('dom_ab_old_witch_draw', 'Cobwebbed grimoire', [kit.draw(OWNER, 3)]),
        kit.onPlay('dom_ab_old_witch_attack', 'The oldest curse', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(gt(countCards(zone(SUPPLY), kit.nameIs('Curse')), num(0)), [
                announce(PLAYER, ' gains a Curse.'),
                kit.tmove(
                  specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Curse'))),
                  zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true },
                ),
              ], [announce('The Curse pile is empty — no new curse.')]),
              iff(gt(countCards(zone(HAND, PLAYER), isCurse()), num(0)), [
                chooseCardsBlock({
                  who: PLAYER, from: zone(HAND, PLAYER), filter: isCurse(),
                  min: num(0), max: num(1),
                  prompt: 'Old Witch: you may trash a Curse from your hand',
                  body: [
                    announce(PLAYER, ' trashes a Curse from their hand.'),
                    kit.tmove(specific(CARD), zone(HAND, PLAYER), zone(TRASH), 'trash', { faceUp: true }),
                  ],
                }),
              ]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // RECRUITER — exact: the trash is mandatory (guarded), the printed cost
    // rides SCRATCH across the move (Bishop's pattern), Villagers bank into
    // the core spend-a-villager surface.
    kit.cardDef(IDS.Recruiter, 'Recruiter', 5, 0, 0,
      '+2 Cards. Trash a card from your hand. +1 Villager per $1 it costs.', [
        kit.onPlay('dom_ab_recruiter', 'Muster the halls', [
          kit.draw(OWNER, 2),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Recruiter: trash a card from your hand (+1 Villager per $1 it costs)',
            }),
            setVar(SCRATCH, field(CHOICE, COST), OWNER),
            announce(OWNER, ' trashes ', CHOICE, '.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            changeVar(VILLAGERS, getVar(SCRATCH, OWNER), OWNER),
            announce(OWNER, ' banks +1 Villager per $1 it cost.'),
          ], [announce(OWNER, ' has no one left to recruit.')]),
        ]),
      ]),

    // SCEPTER — PROMINENT DEVIATION (header register): Action-typed here.
    // With no replayable Action in play it resolves as +$2 without a prompt;
    // otherwise choose +$2 or replay (kit.playAgain — the Throne mechanism).
    kit.cardDef(IDS.Scepter, 'Scepter', 5, 0, 0,
      "Choose one: +$2; or replay an Action card you played this turn that's still in play.", [
        kit.onPlay('dom_ab_scepter', 'The royal instrument', [
          iff(gt(countCards(zone(INPLAY, OWNER), replayable()), num(0)), [
            chooseOption('Scepter: choose one', [
              { id: 'scepter_coins', label: '+$2' },
              { id: 'scepter_replay', label: 'Replay an Action you played this turn' },
            ], OWNER),
            iff(eq(CHOICE, str('scepter_coins')), [
              changeVar(COINS, num(2), OWNER),
            ], [
              chooseCardsBlock({
                who: OWNER, from: zone(INPLAY, OWNER), filter: replayable(),
                min: num(1), max: num(1),
                prompt: 'Scepter: replay an Action you played this turn',
                body: [
                  announce(OWNER, ' replays ', CARD, ' with the Scepter.'),
                  kit.playAgain(CARD),
                ],
              }),
            ]),
          ], [
            changeVar(COINS, num(2), OWNER),
            announce(OWNER, ' has no Action in play to replay — the Scepter pays +$2.'),
          ]),
        ]),
      ]),

    // SCHOLAR — exact. The whole-hand discard is one tagged sweep (each card
    // fires 'discard' watchers, e.g. Tunnel), then the draw's inline
    // reshuffle recycles it.
    kit.cardDef(IDS.Scholar, 'Scholar', 5, 0, 0,
      'Discard your hand. +7 Cards.', [
        kit.onPlay('dom_ab_scholar', 'Burn the syllabus', [
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            announce(OWNER, ' discards their hand.'),
            kit.tmove(ALL, zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
          ]),
          kit.draw(OWNER, 7),
        ]),
      ]),

    // SCULPTOR — the gain lands in the HAND ('gain'-tagged, so on-gain
    // watchers fire); a Treasure banks +1 Villager. Bridge-aware cap.
    kit.cardDef(IDS.Sculptor, 'Sculptor', 5, 0, 0,
      "Gain a card to your hand costing up to $4. If it's a Treasure, +1 Villager.", [
        kit.onPlay('dom_ab_sculptor', 'Shaped from clay', [
          iff(gt(countCards(zone(SUPPLY), sculptable()), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY), filter: sculptable(),
              prompt: 'Sculptor: gain a card costing up to $4 into your hand',
              body: [
                announce(OWNER, ' gains ', CARD, ' into their hand.'),
                kit.tmove(specific(CARD), zone(SUPPLY), zone(HAND, OWNER), 'gain', { faceUp: true }),
                iff(kit.isA(CARD, kit.types.TREASURE), [
                  changeVar(VILLAGERS, num(1), OWNER),
                  announce(OWNER, ' banks +1 Villager — it is a Treasure.'),
                ]),
              ],
            }),
          ], [announce('Nothing in the supply costs $4 or less.')]),
        ]),
      ]),

    // SEER — the reveal stages publicly through LOOK; the $2-$4 band joins
    // the hand with the 'draw' cause (Advisor's idiom); the rest go back on
    // top in a fixed order (register).
    kit.cardDef(IDS.Seer, 'Seer', 5, 0, 0,
      '+1 Card. +1 Action. Reveal the top 3 cards of your deck. Put the ones costing from $2 to $4 into your hand. Put the rest back on top.', [
        kit.onPlay('dom_ab_seer', 'Read the leaves', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          ...takeTop(kit, OWNER, zone(LOOK), true),
          iff(gt(zoneCount(zone(LOOK)), num(0)), [
            announce(OWNER, ' reveals the top cards of their deck.'),
            iff(gt(countCards(zone(LOOK), seerBand()), num(0)), [
              announce(OWNER, ' puts the cards costing $2 to $4 into their hand.'),
              kit.tmove(matching(seerBand()), zone(LOOK), zone(HAND, OWNER), 'draw', { faceUp: true }),
            ]),
            iff(gt(zoneCount(zone(LOOK)), num(0)), [
              move(ALL, zone(LOOK), zone(DECK, OWNER), { toPosition: 'top', faceUp: false }),
            ]),
          ], [announce(OWNER, ' has no cards left to reveal.')]),
        ]),
      ]),

    // SPICES — Treasure (treasureNames): the $2 is the coin FIELD paid by
    // the core treasure action (Astrolabe's precedent); the on-play ability
    // adds the +1 Buy. The on-gain +2 Coffers is the buildTriggers watcher.
    kit.cardDef(IDS.Spices, 'Spices', 5, 2, 0,
      '$2. +1 Buy. When you gain this, +2 Coffers.', [
        kit.onPlay('dom_ab_spices', 'A fragrant cargo', [
          changeVar(BUYS, num(1), OWNER),
        ]),
      ]),

    // SWASHBUCKLER — exact, including the printed order: the +3 Cards may
    // reshuffle the discard away BEFORE the emptiness check. Reaching 4+
    // Coffers takes the Treasure Chest (a no-op when already held).
    kit.cardDef(IDS.Swashbuckler, 'Swashbuckler', 5, 0, 0,
      '+3 Cards. If your discard pile has any cards in it: +1 Coffers, then if you have at least 4 Coffers tokens, take the Treasure Chest.', [
        kit.onPlay('dom_ab_swashbuckler', 'Over the rail', [
          kit.draw(OWNER, 3),
          iff(gt(zoneCount(zone(DISCARD, OWNER)), num(0)), [
            changeVar(COFFERS, num(1), OWNER),
            announce(OWNER, ' takes +1 Coffers — the discard pile is not empty.'),
            iff(gte(getVar(COFFERS, OWNER), num(4)), [
              iff(neq(getVar(ARTIFACT_CHEST), OWNER), [
                setVar(ARTIFACT_CHEST, OWNER),
                announce(OWNER, ' takes the Treasure Chest.'),
              ]),
            ]),
          ]),
        ]),
      ]),

    // TREASURER — exact: three options, each guarded/whiffing politely. The
    // trash-gain is a 'gain'-tagged move from the shared TRASH to the hand
    // (register); the Key is one setVar on the artifact holder var.
    kit.cardDef(IDS.Treasurer, 'Treasurer', 5, 0, 0,
      '+$3. Choose one: Trash a Treasure from your hand; or gain a Treasure from the trash to your hand; or take the Key.', [
        kit.onPlay('dom_ab_treasurer', "The crown's ledger", [
          changeVar(COINS, num(3), OWNER),
          chooseOption('Treasurer: choose one', [
            { id: 'treasurer_trash', label: 'Trash a Treasure from your hand' },
            { id: 'treasurer_gain', label: 'Gain a Treasure from the trash to your hand' },
            { id: 'treasurer_key', label: 'Take the Key (+$1 at the start of your turns)' },
          ], OWNER),
          iff(eq(CHOICE, str('treasurer_trash')), [
            iff(gt(countCards(zone(HAND, OWNER), kit.IS_TREASURE_CARD), num(0)), [
              chooseCard({
                who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_TREASURE_CARD,
                prompt: 'Treasurer: trash a Treasure from your hand',
              }),
              announce(OWNER, ' trashes ', CHOICE, '.'),
              kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
            ], [announce(OWNER, ' has no Treasure to trash.')]),
          ], [
            iff(eq(CHOICE, str('treasurer_gain')), [
              iff(gt(countCards(zone(TRASH), kit.IS_TREASURE_CARD), num(0)), [
                chooseCard({
                  who: OWNER, from: zone(TRASH), filter: kit.IS_TREASURE_CARD, revealed: true,
                  prompt: 'Treasurer: gain a Treasure from the trash to your hand',
                }),
                announce(OWNER, ' gains ', CHOICE, ' from the trash.'),
                kit.tmove(specific(CHOICE), zone(TRASH), zone(HAND, OWNER), 'gain', { faceUp: true }),
              ], [announce('The trash holds no Treasure to reclaim.')]),
            ], [
              setVar(ARTIFACT_KEY, OWNER),
              announce(OWNER, ' takes the Key.'),
            ]),
          ]),
        ]),
      ]),

    // VILLAIN — Action–Attack. The Coffers are immediate; only the discard
    // demand goes through the stack (Militia's pattern). Printed-cost $2+
    // filter; "reveals they can't" is an announcement (register).
    kit.cardDef(IDS.Villain, 'Villain', 5, 0, 0,
      '+2 Coffers. Each other player with 5 or more cards in hand discards one costing $2 or more (or reveals they can not).', [
        kit.onPlay('dom_ab_villain_coffers', 'Seed money', [
          changeVar(COFFERS, num(2), OWNER),
          announce(OWNER, ' takes +2 Coffers.'),
        ]),
        kit.onPlay('dom_ab_villain_attack', 'A dastardly scheme', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              iff(gte(zoneCount(zone(HAND, PLAYER)), num(5)), [
                iff(gt(countCards(zone(HAND, PLAYER), costly()), num(0)), [
                  chooseCard({
                    who: PLAYER, from: zone(HAND, PLAYER), filter: costly(),
                    prompt: 'Villain: discard a card costing $2 or more',
                  }),
                  announce(PLAYER, ' discards ', CHOICE, ' to the Villain.'),
                  kit.tmove(specific(CHOICE), zone(HAND, PLAYER), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
                ], [announce(PLAYER, ' reveals a hand with nothing costing $2 or more.')]),
              ], [announce(PLAYER, ' has fewer than 5 cards in hand — the Villain moves on.')]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, DISCARD } = kit.zones;
  const { COINS, COFFERS, VILLAGERS } = kit.vars;
  const { COST } = kit.fields;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer. */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** SILK MERCHANT's on-gain rider ('gain' AND 'buy' — a bought card is gained). */
  const silkGainWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_silk_merchant_${tag}`,
    name: `Silk Merchant: ${tag === 'buy' ? 'bought' : 'gained'} — +1 Coffers +1 Villager`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Silk Merchant'),
    script: [
      changeVar(COFFERS, num(1), GAINER),
      changeVar(VILLAGERS, num(1), GAINER),
      announce(GAINER, ' takes +1 Coffers and +1 Villager from the Silk Merchant.'),
    ],
  });

  /** SPICES' on-gain rider (same tag pair). */
  const spicesGainWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_spices_${tag}`,
    name: `Spices: ${tag === 'buy' ? 'bought' : 'gained'} — +2 Coffers`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: kit.nameIs('Spices'),
    script: [
      changeVar(COFFERS, num(2), GAINER),
      announce(GAINER, ' takes +2 Coffers from the Spices.'),
    ],
  });

  return [
    silkGainWatch('gain'),
    silkGainWatch('buy'),
    // SILK MERCHANT trashed: the bonus goes to the CURRENT player — the one
    // doing the trashing (Nomads' precedent; deviation register).
    {
      id: 'dom_trigger_silk_merchant_trash',
      name: 'Silk Merchant: trashed — +1 Coffers +1 Villager',
      event: { kind: 'cardEnterZone', zoneId: null, tag: 'trash' },
      condition: kit.nameIs('Silk Merchant'),
      script: [
        changeVar(COFFERS, num(1), CURRENT),
        changeVar(VILLAGERS, num(1), CURRENT),
        announce('The trashed Silk Merchant pays +1 Coffers and +1 Villager.'),
      ],
    },
    spicesGainWatch('gain'),
    spicesGainWatch('buy'),

    // THE KEY (artifact — held via Treasurer): +$1 at the holder's turn
    // start. The var holds the holder's player id; '' matches nobody.
    {
      id: 'dom_trigger_artifact_key',
      name: 'The Key: +$1 at the holder\'s turn start',
      event: { kind: 'turnStart' },
      condition: eq(getVar(ARTIFACT_KEY), CURRENT),
      script: [
        changeVar(COINS, num(1), CURRENT),
        announce(CURRENT, ' takes +$1 from the Key.'),
      ],
    },

    // THE TREASURE CHEST (artifact — held via Swashbuckler): at the start
    // of the holder's buy phase, gain a Gold (whiffs politely when empty).
    {
      id: 'dom_trigger_artifact_chest',
      name: 'The Treasure Chest: a Gold at the holder\'s buy phase',
      event: { kind: 'phaseStart', phaseId: PHASE_BUY },
      condition: eq(getVar(ARTIFACT_CHEST), CURRENT),
      script: [
        iff(gt(countCards(zone(SUPPLY), kit.nameIs('Gold')), num(0)), [
          announce(CURRENT, ' opens the Treasure Chest and gains a Gold.'),
          kit.tmove(
            specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Gold'))),
            zone(SUPPLY), zone(DISCARD, CURRENT), 'gain', { faceUp: true },
          ),
        ], [announce('The Treasure Chest is grand, but the Gold pile is empty.')]),
      ],
    },
  ];
}

export const renaissanceB: ExpansionModule = {
  id: 'renaissanceB',
  setName: 'Renaissance',

  piles: [
    { name: 'Research', cost: 4, count: 10 },
    { name: 'Silk Merchant', cost: 4, count: 10 },
    { name: 'Old Witch', cost: 5, count: 10 },
    { name: 'Recruiter', cost: 5, count: 10 },
    { name: 'Scepter', cost: 5, count: 10 },
    { name: 'Scholar', cost: 5, count: 10 },
    { name: 'Sculptor', cost: 5, count: 10 },
    { name: 'Seer', cost: 5, count: 10 },
    { name: 'Spices', cost: 5, count: 10 },
    { name: 'Swashbuckler', cost: 5, count: 10 },
    { name: 'Treasurer', cost: 5, count: 10 },
    { name: 'Villain', cost: 5, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Old Witch', 'Villain'],
  treasureNames: ['Spices'],

  zones: [
    {
      id: RESEARCH_ZONE, name: 'Research',
      owner: 'perPlayer', visibility: 'owner', layout: 'row', area: 'player',
    },
  ] as ZoneDef[],

  buildCards,
  buildTriggers,

  buildVpTerms(kit: CardKit): Block[] {
    return [
      // Cards Research set aside still score their printed VP (a game
      // ending mid-duration loses nothing — the Church mat's precedent).
      changeVar(kit.vars.VP,
        kit.sumCards(zone(RESEARCH_ZONE, kit.PLAYER), kit.fields.VP_F), kit.PLAYER),
    ];
  },
};
