/**
 * Zone part styles -> inline CSS. A zone element's `partStyles` lets authors
 * restyle individual pieces of the rendered card chrome (cost lozenge, × N
 * count, tile name, caption row, empty note). ScreenRenderer resolves each
 * part here once per frame and hands the results to ZoneViews as
 * `custom.parts`; box chrome rides layoutStyleCss (same pipeline as element
 * frames) and the text knobs layer on top.
 */
import type * as React from 'react';
import type { ZonePartStyle } from '../shared/types';
import { layoutStyleCss } from './layoutGeometry';

/** One resolved part: inline CSS for the part's node + a hide flag. */
export interface PartCss {
  css: React.CSSProperties;
  hidden: boolean;
}

/**
 * Resolve one authored part to inline CSS. `fontPx` converts the authored
 * fontSize (% of screen width — the text-element convention) to px, so the
 * caller owns the screen-width binding. Undefined part -> undefined (the
 * renderer keeps its stock chrome untouched).
 */
export function zonePartCss(
  part: ZonePartStyle | undefined,
  fontPx: (pctOfScreenW: number) => number,
): PartCss | undefined {
  if (part === undefined) return undefined;
  // Box chrome first; text knobs after so they win over any overlap.
  const css: React.CSSProperties = { ...(layoutStyleCss(part.style) as React.CSSProperties) };
  if (part.color !== undefined) css.color = part.color;
  if (part.bold !== undefined) css.fontWeight = part.bold ? 700 : 400;
  if (part.fontSize !== undefined) css.fontSize = fontPx(part.fontSize);
  return { css, hidden: part.hidden === true };
}
