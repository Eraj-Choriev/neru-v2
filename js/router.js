// ============================================
// NerU v2 — In-App Routing (OSRM)
// ============================================

class StationRouter {
  constructor() {
    this.activeRoute = null;
    this._generation = 0;
    this._OSRM = 'https://router.project-osrm.org/route/v1/driving';
    this._TABLE = 'https://router.project-osrm.org/table/v1/driving';
  }

  async routeTo(station, connector = null) {
    const pos = geoLocation.getPosition();
    if (!pos.isLocated) {
      ui.showToast(i18n.t('locationDenied'), 'warning', 3000);
      return;
    }

    const generation = ++this._generation;
    const wasActive = !!this.activeRoute;
    ui.showToast(i18n.t('routeBuilding'), 'info', 2500);

    try {
      const data = await this._fetch(pos.lat, pos.lng, station.lat, station.lng);
      if (generation !== this._generation) return;
      const route = data.routes[0];
      const targetConnector = connector ||
        (typeof stationFinder !== 'undefined' ? stationFinder.getRecommendedConnector(station) : null);
      // App routes stay [lat, lng]; the map converts at the SDK boundary.
      const coords = this._coordinates(route, station);

      this.activeRoute = {
        station,
        connector: targetConnector,
        connectorId: targetConnector?.id == null ? null : String(targetConnector.id),
        coords,
        cumulativeMeters: typeof GeoLocation !== 'undefined' ? this._cumulativeMeters(coords) : [],
        progressMeters: 0,
        distance: route.distance,
        duration: route.duration,
        secPerMeter: route.distance > 0 ? route.duration / route.distance : 0,
      };

      stationMap.drawOSRMRoute(coords, station);
      ui.showRoutePanel(station, {
        distance: route.distance,
        duration: route.duration,
        connectorId: this.activeRoute.connectorId,
      });
      ui.showToast(i18n.t(wasActive ? 'routeUpdated' : 'routeReady'), 'success', 2500);
    } catch (e) {
      if (generation !== this._generation) return;
      ui.showToast(i18n.t('routeError'), 'error', 4000);
    }
  }

  /**
   * Re-route from current user location (used by live tracking)
   */
  async refreshFromCurrent() {
    if (!this.activeRoute || this._refreshing) return;
    const active = this.activeRoute;
    const generation = this._generation;
    const pos = geoLocation.getPosition();
    if (!pos.isLocated) return;
    this._refreshing = true;
    try {
      const data = await this._fetch(pos.lat, pos.lng, active.station.lat, active.station.lng);
      if (generation !== this._generation || active !== this.activeRoute) return;
      const route = data.routes[0];
      const coords = this._coordinates(route, active.station);
      this.activeRoute.coords = coords;
      this.activeRoute.cumulativeMeters = this._cumulativeMeters(coords);
      this.activeRoute.progressMeters = 0;
      this.activeRoute.distance = route.distance;
      this.activeRoute.duration = route.duration;
      this.activeRoute.secPerMeter = route.distance > 0 ? route.duration / route.distance : 0;
      stationMap.drawOSRMRoute(coords, this.activeRoute.station, false); // keep follow view; don't refit
      ui.showRoutePanel(this.activeRoute.station, {
        distance: route.distance,
        duration: route.duration,
        connectorId: this.activeRoute.connectorId,
      });
    } catch (_) {
      /* silent — keep last route on transient errors */
    } finally {
      this._refreshing = false;
    }
  }

  _coordinates(route, station) {
    const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    // OSRM ends at the nearest road, which can be short of the station pin.
    if (coords.length) coords.push([station.lat, station.lng]);
    return coords;
  }

  /**
   * One OSRM Table request compares the road travel time to a small nearby
   * candidate set. If that public service is unavailable, callers keep the
   * fast local distance order and the route itself still works independently.
   */
  async rankByDriveTime(origin, stations) {
    if (!origin?.isLocated || !Array.isArray(stations) || stations.length < 2) return stations;

    const points = [
      [origin.lng, origin.lat],
      ...stations.map((station) => [station.lng, station.lat]),
    ];
    const coordinates = points.map(([lng, lat]) => `${lng},${lat}`).join(';');
    const destinations = stations.map((_, index) => index + 1).join(';');
    const url = `${this._TABLE}/${coordinates}?sources=0&destinations=${destinations}&annotations=duration,distance`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const durations = data?.durations?.[0];
      const distances = data?.distances?.[0];
      if (data?.code !== 'Ok' || !Array.isArray(durations) || durations.length !== stations.length) {
        throw new Error('No drive-time matrix');
      }

      return stations
        .map((station, index) => ({
          ...station,
          driveDuration: Number.isFinite(durations[index]) ? durations[index] : null,
          driveDistance: Number.isFinite(distances?.[index]) ? distances[index] : null,
        }))
        .sort((a, b) => {
          const aTime = a.driveDuration ?? Infinity;
          const bTime = b.driveDuration ?? Infinity;
          return aTime - bTime || a.distance - b.distance;
        });
    } finally {
      clearTimeout(timeout);
    }
  }

  async _fetch(lat1, lng1, lat2, lng2) {
    const url = `${this._OSRM}/${lng1},${lat1};${lng2},${lat2}?overview=full&geometries=geojson`;
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route');
      return data;
    } finally {
      clearTimeout(timeout);
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
    ui.showRoutePanel(this.activeRoute.station, {
      distance: rem,
      duration: dur,
      connectorId: this.activeRoute.connectorId,
    });
  }

  /** Perpendicular distance (metres) from a point to the route polyline. */
  distanceToRoute(lat, lng) {
    const n = this._nearest(lat, lng);
    return n ? n.d : Infinity;
  }

  /** User reached the destination — clear route and celebrate. */
  arrive() {
    ++this._generation;
    const had = !!this.activeRoute;
    this.activeRoute = null;
    stationMap.clearHighlight();
    ui.hideRoutePanel();
    if (had) ui.showToast(i18n.t('routeArrived'), 'success', 5000);
  }

  clear() {
    ++this._generation;
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
    const cumulative = this.activeRoute.cumulativeMeters || this._cumulativeMeters(c);
    let best = { d: Infinity, i: 0, pt: [lat, lng], alongMeters: 0 };
    for (let i = 0; i < c.length - 1; i++) {
      const pr = this._projectToSeg(lat, lng, c[i], c[i + 1]);
      if (pr.d < best.d) {
        const alongSegment = GeoLocation.distanceBetween(c[i][0], c[i][1], pr.pt[0], pr.pt[1]) * 1000;
        best = { d: pr.d, i, pt: pr.pt, alongMeters: (cumulative[i] || 0) + alongSegment };
      }
    }
    return best;
  }

  /** Remaining metres along the route from the user's projected position. */
  _remainingMeters(lat, lng) {
    const active = this.activeRoute;
    const c = active?.coords;
    const n = this._nearest(lat, lng);
    if (!c || !n) return null;
    const cumulative = active.cumulativeMeters || this._cumulativeMeters(c);
    const total = cumulative[cumulative.length - 1] || 0;
    const previous = active.progressMeters || 0;
    const speed = Number.isFinite(geoLocation.userSpeed) ? geoLocation.userSpeed : 4;
    const accuracy = Number.isFinite(geoLocation.userAccuracy) ? geoLocation.userAccuracy : 15;
    // Limit each fix's forward jump so a GPS snap onto a nearby parallel or
    // crossing segment cannot instantly consume a large part of the route.
    const maxForward = Math.max(35, Math.min(160, speed * 8 + accuracy));
    const candidate = n.alongMeters < previous - 25
      ? previous
      : Math.min(n.alongMeters, previous + maxForward);
    active.progressMeters = Math.min(total, Math.max(previous, candidate));
    return Math.max(0, total - active.progressMeters);
  }

  _cumulativeMeters(coords) {
    if (!Array.isArray(coords) || !coords.length) return [];
    const cumulative = [0];
    for (let i = 1; i < coords.length; i++) {
      cumulative.push(cumulative[i - 1] + GeoLocation.distanceBetween(
        coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1],
      ) * 1000);
    }
    return cumulative;
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
