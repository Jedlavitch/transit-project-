/* ============================================================================
   interesting.js — the day's most interesting plane or train, per city.

   WHAT IT DOES
     Watches whatever a board is already showing, scores each aircraft and train
     for how unusual it is, and keeps the day's best in localStorage. One script
     tag per board, no per-city code, no network of its own: everything scored
     here was already fetched and rendered by the board a moment earlier.

   WHY RARITY IS LEARNED, NOT LISTED
     A hardcoded "rare aircraft" table would work in Washington and be nonsense
     in Cologne, where the interesting thing is a tram type nobody outside NRW
     has heard of. So the score has two halves:

       universal  — things that are notable anywhere and need no history:
                    an emergency squawk, an A380, a 90-minute-late train.
       learned    — a per-city registry of what this board has actually seen
                    before. A type or operator or route that has turned up on
                    two days out of thirty is rare HERE, whatever it is.

     The learned half is damped while the registry is young, because on day one
     everything is a first sighting and a leaderboard that says so is worthless.
     It reaches full weight after roughly a week of watching.

   WHERE IT IS KEPT
     tb.leaders.v1      today's top entries, per city
     tb.leaderSeen.v1   the rarity registry: distinct days each token was seen
     tb.leaderArchive.v1  the last 30 winners, so yesterday doesn't vanish
     tb.leaderBlob      optional share code, so several screens pool into one

   Every board is on one origin, so localStorage is already shared between them:
   a screen that shows Washington in the morning and New York at night builds
   the all-cities list for free, with nothing to configure. The share code only
   matters when the screens are different DEVICES.

   Buses and trams-that-are-really-buses are deliberately not scored. The ask
   was planes and trains; including a Metrobus would bury a Zephyr under forty
   ordinary 30-minute headways. `isBusCard()` is the one place that decides.
   ============================================================================ */
(function () {
  "use strict";

  var LS = {
    leaders: "tb.leaders.v1",
    seen:    "tb.leaderSeen.v1",
    archive: "tb.leaderArchive.v1",
    blob:    "tb.leaderBlob",
    hide:    "tb.leaderCardHidden",
    planes:  "tb.leaderPlaneScope"     // "airline" (default) | "all"
  };

  /* WHICH AIRCRAFT COUNT
     Left to itself the scorer keeps handing the day to a police helicopter or a
     survey aircraft, because those genuinely ARE the unusual things overhead —
     and they make a poor post, because nobody outside the county recognises the
     operator and there is no route to tell a story about. So the default is
     scheduled airline flights only: things with a flight number, a city pair
     and a name people know.

     "all" puts the helicopters, bizjets, military and government flights back
     in, which is what an actual plane spotter wants. It is one control on the
     leaderboard page, not a code change. */
  function planeScope() {
    try { return localStorage.getItem(LS.planes) === "all" ? "all" : "airline"; }
    catch (_) { return "airline"; }
  }

  var KEEP_PER_CITY = 12;      // stored per city per day; the page shows 10
  var RESERVE_PER_KIND = 4;    // ...of which each kind is guaranteed this many
  var ARCHIVE_MAX   = 30;      // days of past winners kept
  var SEEN_HALFLIFE = 45;      // days after which a token is forgotten entirely
  var TICK_MS       = 20000;   // scoring pass; the boards refresh on a similar beat
  /* Deliberately low. A board's first week has no history to be rare against,
     so the learned half scores almost nothing and a high floor would leave every
     new board saying "nothing out of the ordinary" for days — the worst possible
     first impression for a feature whose whole pitch is that it watches. The cap
     of twelve per city does the real filtering: rank order is what matters, and
     as the registry matures the genuinely unusual rises past the ordinary on
     its own. */
  var MIN_SCORE     = 3;

  /* How remarkable a NON-airline aircraft must be, on universal signals alone,
     to be scored at all while the default airline-only scope is on. Set between
     a C-17 (36) and a police helicopter (26) — see the long note in collect(). */
  var NON_AIRLINE_BAR = 32;

  /* Cities, in the order the boards' own picker lists them, so the leaderboard
     reads the same way round as the rest of the product. `id` matches the
     ?city= parameter the shared pages (night, flipboard) already use. */
  var CITIES = [
    { file: "dc.html",           id: "dc",        label: "Washington DC" },
    { file: "philadelphia.html", id: "philly",    label: "Philadelphia"  },
    { file: "newjersey.html",    id: "nj",        label: "New Jersey"    },
    { file: "nyc.html",          id: "nyc",       label: "New York"      },
    { file: "boston.html",       id: "boston",    label: "Boston"        },
    { file: "amsterdam.html",    id: "amsterdam", label: "Amsterdam"     },
    { file: "losangeles.html",   id: "la",        label: "Los Angeles"   },
    { file: "sanfrancisco.html", id: "sf",        label: "San Francisco" },
    { file: "zurich.html",       id: "zurich",    label: "Zurich"        },
    { file: "cologne.html",      id: "cologne",   label: "Cologne"       },
    { file: "stuttgart.html",    id: "stuttgart", label: "Stuttgart"     }
  ];

  /* ---- which city is this? ------------------------------------------------
     The four boards built from the stencil declare `const CITY_ID`; the three
     older hand-built ones (dc, philadelphia, nyc) never did. A top-level const
     is a lexical binding and NOT a property of window, so it can only be read
     by name inside a try — the same trick spotlog.js uses to reach `state`.
     Filename is the fallback, and it is the more reliable of the two anyway. */
  function whoAmI() {
    var file = (location.pathname.split("/").pop() || "").toLowerCase();
    for (var i = 0; i < CITIES.length; i++) if (CITIES[i].file === file) return CITIES[i];
    try {
      /* eslint-disable-next-line no-undef */
      if (typeof CITY_ID === "string" && CITY_ID) {
        for (var j = 0; j < CITIES.length; j++) if (CITIES[j].id === CITY_ID) return CITIES[j];
        return { file: file, id: CITY_ID, label: CITY_ID };
      }
    } catch (_) {}
    return null;
  }
  var CITY = whoAmI();

  /* ---- letting people get rid of it ---------------------------------------
     Every card that ships in a board's HTML has a "Show on board" checkbox in
     Settings, built from that board's own CARD_DEFS list. A card injected by a
     script is not in that list, so it arrives on the screen with no way to
     remove it — which is not a decision this file gets to make for somebody
     else's kiosk.

     So it registers itself. CARD_DEFS is a top-level const, but an array is
     mutable, and pushing an entry means the checkbox, the saved state and
     applyCardVis()'s existing .user-hidden handling all work with no changes to
     any board. This runs at SCRIPT level rather than in boot(), because the
     boards call buildCardToggles() from their own DOMContentLoaded handler,
     which is registered before ours and therefore runs first — pushing in
     boot() would miss the list on the very load that matters. */
  var HIDE_ID = "leaderCard";

  function registerCardToggle() {
    try {
      /* eslint-disable-next-line no-undef */
      if (typeof CARD_DEFS !== "undefined" && Array.isArray(CARD_DEFS) &&
          !CARD_DEFS.some(function (d) { return d && d.id === HIDE_ID; })) {
        /* eslint-disable-next-line no-undef */
        CARD_DEFS.push({ id: HIDE_ID, label: "Today's best" });
        return true;
      }
    } catch (_) {}
    return false;
  }
  var REGISTERED = CITY ? registerCardToggle() : false;

  /* The board's own hidden-cards set when there is one — its key is namespaced
     per board (transitboard.hiddenCards, transitboardphl.hiddenCards, …) and
     loadHiddenCards() already knows which. The private key is the fallback for
     a board that has no CARD_DEFS at all. */
  function hiddenNow() {
    try {
      /* eslint-disable-next-line no-undef */
      if (REGISTERED && typeof loadHiddenCards === "function") return loadHiddenCards().has(HIDE_ID);
    } catch (_) {}
    try { return localStorage.getItem(LS.hide) === "1"; } catch (_) { return false; }
  }

  function setHidden(on) {
    var done = false;
    try {
      /* eslint-disable-next-line no-undef */
      if (REGISTERED && typeof loadHiddenCards === "function") {
        /* eslint-disable-next-line no-undef */
        var h = loadHiddenCards();
        if (on) h.add(HIDE_ID); else h.delete(HIDE_ID);
        /* Write through the same namespaced key the board reads. Derived from
           its own loader rather than guessed, so a city added later cannot
           end up writing to the wrong board's settings. */
        var key = boardHiddenKey();
        /* Array.from, not slice.call: loadHiddenCards() returns a Set, which is
           iterable but NOT array-like, so slice.call() on it yields [] — which
           wrote an empty hidden-list and left the card stubbornly on screen. */
        if (key) { localStorage.setItem(key, JSON.stringify(Array.from(h))); done = true; }
        /* eslint-disable-next-line no-undef */
        if (typeof applyCardVis === "function") applyCardVis();
        /* eslint-disable-next-line no-undef */
        if (typeof buildCardToggles === "function") buildCardToggles();
      }
    } catch (_) {}
    if (!done) {
      try { localStorage.setItem(LS.hide, on ? "1" : "0"); } catch (_) {}
      var el = document.getElementById(HIDE_ID);
      if (el) el.classList.toggle("user-hidden", on);
    }
  }

  function boardHiddenKey() {
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (/^transitboard[a-z]*\.hiddenCards$/.test(k)) return k;
      }
    } catch (_) {}
    /* Nothing saved yet on this board, so derive the namespace from another key
       it definitely owns (every board writes its own .loc or .theme eventually);
       failing that, fall back to the private flag by returning "". */
    try {
      for (var j = 0; j < localStorage.length; j++) {
        var m = /^(transitboard[a-z]*)\./.exec(localStorage.key(j));
        if (m) return m[1] + ".hiddenCards";
      }
    } catch (_) {}
    return "";
  }

  /* ---- storage ------------------------------------------------------------
     Every read is defensive. A kiosk that has been running for months will hit
     a full quota or a half-written value eventually, and a leaderboard is not
     worth taking a board down for. */
  function read(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key) || "null"); return v == null ? fallback : v; }
    catch (_) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch (_) { return false; }
  }

  /* The day boundary is the viewing device's local midnight, not UTC. A board
     in Los Angeles rolling over at 5pm because London did would be absurd. */
  function today(d) {
    d = d || new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") +
           "-" + String(d.getDate()).padStart(2, "0");
  }
  function daysBetween(a, b) {
    var t1 = Date.parse(a + "T00:00:00"), t2 = Date.parse(b + "T00:00:00");
    if (!isFinite(t1) || !isFinite(t2)) return 0;
    return Math.round((t2 - t1) / 86400000);
  }

  /* ---- the rarity registry ------------------------------------------------
     Keyed by city, then by token ("type:A388", "op:Emirates", "route:Empire
     Builder"). What is stored is the number of DISTINCT DAYS the token has been
     seen, not the number of sightings: an aircraft that loiters over the city
     for an hour would otherwise teach the board that its type is common, which
     is the exact opposite of the truth. */
  function seenAll() { return read(LS.seen, {}); }
  function seenCity(reg, city) { return (reg[city] = reg[city] || {}); }

  function noteSeen(reg, city, tokens, day) {
    var c = seenCity(reg, city), changed = false;
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (!t) continue;
      var rec = c[t];
      if (!rec) { c[t] = { d: 1, last: day, first: day }; changed = true; continue; }
      if (rec.last !== day) { rec.d = (rec.d || 0) + 1; rec.last = day; changed = true; }
    }
    return changed;
  }

  /* How much history has this city accumulated? Used to damp the learned half
     of the score: with three days of watching, "never seen before" means
     "the board only started on Tuesday". */
  /* THE FLOOR MATTERS MORE THAN THE RAMP. Damping to literally zero on a new
     board did not make the leaderboard humble, it made it wrong: every learned
     signal vanished, and since ordinary airliners have almost no history-free
     signal while every Amtrak train has a named-service or lateness bonus, the
     card filled with trains on all eleven boards. "The first A380 this board has
     shown" is TRUE on day one — it is merely less impressive than it will be in
     a month. So scale it down, never out. */
  function maturity(c) {
    var days = {}, n = 0;
    for (var t in c) { if (c[t] && c[t].last) { days[c[t].last] = 1; n++; } }
    var distinct = Object.keys(days).length;
    var ramp = Math.min(1, Math.min(distinct / 4, n / 80));   // full confidence sooner
    return Math.max(0.28, ramp);                              // and never nothing
  }

  /* Drop tokens nothing has seen in a month and a half, so the registry cannot
     grow without bound on a screen that runs for years. */
  function prune(reg, day) {
    for (var city in reg) {
      var c = reg[city];
      for (var t in c) if (daysBetween(c[t].last, day) > SEEN_HALFLIFE) delete c[t];
    }
  }

  /* Rarity of one token, 0..1, where 1 is "this board has never shown it". */
  function rarity(c, token) {
    var rec = c[token];
    if (!rec) return 1;
    if (rec.d <= 1) return 0.75;
    if (rec.d <= 2) return 0.55;
    if (rec.d <= 4) return 0.35;
    if (rec.d <= 8) return 0.18;
    return 0.05;
  }

  /* ============================ SCORING ==================================
     Each signal contributes a weight AND a sentence. The sentence is the point:
     a leaderboard that says "score 84" tells you nothing, and one that says
     "first Antonov this board has ever shown, and it's squawking 7700" is the
     thing worth putting on a screen. Reasons are sorted by weight and the top
     few are what gets displayed and posted. */

  function push(rs, w, text) { if (w > 0) rs.push({ w: Math.round(w), t: text }); }

  /* -- aircraft that are notable anywhere ---------------------------------
     Deliberately short. This list is for types a person would cross a road to
     look at regardless of where they live; everything else is left to the
     learned half, which knows what is normal at THIS board. */
  var PLANE_TYPES = {
    A388: [46, "an Airbus A380 — the biggest airliner flying"],
    A124: [58, "an Antonov An-124 heavy lifter"], AN24: [30, "an Antonov An-24"],
    A225: [95, "the Antonov An-225"],
    B741: [44, "an early Boeing 747"], B742: [44, "a Boeing 747-200"],
    B743: [44, "a Boeing 747-300"], B744: [38, "a Boeing 747-400"],
    B748: [36, "a Boeing 747-8"], B74S: [46, "a shortened Boeing 747SP"],
    BLCF: [52, "a Boeing Dreamlifter"], A337: [46, "an Airbus Beluga"],
    A3ST: [52, "an Airbus Beluga"],
    MD11: [42, "an MD-11 — nearly all of them are freighters now"],
    DC10: [46, "a DC-10"], L101: [52, "a Lockheed TriStar"],
    B703: [55, "a Boeing 707"], CONC: [99, "Concorde"],
    A342: [34, "an Airbus A340"], A343: [34, "an Airbus A340"],
    A345: [40, "an A340-500"], A346: [40, "an A340-600"],
    C17:  [36, "a C-17 Globemaster"], C5M: [48, "a C-5 Galaxy"],
    B52:  [58, "a B-52"], E3TF: [46, "an E-3 Sentry AWACS"], E3CF: [46, "an E-3 Sentry"],
    E6:   [52, "an E-6 Mercury"], K35R: [30, "a KC-135 tanker"], KC35: [30, "a KC-135 tanker"],
    K35E: [30, "a KC-135 tanker"], KC46: [32, "a KC-46 tanker"], KC10: [38, "a KC-10 tanker"],
    P8:   [30, "a P-8 Poseidon"], C130: [24, "a C-130 Hercules"], C30J: [24, "a C-130J"],
    U2:   [72, "a U-2 — they are rarely visible at all"],
    B461: [26, "a BAe 146"], B462: [26, "a BAe 146"], B463: [26, "a BAe 146"],
    /* pre-war and post-war survivors: if one of these is overhead, it is an
       airshow transit and there is nothing else on the board to touch it */
    DC3:  [64, "a Douglas DC-3"], C47:  [64, "a Douglas C-47"],
    DC6:  [62, "a Douglas DC-6"], CVLT: [52, "a Convair"],
    B17:  [78, "a B-17 Flying Fortress"], B25: [72, "a B-25 Mitchell"],
    P51:  [68, "a P-51 Mustang"], SPIT: [78, "a Spitfire"],
    T6:   [46, "a T-6 Texan"], AN2:  [52, "an Antonov An-2 biplane"],
    JU52: [82, "a Junkers Ju 52"], LANC: [88, "an Avro Lancaster"]
  };

  /* Callsign prefixes that say what a flight IS when the type does not.
     Matched on the alphabetic head of the callsign, longest first. */
  var CALLSIGN_TAGS = [
    ["RCH",     34, "a US Air Force Reach cargo flight"],
    ["SAM",     58, "a Special Air Mission — US government VIP"],
    ["EXEC1",   95, "Air Force One"],
    ["VENUS",   62, "a UK royal or ministerial flight"],
    ["KITTY",   40, "a US Air Force training flight"],
    ["DOOM",    56, "a US bomber mission callsign"],
    ["JAKE",    40, "a US Air Force tanker"],
    ["PAT",     38, "US Army Priority Air Transport"],
    ["NAVY",    38, "a US Navy aircraft"],
    ["ARMY",    36, "a US Army aircraft"],
    ["CNV",     34, "a US Navy logistics flight"],
    ["EVAC",    52, "an aeromedical evacuation flight"],
    ["LIFEGUARD", 48, "a Lifeguard flight — a medical priority"],
    ["MEDEVAC", 48, "a medical evacuation"],
    ["ANGEL",   40, "an air-ambulance flight"],
    ["COAST",   40, "a Coast Guard aircraft"],
    ["RESCUE",  46, "a search-and-rescue flight"],
    ["FIREBIRD",38, "a firefighting aircraft"],
    ["TANKER",  36, "an air tanker"]
  ];

  /* Named Amtrak services worth remarking on, and WHY each one is — the wording
     matters, because a leaderboard that calls a Northeast Regional "one of the
     long-distance trains" is simply wrong, and wrong in a way anyone who knows
     the corridor will spot immediately. The Regional is not in this table at
     all: it is the most ordinary train on the busiest line in the country, and
     scoring it at all would be backwards. */
  var NAMED_TRAINS = {
    /* Priced by HOW OFTEN THE SERVICE RUNS, which is what makes a sighting
       rare. Three-a-week trains sit at the top; once-daily around 20; and the
       Acela sits near the bottom despite being the famous one, because roughly
       twenty round trips a weekday pass through a 60-mile radius almost
       continuously on five of these boards. It kept winning for being famous
       rather than for being unusual, which is the opposite of the job. The
       sentence stays — it is still the fastest train in the country — it just
       does not out-point an aeroplane for turning up. */
    "empire builder":      [40, "one of the long-distance trains — Chicago to the Pacific Northwest"],
    "california zephyr":   [42, "one of the long-distance trains — Chicago to San Francisco Bay"],
    "southwest chief":     [40, "one of the long-distance trains — Chicago to Los Angeles"],
    "sunset limited":      [44, "the least frequent long-distance train in the country"],
    "texas eagle":         [38, "a long-distance train, Chicago to San Antonio"],
    "coast starlight":     [38, "a long-distance train, Seattle to Los Angeles"],
    "lake shore limited":  [32, "an overnight long-distance train to Chicago"],
    "capitol limited":     [30, "an overnight long-distance train to Chicago"],
    "cardinal":            [36, "a long-distance train, and only three days a week"],
    "city of new orleans": [34, "an overnight long-distance train"],
    "crescent":            [32, "an overnight long-distance train, New York to New Orleans"],
    "silver star":         [30, "an overnight long-distance train to Florida"],
    "silver meteor":       [30, "an overnight long-distance train to Florida"],
    "floridian":           [34, "a long-distance train to Florida"],
    "auto train":          [34, "the Auto Train — it carries its passengers' cars"],
    "palmetto":            [20, "a long-distance daytime train to Savannah"],
    "adirondack":          [26, "a scenic long-distance train toward Montreal"],
    "maple leaf":          [24, "a cross-border train to Toronto"],
    "ethan allen express": [20, "a long-distance train into Vermont"],
    "vermonter":           [22, "a long-distance train into Vermont"],
    "borealis":            [22, "one of the newest long-distance services"],
    "pennsylvanian":       [18, "a daily through train over the Alleghenies"],
    /* An Acela is the fastest train in the country and also runs many times a
       day past every board on the corridor. Worth naming, not worth winning. */
    "acela":               [10, "the Acela — the fastest train in the country"]
  };

  /* Operators that make an aircraft interesting whatever it is. A county police
     helicopter is a more unusual thing to have overhead than another A319, and
     no amount of learned rarity gets there on day one. */
  var AGENCY_OPERATOR = /\b(police|sheriff|state patrol|highway patrol|county of|city of|air force|army|navy|marine corps|coast guard|customs|border|nasa|noaa|forest service|fire|ambulance|air ambulance|medstar|life ?flight|national guard)\b/i;

  /* Widebodies, by ICAO type. Two aisles is the most visible difference there
     is between one airliner and another from the ground, so it belongs in a
     leaderboard about what KIND of aeroplane went over. */
  var WIDEBODY = /^(A30B|A306|A310|A30F|A332|A333|A337|A338|A339|A33F|A342|A343|A345|A346|A359|A35K|A358|A388|B742|B743|B744|B748|B74S|B74F|B762|B763|B764|B772|B773|B77W|B77L|B77F|B788|B789|B78X|IL96|MD11|DC10|L101|A124|A225|C5M|C17)$/;

  function num(v) { return typeof v === "number" && isFinite(v) ? v : null; }
  function clean(s) { return String(s == null ? "" : s).trim(); }

  /* The ADS-B description arrives shouting — "BOEING 737 MAX 8", "BOMBARDIER
     Regional Jet CRJ-700". That is fine in a dense board row and wrong as the
     headline of a share card, so manufacturer words get title-cased while short
     all-caps tokens (MAX, CRJ-700, A-319) are left exactly as they are, because
     those are how the type is actually written. */
  function tidy(s) {
    return clean(s).split(" ").map(function (w) {
      if (w.length > 3 && w === w.toUpperCase() && /^[A-Z]+$/.test(w))
        return w.charAt(0) + w.slice(1).toLowerCase();
      return w;
    }).join(" ");
  }
  function titleOf(a) { return tidy(a.desc) || clean(a.t) || "Aircraft"; }

  /* "a Acela" and "an B429" are the kind of thing that makes a generated
     sentence read as generated. */
  function article(word) {
    var w = clean(word);
    if (!w) return "a";
    var first = w.charAt(0).toUpperCase();
    /* Letters that are SAID with a leading vowel take "an" even though they are
       consonants — an A319, an F-16, an MD-11, an L-1011. */
    if (/^[AEIOU]/.test(first)) return "an";
    if (/^[FHLMNRSX]$/.test(first) && w.length > 1 && !/^[a-z]/.test(w.charAt(1))) return "an";
    return "a";
  }

  /* The operator, preferring the board's own resolver — it reads the airline
     out of the cached adsbdb answer, which is the only thing that stops an
     American Airlines jet reading as "Wilmington Trust Trustee". */
  function operator(a) {
    try { /* eslint-disable-next-line no-undef */
      if (typeof operatorFor === "function") { var s = clean(operatorFor(a)); if (s) return s; }
    } catch (_) {}
    return clean(a.ownOp) || "";
  }
  function routeOf(a) {
    try { /* eslint-disable-next-line no-undef */
      if (typeof routeFor === "function") return routeFor(a) || null;
    } catch (_) {}
    return null;
  }

  /* Rotorcraft, by the ADS-B emitter category first — "A7" is the field's own
     answer and does not depend on guessing from a model name. The type list is
     the fallback for feeds that omit the category, and covers the machines that
     actually orbit a city: police, air ambulance, news, tour. */
  var HELI_TYPES = /^(B06|B07|B27|B29|B37|B39|B42|B429|B430|B47|EC[0-9]|EC[35]\d|H[0-9]{2}|A109|A119|A139|A169|A189|AS[0-9]{2}|AS3[25]|R22|R44|R66|S76|S92|S64|UH1|H60|H500|MD5\d|MD90|GAZL|EN28|EXPL|NH90|TIGR)/;
  function isRotor(a) {
    if (clean(a.category).toUpperCase() === "A7") return true;
    return HELI_TYPES.test(clean(a.t).toUpperCase());
  }

  /* A scheduled airline flight: an ICAO callsign (three letters then a flight
     number) that is not one of the military or state prefixes above, flown by
     something that is not a helicopter. A tail number in the callsign field —
     N212FX — is general aviation and fails the pattern by design. */
  function isAirlineFlight(a, op) {
    var cs = clean(a.flight).toUpperCase();
    if (!/^[A-Z]{3}\d{1,4}[A-Z]?$/.test(cs)) return false;
    if (isRotor(a)) return false;
    for (var i = 0; i < CALLSIGN_TAGS.length; i++)
      if (cs.indexOf(CALLSIGN_TAGS[i][0]) === 0) return false;
    if (op && AGENCY_OPERATOR.test(op) && !/airlines|airways|air lines/i.test(op)) return false;
    return true;
  }

  function nmBetween(a, b) {
    var R = 3440.065, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function scorePlane(a, c, mat) {
    var rs = [], t = clean(a.t).toUpperCase(), cs = clean(a.flight).toUpperCase();
    var op = operator(a), rt = routeOf(a);

    /* --- universal ----------------------------------------------------- */
    var sq = clean(a.squawk);
    if (sq === "7700") push(rs, 62, "squawking 7700 — a general emergency");
    else if (sq === "7600") push(rs, 56, "squawking 7600 — radio failure");
    else if (sq === "7500") push(rs, 72, "squawking 7500 — unlawful interference");
    var em = clean(a.emergency).toLowerCase();
    if (em && em !== "none") push(rs, 50, "declaring an emergency");

    if (PLANE_TYPES[t]) push(rs, PLANE_TYPES[t][0], PLANE_TYPES[t][1]);

    var head = (cs.match(/^[A-Z]+/) || [""])[0];
    for (var i = 0; i < CALLSIGN_TAGS.length; i++) {
      if (head === CALLSIGN_TAGS[i][0] || cs.indexOf(CALLSIGN_TAGS[i][0]) === 0) {
        push(rs, CALLSIGN_TAGS[i][1], CALLSIGN_TAGS[i][2]); break;
      }
    }

    var yr = parseInt(a.year, 10);
    if (yr && yr < 1970) push(rs, 46, "built in " + yr);
    else if (yr && yr < 1985) push(rs, 26, "built in " + yr);
    else if (yr && yr < 1995) push(rs, 12, "built in " + yr);

    /* SIZE IS PART OF THE TYPE. A widebody is a visibly different aeroplane
       from the narrowbodies that make up almost all traffic, and at most of
       these boards it is genuinely the unusual sight — but it is not in the
       universal table, because a widebody over JFK is Tuesday. So it scores
       modestly on its own and lets the learned half decide how odd it is HERE. */
    if (WIDEBODY.test(t)) push(rs, 18, "a widebody — " + shortType(a));

    /* Kinematics deliberately score low. Altitude and speed say what a flight
       is doing, not what it IS, and this leaderboard is about the aeroplane. */
    var alt = num(a.alt_baro);
    if (alt != null && alt >= 45000) push(rs, 12, "cruising at " + alt.toLocaleString() + " ft, above the airliners");
    else if (alt != null && alt > 0 && alt < 900) push(rs, 8, "low overhead at " + alt.toLocaleString() + " ft");

    var gs = num(a.gs);
    if (gs != null && gs >= 540) push(rs, 8, Math.round(gs) + " kt over the ground");

    if (rt && rt.from && rt.to) {
      var leg = null;
      if (num(rt.flat) != null && num(rt.tlat) != null)
        leg = nmBetween({ lat: rt.flat, lon: rt.flon }, { lat: rt.tlat, lon: rt.tlon });
      if (leg != null && leg >= 3400) push(rs, 18, "flying " + rt.from + " to " + rt.to + ", " + Math.round(leg).toLocaleString() + " nm");
      else if (leg != null && leg >= 1900) push(rs, 9, "a long haul, " + rt.from + " to " + rt.to);
    }

    /* An agency aircraft is interesting from the first day, before the board
       has learned anything — which is the gap the learned half cannot fill. */
    if (op && AGENCY_OPERATOR.test(op) && !/airlines|airways|air lines/i.test(op))
      push(rs, 26, "operated by " + op + ", not an airline");

    /* --- learned --------------------------------------------------------
       THE TWO THINGS THIS LEADERBOARD IS ABOUT.

       Type carries the most weight of anything learned: an aeroplane this board
       has not shown before is the answer to "what was the most interesting
       thing today", far more than how fast it was going.

       Operator is the closest thing to a LIVERY signal that exists. No feed
       broadcasts paint — ADS-B carries a type code, a registration and a
       callsign, and nothing about what the aircraft looks like. What it does
       carry is who operates it, and an airline this board rarely sees is a
       colour scheme rarely seen over this city, which is the same sighting.
       Said that way in the reason text, because claiming to detect a special
       livery would be inventing a capability. The photograph is where the paint
       actually gets seen, which is why the card leads with one. */
    /* Everything pushed up to HERE is universal — true of the aeroplane itself,
       needing no history. What follows is learned. The split is recorded so the
       non-airline admission gate below can ask "is this remarkable in itself?"
       rather than "is this merely unfamiliar?", which on a young board is a
       question every aircraft answers yes to. */
    var universal = 0;
    for (var u = 0; u < rs.length; u++) universal += rs[u].w;

    if (t) push(rs, 52 * rarity(c, "type:" + t) * mat, rarePhrase(c, "type:" + t, shortType(a), true));
    if (op) push(rs, 34 * rarity(c, "op:" + op) * mat,
                 rarePhrase(c, "op:" + op, op + " colours over this board", false));

    return finish(rs, {
      uni: Math.round(universal),
      id: "plane:" + (clean(a.hex) || cs || clean(a.r)),
      kind: "plane",
      title: titleOf(a),
      sub: [op, cs || clean(a.r)].filter(Boolean).join(" · "),
      detail: planeDetail(a, rt),
      hex: clean(a.hex).toLowerCase(),
      /* Two ways to find a picture, because they answer different questions.
         `hex` gets the EXACT airframe from planespotters. `photoQuery` gets a
         representative photo of the type from Wikimedia Commons — less precise,
         but CORS-open, which is what a canvas needs to stay exportable. */
      photoQuery: [op, tidy(a.desc) || clean(a.t)].filter(Boolean).join(" ").trim(),
      lat: num(a.lat), lon: num(a.lon)
    });
  }

  /* Total the weights, then keep only the reasons worth reading. A "+1 only the
     3rd day with a service to New York Penn" is true, contributes almost
     nothing, and crowds out the reason the thing actually won — so it counts
     toward the score and stays out of the sentence list. */
  function finish(rs, entry) {
    var total = 0;
    for (var k = 0; k < rs.length; k++) total += rs[k].w;
    rs.sort(function (x, y) { return y.w - x.w; });
    var shown = rs.filter(function (r) { return r.w >= 4; });
    if (!shown.length && rs.length) shown = rs.slice(0, 1);
    entry.score = Math.round(total);
    entry.reasons = shown.slice(0, 4);
    return entry;
  }

  function shortType(a) { return tidy(a.desc) || clean(a.t) || "aircraft"; }

  function ord(n) {
    if (n % 100 >= 11 && n % 100 <= 13) return n + "th";
    return n + ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th");
  }

  /* One sentence saying how unusual a thing is HERE. `useArticle` is off for
     proper nouns — "only the 2nd day with a PSA Airlines" is not English. */
  function rarePhrase(c, token, subject, useArticle) {
    var rec = c[token], art = useArticle ? article(subject) + " " : "";
    if (!rec) return "the first " + subject + " this board has shown";
    if (rec.d <= 2) return "only the " + ord(rec.d + 1) + " day with " + art + subject;
    return art + subject + ", which is rare here";
  }

  function planeDetail(a, rt) {
    var bits = [];
    if (rt && rt.from && rt.to) bits.push(rt.from + " → " + rt.to);
    var alt = num(a.alt_baro);
    if (alt != null) bits.push(alt.toLocaleString() + " ft");
    var gs = num(a.gs);
    if (gs != null) bits.push(Math.round(gs) + " kt");
    return bits.join(" · ");
  }

  /* -- Amtrak ------------------------------------------------------------- */
  function nextStop(t) {
    var st = t && t.stations;
    if (!st || !st.length) return null;
    for (var i = 0; i < st.length; i++) {
      var s = st[i];
      if (s && (s.status === "Enroute" || s.status === "Station")) return s;
    }
    return st[st.length - 1] || null;
  }

  function scoreAmtrak(rec, c, mat) {
    var t = rec.t || rec, rs = [];
    var route = clean(t.routeName), dest = clean(t.destName), numTrain = clean(t.trainNum);
    var key = route.toLowerCase().replace(/\s+service$/, "");

    if (NAMED_TRAINS[key]) push(rs, NAMED_TRAINS[key][0], NAMED_TRAINS[key][1]);

    var late = null;
    try { if (typeof window.amtrakLateMin === "function") late = window.amtrakLateMin(nextStop(t)); } catch (_) {}
    /* LATENESS WAS OVER-REWARDED, and it is why the card filled with trains.
       A late train is common, not interesting — the Northeast Corridor produces
       one every hour — and at +22 for merely 45 minutes down it outscored every
       aircraft in the sky. Only a genuinely extraordinary delay says anything. */
    if (late != null && late >= 180) push(rs, 26, "running " + Math.round(late / 60) + " hours late");
    else if (late != null && late >= 90) push(rs, 16, late + " minutes late");
    else if (late != null && late >= 45) push(rs, 8, late + " minutes late");
    else if (late != null && late <= -10) push(rs, 6, Math.abs(late) + " minutes early");

    /* Same reasoning: 100 mph is simply what a train on this corridor does. */
    var v = num(t.velocity);
    if (v != null && v >= 125) push(rs, 14, "doing " + Math.round(v) + " mph");
    else if (v != null && v >= 100) push(rs, 6, "doing " + Math.round(v) + " mph");

    if (route) push(rs, 30 * rarity(c, "route:" + route) * mat, rarePhrase(c, "route:" + route, route, false) + " on this board");
    if (dest) push(rs, 14 * rarity(c, "dest:" + dest) * mat, rarePhrase(c, "dest:" + dest, "service to " + dest, false));

    return finish(rs, {
      id: "amtrak:" + numTrain,
      kind: "train",
      title: route ? route + " " + numTrain : "Amtrak " + numTrain,
      sub: dest ? "to " + dest : "Amtrak",
      detail: [rec.distMi != null ? Math.round(rec.distMi) + " mi away" : "",
               v != null ? Math.round(v) + " mph" : "",
               late != null && late > 0 ? "+" + late + " min" : ""].filter(Boolean).join(" · "),
      photoQuery: route ? "Amtrak " + route + " train" : "Amtrak train",
      lat: num(t.lat), lon: num(t.lon)
    });
  }

  /* -- everything else, read off the board's own rows ----------------------
     Metro, tram, subway, regional rail: eleven boards' worth of systems, each
     with its own fetch path and none with a shared in-memory shape. What they
     DO share is the rendered row — badge, destination, sub-line — because every
     card on every board is built by the same `el("div","row")` pattern. Reading
     the DOM covers all of them at once, and covers a city added next year with
     no edit here. The tradeoff is honest and worth stating: this sees what the
     board displays, so a system hidden via "show on board" is not scored. */
  function isBusCard(id, label) {
    return /bus|rideon/i.test(id + " " + label);
  }

  /* The system's name out of a card header, without the live count or the
     minimise button that sit in the same <h2>.

     Most boards wrap the words in <span class="t"> so the gradient text trick
     (background-clip) has something to clip that is not the count span — so
     that span, when present, IS the label. Reading only the h2's bare text
     nodes finds nothing at all on those boards, which silently fell back to
     the element id and produced "metro" where the board says "GVB Metro". */
  function cardLabel(card) {
    var h2 = card.querySelector("h2");
    if (!h2) return "";
    var t = h2.querySelector(".t");
    if (t && clean(t.textContent)) return clean(t.textContent);
    var txt = "";
    for (var i = 0; i < h2.childNodes.length; i++) {
      var n = h2.childNodes[i];
      if (n.nodeType === 3) txt += n.nodeValue;
    }
    return txt.trim();
  }

  function scoreRow(row, sysId, sysLabel, c, mat) {
    var badge = row.querySelector(".badge"), dest = row.querySelector(".dest"),
        sub = row.querySelector(".sub");
    var line = badge ? clean(badge.textContent) : "";
    var to = dest ? clean(dest.textContent) : "";
    var detail = sub ? clean(sub.textContent) : "";
    if (!line && !to) return null;
    /* Placeholder rows — a board renders "--" into a badge while a feed is still
       loading, and one card's empty state literally reads "Train". Scoring those
       put "-- to Train" on the leaderboard. Require a real word somewhere. */
    if (!/[a-z0-9]/i.test(line + to)) return null;
    if (/^-+$/.test(line) && /^(train|bus|tram)$/i.test(to)) return null;
    /* Not-in-service workings. WMATA reports a train's ServiceType as
       "NoPassengers" or "Unknown" and the board renders that straight into the
       row, which put "No to No Passenger" on the leaderboard — a deadhead move
       to the yard, dressed up as the most interesting train of the day. The
       boards already drop these from the MAP; the card does not, so filter
       here rather than reaching into eleven files to change what they render. */
    if (/^(no|unknown|nopassengers?)$/i.test(line) || /no ?passenger/i.test(to)) return null;

    var rs = [];
    /* Lateness is written into the row by delays.js as its own span, and also
       shows up in the sub text on the live-feed boards. Read the number rather
       than the colour — the colour is a band, and the minutes are the story. */
    var lateTxt = row.textContent.match(/\+(\d+)\s*min/);
    var late = lateTxt ? parseInt(lateTxt[1], 10) : null;
    if (late != null && late >= 60) push(rs, 44, "running " + late + " minutes late");
    else if (late != null && late >= 30) push(rs, 30, late + " minutes late");
    else if (late != null && late >= 15) push(rs, 16, late + " minutes late");
    if (/cancel|fällt aus|falt aus|vervallen/i.test(row.textContent)) push(rs, 34, "cancelled");

    var lineTok = "line:" + sysId + ":" + line, destTok = "dest:" + sysId + ":" + to;
    if (line) push(rs, 30 * rarity(c, lineTok) * mat, rarePhrase(c, lineTok, line + " on " + sysLabel, false));
    if (to)   push(rs, 20 * rarity(c, destTok) * mat, rarePhrase(c, destTok, "service to " + to, false));

    return finish(rs, {
      id: "row:" + sysId + ":" + line + ":" + to,
      kind: "train",
      title: (line ? line + " " : "") + (to ? "to " + to : sysLabel),
      sub: sysLabel,
      detail: detail,
      tokens: [lineTok, destTok],
      photoQuery: sysLabel + " train"
    });
  }

  /* ---- one scoring pass over everything the board is showing -------------- */
  function boardState() {
    try { /* eslint-disable-next-line no-undef */ return typeof state !== "undefined" ? state : null; }
    catch (_) { return null; }
  }

  function collect(c, mat) {
    var out = [], tokens = [], st = boardState();

    if (st && st._planes && st._planes.length) {
      var airlineOnly = planeScope() === "airline";
      for (var i = 0; i < st._planes.length && i < 40; i++) {
        var a = st._planes[i], op = operator(a);
        var e = scorePlane(a, c, mat);

        /* THE AIRLINE FILTER USED TO `continue` HERE, BEFORE SCORING, AND THAT
           QUIETLY KILLED MOST OF THIS FILE.

           isAirlineFlight() rejects tail-number callsigns, rotorcraft, agency
           operators and every CALLSIGN_TAGS prefix — which is the exact
           population that CALLSIGN_TAGS (19 entries, 34-95 points),
           AGENCY_OPERATOR, and 28 of the 52 PLANE_TYPES entries describe. Every
           military and every vintage type in that table flies on a tail number,
           not a flight number. So a B-17, a DC-3, an An-124, a C-17 and an
           aircraft squawking 7700 were all discarded before a single point was
           counted: roughly 60% of the universal aircraft scoring was
           unreachable, and the most interesting aeroplane that can appear over
           anybody's board could never win.

           The filter was right about WHAT it was avoiding and wrong about HOW.
           The thing to keep out is the police helicopter orbiting for an hour —
           not because it is non-airline, but because it is not interesting.
           So score everything, and let a non-airline aircraft in only when its
           UNIVERSAL half clears the bar: it has to be remarkable in itself,
           not merely unfamiliar. That distinction matters because maturity() is
           floored at 0.28, so on a young board simply being new is worth ~25
           points to anything — enough to walk a survey aircraft straight in on
           learned rarity alone. Universal-only is immune to that.

           Where the bar lands, with today's weights: a B-17 (78), Air Force One
           (95), a U-2 (72), a DC-3 (64), anything squawking 7700 (62), an
           An-124 (58), a Special Air Mission (58), a C-5 (48), a C-17 (36) are
           in. A county police helicopter (26), a news helicopter, a survey
           aircraft, a flight-school Cessna and an ordinary bizjet (all 0) stay
           out. That is the cut the user asked for, drawn on interest rather
           than on category. */
        if (airlineOnly && !isAirlineFlight(a, op) && (e.uni || 0) < NON_AIRLINE_BAR) continue;

        out.push(e);
        /* Only what was ADMITTED teaches the registry. Learning from aircraft
           the board filters out would make an airliner look common because a
           hundred bizjets went past, which is a different question. */
        var t = clean(a.t).toUpperCase();
        if (t) tokens.push("type:" + t);
        if (op) tokens.push("op:" + op);
      }
    }
    if (st && st._amtrak && st._amtrak.length) {
      for (var j = 0; j < st._amtrak.length && j < 30; j++) {
        var r = st._amtrak[j];
        out.push(scoreAmtrak(r, c, mat));
        var tt = r.t || r;
        if (clean(tt.routeName)) tokens.push("route:" + clean(tt.routeName));
        if (clean(tt.destName)) tokens.push("dest:" + clean(tt.destName));
      }
    }

    var cards = document.querySelectorAll(".cards .card");
    for (var k = 0; k < cards.length; k++) {
      var card = cards[k], id = card.id || "";
      if (id === "planeCard" || id === "amtrakCard" || id === "spotCard" ||
          id === "leaderCard" || id === "alertCard") continue;
      if (card.classList.contains("user-hidden")) continue;
      var label = cardLabel(card) || id.replace(/Card$/, "");
      if (isBusCard(id, label)) continue;
      var rows = card.querySelectorAll(".list .row");
      for (var m = 0; m < rows.length && m < 20; m++) {
        var ent = scoreRow(rows[m], id, label, c, mat);
        if (!ent) continue;
        out.push(ent);
        if (ent.tokens) tokens = tokens.concat(ent.tokens);
      }
    }
    return { entries: out, tokens: tokens };
  }

  /* ---- keeping the day's best -------------------------------------------- */
  function loadToday() {
    var box = read(LS.leaders, null), day = today();
    if (!box || box.day !== day) {
      if (box && box.day && box.cities) archive(box);
      box = { day: day, cities: {} };
    }
    if (!box.cities) box.cities = {};
    return box;
  }

  /* Yesterday's winners are kept before the slate is wiped, so a board that has
     been on overnight can still show what took the crown, and so the poster has
     something to publish about a day that has already ended. */
  function archive(box) {
    var arch = read(LS.archive, []);
    for (var city in box.cities) {
      var list = box.cities[city] || [];
      if (!list.length) continue;
      arch.unshift({ day: box.day, city: city, entry: list[0] });
    }
    write(LS.archive, arch.slice(0, ARCHIVE_MAX * CITIES.length));
  }

  function upsert(list, entry) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === entry.id) {
        /* Keep the peak, not the latest. A train that was 90 minutes late at
           two o'clock did not become less interesting when it was recovered. */
        if (entry.score > list[i].score) { entry.ts = list[i].ts; entry.seen = (list[i].seen || 1) + 1; list[i] = entry; }
        else { list[i].seen = (list[i].seen || 1) + 1; }
        return;
      }
    }
    list.push(entry);
  }

  /* THE EVICTION BUG. A flat "keep the best twelve" looks harmless and is not:
     a board watches five or six rail systems at six to eight rows each, so
     thirty-odd trains compete for those slots against as few as two aircraft
     inside the 12 nm radius. On a busy corridor the trains simply filled the
     list, and once an aircraft has been dropped at STORAGE time no amount of
     clever display can bring it back — the data is gone.

     So each kind gets its own guaranteed shelf. The ranking across them is
     still honest: whoever scored highest is still first, and a day with
     genuinely no aircraft still shows none. */
  function capPerKind(list) {
    var byScore = function (a, b) { return b.score - a.score; };
    var planes = [], trains = [];
    for (var i = 0; i < list.length; i++) {
      (list[i].kind === "plane" ? planes : trains).push(list[i]);
    }
    planes.sort(byScore); trains.sort(byScore);

    /* Each kind gets a guaranteed floor, because storage is the ONE eviction
       that cannot be undone further down: publish() ships this exact list to
       jsonblob, and that is the daily poster's only input. An aircraft dropped
       here at 09:14 does not exist for the card, the page, the share image or
       the 23:10 post. Above the floor, the remaining slots go to whatever
       actually scored highest, whichever kind that is.

       The total cap is applied too. A previous version filled a shelf of eight
       PER KIND and never applied KEEP_PER_CITY at all, so the constant became
       dead code, storage quietly grew from 12 entries to as many as 16, and
       every board PUT a payload a third larger to jsonblob every five
       minutes. */
    var out = planes.slice(0, RESERVE_PER_KIND).concat(trains.slice(0, RESERVE_PER_KIND));
    var rest = planes.slice(RESERVE_PER_KIND).concat(trains.slice(RESERVE_PER_KIND));
    rest.sort(byScore);
    out = out.concat(rest.slice(0, Math.max(0, KEEP_PER_CITY - out.length)));
    out.sort(byScore);
    return out;
  }

  /* Pick `n` for display, keeping the true order but making sure the minority
     kind is represented when it exists at all. The winner is never swapped —
     saying an aircraft won when a train did would be a lie, and the whole point
     of the reasons list is that it can be checked. */
  function mixForDisplay(list, n, minMinority) {
    if (list.length <= n) return list.slice();
    var head = list.slice(0, n);
    var kinds = {};
    head.forEach(function (e) { kinds[e.kind] = (kinds[e.kind] || 0) + 1; });
    var short = (kinds.plane || 0) === 0 ? "plane" : ((kinds.train || 0) === 0 ? "train" : null);
    if (!short) return head;
    var missing = list.filter(function (e) { return e.kind === short; }).slice(0, minMinority);
    if (!missing.length) return head;
    /* Drop the weakest of the dominant kind, never position 1. */
    var keep = head.slice(0, Math.max(1, n - missing.length));
    /* Place the promoted entry at rank 2, NOT last. trim() removes
       lastElementChild first to fit the card's height, so appending it meant
       the card deleted the promotion before anyone saw it — on exactly the
       short skins where the card has least room and the mix matters most.
       Position 1 is still never touched: the winner is whoever actually won. */
    return [keep[0]].concat(missing, keep.slice(1));
  }

  var lastPublish = 0;

  function pass() {
    if (!CITY) return;
    var day = today();
    var reg = seenAll(), c = seenCity(reg, CITY.id), mat = maturity(c);
    var got = collect(c, mat);
    if (!got.entries.length && !got.tokens.length) return;

    var box = loadToday();
    var list = box.cities[CITY.id] = box.cities[CITY.id] || [];
    var now = Date.now();

    for (var i = 0; i < got.entries.length; i++) {
      var e = got.entries[i];
      if (e.score < MIN_SCORE) continue;
      e.ts = now; e.city = CITY.id; e.cityLabel = CITY.label;
      delete e.tokens;
      upsert(list, e);
    }
    list.sort(function (a, b) { return b.score - a.score; });
    box.cities[CITY.id] = capPerKind(list);
    write(LS.leaders, box);

    /* The registry is updated AFTER scoring, so the first sighting of the day
       is scored against yesterday's knowledge and genuinely reads as new. */
    if (noteSeen(reg, CITY.id, got.tokens, day)) { prune(reg, day); write(LS.seen, reg); }

    render();
    if (now - lastPublish > 300000) { lastPublish = now; publish(box); }
  }

  /* ---- optional: pool several devices into one list -----------------------
     Same keyless store, same share-code idea and the same honest caveat as the
     Spotter's: the code IS the access control and jsonblob is a public store.
     Without a code nothing leaves the device, which is the default. */
  var BLOB_API = "https://jsonblob.com/api/jsonBlob/";
  function blobId() { try { return clean(localStorage.getItem(LS.blob)); } catch (_) { return ""; } }

  function publish(box) {
    var id = blobId();
    if (!id) return;
    var payload = { kind: "transit-leaders", v: 1, day: box.day, updated: new Date().toISOString(), cities: box.cities };
    try {
      fetch(BLOB_API + id, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }).catch(function () {});
    } catch (_) {}
  }

  /* ---- the card on the board --------------------------------------------- */
  function ensureCard() {
    var card = document.getElementById("leaderCard");
    if (card) return card;
    var cards = document.querySelector(".cards");
    if (!cards) return null;
    card = document.createElement("div");
    card.className = "card";
    card.id = "leaderCard";
    card.style.setProperty("--sys", "#ffd166");
    card.innerHTML =
      '<h2><span class="t">Today\'s best</span> <span class="count" id="leaderCount"></span>' +
      '<button type="button" id="leaderHideBtn" title="Hide this box — bring it back in Settings, Show on board">×</button>' +
      "</h2>" +
      '<div class="statline" id="leaderStat"></div>' +
      '<div class="list" id="leaderList"></div>';
    cards.appendChild(card);
    if (hiddenNow()) card.classList.add("user-hidden");

    if (!document.getElementById("leaderCss")) {
      var st = document.createElement("style");
      st.id = "leaderCss";
      st.textContent =
        "#leaderCard .rank{font-family:var(--mono,monospace);font-size:11px;font-weight:700;" +
          "min-width:20px;text-align:right;color:var(--muted,#93a5cf)}" +
        "#leaderCard .row.top .rank{color:var(--accent,#ffd166)}" +
        "#leaderCard .why{font-size:var(--sub-fs,11px);color:var(--accent,#ffd166);opacity:.9;" +
          "overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
        "#leaderCard .pts{font-family:var(--mono,monospace);font-size:13px;font-weight:700;" +
          "color:var(--accent,#ffd166)}" +
        "#leaderCard .row.top{border-color:var(--accent,#ffd166);" +
          "box-shadow:0 0 0 1px var(--accent,#ffd166) inset}" +
        /* Sits with the board's own header controls rather than shouting: the
           point is that it CAN be dismissed, not that it wants to be. */
        "#leaderCard #leaderHideBtn{font:inherit;font-size:15px;line-height:1;cursor:pointer;" +
          "margin-left:6px;padding:1px 5px;border-radius:5px;border:1px solid transparent;" +
          "background:transparent;color:var(--muted,#8fa3bf);opacity:.6}" +
        "#leaderCard #leaderHideBtn:hover{opacity:1;border-color:var(--row-line,#1c2c4e)}";
      document.head.appendChild(st);
    }
    var h2 = card.querySelector("h2");
    h2.style.cursor = "pointer";
    h2.title = "Open the full leaderboard";
    /* Any control in the header acts on the card; only bare header space opens
       the page. Whitelisting one button by id is what broke the Spotted card's
       minimise button when a second button was added to it. */
    h2.onclick = function (e) {
      if (e.target.closest("button")) return;
      window.location.href = "leaderboard.html?city=" + encodeURIComponent(CITY ? CITY.id : "") +
        "&from=" + encodeURIComponent(CITY ? CITY.file : "");
    };
    var hideBtn = card.querySelector("#leaderHideBtn");
    if (hideBtn) hideBtn.onclick = function (e) { e.stopPropagation(); setHidden(true); };
    return card;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
    });
  }

  function render() {
    if (!CITY) return;
    /* Hidden means hidden: don't build the card at all if it has never existed,
       and don't spend a render on it if it has. The checkbox in Settings brings
       it straight back because applyCardVis() only toggles a class. */
    if (hiddenNow() && !document.getElementById(HIDE_ID)) return;
    var card = ensureCard();
    if (!card) return;
    if (card.classList.contains("user-hidden")) return;
    var box = read(LS.leaders, null), list = (box && box.cities && box.cities[CITY.id]) || [];
    var listEl = card.querySelector("#leaderList");
    var countEl = card.querySelector("#leaderCount");
    var statEl = card.querySelector("#leaderStat");
    if (!listEl) return;

    countEl.textContent = list.length ? list.length + " scored" : "";
    /* A board inside a quiet 12 nm circle can honestly have no aircraft at all
       — Amsterdam regularly sees one — and then the card is all trains through
       no fault of the scoring. Say which, so it reads as a fact about the sky
       rather than as a feature that has stopped working. */
    var st = boardState();
    var aloft = (st && st._planes) ? st._planes.length : 0;
    var gotPlane = list.some(function (e) { return e.kind === "plane"; });
    statEl.textContent = !list.length
      ? "watching — the first standout will appear here"
      : (!gotPlane && !aloft
          ? "best of " + CITY.label + " today · no aircraft in range right now"
          : "best of " + CITY.label + " today · tap for the full board");

    listEl.innerHTML = "";
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "Nothing out of the ordinary yet today.";
      listEl.appendChild(empty);
      return;
    }
    mixForDisplay(list, 5, 2).forEach(function (e, i) {
      var row = document.createElement("div");
      row.className = "row" + (i === 0 ? " top" : "");
      row.innerHTML =
        '<div class="rank">' + (i + 1) + "</div>" +
        '<div><div class="dest">' + esc(e.title) + "</div>" +
        '<div class="sub">' + esc([e.sub, e.detail].filter(Boolean).join(" · ")) + "</div>" +
        '<div class="why">' + esc(e.reasons && e.reasons[0] ? e.reasons[0].t : "") + "</div></div>" +
        "<div></div>" +
        '<div class="times"><div class="pts">' + e.score + "</div>" +
        '<div class="sched">' + (e.kind === "plane" ? "AIR" : "RAIL") + "</div></div>";
      listEl.appendChild(row);
    });
    trim(listEl);
  }

  /* The boards' own fitList() only knows about the cards that were in the HTML
     at build time, so an injected card trims itself. The height guard is the
     one spotlog.js already needed: before layout the box measures nothing, and
     an ungated trim deletes every row. */
  function trim(box) {
    if (box.clientHeight < 8) return;
    var guard = 0;
    while (box.scrollHeight > box.clientHeight + 2 && box.children.length > 1 && guard++ < 40) {
      box.removeChild(box.lastElementChild);
    }
  }

  /* A "Best" link in every board's header, injected here rather than pasted
     into eleven of them by hand — the same reasoning, and the same
     switchCity() call, that cityswitch.js already uses for "Account", so a
     kiosk in full screen stays in full screen when it follows the link. */
  function addNavLink() {
    var nav = document.querySelector("nav.view-links");
    if (!nav || nav.querySelector("#bestBtn")) return;
    var url = "leaderboard.html?city=" + encodeURIComponent(CITY.id) + "&from=" + encodeURIComponent(CITY.file);
    var a = document.createElement("a");
    a.id = "bestBtn";
    a.href = url;
    a.title = "Today's most interesting plane or train";
    a.textContent = "Best";
    a.onclick = function (e) {
      e.preventDefault();
      if (typeof window.switchCity === "function") window.switchCity(url);
      else window.location.href = url;
      return false;
    };
    /* Before "Account", which cityswitch.js appends — so the view links stay
       together and the account link stays last, where it was. */
    var acct = nav.querySelector("#profileBtn");
    if (acct) nav.insertBefore(a, acct); else nav.appendChild(a);
  }

  /* ---- boot -------------------------------------------------------------- */
  function boot() {
    if (!CITY) return;                       // a shared page, not a city board
    addNavLink();
    render();
    setTimeout(pass, 4000);                  // let the first fetches land
    setInterval(pass, TICK_MS);

    var card = document.getElementById("leaderCard");
    if (card && window.ResizeObserver) {
      var last = 0;
      new ResizeObserver(function () {
        var h = card.clientHeight;
        if (Math.abs(h - last) < 4) return;  // height-gated: an ungated observer
        last = h;                            // re-enters its own render
        render();
      }).observe(card);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  /* Exposed for leaderboard.html and for anyone debugging a score in the
     console: TBLeaders.explain() prints what the current board would rank. */
  window.TBLeaders = {
    cities: CITIES,
    read: function () { return read(LS.leaders, { day: today(), cities: {} }); },
    archive: function () { return read(LS.archive, []); },
    seen: seenAll,
    keys: LS,
    today: today,
    pass: pass,
    planeScope: planeScope,
    setPlaneScope: function (v) {
      try { localStorage.setItem(LS.planes, v === "all" ? "all" : "airline"); } catch (_) {}
    },
    explain: function () {
      var reg = seenAll(), c = seenCity(reg, CITY ? CITY.id : "?");
      return collect(c, maturity(c)).entries.sort(function (a, b) { return b.score - a.score; });
    }
  };
})();
