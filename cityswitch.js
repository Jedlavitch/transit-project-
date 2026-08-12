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
  if (!fs && !forceShell) { window.location.href = url; return; }
  try {
    // Silence this board so the shell doesn't double-fetch/tick underneath:
    // brute-force clear every timer and animation frame the page ever made.
    try { var i = window.setInterval(function () {}, 1e9); while (i > 0) { clearInterval(i); clearTimeout(i); i--; } } catch (e) {}
    try { var r = window.requestAnimationFrame(function () {}); while (r > 0) { cancelAnimationFrame(r); r--; } } catch (e) {}
    var f = document.createElement("iframe");
    f.id = "cityShell";
    f.allow = "fullscreen"; f.allowFullscreen = true;
    f.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh;border:0;z-index:2147483000;background:#081020";
    f.src = url;
    f.onload = function () { try { document.title = f.contentDocument.title; f.contentWindow.focus(); } catch (e) {} };
    document.body.appendChild(f);
    try { history.replaceState(null, "", url); } catch (e) {}
  } catch (e) {
    try { sessionStorage.setItem("kioskFS", "1"); } catch (_) {}
    window.location.href = url;
  }
}

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
