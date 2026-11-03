/* Put selected official advisory links and connection notes on the live board.
   Choices belong to this city. Existing live alert cards keep their own feeds
   and incident text; the links here are never presented as an all-clear. */
(function () {
  "use strict";
  var city = location.pathname.split("/").pop().replace(/\.html$/, "");
  var profile = (window.TBCityShortcutsData || {})[city];
  if (!profile) return;
  var key = "tb.cityBoard." + city + ".v1", cardId = "cityAdvisoryCard";
  var prefs = read(), card, editor;
  function esc(s) { return String(s || "").replace(/[&<>"']/g, function (c) { return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); }
  function read() {
    var defaults = { resources: profile.resources.slice(0, 2).map(function (r) { return r.url; }), places: profile.places.slice(0, 1).map(function (p) { return p.id; }) };
    try {
      var p = JSON.parse(localStorage.getItem(key) || "null");
      if (!p || !Array.isArray(p.resources) || !Array.isArray(p.places)) return defaults;
      return {
        resources: profile.resources.filter(function (r) { return p.resources.indexOf(r.url) >= 0; }).map(function (r) { return r.url; }),
        places: profile.places.filter(function (v) { return p.places.indexOf(v.id) >= 0; }).slice(0, 2).map(function (v) { return v.id; })
      };
    } catch (_) { return defaults; }
  }
  function save() { try { localStorage.setItem(key, JSON.stringify(prefs)); return true; } catch (_) { return false; } }
  function toolkit() { return window.TBCityToolkit; }
  // Register before the boards build their normal Show on board checkboxes.
  try {
    if (typeof CARD_DEFS !== "undefined" && !CARD_DEFS.some(function (d) { return d.id === cardId; }))
      CARD_DEFS.push({ id: cardId, label: "Travel advisories" });
  } catch (_) {}

  function render() {
    if (!card) return;
    var list = card.querySelector(".list");
    var html = profile.resources.filter(function (r) { return prefs.resources.indexOf(r.url) >= 0; }).map(function (r) {
      return '<a class="cab-resource" href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer" aria-label="' + esc(r.label) + ' (opens operator website)"><span>' + esc(r.label) + '</span><span aria-hidden="true">↗</span></a>';
    }).join("");
    html += profile.places.filter(function (p) { return prefs.places.indexOf(p.id) >= 0; }).map(function (p) {
      return '<div class="cab-note"><a class="cab-place-title" href="' + esc(p.source) + '" target="_blank" rel="noopener noreferrer">' + esc(p.label) + ' ↗</a>' +
        '<p>' + esc(p.note) + '</p><div class="cab-note-actions"><a data-cab-plan="' + esc(p.id) + '" href="' + esc(toolkit().planUrl(p.id)) + '" target="_blank" rel="noopener noreferrer">Plan transit ↗</a>' +
        '<button type="button" data-cab-watch="' + esc(p.id) + '">Watch here</button></div></div>';
    }).join("");
    list.innerHTML = html || '<p class="cab-empty">Pin the advisory links and local travel notes you want to see. Choose Edit to get started.</p>';
    try { if (typeof fitAll === "function") fitAll(); } catch (_) {}
  }
  function edit() {
    toolkit().open(); editor.open = true;
    editor.scrollIntoView({ block: "start" }); editor.querySelector("summary").focus();
  }
  function refreshLinks(e) {
    var link = e.target.closest("[data-cab-plan]");
    if (link) link.href = toolkit().planUrl(link.getAttribute("data-cab-plan"));
  }
  function paintEditor() {
    [].slice.call(editor.querySelectorAll("[data-cab-resource]")).forEach(function (input) {
      input.checked = prefs.resources.indexOf(profile.resources[+input.getAttribute("data-cab-resource")].url) >= 0;
    });
    [].slice.call(editor.querySelectorAll("[data-cab-place]")).forEach(function (input) {
      input.checked = prefs.places.indexOf(input.getAttribute("data-cab-place")) >= 0;
    });
  }
  function init() {
    var cards = document.querySelector(".cards"), scroll = document.querySelector("#cityToolkit .ct-scroll");
    if (!cards || !scroll || !toolkit() || document.getElementById(cardId)) return;
    card = document.createElement("div"); card.id = cardId; card.className = "card";
    card.style.setProperty("--sys", "var(--accent)");
    card.innerHTML = '<h2><span class="t">Travel advisories</span><button type="button" class="cab-edit" aria-label="Customize travel advisories for ' + esc(profile.name) + '">Edit</button></h2>' +
      '<div class="statline">' + esc(profile.name) + ' · official links & local notes</div><div class="list" data-scroll-list="true" data-want="120"></div>';
    cards.insertBefore(card, cards.firstChild);
    try { if (typeof loadHiddenCards === "function" && loadHiddenCards().has(cardId)) card.classList.add("user-hidden"); } catch (_) {}
    card.querySelector(".cab-edit").onclick = edit;
    card.addEventListener("pointerdown", refreshLinks);
    card.addEventListener("focusin", refreshLinks);
    card.addEventListener("click", function (e) {
      refreshLinks(e);
      var b = e.target.closest("[data-cab-watch]");
      if (b) toolkit().watch(b.getAttribute("data-cab-watch"));
    });

    editor = document.createElement("details"); editor.id = "ctBoardSettings"; editor.className = "ct-board-settings";
    editor.innerHTML = '<summary>Customize ' + esc(profile.name) + ' board</summary>' +
      '<p class="ct-board-intro">Pin the updates and connections you use. These choices are saved for this city.</p>' +
      '<fieldset><legend>Advisory links on the board</legend><div class="ct-board-options">' +
      profile.resources.map(function (r, i) { return '<label><input type="checkbox" data-cab-resource="' + i + '"><span>' + esc(r.label) + '</span></label>'; }).join("") + '</div></fieldset>' +
      '<fieldset><legend>Local connection notes <small>Choose up to two</small></legend><div class="ct-board-options">' +
      profile.places.map(function (p) { return '<label><input type="checkbox" data-cab-place="' + esc(p.id) + '"><span>' + esc(p.label) + '</span></label>'; }).join("") + '</div></fieldset>' +
      '<div class="ct-board-look"><div><strong>Give this city its own look</strong><p>Choose a design, theme, accent and row density in Display settings.</p></div><button type="button" id="ctEditCityLook">Appearance settings</button></div>' +
      '<p id="ctBoardStatus" class="ct-board-status" role="status" aria-live="polite"></p>';
    scroll.insertBefore(editor, scroll.firstChild);
    paintEditor();
    editor.onchange = function (e) {
      var input = e.target, status = document.getElementById("ctBoardStatus");
      if (input.hasAttribute("data-cab-place")) {
        var selected = [].slice.call(editor.querySelectorAll("[data-cab-place]:checked"));
        if (selected.length > 2) { input.checked = false; status.textContent = "Choose up to two connection notes. Unpin one to make room."; return; }
        prefs.places = selected.map(function (n) { return n.getAttribute("data-cab-place"); });
      } else if (input.hasAttribute("data-cab-resource")) {
        prefs.resources = [].slice.call(editor.querySelectorAll("[data-cab-resource]:checked")).map(function (n) { return profile.resources[+n.getAttribute("data-cab-resource")].url; });
      } else return;
      var stored = save(); render();
      status.textContent = stored ? "Updated on your " + profile.name + " board." : "Updated for this visit. Browser storage is unavailable.";
    };
    document.getElementById("ctEditCityLook").onclick = function () {
      toolkit().close();
      var settings = document.getElementById("settingsBtn"); if (settings) settings.click();
      [].slice.call(document.querySelectorAll("#setup .tbset-tab")).forEach(function (b) { if (b.textContent === "Display") b.click(); });
      var scope = document.querySelector("#cityLookScope [data-scope='city']");
      if (scope) { scope.scrollIntoView({ block: "center" }); scope.focus(); }
    };
    render();
    try { if (typeof initMiniCards === "function") initMiniCards(); } catch (_) {}
    window.addEventListener("storage", function (e) { if (e.key === key || e.key === null) { prefs = read(); paintEditor(); render(); } });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
