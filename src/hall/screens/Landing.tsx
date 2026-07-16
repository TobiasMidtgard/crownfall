/**
 * Landing ("the realm") — full FableTest port: ember hero, the four
 * reorderable sections (library / cards / way / call), and the footer.
 * Section order and shelving honor 'crownfall.layout' (read side; the mason
 * write side arrives with wave 2 through state/layout.ts). Berth II now
 * points at the Forge — the engine is no longer "being forged".
 */
import type { CSSProperties, ReactElement } from 'react';
import { EmberCanvas } from '../effects/EmberCanvas';
import { useReveal } from '../effects/useReveal';
import { useTilt } from '../effects/useTilt';
import { Edit } from '../state/copy';
import { useSectionLayout, type SectionId } from '../state/layout';
import { MasonSectionPlate } from '../chrome/MasonBar';

const iv = (i: number) => ({ '--i': i } as CSSProperties);
const fanAt = (f: number) => ({ '--fan': f } as CSSProperties);

export function Landing() {
  const rootRef = useReveal<HTMLElement>();
  const fanRef = useTilt<HTMLDivElement>();
  const { order, shelved } = useSectionLayout();

  const shelvedClass = (id: SectionId) => (shelved.includes(id) ? ' is-shelved' : '');

  const sections: Record<SectionId, () => ReactElement> = {
    library: () => (
      <div key="library" className={`section library${shelvedClass('library')}`} id="library" data-section="library">
        <MasonSectionPlate id="library" />
        <header className="section-head reveal">
          <p className="eyebrow"><Edit id="library-eyebrow" fallback="The library" /></p>
          <h2 className="section-title"><Edit id="library-title" fallback="One hall. Many tables." /></h2>
        </header>

        <ol className="game-list" data-blocks="games">
          <li className="game-row reveal" data-game="dominion" data-block="game-1">
            <span className="game-numeral" aria-hidden="true">I</span>
            <svg className="game-crest" aria-hidden="true"><use href="#crest-dominion" /></svg>
            <div className="game-copy">
              <h3 className="game-name"><Edit id="game-1-name" fallback="Dominion" /></h3>
              <p className="game-status"><Edit id="game-1-status" fallback="First at the table · now seating" /></p>
              <p className="game-desc">
                <Edit id="game-1-desc" fallback="The deck-builder itself. Draw five, act, buy, and sharpen your deck turn by turn until the provinces fall to you." />
              </p>
              <div className="game-actions">
                <a className="btn btn-primary" href="#/forge/play/dominion-crownfall"><Edit id="game-1-cta-seat" fallback="Take a seat" /></a>
                <a className="btn btn-ghost" href="#/codex"><Edit id="game-1-cta-cards" fallback="The cards" /></a>
              </div>
            </div>
          </li>
          <li className="game-row is-berth reveal" data-game="berth-2" data-block="game-2">
            <span className="game-numeral" aria-hidden="true">II</span>
            <svg className="game-crest" aria-hidden="true"><use href="#glyph-gear" /></svg>
            <div className="game-copy">
              <h3 className="game-name"><Edit id="game-2-name" fallback="The Forge is lit" /></h3>
              <p className="game-status"><Edit id="game-2-status" fallback="The second berth burns" /></p>
              <p className="game-desc">
                <Edit id="game-2-desc" fallback="The engine beneath this hall is awake. Step down to the smithy: design a card game, script its rules, and test-play it at the bench." />
              </p>
              <div className="game-actions">
                <a className="btn btn-ghost" href="#/forge"><Edit id="game-2-cta" fallback="Enter the Forge" /></a>
              </div>
            </div>
          </li>
          <li className="game-row is-berth reveal" data-game="berth-3" data-block="game-3">
            <span className="game-numeral" aria-hidden="true">III</span>
            <svg className="game-crest" aria-hidden="true"><use href="#glyph-lozenge" /></svg>
            <div className="game-copy">
              <h3 className="game-name"><Edit id="game-3-name" fallback="Reserved" /></h3>
              <p className="game-status"><Edit id="game-3-status" fallback="Games yet unsworn" /></p>
              <p className="game-desc">
                <Edit id="game-3-desc" fallback="Every empty chair in this hall is a promise. The library grows as the engine learns new rules." />
              </p>
            </div>
          </li>
        </ol>
      </div>
    ),

    cards: () => (
      <div key="cards" className={`section featured${shelvedClass('cards')}`} id="cards" data-section="cards">
        <MasonSectionPlate id="cards" />
        <header className="section-head reveal">
          <p className="eyebrow"><Edit id="cards-eyebrow" fallback="From the Dominion codex" /></p>
          <h2 className="section-title"><Edit id="cards-title" fallback="Copper to crown." /></h2>
        </header>

        <div className="card-fan" data-blocks="cards" ref={fanRef}>
          <article className="game-card tilt reveal" data-type="victory" data-block="card-1" style={fanAt(-1)}>
            <div className="card-face">
              <span className="card-cost" aria-label="Cost 8">8</span>
              <div className="card-art" aria-hidden="true">
                <svg viewBox="0 0 200 150" fill="none">
                  <path d="M30 112 H170" stroke="currentColor" strokeWidth="2" opacity=".5" className="art-fg" />
                  <path d="M42 112 C66 84 96 80 110 92 C126 78 150 86 158 112" stroke="currentColor" strokeWidth="2.5" className="art-fg" />
                  <path d="M88 52 V36 L95 42 L100 30 L105 42 L112 36 V52 Z" stroke="currentColor" strokeWidth="2.5" className="art-accent" strokeLinejoin="miter" />
                  <path d="M100 52 V92" stroke="currentColor" strokeWidth="1.6" opacity=".5" className="art-accent" />
                  <rect x="60" y="120" width="7" height="7" transform="rotate(45 63.5 123.5)" stroke="currentColor" strokeWidth="1.6" opacity=".6" className="art-accent" />
                  <rect x="132" y="120" width="7" height="7" transform="rotate(45 135.5 123.5)" stroke="currentColor" strokeWidth="1.6" opacity=".6" className="art-accent" />
                </svg>
              </div>
              <h3 className="card-name">Province</h3>
              <p className="card-type"><span className="kind">Victory</span></p>
              <p className="card-text">The realm itself, deeded and sealed.</p>
              <div className="card-stats">
                <span className="stat"><svg aria-hidden="true"><use href="#glyph-shield" /></svg><span className="visually-hidden">Victory points</span> 6</span>
              </div>
            </div>
          </article>

          <article className="game-card tilt reveal" data-type="attack" data-block="card-2" style={fanAt(0)}>
            <div className="card-face">
              <span className="card-cost" aria-label="Cost 5">5</span>
              <div className="card-art" aria-hidden="true">
                <svg viewBox="0 0 200 150" fill="none">
                  <path d="M100 26 L78 84 H122 Z" stroke="currentColor" strokeWidth="2.5" className="art-accent" strokeLinejoin="miter" />
                  <path d="M66 84 H134" stroke="currentColor" strokeWidth="2.5" className="art-accent" />
                  <path d="M100 96 C84 100 82 114 96 118 C86 124 92 134 102 130" stroke="currentColor" strokeWidth="2" className="art-fg" />
                  <path d="M146 38 A18 18 0 1 0 152 62" stroke="currentColor" strokeWidth="1.8" opacity=".55" className="art-fg" />
                  <rect x="52" y="44" width="6" height="6" transform="rotate(45 55 47)" stroke="currentColor" strokeWidth="1.4" opacity=".5" className="art-fg" />
                </svg>
              </div>
              <h3 className="card-name">Witch</h3>
              <p className="card-type"><span className="kind">Action · Attack</span></p>
              <p className="card-text">+2 Cards. Each other player gains a Curse.</p>
              <div className="card-stats">
                <span className="stat-edict">Action · Attack</span>
              </div>
            </div>
          </article>

          <article className="game-card tilt reveal" data-type="action" data-block="card-3" style={fanAt(1)}>
            <div className="card-face">
              <span className="card-cost" aria-label="Cost 5">5</span>
              <div className="card-art" aria-hidden="true">
                <svg viewBox="0 0 200 150" fill="none">
                  <path d="M52 52 H148" stroke="currentColor" strokeWidth="2.5" className="art-fg" />
                  <path d="M52 52 C58 64 66 64 72 52 C78 64 86 64 92 52 C98 64 106 64 112 52 C118 64 126 64 132 52 C138 64 146 64 148 52" stroke="currentColor" strokeWidth="1.8" opacity=".7" className="art-fg" />
                  <path d="M58 52 V112 M142 52 V112" stroke="currentColor" strokeWidth="2" className="art-fg" />
                  <path d="M48 112 H152" stroke="currentColor" strokeWidth="2.5" className="art-fg" />
                  <circle cx="86" cy="103" r="8" stroke="currentColor" strokeWidth="1.8" className="art-accent" />
                  <circle cx="103" cy="103" r="8" stroke="currentColor" strokeWidth="1.8" opacity=".75" className="art-accent" />
                  <circle cx="120" cy="103" r="8" stroke="currentColor" strokeWidth="1.8" opacity=".5" className="art-accent" />
                </svg>
              </div>
              <h3 className="card-name">Market</h3>
              <p className="card-type"><span className="kind">Action</span></p>
              <p className="card-text">+1 Card, +1 Action, +1 Buy, +1 Coin.</p>
              <div className="card-stats">
                <span className="stat-edict">Action</span>
              </div>
            </div>
          </article>
        </div>
      </div>
    ),

    way: () => (
      <div key="way" className={`section way${shelvedClass('way')}`} data-section="way">
        <MasonSectionPlate id="way" />
        <header className="section-head reveal">
          <p className="eyebrow"><Edit id="way-eyebrow" fallback="The way of the deck" /></p>
          <h2 className="section-title"><Edit id="way-title" fallback="How a kingdom is bought." /></h2>
        </header>
        <ol className="way-ledger" data-blocks="way">
          <li className="way-step reveal" data-block="way-1" style={iv(0)}>
            <span className="way-numeral" aria-hidden="true">I</span>
            <h3><Edit id="way-1-title" fallback="Draw your five" /></h3>
            <p><Edit id="way-1-desc" fallback="Every turn begins the same: five cards off the top. What they are is your own doing." /></p>
          </li>
          <li className="way-step reveal" data-block="way-2" style={iv(1)}>
            <span className="way-numeral" aria-hidden="true">II</span>
            <h3><Edit id="way-2-title" fallback="Act, then buy" /></h3>
            <p><Edit id="way-2-desc" fallback="Play your actions, count your coin, and spend it at the kingdom's stalls. Every purchase joins your deck." /></p>
          </li>
          <li className="way-step reveal" data-block="way-3" style={iv(2)}>
            <span className="way-numeral" aria-hidden="true">III</span>
            <h3><Edit id="way-3-title" fallback="Sharpen the deck" /></h3>
            <p><Edit id="way-3-desc" fallback="A deck grows fat and slow. Trash the dross, keep the blade. The best players buy less than they burn." /></p>
          </li>
          <li className="way-step reveal" data-block="way-4" style={iv(3)}>
            <span className="way-numeral" aria-hidden="true">IV</span>
            <h3><Edit id="way-4-title" fallback="Claim the provinces" /></h3>
            <p><Edit id="way-4-desc" fallback="Victory cards win the game and clog the deck that buys them. Time the turn, take the realm." /></p>
          </li>
        </ol>
      </div>
    ),

    call: () => (
      <div key="call" className={`call-to-arms${shelvedClass('call')}`} data-section="call">
        <MasonSectionPlate id="call" />
        <div className="cta-inner reveal">
          <p className="eyebrow eyebrow-on-crimson"><Edit id="call-eyebrow" fallback="Season III · The Hollow Crown" /></p>
          <h2 className="cta-title"><Edit id="call-title" fallback="The table is set." /></h2>
          <a className="btn btn-inverse" href="#/login?tab=oath" data-cta="oath"><Edit id="call-cta" fallback="Create account" /></a>
        </div>
      </div>
    ),
  };

  return (
    <section className="screen" data-screen="landing" aria-labelledby="hero-title" ref={rootRef}>
      <div className="hero">
        <EmberCanvas />
        <div className="hero-inner">
          <p className="eyebrow reveal" style={iv(0)}><Edit id="hero-eyebrow" fallback="A hall for card games" /></p>
          <h1 className="hero-title" id="hero-title" tabIndex={-1}>
            <span className="hero-line reveal" style={iv(1)}><Edit id="hero-line-1" fallback="Crown" /></span>
            <span className="hero-line hero-line-fall reveal" style={iv(2)}><Edit id="hero-line-2" fallback="fall" /></span>
          </h1>
          <p className="hero-tag reveal" style={iv(3)}>
            <Edit id="hero-tag" fallback="One engine beneath the floor. Many games upon the table. Dominion deals first." />
          </p>
          <div className="hero-cta reveal" style={iv(4)}>
            <a className="btn btn-primary" href="#/forge/play/dominion-crownfall"><Edit id="hero-cta-play" fallback="Play Dominion" /></a>
            <a className="btn btn-ghost" href="#/codex"><Edit id="hero-cta-browse" fallback="Browse the cards" /></a>
          </div>
          <p className="hero-meta reveal" style={iv(5)}>
            <span><Edit id="hero-meta-1" fallback="One hall" /></span><span className="meta-sep" aria-hidden="true">◆</span>
            <span><Edit id="hero-meta-2" fallback="many games" /></span><span className="meta-sep" aria-hidden="true">◆</span>
            <span><Edit id="hero-meta-3" fallback="Dominion first" /></span>
          </p>
        </div>
        <svg className="hero-crest reveal" style={iv(2)} aria-hidden="true"><use href="#mark-crownfall" /></svg>
      </div>

      {order.map((id) => sections[id]())}

      <footer className="crown-footer">
        <div className="footer-brand">
          <svg className="brand-mark" aria-hidden="true"><use href="#mark-small" /></svg>
          <p><Edit id="footer-oath" fallback={'By ember and oath,\nwhat falls is claimed.'} /></p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <a href="#/codex"><Edit id="footer-link-codex" fallback="Codex" /></a>
          <a href="#/engine"><Edit id="footer-link-engine" fallback="Engine" /></a>
          <a href="#/tables"><Edit id="footer-link-tables" fallback="The Tables" /></a>
          <a href="#/login"><Edit id="footer-link-oath" fallback="Sign in" /></a>
        </nav>
        <p className="footer-note">
          <Edit id="footer-note" fallback="Crownfall is a working hall: a real rules engine beneath the floor, tables played peer-to-peer, and new games forged on site. Dominion is a game by Donald X. Vaccarino; this hall merely sets its table." />
        </p>
      </footer>
    </section>
  );
}
