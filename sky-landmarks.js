/* Sky — "On this route". Glass Sky only (night.html sets data-sky-glass).

   A hand-picked list of things worth looking down at — national parks, big
   mountains, great lakes and rivers, famous landmarks, major cities — with
   coordinates. Whichever lie close to the flight's great-circle path get a
   star on the map, and the flight panel gets one line: what's on this route,
   and which comes up next, with roughly how long until the plane is over it.

   No network: the list ships with the page, so it works on any feed and costs
   nothing. Each entry carries its own "close enough" radius in nautical miles,
   because a mountain range is visible from much further off than a building.

   Wraps night.html's renderMiniMap (a top-level function declaration, so it is
   a property of window and the page's own calls go through this wrapper). */
(function () {
  "use strict";
  var root = document.documentElement;
  if (!root.hasAttribute("data-sky-glass")) return;

  // [name, lat, lon, radius nm]
  var PLACES = [
    // — US Northeast & Mid-Atlantic —
    ["Statue of Liberty", 40.6892, -74.0445, 12], ["Manhattan", 40.7831, -73.9712, 15],
    ["Philadelphia", 39.9526, -75.1652, 14], ["Baltimore Inner Harbor", 39.2858, -76.6131, 10],
    ["The National Mall", 38.8893, -77.0502, 8], ["Chesapeake Bay Bridge", 38.9930, -76.3820, 12],
    ["Chesapeake Bay", 38.2000, -76.2000, 30], ["Shenandoah National Park", 38.5300, -78.4400, 25],
    ["Harpers Ferry", 39.3254, -77.7389, 10], ["Gettysburg", 39.8309, -77.2311, 10],
    ["Atlantic City", 39.3643, -74.4229, 10], ["Cape May", 38.9351, -74.9060, 10],
    ["Delaware Water Gap", 40.9690, -75.1400, 12], ["Pine Barrens", 39.8000, -74.5500, 20],
    ["Outer Banks", 35.5585, -75.4665, 25], ["Wright Brothers Memorial", 36.0140, -75.6680, 10],
    ["Cape Cod", 41.6688, -70.2962, 25], ["Boston Harbor", 42.3400, -71.0100, 10],
    ["Mount Washington", 44.2706, -71.3033, 25], ["Acadia National Park", 44.3386, -68.2733, 20],
    ["Lake Champlain", 44.5300, -73.3300, 25], ["Adirondack Mountains", 44.1100, -73.9200, 35],
    ["Finger Lakes", 42.6600, -76.9000, 25], ["Niagara Falls", 43.0896, -79.0849, 15],
    ["Pittsburgh's three rivers", 40.4417, -80.0081, 10], ["Lake Erie", 42.2000, -81.2000, 40],
    ["Blue Ridge Mountains", 37.5000, -79.6000, 35], ["Appalachian Mountains", 39.0000, -79.5000, 40],
    ["New River Gorge", 38.0700, -81.0800, 15], ["Great Smoky Mountains", 35.6118, -83.4895, 30],
    ["Charlotte", 35.2271, -80.8431, 12], ["Raleigh–Durham", 35.8800, -78.7900, 12],
    ["Kennedy Space Center", 28.5729, -80.6490, 20], ["Orlando", 28.5383, -81.3792, 12],
    ["Everglades", 25.2866, -80.8987, 30], ["Miami Beach", 25.7907, -80.1300, 12],
    ["Key West", 24.5551, -81.7800, 15], ["Savannah", 32.0809, -81.0912, 10],
    ["Atlanta", 33.7490, -84.3880, 12], ["Nashville", 36.1627, -86.7816, 10],
    ["Cape Canaveral", 28.3922, -80.6077, 25], ["Daytona Beach", 29.2108, -81.0228, 12],
    ["Lake Okeechobee", 26.9500, -80.8300, 25], ["Jacksonville", 30.3322, -81.6557, 12],
    ["Charleston", 32.7765, -79.9311, 12], ["Myrtle Beach", 33.6891, -78.8867, 12],
    ["Cape Fear & Wilmington", 34.2104, -77.8868, 14], ["Cape Hatteras Lighthouse", 35.2510, -75.5290, 15],
    ["Great Dismal Swamp", 36.6000, -76.5000, 18], ["Norfolk & Hampton Roads", 36.8508, -76.2859, 14],
    ["Chesapeake Bay Bridge-Tunnel", 37.0300, -76.0800, 14], ["Richmond", 37.5407, -77.4360, 12],
    ["Assateague Island", 38.0500, -75.2400, 15], ["Ocean City", 38.3365, -75.0849, 10],
    ["Delaware Bay", 39.0500, -75.1500, 20], ["Jersey Shore", 39.9500, -74.0700, 18],
    ["Long Island", 40.8000, -73.0000, 25], ["Hudson River", 41.3000, -73.9500, 15],
    ["Catskill Mountains", 42.1000, -74.3000, 25], ["Poconos", 41.1000, -75.3000, 20],
    // — US Midwest & South —
    ["Lake Michigan", 43.5000, -87.0000, 50], ["Chicago skyline", 41.8781, -87.6298, 12],
    ["Gateway Arch", 38.6247, -90.1848, 10], ["Mississippi River", 35.0000, -90.1000, 25],
    ["New Orleans & the Mississippi Delta", 29.9511, -90.0715, 20], ["Houston", 29.7604, -95.3698, 12],
    ["Austin", 30.2672, -97.7431, 10], ["Dallas–Fort Worth", 32.8998, -97.0403, 14],
    ["Lake Superior", 47.6000, -87.5000, 60], ["Mount Rushmore", 43.8791, -103.4591, 15],
    ["Badlands", 43.8554, -102.3397, 25], ["Devils Tower", 44.5902, -104.7146, 15],
    // — US West —
    ["Rocky Mountain National Park", 40.3428, -105.6836, 30], ["Pikes Peak", 38.8409, -105.0423, 25],
    ["Denver & the Front Range", 39.7392, -104.9903, 15], ["Yellowstone", 44.4280, -110.5885, 35],
    ["Grand Teton", 43.7904, -110.6818, 25], ["Great Salt Lake", 41.1000, -112.5000, 35],
    ["Arches National Park", 38.7331, -109.5925, 20], ["Monument Valley", 36.9980, -110.0985, 20],
    ["Grand Canyon", 36.1069, -112.1129, 35], ["Lake Powell", 37.0700, -111.2400, 25],
    ["Zion National Park", 37.2982, -113.0263, 20], ["Bryce Canyon", 37.5930, -112.1871, 20],
    ["Meteor Crater", 35.0275, -111.0225, 15], ["Hoover Dam & Lake Mead", 36.0160, -114.7377, 20],
    ["Las Vegas Strip", 36.1147, -115.1728, 12], ["Death Valley", 36.5054, -117.0794, 30],
    ["White Sands", 32.7872, -106.3257, 25], ["Yosemite", 37.8651, -119.5383, 25],
    ["Lake Tahoe", 39.0968, -120.0324, 20], ["Golden Gate Bridge", 37.8199, -122.4783, 10],
    ["Mount Shasta", 41.4092, -122.1949, 30], ["Crater Lake", 42.9446, -122.1090, 20],
    ["Mount Hood", 45.3735, -121.6959, 30], ["Mount St. Helens", 46.1914, -122.1956, 30],
    ["Mount Rainier", 46.8523, -121.7603, 35], ["Olympic Mountains", 47.8021, -123.6044, 30],
    ["Glacier National Park", 48.7596, -113.7870, 30], ["Hollywood Sign", 34.1341, -118.3215, 10],
    ["Santa Monica Pier", 34.0094, -118.4973, 10], ["Joshua Tree", 33.8734, -115.9010, 25],
    // — Canada & the North Atlantic —
    ["Toronto", 43.6532, -79.3832, 12], ["Montréal", 45.5017, -73.5673, 12],
    ["Newfoundland", 48.9000, -55.6000, 60], ["Greenland ice sheet", 64.0000, -42.0000, 120],
    ["Iceland", 64.9631, -19.0208, 80], ["Hawaiʻi", 20.7984, -156.3319, 60],
    // — Europe —
    ["London", 51.5074, -0.1278, 15], ["White Cliffs of Dover", 51.1290, 1.3570, 15],
    ["Stonehenge", 51.1789, -1.8262, 10], ["Edinburgh Castle", 55.9486, -3.1999, 10],
    ["Eiffel Tower", 48.8584, 2.2945, 10], ["Mont-Saint-Michel", 48.6361, -1.5115, 12],
    ["Amsterdam's canals", 52.3676, 4.9041, 10], ["Rhine Gorge", 50.1400, 7.7300, 20],
    ["Cologne Cathedral", 50.9413, 6.9583, 8], ["Black Forest", 48.0000, 8.2000, 30],
    ["Lake Constance", 47.6300, 9.3700, 20], ["Neuschwanstein Castle", 47.5576, 10.7498, 12],
    ["Zugspitze", 47.4210, 10.9850, 25], ["Matterhorn", 45.9763, 7.6586, 30],
    ["Jungfrau", 46.5370, 7.9620, 25], ["Mont Blanc", 45.8326, 6.8652, 30],
    ["Lake Geneva", 46.4500, 6.5500, 20], ["Lake Zurich", 47.2500, 8.7000, 12],
    ["The Dolomites", 46.4102, 11.8440, 30], ["Venice lagoon", 45.4408, 12.3155, 15],
    ["Florence", 43.7696, 11.2558, 10], ["Leaning Tower of Pisa", 43.7230, 10.3966, 10],
    ["Colosseum", 41.8902, 12.4922, 8], ["Vatican City", 41.9029, 12.4534, 8],
    ["Mount Vesuvius", 40.8210, 14.4260, 20], ["Mount Etna", 37.7510, 14.9934, 30],
    ["Lake Garda", 45.6500, 10.6500, 15], ["Pyrenees", 42.6700, 1.0000, 40],
    ["Alps", 46.5000, 9.5000, 60]
  ];

  function rad(d) { return d * Math.PI / 180; }
  function nm(a, b) {
    var R = 3440.065, dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* Places within reach of the path, in the order the flight meets them.
     The path is resampled to ~10 nm steps so a long leg can't step over a
     place between two of greatCircle()'s 96 points. Places inside the origin
     or destination city are dropped: you are taking off from or landing at
     those, not flying over them. */
  function onRoute(o, d) {
    var total = nm([o.lat, o.lon], [d.lat, d.lon]);
    if (!(total > 30)) return [];
    var steps = Math.max(24, Math.min(900, Math.round(total / 10)));
    var path = (typeof greatCircle === "function") ? greatCircle(o, d, steps) : null;
    if (!path || !path.length) return [];
    var pts = path.map(function (p) { return Array.isArray(p) ? p : [p.lat, p.lng != null ? p.lng : p.lon]; });
    var out = [];
    PLACES.forEach(function (pl) {
      /* From cruising height the view reaches far beyond these radii, so
         they are stretched by 60%; the list is "worth a look out of the
         window", not "directly underneath". */
      var at = [pl[1], pl[2]], r = pl[3] * 1.6;
      if (nm(at, [o.lat, o.lon]) < 20 || nm(at, [d.lat, d.lon]) < 20) return;
      var best = Infinity, idx = -1;
      for (var i = 0; i < pts.length; i++) {
        var dd = nm(at, pts[i]);
        if (dd < best) { best = dd; idx = i; }
      }
      if (best <= r) out.push({ name: pl[0], lat: pl[1], lon: pl[2], off: best, frac: idx / (pts.length - 1) });
    });
    out.sort(function (a, b) { return a.frac - b.frac; });
    return out.slice(0, 12);
  }

  var layer = null, routeKey = null, list = [], totalNm = 0;
  function star(name, next) {
    return L.divIcon({ className: "sg-poi-wrap",
      html: '<span class="sg-poi' + (next ? " next" : "") + '">★</span><b class="sg-poi-lbl">' + escape(name) + "</b>",
      iconSize: [18, 18], iconAnchor: [9, 9] });
  }
  function escape(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function panelLine(posLL, gsKt, o) {
    var txt = document.querySelector("#flight .txt");
    if (!txt) return;
    var el = document.getElementById("sgRoute");
    if (!list.length) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("div"); el.id = "sgRoute"; txt.appendChild(el); }
    // How far along is the plane, as a fraction of the leg?
    var done = Math.max(0, Math.min(1, nm([o.lat, o.lon], [posLL.lat, posLL.lon]) / (totalNm || 1)));
    var ahead = list.filter(function (p) { return p.frac > done - 0.004; });
    var next = ahead[0] || null;
    var parts = [];
    if (next) {
      var dist = (next.frac - done) * totalNm, when = "";
      if (dist < 8) when = "below now";
      else if (gsKt > 60) { var m = Math.round(dist / gsKt * 60); when = m < 60 ? "in ~" + m + " min" : "in ~" + Math.floor(m / 60) + " h " + (m % 60) + " min"; }
      parts.push('<span class="sg-next">Next: <b>' + escape(next.name) + "</b>" + (when ? " · " + when : "") + "</span>");
    }
    var rest = ahead.slice(next ? 1 : 0, 5).map(function (p) { return escape(p.name); });
    if (rest.length) parts.push('<span class="sg-then">then ' + rest.join(" · ") + "</span>");
    if (!parts.length) parts.push('<span class="sg-then">Flew past ' +
      list.slice(-3).map(function (p) { return escape(p.name); }).join(" · ") + "</span>");
    el.innerHTML = '<span class="sg-route-k">★ On this route</span>' + parts.join("");
    // keep the "next" star highlighted on the map
    if (layer) layer.eachLayer(function (mk) {
      var isNext = next && mk.options.title === next.name;
      var ic = mk.getElement && mk.getElement();
      if (ic) { var s = ic.querySelector(".sg-poi"); if (s) s.classList.toggle("next", !!isNext); }
    });
  }

  var orig = window.renderMiniMap;
  if (typeof orig !== "function") return;
  window.renderMiniMap = function (id, oLL, dLL, posLL, fleet) {
    var r = orig.apply(this, arguments);
    try {
      var m = (typeof miniMap !== "undefined") ? miniMap : null;
      if (!m) return r;
      if (!layer) layer = L.layerGroup().addTo(m);
      var key = oLL && dLL ? id + "|" + oLL.lat.toFixed(2) + "," + oLL.lon.toFixed(2) + ">" + dLL.lat.toFixed(2) + "," + dLL.lon.toFixed(2) : null;
      if (key !== routeKey) {
        routeKey = key; layer.clearLayers(); list = [];
        if (key) {
          totalNm = nm([oLL.lat, oLL.lon], [dLL.lat, dLL.lon]);
          list = onRoute(oLL, dLL);
          list.forEach(function (p) {
            L.marker([p.lat, p.lon], { icon: star(p.name, false), title: p.name, interactive: true, keyboard: false })
              .bindTooltip(p.name, { direction: "top", offset: [0, -8] }).addTo(layer);
          });
        }
      }
      var s = window.__lastSubject || {};
      if (key && posLL) panelLine(posLL, s.gsKt || 0, oLL);
      else { var el = document.getElementById("sgRoute"); if (el) el.remove(); }
    } catch (e) {}
    return r;
  };
})();
