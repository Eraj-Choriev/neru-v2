// Parking meter: billing across the paid window, geofence entry/exit, history.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

// Dushanbe wall-clock time (UTC+5) → epoch ms.
const dsb = (h, m = 0, s = 0, day = 9) => Date.UTC(2026, 10, day, h - 5, m, s);

function setup() {
  const clock = { now: dsb(12) };
  class FakeDate extends Date {
    constructor(...a) { a.length ? super(...a) : super(clock.now); }
    static now() { return clock.now; }
  }
  const store = new Map();
  const toasts = [];
  const c = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    Date: FakeDate, Intl, Math, JSON, Number, String, Object, Array, Map, Set, Promise,
    AbortController,
    window: { dispatchEvent() {}, addEventListener() {} },
    document: { hidden: false, addEventListener() {}, getElementById: () => null, querySelector: () => null, body: { dataset: {} } },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    CustomEvent: class {},
    i18n: { t: (k) => k, tIn: (_l, k) => k, currentLang: 'ru' },
    ui: { showToast: (m) => toasts.push(m) },
    stationMap: { highlightZone() {}, clearZoneHighlight() {} },
  });
  for (const f of ['js/ui.js', 'js/geolocation.js', 'js/parking.js', 'js/parking-session.js']) {
    vm.runInContext(fs.readFileSync(f, 'utf8'), c);
  }
  // Strip A runs ~435 m east along a street; strip B starts where A ends.
  vm.runInContext(`parkingAPI.zones = [
    { id: 1, code: 'A1', address: 'Rudaki 1', lat: 38.56, lng: 68.7725, a: [38.56, 68.77], b: [38.56, 68.775], tariff: 3, schedule: '07:00 - 22:00' },
    { id: 2, code: 'B1', address: 'Rudaki 2', lat: 38.56, lng: 68.7775, a: [38.56, 68.775], b: [38.56, 68.78], tariff: 3, schedule: '07:00 - 22:00' },
  ]`, c);
  const run = (code) => vm.runInContext(code, c);
  const fix = (lat, lng, speed = 0) => run(`parkingSession.onPosition({ lat: ${lat}, lng: ${lng}, accuracy: 10, speed: ${speed} })`);
  return { c, clock, run, fix, toasts, store };
}

test('paid window overlap: evening sessions stop billing at 22:00', () => {
  const { run } = setup();
  const sch = run(`parseSchedule('07:00 - 22:00')`);
  run(`this.sch = parseSchedule('07:00 - 22:00')`);
  assert.equal(sch.open, '07:00');
  assert.equal(run(`pkPaidMs(${dsb(21, 30)}, ${dsb(23)}, sch)`), 30 * 60000);
  assert.equal(run(`pkPaidMs(${dsb(23)}, ${dsb(6, 0, 0, 10)}, sch)`), 0);
  assert.equal(run(`pkPaidMs(${dsb(21)}, ${dsb(8, 0, 0, 10)}, sch)`), 2 * 3600000);
  assert.equal(run(`pkPaidMs(0, 3600000, null)`), 3600000, 'no schedule bills everything');
});

test('a car left at 21:30 is not billed all night', () => {
  const { run, clock } = setup();
  clock.now = dsb(21, 35);
  run(`parkingSession.start(parkingAPI.getZoneById(1), { startedAt: ${dsb(21, 30)} })`);
  clock.now = dsb(23, 30);
  const s = run('parkingSession.compute()');
  assert.equal(s.billableHours, 1); // 21:40–22:00 only; the old meter said 2
  assert.equal(s.cost, 3);
  assert.equal(s.paidNow, false);
});

test('a car parked at 06:55 starts paying at 07:05, not never', () => {
  const { run, clock } = setup();
  clock.now = dsb(6, 55);
  run(`parkingSession.start(parkingAPI.getZoneById(1))`);
  clock.now = dsb(6, 59);
  assert.equal(run('parkingSession.compute().cost'), 0);
  assert.equal(run('parkingSession.compute().paidNow'), false);
  clock.now = dsb(7, 30);
  const s = run('parkingSession.compute()');
  assert.equal(s.paidNow, true);
  assert.equal(s.billableHours, 1);
  clock.now = dsb(8, 6);
  assert.equal(run('parkingSession.compute().billableHours'), 2, 'part hour counts as a full hour');
});

test('free 10 minutes run from arrival, not from the tap on "start"', () => {
  const { run, fix, clock } = setup();
  const t0 = dsb(12);
  clock.now = t0;
  fix(38.5601, 68.772);                       // stopped on strip A
  clock.now = t0 + 61000;
  fix(38.5601, 68.772);
  assert.ok(run('parkingSession.isAsking()'), 'asks after a minute parked');
  clock.now = t0 + 8 * 60000;                 // answered 8 minutes later
  run('parkingSession.acceptAsk()');
  assert.equal(run('parkingSession.session.startedAt'), t0);
  assert.equal(Math.ceil(run('parkingSession.compute().freeLeftMs') / 60000), 2);
});

test('crawling in a jam beside a strip never asks', () => {
  const { run, fix, clock } = setup();
  const t0 = dsb(12);
  for (let i = 0; i <= 120; i += 5) {          // 2 minutes at ~1.5 m/s
    clock.now = t0 + i * 1000;
    fix(38.5601, 68.77 + (i * 1.5) / 87090, 1.5);
  }
  assert.equal(run('parkingSession.isAsking()'), false);
});

test('GPS flipping between two adjacent strips still asks', () => {
  const { run, fix, clock } = setup();
  const t0 = dsb(12);
  for (let i = 0; i <= 70; i += 5) {
    clock.now = t0 + i * 1000;
    fix(38.5601, i % 10 ? 68.77498 : 68.77502); // the corner where A meets B
  }
  assert.ok(run('parkingSession.isAsking()'));
});

test('an unanswered question is withdrawn once the car drives off', () => {
  const { run, fix, clock } = setup();
  const t0 = dsb(12);
  clock.now = t0; fix(38.5601, 68.772);
  clock.now = t0 + 61000; fix(38.5601, 68.772);
  assert.ok(run('parkingSession.isAsking()'));
  clock.now = t0 + 70000; fix(38.5612, 68.772, 8);   // ~120 m away, moving
  assert.equal(run('parkingSession.isAsking()'), false);
});

test('leaving ends the meter at the moment of leaving and saves it to history', () => {
  const { run, fix, clock } = setup();
  const t0 = dsb(12);
  clock.now = t0;
  run(`parkingSession.start(parkingAPI.getZoneById(1))`);
  clock.now = t0 + 75 * 60000;
  fix(38.5601, 68.772);                         // still there
  const left = t0 + 76 * 60000;
  clock.now = left; fix(38.5615, 68.772, 9);    // gone
  clock.now = left + 61000; fix(38.5625, 68.772, 9);
  assert.equal(run('parkingSession.isActive()'), false);
  const h = run('parkingHistory.list()');
  assert.equal(h.length, 1);
  assert.equal(h[0].endedAt, left);
  assert.equal(h[0].cost, 6);                   // 66 paid minutes → 2 hours
  assert.equal(h[0].address, 'Rudaki 1');
  assert.equal(h[0].approx, false);
});

test('a mis-tap shorter than a minute is not recorded; month summary adds up', () => {
  const { run, clock } = setup();
  run(`parkingSession.start(parkingAPI.getZoneById(1))`);
  clock.now += 20000;
  run('parkingSession.end()');
  assert.equal(run('parkingHistory.list().length'), 0);
  run(`parkingSession.start(parkingAPI.getZoneById(2))`);
  clock.now += 40 * 60000;
  run('parkingSession.end()');
  const m = run('parkingHistory.monthSummary()');
  assert.equal(m.count, 1);
  assert.equal(m.cost, 3);
});

test('a restored session does not replay warnings it slept through', () => {
  const { run, clock, toasts, store } = setup();
  const t0 = dsb(12);
  store.set('nur-parking-session-v1', JSON.stringify({ zoneId: 1, startedAt: t0, warned: {} }));
  clock.now = t0 + 3 * 3600000;
  run('parkingSession._restore()');
  run('parkingSession._checkWarnings()');
  assert.equal(toasts.length, 0);
  assert.ok(run('parkingSession.session.warned.free'));
});
