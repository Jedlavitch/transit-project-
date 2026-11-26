/* ============================================================================
   kiosk-reload.js — a board left up for weeks gets a fresh start, but only when
   a fresh start is guaranteed to be an improvement.

   WHY A RELOAD AT ALL
   These boards run for days on a wall. Browsers on televisions are not the ones
   getting the attention at Google and Apple: heaps grow, timers drift, a socket
   wedges, and the page that was right on Monday is quietly stale by Friday with
   nobody in the room to notice. Restarting the page nightly is the oldest kiosk
   remedy there is, and it costs nothing when it is not needed.

   WHY IT IS NOT A ONE-LINE setInterval(reload)
   Because the naive version is WORSE THAN DOING NOTHING, and measurably so.
   These boards were tested with every fetch and XHR failing for thirty-five
   seconds: the board held all its rows and stayed responsive. It degrades to
   stale data rather than blanking, which is the right behaviour for a wall —
   yesterday's departures still tell you which platform to stand on.

   A blind reload throws that away. Reload at 4am while the wifi is flaky and a
   stale-but-useful board becomes an empty one, for hours, until somebody walks
   past and notices. So the rule here is the opposite of "restart and hope":

       NEVER RELOAD UNLESS WE HAVE JUST PROVEN THE RELOAD WILL COME BACK.

   The proof is a live request to this page's own origin, with caching defeated.
   If that request resolves at all — any status, even a 405 — then the server is
   reachable and reloading will land. If it rejects, the network is down, and
   the very worst moment to throw away a screenful of data is precisely then, so
   we skip and try again in an hour.

   THE OTHER TWO GUARDS
     idle    — a reload under somebody's hands is a bug they will remember. Any
               pointer, key or touch resets the clock.
     cooldown— recorded in localStorage, because uptime resets to zero across a
               reload. Without it, a board that reloads at 03:00 comes back at
               03:00, still inside the quiet window, and reloads again: a loop
               that looks exactly like a crash.

   WHEN
     quiet window  03:00-04:59 local, after 4h up   — the ordinary path
     long haul     after 36h up, any hour           — for a screen switched off
                                                      every night, which never
                                                      sees the small hours
   Both additionally require: healthy, idle, and outside the cooldown.

   ES5, like the rest of the television-facing code.
   Set window.TB_NO_KIOSK_RELOAD = true before this loads to disable it.
   ============================================================================ */
(function () {
  "use strict";

  var HOUR = 3600000;
  var CFG = {
    quietFrom:   3,          // local hour, inclusive
    quietTo:     5,          // exclusive
    minUpQuiet:  4  * HOUR,  // don't restart a board that just started
    minUpAny:    36 * HOUR,  // the fallback for screens that never see 3am
    idleFor:     15 * 60000, // no interaction for this long
    cooldown:    6  * HOUR,  // since the last reload we performed
    checkEvery:  5  * 60000  // how often to consider it
  };
  var LS_LAST = "tb.kioskReloadedAt";

  if (window.TB_NO_KIOSK_RELOAD) return;

  var startedAt = Date.now();
  var lastInput = Date.now();

  function get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  /* Any of these means a person is present. Passive listeners so a board that is
     also being scrolled or panned does not pay for this. */
  var EVENTS = ["pointerdown", "mousedown", "keydown", "touchstart", "wheel"];
  function noteInput() { lastInput = Date.now(); }
  for (var i = 0; i < EVENTS.length; i++) {
    try { window.addEventListener(EVENTS[i], noteInput, { passive: true, capture: true }); }
    catch (_) { window.addEventListener(EVENTS[i], noteInput, true); }
  }

  /* Can we reach the place we are about to reload from?

     Deliberately asks THIS page's own origin rather than some third party: a
     board can perfectly well have working internet and an unreachable host, and
     it is the host that matters. cache-busted and no-store, because a cached
     answer would happily report success down a dead wire.

     RESOLVING IS THE SIGNAL, not the status code. A 404 or a 405 still proves a
     server answered; only a rejection means nothing is there. */
  function reachable(cb) {
    var url = location.pathname + (location.search ? location.search + "&" : "?") +
              "tbping=" + Date.now();
    var done = false;
    function finish(ok) { if (!done) { done = true; cb(ok); } }
    var timer = setTimeout(function () { finish(false); }, 12000);
    function settle(ok) { clearTimeout(timer); finish(ok); }

    if (window.fetch) {
      try {
        window.fetch(url, { method: "HEAD", cache: "no-store" })
          .then(function () { settle(true); })
          .catch(function () { settle(false); });
        return;
      } catch (_) { /* fall through to XHR */ }
    }
    try {
      var x = new XMLHttpRequest();
      x.open("HEAD", url, true);
      x.onreadystatechange = function () {
        if (x.readyState !== 4) return;
        settle(!!x.status);            // any status at all means a server answered
      };
      x.onerror = function () { settle(false); };
      x.send(null);
    } catch (_) { settle(false); }
  }

  function due() {
    var now = Date.now(), up = now - startedAt;

    if (now - lastInput < CFG.idleFor) return false;      // somebody is here

    var last = Number(get(LS_LAST) || 0);
    if (last && now - last < CFG.cooldown) return false;  // stops the 3am loop

    var hour = new Date().getHours();
    var inQuiet = hour >= CFG.quietFrom && hour < CFG.quietTo;
    if (inQuiet && up >= CFG.minUpQuiet) return true;
    if (up >= CFG.minUpAny) return true;
    return false;
  }

  function consider() {
    if (!due()) return;
    reachable(function (ok) {
      /* The whole point. A board with stale data still tells you which platform
         to stand on; a board that reloaded into a dead network tells you
         nothing, and does so until a human intervenes. */
      if (!ok) return;
      if (!due()) return;                 // something changed during the probe
      set(LS_LAST, String(Date.now()));
      freshStart();
    });
  }

  /* ---- full screen: the reload must not be the thing that ends it ----
     A page reload always ends a Fullscreen-API session, and nothing can
     re-enter one without a tap. On a wall display that is "the board quietly
     drops out of full screen some night and stays out" -- seen on a Facebook
     Portal. So while full screen we restart the board INSIDE a fresh
     same-origin iframe (the cityswitch.js shell trick): the outer document,
     which owns full screen, survives; the board inside is brand new. Inside a
     shell already, location.reload() only reloads the frame, which is fine. */
  function fsDoc() {
    try { if (window.top && window.top !== window && window.top.document) return window.top.document; } catch (_) {}
    return document;
  }
  function fsOn() { var d = fsDoc(); return !!(d.fullscreenElement || d.webkitFullscreenElement); }
  /* inside OUR shell iframe (same origin), as opposed to merely being framed
     by somebody else's page, which for these purposes is the same as top */
  function inShell() { return fsDoc() !== document; }
  function freshStart() {
    if (inShell() || !fsOn()) { try { location.reload(); } catch (_) {} return; }
    try {
      /* silence the old board so it does not keep fetching under the new one */
      try { var i = window.setInterval(function () {}, 1e9); while (i > 0) { clearInterval(i); clearTimeout(i); i--; } } catch (_) {}
      try { var r = window.requestAnimationFrame(function () {}); while (r > 0) { cancelAnimationFrame(r); r--; } } catch (_) {}
      var old = document.getElementById("cityShell");
      var f = document.createElement("iframe");
      f.id = "cityShell";
      f.allow = "fullscreen"; f.allowFullscreen = true;
      f.style.cssText = "position:fixed;top:0;right:0;bottom:0;left:0;width:100vw;height:100vh;border:0;z-index:2147483000;background:#081020";
      f.onload = function () {
        /* and drop the old board's DOM, which is most of what a reload frees */
        var kids = [].slice.call(document.body.children);
        for (var k = 0; k < kids.length; k++) if (kids[k] !== f) { try { document.body.removeChild(kids[k]); } catch (_) {} }
        try { f.contentWindow.focus(); } catch (_) {}
      };
      f.src = location.href.replace(/[?&]tbping=\d+/, "");
      if (old) old.parentNode.removeChild(old);
      document.body.appendChild(f);
    } catch (_) { try { location.reload(); } catch (__) {} }
  }

  /* ---- full screen: come back when the device takes it away ----
     A Portal (and other kiosk browsers) also drop full screen by themselves:
     the screen sleeps, ambient mode takes over, the app is backgrounded.
     Nothing in the page did it, so nothing put it back. Now: an exit that
     nobody asked for -- no tap or key on the board in the moment before it --
     is remembered, and full screen is re-entered at once where the browser
     allows it, otherwise on the very next tap. An exit somebody DID ask for
     (the board's exit button, F, Esc) is respected and forgotten. Remembered
     in sessionStorage so it also survives a reload in the same tab. */
  var FS_KEY = "tb.kioskFSWanted";
  var lastPress = 0, wasFs = fsOn();
  function onPress() { lastPress = Date.now(); }
  function wantFs() { try { return sessionStorage.getItem(FS_KEY) === "1"; } catch (_) { return false; } }
  function setWant(on) { try { if (on) sessionStorage.setItem(FS_KEY, "1"); else sessionStorage.removeItem(FS_KEY); } catch (_) {} }
  function reenter() {
    if (!wantFs() || fsOn()) return;
    /* the shell's outer page stands down: the board inside it owns this */
    if (!inShell() && document.getElementById("cityShell")) return;
    var el = fsDoc().documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!req) return;
    try { var p = req.call(el); if (p && p.catch) p.catch(function () {}); } catch (_) {}
  }
  function onFsChange() {
    if (!inShell() && document.getElementById("cityShell")) return;
    var on = fsOn();
    if (on) setWant(true);
    else if (wasFs) {
      /* Esc on a keyboard leaves full screen without the page ever seeing the
         key, so on a mouse-and-keyboard machine every exit counts as chosen.
         The touch screens this is for (a Portal) have no Esc. */
      var touch = false;
      try { touch = window.matchMedia("(pointer: coarse)").matches; } catch (_) {}
      if (!touch || Date.now() - lastPress < 1500) setWant(false);   // somebody chose to leave
      else setTimeout(reenter, 300);                       // the device took it
    }
    wasFs = on;
  }
  try { window.addEventListener("pointerdown", onPress, true); window.addEventListener("keydown", onPress, true); } catch (_) {}
  ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
    document.addEventListener(ev, onFsChange);
    try { if (fsDoc() !== document) fsDoc().addEventListener(ev, onFsChange); } catch (_) {}
  });
  /* the next tap anywhere is the user gesture a re-entry needs. Runs AFTER
     onPress in the same event, but the decision above already happened. */
  try { window.addEventListener("pointerup", reenter, true); window.addEventListener("keyup", reenter, true); } catch (_) {}
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") setTimeout(reenter, 300); });
  reenter();

  setInterval(consider, CFG.checkEvery);

  /* Exposed for tests and for a board that wants to say "not now". */
  window.TBKioskReload = {
    due: due,
    reachable: reachable,
    consider: consider,
    freshStart: freshStart,
    config: CFG,
    startedAt: function () { return startedAt; },
    lastInput: function () { return lastInput; }
  };
})();
