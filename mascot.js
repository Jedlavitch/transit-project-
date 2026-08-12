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

  function src(override) {
    if (override) return override;
    try { if (window.TB_CONFIG && window.TB_CONFIG.mascot) return window.TB_CONFIG.mascot; } catch (_) {}
    try { return localStorage.getItem("tb.mascot") || ""; } catch (_) { return ""; }
  }

  /* Returns an element rather than a string so the load failure can be handled
     here, once, instead of at each call site. */
  function el(opts) {
    opts = opts || {};
    var w = opts.width || 58, h = opts.height || Math.round(w * 76 / 64);
    var file = src(opts.src);
    if (!file) {
      var span = document.createElement("span");
      span.style.cssText = "display:inline-flex; flex:none; line-height:0";
      span.innerHTML = penguin(w, h);
      return span;
    }
    var img = document.createElement("img");
    img.alt = ""; img.width = w; img.height = h;
    img.style.cssText = "display:block; flex:none; object-fit:contain";
    img.onerror = function () {
      var span2 = document.createElement("span");
      span2.style.cssText = "display:inline-flex; flex:none; line-height:0";
      span2.innerHTML = penguin(w, h);
      if (img.parentNode) img.parentNode.replaceChild(span2, img);
    };
    img.src = file;
    return img;
  }

  window.TBMascot = { el: el, svg: penguin, src: src };

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
