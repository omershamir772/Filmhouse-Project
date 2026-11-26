import type { MapLocation, NewLocationInput } from '../types/map';
import { mockLocations } from '../data/mockLocations';

/**
 * Data access for the map. Today it serves the bundled seed data and keeps submissions in memory;
 * swapping these two functions for `fetch('/api/map/locations')` calls is the only change needed
 * to go live — the components only ever see `MapLocation` objects.
 */
export async function fetchLocations(): Promise<MapLocation[]> {
  return mockLocations;
}

export async function submitLocation(input: NewLocationInput, submittedBy: string): Promise<MapLocation> {
  return {
    ...input,
    id: `pending-${Date.now().toString(36)}`,
    connectedMembersCount: 0,
    activeGigsCount: 0,
    approvalStatus: 'pending',
    submittedBy,
    submittedAt: new Date().toISOString(),
  };
}

export interface MapContext {
  /** The signed-in FilmHouse member, or null for visitors. */
  user: { username: string; displayName: string } | null;
  /** Base URL of the main site, for links to people and the Bulletin Board. */
  siteUrl: string;
}

/** Read the page context the server embeds as JSON (absent when running `vite dev`). */
export function readMapContext(): MapContext {
  const el = document.getElementById('filmhouse-map-context');
  if (!el?.textContent) return { user: { username: 'demo', displayName: 'Demo user' }, siteUrl: '' };
  try {
    return JSON.parse(el.textContent) as MapContext;
  } catch {
    return { user: null, siteUrl: '' };
  }
}
