/**
 * TableTab — the SINGLE-PAGE GAME SCREEN BUILDER (webpage-builder feel):
 *   left  = element palette (+ Zone with inline game-zone creation, Text,
 *           Variable, Button, Shape, Line, ready-made Phase track, Group)
 *   center= zoom/pan canvas that IS the player's whole screen (aspect
 *           presets, smart alignment guides, nested groups, drag-to-join,
 *           editor-only STATE PREVIEW driven from the Properties panel)
 *   right = Layers (nested tree, frontmost on top) over Properties
 * On phones the rails collapse into bottom-sheet drawers. ⛶ goes fullscreen
 * (fixed overlay, Esc exits). Keyboard: Esc clears selection, Delete removes
 * the selected elements (layout only), arrows nudge 1% (shift = 5%),
 * Ctrl+Z/Y undo/redo (layout snapshots, bursts coalesced), Ctrl+C/X/V
 * copy/cut/paste (module clipboard, survives variant/tab hops), Ctrl+D
 * duplicate in place, Ctrl+G / Ctrl+Shift+G group/ungroup.
 *
 * FOCUS MODE (editor-only, never persisted): double-click an element (canvas
 * or Layers row) or hit ⛶ Focus in Properties — the canvas shows just that
 * element with its CHILDREN editable at 1%-of-its-box precision, the palette
 * inserts into its children, and Layers scopes to its subtree. A breadcrumb
 * (Screen › …) walks back out; Esc pops one level when nothing is selected.
 *
 * Edits GameDef.screenLayout. Defs still carrying the deprecated v3
 * tableLayout are migrated once on open (shared/migrate). Absent layout =
 * the runner's automatic arrangement; switching to "Custom" seeds a starter
 * layout generated from the def, so nothing breaks when you switch.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameDef, Id, ScreenElement, ScreenLayout } from '../../shared/types';
import { migrateGameDef } from '../../shared/migrate';
import { ConfirmModal, Modal } from '../common/Modal';
import { ScreenCanvas, type DragCommit } from './table/ScreenCanvas';
import { LayersPanel } from './table/LayersPanel';
import { PropertiesPanel } from './table/PropertiesPanel';
import { Palette } from './table/Palette';
import {
  addComponent, loadComponents, persistComponents, removeComponent, type SavedComponent,
} from './table/components';
import {
  ASPECT_VALUES, alignElements, buildStarterLayout, cloneElementsWithNewIds, createMobileVariant,
  deleteMobileVariant,
  distributeElements, duplicateEls, elChildren, findEl, groupSiblings, indexElements,
  insertIntoFocusedChildren, pathToEl, placeRelativeEl, pruneNested, removeEls, reorderSibling,
  reparentEl, setAbsRect, siblingsOf, ungroupEl, updateEl, validFocusPath, variantElements,
  withElChildren, withVariantElements,
  type AlignOp, type AspectPreset, type VariantKey,
} from './table/screenModel';
import './table/table.css';

export interface TableTabProps {
  def: GameDef;
  onChange: (def: GameDef) => void;
}

export function TableTab({ def: rawDef, onChange }: TableTabProps) {
  // Migrate-on-open: defs still on the deprecated v3 tableLayout get their
  // screenLayout once (and we render from the migrated copy immediately —
  // built-in examples never save, so they migrate in memory only).
  const def = useMemo(() => migrateGameDef(rawDef), [rawDef]);
  const migratedRef = useRef(false);
  useEffect(() => {
    if (def !== rawDef && !migratedRef.current) {
      migratedRef.current = true;
      onChange(def);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, rawDef]);

  const layout = def.screenLayout ?? null;
  const [confirmReset, setConfirmReset] = useState(false);

  const modeToggle = (
    <div className="tt-seg" role="group" aria-label="Layout mode">
      <button
        type="button"
        className={layout ? '' : 'tt-active'}
        onClick={() => { if (layout) setConfirmReset(true); }}
      >
        Automatic layout
      </button>
      <button
        type="button"
        className={layout ? 'tt-active' : ''}
        onClick={() => { if (!layout) onChange({ ...def, screenLayout: buildStarterLayout(def) }); }}
      >
        Custom screen
      </button>
    </div>
  );

  const resetModal = confirmReset && (
    <ConfirmModal
      title="Back to the automatic layout?"
      message="Your designed screen (element positions, groups, styles, visibility rules and background) will be discarded. The runner will arrange the table automatically again."
      confirmLabel="Discard design"
      onConfirm={() => { onChange({ ...def, screenLayout: null }); setConfirmReset(false); }}
      onCancel={() => setConfirmReset(false)}
    />
  );

  if (!layout) {
    const plainActions = def.actions.filter((a) => a.target.kind === 'none').length;
    return (
      <div className="tt-root">
        <div className="row" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>Game screen</h2>
          <div className="spacer" />
          {modeToggle}
        </div>
        <div className="panel">
          <h3>Automatic layout</h3>
          <p className="muted">
            The runner arranges the screen for you: shared zones in the middle, your zones at
            the bottom, opponents up top. Switch to a custom screen to design the whole page
            yourself — zones with grids and borders, buttons, readouts, shapes and lines, a
            ready-made phase track, groups, conditional visibility and reactive states. It
            starts from a sensible arrangement, so nothing breaks when you switch.
          </p>
          <p className="faint" style={{ margin: 0 }}>
            {def.zones.length} zone{def.zones.length === 1 ? '' : 's'} ·{' '}
            {def.variables.length} variable{def.variables.length === 1 ? '' : 's'} ·{' '}
            {plainActions} button-able action{plainActions === 1 ? '' : 's'}
          </p>
        </div>
        {resetModal}
      </div>
    );
  }

  return (
    <div className="tt-root">
      <div className="row wrap" style={{ marginBottom: 10 }}>
        <h2 style={{ margin: 0 }}>Game screen</h2>
        <div className="spacer" />
        {modeToggle}
      </div>
      <Workspace def={def} layout={layout} onChange={onChange} />
      {resetModal}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workspace (custom screen editing)
// ---------------------------------------------------------------------------

type Drawer = 'palette' | 'layers' | 'props' | null;

// Copied elements (deep-frozen clones). Module scope on purpose: the board
// survives tab switches and variant hops, so copy on desktop / paste on
// mobile just works. Ids regenerate on every paste.
let clipboardEls: ScreenElement[] = [];
let pasteSeq = 0;

/** Undo/redo memory: layout snapshots. Bursts (slider scrubs, rapid patches)
 *  within this window coalesce into ONE entry, so undo steps feel like edits,
 *  not mouse events. */
const HISTORY_BURST_MS = 400;
const HISTORY_CAP = 100;

function Workspace({ def, layout, onChange }: {
  def: GameDef;
  layout: ScreenLayout;
  onChange: (def: GameDef) => void;
}) {
  const [sel, setSel] = useState<Id[]>([]);
  const [fullscreen, setFullscreen] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(null);
  // Which layout variant is being edited (desktop tree vs the mobile tree).
  const [variant, setVariant] = useState<VariantKey>('desktop');
  const [createMobile, setCreateMobile] = useState(false);
  const [confirmDeleteMobile, setConfirmDeleteMobile] = useState(false);
  // Editor-only: preview ONE state of ONE element on the canvas (not persisted).
  const [statePreview, setStatePreview] = useState<{ id: Id; stateId: Id } | null>(null);
  // FOCUS MODE (editor-only): id chain root → focused element ([] = screen).
  const [focusPath, setFocusPath] = useState<Id[]>([]);

  // ----- undo/redo (#4): layout snapshots, coalesced per edit burst -----
  const historyRef = useRef<{ past: ScreenLayout[]; future: ScreenLayout[]; last: number }>(
    { past: [], future: [], last: 0 },
  );
  const pushHistory = () => {
    const h = historyRef.current;
    const now = Date.now();
    if (now - h.last > HISTORY_BURST_MS) {
      h.past.push(layout);
      if (h.past.length > HISTORY_CAP) h.past.shift();
    }
    h.last = now;
    h.future = [];
  };
  // Undo/redo swap the CURRENT layout with a snapshot; other tabs' def edits
  // are never touched (snapshots carry only screenLayout).
  const undo = () => {
    const h = historyRef.current;
    const prev = h.past.pop();
    if (prev === undefined) return;
    h.future.push(layout);
    h.last = 0;
    onChange({ ...def, screenLayout: prev });
  };
  const redo = () => {
    const h = historyRef.current;
    const next = h.future.pop();
    if (next === undefined) return;
    h.past.push(layout);
    h.last = 0;
    onChange({ ...def, screenLayout: next });
  };
  // Recomputed every render (each edit re-renders), so the buttons stay live.
  const canUndo = historyRef.current.past.length > 0;
  const canRedo = historyRef.current.future.length > 0;

  const setLayout = (sl: ScreenLayout) => {
    pushHistory();
    onChange({ ...def, screenLayout: sl });
  };
  // EVERYTHING edits the open variant's tree (palette, layers, canvas, props).
  const elements = variantElements(layout, variant);
  const setElements = (els: ScreenElement[]) => setLayout(withVariantElements(layout, variant, els));

  // Variant sanity: editing "mobile" only makes sense while it exists.
  useEffect(() => {
    if (variant === 'mobile' && !layout.mobile) setVariant('desktop');
  }, [variant, layout.mobile]);

  const switchVariant = (v: VariantKey) => {
    if (v === variant) return;
    if (v === 'mobile' && !layout.mobile) {
      setCreateMobile(true);
      return;
    }
    setVariant(v);
    setSel([]);
    setStatePreview(null);
    setFocusPath([]); // focus paths are per-tree
  };

  const index = useMemo(() => indexElements(elements), [elements]);

  // ----- focus mode -----

  const focusEl = useMemo(() => {
    if (focusPath.length === 0) return null;
    if (validFocusPath(elements, focusPath).length !== focusPath.length) return null;
    return findEl(elements, focusPath[focusPath.length - 1]);
  }, [elements, focusPath]);

  // Focus sanity: trim the path when elements along it vanish — deleting the
  // focused element exits focus mode safely.
  useEffect(() => {
    const valid = validFocusPath(elements, focusPath);
    if (valid.length !== focusPath.length) setFocusPath(valid);
  }, [elements, focusPath]);

  /**
   * Change focus. Descending selects the newly-focused element; backing out
   * restores the selection to the previously-focused one.
   */
  const setFocus = (next: Id[]) => {
    if (next.length === focusPath.length && next.every((id, i) => id === focusPath[i])) return;
    if (next.length < focusPath.length) setSel([focusPath[focusPath.length - 1]]);
    else setSel(next.length > 0 ? [next[next.length - 1]] : []);
    setFocusPath(next);
  };

  /** Focus by element id (Properties ⛶ button, Layers double-click). */
  const focusElement = (id: Id) => {
    const path = pathToEl(elements, id);
    if (path) setFocus(path);
  };

  // The OPERATING SCOPE for canvas-space edits (drag commits, nudges, align):
  // the focused element's children — rects are % of its box, so the 1% snap
  // becomes super fine — or the whole variant tree when not focused.
  const scopeEls = focusEl ? elChildren(focusEl) : elements;
  const scopeIndex = useMemo(() => indexElements(scopeEls), [scopeEls]);
  const setScopeEls = (els: ScreenElement[]) => {
    if (els === scopeEls) return;
    setElements(focusEl ? updateEl(elements, focusEl.id, (p) => withElChildren(p, els)) : els);
  };

  // ----- selection sanity: drop ids whose element vanished -----
  useEffect(() => {
    if (sel.length === 0) return;
    const alive = sel.filter((id) => index.has(id));
    if (alive.length !== sel.length) setSel(alive);
  }, [sel, index]);

  // ----- state-preview sanity: only while its element is the single selection -----
  useEffect(() => {
    if (!statePreview) return;
    if (sel.length !== 1 || sel[0] !== statePreview.id) {
      setStatePreview(null);
      return;
    }
    const el = index.get(statePreview.id)?.el;
    if (!el || !(el.states ?? []).some((s) => s.id === statePreview.stateId)) setStatePreview(null);
  }, [sel, index, statePreview]);

  const toggleSelect = (id: Id) => {
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  // ----- mutations -----

  const patchEl = (id: Id, fn: (el: ScreenElement) => ScreenElement) =>
    setElements(updateEl(elements, id, fn));

  // Drag commits arrive in SCOPE space (% of the focused element's box while
  // focused, % of the screen otherwise) — the canvas and this index agree.
  const commitDrag = (commit: DragCommit) => {
    let els = scopeEls;
    if (commit.rects.length === 1 && commit.targetGroupId !== undefined) {
      const { id, abs } = commit.rects[0];
      const info = scopeIndex.get(id);
      if (!info) return;
      if (commit.targetGroupId !== info.parentId) {
        els = reparentEl(els, id, commit.targetGroupId, abs);
      } else {
        els = setAbsRect(els, info, abs);
      }
    } else {
      for (const { id, abs } of commit.rects) {
        const info = scopeIndex.get(id);
        if (info) els = setAbsRect(els, info, abs);
      }
    }
    setScopeEls(els);
  };

  const removeSelected = (ids: Id[]) => {
    setElements(removeEls(elements, new Set(ids)));
    setSel([]);
  };

  const insertElement = (el: ScreenElement) => {
    setElements(focusEl
      ? insertIntoFocusedChildren(elements, focusEl.id, el)
      : [...elements, el]);
    setSel([el.id]);
    setDrawer(null);
  };

  // ----- reusable component library (per-device) ----------------------------
  const [components, setComponents] = useState<SavedComponent[]>(() => loadComponents());
  const persistLibrary = (next: SavedComponent[]) => { setComponents(next); persistComponents(next); };
  const saveComponent = (el: ScreenElement, name: string) => {
    // Store a fresh-id clone so the saved copy never shares ids with the live tree.
    const stored = cloneElementsWithNewIds([el])[0];
    persistLibrary(addComponent(components, `c_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`, name, stored));
  };
  const insertComponent = (comp: SavedComponent) => insertElement(cloneElementsWithNewIds([comp.el])[0]);
  const deleteComponent = (id: string) => persistLibrary(removeComponent(components, id));

  const createZone = (zone: GameDef['zones'][number], el: ScreenElement) => {
    const nextEls = focusEl
      ? insertIntoFocusedChildren(elements, focusEl.id, el)
      : [...elements, el];
    pushHistory(); // undo restores the layout; the zone def stays (harmless orphan)
    onChange({
      ...def,
      zones: [...def.zones, zone],
      screenLayout: withVariantElements(layout, variant, nextEls),
    });
    setSel([el.id]);
    setDrawer(null);
  };

  // ----- clipboard (#4): copy / cut / paste / duplicate -----

  const copySelection = () => {
    const ids = pruneNested(index, sel);
    if (ids.length === 0) return;
    clipboardEls = ids
      .map((id) => index.get(id)?.el)
      .filter((el): el is ScreenElement => el !== undefined)
      .map((el) => structuredClone(el));
    pasteSeq = 0;
  };

  const pasteClipboard = () => {
    if (clipboardEls.length === 0) return;
    pasteSeq += 1;
    const off = 2 * pasteSeq;
    const pasted = cloneElementsWithNewIds(structuredClone(clipboardEls)).map((el) => ({
      ...el,
      rect: {
        ...el.rect,
        x: Math.min(Math.max(el.rect.x + off, 0), Math.max(0, 100 - el.rect.w)),
        y: Math.min(Math.max(el.rect.y + off, 0), Math.max(0, 100 - el.rect.h)),
      },
    }));
    setElements(focusEl
      ? pasted.reduce((acc, el) => insertIntoFocusedChildren(acc, focusEl.id, el), elements)
      : [...elements, ...pasted]);
    setSel(pasted.map((el) => el.id));
  };

  const duplicateSelection = () => {
    const ids = pruneNested(index, sel);
    if (ids.length === 0) return;
    const result = duplicateEls(elements, ids);
    if (result.newIds.length === 0) return;
    setElements(result.elements);
    setSel(result.newIds);
  };

  const groupSelection = () => {
    const grouped = groupSiblings(elements, sel);
    if (!grouped) return;
    setElements(grouped.elements);
    setSel([grouped.groupId]);
  };

  const ungroup = (groupId: Id) => {
    const result = ungroupEl(elements, groupId);
    if (!result) return;
    setElements(result.elements);
    setSel(result.childIds);
  };

  const canGroup = useMemo(() => {
    if (sel.length < 2) return false;
    const sibs = siblingsOf(elements, sel[0]);
    return !!sibs && sel.every((id) => sibs.some((s) => s.id === id));
  }, [sel, elements]);

  // ----- keyboard: Esc / Delete / arrows / undo-redo / clipboard / grouping -----

  const keyCtx = useRef({
    sel, fullscreen, drawer, elements, focusPath, scopeEls, scopeIndex, setScopeEls, setFocus,
    undo, redo, copySelection, pasteClipboard, duplicateSelection, groupSelection, ungroup, index,
  });
  keyCtx.current = {
    sel, fullscreen, drawer, elements, focusPath, scopeEls, scopeIndex, setScopeEls, setFocus,
    undo, redo, copySelection, pasteClipboard, duplicateSelection, groupSelection, ungroup, index,
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ctx = keyCtx.current;
      // Modals (expression builder, zone creation, confirms) own the keyboard.
      if (document.querySelector('.modal-backdrop')) return;
      const t = e.target as HTMLElement | null;
      if (t && t.closest?.('input, select, textarea, [contenteditable]')) return;
      // The one-screen editor's slide-over section panel owns its own keys —
      // Ctrl+Z in the Flow editor must not undo the table layout.
      if (t && t.closest?.('.ed-panel')) return;

      if (e.key === 'Escape') {
        if (ctx.drawer) setDrawer(null);
        else if (ctx.sel.length > 0) setSel([]);
        else if (ctx.focusPath.length > 0) ctx.setFocus(ctx.focusPath.slice(0, -1));
        else if (ctx.fullscreen) setFullscreen(false);
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      // History + paste work with or without a selection.
      if (mod && k === 'z') {
        e.preventDefault();
        if (e.shiftKey) ctx.redo(); else ctx.undo();
        return;
      }
      if (mod && k === 'y') {
        e.preventDefault();
        ctx.redo();
        return;
      }
      if (mod && k === 'v') {
        e.preventDefault();
        ctx.pasteClipboard();
        return;
      }
      if (ctx.sel.length === 0) return;

      if (mod && k === 'c') {
        e.preventDefault();
        ctx.copySelection();
        return;
      }
      if (mod && k === 'x') {
        e.preventDefault();
        ctx.copySelection();
        setElements(removeEls(ctx.elements, new Set(ctx.sel)));
        setSel([]);
        return;
      }
      if (mod && k === 'd') {
        e.preventDefault(); // beat the browser's bookmark shortcut
        ctx.duplicateSelection();
        return;
      }
      if (mod && k === 'g') {
        e.preventDefault();
        if (e.shiftKey) {
          const only = ctx.sel.length === 1 ? ctx.index.get(ctx.sel[0])?.el : undefined;
          if (only?.kind === 'group') ctx.ungroup(only.id);
        } else {
          ctx.groupSelection();
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setElements(removeEls(ctx.elements, new Set(ctx.sel)));
        setSel([]);
        return;
      }
      const arrow: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
      };
      const d = arrow[e.key];
      if (!d) return;
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      const [dx, dy] = [d[0] * step, d[1] * step];
      // Nudges run in SCOPE space: 1% of the focused element's box in focus
      // mode (super fine), 1% of the screen otherwise.
      let els = ctx.scopeEls;
      for (const id of pruneNested(ctx.scopeIndex, ctx.sel)) {
        const info = ctx.scopeIndex.get(id);
        if (!info) continue;
        const moved = {
          ...info.abs,
          x: Math.min(Math.max(info.abs.x + dx, 0), Math.max(0, 100 - info.abs.w)),
          y: Math.min(Math.max(info.abs.y + dy, 0), Math.max(0, 100 - info.abs.h)),
        };
        els = setAbsRect(els, info, moved);
      }
      ctx.setScopeEls(els);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, layout, variant]);

  // Lock body scroll while the fullscreen overlay is up.
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [fullscreen]);

  // ----- panels (shared between rails and mobile drawers) -----

  const palettePanel = (
    <Palette
      def={def}
      onInsert={insertElement}
      onCreateZone={createZone}
      focusName={focusEl?.name ?? null}
      components={components}
      onInsertComponent={insertComponent}
      onDeleteComponent={deleteComponent}
    />
  );

  // While focused, Layers scopes to the focused element's subtree — its own
  // row renders as the root. Reorder/rename stay id-based (full-tree edits).
  const layersPanel = (
    <LayersPanel
      elements={focusEl ? [focusEl] : elements}
      sel={sel}
      onSelect={(id, additive) => (additive ? toggleSelect(id) : setSel([id]))}
      onMoveLayer={(id, dir) => setElements(reorderSibling(elements, id, dir))}
      onDropLayer={(dragId, targetId) => setElements(placeRelativeEl(elements, dragId, targetId))}
      onRename={(id, name) => patchEl(id, (el) => ({ ...el, name }))}
      onFocus={focusElement}
    />
  );

  const propsPanel = (
    <PropertiesPanel
      def={def}
      layout={layout}
      variant={variant}
      sel={sel}
      onChangeDef={onChange}
      onPatchEl={patchEl}
      onRemove={removeSelected}
      onGroup={groupSelection}
      canGroup={canGroup}
      onUngroup={ungroup}
      onAlign={(op: AlignOp) => setScopeEls(alignElements(scopeEls, sel, op))}
      onDistribute={(axis) => setScopeEls(distributeElements(scopeEls, sel, axis))}
      onFocus={focusElement}
      onSaveComponent={saveComponent}
      onSetLayout={setLayout}
      onDeleteMobile={() => setConfirmDeleteMobile(true)}
      statePreviewId={sel.length === 1 && statePreview?.id === sel[0] ? statePreview.stateId : null}
      onStatePreview={(stateId) =>
        setStatePreview(stateId !== null && sel.length === 1 ? { id: sel[0], stateId } : null)}
    />
  );

  const canvas = (
    <ScreenCanvas
      def={def}
      layout={layout}
      variant={variant}
      mobileExists={!!layout.mobile}
      onVariant={switchVariant}
      sel={sel}
      onSelect={setSel}
      onToggleSelect={toggleSelect}
      onCommitDrag={commitDrag}
      onPatchEl={patchEl}
      onAspect={(preset: AspectPreset) => setLayout({ ...layout, aspect: ASPECT_VALUES[preset] })}
      fullscreen={fullscreen}
      onToggleFullscreen={() => setFullscreen((f) => !f)}
      statePreview={statePreview}
      focusPath={focusPath}
      onFocusPath={setFocus}
      onUndo={undo}
      onRedo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
    />
  );

  const selLabel = sel.length === 0
    ? 'Properties'
    : sel.length > 1
      ? `${sel.length} selected`
      : (index.get(sel[0])?.el.name ?? 'Element');

  return (
    <div className={fullscreen ? 'tt-ws tt-ws-full' : 'tt-ws'}>
      <aside className="tt-rail tt-rail-l" aria-label="Element palette">
        {palettePanel}
      </aside>

      <div className="tt-center">
        {canvas}
        <div className="tt-mobilebar">
          <button type="button" className="btn btn-small" onClick={() => setDrawer('palette')}>＋ Add</button>
          <button type="button" className="btn btn-small" onClick={() => setDrawer('layers')}>Layers</button>
          <button type="button" className="btn btn-small" onClick={() => setDrawer('props')}>{selLabel}</button>
        </div>
      </div>

      <aside className="tt-rail tt-rail-r" aria-label="Layers and properties">
        <div className="tt-rail-box tt-rail-layers">
          <h3 className="tt-rail-title">Layers</h3>
          {layersPanel}
        </div>
        <div className="tt-rail-box tt-rail-props">
          {propsPanel}
        </div>
      </aside>

      {drawer !== null && (
        <>
          <div className="tt-sheet-backdrop" onClick={() => setDrawer(null)} />
          <div className="tt-sheet" role="dialog" aria-label={drawer === 'palette' ? 'Element palette' : drawer === 'layers' ? 'Layers' : 'Properties'}>
            <div className="tt-sheet-head">
              <h3 style={{ margin: 0 }}>
                {drawer === 'palette' ? 'Add elements' : drawer === 'layers' ? 'Layers' : selLabel}
              </h3>
              <div className="spacer" />
              <button type="button" className="btn btn-small" onClick={() => setDrawer(null)} aria-label="Close panel">✕</button>
            </div>
            <div className="tt-sheet-body">
              {drawer === 'palette' && palettePanel}
              {drawer === 'layers' && layersPanel}
              {drawer === 'props' && propsPanel}
            </div>
          </div>
        </>
      )}

      {createMobile && (
        <CreateMobileModal
          onClose={() => setCreateMobile(false)}
          onCreate={(from) => {
            setCreateMobile(false);
            setLayout(createMobileVariant(layout, from));
            setVariant('mobile');
            setSel([]);
            setStatePreview(null);
            setFocusPath([]);
          }}
        />
      )}

      {confirmDeleteMobile && (
        <ConfirmModal
          title="Delete the mobile layout?"
          message="The mobile element tree (positions, styles, states) will be discarded. Phones will use the desktop layout again."
          confirmLabel="Delete mobile layout"
          onConfirm={() => {
            setConfirmDeleteMobile(false);
            setVariant('desktop');
            setSel([]);
            setStatePreview(null);
            setFocusPath([]);
            setLayout(deleteMobileVariant(layout));
          }}
          onCancel={() => setConfirmDeleteMobile(false)}
        />
      )}
    </div>
  );
}

/** "+ Create mobile layout": seed from a desktop copy (new ids) or start empty. */
function CreateMobileModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (from: 'copy' | 'empty') => void;
}) {
  return (
    <Modal
      title="Create the mobile layout"
      onClose={onClose}
      footer={<button type="button" className="btn" onClick={onClose}>Cancel</button>}
    >
      <p className="faint" style={{ marginTop: 0 }}>
        Narrow screens (below 1024&thinsp;px) get their own page — a tall phone frame you
        design separately. The desktop layout stays untouched.
      </p>
      <div className="tt-variant-choices">
        <button type="button" className="btn" onClick={() => onCreate('copy')}>
          <span className="tt-variant-choice-title">⧉ Start from a copy of desktop</span>
          <span className="tt-variant-choice-hint">
            Every element duplicated onto the phone page — rearrange for a tall screen.
          </span>
        </button>
        <button type="button" className="btn" onClick={() => onCreate('empty')}>
          <span className="tt-variant-choice-title">▭ Start empty</span>
          <span className="tt-variant-choice-hint">
            A blank phone page — add elements from the palette.
          </span>
        </button>
      </div>
    </Modal>
  );
}
