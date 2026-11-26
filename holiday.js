/* ============================================================================
   holiday.js — says, ahead of time, when a holiday changes the timetable.

   WHAT A RIDER NEEDS TO KNOW
     The departures on a board already follow the holiday timetable: every
     bundle carries the agency's calendar_dates exceptions and the boards apply
     them. What nothing says is that today is different. A rider glancing at a
     Thanksgiving board sees fewer trains and cannot tell "Sunday schedule" from
     "the feed is broken", and nobody learns on Wednesday night that tomorrow's
     6:40 is not running.

   WHERE THE ANSWER COMES FROM
     The agencies' own data, not a hand-kept list. A list of "SEPTA runs a
     Saturday schedule on Thanksgiving" would be a claim this project makes on
     the agency's behalf and would quietly go wrong the year they change it. The
     bundle already knows: for each holiday in the next few days this counts the
     trips that run that day and compares them with an ordinary day of the same
     weekday, and with an ordinary Saturday and Sunday.

       same service as a normal Sunday  ->  "Sunday schedule"
       fewer trips                      ->  "reduced service (about 70% of a normal Thursday)"
       more trips                       ->  "extra service"   (getaway trains, New Year's Eve)
       last trip much later / earlier   ->  "late trips until 2:10 AM" / "ends early"
       nothing at all                   ->  "no service"
       past the published calendar      ->  "holiday times not published yet"

     Only NAMED holidays are checked. Any day a bundle differs from the week
     before (track work, a new pick) would otherwise be announced as a holiday.

   HOW IT SEES THE BUNDLES
     schedule-health.js already watches every *-schedule.json a board loads, by
     wrapping fetch; its onBundle hook hands each parsed bundle on, so the 12 MB
     subway file is parsed once more by nobody. An older cached schedule-health
     without the hook falls back to a wrap of our own.

   GETTING RID OF IT (the house rule)
     Registered in the board's CARD_DEFS, so Settings > Show on board has a
     "Holiday schedule notices" checkbox that turns it off for good. Its own ×
     dismisses only the holidays on screen now; the next holiday shows again.
   ============================================================================ */
(function () {
  "use strict";
  if (window.TBHoliday) return;

  var ID = "tbHoliday", DISMISS_KEY = "tb.holidayDismissed", LOOKAHEAD = 3;

  /* SEASONAL. The owner wants holiday notices for the end-of-year travel season
     only, gone in January. 1 Nov – 1 Jan (station's own date), and back by
     itself next November. Change these two month-day stamps to move it; the
     flight delay notes (flight-notes.js) are year-round and not affected. */
  var SEASON_FROM = "1101", SEASON_TO = "0101";
  function inSeason(ymd) { var md = ymd.slice(4); return md >= SEASON_FROM || md <= SEASON_TO; }

  /* The station's clock, not this device's: a Rome board can be open in Maryland. */
  var PAGE_TZ = {
    dc: "America/New_York", philadelphia: "America/New_York", newjersey: "America/New_York",
    nyc: "America/New_York", boston: "America/New_York", chicago: "America/Chicago",
    losangeles: "America/Los_Angeles", sanfrancisco: "America/Los_Angeles",
    amsterdam: "Europe/Amsterdam", zurich: "Europe/Zurich", cologne: "Europe/Berlin",
    stuttgart: "Europe/Berlin", rome: "Europe/Rome"
  };
  var page = (location.pathname.split("/").pop() || "").replace(/\.html$/, "");

  /* Names a rider recognises. A bundle not listed here still works, under its file name. */
  var LABELS = {
    "marc": "MARC", "rideon": "Ride On", "septa-rail": "SEPTA Regional Rail",
    "septa-subway": "SEPTA Metro", "septa-bus": "SEPTA buses", "patco": "PATCO",
    "njt-phl": "NJ Transit rail", "njt-nyc": "NJ Transit rail", "njt-state-rail": "NJ Transit rail",
    "njt-state-bus": "NJ Transit buses", "mta-subway": "Subway", "mta-bus": "MTA buses",
    "lirr": "LIRR", "mnr": "Metro-North", "path": "PATH", "mbta-subway": "MBTA subway",
    "mbta-cr": "MBTA Commuter Rail", "mbta-bus": "MBTA buses", "la-rail": "Metro Rail",
    "la-metrolink": "Metrolink", "sf-bart": "BART", "sf-caltrain": "Caltrain",
    "sf-muni": "Muni", "sf-cablecar": "Cable cars", "rome-metro": "Metro",
    "ams-metro": "Metro", "ams-tram": "Trams", "ams-rail": "NS trains",
    "ams-intl": "International trains", "ams-ferry": "Ferries"
  };

  /* ---------- dates ---------- */
  function ymdOf(d) { return d.toISOString().slice(0, 10).replace(/-/g, ""); }
  function dateOf(ymd) { return new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8))); }
  function addDays(ymd, n) { var d = dateOf(ymd); d.setUTCDate(d.getUTCDate() + n); return ymdOf(d); }
  function dowOf(ymd) { return (dateOf(ymd).getUTCDay() + 6) % 7; }         // Mon=0 … Sun=6, as the bundles store it
  function todayIn(tz) {
    var p = {};
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return p.year + p.month + p.day;
    } catch (_) { return ymdOf(new Date(Date.now() - new Date().getTimezoneOffset() * 60000)); }
  }
  function nthDow(y, m, dow, n) {           // nth (1-based) weekday of a month; dow in JS terms (0=Sun); n=-1 for last
    if (n > 0) { var d = new Date(Date.UTC(y, m - 1, 1)); d.setUTCDate(1 + ((dow - d.getUTCDay() + 7) % 7) + 7 * (n - 1)); return ymdOf(d); }
    var e = new Date(Date.UTC(y, m, 0)); e.setUTCDate(e.getUTCDate() - ((e.getUTCDay() - dow + 7) % 7)); return ymdOf(e);
  }
  function easter(y) {                      // Anonymous Gregorian algorithm
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
        f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
        i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
        m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31),
        da = ((h + l - 7 * m + 114) % 31) + 1;
    return ymdOf(new Date(Date.UTC(y, mo - 1, da)));
  }
  function fixed(y, m, d) { return "" + y + String(m).padStart(2, "0") + String(d).padStart(2, "0"); }

  /* Public holidays plus the travel days around them that agencies schedule for
     (Thanksgiving Eve getaway trains, the Sunday return). */
  function holidays(tz, y) {
    var h = {};
    function add(ymd, name) { h[ymd] = name; }
    if (/^America\//.test(tz)) {
      var tg = nthDow(y, 11, 4, 4);
      add(fixed(y, 1, 1), "New Year's Day");
      add(nthDow(y, 1, 1, 3), "Martin Luther King Jr. Day");
      add(nthDow(y, 2, 1, 3), "Presidents' Day");
      add(addDays(easter(y), -2), "Good Friday");
      add(nthDow(y, 5, 1, -1), "Memorial Day");
      add(fixed(y, 6, 19), "Juneteenth");
      add(fixed(y, 7, 4), "Independence Day");
      add(nthDow(y, 9, 1, 1), "Labor Day");
      add(nthDow(y, 10, 1, 2), "Columbus / Indigenous Peoples' Day");
      add(fixed(y, 11, 11), "Veterans Day");
      add(addDays(tg, -1), "Thanksgiving Eve");
      add(tg, "Thanksgiving");
      add(addDays(tg, 1), "Day after Thanksgiving");
      add(addDays(tg, 3), "Sunday after Thanksgiving");
      add(fixed(y, 12, 24), "Christmas Eve");
      add(fixed(y, 12, 25), "Christmas Day");
      add(fixed(y, 12, 26), "Day after Christmas");
      add(fixed(y, 12, 31), "New Year's Eve");
      return h;
    }
    var e = easter(y);
    add(fixed(y, 1, 1), "New Year's Day");
    add(addDays(e, -2), "Good Friday");
    add(addDays(e, 1), "Easter Monday");
    add(addDays(e, 39), "Ascension Day");
    add(addDays(e, 50), "Whit Monday");
    add(fixed(y, 12, 24), "Christmas Eve");
    add(fixed(y, 12, 25), "Christmas Day");
    add(fixed(y, 12, 26), tz === "Europe/Rome" ? "St Stephen's Day" : "Boxing Day");
    add(fixed(y, 12, 31), "New Year's Eve");
    if (tz === "Europe/Rome") {
      add(fixed(y, 1, 6), "Epiphany"); add(fixed(y, 4, 25), "Liberation Day"); add(fixed(y, 5, 1), "Labour Day");
      add(fixed(y, 6, 2), "Republic Day"); add(fixed(y, 6, 29), "Saints Peter and Paul");
      add(fixed(y, 8, 15), "Ferragosto"); add(fixed(y, 11, 1), "All Saints' Day"); add(fixed(y, 12, 8), "Immaculate Conception");
    } else if (tz === "Europe/Berlin") {
      add(fixed(y, 5, 1), "Labour Day"); add(addDays(e, 60), "Corpus Christi");
      add(fixed(y, 10, 3), "German Unity Day"); add(fixed(y, 11, 1), "All Saints' Day");
      if (page === "stuttgart") add(fixed(y, 1, 6), "Epiphany");
    } else if (tz === "Europe/Zurich") {
      add(fixed(y, 1, 2), "Berchtold's Day"); add(fixed(y, 8, 1), "Swiss National Day");
    } else if (tz === "Europe/Amsterdam") {
      var kd = fixed(y, 4, 27); if (dowOf(kd) === 6) kd = fixed(y, 4, 26);
      add(kd, "King's Day");
    }
    return h;
  }
  function holidaysAround(tz, ymd) {
    var y = +ymd.slice(0, 4), out = {};
    [y - 1, y, y + 1].forEach(function (yy) { var h = holidays(tz, yy); for (var k in h) out[k] = h[k]; });
    return out;
  }

  /* ---------- one bundle ---------- */
  /* Trips and latest first departure per service id, counted once per bundle. */
  function indexBundle(b) {
    var by = {}, v2 = b.v === 2 && b.pats, offs = b.offs || [];
    (b.trips || []).forEach(function (t) {
      var start = null;
      if (v2) start = (t.t || 0) + (((offs[t.o] || [])[0]) || 0);
      else if (t.st && t.st[0]) start = t.st[0][1];
      var e = by[t.s] || (by[t.s] = { n: 0, last: -1 });
      e.n++;
      if (start != null && start > e.last) e.last = start;
    });
    var end = "";
    Object.keys(b.svc || {}).forEach(function (k) { var v = b.svc[k]; if (v && v.end > end) end = String(v.end); });
    Object.keys(b.exc || {}).forEach(function (d) { var v = b.exc[d]; if (v && v.add && v.add.length && d > end) end = d; });
    /* Only the calendars are kept: the trips are folded into `by`, and holding
       on to the whole bundle would double what a board keeps in memory. */
    return { b: { svc: b.svc || {}, exc: b.exc || {} }, by: by, end: end, exc: Object.keys(b.exc || {}), cache: {} };
  }
  /* The boards' activeServices() rule, minus its fallback: borrowing another
     weekday's trains is right for drawing departures and wrong for saying what
     a holiday looks like. */
  function day(ix, ymd) {
    if (ix.cache[ymd]) return ix.cache[ymd];
    var b = ix.b, act = {}, id, dow = dowOf(ymd);
    for (id in b.svc || {}) { var v = b.svc[id]; if (ymd >= v.start && ymd <= v.end && v.dow[dow]) act[id] = 1; }
    var ex = b.exc && b.exc[ymd];
    if (ex) { (ex.rem || []).forEach(function (x) { delete act[x]; }); (ex.add || []).forEach(function (x) { act[x] = 1; }); }
    var all = Object.keys(act), n = 0, last = -1, keys = all.filter(function (k) { return ix.by[k]; }).sort();
    keys.forEach(function (k) { n += ix.by[k].n; if (ix.by[k].last > last) last = ix.by[k].last; });
    return (ix.cache[ymd] = { ymd: ymd, n: n, last: last, set: keys.join("|"), services: all.length });
  }
  /* An ordinary day to compare with: same weekday a week or two either side,
     skipping holidays, the median of what is found so one odd week does not set the bar. */
  function ordinary(ix, ymd, hol, dow) {
    var found = [], seen = {}, anchor = dow == null ? ymd : addDays(ymd, dow - dowOf(ymd));   // that weekday, same week
    for (var w = anchor === ymd ? 1 : 0; w <= 5 && found.length < 3; w++) {
      [-1, 1].forEach(function (sgn) {
        var base = addDays(anchor, sgn * 7 * w);
        if (seen[base] || hol[base] || base > ix.end || found.length >= 3) return;
        seen[base] = 1;
        var d = day(ix, base); if (d.n > 0) found.push(d);
      });
    }
    if (!found.length) return null;
    found.sort(function (a, b) { return a.n - b.n; });
    return found[Math.floor(found.length / 2)];
  }
  function near(a, b, tol) { return b > 0 && Math.abs(a - b) / b <= tol; }
  var DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  function clock(min) {
    min = ((min % 1440) + 1440) % 1440;
    var h = Math.floor(min / 60), m = String(min % 60).padStart(2, "0");
    return (h % 12 || 12) + ":" + m + (h < 12 ? " AM" : " PM");
  }

  /* -> {kind, text}  kind: normal | changed | none | unknown */
  function classify(ix, ymd, hol) {
    if (!ix.end || ymd > ix.end) return { kind: "unknown", text: "holiday times not out yet" };
    var d = day(ix, ymd), dow = dowOf(ymd), base = ordinary(ix, ymd, hol);
    if (!base) return { kind: "unknown", text: "no ordinary " + DAYS[dow] + " to compare with" };
    /* "No service" only when the agency's calendar runs nothing. Services that
       run but whose trips are missing from the bundle are a gap in our copy of
       the timetable (SEPTA's holiday buses), not a day off. */
    if (d.n === 0) return d.services ? { kind: "unknown", text: "holiday timetable incomplete in our data" } : { kind: "none", text: "no service" };
    var sat = dow < 5 ? ordinary(ix, ymd, hol, 5) : null, sun = dow !== 6 ? ordinary(ix, ymd, hol, 6) : null;
    var text = "", tail = "";
    if (d.set === base.set || near(d.n, base.n, 0.03)) text = "";
    else if (sun && (d.set === sun.set || near(d.n, sun.n, 0.05)) && !near(base.n, sun.n, 0.12)) text = "Sunday schedule";
    else if (sat && (d.set === sat.set || near(d.n, sat.n, 0.05)) && !near(base.n, sat.n, 0.12)) text = "Saturday schedule";
    else if (d.n >= base.n * 1.08) text = "extra service (+" + (d.n - base.n) + " trips on a normal " + DAYS[dow] + ")";
    else if (d.n <= base.n * 0.92) text = "reduced service (about " + Math.round(100 * d.n / base.n) + "% of a normal " + DAYS[dow] + ")";
    /* The end of the night matters as much as the count: New Year's Eve service
       runs late, Christmas Eve service stops early. Compared with the schedule
       the day actually resembles, so a Sunday schedule's earlier finish is not
       reported twice. */
    var ref = text === "Sunday schedule" ? sun : text === "Saturday schedule" ? sat : base;
    if (ref && d.last >= 0 && ref.last >= 0) {
      if (d.last - ref.last >= 40) tail = "late trips until about " + clock(d.last);
      else if (ref.last - d.last >= 60) tail = "ends early, last trips about " + clock(d.last);
    }
    if (!text && !tail) {
      /* "Normal" is a claim, so it needs evidence that the feed models holidays
         at all. MARC's and PATH's bundles carry no calendar exceptions anywhere
         near this date; for them a normal-looking day means nothing. */
      var t = dateOf(ymd).getTime(), modelled = ix.exc.some(function (x) { return Math.abs(dateOf(x).getTime() - t) <= 60 * 864e5; });
      return modelled ? { kind: "normal", text: "no change listed" } : { kind: "unknown", text: "no holiday info in its feed" };
    }
    return { kind: "changed", text: [text, tail].filter(Boolean).join(", ") };
  }

  /* ---------- the board ---------- */
  /* Styled here so a board needs one script tag, not a tag and a stylesheet.
     Theme variables come from theme.css, so day/night/high-contrast just work;
     the plain background is the fallback for browsers without color-mix. */
  function injectStyle() {
    if (document.getElementById(ID + "Css")) return;
    var st = document.createElement("style"); st.id = ID + "Css";
    st.textContent =
      "#" + ID + "{position:fixed;z-index:1100;left:12px;bottom:12px;max-width:min(920px,calc(100vw - 24px));box-sizing:border-box;" +
      "display:flex;align-items:center;gap:6px 12px;padding:6px 8px 6px 10px;box-shadow:0 6px 24px rgba(0,0,0,.35);" +
      "border-radius:10px;font-size:13px;line-height:1.4;color:var(--text,#eef3ff);" +
      "background:var(--panel,#111d36);background:color-mix(in srgb,var(--panel,#111d36) 86%,#ffb454);" +
      "border:1px solid var(--line,#22345a);border-color:color-mix(in srgb,var(--line,#22345a) 55%,#ffb454)}" +
      "#" + ID + "[hidden],#" + ID + ".user-hidden{display:none!important}" +
      ".tbh-tag{flex:none;font:700 10px/1 ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;" +
      "padding:5px 7px;border-radius:6px;background:#ffb454;color:#2a1600}" +
      ".tbh-days{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}" +
      ".tbh-day{min-width:0}.tbh-name{font-weight:700}.tbh-when{color:var(--muted,#93a5cf);margin-right:6px}" +
      ".tbh-items b{font-weight:650}.tbh-sep{color:var(--muted,#93a5cf);margin:0 7px}" +
      ".tbh-changed b{color:#ffb454}.tbh-none b{color:var(--late,#ff5a5a)}" +
      ".tbh-unknown,.tbh-normal{color:var(--muted,#93a5cf)}.tbh-unknown b,.tbh-normal b{color:var(--text,#eef3ff);font-weight:600}" +
      "html[data-theme=light] .tbh-changed b,html[data-theme=day] .tbh-changed b{color:#9a4d00}" +
      ".tbh-link{flex:none;color:var(--accent,#4ea1ff);text-decoration:none;font-weight:600;white-space:nowrap}" +
      ".tbh-link:hover{text-decoration:underline}" +
      ".tbh-x{flex:none;background:none;border:0;color:var(--muted,#93a5cf);font-size:18px;line-height:1;padding:2px 6px;cursor:pointer;border-radius:6px}" +
      ".tbh-x:hover{color:var(--text,#eef3ff);background:rgba(127,127,127,.18)}" +
      "@media (max-width:720px){#" + ID + "{flex-wrap:wrap;font-size:12px}.tbh-days{flex-basis:100%;order:3}}";
    (document.head || document.documentElement).appendChild(st);
  }
  var bundles = {};            // label -> [index…] (NJT rail arrives as several files for one railway)
  function labelFor(name) {
    var k = String(name).replace(/-schedule\.json.*$/, "");
    return LABELS[k] || k;
  }
  function tz() { return PAGE_TZ[page] || (Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York"); }

  function analyze() {
    var zone = tz(), today = todayIn(zone), hol = holidaysAround(zone, today), out = [];
    for (var i = 0; i <= LOOKAHEAD; i++) {
      var ymd = addDays(today, i);
      if (!hol[ymd] || !inSeason(ymd)) continue;
      var rows = Object.keys(bundles).map(function (label) {
        /* Several bundles under one name: report the one that changed most. */
        var rank = { changed: 3, none: 3, unknown: 1, normal: 2 }, best = null;
        bundles[label].forEach(function (ix) {
          var r = classify(ix, ymd, hol);
          if (!best || rank[r.kind] > rank[best.kind]) best = r;
        });
        return { label: label, kind: best.kind, text: best.text };
      });
      /* A day only earns the strip if a timetable actually changes; a holiday
         where every system is unchanged or unknown is just noise on a kiosk. */
      if (rows.some(function (r) { return r.kind === "changed" || r.kind === "none"; }))
        out.push({ ymd: ymd, name: hol[ymd], offset: i, rows: rows });
    }
    return out;
  }

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function whenText(d) {
    var dt = dateOf(d.ymd), wd = DAYS[dowOf(d.ymd)].slice(0, 3),
        md = dt.toLocaleDateString(/^Europe\//.test(tz()) ? "en-GB" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return (d.offset === 0 ? "today" : d.offset === 1 ? "tomorrow" : wd) + " · " + wd + " " + md;
  }

  function dismissed(key) { try { return localStorage.getItem(DISMISS_KEY) === key; } catch (_) { return false; } }

  function ensureEl() {
    var el = document.getElementById(ID);
    if (el) return el;
    if (!document.body) return null;
    injectStyle();
    el = document.createElement("div");
    el.id = ID; el.setAttribute("role", "status"); el.hidden = true;
    /* Floated over the foot of the map, not added to the page's flow: each board
       design (glass, atlas, paper, signal …) places #app's children on its own
       grid, and one more child lands wherever the grid has a gap. The map is the
       one region every design has where a strip covers nothing you read. */
    document.body.appendChild(el);
    try { if (typeof loadHiddenCards === "function" && loadHiddenCards().has(ID)) el.classList.add("user-hidden"); } catch (_) {}
    el.addEventListener("click", function (e) {
      if (!e.target.closest(".tbh-x")) return;
      try { localStorage.setItem(DISMISS_KEY, el.getAttribute("data-key") || ""); } catch (_) {}
      el.hidden = true; relayout();
    });
    return el;
  }
  function place() {
    var el = document.getElementById(ID); if (!el || el.hidden) return;
    var m = document.getElementById("map"), r = m && m.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    if (r && r.width >= 320 && r.height >= 160 && r.bottom > 0 && r.top < vh && getComputedStyle(m).visibility !== "hidden") {
      el.style.left = Math.max(12, r.left + 12) + "px";
      el.style.bottom = Math.max(12, vh - Math.min(r.bottom, vh) + 12) + "px";
      el.style.maxWidth = Math.min(920, Math.max(280, Math.min(r.right, vw) - Math.max(0, r.left) - 24)) + "px";
    } else { el.style.left = "12px"; el.style.bottom = "12px"; el.style.maxWidth = ""; }
  }
  var relayout = place;

  var lastHtml = "";
  function render() {
    var el = ensureEl(); if (!el) return;
    var days = analyze();
    var key = days.map(function (d) { return d.ymd; }).join(",");
    el.setAttribute("data-key", key);
    if (!days.length || dismissed(key)) { if (!el.hidden) { el.hidden = true; relayout(); } return; }
    var html = days.slice(0, 2).map(function (d) {
      var order = { changed: 0, none: 0, unknown: 1, normal: 2 };
      var rows = d.rows.slice().sort(function (a, b) { return order[a.kind] - order[b.kind]; });
      var changed = rows.filter(function (r) { return r.kind === "changed" || r.kind === "none"; });
      var unknown = rows.filter(function (r) { return r.kind === "unknown"; });
      var normal = rows.filter(function (r) { return r.kind === "normal"; });
      var parts = changed.map(function (r) {
        return '<span class="tbh-item tbh-' + r.kind + '"><b>' + esc(r.label) + "</b> " + esc(r.text) + "</span>";
      });
      var why = {};
      unknown.forEach(function (r) { (why[r.text] = why[r.text] || []).push(r.label); });
      Object.keys(why).forEach(function (t) {
        parts.push('<span class="tbh-item tbh-unknown"><b>' + esc(why[t].join(", ")) + "</b> " + esc(t) + "</span>");
      });
      if (normal.length) parts.push('<span class="tbh-item tbh-normal">' + (changed.length || unknown.length ? "<b>" + esc(normal.map(function (r) { return r.label; }).join(", ")) + "</b> no change listed"
        : "no changes listed in any timetable on this board") + "</span>");
      return '<div class="tbh-day"><span class="tbh-name">' + esc(d.name) + '</span> <span class="tbh-when">' + esc(whenText(d)) + "</span>" +
        '<span class="tbh-items">' + parts.join('<span class="tbh-sep" aria-hidden="true">·</span>') + "</span></div>";
    }).join("");
    html = '<span class="tbh-tag">Holiday schedules</span><div class="tbh-days">' + html + "</div>" +
      '<a class="tbh-link" href="rush.html" title="Airport delays and Amtrak lateness, nationwide">Travel rush ›</a>' +
      '<button type="button" class="tbh-x" aria-label="Dismiss holiday notice" title="Hide until the next holiday (turn off for good in Settings › Show on board)">×</button>';
    el.title = "Worked out from each agency's own published timetable; the departure times on this board already follow it. Where a system says no info, check the operator before you travel.";
    if (html !== lastHtml) { el.innerHTML = html; lastHtml = html; }
    el.hidden = false;
    place();
  }

  var pending = null;
  function onBundle(name, bundle) {
    if (!bundle || !bundle.trips || (!bundle.svc && !bundle.exc)) return;
    try {
      var label = labelFor(name), ix = indexBundle(bundle);
      ix.name = name;
      /* A board that reloads a timetable replaces it rather than counting it twice. */
      (bundles[label] = (bundles[label] || []).filter(function (x) { return x.name !== name; })).push(ix);
    } catch (_) { return; }
    /* Bundles arrive in a burst; draw once after the burst. */
    clearTimeout(pending); pending = setTimeout(function () { try { render(); } catch (_) {} }, 400);
  }

  /* ---------- wiring ---------- */
  if (window.TBScheduleHealth && typeof TBScheduleHealth.onBundle === "function") {
    TBScheduleHealth.onBundle(onBundle);
  } else {
    var realFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var p = realFetch(input, init), href = "";
      try { href = typeof input === "string" ? input : (input && input.url) || ""; } catch (_) {}
      if (!/-schedule\.json/.test(href)) return p;
      return p.then(function (res) {
        try { var name = href.split("/").pop().split("?")[0]; res.clone().json().then(function (j) { onBundle(name, j); }).catch(function () {}); } catch (_) {}
        return res;
      });
    };
  }

  /* CARD_DEFS is defined by the board's inline script, which has run by the
     time the document is "interactive" — and that is before the board's own
     DOMContentLoaded handler builds the Settings checkboxes from it. */
  function register() {
    try {
      if (typeof CARD_DEFS !== "undefined" && Array.isArray(CARD_DEFS) && !CARD_DEFS.some(function (d) { return d && d.id === ID; }))
        CARD_DEFS.push({ id: ID, label: "Holiday schedule notices" });
    } catch (_) {}
    ensureEl();
  }
  if (document.readyState === "loading") {
    document.addEventListener("readystatechange", function once() {
      if (document.readyState === "loading") return;
      document.removeEventListener("readystatechange", once); register();
    });
  } else register();
  /* Midnight moves "tomorrow" to "today"; a kiosk stays up for days. */
  setInterval(function () { try { if (Object.keys(bundles).length) render(); } catch (_) {} }, 10 * 60 * 1000);
  /* Settings, map-only mode and design switches move the map without a resize. */
  window.addEventListener("resize", place);
  setInterval(place, 3000);

  window.TBHoliday = {
    analyze: analyze, holidays: holidays, classify: classify, indexBundle: indexBundle,
    report: function () { return JSON.parse(JSON.stringify(analyze())); },
    inSeason: inSeason
  };
})();
