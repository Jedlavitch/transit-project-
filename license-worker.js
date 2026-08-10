/* ============================================================================
   license-worker.js — Transit Project license server (Cloudflare Worker)

   Issues and verifies license keys for the transit-board kiosk product.
   Works hand-in-hand with license.js (loaded by every board), buy.html
   (checkout) and activate.html (key delivery after purchase).

   DEPLOY (dashboard, no CLI needed — and note Cloudflare blocks pasting big
   code blocks at CREATION time, so do it in two steps):
     1. Cloudflare dashboard → Workers & Pages → Create → "Hello World"
        template → name it e.g. "tb-license" → Deploy.
     2. Open the worker → Edit Code → replace everything with THIS file → Deploy.
     3. Storage & Databases → KV → Create namespace "TB_LICENSES".
        Worker → Settings → Bindings → KV namespace: variable name LICENSES,
        namespace TB_LICENSES.
     4. Worker → Settings → Variables and Secrets:
          STRIPE_SECRET  (secret)  sk_live_... or sk_test_...   [optional
                                   until you have Stripe — see TEST_MODE]
          ADMIN_SECRET   (secret)  any long random string you keep private
          TEST_MODE      (var)     "1" while testing (issues free demo keys
                                   from /claim with no Stripe session);
                                   REMOVE or set "0" before going live!
          DEVICE_LIMIT   (var)     optional, default "5"
     5. Put the worker URL into license.js (workerUrl) and buy.html/
        activate.html (WORKER_URL), redeploy the site.

   ROUTES (all JSON, CORS-open):
     GET  /health                       → { ok:true }
     GET  /verify?key=K&device=D        → { ok:true, devices:n } or
                                          { ok:false, error:"unknown_key"|"device_limit" }
     GET  /claim?session=SESSION_ID     → { ok:true, key } — verifies a paid
                                          Stripe Checkout session and returns
                                          the key for it (idempotent: same
                                          session always returns same key)
     GET  /claim (TEST_MODE only)       → { ok:true, key } demo key, no Stripe
     POST /grant  (x-admin-secret hdr)  → { ok:true, key } manual key issue
   ============================================================================ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, x-admin-secret",
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });

// No 0/O/1/I/L — keys get typed on TVs with remotes; keep every character unambiguous.
const KEY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function genKey() {
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  const c = [...buf].map(b => KEY_ALPHABET[b % KEY_ALPHABET.length]);
  return `TB-${c.slice(0, 4).join("")}-${c.slice(4, 8).join("")}-${c.slice(8, 12).join("")}`;
}

async function issueKey(env, source, extra = {}) {
  const key = genKey();
  await env.LICENSES.put("key:" + key, JSON.stringify({
    created: Date.now(), source, devices: {}, ...extra,
  }));
  return key;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/health") return json({ ok: true });

    /* ---- verify a key + register the device using it ---- */
    if (url.pathname === "/verify") {
      const key = (url.searchParams.get("key") || "").trim().toUpperCase();
      const device = (url.searchParams.get("device") || "unknown").slice(0, 64);
      if (!key) return json({ ok: false, error: "missing_key" }, 400);
      const raw = await env.LICENSES.get("key:" + key);
      if (!raw) return json({ ok: false, error: "unknown_key" });
      const rec = JSON.parse(raw);
      if (rec.revoked) return json({ ok: false, error: "revoked" });
      const limit = parseInt(env.DEVICE_LIMIT || "5", 10);
      rec.devices = rec.devices || {};
      if (!(device in rec.devices) && Object.keys(rec.devices).length >= limit)
        return json({ ok: false, error: "device_limit", limit });
      rec.devices[device] = Date.now();
      await env.LICENSES.put("key:" + key, JSON.stringify(rec));
      return json({ ok: true, devices: Object.keys(rec.devices).length, limit });
    }

    /* ---- claim: turn a paid Stripe Checkout session into a key ---- */
    if (url.pathname === "/claim") {
      const session = url.searchParams.get("session");

      if (session) {
        if (!env.STRIPE_SECRET) return json({ ok: false, error: "stripe_not_configured" }, 500);
        // Idempotent: a session that already claimed a key gets the same key back.
        const prior = await env.LICENSES.get("sess:" + session);
        if (prior) return json({ ok: true, key: prior });
        const r = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(session), {
          headers: { Authorization: "Bearer " + env.STRIPE_SECRET },
        });
        if (!r.ok) return json({ ok: false, error: "stripe_lookup_failed" }, 502);
        const sess = await r.json();
        if (sess.payment_status !== "paid") return json({ ok: false, error: "not_paid" }, 402);
        const key = await issueKey(env, "stripe", { session, email: sess.customer_details?.email || null });
        await env.LICENSES.put("sess:" + session, key);
        return json({ ok: true, key });
      }

      // No session: only allowed in TEST_MODE, for end-to-end testing pre-Stripe.
      if (env.TEST_MODE === "1") return json({ ok: true, key: await issueKey(env, "test"), test: true });
      return json({ ok: false, error: "missing_session" }, 400);
    }

    /* ---- grant: manual key issue (friends, purchase support, testing) ---- */
    if (url.pathname === "/grant" && req.method === "POST") {
      if (!env.ADMIN_SECRET || req.headers.get("x-admin-secret") !== env.ADMIN_SECRET)
        return json({ ok: false, error: "forbidden" }, 403);
      return json({ ok: true, key: await issueKey(env, "grant") });
    }

    return json({ ok: false, error: "not_found" }, 404);
  },
};
