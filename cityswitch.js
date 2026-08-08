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
