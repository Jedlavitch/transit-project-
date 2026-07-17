#!/usr/bin/env python3
"""
Regenerate septa-bus-schedule.json from SEPTA's published GTFS, filtered to
just the routes serving North Broad Street and Cecil B. Moore Ave near
Temple University (see ROUTES below).

Same technique as Ride On/SEPTA Regional Rail/SEPTA Subway: SEPTA's live bus
API (TransitView) has real data but no CORS, so a browser can't call it
directly without the optional septa-worker.js Cloudflare Worker. This
bundles the schedule instead: the board shows next-scheduled buses at
nearby stops and places buses on the map by interpolating each running
trip's position between stops from its scheduled time -- no key, no Worker.

SEPTA's full bus/trolley network (~20MB GTFS, hundreds of routes) is far too
big to bundle whole and most routes aren't relevant to any one person, so
this is scoped like Ride On was: to specific routes. Determined by querying
the GTFS directly for which routes actually run *along* (not just cross)
Cecil B Moore Ave and North Broad St near Temple's Main Campus:
  - Route 3   33rd St-Cecil B. Moore <-> Frankford Transit Center (Cecil B Moore Ave)
  - Route 4   Broad-Pattison <-> Fern Rock Transit Center (North Broad St)
  - Route 16  City Hall <-> Cheltenham-Ogontz (North Broad St)

Add more route_short_name values to ROUTES and re-run to track additional
lines once you know more of your regular routes.

Re-run whenever SEPTA changes its bus schedule:
    python3 gen-septa-bus-schedule.py
"""
import csv, io, json, os, urllib.request, zipfile, datetime

GTFS_URL = "https://www3.septa.org/developer/gtfs_public.zip"
OUT = os.path.join(os.path.dirname(__file__), "septa-bus-schedule.json")
ROUTES = {"3", "4", "16"}   # Cecil B. Moore + North Broad St corridors near Temple

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
    missing = ROUTES - {(r.get("route_short_name") or "").strip() for r in routes.values()}
    if missing:
        raise SystemExit(f"Route(s) not found in SEPTA's GTFS: {missing}")
    target_ids = {rid for rid, r in routes.items() if (r.get("route_short_name") or "").strip() in ROUTES}
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
           "note": f"SEPTA bus GTFS ({GTFS_URL}), routes {sorted(ROUTES)}",
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
