import { feature } from 'topojson-client';
import { geoArea, geoCentroid } from 'd3-geo';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { CountryFeature } from '../types/map';

type CountriesTopology = Topology<{ countries: GeometryCollection<{ name: string }> }>;

// Natural Earth's short names, made friendlier for labels and search.
const DISPLAY_NAMES: Record<string, string> = {
  'United States of America': 'United States',
  'Dem. Rep. Congo': 'DR Congo',
  'Central African Rep.': 'Central African Republic',
  'Bosnia and Herz.': 'Bosnia and Herzegovina',
  'Dominican Rep.': 'Dominican Republic',
  'Eq. Guinea': 'Equatorial Guinea',
  'S. Sudan': 'South Sudan',
  'Solomon Is.': 'Solomon Islands',
  'Falkland Is.': 'Falkland Islands',
  'Fr. S. Antarctic Lands': 'French Southern Lands',
  'W. Sahara': 'Western Sahara',
  'N. Cyprus': 'Northern Cyprus',
  'Czechia': 'Czechia',
  'eSwatini': 'Eswatini',
  'Macedonia': 'North Macedonia',
};

let cache: Promise<CountryFeature[]> | null = null;

/**
 * All countries with their geometry, display name, label anchor and area.
 * Natural Earth 1:50m borders via world-atlas (public domain, bundled — no map API key); loaded as
 * its own chunk so the page shell appears before the ~750 KB of border data arrives.
 */
export function loadCountries(): Promise<CountryFeature[]> {
  cache ??= import('world-atlas/countries-50m.json').then((m) => toFeatures(m.default as unknown as CountriesTopology));
  return cache;
}

function toFeatures(topology: CountriesTopology): CountryFeature[] {
  const collection = feature(topology, topology.objects.countries);
  return collection.features
    .filter((f) => f.geometry)
    .map((f, i) => {
      const name = DISPLAY_NAMES[f.properties.name] ?? f.properties.name;
      const anchor = labelAnchor(f.geometry);
      return {
        id: String(f.id ?? `country-${i}`),
        name,
        labelLat: anchor[1],
        labelLng: anchor[0],
        area: geoArea(f),
        geometry: f.geometry,
      };
    });
}

/**
 * Where to put a country's name: the centroid of its largest polygon, so e.g. France's label sits
 * in mainland France rather than being pulled out to sea by its overseas territories.
 */
function labelAnchor(geometry: GeoJSON.Geometry): [number, number] {
  if (geometry.type !== 'MultiPolygon') return geoCentroid(geometry);
  let best: GeoJSON.Polygon | null = null;
  let bestArea = -1;
  for (const coordinates of geometry.coordinates) {
    const polygon: GeoJSON.Polygon = { type: 'Polygon', coordinates };
    const area = geoArea(polygon);
    if (area > bestArea) {
      bestArea = area;
      best = polygon;
    }
  }
  return geoCentroid(best ?? geometry);
}

/** Great-circle angle between two points, in degrees. */
export function angularDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = Math.PI / 180;
  const a =
    Math.sin(lat1 * toRad) * Math.sin(lat2 * toRad) +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos((lng1 - lng2) * toRad);
  return Math.acos(Math.min(1, Math.max(-1, a))) / toRad;
}

/** A sensible camera altitude for showing a whole country, from its area. */
export function altitudeForArea(area: number): number {
  return Math.min(2.2, Math.max(0.35, Math.sqrt(area) * 2.2));
}
