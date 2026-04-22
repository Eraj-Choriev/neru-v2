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
        stationMap.setUserLocation(pos.lat, pos.lng);
        if (geoLocation.isLocated) {
          stationMap.flyTo(pos.lat, pos.lng, 14);
          document.getElementById('loc-btn')?.classList.add('is-located');
        }
      }

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
      const locPromise = geoLocation.getUserLocation({ force: false, maxAgeMs: 30000 }).catch(() => null);
      const fetchPromise = stationAPI.fetchStations().catch(() => null);
      await Promise.all([locPromise, fetchPromise]);

      const loc = await locPromise;
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

    btn.classList.remove('is-located');
    btn.classList.add('is-locating');
    ui.showToast(i18n.t('locating'), 'info', 8000);

    try {
      const pos = await geoLocation.getUserLocation({ force: true, maxAgeMs: 0 });
      stationMap.setUserLocation(pos.lat, pos.lng);
      stationMap.map.flyTo([pos.lat, pos.lng], 16, { duration: 1.0 });
      btn.classList.remove('is-locating');
      btn.classList.add('is-located');
      ui.showToast(i18n.t('locationFound'), 'success', 2500);

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

  async handleFilterChanged() {
    const stations = stationAPI.getStations();
    const filtered = ui.applyFilter(stations);
    stationMap.renderStations(filtered);
  }

  async handleLangChange() {
    // Re-render stations with new language in popups
    const stations = stationAPI.getStations();
    const filtered = ui.applyFilter(stations);
    stationMap.renderStations(filtered);
    
    // Re-render sidebar if open
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
      await this.loadStations();
    }, this.REFRESH_MS);
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
