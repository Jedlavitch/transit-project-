/**
 * San Francisco (511.org) live-positions "helper" — a Cloudflare Worker.
 *
 * Muni and Caltrain real-time positions come from the Bay Area's 511.org
 * GTFS-Realtime API, which needs an API key AND sends no CORS headers — so
 * a browser on GitHub Pages can't call it directly, and the key shouldn't
 * live in the page anyway. This Worker holds your key server-side and
 * re-serves the binary protobuf with CORS added; decoding happens
 * client-side in sanfrancisco.html.
 *
 * SETUP (one time):
 *   1. Get a free API key: https://511.org/open-data/token
 *   2. https://workers.cloudflare.com -> paste this file -> Deploy.
 *   3. In the Worker's Settings -> Variables and Secrets, add a SECRET named
 *      API_KEY with your 511 key.
 *   4. Copy the Worker URL into the SF board's settings (gear icon ->
 *      "Optional: live Muni + Caltrain positions").
 *
 * RATE LIMIT: 511 allows 60 requests/hour per key by default. The Worker
 * caches each feed for 55s so all viewers share ~2 upstream calls/minute
 * worst case; sanfrancisco.html polls every 2 minutes to stay well inside
 * the quota even with cache misses.
 */

const AGENCY = { muni: "SF", caltrain: "CT" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (!env.API_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "set the API_KEY secret (a free 511.org key) in this Worker's settings" }),
        { status: 500, headers: { "Content-Type": "application/json", ...CORS } });
    }
    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/+/, "");
    const agency = AGENCY[route];
    if (!agency) {
      return new Response(JSON.stringify({ ok: false, error: "unknown route", routes: Object.keys(AGENCY) }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS } });
    }
    try {
      const upstream = `https://api.511.org/transit/vehiclepositions?api_key=${env.API_KEY}&agency=${agency}`;
      const res = await fetch(upstream, { cf: { cacheTtl: 55, cacheEverything: true } });
      if (!res.ok) throw new Error("upstream " + res.status);
      const buf = await res.arrayBuffer();
      return new Response(buf, {
        status: 200,
        headers: { "Content-Type": "application/x-protobuf", "Cache-Control": "no-store", ...CORS },
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e) }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS } });
    }
  },
};
