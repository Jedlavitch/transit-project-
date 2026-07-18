#!/usr/bin/env python3
"""
Regenerate mta-bus-schedule.json from the MTA's Manhattan bus GTFS, filtered
to a handful of core Midtown crosstown/spine routes.

MTA Bus's live GTFS-Realtime feed (gtfsrt.prod.obanyc.com) has real data but
NO CORS headers, unlike subway/LIRR/Metro-North -- so unlike those three,
this needs the optional mta-bus-worker.js Cloudflare Worker for exact live
positions. Same "zero-setup default, optional live upgrade" pattern as
Ride On/SEPTA Bus: this bundle gives a working departures card + scheduled
map positions (interpolated between stops) with no setup at all; pasting a
deployed Worker URL into Settings upgrades to exact live positions.

Routes chosen the same way gen-septa-bus-schedule.py picked 3/4/16 near
Temple -- corridors that run ALONG the area of interest, not just cross it,
forming a small grid rather than parallel duplicates:
  M42        42nd St Crosstown -- Port Authority, Times Sq, Grand Central, Bryant Park
  M34/M34A+  34th St Crosstown (Select Bus Service, no local variant exists
             on this corridor) -- Penn Station, Herald Sq, Empire State Bldg, Hudson Yards/Javits
  M15(+)     1st/2nd Ave -- NYC's busiest bus route, East Side north-south
             spine, both local (M15) and Select Bus Service (M15+) variants
             kept since they serve the same corridor with different stop
             spacing/frequency
Confirmed against the live feed directly (not guessed): M42, M15, M15+,
M34+, M34A+ are the exact route_ids MTA Bus Time reports; plain "M34"/"M34A"
don't exist as separate route_ids (SBS-only corridor).

Re-run whenever MTA changes its bus schedule: python3 gen-mta-bus-schedule.py
"""
import csv, io, json, os, urllib.request, zipfile, datetime

GTFS_URL = "http://web.mta.info/developers/data/nyct/bus/google_transit_manhattan.zip"
OUT = os.path.join(os.path.dirname(__file__), "mta-bus-schedule.json")
ROUTES = {"M42", "M15", "M15+", "M34+", "M34A+"}

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def to_min(t):
    p = t.split(":"); return int(p[0]) * 60 + int(p[1])

def main():
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(GTFS_URL, timeout=60).read()))
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt") if r["route_id"] in ROUTES}
    trips  = {t["trip_id"]: t for t in rows(zf, "trips.txt") if t["route_id"] in ROUTES}

    seq = {}  # trip_id -> {line, hs, s, seq:[(stop_seq, stop_id, dep_min)]}
    used_stops = set()
    with zf.open("stop_times.txt") as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            tid = row["trip_id"]
            tr = trips.get(tid)
            if not tr:
                continue
            dt = (row.get("departure_time") or "").strip()
            if not dt:
                continue
            d = seq.setdefault(tid, {"line": tr["route_id"], "hs": (tr.get("trip_headsign") or "").strip(),
                                     "s": tr["service_id"], "seq": []})
            d["seq"].append((int(row["stop_sequence"]), row["stop_id"], to_min(dt)))

    trips_out = []
    for d in seq.values():
        d["seq"].sort()
        if len(d["seq"]) < 2:
            continue
        for _, sid, _ in d["seq"]:
            used_stops.add(sid)
        trips_out.append({"line": d["line"], "hs": d["hs"], "s": d["s"],
                          "st": [[x[1], x[2]] for x in d["seq"]]})

    stations = []
    for s in rows(zf, "stops.txt"):
        if s["stop_id"] not in used_stops:
            continue
        try:
            stations.append({"id": s["stop_id"], "name": s["stop_name"],
                             "lat": round(float(s["stop_lat"]), 5), "lon": round(float(s["stop_lon"]), 5)})
        except (ValueError, KeyError):
            pass

    svc = {c["service_id"]: {"dow": [int(c[k]) for k in ("monday","tuesday","wednesday","thursday","friday","saturday","sunday")],
                             "start": c["start_date"], "end": c["end_date"]} for c in rows(zf, "calendar.txt")}
    exc = {}
    for c in rows(zf, "calendar_dates.txt"):
        e = exc.setdefault(c["date"], {"add": [], "rem": []})
        (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])

    out = {"generated": datetime.date.today().isoformat(), "note": f"MTA Bus GTFS ({GTFS_URL}), routes {sorted(ROUTES)}",
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
