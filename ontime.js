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

  var LS = { hist: "tb.ontime.hist", hours: "tb.ontime.hours", late: "tb.ontime.late",
             lateHours: "tb.ontime.latehours", hide: "tb.ontime.hidden" };
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
  /* Bands of waiting, in whole minutes. Recorded as counts rather than a
     threshold flag because any single threshold has to be chosen at WRITE time,
     and there is no threshold that is right for both a three-minute subway and
     a half-hourly bus. Counting into fixed bands lets the question ("how often
     is it bad?") be asked at READ time, against whatever definition of bad the
     stop deserves — and it is the only way to answer it at all without a
     timetable to be late against. */
  var BANDS = ["0–2", "3–5", "6–10", "11–20", "21+"];
  var LONG_BAND = 3;         // band 3 and up = a wait over ten minutes
  function bandOf(v) { return v <= 2 ? 0 : v <= 5 ? 1 : v <= 10 ? 2 : v <= 20 ? 3 : 4; }

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

  /* ---- lateness, where an agency actually publishes it ---------------------
     Everything above measures waiting, because most feeds have no timetable to
     be late against. SEPTA is the exception on these boards: its TrainView and
     TransitView feeds carry a `late` field per vehicle — minutes behind ITS OWN
     schedule, computed by SEPTA, not inferred here. That is a real on-time
     figure, and it is the one thing this file said it could not honestly show.

     So it is kept in its own store, with its own shape and its own vocabulary,
     rather than smuggled into the wait-time history. The two must never be
     averaged together or presented as the same measurement: one is what the
     rider experiences, the other is what the operator promised.

       { "septa-rail|PAO": { _: [label, mode, colour, badge, cancelKnown],
                             "2026-09-01": [n, sumLate, onTime, worst, [bands],
                                            [nOnTime, nDelayed, nCancelled]] } }

     Two different counts live in one record on purpose. The first four are one
     observation per REFRESH — the median across the line, so a train that stays
     late for an hour is one line running late rather than dozens of failures.
     The last is one count per DEPARTURE, because "how often is it cancelled" is
     a question about services, not about how the line felt on average, and a
     median cannot express a cancellation at all.

     A board opts in by calling, once per refresh, with one row per vehicle:
       TBOnTime.late([{ id, label, mode, color, late }, ...])   */
  var LATE_ON_TIME = 6;      // SEPTA calls Regional Rail on time inside 5:59
  var LATE_BANDS = ["≤0", "1–5", "6–14", "15–29", "30+"];
  function lateBandOf(m) { return m <= 0 ? 0 : m <= 5 ? 1 : m <= 14 ? 2 : m <= 29 ? 3 : 4; }
  var lateHist = read(LS.late, {});
  /* The hour-of-day twin of `hours`, and for the same reason: the fortnight
     answers "is today worse than usual", this answers "when in the day does
     it slip". Same halving decay, so a timetable change works its way in
     over a week or two instead of being outvoted by the month you set the
     board up. Only the median observations feed it — a per-departure count
     would need its own bucket and the hour chart is about how the line runs,
     not how many services there were. */
  var lateHours = read(LS.lateHours, {});

  /* ---- the days this screen was not on for -------------------------------
     Everything above is what THIS browser watched, which is honest and is also
     the whole limitation: a board that was off recorded nothing, and a fortnight
     chart mostly reading "board was off" is a chart about the screen rather than
     about the trains.

     gen-ontime-history.py polls the same public feeds from CI every twenty
     minutes and keeps the same six-element daily record, so the archive and the
     browser measure the same quantity and merge by lookup rather than
     conversion. Served off a data branch, which raw.githubusercontent hands over
     with Access-Control-Allow-Origin:* — no Worker, no key, nothing to deploy.

     Two rules keep the merge honest:

       · A day this browser watched always wins. The archive fills gaps; it never
         overwrites a first-hand reading, and the two are never averaged into one
         day, because they poll at different rates and a blended "readings" count
         would mean nothing.
       · It only fills lines the board already knows about. Letting it introduce
         its own would put forty Amtrak routes, most of them a thousand miles
         away, into every city's picker. */
  var ARCHIVE_URL = "https://raw.githubusercontent.com/Jedlavitch/transit-project-" +
                    "/ontime-data/ontime-history.json";
  var archive = null;

  function loadArchive() {
    var url = ARCHIVE_URL;
    try { url = localStorage.getItem("tb.ontime.archiveUrl") || url; } catch (_) {}
    if (!root.fetch) return;
    root.fetch(url, { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.lines) return;
        archive = j;
        try { paint(); } catch (_) {}
        if (dlg) { try { renderDetail(); } catch (_) {} }
      })
      .catch(function () { /* offline, or the branch does not exist yet */ });
  }

  /* This line's days, first-hand where there are any and archived where there
     are not, each tagged so a tooltip can say which it is looking at. */
  function mergedDays(id) {
    var local = lateHist[id] || {}, out = {}, d;
    var arch = (archive && archive.lines && archive.lines[id]) || null;
    if (arch) for (d in arch) if (d !== "_") out[d] = { rec: arch[d], live: false };
    for (d in local) if (d !== "_") out[d] = { rec: local[d], live: true };
    return { days: out, meta: local._ || (arch && arch._) || null };
  }

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
    for (var lh in lateHours) if (!lateHist[lh]) { delete lateHours[lh]; changed = true; }

    /* The lateness store keeps its own dates, so it expires on its own rather
       than following hist's key set — a board can have lateness and no wait
       history at all, which is exactly what Philadelphia is. */
    var lk = Object.keys(lateHist);
    lk.forEach(function (id) {
      var rec = lateHist[id], live = 0;
      for (var d in rec) {
        if (d === "_") continue;
        if (d < cutKey) { delete rec[d]; changed = true; } else live++;
      }
      if (!live) { delete lateHist[id]; changed = true; }
    });
    lk = Object.keys(lateHist);
    if (lk.length > MAX_KEYS) {
      var seenL = lk.map(function (id) {
        var n = 0;
        for (var d in lateHist[id]) if (d !== "_") n += lateHist[id][d][0];
        return { k: id, n: n };
      }).sort(function (a, b) { return a.n - b.n; });
      var dropL = lk.length - MAX_KEYS;
      for (var j2 = 0; j2 < dropL; j2++) { delete lateHist[seenL[j2].k]; changed = true; }
    }
    return changed;
  }

  /* One observation per line per call: the MEDIAN lateness of that line's
     vehicles. Not the mean — a single train stuck behind a disabled one should
     not decide how the whole line is described — and not per-vehicle, which
     would count a train that stays twenty minutes late for an hour as dozens of
     separate failures. The worst single vehicle is kept separately, because
     "how bad did it get" is a different question from "how is it running". */
  /* Which lines THIS board has reported, this session. The store is shared by
     every city — transitproject.online serves all of them from one origin — so
     without this a Los Angeles board would list SEPTA's bus routes because the
     browser had visited Philadelphia earlier, and LA's deliberate "I have
     nothing to measure, take me off the screen" would stop working. The dialog
     still lists everything: looking up a record you recorded elsewhere is
     reasonable. Putting it on this board's card is not. */
  var seenLate = {};
  var lastLateAt = 0, lateTimer = null, pendingLate = null;

  /* Buffers rather than drops. The throttle used to return early, which was
     fine while exactly one source per board called in — and became a bug the
     moment two did: on Philadelphia the SEPTA reporter and the Amtrak sampler
     below both report, and whichever arrived second inside the window was
     thrown away for good. Sources cover disjoint lines, so merging by id and
     flushing once is the same measurement, just without the loss. */
  function recordLate(rows) {
    if (!rows || !rows.length) return;
    var by = collectLate(rows, pendingLate);
    pendingLate = by;
    var now = Date.now(), since = now - lastLateAt;
    if (since >= 25000) { flushLate(); return; }
    if (lateTimer) return;
    lateTimer = setTimeout(function () { lateTimer = null; flushLate(); }, 25000 - since);
  }

  function collectLate(rows, into) {
    var by = into || {};
    rows.forEach(function (r) {
      if (!r || !r.id) return;
      var m = Number(r.late);
      // Same sanity bound delays.js uses: past an hour and a half it is a
      // parsing fault, not a delay.
      if (!isFinite(m) || Math.abs(m) > 90) return;
      if (!by[r.id]) by[r.id] = { meta: [r.label || r.id, r.mode || "", r.color || "", r.badge || ""], v: [] };
      if (by[r.id].sealed) { by[r.id].sealed = false; by[r.id].v = []; by[r.id].st = [0, 0, 0]; }
      by[r.id].v.push(Math.round(m));
    });

    /* Status is counted over every row, including the cancelled ones the median
       above deliberately skips — a cancelled service has no lateness to average
       and pretending it does would flatter the line. A feed that publishes no
       cancellation field sets no `statusKnown`, and its record keeps a zero
       rather than a false "never cancelled": see cancelKnown below. */
    rows.forEach(function (r) {
      if (!r || !r.id) return;
      if (!by[r.id]) {
        by[r.id] = { meta: [r.label || r.id, r.mode || "", r.color || "", r.badge || ""], v: [] };
      }
      var b = by[r.id];
      if (b.sealed) { b.sealed = false; b.v = []; b.st = [0, 0, 0]; }
      if (!b.st) b.st = [0, 0, 0];
      if (r.statusKnown) b.known = 1;
      if (r.cancelled) { b.st[2] += 1; return; }
      var lm = Number(r.late);
      if (!isFinite(lm) || Math.abs(lm) > 90) return;   // no figure = no verdict
      if (Math.round(lm) >= LATE_ON_TIME) b.st[1] += 1; else b.st[0] += 1;
    });

    for (var k in by) by[k].sealed = true;    // a later call in the same window starts that id afresh
    return by;
  }

  function flushLate() {
    var by = pendingLate; pendingLate = null;
    if (!by) return;
    var day = today(), any = false;
    for (var id in by) {
      var v = by[id].v.sort(function (a, b) { return a - b; });
      /* A line whose every departure is cancelled contributes no lateness at
         all, and the even-length median of an empty list is NaN — which would
         have poisoned the running sum permanently. The status counts below
         still record it, which is the whole point of counting them separately. */
      var med = null;
      if (v.length) {
        med = v.length % 2
          ? v[(v.length - 1) / 2]
          : Math.round((v[v.length / 2 - 1] + v[v.length / 2]) / 2);
      }
      if (!lateHist[id]) lateHist[id] = {};
      var mt = by[id].meta.slice();
      // Sticky: a feed that has published cancellations once still publishes
      // them on a refresh where nothing happened to be cancelled.
      mt[4] = by[id].known || (lateHist[id]._ && lateHist[id]._[4]) || 0;
      lateHist[id]._ = mt;
      var rec = lateHist[id][day] || [0, 0, 0, 0, [0, 0, 0, 0, 0], [0, 0, 0]];
      if (!rec[4]) rec[4] = [0, 0, 0, 0, 0];
      if (!rec[5]) rec[5] = [0, 0, 0];
      if (med != null) {
        rec[0] += 1;
        rec[1] += med;
        if (med < LATE_ON_TIME) rec[2] += 1;
        if (v[v.length - 1] > rec[3]) rec[3] = v[v.length - 1];
        rec[4][lateBandOf(med)] += 1;

        var hr = String(new Date().getHours());
        if (!lateHours[id]) lateHours[id] = {};
        var hrec = lateHours[id][hr] || [0, 0, 0];
        hrec[0] += 1; hrec[1] += med;
        if (med < LATE_ON_TIME) hrec[2] += 1;
        if (hrec[0] >= HOUR_CAP) {
          hrec[0] = Math.round(hrec[0] / 2); hrec[1] = hrec[1] / 2; hrec[2] = Math.round(hrec[2] / 2);
        }
        lateHours[id][hr] = hrec;
      }
      var st = by[id].st || [0, 0, 0];
      rec[5][0] += st[0]; rec[5][1] += st[1]; rec[5][2] += st[2];
      lateHist[id][day] = rec;
      seenLate[id] = 1;
      any = true;
    }
    if (!any) return;
    lastLateAt = Date.now();
    prune();
    write(LS.late, lateHist);
    write(LS.lateHours, lateHours);
    paint();
    /* And the dialog, if it is open. It used to wait for the next 60-second
       tick, so a reading that had just landed sat invisible behind an open
       panel for up to a minute. Cheap now that a repaint patches rather than
       rebuilds — the bars simply move to their new heights. */
    if (dlg) { try { renderDetail(); } catch (_) {} }
  }

  /* ---- Amtrak, on every board that carries it -----------------------------
     Eight of the twelve boards render an Amtrak card, and every one of them
     already parks the list in `state._amtrak` for its stats strip. amtraker
     publishes each train's scheduled and actual time per stop, and delays.js
     already derives the minutes-late from them for the row you can see.

     So the record is taken from the board's own state rather than wired into
     eight render functions: nothing to keep in step, nothing for a new city to
     remember, and a board that gains an Amtrak card gains its on-time history
     with it. This is the same trick sample() uses on `state._depBy`.

     Grouped by ROUTE — "Keystone", "Silver Meteor" — not by train number,
     which is unique to one journey and could never accumulate a record. */
  function amtrakBadge(name) {
    var w = String(name || "").split(/[^A-Za-z0-9]+/).filter(Boolean);
    if (w.length > 1) return w.map(function (x) { return x[0]; }).join("").toUpperCase().slice(0, 4);
    return (w[0] || "?").slice(0, 3).toUpperCase();
  }
  function amtrakRows() {
    var st = boardState(), list = (st && st._amtrak) || [];
    if (!list.length || typeof root.amtrakLateMin !== "function") return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var t = list[i] && list[i].t; if (!t) continue;
      var stops = t.stations || [], ns = null;
      for (var j = 0; j < stops.length; j++) {
        if (stops[j] && stops[j].status !== "Departed") { ns = stops[j]; break; }
      }
      var m = ns ? root.amtrakLateMin(ns) : null;
      if (m == null) continue;
      var name = String(t.routeName || "Amtrak").trim() || "Amtrak";
      out.push({
        id: "amtrak|" + name, label: name, badge: amtrakBadge(name),
        mode: "train", color: "var(--amtrak,#3ad0c8)", late: m,
        // amtraker drops a cancelled train from the feed rather than flagging
        // it, so there is no cancelled share to claim here.
        statusKnown: false,
      });
    }
    return out;
  }

  function lateStats(id) {
    var m0 = mergedDays(id), byDay = m0.days, day = today();
    var meta = m0.meta || [id, "", "", "", 0];
    var series = [], onSeries = [], band = [0, 0, 0, 0, 0], bandN = 0;
    // one entry per day, each a share of that day's classified departures
    var statusDays = [[], [], []], status = [0, 0, 0], statusN = 0;
    var worst = 0, worstDay = "", totalN = 0;
    var bN = 0, bSum = 0, bOn = 0;          // the fortnight, excluding today
    Object.keys(byDay).sort().forEach(function (d) {
      var r = byDay[d].rec, live = byDay[d].live, n = r[0] || 0;
      if (!n) {
        // status-only day: still counts towards the three-way breakdown below
        var sr0 = r[5];
        if (sr0) {
          var t0 = (sr0[0] || 0) + (sr0[1] || 0) + (sr0[2] || 0);
          for (var c0 = 0; c0 < 3; c0++) {
            status[c0] += sr0[c0] || 0;
            statusDays[c0].push({ x: d, label: dayLabel(d), n: t0, cur: d === day,
                                  avg: t0 ? (sr0[c0] || 0) / t0 : null });
          }
          statusN += t0;
        }
        return;
      }
      series.push({ x: d, label: dayLabel(d), avg: r[1] / n, n: n, cur: d === day, live: live });
      onSeries.push({ x: d, label: dayLabel(d), avg: r[2] / n, n: n, cur: d === day, live: live });
      totalN += n;
      if (r[3] > worst) { worst = r[3]; worstDay = d; }
      if (r[4]) for (var b = 0; b < 5; b++) { band[b] += r[4][b] || 0; bandN += r[4][b] || 0; }
      var sr = r[5];
      if (sr) {
        var tot = (sr[0] || 0) + (sr[1] || 0) + (sr[2] || 0);
        for (var c = 0; c < 3; c++) {
          status[c] += sr[c] || 0;
          statusDays[c].push({ x: d, label: dayLabel(d), n: tot, cur: d === day,
                               avg: tot ? (sr[c] || 0) / tot : null });
        }
        statusN += tot;
      }
      if (d !== day) { bN += n; bSum += r[1]; bOn += r[2]; }
    });
    /* Same span rule the wait hours use: first observed hour to last, gaps
       inside it kept, because a gap in the middle of your day is a real fact
       about when the board was on. */
    var hrs = lateHours[id] || {}, hourly = [], hN = 0, hOn = 0;
    var lo = 24, hi = -1, nowH = new Date().getHours();
    for (var k in hrs) { var hi2 = +k; if (hrs[k][0] >= MIN_HOUR) { if (hi2 < lo) lo = hi2; if (hi2 > hi) hi = hi2; } }
    for (var h = lo; h <= hi; h++) {
      var hr2 = hrs[String(h)], ok = hr2 && hr2[0] >= MIN_HOUR;
      hourly.push({ x: String(h), label: hourLabel(h), n: hr2 ? hr2[0] : 0, cur: h === nowH,
                    avg: ok ? hr2[2] / hr2[0] : null,
                    late: ok ? hr2[1] / hr2[0] : null });
      if (ok) { hN += hr2[0]; hOn += hr2[2]; }
    }
    var worstHour = null;
    hourly.forEach(function (q) { if (q.avg != null && (!worstHour || q.avg < worstHour.avg)) worstHour = q; });

    var tRec = byDay[day] && byDay[day].rec;
    var archived = 0;
    Object.keys(byDay).forEach(function (d) { if (!byDay[d].live) archived++; });
    return {
      id: id, label: meta[0], mode: meta[1], color: meta[2],
      archivedDays: archived,
      hourly: hourly, hourBaseOn: hN ? hOn / hN : null, worstHour: worstHour,
      badge: meta[3] || String(meta[0]).slice(0, 4),
      /* Without this the cancelled chart would read "0% cancelled, every day"
         on a feed that simply never says — which is a stronger claim than any
         agency makes about itself. */
      cancelKnown: !!meta[4],
      status: status, statusN: statusN, statusDays: statusDays,
      series: series, onSeries: onSeries,
      band: band, bandN: bandN,
      todayOn: tRec && tRec[0] >= MIN_SAMPLES ? tRec[2] / tRec[0] : null,
      todayLate: tRec && tRec[0] >= MIN_SAMPLES ? tRec[1] / tRec[0] : null,
      todayN: tRec ? tRec[0] : 0,
      /* Same fallback as deepStats: every day it has, today included, rather
         than nothing at all. baseSpan says which, so nothing claims a fortnight
         it does not have. */
      baseOn: bN >= MIN_SAMPLES ? bOn / bN
            : (totalN >= MIN_SAMPLES ? (bOn + (tRec ? tRec[2] : 0)) / (bN + (tRec ? tRec[0] : 0)) : null),
      baseLate: bN >= MIN_SAMPLES ? bSum / bN
              : (totalN >= MIN_SAMPLES ? (bSum + (tRec ? tRec[1] : 0)) / (bN + (tRec ? tRec[0] : 0)) : null),
      baseSpan: bN >= MIN_SAMPLES ? "weeks" : (totalN >= MIN_SAMPLES ? "today" : null),
      baseN: bN,
      worst: worst, worstDay: worstDay,
      totalN: totalN,
      since: series.length ? series[0].x : "",
    };
  }

  /* Sorted worst-first, same as the wait rows: the reason to look is that
     something is off today. */
  function lateKeys() {
    var out = [];
    Object.keys(lateHist).forEach(function (id) {
      var st = lateStats(id);
      if (st.totalN) out.push(st);
    });
    /* Lines that have earned a verdict come first, worst on-time first: that is
       the reason to look at the card at all.

       The ones still learning are then ROUND-ROBINED ACROSS THEIR SOURCES
       rather than ranked by how much has been seen. Sampling rates are not
       comparable between feeds — Regional Rail is reported system-wide on every
       refresh while a bus route is only counted when one is near you — so
       ranking by observation count is really ranking by how often a feed
       happens to talk, and on Philadelphia's first day that filled all eight
       card rows with Regional Rail while thirty-five bus routes and eleven
       Metro lines sat unseen behind them. Round-robin shows a rail line, a
       Metro line, a bus and an Amtrak route instead, which is what the board
       actually covers. Once a line has real readings the verdict sort takes
       over again and the worst rise regardless of source. */
    var verdict = [], learning = [];
    out.forEach(function (x) { (x.todayOn == null ? learning : verdict).push(x); });
    verdict.sort(function (a, b) { return (a.todayOn - b.todayOn) || (b.totalN - a.totalN); });

    var bySrc = {}, srcs = [];
    learning.forEach(function (x) {
      var k = String(x.id).split("|")[0];
      if (!bySrc[k]) { bySrc[k] = []; srcs.push(k); }
      bySrc[k].push(x);
    });
    srcs.sort();
    srcs.forEach(function (k) {
      bySrc[k].sort(function (a, b) { return b.totalN - a.totalN; });
    });
    var mixed = [], i = 0, more = true;
    while (more) {
      more = false;
      for (var j = 0; j < srcs.length; j++) {
        var arr = bySrc[srcs[j]];
        if (i < arr.length) { mixed.push(arr[i]); more = true; }
      }
      i++;
    }
    return verdict.concat(mixed);
  }


  /* One sample per (stop, route) per call: the SOONEST departure, which is the
     wait a person arriving now would face. Taking every listed departure would
     bias the average upwards by however many rows the feed happens to return. */
  /* The wait-side twin of seenLate: stops THIS board has sampled this session.
     Both stores are shared by every city — one origin serves all of them — so
     "what is in localStorage" and "what this board is about" are different
     questions, and the dialog must ask the second one. */
  var seenStop = {};
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
      // Days recorded before this existed have no rec[3]; deepStats counts the
      // bands separately from rec[0] so those readings are reported as unknown
      // rather than quietly landing in band 0.
      if (!rec[3]) rec[3] = [0, 0, 0, 0, 0];
      rec[3][bandOf(soonest[key])] += 1;
      hist[key][day] = rec; any = true;
      seenStop[key] = 1;

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
    var bN = 0, bSum = 0, totalN = 0, series = [];
    Object.keys(days).sort().forEach(function (d) {
      var r = days[d];
      series.push({ d: d, avg: r[0] ? r[1] / r[0] : 0, n: r[0] });
      totalN += r[0];
      if (d !== day) { bN += r[0]; bSum += r[1]; }
    });
    return {
      todayAvg: todayAvg, todayN: todayN,
      // Same first-day fallback deepStats uses: every day it has rather than
      // nothing at all, with baseSpan saying which so no row claims a fortnight
      // it has not lived through.
      baseAvg: bN >= MIN_SAMPLES ? bSum / bN
             : (totalN >= MIN_SAMPLES ? (bSum + (tRec ? tRec[1] : 0)) / (bN + todayN) : null),
      baseSpan: bN >= MIN_SAMPLES ? "weeks" : (totalN >= MIN_SAMPLES ? "today" : null),
      baseN: bN,
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
    if (l) l.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      var row = e.target && e.target.closest && e.target.closest("[data-otkey]");
      if (row) { e.preventDefault(); openDetail(row.getAttribute("data-otkey")); }
    });
    injectCss();
    if ("ResizeObserver" in root) {
      var tmr = null;
      new ResizeObserver(function () {
        card.classList.toggle("ot-narrow", card.clientWidth < 320);
        clearTimeout(tmr); tmr = setTimeout(paint, 140);
      }).observe(card);
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
      /* ---- the card ------------------------------------------------------ */
      "#ontimeCard .ot-spark{display:block}" +
      "#ontimeCard .ot-delta{font-family:var(--mono,monospace);font-weight:700;font-size:12px}" +
      "#ontimeCard .ot-worse{color:var(--late-ink,#ff6b81)}" +
      "#ontimeCard .ot-better{color:var(--live-ink,#39d98a)}" +
      "#ontimeCard .ot-same{color:var(--muted,#93a5cf)}" +
      "#ontimeCard .ot-row{cursor:pointer}" +
      "#ontimeCard .ot-row:hover,#ontimeCard .ot-row:focus-visible{border-color:var(--accent,#4ea1ff);outline:none}" +
      "#ontimeCard h2 #otHideBtn{background:none;border:0;cursor:pointer;font-size:15px;" +
        "line-height:1;color:var(--muted,#93a5cf);padding:0 2px}" +
      "#ontimeCard h2 #otHideBtn:hover{color:var(--late-ink,#ff6b81)}" +
      /* Sits between the count (which owns the margin-left:auto) and the ×. */
      "#ontimeCard h2 #otMoreBtn{display:inline-flex;align-items:center;gap:4px;flex:none;" +
        "padding:2px 7px;border-radius:999px;background:transparent;cursor:pointer;" +
        "border:1px solid var(--line,#22345a);color:var(--muted,#93a5cf);" +
        "font:700 9px/1.5 var(--mono,monospace);letter-spacing:.09em;text-transform:uppercase}" +
      "#ontimeCard h2 #otMoreBtn:hover{border-color:var(--accent,#4ea1ff);color:var(--text,#eef3ff)}" +
      /* The word goes before the card's own title has to truncate; the glyph and
         the title attribute still say what the button is. .ot-narrow is set from
         the card's measured width (see ensureCard); the media query is the
         fallback where ResizeObserver is missing. */
      "#ontimeCard.ot-narrow h2 #otMoreBtn span,#ontimeCard.mini h2 #otMoreBtn span{display:none}" +
      "@media (max-width:900px){#ontimeCard h2 #otMoreBtn span{display:none}}" +
      /* The title keeps its full name; the count is what gives way. */
      "#ontimeCard h2 .t{flex:none}" +
      "#ontimeCard h2 .count{flex:0 1 auto;min-width:0}" +

      /* ---- the dialog ----------------------------------------------------- */
      /* Over #setup's 9999, under feedback.js's 10050, and far under gate.js's
         lock screen, which has to stay on top of everything. */
      "#otdOverlay{position:fixed;inset:0;top:0;right:0;bottom:0;left:0;z-index:10040;display:flex;" +
        "align-items:center;justify-content:center;padding:16px;background:var(--scrim,rgba(5,10,22,.86))}" +
      "#otdBox{position:relative;display:flex;flex-direction:column;width:min(780px,95vw);max-height:92vh;" +
        "background:var(--panel,#111d36);border:1px solid var(--line,#22345a);border-radius:12px;" +
        "color:var(--text,#eef3ff);font-family:var(--body,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif);" +
        "box-shadow:0 18px 60px rgba(0,0,0,.45);overflow:hidden}" +
      "#otdBox header{display:grid;grid-template-columns:1fr auto;align-items:start;gap:8px;" +
        "padding:16px 18px 12px;border-bottom:1px solid var(--line,#22345a)}" +
      "#otdBox header h3{margin:0;font-size:16px;letter-spacing:.01em}" +
      "#otdBox header p{grid-column:1;margin:3px 0 0;font-size:12px;color:var(--muted,#93a5cf);line-height:1.45}" +
      "#otdBox header #otdClose{grid-column:2;grid-row:1/3;background:none;border:0;cursor:pointer;font-size:22px;line-height:1;" +
        "color:var(--muted,#93a5cf);padding:0 2px}" +
      "#otdBox header #otdClose:hover{color:var(--text,#eef3ff)}" +
      "#otdBody{padding:14px 18px 18px;overflow:auto;-webkit-overflow-scrolling:touch}" +

      /* stop picker */
      "#otdBody .ot-chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:12px;" +
        "scrollbar-width:thin}" +
      "#otdBody .ot-chip{flex:none;display:inline-flex;align-items:center;gap:6px;cursor:pointer;" +
        "padding:6px 11px;border-radius:999px;border:1px solid var(--line,#22345a);background:var(--row-bg,#0d1830);" +
        "color:var(--muted,#93a5cf);font:600 12px/1.2 inherit;white-space:nowrap}" +
      "#otdBody .ot-chip:hover{border-color:var(--accent,#4ea1ff)}" +
      "#otdBody .ot-chip.on{border-color:var(--accent,#4ea1ff);color:var(--text,#eef3ff);" +
        "background:var(--panel2,#0c1628)}" +
      "#otdBody .ot-chip i{width:8px;height:8px;border-radius:50%;flex:none}" +
      "#otdBody .ot-chip b{font-family:var(--mono,monospace);font-weight:700}" +
      "#otdBody .ot-chip em{font-style:normal;opacity:.5}" +
      "#otdBody .ot-chip.late{border-style:dashed}" +
      "#otdBody .ot-chip.late.on{border-style:solid}" +
      "#otdBody .ot-more-chip{flex:none;align-self:center;cursor:pointer;white-space:nowrap;" +
        "padding:6px 11px;border-radius:999px;border:1px dashed var(--line,#22345a);background:none;" +
        "color:var(--muted,#93a5cf);font:600 11.5px/1.2 inherit}" +
      "#otdBody .ot-more-chip:hover{border-color:var(--accent,#4ea1ff);color:var(--text,#eef3ff)}" +

      /* stat tiles */
      "#otdBody .ot-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:8px}" +
      "@media (max-width:560px){#otdBody .ot-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}}" +
      "#otdBody .ot-since{font-size:11px;color:var(--muted,#93a5cf);margin:0 0 18px}" +
      "#otdBody .ot-tile{padding:9px 11px;border-radius:8px;background:var(--row-bg,#0d1830);" +
        "border:1px solid var(--row-line,#1c2c4e);min-width:0}" +
      "#otdBody .ot-tl{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted,#93a5cf);" +
        "font-family:var(--mono,monospace);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      /* Proportional figures: tabular-nums makes a standalone value look loose. */
      "#otdBody .ot-tv{font-size:19px;font-weight:700;margin:2px 0 1px;letter-spacing:-.01em}" +
      "#otdBody .ot-ts{font-size:11px;color:var(--muted,#93a5cf);line-height:1.3}" +
      "#otdBody .ot-ts.ot-worse{color:var(--late-ink,#ff6b81)}" +
      "#otdBody .ot-ts.ot-better{color:var(--live-ink,#39d98a)}" +

      /* figure */
      "#otdBody .ot-fig{margin:0 0 20px}" +
      "#otdBody .ot-fig-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:12px}" +
      "#otdBody .ot-fig-h h4{margin:0;font-size:13px;font-weight:700}" +
      "#otdBody .ot-fig-h span{font-size:11px;color:var(--muted,#93a5cf)}" +
      "#otdBody .ot-plot{position:relative}" +
      "#otdBody .ot-cols,#otdBody .ot-axis{display:flex;gap:3px;align-items:flex-end;height:100%;padding-right:58px;box-sizing:border-box}" +
      "#otdBody .ot-col{flex:1 1 0;min-width:0;height:100%;display:flex;flex-direction:column;" +
        "justify-content:flex-end;align-items:center;cursor:default;outline:none}" +
      /* Bars are capped rather than filling the slot; the leftover is deliberate air.
         4px rounded data-end, squared where it meets the baseline. */
      "#otdBody .ot-bar{width:100%;max-width:24px;border-radius:4px 4px 1px 1px;background:var(--muted,#93a5cf)}" +
      "#otdBody .ot-col[data-s='worse'] .ot-bar{background:var(--late-ink,#ff6b81)}" +
      "#otdBody .ot-col[data-s='better'] .ot-bar{background:var(--live-ink,#39d98a)}" +
      "#otdBody .ot-col[data-s='warn'] .ot-bar{background:var(--warn-ink,#ffcc33)}" +
      "#otdBody .ot-col[data-s='none'] .ot-bar{background:var(--line,#22345a);height:2px!important;min-height:2px}" +
      /* Emphasis for today / this hour is a ring and a label, never a hue swap:
         two shades of one colour are the pair people cannot separate. */
      "#otdBody .ot-col[data-cur] .ot-bar{box-shadow:0 0 0 2px var(--panel,#111d36),0 0 0 3px currentColor}" +
      "#otdBody .ot-col[data-cur]{color:var(--accent-ink,#4ea1ff)}" +
      "#otdBody .ot-col:hover .ot-bar,#otdBody .ot-col:focus-visible .ot-bar{filter:brightness(1.18)}" +
      "#otdBody .ot-col:focus-visible{outline:1px solid var(--accent,#4ea1ff);outline-offset:1px;border-radius:3px}" +
      "#otdBody .ot-val{font:700 10px/1 var(--mono,monospace);color:var(--text,#eef3ff);margin-bottom:4px;" +
        "white-space:nowrap}" +
      /* Reference line: solid hairline, one step off the surface, with its value
         named at the end so the bars above it need no explaining. */
      "#otdBody .ot-base{position:absolute;left:0;right:0;height:0;display:flex;align-items:center;" +
        "pointer-events:none;z-index:1}" +
      "#otdBody .ot-base i{flex:1;height:1px;background:var(--sched-b,#b3c3e8);opacity:.5}" +
      "#otdBody .ot-base b{flex:none;width:58px;padding-left:6px;box-sizing:border-box;font:700 9px/1 var(--mono,monospace);letter-spacing:.06em;" +
        "text-transform:uppercase;color:var(--muted,#93a5cf)}" +
      "#otdBody .ot-axis{align-items:flex-start;height:auto;margin-top:6px}" +
      /* overflow:visible so a wide label can spill into the blank slots beside it */
      "#otdBody .ot-axis span{flex:1 1 0;min-width:0;text-align:center;white-space:nowrap;overflow:visible;" +
        "font:600 9.5px/1.3 var(--mono,monospace);color:var(--muted,#93a5cf);letter-spacing:.02em}" +
      "#otdBody .ot-axis span.cur{color:var(--text,#eef3ff)}" +
      /* Narrow: keep only every second label the wide layout shows. Scoped to
         .thin so the hour axis, whose labels are short enough already, is
         left alone. */
      "@media (max-width:620px){#otdBody .ot-axis.thin span:not([data-n2]){visibility:hidden}}" +
      "#otdBody .ot-split{margin-top:10px;font-size:11.5px;color:var(--muted,#93a5cf)}" +
      "#otdBody .ot-split b{color:var(--text,#eef3ff);font-family:var(--mono,monospace)}" +
      "#otdBody .ot-together{font:700 13px/1.4 var(--mono,monospace);letter-spacing:.01em;margin:-4px 0 14px;" +
        "color:var(--text,#eef3ff)}" +
      "#otdBody .ot-multiples{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:18px}" +
      "#otdBody .ot-panel{min-width:0}" +
      "#otdBody .ot-panel-h{display:flex;align-items:center;gap:6px;margin-bottom:8px;font-size:11.5px;" +
        "color:var(--muted,#93a5cf)}" +
      "#otdBody .ot-panel-h b{margin-left:auto;font:700 14px/1 inherit;color:var(--text,#eef3ff)}" +
      "#otdBody .ot-dot{width:9px;height:9px;border-radius:50%;flex:none}" +
      "#otdBody .ot-t-better{background:var(--live-ink,#39d98a)}" +
      "#otdBody .ot-t-warn{background:var(--warn-ink,#ffcc33)}" +
      "#otdBody .ot-t-worse{background:var(--late-ink,#ff6b81)}" +
      "#otdBody .ot-note{margin:12px 0 0;font-size:11.5px;line-height:1.5;color:var(--muted,#93a5cf)}" +
      "#otdBody .ot-sparse{margin:9px 0 0;font-size:11.5px;line-height:1.5;color:var(--muted,#93a5cf);font-style:italic}" +

      /* tooltip */
      "#otdTip{position:absolute;z-index:3;pointer-events:none;max-width:230px;padding:6px 9px;border-radius:7px;" +
        "background:var(--panel2,#0c1628);border:1px solid var(--line,#22345a);color:var(--text,#eef3ff);" +
        "font-size:11.5px;line-height:1.4;box-shadow:0 6px 18px rgba(0,0,0,.4)}" +

      /* table twin */
      "#otdBody .ot-tables{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;" +
        "margin:12px 0 4px}" +
      "#otdBody .ot-tbl{width:100%;border-collapse:collapse;font-size:11.5px;font-variant-numeric:tabular-nums}" +
      "#otdBody .ot-tbl th,#otdBody .ot-tbl td{text-align:right;padding:3px 6px;white-space:nowrap}" +
      "#otdBody .ot-tbl th{text-align:left;font-weight:600}" +
      "#otdBody .ot-tbl thead tr{color:var(--muted,#93a5cf);border-bottom:1px solid var(--line,#22345a)}" +
      "#otdBody .ot-tbl thead td{text-align:right;font-size:10px;letter-spacing:.05em;text-transform:uppercase}" +
      "#otdBody .ot-tbl tbody tr:nth-child(even){background:var(--row-bg,#0d1830)}" +
      "#otdBody .ot-tbl .ot-worse{color:var(--late-ink,#ff6b81)}" +
      "#otdBody .ot-tbl .ot-better{color:var(--live-ink,#39d98a)}" +
      "#otdBody .ot-tbl .ot-same{color:var(--muted,#93a5cf)}" +

      /* the rest */
      "#otdBody .ot-none{padding:14px 0;font-size:12.5px;color:var(--muted,#93a5cf);line-height:1.55}" +
      "#otdBody .ot-explain{margin:16px 0 0;font-size:11.5px;line-height:1.6;color:var(--muted,#93a5cf)}" +
      "#otdBody .ot-explain b{color:var(--text,#eef3ff)}" +
      "#otdBody .ot-ghost{padding:7px 13px;border-radius:8px;cursor:pointer;background:transparent;" +
        "border:1px solid var(--line,#22345a);color:var(--muted,#93a5cf);font:600 11.5px/1 inherit}" +
      "#otdBody .ot-ghost:hover{border-color:var(--accent,#4ea1ff);color:var(--text,#eef3ff)}" +
      "#otdBody .ot-ghost.danger:hover{border-color:var(--late-ink,#ff6b81);color:var(--late-ink,#ff6b81)}" +
      "#otdBody .ot-foot{margin-top:16px;padding-top:14px;border-top:1px solid var(--line,#22345a)}" +
      /* One curve and three durations for the whole feature, so nothing reads
         as borrowed from somewhere else. The curve is a decelerate: quick to
         leave, slow to settle, which is what makes a moving bar feel weighted
         rather than mechanical. */
      "#otdOverlay,#ontimeCard{--ot-ease:cubic-bezier(.22,.61,.36,1);" +
        "--ot-quick:.16s;--ot-mid:.28s;--ot-slow:.52s}" +
      "@media (prefers-reduced-motion:no-preference){" +
        "#otdBox{animation:otdIn var(--ot-mid) var(--ot-ease)}" +
        "@keyframes otdIn{from{opacity:0;transform:translateY(8px) scale(.995)}}" +
        /* The bar is the only thing that travels; everything else fades or
           tints. --ot-slow reads as a change rather than a flicker, and is over
           well before the next minute's repaint starts another one. */
        "#otdBody .ot-bar{transition:height var(--ot-slow) var(--ot-ease)," +
          "background-color var(--ot-mid) var(--ot-ease),filter var(--ot-quick) var(--ot-ease)}" +
        "#otdBody .ot-base{transition:bottom var(--ot-slow) var(--ot-ease)}" +
        "#otdBody .ot-plot{transition:height var(--ot-slow) var(--ot-ease)}" +
        "#otdBody .ot-col .ot-val{transition:opacity var(--ot-mid) var(--ot-ease)}" +
        "#otdBody .ot-chip,#otdBody .ot-more-chip{transition:border-color var(--ot-quick) var(--ot-ease)," +
          "background-color var(--ot-quick) var(--ot-ease),color var(--ot-quick) var(--ot-ease)}" +
        "#otdBody .ot-tile{transition:border-color var(--ot-mid) var(--ot-ease)}" +
        "#otdBody .ot-ghost,#otdBody #otdClose{transition:border-color var(--ot-quick) var(--ot-ease)," +
          "color var(--ot-quick) var(--ot-ease)}" +
        "#ontimeCard .ot-row{transition:border-color var(--ot-quick) var(--ot-ease)}" +
        "#ontimeCard h2 #otMoreBtn{transition:border-color var(--ot-quick) var(--ot-ease)," +
          "color var(--ot-quick) var(--ot-ease)}" +
        /* A tile whose number moved lifts once. Transform and opacity only, so
           it composites and never touches layout. */
        "#otdBody .ot-tile.ot-bump .ot-tv{animation:otBump .42s var(--ot-ease)}" +
        "@keyframes otBump{0%{opacity:.45;transform:translateY(3px)}100%{opacity:1;transform:none}}" +
      "}";
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

    /* Philadelphia has no live departures at all — every one of its feeds is a
       bundled timetable — so it can never produce a wait row. What it does have
       is SEPTA publishing its own lateness, which is a better measurement than
       anything on this card. Those rows come from a different store and read
       the other way round (higher is better), so they are built separately and
       appended rather than merged into `rows`. */
    var lrows = lateKeys().filter(function (st) { return seenLate[st.id]; });

    var withBase = rows.filter(function (r) { return r.baseAvg != null; }).length;
    var anyWeeks = rows.some(function (r) { return r.baseSpan === "weeks"; }) ||
                   lateKeys().some(function (r) { return r.baseSpan === "weeks"; });
    count.textContent = (withBase || lrows.length)
      ? (withBase + lrows.length) + " tracked" : "";

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
    if (!rows.length && !lrows.length && !anyLive) {
      card.style.display = "none";
      return;
    }
    card.style.display = "";

    if (!rows.length && !lrows.length) {
      stat.textContent = "";
      list.innerHTML = '<div class="empty" style="text-align:left">Watching how long you wait at these stops. ' +
        "A typical wait needs a day or so of the board being on.</div>";
      return;
    }
    stat.textContent = !rows.length ? (anyWeeks ? "on time today vs your last 2 weeks"
                                                 : "on time, from the operator's own figures")
      : anyWeeks ? "today vs your last 2 weeks" : "how long you have been waiting today";

    var listHTML = rows.slice(0, 8).map(function (r) {
      var m = r.meta;
      var todayTxt = r.todayAvg != null ? r.todayAvg.toFixed(1).replace(/\.0$/, "") + " min" : "—";
      var firstDay = r.baseSpan !== "weeks";
      var baseTxt = firstDay
        ? group(r.todayN) + (r.todayN === 1 ? " reading today" : " readings today")
        : "usually " + r.baseAvg.toFixed(1).replace(/\.0$/, "");
      var delta = (!firstDay && r.todayAvg != null && r.baseAvg != null) ? r.todayAvg - r.baseAvg : null;
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
    }).join("") + lrows.slice(0, rows.length ? 4 : 8).map(lateRow).join("");

    /* Most minutes nothing on this card moves — the same eight rows with the
       same numbers. Writing them anyway destroys and rebuilds every row, which
       drops any hover, any focus, and shows as a flicker on a screen somebody is
       looking at.

       Compared against a string we kept, NOT against list.innerHTML: the browser
       re-serialises what it parsed — colours become rgb(), attribute order and
       quoting change, the sparkline's SVG comes back normalised — so a generated
       string never equals the DOM's version of itself and the guard would never
       once have fired. */
    if (list._otHTML !== listHTML) {
      list.innerHTML = listHTML;
      list._otHTML = listHTML;
    }
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
  /* A day-old board has one bar. Drawn at full height that is a single 2px stub
     adrift in a 132px box, which reads as a chart that failed rather than one
     that has barely started — and the emptiness becomes the loudest thing on
     screen. Under four populated columns the plot collapses to a strip and says
     how much it has, which is the same information without the alarm. */
  var MIN_SHAPE = 4;
  var SHORT_H   = 66;

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
  function group(n) { return String(n).replace(/\B(?=(\d{3})+$)/g, ","); }

  /* Everything the dialog needs about one stop, computed once per render rather
     than per chart. Deliberately not folded into statsFor(), which runs for every
     row of the card on every repaint and has no use for any of this. */
  function deepStats(key) {
    var days = hist[key] || {}, hrs = hours[key] || {}, day = today();

    var series = [], maxSeen = 0, maxDay = "", totalN = 0;
    var wdN = 0, wdSum = 0, weN = 0, weSum = 0, bN = 0, bSum = 0;
    var band = [0, 0, 0, 0, 0], bandN = 0;
    Object.keys(days).sort().forEach(function (d) {
      var r = days[d], avg = r[0] ? r[1] / r[0] : 0;
      series.push({ x: d, label: dayLabel(d), avg: avg, n: r[0], max: r[2], cur: d === day });
      totalN += r[0];
      if (r[3]) for (var b = 0; b < 5; b++) { band[b] += r[3][b] || 0; bandN += r[3][b] || 0; }
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

    /* Two different "how often", because they answer two different questions and
       conflating them is how this sort of card starts lying.

       ranLong  — days this stop was slower than ITS OWN usual. Relative, so it
                  means the same thing on a 3-minute subway and a 30-minute bus.
       longShare— share of readings where you would have stood there more than
                  ten minutes. Absolute, so it is comparable between stops and
                  is the one that matches what a person means by "a bad wait".

       Neither is an on-time percentage, and neither is presented as one. */
    var ranLong = null, ranLongOf = 0;
    if (bN >= MIN_SAMPLES && bSum) {
      var ref = bSum / bN;
      ranLong = 0;
      series.forEach(function (p) { ranLongOf++; if (p.avg >= ref + 1) ranLong++; });
    }
    var longShare = bandN ? (band[LONG_BAND] + band[LONG_BAND + 1]) / bandN : null;

    var worstHour = null;
    hourly.forEach(function (p) { if (p.avg != null && (!worstHour || p.avg > worstHour.avg)) worstHour = p; });

    var tRec = days[day];
    return {
      key: key,
      band: band, bandN: bandN,
      ranLong: ranLong, ranLongOf: ranLongOf, longShare: longShare,
      worstHour: worstHour,
      series: series,
      hourly: hourly,
      hourBase: hN ? hSum / hN : null,
      todayAvg: tRec && tRec[0] ? tRec[1] / tRec[0] : null,
      todayN: tRec ? tRec[0] : 0,
      enough: totalN >= MIN_SAMPLES,
      /* A usual normally excludes today, or a bad morning would be measured
         against itself. On the first day there IS no other day, and refusing to
         answer left the whole right-hand side of the panel saying "learning…"
         over thousands of real readings — which reads as broken, not as new.
         So it falls back to every day it has, today included, and says so.
         The comparison is degenerate for exactly one day (today against itself,
         which correctly reads "about your usual") and becomes a true baseline
         the moment a second day exists. */
      base: bN >= MIN_SAMPLES ? bSum / bN
          : (totalN >= MIN_SAMPLES ? (bSum + (tRec ? tRec[1] : 0)) / (bN + (tRec ? tRec[0] : 0)) : null),
      baseSpan: bN >= MIN_SAMPLES ? "weeks" : (totalN >= MIN_SAMPLES ? "today" : null),
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
  /* NOT `state`: the boards declare `let state = {...}` at top level and
     boardState() finds it by bare identifier. A same-named function in this
     closure would shadow it, and every card row would silently vanish. */
  function barState(v, base, tol, invert) {
    if (v == null || base == null) return "same";
    var d = (v - base) * (invert ? -1 : 1);
    var t = tol || 1;
    return d >= t ? "worse" : d <= -t ? "better" : "same";
  }
  function deltaWords(v, base, what) {
    if (v == null) return "no reading";
    if (base == null) return mins(v);
    var d = v - base;
    if (Math.abs(d) < 1) return mins(v) + " — about the same as " + what;
    return mins(v) + " — " + Math.abs(d).toFixed(0) + " min " + (d > 0 ? "longer" : "shorter") + " than " + what;
  }

  function sparseNote(n, unit) {
    return '<p class="ot-sparse">Only ' + n + " " + unit + (n === 1 ? "" : "s") +
      " recorded so far — the shape fills in as the board keeps running.</p>";
  }

  /* ---- one model, two consumers ------------------------------------------
     Every figure's maths lives in chartModel(). chart() turns a model into HTML
     for a first render; chartApply() writes the same model into a plot that is
     already on screen.

     The split exists because innerHTML is a cut, not a transition. A repaint
     that replaces the body destroys the elements a CSS transition needs, takes
     the tooltip and the keyboard focus with it, and no easing can smooth a
     thing that was deleted and rebuilt. Measured, the repaint itself costs 5ms
     and the animation holds 60fps — what read as jank was never the frame
     budget, it was the DOM being thrown away once a minute. */
  var chartSpecs = [], tileSpecs = [], liveSpecs = {};

  /* Registers a run of text that changes on a tick, so the patcher can find
     it again without re-rendering the paragraph around it. */
  function live(key, text) { liveSpecs[key] = String(text); return esc(text); }

  /* djb2. The chip strip is markup, not a model, and it is the one part of the
     dialog the patcher does not rewrite — so the signature has to notice any
     change in it, not merely a change of length. Two different strips of equal
     length would otherwise leave a stale picker on screen. */
  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return h.toString(36);
  }
  function liveApply(body) {
    var els = body.querySelectorAll("[data-live]");
    for (var i = 0; i < els.length; i++) {
      var k = els[i].getAttribute("data-live");
      if (k in liveSpecs && els[i].textContent !== liveSpecs[k]) els[i].textContent = liveSpecs[k];
    }
  }

  function chartModel(o) {
    var pts = o.pts;
    if (!pts.length) return null;

    var vals = [];
    pts.forEach(function (p) { if (p.avg != null) vals.push(p.avg); });
    if (o.base != null) vals.push(o.base);
    if (!vals.length) return null;

    // 1.28x headroom so the tallest bar's own label has somewhere to sit.
    var top = o.top != null ? o.top : (Math.max.apply(null, vals) * 1.28 || 1);
    var worst = -1, worstV = o.invert ? Infinity : -Infinity;
    pts.forEach(function (p, i) {
      if (p.avg == null) return;
      if (o.invert ? p.avg < worstV : p.avg > worstV) { worstV = p.avg; worst = i; }
    });

    var nData = 0;
    pts.forEach(function (q) { if (q.avg != null) nData++; });
    var sparse = nData > 0 && nData < MIN_SHAPE;

    var nth = o.everyNth || 1, wide = o.narrowNth || 0, last = pts.length - 1;

    var cols = pts.map(function (p, i) {
      var d = last - i;
      return {
        x: String(p.x),
        bs: p.avg == null ? "none" : (o.tone || barState(p.avg, o.base, o.tol, o.invert)),
        pct: p.avg == null ? 0 : Math.max(2, (p.avg / top) * 100),
        // Selective labels only: the current column and the notable extreme. A
        // number on every bar is unreadable and goes unread.
        labText: ((p.cur || i === worst) && p.avg != null)
          ? (o.fmt ? o.fmt(p) : p.avg.toFixed(1).replace(/\.0$/, "")) : "",
        tip: o.tipFn ? o.tipFn(p) : (p.label + " · " + (p.avg == null
          ? (p.n ? "only " + p.n + " readings — not enough yet" : "nothing recorded that day")
          : deltaWords(p.avg, o.base, o.baseWord) + " · " + p.n + " readings")),
        cur: !!p.cur,
        axisText: (nth === 1 || d % nth === 0) ? p.label : "",
        axisKeep: !!(wide && d % wide === 0),
      };
    });

    return {
      cols: cols, wide: wide, sparse: sparse, nData: nData,
      plotH: sparse ? SHORT_H : PLOT_H,
      basePct: o.base == null ? null : Math.min(96, (o.base / top) * 100),
      baseTxt: o.base == null ? ""
        : (o.baseWord || "") + " " + (o.baseFmt ? o.baseFmt(o.base) : o.base.toFixed(1).replace(/\.0$/, "")),
      note: (sparse && o.unitName) ? sparseNote(nData, o.unitName) : "",
    };
  }

  /* The shape a repaint must not change without a full re-render: which columns
     exist, in what order, and whether the plot is in its short form. Anything
     else — heights, colours, labels, the reference line — is patched in place. */
  function chartSig(o) {
    var m = chartModel(o);
    if (!m) return (o.figId || "f") + ":empty";
    return (o.figId || "f") + ":" + (m.sparse ? "s" : "f") + ":" +
      m.cols.map(function (c) { return c.x; }).join(",");
  }

  function chart(o) {
    chartSpecs.push(o);
    var m = chartModel(o);
    if (!m) return '<div class="ot-none">Nothing recorded yet.</div>';

    var cols = m.cols.map(function (c) {
      return '<div class="ot-col" data-s="' + c.bs + (c.cur ? '" data-cur="1' : '"') +
        ' data-x="' + esc(c.x) + '" tabindex="0" data-tip="' + esc(c.tip) + '">' +
        (c.labText ? '<span class="ot-val">' + esc(c.labText) + "</span>" : "") +
        '<span class="ot-bar" style="height:' + c.pct.toFixed(1) + '%"></span></div>';
    }).join("");

    var baseEl = m.basePct == null ? "" :
      '<div class="ot-base" style="bottom:' + m.basePct.toFixed(1) + '%"><i></i><b>' +
      esc(m.baseTxt) + "</b></div>";

    var axis = m.cols.map(function (c) {
      return "<span" + (c.cur ? ' class="cur"' : "") + (c.axisKeep ? " data-n2" : "") + ">" +
        esc(c.axisText) + "</span>";
    }).join("");

    return '<div class="ot-plot" data-fig="' + esc(o.figId || "f") + '" style="height:' + m.plotH + 'px">' +
      baseEl + '<div class="ot-cols">' + cols + "</div></div>" +
      '<div class="ot-axis' + (m.wide ? " thin" : "") + '">' + axis + "</div>" + m.note;
  }

  /* Writes a fresh model into a plot already on screen. Every assignment is
     guarded by a comparison: setting a property to the value it already holds
     still invalidates style, and with sixty columns that is sixty needless
     invalidations a minute. */
  function chartApply(body, o) {
    var m = chartModel(o);
    if (!m) return;
    var plot = null, plots = body.querySelectorAll(".ot-plot[data-fig]");
    for (var i = 0; i < plots.length; i++) {
      if (plots[i].getAttribute("data-fig") === String(o.figId || "f")) { plot = plots[i]; break; }
    }
    if (!plot) return;

    var hPx = m.plotH + "px";
    if (plot.style.height !== hPx) plot.style.height = hPx;

    var base = plot.querySelector(".ot-base");
    if (base && m.basePct != null) {
      var bPct = m.basePct.toFixed(1) + "%";
      if (base.style.bottom !== bPct) base.style.bottom = bPct;
      var bl = base.querySelector("b");
      if (bl && bl.textContent !== m.baseTxt) bl.textContent = m.baseTxt;
    }

    var byX = {}, els = plot.querySelectorAll(".ot-col[data-x]");
    for (var j = 0; j < els.length; j++) byX[els[j].getAttribute("data-x")] = els[j];

    var axisEls = [];
    var axisBox = plot.parentNode ? plot.parentNode.querySelector(".ot-axis") : null;
    if (axisBox) axisEls = axisBox.children;

    m.cols.forEach(function (c, k) {
      var el = byX[c.x];
      if (el) {
        if (el.getAttribute("data-s") !== c.bs) el.setAttribute("data-s", c.bs);
        if (c.cur) { if (!el.hasAttribute("data-cur")) el.setAttribute("data-cur", "1"); }
        else if (el.hasAttribute("data-cur")) el.removeAttribute("data-cur");
        if (el.getAttribute("data-tip") !== c.tip) el.setAttribute("data-tip", c.tip);

        var bar = el.querySelector(".ot-bar");
        if (bar) {
          var hh = c.pct.toFixed(1) + "%";
          if (bar.style.height !== hh) bar.style.height = hh;
        }
        var val = el.querySelector(".ot-val");
        if (c.labText) {
          if (!val) {
            val = document.createElement("span");
            val.className = "ot-val";
            el.insertBefore(val, el.firstChild);
          }
          if (val.textContent !== c.labText) val.textContent = c.labText;
        } else if (val && val.parentNode) {
          val.parentNode.removeChild(val);
        }
      }
      var ax = axisEls[k];
      if (ax) {
        if (ax.textContent !== c.axisText) ax.textContent = c.axisText;
        if (c.cur !== (ax.className === "cur")) ax.className = c.cur ? "cur" : "";
      }
    });
  }

  /* The table twin. A tooltip is an enhancement; it must never be the only way
     to read a value — and on a touchscreen kiosk there is no hover at all. */
  function table(pts, base, head, baseWord) {
    var rows = pts.map(function (p) {
      var d = (p.avg != null && base != null) ? p.avg - base : null;
      var dTxt = d == null ? "—" : (Math.abs(d) < 1 ? "same" : (d > 0 ? "+" : "−") + Math.abs(d).toFixed(1).replace(/\.0$/, ""));
      return "<tr><th>" + esc(p.label) + "</th><td>" + esc(p.avg == null ? "—" : mins(p.avg)) +
        '</td><td class="ot-' + (d == null ? "same" : d >= 1 ? "worse" : d <= -1 ? "better" : "same") + '">' +
        esc(dTxt) + "</td><td>" + (p.n || 0) + "</td></tr>";
    }).join("");
    return '<table class="ot-tbl"><thead><tr><th>' + esc(head) +
      "</th><td>Typical wait</td><td>vs " + esc(baseWord || "usual") +
      "</td><td>Readings</td></tr></thead><tbody>" +
      rows + "</tbody></table>";
  }

  function bandTable(st) {
    var rows = BANDS.map(function (lbl, i) {
      return "<tr><th>" + esc(lbl) + " min</th><td>" + Math.round((st.band[i] / st.bandN) * 100) +
        "%</td><td>" + group(st.band[i]) + "</td></tr>";
    }).join("");
    return '<table class="ot-tbl"><thead><tr><th>Wait</th><td>Share</td>' +
      "<td>Readings</td></tr></thead><tbody>" + rows + "</tbody></table>";
  }

  /* ---- the dialog --------------------------------------------------------- */
  var dlg = null, selKey = null, showNums = false;
  // Whether the chip strip also lists records made on another board.
  var showAll = false;

  function tile(label, value, sub, cls) {
    tileSpecs.push({ key: label, value: String(value), sub: String(sub || ""), cls: cls || "" });
    return '<div class="ot-tile" data-tile="' + esc(label) + '"><div class="ot-tl">' + esc(label) + "</div>" +
      '<div class="ot-tv">' + esc(value) + "</div>" +
      '<div class="ot-ts ' + (cls || "") + '">' + esc(sub || "") + "</div></div>";
  }

  /* Tiles change once a minute by a fraction of a percent. Swapping the text
     under the reader is the smallest cut in the dialog and still a cut, so a
     changed value gets a brief lift — enough to say "this moved" and short
     enough not to become a tic on a screen that is on all day. */
  function tilesApply(body) {
    tileSpecs.forEach(function (t) {
      var el = null, all = body.querySelectorAll(".ot-tile[data-tile]");
      for (var i = 0; i < all.length; i++) {
        if (all[i].getAttribute("data-tile") === t.key) { el = all[i]; break; }
      }
      if (!el) return;
      var v = el.querySelector(".ot-tv"), sb = el.querySelector(".ot-ts");
      if (v && v.textContent !== t.value) {
        v.textContent = t.value;
        if (!reducedMotion()) {
          el.classList.remove("ot-bump");
          void el.offsetWidth;            // restart the animation rather than ignore it
          el.classList.add("ot-bump");
        }
      }
      if (sb) {
        if (sb.textContent !== t.sub) sb.textContent = t.sub;
        var want = "ot-ts " + t.cls;
        if (sb.className !== want.trim()) sb.className = want.trim();
      }
    });
  }

  /* Which stop to open on. The same answer the card gives: the one that is most
     out of character today. A stop with no baseline yet can only show a bar or
     two, so it is never the landing page while something else has a fortnight
     behind it. */
  function defaultKey(keys) {
    var best = keys[0].key, bestScore = -Infinity;
    keys.forEach(function (k) {
      var st = deepStats(k.key);
      var score;
      if (st.base != null && st.todayAvg != null) score = 3000 + (st.todayAvg - st.base);
      else if (st.base != null) score = 2000 + st.series.length;
      else score = Math.min(999, st.totalN / 100);
      if (score > bestScore) { bestScore = score; best = k.key; }
    });
    return best;
  }

  function renderDetail() {
    if (!dlg) return;
    var body = dlg.querySelector("#otdBody");
    if (!body) return;
    var keep = body.scrollTop;
    var prevBars = snapshotBars(body);
    chartSpecs = []; tileSpecs = []; liveSpecs = {};

    var keys = trackedKeys();
    var lates = lateKeys();
    if (!keys.length && !lates.length) {
      var emptyHtml = '<div class="ot-none">Nothing recorded yet. The board notes how long the next ' +
        "vehicle is away each time it refreshes; leave it running and a day or so from now this will " +
        "have something to show.</div>" + explainerHTML();
      if (body.getAttribute("data-sig") !== "empty") {
        body.innerHTML = emptyHtml;
        body.setAttribute("data-sig", "empty");
      }
      return;
    }
    var found = false;
    keys.forEach(function (k) { if (k.key === selKey) found = true; });
    lates.forEach(function (k) { if ("~late|" + k.id === selKey) found = true; });
    /* Only what this board is actually showing. A Philadelphia board listing
       Red Line stops recorded in Washington is not a picker, it is a filing
       cabinet — but the records are still yours, so nothing is deleted: the
       rest sit behind one chip at the end of the strip. */
    var isMine = function (k) { return k.live || seenStop[k.key]; };
    var mineKeys = keys.filter(isMine), otherKeys = keys.filter(function (k) { return !isMine(k); });
    var mineLates = lates.filter(function (k) { return seenLate[k.id]; });
    var otherLates = lates.filter(function (k) { return !seenLate[k.id]; });
    var otherN = otherKeys.length + otherLates.length;
    // Nothing of this board's own yet — show the rest rather than an empty strip.
    var expand = showAll || (!mineKeys.length && !mineLates.length);

    /* Land on something this board actually shows. History is per-browser and
       the whole site is one origin, so a Philadelphia board's `keys` can be full
       of stops recorded in Washington — opening on one of those is opening on
       the wrong city. Preference order: a stop the board is watching now, then a
       line it is measuring, and only then the leftovers. */
    var liveKeys = keys.filter(function (k) { return k.live; });
    if (!found) {
      selKey = liveKeys.length ? defaultKey(liveKeys)
             : mineLates.length ? "~late|" + mineLates[0].id
             : mineKeys.length ? defaultKey(mineKeys)
             : lates.length ? "~late|" + lates[0].id
             : defaultKey(keys);
    }

    var waitChip = function (k) {
      return '<button type="button" class="ot-chip' + (k.key === selKey ? " on" : "") +
        '" data-otkey="' + esc(k.key) + '">' +
        '<i style="background:' + esc(k.color || "var(--muted,#93a5cf)") + '"></i>' +
        (k.route ? "<b>" + esc(k.route) + "</b>" : "") + esc(k.stop) +
        (k.live ? "" : '<em title="not on the board right now">·</em>') + "</button>";
    };
    var lateChip = function (k) {
      var id = "~late|" + k.id;
      return '<button type="button" class="ot-chip late' + (id === selKey ? " on" : "") +
        '" data-otkey="' + esc(id) + '" title="On-time record, from the operator\u2019s own figures">' +
        '<i style="background:' + esc(k.color || "var(--muted,#93a5cf)") + '"></i>' +
        "<b>" + esc(k.badge) + "</b>" + esc(k.label) + "</button>";
    };

    var chips = mineKeys.filter(function (k) { return k.live; }).map(waitChip).join("") +
      mineLates.map(lateChip).join("") +
      mineKeys.filter(function (k) { return !k.live; }).map(waitChip).join("") +
      (expand ? otherKeys.map(waitChip).join("") + otherLates.map(lateChip).join("") : "") +
      (otherN
        ? '<button type="button" class="ot-more-chip" title="Records kept in this browser from ' +
          'another board — the history is shared, the boards are not">' +
          (expand ? "Hide the " + otherN + " from other boards"
                  : "+ " + otherN + " from other boards") + "</button>"
        : "");

    setSub(selKey.indexOf("~late|") === 0);

    if (selKey.indexOf("~late|") === 0) {
      var lst = lateStats(selKey.slice(6));
      commit(body, '<div class="ot-chips">' + chips + "</div>" + lateBody(lst),
             "late:" + selKey, chips, keep, prevBars);
      return;
    }

    var meta = keys[0];
    keys.forEach(function (k) { if (k.key === selKey) meta = k; });
    var st = deepStats(selKey);

    var dNow = (st.todayAvg != null && st.base != null) ? st.todayAvg - st.base : null;
    var dCls = dNow == null ? "" : dNow >= 1 ? "ot-worse" : dNow <= -1 ? "ot-better" : "";
    var pct = function (f) { return Math.round(f * 100) + "%"; };
    var tiles =
      tile("Today", st.todayAvg == null ? "—" : mins(st.todayAvg),
        dNow == null ? (st.todayN ? st.todayN + " readings" : "nothing yet today")
          : Math.abs(dNow) < 1 ? "about your usual"
          : (dNow > 0 ? "+" : "−") + Math.abs(dNow).toFixed(1).replace(/\.0$/, "") + " min vs usual", dCls) +
      tile("Usual", st.base == null ? "—" : mins(st.base),
        st.base == null ? "a few minutes of readings"
          : st.baseSpan === "today" ? "from today so far"
          : "over " + st.series.length + " days") +
      /* "How often is it bad" in the stop's own terms. */
      tile("Ran long", st.ranLong == null ? "—" : st.ranLong + " of " + st.ranLongOf + " days",
        st.ranLong == null ? "needs a second day to compare" : "slower than its own usual",
        st.ranLong != null && st.ranLong * 2 > st.ranLongOf ? "ot-worse" : "") +
      /* ...and in terms anyone can compare between stops. */
      tile("Waits over 10 min", st.longShare == null ? "—" : pct(st.longShare),
        st.longShare == null ? "counting from today on"
          : "of " + group(st.bandN) + " readings",
        st.longShare != null && st.longShare >= 0.25 ? "ot-worse" : "") +
      tile("Longest wait seen", st.maxSeen ? st.maxSeen + " min" : "—",
        st.maxDay ? "on " + dayLabel(st.maxDay) : "") +
      tile("Worst hour", st.worstHour ? st.worstHour.label : "—",
        st.worstHour ? mins(st.worstHour.avg) + " typical" : "not enough of the day yet");

    var split = (st.weekday != null && st.weekend != null)
      ? '<div class="ot-split">Weekdays <b>' + esc(mins(st.weekday)) + "</b> · Weekends <b>" +
        esc(mins(st.weekend)) + "</b></div>" : "";

    /* The distribution. No reference line and no better/worse colouring: this
       is one series showing a shape, and a status hue here would be claiming a
       verdict the chart is not making. */
    var distBody = "";
    if (st.bandN) {
      var dist = BANDS.map(function (lbl, i) {
        return { x: String(i), label: lbl, avg: st.band[i] / st.bandN, n: st.band[i], cur: false };
      });
      distBody = chart({
        pts: dist, figId: "wait-dist",
        fmt: function (p) { return Math.round(p.avg * 100) + "%"; },
        tipFn: function (p) {
          return p.label + " min · " + Math.round(p.avg * 100) + "% of readings (" + group(p.n) + ")";
        },
      });
    }

    var hourBody = st.hourly.length
      ? chart({ pts: st.hourly, base: st.hourBase, baseWord: "all hours", figId: "wait-hour",
                unitName: "hour", everyNth: st.hourly.length > 10 ? 3 : 1 })
      : '<div class="ot-none">Not enough of the day observed yet — an hour needs about a minute of ' +
        "the board being on before it counts.</div>";

    var html =
      '<div class="ot-chips">' + chips + "</div>" +
      '<div class="ot-tiles">' + tiles + "</div>" +
      '<div class="ot-since" data-live="since">' + live("since", group(st.totalN) + " readings" +
        (st.since ? " since " + dayLabel(st.since) : "") + ", taken every time the board refreshed.") + "</div>" +

      '<section class="ot-fig"><div class="ot-fig-h"><h4>Typical wait, by day</h4>' +
      '<span>bars above the line were slower than your usual</span></div>' +
      chart({ pts: st.series, base: st.base, baseWord: "usual",
              everyNth: st.series.length > 8 ? 2 : 1,
              narrowNth: st.series.length > 8 ? 4 : 0, figId: "wait-day", unitName: "day" }) + split + "</section>" +

      '<section class="ot-fig"><div class="ot-fig-h"><h4>Typical wait, by hour of day</h4>' +
      "<span>when this stop is worth leaving early for</span></div>" + hourBody + "</section>" +

      (distBody
        ? '<section class="ot-fig"><div class="ot-fig-h"><h4>How long the waits actually are</h4>' +
          "<span>share of every reading, by minutes waited</span></div>" + distBody + "</section>"
        : "") +

      '<button type="button" id="otdNums" class="ot-ghost">' +
      (showNums ? "Hide the numbers" : "Show the numbers") + "</button>" +
      (showNums
        ? '<div class="ot-tables">' + table(st.series, st.base, "Day", "usual") +
          (st.hourly.length ? table(st.hourly, st.hourBase, "Hour", "all hours") : "") +
          (st.bandN ? bandTable(st) : "") + "</div>"
        : "") +
      explainerHTML() +
      '<div class="ot-foot"><button type="button" id="otdWipe" class="ot-ghost danger">' +
      "Forget this history</button></div>";

    commit(body, html, "wait:" + selKey, chips, keep, prevBars);
  }

  /* The whole point of the split. If the shape on screen still matches the shape
     the model wants — same view, same columns, same toggles — nothing is
     replaced: the values are written into the elements already there, so the
     transitions run, the tooltip stays up and the keyboard focus survives. Only
     a real structural change (a different line, a new day, the tables opening)
     rebuilds, and only then does the scroll position need restoring. */
  function commit(body, html, kind, chips, keep, prevBars) {
    var sig = [kind, showNums ? "n" : "-", hash(chips),
               chartSpecs.map(chartSig).join(";"),
               tileSpecs.map(function (t) { return t.key; }).join(",")].join("|");
    if (body.getAttribute("data-sig") === sig) {
      chartSpecs.forEach(function (o) { chartApply(body, o); });
      tilesApply(body);
      liveApply(body);
      return;
    }
    var had = !!body.getAttribute("data-sig");
    body.innerHTML = html;
    body.setAttribute("data-sig", sig);
    afterRender(body, keep, prevBars, had);
  }

  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches); }
    catch (_) { return false; }
  }

  /* The dialog re-renders itself every minute, and a re-render that replaces
     innerHTML destroys the very elements a CSS transition needs in order to
     animate: every bar would jump to its new height, or worse grow from zero as
     if the history had only just been recorded. So the heights are read off the
     outgoing DOM, written back onto the incoming one, and only then released to
     their real values — the transition has something to move FROM, and a bar
     that did not change does not move at all.

     Two nested frames rather than one: the browser has to lay out the restored
     height before the new one is set, or it coalesces both into a single style
     computation and there is nothing left to animate between. */
  function snapshotBars(body) {
    var map = {}, cols = body.querySelectorAll(".ot-col[data-x]");
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i], bar = c.querySelector(".ot-bar");
      var fig = c.closest && c.closest("[data-fig]");
      if (!bar || !fig) continue;
      map[fig.getAttribute("data-fig") + "|" + c.getAttribute("data-x")] = bar.style.height;
    }
    return map;
  }
  function replayBars(body, prev) {
    if (!prev || reducedMotion() || !root.requestAnimationFrame) return;
    var cols = body.querySelectorAll(".ot-col[data-x]"), moves = [];
    for (var i = 0; i < cols.length; i++) {
      var c = cols[i], bar = c.querySelector(".ot-bar");
      var fig = c.closest && c.closest("[data-fig]");
      if (!bar || !fig) continue;
      var k = fig.getAttribute("data-fig") + "|" + c.getAttribute("data-x");
      var from = prev[k], to = bar.style.height;
      if (from && from !== to) { bar.style.height = from; moves.push([bar, to]); }
    }
    if (!moves.length) return;
    root.requestAnimationFrame(function () {
      root.requestAnimationFrame(function () {
        for (var j = 0; j < moves.length; j++) moves[j][0].style.height = moves[j][1];
      });
    });
  }

  /* The two views measure different things, so the standfirst cannot describe
     both. */
  function setSub(isLate) {
    var el2 = dlg && dlg.querySelector("#otdSub");
    if (!el2) return;
    el2.textContent = isLate
      ? "On-time running, from the operator’s own published figures."
      : "How long you have actually waited, at the stops this board watches.";
  }

  /* Chip first, scroll position second: scrollIntoView can nudge the body
     vertically as well as the strip horizontally, and restoring the caller's
     scrollTop afterwards undoes exactly that half of it. */
  function afterRender(body, keep, prevBars, glide) {
    var on = body.querySelector(".ot-chip.on");
    if (on && on.scrollIntoView) {
      var how = { block: "nearest", inline: "nearest" };
      // Smooth only when the strip was already on screen. Gliding into position
      // on the very first paint is an animation of nothing.
      if (glide && !reducedMotion()) how.behavior = "smooth";
      try { on.scrollIntoView(how); } catch (_) {}
    }
    body.scrollTop = keep;
    replayBars(body, prevBars);
  }

  /* The lateness view. Same charts, opposite polarity: on a wait chart taller is
     worse, and on the on-time chart taller is better — so barState() is fed the
     negated values rather than being told about percentages, and the reference
     line still means "your usual". */
  function lateBody(st) {
    var pctI = function (f) { return Math.round(f * 100) + "%"; };
    var dOn = (st.todayOn != null && st.baseOn != null) ? st.todayOn - st.baseOn : null;
    var tiles =
      tile("On time today", st.todayOn == null ? "—" : pctI(st.todayOn),
        st.todayOn == null
          ? (st.todayN ? group(st.todayN) + " of " + MIN_SAMPLES + " readings needed" : "nothing yet today")
          : dOn == null ? group(st.todayN) + " readings"
          : Math.abs(dOn) < 0.03 ? "about its usual"
          : (dOn > 0 ? "+" : "−") + Math.round(Math.abs(dOn) * 100) + " points vs usual",
        dOn == null ? "" : dOn >= 0.03 ? "ot-better" : dOn <= -0.03 ? "ot-worse" : "") +
      tile(st.baseSpan === "today" ? "On time so far" : "On time, 2 weeks",
        st.baseOn == null ? "—" : pctI(st.baseOn),
        st.baseOn == null ? "a few minutes of readings" : "under " + LATE_ON_TIME + " min late") +
      tile("Typical delay", st.baseLate == null ? "—" : mins(st.baseLate),
        st.baseLate == null ? "a few minutes of readings"
          : st.baseSpan === "today" ? "median so far today" : "median across the line") +
      tile("Worst delay seen", st.worst ? st.worst + " min" : "—",
        st.worstDay ? "on " + dayLabel(st.worstDay) : "", st.worst >= 20 ? "ot-worse" : "") +
      tile("Worst hour", st.worstHour ? st.worstHour.label : "—",
        st.worstHour ? Math.round(st.worstHour.avg * 100) + "% on time then"
                     : "not enough of the day yet",
        st.worstHour && st.worstHour.avg < 0.5 ? "ot-worse" : "") +
      tile("Readings", group(st.totalN), st.since ? "since " + dayLabel(st.since) : "");

    /* On-time percent runs the other way from a wait: taller is better, and
       three points either side of your usual is noise rather than a trend. */
    var TOL = 0.03;
    var onPts = st.onSeries;
    var onChart = chart({
      pts: onPts, base: st.baseOn, baseWord: "usual", tol: TOL, invert: true, figId: "late-day",
      unitName: "day",
      everyNth: onPts.length > 8 ? 2 : 1, narrowNth: onPts.length > 8 ? 4 : 0,
      fmt: function (p) { return Math.round(p.avg * 100) + "%"; },
      baseFmt: function (v) { return Math.round(v * 100) + "%"; },
      tipFn: function (p) {
        var d = st.baseOn == null ? null : p.avg - st.baseOn;
        var w = d == null ? "" : (Math.abs(d) < TOL ? " — about its usual"
          : " — " + Math.round(Math.abs(d) * 100) + " points " + (d > 0 ? "better" : "worse") +
            " than usual");
        return p.label + " · " + Math.round(p.avg * 100) + "% on time" + w +
          " · " + group(p.n) + (p.live === false ? " readings, archived" : " readings");
      },
    });

    /* "On time, delayed or cancelled, all together."

       Three single-series charts rather than one stacked bar, and the reason is
       measured rather than stylistic: green / amber / red is the obvious
       encoding and it is the one that fails. Checked against both of this
       board's surfaces, the day theme's own status tokens land at ΔE 13.3 in
       NORMAL vision and 3.8 under deuteranopia — three fills nobody can
       separate. Every green+warm trio tried failed the same way; it is the
       red-green collapse, not a bad choice of step. Faceting removes the
       problem instead of dressing it: nothing here has to be told from anything
       else by hue, because each panel is one series with its name written above
       it. They share one 0–100% scale so the heights mean the same thing, and
       each panel states its own fortnight figure in text — which is what stays
       readable when a 2% cancellation rate draws as two pixels. */
    var statusBody = "";
    if (st.statusN) {
      var names = ["On time", "Delayed", "Cancelled"];
      var tones = ["better", "warn", "worse"];
      var panels = [0, 1, 2];
      if (!st.cancelKnown) panels = [0, 1];
      var share = function (i) { return st.status[i] / st.statusN; };

      var together = panels.map(function (i) {
        return names[i] + " " + Math.round(share(i) * 100) + "%";
      }).join(" · ");

      statusBody =
        '<section class="ot-fig"><div class="ot-fig-h"><h4>On time, delayed or cancelled</h4>' +
        "<span>every departure this board saw, over the fortnight</span></div>" +
        '<div class="ot-together" data-live="together">' + live("together", together) + "</div>" +
        '<div class="ot-multiples">' +
        panels.map(function (i) {
          return '<div class="ot-panel"><div class="ot-panel-h"><span class="ot-dot ot-t-' + tones[i] +
            '"></span>' + esc(names[i]) + '<b data-live="panel-' + i + '">' +
            live("panel-" + i, Math.round(share(i) * 100) + "%") + "</b></div>" +
            chart({
              pts: st.statusDays[i], tone: tones[i], top: 1.28, figId: "status-" + i,
              everyNth: st.statusDays[i].length > 6 ? 3 : 1,
              fmt: function (p) { return Math.round(p.avg * 100) + "%"; },
              tipFn: function (p) {
                return p.label + " · " + Math.round(p.avg * 100) + "% " + names[i].toLowerCase() +
                  " of " + group(p.n) + " departures";
              },
            }) + "</div>";
        }).join("") + "</div>" +
        (st.statusDays[0].length < MIN_SHAPE
          ? sparseNote(st.statusDays[0].length, "day") : "") +
        (st.cancelKnown ? "" :
          '<p class="ot-note">This feed does not publish cancellations, so there is no ' +
          "cancelled share to show — an empty bar would be a claim it never made.</p>") +
        "</section>";
    }

    var hourBody = st.hourly.length
      ? chart({
          pts: st.hourly, base: st.hourBaseOn, baseWord: "all hours", tol: TOL, invert: true,
          figId: "late-hour", unitName: "hour", everyNth: st.hourly.length > 10 ? 3 : 1,
          fmt: function (p) { return Math.round(p.avg * 100) + "%"; },
          baseFmt: function (v) { return Math.round(v * 100) + "%"; },
          tipFn: function (p) {
            if (p.avg == null) {
              /* The archive keeps daily totals, not an hour-by-hour breakdown, so
                 an unwatched hour genuinely has nothing behind it — but it is
                 the record that is empty, not the board that failed. */
              return p.label + " · " + (p.n ? "only " + p.n + " readings — not enough yet"
                                            : "nothing recorded that hour");
            }
            return p.label + " · " + Math.round(p.avg * 100) + "% on time" +
              (p.late != null ? ", typically " + mins(p.late) + " down" : "") +
              " · " + group(p.n) + " readings";
          },
        })
      : '<div class="ot-none">Not enough of the day observed yet — an hour needs about a minute of ' +
        "the board being on before it counts.</div>";

    var distBody = "";
    if (st.bandN) {
      var dist = LATE_BANDS.map(function (lbl, i) {
        return { x: String(i), label: lbl, avg: st.band[i] / st.bandN, n: st.band[i], cur: false };
      });
      distBody = '<section class="ot-fig"><div class="ot-fig-h"><h4>How late it actually runs</h4>' +
        "<span>share of readings, by minutes behind schedule</span></div>" +
        chart({
          pts: dist, figId: "late-dist",
          fmt: function (p) { return Math.round(p.avg * 100) + "%"; },
          tipFn: function (p) {
            return p.label + " min late · " + Math.round(p.avg * 100) +
              "% of readings (" + group(p.n) + ")";
          },
        }) + "</section>";
    }

    return '<div class="ot-tiles">' + tiles + "</div>" +
      '<div class="ot-since" data-live="since">' + live("since", st.label + " — " + group(st.totalN) +
        " readings" + (st.since ? " since " + dayLabel(st.since) : "") + ".") + "</div>" +
      '<section class="ot-fig"><div class="ot-fig-h"><h4>On time, by day</h4>' +
      "<span>bars below the line were worse than its usual</span></div>" + onChart + "</section>" +
      '<section class="ot-fig"><div class="ot-fig-h"><h4>On time, by hour of day</h4>' +
      "<span>when in the day this line slips</span></div>" + hourBody + "</section>" +
      statusBody +
      distBody +
      '<button type="button" id="otdNums" class="ot-ghost">' +
      (showNums ? "Hide the numbers" : "Show the numbers") + "</button>" +
      (showNums
        ? '<div class="ot-tables">' + lateTable(st) +
          (st.hourly.length ? lateHourTable(st) : "") +
          (st.bandN ? lateBandTable(st) : "") + "</div>"
        : "") +
      lateExplainerHTML(st) +
      '<div class="ot-foot"><button type="button" id="otdWipe" class="ot-ghost danger">' +
      "Forget this history</button></div>";
  }

  function lateTable(st) {
    var rows = st.onSeries.map(function (p, i) {
      var late = st.series[i];
      return "<tr><th>" + esc(p.label) + "</th><td>" + Math.round(p.avg * 100) + "%</td><td>" +
        esc(mins(late ? late.avg : null)) + "</td><td>" + group(p.n) + "</td></tr>";
    }).join("");
    return '<table class="ot-tbl"><thead><tr><th>Day</th><td>On time</td>' +
      "<td>Typical delay</td><td>Readings</td></tr></thead><tbody>" + rows + "</tbody></table>";
  }
  function lateHourTable(st) {
    var rows = st.hourly.map(function (p) {
      return "<tr><th>" + esc(p.label) + "</th><td>" +
        (p.avg == null ? "—" : Math.round(p.avg * 100) + "%") + "</td><td>" +
        esc(mins(p.late)) + "</td><td>" + group(p.n || 0) + "</td></tr>";
    }).join("");
    return '<table class="ot-tbl"><thead><tr><th>Hour</th><td>On time</td>' +
      "<td>Typical delay</td><td>Readings</td></tr></thead><tbody>" + rows + "</tbody></table>";
  }
  function lateBandTable(st) {
    var rows = LATE_BANDS.map(function (lbl, i) {
      return "<tr><th>" + esc(lbl) + " min</th><td>" + Math.round((st.band[i] / st.bandN) * 100) +
        "%</td><td>" + group(st.band[i]) + "</td></tr>";
    }).join("");
    return '<table class="ot-tbl"><thead><tr><th>Late by</th><td>Share</td>' +
      "<td>Readings</td></tr></thead><tbody>" + rows + "</tbody></table>";
  }

  /* Deliberately names no agency: the same view backs SEPTA in Philadelphia and
     Transitous across the European boards, and an explainer that says "SEPTA"
     on a Zurich screen is worse than none. */
  function lateExplainerHTML(st) {
    return '<p class="ot-explain">This one <b>is</b> an on-time figure, and it is the operator\u2019s ' +
      "own: the feed behind this line publishes how many minutes behind schedule each vehicle is " +
      "running, so nothing here is inferred from a countdown. On time means <b>under " +
      LATE_ON_TIME + " minutes late</b> — a common commuter-rail standard, applied to every mode so " +
      "the figures stay comparable.<br><br>" +
      "The daily figure is the <b>median</b> across the line\u2019s vehicles at each refresh, not one " +
      "reading per vehicle: a train that stays twenty minutes late for an hour is one line running " +
      "late, not dozens of separate failures. The on time / delayed / cancelled split is counted the " +
      "other way, once per <b>departure</b>, because a cancellation is a service that did not run and " +
      "no median can express it." +
      (st && !st.cancelKnown
        ? " This feed publishes no cancellations, so only two of the three are shown."
        : "") +
      (st && st.archivedDays
        ? "<br><br>" + st.archivedDays + " of these days " +
          (st.archivedDays === 1 ? "was" : "were") + " recorded while this screen was off, by the " +
          "project's own watcher polling the same public feeds every twenty minutes. A day this " +
          "board saw for itself always wins; the archive only fills the gaps, and the two are never " +
          "averaged into one day."
        : "") +
      "<br><br>Nothing is uploaded from here. The archive is built from public feeds by a scheduled " +
      "job and simply read back — what this screen recorded stays in this browser.</p>";
  }


  function explainerHTML() {
    return '<p class="ot-explain">This measures <b>how long you wait</b>, not whether a vehicle ' +
      "was late. Most of these feeds publish a countdown and no timetable to be late against — " +
      "Metrorail publishes none at all — so a percentage on-time would be invented rather than " +
      "measured. A typical wait tracks headway, which is the thing that actually goes wrong.<br><br>" +
      "So <b>how often it is bad</b> is answered twice, because one number cannot do it. " +
      '<b>Ran long</b> counts days this stop was slower than its own usual, which means the same ' +
      "thing on a three-minute subway and a half-hourly bus. <b>Waits over 10 min</b> counts " +
      "individual readings against a fixed bar, which is what a person means by a bad wait and is " +
      "comparable between stops. Neither is an on-time figure and neither is offered as one.<br><br>" +
      "Every figure here came from this screen watching its own board; nothing was uploaded, and " +
      "clearing it below is the end of it.</p>";
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
      '<p id="otdSub">How long you have actually waited, at the stops this board watches.</p>' +
      '<button type="button" id="otdClose" aria-label="Close">×</button></header>' +
      '<div id="otdBody"></div><div id="otdTip" hidden></div></div>';

    dlg.addEventListener("click", function (e) { if (e.target === dlg) closeDetail(); });
    document.addEventListener("keydown", onDlgKey);
    document.body.appendChild(dlg);
    dlg.querySelector("#otdClose").onclick = closeDetail;

    var body = dlg.querySelector("#otdBody");
    body.addEventListener("click", function (e) {
      var t = e.target;
      if (t.closest && t.closest(".ot-more-chip")) { showAll = !showAll; renderDetail(); return; }
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
      var mark = el.querySelector(".ot-bar") || el;
      var b = dlg.querySelector("#otdBox").getBoundingClientRect(), r = mark.getBoundingClientRect();
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
    hist = {}; hours = {}; lateHist = {}; lateHours = {};
    write(LS.hist, hist); write(LS.hours, hours);
    write(LS.late, lateHist); write(LS.lateHours, lateHours);
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

  /* Reads the other way round from a wait row: a HIGHER number is better here,
     so the green/red sense is inverted and the delta is in percentage points,
     not minutes. Keeping that inversion in one function rather than
     parameterising the wait row was deliberate — the two are different
     measurements and merging their rendering is how one starts being described
     in the other's words. */
  function lateRow(st) {
    var firstDay = st.baseSpan !== "weeks";
    // No delta on the first day: today against itself is always "same", which is
    // a column of noise rather than a reading.
    var d = (!firstDay && st.todayOn != null && st.baseOn != null) ? st.todayOn - st.baseOn : null;
    var cls = d == null ? "ot-same" : d >= 0.03 ? "ot-better" : d <= -0.03 ? "ot-worse" : "ot-same";
    var dTxt = d == null ? "" : Math.abs(d) < 0.03 ? "same"
      : (d > 0 ? "+" : "−") + Math.round(Math.abs(d) * 100) + " pts";
    var todayTxt = st.todayOn == null ? "—" : Math.round(st.todayOn * 100) + "%";
    var sub = firstDay ? group(st.todayN) + (st.todayN === 1 ? " reading today" : " readings today")
      : "usually " + Math.round(st.baseOn * 100) + "% on time";
    return '<div class="row ot-row" tabindex="0" role="button" data-otkey="~late|' + esc(st.id) +
      '" title="See this line\u2019s on-time record">' +
      '<div class="badge" style="background:' + esc(st.color || "#556") + ';color:#fff">' +
      esc(st.badge) + "</div>" +
      '<div><div class="dest">' + esc(st.label) + "</div>" +
      '<div class="sub">' + esc(sub) + "</div></div>" +
      "<div>" + sparkSVG(st.onSeries.slice(-7), st.color || "#7cc0ff") + "</div>" +
      '<div class="times"><div class="live">' + esc(todayTxt) + "</div>" +
      '<div class="sched ot-delta ' + cls + '">' + esc(dTxt) + "</div></div></div>";
  }

  function onData() { try { sample(); recordLate(amtrakRows()); paint(); if (dlg) renderDetail(); } catch (_) {} }

  function boot() {
    try {
      ensureCard();
      paint();
      loadArchive();
      setInterval(onData, 60000);
    } catch (_) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  root.TBOnTime = {
    onData: onData,
    stats: statsFor,
    deep: deepStats,
    late: recordLate,
    lateStats: lateStats,
    open: openDetail,
    close: closeDetail,
    reset: function () {
      hist = {}; hours = {}; lateHist = {}; lateHours = {};
      write(LS.hist, hist); write(LS.hours, hours);
      write(LS.late, lateHist); write(LS.lateHours, lateHours);
      paint();
    },
  };
})(typeof window !== "undefined" ? window : this);
