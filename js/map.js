// NŪR — 2GIS MapGL. Coordinates at the SDK boundary are [longitude, latitude].
class StationMap {
  constructor() {
    this.map = null;
    this.stations = new Map();
    this.zones = new Map();
    this.parkingVisible = false;
    this.stationsVisible = true;
    this.parkingLines = [];
    this._icons = new Map();
    this._followUser = false;
  }

  init(containerId = 'map') {
    this.container = document.getElementById(containerId);
    this.map = new mapgl.Map(containerId, {
      key: window.NUR_MAP_CONFIG.key,
      center: window.NUR_MAP_CONFIG.center,
      zoom: 13, minZoom: 8, maxZoom: 20, pitch: 0,
      disablePitchByUserInteraction: true,
      disableRotationByUserInteraction: true,
      zoomControl: 'bottomRight',
      copyright: 'topRight',
      controlsLayoutPadding: { top: 96, right: 16, bottom: 88, left: 16 },
    });
    this.stationCluster = this._cluster(false);
    this.parkingCluster = this._cluster(true);
    this.map.on('dragstart', () => {
      this._followUser = false;
      document.getElementById('loc-btn')?.classList.remove('is-following');
    });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') this.closePopup();
    });
    return this.map;
  }

  _icon(color, glyph = 'bolt') {
    const key = color + glyph;
    if (!this._icons.has(key)) {
      const shape = glyph === 'bolt'
        ? '<path d="M23 9L13 23h8l-1 10 11-15h-9z" fill="white"/>'
        : glyph === 'P' ? '<path d="M17 31V12h8a6 6 0 010 12h-4v7zm4-11h4a2 2 0 000-4h-4z" fill="white"/>' : '';
      this._icons.set(key, 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44"><circle cx="22" cy="22" r="20" fill="${color}" stroke="white" stroke-width="3"/>${shape}</svg>`));
    }
    return this._icons.get(key);
  }

  _color(s) {
    return s.freeConnectors === s.totalConnectors && s.freeConnectors > 0
      ? '#15834b' : s.freeConnectors > 0 || s.maxChargeLevel >= 80 ? '#ad750c' : '#c44343';
  }

  _cluster(parking) {
    const cluster = new mapgl.Clusterer(this.map, {
      radius: 48,
      clusterStyle: (count, target) => ({
        type: 'webgl', size: [44, 44],
        icon: this._icon(parking ? '#087eac' : target.data.some(m => m.userData.free) ? '#15834b' : '#c44343', 'cluster'),
        labelText: parking ? `P ${count}` : String(count), labelColor: '#ffffff', labelFontSize: 14,
      }),
    });
    cluster.on('click', e => {
      if (e.target.type === 'marker') {
        parking ? this.openZonePopup(e.target.data.userData.id) : this.openStationPopup(e.target.data.userData.id);
      } else {
        const data = e.target.data;
        // Co-located stations remain selectable even when zooming cannot separate them.
        if (this.map.getZoom() >= 18 || data.every(m => m.coordinates.every((v, i) => Math.abs(v - data[0].coordinates[i]) < .00002))) {
          this._openGroup(data, parking);
        } else {
          const zoom = Math.min(20, cluster.getClusterExpansionZoom(e.target.id) + .2);
          this.map.setCenter(e.lngLat, this._animation());
          this.map.setZoom(zoom, this._animation());
        }
      }
    });
    return cluster;
  }

  _animation() {
    return { duration: 350, animate: !window.matchMedia('(prefers-reduced-motion: reduce)').matches };
  }

  renderStations(stations) {
    this.stations = new Map(stations.map(s => [String(s.id), s]));
    this._syncStations();
    if (this.popupType === 'station') {
      const station = this.stations.get(this.popupId);
      station ? this._setCard(this.buildPopup(station)) : this.closePopup();
    }
  }

  _syncStations() {
    const points = this.stationsVisible ? [...this.stations.values()].map(s => ({
      coordinates: [s.lng, s.lat], icon: this._icon(this._color(s)), size: [36, 36],
      userData: { id: String(s.id), free: s.freeConnectors > 0 },
    })) : [];
    const signature = JSON.stringify(points);
    if (signature !== this._stationSignature) {
      this.stationCluster.load(points);
      this._stationSignature = signature;
    }
  }

  renderParkingZones(zones) {
    this.zones = new Map(zones.map(z => [String(z.id), z]));
    this._syncParking();
  }

  _syncParking() {
    const zones = this.parkingVisible ? [...this.zones.values()] : [];
    const signature = JSON.stringify(zones.map(z => [z.id, z.lat, z.lng, z.a, z.b]));
    if (signature === this._parkingSignature) return;
    this._parkingSignature = signature;
    this.parkingLines.forEach(line => line.destroy());
    this.parkingLines = zones.map(z => {
      const line = new mapgl.Polyline(this.map, {
        coordinates: [z.a, z.b].map(([lat, lng]) => [lng, lat]),
        color: '#1a9cd080', width: 9,
      });
      line.on('click', () => this.openZonePopup(z.id));
      return line;
    });
    this.parkingCluster.load(zones.map(z => ({
      coordinates: [z.lng, z.lat], icon: this._icon('#087eac', 'P'), size: [34, 34],
      userData: { id: String(z.id) },
    })));
  }

  setParkingVisible(on) {
    this.parkingVisible = !!on;
    this.setStationsVisible(!on);
    this._syncParking();
    this.closePopup();
  }
  setStationsVisible(on) { this.stationsVisible = !!on; this._syncStations(); }
  isParkingVisible() { return this.parkingVisible; }
  setTheme() {} // Existing app uses a light map in both UI themes.
  refreshParkingTheme() {}
  refreshParkingPopups(zones) {
    this.zones = new Map(zones.map(z => [String(z.id), z]));
    const zone = this.zones.get(this.popupId);
    if (this.popupType === 'parking' && zone) this._setCard(this._buildZonePopup(zone));
  }

  _openCard(type, id, html) {
    this.closePopup();
    this.popupType = type;
    this.popupId = String(id);
    this.card = document.createElement('section');
    this.card.className = 'nur-map-card neru-popup';
    this.card.setAttribute('role', 'dialog');
    this.card.setAttribute('aria-label', type === 'parking' ? i18n.t('pkPaidZone') : i18n.t('stations'));
    this.card.innerHTML = '<button class="nur-map-close" type="button" aria-label="' + this._esc(i18n.t('closePanel')) + '">×</button><div class="nur-map-card-body"></div>';
    this.card.querySelector('button').onclick = () => this.closePopup();
    this.card.addEventListener('click', e => {
      const button = e.target.closest('[data-action]');
      if (!button) return;
      if (button.dataset.action === 'route') window.dispatchEvent(new CustomEvent('routeRequest', { detail: { stationId: button.dataset.stationId } }));
      if (button.dataset.action === 'zone-rules') window.dispatchEvent(new CustomEvent('parkingRulesRequest'));
      if (button.dataset.action === 'select-station') this.openStationPopup(button.dataset.id);
      if (button.dataset.action === 'select-zone') this.openZonePopup(button.dataset.id);
    });
    // Sibling of the SDK container: no map gestures leak through the card.
    this.container.parentNode.append(this.card);
    this._setCard(html);
    document.body.classList.add('has-popup');
    this.card.querySelector('.nur-map-close').focus({ preventScroll: true });
  }
  _setCard(html) {
    const body = this.card?.querySelector('.nur-map-card-body');
    if (body && body.innerHTML !== html) body.innerHTML = html;
  }
  closePopup() {
    if (!this.card) return;
    this.card.remove(); this.card = null; this.popupType = null; this.popupId = null;
    this.selectedMarker?.destroy(); this.selectedMarker = null;
    document.body.classList.remove('has-popup');
    window.dispatchEvent(new CustomEvent('popupClosed'));
  }
  _select(lat, lng) {
    this.selectedMarker?.destroy();
    this.selectedMarker = new mapgl.CircleMarker(this.map, {
      coordinates: [lng, lat], radius: 25, color: '#15834b22', strokeColor: '#15834b', strokeWidth: 3,
    });
    this.flyTo(lat, lng, Math.max(16, this.map.getZoom()));
  }
  openStationPopup(id) {
    const s = this.stations.get(String(id));
    if (!s) return;
    this._openCard('station', id, this.buildPopup(s));
    this._select(s.lat, s.lng);
  }
  openZonePopup(id) {
    const z = this.zones.get(String(id));
    if (!z) return;
    this._openCard('parking', id, this._buildZonePopup(z));
    this._select(z.lat, z.lng);
  }
  _openGroup(points, parking) {
    const records = parking ? this.zones : this.stations;
    const rows = [...points].sort((a,b) => a.userData.id.localeCompare(b.userData.id, undefined, { numeric: true })).map((p,i) => {
      const s = records.get(p.userData.id);
      return `<button class="nur-group-row" data-action="${parking ? 'select-zone' : 'select-station'}" data-id="${this._esc(s.id)}"><b>${i+1}</b><span>${this._esc(parking ? s.address : s.name)}</span></button>`;
    }).join('');
    this._openCard('group', '', `<div class="popup-content">${rows}</div>`);
  }
  setUserLocation(lat, lng, { accuracy, heading } = {}) {
    const coordinates = [lng, lat];
    if (!this.userMarker) {
      this.userElement = document.createElement('div');
      this.userElement.className = 'user-marker';
      this.userElement.innerHTML = '<div class="user-marker-cone"></div><div class="user-marker-dot"></div>';
      this.userMarker = new mapgl.HtmlMarker(this.map, { coordinates, html: this.userElement, anchor: [14,14] });
    } else this.userMarker.setCoordinates(coordinates);
    const cone = this.userElement.querySelector('.user-marker-cone');
    cone.style.opacity = Number.isFinite(heading) ? '1' : '0';
    cone.style.transform = `translate(-50%,-50%) rotate(${heading || 0}deg)`;
    this.userAccuracyCircle?.destroy(); this.userAccuracyCircle = null;
    if (Number.isFinite(accuracy) && accuracy > 0) this.userAccuracyCircle = new mapgl.Circle(this.map, {
      coordinates, radius: accuracy, color: '#15834b15', strokeColor: '#15834b55', strokeWidth: 1,
    });
    if (this._followUser) this.map.setCenter(coordinates, this._animation());
  }
  setFollowUser(on) { this._followUser = !!on; }
  isFollowingUser() { return this._followUser; }
  flyTo(lat, lng, zoom = 16) {
    this.map.setCenter([lng, lat], this._animation());
    this.map.setZoom(zoom, this._animation());
  }
  highlightStation(station) { this.clearHighlight(); this.openStationPopup(station.id); }
  highlightZone(zone) {
    this.clearZoneHighlight();
    if (zone) this.zoneHighlight = new mapgl.Polyline(this.map, {
      coordinates: [zone.a, zone.b].map(([lat,lng]) => [lng,lat]), color: '#087eac', width: 14,
    });
  }
  clearZoneHighlight() { this.zoneHighlight?.destroy(); this.zoneHighlight = null; }
  clearHighlight() {
    this.routeLine?.destroy(); this.routeLine = null;
    this.highlightCircle?.destroy(); this.highlightCircle = null;
    this._routeSignature = null;
  }
  drawOSRMRoute(coords, station, fit = true) {
    const signature = JSON.stringify([coords, station.id]);
    if (signature !== this._routeSignature) {
      this.clearHighlight();
      this.routeLine = new mapgl.Polyline(this.map, {
        coordinates: coords.map(([lat,lng]) => [lng,lat]), color: '#15834b', width: 6,
      });
      this.highlightCircle = new mapgl.CircleMarker(this.map, {
        coordinates: [station.lng,station.lat], radius: 22, color: '#15834b22', strokeColor: '#15834b', strokeWidth: 2,
      });
      this._routeSignature = signature;
    }
    if (fit && coords.length) this.map.fitBounds({
      southWest: [Math.min(...coords.map(c => c[1])), Math.min(...coords.map(c => c[0]))],
      northEast: [Math.max(...coords.map(c => c[1])), Math.max(...coords.map(c => c[0]))],
    }, { padding: { top: 110, bottom: 210, left: 40, right: 40 }, maxZoom: 17, animation: this._animation() });
  }

  _buildZonePopup(zone) {
    const esc = (v) => this._esc(v);

    // Same schedule treatment as a station card, so a place reads identically
    // wherever the user meets it.
    const sch = (typeof parseSchedule === 'function') ? parseSchedule(zone.schedule) : null;
    let scheduleRow = '';
    const CLOCK_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`;
    if (sch || zone.schedule) {
      const time = sch ? (sch.is24 ? '24/7' : `${sch.open}–${sch.close}`) : zone.schedule;
      let badge = '';
      if (sch?.is24) {
        badge = `<span class="open-now">${esc(i18n.t('open247'))}</span>`;
      } else if (sch) {
        // Outside the paid window the strip is simply free to use.
        badge = sch.isOpen
          ? `<span class="open-now">${esc(i18n.t('pkPaidNow'))}</span>`
          : `<span class="open-now">${esc(i18n.t('pkFreeNow'))}</span>`;
      }
      scheduleRow = `
        <div class="popup-schedule-row">
          <span class="popup-schedule-icon">${CLOCK_SVG}</span>
          <span class="popup-schedule-time">${esc(time)}</span>
          ${badge}
        </div>`;
    }

    // Distance chip — only when we know where the user is
    const PIN_SVG = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
    let distChip = '';
    if (typeof geoLocation !== 'undefined' && geoLocation.userLat != null && geoLocation.userLng != null) {
      // Distance to the strip itself, not to its midpoint — a 400m strip would
      // otherwise report 200m while the user stands on one end of it.
      const meters = parkingAPI.distanceToZone(geoLocation.userLat, geoLocation.userLng, zone);
      const d = GeoLocation.formatDistance(meters / 1000);
      distChip = `
        <div class="chip chip--dist">
          <span class="chip-icon">${PIN_SVG}</span>
          <span class="chip-value">${esc(d.value)}<span class="unit">${esc(i18n.t(d.unit))}</span></span>
        </div>`;
    }

    const placesRow = zone.places != null
      ? `<div class="pk-fact">
           <span class="pk-fact-label">${esc(i18n.t('pkPlaces'))}</span>
           <span class="pk-fact-val">${esc(zone.places)}</span>
         </div>`
      : '';

    const accessibleRow = zone.accessiblePlaces != null
      ? `<div class="pk-fact">
           <span class="pk-fact-label">${esc(i18n.t('pkAccessible'))}</span>
           <span class="pk-fact-val">${esc(zone.accessiblePlaces)}</span>
         </div>`
      : '';

    const districtRow = zone.district
      ? `<div class="pk-fact">
           <span class="pk-fact-label">${esc(i18n.t('pkDistrict'))}</span>
           <span class="pk-fact-val">${esc(zone.district)}</span>
         </div>`
      : '';

    return `
      <div class="popup-content popup-content--parking">
        <div class="popup-head">
          <div class="popup-status-row">
            <span class="pk-badge" aria-hidden="true">P</span>
            <span class="popup-dot-label">${esc(i18n.t('pkPaidZone'))}${zone.code ? ` · ${esc(zone.code)}` : ''}</span>
          </div>
          <h3 class="popup-title">${esc(zone.address || i18n.t('pkPaidZone'))}</h3>
        </div>

        <div class="popup-divider"></div>

        <div class="chip-row">
          <div class="chip chip--tariff">
            <span class="chip-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5h3a2 2 0 0 1 0 4h-3v4"/><path d="M9.5 12.5h3.5"/></svg></span>
            <span class="chip-value">${esc(zone.tariff)}<span class="unit"> ${esc(i18n.t('pkPerHour'))}</span></span>
          </div>
          ${distChip}
        </div>

        ${scheduleRow}

        <div class="pk-facts">
          ${placesRow}
          ${accessibleRow}
          ${districtRow}
        </div>

        <p class="pk-free-note">${esc(i18n.t('pkFreeMinutesNote'))}</p>

        <div class="popup-actions popup-actions--single">
          <button class="btn btn-primary" data-action="zone-rules">${esc(i18n.t('pkRules'))}</button>
        </div>
      </div>
    `;
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
    const dotCls = total > 0 && free === total ? 'status-all-free' : free > 0 ? 'status-partial' : 'status-busy';
    const dotLabel = total > 0 && free === total
      ? escHtml(i18n.t('freeNow'))
      : free > 0
        ? `${free}/${total} · ${escHtml(i18n.t('available'))}`
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

    // Connector rows.
    // Each row answers one question in order: which plug, what state, and —
    // when it is busy — when it frees up. The meter shows the real charge
    // level, so its width always matches the number printed beside it.
    const connRows = station.connectors.map((c) => {
      if (c.isAvailable) {
        return `
          <div class="conn conn--free">
            <span class="conn-id">#${escHtml(c.id)}</span>
            <span class="conn-state">
              <span class="conn-pip" aria-hidden="true"></span>
              ${escHtml(i18n.t('available'))}
            </span>
          </div>`;
      }

      const level = Math.max(0, Math.min(100, Math.round(c.chargeLevel || 0)));
      if (c.isCharging || c.isStarting || level > 0) {
        const tone = level >= 80 ? 'tone-high' : level >= 40 ? 'tone-mid' : 'tone-low';
        const eta = station.capacityWatts > 0 ? chargingEta(level, station.capacityWatts) : null;
        // Keep this to a short, single-line value — it shares a line with the
        // state label, and a full sentence here wraps and breaks the row.
        const freeIn = eta
          ? (eta.val === '<1'
              ? escHtml(i18n.t('etaSoonShort'))
              : `~${escHtml(eta.val)} ${escHtml(i18n.t(eta.type))}`)
          : '';
        return `
          <div class="conn conn--charging">
            <span class="conn-id">#${escHtml(c.id)}</span>
            <div class="conn-body">
              <div class="conn-line">
                <span class="conn-state conn-state--charging">${escHtml(i18n.t(c.isStarting ? 'startCharging' : 'charging'))}</span>
                ${freeIn ? `<span class="conn-freein">${freeIn}</span>` : ''}
              </div>
              <div class="conn-gauge">
                <div class="conn-meter" role="progressbar" aria-valuenow="${level}" aria-valuemin="0" aria-valuemax="100" aria-label="${escHtml(i18n.t('chargeLabel'))}">
                  <span class="conn-meter-fill ${tone}" style="width:${level}%"></span>
                </div>
                <span class="conn-pct ${tone}">${level}<i>%</i></span>
              </div>
            </div>
          </div>`;
      }

      return `
        <div class="conn conn--busy">
          <span class="conn-id">#${escHtml(c.id)}</span>
          <span class="conn-state conn-state--busy">${escHtml(i18n.t('occupied'))}</span>
        </div>`;
    }).join('');

    const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`;

    return `
      <div class="popup-content">
        <div class="popup-head">
          <div class="popup-status-row">
            <span class="popup-dot ${dotCls}" aria-hidden="true"></span>
            <span class="popup-dot-label">${dotLabel}</span>
          </div>
          <h3 class="popup-title">${escHtml(station.name)}</h3>
          ${showAddress ? `<p class="popup-address">${escHtml(station.address)}</p>` : ''}
        </div>

        <div class="popup-divider"></div>

        <div class="chip-row">
          <div class="chip chip--power">
            <span class="chip-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></span>
            <span class="chip-value">${station.capacityKw ? escHtml(String(station.capacityKw)) + '<span class="unit"> ' + escHtml(i18n.t('kwUnit')) + '</span>' : '—'}</span>
          </div>
          <div class="chip chip--tariff">
            <span class="chip-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 8.5h3a2 2 0 0 1 0 4h-3v4"/><path d="M9.5 12.5h3.5"/></svg></span>
            <span class="chip-value">${escHtml(station.tariff)}<span class="unit"> ${escHtml(i18n.t('somoniPerKwh'))}</span></span>
          </div>
          ${distChip}
        </div>

        ${scheduleRow}
        ${waitBannerHtml}
        ${typeof stationAnalytics !== 'undefined' ? stationAnalytics.stationHistoryHtml(station.id) : ''}
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

}

const stationMap = new StationMap();
