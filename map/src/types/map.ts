// Data model for the FilmHouse world map. Shaped to match what a future /api/map/locations
// endpoint will return, so the mock dataset can be swapped for live data without UI changes.

export type LocationCategory = 'school' | 'cinematheque' | 'festival';

export type LocationStatus = 'Open for Submissions' | 'Active Now' | 'Upcoming' | 'Academic Institution' | 'Year-round Programme';

export type ApprovalStatus = 'approved' | 'pending';

export interface MapLocation {
  id: string;
  name: string;
  category: LocationCategory;
  country: string;
  city: string;
  lat: number;
  lng: number;
  description: string;
  websiteUrl: string;
  status: LocationStatus;
  /** ISO date (YYYY-MM-DD) of the next submission deadline, for festivals and funds. */
  deadline?: string;
  /** FilmHouse members whose profile links to this place (students, alumni, staff). */
  connectedMembersCount: number;
  /** Open crew calls on the Bulletin Board near this place. */
  activeGigsCount: number;
  approvalStatus: ApprovalStatus;
  /** Set on community submissions. */
  submittedBy?: string;
  submittedAt?: string;
}

/** What the "Add to Map" form produces before the server assigns an id and counts. */
export type NewLocationInput = Pick<
  MapLocation,
  'name' | 'category' | 'country' | 'city' | 'lat' | 'lng' | 'description' | 'websiteUrl' | 'status' | 'deadline'
>;

export type CategoryFilter = LocationCategory | 'all';

export interface CategoryMeta {
  label: string;
  plural: string;
  /** CSS variable holding the pin colour, so the palette lives in one place (index.css). */
  colorVar: string;
}

export const CATEGORY_META: Record<LocationCategory, CategoryMeta> = {
  school: { label: 'Film School', plural: 'Film Schools', colorVar: '--map-school' },
  cinematheque: { label: 'Cinematheque', plural: 'Cinematheques', colorVar: '--map-cinematheque' },
  festival: { label: 'Festival / Fund', plural: 'Active Festivals', colorVar: '--map-festival' },
};

/** A country as drawn on the globe, with a precomputed label anchor. */
export interface CountryFeature {
  id: string;
  name: string;
  /** Label anchor: centroid of the country's largest landmass. */
  labelLat: number;
  labelLng: number;
  /** Area in steradians; bigger countries get labels first. */
  area: number;
  geometry: GeoJSON.Geometry;
}

/** Camera position: lat/lng under the camera and altitude in globe radii. */
export interface PointOfView {
  lat: number;
  lng: number;
  altitude: number;
}
