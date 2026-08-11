/* ============================================================================
   transitous.js — departures for the European boards (Zurich, Cologne, Stuttgart).

   One source for all three: api.transitous.org, a community-run MOTIS instance
   that aggregates Europe's public GTFS and GTFS-Realtime feeds. Free, no
   account, no key, and it answers `access-control-allow-origin: *`, so the
   boards call it straight from the browser — no Worker, and no bundled
   timetable to generate or ship.

   That is a real departure from how the US cities work. Those either need a
   per-agency key (WMATA), a Worker to add CORS (SEPTA, MTA Bus), or a
   multi-megabyte GTFS bundle committed to the repo (MARC, Ride On, SEPTA,
   PATCO, NJT). Here one endpoint covers three cities in two countries, live.

   VERIFIED BEFORE BUILDING ON IT (2026-08):
     - Köln Hbf departures come back with realTime:true — genuine live delays.
     - Zurich is covered but its Swiss feed answers realTime:false, so those are
       scheduled times. Said plainly on the board rather than implied to be live.
     - reverse-geocode returns stops near any coordinate, which is what lets the
       boards follow the address picked in settings like every other city.

   API SHAPE (v1)
     GET /api/v1/reverse-geocode?place=<lat>,<lon>&type=STOP   -> nearby stops
     GET /api/v1/stoptimes?stopId=<id>&n=<count>               -> departures
   ============================================================================ */
(function () {
  "use strict";

  const BASE = "https://api.transitous.org/api/v1";

  /* MOTIS returns modes at GTFS route-type granularity. The boards think in
     three families, because that is what a person glancing at a wall display
     cares about — is that a train, a tram, or a bus. */
  const MODE_GROUP = {
    HIGHSPEED_RAIL: "rail", LONG_DISTANCE: "rail", NIGHT_RAIL: "rail",
    REGIONAL_FAST_RAIL: "rail", REGIONAL_RAIL: "rail", SUBURBAN: "rail",
    METRO: "metro", SUBWAY: "metro",
    TRAM: "tram", COACH: "bus", BUS: "bus", FERRY: "ferry",
    RAIL: "rail", OTHER: "bus",
  };
  const MODE_LABEL = {
    HIGHSPEED_RAIL: "ICE", LONG_DISTANCE: "IC", NIGHT_RAIL: "Night",
    REGIONAL_FAST_RAIL: "RE", REGIONAL_RAIL: "RB", SUBURBAN: "S-Bahn",
    METRO: "U-Bahn", SUBWAY: "U-Bahn", TRAM: "Tram", BUS: "Bus",
    COACH: "Coach", FERRY: "Ferry",
    // some services arrive with no usable mode; "Train" beats showing "OTHER"
    OTHER: "Train", RAIL: "Train",
  };

  /* The feed's mode is coarser than the line name. Cologne's S19 comes back as
     SUBWAY and would be captioned "U-Bahn", which is simply wrong to a local —
     S is the S-Bahn, U is the U-Bahn, and they are different networks. Where the
     line name carries its own category, trust that over the mode. */
  function labelFor(mode, route) {
    const r = cleanRoute(route).toUpperCase();
    if (/^S\d/.test(r)) return "S-Bahn";
    if (/^U\d/.test(r)) return "U-Bahn";
    /* \d, not \b: German regional lines are "RE7" and "RB27", where the digit
       follows the letters with no word boundary between them — so the old \b
       never matched and every one of them was captioned "RB", including the RE
       services. Long-distance "IC"/"ICE" can stand alone, hence the second arm. */
    /* The second arm is for categories that stand alone with no number. It has
       to carry the international ones too: "TGV" fell through both arms and was
       captioned from its MODE instead, which is HIGHSPEED_RAIL — so every TGV
       out of Zurich was labelled "ICE". */
    const m = r.match(/^(ICE|IC|EC|RE|RB|EN|NJ|TGV|RJ|FLX)\s*\d/) ||
              r.match(/^(ICE|IC|EC|RJX|RJ|TGV|EST|THA|NJ|EN)\b/);
    if (m) return m[1];
    return MODE_LABEL[mode] || mode;
  }

  /* German feeds append the train number: "RB27 (12345)". That is operational
     detail, and on a badge clipped to six characters it reads as a broken
     string — "RB27 (". The line is what a passenger looks for. */
  function cleanRoute(route) {
    const r = String(route || "").replace(/\s*\([^)]*\)\s*/g, " ").replace(/\s+/g, " ").trim();
    // the feed sends a literal "?" when it has no line name; that is not a line
    return (r === "?" || r === "-") ? "" : r;
  }

  /* Which card a departure belongs on.
     Line name first, mode second, and that order matters: Zurich's S-Bahn comes
     through as METRO and Stuttgart's U-Bahn as SUBWAY, so trusting the mode
     would file a Swiss S2 under "U-Bahn" and a Stuttgart U6 under regional
     rail. The letter on the front of the line is what a local reads. */
  const FAMILIES = ["longdistance", "regional", "metro", "tram", "bus", "ferry"];
  function familyOf(mode, route) {
    const r = cleanRoute(route).toUpperCase();
    if (/^S\d/.test(r)) return "regional";                       // S-Bahn
    if (/^U\d/.test(r)) return "metro";                          // U-Bahn
    if (/^(ICE|IC|EC|TGV|RJ|EN|NJ|FLX)\s*\d/.test(r) || /^(ICE|IC|EC|RJ)$/.test(r)) return "longdistance";
    if (/^(RE|RB|IR)\s*\d/.test(r)) return "regional";           // RE/RB, Swiss InterRegio
    switch (mode) {
      case "HIGHSPEED_RAIL": case "LONG_DISTANCE": case "NIGHT_RAIL": return "longdistance";
      case "REGIONAL_RAIL": case "REGIONAL_FAST_RAIL": case "SUBURBAN": return "regional";
      case "METRO": case "SUBWAY": return "metro";
      case "TRAM": return "tram";
      case "FERRY": return "ferry";
      default: return "bus";
    }
  }

  function qs(params) {
    const out = [];
    Object.keys(params).forEach(k => {
      const v = params[k];
      if (v === undefined || v === null || v === "") return;
      // the Swiss API filters by repeating transportations[] once per mode
      (Array.isArray(v) ? v : [v]).forEach(x =>
        out.push(encodeURIComponent(k) + "=" + encodeURIComponent(x)));
    });
    return out.join("&");
  }

  /* ---- one gate in front of each endpoint ---------------------------------
     These are free public APIs and they rate-limit. A cold European board asks
     transitous for a trip per departure — Zurich alone wants around 35 — and
     the fan-outs doing the asking are spread across four Promise.all sites in
     this file plus the per-family lookup in every city board. Limiting them one
     at a time does not hold: intlBoard fires fourteen at once by itself, and a
     429 costs every vehicle on the map rather than just the surplus.

     So the limit goes in front of the transport, where every call has to pass
     it whatever route it arrived by, including any added later. A queued call
     starts its timeout when it actually begins rather than burning it waiting.

     Separate gates per host: the Swiss endpoint has its own budget and should
     not be starved by a burst of transitous trip lookups. */
  function gate(max) {
    let inFlight = 0;
    const waiting = [];
    return async function run(job) {
      if (inFlight >= max) await new Promise(res => waiting.push(res));
      else inFlight++;
      try { return await job(); }
      finally {
        const next = waiting.shift();
        if (next) next(); else inFlight--;    // hand the slot on, or give it back
      }
    };
  }
  const tousGate = gate(4);
  const chGate = gate(4);

  async function get(path, params, timeout) {
    return tousGate(async () => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), timeout || 14000);
      try {
        const r = await fetch(BASE + path + "?" + qs(params), { signal: c.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } finally { clearTimeout(t); }
    });
  }

  /* Stops near a point, nearest first.
     MOTIS returns several ids for what a passenger thinks of as one stop (a
     tram island and the station hall opposite each get their own), so results
     are collapsed by name — otherwise the card shows "Hauptbahnhof" five times
     and nothing else fits. */
  async function nearbyStops(lat, lon, limit) {
    const raw = await get("/reverse-geocode", { place: lat + "," + lon, type: "STOP" });
    const seen = new Set(), out = [];
    (Array.isArray(raw) ? raw : []).forEach(s => {
      if (!s || !s.name || s.type !== "STOP") return;
      const key = String(s.name).toLowerCase().replace(/\s+/g, " ").trim();
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ id: s.id, name: s.name, lat: s.lat, lon: s.lon, country: s.country || "" });
    });
    return out.slice(0, limit || 6);
  }

  /* Departures from one stop.
     `realTime` is passed through untouched rather than assumed: Germany's feeds
     report live delays, Switzerland's through this API do not, and a board that
     says "live" over a timetable guess is worse than one that admits it. */
  function mapStopTimes(d) {
    return (d && Array.isArray(d.stopTimes) ? d.stopTimes : []).map(t => {
      const mode = t.mode || "OTHER";
      const sched = t.place && (t.place.scheduledDeparture || t.place.scheduledArrival);
      const real = t.place && (t.place.departure || t.place.arrival);
      const schedMs = sched ? Date.parse(sched) : null;
      const realMs = real ? Date.parse(real) : null;
      return {
        mode,
        group: MODE_GROUP[mode] || "bus",
        family: familyOf(mode, t.routeShortName || t.tripShortName),
        // the human-facing line number ("S1", "U6", "17"), when the feed has one
        route: cleanRoute(t.routeShortName || t.tripShortName),
        label: labelFor(mode, t.routeShortName || t.tripShortName),
        headsign: (t.headsign || "").trim(),
        when: realMs || schedMs,
        scheduled: schedMs,
        // only a real minutes-late figure, never a made-up zero
        delayMin: (t.realTime && schedMs && realMs) ? Math.round((realMs - schedMs) / 60000) : null,
        realTime: !!t.realTime,
        cancelled: !!t.cancelled,
        platform: (t.place && (t.place.track || t.place.scheduledTrack)) || "",
        tripId: t.tripId || "",          // needed to locate the vehicle (see nearestVehicle)
        /* Where this train STARTED and where it ENDS, each carrying its own
           IANA zone. That zone is what tells the international card a train is
           leaving the country — see isInternational(). Kept as the raw objects
           because the name is worth showing and the coordinates worth drawing. */
        tripFrom: t.tripFrom || null,
        tripTo: t.tripTo || null,
        /* Only set when the caller asked for `both`: a row the train ARRIVES on
           rather than leaves on. Those are the services already underway, which
           is what puts a moving train on the map — a departure an hour out has
           not started yet and has no position worth drawing. */
        arrival: !!(t.place && !t.place.departure && t.place.arrival),
      };
    }).filter(x => x.when).sort((a, b) => a.when - b.when);
  }
  async function departures(stopId, n) {
    return mapStopTimes(await get("/stoptimes", { stopId: stopId, n: n || 8 }));
  }

  /* Everything a board needs for one render: the nearest few stops, each with
     its next departures. Stops are fetched in parallel — sequentially, six
     stops meant six round trips and a card that filled in visibly late. */
  /* Find a named station once and remember it. Reverse-geocoding the city
     centre returns the tram islands OUTSIDE the main station, not the station
     itself — which is where every train is. Zurich looked like a city with no
     railway at all until this was added: buses and trams only, no S-Bahn, no
     ICE to Cologne. */
  const stationCache = {};
  async function findStation(name) {
    if (!name) return null;
    if (stationCache[name] !== undefined) return stationCache[name];
    try {
      const g = await get("/geocode", { text: name });
      const hit = (Array.isArray(g) ? g : []).find(x => x && x.type === "STOP");
      stationCache[name] = hit ? { id: hit.id, name: hit.name, lat: hit.lat, lon: hit.lon } : null;
    } catch (_) { stationCache[name] = null; }
    return stationCache[name];
  }

  async function board(lat, lon, opts) {
    const o = opts || {};
    let stops = await nearbyStops(lat, lon, o.stops || 4);
    if (o.mainStation) {
      const st = await findStation(o.mainStation);
      if (st && !stops.some(x => x.id === st.id)) stops = [st].concat(stops).slice(0, (o.stops || 4) + 1);
    }
    const withDeps = await Promise.all(stops.map(async s => {
      try { return Object.assign({}, s, { deps: await departures(s.id, o.perStop || 12) }); }
      catch (_) { return Object.assign({}, s, { deps: [] }); }
    }));
    return withDeps.filter(s => s.deps.length);
  }

  /* ---- Switzerland: transport.opendata.ch --------------------------------
     transitous carries Swiss data but serves it as a timetable — realTime is
     false on every Swiss departure. The Swiss national API reports an actual
     delay for 24 of 25 departures at Zurich HB, and not only for trains: the
     trams and buses outside the station carry one too. Since the ask was live
     data for everything, Zurich uses this and transitous is the fallback.
     Free, no key, `Access-Control-Allow-Origin: *` (verified). */
  const CH_BASE = "https://transport.opendata.ch/v1";
  const CH_FAMILY = { S:"regional", SN:"regional", R:"regional", RE:"regional", IR:"regional",
                      IC:"longdistance", ICE:"longdistance", EC:"longdistance", TGV:"longdistance",
                      RJ:"longdistance", RJX:"longdistance", NJ:"longdistance", EN:"longdistance",
                      T:"tram", B:"bus", BUS:"bus", NFB:"bus", BAT:"ferry", FUN:"metro", GB:"metro" };
  const CH_LABEL = { S:"S-Bahn", SN:"Night S", R:"Regio", RE:"RegioExpress", IR:"InterRegio",
                     IC:"InterCity", ICE:"ICE", EC:"EuroCity", TGV:"TGV", RJ:"Railjet",
                     RJX:"Railjet", NJ:"Nightjet", EN:"EuroNight", T:"Tram", B:"Bus",
                     BAT:"Boat", FUN:"Funicular", GB:"Cable car" };

  async function chGet(path, params, timeout) {
    return chGate(async () => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), timeout || 14000);
      try {
        const r = await fetch(CH_BASE + path + "?" + qs(params), { signal: c.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } finally { clearTimeout(t); }
    });
  }
  /* Their coordinate object is {x: latitude, y: longitude} — x is NOT longitude,
     which is the obvious reading and puts every stop in the wrong hemisphere. */
  async function chStops(lat, lon, limit) {
    const d = await chGet("/locations", { x: lat, y: lon, type: "station" });
    return (d.stations || [])
      .filter(s => s.id && s.name && s.coordinate && s.coordinate.x)
      .slice(0, limit || 5)
      .map(s => ({ id: s.id, name: s.name, lat: s.coordinate.x, lon: s.coordinate.y }));
  }
  function chRows(d) {
    return (d.stationboard || []).map(x => {
      const cat = String(x.category || "").toUpperCase();
      const stop = x.stop || {};
      const schedMs = stop.departure ? Date.parse(stop.departure) : null;
      const delay = (typeof stop.delay === "number") ? stop.delay : null;
      return {
        mode: cat, group: CH_FAMILY[cat] === "bus" ? "bus" : "rail",
        family: CH_FAMILY[cat] || "bus",
        /* The number arrives zero-padded ("0001"), so a naive cat+number gives
           "ICE0001" on the badge. Trains read "ICE 1"; a tram, bus or boat is
           known by its number alone, the way it is written on the front. */
        route: (function(){
          const num = String(x.number || "").replace(/^0+/, "");
          if (cat === "T" || cat === "B" || cat === "BAT" || cat === "NFB") return num || cat;
          return (cat + (num ? " " + num : "")).trim();
        })(),
        label: CH_LABEL[cat] || cat,
        headsign: x.to || "",
        when: schedMs != null && delay != null ? schedMs + delay * 60000 : schedMs,
        scheduled: schedMs,
        delayMin: delay,
        realTime: delay != null,        // a delay figure IS the live signal here
        cancelled: false,
        platform: stop.platform || "",
      };
    }).filter(x => x.when).sort((a, b) => a.when - b.when);
  }
  async function chDepartures(station, n) {
    return chRows(await chGet("/stationboard", { station: station, limit: n || 12 }));
  }
  async function chBoard(lat, lon, opts) {
    const o = opts || {};
    let stops = await chStops(lat, lon, o.stops || 4);
    if (o.mainStation && !stops.some(s => s.name === o.mainStation))
      stops = [{ id: o.mainStation, name: o.mainStation, lat: lat, lon: lon }].concat(stops).slice(0, (o.stops || 4) + 1);
    const withDeps = await Promise.all(stops.map(async s => {
      try { return Object.assign({}, s, { deps: await chDepartures(s.id, o.perStop || 12) }); }
      catch (_) { return Object.assign({}, s, { deps: [] }); }
    }));
    return withDeps.filter(s => s.deps.length);
  }

  /* The next long-distance trains, however far out they are.
     Mixed in with the locals they were being crowded out: at a big station the
     next fourteen departures can be fourteen trams, so the card sat empty and
     hid itself between ICEs. Both APIs filter by mode server-side, so this asks
     for long-distance only rather than fetching more and discarding — verified
     on Köln Hbf (ten ICEs: Rostock, Hamburg, Frankfurt) and Zurich HB (IC5, IC8,
     IC81). The Swiss filter occasionally lets an S-Bahn through, so the family
     check still runs client-side. */
  async function longDistanceAt(stationName, n) {
    if (!stationName) return [];
    try {
      /* Always the Europe-wide source here, even for Zurich, because its mode
         filter actually works. The Swiss API's transportations[] parameter is
         accepted and then ignored — asking it for ICE/IC only still returns a
         list of S-Bahn and InterRegio (verified: 17 rows back, 16 of them
         neither). Zurich keeps the Swiss feed for its local departures, where
         that feed is the one with live delays; this one query goes elsewhere. */
      const st = await findStation(stationName);
      if (!st) return [];
      const d = await get("/stoptimes", { stopId: st.id, n: n || 8,
        mode: "HIGHSPEED_RAIL,LONG_DISTANCE,NIGHT_RAIL" });
      return mapStopTimes(d).filter(x => x.family === "longdistance");
    } catch (_) { return []; }
  }

  /* ---- where a vehicle is right now ---------------------------------------
     These feeds report DEPARTURES, not vehicle positions — there is no lat/lon
     for a moving tram anywhere in them. But a trip carries its whole stop
     sequence with coordinates and times, so a position can be interpolated
     between the two stops the clock puts it between. That is the same technique
     this project already uses for MARC and Ride On, which have no live feed
     either; it is a schedule-derived position and is labelled as one, not
     passed off as GPS.

     Cost is kept to a handful of small calls: candidate trips come from stops
     that are already nearby, and only the first few are looked up. */
  /* The response also carries the route's real geometry, and using it is the
     difference between a train on the track and a train in a field. Straight
     lines between stops cut the corners: on the Köln–Rhein/Main high-speed line
     the chord from Frankfurt Airport to Siegburg misses the actual alignment by
     around twenty kilometres, which on a city map is the wrong side of the
     river. So the polyline is decoded once and the stops are snapped onto it,
     and the train then travels ALONG the line between them.

     Snapping walks forward only — each stop is searched for from where the
     previous one landed — because routes that double back past a station
     (terminal reversals are routine) would otherwise match the earlier pass and
     send the train backwards. On real trips every stop lands within ~120m.

     Geometry is immutable, so a trip is fetched once and kept; only its times
     go stale, and re-fetching the same id refreshes them. Failures are
     remembered briefly too, so one bad id doesn't retry on every tick. */
  const tripCache = {};

  function decodePolyline(str, precision) {
    const factor = Math.pow(10, precision == null ? 5 : precision);
    const out = []; let i = 0, lat = 0, lon = 0;
    while (i < str.length) {
      for (let w = 0; w < 2; w++) {
        let shift = 0, result = 0, b;
        do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
        const d = (result & 1) ? ~(result >> 1) : (result >> 1);
        if (w === 0) lat += d; else lon += d;
      }
      out.push([lat / factor, lon / factor]);
    }
    return out;
  }

  async function tripDetail(tripId, maxAgeMs) {
    if (!tripId) return null;
    const hit = tripCache[tripId];
    const age = maxAgeMs == null ? 180000 : maxAgeMs;
    // a miss is re-tried sooner than a hit is refreshed, but never every tick
    if (hit && (Date.now() - hit.at) < (hit.trip ? age : 60000)) return hit.trip;
    let trip = null;
    try {
      const d = await get("/trip", { tripId: tripId }, 16000);
      const leg = (d.legs || [])[0];
      if (leg) {
        const pts = [];
        if (leg.from && leg.from.lat) pts.push({ name: leg.from.name, lat: leg.from.lat, lon: leg.from.lon,
          tz: leg.from.tz || "", track: leg.from.track || leg.from.scheduledTrack || "",
          sched: Date.parse(leg.from.scheduledDeparture || leg.from.departure || leg.startTime),
          t: Date.parse(leg.from.departure || leg.from.scheduledDeparture || leg.startTime) });
        (leg.intermediateStops || []).forEach(s2 => {
          if (s2.lat) pts.push({ name: s2.name, lat: s2.lat, lon: s2.lon,
            tz: s2.tz || "", track: s2.track || s2.scheduledTrack || "",
            sched: Date.parse(s2.scheduledDeparture || s2.scheduledArrival || s2.departure || s2.arrival),
            t: Date.parse(s2.departure || s2.arrival || s2.scheduledDeparture || s2.scheduledArrival) });
        });
        if (leg.to && leg.to.lat) pts.push({ name: leg.to.name, lat: leg.to.lat, lon: leg.to.lon,
          tz: leg.to.tz || "", track: leg.to.track || leg.to.scheduledTrack || "",
          sched: Date.parse(leg.to.scheduledArrival || leg.to.arrival || leg.endTime),
          t: Date.parse(leg.to.arrival || leg.to.scheduledArrival || leg.endTime) });
        const stops = pts.filter(x => x.t);
        if (stops.length >= 2) {
          trip = { id: tripId,          // callers key map markers off this
                   stops, from: stops[0], to: stops[stops.length - 1],
                   start: stops[0].t, end: stops[stops.length - 1].t,
                   route: cleanRoute(leg.routeShortName || leg.tripShortName),
                   label: labelFor(leg.mode || "OTHER", leg.routeShortName || leg.tripShortName),
                   mode: leg.mode || "OTHER", agency: leg.agencyName || "",
                   realTime: !!leg.realTime,
                   delayMin: (leg.realTime && stops[0].sched) ? Math.round((stops[0].t - stops[0].sched) / 60000) : null };
          const g = leg.legGeometry;
          if (g && g.points) {
            const line = decodePolyline(g.points, g.precision);
            if (line.length >= 2) {
              const cum = [0];
              for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + kmBetween(
                { lat: line[i - 1][0], lon: line[i - 1][1] }, { lat: line[i][0], lon: line[i][1] }));
              let from = 0;
              stops.forEach(s2 => {
                let best = from, bd = Infinity;
                for (let i = from; i < line.length; i++) {
                  const dd = kmBetween(s2, { lat: line[i][0], lon: line[i][1] });
                  if (dd < bd) { bd = dd; best = i; }
                }
                s2.idx = best; from = best;
              });
              trip.line = line; trip.cum = cum;
            }
          }
        }
      }
    } catch (_) { trip = hit ? hit.trip : null; }
    tripCache[tripId] = { at: Date.now(), trip };
    return trip;
  }

  /* Position between the bracketing stops, plus how far through the run it is.
     Before departure it sits at the origin and after arrival at the destination
     rather than extrapolating off the end of the line.

     With geometry the train follows the track between those two stops; without
     it (a feed that sent no shape) it falls back to the straight line, which is
     the old behaviour and still better than nothing. `bearing` lets a marker
     point the way the route actually runs. */
  function positionOnTrip(trip, at) {
    const now = at || Date.now(), st = trip.stops;
    const pct = (trip.end > trip.start)
      ? Math.max(0, Math.min(100, Math.round(((now - trip.start) / (trip.end - trip.start)) * 100))) : 0;
    if (now <= st[0].t) return withBearing(trip, { lat: st[0].lat, lon: st[0].lon, pct: 0, next: st[1] || st[0], prev: st[0] }, st[0].idx);
    if (now >= st[st.length - 1].t) {
      const last = st[st.length - 1];
      return withBearing(trip, { lat: last.lat, lon: last.lon, pct: 100, next: last, prev: st[st.length - 2] || last }, last.idx);
    }
    for (let i = 0; i < st.length - 1; i++) {
      const a = st[i], b = st[i + 1];
      if (now >= a.t && now <= b.t) {
        const f = (b.t - a.t) > 0 ? (now - a.t) / (b.t - a.t) : 0;
        if (trip.line && a.idx != null && b.idx != null && b.idx > a.idx) {
          // spend the time evenly over DISTANCE along the real alignment
          const target = trip.cum[a.idx] + (trip.cum[b.idx] - trip.cum[a.idx]) * f;
          for (let k = a.idx + 1; k <= b.idx; k++) {
            if (trip.cum[k] >= target) {
              const seg = trip.cum[k] - trip.cum[k - 1];
              const g = seg > 0 ? (target - trip.cum[k - 1]) / seg : 0;
              const p = trip.line[k - 1], q = trip.line[k];
              return withBearing(trip, { lat: p[0] + (q[0] - p[0]) * g, lon: p[1] + (q[1] - p[1]) * g,
                pct: pct, next: b, prev: a }, k - 1);
            }
          }
        }
        return withBearing(trip, { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f,
                 pct: pct, next: b, prev: a }, a.idx);
      }
    }
    return null;
  }

  /* Heading from the two geometry points either side, so the marker faces along
     the track. Longitude is scaled by cos(lat) or every route in Europe reads
     as running more east-west than it does. */
  function withBearing(trip, pos, idx) {
    pos.bearing = 0;
    if (trip.line && idx != null) {
      const p = trip.line[Math.max(0, Math.min(trip.line.length - 2, idx))];
      const q = trip.line[Math.max(1, Math.min(trip.line.length - 1, idx + 1))];
      if (p && q) {
        const dy = q[0] - p[0], dx = (q[1] - p[1]) * Math.cos(pos.lat * Math.PI / 180);
        if (dx || dy) pos.bearing = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
      }
    }
    return pos;
  }

  const R_KM = 6371;
  function kmBetween(a, b) {
    const rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R_KM * Math.asin(Math.sqrt(h));
  }

  /* The nearest vehicle of the requested families, as a moving thing with a
     position. Returns null when nothing is running, which the caller shows as
     "nothing nearby" rather than as an error. */
  async function nearestVehicle(lat, lon, families, opts) {
    const o = opts || {};
    /* Always the Europe-wide source, even for Zurich: locating a vehicle needs
       a trip id to look its stop sequence up by, and the Swiss feed does not
       carry one. Zurich still uses the Swiss feed for its departure cards,
       where that feed is the one with live delays — this is a different job. */
    const stops = await board(lat, lon, { stops: 3, perStop: 10, mainStation: o.mainStation });
    const want = new Set(families);
    const cands = [];
    stops.forEach(s2 => s2.deps.forEach(d => { if (want.has(d.family) && d.tripId) cands.push(d); }));
    if (!cands.length) return null;
    cands.sort((a, b) => a.when - b.when);
    const picked = cands.slice(0, o.lookups || 5);
    const detailed = await Promise.all(picked.map(async d => {
      const trip = await tripDetail(d.tripId);
      if (!trip) return null;
      const pos = positionOnTrip(trip);
      if (!pos) return null;
      return { dep: d, trip, pos, km: kmBetween({ lat: lat, lon: lon }, pos) };
    }));
    const live = detailed.filter(Boolean).sort((a, b) => a.km - b.km);
    return live[0] || null;
  }

  /* ===== INTERNATIONAL TRAINS ==============================================
     Its own card on every European board, with live times, and the trains
     themselves moving on the map.

     WHAT MAKES A TRAIN INTERNATIONAL
     Not the line name. "ICE" is mostly a German domestic service and sometimes
     the one to Brussels; "IC" out of Zurich is usually domestic and sometimes
     the one to Milan. Reading the letters gets both wrong in both directions.

     /stoptimes answers with `tripFrom` and `tripTo` — where the whole train
     starts and ends, not just the leg calling here — and each carries an IANA
     timezone. Europe's zones follow national borders (Europe/Berlin,
     Europe/Brussels, Europe/Paris, Europe/Zurich, Europe/Rome, Europe/Vienna),
     so an end in a different zone from the station you are standing in IS a
     train leaving the country. Verified at Köln Hbf, where it picked out
     Eurostar to Paris-Nord, ICE 122 to Amsterdam, ICE 12 to Bruxelles Midi and
     ICE 201 to Basel SBB while leaving thirty domestic ICEs alone.

     The zone belongs to the AGENCY, though, not the station: Amsterdam, Utrecht
     and Arnhem all come back as Europe/Brussels through operators based there.
     Harmless for deciding "is this abroad" — it still differs from
     Europe/Berlin — but it means the zone must never be PRINTED as a country.
     So the card names the destination station, which is what is written on the
     front of the train anyway, and claims no flag it cannot prove.

     A short category test backs the zones up, for the services that only ever
     run across a border, so one mislabelled feed cannot lose a Nightjet.

     LIVE POSITIONS WITHOUT A FIREHOSE
     MOTIS will stream every vehicle in a bounding box (/map/trips), but a box
     wide enough to reach the Belgian and Dutch borders costs ~630KB a poll and
     is mostly buses this board already has. Each international train is instead
     fetched once by id through tripDetail(), which is ~20KB, cached, and comes
     with the real track geometry. Between fetches the position is recomputed
     from that geometry and those timings, so the marker keeps moving without
     touching the network — a free community service gets one small request per
     train per few minutes rather than half a megabyte every tick.
     ====================================================================== */
  const INTL_MODES = "HIGHSPEED_RAIL,LONG_DISTANCE,NIGHT_RAIL";

  /* Services that exist to cross a border, as a backstop for the zone test.
     Deliberately short: EuroCity, EuroNight, Nightjet, Railjet and
     Eurostar/Thalys are international by definition, while ICE, IC and RE are
     mostly domestic and are left to the zones to judge. */
  const ALWAYS_INTL = /^(EST|THA|TGV|EN|NJ|RJX|EC)\s*\d|^(EST|THA|TGV|NJ|RJX)\b/i;

  /* Two different questions, and conflating them fills the card with the wrong
     trains. An ICE that began in Brussels and runs on to Frankfurt IS an
     international service, and worth drawing as one — but from a platform in
     Cologne it takes you to Frankfurt, and listing it under "International"
     alongside the Eurostar to Paris is the same dilution the card was created
     to fix. Four of Cologne's ten were exactly this.

     So: the CARD asks "does this take me out of the country", which is the
     destination alone. The MAP asks "is this an international train", which
     either end answers. */
  function isInternational(dep, homeTz) {
    const to = dep.tripTo || {}, from = dep.tripFrom || {};
    if (homeTz) {
      if (to.tz && to.tz !== homeTz) return true;      // ends abroad
      if (from.tz && from.tz !== homeTz) return true;  // came from abroad
    }
    return ALWAYS_INTL.test(String(dep.route || ""));
  }
  function isOutbound(dep, homeTz) {
    const to = dep.tripTo || {};
    if (homeTz && to.tz) return to.tz !== homeTz;
    return ALWAYS_INTL.test(String(dep.route || ""));
  }

  /* The same train arrives twice over — once from its own country's feed and
     once from the neighbour's, which is how ICE 122 appears as both "to Arnhem"
     and "to Amsterdam". Collapse on line plus departure minute and keep the
     better copy: live times first, then the one running further, since the
     through destination is the one a passenger is looking for. */
  /* Keyed on the train NUMBER, not the line name, because the two countries
     either end of a cross-border service disagree about the category: the 9570
     to Paris is "ICE 9570" in the German feed and "IC 9570" in the French one,
     so keying on the printed name left both on the card an hour apart from
     nothing. Two digits minimum, so a tram called "7" cannot collide with a
     Nightjet; where there is no number at all the name has to do. */
  function intlNum(r) {
    const num = String(r.route || "").match(/\d{2,}/);
    return num ? "#" + num[0] : (r.route || r.label || "?");
  }
  /* Which of two copies of the same train to keep. */
  function betterCopy(r, cur, homeTz) {
    if (r.realTime !== cur.realTime) return !!r.realTime;
    // equally live: the one still bound for another country, since the other
    // copy usually terminates at the border and reads as a domestic train
    const rAway = !!(r.tripTo && r.tripTo.tz && r.tripTo.tz !== homeTz);
    const cAway = !!(cur.tripTo && cur.tripTo.tz && cur.tripTo.tz !== homeTz);
    if (rAway !== cAway) return rAway;
    // last resort: the copy that says where it is going at all. One feed's TGV
    // row arrives with no destination, which reads on the card as "TGV → —"
    const rEnd = (r.tripTo && r.tripTo.name) || r.headsign || "";
    const cEnd = (cur.tripTo && cur.tripTo.name) || cur.headsign || "";
    if (!cEnd !== !rEnd) return !!rEnd;
    return rEnd.length > cEnd.length;
  }
  /* Matched on a TIME WINDOW rather than an exact minute, because the two
     railways either side of a border publish the same train a minute or two
     apart. Exact-minute keys let both through, and the board showed the 9575
     twice on the card and as two markers a few kilometres apart on the map. Six
     minutes is comfortably wider than that disagreement and far narrower than
     the gap between two genuine runs of one train number. */
  const SAME_TRAIN_MS = 6 * 60000;
  function dedupeIntl(rows, homeTz, windowMs) {
    const out = [], win = windowMs || SAME_TRAIN_MS;
    rows.slice()
      .sort((a, b) => (a.scheduled || a.when) - (b.scheduled || b.when))
      .forEach(r => {
        const key = intlNum(r), t = r.scheduled || r.when;
        let hit = -1;
        for (let i = 0; i < out.length; i++) {
          if (out[i]._key === key && Math.abs((out[i].scheduled || out[i].when) - t) <= win) { hit = i; break; }
        }
        if (hit < 0) { r._key = key; out.push(r); return; }
        if (betterCopy(r, out[hit], homeTz)) { r._key = key; out[hit] = r; }
      });
    /* One more pass, for the copies that carry no shared number to match on:
       one railway files the Zurich-Paris Lyria as the bare category "TGV" and
       the other as "TGV Lyria 9234", so nothing above can tell they are one
       train. Same minute and one name a prefix of the other is enough. The
       longer name wins — it is the one that knows the train runs through to
       Paris rather than stopping at Mulhouse. */
    for (let i = out.length - 1; i >= 0; i--) {
      const a = out[i], ra = String(a.route || "").toUpperCase();
      if (!ra) continue;
      for (let j = 0; j < out.length; j++) {
        if (i === j) continue;
        const b = out[j], rb = String(b.route || "").toUpperCase();
        if (rb.length <= ra.length || rb.indexOf(ra) !== 0) continue;
        if (Math.abs((a.scheduled || a.when) - (b.scheduled || b.when)) > 120000) continue;
        out.splice(i, 1);
        break;
      }
    }
    return out.sort((a, b) => a.when - b.when);
  }

  /* Everything the international card and the map need, in one call.

     Trains already seen are kept until their journey ends, which is what keeps a
     departure on the map as it heads out of the city: /stoptimes only ever looks
     forward, so a train drops off the list the moment it leaves, and without
     this the most interesting marker on the board would vanish exactly when it
     got going. */
  /* Kept per station, not globally: a board that moves — or a second board in
     the same page — would otherwise inherit the other city's trains and draw
     ICEs around Cologne on the map of Zurich. */
  const intlSeen = {};
  async function intlBoard(stationName, opts) {
    const o = opts || {};
    const st = await findStation(stationName);
    if (!st) return { station: null, homeTz: "", departures: [], trains: [] };
    const seen = intlSeen[st.id] || (intlSeen[st.id] = {});

    /* Arrivals as well as departures (`both`), because they are two different
       jobs. The CARD wants departures — what is leaving, and when. The MAP
       wants whatever is moving, and a train that leaves in ninety minutes is
       standing in a siding somewhere with no position worth drawing, while the
       EC in from Milan and the TGV in from Paris are both underway right now.
       Asking for arrivals is what fills the map at a terminus like Zurich,
       where almost every international service STARTS here. */
    let rows = [], arrivals = [], homeTz = "";
    try {
      const d = await get("/stoptimes",
        { stopId: st.id, n: o.n || 60, mode: INTL_MODES, both: true }, 16000);
      homeTz = (d && d.place && d.place.tz) || "";
      const intl = mapStopTimes(d).filter(r => isInternational(r, homeTz));
      /* A departure that cannot say where it is going is dropped rather than
         shown as "TGV → —". It is always a second copy of a train already on
         the card from a better-informed feed — the Lyria to Paris arrives once
         as "TGV" with a destination and again as "TGV Lyria 9234" with none,
         and the two carry different numbers so they survive de-duplication.
         The one that names Paris is the one worth keeping. */
      rows = dedupeIntl(intl.filter(r =>
        !r.arrival && isOutbound(r, homeTz) &&
        ((r.tripTo && r.tripTo.name) || r.headsign)), homeTz);
      /* Everything else international and underway — the ones that arrive here,
         and the ones passing through on their way home — goes to the map only.

         Collapsed on the train number over a much wider window than the card
         uses. The railways either side of a border can be a quarter of an hour
         apart on when the same train is due: the 9575 from Paris is timetabled
         into Stuttgart at 15:26 by DB and 15:14 by SNCF, and at six minutes
         both copies survived and drew two markers for one train. Widening it
         here is safe in a way it would not be on the card, because this list
         only has to identify a train, not tell anyone when to be on a platform,
         and one number does not run twice in an hour. */
      arrivals = dedupeIntl(intl.filter(r => r.arrival || !isOutbound(r, homeTz)), homeTz, 3600000);
    } catch (_) { /* leave whatever is already on screen rather than blanking it */ }

    const want = rows.slice(0, o.trains || 8)
      .concat(arrivals.slice(0, o.arrivals || 6))
      .filter(r => r.tripId);
    await Promise.all(want.map(async r => {
      const trip = await tripDetail(r.tripId, o.tripMaxAgeMs);
      if (trip) { trip.intl = true; seen[r.tripId] = trip; }
    }));

    const now = Date.now();
    Object.keys(seen).forEach(id => {
      const t = seen[id];
      if (!t || now > t.end + 1800000) delete seen[id];   // half an hour past arrival: done
    });
    /* One marker per train, not one per feed. The same service is published by
       the railway either side of the border, and the two copies disagree by a
       minute or so — enough to survive the departure-list de-duplication, which
       keys on the exact minute, and show up as two ICE 9575s a few kilometres
       apart on the map. Grouped here by train number and start time instead:
       copies of one train begin within a few minutes of each other, while two
       genuine runs of the same number are hours apart. The better-informed copy
       wins — live timings first, then the one with real route geometry. */
    const byTrain = {};
    Object.keys(seen).map(id => seen[id])
      .filter(t => t && now >= t.start - 7200000)
      .forEach(t => {
        const num = String(t.route || "").match(/\d{2,}/);
        const key = num ? "#" + num[0] : ("id:" + t.id);
        const slot = key + "@" + Math.round(t.start / 600000);   // ten-minute grain
        const cur = byTrain[slot];
        if (!cur) { byTrain[slot] = t; return; }
        const better = (t.realTime && !cur.realTime) ||
          (t.realTime === cur.realTime && (t.line ? t.line.length : 0) > (cur.line ? cur.line.length : 0));
        if (better) byTrain[slot] = t;
      });
    const trains = Object.keys(byTrain).map(k => byTrain[k]).sort((a, b) => a.start - b.start);

    return { station: st, homeTz,
             departures: rows.map(r => Object.assign({}, r, { trip: seen[r.tripId] || null })),
             arrivals: arrivals.map(r => Object.assign({}, r, { trip: seen[r.tripId] || null })),
             trains };
  }

  /* One entry point for the boards: pick the source that is live where you are. */
  async function cityBoard(lat, lon, opts) {
    const o = opts || {};
    if (o.source === "ch") {
      try {
        const b = await chBoard(lat, lon, o);
        if (b.length) return b;
      } catch (_) { /* fall through to the Europe-wide source */ }
    }
    return board(lat, lon, o);
  }

  window.TBTransitous = {
    cityBoard, chBoard, chDepartures, chStops, longDistanceAt,
    nearestVehicle, tripDetail, positionOnTrip, nearbyStops, departures, board, findStation, familyOf,
    intlBoard, isInternational, isOutbound, decodePolyline, kmBetween,
                          FAMILIES, MODE_GROUP, MODE_LABEL, INTL_MODES, BASE };
})();
