#!/usr/bin/env python3
"""
Regenerate rideon-schedule.json from Montgomery County's published Ride On GTFS:
EVERY route in the county (ROUTES = None), or a subset if ROUTES names some.

Ride On publishes no public real-time feed. Its "developer page"
(rideonrealtime.net) now just redirects to the rider app at rideon.app, and
neither Transitland nor the Mobility Database lists a GTFS-RT feed for it
(checked 2026-11-06). So, exactly like MARC, the board places buses on the map
by interpolating each trip between stops from its *scheduled* times, and shows
next departures from the same data. No API key, no Worker, no proxy.

The whole county is ~17,500 trips / ~700k stop_times rows: 10.8 MB as plain
JSON. That is why the output is written pattern-compressed ("v":2, see
compress-bundle.py): 263 distinct stop sequences and ~2,100 running-time
profiles cover every trip, so it lands at ~1.8 MB (~200 KB gzipped on the
wire). Every page that reads it runs expandBundle() on load.

Re-run whenever Ride On changes its timetable:  python3 gen-rideon-schedule.py
"""
import csv, io, json, os, runpy, urllib.request, zipfile, datetime

GTFS_URL = "https://www.montgomerycountymd.gov/DOT-Transit/Resources/Files/GTFS/RideOnGTFS.zip"
OUT = os.path.join(os.path.dirname(__file__), "rideon-schedule.json")
ROUTES = None   # None = every Ride On route; or a set of route_short_names, e.g. {"23", "29"}

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def to_min(t):
    p = t.split(":"); return int(p[0]) * 60 + int(p[1])

def main():
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "Mozilla/5.0 (compatible; transit-board-schedule-fetch/1.0)"})
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=120).read()))
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    target_ids = {rid for rid, r in routes.items()
                  if ROUTES is None or (r.get("route_short_name") or "").strip() in ROUTES}
    if not target_ids:
        raise SystemExit(f"No routes matched {ROUTES} — check route_short_name values in routes.txt")

    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt") if t["route_id"] in target_ids}

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
           "note": f"Ride On GTFS ({GTFS_URL}), " + ("all routes" if ROUTES is None else f"routes {sorted(ROUTES)}"),
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out}
    # Pattern-compress in the generator itself, so refresh-schedules.py and the
    # CI refresh can never publish the 10 MB uncompressed form.
    compress = runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "compress-bundle.py"),
                              run_name="compress_bundle")["compress"]
    out = compress(out)[0]
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
