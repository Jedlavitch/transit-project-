/* City toolkit: local travel shortcuts and per-city bookmarks.
   Uses each board's existing location/refresh functions. Watching a shortcut
   never writes its saved location or manual-location preference. No extra feed
   polling, credentials, routing service, or build step is introduced. */
(function () {
  "use strict";

  var city = location.pathname.split("/").pop().replace(/\.html$/, "");
  var profile = (window.TBCityShortcutsData || {})[city];
  if (!profile) return;

  var key = "tb.cityShortcuts." + city + ".places";
  var saved = readPlaces(), filter = "all", query = "", preview = null;
  var overlay, panel, launcher, dock, previousFocus, inertSiblings = [];
  var shownLocation = null, shownOrigin = null, defaultName = "";
  var MAX_PLACES = 6;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function valid(p) {
    return p && typeof p.label === "string" && p.label.trim() &&
      typeof p.lat === "number" && isFinite(p.lat) && Math.abs(p.lat) <= 90 &&
      typeof p.lon === "number" && isFinite(p.lon) && Math.abs(p.lon) <= 180;
  }
  function copy(p) { return { lat: p.lat, lon: p.lon, label: p.label || "Board location" }; }
  function same(a, b) { return a && b && Math.abs(a.lat - b.lat) < .00001 && Math.abs(a.lon - b.lon) < .00001; }
  function readPlaces() {
    try {
      var items = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(items) ? items.filter(valid).slice(0, 6).map(copy) : [];
    } catch (_) { return []; }
  }
  function persist() {
    try { localStorage.setItem(key, JSON.stringify(saved)); return true; }
    catch (_) { return false; }
  }
  function boardState() {
    // The boards' `let state` is a lexical global, not window.state.
    try { return typeof state !== "undefined" ? state : null; } catch (_) { return null; }
  }
  function boardLocation() { var s = boardState(); return s && s.loc && valid(copy(s.loc)) ? copy(s.loc) : null; }
  function origin() {
    if (preview && !same(boardLocation(), preview.place)) { preview = null; showDock(); }
    return preview ? preview.back : boardLocation();
  }
  function safeUrl(s) { return /^https:\/\//i.test(s || "") ? esc(s) : "#"; }
  function transitUrl(p) {
    var from = origin();
    var url = "https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=" +
      encodeURIComponent(p.lat + "," + p.lon);
    if (from) url += "&origin=" + encodeURIComponent(from.lat + "," + from.lon);
    return url;
  }
  function say(text) { document.getElementById("ctMessage").textContent = text; }
  function icon() {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.5"/></svg>';
  }

  function renderPlaces() {
    var places = filter === "saved" ? saved : profile.places;
    var needle = query.toLowerCase().trim();
    var matches = [];
    places.forEach(function (p, i) {
      if (filter !== "all" && filter !== "saved" && p.kind !== filter) return;
      if (needle && (p.label + " " + (p.note || "")).toLowerCase().indexOf(needle) < 0) return;
      matches.push({ p: p, i: i });
    });
    var list = document.getElementById("ctPlaces");
    list.innerHTML = matches.map(function (item) {
      var p = item.p, isSaved = filter === "saved";
      var type = isSaved ? "Your place" : p.kind === "airport" ? "Airport connection" : p.kind === "event" ? "After the event" : "Rail connection";
      return '<article class="ct-place"><div class="ct-place-top"><span class="ct-kind">' + esc(type) + '</span>' +
        (p.source ? '<a class="ct-source" href="' + safeUrl(p.source) + '" target="_blank" rel="noopener noreferrer" aria-label="Official travel guide for ' + esc(p.label) + ' (opens in new tab)">Official guide ↗</a>' : '') + '</div>' +
        '<h3>' + esc(p.label) + '</h3><p>' + esc(p.note || "A place you saved from this board.") + '</p>' +
        '<div class="ct-place-actions"><a class="ct-plan" data-plan="' + item.i + '" href="' + esc(transitUrl(p)) + '" target="_blank" rel="noopener noreferrer" aria-label="Plan transit to ' + esc(p.label) + ' in Google Maps (opens in new tab)">Plan transit ↗</a>' +
        '<button type="button" data-watch="' + item.i + '" aria-label="Watch departures near ' + esc(p.label) + '">Watch here</button>' +
        (isSaved ? '<button type="button" class="ct-remove" data-remove="' + item.i + '" aria-label="Remove saved place ' + esc(p.label) + '">Remove</button>' : '') +
        '</div></article>';
    }).join("");
    if (!matches.length) list.innerHTML = '<div class="ct-empty">' +
      (filter === "saved" && !saved.length ? "Your regular stops, one tap away.<br>Save your board’s current location below." : "No matching places. Try another search or category.") + '</div>';
    document.getElementById("ctResultCount").textContent = matches.length + (matches.length === 1 ? " place" : " places");
    var tabs = panel.querySelectorAll("[data-filter]");
    for (var i = 0; i < tabs.length; i++) tabs[i].setAttribute("aria-pressed", String(tabs[i].getAttribute("data-filter") === filter));
  }
  function updateTravelLinks() {
    var places = filter === "saved" ? saved : profile.places;
    [].slice.call(panel.querySelectorAll("[data-plan]")).forEach(function (link) {
      var p = places[+link.getAttribute("data-plan")];
      if (p) link.href = transitUrl(p);
    });
  }
  function updateOrigin(resetName) {
    var from = origin();
    document.getElementById("ctOrigin").textContent = from ? from.label : "your location in Google Maps";
    var current = boardLocation();
    document.getElementById("ctSaveLocation").textContent = current ? current.label : "Board is still locating…";
    var input = document.getElementById("ctPlaceName");
    if (resetName || input.value === defaultName) input.value = current ? current.label.slice(0, 64) : "";
    defaultName = current ? current.label.slice(0, 64) : "";
    shownLocation = current; shownOrigin = from;
    document.getElementById("ctSaveBtn").disabled = !current;
    updateTravelLinks();
  }
  function focusables() {
    return [].slice.call(panel.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),[tabindex="0"]'))
      .filter(function (el) { return el.getClientRects().length; });
  }
  function open() {
    if (!overlay.hidden) return;
    previousFocus = document.activeElement;
    updateOrigin(true); renderPlaces(); say("");
    overlay.hidden = false;
    launcher.setAttribute("aria-expanded", "true");
    // Keep the board out of keyboard/screen-reader navigation while open.
    inertSiblings = [];
    [].slice.call(document.body.children).forEach(function (el) {
      if (el !== overlay && !el.hasAttribute("inert")) { el.setAttribute("inert", ""); inertSiblings.push(el); }
    });
    document.getElementById("ctClose").focus();
  }
  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    inertSiblings.forEach(function (el) { el.removeAttribute("inert"); });
    inertSiblings = [];
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
  }
  function showDock() {
    dock.hidden = !preview;
    if (preview) document.getElementById("ctWatching").textContent = "Watching near " + preview.place.label;
  }
  function move(loc, view) {
    if (typeof applyLoc !== "function" || typeof refreshEverythingForNewLocation !== "function") return false;
    var st = boardState();
    if (!st) return false;
    if (typeof stopFollow === "function") stopFollow();
    applyLoc(copy(loc));
    if (st.map) {
      st.map.invalidateSize();
      st.map.setView(view ? view.center : [loc.lat, loc.lon], view ? view.zoom : 13);
    }
    refreshEverythingForNewLocation();
    return true;
  }
  function watch(p) {
    var current = boardLocation();
    if (!current || !valid(p)) { say("The board is still starting. Try again in a moment."); return; }
    var oldPreview = preview && same(current, preview.place) ? preview : null, view = null;
    try {
      var st = boardState();
      if (st.map) view = { center: st.map.getCenter(), zoom: st.map.getZoom() };
      preview = { back: oldPreview ? oldPreview.back : current, view: oldPreview ? oldPreview.view : view, place: copy(p) };
      if (!move(p)) throw new Error("Board unavailable");
    } catch (_) {
      preview = oldPreview;
      try { move(current, view); } catch (ignored) {}
      say("Could not switch this board. Your saved location has not changed.");
      return;
    }
    close(); showDock(); document.getElementById("ctReturn").focus();
  }
  function goBack() {
    if (!preview) return;
    if (!same(boardLocation(), preview.place)) {
      preview = null; showDock(); launcher.focus(); return;
    }
    var p = preview;
    try {
      if (!move(p.back, p.view)) throw new Error("Board unavailable");
      preview = null; showDock(); launcher.focus();
    } catch (_) {
      document.getElementById("ctWatching").textContent = "Could not return yet. Try again.";
    }
  }
  function saveCurrent(e) {
    e.preventDefault();
    // A GPS fix can arrive while the dialog is open. Keep an untouched name
    // aligned with the current pin; a name the person typed remains theirs.
    updateOrigin(false);
    var current = boardLocation();
    if (!current) { say("Wait for the board to find its location, then try again."); return; }
    var name = document.getElementById("ctPlaceName").value.trim().slice(0, 64);
    if (!name) { say("Give this place a name first."); document.getElementById("ctPlaceName").focus(); return; }
    var at = -1;
    saved.forEach(function (p, i) { if (same(p, current)) at = i; });
    if (at < 0 && saved.length >= MAX_PLACES) { say("You have six saved places. Remove one to make room."); return; }
    current.label = name;
    if (at < 0) saved.push(current); else saved[at] = current;
    var kept = persist();
    filter = "saved"; query = ""; document.getElementById("ctSearch").value = ""; renderPlaces();
    say(kept ? name + " saved for " + profile.name + "." : name + " saved for this visit. Browser storage is unavailable.");
  }
  function init() {
    var header = document.querySelector("#app > header");
    if (!header || document.getElementById("cityToolkit")) return;
    launcher = document.createElement("button");
    launcher.type = "button"; launcher.id = "cityToolkitBtn";
    launcher.className = "ct-launch"; launcher.innerHTML = icon() + '<span>City tools</span>';
    launcher.title = "City toolkit — airports, connections & saved places";
    launcher.setAttribute("aria-label", "City toolkit for " + profile.name);
    launcher.setAttribute("aria-haspopup", "dialog"); launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-controls", "cityToolkit");
    header.insertBefore(launcher, document.getElementById("settingsBtn") || header.lastElementChild);

    overlay = document.createElement("div"); overlay.id = "cityToolkit"; overlay.className = "ct-overlay"; overlay.hidden = true;
    overlay.innerHTML = '<section class="ct-panel" role="dialog" aria-modal="true" aria-labelledby="ctTitle" aria-describedby="ctSubtitle">' +
      '<header class="ct-heading"><div><div class="ct-eyebrow">' + esc(profile.name) + ' / city toolkit</div>' +
      '<h2 id="ctTitle">Your next connection, made easier.</h2><p id="ctSubtitle">' + esc(profile.tagline) + '</p></div>' +
      '<button type="button" id="ctClose" class="ct-close" aria-label="Close city toolkit">×</button></header>' +
      '<div class="ct-scroll"><div class="ct-origin">Plan a trip from <strong id="ctOrigin"></strong><span>Transit directions open in Google Maps.</span></div>' +
      '<div class="ct-filters" role="group" aria-label="Filter places"><button type="button" data-filter="all">All places</button>' +
      '<button type="button" data-filter="airport">Airports</button><button type="button" data-filter="station">Rail hubs</button><button type="button" data-filter="saved">My places</button></div>' +
      '<div class="ct-search-row"><label class="ct-sr" for="ctSearch">Find a place</label><input id="ctSearch" type="search" placeholder="Find a place or connection…" autocomplete="off"><span id="ctResultCount" role="status"></span></div>' +
      '<div class="ct-places" id="ctPlaces"></div>' +
      '<section class="ct-save"><div><h3>Keep a place handy</h3><p>Save the board’s current pin: <strong id="ctSaveLocation"></strong></p></div>' +
      '<form id="ctSaveForm"><label class="ct-sr" for="ctPlaceName">Name your saved place</label><input id="ctPlaceName" maxlength="64" required autocomplete="off" placeholder="Name this place"><button id="ctSaveBtn" type="submit">Save place</button></form></section>' +
      '<section class="ct-help"><div class="ct-section-head"><h3>Check before you leave</h3><span>Official operator information</span></div><div class="ct-help-links">' +
      profile.resources.map(function (r) { return '<a href="' + safeUrl(r.url) + '" target="_blank" rel="noopener noreferrer">' + esc(r.label) + ' <span aria-hidden="true">↗</span></a>'; }).join("") + '</div></section>' +
      '<p class="ct-message" id="ctMessage" role="status" aria-live="polite"></p></div>' +
      '<footer class="ct-foot">“Watch here” temporarily shows nearby departures. Your saved board location stays as it is. Check the operator for service changes and terminal connections.</footer></section>';
    document.body.appendChild(overlay); panel = overlay.querySelector(".ct-panel");
    dock = document.createElement("div"); dock.className = "ct-watch-dock"; dock.hidden = true;
    dock.setAttribute("role", "region"); dock.setAttribute("aria-label", "Temporary board location");
    dock.innerHTML = '<div><strong id="ctWatching" role="status"></strong><span>Temporary view · saved location unchanged</span></div><button type="button" id="ctReturn">Back to my location</button><button type="button" id="ctReopen" aria-label="Open city toolkit">' + icon() + '</button>';
    document.body.appendChild(dock);
    launcher.onclick = open; document.getElementById("ctClose").onclick = close;
    document.getElementById("ctReturn").onclick = goBack; document.getElementById("ctReopen").onclick = open;
    document.getElementById("ctSaveForm").onsubmit = saveCurrent;
    document.getElementById("ctSearch").oninput = function () { query = this.value; renderPlaces(); };
    overlay.onclick = function (e) {
      if (e.target === overlay) { close(); return; }
      // Rebuild destinations at activation as well as on the timer, so a GPS
      // fix immediately before a click cannot send an obsolete trip origin.
      if (e.target.closest("a.ct-plan")) updateOrigin(false);
      var button = e.target.closest("button"); if (!button) return;
      if (button.hasAttribute("data-filter")) { filter = button.getAttribute("data-filter"); renderPlaces(); }
      else if (button.hasAttribute("data-watch")) watch((filter === "saved" ? saved : profile.places)[+button.getAttribute("data-watch")]);
      else if (button.hasAttribute("data-remove")) {
        saved.splice(+button.getAttribute("data-remove"), 1);
        var kept = persist(); renderPlaces();
        say(kept ? "Place removed." : "Place removed for this visit. Browser storage is unavailable.");
        panel.querySelector('[data-filter="saved"]').focus();
      }
    };
    document.addEventListener("keydown", function (e) {
      if (overlay.hidden) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopImmediatePropagation(); close(); }
      else if (e.key === "Tab") {
        var items = focusables(), first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) { e.preventDefault(); if (last) last.focus(); }
        else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) { e.preventDefault(); if (first) first.focus(); }
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        // TV remotes: Up/Down leave single-line fields, as on the boards.
        // Left/Right retain normal caret editing; multiline fields keep Up/Down.
        var tag = e.target && e.target.tagName;
        if (tag === "TEXTAREA") return;
        var controls = focusables(), at = controls.indexOf(document.activeElement);
        var next = Math.max(0, Math.min(controls.length - 1, at + (e.key === "ArrowDown" ? 1 : -1)));
        if (controls[next]) { e.preventDefault(); e.stopImmediatePropagation(); controls[next].focus(); }
      }
    }, true);
    // An address/GPS change made elsewhere wins over a temporary view. Never
    // restore an old location over a new choice in the board's own Settings.
    setInterval(function () {
      if (preview && !same(boardLocation(), preview.place)) { preview = null; showDock(); }
      if (!overlay.hidden) {
        var current = boardLocation(), from = origin();
        if (!same(current, shownLocation) || !same(from, shownOrigin) ||
            (current && shownLocation && current.label !== shownLocation.label) ||
            (from && shownOrigin && from.label !== shownOrigin.label)) updateOrigin(false);
      }
    }, 1000);
    window.addEventListener("storage", function (e) {
      if (e.key === key || e.key === null) { saved = readPlaces(); if (!overlay.hidden) renderPlaces(); }
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
