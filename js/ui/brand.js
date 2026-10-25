// The Podium mark: three square-shouldered blocks — second, first, third — and
// a dot over the tallest. Blocks use the ink color; the dot is brand violet.
//
// NOTE: this is drawn from the logo guidelines. When the official logo files
// arrive, replace MARK_PATHS with the exact geometry (and add the wordmark
// lockup from the files — the guidelines say never to re-type it in a live font).

export const BRAND_VIOLET = '#7C5CFF';

// viewBox 0 0 100 100. Dot diameter = 0.2 × mark height (per the clear-space rule).
const BLOCKS = [
  { x: 0, y: 48, w: 28, h: 52 },  // second
  { x: 36, y: 28, w: 28, h: 72 }, // first (tallest)
  { x: 72, y: 64, w: 28, h: 36 }, // third
];
const DOT = { cx: 50, cy: 10, r: 10 };

/**
 * SVG markup for the mark.
 *   ink: block color (defaults to currentColor so it follows --ink)
 *   dot: dot color (brand violet unless one-colour use)
 */
export function markSVG({ ink = 'currentColor', dot = BRAND_VIOLET, title = 'Podium' } = {}) {
  const rects = BLOCKS.map((b) => `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" fill="${ink}"/>`).join('');
  return `<svg viewBox="0 0 100 100" role="img" aria-label="${title}" xmlns="http://www.w3.org/2000/svg">${rects}<circle cx="${DOT.cx}" cy="${DOT.cy}" r="${DOT.r}" fill="${dot}"/></svg>`;
}

export const MARK_GEOMETRY = { BLOCKS, DOT };
