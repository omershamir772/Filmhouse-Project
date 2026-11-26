import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { LocationCategory, LocationStatus, NewLocationInput } from '../types/map';
import { CATEGORY_META } from '../types/map';

/** The form while it's being filled in: every field is still text. */
export interface LocationDraft {
  name: string;
  category: LocationCategory;
  country: string;
  city: string;
  lat: string;
  lng: string;
  description: string;
  websiteUrl: string;
  status: LocationStatus;
  deadline: string;
}

export const EMPTY_DRAFT: LocationDraft = {
  name: '',
  category: 'school',
  country: '',
  city: '',
  lat: '',
  lng: '',
  description: '',
  websiteUrl: '',
  status: 'Academic Institution',
  deadline: '',
};

const STATUS_OPTIONS: Record<LocationCategory, LocationStatus[]> = {
  school: ['Academic Institution'],
  cinematheque: ['Year-round Programme', 'Active Now', 'Upcoming'],
  festival: ['Open for Submissions', 'Upcoming', 'Active Now'],
};

interface AddLocationModalProps {
  open: boolean;
  draft: LocationDraft;
  signedIn: boolean;
  loginUrl: string;
  onChange(draft: LocationDraft): void;
  /** Close the form so the user can click a spot on the globe; it reopens with the coordinates. */
  onPickOnGlobe(): void;
  onSubmit(input: NewLocationInput): void;
  onClose(): void;
}

type Errors = Partial<Record<keyof LocationDraft, string>>;

function validate(d: LocationDraft): { errors: Errors; input?: NewLocationInput } {
  const errors: Errors = {};
  const lat = Number(d.lat);
  const lng = Number(d.lng);
  if (d.name.trim().length < 3) errors.name = 'Give the place its full name.';
  if (!d.country.trim()) errors.country = 'Which country is it in?';
  if (!d.city.trim()) errors.city = 'Which city?';
  if (d.lat === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) errors.lat = 'Latitude must be between −90 and 90.';
  if (d.lng === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) errors.lng = 'Longitude must be between −180 and 180.';
  if (d.description.trim().length < 20) errors.description = 'A sentence or two (at least 20 characters) helps moderators verify it.';
  if (d.websiteUrl && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(d.websiteUrl.trim())) errors.websiteUrl = 'Use a full link starting with https://';
  if (d.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(d.deadline)) errors.deadline = 'Use a valid date.';
  if (Object.keys(errors).length) return { errors };
  return {
    errors,
    input: {
      name: d.name.trim(),
      category: d.category,
      country: d.country.trim(),
      city: d.city.trim(),
      lat: Math.round(lat * 1e4) / 1e4,
      lng: Math.round(lng * 1e4) / 1e4,
      description: d.description.trim(),
      websiteUrl: d.websiteUrl.trim(),
      status: d.status,
      deadline: d.category === 'festival' && d.deadline ? d.deadline : undefined,
    },
  };
}

const inputClass =
  'w-full rounded-xl border border-map-line bg-black/20 px-3.5 py-2.5 text-sm text-map-text placeholder:text-map-muted/70 outline-none transition focus:border-map-border-bright focus:ring-2 focus:ring-map-border/25';

function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium text-map-text">{label}</span>
      {children}
      {error ? <span className="text-xs text-rose-300">{error}</span> : hint ? <span className="text-xs text-map-muted">{hint}</span> : null}
    </label>
  );
}

/** Community submission form for a new school, cinematheque or festival. */
export function AddLocationModal({ open, draft, signedIn, loginUrl, onChange, onPickOnGlobe, onSubmit, onClose }: AddLocationModalProps) {
  const [errors, setErrors] = useState<Errors>({});
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const set = <K extends keyof LocationDraft>(key: K, value: LocationDraft[K]) => onChange({ ...draft, [key]: value });

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-location-title"
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-map-line bg-map-panel-solid shadow-2xl sm:rounded-3xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-map-line px-6 pt-6 pb-4">
          <div>
            <h2 id="add-location-title" className="text-lg font-semibold text-map-text">
              Add to the map
            </h2>
            <p className="mt-1 text-sm text-map-muted">Know a film school, cinematheque or festival we’re missing? A moderator checks every entry before it goes public.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-full p-2 text-map-muted hover:bg-white/5 hover:text-map-text">
            <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5">
              <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="m5 5 10 10M15 5 5 15" />
            </svg>
          </button>
        </header>

        {!signedIn ? (
          <div className="space-y-4 px-6 py-8 text-center">
            <p className="text-sm text-map-muted">Sign in to your FilmHouse account to suggest a new place.</p>
            <a href={loginUrl} className="inline-block rounded-full bg-map-border px-5 py-2.5 text-sm font-semibold text-white hover:bg-map-border-bright">
              Sign in
            </a>
          </div>
        ) : (
          <form
            noValidate
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              const result = validate(draft);
              setErrors(result.errors);
              if (result.input) onSubmit(result.input);
            }}
          >
            <div className="grid flex-1 gap-4 overflow-y-auto px-6 py-5">
              <fieldset className="grid gap-2">
                <legend className="mb-1.5 text-sm font-medium text-map-text">What kind of place?</legend>
                <div className="grid grid-cols-3 gap-2">
                  {(Object.keys(CATEGORY_META) as LocationCategory[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={draft.category === c}
                      onClick={() => onChange({ ...draft, category: c, status: STATUS_OPTIONS[c][0], deadline: c === 'festival' ? draft.deadline : '' })}
                      className={`flex items-center justify-center gap-2 rounded-xl border px-2 py-2.5 text-xs font-semibold transition sm:text-sm ${
                        draft.category === c ? 'border-map-border-bright bg-white/[0.06] text-map-text' : 'border-map-line text-map-muted hover:text-map-text'
                      }`}
                    >
                      <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ background: `var(${CATEGORY_META[c].colorVar})` }} />
                      {CATEGORY_META[c].label}
                    </button>
                  ))}
                </div>
              </fieldset>

              <Field label="Name" error={errors.name}>
                <input ref={firstField} className={inputClass} value={draft.name} maxLength={140} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Sapir College – School of Audio & Visual Arts" />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="City" error={errors.city}>
                  <input className={inputClass} value={draft.city} maxLength={80} onChange={(e) => set('city', e.target.value)} />
                </Field>
                <Field label="Country" error={errors.country}>
                  <input className={inputClass} value={draft.country} maxLength={80} onChange={(e) => set('country', e.target.value)} />
                </Field>
              </div>

              <div className="grid gap-2">
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Latitude" error={errors.lat}>
                    <input className={inputClass} inputMode="decimal" value={draft.lat} onChange={(e) => set('lat', e.target.value)} placeholder="31.5065" />
                  </Field>
                  <Field label="Longitude" error={errors.lng}>
                    <input className={inputClass} inputMode="decimal" value={draft.lng} onChange={(e) => set('lng', e.target.value)} placeholder="34.5964" />
                  </Field>
                </div>
                <button type="button" onClick={onPickOnGlobe} className="justify-self-start text-sm font-medium text-map-border-bright underline-offset-4 hover:underline">
                  ◎ Pick the spot on the globe instead
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Status">
                  <select className={inputClass} value={draft.status} onChange={(e) => set('status', e.target.value as LocationStatus)}>
                    {STATUS_OPTIONS[draft.category].map((s) => (
                      <option key={s} value={s} className="bg-map-panel-solid">
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
                {draft.category === 'festival' && (
                  <Field label="Next submission deadline" error={errors.deadline} hint="Optional">
                    <input type="date" className={`${inputClass} [color-scheme:dark]`} value={draft.deadline} onChange={(e) => set('deadline', e.target.value)} />
                  </Field>
                )}
              </div>

              <Field label="Website" error={errors.websiteUrl} hint="Optional — the official site, so moderators can verify it">
                <input type="url" className={inputClass} value={draft.websiteUrl} maxLength={300} onChange={(e) => set('websiteUrl', e.target.value)} placeholder="https://" />
              </Field>

              <Field label="Description" error={errors.description}>
                <textarea
                  className={`${inputClass} min-h-24 resize-y`}
                  value={draft.description}
                  maxLength={600}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="What makes it special for filmmakers?"
                />
              </Field>
            </div>

            <footer className="flex items-center justify-end gap-3 border-t border-map-line px-6 py-4">
              <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-sm font-medium text-map-muted hover:text-map-text">
                Cancel
              </button>
              <button type="submit" className="rounded-full bg-map-border px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-map-border-bright">
                Submit for review
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}
