"use strict";
const $ = s => document.querySelector(s);
const LS = { key:"tb.license", dev:"tb.device", spots:"tb.spots", blob:"tb.spotBlob",
             theme:"tb.theme", accent:"tb.accent", rows:"tb.rows", licUrl:"tb.workerUrl" };
const get = k => { try { return localStorage.getItem(k) || ""; } catch(e){ return ""; } };
function say(el, text, kind){ const e=$(el); if(!e) return; e.textContent=text||"";
  e.className = "msg" + (kind ? " " + kind : ""); }
const esc = s => String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
/* Back to step one. Signing out after a code left the old code and "Code sent to…"
   on screen, with nowhere to type an address. */
function resetSignIn(){
  $("#stepCode").classList.add("hide"); $("#stepEmail").classList.remove("hide");
  $("#codeInput").value=""; authToken=""; say("#acctMsg","");
}

/* Come back to whichever board sent you here, when that is knowable. */
(function backLink(){
  const from = new URLSearchParams(location.search).get("from");
  if (from && /^[a-z]+\.html$/.test(from)) $("#backLink").href = from;
})();

/* ── Account ──────────────────────────────────────────────────────────────
   account.js is dormant with no Worker URL, so the three states are: not
   configured at all, configured-and-signed-out, and signed in. Which ways in
   to offer inside that second state is the Worker's business, not ours — see
   methods(). */
let authToken = "";
let acctMethods = { code: true, password: false, google: false, apple: false };

async function paintAccount(){
  const A = window.TBAccount;
  const configured = !!(A && A.configured());
  $("#acctOff").classList.toggle("hide", configured);
  $("#acctIn").classList.toggle("hide", !configured || A.signedIn());
  $("#acctUser").classList.toggle("hide", !configured || !A.signedIn());
  if (!configured) return;

  acctMethods = await A.methods();
  $("#googleBtn").classList.toggle("hide", !acctMethods.google);
  $("#appleBtn").classList.toggle("hide", !acctMethods.apple);
  $("#provRow").classList.toggle("hide", !(acctMethods.google || acctMethods.apple));
  $("#pwWrap").classList.toggle("hide", !acctMethods.password);
  $("#pwNote").classList.toggle("hide", !(acctMethods.password && acctMethods.code));
  labelSubmit();

  if (A.signedIn()) {
    $("#acctEmail").textContent = A.email() || "(unknown)";
    const has = A.hasPassword();
    $("#pwState").innerHTML = has
      ? '<span class="pill ok">Set</span>'
      : '<span class="pill off">Not set</span>';
    $("#pwEditBtn").textContent = has ? "Change password" : "Set a password";
    $("#pwEditBtn").classList.toggle("hide", !acctMethods.password);
    $("#pwCurWrap").classList.toggle("hide", !has);
    $("#pwRemoveBtn").classList.toggle("hide", !has);
  }
}

/* Keep the button honest about which door the current input will use. */
function labelSubmit(){
  const pw = acctMethods.password ? $("#pwInput").value : "";
  $("#sendCodeBtn").textContent = (pw || !acctMethods.code) ? "Sign in" : "Email me a code";
}
$("#pwInput").addEventListener("input", labelSubmit);
$("#googleBtn").onclick = () => TBAccount.oauthGo("google");
$("#appleBtn").onclick = () => TBAccount.oauthGo("apple");

$("#sendCodeBtn").onclick = async () => {
  const addr = $("#emailInput").value.trim();
  if (!addr || addr.indexOf("@") < 1) return say("#acctMsg", "That doesn't look like an email address.", "bad");
  const pw = acctMethods.password ? $("#pwInput").value : "";

  if (pw) {
    say("#acctMsg", "Signing in…");
    try {
      await TBAccount.signInPassword(addr, pw);
      $("#pwInput").value = "";
      await paintAccount(); paintSpots();
      say("#acctMsg", "");
    } catch (e) { say("#acctMsg", e.message, "bad"); }
    return;
  }
  if (!acctMethods.code) return say("#acctMsg", "Enter your password.", "bad");

  say("#acctMsg", "Sending…");
  try {
    authToken = await TBAccount.start(addr);
    $("#stepEmail").classList.add("hide");
    $("#stepCode").classList.remove("hide");
    $("#codeInput").focus();
    say("#acctMsg", "Code sent to " + addr + ".", "good");
  } catch (e) { say("#acctMsg", "Couldn't send a code: " + e.message, "bad"); }
};

/* ── the password itself ────────────────────────────────────────────────── */
$("#pwEditBtn").onclick = () => {
  const open = $("#pwEdit").classList.toggle("hide");
  if (!open) $("#pwNew").focus();
};
$("#pwSaveBtn").onclick = async () => {
  const next = $("#pwNew").value;
  if (!next) return say("#acctMsg2", "Type the new password, or use Remove password.", "bad");
  say("#acctMsg2", "Saving…");
  try {
    await TBAccount.setPassword(next, $("#pwCur").value || undefined);
    $("#pwNew").value = ""; $("#pwCur").value = "";
    $("#pwEdit").classList.add("hide");
    await paintAccount();
    say("#acctMsg2", "Password saved. You can sign in with it on any device.", "good");
  } catch (e) { say("#acctMsg2", e.message, "bad"); }
};
$("#pwRemoveBtn").onclick = async () => {
  say("#acctMsg2", "Removing…");
  try {
    await TBAccount.setPassword("");
    $("#pwEdit").classList.add("hide");
    await paintAccount();
    say("#acctMsg2", "Password removed — sign in with a code or a provider.", "good");
  } catch (e) { say("#acctMsg2", e.message, "bad"); }
};
$("#backToEmailBtn").onclick = () => {
  $("#stepCode").classList.add("hide"); $("#stepEmail").classList.remove("hide"); say("#acctMsg","");
};
$("#verifyBtn").onclick = async () => {
  const code = $("#codeInput").value.trim();
  if (!/^\d{6}$/.test(code)) return say("#acctMsg", "The code is six digits.", "bad");
  say("#acctMsg", "Checking…");
  try { await TBAccount.verify(authToken, code); resetSignIn(); paintAccount(); paintSpots(); }
  catch (e) { say("#acctMsg", "That didn't work: " + e.message, "bad"); }
};
$("#syncBtn").onclick = async () => {
  say("#acctMsg2", "Syncing…");
  try { const r = await TBAccount.sync(); paintSpots();
        say("#acctMsg2", r ? `Synced — ${r.count} sightings.` : "Nothing to sync.", "good"); }
  catch (e) {
    say("#acctMsg2", "Sync failed: " + e.message, "bad");
    if (!TBAccount.signedIn()) { await paintAccount(); say("#acctMsg", "That session has ended. Please sign in again.", "bad"); }
  }
};
$("#signOutBtn").onclick = async () => {
  try { await TBAccount.signOut(); resetSignIn(); await paintAccount(); say("#acctMsg", "Signed out. Your sightings are still here.", "good"); }
  catch (e) { say("#acctMsg2", "Couldn't sign out: " + e.message, "bad"); }
};

/* ── Licence ──────────────────────────────────────────────────────────────
   The key is masked by default: this page is the one someone screenshots when
   asking for help. */
let revealed = false;
function maskKey(k){
  if (!k) return "";
  const parts = k.split("-");
  if (parts.length < 3) return k.slice(0,4) + "••••";
  return parts.map((p,i) => i===0 || i===1 ? p : "•".repeat(p.length)).join("-");
}
function paintKey(){
  const k = get(LS.key);
  $("#licKey").textContent = k ? (revealed ? k : maskKey(k)) : "None on this device";
  $("#revealBtn").textContent = revealed ? "Hide key" : "Reveal key";
  $("#revealBtn").classList.toggle("hide", !k);
  $("#copyKeyBtn").classList.toggle("hide", !k);
}
$("#revealBtn").onclick = () => { revealed = !revealed; paintKey(); };
$("#copyKeyBtn").onclick = async () => {
  try { await navigator.clipboard.writeText(get(LS.key)); say("#licMsg","Key copied.","good"); }
  catch(e){ say("#licMsg","Couldn't copy — reveal it and copy by hand.","bad"); }
};
$("#enterKeyBtn").onclick = () => $("#licEnter").classList.toggle("hide");
$("#saveKeyBtn").onclick = async () => {
  const k = $("#keyInput").value.trim().toUpperCase();
  if (!k) return;
  say("#licMsg", "Checking…");
  try {
    const ok = await window.TBLicense.enterKey(k);
    paintKey(); await paintLicence();
    say("#licMsg", ok === false ? "That key was not accepted." : "Key saved.", ok === false ? "bad" : "good");
  } catch (e) { say("#licMsg", "Couldn't check that key: " + e.message, "bad"); }
};

async function paintLicence(){
  const L = window.TBLicense;
  paintKey();
  if (!L || !L.configured) {
    $("#licStatus").innerHTML = '<span class="pill off">Not in use</span>';
    $("#licDevRow").classList.add("hide");
    $("#enterKeyBtn").classList.add("hide");   // enterKey does not exist while dormant
    $("#licEnter").classList.add("hide");
    $("#licNote").textContent = "Every board is free to use right now, so no licence is needed.";
    return;
  }
  $("#licStatus").innerHTML = L.licensed
    ? '<span class="pill ok">Licensed</span>' : '<span class="pill warn">Evaluation</span>';
  $("#licNote").textContent = L.licensed
    ? "Checked against the licence server every 24 hours, with 14 days of grace if it can't be reached — a kiosk offline for a fortnight keeps working."
    : "Running in evaluation. Enter a key above to unlock.";

  /* Device count comes from the same /verify the boards call, with the SAME
     device id this browser already registered — so asking here re-stamps that
     entry rather than consuming another of the five slots. */
  const key = get(LS.key), dev = (L.device ? L.device() : get(LS.dev));
  const base = (L.url || "").replace(/\/+$/, "");
  if (!key || !base) { $("#licDevRow").classList.add("hide"); return; }
  try {
    const r = await fetch(`${base}/verify?key=${encodeURIComponent(key)}&device=${encodeURIComponent(dev)}`,
                          { cache:"no-store" });
    const d = await r.json();
    /* Name the reason rather than showing a dash. This row is the one someone
       reads when a board says "evaluation" and they believe they have paid. */
    const WHY = {
      unknown_key:  "That key isn't recognised",
      revoked:      "This key has been revoked",
      device_limit: `Limit of ${d.limit} devices reached`,
      missing_key:  "No key to check",
    };
    $("#licDevRow").classList.remove("hide");
    $("#licDevices").textContent = d.ok ? `${d.devices} of ${d.limit}`
                                        : (WHY[d.error] || "Couldn't be checked");
  } catch (e) { $("#licDevices").textContent = "Couldn't reach the licence server"; }
}

/* ── Spotter ──────────────────────────────────────────────────────────── */
function paintSpots(){
  let spots = [];
  try { spots = JSON.parse(get(LS.spots) || "[]"); } catch(e){}
  if (!Array.isArray(spots)) spots = [];
  $("#spotCount").textContent = spots.length ? spots.length.toLocaleString() : "None yet";
  const latest = spots.filter(s => s && s.ts).sort((a,b) => b.ts - a.ts)[0];
  $("#spotLatest").textContent = latest
    ? new Date(latest.ts).toLocaleString([], {month:"short", day:"numeric", hour:"2-digit", minute:"2-digit"})
    : "—";
  const blob = get(LS.blob);
  $("#spotBlob").textContent = blob || "Not sharing";
  $("#copyBlobBtn").classList.toggle("hide", !blob);
}
$("#copyBlobBtn").onclick = async () => {
  try { await navigator.clipboard.writeText(get(LS.blob)); say("#spotMsg","Share code copied.","good"); }
  catch(e){ say("#spotMsg","Couldn't copy. Select the share code above and copy it by hand.","bad"); }
};
$("#openSpotBtn").onclick = () => { window.location.href = "spot.html"; };

/* ── Preferences + devices ───────────────────────────────────────────────
   City rows are discovered by scanning localStorage rather than from a list of
   cities, so a board added later shows up here without this page changing. */
const CITY_NAMES = { "": "Washington DC", phl:"Philadelphia", nyc:"New York", boston:"Boston",
  sf:"San Francisco", la:"Los Angeles", ams:"Amsterdam", nj:"New Jersey",
  zurich:"Zurich", cologne:"Cologne", stuttgart:"Stuttgart", rome:"Rome", chicago:"Chicago", mycity:"Stencil" };
function paintPrefs(){
  const themeNames = {dark:"Night",day:"Day",black:"OLED black"};
  $("#prefTheme").textContent = themeNames[get(LS.theme)] || "Night (default)";
  const a = get(LS.accent);
  $("#prefAccent").innerHTML = a
    ? `<span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${esc(a)};
        vertical-align:-1px;margin-right:7px"></span><span class="mono">${esc(a)}</span>` : "Default";
  $("#prefRows").textContent = get(LS.rows) || "Normal";

  const found = {};
  try { for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) || "";
    const m = k.match(/^transitboard([a-z]*)\.(loc|hiddenCards)$/);
    if (m) (found[m[1]] = found[m[1]] || {})[m[2]] = localStorage.getItem(k);
  } } catch(e){}
  const ids = Object.keys(found).sort();
  const body = $("#cityRows");
  // Not an early return: after "Clear saved settings" the old cities stayed listed.
  if (!ids.length) { body.innerHTML = '<tr><td colspan="3" style="color:var(--muted)">None yet.</td></tr>'; return; }
  body.innerHTML = "";
  ids.forEach(id => {
    let where = "—", hidden = "None";
    try { const l = JSON.parse(found[id].loc || "null"); if (l && l.label) where = l.label; } catch(e){}
    try { const h = JSON.parse(found[id].hiddenCards || "[]");
          if (h.length) hidden = h.length + " hidden"; } catch(e){}
    const tr = document.createElement("tr");
    // `where` can be an address someone typed.
    tr.innerHTML = `<td>${esc(CITY_NAMES[id] || id || "Washington DC")}</td><td>${esc(where)}</td><td>${esc(hidden)}</td>`;
    body.appendChild(tr);
  });
}
function paintDevice(){
  /* license.js mints this on its first check, so it genuinely does not exist
     until a key is in play. Viewing this page shouldn't be what creates it —
     say why it's blank instead of quietly writing one. */
  const d = get(LS.dev);
  $("#devId").textContent = d || "Assigned when you first use a licence key";
  $("#devId").classList.toggle("mono", !!d);
  const ua = navigator.userAgent;
  const name = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox" : "This browser";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android"
    : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : "";
  $("#devUA").textContent = os ? `${name} on ${os}` : name;
  try { $("#devTz").textContent = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch(e){}
}

/* Destructive, so it asks first and names exactly what goes. Scoped to this
   browser's own keys — the account and the licence record on the server are
   untouched, which is what the note under the button promises. */
$("#forgetBtn").onclick = () => {
  const keys = [];
  /* Left alone: what config.js owns, because it writes it straight back on the next
     load and until then this page reports accounts as "not set up"; and the device
     id, because a new id on the next licence check takes another of the five slots. */
  let owned = {};
  try { owned = JSON.parse(localStorage.getItem("tb.configWrote") || "{}") || {}; } catch(e){}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) || "";
    if (k === "tb.configWrote" || k === LS.dev || owned[k]) continue;
    if (/^(tb\.|transitboard|nightmode\.|flipboard\.)/.test(k)) keys.push(k);
  }
  if (!keys.length) return say("#devMsg", "Nothing saved on this device.", "good");
  if (!confirm(`Clear ${keys.length} saved settings from this browser?\n\n`
    + "This removes your themes, saved locations, licence key and local sightings from THIS device, "
    + "and signs this device out. Your account and licence are not affected.")) return;
  keys.forEach(k => { try { localStorage.removeItem(k); } catch(e){} });
  say("#devMsg", `Cleared ${keys.length} settings. Reload to start fresh.`, "good");
  paintKey(); paintSpots(); paintPrefs(); paintDevice(); resetSignIn(); paintAccount();
};

/* license.js verifies on its own schedule; give it a moment to settle before
   reading TBLicense.licensed, or a cold load paints "Evaluation" then flips. */
paintSpots(); paintPrefs(); paintDevice(); paintLicence();
setTimeout(paintLicence, 1200);

/* If this load is the browser coming back from Google or Apple, finish the
   sign-in before the first paint, so the page never shows a signed-out panel to
   somebody who has just signed in. */
(async function startAccount(){
  const back = window.TBAccount ? await TBAccount.completeReturn() : null;
  await paintAccount();
  if (back) {
    if (back.ok) { paintSpots(); say("#acctMsg2", "Signed in as " + (back.email || "your account") + ".", "good"); }
    else say("#acctMsg", back.error, "bad");
  }
})();
