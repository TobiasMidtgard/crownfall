/**
 * Renaissance — the Projects (landscape sideboard, kind 'project'): 17 of the
 * printed 20 ship. Cathedral, City Gate, Pageant, Sewers, Fair, Silos,
 * Sinister Plot, Exploration, Academy, Guildhall, Piazza, Road Network,
 * Barracks, Crop Rotation, Innovation, Canal, Citadel.
 *
 * THE PROJECT MECHANISM (kit.ts contract): each project is ONE landscape card
 * that never leaves the sideboard + ONE non-hidden perPlayer claim flag
 * ('dom_var_proj_<slug>', so the scoreboard shows ownership) + ONE buy action
 * 'dom_action_buy_project_<slug>' (the core sweeps that id prefix into the
 * buy phase automatically): target the card in the landscapes zone, legality
 * = right name + your flag still 0 + a buy left + printed cost <= coins + no
 * debt; the script pays the coins, spends the buy and raises the flag. Every
 * standing effect below gates on the buyer's flag, so an unclaimed or
 * unpicked project does exactly nothing (probed). Both players can claim the
 * same project; neither can claim it twice.
 *
 * EXCLUSIONS (inexpressible printed rules are never faked — 3 of 20):
 *  - FLEET ("After the game ends, there's an extra round of turns just for
 *    players with this"): extra/out-of-order turns have no engine surface
 *    (the Possession/Outpost precedent). Excluded entirely.
 *  - STAR CHART ("When you shuffle, you may pick one of the cards to go on
 *    top"): the reshuffle is the draw block's INLINE seeded refill — no
 *    shuffle event exists to hook, so the pick has nowhere to live. Excluded.
 *  - CAPITALISM ("During your turns, Actions with +$ amounts in their text
 *    are also Treasures"): a card has ONE fixed primary type def-wide and
 *    the treasure action's legality is core surface (the Charlatan
 *    precedent). Excluded.
 *
 * DEVIATIONS register (details in the per-project comments):
 *  - EXPLORATION COSTS $4 (the printed card; an upstream brief said $8 —
 *    print wins). Verified against the Renaissance card list.
 *  - TURN-START ORDER is fixed (paper: the owner orders their own start-of-
 *    turn effects): Canal, Barracks, Fair, Silos, Crop Rotation, Sinister
 *    Plot, City Gate, Cathedral, Piazza. Piazza runs last so a City Gate
 *    topdeck can feed it, as on paper. Duration "next turn" halves resolve
 *    AFTER all of these (they ride the action-phase start, not turn start).
 *  - SEWERS: every trash is attributed to the CURRENT player — only the
 *    current player's Sewers fires, and it offers THEIR hand (the enter-zone
 *    event carries no trasher for the shared trash). An opponent trashing on
 *    your turn (Bishop's offer) therefore feeds YOUR Sewers, not theirs.
 *    The Sewers-caused trash wears a hidden per-card mark so it can never
 *    re-trigger Sewers ("other than with this" — probed, no chain).
 *  - CANAL: the engine's one cost lever is the global per-turn DISCOUNT
 *    (Bridge's), so Canal adds +1 DISCOUNT at each of the owner's turn
 *    starts; cleanup resets it, so only the owner's own turns are discounted
 *    (matching "during your turns"). Differences from paper: a Canal bought
 *    mid-buy-phase starts discounting NEXT turn (printed: immediately), and
 *    the discount stacks into the same global with Bridge/Quarry effects.
 *    Project and Event buys are never discounted (core rule: the DISCOUNT
 *    applies to CARD costs).
 *  - INNOVATION: no set-aside stop — the first Action gained on your turn
 *    offers a yes/no and, on yes, the card plays straight from wherever it
 *    landed (discard / deck-top) via a 'play'-tagged move. The once-per-turn
 *    chance is consumed by the FIRST Action gain whether or not you accept
 *    (printed timing). Gains on other players' turns never qualify. The
 *    offer is withheld if the card already left for the trash (Watchtower).
 *  - CITADEL: exact via a first-Action-play watcher; the second play is the
 *    Throne Room mechanism (triggerAbilities), so a doubled Duration card
 *    parks once and its next-turn half fires once (the kit's documented
 *    contract). The used-this-turn flag is raised BEFORE the replay, so the
 *    synthetic 'play' event cannot re-trigger it.
 *  - PAGEANT / EXPLORATION ride the cleanup-phase START (the manual Cleanup
 *    phase begins when the Buy phase ends, before counters reset) — the
 *    printed "at the end of your Buy phase" timing. Exploration's "didn't
 *    buy any cards" is a hidden per-turn flag fed by 'buy'-tagged card moves
 *    only, so buying Events or Projects does not spoil it (printed ruling).
 *  - PIAZZA's reveal is announced to the shared log (reveals are public on
 *    paper); the played card spends no Action, and an empty deck+discard
 *    reveals nothing. CATHEDRAL / CITY GATE / CROP ROTATION / SILOS guard
 *    their prompts on an empty hand so a session can never hang.
 *  - ROAD NETWORK: strictly two seats, so "another player" is the one
 *    opponent; the owner draws per Victory card the opponent gains — exact.
 */
import type {
  ActionDef, Block, CardDef, Expr, TriggerDef, VariableDef,
} from '../../shared/types';
import {
  ALL, CURRENT, allOf, announce, bnd, cardZoneId, changeVar, chooseCard, chooseCardsBlock,
  chooseOption, countCards, eq, field, forEachPlayer, getVar, gt, iff, lte, move, neg, neq, num,
  setVar, shuffle, specific, str, topCard, zone, zoneCount,
} from '../../examples/dsl';
import type { CardKit, ExpansionModule } from './kit';

const IDS: Record<string, string> = {
  Cathedral: 'dom_card_cathedral',
  'City Gate': 'dom_card_city_gate',
  Pageant: 'dom_card_pageant',
  Sewers: 'dom_card_sewers',
  Fair: 'dom_card_fair',
  Silos: 'dom_card_silos',
  'Sinister Plot': 'dom_card_sinister_plot',
  Exploration: 'dom_card_exploration',
  Academy: 'dom_card_academy',
  Guildhall: 'dom_card_guildhall',
  Piazza: 'dom_card_piazza',
  'Road Network': 'dom_card_road_network',
  Barracks: 'dom_card_barracks',
  'Crop Rotation': 'dom_card_crop_rotation',
  Innovation: 'dom_card_innovation',
  Canal: 'dom_card_canal',
  Citadel: 'dom_card_citadel',
};

/** The landscape sideboard + the phase ids (stable dominionGame.ts literals). */
const LANDSCAPES = 'dom_zone_landscapes';
const PHASE_CLEANUP = 'dom_phase_cleanup';

/** A card was bought (a CARD, not an Event/Project) this turn — Exploration. */
export const REN_BOUGHT = 'dom_var_ren_bought_card';
/** Citadel already doubled an Action this turn. */
export const CITADEL_USED = 'dom_var_ren_citadel_used';
/** Innovation's once-per-turn chance is spent. */
export const INNOVATION_USED = 'dom_var_ren_innovation_used';
/** This card was trashed BY Sewers — its trash must not re-trigger Sewers. */
export const SEWERS_MARK = 'dom_var_ren_sewers_mark';
/** Sinister Plot's per-player token pile (player-facing, like Coffers). */
export const SINISTER_TOKENS = 'dom_var_ren_sinister_tokens';

/** The claim flag for one project (non-hidden — the scoreboard shows it). */
export const projectFlag = (slug: string): string => `dom_var_proj_${slug}`;

interface ProjectSpec { name: string; slug: string; cost: number; text: string }

/** The 17 shipped projects, printed costs and texts (verified against the
 *  Renaissance card list; Fleet / Star Chart / Capitalism are excluded —
 *  see the header). */
const PROJECTS: ProjectSpec[] = [
  { name: 'Cathedral', slug: 'cathedral', cost: 3, text: 'At the start of your turn, trash a card from your hand.' },
  { name: 'City Gate', slug: 'city_gate', cost: 3, text: 'At the start of your turn, +1 Card, then put a card from your hand onto your deck.' },
  { name: 'Pageant', slug: 'pageant', cost: 3, text: 'At the end of your Buy phase, you may pay $1 for +1 Coffers.' },
  { name: 'Sewers', slug: 'sewers', cost: 3, text: 'When you trash a card other than with this, you may trash a card from your hand.' },
  { name: 'Exploration', slug: 'exploration', cost: 4, text: "At the end of your Buy phase, if you didn't buy any cards, +1 Coffers and +1 Villager." },
  { name: 'Fair', slug: 'fair', cost: 4, text: 'At the start of your turn, +1 Buy.' },
  { name: 'Silos', slug: 'silos', cost: 4, text: 'At the start of your turn, discard any number of Coppers, revealed, and draw that many cards.' },
  { name: 'Sinister Plot', slug: 'sinister_plot', cost: 4, text: 'At the start of your turn, add a token here, or remove your tokens here for +1 Card each.' },
  { name: 'Academy', slug: 'academy', cost: 5, text: 'When you gain an Action card, +1 Villager.' },
  { name: 'Guildhall', slug: 'guildhall', cost: 5, text: 'When you gain a Treasure, +1 Coffers.' },
  { name: 'Piazza', slug: 'piazza', cost: 5, text: "At the start of your turn, reveal the top card of your deck. If it's an Action, play it." },
  { name: 'Road Network', slug: 'road_network', cost: 5, text: 'When another player gains a Victory card, +1 Card.' },
  { name: 'Barracks', slug: 'barracks', cost: 6, text: 'At the start of your turn, +1 Action.' },
  { name: 'Crop Rotation', slug: 'crop_rotation', cost: 6, text: 'At the start of your turn, you may discard a Victory card for +2 Cards.' },
  { name: 'Innovation', slug: 'innovation', cost: 6, text: 'The first time you gain an Action card in each of your turns, you may set it aside. If you do, play it.' },
  { name: 'Canal', slug: 'canal', cost: 7, text: 'During your turns, cards cost $1 less, but not less than $0.' },
  { name: 'Citadel', slug: 'citadel', cost: 8, text: 'The first time you play an Action card during each of your turns, play it again afterwards.' },
];

/** "`who` has claimed this project" (fresh nodes per call). */
const owns = (slug: string, who: Expr): Expr => eq(getVar(projectFlag(slug), who), num(1));

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

/** Projects are plain landscape cards: their whole game lives in the module's
 *  buy actions + triggers, so no abilities. */
function buildCards(kit: CardKit): CardDef[] {
  return PROJECTS.map((p) => kit.cardDef(IDS[p.name], p.name, p.cost, 0, 0, `Project. ${p.text}`));
}

/** One claim action per project (see the header's mechanism note). Projects
 *  pay the PRINTED cost — never Bridge-discounted (they are not cards). */
function buildActions(kit: CardKit): ActionDef[] {
  const { BUYS, COINS, DEBT } = kit.vars;
  const { COST } = kit.fields;
  return PROJECTS.map((p): ActionDef => ({
    id: `dom_action_buy_project_${p.slug}`,
    name: `Buy Project: ${p.name}`,
    target: { kind: 'cardInZone', zoneId: LANDSCAPES, ownerOnly: false },
    legality: allOf(
      kit.nameIs(p.name),
      eq(getVar(projectFlag(p.slug)), num(0)),
      gt(getVar(BUYS), num(0)),
      lte(field(kit.CARD, COST), getVar(COINS)),
      // Debt blocks project buys too, like every purchase.
      eq(getVar(DEBT), num(0)),
    ),
    script: [
      changeVar(COINS, neg(field(kit.CARD, COST))),
      changeVar(BUYS, num(-1)),
      setVar(projectFlag(p.slug), num(1)),
      announce(CURRENT, ' buys the ', kit.CARD, ' project.'),
    ],
  }));
}

function buildTriggers(kit: CardKit): TriggerDef[] {
  const { TRASH, DECK, HAND, DISCARD, INPLAY } = kit.zones;
  const { ACTIONS, BUYS, COINS, SCRATCH, DISCOUNT, COFFERS, VILLAGERS } = kit.vars;
  const { CARD, CHOICE, PLAYER } = kit;
  /** cardEnterZone binds $owner = the destination zone's owner — the gainer /
   *  player (null for the shared trash, hence Sewers' CURRENT deviation). */
  const GAINER = bnd('$owner');

  // Fresh nodes per trigger (factories) — triggers must not share mutable
  // block objects (the def is keeper-editable stored data).

  /** A start-of-turn project effect, gated on the current player's flag. */
  const turnRule = (slug: string, name: string, script: Block[]): TriggerDef => ({
    id: `dom_trigger_ren_${slug}`,
    name: `${name}: at the start of your turn`,
    event: { kind: 'turnStart' },
    condition: owns(slug, CURRENT),
    script,
  });

  /** ACADEMY — "When you gain an Action card, +1 Villager." Exact. */
  const academyWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_ren_academy_${tag}`,
    name: `Academy: an Action is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(kit.isA(CARD, kit.types.ACTION), owns('academy', GAINER)), [
        changeVar(VILLAGERS, num(1), GAINER),
        announce(GAINER, ' trains a Villager at the Academy.'),
      ]),
    ],
  });

  /** GUILDHALL — "When you gain a Treasure, +1 Coffers." Exact. */
  const guildhallWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_ren_guildhall_${tag}`,
    name: `Guildhall: a Treasure is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(kit.isA(CARD, kit.types.TREASURE), owns('guildhall', GAINER)), [
        changeVar(COFFERS, num(1), GAINER),
        announce(GAINER, ' banks a Coffers at the Guildhall.'),
      ]),
    ],
  });

  /** ROAD NETWORK — the OTHER player gaining a Victory card feeds the owner
   *  +1 Card. Exact on the two-seat table. */
  const roadNetworkWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_ren_road_network_${tag}`,
    name: `Road Network: a Victory card is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(kit.isA(CARD, kit.types.VICTORY), [
        forEachPlayer([
          iff(allOf(owns('road_network', PLAYER), neq(PLAYER, GAINER)), [
            announce(PLAYER, ' draws a card along the Road Network.'),
            kit.draw(PLAYER, 1),
          ]),
        ]),
      ]),
    ],
  });

  /** INNOVATION — first Action gain on YOUR turn: may play it right away
   *  (header register: no set-aside stop; chance spent even on decline). */
  const innovationWatch = (tag: string): TriggerDef => ({
    id: `dom_trigger_ren_innovation_${tag}`,
    name: `Innovation: an Action is ${tag === 'buy' ? 'bought' : 'gained'}`,
    event: { kind: 'cardEnterZone', zoneId: null, tag },
    condition: null,
    script: [
      iff(allOf(
        kit.isA(CARD, kit.types.ACTION),
        owns('innovation', GAINER),
        eq(GAINER, CURRENT),
        eq(getVar(INNOVATION_USED, GAINER), num(0)),
      ), [
        setVar(INNOVATION_USED, num(1), GAINER),
        // Withheld when the gained card already left for the trash (a
        // Watchtower answered first) — the specific-move's advisory `from`
        // would otherwise pull it back out.
        iff(neq(cardZoneId(CARD), str(TRASH)), [
          yesNo(GAINER, 'Innovation: play the gained Action card now?'),
          iff(CHOICE, [
            announce(GAINER, ' plays ', CARD, ' with Innovation.'),
            kit.tmove(specific(CARD), zone(DISCARD, GAINER), zone(INPLAY, GAINER), 'play', { faceUp: true }),
          ]),
        ]),
      ]),
    ],
  });

  /** SEWERS — a trash lands: the CURRENT player's Sewers may trash another
   *  hand card (attribution deviation + the no-chain mark in the header). */
  const sewersWatch = (): TriggerDef => ({
    id: 'dom_trigger_ren_sewers',
    name: 'Sewers: a card is trashed',
    event: { kind: 'cardEnterZone', zoneId: TRASH, tag: 'trash' },
    condition: null,
    script: [
      iff(allOf(
        owns('sewers', CURRENT),
        eq(getVar(SEWERS_MARK, CARD), num(0)),
        gt(zoneCount(zone(HAND, CURRENT)), num(0)),
      ), [
        chooseCardsBlock({
          who: CURRENT, from: zone(HAND, CURRENT), min: num(0), max: num(1),
          prompt: 'Sewers: you may trash a card from your hand',
          body: [
            setVar(SEWERS_MARK, num(1), CARD),
            announce(CURRENT, ' trashes ', CARD, ' into the Sewers.'),
            kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(TRASH), 'trash', { faceUp: true }),
          ],
        }),
      ]),
    ],
  });

  /** CITADEL — the turn's first Action play plays again (the Throne Room
   *  mechanism; the used-flag is raised first so the synthetic 'play' event
   *  can never loop). */
  const citadelWatch = (): TriggerDef => ({
    id: 'dom_trigger_ren_citadel',
    name: 'Citadel: the first Action play of the turn',
    event: { kind: 'cardEnterZone', zoneId: INPLAY, tag: 'play' },
    condition: null,
    script: [
      iff(allOf(
        kit.isA(CARD, kit.types.ACTION),
        owns('citadel', GAINER),
        eq(getVar(CITADEL_USED, GAINER), num(0)),
      ), [
        setVar(CITADEL_USED, num(1), GAINER),
        announce(GAINER, "'s Citadel echoes ", CARD, ' — it plays again.'),
        kit.playAgain(CARD),
      ]),
    ],
  });

  /** EXPLORATION's bookkeeping: a CARD was bought this turn ('buy'-tagged
   *  moves only — Events/Projects move no card, so they never spoil it). */
  const boughtWatch = (): TriggerDef => ({
    id: 'dom_trigger_ren_bought_card',
    name: 'Exploration: a card was bought this turn',
    event: { kind: 'cardEnterZone', zoneId: null, tag: 'buy' },
    condition: null,
    script: [
      iff(owns('exploration', GAINER), [setVar(REN_BOUGHT, num(1), GAINER)]),
    ],
  });

  /** PAGEANT — the Buy phase just ended (the manual Cleanup phase begins,
   *  coins not yet reset): you may pay $1 for +1 Coffers. */
  const pageantRule = (): TriggerDef => ({
    id: 'dom_trigger_ren_pageant',
    name: 'Pageant: the Buy phase ends',
    event: { kind: 'phaseStart', phaseId: PHASE_CLEANUP },
    condition: null,
    script: [
      iff(allOf(owns('pageant', CURRENT), gt(getVar(COINS, CURRENT), num(0))), [
        yesNo(CURRENT, 'Pageant: pay $1 for +1 Coffers?'),
        iff(CHOICE, [
          changeVar(COINS, num(-1), CURRENT),
          changeVar(COFFERS, num(1), CURRENT),
          announce(CURRENT, ' pays the Pageant $1 for +1 Coffers.'),
        ]),
      ]),
    ],
  });

  /** EXPLORATION — Buy phase over with no card bought: +1 Coffers +1 Villager. */
  const explorationRule = (): TriggerDef => ({
    id: 'dom_trigger_ren_exploration',
    name: 'Exploration: the Buy phase ends',
    event: { kind: 'phaseStart', phaseId: PHASE_CLEANUP },
    condition: null,
    script: [
      iff(allOf(owns('exploration', CURRENT), eq(getVar(REN_BOUGHT, CURRENT), num(0))), [
        changeVar(COFFERS, num(1), CURRENT),
        changeVar(VILLAGERS, num(1), CURRENT),
        announce(CURRENT, ' bought no cards: +1 Coffers and +1 Villager from Exploration.'),
      ]),
    ],
  });

  return [
    // --- start-of-turn effects, in the documented fixed order --------------
    turnRule('canal', 'Canal', [
      changeVar(DISCOUNT, num(1)),
      announce(CURRENT, "'s Canal cuts every card's cost by $1 this turn."),
    ]),
    turnRule('barracks', 'Barracks', [
      changeVar(ACTIONS, num(1), CURRENT),
      announce(CURRENT, ' musters +1 Action from the Barracks.'),
    ]),
    turnRule('fair', 'Fair', [
      changeVar(BUYS, num(1), CURRENT),
      announce(CURRENT, ' gains +1 Buy from the Fair.'),
    ]),
    turnRule('silos', 'Silos', [
      iff(gt(countCards(zone(HAND, CURRENT), kit.nameIs('Copper')), num(0)), [
        setVar(SCRATCH, num(0), CURRENT),
        chooseCardsBlock({
          who: CURRENT, from: zone(HAND, CURRENT), filter: kit.nameIs('Copper'),
          min: num(0), max: num(99),
          prompt: 'Silos: discard any number of Coppers to draw that many cards',
          body: [
            announce(CURRENT, ' discards a Copper to the Silos.'),
            kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(DISCARD, CURRENT), 'discard', { faceUp: true }),
            changeVar(SCRATCH, num(1), CURRENT),
          ],
        }),
        kit.drawN(CURRENT, getVar(SCRATCH, CURRENT)),
      ]),
    ]),
    turnRule('crop_rotation', 'Crop Rotation', [
      iff(gt(countCards(zone(HAND, CURRENT), kit.isA(CARD, kit.types.VICTORY)), num(0)), [
        chooseCardsBlock({
          who: CURRENT, from: zone(HAND, CURRENT), filter: kit.isA(CARD, kit.types.VICTORY),
          min: num(0), max: num(1),
          prompt: 'Crop Rotation: you may discard a Victory card for +2 Cards',
          body: [
            announce(CURRENT, ' rotates ', CARD, ' out for +2 Cards.'),
            kit.tmove(specific(CARD), zone(HAND, CURRENT), zone(DISCARD, CURRENT), 'discard', { faceUp: true }),
            kit.draw(CURRENT, 2),
          ],
        }),
      ]),
    ]),
    turnRule('sinister_plot', 'Sinister Plot', [
      chooseOption('Sinister Plot: add a token, or cash in your tokens?', [
        { id: 'plot_add', label: 'Add a token' },
        { id: 'plot_cash', label: 'Remove your tokens: +1 Card each' },
      ], CURRENT),
      iff(eq(CHOICE, str('plot_add')), [
        changeVar(SINISTER_TOKENS, num(1), CURRENT),
        announce(CURRENT, ' adds a token to the Sinister Plot.'),
      ], [
        announce(CURRENT, ' cashes in the Sinister Plot tokens.'),
        kit.drawN(CURRENT, getVar(SINISTER_TOKENS, CURRENT)),
        setVar(SINISTER_TOKENS, num(0), CURRENT),
      ]),
    ]),
    turnRule('city_gate', 'City Gate', [
      kit.draw(CURRENT, 1),
      iff(gt(zoneCount(zone(HAND, CURRENT)), num(0)), [
        chooseCard({
          who: CURRENT, from: zone(HAND, CURRENT),
          prompt: 'City Gate: put a card from your hand onto your deck',
        }),
        announce(CURRENT, ' tops their deck at the City Gate.'),
        move(specific(CHOICE), zone(HAND, CURRENT), zone(DECK, CURRENT),
          { toPosition: 'top', faceUp: false }),
      ]),
    ]),
    turnRule('cathedral', 'Cathedral', [
      iff(gt(zoneCount(zone(HAND, CURRENT)), num(0)), [
        chooseCard({
          who: CURRENT, from: zone(HAND, CURRENT),
          prompt: 'Cathedral: trash a card from your hand',
        }),
        announce(CURRENT, ' trashes ', CHOICE, ' at the Cathedral.'),
        kit.tmove(specific(CHOICE), zone(HAND, CURRENT), zone(TRASH), 'trash', { faceUp: true }),
      ], [announce(CURRENT, ' has nothing to offer the Cathedral.')]),
    ]),
    turnRule('piazza', 'Piazza', [
      refillDeck(kit, CURRENT),
      iff(gt(zoneCount(zone(DECK, CURRENT)), num(0)), [
        announce(CURRENT, ' reveals ', topCard(zone(DECK, CURRENT)), ' at the Piazza.'),
        iff(kit.isA(topCard(zone(DECK, CURRENT)), kit.types.ACTION), [
          announce(CURRENT, ' plays it.'),
          kit.tmove(specific(topCard(zone(DECK, CURRENT))),
            zone(DECK, CURRENT), zone(INPLAY, CURRENT), 'play', { faceUp: true }),
        ], [announce('It is not an Action — it stays on the deck.')]),
      ], [announce(CURRENT, ' has no card to reveal at the Piazza.')]),
    ]),
    // --- standing watchers --------------------------------------------------
    academyWatch('gain'),
    academyWatch('buy'),
    guildhallWatch('gain'),
    guildhallWatch('buy'),
    roadNetworkWatch('gain'),
    roadNetworkWatch('buy'),
    innovationWatch('gain'),
    innovationWatch('buy'),
    sewersWatch(),
    citadelWatch(),
    boughtWatch(),
    pageantRule(),
    explorationRule(),
  ];
}

export const renaissanceProjects: ExpansionModule = {
  id: 'renaissanceProjects',
  setName: 'Renaissance',

  piles: [],

  ids: IDS,

  landscapes: PROJECTS.map((p) => ({ name: p.name, cost: p.cost, kind: 'project' as const })),

  variables: [
    // The claim flags — non-hidden, so ownership shows on the scoreboard.
    ...PROJECTS.map((p): VariableDef => ({
      id: projectFlag(p.slug), name: `Project: ${p.name}`,
      scope: 'perPlayer', type: 'number', initial: 0,
    })),
    {
      id: SINISTER_TOKENS, name: 'Sinister Plot tokens',
      scope: 'perPlayer', type: 'number', initial: 0,
    },
    {
      id: REN_BOUGHT, name: 'Renaissance: bought a card this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: CITADEL_USED, name: 'Citadel: doubled an Action this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: INNOVATION_USED, name: 'Innovation: chance spent this turn',
      scope: 'perPlayer', type: 'number', initial: 0, hidden: true,
    },
    {
      id: SEWERS_MARK, name: 'Sewers: trashed via Sewers',
      scope: 'perCard', type: 'number', initial: 0, hidden: true,
    },
  ] as VariableDef[],

  buildCards,
  buildActions,
  buildTriggers,

  buildCleanupResets(kit: CardKit): Block[] {
    return [forEachPlayer([
      setVar(REN_BOUGHT, num(0), kit.PLAYER),
      setVar(CITADEL_USED, num(0), kit.PLAYER),
      setVar(INNOVATION_USED, num(0), kit.PLAYER),
    ])];
  },
};
