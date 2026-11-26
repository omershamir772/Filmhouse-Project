import { useId, useMemo, useState } from 'react';
import type { CountryFeature, MapLocation } from '../types/map';
import { CATEGORY_META } from '../types/map';

export type SearchResult = { type: 'location'; location: MapLocation } | { type: 'country'; country: CountryFeature };

interface SearchBoxProps {
  locations: MapLocation[];
  countries: CountryFeature[];
  onSelect(result: SearchResult): void;
}

const MAX_RESULTS = 8;
const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Jump to any school, cinematheque, festival, city or country. */
export function SearchBox({ locations, countries, onSelect }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const results = useMemo<SearchResult[]>(() => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    const places: SearchResult[] = locations
      .filter((l) => [l.name, l.city, l.country].some((f) => normalize(f).includes(q)))
      .map((location) => ({ type: 'location', location }));
    const lands: SearchResult[] = countries
      .filter((c) => normalize(c.name).includes(q))
      .sort((a, b) => Number(!normalize(a.name).startsWith(q)) - Number(!normalize(b.name).startsWith(q)))
      .map((country) => ({ type: 'country', country }));
    return [...lands.slice(0, 3), ...places].slice(0, MAX_RESULTS);
  }, [query, locations, countries]);

  const choose = (r: SearchResult) => {
    onSelect(r);
    setQuery('');
    setOpen(false);
  };

  return (
    <div className="relative w-full sm:w-72">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Search the map
      </label>
      <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-map-muted">
        <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M8.5 15a6.5 6.5 0 1 1 0-13 6.5 6.5 0 0 1 0 13Zm9.5 3-4.8-4.8" />
      </svg>
      <input
        id={`${listId}-input`}
        type="search"
        value={query}
        placeholder="Search places or countries…"
        autoComplete="off"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? `${listId}-${active}` : undefined}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(results.length - 1, i + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(0, i - 1));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="w-full rounded-full border border-map-line bg-map-panel py-2 pr-4 pl-10 text-sm text-map-text placeholder:text-map-muted backdrop-blur-md outline-none focus:border-map-border-bright focus:ring-2 focus:ring-map-border/30"
      />
      {open && results.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full right-0 left-0 z-30 mt-2 overflow-hidden rounded-2xl border border-map-line bg-map-panel-solid/95 py-1 shadow-2xl backdrop-blur-md"
        >
          {results.map((r, i) => (
            <li
              key={r.type === 'country' ? `c:${r.country.id}` : `l:${r.location.id}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${i === active ? 'bg-white/8' : ''}`}
            >
              {r.type === 'country' ? (
                <>
                  <span aria-hidden className="h-2.5 w-2.5 rounded-sm border border-map-border-bright" />
                  <span className="text-map-text">{r.country.name}</span>
                  <span className="ml-auto text-xs text-map-muted">Country</span>
                </>
              ) : (
                <>
                  <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: `var(${CATEGORY_META[r.location.category].colorVar})` }} />
                  <span className="min-w-0">
                    <span className="block truncate text-map-text">{r.location.name}</span>
                    <span className="block truncate text-xs text-map-muted">
                      {r.location.city}, {r.location.country}
                    </span>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
