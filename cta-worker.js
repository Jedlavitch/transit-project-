/**
 * Chicago (CTA) live data — a Cloudflare Worker.
 *
 * CTA's Train Tracker and Bus Tracker APIs both need a key and neither sends a
 * CORS header, so a board on GitHub Pages cannot call them, and the keys should
 * not sit in a public page anyway. This Worker holds the keys, asks CTA, and
 * returns small JSON with CORS added. Times come back as epoch milliseconds:
 * CTA writes Chicago wall-clock time with no offset, and that is converted here
 * once rather than on every screen.
 *
 * SETUP (one time):
 *   1. Free keys, one per API:
 *        Train Tracker: https://www.transitchicago.com/developers/traintrackerapply/
 *        Bus Tracker:   https://www.ctabustracker.com/home  (sign in -> Developer API)
 *   2. Cloudflare dashboard -> Workers & Pages -> Create -> paste this whole
 *      file -> Deploy.
 *   3. Settings -> Variables and Secrets: add SECRETS named CTA_TRAIN_KEY and
 *      CTA_BUS_KEY. Either can be left out; its routes then answer 503 and the
 *      board keeps the timetable for that half.
 *   4. Put the Worker URL in config.js as `chicagoLiveUrl`, or for one screen
 *      only, localStorage `transitboardchicago.liveUrl`.
 *   Check it with /health, which calls both APIs once.
 *
 * Routes (all GET):
 *   /trains
 *       Every 'L' train with a GPS fix, all eight lines in one CTA call.
 *       -> { at, trains: [{ id, line, dest, lat, lon, heading, next, nextAt, approaching, delayed }] }
 *   /arrivals?mapid=40380,40560          (up to 4 stations; one CTA call each)
 *       -> { at, arrivals: [{ stationId, station, stopId, stopDesc, run, line, dest,
 *                             at, scheduledOnly, approaching, delayed, fault }] }
 *   /buses?rt=22,36,151                  (up to 10 routes, one CTA call)
 *       -> { at, buses: [{ id, route, dest, lat, lon, heading, delayed, ts }] }
 *   /bus-predictions?stpid=1066,1067     (up to 10 stops, one CTA call)
 *       -> { at, predictions: [{ stopId, stop, route, dir, dest, vehicle, at, due, delayed }] }
 *   /health
 *
 * QUOTA. Bus Tracker keys carry a daily request cap. Every upstream call is
 * cached at the edge (cacheTtl below), and the query is normalised (sorted,
 * de-duplicated) so two screens asking for the same routes in a different
 * order share one call.
 */

const TRAIN_BASE = "https://lapi.transitchicago.com/api/1.0/";
const BUS_BASE = "https://www.ctabustracker.com/bustime/api/v2/";

/* Train Tracker's route codes, which are not the names riders use. */
const TT_LINES = { Red: "Red", Blue: "Blue", Brn: "Brown", G: "Green", Org: "Orange", P: "Purple", Pink: "Pink", Y: "Yellow" };
const TT_ROUTES = Object.keys(TT_LINES).join(",");

const TTL = { trains: 15, arrivals: 20, buses: 20, predictions: 25 };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};
const json = (o, status = 200) => new Response(JSON.stringify(o), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
});

/* ---- Chicago wall clock -> epoch ms ----------------------------------------
   "2026-11-22T21:05:16" (Train Tracker) or "20261122 21:05" (Bus Tracker), both
   in Chicago time. Read the digits as if UTC, then subtract the zone's offset at
   that moment, found by formatting the guess back out in America/Chicago. Twice,
   so an instant on the far side of a DST change settles on the right offset. */
const CHI = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Chicago", hourCycle: "h23",
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
});
function chiOffsetMs(utcMs) {
  const p = {};
  CHI.formatToParts(new Date(utcMs)).forEach(x => { p[x.type] = x.value; });
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - utcMs;
}
function chiMs(s) {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ""));
  if (!m) return null;
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let t = wall - chiOffsetMs(wall);
  t = wall - chiOffsetMs(t);
  return t;
}

/* CTA's JSON is converted from XML, so a list of one arrives as a bare object. */
const list = x => (x == null ? [] : Array.isArray(x) ? x : [x]);
const num = x => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };
const flag = x => x === "1" || x === 1 || x === true || x === "true";
function idList(raw, max, pattern) {
  return [...new Set(String(raw || "").split(",").map(s => s.trim()).filter(s => pattern.test(s)))]
    .sort().slice(0, max);
}

async function upstream(url, ttl) {
  const r = await fetch(url, { cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!r.ok) throw new Error("CTA answered " + r.status);
  return r.json();
}

/* Train Tracker reports trouble in-band: errCd "0" is success. */
function ttBody(d) {
  const c = d && d.ctatt;
  if (!c) throw new Error("unexpected Train Tracker response");
  if (String(c.errCd) !== "0") throw new Error("Train Tracker: " + (c.errNm || c.errCd));
  return c;
}
/* Bus Tracker does the same, and "No data found" just means nothing is running. */
function btBody(d) {
  const b = d && d["bustime-response"];
  if (!b) throw new Error("unexpected Bus Tracker response");
  const errs = list(b.error).map(e => e.msg || "").filter(Boolean);
  const real = errs.filter(m => !/no data found|no service scheduled|no arrival times/i.test(m));
  if (real.length && !b.vehicle && !b.prd) throw new Error("Bus Tracker: " + real[0]);
  return b;
}

async function trains(env) {
  const c = ttBody(await upstream(`${TRAIN_BASE}ttpositions.aspx?key=${env.CTA_TRAIN_KEY}&rt=${TT_ROUTES}&outputType=JSON`, TTL.trains));
  const out = [];
  list(c.route).forEach(r => {
    const code = Object.keys(TT_LINES).find(k => k.toLowerCase() === String(r["@name"] || "").toLowerCase());
    list(r.train).forEach(t => {
      const lat = num(t.lat), lon = num(t.lon);
      if (lat == null || lon == null || (lat === 0 && lon === 0)) return;   // a train between fixes reports 0,0
      out.push({
        id: String(t.rn), line: TT_LINES[code] || r["@name"], dest: t.destNm || "",
        lat, lon, heading: num(t.heading),
        next: t.nextStaNm || "", nextAt: chiMs(t.arrT),
        approaching: flag(t.isApp), delayed: flag(t.isDly),
      });
    });
  });
  return { at: chiMs(c.tmst) || Date.now(), trains: out };
}

async function arrivals(env, mapids) {
  const bodies = await Promise.all(mapids.map(id =>
    upstream(`${TRAIN_BASE}ttarrivals.aspx?key=${env.CTA_TRAIN_KEY}&mapid=${id}&max=20&outputType=JSON`, TTL.arrivals)
      .then(ttBody)));
  const out = [];
  bodies.forEach(c => list(c.eta).forEach(e => out.push({
    stationId: String(e.staId), station: e.staNm || "", stopId: String(e.stpId), stopDesc: e.stpDe || "",
    run: String(e.rn), line: TT_LINES[e.rt] || e.rt, dest: e.destNm || "",
    at: chiMs(e.arrT), scheduledOnly: flag(e.isSch), approaching: flag(e.isApp),
    delayed: flag(e.isDly), fault: flag(e.isFlt),
  })));
  out.sort((a, b) => a.at - b.at);
  return { at: Date.now(), arrivals: out };
}

async function buses(env, routes) {
  const b = btBody(await upstream(`${BUS_BASE}getvehicles?key=${env.CTA_BUS_KEY}&rt=${routes.join(",")}&format=json`, TTL.buses));
  const out = list(b.vehicle).map(v => ({
    id: String(v.vid), route: String(v.rt), dest: v.des || "",
    lat: num(v.lat), lon: num(v.lon), heading: num(v.hdg),
    delayed: flag(v.dly), ts: chiMs(v.tmstmp),
  })).filter(v => v.lat != null && v.lon != null);
  return { at: Date.now(), buses: out };
}

async function busPredictions(env, stops) {
  const b = btBody(await upstream(`${BUS_BASE}getpredictions?key=${env.CTA_BUS_KEY}&stpid=${stops.join(",")}&top=40&format=json`, TTL.predictions));
  const out = list(b.prd).map(p => ({
    stopId: String(p.stpid), stop: p.stpnm || "", route: String(p.rt), dir: p.rtdir || "",
    dest: p.des || "", vehicle: String(p.vid || ""), at: chiMs(p.prdtm),
    due: String(p.prdctdn || "").toUpperCase() === "DUE", delayed: flag(p.dly),
  })).filter(p => p.at);
  out.sort((a, b) => a.at - b.at);
  return { at: Date.now(), predictions: out };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const needTrain = () => env.CTA_TRAIN_KEY ? null : json({ ok: false, error: "set the CTA_TRAIN_KEY secret in this Worker's settings" }, 503);
    const needBus = () => env.CTA_BUS_KEY ? null : json({ ok: false, error: "set the CTA_BUS_KEY secret in this Worker's settings" }, 503);
    try {
      if (path === "/trains") return needTrain() || json(await trains(env));
      if (path === "/arrivals") {
        const ids = idList(url.searchParams.get("mapid"), 4, /^4\d{4}$/);
        if (!ids.length) return json({ ok: false, error: "mapid=4xxxx (an 'L' station id), up to 4" }, 400);
        return needTrain() || json(await arrivals(env, ids));
      }
      if (path === "/buses") {
        const rts = idList(url.searchParams.get("rt"), 10, /^[A-Za-z0-9]{1,5}$/);
        if (!rts.length) return json({ ok: false, error: "rt=22,36,... up to 10 routes" }, 400);
        return needBus() || json(await buses(env, rts));
      }
      if (path === "/bus-predictions") {
        const ids = idList(url.searchParams.get("stpid"), 10, /^\d{1,6}$/);
        if (!ids.length) return json({ ok: false, error: "stpid=1066,... up to 10 stops" }, 400);
        return needBus() || json(await busPredictions(env, ids));
      }
      if (path === "/health") {
        const r = { ok: true, trainKey: !!env.CTA_TRAIN_KEY, busKey: !!env.CTA_BUS_KEY };
        if (env.CTA_TRAIN_KEY) {
          try { r.trains = (await trains(env)).trains.length; } catch (e) { r.ok = false; r.trainError = String(e.message || e); }
        }
        if (env.CTA_BUS_KEY) {
          try { r.buses = (await buses(env, ["22"])).buses.length; } catch (e) { r.ok = false; r.busError = String(e.message || e); }
        }
        return json(r);
      }
      return json({ ok: false, error: "unknown route", routes: ["/trains", "/arrivals", "/buses", "/bus-predictions", "/health"] }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 502);
    }
  },
};
