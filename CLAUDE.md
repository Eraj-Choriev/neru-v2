# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NerU v2 (current display name **NŪR** — see `manifest.webmanifest`, `index.html` meta/logo; the repo directory and git history retain "NerU v2") is a static, no-build frontend web app for locating EV charging stations in Dushanbe, Tajikistan. It is plain HTML/CSS/JS with no framework, bundler, or package manager — open `index.html` directly in a browser or serve it with any static server. It ships as an installable PWA (service worker + manifest) and deploys to Vercel.

```bash
# Serve locally (Python)
python3 -m http.server 8080

# Or with Node
npx serve .
```

There are no build steps, no tests, and no lint configuration.

## Architecture

All modules are loaded as plain `<script>` tags in `index.html`. **Load order matters** — each module depends on the ones before it. Leaflet + `leaflet.markercluster` load first from CDN, then the local modules (`index.html:297–305`):

```
i18n → api → geolocation → finder → map → ui → notifications → router → pwa → app
```

Each module exposes a single global singleton:

| File | Singleton | Responsibility |
|------|-----------|----------------|
| `js/i18n.js` | `i18n` | TJ/RU/EN translations; `data-i18n` DOM attribute updates |
| `js/api.js` | `stationAPI` | Fetch from `api.parking.dc.tj` with CORS proxy fallback; station normalization; also exports `chargingEta()` |
| `js/geolocation.js` | `geoLocation` | Browser geolocation wrapper; Haversine distance helpers (`GeoLocation.distanceBetween`, `GeoLocation.formatDistance`) |
| `js/finder.js` | `stationFinder` | Nearest-station sorting (by distance or weighted score) |
| `js/map.js` | `stationMap` | Leaflet map init, marker rendering, popups, highlight/route (`drawOSRMRoute`), theme swap |
| `js/ui.js` | `ui` | Sidebar, filter segmented controls, stats bar, toast, theme toggle, route panel; also exports `parseSchedule()` and `walkingEta()` |
| `js/notifications.js` | `stationNotifications` | Web Notifications API; fires on busy→free transitions within radius |
| `js/router.js` | `stationRouter` | In-app driving routes via OSRM (`router.project-osrm.org`); `routeTo(station)` draws route + panel, `refreshFromCurrent()` live re-routes as the user moves |
| `js/pwa.js` | *(IIFE, no singleton)* | Registers `/sw.js`; drives the `#install-btn` install flow with per-browser hints (handles the iOS-Safari-only PWA install caveat) |
| `js/app.js` | `app` | Boot controller; wires all modules together; 30s station auto-refresh; ~12s live re-route while a route is active |

`js/siwtcher.js` is a standalone anti-FOUC theme initializer (reads `neru-theme` from localStorage and sets `data-theme` before paint). Its content is **inlined** in the `index.html` `<head>` (`index.html:27`); the file itself is not loaded via `<script src>`.

## Key Data Flow

1. `app.init()` → `stationAPI.fetchStations()` hits `https://api.parking.dc.tj/api/v1/getMarkerPower`
2. API tries direct fetch first, then CORS proxies (`corsproxy.io`, `allorigins.win`) in sequence
3. Raw response is normalized via `stationAPI.normalizeStation()` into a consistent station object
4. `stationMap.renderStations()` places Leaflet markers clustered via `leaflet.markercluster`
5. "Find Nearest" FAB dispatches a `findNearest` custom event → `app.handleFindNearest()` → `stationFinder.findNearestStations()` → `ui.openSidebar()`
6. Inter-module communication uses `window.dispatchEvent(new CustomEvent(...))` for: `findNearest`, `filterChanged`, `langchange`, `themechange`, `stationsLoaded`, `stationsError`
7. Stations auto-refresh every 30s (`REFRESH_MS`, `js/app.js:8`). While a route is active, the app re-routes from the user's current position roughly every 12s (`js/app.js:238` → `stationRouter.refreshFromCurrent()`) so the driving route tracks live movement.

## PWA & Deployment

- `sw.js` — service worker, cache `nur-shell-v1`. App shell (HTML/CSS/JS/logo/manifest) is **cache-first** with background update; **network-only** (never cached) for `parking.dc.tj`, the CORS proxies, `router.project-osrm.org`, CARTO basemaps, and `cloudflareinsights.com`. When editing the module list, keep `sw.js`'s `SHELL` array in sync with the `<script>` tags in `index.html`.
- `manifest.webmanifest` — standalone, portrait, `logo.png` icons, `lang: tj`, theme/background `#05070d`.
- `vercel.json` — deploy config: `cleanUrls`, security headers (HSTS, `X-Frame-Options: DENY`, `nosniff`, geolocation-only `Permissions-Policy`), and per-path `Cache-Control` tiers (long-lived for assets, `max-age=0` for HTML and `sw.js`).

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

- `index.html` — main map app; loads all `js/` modules (see load order above)
- `analysis.html` — standalone analytics page. Fully self-contained: all logic lives in a single inline `<script>`; loads **no** `js/` modules and shares no state with `index.html`
