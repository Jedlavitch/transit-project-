/**
 * Flight delay notes — a Cloudflare Worker that asks Claude for one sentence.
 *
 * WHAT IT ANSWERS
 *   "Why might this plane be late?" ADS-B says where an aircraft is, never its
 *   schedule, so no board here can know a flight is late. What CAN be known:
 *     - the FAA's own status for the destination (ground stop, ground delay
 *       program, arrival delays, closure) — the deploy publishes it as
 *       faa-delays.json every 15 minutes
 *     - the weather at the destination now (METAR) and around the time the plane
 *       gets there (TAF) — aviationweather.gov, free, no key, but no CORS header,
 *       which is one reason this is a Worker
 *     - what the plane itself is doing — the board says whether it is holding
 *   When at least one of those says something, Claude turns them into one plain
 *   sentence ("Circling near Baltimore: gusts to 40 kt at DCA have the FAA
 *   spacing arrivals"). When none do, there is no note and no Claude call.
 *
 * THE OTHER REASON IT IS A WORKER: THE KEY
 *   An Anthropic API key in a public page is a key anyone can spend. It lives
 *   here as a secret. And the page sends only airport codes and numbers — the
 *   FAA text and the weather are fetched HERE, from their sources — so nothing a
 *   browser types ever reaches the prompt.
 *
 * SETUP (one time, ~5 minutes):
 *   1. An API key: https://platform.claude.com -> API keys. While you are there,
 *      set a monthly SPEND LIMIT (Settings -> Limits). That, not this file, is
 *      the hard ceiling on what this can cost.
 *   2. Cloudflare dashboard -> Workers & Pages -> Create -> "Hello World" ->
 *      name it "flightnotes" -> Deploy -> Edit code -> paste THIS file -> Deploy.
 *   3. Settings -> Variables and Secrets -> add a SECRET named ANTHROPIC_API_KEY.
 *   4. Open https://flightnotes.<you>.workers.dev/health — it should say
 *      {"ok":true,"key":true}.
 *   5. Put that URL in config.js as `flightNotesUrl` (every screen), or for one
 *      screen only, localStorage `tb.flightNotesUrl`.
 *   Optional plain variables: MODEL (default claude-opus-5-5),
 *   ALLOWED_ORIGINS (comma list; default the site + localhost),
 *   FAA_URL (default the site's faa-delays.json), MAX_CALLS_PER_HOUR (default 60).
 *
 * COST
 *   Only flights with a delay signal cost anything, and each flight's note is
 *   cached for 10 minutes and shared by every screen. All flights needing a note
 *   in one board refresh go in ONE Claude request. A request is roughly a
 *   thousand tokens in and a hundred out: about half a cent on Claude Opus 5.5.
 *
 * ROUTES
 *   POST /notes   body (text/plain, JSON — text/plain avoids a CORS preflight):
 *     { flights: [{ id:"UAL123", to:"DCA", from:"ORD", alt:12000, gs:310,
 *                   vs:-1200, holding:true, holdMin:9, etaMin:24 }] }   (max 12)
 *     -> { at, notes: { UAL123: { text, level: "info"|"delay"|"major", why:[…], by:"claude"|"rules" } } }
 *        A flight with nothing to say is simply absent.
 *   GET /health
 */

const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_ORIGINS = ["https://transitproject.online", "https://www.transitproject.online"];
const DEFAULT_FAA = "https://transitproject.online/faa-delays.json";
const NOTE_TTL = 600;          // seconds a note is reused, across every screen
const WX_TTL = 600;            // METAR/TAF
const FAA_TTL = 120;

const cors = origin => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
});
const json = (o, status, origin) => new Response(JSON.stringify(o), {
  status: status || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(origin) },
});

function originAllowed(origin, env) {
  if (!origin) return false;
  const list = env.ALLOWED_ORIGINS ? String(env.ALLOWED_ORIGINS).split(",").map(s => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
  if (list.includes("*") || list.includes(origin)) return true;
  // Local testing of the boards.
  return /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) || /^https?:\/\/[a-z0-9-]+\.localhost(:\d+)?$/.test(origin);
}

/* ---- inputs: codes and numbers only ---------------------------------------- */
const code = s => (/^[A-Z0-9]{3,4}$/.test(String(s || "").toUpperCase()) ? String(s).toUpperCase() : "");
const num = (v, lo, hi) => (typeof v === "number" && isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : null);
function cleanFlight(f) {
  if (!f || typeof f !== "object") return null;
  const id = String(f.id || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  const to = code(f.to);
  if (!id || !to) return null;
  return {
    id, to, from: code(f.from),
    alt: num(f.alt, -1000, 60000), gs: num(f.gs, 0, 800), vs: num(f.vs, -9000, 9000),
    holding: f.holding === true, holdMin: num(f.holdMin, 0, 240), etaMin: num(f.etaMin, 0, 900),
  };
}
/* METAR/TAF want ICAO. A three-letter code on these boards is IATA; for the
   contiguous US that is "K" + code. Elsewhere there is no rule, so no weather. */
const icaoOf = c => (c.length === 4 ? c : /^[A-Z]{3}$/.test(c) && !/^(ANC|FAI|JNU|HNL|OGG|KOA|LIH|SJU)$/.test(c) ? "K" + c : "");

/* ---- cached upstream fetches ------------------------------------------------ */
async function cachedJSON(url, ttl, ctx) {
  const cache = caches.default, key = new Request(url);
  let res = await cache.match(key);
  if (!res) {
    const up = await fetch(url, { headers: { "User-Agent": "transit-board-flight-notes" }, cf: { cacheTtl: ttl } });
    if (!up.ok) throw new Error(url + " " + up.status);
    const body = await up.text();
    res = new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + ttl } });
    ctx.waitUntil(cache.put(key, res.clone()));
  }
  return res.json();
}
async function faaFor(env, ctx) {
  try { const d = await cachedJSON(env.FAA_URL || DEFAULT_FAA, FAA_TTL, ctx); return (d && d.airports) || {}; } catch (_) { return {}; }
}
async function weatherFor(icaos, ctx) {
  const out = {};
  if (!icaos.length) return out;
  const ids = icaos.slice().sort().join(",");
  const [m, t] = await Promise.all([
    cachedJSON("https://aviationweather.gov/api/data/metar?format=json&ids=" + ids, WX_TTL, ctx).catch(() => []),
    cachedJSON("https://aviationweather.gov/api/data/taf?format=json&ids=" + ids, WX_TTL, ctx).catch(() => []),
  ]);
  (Array.isArray(m) ? m : []).forEach(x => { if (x && x.icaoId) (out[x.icaoId] = out[x.icaoId] || {}).metar = x; });
  (Array.isArray(t) ? t : []).forEach(x => { if (x && x.icaoId) (out[x.icaoId] = out[x.icaoId] || {}).taf = x; });
  return out;
}

/* ---- what the weather means for an arrival ---------------------------------
   Deliberately conservative: only things that actually slow arrivals. */
function hazards(text) {
  const s = " " + String(text || "") + " ", h = [];
  if (/\s[+-]?(VC)?TS/.test(s)) h.push("thunderstorms");
  if (/\s[+-]?(SH|BL|DR)?SN|\sFZ(RA|DZ|FG)|\sPL\s/.test(s)) h.push(/FZ(RA|DZ)/.test(s) ? "freezing rain" : "snow or ice");
  if (/\s\+RA/.test(s)) h.push("heavy rain");
  if (/\sWS\d{3}\//.test(s)) h.push("low-level wind shear");
  const g = /\s\d{3}\d{2,3}G(\d{2,3})KT/.exec(s) || /\sVRB\d{2}G(\d{2,3})KT/.exec(s);
  if (g && +g[1] >= 30) h.push("gusts to " + +g[1] + " kt");
  const w = /\s\d{3}(\d{2,3})(G\d{2,3})?KT/.exec(s);
  if (w && +w[1] >= 25 && !(g && +g[1] >= 30)) h.push("wind " + +w[1] + " kt");
  const vis = /\s(M?\d\/\d|[0-2])SM\s/.exec(s) || /\s\d\s\d\/\dSM\s/.exec(s);
  if (vis) h.push("visibility under 3 miles");
  if (/\s(BKN|OVC|VV)00[0-5]/.test(s)) h.push("very low cloud");
  return h;
}
/* The TAF group in force when the plane gets there (FMddhhmm groups, plus any
   TEMPO/PROB group that follows it), not the whole 30-hour forecast. */
function tafAt(raw, whenMs) {
  if (!raw) return "";
  const parts = String(raw).split(/\s(?=FM\d{6}|TEMPO|BECMG|PROB\d{2})/);
  const at = new Date(whenMs), pick = [];
  let current = parts[0];
  for (let i = 1; i < parts.length; i++) {
    const fm = /^FM(\d{2})(\d{2})(\d{2})/.exec(parts[i]);
    if (fm) {
      const t = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), +fm[1], +fm[2], +fm[3]);
      if (t <= whenMs + 30 * 60000) current = parts[i]; else break;
    }
  }
  pick.push(current);
  const after = parts.indexOf(current);
  for (let j = after + 1; j < parts.length && !/^FM/.test(parts[j]); j++) pick.push(parts[j]);
  return pick.join(" ");
}

function signalsFor(f, faa, wx) {
  const s = { faa: [], wxNow: [], wxAtArrival: [], cat: "", holding: f.holding };
  /* Departure-only delays at the destination say nothing about a plane landing there. */
  (faa[f.to] || []).filter(e => !(e.kind === "delay" && /^Departure/i.test(e.text || "")))
    .forEach(e => s.faa.push({ kind: e.kind, text: String(e.text || "").slice(0, 160) }));
  const w = wx[icaoOf(f.to)];
  if (w && w.metar) {
    s.cat = w.metar.fltCat || "";
    s.wxNow = hazards(w.metar.rawOb);
    if (/^L?IFR$/.test(s.cat)) s.wxNow.push(s.cat === "LIFR" ? "low instrument conditions" : "instrument conditions");
    s.airportName = String(w.metar.name || "").split(",")[0].slice(0, 60);
  }
  if (w && w.taf) {
    const eta = Date.now() + ((f.etaMin != null ? f.etaMin : 60) * 60000);
    s.wxAtArrival = hazards(tafAt(w.taf.rawTAF, eta)).filter(x => s.wxNow.indexOf(x) < 0);
  }
  s.any = s.faa.length > 0 || s.wxNow.length > 0 || s.wxAtArrival.length > 0 || s.holding;
  return s;
}
function levelOf(s) {
  if (s.faa.some(e => /ground_stop|closure|ground_delay/.test(e.kind))) return "major";
  if (s.faa.length || s.holding || s.wxNow.length || s.wxAtArrival.length) return "delay";
  return "info";
}
function whyOf(s) {
  const w = [];
  s.faa.forEach(e => w.push("FAA " + e.kind.replace("_", " ")));
  if (s.holding) w.push("holding");
  s.wxNow.concat(s.wxAtArrival).forEach(x => w.push(x));
  return w.slice(0, 5);
}
/* Used when there is no key or Claude does not answer: a plain sentence from
   the same facts, so the board never goes quiet about a real ground stop. */
function ruleNote(f, s) {
  const where = f.to;
  const faa = s.faa[0];
  if (faa && /ground_stop/.test(faa.kind)) return "FAA ground stop at " + where + " — expect a long delay.";
  if (faa && /closure/.test(faa.kind)) return where + " is closed to arrivals — this flight may divert.";
  if (faa && /ground_delay/.test(faa.kind)) return "FAA ground delay program at " + where + " — arrivals are being held back.";
  const wx = s.wxNow[0] || s.wxAtArrival[0];
  if (s.holding) return "Holding" + (wx ? " — " + wx + " at " + where : faa ? " — arrival delays at " + where : "") + ".";
  if (faa) return "Arrival delays at " + where + " — expect a slower approach.";
  if (wx) return (s.wxNow.length ? "" : "Expected on arrival: ") + wx + " at " + where + " may slow the landing.";
  return "";
}

/* ---- Claude ------------------------------------------------------------------ */
const SYSTEM = [
  "You write the one-line delay note shown under a flight on a live transit display in someone's home or a station.",
  "People glance at it from across the room, so it must be short and plain.",
  "",
  "Rules:",
  "- One sentence, at most 18 words. No preamble, no emoji, no quotation marks.",
  "- Use only the facts given. Never invent times, minutes, gates, flight status or causes. You may repeat a delay length the FAA text states.",
  "- The data shows where the plane is, not its schedule. Never say the flight IS late or on time; say what is likely (expect, may, likely).",
  "- Name the cause plainly: wind, gusts, low cloud, thunderstorms, snow, ice, FAA ground stop, arrival delays.",
  "- Refer to the destination by its city or short airport name if given, else its code.",
  "- If the plane is holding, lead with that (circling or holding) and connect it to the cause if the facts support it.",
  "- level: major for ground stops, closures or ground delay programs; delay for FAA delays, holding or weather likely to slow arrivals; info for weather worth knowing that probably will not delay it.",
].join("\n");

const SCHEMA = {
  type: "object",
  properties: {
    notes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          note: { type: "string" },
          level: { type: "string", enum: ["info", "delay", "major"] },
        },
        required: ["id", "note", "level"],
        additionalProperties: false,
      },
    },
  },
  required: ["notes"],
  additionalProperties: false,
};

let hourStart = 0, callsThisHour = 0;          // per isolate: a brake, not a budget
function underCap(env) {
  const cap = +env.MAX_CALLS_PER_HOUR || 60, now = Date.now();
  if (now - hourStart > 3600000) { hourStart = now; callsThisHour = 0; }
  if (callsThisHour >= cap) return false;
  callsThisHour++;
  return true;
}

async function askClaude(env, items) {
  const facts = items.map(({ f, s }) => ({
    id: f.id,
    destination: { code: f.to, name: s.airportName || "" },
    origin: f.from || "",
    plane: { altitude_ft: f.alt, ground_speed_kt: f.gs, vertical_rate_fpm: f.vs,
             holding: f.holding, holding_minutes: f.holdMin, minutes_to_destination_estimate: f.etaMin },
    faa_status_at_destination: s.faa,
    destination_weather_now: s.wxNow,
    destination_flight_category: s.cat,
    destination_weather_forecast_at_arrival: s.wxAtArrival,
  }));
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2026-10-21",
      // A safety decline is retried on a fallback model inside the same call.
      "anthropic-beta": "server-side-fallback-2026-07-01",
    },
    body: JSON.stringify({
      model: env.MODEL || DEFAULT_MODEL,
      max_tokens: 4000,
      system: SYSTEM,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      fallbacks: "default",
      messages: [{ role: "user", content: "Write a note for each flight.\n\n" + JSON.stringify(facts) }],
    }),
  });
  if (!res.ok) throw new Error("anthropic " + res.status + " " + (await res.text()).slice(0, 200));
  const msg = await res.json();
  if (msg.stop_reason === "refusal" || msg.stop_reason === "max_tokens") throw new Error("anthropic stop " + msg.stop_reason);
  const block = (msg.content || []).find(b => b.type === "text");
  const out = {};
  (JSON.parse(block ? block.text : "{}").notes || []).forEach(n => {
    if (n && n.id && n.note) out[String(n.id).toUpperCase()] = { text: String(n.note).slice(0, 160), level: n.level };
  });
  return out;
}

/* ---- per-flight note cache, shared by every screen ---------------------------- */
const noteKey = (f, s) => new Request("https://flight-notes.cache/" + encodeURIComponent([
  f.id, f.to, s.faa.map(e => e.kind).sort().join("+"), s.cat, s.wxNow.join("+"), s.wxAtArrival.join("+"), s.holding ? "H" : "",
].join("|")));

async function notes(req, env, ctx) {
  let body;
  try { body = JSON.parse(await req.text()); } catch (_) { return { error: "bad json", status: 400 }; }
  const flights = (Array.isArray(body && body.flights) ? body.flights : []).map(cleanFlight).filter(Boolean).slice(0, 12);
  if (!flights.length) return { at: Date.now(), notes: {} };

  const icaos = [...new Set(flights.map(f => icaoOf(f.to)).filter(Boolean))].slice(0, 12);
  const [faa, wx] = await Promise.all([faaFor(env, ctx), weatherFor(icaos, ctx).catch(() => ({}))]);
  const cache = caches.default, out = {}, ask = [];

  for (const f of flights) {
    const s = signalsFor(f, faa, wx);
    if (!s.any) continue;
    const key = noteKey(f, s), hit = await cache.match(key);
    if (hit) { out[f.id] = await hit.json(); continue; }
    ask.push({ f, s, key });
  }
  if (ask.length) {
    let written = {};
    if (env.ANTHROPIC_API_KEY && underCap(env)) {
      try { written = await askClaude(env, ask); } catch (e) { console.log(String(e)); }
    }
    for (const { f, s, key } of ask) {
      const c = written[f.id];
      const note = c ? { text: c.text, level: c.level || levelOf(s), why: whyOf(s), by: "claude" }
                     : { text: ruleNote(f, s), level: levelOf(s), why: whyOf(s), by: "rules" };
      if (!note.text) continue;
      out[f.id] = note;
      /* A rule-written stand-in is cached briefly, so Claude gets another go soon. */
      const ttl = note.by === "claude" ? NOTE_TTL : 90;
      ctx.waitUntil(cache.put(key, new Response(JSON.stringify(note), { headers: { "Content-Type": "application/json", "Cache-Control": "max-age=" + ttl } })));
    }
  }
  return { at: Date.now(), notes: out };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url), origin = req.headers.get("Origin") || "";
    const allowed = originAllowed(origin, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(allowed ? origin : "") });
    if (url.pathname === "/health") return json({ ok: true, key: !!env.ANTHROPIC_API_KEY, model: env.MODEL || DEFAULT_MODEL }, 200, allowed ? origin : "*");
    if (url.pathname !== "/notes" || req.method !== "POST") return json({ error: "POST /notes or GET /health" }, 404, allowed ? origin : "*");
    /* Spending is reserved for the site's own pages. A script can forge Origin,
       which is why the Console spend limit is the real ceiling. */
    if (!allowed) return json({ error: "origin not allowed" }, 403, "");
    try {
      const r = await notes(req, env, ctx);
      return json(r, r.status || 200, origin);
    } catch (e) {
      return json({ error: String(e && e.message || e).slice(0, 200) }, 500, origin);
    }
  },
};
