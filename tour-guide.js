/* ============================================================================
   tour-guide.js — the first-run walkthrough.

   WHY IT EXISTS
     A board opens straight into a wall of live data with no obvious controls.
     Everything is discoverable, but only if you go looking: the city picker
     reads as a label, Sky and Tour read as decoration, and the fact that a
     departure row can be tapped to follow that vehicle is invisible. Someone
     who has just paid should be shown around rather than left to poke at it.

   WHEN IT RUNS
     Once, the first time a board loads while the licence is valid — so it
     lands right after activation rather than during evaluation. It can be
     replayed any time from Settings, and skipping counts as done. If the
     licensing system is dormant (no Worker configured) it runs on first visit
     instead, so a self-hosted board still gets the tour.

   BRAND
     Paper card on an ink scrim, Archivo for the step title, IBM Plex Sans for
     the copy, IBM Plex Mono for the counter. No emoji anywhere — the guide
     retired them. Teal is deliberately absent: the guide says it fails on pale
     surfaces, and this card is paper. The station dots on the guide's scarf
     are the same dots as the mark, which is the one visual joke here.

   ADDING A STEP
     Push onto STEPS. `el` is a selector (the step is skipped when nothing
     matches, so boards that lack a feature simply do not mention it), `before`
     runs ahead of the step, `after` cleans up.
   ========================================================================== */
(function () {
  "use strict";

  var DONE = "tb.tourDone";          // "1" once completed or skipped
  var VERSION = "1";                 // bump to re-run the tour for everyone

  function ls(k) { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
  function $(s) { return document.querySelector(s); }

  /* ---- the guide -----------------------------------------------------------
     A penguin, drawn in the brand palette on the same 100-unit thinking as the
     mark. The scarf is a route line with two station dots, which is the mark's
     own vocabulary; without that it would just be a cartoon that happens to sit
     next to the logo. Ink body reads on the paper card; pink is the accent
     because teal is not allowed on pale. */
  /* ---- swapping in real artwork -------------------------------------------
     The penguin below is a placeholder that ships so the tour is never without
     a guide. To use commissioned art instead, drop the file in brand/ and point
     at it — no code change:

         config.js:   mascot: "brand/mascot.svg"
         or a step:   { mascot: "brand/mascot-map.svg", title: … }

     Per-step art is supported because a set of mascots is more useful posed
     than repeated: one for the welcome, another over the map. SVG or PNG both
     work; it is rendered at 58x69 and anything with roughly that aspect will
     sit correctly. If the file is missing or fails to load, the placeholder
     comes back rather than leaving a broken-image box in a paying customer's
     first-run experience. */
  function mascotSrc(step) {
    if (step && step.mascot) return step.mascot;
    try { if (window.TB_CONFIG && window.TB_CONFIG.mascot) return window.TB_CONFIG.mascot; } catch (_) {}
    return ls("tb.mascot") || "";        // localStorage: try art without a redeploy
  }

  var PENGUIN =
    '<svg class="tg-bird" viewBox="0 0 64 76" width="58" height="69" aria-hidden="true">' +
      '<ellipse cx="32" cy="70" rx="17" ry="5" fill="#12101A" opacity=".10"/>' +
      /* feet */
      '<path d="M20 62 q-6 5 -1 7 h10 q3 -3 -2 -7 z" fill="#FF3D77"/>' +
      '<path d="M44 62 q6 5 1 7 h-10 q-3 -3 2 -7 z" fill="#FF3D77"/>' +
      /* body */
      '<path d="M32 6 c14 0 21 12 21 27 v14 c0 11 -9 19 -21 19 s-21 -8 -21 -19 v-14 c0 -15 7 -27 21 -27 z" fill="#12101A"/>' +
      /* belly */
      '<path d="M32 22 c8 0 13 8 13 19 v6 c0 8 -5 14 -13 14 s-13 -6 -13 -14 v-6 c0 -11 5 -19 13 -19 z" fill="#FFFCF5"/>' +
      /* wings */
      '<path d="M11 34 c-4 6 -4 16 -1 22 c2 4 5 3 5 -1 v-20 c0 -3 -3 -4 -4 -1 z" fill="#12101A"/>' +
      '<path d="M53 34 c4 6 4 16 1 22 c-2 4 -5 3 -5 -1 v-20 c0 -3 3 -4 4 -1 z" fill="#12101A"/>' +
      /* eyes */
      '<circle cx="25" cy="24" r="4.6" fill="#FFFCF5"/><circle cx="39" cy="24" r="4.6" fill="#FFFCF5"/>' +
      '<circle class="tg-eye" cx="26" cy="25" r="2.3" fill="#12101A"/>' +
      '<circle class="tg-eye" cx="40" cy="25" r="2.3" fill="#12101A"/>' +
      /* beak */
      '<path d="M32 30 l5 5 l-5 4 l-5 -4 z" fill="#FF3D77"/>' +
      /* scarf: a route line with two station dots, same as the mark */
      '<path d="M17 44 h30" stroke="#2F7BFF" stroke-width="6" stroke-linecap="round" fill="none"/>' +
      '<path d="M45 44 l7 9" stroke="#2F7BFF" stroke-width="5" stroke-linecap="round" fill="none"/>' +
      '<circle cx="24" cy="44" r="2.4" fill="#FFFCF5"/>' +
      '<circle cx="38" cy="44" r="2.4" fill="#FFFCF5"/>' +
    '</svg>';

  var CSS =
  /* Dim only, never blur. The board is live the whole time the tour is running
     and the point of most steps is to look at it — blurring the thing you are
     being shown defeats the tour. */
  '.tg-scrim{position:fixed; top:0;right:0;bottom:0;left:0;inset:0; z-index:100000; background:rgba(10,8,16,.58);' +
    'opacity:0; transition:opacity .25s ease}' +
  '.tg-scrim.in{opacity:1}' +
  /* The spotlight is one element with an enormous spread shadow, so the "hole"
     is genuinely transparent and the live board keeps animating inside it. */
  '.tg-spot{position:fixed; z-index:100001; border-radius:12px; pointer-events:none;' +
    'box-shadow:0 0 0 9999px rgba(10,8,16,.62), 0 0 0 2px #FF3D77 inset;' +
    'transition:top .3s ease, left .3s ease, width .3s ease, height .3s ease; display:none}' +
  '.tg-card{position:fixed; z-index:100002; width:min(400px, calc(100vw - 32px));' +
    'background:#FFFCF5; color:#12101A; border-radius:16px; padding:18px 20px 16px;' +
    'box-shadow:0 24px 70px rgba(0,0,0,.5); font-family:var(--body,system-ui);' +
    'opacity:0; transform:translateY(8px); transition:opacity .25s ease, transform .25s ease}' +
  '.tg-card.in{opacity:1; transform:none}' +
  '.tg-top{display:flex; align-items:flex-start; gap:14px}' +
  '.tg-bird{flex:none; margin-top:-6px}' +
  '@keyframes tg-blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}' +
  '.tg-eye{transform-origin:center; transform-box:fill-box; animation:tg-blink 5.5s ease-in-out infinite}' +
  '.tg-count{font-family:var(--mono,monospace); font-size:11px; font-weight:600; letter-spacing:.14em;' +
    'text-transform:uppercase; color:#6E6A78}' +
  /* Display type is uppercase and never below 24px, per the guide. */
  '.tg-title{font-family:var(--display,system-ui); font-weight:800; font-size:24px; line-height:1.1;' +
    'letter-spacing:-.02em; text-transform:uppercase; margin:4px 0 0; color:#12101A}' +
  '.tg-body{font-size:14.5px; line-height:1.5; color:#3A3646; margin:8px 0 0}' +
  '.tg-body b{color:#12101A}' +
  '.tg-acts{display:flex; align-items:center; gap:8px; margin-top:16px}' +
  '.tg-btn{font-family:inherit; font-size:14px; font-weight:700; border-radius:10px; padding:9px 16px;' +
    'cursor:pointer; border:1px solid transparent; background:#12101A; color:#FFFCF5}' +
  '.tg-btn:hover{background:#2F7BFF}' +
  '.tg-btn.ghost{background:transparent; color:#12101A; border-color:#E7E1D4}' +
  '.tg-btn.ghost:hover{background:#F2EEE4; color:#12101A}' +
  '.tg-skip{margin-left:auto; background:none; border:0; color:#6E6A78; font-family:inherit;' +
    'font-size:13px; font-weight:600; cursor:pointer; padding:6px}' +
  '.tg-skip:hover{color:#12101A; text-decoration:underline}' +
  '@media (max-width:560px){ .tg-card{left:16px !important; right:16px; width:auto; bottom:16px !important; top:auto !important} }';

  /* ---- steps ---------------------------------------------------------------
     Anything whose `el` matches nothing is skipped, so one list serves every
     board: a city without a Spotter link, or a board with no departures on
     screen yet, simply never sees that step. */
  var STEPS = [
    {
      title: "Welcome aboard",
      body: "Your license is active, so every board is live. Here is the 60-second tour — " +
            "you can leave at any point, and replay it later from Settings.",
    },
    {
      el: ".city-picker select",
      title: "Change city",
      body: "Eleven cities share this board. Pick one here and everything — map, departures, " +
            "alerts — switches with it.",
    },
    {
      el: "#nightBtn",
      title: "Sky view",
      body: "A full-screen view of the single nearest aircraft: where it came from, where it is going, " +
            "and its real flight path. It also does trains, buses and the space station.",
    },
    {
      el: "#settingsBtn",
      title: "Your location",
      body: "Everything is measured from one spot. Open Settings to type an address, use your current " +
            "location, or jump to a suggested place in the city.",
      before: function () { if (typeof window.openSetup === "function") { try { window.openSetup(); } catch (_) {} } },
    },
    {
      el: "#setup .suggest-row",
      title: "Suggested places",
      body: "One tap moves the board to a station, a district or the airport. The highlighted one is " +
            "where you are pointed now.",
      after: function () { if (typeof window.closeSetup === "function") { try { window.closeSetup(); } catch (_) {} } },
    },
    {
      el: ".row.followable",
      title: "Follow anything",
      body: "Tap any departure and the map follows that train or bus along its whole route. " +
            "Clicking a vehicle on the map does the same.",
    },
    {
      el: "#map",
      title: "The live map",
      body: "Real positions, moving as they move. Weather radar sits underneath, and the button in the " +
            "corner makes the map full screen.",
    },
    {
      title: "That is the tour",
      body: "Settings has themes, which boxes to show, and this tour again whenever you want it. " +
            "Everything you change stays on this screen only.",
    },
  ];

  var idx = 0, scrim, spot, card, steps, onKey, lastStep;

  function usable(s) { return !s.el || !!$(s.el); }

  function place(target) {
    var pad = 8, r = target ? target.getBoundingClientRect() : null;
    if (r && r.width && r.height) {
      spot.style.display = "block";
      spot.style.top = (r.top - pad) + "px";
      spot.style.left = (r.left - pad) + "px";
      spot.style.width = (r.width + pad * 2) + "px";
      spot.style.height = (r.height + pad * 2) + "px";
    } else {
      spot.style.display = "none";
    }
    // Card goes below the target when there is room, above when there is not,
    // and dead centre when the step has no anchor at all.
    var cw = card.offsetWidth || 380, ch = card.offsetHeight || 220, gap = 16;
    var top, left;
    if (r && r.width) {
      top = r.bottom + gap;
      if (top + ch > window.innerHeight - 12) top = r.top - ch - gap;
      if (top < 12) top = Math.max(12, (window.innerHeight - ch) / 2);
      left = r.left + r.width / 2 - cw / 2;
    } else {
      top = (window.innerHeight - ch) / 2;
      left = (window.innerWidth - cw) / 2;
    }
    left = Math.max(12, Math.min(left, window.innerWidth - cw - 12));
    card.style.top = Math.round(top) + "px";
    card.style.left = Math.round(left) + "px";
  }

  function render() {
    var s = steps[idx];
    if (lastStep && lastStep.after) { try { lastStep.after(); } catch (_) {} }
    if (s.before) { try { s.before(); } catch (_) {} }
    lastStep = s;

    card.innerHTML =
      '<div class="tg-top"><span class="tg-bird"></span>' +
        '<div><div class="tg-count">Step ' + (idx + 1) + ' of ' + steps.length + '</div>' +
        '<h2 class="tg-title"></h2><p class="tg-body"></p></div></div>' +
      '<div class="tg-acts">' +
        (idx > 0 ? '<button class="tg-btn ghost" data-tg="back" type="button">Back</button>' : "") +
        '<button class="tg-btn" data-tg="next" type="button">' +
          (idx === steps.length - 1 ? "Start using it" : "Next") + '</button>' +
        '<button class="tg-skip" data-tg="skip" type="button">' +
          (idx === steps.length - 1 ? "" : "Skip tour") + '</button>' +
      '</div>';
    // textContent, not innerHTML: step copy is ours today, but a board could
    // one day pass a station name in here and that must never become markup.
    card.querySelector(".tg-title").textContent = s.title;
    card.querySelector(".tg-body").textContent = s.body;
    // The cast takes turns as the tour goes, so all three characters get an
    // introduction rather than one of them doing all the talking.
    var slot = card.querySelector(".tg-bird");
    if (slot && window.TBMascot) {
      slot.replaceWith(window.TBMascot.el({ width: 58, src: s.mascot, index: idx }));
    } else if (slot) {
      slot.outerHTML = PENGUIN;
    }

    // Place immediately, then refine. The refinement matters because a step may
    // have just opened a panel and the target's final geometry is a frame away;
    // the immediate call matters because requestAnimationFrame does not fire at
    // all in a hidden or throttled tab, and a tour that only positions itself
    // inside rAF would sit unplaced in the corner until the next resize.
    var t = s.el ? $(s.el) : null;
    if (t && t.scrollIntoView) { try { t.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (_) {} }
    place(t);
    requestAnimationFrame(function () { place(t); });
    setTimeout(function () { place(s.el ? $(s.el) : null); }, 180);
  }

  function finish() {
    lset(DONE, VERSION);                       // completing and skipping both count
    if (lastStep && lastStep.after) { try { lastStep.after(); } catch (_) {} }
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    var s = scrim, sp = spot, c = card;        // captured: a restart may reassign them
    if (s) s.classList.remove("in");
    if (c) c.classList.remove("in");
    setTimeout(function () {
      [s, sp, c].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    }, 260);
  }

  function onResize() { var s = steps[idx]; place(s && s.el ? $(s.el) : null); }

  /* Tear down anything already on screen before opening. Without this, a second
     "Show me around" stacks a whole second tour: two cards, two scrims, and two
     keydown listeners, so one arrow press advances both and Escape only closes
     the newer one. */
  function clear() {
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    [".tg-scrim", ".tg-spot", ".tg-card"].forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (n) { n.remove(); });
    });
  }

  function start() {
    steps = STEPS.filter(usable);
    if (steps.length < 2) return;              // nothing worth touring
    clear();
    idx = 0; lastStep = null;

    if (!document.getElementById("tg-css")) {
      var st = document.createElement("style"); st.id = "tg-css"; st.textContent = CSS;
      document.head.appendChild(st);
    }
    scrim = document.createElement("div"); scrim.className = "tg-scrim";
    spot  = document.createElement("div"); spot.className  = "tg-spot";
    card  = document.createElement("div"); card.className  = "tg-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", "Guided tour");
    document.body.append(scrim, spot, card);

    card.addEventListener("click", function (e) {
      var b = e.target.closest("[data-tg]"); if (!b) return;
      var a = b.getAttribute("data-tg");
      if (a === "skip") return finish();
      if (a === "back") { idx = Math.max(0, idx - 1); return render(); }
      if (idx >= steps.length - 1) return finish();
      idx++; render();
    });
    onKey = function (e) {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" && idx < steps.length - 1) { idx++; render(); }
      else if (e.key === "ArrowLeft" && idx > 0) { idx--; render(); }
    };
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);

    render();
    requestAnimationFrame(function () { scrim.classList.add("in"); card.classList.add("in"); });
  }

  /* Auto-run: only once, and only for someone who has actually bought in. When
     licensing is dormant the board behaves as licensed, so first visit is the
     right trigger there instead. Delayed so the first data has landed and the
     board is not still saying "locating…" behind the card. */
  function maybeAuto() {
    if (ls(DONE) === VERSION) return;
    var lic = window.TBLicense;
    if (lic && lic.configured && !lic.licensed) return;   // still evaluating
    setTimeout(start, 1400);
  }

  /* ---- the Settings entry --------------------------------------------------
     Injected rather than written into eleven settings panels by hand — they do
     not share markup, and a replay button is not worth eleven near-identical
     edits that can drift. It is added the first time Settings opens, because
     groupSettings() reshuffles that panel's children on first open and anything
     placed earlier would be swept into the wrong group. */
  function addSettingsEntry() {
    var box = $("#setup .box"); if (!box || box.dataset.tgAdded) return;
    box.dataset.tgAdded = "1";
    var lbl = document.createElement("div");
    lbl.className = "section-lbl"; lbl.textContent = "Guided tour";
    var p = document.createElement("p");
    p.style.cssText = "font-size:12px; margin:6px 0 8px";
    p.textContent = "A quick walk through changing city, Sky view, your location and following a vehicle.";
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "ghost"; btn.textContent = "Show me around";
    btn.onclick = function () {
      if (typeof window.closeSetup === "function") { try { window.closeSetup(); } catch (_) {} }
      setTimeout(start, 260);            // let the panel finish closing first
    };
    var group = document.createElement("div");
    group.className = "set-group";
    group.append(lbl, p, btn);
    var body = box.querySelector(".set-body");
    (body || box).appendChild(group);
  }
  function hookSettings() {
    var b = document.getElementById("settingsBtn"); if (!b) return;
    b.addEventListener("click", function () { setTimeout(addSettingsEntry, 60); });
  }

  window.TBTour = { start: start, reset: function () { lset(DONE, ""); } };

  function boot() { hookSettings(); maybeAuto(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
