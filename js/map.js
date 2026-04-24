// ============================================
// NerU v2 — Map Module (Leaflet.js)
// ============================================

class StationMap {
  constructor() {
    this.map = null;
    this.markers = [];
    this.markerLayer = null;
    this.userMarker = null;
    this.userAccuracyCircle = null;
    this.routeLine = null;
    this.highlightCircle = null;
    this.tileLayer = null;
    this._followUser = false; // auto-pan map to follow user when true
    this._cumHeading = null;  // accumulated rotation (for shortest-path CSS transition)
    this._lastHeading = null;
  }

  _buildTileLayer(theme) {
    const url = theme === 'light'
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    return L.tileLayer(url, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    });
  }

  setTheme(theme) {
    if (!this.map) return;
    const next = theme === 'light' ? 'light' : 'dark';
    if (this.tileLayer) this.map.removeLayer(this.tileLayer);
    this.tileLayer = this._buildTileLayer(next);
    this.tileLayer.addTo(this.map);
  }

  init(containerId = 'map') {
    const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    this.tileLayer = this._buildTileLayer(currentTheme);

    this.map = L.map(containerId, {
      center: [38.5598, 68.7738],
      zoom: 13,
      layers: [this.tileLayer],
      zoomControl: false,
    });

    // Zoom control in bottom-right
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    this.markerLayer = L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 40, // Groups markers if they are closer than 40px
      spiderLegPolylineOptions: { weight: 2, color: '#6b7280', opacity: 0.5 },
      iconCreateFunction: function(cluster) {
        const count = cluster.getChildCount();
        
        // Find if any marker inside has free connectors or yellow status
        const markers = cluster.getAllChildMarkers();
        let clusterClass = 'cluster-red';
        
        if (markers.some(m => m.options.icon.options.className.includes('marker-green'))) {
          clusterClass = 'cluster-green';
        } else if (markers.some(m => m.options.icon.options.className.includes('marker-yellow'))) {
          clusterClass = 'cluster-yellow';
        }

        return L.divIcon({
          html: `<div class="cluster-inner"><span>${count}</span><div class="cluster-ring"></div></div>`,
          className: `custom-cluster ${clusterClass}`,
          iconSize: [40, 40],
          iconAnchor: [20, 20]
        });
      }
    });

    this.map.addLayer(this.markerLayer);

    // User-initiated drag disables follow-mode (like Google Maps)
    this.map.on('dragstart', () => {
      if (this._followUser) {
        this._followUser = false;
        document.getElementById('loc-btn')?.classList.remove('is-following');
      }
    });

    // Delegate "Route" button clicks inside Leaflet popups
    this.map.getContainer().addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action="route"]');
      if (btn) {
        const id = btn.getAttribute('data-station-id');
        if (id) window.dispatchEvent(new CustomEvent('routeRequest', { detail: { stationId: id } }));
      }
    });

    return this.map;
  }

  createStationIcon(station) {
    let colorClass = 'marker-red';
    let pulseClass = '';
    
    const allFree = station.freeConnectors > 0 && station.freeConnectors === station.totalConnectors;
    const partialFree = station.freeConnectors > 0 && station.freeConnectors < station.totalConnectors;

    if (allFree) {
      colorClass = 'marker-green';
      pulseClass = 'marker-pulse';
    } else if (partialFree) {
      colorClass = 'marker-yellow';
    } else if (station.maxChargeLevel >= 80) {
      colorClass = 'marker-yellow';
    }

    return L.divIcon({
      className: `station-marker ${colorClass} ${pulseClass}`,
      html: `<div class="marker-inner">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
      </div>`,
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -36],
    });
  }

  createBestIcon() {
    return L.divIcon({
      className: 'station-marker marker-best marker-pulse',
      html: `<div class="marker-inner marker-inner-best">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
        </svg>
      </div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 44],
      popupAnchor: [0, -48],
    });
  }

  renderStations(stations) {
    this.markerLayer.clearLayers();
    this.markers = [];

    stations.forEach(station => {
      if (!station.lat || !station.lng) return;

      const icon = this.createStationIcon(station);
      const marker = L.marker([station.lat, station.lng], { icon })
        .addTo(this.markerLayer);

      // Popup content
      const popupHtml = this.buildPopup(station);
      marker.bindPopup(popupHtml, {
        maxWidth: 320,
        minWidth: 280,
        className: 'neru-popup',
        autoPan: true,
        autoPanPaddingTopLeft: L.point(16, 84),
        autoPanPaddingBottomRight: L.point(16, 16),
      });

      marker.stationId = station.id;
      this.markers.push(marker);
    });
  }

  _esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  buildPopup(station) {
    const escHtml = (v) => this._esc(v);

    // Schedule parsing
    const sch = (typeof parseSchedule === 'function') ? parseSchedule(station.schedule) : null;
    let scheduleTime = '';
    let scheduleIsOpen = null;
    let scheduleIs24 = false;
    if (sch) {
      scheduleIsOpen = sch.isOpen;
      scheduleIs24 = sch.is24;
      scheduleTime = sch.is24 ? '24/7' : `${sch.open}–${sch.close}`;
    } else if (station.schedule) {
      scheduleTime = station.schedule;
    }

    // Schedule row — shown once, with open/closed indicator
    const CLOCK_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`;
    let scheduleRow = '';
    if (scheduleTime) {
      let openBadge = '';
      if (scheduleIs24) {
        openBadge = `<span class="open-now">${escHtml(i18n.t('open247'))}</span>`;
      } else if (scheduleIsOpen !== null) {
        openBadge = scheduleIsOpen
          ? `<span class="open-now">${escHtml(i18n.t('openNow'))}</span>`
          : `<span class="open-closed">${escHtml(i18n.t('closedUntil'))}</span>`;
      }
      scheduleRow = `
        <div class="popup-schedule-row">
          <span class="popup-schedule-icon">${CLOCK_SVG}</span>
          ${scheduleIs24 ? '' : `<span class="popup-schedule-time">${escHtml(scheduleTime)}</span>`}
          ${openBadge}
        </div>`;
    }

    // Distance chip — only when user location is known; no schedule fallback
    const PIN_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    let distChip = '';
    if (typeof geoLocation !== 'undefined' && geoLocation.userLat != null && geoLocation.userLng != null) {
      const km = GeoLocation.distanceBetween(geoLocation.userLat, geoLocation.userLng, station.lat, station.lng);
      const d = GeoLocation.formatDistance(km);
      const walkMin = Math.round(km * 12);
      const walkSuffix = walkMin > 0 ? ` · ${walkMin}${escHtml(i18n.t('minSuffix'))}` : '';
      distChip = `
        <div class="chip chip--dist">
          <span class="chip-icon">${PIN_SVG}</span>
          <span class="chip-value">${escHtml(d.value)}<span class="unit">${escHtml(i18n.t(d.unit))}</span>${walkSuffix}</span>
        </div>`;
    }

    // Status indicator
    const free = station.freeConnectors;
    const total = station.totalConnectors;
    const dotCls = free === total ? 'status-all-free' : free > 0 ? 'status-partial' : 'status-busy';
    const dotLabel = free === total
      ? escHtml(i18n.t('freeNow'))
      : free > 0
        ? `${free}/${total} · ${escHtml(i18n.t('soonFree'))}`
        : escHtml(i18n.t('busy'));

    // Address only if different from station name
    const showAddress = station.address && station.address.trim() !== station.name.trim();

    // Wait banner
    let waitBannerHtml = '';
    if (!station.hasAvailable) {
      let minMinutes = Infinity;
      let minEta = null;
      for (const c of station.connectors) {
        if ((c.isCharging || c.chargeLevel > 0) && station.capacityWatts > 0) {
          const eta = chargingEta(c.chargeLevel, station.capacityWatts);
          if (eta) {
            const mins = eta.type === 'minSuffix'
              ? (eta.val === '<1' ? 0 : parseInt(eta.val))
              : parseFloat(eta.val) * 60;
            if (mins < minMinutes) { minMinutes = mins; minEta = eta; }
          }
        }
      }
      const clockSvg = `<svg class="wait-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" stroke-width="1.5" fill="none"/><path d="M12 7v5l3 3" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>`;
      if (minEta) {
        const etaStr = minEta.val === '<1'
          ? escHtml(i18n.t('etaSoon'))
          : `${escHtml(i18n.t('freeIn'))} ~${escHtml(minEta.val)} ${escHtml(i18n.t(minEta.type))}`;
        waitBannerHtml = `<div class="wait-banner">${clockSvg}<span class="wait-text">${etaStr}</span></div>`;
      } else {
        waitBannerHtml = `<div class="wait-banner wait-banner--no-eta">${clockSvg}<span class="wait-text">${escHtml(i18n.t('allBusy'))}</span></div>`;
      }
    }

    // Connector rows
    const connRows = station.connectors.map((c) => {
      if (c.isAvailable) {
        return `
          <div class="conn-row conn-row--free">
            <span class="conn-label">#${escHtml(c.id)}</span>
            <span class="conn-badge badge-free">
              <span class="badge-free-dot" aria-hidden="true"></span>
              ${escHtml(i18n.t('available'))}
            </span>
          </div>`;
      }
      const level = Math.max(0, Math.min(100, Math.round(c.chargeLevel || 0)));
      if (c.isCharging || level > 0) {
        const tone = level > 80 ? 'tone-high' : level > 40 ? 'tone-mid' : 'tone-low';
        const eta = station.capacityWatts > 0 ? chargingEta(level, station.capacityWatts) : null;
        const etaHtml = eta
          ? `<span class="conn-eta">~${escHtml(eta.val)} ${escHtml(i18n.t(eta.type))}</span>`
          : '';
        return `
          <div class="conn-row">
            <span class="conn-label">#${escHtml(c.id)}</span>
            <div class="conn-track">
              <div class="conn-fill ${tone}" style="--target: ${level}%"></div>
            </div>
            <span class="conn-val busy">${level}%</span>
            ${etaHtml}
          </div>`;
      }
      return `
        <div class="conn-row">
          <span class="conn-label">#${escHtml(c.id)}</span>
          <span class="conn-badge badge-busy">✕ ${escHtml(i18n.t('occupied'))}</span>
        </div>`;
    }).join('');

    const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`;

    return `
      <div class="popup-content">
        <div class="popup-head">
          <img src="logo.png" alt="NŪR" class="popup-logo-sm" aria-hidden="true">
          <div class="popup-head-text">
            <div class="popup-status-row">
              <span class="popup-dot ${dotCls}" aria-hidden="true"></span>
              <span class="popup-dot-label">${dotLabel}</span>
            </div>
            <h3 class="popup-title">${escHtml(station.name)}</h3>
            ${showAddress ? `<p class="popup-address">${escHtml(station.address)}</p>` : ''}
          </div>
        </div>

        <div class="popup-divider"></div>

        <div class="chip-row">
          <div class="chip chip--power">
            <span class="chip-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></span>
            <span class="chip-value">${escHtml(station.capacity || '—')}</span>
          </div>
          <div class="chip chip--tariff">
            <span class="chip-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5h3a2 2 0 0 1 0 4h-3v4"/><path d="M9.5 12.5h3.5"/></svg></span>
            <span class="chip-value">${escHtml(station.tariff)}<span class="unit"> ${escHtml(i18n.t('somoniPerKwh'))}</span></span>
          </div>
          ${distChip}
        </div>

        ${scheduleRow}
        ${waitBannerHtml}
        <div class="conn-list">${connRows}</div>

        <div class="popup-actions">
          <button class="btn btn-primary" data-action="route" data-station-id="${station.id}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 12 5 10 9 14 15 8 19 12"/><path d="M3 18h18"/></svg>
            ${escHtml(i18n.t('routeLabel'))}
            <span class="btn-arrow" aria-hidden="true">→</span>
          </button>
          <a href="${directionsUrl}" target="_blank" rel="noopener" class="btn btn-ghost btn-icon-only" title="${escHtml(i18n.t('openGoogleMaps'))}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        </div>
      </div>
    `;
  }

  setUserLocation(lat, lng, opts = {}) {
    const { accuracy = null, heading = null, animate = true } = opts;

    // Create marker on first call
    if (!this.userMarker) {
      const userIcon = L.divIcon({
        className: 'user-marker',
        html: `
          <div class="user-marker-accuracy"></div>
          <div class="user-marker-cone" style="opacity:0"></div>
          <div class="user-marker-ring"></div>
          <div class="user-marker-dot"></div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });

      this.userMarker = L.marker([lat, lng], {
        icon: userIcon,
        zIndexOffset: 1000,
        interactive: false,
        keyboard: false,
      }).addTo(this.map);
    } else {
      // Smoothly animate to new location (CSS transition does the work)
      const el = this.userMarker.getElement();
      if (el && animate) {
        el.style.transition = 'transform 900ms cubic-bezier(0.22, 1, 0.36, 1)';
      }
      this.userMarker.setLatLng([lat, lng]);
    }

    // Accuracy circle (semi-transparent ring showing GPS precision)
    if (accuracy != null && Number.isFinite(accuracy) && accuracy > 0) {
      if (!this.userAccuracyCircle) {
        this.userAccuracyCircle = L.circle([lat, lng], {
          radius: accuracy,
          className: 'user-accuracy-circle',
          color: '#7bffbe',
          weight: 1,
          fillColor: '#7bffbe',
          fillOpacity: 0.08,
          interactive: false,
        }).addTo(this.map);
      } else {
        this.userAccuracyCircle.setLatLng([lat, lng]);
        this.userAccuracyCircle.setRadius(accuracy);
      }
    }

    // Heading cone (prefer shortest-path rotation)
    this._applyHeading(heading);

    // Follow mode — pan map to keep user centred
    if (this._followUser && this.map) {
      this.map.panTo([lat, lng], { animate: true, duration: 0.9, easeLinearity: 0.4 });
    }
  }

  /**
   * Update just the user-marker heading (cone) without touching the position.
   * Call this from compass (device orientation) events — they fire 60Hz
   * while the user rotates in place and GPS stays still.
   */
  setUserHeading(heading) {
    this._applyHeading(heading);
    // Also notify any external compass UI
    window.dispatchEvent(new CustomEvent('userHeadingChange', { detail: { heading } }));
  }

  _applyHeading(heading) {
    const coneEl = this.userMarker?.getElement()?.querySelector('.user-marker-cone');
    if (!coneEl) return;

    if (heading == null || !Number.isFinite(heading)) {
      coneEl.style.opacity = '0';
      return;
    }

    // Accumulate deltas so CSS transitions always rotate the shortest way
    // (e.g. 350° → 10° should animate +20°, not -340°).
    const wrapped = ((heading % 360) + 360) % 360;
    if (this._cumHeading == null) {
      this._cumHeading = wrapped;
    } else {
      let delta = wrapped - (((this._lastHeading % 360) + 360) % 360);
      if (delta > 180) delta -= 360;
      else if (delta < -180) delta += 360;
      this._cumHeading += delta;
    }
    this._lastHeading = wrapped;

    coneEl.style.opacity = '1';
    coneEl.style.transform = `translate(-50%, -50%) rotate(${this._cumHeading}deg)`;
  }

  setFollowUser(on) { this._followUser = !!on; }
  isFollowingUser() { return this._followUser; }

  highlightStation(station, userLat, userLng) {
    // Remove previous highlights
    this.clearHighlight();

    // Change the marker to "best" icon
    const bestMarker = this.markers.find(m => m.stationId === station.id);
    if (bestMarker) {
      bestMarker.setIcon(this.createBestIcon());
      bestMarker.openPopup();
      this._panForPopup(bestMarker);
    }

    // Draw route line
    if (userLat && userLng) {
      this.routeLine = L.polyline(
        [[userLat, userLng], [station.lat, station.lng]],
        {
          color: '#00ff88',
          weight: 3,
          opacity: 0.7,
          dashArray: '10, 10',
          className: 'route-line'
        }
      ).addTo(this.map);

      // Highlight circle
      this.highlightCircle = L.circleMarker([station.lat, station.lng], {
        radius: 25,
        color: '#00ff88',
        fillColor: '#00ff88',
        fillOpacity: 0.1,
        weight: 2,
        className: 'highlight-circle'
      }).addTo(this.map);

      // Fit bounds to show both user and station
      const bounds = L.latLngBounds([
        [userLat, userLng],
        [station.lat, station.lng]
      ]);
      this.map.fitBounds(bounds, { padding: [80, 80] });
    } else {
      this.map.setView([station.lat, station.lng], 16);
    }
  }

  clearHighlight() {
    if (this.routeLine) {
      this.map.removeLayer(this.routeLine);
      this.routeLine = null;
    }
    if (this.highlightCircle) {
      this.map.removeLayer(this.highlightCircle);
      this.highlightCircle = null;
    }
  }

  drawOSRMRoute(coords, station) {
    this.clearHighlight();

    this.routeLine = L.polyline(coords, {
      color: '#7bffbe',
      weight: 4,
      opacity: 0.88,
      dashArray: '12, 8',
      lineCap: 'round',
      lineJoin: 'round',
      className: 'route-line',
    }).addTo(this.map);

    const marker = this.markers.find(m => m.stationId === station.id);
    if (marker) marker.setIcon(this.createBestIcon());

    this.highlightCircle = L.circleMarker([station.lat, station.lng], {
      radius: 22,
      color: '#7bffbe',
      fillColor: '#7bffbe',
      fillOpacity: 0.1,
      weight: 1.5,
    }).addTo(this.map);

    const bounds = L.latLngBounds(coords);
    this.map.fitBounds(bounds, {
      paddingTopLeft: [24, 90],
      paddingBottomRight: [24, 140],
    });
  }

  flyTo(lat, lng, zoom = 16) {
    this.map.flyTo([lat, lng], zoom, { duration: 1.2 });
  }

  openStationPopup(stationId) {
    const marker = this.markers.find(m => m.stationId === stationId);
    if (!marker) return;
    this.map.flyTo(marker.getLatLng(), 16, { duration: 0.8 });
    this.map.once('moveend', () => {
      marker.openPopup();
      this._panForPopup(marker);
    });
  }

  _panForPopup(marker) {
    const popup = marker.getPopup();
    if (!popup) return;
    const px = this.map.latLngToContainerPoint(marker.getLatLng());
    const popupH = popup._container ? popup._container.offsetHeight : 200;
    const topEdge = px.y - popupH - 48;
    const headerH = 84;
    if (topEdge < headerH) {
      this.map.panBy([0, topEdge - headerH], { animate: true, duration: 0.35 });
    }
  }
}

const stationMap = new StationMap();
