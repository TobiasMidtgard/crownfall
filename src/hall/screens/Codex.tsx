/**
 * Codex — the Dominion card browser (FableTest port). The 25-card grid with
 * procedurally generated per-type SVG art, two AND-combined filter chip
 * groups (type + cost band, aria-pressed), a keeper-editable note line, and
 * a staggered reveal on first arrival. Cards are informational — no click
 * actions, same as the original.
 */
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Edit } from '../state/copy';
import { useReveal } from '../effects/useReveal';
import {
  CARDS, COST_BANDS, COST_LABELS, TYPE_NAMES, accentType,
  type CardType, type CodexCard, type CostBand,
} from './codexCards';

type TypeFilter = 'all' | CardType;
type CostFilter = 'all' | CostBand;

const TYPE_CHIPS: Array<[TypeFilter, string]> = [
  ['all', 'All types'],
  ...(Object.entries(TYPE_NAMES) as Array<[CardType, string]>),
];

const COST_CHIPS: Array<[CostFilter, string]> = [
  ['all', 'Any cost'],
  ...(Object.keys(COST_BANDS) as CostBand[]).map((k): [CostFilter, string] => [k, COST_LABELS[k]]),
];

export function Codex() {
  const [type, setType] = useState<TypeFilter>('all');
  const [cost, setCost] = useState<CostFilter>('all');
  // The reveal stagger plays once, on arrival. After the first filter press
  // the grid swaps instantly (the original re-rendered with no animation).
  const settled = useRef(false);
  const gridRef = useReveal<HTMLDivElement>();

  const pickType = (t: TypeFilter) => { settled.current = true; setType(t); };
  const pickCost = (c: CostFilter) => { settled.current = true; setCost(c); };

  const matches = CARDS.filter((c) =>
    (type === 'all' || c.types.includes(type)) &&
    (cost === 'all' || COST_BANDS[cost](c.cost)));

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
              fallback={`The Dominion base set and its promos, recorded in full: ${CARDS.length} cards. Nothing in this hall is sealed.`}
            />
          </p>
        </header>

        <div className="codex-filters">
          <div className="filter-group" role="group" aria-label="Filter by type">
            {TYPE_CHIPS.map(([id, label]) => (
              <button
                key={id}
                className="filter-chip"
                type="button"
                aria-pressed={type === id}
                onClick={() => pickType(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="filter-group" role="group" aria-label="Filter by cost">
            {COST_CHIPS.map(([id, label]) => (
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
            <CodexCardView key={card.name} card={card} index={i} revealed={settled.current} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CodexCardView({ card, index, revealed }: { card: CodexCard; index: number; revealed: boolean }) {
  const typeLabel = card.types.map((t) => TYPE_NAMES[t]).join(' · ');

  let stat: ReactNode;
  if (card.coin !== undefined) {
    stat = (
      <span className="stat">
        <svg aria-hidden="true"><use href="#glyph-coin" /></svg>
        <span className="visually-hidden">Coin value</span> {card.coin}
      </span>
    );
  } else if (card.vp !== undefined) {
    stat = (
      <span className="stat">
        <svg aria-hidden="true"><use href="#glyph-shield" /></svg>
        <span className="visually-hidden">Victory points</span> {card.vp}
      </span>
    );
  } else {
    stat = <span className="stat-edict">{typeLabel}</span>;
  }

  return (
    <article
      className={`game-card reveal${revealed ? ' is-revealed' : ''}`}
      data-type={accentType(card)}
      style={{ '--i': index % 6 } as CSSProperties}
    >
      <div className="card-face">
        <span className="card-cost" aria-label={`Cost ${card.cost}`}>{card.cost}</span>
        <div className="card-art" aria-hidden="true"><CardArt card={card} /></div>
        {/* h2, not h3: the page outline is the h1 then one card per level. */}
        <h2 className="card-name">{card.name}</h2>
        <p className="card-type"><span className="kind">{typeLabel}</span>{card.promo ? ' · Promo' : ''}</p>
        <p className="card-text">{card.text}</p>
        <div className="card-stats">{stat}</div>
      </div>
    </article>
  );
}

/**
 * Geometric art per card family, varied by cost — cardArt() from the
 * original app.js, translated to JSX. .art-fg draws in bone, .art-accent in
 * the card's --rarity-color (crownfall.css).
 */
function CardArt({ card }: { card: CodexCard }) {
  const t = accentType(card);
  let body: ReactNode;

  if (t === 'treasure') {
    const rings = Math.max(1, Math.min(3, card.coin ?? 1));
    body = (
      <>
        <circle cx="100" cy="75" r="34" stroke="currentColor" className="art-accent" strokeWidth="2.5" />
        {rings > 1 && <circle cx="100" cy="75" r="22" stroke="currentColor" className="art-accent" strokeWidth="1.8" opacity=".7" />}
        {rings > 2 && <circle cx="100" cy="75" r="11" stroke="currentColor" className="art-accent" strokeWidth="1.5" opacity=".5" />}
        <path d="M40 118 H160" stroke="currentColor" className="art-fg" strokeWidth="1.5" opacity=".35" />
      </>
    );
  } else if (t === 'victory') {
    body = (
      <>
        <path d="M34 108 H166" stroke="currentColor" className="art-fg" strokeWidth="2" opacity=".5" />
        <path d="M46 108 C68 82 96 78 110 90 C124 78 146 84 154 108" stroke="currentColor" className="art-fg" strokeWidth="2.2" />
        <path d="M89 50 V36 L96 42 L100 31 L104 42 L111 36 V50 Z" stroke="currentColor" className="art-accent" strokeWidth="2.2" strokeLinejoin="miter" />
        <path d="M100 50 V90" stroke="currentColor" className="art-accent" strokeWidth="1.5" opacity=".5" />
      </>
    );
  } else if (t === 'curse') {
    body = (
      <>
        <path d="M100 36 C76 44 78 64 98 66 C76 72 80 92 100 90 C86 96 90 112 104 108" stroke="currentColor" className="art-accent" strokeWidth="2.2" />
        <rect x="124" y="52" width="7" height="7" transform="rotate(45 127.5 55.5)" stroke="currentColor" className="art-accent" strokeWidth="1.5" opacity=".6" />
        <path d="M52 116 H148" stroke="currentColor" className="art-fg" strokeWidth="1.5" opacity=".35" />
      </>
    );
  } else if (t === 'reaction') {
    body = (
      <>
        <rect x="84" y="48" width="32" height="34" stroke="currentColor" className="art-fg" strokeWidth="2.2" />
        <path d="M84 48 L100 34 L116 48" stroke="currentColor" className="art-fg" strokeWidth="2.2" strokeLinejoin="miter" />
        <path d="M44 98 C58 90 70 106 84 98 C98 90 110 106 124 98 C138 90 150 106 160 98" stroke="currentColor" className="art-accent" strokeWidth="2" />
        <path d="M44 112 C58 104 70 120 84 112 C98 104 110 120 124 112 C138 104 150 120 160 112" stroke="currentColor" className="art-accent" strokeWidth="1.6" opacity=".6" />
      </>
    );
  } else if (t === 'attack') {
    body = (
      <>
        <path d="M56 110 L128 38" stroke="currentColor" className="art-accent" strokeWidth="2.5" />
        <path d="M120 30 L140 50" stroke="currentColor" className="art-accent" strokeWidth="2.5" />
        <path d="M128 38 L146 20" stroke="currentColor" className="art-accent" strokeWidth="2" />
        <path d="M56 110 L66 110 M56 110 L56 100" stroke="currentColor" className="art-accent" strokeWidth="2.2" />
        <path d="M48 56 L70 78 M70 56 L48 78" stroke="currentColor" className="art-fg" strokeWidth="1.5" opacity=".4" />
      </>
    );
  } else {
    const marks = Math.max(1, Math.min(3, Math.floor((card.cost || 1) / 2)));
    body = (
      <>
        <path d="M52 56 H148" stroke="currentColor" className="art-fg" strokeWidth="2.2" />
        <path d="M52 76 H136" stroke="currentColor" className="art-fg" strokeWidth="1.8" opacity=".7" />
        <path d="M52 96 H148" stroke="currentColor" className="art-fg" strokeWidth="1.8" opacity=".5" />
        {Array.from({ length: marks }, (_, i) => (
          <rect
            key={i}
            x={118 - i * 22}
            y="108"
            width="8"
            height="8"
            transform={`rotate(45 ${122 - i * 22} 112)`}
            stroke="currentColor"
            className="art-accent"
            strokeWidth="1.6"
          />
        ))}
      </>
    );
  }

  return <svg viewBox="0 0 200 150" fill="none">{body}</svg>;
}
