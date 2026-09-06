/* ============================================================================
   screen-lock.js — a kiosk lock tied to the full-screen button.

   A board left on a table gets touched. A stray tap on the city picker, on
   "Account", on a footer link, or a back-swipe from the edge, and the thing
   somebody set up as a departure board is showing a sign-in form instead. This
   makes leaving deliberate: while the lock is on, every link and the city
   picker are inert and the back gesture goes nowhere. Turning it off is the
   same control that turned it on.

   WHAT IT CANNOT DO, so nobody is surprised: no web page can stop the home
   button, an app switch, or the browser's own address bar and tab controls.
   What it stops is everything INSIDE the page, which is what actually goes
   wrong on a board somebody is walking past.

   HOW IT IS DRIVEN. Where the Fullscreen API works (desktop, Android) the lock
   simply mirrors full screen -- including Escape, which is why this listens to
   fullscreenchange rather than to the button: a lock you can enter with the
   button but not leave with Escape is a trap, and the boards' own code already
   says trapping somebody in full screen is a bug.

   Where it does not work (iPad Safari has no Fullscreen API for anything but a
   <video>, and an installed board has no browser chrome to hide anyway) the
   button toggles the lock on its own, and the choice is remembered -- a kiosk
   that reboots should come back locked.
   ========================================================================= */
(function () {
  "use strict";

  var KEY = "tb.screenLock";
  var locked = false;
  var root = document.documentElement;
  var FS_OK = !!(root.requestFullscreen || root.webkitRequestFullscreen);

  function fsOn() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  /* ---- the look ---------------------------------------------------------
     Dimmed rather than hidden. A control that vanishes reads as a bug; one
     that is visibly greyed out reads as switched off, and tells you the board
     is in a mode without having to say so. `:not([href^="#"])` leaves in-page
     anchors alone, and buttons are untouched throughout -- Settings, the
     collapse chevrons, the dismiss crosses and the full-screen button itself
     all keep working, because none of them can leave the page. */
  var css =
    'html.tb-locked a[href]:not([href^="#"]):not([href^="javascript"]),' +
    'html.tb-locked .city-picker{ pointer-events:none !important; opacity:.45 }' +
    '#tbLockPill{position:fixed; z-index:9998; left:50%; bottom:14px; transform:translate(-50%,180%);' +
    ' display:flex; align-items:center; gap:8px; padding:7px 14px; border-radius:999px;' +
    ' background:var(--panel,#141a2a); color:var(--muted,#93a3bd);' +
    ' border:1px solid var(--line,#26314a); box-shadow:0 8px 24px rgba(0,0,0,.45);' +
    ' font:600 12px/1 var(--mono,ui-monospace,monospace); letter-spacing:.06em;' +
    ' text-transform:uppercase; transition:transform .28s cubic-bezier(.4,0,.2,1); pointer-events:none}' +
    '#tbLockPill.on{transform:translate(-50%,0)}' +
    '#tbLockPill.nudge{animation:tbLockNudge .5s ease}' +
    '#tbLockPill b{color:var(--text,#e8eefc); font-weight:800}' +
    '@keyframes tbLockNudge{0%,100%{transform:translate(-50%,0)}' +
    ' 25%{transform:translate(-54%,0)}75%{transform:translate(-46%,0)}}';

  function injectCss() {
    if (document.getElementById("tbLockCss")) return;
    var s = document.createElement("style");
    s.id = "tbLockCss";
    s.textContent = css;
    (document.head || root).appendChild(s);
  }

  var pillTimer = null;
  function pill() {
    var p = document.getElementById("tbLockPill");
    if (!p) {
      p = document.createElement("div");
      p.id = "tbLockPill";
      document.body.appendChild(p);
    }
    return p;
  }
  function showPill() {
    var p = pill();
    p.innerHTML = "&#128274; Screen locked &middot; <b>full screen</b> to unlock";
    // One frame, so the transition has a start state to move from on first show.
    requestAnimationFrame(function () { p.classList.add("on"); });
    clearTimeout(pillTimer);
    pillTimer = setTimeout(function () { p.classList.remove("on"); }, 3200);
  }
  /* Something was blocked. Bring the pill back and shake it: the tap has to be
     answered, or the board looks broken rather than locked. */
  function nudge() {
    var p = pill();
    showPill();
    p.classList.remove("nudge");
    void p.offsetWidth;                 // restart the animation
    p.classList.add("nudge");
  }

  /* ---- the back gesture -------------------------------------------------
     A sentinel entry is pushed when the lock goes on, and pushed again every
     time it is popped, so back has somewhere to go that is still this page.
     Nothing is removed on unlock: rewriting history to tidy up is how you send
     somebody two pages back by accident. */
  function armHistory() {
    try { history.pushState({ tbLock: 1 }, "", location.href); } catch (_) {}
  }
  addEventListener("popstate", function () {
    if (!locked) return;
    armHistory();
    nudge();
  });

  /* Backstop for anything the CSS does not reach -- a link added later, a
     handler that navigates from script. Capture phase, so it lands before the
     page's own listeners. */
  addEventListener("click", function (e) {
    if (!locked) return;
    var a = e.target && e.target.closest && e.target.closest("a[href]");
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#" || /^javascript:/i.test(href)) return;
    e.preventDefault();
    e.stopPropagation();
    nudge();
  }, true);

  /* NO beforeunload GUARD, deliberately. It is the obvious way to make leaving
     hard and it is the wrong one here. On the target -- an installed board on
     an iPad -- iOS ignores it outright, so it buys nothing; everywhere else it
     buys a modal dialog, and a modal dialog on a board nobody is standing in
     front of is not a lock, it is the freeze this whole day of work started
     from. It also stops the board's own scheduled reload dead. The guards
     below cover every way OUT of the page that the page itself can see, which
     is the part that actually goes wrong when somebody walks past a table.
     What is left -- the address bar, the tab strip, the home button -- no web
     page can hold on to, and pretending otherwise with a dialog just makes the
     board worse at being a board. */

  function setLocked(on) {
    on = !!on;
    if (on === locked) return;
    locked = on;
    root.classList.toggle("tb-locked", locked);
    if (locked) { armHistory(); showPill(); }
    else {
      var p = document.getElementById("tbLockPill");
      if (p) p.classList.remove("on");
    }
    if (!FS_OK) { try { localStorage.setItem(KEY, locked ? "1" : "0"); } catch (_) {} }
  }

  function bindButton() {
    var b = document.getElementById("fsBtn");
    if (!b || b._tbLock) return false;
    b._tbLock = 1;
    /* Listening on the button rather than replacing its onclick leaves the
       board's own handler -- and its licence check, and its "full screen is
       blocked here" hint -- exactly as it was. This only adds the lock beside
       it. */
    b.addEventListener("click", function () { setLocked(!locked); });
    return true;
  }

  function start() {
    injectCss();
    bindButton();
    /* F is the board's own shortcut for the same button, so it has to mean the
       same thing here. Same guard the boards use: not while somebody is
       typing. */
    addEventListener("keydown", function (e) {
      if (e.key !== "f" && e.key !== "F") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      setLocked(!locked);
    });

    /* Where full screen really works, mirror it as well -- both ways, which is
       the point. Escape leaves full screen without going near the button, and
       a lock you can enter with the button but cannot leave with Escape is a
       trap; the boards' own code already says trapping somebody in full screen
       is a bug, not a sale.

       This sits ALONGSIDE the button handler rather than instead of it, and
       the two cannot fight: the click sets the lock and the fullscreenchange
       that follows sets it to the same value, which setLocked() drops as a
       no-op. It also means the iPad path -- no Fullscreen API at all, button
       only -- is the same code everywhere else runs, rather than a second
       branch that only ever gets tested on the device it was written for. */
    if (FS_OK) {
      ["fullscreenchange", "webkitfullscreenchange"].forEach(function (ev) {
        document.addEventListener(ev, function () { setLocked(fsOn()); });
      });
    } else {
      /* No full screen to remember it for us, so remember it ourselves: a
         kiosk that reboots should come back locked. Where the API does work,
         a reload leaves full screen anyway, so there is nothing to restore. */
      var saved = "0";
      try { saved = localStorage.getItem(KEY) || "0"; } catch (_) {}
      if (saved === "1") setLocked(true);
    }
  }

  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start);
  else start();
  /* The button is built by each board's own deferred script, which may land
     after this one. A few short retries cost nothing. */
  var tries = 0;
  var t = setInterval(function () {
    bindButton();
    if (++tries >= 8) clearInterval(t);
  }, 300);

  window.TBLock = {
    get locked() { return locked; },
    set: setLocked
  };
})();
