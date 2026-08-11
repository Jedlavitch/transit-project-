/* ============================================================================
   adsb-worker.js — a CORS shim for a commercially-usable aircraft feed.

   WHY THIS EXISTS
   airplanes.live is free and CORS-open, which is why the boards use it — but its
   terms PROHIBIT COMMERCIAL USE, so it can't ship in a product you sell.

   The obvious replacements are adsb.lol and adsb.fi: community ADS-B feeds, free,
   same readsb/tar1090 response shape, and adsb.lol publishes under the Open
   Database Licence, which does permit commercial use provided you attribute and
   share alike. (Confirm the current terms yourself before charging — licences
   change and I can't warrant them.)

   The catch, measured rather than assumed: both answer HTTP 200 with real data
   but send NO Access-Control-Allow-Origin header at all, so a static page can
   never fetch them directly. Exactly the wall MARC and SEPTA hit. This Worker is
   the same fix septa-worker.js was — fetch server-side, re-serve with CORS.

   ROUTES  (mirrors the shape the app already calls)
     GET /v2/point/<lat>/<lon>/<radiusNm>    → { ac: [...] }
     GET /health                             → { ok, upstream }

   SETUP
     1. Workers → create from the Hello World template, then Edit Code and paste
        this in (pasting at creation time sometimes gets flagged).
     2. Deploy. Optionally set a variable UPSTREAM to switch provider:
          https://api.adsb.lol/v2   (default)   or   https://opendata.adsb.fi/api/v2
     3. Paste the Worker URL into the app: ⚙︎ → Aircraft feed URL.
        Leave it empty and everything keeps using airplanes.live, which is
        correct while the project is non-commercial.

   Attribution is not optional under ODbL: credit adsb.lol wherever the data is
   displayed. The app does this for you once a URL is configured.
   ============================================================================ */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type",
};
/* Serve the last good answer when upstream refuses.

   adsb.lol rate-limits per IP and Cloudflare Workers egress from a SHARED pool,
   so this Worker gets 429s a laptop does not — measured: direct 200 with 44
   aircraft, through here "upstream 429" three times running. Returning an empty
   list on that blanks the sky on every board and in Sky mode, which reads as the
   product being slow rather than the feed being throttled.

   Aircraft a minute old beat no aircraft, so the last success is replayed and
   flagged `stale` with its age, letting the board say so instead of implying
   live. Ten minutes is the ceiling: past that, positions are too old to draw
   honestly even dead-reckoned. */
async function serveStale(cache, key, why, trim) {
  const hit = await cache.match(key);
  if (!hit) return json({ ok: false, error: why, ac: [] }, 502);
  let saved;
  try { saved = await hit.json(); } catch (e) { return json({ ok: false, error: why, ac: [] }, 502); }
  const ageMs = Date.now() - (saved.at || 0);
  if (ageMs > 600000) return json({ ok: false, error: why + " (stale expired)", ac: [] }, 502);
  return json({ ac: trim(saved.ac || []), stale: true,
                ageSec: Math.round(ageMs / 1000), error: why }, 200,
              { "cache-control": "no-store" });
}

const json = (o, status = 200, extra = {}) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json", ...CORS, ...extra },
  });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const upstream = (env.UPSTREAM || "https://api.adsb.lol/v2").replace(/\/+$/, "");
    if (url.pathname === "/health") return json({ ok: true, upstream });

    const m = url.pathname.match(/^\/v2\/point\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
    if (!m) return json({ ok: false, error: "expected /v2/point/<lat>/<lon>/<radius>" }, 404);

    /* Clamp the radius rather than passing it through: this Worker is public
       once deployed, and an unbounded radius turns it into a way to hammer a
       volunteer-run feed on your account's quota. */
    const radius = Math.min(250, Math.max(1, parseFloat(m[3])));

    /* SNAP THE QUERY TO A GRID. This is what makes the cache actually work.
       Every customer types their own address, so asking upstream for their exact
       coordinates gives every one of them a unique cache key and the edge cache
       never hits — N customers cost N upstream calls, which is the economics
       that makes a paid feed unaffordable and abuses a free one.

       Rounding to GRID° puts everyone in a metro area on the SAME key, so a
       whole city costs one upstream request per TTL however many boards are
       running. The query is then widened by the worst-case snap offset so a
       board sitting at the corner of a cell still gets its full radius covered.

       0.1° is ~11km of latitude, so the worst offset is half the diagonal,
       ~4.4nm. Widen by 5 to be safe. */
    const GRID = 0.1, SNAP_PAD_NM = 5;
    const snap = v => (Math.round(parseFloat(v) / GRID) * GRID).toFixed(1);
    const qLat = snap(m[1]), qLon = snap(m[2]);
    const qRadius = Math.min(250, radius + SNAP_PAD_NM);

    /* Keyed on the GRID cell, not the caller, so every board in a metro area
       shares one banked copy. */
    const cache = caches.default;
    const stableKey = new Request(
      "https://adsb-cache.internal/" + qLat + "/" + qLon + "/" + qRadius);

    /* The trim is per-caller, so what gets banked is the RAW upstream list and
       this re-centres it — for a live answer and a replayed one alike. */
    const tLat = parseFloat(m[1]), tLon = parseFloat(m[2]);
    const nmBetween = (la, lo) => {
      const dLat = (la - tLat) * 60;
      const dLon = (lo - tLon) * 60 * Math.cos(tLat * Math.PI / 180);
      return Math.hypot(dLat, dLon);
    };
    const trim = list => {
      const out = [];
      for (const a of list) {
        if (typeof a.lat !== "number" || typeof a.lon !== "number") continue;
        const nm = nmBetween(a.lat, a.lon);
        if (nm > radius) continue;
        out.push({ ...a, dst: Math.round(nm * 100) / 100 });
      }
      return out;
    };

    try {
      const r = await fetch(`${upstream}/point/${qLat}/${qLon}/${qRadius}`, {
        headers: { accept: "application/json", "user-agent": "transit-board/1.0" },
        /* 15s matches the boards' own poll interval: a shorter TTL just buys
           upstream calls nobody sees, a longer one shows stale aircraft. */
        cf: { cacheTtl: 15, cacheEverything: true },
      });
      if (!r.ok) return await serveStale(cache, stableKey, "upstream " + r.status, trim);
      const d = await r.json();
      /* adsb.fi answers with `aircraft`, adsb.lol with `ac`. Normalise to `ac`
         so the app doesn't need to know which provider is behind this. */
      const raw = d.ac || d.aircraft || [];
      /* Bank the raw list for the next caller in this cell to fall back on. */
      ctx.waitUntil(cache.put(stableKey, new Response(
        JSON.stringify({ at: Date.now(), ac: raw }),
        { headers: { "content-type": "application/json", "cache-control": "max-age=600" } })));

      return json({ ac: trim(raw), source: upstream, grid: [qLat, qLon, qRadius] }, 200,
                  { "cache-control": "no-store" });
    } catch (e) {
      return await serveStale(cache, stableKey, "upstream unreachable", trim);
    }
  },
};
