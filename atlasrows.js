/* ============================================================================
   atlasrows.js — even stagger for the Atlas departure animation.

   Atlas slides each departure on from the left, staggered so they arrive as a
   wave. The stagger cannot be done in CSS alone: nth-child counts every child
   of .list, and the stop/direction labels are children too — hidden in Atlas,
   but still occupying positions. So the delays came out uneven, with steps
   skipped wherever a label sat between two departures.

   This stamps each .row with its index among ROWS ONLY, as --tbi, and the
   stylesheet reads that instead of counting children.

   Runs off a MutationObserver rather than on a timer because the boards
   re-render their lists continuously as feeds land, and the index has to be
   correct on the render, not up to a tick later. The observer is cheap: it
   only ever looks at lists whose children actually changed, and it sets a
   property it just read to the same value in the common case, so re-stamping
   an unchanged list costs nothing.
   ============================================================================ */
(function () {
  "use strict";

  var CAP = 8;          // past this the wave is slower than anyone waits for
  var scheduled = false;

  function stamp(list) {
    var rows = list.querySelectorAll(":scope > .row"), i = 0;
    for (; i < rows.length; i++) {
      var want = String(Math.min(i, CAP));
      // read-then-write: setProperty on every row on every render would dirty
      // style for the whole list even when nothing moved
      if (rows[i].style.getPropertyValue("--tbi") !== want)
        rows[i].style.setProperty("--tbi", want);
    }
  }

  function stampAll() {
    scheduled = false;
    var lists = document.querySelectorAll(".list");
    for (var i = 0; i < lists.length; i++) stamp(lists[i]);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(stampAll);
  }

  function init() {
    stampAll();
    try {
      var mo = new MutationObserver(function (recs) {
        for (var i = 0; i < recs.length; i++) {
          var t = recs[i].target;
          /* Only childList changes inside a list matter. Attribute writes are
             ignored deliberately — this sets an inline style itself, and
             reacting to that would loop. */
          if (t && t.classList && (t.classList.contains("list") || t.closest(".list"))) { schedule(); return; }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {
      // No observer: fall back to re-stamping on the same cadence the boards
      // refresh on. Still correct, just up to a second late on a cold load.
      setInterval(stampAll, 1000);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
