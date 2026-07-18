/**
 * MTA Bus "helper" — a Cloudflare Worker.
 *
 * A browser on GitHub Pages cannot call MTA's live bus feed directly: it
 * returns real GTFS-Realtime data, but with NO CORS headers, so the browser
 * blocks the response (confirmed via curl -- unlike subway/LIRR/Metro-North,
 * which are all directly fetchable with no Worker needed at all). This tiny
 * Worker fetches it server-side and re-serves the exact same bytes with CORS
 * added -- no decoding here, that happens client-side in nyc.html reusing
 * the same GTFS-Realtime decoder already built for subway/LIRR/Metro-North.
 *
 * IMPORTANT: unlike septa-worker.js (which passes through plain JSON via
 * res.text()), this feed is binary protobuf -- it MUST be re-served via
 * res.arrayBuffer(), not res.text(), or the bytes get corrupted by UTF-8
 * (re-)encoding and won't decode on the other end.
 *
 * Deploy: https://workers.cloudflare.com  ->  paste this whole file  ->  Deploy.
 * Then copy your Worker URL (e.g. https://mta-bus.<you>.workers.dev) into the
 * NYC board's settings (gear icon -> "Optional: exact live MTA Bus positions").
 *
 * No API key required. No dependencies.
 */

const UPSTREAM = {
  vehiclePositions: "https://gtfsrt.prod.obanyc.com/vehiclePositions",
  tripUpdates:       "https://gtfsrt.prod.obanyc.com/tripUpdates",
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
      const res = await fetch(upstream, { cf: { cacheTtl: 10, cacheEverything: true } });
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
