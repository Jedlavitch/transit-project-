/* Sky — airport cameras with the planes marked (styles in sky-cams.css).

   A live airport camera, with every aircraft in its view marked from the
   board's own ADS-B feed. Only fixed cameras qualify: the markers come from
   projecting each plane's position through the camera's known position, aim
   and zoom, so a camera that pans or zooms on its own (most plane-spotting
   streams do) would leave every marker in the wrong place within a minute.

   THE MARKERS SIT BESIDE THE VIDEO, NEVER ON IT. YouTube's embedding rules:
   "You must not display overlays, frames, or other visual elements in front
   of any part of a YouTube embedded player." So each plane gets a tick on the
   rail under the video (where it is across the picture) and one on the rail
   to its right (how high), with its callsign and altitude — two pointers that
   meet at the plane. The player itself is untouched and plays as YouTube
   serves it, with its own controls, branding and the owner's credit.

   TIME: a live stream runs some seconds behind real life, so each plane is
   drawn where it WAS that many seconds ago, interpolated between recorded
   fixes. The delay is measured per camera (its burned-in clock against ours)
   and can be nudged on screen, because YouTube's own buffering varies.

   PROJECTION: pinhole camera at (lat, lon, height above sea level), aimed at
   `yaw` degrees true and `pitch` degrees up, `hfov` degrees across a 16:9
   frame, no roll. Solved from planes seen in the frame against their ADS-B
   positions at the same moment (see the calibration note on each camera). */
(function () {
  "use strict";

  var CAMS = [{
    id: "kmdw-streamtime",
    icao: "KMDW",
    title: "Chicago Midway · runways 31",
    yt: "67BCsiW-1Io",
    owner: "StreamTime Live",
    ownerUrl: "https://www.youtube.com/@StreamTimeLive",
    // from the stream's own description: "Coordinates: 41.77844250226028, -87.74277810405209"
    lat: 41.778443, lon: -87.742778,
    hM: 199,          // ~615 ft ground + a rooftop mount, metres above sea level
    yaw: 321.3, pitch: 2.4, hfov: 22.0,
    /* Measured 2026-11-22: the burned-in clock reads 28.4 s behind ours. */
    delay: 28,
    /* NOT YET CALIBRATED. A night attempt failed: aircraft are faint points
       of light and the feed only refreshes every ~30 s, so lights could not
       be matched to planes with confidence. The aim above is a guess from
       the camera's own pan/zoom readout, and the camera also switches
       between a few presets. Until a daylight calibration confirms the aim
       for each preset, no marks are drawn (wrong marks are worse than none):
       the view shows the video and the traffic around the camera instead. */
    calibrated: false
  },
  /* TRACKING cameras: pan-tilt-zoom cameras that follow planes by themselves
     (driven by ADS-B) and label them in their own picture. Our marks can't
     follow a moving camera and aren't needed, so these show the video with
     the traffic around the airport listed below. Checked live and
     embeddable 2026-11-22; a stream that restarts gets a new video id, so
     an id here can go stale. */
  { id: "klga-fr24", icao: "KLGA", title: "LaGuardia \u00b7 runways 13/31 and the skyline", yt: "T_QsY01tIK0", mode: "tracking",
    owner: "Flightradar24", ownerUrl: "https://www.youtube.com/@Flightradar24DotCom",
    about: "Follows each plane automatically and labels it in the picture (CamStreamer PlaneTracker with Flightradar24 data)." },
  { id: "ksfo-luftra", icao: "KSFO", title: "SFO \u00b7 plane spotting with ATC", yt: "sTVM6Sc80X0", mode: "tracking",
    owner: "Luftra Aviation", ownerUrl: "https://www.youtube.com/@LuftraAI",
    about: "Tracks individual planes and adds its own flight data and tower audio." },
  { id: "klax-avl-24", icao: "KLAX", title: "LAX \u00b7 runways 24L/24R (north)", short: "24L/24R", yt: "n4I0d44oBEs", mode: "tracking",
    owner: "AirlineVideosLive+", ownerUrl: "https://www.youtube.com/@AirlineVideosLivePlus",
    about: "From the roof of the H Hotel; the camera zooms in on planes as they land and take off." },
  { id: "klax-avl-25", icao: "KLAX", title: "LAX \u00b7 runways 25L/25R (south)", short: "25L/25R", yt: "KzsNnyN8D_Q", mode: "tracking",
    owner: "AirlineVideosLive+", ownerUrl: "https://www.youtube.com/@AirlineVideosLivePlus",
    about: "From the roof of the H Hotel; the camera zooms in on planes as they land and take off." }];
  window.TBCams = { forIcao: function (icao) { icao = String(icao || "").toUpperCase(); return CAMS.filter(function (c) { return c.icao === icao; }); } };

  var R = Math.PI / 180, FT = 0.3048, EARTH = 6371008;
  function $(s, el) { return (el || document).querySelector(s); }
  function esc(t) { return String(t == null ? "" : t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* Where a point lands in the frame: {x, y} as fractions (0..1, y down),
     or null if it is behind the camera. Earth curvature is included: at
     5 km it lowers a point by ~2 m, which at this zoom is a few pixels. */
  function project(cam, lat, lon, altM) {
    var dN = (lat - cam.lat) * R * EARTH, dE = (lon - cam.lon) * R * EARTH * Math.cos(cam.lat * R);
    var dist = Math.sqrt(dN * dN + dE * dE);
    var dU = altM - cam.hM - dist * dist / (2 * EARTH);
    var ps = cam.yaw * R, th = cam.pitch * R;
    var f = [Math.sin(ps) * Math.cos(th), Math.cos(ps) * Math.cos(th), Math.sin(th)];
    var r = [Math.cos(ps), -Math.sin(ps), 0];
    var u = [-Math.sin(ps) * Math.sin(th), -Math.cos(ps) * Math.sin(th), Math.cos(th)];
    var d = [dE, dN, dU];
    var z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    if (z <= 1) return null;
    var x = d[0] * r[0] + d[1] * r[1], y = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    var k = 0.5 / Math.tan(cam.hfov * R / 2);
    return { x: 0.5 + k * x / z, y: 0.5 - k * (16 / 9) * y / z, dist: dist };
  }
  window.TBCams.project = project;

  /* ---- the layer ------------------------------------------------------------ */
  var el = null, cam = null, ap = null, poll = 0, raf = 0, hist = {}, nudge = 0, lastDraw = 0;
  function loadNudge() { try { var v = parseFloat(localStorage.getItem("tb.camDelay." + cam.id)); return isFinite(v) ? v : 0; } catch (e) { return 0; } }
  function saveNudge() { try { localStorage.setItem("tb.camDelay." + cam.id, String(nudge)); } catch (e) {} }

  function build() {
    if (el) return;
    el = document.createElement("div");
    el.id = "sgCv";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Live airport camera");
    el.innerHTML =
      '<div class="cv-top">' +
        '<button type="button" class="cv-back">‹ Airport</button>' +
        '<div class="cv-title"><b></b><span></span></div>' +
        '<div class="cv-switch" role="group" aria-label="Cameras" hidden></div>' +
        '<div class="cv-delay" title="The stream runs behind real time. If the marks lead or trail the planes, nudge this.">' +
          '<button type="button" data-d="-1" aria-label="Marks earlier">−</button><span></span><button type="button" data-d="1" aria-label="Marks later">+</button></div>' +
      '</div>' +
      '<div class="cv-stage">' +
        '<div class="cv-player"><iframe allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin" title="Live airport camera"></iframe></div>' +
        '<div class="cv-rail cv-rail-r" aria-hidden="true"></div>' +
        '<div class="cv-rail cv-rail-b" aria-hidden="true"></div>' +
      '</div>' +
      '<div class="cv-foot"><ol class="cv-list"></ol>' +
        '<p class="cv-note">Video: <a target="_blank" rel="noopener"></a>, on YouTube. <span class="cv-cal"></span></p></div>';
    document.body.appendChild(el);
    $(".cv-back", el).addEventListener("click", close);
    $(".cv-switch", el).addEventListener("click", function (e) {
      var b = e.target.closest("button[data-id]"); if (!b) return;
      var c = CAMS.filter(function (x) { return x.id === b.getAttribute("data-id"); })[0]; if (c && c !== cam) open(c, ap);
    });
    $(".cv-delay", el).addEventListener("click", function (e) {
      var b = e.target.closest("button[data-d]"); if (!b) return;
      nudge = Math.round((nudge + +b.getAttribute("data-d")) * 10) / 10; saveNudge(); paintDelay();
    });
    addEventListener("resize", layout);
    addEventListener("keydown", function (e) { if (e.key === "Escape" && el.classList.contains("show")) { e.stopPropagation(); close(); } }, true);
  }
  function paintDelay() { $(".cv-delay span", el).textContent = (cam.delay + nudge).toFixed(0) + " s behind"; }
  /* The player as large as fits, 16:9, leaving room for the rails and list. */
  function layout() {
    if (!el || !el.classList.contains("show")) return;
    var top = $(".cv-top", el).getBoundingClientRect().bottom + 10;
    var rail = innerWidth < 700 ? 64 : 120, railB = innerWidth < 700 ? 50 : 62;
    if (cam && !cam.calibrated) { rail = 0; railB = 0; }     // no marks yet: the rails would only be empty space
    [].forEach.call(el.querySelectorAll(".cv-rail"), function (r) { r.hidden = !!(cam && !cam.calibrated); });
    var availW = innerWidth - rail - 24, availH = innerHeight - top - railB - (innerWidth < 700 ? 150 : 120);
    var w = Math.max(240, Math.min(availW, availH * 16 / 9)), h = w * 9 / 16;
    var st = $(".cv-stage", el);
    st.style.width = (w + rail) + "px"; st.style.height = (h + railB) + "px";
    st.style.setProperty("--pw", w + "px"); st.style.setProperty("--ph", h + "px");
    st.style.setProperty("--rw", rail + "px"); st.style.setProperty("--rh", railB + "px");
  }

  /* ---- positions, with history so the past can be drawn ------------------- */
  function feedBase() { try { return typeof adsbBase === "function" ? adsbBase() : ""; } catch (e) { return ""; } }
  function fetchOnce() {
    var b = feedBase(); if (!b || !cam) return;
    var want = cam;
    fetch(b + "/point/" + cam.lat.toFixed(4) + "/" + cam.lon.toFixed(4) + "/12", { cache: "no-store" })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (d) {
        if (want !== cam) return;
        var now = Date.now();
        (d.ac || []).forEach(function (a) {
          if (!a.hex || typeof a.lat !== "number") return;
          // seen_pos: seconds since this position was received, so the fix is dated correctly
          var t = now - (typeof a.seen_pos === "number" ? a.seen_pos * 1000 : 0);
          var h = hist[a.hex] || (hist[a.hex] = { fixes: [] });
          var last = h.fixes[h.fixes.length - 1];
          if (!last || last.lat !== a.lat || last.lon !== a.lon) {
            var ground = a.alt_baro === "ground";
            h.fixes.push({ t: t, lat: a.lat, lon: a.lon, alt: ground ? null : (typeof a.alt_baro === "number" ? a.alt_baro : a.alt_geom), ground: ground });
          }
          h.cs = (a.flight || "").trim() || a.r || a.hex; h.type = a.t || ""; h.vr = a.baro_rate || 0; h.gs = a.gs || 0; h.seen = now;
          while (h.fixes.length && now - h.fixes[0].t > 120000) h.fixes.shift();
        });
        Object.keys(hist).forEach(function (k) { if (now - hist[k].seen > 90000) delete hist[k]; });
      }).catch(function () {});
  }
  /* Where the plane was at time t: between the two fixes either side of it,
     or carried a little past the last one when the stream is barely behind. */
  function at(h, t) {
    var f = h.fixes; if (!f.length) return null;
    // the first half-minute after opening has no history that far back yet:
    // the list can use the earliest fix; marks (calibrated cameras) wait for real history
    if (t < f[0].t - 4000) return cam.calibrated ? null : { lat: f[0].lat, lon: f[0].lon, alt: f[0].alt, ground: f[0].ground };
    for (var i = f.length - 1; i > 0; i--) {
      if (f[i - 1].t <= t && t <= f[i].t) {
        var k = (t - f[i - 1].t) / Math.max(1, f[i].t - f[i - 1].t), a = f[i - 1], b = f[i];
        var alt = a.alt == null || b.alt == null ? (b.alt == null ? a.alt : b.alt) : a.alt + (b.alt - a.alt) * k;
        return { lat: a.lat + (b.lat - a.lat) * k, lon: a.lon + (b.lon - a.lon) * k, alt: alt, ground: a.ground && b.ground };
      }
    }
    var L = f[f.length - 1];
    if (t - L.t > 8000) return null;
    return { lat: L.lat, lon: L.lon, alt: L.alt, ground: L.ground };
  }
  function elevFt() { return ap && typeof ap.elev === "number" ? ap.elev : 620; }

  /* ---- drawing the rails -------------------------------------------------------- */
  function kind(h, p) {
    if (p.ground) return "ground";
    return h.vr < -250 ? "arr" : h.vr > 250 ? "dep" : "other";
  }
  function altLabel(p) {
    if (p.ground) return "ground";
    if (typeof p.alt !== "number") return "";
    return (Math.round(p.alt / 100) * 100).toLocaleString() + " ft";
  }
  function draw(now) {
    raf = requestAnimationFrame(draw);
    if (now - lastDraw < (document.documentElement.classList.contains("tb-lowfx") ? 200 : 80)) return;
    lastDraw = now;
    var t = Date.now() - (cam.delay + nudge) * 1000;
    var inView = [], near = [];
    Object.keys(hist).forEach(function (hex) {
      var h = hist[hex], p = at(h, t); if (!p) return;
      var altM = (p.ground || p.alt == null ? elevFt() + 10 : p.alt) * FT;
      var q = project(cam, p.lat, p.lon, altM);
      if (!q && !cam.calibrated) {      // behind the camera still counts as "around" it
        var dN = (p.lat - cam.lat) * R * EARTH, dE = (p.lon - cam.lon) * R * EARTH * Math.cos(cam.lat * R);
        q = { x: -1, y: -1, dist: Math.sqrt(dN * dN + dE * dE) };
      }
      var item = { hex: hex, h: h, p: p, q: q, k: kind(h, p) };
      if (q && q.x >= -0.02 && q.x <= 1.02 && q.y >= -0.05 && q.y <= 1.05) inView.push(item);
      else if (q && q.dist < 9000) near.push(item);
    });
    inView.sort(function (a, b) { return a.q.x - b.q.x; });
    var B = $(".cv-rail-b", el), Rr = $(".cv-rail-r", el);
    if (!cam.calibrated) {
      B.innerHTML = ""; Rr.innerHTML = "";
      /* Planes in the air first (what a runway camera is for), nearest first;
         parked ones only fill the list when nothing is flying. */
      var rank = function (it) { return it.k === "ground" ? 1 : 0; };
      var all = inView.concat(near).sort(function (a, b) { return rank(a) - rank(b) || (a.q ? a.q.dist : 1e9) - (b.q ? b.q.dist : 1e9); });
      var flying = all.filter(function (it) { return it.k !== "ground"; });
      all = (flying.length >= 3 ? flying : all).slice(0, 8);
      $(".cv-list", el).innerHTML = all.map(function (it) {
        return '<li class="cv-' + it.k + '"><b>' + esc(it.h.cs) + "</b><span>" + esc([it.h.type, altLabel(it.p), (it.q ? (it.q.dist / 1852).toFixed(1) + (cam.mode === "tracking" ? " nm from the airport" : " nm from the camera") : "")].filter(Boolean).join(" \u00b7 ")) + "</span></li>";
      }).join("") || '<li class="cv-none">No aircraft near ' + (cam.mode === "tracking" ? "the airport" : "the camera") + ' right now.</li>';
      return;
    }
    B.innerHTML = inView.map(function (it) {
      var x = Math.max(0, Math.min(1, it.q.x)) * 100;
      return '<span class="cv-tick cv-' + it.k + '" style="left:' + x.toFixed(2) + '%"><i></i><b>' + esc(it.h.cs) + "</b><em>" + esc(altLabel(it.p)) + "</em></span>";
    }).join("");
    Rr.innerHTML = inView.map(function (it) {
      var y = Math.max(0, Math.min(1, it.q.y)) * 100;
      return '<span class="cv-tick cv-' + it.k + '" style="top:' + y.toFixed(2) + '%"><i></i><b>' + esc(it.h.cs) + "</b></span>";
    }).join("");
    // what is in shot, and what is about to be
    var list = inView.map(function (it) { return { it: it, s: "in view" }; }).concat(near.filter(function (it) { return it.k !== "ground"; }).slice(0, 4).map(function (it) {
      return { it: it, s: (it.q && it.q.x < 0 ? "off left" : it.q && it.q.x > 1 ? "off right" : "nearby") };
    }));
    $(".cv-list", el).innerHTML = list.map(function (x) {
      var it = x.it;
      return '<li class="cv-' + it.k + '"><b>' + esc(it.h.cs) + "</b><span>" + esc([it.h.type, altLabel(it.p), (it.q ? (it.q.dist / 1852).toFixed(1) + " nm" : "")].filter(Boolean).join(" · ")) +
        "</span><em>" + esc(x.s) + "</em></li>";
    }).join("") || '<li class="cv-none">No aircraft in this camera\'s view right now.</li>';
  }

  /* ---- open / close ------------------------------------------------------------- */
  function open(c, airport) {
    build();
    ap = airport || ap || null;
    if (c.mode === "tracking") {
      // no fixed position to project from: list the traffic around the airport instead
      c.calibrated = false;
      if (ap && c.lat == null) { c.lat = ap.lat; c.lon = ap.lon; c.hM = (ap.elev || 0) * FT + 30; c.yaw = 0; c.pitch = 0; c.hfov = 60; c.delay = 20; }
    }
    cam = c; hist = {}; nudge = loadNudge();
    var sw = $(".cv-switch", el), all = window.TBCams.forIcao(c.icao);
    sw.hidden = all.length < 2;
    sw.innerHTML = all.map(function (x) { return '<button type="button" data-id="' + x.id + '" aria-pressed="' + (x === c) + '">' + esc(x.short || x.title) + "</button>"; }).join("");
    $(".cv-title b", el).textContent = c.icao.replace(/^K/, "");
    $(".cv-title span", el).textContent = c.title;
    var a = $(".cv-note a", el); a.textContent = c.owner; a.href = c.ownerUrl;
    var src = "https://www.youtube.com/embed/" + c.yt + "?autoplay=1&mute=1&playsinline=1&rel=0";
    var f = $("iframe", el); if (f.getAttribute("src") !== src) f.setAttribute("src", src);
    paintDelay();
    $(".cv-delay", el).hidden = !c.calibrated;
    $(".cv-cal", el).textContent = c.mode === "tracking"
      ? (c.about || "") + " The list below is the traffic around the airport, from this board\u2019s feed."
      : c.calibrated
      ? "Marks: this board\u2019s ADS-B feed, drawn where each plane was when the frame you are seeing was filmed. They sit beside the picture, never on it."
      : "Plane marks for this camera are coming once it has been calibrated in daylight; until then, the list shows the traffic around the camera.";
    el.classList.add("show");
    document.documentElement.classList.add("sg-cam-on");
    layout();
    clearInterval(poll); fetchOnce(); poll = setInterval(fetchOnce, 3000);
    cancelAnimationFrame(raf); raf = requestAnimationFrame(draw);
  }
  function close() {
    if (!el) return;
    el.classList.remove("show");
    document.documentElement.classList.remove("sg-cam-on");
    clearInterval(poll); cancelAnimationFrame(raf);
    $("iframe", el).setAttribute("src", "about:blank");     // stop the stream, not just hide it
    cam = null;
    try { var u = new URL(location.href); if (u.searchParams.has("cam")) { u.searchParams.delete("cam"); history.replaceState(null, "", u); } } catch (e) {}
  }
  window.TBCams.open = open;
  window.TBCams.close = close;
})();
