/* ============================================================================
   flight-notes.js — one plain sentence on a flight when something may delay it.

   "Circling near Baltimore: gusts to 40 kt at DCA have the FAA spacing arrivals."

   WHERE THE SENTENCE COMES FROM
     flight-notes-worker.js, which holds an Anthropic API key, looks up the FAA's
     status and the weather (now, and forecast for when the plane gets there) at
     the destination, and asks Claude to write the note. This file only says which
     flights are up there, where they are going, and whether they are circling.
     Nothing is sent for a flight with no known destination, and the Worker only
     calls Claude when a flight actually has a delay signal.

     No Worker configured (config.js `flightNotesUrl`, or localStorage
     `tb.flightNotesUrl` for one screen) means rule-written notes from what the
     page can see by itself: the FAA status file the deploy publishes, and the
     plane's own track. No weather — that needs the Worker.

   HONEST ABOUT WHAT IT KNOWS
     ADS-B has no schedule in it, so no note claims a flight IS late. Notes say
     what is likely and why, and the tooltip says where that came from.

   WHERE IT SHOWS
     - the Planes card on every city board: a line under the flight's row
     - Sky view (night.html): a line under the status chips
   Year-round: unlike holiday.js this has no season.

   GETTING RID OF IT (the house rule)
     City boards: Settings > Show on board > "Flight delay notes" (registered in
     the board's own CARD_DEFS). Sky view: Settings > "Flight delay notes" Off,
     or the × on the note itself.
   ============================================================================ */
(function () {
  "use strict";
  if (window.TBFlightNotes) return;

  var ID = "tbFlightNotes", OFF_KEY = "tb.flightNotesOff";
  var POLL_MS = 60000, STALE_MS = 10 * 60000, HOLD_WINDOW_MS = 8 * 60000;
  var isSky = /night\.html$/.test(location.pathname) || !!document.getElementById("flightno");

  function url() {
    var u = "";
    try { u = localStorage.getItem("tb.flightNotesUrl") || ""; } catch (_) {}
    if (!u && window.TB_CONFIG) u = window.TB_CONFIG.flightNotesUrl || "";
    return String(u).trim().replace(/\/+$/, "");
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function nm(a, b) {
    var r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 3440.065 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  /* ---------- on/off ---------- */
  function enabled() {
    if (isSky) { try { return localStorage.getItem(OFF_KEY) !== "1"; } catch (_) { return true; } }
    var s = document.getElementById(ID);
    return !(s && s.classList.contains("user-hidden"));
  }
  function setSkyEnabled(on) {
    try { on ? localStorage.removeItem(OFF_KEY) : localStorage.setItem(OFF_KEY, "1"); } catch (_) {}
    paintSkySeg(); paintSky();
  }

  /* ---------- holding, for boards that do not track it themselves ----------
     The same test Sky view uses: most of a full circle of turning within a few
     minutes, below cruise. */
  var hist = {};
  function sampleTrack(a) {
    if (!a || !a.hex || typeof a.track !== "number") return;
    var h = hist[a.hex] || (hist[a.hex] = []), now = Date.now();
    if (!h.length || now - h[h.length - 1].t > 5000) h.push({ t: now, trk: a.track });
    while (h.length && now - h[0].t > HOLD_WINDOW_MS) h.shift();
  }
  function holdingInfo(a) {
    if (typeof isHolding === "function" && isSky) {
      try { if (!isHolding(a)) return null; } catch (_) { return null; }
      return { min: null };
    }
    var alt = typeof a.alt_baro === "number" ? a.alt_baro : null;
    if (alt != null && alt > 26000) return null;
    var h = hist[a.hex];
    if (!h || h.length < 4 || h[h.length - 1].t - h[0].t < 90000) return null;
    var turn = 0;
    for (var i = 1; i < h.length; i++) { var d = h[i].trk - h[i - 1].trk; d = ((d + 540) % 360) - 180; turn += d; }
    return Math.abs(turn) >= 300 ? { min: Math.round((h[h.length - 1].t - h[0].t) / 60000) } : null;
  }

  /* ---------- the flights on screen ---------- */
  function boardFlights() {
    var list = (typeof state !== "undefined" && state && state._planes) || [];
    var out = [];
    list.slice(0, 20).forEach(function (a) {
      sampleTrack(a);
      var label = (a.flight || a.r || "").trim().slice(0, 7);
      var rt = null;
      try { rt = typeof routeFor === "function" ? routeFor(a) : null; } catch (_) {}
      if (!label || !rt || !rt.to) return;
      var hold = holdingInfo(a);
      var eta = null;
      if (rt.tlat != null && a.lat != null && a.gs > 60) eta = Math.round(nm({ lat: a.lat, lon: a.lon }, { lat: rt.tlat, lon: rt.tlon }) / a.gs * 60);
      out.push({ label: label, req: {
        id: (a.flight || "").trim() || label, to: rt.to, from: rt.from || "",
        alt: typeof a.alt_baro === "number" ? a.alt_baro : null, gs: a.gs || null, vs: a.baro_rate || null,
        holding: !!hold, holdMin: hold && hold.min, etaMin: eta } });
    });
    return out;
  }
  function skyFlight() {
    var s = window.__lastSubject;
    if (!s || !s.callsign || !s.dCode) return null;
    if (typeof mode !== "undefined" && mode !== "planes") return null;
    var a = { hex: s.photoHex, alt_baro: s.altFt, track: s.trkDeg };
    var hold = holdingInfo(a);
    var eta = null;
    if (s.dLL && s.posLL && s.gsKt > 60) eta = Math.round(nm(s.posLL, s.dLL) / s.gsKt * 60);
    return { label: s.callsign, req: { id: s.callsign, to: s.dCode, from: s.oCode || "", alt: s.altFt, gs: s.gsKt || null,
      holding: !!hold, holdMin: hold && hold.min, etaMin: eta } };
  }

  /* ---------- notes ---------- */
  var notes = {};          // id -> {text, level, why, by, at}
  var faa = null, faaAt = 0;
  function loadFaa() {
    if (Date.now() - faaAt < 120000) return Promise.resolve(faa);
    faaAt = Date.now();
    return fetch("faa-delays.json?t=" + Math.floor(Date.now() / 120000), { cache: "no-cache" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { faa = d && d.ok ? d.airports || {} : faa; return faa; })
      .catch(function () { return faa; });
  }
  /* Without the Worker: the FAA status file and the plane's own track only. */
  function localNote(f) {
    var e = ((faa || {})[f.to] || []).filter(function (x) { return !(x.kind === "delay" && /^Departure/i.test(x.text || "")); })[0];
    var text = "", level = "delay";
    if (e && e.kind === "ground_stop") { text = "FAA ground stop at " + f.to + " — expect a long delay."; level = "major"; }
    else if (e && e.kind === "closure") { text = f.to + " is closed to arrivals — this flight may divert."; level = "major"; }
    else if (e && e.kind === "ground_delay") { text = "FAA ground delay program at " + f.to + " — arrivals are being held back."; level = "major"; }
    else if (f.holding) text = "Holding" + (e ? " — arrival delays at " + f.to : "") + ".";
    else if (e) text = "Arrival delays at " + f.to + " — expect a slower approach.";
    return text ? { text: text, level: level, why: [], by: "rules", at: Date.now() } : null;
  }

  var busy = false;
  function refresh() {
    if (busy || !enabled() || document.hidden) return;
    var flights = isSky ? [skyFlight()].filter(Boolean) : boardFlights();
    if (!flights.length) return;
    var u = url();
    busy = true;
    var done = function () { busy = false; paint(); };
    if (!u) {
      loadFaa().then(function () {
        flights.forEach(function (f) { var n = localNote(f.req); if (n) notes[f.req.id] = n; else delete notes[f.req.id]; });
      }).then(done, done);
      return;
    }
    var want = flights.slice(0, 12).map(function (f) { return f.req; });
    fetch(u + "/notes", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ flights: want }) })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        var got = (d && d.notes) || {};
        want.forEach(function (f) {
          var key = f.id.toUpperCase().replace(/[^A-Z0-9]/g, "");
          if (got[key]) { got[key].at = Date.now(); notes[f.id] = got[key]; } else delete notes[f.id];
        });
      })
      /* A Worker outage must not leave old notes up forever, nor blank real ground stops. */
      .catch(function () { return loadFaa().then(function () { flights.forEach(function (f) { var n = localNote(f.req); if (n) notes[f.req.id] = n; }); }); })
      .then(done, done);
  }
  function noteFor(id) {
    var n = notes[id];
    if (!n || Date.now() - n.at > STALE_MS) return null;
    return n;
  }
  function tip(n) {
    return (n.by === "claude" ? "Written by Claude from " : "From ") +
      "the FAA's airport status" + (n.by === "rules" && !url() ? "" : ", the destination's weather report and forecast") +
      " and the plane's track. The data shows where the plane is, not its schedule." +
      (n.why && n.why.length ? "\nSignals: " + n.why.join(", ") : "");
  }

  /* ---------- styles ---------- */
  function injectStyle() {
    if (document.getElementById(ID + "Css")) return;
    var st = document.createElement("style"); st.id = ID + "Css";
    st.textContent =
      ".fn-note{display:block;font-size:.82em;line-height:1.3;margin-top:2px;white-space:normal;color:var(--delay-mid,#ff9f6b)}" +
      ".fn-note.fn-major{color:var(--late,#ff5a5a);font-weight:650}.fn-note.fn-info{color:var(--muted,#93a5cf)}" +
      ".fn-note .fn-by{font-size:.85em;opacity:.7;margin-right:.35em}" +
      "#fnSkyNote{display:flex;align-items:flex-start;gap:.6em;margin-top:1.2vmin;font-size:clamp(14px,2.1vmin,24px);line-height:1.35;color:var(--amber,#ffd166)}" +
      "#fnSkyNote[hidden]{display:none}#fnSkyNote.fn-major{color:#ff8a6a}#fnSkyNote.fn-info{opacity:.8}" +
      "#fnSkyNote .fn-by{flex:none;font-size:.7em;letter-spacing:.08em;text-transform:uppercase;border:1px solid currentColor;border-radius:6px;padding:.15em .45em;margin-top:.2em;opacity:.8}" +
      "#fnSkyNote .fn-x{flex:none;margin-left:auto;background:none;border:0;color:inherit;opacity:.55;font-size:1.1em;cursor:pointer;padding:0 .3em}" +
      "#fnSkyNote .fn-x:hover{opacity:1}";
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- city boards: a line in the Planes card ---------- */
  function paintBoard() {
    var box = document.getElementById("planeList"); if (!box) return;
    var on = enabled(), changed = false, byLabel = {};
    boardFlights().forEach(function (f) { byLabel[f.label] = f.req.id; });
    [].slice.call(box.querySelectorAll(".row")).forEach(function (row) {
      var badge = row.querySelector(".badge"), mid = badge && badge.nextElementSibling;
      if (!mid) return;
      var id = byLabel[(badge.textContent || "").trim()], n = on && id ? noteFor(id) : null;
      var old = mid.querySelector(".fn-note");
      var html = n ? (n.by === "claude" ? '<span class="fn-by" aria-label="AI-written">✦</span>' : "") + esc(n.text) : "";
      if (!n) { if (old) { old.remove(); changed = true; } return; }
      if (old && old.getAttribute("data-html") === html) return;
      var elx = old || document.createElement("div");
      elx.className = "fn-note fn-" + (n.level || "delay");
      elx.setAttribute("data-html", html); elx.innerHTML = html; elx.title = tip(n);
      if (!old) mid.appendChild(elx);
      changed = true;
    });
    if (changed) { try { if (typeof fitList === "function") fitList(box); } catch (_) {} }
  }
  function watchBoard() {
    var box = document.getElementById("planeList");
    if (!box || box.__fnWatched) return;
    box.__fnWatched = true;
    /* The board rebuilds the list on every refresh; put the notes back each time. */
    var queued = false;
    new MutationObserver(function () {
      if (queued) return; queued = true;
      /* A timeout, not requestAnimationFrame: rAF never fires in a hidden tab or
         a backgrounded kiosk pane, and the notes would stay off until the next poll. */
      setTimeout(function () { queued = false; paintBoard(); }, 0);
    }).observe(box, { childList: true });
  }

  /* ---------- Sky view: a line under the status chips ---------- */
  function skyEl() {
    var el = document.getElementById("fnSkyNote");
    if (el) return el;
    var status = document.getElementById("status");
    if (!status || !status.parentNode) return null;
    el = document.createElement("div"); el.id = "fnSkyNote"; el.hidden = true; el.setAttribute("role", "status");
    status.parentNode.insertBefore(el, status.nextSibling);
    el.addEventListener("click", function (e) { if (e.target.closest(".fn-x")) setSkyEnabled(false); });
    return el;
  }
  var lastSkyId = "";
  function paintSky() {
    var el = skyEl(); if (!el) return;
    var f = skyFlight(), n = f && enabled() ? noteFor(f.req.id) : null;
    if (f && f.req.id !== lastSkyId) { lastSkyId = f.req.id; if (!n) setTimeout(refresh, 0); }
    if (!n) { el.hidden = true; return; }
    el.className = "fn-" + (n.level || "delay");
    el.title = tip(n);
    el.innerHTML = (n.by === "claude" ? '<span class="fn-by">✦ AI</span>' : "") + "<span>" + esc(n.text) + "</span>" +
      '<button type="button" class="fn-x" aria-label="Turn off flight delay notes" title="Turn off flight delay notes (back on in Settings)">×</button>';
    el.hidden = false;
  }
  function paintSkySeg() {
    [].slice.call(document.querySelectorAll("#fnSeg button")).forEach(function (b) { b.classList.toggle("active", (b.getAttribute("data-fn") === "on") === enabled()); });
  }
  function skySettings() {
    var panel = document.querySelector("#settings .panel");
    if (!panel || document.getElementById("fnSeg")) return;
    var lbl = document.createElement("div"); lbl.className = "lbl";
    lbl.innerHTML = 'Flight delay notes <span style="text-transform:none;opacity:.7">(FAA status, weather and holding, written up by Claude)</span>';
    var seg = document.createElement("div"); seg.className = "seg"; seg.id = "fnSeg";
    seg.innerHTML = '<button data-fn="on">On</button><button data-fn="off">Off</button>';
    seg.addEventListener("click", function (e) { var b = e.target.closest("button"); if (b) setSkyEnabled(b.getAttribute("data-fn") === "on"); });
    /* Beside the FAA setting it builds on. */
    var anchor = document.getElementById("faaUrl");
    anchor = anchor && anchor.closest(".locrow");
    if (anchor && anchor.parentNode === panel) { panel.insertBefore(seg, anchor.nextSibling); panel.insertBefore(lbl, seg); }
    else { panel.appendChild(lbl); panel.appendChild(seg); }
    paintSkySeg();
  }

  function paint() { injectStyle(); if (isSky) paintSky(); else paintBoard(); }

  /* ---------- wiring ---------- */
  function register() {
    injectStyle();
    if (isSky) { skySettings(); return; }
    try {
      if (typeof CARD_DEFS !== "undefined" && Array.isArray(CARD_DEFS) && !CARD_DEFS.some(function (d) { return d && d.id === ID; }))
        CARD_DEFS.push({ id: ID, label: "Flight delay notes" });
    } catch (_) {}
    /* An invisible stand-in the board's applyCardVis() can mark .user-hidden:
       the notes live inside the Planes card, but their switch is the board's own. */
    if (!document.getElementById(ID) && document.body) {
      var s = document.createElement("span"); s.id = ID; s.hidden = true; s.style.display = "none";
      document.body.appendChild(s);
      try { if (typeof loadHiddenCards === "function" && loadHiddenCards().has(ID)) s.classList.add("user-hidden"); } catch (_) {}
      /* Settings toggles the class; repaint when it does. */
      new MutationObserver(function () { paint(); }).observe(s, { attributes: true, attributeFilter: ["class"] });
    }
    watchBoard();
  }
  if (document.readyState === "loading") {
    document.addEventListener("readystatechange", function once() {
      if (document.readyState === "loading") return;
      document.removeEventListener("readystatechange", once); register();
    });
  } else register();

  /* Plane lists load a few seconds after boot; start soon, then once a minute.
     Tracks are sampled more often so holding can be seen. */
  setTimeout(refresh, 6000);
  setInterval(refresh, POLL_MS);
  setInterval(function () {
    if (!isSky) { boardFlights(); watchBoard(); }
    paint();
  }, isSky ? 3000 : 15000);

  window.TBFlightNotes = {
    refresh: refresh, notes: function () { return JSON.parse(JSON.stringify(notes)); },
    url: url, _inject: function (id, n) { n.at = Date.now(); notes[id] = n; paint(); }
  };
})();
