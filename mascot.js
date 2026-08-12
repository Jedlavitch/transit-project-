/* ============================================================================
   mascot.js — the guide character, in one place.

   Two things use it: the first-run tour (tour-guide.js) and the Spotted card's
   collection strip (spotlog.js). Keeping the artwork and the "which file do we
   draw?" question here means commissioned art drops in once and appears in
   both, and the placeholder can never drift between them.

   USING YOUR OWN ARTWORK — no code change:
       config.js:            mascot: "brand/mascot.svg"
       one tour step:        { mascot: "brand/mascot-map.svg", … }
       trying art quickly:   localStorage.setItem("tb.mascot", "brand/x.svg")

   SVG or PNG both work. It is drawn into a box of the requested size and should
   read at 34px as well as 58px, since the Spotted card uses the small end. A
   file that fails to load falls back to the placeholder rather than leaving a
   broken image on a paying customer's screen.

   The placeholder is a penguin drawn in the brand palette. Its scarf is a route
   line with two station dots — the mark's own vocabulary, so it belongs to this
   brand rather than being a generic cartoon.
   ========================================================================== */
(function () {
  "use strict";

  var INK = "#12101A", PAPER = "#FFFCF5", PINK = "#FF3D77", BLUE = "#2F7BFF";

  function penguin(w, h) {
    return '' +
      '<svg class="tb-mascot" viewBox="0 0 64 76" width="' + w + '" height="' + h + '" aria-hidden="true">' +
        '<ellipse cx="32" cy="70" rx="17" ry="5" fill="' + INK + '" opacity=".10"/>' +
        '<path d="M20 62 q-6 5 -1 7 h10 q3 -3 -2 -7 z" fill="' + PINK + '"/>' +
        '<path d="M44 62 q6 5 1 7 h-10 q-3 -3 2 -7 z" fill="' + PINK + '"/>' +
        '<path d="M32 6 c14 0 21 12 21 27 v14 c0 11 -9 19 -21 19 s-21 -8 -21 -19 v-14 c0 -15 7 -27 21 -27 z" fill="' + INK + '"/>' +
        '<path d="M32 22 c8 0 13 8 13 19 v6 c0 8 -5 14 -13 14 s-13 -6 -13 -14 v-6 c0 -11 5 -19 13 -19 z" fill="' + PAPER + '"/>' +
        '<path d="M11 34 c-4 6 -4 16 -1 22 c2 4 5 3 5 -1 v-20 c0 -3 -3 -4 -4 -1 z" fill="' + INK + '"/>' +
        '<path d="M53 34 c4 6 4 16 1 22 c-2 4 -5 3 -5 -1 v-20 c0 -3 3 -4 4 -1 z" fill="' + INK + '"/>' +
        '<circle cx="25" cy="24" r="4.6" fill="' + PAPER + '"/><circle cx="39" cy="24" r="4.6" fill="' + PAPER + '"/>' +
        '<circle class="tb-eye" cx="26" cy="25" r="2.3" fill="' + INK + '"/>' +
        '<circle class="tb-eye" cx="40" cy="25" r="2.3" fill="' + INK + '"/>' +
        '<path d="M32 30 l5 5 l-5 4 l-5 -4 z" fill="' + PINK + '"/>' +
        '<path d="M17 44 h30" stroke="' + BLUE + '" stroke-width="6" stroke-linecap="round" fill="none"/>' +
        '<path d="M45 44 l7 9" stroke="' + BLUE + '" stroke-width="5" stroke-linecap="round" fill="none"/>' +
        '<circle cx="24" cy="44" r="2.4" fill="' + PAPER + '"/>' +
        '<circle cx="38" cy="44" r="2.4" fill="' + PAPER + '"/>' +
      '</svg>';
  }

  /* The cast. There are three characters, so this is a list rather than one
     file: the tour walks through them as it goes, and the Spotted card keeps
     whichever one you picked, which turns "a logo" into "your companion".
     A single `mascot:` string still works and is treated as a cast of one. */
  /* All three are front-facing and symmetrical on purpose. The first pass had a
     camel and a llama drawn in profile, and they turned to mush in the Spotted
     card — at 34px a side-on quadruped is a blob with legs, while a face with
     two big eyes still reads. Each takes one brand colour so the set is
     distinguishable at a glance even when it is tiny. */
  var DEFAULT_CAST = [
    "brand/mascot-penguin.svg",   // ink + blue
    "brand/mascot-fox.svg",       // pink
    "brand/mascot-owl.svg",       // teal
  ];
  function list() {
    var c = null;
    try { c = window.TB_CONFIG || null; } catch (_) {}
    if (c && Array.isArray(c.mascots) && c.mascots.length) return c.mascots.slice();
    if (c && c.mascot) return [c.mascot];
    var one = "";
    try { one = localStorage.getItem("tb.mascot") || ""; } catch (_) {}
    if (one) return [one];
    return DEFAULT_CAST.slice();
  }
  function src(override, index) {
    if (override) return override;
    var l = list();
    if (!l.length) return "";
    var i = typeof index === "number" ? ((index % l.length) + l.length) % l.length : 0;
    return l[i];
  }
  /* Which character is "yours". Remembered per device, and cycled by clicking
     the mascot on the Spotted card. */
  function pickIndex() {
    var v = 0;
    try { v = parseInt(localStorage.getItem("tb.mascotPick") || "0", 10) || 0; } catch (_) {}
    var n = list().length || 1;
    return ((v % n) + n) % n;
  }
  function cycle() {
    var next = pickIndex() + 1;
    try { localStorage.setItem("tb.mascotPick", String(next)); } catch (_) {}
    return pickIndex();
  }

  /* Always returns the SAME wrapper element, with the artwork swapped inside it.
     Returning the <img> directly meant the fallback had to replace that node —
     taking the caller's class, title and click handler with it, so a board whose
     artwork had not been deployed yet lost the tap-to-change behaviour and the
     styling along with the image. The wrapper is the caller's handle and never
     goes away; only its contents change. */
  function el(opts) {
    opts = opts || {};
    var w = opts.width || 58, h = opts.height || Math.round(w * 76 / 64);
    var file = src(opts.src, typeof opts.index === "number" ? opts.index : undefined);
    var box = document.createElement("span");
    box.style.cssText = "display:inline-flex; flex:none; line-height:0";
    if (!file) { box.innerHTML = penguin(w, h); return box; }
    var img = document.createElement("img");
    img.alt = ""; img.width = w; img.height = h;
    img.style.cssText = "display:block; object-fit:contain";
    img.onerror = function () { box.innerHTML = penguin(w, h); };
    box.appendChild(img);
    img.src = file;                     // set last: onerror must be attached first
    return box;
  }

  /* ---- what the mascot says ------------------------------------------------
     A board is a thing people glance at fifty times a day, so the line has to
     earn its place fifty times: short, dry, and about something that is
     actually true right now. Three sources, in priority order — a milestone you
     just hit, the state of your collection, then the time of day — so the line
     is never generic when it could be specific. No emoji, per the brand guide.

     Deliberately NOT jokes-at-random: the same gag on a wall display at 3pm and
     again at 3:05 stops being a gag. Lines are chosen from the bucket that fits,
     and rotate slowly. */
  var SAY = {
    empty: [
      "Nothing logged yet. Tap Spotted to add your first.",
      "The log is empty. Something is going past right now.",
    ],
    full: [
      "Rail, road and air. That is the full set.",
      "Every mode logged. Not many people do that.",
    ],
    milestone: {
      1:   ["First one logged. It begins."],
      10:  ["Ten sightings. You are properly at it now."],
      25:  ["Twenty-five logged. That is a habit."],
      50:  ["Fifty. Consider a spreadsheet."],
      100: ["One hundred sightings. Genuinely impressive."],
    },
    ridden: [
      "You have actually ridden a few of these. Respect.",
      "Logged and ridden is the harder half.",
    ],
    dawn: [
      "First trains are out. Nobody else is.",
      "Early. The good light is now.",
    ],
    rush: [
      "Rush hour. Everything at once.",
      "Peak service. The map earns its keep.",
    ],
    midday: [
      "Quiet stretch. Good time to catch a rare one.",
      "Off peak. Everything runs a little looser.",
    ],
    evening: [
      "Evening peak. Home time for most of the fleet.",
      "The busy hour again, in reverse.",
    ],
    night: [
      "Late service. Fewer trains, longer waits.",
      "Night shift. The night owls are still running.",
    ],
  };

  function pickFrom(arr, salt) {
    if (!arr || !arr.length) return "";
    // Rotates every 5 minutes, so a wall display changes through the day
    // without ever flickering between lines while someone is reading it.
    var slot = Math.floor(Date.now() / 300000) + (salt || 0);
    return arr[((slot % arr.length) + arr.length) % arr.length];
  }

  /* ctx: { total, today, ridden, modesGot, modesAll, hour } */
  function line(ctx) {
    ctx = ctx || {};
    var total = ctx.total || 0, hour = typeof ctx.hour === "number" ? ctx.hour : new Date().getHours();
    if (!total) return pickFrom(SAY.empty);
    // A milestone only speaks on the exact number, so it reads as "you just did
    // that" rather than as a permanent label.
    if (SAY.milestone[total]) return pickFrom(SAY.milestone[total]);
    if (ctx.modesAll && ctx.modesGot === ctx.modesAll) return pickFrom(SAY.full);
    if (ctx.ridden >= 3 && (Math.floor(Date.now() / 300000) % 4 === 0)) return pickFrom(SAY.ridden, 1);
    if (hour < 6) return pickFrom(SAY.night);
    if (hour < 9) return pickFrom(SAY.dawn);
    if (hour < 10) return pickFrom(SAY.rush);
    if (hour < 16) return pickFrom(SAY.midday);
    if (hour < 19) return pickFrom(SAY.evening);
    if (hour < 23) return pickFrom(SAY.midday, 2);
    return pickFrom(SAY.night, 1);
  }

  window.TBMascot = { el: el, svg: penguin, src: src, list: list,
                      pickIndex: pickIndex, cycle: cycle, line: line };

  // Blink, shared by every placement. Only the placeholder has eyes to blink;
  // supplied artwork is left exactly as drawn.
  if (!document.getElementById("tb-mascot-css")) {
    var st = document.createElement("style");
    st.id = "tb-mascot-css";
    st.textContent =
      "@keyframes tb-blink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.1)}}" +
      ".tb-eye{transform-origin:center; transform-box:fill-box; animation:tb-blink 5.5s ease-in-out infinite}";
    (document.head || document.documentElement).appendChild(st);
  }
})();
