/* operator-logos.js — who is running that train, drawn on the marker.
   ---------------------------------------------------------------------------
   On the European boards the long-distance and international fleets were
   captioned exactly like a tram: one dark chip reading "ICE 127 → Frankfurt".
   That is the right caption for a tram, where the line number IS the identity.
   It is the wrong one for a mainline train, because the first thing a traveller
   wants from an intercity service is WHOSE it is — the ticket, the catering,
   the reservation rules, the app that will tell you about the delay and the
   seat you booked all follow from the operator, and at a border station half a
   dozen railways share the same platforms and the same "IC" prefix.

   So the long-distance marker gets a two-row plaque: the operator's wordmark
   on top, in the operator's own colours, and the service number and
   destination underneath. Shape still says MODE (vehicle-icons.js) and the
   marker colour still says FAMILY; this adds the one fact neither could carry.

   WHY WORDMARKS AND NOT LOGOS. These are set in type, in each railway's
   colours — not copies of their trademarked artwork. That is deliberate and it
   is the better engineering as well as the safer position: a real logo would
   mean bundling or hot-linking a dozen images, and at the 10px a map marker
   gets, a rendered logo is a smudge where three bold letters are still
   readable. "DB" on red is what is painted on the side of the train anyway.

   HOW THE OPERATOR IS WORKED OUT, in order:

     1. The feed's own agencyName, where there is one. /stoptimes carries it
        ("DB Fernverkehr AG", "Schweizerische Bundesbahnen SBB", "TRENITALIA",
        "NS International", "SNCF VOYAGEURS") and so does /trip. This is the
        answer whenever it exists.

     2. The service code, where it does not. The map's vehicles come from
        /map/trips, which returns a trip id and a route name and nothing else —
        no agency at all. But a mainline service code is close to an operator
        name in practice: EST is Eurostar, NJ is a Nightjet, FR is a
        Frecciarossa, TGV is SNCF.

     3. The board's own railway, for the codes that are genuinely ambiguous.
        "IC" is DB in Cologne, SBB in Zurich, Trenitalia in Rome and NS in
        Amsterdam; nothing in the string can tell you which. Each board passes
        its home operator, and that is what an unqualified IC/EC/RE falls back
        to — correct for the overwhelming majority of the trains standing in
        that city, and never applied to a code that names its own railway.

   An unrecognised agency still gets a plaque, built from its own name on a
   neutral slate, rather than being dropped: "FLÅM UTVIKLING AS" on grey is
   more use than no operator row at all, and it is also how you find out which
   railway to add next. */
(function (root) {
  "use strict";

  /* The wordmark row is set in whatever condensed face the board already has
     loaded, falling back through the system stack. Condensed matters here:
     "TRENITALIA" has to fit a marker, and the alternative is shrinking it
     until it stops being readable. */
  var WORD_FONT = "'IBM Plex Sans Condensed','Roboto Condensed','Helvetica Neue',Helvetica,Arial,sans-serif";
  var UI_FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

  /* Each railway: the wordmark as it is set here, its background, and the ink
     that reads on it. Colours are each operator's own house colour, named in
     the comment where it is the published brand value — approximations are
     marked as such. Ink is chosen for contrast at 9px on a map, which is a
     harder test than contrast on paper: NS yellow and RegioJet yellow both
     take dark ink, everything else takes white. */
  var OPS = {
    DB:        { mark: "DB",             bg: "#EC0016", ink: "#fff" },  // DB red, published
    SBB:       { mark: "SBB CFF FFS",    bg: "#EB0000", ink: "#fff" },  // SBB red
    NS:        { mark: "NS",             bg: "#FFC917", ink: "#1A2E6E" },// NS yellow on NS blue
    EUROSTAR:  { mark: "Eurostar",       bg: "#15235B", ink: "#fff" },
    THALYS:    { mark: "Thalys",         bg: "#8A1538", ink: "#fff" },
    SNCF:      { mark: "SNCF",           bg: "#A3003C", ink: "#fff" },  // carmillon, approx
    LYRIA:     { mark: "TGV Lyria",      bg: "#C8102E", ink: "#fff" },
    OBB:       { mark: "ÖBB",            bg: "#E2001A", ink: "#fff" },  // ÖBB red
    NIGHTJET:  { mark: "Nightjet",       bg: "#142B5C", ink: "#8FD4E8" },
    EUSLEEPER: { mark: "Eur. Sleeper",   bg: "#122B52", ink: "#F6D04D" },
    TRENITALIA:{ mark: "Trenitalia",     bg: "#C1272D", ink: "#fff" },
    ITALO:     { mark: "Italo",          bg: "#AF1E2D", ink: "#fff" },
    SNCB:      { mark: "SNCB NMBS",      bg: "#004A8F", ink: "#fff" },
    FLIXTRAIN: { mark: "FlixTrain",      bg: "#73D700", ink: "#10231A" },// Flix green
    REGIOJET:  { mark: "RegioJet",       bg: "#FFD500", ink: "#1A1A1A" },
    CD:        { mark: "ČD",             bg: "#004A99", ink: "#fff" },
    PKP:       { mark: "PKP IC",         bg: "#0E3C7D", ink: "#fff" },
    RENFE:     { mark: "Renfe",          bg: "#6F2C91", ink: "#fff" },
    WESTBAHN:  { mark: "Westbahn",       bg: "#7AB800", ink: "#10231A" },
    MAV:       { mark: "MÁV",            bg: "#1B5E3A", ink: "#fff" },
    TRENORD:   { mark: "Trenord",        bg: "#00843D", ink: "#fff" },
    ARRIVA:    { mark: "Arriva",         bg: "#0C4DA2", ink: "#fff" },
    LEOEXPRESS:{ mark: "Leo Express",    bg: "#1A1A1A", ink: "#E6B000" },
    SJ:        { mark: "SJ",             bg: "#1B3B6F", ink: "#fff" },
    DSB:       { mark: "DSB",            bg: "#B01C2E", ink: "#fff" },
  };

  /* agencyName -> operator. Matched as a lowercase substring test in the order
     listed, so the specific entries have to come before the general ones: "NS
     International" must be tested before anything matching a bare "ns", and
     "TGV Lyria" before "SNCF". Every pattern here has been seen in a live
     response from api.transitous.org rather than guessed. */
  var BY_AGENCY = [
    [/db\s*fernverkehr|deutsche\s*bahn|\bdb\s*ag\b|db\s*regio/, "DB"],
    [/lyria/, "LYRIA"],
    [/eurostar/, "EUROSTAR"],
    [/thalys/, "THALYS"],
    [/sncf|voyageurs|ouigo/, "SNCF"],
    [/european\s*sleeper/, "EUSLEEPER"],
    [/nightjet/, "NIGHTJET"],
    [/österreich|oesterreich|austrian\s*federal|\böbb\b|\bobb\b/, "OBB"],
    [/schweizerische|\bsbb\b|\bcff\b|\bffs\b/, "SBB"],
    [/trenord/, "TRENORD"],
    [/trenitalia|ferrovie\s*dello\s*stato/, "TRENITALIA"],
    [/italo|\bntv\b|nuovo\s*trasporto/, "ITALO"],
    [/nederlandse\s*spoorwegen|\bns\b/, "NS"],
    [/sncb|nmbs/, "SNCB"],
    [/flix/, "FLIXTRAIN"],
    [/regiojet/, "REGIOJET"],
    [/leo\s*express/, "LEOEXPRESS"],
    [/české|ceske|czech\s*rail|\bčd\b/, "CD"],
    [/\bpkp\b/, "PKP"],
    [/renfe/, "RENFE"],
    [/westbahn/, "WESTBAHN"],
    [/\bmáv\b|\bmav\b|magyar\s*áll/, "MAV"],
    [/arriva/, "ARRIVA"],
    [/\bsj\b|statens\s*järnväg/, "SJ"],
    [/\bdsb\b/, "DSB"],
  ];

  /* Service code -> operator, for the map's vehicles, which arrive with a route
     name and no agency whatsoever (/map/trips returns tripId and
     routeShortName, nothing more). Only codes that NAME their railway are here;
     IC, EC, RE and friends are deliberately absent and fall through to the
     board's home operator below, because they belong to a different railway in
     every country. */
  var BY_SERVICE = [
    [/^ice\b/, "DB"],
    [/^(est|eurostar)\b/, "EUROSTAR"],
    [/^tha\b/, "THALYS"],
    [/\blyria\b/, "LYRIA"],
    [/^(tgv|inoui|ouigo)\b/, "SNCF"],
    [/^(nj|njx)\b/, "NIGHTJET"],
    [/^(rj|rjx)\b/, "OBB"],
    [/^(fr|fa|fb)\s*\d/, "TRENITALIA"],   // Frecciarossa / Frecciargento / Frecciabianca
    [/^(ita|ntv)\b/, "ITALO"],
    [/^flx\b/, "FLIXTRAIN"],
    [/^(ave|alvia|avlo)\b/, "RENFE"],
    [/^rgj\b/, "REGIOJET"],
    /* EN is a EuroNight, which is an ÖBB-led product almost everywhere it
       still runs; ES is European Sleeper, whose two letters would otherwise
       collide with nothing useful. Both are rare enough to be worth naming. */
    [/^en\s*\d/, "OBB"],
    [/^es\s*\d/, "EUSLEEPER"],
  ];

  /* A handful of service codes that outrank the agency name, because the code
     IS the brand and the agency field is whoever happens to have filed the
     train. The Zurich-Paris Lyria is filed by "SNCF VOYAGEURS", the Nightjet to
     Vienna by "NS International", and an ICE through Arnhem by "Nederlandse
     Spoorwegen" -- all true, and none of them what is painted on the train or
     printed on the ticket. Kept deliberately short: only products whose own
     name is unambiguous worldwide. */
  var OVERRIDE = [
    [/\blyria\b/, "LYRIA"],
    [/^(est|eurostar)\b/, "EUROSTAR"],
    [/^tha\b/, "THALYS"],
    [/^(nj|njx)\b/, "NIGHTJET"],
    [/^ice\b/, "DB"],
    [/^(fr|fa|fb)\s*\d/, "TRENITALIA"],
  ];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* An agency this file has never heard of, worn as its own wordmark. Legal
     suffixes and the bracketed notes the feeds add ("DB Fernverkehr
     (Codesharing)", "… AG", "… S.p.A.") are dropped, because they are the
     part nobody reads and the part that would push the plaque off the screen.
     Two words at most, and never longer than fits a marker. */
  var NOISE = /\s*\((?:[^)]*)\)|\b(ag|gmbh|a\/s|s\.?p\.?a\.?|n\.?v\.?|s\.?a\.?|plc|ltd|oy|as|kft)\b\.?/gi;
  function fallbackMark(agency) {
    var t = String(agency || "").replace(NOISE, " ").replace(/\s+/g, " ").trim();
    if (!t) return "";
    var words = t.split(" ").slice(0, 2).join(" ");
    return words.length > 16 ? words.slice(0, 15) + "." : words;
  }

  /* The operator of one service: {key, mark, bg, ink}, or null when there is
     nothing to go on at all. `home` is the board's own railway as an OPS key
     ("DB", "SBB", "TRENITALIA", "NS"), used only for codes that cannot name
     their own operator. */
  function of(agency, service, home) {
    var a = String(agency || "").toLowerCase();
    var s0 = String(service || "").trim().toLowerCase();
    var i;
    for (i = 0; i < OVERRIDE.length; i++) {
      if (s0 && OVERRIDE[i][0].test(s0)) return withKey(OVERRIDE[i][1]);
    }
    if (a) {
      for (i = 0; i < BY_AGENCY.length; i++) {
        if (BY_AGENCY[i][0].test(a)) return withKey(BY_AGENCY[i][1]);
      }
    }
    var s = s0;
    if (s) {
      for (i = 0; i < BY_SERVICE.length; i++) {
        if (BY_SERVICE[i][0].test(s)) return withKey(BY_SERVICE[i][1]);
      }
    }
    /* A named agency this table does not know beats a guess from the home
       railway: the feed is telling us something true, and inventing "DB" over
       the top of it would be a confident error rather than a gap. */
    var own = fallbackMark(agency);
    if (own) return { key: "other", mark: own, bg: "#2A3550", ink: "#CFE0FF" };
    if (home && OPS[home] && s) return withKey(home);
    return null;
  }
  function withKey(k) {
    var o = OPS[k];
    return o ? { key: k, mark: o.mark, bg: o.bg, ink: o.ink } : null;
  }

  /* ---- the plaque's own stylesheet ---------------------------------------
     The rows used to carry every declaration inline, which was fine while the
     boards had one look. They have four now -- Classic, Atlas, Paper and
     Signal, each over a dark, black or day theme -- and an inline
     `background:rgba(9,13,24,.88)` is a dark chip stapled to a light editorial
     page in the one place CSS cannot reach it.

     So the plaque is built from classes and styled here, once, in the boards'
     own design tokens. It is injected rather than added to theme.css for the
     same reason fit-cards.js injects its own: the file has to work on a board
     that has not been told about it.

     WHAT FOLLOWS THE BOARD AND WHAT DOES NOT. The service row is the board's:
     its panel colour, its ink, its type, its corner radius. The operator row
     is the OPERATOR's and stays in the railway's own colours under every
     style, because a wordmark that changes colour with the page is no longer a
     wordmark -- DB red is the whole point of DB red. */
  var CSS =
    ".tb-op-plaque{position:absolute;display:block;overflow:hidden;border-radius:5px;" +
    "box-shadow:0 1px 3px rgba(0,0,0,.55)}" +
    ".tb-op-mark{display:block;padding:1px 5px 2px;letter-spacing:.08em;text-transform:uppercase;" +
    "white-space:nowrap;font:800 9px/11px " + WORD_FONT + "}" +
    ".tb-op-svc{display:block;padding:1px 5px;white-space:nowrap;" +
    "background:rgba(9,13,24,.88);color:#fff;font:700 10px/13px " + UI_FONT + "}" +
    /* Day is the one light board theme, and it is also the one that puts a
       light basemap underneath. A dark chip still READS there, but it reads as
       a leftover from the night board; the hairline is what keeps a pale
       plaque off a pale street. */
    ':root[data-theme="day"] .tb-op-svc{background:rgba(255,255,255,.95);color:#15203a;' +
    "box-shadow:inset 0 0 0 1px rgba(20,32,58,.18)}" +
    /* Paper: softer corners and the board's own editorial face. */
    ':root[data-style="paper"] .tb-op-plaque{border-radius:8px}' +
    ':root[data-style="paper"] .tb-op-svc{font-family:var(--body,' + UI_FONT + ")}" +
    ':root[data-style="paper"][data-theme="day"] .tb-op-svc{background:rgba(255,252,245,.96);color:#24231f}' +
    /* Signal: square plates and tabular figures, so a train number lines up
       with the timetable it came off, exactly as the card rows do. */
    ':root[data-style="signal"] .tb-op-plaque{border-radius:0}' +
    ':root[data-style="signal"] .tb-op-mark{letter-spacing:.1em}' +
    ':root[data-style="signal"] .tb-op-svc{font-family:var(--mono,ui-monospace,monospace);' +
    "font-variant-numeric:tabular-nums}" +
    /* ---- the card version --------------------------------------------------
       The same wordmark, inline at the head of a row's sub-line. It has to sit
       INSIDE the line box the sub-line already has, because the cards are
       measured and tiled by fit-cards.js: a tag that is one pixel taller than
       the text beside it grows every row, which grows the tile, which re-runs
       the whole fitter. Hence a 9px face on a 12px line, which is shorter than
       the 11px text it sits next to, and no vertical padding at all. */
    ".tb-op-tag{display:inline-block;vertical-align:baseline;margin-right:5px;padding:0 4px;" +
    "border-radius:3px;max-width:92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" +
    "letter-spacing:.06em;text-transform:uppercase;font:800 9px/12px " + WORD_FONT + "}" +
    ':root[data-style="signal"] .tb-op-tag{border-radius:0}';

  function injectCss() {
    if (typeof document === "undefined" || document.getElementById("tbOpCss")) return;
    var el = document.createElement("style");
    el.id = "tbOpCss";
    el.textContent = CSS;
    (document.head || document.documentElement).appendChild(el);
  }

  /* The plaque itself, as the inner HTML of a marker: operator row on top in
     its own colours, service and destination underneath on the board's own
     chip. Positioned beside the marker rather than over it, the way the
     one-line chip always was, so the glyph still sits exactly on the fix. The
     accent down the left edge is the family colour, which is what ties the
     plaque to the vehicle it belongs to when two overlap. */
  function plaqueHTML(o) {
    o = o || {};
    injectCss();
    var op = of(o.agency, o.service, o.home);
    var svc = [o.service, o.dest].filter(Boolean).join(" \u2192 ");
    if (!op && !svc) return "";
    var left = o.left == null ? 11 : o.left;
    /* Two rows are about 26px tall, so the plaque is lifted half its height to
       sit centred on the marker instead of hanging off its top corner. */
    var top = o.top == null ? -14 : o.top;
    var rows = "";
    if (op) {
      rows += '<span class="tb-op-mark" style="background:' + op.bg + ";color:" + op.ink +
        '">' + esc(op.mark) + "</span>";
    }
    if (svc) rows += '<span class="tb-op-svc">' + esc(svc) + "</span>";
    return '<span class="veh-lbl veh-plaque tb-op-plaque" style="left:' + left + "px;top:" + top +
      "px;border-left:3px solid " + (o.color || "#9fb4d8") + '">' + rows + "</span>";
  }

  /* The wordmark on its own, for a departure row rather than a marker. Returns
     "" when no railway can be named, so a caller can concatenate it
     unconditionally and get nothing where there is nothing to say. */
  function tagHTML(o) {
    o = o || {};
    injectCss();
    var op = of(o.agency, o.service, o.home);
    if (!op) return "";
    return '<span class="tb-op-tag" style="background:' + op.bg + ";color:" + op.ink +
      '" title="' + esc(o.agency || op.mark) + '">' + esc(op.mark) + "</span>";
  }

  /* So a caller can tell whether a plaque would say anything an ordinary chip
     does not, and fall back to the chip when it would not. */
  function has(agency, service, home) { return !!of(agency, service, home); }

  root.TBOp = { of: of, has: has, plaqueHTML: plaqueHTML, tagHTML: tagHTML, operators: OPS };
})(typeof window !== "undefined" ? window : this);
