/* ============================================================================
   keepalive.js — keeps a board on screen, and light enough to run, on an
   Amazon Echo Show (and Fire TV). Low-effects mode is further down.

   WHY wake.js IS NOT ENOUGH THERE
     A wake lock stops the screen dimming. It does not stop Fire OS deciding the
     Silk browser is "idle" and sending the Echo Show back to the Alexa home
     screen after a few minutes without a touch. What Fire OS does respect is
     media playback: a page that is playing a video is treated as in use, the
     same way it would never yank you out of a film.

   SO: a one-kilobyte, black, silent, 64px video, looped forever in a 2px corner
     at near-zero opacity. It is not display:none, because hidden videos are
     paused by some engines and a paused video is not playback.

   WHERE IT RUNS
     Only where it is needed: Amazon browsers (Silk, Echo, Fire). Elsewhere a
     looping video costs battery and can put a media control in a phone's
     notification shade, for nothing. Overrides, both remembered:
        ?keepalive=1   force on  (any device — e.g. a tablet that also times out)
        ?keepalive=0   force off
   ============================================================================ */
(function () {
  "use strict";
  var KEY = "tb.keepalive";
  function store(v) { try { if (v == null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, v); } catch (_) {} }
  function saved() { try { return localStorage.getItem(KEY); } catch (_) { return null; } }

  var q = null;
  try { q = new URLSearchParams(location.search).get("keepalive"); } catch (_) {}
  if (q === "1" || q === "0") store(q);

  var amazon = /Silk|Echo|AEO|AFT|KF[A-Z]{2}/i.test(navigator.userAgent || "");

  /* LOW-EFFECTS MODE — the same Amazon devices choke on Glass.
     Glass floats frosted pills (backdrop-filter: blur) over a live WebGL map.
     Every time a bus or plane moves, every blur behind it is recomputed, and
     an Echo Show's GPU cannot keep up: the page stalls and the map stutters.
     Here every backdrop blur on the page goes (including ones other scripts
     inject later, hence the universal selector), and Glass's pills get a more
     solid tint so the text still reads over a bright map without the blur.
     Same remembered overrides: ?lowfx=1 forces it on, ?lowfx=0 off. */
  var LFX = "tb.lowfx", lq = null, lpref = null;
  try { lq = new URLSearchParams(location.search).get("lowfx"); } catch (_) {}
  try { if (lq === "1" || lq === "0") localStorage.setItem(LFX, lq); lpref = localStorage.getItem(LFX); } catch (_) {}
  if (lpref === "1" || (lpref !== "0" && amazon)) {
    var root = document.documentElement;
    root.classList.add("tb-lowfx");
    var st = document.createElement("style");
    st.id = "tbLowFx";
    st.textContent =
      ".tb-lowfx *,.tb-lowfx *::before,.tb-lowfx *::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}" +
      ".tb-lowfx[data-style=glass]{--glass-tint-strong:rgba(12,14,18,.84)}" +
      ".tb-lowfx[data-style=glass][data-theme=black]{--glass-tint-strong:rgba(0,0,0,.86)}" +
      ".tb-lowfx[data-style=glass][data-theme=day]{--glass-tint-strong:rgba(255,255,255,.9)}";
    (document.head || root).appendChild(st);
  }

  var pref = saved();
  if (pref === "0" || (pref !== "1" && !amazon)) return;

  var SRC = "data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAWlzb21tcDQxbXA0MgAAAAFtZGF0AAAAAAAAAUYAAAA6BgUyR1ZK3FxMQz+U78URPNFDqAEAAAMAAQMAAAMAAQIAAAfQCwAAAwAAAwAAEbwMA4kFAw3/////gAAAAFMluCAAg///4eigPvFb7/D//DwSF++++++++oTFa666hKuuuuuuuoTrrrqEq6666666hOuuuoSrrrrrrr4//8PRfvvvrrrrrrrrrrrrrrrrrrrrwAAAACgh4QQHvwOn6EfNn+fs/nhSf/QVVn88KT/PCufz+fzwpP/Mqi/51UX8AAAAISHiCAc4z/VWf5s/+qs/nhaf54Xz+fz+eFp/5lUX/Oqi/gAAACEh4wwGuM+fo/n4j5/P5/P82f5/P5/P54Yn/mVRf86qL+AAAAAnIeQQBjoTvEeI4j5/P5/PxHz+fz+fiPn8/n8/zZ/5kGleaI/nVRfwAAAC4m1vb3YAAABsbXZoZAAAAADnKUoR5ylKEQAAAlgAAAXcAAEAAAEAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAAAJudHJhawAAAFx0a2hkAAAAAecpShHnKUoRAAAAAQAAAAAAAAXcAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAQAAAAABAAAAAQAAAAAAAJGVkdHMAAAAcZWxzdAAAAAAAAAABAAAF3AAAAAAAAQAAAAAB5m1kaWEAAAAgbWRoZAAAAADnKUoR5ylKEQAAAlgAAAXcVcQAAAAAADFoZGxyAAAAAAAAAAB2aWRlAAAAAAAAAAAAAAAAQ29yZSBNZWRpYSBWaWRlbwAAAAGNbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAAJGRpbmYAAAAcZHJlZgAAAAAAAAABAAAADHVybCAAAAABAAABTXN0YmwAAACcc3RzZAAAAAAAAAABAAAAjGF2YzEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAQABAAEgAAABIAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY//8AAAAiYXZjQwFCAAv/4QALJ0IAC6tBhvAgwigBAAQozjyAAAAACmZpZWwBAAAAAApjaHJtAAAAAAAYc3R0cwAAAAAAAAABAAAABQAAASwAAAAUc3RzcwAAAAAAAAABAAAAAQAAABFzZHRwAAAAACAQEBAQAAAAKHN0c2MAAAAAAAAAAgAAAAEAAAACAAAAAQAAAAMAAAABAAAAAQAAAChzdHN6AAAAAAAAAAAAAAAFAAAAlQAAACwAAAAlAAAAJQAAACsAAAAcc3RjbwAAAAAAAAADAAAALAAAAO0AAAE3";

  var v = null;
  function make() {
    v = document.createElement("video");
    v.muted = true; v.defaultMuted = true; v.loop = true; v.autoplay = true;
    v.setAttribute("muted", ""); v.setAttribute("playsinline", ""); v.setAttribute("webkit-playsinline", "");
    v.setAttribute("aria-hidden", "true"); v.tabIndex = -1;
    v.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:-1";
    v.src = SRC;
    document.body.appendChild(v);
  }
  function play() {
    if (!v) return;
    if (!v.paused && !v.ended) return;
    try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (_) {}
  }
  function start() {
    make(); play();
    /* Autoplay can be refused until the first touch; and the OS pauses media
       when the page is hidden. Re-ask on both, and on a slow timer as a net. */
    document.addEventListener("pointerdown", play, { passive: true });
    document.addEventListener("keydown", play);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") play(); });
    setInterval(play, 30000);
  }
  if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);

  window.TBKeepAlive = { playing: function () { return !!(v && !v.paused); } };
})();
