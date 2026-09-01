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
    /* Bus: wider than it is tall, one long window band, wheels below the body. */
    bus:
      '<path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="#fff"/>' +
      '<path d="M6 6.5h12v4.5H6z" fill="{c}"/>' +
      '<circle cx="8" cy="18.4" r="2" fill="#fff"/><circle cx="16" cy="18.4" r="2" fill="#fff"/>' +
      '<circle cx="8" cy="18.4" r=".8" fill="{c}"/><circle cx="16" cy="18.4" r=".8" fill="{c}"/>',
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
    m = ALIAS[m] || m;
    return GLYPH[m] ? m : null;
  }

  /* Returns the inner HTML of a marker glyph, or "" when the mode is unknown
     — callers treat "" as "fall back to the dot you already drew".

     `size` is the glyph box in px. The badge is a rounded square rather than a
     circle because a circle wastes its corners on a vehicle silhouette that is
     itself wider than tall, and the squarer outline is easier to tell from the
     round station dots the boards draw underneath. */
  function glyphHTML(mode, color, size) {
    var key = resolve(mode);
    if (!key) return "";
    var s = size || 15;
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

  function has(mode) { return !!resolve(mode); }

  root.TBVeh = { glyphHTML: glyphHTML, has: has, modes: GLYPH, alias: ALIAS };
})(typeof window !== "undefined" ? window : this);
