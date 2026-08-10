/* ============================================================================
   faa-worker.js — free US flight-delay status (Cloudflare Worker)

   WHY THIS EXISTS
   ADS-B tells you where an aircraft is, never whether it is late: there is no
   schedule anywhere in that data. Real per-flight on-time/late/diverted needs a
   paid flight-status API (FlightAware AeroAPI and friends). But the FAA
   publishes the national airspace picture for free, with no account and no key
   — ground delay programs, ground stops, airport closures and weather delays,
   updated continuously. That is airport-level rather than per-flight, and it
   answers the question that actually matters most of the time: "is anything
   wrong at the airport this flight is going to?"

   The only reason this Worker exists is CORS: nasstatus.faa.gov serves the feed
   to anyone but sends no access-control header, so a browser cannot read it.
   This re-serves it with CORS and turns the XML into JSON.

   THE EASIEST WORKER IN THIS PROJECT TO DEPLOY — no API key, no secrets, no KV
   binding, nothing to register for:
     1. Workers & Pages -> Create -> "Hello World" -> name it "faa" -> Deploy
     2. Open it -> Edit Code -> paste THIS file -> Deploy
     3. Put the URL in a board: settings -> flight delay status
   Nothing else. If it is not configured the boards simply show no delay info.

   ROUTES
     GET /health          -> { ok:true }
     GET /delays          -> { ok:true, updated, airports:{ EWR:[{type,reason,...}] } }
     GET /delays?apt=EWR  -> just that airport's entries
   ============================================================================ */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};
const json = (o, s = 200, extra) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { "content-type": "application/json", ...CORS, ...(extra || {}) },
  });

const FAA = "https://nasstatus.faa.gov/api/airport-status-information";

// The feed is small XML and Workers have no DOM parser, so pull the handful of
// fields that matter with regex rather than pulling in a parser.
const tag = (s, t) => {
  const m = new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">").exec(s);
  return m ? m[1].trim() : "";
};
const tagAll = (s, t) => {
  const out = [], re = new RegExp("<" + t + ">([\\s\\S]*?)</" + t + ">", "g");
  let m; while ((m = re.exec(s))) out.push(m[1]);
  return out;
};
const unesc = s => String(s || "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/\s+/g, " ").trim();

/* The feed nests differently per delay type, and one of them is a trap:
   "Airport Closures" is mostly routine NOTAM text like "AP CLSD TO NON SKED
   TRANSIENT GA ACFT" — the airport restricting unscheduled general aviation,
   which has nothing to do with airline flights. Reporting that as "LAX closed"
   would be badly wrong, so those are filtered out and only genuine full
   closures are kept. */
const GA_NOISE = /CLSD\s+TO\s+(NON\s*SKED|UNSKED|TRANSIENT|GA\b)|NON\s*SKED\s+TRANSIENT|PPR\b/i;

function parse(xml) {
  const airports = {};
  const add = (code, entry) => {
    const c = String(code || "").toUpperCase().trim();
    if (!/^[A-Z]{3,4}$/.test(c)) return;
    (airports[c] = airports[c] || []).push(entry);
  };

  // 1. Ground delay programs: aircraft held at their origin for this airport
  for (const g of tagAll(xml, "Ground_Delay")) {
    const avg = unesc(tag(g, "Avg")), max = unesc(tag(g, "Max"));
    const reason = unesc(tag(g, "Reason"));
    add(tag(g, "ARPT"), {
      kind: "ground_delay", severity: "major",
      label: "Ground delay", reason, avg: avg || null, max: max || null,
      text: `Ground delay${avg ? " averaging " + avg : ""}${reason ? " — " + reason : ""}`,
    });
  }

  // 2. Ground stops: nothing departs for this airport at all
  for (const g of tagAll(xml, "Ground_Stop")) {
    add(tag(g, "ARPT"), {
      kind: "ground_stop", severity: "major", label: "Ground stop",
      reason: unesc(tag(g, "Reason")), until: unesc(tag(g, "End_Time")) || null,
      text: `Ground stop${unesc(tag(g, "Reason")) ? " — " + unesc(tag(g, "Reason")) : ""}`,
    });
  }

  // 3. General arrival/departure delays, with direction and trend
  for (const d of tagAll(xml, "Delay")) {
    const code = tag(d, "ARPT");
    if (!code) continue;
    const reason = unesc(tag(d, "Reason"));
    for (const m of d.matchAll(/<Arrival_Departure Type="(\w+)">([\s\S]*?)<\/Arrival_Departure>/g)) {
      const dir = m[1], seg = m[2];
      const min = unesc(tag(seg, "Min")), max = unesc(tag(seg, "Max")), trend = unesc(tag(seg, "Trend"));
      add(code, {
        kind: "delay", severity: "delay", label: `${dir} delays`,
        reason, min: min || null, max: max || null, trend: trend || null,
        text: `${dir} delays ${[min, max].filter(Boolean).join("–")}${reason ? " — " + reason : ""}` +
              (trend ? ` (${trend.toLowerCase()})` : ""),
      });
    }
  }

  // 4. Genuine closures only
  for (const list of tagAll(xml, "Airport_Closure_List")) {
    for (const ap of tagAll(list, "Airport")) {
      const reason = unesc(tag(ap, "Reason"));
      if (GA_NOISE.test(reason)) continue;                 // routine GA restriction, not a closure
      add(tag(ap, "ARPT"), {
        kind: "closure", severity: "major", label: "Airport closed",
        reason: reason.slice(0, 160), reopen: unesc(tag(ap, "Reopen")) || null,
        text: "Airport closed" + (unesc(tag(ap, "Reopen")) ? " — reopens " + unesc(tag(ap, "Reopen")) : ""),
      });
    }
  }
  return airports;
}

export default {
  async fetch(req) {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === "/health") return json({ ok: true });

    if (url.pathname === "/delays") {
      let xml;
      try {
        const r = await fetch(FAA, { headers: { accept: "application/xml" },
                                     cf: { cacheTtl: 120, cacheEverything: true } });
        if (!r.ok) return json({ ok: false, error: "upstream_" + r.status }, 502);
        xml = await r.text();
      } catch (_) { return json({ ok: false, error: "upstream_unreachable" }, 502); }

      const airports = parse(xml);
      const one = (url.searchParams.get("apt") || "").toUpperCase().trim();
      const body = {
        ok: true,
        updated: unesc(tag(xml, "Update_Time")),
        airports: one ? { [one]: airports[one] || [] } : airports,
      };
      // the FAA refreshes on the order of minutes; let the edge hold it briefly
      return json(body, 200, { "cache-control": "public, max-age=120" });
    }

    return json({ ok: false, error: "not_found" }, 404);
  },
};
