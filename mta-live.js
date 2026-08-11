/* ============================================================================
   mta-live.js — the live NYC subway feed, for the station displays.

   The decoder, the feed list and the line colours are lifted VERBATIM from
   nyc.html so there is exactly one implementation of the GTFS-Realtime parsing
   in this project. That parser was hard-won — MTA's feed needs BigInt varint
   accumulation, or negative delays (sign-extended 64-bit) silently corrupt —
   and having two copies drift apart is how that bug comes back.

   MTA's feeds are CORS-open and need no key, so this runs in the browser with
   no Worker: verified, and the reason the NYC board works at all.

   STOP IDS: the realtime feed uses "127N"/"127S" — the station id with a
   direction letter. The bundled schedule's station ids have no letter, so the
   two only join once the suffix is stripped. Getting that wrong yields a
   station display with no trains and no error.
   ============================================================================ */
(function () {
  "use strict";

  const SUBWAY_COL = {
    "1":"#EE352E","2":"#EE352E","3":"#EE352E",
    "4":"#00933C","5":"#00933C","6":"#00933C","6X":"#00933C",
    "7":"#B933AD","7X":"#B933AD",
    "A":"#0039A6","C":"#0039A6","E":"#0039A6",
    "B":"#FF6319","D":"#FF6319","F":"#FF6319","FX":"#FF6319","M":"#FF6319",
    "G":"#6CBE45", "J":"#996633","Z":"#996633", "L":"#A7A9AC",
    "N":"#FCCC0A","Q":"#FCCC0A","R":"#FCCC0A","W":"#FCCC0A", "GS":"#808183",
  };
  const SUBWAY_FEEDS = ["gtfs","gtfs-ace","gtfs-bdfm","gtfs-g","gtfs-jz","gtfs-nqrw","gtfs-l"];
  function* gtfsrtFields(b, start, end){
    let i = start;
    while(i < end){
      const [key, ni] = gtfsrtVarint(b, i); i = ni;
      const field = Number(key >> 3n), wt = Number(key & 7n);
      if(wt === 0){ const [v, n] = gtfsrtVarint(b, i); i = n; yield [field, 0, v]; }
      else if(wt === 2){ const [len, n] = gtfsrtVarint(b, i); const l = Number(len); yield [field, 2, [n, n + l]]; i = n + l; }
      else if(wt === 5){ yield [field, 5, i]; i += 4; }
      else if(wt === 1){ i += 8; }
      else throw new Error("bad wiretype "+wt);
    }
  }
  function gtfsrtVarint(b, i){
    let result = 0n, shift = 0n, x;
    do{ x = BigInt(b[i++]); result |= (x & 0x7fn) << shift; shift += 7n; }while(x & 0x80n);
    return [result, i];
  }
  function gtfsrtStr(b, s, e){ return new TextDecoder().decode(b.subarray(s, e)); }
  function gtfsrtInt32(v){ return Number(BigInt.asIntN(32, v)); }
  function gtfsrtInt64(v){ return Number(BigInt.asIntN(64, v)); }
  /* Wiretype 5 carries the offset of the word, not the value. NYCT publishes no
     lat/lon today, so nothing below calls this — but decodeVehiclePosition reads
     the position sub-message unconditionally, and fetchAll swallows decode
     errors per feed. Left out (as it was), the day MTA starts populating
     position is the day all seven feeds go quiet with nothing in the console. */
  function gtfsrtF32(b, i){ return new DataView(b.buffer, b.byteOffset + i, 4).getFloat32(0, true); }

  function decodeVehiclePosition(b, s, e){
    const v = {};
    for(const [vf, vwt, vv] of gtfsrtFields(b, s, e)){
      if(vf === 1 && vwt === 2){                // trip (TripDescriptor)
        for(const [tf, twt, tv] of gtfsrtFields(b, vv[0], vv[1])){
          if(tf === 1) v.tripId = gtfsrtStr(b, tv[0], tv[1]);
          else if(tf === 5) v.routeId = gtfsrtStr(b, tv[0], tv[1]);
        }
      } else if(vf === 2 && vwt === 2){         // position
        for(const [pf, pwt, pv] of gtfsrtFields(b, vv[0], vv[1])){
          if(pf === 1) v.lat = gtfsrtF32(b, pv);
          else if(pf === 2) v.lon = gtfsrtF32(b, pv);
          else if(pf === 3) v.bearing = gtfsrtF32(b, pv);
          else if(pf === 5) v.speed = gtfsrtF32(b, pv);
        }
      } else if(vf === 4 && vwt === 0){         // current_status (0=INCOMING_AT,1=STOPPED_AT,2=IN_TRANSIT_TO)
        v.status = Number(vv);
      } else if(vf === 7 && vwt === 2){         // stop_id (platform-level)
        v.stopId = gtfsrtStr(b, vv[0], vv[1]);
      }
    }
    return v;
  }
  function decodeTripUpdate(b, s, e){
    const u = { stops: [] };
    for(const [tf, twt, tv] of gtfsrtFields(b, s, e)){
      if(tf === 1 && twt === 2){                // trip (TripDescriptor)
        for(const [df, dwt, dv] of gtfsrtFields(b, tv[0], tv[1])){
          if(df === 1) u.tripId = gtfsrtStr(b, dv[0], dv[1]);
          else if(df === 5) u.routeId = gtfsrtStr(b, dv[0], dv[1]);
        }
      } else if(tf === 2 && twt === 2){         // stop_time_update (repeated)
        const stu = {};
        for(const [sf, swt, sv] of gtfsrtFields(b, tv[0], tv[1])){
          if(sf === 4 && swt === 2) stu.stopId = gtfsrtStr(b, sv[0], sv[1]);
          else if(sf === 2 && swt === 2){       // arrival (StopTimeEvent)
            for(const [af, awt, av] of gtfsrtFields(b, sv[0], sv[1])){
              if(af === 1 && awt === 0) stu.delaySec = gtfsrtInt32(av);
              // field 2 = absolute POSIX arrival time. MTA populates this even
              // where delay is absent, and it's what turns a bare "live" tag
              // into a real predicted clock time.
              else if(af === 2 && awt === 0) stu.timeSec = Number(av);
            }
          } else if(sf === 3 && swt === 2){     // departure (fallback for either field)
            for(const [af, awt, av] of gtfsrtFields(b, sv[0], sv[1])){
              if(af === 1 && awt === 0 && stu.delaySec == null) stu.delaySec = gtfsrtInt32(av);
              else if(af === 2 && awt === 0 && stu.timeSec == null) stu.timeSec = Number(av);
            }
          }
        }
        u.stops.push(stu);
      } else if(tf === 5 && twt === 0){         // TripUpdate.delay (trip-level fallback)
        u.tripDelaySec = gtfsrtInt32(tv);
      }
    }
    return u;
  }
  function decodeGtfsRt(buf){
    const vehicles = [], updates = {};
    for(const [f, wt, val] of gtfsrtFields(buf, 0, buf.length)){
      if(f !== 2 || wt !== 2) continue;         // FeedMessage.entity
      const [es, ee] = val;
      for(const [ef, ewt, eval_] of gtfsrtFields(buf, es, ee)){
        if(ef === 4 && ewt === 2){              // FeedEntity.vehicle
          const v = decodeVehiclePosition(buf, eval_[0], eval_[1]);
          if(v.tripId) vehicles.push(v);
        } else if(ef === 3 && ewt === 2){       // FeedEntity.trip_update
          const u = decodeTripUpdate(buf, eval_[0], eval_[1]);
          if(u.tripId) updates[u.tripId] = u;
        }
      }
    }
    return { vehicles, updates };
  }

  const FEED_BASE = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2F";

  /* Every trip currently reported, with its remaining stops. Feeds are fetched
     in parallel and a failed one is skipped rather than failing the lot — the
     seven feeds are independent, and losing the L should not blank the R. */
  async function fetchAll() {
    const results = await Promise.allSettled(
      SUBWAY_FEEDS.map(f => fetch(FEED_BASE + f).then(r => r.arrayBuffer())));
    let updates = {}, vehicles = [], ok = 0;
    results.forEach(r => {
      if (r.status !== "fulfilled") return;
      try {
        const d = decodeGtfsRt(new Uint8Array(r.value));
        Object.assign(updates, d.updates);
        vehicles = vehicles.concat(d.vehicles);
        ok++;
      } catch (_) {}
    });
    return { updates, vehicles, feedsOk: ok, feedsTotal: SUBWAY_FEEDS.length };
  }

  const stationOf = stopId => String(stopId || "").replace(/[NS]$/, "");
  const dirOf = stopId => (String(stopId || "").match(/([NS])$/) || [])[1] || "";

  /* Arrivals at one station, soonest first.
     A trip is only counted if the station is still AHEAD of it: the feed keeps
     stops a train has already passed, so matching on the station alone lists
     trains that have long gone. */
  function arrivalsAt(updates, stationId, opts) {
    const o = opts || {};
    const now = Date.now() / 1000;
    const out = [];
    Object.keys(updates).forEach(tripId => {
      const u = updates[tripId];
      const idx = u.stops.findIndex(s => stationOf(s.stopId) === stationId && s.timeSec);
      if (idx < 0) return;
      const here = u.stops[idx];
      const mins = (here.timeSec - now) / 60;
      if (mins < -0.5 || mins > (o.horizonMin || 40)) return;
      const rest = u.stops.slice(idx);                     // this stop onward
      const last = u.stops[u.stops.length - 1];
      out.push({
        tripId, routeId: u.routeId || "",
        dir: dirOf(here.stopId),
        minutes: Math.max(0, Math.round(mins)),
        atSec: here.timeSec,
        /* Stop-level delay first, then the trip-level one. decodeTripUpdate has
           always captured TripUpdate.delay and this dropped it on the floor —
           per the GTFS-RT spec that field applies to every stop that carries no
           delay of its own. NYCT populates neither widely (measured: delays on
           ~2% of trips, trip-level on none), so this changes nothing visible
           today; it stops the fallback being decoded and then discarded. */
        delaySec: here.delaySec != null ? here.delaySec
                : u.tripDelaySec != null ? u.tripDelaySec : null,
        destStation: last ? stationOf(last.stopId) : "",
        remaining: rest.map(s => ({ station: stationOf(s.stopId), timeSec: s.timeSec })),
      });
    });
    return out.sort((a, b) => a.atSec - b.atSec);
  }

  window.TBMta = { fetchAll, arrivalsAt, stationOf, dirOf, SUBWAY_COL, SUBWAY_FEEDS };
})();
