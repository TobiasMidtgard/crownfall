/**
 * EdIcon — the editor's stroke icon set (Deckhand-style: 24×24 viewBox,
 * 1.6px rounded strokes, no fills), colored via currentColor so the theme
 * paints them (gold accents on the crimson theme). Used by the section rail,
 * the element palette and anywhere a compact pictogram beats a text glyph.
 */

export type EdIconName = keyof typeof PATHS;

const PATHS = {
  // holders (one-click zone presets)
  deck: '<rect x="5" y="7" width="12" height="15" rx="2"/><path d="M8 5h12a2 2 0 0 1 2 2v13"/>',
  pile: '<rect x="4" y="5" width="14" height="17" rx="2"/><path d="M8 9h6M8 12h6"/>',
  hand: '<path d="M4 20l3-11 4 1-2 10zM10 19l2-12 4 .8-1.4 12zM16 19l1-11 4 1.4-2 10z"/>',
  slot: '<rect x="6" y="4" width="12" height="16" rx="2" stroke-dasharray="2.5 2.5"/>',
  grid: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16M3 12h18"/>',
  carousel: '<rect x="7" y="6" width="10" height="12" rx="2"/><path d="M3 12h2M19 12h2"/>',
  // elements
  zone: '<rect x="3" y="5" width="18" height="14" rx="3" stroke-dasharray="3 3"/>',
  text: '<path d="M5 6h14M12 6v13"/>',
  variable: '<path d="M9 4L7.2 20M16.8 4L15 20M4.5 9h16M3.5 15h16"/>',
  button: '<rect x="3" y="8" width="18" height="9" rx="4.5"/><path d="M9 12.5h6"/>',
  shape: '<circle cx="12" cy="12" r="7"/>',
  line: '<path d="M4 19L20 5"/>',
  log: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 9h10M7 13h7"/>',
  phases: '<circle cx="5" cy="12" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="19" cy="12" r="2.2"/><path d="M7.2 12h2.6M14.2 12h2.6"/>',
  group: '<rect x="4" y="4" width="10" height="10" rx="2"/><rect x="10" y="10" width="10" height="10" rx="2"/>',
  switcher: '<rect x="3" y="9" width="18" height="11" rx="2"/><path d="M5 9V6h5v3M12 9V6h5v3"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.4"/><path d="M5 17l5-5 3 3 3-2 3 3"/>',
  component: '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/>',
  // section rail
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 8.2h.01M12 11.5V16"/>',
  cards: '<rect x="4" y="5" width="14" height="17" rx="2"/><path d="M8 9h6M8 12h6"/>',
  types: '<path d="M12 3.5l7.5 8.5-7.5 8.5L4.5 12z"/>',
  flow: '<path d="M5 12a7 7 0 0 1 12-4.6M19 12a7 7 0 0 1-12 4.6"/><path d="M17 3.8v3.6h-3.6M7 20.2v-3.6h3.6"/>',
  actions: '<path d="M8 5.5l10.5 6.5L8 18.5z"/>',
  rules: '<path d="M5 5a2 2 0 0 1 2-2h12v16H7a2 2 0 0 0-2 2z"/><path d="M5 19a2 2 0 0 1 2-2h12"/>',
  filters: '<path d="M4 5h16l-6.2 7v6l-3.6 2v-8z"/>',
} as const;

export function EdIcon({ name, size = 22 }: { name: EdIconName; size?: number }) {
  return (
    <svg
      className="ed-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      // Static trusted markup from the PATHS table above — never user input.
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  );
}
