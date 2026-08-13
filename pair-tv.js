/* ============================================================================
   pair-tv.js -- the television's half of pairing: show a code, wait for a phone.

   WHAT IT REPLACES
   A licence key is "TB-" and twenty characters, and the device that most needs
   one is the device least able to take one. On a remote control that is twenty
   trips around an on-screen keyboard, in a font chosen for a living room, with
   O and 0 next to each other. People give up, and the last thing they were
   doing when they gave up was setting up something they had already paid for.

   Here the television shows a six-character code and a QR of the same thing.
   The phone in the owner's pocket already holds the key -- it is where the
   purchase email was opened -- so the whole exchange is: point camera, tap
   once. Nothing is typed anywhere.

   HOW IT TALKS
   /pair/start on the licence Worker returns a short code (for the screen) and
   a long secret (kept here, never displayed). Polling needs the secret, so a
   code read off a screen in a shop window collects nothing. The Worker's own
   comments carry the rest of the reasoning.

   ONE PANEL, TWO HOSTS. gate.js's wall and license.js's dialog both put this
   in front of people, and two copies would drift. Both call TBPair.mount().

   ES5, like gate.js, because the whole point is the old television.

   Exposes window.TBPair:
     TBPair.available()          -> is there a Worker to pair against?
     TBPair.mount(host, opts)    -> take over `host`, run the pairing
     TBPair.stop()               -> stop polling (call when the panel closes)
   opts = { onDone: function(key){}, compact: bool }
   ============================================================================ */
(function () {
  "use strict";

  /* Where a phone should be sent when this screen cannot tell it anywhere
     better -- see pairBase(). The canonical home of the product. */
  var PUBLIC_BASE = "https://transitproject.online/";
  var LS = { key: "tb.license", okUntil: "tb.license.okUntil", lastOk: "tb.license.lastOk",
             dev: "tb.device", url: "tb.workerUrl" };
  var DEFAULT_WORKER = "https://tblicense.jacklemonade2.workers.dev";

  var timer = null, clock = null, live = null, resumeFn = null;

  function get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }

  function workerUrl() {
    var u = get(LS.url)
         || (window.TBLicense && window.TBLicense.url)
         || DEFAULT_WORKER;
    return String(u || "").trim().replace(/\/+$/, "");
  }
  function available() { return !!workerUrl(); }

  /* The same device id license.js registers, so pairing and the /verify that
     follows it spend ONE of the five device slots rather than two. */
  function deviceId() {
    if (window.TBLicense && window.TBLicense.device) {
      try { return window.TBLicense.device(); } catch (_) {}
    }
    var d = get(LS.dev);
    if (!d) {
      d = "d" + Math.random().toString(16).slice(2, 10) + Math.random().toString(16).slice(2, 10);
      set(LS.dev, d);
    }
    return d;
  }

  /* Where the phone is told to go.

     Normally this screen's own address, so a board served from a Pi on the
     kitchen wall sends the phone to that Pi -- a LAN address is perfectly
     reachable from a phone on the same wifi, and rewriting it would break the
     setup that most wants this feature.

     Only two cases genuinely cannot be reached from another device: a file://
     page and a loopback address. Those fall back to the public site, which
     works regardless, because pairing is mediated by the Worker rather than by
     this page's origin -- the phone and the television never talk to each
     other directly, so they do not have to agree on where they are. */
  function pairBase() {
    var host = location.hostname || "";
    var loopback = /^(localhost|127(\.\d+){3}|0\.0\.0\.0|\[?::1\]?)$/i.test(host);
    if (location.protocol === "file:" || loopback || !host) return PUBLIC_BASE;
    return location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
  }

  /* For reading aloud and typing: drop the scheme, keep the trailing slash the
     caller appends a page name to. "pair" rather than "pair.html" because
     pair/index.html forwards it -- five fewer characters on a phone keyboard,
     and one fewer chance to mistype. */
  function shortHost(u) { return String(u).replace(/^https?:\/\//, ""); }

  /* ---------------- styles ---------------- */
  function styles() {
    if (document.getElementById("tbPairCss")) return;
    var s = document.createElement("style");
    s.id = "tbPairCss";
    s.textContent =
      "#tbPair{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;" +
        "color:var(--text,#eef3ff)}" +
      "#tbPair .tbpRow{display:flex;gap:20px;align-items:center;flex-wrap:wrap}" +
      /* White plate, always. A QR rendered dark-on-dark to match the board's
         theme is a QR that a good half of phone cameras will not read, and the
         one thing this panel cannot afford is to be beautiful and unscannable. */
      "#tbPair .tbpQr{background:#fff;border-radius:12px;padding:10px;width:210px;height:210px;" +
        "flex:0 0 auto;box-shadow:0 6px 22px rgba(0,0,0,.35)}" +
      "#tbPair .tbpQr svg{display:block;width:100%;height:100%}" +
      "#tbPair .tbpSide{flex:1 1 210px;min-width:200px}" +
      "#tbPair .tbpLead{font-size:15px;font-weight:700;margin:0 0 10px;color:var(--text,#eef3ff)}" +
      "#tbPair .tbpAlt{font-size:12.5px;color:var(--muted,#93a5cf);line-height:1.55;margin:0 0 6px}" +
      "#tbPair .tbpAlt b{color:var(--text,#eef3ff);font-weight:700}" +
      "#tbPair .tbpCode{font:800 30px/1.15 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;" +
        "margin:8px 0 4px;color:var(--accent,#4ea1ff);white-space:nowrap}" +
      "#tbPair .tbpMsg{font-size:13px;color:var(--muted,#93a5cf);margin-top:12px;min-height:19px;" +
        "display:flex;align-items:center;gap:8px}" +
      "#tbPair .tbpMsg.bad{color:var(--late-ink,#ff5a5a)}" +
      "#tbPair .tbpMsg.good{color:var(--good-ink,#33d17a);font-weight:700}" +
      "#tbPair .tbpDot{width:8px;height:8px;border-radius:50%;background:var(--accent,#4ea1ff);" +
        "flex:0 0 auto;animation:tbpPulse 1.4s ease-in-out infinite}" +
      "@keyframes tbpPulse{0%,100%{opacity:.25}50%{opacity:1}}" +
      "#tbPair .tbpBtn{margin-top:12px;padding:11px 16px;border-radius:11px;border:1px solid var(--line,#22345a);" +
        "background:var(--panel2,#0c1628);color:var(--text,#eef3ff);font:800 14px inherit;cursor:pointer}" +
      "#tbPair .tbpBtn:hover{border-color:var(--accent,#4ea1ff)}" +
      "#tbPair.tbpCompact .tbpQr{width:168px;height:168px}" +
      "#tbPair.tbpCompact .tbpCode{font-size:25px}" +
      /* A television is watched from a sofa. Anything under about 30px of code
         at that distance is unreadable, and the code is the fallback for every
         phone whose camera will not focus on a bright screen. */
      "@media (min-width:900px){#tbPair:not(.tbpCompact) .tbpQr{width:250px;height:250px}" +
        "#tbPair:not(.tbpCompact) .tbpCode{font-size:38px}}";
    document.head.appendChild(s);
  }

  /* ---------------- the panel ---------------- */
  function mount(host, opts) {
    opts = opts || {};
    stop();
    styles();

    var base = pairBase();
    host.innerHTML =
      '<div id="tbPair"' + (opts.compact ? ' class="tbpCompact"' : "") + '>' +
        '<div class="tbpRow">' +
          '<div class="tbpQr" id="tbpQr"></div>' +
          '<div class="tbpSide">' +
            '<p class="tbpLead">Scan this with your phone’s camera.</p>' +
            '<p class="tbpAlt">No camera? On your phone go to<br><b>' +
              shortHost(base) + 'pair</b> and enter:</p>' +
            '<div class="tbpCode" id="tbpCode">••• •••</div>' +
            '<div class="tbpMsg" id="tbpMsg"><span class="tbpDot"></span><span id="tbpMsgText">Getting a code…</span></div>' +
            '<button class="tbpBtn" id="tbpRetry" style="display:none">Get a new code</button>' +
          "</div>" +
        "</div>" +
      "</div>";

    var qrBox = host.querySelector("#tbpQr"),
        codeBox = host.querySelector("#tbpCode"),
        msgText = host.querySelector("#tbpMsgText"),
        msgBox = host.querySelector("#tbpMsg"),
        retry = host.querySelector("#tbpRetry");

    function say(text, kind) {
      msgText.textContent = text;
      msgBox.className = "tbpMsg" + (kind ? " " + kind : "");
      msgBox.firstChild.style.display = kind ? "none" : "";
    }
    function showRetry(on) { retry.style.display = on ? "" : "none"; }
    retry.onclick = function () { mount(host, opts); };

    start();

    function start() {
      var url = workerUrl();
      if (!url) { say("No licence server is configured, so there is nothing to pair against.", "bad"); return; }

      say("Getting a code…");
      showRetry(false);

      request("POST", url + "/pair/start", { device: deviceId(), label: docLabel() }, function (err, data) {
        if (err || !data || !data.ok) {
          say(data && data.error === "rate_limited"
                ? "Too many attempts from this network. Try again in a few minutes."
                : "Couldn’t reach the licence server. Check this screen’s internet connection.", "bad");
          showRetry(true);
          return;
        }
        live = { code: data.code, secret: data.secret,
                 until: Date.now() + (data.expiresIn || 600) * 1000 };
        paint(data.code, base);
        say("Waiting for your phone…");
        var beat = function () { poll(url, (data.interval || 3) * 1000); countdown(); };
        resumeFn = beat;                      // see resume(), below
        beat();
      });
    }

    function paint(code, base) {
      codeBox.textContent = code.slice(0, 3) + " " + code.slice(3);
      var link = base + "pair.html?c=" + code;
      if (window.TBQR) {
        try {
          /* Level Q, not the default M. This code is photographed off a lit
             screen at an angle, often with a reflection across part of it --
             the conditions error correction exists for. */
          qrBox.innerHTML = window.TBQR.svg(link, { ecc: "Q", quiet: 2 });
          return;
        } catch (_) {}
      }
      // No QR available: the typed code is a complete route on its own.
      qrBox.style.display = "none";
    }

    function countdown() {
      if (clock) clearInterval(clock);
      clock = setInterval(function () {
        if (!live) return;
        var left = live.until - Date.now();
        if (left <= 0) {
          clearInterval(clock); clock = null;
          stopPolling();
          say("That code has expired.", "bad");
          showRetry(true);
        }
      }, 1000);
    }

    function poll(url, interval) {
      stopPolling();
      timer = setInterval(function () {
        if (!live) return;
        request("GET", url + "/pair/poll?code=" + encodeURIComponent(live.code) +
                       "&secret=" + encodeURIComponent(live.secret), null, function (err, data) {
          if (err) return;                       // a blip: keep polling, the code is still good
          if (!data || !data.ok) {
            if (data && (data.error === "expired" || data.error === "bad_secret")) {
              stopPolling();
              say("That code has expired.", "bad");
              showRetry(true);
            }
            return;
          }
          if (data.status === "ready" && data.key) { stopPolling(); accept(data.key); }
        });
      }, Math.max(2000, interval));
    }

    function accept(key) {
      if (clock) { clearInterval(clock); clock = null; }
      say("Paired — unlocking…", "good");
      /* The pairing already registered THIS device against the licence, so the
         verify below re-stamps the same slot rather than spending another. Going
         through license.js rather than writing localStorage directly is what
         makes the rest of the page agree that we are licensed. */
      set(LS.key, key);
      var done = function () {
        if (opts.onDone) { try { opts.onDone(key); return; } catch (_) {} }
        setTimeout(function () { location.reload(); }, 600);
      };
      if (window.TBLicense && window.TBLicense.enterKey) {
        try {
          var p = window.TBLicense.enterKey(key);
          if (p && p.then) { p.then(done, done); return; }
        } catch (_) {}
      }
      set(LS.okUntil, String(Date.now() + 86400000));
      set(LS.lastOk, String(Date.now()));
      done();
    }
  }

  /* A name for this screen, so a household pairing three of them can tell which
     one asked. Best effort -- the board's own title, trimmed. */
  function docLabel() {
    var t = (document.title || "").replace(/\s*[|—-]\s*Transit.*$/i, "").trim();
    return t.slice(0, 40);
  }

  function stopPolling() { if (timer) { clearInterval(timer); timer = null; } }
  function stop() {
    stopPolling();
    if (clock) { clearInterval(clock); clock = null; }
    live = null; resumeFn = null;
  }

  /* Put the timers back on a code that is still good.

     gate.js ends its demo by clearing EVERY interval on the page -- deliberately,
     so a board behind the wall stops burning battery and agency rate limits. If
     the trial runs out while somebody is halfway through pairing, that sweep
     takes this panel's polling with it, and the result is the worst possible
     one: a valid code on the television, a phone that reports success, and a
     screen that waits for ever because nothing is listening any more.

     So the sweeper calls this afterwards. No new code is minted -- the one on
     screen is still the live one, and asking the viewer to rescan would be
     inventing a second problem to solve the first. */
  function resume() {
    if (!live || !resumeFn || live.until <= Date.now()) return false;
    resumeFn();
    return true;
  }

  /* XHR rather than fetch: this is the one file guaranteed to run on the oldest
     browser in the building, and it is not worth a polyfill argument. */
  function request(method, url, body, cb) {
    var x = new XMLHttpRequest();
    var done = false;
    function finish(err, data) { if (!done) { done = true; cb(err, data); } }
    try { x.open(method, url, true); } catch (_) { finish(new Error("open")); return; }
    x.timeout = 15000;
    if (body) x.setRequestHeader("Content-Type", "application/json");
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      var data = null;
      try { data = JSON.parse(x.responseText); } catch (_) {}
      if (!x.status) return finish(new Error("offline"), null);
      finish(null, data);
    };
    x.ontimeout = function () { finish(new Error("timeout"), null); };
    x.onerror = function () { finish(new Error("network"), null); };
    try { x.send(body ? JSON.stringify(body) : null); } catch (_) { finish(new Error("send")); }
  }

  window.TBPair = { mount: mount, stop: stop, resume: resume, available: available };
})();
