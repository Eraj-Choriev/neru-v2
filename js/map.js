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
    if (!window.NUR_MAP_CONFIG?.key) {
      throw new Error('2GIS key missing: js/config.js was not generated. Run `node scripts/build-config.mjs` (see .env.example).');
    }
    this.map = new mapgl.Map(containerId, {
      key: window.NUR_MAP_CONFIG.key,
      center: window.NUR_MAP_CONFIG.center,
      zoom: 13, minZoom: 8, maxZoom: 20, pitch: 0,
      disablePitchByUserInteraction: true,
      disableRotationByUserInteraction: true,
      zoomControl: false,
      copyright: 'topRight',
      controlsLayoutPadding: { top: 96, right: 16, bottom: 88, left: 16 },
    });
    this.stationCluster = this._cluster(false);
    this.parkingCluster = this._cluster(true);
    const zoom = document.createElement('div');
    zoom.className = 'nur-map-zoom';
    zoom.dataset.glass = '';
    for (const [delta, key, text] of [[1, 'zoomIn', '+'], [-1, 'zoomOut', '−']]) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = text;
      const label = () => button.setAttribute('aria-label', i18n.t(key));
      label(); window.addEventListener('langchange', label);
      button.onclick = () => { this._closeSpider(); this.closePopup(); this.map.setZoom(Math.max(8, Math.min(20, this.map.getZoom() + delta)), this._animation()); };
      zoom.append(button);
    }
    this.container.parentNode.append(zoom);
    // Capture native input before the SDK dispatches a marker click. A new
    // cluster can then open normally; an existing overlay never follows a drag.
    this.container.addEventListener('pointerdown', () => {
      this._closeSpider();
      this.closePopup();
      this._followUser = false;
      document.getElementById('loc-btn')?.classList.remove('is-following');
    }, { capture: true, passive: true });
    this.container.addEventListener('wheel', () => {
      this._closeSpider(); this.closePopup();
    }, { capture: true, passive: true });
    this.map.on('movestart', () => {
      // Also covers keyboard zoom, follow-mode movement and programmatic moves.
      // A normal card's own camera centering must not close that card.
      if (this._spider) { this._closeSpider(); this.closePopup(); }
    });
    // 'move' fires every animation frame; coalesce to one layout pass per frame.
    this.map.on('move', () => this._schedulePositionCard());
    this._resizeObserver = new ResizeObserver(() => {
      this._closeSpider();
      this._chromeRects = null;
      this._positionCard();
    });
    this._resizeObserver.observe(this.container);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') { this.closePopup(); this._closeSpider(); }
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
        if (data.length <= 20 || this.map.getZoom() >= 18 || data.every(m => m.coordinates.every((v, i) => Math.abs(v - data[0].coordinates[i]) < .00002))) {
          // The cluster's own coordinates, not the tap's: the hub has to land
          // exactly on the circle that was tapped.
          const at = cluster.clusters?.get?.(e.target.id)?.coordinates || e.lngLat;
          this._openGroup(data, parking, at, { color: parking ? '#087eac' : data.some(m => m.userData?.free) ? '#15834b' : '#c44343' });
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
    const stations = this.stationsVisible ? [...this.stations.values()] : [];
    // Compare compact fields, not the ~600-char icon data URI of every marker.
    const signature = JSON.stringify(stations.map(s => [s.id, s.lng, s.lat, this._color(s), s.freeConnectors > 0]));
    if (signature !== this._stationSignature) {
      this.stationCluster.load(stations.map(s => ({
        coordinates: [s.lng, s.lat], icon: this._icon(this._color(s)), size: [36, 36],
        userData: { id: String(s.id), free: s.freeConnectors > 0 },
      })));
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
    this._closeSpider();
    this.parkingVisible = !!on;
    this.setStationsVisible(!on);
    this._syncParking();
    this.closePopup();
  }
  setStationsVisible(on) { this.stationsVisible = !!on; this._syncStations(); }
  isParkingVisible() { return this.parkingVisible; }
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
    if (this._spider && this._spider.parking === (type === 'parking')) {
      const nav = document.createElement('nav');
      nav.className = 'nur-group-nav';
      nav.setAttribute('aria-label', i18n.t('groupNavigation'));
      const index = this._spider.ids.indexOf(String(id));
      nav.innerHTML = `<button type="button" data-group-step="-1" aria-label="${this._esc(i18n.t('previousStation'))}">‹</button><span>${index + 1} / ${this._spider.ids.length}</span><button type="button" data-group-step="1" aria-label="${this._esc(i18n.t('nextStation'))}">›</button>`;
      this.card.prepend(nav);
    }
    this.card.querySelector('.nur-map-close').onclick = () => this.closePopup();
    this.card.addEventListener('click', e => {
      const step = e.target.closest('[data-group-step]');
      if (step && this._spider) {
        const ids = this._spider.ids;
        const index = (ids.indexOf(this.popupId) + Number(step.dataset.groupStep) + ids.length) % ids.length;
        this._spider.parking ? this.openZonePopup(ids[index]) : this.openStationPopup(ids[index]);
        this.card?.querySelector(`[data-group-step="${step.dataset.groupStep}"]`)?.focus({ preventScroll: true });
        return;
      }
      const button = e.target.closest('[data-action]');
      if (!button) return;
      if (button.dataset.action === 'route') window.dispatchEvent(new CustomEvent('routeRequest', { detail: { stationId: button.dataset.stationId } }));
      if (button.dataset.action === 'zone-rules') window.dispatchEvent(new CustomEvent('parkingRulesRequest'));
      if (button.dataset.action === 'zone-start') window.dispatchEvent(new CustomEvent('parkingStartRequest', { detail: { zoneId: button.dataset.id } }));
      if (button.dataset.action === 'select-station') this.openStationPopup(button.dataset.id);
      if (button.dataset.action === 'select-zone') this.openZonePopup(button.dataset.id);
    });
    // Sibling of the SDK container: no map gestures leak through the card.
    this.container.parentNode.append(this.card);
    this._setCard(html);
    document.body.classList.add('has-popup');
    this.card.querySelector('.nur-map-close').focus({ preventScroll: true });
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.card.animate([
        { opacity: 0, transform: 'translateY(8px) scale(.98)' },
        { opacity: 1, transform: 'translateY(0) scale(1)' },
      ], { duration: 240, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
  }
  _setCard(html) {
    const body = this.card?.querySelector('.nur-map-card-body');
    if (body && body.innerHTML !== html) body.innerHTML = html;
    if (body && this._spider) {
      const number = this._spider.ids.indexOf(this.popupId) + 1;
      const title = body.querySelector('.popup-title');
      if (number && title && !title.querySelector('.popup-map-number')) {
        const badge = document.createElement('span');
        badge.className = 'popup-map-number'; badge.textContent = `#${number}`; title.prepend(badge);
      }
    }
    this._positionCard();
  }
  _schedulePositionCard() {
    if (!this.card || this._positionFrame) return;
    this._positionFrame = requestAnimationFrame(() => {
      this._positionFrame = null;
      this._positionCard({ cachedChrome: true });
    });
  }
  // Reads all geometry first, then writes only what changed, so a camera
  // animation does not force a synchronous layout on every frame. Header and
  // dock never move during a pan, so their rects are cached until a resize.
  _positionCard({ cachedChrome = false } = {}) {
    if (!this.card) return;
    const record = (this.popupType === 'parking' ? this.zones : this.stations).get(this.popupId);
    if (!record) return;
    if (!cachedChrome || !this._chromeRects) {
      this._chromeRects = {
        bounds: this.container.getBoundingClientRect(),
        header: document.querySelector('.header')?.getBoundingClientRect(),
        dock: document.querySelector('.tabbar-dock')?.getBoundingClientRect(),
      };
    }
    const { bounds, header, dock } = this._chromeRects;
    const projected = this.map.project([record.lng, record.lat]);
    const point = this._spider?.positions.get(this.popupId) || projected;
    const top = Math.max(8, header?.bottom || 80) + 8;
    const bottom = dock?.height ? dock.top - 8 : bounds.bottom - 24;
    const width = `${Math.min(306, bounds.width - 32)}px`;
    const maxHeight = `${Math.max(100, bottom - top)}px`;
    if (this.card.style.width !== width) this.card.style.width = width;
    if (this.card.style.maxHeight !== maxHeight) this.card.style.maxHeight = maxHeight;
    const height = this.card.offsetHeight;
    const w = parseFloat(width);
    const x = Math.max(bounds.left + 16, Math.min(bounds.right - w - 16, bounds.left + point[0] - w / 2));
    const y = Math.max(top, Math.min(bottom - height, bounds.top + point[1] - height - 28));
    Object.assign(this.card.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
  }
  closePopup() {
    if (!this.card) return;
    if (this._positionFrame) { cancelAnimationFrame(this._positionFrame); this._positionFrame = null; }
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
    // Opening a station during navigation must not zoom away from the route.
    if (!this._spider && !this.routeLine) this.flyTo(lat, lng, Math.max(16, this.map.getZoom()));
    this._positionCard();
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
  // ---- Spider: a group opened in place, as a web around its cluster ----
  //
  // The hub is drawn exactly over the WebGL cluster it opens, at the same
  // size and colour, so the cluster and the hub read as one circle. If the web
  // would spill off-screen the map moves, never the hub: a hub nudged away
  // from its cluster is what showed up as two overlapping circles.

  /** Rings around the hub, packed as tight as the markers allow. */
  _spiderLayout(count, maxExtent = Infinity) {
    const HUB_R = 21.5, GAP = 6;
    let layout = null;
    for (const size of [36, 32, 28]) {
      const pitch = size + GAP;                    // centre-to-centre, along a ring and between rings
      const minR = HUB_R + GAP + 2 + size / 2;     // first ring clears the hub
      const ringR = n => Math.max(minR, n > 1 ? pitch / (2 * Math.sin(Math.PI / n)) : minR);
      layout = { size, rings: [{ r: ringR(count), n: count }], extent: ringR(count) + size / 2 };
      // A second ring only when it makes the web clearly smaller; up to about
      // a dozen, one ring is both tighter and calmer.
      for (let r1 = minR; count > 6 && r1 <= minR + pitch; r1 += 2) {
        const caps = [];
        let total = 0;
        for (let r = r1; total < count; r += pitch) {
          // Neighbours are a chord apart, not an arc: fit by the chord.
          const c = Math.floor(Math.PI / Math.asin(Math.min(1, pitch / (2 * r))));
          caps.push({ r, c });
          total += c;
        }
        const extent = caps[caps.length - 1].r + size / 2;
        if (caps.length < 2 || extent > layout.extent - 10) continue;
        // Share the markers out in proportion to each ring's length, so every
        // ring has the same spacing.
        const share = caps.map(({ r, c }) => ({ r, c, n: Math.floor(count * c / total), f: (count * c / total) % 1 }));
        let left = count - share.reduce((sum, s) => sum + s.n, 0);
        for (const s of [...share].sort((a, b) => b.f - a.f)) {
          if (!left) break;
          if (s.n < s.c) { s.n++; left--; }
        }
        const rings = share.filter(s => s.n > 0).map(({ r, n }) => ({ r, n }));
        layout = { size, rings, extent: rings[rings.length - 1].r + size / 2 };
      }
      if (layout.extent <= maxExtent) break;
    }
    layout.offsets = [];
    layout.rings.forEach(({ r, n }, ring) => {
      // Alternate rings sit half a step round, so legs to the outer ring pass
      // between the inner markers instead of through them.
      const start = -Math.PI / 2 + (ring % 2 ? Math.PI / n : 0);
      for (let i = 0; i < n; i++) {
        const a = start + i * 2 * Math.PI / n;
        layout.offsets.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
    });
    return layout;
  }

  _closeSpider() {
    const spider = this._spider;
    this._pendingGroup = null;
    if (!spider) return;
    this._spider = null;
    spider.animations.forEach(animation => animation.cancel());
    spider.element.style.pointerEvents = 'none';
    spider.element.querySelectorAll('button').forEach(button => { button.disabled = true; });
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !spider.reveal.length) {
      spider.element.remove();
      return;
    }
    // Everything folds back into the hub, quicker than it came out.
    const n = spider.reveal.length;
    const fold = { duration: 220, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' };
    const closing = spider.reveal.flatMap(({ button, line, dx, dy }, i) => [
      button.animate([
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.3)`, opacity: 0 },
      ], { ...fold, delay: Math.min((n - 1 - i) * 6, 60) }),
      line.animate([{ opacity: 1 }, { opacity: 0 }], { ...fold, duration: 160 }),
    ]);
    for (const web of spider.webs || []) closing.push(web.animate([{ opacity: 1 }, { opacity: 0 }], { ...fold, duration: 160 }));
    Promise.all(closing.map(animation => animation.finished.catch(() => {}))).then(() => spider.element.remove());
  }

  _openGroup(points, parking, coordinates = points[0].coordinates, { color, panned = false } = {}) {
    this.closePopup();
    this._closeSpider();
    const records = parking ? this.zones : this.stations;
    const sorted = [...points].filter(p => records.has(String(p.userData.id))).sort((a,b) => String(a.userData.id).localeCompare(String(b.userData.id), undefined, { numeric: true }));
    if (!sorted.length) return;

    const bounds = this.container.getBoundingClientRect();
    const header = document.querySelector('.header')?.getBoundingClientRect();
    const dock = document.querySelector('.tabbar-dock')?.getBoundingClientRect();
    const area = {
      left: 8, right: bounds.width - 8,
      top: (header ? header.bottom - bounds.top : 0) + 8,
      bottom: (dock?.height ? dock.top - bounds.top : bounds.height) - 8,
    };
    const layout = this._spiderLayout(sorted.length, Math.min(area.right - area.left, area.bottom - area.top) / 2);
    const fitRadius = layout.extent + 10;
    const origin = this.map.project(coordinates);

    // Fit the web on screen by moving the map, then open over the cluster's
    // new position.
    const need = (lo, hi, at) => at - fitRadius < lo && at + fitRadius > hi ? (lo + hi) / 2 - at
      : at - fitRadius < lo ? lo - (at - fitRadius) : at + fitRadius > hi ? hi - (at + fitRadius) : 0;
    const dx = need(area.left, area.right, origin[0]), dy = need(area.top, area.bottom, origin[1]);
    if (!panned && (Math.abs(dx) > 1 || Math.abs(dy) > 1) && this.map.unproject && this.map.getCenter) {
      const token = this._pendingGroup = {};
      const reopen = () => {
        this.map.off?.('moveend', reopen);
        if (this._pendingGroup !== token) return;
        this._pendingGroup = null;
        this._openGroup(points, parking, coordinates, { color, panned: true });
      };
      const center = this.map.project(this.map.getCenter());
      this.map.on('moveend', reopen);
      this.map.setCenter(this.map.unproject([center[0] - dx, center[1] - dy]), this._animation());
      setTimeout(reopen, 520); // in case the SDK settles without a moveend
      return;
    }

    const [ox, oy] = origin;
    const count = sorted.length;
    const hubColor = color || (parking ? '#087eac' : sorted.some(p => p.userData?.free) ? '#15834b' : '#c44343');
    const layer = document.createElement('div'); layer.className = 'nur-spider';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); layer.append(svg);
    const ns = svg.namespaceURI;
    const webs = layout.rings.map(({ r }) => {
      const web = document.createElementNS(ns, 'circle');
      for (const [key, value] of Object.entries({ cx: ox, cy: oy, r, class: 'nur-spider-web' })) web.setAttribute(key, value);
      svg.append(web);
      return web;
    });

    const hub = document.createElement('button');
    hub.type = 'button'; hub.className = 'nur-spider-hub';
    hub.textContent = parking ? `P ${count}` : String(count);
    hub.setAttribute('aria-label', `${count} · ${i18n.t('closePanel')}`);
    hub.style.cssText = `left:${ox}px;top:${oy}px;--pin-color:${hubColor}`;
    hub.onclick = e => { e.stopPropagation(); this.closePopup(); this._closeSpider(); };

    const positions = new Map(), reveal = [];
    sorted.forEach((p, index) => {
      const s = records.get(String(p.userData.id));
      const [offX, offY] = layout.offsets[index];
      const x = ox + offX, y = oy + offY;
      const dist = Math.hypot(offX, offY), ux = offX / dist, uy = offY / dist;
      const line = document.createElementNS(ns, 'line');
      for (const [key, value] of Object.entries({ x1: ox + ux * 23, y1: oy + uy * 23, x2: x - ux * layout.size / 2, y2: y - uy * layout.size / 2 })) line.setAttribute(key, value);
      line.setAttribute('pathLength', '1');
      line.setAttribute('class', 'nur-spider-leg');
      svg.append(line);
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'nur-spider-marker';
      button.textContent = String(index + 1); button.title = parking ? s.address : s.name;
      button.setAttribute('aria-label', `${index + 1}. ${button.title}`);
      button.style.cssText = `left:${x}px;top:${y}px;--spider-size:${layout.size}px;--pin-color:${parking ? '#087eac' : this._color(s)}`;
      button.onclick = e => { e.stopPropagation(); parking ? this.openZonePopup(s.id) : this.openStationPopup(s.id); };
      reveal.push({ button, line, dx: -offX, dy: -offY });
      layer.append(button); positions.set(String(s.id), [x, y]);
    });
    layer.append(hub); // last, so the hub paints over the legs' roots
    this.container.parentNode.append(layer);

    const animations = [];
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches && hub.animate) {
      // Tap acknowledged at once, then the web unfolds from the hub on a
      // spring: transform and opacity only, so it runs on the compositor.
      animations.push(hub.animate([
        { transform: 'translate(-50%, -50%) scale(1)' },
        { transform: 'translate(-50%, -50%) scale(.86)', offset: .3 },
        { transform: 'translate(-50%, -50%) scale(1.05)', offset: .7 },
        { transform: 'translate(-50%, -50%) scale(1)' },
      ], { duration: 420, easing: 'ease-out' }));
      webs.forEach((web, ring) => animations.push(web.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration: 360, delay: 120 + ring * 60, easing: 'ease-out', fill: 'backwards' })));
      const step = Math.min(22, 220 / count);
      reveal.forEach(({ button, line, dx, dy }, i) => {
        const delay = 50 + i * step;
        animations.push(line.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }],
          { duration: 300, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
        animations.push(button.animate([
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.2)`, opacity: 0 },
          { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        ], { duration: 460, delay, easing: 'cubic-bezier(.34,1.42,.64,1)', fill: 'backwards' }));
      });
    }
    this._spider = { element: layer, positions, animations, reveal, webs, hub, parking, origin: [ox, oy], ids: sorted.map(p => String(p.userData.id)) };
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
    // A stationary phone repeats the same fix every second; rebuilding the
    // WebGL circle each time is pure churn.
    const circleKey = Number.isFinite(accuracy) && accuracy > 0
      ? `${lng.toFixed(6)},${lat.toFixed(6)},${Math.round(accuracy)}` : null;
    if (circleKey !== this._accuracyKey) {
      this._accuracyKey = circleKey;
      this.userAccuracyCircle?.destroy(); this.userAccuracyCircle = null;
      if (circleKey) this.userAccuracyCircle = new mapgl.Circle(this.map, {
        coordinates, radius: accuracy, color: '#15834b15', strokeColor: '#15834b55', strokeWidth: 1,
      });
    }
    if (this._followUser) this.map.setCenter(coordinates, this._animation());
  }
  setFollowUser(on) { this._followUser = !!on; }
  isFollowingUser() { return this._followUser; }
  flyTo(lat, lng, zoom = 16) {
    this.map.setCenter([lng, lat], this._animation());
    this.map.setZoom(zoom, this._animation());
  }
  highlightStation(station) { this.openStationPopup(station.id); }
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

    // Manual start: for when the geofence missed (weak GPS, location off) or
    // the user said "not now" and changed their mind.
    const canStart = typeof parkingSession !== 'undefined' && !parkingSession.isActive();

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

        ${canStart ? `
        <div class="popup-actions">
          <button class="btn btn-primary" data-action="zone-start" data-id="${esc(zone.id)}">${esc(i18n.t('pkStartHere'))}</button>
          <button class="btn btn-ghost" data-action="zone-rules">${esc(i18n.t('pkRules'))}</button>
        </div>` : `
        <div class="popup-actions popup-actions--single">
          <button class="btn btn-primary" data-action="zone-rules">${esc(i18n.t('pkRules'))}</button>
        </div>`}
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

    // Connector rows.
    // Each row answers one question in order: which plug, what state, and —
    // when it is busy — when it frees up. The meter shows the real charge
    // level, so its width always matches the number printed beside it.
    const connRows = station.connectors.map((c) => {
      if (c.isAvailable) {
        return `
          <div class="conn conn--free">
            <span class="conn-id" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Zm6 9v4"/></svg></span>
            <span class="conn-number">${escHtml(i18n.t('connectorLabel'))} ${escHtml(c.id)}</span>
            <span class="conn-state">
              <svg class="conn-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>
              ${escHtml(i18n.t('available'))}
            </span>
          </div>`;
      }

      const level = Math.max(0, Math.min(100, Math.round(c.chargeLevel || 0)));
      if (c.isCharging || c.isStarting || level > 0) {
        const tone = level >= 80 ? 'tone-high' : level >= 40 ? 'tone-mid' : 'tone-low';
        return `
          <div class="conn conn--charging">
            <span class="conn-id" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Zm6 9v4"/></svg></span>
            <span class="conn-number">${escHtml(i18n.t('connectorLabel'))} ${escHtml(c.id)}</span>
            <div class="conn-body">
              <div class="conn-line">
                <span class="conn-state conn-state--charging"><svg class="conn-state-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M13 2 4 13h6l-1 9 11-13h-7z"/></svg>${escHtml(i18n.t(c.isStarting ? 'startCharging' : 'charging'))}</span>
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
          <span class="conn-id" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6 6 6 0 0 1-6-6V8Zm6 9v4"/></svg></span>
          <span class="conn-number">${escHtml(i18n.t('connectorLabel'))} ${escHtml(c.id)}</span>
          <span class="conn-state conn-state--busy"><svg class="conn-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>${escHtml(i18n.t('occupied'))}</span>
        </div>`;
    }).join('');
    const connSectionHead = station.connectors.length
      ? `<div class="conn-section-head"><span>${escHtml(i18n.t('connectors'))}</span></div>`
      : '';

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
        ${typeof stationAnalytics !== 'undefined' ? stationAnalytics.stationHistoryHtml(station.id) : ''}
        ${connSectionHead}
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
