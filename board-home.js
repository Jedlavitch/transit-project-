/* Presentation chrome for the city boards. Existing links, data and board
   controls retain their own handlers; board-home.css owns its visibility. */
(function () {
  "use strict";

  function sectionHeading(host, before, className, title, caption) {
    if (!host || !before || host.querySelector("." + className)) return;
    var heading = document.createElement("h2");
    heading.className = "tb-section-heading " + className;
    heading.appendChild(document.createTextNode(title));
    var label = document.createElement("span");
    label.textContent = caption;
    heading.appendChild(label);
    host.insertBefore(heading, before);
  }

  function init() {
    var app = document.getElementById("app");
    if (!app) return;
    var header = app.querySelector("header");
    if (!header) return;

    var map = app.querySelector("main #map"), cards = app.querySelector("main .cards");
    // This script loads after the board modules. Retain their initial order
    // so changing the presentation never replaces a card or its listeners.
    var originalOrder = cards ? [].slice.call(cards.children) : [];
    var secondaryIds = ["alertCard", "commuteCard", "cityAdvisoryCard", "spotCard", "leaderCard", "ontimeCard"];
    function isClassic() {
      var style = document.documentElement.getAttribute("data-style");
      return !style || style === "classic" || style === "glass";
    }
    function syncCardOrder() {
      if (!cards) return;
      var order = originalOrder.filter(function (node) { return node.parentNode === cards; });
      if (isClassic()) {
        order = order.filter(function (node) { return secondaryIds.indexOf(node.id) < 0; }).concat(
          order.filter(function (node) { return secondaryIds.indexOf(node.id) >= 0; })
        );
      }
      var current = [].slice.call(cards.children);
      if (order.every(function (node, index) { return current[index] === node; })) return;
      order.forEach(function (node) { cards.appendChild(node); });
    }

    var title = header.querySelector(".title"), name = title && title.querySelector(".t-grad");
    if (name && !title.querySelector(".tb-board-kicker")) {
      var kicker = document.createElement("span");
      kicker.className = "tb-board-kicker";
      kicker.textContent = "TRANSIT PROJECT / LIVE BOARD";
      title.insertBefore(kicker, name);
    }
    if (name && !title.querySelector(".tb-board-city")) {
      var picker = header.querySelector(".city-picker select");
      var selected = picker && picker.options[picker.selectedIndex];
      var city = document.createElement("span");
      city.className = "tb-board-city";
      city.textContent = selected ? selected.textContent.trim() : name.textContent.replace(/\s+Live Transit\s*$/i, "").trim();
      title.insertBefore(city, name);
    }

    var views = header.querySelector(".tb-board-views");
    var links = header.querySelector(".view-links");
    if (links && !header.querySelector(".tb-board-views")) {
      views = document.createElement("details");
      views.className = "tb-board-views";
      var summary = document.createElement("summary");
      summary.textContent = "Views";
      views.appendChild(summary);
      links.parentNode.insertBefore(views, links);
      views.appendChild(links);

      document.addEventListener("click", function (event) {
        if (isClassic() && views.open && !views.contains(event.target)) views.open = false;
      });
      document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape" || !isClassic() || !views.open) return;
        event.preventDefault();
        views.open = false;
        summary.focus();
      });
    }

    function syncStyle() {
      // Other designs keep their original visible navigation. In Classic,
      // each style change starts with its compact Views menu closed.
      if (views) views.open = !isClassic();
      syncCardOrder();
    }
    syncStyle();
    if (window.MutationObserver) {
      new MutationObserver(syncStyle).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-style"]
      });
    }

    sectionHeading(map && map.parentNode, map, "tb-map-heading", "Around you", "NETWORK MAP");
    sectionHeading(cards && cards.parentNode, cards, "tb-departure-heading", "Departures & details", "YOUR CITY AT A GLANCE");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
