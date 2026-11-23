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
        '<div class="ap-status" role="status"></div>' +
        '<section class="ap-landed" hidden><h3>Just happened</h3><ol></ol></section>' +
        '<section class="ap-sec-arr"><h3>Arriving <span class="n"></span></h3><ol></ol><p class="ap-empty">Nothing on approach right now.</p></section>' +
        '<section class="ap-sec-dep"><h3>Departing <span class="n"></span></h3><ol></ol><p class="ap-empty">No departures climbing out right now.</p></section>' +
        '<p class="ap-gnd"></p>' +
        '<p class="ap-note">Runways are inferred from each plane\'s track and position. Positions glide between 8-second fixes.</p>' +
      '</aside>';
    document.body.appendChild(el);
    $(".ap-back", el).addEventListener("click", close);
    $(".ap-pick", el).addEventListener("change", function () { var a = find(this.value); if (a) show(a); });
    el.addEventListener("click", function (e) {
      var li = e.target.closest && e.target.closest("li[data-hex]");
      if (li) focus(li.getAttribute("data-hex"));
    });
    map = L.map("sgApMap", { zoomControl: false, attributionControl: true, fadeAnimation: false, worldCopyJump: true });
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    map.attributionControl.setPrefix(false);
    map.attributionControl.addAttribution("Runways: OurAirports");
    try { base = TBBasemap.add(map, dark() ? "dark" : "color", { maxZoom: 19 }); } catch (e) {}
    rwyLayer = L.layerGroup().addTo(map);
    pathLayer = L.layerGroup().addTo(map);
    trailLayer = L.layerGroup().addTo(map);
    planeLayer = L.layerGroup().addTo(map);
    map.on("zoomend", function () { el.classList.toggle("ap-far", map.getZoom() < 10); });
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
        if (!firstFix && o.p.kind === "arr" && p.kind === "ground" && p.d < 3) note("landed", p, o.p.rwy);
        if (!firstFix && o.p.ground && !p.ground && p.d < 4) note("took off", p, p.rwy);
        if (p.lat !== o.fix.lat || p.lon !== o.fix.lon) { o.from = o.shown; o.blendAt = now; o.fix = p; o.fixAt = now; }
        o.p = p;
      }
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
    status(all.length ? "" : "No aircraft within 30 nm of " + ap.iata + " right now.");
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
    $(".ap-code", el).textContent = a.iata;
    $(".ap-name", el).textContent = a.name;
    $(".ap-rwy", el).textContent = "";
    fillPicker();
    drawRunways(); pathLayer.clearLayers();
    status("Looking for aircraft around " + a.iata + "…");
    map.invalidateSize();
    map.setView([a.lat, a.lon], 11, { animate: false });
    setUrl(a.icao);
    clearInterval(poll); fetchOnce(); poll = setInterval(fetchOnce, 8000);
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
    b.type = "button"; b.id = "sgApBtn"; b.textContent = "Airport view";
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
