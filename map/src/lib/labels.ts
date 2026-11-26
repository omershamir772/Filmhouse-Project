import type { CountryFeature, PointOfView } from '../types/map';
import { angularDistance } from './geo';

export interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How many of the largest countries are eligible for a label at a given camera altitude.
 * Far away, only the giants get names; zoomed in, small countries appear too.
 */
export function labelBudget(altitude: number): number {
  if (altitude > 2.2) return 22;
  if (altitude > 1.6) return 40;
  if (altitude > 1.1) return 70;
  if (altitude > 0.7) return 120;
  return 180;
}

/** Font size in px for a label, larger for big countries and when zoomed in. */
export function labelFontSize(country: CountryFeature, altitude: number): number {
  const base = 10 + Math.min(4, Math.sqrt(country.area) * 6);
  const zoomBoost = altitude < 0.8 ? 1.5 : altitude < 1.4 ? 0.75 : 0;
  return Math.round(base + zoomBoost);
}

/** Whether a point is comfortably on the camera-facing side of the globe (not near the rim). */
export function facesCamera(lat: number, lng: number, pov: PointOfView): boolean {
  // The horizon seen from `altitude` globe radii above the surface, minus a margin so labels
  // don't crowd the limb where they'd be squashed.
  const horizon = (Math.acos(1 / (1 + pov.altitude)) * 180) / Math.PI;
  return angularDistance(lat, lng, pov.lat, pov.lng) < horizon * 0.82;
}

const overlaps = (a: ScreenBox, b: ScreenBox, pad: number) =>
  a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;

/**
 * Greedy label placement: walk countries from largest to smallest and keep a label only if its
 * on-screen box doesn't collide with one already placed. Returns the ids to show.
 */
export function placeLabels(
  candidates: { id: string; box: ScreenBox }[],
  reserved: ScreenBox[] = [],
  padding = 6,
): Set<string> {
  const placed: ScreenBox[] = [...reserved];
  const visible = new Set<string>();
  for (const c of candidates) {
    if (placed.some((p) => overlaps(c.box, p, padding))) continue;
    placed.push(c.box);
    visible.add(c.id);
  }
  return visible;
}
