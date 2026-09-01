/* commute.js — "leave now": the board's first answer to a question about YOU.
   ---------------------------------------------------------------------------
   Everything else on these boards is a departure list. A departure list is a
   fact about the network; it still leaves you doing the arithmetic that
   actually matters — subtracting the walk to the station from the countdown,
   in your head, every time you glance up. Get it wrong by two minutes and you
   watch the train go.

   So: save the trip you make most days and the walk to its stop once, and the
   card does that subtraction continuously. The headline number is not when the
   train comes, it is when YOU have to move.

   Deliberately not a trip planner. It never asks for a destination it would
   have to route to, because a router needs a graph, a graph needs a server,
   and the whole project's premise is a page that costs nothing to run forever
   (see README). It filters the departures the board already has.

   The board supplies `state._depBy` — {mode: [{mode,stop,route,dest,min,color,
   live}]} — and calls TBCommute.onData() after each refresh. A board adopts
   this feature by populating that object; nothing here is DC-specific. */
(function (root) {
  "use strict";

  var LS = {
    trip: "tb.commute.trip",     // {stop, route, dest, walk, mode}
    hide: "tb.commute.hidden",   // fallback only; the board's own list wins
  };
  var HIDE_ID = "commuteCard";

  function read(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; }
    catch (_) { return d; }
  }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---- registering so it can be switched off ------------------------------
     Same contract every injected card on these boards follows: push into the
     board's own CARD_DEFS at script level (before its DOMContentLoaded builds
     the checkbox list) so "Show on board" and applyCardVis() pick this up with
     no change to any board. See interesting.js for the long version. */
  function registerCardToggle() {
    try {
      /* eslint-disable-next-line no-undef */
      if (typeof CARD_DEFS !== "undefined" && Array.isArray(CARD_DEFS) &&
          !CARD_DEFS.some(function (d) { return d && d.id === HIDE_ID; })) {
        /* eslint-disable-next-line no-undef */
        CARD_DEFS.push({ id: HIDE_ID, label: "Your commute" });
        return true;
      }
    } catch (_) {}
    return false;
  }
  var REGISTERED = registerCardToggle();

  function boardHiddenKey() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^transitboard[a-z]*\.hiddenCards$/.test(k)) return k;
      }
      for (var j = 0; j < localStorage.length; j++) {
        var m = /^(transitboard[a-z]*)\./.exec(localStorage.key(j));
        if (m) return m[1] + ".hiddenCards";
      }
    } catch (_) {}
    return "";
  }
  function hiddenNow() {
    try {
      /* eslint-disable-next-line no-undef */
      if (REGISTERED && typeof loadHiddenCards === "function") return loadHiddenCards().has(HIDE_ID);
    } catch (_) {}
    return read(LS.hide, false) === true;
  }
  function setHidden(on) {
    var done = false;
    try {
      /* eslint-disable-next-line no-undef */
      if (REGISTERED && typeof loadHiddenCards === "function") {
        /* eslint-disable-next-line no-undef */
        var h = loadHiddenCards();
        if (on) h.add(HIDE_ID); else h.delete(HIDE_ID);
        var key = boardHiddenKey();
        /* Array.from, not slice.call — loadHiddenCards() hands back a Set,
           which is iterable but not array-like, and slice.call() on one
           silently yields []. */
        if (key) { localStorage.setItem(key, JSON.stringify(Array.from(h))); done = true; }
        /* eslint-disable-next-line no-undef */
        if (typeof applyCardVis === "function") applyCardVis();
        /* eslint-disable-next-line no-undef */
        if (typeof buildCardToggles === "function") buildCardToggles();
      }
    } catch (_) {}
    if (!done) {
      write(LS.hide, on);
      var el = document.getElementById(HIDE_ID);
      if (el) el.classList.toggle("user-hidden", on);
    }
  }

  /* ---- the saved trip ----------------------------------------------------- */
  function trip() {
    var t = read(LS.trip, null);
    if (!t || !t.stop) return null;
    // walk is the only field a bad edit can make dangerous: a NaN would make
    // every departure look catchable.
    var w = parseInt(t.walk, 10);
    t.walk = isFinite(w) && w >= 0 ? Math.min(w, 90) : 5;
    return t;
  }
  function saveTrip(t) { write(LS.trip, t); onData(); }
  function clearTrip() { try { localStorage.removeItem(LS.trip); } catch (_) {} onData(); }

  /* The boards declare `let state = {...}` at the top level of a classic
     script. A top-level `let` is a LEXICAL global: it is reachable as a bare
     identifier but never becomes a property of window, so `root.state` here is
     undefined and the card would sit empty forever with nothing in the console
     to say why. Read it the way the boards' own code does. */
  function boardState() {
    try { /* eslint-disable-next-line no-undef */
      return (typeof state !== "undefined" && state) ? state : (root.state || null);
    } catch (_) { return root.state || null; }
  }
  function pool() {
    var st = boardState();
    var by = (st && st._depBy) || {};
    var out = [];
    for (var k in by) if (Array.isArray(by[k])) out = out.concat(by[k]);
    return out;
  }

  /* Match on what the person actually picked. Stop always; route and direction
     only when they chose one, so "any train from Bethesda" is a legitimate
     saved trip and not an error. Direction is compared loosely — WMATA writes
     the same destination as "Glenmont" in one feed and "Glenmont, MD" in
     another, and an exact match would silently show nothing. */
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function matches(d, t) {
    if (norm(d.stop) !== norm(t.stop)) return false;
    if (t.route && norm(d.route) !== norm(t.route)) return false;
    if (t.dest) {
      var a = norm(d.dest), b = norm(t.dest);
      if (a.indexOf(b) < 0 && b.indexOf(a) < 0) return false;
    }
    return true;
  }

  /* ---- the card ----------------------------------------------------------- */
  function ensureCard() {
    var card = document.getElementById(HIDE_ID);
    if (card) return card;
    var cards = document.querySelector(".cards");
    if (!cards) return null;
    card = document.createElement("div");
    card.className = "card";
    card.id = HIDE_ID;
    card.style.setProperty("--sys", "#39d98a");
    card.style.setProperty("--sys2", "#8ef0c0");
    card.innerHTML =
      '<h2><span class="t">Your commute</span> <span class="count" id="cmCount"></span>' +
      '<button type="button" id="cmHideBtn" title="Hide this box — bring it back in Settings, Show on board">×</button>' +
      "</h2>" +
      '<div class="statline" id="cmStat"></div>' +
      '<div class="list" id="cmList"></div>';
    // First in the grid when it is set up: if one card on this board is worth
    // reading before the others, it is the one counting down at you.
    cards.insertBefore(card, cards.firstChild);
    if (hiddenNow()) card.classList.add("user-hidden");
    var x = card.querySelector("#cmHideBtn");
    if (x) x.onclick = function () { setHidden(true); card.classList.add("user-hidden"); };
    injectCss();
    /* Same reflow problem the alert card documents: inserting a card re-flows
       the grid, so the first paint measures a list box that has not been given
       its height yet. Repaint after the size settles. */
    if ("ResizeObserver" in root) {
      var tmr = null;
      new ResizeObserver(function () { clearTimeout(tmr); tmr = setTimeout(paint, 140); }).observe(card);
    }
    /* eslint-disable-next-line no-undef */
    if (typeof initMiniCards === "function") setTimeout(initMiniCards, 0);
    return card;
  }

  function injectCss() {
    if (document.getElementById("cmCss")) return;
    var st = document.createElement("style");
    st.id = "cmCss";
    st.textContent =
      "#commuteCard .cm-go{display:flex;align-items:baseline;gap:8px;padding:2px 2px 4px}" +
      "#commuteCard .cm-num{font-family:var(--mono,monospace);font-weight:800;font-size:30px;line-height:1;" +
        "letter-spacing:-.02em;font-variant-numeric:tabular-nums}" +
      "#commuteCard .cm-cap{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;" +
        "color:var(--muted,#93a5cf);font-family:var(--mono,monospace)}" +
      /* Three states, three colours, and they must survive both themes: green
         you have time, amber this is the one you have to move for, red it is
         gone. Falls back to literals where the board defines no token. */
      "#commuteCard .cm-ok{color:var(--live-ink,#39d98a)}" +
      "#commuteCard .cm-soon{color:var(--warn-ink,#ffb454)}" +
      "#commuteCard .cm-gone{color:var(--late-ink,#ff6b81)}" +
      /* Sized to survive the smallest box the board hands out (~21px): 11px
         type and tight padding keep the whole control under 20px tall. */
      "#commuteCard .cm-set{font:inherit;font-size:11px;line-height:1;cursor:pointer;border-radius:6px;" +
        "padding:2px 8px;white-space:nowrap;align-self:flex-start;" +
        "border:1px solid var(--line,#25304d);background:var(--chip,#141b30);color:var(--ink,#e8eeff)}" +
      "#commuteCard .cm-set:hover{border-color:var(--accent,#4ea1ff)}" +
      "#commuteCard h2 #cmHideBtn{margin-left:auto;background:none;border:0;cursor:pointer;font-size:15px;" +
        "line-height:1;color:var(--muted,#93a5cf);padding:0 2px}" +
      "#commuteCard h2 #cmHideBtn:hover{color:var(--late-ink,#ff6b81)}";
    document.head.appendChild(st);
  }

  /* The whole point of the card: minutes until you have to be walking out the
     door, not minutes until the train. Negative means it has already left
     without you — shown, not hidden, because "you have missed this one" is
     information and silently skipping to the next departure is how you end up
     trusting a number that was never for you. */
  function leaveIn(dep, t) { return dep.min - t.walk; }

  /* Ask the board's layout for the height this card needs.
     ---------------------------------------------------------------------
     balanceCards() shares one screen between the cards in proportion to each
     list's `data-want`, which fitList() sets from what is CURRENTLY rendered.
     For a card that renders to fit, that is circular: it trims itself to the
     box it was given, reports the trimmed height as its need, and is handed
     the same small box again — the empty state settled at 21px, too short for
     its own setup button, and there was no way out of it from inside the card.

     So report what the content actually wants (scrollHeight ignores the box)
     with a floor of a headline plus two rows, and ask for one re-balance.
     The value is stable across repaints, and balanceCards() only writes
     gridTemplateRows when it changes, so this settles instead of oscillating. */
  function claim(list) {
    try {
      var want = Math.max(list.scrollHeight || 0, 58);
      if (list.dataset.want !== String(want)) {
        list.dataset.want = String(want);
        /* eslint-disable-next-line no-undef */
        if (typeof balanceCards === "function") balanceCards();
      }
    } catch (_) {}
  }

  function paint() {
    var card = ensureCard(); if (!card) return;
    var list = document.getElementById("cmList");
    var stat = document.getElementById("cmStat");
    var count = document.getElementById("cmCount");
    if (!list) return;
    var t = trip();

    /* A board with no departures at all cannot host a commute. The stencil is
       the standing example — it ships with only Amtrak and planes until
       somebody adds a local system — and there the card would be a permanent
       dead end whose one button opens a picker with nothing in it.

       Only when there is also no saved trip: once a trip exists the card must
       stay put and say the trip has no departures right now, because vanishing
       is indistinguishable from having been switched off. The pool is empty for
       the first seconds of any load, so this shows the card a moment late
       rather than never — the same as every other injected card here. */
    if (!t && !pool().length) { card.style.display = "none"; return; }
    card.style.display = "";

    if (!t) {
      count.textContent = "";
      /* The pitch goes in the STATLINE, which sits outside the scrolling list
         and is therefore always visible; the list holds nothing but the
         button. An empty card is given one of the smallest shares of the
         screen — 21px on a 12-card board — and two earlier drafts (prose then
         button, then button then prose) both left the button below the fold,
         which made the empty state a dead end on the layout most people meet
         first. Nothing here is taller than one line, so there is no fold. */
      stat.textContent = "counts down to when you leave — walk time included";
      list.innerHTML = '<button type="button" class="cm-set" id="cmSetupBtn">Set up your commute</button>';
      var b = document.getElementById("cmSetupBtn");
      if (b) b.onclick = openSetup;
      claim(list);
      return;
    }

    var mine = pool().filter(function (d) { return matches(d, t); })
                     .sort(function (a, b) { return a.min - b.min; });
    count.textContent = t.walk + " min walk";
    stat.textContent = [t.stop, t.route || "any line", t.dest ? "→ " + t.dest : ""].filter(Boolean).join(" · ");

    if (!mine.length) {
      list.innerHTML = '<div class="empty" style="text-align:left">No departures matching this trip right now.<br><br>' +
        '<button type="button" class="cm-set" id="cmSetupBtn">Change trip</button></div>';
      var b2 = document.getElementById("cmSetupBtn");
      if (b2) b2.onclick = openSetup;
      claim(list);
      return;
    }

    // The one you can still make: first departure whose leave-time has not
    // passed. If every one has, the soonest becomes the headline anyway so the
    // card reads "gone" rather than going blank.
    var catchable = mine.filter(function (d) { return leaveIn(d, t) >= 0; });
    var head = catchable.length ? catchable[0] : mine[0];
    var lead = leaveIn(head, t);
    var cls = lead < 0 ? "cm-gone" : lead <= 2 ? "cm-soon" : "cm-ok";
    var big = lead < 0 ? "gone" : lead === 0 ? "NOW" : String(lead);
    var cap = lead < 0 ? "you have missed this one" : lead === 0 ? "leave now" : (lead === 1 ? "min to leave" : "mins to leave");

    /* The board hands every card a share of ONE screen (balanceCards), and in
       the tightest layouts that share is about one row tall. A headline sized
       by eye on a big monitor gets sliced in half there — which is how the
       first cut of this card shipped a countdown reading "NO". So size it to
       the box it was actually given, then fill whatever is left with rows,
       the same measure-then-fit dance paintAlerts() does. */
    var boxH = list.clientHeight || 0;
    var numPx = boxH ? Math.max(15, Math.min(32, Math.round(boxH * 0.46))) : 26;

    var html = '<div class="cm-go"><span class="cm-num ' + cls + '" style="font-size:' + numPx + 'px">' + big + "</span>" +
      '<span class="cm-cap">' + cap + "</span></div>";
    // The headline plus the next few, so a missed one is never the whole story.
    html += mine.slice(0, 5).map(function (d, i) {
      var li = leaveIn(d, t);
      var badge = esc(d.route || d.mode || "");
      var when = d.min <= 0 ? "now" : "in " + d.min + " min";
      var sub = li < 0 ? "too late · needs " + t.walk + " min" : "leave in " + li + " min";
      return '<div class="row' + (d === head ? " top" : "") + '">' +
        '<div class="badge" style="background:' + esc(d.color || "#556") + ';color:#fff">' + badge + "</div>" +
        // Some feeds carry no headsign at all (LA Metro Rail is one), and the
        // boards themselves fall back to the line name rather than print a dash.
        '<div><div class="dest">' + esc(d.dest || d.route || "—") + "</div>" +
        '<div class="sub">' + esc(sub) + "</div></div><div></div>" +
        '<div class="times"><div class="live ' + (d.min <= 2 ? "eta due" : "eta soon") + '">' + esc(when) + "</div>" +
        '<div class="sched">' + (d.live ? "live" : "sched") + "</div></div></div>";
    }).join("");
    list.innerHTML = html;

    /* What to ask balanceCards() for, measured BEFORE trimming — afterwards the
       content is by definition the size of the box, and the card would only
       ever ask for what it already has.

       Deliberately NOT scrollHeight: the headline is sized from the box it was
       given, so a want derived from it would feed back into the allocation
       that set it — grow the box, grow the headline, grow the want — and the
       layout would pump instead of settle. A fixed headline allowance plus the
       measured rows (which do not depend on the box) is stable by
       construction. Capped at four rows so a busy stop cannot starve the
       trains card the way the lift card's 51 outages once did. */
    var rowsH = 0;
    [].slice.call(list.children, 1).forEach(function (r) { rowsH += r.getBoundingClientRect().height; });
    var desired = Math.min(36 + rowsH, 190);

    /* Drop rows that would overflow. The headline is never dropped — it is the
       card — so only the supporting departures give way, and on the very
       tightest fit the card is exactly its countdown and nothing else. */
    if (boxH > 0) {
      var head = list.firstElementChild;
      var used = head ? head.getBoundingClientRect().height : 0;
      var gap = parseFloat(getComputedStyle(list).rowGap) || 0;
      var kids = [].slice.call(list.children, 1);
      for (var i = 0; i < kids.length; i++) {
        var h = kids[i].getBoundingClientRect().height;
        if (used + gap + h > boxH + 1) { for (var j = i; j < kids.length; j++) kids[j].remove(); break; }
        used += gap + h;
      }
    }
    try {
      var want = Math.max(desired, 58);
      if (list.dataset.want !== String(want)) {
        list.dataset.want = String(want);
        /* eslint-disable-next-line no-undef */
        if (typeof balanceCards === "function") balanceCards();
      }
    } catch (_) {}
  }

  /* ---- setup ---------------------------------------------------------------
     Built from the stops the board is already watching rather than a free-text
     box: a typo in a stop name would produce a card that is permanently, and
     inexplicably, empty. */
  function knownStops() {
    var seen = {}, out = [];
    pool().forEach(function (d) {
      if (!d.stop || seen[d.stop]) return;
      seen[d.stop] = 1;
      out.push(d.stop);
    });
    return out.sort();
  }
  function optionsFor(stop) {
    var routes = {}, dests = {};
    pool().forEach(function (d) {
      if (norm(d.stop) !== norm(stop)) return;
      if (d.route) routes[d.route] = 1;
      if (d.dest) dests[d.dest] = 1;
    });
    return { routes: Object.keys(routes).sort(), dests: Object.keys(dests).sort() };
  }

  function openSetup() {
    var t = trip() || { stop: "", route: "", dest: "", walk: 5 };
    var stops = knownStops();
    if (!stops.length) {
      alert("The board has not loaded any departures yet — give it a few seconds and try again.");
      return;
    }
    var back = document.createElement("div");
    back.id = "cmSetup";
    back.innerHTML =
      '<div class="cm-box"><h3>Your commute</h3>' +
      '<p>Pick the stop you leave from and how long it takes you to walk there. ' +
      'The card then counts down to when <b>you</b> have to move, not when the vehicle arrives.</p>' +
      '<label>Stop or station</label><select id="cmStop"></select>' +
      '<label>Line or route <span class="cm-opt">optional</span></label><select id="cmRoute"></select>' +
      '<label>Direction <span class="cm-opt">optional</span></label><select id="cmDest"></select>' +
      '<label>Walk to the stop</label>' +
      '<div class="cm-walk"><input id="cmWalk" type="number" min="0" max="90" step="1" value="' + t.walk + '"> <span>minutes</span></div>' +
      '<div class="cm-btns"><button type="button" id="cmSave" class="cm-primary">Save</button>' +
      '<button type="button" id="cmCancel">Cancel</button>' +
      '<span class="cm-grow"></span>' +
      '<button type="button" id="cmClear" class="cm-danger">Clear trip</button></div></div>';
    document.body.appendChild(back);
    setupCss();

    var selStop = back.querySelector("#cmStop");
    var selRoute = back.querySelector("#cmRoute");
    var selDest = back.querySelector("#cmDest");
    stops.forEach(function (s) {
      var o = document.createElement("option"); o.value = s; o.textContent = s;
      if (norm(s) === norm(t.stop)) o.selected = true;
      selStop.appendChild(o);
    });
    function fillDependent() {
      var o = optionsFor(selStop.value);
      [[selRoute, o.routes, t.route, "Any line or route"], [selDest, o.dests, t.dest, "Either direction"]]
        .forEach(function (p) {
          var sel = p[0], vals = p[1], cur = p[2], anyLbl = p[3];
          sel.innerHTML = "";
          var a = document.createElement("option"); a.value = ""; a.textContent = anyLbl;
          sel.appendChild(a);
          vals.forEach(function (v) {
            var oo = document.createElement("option"); oo.value = v; oo.textContent = v;
            if (norm(v) === norm(cur)) oo.selected = true;
            sel.appendChild(oo);
          });
        });
    }
    fillDependent();
    // Changing the stop invalidates the line and direction lists — a Red Line
    // filter saved against a bus stop matches nothing, forever.
    selStop.onchange = function () { t.route = ""; t.dest = ""; fillDependent(); };

    function close() { back.remove(); }
    back.querySelector("#cmCancel").onclick = close;
    back.onclick = function (e) { if (e.target === back) close(); };
    back.querySelector("#cmSave").onclick = function () {
      var w = parseInt(back.querySelector("#cmWalk").value, 10);
      saveTrip({
        stop: selStop.value, route: selRoute.value, dest: selDest.value,
        walk: isFinite(w) && w >= 0 ? Math.min(w, 90) : 5,
      });
      close();
    };
    back.querySelector("#cmClear").onclick = function () { clearTrip(); close(); };
  }

  function setupCss() {
    if (document.getElementById("cmSetupCss")) return;
    var st = document.createElement("style");
    st.id = "cmSetupCss";
    st.textContent =
      "#cmSetup{position:fixed;inset:0;z-index:9000;background:rgba(4,7,16,.72);display:flex;align-items:center;" +
        "justify-content:center;padding:18px;backdrop-filter:blur(2px)}" +
      "#cmSetup .cm-box{background:var(--card,#0e1526);color:var(--ink,#e8eeff);border:1px solid var(--line,#25304d);" +
        "border-radius:14px;padding:18px;width:min(420px,100%);max-height:90vh;overflow:auto;" +
        "box-shadow:0 18px 50px rgba(0,0,0,.55);font-size:13px}" +
      "#cmSetup h3{margin:0 0 6px;font-size:16px}" +
      "#cmSetup p{margin:0 0 14px;font-size:12px;color:var(--muted,#93a5cf);line-height:1.5}" +
      "#cmSetup label{display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;" +
        "color:var(--muted,#93a5cf);margin:12px 0 4px;font-family:var(--mono,monospace)}" +
      "#cmSetup .cm-opt{font-weight:400;opacity:.7;text-transform:none;letter-spacing:0}" +
      "#cmSetup select,#cmSetup input{width:100%;box-sizing:border-box;background:var(--chip,#141b30);" +
        "color:var(--ink,#e8eeff);border:1px solid var(--line,#25304d);border-radius:8px;padding:8px 9px;font:inherit}" +
      "#cmSetup .cm-walk{display:flex;align-items:center;gap:8px}" +
      "#cmSetup .cm-walk input{width:90px}" +
      "#cmSetup .cm-walk span{color:var(--muted,#93a5cf);font-size:12px}" +
      "#cmSetup .cm-btns{display:flex;align-items:center;gap:8px;margin-top:18px}" +
      "#cmSetup .cm-grow{flex:1}" +
      "#cmSetup button{font:inherit;font-size:12px;cursor:pointer;border-radius:8px;padding:7px 13px;" +
        "border:1px solid var(--line,#25304d);background:var(--chip,#141b30);color:var(--ink,#e8eeff)}" +
      "#cmSetup .cm-primary{background:var(--accent,#4ea1ff);border-color:var(--accent,#4ea1ff);color:#04101f;font-weight:700}" +
      "#cmSetup .cm-danger{color:var(--late-ink,#ff6b81);border-color:transparent;background:none}";
    document.head.appendChild(st);
  }

  /* ---- ticking -------------------------------------------------------------
     Repaint every 30s as well as on new data. The board's own refresh is 30s,
     but the countdown is in whole minutes and the number people watch is the
     leave-time — letting it sit visibly stale between fetches is exactly the
     failure this card exists to prevent. */
  function onData() { try { paint(); } catch (_) {} }

  function boot() {
    try {
      ensureCard();
      paint();
      setInterval(onData, 30000);
    } catch (_) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  root.TBCommute = { onData: onData, openSetup: openSetup, trip: trip, clear: clearTrip };
})(typeof window !== "undefined" ? window : this);
