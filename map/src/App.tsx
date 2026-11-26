import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CategoryFilter, CountryFeature, LocationCategory, MapLocation, NewLocationInput } from './types/map';
import { CATEGORY_META } from './types/map';
import type { PickedPoint, WorldMapHandle } from './components/WorldMap';
import { FilterBar } from './components/FilterBar';
import { SearchBox, type SearchResult } from './components/SearchBox';
import { LocationDrawer } from './components/LocationDrawer';
import { AddLocationModal, EMPTY_DRAFT, type LocationDraft } from './components/AddLocationModal';
import { fetchLocations, readMapContext, submitLocation } from './lib/api';
import { loadCountries } from './lib/geo';
import { readTheme } from './lib/theme';

// three.js and the globe are the bulk of the bundle; load them as their own chunk.
const WorldMap = lazy(() => import('./components/WorldMap'));

const context = readMapContext();

const controlButton =
  'grid h-10 w-10 place-items-center rounded-full border border-map-line bg-map-panel text-map-text backdrop-blur-md transition-colors hover:border-map-border-bright hover:text-white';

export function App() {
  const theme = useMemo(() => readTheme(), []);
  const [countries, setCountries] = useState<CountryFeature[]>([]);
  const mapRef = useRef<WorldMapHandle>(null);

  const [locations, setLocations] = useState<MapLocation[]>([]);
  const [filter, setFilter] = useState<CategoryFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedCountryId, setHighlightedCountryId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pickMode, setPickMode] = useState(false);
  const [draft, setDraft] = useState<LocationDraft>(EMPTY_DRAFT);
  const [banner, setBanner] = useState<string | null>(null);

  useEffect(() => {
    fetchLocations().then(setLocations);
    loadCountries().then(setCountries);
  }, []);

  const visible = useMemo(() => (filter === 'all' ? locations : locations.filter((l) => l.category === filter)), [locations, filter]);
  const counts = useMemo(() => {
    const c: Record<LocationCategory, number> = { school: 0, cinematheque: 0, festival: 0 };
    for (const l of locations) c[l.category] += 1;
    return c;
  }, [locations]);
  const selected = locations.find((l) => l.id === selectedId) ?? null;

  // Deselect a pin hidden by the filter.
  useEffect(() => {
    if (selectedId && !visible.some((l) => l.id === selectedId)) setSelectedId(null);
  }, [visible, selectedId]);

  // The search highlight fades after a few seconds.
  useEffect(() => {
    if (!highlightedCountryId) return;
    const t = window.setTimeout(() => setHighlightedCountryId(null), 4000);
    return () => window.clearTimeout(t);
  }, [highlightedCountryId]);

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 9000);
    return () => window.clearTimeout(t);
  }, [banner]);

  useEffect(() => {
    if (!pickMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPickMode(false);
        setModalOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pickMode]);

  const selectLocation = useCallback((l: MapLocation) => {
    setSelectedId(l.id);
    mapRef.current?.flyTo(l.lat, l.lng, 0.6);
  }, []);

  const selectCountry = useCallback((c: CountryFeature) => {
    setSelectedId(null);
    setHighlightedCountryId(c.id);
    mapRef.current?.flyToCountry(c);
  }, []);

  const onSearch = (r: SearchResult) => {
    if (r.type === 'country') selectCountry(r.country);
    else {
      if (filter !== 'all' && filter !== r.location.category) setFilter('all');
      selectLocation(r.location);
    }
  };

  const onPick = (p: PickedPoint) => {
    setDraft((d) => ({ ...d, lat: p.lat.toFixed(4), lng: p.lng.toFixed(4), country: p.country ?? d.country }));
    setPickMode(false);
    setModalOpen(true);
  };

  const onSubmit = async (input: NewLocationInput) => {
    const created = await submitLocation(input, context.user?.username ?? 'guest');
    setLocations((ls) => [...ls, created]);
    setModalOpen(false);
    setDraft(EMPTY_DRAFT);
    if (filter !== 'all' && filter !== created.category) setFilter('all');
    setBanner(`Thanks! “${created.name}” was sent for review. It will appear for everyone once a FilmHouse moderator has verified it.`);
    selectLocation(created);
  };

  const closeDrawer = useCallback(() => setSelectedId(null), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-map-bg font-sans text-map-text">
      <h1 className="sr-only">FilmHouse world map of film schools, cinematheques and festivals</h1>

      <Suspense fallback={<GlobeLoading hidden={false} />}>
        {countries.length > 0 && (
          <WorldMap
            ref={mapRef}
            theme={theme}
            countries={countries}
            locations={visible}
            selectedId={selectedId}
            highlightedCountryId={highlightedCountryId}
            onSelectLocation={selectLocation}
            onSelectCountry={selectCountry}
            pickMode={pickMode}
            onPick={onPick}
            holdRotation={Boolean(selected) || modalOpen || pickMode}
          />
        )}
      </Suspense>
      <GlobeLoading hidden={countries.length > 0} />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col gap-3 p-4 sm:p-5 lg:flex-row lg:items-start">
        <a
          href={`${context.siteUrl}/`}
          className="pointer-events-auto flex shrink-0 items-center gap-2 self-start rounded-full border border-map-line bg-map-panel px-4 py-2 text-sm backdrop-blur-md hover:border-map-border-bright"
        >
          <span aria-hidden className="text-map-muted">←</span>
          <span className="font-semibold tracking-wide">
            Film<span className="text-map-border-bright">House</span>
          </span>
          <span className="text-map-muted">· World Map</span>
        </a>
        <div className="pointer-events-auto flex min-w-0 flex-1 flex-col items-stretch gap-2 sm:flex-row sm:items-center lg:justify-center">
          <FilterBar value={filter} counts={counts} onChange={setFilter} />
          <SearchBox locations={locations} countries={countries} onSelect={onSearch} />
        </div>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="pointer-events-auto shrink-0 self-start rounded-full bg-map-border px-4 py-2 text-sm font-semibold text-white shadow-[0_0_24px_rgba(59,130,246,0.35)] transition-colors hover:bg-map-border-bright"
        >
          + Add to Map
        </button>
      </div>

      {/* Banners */}
      {(pickMode || banner) && (
        <div className="pointer-events-none absolute inset-x-0 top-32 z-20 flex justify-center px-4 lg:top-20">
          <div role="status" className="pointer-events-auto flex max-w-xl items-start gap-3 rounded-2xl border border-map-border/50 bg-map-panel-solid/95 px-4 py-3 text-sm shadow-2xl backdrop-blur-md">
            {pickMode ? (
              <>
                <span aria-hidden className="text-map-border-bright">◎</span>
                <span className="flex-1">Click anywhere on the globe to drop the pin. Press Esc to go back.</span>
                <button type="button" className="text-map-muted hover:text-map-text" onClick={() => { setPickMode(false); setModalOpen(true); }}>
                  Cancel
                </button>
              </>
            ) : (
              <>
                <span aria-hidden className="text-map-festival">✓</span>
                <span className="flex-1">{banner}</span>
                <button type="button" aria-label="Dismiss" className="text-map-muted hover:text-map-text" onClick={() => setBanner(null)}>
                  ✕
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-10 hidden rounded-2xl border border-map-line bg-map-panel px-4 py-3 text-xs backdrop-blur-md sm:block">
        <ul className="grid gap-1.5">
          {(Object.keys(CATEGORY_META) as LocationCategory[]).map((c) => (
            <li key={c} className="flex items-center gap-2 text-map-text/90">
              <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: `var(${CATEGORY_META[c].colorVar})` }} />
              {CATEGORY_META[c].plural}
            </li>
          ))}
          <li className="flex items-center gap-2 text-map-muted">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full border border-dashed border-map-pending" />
            Pending review
          </li>
        </ul>
        <p className="mt-2 max-w-52 text-[11px] leading-snug text-map-muted">Demo data: deadlines and member counts are samples.</p>
      </div>

      {/* Camera controls */}
      <div className={`absolute bottom-4 z-20 flex flex-col gap-2 transition-[right] duration-300 ${selected ? 'right-4 sm:right-[416px]' : 'right-4'}`}>
        <button type="button" aria-label="Zoom in" className={controlButton} onClick={() => mapRef.current?.zoomIn()}>
          <span aria-hidden className="text-lg leading-none">+</span>
        </button>
        <button type="button" aria-label="Zoom out" className={controlButton} onClick={() => mapRef.current?.zoomOut()}>
          <span aria-hidden className="text-lg leading-none">−</span>
        </button>
        <button
          type="button"
          aria-label="Reset view"
          className={controlButton}
          onClick={() => {
            setSelectedId(null);
            mapRef.current?.resetView();
          }}
        >
          <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4">
            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 10h14M10 3c2.2 2 2.2 12 0 14M10 3c-2.2 2-2.2 12 0 14" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>

      <LocationDrawer location={selected} siteUrl={context.siteUrl} onClose={closeDrawer} />

      <AddLocationModal
        open={modalOpen}
        draft={draft}
        signedIn={Boolean(context.user)}
        loginUrl={`${context.siteUrl}/login?next=/map`}
        onChange={setDraft}
        onPickOnGlobe={() => {
          setModalOpen(false);
          setSelectedId(null);
          setPickMode(true);
        }}
        onSubmit={onSubmit}
        onClose={closeModal}
      />
    </div>
  );
}

function GlobeLoading({ hidden }: { hidden: boolean }) {
  if (hidden) return null;
  return (
    <div role="status" className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-4 text-sm text-map-muted">
        <span aria-hidden className="h-24 w-24 animate-pulse rounded-full border border-map-border/40 shadow-[0_0_60px_rgba(59,130,246,0.25)]" />
        Loading the globe…
      </div>
    </div>
  );
}
