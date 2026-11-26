import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Globe, { type GlobeMethods } from 'react-globe.gl';
import { MeshPhongMaterial } from 'three';
import { geoGraticule } from 'd3-geo';

import type { CountryFeature, MapLocation, PointOfView } from '../types/map';
import { CATEGORY_META } from '../types/map';
import { altitudeForArea } from '../lib/geo';
import { facesCamera, labelBudget, labelFontSize, placeLabels, type ScreenBox } from '../lib/labels';
import type { MapTheme } from '../lib/theme';

export interface WorldMapHandle {
  flyTo(lat: number, lng: number, altitude?: number): void;
  flyToCountry(country: CountryFeature): void;
  zoomIn(): void;
  zoomOut(): void;
  resetView(): void;
}

export interface PickedPoint {
  lat: number;
  lng: number;
  country?: string;
}

interface WorldMapProps {
  theme: MapTheme;
  countries: CountryFeature[];
  locations: MapLocation[];
  selectedId: string | null;
  /** Country to outline brightly, e.g. after jumping to it from search. */
  highlightedCountryId: string | null;
  onSelectLocation(location: MapLocation): void;
  onSelectCountry(country: CountryFeature): void;
  /** When true, a click on the globe picks coordinates instead of navigating. */
  pickMode: boolean;
  onPick(point: PickedPoint): void;
  /** Stop idle auto-rotation, e.g. while a drawer or modal is open. */
  holdRotation: boolean;
}

const HOME_VIEW: PointOfView = { lat: 28, lng: 18, altitude: 2.3 };
/** Start further out on narrow screens so the whole globe fits. */
const homeView = (width: number): PointOfView => ({ ...HOME_VIEW, altitude: width < 640 ? 3.3 : HOME_VIEW.altitude });
const MIN_ALTITUDE = 0.12;
const MAX_ALTITUDE = 4;
const FLY_MS = 1400;
const RESUME_ROTATION_AFTER_MS = 15_000;
const MAX_LABELS = 180;

type HtmlItem =
  | { kind: 'label'; key: string; lat: number; lng: number; country: CountryFeature }
  | { kind: 'pin'; key: string; lat: number; lng: number; location: MapLocation };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** '#34d399' + 0.5 → 'rgba(52, 211, 153, 0.5)' (WebGL materials can't use CSS variables). */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha.toFixed(3)})`;
}

// Graticule lines every 15° (GeoJSON is [lng, lat]).
const GRATICULE = geoGraticule().step([15, 15]).lines().map((l) => l.coordinates as [number, number][]);

export const WorldMap = forwardRef<WorldMapHandle, WorldMapProps>(function WorldMap(props, ref) {
  const { theme, countries, locations, selectedId, highlightedCountryId, pickMode, holdRotation } = props;
  const globeRef = useRef<GlobeMethods | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Latest props for handlers attached to imperatively created DOM elements.
  const latest = useRef(props);
  latest.current = props;

  const countriesBySize = useMemo(() => [...countries].sort((a, b) => b.area - a.area), [countries]);

  // ---------- Size ----------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---------- Idle auto-rotation ----------
  const resumeTimer = useRef<number | undefined>(undefined);
  const holdRef = useRef(holdRotation);
  holdRef.current = holdRotation;

  const pauseRotation = useCallback(() => {
    const controls = globeRef.current?.controls();
    if (controls) controls.autoRotate = false;
    window.clearTimeout(resumeTimer.current);
  }, []);

  const scheduleResume = useCallback(() => {
    window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      const controls = globeRef.current?.controls();
      if (controls && !holdRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        controls.autoRotate = true;
      }
    }, RESUME_ROTATION_AFTER_MS);
  }, []);

  useEffect(() => {
    if (holdRotation) pauseRotation();
    else scheduleResume();
  }, [holdRotation, pauseRotation, scheduleResume]);

  useEffect(() => () => window.clearTimeout(resumeTimer.current), []);

  // ---------- Labels & pins (HTML layer) ----------
  const elements = useRef(new Map<string, HTMLElement>());

  // Only the countries that can ever win a label get a DOM element (tiny islands never do).
  const labelItems = useMemo<HtmlItem[]>(
    () =>
      countriesBySize
        .slice(0, MAX_LABELS)
        .map((c) => ({ kind: 'label', key: `label:${c.id}`, lat: c.labelLat, lng: c.labelLng, country: c })),
    [countriesBySize],
  );
  const pinItems = useMemo<HtmlItem[]>(
    () => locations.map((l) => ({ kind: 'pin', key: `pin:${l.id}`, lat: l.lat, lng: l.lng, location: l })),
    [locations],
  );
  const htmlItems = useMemo(() => [...labelItems, ...pinItems], [labelItems, pinItems]);

  const applyVisibility = (el: HTMLElement) => {
    const show = el.dataset.front !== '0' && (el.dataset.kind === 'pin' || el.dataset.allowed === '1');
    el.style.opacity = show ? '1' : '0';
    el.style.visibility = show ? 'visible' : 'hidden';
  };

  const createElement = useCallback((d: object) => {
    const item = d as HtmlItem;
    const cached = elements.current.get(item.key);
    if (cached) return cached;

    let el: HTMLElement;
    if (item.kind === 'label') {
      el = document.createElement('div');
      el.className = 'fh-country-label';
      el.textContent = item.country.name;
      el.dataset.allowed = '0';
    } else {
      const { location } = item;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'fh-pin';
      button.style.setProperty('--pin', `var(${CATEGORY_META[location.category].colorVar})`);
      button.dataset.pending = String(location.approvalStatus === 'pending');
      button.setAttribute('aria-label', `${location.name}, ${location.city} — ${CATEGORY_META[location.category].label}`);
      const dot = document.createElement('span');
      dot.className = 'fh-pin__dot';
      const name = document.createElement('span');
      name.className = 'fh-pin__name';
      name.textContent = location.approvalStatus === 'pending' ? `${location.name} (pending review)` : location.name;
      button.append(dot, name);
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!latest.current.pickMode) latest.current.onSelectLocation(location);
      });
      el = button;
    }
    el.dataset.kind = item.kind;
    elements.current.set(item.key, el);
    return el;
  }, []);

  // Drop cached pins that are no longer on the map (e.g. filtered out).
  useEffect(() => {
    const live = new Set(htmlItems.map((i) => i.key));
    for (const key of elements.current.keys()) if (!live.has(key)) elements.current.delete(key);
  }, [htmlItems]);

  useEffect(() => {
    for (const item of pinItems) {
      const el = elements.current.get(item.key);
      if (el) el.dataset.selected = String(item.kind === 'pin' && item.location.id === selectedId);
    }
  }, [pinItems, selectedId]);

  /** Decide which country labels fit on screen without overlapping each other or the pins. */
  const frame = useRef(0);
  const updateLabels = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const globe = globeRef.current;
      if (!globe) return;
      const pov = globe.pointOfView();
      const { width, height } = containerRef.current?.getBoundingClientRect() ?? { width: 0, height: 0 };
      const onScreen = (x: number, y: number) => x > 0 && y > 0 && x < width && y < height;

      const reserved: ScreenBox[] = [];
      for (const item of pinItems) {
        if (!facesCamera(item.lat, item.lng, pov)) continue;
        const s = globe.getScreenCoords(item.lat, item.lng, 0.01);
        reserved.push({ x: s.x - 9, y: s.y - 9, w: 18, h: 18 });
      }

      const sizes = new Map<string, number>();
      const candidates: { id: string; box: ScreenBox }[] = [];
      for (const c of countriesBySize.slice(0, labelBudget(pov.altitude))) {
        if (!facesCamera(c.labelLat, c.labelLng, pov)) continue;
        const s = globe.getScreenCoords(c.labelLat, c.labelLng, 0.006);
        if (!onScreen(s.x, s.y)) continue;
        const fontSize = labelFontSize(c, pov.altitude);
        // Uppercase with letter-spacing: ~0.7em per character, measured without touching layout.
        const w = c.name.length * fontSize * 0.7;
        sizes.set(c.id, fontSize);
        candidates.push({ id: c.id, box: { x: s.x - w / 2, y: s.y - fontSize / 2, w, h: fontSize } });
      }
      const visible = placeLabels(candidates, reserved);

      for (const c of countriesBySize.slice(0, MAX_LABELS)) {
        const el = elements.current.get(`label:${c.id}`);
        if (!el) continue;
        const show = visible.has(c.id);
        el.dataset.allowed = show ? '1' : '0';
        if (show) el.style.fontSize = `${sizes.get(c.id)}px`;
        applyVisibility(el);
      }
    });
  }, [countriesBySize, pinItems]);

  useEffect(() => {
    updateLabels();
  }, [updateLabels, size]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // ---------- Camera ----------
  const flyTo = useCallback(
    (lat: number, lng: number, altitude = 0.55) => {
      pauseRotation();
      globeRef.current?.pointOfView({ lat, lng, altitude }, FLY_MS);
      scheduleResume();
    },
    [pauseRotation, scheduleResume],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      const globe = globeRef.current;
      if (!globe) return;
      pauseRotation();
      const pov = globe.pointOfView();
      const altitude = Math.min(MAX_ALTITUDE, Math.max(MIN_ALTITUDE, pov.altitude * factor));
      globe.pointOfView({ ...pov, altitude }, 500);
      scheduleResume();
    },
    [pauseRotation, scheduleResume],
  );

  useImperativeHandle(
    ref,
    () => ({
      flyTo,
      flyToCountry: (c) => flyTo(c.labelLat, c.labelLng, altitudeForArea(c.area)),
      zoomIn: () => zoomBy(0.65),
      zoomOut: () => zoomBy(1.5),
      resetView: () => {
        globeRef.current?.pointOfView(homeView(containerRef.current?.clientWidth ?? 1024), FLY_MS);
        scheduleResume();
      },
    }),
    [flyTo, zoomBy, scheduleResume],
  );

  const handleReady = useCallback(() => {
    const globe = globeRef.current;
    if (!globe) return;
    globe.pointOfView(homeView(containerRef.current?.clientWidth ?? 1024), 0);
    // Retina at 3x costs a lot of fill rate for little visible gain on thin lines.
    globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const controls = globe.controls();
    const radius = globe.getGlobeRadius();
    controls.minDistance = radius * (1 + MIN_ALTITUDE);
    controls.maxDistance = radius * (1 + MAX_ALTITUDE);
    controls.zoomSpeed = 0.8;
    controls.rotateSpeed = 0.6;
    controls.autoRotateSpeed = 0.35;
    controls.autoRotate = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Any drag or scroll stops the idle spin at once; it resumes after a quiet spell.
    controls.addEventListener('start', pauseRotation);
    controls.addEventListener('end', scheduleResume);
    updateLabels();
  }, [pauseRotation, scheduleResume, updateLabels]);

  // ---------- Layers ----------
  const globeMaterial = useMemo(
    () =>
      new MeshPhongMaterial({
        color: theme.globe,
        emissive: theme.globe,
        emissiveIntensity: 0.35,
        shininess: 6,
        transparent: true,
        opacity: 0.94,
      }),
    [theme.globe],
  );

  const selected = locations.find((l) => l.id === selectedId) ?? null;
  const rings = useMemo(() => (selected ? [selected] : []), [selected]);

  const asCountry = (d: object) => d as CountryFeature;
  const isLit = (c: CountryFeature) => c.id === hoveredId || c.id === highlightedCountryId;

  return (
    <div ref={containerRef} className="absolute inset-0 isolate z-0" style={{ cursor: pickMode ? 'crosshair' : undefined }}>
      {size.width > 0 && (
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          backgroundColor={theme.bg}
          globeMaterial={globeMaterial}
          showAtmosphere
          atmosphereColor={theme.atmosphere}
          atmosphereAltitude={0.14}
          onGlobeReady={handleReady}
          onZoom={updateLabels}
          onGlobeClick={(coords) => {
            if (pickMode) props.onPick({ lat: coords.lat, lng: coords.lng });
          }}
          // Graticule
          pathsData={GRATICULE}
          pathPoints={(d: object) => d as [number, number][]}
          pathPointLat={(p: object) => (p as [number, number])[1]}
          pathPointLng={(p: object) => (p as [number, number])[0]}
          pathPointAlt={0.001}
          pathColor={() => theme.graticule}
          pathResolution={3}
          pathTransitionDuration={0}
          // Countries
          polygonsData={countries}
          polygonGeoJsonGeometry="geometry"
          polygonCapColor={(d: object) => (isLit(asCountry(d)) ? 'rgba(96, 165, 250, 0.16)' : 'rgba(0, 0, 0, 0)')}
          polygonSideColor={() => 'rgba(0, 0, 0, 0)'}
          polygonStrokeColor={(d: object) => {
            const c = asCountry(d);
            if (c.id === hoveredId) return theme.borderHover;
            return c.id === highlightedCountryId ? theme.borderBright : theme.border;
          }}
          // Constant altitude: changing it on hover would rebuild every country's geometry.
          polygonAltitude={0.005}
          polygonCapCurvatureResolution={8}
          polygonsTransitionDuration={250}
          polygonLabel={(d: object) =>
            `<div class="fh-country-tip">${escapeHtml(asCountry(d).name)}${pickMode ? ' · click to drop a pin' : ''}</div>`
          }
          onPolygonHover={(d: object | null) => setHoveredId(d ? asCountry(d).id : null)}
          onPolygonClick={(d: object, _event: MouseEvent, coords: { lat: number; lng: number }) => {
            const c = asCountry(d);
            if (pickMode) props.onPick({ lat: coords.lat, lng: coords.lng, country: c.name });
            else props.onSelectCountry(c);
          }}
          // Pulse around the selected pin
          ringsData={rings}
          ringLat={(d: object) => (d as MapLocation).lat}
          ringLng={(d: object) => (d as MapLocation).lng}
          ringColor={(d: object) => {
            const hex = theme[(d as MapLocation).category];
            return (t: number) => withAlpha(hex, 1 - t);
          }}
          ringMaxRadius={2.2}
          ringPropagationSpeed={1.6}
          ringRepeatPeriod={1100}
          // Labels and pins
          htmlElementsData={htmlItems}
          htmlLat={(d: object) => (d as HtmlItem).lat}
          htmlLng={(d: object) => (d as HtmlItem).lng}
          htmlAltitude={(d: object) => ((d as HtmlItem).kind === 'pin' ? 0.01 : 0.006)}
          htmlElement={createElement}
          htmlElementVisibilityModifier={(el: HTMLElement, isVisible: boolean) => {
            el.dataset.front = isVisible ? '1' : '0';
            applyVisibility(el);
          }}
          htmlTransitionDuration={0}
        />
      )}
    </div>
  );
});

export default WorldMap;
