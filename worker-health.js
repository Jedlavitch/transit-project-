/* ============================================================================
   worker-health.js — says so when a configured live-position Worker has died.

   THE FAILURE THIS CATCHES
     A system with a Worker URL saved is supposed to show exact live vehicle
     positions. Every one of those fetches is wrapped in `catch(e){ return; }` —
     correctly, because a board must not break when a feed hiccups — so when the
     Worker is gone the board silently falls back to its bundled timetable and
     keeps running. Nothing says the live half stopped.

     That is not hypothetical here. This project has already lost a Worker URL
     once: `summer-block-cb49.jacklemonade2.workers.dev` was deleted and any
     device still holding it got HTTP 404 with `error code: 1042` forever. The
     board carried on drawing scheduled positions and looked completely fine.

   WHAT IT DOES
     Watches requests to whatever Worker URLs are actually configured, and after
     two consecutive failures puts one chip on screen naming the system. A single
     failed request is ignored — feeds hiccup, and a board that cries wolf on
     every blip gets ignored. Recovers on the next success.

   DORMANT BY DEFAULT: a system with no Worker URL saved is not watched at all,
   because falling back to the timetable is that system's normal state, not a
   fault. Only a Worker you configured and are therefore relying on can fail.
   ============================================================================ */
(function () {
  "use strict";

  /* Storage key -> what a person calls that system. The keys are the ones
     config.js writes, so anything set once in the deploy is watched everywhere
     with no per-board wiring. */
  const WATCH = {
    "transitboard.marcUrl":     "MARC live positions",
    "transitboardphl.septaUrl": "SEPTA live positions",
    "transitboardnyc.busUrl":   "MTA Bus live positions",
    "transitboardnyc.pathUrl":  "PATH live times",
    "transitboardnj.njtUrl":    "NJ Transit live buses",
    "transitboardsf.liveUrl":   "SF 511 live positions",
    "transitboardams.liveUrl":  "Amsterdam OVapi live",
    "tb.spotFeedUrl":           "Spotter shared feed",
    "tb.acctUrl":               "Accounts sign-in",
    "tb.feedProxy":             "Licensed feed proxy",
  };
  const FAILS_BEFORE_COMPLAINING = 2;

  const state = {};        // label -> {fails, lastOk, lastErr}

  function configured() {
    const out = [];
    Object.keys(WATCH).forEach(k => {
      let v = "";
      try { v = (localStorage.getItem(k) || "").trim(); } catch (_) {}
      if (!v) return;                       // not configured: not watched
      try { out.push({ origin: new URL(v).origin, label: WATCH[k], url: v }); } catch (_) {}
    });
    return out;
  }

  function match(href) {
    let u;
    try { u = new URL(href, location.href); } catch (_) { return null; }
    return configured().find(w => u.origin === w.origin) || null;
  }

  function record(label, ok, why) {
    const s = state[label] || (state[label] = { fails: 0, lastOk: 0, lastErr: "" });
    if (ok) { s.fails = 0; s.lastOk = Date.now(); s.lastErr = ""; }
    else { s.fails++; s.lastErr = why || "unreachable"; }
    paint();
  }

  function paint() {
    const bad = Object.keys(state).filter(k => state[k].fails >= FAILS_BEFORE_COMPLAINING);
    let chip = document.getElementById("tbWorkerChip");
    if (!bad.length) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "tbWorkerChip";
      // sits above the timetable chip so the two never overlap
      chip.style.cssText = "position:fixed;right:12px;bottom:52px;z-index:9998;max-width:44ch;" +
        "font:600 11px/1.45 ui-monospace,Menlo,monospace;letter-spacing:.03em;padding:7px 11px;" +
        "border-radius:6px;background:rgba(20,10,0,.92);color:#ffb454;border:1px solid #8a5a1f";
      (document.body || document.documentElement).appendChild(chip);
    }
    chip.textContent = bad.length === 1
      ? `${bad[0]} is not responding — showing scheduled times instead.`
      : `${bad.length} live feeds are not responding — showing scheduled times instead.`;
    chip.title = bad.map(b => `${b} — ${state[b].lastErr}`).join("\n");
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    let href = "";
    try { href = typeof input === "string" ? input : (input && input.url) || ""; } catch (_) {}
    const w = href ? match(href) : null;
    if (!w) return realFetch(input, init);
    return realFetch(input, init).then(res => {
      if (res.ok) { record(w.label, true); return res; }
      /* A 404 does NOT mean the Worker is gone, and assuming it did would have
         reported a healthy one as dead. Checked on this account: a deleted name
         returns plain-text "error code: 1042", while a LIVE Worker asked for a
         path it doesn't serve returns its own JSON 404 — the SF one answers
         {"error":"unknown route","routes":["muni","caltrain"]}. The body is what
         tells them apart, so read it before naming the cause. */
      res.clone().text().then(body => {
        record(w.label, false, /error code: 1042/.test(body)
          ? "no Worker at that URL — it has been deleted or renamed"
          : "HTTP " + res.status + (res.status === 404 ? " (Worker is up; wrong route)" : ""));
      }).catch(() => record(w.label, false, "HTTP " + res.status));
      return res;
    }).catch(err => {
      record(w.label, false, (err && err.message) || "network error");
      throw err;                            // the board's own catch still runs
    });
  };

  window.TBWorkerHealth = {
    report: () => JSON.parse(JSON.stringify(state)),
    failing: () => Object.keys(state).filter(k => state[k].fails >= FAILS_BEFORE_COMPLAINING),
    watching: () => configured().map(w => w.label),
  };
})();
