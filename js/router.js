// ============================================
// NerU v2 — In-App Routing (OSRM)
// ============================================

class StationRouter {
  constructor() {
    this.activeRoute = null;
    this._OSRM = 'https://router.project-osrm.org/route/v1/driving';
  }

  async routeTo(station) {
    const pos = geoLocation.getPosition();
    if (!pos.isLocated) {
      ui.showToast(i18n.t('locationDenied'), 'warning', 3000);
      return;
    }

    const wasActive = !!this.activeRoute;
    ui.showToast(i18n.t('routeBuilding'), 'info', 2500);

    try {
      const data = await this._fetch(pos.lat, pos.lng, station.lat, station.lng);
      const route = data.routes[0];
      // OSRM returns [lng, lat] — flip for Leaflet
      const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);

      this.activeRoute = {
        station,
        coords,
        distance: route.distance,
        duration: route.duration,
        secPerMeter: route.distance > 0 ? route.duration / route.distance : 0,
      };

      stationMap.drawOSRMRoute(coords, station);
      ui.showRoutePanel(station, { distance: route.distance, duration: route.duration });
      ui.showToast(i18n.t(wasActive ? 'routeUpdated' : 'routeReady'), 'success', 2500);
    } catch (e) {
      ui.showToast(i18n.t('routeError'), 'error', 4000);
    }
  }

  /**
   * Re-route from current user location (used by live tracking)
   */
  async refreshFromCurrent() {
    if (!this.activeRoute) return;
    const pos = geoLocation.getPosition();
    if (!pos.isLocated) return;
    try {
      const data = await this._fetch(pos.lat, pos.lng, this.activeRoute.station.lat, this.activeRoute.station.lng);
      const route = data.routes[0];
      const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      this.activeRoute.coords = coords;
      this.activeRoute.distance = route.distance;
      this.activeRoute.duration = route.duration;
      this.activeRoute.secPerMeter = route.distance > 0 ? route.duration / route.distance : 0;
      stationMap.drawOSRMRoute(coords, this.activeRoute.station, false); // keep follow view; don't refit
      ui.showRoutePanel(this.activeRoute.station, { distance: route.distance, duration: route.duration });
    } catch (_) {
      /* silent — keep last route on transient errors */
    }
  }

  async _fetch(lat1, lng1, lat2, lng2) {
    const url = `${this._OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route');
      return data;
    } catch (e) {
      clearTimeout(timeout);
      throw e;
    }
  }

  /**
   * Cheap, network-free refresh of the route panel between OSRM calls:
   * recomputes remaining distance + ETA from the user's live position
   * projected onto the existing route geometry.
   */
  updateProgress(lat, lng) {
    if (!this.activeRoute) return;
    const rem = this._remainingMeters(lat, lng);
    if (rem == null) return;
    const dur = rem * (this.activeRoute.secPerMeter || 0);
    ui.showRoutePanel(this.activeRoute.station, { distance: rem, duration: dur });
  }

  /** Perpendicular distance (metres) from a point to the route polyline. */
  distanceToRoute(lat, lng) {
    const n = this._nearest(lat, lng);
    return n ? n.d : Infinity;
  }

  /** User reached the destination — clear route and celebrate. */
  arrive() {
    const had = !!this.activeRoute;
    this.activeRoute = null;
    stationMap.clearHighlight();
    ui.hideRoutePanel();
    if (had) ui.showToast(i18n.t('routeArrived'), 'success', 5000);
  }

  clear() {
    const had = !!this.activeRoute;
    this.activeRoute = null;
    stationMap.clearHighlight();
    ui.hideRoutePanel();
    if (had) ui.showToast(i18n.t('routeCleared'), 'info', 1800);
  }

  // ---- route geometry helpers (local metre math, city-scale accurate) ----

  /** Nearest point on the route to (lat,lng): { d: metres, i: segIndex, pt } */
  _nearest(lat, lng) {
    const c = this.activeRoute?.coords;
    if (!c || c.length < 2) return null;
    let best = { d: Infinity, i: 0, pt: [lat, lng] };
    for (let i = 0; i < c.length - 1; i++) {
      const pr = this._projectToSeg(lat, lng, c[i], c[i + 1]);
      if (pr.d < best.d) best = { d: pr.d, i, pt: pr.pt };
    }
    return best;
  }

  /** Remaining metres along the route from the user's projected position. */
  _remainingMeters(lat, lng) {
    const c = this.activeRoute?.coords;
    const n = this._nearest(lat, lng);
    if (!c || !n) return null;
    let rem = GeoLocation.distanceBetween(n.pt[0], n.pt[1], c[n.i + 1][0], c[n.i + 1][1]) * 1000;
    for (let i = n.i + 1; i < c.length - 1; i++) {
      rem += GeoLocation.distanceBetween(c[i][0], c[i][1], c[i + 1][0], c[i + 1][1]) * 1000;
    }
    return rem;
  }

  /** Project a point onto segment a→b in local metres; returns distance + snapped latlng. */
  _projectToSeg(lat, lng, a, b) {
    const my = 110540, mx = 111320 * Math.cos(lat * Math.PI / 180);
    const ax = a[1] * mx, ay = a[0] * my;
    const bx = b[1] * mx, by = b[0] * my;
    const px = lng * mx, py = lat * my;
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx, cy = ay + t * dy;
    const d = Math.hypot(px - cx, py - cy);
    return { d, pt: [cy / my, cx / mx] };
  }
}

const stationRouter = new StationRouter();
