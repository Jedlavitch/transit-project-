/* ============================================================================
   config.js — THE ONE FILE YOU EDIT. Everything below ships to every customer.

   Customers set up nothing. No API keys, no Worker URLs, no licence to paste —
   they open the board and it works. You fill this in once, redeploy, and every
   screen everywhere picks it up on its next load, including boards already out
   in the world.

   Anything you leave empty stays empty; the board simply runs without that
   system, exactly as it does today. So a half-filled file is fine.

   Customer preferences — their location, theme, which cards they show — are NOT
   here and never get overwritten. This file owns the plumbing; the customer owns
   how their board looks.

   You can also fill this in from the admin page (Admin -> Copy config.js) and
   paste the result here, which saves typing the key names by hand.
   ============================================================================ */
window.TB_CONFIG = {

  /* ---- the licensed feed proxy (feed-proxy-worker.js) ------------------- */
  feedProxy: "",          // https://tb-feeds.yourname.workers.dev
  licence:   "",          // TB-XXXXX-XXXXX-XXXXX-XXXXX

  /* ---- API keys --------------------------------------------------------
     PUBLIC. This file is served to every visitor and is in git history for
     good, so treat anything put here as published. That is an acceptable trade
     for WMATA's key — free, rotatable at developer.wmata.com, and rate-limited
     per key, so the worst case is throttling rather than a breach. It is NOT
     acceptable for a Stripe, Resend or admin secret; those belong in a Worker's
     secrets. To take this one off the page entirely, move it behind
     feed-proxy-worker.js, which is what that file exists for. */
  wmataKey:  "960c93531d084988b57fca2e0adb4cc8",   // developer.wmata.com — DC Metrorail + Metrobus

  /* ---- optional live-position Workers ---------------------------------- */
  // Every one of these is optional. Left empty, that system falls back to its
  // bundled timetable, which needs nothing at all.
  marcUrl:      "https://broken-meadow-f8da.jacklemonade2.workers.dev",  // marc-worker.js
  septaUrl:     "https://septa.jacklemonade2.workers.dev",               // septa-worker.js
  nycBusUrl:    "",       // mta-bus-worker.js
  pathUrl:      "",       // path-worker.js
  njtUrl:       "",       // njt-worker.js
  njtUser:      "",       // raildata.njtransit.com login
  njtPass:      "",
  sfLiveUrl:    "https://restless-frog-f414.jacklemonade2.workers.dev",  // sf511-worker.js
  amsLiveUrl:   "",       // ovapi-worker.js

  /* ---- shared spotter feed --------------------------------------------- */
  spotBlob:     "",       // share code from the phone app
  spotFeedUrl:  "",       // spotter-worker.js

  /* ---- aircraft feed ----------------------------------------------------
     LEAVE EMPTY WHILE THIS IS FREE. Empty means airplanes.live, which is
     CORS-open and costs nothing — and whose terms PROHIBIT COMMERCIAL USE.

     Before charging for this, deploy adsb-worker.js and put its URL here. That
     switches every board to adsb.lol (Open Database Licence, commercial use
     permitted with attribution) or adsb.fi. Both send no CORS headers of their
     own, which is why the Worker exists rather than a direct swap.

     Two things that are on you, not on this file: confirm the current licence
     terms yourself, and carry the ODbL attribution — crediting adsb.lol
     wherever the data is shown is a condition of the licence, not a courtesy.
     Note also that adsb.lol omits `desc` and `ownOp`, so plane rows lose the
     aircraft type and operator; adsb.fi carries both. */
  adsbUrl:      "",       // https://tb-adsb.yourname.workers.dev

  /* ---- accounts / sign-in ----------------------------------------------
     account-worker.js. Left empty there is simply no sign-in: the Spotter log
     stays on one device, and the Account panel on profile.html says so plainly
     rather than showing a form that cannot work. Filling it in turns sign-in on
     everywhere at once, with no other change. Steps are in ACCOUNTS.md — it
     needs a KV namespace bound as ACCOUNTS and an email API key, or the codes
     never arrive. Deliberately NOT the licence server: that decides who paid,
     this decides who they are. */
  acctUrl:      "https://tbaccounts.jacklemonade2.workers.dev",
};

/* ---------------------------------------------------------------------------
   Below here is plumbing — you should not need to touch it.

   Each setting is copied into the storage key its board already reads, so no
   board needed changing to support this. Values you set here WIN over whatever
   is on the device, which is what makes a redeploy able to fix or rotate a key
   on every customer's screen at once. Blank entries are skipped rather than
   written, so an unset field never wipes something a board is already using.
--------------------------------------------------------------------------- */
(function () {
  "use strict";
  const C = window.TB_CONFIG || {};
  const MAP = {
    feedProxy:   ["tb.feedProxy"],
    licence:     ["tb.license"],
    // the DC board owns the WMATA key; Philadelphia reads its own copy
    wmataKey:    ["transitboard.wmataKey", "transitboardphl.wmataKey"],
    marcUrl:     ["transitboard.marcUrl"],
    septaUrl:    ["transitboardphl.septaUrl"],
    nycBusUrl:   ["transitboardnyc.busUrl"],
    pathUrl:     ["transitboardnyc.pathUrl"],
    njtUrl:      ["transitboardnj.njtUrl"],
    njtUser:     ["transitboardnj.njtUser"],
    njtPass:     ["transitboardnj.njtPass"],
    sfLiveUrl:   ["transitboardsf.liveUrl"],
    amsLiveUrl:  ["transitboardams.liveUrl"],
    spotBlob:    ["tb.spotBlob"],
    spotFeedUrl: ["tb.spotFeedUrl"],
    acctUrl:     ["tb.acctUrl"],
    adsbUrl:     ["tb.adsbUrl"],
  };
  try {
    Object.keys(MAP).forEach(field => {
      const v = String(C[field] == null ? "" : C[field]).trim();
      if (!v) return;                       // unset here: leave the device alone
      MAP[field].forEach(k => {
        if (localStorage.getItem(k) !== v) localStorage.setItem(k, v);
      });
    });
  } catch (_) { /* private mode: boards still run, just unconfigured */ }

  /* ---- ODbL attribution for the aircraft feed -----------------------------
     adsb.lol publishes under the Open Database Licence, which requires the
     source to be credited wherever the data is shown. That is a condition, not
     a courtesy, so it is enforced here rather than left to each board to
     remember: config.js is on every page that draws aircraft, and one place
     that cannot be forgotten beats eleven that can.

     Shown ONLY when adsbUrl is set, because that is exactly when the data is
     coming from adsb.lol via adsb-worker.js. While it is empty the boards call
     airplanes.live, and crediting adsb.lol for someone else's data would be its
     own kind of false statement.

     Drawn as its own small fixed element rather than folded into the status
     line: the boards rewrite that line on every refresh tick, so a credit
     written there is erased within seconds. */
  function creditAircraftSource() {
    try {
      if (!String(C.adsbUrl || "").trim()) return;          // airplanes.live: nothing to credit
      if (document.getElementById("tbAdsbCredit")) return;
      const CREDIT = "Aircraft data adsb.lol (ODbL)";
      /* A separate element, NOT an edit to #statusText. The boards rewrite that
         line on every refresh tick, so a one-shot edit there survives about
         fifteen seconds — verified: it was gone by the next paint. Attribution a
         repaint can erase is not attribution. This element is owned by nothing
         else on the page, so nothing else clears it. */
      const d = document.createElement("div");
      d.id = "tbAdsbCredit";
      d.textContent = CREDIT;
      d.style.cssText = "position:fixed;left:8px;bottom:5px;z-index:900;opacity:.6;" +
        "font:600 10px/1.2 system-ui,-apple-system,sans-serif;color:#9fb4c7;" +
        "pointer-events:none;letter-spacing:.02em";
      (document.body || document.documentElement).appendChild(d);
    } catch (_) {}
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", creditAircraftSource);
  else creditAircraftSource();
})();
