/**
 * SEPTA "helper" — a Cloudflare Worker.
 *
 * A browser on GitHub Pages cannot call SEPTA's live APIs directly: they
 * return real JSON with real data, but with NO CORS headers, so the browser
 * blocks the response. This tiny Worker fetches them server-side and
 * re-serves the exact same JSON with CORS added — no decoding needed (unlike
 * MARC's protobuf feed), so this is a plain passthrough. Free tier, always
 * on, never sleeps.
 *
 * Deploy: https://workers.cloudflare.com  ->  paste this whole file  ->  Deploy.
 * Then copy your Worker URL (e.g. https://septa.<you>.workers.dev) into the
 * board's settings (gear icon -> SEPTA helper URL).
 *
 * Routes (all GET, no params needed except /arrivals):
 *   /trainview    -> live Regional Rail train positions (system-wide)
 *   /transitview  -> live bus/trolley positions (system-wide)
 *   /arrivals?station=NAME  -> next arrivals at a named Regional Rail station
 *
 * No API key required. No dependencies.
 */

const UPSTREAM = {
  trainview:   "https://www3.septa.org/api/TrainView/index.php",
  transitview: "https://www3.septa.org/api/TransitView/index.php",
  arrivals:    "https://www3.septa.org/api/Arrivals/index.php",
};

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/+/, "");
    const upstream = UPSTREAM[route];
    if (!upstream) {
      return json({ ok: false, error: "unknown route", routes: Object.keys(UPSTREAM) }, 404);
    }
    try {
      let target = upstream;
      if (route === "arrivals") {
        const station = url.searchParams.get("station") || "";
        const results = url.searchParams.get("results") || "5";
        target += `?station=${encodeURIComponent(station)}&results=${encodeURIComponent(results)}`;
      }
      const res = await fetch(target, { cf: { cacheTtl: 10, cacheEverything: true } });
      if (!res.ok) throw new Error("upstream " + res.status);
      const body = await res.text();
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
      });
    } catch (e) {
      return json({ ok: false, error: String(e) }, 502);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });
}
