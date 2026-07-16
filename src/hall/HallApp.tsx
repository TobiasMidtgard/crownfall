/**
 * The Hall — Crownfall's face and antechamber (FableTest port).
 * Owns the hall chrome: skip link, nav (wordmark, links, profile dropdown),
 * heralds region, panels host, mason bar, and the active screen. All hall
 * styling is scoped under .hall-root (crownfall.css owns the :root tokens).
 */
import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import './crownfall.css';
import './state/theme'; // applies crownfall.theme + crownfall.calm on load
import { Icons } from './Icons';
import { HeraldsRegion, herald } from './Heralds';
import { signOut, useUser, type HallUser } from './state/auth';
import { Edit, setEditMode } from './state/copy';
import { PanelsHost, closeAllPanels, openPanel, type PanelId } from './chrome/PanelsHost';
import { MasonBar } from './chrome/MasonBar';
import { Landing } from './screens/Landing';
import { Login } from './screens/Login';
import { Tables } from './screens/Tables';
import { EngineBerth } from './screens/EngineBerth';

// Lazy: the Codex drags the whole Dominion def builder + CardView with it —
// keeping it out of the eager graph roughly halves the landing bundle.
const Codex = lazy(() => import('./screens/Codex').then((m) => ({ default: m.Codex })));

export type HallPage = 'landing' | 'login' | 'tables' | 'codex' | 'engine';

export interface HallAppProps {
  page: HallPage;
  navigate: (hash: string) => void;
}

/** Same shape as App.tsx's RouteLoading — base.css classes, hall voice. */
function ScreenLoading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="route-loading-mark" aria-hidden="true">◆</span>
      <span>The codex opens…</span>
    </div>
  );
}

const NAV_LINKS: Array<{ page: HallPage; hash: string; editId: string; label: string }> = [
  { page: 'landing', hash: '#/', editId: 'nav-realm', label: 'Home' },
  { page: 'codex', hash: '#/codex', editId: 'nav-codex', label: 'Codex' },
  { page: 'engine', hash: '#/engine', editId: 'nav-engine', label: 'Engine' },
  { page: 'tables', hash: '#/tables', editId: 'nav-tables', label: 'The Tables' },
];

export function HallApp({ page, navigate }: HallAppProps) {
  const user = useUser();
  const firstRoute = useRef(true);

  // route ceremony: scroll to the top instantly, then hand focus to the new
  // screen's heading (but not on arrival — the first paint keeps its focus)
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (firstRoute.current) { firstRoute.current = false; return; }
    document.querySelector<HTMLElement>('#main [tabindex="-1"]')?.focus({ preventScroll: true });
  }, [page]);

  const skipToMain = (e: React.MouseEvent) => {
    // '#main' would read as a route to the hash router; skip by hand instead
    e.preventDefault();
    document.getElementById('main')?.focus();
  };

  return (
    <div className="hall-root">
      <Icons />
      <a className="skip-link" href="#main" onClick={skipToMain}>Skip to content</a>

      <header className="crown-nav">
        <a className="brand" href="#/">
          <svg className="brand-mark" aria-hidden="true"><use href="#mark-small" /></svg>
          <span className="brand-word"><Edit id="brand-word" fallback="Crownfall" /></span>
        </a>
        <nav className="nav-links" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <a key={link.page} href={link.hash} aria-current={page === link.page ? 'page' : undefined}>
              <Edit id={link.editId} fallback={link.label} />
            </a>
          ))}
        </nav>
        <div className="nav-auth">
          {user
            ? <ProfileMenu user={user} navigate={navigate} />
            : <a className="btn btn-primary" href="#/login">Sign in</a>}
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        {page === 'landing' && <Landing />}
        {page === 'login' && <Login navigate={navigate} />}
        {page === 'tables' && <Tables navigate={navigate} />}
        {page === 'codex' && (
          <Suspense fallback={<ScreenLoading />}>
            <Codex />
          </Suspense>
        )}
        {page === 'engine' && <EngineBerth />}
      </main>

      <MasonBar />
      <HeraldsRegion />
      <PanelsHost />
    </div>
  );
}

function ProfileMenu({ user, navigate }: { user: HallUser; navigate: (hash: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.stopPropagation(); close(true); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(idx + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus(); }
  };

  const pick = (fn: () => void) => () => { close(false); fn(); };
  const panel = (id: PanelId) => pick(() => openPanel(id));

  // Tabbing past Sign out (or shift-tabbing before the trigger) must not
  // leave the menu floating over the page; onBlur bubbles like focusout.
  // relatedTarget is null when a click steals no focus (Safari buttons) —
  // closing then would unmount the item before its click lands, so skip it;
  // the pointerdown listener above owns the click-outside case.
  const onFocusOut = (e: React.FocusEvent) => {
    if (open && e.relatedTarget && !rootRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false);
    }
  };

  const onSignOut = pick(() => {
    closeAllPanels();
    setEditMode(false);
    signOut();
    herald('Signed out. The gates remember.');
    navigate('#/');
  });

  return (
    <div className="profile-menu" ref={rootRef} onBlur={onFocusOut}>
      <button
        ref={triggerRef}
        className="player-chip profile-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg className="chip-sigil" aria-hidden="true"><use href={`#crest-${user.sigil}`} /></svg>
        <strong>{user.name}</strong>
        {user.keeper && <svg className="keeper-crown" aria-hidden="true"><use href="#glyph-crown-small" /></svg>}
      </button>
      {open && (
        <div className="profile-dropdown" role="menu" aria-label="Profile" onKeyDown={onMenuKeyDown}>
          {user.keeper && (
            <button role="menuitem" type="button" onClick={pick(() => setEditMode(true))}>
              <svg aria-hidden="true"><use href="#glyph-crown-small" /></svg>Edit this page
            </button>
          )}
          <button role="menuitem" type="button" onClick={panel('settings')}>
            <svg aria-hidden="true"><use href="#glyph-seal" /></svg>Profile &amp; settings
          </button>
          <button role="menuitem" type="button" onClick={panel('friends')}>
            <svg aria-hidden="true"><use href="#glyph-companions" /></svg>Friends
          </button>
          <button role="menuitem" type="button" onClick={panel('chat')}>
            <svg aria-hidden="true"><use href="#glyph-chat" /></svg>Chat
          </button>
          <div className="menu-rule" role="separator" />
          <button role="menuitem" type="button" onClick={onSignOut}>
            <svg aria-hidden="true"><use href="#glyph-close" /></svg>Sign out
          </button>
        </div>
      )}
    </div>
  );
}
