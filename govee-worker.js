/* ============================================================================
   govee-worker.js — let the boards drive Govee lights (Cloudflare Worker)

   WHY THIS EXISTS
   Two separate walls stop the board doing this by itself, and it is worth being
   clear that neither is a bug we could code around:

     1. Govee's LAN control is UDP. Browsers cannot open UDP sockets at all, so
        the fast local path is simply not reachable from a page.
     2. Govee's cloud API sends no CORS header, so a fetch() from the board is
        blocked — and the API key would be sitting in a page served off GitHub
        Pages for anyone to read.

   So the same shape as every other Worker here: the key lives in this Worker as
   a secret, the browser never sees it, and the Worker re-serves the parts the
   board needs with CORS on.

   WHAT IT IS FOR
   The sky view knows which carrier is overhead and already has a colour for it
   (AIRLINE_BRAND / TRANSIT_BRAND in night.html). This turns that colour into
   room lighting: a United-blue room when a United aircraft is passing, back to
   normal when the sky is empty.

   DEPLOY
     1. Govee Home app -> Profile -> About Us -> Apply for API Key. The key
        arrives by email, usually within a minute.
     2. Workers & Pages -> Create -> "Hello World" -> name it "govee" -> Deploy
     3. Open it -> Edit Code -> paste THIS file -> Deploy
     4. Worker -> Settings -> Variables and Secrets:
          GOVEE_API_KEY  (secret)  the key from step 1
     5. Put the URL in the sky view: settings -> room lights, then Scan.

   ROUTES
     GET  /health                  -> { ok, configured }
     GET  /devices                 -> { ok, devices:[{sku,device,name,rgb}] }
     GET  /state?sku=&device=      -> { ok, power, brightness, rgb }
     POST /set  {sku,device,rgb?,brightness?,power?}
                                   -> { ok, applied:[...] }

   ON THE UPSTREAM API
   Govee takes exactly ONE capability per control request, so "restore the light
   to how I found it" is up to three calls (power, then colour, then
   brightness). That fan-out lives here rather than in the board: the board
   sends one intent and this decides how many upstream calls it costs.

   Order matters on the way back. Power goes first — setting a colour on a light
   that is off does nothing on some models — and brightness goes last, because
   changing colour on several Govee models resets brightness to full.

   Rate limits are 2 req/sec/device and 12 req/sec/account (burst 6 and 80).
   Comfortable for this, but the board still holds a colour for a minimum dwell:
   the limit is not the reason, a room that strobes every time a different
   airline passes is.
   ============================================================================ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  // text/plain is here on purpose: the board's last-gasp restore on pagehide
  // goes out via sendBeacon, which cannot survive a CORS preflight. A
  // text/plain body is preflight-free, so the beacon actually lands.
  "Access-Control-Allow-Headers": "content-type",
};
const json = (o, s = 200, extra) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", ...CORS, ...(extra || {}) },
  });

const API = "https://openapi.api.govee.com/router/api/v1";
const rid = () => crypto.randomUUID();

async function govee(env, path, init) {
  const r = await fetch(API + path, {
    ...init,
    headers: {
      "Govee-API-Key": env.GOVEE_API_KEY,
      "content-type": "application/json",
      ...(init && init.headers),
    },
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) { /* upstream sent non-JSON */ }
  return { status: r.status, body, text };
}

/* Govee returns HTTP 200 with a non-200 `code` in the body for several real
   failures (unknown device, malformed capability), so the status line alone is
   not enough to tell whether anything happened. */
const upstreamOk = (r) => r.status === 200 && (!r.body || r.body.code === 200);
const upstreamErr = (r) => ({
  ok: false,
  error: "govee_" + (r.body && r.body.code ? r.body.code : r.status),
  detail: (r.body && r.body.message) || r.text.slice(0, 200),
});

/* Pull the three things we care about out of the capability array, whatever
   else the device happens to expose. A plug has no colour, a lamp has no
   sensor: missing is normal and stays null rather than becoming a guess. */
function readState(body) {
  const caps = (((body || {}).payload || {}).capabilities) || [];
  const out = { power: null, brightness: null, rgb: null };
  for (const c of caps) {
    const v = ((c || {}).state || {}).value;
    if (v === undefined || v === null) continue;
    if (c.instance === "powerSwitch") out.power = Number(v) ? 1 : 0;
    else if (c.instance === "brightness") out.brightness = Number(v);
    else if (c.instance === "colorRgb") out.rgb = Number(v);
  }
  return out;
}

const CAP = {
  power: (v) => ({ type: "devices.capabilities.on_off", instance: "powerSwitch", value: v ? 1 : 0 }),
  rgb: (v) => ({ type: "devices.capabilities.color_setting", instance: "colorRgb", value: v }),
  brightness: (v) => ({ type: "devices.capabilities.range", instance: "brightness", value: v }),
};

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/health")
      return json({ ok: true, configured: !!env.GOVEE_API_KEY });

    if (!env.GOVEE_API_KEY)
      return json({ ok: false, error: "no_key",
                    detail: "Add a GOVEE_API_KEY secret in this Worker's settings" }, 500);

    if (url.pathname === "/devices") {
      const r = await govee(env, "/user/devices", { method: "GET" });
      if (!upstreamOk(r)) return json(upstreamErr(r), 502);
      // Trim to what the board's picker needs, and flag which ones can take a
      // colour at all — a Govee plug or humidifier will list here otherwise and
      // silently do nothing when told to go United blue.
      const devices = ((r.body && r.body.data) || []).map((d) => ({
        sku: d.sku,
        device: d.device,
        name: d.deviceName || d.sku,
        rgb: (d.capabilities || []).some((c) => c.instance === "colorRgb"),
      }));
      return json({ ok: true, devices });
    }

    if (url.pathname === "/state") {
      const sku = url.searchParams.get("sku") || "";
      const device = url.searchParams.get("device") || "";
      if (!sku || !device) return json({ ok: false, error: "sku_and_device_required" }, 400);
      const r = await govee(env, "/device/state", {
        method: "POST",
        body: JSON.stringify({ requestId: rid(), payload: { sku, device } }),
      });
      if (!upstreamOk(r)) return json(upstreamErr(r), 502);
      return json({ ok: true, ...readState(r.body) });
    }

    if (url.pathname === "/set") {
      if (req.method !== "POST") return json({ ok: false, error: "post_only" }, 405);
      // Parsed from raw text, not req.json(), because the pagehide beacon
      // arrives as text/plain (see the CORS note at the top).
      let b = null;
      try { b = JSON.parse(await req.text()); } catch (_) {
        return json({ ok: false, error: "bad_json" }, 400);
      }
      const { sku, device } = b || {};
      if (!sku || !device) return json({ ok: false, error: "sku_and_device_required" }, 400);

      // Power first, brightness last — see the header note on ordering.
      const steps = [];
      if (b.power !== undefined && b.power !== null) steps.push(["power", CAP.power(b.power)]);
      if (Number.isFinite(b.rgb)) {
        const v = Math.max(0, Math.min(16777215, Math.round(b.rgb)));
        steps.push(["rgb", CAP.rgb(v)]);
      }
      if (Number.isFinite(b.brightness)) {
        const v = Math.max(1, Math.min(100, Math.round(b.brightness)));
        steps.push(["brightness", CAP.brightness(v)]);
      }
      if (!steps.length) return json({ ok: false, error: "nothing_to_set" }, 400);

      const applied = [];
      for (const [name, capability] of steps) {
        const r = await govee(env, "/device/control", {
          method: "POST",
          body: JSON.stringify({ requestId: rid(), payload: { sku, device, capability } }),
        });
        // Report the step that broke rather than failing the whole call
        // silently: a light that took the colour but refused the brightness is
        // a materially different problem from one that is offline.
        if (!upstreamOk(r)) return json({ ...upstreamErr(r), failedOn: name, applied }, 502);
        applied.push(name);
      }
      return json({ ok: true, applied });
    }

    return json({ ok: false, error: "not_found" }, 404);
  },
};
