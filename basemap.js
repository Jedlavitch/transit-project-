/* basemap.js — the one place that knows where map tiles come from.

   Until this file existed, every board pasted the same two cartocdn.com URLs
   into its own inline <script>. In September 2026 CARTO began requiring an API
   key for its raster (PNG) basemaps and started stamping unauthenticated tiles
   with a diagonal "API KEY REQUIRED / carto.com/basemaps/apikey" watermark, so
   all fifteen maps in this project broke in the same instant and each needed
   the same edit. Hence one module: the next provider that changes its terms
   costs one line rather than fifteen.

   The replacement is Esri's Canvas basemaps on services.arcgisonline.com. They
   need no key and no sign-up, and they send Access-Control-Allow-Origin: *.
   Taking CARTO's free key instead would have kept the old look for nothing,
   but CARTO's own notice says its raster basemaps "are being retired" — which
   is the same break again, later, with a migration still to do.

   Two differences from CARTO worth knowing before editing this file:

   1. Esri splits a basemap in half. The Base layer carries roads, water and
      landuse but NO place names; the names live in a separate transparent
      Reference layer. So this attaches two tile layers where the boards used
      to hold one, which is why callers now keep a handle instead of an
      L.TileLayer.

   2. Esri's tile path is {z}/{y}/{x}, not Leaflet's usual {z}/{x}/{y}, and the
      pyramid stops at zoom 16. maxNativeZoom lets Leaflet upscale the z16 tile
      past that instead of requesting z17-19 tiles that come back blank — the
      boards zoom to 19 when following a vehicle. */
(function (global) {
  "use strict";

  var ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/";
  var SETS = {
    light: {
      base: ESRI + "World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      ref:  ESRI + "World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
    },
    dark: {
      base: ESRI + "World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
      ref:  ESRI + "World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"
    }
  };

  var PANE = "tbBasemap";

  /* "day" is the only light board theme; "dark" and "black" both want the dark
     canvas, and are separated below by how hard the filter pushes it. */
  function setFor(theme) { return theme === "day" ? SETS.light : SETS.dark; }

  /* Esri's dark canvas renders as a mid grey where CARTO's Dark Matter was
     nearly black, so a filter takes it back to the tone the boards are built
     around.

     It is scoped to the basemap's own pane, NOT to .leaflet-tile-pane, because
     other tile layers share that pane and must come through untouched: the
     live precipitation radar on the night board's mini map (weather-radar.js)
     and the Grand Tour's night-lights overlay are both tile layers, and both
     carry meaning in their colour. Overlay panes are above this one anyway, so
     route lines and vehicle dots keep their exact hues either way.

     Injected here rather than in theme.css so the correction travels with the
     provider it corrects — whoever swaps the URLs next finds this in the same
     file, not in a 70KB stylesheet. */
  function injectStyle() {
    if (document.getElementById("tb-basemap-style")) return;
    var s = document.createElement("style");
    s.id = "tb-basemap-style";
    s.textContent =
      /* Brightness alone just greys everything out — the roads and place names
         go with the background. Pairing it with contrast pushes the landmass
         down toward black while pulling roads and labels back up, which is the
         shape of Dark Matter's palette rather than a dimmed version of Esri's. */
      ".tb-basemap-pane{filter:brightness(.6) contrast(1.4) saturate(.85)}" +
      /* Black is the dimmed wall-display theme — push it further down. */
      '[data-theme="black"] .tb-basemap-pane{filter:brightness(.45) contrast(1.5) saturate(.7)}' +
      /* Day is already a light map on a light board; leave it alone. */
      '[data-theme="day"] .tb-basemap-pane{filter:none}';
    (document.head || document.documentElement).appendChild(s);
  }

  /* Adds the basemap to `map` and returns a handle. Boards keep the handle
     where they used to keep the tile layer, and call setTheme() where they
     used to call setUrl(). */
  function add(map, theme, opts) {
    injectStyle();
    creditSource();

    var o = {}, k;
    for (k in (opts || {})) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    if (o.maxZoom == null) o.maxZoom = 19;
    /* Not overridable by accident: asking Esri for z17+ returns blank tiles,
       so a board passing maxZoom:19 must still stop fetching at 16. */
    o.maxNativeZoom = 16;

    /* Below Leaflet's own tilePane (200) so any tile overlay a board adds
       later still draws on top of the basemap, exactly as it did when the
       basemap was the first layer added. */
    if (!map.getPane(PANE)) {
      var p = map.createPane(PANE);
      p.style.zIndex = 190;
      p.classList.add("tb-basemap-pane");
    }
    o.pane = PANE;

    var set = setFor(theme);
    var base = global.L.tileLayer(set.base, o).addTo(map);
    var ref  = global.L.tileLayer(set.ref, o).addTo(map);
    base.setZIndex(1);
    ref.setZIndex(2);   // place names sit above the canvas they name

    return {
      base: base,
      ref: ref,
      setTheme: function (t) {
        var n = setFor(t);
        base.setUrl(n.base);
        ref.setUrl(n.ref);
      }
    };
  }

  /* Esri's terms for these basemaps require the source to stay visible, and the
     boards all run with attributionControl:false for a clean wall display — so
     the credit is drawn the same way config.js draws the aircraft one: a fixed
     element nothing else on the page owns, which no repaint can quietly erase.
     It sits one line above that credit rather than beside it, so the two stack
     instead of colliding on boards that show both. */
  function creditSource() {
    try {
      if (document.getElementById("tbMapCredit")) return;
      var d = document.createElement("div");
      d.id = "tbMapCredit";
      d.textContent = "Map Esri, HERE, Garmin, \u00a9 OpenStreetMap";
      d.style.cssText = "position:fixed;left:8px;bottom:17px;z-index:900;opacity:.6;" +
        "font:600 10px/1.2 system-ui,-apple-system,sans-serif;color:#9fb4c7;" +
        "pointer-events:none;letter-spacing:.02em";
      (document.body || document.documentElement).appendChild(d);
    } catch (_) {}
  }

  /* For the small single-theme maps (the Spotter map, the Grand Tour, the
     night board's mini map) that only ever show the dark canvas and have no
     theme switch to wire up. */
  function addDark(map, opts) { return add(map, "dark", opts); }

  global.TBBasemap = { add: add, addDark: addDark, SETS: SETS };
})(window);
