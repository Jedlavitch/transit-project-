/* ============================================================================
   account-worker.js -- accounts for the Transit Spotter, on Cloudflare Workers.

   WHY THIS SHAPE
   Four doors, one room. However you sign in, you land in the same log:

     * a six-digit code emailed to you   -- nothing to remember
     * an email address and a password   -- no inbox round-trip
     * Continue with Google              -- no new secret at all
     * Continue with Apple               -- same, and it can hide your address

   They converge because the account id is derived from the *verified* email
   address, sha256(email + salt), and nothing else. So there is no "link your
   accounts" screen to get wrong: set a password today, use Google next week,
   and it is one account because it is one address. The corollary is worth
   stating plainly -- anyone who can sign in to an email address can reach the
   account behind it, password or no password. That is true of every "forgot
   password" link ever written; it is not a weakness this design introduced.

   The one exception is Apple's Hide My Email, which hands us a per-app relay
   address instead of the real one. That relay is a perfectly good identity and
   stays stable, but it is a DIFFERENT address, so it is a different account
   from the same person's real inbox. Said out loud in ACCOUNTS.md.

   ON STORING PASSWORDS AT ALL
   The first version of this Worker stored none, and said so proudly. Passwords
   are a real cost: a breach of the KV namespace now leaks something customers
   reuse on other sites, which an emailed code never did. They buy one thing in
   return, and it is not nothing -- signing in without waiting on an email, on a
   train, in a tunnel, on the device that is already in your hand. Given that,
   they are hashed with PBKDF2-HMAC-SHA256 and the iteration count travels
   inside the stored string so it can be raised later without locking anyone
   out. Nobody is required to set one.

   WHAT IT STORES
     acct:<id>             -> { email, created, lastSeen }
     acct:<id>:spots       -> that account's sightings, and ONLY that account's
     pw:<id>               -> "pbkdf2$<rounds>$<salt64>$<hash64>"
     login:<token>         -> { email, codeHash, tries }          15-minute TTL
     sess:<tokenHash>      -> { id, via }                          400-day TTL
     oa:<state>            -> { provider, ret, nonce, verifier }   10-minute TTL
     tkt:<ticketHash>      -> { session, email }                   90-second TTL
     sub:apple:<subHash>   -> { email }                            no expiry
     asec:apple            -> the signed Apple client secret       ~4-month TTL
     rl:<bucket>           -> rate-limit counters, short TTL

   The account id is a SHA-256 of the lowercased email plus a server-side salt,
   so the id in a URL or log line can't be reversed into someone's address.
   Codes, session tokens and tickets are stored hashed for the same reason: a
   dump of the KV namespace should not hand over live sessions.

   SETUP  (all of it yours to do -- I can't create accounts on your behalf)
     1. KV -> create a namespace, bind it to this Worker as  ACCOUNTS
     2. An email sender, for the code flow. Resend is the default here (free
        tier, simple API): create an account, verify your sending domain, make
        an API key. Worker -> Settings -> Variables -> add as SECRETS:
          RESEND_KEY        your Resend API key
          MAIL_FROM         e.g. "Transit Spotter <login@yourdomain.com>"
          ID_SALT           any long random string; changing it orphans all ids
     3. Optional, and independent of each other -- each provider's buttons stay
        hidden until its own variables are present:
          ALLOWED_ORIGINS   comma-separated app origins allowed to receive a
                            sign-in. Defaults to DEFAULT_ORIGINS below. Get
                            this wrong and OAuth simply refuses; get it too
                            loose and you have built an open redirector.
          GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
          APPLE_CLIENT_ID   your Services ID, e.g. online.transitproject.signin
          APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY  (the .p8 contents)
     4. Deploy, then GET /health -- it reports which doors are actually open.

   Cloudflare's dashboard has been known to block pasting AI-written code when
   CREATING a worker. Make it from the "Hello World" template first, then use
   Edit Code to replace the contents -- that path works.
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
const STATE_TTL = 600;             // 10 minutes to get through Google or Apple
const TICKET_TTL = 90;             // the app has 90s to swap its ticket
const MIN_PASSWORD = 8;

/* PBKDF2 rounds. This is a CPU-time decision as much as a security one: the
   Workers free plan allows ~10ms of CPU per request and this is the only thing
   in here that burns a measurable amount. 100k lands in the tens of
   milliseconds, which the paid plan ($5/mo, 30s budget) swallows without
   noticing and the free plan may not. If sign-in starts returning 1102
   "exceeded CPU", either move to the paid plan or lower this -- existing
   hashes keep working either way, because each stores the count it was made
   with and only re-hashes when that password is next changed. */
const PBKDF2_ROUNDS = 100000;

/* Apple caps a client secret at six months. Four keeps us clear of the edge,
   and the cache is dropped an hour early so a request never races the expiry. */
const APPLE_SECRET_TTL = 120 * 86400;

/* Where a completed sign-in may be handed back to. An origin not on this list
   is refused before we ever talk to Google or Apple: the whole attack on this
   flow is persuading the Worker to redirect a freshly minted session to
   somewhere the attacker controls. Override with ALLOWED_ORIGINS. */
const DEFAULT_ORIGINS = [
  "https://transitproject.online",
  "https://www.transitproject.online",
  "https://jedlavitch.github.io",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

/* ---- small helpers ------------------------------------------------------- */

const enc = new TextEncoder();

async function sha(s) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(s));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const rand = (n = 32) =>
  [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, "0")).join("");

const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const b64url = bytes => b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = s => unb64(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - s.length % 4) % 4));
const b64urlJson = o => b64url(enc.encode(JSON.stringify(o)));

/* Compare without leaking where two strings first differ. */
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

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

/* ---- passwords ----------------------------------------------------------- */

async function pbkdf2(pw, salt, rounds) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: rounds }, key, 256);
  return new Uint8Array(bits);
}

async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const dk = await pbkdf2(pw, salt, PBKDF2_ROUNDS);
  return `pbkdf2$${PBKDF2_ROUNDS}$${b64(salt)}$${b64(dk)}`;
}

async function verifyPassword(pw, stored) {
  try {
    const [scheme, rounds, salt64, hash64] = String(stored).split("$");
    if (scheme !== "pbkdf2") return false;
    const dk = await pbkdf2(pw, unb64(salt64), parseInt(rounds, 10));
    return sameBytes(dk, unb64(hash64));
  } catch (_) { return false; }
}

/* Burn the same CPU on "no such account" as on "wrong password", so the
   response time can't be used to work out which addresses have accounts.
   Built rather than written out so the base64 lengths can't be wrong. */
const DECOY = `pbkdf2$${PBKDF2_ROUNDS}$${b64(new Uint8Array(16))}$${b64(new Uint8Array(32))}`;

function badPassword() {
  /* One message for wrong password, unknown address, and code-only account.
     Three different messages would be a way to enumerate customers. */
  return json({ ok: false, error: "that email and password don't match" }, 401);
}

/* ---- accounts and sessions ---------------------------------------------- */

const accountId = async (env, email) =>
  (await sha(email + "|" + (env.ID_SALT || "tb"))).slice(0, 24);

async function ensureAccount(env, id, email) {
  const existing = await env.ACCOUNTS.get("acct:" + id);
  await env.ACCOUNTS.put("acct:" + id, JSON.stringify({
    email,
    created: existing ? JSON.parse(existing).created : Date.now(),
    lastSeen: Date.now(),
  }));
  return !existing;
}

/* `via` records how this session came to exist, because it decides one thing
   later: whether changing the password needs the old one. See /auth/password/set. */
async function mintSession(env, id, via) {
  const session = rand(32);
  await env.ACCOUNTS.put("sess:" + (await sha(session)), JSON.stringify({ id, via }),
                         { expirationTtl: SESSION_TTL });
  return session;
}

/* Bearer session -> { id, via }, or null. */
async function whoami(req, env) {
  const h = req.headers.get("authorization") || "";
  const tok = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!tok) return null;
  const raw = await env.ACCOUNTS.get("sess:" + (await sha(tok)));
  return raw ? JSON.parse(raw) : null;
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
          + `If you didn't ask to sign in, you can ignore this email -- nothing has changed.`,
    }),
  });
  if (!r.ok) throw new Error("mail send failed: " + r.status);
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

/* ---- which doors are open ------------------------------------------------ */

const googleReady = env => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const appleReady = env => !!(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID &&
                             env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);

const methods = env => ({
  code: !!env.RESEND_KEY,
  password: true,
  google: googleReady(env),
  apple: appleReady(env),
});

/* ---- OAuth plumbing shared by Google and Apple -------------------------- */

const allowedOrigins = env =>
  (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(",") : DEFAULT_ORIGINS)
    .map(s => s.trim().replace(/\/+$/, "")).filter(Boolean);

/* A return target is only accepted if its ORIGIN is on the list. Path and
   query are kept (the Spotter and the account page are different pages), the
   fragment is dropped -- we are about to put our own there. */
function checkReturn(env, raw) {
  let u;
  try { u = new URL(String(raw || "")); } catch (_) { return null; }
  if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return null;
  if (!allowedOrigins(env).includes(u.origin)) return null;
  u.hash = "";
  return u.toString();
}

const redirectBase = (env, url) =>
  (env.OAUTH_REDIRECT_BASE || url.origin).replace(/\/+$/, "");

/* PKCE, so an intercepted authorization code is useless without the verifier
   we kept server-side. Belt as well as braces -- we hold a client secret too. */
async function pkce() {
  const verifier = rand(32);
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(verifier));
  return { verifier, challenge: b64url(digest) };
}

/* Read a JWT's claims WITHOUT verifying its signature.

   That is safe in exactly one place and this is it: we are reading an id_token
   that came back in the body of a request WE made, over TLS, to the provider's
   token endpoint, authenticated with our own client secret. OIDC Core 3.1.3.7
   says so in as many words -- TLS server validation may stand in for checking
   the signature when the token arrives by direct communication. Anywhere else
   (an id_token off a redirect, out of a cookie, from a client) this would be
   an authentication bypass, so it stays a local helper and iss/aud/exp/nonce
   are all still checked by the callers below. */
function claims(jwt) {
  try { return JSON.parse(new TextDecoder().decode(unb64url(String(jwt).split(".")[1]))); }
  catch (_) { return null; }
}

function claimsOk(c, iss, aud, nonce, requireNonce) {
  if (!c) return "the provider's reply could not be read";
  const issuers = Array.isArray(iss) ? iss : [iss];
  if (!issuers.includes(c.iss)) return "the provider's reply came from the wrong issuer";
  const auds = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!auds.includes(aud)) return "the provider's reply was for a different app";
  if (c.exp && c.exp * 1000 < Date.now() - 60000) return "the provider's reply had already expired";
  /* A nonce that came back wrong is always fatal. A nonce that is missing is
     only fatal where the provider is documented to echo it -- Apple's web flow
     is inconsistent about it, and the code exchange is already authenticated
     with the client secret and bound to a single-use state. */
  if (nonce && c.nonce && c.nonce !== nonce) return "the provider's reply did not match this attempt";
  if (requireNonce && !c.nonce) return "the provider's reply was missing its nonce";
  return null;
}

const GOOGLE_ISS = "https://accounts.google.com";

/* Hand the finished session back to the app as a single-use ticket in the URL
   fragment, never the session itself. A fragment is not sent to servers, does
   not reach Referer headers and does not land in the Worker's logs -- but it
   does survive in browser history and session restore, so what sits there is
   worth 90 seconds and one redemption rather than 13 months. */
async function handBack(env, ret, session, email) {
  const ticket = rand(24);
  await env.ACCOUNTS.put("tkt:" + (await sha(ticket)), JSON.stringify({ session, email }),
                         { expirationTtl: TICKET_TTL });
  return Response.redirect(ret + "#tbauth=" + encodeURIComponent(ticket), 302);
}

const handBackError = (ret, msg) =>
  Response.redirect(ret + "#tbauth_error=" + encodeURIComponent(msg), 302);

/* ---- Apple's client secret is a JWT you sign yourself -------------------
   Apple does not issue a static secret; you sign a short-lived ES256 assertion
   with the .p8 key from the developer portal. WebCrypto's ECDSA output is
   already the raw r||s pair that JWS wants, so no DER unpicking is needed. The
   result is cached because signing it on every sign-in is pure waste. */
async function appleClientSecret(env) {
  const cached = await env.ACCOUNTS.get("asec:apple");
  if (cached) return cached;

  /* Accept the .p8 however it survived the trip through a settings form:
     real newlines, escaped \n, or the bare base64 with the armour stripped. */
  const pem = String(env.APPLE_PRIVATE_KEY).replace(/\\n/g, "\n");
  const body = pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8", unb64(body), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const now = Math.floor(Date.now() / 1000);
  const signingInput =
    b64urlJson({ alg: "ES256", kid: env.APPLE_KEY_ID }) + "." +
    b64urlJson({
      iss: env.APPLE_TEAM_ID, iat: now, exp: now + APPLE_SECRET_TTL,
      aud: "https://appleid.apple.com", sub: env.APPLE_CLIENT_ID,
    });
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, key, enc.encode(signingInput));

  const jwt = signingInput + "." + b64url(sig);
  await env.ACCOUNTS.put("asec:apple", jwt, { expirationTtl: APPLE_SECRET_TTL - 3600 });
  return jwt;
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
      catch (e) { return json({ ok: false, error: "couldn't send the email -- check the Worker's mail settings" }, 502); }

      /* The token identifies WHICH sign-in attempt; the code proves it's you.
         Returning the token is safe, returning the code would not be. */
      return json({ ok: true, token, expiresIn: CODE_TTL });
    }

    /* ---- step 2: prove it with the code -------------------------------- */
    if (url.pathname === "/auth/verify" && req.method === "POST") {
      const { token, code } = await req.json().catch(() => ({}));
      const raw = token ? await env.ACCOUNTS.get("login:" + token) : null;
      if (!raw) return json({ ok: false, error: "that code has expired -- ask for a new one" }, 400);
      const rec = JSON.parse(raw);

      if (rec.tries >= MAX_TRIES) {
        await env.ACCOUNTS.delete("login:" + token);
        return json({ ok: false, error: "too many wrong codes -- ask for a new one" }, 429);
      }
      if ((await sha(String(code || "").trim())) !== rec.codeHash) {
        rec.tries++;
        await env.ACCOUNTS.put("login:" + token, JSON.stringify(rec), { expirationTtl: CODE_TTL });
        return json({ ok: false, error: "that code doesn't match", triesLeft: MAX_TRIES - rec.tries }, 401);
      }
      await env.ACCOUNTS.delete("login:" + token);          // one code, one use

      const id = await accountId(env, rec.email);
      const isNew = await ensureAccount(env, id, rec.email);
      const session = await mintSession(env, id, "code");
      return json({ ok: true, session, accountId: id, email: rec.email, isNew,
                    hasPassword: !!(await env.ACCOUNTS.get("pw:" + id)) });
    }

    /* ---- sign in with an email address and a password ------------------- */
    if (url.pathname === "/auth/password" && req.method === "POST") {
      const { email, password } = await req.json().catch(() => ({}));
      const addr = normEmail(email);
      const pw = String(password || "");
      if (!looksLikeEmail(addr) || !pw) return badPassword();

      /* Tighter than the code path, and deliberately so: a mailed code is
         useless to a guesser after 15 minutes, whereas a password is worth
         trying forever. Per-IP is loose enough for an office behind one NAT. */
      if (!(await rateLimit(env, "pwip:" + ip, 30, 3600)))
        return json({ ok: false, error: "too many attempts from this connection, try again later" }, 429);
      if (!(await rateLimit(env, "pwem:" + (await sha(addr)), 8, 3600)))
        return json({ ok: false, error: "too many attempts on that account, try again later" }, 429);

      const id = await accountId(env, addr);
      const stored = await env.ACCOUNTS.get("pw:" + id);
      if (!(await verifyPassword(pw, stored || DECOY)) || !stored) return badPassword();

      await ensureAccount(env, id, addr);
      const session = await mintSession(env, id, "password");
      return json({ ok: true, session, accountId: id, email: addr, hasPassword: true });
    }

    /* ---- start a Google or Apple sign-in -------------------------------
       GET, not POST, because the browser is about to be sent to the provider
       and the app just points the window at this URL. */
    const startMatch = url.pathname.match(/^\/auth\/(google|apple)\/start$/);
    if (startMatch && req.method === "GET") {
      const provider = startMatch[1];
      if (provider === "google" && !googleReady(env))
        return json({ ok: false, error: "Google sign-in isn't configured on this server" }, 501);
      if (provider === "apple" && !appleReady(env))
        return json({ ok: false, error: "Apple sign-in isn't configured on this server" }, 501);

      const ret = checkReturn(env, url.searchParams.get("return"));
      if (!ret) return json({ ok: false, error: "that return address isn't on this server's allow-list" }, 400);
      if (!(await rateLimit(env, "oa:" + ip, 30, 3600)))
        return json({ ok: false, error: "too many sign-in attempts, try again later" }, 429);

      const state = rand(16), nonce = rand(16);
      const { verifier, challenge } = await pkce();
      await env.ACCOUNTS.put("oa:" + state, JSON.stringify({ provider, ret, nonce, verifier }),
                             { expirationTtl: STATE_TTL });

      const redirect = `${redirectBase(env, url)}/auth/${provider}/callback`;
      const q = new URLSearchParams({
        response_type: "code", redirect_uri: redirect, state, nonce,
      });

      if (provider === "google") {
        q.set("client_id", env.GOOGLE_CLIENT_ID);
        q.set("scope", "openid email");
        q.set("code_challenge", challenge);
        q.set("code_challenge_method", "S256");
        /* Without this, a signed-out visitor sees a blank Google page rather
           than an account chooser. */
        q.set("prompt", "select_account");
        return Response.redirect("https://accounts.google.com/o/oauth2/v2/auth?" + q, 302);
      }

      q.set("client_id", env.APPLE_CLIENT_ID);
      q.set("scope", "email");
      /* Asking Apple for a scope obliges you to take the reply as a POSTed
         form rather than a query string. Not optional -- Apple rejects the
         request otherwise. PKCE is left off here: Apple's web flow does not
         document it, and the client secret already authenticates the exchange. */
      q.set("response_mode", "form_post");
      return Response.redirect("https://appleid.apple.com/auth/authorize?" + q, 302);
    }

    /* ---- come back from Google or Apple -------------------------------- */
    const cbMatch = url.pathname.match(/^\/auth\/(google|apple)\/callback$/);
    if (cbMatch && (req.method === "GET" || req.method === "POST")) {
      const provider = cbMatch[1];

      /* Google returns in the query string; Apple form-POSTs (see above). */
      let params = url.searchParams;
      let appleUser = null;
      if (req.method === "POST") {
        const form = new URLSearchParams(await req.text());
        params = form;
        appleUser = form.get("user");     // name and email, first authorisation only
      }

      const state = params.get("state") || "";
      const raw = state ? await env.ACCOUNTS.get("oa:" + state) : null;
      if (!raw) {
        /* No state means no idea where to send them, so this is the one error
           that has to be rendered rather than redirected.

           Worth knowing which way this can fail wrongly: KV is eventually
           consistent, so a state written when the sign-in started is not
           guaranteed to be readable at a different Cloudflare location. In
           practice the same customer's callback lands at the same location and
           reads its own write, but a rare "expired" on a sign-in that plainly
           was not is this, not the customer doing anything wrong -- which is
           why the message asks them to try again rather than blaming them. */
        return json({ ok: false, error: "that sign-in didn't complete -- please try again from the app" }, 400);
      }
      await env.ACCOUNTS.delete("oa:" + state);          // one state, one use
      const att = JSON.parse(raw);
      if (att.provider !== provider) return json({ ok: false, error: "provider mismatch" }, 400);

      /* The customer pressed cancel, or the provider refused. */
      if (params.get("error")) {
        return handBackError(att.ret, params.get("error") === "access_denied"
          ? "Sign-in was cancelled." : "The provider refused that sign-in.");
      }
      const code = params.get("code");
      if (!code) return handBackError(att.ret, "The provider didn't send a sign-in code back.");

      const redirect = `${redirectBase(env, url)}/auth/${provider}/callback`;
      const body = new URLSearchParams({
        grant_type: "authorization_code", code, redirect_uri: redirect,
      });

      let tokenUrl, issuer, audience;
      if (provider === "google") {
        tokenUrl = "https://oauth2.googleapis.com/token";
        issuer = [GOOGLE_ISS, "accounts.google.com"];
        audience = env.GOOGLE_CLIENT_ID;
        body.set("client_id", env.GOOGLE_CLIENT_ID);
        body.set("client_secret", env.GOOGLE_CLIENT_SECRET);
        body.set("code_verifier", att.verifier);
      } else {
        tokenUrl = "https://appleid.apple.com/auth/token";
        issuer = "https://appleid.apple.com";
        audience = env.APPLE_CLIENT_ID;
        body.set("client_id", env.APPLE_CLIENT_ID);
        try { body.set("client_secret", await appleClientSecret(env)); }
        catch (e) { return handBackError(att.ret, "Apple sign-in is misconfigured on the server."); }
      }

      let tok;
      try {
        const r = await fetch(tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        });
        tok = await r.json();
        if (!r.ok || !tok.id_token) throw new Error((tok && tok.error) || "no id_token");
      } catch (e) {
        return handBackError(att.ret, "Couldn't complete the sign-in with that provider.");
      }

      const c = claims(tok.id_token);
      const bad = claimsOk(c, issuer, audience, att.nonce, provider === "google");
      if (bad) return handBackError(att.ret, bad);

      /* Work out the verified address.

         Google always sends one, and email_verified tells us whether Google
         actually checked it -- an unverified address must not be trusted, or
         someone could sign up to Google with a stranger's address and inherit
         the stranger's account.

         Apple sends the address on the FIRST authorisation only. Afterwards
         you get nothing but `sub`, so the mapping is stored the first time and
         read back on every visit after. Miss this and returning customers
         quietly land in a brand-new empty account. */
      let addr = normEmail(c.email);
      const claimVerified = c.email_verified === true || c.email_verified === "true";

      if (provider === "google") {
        if (!addr || !claimVerified)
          return handBackError(att.ret, "That Google address isn't verified, so it can't be used to sign in.");
      } else {
        const subKey = "sub:apple:" + (await sha(String(c.sub || "")));
        if (!addr && appleUser) {
          try { addr = normEmail(JSON.parse(appleUser).email); } catch (_) {}
        }
        if (addr) {
          /* Apple marks both real and Hide-My-Email relay addresses verified.
             An explicit false is a reason to stop, not to guess -- but only
             when Apple actually sent an address to make a claim about. */
          if (c.email && !claimVerified)
            return handBackError(att.ret, "Apple reported that address as unverified.");
          if (c.sub) await env.ACCOUNTS.put(subKey, JSON.stringify({ email: addr }));
        } else {
          const known = await env.ACCOUNTS.get(subKey);
          if (known) addr = normEmail(JSON.parse(known).email);
        }
        if (!addr) return handBackError(att.ret,
          "Apple didn't share an email address, so there's nothing to attach the account to.");
      }

      if (!looksLikeEmail(addr)) return handBackError(att.ret, "The provider sent an address we can't use.");

      const id = await accountId(env, addr);
      await ensureAccount(env, id, addr);
      const session = await mintSession(env, id, provider);
      return handBack(env, att.ret, session, addr);
    }

    /* ---- swap the one-time ticket for the session ----------------------- */
    if (url.pathname === "/auth/ticket" && req.method === "POST") {
      const { ticket } = await req.json().catch(() => ({}));
      const key = "tkt:" + (await sha(String(ticket || "")));
      const raw = ticket ? await env.ACCOUNTS.get(key) : null;
      /* Same eventual-consistency caveat as the state above, and a tighter
         window -- this is read a second or two after it was written. Deliberately
         phrased as "try again", because a retry genuinely fixes both the
         already-used case and the rare stale-read case. */
      if (!raw) return json({ ok: false, error: "that sign-in couldn't be completed -- please try again" }, 400);
      await env.ACCOUNTS.delete(key);                     // one ticket, one use
      const rec = JSON.parse(raw);
      const id = await accountId(env, rec.email);
      return json({ ok: true, session: rec.session, email: rec.email, accountId: id,
                    hasPassword: !!(await env.ACCOUNTS.get("pw:" + id)) });
    }

    if (url.pathname === "/health") {
      /* `mail` is kept as it was so anything already checking it still works. */
      return json({ ok: true, mail: !!env.RESEND_KEY, methods: methods(env) });
    }

    /* ---- everything below needs a session ------------------------------ */
    const sess = await whoami(req, env);
    const id = sess && sess.id;
    if (url.pathname.startsWith("/spots") || url.pathname === "/me"
        || url.pathname.startsWith("/auth/password/")
        || url.pathname === "/auth/signout" || url.pathname === "/auth/delete") {
      if (!id) return json({ ok: false, error: "not signed in" }, 401);
    }

    /* ---- set, change, or remove the password ---------------------------
       Requiring the CURRENT password to change it is the usual rule, and it is
       here -- with one exception that stops the rule becoming a lockout. A
       session created by emailed code, Google or Apple has just proved control
       of the address itself, which is strictly stronger than knowing the old
       password; forcing such a person to produce a password they have
       forgotten would leave them no way back in at all. A session created BY a
       password does not get that shortcut, so a borrowed phone can't be used
       to quietly take the account over. */
    if (url.pathname === "/auth/password/set" && req.method === "POST") {
      const { password, current } = await req.json().catch(() => ({}));
      const stored = await env.ACCOUNTS.get("pw:" + id);
      const proved = sess.via === "code" || sess.via === "google" || sess.via === "apple";

      if (stored && !proved) {
        if (!current) return json({ ok: false, error: "enter your current password" }, 400);
        if (!(await verifyPassword(String(current), stored)))
          return json({ ok: false, error: "that current password doesn't match" }, 401);
      }

      const pw = String(password == null ? "" : password);
      if (!pw) {
        /* Removing it is a legitimate choice -- it puts the account back to
           code-and-provider sign-in, which is where it started. */
        await env.ACCOUNTS.delete("pw:" + id);
        return json({ ok: true, hasPassword: false });
      }
      if (pw.length < MIN_PASSWORD)
        return json({ ok: false, error: `passwords need at least ${MIN_PASSWORD} characters` }, 400);

      const acct = await env.ACCOUNTS.get("acct:" + id);
      const email = acct ? JSON.parse(acct).email : "";
      if (email && pw.toLowerCase() === email.toLowerCase())
        return json({ ok: false, error: "that's your email address, not a password" }, 400);

      await env.ACCOUNTS.put("pw:" + id, await hashPassword(pw));
      return json({ ok: true, hasPassword: true });
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
      await env.ACCOUNTS.delete("pw:" + id);
      const h = req.headers.get("authorization") || "";
      await env.ACCOUNTS.delete("sess:" + (await sha(h.slice(7).trim())));
      /* Sessions on the account's OTHER devices cannot be enumerated: they are
         stored hashed and keyed by the token, with no index back to the
         account. They now resolve to an id with no record behind it, which the
         routes below already handle as an empty account, and they expire on
         their own TTL. Nothing identifying survives either way.

         The Apple sub -> email mapping is keyed by a hash of the sub, which we
         don't have here, so it outlives the account. It holds an address and
         nothing else, and signing in with Apple again simply recreates the
         account from scratch -- same as signing in with a code would. */
      return json({ ok: true, deleted: true });
    }

    if (url.pathname === "/me") {
      const raw = await env.ACCOUNTS.get("acct:" + id);
      const a = raw ? JSON.parse(raw) : {};
      return json({ ok: true, accountId: id, email: a.email || null,
                    hasPassword: !!(await env.ACCOUNTS.get("pw:" + id)),
                    via: sess.via || "code", methods: methods(env) });
    }

    if (url.pathname === "/auth/signout" && req.method === "POST") {
      const h = req.headers.get("authorization") || "";
      await env.ACCOUNTS.delete("sess:" + (await sha(h.slice(7).trim())));
      return json({ ok: true });
    }

    /* Reads and writes are keyed by the session's OWN account id, never by
       anything the caller supplies -- so there is no id to tamper with in order
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

    return json({ ok: false, error: "not found" }, 404);
  },
};
