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

  /* ---- API keys -------------------------------------------------------- */
  wmataKey:  "",          // developer.wmata.com — powers DC Metrorail + Metrobus

  /* ---- optional live-position Workers ---------------------------------- */
  // Every one of these is optional. Left empty, that system falls back to its
  // bundled timetable, which needs nothing at all.
  marcUrl:      "",       // marc-worker.js
  septaUrl:     "",       // septa-worker.js
  nycBusUrl:    "",       // mta-bus-worker.js
  pathUrl:      "",       // path-worker.js
  njtUrl:       "",       // njt-worker.js
  njtUser:      "",       // raildata.njtransit.com login
  njtPass:      "",
  sfLiveUrl:    "",       // sf511-worker.js
  amsLiveUrl:   "",       // ovapi-worker.js

  /* ---- shared spotter feed --------------------------------------------- */
  spotBlob:     "",       // share code from the phone app
  spotFeedUrl:  "",       // spotter-worker.js
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
})();
