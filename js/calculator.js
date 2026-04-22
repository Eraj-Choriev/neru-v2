// ============================================
// NerU v2 — Cost Calculator Module
// ============================================

class CostCalculator {
  constructor() {
    this.isOpen = false;
  }

  init() {
    this.panel        = document.getElementById('calc-panel');
    this.overlay      = document.getElementById('calc-overlay');
    this.fabBtn       = document.getElementById('calc-fab');

    if (!this.panel) return;

    this.batteryEl      = document.getElementById('calc-battery');
    this.currentEl      = document.getElementById('calc-current');
    this.currentSlider  = document.getElementById('calc-current-slider');
    this.targetEl       = document.getElementById('calc-target');
    this.targetSlider   = document.getElementById('calc-target-slider');
    this.tariffEl       = document.getElementById('calc-tariff');
    this.powerEl        = document.getElementById('calc-power');

    this.kwhEl  = document.getElementById('calc-result-kwh');
    this.costEl = document.getElementById('calc-result-cost');
    this.timeEl = document.getElementById('calc-result-time');

    this._bindEvents();
    this._syncTracks();
    this._calculate();
  }

  _bindEvents() {
    this.fabBtn?.addEventListener('click', () => this.toggle());
    this.overlay?.addEventListener('click', () => this.close());
    document.getElementById('calc-close')?.addEventListener('click', () => this.close());

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });

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
    syncPair(this.targetSlider,  this.targetEl);

    this.batteryEl?.addEventListener('input', () => this._calculate());
    this.tariffEl?.addEventListener('input',  () => this._calculate());
    this.powerEl?.addEventListener('input',   () => this._calculate());

    // Battery preset chips
    document.querySelectorAll('[data-battery-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.getAttribute('data-battery-preset');
        if (this.batteryEl) this.batteryEl.value = v;
        document.querySelectorAll('[data-battery-preset]').forEach(b => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        this._calculate();
      });
    });
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    this._autofill();

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

  _autofill() {
    const stations = stationAPI.getStations();
    if (!stations.length) return;

    const pos = geoLocation.getPosition();
    const nearest = stations
      .filter(s => s.lat && s.lng)
      .map(s => ({ ...s, _dist: GeoLocation.distanceBetween(pos.lat, pos.lng, s.lat, s.lng) }))
      .sort((a, b) => a._dist - b._dist)[0];

    if (!nearest) return;

    if (nearest.tariff && this.tariffEl) {
      this.tariffEl.value = nearest.tariff;
    }
    if (nearest.capacityWatts && this.powerEl) {
      this.powerEl.value = nearest.capacityWatts;
    }

    this._calculate();
  }

  _calculate() {
    const battery = Math.max(1, parseFloat(this.batteryEl?.value) || 60);
    let   current = Math.max(0, Math.min(100, parseFloat(this.currentEl?.value) || 20));
    let   target  = Math.max(0, Math.min(100, parseFloat(this.targetEl?.value)  || 80));
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

  // Call on language change (time suffixes update)
  refresh() {
    this._calculate();
  }
}

const costCalculator = new CostCalculator();
