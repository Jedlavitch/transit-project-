/* ============================================================================
   clock-faces.js — the header clock, in more than one design.

   WHY A SHARED FILE. The clock markup and its tick live in twelve separate
   board files, identically. Adding designs there would mean twelve copies of
   the same renderer and the same drift fit-cards.js's header already warns
   about: a fix lands on one board and the other eleven keep the bug. Nothing
   here is board-specific, so it belongs in one file every board loads.

   THE ONE IDEA WORTH KNOWING: a face does not read the system clock. It reads
   the TEXT the board has already written into #clock, and re-renders that.

   That sounds indirect and it is the whole trick. Each board computes its own
   time -- Amsterdam in Europe/Amsterdam, San Francisco and Los Angeles in
   their own city zones, Cologne and the stencil off a per-board CFG.tz, DC off
   the viewer's clock -- and half of them are 24-hour while the rest follow the
   browser locale. A face that called `new Date()` would silently disagree with
   the board it sits on, and would disagree WORST on exactly the boards whose
   whole point is showing another city's time. Parsing what is already on
   screen inherits every one of those decisions for free, correctly, including
   any board added later that invents a new rule.

   So the board keeps writing #clock every second and owns the truth; this file
   only ever re-draws it. When the digital face is selected it does not draw at
   all -- #clock is shown exactly as the board wrote it, which is why "Digital"
   is not a reimplementation of the old clock but literally the old clock.

   Faces: digital (default), analog, flip, minimal, words.
   Settings: Display -> "Clock face" and "Clock size", stored in the shared
   tb.* namespace next to tb.theme / tb.accent / tb.style, because which clock
   you like is a person's preference, not a city's.
   ========================================================================= */
(function () {
  "use strict";

  var FACES = [
    ["digital", "Digital"],
    ["analog",  "Analog"],
    ["flip",    "Flip"],
    ["minimal", "Minimal"],
    ["words",   "Words"]
  ];
  var SIZES = [["s", "Small"], ["m", "Medium"], ["l", "Large"]];

  var FACE_IDS = FACES.map(function (f) { return f[0]; });
  var SIZE_IDS = SIZES.map(function (s) { return s[0]; });

  function ls(k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var face = ls("tb.clockFace", "digital");
  var size = ls("tb.clockSize", "m");
  if (FACE_IDS.indexOf(face) < 0) face = "digital";
  if (SIZE_IDS.indexOf(size) < 0) size = "m";

  /* ---- is this a board with the header clock this file understands? -------
     night.html and flipboard.html both have an element called #clock, but it
     is a bare <span class="clock" id="clock"> with no .time/.meta inside --
     a different object that happens to share a name. Requiring the city-board
     shape means those two are left alone rather than half-restyled. */
  function host() {
    var t = document.getElementById("clock");
    if (!t || !t.classList.contains("time")) return null;
    var wrap = t.parentNode;
    if (!wrap || !wrap.classList || !wrap.classList.contains("clock")) return null;
    return wrap;
  }

  /* ---- read the board's own clock ---------------------------------------
     Accepts "01:07:47 PM", "13:07:47" and "13:07" alike. Returns 24-hour
     numbers plus whether the board is running a 12-hour display, so a face can
     match the board's convention instead of imposing one. */
  function readClock() {
    var t = document.getElementById("clock");
    if (!t) return null;
    var m = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])/.exec(t.textContent || "")
         || /(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(t.textContent || "");
    if (!m) return null;
    var h = +m[1], mi = +m[2], s = m[3] ? +m[3] : 0, ap = m[4] || null;
    if (ap) {                       /* 12-hour board: fold to 24 for the maths */
      var pm = /p/i.test(ap);
      if (h === 12) h = 0;
      if (pm) h += 12;
    }
    return { h: h, m: mi, s: s, half: ap ? (/p/i.test(ap) ? "PM" : "AM") : null };
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* ---- CSS ---------------------------------------------------------------
     Injected rather than shipped in theme.css for the reason fit-cards.js
     gives: an injected <style> lands after every board's own inline <style>,
     so these win ties on source order without an arms race of `body`
     qualifiers. Sizes: Medium deliberately sets NOTHING on the board's own
     .time, so it keeps the boards' existing responsive rules (28px, 22px at
     the narrow breakpoint) untouched. Only Small and Large override. */
  var CSS = [
    ':root{ --clock-scale:1 }',
    ':root[data-clock-size="s"]{ --clock-scale:.78 }',
    ':root[data-clock-size="l"]{ --clock-scale:1.35 }',
    ':root[data-clock-size="s"] header .clock .time{ font-size:22px }',
    ':root[data-clock-size="l"] header .clock .time{ font-size:38px }',

    /* Every face is hidden until its own rule shows it, so an unknown value in
       localStorage degrades to the board's plain clock rather than to nothing. */
    'header .clock .tb-face{ display:none }',
    ':root:not([data-clock="digital"]) header .clock .time{ display:none }',
    ':root[data-clock="minimal"] header .clock .meta{ display:none }',

    /* ANALOG. The face sits beside the meta line rather than above it: stacked,
       a square face plus the two-line meta pushed the 60px clock block past the
       88px header and moved the whole board down. Side by side it is as tall as
       the face alone. */
    ':root[data-clock="analog"] header .clock{ display:flex; align-items:center;',
    '  justify-content:flex-end; gap:10px; text-align:right }',
    ':root[data-clock="analog"] header .clock .tb-face-analog{ display:block;',
    '  width:calc(46px * var(--clock-scale)); height:calc(46px * var(--clock-scale));',
    '  flex:0 0 auto }',
    /* Stroke and fill as CSS, not SVG attributes -- attributes cannot read a
       custom property, so an accent change would not reach the hands. */
    '.tb-cl-dial{ fill:none; stroke:var(--line,#2a3550); stroke-width:2 }',
    '.tb-cl-tick{ stroke:var(--muted,#8fa0bd); stroke-width:2; stroke-linecap:round }',
    '.tb-cl-tick.maj{ stroke:var(--text,#eef3ff); stroke-width:3.4 }',
    '.tb-cl-h,.tb-cl-m{ stroke:var(--text,#eef3ff); stroke-linecap:round }',
    '.tb-cl-h{ stroke-width:5.5 } .tb-cl-m{ stroke-width:3.6 }',
    '.tb-cl-s{ stroke:var(--accent,#4ea1ff); stroke-width:1.8; stroke-linecap:round }',
    '.tb-cl-pin{ fill:var(--accent,#4ea1ff) }',

    /* FLIP. Hours and minutes only. A real Solari board has no second hand,
       and a tile turning over every second on a wall display is movement in
       the corner of the eye all day -- the same reason the seconds come off
       the Minimal face. */
    ':root[data-clock="flip"] header .clock .tb-face-flip{ display:flex;',
    '  align-items:center; justify-content:flex-end; gap:3px }',
    '.tb-flap{ position:relative; overflow:hidden; border-radius:2px;',
    '  width:calc(21px * var(--clock-scale)); height:calc(30px * var(--clock-scale));',
    '  background:linear-gradient(180deg,#1b2233,#12172480);',
    '  box-shadow:inset 0 0 0 1px rgba(0,0,0,.75), 0 1px 0 rgba(255,255,255,.05) }',
    ':root[data-theme="day"] .tb-flap{ background:linear-gradient(180deg,#e9edf6,#dbe2ef);',
    '  box-shadow:inset 0 0 0 1px rgba(0,0,0,.18) }',
    '.tb-flap::after{ content:""; position:absolute; left:0; right:0; top:50%; height:1px;',
    '  background:rgba(0,0,0,.55); transform:translateY(-.5px); z-index:2 }',
    '.tb-flap .ch{ display:flex; align-items:center; justify-content:center;',
    '  width:100%; height:100%; font-family:var(--mono,monospace); font-weight:700;',
    '  font-size:calc(20px * var(--clock-scale)); line-height:1; color:var(--text,#eef3ff);',
    '  transform-origin:center; backface-visibility:hidden }',
    '.tb-flap.flipping .ch{ animation:tbFlapTurn .11s linear }',
    '@keyframes tbFlapTurn{ 0%{transform:rotateX(0)} 50%{transform:rotateX(-90deg)} 100%{transform:rotateX(0)} }',
    '.tb-flap-sep{ font-family:var(--mono,monospace); font-weight:700; opacity:.5;',
    '  font-size:calc(18px * var(--clock-scale)); padding:0 1px }',
    '.tb-flap-half{ font-family:var(--mono,monospace); font-size:calc(10px * var(--clock-scale));',
    '  color:var(--muted,#8fa0bd); letter-spacing:.08em; margin-left:3px }',

    /* MINIMAL. Hours and minutes, nothing under it. */
    ':root[data-clock="minimal"] header .clock .tb-face-minimal{ display:block;',
    '  font-family:var(--mono,monospace); font-weight:700; line-height:1;',
    '  font-variant-numeric:tabular-nums; letter-spacing:-.02em;',
    '  font-size:calc(42px * var(--clock-scale)); color:var(--text,#eef3ff) }',
    '.tb-face-minimal .half{ font-size:.42em; color:var(--muted,#8fa0bd);',
    '  letter-spacing:.08em; margin-left:.28em; vertical-align:.28em }',

    /* WORDS. */
    ':root[data-clock="words"] header .clock .tb-face-words{ display:block;',
    '  font-size:calc(20px * var(--clock-scale)); line-height:1.15; font-weight:600;',
    '  color:var(--text,#eef3ff); max-width:15em; margin-left:auto }',
    '.tb-face-words .half{ color:var(--muted,#8fa0bd); font-weight:400 }'
  ].join("\n");

  function styleOnce() {
    if (document.getElementById("tb-clock-css")) return;
    var s = document.createElement("style");
    s.id = "tb-clock-css";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ---- the faces ---------------------------------------------------------- */
  var SVG_NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, attrs[k]);
    return e;
  }

  var els = {};          /* built once, kept, re-used on every tick */

  function buildAnalog() {
    var s = svg("svg", { viewBox: "0 0 100 100", "class": "tb-face tb-face-analog" });
    s.appendChild(svg("circle", { "class": "tb-cl-dial", cx: 50, cy: 50, r: 47 }));
    for (var i = 0; i < 12; i++) {
      var a = i * 30 * Math.PI / 180, maj = i % 3 === 0;
      var r1 = maj ? 36 : 40, r2 = 44;
      s.appendChild(svg("line", {
        "class": "tb-cl-tick" + (maj ? " maj" : ""),
        x1: 50 + Math.sin(a) * r1, y1: 50 - Math.cos(a) * r1,
        x2: 50 + Math.sin(a) * r2, y2: 50 - Math.cos(a) * r2
      }));
    }
    /* Hands are drawn straight up and rotated on each tick, so only one
       attribute changes per hand per second. */
    els.hh = svg("line", { "class": "tb-cl-h", x1: 50, y1: 54, x2: 50, y2: 27 });
    els.mh = svg("line", { "class": "tb-cl-m", x1: 50, y1: 56, x2: 50, y2: 15 });
    els.sh = svg("line", { "class": "tb-cl-s", x1: 50, y1: 60, x2: 50, y2: 13 });
    s.appendChild(els.hh); s.appendChild(els.mh); s.appendChild(els.sh);
    s.appendChild(svg("circle", { "class": "tb-cl-pin", cx: 50, cy: 50, r: 3 }));
    return s;
  }

  function buildFlip() {
    var w = document.createElement("div");
    w.className = "tb-face tb-face-flip";
    els.flaps = [];
    /* Four tiles and a separator: H H : M M. */
    [0, 1, -1, 2, 3].forEach(function (n) {
      if (n === -1) {
        var sep = document.createElement("span");
        sep.className = "tb-flap-sep";
        sep.textContent = ":";
        w.appendChild(sep);
        return;
      }
      var tile = document.createElement("div");
      tile.className = "tb-flap";
      var ch = document.createElement("div");
      ch.className = "ch";
      ch.textContent = "-";
      tile.appendChild(ch);
      w.appendChild(tile);
      els.flaps.push(tile);
    });
    els.flipHalf = document.createElement("span");
    els.flipHalf.className = "tb-flap-half";
    w.appendChild(els.flipHalf);
    return w;
  }

  /* One character of the flip face. The text swaps at the animation's midpoint,
     while the tile is edge-on and the glyph is not readable -- swapping at the
     start would just be a fade with extra steps. */
  function setFlap(tile, chr) {
    var ch = tile.firstChild;
    if (ch.textContent === chr) return;
    tile.classList.remove("flipping");
    void tile.offsetWidth;                 /* restart the animation */
    tile.classList.add("flipping");
    setTimeout(function () { ch.textContent = chr; }, 55);
  }

  var WORDS_H = ["twelve", "one", "two", "three", "four", "five",
                 "six", "seven", "eight", "nine", "ten", "eleven"];
  var WORDS_M = ["{h} o'clock", "five past {h}", "ten past {h}", "quarter past {h}",
                 "twenty past {h}", "twenty-five past {h}", "half past {h}",
                 "twenty-five to {n}", "twenty to {n}", "quarter to {n}",
                 "ten to {n}", "five to {n}"];

  function words(t) {
    var slot = Math.round(t.m / 5) % 12;
    var carry = Math.round(t.m / 5) >= 12 ? 1 : 0;     /* 58 min rounds into the next hour */
    var h = (t.h + carry) % 24;
    var next = (h + 1) % 24;
    return WORDS_M[slot]
      .replace("{h}", WORDS_H[h % 12])
      .replace("{n}", WORDS_H[next % 12]);
  }

  /* ---- draw --------------------------------------------------------------- */
  function draw() {
    if (face === "digital") return;             /* the board's own clock, untouched */
    var t = readClock();
    if (!t) return;
    var h12 = t.half ? (t.h % 12 || 12) : t.h;

    if (face === "analog" && els.hh) {
      var hd = (t.h % 12) * 30 + t.m * 0.5,
          md = t.m * 6 + t.s * 0.1,
          sd = t.s * 6;
      els.hh.setAttribute("transform", "rotate(" + hd + " 50 50)");
      els.mh.setAttribute("transform", "rotate(" + md + " 50 50)");
      els.sh.setAttribute("transform", "rotate(" + sd + " 50 50)");
    } else if (face === "flip" && els.flaps) {
      var str = pad(h12) + pad(t.m);
      for (var i = 0; i < 4; i++) setFlap(els.flaps[i], str.charAt(i));
      els.flipHalf.textContent = t.half || "";
    } else if (face === "minimal" && els.minimal) {
      /* Both of these change once a MINUTE but are asked once a second, so
         they compare before they write. Not for the render cost, which is
         nothing -- for the DOM churn: the Atlas row fitter observes the whole
         document, and rewriting the header every second would schedule a trim
         every second for no reason. */
      write(els.minimal, pad(h12) + ":" + pad(t.m), t.half, "");
    } else if (face === "words" && els.words) {
      write(els.words, words(t), t.half ? t.half.toLowerCase() : null, " ");
    }
  }

  /* text, plus an optional smaller AM/PM in its own span. */
  function write(node, text, half, gap) {
    var key = text + "|" + (half || "");
    if (node.dataset.k === key) return;
    node.dataset.k = key;
    node.textContent = text;
    if (half) {
      var sp = document.createElement("span");
      sp.className = "half";
      sp.textContent = gap + half;
      node.appendChild(sp);
    }
  }

  function mount() {
    var wrap = host();
    if (!wrap || els.mounted) return;
    var time = document.getElementById("clock");

    els.analog = buildAnalog();
    els.flip = buildFlip();
    els.minimal = document.createElement("div");
    els.minimal.className = "tb-face tb-face-minimal";
    els.words = document.createElement("div");
    els.words.className = "tb-face tb-face-words";

    /* Before .time, so the analog face reads left-of-the-text in the flex row
       and the others stack where the digits were. */
    wrap.insertBefore(els.analog, time);
    wrap.insertBefore(els.flip, time);
    wrap.insertBefore(els.minimal, time);
    wrap.insertBefore(els.words, time);
    els.mounted = true;
  }

  function apply() {
    var r = document.documentElement;
    r.setAttribute("data-clock", face);
    r.setAttribute("data-clock-size", size);
    draw();
  }

  function setFace(v) {
    face = v; save("tb.clockFace", v);
    var b = document.querySelectorAll("#clockFaceRow .theme-btn"), i;
    for (i = 0; i < b.length; i++)
      b[i].classList.toggle("active", b[i].getAttribute("data-clockface") === v);
    apply();
  }

  function setSize(v) {
    size = v; save("tb.clockSize", v);
    var b = document.querySelectorAll("#clockSizeRow .theme-btn"), i;
    for (i = 0; i < b.length; i++)
      b[i].classList.toggle("active", b[i].getAttribute("data-clocksize") === v);
    apply();
  }

  /* ---- Settings ----------------------------------------------------------
     Same shape as settings-ui.js's own Board style picker: an .accent-lbl and
     a .theme-row of .theme-btn, so it inherits the panel's styling with no CSS
     of its own. It lands in the Display tab because that tab's matcher already
     tests for /clock/, and it is placed after Board style so the three
     look-and-feel controls read as one group. */
  function addPicker(panel) {
    if (!panel || panel.querySelector("#clockFaceRow")) return;
    if (!host()) return;                       /* board has no header clock */
    var themeRow = panel.querySelector("#themeRow");
    if (!themeRow) return;

    function row(id, attr, opts, current, onPick) {
      var r = document.createElement("div");
      r.className = "theme-row";
      r.id = id;
      opts.forEach(function (pair) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "theme-btn" + (pair[0] === current ? " active" : "");
        b.setAttribute(attr, pair[0]);
        b.textContent = pair[1];
        b.addEventListener("click", function () { onPick(pair[0]); });
        r.appendChild(b);
      });
      return r;
    }
    function lbl(text) {
      var d = document.createElement("div");
      d.className = "accent-lbl";
      d.textContent = text;
      return d;
    }

    var faceLbl = lbl("Clock face");
    var faceRow = row("clockFaceRow", "data-clockface", FACES, face, setFace);
    var hint = document.createElement("div");
    hint.style.cssText = "font-size:11px;color:var(--muted);margin:4px 0 0;line-height:1.5";
    hint.textContent = "Every face reads this board's own clock, so a board set to "
      + "another city's time stays on that city's time.";
    var sizeLbl = lbl("Clock size");
    var sizeRow = row("clockSizeRow", "data-clocksize", SIZES, size, setSize);

    /* After Board style when settings-ui.js has already added it, otherwise
       straight after Theme. That picker leaves an unclassed <div> hint behind
       its row, so when it is the anchor the insertion point is the node after
       the hint -- landing between "Board style" and "Accent color" either way.
       Theme's own next sibling is the .accent-lbl for Accent colour, which has
       a class and so is never mistaken for a hint. */
    var anchor = panel.querySelector("#styleRow") || themeRow;
    var after = anchor.nextSibling;
    if (after && after.nodeType === 1 && after.tagName === "DIV" && !after.className)
      after = after.nextSibling;

    var p = anchor.parentNode;
    [faceLbl, faceRow, hint, sizeLbl, sizeRow].forEach(function (n) {
      p.insertBefore(n, after);
    });
  }

  var PANELS = ["setup", "settings"];

  function run() {
    if (!host()) return;                       /* night.html / flipboard.html */
    styleOnce();
    mount();
    apply();
    PANELS.forEach(function (id) { addPicker(document.getElementById(id)); });
    /* One second, matching the boards' own clock tick. The faces are cheap --
       three attribute writes for analog, at most four text swaps a minute for
       flip -- and nothing here runs at all on the default digital face. */
    setInterval(draw, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
