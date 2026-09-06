/* ============================================================================
   fit-cards.js — one non-scrolling screen on every board, at every size.

   WHY THIS IS A SHARED FILE AND NOT ELEVEN COPIES. All of this began as an
   inline block in dc.html, which is exactly the trap theme.css's own
   "Structural grid fit" note describes: a fix landed on one board, and the
   other ten kept the bug until someone hand-patched each of them. Everything
   here is board-agnostic -- it measures .cards, .card and main > .col, which
   every board's markup has in the same shape (confirmed across all eleven) --
   so it belongs in one file that every board loads.

   The CSS ships from here rather than from theme.css for two reasons: an
   injected <style> lands after every board's own inline <style>, so it wins
   ties on source order without needing an arms race of `body` qualifiers, and
   keeping it next to the JS that sets --tb-card-max/--tb-card-cols/
   --tb-card-floor means the two halves of one mechanism cannot drift apart.
   feedback.js already ships its CSS the same way.

   WHAT IT DOES, in one sentence per piece:
     - forces --ui-zoom to 1 across 481-1220px, because shrinking the whole
       1600x900 board to fit a tablet is what made the text unreadable;
     - reflows that band into a compact layout that fits at real text size;
     - measures the largest card ceiling that still lets every card land on
       screen, at every width including desktop, and re-measures on resize;
     - adds Settings -> Map, which hands the map's height to the boxes.
   ============================================================================ */
(function () {
  "use strict";

  const css = `
/* ---- map off (Settings -> Map) -------------------------------------------
   The whole point is the height, so the map's grid ROW has to go, not just
   the map: leaving a collapsed track behind would hand the boxes the pixels
   but keep the gap. \`main\` is a two-row grid when stacked (map, cards) and
   a two-COLUMN one side-by-side on a wide screen, so both cases are set
   here rather than assuming the stacked one. The legend is the map's, so it
   goes with it. */
:root[data-map="off"] #map, :root[data-map="off"] .legend{display:none}
:root[data-map="off"] main{grid-template-columns:1fr; grid-template-rows:1fr}
:root[data-map="off"] main > .col:first-child{display:none}

/* ---- compact tablet layout (481-1220px): one page, real text size --------
   Below ~1150px wide, autoDisplay()'s shrink-the-whole-board zoom crosses
   into unreadable: a departure row's 12.5px font measured 8.75px real at
   1133px wide and 5.8px real at 744px (iPad mini portrait) -- confirmed by
   reading the actual rendered font size, because a screenshot of either
   LOOKS fine (whatever displays a screenshot back rarely does it at the
   device's true 1:1 CSS pixel size). autoDisplay() now forces --ui-zoom to
   1 for this whole width band instead (see sizeCompactCards() below), which makes every \`calc(Npx / var(--ui-zoom))\` rule in
   theme.css and in each board's own <style> collapse back to plain Npx -- so this block
   only has to design the reflow itself: real text size, compact chrome, a
   shorter map, dense rows, and enough masonry columns that eight-plus cards
   still fit one non-scrolling screen instead of the zoom trick papering
   over a layout that never actually had room for them.

   Two tiers, not one: 601px wide (a Nexus 7, the case this was built
   against) and 1133px wide (iPad mini landscape) do not have the same
   amount of room to work with, and a single compact size tuned for the
   narrower one wastes the wider one's real estate -- or the reverse,
   doesn't fit. */
@media (min-width:481px) and (max-width:1220px){
  header{padding:8px 12px; gap:6px 10px}
  header .brandmark--sm{width:18px; height:18px; min-width:0; min-height:0; margin:0}
  header .title{font-size:14px}
  header .title small{font-size:10px; margin-left:5px}
  .city-picker select{padding:5px 20px 5px 9px; font-size:11px; border-radius:8px}
  .view-links{gap:5px}
  .view-links a{padding:4px 8px; font-size:11px; border-radius:7px}
  header button{padding:4px 7px; font-size:11px; border-radius:7px}
  header .clock .time{font-size:16px}
  header .clock .meta{font-size:9px; margin-top:1px}
  #map{border-radius:8px}
  /* \`body .card\`, not a bare \`.card\`: theme.css's premium pass sets
     \`body .card{padding:14px 16px}\` at (0,1,1), which outranks a bare class
     regardless of source order -- so this tier's compact padding never applied
     and every card on a tablet carried desktop padding. 28px of vertical
     furniture on a card the fitter had sized at 140px is a whole departure
     row: New York's subway card measured 68px of chrome against 73px of list,
     one row where there was room for two. Same trap the \`body .row\` rules
     below already work around. */
  body .card{padding:7px 9px}
  .card h2{margin:0 0 4px; font-size:10px; gap:5px}
  .card h2::before{height:10px}
  /* A card is a flex column with overflow:hidden, so anything in it that
     can shrink WILL, and shows up as text sliced through the middle rather
     than as a shorter card. Both the header and the statline are fixed,
     single-line furniture -- the list underneath is the part meant to give,
     and it already does via its own overflow-y. Without flex:none here the
     statline rendered as half a line of "4 live predictions · 12 vehicles
     mapped" jammed against the card's bottom edge, which reads as a
     rendering fault. nowrap on both for the same reason a two-line
     "BUSES — METROBUS" title is a wasted row at this size. */
  body .card h2{white-space:nowrap; overflow:hidden; flex:none}
  body .card h2 .t{overflow:hidden; text-overflow:ellipsis}
  body .statline{flex:none; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
}
@media (min-width:481px) and (max-width:767px){
  /* Tightest tier: a Nexus 7 (601x962) is the case this was built against.
     The map gives up height (clamp floor 130px, not 260px) since nine card
     types compete for a screen a tablet twice this wide gives to half as
     many, and rows drop their second line entirely -- car/track and
     scheduled-vs-live detail -- keeping only what answers "is something
     coming and when": badge, destination, live countdown.

     Two columns, and the height budget is what pays for them. CSS
     multi-column has no height to balance against (see the .cards note
     above -- that is deliberate), so the flow's height is roughly
     total-card-height / column-count, and nine cards only clear the fold
     here if that total stays under about twice the cards area. Three
     narrow columns (column-width 180px) does fit them all, and was tried
     first, but 180px leaves a row's destination track about 24px wide once
     the badge and countdown take their share -- "Glenmont" ellipsed to
     nothing, which defeats the point of showing the row at all. So:
     two ~285px columns that can actually print a destination, a map
     trimmed to buy back the height that costs, and a max-height low
     enough that nine cards still sum under the budget. The cost is rows
     per card (about three, not five); a data-heavy card's .list scrolls
     internally past that, the mechanism theme.css's own card-bounds note
     already relies on.

     The card bounds are dvh, not px, because the binding constraint is
     height and this tier spans two very different ones: a Nexus 7 is
     962px tall, an iPad mini in portrait 1133px. The fixed 104px cap
     tuned for the Nexus left 206px of dead space at the bottom of the
     iPad's column (71% fill) -- correct, but visibly unfinished. The
     ceiling has to satisfy 9 * (card + margin) / 2 columns <= the cards
     area, which is about 11.9dvh on the Nexus and 13.2dvh on the iPad;
     11.5dvh clears both with a little margin, and the px clamps keep it
     sane on screens shorter or taller than either. */
  body main{grid-template-rows:clamp(120px,15dvh,170px) 1fr}
  body .cards{column-width:250px; column-gap:10px}
  /* --tb-card-max is measured per layout by sizeCompactCards(); the clamp
     is the pre-JS fallback, and is why this still fits on first paint.
     min-height is wrapped in min() against the same ceiling because
     min-height WINS over max-height in CSS -- at 768x1024 the 9dvh floor
     resolved to 112px against a measured 100px ceiling, and the cards
     quietly overflowed the column at their floor instead. */
  body .card{min-height:min(clamp(72px,9dvh,112px), var(--tb-card-max, 112px));
    max-height:var(--tb-card-max, clamp(96px,11.5dvh,150px)); margin-bottom:8px}
  /* \`body .row\`, not a bare \`.row\`: theme.css's own \`body .row\` sets the
     track list at (0,1,1), and this file's later top-level \`.row\`/\`.row
     .dest\` density rules would otherwise win on source order at equal
     specificity. Matching (0,1,1) from the inline <style> (which parses
     after theme.css) is what actually lands these.

     The track COUNT is deliberately left alone. A row has four children --
     badge, the dest/sub wrapper, an empty spacer, and .times -- so cutting
     the list to three tracks pushed .times onto an implicit second grid
     row (the wrapped countdown), and, because \`auto\` tracks size against
     every item in the column, dragged column 1 out to .times' own width
     to boot: a 69px badge column inside a 147px row. Only the gap needs
     tightening here. */
  body .row{gap:6px}
  /* padding needs one more class than the rest: theme.css's \`.list .row\`
     (0,2,0) outranks \`body .row\` (0,1,1), so only \`body .list .row\` lands. */
  body .list .row{padding:3px 6px}
  body .row .sub, body .row .sched{display:none}
  body .row .dest{font-size:11.5px}
  body .row .live{font-size:12.5px}
  body .row .badge{min-width:26px; height:17px; line-height:17px; font-size:10px}
}
@media (min-width:481px) and (max-width:600px){
  /* The narrow end of the band needs a narrower column SUGGESTION, or it
     silently drops to a single column and nine cards stack: at 481px the
     cards box measures 449px, and 250px columns fit
     floor((449 + 10 gap) / 260) = 1. One column means nine cards share the
     column height instead of five, which at 413px of it works out to 38px
     a card -- under the measured ceiling's own 72px floor, so the floor
     clamps, the arithmetic stops being satisfiable, and four cards clip.
     205px restores two columns down to 481px ((449 + 10) / 215 = 2), which
     is what makes the ceiling solvable again. Two ~219px columns still
     leave a row's destination about 100px, well clear of the ~24px that
     made the three-column experiment unreadable. */
  body .cards{column-width:205px}
}
@media (min-width:768px) and (max-width:1220px){
  /* Roomier tier: an iPad in either orientation can afford a taller map and
     a second row per card -- car/track, scheduled time -- since 280px
     columns mean each card shares the height budget with two or three
     neighbours rather than a Nexus 7's five.

     The ceiling is measured, not fixed, for the reason spelled out on
     sizeCompactCards(): this tier alone spans 2 columns at 768px and 3 at
     1133px, and heights from a 744px-tall landscape iPad to a 1180px-tall
     portrait one. The 320px literal that used to sit here was tuned for
     the tall case and clipped three cards on the short one. The clamp is
     the pre-JS fallback; it is deliberately conservative, since being a
     little short on first paint is recoverable and overflowing is not. */
  body main{grid-template-rows:clamp(180px,26dvh,300px) 1fr}
  body .cards{column-width:280px; column-gap:12px}
  /* min() against the ceiling for the same reason as the tier above:
     min-height outranks max-height, so an unguarded floor overflows. */
  body .card{min-height:min(clamp(84px,11dvh,140px), var(--tb-card-max, 140px));
    max-height:var(--tb-card-max, clamp(96px,13dvh,300px)); margin-bottom:12px}
  /* \`body .row\`/\`body .list .row\` for the same specificity reasons as the
     tier above. */
  body .list .row{padding:4px 7px}
  body .row .dest{font-size:12px}
  body .row .sub{font-size:9.5px}
  body .row .live{font-size:13.5px}
  body .row .sched{font-size:9.5px}
}

/* ---- a card's furniture is never sliced ----------------------------------
   A card is a flex column with overflow:hidden, so anything in it that CAN
   shrink will, and a shrunk heading or statline shows up as text cut through
   the middle rather than as a shorter card. The list underneath is the part
   meant to give, and it has its own overflow-y for exactly that. This was
   already true inside the tablet band; it is true at every width.

   sizeCompactCards() now depends on it as well. It measures a card's
   furniture to work out how much room the card needs, and if squeezing a card
   could squeeze its heading, that measurement would move every time it was
   applied -- the layout would pump on every tick instead of settling. */
body .card h2, body .statline{flex:none}

/* ---- the board as a grid of identical tiles ------------------------------
   Switched on by sizeCompactCards() once it has worked out a tile size that
   tessellates the screen; see the long note there for why uniform beat
   content-sized. Everything here is driven by the four variables it sets, so
   the CSS has no opinion about the numbers -- only about the shape. */
:root.tb-grid body .cards{
  display:grid;
  grid-template-columns:repeat(var(--tb-card-cols, 3), minmax(0, 1fr));
  grid-auto-rows:var(--tb-card-h, 150px);
  gap:var(--tb-card-gap, 12px);
  align-content:start;
  column-width:auto; column-count:auto;
}
:root.tb-grid body .card{ margin:0; height:100%; min-height:0; max-height:none }
/* Whole rows only. The leftover sits under the last one, inside the card. */
:root.tb-grid body .card .list{ max-height:var(--tb-list-h, none) }
/* A collapsed card keeps its own height and sits at the top of its cell --
   the hole under it is the one thing multi-column was better at, and it is
   only ever seen by someone who has just collapsed something. */
:root.tb-grid body .card.mini{ height:auto; align-self:start }
:root.tb-grid body .cards.all-mini{ grid-auto-rows:min-content }

/* ---- the strip the iOS clock lives on ------------------------------------
   Every board sets viewport-fit=cover, and it has to: without it a notched
   phone letterboxes the board in black bars. What no board ever did was claim
   the strip back, so running one as an installed app on an iPad puts the
   system clock and battery directly on top of the wordmark -- which is the
   first thing anyone sees. The insets are 0 on a desktop, a TV and in an
   ordinary browser tab, so this costs those nothing.

   Restated per tier because CSS cannot add to a value it does not know: the
   base padding is the board's own 14px, this file's tablet band sets 8px, and
   each board's phone breakpoint sets 10px. */
body header{ padding-top:calc(14px + env(safe-area-inset-top, 0px)) }
body footer{ padding-bottom:calc(6px + env(safe-area-inset-bottom, 0px)) }
@media (min-width:481px) and (max-width:1220px){
  body header{ padding-top:calc(8px + env(safe-area-inset-top, 0px)) }
}
@media (max-width:480px){
  body header{ padding-top:calc(10px + env(safe-area-inset-top, 0px)) }
}

/* ---- a badge names the row; it is not allowed to become the row ----------
   The route badge is a label. On New York's LIRR card it carries the branch
   name, and "Greenport Service" measured 149px of a 326px row -- on a card
   362px wide -- which left "At Medford" 56px of the 62px it wanted. Widening
   the column does not help: the badge's track is \`auto\`, so it simply takes
   whatever it is given and the destination's minmax(0,1fr) track absorbs the
   whole loss. Cap the track instead, and let the badge elide inside it: which
   branch it is stays legible, and where the train is going comes back.

   Laid out as a centred line rather than a flex box because text-overflow
   does not apply to a flex container's anonymous text -- the badge would clip
   mid-letter at BOTH ends (justify-content:center) instead of eliding at one.
   line-height has to be restated wherever the height is, which is why it
   appears again in the tiers below and against Atlas's own rule. */
body .list .row{ grid-template-columns:fit-content(112px) minmax(0,1fr) auto auto }
body .list .row .badge{
  display:block; line-height:var(--badge-h, 22px); text-align:center;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
}
:root[data-style="atlas"] body .list .row .badge{ line-height:calc(var(--badge-h) * 1.2) }

/* ---- the dismiss control -------------------------------------------------
   Deliberately the same 18px chip as the collapse chevron beside it: these are
   the two things you can do to a box, and one of them looking like an
   afterthought is how you get a control nobody finds. Red only on hover --
   removing a box is reversible from Settings, so it does not need to look
   dangerous while you are reading past it. */
body .card h2 .card-x{margin-left:4px; flex:none; width:18px; height:18px; padding:0;
  line-height:1; display:flex; align-items:center; justify-content:center; cursor:pointer;
  background:transparent; color:var(--muted); border:1px solid var(--line); border-radius:4px;
  font-family:var(--mono); font-size:11px; transition:color .18s ease, border-color .18s ease}
body .card h2 .card-x:hover{color:var(--late-ink,#ff6b81); border-color:var(--late-ink,#ff6b81)}

/* ---- the cards column, when it has to scroll -----------------------------
   theme.css already makes this column the scroll boundary. What it did not do
   is admit to it: a board whose last row of boxes is cut by the bottom of the
   screen looks broken, and nothing on it suggests the rest is a swipe away.
   A fade pinned to the foot of the visible area says there is more, and it
   clears at the end so it never becomes permanent furniture that stops
   meaning anything -- the same rule the cards' own .has-more fade follows.

   position:sticky rather than a mask on the container: a mask over a
   scrolling box repaints the whole box on every frame of a touch scroll,
   which is exactly the cost this file exists to avoid on a tablet. */
/* Forcing the column COUNT, when sizeCompactCards() has worked out that one
   more, narrower column is what makes the boxes fit. column-width has to go to
   auto for a count to be obeyed at all: with both set, the used count is
   min(count, what the width allows), so the tier's own 280px suggestion would
   pin it straight back down. */
:root.tb-cols-forced body .cards{ column-width:auto; column-count:var(--tb-card-cols, 3) }

main > .col.tb-scrolls{ overscroll-behavior:contain; -webkit-overflow-scrolling:touch }
main > .col.tb-scrolls::after{
  content:""; display:block; flex:none; position:sticky; bottom:0; z-index:2;
  height:30px; margin-top:-30px; pointer-events:none;
  background:linear-gradient(180deg, transparent, var(--bg));
  transition:opacity .18s ease;
}
main > .col.tb-scrolls.tb-scroll-end::after{ opacity:0 }

/* ---- tight cards: chrome gives way to data ------------------------------
   Set per card by sizeCompactCards() when the room THAT CARD was allotted
   lands under ~130px. Per card, not per board: on one screen the trains card
   can be 240px and the commute card 70px, and only the second has to give
   anything up. (It used to be one class on <html>, from a single ceiling
   shared by every card -- the uniform sizing that made a tablet render twelve
   identical slivers.) Whether a card can afford its own chrome is also a
   different question from how wide the screen is: 1133x744 with the map shown
   gets tighter cards than a Nexus 7, while the same iPad in portrait with the
   map hidden has room to spare.

   Below ~130px a card has about four lines total, and spending two of them on
   chrome leaves too little of what the card is for. */
body .card.tb-tight h2{margin-bottom:3px}
body .card.tb-tight h2 .count{display:none}
body .card.tb-tight .statline{display:none}

/* ---- desktop (>1220px): the same measured fit ---------------------------
   The board's own design size clipped four of its nine cards: theme.css's
   360px ceiling and 330px column-width gave two columns five cards deep at
   1600x900, and the cards column simply scrolled the rest away. The width
   was never the problem there -- a desktop has width to spare -- so the fix
   is to spend it on a third column and let sizeCompactCards() set the
   ceiling from what actually fits, exactly as it does on a tablet.

   column-width:auto is load-bearing: with both a width and a count set, CSS
   uses min(count, what the width allows), so leaving 330px in place would
   have pinned the count back to two and undone the whole thing. The literal
   2 in the fallback is what this board already resolved to before any of
   this, so a first paint (or a JS failure) is no worse than it was.

   min-height is capped against the ceiling for the same reason as the
   tablet tiers: min-height outranks max-height, so an unguarded floor
   overflows the column instead of being trimmed. */
@media (min-width:1221px){
  /* ATLAS (the shipped widescreen design: full-bleed map, cards in a flex
     rail). Only the per-card floor needs touching. Atlas's own 8em floor is
     sized in its comment for "seven cards ... of the 1080px rail"; at nine
     cards on a 900px-tall screen that floor asks for 1152px of a ~900px
     rail and four cards fall off the bottom. min() keeps 8em wherever it
     still fits -- a tall screen, or fewer cards after hiding some in
     Settings -- and yields only where the rail genuinely cannot pay for it.
     --tb-card-floor is measured by sizeCompactCards() from the rail itself,
     so it tracks the card count and the viewport without a breakpoint.

     Specificity has to match Atlas's own (0,2,2) selector to land; this
     file's inline <style> parses after theme.css, so an equal-specificity
     rule here wins. Kept deliberately narrower than Atlas's \`.card.mini\`
     rule (0,3,1), which must still collapse a minimised card to nothing. */
  :root[data-style="atlas"] body .card{min-height:min(8em, var(--tb-card-floor, 8em))}

  /* Set by sizeCompactCards() when the rail's own arithmetic leaves under
     ~110px a card -- nine cards on a 900px-tall screen is 84px, against
     ~101px of heading + padding + one departure. Without this the card
     "fits" and shows nothing: a heading with its row clipped off below.
     Dropping each row's second line (car/track, scheduled-vs-live) is what
     pays for it -- a row goes from ~58px to ~30px, a card to ~61px, and
     nine of those clear the rail with room for a second row in places.
     Specificity is (0,3,1), deliberately above Atlas's own (0,2,2) rules
     and still below its (0,3,1)+ \`.card.mini\` collapse. */
  :root.tb-rail-tight[data-style="atlas"] body .card{padding:5px 0 6px}
  /* The heading has to shrink too, not just lose its margin. Atlas renders it
     at 28px, and on a board with a lot of cards that is most of the budget:
     New York carries eleven, which is 69px a card in a 764px rail against
     5 + 28 + 36 + 6 = 75px of content -- six pixels short, so every one of
     the eleven showed a heading and no departure. Taking the heading to
     ~16px and the row to ~32px brings a card to ~59px, inside the 69px it
     actually has. */
  :root.tb-rail-tight[data-style="atlas"] body .card h2{margin:0 0 2px; white-space:nowrap; overflow:hidden; flex:none;
    font-size:10px; line-height:1.3; padding-bottom:2px}
  :root.tb-rail-tight[data-style="atlas"] body .card h2::before{height:9px}
  /* Shrinking the heading's FONT is not enough on its own: Atlas gives the
     heading 9px of bottom padding and its collapse control is an 18px chip,
     so the heading measured 28px with a 10px font -- and those 12 wasted
     pixels were exactly what kept the alert and Today's Best rows (35-36px)
     out of a 27px gap. */
  :root.tb-rail-tight[data-style="atlas"] body .card h2 .mini-btn,
  :root.tb-rail-tight[data-style="atlas"] body .card h2 .card-x{height:14px; width:auto; padding:0 4px; font-size:9px}
  :root.tb-rail-tight[data-style="atlas"] body .card h2 .count{font-size:9px}
  :root.tb-rail-tight[data-style="atlas"] body .card h2 .t{overflow:hidden; text-overflow:ellipsis}
  :root.tb-rail-tight[data-style="atlas"] body .statline{display:none}
  :root.tb-rail-tight[data-style="atlas"] body .list .row{padding:2px 7px}
  /* .route is here for the same reason .sub is, and leaving it out is what
     made Planes overhead the odd card on a tight rail. A plane row carries a
     THIRD line the transit rows do not -- tail number, bearing, heading,
     squawk -- so hiding the other two still left it 44px against the 32-36px
     everything else had compressed to. In a 59px list that is the difference
     between one aircraft and two, and the line it was spending the room on
     was ellipsised down to "N825AW · 1.5 nm SW · hdg …" anyway. The row still
     names the aircraft and its operator badge; the radio detail is what the
     map is for. */
  :root.tb-rail-tight[data-style="atlas"] body .row .sub,
  :root.tb-rail-tight[data-style="atlas"] body .row .route,
  :root.tb-rail-tight[data-style="atlas"] body .row .sched{display:none}
  /* The per-stop and per-direction labels ("FRIENDSHIP HEIGHTS · 1.2 MI")
     sit INSIDE the list, above the departures they group. With one line to
     spend, a card that has them spent it on the label and showed no
     departure at all -- which is why Trains, Buses and Ride On were still
     blank after the row compression above while Amtrak and MARC, which have
     no labels, were fine. The row itself names its destination, so the
     grouping header is the more expendable of the two. */
  :root.tb-rail-tight[data-style="atlas"] body .stop-label,
  :root.tb-rail-tight[data-style="atlas"] body .dir-label{display:none}
  /* Hiding a row's second LINE is not the whole story: the badge and the
     countdown are 26px tall in Atlas each on their own, so a row stayed 44px
     on the boards whose rows carry a status ("Approaching Harlem-125 St") --
     which is why New York's Metro-North, its alerts, Spotted and Today's Best
     still showed nothing while the plainer cards were fine. These bring a row
     to ~30px so the first one clears a 69px card, which is what eleven cards
     in a 764px rail leaves. .empty and .row.top are the same problem in the
     cards that do not render ordinary departures. */
  :root.tb-rail-tight[data-style="atlas"] body .row .badge{height:16px; line-height:16px; min-width:22px; font-size:9px; padding:0 5px}
  :root.tb-rail-tight[data-style="atlas"] body .row .dest{font-size:11px; line-height:1.2}
  :root.tb-rail-tight[data-style="atlas"] body .row .live,
  :root.tb-rail-tight[data-style="atlas"] body .row .live-eta{font-size:11.5px; line-height:1.2}
  :root.tb-rail-tight[data-style="atlas"] body .row .times{gap:0}
  :root.tb-rail-tight[data-style="atlas"] body .list .empty{padding:3px 4px; font-size:11px; line-height:1.25}
  :root.tb-rail-tight[data-style="atlas"] body .alert-row{gap:5px}
  :root.tb-rail-tight[data-style="atlas"] body .alert-row .sev{font-size:9px}
  /* Spotted is a logging widget rather than a departure feed, so its content
     is the RAIL/BUS/AIR chips beside a 40px mascot -- which overran a 69px
     card by two pixels and left the card silent. The mascot is the part with
     no information in it. */
  :root.tb-rail-tight[data-style="atlas"] body .spot-collect{gap:6px}
  :root.tb-rail-tight[data-style="atlas"] body .spot-mascot{height:22px; width:auto}
  /* Service alerts are not .row items and so were untouched by the row
     compression: a single alert is ~54px (severity chip, agency, then a
     two-to-three-line message) against the ~45px a tight card has under its
     heading, and Atlas's own fitter answered by cutting the alert entirely
     (data-atlas-cut, visibility:hidden) -- leaving a "Service alerts, 4
     active" heading over nothing. Clamping the message to one line takes
     the row to ~34px, so the alert survives the cut and the card says which
     line is affected, which is the part that matters at a glance. */
  :root.tb-rail-tight[data-style="atlas"] body .alert-row .msg{
    display:-webkit-box; -webkit-line-clamp:1; -webkit-box-orient:vertical;
    overflow:hidden; line-height:1.25}

  /* NON-ATLAS widescreen (masonry, if the Atlas style is ever off): the
     count comes from sizeCompactCards(), and column-width must be auto for
     it to be obeyed at all. The literal 2 matches what this board already
     resolved to, so a first paint is no worse than before. */
  :root:not([data-style="atlas"]) body .cards{column-width:auto; column-count:var(--tb-card-cols, 2)}
  :root:not([data-style="atlas"]) body .card{
    min-height:min(clamp(96px,12dvh,150px), var(--tb-card-max, 150px));
    max-height:var(--tb-card-max, 360px)}
}
`;

  /* ---- inject ------------------------------------------------------------
     Appended to <head> so it lands after each board's own <style>, which is
     what lets these rules win ties without extra specificity. */
  function injectCss(){
    if (document.getElementById("tbFitCss")) return;
    const s = document.createElement("style");
    s.id = "tbFitCss";
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  injectCss();

  /* ---- the zoom bypass ---------------------------------------------------
     Each board has its own autoDisplay()/applyDisplay() pair that scales the
     whole board with `zoom` to make a 1600x900 design fit a smaller screen.
     Between 481 and 1220px that trade is a bad one: it fits, and nobody can
     read it (a 12.5px departure measured 5.8px real on an iPad mini in
     portrait). Rather than patch eleven copies of autoDisplay, pin the
     variable those copies feed -- every `calc(Npx / var(--ui-zoom))` rule in
     theme.css then collapses back to plain Npx and the compact layout below
     designs the band honestly, at real size.

     Deliberately NOT applied to a television (looksLikeTv), which needs the
     opposite treatment: a TV is short of viewing ANGLE, not pixels, and its
     board is scaled UP on purpose. */
  function isTv(){
    try { return typeof looksLikeTv === "function" && looksLikeTv(); } catch (_) { return false; }
  }
  function pinZoom(){
    const w = innerWidth, root = document.documentElement;
    if (w >= 481 && w <= 1220 && !isTv()) root.style.setProperty("--ui-zoom", "1");
  }

  /* ---- the card ceiling, measured rather than guessed --------------------- */
  /* The card ceiling, measured rather than guessed. Every width from 481px up,
     desktop included.

     A fixed max-height per breakpoint cannot be right, because what the ceiling
     has to satisfy is cards * (height + margin) <= columns * available, and BOTH
     of those move independently of the width a breakpoint keys on: the column
     count steps 2 -> 3 partway up, the available height swings with the viewport
     (an iPad mini is 744px tall in landscape and 1133 in portrait), turning the
     map off adds ~200px outright, and the card COUNT itself changes as cards are
     hidden in Settings or added to the board. Tuning a px value for one of those
     combinations mis-fits the others -- a 320px ceiling meant for a tall screen
     clipped three cards at 1133x744, a 104px one tuned for a Nexus 7 left 206px
     of dead space on a taller iPad, and the 360px desktop ceiling clipped four
     of nine cards at 1600x900, the board's own design size.

     So: measure the column box, settle the column count, and hand back the
     largest ceiling that still lets every card land inside. The floor keeps a
     card readable if that arithmetic ever gets pessimistic; past it, a card's
     own .list scrolls, as it already does. */
  /* ---- how much furniture a card carries ---------------------------------
     Padding, borders, and every child that is not the list -- the heading and
     the statline. Measured rather than assumed because it moves with the tier
     (7px of padding on a tablet, 14 on a desktop) and with whether the
     statline is showing at all. It has to be a FIXED quantity for the
     allocation below to converge, which is what the `flex:none` rule on those
     two elements guarantees: if squeezing a card could squeeze its heading,
     the measurement that decides how far to squeeze it would move every time
     it was applied, and the layout would pump instead of settle. */
  function chromeOf(card, list){
    const cs=getComputedStyle(card);
    let h=parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom)+
          parseFloat(cs.borderTopWidth)+parseFloat(cs.borderBottomWidth);
    for(const el of card.children){
      if(el===list) continue;
      const r=el.getBoundingClientRect();
      if(!r.height) continue;
      const es=getComputedStyle(el);
      h+=r.height+(parseFloat(es.marginTop)||0)+(parseFloat(es.marginBottom)||0);
    }
    return Math.ceil(h);
  }
  /* What a list actually holds. The same rendered-children span each board's
     fitList() takes -- repeated here because not every card's list is in a
     board's LIST_IDS (alerts, Spotted, Track record and the commute card all
     manage their own), and this has to work for all of them. A larger
     data-want wins: a card that renders to fit its box measures small by
     definition, so its own claim is the honest one. */
  function contentH(list){
    let top=Infinity, bottom=-Infinity;
    for(const k of list.children){
      const r=k.getBoundingClientRect();
      if(!r.height && !r.width) continue;
      if(r.top<top) top=r.top;
      if(r.bottom>bottom) bottom=r.bottom;
    }
    const span=bottom>top ? Math.ceil(bottom-top) : 0;
    return Math.max(span, Number(list.dataset.want)||0);
  }
  /* One of whatever this card shows -- a departure row, an alert, a chip. Used
     for the floor, so "at least two of them" means two of the right thing
     rather than two of some assumed 34px. */
  function firstRowH(list){
    for(const k of list.children){
      const r=k.getBoundingClientRect();
      if(r.height) return r.height;
    }
    return 30;
  }
  /* The column width the STYLESHEET suggests for this tier, which is what the
     natural column count is worked out from. Reading it means switching this
     file's own forced count off first, or the second run reads back the
     `auto` it wrote and computes the count from a fallback instead -- a board
     that once bought a column would then keep buying from a worse and worse
     starting point.

     Cached, because that remove-read-restore forces a full style recalc and
     layout, and on a board carrying a Leaflet map with several hundred markers
     that is most of the cost of a refit. The value depends only on which media
     query is matching, so it cannot change unless the viewport width does. */
  let natColW=0, natColWAt=-1;
  function naturalColW(root, box, w){
    if(natColWAt===w && natColW) return natColW;
    const had=root.classList.contains("tb-cols-forced");
    if(had) root.classList.remove("tb-cols-forced");
    natColW=parseFloat(getComputedStyle(box).columnWidth)||280;
    if(had) root.classList.add("tb-cols-forced");
    natColWAt=w;
    return natColW;
  }
  function clearCardHeights(){
    document.querySelectorAll(".cards .card").forEach(c=>{
      c.style.removeProperty("max-height");
      c.style.removeProperty("min-height");
      c.classList.remove("tb-tight");
    });
  }

  function sizeCompactCards(){
    const root=document.documentElement, box=document.querySelector(".cards");
    const w=(typeof viewportW==="function") ? viewportW() : innerWidth;
    /* Every variable AND the class have to be cleared on the way out, not just
       some: the tight class is keyed on the measurement rather than the width,
       so a board dragged from a tablet width out to a phone one kept it and
       went on hiding every statline. The per-card inline heights are part of
       that now -- they are the strongest thing in the cascade, so leaving one
       behind pins a card to a size no stylesheet can argue with. */
    const reset=()=>{
      root.style.removeProperty("--tb-card-max");
      root.style.removeProperty("--tb-card-cols");
      root.style.removeProperty("--tb-card-floor");
      root.classList.remove("tb-cards-tight");
      root.classList.remove("tb-rail-tight");
      root.classList.remove("tb-cols-forced");
      root.classList.remove("tb-grid");
      root.style.removeProperty("--tb-card-h");
      root.style.removeProperty("--tb-list-h");
      root.style.removeProperty("--tb-card-gap");
      clearCardHeights();
    };
    /* Below 481px the phone layout takes over -- a genuinely different,
       scrolling design where none of this applies. */
    if(!box || w<481){ reset(); return; }
    const col=box.parentElement; if(!col) return;
    const cards=[...box.children].filter(c=>c.classList.contains("card")
      && !c.classList.contains("user-hidden") && getComputedStyle(c).display!=="none");
    if(!cards.length){ reset(); return; }
    const H=col.clientHeight; if(!(H>0)) return;

    /* Past 1220px the board is a different design, not a wider one: theme.css's
       Atlas block (itself wrapped in @media (min-width:1221px), which is why
       none of it reaches the tablet tiers) turns the map full-bleed and stacks
       the cards into a single flex RAIL down one side. There is no masonry to
       count columns in, and max-height is not the lever -- what overflows is
       the per-card min-height FLOOR. Atlas sets that to 8em, and its own note
       sizes the choice as "seven cards at this floor is 896px of the 1080px
       rail". The board now carries nine, and a 900px-tall screen has a ~900px
       rail: 9 x 128px = 1152px against 900, which is exactly the four clipped
       cards. Capping the floor at the rail's own arithmetic keeps 8em wherever
       it still fits and only gives ground where it does not.

       Detect by display, not by width or by the style attribute: data-style
       stays "atlas" at every width, but the styling only applies over 1220px,
       so the computed display is the only honest signal for which layout is
       actually painting. */
    const isRail = getComputedStyle(box).display === "flex";
    if(w>1220 && isRail){
      const railH=box.clientHeight;
      const per=railH>0 ? Math.max(44, Math.floor(railH/cards.length)) : 0;
      if(per) root.style.setProperty("--tb-card-floor", per+"px");
      /* Lowering the floor alone is not enough once it drops under what a
         heading plus one departure actually occupies. Measured in Atlas: 14+16
         padding, a 28px heading and a 52-58px row -- about 101px of content.
         Nine cards into a 764px rail is 84px each, so every card rendered as a
         heading with its single row clipped away underneath: all nine "fitted"
         and none of them said anything, which is worse than the four that used
         to clip. Under ~110px the rail also has to compress what a card is
         MADE of (see .tb-rail-tight), which takes a card to ~61px and buys back
         room for the row -- and sometimes a second one. */
      root.classList.toggle("tb-rail-tight", per>0 && per<110);
      root.style.removeProperty("--tb-card-max");
      root.style.removeProperty("--tb-card-cols");
      root.classList.remove("tb-cards-tight");
      root.classList.remove("tb-cols-forced");
      root.classList.remove("tb-grid");
      root.style.removeProperty("--tb-card-h");
      root.style.removeProperty("--tb-list-h");
      clearCardHeights();
      return;
    }
    root.style.removeProperty("--tb-card-floor");
    root.classList.remove("tb-rail-tight");

    /* ---- the masonry: how many columns, and how tall each card may be -----

       WHAT WAS WRONG. This used to hand every card the SAME ceiling --
       floor(H / cards-per-column) - gap -- and the CSS applied it as both the
       min-height and the max-height, so every box on the board came out
       exactly as tall as every other one whatever it held. On DC's twelve
       cards that arithmetic lands on 85px at 1180x820 and 77px at 1024x768:
       a heading and ONE departure, in twelve identical tiles, with the
       statline and the count suppressed to make even that fit. It is the
       correct answer to the question "what uniform height fits?" and the
       question is the wrong one. Service alerts with one notice does not need
       the same room as Metrorail with twelve trains, and taking it means the
       trains card cannot have it.

       WHAT IT DOES NOW. Each card asks for what it actually holds; the
       screen's height is shared out by water-filling, so a card wanting less
       than its fair share releases the rest to the hungry ones; and no card
       is squeezed below two of whatever it shows. If even those floors do not
       fit -- twelve boxes on a 768px screen that is also carrying a map -- the
       cards column scrolls, which it is already set up to do. A board that
       says "two departures each, scroll for the last row" is worth looking
       at. Twelve identical slivers is not. The two levers that make it fit on
       one screen are both the reader's: Settings -> Map -> Hidden gives the
       boxes the map's whole height, and any box can now be dismissed
       outright. */
    const bcs=getComputedStyle(box);
    const cgap=parseFloat(bcs.columnGap)||12;
    let cols;
    if(w>1220){
      /* Non-Atlas widescreen (the masonry layout, if the Atlas style is off):
         width is spare and height is the constraint, so spend the width on
         MORE columns to keep cards tall. column-width has to go to auto for
         column-count to be obeyed -- with both set the used count is
         min(count, what the width allows), so an inherited 330px would pin it
         back down. The readability floor is in REAL pixels, divided by the
         board zoom, because #app is zoomed on desktop and 280 local px at 0.8
         renders as 224; 280 is where a row's destination stops truncating
         real names. */
      const zoom=parseFloat(getComputedStyle(root).getPropertyValue("--ui-zoom"))||1;
      cols=Math.max(1, Math.floor((box.clientWidth+cgap)/(280/zoom+cgap)));
      root.style.setProperty("--tb-card-cols", String(cols));
      root.classList.add("tb-cols-forced");
    }else{
      /* Counted from the column WIDTH, not from where the cards happened to
         land. Reading the count back off the cards' left edges (which is what
         this did) makes it depend on the heights being assigned here, and a
         count that depends on the heights that depend on the count is a loop:
         it settles at some sizes and flip-flops between two and three columns
         at others, which is the layout visibly pumping on a resize. The
         browser picks the count from the available width alone, so this can
         work it out the same way and never has to guess. */
      cols=Math.max(1, Math.floor((box.clientWidth+cgap)/(naturalColW(root,box,w)+cgap)));
      /* Guarded: writing the same value back still invalidates style, and this
         runs on every data tick. */
      if(root.classList.contains("tb-cols-forced")){
        root.classList.remove("tb-cols-forced");
        root.style.removeProperty("--tb-card-cols");
      }
    }

    /* ---- one uniform tile, sized so a whole number of them fills the screen

       WHY THIS IS UNIFORM AGAIN. Sizing each card to its own content is the
       right answer on a page you scroll and the wrong one on a board, and a
       photograph of a real iPad settled it. Thirteen cards of thirteen
       different heights flow into columns that end wherever they happen to
       end, so the bottom of the screen cuts the last card of every column
       through the middle of a departure row: four half-rows across the foot of
       the board. It reads as a rendering fault however good the arithmetic
       above it was, because the eye reads the ragged edge and not the
       reasoning.

       So: every box the same size, and that size chosen so that a whole number
       of them exactly fills the height available. The bottom edge comes out
       flush, the scroll boundary falls between two rows instead of through
       one, and the thing looks like a board.

       HOW THE SIZE IS CHOSEN. Take the most tile-rows that still leaves each
       tile room for two departures; failing that, one. Fewer, fuller tiles
       beat more, emptier ones -- two departures is the least a box can show
       and still be worth its own heading -- but not at the cost of pushing
       half the board off the screen, which is why it starts from the number of
       rows the cards actually need and comes down rather than up.

       A CSS grid, not the multi-column flow. theme.css moved these cards to
       multi-column so that collapsing one would not leave a hole in its row,
       which is a real cost -- but it is a cost paid only by someone who
       collapses a card, and it buys away a defect that everybody sees all of
       the time. */
    const gap=parseFloat(getComputedStyle(cards[0]).marginBottom)||12;

    /* Measured across the whole board, because the tile is uniform: whatever
       the bulkiest furniture is, every tile has to be able to hold it, or the
       card that has it is the one that comes out sliced.

       The row height is the MEDIAN of the real departure rows, not the tallest
       thing any list happens to start with. Spotted opens with a 62px mascot
       block and the alerts card with a three-line notice; sizing every tile on
       the board to those would be letting the two cards nobody is looking at
       decide how much room the trains get. */
    let wantMax=0;
    const chromes=[], open=[];
    for(const c of cards){
      if(c.classList.contains("mini")) continue;    // collapsed: sizes itself
      open.push(c);
      /* Only cards with a departure list get a vote on the tile size. Without
         this guard chromeOf() counts a listless card's WHOLE body as
         furniture -- the commute card's prompt and button came to 117px of
         "chrome" against a real card's 54 -- and every tile on the board was
         then sized to hold it, which is 63px of dead space in each of them
         and two fewer departures in the cards anyone is reading. A card with
         no list has no rows to protect; it just lives inside whatever tile
         the rest of the board settles on. */
      const list=c.querySelector(".list");
      if(!list) continue;
      const chrome=chromeOf(c, list);
      chromes.push(chrome);
      const content=contentH(list);
      if(chrome+content>wantMax) wantMax=chrome+content;
    }
    /* The MEDIAN card's furniture, not the bulkiest card's. Sizing every tile
       on the board so that the one card with a wrapped heading or an extra
       line of statline still gets two rows costs every other card a row: one
       117px outlier against a typical 54 put 63px of dead space in all
       thirteen tiles and took New York's subway card from three departures to
       two. The outlier keeps its furniture -- the heading and statline are
       flex:none and cannot be sliced -- it just shows one fewer row than its
       neighbours, which is the right card to spend it on. */
    chromes.sort((a,b)=>a-b);
    const chromeMax=chromes.length ? chromes[Math.floor(chromes.length/2)] : 54;
    if(!open.length) return;
    const rowHs=[...box.querySelectorAll(".list .row")]
      .map(r=>r.getBoundingClientRect().height).filter(x=>x>0).sort((a,b)=>a-b);
    const rowH=rowHs.length ? rowHs[Math.floor(rowHs.length/2)] : 34;
    const listGap=parseFloat(getComputedStyle(open[0].querySelector(".list")||open[0]).rowGap)||2;

    const rowsNeeded=Math.ceil(cards.length/cols);
    const tileFor=kk=>(H+gap)/kk-gap;                       // exact fill for kk rows
    const rowsIn=hh=>Math.floor((hh-chromeMax+listGap)/(rowH+listGap));
    let k=0;
    for(let kk=rowsNeeded; kk>=1; kk--){ if(rowsIn(tileFor(kk))>=2){ k=kk; break; } }
    if(!k) for(let kk=rowsNeeded; kk>=1; kk--){ if(rowsIn(tileFor(kk))>=1){ k=kk; break; } }
    if(!k) k=1;

    let tile=tileFor(k);
    /* When every card is already on screen there is no scroll boundary to line
       up with, so stop the tiles growing past what the fullest card can even
       use: a 400px box around one departure is dead space, not generosity.
       When it does NOT all fit, the exact figure is the whole point. */
    if(k>=rowsNeeded) tile=Math.min(tile, Math.max(chromeMax+rowH*2+listGap, wantMax));
    /* Floor, never round. Rounding 194.5 up to 195 makes two tiles plus their
       gap 402px in a 401px column, and the second row is then one pixel past
       the fold -- which is a scrollbar, a fade, and a row of cards reported as
       clipped, for half a pixel of nothing. */
    tile=Math.floor(tile);

    /* And quantise the list inside the tile to whole rows, or the slicing just
       moves indoors: a tile with room for 1.7 rows shows one departure and the
       top 30% of another, which is the same defect in a smaller frame. The few
       pixels left over sit under the last row, inside the card, where they
       read as padding. */
    const r=Math.max(1, rowsIn(tile));
    const listH=Math.round(r*rowH+(r-1)*listGap);

    const set=(name,val)=>{ if(root.style.getPropertyValue(name)!==val) root.style.setProperty(name,val); };
    set("--tb-card-cols", String(cols));
    set("--tb-card-h", tile+"px");
    set("--tb-card-gap", gap+"px");
    set("--tb-list-h", listH+"px");
    root.classList.add("tb-grid");
    root.style.removeProperty("--tb-card-max");
    root.classList.remove("tb-cards-tight");
    clearCardHeights();
    /* Whether a tile can afford its own chrome is a question about the tile,
       and every tile is the same now. ~130px is where a heading, a statline
       and two rows stop fitting. */
    const tight=tile<130;
    open.forEach(c=>c.classList.toggle("tb-tight", tight));

    /* Say so when the boxes did not all fit. The cut now lands between two
       rows rather than through one, which is most of the fix -- but a screen
       that simply stops, with nothing to say there is more below it, still
       reads as the end of the board. */
    const over=col.scrollHeight>col.clientHeight+4;
    col.classList.toggle("tb-scrolls", over);
    if(over && !col._tbScroll){
      col._tbScroll=true;
      col.addEventListener("scroll", ()=>{
        col.classList.toggle("tb-scroll-end",
          col.scrollTop+col.clientHeight >= col.scrollHeight-4);
      }, {passive:true});
    }
    if(!over) col.classList.remove("tb-scroll-end");
  }

  /* ---- every box can be got rid of ---------------------------------------
     The house rule on these boards is that anything on the screen has to have
     a way off it. Two things were missing.

     FIRST, two cards had no switch at all. Settings' "Show on board" list is
     built from each board's own CARD_DEFS, and a card that is not in that
     array simply does not appear in it -- so Service alerts and Spotted
     arrived on somebody's kiosk with no way to remove them, which is not a
     decision this file gets to make for them. Rather than name them (the next
     board, and the next card, would have the same gap), this walks whatever
     cards are actually on the page and registers any that nothing else
     claimed. CARD_DEFS is a top-level const, but an array is mutable, so a
     push buys the checkbox, the saved state and applyCardVis()'s .user-hidden
     handling with no change to any board.

     SECOND, a checkbox buried in a settings panel is not the same as being
     able to dismiss something. Every card gets an x next to its collapse
     chevron, and it writes through the board's own saved list, so the
     Settings checkbox is where you go to bring it back. */
  function cardLabel(card){
    const h=card.querySelector("h2");
    if(!h) return card.id;
    const t=h.querySelector(".t");
    /* Text nodes only where a card's heading has no .t span. The headings that
       lack one carry controls as well as a title -- Spotted's heading holds a
       "near here" range button -- and sweeping up every child element labelled
       it "Spotted near here" in the settings list. A card's own words are the
       bare text; everything wrapped in an element is furniture. */
    let s=t ? t.textContent
            : [...h.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(" ");
    s=(s||"").replace(/\s+/g," ").trim();
    /* Em-dashed titles ("Trains — Metrorail") are the card's own subtitle; the
       settings list wants the short name, the way the hand-written entries in
       every board's CARD_DEFS already read. */
    return s.split(/\s+[—–-]\s+/)[0].trim() || card.id;
  }
  /* The board's own hidden-cards list. Its key is namespaced per board
     (transitboard.hiddenCards, transitboardphl.hiddenCards, ...) and is found
     rather than guessed, so a city added later cannot end up writing into
     another board's settings. */
  function boardHiddenKey(){
    try{
      for(let i=0;i<localStorage.length;i++){
        const k=localStorage.key(i);
        if(/^transitboard[a-z]*\.hiddenCards$/.test(k)) return k;
      }
      for(let i=0;i<localStorage.length;i++){
        const m=/^(transitboard[a-z]*)\./.exec(localStorage.key(i));
        if(m) return m[1]+".hiddenCards";
      }
    }catch(_){}
    return "";
  }
  function registerStrayCards(){
    let defs=null;
    /* eslint-disable-next-line no-undef */
    try{ if(typeof CARD_DEFS!=="undefined" && Array.isArray(CARD_DEFS)) defs=CARD_DEFS; }catch(_){}
    if(!defs) return false;
    let added=false;
    document.querySelectorAll(".cards .card[id]").forEach(c=>{
      if(defs.some(d=>d && d.id===c.id)) return;
      defs.push({id:c.id, label:cardLabel(c)});
      added=true;
    });
    /* Only rebuild when something actually changed: the boards call
       buildCardToggles() from their own DOMContentLoaded, and rebuilding it on
       every retry tick would throw away a checkbox mid-click. */
    /* eslint-disable-next-line no-undef */
    if(added && typeof buildCardToggles==="function"){ try{ buildCardToggles(); }catch(_){} }
    return added;
  }
  function hideCard(id){
    let done=false;
    try{
      /* eslint-disable-next-line no-undef */
      if(typeof loadHiddenCards==="function"){
        /* eslint-disable-next-line no-undef */
        const h=loadHiddenCards();
        h.add(id);
        const key=boardHiddenKey();
        /* Array.from, not slice.call: loadHiddenCards() hands back a Set, which
           is iterable but NOT array-like, so slice.call() yields [] -- it would
           save an empty hidden-list and the card would refuse to disappear. */
        if(key){ localStorage.setItem(key, JSON.stringify(Array.from(h))); done=true; }
      }
    }catch(_){}
    const el=document.getElementById(id);
    if(el) el.classList.add("user-hidden");
    /* eslint-disable-next-line no-undef */
    try{ if(done && typeof applyCardVis==="function") applyCardVis(); }catch(_){}
    /* eslint-disable-next-line no-undef */
    try{ if(done && typeof buildCardToggles==="function") buildCardToggles(); }catch(_){}
    /* The remaining boxes have just been handed this one's share of the
       screen; spend it rather than leaving a hole where the card was. */
    refit();
  }
  function addCardCloseButtons(){
    document.querySelectorAll(".cards .card[id]").forEach(c=>{
      const h=c.querySelector("h2");
      if(!h || h.querySelector(".card-x")) return;
      const b=document.createElement("button");
      b.type="button"; b.className="card-x"; b.textContent="×";
      b.title="Hide this box (Settings → Show on board brings it back)";
      b.setAttribute("aria-label","Hide "+cardLabel(c));
      b.onclick=e=>{ e.stopPropagation(); hideCard(c.id); };
      h.appendChild(b);
    });
    /* Cards arrive after boot as well -- Spotted, Track record and Today's
       best are injected by their own scripts, and the alerts card is built the
       first time something is wrong. Watch for them so a late arrival gets its
       x and its settings entry, and so one that is re-created after being
       hidden comes back hidden. */
    const host=document.querySelector(".cards");
    if(host && !host._tbXObs){
      host._tbXObs=new MutationObserver(muts=>{
        if(!muts.some(m=>[...m.addedNodes].some(n=>n.nodeType===1 &&
            n.classList && n.classList.contains("card")))) return;
        registerStrayCards();
        addCardCloseButtons();
        /* eslint-disable-next-line no-undef */
        try{ if(typeof applyCardVis==="function") applyCardVis(); }catch(_){}
      });
      host._tbXObs.observe(host,{childList:true});
    }
  }

  /* ---- Settings -> Map ----------------------------------------------------
     Injected rather than added to eleven settings panels by hand, and anchored
     to #legendRow because every board has one in the same place (checked on
     all eleven). Same shape as each board's own setLegend(): an attribute on
     <html> so the CSS does the work, and the choice persists per device.

     Hiding the map is a space decision, not a cosmetic one -- it is the single
     biggest block on the board (193px of a 744px-tall iPad in landscape), and
     the departure boxes are competing with it for the same screen. Off, that
     height goes to them, which on a small screen is the difference between
     about three rows a box and about six. */
  function applyMap(mode){
    document.documentElement.setAttribute("data-map", mode);
    try { localStorage.setItem("tb.map", mode); } catch (_) {}
    document.querySelectorAll("#tbMapRow .theme-btn")
      .forEach(b => b.classList.toggle("active", b.dataset.map === mode));
    // The map only needs telling when it becomes visible again; Leaflet sizes
    // itself from a container that was display:none and gets it wrong.
    if (mode === "on") setTimeout(() => {
      try { if (window.state && state.map) state.map.invalidateSize(); } catch (_) {}
    }, 60);
    setTimeout(refit, 80);
  }
  function buildMapRow(){
    if (document.getElementById("tbMapRow")) return;
    const anchor = document.getElementById("legendRow");
    if (!anchor) return;
    const lbl = document.createElement("div");
    lbl.className = "accent-lbl";
    lbl.textContent = "Map";
    const row = document.createElement("div");
    row.className = "theme-row";
    row.id = "tbMapRow";
    row.innerHTML =
      '<button type="button" class="theme-btn" data-map="on">Shown</button>' +
      '<button type="button" class="theme-btn" data-map="off">Hidden</button>';
    const note = document.createElement("p");
    note.style.fontSize = "12px";
    note.textContent = "Hiding the map gives its whole height to the departure " +
      "boxes — worth it on a tablet or a short window, where the map and the " +
      "boxes are competing for the same screen.";
    // Above the legend control: the legend is a detail OF the map, so a hidden
    // map should not leave its legend switch stranded above it.
    const before = anchor.previousElementSibling &&
      anchor.previousElementSibling.classList.contains("accent-lbl")
        ? anchor.previousElementSibling : anchor;
    before.parentNode.insertBefore(lbl, before);
    before.parentNode.insertBefore(row, before);
    before.parentNode.insertBefore(note, before);
    row.querySelectorAll(".theme-btn").forEach(b => {
      b.onclick = () => applyMap(b.dataset.map);
    });
    let saved = "on";
    try { saved = localStorage.getItem("tb.map") || "on"; } catch (_) {}
    applyMap(saved);
  }

  /* ---- hooks -------------------------------------------------------------
     fitAll() is where every board already re-fits its boxes after data, a
     resize, or a settings change, so wrapping it means this runs at exactly
     the moments that matter without editing eleven copies. The standalone
     resize listener is the belt to that braces: a board whose fitAll is
     defined later, or renamed, still re-measures. */
  function refit(){
    pinZoom();
    sizeCompactCards();
  }
  /* Each board's balanceCards() writes gridTemplateRows onto .cards. It leaves
     early when .cards is not a grid, which since theme.css's multi-column pass
     has been always -- but the tile layout above makes it a grid again, and
     the very next thing the board does after this file sizes the tiles is call
     its own balancer, which would overwrite grid-auto-rows with rows of its
     own devising. It has no way to know about the tiles, so it is told to
     stand down while they are in force. */
  function hookBalance(){
    if (typeof window.balanceCards !== "function" || window.balanceCards.__tbFit) return false;
    const orig = window.balanceCards;
    const wrapped = function () {
      if (document.documentElement.classList.contains("tb-grid")) {
        const box = document.querySelector(".cards");
        if (box && box.style.gridTemplateRows) box.style.gridTemplateRows = "";
        return;
      }
      return orig.apply(this, arguments);
    };
    wrapped.__tbFit = true;
    window.balanceCards = wrapped;
    return true;
  }
  function hookFitAll(){
    if (typeof window.fitAll !== "function" || window.fitAll.__tbFit) return false;
    const orig = window.fitAll;
    const wrapped = function () {
      pinZoom();
      sizeCompactCards();
      return orig.apply(this, arguments);
    };
    wrapped.__tbFit = true;
    window.fitAll = wrapped;
    return true;
  }

  let rzT, rzFrame = 0;
  addEventListener("resize", () => {
    /* Instant, so nothing clips while the window is being dragged -- but at
       most once a frame. A refit measures every card and forces two or three
       layouts of a board carrying a Leaflet map, and resize fires far faster
       than that on a drag, on an iPad rotation, and every time mobile Safari
       shows or hides its own chrome. Running one per event is how a resize
       turns into a freeze. */
    if(!rzFrame) rzFrame = requestAnimationFrame(() => { rzFrame = 0; refit(); });
    clearTimeout(rzT); rzT = setTimeout(refit, 220);
  });

  function start(){
    hookFitAll();
    hookBalance();
    registerStrayCards();
    addCardCloseButtons();
    buildMapRow();
    refit();
  }
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", start);
  else start();
  // The boards define fitAll() and build their settings panel in their own
  // deferred scripts, which may land after this one. A few short retries cost
  // nothing and save depending on script order across eleven files.
  let tries = 0;
  const t = setInterval(() => {
    hookFitAll(); hookBalance(); registerStrayCards(); addCardCloseButtons(); buildMapRow(); refit();
    if (++tries >= 10) clearInterval(t);
  }, 300);
})();
