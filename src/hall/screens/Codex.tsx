/**
 * Codex — the Dominion card browser. ONE source of truth with the engine:
 * the cards come from the seeded Dominion def (the keeper's edited copy when
 * present, the stock build otherwise) and every card renders through the
 * SAME CardView + template as the game table and the Forge's card list — a
 * card looks identical here, in the editor, and in play. Filter chips are
 * built from the def's card types + tags; cost bands from the cost field.
 */
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { Edit } from '../state/copy';
import { useReveal } from '../effects/useReveal';
import { CardView } from '../../components/CardView';
import { cardPreview } from '../../designer/designerUtils';
import { getGameById } from '../../state/store';
import { DOMINION_GAME_ID } from '../../forge/seedDominion';
import { buildDominionDef } from '../../forge/dominionGame';
import type { CardDef, GameDef } from '../../shared/types';
import { COST_BANDS, COST_LABELS, type CostBand } from './codexCards';

type CostFilter = 'all' | CostBand;
/** 'all' | 'type:<id>' | 'tag:<id>' — types and tags share one chip row. */
type LineFilter = string;

const COST_FIELD = 'dom_field_cost';

function cardCost(c: CardDef): number {
  return Number(c.fields[COST_FIELD] ?? 0);
}

function matchesLine(c: CardDef, filter: LineFilter): boolean {
  if (filter === 'all') return true;
  const [kind, id] = [filter.slice(0, filter.indexOf(':')), filter.slice(filter.indexOf(':') + 1)];
  if (kind === 'type') return c.typeId === id;
  return (c.tags ?? []).includes(id);
}

export function Codex() {
  // The stored (possibly keeper-edited) def wins; the stock build backs it.
  const def: GameDef = useMemo(() => getGameById(DOMINION_GAME_ID) ?? buildDominionDef(), []);
  const [line, setLine] = useState<LineFilter>('all');
  const [cost, setCost] = useState<CostFilter>('all');
  // The reveal stagger plays once, on arrival. After the first filter press
  // the grid swaps instantly (the original re-rendered with no animation).
  const settled = useRef(false);
  const gridRef = useReveal<HTMLDivElement>();

  const pickLine = (t: LineFilter) => { settled.current = true; setLine(t); };
  const pickCost = (c: CostFilter) => { settled.current = true; setCost(c); };

  const lineChips: Array<[LineFilter, string]> = [
    ['all', 'All types'],
    ...(def.cardTypes ?? []).map((t): [LineFilter, string] => [`type:${t.id}`, t.name]),
    ...(def.cardTags ?? []).map((t): [LineFilter, string] => [`tag:${t.id}`, t.name]),
  ];
  const costChips: Array<[CostFilter, string]> = [
    ['all', 'Any cost'],
    ...(Object.keys(COST_BANDS) as CostBand[]).map((k): [CostFilter, string] => [k, COST_LABELS[k]]),
  ];

  const matches = def.cards.filter((c) =>
    matchesLine(c, line) &&
    (cost === 'all' || COST_BANDS[cost](cardCost(c))));

  return (
    <section className="screen" data-screen="codex" aria-labelledby="codex-title">
      <div className="codex">
        <header className="codex-head">
          <p className="eyebrow"><Edit id="codex-eyebrow" fallback="The Dominion codex" /></p>
          <h1 className="section-title" id="codex-title" tabIndex={-1}>
            <Edit id="codex-title" fallback="Every card, recorded." />
          </h1>
          <p className="codex-note">
            <Edit
              id="codex-note"
              fallback={`The hall's table, recorded in full: ${def.cards.length} cards, exactly as they sit on the table. Nothing in this hall is sealed.`}
            />
          </p>
        </header>

        <div className="codex-filters">
          <div className="filter-group" role="group" aria-label="Filter by type">
            {lineChips.map(([id, label]) => (
              <button
                key={id}
                className="filter-chip"
                type="button"
                aria-pressed={line === id}
                onClick={() => pickLine(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="filter-group" role="group" aria-label="Filter by cost">
            {costChips.map(([id, label]) => (
              <button
                key={id}
                className="filter-chip"
                type="button"
                aria-pressed={cost === id}
                onClick={() => pickCost(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="codex-grid" ref={gridRef}>
          {matches.length === 0 && (
            <p className="codex-empty">
              <Edit id="codex-empty" fallback="No cards answer this summons." />
            </p>
          )}
          {matches.map((card, i) => (
            <article
              key={card.id}
              className={`codex-cardwrap reveal${settled.current ? ' is-revealed' : ''}`}
              style={{ '--i': i % 6 } as CSSProperties}
              aria-label={card.name}
            >
              <CardView
                card={cardPreview(card)}
                template={def.templates.find((t) => t.id === card.templateId) ?? null}
                width={216}
              />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
