/**
 * PropertiesPanel — the inspector for the current selection:
 *   nothing   -> screen properties (background, aspect hint)
 *   1 element -> ⛶ Focus button (edit the elements ON TOP of it, any kind)
 *                + child-element count, name, x/y/w/h (% of parent),
 *                per-kind settings (zone seat/
 *                cardScale/spacing/rows×columns + DECK COMPOSITION, text/
 *                varText typography + INLINE "+ New variable", button binding
 *                + INLINE "+ New action" and "Edit script…" (node graph in a
 *                modal), shape/line options, group ungroup), style chrome,
 *                reactive STATES (ordered, first match wins — name, when,
 *                style overrides, rect capture, canvas preview control),
 *                reveal transition, and VISIBLE WHEN via the
 *                ExpressionEditor ($viewer bound)
 *   2+        -> Group selection + webpage-builder alignment essentials
 *                (align left/center/right/top/middle/bottom, distribute H/V)
 *
 * PRESENTATION: on ≤720px viewports (the runner's narrow breakpoint) the
 * panel switches to bottom-sheet dress (`tt-props-narrow`) — the workspace
 * already hosts it inside the mobile bottom-sheet drawer (`tt-sheet`); the
 * class widens touch targets to ≥44px and relaxes the control grid.
 */
import { useEffect, useState } from 'react';
import type {
  ActionDef, DeckDef, ElementState, GameDef, Id, LayoutStyle, MotionSpec, RevealAnim,
  ScreenElement, ScreenLayout, SeatRef, VariableDef, ZoneDef,
} from '../../../shared/types';
import { PASS_ACTION_ID } from '../../../shared/types';
import { BlockScriptEditor } from '../../blocks/BlockScriptEditor';
import { ExpressionEditor } from '../../blocks/ExpressionEditor';
import { AnnouncePartsChip } from '../../blocks/slots';
import { Modal } from '../../common/Modal';
import { removeAt, updateAt } from '../../lib';
import {
  GROUP_MIN, MIN_H, MIN_W, MOTION_DEFAULTS, PHONE_ASPECT, addElementState, deckCardCount,
  findEl, makeActionDef, makeVariableDef, moveElementState, newCustomDeckAt, newElementState,
  patchMobileVariant, patchMotion, removeElementState, setTextDynamic, snapStep,
  templateFieldOptions, updateEl, updateElementState, variantElements, withVariantElements,
  type AlignOp, type VariantKey,
} from './screenModel';

const RANK_LABELS: [number, string][] = [
  [2, '2'], [3, '3'], [4, '4'], [5, '5'], [6, '6'], [7, '7'], [8, '8'],
  [9, '9'], [10, '10'], [11, 'J'], [12, 'Q'], [13, 'K'], [14, 'A'],
];

const KIND_LABELS: Record<ScreenElement['kind'], string> = {
  zone: 'zone', text: 'text', varText: 'variable', button: 'button',
  shape: 'shape', line: 'line', log: 'log', group: 'group',
};

type ZoneEl = Extract<ScreenElement, { kind: 'zone' }>;
type TextEl = Extract<ScreenElement, { kind: 'text' }>;
type VarTextEl = Extract<ScreenElement, { kind: 'varText' }>;
type ButtonEl = Extract<ScreenElement, { kind: 'button' }>;
type ShapeEl = Extract<ScreenElement, { kind: 'shape' }>;
type LineEl = Extract<ScreenElement, { kind: 'line' }>;

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
  /** Layout-level patches (backgrounds, motion, mobile settings). */
  onSetLayout: (layout: ScreenLayout) => void;
  /** Asks the workspace to confirm-delete the mobile layout. */
  onDeleteMobile: () => void;
  /** Editor-only canvas preview: which of the selected element's states shows (null = base). */
  statePreviewId: Id | null;
  onStatePreview: (stateId: Id | null) => void;
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
        Select an element to edit it. Drag empty felt to pan, ctrl-scroll or pinch to zoom.
        Shift-click selects more than one element.
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
        Shown on narrow screens (below 1024&thinsp;px) instead of the desktop layout.
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

function MultiProps({ sel, canGroup, onGroup, onAlign, onDistribute, onRemove }: PropertiesPanelProps) {
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
  const { def, el, onPatchEl, onRemove, onUngroup, onChangeDef, onFocus } = props;
  const patchBase = (p: Partial<Pick<ScreenElement, 'name' | 'rect' | 'style' | 'visible' | 'reveal' | 'onChangeAnim'>>) =>
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
      </section>

      {el.kind === 'zone' && <ZoneSection {...props} el={el} />}
      {el.kind === 'text' && <TextSection def={def} el={el} onPatchEl={onPatchEl} />}
      {el.kind === 'varText' && <VarTextSection {...props} el={el} />}
      {el.kind === 'button' && <ButtonSection {...props} el={el} />}
      {el.kind === 'shape' && <ShapeSection el={el} onPatchEl={onPatchEl} />}
      {el.kind === 'line' && <LineSection el={el} onPatchEl={onPatchEl} />}
      {el.kind === 'log' && <LogSection el={el} onPatchEl={onPatchEl} />}
      {el.kind === 'group' && (
        <section className="tt-prop-section">
          <h4>Group</h4>
          <p className="faint tt-prop-hint">
            {el.children.length === 0
              ? 'Empty — drag elements inside on the canvas.'
              : `${el.children.length} element${el.children.length === 1 ? '' : 's'} move, hide and animate together.`}
          </p>
          <Check
            label="Tabbed panels"
            checked={el.tabbed === true}
            onChange={(v) => onPatchEl(el.id, (c) => (
              c.kind === 'group' ? { ...c, tabbed: v || undefined } : c
            ))}
          />
          {el.tabbed === true && (
            <p className="faint tt-prop-hint">
              Players see one child at a time behind a tab bar: each direct child is a panel,
              its name is the tab label, and the panel fills the group (its position inside is
              ignored). The open tab is remembered on their device, and hidden panels disable
              their tab. On the canvas the panels still draw stacked — use ⛶ Focus to edit
              one at a time.
            </p>
          )}
          {el.children.length > 0 && (
            <button type="button" className="btn" onClick={() => onUngroup(el.id)}>
              ⊟ Ungroup
            </button>
          )}
        </section>
      )}

      <StyleSection style={el.style} onChange={(style) => patchBase({ style })} />

      <StatesSection {...props} el={el} />

      <section className="tt-prop-section">
        <h4>Visibility &amp; animation</h4>
        <label className="field">
          <span>Visible when</span>
          <ExpressionEditor
            def={def}
            value={el.visible ?? null}
            onChange={(visible) => patchBase({ visible })}
            bindings={['$viewer']}
            allowNull
            nullLabel="Always visible"
          />
        </label>
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
          ? 'The game zone itself stays (Zones tab) — only this element goes.'
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
  const { def, el, onPatchEl } = props;
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

      <label className="field">
        <span>Card filter</span>
        <ExpressionEditor
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

      <Check label="Show zone name" checked={el.showName !== false} onChange={(showName) => patch({ showName })} />
      <Check label="Show card count" checked={el.showCount === true} onChange={(showCount) => patch({ showCount: showCount || undefined })} />
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

function TypographyFields({ el, patch }: {
  el: { fontSize: number; color?: string; align: 'left' | 'center' | 'right'; bold?: boolean };
  patch: (p: Partial<{ fontSize: number; color?: string; align: 'left' | 'center' | 'right'; bold?: boolean }>) => void;
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
// Button (action binding + inline action creation + node-graph script modal)
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
        <span>Label</span>
        <input type="text" className="input" value={el.label} onChange={(e) => patch({ label: e.target.value })} />
      </label>
      <div className="tt-grid">
        <Stepper label="Font size" value={el.fontSize ?? 1.8} min={0.5} max={8} step={0.1} onChange={(fontSize) => patch({ fontSize })} />
      </div>
      <p className="faint tt-prop-hint">
        Buttons disable themselves while the move isn't legal. The automatic action bar
        skips moves that have a button.
      </p>
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

function ShapeSection({ el, onPatchEl }: {
  el: ShapeEl;
  onPatchEl: PropertiesPanelProps['onPatchEl'];
}) {
  const patch = (p: Partial<ShapeEl>) =>
    onPatchEl(el.id, (c) => (c.kind === 'shape' ? { ...c, ...p } : c));
  return (
    <section className="tt-prop-section">
      <h4>Shape</h4>
      <label className="field">
        <span>Shape</span>
        <select
          className="select"
          value={el.shape}
          onChange={(e) => patch({ shape: e.target.value as ShapeEl['shape'] })}
        >
          <option value="circle">Circle</option>
          <option value="rect">Rectangle</option>
          <option value="diamond">Diamond</option>
          <option value="pill">Pill</option>
        </select>
      </label>
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
// Style (all elements)
// ---------------------------------------------------------------------------

function StyleSection({ style, onChange }: {
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
    <section className="tt-prop-section">
      <h4>Style</h4>
      <ColorRow label="Background" value={s.background} placeholder="Transparent" onChange={(background) => set({ background })} />
      <ColorRow label="Border color" value={s.borderColor} placeholder="Default" onChange={(borderColor) => set({ borderColor })} />
      <div className="tt-grid">
        <Stepper
          label="Border px"
          value={s.borderWidth ?? (s.borderColor || s.borderStyle ? 1 : 0)}
          min={0}
          max={8}
          onChange={(borderWidth) => set({ borderWidth })}
        />
        <Stepper label="Radius px" value={s.borderRadius ?? 0} min={0} max={48} onChange={(borderRadius) => set({ borderRadius })} />
      </div>
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
    </section>
  );
}

/** Color swatch + free-text (so gradients and css colors work too). */
function ColorRow({ label, value, placeholder, onChange }: {
  label: string;
  value: string | undefined;
  placeholder: string;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="tt-color-row">
        <input
          type="color"
          className="tt-color"
          aria-label={`${label} picker`}
          value={/^#[0-9a-fA-F]{6}$/.test(value ?? '') ? value! : '#1d3b2f'}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="text"
          className="input"
          aria-label={label}
          placeholder={placeholder}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
        />
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
          <span className="tt-mini-label">Preview on canvas</span>
          <div className="tt-seg tt-seg-small tt-state-preview" role="group" aria-label="Preview state">
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
        Creates a real game variable (it appears in the Variables tab too) and binds this readout to it.
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
 * Stepper over Inherit,min..max (state style overrides). Decrementing past
 * `min` clears the override back to "Inherit"; + from Inherit starts at min.
 */
function InheritStepper({ label, value, min, max, onChange }: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  onChange: (v: number | undefined) => void;
}) {
  return (
    <label className="tt-step">
      <span>{label}</span>
      <div className="tt-step-row">
        <button
          type="button"
          className="btn tt-step-btn"
          aria-label={`Decrease ${label}`}
          disabled={value === undefined}
          onClick={() => onChange(value !== undefined && value > min ? value - 1 : undefined)}
        >
          −
        </button>
        <span className="input tt-step-input tt-step-read" aria-live="polite">
          {value === undefined ? 'Inherit' : value}
        </span>
        <button
          type="button"
          className="btn tt-step-btn"
          aria-label={`Increase ${label}`}
          disabled={value !== undefined && value >= max}
          onClick={() => onChange(value === undefined ? min : Math.min(max, value + 1))}
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
