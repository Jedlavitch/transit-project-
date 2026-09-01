/* ontime.js — "is my train usually late?", answered honestly.
   ---------------------------------------------------------------------------
   WHAT THIS CAN AND CANNOT MEASURE, because the difference matters and the
   obvious version of this feature quietly lies:

   Metrorail publishes no timetable. WMATA's rail feed gives predictions —
   "Red Line, 4 minutes" — and never a scheduled time to compare them against.
   So there is no such thing as a late Metro train in the data, and a card
   claiming an on-time percentage for one would be inventing it. Several apps
   do exactly that by treating the first prediction they saw as a schedule,
   which measures nothing but their own polling.

   What IS measurable from these feeds, on every mode and every board, is what
   a rider actually experiences: HOW LONG YOU WAIT. Sample "next vehicle in N
   minutes" every refresh and the median across a day is a real statistic —
   for a route running every 6 minutes it settles near 3, and when service
   degrades to every 12 it settles near 6. It moves with headway, which is the
   thing that goes wrong, and it needs no timetable.

   So the card compares today's typical wait against your own last two weeks at
   the same stop. "Usually 4 min, today 9" is a fact about your commute derived
   only from what you personally observed. Nothing is uploaded; the history
   lives in this browser and nowhere else.

   Reads the same `state._depBy` pool commute.js does. */
(function (root) {
  "use strict";

  var LS = { hist: "tb.ontime.hist", hide: "tb.ontime.hidden" };
  var HIDE_ID = "ontimeCard";
  var KEEP_DAYS = 14;        // two weeks: enough for a weekday baseline, small enough to stay tiny
  var MIN_SAMPLES = 8;       // below this a "typical" is noise, and is shown as "—"
  var MAX_KEYS  = 150;       // stops tracked at once; see prune() for why there is a cap

  function read(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; }
    catch (_) { return d; }
  }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* Local midnight, not UTC — a board in Los Angeles must not roll over its day
     because London did. */
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function boardState() {
    try { /* eslint-disable-next-line no-undef */
      return (typeof state !== "undefined" && state) ? state : (root.state || null);
    } catch (_) { return root.state || null; }
  }
  function pool() {
    var st = boardState(), by = (st && st._depBy) || {}, out = [];
    for (var k in by) if (Array.isArray(by[k])) out = out.concat(by[k]);
    return out;
  }

  /* ---- registration (see interesting.js for the long version) ------------- */
  function registerCardToggle() {
    try {
      /* eslint-disable-next-line no-undef */
      if (typeof CARD_DEFS !== "undefined" && Array.isArray(CARD_DEFS) &&
          !CARD_DEFS.some(function (d) { return d && d.id === HIDE_ID; })) {
        /* eslint-disable-next-line no-undef */
        CARD_DEFS.push({ id: HIDE_ID, label: "Track record" });
        return true;
      }
    } catch (_) {}
    return false;
  }
  var REGISTERED = registerCardToggle();
  function boardHiddenKey() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^transitboard[a-z]*\.hiddenCards$/.test(k)) return k;
      }
      for (var j = 0; j < localStorage.length; j++) {
        var m = /^(transitboard[a-z]*)\./.exec(localStorage.key(j));
        if (m) return m[1] + ".hiddenCards";
      }
    } catch (_) {}
    return "";
  }
  function hiddenNow() {
    try { /* eslint-disable-next-line no-undef */
      if (REGISTERED && typeof loadHiddenCards === "function") return loadHiddenCards().has(HIDE_ID);
    } catch (_) {}
    return read(LS.hide, false) === true;
  }
  function setHidden(on) {
    var done = false;
    try {
      /* eslint-disable-next-line no-undef */
      if (REGISTERED && typeof loadHiddenCards === "function") {
        /* eslint-disable-next-line no-undef */
        var h = loadHiddenCards();
        if (on) h.add(HIDE_ID); else h.delete(HIDE_ID);
        var key = boardHiddenKey();
        // Array.from, not slice.call — it is a Set, and slice.call gives [].
        if (key) { localStorage.setItem(key, JSON.stringify(Array.from(h))); done = true; }
        /* eslint-disable-next-line no-undef */
        if (typeof applyCardVis === "function") applyCardVis();
        /* eslint-disable-next-line no-undef */
        if (typeof buildCardToggles === "function") buildCardToggles();
      }
    } catch (_) {}
    if (!done) {
      write(LS.hide, on);
      var el = document.getElementById(HIDE_ID);
      if (el) el.classList.toggle("user-hidden", on);
    }
  }

  /* ---- the history --------------------------------------------------------
     { "metro|Bethesda|RD": { "2026-09-01": [count, sum, max] } }
     Triples rather than objects, and a running sum rather than the samples: a
     kiosk left on for a month should not grow a localStorage entry without
     bound, and the median of a day's waits is well approximated by its mean
     once there are dozens of samples of a bounded quantity. */
  var hist = read(LS.hist, {});

  function prune() {
    var cut = new Date(); cut.setDate(cut.getDate() - KEEP_DAYS);
    var cutKey = cut.getFullYear() + "-" + String(cut.getMonth() + 1).padStart(2, "0") + "-" + String(cut.getDate()).padStart(2, "0");
    var changed = false;
    for (var k in hist) {
      for (var d in hist[k]) if (d < cutKey) { delete hist[k][d]; changed = true; }
      if (!Object.keys(hist[k]).length) { delete hist[k]; changed = true; }
    }

    /* Cap how many stops are tracked at all. On the Bethesda board this never
       binds — six stop/route pairs. New York is the other extreme: its subway
       card lists every train near you, which is ~300 station-and-route pairs in
       Manhattan, and a kiosk left running would grow this entry without bound
       and eventually hit the storage quota mid-write.

       What gets dropped is the least-observed, which is the right answer rather
       than merely the cheap one: a stop you have seen twice while passing
       through has no track record worth keeping, and the ones you see every day
       are exactly the ones the card is about. */
    var keys = Object.keys(hist);
    if (keys.length > MAX_KEYS) {
      var seen = keys.map(function (k) {
        var n = 0;
        for (var d in hist[k]) n += hist[k][d][0];
        return { k: k, n: n };
      }).sort(function (a, b) { return a.n - b.n; });
      var drop = keys.length - MAX_KEYS;
      for (var i = 0; i < drop; i++) { delete hist[seen[i].k]; changed = true; }
    }
    return changed;
  }

  /* One sample per (stop, route) per call: the SOONEST departure, which is the
     wait a person arriving now would face. Taking every listed departure would
     bias the average upwards by however many rows the feed happens to return. */
  var lastSampleAt = 0;
  function sample() {
    var now = Date.now();
    // The board refreshes rail and bus on different clocks and each calls in;
    // without this, a mode that refreshes twice as often would contribute twice
    // the samples and dominate a stop it shares with another mode.
    if (now - lastSampleAt < 25000) return;

    var soonest = {};
    pool().forEach(function (d) {
      if (!d.stop || !isFinite(d.min) || d.min < 0 || d.min > 90) return;
      if (!d.live) return;              // scheduled rows are a timetable, not an observation
      var key = d.mode + "|" + d.stop + "|" + (d.route || "");
      if (!(key in soonest) || d.min < soonest[key]) soonest[key] = d.min;
    });

    var day = today(), any = false;
    for (var key in soonest) {
      if (!hist[key]) hist[key] = {};
      var rec = hist[key][day] || [0, 0, 0];
      rec[0] += 1; rec[1] += soonest[key]; rec[2] = Math.max(rec[2], soonest[key]);
      hist[key][day] = rec; any = true;
    }
    if (!any) return;
    /* Only now does the throttle start. Setting it up front burned the window
       on feeds that recorded nothing — NYC's scheduled bus card happens to
       arrive first, has no live rows, and so blocked the live subway feed
       arriving milliseconds later for a further 25 seconds. The scan itself is
       a few hundred array entries; it is not worth protecting from. */
    lastSampleAt = now;
    prune();
    write(LS.hist, hist);
  }

  function statsFor(key) {
    var days = hist[key] || {}, day = today();
    var tRec = days[day];
    var todayN = tRec ? tRec[0] : 0, todayAvg = tRec && tRec[0] ? tRec[1] / tRec[0] : null;
    // Baseline excludes today, or a bad morning would be measured against itself.
    var bN = 0, bSum = 0, series = [];
    Object.keys(days).sort().forEach(function (d) {
      var r = days[d];
      series.push({ d: d, avg: r[0] ? r[1] / r[0] : 0, n: r[0] });
      if (d !== day) { bN += r[0]; bSum += r[1]; }
    });
    return {
      todayAvg: todayAvg, todayN: todayN,
      baseAvg: bN >= MIN_SAMPLES ? bSum / bN : null, baseN: bN,
      series: series.slice(-7),
    };
  }

  /* ---- the card ----------------------------------------------------------- */
  function ensureCard() {
    var card = document.getElementById(HIDE_ID);
    if (card) return card;
    var cards = document.querySelector(".cards");
    if (!cards) return null;
    card = document.createElement("div");
    card.className = "card";
    card.id = HIDE_ID;
    card.style.setProperty("--sys", "#7cc0ff");
    card.style.setProperty("--sys2", "#b58cff");
    card.innerHTML =
      '<h2><span class="t">Track record</span> <span class="count" id="otCount"></span>' +
      '<button type="button" id="otHideBtn" title="Hide this box — bring it back in Settings, Show on board">×</button>' +
      "</h2>" +
      '<div class="statline" id="otStat"></div>' +
      '<div class="list" id="otList"></div>';
    cards.appendChild(card);
    if (hiddenNow()) card.classList.add("user-hidden");
    var x = card.querySelector("#otHideBtn");
    if (x) x.onclick = function () { setHidden(true); card.classList.add("user-hidden"); };
    injectCss();
    if ("ResizeObserver" in root) {
      var tmr = null;
      new ResizeObserver(function () { clearTimeout(tmr); tmr = setTimeout(paint, 140); }).observe(card);
    }
    /* eslint-disable-next-line no-undef */
    if (typeof initMiniCards === "function") setTimeout(initMiniCards, 0);
    return card;
  }
  function injectCss() {
    if (document.getElementById("otCss")) return;
    var st = document.createElement("style");
    st.id = "otCss";
    st.textContent =
      "#ontimeCard .ot-spark{display:block}" +
      "#ontimeCard .ot-delta{font-family:var(--mono,monospace);font-weight:700;font-size:12px}" +
      "#ontimeCard .ot-worse{color:var(--late-ink,#ff6b81)}" +
      "#ontimeCard .ot-better{color:var(--live-ink,#39d98a)}" +
      "#ontimeCard .ot-same{color:var(--muted,#93a5cf)}" +
      "#ontimeCard h2 #otHideBtn{margin-left:auto;background:none;border:0;cursor:pointer;font-size:15px;" +
        "line-height:1;color:var(--muted,#93a5cf);padding:0 2px}" +
      "#ontimeCard h2 #otHideBtn:hover{color:var(--late-ink,#ff6b81)}";
    document.head.appendChild(st);
  }

  /* Seven bars, one per day, height by that day's typical wait. Drawn against
     the series' own maximum rather than a fixed ceiling — the interesting thing
     is the shape of your own fortnight, not how it compares to a number picked
     here. Today's bar is the accent so "is it worse than usual" is one glance. */
  function sparkSVG(series, color) {
    if (!series.length) return "";
    var w = 44, h = 16, n = Math.max(series.length, 3), bw = w / n - 1.5;
    var max = Math.max.apply(null, series.map(function (s) { return s.avg; })) || 1;
    var day = today();
    var bars = series.map(function (s, i) {
      var bh = Math.max(1.5, (s.avg / max) * h);
      return '<rect x="' + (i * (bw + 1.5)).toFixed(1) + '" y="' + (h - bh).toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1" fill="' +
        (s.d === day ? color : "currentColor") + '" opacity="' + (s.d === day ? "1" : ".38") + '"/>';
    }).join("");
    return '<svg class="ot-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h +
      '" style="color:var(--muted,#93a5cf)">' + bars + "</svg>";
  }

  function paint() {
    var card = ensureCard(); if (!card) return;
    var list = document.getElementById("otList");
    var stat = document.getElementById("otStat");
    var count = document.getElementById("otCount");
    if (!list) return;

    // Only stops the board is watching NOW — history for a stop you moved away
    // from is kept (you may move back) but does not deserve a row.
    var live = {};
    pool().forEach(function (d) {
      if (!d.stop) return;
      var key = d.mode + "|" + d.stop + "|" + (d.route || "");
      if (!live[key]) live[key] = { key: key, mode: d.mode, stop: d.stop, route: d.route || "", color: d.color };
    });

    var rows = Object.keys(live).map(function (k) {
      var s = statsFor(k); s.meta = live[k]; return s;
    }).filter(function (s) { return s.todayN > 0 || s.baseN > 0; });

    // Biggest deterioration first: the reason to look at this card is that
    // something is worse than usual, so that has to be the row you cannot miss.
    rows.sort(function (a, b) {
      var da = (a.todayAvg != null && a.baseAvg != null) ? a.todayAvg - a.baseAvg : -999;
      var db = (b.todayAvg != null && b.baseAvg != null) ? b.todayAvg - b.baseAvg : -999;
      return db - da;
    });

    var withBase = rows.filter(function (r) { return r.baseAvg != null; }).length;
    count.textContent = withBase ? withBase + " tracked" : "";

    /* A board with no real-time departures at all can never fill this card.
       Los Angeles is the clear case: Metro Rail and Metrolink are both bundled
       timetables, so every row is scheduled, and a "typical wait" measured off
       a timetable is just the printed headway read back — it cannot ever show
       the deterioration the card exists to show. Rather than sit there saying
       "learning…" forever on a board where it never will, the card takes
       itself off the screen, the same way the family cards and the alert card
       do when they have nothing to say. It comes back by itself the moment a
       live feed appears (a board can gain one via an optional Worker), and any
       history already recorded keeps it visible. */
    var anyLive = pool().some(function (d) { return d.live; });
    if (!rows.length && !anyLive) {
      card.style.display = "none";
      return;
    }
    card.style.display = "";

    if (!rows.length) {
      stat.textContent = "";
      list.innerHTML = '<div class="empty" style="text-align:left">Watching how long you wait at these stops. ' +
        "A typical wait needs a day or so of the board being on.</div>";
      return;
    }
    stat.textContent = withBase ? "today vs your last 2 weeks" : "learning your usual waits…";

    list.innerHTML = rows.slice(0, 8).map(function (r) {
      var m = r.meta;
      var todayTxt = r.todayAvg != null ? r.todayAvg.toFixed(1).replace(/\.0$/, "") + " min" : "—";
      var baseTxt = r.baseAvg != null ? "usually " + r.baseAvg.toFixed(1).replace(/\.0$/, "") : "learning…";
      var delta = (r.todayAvg != null && r.baseAvg != null) ? r.todayAvg - r.baseAvg : null;
      var cls = delta == null ? "ot-same" : delta >= 1 ? "ot-worse" : delta <= -1 ? "ot-better" : "ot-same";
      // Under a minute either way is noise on a median wait, so it says "same"
      // rather than dressing up ±0.4 as a trend.
      var dTxt = delta == null ? "" : Math.abs(delta) < 1 ? "same"
        : (delta > 0 ? "+" : "−") + Math.abs(delta).toFixed(0) + " min";
      return '<div class="row">' +
        '<div class="badge" style="background:' + esc(m.color || "#556") + ';color:#fff">' + esc(m.route || m.mode) + "</div>" +
        '<div><div class="dest">' + esc(m.stop) + "</div>" +
        '<div class="sub">' + esc(baseTxt) + "</div></div>" +
        "<div>" + sparkSVG(r.series, m.color || "#7cc0ff") + "</div>" +
        '<div class="times"><div class="live">' + esc(todayTxt) + "</div>" +
        '<div class="sched ot-delta ' + cls + '">' + esc(dTxt) + "</div></div></div>";
    }).join("");
    /* eslint-disable-next-line no-undef */
    if (typeof fitList === "function") { try { fitList(list); } catch (_) {} }
  }

  function onData() { try { sample(); paint(); } catch (_) {} }

  function boot() {
    try {
      ensureCard();
      paint();
      setInterval(onData, 60000);
    } catch (_) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  root.TBOnTime = {
    onData: onData,
    stats: statsFor,
    reset: function () { hist = {}; write(LS.hist, hist); paint(); },
  };
})(typeof window !== "undefined" ? window : this);
