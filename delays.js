/* ============================================================================
   delays.js — one lateness scale for every board.

   WHY THIS IS A FILE AND NOT ELEVEN COPIES
   isRealLate() and liveLateInfo() were duplicated, identically, in every city
   board. That is survivable while the thresholds never change and fatal the
   first time they do: eleven files is eleven chances to miss one, and cities
   are still being added. The boards already share theme.css, config.js and
   cityswitch.js, so a shared script is the house style rather than a new idea.

   THE SCALE
     on time   <= 0 min     green
     1 - 5 min              yellow
     6 - 9 min              light red
     10+ min                dark red, as a filled chip

   Where the boundaries sit is a judgement call, since "1-5" and "5-10" overlap
   at 5 and "10+" claims 10. Five is treated as still yellow and ten as already
   severe, so the bands read as 1-5 / 6-9 / 10-and-up with nothing falling
   between them. Minutes are rounded first, so 5.4 is yellow and 9.6 is severe.

   The colours themselves are NOT here. They are CSS custom properties in
   theme.css, which is what lets the day theme use different inks from the dark
   ones without this file knowing anything about themes. This file picks a band;
   the stylesheet decides what that band looks like.

   OUT-OF-RANGE IS NO-DATA, NOT VERY LATE
   Several feeds send sentinel garbage (SEPTA's late:998) instead of omitting
   the field, so a reported delay beyond 90 minutes is treated as missing:
   showing a train as 998 minutes late is worse than showing no delay at all.

   That ceiling belongs to the feed, not to trains, so it is overridable — see
   AMTRAK_LIMIT. Long-distance Amtrak services really do run hours behind, and
   the 90-minute cap was hiding precisely the delays worth showing.
   ============================================================================ */
(function () {
  "use strict";

  // Ordered least to most severe; the first band whose ceiling the delay fits
  // under wins. `color` is kept for callers that still set an inline colour --
  // it cannot express the filled chip, so prefer `cls`.
  var BANDS = [
    { name: "ok",  max: 0,        cls: "dly-ok",  color: "var(--delay-ok)" },
    { name: "min", max: 5,        cls: "dly-min", color: "var(--delay-min)" },
    { name: "mid", max: 9,        cls: "dly-mid", color: "var(--delay-mid)" },
    { name: "max", max: Infinity, cls: "dly-max", color: "var(--delay-max-ink)" }
  ];

  /* Minutes past which a REPORTED delay is treated as no-data rather than as a
     very late train. This guards feeds that send sentinel garbage instead of
     omitting the field -- SEPTA's late:998 being the specimen.

     It is a property of the feed, not of trains, so it is overridable. Amtrak
     long-distance services genuinely run hours behind: capping them at 90 hid
     the Sunset Limited at 325 minutes late and the Southwest Chief at 203,
     which are the delays a board most needs to show. */
  var LIMIT = 90;
  var AMTRAK_LIMIT = 1440;   // 24h; past that it is a parsing fault, not a delay

  function usable(late, limit) {
    return typeof late === "number" && isFinite(late)
        && Math.abs(late) <= (limit || LIMIT);
  }

  /* True only for a delay worth mentioning. Deliberately excludes 0 and
     negatives: a train running early or on time is not "late", and callers use
     this to decide whether to append " · N min late" at all. */
  function isRealLate(late) {
    return usable(late) && late > 0;
  }

  function delayBand(late) {
    var m = Math.round(late);
    for (var i = 0; i < BANDS.length; i++) {
      if (m <= BANDS[i].max) return BANDS[i];
    }
    return BANDS[BANDS.length - 1];
  }

  /* null means "no usable delay data" -- distinct from a band, and callers rely
     on that difference to leave the row alone rather than claim it is on time. */
  function liveLateInfo(late, limit) {
    if (!usable(late, limit)) return null;
    var m = Math.round(late);
    var b = delayBand(m);
    return {
      band: b.name,
      cls: b.cls,
      color: b.color,
      mins: m,
      text: m <= 0 ? "on time" : "+" + m + " min"
    };
  }

  /* Applies the band to an element: the class does the work, and any inline
     colour from an older call path is cleared so it cannot beat the chip. */
  function paintDelay(elm, info) {
    if (!elm || !info) return elm;
    elm.classList.remove("dly-ok", "dly-min", "dly-mid", "dly-max");
    elm.classList.add(info.cls);
    elm.style.color = "";
    return elm;
  }

  /* Minutes late for an Amtrak train, from a station object as amtraker gives
     it (the same object amtrakNextStop returns).

     Amtrak's own trainTimely string used to be the source for this and is now
     empty on every active train -- 177 of 177 when this was written -- so the
     boards were showing nothing at all where a delay should be. The scheduled
     and actual times are still there per stop, so the number is derived rather
     than read: arr minus schArr, falling back to the departure pair for the
     origin, where there is no arrival. */
  function amtrakLateMin(stop) {
    if (!stop) return null;
    var sch = stop.schArr || stop.schDep;
    var act = stop.arr || stop.dep;
    if (!sch || !act) return null;
    var mins = (new Date(act) - new Date(sch)) / 60000;
    return isFinite(mins) ? Math.round(mins) : null;
  }

  /* " · +12 min" as a fragment, so a delay can be appended to an existing text
     line and still carry its own band colour. Returns null when there is
     nothing to say, which lets callers fall back to the feed's own wording. */
  function delayFragment(info, sep) {
    if (!info) return null;
    var frag = document.createDocumentFragment();
    frag.appendChild(document.createTextNode(sep === undefined ? " · " : sep));
    var span = document.createElement("span");
    span.className = info.cls;
    span.textContent = info.text;
    frag.appendChild(span);
    return frag;
  }

  /* The same thing as an HTML string, for map tooltips.

     delayFragment() returns DOM, which is right for a card row assembled out of
     elements and useless for a Leaflet tooltip, which is handed a string and
     parses it as HTML. Without this the tooltips were the last place on the
     boards still writing lateness as flat text, and colouring them would have
     meant repeating the band names at each call site -- the duplication this
     file exists to prevent.

     Returns "" rather than null so it concatenates unconditionally, which is
     how every tooltip on these boards is built. */
  function delayHtml(info, sep) {
    if (!info) return "";
    return (sep === undefined ? " · " : sep) +
      '<span class="' + info.cls + '">' + info.text + "</span>";
  }

  /* Amtrak in one call: derive the delay from the stop, then band it against
     the wider Amtrak limit rather than the sentinel-guarding default. */
  function amtrakLateInfo(stop) {
    var m = amtrakLateMin(stop);
    return m === null ? null : liveLateInfo(m, AMTRAK_LIMIT);
  }

  window.isRealLate = isRealLate;
  window.liveLateInfo = liveLateInfo;
  window.delayBand = delayBand;
  window.paintDelay = paintDelay;
  window.amtrakLateMin = amtrakLateMin;
  window.amtrakLateInfo = amtrakLateInfo;
  window.delayFragment = delayFragment;
  window.delayHtml = delayHtml;
})();
