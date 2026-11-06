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
      Canvas pyramid stops at zoom 16: ask for z17-19 and every service in the
      world hands back the same 2,521-byte "no data" tile. maxNativeZoom keeps
      Leaflet from asking — but the boards zoom to 19 when following a vehicle,
      and a z16 tile stretched eight times is a smear with no streets and no
      names in it. So a third layer takes over up there; see DETAIL. */
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
    },
    /* A map with colour in it — green parks, blue water, coloured roads —
       for the one place the map IS the page (the Glass Sky view). Same keyless
       provider; its names are drawn into the tiles, so there is no separate
       reference layer, and it is never run through the dark-theme filters. */
    color: {
      base: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
      ref:  null
    }
  };

  /* The close-up layer. World_Street_Map is the only keyless Esri service that
     is actually drawn down to z19 everywhere the boards run — Canvas stops at
     16, and both Reference overlays carry labels and route shields but no road
     geometry at all past 16, so neither can stand in for it.

     It is a LIGHT map, which is why it is inverted below rather than merely
     dimmed: dimming a light map leaves white roads on a pale ground, the exact
     opposite polarity to the dark canvas it has to blend with.

     The numbers in that filter are measured, not guessed. A grid search over
     brightness/contrast/saturate compared the mean luminance of this service's
     z17 tile against the Canvas z16 tile under the board filter, across nine
     places picked for the things that go wrong — parkland, harbour, river,
     dense grid, European old town. brightness(.7) contrast(.95) was the floor
     of that search (RMS 6.7 of 255); saturate sits below what the search liked
     because the board's own route colours have to stay the loudest thing on
     the screen. */
  var DETAIL = "https://services.arcgisonline.com/ArcGIS/rest/services/" +
    "World_Street_Map/MapServer/tile/{z}/{y}/{x}";

  /* Below this, the Canvas tiles are real; above it they are an upscale, so
     the detail layer fades in and covers them. */
  var DETAIL_FROM = 17;

  var PANE = "tbBasemap";      // the canvas: roads, water, landuse
  var PANE_REF = "tbBasemapRef";   // Esri's separate place-name layer
  var PANE_HI = "tbBasemapHi";     // the close-up street map, z17 and in

  /* "day" is the only light board theme; "dark" and "black" both want the dark
     canvas, and are separated below by how hard the filter pushes it. */
  function setFor(theme) { return theme === "color" ? SETS.color : theme === "day" ? SETS.light : SETS.dark; }

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
  /* THE CANVAS AND THE NAMES ARE DARKENED SEPARATELY, and that is the whole
     point of having two panes.

     One filter over both was the original approach and it is why the map read
     as a black void. Esri's dark canvas renders mid-grey, so taking the land
     down to board-black means roughly halving its brightness — but the place
     names live in a *separate transparent layer* drawn over it, and halving
     those too left "Potomac" and "North Bethesda" as barely-there smudges.
     Every city lost its geography: the river, the coastline, the names that
     tell you which city you are looking at.

     So the land is pushed down hard and the names are left nearly alone. The
     result is the tone the boards are built around with the map still legible
     underneath it, which is what a transit map is for. */
  function injectStyle() {
    if (document.getElementById("tb-basemap-style")) return;
    var s = document.createElement("style");
    s.id = "tb-basemap-style";
    s.textContent =
      /* Brightness alone just greys everything out — the roads go with the
         background. Pairing it with contrast pushes the landmass toward black
         while pulling roads back up, which is the shape of Dark Matter's
         palette rather than a dimmed version of Esri's. */
      ".tb-basemap-pane{filter:brightness(.52) contrast(1.22) saturate(.75)}" +
      ".tb-basemap-ref{filter:brightness(.95) contrast(1.05)}" +
      /* Black is the dimmed wall-display theme — push the land further down,
         and the names only a little, or the city stops being identifiable. */
      '[data-theme="black"] .tb-basemap-pane{filter:brightness(.38) contrast(1.3) saturate(.6)}' +
      '[data-theme="black"] .tb-basemap-ref{filter:brightness(.82) contrast(1.05)}' +
      /* Day is already a light map on a light board; leave both alone. */
      '[data-theme="day"] .tb-basemap-pane,[data-theme="day"] .tb-basemap-ref{filter:none}' +
      /* The close-up layer. opacity, not display, so crossing the threshold is
         a crossfade rather than the map blinking — and so the blurred canvas
         underneath is what it fades out of, never a hole. */
      ".tb-basemap-hi{opacity:0;transition:opacity .4s ease}" +
      ".tb-basemap-hi.tb-hi-on{opacity:1}" +
      ".tb-basemap-hi{filter:invert(1) hue-rotate(180deg) brightness(.7) contrast(.95) saturate(.18)}" +
      /* hue-rotate(180) after the invert is what keeps water blue and parks
         green instead of the orange-and-magenta a bare invert produces. */
      '[data-theme="black"] .tb-basemap-hi{filter:invert(1) hue-rotate(180deg) brightness(.56) contrast(1) saturate(.14)}' +
      /* Day is a light board and this is a light map: it needs no correction
         at all, which is the one case where the close-up matches perfectly. */
      '[data-theme="day"] .tb-basemap-hi{filter:none}' +
      /* The colour set is shown as it comes, in every theme. */
      ".tb-basemap-color .tb-basemap-pane,.tb-basemap-color .tb-basemap-hi{filter:none !important}";
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
    /* Leaflet's default of 2 is tuned for a map a hand drags. These maps pan
       themselves, continuously, while following a vehicle — a wider ring of
       tiles already loaded off-screen is the difference between gliding and
       chasing a grey edge. */
    if (o.keepBuffer == null) o.keepBuffer = 3;
    /* Not overridable by accident: asking Esri for z17+ returns blank tiles,
       so a board passing maxZoom:19 must still stop fetching at 16. */
    o.maxNativeZoom = 16;

    /* Both below Leaflet's own tilePane (200) so any tile overlay a board adds
       later still draws on top of the basemap, exactly as it did when the
       basemap was the first layer added. Two panes rather than one because
       each takes a different filter — see injectStyle. */
    if (!map.getPane(PANE)) {
      var p = map.createPane(PANE);
      p.style.zIndex = 188;
      p.classList.add("tb-basemap-pane");
    }
    if (!map.getPane(PANE_REF)) {
      var pr = map.createPane(PANE_REF);
      pr.style.zIndex = 189;      // names sit above the canvas they name
      pr.classList.add("tb-basemap-ref");
    }
    if (!map.getPane(PANE_HI)) {
      var ph = map.createPane(PANE_HI);
      ph.style.zIndex = 190;      // covers both of them when it is on
      ph.classList.add("tb-basemap-hi");
    }

    var baseOpts = {}, refOpts = {};
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) { baseOpts[k] = o[k]; refOpts[k] = o[k]; }
    baseOpts.pane = PANE;
    refOpts.pane = PANE_REF;

    /* The detail layer is deliberately NOT given maxNativeZoom: being drawn
       all the way down is the entire reason it exists. minZoom keeps Leaflet
       from fetching a tile of it until the board is nearly that far in, so a
       wall display parked on a whole city never pays for it.

       It is one zoom BELOW the crossfade, and that is deliberate. Leaflet drops
       a layer's tiles the instant the map leaves its zoom range: set the two to
       the same number and zooming out fades an already-empty pane — a pop, not
       a crossfade. One level of overlap means the tiles are still there to fade
       out of, and still there to fade back into on the way in. */
    var hiOpts = {};
    for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) hiOpts[k] = o[k];
    delete hiOpts.maxNativeZoom;
    hiOpts.pane = PANE_HI;
    hiOpts.minZoom = DETAIL_FROM - 1;

    var set = setFor(theme);
    var base = global.L.tileLayer(set.base, baseOpts).addTo(map);
    var ref  = set.ref ? global.L.tileLayer(set.ref, refOpts).addTo(map) : null;
    map.getContainer().classList.toggle("tb-basemap-color", theme === "color");
    var hi   = global.L.tileLayer(DETAIL, hiOpts).addTo(map);

    /* One class toggle drives the crossfade; the transition is in the CSS, so
       nothing here runs per frame. Called on every zoom rather than only on
       the crossing, because a board can be restored at any zoom — the kiosk
       reload, a shared deep link — and the pane has to be right on first
       paint, not one zoom later. */
    function syncDetail() {
      var on = map.getZoom() >= DETAIL_FROM;
      var el = map.getPane(PANE_HI);
      if (el) el.classList.toggle("tb-hi-on", on);
    }
    map.on("zoomend", syncDetail);
    syncDetail();

    return {
      base: base,
      ref: ref,
      hi: hi,
      setTheme: function (t) {
        var n = setFor(t);
        base.setUrl(n.base);
        if (n.ref) {
          if (ref) ref.setUrl(n.ref);
          else { ref = global.L.tileLayer(n.ref, refOpts).addTo(map); this.ref = ref; }
        } else if (ref) { map.removeLayer(ref); ref = null; this.ref = null; }
        map.getContainer().classList.toggle("tb-basemap-color", t === "color");
        /* hi keeps its URL: one light street map serves every theme, and only
           the filter above changes. */
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
