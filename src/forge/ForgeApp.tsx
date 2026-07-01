/**
 * The Forge — Cardsmith mounted inside Crownfall at #/forge.
 *
 * Cardsmith's pages navigate with their original hashes ('#/', '#/edit/:id',
 * '#/play/:id'); the translating navigate below re-homes those under #/forge
 * so no Cardsmith source needs touching. All Forge UI renders inside
 * .forge-root, which carries Cardsmith's (scoped) tokens and primitives.
 */
import { HomePage } from '../pages/HomePage';
import { GameEditorPage } from '../editor/GameEditorPage';
import { PlayPage } from '../runner/PlayPage';
import { ensureDominionSeed } from './seedDominion';
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

export default function ForgeApp({ sub, navigate }: ForgeAppProps) {
  const forgeNavigate = (hash: string) => navigate(translate(hash));
  const parts = sub.split('/').filter(Boolean);
  const page = parts[0] === 'edit' && parts[1] ? { kind: 'edit' as const, id: parts[1] }
    : parts[0] === 'play' && parts[1] ? { kind: 'play' as const, id: parts[1] }
    : { kind: 'home' as const };

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
            <span className="brand"><span className="logo" aria-hidden="true">⚒</span> The Forge</span>
            <div className="spacer" />
            <span className="faint">where the hall's games are made</span>
          </header>
          <main className="app-main">
            <HomePage navigate={forgeNavigate} />
          </main>
        </>
      )}
      {page.kind === 'edit' && (
        <GameEditorPage key={page.id} gameId={page.id} navigate={forgeNavigate} />
      )}
      {page.kind === 'play' && (
        <PlayPage key={page.id} gameId={page.id} navigate={forgeNavigate} />
      )}
    </div>
  );
}
