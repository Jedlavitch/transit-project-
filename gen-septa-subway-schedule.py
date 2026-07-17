#!/usr/bin/env python3
"""
Regenerate septa-subway-schedule.json from SEPTA's published GTFS, filtered to
the core subway lines in ROUTES below.

Same technique as MARC/Ride On/SEPTA Regional Rail: SEPTA's live APIs have no
CORS, so this bundles the schedule and interpolates each running trip's
position between stops for the map, plus shows genuinely accurate next-arrival
times for the card.

SEPTA's subway, trolleys, and buses are all in one GTFS file (google_bus.zip,
~20MB) distinguished by route_type (0=trolley, 1=subway/metro, 3=bus). The
full trolley+subway set is still ~3MB (they run very frequently), so this
defaults to just the two core rapid-transit lines that are useful regardless
of exactly where in Philadelphia you live:
  - L1  Market-Frankford Line ("the El")
  - B1/B2/B3  Broad Street Line (Local / Express / Ridge Spur)

Once you know your specific school/dorm, add the relevant surface trolley
route(s) to ROUTES (see the route_type==0 list this script can print) the
same way gen-rideon-schedule.py was scoped to Ride On routes 23 & 29 —
trolleys T1-T5/G1 (13th St, Rt 34, Rt 13, Rt 11, Rt 36, Girard-Richmond) and
D1/D2 (suburban Media/Sharon Hill trolleys) are all available in the same
GTFS file but add real bulk, so they're opt-in.

Re-run whenever SEPTA changes its schedule:
    python3 gen-septa-subway-schedule.py
"""
import csv, io, json, os, urllib.request, zipfile, datetime

GTFS_URL = "https://www3.septa.org/developer/gtfs_public.zip"
OUT = os.path.join(os.path.dirname(__file__), "septa-subway-schedule.json")
ROUTES = {"L1", "B1", "B2", "B3"}   # Market-Frankford Line + Broad Street Line

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def to_min(t):
    p = t.split(":"); return int(p[0]) * 60 + int(p[1])

def main():
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "Mozilla/5.0 (compatible; transit-board-schedule-fetch/1.0)"})
    outer = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=120).read()))
    zf = zipfile.ZipFile(io.BytesIO(outer.read("google_bus.zip")))  # subway/trolley/bus all live here

    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    missing = ROUTES - set(routes)
    if missing:
        raise SystemExit(f"Route(s) not found in SEPTA's GTFS: {missing}")
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt") if t["route_id"] in ROUTES}

    seq = {}  # trip_id -> [(stop_seq, stop_id, dep_min)]
    with zf.open("stop_times.txt") as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            tid = row["trip_id"]
            if tid not in trips:
                continue
            dt = (row.get("departure_time") or "").strip()
            if not dt:
                continue
            seq.setdefault(tid, []).append((int(row["stop_sequence"]), row["stop_id"], to_min(dt)))

    trips_out, used_stops = [], set()
    for tid, t in trips.items():
        s = sorted(seq.get(tid, []))
        if len(s) < 2:
            continue
        for _, sid, _ in s:
            used_stops.add(sid)
        trips_out.append({
            "line": (routes[t["route_id"]].get("route_short_name") or "").strip(),
            "hs": (t.get("trip_headsign") or "").strip(),
            "s": t["service_id"],
            "st": [[sid, mins] for _, sid, mins in s],
        })

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

    out = {"generated": datetime.date.today().isoformat(),
           "note": f"SEPTA subway GTFS ({GTFS_URL}), routes {sorted(ROUTES)}",
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
