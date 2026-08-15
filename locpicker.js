/* ============================================================================
   locpicker.js — the header location as a small pop-down.

   The board already knows how to change location: geocodeAddress() against
   Nominatim, a curated LOC_SUGGESTIONS list per city, applyLoc/saveLoc/
   setManualLoc, and a GPS path. All of it lived behind ⚙ → Location, three
   clicks from the thing it changes, while the header showed the current
   location as dead text.

   This makes that text the control. Nothing here re-implements the location
   logic — it calls the board's own functions, so a city that customises
   theirs gets the customised behaviour for free.

   Loaded like feedback.js/license.js: one tag per board, styles injected
   here so there is nothing to add to theme.css.

   CROSS-SCRIPT NOTE: the board's globals are declared in a classic inline
   script, so `const LOC_SUGGESTIONS` is a global *lexical* binding — visible
   as a bare identifier from this file but NOT present on `window`. Every
   lookup therefore goes through ref() below rather than a `window.X` check,
   which would always be undefined and silently disable the whole panel.
   ============================================================================ */
(function () {
  "use strict";

  var css = "\
#tbLocBtn{display:inline-flex;align-items:center;gap:4px;cursor:pointer;border:0;background:none;\
  padding:0;margin:0;font:inherit;color:inherit;text-align:left;border-radius:6px}\
#tbLocBtn:hover{color:var(--text,#eef3ff)}\
#tbLocBtn:focus-visible{outline:2px solid var(--accent,#4ea1ff);outline-offset:2px}\
#tbLocBtn .tbcar{font-size:9px;opacity:.7;transform:translateY(1px)}\
#tbLocPop{position:fixed;z-index:9400;width:min(300px,92vw);padding:12px;\
  background:var(--panel,#111d36);border:1px solid var(--line,#22345a);border-radius:12px;\
  box-shadow:0 14px 40px rgba(0,0,0,.45);font-family:var(--body,-apple-system,sans-serif)}\
#tbLocPop h4{margin:0 0 8px;font:700 10.5px/1 var(--mono,ui-monospace,monospace);\
  letter-spacing:.13em;text-transform:uppercase;color:var(--muted,#93a5cf)}\
#tbLocPop input{width:100%;padding:8px 10px;border-radius:8px;border:1px solid var(--line,#22345a);\
  background:var(--row-bg,#0d1830);color:var(--text,#eef3ff);font:13px var(--body,sans-serif)}\
#tbLocPop input:focus{outline:none;border-color:var(--accent,#4ea1ff)}\
#tbLocMsg{font-size:11.5px;min-height:14px;margin-top:6px;color:var(--muted,#93a5cf)}\
#tbLocSug{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}\
#tbLocSug button{padding:5px 9px;border-radius:7px;border:1px solid var(--line,#22345a);\
  background:var(--row-bg,#0d1830);color:var(--muted,#93a5cf);font:600 11.5px var(--body,sans-serif);cursor:pointer}\
#tbLocSug button:hover{border-color:var(--accent,#4ea1ff);color:var(--text,#eef3ff)}\
#tbLocSug button.on{border-color:var(--accent,#4ea1ff);color:var(--text,#eef3ff);background:var(--panel2,#0c1628)}\
#tbLocGps{width:100%;margin-top:9px;padding:8px;border-radius:8px;border:1px solid var(--line,#22345a);\
  background:transparent;color:var(--text,#eef3ff);font:600 12px var(--body,sans-serif);cursor:pointer}\
#tbLocGps:hover{border-color:var(--accent,#4ea1ff)}";

  var pop = null, btn = null, label = null;

  /* The board's globals are lexical (const/function in a classic inline
     script), so they resolve as bare identifiers but are absent from window.
     Referencing one that does not exist throws ReferenceError, so each lookup
     is wrapped and returns undefined instead. No eval: it would be the same
     scope lookup with a CSP hazard attached. */
  function ref(get) { try { return get(); } catch (e) { return undefined; } }

  function msg(text, tone) {
    var m = pop && pop.querySelector("#tbLocMsg");
    if (!m) return;
    m.textContent = text || "";
    m.style.color = tone === "good" ? "var(--good,#33d17a)"
      : tone === "warn" ? "var(--late,#ff5a5a)" : "var(--muted,#93a5cf)";
  }

  function place() {
    if (!pop || !btn) return;
    var r = btn.getBoundingClientRect();
    pop.style.top = Math.round(r.bottom + 8) + "px";
    // keep it on screen: prefer left-aligned to the label, pull back at the edge
    var w = pop.offsetWidth || 300;
    var left = Math.min(Math.max(8, Math.round(r.left)), window.innerWidth - w - 8);
    pop.style.left = left + "px";
  }

  function close() {
    if (!pop) return;
    pop.remove(); pop = null;
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onOutside, true);
    window.removeEventListener("resize", place);
  }

  function onKey(e) { if (e.key === "Escape") { close(); if (btn) btn.focus(); } }
  function onOutside(e) { if (pop && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) close(); }

  function applyTyped(q) {
    q = (q || "").trim();
    if (!q) { msg("Type an address, city, or zip first.", "warn"); return; }
    var _geo = ref(function(){return geocodeAddress;});
    if (!_geo) { msg("Search isn't available on this board.", "warn"); return; }
    msg("Searching…");
    _geo(q).then(function (loc) {
      if (!loc) { msg("Couldn't find that — try adding a city or state.", "warn"); return; }
      /* Same sequence the Settings panel runs, in the same order: apply,
         persist, mark it manual (so a later GPS fix doesn't silently
         overwrite a typed address), recentre, then refetch every feed. */
      var _apply = ref(function(){return applyLoc;});      if (_apply) _apply(loc);
      var _save  = ref(function(){return saveLoc;});       if (_save)  _save(loc);
      var _man   = ref(function(){return setManualLoc;});  if (_man)   _man(true);
      try { if (state && state.map) { state.map.invalidateSize(); state.map.setView([loc.lat, loc.lon], 12); } } catch (e) {}
      var _rf    = ref(function(){return refreshEverythingForNewLocation;}); if (_rf) _rf();
      msg("Now tracking near " + loc.label, "good");
      setTimeout(close, 900);
    }).catch(function () { msg("Search failed — check your connection.", "warn"); });
  }

  function open() {
    if (pop) { close(); return; }
    pop = document.createElement("div");
    pop.id = "tbLocPop";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-label", "Choose location");
    pop.innerHTML = '<h4>Show transit near</h4>' +
      '<input id="tbLocIn" type="text" placeholder="Address, city, or zip…" autocomplete="off" spellcheck="false">' +
      '<div id="tbLocMsg"></div><div id="tbLocSug"></div>' +
      '<button id="tbLocGps" type="button">Use my current location</button>';
    document.body.appendChild(pop);
    place();

    var input = pop.querySelector("#tbLocIn");
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); applyTyped(input.value); }
    });

    /* The board's own curated list, rendered with its own picker so the
       "currently selected" styling and the follow-on refresh stay identical
       to the Settings panel's copy. */
    var box = pop.querySelector("#tbLocSug");
    var _sug = ref(function(){return LOC_SUGGESTIONS;}), _pick = ref(function(){return pickSuggestedLoc;});
    if (_sug && _pick) {
      _sug.forEach(function (s) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = s.label;
        b.title = s.full || s.label;
        try {
          if (state && state.loc && Math.abs(state.loc.lat - s.lat) < 0.01 && Math.abs(state.loc.lon - s.lon) < 0.01)
            b.className = "on";
        } catch (e) {}
        b.onclick = function () { _pick(s); msg("Now tracking near " + s.label, "good"); setTimeout(close, 700); };
        box.appendChild(b);
      });
    }

    pop.querySelector("#tbLocGps").onclick = function () {
      var _gps = ref(function(){return handleUseMyLocation;});
      if (!_gps) { msg("Location isn't available on this board.", "warn"); return; }
      msg("Finding your location…");
      _gps();
      setTimeout(close, 900);
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onOutside, true);
    window.addEventListener("resize", place);
    setTimeout(function () { input.focus(); }, 0);
  }

  function init() {
    label = document.getElementById("loclabel");
    if (!label) return;
    try {
      var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    } catch (e) {}

    /* The label is replaced by a real <button> rather than given a click
       handler: a <small> is not focusable and does not answer Enter, and this
       has to be reachable from a TV remote like the rest of the bar. The id
       moves with it so the board's own code, which writes the current place
       into #loclabel, keeps working untouched. */
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "tbLocBtn";
    btn.title = "Change location";
    btn.setAttribute("aria-haspopup", "dialog");
    var inner = document.createElement("span");
    inner.id = "loclabel";
    inner.textContent = label.textContent;
    label.removeAttribute("id");
    btn.appendChild(inner);
    var car = document.createElement("span");
    car.className = "tbcar"; car.textContent = "▾";
    btn.appendChild(car);
    label.replaceWith(btn);
    // keep the old element's classes/placement semantics on the new one
    btn.className = label.className || "";
    btn.onclick = open;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
