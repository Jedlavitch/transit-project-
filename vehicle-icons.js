/* vehicle-icons.js — mode glyphs for the vehicles moving on the map.
   ---------------------------------------------------------------------------
   Every ground vehicle on every board was the same 9px dot: trains, buses,
   trams and ferries differed only by colour, and colour is already spoken for
   (it carries the LINE). Planes were the one exception — they got a real
   rotated glyph — which is why the sky reads at a glance and the ground does
   not. This file gives the ground the same treatment.

   Shape carries the MODE, colour still carries the LINE, so the two facts stop
   competing for the one channel. A red dot could be a Red Line train or a
   shuttle bus on the same corridor; a red train and a red bus cannot be
   confused at any zoom.

   Why a filled pill and not a rotated silhouette like the plane: a plane's
   heading is the interesting fact about it, and it flies over open space where
   a 22px glyph has room. A train's heading is implied by the track it is
   pinned to, vehicles bunch at stations, and most of these feeds give no
   bearing at all (WMATA's track-circuit positions certainly don't). A compact
   centred badge stays legible where six of them overlap outside Metro Center,
   and keeps the marker's anchor exactly on the fix — which a rotated glyph
   visually muddies.

   Loaded as a plain (non-deferred) script, like config.js and delays.js, so
   the constant exists before a board's inline script defines labelIcon().
   Every board's labelIcon() falls back to the old dot when this file is absent
   or the mode is unknown, so a board can adopt it one call site at a time. */
(function (root) {
  "use strict";

  /* 24x24 viewBox paths, drawn as white-on-line-colour. Kept deliberately
     chunky: these render at 12-13px on the map, where a faithful outline turns
     to mush and a bold silhouette still reads. */
  var GLYPH = {
    /* Metro/heavy rail: a car front — windscreen, two headlights, skirt band.
       Everything stays inside x/y 4-20 of the 24 box on purpose: the badge
       behind it is a rounded square, and an earlier draft's splayed front
       skirt ran into the corner radius and came out as two clipped specks. */
    rail:
      '<path d="M7 3.5h10a2.5 2.5 0 0 1 2.5 2.5v11.5a2.5 2.5 0 0 1-2.5 2.5H7a2.5 2.5 0 0 1-2.5-2.5V6A2.5 2.5 0 0 1 7 3.5z" fill="#fff"/>' +
      '<path d="M7.8 6.4h8.4v4.6H7.8z" fill="{c}"/>' +
      '<circle cx="9.3" cy="14.2" r="1.3" fill="{c}"/><circle cx="14.7" cy="14.2" r="1.3" fill="{c}"/>' +
      '<path d="M6.6 17.2h10.8v1.5H6.6z" fill="{c}"/>',
    /* Tram/light rail: taller glasshouse, single pantograph nub on the roof. */
    tram:
      '<path d="M12 1.6 8 3.4h8z" fill="#fff"/>' +
      '<path d="M7 4h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fff"/>' +
      '<path d="M7.6 6.6h8.8v5H7.6z" fill="{c}"/>' +
      '<circle cx="9" cy="15.6" r="1.2" fill="{c}"/><circle cx="15" cy="15.6" r="1.2" fill="{c}"/>',
    /* Bus: one wide window band across a slab body, on two chunky wheel blocks.
       Deliberately the least detailed glyph in the set. Buses are the densest
       thing on most of these maps — Philadelphia alone puts 500-odd on screen —
       so this one is drawn for the pile-up rather than for a single specimen:
       fewer marks, more ink per mark, and it still reads at 15px where the
       four-window version it replaced collapsed into the same grey band as the
       body. The wheels are rounded blocks rather than circles for the same
       reason; at map size a 2px circle is a smudge and a block is a shape. */
    bus:
      '<path d="M4 5.2h16a2.2 2.2 0 0 1 2.2 2.2v8.2a2.2 2.2 0 0 1-2.2 2.2H4a2.2 2.2 0 0 1-2.2-2.2V7.4A2.2 2.2 0 0 1 4 5.2z" fill="#fff"/>' +
      '<path d="M3.2 7.4h17.6v5.2H3.2z" fill="{c}"/>' +
      '<rect x="4.6" y="17" width="4.4" height="3" rx="1.4" fill="#fff"/>' +
      '<rect x="15" y="17" width="4.4" height="3" rx="1.4" fill="#fff"/>',
    /* Ferry: hull, cabin, funnel — read bottom-up as a boat. The hull is the
       widest element and sits low, which is what separates it from the bus at
       a glance; the earlier version put a tall box on a small hull and read as
       a machine rather than a vessel. */
    ferry:
      '<path d="M3.6 13.6h16.8l-2 5.1a2 2 0 0 1-1.9 1.3H7.5a2 2 0 0 1-1.9-1.3z" fill="#fff"/>' +
      '<path d="M6.6 7.4h10.8v5.3H6.6z" fill="#fff"/>' +
      '<path d="M8.3 8.9h7.4v2.4H8.3z" fill="{c}"/>' +
      '<path d="M10.9 3.4h2.4v3.2h-2.4z" fill="#fff"/>' +
      '<path d="M7.4 15.4h9.2v1.4H7.4z" fill="{c}"/>',
    /* Commuter/intercity rail: a loco with a nose, distinct from a metro car. */
    train:
      '<path d="M6 4h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" fill="#fff"/>' +
      '<path d="M6.4 6.6h5v4.2h-5zM12.6 6.6h5v4.2h-5z" fill="{c}"/>' +
      '<circle cx="8" cy="14" r="1.15" fill="{c}"/><circle cx="16" cy="14" r="1.15" fill="{c}"/>' +
      '<path d="M4 17.6h16v1.6H4z" fill="#fff"/>',
  };
  /* ---- pictogram family ("pict-*") ----------------------------------------
     The glyphs above are compact silhouettes tuned for a 15px badge. This
     second family is the fuller transit-pictogram look agencies use on
     signage: a vehicle FRONT — windscreen, doors, headlights — standing on a
     length of track, white on the line colour, in a circle rather than a
     rounded square.

     They carry more detail than the badge glyphs, which is the point and also
     the cost: below about 13px the track under the vehicle closes up into a
     smudge. So the track is drawn as two clean rails with three sleepers
     rather than a faithful perspective, and each pictogram is separated at the
     SILHOUETTE — pantograph for the tram, an arch for the elevated, a wide
     centre door for the metro car, a skirt for the mainline train — so they
     stay distinguishable when the interior detail stops resolving. */
  var PICT = {
    // Mainline / regional rail: narrow windscreen pair, headlights, skirt.
    "pict-rail":
      '<path d="M8.6 2.6h6.8M12 2.6v2" stroke="#fff" stroke-width="1.4" stroke-linecap="round" fill="none"/>' +
      '<path d="M7.6 4.6h8.8a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2H7.6a2 2 0 0 1-2-2V6.6a2 2 0 0 1 2-2z" fill="#fff"/>' +
      '<path d="M7.2 7.2h3v3.4h-3zM13.8 7.2h3v3.4h-3z" fill="{c}"/>' +
      '<path d="M10.9 7.2h2.2v3.4h-2.2z" fill="{c}" opacity=".55"/>' +
      '<circle cx="9" cy="13.4" r="1" fill="{c}"/><circle cx="15" cy="13.4" r="1" fill="{c}"/>' +
      '<path d="M8.2 17.2h7.6v1.5H8.2z" fill="#fff"/>' +
      '<path d="M3 21.4h18v1.4H3z" fill="#fff"/>' +
      '<path d="M6.6 18.9h1.5l-1.4 4H5.2zM17.4 18.9h-1.5l1.4 4h1.5z" fill="#fff"/>',
    // Metro / heavy-rail car: full-height centre door, two headlight pairs.
    "pict-metro":
      '<path d="M6.4 3.4h11.2a2.2 2.2 0 0 1 2.2 2.2v9.6a2.2 2.2 0 0 1-2.2 2.2H6.4a2.2 2.2 0 0 1-2.2-2.2V5.6a2.2 2.2 0 0 1 2.2-2.2z" fill="#fff"/>' +
      '<path d="M9.4 4.8h5.2v1.3H9.4z" fill="{c}"/>' +
      '<path d="M5.8 7.4h3.4v5.1H5.8zM14.8 7.4h3.4v5.1h-3.4z" fill="{c}"/>' +
      '<rect x="10.6" y="7.4" width="2.8" height="5.1" rx="1.2" fill="{c}"/>' +
      '<circle cx="7" cy="14.6" r=".9" fill="{c}"/><circle cx="9.1" cy="14.6" r=".9" fill="{c}"/>' +
      '<circle cx="14.9" cy="14.6" r=".9" fill="{c}"/><circle cx="17" cy="14.6" r=".9" fill="{c}"/>' +
      '<path d="M3 21.4h18v1.4H3z" fill="#fff"/>' +
      '<path d="M7.2 17.6h1.5l-1.4 5.2H5.8zM16.8 17.6h-1.5l1.4 5.2h1.4z" fill="#fff"/>',
    // Trolley / light rail: pantograph on the roof, one broad windscreen.
    "pict-tram":
      '<path d="M4.6 2.2 12 4.4l7.4-2.2" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
      '<path d="M12 4.2v1.2" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>' +
      '<path d="M7 5.4h10a2.2 2.2 0 0 1 2.2 2.2v7.6a2.2 2.2 0 0 1-2.2 2.2H7a2.2 2.2 0 0 1-2.2-2.2V7.6A2.2 2.2 0 0 1 7 5.4z" fill="#fff"/>' +
      '<path d="M6.6 7.6h10.8v4.6H6.6z" fill="{c}"/>' +
      '<circle cx="8.6" cy="14.6" r=".95" fill="{c}"/><circle cx="12" cy="14.6" r=".95" fill="{c}"/>' +
      '<circle cx="15.4" cy="14.6" r=".95" fill="{c}"/>' +
      '<path d="M3 21.4h18v1.4H3z" fill="#fff"/>' +
      '<path d="M7.6 17.6h1.5l-1.4 5.2H6.2zM16.4 17.6h-1.5l1.4 5.2h1.4z" fill="#fff"/>',
    /* Elevated: the car sits inside the portal frame the line runs on. The
       frame is inset well clear of the badge's circular mask — at the top of a
       24-box circle there is barely 8 units of width, so a full-bleed portal
       came out as two clipped stubs. */
    "pict-el":
      '<path d="M5 5h14v1.8H5zM5 5h1.8v15.4H5zM17.2 5H19v15.4h-1.8z" fill="#fff"/>' +
      '<path d="M8.4 8.4h7.2a1.8 1.8 0 0 1 1.8 1.8v5.6a1.8 1.8 0 0 1-1.8 1.8H8.4a1.8 1.8 0 0 1-1.8-1.8v-5.6a1.8 1.8 0 0 1 1.8-1.8z" fill="#fff"/>' +
      '<path d="M7.8 10.4h2.6v3.4H7.8zM13.6 10.4h2.6v3.4h-2.6z" fill="{c}"/>' +
      '<rect x="11.1" y="10.4" width="1.8" height="3.4" rx=".8" fill="{c}"/>' +
      '<circle cx="9.2" cy="15.7" r=".75" fill="{c}"/><circle cx="14.8" cy="15.7" r=".75" fill="{c}"/>' +
      '<path d="M4.6 20.4h14.8v1.3H4.6z" fill="#fff"/>',
  };

  /* Aliases so a call site can pass whatever the board already calls the mode
     rather than translating at every one of them. */
  var ALIAS = {
    metro: "rail", subway: "rail", "light-rail": "tram", lightrail: "tram",
    trolley: "tram", streetcar: "tram", amtrak: "train", marc: "train",
    commuter: "train", regional: "train", coach: "bus", shuttle: "bus",
    boat: "ferry", water: "ferry",
  };

  function resolve(mode) {
    if (!mode) return null;
    var m = String(mode).toLowerCase();
    if (PICT[m]) return m;              // pictograms are named exactly, never aliased
    m = ALIAS[m] || m;
    return GLYPH[m] ? m : null;
  }

  /* ---- letter tiles -------------------------------------------------------
     Some networks name their lines with a single letter and publish that letter
     as the line's identity, on every sign, map and vehicle. SEPTA Metro is the
     clear case: since the 2024 wayfinding standard a rider looks for the orange
     B, not for "the Broad Street Line", and certainly not for a generic train
     silhouette that says only "rail".

     Where a network does that, the letter IS the better glyph — it is what the
     station signage shows, so the map matches what you are standing under.
     Requested as the mode string "letter:B", which means no board's labelIcon()
     needs a new parameter to support it.

     Dark ink on light tiles: SEPTA's G is a bright yellow, and white on yellow
     fails at 13px on a map even where it passes a contrast ratio on paper. */
  function darkInkOn(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (h.length !== 6) return false;
    var r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    // Rec. 601 luma: cheap, and the right kind of cheap for a yes/no on a badge.
    return (0.299 * r + 0.587 * g + 0.114 * b) > 165;
  }

  function letterTile(letter, color, size) {
    var s = size || 15;
    var txt = String(letter || "").toUpperCase().slice(0, 2);
    if (!txt) return "";
    var ink = darkInkOn(color) ? "#1a1a1a" : "#ffffff";
    // Two characters have to shrink to fit the same tile the rest of the map uses.
    var fs = txt.length > 1 ? 13 : 17;
    return '<span style="position:absolute;left:' + (-s / 2) + "px;top:" + (-s / 2) + "px;" +
      "width:" + s + "px;height:" + s + "px;border-radius:" + Math.round(s * 0.26) + "px;" +
      "background:" + (color || "#1b2440") + ";border:1.5px solid #fff;box-sizing:border-box;" +
      'box-shadow:0 1px 3px rgba(0,0,0,.65);display:block">' +
      '<svg viewBox="0 0 24 24" width="100%" height="100%" style="display:block">' +
      '<text x="12" y="12" text-anchor="middle" dominant-baseline="central" ' +
      'font-family="-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif" ' +
      'font-weight="800" font-size="' + fs + '" fill="' + ink + '">' + txt + "</text></svg></span>";
  }

  /* Returns the inner HTML of a marker glyph, or "" when the mode is unknown
     — callers treat "" as "fall back to the dot you already drew".

     `size` is the glyph box in px. The badge is a rounded square rather than a
     circle because a circle wastes its corners on a vehicle silhouette that is
     itself wider than tall, and the squarer outline is easier to tell from the
     round station dots the boards draw underneath. */
  function glyphHTML(mode, color, size) {
    // "letter:B" -> the line's own letter tile, for networks that name lines
    // that way (see letterTile). Carried in the mode string so the existing
    // labelIcon(color, label, mode) signature covers it on every board.
    var m = String(mode || "");
    if (m.slice(0, 7).toLowerCase() === "letter:") return letterTile(m.slice(7), color, size);

    var key = resolve(mode);
    if (!key) return "";
    var s = size || 15;

    /* The pictogram family is drawn white-on-colour in a CIRCLE, which is the
       shape that signage set uses and also what keeps it apart from the badge
       glyphs at a glance. Rendered a touch larger than a badge because it
       carries more detail and needs the pixels to spend. */
    if (PICT[key]) {
      /* Drawn appreciably larger than a badge glyph for the same request. A
         pictogram spends its area on a windscreen, doors, headlights and a
         length of track; at the 15px a badge is happy with, all of that closes
         into a smudge. 1.45 is where the four stay apart on a real map. */
      var ps = Math.round(s * 1.45);
      return '<span style="position:absolute;left:' + (-ps / 2) + "px;top:" + (-ps / 2) + "px;" +
        "width:" + ps + "px;height:" + ps + "px;border-radius:50%;" +
        "background:" + (color || "#1b2440") + ";border:1.5px solid #fff;box-sizing:border-box;" +
        'box-shadow:0 1px 3px rgba(0,0,0,.65);display:block;overflow:hidden">' +
        '<svg viewBox="0 0 24 24" width="100%" height="100%" style="display:block">' +
        PICT[key].replace(/\{c\}/g, color || "#1b2440") + "</svg></span>";
    }

    var body = GLYPH[key].replace(/\{c\}/g, color || "#1b2440");
    /* The white hairline border and the drop shadow are carried over from the
       dot: on a dark basemap a bare coloured badge dissolves into the tiles,
       and on a light one it loses its edge against the roads. */
    return '<span style="position:absolute;left:' + (-s / 2) + "px;top:" + (-s / 2) + "px;" +
      "width:" + s + "px;height:" + s + "px;border-radius:" + Math.round(s * 0.3) + "px;" +
      "background:" + (color || "#1b2440") + ";border:1.5px solid #fff;box-sizing:border-box;" +
      'box-shadow:0 1px 3px rgba(0,0,0,.65);display:block">' +
      '<svg viewBox="0 0 24 24" width="100%" height="100%" style="display:block">' + body + "</svg></span>";
  }

  /* ---- the bus hue -------------------------------------------------------
     Shape carries the mode and colour carries the line — but buses are the one
     mode with no line colour to carry. No agency here publishes one: WMATA,
     SEPTA, MTA and the German operators all brand their rail lines and leave
     the bus network unpainted, so whatever a bus is drawn in was picked by
     this project, arbitrarily, and every board had picked differently.

     Picked badly, too. Metrobus and the German `busx` family were both
     #6aa9ff, a light blue sitting a few units from the European boards' own
     metro blue (#4ea1ff) and beside WMATA's Blue Line; Ride On's two routes
     were a green and a blue that each shadowed a Metrorail line; and SEPTA's
     bus amber landed between the B line's orange and the G's yellow.

     A DARK blue is the answer. Blue was always the natural colour for a bus
     here; the failure was one of value, not hue — a light blue landing on top
     of light-blue metro lines. Dropped two steps in lightness it stops
     colliding with any of them: WMATA's Blue Line is cyan-leaning and lighter,
     the German metro blue is much lighter, and SEPTA's L carries a letter.
     Violet was tried first and rejected: it cleared every palette on paper and
     looked wrong on the map, which is the test that counts.

     The one to watch is NYC's A/C/E at #0039A6 — a genuine navy, and the
     closest thing in the repo to this. It is meaningfully darker, it carries a
     line letter, and it now differs in glyph too, so the pair still reads.

     Boston keeps its own: the Silver Line really is branded silver and Route 1
     yellow, so those are line colours, not invented ones. */
  var MODE_HUE = {
    bus:      "#2563eb",   // the mode's colour where the agency gives none
    busLight: "#93b4fb",   // the lighter half of a card's --sys/--sys2 gradient
  };

  function has(mode) {
    return String(mode || "").slice(0, 7).toLowerCase() === "letter:" ? true : !!resolve(mode);
  }

  root.TBVeh = { glyphHTML: glyphHTML, has: has, modes: GLYPH, alias: ALIAS, letterTile: letterTile, hue: MODE_HUE };
})(typeof window !== "undefined" ? window : this);
