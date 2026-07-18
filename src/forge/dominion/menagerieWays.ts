/**
 * Menagerie — the Ways (landscape sideboard, kind 'way'): Way of the
 * Butterfly, Camel, Frog, Goat, Horse, Mole, Monkey, Mule, Otter, Owl, Ox,
 * Pig, Rat, Seal, Sheep, Squirrel, Turtle, Worm — 18 of the printed 20.
 *
 * A Way's effect is ONE onPlay-style ability on the WAY CARD. The core
 * 'dom_action_play_way' spends the Action, moves the chosen hand card to In
 * Play on an UNTAGGED move (kit.onPlay is 'play'-filtered, so the card's own
 * effect stays silent) and fires the chosen Way's ability instead
 * (auto-resolving when only one Way is on the table). The Way card never
 * leaves the sideboard, and a Way that is not on the table can never fire:
 * the action's legality demands a Way in dom_zone_landscapes, and every
 * watcher below is gated on a flag/mark only a Way ability can set.
 *
 * THE PLAYED CARD: a Way ability that references "this" reads it as the TOP
 * card of the current player's In Play — the untagged move just happened, so
 * the played card is guaranteed to be the newest In-Play entry. That is an
 * approximation (a printed Way binds the exact play), but on this table
 * nothing can slip between the move and the ability firing.
 *
 * All printed texts verified against the official Menagerie rulebook card
 * faces (DommenagerieRules2019). Notably: Way of the Rat is JUST "You may
 * discard a Treasure to gain a copy of this." (no +1 Action / +1 Buy — a
 * common misquote), Way of the Seal's topdeck is OPTIONAL ("you may"), and
 * Way of the Squirrel is +2 Cards (not +1).
 *
 * EXCLUSIONS (the stated two):
 *  - WAY OF THE CHAMELEON — "each time this would give you +Cards this turn,
 *    you get +$ instead, and vice-versa" rewrites another card's effect
 *    per-grant; the engine has no way to intercept and swap a script's
 *    counter grants. Inexpressible — not shipped.
 *  - WAY OF THE MOUSE — "play the set-aside card" needs game-setup machinery
 *    (set aside an unused $2/$3 Action kingdom card at the start of the
 *    game, plus its setup) that the landscape sideboard does not carry.
 *    Not shipped.
 *
 * DEVIATIONS / TIMING register (details in the per-card comments):
 *  - BUTTERFLY: the exact-cost match reads PRINTED costs (the Bridge
 *    discount is deliberately ignored — exact-cost effects speak printed
 *    numbers on this table) and requires a coin-only cost (a potion-cost
 *    card never matches, failing closed). The return sends a Horse to the
 *    Horse stock and everything else to the Supply, per the printed ruling
 *    that non-Supply cards return to their own pile.
 *  - FROG: the topdeck rider is a 'cleanup'/'discard'-tagged watcher on the
 *    marked card. The engine drains triggers only after the running script
 *    finishes, so at cleanup the topdeck lands AFTER the 5-card redraw: the
 *    card tops the deck for the FOLLOWING turn instead of joining the
 *    redrawn hand (printed play usually draws it right back). If the redraw
 *    reshuffled it into the deck already, it stays where the shuffle put it
 *    (the mark still clears).
 *  - HORSE / RAT and non-supply cards: Way of the Horse returns a Horse to
 *    the Horse stock (printed); Way of the Rat gains copies from the SUPPLY
 *    only (printed ruling), so a Horse played as the Rat whiffs politely.
 *  - SEAL: "+$1, this turn when you gain a card you may put it onto your
 *    deck" = a per-turn per-player flag plus 'gain'/'buy' watchers (a bought
 *    card is gained, so both tags are watched). The offer is withheld when
 *    the gained card already left for the trash or the supply (a Watchtower/
 *    Trader answered first — the printed ruling) or was gained straight onto
 *    the deck (already there). The flag resets at cleanup.
 *  - SQUIRREL: the +2 Cards land inside the cleanup action AFTER the 5-card
 *    redraw (buildCleanupResets runs after the sweep), which IS the printed
 *    timing ("after drawing your hand in Clean-up"). Off-turn Way plays
 *    cannot happen on this table (dom_action_play_way is an action-phase
 *    action), so the counter always pays out at its owner's own cleanup.
 *  - TURTLE: the set-aside parks the played card in the DURATION zone
 *    wearing a Turtle mark AND seaside2eA's Haven-aside mark (referenced by
 *    id, renaissanceA's precedent), so a parked Duration card's own
 *    later-half stays inert while it waits. At the owner's next action-phase
 *    start the return trigger clears both marks, marches the card to In
 *    Play on an untagged move and RE-FIRES its play moment via the
 *    play-tagged synthetic event (kit.playAgain) — a real play that costs no
 *    Action, exactly as printed. The synthetic event resolves after the
 *    phaseStart pass, so a Turtled Duration card parks itself again cleanly
 *    for ITS next turn. Printed quirks: re-choosing Way of the Turtle on the
 *    replay (delaying another turn) is NOT offered — the replay always
 *    resolves the card's own effect; and (per print) a Throne Room that
 *    played the card neither sets aside nor stays in play — here the Throne
 *    Room was never involved in the Way play, so nothing special happens.
 */
import type {
  Block, CardDef, Expr, TriggerDef, VariableDef,
} from '../../shared/types';
import {
  ALL, CURRENT, add, allOf, announce, bestCard, bnd, cardZoneId, changeVar, chooseCard,
  chooseCardsBlock, countCards, eq, field, forEachCard, forEachPlayer, getVar, gt, iff,
  move, mul, neq, num, setVar, specific, str, sub, topCard, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  'Way of the Butterfly': 'dom_card_way_butterfly',
  'Way of the Camel': 'dom_card_way_camel',
  'Way of the Frog': 'dom_card_way_frog',
  'Way of the Goat': 'dom_card_way_goat',
  'Way of the Horse': 'dom_card_way_horse',
  'Way of the Mole': 'dom_card_way_mole',
  'Way of the Monkey': 'dom_card_way_monkey',
  'Way of the Mule': 'dom_card_way_mule',
  'Way of the Otter': 'dom_card_way_otter',
  'Way of the Owl': 'dom_card_way_owl',
  'Way of the Ox': 'dom_card_way_ox',
  'Way of the Pig': 'dom_card_way_pig',
  'Way of the Rat': 'dom_card_way_rat',
  'Way of the Seal': 'dom_card_way_seal',
  'Way of the Sheep': 'dom_card_way_sheep',
  'Way of the Squirrel': 'dom_card_way_squirrel',
  'Way of the Turtle': 'dom_card_way_turtle',
  'Way of the Worm': 'dom_card_way_worm',
};

/** Menagerie's shared mats (declared by menagerieA, registered above us). */
const EXILE_ZONE = 'dom_zone_exile';
const HORSE_ZONE = 'dom_zone_horses';
/** Haven's set-aside marker (seaside2eA) — keeps a Turtled Duration card's
 *  own later-half inert while it waits (see the register). */
const HAVEN_ASIDE = 'dom_var_haven_aside';
/** The action phase's id (stable dominionGame.ts literal — Seaside's idiom). */
const PHASE_ACTION = 'dom_phase_action';

/** Name stash for Way of the Rat's copy gain. */
export const WAY_NAME_VAR = 'dom_var_way_name';
/** Way of the Seal played this turn (per player) — reset at cleanup. */
export const SEAL_TURN_VAR = 'dom_var_way_seal';
/** Way of the Squirrel plays this turn (per player) — reset at cleanup. */
export const SQUIRREL_TURN_VAR = 'dom_var_way_squirrel';
/** perCard: this In-Play card was played as Way of the Frog this turn. */
export const FROG_MARK = 'dom_var_way_frog';
/** perCard: this DURATION-parked card is Turtle-set-aside. */
export const TURTLE_MARK = 'dom_var_way_turtle';

/** A yes/no question to `who`; the answer lands in $choice as a boolean. */
const yesNo = (who: Expr, prompt: string): Block =>
  ({ kind: 'choose', who, choice: { kind: 'yesNo', prompt } });

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, HAND, DISCARD, INPLAY, DURATION } = kit.zones;
  const { ACTIONS, BUYS, COINS, SCRATCH } = kit.vars;
  const { COST, COST_POTION } = kit.fields;
  const { CARD, CHOICE } = kit;

  /** The card just played as a Way: the TOP of the current player's In Play
   *  (fresh nodes per call — the def is keeper-editable stored data). */
  const played = (): Expr => topCard(zone(INPLAY, CURRENT));
  /** The played card exists (it always should — belt and suspenders). */
  const hasPlayed = (): Expr => gt(zoneCount(zone(INPLAY, CURRENT)), num(0));
  /** Return the played card to its pile: a Horse to the Horse stock,
   *  everything else to the Supply (untagged — returning is no listed cause). */
  const returnPlayedToPile = (): Block =>
    iff(eq(field(played(), 'name'), str('Horse')), [
      move(specific(played()), zone(INPLAY, CURRENT), zone(HORSE_ZONE), { faceUp: false }),
    ], [
      move(specific(played()), zone(INPLAY, CURRENT), zone(SUPPLY), { faceUp: true }),
    ]);
  /** Exile the top copy of a named basic from the Supply (untagged move —
   *  exiling is neither gaining nor discarding; menagerieA's idiom). */
  const exileNamed = (name: string, empty: string): Block[] => [
    iff(gt(countCards(zone(SUPPLY), kit.nameIs(name)), num(0)), [
      announce(CURRENT, ` exiles a ${name} from the Supply.`),
      move(specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs(name))),
        zone(SUPPLY), zone(EXILE_ZONE, CURRENT), { faceUp: true }),
    ], [announce(empty)]),
  ];
  /** Butterfly's target: printed coin cost EXACTLY $1 above the stashed
   *  cost, coin-only (Bridge-ignored, potion-cost cards fail closed). */
  const exactlyOneMore = (): Expr => allOf(
    eq(field(CARD, COST), add(getVar(SCRATCH, CURRENT), num(1))),
    eq(field(CARD, COST_POTION), num(0)),
  );

  const way = (name: string, text: string, script: Block[]): CardDef => {
    const slug = IDS[name].replace('dom_card_', '');
    return kit.cardDef(IDS[name], name, 0, 0, 0, `Way. ${text}`, [
      kit.onPlay(`dom_ab_${slug}`, name, script),
    ]);
  };

  return [
    // WAY OF THE BUTTERFLY — exact (see the register for the exact-cost and
    // return-to-pile shapes): optional return, then the $1-more gain.
    way('Way of the Butterfly',
      'You may return the played card to its pile, to gain a card costing exactly $1 more than it.', [
        iff(hasPlayed(), [
          yesNo(CURRENT, 'Way of the Butterfly: return the played card to its pile to gain a card costing exactly $1 more?'),
          iff(CHOICE, [
            setVar(SCRATCH, field(played(), COST), CURRENT),
            announce(CURRENT, ' returns ', played(), ' to its pile.'),
            returnPlayedToPile(),
            iff(gt(countCards(zone(SUPPLY), exactlyOneMore()), num(0)), [
              kit.choosePileBlock({
                who: CURRENT, from: zone(SUPPLY), filter: exactlyOneMore(),
                prompt: 'Way of the Butterfly: gain a card costing exactly $1 more',
                body: [
                  announce(CURRENT, ' gains ', CARD, '.'),
                  kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, CURRENT), 'gain', { faceUp: true }),
                ],
              }),
            ], [announce('Nothing in the Supply costs exactly $1 more — no card gained.')]),
          ]),
        ]),
      ]),

    // WAY OF THE CAMEL — exact: Exile a Gold from the Supply.
    way('Way of the Camel', 'Exile a Gold from the Supply.',
      exileNamed('Gold', 'The Gold pile is empty — the camel arrives unladen.')),

    // WAY OF THE FROG — +1 Action, and the played card wears the Frog mark;
    // the discard-from-play watcher topdecks it (timing in the register).
    way('Way of the Frog',
      '+1 Action. When you discard the played card from play this turn, put it onto your deck.', [
        changeVar(ACTIONS, num(1), CURRENT),
        iff(hasPlayed(), [
          setVar(FROG_MARK, num(1), played()),
        ]),
      ]),

    // WAY OF THE GOAT — exact: trash a card from your hand (mandatory,
    // guarded so an empty hand can never hang the session).
    way('Way of the Goat', 'Trash a card from your hand.', [
      iff(gt(zoneCount(zone(HAND, CURRENT)), num(0)), [
        chooseCard({
          who: CURRENT, from: zone(HAND, CURRENT),
          prompt: 'Way of the Goat: trash a card from your hand',
        }),
        announce(CURRENT, ' trashes ', CHOICE, '.'),
        kit.tmove(specific(CHOICE), zone(HAND, CURRENT), zone(TRASH), 'trash', { faceUp: true }),
      ], [announce(CURRENT, ' has no card for the goat to eat.')]),
    ]),

    // WAY OF THE HORSE — exact: +2 Cards, +1 Action, return the played card
    // to its pile (a Horse heads home to the stock — the register).
    way('Way of the Horse', '+2 Cards. +1 Action. Return the played card to its pile.', [
      kit.draw(CURRENT, 2),
      changeVar(ACTIONS, num(1), CURRENT),
      iff(hasPlayed(), [
        announce(CURRENT, "'s ", played(), ' returns to its pile.'),
        returnPlayedToPile(),
      ]),
    ]),

    // WAY OF THE MOLE — exact: +1 Action, discard your hand, +3 Cards (the
    // draw happens even with nothing to discard — printed ruling). The
    // discards are 'discard'-tagged, so discard reactions fire as printed.
    way('Way of the Mole', '+1 Action. Discard your hand. +3 Cards.', [
      changeVar(ACTIONS, num(1), CURRENT),
      iff(gt(zoneCount(zone(HAND, CURRENT)), num(0)), [
        announce(CURRENT, ' discards their hand.'),
        kit.tmove(ALL, zone(HAND, CURRENT), zone(DISCARD, CURRENT), 'discard', { faceUp: true }),
      ]),
      kit.draw(CURRENT, 3),
    ]),

    // WAY OF THE MONKEY — exact: +1 Buy, +$1.
    way('Way of the Monkey', '+1 Buy. +$1.', [
      changeVar(BUYS, num(1), CURRENT),
      changeVar(COINS, num(1), CURRENT),
    ]),

    // WAY OF THE MULE — exact: +1 Action, +$1.
    way('Way of the Mule', '+1 Action. +$1.', [
      changeVar(ACTIONS, num(1), CURRENT),
      changeVar(COINS, num(1), CURRENT),
    ]),

    // WAY OF THE OTTER — exact: +2 Cards.
    way('Way of the Otter', '+2 Cards.', [
      kit.draw(CURRENT, 2),
    ]),

    // WAY OF THE OWL — exact: draw until 6 cards in hand (the draw block
    // clamps a negative count at 0, matching "6 or more: draw nothing").
    way('Way of the Owl', 'Draw until you have 6 cards in hand.', [
      kit.drawN(CURRENT, sub(num(6), zoneCount(zone(HAND, CURRENT)))),
    ]),

    // WAY OF THE OX — exact: +2 Actions.
    way('Way of the Ox', '+2 Actions.', [
      changeVar(ACTIONS, num(2), CURRENT),
    ]),

    // WAY OF THE PIG — exact: +1 Card, +1 Action.
    way('Way of the Pig', '+1 Card. +1 Action.', [
      kit.draw(CURRENT, 1),
      changeVar(ACTIONS, num(1), CURRENT),
    ]),

    // WAY OF THE RAT — exact to the VERIFIED print (no +1 Action / +1 Buy):
    // you may discard a Treasure to gain a copy of the played card — from
    // the Supply only (printed ruling), whiffing politely otherwise.
    way('Way of the Rat', 'You may discard a Treasure to gain a copy of the played card.', [
      iff(hasPlayed(), [
        setVar(WAY_NAME_VAR, field(played(), 'name'), CURRENT),
        iff(gt(countCards(zone(HAND, CURRENT), kit.IS_TREASURE_CARD), num(0)), [
          chooseCardsBlock({
            who: CURRENT, from: zone(HAND, CURRENT), filter: kit.IS_TREASURE_CARD,
            min: num(0), max: num(1),
            prompt: 'Way of the Rat: you may discard a Treasure to gain a copy of the played card',
            body: [
              announce(CURRENT, ' discards ', CARD, ' to the rats.'),
              kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(DISCARD, CURRENT), 'discard', { faceUp: true }),
              iff(gt(countCards(zone(SUPPLY),
                eq(field(CARD, 'name'), getVar(WAY_NAME_VAR, CURRENT))), num(0)), [
                announce(CURRENT, ' gains a copy of the played card.'),
                kit.tmove(
                  specific(bestCard(zone(SUPPLY), 'highest', COST,
                    eq(field(CARD, 'name'), getVar(WAY_NAME_VAR, CURRENT)))),
                  zone(SUPPLY), zone(DISCARD, CURRENT), 'gain', { faceUp: true },
                ),
              ], [announce('No copy of the played card in the Supply — nothing gained.')]),
            ],
          }),
        ], [announce(CURRENT, ' has no Treasure to feed the rats.')]),
      ]),
    ]),

    // WAY OF THE SEAL — +$1 and the per-turn topdeck flag; the offer itself
    // is the 'gain'/'buy' watcher pair below (register).
    way('Way of the Seal',
      '+$1. This turn, when you gain a card, you may put it onto your deck.', [
        changeVar(COINS, num(1), CURRENT),
        setVar(SEAL_TURN_VAR, num(1), CURRENT),
        announce(CURRENT, ' may topdeck cards gained this turn (Way of the Seal).'),
      ]),

    // WAY OF THE SHEEP — exact: +$2.
    way('Way of the Sheep', '+$2.', [
      changeVar(COINS, num(2), CURRENT),
    ]),

    // WAY OF THE SQUIRREL — the per-turn counter; the +2 Cards per play land
    // in buildCleanupResets, after the cleanup redraw (printed timing).
    way('Way of the Squirrel', '+2 Cards at the end of this turn.', [
      changeVar(SQUIRREL_TURN_VAR, num(1), CURRENT),
      announce(CURRENT, ' will draw 2 extra cards at the end of this turn.'),
    ]),

    // WAY OF THE TURTLE — the duration-park (full mechanics in the register):
    // mark, shield with the Haven-aside mark, and park in the DURATION zone;
    // the phaseStart trigger below replays it next turn.
    way('Way of the Turtle',
      'Set the played card aside. If you did, play it at the start of your next turn.', [
        iff(hasPlayed(), [
          setVar(TURTLE_MARK, num(1), played()),
          setVar(HAVEN_ASIDE, num(1), played()),
          announce(CURRENT, ' sets ', played(), ' aside until their next turn.'),
          move(specific(played()), zone(INPLAY, CURRENT), zone(DURATION, CURRENT), { faceUp: true }),
        ]),
      ]),

    // WAY OF THE WORM — exact: Exile an Estate from the Supply.
    way('Way of the Worm', 'Exile an Estate from the Supply.',
      exileNamed('Estate', 'The Estate pile is empty — the worm goes hungry.')),
  ];
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { SUPPLY, TRASH, DECK, DISCARD, INPLAY, DURATION } = kit.zones;
  const { CARD } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer
   *  (for the cleanup sweep: the discarding player). */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /**
   * WAY OF THE SEAL's offer: while the gainer's per-turn flag is up, a
   * gained card may go onto their deck. Withheld when the card already left
   * for the trash or the supply, or was gained straight onto the deck.
   */
  const sealWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_way_seal_${tag}`,
    name: `Way of the Seal: a card is ${tag === 'buy' ? 'bought' : 'gained'} — topdeck it?`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        eq(getVar(SEAL_TURN_VAR, GAINER), num(1)),
        neq(cardZoneId(CARD), str(TRASH)),
        neq(cardZoneId(CARD), str(SUPPLY)),
        neq(cardZoneId(CARD), str(DECK)),
      ), [
        yesNo(GAINER, 'Way of the Seal: put the card you just gained onto your deck?'),
        iff(kit.CHOICE, [
          announce(GAINER, ' puts the gained ', CARD, ' onto their deck.'),
          move(specific(CARD), zone(DISCARD, GAINER), zone(DECK, GAINER),
            { toPosition: 'top', faceUp: false }),
        ]),
      ]),
    ],
  });

  /**
   * WAY OF THE FROG's rider: the marked card leaves play for a discard pile
   * ('cleanup' = the sweep, 'discard' = mid-turn discards from play) and
   * heads onto its owner's deck instead. The mark always clears; the move is
   * skipped when the card is no longer in a discard pile (the cleanup redraw
   * may have reshuffled it — timing note in the register).
   */
  const frogWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_way_frog_${tag}`,
    name: 'Way of the Frog: the played card leaves play — onto the deck',
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: eq(getVar(FROG_MARK, CARD), num(1)),
    script: [
      setVar(FROG_MARK, num(0), CARD),
      iff(eq(cardZoneId(CARD), str(DISCARD)), [
        announce(GAINER, "'s ", CARD, ' hops onto their deck (Way of the Frog).'),
        move(specific(CARD), zone(DISCARD, GAINER), zone(DECK, GAINER),
          { toPosition: 'top', faceUp: false }),
      ]),
    ],
  });

  /**
   * WAY OF THE TURTLE's return: at the owner's action-phase start every
   * Turtle-marked card in their DURATION zone comes out of its shell — marks
   * clear, the card marches to In Play untagged, and kit.playAgain re-fires
   * its play moment (the synthetic 'play' event resolves after this
   * phaseStart pass — see the register). No Action is spent, as printed.
   */
  const turtleReturn = (): TriggerDef => ({
    id: 'dom_trigger_way_turtle_return',
    name: 'Way of the Turtle: the set-aside card is played',
    event: { kind: 'phaseStart', phaseId: PHASE_ACTION },
    condition: null,
    script: [
      forEachCard(zone(DURATION, CURRENT), eq(getVar(TURTLE_MARK, CARD), num(1)), [
        setVar(TURTLE_MARK, num(0), CARD),
        setVar(HAVEN_ASIDE, num(0), CARD),
        announce(CURRENT, ' plays the set-aside ', CARD, ' (Way of the Turtle).'),
        move(specific(CARD), zone(DURATION, CURRENT), zone(INPLAY, CURRENT), { faceUp: true }),
        kit.playAgain(CARD),
      ]),
    ],
  });

  return [
    sealWatch('gain'),
    sealWatch('buy'),
    frogWatch('cleanup'),
    frogWatch('discard'),
    turtleReturn(),
  ];
}

export const menagerieWays: ExpansionModule = {
  id: 'menagerieWays',
  setName: 'Menagerie',

  piles: [],

  ids: IDS,

  landscapes: [
    { name: 'Way of the Butterfly', cost: 0, kind: 'way' },
    { name: 'Way of the Camel', cost: 0, kind: 'way' },
    { name: 'Way of the Frog', cost: 0, kind: 'way' },
    { name: 'Way of the Goat', cost: 0, kind: 'way' },
    { name: 'Way of the Horse', cost: 0, kind: 'way' },
    { name: 'Way of the Mole', cost: 0, kind: 'way' },
    { name: 'Way of the Monkey', cost: 0, kind: 'way' },
    { name: 'Way of the Mule', cost: 0, kind: 'way' },
    { name: 'Way of the Otter', cost: 0, kind: 'way' },
    { name: 'Way of the Owl', cost: 0, kind: 'way' },
    { name: 'Way of the Ox', cost: 0, kind: 'way' },
    { name: 'Way of the Pig', cost: 0, kind: 'way' },
    { name: 'Way of the Rat', cost: 0, kind: 'way' },
    { name: 'Way of the Seal', cost: 0, kind: 'way' },
    { name: 'Way of the Sheep', cost: 0, kind: 'way' },
    { name: 'Way of the Squirrel', cost: 0, kind: 'way' },
    { name: 'Way of the Turtle', cost: 0, kind: 'way' },
    { name: 'Way of the Worm', cost: 0, kind: 'way' },
  ],

  variables: [
    {
      id: WAY_NAME_VAR, name: 'Way of the Rat: the played card name',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
    {
      id: SEAL_TURN_VAR, name: 'Way of the Seal: active this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: SQUIRREL_TURN_VAR, name: 'Way of the Squirrel: plays this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: FROG_MARK, name: 'Way of the Frog: topdeck when discarded from play',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
    {
      id: TURTLE_MARK, name: 'Way of the Turtle: set aside',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  buildCards,
  buildTriggers,

  buildCleanupResets(kit: CardKit): Block[] {
    // The Squirrel payout rides here deliberately: buildCleanupResets runs
    // inside the cleanup action AFTER the sweep and the 5-card redraw — the
    // printed "+2 Cards at the end of this turn" timing. Then the per-turn
    // Way state fades for everyone.
    return [
      iff(gt(getVar(SQUIRREL_TURN_VAR, CURRENT), num(0)), [
        announce(CURRENT, ' draws 2 cards per Squirrel play (Way of the Squirrel).'),
        kit.drawN(CURRENT, mul(getVar(SQUIRREL_TURN_VAR, CURRENT), num(2))),
      ]),
      forEachPlayer([
        setVar(SQUIRREL_TURN_VAR, num(0), kit.PLAYER),
        setVar(SEAL_TURN_VAR, num(0), kit.PLAYER),
      ]),
    ];
  },
};
