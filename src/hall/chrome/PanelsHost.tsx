/**
 * Panels (chat / friends / settings) — the hall's movable furniture.
 * Port of FableTest panels.js: floating, draggable, resizable panels that can
 * pin into left/right docks; the page conforms via --dock-left-w/--dock-right-w
 * on documentElement. The workspace persists at 'crownfall.workspace' with the
 * original shape and is restored on sign-in; sign-out hides the panels but
 * keeps their stored modes. All panel/dock CSS lives in crownfall.css.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from 'react';
import { getUser, signOut, updateUser, useUser, type Sigil } from '../state/auth';
import { Edit, setEditMode, useCopy } from '../state/copy';
import { setCalm, useCalm } from '../state/theme';
import { herald } from '../Heralds';
import { ThemeSeals } from './MasonBar';
import './panels.css';

export type PanelId = 'chat' | 'friends' | 'settings';
type Side = 'left' | 'right';
type PanelMode = 'closed' | 'float' | Side;

const KEY = 'crownfall.workspace';
const EDGE = 64; // px from a screen edge that triggers docking on drag
const DOCK_MIN = 240;
const DOCK_MAX = 560;
const PANEL_MIN_W = 280;
const PANEL_MIN_H = 240;
const STACK_MIN = 130;
const PANEL_IDS: PanelId[] = ['chat', 'friends', 'settings'];

const DEFS: Record<PanelId, { title: string; icon: string }> = {
  chat: { title: 'Chat', icon: 'glyph-chat' },
  friends: { title: 'Friends', icon: 'glyph-companions' },
  settings: { title: 'Profile & settings', icon: 'glyph-seal' },
};

/* ── workspace state (original 'crownfall.workspace' shape) ── */

interface PanelWs {
  mode: PanelMode;
  x: number | null;
  y: number | null;
  w: number;
  h: number;
  weight: number;
  order: number;
}
interface Workspace {
  panels: Record<PanelId, PanelWs>;
  dockW: Record<Side, number>;
}

function defaults(): Workspace {
  return {
    panels: {
      chat: { mode: 'closed', x: null, y: null, w: 330, h: 440, weight: 1, order: 0 },
      friends: { mode: 'closed', x: null, y: null, w: 330, h: 420, weight: 1, order: 1 },
      settings: { mode: 'closed', x: null, y: null, w: 360, h: 520, weight: 1, order: 2 },
    },
    dockW: { left: 330, right: 330 },
  };
}

const memoryStore = new Map<string, string>();
function readRaw(): string | null {
  try { return window.localStorage.getItem(KEY); }
  catch { return memoryStore.get(KEY) ?? null; }
}
function writeRaw(value: string) {
  try { window.localStorage.setItem(KEY, value); }
  catch { memoryStore.set(KEY, value); }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate/clamp a stored workspace exactly like the original loadState(). */
export function parseWorkspace(raw: string | null): Workspace {
  const base = defaults();
  if (!raw) return base;
  try {
    const saved = JSON.parse(raw) as unknown;
    if (!saved || typeof saved !== 'object') return base;
    const rawPanels = (saved as { panels?: unknown }).panels;
    if (rawPanels && typeof rawPanels === 'object') {
      for (const id of PANEL_IDS) {
        const p = (rawPanels as Record<string, unknown>)[id];
        if (!p || typeof p !== 'object') continue;
        const rec = p as Record<string, unknown>;
        const mode = rec.mode;
        if (mode === 'closed' || mode === 'float' || mode === 'left' || mode === 'right') {
          base.panels[id].mode = mode;
        }
        if (isNum(rec.x)) base.panels[id].x = rec.x;
        if (isNum(rec.y)) base.panels[id].y = rec.y;
        if (isNum(rec.w)) base.panels[id].w = rec.w;
        if (isNum(rec.h)) base.panels[id].h = rec.h;
        if (isNum(rec.weight)) base.panels[id].weight = rec.weight;
        if (isNum(rec.order)) base.panels[id].order = rec.order;
      }
    }
    const rawDock = (saved as { dockW?: unknown }).dockW;
    if (rawDock && typeof rawDock === 'object') {
      for (const side of ['left', 'right'] as const) {
        const w = (rawDock as Record<string, unknown>)[side];
        if (isNum(w)) base.dockW[side] = Math.min(DOCK_MAX, Math.max(DOCK_MIN, w));
      }
    }
    return base;
  } catch { return base; }
}

const ws: Workspace = parseWorkspace(typeof window === 'undefined' ? null : readRaw());
function save() { writeRaw(JSON.stringify(ws)); }

/* one version counter drives every panel re-render (workspace, open set,
   z-order, chat/companion content) — the panel tree is small and cheap */
let version = 0;
const listeners = new Set<() => void>();
function emit() { version++; listeners.forEach((l) => l()); }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
const getVersion = () => version;

/** Panels visible this session. Sign-out clears it WITHOUT touching stored modes. */
const openSet = new Set<PanelId>();
let frontId: PanelId | null = null;

/* live panel elements — splitters and resize-clamping reach them directly */
const panelEls = new Map<PanelId, HTMLElement>();
const hintEls: { left: HTMLDivElement | null; right: HTMLDivElement | null } = { left: null, right: null };

const narrowMq = typeof window === 'undefined' ? null : window.matchMedia('(max-width: 56rem)');
const isNarrow = () => narrowMq?.matches ?? false;
function subscribeNarrow(l: () => void) {
  narrowMq?.addEventListener('change', l);
  return () => narrowMq?.removeEventListener('change', l);
}
function useNarrow(): boolean {
  return useSyncExternalStore(subscribeNarrow, isNarrow);
}

const navEl = () => document.querySelector<HTMLElement>('.hall-root .crown-nav');
const clampX = (x: number, w: number) => Math.min(Math.max(x, 8 - w + 80), window.innerWidth - 80);
const clampY = (y: number) => Math.min(Math.max(y, (navEl()?.offsetHeight ?? 0) + 4), window.innerHeight - 48);

/* ── public operations (HallApp imports these) ── */

export function openPanel(id: PanelId) {
  if (!PANEL_IDS.includes(id)) return;
  if (!getUser()) { herald('Sign in to open panels.'); return; }
  const p = ws.panels[id];
  if (p.mode === 'closed') p.mode = 'float';
  openSet.add(id);
  frontId = id;
  save();
  emit();
  // after React commits: hand focus to the panel's first control
  requestAnimationFrame(() => {
    document
      .querySelector<HTMLElement>(`.hall-root .panel[data-panel="${id}"] .panel-body`)
      ?.querySelector<HTMLElement>('input, button')
      ?.focus({ preventScroll: true });
  });
}

export function closeAllPanels() {
  // session close only: stored modes survive so the layout returns at sign-in
  openSet.clear();
  emit();
}

function closePanel(id: PanelId) {
  openSet.delete(id);
  ws.panels[id].mode = 'closed';
  save();
  emit();
  document.querySelector<HTMLElement>('.hall-root .profile-trigger')?.focus();
}

function restoreWorkspace() {
  for (const id of PANEL_IDS) {
    if (ws.panels[id].mode !== 'closed') openSet.add(id);
  }
  emit();
}

function bringToFront(id: PanelId) {
  if (frontId !== id) { frontId = id; emit(); }
}

function pin(id: PanelId, side: Side) {
  if (isNarrow()) { herald('The window is too narrow for docks. Widen it to pin panels.'); return; }
  ws.panels[id].mode = side;
  ws.panels[id].order =
    Math.max(-1, ...PANEL_IDS.map((pid) => (ws.panels[pid].mode === side ? ws.panels[pid].order : -1))) + 1;
  save();
  emit();
}

function floatPanel(id: PanelId) {
  ws.panels[id].mode = 'float';
  save();
  emit();
}

function updatePanel(id: PanelId, patch: Partial<PanelWs>) {
  Object.assign(ws.panels[id], patch);
  save();
  emit();
}

function dockedIds(side: Side): PanelId[] {
  if (isNarrow()) return [];
  return PANEL_IDS
    .filter((id) => openSet.has(id) && ws.panels[id].mode === side)
    .sort((a, b) => ws.panels[a].order - ws.panels[b].order);
}

/* ═══ host ═══ */

export function PanelsHost() {
  useSyncExternalStore(subscribe, getVersion);
  const narrow = useNarrow();
  const user = useUser();
  const lastHandle = useRef<string | null>(null);

  // restore the saved layout on a fresh sign-in (not on profile edits);
  // sign-out hides the panels but keeps their stored modes
  useEffect(() => {
    if (!user) {
      lastHandle.current = null;
      closeAllPanels();
    } else if (user.handle !== lastHandle.current) {
      lastHandle.current = user.handle;
      restoreWorkspace();
    }
  }, [user]);

  // the nav's real height drives dock tops and float clamping
  useEffect(() => {
    const sync = () => {
      const nav = navEl();
      if (nav) document.documentElement.style.setProperty('--nav-h', `${nav.offsetHeight}px`);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);

  // window resize keeps floating panels reachable (visual clamp, not saved)
  useEffect(() => {
    const onResize = () => {
      if (isNarrow()) return;
      for (const id of PANEL_IDS) {
        if (!openSet.has(id) || ws.panels[id].mode !== 'float') continue;
        const el = panelEls.get(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        el.style.left = `${clampX(r.left, r.width)}px`;
        el.style.top = `${clampY(r.top)}px`;
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Esc closes the focused floating panel — unless a modal dialog (the
  // summons ceremony) is open; it owns Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[role="dialog"], dialog[open]')) return;
      const target = e.target as Element | null;
      const panel = target?.closest?.('.panel.is-floating') as HTMLElement | null;
      const id = panel?.dataset.panel as PanelId | undefined;
      if (id) closePanel(id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const leftIds = dockedIds('left');
  const rightIds = dockedIds('right');
  const floatIds = PANEL_IDS.filter((id) => openSet.has(id) && (narrow || ws.panels[id].mode === 'float'));

  // page conformity: pinned docks claim their margin from #main
  useLayoutEffect(() => {
    const style = document.documentElement.style;
    style.setProperty('--dock-left-w', leftIds.length ? `${ws.dockW.left}px` : '0px');
    style.setProperty('--dock-right-w', rightIds.length ? `${ws.dockW.right}px` : '0px');
  });
  useEffect(() => () => {
    // leaving the hall (e.g. into a game) releases the page margins
    document.documentElement.style.setProperty('--dock-left-w', '0px');
    document.documentElement.style.setProperty('--dock-right-w', '0px');
  }, []);

  const renderDock = (side: Side, ids: PanelId[]) => (
    <aside className={`dock dock-${side}`} aria-label={side === 'left' ? 'Left dock' : 'Right dock'} hidden={ids.length === 0}>
      {side === 'right' && <DockSplitter side="right" />}
      <div className="dock-panels">
        {ids.map((id, i) => (
          <Fragment key={id}>
            <Panel id={id} narrow={narrow} />
            {i < ids.length - 1 && <StackSplitter side={side} ids={ids} index={i} />}
          </Fragment>
        ))}
      </div>
      {side === 'left' && <DockSplitter side="left" />}
    </aside>
  );

  return (
    <>
      {renderDock('left', leftIds)}
      {renderDock('right', rightIds)}
      <div className="dock-hint dock-hint-left" aria-hidden="true" ref={(el) => { hintEls.left = el; }} />
      <div className="dock-hint dock-hint-right" aria-hidden="true" ref={(el) => { hintEls.right = el; }} />
      {floatIds.map((id) => <Panel key={id} id={id} narrow={narrow} />)}
    </>
  );
}

/* ═══ one panel ═══ */

function Panel({ id, narrow }: { id: PanelId; narrow: boolean }) {
  const def = DEFS[id];
  const title = useCopy(`panel-title-${id}`, def.title);
  const p = ws.panels[id];
  const isFloat = narrow || p.mode === 'float';
  const elRef = useRef<HTMLElement | null>(null);

  const setRoot = useCallback((el: HTMLElement | null) => {
    if (el) {
      elRef.current = el;
      panelEls.set(id, el);
    } else {
      if (panelEls.get(id) === elRef.current) panelEls.delete(id);
      elRef.current = null;
    }
  }, [id]);

  let style: CSSProperties;
  if (!isFloat) {
    style = { flexGrow: p.weight || 1 };
  } else if (narrow) {
    style = { zIndex: frontId === id ? 61 : 60 }; // .is-sheet positions itself
  } else {
    const navH = navEl()?.offsetHeight ?? 60;
    const idx = PANEL_IDS.indexOf(id);
    const w = Math.max(PANEL_MIN_W, p.w);
    const h = Math.max(PANEL_MIN_H, p.h);
    const x = p.x ?? Math.max(8, window.innerWidth - w - 28 - idx * 36);
    const y = p.y ?? navH + 20 + idx * 36;
    style = { width: w, height: h, left: clampX(x, w), top: clampY(y), zIndex: frontId === id ? 61 : 60 };
  }

  /* drag by the header (and dock when released within EDGE px of an edge) */
  const onDragStart = (e: React.PointerEvent<HTMLElement>) => {
    const target = e.target as Element;
    if (target.closest('button')) return;
    // while the keeper reshapes, the title is for writing, not dragging
    if (document.body.classList.contains('editing') && target.closest('[data-edit]')) return;
    if (p.mode !== 'float' || isNarrow()) return;
    const el = elRef.current;
    if (!el) return;
    e.preventDefault();
    const head = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;
    const rect = el.getBoundingClientRect();
    let hint: Side | null = null;
    document.body.classList.add('is-dragging-panel');
    try { head.setPointerCapture(pointerId); } catch { /* synthetic or released pointer */ }

    const move = (ev: PointerEvent) => {
      el.style.left = `${clampX(rect.left + ev.clientX - startX, rect.width)}px`;
      el.style.top = `${clampY(rect.top + ev.clientY - startY)}px`;
      hint = ev.clientX < EDGE ? 'left' : ev.clientX > window.innerWidth - EDGE ? 'right' : null;
      hintEls.left?.classList.toggle('is-active', hint === 'left');
      hintEls.right?.classList.toggle('is-active', hint === 'right');
    };
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      head.removeEventListener('pointercancel', up);
      try { head.releasePointerCapture(pointerId); } catch { /* already released */ }
      document.body.classList.remove('is-dragging-panel');
      hintEls.left?.classList.remove('is-active');
      hintEls.right?.classList.remove('is-active');
      if (hint) { pin(id, hint); return; }
      const r = el.getBoundingClientRect();
      updatePanel(id, { x: r.left, y: r.top });
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
    head.addEventListener('pointercancel', up);
  };

  /* corner grip resize (floating only) */
  const onResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (p.mode !== 'float' || isNarrow()) return;
    const el = elRef.current;
    if (!el) return;
    e.preventDefault();
    const grip = e.currentTarget;
    const pointerId = e.pointerId;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    document.body.classList.add('is-dragging-panel');
    try { grip.setPointerCapture(pointerId); } catch { /* synthetic or released pointer */ }

    const move = (ev: PointerEvent) => {
      const w = Math.min(Math.max(PANEL_MIN_W, rect.width + ev.clientX - startX), window.innerWidth - 16);
      const h = Math.min(Math.max(PANEL_MIN_H, rect.height + ev.clientY - startY), window.innerHeight - rect.top - 8);
      el.style.width = `${w}px`;
      el.style.height = `${h}px`;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      try { grip.releasePointerCapture(pointerId); } catch { /* already released */ }
      document.body.classList.remove('is-dragging-panel');
      const r = el.getBoundingClientRect();
      updatePanel(id, { w: r.width, h: r.height });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  };

  return (
    <section
      ref={setRoot}
      className={`panel ${isFloat ? 'is-floating' : 'is-docked'}${isFloat && narrow ? ' is-sheet' : ''}`}
      data-panel={id}
      role="complementary"
      aria-label={title}
      style={style}
      onPointerDown={() => { if (isFloat) bringToFront(id); }}
    >
      <header className="panel-head" onPointerDown={onDragStart}>
        <svg className="panel-icon" aria-hidden="true"><use href={`#${def.icon}`} /></svg>
        <h2 className="panel-title"><Edit id={`panel-title-${id}`} fallback={def.title} /></h2>
        <div className="panel-actions">
          <button type="button" data-act="pin-left" aria-label="Pin to the left edge" aria-pressed={p.mode === 'left'} onClick={() => pin(id, 'left')}>
            <svg aria-hidden="true"><use href="#glyph-pin-left" /></svg>
          </button>
          <button type="button" data-act="pin-right" aria-label="Pin to the right edge" aria-pressed={p.mode === 'right'} onClick={() => pin(id, 'right')}>
            <svg aria-hidden="true"><use href="#glyph-pin-right" /></svg>
          </button>
          <button type="button" data-act="float" aria-label="Float the panel" hidden={p.mode === 'float'} onClick={() => floatPanel(id)}>
            <svg aria-hidden="true"><use href="#glyph-float" /></svg>
          </button>
          <button type="button" data-act="close" aria-label="Close the panel" onClick={() => closePanel(id)}>
            <svg aria-hidden="true"><use href="#glyph-close" /></svg>
          </button>
        </div>
      </header>
      <div className="panel-body">
        {id === 'chat' && <ChatBody />}
        {id === 'friends' && <FriendsBody />}
        {id === 'settings' && <SettingsBody />}
      </div>
      <div className="panel-grip" aria-hidden="true" hidden={!isFloat || narrow} onPointerDown={onResizeStart} />
    </section>
  );
}

/* ═══ dock width splitter (240–560px, pointer + arrow keys) ═══ */

function DockSplitter({ side }: { side: Side }) {
  const apply = (w: number, el: HTMLElement) => {
    ws.dockW[side] = Math.min(DOCK_MAX, Math.max(DOCK_MIN, w));
    document.documentElement.style.setProperty(`--dock-${side}-w`, `${ws.dockW[side]}px`);
    el.setAttribute('aria-valuenow', String(ws.dockW[side]));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    document.body.classList.add('is-dragging-panel');
    try { el.setPointerCapture(pointerId); } catch { /* synthetic or released pointer */ }
    const move = (ev: PointerEvent) => {
      apply(side === 'left' ? ev.clientX : window.innerWidth - ev.clientX, el);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try { el.releasePointerCapture(pointerId); } catch { /* already released */ }
      document.body.classList.remove('is-dragging-panel');
      save();
      emit();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const delta =
      e.key === 'ArrowLeft' ? (side === 'left' ? -16 : 16)
      : e.key === 'ArrowRight' ? (side === 'left' ? 16 : -16)
      : 0;
    if (!delta) return;
    e.preventDefault();
    apply(ws.dockW[side] + delta, e.currentTarget);
    save();
    emit();
  };

  return (
    <div
      className="dock-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize left dock' : 'Resize right dock'}
      tabIndex={0}
      aria-valuemin={DOCK_MIN}
      aria-valuemax={DOCK_MAX}
      aria-valuenow={ws.dockW[side]}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

/* ═══ stacked-panel height splitter (min 130px, flexGrow weights) ═══ */

function StackSplitter({ side, ids, index }: { side: Side; ids: PanelId[]; index: number }) {
  const aId = ids[index];
  const bId = ids[index + 1];
  const aTitle = useCopy(`panel-title-${aId}`, DEFS[aId].title);
  const bTitle = useCopy(`panel-title-${bId}`, DEFS[bId].title);
  const ref = useRef<HTMLDivElement>(null);

  // reflect the upper panel's real height once it is laid out
  useEffect(() => {
    const a = panelEls.get(aId);
    if (ref.current && a) ref.current.setAttribute('aria-valuenow', String(Math.round(a.offsetHeight)));
  });

  const applyWeights = (newA: number, newB: number, el: HTMLElement) => {
    const a = panelEls.get(aId);
    const b = panelEls.get(bId);
    if (!a || !b) return;
    ws.panels[aId].weight = newA;
    ws.panels[bId].weight = newB;
    a.style.flexGrow = String(newA);
    b.style.flexGrow = String(newB);
    el.setAttribute('aria-valuenow', String(Math.round(newA)));
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = panelEls.get(aId);
    const b = panelEls.get(bId);
    if (!a || !b) return;
    e.preventDefault();
    const el = e.currentTarget;
    const pointerId = e.pointerId;
    const aH = a.getBoundingClientRect().height;
    const bH = b.getBoundingClientRect().height;
    const startY = e.clientY;
    document.body.classList.add('is-dragging-panel');
    try { el.setPointerCapture(pointerId); } catch { /* synthetic or released pointer */ }

    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      applyWeights(Math.max(STACK_MIN, aH + dy), Math.max(STACK_MIN, bH - dy), el);
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      try { el.releasePointerCapture(pointerId); } catch { /* already released */ }
      document.body.classList.remove('is-dragging-panel');
      save();
      emit();
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const a = panelEls.get(aId);
    const b = panelEls.get(bId);
    if (!a || !b) return;
    e.preventDefault();
    const dy = e.key === 'ArrowDown' ? 24 : -24;
    applyWeights(
      Math.max(STACK_MIN, a.getBoundingClientRect().height + dy),
      Math.max(STACK_MIN, b.getBoundingClientRect().height - dy),
      e.currentTarget,
    );
    save();
    emit();
  };

  return (
    <div
      ref={ref}
      className="stack-splitter"
      role="separator"
      aria-orientation="horizontal"
      aria-label={`Resize ${aTitle} and ${bTitle}`}
      aria-valuemin={STACK_MIN}
      tabIndex={0}
      data-side={side}
      data-index={index}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

/* ═══ panel contents ═══ */

/* Hall Chat — seeded voices; your words append; sometimes the hall answers */

interface ChatMsg { who: string; text: string; self: boolean; }

const CHAT_SEED: ChatMsg[] = [
  { who: 'Lady Wrenfield the Unkind', text: 'Three provinces by the eighth turn. Pay up.', self: false },
  { who: 'Brother Hollis', text: 'The chapel opening is undefeated tonight. Test me.', self: false },
  { who: 'Herald', text: 'Season III, The Hollow Crown, ends in twelve days.', self: false },
  { who: 'Mathilde, Tithe-Sworn', text: 'Anyone for a First Game table? Be gentle.', self: false },
];
const CHAT_REPLIES: Array<{ who: string; text: string }> = [
  { who: 'Lady Wrenfield the Unkind', text: 'Bold words for someone still buying Copper.' },
  { who: 'Ser Calloway of the Eaves', text: 'I heard that across three keeps.' },
  { who: 'Brother Hollis', text: 'The chapel hears all. Mostly complaints.' },
  { who: 'Mathilde, Tithe-Sworn', text: 'Wagers at the gilt table. No promises kept.' },
];

let chatLog: ChatMsg[] = [...CHAT_SEED];
function addChatMsg(msg: ChatMsg) {
  chatLog = [...chatLog, msg];
  emit();
}

/* whisper prefill: Friends' Message button seeds the chat input */
let chatPrefill = { text: '', n: 0 };
let chatPrefillConsumed = 0;

function ChatBody() {
  const [draft, setDraft] = useState('');
  const logRef = useRef<HTMLUListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (chatPrefill.n > chatPrefillConsumed) {
      chatPrefillConsumed = chatPrefill.n;
      setDraft(chatPrefill.text);
      inputRef.current?.focus({ preventScroll: true });
    }
  }, [chatPrefill.n]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chatLog.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    addChatMsg({ who: getUser()?.name || 'You', text, self: true });
    setDraft('');
    if (Math.random() < 0.45) {
      const reply = CHAT_REPLIES[Math.floor(Math.random() * CHAT_REPLIES.length)];
      window.setTimeout(() => {
        if (openSet.has('chat')) addChatMsg({ ...reply, self: false });
      }, 1200 + Math.random() * 1800);
    }
  };

  return (
    <>
      <ul className="chat-log" aria-label="Hall chat" ref={logRef}>
        {chatLog.map((m, i) => (
          <li key={i} className={m.self ? 'chat-msg is-self' : 'chat-msg'}>
            <span className="chat-who">{m.who}</span>
            <span className="chat-text">{m.text}</span>
          </li>
        ))}
      </ul>
      <form className="chat-form" onSubmit={onSubmit}>
        <label className="visually-hidden" htmlFor="chat-input">Message</label>
        <input
          id="chat-input"
          ref={inputRef}
          autoComplete="off"
          placeholder="Message the hall…"
          maxLength={240}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn btn-primary" type="submit">Send</button>
      </form>
    </>
  );
}

/* Friends — fixture companions with presence, invite/message, add form */

interface Companion { name: string; sigil: Sigil; status: 'hall' | 'table' | 'away'; tally?: string; }

const COMPANIONS: Companion[] = [
  { name: 'Ser Calloway of the Eaves', sigil: 'raven', status: 'hall', tally: '3–1' },
  { name: 'Mathilde, Tithe-Sworn', sigil: 'gilt', status: 'table', tally: '2–2' },
  { name: 'Aldric Emberguard', sigil: 'ember', status: 'away', tally: '5–0' },
  { name: 'Lady Wrenfield the Unkind', sigil: 'raven', status: 'hall', tally: '4–7' },
];
const STATUS_LABEL: Record<Companion['status'], string> = {
  hall: 'In the hall',
  table: 'At the table',
  away: 'Away',
};

let companions: Companion[] = [...COMPANIONS];
function addCompanion(c: Companion) {
  companions = [...companions, c];
  emit();
}

function FriendsBody() {
  const [draft, setDraft] = useState('');

  const whisper = (name: string) => {
    chatPrefill = { text: `(to ${name}) `, n: chatPrefill.n + 1 };
    openPanel('chat');
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = draft.trim();
    if (name.length < 2) return;
    addCompanion({ name, sigil: 'veil', status: 'away' });
    setDraft('');
    herald(`${name} added to your friends.`);
  };

  return (
    <>
      <ul className="companion-list">
        {companions.map((c, i) => (
          <li key={`${c.name}-${i}`} className="companion">
            <svg className="companion-sigil" aria-hidden="true"><use href={`#crest-${c.sigil}`} /></svg>
            <span className="companion-id">
              <span className="companion-name">{c.name}</span>
              <span className="companion-status" data-status={c.status}>
                {STATUS_LABEL[c.status]}
                {c.tally && <span className="companion-tally">· vs you {c.tally}</span>}
              </span>
            </span>
            <span className="companion-actions">
              {/* honest: no invitation is actually delivered yet */}
              <button type="button" onClick={() => herald('The invitation scrolls are still being lettered. Soon.')}>Invite</button>
              <button type="button" onClick={() => whisper(c.name)}>Message</button>
            </span>
          </li>
        ))}
      </ul>
      <form className="companion-add" onSubmit={onSubmit}>
        <label className="visually-hidden" htmlFor="companion-input">Friend name</label>
        <input
          id="companion-input"
          autoComplete="off"
          placeholder="Add a friend…"
          maxLength={40}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button className="btn btn-ghost" type="submit">Add</button>
      </form>
    </>
  );
}

/* Profile & settings — name, sigil, theme, calm, sign out */

const SIGILS: Sigil[] = ['ember', 'raven', 'gilt', 'veil'];
const SIGIL_NAMES: Record<Sigil, string> = { ember: 'Ember', raven: 'Raven', gilt: 'Gilt', veil: 'Veil' };

function SettingsBody() {
  const user = useUser();
  const calm = useCalm();
  const [name, setName] = useState(user?.name ?? '');

  const onNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = name.trim();
    if (next.length < 3) { herald('Display names need at least 3 characters.'); return; }
    updateUser({ name: next });
    herald('Name updated.');
  };

  const onSignOut = () => {
    closeAllPanels();
    setEditMode(false);
    signOut();
    herald('Signed out. The gates remember.');
    window.location.hash = '#/';
  };

  return (
    <>
      <div className="panel-section">
        <h3 className="eyebrow">Display name</h3>
        <form className="settings-name" onSubmit={onNameSubmit}>
          <label className="visually-hidden" htmlFor="settings-name-input">Display name</label>
          <input
            id="settings-name-input"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn btn-ghost" type="submit">Save</button>
        </form>
      </div>
      <div className="panel-section">
        <h3 className="eyebrow">Sigil</h3>
        <div className="sigil-options settings-sigils">
          {SIGILS.map((s) => (
            <label className="sigil-option" key={s}>
              <input
                type="radio"
                name="settings-sigil"
                value={s}
                checked={user?.sigil === s}
                onChange={() => { updateUser({ sigil: s }); herald(`Sigil changed to ${SIGIL_NAMES[s]}.`); }}
              />
              <svg aria-hidden="true"><use href={`#crest-${s}`} /></svg>
              <span>{SIGIL_NAMES[s]}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="panel-section">
        <h3 className="eyebrow">Theme</h3>
        <ThemeSeals groupLabel="Theme" />
      </div>
      <div className="panel-section">
        <h3 className="eyebrow">Motion</h3>
        <label className="toggle">
          <input
            type="checkbox"
            checked={calm}
            onChange={(e) => {
              setCalm(e.target.checked);
              herald(e.target.checked ? 'Animations reduced. The hall stills.' : 'Animations restored.');
            }}
          />
          <span>Reduce animations</span>
        </label>
        <p className="field-hint">Stills the embers, the card tilt, and the entrance choreography.</p>
      </div>
      <div className="panel-section">
        <button className="profile-signout" type="button" onClick={onSignOut}>Sign out</button>
      </div>
    </>
  );
}
