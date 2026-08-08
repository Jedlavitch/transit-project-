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

   DORMANT UNTIL CONFIGURED
     With no passphrase set, every board behaves exactly as it does today and
     nothing is hidden. The gate only starts working once you set ADMIN_SHA256,
     so shipping this file changes nothing for anyone who ignores it.

   SETTING IT UP
     1. In a board's console:  await TBAdmin.hash("your passphrase")
     2. Paste that hash into ADMIN_SHA256 below and redeploy.
     3. Unlock a kiosk once:   https://…/index.html?admin=your%20passphrase
        Lock it again:         https://…/index.html?admin=off
     The unlock is remembered per device, so you set up a screen once and the
     customer never sees a field. The passphrase never appears in the source —
     only its hash — so reading the page does not reveal it.
   ============================================================================ */
(function () {
  "use strict";

  // sha-256 of your admin passphrase, lowercase hex. Empty = gate off entirely.
  const ADMIN_SHA256 = "";

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
                     "feedUrl", "sheetUrl"];

  function markup() {
    FIELD_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const box = el.closest("details") || el.closest("label") || el;
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
    // No passphrase configured -> dormant: show everything, exactly as before.
    if (!ADMIN_SHA256) { apply(true); return; }

    let admin = stored();
    const q = new URLSearchParams(location.search).get("admin");
    if (q !== null) {
      if (/^(off|0|false|lock)$/i.test(q)) { admin = false; store(false); }
      else {
        try { admin = (await sha256(q)) === ADMIN_SHA256.toLowerCase(); } catch (_) { admin = false; }
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
    isAdmin: () => !ADMIN_SHA256 || stored(),
    set(v) { store(!!v); apply(!ADMIN_SHA256 || !!v); },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
