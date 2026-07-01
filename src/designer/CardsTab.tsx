/**
 * CardsTab — the card designer: template list/editor + card list/editor.
 * Mounted as the "Cards" tab of the game editor.
 */
import { useState } from 'react';
import type { GameDef } from '../shared/types';
import { TemplatesSection } from './TemplatesSection';
import { CardsSection } from './CardsSection';
import './designer.css';

export interface CardsTabProps {
  def: GameDef;
  onChange: (def: GameDef) => void;
}

export function CardsTab({ def, onChange }: CardsTabProps) {
  const [section, setSection] = useState<'templates' | 'cards'>('templates');

  return (
    <div className="dz-root">
      <div className="dz-seg dz-section-seg" role="group" aria-label="Card designer section">
        <button
          type="button"
          className={section === 'templates' ? 'active' : ''}
          aria-pressed={section === 'templates'}
          onClick={() => setSection('templates')}
        >
          Templates ({def.templates.length})
        </button>
        <button
          type="button"
          className={section === 'cards' ? 'active' : ''}
          aria-pressed={section === 'cards'}
          onClick={() => setSection('cards')}
        >
          Cards ({def.cards.length})
        </button>
      </div>
      {section === 'templates'
        ? <TemplatesSection def={def} onChange={onChange} />
        : <CardsSection def={def} onChange={onChange} onGoTemplates={() => setSection('templates')} />}
    </div>
  );
}
