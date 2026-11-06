/* Optional per-city appearance. Shared preferences keep their original tb.*
   keys. Local looks live separately; choosing one never rewrites another
   city's look or the shared defaults. Load before the boards' pre-paint code. */
(function () {
  "use strict";
  var city = location.pathname.split("/").pop().replace(/\.html$/, "");
  var key = "tb.cityLook." + city;
  /* Glass is the default design. A visitor who explicitly chose another
     style (including "classic") has it saved and keeps it; only someone who
     never chose falls through to this. */
  var defaults = { theme: "dark", style: "glass", rows: "normal", accent: "#4ea1ff" };
  var shared = {}, saved = read();
  function valid(name, value) {
    if (typeof value !== "string") return false;
    if (name === "accent") return /^#[0-9a-f]{6}$/i.test(value);
    var allowed = { theme: ["dark", "black", "day"], style: ["classic", "atlas", "paper", "signal", "glass"], rows: ["normal", "more", "fewer"] };
    return allowed[name] && allowed[name].indexOf(value) >= 0;
  }
  function read() {
    var out = { local: false, look: {} };
    try {
      var v = JSON.parse(localStorage.getItem(key) || "null");
      if (v && typeof v === "object") {
        out.local = v.local === true;
        Object.keys(defaults).forEach(function (name) {
          if (v.look && valid(name, v.look[name])) out.look[name] = v.look[name];
        });
      }
    } catch (_) {}
    return out;
  }
  function persist() {
    try { localStorage.setItem(key, JSON.stringify(saved)); return true; } catch (_) { return false; }
  }
  function get(name) {
    if (saved.local && valid(name, saved.look[name])) return saved.look[name];
    try { var v = localStorage.getItem("tb." + name); if (valid(name, v)) return v; } catch (_) {}
    return shared[name] || (name === "style" ? defaults.style : null);
  }
  function set(name, value) {
    if (!valid(name, value)) return false;
    if (saved.local) { saved.look[name] = value; return persist(); }
    shared[name] = value;
    try { localStorage.setItem("tb." + name, value); return true; } catch (_) { return false; }
  }
  function useLocal(on) {
    if (on && !saved.local) {
      Object.keys(defaults).forEach(function (name) {
        if (!valid(name, saved.look[name])) saved.look[name] = get(name) || defaults[name];
      });
    }
    saved.local = !!on;
    return persist();
  }
  window.TBBoardPreferences = { get: get, set: set, useLocal: useLocal,
    isLocal: function () { return saved.local; }, city: city };
})();
