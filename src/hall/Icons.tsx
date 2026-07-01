/**
 * Heraldic symbol library (FableTest index.html <defs>, ported wholesale).
 * Rendered once by HallApp so every crest and glyph keeps resolving through
 * <use href="#id"> exactly as the original markup did.
 */
export function Icons() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        {/* The fractured crown: one point breaks away as it falls */}
        <symbol id="mark-crownfall" viewBox="0 0 120 120" fill="none" stroke="currentColor">
          <path d="M24 82 V44 L44 62 L58 32 L68 52" strokeWidth="4" strokeLinejoin="miter" />
          <path d="M24 82 H72" strokeWidth="4" />
          <path d="M24 91 H66" strokeWidth="2" opacity=".45" />
          <g transform="rotate(16 94 56)">
            <path d="M82 74 L96 40 L106 68" strokeWidth="4" strokeLinejoin="miter" />
          </g>
          <path d="M73 58 L78 67 L73 78" strokeWidth="2" opacity=".55" />
          <rect x="88" y="92" width="10" height="10" transform="rotate(45 93 97)" strokeWidth="2.5" />
          <rect x="42" y="70" width="7" height="7" transform="rotate(45 45.5 73.5)" strokeWidth="2" />
        </symbol>

        {/* Compact mark for the nav and footer */}
        <symbol id="mark-small" viewBox="0 0 32 32" fill="none" stroke="currentColor">
          <path d="M5 22 V10 L11 16 L16 7 L20 14" strokeWidth="2.5" strokeLinejoin="miter" />
          <path d="M5 22 H19" strokeWidth="2.5" />
          <g transform="rotate(14 26 14)"><path d="M22 20 L26 8 L29 17" strokeWidth="2.5" /></g>
          <rect x="23" y="24" width="4.5" height="4.5" transform="rotate(45 25.2 26.2)" strokeWidth="1.6" />
        </symbol>

        {/* Personal sigils: visual identity only, no lore */}
        <symbol id="crest-ember" viewBox="0 0 80 96" fill="none" stroke="currentColor">
          <path d="M40 6 L72 16 V50 C72 70 58 83 40 90 C22 83 8 70 8 50 V16 Z" strokeWidth="2.5" />
          <path d="M40 22 C49 33 53 40 53 48 C53 57 48 63 40 65 C32 63 27 57 27 48 C27 40 31 33 40 22 Z" strokeWidth="2.2" />
          <path d="M40 38 C44 43 46 46 46 50 C46 55 43 58 40 59 C37 58 34 55 34 50 C34 46 36 43 40 38 Z" strokeWidth="1.6" />
          <path d="M24 73 H56" strokeWidth="2" />
        </symbol>

        <symbol id="crest-raven" viewBox="0 0 80 96" fill="none" stroke="currentColor">
          <path d="M40 6 L72 16 V50 C72 70 58 83 40 90 C22 83 8 70 8 50 V16 Z" strokeWidth="2.5" />
          <circle cx="40" cy="28" r="4" strokeWidth="2" />
          <path d="M25 40 L40 51 L55 40" strokeWidth="2.2" />
          <path d="M25 50 L40 61 L55 50" strokeWidth="2.2" />
          <path d="M25 60 L40 71 L55 60" strokeWidth="2.2" />
        </symbol>

        <symbol id="crest-gilt" viewBox="0 0 80 96" fill="none" stroke="currentColor">
          <path d="M40 6 L72 16 V50 C72 70 58 83 40 90 C22 83 8 70 8 50 V16 Z" strokeWidth="2.5" />
          <circle cx="40" cy="46" r="13" strokeWidth="2.2" />
          <path d="M40 24 v7 M40 61 v7 M18 46 h7 M55 46 h7 M25 31 l5 5 M50 56 l5 5 M55 31 l-5 5 M30 56 l-5 5" strokeWidth="2" />
        </symbol>

        <symbol id="crest-veil" viewBox="0 0 80 96" fill="none" stroke="currentColor">
          <path d="M40 6 L72 16 V50 C72 70 58 83 40 90 C22 83 8 70 8 50 V16 Z" strokeWidth="2.5" />
          <path d="M22 32 H58 L40 72 Z" strokeWidth="2.2" strokeLinejoin="miter" />
          <path d="M33 42 H47" strokeWidth="2" />
        </symbol>

        {/* Dominion at the table: a deck under the crown */}
        <symbol id="crest-dominion" viewBox="0 0 80 96" fill="none" stroke="currentColor">
          <rect x="18" y="40" width="36" height="48" strokeWidth="2.5" />
          <path d="M26 34 H62 V82" strokeWidth="2" opacity=".6" />
          <path d="M34 28 H70 V76" strokeWidth="1.6" opacity=".35" />
          <path d="M27 18 V8 L32 12.5 L36 6 L40 12.5 L45 8 V18 Z" strokeWidth="2" strokeLinejoin="miter" />
          <rect x="32" y="58" width="8" height="8" transform="rotate(45 36 62)" strokeWidth="1.8" />
        </symbol>

        {/* The keeper's crown (aurum): flavor, never permission */}
        <symbol id="glyph-crown-small" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M4 17 V8 L9 12.5 L12 6 L15 12.5 L20 8 V17 Z" strokeWidth="1.8" strokeLinejoin="miter" />
        </symbol>

        {/* Stat & state glyphs */}
        <symbol id="glyph-sword" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M4 20 L15 9" strokeWidth="2" /><path d="M12 6 L18 12" strokeWidth="2" /><path d="M15 9 L20 4" strokeWidth="2" /><path d="M4 20 L7 20 M4 20 L4 17" strokeWidth="2" />
        </symbol>
        <symbol id="glyph-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M12 3 L20 6 V12 C20 17 16.5 20 12 21.5 C7.5 20 4 17 4 12 V6 Z" strokeWidth="2" />
        </symbol>
        <symbol id="glyph-coin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="9" strokeWidth="2" /><circle cx="12" cy="12" r="4.5" strokeWidth="1.6" />
        </symbol>
        <symbol id="glyph-lozenge" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect x="7.5" y="7.5" width="9" height="9" transform="rotate(45 12 12)" strokeWidth="2" />
        </symbol>
        <symbol id="glyph-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="4" strokeWidth="2" />
          <path d="M12 2.5 V6 M12 18 V21.5 M2.5 12 H6 M18 12 H21.5 M5.3 5.3 L7.8 7.8 M16.2 16.2 L18.7 18.7 M18.7 5.3 L16.2 7.8 M7.8 16.2 L5.3 18.7" strokeWidth="2" />
        </symbol>

        {/* Panel chrome glyphs */}
        <symbol id="glyph-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M4 5 H20 V16 H10 L6 20 V16 H4 Z" strokeWidth="2" strokeLinejoin="miter" />
          <path d="M8 9 H16 M8 12 H13" strokeWidth="1.6" />
        </symbol>
        <symbol id="glyph-companions" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M9 4 L14.5 6 V10 C14.5 13.5 12.5 15.6 9 17 C5.5 15.6 3.5 13.5 3.5 10 V6 Z" strokeWidth="1.8" />
          <path d="M15 7.5 L20.5 9.5 V12.5 C20.5 15.4 18.9 17.2 16 18.4" strokeWidth="1.8" />
        </symbol>
        <symbol id="glyph-seal" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <circle cx="12" cy="12" r="8.5" strokeWidth="1.8" />
          <rect x="8.5" y="8.5" width="7" height="7" transform="rotate(45 12 12)" strokeWidth="1.8" />
        </symbol>
        <symbol id="glyph-pin-left" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M5 4 V20" strokeWidth="2" /><path d="M19 12 H9 M13 8 L9 12 L13 16" strokeWidth="2" strokeLinejoin="miter" />
        </symbol>
        <symbol id="glyph-pin-right" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M19 4 V20" strokeWidth="2" /><path d="M5 12 H15 M11 8 L15 12 L11 16" strokeWidth="2" strokeLinejoin="miter" />
        </symbol>
        <symbol id="glyph-float" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <rect x="4" y="8" width="12" height="12" strokeWidth="2" />
          <path d="M9 4 H20 V15" strokeWidth="2" />
        </symbol>
        <symbol id="glyph-close" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M6 6 L18 18 M18 6 L6 18" strokeWidth="2" />
        </symbol>

        {/* Keeper's mason tools */}
        <symbol id="glyph-chevron-up" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M5 15 L12 8 L19 15" strokeWidth="2" strokeLinejoin="miter" />
        </symbol>
        <symbol id="glyph-chevron-down" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M5 9 L12 16 L19 9" strokeWidth="2" strokeLinejoin="miter" />
        </symbol>
        <symbol id="glyph-veil-small" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M4 7 H20 L12 19 Z" strokeWidth="2" strokeLinejoin="miter" />
          <path d="M9 11 H15" strokeWidth="1.8" />
        </symbol>
      </defs>
    </svg>
  );
}
