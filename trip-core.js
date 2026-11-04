/* Transit Board journey adapter: browser-only, dependency-free.
 * API: MOTIS v6 plan + v1 geocode, https://github.com/motis-project/motis/blob/master/openapi.yaml
 * TB_CONFIG.journeyApi can point to a compatible MOTIS instance or a same-origin proxy.
 * The default community Transitous instance is for noncommercial open-source apps
 * and light prototype testing. Publish contact details, Transitous source attribution,
 * and OpenStreetMap attribution; see https://transitous.org/api/ before wider use.
 * Requests happen only when the caller asks; there is no polling or key dependency.
 */
(function (global) {
  'use strict';

  var TIMEOUT_MS = 25000;
  var NON_TRANSIT = new Set(['WALK', 'BIKE', 'CAR', 'HGV', 'CAR_PARKING', 'CAR_DROPOFF', 'BIKE_SHARING', 'SCOOTER_SHARING']);

  function fail(code, message) {
    var error = new Error(message);
    error.code = code;
    return error;
  }

  function str(value, limit) {
    return typeof value === 'string' ? value.trim().slice(0, limit || 500) : '';
  }

  function coords(value) {
    if (!value || typeof value !== 'object') return null;
    var lat = value.lat;
    var lon = value.lon;
    return typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) &&
      lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat: lat, lon: lon } : null;
  }

  function timestamp(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    var time = Date.parse(value);
    return Number.isFinite(time) ? time : null;
  }

  function endpoint(path) {
    var cfg = global.TB_CONFIG || {};
    var configured = str(cfg.journeyApi, 2000) || 'https://api.transitous.org';
    // Accept an origin, /api base, or a full versioned endpoint in config.
    configured = configured.replace(/\/+$/, '').replace(/\/api\/v\d+\/(?:plan|geocode)$/, '').replace(/\/api$/, '');
    var url;
    try { url = new URL(configured + path, global.location && global.location.href || 'http://localhost/'); }
    catch (_) { throw fail('INVALID_CONFIG', 'The journey service URL is invalid.'); }
    if (!['https:', 'http:'].includes(url.protocol)) throw fail('INVALID_CONFIG', 'The journey service must use HTTP or HTTPS.');
    return url;
  }

  function abortError() {
    return typeof DOMException === 'function' ? new DOMException('The request was cancelled.', 'AbortError') : Object.assign(new Error('The request was cancelled.'), { name: 'AbortError' });
  }

  async function request(url, signal) {
    if (signal && signal.aborted) throw abortError();
    var controller = new AbortController();
    var timedOut = false;
    var onAbort = function () { controller.abort(); };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    var timer = setTimeout(function () { timedOut = true; controller.abort(); }, TIMEOUT_MS);
    try {
      var response = await global.fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
        credentials: 'omit',
        // Browser Referer identifies the app to Transitous. Do not set User-Agent.
        referrerPolicy: 'strict-origin-when-cross-origin'
      });
      if (!response.ok) {
        var message = response.status === 429 ? 'The journey service is busy. Please wait a moment and try again.' :
          response.status >= 500 ? 'The journey service is temporarily unavailable. Please try again.' :
          'The journey service could not plan that request. Try different places or a different time.';
        throw fail('API_ERROR', message);
      }
      try { return await response.json(); }
      catch (error) {
        if (controller.signal.aborted) throw error;
        throw fail('API_ERROR', 'The journey service returned an unreadable response. Please try again.');
      }
    } catch (error) {
      if (signal && signal.aborted) throw abortError();
      if (timedOut) throw fail('TIMEOUT', 'The journey search took too long. Please try again.');
      if (error.name === 'AbortError' || error.code) throw error;
      throw fail('NETWORK_ERROR', 'Could not reach the journey service. Check your connection and try again.');
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }

  function normalizePlace(raw, fallback) {
    if (!raw || typeof raw !== 'object') return null;
    var point = coords(raw);
    if (!point) return null;
    var name = str(raw.name) || str(raw.label) || fallback || 'Stop';
    return {
      id: str(raw.stopId, 2000) || str(raw.id, 2000),
      stopId: str(raw.stopId, 2000),
      label: name,
      lat: point.lat,
      lon: point.lon,
      arrival: timestamp(raw.arrival),
      departure: timestamp(raw.departure),
      scheduledArrival: timestamp(raw.scheduledArrival),
      scheduledDeparture: timestamp(raw.scheduledDeparture),
      platform: str(raw.track, 100) || str(raw.scheduledTrack, 100),
      cancelled: raw.cancelled === true,
      pickupAllowed: raw.pickupType !== 'NOT_ALLOWED',
      dropoffAllowed: raw.dropoffType !== 'NOT_ALLOWED',
      tz: str(raw.tz, 100)
    };
  }

  function normalizeLeg(raw, index, fromInput, toInput, lastIndex) {
    if (!raw || typeof raw !== 'object') return null;
    var start = timestamp(raw.startTime);
    var end = timestamp(raw.endTime);
    if (start === null || end === null || end < start) return null;
    var from = normalizePlace(raw.from);
    var to = normalizePlace(raw.to);
    if (!from || !to) return null;
    // MOTIS labels coordinate endpoints START/END; use the selected human name.
    if (index === 0 && ['START', ''].includes(str(raw.from.name))) from.label = str(fromInput.label) || str(fromInput.name) || 'Starting point';
    if (index === lastIndex && ['END', ''].includes(str(raw.to.name))) to.label = str(toInput.label) || str(toInput.name) || 'Destination';
    var mode = str(raw.mode, 50).toUpperCase();
    if (!mode) return null;
    var isTransit = !NON_TRANSIT.has(mode);
    var intermediates = Array.isArray(raw.intermediateStops) ? raw.intermediateStops.map(function (s) { return normalizePlace(s); }).filter(Boolean) : [];
    var allStops = isTransit ? [from].concat(intermediates, [to]) : [];
    var route = str(raw.displayName, 100) || str(raw.routeShortName, 100) || str(raw.routeLongName, 200) || str(raw.tripShortName, 100);
    return {
      mode: mode,
      isTransit: isTransit,
      route: route || (mode === 'WALK' ? 'Walk' : mode.replace(/_/g, ' ').toLowerCase()),
      headsign: str(raw.headsign) || (isTransit ? to.label : ''),
      from: from,
      to: to,
      start: start,
      end: end,
      duration: (end - start) / 60000,
      scheduledStart: timestamp(raw.scheduledStartTime),
      scheduledEnd: timestamp(raw.scheduledEndTime),
      realTime: raw.realTime === true,
      cancelled: raw.cancelled === true || (isTransit && (from.cancelled || to.cancelled || !from.pickupAllowed || !to.dropoffAllowed)),
      stops: allStops,
      platform: from.platform,
      tripId: str(raw.tripId, 2000),
      routeId: str(raw.routeId, 2000),
      routeColor: /^[\da-f]{6}$/i.test(str(raw.routeColor)) ? '#' + str(raw.routeColor) : '',
      agency: str(raw.agencyName, 200),
      distance: typeof raw.distance === 'number' && Number.isFinite(raw.distance) && raw.distance >= 0 ? raw.distance : null,
      interlineWithPreviousLeg: raw.interlineWithPreviousLeg === true,
      geometry: raw.legGeometry && typeof raw.legGeometry.points === 'string' ? {
        points: raw.legGeometry.points,
        precision: Number.isInteger(raw.legGeometry.precision) ? raw.legGeometry.precision : 6
      } : null
    };
  }

  function normalizeItinerary(raw, index, fromInput, toInput) {
    if (!raw || !Array.isArray(raw.legs) || !raw.legs.length) return null;
    var legs = raw.legs.map(function (leg, i) { return normalizeLeg(leg, i, fromInput, toInput, raw.legs.length - 1); });
    if (legs.some(function (leg) { return !leg; })) return null;
    var start = timestamp(raw.startTime);
    var end = timestamp(raw.endTime);
    if (start === null || end === null || end < start || start > legs[0].start || end < legs[legs.length - 1].end) return null;
    for (var i = 1; i < legs.length; i++) {
      if (legs[i].start < legs[i - 1].end) return null;
    }
    var changes = legs.filter(function (leg) { return leg.isTransit && !leg.interlineWithPreviousLeg; }).length;
    return {
      id: str(raw.id, 20000) || 'journey-' + start + '-' + index,
      start: start,
      end: end,
      duration: (end - start) / 60000,
      walkMinutes: legs.reduce(function (sum, leg) { return sum + (leg.mode === 'WALK' ? leg.duration : 0); }, 0),
      transfers: Number.isInteger(raw.transfers) && raw.transfers >= 0 ? raw.transfers : Math.max(0, changes - 1),
      realTime: legs.some(function (leg) { return leg.realTime; }),
      cancelled: legs.some(function (leg) { return leg.cancelled; }),
      legs: legs,
      fetchedAt: Date.now()
    };
  }

  async function geocode(text, bias, signal) {
    var query = str(text, 250);
    if (query.length < 2) return [];
    var url = endpoint('/api/v1/geocode');
    url.searchParams.set('text', query);
    url.searchParams.set('numResults', '6');
    url.searchParams.set('language', 'en');
    var point = coords(bias);
    if (point) url.searchParams.set('place', point.lat + ',' + point.lon);
    var data = await request(url, signal);
    if (!Array.isArray(data)) throw fail('API_ERROR', 'The place search returned an unexpected response. Please try again.');
    return data.map(function (match) {
      var position = coords(match);
      if (!position || !str(match.name)) return null;
      var areas = Array.isArray(match.areas) ? match.areas.filter(function (area) { return area && (area.default || area.unique); }).map(function (area) { return str(area.name); }).filter(Boolean) : [];
      return {
        id: str(match.id, 2000) || position.lat + ',' + position.lon,
        label: str(match.name),
        detail: Array.from(new Set(areas)).join(', ') || str(match.country, 50),
        lat: position.lat,
        lon: position.lon,
        type: str(match.type, 50),
        stopId: match.type === 'STOP' ? str(match.id, 2000) : '',
        tz: str(match.tz, 100)
      };
    }).filter(Boolean);
  }

  async function plan(options, signal) {
    options = options || {};
    var from = coords(options.from);
    var to = coords(options.to);
    if (!from || !to) throw fail('INVALID_INPUT', 'Select a starting point and destination from the search results.');
    if (Math.abs(from.lat - to.lat) < 0.000001 && Math.abs(from.lon - to.lon) < 0.000001) throw fail('INVALID_INPUT', 'Choose a destination different from your starting point.');
    var when = options.when === undefined || options.when === null || options.when === '' ? new Date() : new Date(options.when);
    if (!Number.isFinite(when.getTime())) throw fail('INVALID_INPUT', 'Choose a valid departure or arrival time.');
    var url = endpoint('/api/v6/plan');
    // Selected station IDs connect directly to the transit graph, including
    // stations whose coordinate cannot be reached through the walking graph.
    // Ordinary addresses and board locations continue to use coordinates.
    url.searchParams.set('fromPlace', str(options.from.stopId, 2000) || from.lat + ',' + from.lon);
    url.searchParams.set('toPlace', str(options.to.stopId, 2000) || to.lat + ',' + to.lon);
    url.searchParams.set('time', when.toISOString());
    url.searchParams.set('arriveBy', options.arriveBy === true ? 'true' : 'false');
    url.searchParams.set('numItineraries', '4');
    url.searchParams.set('maxItineraries', '4');
    url.searchParams.set('transitModes', 'TRANSIT');
    url.searchParams.set('directModes', 'WALK');
    var data = await request(url, signal);
    if (!data || typeof data !== 'object' || !Array.isArray(data.itineraries) || !Array.isArray(data.direct)) throw fail('API_ERROR', 'The journey service returned an unexpected response. Please try again.');
    var raw = data.itineraries.concat(data.direct);
    var journeys = raw.map(function (journey, i) { return normalizeItinerary(journey, i, options.from, options.to); }).filter(Boolean);
    if (raw.length && !journeys.length) throw fail('API_ERROR', 'The journey service returned incomplete route details. Please try again.');
    if (!journeys.length) throw fail('NO_RESULTS', 'No journeys were found for those places and that time. Try another time or nearby stop.');
    // Avoid duplicate direct/itinerary entries without discarding different trips.
    var seen = new Set();
    return journeys.filter(function (journey) {
      var key = [journey.start, journey.end].concat(journey.legs.map(function (leg) { return leg.mode + ':' + leg.tripId + ':' + leg.from.id + ':' + leg.to.id; })).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort(function (a, b) { return a.end - b.end || b.start - a.start || a.transfers - b.transfers; });
  }

  global.TBTripCore = Object.freeze({ geocode: geocode, plan: plan });
})(window);
