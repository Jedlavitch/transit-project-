/* ============================================================================
   gate.js — the boards are a demo until they are bought.

   WHY A TIMER AND NOT A WALL
   A wall on the front of a static site is theatre. Every file the browser gets
   is the visitor's; devtools, "save page as", or turning off JavaScript walks
   straight past anything this file does, so a paywall mostly costs you the
   people who would have bought after seeing it work.

   What is actually being sold here is a board left running on a wall. So that
   is what the demo withholds:

     - the board runs for TRIAL_MIN minutes, then stops and asks for a key
     - full screen is licensed         (a kiosk without it is not a kiosk)
     - sky view is licensed            (the other permanent-display mode)

   You can evaluate every card, every city, live data, for as long as it takes
   to decide. You cannot leave it up. That is a demo somebody can judge honestly
   and still need to pay for, which a five-second paywall is not.

   THE GATE THAT ACTUALLY HOLDS is feed-proxy-worker.js: the boards fetch live
   feeds through it and it refuses to forward without a valid signed key, so a
   copied build renders an empty board however it was obtained. This file is the
   sign on the door; that one is why walking past it gains nothing.

   DORMANT BY DEFAULT, like license.js. No licence server configured means no
   timer, no locks, nothing -- which is what stops an unfinished Stripe setup
   locking the owner out of their own kiosk.
   ============================================================================ */
(function () {
  "use strict";

  var TRIAL_MIN = 15;                      // minutes of board per visit, unlicensed
  var LS = { key: "tb.license", okUntil: "tb.license.okUntil", lastOk: "tb.license.lastOk" };
  var DAY = 86400000, GRACE_MS = 14 * DAY;

  function get(k){ try { return localStorage.getItem(k); } catch (_) { return null; } }

  /* license.js answers this too, but asynchronously -- its first verify() is a
     network round trip. Reading the cached answer synchronously is what stops a
     licensed wall display flashing a paywall on every reload. */
  function cachedLicensed() {
    if (Number(get(LS.okUntil) || 0) > Date.now()) return true;
    if (Number(get(LS.lastOk) || 0) > Date.now() - GRACE_MS) return true;
    return false;
  }
  function configured(){ return !!(window.TBLicense && window.TBLicense.configured); }
  function licensed(){
    if (!configured()) return true;                       // dormant = everything unlocked
    if (window.TBLicense.licensed) return true;           // license.js has confirmed
    return cachedLicensed();
  }

  var wall = null, timer = null, chip = null, startedAt = 0;

  /* ---------- the wall ---------- */
  function styles() {
    if (document.getElementById("tbGateCss")) return;
    var css = document.createElement("style");
    css.id = "tbGateCss";
    css.textContent =
      "#tbGate{position:fixed;top:0;right:0;bottom:0;left:0;inset:0;z-index:2147483600;background:var(--bg,#081020);" +
        "color:var(--text,#eef3ff);display:flex;align-items:center;justify-content:center;" +
        "padding:24px;overflow:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif}" +
      "#tbGate .box{max-width:440px;width:100%;background:var(--panel,#111d36);" +
        "border:1px solid var(--line,#22345a);border-radius:18px;padding:28px}" +
      "#tbGate h2{margin:0 0 8px;font-size:21px;font-weight:800;letter-spacing:-.01em;" +
        "text-transform:none;color:var(--text,#eef3ff)}" +
      "#tbGate p{margin:0 0 18px;color:var(--muted,#93a5cf);font-size:14px;line-height:1.55}" +
      "#tbGate input{width:100%;box-sizing:border-box;padding:12px 13px;border-radius:11px;" +
        "border:1px solid var(--line,#22345a);background:var(--panel2,#0c1628);" +
        "color:var(--text,#eef3ff);font-size:15px;font-family:inherit;letter-spacing:.04em}" +
      "#tbGate input:focus{outline:none;border-color:var(--accent,#4ea1ff)}" +
      "#tbGate .row{display:flex;gap:9px;margin-top:12px;flex-wrap:wrap}" +
      "#tbGate button,#tbGate a.b{flex:1;min-width:132px;padding:12px 16px;border-radius:11px;" +
        "border:0;font-weight:800;font-size:14.5px;cursor:pointer;font-family:inherit;" +
        "text-align:center;text-decoration:none}" +
      "#tbGate .go{background:var(--accent,#4ea1ff);color:#04101f}" +
      "#tbGate .buy{background:var(--panel2,#0c1628);color:var(--text,#eef3ff);border:1px solid var(--line,#22345a)}" +
      "#tbGate .msg{min-height:18px;margin-top:11px;font-size:13px}" +
      "#tbGate .home{display:block;margin-top:16px;text-align:center;font-size:13px;" +
        "color:var(--muted,#93a5cf);text-decoration:none}" +
      "#tbTrial{position:fixed;right:12px;bottom:12px;z-index:2147483000;" +
        "background:var(--panel,#111d36);border:1px solid var(--line,#22345a);" +
        "color:var(--muted,#93a5cf);border-radius:999px;padding:7px 13px;font-size:12px;" +
        "font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
        "cursor:pointer;display:flex;gap:7px;align-items:center}" +
      "#tbTrial b{color:var(--text,#eef3ff);font-variant-numeric:tabular-nums}" +
      "#tbTrial:hover{border-color:var(--accent,#4ea1ff)}" +
      /* It is a <button> now, so strip the platform chrome the rule above
         assumed was absent, and give it a focus ring loud enough to find from
         a sofa — a remote user cannot see a cursor, so the selection outline is
         the only thing telling them where they are. */
      "#tbTrial{-webkit-appearance:none;appearance:none}" +
      "#tbTrial:focus-visible{outline:3px solid var(--accent,#4ea1ff);outline-offset:3px;" +
        "border-color:var(--accent,#4ea1ff);color:var(--text,#eef3ff)}" +
      /* The pairing panel needs room for a QR beside its instructions; the box
         widens only while it is showing. */
      "#tbGate .box.wide{max-width:680px}" +
      "#tbGate button.pairb{width:100%;flex:none;margin:2px 0 0;" +
        "background:var(--accent,#4ea1ff);color:#04101f;font-size:15px;padding:14px 16px}" +
      "#tbGate .or{display:flex;align-items:center;gap:10px;margin:17px 0 4px;" +
        "color:var(--muted,#93a5cf);font-size:11px;font-weight:700;letter-spacing:.09em;" +
        "text-transform:uppercase}" +
      "#tbGate .or:before,#tbGate .or:after{content:'';flex:1;height:1px;background:var(--line,#22345a)}";
    document.head.appendChild(css);
  }

  function showWall(title, body) {
    styles();
    if (wall) return;
    wall = document.createElement("div");
    wall.id = "tbGate";
    /* PAIRING IS OFFERED FIRST, and the key box is kept underneath rather than
       replaced. This wall's most common reader is a television, where typing
       twenty characters on a remote is the worst minute of owning the product
       -- but the same wall appears on a laptop, where pasting a key is quicker
       than fetching a phone. Neither is made to hunt for its own route.

       The panel is one press away rather than shown immediately, because
       mounting it mints a pairing code on the Worker: an unlicensed board left
       running would otherwise spend KV writes every time the demo clock ran
       out, with nobody in the room. */
    wall.innerHTML =
      '<div class="box" id="tbGateBox">' +
        '<div id="tbGateMain">' +
          "<h2>" + title + "</h2>" +
          "<p>" + body + "</p>" +
          '<button class="pairb" id="tbGatePair">Unlock from my phone</button>' +
          '<div class="or"><span>or paste your key</span></div>' +
          /* The one key format: TB, then four groups of five. license-worker.js,
             feed-proxy-worker.js and gen-licence.py all mint and accept exactly
             this, so the key that unlocks the interface is the same key that gets
             live data through the proxy. */
          '<input id="tbGateKey" placeholder="TB-XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" ' +
            'spellcheck="false" aria-label="Licence key" />' +
          '<div class="row">' +
            '<button class="go" id="tbGateGo">Unlock</button>' +
            '<a class="b buy" href="buy.html">Get a licence — $19</a>' +
          "</div>" +
          '<div class="msg" id="tbGateMsg"></div>' +
          '<a class="home" href="index.html">‹ Back to transitproject.online</a>' +
        "</div>" +
        '<div id="tbGatePairFace" style="display:none">' +
          "<h2>Unlock from your phone</h2>" +
          '<div id="tbGatePairHost"></div>' +
          '<div class="row"><button class="buy" id="tbGatePairBack">‹ Back</button></div>' +
        "</div>" +
      "</div>";
    document.body.appendChild(wall);

    var input = wall.querySelector("#tbGateKey"),
        msg   = wall.querySelector("#tbGateMsg"),
        go    = wall.querySelector("#tbGateGo");

    var PAIR_LABEL = "Unlock from my phone";
    var box   = wall.querySelector("#tbGateBox"),
        main  = wall.querySelector("#tbGateMain"),
        face  = wall.querySelector("#tbGatePairFace"),
        pairB = wall.querySelector("#tbGatePair");

    pairB.addEventListener("click", function () {
      var load = window.TBLicense && window.TBLicense.pairing;
      if (!load) { say("Pairing isn't available here — paste your key instead.", "bad"); return; }
      pairB.disabled = true; pairB.textContent = "Loading…";
      load(function (ok) {
        pairB.disabled = false; pairB.textContent = PAIR_LABEL;
        if (!ok || !window.TBPair) {
          say("Couldn't load the pairing tools — paste your key instead.", "bad");
          return;
        }
        box.className = "box wide";
        main.style.display = "none";
        face.style.display = "";
        window.TBPair.mount(wall.querySelector("#tbGatePairHost"), {});
      });
    });
    wall.querySelector("#tbGatePairBack").addEventListener("click", function () {
      if (window.TBPair) window.TBPair.stop();
      box.className = "box";
      face.style.display = "none";
      main.style.display = "";
    });

    function say(t, kind) {
      msg.textContent = t;
      msg.style.color = kind === "bad" ? "var(--late-ink,#ff5a5a)"
                      : kind === "ok"  ? "var(--good-ink,#33d17a)"
                      : "var(--muted,#93a5cf)";
    }
    function submit() {
      var k = (input.value || "").trim();
      if (!k) { say("Paste your key first.", "bad"); return; }
      say("Checking…"); go.disabled = true;
      Promise.resolve(window.TBLicense.enterKey(k)).then(function (res) {
        go.disabled = false;
        if (res && res.ok) {
          say("Unlocked — thank you!", "ok");
          // Reload rather than un-hiding: the board has been sitting idle behind
          // the wall and a licensed cold start is simpler than replaying it.
          setTimeout(function () { location.reload(); }, 700);
        } else if (res && res.offline) say("Can't reach the licence server — check your connection.", "bad");
        else if (res && res.error === "device_limit") say("That key is already on its maximum number of devices.", "bad");
        else say("That key wasn't recognised.", "bad");
      }).catch(function () { go.disabled = false; say("Couldn't check that key just now.", "bad"); });
    }
    go.addEventListener("click", submit);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    setTimeout(function () { try { input.focus(); } catch (_) {} }, 60);
  }

  /* ---------- the trial ---------- */
  function endTrial() {
    if (timer) { clearInterval(timer); timer = null; }
    if (chip) { chip.remove(); chip = null; }
    if (licensed()) return;
    // Stop the board working, not just cover it: leaving fetch loops running
    // behind a wall burns the visitor's battery and the agencies' rate limits.
    try { var i = window.setInterval(function () {}, 1e9); while (i > 0) { clearInterval(i); i--; } } catch (_) {}
    /* That sweep is indiscriminate, and the pairing panel may be open behind
       the chip with a live code on screen. Put its polling back, or the demo
       expiring mid-pair leaves a code nobody is listening for. */
    if (window.TBPair && window.TBPair.resume) window.TBPair.resume();
    showWall("Demo finished",
      "That was " + TRIAL_MIN + " minutes of the live board. A licence unlocks it permanently on " +
      "up to five devices, with full screen and sky view, for a one-off $19.");
  }

  function startTrial() {
    styles();
    startedAt = Date.now();
    /* A BUTTON, not a div.

       This was a div with a click handler, which meant a television could not
       reach it at all: a remote sends arrows, OK and digits, and a div is not
       in the tab order and does not answer Enter. So a board opened straight on
       a TV — not through the launcher — had no way to the unlock panel for the
       whole fifteen minutes until the wall came up on its own. The one device
       the pairing feature exists for was the one that had to wait it out.

       A real button is focusable, is reachable by the remote, and answers OK
       without a line of extra code. */
    chip = document.createElement("button");
    chip.id = "tbTrial";
    chip.type = "button";
    chip.title = "Demo — unlock this screen from your phone";
    chip.setAttribute("aria-label", "Demo mode. Unlock this screen from your phone.");
    chip.innerHTML = '<span>Unlock</span><b id="tbTrialLeft"></b>';
    chip.addEventListener("click", function () {
      showWall("Unlock this board",
        "Scan the code with your phone and your licence moves across — nothing to type here. " +
        "You can paste a key instead if you would rather.");
    });
    document.body.appendChild(chip);

    var left = chip.querySelector("#tbTrialLeft");
    function tick() {
      if (licensed()) { clearInterval(timer); timer = null; chip.remove(); chip = null; return; }
      var ms = TRIAL_MIN * 60000 - (Date.now() - startedAt);
      if (ms <= 0) { endTrial(); return; }
      var s = Math.ceil(ms / 1000);
      left.textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    }
    tick();
    timer = setInterval(tick, 1000);
  }

  /* ---------- feature locks ----------
     Called by the board before doing something a demo does not get. Returns
     true when allowed; otherwise puts the key box up and returns false, so a
     caller is always `if (!TBGate.require(...)) return;`. */
  function require(feature) {
    if (licensed()) return true;
    var what = feature === "fullscreen"
      ? "Full screen is part of a licence — it is what turns a browser tab into a wall display."
      : feature === "sky"
      ? "Sky view is part of a licence, along with full screen and the departure board."
      : "That is part of a licence.";
    showWall("Licensed feature", what + " A one-off $19 unlocks it on up to five devices.");
    return false;
  }

  /* Pages that are a licence feature in their own right, rather than a city
     board with a demo clock. Gating only the link to sky view would be a lock
     on the door of a room with no walls -- night.html is a URL, and anyone can
     type it. These show the key box immediately instead of a countdown. */
  var LICENSED_PAGES = ["night.html", "flipboard.html", "tour.html"];
  function isLicensedPage() {
    var f = (location.pathname.split("/").pop() || "").toLowerCase();
    return LICENSED_PAGES.indexOf(f) >= 0;
  }

  function init() {
    if (!configured()) return;             // no licence server -> nothing to enforce
    if (licensed()) return;                // paid: no chip, no timer, no locks
    if (isLicensedPage()) {
      showWall("Licensed feature",
        "Sky view, the departure board and the Grand Tour come with a licence, " +
        "along with full screen on every city board. A one-off $19 unlocks them " +
        "on up to five devices.");
      return;
    }
    startTrial();
    /* The cached answer can be stale -- a kiosk that has been off for a
       fortnight re-verifies on boot. Give license.js a moment to come back
       before the demo clock means anything. */
    var tries = 0;
    var poll = setInterval(function () {
      if (licensed()) {
        clearInterval(poll);
        if (timer) { clearInterval(timer); timer = null; }
        if (chip) { chip.remove(); chip = null; }
        if (wall) { wall.remove(); wall = null; }
      } else if (++tries > 20) clearInterval(poll);
    }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.TBGate = {
    require: require,
    licensed: licensed,
    configured: configured,
    trialMinutes: TRIAL_MIN
  };
})();
