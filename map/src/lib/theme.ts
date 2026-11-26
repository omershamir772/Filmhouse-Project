// The map palette lives in CSS variables (src/index.css) so it can be re-themed in one place.
// WebGL materials can't read CSS, so this resolves the variables once at start-up.

export interface MapTheme {
  bg: string;
  globe: string;
  border: string;
  borderBright: string;
  borderHover: string;
  graticule: string;
  atmosphere: string;
  label: string;
  school: string;
  cinematheque: string;
  festival: string;
  pending: string;
}

const VARS: Record<keyof MapTheme, string> = {
  bg: '--map-bg',
  globe: '--map-globe',
  border: '--map-border',
  borderBright: '--map-border-bright',
  borderHover: '--map-border-hover',
  graticule: '--map-graticule',
  atmosphere: '--map-atmosphere',
  label: '--map-label',
  school: '--map-school',
  cinematheque: '--map-cinematheque',
  festival: '--map-festival',
  pending: '--map-pending',
};

// Used if the stylesheet hasn't loaded (keep in sync with index.css).
const FALLBACK: MapTheme = {
  bg: '#090d16',
  globe: '#0d1322',
  border: '#3b82f6',
  borderBright: '#60a5fa',
  borderHover: '#bfdbfe',
  graticule: 'rgba(96, 165, 250, 0.13)',
  atmosphere: '#3b82f6',
  label: 'rgba(191, 219, 254, 0.78)',
  school: '#fbbf24',
  cinematheque: '#f472b6',
  festival: '#34d399',
  pending: '#cbd5e1',
};

/**
 * three.js can't parse 8-digit hex colours, but CSS minifiers turn `rgba(…)` into exactly that
 * (`#60a5fa21`). Convert those back to rgba() before they reach WebGL.
 */
export function toWebGLColor(value: string): string {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(value);
  if (!m) return value;
  const n = parseInt(m[1], 16);
  const alpha = parseInt(m[2], 16) / 255;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha.toFixed(3)})`;
}

export function readTheme(el: Element = document.documentElement): MapTheme {
  const styles = getComputedStyle(el);
  return Object.fromEntries(
    (Object.keys(VARS) as (keyof MapTheme)[]).map((key) => [key, toWebGLColor(styles.getPropertyValue(VARS[key]).trim() || FALLBACK[key])]),
  ) as unknown as MapTheme;
}
