// ============================================
// NŪR — Paid Parking Session (geofence + timer)
// ============================================
//
// Rides on the geolocation watch that already powers live route tracking:
// when the device settles on one of the marked parking strips, a session
// starts, the meter runs at the operator's published rate, and the user is
// told before each hour rolls over.
//
// Honest limit: browser geolocation only runs while the page is alive. There
// is no server-side push and no native background geofence here, so the timer
// tracks "while NŪR is open", which the UI says out loud.

class ParkingSession {
  constructor() {
    // ── Geofence tuning (metres / milliseconds) ──
    // The strips run the length of most central streets, so a plain radius
    // test would fire at every driver passing by. Entry therefore needs
    // proximity AND near-zero speed AND persistence.
    this.ENTER_M = 25;        // within this of the strip → candidate
    this.EXIT_M = 55;         // beyond this → candidate for leaving (hysteresis)
    this.DWELL_MS = 25000;    // must hold the candidate state this long
    this.LEAVE_MS = 60000;    // and this long to be considered gone
    this.MAX_SPEED_MS = 2.8;  // ~10 km/h — above this the car is still moving
    this.ACCURACY_MAX_M = 60; // ignore jittery fixes entirely
    this.UNDO_MS = 15000;     // window to cancel an auto-started session

    this.STORE_KEY = 'nur-parking-session-v1';

    this.session = null;      // { zoneId, startedAt, freeMode, warned:{} }
    this._asking = null;      // zone awaiting the user's yes/no
    this._candidate = null;   // { zoneId, since }
    this._leavingSince = null;
    this._suppressedZoneId = null; // cancelled here — don't re-arm until we leave
    this._tickTimer = null;
    this._undoTimer = null;
    this._el = {};
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  init() {
    this._cacheElements();
    this._bindEvents();
    this._restore();
    this._render();
  }

  _cacheElements() {
    this._el = {
      card: document.getElementById('pk-session'),
      zone: document.getElementById('pk-session-zone'),
      addr: document.getElementById('pk-session-addr'),
      timer: document.getElementById('pk-timer'),
      cost: document.getElementById('pk-cost'),
      note: document.getElementById('pk-note'),
      undo: document.getElementById('pk-undo'),
      pay: document.getElementById('pk-pay'),
      rules: document.getElementById('pk-rules'),
      stop: document.getElementById('pk-stop'),
      confirm: document.getElementById('pk-confirm'),
      decline: document.getElementById('pk-decline'),
      eyebrow: document.getElementById('pk-eyebrow'),
    };
  }

  _bindEvents() {
    this._el.confirm?.addEventListener('click', () => this.acceptAsk());
    this._el.decline?.addEventListener('click', () => this.declineAsk());
    this._el.undo?.addEventListener('click', () => this.cancel());
    this._el.stop?.addEventListener('click', () => this.end());
    this._el.pay?.addEventListener('click', () => parkingRules.open('pay'));
    this._el.rules?.addEventListener('click', () => parkingRules.open());

    // Re-label the running card when the user switches language.
    window.addEventListener('langchange', () => this._render());
  }

  // ── Geofence ──────────────────────────────────────────────────────────────

  /** Fed by geoLocation.startWatching() via app.startLiveTracking(). */
  onPosition(snap) {
    if (!snap || !parkingAPI.getZones().length) return;

    // A 200m-accurate fix says nothing about which side of a kerb we are on.
    if (Number.isFinite(snap.accuracy) && snap.accuracy > this.ACCURACY_MAX_M) return;

    const nearest = parkingAPI.nearestZone(snap.lat, snap.lng);
    if (!nearest) return;

    const now = Date.now();

    if (this.session) {
      this._trackActive(nearest, now);
      return;
    }

    // Once cancelled in a zone, stay quiet until the user actually leaves it.
    if (this._suppressedZoneId != null) {
      const supp = parkingAPI.getZoneById(this._suppressedZoneId);
      const stillThere = supp && parkingAPI.distanceToZone(snap.lat, snap.lng, supp) <= this.EXIT_M;
      if (stillThere) return;
      this._suppressedZoneId = null;
    }

    const parked = nearest.meters <= this.ENTER_M && this._isStopped(snap);

    if (!parked) {
      this._candidate = null;
      return;
    }

    if (!this._candidate || String(this._candidate.zoneId) !== String(nearest.zone.id)) {
      this._candidate = { zoneId: nearest.zone.id, since: now };
      return;
    }

    if (now - this._candidate.since >= this.DWELL_MS) {
      this._candidate = null;
      this.ask(nearest.zone);
    }
  }

  /**
   * Entering a paid strip asks before it bills. The previous build started
   * the meter on its own and offered an undo, which is the wrong way round:
   * a timer that begins without being asked for is a charge the user did not
   * agree to, and the undo only helps the people who happen to be looking at
   * the screen. Ask, and stay quiet until answered.
   */
  ask(zone) {
    if (!zone || this.session || this._asking) return;

    this._asking = zone;
    this._render();

    const paid = !this._isFreeNow(zone);
    const title = i18n.t(paid ? 'pkNotifPaidTitle' : 'pkNotifFreeTitle');
    const body = `${zone.address || zone.code} · ${i18n.t(paid ? 'pkNotifPaidBody' : 'pkNotifFreeBody')}`;
    this._notify(title, body);
    ui.showToast(title, 'info', 4000);
  }

  acceptAsk() {
    const zone = this._asking;
    if (!zone) return;
    this._asking = null;
    this.start(zone, { auto: false });
  }

  declineAsk() {
    const zone = this._asking;
    this._asking = null;
    // Stay quiet in this zone until the car actually leaves it, or the ask
    // would fire again on the very next GPS tick.
    if (zone) this._suppressedZoneId = zone.id;
    this._render();
  }

  /** Outside the published 07:00–22:00 window the strip costs nothing. */
  _isFreeNow(zone) {
    const sch = parseSchedule(zone.schedule);
    return !!(sch && !sch.is24 && sch.isOpen === false);
  }

  /**
   * Speed is often null indoors or on a cold fix. Treat unknown speed as
   * stopped — the 45s dwell requirement is what really separates parking from
   * driving past, and demanding a speed reading would make the feature never
   * fire on devices that don't report one.
   */
  _isStopped(snap) {
    return !Number.isFinite(snap.speed) || snap.speed < this.MAX_SPEED_MS;
  }

  /** While a session runs, watch for the car actually leaving. */
  _trackActive(nearest, now) {
    const zone = parkingAPI.getZoneById(this.session.zoneId);
    if (!zone) return;

    const meters = parkingAPI.distanceToZone(
      geoLocation.userLat, geoLocation.userLng, zone
    );

    if (meters > this.EXIT_M) {
      if (!this._leavingSince) this._leavingSince = now;
      if (now - this._leavingSince >= this.LEAVE_MS) this.end({ reason: 'left' });
    } else {
      this._leavingSince = null;
    }
  }

  // ── Session control ───────────────────────────────────────────────────────

  start(zone, { auto = false, startedAt = null } = {}) {
    if (!zone || this.session) return;
    this._asking = null;

    // Outside the paid window the strip is free — run the card in an
    // informational mode instead of billing the user for nothing.
    const sch = parseSchedule(zone.schedule);
    const freeMode = !!(sch && !sch.is24 && sch.isOpen === false);

    this.session = {
      zoneId: zone.id,
      startedAt: startedAt || Date.now(),
      freeMode,
      auto,
      warned: {},
    };

    this._leavingSince = null;
    this._persist();
    this._startTicking();
    stationMap.highlightZone(zone);
    this._render();

    if (auto) this._armUndo();

    if (!startedAt) {
      const body = freeMode
        ? `${zone.address || zone.code} · ${i18n.t('pkNotifFreeBody')}`
        : `${zone.address || zone.code} · ${i18n.t('pkNotifPaidBody')}`;
      this._notify(i18n.t(freeMode ? 'pkNotifFreeTitle' : 'pkNotifPaidTitle'), body);
      ui.showToast(i18n.t(freeMode ? 'pkNotifFreeTitle' : 'pkStarted'), 'info', 3500);
    }
  }

  /** Undo an auto-start. Only offered briefly, and only for auto-started sessions. */
  cancel() {
    if (!this.session) return;
    this._suppressedZoneId = this.session.zoneId;
    this._teardown();
    ui.showToast(i18n.t('pkCancelled'), 'info', 2500);
  }

  end({ reason = 'manual' } = {}) {
    if (!this.session) return;
    const summary = this.compute();
    const zone = parkingAPI.getZoneById(this.session.zoneId);
    this._teardown();

    if (summary.freeMode) {
      ui.showToast(i18n.t('pkEndedFree'), 'success', 4000);
    } else {
      const msg = `${i18n.t('pkEnded')}: ${this._formatClock(summary.elapsedMs)} · ${summary.cost} ${i18n.t('pkSomoni')}`;
      ui.showToast(msg, 'success', 5000);
      if (reason === 'left') {
        this._notify(i18n.t('pkNotifEndTitle'), `${zone?.address || ''} · ${summary.cost} ${i18n.t('pkSomoni')}`);
      }
    }
  }

  _teardown() {
    this.session = null;
    this._leavingSince = null;
    clearInterval(this._tickTimer);
    clearTimeout(this._undoTimer);
    this._tickTimer = null;
    this._undoTimer = null;
    try { localStorage.removeItem(this.STORE_KEY); } catch (_) {}
    stationMap.clearZoneHighlight();
    this._render();
  }

  isActive() { return !!this.session; }

  _armUndo() {
    this._el.card?.classList.add('can-undo');
    clearTimeout(this._undoTimer);
    this._undoTimer = setTimeout(() => {
      this._el.card?.classList.remove('can-undo');
    }, this.UNDO_MS);
  }

  // ── Billing ───────────────────────────────────────────────────────────────

  /**
   * The operator's published rule: charging runs from the moment of entry,
   * minus 10 free minutes, and any part-hour counts as a full hour
   * ("использование парковки менее 60 минут подсчитывается за полный час").
   */
  compute(at = Date.now()) {
    if (!this.session) return null;

    const zone = parkingAPI.getZoneById(this.session.zoneId);
    const tariff = zone?.tariff || PARKING.TARIFF_TJS;
    const elapsedMs = Math.max(0, at - this.session.startedAt);
    const elapsedMin = elapsedMs / 60000;
    const freeLeftMs = Math.max(0, this.session.startedAt + PARKING.FREE_MINUTES * 60000 - at);

    if (this.session.freeMode) {
      return { zone, elapsedMs, elapsedMin, freeLeftMs, billableHours: 0, cost: 0, freeMode: true, tariff };
    }

    const billableHours = elapsedMin <= PARKING.FREE_MINUTES
      ? 0
      : Math.max(1, Math.ceil((elapsedMin - PARKING.FREE_MINUTES) / 60));

    return {
      zone,
      elapsedMs,
      elapsedMin,
      freeLeftMs,
      billableHours,
      cost: billableHours * tariff,
      freeMode: false,
      tariff,
    };
  }

  // ── Ticking / warnings ────────────────────────────────────────────────────

  _startTicking() {
    clearInterval(this._tickTimer);
    this._tickTimer = setInterval(() => {
      this._render();
      this._checkWarnings();
    }, 1000);
  }

  _checkWarnings() {
    if (!this.session || this.session.freeMode) return;

    const s = this.compute();
    const warned = this.session.warned;
    const elapsedMin = s.elapsedMin;

    // 1. The free window has just closed.
    if (!warned.free && elapsedMin >= PARKING.FREE_MINUTES) {
      warned.free = true;
      this._persist();
      this._notify(i18n.t('pkWarnFreeOverTitle'), i18n.t('pkWarnFreeOverBody'));
      ui.showToast(i18n.t('pkWarnFreeOverTitle'), 'warning', 4000);
    }

    // 2. Five minutes before each paid hour rolls over into the next one.
    if (elapsedMin > PARKING.FREE_MINUTES) {
      const paidMin = elapsedMin - PARKING.FREE_MINUTES;
      const nextBoundary = Math.ceil(paidMin / 60) * 60; // minutes of paid time
      const minsToBoundary = nextBoundary - paidMin;
      const key = `hour${nextBoundary}`;
      if (!warned[key] && minsToBoundary <= 5) {
        warned[key] = true;
        this._persist();
        const body = `${i18n.t('pkWarnHourBody')} +${s.tariff} ${i18n.t('pkSomoni')}`;
        this._notify(i18n.t('pkWarnHourTitle'), body);
        ui.showToast(`${i18n.t('pkWarnHourTitle')} · ${body}`, 'warning', 4000);
      }
    }

    // 3. Half an hour before the zone stops charging for the night.
    if (!warned.close && s.zone) {
      const sch = parseSchedule(s.zone.schedule);
      if (sch && !sch.is24) {
        const [ch, cm] = sch.close.split(':').map(Number);
        const now = new Date();
        const minsToClose = (ch * 60 + cm) - (now.getHours() * 60 + now.getMinutes());
        if (minsToClose > 0 && minsToClose <= 30) {
          warned.close = true;
          this._persist();
          this._notify(i18n.t('pkWarnCloseTitle'), `${i18n.t('pkWarnCloseBody')} ${sch.close}`);
        }
      }
    }
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  _notify(title, body) {
    if (typeof stationNotifications?.notify === 'function') {
      stationNotifications.notify(title, body, 'nur-parking');
    }
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  _persist() {
    if (!this.session) return;
    try {
      localStorage.setItem(this.STORE_KEY, JSON.stringify(this.session));
    } catch (_) {}
  }

  /**
   * A reload, a backgrounded PWA or a killed tab must not silently reset the
   * meter — the car has been sitting there the whole time.
   */
  _restore() {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(this.STORE_KEY) || 'null');
    } catch (_) { return; }
    if (!saved?.zoneId || !saved.startedAt) return;

    // A session older than a day is a leftover, not a live one.
    if (Date.now() - saved.startedAt > 24 * 60 * 60 * 1000) {
      try { localStorage.removeItem(this.STORE_KEY); } catch (_) {}
      return;
    }

    // Zones may not have loaded yet on a cold start.
    const resume = () => {
      const zone = parkingAPI.getZoneById(saved.zoneId);
      if (!zone) return;
      this.session = { ...saved, warned: saved.warned || {} };
      this._startTicking();
      stationMap.highlightZone(zone);
      this._render();
    };

    if (parkingAPI.getZones().length) resume();
    else window.addEventListener('parkingLoaded', resume, { once: true });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  _render() {
    const card = this._el.card;
    if (!card) return;

    if (!this.session && this._asking) {
      const zone = this._asking;
      const paid = !this._isFreeNow(zone);
      card.classList.add('is-active', 'is-asking');
      card.classList.toggle('is-free', !paid);
      card.classList.remove('can-undo');

      if (this._el.eyebrow) this._el.eyebrow.textContent = i18n.t('pkAskTitle');
      if (this._el.zone) {
        this._el.zone.textContent = zone.code
          ? `${i18n.t('pkPaidZone')} · ${zone.code}`
          : i18n.t('pkPaidZone');
      }
      if (this._el.addr) this._el.addr.textContent = zone.address || '';
      if (this._el.note) {
        this._el.note.textContent = paid
          ? `${PARKING.TARIFF_TJS} ${i18n.t('pkPerHour')} · ${i18n.t('pkFreeMinutesNote')}`
          : i18n.t('pkNotifFreeBody');
      }
      if (this._el.confirm) this._el.confirm.textContent = i18n.t('pkAskStart');
      if (this._el.decline) this._el.decline.textContent = i18n.t('pkAskLater');
      return;
    }

    card.classList.remove('is-asking');

    if (!this.session) {
      card.classList.remove('is-active', 'can-undo', 'is-free');
      return;
    }

    const s = this.compute();
    const zone = s.zone;

    card.classList.add('is-active');
    card.classList.toggle('is-free', s.freeMode);

    if (this._el.zone) {
      this._el.zone.textContent = zone?.code
        ? `${i18n.t('pkPaidZone')} · ${zone.code}`
        : i18n.t('pkPaidZone');
    }
    if (this._el.addr) this._el.addr.textContent = zone?.address || '';
    if (this._el.timer) this._el.timer.textContent = this._formatClock(s.elapsedMs);

    if (this._el.eyebrow) {
      this._el.eyebrow.textContent = s.freeMode ? i18n.t('pkFreeNow') : i18n.t('pkMeterRunning');
    }

    if (this._el.cost) {
      this._el.cost.textContent = s.freeMode
        ? `0 ${i18n.t('pkSomoni')}`
        : `${s.cost} ${i18n.t('pkSomoni')}`;
    }

    if (this._el.note) {
      if (s.freeMode) {
        const sch = zone ? parseSchedule(zone.schedule) : null;
        this._el.note.textContent = sch
          ? `${i18n.t('pkFreeUntil')} ${sch.open}`
          : i18n.t('pkFreeNow');
      } else if (s.freeLeftMs > 0) {
        const left = Math.ceil(s.freeLeftMs / 60000);
        this._el.note.textContent = `${i18n.t('pkFreeLeft')}: ${left} ${i18n.t('minSuffix')}`;
      } else {
        this._el.note.textContent =
          `${s.billableHours} × ${s.tariff} ${i18n.t('pkSomoni')} · ${i18n.t('pkPartHourNote')}`;
      }
    }

    // Static labels need re-applying after a language switch.
    if (this._el.undo) this._el.undo.textContent = i18n.t('pkUndo');
    if (this._el.pay) this._el.pay.textContent = i18n.t('pkPay');
    if (this._el.rules) this._el.rules.textContent = i18n.t('pkRules');
    if (this._el.stop) this._el.stop.textContent = i18n.t('pkStop');
  }

  _formatClock(ms) {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
}

// ============================================
// Rules & fines sheet
// ============================================
// Everything here is quoted from the operator's own pages
// (neru.tj/rule-fine-parking, neru.tj/question-parking) — the app states the
// rules, it does not invent or enforce them, and it never takes a payment.

class ParkingRules {
  open(section = null) {
    const modal = document.getElementById('pk-modal');
    if (!modal) return;
    this.render();
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('is-open'));
    document.body.classList.add('an-open');
    if (section === 'pay') {
      document.getElementById('pk-pay-section')?.scrollIntoView({ block: 'start' });
    }
  }

  close() {
    const modal = document.getElementById('pk-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    document.body.classList.remove('an-open');
    setTimeout(() => { modal.hidden = true; }, 260);
  }

  isOpen() {
    return !!document.getElementById('pk-modal')?.classList.contains('is-open');
  }

  refresh() { if (this.isOpen()) this.render(); }

  render() {
    const body = document.getElementById('pk-body');
    if (!body) return;

    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const stats = parkingAPI.getStats();
    const list = (key) => (i18n.t(key) || [])
      .map((item) => `<li>${esc(item)}</li>`).join('');

    body.innerHTML = `
      <section class="pk-sec">
        <div class="pk-hero">
          <div class="pk-hero-cell">
            <span class="pk-hero-num">${PARKING.TARIFF_TJS}</span>
            <span class="pk-hero-lbl">${esc(i18n.t('pkPerHour'))}</span>
          </div>
          <div class="pk-hero-cell">
            <span class="pk-hero-num">${PARKING.FREE_MINUTES}</span>
            <span class="pk-hero-lbl">${esc(i18n.t('pkFreeMinutesLabel'))}</span>
          </div>
          <div class="pk-hero-cell">
            <span class="pk-hero-num pk-hero-num--warn">${PARKING.PRR_TJS}</span>
            <span class="pk-hero-lbl">${esc(i18n.t('pkFineLabel'))}</span>
          </div>
        </div>
        <p class="pk-sec-note">${esc(i18n.t('pkTariffNote'))}</p>
      </section>

      <section class="pk-sec" id="pk-pay-section">
        <h3 class="pk-sec-title">${esc(i18n.t('pkPayTitle'))}</h3>
        <ul class="pk-list">${list('pkPayList')}</ul>
        <p class="pk-sec-note">${esc(i18n.t('pkPayDisclaimer'))}</p>
      </section>

      <section class="pk-sec">
        <h3 class="pk-sec-title">${esc(i18n.t('pkRulesTitle'))}</h3>
        <ul class="pk-list">${list('pkRulesList')}</ul>
      </section>

      <section class="pk-sec">
        <h3 class="pk-sec-title">${esc(i18n.t('pkFinesTitle'))}</h3>
        <p class="pk-sec-note pk-sec-note--strong">${esc(i18n.t('pkFineLaw'))}</p>
        <ul class="pk-list pk-list--warn">${list('pkFinesList')}</ul>
      </section>

      <section class="pk-sec">
        <h3 class="pk-sec-title">${esc(i18n.t('pkFreeCatsTitle'))}</h3>
        <ul class="pk-list">${list('pkFreeCatsList')}</ul>
      </section>

      <section class="pk-sec">
        <h3 class="pk-sec-title">${esc(i18n.t('pkCoverageTitle'))}</h3>
        <div class="pk-cover">
          <div class="pk-cover-cell"><span>${stats.zones}</span><small>${esc(i18n.t('pkZonesLabel'))}</small></div>
          <div class="pk-cover-cell"><span>${stats.places}</span><small>${esc(i18n.t('pkPlaces'))}</small></div>
          <div class="pk-cover-cell"><span>${stats.accessible}</span><small>${esc(i18n.t('pkAccessible'))}</small></div>
        </div>
      </section>

      <section class="pk-sec">
        <p class="pk-sec-note">${esc(i18n.t('pkTrackingLimit'))}</p>
        <p class="pk-sec-note">
          ${esc(i18n.t('pkSupport'))}:
          <a href="tel:${PARKING.SUPPORT_TEL}">${PARKING.SUPPORT_SHORT}</a>
          · <a href="https://neru.tj/rule-fine-parking" target="_blank" rel="noopener">neru.tj</a>
        </p>
      </section>
    `;
  }
}

const parkingSession = new ParkingSession();
const parkingRules = new ParkingRules();
