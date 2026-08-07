/* ============================================================================
   spotlog.js — shows the Spotter log on the boards.

   Reads the same localStorage key the phone app writes ("tb.spots") and, when a
   shared feed is configured ("tb.spotFeedUrl" -> spotter-worker.js), merges in
   everyone else's sightings too. Injects its own card into the board's .cards
   grid, so one script tag adds the feature to every city with no per-board HTML.

   Self-contained on purpose: it reuses each board's own .card/.row classes (so
   it inherits that board's theme + row density automatically) but does its own
   row trimming, because the boards' fitList()/applyCardVis() only know about
   the cards that were in their HTML at build time.
   ============================================================================ */
(function () {
  "use strict";
  const LS = { spots: "tb.spots", feed: "tb.spotFeedUrl", hide: "tb.spotCardHidden",
               scope: "tb.spotScope" };
  const GLYPH = { plane: "✈️", train: "🚆", bus: "🚌" };
  const COLOR = { plane: "#ffd166", train: "#3ad0c8", bus: "#6aa9ff" };
  const NEAR_MI = 60;          // "around here" — generous enough to cover a metro area
  let remote = [];

  /* ---- where is the board that's showing this card? --------------------
     Every sighting carries the lat/lon it was logged at, but this card used to
     render all of them on every board, so a Philadelphia sighting showed up on
     the California boards. Scoping needs the board's own location, and this one
     script runs on all eight of them, so ask in order of reliability:
       1. the board's live `state.loc` — a top-level `let`, so it is a global
          lexical binding readable by name but NOT present on `window`;
       2. whichever `transitboard*.loc` this board saved (each board owns its
          own namespaced key, and only one is written per page);
       3. the map's centre, if it is up.
     Returns null when the board's location genuinely isn't known yet, and the
     caller then declines to filter rather than showing an arbitrary subset. */
  function boardLoc() {
    try {
      if (typeof state !== "undefined" && state && state.loc &&
          typeof state.loc.lat === "number") return { lat: state.loc.lat, lon: state.loc.lon };
    } catch (_) {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!/^transitboard[a-z]*\.loc$/.test(k)) continue;
        const v = JSON.parse(localStorage.getItem(k) || "null");
        if (v && typeof v.lat === "number") return { lat: v.lat, lon: v.lon };
      }
    } catch (_) {}
    try {
      if (typeof map !== "undefined" && map && map.getCenter) {
        const c = map.getCenter(); return { lat: c.lat, lon: c.lng };
      }
    } catch (_) {}
    return null;
  }

  function milesBetween(a, b) {
    const R = 3958.8, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const la1 = a.lat * rad, la2 = b.lat * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  const scope = () => { try { return localStorage.getItem(LS.scope) === "all" ? "all" : "near"; } catch (_) { return "near"; } };
  function setScope(v) { try { localStorage.setItem(LS.scope, v); } catch (_) {} render(); }

  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const local = () => { try { return JSON.parse(localStorage.getItem(LS.spots) || "[]"); } catch (_) { return []; } };
  const feedUrl = () => { try { return (localStorage.getItem(LS.feed) || "").trim().replace(/\/+$/, ""); } catch (_) { return ""; } };

  function ago(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }

  function ensureCard() {
    let card = document.getElementById("spotCard");
    if (card) return card;
    const cards = document.querySelector(".cards");
    if (!cards) return null;
    card = document.createElement("div");
    card.className = "card";
    card.id = "spotCard";
    card.style.setProperty("--sys", "#b39dff");   // tactical header tick (index.html); harmless elsewhere
    card.innerHTML =
      `<h2><span class="icon">📓</span> Spotted <span class="count" id="spotCount"></span>
         <button type="button" id="spotScopeBtn" title="Show sightings from everywhere, or just around here"></button></h2>
       <div class="statline" id="spotStat"></div>
       <div class="list" id="spotList"></div>`;
    cards.appendChild(card);
    // tapping the header opens the phone app (same place you'd add a sighting)
    const h2 = card.querySelector("h2");
    h2.style.cursor = "pointer";
    h2.title = "Open the Spotter app";
    h2.onclick = e => { if (!e.target.closest("#spotScopeBtn")) window.location.href = "spot.html"; };
    const btn = card.querySelector("#spotScopeBtn");
    btn.style.cssText = "margin-left:auto;font:inherit;font-size:10px;font-weight:700;cursor:pointer;" +
      "padding:2px 8px;border-radius:999px;border:1px solid currentColor;background:transparent;" +
      "color:var(--muted,#8fa3bf);opacity:.8;letter-spacing:.04em";
    btn.onclick = e => { e.stopPropagation(); setScope(scope() === "near" ? "all" : "near"); };
    return card;
  }

  function trim(box) {                        // same "no scrollbar, no clipping" rule the boards use
    // Guard exactly as the boards' own fitList() does: a box that hasn't been
    // laid out yet reports ~0 height, and trimming against that deletes EVERY
    // row (looks like "the card renders nothing"). Skip and let a later pass fit it.
    if (!box || box.clientHeight < 8) return;
    let guard = 0;
    while (box.scrollHeight > box.clientHeight + 1 && box.lastElementChild && guard++ < 80)
      box.removeChild(box.lastElementChild);
  }

  function render() {
    let hidden = false;
    try { hidden = localStorage.getItem(LS.hide) === "1"; } catch (_) {}
    const card = ensureCard();
    if (!card) return;
    card.style.display = hidden ? "none" : "";
    if (hidden) return;

    // merge local + shared, newest first, de-duped by id
    const byId = {};
    local().concat(remote).forEach(s => { if (s && s.id) byId[s.id] = s; });
    const every = Object.values(byId).sort((a, b) => b.ts - a.ts);

    /* Scope to this board's own city. A sighting with no lat/lon (GPS refused
       when it was logged) can't be placed, so it is never claimed as "near
       here" — it is counted separately instead of being silently dropped. */
    const here = boardLoc();
    const near = scope() === "near" && here;
    const placed = every.map(s => {
      const has = typeof s.lat === "number" && typeof s.lon === "number";
      return { s, mi: has && here ? milesBetween(here, { lat: s.lat, lon: s.lon }) : null };
    });
    const shown = near ? placed.filter(p => p.mi != null && p.mi <= NEAR_MI) : placed;
    const elsewhere = near ? placed.length - shown.length : 0;
    const unplaced = placed.filter(p => p.mi == null).length;

    const list = document.getElementById("spotList");
    const stat = document.getElementById("spotStat");
    const count = document.getElementById("spotCount");
    const scopeBtn = document.getElementById("spotScopeBtn");
    list.innerHTML = "";
    if (scopeBtn) {
      scopeBtn.textContent = near ? "near here" : "everywhere";
      scopeBtn.style.display = here ? "" : "none";   // nothing to scope by yet
      scopeBtn.title = near
        ? `Showing sightings within ${NEAR_MI} mi — tap to show everywhere`
        : "Showing every sighting — tap to show only ones near this board";
    }

    if (!every.length) {
      list.innerHTML = `<div class="empty">No sightings logged yet — open the Spotter app
        on your phone to log the trains, buses and planes you see.</div>`;
      stat.innerHTML = ""; count.textContent = "";
      return;
    }
    if (!shown.length) {
      list.innerHTML = `<div class="empty">No sightings within ${NEAR_MI} mi of here.
        ${elsewhere} logged elsewhere${unplaced ? `, ${unplaced} without a location` : ""} —
        tap “near here” above to show them.</div>`;
      stat.innerHTML = ""; count.textContent = `0 near here`;
      return;
    }
    const all = shown.map(p => p.s);

    const rode = all.filter(s => s.ridden).length;
    const today = all.filter(s => new Date(s.ts).toDateString() === new Date().toDateString()).length;
    count.textContent = near ? `${all.length} near here` : `${all.length} logged`;
    stat.innerHTML = `<b>${today}</b> today · <b>${rode}</b> ridden · <b>${
      new Set(all.map(s => (s.route || "").toLowerCase())).size}</b> routes` +
      (near && elsewhere ? ` · <b>${elsewhere}</b> elsewhere` : "");

    const miOf = {}; shown.forEach(p => { miOf[p.s.id] = p.mi; });
    all.slice(0, 40).forEach(s => {
      const row = document.createElement("div");
      row.className = "row";
      // badge carries the MODE (glyph + colour); the route is the row's title, so
      // the two don't restate each other and long line names aren't truncated
      const badge = `<div class="badge" style="background:${COLOR[s.mode] || "#6aa9ff"}">${
        GLYPH[s.mode] || "•"}</div>`;
      const mi = miOf[s.id];
      const dist = mi == null ? "" : (mi < 1 ? "here" : `${Math.round(mi)} mi away`);
      const bits = [s.vehicle, s.place, dist, s.by ? "by " + s.by : ""].filter(Boolean).join(" · ");
      row.innerHTML = `${badge}
        <div><div class="dest">${esc(s.route || "—")}</div>
             ${bits ? `<div class="sub">${esc(bits)}</div>` : ""}</div>
        <div></div>
        <div class="times"><div class="sched">${esc(ago(s.ts))}</div>
          ${s.ridden ? `<div class="live-tag" style="color:var(--good)">rode</div>` : ""}</div>`;
      list.appendChild(row);
    });
    trim(list);
  }

  async function pull() {
    const url = feedUrl();
    if (!url) { remote = []; return; }
    try {
      const r = await fetch(url + "/feed?limit=40", { cache: "no-store" });
      const d = await r.json();
      if (d && Array.isArray(d.spots)) remote = d.spots;
    } catch (_) { /* keep whatever we had */ }
  }

  async function tick() { await pull(); render(); }

  function start() {
    render();
    tick();
    setInterval(tick, 60000);
    // The card is injected into a CSS grid that may still be settling (web fonts,
    // sibling cards filling in), so re-render once the layout is real -- otherwise
    // the first paint's row count is fitted against a not-yet-sized box.
    if ("ResizeObserver" in window) {
      const list = document.getElementById("spotList");
      if (list) {
        let lastH = -1;   // only re-render on a real box-size change, never on our own row edits
        new ResizeObserver(() => {
          const h = Math.round(list.clientHeight);
          if (h !== lastH) { lastH = h; render(); }
        }).observe(list);
      }
    }
    setTimeout(render, 400);
    window.addEventListener("resize", render);
    // another tab (or the app on the same phone) logging something updates us live
    window.addEventListener("storage", e => { if (e.key === LS.spots) render(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.TBSpotLog = { render, refresh: tick,
    hide(v) { try { localStorage.setItem(LS.hide, v ? "1" : "0"); } catch (_) {} render(); } };
})();
