/**
 * Adventures (part A) — THE TAVERN + TRAVELLERS HALF, plus the set's shared
 * infrastructure, owned by THIS module: the per-player Tavern mat
 * (dom_zone_tavern) and the shared Traveller stock (dom_zone_travellers,
 * 5 copies of each of the eight upgrades as non-supply stock).
 *
 * Kingdom piles (10 each): Page, Peasant, Ratcatcher, Coin of the Realm,
 * Guide, Duplicate, Miser, Distant Lands, Royal Carriage, Transmogrify,
 * Wine Merchant. Non-supply Travellers: Treasure Hunter, Warrior, Hero,
 * Champion (Page's line) and Soldier, Fugitive, Disciple, Teacher
 * (Peasant's line). All printed texts verified against the official card
 * list (dominionstrategy.com card lists / the Rio Grande rulebook PDF).
 *
 * THE RESERVE MECHANIC (built once here):
 *  - Playing a Reserve card resolves its immediate half, then a 'play'-tagged
 *    tmove parks it on the owner's Tavern mat (no existing trigger watches
 *    'play' outside In Play, so the parking cannot double-fire anything).
 *  - CALLING is NOT playing (printed): every call moves the card off the mat
 *    with an UNTAGGED move, so the card's own onPlay half stays silent.
 *  - Turn-start calls (Ratcatcher / Guide / Transmogrify / Teacher) are
 *    phaseStart-of-action abilities ON the card while it sits on the mat:
 *    an optional yes/no per parked copy, per turn.
 *  - Reactive calls (Coin of the Realm / Royal Carriage after an Action,
 *    Duplicate on a gain) are module triggers watching the 'play' (resp.
 *    'gain'+'buy') causes — see the deviations register for the timing.
 *  - Wine Merchant's "end of your Buy phase" is the cleanup-phase START
 *    (the manual phase boundary), with COINS >= 2 still unspent.
 *
 * TRAVELLERS (the exchange ladder):
 *  - "When you discard this from play, you may exchange it" fires at the
 *    START of the owner's cleanup phase while the copy is still in In Play
 *    (before the sweep): an optional yes/no per copy, offered only while the
 *    next card's stock still has copies. Exchanging returns the card to its
 *    home (the SUPPLY pile for Page/Peasant, the Traveller stock otherwise)
 *    and takes the next line card into the owner's discard — both moves
 *    UNTAGGED: an exchange is neither a gain nor a discard (printed), so no
 *    gain/discard watcher fires on it.
 *  - Page -> Treasure Hunter -> Warrior -> Hero -> Champion;
 *    Peasant -> Soldier -> Fugitive -> Disciple -> Teacher.
 *
 * TWO-PLAYER TABLE: "the player to your right" (Treasure Hunter) and "each
 * other player" (Warrior / Soldier) are the one opponent.
 *
 * DEVIATIONS register (details in the per-card comments):
 *  - DISTANT LANDS (prominent): the spec makes it Victory-typed
 *    (victoryNames), so the core play action (Actions only) refuses it.
 *    The module ships a phaseStart-of-action offer instead: at the start of
 *    the owner's action phase, any Distant Lands in hand may be played (one
 *    Action each, 'play'-tagged, so its onPlay half parks it on the mat).
 *    Printed it is an Action–Reserve–Victory playable any time during the
 *    action phase; here the play window is the phase start only, Throne
 *    Room / Disciple cannot replay it, and Champion's +1-Action aura
 *    ignores it (not Action-typed). Worth 4 VP ONLY on the mat
 *    (buildVpTerms; printed VP field 0 everywhere else).
 *  - REACTIVE CALL TIMING: "directly after resolving an Action" fires at
 *    the Action's PLAY moment (the engine's trigger window on the
 *    'play'-tagged In-Play entry — triggers run before the played card's
 *    own ability). +2 Actions (Coin of the Realm) is order-insensitive; a
 *    Royal Carriage replay is a queued synthetic 'play' event, so it
 *    resolves AFTER the natural resolution — net "played twice", Throne
 *    Room's exact shape. Calls also trigger on synthetic replays (Throne
 *    Room / Disciple / a replay itself), which matches the printed
 *    per-resolution call windows.
 *  - ROYAL CARRIAGE never offers on this module's self-parking Reserve
 *    cards or Champion (by printed timing they have left play before the
 *    call window). Durations from other modules ARE offered: the replay
 *    runs their now-half again and they park once (the Throne Room
 *    contract), instead of the printed keep-the-Carriage-out tracking.
 *  - CHAMPION (prominent): parks on the Tavern mat FOREVER (printed: stays
 *    in play). Its two auras are module triggers gated on a Champion
 *    sitting on the owner's mat: +1 Action per Champion whenever the owner
 *    plays an Action ('play'-tag watcher, synthetic replays included), and
 *    attack immunity via IMMUNE — armed when another player's Attack card
 *    is played, and re-armed after each resolution while another Attack is
 *    still pending (the core per-attack reset runs first, so chained
 *    attacks stay waved off). Champion holders never need to reveal a Moat.
 *  - TEACHER (prominent): parks PERMANENTLY on the mat and calling does NOT
 *    move it into play (printed: a call moves it to play and cleanup
 *    discards it, costing a replay per token move) — so Teacher here may
 *    place a token every turn while parked. Its "+1 tokens" are the
 *    per-player pile-name string vars dom_var_tok_card / _action / _coin /
 *    _buy DECLARED BY THE adventuresTokens MODULE (agent C) and only
 *    referenced here: Teacher sets one to an Action supply pile's name
 *    (a pile none of your four tokens is on). Without adventuresTokens
 *    registered the merged def fails validation, and without its triggers
 *    the placed names grant nothing.
 *  - TREASURE HUNTER: "per card the player to your right gained on their
 *    last turn" is the Goatherd-style counter: every 'gain'/'buy'-tagged
 *    move counts toward the CURRENT player (off-turn gains — a Witch curse
 *    — attribute to the turn player), reset at that player's next
 *    action-phase start. Silver gains are unrolled to a cap of 10.
 *  - WARRIOR: per-Traveller strikes unrolled to a cap of 8 Travellers in
 *    play; the $3–$4 trash window is Bridge-aware (current cost), the
 *    reveal stages through the shared LOOK zone.
 *  - DUPLICATE: "costing up to $6" is Bridge-aware (current cost); gaining
 *    the copy is a real 'gain', so remaining Duplicates get their printed
 *    nested call windows.
 *  - EXCHANGE HOMES: Page/Peasant return to the SUPPLY zone even when their
 *    pile was never promoted there (a Black-Market copy strands a
 *    single-card pile — harmless).
 *  - MISER: mat Coppers stay on the mat for the rest of the game (printed).
 */
import type {
  AbilityDef, Block, CardDef, Expr, TriggerDef, VariableDef, ZoneDef,
} from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, anyOf, bestCard, bnd, cardZoneId, changeVar, chooseCard,
  chooseCardsBlock, chooseOption, countCards, eq, field, forEachCard, forEachOpponent,
  forEachPlayer, getVar, gt, gte, iff, lte, matching, move, mul, neq, nextPlayer, num, setVar,
  shuffle, specific, str, topN, zone, zoneCount, STACK_SIZE, STACK_TOP, cardOwner,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  // Kingdom piles.
  Page: 'dom_card_page',
  Peasant: 'dom_card_peasant',
  Ratcatcher: 'dom_card_ratcatcher',
  'Coin of the Realm': 'dom_card_coin_of_the_realm',
  Guide: 'dom_card_guide',
  Duplicate: 'dom_card_duplicate',
  Miser: 'dom_card_miser',
  'Distant Lands': 'dom_card_distant_lands',
  'Royal Carriage': 'dom_card_royal_carriage',
  Transmogrify: 'dom_card_transmogrify',
  'Wine Merchant': 'dom_card_wine_merchant',
  // Non-supply Traveller stock (5 copies each).
  'Treasure Hunter': 'dom_card_treasure_hunter',
  Warrior: 'dom_card_warrior',
  Hero: 'dom_card_hero',
  Champion: 'dom_card_champion',
  Soldier: 'dom_card_soldier',
  Fugitive: 'dom_card_fugitive',
  Disciple: 'dom_card_disciple',
  Teacher: 'dom_card_teacher',
};

/** The per-player Tavern mat — where Reserve cards wait to be called. */
export const TAVERN_ZONE = 'dom_zone_tavern';
/** The shared face-down Traveller stock (the eight upgrades, 5 each). */
export const TRAVELLER_ZONE = 'dom_zone_travellers';

/** Name stash (Duplicate's copy target, Disciple's copy target). */
export const ADV_NAME_VAR = 'dom_var_adv_name';
/** Cards gained while this player was CURRENT, since their last action-phase
 *  start (Treasure Hunter's "gained on their last turn" memory). */
export const ADV_GAINED_VAR = 'dom_var_adv_gained';
/** Royal Carriage's replay target: 1 on the just-played Action while the
 *  call offer is open, cleared right after (perCard). */
export const RC_MARK_VAR = 'dom_var_adv_rc_mark';

/**
 * THE ADVENTURES TOKEN VARS — declared by the adventuresTokens module
 * (agent C), only REFERENCED here (Teacher writes pile names into them).
 * Per-player strings holding the name of the pile each token sits on
 * ('' = not placed). The merged def does not validate without that module.
 */
export const TOK_CARD_VAR = 'dom_var_tok_card';
export const TOK_ACTION_VAR = 'dom_var_tok_action';
export const TOK_COIN_VAR = 'dom_var_tok_coin';
export const TOK_BUY_VAR = 'dom_var_tok_buy';

/** Stable dominionGame.ts phase ids (Seaside's idiom — the kit keeps them private). */
const PHASE_ACTION = 'dom_phase_action';
const PHASE_CLEANUP = 'dom_phase_cleanup';

/** The eight printed Travellers (Champion and Teacher are NOT Travellers). */
const TRAVELLER_NAMES = [
  'Page', 'Treasure Hunter', 'Warrior', 'Hero',
  'Peasant', 'Soldier', 'Fugitive', 'Disciple',
];

/**
 * Royal Carriage's by-name exclusions: this module's self-parking cards
 * (Reserves + Champion) have left In Play by the printed call window, so
 * the Carriage never offers on them (see the deviations register).
 */
const RC_EXCLUDED = [
  'Ratcatcher', 'Guide', 'Duplicate', 'Distant Lands', 'Royal Carriage',
  'Transmogrify', 'Wine Merchant', 'Teacher', 'Champion',
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

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, HAND, DISCARD, INPLAY, LOOK } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, SCRATCH, DISCOUNT } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER, SELF } = kit;
  const { nameIs } = kit;

  /** The Reserve park: after the immediate half, the card leaves In Play
   *  for the owner's Tavern mat ('play'-tagged — nothing watches the mat). */
  const parkOnMat = (): Block =>
    kit.tmove(specific(SELF), zone(INPLAY, OWNER), zone(TAVERN_ZONE, OWNER), 'play', { faceUp: true });

  /** Calling: an UNTAGGED move off the mat into play (calling is not playing,
   *  so the card's own 'play'-filtered onPlay half stays silent — printed). */
  const callToPlay = (): Block =>
    move(specific(SELF), zone(TAVERN_ZONE, OWNER), zone(INPLAY, OWNER), { faceUp: true });

  /**
   * A Traveller's exchange window: at the START of the owner's cleanup
   * phase, while this copy is still in In Play and the next line card's
   * stock has copies — an optional yes/no. Both moves untagged (an exchange
   * is neither a gain nor a discard — printed; see the register).
   */
  const exchangeAbility = (idBase: string, from: string, next: string, home: 'supply' | 'stock'): AbilityDef => ({
    id: `${idBase}_exch`, name: `${from} — exchange for ${next}`,
    on: 'phaseStart', zoneId: INPLAY, phaseId: PHASE_CLEANUP,
    condition: allOf(
      eq(CURRENT, OWNER),
      gt(countCards(zone(TRAVELLER_ZONE), nameIs(next)), num(0)),
    ),
    script: [
      yesNo(OWNER, `${from}: exchange it for a ${next}?`),
      iff(CHOICE, [
        announce(OWNER, ` exchanges the ${from} for a ${next}.`),
        move(specific(SELF), zone(INPLAY, OWNER),
          home === 'supply' ? zone(SUPPLY) : zone(TRAVELLER_ZONE),
          { faceUp: home === 'supply' }),
        move(
          specific(bestCard(zone(TRAVELLER_ZONE), 'highest', COST, nameIs(next))),
          zone(TRAVELLER_ZONE), zone(DISCARD, OWNER), { faceUp: true },
        ),
      ]),
    ],
  });

  /** Warrior's Bridge-aware $3–$4 window (current cost — fresh nodes per call). */
  const warriorRange = (): Expr => allOf(
    gte(field(CARD, COST), add(num(3), getVar(DISCOUNT))),
    lte(field(CARD, COST), add(num(4), getVar(DISCOUNT))),
  );

  /** "Is a printed Traveller" (fresh nodes per call). */
  const isTraveller = (): Expr => anyOf(
    nameIs(TRAVELLER_NAMES[0]),
    ...TRAVELLER_NAMES.slice(1).map((n) => nameIs(n)),
  );

  /** Teacher's target filter: an Action supply pile NONE of the owner's four
   *  tokens sits on (fresh nodes per call). */
  const tokenFreeActionPile = (): Expr => allOf(
    kit.IS_ACTION_CARD,
    neq(field(CARD, 'name'), getVar(TOK_CARD_VAR, OWNER)),
    neq(field(CARD, 'name'), getVar(TOK_ACTION_VAR, OWNER)),
    neq(field(CARD, 'name'), getVar(TOK_COIN_VAR, OWNER)),
    neq(field(CARD, 'name'), getVar(TOK_BUY_VAR, OWNER)),
  );

  /** Teacher: place the named token on a chosen token-free Action pile. */
  const placeToken = (varId: string, label: string): Block =>
    kit.choosePileBlock({
      who: OWNER, from: zone(SUPPLY), filter: tokenFreeActionPile(),
      prompt: `Teacher: move your ${label} token to an Action supply pile (with none of your tokens on it)`,
      body: [
        setVar(varId, field(CARD, 'name'), OWNER),
        announce(OWNER, ` moves the ${label} token onto the `, CARD, ' pile.'),
      ],
    });

  return [
    // ------------------------------------------------------------------ Page
    // PAGE — Action – Traveller. The play half is exact; the exchange fires
    // at cleanup start (register) and returns Page to its SUPPLY pile.
    kit.cardDef(IDS.Page, 'Page', 2, 0, 0,
      '+1 Card. +1 Action. When you discard this from play, you may exchange it for a Treasure Hunter.', [
        kit.onPlay('dom_ab_page', 'An eager start', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
        ]),
        exchangeAbility('dom_ab_page', 'Page', 'Treasure Hunter', 'supply'),
      ]),

    // --------------------------------------------------------------- Peasant
    kit.cardDef(IDS.Peasant, 'Peasant', 2, 0, 0,
      '+1 Buy. +$1. When you discard this from play, you may exchange it for a Soldier.', [
        kit.onPlay('dom_ab_peasant', 'Off to seek a fortune', [
          changeVar(BUYS, num(1), OWNER),
          changeVar(COINS, num(1), OWNER),
        ]),
        exchangeAbility('dom_ab_peasant', 'Peasant', 'Soldier', 'supply'),
      ]),

    // ------------------------------------------------------------ Ratcatcher
    // RATCATCHER — Reserve. Play: +1 Card +1 Action, park. The turn-start
    // call moves it into play (untagged) and trashes a hand card (mandatory
    // once called; guarded on an empty hand).
    kit.cardDef(IDS.Ratcatcher, 'Ratcatcher', 2, 0, 0,
      '+1 Card. +1 Action. Put this on your Tavern mat. At the start of your turn, you may call this, to trash a card from your hand.', [
        kit.onPlay('dom_ab_ratcatcher', 'Into the walls', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          parkOnMat(),
        ]),
        {
          id: 'dom_ab_ratcatcher_call', name: 'Ratcatcher — call to trash',
          on: 'phaseStart', zoneId: TAVERN_ZONE, phaseId: PHASE_ACTION,
          condition: eq(CURRENT, OWNER),
          script: [
            yesNo(OWNER, 'Ratcatcher: call it to trash a card from your hand?'),
            iff(CHOICE, [
              announce(OWNER, ' calls the Ratcatcher.'),
              callToPlay(),
              iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
                chooseCard({
                  who: OWNER, from: zone(HAND, OWNER),
                  prompt: 'Ratcatcher: trash a card from your hand',
                }),
                announce(OWNER, ' trashes ', CHOICE, '.'),
                kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              ], [announce(OWNER, ' has nothing for the Ratcatcher to catch.')]),
            ]),
          ],
        },
      ]),

    // ----------------------------------------------------- Coin of the Realm
    // COIN OF THE REALM — Treasure – Reserve (treasureNames). The $1 rides
    // the coin FIELD (the treasure action pays it); the on-play half only
    // parks it. The after-an-Action call is the module trigger (register).
    kit.cardDef(IDS['Coin of the Realm'], 'Coin of the Realm', 2, 1, 0,
      "$1. When you play this, put it on your Tavern mat. Directly after resolving an Action, you may call this, for +2 Actions.", [
        kit.onPlay('dom_ab_coin_realm', 'Into the tavern purse', [
          announce(OWNER, "'s Coin of the Realm goes to their Tavern mat."),
          parkOnMat(),
        ]),
      ]),

    // ----------------------------------------------------------------- Guide
    kit.cardDef(IDS.Guide, 'Guide', 3, 0, 0,
      '+1 Card. +1 Action. Put this on your Tavern mat. At the start of your turn, you may call this, to discard your hand and draw 5 cards.', [
        kit.onPlay('dom_ab_guide', 'A local who knows the way', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          parkOnMat(),
        ]),
        {
          id: 'dom_ab_guide_call', name: 'Guide — call for a fresh hand',
          on: 'phaseStart', zoneId: TAVERN_ZONE, phaseId: PHASE_ACTION,
          condition: eq(CURRENT, OWNER),
          script: [
            yesNo(OWNER, 'Guide: call it to discard your hand and draw 5 cards?'),
            iff(CHOICE, [
              announce(OWNER, ' calls the Guide: a fresh hand of 5.'),
              callToPlay(),
              iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
                kit.tmove(ALL, zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ]),
              kit.draw(OWNER, 5),
            ]),
          ],
        },
      ]),

    // ------------------------------------------------------------- Duplicate
    // DUPLICATE — Reserve. Play: park only. The on-gain call is the module
    // trigger pair (register: Bridge-aware $6, nested offers on the copy).
    kit.cardDef(IDS.Duplicate, 'Duplicate', 4, 0, 0,
      'Put this on your Tavern mat. When you gain a card costing up to $6, you may call this, to gain a copy of that card.', [
        kit.onPlay('dom_ab_duplicate', 'A forger takes notes', [
          announce(OWNER, "'s Duplicate goes to their Tavern mat."),
          parkOnMat(),
        ]),
      ]),

    // ----------------------------------------------------------------- Miser
    // MISER — a plain Action USING the mat (not a Reserve): a mat Copper
    // stays there for the rest of the game (register).
    kit.cardDef(IDS.Miser, 'Miser', 4, 0, 0,
      'Choose one: Put a Copper from your hand onto your Tavern mat; or +$1 per Copper on your Tavern mat.', [
        kit.onPlay('dom_ab_miser', 'Counting every penny', [
          chooseOption('Miser: choose one', [
            { id: 'miser_copper', label: 'Put a Copper from your hand onto your Tavern mat' },
            { id: 'miser_coins', label: '+$1 per Copper on your Tavern mat' },
          ], OWNER),
          iff(eq(CHOICE, str('miser_copper')), [
            iff(gt(countCards(zone(HAND, OWNER), nameIs('Copper')), num(0)), [
              announce(OWNER, ' hoards a Copper on their Tavern mat.'),
              move(
                specific(bestCard(zone(HAND, OWNER), 'highest', COST, nameIs('Copper'))),
                zone(HAND, OWNER), zone(TAVERN_ZONE, OWNER), { faceUp: true },
              ),
            ], [announce(OWNER, ' has no Copper to hoard.')]),
          ], [
            announce(OWNER, ' counts the hoard.'),
            changeVar(COINS, countCards(zone(TAVERN_ZONE, OWNER), nameIs('Copper')), OWNER),
          ]),
        ]),
      ]),

    // --------------------------------------------------------- Distant Lands
    // DISTANT LANDS — Victory (victoryNames) – Reserve. PROMINENT DEVIATION
    // (register): played via the module's phaseStart offer, not the core
    // play action. Worth 4 VP only on the mat (buildVpTerms; printed VP 0).
    kit.cardDef(IDS['Distant Lands'], 'Distant Lands', 5, 0, 0,
      'Put this on your Tavern mat. Worth 4 VP if on your Tavern mat at the end of the game (otherwise worth 0 VP).', [
        kit.onPlay('dom_ab_distant_lands', 'Over the horizon', [
          announce(OWNER, "'s Distant Lands goes to their Tavern mat."),
          parkOnMat(),
        ]),
      ]),

    // -------------------------------------------------------- Royal Carriage
    // ROYAL CARRIAGE — Reserve. Play: +1 Action, park. The replay call is
    // the module trigger (register: play-moment offer, queued replay).
    kit.cardDef(IDS['Royal Carriage'], 'Royal Carriage', 5, 0, 0,
      "+1 Action. Put this on your Tavern mat. Directly after resolving an Action, if it's still in play, you may call this, to replay that Action.", [
        kit.onPlay('dom_ab_royal_carriage', 'Horses at the ready', [
          changeVar(ACTIONS, num(1), OWNER),
          parkOnMat(),
        ]),
      ]),

    // ----------------------------------------------------------- Transmogrify
    kit.cardDef(IDS.Transmogrify, 'Transmogrify', 5, 0, 0,
      '+1 Action. Put this on your Tavern mat. At the start of your turn, you may call this, to trash a card from your hand, and gain a card costing up to $1 more than it, into your hand.', [
        kit.onPlay('dom_ab_transmogrify', 'Strange new shapes', [
          changeVar(ACTIONS, num(1), OWNER),
          parkOnMat(),
        ]),
        {
          id: 'dom_ab_transmogrify_call', name: 'Transmogrify — call to upgrade',
          on: 'phaseStart', zoneId: TAVERN_ZONE, phaseId: PHASE_ACTION,
          condition: eq(CURRENT, OWNER),
          script: [
            yesNo(OWNER, 'Transmogrify: call it to trash a hand card and gain one costing up to $1 more, into your hand?'),
            iff(CHOICE, [
              announce(OWNER, ' calls the Transmogrify.'),
              callToPlay(),
              iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
                chooseCard({
                  who: OWNER, from: zone(HAND, OWNER),
                  prompt: 'Transmogrify: trash a card from your hand',
                }),
                setVar(SCRATCH, add(field(CHOICE, COST), num(1)), OWNER),
                announce(OWNER, ' transmogrifies ', CHOICE, '.'),
                kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
                ...kit.gainFromSupply({
                  limit: getVar(SCRATCH, OWNER), toHand: true,
                  prompt: 'Transmogrify: gain a card costing up to $1 more, into your hand',
                  whiff: [announce('Nothing in the supply fits the new shape.')],
                }),
              ], [announce(OWNER, ' has nothing to transmogrify.')]),
            ]),
          ],
        },
      ]),

    // ----------------------------------------------------------- Wine Merchant
    // WINE MERCHANT — Reserve. Play: +1 Buy +$4, park. The discharge fires
    // at the owner's cleanup-phase START with $2+ still unspent (register).
    kit.cardDef(IDS['Wine Merchant'], 'Wine Merchant', 5, 0, 0,
      '+1 Buy. +$4. Put this on your Tavern mat. At the end of your Buy phase, if you have at least $2 unspent, you may discard this from your Tavern mat.', [
        kit.onPlay('dom_ab_wine_merchant', 'A cask on credit', [
          changeVar(BUYS, num(1), OWNER),
          changeVar(COINS, num(4), OWNER),
          parkOnMat(),
        ]),
        {
          id: 'dom_ab_wine_merchant_call', name: 'Wine Merchant — the debt is settled',
          on: 'phaseStart', zoneId: TAVERN_ZONE, phaseId: PHASE_CLEANUP,
          condition: allOf(eq(CURRENT, OWNER), gte(getVar(COINS, OWNER), num(2))),
          script: [
            yesNo(OWNER, 'Wine Merchant: $2+ unspent — discard it from your Tavern mat?'),
            iff(CHOICE, [
              announce(OWNER, ' settles up — the Wine Merchant leaves the mat.'),
              kit.tmove(specific(SELF), zone(TAVERN_ZONE, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
            ]),
          ],
        },
      ]),

    // ======================================================== Page's line ==
    // TREASURE HUNTER — the silver bounty reads the opponent's gained-last-
    // turn counter (register: Goatherd-style memory, cap 10).
    kit.cardDef(IDS['Treasure Hunter'], 'Treasure Hunter', 3, 0, 0,
      '+1 Action. +$1. Gain a Silver per card the player to your right gained on their last turn. When you discard this from play, you may exchange it for a Warrior. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_treasure_hunter', 'Following the trail', [
          changeVar(ACTIONS, num(1), OWNER),
          changeVar(COINS, num(1), OWNER),
          ...Array.from({ length: 10 }, (_, i) => iff(allOf(
            gte(getVar(ADV_GAINED_VAR, nextPlayer(OWNER)), num(i + 1)),
            gt(countCards(zone(SUPPLY), nameIs('Silver')), num(0)),
          ), [
            announce(OWNER, ' unearths a Silver.'),
            kit.tmove(
              specific(bestCard(zone(SUPPLY), 'highest', COST, nameIs('Silver'))),
              zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
            ),
          ])),
        ]),
        exchangeAbility('dom_ab_treasure_hunter', 'Treasure Hunter', 'Warrior', 'stock'),
      ]),

    // WARRIOR — Action – Attack – Traveller. +2 Cards immediate; the attack
    // half is stacked (response window): per Traveller in play (cap 8 —
    // register), the victim reveals their top card through LOOK, trashing
    // it at current cost $3–$4, discarding it otherwise.
    kit.cardDef(IDS.Warrior, 'Warrior', 4, 0, 0,
      '+2 Cards. For each Traveller you have in play (including this), each other player discards the top card of their deck and trashes it if it costs $3 or $4. When you discard this from play, you may exchange it for a Hero. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_warrior_draw', 'Battle-hardened', [
          kit.draw(OWNER, 2),
        ]),
        kit.onPlay('dom_ab_warrior_attack', 'The war band strikes', [
          setVar(SCRATCH, countCards(zone(INPLAY, OWNER), isTraveller()), OWNER),
          announce(OWNER, ' leads ', getVar(SCRATCH, OWNER), ' Traveller(s) into battle.'),
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              ...Array.from({ length: 8 }, (_, i) => iff(gte(getVar(SCRATCH, OWNER), num(i + 1)), [
                ...takeTop(kit, PLAYER, zone(LOOK), true),
                iff(gt(zoneCount(zone(LOOK)), num(0)), [
                  forEachCard(zone(LOOK), null, [
                    announce(PLAYER, ' turns up ', CARD, ' for the Warrior.'),
                  ]),
                  iff(gt(countCards(zone(LOOK), warriorRange()), num(0)), [
                    announce(PLAYER, "'s revealed card falls to the Warrior — trashed."),
                    kit.tmove(matching(warriorRange()), zone(LOOK), zone(TRASH), 'trash', { faceUp: true }),
                  ]),
                  iff(gt(zoneCount(zone(LOOK)), num(0)), [
                    kit.tmove(ALL, zone(LOOK), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
                  ]),
                ]),
              ])),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
        exchangeAbility('dom_ab_warrior', 'Warrior', 'Hero', 'stock'),
      ]),

    // HERO — +$2, gain any Treasure (no cost cap — the $99 limit).
    kit.cardDef(IDS.Hero, 'Hero', 5, 0, 0,
      '+$2. Gain a Treasure. When you discard this from play, you may exchange it for a Champion. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_hero', 'Songs will be sung', [
          changeVar(COINS, num(2), OWNER),
          ...kit.gainFromSupply({
            treasureOnly: true, limit: num(99),
            prompt: 'Hero: gain a Treasure',
            whiff: [announce('No Treasure remains for the Hero.')],
          }),
        ]),
        exchangeAbility('dom_ab_hero', 'Hero', 'Champion', 'stock'),
      ]),

    // CHAMPION — Action – Duration. PROMINENT DEVIATION (register): +1
    // Action, then it parks on the Tavern mat FOREVER; the two printed
    // auras are the module triggers gated on the parked copy.
    kit.cardDef(IDS.Champion, 'Champion', 6, 0, 0,
      "+1 Action. For the rest of the game, when another player plays an Attack card, it doesn't affect you, and when you play an Action, +1 Action. (This stays in play. This is not in the Supply.)", [
        kit.onPlay('dom_ab_champion', 'None shall pass', [
          changeVar(ACTIONS, num(1), OWNER),
          announce(OWNER, "'s Champion takes up the watch — for the rest of the game."),
          parkOnMat(),
        ]),
      ]),

    // ===================================================== Peasant's line ==
    // SOLDIER — Action – Attack – Traveller. The coins are immediate
    // (+$2, +$1 per OTHER Attack in play — itself excluded); the discard
    // half is stacked.
    kit.cardDef(IDS.Soldier, 'Soldier', 3, 0, 0,
      '+$2. +$1 per other Attack you have in play. Each other player with 4 or more cards in hand discards a card. When you discard this from play, you may exchange it for a Fugitive. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_soldier_coins', 'A soldier’s pay', [
          changeVar(COINS, num(2), OWNER),
          changeVar(COINS,
            add(countCards(zone(INPLAY, OWNER), kit.hasTag(CARD, kit.tags.ATTACK)), num(-1)),
            OWNER),
        ]),
        kit.onPlay('dom_ab_soldier_attack', 'Requisitions', [
          forEachOpponent([
            iff(allOf(
              eq(getVar(IMMUNE, PLAYER), num(0)),
              gte(zoneCount(zone(HAND, PLAYER)), num(4)),
            ), [
              chooseCardsBlock({
                who: PLAYER, from: zone(HAND, PLAYER), min: num(1), max: num(1),
                prompt: 'Soldier: discard a card',
                body: [
                  announce(PLAYER, ' discards ', CARD, ' to the Soldier.'),
                  kit.tmove(specific(CARD), zone(HAND, PLAYER), zone(DISCARD, PLAYER), 'discard', { faceUp: true }),
                ],
              }),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
        exchangeAbility('dom_ab_soldier', 'Soldier', 'Fugitive', 'stock'),
      ]),

    // FUGITIVE — +2 Cards +1 Action, discard a card (mandatory, guarded).
    kit.cardDef(IDS.Fugitive, 'Fugitive', 4, 0, 0,
      '+2 Cards. +1 Action. Discard a card. When you discard this from play, you may exchange it for a Disciple. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_fugitive', 'Always moving on', [
          kit.draw(OWNER, 2),
          changeVar(ACTIONS, num(1), OWNER),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(1), max: num(1),
              prompt: 'Fugitive: discard a card',
              body: [
                announce(OWNER, ' discards ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
              ],
            }),
          ]),
        ]),
        exchangeAbility('dom_ab_fugitive', 'Fugitive', 'Disciple', 'stock'),
      ]),

    // DISCIPLE — play an Action twice (Throne Room's shape), then gain a
    // copy of it (by name, whiffing politely off-supply — a doubled Horse
    // gains nothing).
    kit.cardDef(IDS.Disciple, 'Disciple', 5, 0, 0,
      'You may play an Action card from your hand twice. Gain a copy of it. When you discard this from play, you may exchange it for a Teacher. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_disciple', 'Watch and learn', [
          iff(gt(countCards(zone(HAND, OWNER), kit.IS_ACTION_CARD), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.IS_ACTION_CARD,
              min: num(0), max: num(1),
              prompt: 'Disciple: you may play an Action twice (and gain a copy of it)',
              body: [
                setVar(ADV_NAME_VAR, field(CARD, 'name'), OWNER),
                announce(OWNER, ' plays ', CARD, ' twice with the Disciple.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(INPLAY, OWNER), 'play', { faceUp: true }),
                kit.playAgain(CARD),
                iff(gt(countCards(zone(SUPPLY),
                  eq(field(CARD, 'name'), getVar(ADV_NAME_VAR, OWNER))), num(0)), [
                  announce(OWNER, ' gains a copy of the lesson.'),
                  kit.tmove(
                    specific(bestCard(zone(SUPPLY), 'highest', COST,
                      eq(field(CARD, 'name'), getVar(ADV_NAME_VAR, OWNER)))),
                    zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
                  ),
                ], [announce('No copy in the supply — the lesson is not repeated.')]),
              ],
            }),
          ], [announce(OWNER, ' has no Action to teach.')]),
        ]),
        exchangeAbility('dom_ab_disciple', 'Disciple', 'Teacher', 'stock'),
      ]),

    // TEACHER — Action – Reserve. PROMINENT DEVIATION (register): parks
    // PERMANENTLY; the turn-start call places one of the owner's four +1
    // tokens (the adventuresTokens pile-name vars) on a token-free Action
    // supply pile, without leaving the mat.
    kit.cardDef(IDS.Teacher, 'Teacher', 6, 0, 0,
      'Put this on your Tavern mat. At the start of your turn, you may call this, to move your +1 Card, +1 Action, +1 Buy, or +$1 token to an Action Supply pile you have no tokens on. (This is not in the Supply.)', [
        kit.onPlay('dom_ab_teacher', 'Class is in session', [
          announce(OWNER, "'s Teacher settles at the tavern — for the rest of the game."),
          parkOnMat(),
        ]),
        {
          id: 'dom_ab_teacher_call', name: 'Teacher — place a +1 token',
          on: 'phaseStart', zoneId: TAVERN_ZONE, phaseId: PHASE_ACTION,
          condition: allOf(
            eq(CURRENT, OWNER),
            gt(countCards(zone(SUPPLY), tokenFreeActionPile()), num(0)),
          ),
          script: [
            yesNo(OWNER, 'Teacher: move one of your +1 tokens to an Action supply pile?'),
            iff(CHOICE, [
              chooseOption('Teacher: which token?', [
                { id: 'tok_card', label: '+1 Card token' },
                { id: 'tok_action', label: '+1 Action token' },
                { id: 'tok_buy', label: '+1 Buy token' },
                { id: 'tok_coin', label: '+$1 token' },
              ], OWNER),
              iff(eq(CHOICE, str('tok_card')), [
                placeToken(TOK_CARD_VAR, '+1 Card'),
              ], [
                iff(eq(CHOICE, str('tok_action')), [
                  placeToken(TOK_ACTION_VAR, '+1 Action'),
                ], [
                  iff(eq(CHOICE, str('tok_buy')), [
                    placeToken(TOK_BUY_VAR, '+1 Buy'),
                  ], [
                    placeToken(TOK_COIN_VAR, '+$1'),
                  ]),
                ]),
              ]),
            ]),
          ],
        },
      ]),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, HAND, DISCARD, INPLAY } = kit.zones;
  const { ACTIONS, IMMUNE } = kit.vars;
  const { COST } = kit.fields;
  const { CARD, PLAYER } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the player
   *  who played/gained the card. */
  const ACTOR = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** "This candidate wears the Royal Carriage replay mark." */
  const rcMarked = (): Expr => eq(getVar(RC_MARK_VAR, CARD), num(1));

  /** TREASURE HUNTER's memory: gains attribute to the CURRENT player. */
  const gainedWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_advA_gained_${tag}`,
    name: `Adventures: a card is ${tag === 'buy' ? 'bought' : 'gained'} this turn`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [changeVar(ADV_GAINED_VAR, num(1), CURRENT)],
  });

  /** DUPLICATE's call: on a gain of a card costing up to $6 (current cost),
   *  each Duplicate on the gainer's mat may be called to gain a copy. */
  const duplicateWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_advA_duplicate_${tag}`,
    name: `Duplicate: a card is ${tag === 'buy' ? 'bought' : 'gained'} — call to copy it?`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      setVar(ADV_NAME_VAR, field(CARD, 'name'), ACTOR),
      iff(allOf(
        gt(countCards(zone(TAVERN_ZONE, ACTOR), kit.nameIs('Duplicate')), num(0)),
        lte(field(CARD, COST), add(num(6), getVar(kit.vars.DISCOUNT))),
        gt(countCards(zone(SUPPLY),
          eq(field(CARD, 'name'), getVar(ADV_NAME_VAR, ACTOR))), num(0)),
      ), [
        chooseCardsBlock({
          who: ACTOR, from: zone(TAVERN_ZONE, ACTOR), filter: kit.nameIs('Duplicate'),
          min: num(0), max: num(99),
          prompt: 'Duplicate: call any number to gain copies of the card you just gained?',
          body: [
            iff(gt(countCards(zone(SUPPLY),
              eq(field(CARD, 'name'), getVar(ADV_NAME_VAR, ACTOR))), num(0)), [
              announce(ACTOR, ' calls a Duplicate.'),
              move(specific(CARD), zone(TAVERN_ZONE, ACTOR), zone(INPLAY, ACTOR),
                { faceUp: true, toPosition: 'bottom' }),
              kit.tmove(
                specific(bestCard(zone(SUPPLY), 'highest', COST,
                  eq(field(CARD, 'name'), getVar(ADV_NAME_VAR, ACTOR)))),
                zone(SUPPLY), zone(DISCARD, ACTOR), 'gain', { faceUp: true },
              ),
            ], [announce('The pile ran dry — the Duplicate stays put.')]),
          ],
        }),
      ]),
    ],
  });

  return [
    // Treasure Hunter's memory resets at the CURRENT player's action-phase
    // start (their "last turn" begins anew) — registered before the offers.
    {
      id: 'dom_trigger_advA_gained_reset',
      name: 'Adventures: a new turn begins — the gained-last-turn count resets',
      event: { kind: 'phaseStart', phaseId: PHASE_ACTION },
      condition: null,
      script: [setVar(ADV_GAINED_VAR, num(0), CURRENT)],
    },
    gainedWatch('gain'),
    gainedWatch('buy'),

    // DISTANT LANDS' play offer (register): at the owner's action-phase
    // start, any copies in hand may be played — one Action each — since the
    // Victory-typed card is invisible to the core play action.
    {
      id: 'dom_trigger_advA_distant_lands_offer',
      name: 'Distant Lands: play it onto the Tavern mat?',
      event: { kind: 'phaseStart', phaseId: PHASE_ACTION },
      condition: null,
      script: [
        iff(gt(countCards(zone(HAND, CURRENT), kit.nameIs('Distant Lands')), num(0)), [
          chooseCardsBlock({
            who: CURRENT, from: zone(HAND, CURRENT), filter: kit.nameIs('Distant Lands'),
            min: num(0), max: num(99),
            prompt: 'Play Distant Lands onto your Tavern mat? (one Action each)',
            body: [
              iff(gt(getVar(ACTIONS, CURRENT), num(0)), [
                changeVar(ACTIONS, num(-1), CURRENT),
                announce(CURRENT, ' plays ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(INPLAY, CURRENT), 'play', { faceUp: true }),
              ], [announce(CURRENT, ' has no Action left for Distant Lands.')]),
            ],
          }),
        ]),
      ],
    },

    // CHAMPION's action aura: +1 Action per parked Champion whenever the
    // owner plays an Action ('play'-tagged entries — synthetic replays
    // included, as printed).
    {
      id: 'dom_trigger_advA_champion_actions',
      name: 'Champion: an Action is played — the watch lends a hand',
      event: { kind: 'cardEnterZone', zoneId: INPLAY, tag: 'play' },
      condition: kit.IS_ACTION_CARD,
      script: [
        iff(gt(countCards(zone(TAVERN_ZONE, ACTOR), kit.nameIs('Champion')), num(0)), [
          announce(ACTOR, "'s Champion grants +1 Action."),
          changeVar(ACTIONS,
            countCards(zone(TAVERN_ZONE, ACTOR), kit.nameIs('Champion')), ACTOR),
        ]),
      ],
    },

    // CHAMPION's shield, part 1 (register): when an Attack card is played,
    // every OTHER player with a parked Champion becomes immune before the
    // stacked attack half can resolve.
    {
      id: 'dom_trigger_advA_champion_shield',
      name: 'Champion: an Attack is played — the shield rises',
      event: { kind: 'cardEnterZone', zoneId: INPLAY, tag: 'play' },
      condition: kit.hasTag(CARD, kit.tags.ATTACK),
      script: [
        forEachPlayer([
          iff(allOf(
            neq(PLAYER, ACTOR),
            gt(countCards(zone(TAVERN_ZONE, PLAYER), kit.nameIs('Champion')), num(0)),
            eq(getVar(IMMUNE, PLAYER), num(0)),
          ), [
            setVar(IMMUNE, num(1), PLAYER),
            announce(PLAYER, "'s Champion shields them — the attack does not affect them."),
          ]),
        ]),
      ],
    },

    // CHAMPION's shield, part 2: the core per-attack IMMUNE reset runs
    // first on every effectResolved; while ANOTHER Attack is still pending
    // (a Throne-Roomed / Royal-Carriaged double), the shield re-arms so the
    // second resolution stays waved off too.
    {
      id: 'dom_trigger_advA_champion_shield_rearm',
      name: 'Champion: another attack still pends — the shield holds',
      event: { kind: 'effectResolved' },
      condition: allOf(gt(STACK_SIZE, num(0)), kit.hasTag(STACK_TOP, kit.tags.ATTACK)),
      script: [
        forEachPlayer([
          iff(allOf(
            neq(PLAYER, cardOwner(STACK_TOP)),
            gt(countCards(zone(TAVERN_ZONE, PLAYER), kit.nameIs('Champion')), num(0)),
            eq(getVar(IMMUNE, PLAYER), num(0)),
          ), [
            setVar(IMMUNE, num(1), PLAYER),
          ]),
        ]),
      ],
    },

    // COIN OF THE REALM's call (register: play-moment timing): when the
    // owner of parked Coins plays an Action, any number may be called for
    // +2 Actions each (untagged move off the mat — calling is not playing).
    {
      id: 'dom_trigger_advA_coin_realm_call',
      name: 'Coin of the Realm: an Action is played — call for +2 Actions?',
      event: { kind: 'cardEnterZone', zoneId: INPLAY, tag: 'play' },
      condition: kit.IS_ACTION_CARD,
      script: [
        iff(gt(countCards(zone(TAVERN_ZONE, ACTOR), kit.nameIs('Coin of the Realm')), num(0)), [
          chooseCardsBlock({
            who: ACTOR, from: zone(TAVERN_ZONE, ACTOR), filter: kit.nameIs('Coin of the Realm'),
            min: num(0), max: num(99),
            prompt: 'Coin of the Realm: call any number for +2 Actions each?',
            body: [
              announce(ACTOR, ' calls a Coin of the Realm: +2 Actions.'),
              move(specific(CARD), zone(TAVERN_ZONE, ACTOR), zone(INPLAY, ACTOR),
                { faceUp: true, toPosition: 'bottom' }),
              changeVar(ACTIONS, num(2), ACTOR),
            ],
          }),
        ]),
      ],
    },

    // ROYAL CARRIAGE's call (register): the just-played Action is marked;
    // each called Carriage replays it via a queued synthetic 'play' event
    // (which resolves after the natural resolution — net "played twice").
    // Self-parking Reserves and Champion are excluded by name; the
    // still-in-play guard withholds a stale replay.
    {
      id: 'dom_trigger_advA_royal_carriage_call',
      name: 'Royal Carriage: an Action is played — call to replay it?',
      event: { kind: 'cardEnterZone', zoneId: INPLAY, tag: 'play' },
      condition: allOf(
        kit.IS_ACTION_CARD,
        ...RC_EXCLUDED.map((n) => neq(field(CARD, 'name'), str(n))),
      ),
      script: [
        iff(allOf(
          eq(cardZoneId(CARD), str(INPLAY)),
          gt(countCards(zone(TAVERN_ZONE, ACTOR), kit.nameIs('Royal Carriage')), num(0)),
        ), [
          setVar(RC_MARK_VAR, num(1), CARD),
          chooseCardsBlock({
            who: ACTOR, from: zone(TAVERN_ZONE, ACTOR), filter: kit.nameIs('Royal Carriage'),
            min: num(0), max: num(99),
            prompt: 'Royal Carriage: call to replay the Action you just played?',
            body: [
              iff(gt(countCards(zone(INPLAY, ACTOR), rcMarked()), num(0)), [
                announce(ACTOR, ' calls a Royal Carriage — the Action is replayed.'),
                move(specific(CARD), zone(TAVERN_ZONE, ACTOR), zone(INPLAY, ACTOR),
                  { faceUp: true, toPosition: 'bottom' }),
                kit.playAgain(bestCard(zone(INPLAY, ACTOR), 'highest', COST, rcMarked())),
              ], [announce('The played Action has left play — the Carriage stays.')]),
            ],
          }),
          forEachCard(zone(INPLAY, ACTOR), rcMarked(), [
            setVar(RC_MARK_VAR, num(0), CARD),
          ]),
        ]),
      ],
    },

    duplicateWatch('gain'),
    duplicateWatch('buy'),
  ];
}

export const adventuresA: ExpansionModule = {
  id: 'adventuresA',
  setName: 'Adventures',

  piles: [
    { name: 'Page', cost: 2, count: 10 },
    { name: 'Peasant', cost: 2, count: 10 },
    { name: 'Ratcatcher', cost: 2, count: 10 },
    { name: 'Coin of the Realm', cost: 2, count: 10 },
    { name: 'Guide', cost: 3, count: 10 },
    { name: 'Duplicate', cost: 4, count: 10 },
    { name: 'Miser', cost: 4, count: 10 },
    { name: 'Distant Lands', cost: 5, count: 10 },
    { name: 'Royal Carriage', cost: 5, count: 10 },
    { name: 'Transmogrify', cost: 5, count: 10 },
    { name: 'Wine Merchant', cost: 5, count: 10 },
  ],

  ids: IDS,

  attackNames: ['Warrior', 'Soldier'],
  treasureNames: ['Coin of the Realm'],
  victoryNames: ['Distant Lands'],

  variables: [
    {
      id: ADV_NAME_VAR, name: 'Adventures: name stash',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: ADV_GAINED_VAR, name: 'Adventures: cards gained this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: RC_MARK_VAR, name: 'Royal Carriage: replay target',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  zones: [
    {
      id: TAVERN_ZONE, name: 'Tavern',
      owner: 'perPlayer', visibility: 'all', layout: 'row', area: 'player',
    },
    {
      id: TRAVELLER_ZONE, name: 'Traveller stock',
      owner: 'shared', visibility: 'none', layout: 'stack', area: 'center',
    },
  ] as ZoneDef[],

  nonSupply: [
    {
      zoneId: TRAVELLER_ZONE,
      piles: [
        { name: 'Treasure Hunter', cost: 3, count: 5 },
        { name: 'Warrior', cost: 4, count: 5 },
        { name: 'Hero', cost: 5, count: 5 },
        { name: 'Champion', cost: 6, count: 5 },
        { name: 'Soldier', cost: 3, count: 5 },
        { name: 'Fugitive', cost: 4, count: 5 },
        { name: 'Disciple', cost: 5, count: 5 },
        { name: 'Teacher', cost: 6, count: 5 },
      ],
    },
  ],

  buildCards,
  buildTriggers,

  buildVpTerms(kit: CardKit): Block[] {
    // Distant Lands: 4 VP per copy ON THE MAT at every recount ($player is
    // bound by the recount's forEachPlayer); printed VP field 0 everywhere
    // else, so copies in the deck score nothing — exactly as printed.
    return [
      changeVar(kit.vars.VP,
        mul(countCards(zone(TAVERN_ZONE, kit.PLAYER), kit.nameIs('Distant Lands')), num(4)),
        kit.PLAYER),
    ];
  },
};
