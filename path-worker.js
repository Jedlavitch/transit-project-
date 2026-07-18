/**
 * PATH "helper" — a Cloudflare Worker.
 *
 * A browser on GitHub Pages cannot call PATH's live arrivals feed directly:
 * it returns real JSON with real data, but with NO CORS headers, so the
 * browser blocks the response. This tiny Worker fetches it server-side and
 * re-serves the exact same JSON with CORS added -- no decoding needed (this
 * feed is already plain JSON, unlike subway/LIRR/Metro-North/MTA Bus's
 * binary GTFS-Realtime protobuf), so this is a plain passthrough, same
 * pattern as septa-worker.js. Free tier, always on, never sleeps.
 *
 * Note: PATH's live data is STATION-based next-arrival countdowns, not
 * vehicle positions -- there's no "where is this train right now" to place
 * on a map with. nyc.html only uses this Worker (when configured) to
 * upgrade the departures CARD to real live countdowns; the map always uses
 * the bundled schedule's interpolation (see gen-path-schedule.py), live or
 * not.
 *
 * Deploy: https://workers.cloudflare.com  ->  paste this whole file  ->  Deploy.
 * Then copy your Worker URL (e.g. https://path.<you>.workers.dev) into the
 * NYC board's settings (gear icon -> "Optional: exact live PATH arrivals").
 *
 * No API key required. No dependencies.
 */

const UPSTREAM = "https://www.panynj.gov/bin/portauthority/ridepath.json";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    try {
      const res = await fetch(UPSTREAM, { cf: { cacheTtl: 10, cacheEverything: true } });
      if (!res.ok) throw new Error("upstream " + res.status);
      const body = await res.text();
      return new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
      });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String(e) }),
        { status: 502, headers: { "Content-Type": "application/json", ...CORS } });
    }
  },
};
