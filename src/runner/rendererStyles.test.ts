/**
 * ScreenRenderer must own its stylesheet.
 *
 * The editor's live preview (PreviewStage → ScreenRenderer) renders .rn-*
 * markup OUTSIDE the play route. When runner.css rode only on PlayPage /
 * TableScreen (the play chunk), a production session that opened the editor
 * FIRST got the markup without the rules: every .rn-el computed
 * position:static, its inline left/top were ignored, and the whole preview
 * stacked at the stage's left edge — until a table visit happened to inject
 * the stylesheet for the rest of the session ("everything squished up on the
 * left side before playing the first game"). Importing the css from the
 * module that renders the markup makes every chunk graph that includes
 * ScreenRenderer ship the rules, dev and production alike.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('ScreenRenderer stylesheet ownership', () => {
  it("imports runner.css so every surface rendering .rn-* markup ships its rules", () => {
    const src = readFileSync(
      fileURLToPath(new URL('./ScreenRenderer.tsx', import.meta.url)), 'utf8');
    expect(src).toMatch(/import '\.\/runner\.css';/);
  });
});
