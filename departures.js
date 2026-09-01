/* departures.js — the one pool of "what is leaving from near you".
   ---------------------------------------------------------------------------
   Two cards need the same thing and neither can fetch it: the commute countdown
   (commute.js) and the wait-time recorder (ontime.js). The boards already have
   it — every one of them renders departures — but each does so from its own
   feed, in its own shape, inside its own render function. This is the seam
   between those two facts.

   A board opts in by calling, at the end of a render:

       if (window.TBDep) TBDep.feed("metro", items);

   where each item is
       { mode, stop, route, dest, min, color, live }
   mode   one of the vehicle-icons.js modes ("metro"/"bus"/"train"/"tram"/"ferry")
   stop   the stop or station name as a person would say it
   route  line or route designation ("RD", "M82", "S8"), "" if the mode is the only name
   dest   headsign / direction, "" if unknown
   min    WHOLE MINUTES from now until it departs — 0 for boarding, never negative
   color  the line colour the board already uses, for the badge
   live   true for a real-time prediction, false for a timetable

   Bucketed by `key` rather than concatenated, so each render owns exactly its
   own rows: a feed that stops updating goes stale on its own instead of leaving
   orphans in a shared pool that nobody can attribute. Re-feeding the same key
   replaces that bucket wholesale.

   Two rules the callers must respect, both learned from real feeds:
     · Never feed a vehicle nobody can board. WMATA files "No Passenger" moves
       in the same list as real departures; a countdown telling you to leave the
       house for one is worse than no countdown at all.
     · Never feed a cancelled departure. It is not a service you can catch, and
       averaging it into a wait time says the opposite of what happened.

   Kept apart from both consumers so a board can carry the pool without either
   card, and so neither card's absence breaks the other. */
(function (root) {
  "use strict";

  /* The boards declare `let state = {...}` at the top level of a classic
     script. A top-level `let` is a LEXICAL global — reachable as a bare
     identifier, never a property of window — so `root.state` is undefined here.
     Read it the way the boards' own code does. */
  function boardState() {
    try { /* eslint-disable-next-line no-undef */
      return (typeof state !== "undefined" && state) ? state : (root.state || null);
    } catch (_) { return root.state || null; }
  }

  function feed(key, items) {
    var st = boardState();
    if (!st || !key) return;
    var out = [];
    for (var i = 0; i < (items || []).length; i++) {
      var d = items[i];
      if (!d || !d.stop) continue;
      var m = Math.round(Number(d.min));
      // A departure in the past is not a departure. Anything beyond 3 hours is
      // a timetable entry, not a thing to plan a walk around, and letting those
      // in would drag every wait-time average towards the overnight gap.
      if (!isFinite(m) || m < 0 || m > 180) continue;
      out.push({
        mode: d.mode || "", stop: String(d.stop), route: d.route == null ? "" : String(d.route),
        dest: d.dest == null ? "" : String(d.dest), min: m,
        color: d.color || "#556", live: !!d.live,
      });
    }
    if (!st._depBy) st._depBy = {};
    st._depBy[key] = out;
    notify();
  }

  /* One notification per feed, and each consumer guards its own errors: a card
     that throws must not stop the other one from being told. */
  function notify() {
    try { if (root.TBCommute && root.TBCommute.onData) root.TBCommute.onData(); } catch (_) {}
    try { if (root.TBOnTime && root.TBOnTime.onData) root.TBOnTime.onData(); } catch (_) {}
  }

  function all() {
    var st = boardState(), by = (st && st._depBy) || {}, out = [];
    for (var k in by) if (Array.isArray(by[k])) out = out.concat(by[k]);
    return out;
  }

  function clear(key) {
    var st = boardState();
    if (st && st._depBy && key in st._depBy) { delete st._depBy[key]; notify(); }
  }

  root.TBDep = { feed: feed, all: all, clear: clear };
})(typeof window !== "undefined" ? window : this);
