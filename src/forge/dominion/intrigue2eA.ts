/**
 * Intrigue 2E (part A) — Courtyard, Lurker, Pawn, Masquerade, Shanty Town,
 * Steward, Swindler, Wishing Well, Baron.
 *
 * Deviations from the paper rules are documented in a comment above each
 * card's definition. House idioms: attack halves are separate stacked
 * abilities gated per-victim on IMMUNE == 0 (never reset here — the shared
 * effectResolved trigger clears it); every mandatory choice is guarded so an
 * empty prompt can never hang; numbers that must survive a filter's $card
 * rebinding ride the per-player SCRATCH variable.
 */
import type { Block, CardDef } from '../../shared/types';
import {
  ALL, announce, changeVar, chooseCard, chooseCardsBlock, chooseOption, countCards, eq, field,
  forEachOpponent, forEachPlayer, getVar, gt, iff, lt, nextPlayer, num, setVar, shuffle, specific,
  str, topCard, zone, zoneCount, bestCard,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Courtyard: 'dom_card_courtyard',
  Lurker: 'dom_card_lurker',
  Pawn: 'dom_card_pawn',
  Masquerade: 'dom_card_masquerade',
  'Shanty Town': 'dom_card_shanty_town',
  Steward: 'dom_card_steward',
  Swindler: 'dom_card_swindler',
  'Wishing Well': 'dom_card_wishing_well',
  Baron: 'dom_card_baron',
};

/** Wishing Well's named card — strings cannot ride the numeric SCRATCH. */
export const WISH_VAR = 'dom_var_wish';

function buildCards(kit: CardKit): CardDef[] {
  const { SUPPLY, TRASH, DECK, HAND, DISCARD } = kit.zones;
  const { ACTIONS, BUYS, COINS, IMMUNE, SCRATCH } = kit.vars;
  const { COST } = kit.fields;
  const { OWNER, CARD, CHOICE, PLAYER } = kit;

  /** Empty deck → flip the discard in face-down and shuffle (paper reshuffle). */
  const reshuffleIfEmpty = (owner: typeof OWNER): Block =>
    iff(eq(zoneCount(zone(DECK, owner)), num(0)), [
      kit.tmove(ALL, zone(DISCARD, owner), zone(DECK, owner), 'reshuffle', { faceUp: false }),
      shuffle(zone(DECK, owner)),
    ]);

  /**
   * Else-chain over option ids: iff($choice == a) [...] else iff(...) — the
   * final id needs no test (it is the only answer left). Safe against $choice
   * rebinding: sibling conditions are decided BEFORE any branch's nested
   * choose runs (only one branch ever executes).
   */
  const optionChain = (ids: string[], handle: (id: string) => Block[]): Block[] => {
    const [head, ...rest] = ids;
    if (rest.length === 0) return handle(head);
    return [iff(eq(CHOICE, str(head)), handle(head), optionChain(rest, handle))];
  };

  // --- Pawn plumbing -----------------------------------------------------
  const PAWN_OPTIONS = [
    { id: 'pawn_card', label: '+1 Card' },
    { id: 'pawn_action', label: '+1 Action' },
    { id: 'pawn_buy', label: '+1 Buy' },
    { id: 'pawn_coin', label: '+$1' },
  ];
  /** Fresh node per call — branches must not share mutable block objects. */
  const pawnGrant = (id: string): Block => {
    switch (id) {
      case 'pawn_card': return kit.draw(OWNER, 1);
      case 'pawn_action': return changeVar(ACTIONS, num(1), OWNER);
      case 'pawn_buy': return changeVar(BUYS, num(1), OWNER);
      default: return changeVar(COINS, num(1), OWNER);
    }
  };

  return [
    kit.cardDef(IDS.Courtyard, 'Courtyard', 2, 0, 0,
      '+3 Cards. Put a card from your hand onto your deck.', [
        kit.onPlay('dom_ab_courtyard', 'Whispers in the courtyard', [
          kit.draw(OWNER, 3),
          // Guarded: with an empty hand (deck + discard exhausted) there is
          // nothing to put back and the mandatory choice must not fire.
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCard({
              who: OWNER, from: zone(HAND, OWNER),
              prompt: 'Courtyard: put a card from your hand onto your deck',
            }),
            announce(OWNER, ' puts a card onto their deck.'),
            kit.tmove(specific(CHOICE), zone(HAND, OWNER), zone(DECK, OWNER), 'topdeck',
              { toPosition: 'top', faceUp: false }),
          ]),
        ]),
      ]),

    kit.cardDef(IDS.Lurker, 'Lurker', 2, 0, 0,
      '+1 Action. Choose one: Trash an Action card from the Supply; or gain an Action card from the trash.', [
        kit.onPlay('dom_ab_lurker', 'Skulking about', [
          changeVar(ACTIONS, num(1), OWNER),
          chooseOption('Lurker: choose one', [
            { id: 'lurker_trash', label: 'Trash an Action card from the Supply' },
            { id: 'lurker_gain', label: 'Gain an Action card from the trash' },
          ], OWNER),
          iff(eq(CHOICE, str('lurker_trash')), [
            iff(gt(countCards(zone(SUPPLY), kit.IS_ACTION_CARD), num(0)), [
              kit.choosePileBlock({
                who: OWNER, from: zone(SUPPLY), filter: kit.IS_ACTION_CARD,
                prompt: 'Lurker: trash an Action card from the Supply',
                body: [
                  announce(OWNER, ' trashes ', CARD, ' from the Supply.'),
                  kit.tmove(specific(CARD), zone(SUPPLY), zone(TRASH), 'trash', { faceUp: true }),
                ],
              }),
            ], [announce('No Action card waits in the Supply to trash.')]),
          ], [
            iff(gt(countCards(zone(TRASH), kit.IS_ACTION_CARD), num(0)), [
              kit.choosePileBlock({
                who: OWNER, from: zone(TRASH), filter: kit.IS_ACTION_CARD, revealed: true,
                prompt: 'Lurker: gain an Action card from the trash',
                body: [
                  announce(OWNER, ' gains ', CARD, ' from the trash.'),
                  kit.tmove(specific(CARD), zone(TRASH), zone(DISCARD, OWNER), 'gain', { faceUp: true }),
                ],
              }),
            ], [announce('The trash holds no Action card to gain.')]),
          ]),
        ]),
      ]),

    kit.cardDef(IDS.Pawn, 'Pawn', 2, 0, 0,
      'Choose two: +1 Card; +1 Action; +1 Buy; +$1. The choices must be different.', [
        kit.onPlay('dom_ab_pawn', 'Small moves', [
          chooseOption('Pawn: choose your first bonus', PAWN_OPTIONS, OWNER),
          ...optionChain(PAWN_OPTIONS.map((o) => o.id), (first) => {
            const rest = PAWN_OPTIONS.filter((o) => o.id !== first);
            return [
              pawnGrant(first),
              // Exact "must be different" semantics: the second menu simply
              // never offers the first pick.
              chooseOption('Pawn: choose a different second bonus', rest, OWNER),
              ...optionChain(rest.map((o) => o.id), (second) => [pawnGrant(second)]),
            ];
          }),
        ]),
      ]),

    // DEVIATION (Masquerade): the paper card passes simultaneously between
    // the players with cards in hand. Here the passes run SEQUENTIALLY in
    // turn order (owner first), each straight into the next player's hand —
    // so a later passer can hand on the very card they just received, and
    // the recipient is always the next seat to the left even if that seat
    // had no cards in hand ("next such player" is not skipped). Masquerade
    // is correctly NOT an attack: no response window, Moat cannot block it.
    kit.cardDef(IDS.Masquerade, 'Masquerade', 3, 0, 0,
      '+2 Cards. Each player with any cards in hand passes one to the next such player to their left, at once; then you may trash a card from your hand.', [
        kit.onPlay('dom_ab_masquerade', 'Behind the masks', [
          kit.draw(OWNER, 2),
          forEachPlayer([
            iff(gt(zoneCount(zone(HAND, PLAYER)), num(0)), [
              chooseCard({
                who: PLAYER, from: zone(HAND, PLAYER),
                prompt: 'Masquerade: pass a card to the player on your left',
              }),
              announce(PLAYER, ' passes a card to ', nextPlayer(PLAYER), '.'),
              kit.tmove(specific(CHOICE), zone(HAND, PLAYER), zone(HAND, nextPlayer(PLAYER)), 'pass',
                { faceUp: false }),
            ]),
          ]),
          iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), min: num(0), max: num(1),
              prompt: 'Masquerade: you may trash a card from your hand',
              body: [
                announce(OWNER, ' trashes ', CARD, '.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
              ],
            }),
          ]),
        ]),
      ]),

    kit.cardDef(IDS['Shanty Town'], 'Shanty Town', 3, 0, 0,
      '+2 Actions. Reveal your hand; if you have no Action cards in hand, +2 Cards.', [
        kit.onPlay('dom_ab_shanty_town', 'Nothing but shacks', [
          changeVar(ACTIONS, num(2), OWNER),
          announce(OWNER, ' reveals their hand.'),
          iff(eq(countCards(zone(HAND, OWNER), kit.IS_ACTION_CARD), num(0)), [
            announce(OWNER, ' holds no Action cards — +2 Cards.'),
            kit.draw(OWNER, 2),
          ]),
        ]),
      ]),

    kit.cardDef(IDS.Steward, 'Steward', 3, 0, 0,
      'Choose one: +2 Cards; or +$2; or trash 2 cards from your hand.', [
        kit.onPlay('dom_ab_steward', 'Faithful service', [
          chooseOption('Steward: choose one', [
            { id: 'steward_cards', label: '+2 Cards' },
            { id: 'steward_coins', label: '+$2' },
            { id: 'steward_trash', label: 'Trash 2 cards from your hand' },
          ], OWNER),
          iff(eq(CHOICE, str('steward_cards')), [
            kit.draw(OWNER, 2),
          ], [
            iff(eq(CHOICE, str('steward_coins')), [
              changeVar(COINS, num(2), OWNER),
            ], [
              // Trash exactly 2 — clamped to the hand when it holds fewer
              // (SCRATCH carries the clamp; the max stays 2).
              setVar(SCRATCH, num(2), OWNER),
              iff(lt(zoneCount(zone(HAND, OWNER)), num(2)), [
                setVar(SCRATCH, zoneCount(zone(HAND, OWNER)), OWNER),
              ]),
              iff(gt(zoneCount(zone(HAND, OWNER)), num(0)), [
                chooseCardsBlock({
                  who: OWNER, from: zone(HAND, OWNER),
                  min: getVar(SCRATCH, OWNER), max: num(2),
                  prompt: 'Steward: trash 2 cards from your hand',
                  body: [
                    announce(OWNER, ' trashes ', CARD, '.'),
                    kit.tmove(specific(CARD), zone(HAND, OWNER), zone(TRASH), 'trash', { faceUp: true }),
                  ],
                }),
              ]),
            ]),
          ]),
        ]),
      ]),

    // DEVIATION (Swindler): "same cost" compares PRINTED costs — a live
    // Bridge discount is ignored on both sides of the comparison (the two
    // discounts would cancel anyway except at the zero floor).
    kit.cardDef(IDS.Swindler, 'Swindler', 3, 0, 0,
      '+$2. Each other player trashes the top card of their deck and gains a card with the same cost that you choose.', [
        // Coins are immediate; only the attack half goes through the stack,
        // so Moat owners get a response window first (Militia's pattern).
        kit.onPlay('dom_ab_swindler_coins', 'Sleight of hand', [
          changeVar(COINS, num(2), OWNER),
        ]),
        kit.onPlay('dom_ab_swindler_attack', 'The old switcheroo', [
          forEachOpponent([
            iff(eq(getVar(IMMUNE, PLAYER), num(0)), [
              // Paper reshuffle: an empty deck flips the discard in first.
              reshuffleIfEmpty(PLAYER),
              iff(gt(zoneCount(zone(DECK, PLAYER)), num(0)), [
                // Stash the top card's cost BEFORE the supply filter rebinds
                // $card (SCRATCH is per-player: keyed to the victim).
                setVar(SCRATCH, field(topCard(zone(DECK, PLAYER)), COST), PLAYER),
                announce(PLAYER, ' trashes ', topCard(zone(DECK, PLAYER)), ' from the top of their deck.'),
                kit.tmove(specific(topCard(zone(DECK, PLAYER))), zone(DECK, PLAYER), zone(TRASH), 'trash',
                  { faceUp: true }),
                iff(gt(countCards(zone(SUPPLY), eq(field(CARD, COST), getVar(SCRATCH, PLAYER))), num(0)), [
                  // The ATTACKER picks; body runs with $player = victim and
                  // $card = the picked pile's top copy.
                  kit.choosePileBlock({
                    who: OWNER, from: zone(SUPPLY),
                    filter: eq(field(CARD, COST), getVar(SCRATCH, PLAYER)),
                    prompt: 'Swindler: choose the card the victim gains',
                    body: [
                      announce(PLAYER, ' gains ', CARD, '.'),
                      kit.tmove(specific(CARD), zone(SUPPLY), zone(DISCARD, PLAYER), 'gain', { faceUp: true }),
                    ],
                  }),
                ], [announce('The Supply has no card of that cost — nothing replaces it.')]),
              ], [announce(PLAYER, ' has no cards left to swindle.')]),
            ]),
          ]),
          // IMMUNE resets in the shared effectResolved trigger, per attack.
        ], true),
      ]),

    // DEVIATION (Wishing Well): "name a card" is expressed as picking a pile
    // from the live supply (revealed faces) — only cards currently present
    // in the supply can be named. The paper card allows naming anything.
    kit.cardDef(IDS['Wishing Well'], 'Wishing Well', 3, 0, 0,
      '+1 Card. +1 Action. Name a card, then reveal the top card of your deck. If you named it, put it into your hand.', [
        kit.onPlay('dom_ab_wishing_well', 'A coin for a wish', [
          kit.draw(OWNER, 1),
          changeVar(ACTIONS, num(1), OWNER),
          iff(gt(zoneCount(zone(SUPPLY)), num(0)), [
            kit.choosePileBlock({
              who: OWNER, from: zone(SUPPLY), revealed: true,
              prompt: 'Wishing Well: name a card',
              body: [
                setVar(WISH_VAR, field(CARD, 'name'), OWNER),
                announce(OWNER, ' wishes for ', CARD, '.'),
              ],
            }),
            // Paper reshuffle before revealing from an empty deck.
            reshuffleIfEmpty(OWNER),
            iff(gt(zoneCount(zone(DECK, OWNER)), num(0)), [
              announce(OWNER, ' reveals ', topCard(zone(DECK, OWNER)), '.'),
              iff(eq(field(topCard(zone(DECK, OWNER)), 'name'), getVar(WISH_VAR, OWNER)), [
                announce('The wish comes true — the card goes to their hand.'),
                kit.draw(OWNER, 1),
              ], [announce('The wish misses; the card stays on the deck.')]),
            ], [announce(OWNER, ' has no cards left to reveal.')]),
          ]),
        ]),
      ]),

    kit.cardDef(IDS.Baron, 'Baron', 4, 0, 0,
      '+1 Buy. You may discard an Estate for +$4. If you don’t, gain an Estate.', [
        kit.onPlay('dom_ab_baron', 'Landed gentry', [
          changeVar(BUYS, num(1), OWNER),
          // SCRATCH flags "an Estate was discarded" — reset FIRST (it may
          // hold a stale value from an earlier effect this turn).
          setVar(SCRATCH, num(0), OWNER),
          iff(gt(countCards(zone(HAND, OWNER), kit.nameIs('Estate')), num(0)), [
            chooseCardsBlock({
              who: OWNER, from: zone(HAND, OWNER), filter: kit.nameIs('Estate'),
              min: num(0), max: num(1),
              prompt: 'Baron: you may discard an Estate for +$4',
              body: [
                announce(OWNER, ' discards an Estate for +$4.'),
                kit.tmove(specific(CARD), zone(HAND, OWNER), zone(DISCARD, OWNER), 'discard', { faceUp: true }),
                changeVar(COINS, num(4), OWNER),
                setVar(SCRATCH, num(1), OWNER),
              ],
            }),
          ]),
          iff(eq(getVar(SCRATCH, OWNER), num(0)), [
            iff(gt(countCards(zone(SUPPLY), kit.nameIs('Estate')), num(0)), [
              announce(OWNER, ' gains an Estate.'),
              kit.tmove(
                specific(bestCard(zone(SUPPLY), 'highest', COST, kit.nameIs('Estate'))),
                zone(SUPPLY), zone(DISCARD, OWNER), 'gain', { faceUp: true },
              ),
            ], [announce('The Estate pile is empty — nothing gained.')]),
          ]),
        ]),
      ]),
  ];
}

export const intrigue2eA: ExpansionModule = {
  id: 'intrigue2eA',
  piles: [
    { name: 'Courtyard', cost: 2, count: 10 },
    { name: 'Lurker', cost: 2, count: 10 },
    { name: 'Pawn', cost: 2, count: 10 },
    { name: 'Masquerade', cost: 3, count: 10 },
    { name: 'Shanty Town', cost: 3, count: 10 },
    { name: 'Steward', cost: 3, count: 10 },
    { name: 'Swindler', cost: 3, count: 10 },
    { name: 'Wishing Well', cost: 3, count: 10 },
    { name: 'Baron', cost: 4, count: 10 },
  ],
  ids: IDS,
  buildCards,
  attackNames: ['Swindler'],
  variables: [
    {
      id: WISH_VAR, name: 'Wishing Well: named card',
      scope: 'perPlayer', type: 'string', initial: '', hidden: true,
    },
  ],
};
