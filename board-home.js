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

  // Keep the original anchors and their gate/city handlers. Only their
  // presentation changes; links added later by account/highlight modules are
  // decorated by the same observer.
  function enhanceViews(views, links, cityName) {
    if (!views || !links || views.classList.contains("tb-view-launcher")) return;
    views.classList.add("tb-view-launcher");
    var summary = views.querySelector("summary");
    summary.setAttribute("aria-controls", "tbViewPanel");
    summary.setAttribute("aria-expanded", "false");
    links.id = "tbViewPanel";
    links.setAttribute("aria-label", "Choose a display view");
    var original = [].slice.call(links.querySelectorAll("a"));
    var sky = links.querySelector('a[href*="night.html"]');
    var cityId = "dc";
    try { cityId = new URL(sky ? sky.href : location.href).searchParams.get("city") || "dc"; } catch (_) {}
    var iconPaths = {
      sky:'<path d="m3 14 8-2 6-9 2 1-2 8 5 3v2l-7-1-3 5h-2l1-6-8 1z"/>',
      board:'<rect x="2" y="4" width="20" height="17" rx="2"/><path d="M2 12h20M9 4v17m7-17v17"/>',
      projector:'<path d="M3 4h18v14H3zm9 14v4m-4 0h8M6 13l4-4 4 3 4-5"/>',
      home:'<path d="m2 11 10-8 10 8M5 9v13h14V9M9 22v-7h6v7"/>',
      tour:'<path d="m2 5 7-2 6 2 7-2v17l-7 2-6-2-7 2zm7-2v17m6-15v17m-9-8 4-4 5 3 4-5"/>',
      tv:'<rect x="2" y="3" width="20" height="15" rx="2"/><path d="M8 22h8m-4-4v4"/>',
      camera:'<path d="M3 7h12v13H3zm12 4 7-4v13l-7-4M6 3h6"/>',
      spot:'<circle cx="12" cy="9" r="3"/><path d="M20 9c0 6-8 13-8 13S4 15 4 9a8 8 0 0 1 16 0z"/>',
      best:'<path d="m12 2 3 7 7 .5-5.5 5 1.5 7-6-3.5L6 22l1.5-7L2 9.5 9 9z"/>',
      account:'<circle cx="12" cy="7" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/>'
    };
    function icon(key) { return window.TBViewArt ? window.TBViewArt(key) : '<svg viewBox="0 0 24 24" aria-hidden="true">' + (iconPaths[key] || iconPaths.tv) + '</svg>'; }
    var head = document.createElement("div"); head.className = "tb-view-head";
    var title = document.createElement("strong"); title.textContent = "Choose your view";
    var place = document.createElement("span"); place.textContent = cityName || "This city";
    head.appendChild(title); head.appendChild(place);
    // Anchors remain direct children: late-loading board modules insert their
    // Highlights link before Account using nav.insertBefore().
    var tools = document.createElement("div"); tools.className = "tb-view-tools";
    var preview = document.createElement("p"); preview.className = "tb-view-hint";
    var defaultHint = "You’re on the live board. Choose another way to watch.";
    preview.textContent = defaultHint;
    links.appendChild(head); links.appendChild(tools); links.appendChild(preview);
    function metadata(a) {
      var href = a.getAttribute("href") || "", text = a.textContent.trim();
      if (/cam=/.test(href)) return {key:"camera",name:text,desc:"Live runway camera",order:2};
      if (/night\.html/.test(href)) return {key:"sky",name:"Sky",desc:"Follow the aircraft overhead",order:0};
      if (/flipboard\.html/.test(href)) return {key:"board",name:"Departures",desc:"A classic split-flap board",order:1};
      if (/projector\.html/.test(href)) return {key:"projector",name:"Projector",desc:"Your city skyline, after dark",order:3};
      if (/home\.html/.test(href)) return {key:"home",name:"Home",desc:"Weather, sky, and your day",order:4};
      if (/tour\.html/.test(href)) return {key:"tour",name:"Grand Tour",desc:"Watch every city on one map",order:5};
      if (/tv\.html/.test(href)) return {key:"tv",name:"TV menu",desc:"Choose a city and a display",order:6};
      if (/spot\.html/.test(href)) return {key:"spot",name:"Spotter",desc:"Log the things you see",tool:true};
      if (/leaderboard|best/i.test(href + " " + text)) return {key:"best",name:"Highlights",desc:"The most interesting sightings",tool:true};
      if (/profile|account/i.test(href + " " + text)) return {key:"account",name:"Account",desc:"Your account and saved settings",tool:true};
      return {key:"tv",name:text,desc:a.getAttribute("title") || "Open this view",order:7};
    }
    function decorate(a) {
      if (a.classList.contains("tb-view-card") || a.classList.contains("tb-view-tool")) return;
      var info = metadata(a);
      a.classList.add(info.tool ? "tb-view-tool" : "tb-view-card");
      a.setAttribute("data-view-kind", info.key);
      a.setAttribute("aria-label", info.name + " — " + info.desc);
      a.setAttribute("data-view-order", info.order == null ? 10 : info.order);
      a.style.setProperty("--view-delay", (info.order || 0) * 35 + "ms");
      a.textContent = "";
      var art = document.createElement("span"); art.className = "tb-view-icon"; art.innerHTML = icon(info.key);
      var copy = document.createElement("span"); copy.className = "tb-view-copy";
      var name = document.createElement("span"); name.className = "tb-view-name"; name.textContent = info.name;
      var desc = document.createElement("span"); desc.className = "tb-view-desc"; desc.textContent = info.desc;
      copy.appendChild(name); copy.appendChild(desc); a.appendChild(art); a.appendChild(copy);
      if (!info.tool) { var arrow = document.createElement("span"); arrow.className = "tb-view-arrow"; arrow.textContent = "↗"; a.appendChild(arrow); }
      a.addEventListener("mouseenter", function () { preview.textContent = info.name + " · " + info.desc; });
      a.addEventListener("focus", function () { preview.textContent = info.name + " · " + info.desc; });
      a.addEventListener("click", function () { try { localStorage.setItem("tb.tvLastCity", cityId); } catch (_) {} });
      links.insertBefore(a, info.tool ? preview : tools);
      [].slice.call(links.querySelectorAll("a.tb-view-card")).sort(function (a, b) { return +a.dataset.viewOrder - +b.dataset.viewOrder; }).forEach(function (node) { links.insertBefore(node, tools); });
    }
    original.forEach(decorate);
    [{id:"projectorViewBtn",href:"projector.html?city=" + encodeURIComponent(cityId) + "&surface=wall",text:"Projector"},
     {id:"homeViewBtn",href:"home.html",text:"Home"}].forEach(function (entry) {
      if ([].some.call(links.querySelectorAll("a"), function (a) { return a.getAttribute("href").split("?")[0] === entry.href.split("?")[0]; })) return;
      var a = document.createElement("a"); a.id = entry.id; a.href = entry.href; a.textContent = entry.text; decorate(a);
    });
    if (window.MutationObserver) new MutationObserver(function (records) {
      records.forEach(function (r) { [].forEach.call(r.addedNodes, function (node) { if (node.tagName === "A") decorate(node); }); });
    }).observe(links, {childList:true});
    function position() {
      if (!views.open) return;
      links.style.transform = "";
      var anchor = summary.getBoundingClientRect(), scale = anchor.width / (summary.offsetWidth || anchor.width) || 1;
      links.style.width = Math.min(540, (innerWidth - 28) / scale) + "px";
      var below = innerHeight - anchor.bottom - 20, above = anchor.top - 20;
      var up = below < 290 && above > below;
      links.style.top = up ? "auto" : "calc(100% + 12px)";
      links.style.bottom = up ? "calc(100% + 12px)" : "auto";
      links.style.maxHeight = Math.max(150, (up ? above : below) / scale) + "px";
      var rect = links.getBoundingClientRect(), shift = rect.left < 14 ? 14 - rect.left : rect.right > innerWidth - 14 ? innerWidth - 14 - rect.right : 0;
      if (shift) links.style.transform = "translateX(" + shift / scale + "px)";
    }
    views.addEventListener("toggle", function () { summary.setAttribute("aria-expanded", String(views.open)); position(); if (!views.open) preview.textContent = defaultHint; });
    summary.addEventListener("keydown", function (e) { if (e.key === "ArrowDown") { e.preventDefault(); views.open = true; position(); var first = links.querySelector("a.tb-view-card"); if (first) first.focus(); } });
    links.addEventListener("keydown", function (e) {
      var list = [].slice.call(links.querySelectorAll("a")), at = list.indexOf(document.activeElement), next;
      if (at < 0) return;
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); views.open = false; summary.focus(); return; }
      if (e.key === "ArrowRight") next = at + 1;
      if (e.key === "ArrowLeft") next = at - 1;
      if (e.key === "ArrowDown") next = at + 2;
      if (e.key === "ArrowUp") next = at - 2;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = list.length - 1;
      if (next != null) { e.preventDefault(); e.stopPropagation(); list[Math.max(0, Math.min(list.length - 1, next))].focus(); }
    });
    views.addEventListener("focusout", function () { setTimeout(function () { if (views.open && !views.contains(document.activeElement)) views.open = false; }, 0); });
    addEventListener("resize", position);
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
        if (views.open && !views.contains(event.target)) views.open = false;
      });
      document.addEventListener("keydown", function (event) {
        if (event.key !== "Escape" || !views.open) return;
        event.preventDefault();
        views.open = false;
        summary.focus();
      });
    }
    enhanceViews(views, links, header.querySelector(".tb-board-city") && header.querySelector(".tb-board-city").textContent);

    function syncStyle() {
      // Every presentation uses the same compact view switcher.
      if (views) views.open = false;
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
