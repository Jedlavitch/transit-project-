/**
 * Amsterdam (OVapi) live-positions "helper" — a Cloudflare Worker.
 *
 * A browser on GitHub Pages cannot read the Dutch national GTFS-Realtime
 * feed directly: gtfs.ovapi.nl serves real vehicle positions but with NO
 * CORS headers (confirmed via curl). This tiny Worker fetches it server-side
 * and re-serves the exact same bytes with CORS added — no decoding here;
 * that happens client-side in amsterdam.html using the same GTFS-Realtime
 * decoder the NYC board built.
 *
 * WHAT YOU GET: the feed's GPS covers the KV6 surface fleet — for Amsterdam
 * that means the GVB TRAMS (verified ~100 live at once). GVB metro, NS
 * trains, and the ferries don't publish GPS here, so those systems stay
 * schedule-interpolated on the board either way.
 *
 * Binary protobuf: must be re-served via res.arrayBuffer(), not res.text()
 * (same gotcha as mta-bus-worker.js).
 *
 * The feed is ~500KB and covers the whole country, so the Worker caches it
 * for 15s — many viewers share one upstream fetch. amsterdam.html polls
 * every 20s and filters to GVB/NS route ids client-side.
 *
 * Deploy: https://workers.cloudflare.com  ->  paste this whole file  ->  Deploy.
 * Then copy your Worker URL (e.g. https://ovapi.<you>.workers.dev) into the
 * Amsterdam board's settings (gear icon -> "Optional: live GVB/NS positions").
 *
 * No API key required. No dependencies.
 */

const UPSTREAM = {
  vehiclePositions: "http://gtfs.ovapi.nl/nl/vehiclePositions.pb",
  tripUpdates:      "http://gtfs.ovapi.nl/nl/tripUpdates.pb",
  alerts:           "http://gtfs.ovapi.nl/nl/alerts.pb",   // KV15 service messages (nationwide; board filters to GVB)
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
    const route = url.pathname.replace(/^\/+/, "") || "vehiclePositions";
    const upstream = UPSTREAM[route];
    if (!upstream) {
      return new Response(JSON.stringify({ ok: false, error: "unknown route", routes: Object.keys(UPSTREAM) }),
        { status: 404, headers: { "Content-Type": "application/json", ...CORS } });
    }
    try {
      const res = await fetch(upstream, {
        headers: { "User-Agent": "transit-board-worker/1.0 (github.com/jedlavitch)" },
        cf: { cacheTtl: 15, cacheEverything: true },
      });
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
