/**
 * The Forge — Cardsmith mounted inside Crownfall at #/forge.
 *
 * Cardsmith's pages navigate with their original hashes ('#/', '#/edit/:id',
 * '#/play/:id'); the translating navigate below re-homes those under #/forge
 * so no Cardsmith source needs touching. All Forge UI renders inside
 * .forge-root, which carries Cardsmith's (scoped) tokens and primitives.
 *
 * This is the hall-aware boundary, so the hall's one permission rule lives
 * here: editing the SEEDED Dominion def — the table the lobby actually
 * plays — is the keeper's alone (PRODUCT.md principle 4, same gate as the
 * mason tools). Everything else in the Forge stays open to every visitor.
 */
import { useEffect } from 'react';
import { HomePage } from '../pages/HomePage';
import { GameEditorPage } from '../editor/GameEditorPage';
import { PlayPage } from '../runner/PlayPage';
import { ensureDominionSeed, DOMINION_GAME_ID } from './seedDominion';
import { useUser } from '../hall/state/auth';
import '../styles.css';

// Seed the hall's flagship game before any Forge page lists the store.
ensureDominionSeed();

export interface ForgeAppProps {
  /** Path after '#/forge/', e.g. '' | 'edit/<id>' | 'play/<id>'. */
  sub: string;
  navigate: (hash: string) => void;
}

/** '#/edit/x' → '#/forge/edit/x', '#/' → '#/forge'; hall routes pass through. */
function translate(hash: string): string {
  const raw = hash.replace(/^#\/?/, '');
  if (raw === '' || raw === '/') return '#/forge';
  if (/^(edit|play)\//.test(raw)) return `#/forge/${raw}`;
  return hash;
}

/** The Forge's anvil mark — inline SVG per the ornament rule (no emoji). */
function AnvilMark() {
  return (
    <svg
      className="logo"
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    >
      <path d="M4 6h16l-2 4h-5v3l3 4H8l3-4v-3H6z" />
    </svg>
  );
}

export default function ForgeApp({ sub, navigate }: ForgeAppProps) {
  const forgeNavigate = (hash: string) => navigate(translate(hash));
  const parts = sub.split('/').filter(Boolean);
  const page = parts[0] === 'edit' && parts[1] ? { kind: 'edit' as const, id: parts[1] }
    : parts[0] === 'play' && parts[1] ? { kind: 'play' as const, id: parts[1] }
    : { kind: 'home' as const };

  // Non-keepers (signed out included) may not edit the hall's table: send
  // them to its play page instead of the editor.
  const user = useUser();
  const editBarred = page.kind === 'edit' && page.id === DOMINION_GAME_ID && user?.keeper !== true;
  useEffect(() => {
    if (editBarred) navigate(`#/forge/play/${DOMINION_GAME_ID}`);
  }, [editBarred, navigate]);

  return (
    <div className="forge-root app-shell">
      {page.kind === 'home' && (
        <>
          <header className="app-topbar">
            <a
              className="forge-hallreturn"
              href="#/"
              onClick={(e) => { e.preventDefault(); navigate('#/'); }}
            >
              ← The Hall
            </a>
            <span className="brand"><AnvilMark /> The Forge</span>
            <div className="spacer" />
            <span className="faint">where the hall's games are made</span>
          </header>
          <main className="app-main">
            <HomePage navigate={forgeNavigate} />
          </main>
        </>
      )}
      {page.kind === 'edit' && !editBarred && (
        <GameEditorPage key={page.id} gameId={page.id} navigate={forgeNavigate} />
      )}
      {page.kind === 'play' && (
        <PlayPage key={page.id} gameId={page.id} navigate={forgeNavigate} />
      )}
    </div>
  );
}
