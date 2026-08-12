// ============================================
// NŪR — Analytics
// ============================================
// The API is a snapshot: it says what is free right now and nothing about
// what came before. Everything interesting — which stations are reliably
// free, when the city is busiest — only exists if we remember. The app
// already polls every 30s, so this module records each poll locally and
// derives the history from it. Nothing leaves the device.

const ANALYTICS_KEY = 'nur-analytics-v1';

class StationAnalytics {
  constructor() {
    this.BUCKET_MS = 5 * 60 * 1000;  // one trend point per 5 minutes
    this.MAX_TREND = 288;            // 24 hours of them
    this.MIN_SAMPLES = 3;            // below this a per-station rate is noise
    // A rate printed on a card is a claim to a driver about to drive there,
    // so it needs more evidence than a row in a ranking list: ~20 minutes of
    // polling for the rate, and six separate hours for a claim about time.
    this.CARD_MIN_SAMPLES = 40;
    this.CARD_MIN_HOUR_SAMPLES = 20;
    this.CARD_MIN_HOURS = 6;
    this.data = this._load();
    this.lastRecordedAt = null;
  }

  // ---- persistence -------------------------------------------------

  _load() {
    try {
      const raw = localStorage.getItem(ANALYTICS_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && p.v === 1) return p;
      }
    } catch (_) {}
    return { v: 1, since: Date.now(), trend: [], st: {} };
  }

  _save() {
    try {
      localStorage.setItem(ANALYTICS_KEY, JSON.stringify(this.data));
    } catch (_) {
      // Quota exceeded — drop the oldest half of the trend and retry once.
      this.data.trend = this.data.trend.slice(-Math.floor(this.MAX_TREND / 2));
      try { localStorage.setItem(ANALYTICS_KEY, JSON.stringify(this.data)); } catch (_) {}
    }
  }

  reset() {
    this.data = { v: 1, since: Date.now(), trend: [], st: {} };
    this._save();
  }

  // ---- recording ---------------------------------------------------

  /** Fold one poll of stations into the stored history. */
  record(stations) {
    if (!Array.isArray(stations) || !stations.length) return;

    const now = Date.now();
    const hour = new Date(now).getHours();
    let free = 0, busy = 0, starting = 0, stationsFree = 0, levelSum = 0, levelN = 0;

    for (const s of stations) {
      const total = s.totalConnectors || 0;
      const f = s.freeConnectors || 0;
      free += f;
      busy += Math.max(0, total - f);
      if (s.hasAvailable) stationsFree++;

      for (const c of s.connectors || []) {
        if (c.isStarting) starting++;
        if ((c.isCharging || c.isStarting) && c.chargeLevel > 0) { levelSum += c.chargeLevel; levelN++; }
      }

      const rec = this.data.st[s.id] || (this.data.st[s.id] = { n: s.name, c: 0, f: 0, h: {} });
      rec.n = s.name;
      rec.c++;
      if (s.hasAvailable) rec.f++;
      const h = rec.h[hour] || (rec.h[hour] = [0, 0]);
      h[0]++;
      if (s.hasAvailable) h[1]++;
    }

    // One trend point per bucket: overwrite inside the current bucket so a
    // 30s poll cadence doesn't blow up storage.
    const bucket = Math.floor(now / this.BUCKET_MS) * this.BUCKET_MS;
    const last = this.data.trend[this.data.trend.length - 1];
    const point = [bucket, free, busy, stationsFree];
    if (last && last[0] === bucket) this.data.trend[this.data.trend.length - 1] = point;
    else this.data.trend.push(point);

    if (this.data.trend.length > this.MAX_TREND) {
      this.data.trend = this.data.trend.slice(-this.MAX_TREND);
    }

    this.lastRecordedAt = now;
    this.live = {
      total: stations.length,
      free, busy, starting, stationsFree,
      avgLevel: levelN ? levelSum / levelN : 0,
      fast: stations.filter((s) => (s.capacityKw || 0) >= 100).length,
    };
    this._save();
  }

  // ---- derived views ----------------------------------------------

  /** How long we have been collecting, and how much we have. */
  coverage() {
    const first = this.data.trend[0]?.[0] || this.data.since;
    return {
      since: first,
      hours: Math.max(0, (Date.now() - first) / 3600000),
      points: this.data.trend.length,
      stations: Object.keys(this.data.st).length,
    };
  }

  /** Stations ranked by how often they had a free connector. */
  ranked(order = 'free', limit = 5) {
    const rows = Object.entries(this.data.st)
      .filter(([, r]) => r.c >= this.MIN_SAMPLES)
      .map(([id, r]) => ({ id, name: r.n, rate: r.f / r.c, samples: r.c }));
    rows.sort((a, b) => (order === 'free' ? b.rate - a.rate : a.rate - b.rate));
    return rows.slice(0, limit);
  }

  /** Free-connector trend, oldest first. */
  trend() {
    return this.data.trend.map(([t, free, busy, stationsFree]) => ({ t, free, busy, stationsFree }));
  }

  /**
   * Availability by hour of day, averaged over every station and every day
   * seen. Answers "is it usually free at this time?".
   */
  byHour() {
    const acc = Array.from({ length: 24 }, () => [0, 0]);
    for (const r of Object.values(this.data.st)) {
      for (const [h, [samples, freeSamples]] of Object.entries(r.h || {})) {
        acc[+h][0] += samples;
        acc[+h][1] += freeSamples;
      }
    }
    return acc.map(([samples, freeSamples], hour) => ({
      hour,
      rate: samples ? freeSamples / samples : null,
      samples,
    }));
  }

  /** Stations whose busy connector is closest to finishing. */
  freeingSoon(stations, limit = 4) {
    const out = [];
    for (const s of stations || []) {
      if (s.hasAvailable || !(s.capacityKw > 0)) continue;
      let best = null;
      for (const c of s.connectors || []) {
        if (!(c.isCharging || c.isStarting) || !(c.chargeLevel > 0)) continue;
        const eta = chargingEta(c.chargeLevel, s.capacityKw);
        if (!eta) continue;
        const mins = eta.type === 'minSuffix'
          ? (eta.val === '<1' ? 0 : parseInt(eta.val, 10))
          : parseFloat(eta.val) * 60;
        if (best === null || mins < best.mins) best = { mins, eta, level: c.chargeLevel };
      }
      if (best) out.push({ id: s.id, name: s.name, ...best });
    }
    out.sort((a, b) => a.mins - b.mins);
    return out.slice(0, limit);
  }

  /**
   * What the history says about one station, or null when it does not yet
   * say anything worth printing.
   *
   * Two claims, gated separately, because they need different amounts of
   * evidence. "Free in N% of observations" only needs enough polls to stop
   * being a coin flip. "Usually busy 18:00–20:00" is a claim about the clock,
   * so it needs samples spread across the clock — six hours of them, twenty
   * polls each. Below either threshold the corresponding field is null and
   * the card prints nothing rather than a number the data cannot support.
   */
  stationInsight(id) {
    const r = this.data.st?.[id];
    if (!r || !r.c) return null;

    const rate = r.c >= this.CARD_MIN_SAMPLES ? r.f / r.c : null;

    // Hours with enough polls to compare against each other.
    const hours = Object.entries(r.h || {})
      .map(([h, [samples, freeSamples]]) => ({ hour: +h, samples, rate: freeSamples / samples }))
      .filter((x) => x.samples >= this.CARD_MIN_HOUR_SAMPLES)
      .sort((a, b) => a.hour - b.hour);

    let busy = null;
    if (rate !== null && hours.length >= this.CARD_MIN_HOURS) {
      // Hours the station is meaningfully tighter than its own average. An
      // absolute cut-off would flag every hour of a busy station and none of
      // a quiet one; relative to itself, "busy for this station" is the
      // thing a driver can act on.
      const cut = rate * 0.75;
      const tight = hours.filter((x) => x.rate <= cut);
      if (tight.length) {
        // Longest consecutive run, so the answer is a window and not a list.
        let best = null, run = [tight[0]];
        for (let i = 1; i <= tight.length; i++) {
          const prev = tight[i - 1], cur = tight[i];
          if (cur && cur.hour === prev.hour + 1) { run.push(cur); continue; }
          if (!best || run.length > best.length) best = run;
          if (cur) run = [cur];
        }
        if (best) busy = { from: best[0].hour, to: (best[best.length - 1].hour + 1) % 24 };
      }
    }

    const nowHour = new Date().getHours();
    const atNow = hours.find((x) => x.hour === nowHour) || null;

    return { rate, samples: r.c, hours: hours.length, busy, atNow };
  }

  /**
   * The history row shown on a station card and in its map popup. One
   * function for both, so the two never drift — the wait banner is already
   * written out twice and the second copy is where bugs live.
   */
  stationHistoryHtml(id) {
    const insight = this.stationInsight(id);
    if (!insight || insight.rate === null) return '';

    const t = (k) => i18n.t(k);

    // A percentage was the wrong unit here. "Free in 100% of observations"
    // names our sampling method, not the station, and the number invites a
    // precision the history does not have — 100% of forty polls is not a
    // promise. The card says what the driver would say: usually free,
    // sometimes busy, often busy.
    const band = insight.rate >= 0.85 ? 'histUsuallyFree'
      : insight.rate >= 0.45 ? 'histSometimesBusy'
      : 'histOftenBusy';
    const parts = [t(band)];

    if (insight.busy) {
      const hh = (h) => `${String(h).padStart(2, '0')}:00`;
      parts.push(t('histBusyWindow')
        .replace('{from}', hh(insight.busy.from))
        .replace('{to}', hh(insight.busy.to)));
    }

    return `
      <p class="hist-row">
        <svg class="hist-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 8v4l3 2"/></svg>
        <span class="hist-text">${esc(parts.join(' · '))}</span>
      </p>`;
  }

  // ---- panel -------------------------------------------------------

  open() {
    const modal = document.getElementById('an-modal');
    if (!modal) return;
    modal.hidden = false;
    requestAnimationFrame(() => modal.classList.add('is-open'));
    document.body.classList.add('an-open');
    this.render();
    this._timer = setInterval(() => this._tickCountdown(), 1000);
    document.getElementById('an-close')?.focus();
  }

  close() {
    const modal = document.getElementById('an-modal');
    if (!modal) return;
    modal.classList.remove('is-open');
    document.body.classList.remove('an-open');
    clearInterval(this._timer);
    setTimeout(() => { modal.hidden = true; }, 260);
  }

  isOpen() {
    return !!document.getElementById('an-modal')?.classList.contains('is-open');
  }

  toggle() { this.isOpen() ? this.close() : this.open(); }

  /** Re-render only while visible, so background polls stay cheap. */
  refresh() { if (this.isOpen()) this.render(); }

  /**
   * A standing picture of the network, not the rolling local history: these
   * come straight off the current station list, so they read the same on a
   * first visit as they do after a week of polling.
   */
  overall() {
    const stations = stationAPI.getStations();
    if (!stations.length) return null;

    const t = (k) => i18n.t(k);
    const conn = stations.reduce((n, s) => n + (s.totalConnectors || 0), 0);
    const free = stations.reduce((n, s) => n + (s.freeConnectors || 0), 0);
    const withFree = stations.filter((s) => s.hasAvailable).length;

    const powered = stations.filter((s) => s.capacityKw > 0);
    const avgKw = powered.length
      ? powered.reduce((n, s) => n + s.capacityKw, 0) / powered.length
      : 0;

    // Charge level only means something on a connector that is charging.
    const levels = stations.flatMap((s) => (s.connectors || [])
      .filter((c) => c.isCharging && Number.isFinite(c.chargeLevel))
      .map((c) => c.chargeLevel));
    const avgLevel = levels.length
      ? levels.reduce((a, b) => a + b, 0) / levels.length
      : null;

    return [
      { v: stations.length, l: t('totalStations') },
      { v: conn, l: t('anConnectors') },
      { v: `${withFree}/${stations.length}`, l: t('anStationsWithFree') },
      { v: (free / stations.length).toFixed(1), l: t('anAvgFreePerStation') },
      { v: `${Math.round(avgKw)} ${t('kwUnit')}`, l: t('anAvgPower') },
      ...(avgLevel === null ? [] : [{ v: `${Math.round(avgLevel)}%`, l: t('anAvgCharge') }]),
    ];
  }

  /** The paid-parking scheme in numbers. Static by nature — the feed and the
   *  operator's published rules do not move between sessions. */
  parkingFacts() {
    if (typeof parkingAPI === 'undefined') return null;
    const st = parkingAPI.getStats();
    if (!st.zones) return null;

    const t = (k) => i18n.t(k);
    return [
      { v: st.zones, l: t('pkZonesLabel') },
      { v: st.places, l: t('pkPlaces') },
      { v: st.accessible, l: t('pkAccessible') },
      { v: `${PARKING.TARIFF_TJS} ${t('pkPerHour')}`, l: t('anPkTariff') },
      { v: `${PARKING.FREE_MINUTES} ${t('minSuffix')}`, l: t('anPkFree') },
      { v: `${PARKING.PRR_TJS} ${t('pkSomoni')}`, l: t('anPkFine') },
    ];
  }

  render() {
    const body = document.getElementById('an-body');
    if (!body) return;

    const live = this.live;
    const cov = this.coverage();
    const t = (k) => i18n.t(k);

    if (!live) {
      body.innerHTML = `
        <div class="an-empty">
          <p class="an-empty-title">${esc(t('anCollecting'))}</p>
          <p class="an-empty-hint">${esc(t('anCollectingHint'))}</p>
        </div>`;
      return;
    }

    const totalConn = live.free + live.busy;
    const availability = totalConn ? Math.round((live.free / totalConn) * 100) : 0;

    const tiles = [
      { v: live.free, l: t('anFreeConn'), tone: 'free' },
      { v: live.busy, l: t('anBusyConn'), tone: 'busy' },
      { v: `${availability}%`, l: t('anAvailability'), tone: 'accent' },
      { v: `${live.stationsFree}/${live.total}`, l: t('anStationsFree') },
      { v: live.starting, l: t('anStartingConn'), tone: live.starting ? 'warn' : '' },
      { v: `${Math.round(live.avgLevel)}%`, l: t('anAvgCharge') },
    ];

    const mostFree = this.ranked('free', 5);
    const mostBusy = this.ranked('busy', 5);
    const soon = this.freeingSoon(stationAPI.getStations(), 4);
    const overall = this.overall();
    const parking = this.parkingFacts();

    body.innerHTML = `
      <section class="an-sec">
        <h3 class="an-h">${esc(t('anNow'))}</h3>
        <div class="an-tiles">
          ${tiles.map((x) => `
            <div class="an-tile${x.tone ? ' an-tile--' + x.tone : ''}">
              <span class="an-tile-v">${esc(String(x.v))}</span>
              <span class="an-tile-l">${esc(x.l)}</span>
            </div>`).join('')}
        </div>
      </section>

      ${overall ? `
      <section class="an-sec">
        <h3 class="an-h">${esc(t('anOverall'))}<span class="an-sub">${esc(t('anOverallHint'))}</span></h3>
        <div class="an-tiles">
          ${overall.map((x) => `
            <div class="an-tile">
              <span class="an-tile-v">${esc(String(x.v))}</span>
              <span class="an-tile-l">${esc(x.l)}</span>
            </div>`).join('')}
        </div>
      </section>` : ''}

      ${parking ? `
      <section class="an-sec an-sec--parking">
        <h3 class="an-h">${esc(t('anParking'))}<span class="an-sub">${esc(t('anParkingHint'))}</span></h3>
        <div class="an-tiles">
          ${parking.map((x) => `
            <div class="an-tile">
              <span class="an-tile-v">${esc(String(x.v))}</span>
              <span class="an-tile-l">${esc(x.l)}</span>
            </div>`).join('')}
        </div>
        <p class="an-note">${esc(t('anPkNote'))}</p>
      </section>` : ''}

      <section class="an-sec">
        <h3 class="an-h">${esc(t('anTrend24'))}<span class="an-sub">${esc(t('anTrendHint'))}</span></h3>
        ${this._trendChart()}
      </section>

      <section class="an-sec">
        <h3 class="an-h">${esc(t('anByHour'))}<span class="an-sub">${esc(t('anByHourHint'))}</span></h3>
        ${this._hourChart()}
      </section>

      ${soon.length ? `
      <section class="an-sec">
        <h3 class="an-h">${esc(t('anFreeingSoon'))}</h3>
        <ul class="an-list">
          ${soon.map((s) => `
            <li class="an-row">
              <span class="an-row-name">${esc(s.name)}</span>
              <span class="an-row-val an-row-val--soon">~${esc(s.eta.val)} ${esc(t(s.eta.type))}</span>
            </li>`).join('')}
        </ul>
      </section>` : ''}

      <div class="an-cols">
        ${this._rankList(t('anMostFree'), mostFree, 'free')}
        ${this._rankList(t('anMostBusy'), mostBusy, 'busy')}
      </div>

      <footer class="an-foot">
        <!-- Label before the number: reads correctly at any count in all three languages -->
        <span>${esc(t('anObserved'))}: <strong>${this._dur(cov.hours)}</strong> · ${esc(t('anSamples'))}: <strong>${cov.points}</strong></span>
        <span class="an-next">${esc(t('anNextUpdate'))}: <strong id="an-countdown">—</strong></span>
        <div class="an-foot-actions">
          <button class="an-btn" id="an-refresh">${esc(t('anRefreshNow'))}</button>
          <button class="an-btn an-btn--quiet" id="an-reset">${esc(t('anReset'))}</button>
        </div>
      </footer>
    `;

    body.querySelector('#an-refresh')?.addEventListener('click', () => {
      app.loadStations().then(() => this.render());
    });
    body.querySelector('#an-reset')?.addEventListener('click', () => {
      this.reset();
      this.render();
      ui.showToast(t('anResetDone'), 'info', 2000);
    });
    this._tickCountdown();
  }

  _rankList(title, rows, tone) {
    const t = (k) => i18n.t(k);
    if (!rows.length) {
      return `<section class="an-sec">
        <h3 class="an-h">${esc(title)}</h3>
        <p class="an-note">${esc(t('anNoRanking'))}</p>
      </section>`;
    }
    return `<section class="an-sec">
      <h3 class="an-h">${esc(title)}</h3>
      <ul class="an-list">
        ${rows.map((r) => {
          const pct = Math.round(r.rate * 100);
          return `<li class="an-row">
            <span class="an-row-name">${esc(r.name)}</span>
            <span class="an-bar" aria-hidden="true"><i class="an-bar-fill an-bar-fill--${tone}" style="width:${pct}%"></i></span>
            <span class="an-row-val">${pct}%</span>
          </li>`;
        }).join('')}
      </ul>
    </section>`;
  }

  /** Free-connector trend as an SVG area chart. */
  _trendChart() {
    const pts = this.trend();
    if (pts.length < 3) return `<p class="an-note">${esc(i18n.t('anCollectingHint'))}</p>`;

    const W = 100, H = 34;
    const max = Math.max(...pts.map((p) => p.free), 1);
    const min = Math.min(...pts.map((p) => p.free));
    const span = Math.max(1, max - min);
    const xy = pts.map((p, i) => {
      const x = (i / (pts.length - 1)) * W;
      const y = H - ((p.free - min) / span) * (H - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const line = `M${xy.join(' L')}`;
    const area = `${line} L${W},${H} L0,${H} Z`;
    const first = new Date(pts[0].t), last = new Date(pts[pts.length - 1].t);
    const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

    return `
      <div class="an-chart">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
             aria-label="${esc(i18n.t('anTrendHint'))}">
          <path d="${area}" class="an-area"/>
          <path d="${line}" class="an-line" vector-effect="non-scaling-stroke"/>
        </svg>
        <div class="an-axis">
          <span>${hm(first)}</span>
          <span class="an-axis-max">${min}–${max}</span>
          <span>${hm(last)}</span>
        </div>
      </div>`;
  }

  /** Availability by hour as a bar row; hours with no data stay hollow. */
  _hourChart() {
    const rows = this.byHour();
    if (!rows.some((r) => r.samples > 0)) {
      return `<p class="an-note">${esc(i18n.t('anCollectingHint'))}</p>`;
    }
    const nowH = new Date().getHours();
    return `
      <div class="an-hours">
        ${rows.map((r) => {
          const pct = r.rate == null ? 0 : Math.round(r.rate * 100);
          const cls = r.rate == null ? ' is-empty' : '';
          const now = r.hour === nowH ? ' is-now' : '';
          const title = r.rate == null ? `${r.hour}:00 — —` : `${r.hour}:00 — ${pct}%`;
          return `<span class="an-hour${cls}${now}" title="${title}">
            <i style="height:${Math.max(pct, 3)}%"></i>
          </span>`;
        }).join('')}
      </div>
      <div class="an-hours-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>`;
  }

  _dur(hours) {
    if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} ${i18n.t('minSuffix')}`;
    return `${hours.toFixed(1)} ${i18n.t('hrSuffix')}`;
  }

  _tickCountdown() {
    const el = document.getElementById('an-countdown');
    if (!el || !app?.REFRESH_MS) return;
    const last = stationAPI.lastFetch ? new Date(stationAPI.lastFetch).getTime() : Date.now();
    const left = Math.max(0, Math.ceil((last + app.REFRESH_MS - Date.now()) / 1000));
    el.textContent = `${left}${i18n.t('anSecShort')}`;
  }
}

const stationAnalytics = new StationAnalytics();
