// ============================================
// NŪR — Paid Parking Session (geofence + timer)
// ============================================
//
// Rides on the geolocation watch that already powers live route tracking:
// when the device settles on one of the marked parking strips, NŪR asks
// whether to start a meter, the meter runs at the operator's published rate,
// and the user is told (on screen, by notification and by voice) before each
// hour rolls over. Finished sessions go to a local history.
//
// Honest limit: browser geolocation only runs while the page is alive. There
// is no server-side push and no native background geofence here, so the timer
// tracks "while NŪR is open", which the UI says out loud.

// ── Billing clock ────────────────────────────────────────────────────────────
// Dushanbe is UTC+5 all year (no DST), so its wall clock is a fixed offset
// from UTC. Using it directly — instead of the device's local time — keeps the
// paid window right on a phone set to another zone.
const PK_TZ_OFFSET_MS = 5 * 60 * 60 * 1000;
const PK_DAY_MS = 24 * 60 * 60 * 1000;
const PK_HOUR_MS = 60 * 60 * 1000;

/** Minute of the day (0–1439) on Dushanbe's clock. */
function pkDayMinute(ms) {
  return Math.floor((((ms + PK_TZ_OFFSET_MS) % PK_DAY_MS) + PK_DAY_MS) % PK_DAY_MS / 60000);
}

/**
 * Milliseconds of [from, to) that fall inside the zone's paid window.
 * No schedule, or a 24h one, means always paid — the conservative reading:
 * the app would rather over-state a bill than leave someone with a fine.
 * Handles windows that wrap past midnight (e.g. 20:00–02:00).
 */
function pkPaidMs(from, to, sch) {
  if (!(to > from)) return 0;
  if (!sch || sch.is24) return to - from;
  const [oh, om] = sch.open.split(':').map(Number);
  const [ch, cm] = sch.close.split(':').map(Number);
  const open = oh * 60 + om;
  const close = ch * 60 + cm;
  const windows = close > open ? [[open, close]] : [[0, close], [open, 1440]];

  let total = 0;
  // Dushanbe midnight at or before `from`.
  let day = Math.floor((from + PK_TZ_OFFSET_MS) / PK_DAY_MS) * PK_DAY_MS - PK_TZ_OFFSET_MS;
  for (; day < to; day += PK_DAY_MS) {
    for (const [a, b] of windows) {
      const s = Math.max(from, day + a * 60000);
      const e = Math.min(to, day + b * 60000);
      if (e > s) total += e - s;
    }
  }
  return total;
}

class ParkingSession {
  constructor() {
    // ── Geofence tuning (metres / milliseconds) ──
    // The strips run the length of most central streets, so a plain radius
    // test would fire at every driver passing by — and at every red light and
    // every jam beside a strip. Entry therefore needs proximity AND a near-zero
    // speed AND the car staying put for a full minute.
    this.ENTER_M = 25;        // within this of the strip → candidate
    this.EXIT_M = 55;         // beyond this → leaving (hysteresis)
    this.ANCHOR_M = 30;       // drifting this far from where it stopped = still driving
    this.DWELL_MS = 60000;    // must stay put this long before asking
    this.LEAVE_MS = 60000;    // and be gone this long before the meter stops
    this.MAX_SPEED_MS = 2.8;  // ~10 km/h — above this the car is still moving
    this.ACCURACY_MAX_M = 60; // ignore jittery fixes entirely
    this.UNDO_MS = 15000;     // window to cancel a just-started session
    this.MIN_RECORD_MS = 60000; // a session shorter than this was a mis-tap

    this.STORE_KEY = 'nur-parking-session-v1';

    this.session = null;      // { zoneId, startedAt, auto, warned:{}, lastInsideAt }
    this._asking = null;      // { zone, arrivedAt } awaiting the user's yes/no
    this._candidate = null;   // { zoneId, since, lat, lng }
    this._leavingSince = null;
    this._suppressedZoneId = null; // declined here — don't re-ask until we leave
    this._tickTimer = null;
    this._undoTimer = null;
    this._el = {};
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  init() {
    parkingVoice.bindUnlock();
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
      voice: document.getElementById('pk-voice'),
    };
  }

  _bindEvents() {
    this._el.confirm?.addEventListener('click', () => this.acceptAsk());
    this._el.decline?.addEventListener('click', () => this.declineAsk());
    this._el.undo?.addEventListener('click', () => this.cancel());
    this._el.stop?.addEventListener('click', () => this.end());
    this._el.pay?.addEventListener('click', () => parkingRules.open('pay'));
    this._el.rules?.addEventListener('click', () => parkingRules.open());
    this._el.voice?.addEventListener('click', () => {
      parkingVoice.toggle();
      this._render();
    });

    // Re-label the running card when the user switches language.
    window.addEventListener('langchange', () => this._render());

    // "Start" / "Not now" pressed on the OS notification itself (sw.js relays it).
    if (typeof navigator !== 'undefined' && navigator.serviceWorker?.addEventListener) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data?.type !== 'pk-action') return;
        if (e.data.action === 'pk-start') this.acceptAsk();
        else if (e.data.action === 'pk-later') this.declineAsk();
      });
    }
  }

  // ── Geofence ──────────────────────────────────────────────────────────────

  /** Fed by geoLocation.startWatching() via app.startLiveTracking(). */
  onPosition(snap) {
    if (!snap || !parkingAPI.getZones().length) return;

    // A 200m-accurate fix says nothing about which side of a kerb we are on.
    if (Number.isFinite(snap.accuracy) && snap.accuracy > this.ACCURACY_MAX_M) return;

    const now = Date.now();

    if (this.session) {
      this._trackActive(snap, now);
      return;
    }

    // An open question goes away by itself once the car drives on — that is
    // the red light or the jam that looked like parking.
    if (this._asking) {
      const d = parkingAPI.distanceToZone(snap.lat, snap.lng, this._asking.zone);
      if (d > this.EXIT_M) this._dismissAsk();
      return;
    }

    // Once declined in a zone, stay quiet until the user actually leaves it.
    if (this._suppressedZoneId != null) {
      const supp = parkingAPI.getZoneById(this._suppressedZoneId);
      const stillThere = supp && parkingAPI.distanceToZone(snap.lat, snap.lng, supp) <= this.EXIT_M;
      if (stillThere) return;
      this._suppressedZoneId = null;
    }

    const nearest = parkingAPI.nearestZone(snap.lat, snap.lng);
    if (!nearest) return;

    // The candidate is a *place*, not a zone: at a corner the nearest strip
    // flips between two neighbours on GPS jitter, which used to restart the
    // dwell on every flip so the question never came.
    if (this._candidate) {
      const drift = GeoLocation.distanceBetween(
        snap.lat, snap.lng, this._candidate.lat, this._candidate.lng
      ) * 1000;
      if (nearest.meters > this.EXIT_M || drift > this.ANCHOR_M) {
        this._candidate = null;
      } else {
        if (nearest.meters <= this.ENTER_M) this._candidate.zoneId = nearest.zone.id;
        if (now - this._candidate.since >= this.DWELL_MS) {
          const zone = parkingAPI.getZoneById(this._candidate.zoneId) || nearest.zone;
          const arrivedAt = this._candidate.since;
          this._candidate = null;
          this.ask(zone, { arrivedAt });
        }
        return;
      }
    }

    if (nearest.meters <= this.ENTER_M && this._isStopped(snap)) {
      this._candidate = { zoneId: nearest.zone.id, since: now, lat: snap.lat, lng: snap.lng };
    }
  }

  /**
   * Speed is often null indoors or on a cold fix. Treat unknown speed as
   * stopped — the one-minute dwell and the anchor drift are what really
   * separate parking from driving past.
   */
  _isStopped(snap) {
    return !Number.isFinite(snap.speed) || snap.speed < this.MAX_SPEED_MS;
  }

  /** While a session runs, watch for the car actually leaving. */
  _trackActive(snap, now) {
    const zone = parkingAPI.getZoneById(this.session.zoneId);
    if (!zone) return;

    const meters = parkingAPI.distanceToZone(snap.lat, snap.lng, zone);

    if (meters > this.EXIT_M) {
      if (!this._leavingSince) this._leavingSince = now;
      // Bill up to the moment the car left, not the moment we were sure of it.
      if (now - this._leavingSince >= this.LEAVE_MS) {
        this.end({ reason: 'left', at: this._leavingSince });
      }
    } else {
      this._leavingSince = null;
      // A cheap heartbeat: if NŪR is closed and reopened elsewhere, this is
      // the last moment we know the car was still on the strip.
      if (!this.session.lastInsideAt || now - this.session.lastInsideAt > 30000) {
        this.session.lastInsideAt = now;
        this._persist();
      }
    }
  }

  // ── Asking ────────────────────────────────────────────────────────────────

  /**
   * Entering a paid strip asks before it bills: a timer that begins without
   * being asked for is a charge the user did not agree to. The answer may
   * come minutes later (phone in a pocket), so the arrival time is kept and
   * the meter is backdated to it — the operator's free 10 minutes run from
   * the moment of entry, not from the tap.
   */
  ask(zone, { arrivedAt = Date.now() } = {}) {
    if (!zone || this.session || this._asking) return;

    this._asking = { zone, arrivedAt };
    this._render();

    const paid = this._isPaidAt(zone, Date.now());
    const title = i18n.t(paid ? 'pkNotifPaidTitle' : 'pkNotifFreeTitle');
    const body = `${zone.address || zone.code} · ${i18n.t(paid ? 'pkNotifPaidBody' : 'pkNotifFreeBody')}`;
    this._notify(title, body, {
      actions: [
        { action: 'pk-start', title: i18n.t('pkAskStart') },
        { action: 'pk-later', title: i18n.t('pkAskLater') },
      ],
      requireInteraction: true,
    });
    ui.showToast(title, 'info', 4000);
    parkingVoice.say(paid ? 'pkSayAsk' : 'pkSayAskFree', {
      tariff: zone.tariff || PARKING.TARIFF_TJS,
      free: PARKING.FREE_MINUTES,
    });
  }

  acceptAsk() {
    const ask = this._asking;
    if (!ask) return;
    this._asking = null;
    this._userGesture();
    this.start(ask.zone, { startedAt: ask.arrivedAt });
  }

  declineAsk() {
    const ask = this._asking;
    this._asking = null;
    // Stay quiet in this zone until the car actually leaves it, or the ask
    // would fire again a minute later.
    if (ask) this._suppressedZoneId = ask.zone.id;
    this._closeNotification();
    this._render();
    this._refreshZoneCard();
  }

  /** The car drove on before anyone answered — withdraw the question quietly. */
  _dismissAsk() {
    this._asking = null;
    this._candidate = null;
    this._closeNotification();
    parkingVoice.cancel();
    this._render();
    this._refreshZoneCard();
  }

  /** Start from the zone card: the user tapped it, so no geofence needed. */
  startManual(zoneId) {
    const zone = parkingAPI.getZoneById(zoneId);
    if (!zone || this.session) return;
    // If the geofence already saw the car arrive here, keep that arrival time.
    const arrivedAt = this._asking && String(this._asking.zone.id) === String(zone.id)
      ? this._asking.arrivedAt
      : this._candidate && String(this._candidate.zoneId) === String(zone.id)
        ? this._candidate.since
        : Date.now();
    this._asking = null;
    this._candidate = null;
    this._userGesture();
    this.start(zone, { startedAt: arrivedAt });
  }

  /** Taps are the only moment browsers allow a permission prompt or unlock audio. */
  _userGesture() {
    parkingVoice.unlock();
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        Notification.requestPermission().then((p) => {
          if (typeof stationNotifications !== 'undefined') stationNotifications.permission = p;
        }).catch(() => {});
      }
    } catch (_) {}
  }

  // ── Session control ───────────────────────────────────────────────────────

  start(zone, { auto = false, startedAt = null } = {}) {
    if (!zone || this.session) return;
    this._asking = null;
    this._closeNotification();

    const now = Date.now();
    this.session = {
      zoneId: zone.id,
      startedAt: Math.min(startedAt || now, now),
      auto,
      warned: {},
      lastInsideAt: now,
    };

    // Warnings whose moment already passed while we waited for the answer
    // are marked as given, so accepting late does not set off a burst.
    this._checkWarnings({ silent: true });

    this._leavingSince = null;
    this._persist();
    this._startTicking();
    stationMap.highlightZone(zone);
    this._render();
    this._refreshZoneCard();
    this._armUndo();

    ui.showToast(i18n.t(this._isPaidAt(zone, now) ? 'pkStarted' : 'pkNotifFreeTitle'), 'info', 3500);
    parkingVoice.say('pkSayStarted');
    if (typeof stationAnalytics !== 'undefined') stationAnalytics.refresh();
  }

  /** Undo a just-started session. Nothing is recorded. */
  cancel() {
    if (!this.session) return;
    this._suppressedZoneId = this.session.zoneId;
    this._teardown();
    ui.showToast(i18n.t('pkCancelled'), 'info', 2500);
  }

  end({ reason = 'manual', at = Date.now() } = {}) {
    if (!this.session) return;
    const session = this.session;
    const summary = this.compute(at);
    const zone = summary.zone;

    // A gap between the last fix on the strip and the first one away from it
    // means NŪR was closed in between: the end time is the upper bound.
    const approx = reason === 'left' && session.lastInsideAt && at - session.lastInsideAt > 3 * 60000;

    this._teardown();

    if (summary.elapsedMs >= this.MIN_RECORD_MS) {
      parkingHistory.add({
        zoneId: session.zoneId,
        code: zone?.code || '',
        address: zone?.address || '',
        lat: zone?.lat ?? null,
        lng: zone?.lng ?? null,
        startedAt: session.startedAt,
        endedAt: at,
        cost: summary.cost,
        hours: summary.billableHours,
        tariff: summary.tariff,
        reason,
        approx: !!approx,
      });
    }

    const clock = this._formatClock(summary.elapsedMs);
    if (summary.cost === 0) {
      ui.showToast(i18n.t('pkEndedFree'), 'success', 4000);
    } else {
      const msg = `${i18n.t('pkEnded')}: ${clock} · ${approx ? '≈ ' : ''}${summary.cost} ${i18n.t('pkSomoni')}`;
      ui.showToast(msg, 'success', 5000);
    }
    if (reason === 'left') {
      this._notify(i18n.t('pkNotifEndTitle'),
        `${zone?.address || ''} · ${clock} · ${summary.cost} ${i18n.t('pkSomoni')}`);
    }
    parkingVoice.say(summary.cost ? 'pkSayEnded' : 'pkSayEndedFree', {
      duration: parkingVoice.duration(summary.elapsedMs),
      cost: summary.cost,
    });
    if (typeof stationAnalytics !== 'undefined') stationAnalytics.refresh();
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
    this._el.card?.classList.remove('can-undo');
    this._render();
    this._refreshZoneCard();
  }

  isActive() { return !!this.session; }
  isAsking() { return !!this._asking; }

  _armUndo() {
    this._el.card?.classList.add('can-undo');
    clearTimeout(this._undoTimer);
    this._undoTimer = setTimeout(() => {
      this._el.card?.classList.remove('can-undo');
    }, this.UNDO_MS);
  }

  _refreshZoneCard() {
    if (typeof stationMap !== 'undefined' && typeof stationMap.refreshParkingPopups === 'function' &&
        parkingAPI.getZones().length) {
      stationMap.refreshParkingPopups(parkingAPI.getZones());
    }
  }

  // ── Billing ───────────────────────────────────────────────────────────────

  _isPaidAt(zone, at) {
    return pkPaidMs(at, at + 1000, parseSchedule(zone?.schedule)) > 0;
  }

  /**
   * The operator's published rule: charging runs from the moment of entry,
   * minus 10 free minutes, and any part-hour counts as a full hour
   * ("использование парковки менее 60 минут подсчитывается за полный час").
   *
   * Only time inside the paid window (07:00–22:00) is billed. The previous
   * build froze "free" or "paid" at the start, so a car left at 21:30 was
   * billed all night and one left at 06:50 read "free" all morning.
   */
  compute(at = Date.now()) {
    if (!this.session) return null;

    const zone = parkingAPI.getZoneById(this.session.zoneId);
    const sch = parseSchedule(zone?.schedule);
    const tariff = zone?.tariff || PARKING.TARIFF_TJS;
    const startedAt = this.session.startedAt;
    const graceEnd = startedAt + PARKING.FREE_MINUTES * 60000;

    const elapsedMs = Math.max(0, at - startedAt);
    const paidMs = pkPaidMs(graceEnd, at, sch);
    const billableHours = paidMs > 0 ? Math.ceil(paidMs / PK_HOUR_MS) : 0;
    const paidNow = pkPaidMs(at, at + 1000, sch) > 0;

    return {
      zone,
      sch,
      elapsedMs,
      elapsedMin: elapsedMs / 60000,
      freeLeftMs: Math.max(0, graceEnd - at),
      paidMs,
      paidNow,
      billableHours,
      // Paid time left before the next hour is added (only meaningful while paid).
      toNextHourMs: billableHours ? billableHours * PK_HOUR_MS - paidMs : null,
      cost: billableHours * tariff,
      freeMode: !paidNow,
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

  /**
   * Background tabs tick once a minute at best and a closed app not at all,
   * so each warning is checked against a window, and one discovered long
   * after its moment is marked as given without nagging.
   */
  _checkWarnings({ silent = false } = {}) {
    if (!this.session) return;

    const s = this.compute();
    const warned = this.session.warned;
    const STALE_MS = 5 * 60000;
    let changed = false;

    // 1. Billing has begun — either the free 10 minutes ran out, or the paid
    //    window opened in the morning on a car parked overnight.
    if (!warned.free && s.paidMs > 0) {
      warned.free = true;
      changed = true;
      if (!silent && s.paidMs < STALE_MS) {
        const graceInPaid = pkPaidMs(this.session.startedAt + PARKING.FREE_MINUTES * 60000 - 1000,
          this.session.startedAt + PARKING.FREE_MINUTES * 60000, s.sch) > 0;
        const title = i18n.t(graceInPaid ? 'pkWarnFreeOverTitle' : 'pkWarnPaidStartTitle');
        const body = `${i18n.t('pkWarnFreeOverBodyPre')} ${s.tariff} ${i18n.t('pkSomoni')}`;
        this._notify(title, body);
        ui.showToast(title, 'warning', 4000);
        parkingVoice.say(graceInPaid ? 'pkSayFreeOver' : 'pkSayPaidStart', { tariff: s.tariff });
      }
    }

    // 2. Five minutes before each paid hour rolls over into the next one.
    if (s.paidNow && s.toNextHourMs != null && s.toNextHourMs <= 5 * 60000) {
      const key = `hour${s.billableHours}`;
      if (!warned[key]) {
        warned[key] = true;
        changed = true;
        if (!silent) {
          const mins = Math.max(1, Math.ceil(s.toNextHourMs / 60000));
          const title = i18n.t('pkWarnHourTitle').replace('{min}', mins);
          const body = `${i18n.t('pkWarnHourBody')} +${s.tariff} ${i18n.t('pkSomoni')}`;
          this._notify(title, body);
          ui.showToast(`${title} · ${body}`, 'warning', 4000);
          parkingVoice.say('pkSayHour', { min: mins, tariff: s.tariff });
        }
      }
    }

    // 3. Half an hour before the zone stops charging for the night.
    if (!warned.close && s.paidNow && s.sch && !s.sch.is24) {
      const [ch, cm] = s.sch.close.split(':').map(Number);
      let minsToClose = (ch * 60 + cm) - pkDayMinute(Date.now());
      if (minsToClose <= 0) minsToClose += 1440;
      if (minsToClose <= 30) {
        warned.close = true;
        changed = true;
        if (!silent) {
          this._notify(i18n.t('pkWarnCloseTitle'), `${i18n.t('pkWarnCloseBody')} ${s.sch.close}`);
          parkingVoice.say('pkSayClose', { time: s.sch.close });
        }
      }
    }

    if (changed) this._persist();
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  _notify(title, body, extra = {}) {
    if (typeof stationNotifications !== 'undefined' && typeof stationNotifications.notify === 'function') {
      stationNotifications.notify(title, body, 'nur-parking', extra);
    }
  }

  _closeNotification() {
    if (typeof stationNotifications !== 'undefined' && typeof stationNotifications.closeTag === 'function') {
      stationNotifications.closeTag('nur-parking');
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
    if (Date.now() - saved.startedAt > PK_DAY_MS) {
      try { localStorage.removeItem(this.STORE_KEY); } catch (_) {}
      return;
    }

    // Zones may not have loaded yet on a cold start.
    const resume = () => {
      if (this.session) return;
      const zone = parkingAPI.getZoneById(saved.zoneId);
      if (!zone) return;
      this.session = { ...saved, warned: saved.warned || {} };
      this._checkWarnings({ silent: true });
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

    if (this._el.voice) {
      const on = parkingVoice.enabled && parkingVoice.isSupported();
      this._el.voice.hidden = !parkingVoice.isSupported();
      this._el.voice.classList.toggle('is-muted', !on);
      this._el.voice.setAttribute('aria-pressed', String(on));
      const label = i18n.t(on ? 'pkVoiceMute' : 'pkVoiceUnmute');
      this._el.voice.setAttribute('aria-label', label);
      this._el.voice.title = label;
    }

    if (!this.session && this._asking) {
      const zone = this._asking.zone;
      const paid = this._isPaidAt(zone, Date.now());
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
          ? `${zone.tariff || PARKING.TARIFF_TJS} ${i18n.t('pkPerHour')} · ${i18n.t('pkFreeMinutesNote')}`
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
    card.classList.toggle('is-free', !s.paidNow);

    if (this._el.zone) {
      this._el.zone.textContent = zone?.code
        ? `${i18n.t('pkPaidZone')} · ${zone.code}`
        : i18n.t('pkPaidZone');
    }
    if (this._el.addr) this._el.addr.textContent = zone?.address || '';
    if (this._el.timer) this._el.timer.textContent = this._formatClock(s.elapsedMs);

    if (this._el.eyebrow) {
      this._el.eyebrow.textContent = s.paidNow ? i18n.t('pkMeterRunning') : i18n.t('pkFreeNow');
    }

    if (this._el.cost) this._el.cost.textContent = `${s.cost} ${i18n.t('pkSomoni')}`;

    if (this._el.note) {
      if (!s.paidNow) {
        this._el.note.textContent = s.sch && !s.sch.is24
          ? `${i18n.t('pkFreeUntil')} ${s.sch.open}`
          : i18n.t('pkFreeNow');
      } else if (s.freeLeftMs > 0) {
        const left = Math.ceil(s.freeLeftMs / 60000);
        this._el.note.textContent = `${i18n.t('pkFreeLeft')}: ${left} ${i18n.t('minSuffix')}`;
      } else {
        const next = s.toNextHourMs != null ? Math.ceil(s.toNextHourMs / 60000) : null;
        this._el.note.textContent =
          `${s.billableHours} × ${s.tariff} ${i18n.t('pkSomoni')} · ${i18n.t('pkPartHourNote')}` +
          (next != null ? ` · ${i18n.t('pkNextHourIn')} ${next} ${i18n.t('minSuffix')}` : '');
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
// Voice alerts (Web Speech API)
// ============================================
//
// A driver should not have to look down to learn they are on a paid strip.
// speechSynthesis is built into every current phone browser, needs no audio
// files and no network, and speaks the UI language — with two hard limits:
//
//  - It only speaks while the page is visible. A hidden tab is skipped on
//    purpose: iOS queues the speech and plays it, stale, when the user comes
//    back. The OS notification covers the background case.
//  - No phone ships a Tajik (tg) voice. For Tajik the Russian phrase is spoken
//    by a Russian voice, which every Dushanbe driver understands; a tg voice,
//    if one ever appears, is preferred automatically.
//
// iOS also refuses speech until the page has spoken once inside a tap, so
// unlock() is called from the first taps on the parking card.

class ParkingVoice {
  constructor() {
    this.KEY = 'nur-voice-v1';
    this.enabled = true;
    this._unlocked = false;
    try {
      const saved = localStorage.getItem(this.KEY);
      if (saved === 'off') this.enabled = false;
    } catch (_) {}
  }

  isSupported() {
    return typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  setEnabled(on) {
    this.enabled = !!on;
    try { localStorage.setItem(this.KEY, this.enabled ? 'on' : 'off'); } catch (_) {}
    if (!this.enabled) this.cancel();
  }

  toggle() {
    this.setEnabled(!this.enabled);
    if (this.enabled) {
      this.unlock();
      this.say('pkSayVoiceOn', {}, { force: true });
    }
    ui.showToast(i18n.t(this.enabled ? 'pkVoiceOn' : 'pkVoiceOff'), 'info', 2000);
  }

  /**
   * iOS only lets a page speak after it has spoken inside a tap. The geofence
   * fires from a GPS callback, never a tap, so the first tap anywhere in the
   * app primes it.
   */
  bindUnlock() {
    if (!this.isSupported() || typeof document === 'undefined') return;
    const once = () => {
      this.unlock();
      document.removeEventListener('touchend', once, true);
      document.removeEventListener('click', once, true);
    };
    document.addEventListener('touchend', once, true);
    document.addEventListener('click', once, true);
  }

  /** Must run inside a user gesture to satisfy iOS. Speaks an inaudible blank. */
  unlock() {
    if (!this.isSupported() || this._unlocked) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
      this._unlocked = true;
    } catch (_) {}
  }

  cancel() {
    try { if (this.isSupported()) speechSynthesis.cancel(); } catch (_) {}
  }

  /**
   * Which language to speak in, and with which voice. Tajik falls back to
   * Russian unless the device actually has a Tajik voice.
   */
  _pick(uiLang) {
    const voices = (() => { try { return speechSynthesis.getVoices() || []; } catch (_) { return []; } })();
    const find = (code) => voices.find((v) => String(v.lang || '').toLowerCase().replace('_', '-').startsWith(code));
    const ladder = uiLang === 'tj' ? ['tg', 'ru'] : uiLang === 'ru' ? ['ru'] : ['en'];
    for (const code of ladder) {
      const voice = find(code);
      if (voice) return { lang: code === 'tg' ? 'tj' : code, voice };
    }
    // No matching voice listed (Android often lists none until first use):
    // name the language and let the engine choose.
    const lang = uiLang === 'tj' ? 'ru' : uiLang;
    return { lang, voice: null };
  }

  say(key, vars = {}, { force = false } = {}) {
    if (!this.isSupported() || (!this.enabled && !force)) return false;
    if (typeof document !== 'undefined' && document.hidden) return false;

    const { lang, voice } = this._pick(i18n.currentLang);
    let text = i18n.tIn(lang, key);
    if (!text || text === key) return false;
    for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));

    try {
      // A new alert replaces an unfinished one — never a queue of old news.
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice?.lang || { ru: 'ru-RU', en: 'en-US', tj: 'tg-TJ' }[lang];
      if (voice) u.voice = voice;
      u.rate = 1;
      u.pitch = 1;
      speechSynthesis.speak(u);
      return true;
    } catch (_) {
      return false;
    }
  }

  /** "1 час 5 минут" — spoken, so units are words with the right plural. */
  duration(ms) {
    const { lang } = this._pick(i18n.currentLang);
    const totalMin = Math.max(1, Math.round(ms / 60000));
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    const ru = (n, forms) => {
      const a = n % 100, b = n % 10;
      if (a >= 11 && a <= 14) return forms[2];
      if (b === 1) return forms[0];
      if (b >= 2 && b <= 4) return forms[1];
      return forms[2];
    };
    const unit = {
      ru: { h: (n) => ru(n, ['час', 'часа', 'часов']), m: (n) => ru(n, ['минута', 'минуты', 'минут']) },
      en: { h: (n) => (n === 1 ? 'hour' : 'hours'), m: (n) => (n === 1 ? 'minute' : 'minutes') },
      tj: { h: () => 'соат', m: () => 'дақиқа' },
    }[lang] || null;
    if (!unit) return `${totalMin}`;
    const parts = [];
    if (h) parts.push(`${h} ${unit.h(h)}`);
    if (m || !h) parts.push(`${m} ${unit.m(m)}`);
    return parts.join(' ');
  }
}

// ============================================
// Parking history (local only)
// ============================================
//
// Every finished session, on this device only — like the charger analytics,
// nothing leaves the phone. Shown in the Analytics sheet while the map is in
// parking mode (the tab reads "History" there).

class ParkingHistory {
  constructor() {
    this.KEY = 'nur-parking-history-v1';
    this.MAX = 300;
    this._items = null;
  }

  list() {
    if (this._items) return this._items;
    let items = [];
    try {
      const raw = JSON.parse(localStorage.getItem(this.KEY) || '[]');
      if (Array.isArray(raw)) items = raw.filter((r) => r && r.startedAt && r.endedAt);
    } catch (_) {}
    this._items = items.sort((a, b) => b.startedAt - a.startedAt);
    return this._items;
  }

  _save() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this._items || [])); } catch (_) {}
  }

  add(rec) {
    const items = this.list();
    const id = `${rec.startedAt}-${rec.zoneId}`;
    if (items.some((r) => r.id === id)) return;
    items.unshift({ id, ...rec });
    items.sort((a, b) => b.startedAt - a.startedAt);
    if (items.length > this.MAX) items.length = this.MAX;
    this._save();
  }

  remove(id) {
    this._items = this.list().filter((r) => r.id !== id);
    this._save();
  }

  clear() {
    this._items = [];
    try { localStorage.removeItem(this.KEY); } catch (_) {}
  }

  /** Totals for the Dushanbe calendar month containing `at`. */
  monthSummary(at = Date.now()) {
    const key = (ms) => {
      const d = new Date(ms + PK_TZ_OFFSET_MS);
      return d.getUTCFullYear() * 12 + d.getUTCMonth();
    };
    const month = key(at);
    const rows = this.list().filter((r) => key(r.startedAt) === month);
    return {
      count: rows.length,
      ms: rows.reduce((n, r) => n + Math.max(0, r.endedAt - r.startedAt), 0),
      cost: rows.reduce((n, r) => n + (r.cost || 0), 0),
    };
  }

  /** Keep the "Now" row moving without re-rendering the sheet every second. */
  tickLive() {
    const clock = document.getElementById('pk-hist-live-clock');
    if (!clock) return;
    if (!parkingSession.isActive()) {
      if (typeof stationAnalytics !== 'undefined') stationAnalytics.refresh();
      return;
    }
    const s = parkingSession.compute();
    clock.textContent = parkingSession._formatClock(s.elapsedMs);
    const cost = document.getElementById('pk-hist-live-cost');
    if (cost) cost.textContent = `${s.cost} ${i18n.t('pkSomoni')}`;
  }

  // ── Rendering (into the Analytics sheet body) ─────────────────────────────

  render(body) {
    const t = (k) => i18n.t(k);
    const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const hm = (ms) => {
      const d = new Date(ms + PK_TZ_OFFSET_MS);
      return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    };
    const dur = (ms) => {
      const min = Math.max(0, Math.round(ms / 60000));
      const h = Math.floor(min / 60);
      return h ? `${h} ${t('hourShort')} ${min % 60} ${t('minSuffix')}` : `${min} ${t('minSuffix')}`;
    };
    const dayKey = (ms) => Math.floor((ms + PK_TZ_OFFSET_MS) / PK_DAY_MS);
    const today = dayKey(Date.now());
    const dayLabel = (ms) => {
      const k = dayKey(ms);
      if (k === today) return t('pkHistToday');
      if (k === today - 1) return t('pkHistYesterday');
      const locale = { tj: 'tg-TJ', ru: 'ru-RU', en: 'en-GB' }[i18n.currentLang] || 'ru-RU';
      try {
        return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'Asia/Dushanbe' })
          .format(new Date(ms));
      } catch (_) {
        return new Date(ms).toISOString().slice(0, 10);
      }
    };

    const items = this.list();
    const sum = this.monthSummary();

    // The running session sits on top, live.
    let live = '';
    if (parkingSession.isActive()) {
      const s = parkingSession.compute();
      live = `
        <section class="an-sec">
          <h3 class="an-h">${esc(t('pkHistNow'))}</h3>
          <div class="pk-hist-row pk-hist-row--live">
            <div class="pk-hist-main">
              <span class="pk-hist-addr">${esc(s.zone?.address || t('pkPaidZone'))}</span>
              <span class="pk-hist-meta">${s.zone?.code ? `${esc(s.zone.code)} · ` : ''}${esc(t('pkHistSince'))} ${hm(parkingSession.session.startedAt)} · <span id="pk-hist-live-clock">${parkingSession._formatClock(s.elapsedMs)}</span></span>
            </div>
            <span class="pk-hist-cost" id="pk-hist-live-cost">${s.cost} ${esc(t('pkSomoni'))}</span>
          </div>
        </section>`;
    }

    let list = '';
    if (!items.length) {
      list = `
        <div class="an-empty">
          <p class="an-empty-title">${esc(t('pkHistEmptyTitle'))}</p>
          <p class="an-empty-hint">${esc(t('pkHistEmptyHint'))}</p>
        </div>`;
    } else {
      const groups = [];
      for (const r of items) {
        const k = dayKey(r.startedAt);
        if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, ms: r.startedAt, rows: [] });
        groups[groups.length - 1].rows.push(r);
      }
      list = groups.map((g) => `
        <section class="an-sec pk-hist-day">
          <h3 class="an-h">${esc(dayLabel(g.ms))}</h3>
          <ul class="pk-hist-list">
            ${g.rows.map((r) => `
              <li class="pk-hist-row">
                <button class="pk-hist-main" type="button" data-pk-hist-show="${esc(r.zoneId)}" title="${esc(t('pkHistShow'))}">
                  <span class="pk-hist-addr">${esc(r.address || t('pkPaidZone'))}</span>
                  <span class="pk-hist-meta">${r.code ? `${esc(r.code)} · ` : ''}${hm(r.startedAt)}–${hm(r.endedAt)} · ${esc(dur(r.endedAt - r.startedAt))}${r.approx ? ` · ${esc(t('pkHistApprox'))}` : ''}</span>
                </button>
                <span class="pk-hist-cost">${r.approx ? '≈ ' : ''}${r.cost || 0} ${esc(t('pkSomoni'))}</span>
                <button class="pk-hist-del" type="button" data-pk-hist-del="${esc(r.id)}" aria-label="${esc(t('pkHistDelete'))}" title="${esc(t('pkHistDelete'))}">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
                </button>
              </li>`).join('')}
          </ul>
        </section>`).join('');
    }

    const voiceOk = parkingVoice.isSupported();
    const facts = typeof stationAnalytics !== 'undefined' ? stationAnalytics.parkingFacts() : null;

    body.innerHTML = `
      ${live}
      <section class="an-sec an-sec--parking">
        <h3 class="an-h">${esc(t('pkHistMonth'))}</h3>
        <div class="an-tiles pk-hist-tiles">
          <div class="an-tile"><span class="an-tile-v">${sum.count}</span><span class="an-tile-l">${esc(t('pkHistSessions'))}</span></div>
          <div class="an-tile"><span class="an-tile-v">${esc(dur(sum.ms))}</span><span class="an-tile-l">${esc(t('pkHistTime'))}</span></div>
          <div class="an-tile"><span class="an-tile-v">${sum.cost} ${esc(t('pkSomoni'))}</span><span class="an-tile-l">${esc(t('pkHistSpent'))}</span></div>
        </div>
        <p class="an-note">${esc(t('pkHistCostNote'))}</p>
      </section>

      ${list}

      <section class="an-sec">
        <label class="pk-voice-row${voiceOk ? '' : ' is-disabled'}">
          <span class="pk-voice-text">
            <span class="pk-voice-title">${esc(t('pkVoice'))}</span>
            <span class="pk-voice-hint">${esc(t(voiceOk ? 'pkVoiceHint' : 'pkVoiceUnsupported'))}</span>
          </span>
          <input type="checkbox" class="pk-switch" id="pk-voice-switch" ${parkingVoice.enabled && voiceOk ? 'checked' : ''} ${voiceOk ? '' : 'disabled'}>
        </label>
      </section>

      ${facts ? `
      <section class="an-sec an-sec--parking">
        <h3 class="an-h">${esc(t('anParking'))}<span class="an-sub">${esc(t('anParkingHint'))}</span></h3>
        <div class="an-tiles">
          ${facts.map((x) => `
            <div class="an-tile">
              <span class="an-tile-v">${esc(String(x.v))}</span>
              <span class="an-tile-l">${esc(x.l)}</span>
            </div>`).join('')}
        </div>
      </section>` : ''}

      ${items.length ? `
      <footer class="an-foot">
        <span>${esc(t('pkHistStored'))}: <strong>${items.length}</strong></span>
        <div class="an-foot-actions">
          <button class="an-btn an-btn--quiet" id="pk-hist-clear" type="button">${esc(t('pkHistClear'))}</button>
        </div>
      </footer>` : ''}
    `;

    body.querySelector('#pk-voice-switch')?.addEventListener('change', (e) => {
      if (!!e.target.checked !== parkingVoice.enabled) parkingVoice.toggle();
      parkingSession._render();
    });
    body.querySelector('#pk-hist-clear')?.addEventListener('click', () => {
      if (typeof confirm === 'function' && !confirm(t('pkHistClearConfirm'))) return;
      this.clear();
      this.render(body);
    });
    body.querySelectorAll('[data-pk-hist-del]').forEach((btn) => btn.addEventListener('click', () => {
      this.remove(btn.dataset.pkHistDel);
      this.render(body);
    }));
    body.querySelectorAll('[data-pk-hist-show]').forEach((btn) => btn.addEventListener('click', () => {
      const zone = parkingAPI.getZoneById(btn.dataset.pkHistShow);
      if (!zone) { ui.showToast(t('pkNoZones'), 'warning', 2500); return; }
      stationAnalytics.close();
      stationMap.flyTo(zone.lat, zone.lng, 17);
      stationMap.openZonePopup(zone.id);
    }));
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
    setTimeout(() => { if (!modal.classList.contains('is-open')) modal.hidden = true; }, 260);
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
const parkingVoice = new ParkingVoice();
const parkingHistory = new ParkingHistory();
const parkingSession = new ParkingSession();
const parkingRules = new ParkingRules();
