/* Upgrade http:// to https:// on the custom domain.
   The old jedlavitch.github.io address is on the browsers' HSTS preload list,
   so it was ALWAYS https and nobody could land on an insecure copy. A custom
   domain has no such protection: type "transitproject.online" into a phone and
   you get plain http, where the whole secure-context half of the platform is
   switched off — navigator.wakeLock is undefined (the screen sleeps), and so
   are geolocation and the service worker. GitHub Pages' own "Enforce HTTPS"
   setting does this server-side; this is the client-side belt to go with it,
   and it costs one redirect on a visit that would otherwise be broken.
   localhost is left alone so local testing over http still works. */
(function(){
  var h = location.hostname;
  if (location.protocol === "http:" && h !== "localhost" && h !== "127.0.0.1" && !/^\[?::1\]?$/.test(h)) {
    location.replace("https://" + location.host + location.pathname + location.search + location.hash);
  }
})();

/* cityswitch.js — switch cities WITHOUT dropping kiosk full screen.
   A real navigation always ends a JS-API fullscreen session (the document that
   requested it is destroyed), and the next page can't re-enter without a user
   gesture. So while full screen, the city picker swaps boards inside a
   same-origin full-viewport iframe: the outer fullscreen document survives, the
   iframe carries the new city, and the URL is fixed up via replaceState (a
   manual reload lands on the real page). Not full screen -> plain navigation,
   exactly as before. Further switches inside the shell are plain iframe
   navigations, which never touch the outer fullscreen session. */
function switchCity(url, forceShell) {
  var fs = document.fullscreenElement || document.webkitFullscreenElement;
  /* Board → board gets the city-hop card; anything else navigates plainly. */
  if (window.TBCityHop && TBCityHop.depart(url, function () { switchCity._go(url, forceShell); })) return;
  switchCity._go(url, forceShell);
}
switchCity._go = function (url, forceShell) {
  var fs = document.fullscreenElement || document.webkitFullscreenElement;
  if (!fs && !forceShell) { window.location.href = url; return; }
  try {
    // Silence this board so the shell doesn't double-fetch/tick underneath:
    // brute-force clear every timer and animation frame the page ever made.
    try { var i = window.setInterval(function () {}, 1e9); while (i > 0) { clearInterval(i); clearTimeout(i); i--; } } catch (e) {}
    try { var r = window.requestAnimationFrame(function () {}); while (r > 0) { cancelAnimationFrame(r); r--; } } catch (e) {}
    var f = document.createElement("iframe");
    f.id = "cityShell";
    f.allow = "fullscreen"; f.allowFullscreen = true;
    f.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;inset:0;width:100vw;height:100vh;border:0;z-index:2147483000;background:#081020";
    f.src = url;
    f.onload = function () {
      try { document.title = f.contentDocument.title; f.contentWindow.focus(); } catch (e) {}
      // The board inside the shell plays its own arrival; the outer card steps aside.
      if (window.TBCityHop) TBCityHop.dismiss(true);
    };
    document.body.appendChild(f);
    try { history.replaceState(null, "", url); } catch (e) {}
  } catch (e) {
    try { sessionStorage.setItem("kioskFS", "1"); } catch (_) {}
    window.location.href = url;
  }
};

/* City hop — the card that plays between two city boards.

   Departing: three brand stripes sweep in, a route line draws from the city
   you are leaving to the one you chose, and the destination's name settles
   letter by letter. Navigation starts while that is still playing, and the
   old page keeps painting until the new one commits, so there is no blank
   frame. Arriving: this file runs in <head> on every board, so the same card
   is already on screen at the new board's very first paint (sessionStorage
   carries the hop across); it holds until the page has loaded and then the
   stripes sweep off to reveal the board.

   Never in the way: the whole thing is capped (it gives up and reveals the
   board after a few seconds even if load never fires), it ignores clicks only
   while it is covering the screen, and prefers-reduced-motion gets a plain
   fade with no flapping letters. Pages that are not city boards navigate
   exactly as before. */
(function () {
  var CITIES = {
    dc:           { n: "Washington DC", lat: 38.8977, lon: -77.0365, tz: "America/New_York", mi: 1 },
    philadelphia: { n: "Philadelphia",  lat: 39.9526, lon: -75.1652, tz: "America/New_York", mi: 1 },
    newjersey:    { n: "New Jersey",    lat: 40.7357, lon: -74.1724, tz: "America/New_York", mi: 1 },
    nyc:          { n: "New York",      lat: 40.7128, lon: -74.0060, tz: "America/New_York", mi: 1 },
    boston:       { n: "Boston",        lat: 42.3523, lon: -71.0552, tz: "America/New_York", mi: 1 },
    losangeles:   { n: "Los Angeles",   lat: 34.0522, lon: -118.2437, tz: "America/Los_Angeles", mi: 1 },
    sanfrancisco: { n: "San Francisco", lat: 37.7749, lon: -122.4194, tz: "America/Los_Angeles", mi: 1 },
    amsterdam:    { n: "Amsterdam",     lat: 52.3791, lon: 4.9003,  tz: "Europe/Amsterdam" },
    zurich:       { n: "Zurich",        lat: 47.3779, lon: 8.5403,  tz: "Europe/Zurich" },
    cologne:      { n: "Cologne",       lat: 50.9430, lon: 6.9589,  tz: "Europe/Berlin" },
    stuttgart:    { n: "Stuttgart",     lat: 48.7840, lon: 9.1829,  tz: "Europe/Berlin" },
    rome:         { n: "Rome",          lat: 41.9010, lon: 12.5016, tz: "Europe/Rome" }
  };
  var KEY = "tb.cityHop";
  function idOf(url) {
    var m = String(url || "").split(/[?#]/)[0].split("/").pop().match(/^([a-z]+)\.html$/i);
    return m && CITIES[m[1].toLowerCase()] ? m[1].toLowerCase() : null;
  }
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function miles(a, b) {
    var R = 3958.8, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function localTime(tz) {
    try { return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date()); } catch (e) { return ""; }
  }
  function css() {
    if (document.getElementById("tbHopCss")) return;
    var st = document.createElement("style"); st.id = "tbHopCss";
    st.textContent =
      ".tbhop{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483600;overflow:hidden;pointer-events:auto;" +
        "font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;color:#FFFCF5;contain:strict}" +
      ".tbhop .hb{position:absolute;top:-20%;bottom:-20%;left:-30%;width:160%;transform:translateX(-120%) skewX(-14deg);" +
        "transition:transform .5s cubic-bezier(.7,0,.25,1)}" +
      ".tbhop .hb1{background:#FF3D77}.tbhop .hb2{background:#00E0C6;transition-delay:.07s}" +
      ".tbhop .hb3{background:#2F7BFF;transition-delay:.14s}.tbhop .hb4{background:#0F1115;transition-delay:.21s}" +
      ".tbhop.in .hb{transform:translateX(0) skewX(-14deg)}" +
      ".tbhop.out .hb{transform:translateX(120%) skewX(-14deg)}" +
      ".tbhop.out .hb4{transition-delay:0s}.tbhop.out .hb3{transition-delay:.07s}.tbhop.out .hb2{transition-delay:.14s}.tbhop.out .hb1{transition-delay:.21s}" +
      ".tbhop .hc{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;flex-direction:column;align-items:center;justify-content:center;" +
        "gap:18px;padding:24px;opacity:0;transition:opacity .25s ease .3s;text-align:center}" +
      ".tbhop.in .hc{opacity:1}.tbhop.out .hc{opacity:0;transition-delay:0s;transition-duration:.15s}" +
      ".tbhop .hk{font-size:11px;letter-spacing:.22em;color:#A8AFBA}" +
      ".tbhop .hr{width:min(560px,86vw);height:70px;overflow:visible}" +
      ".tbhop .hr .trk{fill:none;stroke:#2C3038;stroke-width:3;stroke-dasharray:2 8;stroke-linecap:round}" +
      ".tbhop .hr .run{fill:none;stroke:url(#tbHopGrad);stroke-width:4;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;" +
        "transition:stroke-dashoffset .9s cubic-bezier(.5,0,.2,1) .35s}" +
      ".tbhop.in .hr .run,.tbhop.arrived .hr .run{stroke-dashoffset:0}" +
      ".tbhop .hr .stn{fill:#0F1115;stroke:#FFFCF5;stroke-width:3}" +
      ".tbhop .hr .to{stroke:#00E0C6}" +
      ".tbhop .hr text{fill:#A8AFBA;font:600 11px 'IBM Plex Mono',monospace;letter-spacing:.08em}" +
      ".tbhop .hn{display:flex;flex-wrap:wrap;justify-content:center;gap:5px;max-width:94vw}" +
      ".tbhop .hn span{position:relative;display:inline-block;min-width:.72em;padding:.08em .1em;border-radius:6px;" +
        "background:#181B21;box-shadow:inset 0 0 0 1px #2C3038;font:800 clamp(30px,7.4vw,78px)/1.05 Archivo,'Helvetica Neue',Arial,sans-serif;" +
        "text-transform:uppercase;letter-spacing:0;color:#FFFCF5}" +
      ".tbhop .hn span::after{content:'';position:absolute;left:0;right:0;top:50%;height:2px;background:#0F1115;opacity:.85}" +
      ".tbhop .hn span.sp{background:none;box-shadow:none;min-width:.32em}.tbhop .hn span.sp::after{display:none}" +
      ".tbhop .hn span.flip{color:#FF91B1}" +
      ".tbhop .hm{font-size:12px;letter-spacing:.06em;color:#CDD2DA}" +
      ".tbhop .hm b{color:#00E0C6;font-weight:600}" +
      "@media (prefers-reduced-motion:reduce){.tbhop .hb{display:none}.tbhop{background:#0F1115;opacity:0;transition:opacity .25s}" +
        ".tbhop.in,.tbhop.arrived{opacity:1}.tbhop.out{opacity:0}.tbhop .hc{transition:none;opacity:1}.tbhop .hr .run{transition:none;stroke-dashoffset:0}}";
    (document.head || document.documentElement).appendChild(st);
  }
  function build(fromId, toId, arrived) {
    css();
    var from = CITIES[fromId], to = CITIES[toId];
    var el = document.createElement("div");
    el.className = "tbhop" + (arrived ? " in arrived" : "");
    el.setAttribute("role", "status");
    el.setAttribute("aria-label", "Switching to " + to.n);
    var d = from ? miles(from, to) : 0;
    var dist = !from ? "" : to.mi && from.mi ? Math.round(d).toLocaleString() + " mi" : Math.round(d * 1.609344).toLocaleString() + " km";
    var t = localTime(to.tz);
    var letters = to.n.toUpperCase().split("").map(function (c) {
      return c === " " ? '<span class="sp"> </span>' : '<span data-c="' + c + '">' + (arrived || reduced() ? c : "&#8203;") + "</span>";
    }).join("");
    el.innerHTML =
      '<div class="hb hb1"></div><div class="hb hb2"></div><div class="hb hb3"></div><div class="hb hb4"></div>' +
      '<div class="hc">' +
        '<div class="hk">TRANSIT PROJECT · ' + (arrived ? "NOW ARRIVING" : "NOW DEPARTING") + "</div>" +
        '<svg class="hr" viewBox="0 0 560 70" aria-hidden="true"><defs><linearGradient id="tbHopGrad" x1="0" x2="1">' +
          '<stop offset="0" stop-color="#FF3D77"/><stop offset=".5" stop-color="#2F7BFF"/><stop offset="1" stop-color="#00E0C6"/></linearGradient></defs>' +
          '<path class="trk" d="M24 50 C 180 -6, 380 -6, 536 50"/>' +
          '<path class="run" pathLength="1" d="M24 50 C 180 -6, 380 -6, 536 50"/>' +
          '<circle class="stn" cx="24" cy="50" r="7"/><circle class="stn to" cx="536" cy="50" r="7"/>' +
          '<text x="24" y="70" text-anchor="start">' + (from ? from.n.toUpperCase() : "") + "</text>" +
          '<text x="536" y="70" text-anchor="end">' + to.n.toUpperCase() + "</text></svg>" +
        '<div class="hn">' + letters + "</div>" +
        '<div class="hm">' + (dist ? dist + " · " : "") + (t ? "local time <b>" + t + "</b>" : "") + "</div>" +
      "</div>";
    return el;
  }
  /* Letters cycle through the alphabet and land left to right. */
  function flap(el, done) {
    var spans = [].slice.call(el.querySelectorAll(".hn span[data-c]"));
    if (reduced()) { done && done(); return; }
    var A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ", tick = 0;
    var timer = setInterval(function () {
      tick++;
      var settled = 0;
      spans.forEach(function (s, i) {
        if (tick > 4 + i * 1.6) { s.textContent = s.dataset.c; s.classList.remove("flip"); settled++; }
        else { s.textContent = A.charAt((Math.random() * 26) | 0); s.classList.add("flip"); }
      });
      if (settled === spans.length) { clearInterval(timer); done && done(); }
    }, 45);
  }
  var current = null;
  function dismiss(instant) {
    var el = current; current = null;
    if (!el) return;
    if (instant) { el.remove(); return; }
    el.classList.remove("in", "arrived");
    el.classList.add("out");
    setTimeout(function () { el.remove(); }, reduced() ? 300 : 800);
  }
  function depart(url, go) {
    var toId = idOf(url), fromId = idOf(location.pathname);
    if (!toId || toId === fromId || !document.body) return false;
    try { sessionStorage.setItem(KEY, JSON.stringify({ from: fromId, to: toId, at: Date.now() })); } catch (e) {}
    if (current) current.remove();
    var el = build(fromId, toId, false);
    current = el;
    document.body.appendChild(el);
    void el.offsetWidth;
    el.classList.add("in");
    flap(el);
    // Go once the stripes have covered the screen; the card keeps playing
    // on this page until the next one paints its own copy.
    setTimeout(go, reduced() ? 150 : 650);
    // If navigation is blocked (a beforeunload prompt, say), don't strand it.
    setTimeout(function () { if (current === el) dismiss(); }, 6000);
    return true;
  }
  function arrive() {
    var hop = null;
    try { hop = JSON.parse(sessionStorage.getItem(KEY) || "null"); sessionStorage.removeItem(KEY); } catch (e) {}
    var here = idOf(location.pathname);
    if (!hop || !here || hop.to !== here || Date.now() - hop.at > 10000) return;
    var el = build(hop.from, hop.to, true);
    current = el;
    (document.body || document.documentElement).appendChild(el);
    var shown = Date.now(), gone = false;
    function reveal() {
      if (gone) return; gone = true;
      // Hold the arrival long enough to read, never longer than needed.
      setTimeout(function () { if (current === el) dismiss(); }, Math.max(0, 700 - (Date.now() - shown)));
    }
    window.addEventListener("load", function () { setTimeout(reveal, 150); });
    setTimeout(reveal, 3500);
  }
  window.TBCityHop = { depart: depart, dismiss: dismiss };
  arrive();
})();

/* "Account" — the account/licence page, in every board's header.

   Injected here rather than pasted into sixteen headers by hand: this file is
   already on every page that has a `nav.view-links`, so one edit reaches all of
   them and a board added later inherits the link for free. The pages with their
   own navigation (the Spotter, the TV menu) carry it in their own markup.

   `from` is passed so the page's back link returns to the board you came from
   rather than guessing. Navigation goes through switchCity() so a kiosk in full
   screen stays in full screen, exactly like the other header links. */
(function () {
  function addProfileLink() {
    var nav = document.querySelector("nav.view-links");
    if (!nav || nav.querySelector("#profileBtn")) return;
    var here = (location.pathname.split("/").pop() || "").replace(/[^a-z.]/gi, "");
    var url = "profile.html" + (here ? "?from=" + encodeURIComponent(here) : "");
    var a = document.createElement("a");
    a.id = "profileBtn";
    a.href = url;
    a.title = "Your account — sign-in, licence key and saved settings";
    /* "Account", not "You". Every other link in this bar names the thing it
       opens — Sky, Tour, Board, Station — and "You" named the visitor instead,
       which made it the one label in the row that does not say where it goes. */
    a.textContent = "Account";
    a.onclick = function (e) { e.preventDefault(); switchCity(url); return false; };
    nav.appendChild(a);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addProfileLink);
  else addProfileLink();
})();

/* Suggested locations for the Settings > Location picker.
   Each board passes its own list of {lat, lon, label} plus a callback that
   actually moves the board. Coordinates are baked in rather than geocoded:
   one tap, no network round-trip, and it cannot fail on a flaky connection.
   The chip matching the board's current location is highlighted, so the panel
   also answers "where am I pointed right now?". */
function renderLocSuggestions(box, list, current, onPick) {
  if (!box) return;
  box.innerHTML = "";
  (list || []).forEach(function (s) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "sg";
    b.textContent = s.label;
    if (current && Math.abs(current.lat - s.lat) < 0.004 && Math.abs(current.lon - s.lon) < 0.004) {
      b.className += " on";
    }
    b.onclick = function () { onPick({ lat: s.lat, lon: s.lon, label: s.full || s.label }); };
    box.appendChild(b);
  });
}

/* Sky hop — the take-off between a city board and Sky mode (night.html).

   Departing (the board's Sky link): a sky-blue sheet rises up the screen,
   three brand-coloured contrails draw across it on a climbing diagonal with a
   plane at their head, and "Taking off" names the city whose sky you are
   about to scan. Navigation starts as soon as the sheet has covered the
   board, so the take-off keeps playing on this page until Sky paints.

   Arriving: this file loads in Sky's <head>, so the same scene is on screen
   at its very first paint (sessionStorage carries the hop across). Once the
   page has loaded the sheet lifts away upward, as if climbing out through
   cloud, and the live map is underneath.

   The Sky link keeps its own markup and paywall gate: this listens in the
   capture phase, asks the gate first, and only takes over the navigation
   when the gate says yes. Reduced motion gets a short fade instead. */
(function () {
  var KEY = "tb.skyHop";
  function reduced() { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function css() {
    if (document.getElementById("tbSkyHopCss")) return;
    var st = document.createElement("style"); st.id = "tbSkyHopCss";
    st.textContent =
      ".tbsky{position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483600;overflow:hidden;pointer-events:auto;" +
        "color:#F7F8FA;font-family:'IBM Plex Mono',ui-monospace,Menlo,monospace;contain:strict;" +
        "background:linear-gradient(180deg,#071733 0%,#0E3A7A 46%,#2F7BFF 78%,#8EC5FF 100%);" +
        "transform:translateY(100%);transition:transform .6s cubic-bezier(.7,0,.25,1)}" +
      ".tbsky.in{transform:translateY(0)}" +
      ".tbsky.out{transform:translateY(-100%);transition-duration:.75s}" +
      ".tbsky .cl{position:absolute;left:-10%;right:-10%;height:38%;bottom:-6%;" +
        "background:radial-gradient(60% 70% at 20% 100%,rgba(255,255,255,.55),transparent 70%)," +
        "radial-gradient(50% 60% at 65% 100%,rgba(255,255,255,.45),transparent 70%)," +
        "radial-gradient(40% 55% at 95% 100%,rgba(255,255,255,.4),transparent 70%);" +
        "transform:translateY(30%);transition:transform 1.4s ease .1s}" +
      ".tbsky.in .cl{transform:translateY(55%)}" +
      ".tbsky svg.tr{position:absolute;top:0;left:0;width:100%;height:100%}" +
      ".tbsky .tr path{fill:none;stroke-width:5;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;" +
        "transition:stroke-dashoffset 1.15s cubic-bezier(.45,0,.2,1) .25s}" +
      ".tbsky .tr path.c2{transition-delay:.31s}.tbsky .tr path.c3{transition-delay:.37s}" +
      ".tbsky.in .tr path,.tbsky.arrived .tr path{stroke-dashoffset:0}" +
      ".tbsky .pl{position:absolute;left:0;top:0;width:46px;height:46px;margin:-23px 0 0 -23px;" +
        "offset-path:path('M -60 0 L 0 0');transform:rotate(0deg)}" +
      ".tbsky .pl svg{width:46px;height:46px;filter:drop-shadow(0 4px 10px rgba(0,0,0,.35))}" +
      ".tbsky .pl path{fill:#fff}" +
      ".tbsky .tx{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;padding:0 24px;" +
        "opacity:0;transition:opacity .35s ease .45s}" +
      ".tbsky.in .tx,.tbsky.arrived .tx{opacity:1}.tbsky.out .tx{opacity:0;transition-delay:0s;transition-duration:.2s}" +
      ".tbsky .k{font-size:11px;letter-spacing:.24em;color:rgba(255,255,255,.75)}" +
      ".tbsky .h{margin-top:10px;font:800 clamp(34px,7.5vw,84px)/1 Archivo,'Helvetica Neue',Arial,sans-serif;" +
        "letter-spacing:-.03em;text-transform:uppercase}" +
      ".tbsky .s{margin-top:12px;font:500 clamp(12px,1.4vw,16px)/1.3 'IBM Plex Sans',system-ui,sans-serif;color:rgba(255,255,255,.85)}" +
      "@media (prefers-reduced-motion:reduce){.tbsky,.tbsky.in,.tbsky.out{transform:none;transition:opacity .25s}" +
        ".tbsky{opacity:0}.tbsky.in,.tbsky.arrived{opacity:1}.tbsky.out{opacity:0}.tbsky .pl{display:none}" +
        ".tbsky .tr path{transition:none;stroke-dashoffset:0}.tbsky .tx{transition:none;opacity:1}}";
    (document.head || document.documentElement).appendChild(st);
  }
  function esc(t) { return String(t || "").replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  /* The climb: one curve from low left to high right, three parallel trails. */
  function build(city, arrived) {
    css();
    var el = document.createElement("div");
    el.className = "tbsky" + (arrived ? " in arrived" : "");
    el.setAttribute("role", "status");
    el.setAttribute("aria-label", "Opening Sky mode");
    var W = Math.max(innerWidth, 320), H = Math.max(innerHeight, 320);
    var d = function (dy) { return "M " + (-0.05 * W) + " " + (0.92 * H + dy) + " C " + (0.35 * W) + " " + (0.86 * H + dy) + ", " + (0.62 * W) + " " + (0.42 * H + dy) + ", " + (1.06 * W) + " " + (0.06 * H + dy); };
    el.innerHTML =
      '<div class="cl"></div>' +
      '<svg class="tr" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' +
        '<path class="c1" pathLength="1" stroke="#FF3D77" d="' + d(-14) + '"/>' +
        '<path class="c2" pathLength="1" stroke="#00E0C6" d="' + d(0) + '"/>' +
        '<path class="c3" pathLength="1" stroke="#FFFFFF" stroke-opacity=".9" d="' + d(14) + '"/></svg>' +
      '<div class="pl" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 2l1.6 7.2 7.4 4.3v2l-7.4-2.1-.6 5.1 2.4 1.8V22L12 21l-3.4 1v-1.7l2.4-1.8-.6-5.1-7.4 2.1v-2l7.4-4.3z"/></svg></div>' +
      '<div class="tx"><div class="k">TRANSIT PROJECT / SKY</div><div class="h">' + (arrived ? "Nearest flight" : "Taking off") + "</div>" +
        '<div class="s">' + (city ? "Scanning the sky over " + esc(city) : "Scanning the sky") + "</div></div>";
    // The plane rides the middle trail (offset-path), nose along the curve.
    var pl = el.querySelector(".pl");
    pl.style.offsetPath = "path('" + d(0) + "')";
    pl.style.offsetRotate = "auto 90deg";
    if (!reduced() && pl.animate) {
      pl.animate([{ offsetDistance: "0%" }, { offsetDistance: "100%" }],
        { duration: arrived ? 1 : 1150, delay: arrived ? 0 : 250, easing: "cubic-bezier(.45,0,.2,1)", fill: "both" });
      if (arrived) pl.style.offsetDistance = "100%";
    } else pl.style.display = "none";
    return el;
  }
  function cityName() {
    var c = document.querySelector(".tb-board-city");
    if (c && c.textContent.trim()) return c.textContent.trim();
    var sel = document.querySelector(".city-picker select");
    return sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].textContent.trim() : "";
  }
  function depart(url) {
    var city = cityName();
    try { sessionStorage.setItem(KEY, JSON.stringify({ city: city, at: Date.now() })); } catch (e) {}
    var el = build(city, false);
    document.body.appendChild(el);
    void el.offsetWidth;
    el.classList.add("in");
    setTimeout(function () { window.location.href = url; }, reduced() ? 150 : 700);
    setTimeout(function () { if (el.parentNode) { el.classList.remove("in"); el.classList.add("out"); setTimeout(function () { el.remove(); }, 800); } }, 7000);
  }
  // Board side: take over the Sky link once its gate has said yes.
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest && e.target.closest("a#nightBtn");
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault(); e.stopPropagation();
    if (window.TBGate && !TBGate.require("sky")) return;   // the gate showed its own message
    depart(a.getAttribute("href") || "night.html");
  }, true);
  /* Board map → Sky. A plane's popup on a city board gains "Watch in Sky ›",
     which opens Sky following that exact aircraft (the same link format Sky's
     own Share button makes). Added from here because every board builds its
     popups in its own copy of buildVehiclePopup(); `state` is each board's
     top-level lexical global, reachable by name but not as window.state. */
  function boardState() { try { return typeof state !== "undefined" ? state : null; } catch (e) { return null; } }
  function skyLinkFor(id, latlng, call) {
    var a = document.getElementById("nightBtn");
    var base = (a && a.getAttribute("href")) || "night.html";
    var u = new URL(base, location.href);
    u.searchParams.set("hex", String(id).replace(/^p/, ""));
    if (call) u.searchParams.set("flight", call);
    u.searchParams.set("lat", latlng.lat.toFixed(3));
    u.searchParams.set("lon", latlng.lng.toFixed(3));
    return u.pathname.split("/").pop() + u.search;
  }
  var hooked = false;
  function hookBoardMap() {
    var st = boardState();
    if (hooked || !st || !st.map || !st.map.on) return !!hooked;
    hooked = true;
    st.map.on("popupopen", function (e) {
      var c = st._clicked;
      if (!c || c.fleet !== "plane") return;
      var rec = st.fleets && st.fleets.plane && st.fleets.plane[c.id];
      var box = e.popup && e.popup.getElement && e.popup.getElement();
      var pop = box && box.querySelector(".veh-pop");
      if (!rec || !pop || pop.querySelector(".vp-sky")) return;
      var ll = (rec.marker && rec.marker.getLatLng) ? rec.marker.getLatLng() : (e.popup.getLatLng && e.popup.getLatLng());
      if (!ll) return;
      var call = String(rec.label || "").trim().split(/\s+/)[0];
      if (!/^[A-Z]{3}\d/.test(call)) call = "";
      var btn = document.createElement("button");
      btn.type = "button"; btn.className = "vp-follow vp-sky"; btn.textContent = "Watch in Sky ›";
      btn.title = "Open Sky mode following this aircraft";
      btn.addEventListener("click", function () {
        if (window.TBGate && !TBGate.require("sky")) return;
        depart(skyLinkFor(c.id, ll, call));
      });
      pop.appendChild(btn);
    });
    return true;
  }
  var hookTries = 0, hookPoll = setInterval(function () { if (hookBoardMap() || ++hookTries > 60) clearInterval(hookPoll); }, 500);

  // Sky side: the arrival.
  (function arrive() {
    if (!/night\.html$/i.test(location.pathname)) return;
    var hop = null;
    try { hop = JSON.parse(sessionStorage.getItem(KEY) || "null"); sessionStorage.removeItem(KEY); } catch (e) {}
    if (!hop || Date.now() - hop.at > 10000) return;
    var el = build(hop.city, true);
    (document.body || document.documentElement).appendChild(el);
    var shown = Date.now(), gone = false;
    function lift() {
      if (gone) return; gone = true;
      setTimeout(function () {
        el.classList.remove("in", "arrived"); el.classList.add("out");
        setTimeout(function () { el.remove(); }, reduced() ? 300 : 900);
      }, Math.max(0, 650 - (Date.now() - shown)));
    }
    window.addEventListener("load", function () { setTimeout(lift, 200); });
    setTimeout(lift, 3500);
  })();
})();
