// ============================================
// NŪR — Paid Parking Zones (api.parking.dc.tj)
// ============================================
//
// Second feed from the same operator as the charger map. It is a static
// reference list of kerbside parking strips with no live occupancy, so it is
// fetched once and cached for a day rather than folded into the 30s station
// refresh. Region names come from each record's `city` field.

const PARKING_URL = 'https://api.parking.dc.tj/api/v1/getMarkerParking';

// Same proxy ladder as the station feed (js/api.js) — direct first, then
// public CORS relays.
const PARKING_PROXIES = [
  '', // direct
  'https://api.allorigins.win/raw?url=',
];

const PARKING_CACHE_KEY = 'nur-parking-v2';
const PARKING_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h — the list barely changes
// A country-sized guard keeps valid regional coordinates while rejecting
// corrupt points such as the feed's old 0.0 placeholders.
const TAJIKISTAN_BOUNDS = { minLat: 36, maxLat: 42, minLng: 66, maxLng: 76 };

// Public facts about the paid-parking scheme, from neru.tj/question-parking
// and neru.tj/rule-fine-parking. Kept here so the timer, the popups and the
// rules sheet can never disagree with each other.
const PARKING = {
  TARIFF_TJS: 3,      // сомони per hour — every zone in the feed reports "3"
  FREE_MINUTES: 10,   // free grace period from the moment of entry
  // Art. 324 of the Code of Administrative Offences = one "показатель для
  // расчётов". The indicator is re-set every 1 January; 78 TJS from 2026-01-01.
  PRR_TJS: 78,
  SMS_SHORT: '7788',
  SUPPORT_TEL: '+992778807788',
  SUPPORT_SHORT: '77-88',
};

// Dushanbe sits at ~38.56°N, so a degree of longitude is cos(38.56°) as long
// as a degree of latitude. Good to ~0.1% over a city — and cheap enough to run
// against every zone on every GPS tick.
const M_PER_DEG_LAT = 111320;
const M_PER_DEG_LNG = 111320 * Math.cos(38.56 * Math.PI / 180); // ≈ 87090

class ParkingAPI {
  constructor() {
    this.zones = [];
    this.regionStats = [];
    this.apiRecordCount = 0;
    this.lastFetch = null;
    this.isLoading = false;
    this.lastError = null;
    this.workingProxy = null;
  }

  // ── Fetching ──────────────────────────────────────────────────────────────

  fetchZones(options) {
    // Concurrent callers await the same snapshot instead of stale data.
    if (this._pending) return this._pending;
    this._pending = this._fetchZones(options).finally(() => { this._pending = null; });
    return this._pending;
  }

  async _fetchZones({ force = false } = {}) {
    if (this.zones.length && !force && !this.lastError && this.lastFetch &&
        Date.now() - this.lastFetch.getTime() < PARKING_CACHE_TTL) return this.zones;
    if (this.isLoading) return this.zones;

    // Serve the cache immediately when it is fresh — the list is static and a
    // cold network hit through a proxy can take seconds.
    if (!force && !this.lastError) {
      const cached = this._readCache();
      if (cached) {
        this.zones = cached.zones;
        this.regionStats = Array.isArray(cached.regionStats) ? cached.regionStats : [];
        this.apiRecordCount = Number(cached.apiRecordCount) || this.zones.length;
        this.lastFetch = new Date(cached.ts);
        this._announce();
        // Old clients cached only normalized map zones. Show them immediately
        // while refreshing once so the regional totals include every API row.
        if (!cached._legacy) return this.zones;
      }
    }

    this.isLoading = true;
    try {
      let data = null;

      const candidates = [...new Set([this.workingProxy, ...PARKING_PROXIES])]
        .filter(proxy => proxy !== null);
      const controllers = candidates.map(() => new AbortController());
      try {
        const result = await Promise.any(candidates.map(async (proxy, index) => {
          const value = await this._tryFetch(proxy, controllers[index]);
          if (!value) throw new Error('Parking source unavailable');
          return { value, proxy };
        }));
        data = result.value;
        this.workingProxy = result.proxy;
      } catch (_) {
        // Preserve the existing stale-cache and error handling below.
      } finally {
        controllers.forEach(controller => controller.abort());
      }

      // This endpoint returns code as a NUMBER (200), while getMarkerPower
      // returns it as a STRING ('200'). Compare loosely on purpose.
      if (data && data.code == 200 && Array.isArray(data.parks)) {
        const zones = data.parks
          .map((raw) => this.normalizeZone(raw))
          .filter(Boolean);

        if (zones.length) {
          this.zones = zones;
          this.regionStats = this._aggregateRegionStats(data.parks);
          this.apiRecordCount = data.parks.length;
          this.lastFetch = new Date();
          this.lastError = null;
          this._writeCache();
          console.log(`🅿️ Loaded ${zones.length} parking zones (${data.parks.length} raw)`);
          this._announce();
        } else {
          throw new Error('All parking zones failed validation');
        }
      } else {
        throw new Error('No valid parking data from any source');
      }
    } catch (error) {
      this.lastError = error;
      console.warn('Parking API error:', error.message);
      // Stale cache still beats an empty map.
      const stale = this._readCache({ ignoreTtl: true });
      if (stale) {
        this.zones = stale.zones;
        this.regionStats = Array.isArray(stale.regionStats) ? stale.regionStats : [];
        this.apiRecordCount = Number(stale.apiRecordCount) || this.zones.length;
        this.lastFetch = new Date(stale.ts);
        this._announce();
      } else {
        window.dispatchEvent(new CustomEvent('parkingError', { detail: { error } }));
      }
    } finally {
      this.isLoading = false;
    }

    return this.zones;
  }

  async _tryFetch(proxy, controller = new AbortController()) {
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const url = proxy ? proxy + encodeURIComponent(PARKING_URL) : PARKING_URL;
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const data = await response.json();
      // An empty list cannot populate this map; let another source win.
      return Number(data?.code) === 200 && Array.isArray(data.parks) && data.parks.length ? data : null;
    } catch (e) {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  _announce() {
    window.dispatchEvent(new CustomEvent('parkingLoaded', {
      detail: { zones: this.zones, timestamp: this.lastFetch },
    }));
  }

  // ── Normalization ─────────────────────────────────────────────────────────

  /**
   * The feed is dirty in two specific ways, both of which have to be handled
   * or the map ends up with markers in the Gulf of Guinea:
   *
   *  - 16 records carry "0.0" in every coordinate field. Nothing can be
   *    recovered from them, so they are dropped.
   *  - 4 records (the н. Рӯдакӣ ones) put the LONGITUDE in marker1 and leave
   *    marker2 null. Their polygon points are fine, so the centre is rebuilt
   *    from the segment midpoint.
   *
   * Note also that `polygon1..4` is not a polygon: it is a single line segment
   * (lat1, lng1, lat2, lng2) tracing the parking strip along the kerb.
   */
  normalizeZone(raw) {
    if (!raw) return null;

    const a = this._point(raw.polygon1, raw.polygon2);
    const b = this._point(raw.polygon3, raw.polygon4);
    if (!a || !b) return null; // no geometry → nothing to draw or geofence

    let centre = this._point(raw.marker1, raw.marker2);
    if (!centre) {
      // Swapped or missing marker — the segment midpoint is within ~1m of the
      // marker on every clean record, so it is a faithful substitute.
      centre = { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
    }

    const places = parseInt(raw.all_place, 10);
    const accessible = parseInt(raw.invalid, 10);

    return {
      id: raw.id,
      // `name` is a zone code and is NOT unique (178 distinct over 243 rows),
      // so it must never be used as a key — only `id` is.
      code: raw.name || '',
      address: raw.address || '',
      lat: centre.lat,
      lng: centre.lng,
      a: [a.lat, a.lng],
      b: [b.lat, b.lng],
      places: Number.isFinite(places) ? places : null,
      accessiblePlaces: Number.isFinite(accessible) ? accessible : null,
      tariff: parseFloat(raw.tarif) || PARKING.TARIFF_TJS,
      schedule: raw.work_schedule || '',
      district: raw.zone_name || '',
      city: raw.city || '',
    };
  }

  /** Parse a lat/lng pair, rejecting placeholders and points outside Tajikistan. */
  _point(latRaw, lngRaw) {
    const lat = parseFloat(latRaw);
    const lng = parseFloat(lngRaw);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < TAJIKISTAN_BOUNDS.minLat || lat > TAJIKISTAN_BOUNDS.maxLat ||
        lng < TAJIKISTAN_BOUNDS.minLng || lng > TAJIKISTAN_BOUNDS.maxLng) return null;
    return { lat, lng };
  }

  // ── Cache ─────────────────────────────────────────────────────────────────

  _readCache({ ignoreTtl = false } = {}) {
    try {
      for (const key of [PARKING_CACHE_KEY, 'nur-parking-v1']) {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (!parsed?.ts || !Array.isArray(parsed.zones) || !parsed.zones.length) continue;
        if (!ignoreTtl && Date.now() - parsed.ts > PARKING_CACHE_TTL) continue;
        return { ...parsed, _legacy: key !== PARKING_CACHE_KEY };
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  _writeCache() {
    try {
      localStorage.setItem(PARKING_CACHE_KEY, JSON.stringify({
        ts: Date.now(),
        zones: this.zones,
        regionStats: this.regionStats,
        apiRecordCount: this.apiRecordCount,
      }));
    } catch (_) { /* quota — the map still works, it just refetches next time */ }
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  getZones() { return this.zones; }

  getZoneById(id) {
    return this.zones.find((z) => String(z.id) === String(id)) || null;
  }

  getZonesForRegion(region = null) {
    if (region === null) return this.zones;
    const key = String(region).trim();
    return this.zones.filter((zone) => String(zone.city || '').trim() === key);
  }

  _aggregateRegionStats(records) {
    const regions = new Map();
    for (const raw of records) {
      const key = String(raw?.city || '').trim();
      let region = regions.get(key);
      if (!region) {
        region = { key, name: key || (typeof i18n !== 'undefined' ? i18n.t('pkUnknownRegion') : 'Other'), zones: 0, places: 0, accessible: 0 };
        regions.set(key, region);
      }
      const places = parseInt(raw?.all_place, 10);
      const accessible = parseInt(raw?.invalid, 10);
      region.zones += 1;
      region.places += Number.isFinite(places) ? places : 0;
      region.accessible += Number.isFinite(accessible) ? accessible : 0;
    }
    return [...regions.values()];
  }

  getStats(region = null) {
    const key = region === null ? null : String(region).trim();
    const source = key === null
      ? this.regionStats
      : this.regionStats.filter((item) => item.key === key);
    const mappedZones = this.getZonesForRegion(key).length;
    if (source.length) {
      return {
        zones: source.reduce((sum, item) => sum + item.zones, 0),
        places: source.reduce((sum, item) => sum + item.places, 0),
        accessible: source.reduce((sum, item) => sum + item.accessible, 0),
        mappedZones,
      };
    }
    const zones = this.getZonesForRegion(key);
    return {
      zones: zones.length,
      places: zones.reduce((sum, z) => sum + (z.places || 0), 0),
      accessible: zones.reduce((sum, z) => sum + (z.accessiblePlaces || 0), 0),
      mappedZones,
    };
  }

  getMappedStats(region = null) {
    const zones = this.getZonesForRegion(region);
    return {
      zones: zones.length,
      places: zones.reduce((sum, z) => sum + (z.places || 0), 0),
      accessible: zones.reduce((sum, z) => sum + (z.accessiblePlaces || 0), 0),
    };
  }

  /** Region rows are derived from the feed so new cities appear automatically. */
  getRegions() {
    const stats = this.regionStats.length
      ? this.regionStats
      : this._aggregateRegionStats(this.zones.map((zone) => ({
        city: zone.city, all_place: zone.places, invalid: zone.accessiblePlaces,
      })));
    return stats.map((region) => ({
      ...region,
      mappedZones: this.getZonesForRegion(region.key).length,
    })).sort((a, b) => b.zones - a.zones || a.name.localeCompare(b.name));
  }

  // ── Geometry ──────────────────────────────────────────────────────────────

  /**
   * Perpendicular distance in metres from a point to a zone's parking strip
   * (a line segment, not its centre) — a 440m strip would otherwise read as
   * "220m away" while the driver is parked right on it.
   */
  distanceToZone(lat, lng, zone) {
    if (!zone) return Infinity;

    // Project to a local metre grid so the segment maths is plain 2D.
    const px = (lng - zone.a[1]) * M_PER_DEG_LNG;
    const py = (lat - zone.a[0]) * M_PER_DEG_LAT;
    const bx = (zone.b[1] - zone.a[1]) * M_PER_DEG_LNG;
    const by = (zone.b[0] - zone.a[0]) * M_PER_DEG_LAT;

    const lenSq = bx * bx + by * by;
    if (lenSq === 0) return Math.hypot(px, py); // degenerate strip → point distance

    // Clamp the projection to [0,1] so we measure to the segment, not the
    // infinite line it lies on.
    let t = (px * bx + py * by) / lenSq;
    t = Math.max(0, Math.min(1, t));

    return Math.hypot(px - t * bx, py - t * by);
  }

  /** Closest zone to a point. Returns { zone, meters } or null when no zones are loaded. */
  nearestZone(lat, lng) {
    let best = null;
    let bestMeters = Infinity;
    for (const zone of this.zones) {
      const meters = this.distanceToZone(lat, lng, zone);
      if (meters < bestMeters) { bestMeters = meters; best = zone; }
    }
    return best ? { zone: best, meters: bestMeters } : null;
  }

  /** Zones within `meters` of a point, nearest first. */
  zonesWithin(lat, lng, meters) {
    return this.zones
      .map((zone) => ({ zone, meters: this.distanceToZone(lat, lng, zone) }))
      .filter((r) => r.meters <= meters)
      .sort((x, y) => x.meters - y.meters);
  }
}

const parkingAPI = new ParkingAPI();
