// ============================================
// NerU v2 — API Module (with CORS fallback)
// ============================================

const API_URL = 'https://api.parking.dc.tj/api/v1/getMarkerPower';
const CORS_PROXIES = [
  '', // Direct first
  'https://corsproxy.io/?',
  'https://api.allorigins.win/raw?url=',
];

class StationAPI {
  constructor() {
    this.stations = [];
    this.lastFetch = null;
    this.isLoading = false;
    this.workingProxy = null;
  }

  async fetchStations() {
    if (this.isLoading) return this.stations;
    this.isLoading = true;

    try {
      let data = null;

      // If we found a working proxy before, try it first
      if (this.workingProxy !== null) {
        data = await this._tryFetch(this.workingProxy);
      }

      // If no data yet, try all proxies
      if (!data) {
        for (const proxy of CORS_PROXIES) {
          data = await this._tryFetch(proxy);
          if (data) {
            this.workingProxy = proxy;
            break;
          }
        }
      }

      if (data && data.code === '200' && Array.isArray(data.powers)) {
        this.stations = data.powers.map(s => this.normalizeStation(s));
        this.lastFetch = new Date();
        console.log(`✅ Loaded ${this.stations.length} stations`);
        window.dispatchEvent(new CustomEvent('stationsLoaded', { 
          detail: { stations: this.stations, timestamp: this.lastFetch } 
        }));
      } else {
        throw new Error('No valid data from any source');
      }
    } catch (error) {
      console.error('API Error:', error);
      window.dispatchEvent(new CustomEvent('stationsError', { detail: { error } }));
    } finally {
      this.isLoading = false;
    }

    return this.stations;
  }

  async _tryFetch(proxy) {
    try {
      const url = proxy ? proxy + encodeURIComponent(API_URL) : API_URL;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      
      const response = await fetch(url, { 
        signal: controller.signal,
        headers: { 'Accept': 'application/json' }
      });
      clearTimeout(timeout);
      
      if (!response.ok) return null;
      const data = await response.json();
      return data;
    } catch (e) {
      console.warn(`Proxy "${proxy || 'direct'}" failed:`, e.message);
      return null;
    }
  }

  normalizeStation(raw) {
    const connectors = (raw.connectors_info || []).map(c => ({
      id: c.connector_id,
      status: c.status || 'Unknown',
      chargeLevel: parseFloat(c.charging_level) || 0,
      color: c.color || null,
      isAvailable: c.status?.toLowerCase() === 'available',
      isCharging: c.status?.toLowerCase() === 'charging',
    }));

    const freeConnectors = connectors.filter(c => c.isAvailable).length;
    const totalConnectors = connectors.length;

    return {
      id: raw.id,
      name: raw.name || `Station #${raw.id}`,
      address: raw.address || '',
      lat: parseFloat(raw.marker1) || 0,
      lng: parseFloat(raw.marker2) || 0,
      totalPlaces: parseInt(raw.all_place) || 0,
      zoneName: raw.zone_name || '',
      schedule: raw.work_schedule || '',
      tariff: parseFloat(raw.TariffValue) || 0,
      tariffUnit: raw.tarif || '',
      capacity: raw.connector_capacity || '',
      capacityWatts: parseInt(raw.connector_capacity) || 0,
      city: raw.city || '',
      connectors,
      freeConnectors,
      totalConnectors,
      hasAvailable: freeConnectors > 0,
      avgChargeLevel: connectors.length > 0 
        ? connectors.reduce((sum, c) => sum + c.chargeLevel, 0) / connectors.length 
        : 0,
      maxChargeLevel: connectors.length > 0 
        ? Math.max(...connectors.map(c => c.chargeLevel)) 
        : 0,
    };
  }

  getStations() {
    return this.stations;
  }

  getAvailableStations() {
    return this.stations.filter(s => s.hasAvailable);
  }

  getStationById(id) {
    return this.stations.find(s => s.id === id);
  }

  getStats() {
    const total = this.stations.length;
    const withFree = this.stations.filter(s => s.hasAvailable).length;
    const totalConnectors = this.stations.reduce((s, st) => s + st.totalConnectors, 0);
    const freeConnectors = this.stations.reduce((s, st) => s + st.freeConnectors, 0);
    return { total, withFree, totalConnectors, freeConnectors };
  }
}

const stationAPI = new StationAPI();

// ── Charging ETA helper (shared by map.js and ui.js) ──────────────────────────
// Assumes 50 kWh battery charging to 90%; powerKw is the station capacity in kW.
const ETA_BATTERY_KWH = 50;
const ETA_TARGET_PCT  = 90;

function chargingEta(chargeLevel, powerKw) {
  if (!powerKw || powerKw <= 0 || chargeLevel == null || chargeLevel < 0) return null;
  const remainPct = Math.max(0, ETA_TARGET_PCT - chargeLevel);
  if (remainPct <= 0) return { val: '<1', type: 'minSuffix' };
  const minutes = Math.round((remainPct / 100) * ETA_BATTERY_KWH / powerKw * 60);
  if (minutes < 1)  return { val: '<1', type: 'minSuffix' };
  if (minutes < 60) return { val: String(minutes), type: 'minSuffix' };
  return { val: (minutes / 60).toFixed(1), type: 'hrSuffix' };
}
