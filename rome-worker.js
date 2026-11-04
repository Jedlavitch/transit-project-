/**
 * Rome live data — a Cloudflare Worker.
 *
 * Neither source below answers a browser: no CORS header on either, Roma
 * Mobilità serves binary protobuf, and ViaggiaTreno only speaks plain HTTP. This
 * fetches them server-side and returns small JSON with CORS added.
 *
 * Deploy: Cloudflare dashboard -> Workers & Pages -> Create -> paste this whole
 * file -> Deploy. Put the URL in config.js as `romeLiveUrl`. No key, no KV, no
 * dependencies. Check it with /health, which fetches both sources.
 *
 * Routes (all GET):
 *   /vehicles?lat=41.9&lon=12.5&km=3&limit=120
 *       Real GPS for ATAC's buses and trams, nearest first. Without lat/lon it
 *       returns the whole fleet, about 150 KB.
 *       -> { at, count, total, vehicles: [{ id, trip, route, lat, lon, bearing, ts }] }
 *   /trains?station=S08409
 *       Trenitalia departures from one station, S08409 being Roma Termini.
 *       -> { at, trains: [{ num, cat, dest, sched, delay, track, moving }] }
 *   /health
 *
 * Sources:
 *   Roma Mobilità open data (GTFS-Realtime). No metro in this feed: the metro
 *   publishes no live data anywhere we could find.
 *   ViaggiaTreno, the API behind Trenitalia's own journey tracker. UNOFFICIAL and
 *   unversioned, so the board treats it as optional and carries on without it.
 */

const VEHICLES_URL = "https://romamobilita.it/wp-content/uploads/shared/rome_rtgtfs_vehicle_positions_feed.pb";
const TRAINS_BASE = "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/partenze/";

// A GPS fix older than this is a parked bus or a dead radio, not a position.
const MAX_FIX_AGE_S = 300;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

/* ---- protobuf, just the wire format ---------------------------------------
   GTFS-Realtime field numbers used below:
     FeedMessage      1 header, 2 entity
     FeedHeader       3 timestamp
     FeedEntity       4 vehicle
     VehiclePosition  1 trip, 2 position, 5 timestamp, 8 vehicle
     TripDescriptor   1 trip_id, 5 route_id
     Position         1 latitude, 2 longitude, 3 bearing (all float)
     VehicleDescriptor 1 id
   Number rather than BigInt for varints: every varint read here is a length or a
   timestamp, none of them negative, all well inside 2^53. */
function walk(buf, start, end, onField) {
  let i = start;
  while (i < end) {
    let key = 0, shift = 1, b;
    do { b = buf[i++]; key += (b & 127) * shift; shift *= 128; } while (b >= 128);
    const no = Math.floor(key / 8), wire = key & 7;
    if (wire === 0) {
      let val = 0; shift = 1;
      do { b = buf[i++]; val += (b & 127) * shift; shift *= 128; } while (b >= 128);
      onField(no, val, 0);
    } else if (wire === 2) {
      let n = 0; shift = 1;
      do { b = buf[i++]; n += (b & 127) * shift; shift *= 128; } while (b >= 128);
      onField(no, i, i + n);
      i += n;
    } else if (wire === 5) { onField(no, i, i + 4); i += 4; }
    else if (wire === 1) { i += 8; }
    else throw new Error("unexpected wire type " + wire);
  }
}
// Ids and route names here are plain ASCII, so no TextDecoder per field.
function text(buf, start, end) {
  let out = "";
  for (let i = start; i < end; i++) out += String.fromCharCode(buf[i]);
  return out;
}

function decodeFeed(buf) {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const float32 = at => view.getFloat32(at, true);
  const out = { at: 0, vehicles: [] };
  walk(buf, 0, buf.length, (no, a, z) => {
    if (no === 1) walk(buf, a, z, (f, x) => { if (f === 3) out.at = x; });
    else if (no === 2) walk(buf, a, z, (f, va, vz) => {
      if (f !== 4) return;
      const v = {};
      walk(buf, va, vz, (n, x, y) => {
        if (n === 1) walk(buf, x, y, (g, p, q) => {
          if (g === 1) v.trip = text(buf, p, q);
          else if (g === 5) v.route = text(buf, p, q);
        });
        else if (n === 2) walk(buf, x, y, (g, p) => {
          if (g === 1) v.lat = float32(p);
          else if (g === 2) v.lon = float32(p);
          else if (g === 3) v.bearing = float32(p);
        });
        else if (n === 5) v.ts = x;
        else if (n === 8) walk(buf, x, y, (g, p, q) => { if (g === 1) v.id = text(buf, p, q); });
      });
      out.vehicles.push(v);
    });
  });
  return out;
}

function kmBetween(aLat, aLon, bLat, bLon) {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/* ---- ViaggiaTreno -------------------------------------------------------
   The URL carries a time written like JavaScript's Date.toString(), in Italian
   local time, so it is built from the Europe/Rome wall clock rather than from
   whatever zone this Worker happens to run in. */
function romeTimestamp(now) {
  const parts = {};
  new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Rome", hourCycle: "h23", year: "numeric", month: "numeric",
    day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" })
    .formatToParts(now).forEach(p => { parts[p.type] = Number(p.value); });
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  const offset = Math.round((wall - Math.floor(now.getTime() / 1000) * 1000) / 60000);
  const d = new Date(wall), p2 = n => String(n).padStart(2, "0");
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${DAYS[d.getUTCDay()]} ${MONTHS[d.getUTCMonth()]} ${p2(d.getUTCDate())} ${d.getUTCFullYear()} ` +
    `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())} ` +
    `GMT${offset < 0 ? "-" : "+"}${p2(Math.floor(Math.abs(offset) / 60))}${p2(Math.abs(offset) % 60)}`;
}

/* `ritardo` is only a measurement once the train has actually set off. Before
   that it is null or a placeholder, which is why `moving` travels with it: a
   train still waiting to start has no delay anyone has observed. */
function shapeTrain(t) {
  return {
    num: t.numeroTreno,
    cat: String(t.categoriaDescrizione || t.categoria || "").trim(),
    dest: t.destinazione || "",
    sched: t.orarioPartenza,
    delay: typeof t.ritardo === "number" ? t.ritardo : null,
    track: t.binarioEffettivoPartenzaDescrizione || t.binarioProgrammatoPartenzaDescrizione || "",
    moving: t.nonPartito === false,
  };
}

async function upstream(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "transit-board-proxy/1", "Accept": "*/*" },
    cf: { cacheTtl: 15, cacheEverything: true },   // many boards asking at once cost one upstream call
  });
  if (!res.ok) throw new Error("upstream " + res.status);
  return res;
}

/* Decoded once per isolate per few seconds. The feed only changes about every
   30s, and Workers' free tier allows very little CPU per request: re-decoding
   1,300 vehicles for every board's every poll is the one thing here that could
   run into that limit. */
const FEED_CACHE_MS = 12000;
let feedCache = null;
async function currentFeed(now) {
  if (feedCache && now.getTime() - feedCache.t < FEED_CACHE_MS) return feedCache.feed;
  const res = await upstream(VEHICLES_URL);
  const feed = decodeFeed(new Uint8Array(await res.arrayBuffer()));
  feedCache = { t: now.getTime(), feed };
  return feed;
}

async function vehicles(params, now) {
  const feed = await currentFeed(now);
  const nowS = now.getTime() / 1000;
  let list = feed.vehicles.filter(v => typeof v.lat === "number" && typeof v.lon === "number" && v.route &&
    (!v.ts || nowS - v.ts <= MAX_FIX_AGE_S));
  const total = list.length;
  const lat = parseFloat(params.get("lat")), lon = parseFloat(params.get("lon"));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const km = Math.min(parseFloat(params.get("km")) || 4, 30);
    list = list.map(v => ({ v, d: kmBetween(lat, lon, v.lat, v.lon) }))
      .filter(x => x.d <= km).sort((a, b) => a.d - b.d).map(x => x.v);
  }
  const limit = parseInt(params.get("limit"), 10);
  if (limit > 0) list = list.slice(0, limit);
  return { at: feed.at, total, count: list.length, vehicles: list.map(v => ({
    id: v.id || v.trip || "", trip: v.trip || "", route: v.route,
    lat: Math.round(v.lat * 1e5) / 1e5, lon: Math.round(v.lon * 1e5) / 1e5,
    bearing: typeof v.bearing === "number" ? Math.round(v.bearing) : null, ts: v.ts || null,
  })) };
}

async function trains(params, now) {
  const station = params.get("station") || "S08409";
  if (!/^S\d{5}$/.test(station)) throw new Error("bad station");
  const res = await upstream(TRAINS_BASE + station + "/" + encodeURIComponent(romeTimestamp(now)));
  const rows = await res.json();
  return { at: Math.floor(now.getTime() / 1000), trains: (Array.isArray(rows) ? rows : []).map(shapeTrain) };
}

function json(obj, status, maxAge) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: {
    "Content-Type": "application/json",
    "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store",
    ...CORS,
  } });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return json({ ok: false, error: "GET only" }, 405);
    const url = new URL(request.url), route = url.pathname.replace(/^\/+|\/+$/g, ""), now = new Date();
    try {
      if (route === "vehicles") return json(await vehicles(url.searchParams, now), 200, 10);
      if (route === "trains") return json(await trains(url.searchParams, now), 200, 20);
      if (route === "health" || route === "") {
        const [v, t] = await Promise.allSettled([vehicles(new URLSearchParams(), now), trains(new URLSearchParams(), now)]);
        return json({
          ok: v.status === "fulfilled" && t.status === "fulfilled",
          vehicles: v.status === "fulfilled" ? { total: v.value.total, feedAgeS: Math.round(now.getTime() / 1000 - v.value.at) } : String(v.reason),
          trains: t.status === "fulfilled" ? { count: t.value.trains.length } : String(t.reason),
        });
      }
      return json({ ok: false, error: "unknown route", routes: ["vehicles", "trains", "health"] }, 404);
    } catch (e) {
      return json({ ok: false, error: String(e && e.message || e) }, 502);
    }
  },
};
