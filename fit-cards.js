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
  .card{padding:7px 9px}
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
  body .row .badge{min-width:26px; height:17px; font-size:10px}
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

/* ---- tight cards: chrome gives way to data ------------------------------
   Set by sizeCompactCards() when the measured ceiling lands under ~130px,
   which is a different question from how wide the screen is: 1133x744 with
   the map shown gets a 99px card (tighter than a Nexus 7's), while the same
   iPad in portrait with the map hidden gets 137px+ and can afford more.
   Keying it off the measurement rather than a width breakpoint is what
   makes it right in both.

   This is only the EXTRA trimming for the tightest cards. The structural
   part -- one-line titles, and flex:none so neither the header nor the
   statline can be sliced -- applies across the whole band above, because a
   sliced line is wrong at any card size; only whether there is ROOM for the
   statline and the header's running count depends on the ceiling. Below
   ~130px a card has about four lines total, and spending two of them on
   chrome leaves too little of what the card is for. */
:root.tb-cards-tight body .card h2{margin-bottom:3px}
:root.tb-cards-tight body .card h2 .count{display:none}
:root.tb-cards-tight body .statline{display:none}

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
  :root.tb-rail-tight[data-style="atlas"] body .card h2 .mini-btn{height:14px; padding:0 4px; font-size:9px}
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
  :root.tb-rail-tight[data-style="atlas"] body .row .badge{height:16px; min-width:22px; font-size:9px; padding:0 5px}
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
  function sizeCompactCards(){
    const root=document.documentElement, box=document.querySelector(".cards");
    const w=(typeof viewportW==="function") ? viewportW() : innerWidth;
    /* Every variable AND the class have to be cleared on the way out, not just
       some: tb-cards-tight lives outside any media query (it is keyed on the
       measurement, not the width), so a board dragged from a tablet width out
       to a phone one kept the class and went on hiding every statline. */
    const reset=()=>{
      root.style.removeProperty("--tb-card-max");
      root.style.removeProperty("--tb-card-cols");
      root.style.removeProperty("--tb-card-floor");
      root.classList.remove("tb-cards-tight");
      root.classList.remove("tb-rail-tight");
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
      return;
    }
    root.style.removeProperty("--tb-card-floor");
    root.classList.remove("tb-rail-tight");
    /* Non-Atlas widescreen (the masonry layout, if the Atlas style is off):
       width is spare and height is the constraint, so spend the width on MORE
       columns to keep cards tall. column-width has to go to auto for
       column-count to be obeyed -- with both set the used count is min(count,
       what the width allows), so an inherited 330px would pin it back down.
       The readability floor is in REAL pixels, divided by the board zoom,
       because #app is zoomed on desktop and 280 local px at 0.8 renders as
       224; 280 is where a row's destination stops truncating real names. */
    if(w>1220){
      const zoom=parseFloat(getComputedStyle(root).getPropertyValue("--ui-zoom"))||1;
      const cgap=parseFloat(getComputedStyle(box).columnGap)||16;
      const minCol=280/zoom;
      root.style.setProperty("--tb-card-cols",
        String(Math.max(1, Math.floor((box.clientWidth+cgap)/(minCol+cgap)))));
    } else {
      root.style.removeProperty("--tb-card-cols");
    }
    /* Read the lefts AFTER any count change above -- getBoundingClientRect
       forces the reflow, so this sees the columns that will actually paint. */
    const cols=Math.max(1, new Set(cards.map(c=>Math.round(c.getBoundingClientRect().left))).size);
    const gap=parseFloat(getComputedStyle(cards[0]).marginBottom)||8;
    /* Cards per column has to round UP, not average out: nine cards across two
       columns is 5 and 4, and it is the five-card column that has to fit. The
       averaged form (H * cols / cards) allowed 100px at 768x1024, which the
       four-card column cleared and the five-card one overflowed by exactly one
       card -- the whole 106%-fill, one-clipped-card signature. */
    const perCol=Math.ceil(cards.length/cols);
    const max=Math.max(72, Math.floor(H/perCol) - gap);
    root.style.setProperty("--tb-card-max", max+"px");
    /* Whether a card can afford its own chrome is a question about the ceiling
       it actually got, not about the viewport width -- 1133x744 with the map
       shown lands on a 99px card, tighter than a Nexus 7's, while the same
       width in portrait with the map hidden gets 200px+ and has room to
       spare. Keying the trim off the measured value covers both, and stops a
       card from rendering its statline sliced in half at its own bottom edge.
       130px is about where a header, a statline and two rows stop fitting. */
    root.classList.toggle("tb-cards-tight", max < 130);
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

  let rzT;
  addEventListener("resize", () => {
    refit();                                   // instant: never clip while shrinking
    clearTimeout(rzT); rzT = setTimeout(refit, 220);
  });

  function start(){
    hookFitAll();
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
    hookFitAll(); buildMapRow(); refit();
    if (++tries >= 10) clearInterval(t);
  }, 300);
})();
