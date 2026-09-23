// ============================================
// NerU v2 — UI Module
// ============================================

const esc = (str) => String(str ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

/**
 * Try to determine whether the station is open right now
 * from its work_schedule string (e.g. "от 08:00 до 22:00",
 * "08:00-22:00", "24/7", "24 соат").
 */
function parseSchedule(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.toLowerCase().trim();

  if (/24\s*\/\s*7|24\s*соат|24\s*час|24\s*ч\b|24h\b|круглосут|ҳамавақт|нон.?стоп|non.?stop/.test(s)) {
    return { is24: true, isOpen: true, open: '00:00', close: '24:00' };
  }

  // The feed writes the same hours five different ways — "07:00 - 22:00",
  // "07:00 то 22:00", "07.00 - 22.00" — so the separator has to be either.
  const times = [...s.matchAll(/(\d{1,2})[:.](\d{2})/g)];
  if (times.length < 2) return null;

  const h1 = +times[0][1], m1 = +times[0][2];
  const h2 = +times[1][1], m2 = +times[1][2];

  if (h1 > 23 || m1 > 59 || h2 > 24 || m2 > 59 || (h2 === 24 && m2 !== 0)) return null;

  // Same open/close time or 0:00-24:00 → 24h station
  if ((h1 === h2 && m1 === m2) || (h1 === 0 && m1 === 0 && h2 >= 23 && m2 >= 59) || (h1 === 0 && m1 === 0 && h2 === 24)) {
    return { is24: true, isOpen: true, open: '00:00', close: '24:00' };
  }

  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dushanbe', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const nowMin = +parts.find(p => p.type === 'hour').value * 60 + +parts.find(p => p.type === 'minute').value;
  const openMin = h1 * 60 + m1;
  const closeMin = h2 * 60 + m2;

  const isOpen = closeMin > openMin
    ? (nowMin >= openMin && nowMin < closeMin)
    : (nowMin >= openMin || nowMin < closeMin);

  const fmt = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

  return {
    is24: false,
    isOpen,
    open: fmt(h1, m1),
    close: fmt(h2, m2),
  };
}

/** Walking ETA assuming ~5 km/h. Returns {val, type} where type is 'minSuffix'|'hrSuffix', or null. */
function walkingEta(km) {
  if (!km || km <= 0) return null;
  const min = Math.round(km * 12);
  if (min < 1) return { val: '<1', type: 'minSuffix' };
  if (min < 60) return { val: String(min), type: 'minSuffix' };
  return { val: (km / 5).toFixed(1), type: 'hrSuffix' };
}

class UI {
  constructor() {
    this.sidebarOpen = false;
    this.currentFilter = 'all';
    this.toastTimeout = null;
    this.statsMode = 'ev'; // 'ev' | 'parking'
  }

  init() {
    this.cacheElements();
    this.bindEvents();
    i18n.updateDOM();
    // Position the segmented indicators and the tab lens once fonts/layout settle
    requestAnimationFrame(() => {
      this.moveIndicator(this.filterSeg);
      this.moveIndicator(this.langSeg);
      this.moveTabLens({ instant: true });
    });
    this.watchTabLens();
    // Language change re-flows widths — re-measure after DOM updates. The tab
    // lens is sized off its label, so a new language resizes it too.
    window.addEventListener('langchange', () => {
      requestAnimationFrame(() => {
        this.moveIndicator(this.filterSeg);
        this.moveIndicator(this.langSeg);
        this.moveTabLens({ instant: true });
      });
    });
  }

  cacheElements() {
    this.sidebar = document.getElementById('sidebar');
    this.sidebarOverlay = document.getElementById('sidebar-overlay');
    this.sidebarContent = document.getElementById('sidebar-results');
    this.sidebarTitle = document.getElementById('sidebar-title');
    this.fabBtn = document.getElementById('fab-find');
    this.statsTotal = document.getElementById('stat-total');
    this.statsFree = document.getElementById('stat-free');
    this.lastUpdateEl = document.getElementById('last-update');
    this.loadingOverlay = document.getElementById('loading-overlay');
    this.toastEl = document.getElementById('toast');

    this.filterSeg = document.getElementById('filter-seg');
    this.langSeg = document.getElementById('lang-seg');
    this.filterBtns = this.filterSeg?.querySelectorAll('.filter-btn') || [];
    this.langBtns = this.langSeg?.querySelectorAll('.lang-btn') || [];

    this.statsBusy = document.getElementById('stat-busy');

    this.tabbar = document.getElementById('tabbar');
    this.tabLens = document.getElementById('tab-lens');
  }

  bindEvents() {
    this.fabBtn?.addEventListener('click', (e) => {
      this.rippleFromEvent(e, this.fabBtn);
      window.dispatchEvent(new CustomEvent('findNearest'));
    });

    document.getElementById('sidebar-close')?.addEventListener('click', () => this.closeSidebar());
    this.sidebarOverlay?.addEventListener('click', () => this.closeSidebar());

    // Language switcher
    this.langBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const lang = btn.getAttribute('data-lang');
        this.rippleFromEvent(e, btn);
        i18n.setLang(lang);
        this.setActive(this.langBtns, btn);
        this.moveIndicator(this.langSeg);
      });
    });

    // Filter switcher
    this.filterBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.currentFilter = btn.getAttribute('data-filter');
        this.rippleFromEvent(e, btn);
        this.setActive(this.filterBtns, btn);
        this.moveIndicator(this.filterSeg);
        window.dispatchEvent(new CustomEvent('filterChanged', {
          detail: { filter: this.currentFilter },
        }));
      });
    });

    // Delegate sidebar button clicks (no inline onclick)
    this.sidebarContent?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-station-id');
      if (action === 'show-map' && id) {
        e.preventDefault();
        app.showOnMap(id);
      }
      if (action === 'route' && id) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('routeRequest', { detail: { stationId: id } }));
      }
    });

    document.getElementById('route-clear')?.addEventListener('click', () => {
      stationRouter.clear();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.sidebarOpen) this.closeSidebar();
    });

    window.addEventListener('resize', () => {
      this.moveIndicator(this.filterSeg);
      this.moveIndicator(this.langSeg);
    });


  }

  setActive(nodeList, activeBtn) {
    nodeList.forEach((b) => b.classList.remove('is-active'));
    activeBtn.classList.add('is-active');
  }

  /**
   * Slide a segmented control's lens onto its active button.
   *
   * Same glass and the same travel as the tab bar's lens — it stretches the
   * way it is going and its rim disperses while it moves. Two selections in
   * one app should not move in two different ways.
   */
  moveIndicator(segEl) {
    if (!segEl) return;
    const indicator = segEl.querySelector('.seg-indicator');
    const active = segEl.querySelector('.seg-btn.is-active');
    if (!indicator || !active) return;

    const { offsetLeft, offsetWidth } = active;
    const prev = this._segX instanceof Map ? this._segX.get(segEl) : undefined;
    if (!(this._segX instanceof Map)) this._segX = new Map();

    if (prev !== undefined && offsetLeft !== prev) {
      indicator.style.setProperty('--lens-skew', offsetLeft > prev ? '4deg' : '-4deg');
      indicator.classList.remove('is-traveling');
      void indicator.offsetWidth;
      indicator.classList.add('is-traveling');
      clearTimeout(this._segTimers?.get(segEl));
      if (!this._segTimers) this._segTimers = new Map();
      this._segTimers.set(segEl, setTimeout(() => indicator.classList.remove('is-traveling'), 600));
    }

    indicator.style.transform = `translate3d(${offsetLeft}px, 0, 0)`;
    indicator.style.width = `${offsetWidth}px`;
    this._segX.set(segEl, offsetLeft);
  }

  /**
   * Light up a tab. The badge rises out of the bar for the active one and
   * settles back for the rest.
   *
   * Overlay tabs (analytics) borrow the raised badge while their panel is
   * open; `syncTabToMode()` hands it back on close, so the bar always ends
   * up showing the layer the map is actually on.
   */
  setActiveTab(tab) {
    const bar = this.tabbar;
    if (!bar) return;

    bar.querySelectorAll('.tabbar-item').forEach((item) => {
      const on = item.dataset.tab === tab;
      const was = item.classList.contains('is-active');
      item.classList.toggle('is-active', on);

      if (on) {
        item.setAttribute('aria-current', 'page');
        // Only animate the arrival, never the restore of a tab that was
        // already up — a badge that re-springs on every state sync reads as
        // a glitch rather than as feedback.
        if (!was && !this._skipLanding) {
          item.classList.add('is-landing');
          setTimeout(() => item.classList.remove('is-landing'), 420);
        }
      } else {
        item.removeAttribute('aria-current');
      }
    });

    this.moveTabLens();
  }

  /**
   * Slide the glass lens onto the active tab.
   *
   * The lens is one element for the whole bar rather than a background per
   * item, because a moving piece of glass is the selection: it stretches the
   * way it travels and disperses at its rim while it does. CSS owns both —
   * this only supplies the geometry, the direction of travel, and the flag
   * that turns the stretch on for the length of one move.
   *
   * `instant` places it without travel: first paint, a resize, a rotation.
   * Animating from wherever the lens happened to sit before a re-measure is
   * a slide the user never asked for.
   */
  moveTabLens({ instant = false } = {}) {
    const bar = this.tabbar;
    const lens = this.tabLens;
    if (!bar || !lens) return;

    const item = bar.querySelector('.tabbar-item.is-active');
    // The bar is display:none on desktop, so everything measures 0. Bail and
    // let the ResizeObserver place it if the viewport ever narrows.
    if (!item || !bar.offsetWidth) return;

    // Equal-width slots contain both the icon and the longest clipped caption.
    const width = item.offsetWidth - 4;
    const x = Math.round(item.offsetLeft + (item.offsetWidth - width) / 2);
    const first = this._lensX === undefined;
    const moved = !first && x !== this._lensX;

    if (instant || first) {
      lens.classList.add('is-instant');
      // Force the placement to land before transitions come back on,
      // otherwise the class removal below is coalesced into the same frame
      // and the lens animates anyway.
      lens.style.setProperty('--lens-w', `${width}px`);
      lens.style.setProperty('--lens-x', `${x}px`);
      void lens.offsetWidth;
      lens.classList.remove('is-instant');
    } else {
      if (moved) {
        lens.style.setProperty('--lens-skew', x > this._lensX ? '5deg' : '-5deg');
        // Restart the stretch even on a rapid second tap: drop the class,
        // flush, add it back.
        lens.classList.remove('is-traveling');
        void lens.offsetWidth;
        lens.classList.add('is-traveling');
        clearTimeout(this._lensTimer);
        this._lensTimer = setTimeout(() => lens.classList.remove('is-traveling'), 600);
      }
      lens.style.setProperty('--lens-w', `${width}px`);
      lens.style.setProperty('--lens-x', `${x}px`);
    }

    this._lensX = x;
    bar.classList.add('is-lens-ready');
  }

  /** Keep the lens on its tab through rotation, resize and desktop→phone. */
  watchTabLens() {
    const bar = this.tabbar;
    if (!bar) return;

    const replace = () => this.moveTabLens({ instant: true });
    window.addEventListener('resize', replace);
    window.addEventListener('orientationchange', replace);
    if (window.ResizeObserver) {
      // Also fires when the media query flips the bar from none to flex,
      // which is the one case a resize listener alone measures too early.
      new ResizeObserver(replace).observe(bar);
    }
  }

  /** Return the raised badge to whichever map layer is showing. */
  syncTabToMode() {
    this.setActiveTab(this.statsMode === 'parking' ? 'parking' : 'ev');
  }

  /**
   * Press feedback. The badge dips under the finger and a short pulse fires
   * where the platform has a motor — Safari on iOS has neither Vibration API
   * nor a web haptics hook, so the guard means most of our users get the
   * visual dip alone. That is the whole feedback there, which is why the dip
   * is not optional.
   */
  bindTabPressure() {
    const bar = this.tabbar;
    if (!bar) return;

    bar.addEventListener('pointerdown', (e) => {
      const item = e.target.closest('.tabbar-item');
      if (!item) return;
      item.classList.add('is-pressing');
      // Only a real finger may buzz: Chrome logs an error for vibrate() on a
      // synthetic event, and a programmatic tab change should not buzz anyway.
      if (e.isTrusted && navigator.vibrate) {
        try { navigator.vibrate(10); } catch (_) {}
      }
    });

    const release = () => {
      bar.querySelectorAll('.is-pressing').forEach((i) => i.classList.remove('is-pressing'));
    };
    bar.addEventListener('pointerup', release);
    bar.addEventListener('pointercancel', release);
    bar.addEventListener('pointerleave', release);

    this.bindTabDrag();
  }

  /**
   * The lens can be dragged along the bar, the way the iOS tab bar lets you
   * carry the selection between tabs instead of only tapping one.
   *
   * A tap and a drag start identically, so this stays out of the way until
   * the finger has actually travelled DRAG_SLOP; below that the pointer
   * sequence ends in an ordinary click and the existing handler does its job.
   * Once dragging, the lens leaves its transition behind and is written
   * straight to a custom property each frame — one style write per move, no
   * layout reads, since every measurement is taken once on pointerdown.
   *
   * Release hands the tab over to the same click path a tap would take, so
   * there is exactly one place that knows what a tab does.
   */
  bindTabDrag() {
    const bar = this.tabbar;
    const lens = this.tabLens;
    if (!bar || !lens) return;

    const DRAG_SLOP = 8;
    let d = null;

    const nearest = (centre) => d.items.reduce(
      (best, it) => (Math.abs(it.centre - centre) < Math.abs(best.centre - centre) ? it : best),
      d.items[0]
    );

    bar.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || !bar.offsetWidth) return;
      const barRect = bar.getBoundingClientRect();
      const items = [...bar.querySelectorAll('.tabbar-item')].map((el) => {
        const r = el.getBoundingClientRect();
        return { el, centre: r.left - barRect.left + r.width / 2 };
      });
      d = {
        id: e.pointerId,
        startX: e.clientX,
        lensX: this._lensX ?? 0,
        width: parseFloat(lens.style.getPropertyValue('--lens-w')) || 60,
        max: bar.clientWidth,
        from: e.target.closest('.tabbar-item'),
        items,
        dragging: false,
        over: null,
      };
    });

    bar.addEventListener('pointermove', (e) => {
      if (!d || e.pointerId !== d.id) return;
      const dx = e.clientX - d.startX;

      if (!d.dragging) {
        if (Math.abs(dx) < DRAG_SLOP) return;
        d.dragging = true;
        bar.querySelectorAll('.is-pressing').forEach((i) => i.classList.remove('is-pressing'));
        lens.classList.add('is-dragging');
        lens.classList.remove('is-traveling');
        // Hands the raised badge over to whichever tab the lens is over, so
        // the selection travels with the finger instead of staying behind on
        // the tab the app has not left yet.
        bar.classList.add('is-carrying');
        // Capture keeps the drag alive past the bar's edge, but it throws on
        // a pointer the browser no longer knows about — and it is an
        // enhancement, not the mechanism. Never let it take the drag down.
        try { bar.setPointerCapture(d.id); } catch (_) {}
      }

      const x = Math.max(4, Math.min(d.max - d.width - 4, d.lensX + dx));
      lens.style.setProperty('--lens-x', `${x}px`);
      // A little lean into the direction of travel, so the glass feels
      // carried rather than teleported.
      lens.style.setProperty('--lens-skew', `${Math.max(-6, Math.min(6, dx * 0.06))}deg`);

      const over = nearest(x + d.width / 2);
      if (over !== d.over) {
        d.over?.el.classList.remove('is-under-lens');
        over.el.classList.add('is-under-lens');
        d.over = over;
        // One tick per boundary crossed — the only feedback a finger gets
        // that it has moved far enough to change the answer.
        if (e.isTrusted && navigator.vibrate) {
          try { navigator.vibrate(8); } catch (_) {}
        }
      }
    });

    const finish = (e, cancelled) => {
      if (!d || (e && e.pointerId !== d.id)) return;
      const state = d;
      d = null;
      if (!state.dragging) {
        bar.classList.remove('is-carrying');
        return;
      }

      try { bar.releasePointerCapture(state.id); } catch (_) {}
      lens.classList.remove('is-dragging');
      lens.style.removeProperty('--lens-skew');

      // Cancelled, or dropped back where it started: settle onto the tab the
      // app is actually on rather than leaving the lens between two of them.
      if (cancelled || !state.over || state.over.el === state.from) {
        bar.classList.remove('is-carrying');
        state.over?.el.classList.remove('is-under-lens');
        this.moveTabLens();
        return;
      }

      // Same path as a tap, so a dragged tab and a tapped tab cannot drift.
      // The badge is already up and filled on this tab — it was carried here
      // — so the landing pop would be a second arrival for one gesture. The
      // carry classes come off only after the click, otherwise the badge
      // drops for a frame and springs again on the tab it never left.
      this._skipLanding = true;
      state.over.el.click();
      this._skipLanding = false;
      bar.classList.remove('is-carrying');
      state.over.el.classList.remove('is-under-lens');
    };

    bar.addEventListener('pointerup', (e) => finish(e, false));
    bar.addEventListener('pointercancel', (e) => finish(e, true));
  }

  updateLangButtons(lang) {
    let found = null;
    this.langBtns.forEach((btn) => {
      if (btn.getAttribute('data-lang') === lang) found = btn;
    });
    if (found) {
      this.setActive(this.langBtns, found);
      this.moveIndicator(this.langSeg);
    }
  }

  rippleFromEvent(e, el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX ?? (rect.left + rect.width / 2)) - rect.left) / rect.width * 100;
    const y = ((e.clientY ?? (rect.top + rect.height / 2)) - rect.top) / rect.height * 100;
    el.style.setProperty('--rx', `${x}%`);
    el.style.setProperty('--ry', `${y}%`);
  }

  openSidebar(results) {
    this.sidebarOpen = true;
    // Remove and re-add 'open' to retrigger CSS animations on every open
    this.sidebar.classList.remove('open');
    void this.sidebar.offsetHeight; // force reflow
    this.sidebar.classList.add('open');
    this.sidebarOverlay.classList.add('visible');
    document.body.classList.add('sidebar-open');
    this.renderResults(results);
  }

  closeSidebar() {
    this.sidebarOpen = false;
    this.sidebar.classList.remove('open');
    this.sidebarOverlay.classList.remove('visible');
    document.body.classList.remove('sidebar-open');
    stationMap.clearHighlight();
  }

  renderResults(results) {
    if (!results || results.length === 0) {
      this.sidebarContent.innerHTML = `
        <div class="no-results">
          <div class="no-results-icon">⚡</div>
          <p>${esc(i18n.t('noFreeStations'))}</p>
        </div>
      `;
      return;
    }

    this.sidebarContent.innerHTML = results
      .map((s, i) => this.renderCard(s, i))
      .join('');
  }

  renderCard(station, index) {
    // Map popups and search results use one design and the same live data.
    return `
      <article class="card photo-result" data-station-id="${esc(station.id)}" style="--i: ${index}">
        ${stationMap.buildPopup(station)}
        <button class="btn btn-ghost station-show-map" data-action="show-map" data-station-id="${esc(station.id)}">
          ${esc(i18n.t('navigateTo'))}
        </button>
      </article>
    `;
  }


  updateStats(stats) {
    // While the map shows parking only, the HUD counts bays. The 30s station
    // refresh must not quietly overwrite it with charger numbers.
    if (this.statsMode === 'parking') return;
    this._writeStats(stats.total, stats.freeConnectors, stats.totalConnectors - stats.freeConnectors);
  }

  updateParkingStats(pstats) {
    if (this.statsMode !== 'parking') return;
    this._writeStats(pstats.zones, pstats.places, pstats.accessible);
  }

  _writeStats(total, mid, right) {
    if (this.statsTotal) this.statsTotal.textContent = total;
    if (this.statsFree)  this.statsFree.textContent  = mid;
    if (this.statsBusy)  this.statsBusy.textContent  = right;
  }

  /**
   * Swap what the three HUD cells mean. The labels keep their data-i18n
   * wiring so a language change after the swap still translates them.
   */
  setStatsMode(mode) {
    this.statsMode = mode;
    const keys = mode === 'parking'
      ? ['pkZonesLabel', 'pkPlaces', 'pkAccessible']
      : ['totalStations', 'availableNow', 'occupiedNow'];

    ['total', 'free', 'busy'].forEach((cell, i) => {
      document.getElementById(`stat-label-${cell}`)?.setAttribute('data-i18n', keys[i]);
      document.getElementById(`md-label-${cell}`)?.setAttribute('data-i18n', keys[i]);
    });

    document.body.dataset.mode = mode;
    document.getElementById('filter-seg')?.classList.toggle('is-inert', mode === 'parking');
    document.getElementById('filter-seg')?.setAttribute('aria-disabled', String(mode === 'parking'));
    this.syncTabToMode();
    i18n.updateDOM();
  }

  updateLastRefresh(date) {
    if (this.lastUpdateEl && date) {
      this.lastUpdateEl.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }

  showLoading() { this.loadingOverlay?.classList.add('visible'); }
  hideLoading() { this.loadingOverlay?.classList.remove('visible'); }

  showToast(message, type = 'info', duration = 3000) {
    if (!this.toastEl) return;
    clearTimeout(this.toastTimeout);
    this.toastEl.textContent = message;
    this.toastEl.className = `toast toast-${type} toast-visible`;
    this.toastTimeout = setTimeout(() => {
      this.toastEl.classList.remove('toast-visible');
    }, duration);
  }

  showRoutePanel(station, { distance, duration }) {
    const panel = document.getElementById('route-panel');
    if (!panel) return;

    const destEl = document.getElementById('route-dest');
    const distEl = document.getElementById('route-distance');
    const durEl  = document.getElementById('route-duration');

    if (destEl) destEl.textContent = station.name;

    if (distEl) {
      const f = GeoLocation.formatDistance(distance / 1000);
      distEl.textContent = `${f.value} ${i18n.t(f.unit)}`;
    }

    if (durEl) {
      const mins = Math.round(duration / 60);
      if (mins < 60) {
        durEl.textContent = `${mins} ${i18n.t('minSuffix')}`;
      } else {
        const h = Math.floor(mins / 60), m = mins % 60;
        durEl.textContent = m
          ? `${h}${i18n.t('hrSuffix')} ${m}${i18n.t('minSuffix')}`
          : `${h} ${i18n.t('hrSuffix')}`;
      }
    }

    panel.classList.add('is-active');
  }

  hideRoutePanel() {
    document.getElementById('route-panel')?.classList.remove('is-active');
  }

  applyFilter(stations) {
    switch (this.currentFilter) {
      case 'available':
        return stations.filter((s) => s.hasAvailable);
      // "Fast" is a class of charger, not one exact rating: the feed also
      // carries 118/122/123 kW units that belong with the 120s.
      case '120w':
        return stations.filter((s) => s.capacityKw >= 100);
      case '60w':
        return stations.filter((s) => s.capacityKw > 0 && s.capacityKw < 100);
      default:
        return stations;
    }
  }
}

const ui = new UI();
