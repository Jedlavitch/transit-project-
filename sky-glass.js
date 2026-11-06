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
   3. Idle fade for the controls, and "Hide info" / H for a bare map. */
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
        userAt = Date.now();
        clearTimeout(resume);
        resume = setTimeout(function () { userAt = 0; refit(); }, 30500);
      }, { passive: true });
    });
    var pan = m.panTo;
    m.panTo = function () { if (userHolding()) return this; return pan.apply(this, arguments); };
    var fit = m.fitBounds;
    m.fitBounds = function (bounds, opts) {
      if (userHolding()) return this;
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
      if (userHolding()) return this;
      var r = setView.apply(this, arguments);
      if (!glass) return r;
      try {
        var p = overlayPadding(), dx = (p.paddingTopLeft[0] - p.paddingBottomRight[0]) / 2,
            dy = (p.paddingTopLeft[1] - p.paddingBottomRight[1]) / 2;
        if (Math.abs(dx) + Math.abs(dy) > 4) this.panBy([-dx, -dy], { animate: false });
      } catch (e) {}
      return r;
    };
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
    return ["#settings.show", "#fleetPanel.show", "#logPanel.show"].some(function (s) { return !!$(s); }) ||
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

  var bare = false;
  try { bare = glass && localStorage.getItem(KEY) === "1"; } catch (e) {}
  if (glass) setBare(bare);
  addEventListener("keydown", function (e) {
    if (!glass) return;
    if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "h" && e.key !== "H")) return;
    var t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    setBare(!root.classList.contains("sg-bare"));
  });
})();
