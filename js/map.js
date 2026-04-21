// ============================================
// NerU v2 — Map Module (Leaflet.js)
// ============================================

class StationMap {
  constructor() {
    this.map = null;
    this.markers = [];
    this.markerLayer = null;
    this.userMarker = null;
    this.routeLine = null;
    this.highlightCircle = null;
  }

  init(containerId = 'map') {
    // CartoDB Dark Matter — dark themed tiles
    const darkTiles = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
      }
    );

    this.map = L.map(containerId, {
      center: [38.5598, 68.7738],
      zoom: 13,
      layers: [darkTiles],
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

  buildPopup(station) {
    const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

    // Schedule parsing for "Open now" chip
    const sch = (typeof parseSchedule === 'function') ? parseSchedule(station.schedule) : null;
    let scheduleChip = '';
    if (sch) {
      if (sch.is24) {
        scheduleChip = `<span class="open-now">24/7</span>`;
      } else {
        scheduleChip = `<span class="open-now">${sch.open}–${sch.close}</span>`;
      }
    } else if (station.schedule) {
      scheduleChip = `<span class="open-now">${escHtml(station.schedule)}</span>`;
    }

    // Distance (if user location known)
    let distChip = '';
    if (typeof geoLocation !== 'undefined' && geoLocation.userLat != null && geoLocation.userLng != null) {
      const km = GeoLocation.distanceBetween(
        geoLocation.userLat, geoLocation.userLng, station.lat, station.lng
      );
      const d = GeoLocation.formatDistance(km);
      distChip = `
        <div class="chip">
          <span class="chip-label">${escHtml(i18n.t('distance'))}</span>
          <span class="chip-value">${escHtml(d.value)}<span class="unit">${escHtml(i18n.t(d.unit))}</span></span>
        </div>`;
    } else {
      distChip = `
        <div class="chip">
          <span class="chip-label">${escHtml(i18n.t('schedule'))}</span>
          <span class="chip-value">${escHtml(station.schedule || '—')}</span>
        </div>`;
    }

    // Wait banner: shown when station is fully occupied
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
          <div class="conn-row">
            <span class="conn-label">#${escHtml(c.id)}</span>
            <span class="conn-badge badge-free">✓ ${escHtml(i18n.t('available'))}</span>
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
          <span class="popup-bolt" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          </span>
          <div>
            <h3 class="popup-title">${escHtml(station.name)}</h3>
            <p class="popup-sub">
              ${station.address ? `<span>${escHtml(station.address)}</span>` : ''}
              ${station.address && scheduleChip ? '<span class="dot-sep">·</span>' : ''}
              ${scheduleChip}
            </p>
          </div>
        </div>

        <div class="chip-row">
          <div class="chip">
            <span class="chip-label">${escHtml(i18n.t('power'))}</span>
            <span class="chip-value">${escHtml(station.capacity || '—')}</span>
          </div>
          <div class="chip">
            <span class="chip-label">${escHtml(i18n.t('tariff'))}</span>
            <span class="chip-value">${escHtml(station.tariff)}<span class="unit">${escHtml(i18n.t('somoniPerKwh'))}</span></span>
          </div>
          ${distChip}
        </div>

        ${waitBannerHtml}

        <div class="conn-list">${connRows}</div>

        <a href="${directionsUrl}" target="_blank" rel="noopener" class="btn btn-primary" style="width:100%">
          ${escHtml(i18n.t('getDirections'))}
          <span class="btn-arrow" aria-hidden="true">→</span>
        </a>
      </div>
    `;
  }

  setUserLocation(lat, lng) {
    if (this.userMarker) {
      this.map.removeLayer(this.userMarker);
    }

    const userIcon = L.divIcon({
      className: 'user-marker',
      html: `<div class="user-marker-dot"></div><div class="user-marker-ring"></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    this.userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 })
      .addTo(this.map);
  }

  highlightStation(station, userLat, userLng) {
    // Remove previous highlights
    this.clearHighlight();

    // Change the marker to "best" icon
    const bestMarker = this.markers.find(m => m.stationId === station.id);
    if (bestMarker) {
      bestMarker.setIcon(this.createBestIcon());
      setTimeout(() => {
        bestMarker.openPopup();
        this._panForPopup(bestMarker);
      }, 80);
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

  flyTo(lat, lng, zoom = 16) {
    this.map.flyTo([lat, lng], zoom, { duration: 1.2 });
  }

  openStationPopup(stationId) {
    const marker = this.markers.find(m => m.stationId === stationId);
    if (marker) {
      this.map.flyTo(marker.getLatLng(), 16, { duration: 0.8 });
      setTimeout(() => {
        marker.openPopup();
        this._panForPopup(marker);
      }, 850);
    }
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
