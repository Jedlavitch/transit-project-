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
const json = (o, status = 200, extra = {}) =>
  new Response(JSON.stringify(o), {
    status,
    headers: { "content-type": "application/json", ...CORS, ...extra },
  });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const upstream = (env.UPSTREAM || "https://api.adsb.lol/v2").replace(/\/+$/, "");
    if (url.pathname === "/health") return json({ ok: true, upstream });

    const m = url.pathname.match(/^\/v2\/point\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)$/);
    if (!m) return json({ ok: false, error: "expected /v2/point/<lat>/<lon>/<radius>" }, 404);

    /* Clamp the radius rather than passing it through: this Worker is public
       once deployed, and an unbounded radius turns it into a way to hammer a
       volunteer-run feed on your account's quota. */
    const [, lat, lon] = m;
    const radius = Math.min(250, Math.max(1, parseFloat(m[3])));

    try {
      const r = await fetch(`${upstream}/point/${lat}/${lon}/${radius}`, {
        headers: { accept: "application/json", "user-agent": "transit-board/1.0" },
        /* Edge-cache briefly: several boards and phones asking for the same
           patch of sky should cost the upstream one request, not twenty. */
        cf: { cacheTtl: 5, cacheEverything: true },
      });
      if (!r.ok) return json({ ok: false, error: "upstream " + r.status, ac: [] }, 502);
      const d = await r.json();
      /* adsb.fi answers with `aircraft`, adsb.lol with `ac`. Normalise to `ac`
         so the app doesn't need to know which provider is behind this. */
      const ac = d.ac || d.aircraft || [];
      return json({ ac, source: upstream }, 200, { "cache-control": "public, max-age=5" });
    } catch (e) {
      return json({ ok: false, error: "upstream unreachable", ac: [] }, 502);
    }
  },
};
