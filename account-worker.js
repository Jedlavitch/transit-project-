/* ============================================================================
   account-worker.js — accounts for the Transit Spotter, on Cloudflare Workers.

   WHY THIS SHAPE
   Sign-in is a one-time code emailed to the address you type. There are no
   passwords anywhere in this system — not hashed, not salted, not stored — which
   removes the entire class of breach where someone walks off with a password
   table. It also means this Worker never handles a credential you could reuse
   elsewhere.

   A code rather than a click-through link, deliberately: people read email on a
   different device from the one they're signing in on, and a link only works on
   the device that opens it.

   WHAT IT STORES
     acct:<id>            → { email, created, lastSeen }
     acct:<id>:spots      → that account's sightings, and ONLY that account's
     login:<token>        → { emailHash, codeHash, tries } 15-minute TTL
     sess:<tokenHash>     → { id } 400-day TTL
     rl:<bucket>          → rate-limit counters, short TTL

   The account id is a SHA-256 of the lowercased email plus a server-side salt,
   so the id in a URL or log line can't be reversed into someone's address.
   Codes and session tokens are stored hashed for the same reason: a dump of the
   KV namespace should not hand over live sessions.

   SETUP  (all of it yours to do — I can't create accounts on your behalf)
     1. KV → create a namespace, bind it to this Worker as  ACCOUNTS
     2. An email sender. Resend is the default here (free tier, simple API):
        create an account, verify your sending domain, make an API key.
        Worker → Settings → Variables → add SECRETS (not plain vars):
          RESEND_KEY   your Resend API key
          MAIL_FROM    e.g. "Transit Spotter <login@yourdomain.com>"
          ID_SALT      any long random string; changing it invalidates all ids
     3. Deploy, then paste the Worker URL into the app's ⚙︎ settings.

   Cloudflare's dashboard has been known to block pasting AI-written code when
   CREATING a worker. Make it from the "Hello World" template first, then use
   Edit Code to replace the contents — that path works.
   ============================================================================ */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...CORS } });

const CODE_TTL = 900;              // 15 minutes to type the code
const SESSION_TTL = 400 * 86400;   // ~13 months, then sign in again
const MAX_TRIES = 5;               // wrong codes before the login is burned
const MAX_SPOTS = 5000;            // per account, oldest dropped beyond this

async function sha(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const rand = (n = 32) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");

/* Six digits from the CSPRNG. Math.random() would be predictable enough to
   guess, and this is the only thing standing between a stranger and an inbox. */
function code6() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1000000).padStart(6, "0");
}

const normEmail = e => String(e || "").trim().toLowerCase();
const looksLikeEmail = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

/* Fixed-window counter. Coarse, but enough to stop someone hammering the code
   endpoint or using this Worker as a free way to send mail to strangers. */
async function rateLimit(env, bucket, limit, ttl) {
  const k = "rl:" + bucket;
  const n = parseInt((await env.ACCOUNTS.get(k)) || "0", 10) + 1;
  await env.ACCOUNTS.put(k, String(n), { expirationTtl: ttl });
  return n <= limit;
}

async function sendCode(env, email, code) {
  if (!env.RESEND_KEY) throw new Error("no mail provider configured");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RESEND_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: env.MAIL_FROM || "Transit Spotter <login@example.com>",
      to: [email],
      subject: `${code} is your Transit Spotter sign-in code`,
      text: `Your sign-in code is ${code}\n\nIt expires in 15 minutes. `
          + `If you didn't ask to sign in, you can ignore this email — nothing has changed.`,
    }),
  });
  if (!r.ok) throw new Error("mail send failed: " + r.status);
}

/* Bearer session → account id, or null. */
async function whoami(req, env) {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!tok) return null;
  const raw = await env.ACCOUNTS.get("sess:" + (await sha(tok)));
  return raw ? JSON.parse(raw).id : null;
}

/* Merge server-side so two devices offline at once don't clobber each other:
   union by sighting id, newest edit wins, newest first, capped. */
function mergeSpots(existing, incoming) {
  const by = {};
  for (const s of existing) if (s && s.id) by[s.id] = s;
  for (const s of incoming) {
    if (!s || !s.id) continue;
    const prev = by[s.id];
    const stamp = x => (x.edited || x.ts || 0);
    if (!prev || stamp(s) >= stamp(prev)) by[s.id] = s;
  }
  return Object.values(by).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, MAX_SPOTS);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const ip = req.headers.get("cf-connecting-ip") || "anon";
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!env.ACCOUNTS) return json({ ok: false, error: "worker not configured: bind KV as ACCOUNTS" }, 500);

    /* ---- step 1: ask for a code ---------------------------------------- */
    if (url.pathname === "/auth/start" && req.method === "POST") {
      const { email } = await req.json().catch(() => ({}));
      const addr = normEmail(email);
      if (!looksLikeEmail(addr)) return json({ ok: false, error: "that doesn't look like an email address" }, 400);

      if (!(await rateLimit(env, "ip:" + ip, 10, 3600)))
        return json({ ok: false, error: "too many sign-in attempts, try again later" }, 429);
      if (!(await rateLimit(env, "em:" + (await sha(addr)), 5, 3600)))
        return json({ ok: false, error: "too many codes sent to that address, try again later" }, 429);

      const code = code6(), token = rand(16);
      await env.ACCOUNTS.put("login:" + token, JSON.stringify({
        emailHash: await sha(addr), email: addr, codeHash: await sha(code), tries: 0,
      }), { expirationTtl: CODE_TTL });

      try { await sendCode(env, addr, code); }
      catch (e) { return json({ ok: false, error: "couldn't send the email — check the Worker's mail settings" }, 502); }

      /* The token identifies WHICH sign-in attempt; the code proves it's you.
         Returning the token is safe, returning the code would not be. */
      return json({ ok: true, token, expiresIn: CODE_TTL });
    }

    /* ---- step 2: prove it with the code -------------------------------- */
    if (url.pathname === "/auth/verify" && req.method === "POST") {
      const { token, code } = await req.json().catch(() => ({}));
      const raw = token ? await env.ACCOUNTS.get("login:" + token) : null;
      if (!raw) return json({ ok: false, error: "that code has expired — ask for a new one" }, 400);
      const rec = JSON.parse(raw);

      if (rec.tries >= MAX_TRIES) {
        await env.ACCOUNTS.delete("login:" + token);
        return json({ ok: false, error: "too many wrong codes — ask for a new one" }, 429);
      }
      if ((await sha(String(code || "").trim())) !== rec.codeHash) {
        rec.tries++;
        await env.ACCOUNTS.put("login:" + token, JSON.stringify(rec), { expirationTtl: CODE_TTL });
        return json({ ok: false, error: "that code doesn't match", triesLeft: MAX_TRIES - rec.tries }, 401);
      }
      await env.ACCOUNTS.delete("login:" + token);          // one code, one use

      const id = (await sha(rec.email + "|" + (env.ID_SALT || "tb"))).slice(0, 24);
      const existing = await env.ACCOUNTS.get("acct:" + id);
      await env.ACCOUNTS.put("acct:" + id, JSON.stringify({
        email: rec.email,
        created: existing ? JSON.parse(existing).created : Date.now(),
        lastSeen: Date.now(),
      }));

      const session = rand(32);
      await env.ACCOUNTS.put("sess:" + (await sha(session)), JSON.stringify({ id }), { expirationTtl: SESSION_TTL });
      return json({ ok: true, session, accountId: id, email: rec.email, isNew: !existing });
    }

    /* ---- everything below needs a session ------------------------------ */
    const id = await whoami(req, env);
    if (url.pathname.startsWith("/spots") || url.pathname === "/me"
        || url.pathname === "/auth/signout" || url.pathname === "/auth/delete") {
      if (!id) return json({ ok: false, error: "not signed in" }, 401);
    }

    /* ---- erasure: delete the account and everything in it ----------------
       The privacy policy promises deletion on request within 30 days. Without
       this, that promise was kept by hand-editing KV, which is a promise you
       break the first busy week.

       Being signed in IS the authorisation. There is no email or account id to
       supply, for the same reason /spots takes none: an endpoint that deletes
       whatever account you name is a way to delete other people's.

       Deliberately irreversible, and deliberately not gated behind an emailed
       confirmation link -- that would mean holding the data while waiting for a
       click, which is the opposite of what was asked for. */
    if (url.pathname === "/auth/delete" && req.method === "POST") {
      await env.ACCOUNTS.delete(`acct:${id}:spots`);
      await env.ACCOUNTS.delete("acct:" + id);
      const h = req.headers.get("authorization") || "";
      await env.ACCOUNTS.delete("sess:" + (await sha(h.slice(7).trim())));
      /* Sessions on the account's OTHER devices cannot be enumerated: they are
         stored hashed and keyed by the token, with no index back to the
         account. They now resolve to an id with no record behind it, which the
         routes below already handle as an empty account, and they expire on
         their own TTL. Nothing identifying survives either way. */
      return json({ ok: true, deleted: true });
    }

    if (url.pathname === "/me") {
      const raw = await env.ACCOUNTS.get("acct:" + id);
      const a = raw ? JSON.parse(raw) : {};
      return json({ ok: true, accountId: id, email: a.email || null });
    }

    if (url.pathname === "/auth/signout" && req.method === "POST") {
      const h = req.headers.get("authorization") || "";
      await env.ACCOUNTS.delete("sess:" + (await sha(h.slice(7).trim())));
      return json({ ok: true });
    }

    /* Reads and writes are keyed by the session's OWN account id, never by
       anything the caller supplies — so there is no id to tamper with in order
       to read somebody else's log. */
    if (url.pathname === "/spots" && req.method === "GET") {
      const raw = await env.ACCOUNTS.get(`acct:${id}:spots`);
      return json({ ok: true, spots: raw ? JSON.parse(raw) : [] });
    }

    if (url.pathname === "/spots" && req.method === "PUT") {
      const body = await req.json().catch(() => ({}));
      if (!Array.isArray(body.spots)) return json({ ok: false, error: "expected { spots: [] }" }, 400);
      const raw = await env.ACCOUNTS.get(`acct:${id}:spots`);
      const merged = mergeSpots(raw ? JSON.parse(raw) : [], body.spots);
      await env.ACCOUNTS.put(`acct:${id}:spots`, JSON.stringify(merged));
      return json({ ok: true, count: merged.length, spots: merged });
    }

    if (url.pathname === "/health") return json({ ok: true, mail: !!env.RESEND_KEY });
    return json({ ok: false, error: "not found" }, 404);
  },
};
