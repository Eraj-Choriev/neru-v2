

class StationFinder {
  constructor() {
    this.results = [];
  }

  
  findBestStations(stations, userLat, userLng, limit = 5) {
    if (!stations || stations.length === 0) return [];

    const scored = stations.map(station => {
      const distance = GeoLocation.distanceBetween(
        userLat, userLng, station.lat, station.lng
      );

      // Availability weight
      let availabilityWeight = 0.3;
      let statusTag = 'busy';
      if (station.hasAvailable) {
        availabilityWeight = 2.0;
        statusTag = 'freeNow';
      } else if (station.maxChargeLevel >= 80) {
        availabilityWeight = 1.0;
        statusTag = 'soonFree';
      }

      // Capacity bonus
      const capacityBonus = station.capacityWatts >= 120 ? 1.2 : 1.0;

      // Final score (avoid division by zero)
      const distanceFactor = distance > 0.01 ? (1 / distance) : 100;
      const score = distanceFactor * availabilityWeight * capacityBonus;

      return {
        ...station,
        distance,
        distanceFormatted: GeoLocation.formatDistance(distance),
        score,
        statusTag,
        availabilityWeight,
      };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    this.results = scored.slice(0, limit);
    return this.results;
  }

  /**
   * Get stations sorted purely by distance
   */
  findNearestStations(stations, userLat, userLng, limit = 10) {
    if (!stations || stations.length === 0) return [];

    this.results = stations
      .map(station => {
        const distance = GeoLocation.distanceBetween(userLat, userLng, station.lat, station.lng);
        return {
          ...station,
          distance,
          distanceFormatted: GeoLocation.formatDistance(distance),
          statusTag: station.hasAvailable ? 'freeNow' : (station.maxChargeLevel >= 80 ? 'soonFree' : 'busy'),
        };
      })
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);

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
