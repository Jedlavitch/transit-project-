/* =========================================================================
   settings-ui.js — one good ⚙ panel for every board.

   WHY THIS EXISTS
   The gear grew differently on each board. The city boards already group their
   settings into cards (`groupSettings()` builds .set-head/.set-body/.set-group
   the first time the panel opens), but twelve cards in one scroll still means
   hunting for the theme switch past the API keys, and Esc did nothing. The
   flipboard/sky panels never got that treatment at all: one flat column, no
   close button, and the action buttons scrolled off the bottom.

   WHAT IT DOES — two modes, picked per panel.

   1. GROUPED (city boards: #setup, already has .set-body/.set-group)
      Cooperates with what is there. Adds a tab rail and a search box, buckets
      the EXISTING cards by their heading, and hides the ones off-tab. It never
      re-parents a card, so the grid layout, the `.wide` spans, the sticky
      header and footer all keep working exactly as written.

   2. FLAT (flipboard, night: #settings, one undifferentiated column)
      Builds the chrome those panels never had: sticky header with title,
      search and ×, scrolling body, pinned footer holding the page's own
      buttons.

   BOTH modes MOVE nodes; neither rebuilds them. Every id, and therefore every
   handler each board binds by id (`$("#adsbSetBtn")…`), survives untouched.
   Anything it does not recognise it leaves exactly as it found it.
   ========================================================================= */
(function () {
  "use strict";

  var PANELS = ["setup", "settings"];
  var HEAD = ".section-lbl,.accent-lbl,.lbl,.suggest-lbl";

  /* Which tab a heading belongs to. First match wins, so order matters: an
     "Aircraft feed" heading must reach `keys` before "Display size" logic can
     see the word "feed", and "Live position workers" must not read as Display
     just because it contains "position". */
  var TABS = [
    { id: "keys", name: "Feeds & keys", test: /\bkeys?\b|api|aircraft|feed|worker|token|credential|one-time setup|licen[cs]e|account|sign in/i },
    /* Word-bounded on purpose: a bare /near/ swallowed Sky's "Show the
       nearest…" mode picker, which is a display setting, into Location. */
    { id: "place", name: "Location", test: /\blocations?\b|\baddress\b|\bnearby\b|\bcity\b|\bjump to\b|\bregion\b|\bhome\b/i },
    { id: "display", name: "Display", test: /theme|accent|colou?r|size|zoom|text|style|legend|big stop|per box|edge fit|show on|sound|rows|display|layout|clock|density|map/i },
    { id: "adv", name: "Advanced", test: /advanced|debug|diagnos|experimental|reset/i }
  ];
  var FALLBACK = "display";
  var ORDER = ["display", "place", "keys", "adv"];   // everyday knobs first

  function bucket(text) {
    for (var i = 0; i < TABS.length; i++) if (TABS[i].test.test(text)) return TABS[i].id;
    return FALLBACK;
  }
  function tabById(id) { return TABS.filter(function (t) { return t.id === id; })[0]; }

  /* True when a group has a heading and nothing visible under it. admin.js
     hides the key and Worker-URL fields on a board that is not unlocked, which
     would otherwise leave "Live position workers (optional)" standing over an
     empty space. Measured at paint time, because admin.js applies its class
     after this script has already grouped everything. */
  function isBlank(g) {
    var kids = g.children;
    for (var i = 0; i < kids.length; i++) {
      var k = kids[i];
      if (k.matches && k.matches(HEAD)) continue;
      /* Computed display, NOT offsetParent/getClientRects: paint() runs while
         the group is still hidden on its own tab, so every measured box would
         be zero and every group would look blank. An element's own computed
         display is unaffected by a hidden ancestor, which is exactly the
         question being asked here — did admin.js hide THIS field. */
      if (getComputedStyle(k).display !== "none") return false;
    }
    return true;
  }

  /* ---------------------------------------------------------------- styles */
  function css() {
    var ids = PANELS.map(function (i) { return "#" + i + ".tbset"; });
    var sel = function (s) { return ids.map(function (p) { return p + " " + s; }).join(","); };
    /* Expand a selector across each panel AND each dialect's label class. */
    var lbl = function (pre) {
      return HEAD.split(",").map(function (c) { return sel(pre + c); }).join(",");
    };
    /* The segmented-control containers, minus the two that only look like one. */
    var seg = function (suffix) {
      return sel(".theme-row:not(#cardToggles)" + suffix) + "," +
             sel(".seg:not(.swatches)" + suffix);
    };
    return [
      /* Tab rail — shared by both modes. Scrolls sideways so four never wrap. */
      sel(".tbset-tabs") + "{flex:none;display:flex;gap:6px;padding:10px 16px;border-bottom:1px solid var(--line,#22345a);overflow-x:auto;scrollbar-width:none;background:var(--panel,#111d36)}",
      sel(".tbset-tabs::-webkit-scrollbar") + "{display:none}",
      sel(".tbset-tab") + "{flex:none;padding:7px 13px;border-radius:999px;border:1px solid var(--line,#22345a);background:transparent;color:var(--muted,#93a5cf);font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;min-height:34px}",
      sel(".tbset-tab[aria-selected='true']") + "{background:var(--accent,#4f8cff);border-color:var(--accent,#4f8cff);color:#fff}",
      sel(".tbset-tab:focus-visible") + "{outline:2px solid var(--accent,#4f8cff);outline-offset:2px}",
      sel(".tbset-search") + "{flex:1;min-width:80px;margin:0;padding:7px 11px;font-size:13px;border-radius:9px;border:1px solid var(--line,#22345a);background:var(--panel2,#0c1628);color:var(--text,#e8eefc)}",
      sel(".tbset-empty") + "{display:none;grid-column:1/-1;padding:26px 4px;text-align:center;color:var(--muted,#93a5cf);font-size:13px}",
      sel(".is-empty .tbset-empty") + "{display:block}",

      /* Grouped mode: the rail sits under the sticky header, so it must be
         sticky too or it scrolls away from the cards it filters. */
      "#setup.tbset .tbset-tabs{position:sticky;top:var(--tbset-head-h,56px);z-index:2}",
      "#setup.tbset .set-group[hidden]{display:none}",

      /* ---- the messy part: the card grid --------------------------------
         .set-body was `auto-fit, minmax(268px, 1fr)` and every group was a
         bordered card, so a 3-button control and a 6-checkbox control became
         boxes of wildly different heights with ragged gaps between them —
         and `.theme-btn{flex:1}` in a WRAPPING row meant five size options
         broke 3-then-2 at stretched widths. Both go.

         Instead: one column of settings ROWS, label left, control right,
         separated by hairlines. A single column also means the panel no
         longer wants to be 860px wide. */
      "#setup.tbset .box{max-width:min(640px,96vw)}",
      "#setup.tbset .set-body{display:block;padding:2px 18px 8px}",
      "#setup.tbset .set-group{background:transparent;border:0;border-radius:0;padding:0;" +
        "border-bottom:1px solid var(--line,#22345a);min-width:0}",
      "#setup.tbset .set-group:last-child{border-bottom:0}",

      /* ---- rows and segments, shared by BOTH modes ----------------------
         Board and Sky had the same disease in a different vocabulary: a flat
         column of uppercase micro-labels, each with a full-width control
         underneath, and `.seg button{flex:1}` stretching every option. So
         these rules are written for both dialects at once —
           city boards : .section-lbl/.accent-lbl, .theme-row, .theme-btn
           board/sky   : .lbl,                     .seg,        .seg > button
         `.tbset-sec` is the section wrapper both modes now tag. */
      sel(".tbset-sec") + "{border-bottom:1px solid var(--line,#22345a);min-width:0}",
      sel(".tbset-sec:last-of-type") + "{border-bottom:0}",

      /* Compact sections (a label and one control) become a two-column row. */
      sel(".tbset-sec.tbset-row") + "{display:grid;grid-template-columns:minmax(96px,auto) minmax(0,1fr);" +
        "gap:10px 18px;align-items:center;padding:12px 0}",
      lbl(".tbset-row > ") + "{grid-column:1;grid-row:1;margin:0;font-size:13px;font-weight:700;" +
        "letter-spacing:0;text-transform:none;color:var(--text,#e8eefc)}",
      sel(".tbset-row > :not(.section-lbl):not(.accent-lbl):not(.lbl):not(.suggest-lbl)") +
        "{grid-column:2;margin:0;justify-self:end}",

      /* Sections carrying prose or a text field read better stacked. */
      sel(".tbset-sec.tbset-stack") + "{display:block;padding:14px 0}",
      lbl(".tbset-stack > ") + "{margin:0 0 9px;font-size:13px;font-weight:700;letter-spacing:0;" +
        "text-transform:none;color:var(--text,#e8eefc)}",
      sel(".tbset-stack p") + "{font-size:12.5px;line-height:1.55;color:var(--muted,#93a5cf);margin:0 0 10px}",
      sel(".tbset-stack input[type=text]") + "{margin-top:0}",
      /* Sky's input+button rows clipped the button off the panel edge. */
      sel(".tbset-stack .locrow") + "{display:flex;gap:8px;margin:0 0 8px;min-width:0}",
      sel(".tbset-stack .locrow input") + "," + sel(".tbset-stack .locrow select") +
        "{flex:1 1 auto;min-width:0}",
      sel(".tbset-stack .locrow button") + "{flex:0 0 auto;white-space:nowrap;padding:0 15px}",

      /* Segmented controls: actually segmented — joined, no wrap, no stretch.
         #cardToggles and the swatch rows share .theme-row/.seg but hold
         checkboxes and colour dots, so they are excluded and styled below. */
      seg("") + "{display:inline-flex;flex-wrap:nowrap;gap:0;margin:0;max-width:100%;overflow:hidden;" +
        "border:1px solid var(--line,#22345a);border-radius:10px;background:var(--panel2,#0c1628)}",
      /* flex-direction:row is not redundant: Sky sets `.seg button{display:flex;
         flex-direction:column}`, which stacked the icon above the label and made
         that one segment twice the height of its neighbours. */
      seg(" > button") + "," + seg(" .theme-btn") + "{flex:0 1 auto;min-width:0;margin:0;" +
        "display:inline-flex;flex-direction:row;align-items:center;justify-content:center;gap:6px;" +
        "padding:9px 13px;font-size:12.5px;font-weight:700;white-space:nowrap;background:transparent;" +
        "color:var(--text,#e8eefc);border:0;border-left:1px solid var(--line,#22345a);" +
        "border-radius:0;box-shadow:none}",
      seg(" > button:first-child") + "," + seg(" .theme-btn:first-child") + "{border-left:0}",
      seg(" > button.active") + "," + seg(" .theme-btn.active") + "{background:var(--accent,#4f8cff);" +
        "color:#fff;border-color:var(--accent,#4f8cff);box-shadow:none}",
      /* Only Sky's "Black" carries a decorative emoji — one lone glyph among
         plain-text siblings reads as an accident. The label already says it. */
      seg(" .ic") + "{display:none}",

      /* Checkbox chips and colour dots, right-aligned to match the controls. */
      "#setup.tbset #cardToggles{display:flex;flex-wrap:wrap;gap:7px;margin:0;justify-content:flex-end}",
      /* Checkbox chips. flex:0 0 auto undoes `.card-toggle{flex:1;min-width:120px}`
         and `.sys-toggle{flex:1;min-width:130px}`, which stretched the chips to
         equal width and pushed each label away from its own checkbox. */
      sel("#cardToggles") + "," + sel(".sys-grid") +
        "{display:flex;flex-wrap:wrap;gap:7px;margin:0;justify-content:flex-end}",
      sel("#cardToggles .card-toggle") + "," + sel(".sys-grid .sys-toggle") +
        "{display:inline-flex;align-items:center;gap:7px;margin:0;flex:0 0 auto;min-width:0;" +
        "padding:7px 12px;border:1px solid var(--line,#22345a);border-radius:999px;" +
        "background:var(--panel2,#0c1628);font-size:12.5px;white-space:nowrap;cursor:pointer;" +
        "min-height:36px;box-sizing:border-box}",
      /* 27 dots across the full row wrapped 13/13/1, leaving one orphan on its
         own line. Capped so they wrap into even rows instead. */
      sel("#accentSwatches") + "," + sel(".swatches") +
        "{display:flex;flex-wrap:wrap;margin:0;justify-content:flex-end;max-width:322px;gap:7px}",
      "#setup.tbset .set-group.wide{grid-column:auto}",

      /* ---- the gear itself ---------------------------------------------
         It was a plain bordered square identical to the two buttons beside
         it, so the one control that opens everything read as the least
         important. Accent fill, and the word next to the glyph. */
      "#settingsBtn{background:var(--accent,#4f8cff)!important;border-color:var(--accent,#4f8cff)!important;" +
        "color:#fff!important;font-weight:700;display:inline-flex;align-items:center;gap:7px;" +
        "padding:8px 14px!important;box-shadow:0 2px 10px rgba(0,0,0,.28)}",
      "#settingsBtn::after{content:'Settings';font-size:12.5px;letter-spacing:.01em}",
      "#settingsBtn:hover,#settingsBtn:focus-visible{filter:brightness(1.12);" +
        "border-color:var(--accent,#4f8cff)!important;color:#fff!important}",
      "@media (max-width:720px){#settingsBtn::after{display:none}}",

      /* Flat mode: build the card the panel never had. max-width must be set
         explicitly — the boards cap .panel at 460/480px, which is too narrow
         for a label-and-control row. */
      "#settings.tbset .tbset-box{display:flex;flex-direction:column;padding:0;gap:0;" +
        "max-height:min(88vh,780px);overflow:hidden;width:min(620px,94vw);max-width:none}",
      "#settings.tbset .tbset-head{flex:none;display:flex;align-items:center;gap:10px;padding:14px 16px 12px;border-bottom:1px solid var(--line,#22345a);background:var(--panel,#111d36)}",
      "#settings.tbset .tbset-title{margin:0;font-size:17px;font-weight:800;flex:none}",
      "#settings.tbset .tbset-x{flex:none;width:34px;height:34px;padding:0;border-radius:9px;border:1px solid var(--line,#22345a);background:transparent;color:var(--text,#e8eefc);font-size:19px;line-height:1;cursor:pointer}",
      "#settings.tbset .tbset-x:hover,#settings.tbset .tbset-x:focus-visible{background:var(--panel2,#0c1628);border-color:var(--accent,#4f8cff)}",
      "#settings.tbset .tbset-body{flex:1 1 auto;overflow:auto;padding:4px 16px 16px;-webkit-overflow-scrolling:touch}",
      "#settings.tbset .tbset-grp[hidden]{display:none}",
      "#settings.tbset .tbset-grp > :first-child{margin-top:12px}",
      "#settings.tbset .tbset-foot{flex:none;display:flex;gap:10px;padding:12px 16px;border-top:1px solid var(--line,#22345a);background:var(--panel,#111d36)}",
      "#settings.tbset .tbset-foot .btns{display:flex;gap:10px;margin:0;flex:1}",
      "#settings.tbset .tbset-foot > button{flex:1}",

      /* Remote- and thumb-sized targets; some segmented buttons were 26px. */
      sel(".theme-btn") + "," + sel(".seg button") + "{min-height:38px}",
      "@media (max-width:520px){#settings.tbset .tbset-head{flex-wrap:wrap}" +
        "#settings.tbset .tbset-search{order:3;flex:1 0 100%}}",

      /* LAST, and !important on purpose. `.set-group[hidden]` and
         `.set-group.tbset-stack` have identical specificity (1,3,0), so
         whichever is written later wins — and a tab that cannot hide the
         groups it filters is not a tab. Do not move this up the list. */
      sel("[hidden]") + "{display:none!important}"
    ].join("\n");
  }

  function styleOnce() {
    if (document.getElementById("tbset-css")) return;
    var s = document.createElement("style");
    s.id = "tbset-css";
    s.textContent = css();
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------- shared controls */
  function makeSearch() {
    var s = document.createElement("input");
    s.className = "tbset-search";
    s.type = "search";
    s.placeholder = "Search settings…";
    s.setAttribute("aria-label", "Search settings");
    s.autocomplete = "off";
    return s;
  }

  /* Builds the rail and wires tab + search behaviour over a list of
     {el, tab, q} records. `render` is called with the id to show, or null
     while a search is active. */
  function wire(rail, search, items, box, onShow, sync) {
    var used = ORDER.filter(function (id) {
      return items.some(function (it) { return it.tab === id; });
    });
    if (used.length < 2) return null;            // one bucket is a title, not a rail

    var active = used[0];
    function paint(id) {
      active = id;
      /* Boards append groups to an already-open panel (tour-guide.js adds its
         "Guided tour" card this way). Without this they would belong to no tab
         and so stay visible on all of them. */
      if (sync) sync(used);
      items.forEach(function (it) { it.el.hidden = it.tab !== id || isBlank(it.el); });
      [].forEach.call(rail.children, function (b) {
        b.setAttribute("aria-selected", String(b.dataset.tab === id));
      });
      box.classList.remove("is-empty");
      if (onShow) onShow();
    }
    used.forEach(function (id) {
      var b = document.createElement("button");
      b.className = "tbset-tab";
      b.type = "button";
      b.dataset.tab = id;
      b.textContent = tabById(id).name;
      b.setAttribute("role", "tab");
      b.onclick = function () { search.value = ""; paint(id); };
      rail.appendChild(b);
    });

    /* Search spans every tab, so you never have to guess which one holds it. */
    search.oninput = function () {
      var q = search.value.trim().toLowerCase();
      if (!q) { paint(active); return; }
      var hits = 0;
      items.forEach(function (it) {
        var hit = it.q.indexOf(q) >= 0;
        it.el.hidden = !hit;
        if (hit) hits++;
      });
      [].forEach.call(rail.children, function (b) { b.setAttribute("aria-selected", "false"); });
      box.classList.toggle("is-empty", hits === 0);
    };

    paint(active);
    return function reset() { search.value = ""; paint(active); };
  }

  function closer(panel) {
    return function () {
      /* Prefer the panel's own dismiss button: on the city boards it also
         records the "skipped the key prompt" answer. Fall back to the class
         every board toggles. */
      var own = panel.querySelector(".set-x") ||
                panel.querySelector("#skipKey, #setDone, .btns .ghost");
      if (own && own !== document.activeElement) { own.click(); return; }
      panel.classList.remove("show");
    };
  }

  /* Tag one section and work out which tab it belongs on. Used by both modes so
     Board and Sky get exactly the layout the city boards got. */
  function shape(el) {
    /* A section with prose, a text field or a disclosure needs the full width;
       a bare label-plus-control is a row. This split is what stops a panel
       looking cheap — it is the difference between "Theme [Dark|Black|Day]" on
       one line and a shouty uppercase heading over three stretched buttons. */
    var stack = !!el.querySelector("p, input[type=text], input[type=url], textarea, details, select, .addr-row, .locrow");
    el.classList.add("tbset-sec", stack ? "tbset-stack" : "tbset-row");

    var lab = el.querySelector(HEAD);
    var tab = bucket(lab ? lab.textContent.trim() : "");
    /* Sniff the content too, not just the heading. Sky's "Flight delay status"
       and "Room lights" are Worker URLs whose labels say nothing about keys or
       feeds, and they were landing in Display. A field asking for an https://
       endpoint belongs with the other endpoints whatever it is called. */
    if (tab === FALLBACK) {
      var f = el.querySelector("input[type=text], input[type=url]");
      if (f && /https?:\/\//i.test((f.placeholder || "") + " " + (f.value || ""))) tab = "keys";
    }
    return { el: el, tab: tab, q: (el.textContent || "").toLowerCase() };
  }

  function onEscape(panel, close) {
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !panel.classList.contains("show")) return;
      e.stopPropagation();       // the boards bind Escape to follow-mode / full-map
      close();
    }, true);
  }

  /* ------------------------------------------------- mode 1: already grouped */
  function enhanceGrouped(panel) {
    var head = panel.querySelector(".set-head");
    var body = panel.querySelector(".set-body");
    if (!head || !body || panel.dataset.tbset) return false;

    var groups = [].slice.call(body.querySelectorAll(".set-group"));
    if (groups.length < 4) return false;

    panel.dataset.tbset = "grouped";
    panel.classList.add("tbset");

    function classify(g, used) {
      var it = shape(g);
      /* A latecomer whose bucket has no tab would be unreachable; park it on
         the first tab rather than hide it forever. */
      if (used && used.indexOf(it.tab) < 0) it.tab = used[0];
      return it;
    }

    var items = groups.map(function (g) { return classify(g); });
    var sync = function (used) {
      [].forEach.call(body.querySelectorAll(".set-group"), function (g) {
        if (g.classList.contains("tbset-row") || g.classList.contains("tbset-stack")) return;
        items.push(classify(g, used));
      });
    };

    var rail = document.createElement("div");
    rail.className = "tbset-tabs";
    rail.setAttribute("role", "tablist");

    var search = makeSearch();
    var x = head.querySelector(".set-x");
    if (x) head.insertBefore(search, x); else head.appendChild(search);

    var empty = document.createElement("div");
    empty.className = "tbset-empty";
    empty.textContent = "Nothing matches that.";
    body.appendChild(empty);

    var reset = wire(rail, search, items, body, function () { body.scrollTop = 0; }, sync);
    if (!reset) {                                  // single bucket — undo cleanly
      search.remove(); empty.remove();
      delete panel.dataset.tbset;
      panel.classList.remove("tbset");
      return false;
    }
    head.insertAdjacentElement("afterend", rail);

    /* The rail sticks below the header, so it needs the header's real height. */
    var setH = function () {
      panel.style.setProperty("--tbset-head-h", head.offsetHeight + "px");
    };
    setH();
    if (window.ResizeObserver) new ResizeObserver(setH).observe(head);

    onEscape(panel, closer(panel));
    return reset;
  }

  /* ------------------------------------------------------ mode 2: flat panel */
  function enhanceFlat(panel) {
    if (panel.dataset.tbset) return false;
    var box = panel.querySelector(".box") || panel.querySelector(".panel");
    if (!box) return false;
    var heads = box.querySelectorAll(HEAD);
    if (heads.length < 3) return false;

    panel.dataset.tbset = "flat";
    panel.classList.add("tbset");
    box.classList.add("tbset-box");

    var h3 = box.querySelector("h3,h2");
    var title = h3 ? h3.textContent.trim() : "Settings";
    if (h3) h3.remove();
    var actions = box.querySelector(".btns") || box.querySelector("button.done,.done");

    /* Slice the flat run into heading-led sections; anything before the first
       heading is preamble and rides with the first section. */
    var groups = [], cur = null, pre = [];
    [].slice.call(box.childNodes).forEach(function (n) {
      if (n === actions) return;
      if (n.nodeType === 1 && n.matches && n.matches(HEAD)) {
        cur = { label: n.textContent.trim(), nodes: [] };
        groups.push(cur);
      }
      (cur ? cur.nodes : pre).push(n);
    });
    if (!groups.length) return false;
    if (pre.length) groups[0].nodes = pre.concat(groups[0].nodes);

    var headEl = document.createElement("div");
    headEl.className = "tbset-head";
    var h = document.createElement("h3");
    h.className = "tbset-title";
    h.textContent = title;
    var search = makeSearch();
    var x = document.createElement("button");
    x.className = "tbset-x";
    x.type = "button";
    x.innerHTML = "&times;";
    x.setAttribute("aria-label", "Close settings");
    headEl.appendChild(h); headEl.appendChild(search); headEl.appendChild(x);

    var rail = document.createElement("div");
    rail.className = "tbset-tabs";
    rail.setAttribute("role", "tablist");
    var bodyEl = document.createElement("div");
    bodyEl.className = "tbset-body";

    /* Sections go straight into the body — no per-tab wrapper. Tracking each
       SECTION (as grouped mode does) is what lets search match one setting
       rather than a whole tabful. */
    var items = groups.map(function (g) {
      var sec = document.createElement("div");
      g.nodes.forEach(function (n) { sec.appendChild(n); });        // MOVE
      bodyEl.appendChild(sec);
      return shape(sec);
    });

    var empty = document.createElement("div");
    empty.className = "tbset-empty";
    empty.textContent = "Nothing matches that.";
    bodyEl.appendChild(empty);

    var foot = document.createElement("div");
    foot.className = "tbset-foot";
    if (actions) foot.appendChild(actions);

    box.textContent = "";
    box.appendChild(headEl);
    var reset = wire(rail, search, items, bodyEl, function () { bodyEl.scrollTop = 0; });
    if (reset) box.appendChild(rail);
    box.appendChild(bodyEl);
    if (actions) box.appendChild(foot);

    var close = closer(panel);
    x.onclick = close;
    panel.addEventListener("click", function (e) { if (e.target === panel) close(); });
    onEscape(panel, close);
    return reset || function () {};
  }

  /* ---------------------------------------------------------------- driver */
  function attach(panel) {
    if (!panel) return;
    /* The city boards build .set-body lazily, on first open, so we cannot do
       this once at load. Re-check on every open until one of the modes takes,
       then just reset the view so each open starts on the first tab. */
    var reset = null;
    var check = function () {
      if (!panel.classList.contains("show")) return;
      if (reset) { reset(); return; }
      try {
        reset = panel.querySelector(".set-body") ? enhanceGrouped(panel) : enhanceFlat(panel);
      } catch (e) {
        console.warn("settings-ui: left #" + panel.id + " as-is —", e);
        reset = function () {};
      }
    };
    new MutationObserver(check).observe(panel, { attributes: true, attributeFilter: ["class"] });
    check();
  }

  function run() {
    styleOnce();
    PANELS.forEach(function (id) { attach(document.getElementById(id)); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
