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

  // Same open/close time or 0:00-24:00 → 24h station
  if ((h1 === h2 && m1 === m2) || (h1 === 0 && m1 === 0 && h2 >= 23 && m2 >= 59) || (h2 === 24)) {
    return { is24: true, isOpen: true, open: '00:00', close: '24:00' };
  }

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
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
    if (this.themeToggle) {
      this.themeToggle.checked = (this.getTheme() === 'dark');
    }
    i18n.updateDOM();
    // Position the segmented indicators once fonts/layout settle
    requestAnimationFrame(() => {
      this.moveIndicator(this.filterSeg);
      this.moveIndicator(this.langSeg);
      this.moveIndicator(this.mobileSeg);
    });
    // And on resize
    window.addEventListener('resize', () => {
      this.moveIndicator(this.filterSeg);
      this.moveIndicator(this.langSeg);
      this.moveIndicator(this.mobileSeg);
    });
    // Language change re-flows widths — re-measure after DOM updates
    window.addEventListener('langchange', () => {
      requestAnimationFrame(() => {
        this.moveIndicator(this.filterSeg);
        this.moveIndicator(this.langSeg);
        this.moveIndicator(this.mobileSeg);
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

    this.themeToggle = document.getElementById('theme-toggle');
    this.statsBusy = document.getElementById('stat-busy');

    // Mobile drawer
    this.burgerBtn = document.getElementById('burger-btn');
    this.tabbar = document.getElementById('tabbar');
    this.mobileDrawer = document.getElementById('mobile-drawer');
    this.mobileOverlay = document.getElementById('mobile-overlay');
    this.mobileSeg = document.getElementById('mobile-filter-seg');
    this.mobileFilterBtns = this.mobileSeg?.querySelectorAll('.filter-btn') || [];
    this.mobileLangSeg = document.getElementById('mobile-lang-seg');
    this.mobileLangBtns = this.mobileLangSeg?.querySelectorAll('.lang-btn') || [];
    this.mdTotal = document.getElementById('md-total');
    this.mdFree = document.getElementById('md-free');
    this.mdBusy = document.getElementById('md-busy');
  }

  getTheme() {
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  setTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('neru-theme', next); } catch (_) {}

    // The droid switch reads "on = night", so checked tracks the dark theme.
    if (this.themeToggle) this.themeToggle.checked = (next === 'dark');

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) {
      metaTheme.setAttribute('content', next === 'light' ? '#ffffff' : '#05070d');
    }

    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
  }

  toggleTheme() {
    this.setTheme(this.getTheme() === 'light' ? 'dark' : 'light');
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
        // Sync mobile filter
        const mob = [...this.mobileFilterBtns].find(b => b.getAttribute('data-filter') === this.currentFilter);
        if (mob) { this.setActive(this.mobileFilterBtns, mob); this.moveIndicator(this.mobileSeg); }
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

    // Burger + mobile drawer
    this.burgerBtn?.addEventListener('click', () => this.toggleMobileDrawer());
    this.mobileOverlay?.addEventListener('click', () => this.closeMobileDrawer());

    this.mobileFilterBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        this.currentFilter = btn.getAttribute('data-filter');
        this.rippleFromEvent(e, btn);
        this.setActive(this.mobileFilterBtns, btn);
        this.moveIndicator(this.mobileSeg);
        // Sync desktop filter
        const desk = [...this.filterBtns].find(b => b.getAttribute('data-filter') === this.currentFilter);
        if (desk) { this.setActive(this.filterBtns, desk); this.moveIndicator(this.filterSeg); }
        window.dispatchEvent(new CustomEvent('filterChanged', { detail: { filter: this.currentFilter } }));
        setTimeout(() => this.closeMobileDrawer(), 200);
      });
    });

    // Mobile lang switcher
    this.mobileLangBtns.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const lang = btn.getAttribute('data-lang');
        this.rippleFromEvent(e, btn);
        i18n.setLang(lang);
        this.setActive(this.mobileLangBtns, btn);
        this.moveIndicator(this.mobileLangSeg);
        // Sync desktop lang buttons (even though hidden on mobile)
        const desk = [...this.langBtns].find(b => b.getAttribute('data-lang') === lang);
        if (desk) { this.setActive(this.langBtns, desk); this.moveIndicator(this.langSeg); }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.sidebarOpen) this.closeSidebar();
        else this.closeMobileDrawer();
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) this.closeMobileDrawer();
      // The bar is display:none above 768px, so its offsets only become real
      // once a resize brings it back.
      this.moveTabIndicator();
    });

    this.themeToggle?.addEventListener('change', () => {
      this.toggleTheme();
    });
  }

  setActive(nodeList, activeBtn) {
    nodeList.forEach((b) => b.classList.remove('is-active'));
    activeBtn.classList.add('is-active');
  }

  moveIndicator(segEl) {
    if (!segEl) return;
    const indicator = segEl.querySelector('.seg-indicator');
    const active = segEl.querySelector('.seg-btn.is-active');
    if (!indicator || !active) return;
    const { offsetLeft, offsetWidth } = active;
    indicator.style.transform = `translate3d(${offsetLeft}px, 0, 0)`;
    indicator.style.width = `${offsetWidth}px`;
  }

  /**
   * Light up a tab and slide the pill to it.
   *
   * Overlay tabs (analytics, more) borrow the pill while their panel is
   * open; `syncTabToMode()` hands it back on close, so the bar always ends
   * up showing the layer the map is actually on.
   */
  setActiveTab(tab) {
    const bar = this.tabbar;
    if (!bar) return;
    bar.querySelectorAll('.tabbar-item').forEach((item) => {
      const on = item.dataset.tab === tab;
      item.classList.toggle('is-active', on);
      if (on) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    bar.dataset.tone = tab === 'parking' ? 'cyan' : tab === 'ev' ? 'volt' : 'neutral';
    this.moveTabIndicator();
  }

  /** Return the pill to whichever map layer is showing. */
  syncTabToMode() {
    this.setActiveTab(this.statsMode === 'parking' ? 'parking' : 'ev');
  }

  moveTabIndicator() {
    const bar = this.tabbar;
    const indicator = bar?.querySelector('.tabbar-indicator');
    const active = bar?.querySelector('.tabbar-item.is-active');
    if (!indicator || !active) return;
    // Hidden on desktop, where every offset measures 0 — leave the pill be
    // rather than parking it at the left edge for the next resize to reveal.
    if (!active.offsetWidth) return;
    indicator.style.transform = `translate3d(${active.offsetLeft}px, 0, 0)`;
    indicator.style.width = `${active.offsetWidth}px`;
    // The very first placement must not animate: growing from 0px at the left
    // edge reads as a stray element sliding in, not as a tab being selected.
    if (!bar.dataset.ready) {
      requestAnimationFrame(() => { bar.dataset.ready = '1'; });
    }
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
    // Sync mobile lang seg
    let mFound = null;
    this.mobileLangBtns.forEach((btn) => {
      if (btn.getAttribute('data-lang') === lang) mFound = btn;
    });
    if (mFound) {
      this.setActive(this.mobileLangBtns, mFound);
      this.moveIndicator(this.mobileLangSeg);
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
    const isBest = index === 0;
    const rank = String(index + 1).padStart(2, '0');

    // Status badge text
    let strip = { cls: 'busy', label: i18n.t('busy') };
    if (station.statusTag === 'freeNow') strip = { cls: 'free', label: i18n.t('freeNow') };
    else if (station.statusTag === 'soonFree') strip = { cls: 'soon', label: i18n.t('soonFree') };

    // Distance + ETA
    const dist = station.distanceFormatted || { value: '—', unit: 'meters' };
    const eta = walkingEta(station.distance);

    // Schedule
    const sch = parseSchedule(station.schedule);
    let scheduleHtml = '';
    if (sch) {
      if (sch.is24) {
        scheduleHtml = `<span class="open-now">${esc(i18n.t('open247') || '24/7')}</span>`;
      } else {
        scheduleHtml = `<span class="open-now">${sch.open}–${sch.close}</span>`;
      }
    } else if (station.schedule) {
      scheduleHtml = `<span class="open-now">${esc(station.schedule)}</span>`;
    }

    // Connector dots & rows
    const stripDots = station.connectors.map((c) => {
      let cls = 'busy';
      if (c.isAvailable) cls = 'free';
      else if (c.chargeLevel >= 80) cls = 'high';
      return `<span class="strip-dot ${cls}" title="#${esc(c.id)}"></span>`;
    }).join('');

    // Calc minimum ETA among charging connectors for the wait banner
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
      if (minEta) {
        const etaStr = minEta.val === '<1'
          ? esc(i18n.t('etaSoon'))
          : `${esc(i18n.t('freeIn'))} ~${esc(minEta.val)} ${esc(i18n.t(minEta.type))}`;
        waitBannerHtml = `
          <div class="wait-banner">
            <svg class="wait-icon" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke-width="1.5" fill="none"/>
              <path d="M12 7v5l3 3" stroke-width="1.5" stroke-linecap="round" fill="none"/>
            </svg>
            <span class="wait-text">${etaStr}</span>
          </div>`;
      }
    }

    // Same connector language as the map card, so a station reads identically
    // wherever the user meets it.
    const connRows = station.connectors.map((c) => {
      if (c.isAvailable) {
        return `
          <div class="conn conn--free">
            <span class="conn-id">#${esc(c.id)}</span>
            <span class="conn-state">
              <span class="conn-pip" aria-hidden="true"></span>
              ${esc(i18n.t('available'))}
            </span>
          </div>`;
      }

      const level = Math.max(0, Math.min(100, Math.round(c.chargeLevel || 0)));
      if (c.isCharging || c.isStarting || level > 0) {
        const tone = level >= 80 ? 'tone-high' : level >= 40 ? 'tone-mid' : 'tone-low';
        const eta = station.capacityWatts > 0 ? chargingEta(level, station.capacityWatts) : null;
        const freeIn = eta
          ? (eta.val === '<1'
              ? esc(i18n.t('etaSoonShort'))
              : `~${esc(eta.val)} ${esc(i18n.t(eta.type))}`)
          : '';
        return `
          <div class="conn conn--charging">
            <span class="conn-id">#${esc(c.id)}</span>
            <div class="conn-body">
              <div class="conn-line">
                <span class="conn-state conn-state--charging">${esc(i18n.t(c.isStarting ? 'startCharging' : 'charging'))}</span>
                ${freeIn ? `<span class="conn-freein">${freeIn}</span>` : ''}
              </div>
              <div class="conn-meter" role="progressbar" aria-valuenow="${level}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(i18n.t('chargeLabel'))}">
                <span class="conn-meter-fill ${tone}" style="width:${level}%"></span>
              </div>
              <span class="conn-sub">${esc(i18n.t('chargeLabel'))} ${level}%</span>
            </div>
          </div>`;
      }

      return `
        <div class="conn conn--busy">
          <span class="conn-id">#${esc(c.id)}</span>
          <span class="conn-state conn-state--busy">${esc(i18n.t('occupied'))}</span>
        </div>`;
    }).join('');

    // Power chip
    const isFast = station.capacityWatts >= 120;
    const powerChip = station.capacity
      ? `<span class="power-chip ${isFast ? 'is-fast' : ''}">
           <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
           ${esc(String(station.capacityKw))} ${esc(i18n.t('kwUnit'))}
         </span>`
      : '';

    const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`;

    // Sub line: address · schedule
    const subParts = [];
    // Many stations report the address as their name; printing it twice adds
    // nothing but noise.
    if (station.address && station.address.trim() !== station.name.trim()) {
      subParts.push(`<span>${esc(station.address)}</span>`);
    }
    if (scheduleHtml) {
      if (subParts.length) subParts.push('<span class="dot-sep">·</span>');
      subParts.push(scheduleHtml);
    }

    return `
      <article class="card ${isBest ? 'card-best' : ''}" data-station-id="${esc(station.id)}" style="--i: ${index}">
        <div class="card-top">
          <div class="card-rank">
            <span class="rank-num">${rank}</span>
            <span class="rank-label">${isBest ? esc(i18n.t('bestChoice')) : esc(i18n.t('recommended'))}</span>
          </div>
          <div class="card-top-right">
            <img src="logo.png" alt="NŪR" class="card-logo" aria-hidden="true">
            ${powerChip}
          </div>
        </div>

        <h3 class="card-title">${esc(station.name)}</h3>
        <p class="card-sub">${subParts.join('')}</p>

        <div class="card-data">
          <div class="data-cell">
            <span class="data-label">${esc(i18n.t('distance'))}</span>
            <span class="data-val">${esc(dist.value)}<span class="unit">${esc(i18n.t(dist.unit))}</span></span>
          </div>
          <div class="data-cell">
            <span class="data-label">${esc(i18n.t('walking') || 'пешки')}</span>
            <span class="data-val">${eta ? `${esc(eta.val)}<span class="unit">${esc(i18n.t(eta.type))}</span>` : '—'}</span>
          </div>
          <div class="data-cell">
            <span class="data-label">${esc(i18n.t('tariff'))}</span>
            <span class="data-val">${esc(station.tariff)}<span class="unit">${esc(i18n.t('somoniPerKwh'))}</span></span>
          </div>
        </div>

        <div class="card-strip">
          <div class="strip-dots">${stripDots}</div>
          <span class="strip-text">${station.freeConnectors}/${station.totalConnectors} · ${esc(strip.label)}</span>
        </div>

        ${waitBannerHtml}

        <div class="conn-list">${connRows}</div>

        <div class="card-actions card-actions-3">
          <button class="btn btn-ghost" data-action="show-map" data-station-id="${esc(station.id)}">
            ${esc(i18n.t('navigateTo'))}
          </button>
          <button class="btn btn-primary" data-action="route" data-station-id="${esc(station.id)}">
            ${esc(i18n.t('routeLabel'))}
            <span class="btn-arrow" aria-hidden="true">→</span>
          </button>
          <a class="btn btn-ghost btn-icon-only" href="${esc(directionsUrl)}" target="_blank" rel="noopener" title="${esc(i18n.t('openGoogleMaps'))}">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          </a>
        </div>
      </article>
    `;
  }

  toggleMobileDrawer() {
    if (this.mobileDrawer?.classList.contains('is-open')) {
      this.closeMobileDrawer();
    } else {
      this.openMobileDrawer();
    }
  }

  openMobileDrawer() {
    this.mobileDrawer?.classList.add('is-open');
    this.mobileOverlay?.classList.add('is-open');
    this.burgerBtn?.setAttribute('aria-expanded', 'true');
    this.burgerBtn?.classList.add('is-open');
    // Sync active filter state
    const active = [...this.mobileFilterBtns].find(b => b.getAttribute('data-filter') === this.currentFilter);
    if (active) this.setActive(this.mobileFilterBtns, active);
    // Sync active lang state
    const currentLang = i18n?.currentLang || document.documentElement.getAttribute('lang') || 'tj';
    const activeLang = [...this.mobileLangBtns].find(b => b.getAttribute('data-lang') === currentLang);
    if (activeLang) this.setActive(this.mobileLangBtns, activeLang);
    this.setActiveTab('more');
    document.getElementById('tab-more')?.setAttribute('aria-expanded', 'true');
    // Recalculate indicators after drawer becomes visible
    requestAnimationFrame(() => {
      this.moveIndicator(this.mobileSeg);
      this.moveIndicator(this.mobileLangSeg);
    });
  }

  closeMobileDrawer() {
    this.mobileDrawer?.classList.remove('is-open');
    this.mobileOverlay?.classList.remove('is-open');
    this.burgerBtn?.setAttribute('aria-expanded', 'false');
    this.burgerBtn?.classList.remove('is-open');
    document.getElementById('tab-more')?.setAttribute('aria-expanded', 'false');
    this.syncTabToMode();
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
    // Mirror in mobile drawer
    if (this.mdTotal) this.mdTotal.textContent = total;
    if (this.mdFree)  this.mdFree.textContent  = mid;
    if (this.mdBusy)  this.mdBusy.textContent  = right;
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
