// ============================================
// NŪR — Cost Calculator Module
// ============================================

class CostCalculator {
  constructor() {
    this.isOpen = false;
    this._stationsHydrated = false;
  }

  init() {
    this.panel   = document.getElementById('calc-panel');
    this.overlay = document.getElementById('calc-overlay');
    this.fabBtn  = document.getElementById('calc-fab');

    if (!this.panel) return;

    this.stationSelect = document.getElementById('calc-station');
    this.stationMeta   = document.getElementById('calc-station-meta');

    this.batteryEl     = document.getElementById('calc-battery');
    this.currentEl     = document.getElementById('calc-current');
    this.currentSlider = document.getElementById('calc-current-slider');
    this.targetEl      = document.getElementById('calc-target');
    this.targetSlider  = document.getElementById('calc-target-slider');
    this.tariffEl      = document.getElementById('calc-tariff');
    this.powerEl       = document.getElementById('calc-power');

    this.kwhEl  = document.getElementById('calc-result-kwh');
    this.costEl = document.getElementById('calc-result-cost');
    this.timeEl = document.getElementById('calc-result-time');

    this._bindEvents();
    this._syncTracks();
    this._calculate();

    // If stations already loaded, hydrate; else wait for event
    if (typeof stationAPI !== 'undefined' && stationAPI.getStations()?.length) {
      this._hydrateStations();
    }
    window.addEventListener('stationsLoaded', () => this._hydrateStations());
    window.addEventListener('langchange', () => this._hydrateStations());
  }

  _bindEvents() {
    this.fabBtn?.addEventListener('click', () => this.toggle());
    this.overlay?.addEventListener('click', () => this.close());
    document.getElementById('calc-close')?.addEventListener('click', () => this.close());

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });

    // Slider ↔ number sync
    const syncPair = (slider, numEl) => {
      if (!slider || !numEl) return;
      slider.addEventListener('input', () => {
        numEl.value = slider.value;
        this._trackSlider(slider);
        this._calculate();
      });
      numEl.addEventListener('input', () => {
        const min = parseFloat(numEl.min) || 0;
        const max = parseFloat(numEl.max) || 100;
        const v = Math.max(min, Math.min(max, parseFloat(numEl.value) || 0));
        slider.value = v;
        this._trackSlider(slider);
        this._calculate();
      });
    };
    syncPair(this.currentSlider, this.currentEl);
    syncPair(this.targetSlider, this.targetEl);

    this.batteryEl?.addEventListener('input', () => {
      this._syncBatteryChips();
      this._calculate();
    });
    this.tariffEl?.addEventListener('input', () => this._calculate());
    this.powerEl?.addEventListener('input', () => this._calculate());

    // Battery preset chips
    document.querySelectorAll('[data-battery-preset]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-battery-preset');
        if (this.batteryEl) this.batteryEl.value = v;
        this._syncBatteryChips();
        this._calculate();
      });
    });

    // Station selector
    this.stationSelect?.addEventListener('change', () => this._applySelectedStation());
  }

  _hydrateStations() {
    if (!this.stationSelect) return;
    const stations = (typeof stationAPI !== 'undefined' && stationAPI.getStations()) || [];
    const prev = this.stationSelect.value;

    // Sort by distance if we know user location
    let sorted = stations;
    const pos = (typeof geoLocation !== 'undefined') ? geoLocation.getPosition() : null;
    if (pos?.isLocated) {
      sorted = [...stations]
        .map((s) => ({ s, d: GeoLocation.distanceBetween(pos.lat, pos.lng, s.lat, s.lng) }))
        .sort((a, b) => a.d - b.d)
        .map((x) => x.s);
    }

    // Rebuild options
    const placeholder = `<option value="">${this._esc(i18n.t('calcSelectStation') || 'Выберите станцию')}</option>`;
    const opts = sorted
      .filter((s) => s.lat && s.lng)
      .map((s) => {
        const fast = s.capacityWatts >= 120 ? ' ⚡120W' : '';
        return `<option value="${this._esc(s.id)}">${this._esc(s.name)}${fast}</option>`;
      })
      .join('');
    this.stationSelect.innerHTML = placeholder + opts;

    // Restore previous selection if still exists
    if (prev && sorted.find((s) => String(s.id) === String(prev))) {
      this.stationSelect.value = prev;
    } else if (sorted.length) {
      // Auto-select nearest
      this.stationSelect.value = sorted[0].id;
      this._applySelectedStation();
    }

    this._stationsHydrated = true;
  }

  _applySelectedStation() {
    const id = this.stationSelect?.value;
    if (!id) {
      if (this.stationMeta) this.stationMeta.innerHTML = '';
      return;
    }
    const st = stationAPI.getStationById(id);
    if (!st) return;

    if (st.tariff && this.tariffEl)           this.tariffEl.value = st.tariff;
    if (st.capacityWatts && this.powerEl)     this.powerEl.value = st.capacityWatts;

    // Update meta block
    if (this.stationMeta) {
      const pos = geoLocation.getPosition();
      let distHtml = '';
      if (pos?.isLocated) {
        const km = GeoLocation.distanceBetween(pos.lat, pos.lng, st.lat, st.lng);
        const d = GeoLocation.formatDistance(km);
        distHtml = `<span class="calc-meta-chip">📍 ${this._esc(d.value)} ${this._esc(i18n.t(d.unit))}</span>`;
      }
      const freeHtml = st.hasAvailable
        ? `<span class="calc-meta-chip is-free">● ${this._esc(i18n.t('freeNow'))}</span>`
        : `<span class="calc-meta-chip is-busy">● ${this._esc(i18n.t('busy'))}</span>`;
      const powerHtml = st.capacity ? `<span class="calc-meta-chip">⚡ ${this._esc(st.capacity)}</span>` : '';
      this.stationMeta.innerHTML = distHtml + freeHtml + powerHtml;
    }

    this._calculate();
  }

  _syncBatteryChips() {
    const v = String(parseInt(this.batteryEl?.value, 10) || '');
    document.querySelectorAll('[data-battery-preset]').forEach((b) => {
      b.classList.toggle('is-active', b.getAttribute('data-battery-preset') === v);
    });
  }

  toggle() { this.isOpen ? this.close() : this.open(); }

  open() {
    if (!this._stationsHydrated) this._hydrateStations();
    this.isOpen = true;
    this.panel.classList.add('open');
    this.overlay.classList.add('visible');
    document.body.classList.add('calc-open');
    requestAnimationFrame(() => this._syncTracks());
  }

  close() {
    this.isOpen = false;
    this.panel.classList.remove('open');
    this.overlay.classList.remove('visible');
    document.body.classList.remove('calc-open');
  }

  _calculate() {
    const battery = Math.max(1, parseFloat(this.batteryEl?.value) || 60);
    let current   = Math.max(0, Math.min(100, parseFloat(this.currentEl?.value) || 20));
    let target    = Math.max(0, Math.min(100, parseFloat(this.targetEl?.value)  || 80));
    const tariff  = Math.max(0, parseFloat(this.tariffEl?.value)  || 1.5);
    const power   = Math.max(0.1, parseFloat(this.powerEl?.value) || 60);

    if (target < current) target = current;

    const diff    = target - current;
    const kWh     = (battery * diff) / 100;
    const cost    = kWh * tariff;
    const timeMin = power > 0 ? Math.round((kWh / power) * 60) : 0;

    if (this.kwhEl)  this.kwhEl.textContent  = kWh.toFixed(2);
    if (this.costEl) this.costEl.textContent = cost.toFixed(2);

    if (this.timeEl) {
      if (timeMin <= 0 || diff === 0) {
        this.timeEl.textContent = '—';
      } else if (timeMin < 60) {
        this.timeEl.textContent = `${timeMin} ${i18n.t('minSuffix')}`;
      } else {
        const h = Math.floor(timeMin / 60);
        const m = timeMin % 60;
        this.timeEl.textContent = m
          ? `${h}${i18n.t('hrSuffix')} ${m}${i18n.t('minSuffix')}`
          : `${h} ${i18n.t('hrSuffix')}`;
      }
    }
  }

  _trackSlider(slider) {
    if (!slider) return;
    const min = parseFloat(slider.min) || 0;
    const max = parseFloat(slider.max) || 100;
    const val = parseFloat(slider.value) || 0;
    const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
    slider.style.setProperty('--val', `${pct}%`);
  }

  _syncTracks() {
    this._trackSlider(this.currentSlider);
    this._trackSlider(this.targetSlider);
  }

  _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
    );
  }

  refresh() { this._calculate(); }
}

const costCalculator = new CostCalculator();
document.addEventListener('DOMContentLoaded', () => costCalculator.init());
