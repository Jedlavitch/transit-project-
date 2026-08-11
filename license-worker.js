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
          LICENCE_SECRET (secret)  from: python3 gen-licence.py --new-secret
                                   *** MUST BE THE IDENTICAL VALUE you give
                                   feed-proxy-worker.js. This is what makes one
                                   key unlock the interface AND pass the feed
                                   proxy. Two different secrets means customers
                                   who can open a board that shows no data. ***
          STRIPE_SECRET  (secret)  sk_live_... or sk_test_...   [optional
                                   until you have Stripe — see TEST_MODE]
          ADMIN_SECRET   (secret)  any long random string you keep private
          TEST_MODE      (var)     "1" while testing (issues free demo keys
                                   from /claim with no Stripe session);
                                   REMOVE or set "0" before going live!
          DEVICE_LIMIT   (var)     optional, default "5"
          LICENCE_DAYS   (var)     optional, default 36500 (~100 years, i.e.
                                   the "one-off, forever" the product promises)
          REVOKED        (var)     optional, comma-separated key ids to refuse.
                                   Same list the feed proxy takes; the id is
                                   printed by gen-licence.py --check.
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

/* ---------------------------------------------------------------------------
   ONE KEY FORMAT, SHARED WITH feed-proxy-worker.js AND gen-licence.py.

   This Worker used to mint its own random key and remember it in KV. The feed
   proxy cannot use those: it validates by SIGNATURE precisely so it needs no
   database on the hot path of every feed request. So a customer ended up
   needing two different keys -- one to unlock the interface, another to let
   data through -- and buying only got them the first.

   The signed format wins because it is the one that works in both places. A key
   carries its own expiry and signature, so anything holding the same
   LICENCE_SECRET can validate it with no lookup. KV stays, but only for what a
   signature genuinely cannot express: how many devices a key is on.

   The primitives below are byte-for-byte the ones in feed-proxy-worker.js and
   gen-licence.py. If you change one, change all three -- a signature differing
   by a byte is a paying customer whose key is refused.
   --------------------------------------------------------------------------- */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";   // Crockford-ish: no I, L, O, U
const SIG_LEN = 5;
const EPOCH = 1577836800;                              // 2020-01-01

function b32encode(data) {
  let bits = 0n;
  for (const b of data) bits = (bits << 8n) | BigInt(b);
  const width = Math.floor((data.length * 8 + 4) / 5);
  let out = "";
  for (let i = 0; i < width; i++)
    out += ALPHABET[Number((bits >> BigInt(5 * (width - 1 - i))) & 31n)];
  return out;
}
function b32decode(text) {
  const clean = [...text.toUpperCase()].filter(c => ALPHABET.indexOf(c) >= 0);
  let bits = 0n;
  for (const c of clean) bits = (bits << 5n) | BigInt(ALPHABET.indexOf(c));
  const nbytes = Math.floor((clean.length * 5) / 8);
  const out = new Uint8Array(nbytes);
  for (let i = nbytes - 1; i >= 0; i--) { out[i] = Number(bits & 255n); bits >>= 8n; }
  return out;
}
async function sign(secret, raw) {
  const k = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, raw)).slice(0, SIG_LEN);
}
/* Constant time: an early return leaks how much of a forged signature was
   right, which is enough to rebuild one a byte at a time. */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
const keyId = raw => [...raw.slice(0, 5)].map(b => b.toString(16).padStart(2, "0")).join("");

/* Mint a key this Worker, the feed proxy and gen-licence.py all accept. */
async function mintKey(env, days) {
  const ident = crypto.getRandomValues(new Uint8Array(5));
  const expiryDay = Math.floor((Date.now() / 1000 - EPOCH) / 86400) + days;
  if (expiryDay < 0 || expiryDay > 0xFFFF) throw new Error("expiry out of range");
  const raw = new Uint8Array(7);
  raw.set(ident, 0);
  raw[5] = (expiryDay >> 8) & 255;
  raw[6] = expiryDay & 255;
  const body = b32encode(new Uint8Array([...raw, ...(await sign(env.LICENCE_SECRET, raw))]));
  return "TB-" + (body.match(/.{1,5}/g) || []).join("-");
}

/* Signature check. Returns the key's id so callers can count devices against
   it -- the id rather than the key string, because the id is what
   gen-licence.py --check prints and what REVOKED lists. */
async function checkSigned(env, key) {
  if (!env.LICENCE_SECRET) return { ok: false, error: "secret_not_set" };
  const data = b32decode(String(key).replace(/^TB-/i, ""));
  if (data.length < 7 + SIG_LEN) return { ok: false, error: "unknown_key" };
  const raw = data.slice(0, 7), sig = data.slice(7, 7 + SIG_LEN);
  if (!sameBytes(sig, await sign(env.LICENCE_SECRET, raw)))
    return { ok: false, error: "unknown_key" };
  const expiryDay = (raw[5] << 8) | raw[6];
  if (EPOCH + expiryDay * 86400 < Date.now() / 1000) return { ok: false, error: "expired" };
  const id = keyId(raw);
  if ((env.REVOKED || "").split(",").map(s => s.trim()).filter(Boolean).includes(id))
    return { ok: false, error: "revoked" };
  return { ok: true, id, expires: EPOCH + expiryDay * 86400 };
}

/* The product is sold as one-off and permanent, so the default expiry is a
   century -- the honest encoding of "forever" in two bytes of days.
   LICENCE_DAYS exists for trials. */
async function issueKey(env, source, extra = {}) {
  const days = Math.min(parseInt(env.LICENCE_DAYS || "36500", 10), 0xFFFF - 2600);
  const key = await mintKey(env, days);
  const chk = await checkSigned(env, key);
  await env.LICENSES.put("lic:" + chk.id, JSON.stringify({
    created: Date.now(), source, devices: {}, ...extra,
  }));
  return key;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    /* Health has to answer "is this deployment actually wired up", not merely
       "is a Worker running here". Both setup guides say to check /health after
       deploying, and an unconditional {ok:true} passes that check on a Worker
       with no KV binding and no Stripe key — so the first thing you learn is
       wrong, and the next thing you learn is a customer's failed purchase.

       Booleans only. Whether a secret is set is a deployment fact; what it is
       stays in Cloudflare, and this endpoint is open to the world. */
    if (url.pathname === "/health") {
      const kv = !!env.LICENSES, stripe = !!env.STRIPE_SECRET, test = env.TEST_MODE === "1";
      const secret = !!env.LICENCE_SECRET;
      return json({
        ok: true,
        kv, stripe,
        // Must be the SAME value as the feed proxy's LICENCE_SECRET, or the keys
        // sold here will unlock the interface and then be refused live data.
        licenceSecret: secret,
        admin: !!env.ADMIN_SECRET,
        testMode: test,
        deviceLimit: parseInt(env.DEVICE_LIMIT || "5", 10),
        // can this Worker actually issue a USABLE key to somebody right now?
        ready: kv && secret && (stripe || test),
        secretWarning: secret ? null
          : "LICENCE_SECRET is not set. Keys cannot be minted, and any that were will not work with the feed proxy.",
        // loud on purpose: TEST_MODE hands free keys to anyone who asks
        warning: test ? "TEST_MODE is on — /claim issues free keys with no payment. Remove it before selling." : null,
      });
    }

    /* Every route below reads or writes KV. Without the binding, env.LICENSES
       is undefined and the first property access throws — which Cloudflare
       turns into a bare 500 carrying none of the CORS headers above, so the
       browser reports a cross-origin failure and the actual cause (one
       unchecked box in Settings → Bindings) is invisible. The binding is the
       step that most often gets missed, so it gets named rather than guessed. */
    if (!env.LICENSES) {
      return json({ ok: false, error: "kv_not_bound",
        detail: "This Worker has no KV binding named LICENSES. Cloudflare → Storage & Databases → KV → create a namespace, then Worker → Settings → Bindings → add KV namespace, variable name LICENSES." }, 500);
    }

    /* ---- verify a key + register the device using it ----

       Two kinds of key reach here, and both must work:

         signed  — the format everything now issues, and the only one the feed
                   proxy can validate. Checked by signature, so a key minted by
                   gen-licence.py on a laptop verifies here without this Worker
                   ever having seen it.
         legacy  — the random KV keys this Worker minted before unification.
                   Somebody paid for one of those; refusing it to tidy up the
                   code would be taking their money and breaking their board.

       Signed is tried first because it needs no KV read, and because a legacy
       lookup on a signed key would simply miss and report "unknown". */
    if (url.pathname === "/verify") {
      const key = (url.searchParams.get("key") || "").trim().toUpperCase();
      const device = (url.searchParams.get("device") || "unknown").slice(0, 64);
      if (!key) return json({ ok: false, error: "missing_key" }, 400);
      const limit = parseInt(env.DEVICE_LIMIT || "5", 10);

      const signed = await checkSigned(env, key);
      if (signed.ok) {
        // The signature is the licence; KV only counts devices against it.
        const slot = "lic:" + signed.id;
        let rec = {};
        try { rec = JSON.parse((await env.LICENSES.get(slot)) || "{}"); } catch (_) {}
        if (rec.revoked) return json({ ok: false, error: "revoked" });
        rec.devices = rec.devices || {};
        if (!(device in rec.devices) && Object.keys(rec.devices).length >= limit)
          return json({ ok: false, error: "device_limit", limit });
        rec.devices[device] = Date.now();
        rec.created = rec.created || Date.now();
        await env.LICENSES.put(slot, JSON.stringify(rec));
        return json({ ok: true, devices: Object.keys(rec.devices).length, limit,
                      expires: signed.expires, format: "signed" });
      }
      // An expired or revoked signature is a definite answer, not a miss --
      // falling through would relabel it the misleading "unknown_key".
      if (signed.error === "expired" || signed.error === "revoked")
        return json({ ok: false, error: signed.error });

      const raw = await env.LICENSES.get("key:" + key);
      if (!raw) return json({ ok: false, error: "unknown_key" });
      const rec = JSON.parse(raw);
      if (rec.revoked) return json({ ok: false, error: "revoked" });
      rec.devices = rec.devices || {};
      if (!(device in rec.devices) && Object.keys(rec.devices).length >= limit)
        return json({ ok: false, error: "device_limit", limit });
      rec.devices[device] = Date.now();
      await env.LICENSES.put("key:" + key, JSON.stringify(rec));
      /* Legacy keys unlock the interface but the feed proxy will refuse them,
         so say so rather than reporting a clean pass. Anyone holding one needs
         a signed replacement before their live data works. */
      return json({ ok: true, devices: Object.keys(rec.devices).length, limit,
                    format: "legacy",
                    warning: "This key predates the unified format and will not pass the feed proxy. Ask for a replacement." });
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
