// ============================================
// NerU v2 — Geolocation Module
// ============================================

// Default: center of Dushanbe
const DEFAULT_LAT = 38.5598;
const DEFAULT_LNG = 68.7738;

class GeoLocation {
  constructor() {
    this.userLat = null;
    this.userLng = null;
    this.userAccuracy = null;   // metres
    this.userHeading = null;    // degrees (0=N, clockwise) — null when unknown
    this.userSpeed = null;      // m/s — null when unknown
    this.isLocated = false;
    this.watchId = null;
    this._watchers = new Set(); // callbacks invoked on every position update
  }
  async getUserLocation({ force = false, maxAgeMs = 30000, highAccuracy = false } = {}) {
    const now = Date.now();
    if (!force && this.isLocated && this._lastLocatedAt && (now - this._lastLocatedAt) < maxAgeMs) {
      return { lat: this.userLat, lng: this.userLng, isLocated: this.isLocated };
    }

    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) {
        this.isLocated = false;
        return reject(new Error('Geolocation not supported'));
      }

      const onSuccess = (pos) => {
        this.userLat = pos.coords.latitude;
        this.userLng = pos.coords.longitude;
        this.isLocated = true;
        this._lastLocatedAt = Date.now();
        resolve({ lat: this.userLat, lng: this.userLng, isLocated: this.isLocated });
      };

      const onError = (err) => {
        this.isLocated = false;
        reject(err);
      };

      navigator.geolocation.getCurrentPosition(onSuccess, onError, {
        enableHighAccuracy: highAccuracy,
        timeout: highAccuracy ? 10000 : 5000,
        maximumAge: highAccuracy ? 0 : 60000,
      });
    });
  }

  getPosition() {
    return {
      lat: this.userLat || DEFAULT_LAT,
      lng: this.userLng || DEFAULT_LNG,
      isLocated: this.isLocated,
      accuracy: this.userAccuracy,
      heading: this.userHeading,
    };
  }

  /**
   * Continuous position updates via watchPosition.
   * Each update fires every subscribed callback with full position details.
   */
  startWatching(callback) {
    if (typeof callback === 'function') this._watchers.add(callback);

    if (this.watchId !== null || !('geolocation' in navigator)) return true;

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.userLat = pos.coords.latitude;
        this.userLng = pos.coords.longitude;
        this.userAccuracy = pos.coords.accuracy;
        this.userHeading = Number.isFinite(pos.coords.heading) ? pos.coords.heading : this.userHeading;
        this.userSpeed = Number.isFinite(pos.coords.speed) ? pos.coords.speed : null;
        this.isLocated = true;
        this._lastLocatedAt = Date.now();

        const snapshot = {
          lat: this.userLat,
          lng: this.userLng,
          accuracy: this.userAccuracy,
          heading: this.userHeading,
          speed: this.userSpeed,
          timestamp: pos.timestamp,
        };
        this._watchers.forEach((cb) => { try { cb(snapshot); } catch (_) {} });
      },
      (err) => {
        // 1 = PERMISSION_DENIED — stop watching
        if (err?.code === 1) this.stopWatching();
      },
      {
        enableHighAccuracy: true,
        maximumAge: 2000,
        timeout: 20000,
      }
    );
    return true;
  }

  stopWatching() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this._watchers.clear();
  }

  isWatching() { return this.watchId !== null; }

  /**
   * Haversine formula — distance between two points on Earth
   * @returns distance in kilometers
   */
  static distanceBetween(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  static formatDistance(km) {
    if (km < 1) {
      return { value: Math.round(km * 1000), unit: 'meters' };
    }
    return { value: km.toFixed(1), unit: 'km' };
  }
}

const geoLocation = new GeoLocation();
