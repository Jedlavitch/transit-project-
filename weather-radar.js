/* weather-radar.js — rain on the map, and a warning before you walk to it.
   ---------------------------------------------------------------------------
   The commute card answers "when do I leave". This answers the other half of
   the same question: whether the walk it is counting down to is about to get
   wet. Both are about the trip you make on foot to the stop, which is the part
   of the journey none of the transit feeds know anything about.

   RainViewer, because it fits the project's one hard constraint (README: a page
   that costs nothing to run, forever). No key, no account, no rate limit worth
   the name, CORS open, worldwide coverage — so this works identically on the
   European boards as on the American ones, which rules out every national
   service. Two calls: one index of available frames, then plain tile URLs.

   Two things, one feed:
     · a translucent precipitation layer under the vehicles on the map;
     · a nowcast line — the forecast frames RainViewer publishes are sampled at
       your own location, so "rain in ~20 min" means over YOUR stop, not the
       city's centroid.

   No card of its own: it hangs off the map that already exists, and its one
   line of text goes in the map's caption strip. Every board's Settings gets a
   Rain radar on/off, defaulting OFF — an ambient board should not silently
   start pulling tiles nobody asked for. */
(function (root) {
  "use strict";

  var API = "https://api.rainviewer.com/public/weather-maps.json";
  var LS = { on: "tb.radar", };
  var TILE_OPTS = { size: 256, color: 4, smooth: 1, snow: 1 };  // color 4 = the "Universal Blue" ramp

  var idx = null;          // the frame index from the API
  var layer = null;        // the Leaflet layer currently on the map
  var timer = null;

  function on() { try { return localStorage.getItem(LS.on) === "1"; } catch (_) { return false; } }
  function setOn(v) { try { localStorage.setItem(LS.on, v ? "1" : "0"); } catch (_) {} }

  function boardState() {
    try { /* eslint-disable-next-line no-undef */
      return (typeof state !== "undefined" && state) ? state : (root.state || null);
    } catch (_) { return root.state || null; }
  }
  function map() { var st = boardState(); return st && st.map ? st.map : null; }
  function here() {
    var st = boardState();
    if (st && st.loc && isFinite(st.loc.lat)) return { lat: st.loc.lat, lon: st.loc.lon };
    return null;
  }

  async function fetchIndex() {
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, 9000);
    try {
      var r = await fetch(API, { signal: c.signal });
      if (!r.ok) throw new Error(r.status);
      idx = await r.json();
      return idx;
    } finally { clearTimeout(t); }
  }

  /* The newest PAST frame is "now". RainViewer's nowcast frames live in a
     separate array and are forecasts, so they must never be painted as if they
     were observed rain. */
  function nowFrame() {
    var p = idx && idx.radar && idx.radar.past;
    return (p && p.length) ? p[p.length - 1] : null;
  }
  function tileUrl(frame) {
    if (!idx || !frame) return null;
    return idx.host + frame.path + "/" + TILE_OPTS.size + "/{z}/{x}/{y}/" +
      TILE_OPTS.color + "/" + TILE_OPTS.smooth + "_" + TILE_OPTS.snow + ".png";
  }

  function removeLayer() {
    var m = map();
    if (layer && m && m.hasLayer(layer)) m.removeLayer(layer);
    layer = null;
  }

  function draw() {
    var m = map(), f = nowFrame();
    if (!m || !f || !root.L) return;
    var url = tileUrl(f);
    if (!url) return;
    var next = root.L.tileLayer(url, {
      opacity: 0.42,        // rain has to sit UNDER the information: legible as weather, never competing with a train
      zIndex: 210,          // above the basemap, below every vehicle marker
      crossOrigin: true,
attribution: "Rain © RainViewer",
    });
    next.addTo(m);
    /* Swap rather than remove-then-add: dropping the old layer first leaves a
       visible hole over the map for however long the new tiles take, which on a
       kiosk reads as the radar flickering every five minutes. */
    var old = layer;
    layer = next;
    var drop = function () { if (old && m.hasLayer(old)) m.removeLayer(old); };
    next.once("load", drop);
    setTimeout(drop, 4000);   // some tiles never fire load (all-clear frames are empty)
  }

  /* ---- the nowcast line ---------------------------------------------------
     RainViewer's own tiles are the only data here, so rather than pretend to
     read them we ask the far cheaper question its API can answer directly:
     which of the forecast frames has any precipitation over this exact point.
     One tiny tile fetch per frame, decoded to a pixel. */
  function lonLatToTile(lat, lon, z) {
    var n = Math.pow(2, z);
    var x = (lon + 180) / 360 * n;
    var latR = lat * Math.PI / 180;
    var y = (1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2 * n;
    return { z: z, x: Math.floor(x), y: Math.floor(y), px: Math.floor((x % 1) * 256), py: Math.floor((y % 1) * 256) };
  }

  var nowcastBusy = false;
  async function nowcast() {
    if (nowcastBusy) return;
    var loc = here();
    if (!loc || !idx || !idx.radar) return;
    nowcastBusy = true;
    try {
      var t = lonLatToTile(loc.lat, loc.lon, 7);   // z7: ~1 tile per 300km, plenty for "is it raining on me"
      var frameUrl = function (f) {
        return idx.host + f.path + "/256/" + t.z + "/" + t.x + "/" + t.y + "/" + TILE_OPTS.color + "/0_0.png";
      };

      /* Observed first. RainViewer only publishes nowcast frames when it has a
         forecast to make, and `nowcast` is routinely an EMPTY array in settled
         weather — so a version of this that only read the forecast would have
         been silent in the one situation it is easiest to check: rain falling
         on you right now. The current frame is always there. */
      var past = idx.radar.past || [];
      if (past.length) {
        /* eslint-disable-next-line no-await-in-loop */
        if (await tileHasRain(frameUrl(past[past.length - 1]), t.px, t.py)) {
          renderNowcast({ now: true });
          return;
        }
      }

      var frames = idx.radar.nowcast || [];
      var hit = null;
      for (var i = 0; i < frames.length; i++) {
        /* eslint-disable-next-line no-await-in-loop */
        if (await tileHasRain(frameUrl(frames[i]), t.px, t.py)) { hit = frames[i]; break; }
      }
      renderNowcast(hit);
    } catch (_) { /* a silent radar is fine; a broken board is not */ }
    finally { nowcastBusy = false; }
  }

  /* Sample a small neighbourhood, not the single pixel: at z7 one pixel is
     roughly a kilometre and a shower's edge landing exactly on it would flip
     the answer between refreshes. */
  function tileHasRain(url, px, py) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.crossOrigin = "anonymous";
      var done = false;
      var finish = function (v) { if (!done) { done = true; resolve(v); } };
      img.onerror = function () { finish(false); };
      img.onload = function () {
        try {
          var c = document.createElement("canvas");
          c.width = c.height = 256;
          var ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          var r = 3, x0 = Math.max(0, px - r), y0 = Math.max(0, py - r);
          var d = ctx.getImageData(x0, y0, Math.min(2 * r + 1, 256 - x0), Math.min(2 * r + 1, 256 - y0)).data;
          for (var i = 3; i < d.length; i += 4) if (d[i] > 40) return finish(true);  // any non-transparent pixel is precipitation
          finish(false);
        } catch (_) { finish(false); }   // a tainted canvas must not take the board down
      };
      img.src = url;
      setTimeout(function () { finish(false); }, 7000);
    });
  }

  /* A chip on the map itself, not in the legend strip under it: the legend is
     `display:none` by default on every board (`:root[data-legend="off"]`), so
     the first cut of this put an umbrella warning somewhere almost nobody would
     ever see it. Bottom-left keeps it clear of Leaflet's zoom control (top
     left) and the full-screen button (top right), and pointer-events:none
     means it can never swallow a drag on the map underneath. */
  function renderNowcast(frame) {
    var host = document.getElementById("map"); if (!host) return;
    var span = document.getElementById("tbRainSay");
    if (!span) {
      span = document.createElement("span");
      span.id = "tbRainSay";
      span.style.cssText = "position:absolute;left:10px;bottom:10px;z-index:900;pointer-events:none;" +
        "font:700 11px/1.5 var(--mono,ui-monospace,monospace);letter-spacing:.04em;" +
        "background:rgba(9,13,24,.88);border-radius:6px;padding:3px 8px;" +
        "box-shadow:0 1px 4px rgba(0,0,0,.5)";
      if (getComputedStyle(host).position === "static") host.style.position = "relative";
      host.appendChild(span);
    }
    // The chip is its own background, so an empty message must not leave a
    // floating black nub on the map.
    span.style.display = "none";
    if (!on() || !frame) { span.textContent = ""; return; }
    span.style.display = "";
    span.style.color = "var(--warn-ink,#ffb454)";
    if (frame.now) { span.textContent = "☂ raining here now"; return; }
    var mins = Math.round((frame.time * 1000 - Date.now()) / 60000);
    span.textContent = mins <= 2 ? "☂ rain about to start" : "☂ rain in ~" + mins + " min";
  }

  /* ---- lifecycle ---------------------------------------------------------- */
  async function refresh() {
    if (!on()) return;
    try {
      await fetchIndex();
      draw();
      nowcast();
    } catch (_) {}
  }

  function enable(v) {
    setOn(v);
    if (v) {
      refresh();
      if (!timer) timer = setInterval(refresh, 300000);   // RainViewer publishes a new frame every ~10 min
    } else {
      removeLayer();
      if (timer) { clearInterval(timer); timer = null; }
      renderNowcast(null);
    }
    syncButtons();
  }

  function syncButtons() {
    var v = on() ? "on" : "off";
    document.querySelectorAll("#radarRow .theme-btn").forEach(function (b) {
      b.classList.toggle("active", b.dataset.radar === v);
    });
  }

  /* Settings row, injected rather than hand-added to twelve HTML files. Placed
     after the map-legend row because it is the same kind of setting: what the
     map draws. */
  function injectSetting() {
    if (document.getElementById("radarRow")) return;
    var legend = document.getElementById("legendRow");
    if (!legend || !legend.parentNode) return;
    var lbl = document.createElement("div");
    lbl.className = "accent-lbl";
    lbl.textContent = "Rain radar";
    var row = document.createElement("div");
    row.className = "theme-row";
    row.id = "radarRow";
    row.innerHTML = '<button type="button" class="theme-btn" data-radar="off">Off</button>' +
      '<button type="button" class="theme-btn" data-radar="on">On</button>';
    legend.parentNode.insertBefore(lbl, legend.nextSibling);
    legend.parentNode.insertBefore(row, lbl.nextSibling);
    row.querySelectorAll(".theme-btn").forEach(function (b) {
      b.onclick = function () { enable(b.dataset.radar === "on"); };
    });
    syncButtons();
  }

  function boot() {
    injectSetting();
    /* The map is built inside the board's own boot(), which may not have run
       yet. Wait for it rather than racing it — bounded, so a board with no map
       at all (the flip board) gives up instead of polling forever. */
    var tries = 0;
    var wait = setInterval(function () {
      if (map() || ++tries > 40) {
        clearInterval(wait);
        if (map() && on()) enable(true);
      }
    }, 250);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  root.TBRadar = { enable: enable, refresh: refresh, on: on, nowcast: nowcast };
})(typeof window !== "undefined" ? window : this);
