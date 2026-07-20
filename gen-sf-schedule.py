#!/usr/bin/env python3
"""
Regenerate the San Francisco schedule bundles for sanfrancisco.html,
night.html and flipboard.html:

  sf-bart-schedule.json     -- BART, all lines (directional route pairs like
                               "Yellow-S"/"Yellow-N" collapse to one "Yellow"
                               line label). Colors live in sanfrancisco.html.
  sf-bart-shapes.json       -- real BART geometry per line for the map.
  sf-muni-schedule.json     -- Muni Metro light rail + the F historic
                               streetcars (route_type 0), from SFMTA's GTFS
                               (hosted on DataSF -- the sfmta.com direct URL
                               is dead).
  sf-cablecar-schedule.json -- the cable cars (route_type 5): Powell-Mason,
                               Powell-Hyde, California. Labels P-M / P-H / CAL.
  sf-caltrain-schedule.json -- Caltrain (Trillium mirror; calendar currently
                               valid into 2027 -- re-check when regenerating,
                               see ADDING-A-CITY.md's stale-mirror gotcha).

TIMEZONE: every bundle carries tz:"America/Los_Angeles" (same mechanism as
Amsterdam's Europe/Amsterdam bundles).

Re-run monthly-ish:  python3 gen-sf-schedule.py [cache-dir]
With a cache-dir argument, bart.zip / muni.zip / caltrain.zip there are
reused instead of downloaded.
"""
import csv, io, json, os, sys, urllib.request, zipfile, datetime
from collections import defaultdict

BART_URL = "https://www.bart.gov/dev/schedules/google_transit.zip"
MUNI_URL = "https://data.sfgov.org/download/dni7-qpv3/application%2Fx-zip-compressed"
CALTRAIN_URL = "https://data.trilliumtransit.com/gtfs/caltrain-ca-us/caltrain-ca-us.zip"
HERE = os.path.dirname(__file__)
TZ = "America/Los_Angeles"
TARGET_POINTS = 150

CABLE_LABEL = {"POWELL-MASON": "P-M", "POWELL-HYDE": "P-H", "CALIFORNIA": "CAL"}


def load_zip(url, cache_name):
    cache_dir = sys.argv[1] if len(sys.argv) > 1 else None
    if cache_dir:
        p = os.path.join(cache_dir, cache_name)
        if os.path.exists(p):
            return zipfile.ZipFile(p)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (transit-board-schedule-fetch)"})
    return zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=180).read()))


def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))


def to_min(t):
    p = t.split(":")
    return int(p[0]) * 60 + int(p[1])


def simplify(points, target):
    n = len(points)
    if n <= target:
        return points
    step = n / target
    out = [points[int(i * step)] for i in range(target)]
    if out[-1] != points[-1]:
        out.append(points[-1])
    return out


def parent_maps(zf):
    parent_of, parent_coord, name_of = {}, {}, {}
    stops = rows(zf, "stops.txt")
    for s in stops:
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
        name_of[s["stop_id"]] = s.get("stop_name", s["stop_id"])
    for s in stops:
        pid = parent_of.get(s["stop_id"])
        if pid and pid not in parent_coord:
            try:
                parent_coord[pid] = (round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5))
            except (ValueError, KeyError):
                pass
    return parent_of, parent_coord, name_of


def bundle(zf, line_label_fn, out_name, route_filter=lambda r: True):
    parent_of, parent_coord, name_of = parent_maps(zf)
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt") if route_filter(r)}
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt") if t["route_id"] in routes}
    seq = defaultdict(list)
    with zf.open("stop_times.txt") as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            tid = row["trip_id"]
            if tid not in trips:
                continue
            pid = parent_of.get(row["stop_id"])
            dt = (row.get("departure_time") or "").strip()
            if pid and dt:
                seq[tid].append((int(row["stop_sequence"]), pid, to_min(dt)))
    trips_out, used_stations, used_svc, used_routes = [], set(), set(), set()
    for tid, s in seq.items():
        s.sort()
        if len(s) < 2:
            continue
        tr = trips[tid]
        for _, pid, _ in s:
            used_stations.add(pid)
        used_svc.add(tr["service_id"])
        used_routes.add(tr["route_id"])
        trips_out.append({"line": line_label_fn(routes[tr["route_id"]]),
                          "hs": (tr.get("trip_headsign") or "").strip(),
                          "s": tr["service_id"],
                          "id": tid,   # GTFS trip_id -- matches live GTFS-RT vehicles 1:1, so a
                                       # departure can be tied to a moving train and delay-adjusted
                          "st": [[pid, mins] for _, pid, mins in s]})
    stations = [{"id": pid, "name": name_of.get(pid, pid),
                 "lat": parent_coord[pid][0], "lon": parent_coord[pid][1]}
                for pid in sorted(used_stations) if pid in parent_coord]
    svc = {}
    if "calendar.txt" in zf.namelist():
        svc = {c["service_id"]: {"dow": [int(c[k]) for k in ("monday", "tuesday", "wednesday",
                                                             "thursday", "friday", "saturday", "sunday")],
                                 "start": c["start_date"], "end": c["end_date"]}
               for c in rows(zf, "calendar.txt") if c["service_id"] in used_svc}
    exc = {}
    if "calendar_dates.txt" in zf.namelist():
        for c in rows(zf, "calendar_dates.txt"):
            if c["service_id"] not in used_svc:
                continue
            e = exc.setdefault(c["date"], {"add": [], "rem": []})
            (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])
    out = {"generated": datetime.date.today().isoformat(), "tz": TZ,
           # GTFS route_id -> line label, for matching live GTFS-RT vehicles
           # (which carry route_id) to this bundle's lines.
           "routeLines": {rid: line_label_fn(routes[rid]) for rid in sorted(used_routes)},
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out}
    path = os.path.join(HERE, out_name)
    with open(path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {path}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(path)} bytes")
    return routes, trips


def shapes_for(zf, routes, trips, label_fn, out_name):
    route_shape_trips = defaultdict(lambda: defaultdict(int))
    for t in trips.values():
        if t.get("shape_id"):
            route_shape_trips[t["route_id"]][t["shape_id"]] += 1
    candidates = {sid for sc in route_shape_trips.values() for sid in sc}
    pts = defaultdict(list)
    with zf.open("shapes.txt") as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            if row["shape_id"] in candidates:
                try:
                    pts[row["shape_id"]].append((int(row["shape_pt_sequence"]),
                                                 round(float(row["shape_pt_lat"]), 5),
                                                 round(float(row["shape_pt_lon"]), 5)))
                except (ValueError, KeyError):
                    pass
    out = {}
    for rid, sc in route_shape_trips.items():
        best = max(sc.items(), key=lambda kv: (kv[1], len(pts.get(kv[0], []))))[0]
        p = sorted(pts.get(best, []))
        if len(p) >= 2:
            out[label_fn(routes[rid])] = simplify([[lat, lon] for _, lat, lon in p], TARGET_POINTS)
    path = os.path.join(HERE, out_name)
    with open(path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {path}: {len(out)} lines, {os.path.getsize(path)} bytes")


def bart_label(r):
    return (r.get("route_short_name") or "").split("-")[0].strip() or r.get("route_id", "?")


def muni_label(r):
    return (r.get("route_short_name") or "").strip() or "?"


def cable_label(r):
    return CABLE_LABEL.get((r.get("route_long_name") or "").strip().upper(),
                           (r.get("route_short_name") or "CC").strip())


def caltrain_label(r):
    n = (r.get("route_short_name") or "").lower()
    if "express" in n: return "EXP"
    if "limited" in n: return "LTD"
    if "south" in n: return "SC"
    return "LOCAL"


def main():
    print("BART …")
    zf = load_zip(BART_URL, "bart.zip")
    routes, trips = bundle(zf, bart_label, "sf-bart-schedule.json",
                           route_filter=lambda r: r.get("route_type") == "1")
    shapes_for(zf, routes, trips, bart_label, "sf-bart-shapes.json")
    print("Muni (light rail + F streetcars, and cable cars) …")
    zf = load_zip(MUNI_URL, "muni.zip")
    bundle(zf, muni_label, "sf-muni-schedule.json",
           route_filter=lambda r: r.get("route_type") == "0")
    bundle(zf, cable_label, "sf-cablecar-schedule.json",
           route_filter=lambda r: r.get("route_type") == "5")
    print("Caltrain …")
    zf = load_zip(CALTRAIN_URL, "caltrain.zip")
    bundle(zf, caltrain_label, "sf-caltrain-schedule.json")


if __name__ == "__main__":
    main()
