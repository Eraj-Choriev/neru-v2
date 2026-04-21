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
    this.isLocated = false;
    this.watchId = null;
  }
  async getUserLocation({ force = false, maxAgeMs = 30000 } = {}) {
    const now = Date.now();
    // вернуть кэш если он свежий и не запрошен force
    if (!force && this.isLocated && this._lastLocatedAt && (now - this._lastLocatedAt) < maxAgeMs) {
      return {
        lat: this.userLat,
        lng: this.userLng,
        isLocated: this.isLocated
      };
    }

    // Запросить геолокацию у браузера и сохранить время при успехе.
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
        resolve({
          lat: this.userLat,
          lng: this.userLng,
          isLocated: this.isLocated
        });
      };

      const onError = (err) => {
        // не устанавливаем фолбэк тут — пусть вызывающий код решает, использовать ли сохранённую позицию
        this.isLocated = false;
        reject(err);
      };

      navigator.geolocation.getCurrentPosition(onSuccess, onError, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      });
    });
  }

  getPosition() {
    return {
      lat: this.userLat || DEFAULT_LAT,
      lng: this.userLng || DEFAULT_LNG,
      isLocated: this.isLocated
    };
  }

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
