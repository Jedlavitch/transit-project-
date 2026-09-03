/* ============================================================================
   mascot-buddy.js — the mascot, in the corner, with something to say.

   WHAT IT IS
     A small resident character bottom-left of any board. It says something
     occasionally, says something whenever you poke it, and swaps between the
     cast as it goes. Nothing else on these screens has a personality, and a
     departure board that is pleased to see you is a thing people show other
     people. That is the point of it.

     Three characters, three voices. The cast used to rotate through identical
     lines, which taught you the swap was decorative; now each has a
     temperament and a pool only they use, and the bubble prints whose it is.
     Pim keeps the timetable and is let down by it. Vix knows the fast way
     through. Otto works nights and is in no hurry. Names come from mascot.js,
     so the picker and the Spotted card cannot disagree about who anyone is.

   WHAT IT KNOWS
     Everything specific it says is read off state the page already has — no
     feed of its own, nothing to configure, nothing new to break at 3am:

       lastRanked    the live service alerts, ranked worst-first by the card
       TBDep         what is actually leaving, from departures.js
       TBOnTime      how far off the next one usually is, per stop and route
       TBCommute     your saved stop and how long you take to walk to it
       TBLeaders     the day's best sighting, and the rarity registry behind it
       tb.spots      your own collection, from spotlog.js
       __lastSubject the aircraft Sky view is watching, and how far through

     Each is a chance rather than a rule. A mascot that ALWAYS reads out the
     departures has become a second departure display, and the board behind it
     is a much better one.

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
     ×, remembered in localStorage. Between 2am and 5am it dozes and says
     nothing at all until poked. The idle chatter is the garnish. The poke is
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

  /* ---- three characters, three voices ------------------------------------
     The cast rotated on every line, and every one of them said exactly the
     same things. That made the swap decorative: you noticed a different animal
     and heard an identical joke, which is worse than not swapping at all,
     because it quietly tells you the choice does not matter.

     So each one gets a temperament and a pool of lines only they say. The
     shared pools stay shared — a city's own jokes belong to the city, not to
     whoever happens to be standing there — and these mix in on top. The result
     is that "Surprise me" is now worth choosing, and pinning one is worth
     choosing too, which is the first time the picker has been a real decision.

     Keyed by the slug mascot.js derives from the filename, so a customer who
     drops in their own art simply falls through to the shared pools rather
     than getting somebody else's personality. */
  var VOICE = {
    penguin: {
      hello: [
        "Pim here. I have read today's timetable. It is an optimistic document.",
        "Pim. Everything below is scheduled. Scheduled is not the same as happening.",
      ],
      own: [
        "I have the timetable memorised. It has disappointed me every day this week.",
        "The published time and the real time are two different numbers and I follow both.",
        "A schedule is a promise. That is a philosophical position and it has cost me.",
        "I stand on the exact spot where the doors will open. It is the only control I have.",
        "I once caught a train that was early. I have never fully recovered.",
        "♪ Departs at nine, departs at nine, departs at nine, departs at ten ♪",
        "Somebody wrote these times down and meant them. I think about that person a lot.",
      ],
      wake: ["Pim. Awake. The 04:52 does not run today, before you ask."],
    },
    fox: {
      hello: [
        "Vix. I have already worked out the fast way through this station.",
        "Vix here. Whatever you are about to do, there is a quicker version.",
      ],
      own: [
        "Third carriage. The doors line up with the stairs. You are welcome.",
        "Everyone queues at the nearest door. I am not everyone.",
        "There is a faster route and it involves one more change. Trust me on this.",
        "Four-minute connection is plenty if you know which end of the platform to stand on.",
        "I know which exit puts you on the correct side of the road. It is my whole personality.",
        "♪ Out the back, down the steps, through the gap, gone ♪",
        "Never run for the first one. Run for the one after, from a better position.",
      ],
      wake: ["Vix. I was resting my eyes strategically."],
    },
    owl: {
      hello: [
        "Otto. I have been watching this board a while. It is decent company.",
        "Otto here. Nothing is coming for a bit. That is not a complaint.",
      ],
      own: [
        "I like the last service best. Everyone on it has a story and nobody tells it.",
        "Waiting is not wasted time. It is only time you did not pick.",
        "I watched this platform for two hours once. Nothing came. It was lovely.",
        "The night bus makes no promises, which makes it the honest one.",
        "Empty platform, one light on, nothing due. My favourite screen in the world.",
        "♪ Nothing due, nothing due, and I am in no hurry either ♪",
        "Everyone wants the next one. Almost nobody wants the one after. Their loss.",
      ],
      wake: ["Otto. I am nocturnal, so technically that was rude."],
    },
  };

  /* Which of them is standing there right now. charIndex walks the cast, so
     this is the same arithmetic drawCharacter() does — asked of the same list,
     one line later, so the voice can never belong to a different face than the
     one on screen. */
  function currentSrc() {
    var l = [];
    try { l = (window.TBMascot && TBMascot.list && TBMascot.list()) || []; } catch (_) { return ""; }
    if (!l.length) return "";
    return l[((charIndex % l.length) + l.length) % l.length];
  }
  function currentVoice() {
    var m = null;
    try { m = window.TBMascot && TBMascot.meta ? TBMascot.meta(currentSrc()) : null; } catch (_) {}
    return (m && VOICE[m.slug]) || null;
  }
  function currentName() {
    var m = null;
    try { m = window.TBMascot && TBMascot.meta ? TBMascot.meta(currentSrc()) : null; } catch (_) {}
    return (m && m.name) || "";
  }

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

  /* ---- what is actually leaving, right now -------------------------------
     departures.js pools every board's rendered departures on TBDep so the
     commute countdown and the wait recorder can share one supply. A third
     reader costs nothing and finally gets the mascot the thing this file's
     header has always claimed for it: a remark about THIS screen, now. "The 21
     goes in two minutes" beats every joke about buses in general, and until now
     only Sky view had anything of the sort.

     Read defensively and cheaply. TBDep is absent on Sky view and on any board
     that has not opted in, an empty pool is the normal state for the first few
     seconds of every load, and a mascot must never be why a wall display
     throws. */
  /* Feeds pad strings for their own layout — Sky view's route line has double
     spaces either side of its arrow — and a bubble is not that layout. */
  function clip(v, n) {
    var t = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    return t.length > n ? "" : t;
  }
  function depName(d) {
    var r = clip(d.route, 14);
    if (r) return "The " + r;
    var m = String(d.mode || "").toLowerCase();
    return m === "ferry" ? "The ferry" : m === "tram" ? "The tram"
         : m === "bus" ? "The bus" : m === "train" ? "The train" : "The next one";
  }
  function depTo(d) { var t = clip(d.dest, 22); return t ? " to " + t : ""; }
  /* clip() drops a string that runs long, which is right for a NAME — a
     40-character leasing-trust title reads worse than no name at all. It is
     wrong wherever the text itself is the information. The alert card's own
     tidier caps its sentences at about 115 characters, so a 100-character clip
     here was strictly tighter than the source and threw away precisely the
     most detailed warnings: Washington's live "shuttle buses replace trains"
     notice is 104 and never once got spoken. Cut at a word instead. */
  function snip(v, n) {
    var t = String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    if (t.length <= n) return t;
    return t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";
  }

  function depRows() {
    var rows = [];
    try { rows = (window.TBDep && TBDep.all && TBDep.all()) || []; } catch (_) { return []; }
    return rows.slice().sort(function (a, b) { return a.min - b.min; });
  }
  function norm(v) { return String(v == null ? "" : v).toLowerCase().replace(/[^a-z0-9]+/g, ""); }
  function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }
  /* Mode words spelled out, because naive pluralisation says "2 buss" — and one
     word like that makes every figure next to it look unchecked. */
  var MODE_WORD = { metro: ["metro", "metros"], bus: ["bus", "buses"],
                    train: ["train", "trains"], tram: ["tram", "trams"],
                    ferry: ["ferry", "ferries"], other: ["departure", "departures"] };
  function modeWord(m, n) {
    var w = MODE_WORD[m] || MODE_WORD.other;
    return n + " " + w[n === 1 ? 0 : 1];
  }

  function boardLine() {
    var rows = depRows();
    if (!rows.length) return "";
    var soon = rows[0], opts = [], i;

    if (soon.min <= 1) {
      opts.push(depName(soon) + depTo(soon) + " goes in about a minute. That is a run, not a walk.");
      opts.push(depName(soon) + " is leaving now. You and I are both too late for it.");
    } else if (soon.min <= 4) {
      opts.push(depName(soon) + depTo(soon) + " in " + soon.min + " minutes. Comfortable, if you go now.");
    }

    /* Two of the same route, minutes apart, is the oldest complaint in
       transport and the one people most enjoy being told they were right
       about. Only worth saying while both are still on the board. */
    for (i = 1; i < rows.length && rows[i].min <= 25; i++) {
      var a = rows[i - 1], b = rows[i];
      if (a.route && a.route === b.route && b.min - a.min <= 3) {
        var gap = Math.max(1, b.min - a.min);
        opts.push("Two " + a.route + "s, " + gap + (gap === 1 ? " minute" : " minutes") +
                  " apart. Naturally.");
        break;
      }
    }

    if (soon.min >= 18) {
      opts.push("Nothing for " + soon.min + " minutes. Whatever you were going to do, there is time.");
      opts.push(soon.min + " minutes until anything at all happens here. Sit down.");
    }

    var live = 0;
    for (i = 0; i < rows.length; i++) if (rows[i].live) live++;
    if (!live && rows.length >= 4) {
      opts.push("Not one of these is live. They are timetable numbers wearing a confident face.");
    }
    if (rows.length >= 14 && soon.min <= 5) {
      opts.push(rows.length + " departures on this board and precisely one of them is yours.");
    }
    return pick(opts);
  }

  /* ---- what is actually wrong, in words ----------------------------------
     Six boards run a live service-alert card, and each keeps its ranked set on
     a top-level `lastRanked` — a LEXICAL global, reachable as a bare
     identifier, never a property of window. departures.js reads the boards'
     `state` exactly this way and documents why; this is the same trick and the
     same caveat, so it is wrapped in the same defensive shape.

     The card ranks worst-first and removes itself when nothing is wrong, so
     entry zero is the single most useful sentence on the screen. Saying it out
     loud matters because the card is one small box in a grid and a person
     glancing at a board from the hallway will not read it. */
  function boardAlerts() {
    try { /* eslint-disable-next-line no-undef */
      return (typeof lastRanked !== "undefined" && Array.isArray(lastRanked)) ? lastRanked : null;
    } catch (_) { return null; }
  }
  function alertLine() {
    var a = boardAlerts();
    if (!a || !a.length) return "";
    var top = a[0] || {}, who = clip(top.lbl, 34), txt = snip(top.txt, 130);
    if (!txt) return "";
    var sev = String(top.sev || "");
    var head = sev === "major" ? "Worth knowing. " : sev === "delay" ? "Heads up. " : "";
    var more = a.length > 1 ? " Plus " + plural(a.length - 1, "other") + " on the card." : "";
    return head + (who ? who + ": " : "") + txt + more;
  }

  /* ---- how this stop normally behaves ------------------------------------
     ontime.js has been quietly recording, per stop and route, how far away the
     next departure is every time the board refreshes — and nothing says the
     result in words. "Usually 6 minutes, today 14" is the most useful sentence
     this screen can produce, because it is the only one that knows what normal
     looks like here.

     The key is rebuilt rather than looked up: statsFor() is keyed
     mode|stop|route and every one of those fields is on the row already, so
     the mascot asks about a departure it can actually see. Scheduled rows are
     skipped because ontime.js does not record them — a timetable is not an
     observation, and their key would come back empty. */
  function waitLine() {
    if (!window.TBOnTime || !TBOnTime.stats) return "";
    var live = depRows().filter(function (d) { return d.live && d.stop; });
    if (!live.length) return "";
    var d = live[Math.floor(Math.random() * live.length)], st = null;
    try { st = TBOnTime.stats(d.mode + "|" + d.stop + "|" + (d.route || "")); } catch (_) { return ""; }
    if (!st || st.baseAvg == null) return "";
    var where = clip(d.stop, 26);
    if (!where) return "";
    var what = d.route ? "the " + clip(d.route, 14) : "the next one";
    if (!what) return "";
    var base = Math.round(st.baseAvg);
    var span = st.baseSpan === "weeks" ? "Normally" : "So far today";
    // Only claim a difference the reading can carry. A single morning against
    // a fortnight is noise, and saying it would make every other figure here
    // less believable.
    if (st.todayAvg != null && st.baseSpan === "weeks" && st.todayN >= 4) {
      var now = Math.round(st.todayAvg), gap = now - base;
      if (gap >= 2) return where + ": " + what + " is normally " + base +
                           " minutes off. Today it is averaging " + now + ".";
      if (gap <= -2) return where + ": " + what + " is normally " + base +
                            " minutes off. Today it is running " + now + ". Better than usual.";
    }
    return span + " at " + where + ", " + what + " is about " + base + " minutes away when you look.";
  }

  /* ---- your own journey --------------------------------------------------
     commute.js already knows the stop you saved and how long you take to walk
     there. The countdown card says it in numbers; this says the only figure
     that actually decides anything, which is when to stand up. */
  function commuteLine() {
    var t = null;
    try { t = window.TBCommute && TBCommute.trip ? TBCommute.trip() : null; } catch (_) { return ""; }
    if (!t || !t.stop) return "";
    var where = clip(t.stop, 26);
    if (!where) return "";
    var mine = depRows().filter(function (d) {
      return norm(d.stop) === norm(t.stop) && (!t.route || norm(d.route) === norm(t.route));
    });
    if (!mine.length) return "Nothing from " + where + " on the board at the moment.";
    var catchable = null;
    for (var i = 0; i < mine.length; i++) if (mine[i].min - t.walk >= 0) { catchable = mine[i]; break; }
    if (!catchable) {
      return "Everything from " + where + " right now is inside your " + t.walk +
             " minute walk. The next one you could make is not on the board yet.";
    }
    var leave = catchable.min - t.walk;
    return where + ": one goes in " + plural(catchable.min, "minute") + ", so " +
           (leave === 0 ? "leave now." : "leave in " + plural(leave, "minute") + ".");
  }

  /* ---- what is on the board at all ---------------------------------------
     A count is not a joke and is not meant to be. It answers the question a
     glance across a room cannot: is this thing showing me much, and is any of
     it real? The live/scheduled split is the honest half — a board of
     timetable numbers looks identical to a board of predictions. */
  function mixLine() {
    var rows = depRows();
    if (rows.length < 3) return "";
    var by = {}, live = 0, i;
    for (i = 0; i < rows.length; i++) {
      var m = String(rows[i].mode || "").toLowerCase() || "other";
      by[m] = (by[m] || 0) + 1;
      if (rows[i].live) live++;
    }
    var parts = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; })
      .slice(0, 3).map(function (m) { return modeWord(m, by[m]); });
    if (!parts.length) return "";
    var tail = live === rows.length ? "Every one of them is a live prediction."
             : live ? live + " of them are live predictions, the rest timetable."
             : "None of them are live — that is the timetable talking.";
    return "On the board now: " + parts.join(", ") + ". " + tail;
  }

  /* ---- what this screen has learned --------------------------------------
     interesting.js scores rarity from a registry it builds itself, per city,
     and damps it while young. Nothing tells you that registry exists. Saying
     its size and its age is what makes the leaderboard trustworthy instead of
     magic: it is rare HERE, and here is a place this screen has been watching
     since a date you can check. */
  function learnedLine() {
    var reg = null, id = cityId();
    if (!id) return "";
    try { reg = window.TBLeaders && TBLeaders.seen ? TBLeaders.seen() : null; } catch (_) { return ""; }
    var c = reg && reg[id];
    if (!c) return "";
    var tokens = Object.keys(c), first = "";
    if (tokens.length < 12) return "";      // too young to be worth quoting
    for (var i = 0; i < tokens.length; i++) {
      var f = c[tokens[i]] && c[tokens[i]].first;
      if (f && (!first || f < first)) first = f;
    }
    return "I have learned " + tokens.length + " regulars on this board" +
           (first ? " since " + first : "") + ". Anything off that list scores as rare.";
  }

  /* ---- the best thing that went past today -------------------------------
     interesting.js scores every plane and train a board renders and keeps the
     day's best per city. That is already on screen in its own card, so the
     mascot's job is not to read the leaderboard out — it is to do the thing a
     card cannot, and bring it up unprompted three hours later. */
  /* Which city this page is, in interesting.js's own vocabulary. Two readers
     want it now, and asking the module that owns the list beats keeping a
     second copy of the filename-to-id mapping in here. */
  function cityId() {
    try {
      if (!window.TBLeaders || !TBLeaders.cities) return "";
      var f = (location.pathname.split("/").pop() || "").toLowerCase();
      for (var i = 0; i < TBLeaders.cities.length; i++) {
        if (TBLeaders.cities[i].file === f) return TBLeaders.cities[i].id;
      }
    } catch (_) {}
    return "";
  }
  function rareLine() {
    var box = null, id = cityId();
    if (!id) return "";
    try { box = TBLeaders.read(); } catch (_) { return ""; }
    var list = (box && box.cities && box.cities[id]) || [];
    if (!list.length) return "";
    var top = list[0], t = clip(top.title, 30);
    if (!t) return "";
    var when = "";
    try {
      var d = new Date(top.ts);
      if (top.ts && !isNaN(d.getTime())) {
        when = " at " + ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
      }
    } catch (_) {}
    /* The entry carries the numbers the leaderboard row shows — route, height,
       speed for a plane; how late, and out of where, for a train. Quoting them
       is the difference between naming the winner and saying what made it one. */
    var detail = clip(top.detail, 46), score = Number(top.score);
    var opts = [
      "Best thing past this screen today: " + t + when + ". You were looking at your phone.",
      t + " came through" + when + ". Still the most interesting thing all day.",
      "Nothing has beaten " + t + " yet today. The day is young.",
    ];
    if (detail) {
      opts.push(t + ", today's best: " + detail + ".");
      opts.push("Today's winner is " + t + " — " + detail + ".");
    }
    if (isFinite(score) && score > 0) {
      opts.push(t + " is leading today on " + Math.round(score) +
                " points. Rarity is scored against what this board usually sees.");
    }
    return pick(opts);
  }

  /* ---- the aircraft Sky view is watching ---------------------------------
     subjectLine() names the airline and stops there. The subject object also
     carries where it came from, where it is going, and how far through the
     flight it is — which is the part a person actually wonders about while
     looking up. Same defensive read: that object belongs to night.html. */
  function skyLine() {
    var s = null;
    try { s = window.__lastSubject || null; } catch (_) { return ""; }
    if (!s) return "";
    var o = clip(s.oCity, 22), d = clip(s.dCity, 22), opts = [];
    var pct = Number(s.progPct), togo = Number(s.progToGo), flown = Number(s.progFlown);
    if (o && d) {
      opts.push("That one is flying " + o + " to " + d + ", straight over you.");
      if (isFinite(pct) && pct > 4 && pct < 96) {
        opts.push("Overhead: " + o + " to " + d + ", about " + Math.round(pct) + " per cent of the way there.");
      }
    } else if (d) {
      opts.push("That one is on its way to " + d + ".");
    }
    if (isFinite(togo) && togo > 20) {
      opts.push("Still " + Math.round(togo).toLocaleString() + " nautical miles to run on that one.");
    }
    if (isFinite(flown) && flown > 20 && isFinite(togo) && togo > 20) {
      opts.push(Math.round(flown).toLocaleString() + " miles behind it, " +
                Math.round(togo).toLocaleString() + " ahead. It is not quite halfway through its day.");
    }
    var sl = clip(s.subline, 52);
    if (sl && sl.indexOf("→") >= 0) opts.push("Route on that one: " + sl + ".");
    return pick(opts);
  }

  /* ---- your own collection -----------------------------------------------
     The Spotted card keeps sightings in tb.spots, and mascot.js already writes
     about them — but those lines are sized for a caption inside that card. Out
     here the same facts want a different register, and today's count is the one
     worth speaking, because it is the only one that can change while you are
     stood in front of the thing. */
  function spotLine() {
    var arr = [];
    try { arr = JSON.parse(localStorage.getItem("tb.spots") || "[]"); } catch (_) { return ""; }
    if (!Array.isArray(arr) || !arr.length) return "";
    var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    var t0 = midnight.getTime(), today = 0, i;
    for (i = 0; i < arr.length; i++) if (arr[i] && arr[i].ts >= t0) today++;
    /* Milestones speak on the exact number, so they land as "you just did that"
       rather than as a badge you are permanently wearing. */
    var total = arr.length;
    if (total === 1)   return "You logged your first one. I saw it too. We were both here.";
    if (total === 10)  return "Ten logged. That has stopped being an accident.";
    if (total === 50)  return "Fifty sightings. At this point it is a practice.";
    if (total === 100) return "One hundred. I would like it noted that I was present throughout.";
    if (today >= 3) return pick([
      today + " logged today already. Somebody is having a good one.",
      today + " sightings today. The board is doing its job and so are you.",
    ]);
    return "";
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
  /* mascot.js owns the names now, so the picker and the Spotted card can never
     disagree about who somebody is. The regex stays as a fallback because the
     two files are cache-busted independently: a browser holding an older
     mascot.js should get "Fox" rather than a crash. */
  function nameOf(src) {
    try { if (window.TBMascot && TBMascot.meta) return TBMascot.meta(src).name; } catch (_) {}
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
    /* Roughly: things true about right now, then things true about here, then
       the general stock. One roll drives the whole cascade, so the shares are
       fixed rather than compounding — and a tier that has nothing to say falls
       through to the next instead of costing a turn, which is what keeps a
       freshly loaded board from going quiet while its feeds arrive.

       Weighted towards information: roughly three lines in five now carry a
       fact off this screen rather than a remark about it. No single tier is
       large enough to become a habit, though, which is the point of splitting
       the same 60% ten ways — a mascot that ALWAYS reads out the departures
       has become a second departure display, and the board behind it is a far
       better one. Local colour keeps the biggest single share of what is left,
       because a joke about single tracking only lands on the board where it
       happens, and those are the ones people screenshot. */
    var r = Math.random(), t;
    if (r < 0.09) { t = alertLine();   if (t) return t; }   // what is actually wrong
    if (r < 0.20) { t = boardLine();   if (t) return t; }   // what is leaving, now
    if (r < 0.28) { t = commuteLine(); if (t) return t; }   // your stop, your walk
    if (r < 0.36) { t = waitLine();    if (t) return t; }   // what normal looks like here
    if (r < 0.42) { t = skyLine();     if (t) return t; }   // where that aircraft is going
    if (r < 0.46) { t = subjectLine(); if (t) return t; }   // whose aircraft it is
    if (r < 0.51) { t = rareLine();    if (t) return t; }   // the day's best sighting
    if (r < 0.55) { t = mixLine();     if (t) return t; }   // what the board is holding
    if (r < 0.58) { t = spotLine();    if (t) return t; }   // what you have caught
    if (r < 0.61) { t = learnedLine(); if (t) return t; }   // what it has learned here
    var v = currentVoice();
    if (v && v.own && r < 0.72) return pick(v.own);         // whoever is standing there
    var loc = localLines();
    if (loc && r < 0.90) return pick(loc);
    if (r < 0.95) return pick(SAY.song);
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
      /* Who is talking. The cast rotates on every line, and without a name the
         three voices read as one character with an inconsistent mood. Set in
         the utility face at caption size so it labels the line rather than
         competing with it. */
      "#tbBuddy .bub .nm{display:block;margin:0 0 4px;",
        "font:700 9px/1 'IBM Plex Mono',ui-monospace,monospace;",
        "letter-spacing:.13em;text-transform:uppercase;color:#6E6A78}",
      /* A small jump on the beat of speaking. Across a room the bubble's text
         is unreadable and the movement is not, so this is the only part of a
         remark that carries at wall-display distance. */
      "@keyframes tb-hop{0%{transform:translateY(0)}28%{transform:translateY(-7px)}",
        "52%{transform:translateY(0)}70%{transform:translateY(-3px)}100%{transform:translateY(0)}}",
      "#tbBuddy .fig.hop{animation:tb-hop .52s ease-out}",
      /* Dozing: a slow breath and a zzz, no chatter. See the small-hours note. */
      "@keyframes tb-doze{0%,100%{transform:translateY(0) scale(1)}",
        "50%{transform:translateY(1.5px) scale(.985)}}",
      "#tbBuddy.dozing .fig{animation:tb-doze 4.4s ease-in-out infinite;opacity:.7}",
      "#tbBuddy .zzz{pointer-events:none;position:absolute;left:40px;bottom:56px;opacity:0;",
        "font:700 12px/1 'IBM Plex Mono',ui-monospace,monospace;color:#FFFCF5;",
        "text-shadow:0 2px 6px rgba(0,0,0,.65);transition:opacity .5s ease}",
      "@keyframes tb-float{0%,100%{transform:translateY(0);opacity:.22}",
        "50%{transform:translateY(-7px);opacity:.7}}",
      "#tbBuddy.dozing .zzz{animation:tb-float 3.6s ease-in-out infinite}",
      "@media (max-width:600px){#tbBuddy .fig img,#tbBuddy .fig svg{width:44px;height:52px}",
        "#tbBuddy .bub{font-size:12px;max-width:62vw}}",
      "@media (prefers-reduced-motion:reduce){#tbBuddy .fig,#tbBuddy .bub{transition:none}",
        "#tbBuddy .fig.hop,#tbBuddy.dozing .fig,#tbBuddy.dozing .zzz{animation:none}}",
      /* Printing a wall display should not print a cartoon. */
      "@media print{#tbBuddy{display:none}}",
    ].join("");
    (document.head || document.documentElement).appendChild(css);
  }

  var root, figure, bubble, textEl, nameEl, zzz, picker, hideTimer, idleTimer,
      dozeTimer, charIndex = 0;

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
    // Hovering should say who this one is, not only that it is clickable.
    var nm = currentName();
    figure.title = nm ? nm + " — say something" : "Say something";
    figure.setAttribute("aria-label", nm ? nm + " — click for a remark"
                                         : "Mascot — click for a remark");
  }

  function say(text, ms) {
    if (!root || !text) return;
    /* Recomputed on every line rather than once at build. Sky view is still
       laying itself out when this script runs — measured once at build the
       footer was 60px higher than it ended up, and the bubble sat 9px into the
       credits. Speaking is exactly the moment the position has to be right. */
    liftAboveFooter();
    /* Name the speaker. Blank for a customer's own artwork, which has no name
       we could honestly print — an unlabelled bubble is better than a wrong
       one. */
    if (nameEl) {
      var who = currentName();
      nameEl.textContent = who;
      nameEl.style.display = who ? "" : "none";
    }
    textEl.textContent = text;
    root.classList.add("talking");
    hop();
    clearTimeout(hideTimer);
    // Long lines get longer on screen — read speed, not a fixed guess.
    hideTimer = setTimeout(hush, ms || Math.max(4200, Math.min(11000, text.length * 78)));
  }
  function hush() { if (root) root.classList.remove("talking"); }

  function hop() {
    if (!figure) return;
    figure.classList.remove("hop");
    void figure.offsetWidth;        // force a reflow, or a second hop is ignored
    figure.classList.add("hop");
  }

  /* ---- the small hours ---------------------------------------------------
     These boards run all night, and a character telling jokes at 3am to an
     empty hallway is the thing that gets it unplugged. Between 2 and 5 it
     dozes: no idle chatter, a slow breath, a zzz. That is manners rather than
     power saving — and on a screen somebody walks past at night it is the one
     behaviour they will actually notice.

     Poking wakes it, and it stays awake for a few minutes afterwards, because
     someone who came over to prod a sleeping penguin at 3am has earned a
     reply. */
  var lastPoke = 0;
  function dozing() {
    var h = new Date().getHours();
    return h >= 2 && h < 5 && Date.now() - lastPoke > 240000;
  }
  function refreshDoze() {
    if (!root) return;
    if (dozing()) root.classList.add("dozing");
    else root.classList.remove("dozing");
  }

  function poke() {
    clicks++;
    lastPoke = Date.now();
    /* Tapping a sleeping mascot and having it carry on sleeping is not a
       charming detail, it is a broken button. Waking is the whole reply — the
       character stays the same one, because you woke THAT one. */
    if (root && root.classList.contains("dozing")) {
      root.classList.remove("dozing");
      var v = currentVoice();
      say(pick(v && v.wake ? v.wake : ["Awake. Barely."]));
      schedule();
      return;
    }
    charIndex++;                         // a poke also changes who is standing there
    drawCharacter();
    say(nextLine(true));
    schedule();                          // reset the idle clock; you just heard from it
  }

  function schedule() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function tick() {
      if (document.visibilityState === "visible" && !off() && !dozing()) {
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
    /* A footer BELOW the fold cannot be underneath anything, and the city
       boards have one: they are fixed-height layouts that scroll inside a
       child, so documentElement.scrollHeight equals innerHeight — `scrolls` is
       false — while the real footer sits thousands of pixels further down. That
       combination sent the lift the other way and parked the mascot 3,700px
       below the screen, which is why it has not been visible on a board.

       Two guards, because either alone leaves a hole: ignore a footer that
       starts past the bottom edge, and never lift so far that the character
       leaves the viewport by the top. A mascot in the wrong corner is a bug
       you can see; one outside the document is a feature nobody knew shipped. */
    if (r.top >= window.innerHeight) { root.style.bottom = ""; return; }
    var lift = Math.round(window.innerHeight - r.top + 8);
    root.style.bottom = Math.max(0, Math.min(lift, Math.round(window.innerHeight * 0.5))) + "px";
  }

  function dismiss() {
    say(pick(SAY.dismissed), 2200);
    setOff(true);
    setTimeout(function () {
      if (root) root.remove();
      root = null; clearTimeout(idleTimer); clearInterval(dozeTimer);
    }, 2400);
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
    nameEl = document.createElement("span");
    nameEl.className = "nm";
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

    bubble.appendChild(nameEl);
    bubble.appendChild(textEl);
    bubble.appendChild(who);
    bubble.appendChild(x);

    picker = document.createElement("div");
    picker.className = "pick";
    picker.setAttribute("role", "group");
    picker.setAttribute("aria-label", "Choose your guide");

    zzz = document.createElement("div");
    zzz.className = "zzz";
    zzz.textContent = "z z z";
    zzz.setAttribute("aria-hidden", "true");   // decoration; the doze is not news

    root.appendChild(figure);
    root.appendChild(zzz);
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

    /* The greeting is the first thing anybody hears, so it is the one line
       that should be in the speaker's own voice rather than the house one.
       SAY.hello stays as the fallback for artwork we have no character for. */
    setTimeout(function () {
      if (!root || off() || dozing()) return;
      var v = currentVoice();
      say(pick(v && v.hello ? v.hello : SAY.hello));
    }, FIRST_MS);
    schedule();
    refreshDoze();
    // Checked on a slow clock so a board left up overnight nods off and wakes
    // again on its own, with a timer nowhere near frequent enough to matter.
    dozeTimer = setInterval(refreshDoze, 60000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();

  window.TBBuddy = {
    say: say,
    poke: poke,
    hide: function () { setOff(true); if (root) { root.remove(); root = null; }
                        clearTimeout(idleTimer); clearInterval(dozeTimer); },
    who: currentName,
    show: function () { setOff(false); build(); },
    lines: function () { return JSON.parse(JSON.stringify(SAY)); },
  };
})();
