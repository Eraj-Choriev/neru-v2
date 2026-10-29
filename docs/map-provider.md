# 2GIS MapGL — current integration (2026-10-28)

The app now uses the official MapGL v1 loader and clusterer 2.5.2, with
one WebGL canvas. Leaflet and MapLibre are no longer loaded.
The public browser key is in `js/map-config.js`; restrict allowed Referer
domains in the 2GIS Platform Manager to production and permitted local/preview
origins. Localhost access was verified. Production restrictions and usage
limits must be configured in the provider account.

WebGL markers are clustered and icons cached. Identical station snapshots do
not reload clusters; card details update independently without closing the
card. Hidden parking strips are destroyed, and unchanged routes reuse their
geometry. Co-located points expand into numbered markers linked to their
origin, with separated 44px targets and a compact layout in landscape.
Camera animations
honor reduced motion. Existing translated cards anchor near the selected
marker and are clamped between the header and dock. OSRM remains the routing service.

Coordinates remain [lat, lng] within the app and are converted to [lng, lat]
at the SDK boundary. Service worker v46 includes configuration and bypasses
caching for 2GIS domains. Attribution is supplied by the SDK.

Validation: 14 Node tests passed, including cluster reuse, parking cleanup,
route conversion and bounds. Browser checks covered live feeds, cards,
co-located groups, GPS accuracy, route display and 390 × 844 layout, with no
console errors/warnings in the final check. A 90-frame rAF sample during
camera movement measured 16.7 ms median / 17.2 ms p95, no intervals >50 ms
on the test computer. This is browser scheduling, not a guarantee for phones.

Reference: https://docs.2gis.com/mapgl/start/first-steps

## Previous implementation (historical)

The light-only basemap is OpenFreeMap Positron:
https://tiles.openfreemap.org/styles/positron

MapLibre GL JS 5.6.2 renders vector tiles through the official
@maplibre/maplibre-gl-leaflet 0.1.3 adapter. Leaflet still owns gestures,
station clusters, numbered expanded markers, popups, parking overlays and
OSRM routes. This is a vector basemap integration, not a replacement of the
application's Leaflet overlay API.

No token or account is needed. Keep OpenFreeMap, OpenMapTiles and
OpenStreetMap attribution visible. OpenFreeMap requests bypass service-worker
caching; map downloads and offline prefetching are not implemented.

Dependencies are pinned CDN releases, loaded after Leaflet and before map.js.
A working WebGL browser and network access to the CDN and OpenFreeMap are
required to display this basemap.

Reference: https://openfreemap.org/quick_start/
## Responsive follow-up — 2026-10-29

The app fills one fixed viewport instead of mixing dynamic viewport height
with fixed overlays. The dock, location button, zoom buttons and panels share
one clearance calculation. Safe insets are counted once. Landscape phones
retain the mobile navigation. Cards reuse the original compact typography,
spacing and material, without the extra 40px top gutter.

15 tests pass, including bounds and non-overlap for 20 expanded markers at
320×568, 414×896 and 896×414. Browser layouts were checked from 320 to 1440px,
including simulated 44px top / 34px bottom insets. Actual iOS standalone
safe-area behavior still needs confirmation on the user's phone.

