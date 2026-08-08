/* ============================================================================
   account.js — client side of Spotter accounts.

   Dormant until an account-worker.js URL is saved (localStorage "tb.acctUrl"),
   exactly like the licensing module: with nothing configured the app stays
   local-only and nothing here ever runs a request. Signing in is optional even
   then — it buys you the same log on a second device, nothing more.

   The sync is a merge, never a replace. Two devices that were both offline can
   each have sightings the other has never seen, and whoever syncs second must
   not wipe the first. Union by sighting id; if both have the same id, the newer
   edit wins.
   ============================================================================ */
(function () {
  "use strict";

  /* Bake the account server in here before shipping a paid copy — a buyer has
     no way to know the URL, and leaving it blank means the app starts unlocked.
     localStorage still overrides it, which is what makes local development and
     self-hosting possible. */
  const CFG = { workerUrl: "" };   // e.g. "https://tbaccounts.you.workers.dev"

  const LS = { url: "tb.acctUrl", session: "tb.acctSession", email: "tb.acctEmail", spots: "tb.spots" };
  const get = k => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
  const set = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (_) {} };

  const url = () => (get(LS.url) || CFG.workerUrl).trim().replace(/\/+$/, "");
  const session = () => get(LS.session);
  const configured = () => !!url();
  const signedIn = () => !!(url() && session());

  const readSpots = () => { try { return JSON.parse(get(LS.spots) || "[]"); } catch (_) { return []; } };
  const writeSpots = a => { try { localStorage.setItem(LS.spots, JSON.stringify(a)); } catch (_) {} };

  async function api(path, opts) {
    const o = opts || {};
    const headers = Object.assign({ "content-type": "application/json" }, o.headers || {});
    if (session()) headers.authorization = "Bearer " + session();
    const r = await fetch(url() + path, { method: o.method || "GET", headers, body: o.body });
    let d = null;
    try { d = await r.json(); } catch (_) {}
    if (!r.ok || !d || d.ok === false) {
      const msg = (d && d.error) || ("request failed (" + r.status + ")");
      const err = new Error(msg); err.status = r.status; throw err;
    }
    return d;
  }

  /* Same merge rule as the Worker's, so a device that syncs and a device that
     doesn't end up agreeing rather than diverging. */
  function merge(a, b) {
    const by = {};
    const stamp = x => (x.edited || x.ts || 0);
    for (const s of a.concat(b)) {
      if (!s || !s.id) continue;
      const prev = by[s.id];
      if (!prev || stamp(s) >= stamp(prev)) by[s.id] = s;
    }
    return Object.values(by).sort((x, y) => (y.ts || 0) - (x.ts || 0));
  }

  const TBAccount = {
    configured, signedIn,
    email: () => get(LS.email),
    setUrl(v) { set(LS.url, (v || "").trim().replace(/\/+$/, "")); },
    url,

    /* Step 1 — ask for a code. Returns a token identifying this attempt. */
    async start(addr) {
      if (!configured()) throw new Error("no account server configured");
      const d = await api("/auth/start", { method: "POST", body: JSON.stringify({ email: addr }) });
      return d.token;
    },

    /* Step 2 — hand back the code from the email. */
    async verify(token, code) {
      const d = await api("/auth/verify", { method: "POST", body: JSON.stringify({ token, code }) });
      set(LS.session, d.session);
      set(LS.email, d.email || "");
      await TBAccount.sync();      // first sign-in pulls anything already stored
      return d;
    },

    async signOut() {
      /* Local sightings are deliberately left alone: signing out is not
         "delete my data", and someone signing out on a borrowed phone would be
         astonished to lose their log. */
      try { await api("/auth/signout", { method: "POST" }); } catch (_) {}
      set(LS.session, ""); set(LS.email, "");
    },

    /* Pull, merge, push, and keep the merged copy locally. Safe to call often;
       it no-ops when signed out. */
    async sync() {
      if (!signedIn()) return null;
      const remote = (await api("/spots")).spots || [];
      const merged = merge(readSpots(), remote);
      writeSpots(merged);
      const saved = await api("/spots", { method: "PUT", body: JSON.stringify({ spots: merged }) });
      if (Array.isArray(saved.spots)) writeSpots(saved.spots);
      return { count: (saved.spots || merged).length };
    },

    _merge: merge,   // exposed for tests
  };

  window.TBAccount = TBAccount;
})();
