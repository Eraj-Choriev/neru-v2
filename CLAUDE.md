# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NerU v2 is a static, no-build frontend web app for locating EV charging stations in Dushanbe, Tajikistan. It is plain HTML/CSS/JS with no framework, bundler, or package manager — open `index.html` directly in a browser or serve it with any static server.

```bash
# Serve locally (Python)
python3 -m http.server 8080

# Or with Node
npx serve .
```

There are no build steps, no tests, and no lint configuration.

## Architecture

All modules are loaded as plain `<script>` tags in `index.html`. **Load order matters** — each module depends on the ones before it:

```
i18n.js → api.js → geolocation.js → finder.js → map.js → ui.js → notifications.js → app.js
```

Each module exposes a single global singleton:

| File | Singleton | Responsibility |
|------|-----------|----------------|
| `js/i18n.js` | `i18n` | TJ/RU/EN translations; `data-i18n` DOM attribute updates |
| `js/api.js` | `stationAPI` | Fetch from `api.parking.dc.tj` with CORS proxy fallback; station normalization; also exports `chargingEta()` |
| `js/geolocation.js` | `geoLocation` | Browser geolocation wrapper; Haversine distance helpers (`GeoLocation.distanceBetween`, `GeoLocation.formatDistance`) |
| `js/finder.js` | `stationFinder` | Nearest-station sorting (by distance or weighted score) |
| `js/map.js` | `stationMap` | Leaflet map init, marker rendering, popups, highlight/route, theme swap |
| `js/ui.js` | `ui` | Sidebar, filter segmented controls, stats bar, toast, theme toggle; also exports `parseSchedule()` and `walkingEta()` |
| `js/notifications.js` | `stationNotifications` | Web Notifications API; fires on busy→free transitions within radius |
| `js/calculator.js` | `costCalculator` | Charging cost/time estimator panel (used in `analysis.html`, not `index.html`) |
| `js/app.js` | `app` | Boot controller; wires all modules together; 30-second auto-refresh |

## Key Data Flow

1. `app.init()` → `stationAPI.fetchStations()` hits `https://api.parking.dc.tj/api/v1/getMarkerPower`
2. API tries direct fetch first, then CORS proxies (`corsproxy.io`, `allorigins.win`) in sequence
3. Raw response is normalized via `stationAPI.normalizeStation()` into a consistent station object
4. `stationMap.renderStations()` places Leaflet markers clustered via `leaflet.markercluster`
5. "Find Nearest" FAB dispatches a `findNearest` custom event → `app.handleFindNearest()` → `stationFinder.findNearestStations()` → `ui.openSidebar()`
6. Inter-module communication uses `window.dispatchEvent(new CustomEvent(...))` for: `findNearest`, `filterChanged`, `langchange`, `themechange`, `stationsLoaded`, `stationsError`

## Localization

- Three languages: Tajik (`tj`, default), Russian (`ru`), English (`en`)
- Add new keys to all three translation objects in `js/i18n.js`
- HTML elements use `data-i18n="key"` for text, `data-i18n-placeholder="key"` for placeholders, `data-i18n-title="key"` for titles
- Language preference stored in `localStorage` key `neru_lang`
- Theme preference stored in `localStorage` key `neru-theme`

## Station Object Shape

After normalization, every station has:
- `id`, `name`, `address`, `lat`, `lng`
- `connectors[]` — array with `{ id, status, chargeLevel, isAvailable, isCharging }`
- `freeConnectors`, `totalConnectors`, `hasAvailable`
- `capacityWatts` (parsed int), `capacity` (display string e.g. `"120kW"`)
- `tariff`, `tariffUnit`, `schedule`, `zoneName`

## Pages

- `index.html` — main map app
- `analysis.html` — standalone analytics/calculator page; loads `js/calculator.js` and its own inline scripts; does not share state with `index.html`
