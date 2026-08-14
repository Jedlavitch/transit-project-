/* ============================================================================
   polyfills.js — the few modern methods this product calls, for the browsers it
   actually runs on.

   WHY THIS FILE IS SHORT, AND SHOULD STAY SHORT
   A compatibility audit swept the whole repo for constructs newer than the
   television browsers in the field (Chromium 68-108; the LG panel in use
   demonstrably lacks color-mix, which is Chrome 111). Across every page, the
   ONLY missing runtime method was Promise.allSettled. Everything else was
   either already guarded, absent, or in a Cloudflare Worker, where the runtime
   is modern V8 and none of this applies.

   So this is not a polyfill library and must not become one. Add to it only
   what an audit shows is genuinely called and genuinely missing — an unused
   shim is a lie about what the code needs.

   WHY allSettled MATTERS HERE
   It is how every multi-feed fetch is written: seven MTA subway feeds, the
   rail-and-bus pair on the city boards, the aircraft sources on the Spotter.
   The whole point of the call is that one dead feed must not blank the others.

   Without it the failure is not graceful. The method is undefined, the
   arguments still evaluate (so the feeds ARE fetched, wasting the request),
   and then the call throws TypeError. In station.html that rejection is
   swallowed by a `catch{ return; }` whose comment assumes a previous success
   to fall back on — there never is one, so the page sits on "Loading trains
   at ..." for ever, re-failing every twenty seconds, with nothing else on it.

   LOADED FIRST AND NOT DEFERRED, because the code that calls it is inline in
   the page and runs during parsing.
   ============================================================================ */
(function () {
  "use strict";

  /* Resolves when every promise has settled, never rejects, and reports each
     outcome separately. Matches the specified result shape exactly --
     {status:"fulfilled", value} / {status:"rejected", reason} -- because every
     caller in this repo reads `.status` and `.value`, and a near-miss shim
     would be worse than none: it would fail quietly, in the branch that only
     runs when a feed is already down. */
  if (typeof Promise !== "undefined" && !Promise.allSettled) {
    Promise.allSettled = function (iterable) {
      var items = Array.prototype.slice.call(iterable || []);
      return Promise.all(items.map(function (p) {
        /* Promise.resolve, not p.then: the callers pass real promises today,
           but allSettled accepts any iterable of values and a bare value must
           settle as fulfilled rather than explode on .then. */
        return Promise.resolve(p).then(
          function (value) { return { status: "fulfilled", value: value }; },
          function (reason) { return { status: "rejected", reason: reason }; }
        );
      }));
    };
  }
})();
