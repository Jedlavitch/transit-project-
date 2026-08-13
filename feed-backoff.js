/* ============================================================================
   feed-backoff.js — stop asking a feed that is not answering.

   THE PROBLEM
   Every board drives ten to seventeen refresh loops on fixed intervals. When an
   agency's API goes down, or a key expires, or a host starts refusing us, none
   of that changes: the loops keep firing at full cadence, for days, at a screen
   nobody is standing in front of. A board on a wall over a long weekend can put
   thousands of pointless requests at a dead host — which is how a temporary
   outage turns into a rate-limit ban, and a rate-limit ban outlives the outage
   that caused it.

   WHY THIS IS ONE FILE AND NOT A HUNDRED EDITS
   Seventeen boards carry a getJSON() helper, in five slightly different shapes,
   wrapping a few dozen call sites between them. Patching those by hand is a lot
   of edits to get subtly wrong. But every one of them ends up at window.fetch,
   so that is where this sits: one wrapper, no board changes, and any feed added
   later is covered the day it is written.

   THE RULES, and why each one is the way it is:

     SAME ORIGIN IS NEVER GATED. Our own host serves the page, the bundled
     timetables, and the reachability probe kiosk-reload.js uses to decide
     whether it is safe to restart. Throttling that would break the very check
     that protects the board.

     THREE STRIKES, NOT ONE. A single failed request is ordinary — a lost packet
     on a kitchen wifi is not an outage, and gating on it would make the board
     worse at exactly the moment it is coping fine.

     ONLY REAL OUTAGES COUNT. A rejection (nothing answered), a 429 (asked to
     slow down) or a 5xx (answered badly). A 404 is a definite answer from a
     healthy server; treating it as an outage would silence a feed whose URL is
     merely wrong, and hide the bug.

     RETRY-AFTER WINS. If a host tells us when to come back, that is not a hint
     to be improved on. Honouring it is the whole difference between a client
     that gets rate-limited and one that does not.

     JITTER. Wall displays are all started from the same page and tick on the
     same intervals. Without jitter, every board that shares an outage comes
     back at the same instant and re-creates it.

   WHAT A GATED REQUEST LOOKS LIKE to the board: a rejected promise, which is
   exactly what a failed fetch already produces, so the existing catch blocks
   handle it with no changes. The board shows the data it already had — which
   these boards do well; they were measured holding a full screen of rows
   through thirty-five seconds of total network failure.

   ES5, like the rest of the television-facing code.
   Set window.TB_NO_FEED_BACKOFF = true before this loads to disable it.
   ============================================================================ */
(function () {
  "use strict";

  if (window.TB_NO_FEED_BACKOFF) return;
  if (!window.fetch || window.__tbBackoffOn) return;
  window.__tbBackoffOn = true;

  var GRACE   = 3;            // consecutive failures before a host is gated
  var LADDER  = [30000, 60000, 120000, 300000, 600000, 900000];   // 30s -> 15m
  var MAX_WAIT = 15 * 60000;  // never trust a Retry-After longer than this

  var hosts = {};             // host -> { fails, until }

  function nowMs() { return Date.now(); }

  function urlOf(input) {
    try {
      if (typeof input === "string") return input;
      if (input && typeof input.url === "string") return input.url;   // a Request
      return String(input);
    } catch (_) { return ""; }
  }
  function hostOf(url) {
    try {
      // Relative URLs resolve against this page, so they land on our own host
      // and are therefore never gated -- which is the intent.
      return new URL(url, location.href).host;
    } catch (_) { return ""; }
  }

  function state(host) {
    if (!hosts[host]) hosts[host] = { fails: 0, until: 0 };
    return hosts[host];
  }

  /* Spread the return so a hundred kiosks sharing an outage do not all come
     back on the same second and rebuild it. */
  function jitter(ms) { return Math.round(ms * (0.85 + Math.random() * 0.3)); }

  function noteFail(host, retryAfterMs) {
    var st = state(host);
    st.fails++;
    if (st.fails < GRACE) return;
    var step = LADDER[Math.min(st.fails - GRACE, LADDER.length - 1)];
    /* A host that names its own cooldown is the authority on it; we only refuse
       to be parked for longer than MAX_WAIT, so one bad header cannot take a
       feed out for the rest of the day. */
    var wait = retryAfterMs != null ? Math.min(retryAfterMs, MAX_WAIT) : jitter(step);
    st.until = nowMs() + wait;
  }
  function noteOk(host) {
    var st = hosts[host];
    if (st) { st.fails = 0; st.until = 0; }
  }

  /* Seconds, or an HTTP date. Anything else is ignored rather than guessed at. */
  function retryAfterOf(res) {
    try {
      var h = res.headers && res.headers.get && res.headers.get("Retry-After");
      if (!h) return null;
      if (/^\d+$/.test(h.trim())) return parseInt(h.trim(), 10) * 1000;
      var when = Date.parse(h);
      if (!isNaN(when)) { var d = when - nowMs(); return d > 0 ? d : 0; }
    } catch (_) {}
    return null;
  }

  var realFetch = window.fetch.bind(window);

  window.fetch = function (input, init) {
    var host;
    try { host = hostOf(urlOf(input)); } catch (_) { host = ""; }

    // Our own origin, or anything we cannot parse, goes straight through.
    if (!host || host === location.host) return realFetch(input, init);

    var st = hosts[host];
    if (st && st.until > nowMs()) {
      var left = Math.ceil((st.until - nowMs()) / 1000);
      var err = new Error("tb-backoff: " + host + " is cooling down for " + left + "s");
      err.tbBackoff = true;
      err.tbHost = host;
      return Promise.reject(err);
    }

    return realFetch(input, init).then(function (res) {
      if (res && (res.status === 429 || res.status >= 500)) noteFail(host, retryAfterOf(res));
      else noteOk(host);
      return res;                    // untouched: callers see exactly what they would have
    }, function (err) {
      /* Timeouts count. getJSON aborts its own request after ~12s, so most
         failures here arrive as AbortError rather than a network error — and a
         host that cannot answer inside twelve seconds is not serving this board
         either. Excluding them would exempt the slowest hosts, which are
         precisely the ones worth asking less often. */
      noteFail(host, null);
      throw err;                     // rethrow the original, so callers are unaffected
    });
  };

  window.TBFeedBackoff = {
    hosts: function () {
      var out = {};
      for (var h in hosts) if (Object.prototype.hasOwnProperty.call(hosts, h)) {
        out[h] = { fails: hosts[h].fails, msLeft: Math.max(0, hosts[h].until - nowMs()) };
      }
      return out;
    },
    gated: function (host) { var s = hosts[host]; return !!(s && s.until > nowMs()); },
    reset: function (host) { if (host) delete hosts[host]; else hosts = {}; },
    config: { grace: GRACE, ladder: LADDER, maxWait: MAX_WAIT }
  };
})();
