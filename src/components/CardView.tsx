/**
 * CardView — THE card renderer. Used identically by the card designer
 * (live preview), the card list editor, and the game table, so a card always
 * looks the same everywhere.
 *
 * Renders either:
 *  - a standard 52-deck card (built-in classic face), or
 *  - a custom card: its template's layered elements + the card's field values.
 *
 * All template coordinates are % of card size; font sizes are % of card width.
 */
import type { CardTemplate, TemplateElement } from '../shared/types';

export interface CardLike {
  name: string;
  templateId: string | null;
  fields: Record<string, string | number | boolean>;
  faceUp: boolean;
}

const SUIT_GLYPH: Record<string, string> = {
  spades: '♠', hearts: '♥', diamonds: '♦', clubs: '♣',
};

export function CardView({
  card, template, width, accent = '#7c5cff', selected = false, dimmed = false, onClick,
}: {
  card: CardLike;
  template: CardTemplate | null;
  width: number;
  accent?: string;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
}) {
  const aspect = template?.aspect ?? 0.714;
  const height = width / aspect;
  const baseStyle: React.CSSProperties = {
    width, height,
    borderRadius: Math.max(4, width * 0.06),
    position: 'relative',
    overflow: 'hidden',
    flexShrink: 0,
    cursor: onClick ? 'pointer' : undefined,
    opacity: dimmed ? 0.45 : 1,
    outline: selected ? `3px solid ${accent}` : undefined,
    outlineOffset: 1,
    transition: 'opacity 0.15s, transform 0.15s, outline-color 0.15s',
    userSelect: 'none',
    WebkitUserSelect: 'none',
  };

  if (!card.faceUp) {
    return (
      <div
        className="cardview-back"
        style={{
          ...baseStyle,
          background: `repeating-linear-gradient(135deg, ${accent}33 0 6px, ${accent}1a 6px 12px), linear-gradient(160deg, #232639, #16182a)`,
          border: '1px solid #3a3f58',
          boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
        }}
        onClick={onClick}
      >
        <div style={{
          position: 'absolute', inset: '12%', borderRadius: 'inherit',
          border: `2px solid ${accent}55`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: width * 0.28, color: `${accent}66`,
        }}>
          {'✸'}
        </div>
      </div>
    );
  }

  // Standard 52-deck face (no template).
  if (!template) {
    const suit = String(card.fields.suit ?? '');
    const glyph = card.fields.isJoker ? '☺' : (SUIT_GLYPH[suit] ?? '');
    const red = card.fields.color === 'red';
    const rankName = card.fields.isJoker ? 'JOKER' : String(card.fields.rankName ?? '?');
    const color = red ? '#e5484d' : '#1a1d2e';
    return (
      <div
        style={{
          ...baseStyle,
          background: 'linear-gradient(165deg, #fdfdfa, #ececec)',
          border: '1px solid #b9bcc8',
          boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
          color,
        }}
        onClick={onClick}
      >
        <div style={{
          position: 'absolute', top: '4%', left: '7%',
          fontSize: width * (card.fields.isJoker ? 0.11 : 0.2), fontWeight: 800, lineHeight: 1,
          letterSpacing: card.fields.isJoker ? '0.05em' : undefined,
          writingMode: card.fields.isJoker ? 'vertical-rl' : undefined,
        }}>
          {rankName}
          {!card.fields.isJoker && <div style={{ fontSize: width * 0.17 }}>{glyph}</div>}
        </div>
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: width * 0.42, opacity: 0.9,
        }}>
          {glyph}
        </div>
        <div style={{
          position: 'absolute', bottom: '4%', right: '7%',
          fontSize: width * 0.2, fontWeight: 800, lineHeight: 1, transform: 'rotate(180deg)',
        }}>
          {card.fields.isJoker ? '' : rankName}
          {!card.fields.isJoker && <div style={{ fontSize: width * 0.17 }}>{glyph}</div>}
        </div>
      </div>
    );
  }

  // Custom template face.
  return (
    <div
      style={{
        ...baseStyle,
        background: template.background,
        border: `1px solid ${template.borderColor}`,
        borderRadius: (template.cornerRadius / 100) * width,
        boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
      }}
      onClick={onClick}
    >
      {template.elements.map((el) => (
        <TemplateElementView key={el.id} el={el} card={card} cardWidth={width} />
      ))}
    </div>
  );
}

function TemplateElementView({ el, card, cardWidth }: {
  el: TemplateElement; card: CardLike; cardWidth: number;
}) {
  const box: React.CSSProperties = {
    position: 'absolute',
    left: `${el.x}%`, top: `${el.y}%`, width: `${el.w}%`, height: `${el.h}%`,
  };
  // Every template element carries a stable 'cv-<elementId>' class so skins
  // can re-dress parts of a card (e.g. rotate a cost stat into a diamond)
  // without touching the inline geometry.
  const cls = `cv-${el.id}`;
  switch (el.kind) {
    case 'box':
      return <div className={cls} style={{ ...box, background: el.fill, borderRadius: (el.radius / 100) * cardWidth }} />;
    case 'text': {
      const value = el.bind !== null ? String(card.fields[el.bind] ?? '') : el.text;
      return (
        <div className={cls} style={{
          ...box,
          fontSize: (el.fontSize / 100) * cardWidth,
          fontWeight: el.bold ? 700 : 400,
          fontStyle: el.italic ? 'italic' : undefined,
          textAlign: el.align,
          color: el.color,
          overflow: 'hidden',
          lineHeight: 1.25,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          {value}
        </div>
      );
    }
    case 'stat': {
      const value = el.bind !== null ? String(card.fields[el.bind] ?? '') : '';
      const radius = el.shape === 'circle' ? '50%'
        : el.shape === 'shield' ? '50% 50% 50% 50% / 30% 30% 70% 70%'
        : `${cardWidth * 0.04}px`;
      return (
        <div className={cls} style={{
          ...box,
          background: el.bg,
          color: el.color,
          borderRadius: radius,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: (el.fontSize / 100) * cardWidth,
          fontWeight: 800,
          boxShadow: 'inset 0 0 0 1.5px rgba(255,255,255,0.25)',
        }}>
          {value}
        </div>
      );
    }
    case 'image': {
      const src = el.bind !== null ? String(card.fields[el.bind] ?? '') : el.src;
      if (!src) {
        return <div className={cls} style={{ ...box, background: 'rgba(255,255,255,0.06)', borderRadius: (el.radius / 100) * cardWidth }} />;
      }
      return (
        <img
          className={cls}
          src={src}
          alt=""
          draggable={false}
          style={{ ...box, objectFit: el.fit, borderRadius: (el.radius / 100) * cardWidth }}
        />
      );
    }
  }
}
