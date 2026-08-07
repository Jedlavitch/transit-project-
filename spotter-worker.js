/* ============================================================================
   spotter-worker.js — OPTIONAL shared sightings feed (Cloudflare Worker)

   Without this, the Spotter app is a private log on one phone (zero setup).
   With it, several people's sightings pool into one feed that every board shows
   — how a household or a group of friends share one board.

   DEPLOY (same two-step as the other workers, because Cloudflare blocks pasting
   large code at creation time):
     1. Workers & Pages → Create → "Hello World" → name it "tb-spotter" → Deploy
     2. Open it → Edit Code → paste THIS file → Deploy
     3. KV → Create namespace "TB_SPOTS"; Worker → Settings → Bindings →
        KV namespace: variable name SPOTS, namespace TB_SPOTS
     4. Optional Settings → Variables:
          FEED_SECRET  — if set, posting requires ?s=THAT_VALUE (keeps a public
                         URL from being writable by strangers)
          MAX_FEED     — how many sightings to keep, default 200
     5. Paste the worker URL into the app: ⚙︎ → Shared feed URL, AND into each
        board that should show the feed: Spotted card → ⇄ button. A board only
        picks it up on its own when it is the same browser on the same device
        that logged the sighting — which is not the case this worker is for.

   ROUTES
     POST /log[?s=SECRET]   body = one sighting object from the app
     GET  /feed?limit=40    → { ok:true, spots:[…] } newest first
     GET  /health           → { ok:true }
   ============================================================================ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...CORS } });

const clip = (v, n) => (typeof v === "string" ? v.slice(0, n) : "");
const KEY = "feed";

// Only keep fields the board renders, all length-capped: a public write endpoint
// must never store arbitrary caller-supplied data.
function clean(b) {
  const mode = ["plane", "train", "bus"].includes(b.mode) ? b.mode : "bus";
  const route = clip(b.route, 40).trim();
  if (!route) return null;
  const ts = Number(b.ts);
  return {
    id: clip(b.id, 32) || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
    ts: Number.isFinite(ts) && ts > 1e12 && ts < Date.now() + 864e5 ? ts : Date.now(),
    mode, route,
    vehicle: clip(b.vehicle, 30).trim(),
    place: clip(b.place, 60).trim(),
    note: clip(b.note, 140).trim(),
    by: clip(b.by, 24).trim(),
    ridden: !!b.ridden,
    lat: typeof b.lat === "number" ? +b.lat.toFixed(3) : null,
    lon: typeof b.lon === "number" ? +b.lon.toFixed(3) : null,
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/health") return json({ ok: true });

    if (url.pathname === "/feed") {
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") || "40", 10)));
      const raw = await env.SPOTS.get(KEY);
      const spots = raw ? JSON.parse(raw) : [];
      return json({ ok: true, spots: spots.slice(0, limit) });
    }

    if (url.pathname === "/log" && req.method === "POST") {
      if (env.FEED_SECRET && url.searchParams.get("s") !== env.FEED_SECRET)
        return json({ ok: false, error: "forbidden" }, 403);

      // light abuse brake: max 30 posts per IP per minute
      const ip = req.headers.get("cf-connecting-ip") || "anon";
      const bucket = "rl:" + ip + ":" + Math.floor(Date.now() / 60000);
      const n = parseInt((await env.SPOTS.get(bucket)) || "0", 10) + 1;
      if (n > 30) return json({ ok: false, error: "rate_limited" }, 429);
      await env.SPOTS.put(bucket, String(n), { expirationTtl: 120 });

      let body;
      try { body = await req.json(); } catch (_) { return json({ ok: false, error: "bad_json" }, 400); }
      const spot = clean(body || {});
      if (!spot) return json({ ok: false, error: "missing_route" }, 400);

      const max = Math.min(500, parseInt(env.MAX_FEED || "200", 10));
      const raw = await env.SPOTS.get(KEY);
      let spots = raw ? JSON.parse(raw) : [];
      spots = spots.filter(s => s.id !== spot.id);        // idempotent re-posts (offline queue retries)
      spots.unshift(spot);
      await env.SPOTS.put(KEY, JSON.stringify(spots.slice(0, max)));
      return json({ ok: true, stored: spot.id });
    }

    return json({ ok: false, error: "not_found" }, 404);
  },
};
