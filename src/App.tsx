/**
 * Crownfall — app shell and top-level hash router.
 *
 * Three areas, three chunks:
 *   Hall  (eager)  #/  #/login  #/tables  #/codex  #/engine   → src/hall/HallApp
 *   Table (lazy)   #/play/dominion?set=&foe=&seat=            → src/hall/DominionPlay
 *   Forge (lazy)   #/forge  #/forge/edit/:id  #/forge/play/:id → src/forge/ForgeApp
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
  return <HallApp page={route.page} navigate={navigate} />;
}
