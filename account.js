/* ============================================================================
   account.js — client side of Spotter accounts.

   Dormant until an account-worker.js URL is saved (localStorage "tb.acctUrl"),
   exactly like the licensing module: with nothing configured the app stays
   local-only and nothing here ever runs a request. Signing in is optional even
   then — it buys you the same log on a second device, nothing more.

   Four ways in, and the module does not care which you pick: an emailed code,
   an email and password, Google, or Apple. They all end in the same session
   token because the Worker derives the account from the verified address. Which
   of them the UI should actually offer is not for this file to guess — ask
   methods(), which reports what the server has been configured with. A button
   for a provider that has no client id behind it is worse than no button.

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

  const LS = { url: "tb.acctUrl", session: "tb.acctSession", email: "tb.acctEmail",
               hasPw: "tb.acctHasPw", spots: "tb.spots" };
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

  /* Remember the session and who it belongs to. Every door ends up here. */
  function adopt(d) {
    set(LS.session, d.session);
    set(LS.email, d.email || "");
    set(LS.hasPw, d.hasPassword ? "1" : "");
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

  /* ── coming back from Google or Apple ────────────────────────────────────
     The Worker sends the browser back with a single-use ticket in the URL
     fragment. Grab it and scrub the address bar NOW, at load, synchronously:
     a ticket left sitting in the URL survives into history, bookmarks and a
     shared screenshot, and any later reload would try to redeem it a second
     time and report a confusing failure. Whatever else was in the fragment is
     put back untouched, because it may belong to the page rather than to us. */
  let returned = null;             // { ticket } | { error } | null

  (function grabReturn() {
    try {
      const raw = location.hash.replace(/^#/, "");
      if (!raw || raw.indexOf("tbauth") === -1) return;
      const q = new URLSearchParams(raw);
      const ticket = q.get("tbauth"), error = q.get("tbauth_error");
      if (!ticket && !error) return;
      q.delete("tbauth"); q.delete("tbauth_error");
      returned = ticket ? { ticket } : { error };
      const rest = q.toString();
      history.replaceState(null, "", location.pathname + location.search + (rest ? "#" + rest : ""));
    } catch (_) { /* a hash we can't parse is not worth breaking startup over */ }
  })();

  const TBAccount = {
    configured, signedIn,
    email: () => get(LS.email),
    hasPassword: () => get(LS.hasPw) === "1",
    setUrl(v) { set(LS.url, (v || "").trim().replace(/\/+$/, "")); },
    url,

    /* Which doors this server actually has open. Cached for the page's life —
       it changes only when the Worker is reconfigured, and the sign-in screen
       asks for it on every repaint. Never throws: a server that can't be
       reached is reported as code-only, which is what the app did before any
       of this existed. */
    _methods: null,
    async methods() {
      if (!configured()) return { code: false, password: false, google: false, apple: false };
      if (TBAccount._methods) return TBAccount._methods;
      try {
        const d = await api("/health");
        TBAccount._methods = d.methods ||
          { code: !!d.mail, password: false, google: false, apple: false };
      } catch (_) {
        TBAccount._methods = { code: true, password: true, google: false, apple: false };
      }
      return TBAccount._methods;
    },

    /* Step 1 — ask for a code. Returns a token identifying this attempt. */
    async start(addr) {
      if (!configured()) throw new Error("no account server configured");
      const d = await api("/auth/start", { method: "POST", body: JSON.stringify({ email: addr }) });
      return d.token;
    },

    /* Step 2 — hand back the code from the email. */
    async verify(token, code) {
      const d = adopt(await api("/auth/verify", { method: "POST", body: JSON.stringify({ token, code }) }));
      await TBAccount.sync();      // first sign-in pulls anything already stored
      return d;
    },

    /* The other way in with an address: a password, no inbox round-trip. */
    async signInPassword(addr, password) {
      if (!configured()) throw new Error("no account server configured");
      const d = adopt(await api("/auth/password", {
        method: "POST", body: JSON.stringify({ email: addr, password }),
      }));
      await TBAccount.sync();
      return d;
    },

    /* Set, change, or (with an empty password) remove it. `current` is only
       needed when changing a password while signed in BY a password — the
       Worker decides, and says so in the error if it is missing. */
    async setPassword(password, current) {
      const d = await api("/auth/password/set", {
        method: "POST", body: JSON.stringify({ password, current }),
      });
      set(LS.hasPw, d.hasPassword ? "1" : "");
      return d;
    },

    /* ── Google / Apple ───────────────────────────────────────────────────
       This leaves the page. `ret` is where the Worker should send the browser
       back to, and it has to be on the Worker's allow-list or the whole thing
       is refused before any provider is contacted. Default: right back here,
       minus any fragment. */
    oauthUrl(provider, ret) {
      const back = (ret || (location.origin + location.pathname + location.search));
      return url() + "/auth/" + provider + "/start?return=" + encodeURIComponent(back);
    },
    oauthGo(provider, ret) { location.assign(TBAccount.oauthUrl(provider, ret)); },

    /* True when this page load is the browser arriving back from a provider,
       so the caller knows to wait rather than flashing a sign-in screen at
       somebody who has just signed in. */
    returning: () => !!returned,

    /* Finish that arrival. Resolves to { ok:true, email } on success,
       { ok:false, error } if the provider or the ticket failed, and null when
       this load is nothing to do with a provider. Safe to call once. */
    async completeReturn() {
      const r = returned;
      returned = null;
      if (!r) return null;
      if (r.error) return { ok: false, error: r.error };
      try {
        const d = adopt(await api("/auth/ticket", {
          method: "POST", body: JSON.stringify({ ticket: r.ticket }),
        }));
        await TBAccount.sync();
        return { ok: true, email: d.email };
      } catch (e) {
        return { ok: false, error: e.message || "that sign-in could not be completed" };
      }
    },

    async signOut() {
      /* Local sightings are deliberately left alone: signing out is not
         "delete my data", and someone signing out on a borrowed phone would be
         astonished to lose their log. */
      try { await api("/auth/signout", { method: "POST" }); } catch (_) {}
      set(LS.session, ""); set(LS.email, ""); set(LS.hasPw, "");
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
