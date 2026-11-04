'use strict';

// Run: node --test tests/trip-core.test.cjs
// Every network response here is a fixture. No provider requests or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'trip-core.js'), 'utf8');
const epoch = Date.parse('2030-06-10T12:00:00Z');
const iso = minutes => new Date(epoch + minutes * 60000).toISOString();
const from = { label: 'My starting place', lat: 40.75, lon: -73.99 };
const to = { label: 'My destination', lat: 40.65, lon: -73.78 };
const clone = value => JSON.parse(JSON.stringify(value));

function place(name, lat, lon, extra = {}) {
  return { name, lat, lon, ...extra };
}

function leg(mode, start, end, a, b, extra = {}) {
  return {
    mode, startTime: iso(start), endTime: iso(end),
    scheduledStartTime: iso(start), scheduledEndTime: iso(end),
    realTime: false, scheduled: true, duration: (end - start) * 60,
    from: a, to: b, ...extra
  };
}

function itinerary(extra = {}) {
  const start = place('START', from.lat, from.lon, { departure: iso(0) });
  const first = place('Boarding stop', 40.74, -73.98, { stopId: 'stop-a', departure: iso(6), track: '2', scheduledTrack: '1' });
  const second = place('Transfer station', 40.70, -73.95, { stopId: 'stop-b', arrival: iso(15), departure: iso(18), scheduledTrack: '4' });
  const third = place('Alighting stop', 40.66, -73.80, { stopId: 'stop-c', arrival: iso(30) });
  const end = place('END', to.lat, to.lon, { arrival: iso(34) });
  return {
    id: 'fixture-journey', duration: 2040, startTime: iso(0), endTime: iso(34), transfers: 1,
    legs: [
      leg('WALK', 0, 4, start, first, { distance: 300 }),
      leg('BUS', 6, 15, first, second, {
        displayName: 'Q10', routeShortName: 'Q10', headsign: 'Transfer station', routeColor: '00AABB',
        tripId: 'bus-trip', routeId: 'bus-route', agencyName: 'Fixture operator',
        intermediateStops: [place('Skipped intermediate stop', 40.72, -73.96, { arrival: iso(10), departure: iso(10), cancelled: true, pickupType: 'NOT_ALLOWED', dropoffType: 'NOT_ALLOWED' })]
      }),
      leg('SUBWAY', 18, 30, second, third, {
        routeShortName: 'A', headsign: 'Airport', tripId: 'train-trip', realTime: true,
        scheduledStartTime: iso(17), scheduledEndTime: iso(29)
      }),
      leg('WALK', 30, 34, third, end, { distance: 250 })
    ], ...extra
  };
}

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data };
}

function harness({ config, reply = { itineraries: [itinerary()], direct: [] }, fetcher, controlledTimers = false } = {}) {
  const calls = [];
  const pending = new Map();
  let nextTimer = 0;
  const timers = controlledTimers ? {
    setTimeout(callback, ms) { const id = ++nextTimer; pending.set(id, { callback, ms }); return id; },
    clearTimeout(id) { pending.delete(id); }
  } : { setTimeout, clearTimeout };
  const window = {
    location: { href: 'https://transit-board.example/city.html' },
    fetch: async (url, options) => {
      calls.push({ url: new URL(url), options });
      return fetcher ? fetcher(url, options) : response(reply);
    }
  };
  if (config !== undefined) window.TB_CONFIG = config;
  const context = { window, URL, AbortController, DOMException, Date, ...timers };
  vm.runInNewContext(source, context, { filename: 'trip-core.js' });
  return {
    core: window.TBTripCore, calls, pending,
    runTimeouts() {
      const scheduled = [...pending.values()];
      pending.clear();
      for (const timer of scheduled) timer.callback();
    }
  };
}

test('adapter is inert until requested and uses the community default without credentials', async () => {
  const h = harness();
  assert.equal(h.calls.length, 0);
  assert.equal(Object.isFrozen(h.core), true);
  await h.core.plan({ from, to, when: iso(0) });
  const request = h.calls[0];
  assert.equal(request.url.origin, 'https://api.transitous.org');
  assert.equal(request.url.pathname, '/api/v6/plan');
  assert.equal(request.url.username, '');
  assert.equal(request.url.password, '');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'strict-origin-when-cross-origin');
  assert.deepEqual(Object.keys(request.options.headers), ['Accept']);
  assert.equal(request.options.headers.Accept, 'application/json');
  assert.equal(request.url.searchParams.has('apiKey'), false);
  assert.equal(request.url.searchParams.has('token'), false);
});

test('empty journey config also selects the documented default', async () => {
  const h = harness({ config: { journeyApi: '' } });
  await h.core.plan({ from, to });
  assert.equal(h.calls[0].url.origin, 'https://api.transitous.org');
});

test('geocoding normalizes real coordinates and selected administrative labels', async () => {
  const h = harness({ reply: [
    { type: 'STOP', id: 'station-1', name: ' Central ', lat: 40.7, lon: -74, areas: [
      { name: 'Manhattan', default: true }, { name: 'Manhattan', unique: true }, { name: 'Unselected region' }
    ], tz: 'America/New_York' },
    { type: 'PLACE', id: 'zero', name: 'Equator', lat: 0, lon: 0, country: 'XX' },
    { name: 'Invalid latitude', lat: 100, lon: 0 },
    { name: 'String coordinates', lat: '40.7', lon: -74 },
    null
  ] });
  const matches = await h.core.geocode(' Central ', { lat: 40.75, lon: -73.99 });
  assert.equal(matches.length, 2);
  assert.deepEqual(clone(matches[0]), { id: 'station-1', label: 'Central', detail: 'Manhattan', lat: 40.7, lon: -74, type: 'STOP', stopId: 'station-1', tz: 'America/New_York' });
  assert.equal(matches[1].lat, 0);
  assert.equal(matches[1].stopId, '');
  assert.equal(h.calls[0].url.searchParams.get('text'), 'Central');
  assert.equal(h.calls[0].url.searchParams.get('place'), '40.75,-73.99');
  assert.equal(h.calls[0].url.pathname, '/api/v1/geocode');
  assert.equal((await h.core.geocode('x')).length, 0);
  assert.equal(h.calls.length, 1);
});

test('geocoding rejects unexpected response envelopes', async () => {
  const h = harness({ reply: { places: [] } });
  await assert.rejects(h.core.geocode('Central'), { code: 'API_ERROR' });
});

test('compatible configured origin, API base and full endpoint are normalized', async t => {
  for (const configured of ['https://routing.example', 'https://routing.example/api/', 'https://routing.example/api/v6/plan']) {
    await t.test(configured, async () => {
      const h = harness({ config: { journeyApi: configured } });
      await h.core.plan({ from, to, when: '2030-06-10T09:00:00-04:00', arriveBy: true });
      const url = h.calls[0].url;
      assert.equal(url.href.startsWith('https://routing.example/api/v6/plan?'), true);
      assert.equal(url.searchParams.get('time'), '2030-06-10T13:00:00.000Z');
      assert.equal(url.searchParams.get('arriveBy'), 'true');
      assert.equal(url.searchParams.get('fromPlace'), '40.75,-73.99');
      assert.equal(url.searchParams.get('toPlace'), '40.65,-73.78');
      assert.equal(url.searchParams.has('date'), false);
    });
  }
});

test('same-origin proxy config works, invalid protocols fail before fetching', async () => {
  const h = harness({ config: { journeyApi: '/routing/api' } });
  await h.core.plan({ from, to });
  assert.equal(h.calls[0].url.origin, 'https://transit-board.example');
  assert.equal(h.calls[0].url.pathname, '/routing/api/v6/plan');
  const bad = harness({ config: { journeyApi: 'javascript:bad' } });
  await assert.rejects(bad.core.plan({ from, to }), { code: 'INVALID_CONFIG' });
  assert.equal(bad.calls.length, 0);
});

test('selected station IDs route directly through the transit graph', async () => {
  const h = harness();
  await h.core.plan({
    from: { ...from, stopId: ' station-origin ' },
    to: { ...to, stopId: 'station-destination' },
    when: iso(0)
  });
  assert.equal(h.calls[0].url.searchParams.get('fromPlace'), 'station-origin');
  assert.equal(h.calls[0].url.searchParams.get('toPlace'), 'station-destination');
  const limited = harness();
  await limited.core.plan({ from: { ...from, stopId: 'x'.repeat(2100) }, to });
  assert.equal(limited.calls[0].url.searchParams.get('fromPlace').length, 2000);
  const invalid = harness();
  await assert.rejects(invalid.core.plan({ from: { stopId: 'station-origin' }, to }), { code: 'INVALID_INPUT' });
  assert.equal(invalid.calls.length, 0, 'local guidance still requires station coordinates');
});

test('plain coordinates and empty or non-string station IDs retain coordinate routing', async () => {
  const h = harness();
  await h.core.plan({ from: { ...from, stopId: '   ' }, to: { ...to, stopId: 123 } });
  assert.equal(h.calls[0].url.searchParams.get('fromPlace'), '40.75,-73.99');
  assert.equal(h.calls[0].url.searchParams.get('toPlace'), '40.65,-73.78');
  const plain = harness();
  await plain.core.plan({ from, to });
  assert.equal(plain.calls[0].url.searchParams.get('fromPlace'), '40.75,-73.99');
  assert.equal(plain.calls[0].url.searchParams.get('toPlace'), '40.65,-73.78');
});

test('multi-leg normalization preserves chronology, realtime, platforms and skipped intermediate stops', async () => {
  const h = harness();
  const [journey] = await h.core.plan({ from, to, when: iso(0) });
  assert.equal(journey.start, epoch);
  assert.equal(journey.end, epoch + 34 * 60000);
  assert.equal(journey.duration, 34);
  assert.equal(journey.walkMinutes, 8);
  assert.equal(journey.transfers, 1);
  assert.equal(journey.realTime, true);
  assert.equal(journey.cancelled, false);
  assert.equal(journey.legs.length, 4);
  assert.equal(journey.legs[0].from.label, from.label);
  assert.equal(journey.legs[3].to.label, to.label);
  assert.equal(journey.legs[0].isTransit, false);
  assert.equal(journey.legs[0].stops.length, 0);
  const bus = journey.legs[1];
  assert.equal(bus.isTransit, true);
  assert.equal(bus.route, 'Q10');
  assert.equal(bus.routeColor, '#00AABB');
  assert.equal(bus.platform, '2');
  assert.equal(bus.realTime, false);
  assert.equal(bus.stops.length, 3);
  assert.equal(bus.stops[1].cancelled, true);
  assert.equal(bus.stops[1].pickupAllowed, false);
  assert.equal(bus.cancelled, false, 'a skipped intermediate stop does not cancel the whole journey');
  assert.equal(journey.legs[2].platform, '4');
  assert.equal(journey.legs[2].scheduledStart, epoch + 17 * 60000);
  assert.equal(journey.legs[2].start, epoch + 18 * 60000);
  for (let i = 1; i < journey.legs.length; i++) assert.ok(journey.legs[i].start >= journey.legs[i - 1].end);
});

test('cancelled service and unusable boarding/alighting endpoints flag the entire journey', async t => {
  const changes = [
    leg => { leg.cancelled = true; },
    leg => { leg.from.cancelled = true; },
    leg => { leg.to.cancelled = true; },
    leg => { leg.from.pickupType = 'NOT_ALLOWED'; },
    leg => { leg.to.dropoffType = 'NOT_ALLOWED'; }
  ];
  for (let i = 0; i < changes.length; i++) await t.test('cancellation case ' + i, async () => {
    const raw = itinerary();
    changes[i](raw.legs[1]);
    const h = harness({ reply: { itineraries: [raw], direct: [] } });
    const [journey] = await h.core.plan({ from, to });
    assert.equal(journey.legs[1].cancelled, true);
    assert.equal(journey.cancelled, true);
  });
});

test('direct walking options are included once and sorted by arrival', async () => {
  const raw = itinerary();
  const direct = { id: 'walk', startTime: iso(0), endTime: iso(25), transfers: 0, duration: 1500, legs: [
    leg('WALK', 0, 25, place('START', from.lat, from.lon), place('END', to.lat, to.lon))
  ] };
  const h = harness({ reply: { itineraries: [raw, direct], direct: [direct] } });
  const journeys = await h.core.plan({ from, to });
  assert.equal(journeys.length, 2);
  assert.equal(journeys[0].id, 'walk');
  assert.equal(journeys[0].walkMinutes, 25);
  assert.equal(journeys[0].realTime, false);
});

test('interlined legs do not add a transfer when deriving a missing transfer count', async () => {
  const raw = itinerary();
  delete raw.transfers;
  raw.legs[2].interlineWithPreviousLeg = true;
  const h = harness({ reply: { itineraries: [raw], direct: [] } });
  assert.equal((await h.core.plan({ from, to }))[0].transfers, 0);
});

test('overlapping, reversed, missing-time and invalid-coordinate legs cannot reach guidance', async t => {
  const broken = [
    raw => { raw.legs[2].startTime = iso(14); },
    raw => { raw.legs[1].endTime = iso(5); },
    raw => { raw.legs[1].startTime = 'invalid'; },
    raw => { delete raw.legs[1].to.lon; },
    raw => { raw.startTime = iso(1); },
    raw => { raw.endTime = iso(33); }
  ];
  for (let i = 0; i < broken.length; i++) await t.test('invalid chronology/data case ' + i, async () => {
    const raw = itinerary();
    broken[i](raw);
    const h = harness({ reply: { itineraries: [raw], direct: [] } });
    await assert.rejects(h.core.plan({ from, to }), { code: 'API_ERROR' });
  });
});

test('no results and malformed response bodies are distinct useful failures', async t => {
  const h = harness({ reply: { itineraries: [], direct: [] } });
  await assert.rejects(h.core.plan({ from, to }), { code: 'NO_RESULTS' });
  for (const body of [null, [], {}, { itineraries: [] }, { itineraries: 'invalid', direct: [] }]) await t.test(JSON.stringify(body), async () => {
    const malformed = harness({ reply: body });
    await assert.rejects(malformed.core.plan({ from, to }), { code: 'API_ERROR' });
  });
  const unreadable = harness({ fetcher: async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }) });
  await assert.rejects(unreadable.core.plan({ from, to }), { code: 'API_ERROR' });
});

test('invalid places and invalid chosen times fail before network access', async t => {
  for (const options of [
    { from, to: from }, { from: { lat: Infinity, lon: 0 }, to },
    { from: { lat: 40.7, lon: 200 }, to }, { from: { lat: '40.7', lon: -74 }, to },
    { from, to, when: 'not a date' }, { from: null, to }
  ]) await t.test(JSON.stringify(options), async () => {
    const h = harness();
    await assert.rejects(h.core.plan(options), { code: 'INVALID_INPUT' });
    assert.equal(h.calls.length, 0);
  });
});

test('network failure and HTTP failures have friendly messages', async t => {
  const h = harness({ fetcher: async () => { throw new TypeError('Failed to fetch'); } });
  await assert.rejects(h.core.plan({ from, to }), error => error.code === 'NETWORK_ERROR' && /connection/.test(error.message));
  for (const status of [400, 429, 503]) await t.test(String(status), async () => {
    const http = harness({ fetcher: async () => response(null, status) });
    await assert.rejects(http.core.plan({ from, to }), error => error.code === 'API_ERROR' && error.message.length > 20);
  });
});

test('already-aborted requests make no network call', async () => {
  const h = harness();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(h.core.plan({ from, to }, controller.signal), { name: 'AbortError' });
  assert.equal(h.calls.length, 0);
});

function pendingFetch(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });
}

test('abort during a request is preserved and request timeout is cleared', async () => {
  const h = harness({ controlledTimers: true, fetcher: pendingFetch });
  const controller = new AbortController();
  const pending = h.core.plan({ from, to }, controller.signal);
  const check = assert.rejects(pending, { name: 'AbortError' });
  controller.abort();
  await check;
  assert.equal(h.pending.size, 0);
});

test('25-second timeout aborts the underlying fetch and becomes a TIMEOUT error', async () => {
  const h = harness({ controlledTimers: true, fetcher: pendingFetch });
  const pending = h.core.plan({ from, to });
  const check = assert.rejects(pending, { code: 'TIMEOUT' });
  assert.equal([...h.pending.values()][0].ms, 25000);
  h.runTimeouts();
  await check;
  assert.equal(h.calls[0].options.signal.aborted, true);
  assert.equal(h.pending.size, 0);
});
