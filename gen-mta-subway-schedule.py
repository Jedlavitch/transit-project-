#!/usr/bin/env python3
"""
Regenerate mta-subway-schedule.json and mta-subway-shapes.json from the MTA's
published NYC Subway GTFS.

Unlike MARC/SEPTA/PATCO, the subway's live GTFS-Realtime feeds are directly
fetchable from the browser (CORS-open, no key -- confirmed via curl) so this
bundle is a fallback/labeling reference, not the primary data source: it
powers the departures card when the live feed is unreachable, gives
flipboard.html something to read, and supplies station coordinates for
placing live vehicles. The live map/card itself is driven by nyc.html's
client-side GTFS-Realtime decoder.

Scope: Manhattan + nearby Brooklyn/Queens (not the whole 5-borough system --
a full-length subway route can span the entire city, e.g. a 4/5 train runs
Bronx to Brooklyn, so this filters to a bounding box around the area, not by
route). Excludes Franklin Ave Shuttle, Rockaway Park Shuttle (both far outside
the box anyway) and Staten Island Railway (a separate physical system).

Two outputs from one download (avoids a second 5.6MB fetch):
  mta-subway-schedule.json -- same {stations,svc,exc,trips} shape as every
    other bundled system in this project (schema shared via
    marcActiveServices()/groupDepsByDirection()/drawScheduleRouteLines()),
    PLUS a "platforms" map ({platform_stop_id: parent_station_id}) not used
    by any other bundle -- the live GTFS-Realtime feed reports a vehicle's
    stop_id at platform granularity (e.g. "127N"), so the board needs this to
    resolve a live vehicle's current/next stop to a human station name via
    the "stations" list, which is itself consolidated to one entry per
    physical station (platform-level ids are NOT used as station ids here --
    ambiguous "103N"/"103S" duplicate near-identical-distance entries would
    otherwise show every station twice in the departures card).
  mta-subway-shapes.json -- real route geometry (shapes.txt), same
    most-used-shape-per-route + uniform-decimation technique as
    gen-amtrak-routes.py/amtrak-routes.json, keyed by route_id (e.g. "1",
    "A", "N", "GS") since that IS the rider-facing line label already, no
    name parsing needed.

Re-run whenever the MTA changes its timetable: python3 gen-mta-subway-schedule.py
"""
import csv, io, json, os, urllib.request, zipfile, datetime
from collections import defaultdict

GTFS_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip"
OUT_SCHED = os.path.join(os.path.dirname(__file__), "mta-subway-schedule.json")
OUT_SHAPES = os.path.join(os.path.dirname(__file__), "mta-subway-shapes.json")

# Every line with real Manhattan trackage, plus G (Brooklyn/Queens, per the
# widened "nearby Brooklyn/Queens" scope). Excludes FS (Franklin Ave Shuttle),
# H (Rockaway Park Shuttle), SI (Staten Island Railway -- a separate system).
ROUTES = {"A","C","E","B","D","F","FX","M","G","J","Z","L","N","Q","R","W","GS",
          "1","2","3","4","5","6","6X","7","7X"}

# Manhattan + nearby Brooklyn/Queens (Downtown Brooklyn/Williamsburg/Greenpoint,
# Long Island City/Astoria) -- verified against real station coordinates:
# keeps Inwood-207 St, South Ferry, Court Sq, Bedford Av; drops Van Cortlandt
# Park-242 St (Bronx), Coney Island (deep Brooklyn), Middle Village (deep Queens).
LAT_MIN, LAT_MAX = 40.685, 40.88
LON_MIN, LON_MAX = -74.02, -73.90

TARGET_POINTS = 150   # per-route shape cap after simplification, same as gen-amtrak-routes.py

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def to_min(t):
    p = t.split(":"); return int(p[0]) * 60 + int(p[1])

def simplify(points, target):
    """Uniform decimation: keep ~target points, always keep first & last."""
    n = len(points)
    if n <= target:
        return points
    step = n / target
    out = [points[int(i * step)] for i in range(target)]
    if out[-1] != points[-1]:
        out.append(points[-1])
    return out

def main():
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(GTFS_URL, timeout=120).read()))

    all_stops = rows(zf, "stops.txt")
    # Platform-level stops (e.g. "103N") point at a parent station ("103") via
    # parent_station; parent stations (location_type=1) have no parent of
    # their own. Every stop_id in stop_times.txt maps to its own id if it's
    # already a parent, else to its parent_station.
    parent_of = {}
    parent_coord = {}
    for s in all_stops:
        try:
            lat, lon = round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5)
        except (ValueError, KeyError):
            continue
        if s.get("location_type") == "1":
            parent_of[s["stop_id"]] = s["stop_id"]
            parent_coord[s["stop_id"]] = (lat, lon)
        elif s.get("parent_station"):
            parent_of[s["stop_id"]] = s["parent_station"]
        else:
            parent_of[s["stop_id"]] = s["stop_id"]
            parent_coord[s["stop_id"]] = (lat, lon)
    # Fill in coords for any parent_station id whose own row we haven't seen
    # yet (stops.txt order isn't guaranteed) using its own listed lat/lon.
    for s in all_stops:
        pid = parent_of.get(s["stop_id"])
        if pid and pid not in parent_coord:
            try:
                parent_coord[pid] = (round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5))
            except (ValueError, KeyError):
                pass

    station_ids = {pid for pid, (lat, lon) in parent_coord.items()
                    if LAT_MIN <= lat <= LAT_MAX and LON_MIN <= lon <= LON_MAX}

    # platform-level stop_id -> parent station id, for every platform whose
    # parent is in scope (independent of whether any bundled trip touches it --
    # the live feed can reference a platform this schedule dump never used).
    platforms = {s["stop_id"]: parent_of[s["stop_id"]] for s in all_stops
                 if s.get("location_type") != "1" and parent_of.get(s["stop_id"]) in station_ids}

    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt") if t["route_id"] in ROUTES}

    seq = {}  # trip_id -> [(stop_seq, parent_stop_id, dep_min)]
    with zf.open("stop_times.txt") as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            tid = row["trip_id"]
            tr = trips.get(tid)
            if not tr:
                continue
            pid = parent_of.get(row["stop_id"])
            if not pid or pid not in station_ids:
                continue   # outside the Manhattan+nearby-BK/Queens box
            dt = (row.get("departure_time") or "").strip()
            if not dt:
                continue
            seq.setdefault(tid, []).append((int(row["stop_sequence"]), pid, to_min(dt)))

    trips_out, used_stations = [], set()
    for tid, s in seq.items():
        s.sort()
        if len(s) < 2:
            continue   # only touched the box for one stop (or less) -- not useful
        tr = trips[tid]
        for _, pid, _ in s:
            used_stations.add(pid)
        trips_out.append({
            "line": tr["route_id"],
            "hs": (tr.get("trip_headsign") or "").strip(),
            "s": tr["service_id"],
            "st": [[pid, mins] for _, pid, mins in s],
        })

    stations = []
    for s in all_stops:
        if s.get("location_type") == "1" and s["stop_id"] in used_stations:
            stations.append({"id": s["stop_id"], "name": s["stop_name"],
                              "lat": parent_coord[s["stop_id"]][0], "lon": parent_coord[s["stop_id"]][1]})

    svc = {c["service_id"]: {"dow": [int(c[k]) for k in ("monday","tuesday","wednesday","thursday","friday","saturday","sunday")],
                             "start": c["start_date"], "end": c["end_date"]} for c in rows(zf, "calendar.txt")}
    exc = {}
    for c in rows(zf, "calendar_dates.txt"):
        e = exc.setdefault(c["date"], {"add": [], "rem": []})
        (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])

    out = {"generated": datetime.date.today().isoformat(), "note": f"MTA Subway GTFS ({GTFS_URL}), Manhattan + nearby Brooklyn/Queens",
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out, "platforms": platforms}
    with open(OUT_SCHED, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT_SCHED}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT_SCHED)} bytes")

    # ---- route shapes (real geometry, same technique as gen-amtrak-routes.py) ----
    route_shape_trips = defaultdict(lambda: defaultdict(int))
    for t in rows(zf, "trips.txt"):
        if t["route_id"] not in ROUTES:
            continue
        sid = t.get("shape_id", "")
        if sid:
            route_shape_trips[t["route_id"]][sid] += 1
    candidate_shapes = {sid for sc in route_shape_trips.values() for sid in sc}

    shape_pts = defaultdict(list)
    with zf.open("shapes.txt") as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            sid = row["shape_id"]
            if sid in candidate_shapes:
                try:
                    shape_pts[sid].append((int(row["shape_pt_sequence"]),
                                           round(float(row["shape_pt_lat"]), 5),
                                           round(float(row["shape_pt_lon"]), 5)))
                except (ValueError, KeyError):
                    pass

    shapes_out = {}
    for route_id, sc in route_shape_trips.items():
        best_sid = max(sc.items(), key=lambda kv: (kv[1], len(shape_pts.get(kv[0], []))))[0]
        pts = sorted(shape_pts.get(best_sid, []))
        if len(pts) < 2:
            continue
        latlon = [[lat, lon] for _, lat, lon in pts]
        shapes_out[route_id] = simplify(latlon, TARGET_POINTS)

    with open(OUT_SHAPES, "w") as fh:
        json.dump(shapes_out, fh, separators=(",", ":"))
    total_pts = sum(len(v) for v in shapes_out.values())
    print(f"Wrote {OUT_SHAPES}: {len(shapes_out)} routes, {total_pts} points total, {os.path.getsize(OUT_SHAPES)} bytes")

if __name__ == "__main__":
    main()
