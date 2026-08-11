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
i18n → api → geolocation → finder → map → ui → notifications → router → analytics → pwa → app
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
| `js/analytics.js` | `stationAnalytics` | Local-only usage history: folds every poll into `localStorage` (`nur-analytics-v1`), derives trend/hour-of-day/per-station availability, and renders the Analytics modal |
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
- `vercel.json` — deploy config: `cleanUrls`, security headers (HSTS, `X-Frame-Options: DENY`, `nosniff`, geolocation-only `Permissions-Policy`), and per-path `Cache-Control` tiers. **CSS and JS must stay `max-age=0, must-revalidate`**: their filenames are not fingerprinted, so any real max-age lets a browser pair week-old CSS/JS with fresh HTML — the service worker cannot help, since its own `fetch()` also goes through the HTTP cache. Revalidation is a cheap 304 thanks to ETags. Only images/fonts carry a long `immutable` cache.

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
- Connector `status` has **three** values in the feed: `Available`, `Charging`, `Start charging` — hence `isAvailable` / `isCharging` / `isStarting`. Treating `Start charging` as plain "occupied" hides the longest wait.
- `connector_capacity` is reported as e.g. `"120W"` but the value is **kilowatts**; use `capacityKw` and render it with the `kwUnit` key. `capacityWatts` is a legacy alias holding the same kW number.
- The "fast" filter uses `capacityKw >= 100`, because the feed also carries 118/122/123 kW units that belong with the 120s.

## Pages

- `index.html` — main map app; loads all `js/` modules (see load order above)
- `analysis.html` — standalone analytics page. Fully self-contained: all logic lives in a single inline `<script>`; loads **no** `js/` modules and shares no state with `index.html`

## Design System — Apple HIG for Web

This project follows Apple Human Interface Guidelines adapted for web.
Use the `apple-design` skill for all UI decisions.

### Framework translation rules
When the skill references iOS/mobile patterns, translate to web:
- Safe areas → CSS `env(safe-area-inset-*)` + responsive breakpoints
- Touch targets (44×44pt minimum) → `min-height: 44px` for buttons
- Haptics → CSS transitions + subtle micro-animations
- Native modals → dialog elements with backdrop blur
- Tab bars → bottom nav on mobile / top nav on desktop
- SF Pro → `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`

### Non-negotiable rules
- Follow Apple's 8pt spacing grid (8, 16, 24, 32, 48, 64px)
- Use system colors with light + dark mode variables from day one
- Typography scale: 11 / 13 / 15 / 17 / 22 / 28 / 34 / 41
- All interactive elements have hover + focus + active states
- Corner radius follows Apple's continuous curve pattern
- Animation duration: 200-400ms with cubic-bezier(0.4, 0, 0.2, 1)

### Liquid Glass
When user asks for glass/frosted effects → invoke the `liquid-glass.md`
reference from the skill. Use CSS `backdrop-filter: blur() saturate()`
with 0.6-0.8 opacity backgrounds.

**The app already has one material system — extend it, never invent a
second.** Everything glass in `css/style.css` comes from these tokens:

| Token | Use |
|-------|-----|
| `--mat-thin` / `--mat-regular` / `--mat-thick` | surface fills; three tiers differ in **blur radius only**, saturation is 180% everywhere |
| `--mat-blur-thin` (20px) / `--mat-blur-reg` (30px) / `--mat-blur-thick` (44px) | the matching `backdrop-filter` values — never write a raw `blur()` |
| `--surface-panel` | the sidebar alone; large panes get opacity, not more blur |
| `--edge-rim` / `--edge-rim-lit` + `--rim-shadow` / `--rim-shadow-sm` | how a pane is lit: bright top edge, shaded bottom, hairline ring. Panes use these **instead of `border`** |
| `--edge-glass` / `--edge-glass-lit` | the same idea for filled/tinted *controls* (FAB, toasts, install) |
| `--tint-volt` / `--tint-cyan` / `--tint-coral` | colour arrives as light through glass, never as paint |

Both `:root` and `:root[data-theme="light"]` define every one of them —
add light values in the same commit or the surface goes black on light.

**Selection is a lens.** The tab bar (`.tabbar-lens`) and both segmented
controls (`.seg-indicator`) share one moving piece of glass: a positioner
element that JS translates, wrapping a `.lens-body` that carries the
nested `backdrop-filter`, the rim, a specular sweep and a prism rim that
fades in only while travelling. Motion is `--lens-travel` (560ms) on
`--nav-spring`, with a `scale(1.10, 0.88)` stretch and `--lens-skew` set
from the direction of travel. Adding a third selectable control means
reusing `.lens-body` and calling the same JS, not writing a new indicator.

### Workflow
When user asks for UI work, follow this order:
1. Consult SKILL.md for the review methodology
2. Load relevant references from references/hig/ for the topic
3. Generate web-appropriate code (React/Vue/vanilla HTML+CSS)
4. Suggest a design review before shipping
