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

   2. RAIL (raildata.njtransit.com) — IMPLEMENTED.
      Endpoint names were confirmed by probing, not guessed: getToken,
      getStationList, getTrainSchedule, getStationMSG, getVehicleData and
      isValidToken all answer 204 to POST and 405 to GET (an invented name like
      getTrainScheduleJSON 404s both ways), so the API is POST-only and those
      six paths are real. Auth is a token you exchange your portal login for:
      POST getToken with username+password -> a UserToken used by every other
      call. Put the login in the NJT_USER / NJT_PASS secrets.
      If a response shape differs from what /rail/* expects, hit /rail/debug --
      it returns the upstream status and a REDACTED snippet you can safely paste
      back to me without leaking the token or your password.

   ── DEPLOY (two steps; Cloudflare blocks pasting big code at creation time) ──
   1. Workers & Pages → Create → "Hello World" → name it "njt" → Deploy
   2. Open it → Edit Code → paste THIS file → Deploy
   3. Settings → Variables and Secrets:
        BUSTIME_KEY  (secret)  your BusTime API key            (buses)
        NJT_USER     (secret)  your NJT developer username     (rail)
        NJT_PASS     (secret)  your NJT developer password     (rail)
   4. Paste the worker URL into the New Jersey board: ⚙︎ → live NJ Transit URL.

   ROUTES
     GET /health                → { ok:true, bus:true|false }
     GET /vehicles?rt=126,25    → { ok:true, vehicles:[{id,rt,lat,lon,hdg,dest,spd,delayed}] }
     GET /predictions?stop=123  → { ok:true, arrivals:[{rt,dest,min,stop}] }
     GET /routes                → { ok:true, routes:[{rt,name}] }  (all 263)
     GET /rail/vehicles         → { ok:true, trains:[{id,line,lat,lon,dest,late,next}] }
     GET /rail/station?s=NP     → { ok:true, departures:[{train,line,dest,time,track,status}] }
     GET /rail/debug            → upstream status + redacted body, for reporting shape mismatches
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


/* ===========================================================================
   RAIL — raildata.njtransit.com
   POST-only, form-encoded. Every call needs a token obtained by exchanging the
   portal login. Tokens are cached in module scope (which survives between
   requests in the same isolate) and re-fetched on the first sign of rejection,
   so a normal minute of polling costs one upstream auth call, not one per hit.
   =========================================================================== */
const RAIL = "https://raildata.njtransit.com/api/TrainData";
let railToken = null, railTokenAt = 0;
const TOKEN_TTL = 50 * 60 * 1000;          // refresh well inside NJT's expiry

async function railPost(path, fields) {
  const body = new URLSearchParams(fields);
  const r = await fetch(RAIL + path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* keep raw for /rail/debug */ }
  return { status: r.status, data, text };
}

async function railAuth(env, force) {
  if (!env.NJT_USER || !env.NJT_PASS) return { error: "rail_credentials_not_configured" };
  if (!force && railToken && Date.now() - railTokenAt < TOKEN_TTL) return { token: railToken };
  const { status, data } = await railPost("/getToken", { username: env.NJT_USER, password: env.NJT_PASS });
  // NJT has spelled this field differently across versions; accept the usual variants
  const tok = data && (data.UserToken || data.userToken || data.token || data.Token);
  if (!tok) return { error: "token_failed_" + status };
  railToken = tok; railTokenAt = Date.now();
  return { token: tok };
}

// Runs a call, and retries once with a fresh token if the answer looks like a
// rejected/expired one (NJT signals this in-body, not with a 401).
async function railCall(env, path, fields) {
  let auth = await railAuth(env, false);
  if (auth.error) return auth;
  let res = await railPost(path, { ...fields, token: auth.token });
  const looksUnauth = !res.data || (res.text || "").toLowerCase().includes("invalid") ||
                      (res.text || "").toLowerCase().includes("token");
  if (looksUnauth) {
    auth = await railAuth(env, true);
    if (auth.error) return auth;
    res = await railPost(path, { ...fields, token: auth.token });
  }
  return res;
}

const arr = v => Array.isArray(v) ? v : (v && typeof v === "object" ? Object.values(v) : []);
const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] != null && o[k] !== "") return o[k]; return null; };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/health") return json({ ok: true, bus: !!env.BUSTIME_KEY, rail: !!(env.NJT_USER && env.NJT_PASS) });

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

    /* ---- live train positions for the map ---- */
    if (url.pathname === "/rail/vehicles") {
      const res = await railCall(env, "/getVehicleData", {});
      if (res.error) return json({ ok: false, error: res.error }, 502);
      // Field names vary by API version, so read each value by trying the known
      // spellings rather than assuming one -- and keep anything with coordinates.
      const trains = arr(res.data && (res.data.Trains || res.data.trains || res.data))
        .map(v => {
          const lat = parseFloat(pick(v, "LATITUDE", "Latitude", "latitude", "lat"));
          const lon = parseFloat(pick(v, "LONGITUDE", "Longitude", "longitude", "lon"));
          if (!isFinite(lat) || !isFinite(lon)) return null;
          return {
            id: String(pick(v, "ID", "TRAIN_ID", "TrainID", "trainId") ?? `${lat},${lon}`),
            train: String(pick(v, "TRAIN_ID", "TrainID", "train", "TRAIN") ?? ""),
            line: String(pick(v, "LINE", "Line", "line", "LINECODE") ?? ""),
            lat, lon,
            dest: String(pick(v, "DESTINATION", "Destination", "dest") ?? "").trim(),
            late: Number(pick(v, "SEC_LATE", "SecondsLate", "secLate") ?? 0) / 60 || 0,
            next: String(pick(v, "NEXT_STOP", "NextStop", "nextStop") ?? "").trim(),
          };
        }).filter(Boolean);
      return json({ ok: true, trains });
    }

    /* ---- departures at one station ---- */
    if (url.pathname === "/rail/station") {
      const s = (url.searchParams.get("s") || "").trim();
      if (!s) return json({ ok: false, error: "missing_station" }, 400);
      const res = await railCall(env, "/getTrainSchedule", { station: s });
      if (res.error) return json({ ok: false, error: res.error }, 502);
      const departures = arr(res.data && (res.data.STATION || res.data.Items || res.data))
        .flatMap(x => arr(x && (x.ITEMS || x.Items || x))).map(d => ({
          train: String(pick(d, "TRAIN_ID", "TrainID", "train") ?? ""),
          line: String(pick(d, "LINE", "Line", "line") ?? ""),
          dest: String(pick(d, "DESTINATION", "Destination", "dest") ?? "").trim(),
          time: String(pick(d, "SCHED_DEP_DATE", "SchedDepDate", "time") ?? ""),
          track: String(pick(d, "TRACK", "Track", "track") ?? "").trim(),
          status: String(pick(d, "STATUS", "Status", "status") ?? "").trim(),
          late: Number(pick(d, "SEC_LATE", "SecondsLate") ?? 0) / 60 || 0,
        })).filter(d => d.train || d.dest);
      return json({ ok: true, departures });
    }

    /* ---- shape reporter: safe to share, never echoes the token or password ---- */
    if (url.pathname === "/rail/debug") {
      const auth = await railAuth(env, true);
      if (auth.error) return json({ ok: false, stage: "auth", error: auth.error });
      const res = await railPost("/getVehicleData", { token: auth.token });
      const redact = str => String(str || "")
        .split(auth.token).join("<TOKEN>")
        .replace(new RegExp((env.NJT_USER || "\u0000").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "<USER>");
      return json({ ok: true, upstreamStatus: res.status,
        topLevelKeys: res.data && typeof res.data === "object" ? Object.keys(res.data).slice(0, 20) : null,
        sample: redact(res.text).slice(0, 900),
        note: "Token and username are redacted. Safe to paste back for shape-fixing." });
    }

    return json({ ok: false, error: "not_found" }, 404);
  },
};
