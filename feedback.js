/* ============================================================================
   feedback.js — "Report a bug / Give feedback" button + modal, shared by every
   city board (loaded the same way as license.js/spotlog.js).

   WHERE THE BUTTON LIVES: in the ⚙ settings panel's footer row, beside the
   panel's own actions. It used to float over the board itself, pinned near
   bottom-centre — the only strip of the bottom edge not already claimed by the
   mascot, the licence chip, the trial countdown and the two health chips — and
   holding that strip took two screenfuls of collision-avoidance CSS that still
   left the button sitting on top of the map. Inside the panel it collides with
   nothing, so all of that is gone.

   STORAGE, HONESTLY STATED — two paths, chosen automatically by hostname:

   LOCAL DEV (localhost/127.0.0.1/file:): POSTs JSON to /api/feedback, answered
   by feedback-server.py (see that file + .claude/launch.json — it replaces
   the plain `python3 -m http.server` dev server with one that also appends
   each report as a line of JSON to reports/feedback.jsonl at the project
   root). Unchanged from before.

   DEPLOYED (GitHub Pages, or any non-localhost host): there is no server to
   write to, so this POSTs straight to Web3Forms (web3forms.com) — a free
   service built exactly for this: a static site POSTs form data as JSON, it
   emails the submission, no backend of your own required. Needs one thing to
   activate: WEB3FORMS_ACCESS_KEY below.

     TO TURN ON PRODUCTION FEEDBACK:
     1. Go to https://web3forms.com, enter the email you want reports sent
        to. No account/signup — it emails you an access key directly.
     2. Paste that key as the WEB3FORMS_ACCESS_KEY string below, replacing
        the placeholder.
     3. Deploy. That's it — no server, no Worker, nothing else to run.

   Until that key is a real one, the deployed dialog says plainly that
   feedback isn't wired up yet instead of silently POSTing to a fake
   endpoint and pretending it worked. Same three fields either way:
   timestamp, message, page.
   ============================================================================ */
(function () {
  "use strict";
  const LOCAL_ENDPOINT = "/api/feedback";

  // See "TO TURN ON PRODUCTION FEEDBACK" above. Replace the placeholder with
  // a real Web3Forms access key to enable feedback on the deployed site.
  const WEB3FORMS_ACCESS_KEY = "YOUR_WEB3FORMS_ACCESS_KEY_HERE";
  const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";

  function isLocalDev() {
    // ?tbForceProd=1 is a manual-testing escape hatch (exercise the Web3Forms
    // path from a localhost dev server without actually deploying) — it does
    // not affect real visitors, who are routed purely by hostname.
    try { if (new URLSearchParams(location.search).has("tbForceProd")) return false; } catch (_) {}
    return location.protocol === "file:" ||
      /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  }

  // Throws on failure; callers distinguish "not configured yet" from a real
  // network/server failure so the dialog can say the right thing.
  async function submitFeedback(message, page) {
    const timestamp = new Date().toISOString();
    if (isLocalDev()) {
      const r = await fetch(LOCAL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message, page: page }),
      });
      if (!r.ok) throw new Error("local endpoint responded " + r.status);
      return;
    }
    if (!WEB3FORMS_ACCESS_KEY || WEB3FORMS_ACCESS_KEY === "YOUR_WEB3FORMS_ACCESS_KEY_HERE") {
      throw new Error("NOT_CONFIGURED");
    }
    const r = await fetch(WEB3FORMS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        access_key: WEB3FORMS_ACCESS_KEY,
        subject: "Transit board feedback",
        from_name: "Transit board feedback",
        message: message,
        page: page,
        timestamp: timestamp,
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.success === false) throw new Error(data.message || "Web3Forms responded " + r.status);
  }

  const css = `
  /* Scoped to #setup and keyed off the id TWICE on purpose. The boards style
     every button in the panel with \`#setup button{flex:1; background:
     var(--accent); font-weight:800; border:none}\` — specificity (1,0,1) —
     which would stretch a bug report to a third of the footer and paint it in
     the same loud accent as "Save & start". \`#setup #tbFbBtn\` is (2,0,0) and
     beats that on its own, so none of this needs !important. */
  #setup #tbFbBtn{flex:0 0 auto; margin-right:auto;
    display:inline-flex; align-items:center; gap:6px;
    padding:11px 12px; border-radius:10px; background:transparent; color:var(--muted,#93a5cf);
    border:1px solid var(--line,#22345a); font:600 12px/1 var(--body,-apple-system,sans-serif);
    letter-spacing:.02em; cursor:pointer}
  #setup #tbFbBtn:hover{border-color:var(--accent,#4ea1ff); color:var(--text,#eef3ff)}
  #setup #tbFbBtn .flag{color:var(--accent,#4ea1ff)}
  /* The panel drops to a single narrow column at 620px; shrink to the flag
     alone rather than let the label wrap and shove the panel's own actions
     onto a second line. */
  @media (max-width:620px){ #setup #tbFbBtn .full{display:none} }

  /* Above #setup's own z-index:9999 (identical on all twelve boards). The
     panel is hidden while this dialog is up — see openDialog — so this only
     matters if some other path ever opens the dialog with the panel showing,
     which is cheap insurance rather than a live requirement. Still well under
     gate.js's 2147483600 lock screen, which must stay on top of everything. */
  #tbFbOverlay{position:fixed; top:0;right:0;bottom:0;left:0;inset:0; z-index:10050; display:flex; align-items:center; justify-content:center;
    background:var(--scrim,rgba(5,10,22,.86)); padding:16px}
  #tbFbBox{background:var(--panel,#111d36); border:1px solid var(--line,#22345a); border-radius:12px;
    padding:22px; width:min(440px,94vw); max-height:88vh; overflow:auto; color:var(--text,#eef3ff);
    font-family:var(--body,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif)}
  #tbFbBox h3{margin:0 0 6px; font-size:17px}
  #tbFbBox p{margin:6px 0 12px; font-size:12.5px; color:var(--muted,#93a5cf); line-height:1.5}
  #tbFbBox textarea{width:100%; min-height:120px; max-height:40vh; padding:10px 11px; border-radius:8px;
    border:1px solid var(--line,#22345a); background:var(--row-bg,#0d1830); color:var(--text,#eef3ff);
    font:13px/1.5 var(--body,-apple-system,sans-serif); resize:vertical}
  #tbFbBox .btns{display:flex; gap:9px; margin-top:14px}
  #tbFbBox button{flex:1; padding:10px; border-radius:8px; border:none; background:var(--accent,#4ea1ff);
    color:#04101f; font-weight:800; font-size:13px; cursor:pointer}
  #tbFbBox button.ghost{background:transparent; color:var(--text,#eef3ff); border:1px solid var(--line,#22345a)}
  #tbFbBox button:disabled{opacity:.55; cursor:default}
  #tbFbMsg{font-size:12px; min-height:15px; margin-top:8px}`;

  let overlay = null;

  /* The dialog is opened FROM the settings panel now, so the panel steps aside
     while the dialog is up and comes back when it closes. Two real reasons,
     not just tidiness:

     1. Two scrims stack. --scrim is rgba(5,10,22,.86); the panel's and this
        one together land at ~.98 — effectively black, with the panel behind it
        a barely-visible ghost.
     2. settings-ui.js binds Escape on `document` in the CAPTURE phase, and it
        registers first (both files are `defer`, its tag is the earlier one),
        so it would close the panel out from under this dialog on the same
        keypress that closes the dialog. Its handler is guarded by
        `panel.classList.contains("show")` — with the panel already hidden that
        guard is false, so Escape reaches only this dialog no matter which
        listener ran first. Order-independent, which a stopPropagation race
        would not have been.

     Toggling `.show` directly is exactly what the boards' own openSetup/
     closeSetup do (`#setup.show{display:flex}`), minus openSetup's focus grab
     on the API-key field — which would otherwise steal focus from the textarea
     the moment the dialog closed. */
  let reopenSetup = false;

  function hideSetupPanel() {
    const p = document.getElementById("setup");
    reopenSetup = !!(p && p.classList.contains("show"));
    if (reopenSetup) p.classList.remove("show");
  }

  function restoreSetupPanel() {
    if (!reopenSetup) return;
    reopenSetup = false;
    const p = document.getElementById("setup");
    if (p) p.classList.add("show");
  }

  function openDialog() {
    if (overlay) return;
    hideSetupPanel();
    overlay = document.createElement("div");
    overlay.id = "tbFbOverlay";
    overlay.innerHTML = `<div id="tbFbBox">
      <h3>Report a bug / give feedback</h3>
      <p>What happened, or what should be better? Include what you were doing when you
         noticed it, if that's relevant.</p>
      <textarea id="tbFbText" placeholder="Type your report here…" autofocus></textarea>
      <div id="tbFbMsg"></div>
      <div class="btns">
        <button id="tbFbSend">Send</button>
        <button class="ghost" id="tbFbCancel">Cancel</button>
      </div>
    </div>`;
    overlay.addEventListener("click", e => { if (e.target === overlay) closeDialog(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);

    const box = overlay.querySelector("#tbFbBox");
    box.addEventListener("click", e => e.stopPropagation());
    const ta = overlay.querySelector("#tbFbText");
    const msg = overlay.querySelector("#tbFbMsg");
    const sendBtn = overlay.querySelector("#tbFbSend");
    ta.focus();

    overlay.querySelector("#tbFbCancel").onclick = closeDialog;
    sendBtn.onclick = async () => {
      const message = ta.value.trim();
      if (!message) { msg.style.color = "var(--late,#ff5a5a)"; msg.textContent = "Type something first."; return; }
      sendBtn.disabled = true;
      msg.style.color = "var(--muted,#93a5cf)"; msg.textContent = "Sending…";
      try {
        await submitFeedback(message, window.location.href);
        msg.style.color = "var(--good,#33d17a)"; msg.textContent = "Thanks — got it.";
        setTimeout(closeDialog, 1000);
      } catch (e) {
        sendBtn.disabled = false;
        msg.style.color = "var(--late,#ff5a5a)";
        // NOT_CONFIGURED means this deployment's WEB3FORMS_ACCESS_KEY is still
        // the placeholder — a real, expected state until someone pastes a key
        // in (see the file header), distinct from an actual submit failure.
        msg.textContent = e && e.message === "NOT_CONFIGURED"
          ? "Feedback isn't set up on this deployment yet — nothing was sent."
          : "Couldn't reach the server — your message wasn't lost, try again in a moment.";
      }
    };
  }

  function onKey(e) { if (e.key === "Escape") closeDialog(); }

  function closeDialog() {
    document.removeEventListener("keydown", onKey);
    if (overlay) { overlay.remove(); overlay = null; }
    restoreSetupPanel();
  }

  /* The panel's footer row. It is a direct child of `#setup .box` until the
     board's own groupSettings() moves it wholesale into `.set-foot`, the first
     time the panel is opened — the button rides along inside it, so mounting
     once is enough whichever side of that move this runs on.

     Deliberately not a bare `#setup .btns`: newjersey.html has a second one
     nested in a <details> (the "Save" for its NJT worker login) that comes
     first in document order and is not the footer. Both selectors below are
     anchored to the footer specifically.

     The footer is also why this goes here rather than into the panel body as
     its own section: it is sticky and shown on every tab, whereas a body
     section gets filed under exactly one tab by settings-ui.js — which buckets
     groups by heading text, and its Feeds-&-keys pattern matches /feed/, so
     "Feedback" would have landed next to the API keys. */
  function footRow() {
    return document.querySelector("#setup .set-foot .btns") ||
           document.querySelector("#setup .box > .btns");
  }

  let btn = null;

  function mount() {
    if (btn && btn.isConnected) return true;
    const row = footRow();
    if (!row) return false;
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "tbFbBtn";
      btn.title = "Report a bug / give feedback";
      btn.innerHTML = `<span class="flag">⚑</span><span class="full">Report a bug / give feedback</span>`;
      btn.onclick = openDialog;
    }
    row.insertBefore(btn, row.firstChild);
    return true;
  }

  function init() {
    try {
      const style = document.createElement("style"); style.textContent = css;
      document.head.appendChild(style);
      if (mount()) return;
      /* No footer found yet — a board whose panel markup arrives later. Retry
         on the next interaction instead of polling. If a page genuinely has no
         settings panel there is nowhere for this to live and it stays absent,
         which is the honest outcome; reviving the floating chip as a fallback
         would just reinstate the thing this replaced. */
      const retry = function () { if (mount()) document.removeEventListener("click", retry, true); };
      document.addEventListener("click", retry, true);
    } catch (_) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
