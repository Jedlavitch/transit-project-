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

  var LS = { hist: "tb.ontime.hist", hours: "tb.ontime.hours", hide: "tb.ontime.hidden" };
  var HIDE_ID = "ontimeCard";
  var KEEP_DAYS = 14;        // two weeks: enough for a weekday baseline, small enough to stay tiny
  var MIN_SAMPLES = 8;       // below this a "typical" is noise, and is shown as "—"
  var MAX_KEYS  = 150;       // stops tracked at once; see prune() for why there is a cap
  var HOUR_CAP  = 600;       // per-hour samples before the bucket is halved; see hours below

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

  /* ---- the hour-of-day profile -------------------------------------------
     { "metro|Bethesda|RD": { "8": [count, sum, max] } }

     Separate from `hist` rather than nested inside a day, because the sizes are
     not comparable: 150 stops x 14 days x 24 hours of triples is half a megabyte
     of localStorage, while 150 stops x 24 hours is about forty kilobytes. The
     daily series answers "is today worse than usual"; this answers "when is it
     usually bad", and that question wants every observation it can get rather
     than a fortnight's.

     It has no expiry date, so it decays instead: at HOUR_CAP samples a bucket is
     halved, which keeps it a rolling estimate that follows a timetable change
     over a week or two rather than being anchored forever to how the route ran
     the month you set the board up. */
  var hours = read(LS.hours, {});

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

    /* The hour profile has no dates of its own to expire, so it follows the
       daily history's key set: a stop that aged out of `hist` above (or was
       dropped as least-observed) takes its hour buckets with it. Without this
       the profile would be the one unbounded thing left in the feature. */
    for (var h in hours) if (!hist[h]) { delete hours[h]; changed = true; }
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

    var day = today(), hr = String(new Date().getHours()), any = false;
    for (var key in soonest) {
      if (!hist[key]) hist[key] = {};
      var rec = hist[key][day] || [0, 0, 0];
      rec[0] += 1; rec[1] += soonest[key]; rec[2] = Math.max(rec[2], soonest[key]);
      hist[key][day] = rec; any = true;

      if (!hours[key]) hours[key] = {};
      var hrec = hours[key][hr] || [0, 0, 0];
      hrec[0] += 1; hrec[1] += soonest[key]; hrec[2] = Math.max(hrec[2], soonest[key]);
      // Halve rather than clamp: clamping at a cap would freeze the average at
      // whatever it was the day the cap was reached and never move again.
      if (hrec[0] >= HOUR_CAP) { hrec[0] = Math.round(hrec[0] / 2); hrec[1] = hrec[1] / 2; }
      hours[key][hr] = hrec;
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
    write(LS.hours, hours);
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
      // The full fortnight. The card's sparkline slices the last seven itself;
      // the detail view plots every day it has.
      series: series,
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
      '<button type="button" id="otMoreBtn" title="Open the full history — charts by day and by hour">' +
        '<svg viewBox="0 0 12 10" width="11" height="9" aria-hidden="true" focusable="false">' +
          '<rect x="0" y="5" width="3" height="5" rx="1" fill="currentColor"/>' +
          '<rect x="4.5" y="2" width="3" height="8" rx="1" fill="currentColor"/>' +
          '<rect x="9" y="0" width="3" height="10" rx="1" fill="currentColor"/>' +
        "</svg><span>Details</span></button>" +
      '<button type="button" id="otHideBtn" title="Hide this box — bring it back in Settings, Show on board">×</button>' +
      "</h2>" +
      '<div class="statline" id="otStat"></div>' +
      '<div class="list" id="otList"></div>';
    cards.appendChild(card);
    if (hiddenNow()) card.classList.add("user-hidden");
    var x = card.querySelector("#otHideBtn");
    if (x) x.onclick = function () { setHidden(true); card.classList.add("user-hidden"); };
    var more = card.querySelector("#otMoreBtn");
    if (more) more.onclick = function () { openDetail(null); };
    /* Delegated, because paint() replaces the list's innerHTML every minute and
       handlers bound to the rows themselves would go with it. */
    var l = card.querySelector("#otList");
    if (l) l.addEventListener("click", function (e) {
      var row = e.target && e.target.closest && e.target.closest("[data-otkey]");
      if (row) openDetail(row.getAttribute("data-otkey"));
    });
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
      return '<div class="row ot-row" tabindex="0" role="button" data-otkey="' + esc(r.meta.key) +
        '" title="See the full history for this stop">' +
        '<div class="badge" style="background:' + esc(m.color || "#556") + ';color:#fff">' + esc(m.route || m.mode) + "</div>" +
        '<div><div class="dest">' + esc(m.stop) + "</div>" +
        '<div class="sub">' + esc(baseTxt) + "</div></div>" +
        "<div>" + sparkSVG(r.series.slice(-7), m.color || "#7cc0ff") + "</div>" +
        '<div class="times"><div class="live">' + esc(todayTxt) + "</div>" +
        '<div class="sched ot-delta ' + cls + '">' + esc(dTxt) + "</div></div></div>";
    }).join("");
    /* eslint-disable-next-line no-undef */
    if (typeof fitList === "function") { try { fitList(list); } catch (_) {} }
  }

  /* =========================================================================
     THE DETAIL VIEW

     The card answers one question in one line: is this stop slower than usual
     today. Everything else it knows is thrown away at render time — a fortnight
     of daily figures compressed into seven 16px bars, and, until now, an
     hour-of-day pattern that was never recorded at all.

     This is where the rest of it lives. Two charts of the same measurement,
     against two different references:

       by day   — your last fortnight, against your own usual
       by hour  — when in the day this stop is bad, against its own all-hours mean

     Colour carries better/worse/about-the-same, and because red-green is exactly
     the pair that fails under deuteranopia, it is never the only channel: the bar
     is also above or below a drawn reference line, its tooltip states the
     difference in words, and "Show the numbers" prints the whole thing as a
     table. Measured against the surfaces this board actually uses, that pair sits
     in the separation band where secondary encoding is mandatory rather than
     merely nice, so all three of those are load-bearing.
     ====================================================================== */

  var MIN_HOUR = 4;          // samples before an hour is worth drawing at all
  var PLOT_H   = 132;        // px; the axis strip is outside this, so it can't clip

  var DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  function dayParts(d) {                       // "2026-09-01" -> local Date
    var p = String(d).split("-");
    return new Date(+p[0], +p[1] - 1, +p[2]);
  }
  function dayLabel(d) {
    var dt = dayParts(d);
    return DOW[dt.getDay()] + " " + dt.getDate();
  }
  function hourLabel(h) {
    h = +h;
    var ap = h < 12 ? "am" : "pm", n = h % 12; if (!n) n = 12;
    return n + ap;
  }
  function mins(v) { return v == null ? "—" : v.toFixed(1).replace(/\.0$/, "") + " min"; }

  /* Everything the dialog needs about one stop, computed once per render rather
     than per chart. Deliberately not folded into statsFor(), which runs for every
     row of the card on every repaint and has no use for any of this. */
  function deepStats(key) {
    var days = hist[key] || {}, hrs = hours[key] || {}, day = today();

    var series = [], maxSeen = 0, maxDay = "", totalN = 0;
    var wdN = 0, wdSum = 0, weN = 0, weSum = 0, bN = 0, bSum = 0;
    Object.keys(days).sort().forEach(function (d) {
      var r = days[d], avg = r[0] ? r[1] / r[0] : 0;
      series.push({ x: d, label: dayLabel(d), avg: avg, n: r[0], max: r[2], cur: d === day });
      totalN += r[0];
      if (r[2] > maxSeen) { maxSeen = r[2]; maxDay = d; }
      if (d !== day) { bN += r[0]; bSum += r[1]; }
      var wd = dayParts(d).getDay();
      if (wd === 0 || wd === 6) { weN += r[0]; weSum += r[1]; } else { wdN += r[0]; wdSum += r[1]; }
    });

    /* Hours are plotted across the span actually observed, not 0–23: a board
       switched off overnight would otherwise spend half the chart on a run of
       empty columns that say nothing. Gaps INSIDE the span are kept, because a
       gap in the middle of your day is a real fact about the board's uptime. */
    var hourly = [], hN = 0, hSum = 0, lo = 24, hi = -1, nowH = new Date().getHours();
    for (var k in hrs) { var i = +k; if (hrs[k][0] >= MIN_HOUR) { if (i < lo) lo = i; if (i > hi) hi = i; } }
    for (var h = lo; h <= hi; h++) {
      var r2 = hrs[String(h)];
      var ok = r2 && r2[0] >= MIN_HOUR;
      hourly.push({
        x: String(h), label: hourLabel(h), avg: ok ? r2[1] / r2[0] : null,
        n: r2 ? r2[0] : 0, max: r2 ? r2[2] : 0, cur: h === nowH,
      });
      if (ok) { hN += r2[0]; hSum += r2[1]; }
    }

    var tRec = days[day];
    return {
      key: key,
      series: series,
      hourly: hourly,
      hourBase: hN ? hSum / hN : null,
      todayAvg: tRec && tRec[0] ? tRec[1] / tRec[0] : null,
      todayN: tRec ? tRec[0] : 0,
      base: bN >= MIN_SAMPLES ? bSum / bN : null,
      baseN: bN,
      weekday: wdN >= MIN_SAMPLES ? wdSum / wdN : null,
      weekend: weN >= MIN_SAMPLES ? weSum / weN : null,
      maxSeen: maxSeen, maxDay: maxDay,
      totalN: totalN,
      since: series.length ? series[0].x : "",
    };
  }

  /* Every stop with a history, whether or not the board is watching it now.
     A stop you have moved away from keeps its record (see prune) and is exactly
     the sort of thing someone opens this dialog to look up, so the metadata is
     recovered from the key itself when the live pool no longer has it. */
  function trackedKeys() {
    var meta = {};
    pool().forEach(function (d) {
      if (!d.stop) return;
      var k = d.mode + "|" + d.stop + "|" + (d.route || "");
      if (!meta[k]) meta[k] = { key: k, mode: d.mode, stop: d.stop, route: d.route || "", color: d.color, live: true };
    });
    var out = [];
    Object.keys(hist).forEach(function (k) {
      if (!meta[k]) {
        var p = k.split("|");
        meta[k] = { key: k, mode: p[0] || "", stop: p[1] || k, route: p[2] || "", color: "", live: false };
      }
      var n = 0;
      for (var d in hist[k]) n += hist[k][d][0];
      meta[k].n = n;
      out.push(meta[k]);
    });
    // Watched-now first, then by how much you have actually seen it.
    out.sort(function (a, b) { return (b.live - a.live) || (b.n - a.n); });
    return out;
  }

  /* ---- the charts ---------------------------------------------------------
     Plain elements rather than an SVG. An SVG has to choose between a fixed
     viewBox (whose text shrinks to 6px when the dialog is 340px wide on a phone)
     and preserveAspectRatio="none" (which stretches the glyphs). Divs keep the
     labels at real CSS sizes at every width, and a bar is a rectangle either
     way. */
  function state(v, base) {
    if (v == null || base == null) return "same";
    var d = v - base;
    return d >= 1 ? "worse" : d <= -1 ? "better" : "same";
  }
  function deltaWords(v, base, what) {
    if (v == null) return "no reading";
    if (base == null) return mins(v);
    var d = v - base;
    if (Math.abs(d) < 1) return mins(v) + " — about the same as " + what;
    return mins(v) + " — " + Math.abs(d).toFixed(0) + " min " + (d > 0 ? "longer" : "shorter") + " than " + what;
  }

  function chart(o) {
    // o: { pts, base, baseWord, everyNth, id }
    var pts = o.pts;
    if (!pts.length) return '<div class="ot-none">Nothing recorded yet.</div>';

    var vals = [];
    pts.forEach(function (p) { if (p.avg != null) vals.push(p.avg); });
    if (o.base != null) vals.push(o.base);
    if (!vals.length) return '<div class="ot-none">Nothing recorded yet.</div>';

    // 1.28x headroom so the tallest bar's own label has somewhere to sit.
    var top = Math.max.apply(null, vals) * 1.28 || 1;
    var worst = -1, worstV = -Infinity;
    pts.forEach(function (p, i) { if (p.avg != null && p.avg > worstV) { worstV = p.avg; worst = i; } });

    var cols = pts.map(function (p, i) {
      var st = p.avg == null ? "none" : state(p.avg, o.base);
      var pct = p.avg == null ? 0 : Math.max(2, (p.avg / top) * 100);
      // Selective labels only: the current column and the worst one. A number on
      // every bar is unreadable and goes unread.
      var lab = (p.cur || i === worst) && p.avg != null
        ? '<span class="ot-val">' + esc(p.avg.toFixed(1).replace(/\.0$/, "")) + "</span>" : "";
      var tip = p.label + " · " + (p.avg == null
        ? (p.n ? "only " + p.n + " readings — not enough yet" : "board was off")
        : deltaWords(p.avg, o.base, o.baseWord) + " · " + p.n + " readings");
      return '<div class="ot-col" data-s="' + st + (p.cur ? '" data-cur="1' : '"') +
        ' tabindex="0" data-tip="' + esc(tip) + '">' + lab +
        '<span class="ot-bar" style="height:' + pct.toFixed(1) + '%"></span></div>';
    }).join("");

    var basePct = o.base == null ? null : Math.min(96, (o.base / top) * 100);
    var baseEl = basePct == null ? "" :
      '<div class="ot-base" style="bottom:' + basePct.toFixed(1) + '%"><i></i><b>' +
      esc(o.baseWord + " " + o.base.toFixed(1).replace(/\.0$/, "")) + "</b></div>";

    var nth = o.everyNth || 1;
    var axis = pts.map(function (p, i) {
      var show = nth === 1 || i % nth === 0 || p.cur;
      return '<span' + (p.cur ? ' class="cur"' : "") + ">" + (show ? esc(p.label) : "") + "</span>";
    }).join("");

    return '<div class="ot-plot" style="height:' + PLOT_H + 'px">' + baseEl +
      '<div class="ot-cols">' + cols + "</div></div>" +
      '<div class="ot-axis">' + axis + "</div>";
  }

  /* The table twin. A tooltip is an enhancement; it must never be the only way
     to read a value — and on a touchscreen kiosk there is no hover at all. */
  function table(pts, base, head) {
    var rows = pts.map(function (p) {
      var d = (p.avg != null && base != null) ? p.avg - base : null;
      var dTxt = d == null ? "—" : (Math.abs(d) < 1 ? "same" : (d > 0 ? "+" : "−") + Math.abs(d).toFixed(1).replace(/\.0$/, ""));
      return "<tr><th>" + esc(p.label) + "</th><td>" + esc(p.avg == null ? "—" : mins(p.avg)) +
        '</td><td class="ot-' + (d == null ? "same" : d >= 1 ? "worse" : d <= -1 ? "better" : "same") + '">' +
        esc(dTxt) + "</td><td>" + (p.n || 0) + "</td></tr>";
    }).join("");
    return '<table class="ot-tbl"><thead><tr><th>' + esc(head) +
      "</th><td>Typical wait</td><td>vs usual</td><td>Readings</td></tr></thead><tbody>" +
      rows + "</tbody></table>";
  }

  /* ---- the dialog --------------------------------------------------------- */
  var dlg = null, selKey = null, showNums = false;

  function tile(label, value, sub, cls) {
    return '<div class="ot-tile"><div class="ot-tl">' + esc(label) + "</div>" +
      '<div class="ot-tv">' + esc(value) + "</div>" +
      '<div class="ot-ts ' + (cls || "") + '">' + esc(sub || "") + "</div></div>";
  }

  function renderDetail() {
    if (!dlg) return;
    var body = dlg.querySelector("#otdBody");
    if (!body) return;
    var keep = body.scrollTop;

    var keys = trackedKeys();
    if (!keys.length) {
      body.innerHTML = '<div class="ot-none">Nothing recorded yet. The board notes how long the next ' +
        "vehicle is away each time it refreshes; leave it running and a day or so from now this will " +
        "have something to show.</div>" + explainerHTML();
      return;
    }
    var found = false;
    keys.forEach(function (k) { if (k.key === selKey) found = true; });
    if (!found) selKey = keys[0].key;

    var meta = keys[0];
    keys.forEach(function (k) { if (k.key === selKey) meta = k; });
    var st = deepStats(selKey);

    var chips = keys.map(function (k) {
      return '<button type="button" class="ot-chip' + (k.key === selKey ? " on" : "") +
        '" data-otkey="' + esc(k.key) + '">' +
        '<i style="background:' + esc(k.color || "var(--muted,#93a5cf)") + '"></i>' +
        (k.route ? "<b>" + esc(k.route) + "</b>" : "") + esc(k.stop) +
        (k.live ? "" : '<em title="not on the board right now">·</em>') + "</button>";
    }).join("");

    var dNow = (st.todayAvg != null && st.base != null) ? st.todayAvg - st.base : null;
    var dCls = dNow == null ? "" : dNow >= 1 ? "ot-worse" : dNow <= -1 ? "ot-better" : "";
    var tiles =
      tile("Today", st.todayAvg == null ? "—" : mins(st.todayAvg),
        dNow == null ? (st.todayN ? st.todayN + " readings" : "nothing yet today")
          : Math.abs(dNow) < 1 ? "about your usual"
          : (dNow > 0 ? "+" : "−") + Math.abs(dNow).toFixed(1).replace(/\.0$/, "") + " min vs usual", dCls) +
      tile("Usual", st.base == null ? "learning…" : mins(st.base),
        st.base == null ? "needs a day or so more" : "over " + st.series.length + " days") +
      tile("Longest wait seen", st.maxSeen ? st.maxSeen + " min" : "—",
        st.maxDay ? "on " + dayLabel(st.maxDay) : "") +
      tile("Readings", String(st.totalN),
        st.since ? "since " + dayLabel(st.since) : "");

    var split = (st.weekday != null && st.weekend != null)
      ? '<div class="ot-split">Weekdays <b>' + esc(mins(st.weekday)) + "</b> · Weekends <b>" +
        esc(mins(st.weekend)) + "</b></div>" : "";

    var hourBody = st.hourly.length
      ? chart({ pts: st.hourly, base: st.hourBase, baseWord: "all hours",
                everyNth: st.hourly.length > 10 ? 3 : 1 })
      : '<div class="ot-none">Not enough of the day observed yet — an hour needs about a minute of ' +
        "the board being on before it counts.</div>";

    body.innerHTML =
      '<div class="ot-chips">' + chips + "</div>" +
      '<div class="ot-tiles">' + tiles + "</div>" +

      '<section class="ot-fig"><div class="ot-fig-h"><h4>Typical wait, by day</h4>' +
      '<span>bars above the line were slower than your usual</span></div>' +
      chart({ pts: st.series, base: st.base, baseWord: "usual" }) + split + "</section>" +

      '<section class="ot-fig"><div class="ot-fig-h"><h4>Typical wait, by hour of day</h4>' +
      "<span>when this stop is worth leaving early for</span></div>" + hourBody + "</section>" +

      '<button type="button" id="otdNums" class="ot-ghost">' +
      (showNums ? "Hide the numbers" : "Show the numbers") + "</button>" +
      (showNums
        ? '<div class="ot-tables">' + table(st.series, st.base, "Day") +
          (st.hourly.length ? table(st.hourly, st.hourBase, "Hour") : "") + "</div>"
        : "") +
      explainerHTML() +
      '<div class="ot-foot"><button type="button" id="otdWipe" class="ot-ghost danger">' +
      "Forget this history</button></div>";

    body.scrollTop = keep;
  }

  function explainerHTML() {
    return '<p class="ot-explain">This measures <b>how long you wait</b>, not whether a vehicle ' +
      "was late — most of these feeds publish a countdown and no timetable to be late against, so " +
      "a percentage on-time would be invented rather than measured. A typical wait tracks headway, " +
      "which is the thing that actually goes wrong. Every figure here came from this screen watching " +
      "its own board; nothing was uploaded, and clearing it below is the end of it.</p>";
  }

  function openDetail(key) {
    if (dlg) { if (key) { selKey = key; renderDetail(); } return; }
    if (key) selKey = key;
    injectCss();

    dlg = document.createElement("div");
    dlg.id = "otdOverlay";
    dlg.innerHTML =
      '<div id="otdBox" role="dialog" aria-modal="true" aria-label="Track record">' +
      '<header><h3>Track record</h3>' +
      "<p>How long you have actually waited, at the stops this board watches.</p>" +
      '<button type="button" id="otdClose" aria-label="Close">×</button></header>' +
      '<div id="otdBody"></div><div id="otdTip" hidden></div></div>';

    dlg.addEventListener("click", function (e) { if (e.target === dlg) closeDetail(); });
    document.addEventListener("keydown", onDlgKey);
    document.body.appendChild(dlg);
    dlg.querySelector("#otdClose").onclick = closeDetail;

    var body = dlg.querySelector("#otdBody");
    body.addEventListener("click", function (e) {
      var t = e.target;
      var chip = t.closest && t.closest(".ot-chip");
      if (chip) { selKey = chip.getAttribute("data-otkey"); renderDetail(); return; }
      if (t.id === "otdNums") { showNums = !showNums; renderDetail(); return; }
      if (t.id === "otdWipe") { wipe(t); return; }
    });

    // One tooltip element moved around, rather than one per column. Keyboard
    // focus shows exactly what hover shows.
    var tip = dlg.querySelector("#otdTip");
    function showTip(el) {
      var txt = el && el.getAttribute("data-tip");
      if (!txt) { tip.hidden = true; return; }
      tip.textContent = txt;
      tip.hidden = false;
      var b = dlg.querySelector("#otdBox").getBoundingClientRect(), r = el.getBoundingClientRect();
      var x = r.left - b.left + r.width / 2 - tip.offsetWidth / 2;
      tip.style.left = Math.max(6, Math.min(b.width - tip.offsetWidth - 6, x)) + "px";
      tip.style.top = (r.top - b.top - tip.offsetHeight - 7) + "px";
    }
    body.addEventListener("pointerover", function (e) {
      var c = e.target.closest && e.target.closest(".ot-col"); if (c) showTip(c);
    });
    body.addEventListener("pointerout", function (e) {
      if (!e.relatedTarget || !e.relatedTarget.closest || !e.relatedTarget.closest(".ot-col")) tip.hidden = true;
    });
    body.addEventListener("focusin", function (e) {
      var c = e.target.closest && e.target.closest(".ot-col");
      if (c) showTip(c); else tip.hidden = true;
    });
    body.addEventListener("scroll", function () { tip.hidden = true; });

    renderDetail();
    dlg.querySelector("#otdClose").focus();
  }

  /* Two taps, because there is no undo and no copy anywhere else — the history
     only ever existed in this browser. */
  function wipe(btn) {
    if (btn.dataset.armed !== "1") {
      btn.dataset.armed = "1";
      btn.textContent = "Tap again to erase everything";
      setTimeout(function () {
        if (btn && btn.dataset.armed === "1") { btn.dataset.armed = ""; btn.textContent = "Forget this history"; }
      }, 4000);
      return;
    }
    hist = {}; hours = {};
    write(LS.hist, hist); write(LS.hours, hours);
    selKey = null;
    renderDetail();
    paint();
  }

  function onDlgKey(e) { if (e.key === "Escape") closeDetail(); }

  function closeDetail() {
    document.removeEventListener("keydown", onDlgKey);
    if (dlg) { dlg.remove(); dlg = null; }
    var b = document.getElementById("otMoreBtn");
    if (b) b.focus();
  }

  function onData() { try { sample(); paint(); if (dlg) renderDetail(); } catch (_) {} }

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
