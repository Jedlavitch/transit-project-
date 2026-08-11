/* ============================================================================
   wake.js — keeps the screen on, for any board that is left running.

   WHY THIS IS A FILE AND NOT A COPY-PASTE
     The city boards each carry their own copy of this, and the copy in nyc.html
     is the one that has been through two rounds of being wrong in the field.
     The newer boards — the station display, the departure board, the TV menu —
     shipped without any of it, so they dim on a schedule like an ordinary web
     page. This is that same logic in one place: one script tag, no other
     wiring, nothing for a board to remember to call.

   THE TWO THINGS THIS GETS RIGHT, both learned the hard way on the city boards:

     1. IT IS NOT TIED TO FULL SCREEN. The obvious implementation takes the lock
        when the page goes full screen and drops it on exit. iPhone Safari has no
        Fullscreen API at all, so that test is permanently false there and the
        lock is never taken — the phone dims on schedule, on the device most
        likely to be propped up as a display. A board that is on screen wants to
        stay on screen; full screen is not the question.

     2. THE OS TAKES THE LOCK BACK. Any time the page is hidden — a tab switch,
        the phone locking, even a notification pulldown — the lock is released
        and does NOT come back on its own. So it is re-acquired on the lock's own
        release event, on every visibility change, and on the first pointer or
        key event, because some browsers only grant it off a user gesture.

   SECURE CONTEXT: navigator.wakeLock does not exist over plain http://. On a
   localhost dev server it is present; on a http:// LAN address it is not, and
   there is nothing this file can do about that. It fails quiet either way — a
   board must not break because the screen might dim.

   USE: <script src="wake.js?v=1"></script>  — that is the whole integration.
   Pages that already have their own wake lock do not need it and should not
   load it; if one does, this defers to the existing implementation rather than
   fighting it for the same lock.
   ============================================================================ */
(function () {
  "use strict";

  /* A page that already runs its own wake lock keeps it. Two managers taking
     and releasing the same lock would race: one's release() cancels the other's
     request, and the screen dims with both of them believing they hold it. */
  if (window.TBWake) return;

  var lock = null;         // the WakeLockSentinel, when we hold one
  var wanted = true;       // false only after an explicit release()

  function supported() {
    try { return "wakeLock" in navigator; } catch (_) { return false; }
  }

  function request() {
    if (!wanted || document.visibilityState !== "visible") return;
    if (!supported()) return;
    if (lock && !lock.released) return;
    try {
      var p = navigator.wakeLock.request("screen");
      if (!p || !p.then) return;
      p.then(function (l) {
        lock = l;
        /* The release event is the only reliable signal that the OS took it
           back. Re-ask on a short delay: asking from inside the event itself is
           refused on some browsers because the page is not yet visible again. */
        l.addEventListener("release", function () {
          if (wanted) setTimeout(request, 400);
        });
      }).catch(function () { /* refused: nothing to do, and nothing to say */ });
    } catch (_) {}
  }

  function release() {
    wanted = false;
    try { if (lock) lock.release(); } catch (_) {}
    lock = null;
  }

  function hook() {
    var go = function () { wanted = true; request(); };
    document.addEventListener("pointerdown", go, { passive: true });
    document.addEventListener("keydown", go);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") request();
    });
    /* Full screen is not what decides whether we hold the lock, but entering it
       is a strong signal the screen is meant to stay on — and on the platform
       displays it is also the moment a phone would otherwise start its dim
       timer. Re-asking here costs nothing and covers the case where the lock
       was refused earlier for want of a gesture. */
    document.addEventListener("fullscreenchange", go);
    document.addEventListener("webkitfullscreenchange", go);
    go();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hook);
  else hook();

  window.TBWake = {
    request: request,
    release: release,
    supported: supported,
    held: function () { return !!(lock && !lock.released); }
  };
})();
