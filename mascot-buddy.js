/* ============================================================================
   mascot-buddy.js — the mascot, in the corner, with something to say.

   WHAT IT IS
     A small resident character bottom-left of any board. It says something
     occasionally, says something whenever you poke it, and swaps between the
     cast as it goes. Nothing else on these screens has a personality, and a
     departure board that is pleased to see you is a thing people show other
     people. That is the point of it.

   ONE SCRIPT TAG, NO OTHER WIRING — same drop-in shape as wake.js. It borrows
   the artwork from mascot.js (TBMascot) rather than drawing its own, so the
   character in the corner is the character in the tour.

   WHERE IT SITS, AND WHY THERE
     Bottom-LEFT. The right-hand column of every board is already a stack of
     chips: the schedule warning at bottom:12, the worker warning at bottom:52,
     and the licence and demo chips above those. The only thing bottom-left is
     the aircraft credit at bottom:5, so this sits above it.

   RESTRAINT IS A FEATURE
     These boards hang on walls and run for days. A character that talks every
     thirty seconds is a character somebody unplugs. So: it speaks once shortly
     after arriving, then only every few minutes; it never speaks while the tab
     is hidden; and it can be dismissed for good with one click on the bubble's
     ×, remembered in localStorage. The idle chatter is the garnish. The poke is
     the feature.

   ABOUT THE WORDS
     Original, all of it. The brief asked for funny transport song lyrics, and
     real ones are somebody else's copyright — on a product being sold, that is
     the owner's exposure, not a technicality. So the singing lines below are
     written for this, in the register the brand guide already sets out: plain,
     dry, specific. "The 21 is running 8 minutes late", not "we are experiencing
     service disruptions" — and the jokes come from being exactly that specific
     about something absurd.
   ============================================================================ */
(function () {
  "use strict";

  if (window.TBBuddy) return;                 // one to a page

  var LS_OFF = "tb.buddyOff";
  var FIRST_MS = 9000;                        // let the board settle before saying hello

  /* Sky view is an ambient screen — one aircraft, full bleed, the room lights
     matched to it. A character piping up every four minutes there is not
     company, it is an interruption of the only page whose job is to be calm.
     So it talks half as often, and says hello later. A city board is glanceable
     and busy already; this costs it nothing to be livelier. */
  function ambient() {
    return /(^|\/)night\.html$/.test(location.pathname);
  }
  var IDLE_MS = ambient() ? 540000 : 240000;  // 9 minutes on Sky view, 4 elsewhere

  function off() { try { return localStorage.getItem(LS_OFF) === "1"; } catch (_) { return false; } }
  function setOff(v) { try { localStorage.setItem(LS_OFF, v ? "1" : "0"); } catch (_) {} }

  /* ---- the words ---------------------------------------------------------
     Sung lines are marked ♪ and are deliberately short: the bubble is small,
     and a joke that needs three lines is not a joke on a departure board. */
  var SAY = {
    hello: [
      "You are here. The trains have not been told, but I know.",
      "Everything on this screen is real and none of it is on time.",
      "Board's up. Somewhere out there a bus is already lying to you.",
    ],
    song: [
      "♪ Two came at once, then none for an hour — that is not a timetable, that is a mood ♪",
      "♪ Oh the 5:15 is 5:40 today, and the 5:40 is anyone's guess ♪",
      "♪ I have a season ticket and a season of regret ♪",
      "♪ Last train home, last train home — I am on it, it is not moving ♪",
      "♪ Rail replacement bus, rail replacement bus, replacing rail with a long sad hug ♪",
      "♪ She said meet me at the station, she did not say which one ♪",
      "♪ Eight minutes, eight minutes, eight minutes, four — that is the whole song ♪",
      "♪ I told the driver I was in a hurry. He put the hazards on ♪",
    ],
    dawn: [
      "First train out. Me, a man with a ladder, and nobody else.",
      "This early the fleet has not started disappointing anyone yet.",
      "Dawn service. Everything runs beautifully when no one is watching.",
    ],
    rush: [
      "Rush hour. Everyone going somewhere, nobody going first.",
      "Peak service, which means every vehicle is late in a coordinated way.",
      "This is the hour the map earns its keep.",
    ],
    midday: [
      "Midday. The buses have relaxed. Consider doing the same.",
      "Off peak. Everything runs looser and nobody minds.",
      "Quiet stretch. Good time for a rare one to wander past.",
    ],
    evening: [
      "Evening peak. The fleet wants to go home as much as you do.",
      "Everything on this board is pointed at somebody's dinner.",
    ],
    night: [
      "Night service. Half the fleet is asleep. The other half is lying about it.",
      "It is late. The timetable has become more of a suggestion.",
      "At this hour a bus arriving at all counts as a good outcome.",
    ],
    /* Poke it enough and it notices. This is the bit people show other people,
       so it escalates rather than repeating: the joke is that it is keeping
       count. Keys are click counts, checked exactly. */
    pokes: {
      3:  ["Again? Fine."],
      5:  ["I do only know so many of these."],
      8:  ["We are really doing this, then."],
      12: ["I have started making these up. You cannot tell, can you."],
      18: ["This is the most attention I have had all week."],
      25: ["Twenty-five. I am contractually a friend now."],
      40: ["You have clicked me forty times. The trains are RIGHT THERE."],
    },
    dismissed: ["Right. I will be in the corner if you need me."],
  };

  /* ---- where we are ------------------------------------------------------
     Keyed off the filename rather than the board's internals: every board is
     its own page, the name never changes at runtime, and it costs nothing if a
     board's JS has not finished booting. A city with no entry simply falls
     through to the general lines, so a board added later is never worse off
     than it is today — it just has no local jokes yet.

     Affectionate, not sneering. These are the operator's own cities and, in
     most cases, the rider's home system: the joke is always that the writer
     clearly rides it too. */
  var LOCAL = {
    "dc.html": [
      "Metro escalator out again. It has been out since before I was drawn.",
      "The Red Line does a thing near Silver Spring. You know the thing.",
      "♪ Single tracking, single tracking, doing one thing at a time ♪",
      "Six-car train, eight-car platform, one very confident sprint.",
      "Stand right, walk left. It is not a suggestion, it is the whole social contract.",
      "Farragut North and Farragut West are different stations. Yes. Still.",
      "♪ Doors closing, doors closing, doors opening again because of you ♪",
      "Silver Line all the way to the airport now. We waited a long time for that.",
      "Union Station has more marble than most countries and one working escalator.",
    ],
    "nyc.html": [
      "Somewhere on this map a train is running express and nobody was told.",
      "The countdown clock says 3 minutes. The countdown clock is an optimist.",
      "♪ Stand clear of the closing doors, and the man with the drum, and the rat ♪",
      "Every line here is a letter or a number and every one of them is personal.",
      "The G train is shorter than the platform and it will stop at the far end. Sprint.",
      "♪ We are delayed because of train traffic ahead of us, which is also delayed ♪",
      "The Times Square transfer is a quarter mile with a saxophone in the middle.",
      "It is the weekend, so this line is now a different line going somewhere else.",
      "Somebody is playing a full drum kit on the A. Tip them, they earned it.",
    ],
    "philadelphia.html": [
      "Regional Rail runs to its own calendar and I respect that.",
      "The Broad Street Line is quick when it wants to be. It rarely wants to be.",
      "♪ SEPTA, SEPTA, when will my train be ready — it has said two minutes for ten ♪",
      "The El is the fastest thing in this city and it knows it.",
      "Trolleys that go underground and come back up. Nowhere else does this properly.",
      "♪ Suburban, Jefferson, Market East — same station, three names, one confusion ♪",
      "PATCO runs all night. Somebody in this region had one good idea.",
      "Every Regional Rail line is named after where it ends, which helps nobody in the middle.",
    ],
    "boston.html": [
      "The Green Line is four lines in a trenchcoat and everyone here knows it.",
      "♪ Charlie never returned, and honestly the fare structure explains a lot ♪",
      "Somewhere ahead of this train there is a slower train. There always is.",
      "The Red Line splits at JFK. Watch the sign. Watch it again.",
      "♪ Last call is 1am, last train is 12:30 — do the maths, do the maths ♪",
      "Government Center was closed for two years and came back as a glass pyramid.",
      "A B-line trolley in traffic is just a very heavy bus with a worse turning circle.",
      "The Orange Line is the good one. Nobody says this out loud.",
    ],
    "newjersey.html": [
      "NJ Transit rail, running on the ancient principle of eventually.",
      "Every train on this board is technically going to New York.",
      "♪ Track announced with four minutes to go — RUN, everybody, RUN ♪",
      "The quiet car is quiet until exactly Newark.",
      "PATH at 3am is the only honest train in the region.",
      "♪ Secaucus, Secaucus, everybody changes at Secaucus ♪",
      "Hoboken terminal is beautiful and every train there is going backwards out of it.",
      "Northeast Corridor delays travel outward like weather. This is not a metaphor.",
    ],
    "losangeles.html": [
      "Los Angeles has trains. This board is the proof people keep asking for.",
      "The train is doing better than the 405 right now. The train usually is.",
      "♪ Nobody walks here, nobody walks here — except everyone on this platform ♪",
      "The E line goes to the beach. Actually to the beach. Try it once.",
      "Union Station is the most beautiful building in the city and it is a train station.",
      "♪ Metrolink, Metrolink, taking an hour to leave the county ♪",
      "Somebody on this platform is telling somebody else that LA has no transit.",
      "The subway is called the B and D now. We are all adjusting.",
    ],
    "sanfrancisco.html": [
      "BART is a wide-gauge opinion delivered at volume.",
      "The cable car is not transport, it is a very slow ride you queue for.",
      "♪ The fog came in and the ferry left without it ♪",
      "Muni Metro is a subway downtown and a street tram the moment it gets out.",
      "♪ Through the Transbay Tube, under the whole bay, do not think about it ♪",
      "Caltrain went electric and everybody noticed within one stop.",
      "The N Judah is a lovely ride when it is moving, which is a real condition.",
      "Powell Street has a queue for a vehicle that predates the queue.",
    ],
    "amsterdam.html": [
      "The tram is on time. The 400 bicycles around it are not governed by time.",
      "You are more likely to be hit by a bike than delayed by a tram here.",
      "♪ Ring ring, mind the tram, mind the bike, mind the canal ♪",
      "Check in. Check out. Forget to check out and the machine remembers forever.",
      "♪ The Noord-Zuidlijn took fifteen years and it is four minutes long ♪",
      "The ferry behind Centraal is free, runs all night, and nobody tells the tourists.",
      "Centraal Station is built on wooden poles in mud. It has been fine for 130 years.",
      "A tram driver rang at me once. I have thought about it every day since.",
    ],
    "zurich.html": [
      "A train here was 90 seconds late once. People still bring it up.",
      "The timetable is not a forecast in this country. It is a promise.",
      "♪ Punctual, punctual, punctual — this song has no second verse ♪",
      "Double-decker S-Bahn. Sit upstairs. Always sit upstairs.",
      "♪ The connection is four minutes and four minutes is plenty — it is Switzerland ♪",
      "The lake boats are on the same ticket. That is a very good deal nobody mentions.",
      "Hauptbahnhof has more platforms than some countries have stations.",
      "If a Swiss train is late there is a reason, and you will be told the reason.",
    ],
    "cologne.html": [
      "The Stadtbahn is half tram, half metro, fully committed to neither.",
      "Everything here eventually points at the cathedral, including me.",
      "♪ Kein Anschluss, kein Anschluss — the connection you wanted has left ♪",
      "You step off the train and the Dom is simply there, enormous, immediately.",
      "♪ KVB, KVB, wonderful when it runs — and it does run, mostly, honestly ♪",
      "The train crosses the Hohenzollern bridge past a tonne of padlocks. Literally a tonne.",
      "During Karneval the timetable becomes folklore.",
      "Half this network is underground and the other half is in the middle of the road.",
    ],
    "stuttgart.html": [
      "They have been rebuilding the station since before this board existed.",
      "The S-Bahn goes underground here and comes back up a different mood.",
      "♪ Stuttgart 21, still going, still going, still going ♪",
      "The city is in a bowl. Every line out of it is a climb.",
      "♪ The Zacke goes up the hill with teeth — an actual rack railway, in a city ♪",
      "Airport is on the S2 and S3. That is genuinely all you need to know.",
      "There is a funicular here for the cemetery. It is lovely and slightly grim.",
      "Every S-Bahn line meets in one tunnel downtown, which is efficient until it is not.",
    ],
    /* Not cities. The landing page is the shop window, so the lines sell rather
       than commiserate; the stencil is the template a new city is cloned from,
       so its lines are aimed at whoever is doing the cloning. */
    "index.html": [
      "Everything on this page is live. Nothing here is a mockup.",
      "That board updates whether or not anybody is looking at it. Usually nobody is. That is the point.",
      "♪ No server, no signup, no subscription — just a screen that knows when the bus is ♪",
      "Pick a city. I will follow you there and keep talking.",
      "Yes, I am part of it. No, I do not know when your bus is. I only do commentary.",
      "♪ Buy it once, hang it on a wall, forget it exists, glance up, know the time ♪",
      "Somebody has this running on an old tablet by their front door right now.",
    ],
    "stencil.html": [
      "This is the template. Copy it, point it at a city, and I come along too.",
      "If you are reading this you are probably building a new board. Good.",
      "♪ Clone the stencil, change the feeds, ship a city ♪",
      "Give your city its own lines in mascot-buddy.js. That is the fun part.",
    ],
    /* Sky view watches one aircraft at a time, so its lines look up rather than
       at a timetable. */
    "night.html": [
      "That is 38,000 feet of people wondering when the trolley is coming.",
      "The aircraft overhead is doing about 500 knots. Your bus is doing eleven.",
      "♪ Wheels up, tray table stowed, seatbelt sign staying on out of spite ♪",
      "Contrails are just very high clouds running to a schedule.",
      "Right now, above you, somebody is standing up before the sign goes off.",
      "There are people up there eating a small warm bread roll. Think about that.",
      "♪ Up she goes, up she goes, and nobody down here looked ♪",
      "Every one of those is going somewhere you have not been.",
      "Look up occasionally. That is the entire pitch of this screen.",
    ],
  };

  /* ---- naming what is actually overhead ----------------------------------
     Sky view keeps its current subject on window.__lastSubject, and a line that
     names the airline you are looking at beats any generic one. Read
     defensively: that variable belongs to night.html, not to this file, and a
     mascot must never be why a wall display throws. */
  function subjectLine() {
    var s = null;
    try { s = window.__lastSubject || null; } catch (_) { return ""; }
    if (!s) return "";
    var who = "";
    try { who = String(s.airline || s.operator || s.sysName || "").trim(); } catch (_) { return ""; }
    if (!who || who.length > 26) return "";       // long leasing-trust names read badly
    return pick([
      who + " overhead. Somebody up there has a better view than both of us.",
      who + ", going somewhere, at speed, without consulting either of us.",
      "That is " + who + ". The screen went their colour, which is only polite.",
    ]);
  }

  function localLines() {
    var f = (location.pathname.split("/").pop() || "").toLowerCase();
    return LOCAL[f] || null;
  }

  /* ---- who is on duty ----------------------------------------------------
     mascot.js already honours a single-character override in localStorage under
     "tb.mascot", and honours it everywhere — the tour and the Spotted card read
     the same key. So the picker writes that, and one choice follows the visitor
     across the whole product rather than being a corner-of-the-page setting.

     Reading the FULL cast is slightly awkward because list() returns the
     override when one is set, which would leave the picker showing only the
     character already chosen. Lifting the key for the length of the call is the
     honest way to ask "what could I choose?" without reaching into mascot.js's
     internals, which the other session is still editing. */
  var PICK_KEY = "tb.mascot";
  function chosen() { try { return localStorage.getItem(PICK_KEY) || ""; } catch (_) { return ""; } }
  function fullCast() {
    var saved = chosen();
    try { if (saved) localStorage.removeItem(PICK_KEY); } catch (_) {}
    var l = (window.TBMascot && TBMascot.list && TBMascot.list()) || [];
    try { if (saved) localStorage.setItem(PICK_KEY, saved); } catch (_) {}
    return l;
  }
  function nameOf(src) {
    var m = String(src).match(/mascot-([a-z0-9]+)\./i);
    return m ? m[1].charAt(0).toUpperCase() + m[1].slice(1) : "Guide";
  }
  function choose(src) {
    try { src ? localStorage.setItem(PICK_KEY, src) : localStorage.removeItem(PICK_KEY); } catch (_) {}
    charIndex = 0;
    drawCharacter();
    say(src ? nameOf(src) + " it is. I will be right here."
            : "Surprise me it is. You get whoever turns up.", 3600);
    closePicker();
  }

  var last = {};                              // category -> last index, so it never repeats twice
  function pick(list) {
    if (!list || !list.length) return "";
    if (list.length === 1) return list[0];
    var key = list[0], i;
    do { i = Math.floor(Math.random() * list.length); } while (i === last[key] && list.length > 1);
    last[key] = i;
    return list[i];
  }

  function timeBucket() {
    var h = new Date().getHours();
    if (h < 6) return SAY.night;
    if (h < 9) return SAY.dawn;
    if (h < 10) return SAY.rush;
    if (h < 16) return SAY.midday;
    if (h < 19) return SAY.evening;
    if (h < 23) return SAY.midday;
    return SAY.night;
  }

  var clicks = 0;
  function nextLine(fromClick) {
    if (fromClick && SAY.pokes[clicks]) return pick(SAY.pokes[clicks]);
    /* Local lines lead. They are the ones that make somebody screenshot the
       thing, because they are about the system the reader actually rides —
       a joke about single tracking only lands on the board where it happens.
       The general and sung sets are the fallback, and the only set on a city
       with no entry yet. */
    // Best of all is a line about the thing currently on screen. Only Sky view
    // publishes one, and only sometimes, so this is opportunistic, not a tier.
    if (Math.random() < 0.3) { var subj = subjectLine(); if (subj) return subj; }
    var loc = localLines();
    var r = Math.random();
    if (loc && r < 0.45) return pick(loc);
    if (r < 0.68) return pick(SAY.song);
    return pick(timeBucket());
  }

  /* ---- the furniture ----------------------------------------------------- */
  function styles() {
    if (document.getElementById("tb-buddy-css")) return;
    var css = document.createElement("style");
    css.id = "tb-buddy-css";
    css.textContent = [
      "#tbBuddy{position:fixed;left:12px;bottom:26px;z-index:9996;display:flex;align-items:flex-end;",
        "gap:8px;pointer-events:none;font-family:'IBM Plex Sans',system-ui,sans-serif}",
      "#tbBuddy .fig{pointer-events:auto;cursor:pointer;background:none;border:0;padding:0;",
        "line-height:0;filter:drop-shadow(0 4px 10px rgba(0,0,0,.45));transition:transform .18s ease}",
      "#tbBuddy .fig:hover{transform:translateY(-3px)}",
      "#tbBuddy .fig:active{transform:translateY(0) scale(.94)}",
      "#tbBuddy .fig img,#tbBuddy .fig svg{display:block;width:54px;height:64px}",
      /* Paper card, ink text — the brand's own pairing, and the one combination
         that stays readable over a dark map or a bright one. */
      /* The bubble does not take clicks. On a narrow screen it can lie over a
         real control — Sky view's CLOSE UP button, for one — and a speech
         bubble swallowing a button press is worse than one that overlaps it.
         Its own two buttons opt back in. */
      "#tbBuddy .bub{pointer-events:none;position:relative;max-width:min(46vw,300px);",
        "background:#FFFCF5;color:#12101A;border-radius:14px;padding:10px 26px 10px 13px;",
        "font-size:13px;line-height:1.4;box-shadow:0 8px 24px rgba(0,0,0,.4);",
        "opacity:0;transform:translateY(6px) scale(.96);transform-origin:0 100%;",
        "transition:opacity .2s ease,transform .2s ease;visibility:hidden}",
      "#tbBuddy.talking .bub{opacity:1;transform:none;visibility:visible}",
      /* the tail, pointing back at whoever is speaking */
      "#tbBuddy .bub::after{content:'';position:absolute;left:-6px;bottom:12px;width:12px;height:12px;",
        "background:#FFFCF5;transform:rotate(45deg);border-radius:2px}",
      "#tbBuddy .x{pointer-events:auto;position:absolute;top:4px;right:5px;width:18px;height:18px;border:0;background:none;",
        "color:#6E6A78;font:600 13px/1 system-ui;cursor:pointer;border-radius:50%}",
      "#tbBuddy .x:hover{background:rgba(18,16,26,.09);color:#12101A}",
      /* the picker: a row of candidates, opened from the bubble */
      "#tbBuddy .who{pointer-events:auto;position:absolute;top:4px;right:24px;width:18px;height:18px;border:0;background:none;",
        "color:#6E6A78;font:600 13px/1 system-ui;cursor:pointer;border-radius:50%}",
      "#tbBuddy .who:hover{background:rgba(18,16,26,.09);color:#12101A}",
      "#tbBuddy .pick{pointer-events:auto;position:absolute;left:0;bottom:calc(100% + 8px);",
        "background:#FFFCF5;color:#12101A;border-radius:14px;padding:10px 12px;",
        "box-shadow:0 8px 24px rgba(0,0,0,.4);display:none;min-width:190px}",
      "#tbBuddy.picking .pick{display:block}",
      "#tbBuddy .pick h4{margin:0 0 8px;font:700 10px/1 'IBM Plex Mono',ui-monospace,monospace;",
        "letter-spacing:.13em;text-transform:uppercase;color:#6E6A78}",
      "#tbBuddy .cast{display:flex;gap:6px}",
      "#tbBuddy .cast button{border:2px solid transparent;background:none;border-radius:11px;",
        "padding:5px 4px 3px;cursor:pointer;line-height:0;flex:1}",
      "#tbBuddy .cast button:hover{background:rgba(18,16,26,.06)}",
      "#tbBuddy .cast button.on{border-color:#FF3D77}",
      "#tbBuddy .cast img,#tbBuddy .cast svg{display:block;width:38px;height:45px;margin:0 auto}",
      "#tbBuddy .cast .nm{display:block;font:600 9px/1.6 'IBM Plex Mono',ui-monospace,monospace;",
        "letter-spacing:.08em;text-transform:uppercase;color:#6E6A78;text-align:center}",
      "#tbBuddy .any{margin-top:8px;width:100%;border:1px solid #E7E1D4;background:none;border-radius:9px;",
        "padding:6px;font:600 11px/1 'IBM Plex Sans',system-ui;color:#12101A;cursor:pointer}",
      "#tbBuddy .any:hover{border-color:#FF3D77}",
      "#tbBuddy .any.on{border-color:#FF3D77;background:rgba(255,61,119,.08)}",
      "@media (max-width:600px){#tbBuddy .fig img,#tbBuddy .fig svg{width:44px;height:52px}",
        "#tbBuddy .bub{font-size:12px;max-width:62vw}}",
      "@media (prefers-reduced-motion:reduce){#tbBuddy .fig,#tbBuddy .bub{transition:none}}",
      /* Printing a wall display should not print a cartoon. */
      "@media print{#tbBuddy{display:none}}",
    ].join("");
    (document.head || document.documentElement).appendChild(css);
  }

  var root, figure, bubble, textEl, picker, hideTimer, idleTimer, charIndex = 0;

  /* ---- the picker -------------------------------------------------------- */
  function buildPicker() {
    if (!picker) return;
    var cast = fullCast();
    // Nothing to choose between: the operator pinned a single character in
    // config.js, and offering a menu of one is worse than offering none.
    if (cast.length < 2) { picker.dataset.empty = "1"; return; }
    delete picker.dataset.empty;
    var now = chosen();
    picker.innerHTML = "";
    var h = document.createElement("h4");
    h.textContent = "Your guide";
    picker.appendChild(h);
    var row = document.createElement("div");
    row.className = "cast";
    cast.forEach(function (src) {
      var b = document.createElement("button");
      b.type = "button";
      b.title = nameOf(src);
      if (src === now) b.className = "on";
      b.setAttribute("aria-pressed", src === now ? "true" : "false");
      if (window.TBMascot && TBMascot.el) b.appendChild(TBMascot.el({ width: 38, src: src }));
      var nm = document.createElement("span");
      nm.className = "nm"; nm.textContent = nameOf(src);
      b.appendChild(nm);
      b.addEventListener("click", function (e) { e.stopPropagation(); choose(src); });
      row.appendChild(b);
    });
    picker.appendChild(row);
    var any = document.createElement("button");
    any.type = "button";
    any.className = "any" + (now ? "" : " on");
    any.textContent = "Surprise me";
    any.addEventListener("click", function (e) { e.stopPropagation(); choose(""); });
    picker.appendChild(any);
  }
  function togglePicker() {
    if (!root) return;
    if (root.classList.contains("picking")) return closePicker();
    buildPicker();
    if (picker.dataset.empty) return;
    root.classList.add("picking");
  }
  function closePicker() { if (root) root.classList.remove("picking"); }

  function drawCharacter() {
    if (!figure) return;
    figure.innerHTML = "";
    if (window.TBMascot && TBMascot.el) {
      figure.appendChild(TBMascot.el({ width: 54, index: charIndex }));
    } else {
      figure.textContent = "•";          // TBMascot absent: degrade, never throw
    }
  }

  function say(text, ms) {
    if (!root || !text) return;
    /* Recomputed on every line rather than once at build. Sky view is still
       laying itself out when this script runs — measured once at build the
       footer was 60px higher than it ended up, and the bubble sat 9px into the
       credits. Speaking is exactly the moment the position has to be right. */
    liftAboveFooter();
    textEl.textContent = text;
    root.classList.add("talking");
    clearTimeout(hideTimer);
    // Long lines get longer on screen — read speed, not a fixed guess.
    hideTimer = setTimeout(hush, ms || Math.max(4200, Math.min(11000, text.length * 78)));
  }
  function hush() { if (root) root.classList.remove("talking"); }

  function poke() {
    clicks++;
    charIndex++;                         // a poke also changes who is standing there
    drawCharacter();
    say(nextLine(true));
    schedule();                          // reset the idle clock; you just heard from it
  }

  function schedule() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function tick() {
      if (document.visibilityState === "visible" && !off()) {
        charIndex++; drawCharacter(); say(nextLine(false));
      }
      schedule();
    }, IDLE_MS);
  }

  /* Sky view does not scroll — it is one full-height screen with a footer
     pinned at the bottom of the layout — so a mascot at bottom:26 lands on top
     of the credits. On a page that DOES scroll the footer travels away on its
     own and this leaves it alone, because permanently reserving space for a
     footer nobody is looking at wastes the corner. */
  function liftAboveFooter() {
    if (!root) return;
    var scrolls = document.documentElement.scrollHeight > window.innerHeight + 4;
    if (scrolls) { root.style.bottom = ""; return; }
    var f = document.querySelector("footer");
    if (!f) { root.style.bottom = ""; return; }
    var r = f.getBoundingClientRect();
    if (!r.height || r.bottom < window.innerHeight - 80) { root.style.bottom = ""; return; }
    root.style.bottom = Math.round(window.innerHeight - r.top + 8) + "px";
  }

  function dismiss() {
    say(pick(SAY.dismissed), 2200);
    setOff(true);
    setTimeout(function () { if (root) root.remove(); root = null; clearTimeout(idleTimer); }, 2400);
  }

  function build() {
    if (off() || document.getElementById("tbBuddy")) return;
    styles();
    root = document.createElement("div");
    root.id = "tbBuddy";

    figure = document.createElement("button");
    figure.type = "button";
    figure.className = "fig";
    figure.title = "Say something";
    figure.setAttribute("aria-label", "Mascot — click for a remark");
    figure.addEventListener("click", poke);

    bubble = document.createElement("div");
    bubble.className = "bub";
    /* polite, not assertive: a wall display should never interrupt a screen
       reader mid-sentence to deliver a joke about buses */
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-live", "polite");
    textEl = document.createElement("span");
    var x = document.createElement("button");
    x.className = "x"; x.type = "button"; x.textContent = "×";
    x.title = "Hide the mascot";
    x.setAttribute("aria-label", "Hide the mascot");
    x.addEventListener("click", function (e) { e.stopPropagation(); dismiss(); });
    var who = document.createElement("button");
    who.className = "who"; who.type = "button"; who.textContent = "⋯";
    who.title = "Choose your guide";
    who.setAttribute("aria-label", "Choose your guide");
    who.addEventListener("click", function (e) { e.stopPropagation(); togglePicker(); });

    bubble.appendChild(textEl);
    bubble.appendChild(who);
    bubble.appendChild(x);

    picker = document.createElement("div");
    picker.className = "pick";
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "Choose your guide");

    root.appendChild(figure);
    root.appendChild(picker);
    root.appendChild(bubble);
    document.body.appendChild(root);

    charIndex = window.TBMascot && TBMascot.pickIndex ? TBMascot.pickIndex() : 0;
    drawCharacter();
    liftAboveFooter();
    window.addEventListener("resize", liftAboveFooter);
    // late passes: some pages finish arranging themselves seconds after load
    setTimeout(liftAboveFooter, 2500);
    setTimeout(liftAboveFooter, 8000);

    setTimeout(function () { if (root && !off()) say(pick(SAY.hello)); }, FIRST_MS);
    schedule();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();

  window.TBBuddy = {
    say: say,
    poke: poke,
    hide: function () { setOff(true); if (root) { root.remove(); root = null; } clearTimeout(idleTimer); },
    show: function () { setOff(false); build(); },
    lines: function () { return JSON.parse(JSON.stringify(SAY)); },
  };
})();
