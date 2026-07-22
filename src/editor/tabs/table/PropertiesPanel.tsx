/**
 * PropertiesPanel — the inspector for the current selection:
 *   nothing   -> screen properties (background, aspect hint)
 *   1 element -> ⛶ Focus button (edit the elements ON TOP of it, any kind)
 *                + child-element count, name, x/y/w/h (% of parent),
 *                per-kind settings (zone seat/
 *                cardScale/spacing/rows×columns + DECK COMPOSITION + CARD
 *                PARTS (per-part chrome overrides, canvas part-clicks force-
 *                open the matching row), text/
 *                varText typography + INLINE "+ New variable", button binding
 *                + INLINE "+ New action" and "Edit script…" (node graph in a
 *                modal), shape/line options, group children list/ungroup),
 *                style chrome,
 *                reactive STATES (ordered, first match wins — name, when,
 *                style overrides, rect capture, canvas preview control),
 *                reveal transition, and VISIBLE WHEN via the
 *                ExpressionEditor ($viewer bound)
 *   2+        -> Group selection + save-as-component (siblings only) +
 *                webpage-builder alignment essentials (align left/center/
 *                right/top/middle/bottom, distribute H/V)
 *
 * PRESENTATION: on ≤720px viewports (the runner's narrow breakpoint) the
 * panel switches to bottom-sheet dress (`tt-props-narrow`) — the workspace
 * already hosts it inside the mobile bottom-sheet drawer (`tt-sheet`); the
 * class widens touch targets to ≥44px and relaxes the control grid.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  ActionDef, DeckDef, ElementState, FlowLayout, GameDef, Id, LayoutStyle, MotionSpec, RevealAnim,
  ScreenElement, ScreenLayout, SeatRef, ShadowSpec, ShapeKind, TextStyle, VariableDef, ZoneDef,
  ZonePartKey, ZonePartStyle,
} from '../../../shared/types';
import { SHAPE_KINDS, shapeBorderRadius, shapeClipPath } from '../../../runner/layoutGeometry';
import { PASS_ACTION_ID } from '../../../shared/types';
import { uid } from '../../../shared/defaults';
import { BlockScriptEditor } from '../../blocks/BlockScriptEditor';
import { ConditionBuilder } from '../../blocks/ConditionBuilder';
import { ExpressionEditor } from '../../blocks/ExpressionEditor';
import { AnnouncePartsChip } from '../../blocks/slots';
import { Modal } from '../../common/Modal';
import { removeAt, updateAt } from '../../lib';
import { ColorPicker } from './ColorPicker';
import { defaultGradient, gradientToCss, parseGradient, type Gradient } from './gradient';
import {
  GROUP_MIN, MIN_H, MIN_W, MOTION_DEFAULTS, PHONE_ASPECT, addElementState, bindCounterStepActions,
  deckCardCount,
  findEl, makeActionDef, makeVariableDef, moveElementState, newButtonElement, newCounterElement,
  newCustomDeckAt, newElementState, newGroupElement, newImageElement, newLineElement,
  newShapeElement, newTextElement, newVarTextElement, patchMobileVariant, patchMotion,
  removeElementState, selectorButtonOptions,
  setTextDynamic, snapStep, templateFieldOptions, updateEl, updateElementState, variantElements,
  withVariantElements, writeSelection, type AlignOp, type VariantKey,
} from './screenModel';
import { ZONE_PARTS, getPartStyle, withPartStyle, type ZonePartSel } from './zoneParts';

const RANK_LABELS: [number, string][] = [
  [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7'], [8, '8'],
  [9, '9'], [10, '10'], [11, 'J'], [12, 'Q'], [13, 'K'], [14, 'A'],
];

const KIND_LABELS: Record<ScreenElement['kind'], string> = {
  zone: 'zone', text: 'text', varText: 'variable', button: 'button',
  counter: 'counter', shape: 'shape', line: 'line', log: 'log', group: 'group',
  panelSwitcher: 'panel switcher', image: 'image',
};

/** Kind glyphs for the group-children list — mirrors the Layers panel's ICONS. */
const KIND_ICONS: Record<ScreenElement['kind'], string> = {
  zone: '▭', text: 'T', varText: '#', button: '▸', counter: '±', shape: '◯', line: '╱', log: '☰',
  group: '▦', panelSwitcher: '⧉', image: '🖼',
};

type ZoneEl = Extract<ScreenElement, { kind: 'zone' }>;
type TextEl = Extract<ScreenElement, { kind: 'text' }>;
type VarTextEl = Extract<ScreenElement, { kind: 'varText' }>;
type CounterEl = Extract<ScreenElement, { kind: 'counter' }>;
type ButtonEl = Extract<ScreenElement, { kind: 'button' }>;
type ShapeEl = Extract<ScreenElement, { kind: 'shape' }>;
type LineEl = Extract<ScreenElement, { kind: 'line' }>;
type GroupEl = Extract<ScreenElement, { kind: 'group' }>;
type PanelSwitcherEl = Extract<ScreenElement, { kind: 'panelSwitcher' }>;
type ImageEl = Extract<ScreenElement, { kind: 'image' }>;

export interface PropertiesPanelProps {
  def: GameDef;
  layout: ScreenLayout;
  /** Which layout variant is open — patches land in its tree/settings. */
  variant: VariantKey;
  sel: Id[];
  onChangeDef: (def: GameDef) => void;
  onPatchEl: (id: Id, fn: (el: ScreenElement) => ScreenElement) => void;
  onRemove: (ids: Id[]) => void;
  /** Wrap the (sibling) selection in a group; false-disabled otherwise. */
  onGroup: () => void;
  canGroup: boolean;
  onUngroup: (groupId: Id) => void;
  onAlign: (op: AlignOp) => void;
  onDistribute: (axis: 'h' | 'v') => void;
  /** ⛶ Focus the element on the canvas (edit the elements on top of it). */
  onFocus: (id: Id) => void;
  /** Open the styled save-component dialog for the element (workspace-owned). */
  onSaveComponent: (el: ScreenElement) => void;
  /** Layout-level patches (backgrounds, motion, mobile settings). */
  onSetLayout: (layout: ScreenLayout) => void;
  /** Asks the workspace to confirm-delete the mobile layout. */
  onDeleteMobile: () => void;
  /** Editor-only canvas preview: which of the selected element's states shows (null = base). */
  statePreviewId: Id | null;
  onStatePreview: (stateId: Id | null) => void;
  /** The canvas-selected card-chrome part of a zone — its row force-opens. */
  partSel?: ZonePartSel | null;
  onPartSel?: (p: ZonePartSel | null) => void;
  /** Replace the canvas selection (the group-children list rows). */
  onSelect?: (ids: Id[]) => void;
  /** Open the save dialog for the whole multi-selection as ONE component. */
  onSaveComponentMulti?: () => void;
}

/** The runner's narrow breakpoint (ScreenRenderer's NARROW_QUERY pattern). */
const NARROW_QUERY = '(max-width: 720px)';

/** True at/below 720px (live media query; false where matchMedia is missing). */
function useNarrowViewport(): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [narrow, setNarrow] = useState(() => supported && window.matchMedia(NARROW_QUERY).matches);
  useEffect(() => {
    if (!supported) return;
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = () => setNarrow(mq.matches);
    onChange();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange); // older WebKit
    return () => mq.removeListener(onChange);
  }, [supported]);
  return narrow;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const narrow = useNarrowViewport();
  const { layout, variant, sel } = props;
  const el = sel.length === 1 ? findEl(variantElements(layout, variant), sel[0]) : null;
  const body = sel.length > 1
    ? <MultiProps {...props} />
    : el
      ? <ElementProps {...props} el={el} />
      : variant === 'mobile' && layout.mobile
        ? <MobileScreenProps {...props} />
        : <ScreenProps {...props} />;
  // Bottom-sheet presentation on phones: the workspace hosts the panel in
  // its bottom-sheet drawer there; this class sizes controls for touch.
  return narrow ? <div className="tt-props-narrow">{body}</div> : body;
}

// ---------------------------------------------------------------------------
// Screen (empty selection) — desktop: background + the motion system
// ---------------------------------------------------------------------------

function ScreenProps({ layout, onSetLayout }: PropertiesPanelProps) {
  const m = layout.motion ?? {};
  const motionStep = (
    label: string, key: keyof typeof MOTION_DEFAULTS, min: number, max: number, step: number,
  ) => (
    <Stepper
      label={label}
      value={m[key] ?? MOTION_DEFAULTS[key]}
      min={min}
      max={max}
      step={step}
      onChange={(v) => onSetLayout(patchMotion(layout, { [key]: v } as Partial<MotionSpec>))}
    />
  );
  return (
    <div className="tt-props">
      <div className="tt-prop-head">
        <h3>Screen</h3>
      </div>
      <p className="faint tt-prop-hint">
        Select an element to edit it — drag empty felt to select several (shift-click adds
        more). Hold Space or drag with the middle button to pan; ctrl-scroll or pinch to
        zoom. Double-click steps into a group, and double-click on plain text or a button
        edits it in place. The ⌨ toolbar button lists every shortcut.
      </p>
      <section className="tt-prop-section">
        <h4>Background</h4>
        <ColorRow
          label="Screen background"
          value={layout.background}
          placeholder="Default felt"
          onChange={(background) => onSetLayout({ ...layout, background })}
        />
        <p className="faint tt-prop-hint">Any CSS color or gradient. Leave empty for the default felt.</p>
      </section>
      <section className="tt-prop-section">
        <h4>Motion <span className="chip">card flights</span></h4>
        <div className="tt-grid">
          {motionStep('Flight ms', 'flightMs', 100, 800, 10)}
          {motionStep('Arc px', 'arc', 0, 120, 2)}
          {motionStep('Spin °', 'spin', 0, 15, 1)}
          {motionStep('Stagger ms', 'staggerMs', 0, 150, 5)}
        </div>
        <p className="faint tt-prop-hint">
          How cards fly between zones — duration, arc height, end rotation, and the delay
          between grouped cards. Defaults: {MOTION_DEFAULTS.flightMs}&thinsp;ms ·{' '}
          {MOTION_DEFAULTS.arc}&thinsp;px · {MOTION_DEFAULTS.spin}° · {MOTION_DEFAULTS.staggerMs}&thinsp;ms.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mobile screen (empty selection, mobile variant open)
// ---------------------------------------------------------------------------

function MobileScreenProps({ layout, onSetLayout, onDeleteMobile }: PropertiesPanelProps) {
  const mobile = layout.mobile!;
  const needsAspect = mobile.scroll === true && mobile.aspect == null;
  return (
    <div className="tt-props">
      <div className="tt-prop-head">
        <h3>Mobile screen</h3>
        <span className="chip">phone 9:19.5</span>
      </div>
      <p className="faint tt-prop-hint">
        {/* 720px = the runner's NARROW_QUERY breakpoint (ScreenRenderer). */}
        Shown on narrow screens (below 720&thinsp;px) instead of the desktop layout.
      </p>
      <section className="tt-prop-section">
        <h4>Background</h4>
        <ColorRow
          label="Mobile background"
          value={mobile.background}
          placeholder="Default felt"
          onChange={(background) => onSetLayout(patchMobileVariant(layout, { background }))}
        />
      </section>
      <section className="tt-prop-section">
        <h4>Page</h4>
        <Check
          label="Scrolling page"
          checked={mobile.scroll === true}
          onChange={(v) => onSetLayout(patchMobileVariant(layout, { scroll: v || undefined }))}
        />
        <PageHeightStepper
          value={mobile.aspect ?? null}
          onChange={(aspect) => onSetLayout(patchMobileVariant(layout, { aspect }))}
        />
        {needsAspect ? (
          <p className="tt-prop-warn">
            ⚠ Scrolling needs a page height — set one above or the page can't be taller
            than the phone screen.
          </p>
        ) : (
          <p className="faint tt-prop-hint">
            {mobile.scroll
              ? 'Players scroll down the page like a document — the Crownfall column.'
              : 'Without scrolling the page is exactly one phone screen (taller pages letterbox).'}
          </p>
        )}
      </section>
      <button type="button" className="btn btn-danger tt-prop-remove" onClick={onDeleteMobile}>
        Delete mobile layout
      </button>
      <p className="faint tt-prop-hint">Phones fall back to the desktop layout.</p>
    </div>
  );
}

/**
 * The mobile page height in PHONE SCREENS (stored as ScreenVariant.aspect =
 * 9:19.5 ÷ screens). "Fit" = one screen exactly (aspect unset).
 */
function PageHeightStepper({ value, onChange }: {
  value: number | null;
  onChange: (aspect: number | undefined) => void;
}) {
  const screens = value == null ? null : Math.round((PHONE_ASPECT / value) * 2) / 2;
  const set = (n: number | null) => {
    if (n === null || n <= 0.5) onChange(undefined);
    else onChange(PHONE_ASPECT / Math.min(8, Math.max(1, n)));
  };
  return (
    <label className="tt-step">
      <span>Page height</span>
      <div className="tt-step-row">
        <button
          type="button"
          className="btn tt-step-btn"
          aria-label="Decrease page height"
          disabled={screens === null}
          onClick={() => set(screens !== null && screens > 1 ? screens - 0.5 : null)}
        >
          −
        </button>
        <span className="input tt-step-input tt-step-read" aria-live="polite">
          {screens === null ? 'Fit screen' : `${screens} screen${screens === 1 ? '' : 's'}`}
        </span>
        <button
          type="button"
          className="btn tt-step-btn"
          aria-label="Increase page height"
          disabled={screens !== null && screens >= 8}
          onClick={() => set(screens === null ? 1.5 : screens + 0.5)}
        >
          ＋
        </button>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Multi-selection
// ---------------------------------------------------------------------------

function MultiProps({ sel, canGroup, onGroup, onAlign, onDistribute, onRemove, onSaveComponentMulti }: PropertiesPanelProps) {
  const align = (op: AlignOp, label: string) => (
    <button type="button" className="btn btn-small" key={op} onClick={() => onAlign(op)}>
      {label}
    </button>
  );
  return (
    <div className="tt-props">
      <div className="tt-prop-head">
        <h3>{sel.length} elements</h3>
      </div>
      <button type="button" className="btn btn-primary" disabled={!canGroup} onClick={onGroup}>
        ▦ Group selection
      </button>
      {!canGroup && (
        <p className="faint tt-prop-hint">Only siblings (same container) can be grouped.</p>
      )}
      <button
        type="button"
        className="btn"
        disabled={!canGroup}
        title="Save the selected elements together as one reusable component"
        onClick={() => onSaveComponentMulti?.()}
      >
        ⬡ Save as component
      </button>
      {!canGroup && (
        <p className="faint tt-prop-hint">Select siblings to save them as one component.</p>
      )}
      <section className="tt-prop-section">
        <h4>Align</h4>
        <div className="tt-align-grid">
          {align('left', '⇤ Left')}
          {align('center', '↔ Center')}
          {align('right', '⇥ Right')}
          {align('top', '⤒ Top')}
          {align('middle', '↕ Middle')}
          {align('bottom', '⤓ Bottom')}
        </div>
      </section>
      <section className="tt-prop-section">
        <h4>Distribute</h4>
        <div className="tt-align-grid tt-align-grid-2">
          <button type="button" className="btn btn-small" disabled={sel.length < 3} onClick={() => onDistribute('h')}>
            ⇹ Horizontally
          </button>
          <button type="button" className="btn btn-small" disabled={sel.length < 3} onClick={() => onDistribute('v')}>
            ⇳ Vertically
          </button>
        </div>
        {sel.length < 3 && <p className="faint tt-prop-hint">Distributing needs 3+ elements.</p>}
      </section>
      <button type="button" className="btn btn-danger tt-prop-remove" onClick={() => onRemove(sel)}>
        Remove {sel.length} elements
      </button>
      <p className="faint tt-prop-hint">Removes from the screen only — zones and actions stay in the game.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single element
// ---------------------------------------------------------------------------

function ElementProps(props: PropertiesPanelProps & { el: ScreenElement }) {
  const { def, el, onPatchEl, onRemove, onUngroup, onChangeDef, onFocus, onSaveComponent, onSelect } = props;
  const patchBase = (p: Partial<Pick<ScreenElement, 'name' | 'rect' | 'style' | 'rotation' | 'visible' | 'reveal' | 'onChangeAnim'>>) =>
    onPatchEl(el.id, (c) => ({ ...c, ...p } as ScreenElement));
  const rect = el.rect;
  const patchRect = (p: Partial<typeof rect>) => patchBase({ rect: { ...rect, ...p } });
  const minW = el.kind === 'group' ? GROUP_MIN : MIN_W;
  const minH = el.kind === 'group' ? GROUP_MIN : MIN_H;
  const childCount = el.children?.length ?? 0;

  return (
    <div className="tt-props">
      <div className="tt-prop-head">
        <h3>{el.name}</h3>
        <span className="chip">{KIND_LABELS[el.kind]}</span>
        <button
          type="button"
          className="btn btn-small"
          title="Focus: fill the canvas with this element and edit the elements on top of it in fine detail"
          onClick={() => onFocus(el.id)}
        >
          ⛶ Focus
        </button>
        <button
          type="button"
          className="btn btn-small"
          title="Save this element (with its styling and children) to your reusable component library"
          onClick={() => onSaveComponent(el)}
        >
          ⬡ Save
        </button>
        {childCount > 0 && el.kind !== 'group' && (
          <span className="chip" title="Elements drawn on top of this one — ⛶ Focus to edit them">
            {childCount} child element{childCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      <label className="field">
        <span>Name</span>
        <input
          type="text"
          className="input"
          value={el.name}
          onChange={(e) => patchBase({ name: e.target.value })}
        />
      </label>

      <section className="tt-prop-section">
        <h4>Position &amp; size <span className="tt-unit">% of parent</span></h4>
        <div className="tt-grid">
          <Stepper label="X" value={rect.x} min={0} max={Math.max(0, 100 - rect.w)} onChange={(x) => patchRect({ x })} />
          <Stepper label="Y" value={rect.y} min={0} max={Math.max(0, 100 - rect.h)} onChange={(y) => patchRect({ y })} />
          <Stepper label="Width" value={rect.w} min={minW} max={Math.max(minW, 100 - rect.x)} onChange={(w) => patchRect({ w })} />
          <Stepper label="Height" value={rect.h} min={minH} max={Math.max(minH, 100 - rect.y)} onChange={(h) => patchRect({ h })} />
        </div>
        <div className="tt-grid">
          <Stepper label="Rotation °" value={el.rotation ?? 0} min={0} max={359} onChange={(rotation) => patchBase({ rotation: rotation === 0 ? undefined : rotation })} />
        </div>
      </section>

      {el.kind === 'zone' && <ZoneSection {...props} el={el} />}
      {el.kind === 'text' && <TextSection def={def} el={el} onPatchEl={onPatchEl} />}
      {el.kind === 'varText' && <VarTextSection {...props} el={el} />}
      {el.kind === 'counter' && <CounterSection {...props} el={el} />}
      {el.kind === 'button' && <ButtonSection {...props} el={el} />}
      {el.kind === 'shape' && <ShapeSection el={el} onPatchEl={onPatchEl} />}
      {el.kind === 'line' && <LineSection el={el} onPatchEl={onPatchEl} />}
      {el.kind === 'log' && <LogSection el={el} onPatchEl={onPatchEl} />}
      <ChildrenSection
        def={def}
        el={el}
        onPatchEl={onPatchEl}
        onSelect={onSelect}
        onFocus={onFocus}
        onUngroup={onUngroup}
      />
      {el.kind === 'group' && <LayoutSection el={el} onPatchEl={onPatchEl} />}
      {el.kind === 'panelSwitcher' && <PanelSwitcherSection el={el} onPatchEl={onPatchEl} />}
      {el.kind === 'image' && <ImageSection el={el} onPatchEl={onPatchEl} />}

      <StyleSection style={el.style} onChange={(style) => patchBase({ style })} />

      <StatesSection {...props} el={el} />

      <section className="tt-prop-section">
        <h4>Visibility &amp; animation</h4>
        <label className="field">
          <span>Visible when</span>
          <ConditionBuilder
            def={def}
            value={el.visible ?? null}
            onChange={(visible) => patchBase({ visible })}
            bindings={['$viewer']}
            allowNull
            nullLabel="Always visible"
          />
        </label>
        <ShowForSelectorField {...props} el={el} />
        <label className="field">
          <span>Reveal animation</span>
          <select
            className="select"
            value={el.reveal ?? 'none'}
            onChange={(e) => patchBase({ reveal: e.target.value === 'none' ? undefined : e.target.value as RevealAnim })}
          >
            <option value="none">None</option>
            <option value="fade">Fade</option>
            <option value="scale">Scale</option>
            <option value="slide-up">Slide up</option>
            <option value="slide-down">Slide down</option>
          </select>
        </label>
        <label className="field">
          <span>When the content changes</span>
          <select
            className="select"
            value={el.onChangeAnim ?? 'none'}
            onChange={(e) => patchBase({
              onChangeAnim: e.target.value === 'none'
                ? undefined
                : e.target.value as 'stamp' | 'flash',
            })}
          >
            <option value="none">Nothing</option>
            <option value="stamp">Stamp (press + flash)</option>
            <option value="flash">Flash</option>
            <option value="breathe">Breathe (loop while a state is active)</option>
          </select>
        </label>
        <p className="faint tt-prop-hint">
          Conditional elements dim to 40% here in the editor; players only see them while the
          expression is true. "Stamp"/"Flash" replay each time the element's text or active
          state changes — the phase-seal stamp. "Breathe" instead pulses slowly for as long as
          one of the element's states matches — the foe-turn idle.
        </p>
      </section>

      <section className="tt-prop-section">
        <h4>Collapsible panel</h4>
        <label className="field">
          <span>Collapses into a side tab</span>
          <select
            className="select"
            value={el.collapsible ? el.collapsible.side : 'off'}
            onChange={(e) => {
              const v = e.target.value;
              onPatchEl(el.id, (c) => ({
                ...c,
                collapsible: v === 'off'
                  ? undefined
                  : { ...(c.collapsible ?? {}), side: v as 'left' | 'right' | 'top' | 'bottom' },
              } as ScreenElement));
            }}
          >
            <option value="off">Not collapsible</option>
            <option value="left">Tab on the left edge</option>
            <option value="right">Tab on the right edge</option>
            <option value="top">Tab on the top edge</option>
            <option value="bottom">Tab on the bottom edge</option>
          </select>
        </label>
        {el.collapsible && (
          <>
            <label className="field">
              <span>Tab label</span>
              <input
                type="text"
                className="input"
                value={el.collapsible.label ?? ''}
                placeholder={el.name}
                onChange={(e) => onPatchEl(el.id, (c) => ({
                  ...c,
                  collapsible: { ...c.collapsible!, label: e.target.value || undefined },
                } as ScreenElement))}
              />
            </label>
            <label className="row tt-check">
              <input
                type="checkbox"
                checked={el.collapsible.startCollapsed === true}
                onChange={(e) => onPatchEl(el.id, (c) => ({
                  ...c,
                  collapsible: { ...c.collapsible!, startCollapsed: e.target.checked || undefined },
                } as ScreenElement))}
              />
              <span>Start collapsed</span>
            </label>
            <p className="faint tt-prop-hint">
              Players see a tab docked to the {el.collapsible.side} edge of the screen; tapping
              it slides the panel open over its neighbors. The open/closed choice is remembered
              on their device.
            </p>
          </>
        )}
      </section>

      {el.kind === 'zone' && (() => {
        const zone = def.zones.find((z) => z.id === el.zoneId);
        return zone ? <DeckSection def={def} zone={zone} onChangeDef={onChangeDef} /> : null;
      })()}

      <button type="button" className="btn btn-danger tt-prop-remove" onClick={() => onRemove([el.id])}>
        Remove from screen
      </button>
      <p className="faint tt-prop-hint">
        {el.kind === 'zone'
          ? 'The game zone itself stays (Systems page) — only this element goes.'
          : el.kind === 'group'
            ? 'Removes the group AND everything inside it. Ungroup first to keep the contents.'
            : childCount > 0
              ? `Removes the element AND the ${childCount} element${childCount === 1 ? '' : 's'} on top of it.`
              : 'Only the screen element goes — the game keeps working.'}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Zone
// ---------------------------------------------------------------------------

function seatOptions(def: GameDef): SeatRef[] {
  const opps = Math.max(1, Math.min(3, (def.meta.maxPlayers || 2) - 1));
  return ['viewer', 'current', ...Array.from({ length: opps }, (_, i) => `opp${i + 1}` as SeatRef)];
}

const SEAT_LABELS: Record<SeatRef, string> = {
  shared: 'Shared',
  viewer: 'You (the viewer)',
  current: 'Current turn',
  opp1: 'Opponent 1',
  opp2: 'Opponent 2',
  opp3: 'Opponent 3',
};

function ZoneSection(props: PropertiesPanelProps & { el: ZoneEl }) {
  const { def, el, onPatchEl, partSel, onPartSel } = props;
  const patch = (p: Partial<ZoneEl>) =>
    onPatchEl(el.id, (c) => (c.kind === 'zone' ? { ...c, ...p } : c));
  const zone = def.zones.find((z) => z.id === el.zoneId);

  return (
    <section className="tt-prop-section">
      <h4>
        Zone
        {zone && <span className="chip">{zone.owner === 'shared' ? 'shared' : 'per player'}</span>}
        {zone && <span className="chip">{zone.layout}</span>}
      </h4>
      {!zone && <p className="faint tt-prop-hint">⚠ The game zone behind this element no longer exists.</p>}
      {zone && zone.owner === 'perPlayer' && (
        <label className="field">
          <span>Whose copy</span>
          <select
            className="select"
            value={el.seat === 'shared' ? 'viewer' : el.seat}
            onChange={(e) => patch({ seat: e.target.value as SeatRef })}
          >
            {seatOptions(def).map((s) => <option key={s} value={s}>{SEAT_LABELS[s]}</option>)}
          </select>
        </label>
      )}
      <div className="tt-grid">
        <Stepper label="Card scale" value={el.cardScale ?? 8} min={3} max={40} onChange={(cardScale) => patch({ cardScale })} />
        <Stepper label="Padding" value={el.padding ?? 0} min={0} max={10} step={0.5} onChange={(padding) => patch({ padding: padding || undefined })} />
        <Stepper label="Card gap" value={el.gap ?? 0} min={0} max={10} step={0.5} onChange={(gap) => patch({ gap: gap || undefined })} />
      </div>
      {zone?.layout === 'grid' && (
        <div className="tt-grid">
          <AutoStepper label="Rows" value={el.rows ?? null} onChange={(rows) => patch({ rows })} />
          <AutoStepper label="Columns" value={el.columns ?? null} onChange={(columns) => patch({ columns })} />
        </div>
      )}
      {zone?.layout === 'fan' && (
        <>
          <div className="tt-grid">
            <Stepper label="Fan angle °" value={el.fanAngle ?? 4} min={0} max={10} onChange={(fanAngle) => patch({ fanAngle })} />
          </div>
          <p className="faint tt-prop-hint">
            Degrees each card rotates from the center (the hand's arc). 0 = flat. On fans,
            the gap is how much of each covered card stays visible.
          </p>
        </>
      )}

      <span className="tt-mini-label">Cards shown as</span>
      <div className="tt-seg tt-seg-small tt-seg-fill" role="group" aria-label="Zone display mode">
        <button
          type="button"
          className={el.display !== 'piles' && el.display !== 'carousel' ? 'tt-active' : ''}
          onClick={() => patch({ display: undefined })}
        >
          Cards
        </button>
        <button
          type="button"
          className={el.display === 'piles' ? 'tt-active' : ''}
          onClick={() => patch({ display: 'piles' })}
        >
          Piles
        </button>
        <button
          type="button"
          className={el.display === 'carousel' ? 'tt-active' : ''}
          onClick={() => patch({ display: 'carousel' })}
        >
          Carousel
        </button>
      </div>
      {el.display === 'piles' || el.display === 'carousel' ? (
        <>
          <label className="field">
            <span>Pile badge</span>
            <PileBadgeSelect def={def} value={el.pileBadgeField ?? null} onChange={(pileBadgeField) => patch({ pileBadgeField })} />
          </label>
          {el.pileBadgeField != null && (
            <label className="field">
              <span>Badge shape</span>
              <select
                className="select"
                value={el.badgeShape ?? 'diamond'}
                onChange={(e) => patch({ badgeShape: e.target.value === 'round' ? 'round' : undefined })}
              >
                <option value="diamond">Diamond lozenge</option>
                <option value="round">Round badge</option>
              </select>
            </label>
          )}
          <label className="field">
            <span>Pile face</span>
            <select
              className="select"
              value={el.pileFace ?? 'card'}
              onChange={(e) => patch({ pileFace: e.target.value === 'tile' ? 'tile' : undefined })}
            >
              <option value="card">Card face</option>
              <option value="tile">Compact tile (name · badge · × count)</option>
            </select>
          </label>
          <p className="faint tt-prop-hint">
            {el.display === 'carousel'
              ? 'A carousel is the pile view in one scroll-snapping row — the touch-first '
                + 'mobile supply pattern. The badge shows a card field in the corner.'
              : 'Piles group identical cards — one pile per card design with its × count. The badge '
                + 'shows a card field in the corner (the cost lozenge).'}
            {' '}The compact tile skips the card art: a small plate with the name, the corner
            badge and the count.
          </p>
        </>
      ) : (
        (zone?.layout === 'fan' || zone?.layout === 'row') && (
          <Check
            label="Collapse duplicates into × N stacks"
            checked={el.collapseDuplicates === true}
            onChange={(v) => patch({ collapseDuplicates: v || undefined })}
          />
        )
      )}

      {(el.display === 'piles' || el.display === 'carousel' || zone?.layout === 'stack') && (
        <label className="field">
          <span>× Count badge</span>
          <select
            className="select"
            value={el.countBadge ?? 'corner'}
            onChange={(e) => patch({
              countBadge: e.target.value === 'corner'
                ? undefined
                : e.target.value as 'bottom' | 'none',
            })}
          >
            <option value="corner">Corner (bottom-right)</option>
            <option value="bottom">Pill under the card</option>
            <option value="none">Hidden</option>
          </select>
        </label>
      )}

      <Check label="Show zone name" checked={el.showName !== false} onChange={(showName) => patch({ showName })} />
      <Check label="Show card count" checked={el.showCount === true} onChange={(showCount) => patch({ showCount: showCount || undefined })} />

      <label className="field">
        <span>Empty-state text</span>
        <input
          type="text"
          className="input"
          placeholder="empty"
          value={el.emptyText ?? ''}
          onChange={(e) => patch({ emptyText: e.target.value || undefined })}
        />
      </label>
      <p className="faint tt-prop-hint">
        Shown while this element has no cards (e.g. "Play zone empty."). Pile boards
        normally render nothing when empty — text here gives them an empty state too.
      </p>

      {/* Niche clusters collapse so the everyday knobs above stay one glance
          away; a canvas part-click force-opens the chrome group. */}
      <CollapseGroup
        id="zone.chrome"
        title="Card chrome & parts"
        forceOpen={partSel != null && partSel.elId === el.id}
      >
        <StyleSection
          title="Card style (this element)"
          hint="Chrome painted over every card face or pile tile THIS element shows — a gold
            hairline, a darker plate, rounder corners — without touching the card template
            or other views of the same zone."
          style={el.cardStyle}
          onChange={(cardStyle) => patch({ cardStyle })}
        />
        <ZonePartsEditor el={el} partSel={partSel} onPartSel={onPartSel} onPatchEl={onPatchEl} />
      </CollapseGroup>

      <CollapseGroup id="zone.power" title="Power features">
        <label className="field">
          <span>Card filter</span>
          <ConditionBuilder
            def={def}
            value={el.cardFilter ?? null}
            onChange={(cardFilter) => patch({ cardFilter: cardFilter ?? undefined })}
            bindings={['$card']}
            allowNull
            nullLabel="All cards"
          />
        </label>
        <p className="faint tt-prop-hint">
          Display-only slice: this element shows just the matching cards, so several elements
          can each show part of one zone (treasure / victory / kingdom regions of a supply).
        </p>

        <label className="field">
          <span>When cards arrive</span>
          <select
            className="select"
            value={el.arriveEffect ?? 'none'}
            onChange={(e) => patch({ arriveEffect: e.target.value === 'none' ? undefined : 'burn' })}
          >
            <option value="none">No effect</option>
            <option value="burn">Burn (char + embers)</option>
          </select>
        </label>

        <label className="field">
          <span>Keyboard group</span>
          <select
            className="select"
            value={el.keyGroup ?? 'off'}
            onChange={(e) => patch({
              keyGroup: e.target.value === 'off'
                ? undefined
                : e.target.value as 'plain' | 'shift' | 'ctrl' | 'alt',
            })}
          >
            <option value="off">No keyboard marking</option>
            <option value="plain">Digits (no modifier)</option>
            <option value="shift">Shift + digits</option>
            <option value="ctrl">Ctrl + digits</option>
            <option value="alt">Alt + digits</option>
          </select>
        </label>
        <p className="faint tt-prop-hint">
          Desktop keyboard play: holding the modifier spotlights this zone (everything else
          dims) and its playable cards show 1–9/0 badges; the digit plays the card. "Digits"
          works without a modifier — the hand.
        </p>
      </CollapseGroup>
    </section>
  );
}

// Collapsed-group memory (session-only): niche clusters stay open once the
// author opens them, across selections and elements.
const collapseGroupMem = new Map<string, boolean>();

/**
 * A collapsed sub-cluster for niche controls (the Zone inspector's advanced
 * groups). Open state is remembered per `id` for the session; `forceOpen`
 * pops it open from outside (a canvas card-part click).
 */
/** Kinds addable as a child of any node (factories from screenModel). */
const CHILD_FACTORIES: { key: string; label: string; make: (def: GameDef) => ScreenElement | null }[] = [
  { key: 'text', label: 'Text', make: () => newTextElement() },
  { key: 'varText', label: 'Variable', make: (def) => newVarTextElement(def) },
  { key: 'button', label: 'Button', make: (def) => newButtonElement(def) },
  { key: 'counter', label: 'Counter', make: (def) => newCounterElement(def) },
  { key: 'shape', label: 'Shape', make: () => newShapeElement() },
  { key: 'line', label: 'Line', make: () => newLineElement() },
  { key: 'image', label: 'Image', make: () => newImageElement() },
  { key: 'group', label: 'Group', make: () => newGroupElement() },
];

/**
 * EVERY node can hold children (the universal node model): list them, jump
 * into them, add new ones in place. Groups keep Ungroup; a fresh child
 * lands centered at half the parent's size and is selected in focus.
 */
function ChildrenSection({ def, el, onPatchEl, onSelect, onFocus, onUngroup }: {
  def: GameDef;
  el: ScreenElement;
  onPatchEl: PropertiesPanelProps['onPatchEl'];
  onSelect?: (ids: Id[]) => void;
  onFocus: (id: Id) => void;
  onUngroup: (id: Id) => void;
}) {
  const kids = el.children ?? [];
  const isGroup = el.kind === 'group';
  const addChild = (key: string) => {
    const f = CHILD_FACTORIES.find((c) => c.key === key);
    if (!f) return;
    const child = f.make(def);
    if (child === null) return; // e.g. a Variable child with no vars defined
    // Child rects are % of the PARENT box — land centered at half size.
    child.rect = { x: 25, y: 25, w: 50, h: 50 };
    onPatchEl(el.id, (c) => ({ ...c, children: [...(c.children ?? []), child] } as ScreenElement));
    onFocus(el.id);
    onSelect?.([child.id]);
  };
  return (
    <section className="tt-prop-section">
      <h4>{isGroup ? 'Group' : 'Children'}</h4>
      <p className="faint tt-prop-hint">
        {kids.length === 0
          ? (isGroup
            ? 'Empty — drag elements inside on the canvas, or add one below.'
            : 'Any element can carry children — badges, glyphs, conditional decals. They move, hide and animate with it.')
          : `${kids.length} element${kids.length === 1 ? '' : 's'} move, hide and animate together.`}
      </p>
      {isGroup && (
        <p className="faint tt-prop-hint">
          Want switchable panels? Insert the "Panel switcher" preset from the palette, or
          add selector buttons and bind panels via "Show only for" below.
        </p>
      )}
      {kids.length > 0 && (
        // Front-to-back like the Layers panel (reverse of the array).
        <div className="tt-layers" role="list" aria-label="Children, front to back">
          {kids.slice().reverse().map((child) => (
            <div
              key={child.id}
              className="tt-layer"
              role="button"
              tabIndex={0}
              onClick={() => onSelect?.([child.id])}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect?.([child.id]);
                }
              }}
            >
              <span className="tt-layer-icon" aria-hidden="true">{KIND_ICONS[child.kind]}</span>
              <span className="tt-layer-name">{child.name}</span>
              <span className="tt-layer-btns">
                <button
                  type="button"
                  className="tt-layer-btn"
                  aria-label={`Focus ${el.name} and select ${child.name}`}
                  title="Focus this element and select the child"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFocus(el.id);
                    onSelect?.([child.id]);
                  }}
                >
                  ⛶
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      <label className="tt-prop-row">
        <span>Add child</span>
        <select
          className="select"
          value=""
          onChange={(e) => {
            if (e.target.value !== '') addChild(e.target.value);
            e.target.value = '';
          }}
        >
          <option value="">＋ pick a kind…</option>
          {CHILD_FACTORIES.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </label>
      {isGroup && kids.length > 0 && (
        <button type="button" className="btn" onClick={() => onUngroup(el.id)}>
          ⊟ Ungroup
        </button>
      )}
    </section>
  );
}

function CollapseGroup({ id, title, forceOpen = false, children }: {
  id: string;
  title: string;
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(() => collapseGroupMem.get(id) === true);
  useEffect(() => {
    if (forceOpen) {
      collapseGroupMem.set(id, true);
      setOpen(true);
    }
  }, [forceOpen, id]);
  return (
    <div className="tt-adv">
      <button
        type="button"
        className="tt-adv-head"
        aria-expanded={open}
        onClick={() => {
          collapseGroupMem.set(id, !open);
          setOpen(!open);
        }}
      >
        <span className="tt-adv-chev" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span>{title}</span>
      </button>
      {open && <div className="tt-adv-body">{children}</div>}
    </div>
  );
}

/**
 * Card parts — per-part chrome overrides (cost badge, × count, tile name,
 * caption, empty note). One expandable row per part; clicking a part on the
 * focused canvas (partSel) force-opens its row. Cleared fields prune away so
 * an all-default part collapses back to undefined (withPartStyle drops it).
 */
function ZonePartsEditor({ el, partSel, onPartSel, onPatchEl }: {
  el: ZoneEl;
  partSel: ZonePartSel | null | undefined;
  onPartSel: PropertiesPanelProps['onPartSel'];
  onPatchEl: PropertiesPanelProps['onPatchEl'];
}) {
  const [openParts, setOpenParts] = useState<ReadonlySet<ZonePartKey>>(new Set());
  const rowRefs = useRef<Partial<Record<ZonePartKey, HTMLDivElement | null>>>({});

  // Canvas part-clicks land here: force the row open and bring it into view.
  useEffect(() => {
    if (!partSel || partSel.elId !== el.id) return;
    setOpenParts((prev) => (prev.has(partSel.part) ? prev : new Set(prev).add(partSel.part)));
    rowRefs.current[partSel.part]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [partSel, el.id]);

  const toggle = (part: ZonePartKey) => {
    const next = new Set(openParts);
    if (next.has(part)) {
      next.delete(part);
      // Collapsing the canvas-selected part's row deselects the part too.
      if (partSel && partSel.elId === el.id && partSel.part === part) onPartSel?.(null);
    } else {
      next.add(part);
    }
    setOpenParts(next);
  };

  /** Merge one field into the part, pruning cleared (undefined) fields. */
  const setPart = (part: ZonePartKey, patch: Partial<ZonePartStyle>) =>
    onPatchEl(el.id, (e) => {
      const next: ZonePartStyle = { ...getPartStyle(e, part), ...patch };
      (Object.keys(next) as (keyof ZonePartStyle)[]).forEach((k) => {
        if (next[k] === undefined) delete next[k];
      });
      return withPartStyle(e, part, next);
    });

  return (
    <section className="tt-prop-section">
      <h4>Card parts</h4>
      <p className="faint tt-prop-hint">
        Fine-tune each chrome piece this element paints around its cards — or click the
        part right on the focused canvas. Empty fields keep the skin default.
      </p>
      {ZONE_PARTS.map((p) => {
        const part = getPartStyle(el, p.key);
        const open = openParts.has(p.key);
        return (
          <div key={p.key} className="tt-state" ref={(n) => { rowRefs.current[p.key] = n; }}>
            <div className="tt-state-head">
              <button
                type="button"
                className="tt-layer-btn tt-layer-chev"
                aria-expanded={open}
                aria-label={open ? `Collapse ${p.label}` : `Expand ${p.label}`}
                onClick={() => toggle(p.key)}
              >
                {open ? '▾' : '▸'}
              </button>
              <span className="tt-layer-name" title={p.hint}>{p.label}</span>
              {part !== undefined && (
                <>
                  <span className="chip" title="Has overrides">●</span>
                  <button
                    type="button"
                    className="btn btn-small"
                    aria-label={`Reset ${p.label} overrides`}
                    title="Clear every override — back to the skin default"
                    onClick={() => onPatchEl(el.id, (e) => withPartStyle(e, p.key, undefined))}
                  >
                    Reset
                  </button>
                </>
              )}
            </div>
            {open && (
              <>
                <Check
                  label="Hidden"
                  checked={part?.hidden === true}
                  onChange={(v) => setPart(p.key, { hidden: v || undefined })}
                />
                <ColorRow
                  label="Text color"
                  value={part?.color}
                  placeholder="Skin default"
                  onChange={(color) => setPart(p.key, { color })}
                />
                <div className="tt-grid">
                  <InheritStepper
                    label="Font size"
                    value={part?.fontSize}
                    min={0.5}
                    max={8}
                    step={0.1}
                    clearLabel="Default"
                    onChange={(fontSize) => setPart(p.key, { fontSize })}
                  />
                </div>
                <Check
                  label="Bold"
                  checked={part?.bold === true}
                  onChange={(v) => setPart(p.key, { bold: v || undefined })}
                />
                <StyleSection
                  title={`${p.label} box`}
                  style={part?.style}
                  onChange={(style) => setPart(p.key, { style })}
                />
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Pile-badge picker over the card templates' fields (cost, points, …). */
function PileBadgeSelect({ def, value, onChange }: {
  def: GameDef;
  value: Id | null;
  onChange: (fieldId: Id | undefined) => void;
}) {
  const fields = templateFieldOptions(def);
  if (fields.length === 0) {
    return <span className="faint">No card fields yet — add some to a card template first.</span>;
  }
  const missing = value !== null && !fields.some((f) => f.id === value);
  return (
    <select
      className="select"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
    >
      <option value="">No badge</option>
      {missing && <option value={value}>⚠ missing field</option>}
      {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
    </select>
  );
}

// ---------------------------------------------------------------------------
// Text / variable readout
// ---------------------------------------------------------------------------

/** Named CSS font stacks (no external loads — system + common faces). */
const FONT_STACKS: { label: string; value: string }[] = [
  { label: 'Default', value: '' },
  { label: 'Sans', value: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Slab', value: '"Roboto Slab", Rockwell, Georgia, serif' },
  { label: 'Mono', value: 'ui-monospace, "Courier New", monospace' },
  { label: 'Display', value: 'Cinzel, "Trajan Pro", Georgia, serif' },
  { label: 'Rounded', value: '"Baloo 2", "Segoe UI Rounded", system-ui, sans-serif' },
];

/** Font family / weight / italic / spacing / line-height / uppercase controls. */
function TextStyleControls({ el, patch }: {
  el: TextStyle;
  patch: (p: Partial<TextStyle>) => void;
}) {
  const stack = FONT_STACKS.find((f) => f.value === (el.fontFamily ?? ''));
  return (
    <>
      <label className="field">
        <span>Font</span>
        <select
          className="select"
          value={stack ? stack.value : '__custom'}
          onChange={(e) => { if (e.target.value !== '__custom') patch({ fontFamily: e.target.value || undefined }); }}
        >
          {FONT_STACKS.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          {!stack && <option value="__custom">Custom…</option>}
        </select>
      </label>
      {!stack && (
        <label className="field">
          <span>Custom font family</span>
          <input
            type="text"
            className="input"
            placeholder='e.g. "Cinzel", serif'
            value={el.fontFamily ?? ''}
            onChange={(e) => patch({ fontFamily: e.target.value || undefined })}
          />
        </label>
      )}
      <div className="tt-grid">
        <label className="field">
          <span>Weight</span>
          <select
            className="select"
            value={el.fontWeight ?? ''}
            onChange={(e) => patch({ fontWeight: e.target.value === '' ? undefined : Number(e.target.value) })}
          >
            <option value="">Default</option>
            {[300, 400, 500, 600, 700, 800, 900].map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
        </label>
        <Stepper
          label="Letter-spacing"
          value={el.letterSpacing ?? 0}
          min={-5} max={24} step={0.5}
          onChange={(v) => patch({ letterSpacing: v === 0 ? undefined : v })}
        />
      </div>
      <div className="tt-grid">
        <Stepper
          label="Line-height"
          value={el.lineHeight ?? 1.2}
          min={0.8} max={3} step={0.05}
          onChange={(v) => patch({ lineHeight: v })}
        />
      </div>
      <div className="tt-check-row">
        <Check label="Italic" checked={!!el.italic} onChange={(v) => patch({ italic: v || undefined })} />
        <Check label="UPPERCASE" checked={!!el.uppercase} onChange={(v) => patch({ uppercase: v || undefined })} />
      </div>
    </>
  );
}

function TypographyFields({ el, patch }: {
  el: TextStyle & { fontSize: number; color?: string; align: 'left' | 'center' | 'right'; bold?: boolean };
  patch: (p: Partial<TextStyle & { fontSize: number; color?: string; align: 'left' | 'center' | 'right'; bold?: boolean }>) => void;
}) {
  return (
    <>
      <div className="tt-grid">
        <Stepper label="Font size" value={el.fontSize} min={0.5} max={8} step={0.1} onChange={(fontSize) => patch({ fontSize })} />
      </div>
      <ColorRow label="Color" value={el.color} placeholder="Default text" onChange={(color) => patch({ color })} />
      <label className="field">
        <span>Align</span>
        <select className="select" value={el.align} onChange={(e) => patch({ align: e.target.value as 'left' | 'center' | 'right' })}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </label>
      <Check label="Bold" checked={el.bold === true} onChange={(bold) => patch({ bold: bold || undefined })} />
      <TextStyleControls el={el} patch={patch} />
    </>
  );
}

function TextSection({ def, el, onPatchEl }: {
  def: GameDef;
  el: TextEl;
  onPatchEl: PropertiesPanelProps['onPatchEl'];
}) {
  const patch = (p: Partial<TextEl>) =>
    onPatchEl(el.id, (c) => (c.kind === 'text' ? { ...c, ...p } : c));
  return (
    <section className="tt-prop-section">
      <h4>Text</h4>
      <Check
        label="Dynamic text"
        checked={!!el.parts}
        onChange={(v) => onPatchEl(el.id, (c) => (c.kind === 'text' ? setTextDynamic(c, v) : c))}
      />
      {el.parts ? (
        <>
          <label className="field">
            <span>Message</span>
            <AnnouncePartsChip
              def={def}
              value={el.parts}
              onChange={(parts) => patch({ parts })}
              bindings={['$viewer']}
            />
          </label>
          <p className="faint tt-prop-hint">
            Text pieces and live values joined into one line — "TURN " + turn number. Player
            and card values show their names; the text updates as the game changes.
          </p>
        </>
      ) : (
        <label className="field">
          <span>Text</span>
          <input type="text" className="input" value={el.text} onChange={(e) => patch({ text: e.target.value })} />
        </label>
      )}
      <TypographyFields el={el} patch={patch} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Game log
// ---------------------------------------------------------------------------

type LogEl = Extract<ScreenElement, { kind: 'log' }>;

function LogSection({ el, onPatchEl }: {
  el: LogEl;
  onPatchEl: PropertiesPanelProps['onPatchEl'];
}) {
  const patch = (p: Partial<LogEl>) =>
    onPatchEl(el.id, (c) => (c.kind === 'log' ? { ...c, ...p } : c));
  return (
    <section className="tt-prop-section">
      <h4>Game log</h4>
      <div className="tt-grid">
        <Stepper label="Font size" value={el.fontSize ?? 1.3} min={0.5} max={4} step={0.1} onChange={(fontSize) => patch({ fontSize })} />
      </div>
      <Check
        label="Turn separators"
        checked={el.turnSeparators !== false}
        onChange={(v) => patch({ turnSeparators: v ? undefined : false })}
      />
      <p className="faint tt-prop-hint">
        The chronicle: every move scrolls in as it happens, newest at the bottom, with a
        "— turn N —" rule between turns.
      </p>
    </section>
  );
}

function VarTextSection(props: PropertiesPanelProps & { el: VarTextEl }) {
  const { def, layout, variant, el, onPatchEl, onChangeDef } = props;
  const [creating, setCreating] = useState(false);
  const patch = (p: Partial<VarTextEl>) =>
    onPatchEl(el.id, (c) => (c.kind === 'varText' ? { ...c, ...p } : c));
  const vars = def.variables.filter((v) => v.scope !== 'perCard');
  const vd = def.variables.find((v) => v.id === el.varId);

  /** ONE def update: append the variable AND bind this element to it. */
  const createVariable = (v: VariableDef) => {
    setCreating(false);
    onChangeDef({
      ...def,
      variables: [...def.variables, v],
      screenLayout: withVariantElements(
        layout, variant,
        updateEl(variantElements(layout, variant), el.id, (c) =>
          c.kind === 'varText' ? { ...c, varId: v.id } : c),
      ),
    });
  };

  return (
    <section className="tt-prop-section">
      <h4>Variable readout</h4>
      <label className="field">
        <span>Variable</span>
        <div className="tt-inline-add">
          <select className="select" value={el.varId} onChange={(e) => patch({ varId: e.target.value })}>
            {!vars.some((v) => v.id === el.varId) && <option value={el.varId}>⚠ missing variable</option>}
            {vars.map((v) => (
              <option key={v.id} value={v.id}>{v.name}{v.scope === 'perPlayer' ? ' (per player)' : ''}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            ＋ New variable
          </button>
        </div>
      </label>
      {creating && (
        <NewVariableModal onClose={() => setCreating(false)} onCreate={createVariable} />
      )}
      {vd?.scope === 'perPlayer' && (
        <label className="field">
          <span>Whose value</span>
          <select
            className="select"
            value={el.seat === 'shared' ? 'viewer' : el.seat}
            onChange={(e) => patch({ seat: e.target.value as SeatRef })}
          >
            {seatOptions(def).map((s) => <option key={s} value={s}>{SEAT_LABELS[s]}</option>)}
          </select>
        </label>
      )}
      <label className="field">
        <span>Label prefix</span>
        <input
          type="text"
          className="input"
          placeholder="e.g. Life: "
          value={el.label ?? ''}
          onChange={(e) => patch({ label: e.target.value || undefined })}
        />
      </label>
      <Check
        label="Ticker bump on change"
        checked={el.ticker !== false}
        onChange={(v) => patch({ ticker: v ? undefined : false })}
      />
      <p className="faint tt-prop-hint">
        The readout pops (scale + accent flash) whenever the value changes.
      </p>
      <TypographyFields el={el} patch={patch} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Counter (interactive variable stepper: −/＋ perform REAL plain actions)
// ---------------------------------------------------------------------------

function CounterSection(props: PropertiesPanelProps & { el: CounterEl }) {
  const { def, layout, variant, el, onPatchEl, onChangeDef } = props;
  const [creating, setCreating] = useState(false);
  const patch = (p: Partial<CounterEl>) =>
    onPatchEl(el.id, (c) => (c.kind === 'counter' ? { ...c, ...p } : c));
  const vars = def.variables.filter((v) => v.scope !== 'perCard');
  const vd = def.variables.find((v) => v.id === el.varId);
  const plainActions = def.actions.filter((a) => a.target.kind === 'none');

  /** ONE def update: append the variable AND bind this counter to it. */
  const createVariable = (v: VariableDef) => {
    setCreating(false);
    onChangeDef({
      ...def,
      variables: [...def.variables, v],
      screenLayout: withVariantElements(
        layout, variant,
        updateEl(variantElements(layout, variant), el.id, (c) =>
          c.kind === 'counter' ? { ...c, varId: v.id } : c),
      ),
    });
  };

  /**
   * ONE def update: append "<Var> +1"/"<Var> −1" actions, bind both steppers,
   * and register the actions in every manual phase (phases whitelist moves).
   */
  const createStepActions = () => {
    const next = bindCounterStepActions(def, layout, variant, el.id);
    if (next !== null) onChangeDef(next);
  };

  const stepPicker = (side: 'incActionId' | 'decActionId', label: string) => (
    <label className="field">
      <span>{label}</span>
      <select
        className="select"
        value={el[side] ?? ''}
        onChange={(e) => patch({ [side]: e.target.value === '' ? null : e.target.value } as Partial<CounterEl>)}
      >
        <option value="">No button</option>
        {el[side] !== null && !plainActions.some((a) => a.id === el[side])
          && <option value={el[side]!}>⚠ missing action</option>}
        {plainActions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </label>
  );

  return (
    <section className="tt-prop-section">
      <h4>Counter</h4>
      <label className="field">
        <span>Variable</span>
        <div className="tt-inline-add">
          <select className="select" value={el.varId} onChange={(e) => patch({ varId: e.target.value })}>
            {!vars.some((v) => v.id === el.varId) && <option value={el.varId}>⚠ missing variable</option>}
            {vars.map((v) => (
              <option key={v.id} value={v.id}>{v.name}{v.scope === 'perPlayer' ? ' (per player)' : ''}</option>
            ))}
          </select>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            ＋ New variable
          </button>
        </div>
      </label>
      {creating && (
        <NewVariableModal onClose={() => setCreating(false)} onCreate={createVariable} />
      )}
      {vd?.scope === 'perPlayer' && (
        <label className="field">
          <span>Whose value</span>
          <select
            className="select"
            value={el.seat === 'shared' ? 'viewer' : el.seat}
            onChange={(e) => patch({ seat: e.target.value as SeatRef })}
          >
            {seatOptions(def).map((s) => <option key={s} value={s}>{SEAT_LABELS[s]}</option>)}
          </select>
        </label>
      )}
      <label className="field">
        <span>Label</span>
        <input
          type="text"
          className="input"
          placeholder={vd?.name ?? ''}
          value={el.label ?? ''}
          onChange={(e) => patch({ label: e.target.value || undefined })}
        />
      </label>
      {stepPicker('incActionId', '＋ performs')}
      {stepPicker('decActionId', '− performs')}
      {vd !== undefined && el.incActionId === null && el.decActionId === null && (
        <button type="button" className="btn" onClick={createStepActions}>
          ⚡ Create ±1 actions &amp; bind
        </button>
      )}
      <p className="faint tt-prop-hint">
        Every tick is a REAL plain action — it runs through the engine (rules can react,
        "variable changed" triggers fire), and the buttons disable while the action isn't
        legal. Edit the scripts in the Actions panel (add costs, caps, side effects).
      </p>
      <label className="field">
        <span>Enabled when <span className="tt-unit">requires…</span></span>
        <ConditionBuilder
          def={def}
          value={el.enabledWhen ?? null}
          onChange={(enabledWhen) => patch({ enabledWhen })}
          bindings={['$viewer']}
          allowNull
          nullLabel="Always (legality only)"
        />
      </label>
      <p className="faint tt-prop-hint">
        While the condition fails the steppers disable and players see a
        "requires …" tag naming it.
      </p>
      <div className="tt-grid">
        <Stepper label="Value size" value={el.fontSize ?? 2.2} min={0.8} max={8} step={0.1} onChange={(fontSize) => patch({ fontSize })} />
      </div>
      <ColorRow label="Color" value={el.color} placeholder="Default text" onChange={(color) => patch({ color })} />
      <TextStyleControls el={el} patch={patch} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// "Show only for [selector button]" (every element kind)
// ---------------------------------------------------------------------------

function ShowForSelectorField(props: PropertiesPanelProps & { el: ScreenElement }) {
  const { layout, variant, el, onPatchEl } = props;
  const options = selectorButtonOptions(variantElements(layout, variant));
  const missing = el.showForSelector !== undefined
    && !options.some((o) => o.id === el.showForSelector);
  if (options.length === 0 && el.showForSelector === undefined) {
    // Nothing to bind to (and nothing bound): keep the panel quiet.
    return null;
  }
  return (
    <>
      <label className="field">
        <span>Show only for</span>
        <select
          className="select"
          value={el.showForSelector ?? ''}
          onChange={(e) => onPatchEl(el.id, (c) => {
            if (e.target.value !== '') return { ...c, showForSelector: e.target.value };
            const { showForSelector: _gone, ...rest } = c;
            return rest as ScreenElement;
          })}
        >
          <option value="">Always (no selector)</option>
          {missing && <option value={el.showForSelector}>⚠ missing selector button</option>}
          {options.map((o) => (
            <option key={o.id} value={o.id}>{o.label} ({o.group})</option>
          ))}
        </select>
      </label>
      <p className="faint tt-prop-hint">
        The element renders only while that selector button is the chosen one of its
        group — on top of "Visible when" (both must hold).
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Button (action binding + inline action creation + node-graph script modal
//  + the Selector role: a radio set switching showForSelector-bound panels)
// ---------------------------------------------------------------------------

function ButtonSection(props: PropertiesPanelProps & { el: ButtonEl }) {
  const { def, layout, variant, el, onPatchEl, onChangeDef } = props;
  const [creating, setCreating] = useState(false);
  const [editingScript, setEditingScript] = useState(false);
  const patch = (p: Partial<ButtonEl>) =>
    onPatchEl(el.id, (c) => (c.kind === 'button' ? { ...c, ...p } : c));
  const plainActions = def.actions.filter((a) => a.target.kind === 'none');
  const missing = el.actionId !== null && el.actionId !== PASS_ACTION_ID
    && !plainActions.some((a) => a.id === el.actionId);
  // Re-derived from def each render, so the script modal always edits live data.
  const bound = el.actionId !== null && el.actionId !== PASS_ACTION_ID
    ? def.actions.find((a) => a.id === el.actionId) ?? null
    : null;
  const isSelector = el.role === 'selector';
  const selGroup = (el.selectorGroup ?? '').trim();

  // Selecting a selector button makes it its group's ACTIVE one — written to
  // the runner's selection store so the canvas preview switches (and stays
  // switched when the selection moves into the revealed panel).
  useEffect(() => {
    if (isSelector && selGroup !== '') writeSelection(def.meta.id, selGroup, el.id);
  }, [isSelector, selGroup, el.id, def.meta.id]);

  /** ONE def update: append the new action AND bind this button to it. */
  const createAction = (a: ActionDef) => {
    setCreating(false);
    onChangeDef({
      ...def,
      actions: [...def.actions, a],
      screenLayout: withVariantElements(
        layout, variant,
        updateEl(variantElements(layout, variant), el.id, (c) =>
          c.kind === 'button' ? { ...c, actionId: a.id, label: c.label || a.name } : c),
      ),
    });
  };

  return (
    <section className="tt-prop-section">
      <h4>Button</h4>
      <Check
        label="Selector (switches panels, not actions)"
        checked={isSelector}
        onChange={(v) => patch(v
          ? { role: 'selector', selectorGroup: el.selectorGroup ?? 'switcher' }
          : { role: undefined, selectorGroup: undefined })}
      />
      {isSelector ? (
        <>
          <label className="field">
            <span>Selector group</span>
            <input
              type="text"
              className="input"
              value={el.selectorGroup ?? ''}
              placeholder="e.g. supply"
              onChange={(e) => patch({ selectorGroup: e.target.value || undefined })}
            />
          </label>
          <p className="faint tt-prop-hint">
            Buttons sharing a group form a radio set: exactly one is chosen (remembered on
            the player's device; the first placed is the default). Clicking never performs
            a game action — bind elements to this button with "Show only for" below.
          </p>
        </>
      ) : (
        <>
          <label className="field">
            <span>Performs</span>
            <div className="tt-inline-add">
              <select
                className="select"
                value={el.actionId ?? ''}
                onChange={(e) => patch({ actionId: e.target.value === '' ? null : e.target.value })}
              >
                <option value="">Unbound (decorative)</option>
                <option value={PASS_ACTION_ID}>Pass (built-in)</option>
                {missing && <option value={el.actionId!}>⚠ missing action</option>}
                {plainActions.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button type="button" className="btn" onClick={() => setCreating(true)}>
                ＋ New action
              </button>
            </div>
          </label>
          {bound && (
            <button type="button" className="btn" onClick={() => setEditingScript(true)}>
              ⚙ Edit script… <span className="tt-script-hint">({bound.script.length} block{bound.script.length === 1 ? '' : 's'})</span>
            </button>
          )}
          <label className="field">
            <span>Enabled when <span className="tt-unit">requires…</span></span>
            <ConditionBuilder
              def={def}
              value={el.enabledWhen ?? null}
              onChange={(enabledWhen) => patch({ enabledWhen })}
              bindings={['$viewer']}
              allowNull
              nullLabel="Always (legality only)"
            />
          </label>
          <p className="faint tt-prop-hint">
            On top of move legality: while this condition fails the button disables and
            players see a "requires …" tag naming it.
          </p>
        </>
      )}
      <label className="field">
        <span>Label</span>
        <input type="text" className="input" value={el.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>
      <div className="tt-grid">
        <Stepper label="Font size" value={el.fontSize ?? 1.8} min={0.5} max={8} step={0.1} onChange={(fontSize) => patch({ fontSize })} />
      </div>
      <ShapePicker
        value={el.shape ?? 'rect'}
        onChange={(shape) => patch({ shape: shape === 'rect' ? undefined : shape })}
      />
      <p className="faint tt-prop-hint">
        The shape clips the button's Fill (set it in Style below) and label — build pills,
        circles, diamonds, hexagons and stars.
      </p>
      <TextStyleControls el={el} patch={patch} />
      {!isSelector && (
        <p className="faint tt-prop-hint">
          Buttons disable themselves while the move isn't legal. The automatic action bar
          skips moves that have a button.
        </p>
      )}
      {creating && (
        <NewActionModal onClose={() => setCreating(false)} onCreate={createAction} />
      )}
      {editingScript && bound && (
        <ActionScriptModal
          def={def}
          action={bound}
          onClose={() => setEditingScript(false)}
          onChangeDef={onChangeDef}
        />
      )}
    </section>
  );
}

/** The bound action's effect script, edited in the node-graph editor. */
function ActionScriptModal({ def, action, onClose, onChangeDef }: {
  def: GameDef;
  action: ActionDef;
  onClose: () => void;
  onChangeDef: (def: GameDef) => void;
}) {
  return (
    <Modal
      title={<>Script — {action.name} <span className="chip">action</span></>}
      onClose={onClose}
      footer={(
        <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
      )}
    >
      <div className="tt-script-modal">
        <BlockScriptEditor
          def={def}
          value={action.script}
          onChange={(script) => onChangeDef({
            ...def,
            actions: def.actions.map((a) => (a.id === action.id ? { ...a, script } : a)),
          })}
          bindings={[]}
        />
        <p className="faint tt-prop-hint">
          This is the same script you'd see in the Actions tab — changes apply as you edit.
        </p>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Shape / line
// ---------------------------------------------------------------------------

const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: 'Rectangle', rounded: 'Rounded', pill: 'Pill', circle: 'Circle',
  diamond: 'Diamond', hexagon: 'Hexagon', star: 'Star', path: 'Custom path',
};

/** A visual grid of shape swatches (each shows its true silhouette). */
function ShapePicker({ value, onChange }: {
  value: ShapeKind;
  onChange: (s: ShapeKind) => void;
}) {
  return (
    <div className="field">
      <span>Shape</span>
      <div className="tt-shape-grid" role="radiogroup" aria-label="Shape">
        {SHAPE_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={value === k}
            aria-label={SHAPE_LABELS[k]}
            title={SHAPE_LABELS[k]}
            className={`tt-shape-swatch${value === k ? ' on' : ''}`}
            onClick={() => onChange(k)}
          >
            <span style={{ clipPath: shapeClipPath(k) ?? undefined, borderRadius: shapeBorderRadius(k, { borderRadius: 4 }) }} />
          </button>
        ))}
      </div>
    </div>
  );
}

function ShapeSection({ el, onPatchEl }: {
  el: ShapeEl;
  onPatchEl: PropertiesPanelProps['onPatchEl'];
}) {
  const patch = (p: Partial<ShapeEl>) =>
    onPatchEl(el.id, (c) => (c.kind === 'shape' ? { ...c, ...p } : c));
  return (
    <section className="tt-prop-section">
      <h4>Shape</h4>
      <ShapePicker value={el.shape} onChange={(shape) => patch({ shape })} />
      <label className="field">
        <span>Label</span>
        <input
          type="text"
          className="input"
          placeholder="Optional centered text"
          value={el.label ?? ''}
          onChange={(e) => patch({ label: e.target.value || undefined })}
        />
      </label>
      <div className="tt-grid">
        <Stepper label="Font size" value={el.fontSize ?? 1.2} min={0.5} max={8} step={0.1} onChange={(fontSize) => patch({ fontSize })} />
      </div>
      <p className="faint tt-prop-hint">
        Fill, border and radius live in Style below — add states to change them with the game.
      </p>
    </section>
  );
}

const ORIENTS: [LineEl['orient'], string, string][] = [
  ['h', '─', 'Horizontal'], ['v', '│', 'Vertical'],
  ['down', '╲', 'Diagonal down'], ['up', '╱', 'Diagonal up'],
];

function LineSection({ el, onPatchEl }: {
  el: LineEl;
  onPatchEl: PropertiesPanelProps['onPatchEl'];
}) {
  const patch = (p: Partial<LineEl>) =>
    onPatchEl(el.id, (c) => (c.kind === 'line' ? { ...c, ...p } : c));
  return (
    <section className="tt-prop-section">
      <h4>Line</h4>
      <span className="tt-mini-label">Direction</span>
      <div className="tt-seg tt-seg-small tt-seg-fill" role="group" aria-label="Line direction">
        {ORIENTS.map(([o, glyph, label]) => (
          <button
            key={o}
            type="button"
            className={el.orient === o ? 'tt-active' : ''}
            title={label}
            aria-label={label}
            onClick={() => patch({ orient: o })}
          >
            {glyph}
          </button>
        ))}
      </div>
      <div className="tt-grid">
        <Stepper label="Thickness" value={el.thickness} min={1} max={8} onChange={(thickness) => patch({ thickness })} />
      </div>
      <Check label="Dashed" checked={el.dashed === true} onChange={(dashed) => patch({ dashed: dashed || undefined })} />
      <label className="field">
        <span>Arrow heads</span>
        <select
          className="select"
          value={el.arrow ?? 'none'}
          onChange={(e) => patch({ arrow: e.target.value === 'none' ? undefined : e.target.value as 'end' | 'both' })}
        >
          <option value="none">None</option>
          <option value="end">At the end</option>
          <option value="both">Both ends</option>
        </select>
      </label>
      <p className="faint tt-prop-hint">The line's color is the border color in Style.</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Layout (flow containers: Grid / Row / Column groups)
// ---------------------------------------------------------------------------

const FLOW_MODES: [FlowLayout['mode'] | 'none', string][] = [
  ['none', 'None'], ['row', 'Row'], ['column', 'Column'], ['grid', 'Grid'],
];

function LayoutSection({ el, onPatchEl }: {
  el: GroupEl;
  onPatchEl: PropertiesPanelProps['onPatchEl'];
}) {
  const layout = el.layout;
  const setMode = (mode: FlowLayout['mode'] | 'none') => onPatchEl(el.id, (c) => {
    if (c.kind !== 'group') return c;
    if (mode === 'none') {
      const { layout: _gone, ...rest } = c;
      return rest as ScreenElement;
    }
    const base: FlowLayout = c.layout ?? { mode };
    return { ...c, layout: { ...base, mode } };
  });
  const patch = (p: Partial<FlowLayout>) => onPatchEl(el.id, (c) =>
    (c.kind === 'group' && c.layout ? { ...c, layout: { ...c.layout, ...p } } : c));
  return (
    <section className="tt-prop-section">
      <h4>Layout</h4>
      <span className="tt-mini-label">Arrange children</span>
      <div className="tt-seg tt-seg-small tt-seg-fill" role="group" aria-label="Layout mode">
        {FLOW_MODES.map(([m, lbl]) => (
          <button
            key={m}
            type="button"
            className={(layout?.mode ?? 'none') === m ? 'tt-active' : ''}
            onClick={() => setMode(m)}
          >
            {lbl}
          </button>
        ))}
      </div>
      {layout ? (
        <>
          <div className="tt-grid">
            <Stepper label="Gap %" value={layout.gap ?? 0} min={0} max={20} step={0.5} onChange={(gap) => patch({ gap })} />
            <Stepper label="Padding %" value={layout.padding ?? 0} min={0} max={20} step={0.5} onChange={(padding) => patch({ padding })} />
          </div>
          {layout.mode === 'grid' ? (
            <div className="tt-grid">
              <Stepper label="Columns" value={layout.columns ?? 0} min={0} max={12} onChange={(v) => patch({ columns: v === 0 ? null : v })} />
              <Stepper label="Rows" value={layout.rows ?? 0} min={0} max={12} onChange={(v) => patch({ rows: v === 0 ? null : v })} />
            </div>
          ) : (
            <Check label="Wrap onto new lines" checked={layout.wrap === true} onChange={(wrap) => patch({ wrap: wrap || undefined })} />
          )}
          <label className="field">
            <span>Justify (main axis)</span>
            <select className="select" value={layout.justify ?? 'start'} onChange={(e) => patch({ justify: e.target.value as FlowLayout['justify'] })}>
              <option value="start">Start</option>
              <option value="center">Center</option>
              <option value="end">End</option>
              <option value="between">Space between</option>
              <option value="around">Space around</option>
            </select>
          </label>
          <label className="field">
            <span>Align (cross axis)</span>
            <select className="select" value={layout.align ?? 'start'} onChange={(e) => patch({ align: e.target.value as FlowLayout['align'] })}>
              <option value="start">Start</option>
              <option value="center">Center</option>
              <option value="end">End</option>
              <option value="stretch">Stretch</option>
            </select>
          </label>
          <label className="field">
            <span>Item sizing</span>
            <select className="select" value={layout.itemSize ?? 'auto'} onChange={(e) => patch({ itemSize: e.target.value as FlowLayout['itemSize'] })}>
              <option value="auto">Keep each item's size</option>
              <option value="uniform">Equal sizes</option>
              <option value="stretch">Stretch to fill</option>
            </select>
          </label>
          <p className="faint tt-prop-hint">
            Children flow automatically — reorder them in the Layers panel (▲▼ or drag).
            Choose "None" for free placement.
          </p>
        </>
      ) : (
        <p className="faint tt-prop-hint">Pick a mode to auto-arrange this group's children.</p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Panel switcher (manage tabs = selector buttons + bound content panels)
// ---------------------------------------------------------------------------

function PanelSwitcherSection({ el, onPatchEl }: {
  el: PanelSwitcherEl;
  onPatchEl: PropertiesPanelProps['onPatchEl'];
}) {
  const tabs = el.children.filter((c): c is ButtonEl => c.slotId === 'tabs' && c.kind === 'button');
  const addTab = () => onPatchEl(el.id, (c) => {
    if (c.kind !== 'panelSwitcher') return c;
    const n = c.children.filter((k) => k.slotId === 'tabs').length;
    const label = `Panel ${n + 1}`;
    const btnId = uid('el');
    const btn: ScreenElement = {
      kind: 'button', id: btnId, name: label, rect: { x: 0, y: 0, w: 100 / (n + 1), h: 100 },
      actionId: null, label, fontSize: 1.6, role: 'selector', selectorGroup: c.selectorGroup, slotId: 'tabs',
    };
    const panel: ScreenElement = {
      kind: 'group', id: uid('el'), name: label, rect: { x: 0, y: 12, w: 100, h: 88 },
      showForSelector: btnId, slotId: 'content', children: [],
    };
    return { ...c, children: [...c.children, btn, panel] };
  });
  const renameTab = (btnId: Id, label: string) => onPatchEl(el.id, (c) => {
    if (c.kind !== 'panelSwitcher') return c;
    return {
      ...c,
      children: c.children.map((k) => {
        if (k.id === btnId && k.kind === 'button') return { ...k, label, name: label };
        if (k.slotId === 'content' && k.showForSelector === btnId) return { ...k, name: label };
        return k;
      }),
    };
  });
  const removeTab = (btnId: Id) => onPatchEl(el.id, (c) => {
    if (c.kind !== 'panelSwitcher') return c;
    return {
      ...c,
      children: c.children.filter((k) =>
        !(k.id === btnId || (k.slotId === 'content' && k.showForSelector === btnId))),
    };
  });
  return (
    <section className="tt-prop-section">
      <h4>Panel switcher</h4>
      <p className="faint tt-prop-hint">
        Each tab is a selector button bound to one panel; players see one panel at a time. Fill a
        panel by focusing it (⛶) and dropping elements inside.
      </p>
      {tabs.map((t) => (
        <div key={t.id} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
          <input
            type="text"
            className="input"
            value={t.label}
            onChange={(e) => renameTab(t.id, e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            type="button"
            className="btn tt-comp-del"
            aria-label={`Remove ${t.label}`}
            disabled={tabs.length <= 1}
            onClick={() => removeTab(t.id)}
          >
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="btn" onClick={addTab}>+ Tab</button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Image (source + fit)
// ---------------------------------------------------------------------------

function ImageSection({ el, onPatchEl }: {
  el: ImageEl;
  onPatchEl: PropertiesPanelProps['onPatchEl'];
}) {
  const patch = (p: Partial<ImageEl>) =>
    onPatchEl(el.id, (c) => (c.kind === 'image' ? { ...c, ...p } : c));
  return (
    <section className="tt-prop-section">
      <h4>Image</h4>
      <label className="field">
        <span>Upload</span>
        <input
          type="file"
          accept="image/*"
          className="input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => patch({ src: String(reader.result) });
            reader.readAsDataURL(file);
          }}
        />
      </label>
      <label className="field">
        <span>Or image URL</span>
        <input
          type="text"
          className="input"
          placeholder="https://… or data:…"
          value={el.src}
          onChange={(e) => patch({ src: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Fit</span>
        <select className="select" value={el.fit ?? 'contain'} onChange={(e) => patch({ fit: e.target.value as ImageEl['fit'] })}>
          <option value="contain">Contain (fit inside)</option>
          <option value="cover">Cover (fill &amp; crop)</option>
          <option value="fill">Stretch</option>
          <option value="none">Original size</option>
        </select>
      </label>
      <label className="field">
        <span>Alt text</span>
        <input
          type="text"
          className="input"
          value={el.alt ?? ''}
          onChange={(e) => patch({ alt: e.target.value || undefined })}
        />
      </label>
      {el.src
        ? <img src={el.src} alt="" style={{ maxWidth: '100%', maxHeight: 120, borderRadius: 4, display: 'block', marginTop: 6 }} />
        : <p className="faint tt-prop-hint">No image yet — upload a file or paste a URL.</p>}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Style (all elements)
// ---------------------------------------------------------------------------

function StyleSection({ style, onChange, title, hint }: {
  style: LayoutStyle | undefined;
  onChange: (style: LayoutStyle | undefined) => void;
  /** Section heading override (the zone Card-style reuse). Default "Style". */
  title?: string;
  /** Explanatory hint shown under the heading. */
  hint?: string;
}) {
  const s = style ?? {};
  const set = (patch: Partial<LayoutStyle>) => {
    const next: LayoutStyle = { ...s, ...patch };
    (Object.keys(next) as (keyof LayoutStyle)[]).forEach((k) => {
      if (next[k] === undefined || next[k] === '') delete next[k];
    });
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  return (
    <section className="tt-prop-section">
      <h4>{title ?? 'Style'}</h4>
      {hint !== undefined && <p className="faint tt-prop-hint">{hint}</p>}
      <FillEditor value={s.background} onChange={(background) => set({ background })} />
      <ColorRow label="Border color" value={s.borderColor} placeholder="Default" onChange={(borderColor) => set({ borderColor })} />
      <div className="tt-grid">
        <Stepper
          label="Border px"
          value={s.borderWidth ?? (s.borderColor || s.borderStyle ? 1 : 0)}
          min={0}
          max={16}
          onChange={(borderWidth) => set({ borderWidth })}
        />
        <label className="field">
          <span>Border style</span>
          <select
            className="select"
            value={s.borderStyle ?? 'solid'}
            onChange={(e) => set({ borderStyle: e.target.value as LayoutStyle['borderStyle'] })}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
          </select>
        </label>
      </div>
      <RadiusControl
        radius={s.borderRadius}
        radii={s.borderRadii}
        onChange={(borderRadius, borderRadii) => set({ borderRadius, borderRadii })}
      />
      <OpacityRow value={s.opacity} onChange={(opacity) => set({ opacity })} />
      <ShadowEditor shadows={s.shadows} onChange={(shadows) => set({ shadows })} />
    </section>
  );
}

/** Fill = a solid colour OR a gradient (linear/radial), written to `background`. */
function FillEditor({ value, onChange }: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  const grad = parseGradient(value);
  const isGradient = grad !== null;
  return (
    <div className="tt-fill">
      <div className="tt-seg" role="tablist" aria-label="Fill type">
        <button type="button" className={`tt-seg-btn${!isGradient ? ' on' : ''}`}
          onClick={() => { if (isGradient) onChange(grad!.stops.map((s) => s.color).find(Boolean) || '#c8102e'); }}>Solid</button>
        <button type="button" className={`tt-seg-btn${isGradient ? ' on' : ''}`}
          onClick={() => { if (!isGradient) onChange(gradientToCss(defaultGradient(value))); }}>Gradient</button>
      </div>
      {isGradient
        ? <GradientFields grad={grad!} onChange={(g) => onChange(gradientToCss(g))} />
        : <ColorRow label="Fill" value={value} placeholder="Transparent" onChange={onChange} />}
    </div>
  );
}

function GradientFields({ grad, onChange }: { grad: Gradient; onChange: (g: Gradient) => void }) {
  const setStop = (i: number, patch: Partial<Gradient['stops'][number]>) =>
    onChange({ ...grad, stops: grad.stops.map((st, j) => (j === i ? { ...st, ...patch } : st)) });
  return (
    <div className="tt-grad">
      <div className="tt-grad-preview" style={{ background: gradientToCss(grad) }} />
      <div className="tt-seg">
        <button type="button" className={`tt-seg-btn${grad.kind === 'linear' ? ' on' : ''}`}
          onClick={() => onChange({ ...grad, kind: 'linear' })}>Linear</button>
        <button type="button" className={`tt-seg-btn${grad.kind === 'radial' ? ' on' : ''}`}
          onClick={() => onChange({ ...grad, kind: 'radial' })}>Radial</button>
      </div>
      {grad.kind === 'linear' && (
        <label className="field">
          <span>Angle {Math.round(grad.angle)}°</span>
          <input type="range" min={0} max={360} value={Math.round(grad.angle)}
            onChange={(e) => onChange({ ...grad, angle: Number(e.target.value) })} />
        </label>
      )}
      {grad.stops.map((st, i) => (
        <div className="tt-grad-stop" key={i}>
          <ColorRow label={`Stop ${i + 1}`} value={st.color} placeholder="#fff"
            onChange={(c) => setStop(i, { color: c || '#ffffff' })} />
          <div className="tt-grad-stop-row">
            <Stepper label="Position %" value={Math.round(st.pos)} min={0} max={100}
              onChange={(pos) => setStop(i, { pos })} />
            {grad.stops.length > 2 && (
              <button type="button" className="btn tt-grad-del" aria-label={`Remove stop ${i + 1}`}
                onClick={() => onChange({ ...grad, stops: grad.stops.filter((_, j) => j !== i) })}>✕</button>
            )}
          </div>
        </div>
      ))}
      <button type="button" className="btn"
        onClick={() => onChange({ ...grad, stops: [...grad.stops, { color: '#ffffff', pos: 100 }] })}>+ Stop</button>
    </div>
  );
}

/** Uniform corner radius, expandable to independent per-corner control. */
function RadiusControl({ radius, radii, onChange }: {
  radius: number | undefined;
  radii: [number, number, number, number] | undefined;
  onChange: (radius: number | undefined, radii: [number, number, number, number] | undefined) => void;
}) {
  if (radii === undefined) {
    const uniform = radius ?? 0;
    return (
      <div className="tt-grid">
        <Stepper label="Radius px" value={uniform} min={0} max={80} onChange={(r) => onChange(r, undefined)} />
        <button type="button" className="btn tt-radius-split"
          onClick={() => onChange(undefined, [uniform, uniform, uniform, uniform])}>⌜⌝ Per-corner</button>
      </div>
    );
  }
  const labels = ['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'];
  return (
    <div className="tt-radius-corners">
      <div className="tt-grid">
        {radii.map((r, i) => (
          <Stepper key={i} label={labels[i]} value={r} min={0} max={80}
            onChange={(v) => { const next = [...radii] as [number, number, number, number]; next[i] = v; onChange(undefined, next); }} />
        ))}
      </div>
      <button type="button" className="btn" onClick={() => onChange(Math.max(...radii), undefined)}>Link corners</button>
    </div>
  );
}

/** Element opacity 0-100% (100% clears the property). */
function OpacityRow({ value, onChange }: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const pct = Math.round((value ?? 1) * 100);
  return (
    <label className="field">
      <span>Opacity {pct}%</span>
      <input type="range" min={0} max={100} value={pct}
        onChange={(e) => { const v = Number(e.target.value) / 100; onChange(v >= 1 ? undefined : v); }} />
    </label>
  );
}

/** Add / edit / remove box shadows (drop shadows, or inner glows when inset). */
function ShadowEditor({ shadows, onChange }: {
  shadows: ShadowSpec[] | undefined;
  onChange: (s: ShadowSpec[] | undefined) => void;
}) {
  const list = shadows ?? [];
  const setSh = (i: number, patch: Partial<ShadowSpec>) =>
    onChange(list.map((sh, j) => (j === i ? { ...sh, ...patch } : sh)));
  const remove = (i: number) => { const next = list.filter((_, j) => j !== i); onChange(next.length ? next : undefined); };
  return (
    <div className="tt-shadows">
      <div className="tt-prop-subhead">
        <span>Shadows</span>
        <button type="button" className="btn"
          onClick={() => onChange([...list, { x: 0, y: 4, blur: 12, spread: 0, color: 'rgba(0,0,0,0.45)', inset: false }])}>+ Add</button>
      </div>
      {list.map((sh, i) => (
        <div className="tt-shadow" key={i}>
          <div className="tt-grid">
            <Stepper label="X" value={sh.x} min={-80} max={80} onChange={(x) => setSh(i, { x })} />
            <Stepper label="Y" value={sh.y} min={-80} max={80} onChange={(y) => setSh(i, { y })} />
            <Stepper label="Blur" value={sh.blur} min={0} max={160} onChange={(blur) => setSh(i, { blur })} />
            <Stepper label="Spread" value={sh.spread ?? 0} min={-80} max={80} onChange={(spread) => setSh(i, { spread })} />
          </div>
          <ColorRow label="Colour" value={sh.color} placeholder="rgba(0,0,0,0.45)"
            onChange={(c) => setSh(i, { color: c || 'rgba(0,0,0,0.45)' })} />
          <div className="tt-shadow-foot">
            <label className="tt-check tt-shadow-inset">
              <input type="checkbox" checked={!!sh.inset} onChange={(e) => setSh(i, { inset: e.target.checked })} />
              <span>Inset</span>
            </label>
            <button type="button" className="btn tt-shadow-del" onClick={() => remove(i)}>Remove</button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Rich colour picker swatch + free-text (so gradients / css vars work too). */
function ColorRow({ label, value, placeholder, onChange }: {
  label: string;
  value: string | undefined;
  placeholder: string;
  onChange: (v: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="tt-color-row">
        <button
          type="button"
          className="tt-color tt-cp-checker"
          aria-label={`${label} picker`}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span style={{ background: value || 'transparent' }} />
        </button>
        <input
          type="text"
          className="input"
          aria-label={label}
          placeholder={placeholder}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
        {open && (
          <ColorPicker
            value={value}
            onChange={(css) => onChange(css || undefined)}
            onClose={() => setOpen(false)}
          />
        )}
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// States (conditional appearances — every element kind; FIRST match wins)
// ---------------------------------------------------------------------------

function StatesSection(props: PropertiesPanelProps & { el: ScreenElement }) {
  const { def, el, onPatchEl, statePreviewId, onStatePreview } = props;
  const states = el.states ?? [];
  return (
    <section className="tt-prop-section">
      <h4>States <span className="chip">⚡ reactive</span></h4>
      <p className="faint tt-prop-hint">
        Conditional appearances the table reacts with — the FIRST state whose condition
        holds applies, so order matters. The runner animates changes.
      </p>
      {states.length > 0 && (
        <>
          <span className="tt-mini-label">Show on canvas</span>
          <div className="tt-seg tt-seg-small tt-state-preview" role="group" aria-label="Show state on canvas">
            <button
              type="button"
              className={statePreviewId === null ? 'tt-active' : ''}
              onClick={() => onStatePreview(null)}
            >
              Base
            </button>
            {states.map((s) => (
              <button
                key={s.id}
                type="button"
                className={statePreviewId === s.id ? 'tt-active' : ''}
                onClick={() => onStatePreview(s.id)}
              >
                {s.name || 'State'}
              </button>
            ))}
          </div>
        </>
      )}
      {states.map((s, i) => (
        <StateEditor
          key={s.id}
          def={def}
          el={el}
          state={s}
          index={i}
          count={states.length}
          onPatch={(fn) => onPatchEl(el.id, (c) => updateElementState(c, s.id, fn))}
          onMove={(dir) => onPatchEl(el.id, (c) => moveElementState(c, s.id, dir))}
          onRemove={() => {
            if (statePreviewId === s.id) onStatePreview(null);
            onPatchEl(el.id, (c) => removeElementState(c, s.id));
          }}
        />
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => onPatchEl(el.id, (c) => addElementState(c, newElementState()))}
      >
        ＋ Add state
      </button>
    </section>
  );
}

function StateEditor({ def, el, state, index, count, onPatch, onMove, onRemove }: {
  def: GameDef;
  el: ScreenElement;
  state: ElementState;
  index: number;
  count: number;
  onPatch: (fn: (s: ElementState) => ElementState) => void;
  onMove: (dir: 'up' | 'down') => void;
  onRemove: () => void;
}) {
  const r = state.rect ?? null;
  return (
    <div className="tt-state">
      <div className="tt-state-head">
        <span className="tt-state-idx" aria-hidden="true">{index + 1}</span>
        <input
          type="text"
          className="input tt-state-name"
          aria-label="State name"
          value={state.name}
          onChange={(e) => onPatch((s) => ({ ...s, name: e.target.value }))}
        />
        <button
          type="button"
          className="tt-layer-btn"
          aria-label={`Move ${state.name} up (higher priority)`}
          disabled={index === 0}
          onClick={() => onMove('up')}
        >
          ▲
        </button>
        <button
          type="button"
          className="tt-layer-btn"
          aria-label={`Move ${state.name} down (lower priority)`}
          disabled={index === count - 1}
          onClick={() => onMove('down')}
        >
          ▼
        </button>
        <button
          type="button"
          className="tt-layer-btn"
          aria-label={`Remove state ${state.name}`}
          onClick={onRemove}
        >
          ✕
        </button>
      </div>
      <label className="field">
        <span>When</span>
        <ExpressionEditor
          def={def}
          value={state.when}
          onChange={(when) => { if (when) onPatch((s) => ({ ...s, when })); }}
          bindings={['$viewer']}
        />
      </label>
      <StateStyleFields
        style={state.style}
        onChange={(style) => onPatch((s) => {
          const next = { ...s };
          if (style) next.style = style;
          else delete next.style;
          return next;
        })}
      />
      <span className="tt-mini-label">Position &amp; size override</span>
      <p className="faint tt-prop-hint">
        {r
          ? `Moves to x ${r.x}, y ${r.y} · ${r.w}×${r.h}% while active.`
          : 'None — the element stays put while this state holds.'}
      </p>
      <div className="tt-state-rect-btns">
        <button
          type="button"
          className="btn btn-small"
          onClick={() => onPatch((s) => ({ ...s, rect: { ...el.rect } }))}
        >
          ⌖ Use current position/size
        </button>
        {r && (
          <button
            type="button"
            className="btn btn-small"
            onClick={() => onPatch((s) => {
              const next = { ...s };
              delete next.rect;
              return next;
            })}
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

/** Style OVERRIDES: same controls as the base Style section, every field optional (= inherit). */
function StateStyleFields({ style, onChange }: {
  style: LayoutStyle | undefined;
  onChange: (style: LayoutStyle | undefined) => void;
}) {
  const s = style ?? {};
  const set = (patch: Partial<LayoutStyle>) => {
    const next: LayoutStyle = { ...s, ...patch };
    (Object.keys(next) as (keyof LayoutStyle)[]).forEach((k) => {
      if (next[k] === undefined || next[k] === '') delete next[k];
    });
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  return (
    <>
      <span className="tt-mini-label">Style overrides (empty = inherit the base style)</span>
      <ColorRow label="Background" value={s.background} placeholder="Inherit" onChange={(background) => set({ background })} />
      <ColorRow label="Border color" value={s.borderColor} placeholder="Inherit" onChange={(borderColor) => set({ borderColor })} />
      <div className="tt-grid">
        <InheritStepper label="Border px" value={s.borderWidth} min={0} max={8} onChange={(borderWidth) => set({ borderWidth })} />
        <InheritStepper label="Radius px" value={s.borderRadius} min={0} max={48} onChange={(borderRadius) => set({ borderRadius })} />
      </div>
      <label className="field">
        <span>Border style</span>
        <select
          className="select"
          value={s.borderStyle ?? ''}
          onChange={(e) => set({ borderStyle: e.target.value === '' ? undefined : e.target.value as LayoutStyle['borderStyle'] })}
        >
          <option value="">Inherit</option>
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </select>
      </label>
    </>
  );
}

// ---------------------------------------------------------------------------
// Inline creation modals (variables / actions without leaving the builder)
// ---------------------------------------------------------------------------

function NewVariableModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (v: VariableDef) => void;
}) {
  const [name, setName] = useState('New variable');
  const [scope, setScope] = useState<'global' | 'perPlayer'>('global');
  const [type, setType] = useState<'number' | 'string'>('number');
  const [initial, setInitial] = useState('0');
  const create = () =>
    onCreate(makeVariableDef(name, scope, type, type === 'number' ? Number(initial) || 0 : initial));
  return (
    <Modal
      title="New variable"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={create}>Create &amp; use</button>
        </>
      )}
    >
      <label className="field">
        <span>Name</span>
        <input type="text" className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>Scope</span>
        <select className="select" value={scope} onChange={(e) => setScope(e.target.value as 'global' | 'perPlayer')}>
          <option value="global">Global (one for the table)</option>
          <option value="perPlayer">Per player (one each)</option>
        </select>
      </label>
      <label className="field">
        <span>Type</span>
        <select
          className="select"
          value={type}
          onChange={(e) => {
            const t = e.target.value as 'number' | 'string';
            setType(t);
            setInitial(t === 'number' ? '0' : '');
          }}
        >
          <option value="number">Number</option>
          <option value="string">Text</option>
        </select>
      </label>
      <label className="field">
        <span>Initial value</span>
        <input
          type={type === 'number' ? 'number' : 'text'}
          className="input"
          value={initial}
          onChange={(e) => setInitial(e.target.value)}
        />
      </label>
      <p className="faint" style={{ margin: '4px 0 0' }}>
        Creates a real game variable (it appears on the Systems page too) and binds this readout to it.
      </p>
    </Modal>
  );
}

function NewActionModal({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (a: ActionDef) => void;
}) {
  const [name, setName] = useState('New action');
  return (
    <Modal
      title="New action"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => onCreate(makeActionDef(name))}>
            Create &amp; bind
          </button>
        </>
      )}
    >
      <label className="field">
        <span>Name</span>
        <input type="text" className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      <p className="faint" style={{ margin: '4px 0 0' }}>
        Creates a plain (button) action and binds this button to it — then use
        "Edit script…" to write what it does, without leaving the screen builder.
      </p>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Deck composition ("make a deck of multiple cards, select how many")
// ---------------------------------------------------------------------------

function DeckSection({ def, zone, onChangeDef }: {
  def: GameDef;
  zone: ZoneDef;
  onChangeDef: (def: GameDef) => void;
}) {
  const decks = def.decks
    .map((deck, index) => ({ deck, index }))
    .filter(({ deck }) => deck.initialZone === zone.id);

  if (decks.length === 0) {
    return (
      <section className="tt-prop-section">
        <h4>Deck</h4>
        <p className="faint tt-prop-hint">No deck spawns here yet.</p>
        <button
          type="button"
          className="btn"
          onClick={() => onChangeDef({ ...def, decks: [...def.decks, newCustomDeckAt(zone.name, zone.id)] })}
        >
          + Create deck here
        </button>
      </section>
    );
  }

  return (
    <>
      {decks.map(({ deck, index }) => (
        <DeckEditor
          key={deck.id}
          def={def}
          deck={deck}
          onChange={(d) => onChangeDef({ ...def, decks: updateAt(def.decks, index, d) })}
        />
      ))}
    </>
  );
}

function DeckEditor({ def, deck, onChange }: {
  def: GameDef;
  deck: DeckDef;
  onChange: (deck: DeckDef) => void;
}) {
  const src = deck.source;
  const total = deckCardCount(deck);
  return (
    <section className="tt-prop-section">
      <h4>Deck <span className="chip tt-deck-total">{total} card{total === 1 ? '' : 's'}</span></h4>
      <label className="field">
        <span>Deck name</span>
        <input
          type="text"
          className="input"
          value={deck.name}
          onChange={(e) => onChange({ ...deck, name: e.target.value })}
        />
      </label>

      <div className="tt-seg tt-seg-small" role="group" aria-label="Deck source">
        <button
          type="button"
          className={src.kind === 'standard52' ? 'tt-active' : ''}
          onClick={() => {
            if (src.kind !== 'standard52') onChange({ ...deck, source: { kind: 'standard52' } });
          }}
        >
          Standard 52
        </button>
        <button
          type="button"
          className={src.kind === 'custom' ? 'tt-active' : ''}
          onClick={() => {
            if (src.kind !== 'custom') onChange({ ...deck, source: { kind: 'custom', entries: [] } });
          }}
        >
          Custom cards
        </button>
      </div>

      {src.kind === 'standard52' && (
        <>
          <Stepper
            label="Jokers"
            value={src.jokers ?? 0}
            min={0}
            max={8}
            onChange={(jokers) => onChange({ ...deck, source: { ...src, jokers: jokers || undefined } })}
          />
          <span className="tt-mini-label">Excluded ranks (tap to remove from the deck)</span>
          <div className="tt-ranks">
            {RANK_LABELS.map(([rank, label]) => {
              const excluded = src.excludeRanks?.includes(rank) ?? false;
              return (
                <button
                  key={rank}
                  type="button"
                  className={excluded ? 'tt-rank excluded' : 'tt-rank'}
                  aria-pressed={excluded}
                  onClick={() => {
                    const prev = src.excludeRanks ?? [];
                    const next = excluded ? prev.filter((r) => r !== rank) : [...prev, rank].sort((a, b) => a - b);
                    onChange({ ...deck, source: { ...src, excludeRanks: next.length ? next : undefined } });
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {src.kind === 'custom' && (
        def.cards.length === 0 ? (
          <p className="faint tt-prop-hint">No custom cards yet — design some in the Cards tab first.</p>
        ) : (
          <>
            {src.entries.map((entry, i) => (
              <div className="tt-deck-row" key={i}>
                <select
                  className="select"
                  aria-label="Card"
                  value={entry.cardId}
                  onChange={(e) => onChange({
                    ...deck,
                    source: { ...src, entries: updateAt(src.entries, i, { ...entry, cardId: e.target.value }) },
                  })}
                >
                  {!def.cards.some((c) => c.id === entry.cardId) && <option value={entry.cardId}>⚠ missing card</option>}
                  {def.cards.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <CountStepper
                  value={entry.count}
                  onChange={(count) => onChange({
                    ...deck,
                    source: { ...src, entries: updateAt(src.entries, i, { ...entry, count }) },
                  })}
                />
                <button
                  type="button"
                  className="btn btn-small btn-ghost tt-deck-x"
                  aria-label="Remove card entry"
                  onClick={() => onChange({ ...deck, source: { ...src, entries: removeAt(src.entries, i) } })}
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn"
              onClick={() => onChange({
                ...deck,
                source: { ...src, entries: [...src.entries, { cardId: def.cards[0].id, count: 1 }] },
              })}
            >
              + Add card
            </button>
          </>
        )
      )}
    </section>
  );
}

/** Compact −/n/+ for copies-per-card (1-99). */
function CountStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.max(1, Math.min(99, Math.round(v))));
  return (
    <span className="tt-count">
      <button type="button" className="btn tt-step-btn" aria-label="Fewer copies" onClick={() => set(value - 1)}>−</button>
      <input
        type="number"
        className="input tt-step-input"
        aria-label="Copies"
        min={1}
        max={99}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n)) set(n);
        }}
      />
      <button type="button" className="btn tt-step-btn" aria-label="More copies" onClick={() => set(value + 1)}>+</button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared inputs
// ---------------------------------------------------------------------------

/** Number stepper with 44px −/+ touch targets; clamps + snaps to `step`. */
function Stepper({ label, value, min, max, step = 1, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const set = (v: number) => onChange(snapStep(v, min, max, step));
  // Draft text while the field is focused: snapping on every keystroke would
  // eat decimal points mid-typing ("12." → 12) and hide the full value.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== '' && !Number.isNaN(n)) set(n);
    setDraft(null);
  };
  return (
    <label className="tt-step">
      <span>{label}</span>
      <div className="tt-step-row">
        <button type="button" className="btn tt-step-btn" aria-label={`Decrease ${label}`} onClick={() => set(value - step)}>−</button>
        <input
          type="text"
          inputMode="decimal"
          className="input tt-step-input"
          value={draft ?? String(value)}
          onFocus={(e) => { setDraft(String(value)); e.target.select(); }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setDraft(null);
          }}
          aria-label={label}
        />
        <button type="button" className="btn tt-step-btn" aria-label={`Increase ${label}`} onClick={() => set(value + step)}>+</button>
      </div>
    </label>
  );
}

/** Stepper over Auto,1..12 (grid rows/columns; 0 renders as "Auto"). */
function AutoStepper({ label, value, onChange }: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const v = value ?? 0;
  const set = (n: number) => {
    const clamped = Math.max(0, Math.min(12, Math.round(n)));
    onChange(clamped === 0 ? null : clamped);
  };
  return (
    <label className="tt-step">
      <span>{label}</span>
      <div className="tt-step-row">
        <button type="button" className="btn tt-step-btn" aria-label={`Decrease ${label}`} disabled={v <= 0} onClick={() => set(v - 1)}>−</button>
        <span className="input tt-step-input tt-step-read" aria-live="polite">{v === 0 ? 'Auto' : v}</span>
        <button type="button" className="btn tt-step-btn" aria-label={`Increase ${label}`} disabled={v >= 12} onClick={() => set(v + 1)}>+</button>
      </div>
    </label>
  );
}

/**
 * Stepper over Inherit,min..max (state style overrides, part font sizes).
 * Decrementing past `min` clears the override back to `clearLabel`; + from
 * cleared starts at min. Fractional steps round to 2 dp (0.1 font sizes).
 */
function InheritStepper({ label, value, min, max, step = 1, clearLabel = 'Inherit', onChange }: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  /** Read-out while no override is set. Default "Inherit". */
  clearLabel?: string;
  onChange: (v: number | undefined) => void;
}) {
  const round = (v: number) => Math.round(v * 100) / 100;
  return (
    <label className="tt-step">
      <span>{label}</span>
      <div className="tt-step-row">
        <button
          type="button"
          className="btn tt-step-btn"
          aria-label={`Decrease ${label}`}
          disabled={value === undefined}
          onClick={() => onChange(value !== undefined && value > min ? Math.max(min, round(value - step)) : undefined)}
        >
          −
        </button>
        <span className="input tt-step-input tt-step-read" aria-live="polite">
          {value === undefined ? clearLabel : value}
        </span>
        <button
          type="button"
          className="btn tt-step-btn"
          aria-label={`Increase ${label}`}
          disabled={value !== undefined && value >= max}
          onClick={() => onChange(value === undefined ? min : Math.min(max, round(value + step)))}
        >
          ＋
        </button>
      </div>
    </label>
  );
}

function Check({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="tt-check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
