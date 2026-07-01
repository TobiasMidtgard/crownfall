/**
 * The engine berth — rewritten for continuity: the engine is no longer
 * "being forged". The Forge is lit and open at #/forge, and the hall's own
 * Dominion table runs on it. The page keeps its ceremony (gear crest,
 * ledger); the ledger now reports the fire as burning.
 */
import { Edit } from '../state/copy';

export function EngineBerth() {
  return (
    <section className="screen" data-screen="engine" aria-labelledby="engine-title">
      <div className="engine">
        <div className="engine-hall">
          <svg className="engine-crest" aria-hidden="true"><use href="#glyph-gear" /></svg>
          <p className="eyebrow"><Edit id="engine-eyebrow" fallback="Beneath the hall" /></p>
          <h1 className="section-title" id="engine-title" tabIndex={-1}>
            <Edit id="engine-title" fallback="The Forge is lit." />
          </h1>
          <p className="engine-lede">
            <Edit id="engine-lede" fallback="One set of gears to drive many card games: rules, tables, and kingdoms served from a single forge. The gears turn now — step down and work them yourself." />
          </p>

          <dl className="engine-ledger">
            <div>
              <dt><Edit id="engine-dt-1" fallback="Engine core" /></dt>
              <dd><Edit id="engine-ledger-1" fallback="Burning — the Forge is open" /></dd>
            </div>
            <div>
              <dt><Edit id="engine-dt-2" fallback="Dominion adapter" /></dt>
              <dd><Edit id="engine-ledger-2" fallback="Docked — the hall's table runs on it" /></dd>
            </div>
            <div>
              <dt><Edit id="engine-dt-3" fallback="Further berths" /></dt>
              <dd><Edit id="engine-ledger-3" fallback="Open" /></dd>
            </div>
          </dl>

          <div className="engine-actions">
            <a className="btn btn-primary btn-large" href="#/forge">
              <Edit id="engine-launch-label" fallback="Enter the Forge" />
            </a>
            <a className="btn btn-ghost" href="#/codex">
              <Edit id="engine-codex-link" fallback="Read the codex" />
            </a>
          </div>
          <p className="engine-note">
            <Edit id="engine-note" fallback="What is forged below docks up here: the keeper's edits to Dominion reach the hall's tables at once." />
          </p>
        </div>
      </div>
    </section>
  );
}
