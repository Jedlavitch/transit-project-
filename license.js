/* ============================================================================
   license.js — Transit Project licensing module (loaded by every city board)

   DORMANT BY DEFAULT: until a license server URL is configured below (or in
   localStorage "tb.workerUrl"), this file does nothing at all and the boards
   behave exactly as before. Once configured:

     - unlicensed browsers show a small "evaluation" chip (bottom-right) that
       opens a dialog to buy a license (buy.html) or enter a key
     - a valid key (verified against license-worker.js, cached 24h, with a
       14-day offline grace window so a kiosk survives internet blips) hides
       the chip everywhere on this device
     - the key lives in localStorage "tb.license", shared by all city boards

   This is deliberately a SOFT gate — honest for a static site (anyone can
   read the source). It sells convenience + supporting development, which is
   the right fit for hobbyist kiosk buyers. See SELLING.md.
   ============================================================================ */
(function () {
  "use strict";
  const FILE_CFG = {
    // The licence server. A public endpoint, not a secret: it verifies keys and
    // issues them against a paid Stripe session, and holds nothing worth taking.
    workerUrl: "https://tblicense.jacklemonade2.workers.dev",
    buyUrl: "buy.html",
  };
  const LS = { key: "tb.license", okUntil: "tb.license.okUntil", lastOk: "tb.license.lastOk",
               dev: "tb.device", url: "tb.workerUrl" };
  const DAY = 86400000, GRACE_MS = 14 * DAY;

  const cfg = Object.assign({}, FILE_CFG, window.TB_LICENSE_CFG || {});
  let workerUrl = "";
  try { workerUrl = (localStorage.getItem(LS.url) || cfg.workerUrl || "").trim().replace(/\/+$/, ""); } catch (_) {}

  // Not configured -> licensing system entirely dormant (boards act licensed).
  if (!workerUrl) { window.TBLicense = { configured: false, licensed: true }; return; }

  const get = k => { try { return localStorage.getItem(k); } catch (_) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

  function deviceId() {
    let d = get(LS.dev);
    if (!d) {
      const b = new Uint8Array(8); crypto.getRandomValues(b);
      d = "d" + [...b].map(x => x.toString(16).padStart(2, "0")).join("");
      set(LS.dev, d);
    }
    return d;
  }

  const state = { licensed: false, key: (get(LS.key) || "").trim().toUpperCase(), checking: false };

  async function verify(force, keyOverride) {
    const key = (keyOverride || state.key || "").trim().toUpperCase();
    if (!key) { state.licensed = false; render(); return { ok: false, error: "no_key" }; }
    if (!force && Number(get(LS.okUntil) || 0) > Date.now()) { state.licensed = true; render(); return { ok: true, cached: true }; }
    state.checking = true;
    try {
      const r = await fetch(`${workerUrl}/verify?key=${encodeURIComponent(key)}&device=${deviceId()}`, { cache: "no-store" });
      const data = await r.json();
      state.checking = false;
      if (data.ok) {
        state.key = key; set(LS.key, key);
        set(LS.okUntil, String(Date.now() + DAY)); set(LS.lastOk, String(Date.now()));
        state.licensed = true; render(); return data;
      }
      // The server answered and said no: only clear if it's a real rejection.
      state.licensed = false; render(); return data;
    } catch (_) {
      // Network failed: kiosks must survive internet blips — honor a recent OK.
      state.checking = false;
      state.licensed = Number(get(LS.lastOk) || 0) > Date.now() - GRACE_MS;
      render(); return { ok: state.licensed, offline: true };
    }
  }

  /* ---------------- UI: chip + dialog (self-contained styles) ---------------- */
  const css = `
  #tbLicChip{position:fixed; right:14px; bottom:42px; z-index:600; display:flex; align-items:center; gap:6px;
    padding:5px 10px; border-radius:8px; background:var(--panel,#111d36); color:var(--muted,#93a5cf);
    border:1px solid var(--line,#22345a); font:600 10px/1 ui-monospace,Menlo,monospace;
    letter-spacing:.08em; text-transform:uppercase; cursor:pointer; opacity:.9}
  #tbLicChip:hover{border-color:var(--accent,#4ea1ff); color:var(--text,#eef3ff)}
  #tbLicChip .diamond{color:var(--warn,#ffcc33)}
  #tbLicOverlay{position:fixed; inset:0; z-index:9000; display:flex; align-items:center; justify-content:center;
    background:var(--scrim,rgba(5,10,22,.86))}
  #tbLicBox{background:var(--panel,#111d36); border:1px solid var(--line,#22345a); border-radius:12px;
    padding:22px; width:min(400px,92vw); color:var(--text,#eef3ff);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  #tbLicBox h3{margin:0 0 6px; font-size:17px}
  #tbLicBox p{margin:6px 0; font-size:12.5px; color:var(--muted,#93a5cf); line-height:1.5}
  #tbLicBox input{width:100%; padding:10px 11px; border-radius:8px; border:1px solid var(--line,#22345a);
    background:var(--row-bg,#0d1830); color:var(--text,#eef3ff); font:700 14px ui-monospace,Menlo,monospace;
    letter-spacing:.06em; text-transform:uppercase; margin-top:8px}
  #tbLicBox .btns{display:flex; gap:9px; margin-top:14px}
  #tbLicBox button{flex:1; padding:10px; border-radius:8px; border:none; background:var(--accent,#4ea1ff);
    color:#04101f; font-weight:800; font-size:13px; cursor:pointer}
  #tbLicBox button.ghost{background:transparent; color:var(--text,#eef3ff); border:1px solid var(--line,#22345a)}
  #tbLicMsg{font-size:12px; min-height:15px; margin-top:8px}`;

  let chip = null, overlay = null;

  function render() {
    if (!document.body) return;
    if (state.licensed) { if (chip) { chip.remove(); chip = null; } return; }
    if (!chip) {
      chip = document.createElement("div");
      chip.id = "tbLicChip";
      chip.innerHTML = `<span class="diamond">◇</span> evaluation — click to license`;
      chip.onclick = openDialog;
      document.body.appendChild(chip);
    }
  }

  function openDialog() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.id = "tbLicOverlay";
    overlay.innerHTML = `<div id="tbLicBox">
      <h3>License this board</h3>
      <p>You're running the free evaluation. A license removes this notice on up to 5
         of your devices and supports development.</p>
      <input id="tbLicInput" placeholder="TB-XXXXX-XXXXX-XXXXX-XXXXX" autocomplete="off" spellcheck="false"
             value="${state.key || ""}" />
      <div id="tbLicMsg"></div>
      <div class="btns">
        <button id="tbLicBuy">Buy a license</button>
        <button class="ghost" id="tbLicApply">Activate key</button>
        <button class="ghost" id="tbLicClose">Close</button>
      </div></div>`;
    overlay.addEventListener("click", e => { if (e.target === overlay) closeDialog(); });
    document.body.appendChild(overlay);
    const msg = overlay.querySelector("#tbLicMsg");
    overlay.querySelector("#tbLicBuy").onclick = () => { window.location.href = cfg.buyUrl; };
    overlay.querySelector("#tbLicApply").onclick = async () => {
      const k = overlay.querySelector("#tbLicInput").value;
      msg.style.color = "var(--muted,#93a5cf)"; msg.textContent = "Checking…";
      const res = await verify(true, k);
      if (res.ok) { msg.style.color = "var(--good,#33d17a)"; msg.textContent = "Licensed — thank you!"; setTimeout(closeDialog, 900); }
      else if (res.offline) { msg.style.color = "var(--warn,#ffcc33)"; msg.textContent = "Can't reach the license server — check your connection."; }
      else { msg.style.color = "var(--late,#ff5a5a)"; msg.textContent =
        res.error === "device_limit" ? "This key is already on its maximum number of devices." : "That key wasn't recognized."; }
    };
    overlay.querySelector("#tbLicClose").onclick = closeDialog;
  }
  function closeDialog() { if (overlay) { overlay.remove(); overlay = null; } }

  function init() {
    try {
      const style = document.createElement("style"); style.textContent = css;
      document.head.appendChild(style);
      verify(false);
      setInterval(() => verify(false), 6 * 3600000);   // re-check twice a day
    } catch (_) {}
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.TBLicense = {
    configured: true,
    get licensed() { return state.licensed; },
    enterKey: k => verify(true, k),
    open: openDialog,
    // Already resolved above (localStorage override, else the shipped default).
    // profile.html reads these rather than keeping a second copy of the URL and
    // its own device-id logic, which would drift out of step with this file.
    url: workerUrl,
    device: deviceId,
  };
})();
