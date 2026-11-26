import { useEffect, useRef } from 'react';
import type { MapLocation } from '../types/map';
import { CATEGORY_META } from '../types/map';

interface LocationDrawerProps {
  location: MapLocation | null;
  siteUrl: string;
  onClose(): void;
}

const isSafeUrl = (url: string) => /^https?:\/\/[^\s]+$/i.test(url);

function formatDeadline(iso: string): { date: string; note: string; closed: boolean } {
  const deadline = new Date(`${iso}T23:59:59`);
  const date = deadline.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const days = Math.ceil((deadline.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return { date, note: 'Closed', closed: true };
  if (days === 0) return { date, note: 'Closes today', closed: false };
  return { date, note: `${days} day${days === 1 ? '' : 's'} left`, closed: false };
}

/** Slide-over card with the details of the selected pin. */
export function LocationDrawer({ location, siteUrl, onClose }: LocationDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const open = location !== null;

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const meta = location ? CATEGORY_META[location.category] : null;
  const deadline = location?.deadline ? formatDeadline(location.deadline) : null;
  const peopleUrl = location
    ? location.category === 'school'
      ? `${siteUrl}/people?q=${encodeURIComponent(location.name)}`
      : `${siteUrl}/people?location=${encodeURIComponent(location.city)}`
    : '#';
  const gigsUrl = location ? `${siteUrl}/board?location=${encodeURIComponent(location.city)}` : '#';

  return (
    <aside
      aria-hidden={!open}
      aria-label={location ? `${location.name} details` : undefined}
      className={`absolute top-0 right-0 bottom-0 z-30 flex w-full flex-col border-l border-map-line bg-map-panel-solid/92 shadow-[-24px_0_60px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-transform duration-300 ease-out sm:w-[400px] ${
        open ? 'translate-x-0' : 'pointer-events-none translate-x-full'
      }`}
    >
      {location && meta && (
        <>
          <header className="flex items-start gap-3 border-b border-map-line px-6 pt-6 pb-5">
            <div className="min-w-0 flex-1">
              <p className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold tracking-[0.14em] uppercase">
                <span className="inline-flex items-center gap-1.5" style={{ color: `var(${meta.colorVar})` }}>
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `var(${meta.colorVar})` }} />
                  {meta.label}
                </span>
                {location.approvalStatus === 'pending' && (
                  <span className="rounded-full border border-dashed border-map-pending/60 px-2 py-0.5 text-[10px] text-map-pending">Pending review</span>
                )}
              </p>
              <h2 className="text-xl leading-snug font-semibold text-map-text">{location.name}</h2>
              <p className="mt-1 text-sm text-map-muted">
                {location.city}, {location.country}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close details"
              tabIndex={open ? 0 : -1}
              className="-mt-1 -mr-2 rounded-full p-2 text-map-muted transition-colors hover:bg-white/5 hover:text-map-text"
            >
              <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5">
                <path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="m5 5 10 10M15 5 5 15" />
              </svg>
            </button>
          </header>

          <div className="flex-1 space-y-6 overflow-y-auto px-6 py-6">
            {location.approvalStatus === 'pending' && (
              <p className="rounded-xl border border-dashed border-map-pending/40 bg-white/[0.03] px-4 py-3 text-sm text-map-muted">
                This entry is waiting for a FilmHouse moderator to verify it. Only you can see it until it’s approved.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-map-text">{location.status}</span>
              {deadline && (
                <span
                  className={`rounded-full px-3 py-1 text-xs font-medium ${deadline.closed ? 'bg-white/[0.04] text-map-muted' : 'bg-map-festival/15 text-map-festival'}`}
                >
                  Deadline {deadline.date} · {deadline.note}
                </span>
              )}
            </div>

            <p className="text-[15px] leading-relaxed text-map-text/90">{location.description}</p>

            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-map-line bg-white/[0.02] p-4">
                <dt className="text-xs text-map-muted">FilmHouse members</dt>
                <dd className="mt-1 text-2xl font-semibold text-map-text tabular-nums">{location.connectedMembersCount}</dd>
              </div>
              <div className="rounded-xl border border-map-line bg-white/[0.02] p-4">
                <dt className="text-xs text-map-muted">Open crew calls nearby</dt>
                <dd className="mt-1 text-2xl font-semibold text-map-text tabular-nums">{location.activeGigsCount}</dd>
              </div>
            </dl>

            {isSafeUrl(location.websiteUrl) && (
              <a
                href={location.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-map-border-bright underline-offset-4 hover:underline"
              >
                {new URL(location.websiteUrl).hostname.replace(/^www\./, '')}
                <span aria-hidden>↗</span>
              </a>
            )}
          </div>

          <footer className="grid gap-2 border-t border-map-line px-6 py-5">
            <a
              href={peopleUrl}
              tabIndex={open ? 0 : -1}
              className="rounded-full bg-map-border px-4 py-2.5 text-center text-sm font-semibold text-white transition-colors hover:bg-map-border-bright"
            >
              {location.category === 'school' ? 'View Connected Students / Alumni' : 'View Connected Members'}
            </a>
            <a
              href={gigsUrl}
              tabIndex={open ? 0 : -1}
              className="rounded-full border border-map-line px-4 py-2.5 text-center text-sm font-semibold text-map-text transition-colors hover:border-map-border-bright"
            >
              View Local Crew Calls
            </a>
          </footer>
        </>
      )}
    </aside>
  );
}
