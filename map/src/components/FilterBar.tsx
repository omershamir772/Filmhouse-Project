import type { CategoryFilter, LocationCategory } from '../types/map';
import { CATEGORY_META } from '../types/map';

interface FilterBarProps {
  value: CategoryFilter;
  counts: Record<LocationCategory, number>;
  onChange(value: CategoryFilter): void;
}

const ORDER: CategoryFilter[] = ['all', 'school', 'cinematheque', 'festival'];

/** Glassy toggle pills for the three pin categories. */
export function FilterBar({ value, counts, onChange }: FilterBarProps) {
  const total = counts.school + counts.cinematheque + counts.festival;
  return (
    <div
      role="radiogroup"
      aria-label="Show on map"
      className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-map-line bg-map-panel p-1 backdrop-blur-md"
    >
      {ORDER.map((key) => {
        const active = value === key;
        const label = key === 'all' ? 'All' : CATEGORY_META[key].plural;
        const count = key === 'all' ? total : counts[key];
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(key)}
            className={`flex shrink-0 items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors ${
              active ? 'bg-white/10 text-map-text shadow-[inset_0_0_0_1px_var(--map-line)]' : 'text-map-muted hover:text-map-text'
            }`}
          >
            {key !== 'all' && (
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: `var(${CATEGORY_META[key].colorVar})`, boxShadow: `0 0 8px var(${CATEGORY_META[key].colorVar})` }}
              />
            )}
            {label}
            <span className="text-xs text-map-muted tabular-nums">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
