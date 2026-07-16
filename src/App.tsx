/**
 * Crownfall — app shell and top-level hash router.
 *
 * Three areas, lazy seams inside each:
 *   Hall  (eager)  #/  #/login  #/tables  #/codex  #/engine   → src/hall/HallApp
 *                  (Codex itself is lazy — it drags the Dominion def builder)
 *   Table (lazy)   #/play/dominion?set=&foe=&seat=            → src/hall/DominionPlay
 *   Forge (lazy)   #/forge  #/forge/edit/:id  #/forge/play/:id → src/forge/ForgeApp
 *                  (its Home/Editor/Play pages split again, so playing never
 *                  downloads the editor)
 *
 * Hash routing keeps the app a fully static bundle (GitHub Pages / tunnel safe).
 * Query params ride inside the hash: '#/play/dominion?set=sharp-coins'.
 */
import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { HallApp, type HallPage } from './hall/HallApp';

const ForgeApp = lazy(() => import('./forge/ForgeApp'));
const DominionPlay = lazy(() => import('./hall/DominionPlay'));

type Route =
  | { area: 'hall'; page: HallPage }
  | { area: 'table'; params: URLSearchParams }
  | { area: 'forge'; sub: string };

const HALL_PAGES: Record<string, HallPage> = {
  '': 'landing',
  'login': 'login',
  'tables': 'tables',
  'war-room': 'tables', // legacy route from the original hall
  'codex': 'codex',
  'engine': 'engine',
};

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const qIdx = raw.indexOf('?');
  const path = (qIdx >= 0 ? raw.slice(0, qIdx) : raw).replace(/\/+$/, '');
  const search = qIdx >= 0 ? raw.slice(qIdx + 1) : '';
  const parts = path.split('/').filter(Boolean);

  if (parts[0] === 'forge') return { area: 'forge', sub: parts.slice(1).join('/') };
  if (parts[0] === 'play' && parts[1] === 'dominion') {
    return { area: 'table', params: new URLSearchParams(search) };
  }
  const page = HALL_PAGES[parts.join('/')];
  return { area: 'hall', page: page ?? 'landing' };
}

export function navigate(hash: string) {
  window.location.hash = hash.startsWith('#') ? hash : `#${hash}`;
}

const HALL_TITLES: Record<HallPage, string> = {
  landing: 'Crownfall — The Hall',
  login: 'Crownfall — The Gates',
  tables: 'Crownfall — The Tables',
  codex: 'Crownfall — The Codex',
  engine: 'Crownfall — The Engine',
};

/** Per-route tab title, so the Forge, a live table, and the hall can be told
 * apart in the tab strip and in Back-button history. */
export function routeTitle(route: Route): string {
  if (route.area === 'forge') {
    if (route.sub.startsWith('edit/')) return 'Crownfall — The Forge · editing';
    if (route.sub.startsWith('play/')) return 'Crownfall — at the table';
    return 'Crownfall — The Forge';
  }
  if (route.area === 'table') return 'Crownfall — at the table';
  return HALL_TITLES[route.page];
}

function RouteLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading-mark" aria-hidden="true">◆</span>
      <span>The hall shifts…</span>
    </div>
  );
}

/**
 * A rejected lazy import (typically stale chunk URLs in an open tab after a
 * redeploy — the bundle's filenames are hashed) would otherwise unmount the
 * whole root and blank the page. Catch it and offer a reload instead.
 * Styled like RouteLoading: no area tokens, base.css only.
 */
class RouteErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="route-loading" role="alert" style={{ flexDirection: 'column', gap: '1.2rem' }}>
        <p style={{ margin: 0 }}>
          <span className="route-loading-mark" aria-hidden="true">◆</span>{' '}
          The door sticks — the hall has been rebuilt since you arrived.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit',
            color: '#ece4d8', background: 'transparent', border: '1px solid #a3342e',
            padding: '0.55rem 1.4rem', cursor: 'pointer',
          }}
        >
          Reload the hall
        </button>
      </div>
    );
  }
}

export default function App() {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    document.title = routeTitle(route);
  }, [route]);

  if (route.area === 'forge') {
    return (
      <RouteErrorBoundary key={route.area}>
        <Suspense fallback={<RouteLoading />}>
          <ForgeApp sub={route.sub} navigate={navigate} />
        </Suspense>
      </RouteErrorBoundary>
    );
  }
  if (route.area === 'table') {
    return (
      <RouteErrorBoundary key={route.area}>
        <Suspense fallback={<RouteLoading />}>
          <DominionPlay params={route.params} navigate={navigate} />
        </Suspense>
      </RouteErrorBoundary>
    );
  }
  // The hall is eager, but its Codex screen is lazy — a stale chunk after a
  // redeploy must land on the reload card, not a blank page.
  return (
    <RouteErrorBoundary key="hall">
      <HallApp page={route.page} navigate={navigate} />
    </RouteErrorBoundary>
  );
}
