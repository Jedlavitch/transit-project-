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
  const LS = { spots: "tb.spots", feed: "tb.spotFeedUrl", hide: "tb.spotCardHidden" };
  const GLYPH = { plane: "✈️", train: "🚆", bus: "🚌" };
  const COLOR = { plane: "#ffd166", train: "#3ad0c8", bus: "#6aa9ff" };
  let remote = [];

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
      `<h2><span class="icon">📓</span> Spotted <span class="count" id="spotCount"></span></h2>
       <div class="statline" id="spotStat"></div>
       <div class="list" id="spotList"></div>`;
    cards.appendChild(card);
    // tapping the header opens the phone app (same place you'd add a sighting)
    card.querySelector("h2").style.cursor = "pointer";
    card.querySelector("h2").title = "Open the Spotter app";
    card.querySelector("h2").onclick = () => { window.location.href = "spot.html"; };
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
    const all = Object.values(byId).sort((a, b) => b.ts - a.ts);

    const list = document.getElementById("spotList");
    const stat = document.getElementById("spotStat");
    const count = document.getElementById("spotCount");
    list.innerHTML = "";

    if (!all.length) {
      list.innerHTML = `<div class="empty">No sightings logged yet — open the Spotter app
        on your phone to log the trains, buses and planes you see.</div>`;
      stat.innerHTML = ""; count.textContent = "";
      return;
    }

    const rode = all.filter(s => s.ridden).length;
    const today = all.filter(s => new Date(s.ts).toDateString() === new Date().toDateString()).length;
    count.textContent = `${all.length} logged`;
    stat.innerHTML = `<b>${today}</b> today · <b>${rode}</b> ridden · <b>${
      new Set(all.map(s => (s.route || "").toLowerCase())).size}</b> routes`;

    all.slice(0, 40).forEach(s => {
      const row = document.createElement("div");
      row.className = "row";
      // badge carries the MODE (glyph + colour); the route is the row's title, so
      // the two don't restate each other and long line names aren't truncated
      const badge = `<div class="badge" style="background:${COLOR[s.mode] || "#6aa9ff"}">${
        GLYPH[s.mode] || "•"}</div>`;
      const bits = [s.vehicle, s.place, s.by ? "by " + s.by : ""].filter(Boolean).join(" · ");
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
