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
    const m = r.match(/^(ICE|IC|EC|RE|RB|EN|NJ|TGV|RJ|FLX)\s*\d/) || r.match(/^(ICE|IC|EC|RJ)\b/);
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
    return Object.keys(params)
      .filter(k => params[k] !== undefined && params[k] !== null && params[k] !== "")
      .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
      .join("&");
  }

  async function get(path, params, timeout) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout || 14000);
    try {
      const r = await fetch(BASE + path + "?" + qs(params), { signal: c.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
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
  async function departures(stopId, n) {
    const d = await get("/stoptimes", { stopId: stopId, n: n || 8 });
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
      };
    }).filter(x => x.when).sort((a, b) => a.when - b.when);
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
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeout || 14000);
    try {
      const r = await fetch(CH_BASE + path + "?" + qs(params), { signal: c.signal });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
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
  async function chDepartures(station, n) {
    const d = await chGet("/stationboard", { station: station, limit: n || 12 });
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
    cityBoard, chBoard, chDepartures, chStops, nearbyStops, departures, board, findStation, familyOf,
                          FAMILIES, MODE_GROUP, MODE_LABEL, BASE };
})();
