/* ============================================================================
   admin.js — keeps operator setup out of a customer's board.

   The boards carry plumbing only whoever deployed them should ever touch: the
   optional Cloudflare Worker URLs, the shared-feed code, the spreadsheet mirror.
   A hobbyist who bought a finished kiosk should not meet any of it — every field
   is a way to break their board and a support question for you.

   WHAT THIS IS NOT
     A security boundary. A static site ships all of its code to the browser, so
     anyone willing to open devtools can set the same flag by hand. Treat it as
     a cover over the controls, not a lock: nothing hidden behind it may be a
     secret worth protecting, and a Worker URL that must stay private cannot be
     kept private by this. Same honest trade-off as the licence chip.

   DORMANT UNTIL YOU CREATE A LOGIN
     With no login created, every board behaves exactly as it does today and
     nothing is hidden. There is no passphrase in this file — nothing is baked in
     and there is nothing to edit.

   SETTING IT UP
     1. Open admin.html. The first visit asks you to pick a username and
        password; after that it asks you to sign in with them.
     2. Signing in unlocks the operator controls on this device.
        Lock it again from admin.html, or with …/index.html?admin=off

     The login lives on the device that created it, and only the password's
     SHA-256 is stored. Set it up once per screen.
   ============================================================================ */
(function () {
  "use strict";

  /* The only password that exists is the one created in admin.html, stored as a
     SHA-256 on that device. Nothing is baked into this file, so there is no
     passphrase in the source for anyone to read, lift, or guess against — and
     no value here that the owner did not choose. Empty = gate off entirely. */
  const adminHash = () => {
    try { return (localStorage.getItem("tb.adminHash") || "").trim().toLowerCase(); }
    catch (_) { return ""; }
  };

  const KEY = "tb.admin";
  const CLASS = "tb-customer";          // on <html>: "hide the operator controls"

  const stored = () => { try { return localStorage.getItem(KEY) === "1"; } catch (_) { return false; } };
  const store = v => { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch (_) {} };

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  }

  /* Everything an operator sets up and a customer never should. Grouped blocks
     carry data-admin in the markup; these ids catch the bare fields, and each
     one hides its enclosing <details>/<label> so no orphan heading is left
     behind explaining a control that is no longer there. */
  const FIELD_IDS = ["marcInput", "septaInput", "pathInput", "njtInput", "njtUserInput",
                     "njtPassInput", "busInput", "liveUrlInput", "tlInput",
                     "feedUrl", "sheetUrl", "keyInput"];

  function markup() {
    FIELD_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      // .set-group first: the boards wrap each settings section in one, and
      // hiding only the input would leave its heading and instructions behind
      // describing a field that is no longer there.
      const box = el.closest("details") || el.closest(".set-group") || el.closest("label") || el;
      box.setAttribute("data-admin", "");
    });
    // "Advanced: …" disclosures are operator territory by definition
    document.querySelectorAll("details > summary").forEach(s => {
      if (/^\s*advanced/i.test(s.textContent || "")) s.parentElement.setAttribute("data-admin", "");
    });
  }

  function apply(isAdmin) {
    document.documentElement.classList.toggle(CLASS, !isAdmin);
  }

  /* The Admin link used to be injected into every board's nav. It is gone: with
     config.js shipping the keys and Worker URLs, a customer has no reason to
     open that page, and a setup link sitting in the navigation of a product you
     sold is an invitation to break it.

     The page itself is untouched and still reachable by typing /admin.html —
     which is the right shape for this. The operator knows the address; the
     customer never sees that it exists. If a link is ever wanted back, show it
     only when stored() is already true, so it appears for an unlocked screen and
     for nobody else. */
  function removeAdminLink() {
    const a = document.getElementById("tbAdminLink");
    if (a) a.remove();          // clears the link from any cached older page
  }

  function styles() {
    if (document.getElementById("tbAdminCss")) return;
    const st = document.createElement("style");
    st.id = "tbAdminCss";
    // !important because several of these live in panels that set display inline
    st.textContent = ":root." + CLASS + " [data-admin]{display:none !important}";
    document.head.appendChild(st);
  }

  async function boot() {
    styles();
    removeAdminLink();

    /* Hidden by DEFAULT. This used to show everything whenever no admin login
       existed on the device, which sounds like a sensible dormant state and is
       exactly backwards: the login lives in localStorage, so a CUSTOMER's device
       has never created one. Every customer therefore fell into the "no login,
       show everything" branch and saw every Worker URL, API key box and feed
       control on the board — the precise opposite of the intent. Verified before
       changing it: on a cleared board TBAdmin.isAdmin() answered true and no
       hiding class was applied.

       Now nothing operator-only shows until someone explicitly unlocks the
       screen at admin.html, which is a step only the operator can perform. Your
       own kiosks need unlocking once each; that was already the workflow. */
    let admin = stored();
    const q = new URLSearchParams(location.search).get("admin");
    if (q !== null) {
      if (/^(off|0|false|lock)$/i.test(q)) { admin = false; store(false); }
      else {
        try { admin = (await sha256(q)) === adminHash(); } catch (_) { admin = false; }
        if (admin) store(true);
      }
      // strip it from the address bar so the passphrase isn't left on screen,
      // in history, or in a screenshot of the kiosk
      try {
        const u = new URL(location.href);
        u.searchParams.delete("admin");
        history.replaceState(null, "", u.pathname + (u.search || "") + u.hash);
      } catch (_) {}
    }
    markup();
    apply(admin);
    // Panels build their contents lazily, so re-mark whenever the DOM grows.
    try {
      new MutationObserver(() => { markup(); }).observe(document.body, { childList: true, subtree: true });
    } catch (_) {}
  }

  window.TBAdmin = {
    hash: sha256,
    isAdmin: () => stored(),          // explicitly unlocked, nothing else counts
    set(v) { store(!!v); apply(!!v); },
    /* Verify a typed passphrase and unlock this device on success. Lets
       admin.html be set up by typing rather than by visiting a URL with the
       passphrase in it — easier on a TV remote, and it leaves nothing on screen
       or in history. Returns false on a bad one rather than throwing. */
    async check(v) {
      // No login created means there is nothing to check against, so nothing can
      // pass. Previously returned true here, which combined with the old default
      // meant an unconfigured board treated every visitor as the operator.
      if (!adminHash()) return false;
      let ok = false;
      try { ok = (await sha256(v)) === adminHash(); } catch (_) { ok = false; }
      if (ok) { store(true); apply(true); }
      return ok;
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
