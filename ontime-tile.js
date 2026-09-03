/* ontime-tile.js — the wait figure, in the statistics strip.
   ---------------------------------------------------------------------------
   The Track record lived only as a card in the departures grid, and that grid
   is a fixed one-screen budget: every card there is taking height from the
   trains and buses next to it, and on a busy board it was being squeezed to a
   couple of rows anyway (see balanceCards). But the headline it carries —
   "you are waiting nine minutes where you usually wait four" — is a single
   number, and the strip along the top exists precisely for single numbers
   derived from data already on the board. Tracking, Air, Rail, Road, Next
   depart, Data. A wait figure belongs in that row, not in a box of its own.

   DELIBERATELY ADDITIVE. This does not modify, move or hide the card. It is a
   separate file that reads only TBOnTime's public API — `stats(key)` — and
   renders one tile. Nothing here reaches into ontime.js's internals, so the
   two can be worked on independently and neither can break the other; the card
   remains the place for per-stop rows, the sparklines and the full history.
   Both are independently switchable in Settings, so nobody is stuck with both.

   Loaded after ontime.js and departures.js. Degrades to doing nothing at all on
   a board with no statistics strip. */
(function (root) {
  "use strict";

  var TILE_ID = "otTile";
  var LS_HIDE = "tb.ontimeTile.hidden";

  function read(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; }
    catch (_) { return d; }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* The boards declare `let state = {...}` at top level, which is a LEXICAL
     global — reachable as a bare identifier, never a property of window. Read
     it the way the boards' own code does, and never shadow the name here. */
  function boardState() {
    try { /* eslint-disable-next-line no-undef */
      return (typeof state !== "undefined" && state) ? state : (root.state || null);
    } catch (_) { return root.state || null; }
  }
  function pool() {
    if (root.TBDep && root.TBDep.all) { try { return root.TBDep.all() || []; } catch (_) {} }
    var st = boardState(), by = (st && st._depBy) || {}, out = [];
    for (var k in by) if (Array.isArray(by[k])) out = out.concat(by[k]);
    return out;
  }

  /* ---- registering so it can be switched off --------------------------------
     Its own entry rather than sharing the card's: they are two separate pieces
     of screen furniture and somebody may reasonably want the glance without the
     box, or the box without the glance. `.user-hidden` is styled only for
     `.card` on the boards, so the rule for a `.stat` comes from here. */
  function registerToggle() {
    try {
      /* eslint-disable-next-line no-undef */
      if (typeof CARD_DEFS !== "undefined" && Array.isArray(CARD_DEFS) &&
          !CARD_DEFS.some(function (d) { return d && d.id === TILE_ID; })) {
        /* eslint-disable-next-line no-undef */
        CARD_DEFS.push({ id: TILE_ID, label: "Typical wait" });
        return true;
      }
    } catch (_) {}
    return false;
  }
  var REGISTERED = registerToggle();

  function hiddenNow() {
    try { /* eslint-disable-next-line no-undef */
      if (REGISTERED && typeof loadHiddenCards === "function") return loadHiddenCards().has(TILE_ID);
    } catch (_) {}
    return read(LS_HIDE, false) === true;
  }

  /* ---- which stop the tile speaks for ---------------------------------------
     One tile, one number, so the choice of stop has to be defensible:

       1. The stop you saved as your commute, if you saved one. It is by
          definition the one you care about.
       2. Otherwise whichever tracked stop is furthest above its own baseline —
          the reason to glance at a wait figure at all is that something is
          worse than usual, so the worst news wins.
       3. Otherwise the most-observed stop, which is the one with the steadiest
          number behind it.

     Only stops the board is watching right now are eligible; history for a stop
     you have moved away from is kept but has no claim on the tile. */
  function pick() {
    if (!root.TBOnTime || !root.TBOnTime.stats) return null;
    var live = {}, list = pool();
    list.forEach(function (d) {
      if (!d || !d.stop) return;
      var key = d.mode + "|" + d.stop + "|" + (d.route || "");
      if (!live[key]) live[key] = { key: key, stop: d.stop, route: d.route || "", mode: d.mode };
    });
    var keys = Object.keys(live);
    if (!keys.length) return null;

    var rows = keys.map(function (k) {
      var s;
      try { s = root.TBOnTime.stats(k); } catch (_) { return null; }
      if (!s) return null;
      s.meta = live[k];
      s.delta = (s.todayAvg != null && s.baseAvg != null) ? s.todayAvg - s.baseAvg : null;
      return s;
    }).filter(function (s) { return s && (s.todayN > 0 || s.baseN > 0); });
    if (!rows.length) return null;

    var trip = read("tb.commute.trip", null);
    if (trip && trip.stop) {
      var norm = function (x) { return String(x || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); };
      var mine = rows.filter(function (r) { return norm(r.meta.stop) === norm(trip.stop); });
      if (trip.route) {
        var exact = mine.filter(function (r) { return norm(r.meta.route) === norm(trip.route); });
        if (exact.length) return exact[0];
      }
      if (mine.length) return mine[0];
    }
    var worst = rows.filter(function (r) { return r.delta != null; })
                    .sort(function (a, b) { return b.delta - a.delta; })[0];
    if (worst && worst.delta >= 1) return worst;
    return rows.sort(function (a, b) { return (b.todayN + b.baseN) - (a.todayN + a.baseN); })[0];
  }

  /* ---- the tile ------------------------------------------------------------- */
  function ensureTile() {
    var tile = document.getElementById(TILE_ID);
    if (tile) return tile;
    var strip = document.getElementById("statStrip");
    if (!strip) return null;                    // no strip on this board: do nothing

    if (!document.getElementById("otTileCss")) {
      var st = document.createElement("style");
      st.id = "otTileCss";
      // The boards style .user-hidden for .card only; a tile needs its own rule
      // or the Settings checkbox would appear to do nothing.
      st.textContent = ".stat.user-hidden{display:none !important}" +
        "#otTile .s-sub{opacity:.95}";
      document.head.appendChild(st);
    }

    tile = document.createElement("div");
    tile.className = "stat";
    tile.id = TILE_ID;
    tile.innerHTML =
      '<div class="s-label"><span class="s-glyph">◷</span>Typical wait</div>' +
      '<div class="s-value" id="otTileVal">—</div>' +
      '<div class="s-sub" id="otTileSub">learning…</div>';
    /* Next to "Next depart" where one exists: that tile says when the next
       vehicle comes and this one says what that usually feels like, so they
       read as a pair. The strip is auto-fit/minmax, so an extra tile reflows
       rather than squeezing the others. */
    var anchor = document.getElementById("stNext");
    var after = anchor && anchor.closest ? anchor.closest(".stat") : null;
    if (after && after.parentNode === strip) strip.insertBefore(tile, after.nextSibling);
    else strip.appendChild(tile);

    if (hiddenNow()) tile.classList.add("user-hidden");
    return tile;
  }

  function fmt(n) { return (Math.round(n * 10) / 10).toString().replace(/\.0$/, ""); }

  function paint() {
    var tile = ensureTile(); if (!tile) return;
    var val = document.getElementById("otTileVal");
    var sub = document.getElementById("otTileSub");
    if (!val || !sub) return;

    var s = pick();
    if (!s) {
      val.textContent = "—";
      sub.textContent = "learning your usual waits…";
      tile.style.setProperty("--sys", "#7cc0ff");
      tile.style.setProperty("--sys2", "#b58cff");
      return;
    }

    var where = s.meta.route ? (s.meta.route + " · " + s.meta.stop) : s.meta.stop;
    if (s.todayAvg == null) {
      // Seen before, nothing yet today — say so rather than showing a stale figure.
      val.innerHTML = s.baseAvg != null ? fmt(s.baseAvg) + ' <small>min usually</small>' : "—";
      sub.textContent = esc(where);
      tile.style.setProperty("--sys", "#7cc0ff");
      tile.style.setProperty("--sys2", "#b58cff");
      return;
    }

    val.innerHTML = fmt(s.todayAvg) + ' <small>min</small>';

    /* Under a minute either way is noise on a median wait, so it says "about
       usual" rather than dressing up ±0.4 as a trend — the same threshold the
       card's rows use, so the two can never disagree. */
    var d = s.delta;
    if (d == null) {
      sub.textContent = "learning · " + where;
      tile.style.setProperty("--sys", "#7cc0ff");
      tile.style.setProperty("--sys2", "#b58cff");
    } else if (d >= 1) {
      sub.textContent = "usually " + fmt(s.baseAvg) + " · " + where;
      tile.style.setProperty("--sys", "#ff6b81");
      tile.style.setProperty("--sys2", "#ffb454");
    } else if (d <= -1) {
      sub.textContent = "usually " + fmt(s.baseAvg) + " · " + where;
      tile.style.setProperty("--sys", "#39d98a");
      tile.style.setProperty("--sys2", "#8ef0c0");
    } else {
      sub.textContent = "about usual · " + where;
      tile.style.setProperty("--sys", "#7cc0ff");
      tile.style.setProperty("--sys2", "#b58cff");
    }
  }

  /* Repaint when the departures do, not merely on a timer.

     The tile is built at DOMContentLoaded, when the board has fetched nothing
     yet and the pool is empty — so the first paint can only ever say "learning"
     and, on a timer alone, it kept saying it for another thirty seconds after
     the data had arrived.

     TBOnTime.onData() is the signal, and decorating it is how this file stays
     out of ontime.js: departures.js already calls it on every feed, so there is
     no new plumbing and nothing in the other file changes. Wrapped in
     try/finally so their handler's result passes through untouched and a throw
     in the tile can never stop the card from updating — the decoration must be
     invisible to the thing being decorated. */
  function hookOnData() {
    var api = root.TBOnTime;
    if (!api || api.__tileHooked || typeof api.onData !== "function") return false;
    var orig = api.onData;
    api.onData = function () {
      try { return orig.apply(this, arguments); }
      finally { try { paint(); } catch (_) {} }
    };
    api.__tileHooked = true;
    return true;
  }

  function boot() {
    try {
      paint();
      if (!hookOnData()) {
        // ontime.js loads first, so this is belt-and-braces for a board that
        // ships them in the other order or omits it entirely.
        var tries = 0;
        var t = setInterval(function () { if (hookOnData() || ++tries > 20) clearInterval(t); }, 500);
      }
      // The strip's other tiles repaint on a 1s clock; a wait figure moves far
      // more slowly than that, and repainting it every second would only burn
      // battery on a kiosk. This is the fallback for a board that never calls
      // onData at all.
      setInterval(paint, 30000);
    } catch (_) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  root.TBOnTimeTile = { paint: paint };
})(typeof window !== "undefined" ? window : this);
