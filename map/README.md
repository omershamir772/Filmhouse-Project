# FilmHouse World Map

An interactive 3D globe of film schools, cinematheques and film festivals, built with React, TypeScript, Tailwind CSS and [`react-globe.gl`](https://github.com/vasturiano/react-globe.gl). The Express app serves it at **`/map`**.

Country borders come from [Natural Earth](https://www.naturalearthdata.com/) via [`world-atlas`](https://github.com/topojson/world-atlas) (public domain, 1:50m) and are bundled with the app, so no map service or API key is needed.

## Run it

```bash
npm run build        # from the repo root: installs and builds into public/map
npm run dev          # then open http://localhost:3000/map
```

To work on the map alone with hot reload, run `npm run dev:map` and open the URL Vite prints. When it runs outside FilmHouse it acts as a signed-in demo user.

## Files

| Path | What it does |
| --- | --- |
| `src/types/map.ts` | `MapLocation` and related types: the shape the future API returns |
| `src/data/mockLocations.ts` | Seed dataset (39 places across 3 categories) |
| `src/lib/api.ts` | `fetchLocations()` / `submitLocation()`: the only place to change when going live |
| `src/components/WorldMap.tsx` | Globe, borders, graticule, labels, pins, camera, fly-to, idle rotation |
| `src/components/LocationDrawer.tsx` | Slide-over detail card for the selected pin |
| `src/components/AddLocationModal.tsx` | Community "Add to Map" form (submissions start as `pending`) |
| `src/components/FilterBar.tsx`, `SearchBox.tsx` | Category pills and search for places and countries |
| `src/lib/labels.ts` | Country-label placement: zoom budget, back-side culling, collision avoidance |
| `src/lib/geo.ts` | Loads borders and computes label anchors and areas |
| `src/index.css` | **Theme:** every colour is a CSS variable at the top of this file |

## Re-theming

Change the variables in `src/index.css` (`--map-bg`, `--map-globe`, `--map-border`, the pin colours, …). The Tailwind classes (`bg-map-bg`, `text-map-muted`, …) and the WebGL globe both read the same variables.

## Going live with real data

1. Add `GET /api/map/locations` (approved places, plus the viewer's own pending ones) and `POST /api/map/locations` (creates a `pending` row) to the Express app, and an approval queue on `/admin`.
2. Replace the bodies of `fetchLocations()` and `submitLocation()` in `src/lib/api.ts` with `fetch` calls. No component changes are needed.
3. Fill `connectedMembersCount` and `activeGigsCount` from the profiles (`users.school`, `users.location`) and the Bulletin Board (`board_posts.location`).

The statuses, deadlines and counts in the seed data are samples. Verify them before launch.
