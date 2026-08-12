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

  /* ---- the guided tour's mascot ----------------------------------------
     Shown on the first-run walkthrough (tour-guide.js). Leave empty and a
     built-in placeholder is drawn instead; point it at artwork in brand/ to
     use your own. Rendered at 58x69, SVG or PNG. A missing file falls back to
     the placeholder rather than showing a broken image.
     Per-step artwork is set in tour-guide.js's STEPS (a `mascot:` on a step). */
  mascot:    "",          // brand/mascot.svg

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
     LEAVE EMPTY WHILE THIS IS FREE. Empty means adsb.lol, which is
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
  /* PARKED, not abandoned. The Worker is deployed and correct, but adsb.lol
     rate-limits per IP and Cloudflare Workers egress from a SHARED pool, so it
     answers 429 to the Worker while serving a laptop fine — measured: direct
     200 with 44 aircraft, through the Worker "upstream 429" three times running.
     That empties the sky on the boards and in Sky mode, which reads as slowness.
     Empty here puts everything back on adsb.lol, which is correct while
     this is free. Re-fill it once the Worker serves stale on upstream failure
     (see adsb-worker.js) and the rate limit is resolved. */
  /* Your own proxy, on your own box, with its own IP — which is the whole
     point: adsb.lol rate-limits per IP and Cloudflare Workers share one, so the
     Worker drew 429s this does not. Filled in, customers inherit a working feed
     rather than each standing one up; AIRCRAFT-FEED.md stays for anyone who
     would rather run their own.

     sslip.io rather than a subdomain of this site because the zone is still
     served by IONOS, not Cloudflare — a record added in the Cloudflare
     dashboard does not resolve while that is true. sslip.io maps the IP into a
     real public name, so Let's Encrypt issues for it normally. Swap this for
     adsb.transitproject.online once the nameservers actually move. */
  adsbUrl:      "https://142.93.200.253.sslip.io",

  /* What that proxy FRONTS, which is not something its hostname can tell you.
     The credit line below matches on the host, so a self-hosted proxy fell
     through to the neutral "Aircraft data via 142.93.200.253.sslip.io" — an IP
     address, which is ugly on the page and useless as attribution, since the
     entire point is to name the source.

     It is adsb.lol: adsb-proxy.py defaults to https://api.adsb.lol/v2 and the
     running proxy confirms it on /health. That makes the data ODbL and the
     credit a licence condition, not a decoration — see AIRCRAFT-FEED.md.

     Repoint the proxy's UPSTREAM and this has to change with it. Leave it empty
     to fall back to matching on the hostname. */
  adsbUpstream: "adsb.lol",

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
  /* Blank means "leave the device alone" so this file never wipes a setting a
     customer entered by hand. But that alone makes every value here a ONE-WAY
     DOOR: fill a field, ship it, and no later edit can take it back — the key is
     already written to every browser that loaded the site, and emptying the
     field just stops rewriting a value that is still there.

     That bit us for real. adsbUrl was set, shipped, then emptied when the proxy
     turned out to be rate-limited; the file said adsb.lol but every
     browser that had loaded the site kept calling the throttled Worker, so the
     revert appeared to do nothing.

     So remember what THIS file wrote, and clear exactly that when the field goes
     empty. A value the customer set themselves was never in the ledger and is
     still left alone. */
  const LEDGER = "tb.configWrote";
  try {
    let wrote = {};
    try { wrote = JSON.parse(localStorage.getItem(LEDGER) || "{}") || {}; } catch (_) {}
    Object.keys(MAP).forEach(field => {
      const v = String(C[field] == null ? "" : C[field]).trim();
      MAP[field].forEach(k => {
        if (v) {
          if (localStorage.getItem(k) !== v) localStorage.setItem(k, v);
          wrote[k] = true;
        } else if (wrote[k]) {
          // we put it there, and it is gone from the config now: take it back
          localStorage.removeItem(k);
          delete wrote[k];
        }
      });
    });
    localStorage.setItem(LEDGER, JSON.stringify(wrote));
  } catch (_) { /* private mode: boards still run, just unconfigured */ }

  /* ---- ODbL attribution for the aircraft feed -----------------------------
     adsb.lol publishes under the Open Database Licence, which requires the
     source to be credited wherever the data is shown. That is a condition, not
     a courtesy, so it is enforced here rather than left to each board to
     remember: config.js is on every page that draws aircraft, and one place
     that cannot be forgotten beats eleven that can.

     Shown ONLY when adsbUrl is set, because that is exactly when the data is
     coming from adsb.lol via adsb-worker.js. While it is empty the boards call
     adsb.lol, and crediting adsb.lol for someone else's data would be its
     own kind of false statement.

     Drawn as its own small fixed element rather than folded into the status
     line: the boards rewrite that line on every refresh tick, so a credit
     written there is erased within seconds. */
  function creditAircraftSource() {
    try {
      /* Key off the feed ACTUALLY IN USE, not the shipped config. The product
         no longer ships an aircraft feed at all — each operator supplies their
         own, which lands in localStorage — so checking C.adsbUrl meant the
         credit never appeared for the only people who now have a feed. ODbL
         attribution is a licence condition, and the licence follows the data,
         not the config file. */
      let active = String(C.adsbUrl || "").trim();
      if (!active) { try { active = (localStorage.getItem("tb.adsbUrl") || "").trim(); } catch (_) {} }
      if (!active) return;                                  // no feed: nothing to credit
      if (document.getElementById("tbAdsbCredit")) return;
      /* Name the source actually in use. A fixed adsb.lol string was fine when
         that was the only feed this could point at; now an operator supplies
         their own, and crediting adsb.lol while the data comes from somewhere
         else is a false statement of provenance — the opposite of what
         attribution is for. Unknown hosts get a neutral line rather than a
         guess, and adsb.lol gets none: it imposes no attribution term,
         and inventing one would misdescribe it too. */
      /* Match on the DECLARED upstream first, and only fall back to the
         hostname. A proxy is the normal setup now, and its host says nothing
         about whose data is passing through it — that is how a board serving
         adsb.lol data ended up crediting an IP address, which satisfies neither
         the licence nor the eye. */
      const host = String(C.adsbUpstream || "").trim() ||
                   (active.match(/^https?:\/\/([^\/]+)/) || [])[1] || "";
      let CREDIT = "";
      if (/adsb\.lol/i.test(host))        CREDIT = "Aircraft data adsb.lol (ODbL)";
      else if (/adsb\.fi/i.test(host))    CREDIT = "Aircraft data adsb.fi";
      else if (/airplanes\.live/i.test(host)) CREDIT = "";
      else                                CREDIT = "Aircraft data via " + host;
      if (!CREDIT) return;
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
