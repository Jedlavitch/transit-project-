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
               scope: "tb.spotScope", sheet: "tb.sheetUrl", blob: "tb.spotBlob" };
  const GLYPH = { plane: "✈️", train: "🚆", bus: "🚌" };
  const COLOR = { plane: "#ffd166", train: "#3ad0c8", bus: "#6aa9ff" };
  const NEAR_MI = 60;          // "around here" — generous enough to cover a metro area
  let remote = [];
  let remoteErr = "";          // last shared-feed failure, surfaced so a bad URL isn't silent

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
  const sheetUrl = () => { try { return (localStorage.getItem(LS.sheet) || "").trim(); } catch (_) { return ""; } };
  const isSheet = u => /script\.google\.com/i.test(u);
  const anyFeed = () => blobId() || sheetUrl() || feedUrl();

  /* ---- share code (jsonblob.com) -------------------------------------------
     The default way to get sightings off a phone and onto a board. Needs no
     account, no deployment and no key: the phone PUTs the log to a blob it
     created, the board GETs it. Both ends are plain CORS-open REST, verified.
     Stored as the bare blob id so the board only ever has to be given a code. */
  const BLOB_API = "https://jsonblob.com/api/jsonBlob/";
  const blobId = () => { try { return (localStorage.getItem(LS.blob) || "").trim(); } catch (_) { return ""; } };
  // accepts a bare id, or any jsonblob URL it was pasted inside
  function parseBlobId(v) {
    const s = String(v || "").trim();
    const m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return m ? m[0] : "";
  }

  /* One field, two kinds of backend. A Google Apps Script URL goes in the Sheet
     slot (the key the phone app already uses for its mirror, so pasting the same
     URL in both places is all the setup there is); anything else is treated as a
     spotter-worker deployment. */
  function setFeedUrl(v) {
    const u = String(v || "").trim().replace(/\/+$/, "");
    const id = parseBlobId(u);
    try {
      if (!u) { localStorage.setItem(LS.feed, ""); localStorage.setItem(LS.sheet, ""); localStorage.setItem(LS.blob, ""); }
      else if (id) localStorage.setItem(LS.blob, id);          // a share code
      else if (isSheet(u)) localStorage.setItem(LS.sheet, u);
      else localStorage.setItem(LS.feed, u);
    } catch (_) {}
    remote = []; remoteErr = ""; tick();
  }

  /* Apps Script web apps send no CORS headers, so fetch() can never read one --
     that is why the phone app posts to it no-cors and cannot see the response.
     A <script> tag is not subject to CORS at all, so JSONP is the one way to
     READ a Sheet from the browser with no proxy in between. */
  function jsonp(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      const cb = "tbSpot" + Math.random().toString(36).slice(2, 9);
      const s = document.createElement("script");
      let done = false;
      const cleanup = () => { try { delete window[cb]; } catch (_) { window[cb] = undefined; } s.remove(); };
      const timer = setTimeout(() => { if (!done) { done = true; cleanup(); reject(new Error("timed out")); } }, timeoutMs || 15000);
      window[cb] = data => { if (done) return; done = true; clearTimeout(timer); cleanup(); resolve(data); };
      s.onerror = () => { if (done) return; done = true; clearTimeout(timer); cleanup(); reject(new Error("couldn't load — check the URL is deployed with access set to Anyone")); };
      s.src = url + (url.indexOf("?") >= 0 ? "&" : "?") + "limit=60&callback=" + cb;
      document.head.appendChild(s);
    });
  }

  /* ---- which logged vehicles are passing RIGHT NOW? ------------------------
     The board has already fetched every vehicle near its own location (its live
     feeds are all queried around `state.loc`, so this automatically follows the
     address picked in ⚙ rather than assuming where you are). Those fleets are
     sitting in memory, so matching the log against them costs no extra request
     and no new permission — a sighting lights up the moment the same flight or
     tail number is overhead again. */
  function liveIdents() {
    const out = new Set();
    const add = v => { const t = String(v == null ? "" : v).trim().toUpperCase(); if (t) out.add(t); };
    const s = (typeof state !== "undefined" && state) ? state : null;
    if (!s) return out;
    try { (s._planes || []).forEach(a => { add(a.flight); add(a.r); }); } catch (_) {}
    try { (s._amtrak || []).forEach(x => { const t = x && (x.t || x); add(t && (t.trainNum || t.trainID)); add(t && t.routeName); }); } catch (_) {}
    try { (s._rail || []).forEach(p => { add(p && (p.TrainId || p.Line)); }); } catch (_) {}
    // live vehicles already plotted on the map, whatever the system
    try {
      Object.keys(s.fleets || {}).forEach(mode => {
        Object.keys(s.fleets[mode] || {}).forEach(id => add(String(id).replace(/^[a-z]+/i, "")));
      });
    } catch (_) {}
    return out;
  }
  /* ---- route-level matching, for systems with no public vehicle identity ----
     A plane broadcasts the same callsign and tail number you logged, so matching
     the exact aircraft works. A bus does not: you log the route ("29"), while the
     feed knows that vehicle as an internal fleet number, so vehicle matching can
     never fire for one. But each board has already rendered the routes serving
     your nearby stops into its own departure cards — so read those badges.
     Mode is inferred from the card so a logged bus can only match a bus card,
     and "29" on a bus can't collide with a "29" somewhere on the rail side. */
  function liveRoutes() {
    const byMode = { plane: new Set(), train: new Set(), bus: new Set() };
    try {
      document.querySelectorAll(".card").forEach(card => {
        if (card.id === "spotCard") return;
        const id = (card.id || "").toLowerCase();
        const head = ((card.querySelector("h2") || {}).textContent || "").toLowerCase();
        // Ride On is a bus system whose card says neither "bus" nor anything else
        // a generic test would catch, so it is named outright.
        const mode = /plane/.test(id) ? "plane"
                   : (/bus/.test(id) || /bus/.test(head) || /rideon/.test(id)) ? "bus"
                   : "train";
        card.querySelectorAll(".list .row .badge").forEach(b => {
          const t = (b.textContent || "").trim().toUpperCase();
          if (t && t !== "—" && t !== "•") byMode[mode].add(t);
        });
      });
    } catch (_) {}
    return byMode;
  }
  /* "" = not here, "vehicle" = the exact one you logged, "route" = that line is
     serving a stop near you now. Kept apart because they deserve different words:
     one is your bus, the other is a bus. */
  function passState(sp, live, routes) {
    const r = String(sp.route || "").trim().toUpperCase();
    const v = String(sp.vehicle || "").trim().toUpperCase();
    if (live && live.size && ((r && live.has(r)) || (v && live.has(v)))) return "vehicle";
    const set = routes && routes[sp.mode];
    if (set && r && set.has(r)) return "route";
    return "";
  }

  function ago(ts) {
    if (!ts) return "";                    // a row whose timestamp didn't survive the Sheet
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 90) return "just now";
    if (s < 3600) return Math.round(s / 60) + " min ago";
    if (s < 86400) return Math.round(s / 3600) + "h ago";
    return Math.round(s / 86400) + "d ago";
  }

  /* Has someone deliberately unlocked this screen for setup? Deliberately not
     TBAdmin.isAdmin(), which answers true when no admin login exists at all —
     that is exactly a fresh customer's state, so it would show everyone the
     operator text. */
  const isUnlocked = () => {
    try { return localStorage.getItem("tb.admin") === "1"; } catch (_) { return false; }
  };

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
         <button type="button" id="spotScopeBtn" title="Show sightings from everywhere, or just around here"></button>
         <button type="button" id="spotFeedBtn" data-admin title="Shared feed — see sightings logged on your phone">⇄</button></h2>
       <div class="statline" id="spotStat"></div>
       <div id="spotFeedBox" data-admin style="display:none"></div>
       <div class="list" id="spotList"></div>`;
    cards.appendChild(card);
    if (!document.getElementById("spotPassCss")) {
      const st = document.createElement("style");
      st.id = "spotPassCss";
      // accent edge + soft glow: readable across the room, and never colour alone
      // (the row also says "passing now" in words)
      st.textContent = ".row.spot-passing{border-color:var(--good,#4ade80);" +
        "box-shadow:0 0 0 1px var(--good,#4ade80) inset, 0 0 10px -2px var(--good,#4ade80)}" +
        ".row.spot-passing .dest{color:var(--good,#4ade80)}" +
        ".row.spot-route{border-color:var(--accent,#ffd166);box-shadow:0 0 0 1px var(--accent,#ffd166) inset}" +
        ".row.spot-route .dest{color:var(--accent,#ffd166)}" +
        ".row.spot-route .live-tag{animation:spotPulse 2s ease-in-out infinite}" +
        "@keyframes spotPulse{0%,100%{opacity:1}50%{opacity:.55}}" +
        ".row.spot-passing .live-tag{animation:spotPulse 2s ease-in-out infinite}";
      document.head.appendChild(st);
    }
    // tapping the header opens the phone app (same place you'd add a sighting)
    const h2 = card.querySelector("h2");
    h2.style.cursor = "pointer";
    h2.title = "Open the Spotter app";
    // Any control in the header acts on the card; only bare header space opens the
    // app. Whitelisting one button by id broke the moment a second was added.
    h2.onclick = e => { if (!e.target.closest("button")) window.location.href = "spot.html"; };
    const pill = "font:inherit;font-size:10px;font-weight:700;cursor:pointer;padding:2px 8px;" +
      "border-radius:999px;border:1px solid currentColor;background:transparent;" +
      "color:var(--muted,#8fa3bf);opacity:.8;letter-spacing:.04em";
    const btn = card.querySelector("#spotScopeBtn");
    btn.style.cssText = "margin-left:auto;" + pill;
    btn.onclick = e => { e.stopPropagation(); setScope(scope() === "near" ? "all" : "near"); };
    const fbtn = card.querySelector("#spotFeedBtn");
    fbtn.style.cssText = "margin-left:6px;" + pill;
    fbtn.onclick = e => { e.stopPropagation(); toggleFeedBox(); };
    return card;
  }

  /* ---- shared-feed setup, on the board itself ---------------------------
     The phone app has a field for this URL; the boards had none, so a sighting
     logged on a phone could never reach a TV or kiosk without opening devtools
     on it — which is exactly the setup this feature is for. Lives here rather
     than in each board's ⚙ panel because this one file is what all eight boards
     load, and the panels differ per board. */
  function toggleFeedBox() {
    const box = document.getElementById("spotFeedBox");
    if (!box) return;
    if (box.style.display !== "none") { box.style.display = "none"; box.innerHTML = ""; render(); return; }
    box.style.display = "";
    box.style.cssText += ";margin:2px 0 8px;padding:9px 10px;border-radius:6px;" +
      "background:var(--row-bg,rgba(255,255,255,.04));border:1px solid var(--row-line,rgba(255,255,255,.08))";
    box.innerHTML =
      `<div style="font-size:11px;color:var(--muted,#8fa3bf);line-height:1.45;margin-bottom:7px">
         Sightings are saved on the device that logged them. On your phone open the
         Spotter, tap <b>⚙ → Share to my boards</b>, and it shows a <b>share code</b>.
         Type that code here. No account, no setup, nothing to deploy.
       </div>
       <div style="display:flex;gap:6px;flex-wrap:wrap">
         <input type="text" id="spotFeedInput" spellcheck="false" autocomplete="off"
           placeholder="paste the share code from your phone"
           style="flex:1 1 200px;min-width:0;font:inherit;font-size:12px;padding:5px 8px;border-radius:4px;
                  background:var(--panel,rgba(0,0,0,.25));color:inherit;
                  border:1px solid var(--row-line,rgba(255,255,255,.15))" />
         <button type="button" id="spotFeedSave" style="font:inherit;font-size:11px;font-weight:700;
           cursor:pointer;padding:5px 12px;border-radius:4px;border:0;background:var(--accent,#ffd166);
           color:#08101f">Save</button>
         <button type="button" id="spotFeedClear" style="font:inherit;font-size:11px;cursor:pointer;
           padding:5px 10px;border-radius:4px;background:transparent;color:var(--muted,#8fa3bf);
           border:1px solid var(--row-line,rgba(255,255,255,.15))">Clear</button>
       </div>
       <div id="spotFeedMsg" style="font-size:11px;margin-top:6px;min-height:1em"></div>`;
    const input = box.querySelector("#spotFeedInput");
    input.value = anyFeed();
    box.querySelector("#spotFeedSave").onclick = async () => {
      const msg = box.querySelector("#spotFeedMsg");
      msg.style.color = "var(--muted,#8fa3bf)"; msg.textContent = "Checking…";
      setFeedUrl(input.value);
      await pull();
      if (!anyFeed()) { msg.textContent = "Cleared — showing only this device's log."; }
      else if (remoteErr) { msg.style.color = "var(--warn,#ffb454)"; msg.textContent = "Couldn't reach it: " + remoteErr; }
      else { msg.style.color = "var(--good,#4ade80)"; msg.textContent = `Connected — ${remote.length} shared sighting${remote.length === 1 ? "" : "s"}.`; }
      render();
    };
    box.querySelector("#spotFeedClear").onclick = () => { input.value = ""; setFeedUrl(""); toggleFeedBox(); };
    input.focus();
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
    /* A sighting with no coordinates (logged with location off) CANNOT be shown
       to be far away, and dropping the user's own entries is a worse failure
       than the one this scoping was added to fix — that was about placed
       sightings surfacing in the wrong city. So unknown-location entries always
       show, labelled as such; only genuinely-distant ones are filtered out. */
    const shown = near ? placed.filter(p => p.mi == null || p.mi <= NEAR_MI) : placed;
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
      /* Two very different situations used to read the same way. If no shared
         feed is set, a log made on a phone CANNOT reach this screen, and telling
         someone to go log more on their phone is the wrong advice entirely. */
      /* And a third situation, which is most people: a customer who has never
         opened the Spotter app. Walking them through share codes and a ⇄ button
         is setup instruction for a feature they have not asked for — the same
         mistake as telling them to go and add a WMATA key. They get a plain
         description of what the card is for; the operator, on a screen they have
         actually unlocked, still gets the steps. */
      const operator = isUnlocked();
      list.innerHTML = anyFeed()
        ? `<div class="empty">No sightings yet.${remoteErr
             ? (operator ? ` Shared feed unreachable (${esc(remoteErr)}) — check the URL with ⇄ above.`
                         : ` Shared feed unreachable.`) : ""}</div>`
        : operator
          ? `<div class="empty">Nothing logged on <i>this</i> device. Sightings stay on the
               device that logged them — on your phone tap <b>⚙ → Share to my boards</b>,
               then enter that share code here with <b>⇄</b> above.</div>`
          : `<div class="empty">Trains, buses and planes you log in the Spotter app
               show up here.</div>`;
      stat.innerHTML = ""; count.textContent = "";
      return;
    }
    if (!shown.length) {
      list.innerHTML = `<div class="empty">No sightings within ${NEAR_MI} mi of here.
        ${elsewhere} logged elsewhere — tap “near here” above to show them.</div>`;
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
    /* Anything passing right now goes to the top and stays there — it is the one
       thing on this card you can still walk outside and look at. Everything else
       keeps its newest-first order. */
    const live = liveIdents(), routes = liveRoutes();
    const hot = {}; all.forEach(s => { hot[s.id] = passState(s, live, routes); });
    const rank = s => hot[s.id] === "vehicle" ? 2 : hot[s.id] === "route" ? 1 : 0;
    all.sort((a, b) => rank(b) - rank(a) || b.ts - a.ts);
    const passingNow = all.filter(s => hot[s.id]).length;
    if (passingNow) count.textContent = `${passingNow} passing now`;

    all.slice(0, 40).forEach(s => {
      const row = document.createElement("div");
      row.className = "row" + (hot[s.id] === "vehicle" ? " spot-passing"
                                : hot[s.id] === "route" ? " spot-route" : "");
      // badge carries the MODE (glyph + colour); the route is the row's title, so
      // the two don't restate each other and long line names aren't truncated
      const badge = `<div class="badge" style="background:${COLOR[s.mode] || "#6aa9ff"}">${
        GLYPH[s.mode] || "•"}</div>`;
      const mi = miOf[s.id];
      const dist = mi == null ? "location not recorded"
                 : (mi < 1 ? "here" : `${Math.round(mi)} mi away`);
      const bits = [s.vehicle, s.place, dist, s.by ? "by " + s.by : ""].filter(Boolean).join(" · ");
      row.innerHTML = `${badge}
        <div><div class="dest">${esc(s.route || "—")}</div>
             ${bits ? `<div class="sub">${esc(bits)}</div>` : ""}</div>
        <div></div>
        <div class="times">${hot[s.id] === "vehicle"
            ? `<div class="live-eta" style="color:var(--good)">near you</div>
               <div class="live-tag">passing now</div>`
            : hot[s.id] === "route"
            ? `<div class="live-eta" style="color:var(--accent)">a ${esc(s.route)}</div>
               <div class="live-tag">due near you</div>`
            : `<div class="sched">${esc(ago(s.ts))}</div>
               ${s.ridden ? `<div class="live-tag" style="color:var(--good)">rode</div>` : ""}`}</div>`;
      list.appendChild(row);
    });
    trim(list);
  }

  async function pull() {
    const id = blobId(), sh = sheetUrl(), url = feedUrl();
    if (!id && !sh && !url) { remote = []; remoteErr = ""; return; }
    try {
      let spots;
      if (id) {
        const r = await fetch(BLOB_API + id, { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 404 ? "share code not found" : "HTTP " + r.status);
        const d = await r.json();
        spots = Array.isArray(d) ? d : (d && d.spots);
      } else if (sh) {
        const d = await jsonp(sh);
        spots = d && d.spots;
      } else {
        /* The Worker feed is secret-scoped now, so send the same secret the app
           posts with; a configured worker answers 403 without it. */
        let sec = ""; try { sec = (localStorage.getItem("tb.spotFeedSecret") || "").trim(); } catch (_) {}
        const r = await fetch(url + "/feed?limit=40" + (sec ? "&s=" + encodeURIComponent(sec) : ""),
                              { cache: "no-store" });
        if (!r.ok) throw new Error(r.status === 403 ? "feed secret rejected" : "HTTP " + r.status);
        spots = (await r.json()).spots;
      }
      if (Array.isArray(spots)) { remote = spots; remoteErr = ""; }
      else throw new Error("no spots in response");
    } catch (e) {
      // keep whatever we had, but remember why — a mistyped Worker URL used to
      // fail completely silently, which looks identical to "nothing logged yet"
      remoteErr = (e && e.message) || "unreachable";
    }
  }

  async function tick() { await pull(); render(); }

  function start() {
    render();
    tick();
    setInterval(tick, 60000);
    // the shared feed is polled once a minute, but "passing now" is computed from
    // the board's own live fleets, so repaint on their cadence -- costs no fetch
    setInterval(render, 10000);
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
