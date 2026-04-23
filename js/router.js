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
      stationMap.drawOSRMRoute(coords, this.activeRoute.station);
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

  clear() {
    const had = !!this.activeRoute;
    this.activeRoute = null;
    stationMap.clearHighlight();
    ui.hideRoutePanel();
    if (had) ui.showToast(i18n.t('routeCleared'), 'info', 1800);
  }
}

const stationRouter = new StationRouter();
