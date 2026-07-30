/* ============================================================================
   njt-worker.js — OPTIONAL live NJ Transit feed (Cloudflare Worker)

   The boards work with ZERO setup without this: NJT's static GTFS is public, so
   rail and the bundled trunk bus routes are already interpolated from schedule.
   This Worker is what unlocks *live* NJT — and, for buses, it's the only way to
   see all 263 routes (a statewide bus timetable is ~17MB of JSON, far too big to
   bundle; see gen-njt-state.py).

   ── WHAT YOU HAVE TO DO YOURSELF (I can't do these for you) ─────────────────
   NJT's live feeds require credentials tied to your own identity and acceptance
   of NJT's developer terms. Creating accounts on your behalf is something I
   won't do, so you register, then paste the values in below.

   1. BUS (works today, standard Clever Devices "BusTime" API):
      Request a BusTime API key from NJ Transit — https://www.njtransit.com/
      developer-resources (ask for MyBus/BusTime API access).
      Confirmed reachable: GET https://mybusnow.njtransit.com/bustime/api/v3/
      getvehicles?rt=126&format=json  currently answers
      {"bustime-response":{"error":[{"msg":"No API access key supplied"}]}} —
      i.e. the endpoint is live and only the key is missing.
      Put the key in the BUSTIME_KEY secret.

   2. RAIL (needs their docs — deliberately left as a stub):
      https://raildata.njtransit.com/api/TrainData/... is real (it answers 204,
      not 404, unauthenticated) but its request/response shape isn't public, so
      RAIL IS NOT IMPLEMENTED HERE ON PURPOSE rather than guessed at. Once you
      register and can see the docs, tell me the endpoint + a sample response
      and I'll finish /rail. Until then the boards keep using the bundled rail
      schedule, which already covers every line in the state.

   ── DEPLOY (two steps; Cloudflare blocks pasting big code at creation time) ──
   1. Workers & Pages → Create → "Hello World" → name it "njt" → Deploy
   2. Open it → Edit Code → paste THIS file → Deploy
   3. Settings → Variables and Secrets:
        BUSTIME_KEY  (secret)  your BusTime API key
   4. Paste the worker URL into the New Jersey board: ⚙︎ → live NJ Transit URL.

   ROUTES
     GET /health                → { ok:true, bus:true|false }
     GET /vehicles?rt=126,25    → { ok:true, vehicles:[{id,rt,lat,lon,hdg,dest,spd,delayed}] }
     GET /predictions?stop=123  → { ok:true, arrivals:[{rt,dest,min,stop}] }
     GET /routes                → { ok:true, routes:[{rt,name}] }  (all 263)
   ============================================================================ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...CORS } });

const BT = "https://mybusnow.njtransit.com/bustime/api/v3";

async function bustime(env, path, params) {
  if (!env.BUSTIME_KEY) return { error: "bustime_key_not_configured" };
  const u = new URL(BT + path);
  u.searchParams.set("key", env.BUSTIME_KEY);
  u.searchParams.set("format", "json");
  for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { accept: "application/json" } });
  if (!r.ok) return { error: "upstream_" + r.status };
  const d = await r.json();
  const resp = d && d["bustime-response"];
  if (!resp) return { error: "bad_upstream_shape" };
  if (resp.error && !resp.vehicle && !resp.prd && !resp.routes)
    return { error: (resp.error[0] && resp.error[0].msg) || "upstream_error" };
  return { resp };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/health") return json({ ok: true, bus: !!env.BUSTIME_KEY });

    /* ---- live bus vehicles. BusTime caps rt= at 10 routes per call, so batch. ---- */
    if (url.pathname === "/vehicles") {
      const rts = (url.searchParams.get("rt") || "").split(",").map(s => s.trim()).filter(Boolean);
      if (!rts.length) return json({ ok: false, error: "missing_rt" }, 400);
      const out = [];
      for (let i = 0; i < rts.length && i < 60; i += 10) {
        const { resp, error } = await bustime(env, "/getvehicles", { rt: rts.slice(i, i + 10).join(",") });
        if (error) {
          if (i === 0) return json({ ok: false, error }, 502);
          break;                                   // partial data beats none
        }
        for (const v of resp.vehicle || []) {
          const lat = parseFloat(v.lat), lon = parseFloat(v.lon);
          if (!isFinite(lat) || !isFinite(lon)) continue;
          out.push({
            id: String(v.vid), rt: String(v.rt || ""), lat, lon,
            hdg: parseFloat(v.hdg) || 0,
            dest: String(v.des || "").trim(),
            spd: v.spd != null ? Number(v.spd) : null,
            // BusTime marks a vehicle "delayed" with a flag, not a lateness value
            delayed: v.dly === true || v.dly === "true",
          });
        }
      }
      return json({ ok: true, vehicles: out });
    }

    /* ---- live arrival predictions for one stop ---- */
    if (url.pathname === "/predictions") {
      const stop = (url.searchParams.get("stop") || "").trim();
      if (!stop) return json({ ok: false, error: "missing_stop" }, 400);
      const { resp, error } = await bustime(env, "/getpredictions", { stpid: stop });
      if (error) return json({ ok: false, error }, 502);
      const arrivals = (resp.prd || []).map(p => ({
        rt: String(p.rt || ""), dest: String(p.des || "").trim(),
        // prdctdn is "DUE" or a whole number of minutes
        min: /^\d+$/.test(String(p.prdctdn)) ? parseInt(p.prdctdn, 10) : 0,
        stop: String(p.stpnm || ""),
        delayed: p.dly === true || p.dly === "true",
      })).sort((a, b) => a.min - b.min);
      return json({ ok: true, arrivals });
    }

    /* ---- the full route list (how a board offers all 263 routes) ---- */
    if (url.pathname === "/routes") {
      const { resp, error } = await bustime(env, "/getroutes", {});
      if (error) return json({ ok: false, error }, 502);
      return json({ ok: true, routes: (resp.routes || []).map(r => ({ rt: String(r.rt), name: String(r.rtnm || "") })) });
    }

    /* ---- rail: intentionally not implemented (see the header) ---- */
    if (url.pathname === "/rail")
      return json({ ok: false, error: "rail_not_implemented",
        note: "raildata.njtransit.com's request/response shape isn't public. Register for NJT rail API access, then send the docs and this route can be finished. Boards fall back to the bundled statewide rail schedule, which covers every line." }, 501);

    return json({ ok: false, error: "not_found" }, 404);
  },
};
