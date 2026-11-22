// ============================================
// NŪR — Nearby available connector recommendations
// ============================================

class StationFinder {
  constructor() {
    this.results = [];
    this._connectorCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  }

  getAvailableConnectors(station) {
    return (Array.isArray(station?.connectors) ? station.connectors : [])
      .filter((connector) => connector?.isAvailable === true &&
        connector.id != null && String(connector.id).trim() !== '')
      .sort((a, b) => this._connectorCollator.compare(String(a.id), String(b.id)));
  }

  getRecommendedConnector(station) {
    const activeRoute = typeof stationRouter !== 'undefined' ? stationRouter.activeRoute : null;
    if (activeRoute && String(activeRoute.station?.id) === String(station?.id)) {
      const current = this.getAvailableConnectors(station)
        .find((connector) => String(connector.id) === String(activeRoute.connectorId));
      if (current) return current;
    }
    return this.getAvailableConnectors(station)[0] || null;
  }

  /**
   * List only stations with at least one connector whose live API status is
   * exactly Available. The connector choice is deterministic when the API
   * supplies no per-connector location: the naturally lowest available ID.
   */
  findNearestStations(stations, userLat, userLng, limit = 10) {
    if (!Array.isArray(stations) || !Number.isFinite(userLat) || !Number.isFinite(userLng)) {
      this.results = [];
      return this.results;
    }

    this.results = stations
      .map((station) => {
        const recommendedConnector = this.getRecommendedConnector(station);
        if (!recommendedConnector || !Number.isFinite(station.lat) || !Number.isFinite(station.lng)) return null;
        const distance = GeoLocation.distanceBetween(userLat, userLng, station.lat, station.lng);
        return {
          ...station,
          distance,
          distanceFormatted: GeoLocation.formatDistance(distance),
          availableConnectors: this.getAvailableConnectors(station),
          recommendedConnector,
          statusTag: 'freeNow',
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance ||
        b.availableConnectors.length - a.availableConnectors.length ||
        (b.capacityKw || 0) - (a.capacityKw || 0))
      .slice(0, limit);

    return this.results;
  }

  /**
   * Compatibility name for callers that want the best available chargers.
   * Connector availability now takes precedence over inferred charge-level
   * estimates, which are not a reliable promise that a plug will free soon.
   */
  findBestStations(stations, userLat, userLng, limit = 5) {
    return this.findNearestStations(stations, userLat, userLng, limit);
  }

  setResults(results) {
    this.results = Array.isArray(results) ? results : [];
    return this.results;
  }

  getResults() {
    return this.results;
  }

  getBestStation() {
    return this.results.length > 0 ? this.results[0] : null;
  }
}

const stationFinder = new StationFinder();
