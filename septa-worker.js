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
 *   /alerts       -> system-wide service alerts/advisories/detours
 *   /tripupdates?feed=bus|rail -> SEPTA's GTFS-Realtime TripUpdates, passed
 *                    through as binary protobuf (the board decodes it). This is
 *                    the only SEPTA feed that marks a run CANCELLED and gives a
 *                    predicted time at each stop; TrainView/TransitView give
 *                    positions and lateness only. Boards on an older copy of
 *                    this Worker get a 404 here and simply carry on without it.
 *
 * No API key required. No dependencies.
 */

const UPSTREAM = {
  trainview:   "https://www3.septa.org/api/TrainView/index.php",
  transitview: "https://www3.septa.org/api/TransitView/index.php",
  arrivals:    "https://www3.septa.org/api/Arrivals/index.php",
  alerts:      "https://www3.septa.org/api/Alerts/index.php?req1=all",
};
const TRIP_UPDATES = {
  bus:  "https://www3.septa.org/gtfsrt/septa-pa-us/Trip/rtTripUpdates.pb",
  rail: "https://www3.septa.org/gtfsrt/septarail-pa-us/Trip/rtTripUpdates.pb",
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
    if (route === "tripupdates") {
      const feed = TRIP_UPDATES[url.searchParams.get("feed") || "bus"];
      if (!feed) return json({ ok: false, error: "feed must be bus or rail" }, 400);
      try {
        const res = await fetch(feed, { cf: { cacheTtl: 10, cacheEverything: true } });
        if (!res.ok) throw new Error("upstream " + res.status);
        return new Response(await res.arrayBuffer(), {
          status: 200,
          headers: { "Content-Type": "application/x-protobuf", "Cache-Control": "no-store", ...CORS },
        });
      } catch (e) {
        return json({ ok: false, error: String(e) }, 502);
      }
    }
    const upstream = UPSTREAM[route];
    if (!upstream) {
      return json({ ok: false, error: "unknown route", routes: Object.keys(UPSTREAM).concat("tripupdates") }, 404);
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
