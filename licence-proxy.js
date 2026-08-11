/* ============================================================================
   licence-proxy.js — routes the boards' live feeds through the licensed proxy.

   Wraps fetch() rather than editing nine boards: every feed call already goes
   through fetch, so one interception covers every system on every board,
   including ones added later. Requests to the data feeds are rewritten to
   <proxy>/f?u=<upstream>&k=<licence>; everything else — bundled timetables, map
   tiles, the page's own assets — is left alone.

   DORMANT UNTIL CONFIGURED. With no proxy URL saved, this does nothing at all
   and the boards fetch feeds directly, exactly as they do now. Set the URL in
   admin.html to turn it on.

   WHAT IT IS FOR
     Cloudflare Access stops people reaching the site; it does nothing about a
     customer who saves the files and runs their own copy. This makes that copy
     useless: no valid licence, no live data. The HTML and the bundled timetables
     are still copyable — a static site cannot prevent that — but a board with no
     trains, buses or planes on it is not a product.
   ============================================================================ */
(function () {
  "use strict";

  const LS_PROXY = "tb.feedProxy", LS_KEY = "tb.license";

  // Hosts worth paying for. Must match the Worker's ALLOWED_HOSTS, or a request
  // gets rewritten to a proxy that then refuses to forward it.
  const FEED_HOSTS = new Set([
    "api.airplanes.live",
    "api-v3.amtraker.com",
    "api.wmata.com",
    "api.mta.info",
    "api-endpoint.mta.info",
    "gtfsrt.prod.obanyc.com",
    "www3.septa.org",
    "api.adsbdb.com",
    "api-v3.mbta.com",
    "api.bart.gov",
    "api.transitous.org",
    "transport.opendata.ch",
    "rtt.metrolinktrains.com",
    "api.wheretheiss.at",
  ]);

  const get = k => { try { return (localStorage.getItem(k) || "").trim(); } catch (_) { return ""; } };
  const proxyUrl = () => get(LS_PROXY).replace(/\/+$/, "");
  const licence = () => get(LS_KEY);

  let warned = false;
  function warnOnce(why) {
    if (warned) return;
    warned = true;
    // One quiet, permanent notice. A board is a wall display, so this must not
    // be a dialog and must not repeat every fifteen seconds.
    try {
      const el = document.createElement("div");
      el.id = "tbLicenceChip";
      el.textContent = "Licence needed — " + why;
      el.style.cssText = "position:fixed;left:12px;bottom:12px;z-index:9999;font:600 11px/1.4 " +
        "ui-monospace,Menlo,monospace;letter-spacing:.04em;padding:6px 10px;border-radius:6px;" +
        "background:rgba(20,10,0,.9);color:#ffb454;border:1px solid #8a5a1f";
      (document.body || document.documentElement).appendChild(el);
    } catch (_) {}
    console.warn("[licence] live feeds are not available: " + why);
  }

  function rewrite(input) {
    const p = proxyUrl();
    if (!p) return null;                                  // dormant
    let href;
    try {
      href = typeof input === "string" ? input
           : (input && input.url) ? input.url : String(input);
    } catch (_) { return null; }
    let u;
    try { u = new URL(href, location.href); } catch (_) { return null; }
    if (!FEED_HOSTS.has(u.hostname)) return null;         // not a paid feed
    return p + "/f?u=" + encodeURIComponent(u.toString()) +
           "&k=" + encodeURIComponent(licence());
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const via = rewrite(input);
    if (!via) return realFetch(input, init);
    // Rebuild rather than mutate: a Request object's url is read-only, and the
    // boards pass plain strings anyway.
    return realFetch(via, init).then(res => {
      if (res.status === 402) {
        res.clone().json().then(d => warnOnce((d && d.detail) || "invalid licence")).catch(() => warnOnce("invalid licence"));
      }
      return res;
    });
  };

  window.TBLicence = {
    configured: () => !!proxyUrl(),
    key: licence,
    /* Ask the proxy whether this key is good, without waiting for a feed to
       fail. Used by admin.html so setup says so immediately. */
    async check() {
      const p = proxyUrl();
      if (!p) return { ok: false, why: "no proxy URL set" };
      try {
        const r = await realFetch(p + "/f?k=" + encodeURIComponent(licence()) +
          "&u=" + encodeURIComponent("https://api-v3.amtraker.com/v3/stations"));
        if (r.status === 402) {
          const d = await r.json().catch(() => ({}));
          return { ok: false, why: d.detail || "licence rejected" };
        }
        if (!r.ok) return { ok: false, why: "proxy returned HTTP " + r.status };
        return { ok: true, why: "licence accepted" };
      } catch (e) {
        return { ok: false, why: "could not reach the proxy" };
      }
    },
  };
})();
