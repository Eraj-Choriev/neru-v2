// ============================================
// NerU v2 — Push Notifications Module
// In-app notification cards (primary) + native OS notification (background fallback)
// ============================================

class StationNotifications {
  constructor() {
    this.enabled = false;
    this.permission = 'default';
    this.previousStates = new Map(); // stationId -> hasAvailable
    this.watchRadiusKm = 1.0;
    this.seeded = false;
    this._stack = null; // #neru-notif-stack DOM container
    this._MAX_VISIBLE = 3; // max simultaneous cards
  }

  // ── Internal logger ───────────────────────────────────────────────────────
  _log(level, ...args) {
    const prefix = '[NerU:Notif]';
    if (level === 'error') console.error(prefix, ...args);
    else if (level === 'warn') console.warn(prefix, ...args);
    // info logs suppressed in production
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  init() {
    this._log('log', '🔔 Initializing notifications module...');

    this._ensureStack();

    if (!this.isSupported()) {
      this._log('warn', '❌ Notification API not supported in this browser — in-app cards will still work');
    } else {
      this.permission = Notification.permission;
      this._log('log', `📋 OS permission status: "${this.permission}"`);
    }

    const saved = localStorage.getItem('neru-notif-enabled');
    this._log('log', `💾 Saved preference: "${saved}"`);

    if (saved === 'true' && (this.permission === 'granted' || !this.isSupported())) {
      this.enabled = true;
      this._log('log', '✅ Notifications restored from saved preference');
    } else if (saved === 'true' && this.permission !== 'granted') {
      this._log('warn', `⚠️ Saved preference is "true" but OS permission is "${this.permission}"`);
      // Still enable — in-app cards work without OS permission
      this.enabled = true;
      this._log('log', '✅ Enabling in-app cards (OS permission not required)');
    }

    this._updateBtn();

    const btn = document.getElementById('notif-toggle');
    if (btn) {
      btn.addEventListener('click', () => this.handleClick());
      this._log('log', '🖱️ #notif-toggle click listener attached');
    } else {
      this._log('warn', '⚠️ #notif-toggle element not found in DOM');
    }
  }

  // Create the stack container once
  _ensureStack() {
    if (this._stack) return;
    let el = document.getElementById('neru-notif-stack');
    if (!el) {
      el = document.createElement('div');
      el.id = 'neru-notif-stack';
      document.body.appendChild(el);
    }
    this._stack = el;
    this._log('log', '📦 Notification stack container ready');
  }

  isSupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  // ── Toggle handler ────────────────────────────────────────────────────────
  async handleClick() {
    this._log('log', '🖱️ Notification toggle clicked', {
      currentlyEnabled: this.enabled,
      permission: this.permission,
      supported: this.isSupported(),
    });

    if (this.enabled) {
      this._log('log', '🔕 Disabling notifications');
      this.setEnabled(false);
      ui.showToast(i18n.t('notifDisabled'), 'info', 2500);

    } else {
      // Try to request OS permission (nice-to-have for background alerts)
      if (this.isSupported() && this.permission === 'default') {
        this._log('log', '🙋 Requesting OS permission...');
        const result = await Notification.requestPermission();
        this.permission = result;
        this._log('log', `📋 OS permission result: "${result}"`);
      } else if (this.isSupported() && this.permission === 'denied') {
        this._log('warn', '🚫 OS permission denied — in-app cards will work, native alerts blocked');
      }

      this._log('log', '✅ Enabling notifications (in-app cards + OS if permitted)');
      this.setEnabled(true);
      ui.showToast(i18n.t('notifEnabled'), 'success', 2500);
      this._notifyAvailableNearby();
    }

    this._updateBtn();
  }

  setEnabled(val) {
    this.enabled = val;
    localStorage.setItem('neru-notif-enabled', val ? 'true' : 'false');
    this._updateBtn();
    this._log('log', `🔔 Notifications ${val ? 'ENABLED ✅' : 'DISABLED 🔕'}`);
  }

  _updateBtn() {
    const btn = document.getElementById('notif-toggle');
    if (!btn) return;
    btn.classList.toggle('is-active', this.enabled);
    btn.setAttribute('aria-pressed', String(this.enabled));
    btn.title = i18n.t(this.enabled ? 'notifDisableTitle' : 'notifEnableTitle');
  }

  // ── Seeding ───────────────────────────────────────────────────────────────
  seedStates(stations, userLat, userLng) {
    if (userLat == null || userLng == null) {
      this._log('warn', '⚠️ seedStates() called without valid coordinates — skipping');
      return;
    }

    let seededCount = 0;
    stations.forEach(s => {
      if (!s.lat || !s.lng) return;
      const dist = GeoLocation.distanceBetween(userLat, userLng, s.lat, s.lng);
      if (dist <= this.watchRadiusKm) {
        this.previousStates.set(String(s.id), s.hasAvailable);
        seededCount++;
      }
    });

    this.seeded = true;
    this._log('log', `🌱 Seeded ${seededCount} / ${stations.length} stations within ${this.watchRadiusKm}km`);
  }

  // ── Public: called after user location is obtained (location button tap) ─────
  // Shows free station cards regardless of whether the bell is toggled.
  showNearbyNow() {
    this._log('log', '📍 showNearbyNow() — location just obtained, scanning for free stations...');

    const pos = geoLocation.getPosition();
    if (!pos.isLocated) {
      this._log('warn', '⚠️ showNearbyNow(): location still not available');
      return;
    }

    const stations = stationAPI.getStations();
    if (!stations.length) {
      this._log('warn', '⚠️ showNearbyNow(): no stations loaded yet');
      return;
    }

    const available = stations
      .filter(s => s.lat && s.lng && s.hasAvailable)
      .map(s => ({ ...s, _dist: GeoLocation.distanceBetween(pos.lat, pos.lng, s.lat, s.lng) }))
      .filter(s => s._dist <= this.watchRadiusKm)
      .sort((a, b) => a._dist - b._dist);

    this._log('log', `📊 showNearbyNow: ${available.length} free station(s) within ${this.watchRadiusKm}km`);

    if (available.length === 0) {
      this._log('log', '📭 No free stations in radius — nothing to show');
      return;
    }

    // Show up to MAX_VISIBLE cards, nearest first
    available.slice(0, this._MAX_VISIBLE).forEach(s => {
      this._showInAppCard(s, s._dist);
    });
  }

  // ── Immediate check (called right after enabling) ─────────────────────────
  _notifyAvailableNearby() {
    this._log('log', '🔍 Checking for available stations nearby (immediate check)...');

    if (!this.enabled) {
      this._log('warn', '⚠️ Skipping: notifications not enabled');
      return;
    }

    const pos = geoLocation.getPosition();
    this._log('log', `📍 Location state: isLocated=${pos.isLocated}, lat=${pos.lat?.toFixed(5)}, lng=${pos.lng?.toFixed(5)}`);

    if (!pos.isLocated) {
      this._log('warn', '⚠️ Location not yet obtained — tap "My Location" first');
      return;
    }

    const stations = stationAPI.getStations();
    this._log('log', `📡 Stations in cache: ${stations.length}`);

    if (!stations.length) {
      this._log('warn', '⚠️ No stations loaded yet');
      return;
    }

    const withCoords = stations.filter(s => s.lat && s.lng);
    const withDist   = withCoords.map(s => ({
      ...s,
      _dist: GeoLocation.distanceBetween(pos.lat, pos.lng, s.lat, s.lng),
    }));
    const inRadius  = withDist.filter(s => s._dist <= this.watchRadiusKm);
    const available = inRadius.filter(s => s.hasAvailable).sort((a, b) => a._dist - b._dist);

    this._log('log', '📊 Proximity breakdown:', {
      total: stations.length,
      hasCoords: withCoords.length,
      withinRadius: inRadius.length,
      availableInRadius: available.length,
      radiusKm: this.watchRadiusKm,
    });

    if (available.length > 0) {
      const nearest = available[0];
      this._log('log', `🎯 Nearest available: "${nearest.name}" at ${nearest._dist.toFixed(2)}km`);
      this._fire(nearest, nearest._dist);
    } else if (inRadius.length > 0) {
      this._log('log', `📭 ${inRadius.length} station(s) in radius but none have free connectors`);
    } else {
      this._log('log', `📭 No stations within ${this.watchRadiusKm}km`);
    }
  }

  // ── Periodic check ────────────────────────────────────────────────────────
  checkStations(stations, userLat, userLng) {
    if (!this.enabled) return;

    if (!this.seeded) {
      this._log('warn', '⚠️ checkStations() called before seedStates() — skipping');
      return;
    }

    if (userLat == null || userLng == null) {
      this._log('warn', '⚠️ checkStations(): no user coordinates');
      return;
    }

    let transitions = 0;
    let checked = 0;

    stations.forEach(s => {
      if (!s.lat || !s.lng) return;
      const dist = GeoLocation.distanceBetween(userLat, userLng, s.lat, s.lng);
      if (dist > this.watchRadiusKm) return;

      checked++;
      const key  = String(s.id);
      const prev = this.previousStates.get(key);

      if (prev === false && s.hasAvailable === true) {
        this._log('log', `🎉 TRANSITION: "${s.name}" (id=${s.id}) BUSY → FREE at ${dist.toFixed(2)}km`);
        this._fire(s, dist);
        transitions++;
      }

      this.previousStates.set(key, s.hasAvailable);
    });

    this._log('log', `🔄 checkStations complete — ${checked} stations within radius, ${transitions} busy→free transition(s) found`);
  }

  // ── Main fire method ──────────────────────────────────────────────────────
  _fire(station, distKm) {
    this._log('log', `🚀 _fire() for "${station.name}" at ${distKm?.toFixed(2)}km`);

    // Primary: in-app card (always works)
    this._showInAppCard(station, distKm);

    // Secondary: native OS notification (background only, best-effort)
    if (this.isSupported() && Notification.permission === 'granted') {
      this._fireNative(station, distKm);
    } else {
      this._log('log', `ℹ️ Native notification skipped (permission="${Notification.permission}")`);
    }
  }

  // ── In-app notification card ──────────────────────────────────────────────
  _showInAppCard(station, distKm) {
    this._ensureStack();

    // Trim oldest card if stack is full
    const existing = this._stack.querySelectorAll('.neru-nc');
    if (existing.length >= this._MAX_VISIBLE) {
      this._dismissCard(existing[0], true);
    }

    const AUTO_DISMISS_MS = 9000;
    const distKmSafe = distKm ?? 0;
    const d        = GeoLocation.formatDistance(distKmSafe);
    const walkMin  = Math.round(distKmSafe * 12);
    const walkText = walkMin > 0 ? `~${walkMin} ${i18n.t('minSuffix')}` : '';
    const freeCount = station.freeConnectors ?? '?';
    const totalCount = station.totalConnectors ?? '?';

    const card = document.createElement('div');
    card.className = 'neru-nc';
    card.setAttribute('role', 'alert');
    card.setAttribute('aria-live', 'assertive');
    card.dataset.stationId = station.id;

    card.innerHTML = `
      <div class="neru-nc-bar"></div>
      <div class="neru-nc-body">
        <div class="neru-nc-logo" aria-hidden="true">
          <img src="logo.png" alt="NŪR" />
        </div>
        <div class="neru-nc-text">
          <div class="neru-nc-eyebrow">⚡ ${this._esc(i18n.t('notifTitle'))}</div>
          <div class="neru-nc-title">${this._esc(station.name)}</div>
          <div class="neru-nc-meta">
            <span class="neru-nc-badge">
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3 12a9 9 0 1 0 18 0 9 9 0 0 0-18 0M12 8v4l3 3"/>
              </svg>
              ${this._esc(d.value)} ${this._esc(i18n.t(d.unit))}${walkText ? ' · ' + this._esc(walkText) : ''}
            </span>
            <span class="neru-nc-connectors">${this._esc(freeCount)}/${this._esc(totalCount)} ${this._esc(i18n.t('available'))}</span>
          </div>
        </div>
      </div>
      <div class="neru-nc-actions">
        <button class="neru-nc-btn-map" type="button">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
          </svg>
          ${this._esc(i18n.t('navigateTo'))}
        </button>
        <button class="neru-nc-btn-route" type="button">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polyline points="3 12 5 10 9 14 15 8 19 12"/><path d="M3 18h18"/>
          </svg>
          ${this._esc(i18n.t('routeLabel'))}
        </button>
        <button class="neru-nc-dismiss" type="button" aria-label="Dismiss">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18"/>
          </svg>
        </button>
      </div>
      <div class="neru-nc-progress">
        <div class="neru-nc-progress-fill" style="animation-duration: ${AUTO_DISMISS_MS}ms"></div>
      </div>
    `;

    // "Показать на карте" — flies to station and opens its popup with connector details
    card.querySelector('.neru-nc-btn-map').addEventListener('click', () => {
      this._log('log', `🗺️ "Show on map" clicked for "${station.name}"`);
      this._dismissCard(card);
      stationMap.openStationPopup(station.id);
    });

    // "Настроить маршрут" — builds turn-by-turn route via the router module
    card.querySelector('.neru-nc-btn-route').addEventListener('click', () => {
      this._log('log', `🧭 "Route" clicked for "${station.name}"`);
      this._dismissCard(card);
      window.dispatchEvent(new CustomEvent('routeRequest', { detail: { stationId: station.id } }));
    });

    card.querySelector('.neru-nc-dismiss').addEventListener('click', () => {
      this._dismissCard(card);
    });

    this._stack.appendChild(card);

    // Auto-dismiss
    const timer = setTimeout(() => this._dismissCard(card), AUTO_DISMISS_MS);
    card._dismissTimer = timer;

    this._log('log', `✅ In-app card shown for "${station.name}" — buttons: [Show on map] [Route] [×]`);
  }

  _dismissCard(card, immediate = false) {
    if (!card || !card.parentNode) return;
    clearTimeout(card._dismissTimer);
    if (immediate) {
      card.parentNode.removeChild(card);
      return;
    }
    card.classList.add('is-leaving');
    card.addEventListener('animationend', () => {
      if (card.parentNode) card.parentNode.removeChild(card);
    }, { once: true });
  }

  // ── Native OS notification (background fallback) ───────────────────────────
  _fireNative(station, distKm) {
    this._log('log', `📣 Attempting native OS notification for "${station.name}"...`);

    const d        = GeoLocation.formatDistance(distKm);
    const walkMin  = Math.round(distKm * 12);
    const walkText = walkMin > 0 ? ` · ~${walkMin} ${i18n.t('minSuffix')}` : '';
    const title    = `⚡ ${i18n.t('notifTitle')}`;
    const options  = {
      body: `${station.name}\n${d.value} ${i18n.t(d.unit)}${walkText}`,
      tag: `neru-${station.id}`,
      icon: 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">⚡</text></svg>'
      ),
      requireInteraction: false,
    };

    try {
      const notif = new Notification(title, options);
      notif.onshow  = () => this._log('log', `✅ Native notification SHOWN by OS for "${station.name}"`);
      notif.onerror = (e) => this._log('error', `❌ Native notification ERROR for "${station.name}":`, e);
      notif.onclick = () => {
        window.focus();
        this._dismissCard(this._stack?.querySelector(`[data-station-id="${station.id}"]`));
        stationMap.openStationPopup(station.id);
        notif.close();
      };
    } catch (err) {
      this._log('error', '❌ Native Notification() constructor failed:', err.name, err.message);
    }
  }

  // ── Dev helper ───────────────────────────────────────────────────────────
  // Usage in browser console: stationNotifications.sendTestNotification()
  sendTestNotification() {
    this._log('log', '🧪 sendTestNotification() called — showing test card');

    // Try to use a real station if available, otherwise use fake data
    const realStations = (typeof stationAPI !== 'undefined') ? stationAPI.getStations() : [];
    const station = realStations.length > 0
      ? realStations[0]
      : { id: 'test-999', name: 'NerU Test Station ⚡', freeConnectors: 2, totalConnectors: 4 };

    this._showInAppCard(station, 0.35);
    this._log('log', `✅ Test card fired for "${station.name}"`);

    if (this.isSupported() && Notification.permission === 'granted') {
      this._fireNative(station, 0.35);
    } else {
      this._log('log', `ℹ️ Native OS notification skipped — permission="${this.isSupported() ? Notification.permission : 'unsupported'}"`);
    }
  }

  _esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }
}

const stationNotifications = new StationNotifications();
