// ============================================
// NerU v2 — App Controller
// ============================================

class App {
  constructor() {
    this.refreshInterval = null;
    this.REFRESH_MS = 30000; // 30 seconds
    this.initialized = false;
  }

  async init() {
    try {
      // Initialize UI
      ui.init();
      ui.showLoading();

      // Initialize map
      stationMap.init('map');

      // Initialize notifications early so enabled state is known before seeding
      if (typeof stationNotifications !== 'undefined') {
        stationNotifications.init();
      }

      // Load stations
      await this.loadStations();

      // Get user location (non-blocking — works even if denied)
      const pos = await geoLocation.getUserLocation().catch(() => null);
      if (pos) {
        stationMap.setUserLocation(pos.lat, pos.lng, {
          accuracy: geoLocation.userAccuracy,
          heading: geoLocation.userHeading,
          animate: false,
        });
        if (geoLocation.isLocated) {
          stationMap.flyTo(pos.lat, pos.lng, 14);
          document.getElementById('loc-btn')?.classList.add('is-located');
          // Start continuous live tracking (marker follows device)
          this.startLiveTracking();
        }
      }

      // Try to enable the device compass — works immediately on Android/desktop.
      // iOS requires a user gesture; the My Location button retries enabling it.
      geoLocation.enableCompass().catch(() => {});
      this.bindCompass();

      // Seed notification states now that location and stations are both available
      if (typeof stationNotifications !== 'undefined' && geoLocation.isLocated && !stationNotifications.seeded) {
        const stations = stationAPI.getStations();
        stationNotifications.seedStates(stations, geoLocation.userLat, geoLocation.userLng);
      }

      ui.hideLoading();
      this.initialized = true;

      // Start auto-refresh
      this.startAutoRefresh();

      // Bind global events
      this.bindEvents();

      // Set initial language buttons
      ui.updateLangButtons(i18n.getLang());

      console.log('✅ NerU v2 initialized');
    } catch (error) {
      console.error('Init error:', error);
      ui.hideLoading();
      ui.showToast(i18n.t('errorLoading'), 'error', 5000);
    }
  }

  async loadStations() {
    const stations = await stationAPI.fetchStations();
    if (stations.length > 0) {
      const filtered = ui.applyFilter(stations);
      stationMap.renderStations(filtered);
      
      const stats = stationAPI.getStats();
      ui.updateStats(stats);
      ui.updateLastRefresh(stationAPI.lastFetch);

      // Handle push notifications
      if (typeof stationNotifications !== 'undefined' && geoLocation.isLocated) {
        const pos = geoLocation.getPosition();
        if (!stationNotifications.seeded) {
          stationNotifications.seedStates(stations, pos.lat, pos.lng);
        } else {
          stationNotifications.checkStations(stations, pos.lat, pos.lng);
        }
      }
    }
  }

  bindEvents() {
    // Find nearest button
    window.addEventListener('findNearest', () => this.handleFindNearest());

    // Filter changed
    window.addEventListener('filterChanged', () => this.handleFilterChanged());

    // Language changed
    window.addEventListener('langchange', () => this.handleLangChange());

    // My Location button
    document.getElementById('loc-btn')?.addEventListener('click', () => this.handleMyLocation());

    // Station load error
    window.addEventListener('stationsError', () => {
      ui.showToast(i18n.t('errorLoading'), 'error');
      ui.hideLoading();
    });

    // Theme changed — swap Leaflet tile layer (dark <-> light)
    window.addEventListener('themechange', (e) => {
      stationMap.setTheme(e.detail?.theme);
    });

    // In-app route request (from popup or sidebar card)
    window.addEventListener('routeRequest', (e) => this.handleRouteRequest(e.detail));
  }

  async handleRouteRequest({ stationId }) {
    const station = stationAPI.getStationById(stationId);
    if (!station) return;
    if (ui.sidebarOpen) ui.closeSidebar();
    await stationRouter.routeTo(station);
  }

  async handleFindNearest() {
    ui.showLoading();
    try {
      const [loc] = await Promise.all([
        geoLocation.getUserLocation({ force: false, maxAgeMs: 30000 }).catch(() => null),
        stationAPI.fetchStations().catch(() => null),
      ]);

      const pos = loc ? { lat: loc.lat, lng: loc.lng } : geoLocation.getPosition();
      stationMap.setUserLocation(pos.lat, pos.lng);

      if (loc) {
        document.getElementById('loc-btn')?.classList.add('is-located');
      }

      const stations = stationAPI.getStations() || [];
      if (!stations.length) {
        ui.hideLoading();
        ui.showToast(i18n.t('noStations'), 'warning');
        return;
      }

      const results = stationFinder.findNearestStations(stations, pos.lat, pos.lng, 5);
      ui.hideLoading();

      if (results && results.length) {
        ui.openSidebar(results);
        stationMap.highlightStation(results[0]);
        ui.showToast(`${i18n.t('bestChoice')}: ${results[0].name}`, 'success');
      } else {
        ui.showToast(i18n.t('noFreeStations'), 'warning');
      }
    } catch (err) {
      ui.hideLoading();
      ui.showToast(i18n.t('errorLoading'), 'error');
    }
  }

  async handleMyLocation() {
    const btn = document.getElementById('loc-btn');
    if (!btn || btn.classList.contains('is-locating')) return;

    // iOS needs compass permission from a user gesture — this is one
    geoLocation.enableCompass().catch(() => {});

    // If already tracking and located, a second tap toggles follow-mode on/off
    if (btn.classList.contains('is-located') && stationMap.map) {
      if (stationMap.isFollowingUser()) {
        stationMap.setFollowUser(false);
        btn.classList.remove('is-following');
      } else {
        stationMap.setFollowUser(true);
        btn.classList.add('is-following');
        const pos = geoLocation.getPosition();
        if (pos.isLocated) stationMap.map.flyTo([pos.lat, pos.lng], Math.max(16, stationMap.map.getZoom()), { duration: 0.8 });
      }
      return;
    }

    btn.classList.remove('is-located');
    btn.classList.add('is-locating');
    ui.showToast(i18n.t('locating'), 'info', 8000);

    try {
      const pos = await geoLocation.getUserLocation({ force: true, maxAgeMs: 0, highAccuracy: true });
      stationMap.setUserLocation(pos.lat, pos.lng, {
        accuracy: geoLocation.userAccuracy,
        heading: geoLocation.userHeading,
        animate: false,
      });
      stationMap.map.flyTo([pos.lat, pos.lng], 16, { duration: 1.0 });
      btn.classList.remove('is-locating');
      btn.classList.add('is-located');
      btn.classList.add('is-following');
      stationMap.setFollowUser(true);
      ui.showToast(i18n.t('locationFound'), 'success', 2500);

      // Begin continuous tracking
      this.startLiveTracking();

      // Immediately show free stations within radius
      if (typeof stationNotifications !== 'undefined') {
        stationNotifications.showNearbyNow();
      }
    } catch (err) {
      btn.classList.remove('is-locating');
      const msg = err?.code === 1
        ? i18n.t('locationDenied')
        : i18n.t('locationUnavailable');
      ui.showToast(msg, 'error', 4000);
    }
  }

  /**
   * Route compass (magnetometer) updates to the map cone and the on-screen
   * compass indicator. Fires 60Hz while the user rotates in place — this is
   * what makes turning west reflect on the map without needing to move.
   */
  bindCompass() {
    if (this._compassBound) return;
    this._compassBound = true;

    const indicator = document.getElementById('compass-indicator');
    const dial = document.getElementById('compass-dial');

    // Track accumulated rotation so CSS transitions take the shortest path
    let cum = null;
    let last = null;

    geoLocation.onHeadingChange((heading) => {
      if (!Number.isFinite(heading)) return;

      // Reveal the compass widget the first time we have a real reading
      if (indicator && !indicator.classList.contains('is-visible')) {
        indicator.classList.add('is-visible');
        indicator.setAttribute('aria-hidden', 'false');
      }

      // Rotate the dial by -heading so "N" always points to true North
      const wrapped = ((heading % 360) + 360) % 360;
      if (cum == null) {
        cum = wrapped;
      } else {
        let delta = wrapped - (((last % 360) + 360) % 360);
        if (delta > 180) delta -= 360;
        else if (delta < -180) delta += 360;
        cum += delta;
      }
      last = wrapped;
      if (dial) dial.style.transform = `rotate(${-cum}deg)`;

      // Drive the map user-marker cone in lockstep
      stationMap.setUserHeading(heading);
    });
  }

  /**
   * Live tracking — user marker smoothly follows device as it moves.
   * Auto-re-routes active route and keeps sidebar distances fresh.
   */
  startLiveTracking() {
    if (this._liveTrackingStarted) return;
    this._liveTrackingStarted = true;
    this._lastReroute = 0;
    this._lastSidebarRefresh = 0;

    geoLocation.startWatching((snap) => {
      stationMap.setUserLocation(snap.lat, snap.lng, {
        accuracy: snap.accuracy,
        heading: snap.heading,
        animate: true,
      });

      const now = Date.now();

      // Re-route every 12s while following a route (avoid hammering OSRM)
      if (stationRouter?.activeRoute && now - this._lastReroute > 12000) {
        this._lastReroute = now;
        stationRouter.refreshFromCurrent();
      }

      // If sidebar open with results, refresh distances every 5s
      if (ui.sidebarOpen && now - this._lastSidebarRefresh > 5000) {
        this._lastSidebarRefresh = now;
        const stations = stationAPI.getStations() || [];
        if (stations.length) {
          const results = stationFinder.findNearestStations(stations, snap.lat, snap.lng, 5);
          if (results?.length) ui.renderResults(results);
        }
      }
    });
  }

  handleFilterChanged() {
    const stations = stationAPI.getStations();
    stationMap.renderStations(ui.applyFilter(stations));
  }

  handleLangChange() {
    const stations = stationAPI.getStations();
    stationMap.renderStations(ui.applyFilter(stations));
    if (ui.sidebarOpen && stationFinder.getResults().length > 0) {
      ui.renderResults(stationFinder.getResults());
    }
  }

  showOnMap(stationId) {
    ui.closeSidebar();
    stationMap.openStationPopup(stationId);
  }

  startAutoRefresh() {
    this.refreshInterval = setInterval(async () => {
      if (!document.hidden) await this.loadStations();
    }, this.REFRESH_MS);

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.initialized) this.loadStations();
    });
  }

  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }
}

const app = new App();

// Boot
document.addEventListener('DOMContentLoaded', () => {
  app.init();
});
