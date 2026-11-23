/* Sky behaviour (styles in sky-glass.css).

   Two layers. The FEATURES run in every Sky — Glass and the original
   starfield one alike: a draggable, zoomable map that waits 30 s after you
   touch it, the "Following / Watching" chip with its way back, Esc, and the
   Share flight button. The GLASS LOOK runs only when night.html's pre-paint
   check set data-sky-glass (board style Glass, the default):

   1. Moves the live map out to <body> as the full-screen backdrop. The flight
      panel animates with a transform on every change of subject, and a
      transformed ancestor would turn a position:fixed map into one that slides
      and blurs with it. The element moves before Leaflet is ever built on it
      (night.html builds the map on the first subject), so nothing re-parents
      a live map.
   2. Frames the route around the overlay: fits are padded by the header, the
      flight panel and the footer, so the plane and its endpoints land in the
      clear part of the screen instead of behind the text.
   3. Idle fade for the controls, and "Hide info" / H for a bare map.
   4. Follow camera (C): the map zooms in on the plane and flies with it,
      gliding between the 12 s position fixes by dead reckoning on its ground
      speed and track. Wheel/pinch zoom keeps following at the new zoom; a
      drag pauses it for 30 s (or until Re-centre). Next plane (N) hops
      through everything in range. Dark map (D) swaps the basemap.

   And in both Skys, the view switch: Glass <-> the original starfield,
   remembered as nightmode.view and read by night.html before first paint. */
(function () {
  "use strict";
  var root = document.documentElement;
  var glass = root.hasAttribute("data-sky-glass");

  function $(s) { return document.querySelector(s); }

  /* 1 — the map becomes the background */
  var mapEl = document.getElementById("miniMap");
  if (glass && mapEl && mapEl.parentNode !== document.body) document.body.insertBefore(mapEl, document.body.firstChild);

  /* 2 — fit around the overlay. `miniMap` is a top-level `let` in night.html:
     a lexical global, reachable by name from here but not as window.miniMap. */
  function overlayPadding() {
    var W = innerWidth, H = innerHeight;
    var head = $("header"), foot = $("footer"), txt = $("#flight .txt"), side = $(".side");
    var top = head ? head.getBoundingClientRect().bottom : 0;
    var bottom = foot ? H - foot.getBoundingClientRect().top : 0;
    var left = 0, right = 0;
    var flight = $("#flight");
    var shown = flight && flight.offsetParent !== null && !root.classList.contains("sg-bare");
    if (shown && txt) {
      var t = txt.getBoundingClientRect();
      /* The card sits bottom-left. On a wide screen it is a column to clear
         sideways; when it takes most of the width, clear it from below. */
      if (t.width < W * 0.5) left = t.right;
      else bottom = Math.max(bottom, H - t.top);
    }
    if (shown && side && side.offsetParent !== null) {
      var s = side.getBoundingClientRect();
      if (s.width && s.width < W * 0.6 && s.left > W * 0.4) right = W - s.left;
      else if (s.height) top = Math.max(top, s.bottom);
    }
    var cap = function (v, max) { return Math.max(24, Math.min(v + 24, max)); };
    return {
      paddingTopLeft: [cap(left, W * 0.62), cap(top, H * 0.6)],
      paddingBottomRight: [cap(right, W * 0.45), cap(bottom, H * 0.3)]
    };
  }
  var patched = false, userAt = 0;
  function userHolding() { return Date.now() - userAt < 30000; }
  function patchMap() {
    var m = null;
    try { m = typeof miniMap !== "undefined" ? miniMap : null; } catch (e) {}
    if (!m || patched) return !!m;
    patched = true;
    /* A live map, not a picture: drag, wheel, pinch and double-click all
       work, with zoom buttons in the corner. Once you touch it the page stops
       re-framing for 30 s, so it doesn't snatch the view back mid-look. */
    try {
      m.dragging.enable(); m.scrollWheelZoom.enable(); m.touchZoom.enable();
      m.doubleClickZoom.enable(); m.boxZoom.enable(); m.keyboard.enable();
      L.control.zoom({ position: glass ? "topright" : "topleft" }).addTo(m);
    } catch (e) {}
    var c = m.getContainer();
    var labels = function () { c.classList.toggle("sg-zoomed-out", m.getZoom() < 8); };
    m.on("zoomend", labels); labels();
    /* When the 30 s hold runs out, go back to framing the flight —
       otherwise the view stays wherever you left it until the next subject. */
    var resume = 0;
    ["mousedown", "wheel", "touchstart", "dblclick"].forEach(function (t) {
      c.addEventListener(t, function () {
        if (cam.on) return;               // following: zoom freely; only a drag pauses (below)
        userAt = Date.now();
        clearTimeout(resume);
        resume = setTimeout(function () { userAt = 0; refit(); }, 30500);
      }, { passive: true });
    });
    var pan = m.panTo;
    m.panTo = function () { if (userHolding() || camOn()) return this; return pan.apply(this, arguments); };
    var fit = m.fitBounds;
    m.fitBounds = function (bounds, opts) {
      if (userHolding() || camOn()) return this;
      if (!glass) return fit.apply(this, arguments);       // the original Sky's card map frames itself
      var o = {}, k;
      for (k in (opts || {})) o[k] = opts[k];
      delete o.padding;
      var p = overlayPadding();
      o.paddingTopLeft = p.paddingTopLeft; o.paddingBottomRight = p.paddingBottomRight;
      return fit.call(this, bounds, o);
    };
    // The map is a backdrop now; the plane should not sit under the panel
    // when there's no route to fit either, so centre the clear area on it.
    var setView = m.setView;
    m.setView = function (center, zoom, opts) {
      /* Not blocked by the camera: Leaflet's own wheel and pinch zoom go
         through setView, so blocking it here froze the zoom while following.
         The page's own re-framing is stopped at applyMiniFit instead (below). */
      if (userHolding() && !cam.on) return this;
      var r = setView.apply(this, arguments);
      if (!glass) return r;
      try {
        var p = overlayPadding(), dx = (p.paddingTopLeft[0] - p.paddingBottomRight[0]) / 2,
            dy = (p.paddingTopLeft[1] - p.paddingBottomRight[1]) / 2;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.panBy([-dx, -dy], { animate: false });
      } catch (e) {}
      return r;
    };
    m.on("dragstart", function () {
      if (!cam.on) return;
      userAt = Date.now(); paintCam();
      clearTimeout(resume);
      resume = setTimeout(function () { userAt = 0; paintCam(); }, 30500);
    });
    m.on("zoomend", function () {
      if (cam.on && !cam.entering) { cam.zoom = m.getZoom(); try { localStorage.setItem("nightmode.followZoom", String(cam.zoom)); } catch (e) {} }
    });
    rawSetView = function (c, z) { return setView.call(m, c, z, { animate: false }); };
    /* night.html re-frames through applyMiniFit (a global function, so this
       replaces it for its own callers too). While following, it would yank
       the zoom back to the route, so it waits. */
    try {
      var amf = window.applyMiniFit;
      if (typeof amf === "function") window.applyMiniFit = function () { if (camOn()) return; return amf.apply(this, arguments); };
    } catch (e) {}
    if (cam.on) startCam();
    refit();
    return true;
  }
  function refit() {
    try { if (typeof applyMiniFit === "function") applyMiniFit(); } catch (e) {}
  }
  var tries = 0, poll = setInterval(function () { if (patchMap() || ++tries > 200) clearInterval(poll); }, 300);
  var fitTimer = 0;
  function headEdge() {
    if (!glass) return;
    var h = $("header");
    if (h) root.style.setProperty("--sg-head", Math.round(h.getBoundingClientRect().bottom) + "px");
  }
  headEdge();
  function queueRefit() { headEdge(); clearTimeout(fitTimer); fitTimer = setTimeout(function () {
    try { if (typeof miniMap !== "undefined" && miniMap) miniMap.invalidateSize(); } catch (e) {}
    refit();
  }, 200); }
  addEventListener("resize", queueRefit);
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(queueRefit);
    ["#flight .txt", ".side", "header"].forEach(function (s) { var el = $(s); if (el) ro.observe(el); });
  }

  /* 4 — the Follow camera (Glass). */
  var rawSetView = null;
  var cam = { on: false, zoom: 11, fix: null, fixAt: 0, from: null, blendAt: 0, shown: null, id: null,
              off: [0, 0], offAt: 0, last: 0, entering: false };
  try {
    cam.on = glass && localStorage.getItem("nightmode.follow") === "1";
    var fz = parseFloat(localStorage.getItem("nightmode.followZoom"));
    if (fz >= 3 && fz <= 18) cam.zoom = fz;
  } catch (e) {}
  function getMap() { try { return typeof miniMap !== "undefined" ? miniMap : null; } catch (e) { return null; } }
  function subject() { var s = window.__lastSubject; return s && s.posLL ? s : null; }
  function camOn() { return cam.on && glass && !!subject(); }
  /* Where the plane would be now, from the last fix, its ground speed and its
     track. Capped at 40 s past the fix: if the feed stalls, the plane stops
     rather than flying on into fiction. */
  function predicted(now) {
    var f = cam.fix;
    if (!f || !(f.gs > 30) || typeof f.trk !== "number") return { lat: f.lat, lon: f.lon };
    var h = Math.min(now - cam.fixAt, 40000) / 3600000, d = f.gs * h, r = f.trk * Math.PI / 180;
    var lat = f.lat + d * Math.cos(r) / 60;
    return { lat: lat, lon: f.lon + d * Math.sin(r) / (60 * Math.cos(f.lat * Math.PI / 180)) };
  }
  // A slow box (an Echo, a TV) gets 8 frames a second; anything else 30.
  var FRAME_MS = root.classList.contains("tb-lowfx") ? 125 : 33;
  function frame(now) {
    if (!cam.on) return;
    requestAnimationFrame(frame);
    if (now - cam.last < FRAME_MS) return;
    cam.last = now;
    var m = getMap(), s = subject();
    if (!m || !s) return;
    if (s.id !== cam.id) { cam.id = s.id; cam.fix = null; cam.shown = null; cam.from = null; recentre(); }
    var ll = s.posLL;
    if (!cam.fix || ll.lat !== cam.fix.lat || ll.lon !== cam.fix.lon) {
      cam.from = cam.shown;                        // glide from where it is drawn, not jump to the fix
      cam.fix = { lat: ll.lat, lon: ll.lon, gs: s.gsKt, trk: s.trkDeg };
      cam.fixAt = now; cam.blendAt = now;
      paintReadout(s);
    }
    var p = predicted(now);
    if (cam.from) {
      var k = Math.min(1, (now - cam.blendAt) / 1500); k = k * (2 - k);
      p = { lat: cam.from.lat + (p.lat - cam.from.lat) * k, lon: cam.from.lon + (p.lon - cam.from.lon) * k };
      if (k >= 1) cam.from = null;
    }
    cam.shown = p;
    try {
      if (typeof miniVeh !== "undefined" && miniVeh) {
        miniVeh.setLatLng([p.lat, p.lon]);
        var el = miniVeh.getElement && miniVeh.getElement();
        var svg = el && el.querySelector("svg");
        if (svg && typeof cam.fix.trk === "number" && s.id.charAt(0) === "p") svg.style.transform = "rotate(" + cam.fix.trk + "deg)";
      }
    } catch (e) {}
    if (userHolding() || m._animatingZoom || (m.touchZoom && m.touchZoom._zooming)) return;
    if (now - cam.offAt > 1000) {
      var o = overlayPadding();
      cam.off = [(o.paddingTopLeft[0] - o.paddingBottomRight[0]) / 2, (o.paddingTopLeft[1] - o.paddingBottomRight[1]) / 2];
      cam.offAt = now;
    }
    /* panBy, not setView: it only slides the map pane, so 80 plane markers
       are not re-laid out thirty times a second. */
    var z = m.getZoom(), want = m.project([p.lat, p.lon], z).subtract(cam.off),
        have = m.project(m.getCenter(), z), d = want.subtract(have);
    if (Math.abs(d.x) + Math.abs(d.y) > 0.3) m.panBy(d, { animate: false });
  }
  function recentre() {
    var m = getMap(), s = subject();
    if (!m || !s || !rawSetView) return;
    var p = cam.shown || s.posLL;
    cam.entering = true;
    rawSetView([p.lat, p.lon], cam.zoom);
    cam.entering = false;
    cam.offAt = 0;
  }
  /* Following: wheel and pinch zoom about the centre, where the plane is,
     not about the cursor. Leaflet reads these options at zoom time. */
  function zoomAbout(centre) {
    var m = getMap(); if (!m) return;
    m.options.scrollWheelZoom = centre ? "center" : true;
    m.options.touchZoom = centre ? "center" : true;
  }
  function startCam() { zoomAbout(true); userAt = 0; recentre(); cam.last = 0; requestAnimationFrame(frame); paintCam(); }
  function setFollow(on) {
    if (!glass) return;
    cam.on = on;
    try { localStorage.setItem("nightmode.follow", on ? "1" : "0"); } catch (e) {}
    zoomAbout(on);
    root.classList.toggle("sg-following", on);
    if (on) startCam();
    else {
      paintCam();
      try {
        var mv = typeof miniVeh !== "undefined" && miniVeh, s = subject();
        if (mv && s) mv.setLatLng([s.posLL.lat, s.posLL.lon]);
      } catch (e) {}
      cam.shown = null; refit();
    }
  }
  function nextPlane() {
    var s = window.__lastSubject;
    var fl = (s && s.fleet || []).filter(function (v) { return v.hex && v.ll; })
      .sort(function (a, b) { return (a.nm || 0) - (b.nm || 0); });
    if (!fl.length) { toast("No other planes in range right now."); return; }
    var i = -1;
    for (var j = 0; j < fl.length; j++) if (s && fl[j].hex === s.hex) { i = j; break; }
    var n = fl[(i + 1) % fl.length];
    userAt = 0;
    try { if (typeof pinPlane === "function") pinPlane(n.hex, n.ll); } catch (e) {}
  }
  /* The camera bar: Follow, Next plane, and while following a live readout
     plus Re-centre when a drag has paused it. Bottom right, over the map. */
  var camBar = null;
  function fmt(n) { return Math.round(n).toLocaleString(); }
  function paintReadout(s) {
    var r = camBar && camBar.querySelector(".sg-cam-read");
    if (!r) return;
    var bits = [];
    if (s.callsign) bits.push("<b>" + s.callsign.replace(/[<>&]/g, "") + "</b>");
    if (s.gsKt > 0) bits.push(fmt(s.gsKt) + " kt");
    if (typeof s.altFt === "number") bits.push(fmt(s.altFt) + " ft");
    if (typeof s.trkDeg === "number") bits.push("heading " + fmt(s.trkDeg) + "°");
    r.innerHTML = bits.join(" · ");
  }
  function paintCam() {
    if (!camBar) return;
    var f = camBar.querySelector(".sg-cam-follow"), rc = camBar.querySelector(".sg-cam-recentre");
    f.setAttribute("aria-pressed", String(cam.on));
    f.textContent = cam.on ? "Following" : "Follow";
    f.title = cam.on ? "Stop following and show the whole route (C)" : "Zoom in and fly with the plane (C)";
    rc.hidden = !(cam.on && userHolding());
    camBar.querySelector(".sg-cam-read").hidden = !cam.on;
    paintAtc();
    var s = subject(); if (s && cam.on) paintReadout(s);
  }
  /* Listen to ATC. LiveATC.net carries volunteer scanner feeds for most busy
     airports; this opens its page for the airport the plane is talking to,
     in a new tab, where its own player plays the tower / approach feeds.
     Opened rather than embedded: the feeds are LiveATC's, and they ask that
     other sites link to them rather than rebroadcast the audio.
     Which airport: the destination once the plane is coming down (or within
     60 nm of it), the origin while it is climbing out (or within 40 nm),
     otherwise whichever end is nearer. No route known, no button. */
  function nmBetween(a, b) {
    var r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLo = (b.lon - a.lon) * r;
    var h = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 3440 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  function atcTarget(s) {
    if (!s || !s.id || s.id.charAt(0) !== "p") return null;
    var o = s.oIcao, d = s.dIcao, p = s.posLL, ph = (s.phase || "").toLowerCase();
    if (!o && !d) return nearestAtc(p);
    var dn = d && s.dLL ? nmBetween(p, s.dLL) : 1e9, on = o && s.oLL ? nmBetween(p, s.oLL) : 1e9;
    if (d && (/descen|approach|final|landing/.test(ph) || dn < 60)) return { icao: d, why: "arrival" };
    if (o && (/climb|depart|takeoff|take-off/.test(ph) || on < 40)) return { icao: o, why: "departure" };
    if (d && dn <= on) return { icao: d, why: "destination" };
    return o ? { icao: o, why: "origin" } : { icao: d, why: "destination" };
  }
  /* No route (the callsign lookup is often down or rate-limited): the
     nearest major airport to the plane within 40 nm, else the one nearest
     this screen. night.html's NEAR_AIRPORTS is IATA; LiveATC searches ICAO,
     which in the US is K + IATA and elsewhere has to be looked up. */
  var ICAO = { AMS:"EHAM", RTM:"EHRD", ZRH:"LSZH", BSL:"LFSB", CGN:"EDDK", DUS:"EDDL", FRA:"EDDF",
               STR:"EDDS", MUC:"EDDM", FCO:"LIRF", CIA:"LIRA", LHR:"EGLL", CDG:"LFPG" };
  function nearestAtc(p) {
    var list = null;
    try { list = typeof NEAR_AIRPORTS !== "undefined" ? NEAR_AIRPORTS : null; } catch (e) {}
    if (!list || !p) return null;
    function near(ll) {
      var best = null, bd = 1e9;
      for (var i = 0; i < list.length; i++) { var d = nmBetween(ll, { lat: list[i][2], lon: list[i][3] }); if (d < bd) { bd = d; best = list[i]; } }
      return best ? { ap: best, nm: bd } : null;
    }
    var n = near(p), why = "nearest airport";
    if (!n || n.nm > 40) {
      var here = null; try { here = typeof loc !== "undefined" ? loc : null; } catch (e) {}
      if (!here || typeof here.lat !== "number") return null;
      n = near(here); why = "your local airport";
      if (!n || n.nm > 60) return null;
    }
    var c = n.ap[0];
    return { icao: ICAO[c] || (/^[A-Z]{3}$/.test(c) ? "K" + c : c), why: why };
  }
  function paintAtc() {
    var a = camBar && camBar.querySelector(".sg-cam-atc");
    if (!a) return;
    var t = atcTarget(subject());
    a.hidden = !t;
    if (!t) return;
    var href = "https://www.liveatc.net/search/?icao=" + encodeURIComponent(t.icao);
    if (a.getAttribute("href") !== href) a.setAttribute("href", href);
    a.textContent = "ATC · " + t.icao;
    a.title = "Open LiveATC's live feeds for " + t.icao + " (" + t.why + ") in a new tab";
  }

  if (glass) {
    camBar = document.createElement("div");
    camBar.id = "sgCam";
    camBar.innerHTML = '<span class="sg-cam-read" hidden></span>' +
      '<button type="button" class="sg-cam-recentre" hidden>Re-centre</button>' +
      '<button type="button" class="sg-cam-follow" aria-pressed="false"></button>' +
      '<button type="button" class="sg-cam-next" title="Follow the next plane in range (N)">Next ›</button>' +
      '<a class="sg-cam-atc" target="_blank" rel="noopener" hidden></a>';
    document.body.appendChild(camBar);
    camBar.querySelector(".sg-cam-follow").addEventListener("click", function () { setFollow(!cam.on); });
    camBar.querySelector(".sg-cam-next").addEventListener("click", function () { if (!cam.on) setFollow(true); nextPlane(); });
    camBar.querySelector(".sg-cam-recentre").addEventListener("click", function () { userAt = 0; recentre(); paintCam(); });
    root.classList.toggle("sg-following", cam.on);
    paintCam();
    // The bar shows only while there is something to follow.
    setInterval(function () { camBar.classList.toggle("show", !!subject()); if (cam.on) paintCam(); else paintAtc(); }, 1000);
  }

  /* "Following a plane you picked" chip, with the way back to nearest.
     night.html sets .sky-pinned while a pick is the subject. */
  var chip = document.createElement("div");
  chip.id = "sgPinChip";
  chip.innerHTML = '<span>Following the plane you picked</span><button type="button">Back to nearest</button>';
  // Inside the card, as its top row, so it can never sit on top of the card.
  var cardEl = $("#flight .txt");
  if (cardEl) cardEl.insertBefore(chip, cardEl.firstChild); else document.body.appendChild(chip);
  chip.querySelector("button").addEventListener("click", function () {
    userAt = 0;
    try { if (typeof unpinPlane === "function") unpinPlane(); } catch (e) {}
  });
  addEventListener("keydown", function (e) {
    if (e.key === "Escape" && root.classList.contains("sky-pinned")) {
      userAt = 0; try { unpinPlane(); } catch (er) {}
    }
  });
  // A pick always re-frames, even right after you touched the map.
  document.addEventListener("click", function (e) {
    if (e.target.closest && e.target.closest(".sg-plane-wrap")) userAt = 0;
  }, true);

  /* 3a — idle fade (Glass) */
  var IDLE_MS = 3500, idleTimer = 0;
  function busy() {
    return ["#settings.show", "#fleetPanel.show", "#logPanel.show", "#sgMore.open"].some(function (s) { return !!$(s); }) ||
      (document.activeElement && document.activeElement.closest && !!document.activeElement.closest("header"));
  }
  function sleep() { if (!glass) return; if (busy()) { wake(); return; } root.classList.add("sg-idle"); }
  function wake() {
    root.classList.remove("sg-idle");
    clearTimeout(idleTimer); idleTimer = setTimeout(sleep, IDLE_MS);
  }
  ["pointermove", "mousemove", "pointerdown", "mousedown", "keydown", "touchstart", "wheel", "focusin"].forEach(function (t) {
    addEventListener(t, wake, { passive: true, capture: true });
  });
  wake();

  /* 3b — Hide info / H */
  var KEY = "nightmode.bare";
  function setBare(on) {
    root.classList.toggle("sg-bare", on);
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) {}
    var b = document.getElementById("sgHideBtn");
    if (b) {
      b.textContent = on ? "Show info" : "Hide info";
      b.setAttribute("aria-pressed", String(on));
      b.title = on ? "Show the flight details again (H)" : "Hide the flight details for a clear map (H)";
    }
    queueRefit();
  }
  var gear = document.getElementById("setBtn");
  if (glass && gear && !document.getElementById("sgHideBtn")) {
    var hb = document.createElement("button");
    hb.id = "sgHideBtn"; hb.type = "button";
    gear.parentNode.insertBefore(hb, gear);
    hb.addEventListener("click", function () { setBare(!root.classList.contains("sg-bare")); });
  }
  /* Share: a link that opens Sky following THIS flight, wherever the person
     you send it to is. It carries the callsign, the transponder code and
     where the plane is now, which is what lets their screen find it. */
  function shareLink() {
    var sub = window.__lastSubject;
    if (!sub || !sub.hex || !sub.posLL) return null;
    var u = new URL(location.origin + location.pathname);
    var city = new URLSearchParams(location.search).get("city");
    if (city) u.searchParams.set("city", city);
    if (sub.callsign) u.searchParams.set("flight", sub.callsign);
    u.searchParams.set("hex", sub.hex);
    u.searchParams.set("lat", sub.posLL.lat.toFixed(3));
    u.searchParams.set("lon", sub.posLL.lon.toFixed(3));
    // so the person you send it to doesn't need a feed of their own
    try { var f = typeof shareFeedParam === "function" ? shareFeedParam() : ""; if (f) u.searchParams.set("feed", f); } catch (e) {}
    return { url: u.toString(), title: (sub.callsign || "A flight") + " on Transit Project" };
  }
  function toast(t) {
    var el = document.getElementById("sgToast");
    if (!el) { el = document.createElement("div"); el.id = "sgToast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = t; el.classList.add("show");
    clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove("show"); }, 2600);
  }
  if (gear && !document.getElementById("sgShareBtn")) {
    var sb = document.createElement("button");
    sb.id = "sgShareBtn"; sb.type = "button"; sb.textContent = "Share flight";
    sb.title = "Send a link that opens Sky following this flight";
    gear.parentNode.insertBefore(sb, gear);
    sb.addEventListener("click", function () {
      var l = shareLink();
      // Nothing on screen to share (trains, the ISS, an empty sky): go to the page for sharing your own flight.
      if (!l) { var c = new URLSearchParams(location.search).get("city"); location.href = "share.html" + (c ? "?city=" + encodeURIComponent(c) : ""); return; }
      if (navigator.share) { navigator.share({ title: l.title, url: l.url }).catch(function () {}); return; }
      var done = function () { toast("Link copied — send it to anyone."); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(l.url).then(done, function () { prompt("Copy this link:", l.url); });
      else prompt("Copy this link:", l.url);
    });
  }

  /* The view switch, in both Skys: the page has to be rebuilt to change (the
     map is moved and styled before Leaflet is built on it), so it reloads. */
  if (gear && !document.getElementById("sgViewBtn")) {
    var vb = document.createElement("button");
    vb.id = "sgViewBtn"; vb.type = "button";
    vb.textContent = glass ? "Starfield view" : "Glass view";
    vb.title = glass ? "Switch Sky to the original starfield view" : "Switch Sky to the Glass view, with the live map";
    gear.parentNode.insertBefore(vb, gear);
    vb.addEventListener("click", function () {
      try { localStorage.setItem("nightmode.view", glass ? "starfield" : "glass"); } catch (e) {}
      location.reload();
    });
  }
  /* Dark map (Glass): swaps the basemap live, no reload. */
  function setDark(on) {
    root.toggleAttribute ? root.toggleAttribute("data-sky-dark", on) : (on ? root.setAttribute("data-sky-dark", "") : root.removeAttribute("data-sky-dark"));
    try { localStorage.setItem("nightmode.dark", on ? "1" : "0"); } catch (e) {}
    try { if (window.__skyBase) window.__skyBase.setTheme(on ? "dark" : "color"); } catch (e) {}
    var b = document.getElementById("sgDarkBtn");
    if (b) { b.textContent = on ? "Light map" : "Dark map"; b.setAttribute("aria-pressed", String(on)); }
  }
  if (glass && gear && !document.getElementById("sgDarkBtn")) {
    var db = document.createElement("button");
    db.id = "sgDarkBtn"; db.type = "button"; db.title = "Switch the map between light and dark (D)";
    gear.parentNode.insertBefore(db, gear);
    db.addEventListener("click", function () { setDark(!root.hasAttribute("data-sky-dark")); });
    setDark(root.hasAttribute("data-sky-dark"));
  }

  /* The header, organised (Glass): logo and title, then just "‹ board",
     More and Settings, then the clock. Everything else moves into the More
     menu — the same elements, moved rather than copied, so their handlers
     and keyboard shortcuts keep working. Close up goes: Follow does it. */
  if (glass && gear && !document.getElementById("sgMore")) {
    var more = document.createElement("div");
    more.id = "sgMore";
    more.innerHTML = '<button type="button" id="sgMoreBtn" aria-haspopup="menu" aria-expanded="false" title="More controls">More</button><div id="sgMenu" role="menu" hidden></div>';
    gear.parentNode.insertBefore(more, gear);
    var menu = more.querySelector("#sgMenu"), mb = more.querySelector("#sgMoreBtn");
    /* Grouped: this flight · how it looks · elsewhere. Labels made
       consistent here ("tour ›" is a header link's wording, not a menu's). */
    var groups = [["sgShareBtn", "sgHideBtn"], ["sgViewBtn", "sgDarkBtn"], ["logBtn", "tourBtn", "fsBtn"]];
    var names = { logBtn: "Spotter\u2019s log", tourBtn: "Grand Tour", fsBtn: "Full screen" };
    groups.forEach(function (g, gi) {
      if (gi) { var hr = document.createElement("div"); hr.className = "sg-menu-sep"; hr.setAttribute("role", "separator"); menu.appendChild(hr); }
      g.forEach(function (id) {
        var b = document.getElementById(id); if (!b) return;
        b.setAttribute("role", "menuitem");
        if (names[id]) { b.textContent = names[id]; b.setAttribute("aria-label", names[id]); }
        menu.appendChild(b);
      });
    });
    /* ‹ Board, More and Settings as one joined control. */
    var acts = document.createElement("div");
    acts.id = "sgActs";
    var board = document.getElementById("boardBtn");
    gear.parentNode.insertBefore(acts, gear);
    if (board) { board.textContent = "\u2039 Board"; acts.appendChild(board); }
    acts.appendChild(more); acts.appendChild(gear);
    var setMenu = function (open) { menu.hidden = !open; mb.setAttribute("aria-expanded", String(open)); more.classList.toggle("open", open); root.classList.toggle("sg-menu-open", open); };
    mb.addEventListener("click", function (e) { e.stopPropagation(); setMenu(menu.hidden); });
    menu.addEventListener("click", function (e) { if (e.target.closest("[role=menuitem]")) setTimeout(function () { setMenu(false); }, 0); });
    document.addEventListener("click", function (e) { if (!more.contains(e.target)) setMenu(false); });
    addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) setMenu(false); });
    try { if (typeof miniZoomMode !== "undefined" && miniZoomMode === "close" && typeof setMiniZoomMode === "function") setTimeout(function () { setMiniZoomMode("route"); }, 0); } catch (e) {}
  }

  var bare = false;
  try { bare = glass && localStorage.getItem(KEY) === "1"; } catch (e) {}
  if (glass) setBare(bare);
  addEventListener("keydown", function (e) {
    if (!glass || e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    var k = (e.key || "").toLowerCase();
    if (k === "h") setBare(!root.classList.contains("sg-bare"));
    else if (k === "c") setFollow(!cam.on);
    else if (k === "n") { if (!cam.on) setFollow(true); nextPlane(); }
    else if (k === "d") setDark(!root.hasAttribute("data-sky-dark"));
  });
})();
