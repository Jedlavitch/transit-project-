/* ============================================================================
   feed-proxy-worker.js -- the hard gate: live data only flows with a valid licence.

   Cloudflare Access stops people reaching the site. It does nothing about a
   paying customer who saves the files and runs their own copy -- everything the
   browser received is theirs. This is the layer that makes that copy useless:
   the boards fetch their live feeds through here, and without a valid key there
   is no data to show. Timetables and UI can be copied; a dead board is not a
   product.

   DEPLOY -- one Worker, one variable, NO KV namespace and NO binding.
     1. Workers & Pages -> Create -> "Hello World" -> name it "tb-feeds" -> Deploy
        (create from the template first; pasting code at creation is blocked)
     2. Open it -> Edit Code -> paste THIS file -> Deploy
     3. Settings -> Variables -> add LICENCE_SECRET, value from:
            python3 gen-licence.py --new-secret
        Use "Encrypt" so it is not readable in the dashboard afterwards.
     4. Mint a key:  python3 gen-licence.py --secret <SECRET> --days 365
     5. Put the Worker URL in admin.html -> Feed proxy URL, and give each
        customer their key.

   Keys are SIGNED, not stored, which is why there is no database here. The cost
   is that revoking a key before it expires means adding its id to REVOKED (a
   comma-separated variable); the id is printed by
        python3 gen-licence.py --secret <SECRET> --check <KEY>

   ROUTES
     GET /f?u=<url-encoded upstream>&k=<licence key>   -> proxied JSON
     GET /health                                       -> { ok:true }
   ============================================================================ */

/* An ALLOWLIST, not an open proxy. Without this anyone who found the URL could
   route arbitrary traffic through your account -- that is how a Worker gets you
   rate-limited, billed, or banned. Add a host here when a board needs it. */
const ALLOWED_HOSTS = new Set([
  "api.airplanes.live",       // aircraft overhead
  "api-v3.amtraker.com",      // Amtrak
  "api.wmata.com",            // DC rail + bus
  "api.mta.info",             // NYC subway / LIRR / Metro-North
  "api-endpoint.mta.info",
  "gtfsrt.prod.obanyc.com",   // NYC bus
  "www3.septa.org",           // Philadelphia
  "api.adsbdb.com",           // flight routes
  "jsonblob.com",             // spotter share codes
  /* Added when the gate was audited before deployment: these are fetched
     straight from a board, so without them here the licence check simply
     never applies to Boston, San Francisco, Los Angeles or the three
     European cities -- most of the product, ungated. */
  "api-v3.mbta.com",            // Boston live rail + bus
  "api.bart.gov",               // SF BART
  "api.transitous.org",         // Zurich / Cologne / Stuttgart
  "transport.opendata.ch",      // Swiss rail
  "rtt.metrolinktrains.com",    // LA Metrolink
  "api.wheretheiss.at",         // ISS, in the sky view
]);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...CORS } });

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const SIG_LEN = 5;
const EPOCH = 1577836800;

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
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
  return sig.slice(0, SIG_LEN);
}

/* Constant time: comparing byte by byte with an early return leaks how much of a
   forged signature was right, which is enough to rebuild one a byte at a time. */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function checkLicence(env, key) {
  if (!env.LICENCE_SECRET) return { ok: false, why: "proxy not configured" };
  if (!key) return { ok: false, why: "no licence key" };
  const data = b32decode(String(key).replace(/^TB-/i, ""));
  if (data.length < 7 + SIG_LEN) return { ok: false, why: "malformed key" };
  const raw = data.slice(0, 7), sig = data.slice(7, 7 + SIG_LEN);
  if (!sameBytes(sig, await sign(env.LICENCE_SECRET, raw)))
    return { ok: false, why: "invalid key" };
  const expiryDay = (raw[5] << 8) | raw[6];
  if (EPOCH + expiryDay * 86400 < Date.now() / 1000)
    return { ok: false, why: "licence expired" };
  const id = [...raw.slice(0, 5)].map(b => b.toString(16).padStart(2, "0")).join("");
  if ((env.REVOKED || "").split(",").map(s => s.trim()).filter(Boolean).includes(id))
    return { ok: false, why: "licence revoked" };
  return { ok: true, id };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/health") return json({ ok: true });
    if (url.pathname !== "/f") return json({ ok: false, error: "not_found" }, 404);

    const lic = await checkLicence(env, url.searchParams.get("k"));
    // 402 rather than 403: the board shows "licence needed" instead of an error,
    // because for a customer this is a billing state, not a fault.
    if (!lic.ok) return json({ ok: false, error: "licence", detail: lic.why }, 402);

    const target = url.searchParams.get("u");
    if (!target) return json({ ok: false, error: "no_url" }, 400);
    let up;
    try { up = new URL(target); } catch (_) { return json({ ok: false, error: "bad_url" }, 400); }
    if (up.protocol !== "https:" || !ALLOWED_HOSTS.has(up.hostname))
      return json({ ok: false, error: "host_not_allowed", host: up.hostname }, 403);

    try {
      const r = await fetch(up.toString(), {
        headers: { "User-Agent": "transit-board-proxy/1", "Accept": "*/*" },
        cf: { cacheTtl: 10, cacheEverything: true },   // a few boards asking at once cost one upstream call
      });
      const body = await r.arrayBuffer();
      return new Response(body, {
        status: r.status,
        headers: {
          "content-type": r.headers.get("content-type") || "application/octet-stream",
          "cache-control": "no-store",
          ...CORS,
        },
      });
    } catch (e) {
      return json({ ok: false, error: "upstream_failed", detail: String(e) }, 502);
    }
  },
};
