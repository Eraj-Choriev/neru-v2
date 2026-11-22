// ============================================
// NerU v2 — App Controller
// ============================================

class App {
  constructor() {
    this.refreshInterval = null;
    this.REFRESH_MS = 30000; // 30 seconds
    this.initialized = false;
    this.CONSENT_KEY = 'neru-loc-consent'; // 'granted' | 'denied' | null (unasked)
    this._parkingRegion = null;
    this._recommendationGeneration = 0;
    this._lastGpsWarning = 0;
  }

  async init() {
    try {
      // Initialize UI
      ui.init();
      ui.showLoading('loadingStations', 'loadingStationsDetail');
      this.bindEvents();

      // Start the station request before MapGL setup so the network and map
      // initialization run in parallel instead of one after the other.
      const stationRequest = stationAPI.fetchStations();

      // Initialize map
      stationMap.init('map');
      // Refraction for the glass chrome, once the map's own controls exist.
      if (typeof liquidGlass !== 'undefined') liquidGlass.attach();

      // Initialize notifications early so enabled state is known before seeding
      if (typeof stationNotifications !== 'undefined') {
        stationNotifications.init();
      }

      // Independent feeds: a slow station API must not delay parking.
      this.loadParking();
      await this.loadStations(stationRequest);
      ui.hideLoading();

      // Location is gated behind a first-visit consent card, so the native
      // browser prompt only fires once the user has opted in.
      const consent = localStorage.getItem(this.CONSENT_KEY);
      if (consent === 'granted') {
        this.acquireLocation().then((located) => {
          if (located && typeof stationNotifications !== 'undefined') stationNotifications.showNearbyNow();
        }); // returning user — resume nearby recommendations after consent
      } else if (consent == null) {
        this.showLocationConsent();      // first visit — ask first
      }
      // consent === 'denied' → stay location-less; the location button re-offers it

      this.initialized = true;

      // Start auto-refresh
      this.startAutoRefresh();


      // Set initial language buttons
      ui.updateLangButtons(i18n.getLang());

      console.log('✅ NerU v2 initialized');
    } catch (error) {
      console.error('Init error:', error);
      ui.hideLoading();
      ui.showToast(i18n.t('errorLoading'), 'error', 5000);
    }
  }

  async loadStations(stationRequest = stationAPI.fetchStations()) {
    const stations = await stationRequest;
    if (stationAPI.lastFetch && stationAPI.lastFetch !== this._processedSnapshot) {
      this._processedSnapshot = stationAPI.lastFetch;
      const filtered = ui.applyFilter(stations);
      // MapGL updates changed markers and the selected card without closing it.
      stationMap.renderStations(filtered);

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
    if (!this._parkingSessionInitialized) {
      parkingSession.init();
      this._parkingSessionInitialized = true;
    }

    const zones = await parkingAPI.fetchZones();
    const regions = parkingAPI.getRegions();
    if (this._parkingRegion !== null && !regions.some((region) => region.key === this._parkingRegion)) {
      this._parkingRegion = null;
    }
    ui.renderParkingRegions(regions, this._parkingRegion);
    if (!zones.length) {
      if (this._parkingVisible) ui.updateParkingStats(parkingAPI.getMappedStats(this._parkingRegion));
      return;
    }

    stationMap.renderParkingZones(zones);
    stationMap.setParkingRegion(this._parkingRegion);
    stationMap.setParkingVisible(this._parkingVisible === true);
    ui.renderParkingRegions(regions, this._parkingRegion);
    if (this._parkingVisible) {
      ui.setStatsMode('parking');
      ui.updateParkingStats(parkingAPI.getMappedStats(this._parkingRegion));
    }
  }

  toggleParking(force = null) {
    const zones = parkingAPI.getZones();
    if (!zones.length && force !== false) {
      this._parkingVisible = force === null ? true : !!force;
      ui.showToast(i18n.t('dataRetrying'), 'info', 3000);
      this.loadParking();
      return;
    }

    const next = force === null ? !stationMap.isParkingVisible() : !!force;
    this._parkingVisible = next;

    // One errand at a time: parking hides the chargers, and everything that
    // describes the map — the HUD, the charger filter, the find button —
    // follows the layer instead of contradicting it.
    stationMap.setParkingVisible(next);
    if (ui.sidebarOpen) ui.closeSidebar();
    if (!next) ui.closeParkingRegions();
    ui.setStatsMode(next ? 'parking' : 'ev');
    if (next) {
      ui.renderParkingRegions(parkingAPI.getRegions(), this._parkingRegion);
      ui.updateParkingStats(parkingAPI.getMappedStats(this._parkingRegion));
    }
    else ui.updateStats(stationAPI.getStats());

    document.getElementById('pk-toggle')?.classList.toggle('is-active', next);
    document.getElementById('pk-toggle')?.setAttribute('aria-pressed', String(next));

    ui.showToast(i18n.t(next ? 'pkZonesOn' : 'pkZonesOff'), 'info', 2000);
  }

  selectParkingRegion(region) {
    const key = region === null ? null : String(region).trim();
    const regions = parkingAPI.getRegions();
    if (key !== null && !regions.some((item) => item.key === key)) return;

    this._parkingRegion = key;
    stationMap.setParkingRegion(key);
    ui.updateParkingStats(parkingAPI.getMappedStats(key));
    ui.renderParkingRegions(regions, key);
    if (key !== null) stationMap.focusParkingRegion(parkingAPI.getZonesForRegion(key));
    ui.closeParkingRegions();
  }

  getDataStatusKey() {
    const stationsStale = stationAPI.lastError && (!stationAPI.lastFetch || Date.now() - stationAPI.lastFetch.getTime() >= 90000);
    const parkingStale = parkingAPI.lastError && (!parkingAPI.lastFetch || Date.now() - parkingAPI.lastFetch.getTime() >= PARKING_CACHE_TTL);
    if (stationsStale && parkingStale) return 'dataUnavailable';
    if (stationsStale) return 'stationsUnavailable';
    if (parkingStale) return 'parkingUnavailable';
    return null;
  }

  bindEvents() {
    const updateStatus = () => {
      const key = this.getDataStatusKey();
      const banner = document.getElementById('data-status');
      if (!banner) return;
      banner.hidden = !key;
      if (key) document.getElementById('data-status-text').textContent = i18n.t(key);
    };
    ['stationsLoaded', 'stationsError', 'parkingLoaded', 'parkingError', 'langchange']
      .forEach(event => window.addEventListener(event, updateStatus));
    document.getElementById('data-retry')?.addEventListener('click', () => {
      ui.showLoading('loadingStations', 'loadingStationsDetail');
      this.loadStations().finally(() => ui.hideLoading());
      this.loadParking();
    });
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
      if (!stationAPI.lastFetch) ui.showToast(i18n.t('errorLoading'), 'error');
    });

    // In-app route request (from popup or sidebar card)
    window.addEventListener('routeRequest', (e) => this.handleRouteRequest(e.detail));

    // Analytics panel
    document.getElementById('an-trigger')?.addEventListener('click', () => stationAnalytics.open());
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
    window.addEventListener('parkingRegionRequest', (e) => {
      this.selectParkingRegion(e.detail?.region ?? null);
    });
    this.bindTabBar();
    const modeSwitch = document.getElementById('map-mode-seg');
    modeSwitch?.addEventListener('click', e => {
      const button = e.target.closest('[data-map-mode]');
      if (button) this.toggleParking(button.dataset.mapMode === 'parking');
    });
    if (modeSwitch) {
      new ResizeObserver(() => ui.moveIndicator(modeSwitch)).observe(modeSwitch);
      window.addEventListener('langchange', () => requestAnimationFrame(() => ui.moveIndicator(modeSwitch)));
    }
    window.addEventListener('parkingRulesRequest', () => parkingRules.open());
    window.addEventListener('parkingStartRequest', (e) => {
      parkingSession.startManual(e.detail?.zoneId);
      stationMap.closePopup();
    });
    document.getElementById('pk-close')?.addEventListener('click', () => parkingRules.close());
    document.getElementById('pk-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'pk-modal') parkingRules.close();
    });
    window.addEventListener('langchange', () => {
      parkingRules.refresh();
      stationMap.refreshParkingPopups(parkingAPI.getZones());
    });

  }

  async handleRouteRequest({ stationId, connectorId }) {
    if (stationId == null) return;

    // Refresh an aging connector snapshot before choosing a physical socket.
    if (typeof stationAPI.fetchStations === 'function') {
      const statusAge = stationAPI.lastFetch ? Date.now() - stationAPI.lastFetch.getTime() : Infinity;
      const refreshDue = statusAge > 15000;
      if (refreshDue) {
        const snapshotBeforeRefresh = stationAPI.lastFetch;
        const refreshed = await stationAPI.fetchStations().catch(() => null);
        if (stationAPI.lastFetch && stationAPI.lastFetch !== snapshotBeforeRefresh && Array.isArray(refreshed)) {
          await this.loadStations(Promise.resolve(refreshed));
        }
      }
      const latestAge = stationAPI.lastFetch ? Date.now() - stationAPI.lastFetch.getTime() : Infinity;
      if (latestAge > 60000 || (refreshDue && stationAPI.lastError && latestAge > 15000)) {
        ui.showToast(i18n.t('stationStatusUnavailable'), 'warning', 4500);
        return;
      }
    }

    const station = stationAPI.getStationById(stationId);
    if (!station) return;
    const hasConnectorFinder = typeof stationFinder !== 'undefined';
    const available = hasConnectorFinder ? stationFinder.getAvailableConnectors(station) : [];
    const requestedId = connectorId == null || String(connectorId).trim() === '' ? null : String(connectorId);
    let connector = !hasConnectorFinder ? null : requestedId == null
      ? stationFinder.getRecommendedConnector(station)
      : available.find((item) => String(item.id) === requestedId);
    const targetChanged = requestedId != null && !connector;
    if (targetChanged) connector = available[0] || null;
    if (hasConnectorFinder && !connector) {
      ui.showToast(i18n.t('noAvailableConnectors'), 'warning', 4000);
      return;
    }

    // A route is only useful if it follows the car. Asking for one is
    // explicit intent, so locate now if we have to, and make sure the GPS
    // watch is running — "find nearest" and the startup consent card can
    // both leave the app located without it, which drew a route that never
    // moved, never re-routed and never announced arrival.
    const currentPosition = geoLocation.getPosition();
    if (!currentPosition.isLocated || currentPosition.ageMs > 30000) {
      const located = await geoLocation.getUserLocation({ highAccuracy: true }).catch(() => null);
      if (!located) {
        ui.showToast(i18n.t('locationUnavailable'), 'warning', 3500);
        return;
      }
      stationMap.setUserLocation(located.lat, located.lng, { accuracy: geoLocation.userAccuracy, heading: geoLocation.userHeading });
      document.getElementById('loc-btn')?.classList.add('is-located');
    }
    if (ui.sidebarOpen) ui.closeSidebar();
    this.startLiveTracking();
    this._arrivalFixes = 0;
    this._offRouteFixes = 0;
    await stationRouter.routeTo(station, connector);
    if (targetChanged && stationRouter.activeRoute?.connectorId === String(connector.id)) {
      ui.showToast(i18n.t('connectorChanged'), 'info', 3500);
    }
    // The route panel names the destination; the card would only cover the line.
    if (stationRouter.activeRoute && stationMap.popupId === String(station.id)) stationMap.closePopup();
    // Seed re-route throttle so we don't immediately re-fetch a route we just built.
    if (stationRouter.activeRoute) {
      this._lastReroute = Date.now();
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
      // On phones the analytics sheet stops above the tab bar, so the bar
      // stays live under it: going to another tab closes the sheet first.
      if (item.dataset.tab !== 'analytics' && stationAnalytics.isOpen()) stationAnalytics.close();

      switch (item.dataset.tab) {
        case 'ev':
          if (ui.statsMode === 'parking') this.toggleParking(false);
          else ui.setActiveTab('ev');
          break;

        case 'parking':
          if (ui.statsMode !== 'parking') this.toggleParking(true);
          else ui.setActiveTab('parking');
          break;

        case 'analytics':
          if (stationAnalytics.isOpen()) {
            stationAnalytics.close();
          } else {
            stationAnalytics.open();
            ui.setActiveTab('analytics');
          }
          break;
      }
    });

    const search = document.getElementById('tab-find');
    search?.addEventListener('click', async () => {
      if (search.getAttribute('aria-busy') === 'true') return;
      if (stationAnalytics.isOpen()) stationAnalytics.close();
      search.setAttribute('aria-busy', 'true');
      try {
        await this.handleFindNearest();
      } finally {
        search.removeAttribute('aria-busy');
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

    ui.bindTabPressure();
    requestAnimationFrame(() => ui.setActiveTab('ev'));
  }

  /** Fly to the closest paid parking strip and open its card. */
  async handleFindNearestZone() {
    ui.showLoading('findingNearestZone', 'loadingLocationDetail');
    try {
      const loc = await geoLocation
        .getUserLocation({ force: false, maxAgeMs: 30000 })
        .catch(() => null);

      const pos = loc || geoLocation.getPosition();
      if (!pos.isLocated) {
        ui.hideLoading();
        ui.showToast(i18n.t('locationUnavailable'), 'warning');
        return;
      }
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
    const generation = ++this._recommendationGeneration;
    // In parking mode the button hunts bays — a "find nearest charger" while
    // no charger is drawn would be a button lying about what it does.
    if (ui.statsMode === 'parking') return this.handleFindNearestZone();

    ui.showLoading('findingNearest', 'loadingLocationDetail');
    try {
      const snapshotBeforeFetch = stationAPI.lastFetch;
      const [loc, fetchedStations] = await Promise.all([
        geoLocation.getUserLocation({ force: false, maxAgeMs: 30000 }).catch(() => null),
        stationAPI.fetchStations().catch(() => null),
      ]);
      if (generation !== this._recommendationGeneration) return;
      if (stationAPI.lastFetch && stationAPI.lastFetch !== snapshotBeforeFetch && Array.isArray(fetchedStations)) {
        await this.loadStations(Promise.resolve(fetchedStations));
      }

      const pos = loc || geoLocation.getPosition();
      if (!pos.isLocated) {
        ui.hideLoading();
        ui.showToast(i18n.t('locationUnavailable'), 'warning');
        return;
      }
      stationMap.setUserLocation(pos.lat, pos.lng);
      this.startLiveTracking();
      document.getElementById('loc-btn')?.classList.add('is-located');

      const statusAge = stationAPI.lastFetch ? Date.now() - stationAPI.lastFetch.getTime() : Infinity;
      if (statusAge > 60000 || (stationAPI.lastError && statusAge > 15000)) {
        ui.hideLoading();
        ui.showToast(i18n.t('stationStatusUnavailable'), 'warning', 4500);
        return;
      }

      const stations = stationAPI.getStations() || [];
      if (!stations.length) {
        ui.hideLoading();
        ui.showToast(i18n.t('noStations'), 'warning');
        return;
      }

      const candidates = stationFinder.findNearestStations(stations, pos.lat, pos.lng, 12);
      const results = candidates.slice(0, 5);
      ui.hideLoading();

      if (results && results.length) {
        stationFinder.setResults(results);
        ui.openSidebar(results);
        stationMap.highlightStation(results[0]);
        ui.showToast(`${i18n.t('bestChoice')}: ${results[0].name}`, 'success');

        // Show the nearest available connectors immediately, then refine the
        // order with one batched road-time matrix if the public service responds.
        try {
          const roadRanked = await stationRouter.rankByDriveTime(
            { lat: pos.lat, lng: pos.lng, isLocated: true },
            candidates,
          );
          if (generation !== this._recommendationGeneration || !ui.sidebarOpen) return;
          const recommendations = roadRanked.slice(0, 5);
          stationFinder.setResults(recommendations);
          ui.renderResults(recommendations);
          if (recommendations[0] && String(recommendations[0].id) !== String(results[0].id) &&
              String(stationMap.popupId) === String(results[0].id)) {
            stationMap.highlightStation(recommendations[0]);
          }
        } catch (_) {
          // Keep the local straight-line order when the public matrix is offline.
        }
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
        if (pos.isLocated) stationMap.flyTo(pos.lat, pos.lng, Math.max(16, stationMap.map.getZoom()));
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
      stationMap.flyTo(pos.lat, pos.lng, 16);
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
      ui.showLoading('gettingLocation', 'loadingLocationDetail');
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
    if (this._liveTrackingStarted && geoLocation.isWatching()) return;
    this._liveTrackingStarted = true;
    this._lastReroute = 0;
    this._lastSidebarRefresh = 0;
    this._arrivalFixes = 0;
    this._offRouteFixes = 0;

    // Tuning (metres / ms)
    const ARRIVE_M = 40;          // destination arrival radius (bounded by fix accuracy)
    const OFFROUTE_M = 45;        // distance from route line before confirmation
    const MIN_REROUTE_MS = 12000; // minimum interval between OSRM requests
    const MAX_REROUTE_MS = 45000; // safety recalc while location remains reliable
    const ACCURACY_MAX_M = 60;    // ignore poor fixes for rerouting and arrival
    const FIX_MAX_AGE_MS = 15000; // stale watch fixes must not move the route state

    geoLocation.startWatching((snap) => {
      const now = Date.now();
      const fixTime = Number.isFinite(snap.timestamp) ? snap.timestamp : now;
      const fixFresh = now - fixTime <= FIX_MAX_AGE_MS;
      if (!fixFresh) return;
      stationMap.setUserLocation(snap.lat, snap.lng, {
        accuracy: snap.accuracy,
        heading: snap.heading,
        animate: true,
      });

      // Paid-parking geofence rides on the same fix stream.
      if (fixFresh && typeof parkingSession !== 'undefined') parkingSession.onPosition(snap);

      // --- Live route tracking: arrival, off-route detection, throttled recalc ---
      if (stationRouter?.activeRoute && fixFresh) {
        const dest = stationRouter.activeRoute.station;
        const toDest = GeoLocation.distanceBetween(snap.lat, snap.lng, dest.lat, dest.lng) * 1000;
        const gpsOk = Number.isFinite(snap.accuracy) && snap.accuracy <= ACCURACY_MAX_M;
        const arrivalRadius = Number.isFinite(snap.accuracy)
          ? Math.max(20, Math.min(ARRIVE_M, snap.accuracy))
          : ARRIVE_M;

        if (gpsOk && toDest <= arrivalRadius) this._arrivalFixes++;
        else this._arrivalFixes = 0;
        if (this._arrivalFixes >= 2) {
          stationRouter.arrive();
          this._arrivalFixes = 0;
          this._offRouteFixes = 0;
        } else if (gpsOk) {
          const off = stationRouter.distanceToRoute(snap.lat, snap.lng);
          if (off > OFFROUTE_M) this._offRouteFixes++;
          else this._offRouteFixes = 0;

          const since = now - this._lastReroute;
          const needReroute =
            (this._offRouteFixes >= 2 && since > MIN_REROUTE_MS) ||
            (since > MAX_REROUTE_MS);

          if (needReroute) {
            this._lastReroute = now;
            this._offRouteFixes = 0;
            stationRouter.refreshFromCurrent();
          } else {
            stationRouter.updateProgress(snap.lat, snap.lng);
          }
        } else {
          this._arrivalFixes = 0;
        }
      }

      // If sidebar open with results, refresh distances every 5s
      if (fixFresh && ui.sidebarOpen && now - this._lastSidebarRefresh > 5000) {
        this._lastSidebarRefresh = now;
        const stations = stationAPI.getStations() || [];
        if (stations.length) {
          const results = stationFinder.findNearestStations(stations, snap.lat, snap.lng, 5);
          if (results?.length) ui.renderResults(results);
        }
      }
    }, (error, ageMs) => {
      if (!stationRouter?.activeRoute || (error?.code !== 1 && ageMs <= FIX_MAX_AGE_MS)) return;
      const now = Date.now();
      if (now - this._lastGpsWarning < 60000) return;
      this._lastGpsWarning = now;
      ui.showToast(i18n.t(error?.code === 1 ? 'locationDenied' : 'locationUnavailable'), 'warning', 4500);
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
    const refresh = () => {
      if (document.hidden) return;
      this.loadStations();
      if (!parkingAPI.lastFetch || parkingAPI.lastError ||
          Date.now() - parkingAPI.lastFetch.getTime() > PARKING_CACHE_TTL) this.loadParking();
    };
    this.refreshInterval = setInterval(refresh, this.REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (this.initialized) refresh();
    });
    window.addEventListener('online', refresh);
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
