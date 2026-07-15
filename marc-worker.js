/**
 * MARC "helper" — a Cloudflare Worker.
 *
 * A browser on GitHub Pages cannot fetch MARC's live feed directly (it's protobuf
 * on S3 with no CORS headers). This tiny Worker fetches that feed server-side,
 * decodes the GTFS-Realtime protobuf into plain JSON, and re-serves it WITH CORS
 * so the transit board can read it. Free tier, always on, never expires.
 *
 * Deploy: https://workers.cloudflare.com  ->  paste this whole file  ->  Deploy.
 * Then copy your Worker URL (e.g. https://marc.<you>.workers.dev) into the board's
 * settings (gear icon -> "MARC helper URL").
 *
 * No API key required. No dependencies.
 */

const MARC_VP = "https://mdotmta-gtfs-rt.s3.amazonaws.com/MARC+RT/marc-vp.pb";
const LINES = { "11704": "Brunswick", "11705": "Penn", "11706": "Camden" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    try {
      const res = await fetch(MARC_VP, { cf: { cacheTtl: 15, cacheEverything: true } });
      if (!res.ok) throw new Error("upstream " + res.status);
      const buf = new Uint8Array(await res.arrayBuffer());
      const vehicles = decodeMarc(buf);
      return json({ ok: true, ts: Date.now(), count: vehicles.length, vehicles });
    } catch (e) {
      return json({ ok: false, error: String(e), vehicles: [] }, 502);
    }
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS },
  });
}

/* ---- minimal GTFS-Realtime protobuf decoder (only the fields we need) ---- */
function* readFields(b, start, end) {
  let i = start;
  while (i < end) {
    let [key, ni] = varint(b, i); i = ni;
    const field = key >>> 3, wt = key & 7;
    if (wt === 0) { const [v, n] = varint(b, i); i = n; yield [field, 0, v]; }
    else if (wt === 2) { const [len, n] = varint(b, i); i = n; yield [field, 2, [n, n + len]]; i = n + len; }
    else if (wt === 5) { yield [field, 5, i]; i += 4; }
    else if (wt === 1) { i += 8; }
    else throw new Error("bad wiretype " + wt);
  }
}
function varint(b, i) {
  let result = 0, shift = 0, x;
  do { x = b[i++]; result += (x & 0x7f) * Math.pow(2, shift); shift += 7; } while (x & 0x80);
  return [result, i];
}
function f32(b, i) { return new DataView(b.buffer, b.byteOffset + i, 4).getFloat32(0, true); }
function str(b, s, e) { return new TextDecoder().decode(b.subarray(s, e)); }

function decodeMarc(b) {
  const out = [];
  for (const [f, wt, val] of readFields(b, 0, b.length)) {
    if (f !== 2 || wt !== 2) continue;            // FeedMessage.entity
    const [es, ee] = val; const v = {};
    for (const [ef, ewt, eval_] of readFields(b, es, ee)) {
      if (ef === 1 && ewt === 2) v.id = str(b, eval_[0], eval_[1]);
      else if (ef === 4 && ewt === 2) {           // FeedEntity.vehicle (field 4!)
        const [vs, ve] = eval_;
        for (const [vf, vwt, vv] of readFields(b, vs, ve)) {
          if (vf === 1 && vwt === 2) {            // trip
            for (const [tf, twt, tv] of readFields(b, vv[0], vv[1])) {
              if (tf === 1) v.tripId = str(b, tv[0], tv[1]);
              else if (tf === 5) v.routeId = str(b, tv[0], tv[1]);
            }
          } else if (vf === 8 && vwt === 2) {      // vehicle descriptor
            for (const [df, dwt, dv] of readFields(b, vv[0], vv[1])) {
              if (df === 1) v.vehId = str(b, dv[0], dv[1]);
              else if (df === 2) v.label = str(b, dv[0], dv[1]);
            }
          } else if (vf === 2 && vwt === 2) {      // position
            for (const [pf, pwt, pv] of readFields(b, vv[0], vv[1])) {
              if (pf === 1) v.lat = f32(b, pv);
              else if (pf === 2) v.lon = f32(b, pv);
              else if (pf === 3) v.bearing = f32(b, pv);
              else if (pf === 5) v.speed = f32(b, pv);
            }
          }
        }
      }
    }
    if (typeof v.lat === "number" && typeof v.lon === "number") {
      out.push({
        id: v.tripId || v.id,
        train: (v.tripId || "").replace(/^Train/i, "") || v.label || v.vehId || "",
        line: LINES[v.routeId] || "MARC",
        lat: +v.lat.toFixed(5), lon: +v.lon.toFixed(5),
        bearing: v.bearing ?? null,
        mph: v.speed != null ? Math.round(v.speed * 2.236936) : null, // m/s -> mph
      });
    }
  }
  return out;
}

// (harmless in Cloudflare — only `default` is used as the handler; this lets us unit-test the decoder)
export { decodeMarc };
