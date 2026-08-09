// ============================================
// NerU v2 — App Controller
// ============================================

class App {
  constructor() {
    this.refreshInterval = null;
    this.REFRESH_MS = 30000; // 30 seconds
    this.initialized = false;
    this.CONSENT_KEY = 'neru-loc-consent'; // 'granted' | 'denied' | null (unasked)
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

      // Parking zones are a static reference list, so they load in the
      // background and never join the 30s station refresh.
      this.loadParking();

      // Location is gated behind a first-visit consent card, so the native
      // browser prompt only fires once the user has opted in.
      const consent = localStorage.getItem(this.CONSENT_KEY);
      if (consent === 'granted') {
        this.acquireLocation();          // returning user — fetch straight away
      } else if (consent == null) {
        this.showLocationConsent();      // first visit — ask first
      }
      // consent === 'denied' → stay location-less; the location button re-offers it

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
      // Re-rendering markers destroys an open station card. If someone is
      // reading one, hold the redraw until they close it.
      if (document.body.classList.contains('has-popup')) {
        this._renderPending = true;
      } else {
        stationMap.renderStations(filtered);
      }

      const stats = stationAPI.getStats();
      ui.updateStats(stats);
      ui.updateLastRefresh(stationAPI.lastFetch);

      // Fold this poll into the local history, then repaint the panel if open.
      if (typeof stationAnalytics !== 'undefined') {
        stationAnalytics.record(stations);
        stationAnalytics.refresh();
      }

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

  /**
   * Fetch the paid parking zones, draw them (hidden until toggled) and start
   * the geofence. Deliberately not awaited by init() — a slow proxy must not
   * hold up the charger map.
   */
  async loadParking() {
    // Bind the session card first: a timer restored from a previous visit has
    // to come back even if the zone list is slow or unreachable this time.
    parkingSession.init();

    const zones = await parkingAPI.fetchZones();
    if (!zones.length) return;

    stationMap.renderParkingZones(zones);
    stationMap.setParkingVisible(this._parkingVisible === true);
  }

  toggleParking(force = null) {
    const zones = parkingAPI.getZones();
    if (!zones.length) {
      ui.showToast(i18n.t('pkNoZones'), 'warning', 3000);
      return;
    }

    const next = force === null ? !stationMap.isParkingVisible() : !!force;
    this._parkingVisible = next;

    // One errand at a time: parking hides the chargers, and everything that
    // describes the map — the HUD, the charger filter, the find button —
    // follows the layer instead of contradicting it.
    stationMap.setParkingVisible(next);
    if (ui.sidebarOpen) ui.closeSidebar();
    ui.setStatsMode(next ? 'parking' : 'ev');
    if (next) ui.updateParkingStats(parkingAPI.getStats());
    else ui.updateStats(stationAPI.getStats());

    document.getElementById('pk-toggle')?.classList.toggle('is-active', next);
    document.getElementById('pk-toggle')?.setAttribute('aria-pressed', String(next));
    document.getElementById('md-parking')?.classList.toggle('is-active', next);
    document.getElementById('md-parking')?.setAttribute('aria-pressed', String(next));
    const state = document.getElementById('md-parking-state');
    if (state) state.textContent = next ? 'ON' : 'OFF';

    ui.showToast(i18n.t(next ? 'pkZonesOn' : 'pkZonesOff'), 'info', 2000);
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

    // Analytics panel
    document.getElementById('an-trigger')?.addEventListener('click', () => stationAnalytics.open());
    document.getElementById('md-analytics')?.addEventListener('click', () => {
      ui.toggleMobileDrawer();
      stationAnalytics.open();
    });
    document.getElementById('an-close')?.addEventListener('click', () => stationAnalytics.close());
    document.getElementById('an-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'an-modal') stationAnalytics.close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (stationAnalytics.isOpen()) stationAnalytics.close();
      if (parkingRules.isOpen()) parkingRules.close();
    });
    window.addEventListener('langchange', () => stationAnalytics.refresh());

    // Parking zones — layer toggle, rules sheet, and routing to a zone
    this.bindTabBar();
    document.getElementById('pk-toggle')?.addEventListener('click', () => this.toggleParking());
    document.getElementById('md-parking')?.addEventListener('click', () => {
      ui.toggleMobileDrawer();
      this.toggleParking();
    });
    window.addEventListener('parkingRulesRequest', () => parkingRules.open());
    document.getElementById('pk-close')?.addEventListener('click', () => parkingRules.close());
    document.getElementById('pk-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'pk-modal') parkingRules.close();
    });
    window.addEventListener('langchange', () => {
      parkingRules.refresh();
      stationMap.refreshParkingPopups(parkingAPI.getZones());
    });

    // Apply a refresh that was held back while a station card was open
    window.addEventListener('popupClosed', () => {
      if (!this._renderPending) return;
      this._renderPending = false;
      stationMap.renderStations(ui.applyFilter(stationAPI.getStations() || []));
    });
  }

  async handleRouteRequest({ stationId }) {
    const station = stationAPI.getStationById(stationId);
    if (!station) return;
    if (ui.sidebarOpen) ui.closeSidebar();
    await stationRouter.routeTo(station);
    // Seed re-route throttle so we don't immediately re-fetch a route we just built.
    if (stationRouter.activeRoute) {
      this._lastReroute = Date.now();
      const p = geoLocation.getPosition();
      this._lastReroutePos = p.isLocated ? { lat: p.lat, lng: p.lng } : null;
    }
  }

  /**
   * The phone tab bar. Two tabs switch the map layer, one runs the primary
   * action, two open panels. Nothing here duplicates logic — each tab calls
   * the same method its old control did.
   */
  bindTabBar() {
    const bar = document.getElementById('tabbar');
    if (!bar) return;

    bar.addEventListener('click', (e) => {
      const item = e.target.closest('.tabbar-item');
      if (!item) return;

      switch (item.dataset.tab) {
        case 'ev':
          if (ui.statsMode === 'parking') this.toggleParking(false);
          else ui.setActiveTab('ev');
          break;

        case 'parking':
          if (ui.statsMode !== 'parking') this.toggleParking(true);
          else ui.setActiveTab('parking');
          break;

        case 'find':
          // The search can take a second or two on a cold GPS fix, so the
          // icon says so instead of leaving the tap unanswered.
          item.classList.add('is-busy');
          Promise.resolve(this.handleFindNearest())
            .finally(() => item.classList.remove('is-busy'));
          break;

        case 'analytics':
          if (stationAnalytics.isOpen()) {
            stationAnalytics.close();
          } else {
            ui.closeMobileDrawer();
            stationAnalytics.open();
            ui.setActiveTab('analytics');
          }
          break;

        case 'more':
          ui.toggleMobileDrawer();
          break;
      }
    });

    // The analytics panel can also be closed by its own X, the scrim or Esc,
    // so the pill follows the panel rather than the tap that opened it.
    const modal = document.getElementById('an-modal');
    if (modal) {
      new MutationObserver(() => {
        if (!modal.classList.contains('is-open') &&
            document.getElementById('tab-analytics')?.classList.contains('is-active')) {
          ui.syncTabToMode();
        }
      }).observe(modal, { attributes: true, attributeFilter: ['class'] });
    }

    requestAnimationFrame(() => ui.setActiveTab('ev'));
  }

  /** Fly to the closest paid parking strip and open its card. */
  async handleFindNearestZone() {
    ui.showLoading();
    try {
      const loc = await geoLocation
        .getUserLocation({ force: false, maxAgeMs: 30000 })
        .catch(() => null);

      const pos = loc ? { lat: loc.lat, lng: loc.lng } : geoLocation.getPosition();
      if (loc) {
        stationMap.setUserLocation(pos.lat, pos.lng);
        document.getElementById('loc-btn')?.classList.add('is-located');
      }

      const nearest = parkingAPI.nearestZone(pos.lat, pos.lng);
      ui.hideLoading();

      if (!nearest) {
        ui.showToast(i18n.t('pkNoZones'), 'warning');
        return;
      }

      stationMap.openZonePopup(nearest.zone.id);
      const d = GeoLocation.formatDistance(nearest.meters / 1000);
      ui.showToast(
        `${i18n.t('pkPaidZone')} · ${d.value} ${i18n.t(d.unit)}`,
        'info',
        3000
      );
    } catch (err) {
      ui.hideLoading();
      ui.showToast(i18n.t('errorLoading'), 'error');
    }
  }

  async handleFindNearest() {
    // In parking mode the button hunts bays — a "find nearest charger" while
    // no charger is drawn would be a button lying about what it does.
    if (ui.statsMode === 'parking') return this.handleFindNearestZone();

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
   * First-visit consent card. Explains the value, then only triggers the
   * native geolocation prompt if the user chooses "Allow". Choice is
   * remembered so the card never nags on return visits.
   */
  showLocationConsent() {
    const card = document.getElementById('loc-consent');
    if (!card) return;

    const allow = document.getElementById('loc-consent-allow');
    const deny  = document.getElementById('loc-consent-deny');

    const onKey = (e) => { if (e.key === 'Escape') decide('denied'); };
    const close = () => {
      card.classList.remove('is-active');
      document.removeEventListener('keydown', onKey);
    };

    const decide = async (choice) => {
      localStorage.setItem(this.CONSENT_KEY, choice);
      close();
      if (choice !== 'granted') return;
      ui.showLoading();
      const located = await this.acquireLocation();
      ui.hideLoading();
      if (located && typeof stationNotifications !== 'undefined') {
        stationNotifications.showNearbyNow();
      }
    };

    allow.addEventListener('click', () => decide('granted'), { once: true });
    deny.addEventListener('click', () => decide('denied'), { once: true });
    document.addEventListener('keydown', onKey);

    card.classList.add('is-active');
    requestAnimationFrame(() => allow.focus());
  }

  /**
   * Fetch the device location and wire up the map marker, camera, live
   * tracking and notification seeding. Shared by the consent flow and by
   * returning users who already granted access. Returns true if located.
   */
  async acquireLocation() {
    const pos = await geoLocation
      .getUserLocation({ highAccuracy: true })
      .catch(() => null);
    if (!pos || !geoLocation.isLocated) return false;

    stationMap.setUserLocation(pos.lat, pos.lng, {
      accuracy: geoLocation.userAccuracy,
      heading: geoLocation.userHeading,
      animate: false,
    });
    stationMap.flyTo(pos.lat, pos.lng, 14);
    document.getElementById('loc-btn')?.classList.add('is-located');
    this.startLiveTracking();

    if (typeof stationNotifications !== 'undefined' && !stationNotifications.seeded) {
      const stations = stationAPI.getStations();
      if (stations?.length) {
        stationNotifications.seedStates(stations, geoLocation.userLat, geoLocation.userLng);
      }
    }
    return true;
  }

  /**
   * Live tracking — user marker smoothly follows device as it moves.
   * Auto-re-routes active route and keeps sidebar distances fresh.
   */
  startLiveTracking() {
    if (this._liveTrackingStarted) return;
    this._liveTrackingStarted = true;
    this._lastReroute = 0;
    this._lastReroutePos = null;
    this._lastSidebarRefresh = 0;

    // Tuning (metres / ms)
    const ARRIVE_M = 40;        // within this of destination → arrived
    const OFFROUTE_M = 45;      // drifted this far off the drawn line → recalc fast
    const MOVE_M = 25;          // meaningful progress before a periodic recalc
    const MIN_REROUTE_MS = 6000;   // never hit OSRM more often than this
    const MAX_REROUTE_MS = 20000;  // safety recalc even when barely moving
    const ACCURACY_MAX_M = 60; // ignore off-route recalc on jittery GPS fixes

    geoLocation.startWatching((snap) => {
      stationMap.setUserLocation(snap.lat, snap.lng, {
        accuracy: snap.accuracy,
        heading: snap.heading,
        animate: true,
      });

      const now = Date.now();

      // Paid-parking geofence rides on the same fix stream.
      if (typeof parkingSession !== 'undefined') parkingSession.onPosition(snap);

      // --- Live route tracking: arrival, off-route detection, throttled recalc ---
      if (stationRouter?.activeRoute) {
        const dest = stationRouter.activeRoute.station;
        const toDest = GeoLocation.distanceBetween(snap.lat, snap.lng, dest.lat, dest.lng) * 1000;

        if (toDest <= ARRIVE_M) {
          stationRouter.arrive();
        } else {
          const gpsOk = !Number.isFinite(snap.accuracy) || snap.accuracy < ACCURACY_MAX_M;
          const off = stationRouter.distanceToRoute(snap.lat, snap.lng);
          const moved = this._lastReroutePos
            ? GeoLocation.distanceBetween(snap.lat, snap.lng, this._lastReroutePos.lat, this._lastReroutePos.lng) * 1000
            : Infinity;
          const since = now - this._lastReroute;

          const needReroute =
            (gpsOk && off > OFFROUTE_M && since > MIN_REROUTE_MS) || // drifted off the line → correct fast
            (moved > MOVE_M && since > MIN_REROUTE_MS) ||            // progressed enough
            (since > MAX_REROUTE_MS);                               // periodic safety net

          if (needReroute) {
            this._lastReroute = now;
            this._lastReroutePos = { lat: snap.lat, lng: snap.lng };
            stationRouter.refreshFromCurrent();
          } else {
            // Between network recalcs, keep the panel ETA/distance live for free.
            stationRouter.updateProgress(snap.lat, snap.lng);
          }
        }
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
