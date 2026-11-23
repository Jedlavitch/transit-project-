/* Sky — Airport view (styles in sky-airport.css, runways in airport-runways.json).

   Opens one airport full screen: its runways drawn to scale, every aircraft
   within 30 nm gliding between fixes, colour-coded as arriving, departing, on
   the ground or passing over, and a list of what is coming in, how soon, and
   which runway it is lined up on. Touchdowns and take-offs are caught as they
   happen ("Just landed").

   HOW IT DECIDES
     arriving   within 35 nm, under 12,000 ft above the field, pointed at the
                airport (track within 40 deg of the bearing to it) and either
                descending or already low.
     departing  under 15,000 ft above the field, pointed away from it and
                climbing, within 30 nm.
     runway     an arrival within 15 nm whose track is within 15 deg of a
                runway's landing heading and which is within 1.5 nm of that
                runway's extended centreline. The runway in use is the one
                most arrivals are lined up on.
   These are inferences from position, track and vertical rate (the feed does
   not say where a plane is going), so the list says "lined up on", not
   "cleared for".

   DATA: the board's own aircraft feed, searched around the airport rather
   than around this screen, every 8 s. Nothing new to set up.

   OPEN IT: the Airport view button (Glass: in the camera bar; starfield: in
   the header), A on a keyboard, or ?airport=KDCA in the link, which is also
   what the page shows while it is open, so the view can be shared. */
(function () {
  "use strict";
  var root = document.documentElement;
  var DATA = null, dataP = null;
  function loadData() {
    if (!dataP) dataP = fetch("airport-runways.json?v=1").then(function (r) { return r.json(); })
      .then(function (d) { DATA = d.airports || []; return DATA; })
      .catch(function () { DATA = []; return DATA; });
    return dataP;
  }
  function $(s, el) { return (el || document).querySelector(s); }
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  var R = Math.PI / 180;
  function nm(a, b) {
    var dLa = (b.lat - a.lat) * R, dLo = (b.lon - a.lon) * R;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 3440 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function brg(a, b) {
    var y = Math.sin((b.lon - a.lon) * R) * Math.cos(b.lat * R);
    var x = Math.cos(a.lat * R) * Math.sin(b.lat * R) - Math.sin(a.lat * R) * Math.cos(b.lat * R) * Math.cos((b.lon - a.lon) * R);
    return (Math.atan2(y, x) / R + 360) % 360;
  }
  function adiff(a, b) { var d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
  function feedBase() {
    try { return typeof adsbBase === "function" ? adsbBase() : ""; } catch (e) { return ""; }
  }
  function here() { try { return typeof loc !== "undefined" && loc && typeof loc.lat === "number" ? loc : null; } catch (e) { return null; } }
  var lowfx = function () { return root.classList.contains("tb-lowfx"); };

  /* ---- which airport ------------------------------------------------------ */
  function find(code) {
    if (!DATA || !code) return null;
    code = String(code).toUpperCase();
    for (var i = 0; i < DATA.length; i++) if (DATA[i].icao === code || DATA[i].iata === code) return DATA[i];
    return null;
  }
  function nearestTo(ll, max) {
    var best = null, bd = 1e9;
    (DATA || []).forEach(function (a) { var d = nm(ll, a); if (d < bd) { bd = d; best = a; } });
    return best && bd <= max ? best : null;
  }
  /* The followed plane's destination if we know it; else the airport nearest
     the plane; else the one nearest this screen. */
  function pickAirport() {
    var s = window.__lastSubject;
    if (s && s.dIcao && find(s.dIcao)) return find(s.dIcao);
    if (s && s.posLL) { var n = nearestTo(s.posLL, 40); if (n) return n; }
    var h = here();
    return h ? nearestTo(h, 250) : (DATA && DATA[0]) || null;
  }

  /* ---- the layer ----------------------------------------------------------- */
  var el = null, map = null, base = null, rwyLayer = null, pathLayer = null, planeLayer = null, trailLayer = null;
  var termLayer = null, poiLayer = null, info = null, tab = "traffic", wx = null, wxAt = 0;
  var ops = { opened: 0, land: [], off: [], around: [] };   // timestamps of what this screen has seen happen
  var ap = null, poll = 0, raf = 0, planes = {}, landed = [], firstFix = true, lastOk = 0, focusHex = null;

  function build() {
    if (el) return;
    el = document.createElement("div");
    el.id = "sgAp";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Airport view");
    el.innerHTML =
      '<div id="sgApMap"></div>' +
      '<div class="ap-top">' +
        '<button type="button" class="ap-back" title="Back to Sky (Esc)">‹ Sky</button>' +
        '<div class="ap-title"><b class="ap-code"></b><span class="ap-name"></span><span class="ap-rwy"></span></div>' +
        '<select class="ap-pick" aria-label="Choose an airport"></select>' +
      '</div>' +
      '<aside class="ap-side">' +
        '<button type="button" class="ap-grip" aria-label="Show more" aria-expanded="false"><i></i></button>' +
        '<div class="ap-health"><div class="ap-head"><span class="ap-dot"></span><span class="ap-pill">Checking…</span></div><span class="ap-why"></span>' +
          '<dl class="ap-stats"></dl></div>' +
        '<div class="ap-tabs" role="tablist">' +
          '<button type="button" role="tab" data-tab="traffic" aria-selected="true">Traffic</button>' +
          '<button type="button" role="tab" data-tab="info" aria-selected="false">Airport</button>' +
        '</div>' +
        '<div class="ap-pane ap-pane-traffic">' +
        '<div class="ap-status" role="status"></div>' +
        '<section class="ap-landed" hidden><h3>Just happened</h3><ol></ol></section>' +
        '<section class="ap-sec-arr"><h3>Arriving <span class="n"></span></h3><ol></ol><p class="ap-empty">Nothing on approach right now.</p></section>' +
        '<section class="ap-sec-dep"><h3>Departing <span class="n"></span></h3><ol></ol><p class="ap-empty">No departures climbing out right now.</p></section>' +
        '<p class="ap-gnd"></p>' +
        '<p class="ap-note">Runways are inferred from each plane\'s track and position. Positions glide between 8-second fixes.</p>' +
        '</div>' +
        '<div class="ap-pane ap-pane-info" hidden></div>' +
      '</aside>';
    document.body.appendChild(el);
    $(".ap-back", el).addEventListener("click", close);
    $(".ap-pick", el).addEventListener("change", function () { var a = find(this.value); if (a) show(a); });
    el.addEventListener("click", function (e) {
      var li = e.target.closest && e.target.closest("li[data-hex]");
      if (li) focus(li.getAttribute("data-hex"));
      var tb = e.target.closest && e.target.closest(".ap-tabs button");
      if (tb) setTab(tb.getAttribute("data-tab"));
      var pl = e.target.closest && e.target.closest("li[data-at]");
      if (pl) { var at = pl.getAttribute("data-at").split(","); map.setView([+at[0], +at[1]], Math.max(map.getZoom(), 17)); }
      var th = e.target.closest && e.target.closest(".ap-term > h4");
      if (th) th.parentNode.classList.toggle("open");
    });
    map = L.map("sgApMap", { zoomControl: false, attributionControl: true, fadeAnimation: false, worldCopyJump: true });
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution("Runways: OurAirports");
    try { base = TBBasemap.add(map, dark() ? "dark" : "color", { maxZoom: 19 }); } catch (e) {}
    rwyLayer = L.layerGroup().addTo(map);
    pathLayer = L.layerGroup().addTo(map);
    termLayer = L.layerGroup().addTo(map);
    poiLayer = L.layerGroup();
    trailLayer = L.layerGroup().addTo(map);
    planeLayer = L.layerGroup().addTo(map);
    /* Plane labels go below z10 (they pile up); runway numbers only from z13,
       where the runways are long enough on screen to carry them. */
    var zoomCls = function () { var z = map.getZoom(); el.classList.toggle("ap-far", z < 10); el.classList.toggle("ap-near", z >= 13); };
    map.on("zoomend", zoomCls); zoomCls();
    // the phone sheet: a short peek that opens to most of the screen
    var side = $(".ap-side", el), grip = $(".ap-grip", el);
    function setSheet(open) { side.classList.toggle("open", open); if (!open) side.scrollTop = 0; grip.setAttribute("aria-expanded", String(open)); grip.setAttribute("aria-label", open ? "Show less" : "Show more"); }
    grip.addEventListener("click", function () { setSheet(!side.classList.contains("open")); });
    var y0 = null;
    grip.addEventListener("touchstart", function (e) { y0 = e.touches[0].clientY; }, { passive: true });
    grip.addEventListener("touchend", function (e) {
      if (y0 == null) return; var dy = e.changedTouches[0].clientY - y0; y0 = null;
      if (dy < -30) setSheet(true); else if (dy > 30) setSheet(false);
    });
    $(".ap-tabs", el).addEventListener("click", function () { setSheet(true); });
  }
  function dark() { return root.hasAttribute("data-sky-dark") || !root.hasAttribute("data-sky-glass"); }

  function fillPicker() {
    var sel = $(".ap-pick", el), h = here() || ap;
    var list = (DATA || []).slice().sort(function (a, b) { return nm(h, a) - nm(h, b); }).slice(0, 12);
    if (list.indexOf(ap) < 0) list.unshift(ap);
    sel.innerHTML = list.map(function (a) {
      return '<option value="' + a.icao + '"' + (a === ap ? " selected" : "") + ">" + esc(a.iata + " · " + a.name) + "</option>";
    }).join("");
  }

  function drawRunways() {
    rwyLayer.clearLayers();
    ap.rwy.forEach(function (r) {
      var line = [r.a, r.b];
      L.polyline(line, { color: dark() ? "#9aa3b2" : "#2b313c", weight: 9, opacity: .9, lineCap: "butt", interactive: false }).addTo(rwyLayer);
      L.polyline(line, { color: "#ffffff", weight: 1.2, opacity: .9, dashArray: "6 6", interactive: false }).addTo(rwyLayer);
      [[r.a, r.le], [r.b, r.he]].forEach(function (end) {
        L.marker(end[0], { interactive: false, icon: L.divIcon({ className: "ap-rwy-lbl", html: esc(end[1]), iconSize: [30, 16], iconAnchor: [15, 8] }) }).addTo(rwyLayer);
      });
    });
  }
  /* The landing runway's final approach: 10 nm of extended centreline out
     from the threshold, against the landing direction. */
  function drawPath(inUse) {
    pathLayer.clearLayers();
    ap.rwy.forEach(function (r) {
      [["le", r.a, r.leH], ["he", r.b, r.heH]].forEach(function (e) {
        var id = r[e[0]];
        if (inUse.indexOf(id) < 0 || typeof e[2] !== "number") return;
        var back = (e[2] + 180) * R, t = { lat: e[1][0], lon: e[1][1] };
        var far = { lat: t.lat + 10 / 60 * Math.cos(back), lon: t.lon + 10 / 60 * Math.sin(back) / Math.cos(t.lat * R) };
        L.polyline([[t.lat, t.lon], [far.lat, far.lon]], { color: "#FF3D77", weight: 2, opacity: .75, dashArray: "2 7", interactive: false }).addTo(pathLayer);
      });
    });
  }

  /* ---- classify ------------------------------------------------------------ */
  function lineUp(p) {
    if (p.d > 15) return null;
    var best = null;
    ap.rwy.forEach(function (r) {
      [["le", r.a, r.leH], ["he", r.b, r.heH]].forEach(function (e) {
        if (typeof e[2] !== "number" || adiff(p.trk, e[2]) > 15) return;
        var t = { lat: e[1][0], lon: e[1][1] }, dd = nm(p, t), b = brg(p, t);
        var xt = Math.abs(dd * Math.sin(adiff(b, e[2]) * R));          // cross-track from the centreline
        if (xt < 1.5 && adiff(b, e[2]) < 90 && (!best || xt < best.xt)) best = { id: r[e[0]], xt: xt, toGo: dd };
      });
    });
    return best;
  }
  function classify(a) {
    var p = { hex: a.hex, cs: (a.flight || "").trim() || a.r || a.hex, type: a.t || "", desc: a.desc || "",
              lat: a.lat, lon: a.lon, gs: a.gs || 0, trk: typeof a.track === "number" ? a.track : (a.true_heading || 0),
              vr: typeof a.baro_rate === "number" ? a.baro_rate : (a.geom_rate || 0) };
    p.ground = a.alt_baro === "ground";
    p.alt = p.ground ? ap.elev : (typeof a.alt_baro === "number" ? a.alt_baro : a.alt_geom);
    p.agl = typeof p.alt === "number" ? p.alt - ap.elev : null;
    p.d = nm(p, ap);
    var toAp = brg(p, ap);
    if (p.ground || (p.agl != null && p.agl < 120 && p.gs < 50)) p.kind = p.d < 4 ? "ground" : "other";
    // climbing out close to the field is a departure whichever way it points (it may still be over the runway)
    else if (p.agl != null && p.agl < 6000 && p.d < 4 && p.vr > 300) p.kind = "dep";
    else if (p.agl != null && p.agl < 12000 && p.d < 35 && (adiff(p.trk, toAp) < 40 || p.d < 2.5) && p.vr < 300 && (p.vr < -100 || p.agl < 3000)) p.kind = "arr";
    else if (p.agl != null && p.agl < 15000 && p.d < 30 && adiff(p.trk, (toAp + 180) % 360) < 60 && p.vr > 200) p.kind = "dep";
    else p.kind = "other";
    if (p.kind === "arr") {
      p.eta = p.gs > 60 ? p.d / p.gs * 60 : null;
      var lu = lineUp(p); if (lu) { p.rwy = lu.id; p.eta = p.gs > 60 ? lu.toGo / p.gs * 60 : p.eta; }
    }
    if (p.kind === "dep" && p.d < 6) {
      ap.rwy.forEach(function (r) {
        if (typeof r.leH === "number" && adiff(p.trk, r.leH) < 15) p.rwy = r.le;
        else if (typeof r.heH === "number" && adiff(p.trk, r.heH) < 15) p.rwy = r.he;
      });
    }
    return p;
  }

  /* ---- fetch + reconcile ---------------------------------------------------- */
  function status(t) { $(".ap-status", el).textContent = t || ""; }
  function fetchOnce() {
    if (!ap) return;
    var b = feedBase();
    if (!b) { status("No aircraft feed is set up on this screen, so there are no planes to show."); return; }
    var want = ap;
    fetch(b + "/point/" + ap.lat.toFixed(4) + "/" + ap.lon.toFixed(4) + "/30", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (d) { if (want === ap) reconcile(d.ac || []); })
      .catch(function (e) {
        // a bug in here must not pass for a network failure
        if (e && !/^\d+$/.test(e.message || "") && !(e instanceof TypeError && /fetch|network|load/i.test(e.message))) { try { console.error("airport view:", e && e.stack || e); } catch (er) {} }
        if (Date.now() - lastOk > 30000) status("Can't reach the aircraft feed right now. Retrying…");
      });
  }
  function reconcile(list) {
    lastOk = Date.now();
    var now = performance.now(), seen = {};
    list.forEach(function (a) {
      if (!a.hex || typeof a.lat !== "number" || typeof a.lon !== "number") return;
      var p = classify(a), o = planes[a.hex];
      seen[a.hex] = 1;
      if (!o) { o = planes[a.hex] = { p: p, fix: p, fixAt: now, shown: { lat: p.lat, lon: p.lon }, from: null, blendAt: now, trail: [] }; addMarker(o); }
      else {
        // a touchdown or a lift-off between two fixes
        if (!firstFix && o.p.kind === "arr" && p.kind === "ground" && p.d < 3) { note("landed", p, o.p.rwy); ops.land.push(Date.now()); }
        if (!firstFix && o.p.ground && !p.ground && p.d < 4) { note("took off", p, p.rwy); ops.off.push(Date.now()); }
        /* A go-around: low on approach (under 1,000 ft above the field, within
           5 nm), then climbing hard without having touched down. */
        if (!firstFix && o.lowAgl != null && o.lowAgl < 1000 && !p.ground && p.d < 5 && p.vr > 800 && p.agl - o.lowAgl > 400 && !o.wentAround) {
          o.wentAround = true; note("went around", p, o.p.rwy); ops.around.push(Date.now());
        }
        if (p.lat !== o.fix.lat || p.lon !== o.fix.lon) { o.from = o.shown; o.blendAt = now; o.fix = p; o.fixAt = now; }
        o.p = p;
      }
      if (p.kind === "arr" && p.agl != null) o.lowAgl = o.lowAgl == null ? p.agl : Math.min(o.lowAgl, p.agl);
      if (p.ground) { o.lowAgl = null; o.wentAround = false; }
      /* Holding: 330 deg or more of turning in the last four minutes while
         still well above the field. That is a racetrack, not a vector. */
      o.trks = (o.trks || []).filter(function (x) { return Date.now() - x.t < 240000; });
      o.trks.push({ t: Date.now(), trk: p.trk });
      var turn = 0;
      for (var i = 1; i < o.trks.length; i++) { var dd = o.trks[i].trk - o.trks[i - 1].trk; dd = ((dd + 540) % 360) - 180; turn += Math.abs(dd); }
      p.holding = turn >= 330 && p.agl != null && p.agl > 2500 && p.d < 40;
      if (p.kind === "arr" || p.kind === "dep") {
        o.trail.push([p.lat, p.lon]); if (o.trail.length > 40) o.trail.shift();
      } else o.trail = [];
      paintMarker(o);
    });
    Object.keys(planes).forEach(function (h) {
      // gone from three fixes running (out of range, or the transponder off): drop it
      if (!seen[h]) { var o = planes[h]; o.miss = (o.miss || 0) + 1; if (o.miss > 2) drop(h); }
      else planes[h].miss = 0;
    });
    firstFix = false;
    paintList();
  }
  function drop(h) {
    var o = planes[h]; if (!o) return;
    if (o.m) planeLayer.removeLayer(o.m);
    if (o.tr) trailLayer.removeLayer(o.tr);
    delete planes[h];
  }
  function note(what, p, rwy) {
    landed.unshift({ what: what, cs: p.cs, type: p.type, rwy: rwy || "", at: new Date() });
    landed = landed.slice(0, 5);
    var o = planes[p.hex]; if (o && o.m) { var ic = o.m.getElement(); if (ic) { ic.classList.remove("ap-flash"); void ic.offsetWidth; ic.classList.add("ap-flash"); } }
  }

  /* ---- markers ---------------------------------------------------------------- */
  var PLANE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.6 7.2 7.4 4.3v2l-7.4-2.1-.6 5.1 2.4 1.8V22L12 21l-3.4 1v-1.7l2.4-1.8-.6-5.1-7.4 2.1v-2l7.4-4.3z"/></svg>';
  function addMarker(o) {
    o.m = L.marker([o.p.lat, o.p.lon], { riseOnHover: true, icon: L.divIcon({ className: "ap-pl", iconSize: [24, 24], iconAnchor: [12, 12],
      html: '<span class="ap-ic">' + PLANE + '</span><b class="ap-lbl"></b>' }) }).addTo(planeLayer);
    o.m.on("click", function () { focus(o.p.hex); });
  }
  function altText(p) {
    if (p.kind === "ground") return "on ground";
    if (typeof p.alt !== "number") return "";
    var arrow = p.vr < -300 ? " ↓" : p.vr > 300 ? " ↑" : "";
    return Math.round(p.alt / 100) * 100 >= 18000 ? "FL" + Math.round(p.alt / 100) + arrow : (Math.round(p.alt / 100) * 100).toLocaleString() + " ft" + arrow;
  }
  function paintMarker(o) {
    var ic = o.m.getElement(); if (!ic) return;
    ["arr", "dep", "ground", "other"].forEach(function (k) { ic.classList.toggle("ap-" + k, o.p.kind === k); });
    ic.classList.toggle("ap-focus", o.p.hex === focusHex);
    $(".ap-ic", ic).style.transform = "rotate(" + o.p.trk + "deg)";
    var lbl = $(".ap-lbl", ic);
    lbl.textContent = o.p.kind === "other" ? o.p.cs : o.p.cs + " · " + altText(o.p);
    if (o.trail.length > 1) {
      if (!o.tr) o.tr = L.polyline(o.trail, { color: o.p.kind === "arr" ? "#FF3D77" : "#00E0C6", weight: 2, opacity: .55, interactive: false }).addTo(trailLayer);
      else { o.tr.setLatLngs(o.trail); o.tr.setStyle({ color: o.p.kind === "arr" ? "#FF3D77" : "#00E0C6" }); }
    } else if (o.tr) { trailLayer.removeLayer(o.tr); o.tr = null; }
  }
  /* Between fixes each plane moves along its track at its ground speed, and a
     new fix is blended in over 1.5 s rather than jumped to. */
  var last = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < (lowfx() ? 125 : 40)) return;
    last = now;
    Object.keys(planes).forEach(function (h) {
      var o = planes[h], f = o.fix, p;
      if (f.gs > 30 && !f.ground) {
        var hrs = Math.min(now - o.fixAt, 30000) / 3600000, dd = f.gs * hrs, r = f.trk * R;
        p = { lat: f.lat + dd * Math.cos(r) / 60, lon: f.lon + dd * Math.sin(r) / (60 * Math.cos(f.lat * R)) };
      } else p = { lat: f.lat, lon: f.lon };
      if (o.from) {
        var k = Math.min(1, (now - o.blendAt) / 1500); k = k * (2 - k);
        p = { lat: o.from.lat + (p.lat - o.from.lat) * k, lon: o.from.lon + (p.lon - o.from.lon) * k };
        if (k >= 1) o.from = null;
      }
      o.shown = p;
      o.m.setLatLng([p.lat, p.lon]);
    });
  }

  /* ---- the list --------------------------------------------------------------- */
  function row(p) {
    var bits = [p.type, altText(p), p.d.toFixed(1) + " nm"];
    var right = p.kind === "arr"
      ? (p.eta != null ? (p.eta < 1 ? "now" : Math.round(p.eta) + " min") : "")
      : "";
    return '<li data-hex="' + esc(p.hex) + '" class="' + (p.hex === focusHex ? "on" : "") + '">' +
      '<span class="cs">' + esc(p.cs) + "</span>" +
      (p.rwy ? '<span class="rw">' + esc(p.rwy) + "</span>" : "") +
      '<span class="eta">' + esc(right) + "</span>" +
      '<span class="meta">' + esc(bits.filter(Boolean).join(" · ")) + "</span></li>";
  }
  function paintList() {
    var all = Object.keys(planes).map(function (h) { return planes[h].p; });
    var arr = all.filter(function (p) { return p.kind === "arr"; }).sort(function (a, b) { return (a.eta == null ? 99 : a.eta) - (b.eta == null ? 99 : b.eta) || a.d - b.d; });
    var dep = all.filter(function (p) { return p.kind === "dep"; }).sort(function (a, b) { return a.d - b.d; });
    var gnd = all.filter(function (p) { return p.kind === "ground"; }).length;
    var A = $(".ap-sec-arr", el), D = $(".ap-sec-dep", el);
    $("ol", A).innerHTML = arr.slice(0, 12).map(row).join(""); $(".n", A).textContent = arr.length ? arr.length : "";
    $(".ap-empty", A).hidden = arr.length > 0;
    $("ol", D).innerHTML = dep.slice(0, 8).map(row).join(""); $(".n", D).textContent = dep.length ? dep.length : "";
    $(".ap-empty", D).hidden = dep.length > 0;
    $(".ap-gnd", el).textContent = gnd ? gnd + " on the ground with a transponder on" : "";
    var L2 = $(".ap-landed", el);
    L2.hidden = !landed.length;
    $("ol", L2).innerHTML = landed.map(function (x) {
      var t = x.at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      return '<li><span class="cs">' + esc(x.cs) + '</span><span class="meta">' + esc(x.what + (x.rwy ? " on " + x.rwy : "") + " · " + t) + "</span></li>";
    }).join("");
    // runway in use: the one most arrivals are lined up on, then departures
    var count = {}, dcount = {};
    arr.forEach(function (p) { if (p.rwy) count[p.rwy] = (count[p.rwy] || 0) + 1; });
    dep.forEach(function (p) { if (p.rwy) dcount[p.rwy] = (dcount[p.rwy] || 0) + 1; });
    var top = function (c) { return Object.keys(c).sort(function (a, b) { return c[b] - c[a]; }); };
    var land = top(count), off = top(dcount);
    var txt = [];
    if (land.length) txt.push("Landing " + land.slice(0, 2).join(" & "));
    if (off.length) txt.push("Departing " + off.slice(0, 2).join(" & "));
    $(".ap-rwy", el).textContent = txt.join(" · ");
    drawPath(land.slice(0, 2));
    paintHealth(all, land[0]);
    status(all.length ? "" : "No aircraft within 30 nm of " + ap.iata + " right now.");
  }
  /* ---- how the airport is running ------------------------------------------------
     Like a flight-tracking app's airport status: the FAA's own word first
     (ground stops, ground delay programs, closures, departure delays — the
     same nasstatus.faa.gov feed the deploy publishes as faa-delays.json),
     then what this screen can see for itself. */
  function faaHere() {
    try { return (typeof faaFor === "function" ? faaFor(ap.iata) : []) || []; } catch (e) { return []; }
  }
  function perHour(list, now) {
    var win = Math.min(60, Math.max(1, (now - ops.opened) / 60000));
    var n = list.filter(function (t) { return now - t < 3600000; }).length;
    return { n: n, min: Math.round(win), rate: win >= 10 ? Math.round(n * 60 / win) : null };
  }
  function components(rwyId) {
    if (!wx || wx.wspd == null || !rwyId) return null;
    var h = null;
    ap.rwy.forEach(function (r) { if (r.le === rwyId) h = r.leH; if (r.he === rwyId) h = r.heH; });
    if (typeof h !== "number") return null;
    var a = (wx.wdir - h) * R;
    return { head: Math.round(wx.wspd * Math.cos(a)), cross: Math.round(Math.abs(wx.wspd * Math.sin(a))), side: Math.sin(a) > 0 ? "R" : "L" };
  }
  function paintHealth(all, rwyInUse) {
    var now = Date.now(), faa = faaHere();
    var holding = all.filter(function (p) { return p.holding; });
    var around = ops.around.filter(function (t) { return now - t < 1800000; }).length;
    var lvl = "ok", label = "Normal", why = "No FAA delay programs. Traffic is moving.";
    var worst = null;
    faa.forEach(function (e) {
      var k = (e.kind || "") + " " + (e.text || e.label || "");
      var sev = /ground stop|closed|closure/i.test(k) ? 3 : (e.severity === "major" || /ground delay|gdp/i.test(k)) ? 2 : 1;
      if (!worst || sev > worst.sev) worst = { sev: sev, e: e };
    });
    if (worst) {
      lvl = worst.sev === 3 ? "stop" : worst.sev === 2 ? "bad" : "minor";
      label = worst.sev === 3 ? (/closed|closure/i.test(worst.e.kind + worst.e.text) ? "Closed" : "Ground stop") : worst.sev === 2 ? "Delays" : "Minor delays";
      why = [worst.e.text || worst.e.label, worst.e.reason].filter(Boolean).join(" \u2014 ");
    } else if (holding.length >= 3) {
      lvl = "minor"; label = "Holding"; why = holding.length + " planes are circling in holding patterns \u2014 often the first sign of a delay.";
    } else if (around >= 2) {
      lvl = "minor"; label = "Go-arounds"; why = around + " go-arounds in the last 30 minutes.";
    }
    var H = $(".ap-health", el);
    H.className = "ap-health ap-" + lvl;
    $(".ap-pill", H).textContent = label;
    $(".ap-why", H).textContent = why;
    var L1 = perHour(ops.land, now), T1 = perHour(ops.off, now);
    var stats = [];
    stats.push(["Landings", L1.rate != null ? L1.rate + "/hr" : L1.n + " in " + L1.min + " min"]);
    stats.push(["Take-offs", T1.rate != null ? T1.rate + "/hr" : T1.n + " in " + T1.min + " min"]);
    stats.push(["On approach", String(all.filter(function (p) { return p.kind === "arr"; }).length)]);
    stats.push(["Holding", String(holding.length)]);
    if (around) stats.push(["Go-arounds", around + " (30 min)"]);
    // spacing between arrivals lined up on the same runway, nearest first
    var lined = all.filter(function (p) { return p.kind === "arr" && p.rwy === rwyInUse; }).sort(function (a, b) { return a.d - b.d; });
    if (lined.length >= 2) {
      var gaps = []; for (var i = 1; i < lined.length; i++) gaps.push(lined[i].d - lined[i - 1].d);
      stats.push(["Spacing", (gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length).toFixed(1) + " nm"]);
    }
    if (wx && wx.wspd != null) {
      var w = (wx.wspd < 3 ? "calm" : ("00" + wx.wdir).slice(-3) + "\u00b0 " + wx.wspd + " kt" + (wx.wgst && wx.wgst > wx.wspd + 4 ? " G" + wx.wgst : ""));
      stats.push(["Wind", w]);
      var c = wx.wspd >= 3 ? components(rwyInUse) : null;
      if (c) stats.push(["On " + rwyInUse, (c.head >= 0 ? c.head + " kt head" : -c.head + " kt TAIL") + ", " + c.cross + " kt cross " + c.side]);
      if (wx.visMi != null) stats.push(["Visibility", wx.visMi >= 10 ? "10+ mi" : wx.visMi.toFixed(1) + " mi"]);
    }
    $(".ap-stats", H).innerHTML = stats.map(function (x) { return "<div><dt>" + esc(x[0]) + "</dt><dd>" + esc(x[1]) + "</dd></div>"; }).join("");
  }
  function refreshWx() {
    if (!ap || Date.now() - wxAt < 600000) return;
    wxAt = Date.now();
    var want = ap;
    try {
      if (typeof lookupDestWx === "function") lookupDestWx({ lat: ap.lat, lon: ap.lon }).then(function (v) { if (want === ap) wx = v; });
      if (typeof refreshFaa === "function") refreshFaa();
    } catch (e) {}
  }

  /* ---- the Airport tab: terminals, food, lounges, links ---------------------------- */
  function setTab(t) {
    tab = t;
    [].forEach.call(el.querySelectorAll(".ap-tabs button"), function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === t)); });
    $(".ap-pane-traffic", el).hidden = t !== "traffic";
    $(".ap-pane-info", el).hidden = t !== "info";
    if (t === "info") { if (!map.hasLayer(poiLayer)) poiLayer.addTo(map); loadInfo(); }
    else if (map.hasLayer(poiLayer)) map.removeLayer(poiLayer);
  }
  /* "Open now" from OSM opening_hours, for the common forms only:
     "24/7", "06:00-22:00", "Mo-Fr 05:00-19:00; Sa,Su 06:00-18:00". Anything
     fancier shows the raw hours and no verdict, rather than a wrong one. */
  var DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  function openNow(h) {
    if (!h) return null;
    if (/^\s*24\/7\s*$/.test(h)) return true;
    var d = new Date(), day = d.getDay(), mins = d.getHours() * 60 + d.getMinutes(), verdict = null;
    var rules = h.split(";");
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i].trim(); if (!r) continue;
      var m = r.match(/^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?,?\s*)+)?\s*((?:\d\d:\d\d-\d\d:\d\d,?\s*)+|off|closed)$/);
      if (!m) return null;
      var applies = true;
      if (m[1]) {
        applies = false;
        m[1].split(",").forEach(function (part) {
          var ab = part.trim().split("-"), a = DAYS.indexOf(ab[0]), b = ab[1] ? DAYS.indexOf(ab[1]) : a;
          if (a < 0 || b < 0) return;
          for (var k = a; ; k = (k + 1) % 7) { if (k === day) applies = true; if (k === b) break; }
        });
      }
      if (!applies) continue;
      if (/off|closed/.test(m[2])) { verdict = false; continue; }
      verdict = false;
      m[2].split(",").forEach(function (span) {
        var t = span.trim().match(/(\d\d):(\d\d)-(\d\d):(\d\d)/); if (!t) return;
        var a = +t[1] * 60 + +t[2], b = +t[3] * 60 + +t[4];
        if (b <= a ? (mins >= a || mins < b) : (mins >= a && mins < b)) verdict = true;
      });
    }
    return verdict;
  }
  function loadInfo() {
    if (!ap) return;
    if (info && info.icao === ap.icao) return paintInfo();
    var want = ap;
    $(".ap-pane-info", el).innerHTML = '<p class="ap-empty">Loading terminals\u2026</p>';
    fetch("airport-info/" + ap.icao + ".json?v=1").then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) { if (want === ap) { info = d; paintInfo(); } })
      .catch(function () { if (want === ap) { info = { icao: ap.icao, terminals: [], none: true }; paintInfo(); } });
  }
  function drawTerminals() {
    termLayer.clearLayers(); poiLayer.clearLayers();
    if (!info || !info.terminals) return;
    info.terminals.forEach(function (t) {
      t.rings.forEach(function (ring) {
        L.polygon(ring, { color: "#FFD37A", weight: 1.5, opacity: .8, fillColor: "#FFD37A", fillOpacity: .12, interactive: false }).addTo(termLayer);
      });
      t.places.forEach(function (p) {
        L.circleMarker(p.at, { radius: p.k === "lounge" ? 6 : 4, weight: 1.5, color: "#fff",
          fillColor: p.k === "lounge" ? "#B78CFF" : p.k === "food" ? "#FF9F43" : "#7FA7FF", fillOpacity: 1 })
          .bindTooltip(esc(p.n) + (p.u ? " \u00b7 " + esc(p.u) : ""), { direction: "top" }).addTo(poiLayer);
      });
    });
  }
  function placeRow(p) {
    var o = openNow(p.h);
    var meta = [p.k === "shop" ? p.s : p.c, p.u ? "near " + p.u : "", o == null ? p.h : ""].filter(Boolean).join(" \u00b7 ");
    return '<li data-at="' + p.at.join(",") + '" class="ap-' + p.k + '"><span class="cs">' + esc(p.n) + "</span>" +
      (o == null ? "" : '<span class="open ' + (o ? "yes" : "no") + '">' + (o ? "open" : "closed") + "</span>") +
      (meta ? '<span class="meta">' + esc(meta) + "</span>" : "") + "</li>";
  }
  function paintInfo() {
    var P = $(".ap-pane-info", el), h = [];
    drawTerminals();
    var rw = ap.rwy.map(function (r) {
      return "<tr><td>" + esc(r.le + "/" + r.he) + "</td><td>" + r.len.toLocaleString() + " ft</td><td>" +
        (typeof r.leH === "number" ? Math.round(r.leH) + "\u00b0/" + Math.round(r.heH) + "\u00b0" : "") + "</td></tr>";
    }).join("");
    h.push('<section><h3>The field</h3><p class="ap-facts"><b>' + esc(ap.icao) + "</b> \u00b7 " + esc(ap.iata) + " \u00b7 elevation " + ap.elev.toLocaleString() + " ft</p>" +
      '<table class="ap-rw"><thead><tr><th>Runway</th><th>Length</th><th>True hdg</th></tr></thead><tbody>' + rw + "</tbody></table></section>");
    if (info && info.terminals && info.terminals.length) {
      var c = info.counts || {};
      h.push("<section><h3>Terminals</h3><p class=\"ap-facts\">" + info.terminals.length + " terminals \u00b7 " + (c.food || 0) + " places to eat & drink \u00b7 " + (c.lounges || 0) + " lounges \u00b7 " + (c.shops || 0) + " shops</p>");
      var lg = [];
      info.terminals.forEach(function (t) { t.places.forEach(function (p) { if (p.k === "lounge") lg.push({ p: p, t: t.name }); }); });
      if (lg.length) h.push('<div class="ap-lounges">' + lg.map(function (x) { return '<span data-at="' + x.p.at.join(",") + '">' + esc(x.p.n) + " <small>" + esc(x.t) + "</small></span>"; }).join("") + "</div>");
      info.terminals.forEach(function (t, i) {
        var food = t.places.filter(function (p) { return p.k !== "shop"; }), shops = t.places.filter(function (p) { return p.k === "shop"; });
        h.push('<div class="ap-term' + (i === 0 ? " open" : "") + '"><h4>' + esc(t.name) + " <small>" + (t.gates ? t.gates + " gates \u00b7 " : "") + food.length + " food & lounges \u00b7 " + shops.length + " shops</small></h4>" +
          "<ol>" + food.map(placeRow).join("") + shops.map(placeRow).join("") + "</ol></div>");
      });
      h.push("</section>");
    } else {
      h.push('<section><h3>Terminals</h3><p class="ap-empty">' + (info && info.none ? "No terminal map for this airport yet." : "OpenStreetMap has no terminal outlines here.") + "</p></section>");
    }
    var yt = "https://www.youtube.com/results?search_query=" + encodeURIComponent(ap.name + " live webcam") + "&sp=EgJAAQ%253D%253D";
    h.push('<section><h3>Links</h3><ul class="ap-links">' +
      (info && info.website ? '<li><a target="_blank" rel="noopener" href="' + esc(info.website) + '">Airport website</a><span>security wait times, parking, maps</span></li>' : "") +
      '<li><a target="_blank" rel="noopener" href="https://www.liveatc.net/search/?icao=' + esc(ap.icao) + '">Listen to ATC</a><span>LiveATC tower and approach feeds</span></li>' +
      '<li><a target="_blank" rel="noopener" href="' + yt + '">Live webcams</a><span>live streams on YouTube</span></li>' +
      (/^K/.test(ap.icao) ? '<li><span class="ap-tsa">TSA wait times</span><span>TSA has no public live feed; its MyTSA app shows crowd-reported waits, and many airports post theirs on their website.</span></li>' : "") +
      "</ul></section>");
    h.push('<p class="ap-note">Terminals and places: \u00a9 OpenStreetMap contributors' + (info && info.built ? ", as of " + esc(info.built) : "") + ". Hours are as mapped; check before you rely on them.</p>");
    P.innerHTML = h.join("");
    [].forEach.call(P.querySelectorAll(".ap-lounges span"), function (s) {
      s.addEventListener("click", function () { var at = s.getAttribute("data-at").split(","); map.setView([+at[0], +at[1]], 17); });
    });
  }

  function focus(hex) {
    focusHex = focusHex === hex ? null : hex;
    var o = planes[hex];
    if (o && focusHex) map.panTo([o.shown.lat, o.shown.lon], { animate: true });
    Object.keys(planes).forEach(function (h) { paintMarker(planes[h]); });
    paintList();
  }

  /* ---- open / close ------------------------------------------------------------- */
  function setUrl(code) {
    try {
      var u = new URL(location.href);
      if (code) u.searchParams.set("airport", code); else u.searchParams.delete("airport");
      history.replaceState(null, "", u);
    } catch (e) {}
  }
  function show(a) {
    ap = a;
    Object.keys(planes).forEach(drop);
    landed = []; firstFix = true; focusHex = null;
    ops = { opened: Date.now(), land: [], off: [], around: [] }; wx = null; wxAt = 0; info = null;
    termLayer.clearLayers(); poiLayer.clearLayers();
    $(".ap-code", el).textContent = a.iata;
    $(".ap-name", el).textContent = a.name;
    $(".ap-rwy", el).textContent = "";
    fillPicker();
    drawRunways(); pathLayer.clearLayers();
    status("Looking for aircraft around " + a.iata + "…");
    map.invalidateSize();
    map.setView([a.lat, a.lon], 11, { animate: false });
    setUrl(a.icao);
    clearInterval(poll); fetchOnce(); refreshWx(); poll = setInterval(function () { fetchOnce(); refreshWx(); }, 8000);
    // terminal outlines draw in either tab; the list fills when the tab opens
    loadInfo();
    if (tab === "info") setTab("info");
  }
  function open(code) {
    loadData().then(function () {
      var a = (code && find(code)) || pickAirport();
      if (!a) return;
      build();
      root.classList.add("sg-airport-on");
      el.classList.add("show");
      try { if (base) base.setTheme(dark() ? "dark" : "color"); } catch (e) {}
      show(a);
      cancelAnimationFrame(raf); raf = requestAnimationFrame(frame);
    });
  }
  function close() {
    if (!el || !el.classList.contains("show")) return;
    el.classList.remove("show");
    root.classList.remove("sg-airport-on");
    clearInterval(poll); cancelAnimationFrame(raf);
    Object.keys(planes).forEach(drop);
    ap = null; setUrl(null);
  }
  window.TBAirport = { open: open, close: close, isOpen: function () { return !!(el && el.classList.contains("show")); } };

  /* ---- the way in ------------------------------------------------------------------ */
  function button() {
    if (document.getElementById("sgApBtn")) return;
    var b = document.createElement("button");
    b.type = "button"; b.id = "sgApBtn"; b.textContent = document.getElementById("sgCam") ? "Airport" : "Airport view";
    b.title = "Watch the airport this flight is heading for: runways, arrivals and landings (A)";
    b.addEventListener("click", function () { open(); });
    var bar = document.getElementById("sgCam"), gear = document.getElementById("setBtn");
    if (bar) { var nx = bar.querySelector(".sg-cam-atc"); bar.insertBefore(b, nx || null); }
    else if (gear) gear.parentNode.insertBefore(b, gear);
  }
  function boot() {
    button();
    addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (e.key === "Escape" && window.TBAirport.isOpen()) { e.stopPropagation(); close(); }
      else if ((e.key === "a" || e.key === "A") && !window.TBAirport.isOpen()) open();
    }, true);
    var q = null; try { q = new URLSearchParams(location.search).get("airport"); } catch (e) {}
    if (q) open(q);
  }
  // after sky-glass.js has built the camera bar
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { setTimeout(boot, 0); });
  else setTimeout(boot, 0);
})();
