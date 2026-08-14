/* ============================================================================
   feedback.js — "Report a bug / Give feedback" button + modal, shared by every
   city board (loaded the same way as license.js/spotlog.js).

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
  /* Bottom-center, deliberately: both bottom corners already carry a stack of
     conditional kiosk-status chips (mascot buddy, license eval, trial/worker/
     schedule health warnings — see gate.js/license.js/mascot-buddy.js/
     worker-health.js/schedule-health.js/licence-proxy.js/config.js), all
     fixed at left:8-14px or right:12-14px, several already stacked on top of
     each other by bottom offset. Center is the one bottom strip none of them
     claims at rest -- but mascot-buddy.js's speech bubble (#tbBuddy .bub)
     isn't just its 12px anchor: when talking it grows up to 300px wide,
     reaching to real-device x=374 on any viewport >= 652px (its own
     min(46vw,300px) cap), which DOES cross true center on tablet-width
     screens (confirmed colliding at 768px via a getBoundingClientRect
     intersection check, not just eyeballed). The left rule below holds true
     center on anything wide enough to clear that reach and only nudges right on
     narrower screens -- 490px was chosen as that reach (374) plus this
     button's own ~96px half-width plus a clear margin, so it holds true
     center already by ~1000px wide and never overlaps narrower than that. */
  #tbFbBtn{position:fixed; left:max(490px,50%); bottom:12px; transform:translateX(-50%); z-index:610;
    display:flex; align-items:center; gap:6px;
    padding:8px 12px; border-radius:8px; background:var(--panel,#111d36); color:var(--muted,#93a5cf);
    border:1px solid var(--line,#22345a); font:600 11px/1 var(--body,-apple-system,sans-serif);
    letter-spacing:.02em; cursor:pointer; opacity:.9}
  #tbFbBtn:hover{border-color:var(--accent,#4ea1ff); color:var(--text,#eef3ff); opacity:1}
  #tbFbBtn .flag{color:var(--accent,#4ea1ff)}
  @media (max-width:480px){ #tbFbBtn .full{display:none} }
  #tbFbOverlay{position:fixed; top:0;right:0;bottom:0;left:0;inset:0; z-index:9200; display:flex; align-items:center; justify-content:center;
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

  function openDialog() {
    if (overlay) return;
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
  }

  function render() {
    if (!document.body) return;
    const btn = document.createElement("div");
    btn.id = "tbFbBtn";
    btn.innerHTML = `<span class="flag">⚑</span><span class="full">Report a bug / Give feedback</span>`;
    btn.onclick = openDialog;
    document.body.appendChild(btn);
  }

  function init() {
    try {
      const style = document.createElement("style"); style.textContent = css;
      document.head.appendChild(style);
      render();
    } catch (_) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
