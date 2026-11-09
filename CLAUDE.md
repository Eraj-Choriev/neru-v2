# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NerU v2 (current display name **NŪR** — see `manifest.webmanifest`, `index.html` meta/logo; the repo directory and git history retain "NerU v2") is a static, no-build frontend web app for drivers in Dushanbe, Tajikistan. It has two map modes, switched by `#map-mode-seg`: **EV charging stations** (live connector status) and **paid kerbside parking zones** (static list, plus a geofenced parking timer). It is plain HTML/CSS/JS with no framework, bundler, or package manager — serve it with any static server. It ships as an installable PWA (service worker + manifest) and deploys to Vercel.

```bash
# One-time: API keys live in .env (git-ignored), never in source
cp .env.example .env   # then fill in NUR_2GIS_KEY (required), NUR_CF_BEACON_TOKEN (optional)

# Generate js/config.js from .env — required before the map can load
node scripts/build-config.mjs

# Serve locally (Python)
python3 -m http.server 8080

# Or with Node
npx serve .

# Run the tests (Node ≥ 18 built-in runner; no dependencies to install).
# Pass the files, not the directory — `node --test tests/` fails to resolve.
node --test tests/*.cjs

# Run a single test by name
node --test --test-name-pattern="latest destination wins" tests/regression.cjs
```

The only build step is `scripts/build-config.mjs` (see *Secrets & config* below); there is no bundler and no lint configuration. Tests (`tests/*.cjs`) load the browser scripts into a `node:vm` context with hand-rolled stubs (`fetch`, `mapgl`, `i18n`, DOM fragments) — there is no jsdom. `tests/regression.cjs` covers API/router/schedule/SW invariants; `tests/mapgl.cjs` covers `js/map.js` against a fake `mapgl`; `tests/parking.cjs` covers the parking meter (paid-window billing, geofence entry/exit, history) with a fake clock. One regression test asserts every local `js/`/`css/` URL in `index.html` appears in `sw.js`'s `SHELL`.

## Architecture

All modules are loaded as plain `<script>` tags at the bottom of `index.html`. **Load order matters** — each module depends on the ones before it. The 2GIS MapGL loader and `@2gis/mapgl-clusterer` load from CDN just before `map-config.js`:

```
i18n → api → parking → geolocation → finder → [2GIS mapgl + clusterer] → config → map → ui → notifications → router → analytics → parking-session → pwa → glass → app
```

Each module exposes a global singleton:

| File | Singleton | Responsibility |
|------|-----------|----------------|
| `js/i18n.js` | `i18n` | TJ/RU/EN translations; `data-i18n` DOM attribute updates |
| `js/api.js` | `stationAPI` | Charger feed from `api.parking.dc.tj` — direct fetch and CORS proxy are **raced** (`Promise.any`), losers aborted; concurrent callers share one in-flight promise; on failure keeps the last good snapshot and `lastFetch`. Station normalization; also exports `chargingEta()` |
| `js/parking.js` | `parkingAPI` | Paid-parking zones (`getMarkerParking`, ~243 static strips). Fetched once, cached 24h in `localStorage` (`nur-parking-v1`) — not part of the 30s refresh. Holds the `PARKING` constants (tariff, free minutes, fine indicator, SMS/support numbers) that timer, popups and rules sheet all share |
| `js/geolocation.js` | `geoLocation` | Browser geolocation wrapper; Haversine distance helpers (`GeoLocation.distanceBetween`, `GeoLocation.formatDistance`) |
| `js/finder.js` | `stationFinder` | Nearest-station sorting (by distance or weighted score) |
| `js/config.js` | `window.NUR_MAP_CONFIG`, `window.NUR_ANALYTICS_TOKEN` | **Generated** by `scripts/build-config.mjs`: 2GIS key + default center, Cloudflare beacon token. Temporarily **committed** (see *Secrets & config*); never hand-edit it |
| `js/map.js` | `stationMap` | 2GIS MapGL map: two clusterers (stations / parking), parking strips as polylines, the group "spider", cards, route line (`drawOSRMRoute`) |
| `js/glass.js` | `liquidGlass` | Edge refraction for the glass chrome (port of Glisse, MIT): draws a displacement map per `[data-glass]` element and sets `--glass-refract: url(#…)`. Chromium only; elsewhere it does nothing and the CSS blur stands alone. `app.init()` calls `liquidGlass.attach()` after the map exists |
| `js/ui.js` | `ui` | Sidebar, filter segmented controls, stats bar (`setStatsMode('ev'\|'parking')`), toast, route panel, lens indicator (`moveIndicator`); also exports `parseSchedule()` and `walkingEta()` |
| `js/notifications.js` | `stationNotifications` | Web Notifications API; fires on busy→free transitions within radius |
| `js/router.js` | `stationRouter` | In-app driving routes via OSRM (`router.project-osrm.org`); `routeTo(station)` draws route + panel, `refreshFromCurrent()` live re-routes. Stale responses are discarded: the latest destination always wins, and `clear()` cannot be undone by a late reply |
| `js/analytics.js` | `stationAnalytics` | Local-only usage history: folds every poll into `localStorage` (`nur-analytics-v1`), derives trend/hour-of-day/per-station availability, and renders the Analytics modal |
| `js/parking-session.js` | `parkingSession`, `parkingVoice`, `parkingHistory`, `parkingRules` | Geofenced parking meter. When the car stays put ≤25m from a strip for 60s (anchor drift ≤30m, so jams and short red lights don't count) it **asks** — card, OS notification with Start/Not-now buttons (relayed by `sw.js` as a `pk-action` message), voice. Accepting **backdates the start to arrival** (free 10 min run from entry). Billing (`compute`, `pkPaidMs`) follows the operator's rule: leave within 10 min → free; otherwise whole hours **counted from entry** (11 min = 3 TJS, 61 min = 6 TJS — the 10 minutes are not deducted), and only time inside the zone's paid window on Dushanbe time (UTC+5) counts, so the free/paid state is dynamic. Ends `LEAVE_MS` after leaving, billed to the moment of leaving. Persisted in `nur-parking-session-v1`; manual start from the zone card (`parkingStartRequest`). `parkingVoice` = Web Speech alerts (`nur-voice-v1`; only while visible; Tajik speaks the Russian phrase — no tg voice exists; iOS unlocked by first tap). `parkingHistory` = finished sessions in `nur-parking-history-v1`, rendered into the Analytics sheet in parking mode (tab reads "History"). `parkingRules` is the rules/fines modal. Only runs while the page is open |
| `js/pwa.js` | *(IIFE, no singleton)* | Registers `/sw.js`; drives the `#install-btn` install flow with per-browser hints (handles the iOS-Safari-only PWA install caveat) |
| `js/app.js` | `app` | Boot controller; wires all modules together; location consent gate (`neru-loc-consent`); 30s station auto-refresh (also on `visibilitychange`/`online`); adaptive live re-route while a route is active |

**Coordinates:** the app uses `[lat, lng]` everywhere internally; `js/map.js` converts to MapGL's `[lng, lat]` at the SDK boundary. Keep that conversion in one place.

**Station spider** (`_openGroup` / `_spiderLayout` / `_closeSpider` in `js/map.js`): tapping a cluster of ≤20 opens its stations as a web around it. The hub is drawn exactly over the WebGL cluster — use the clusterer's own `cluster.clusters.get(id).coordinates`, never the tap's `lngLat` — at the same 43px size and colour, so the two read as one circle. If the web would not fit between the header and the dock the **map pans** and the web opens on `moveend`; the hub is never shifted off its cluster (that was the "two circles" bug). Layout: one ring up to ~14, two rings when that is ≥10px smaller, ring capacity by chord (not arc), markers 36→32→28px as space requires. Motion is WAAPI transform/opacity only.

**Theme:** the app is **light-only**. `index.html` hard-codes `data-theme="light"`. There is no theme toggle and no `themechange` event any more.

## Secrets & config

- **Current, temporary state:** the Vercel project has no environment variables yet, so `js/config.js` is committed with the current keys and deploys use it as is. The owner chose this on 2026-11-06 to see changes deployed; the target is the env-only setup below.
- Target setup: keys live only in `.env` (local, git-ignored, also in `.vercelignore`) and in Vercel → Project Settings → Environment Variables (Production **and** Preview). `.env.example` documents the names: `NUR_2GIS_KEY` (required), `NUR_CF_BEACON_TOKEN` (optional; empty disables analytics). To finish the move: add both variables in Vercel, rotate the 2GIS key, then `git rm --cached js/config.js` and add `js/config.js` back to `.gitignore`.
- `vercel.json` runs `node scripts/build-config.mjs` as `buildCommand` (`outputDirectory: "."`). With `NUR_2GIS_KEY` set it regenerates `js/config.js` (env wins over the committed file); without it, it keeps the committed file; with neither, or with a malformed key, it **exits 1**, so a broken deploy fails and Vercel keeps the previous one live.
- Both values still reach the browser — that is inherent to a browser map key and a web-analytics beacon. Their real protection is the Referer allow-list in the 2GIS Platform Manager and Cloudflare's site binding. Never put a true server-side secret in `config.js`; that would need a serverless function.
- Third-party scripts with a pinned version carry SRI (`integrity` + `crossorigin`). When bumping `@2gis/mapgl-clusterer`, recompute: `curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A`. The 2GIS loader (`mapgl.2gis.com/api/js/v1`) is unversioned, so it cannot have SRI.

## Key Data Flow

1. `app.init()` → `ui.init()`, `stationMap.init('map')`, then `loadParking()` (fire-and-forget) and `await loadStations()` — the two feeds are independent so a slow charger API never delays parking.
2. `stationAPI.fetchStations()` hits `https://api.parking.dc.tj/api/v1/getMarkerPower`, racing direct vs. `api.allorigins.win`.
3. Raw response is normalized via `stationAPI.normalizeStation()` (invalid coordinates → `null`, dropped).
4. `stationMap.renderStations()` loads markers into the 2GIS clusterer; identical snapshots skip the reload.
5. "Find Nearest" dispatches `findNearest` → `app.handleFindNearest()` → `stationFinder.findNearestStations()` → `ui.openSidebar()`.
6. Inter-module events (`window.dispatchEvent(new CustomEvent(...))`): `findNearest`, `filterChanged`, `langchange`, `stationsLoaded`, `stationsError`, `parkingLoaded`, `parkingError`, `parkingRulesRequest`, `parkingStartRequest`, `routeRequest`, `popupClosed`.
7. A route request (`app.handleRouteRequest`) locates the user if needed and **always starts live tracking** before routing — otherwise a user who found a station via "find nearest" without startup consent got a route that never moved, re-routed or announced arrival. On success the routed station's card closes (the route panel names it).
8. Stations auto-refresh every 30s (`REFRESH_MS`, `js/app.js`). While a route is active, `app` watches GPS and calls `stationRouter.refreshFromCurrent()` when the user drifts off the line or has moved enough — never more often than 6s, at least every 20s (`MIN_REROUTE_MS` / `MAX_REROUTE_MS`).

## PWA & Deployment

- **Cache-busting:** every local CSS/JS URL in `index.html` carries `?v=N`, and `sw.js` has a matching `CACHE = 'nur-shell-vN'` and the same `?v=N` URLs in `SHELL`. When shipping a change to CSS/JS, bump the version in **all three places together** (the regression test catches a missing `SHELL` entry, not a mismatched number).
- `sw.js` — HTML/CSS/JS are **network-first** with cache fallback (cache-first served stale CSS against fresh HTML on mobile); images/fonts cache-first. **Network-only** for 2GIS domains, `parking.dc.tj`, `allorigins.win`, `router.project-osrm.org` and `cloudflareinsights.com`. Also handles `notificationclick` (needed for installed Android PWAs). When editing the module list, keep `SHELL` in sync with the `<script>` tags in `index.html`.
- `manifest.webmanifest` — standalone, portrait, `logo.png` icons, `lang: tj`, theme/background `#05070d`.
- `vercel.json` — deploy config: `cleanUrls`, security headers (HSTS, `X-Frame-Options: DENY`, `nosniff`, geolocation-only `Permissions-Policy`), and per-path `Cache-Control` tiers. **CSS and JS must stay `max-age=0, must-revalidate`**: their filenames are not fingerprinted, so any real max-age lets a browser pair week-old CSS/JS with fresh HTML — the service worker cannot help, since its own `fetch()` also goes through the HTTP cache. Revalidation is a cheap 304 thanks to ETags. Only images/fonts carry a long `immutable` cache.

## Localization

- Three languages: Tajik (`tj`, default), Russian (`ru`), English (`en`)
- Add new keys to all three translation objects in `js/i18n.js`
- HTML elements use `data-i18n="key"` for text, `data-i18n-placeholder="key"` for placeholders, `data-i18n-title="key"` for titles
- Language preference stored in `localStorage` key `neru_lang`

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
- `analysis.html` — standalone analytics page. Self-contained: all logic lives in a single inline `<script>`; loads only `js/config.js` (for the analytics token) and shares no state with `index.html`

## Performance rules

- Animations that run forever (live dots, pulses) animate only `transform`/`opacity` on a pseudo-element. Animating `box-shadow`/`filter` repaints on the main thread every frame and re-composites the glass (`backdrop-filter`) behind it.
- Work driven by MapGL's `move` event goes through `requestAnimationFrame` (see `_schedulePositionCard`) and must not read layout after writing styles.
- Refraction (`data-glass`) only on elements whose size is stable. A lens, a thumb or anything whose size animates must not get it — the map is drawn for one size and smears at another.
- Testing routes in the cloud sandbox: its proxy rejects browser URLs containing `;`, which every OSRM route URL has (`lng,lat;lng,lat`) — the browser sees a CORS failure. Production is unaffected (OSRM sends `Access-Control-Allow-Origin: *`). In Playwright, fulfil `**/router.project-osrm.org/**` with the same URL fetched by `curl`.
- Do not rebuild WebGL objects (`mapgl.Circle`, `Polyline`) when their inputs did not change; compare a cheap key first.
- Images ship at no more than ~2× their largest rendered size. `logo.png` is 768×512 — keep the 3:2 canvas, the CSS crops the wordmark from it.

## Docs

`docs/` holds dated design and engineering notes (excluded from Vercel deploys via `.vercelignore`). Most useful before touching related code: `review-2026-11-05.md` (latest security/performance audit and open items), `map-provider.md` (2GIS integration decisions), `api-audit-2026-10-28.md` + `api-baseline-*.json` (feed quirks), `liquid-glass.md` (the Glisse port: what was taken, what was not, and why), `DESIGN.md` (native-app design brief for Stitch — deliberately differs from the web house style).

`AGENTS.md` is a copy of this file for other coding agents; keep the two in sync.

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

Both `:root` (legacy dark values) and `:root[data-theme="light"]` define
every one of them. Because the app is now light-only, the
`[data-theme="light"]` block is what actually renders — a token defined only
in `:root` will show its dark value. Always add the light value in the same
commit.

**Chrome glass (Liquid Glass layer).** Navigation chrome — header isles,
`.map-stats`, tab bar, search/locate buttons, zoom — uses a second tier of
the same system, defined in the *LIQUID GLASS* block at the very end of
`css/style.css` and scoped under `body.lg`. It is a port of Glisse
(github.com/0kzh/glisse, MIT): clear glass with little frost, bent at the rim
by `js/glass.js`. Content panes (cards, sheets, modals) stay on `--mat-*`.

| Token | Use |
|-------|-----|
| `--glass-fill` / `--glass-fill-pressed` | clear glass fill at rest / pressed |
| `--glass-blur` | its `backdrop-filter`; always write `var(--glass-blur) var(--glass-refract,)` so Chromium adds refraction |
| `--glass-rim` + `--glass-drop` | light along one axis (top-left and bottom-right edges) + hairline, and the shadow that separates white glass from a pale map |
| `--glass-ink` / `--glass-ink-2` | labels and icons on glass |
| `--glass-selection` | the tab bar's grey selection pill |
| `--glass-track` / `--glass-thumb` / `--glass-thumb-shadow` | segmented control track and white thumb (iOS) |
| `--glass-lens` / `--glass-lens-drop` | a lifted (held) lens |
| `--glass-accent` | selected tab tint; brand green, parking blue on `body[data-mode="parking"]` |
| `--switch-off` / `--switch-on` | switch track |
| `--glass-sheet` / `--glass-sheet-blur` / `--glass-scrim` | sheets opened from the chrome (Analytics): glass the map reads through, over a light dim — no full-screen blur. A sheet must scroll **inside itself** (`max-height: 100%; overflow-y: auto`): a sheet taller than the viewport loses its backdrop blur. On phones it ends above the tab bar, which stays live (tapping another tab closes it) |
| `--spring-select` / `-lift` / `-switch` / `-press` (+ `-ms`) | Glisse's springs sampled into CSS `linear()` — use these, not new cubic-beziers |

Top and bottom chrome must read as one material: the header has no band or fade of its own (only a solid strip inside a notch's safe area), so isles sit on the map exactly as the tab bar does. The header Analytics button is a tinted pill with its label (icon-only ≤1099px, hidden wherever the tab bar shows). At 769–900px the header tightens its controls rather than letting the isles overlap.

The rest of the old nav cascade is overridden, not deleted: when changing the
chrome, edit this block. Its selectors start with `:root[data-theme] body.lg`
so they outrank the earlier passes (some reach `(1,5,0)`).

**Selection is a lens.** The tab bar (`.tabbar-lens`) and every segmented
control (`.seg-indicator`) share one moving piece of glass: a positioner
that JS translates, wrapping a `.lens-body`. At rest it is iOS's grey pill
(tab bar) or white thumb (segmented). `ui.bindLensPress()` moves it under the
finger on press and adds `.is-held`, which lifts it into a clear lens —
grown by Glisse's 24×16px via `--lift-x`/`--lift-y` (a scale, set by
`_setLift()` from the lens box) — and re-syncs it with the real selection
after the click. Dragging (`.is-dragging`) uses the same lifted look. Travel
is `--spring-select` (260ms) with only a hint of stretch. Adding a selectable
control means reusing `.lens-body` and `bindLensPress`, not a new indicator.

### Workflow
When user asks for UI work, follow this order:
1. Consult SKILL.md for the review methodology
2. Load relevant references from references/hig/ for the topic
3. Generate web-appropriate code (React/Vue/vanilla HTML+CSS)
4. Suggest a design review before shipping
