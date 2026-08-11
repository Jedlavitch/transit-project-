/* ============================================================================
   schedule-health.js — says so when a bundled timetable has run out.

   THE FAILURE THIS CATCHES
     Systems with no live feed are drawn from a GTFS bundle committed to this
     repo, and every bundle carries the agency's own service calendar. Agencies
     publish a short horizon — LACMTA about three weeks, SEPTA and SF about a
     month — so a bundle that is correct today is empty a few weeks from now.

     Nothing announces that. `activeServices()` simply finds no service for
     today and the card renders empty, which looks exactly like "no trains due
     right now" at 3am. That is how the LA Metro Rail board went blank without
     anyone noticing. .github/workflows/schedule-refresh.yml rebuilds bundles
     before they lapse, but it can still fail — an agency moves its feed URL or
     changes format — and when it does, the only signal is a failed Actions run
     that a customer will never see.

   WHAT THIS DOES
     Watches every *-schedule.json the page loads, reads the same coverage end
     date the audit script reads, and puts one quiet chip on screen if any of
     them has expired. It never hides data and never blocks anything; it turns a
     silently empty card into a stated reason.

   WHY IT WRAPS fetch RATHER THAN EDITING BOARDS
     Fourteen boards load these bundles through their own loaders. Wrapping
     fetch catches all of them, and every city added later, with no per-board
     wiring — the same approach licence-proxy.js takes.
   ============================================================================ */
(function () {
  "use strict";

  const seen = {};                 // filename -> {end, expired, daysLeft}
  const SOON_DAYS = 0;             // chip only once genuinely expired

  function todayStamp(d) {
    const p = n => String(n).padStart(2, "0");
    return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  /* Same rule as refresh-schedules.py's coverage_end(): a bundle's coverage is
     the latest of its calendar ranges and its dated exceptions. Feeds that ship
     calendar_dates.txt only (LIRR, Metro-North, NJT, the Amsterdam set) have no
     `svc` ranges at all and live entirely in `exc`, so both have to be read or
     those five report as permanently expired. */
  function coverageEnd(bundle) {
    const ends = [];
    const svc = bundle && bundle.svc;
    if (svc) Object.keys(svc).forEach(k => { const v = svc[k]; if (v && v.end) ends.push(String(v.end)); });
    const exc = bundle && bundle.exc;
    if (exc) Object.keys(exc).forEach(d => { const v = exc[d]; if (v && v.add) ends.push(String(d)); });
    if (!ends.length) return null;
    return ends.sort()[ends.length - 1];
  }

  function daysBetween(stamp, now) {
    const y = +stamp.slice(0, 4), m = +stamp.slice(4, 6), d = +stamp.slice(6, 8);
    if (!y || !m || !d) return null;
    return Math.round((new Date(y, m - 1, d) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  }

  function note(name, bundle) {
    try {
      const end = coverageEnd(bundle);
      if (!end) return;                       // not a schedule bundle after all
      const now = new Date();
      const left = daysBetween(end, now);
      seen[name] = { end: end, daysLeft: left, expired: end < todayStamp(now) };
      paint();
    } catch (_) { /* health reporting must never break a board */ }
  }

  function paint() {
    const dead = Object.keys(seen).filter(k => seen[k].expired);
    let chip = document.getElementById("tbSchedChip");
    if (!dead.length) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "tbSchedChip";
      chip.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:9998;max-width:44ch;" +
        "font:600 11px/1.45 ui-monospace,Menlo,monospace;letter-spacing:.03em;padding:7px 11px;" +
        "border-radius:6px;background:rgba(20,10,0,.92);color:#ffb454;border:1px solid #8a5a1f";
      (document.body || document.documentElement).appendChild(chip);
    }
    const names = dead.map(n => n.replace("-schedule.json", "")).join(", ");
    chip.textContent = `Timetable out of date: ${names}. Those departures are hidden until it is refreshed.`;
    chip.title = dead.map(n => `${n} — coverage ended ${seen[n].end}`).join("\n");
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const p = realFetch(input, init);
    let href = "";
    try { href = typeof input === "string" ? input : (input && input.url) || ""; } catch (_) {}
    if (!/-schedule\.json/.test(href)) return p;
    // Read a CLONE: consuming the caller's body would leave the board with an
    // already-read stream and no timetable at all.
    return p.then(res => {
      try {
        const name = href.split("/").pop().split("?")[0];
        res.clone().json().then(j => note(name, j)).catch(() => {});
      } catch (_) {}
      return res;
    });
  };

  window.TBScheduleHealth = {
    report: () => JSON.parse(JSON.stringify(seen)),
    expired: () => Object.keys(seen).filter(k => seen[k].expired),
    coverageEnd: coverageEnd,
  };
})();
