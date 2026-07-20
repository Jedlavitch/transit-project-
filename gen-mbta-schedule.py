#!/usr/bin/env python3
"""
Regenerate the three MBTA schedule bundles (+ subway shapes) for boston.html,
night.html and flipboard.html from the MBTA's published static GTFS:

  mbta-cr-schedule.json      -- Commuter Rail, whole system (line = route id
                                minus the "CR-" prefix, e.g. "Providence")
  mbta-subway-schedule.json  -- Red/Orange/Blue/Green-B..E/Mattapan ("the T"),
                                whole system -- compact enough not to need the
                                bounding-box trick gen-mta-subway-schedule.py
                                uses -- PLUS a "platforms" map like the NYC
                                bundle: the live v3-API vehicles reference
                                platform-granularity stop ids, and this
                                resolves them to parent-station names.
  mbta-bus-schedule.json     -- Silver Line SL1-SL5 + Route 1 only (the whole
                                bus network would be enormous; same ROUTES
                                filter idea as gen-rideon-schedule.py)
  mbta-subway-shapes.json    -- real route geometry for the map lines, same
                                most-used-shape + uniform-decimation technique
                                as gen-mta-subway-schedule.py

One ~20MB download, one stop_times pass, four outputs. The MBTA's
calendar_dates.txt is huge, so each bundle's svc/exc are filtered down to the
service ids its own trips actually use.

Re-run whenever the MBTA changes its timetable:  python3 gen-mbta-schedule.py
"""
import csv, io, json, os, urllib.request, zipfile, datetime
from collections import defaultdict

GTFS_URL = "https://cdn.mbta.com/MBTA_GTFS.zip"
HERE = os.path.dirname(__file__)
# SL1/SL2/SL3 (South Station-Seaport-airport) + SL4/SL5 (downtown) + Route 1
# (Mass Ave, Harvard-Nubian). route_id, not short name: SL1=741 SL2=742
# SL3=743 SL5=749 SL4=751.
BUS_ROUTES = {"741", "742", "743", "749", "751", "1"}
TARGET_POINTS = 150   # per-route shape cap, same as gen-amtrak-routes.py


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


def main():
    print(f"Downloading {GTFS_URL} …")
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(GTFS_URL, timeout=300).read()))

    # ---- stops: consolidate platform-level ids to parent stations ----
    all_stops = rows(zf, "stops.txt")
    parent_of, parent_coord, name_of = {}, {}, {}
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
        name_of[s["stop_id"]] = s.get("stop_name", s["stop_id"])
    for s in all_stops:   # fill parent coords stops.txt order didn't give us
        pid = parent_of.get(s["stop_id"])
        if pid and pid not in parent_coord:
            try:
                parent_coord[pid] = (round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5))
            except (ValueError, KeyError):
                pass

    # ---- routes: split into the three bundles ----
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    subway_routes = {rid for rid, r in routes.items()
                     if r.get("route_type") in ("0", "1") and not rid.startswith("Shuttle")}
    cr_routes = {rid for rid in routes if rid.startswith("CR-")}
    bus_routes = {rid for rid in BUS_ROUTES if rid in routes}
    print(f"Routes: subway={sorted(subway_routes)} cr={len(cr_routes)} bus={sorted(bus_routes)}")

    def group_of(rid):
        if rid in subway_routes: return "subway"
        if rid in cr_routes: return "cr"
        if rid in bus_routes: return "bus"
        return None

    def line_label(rid):
        if rid in cr_routes:
            return rid[3:]                                  # CR-Providence -> Providence
        if rid in bus_routes:
            return (routes[rid].get("route_short_name") or rid).strip() or rid   # 741 -> SL1
        return rid                                          # Red / Green-B / Mattapan

    trips_all, trip_group = {}, {}
    for t in rows(zf, "trips.txt"):
        g = group_of(t["route_id"])
        if g:
            trips_all[t["trip_id"]] = t
            trip_group[t["trip_id"]] = g

    # ---- one pass over stop_times ----
    seq = defaultdict(list)   # trip_id -> [(stop_seq, parent_stop_id, dep_min)]
    with zf.open("stop_times.txt") as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            tid = row["trip_id"]
            if tid not in trips_all:
                continue
            pid = parent_of.get(row["stop_id"])
            dt = (row.get("departure_time") or "").strip()
            if not pid or not dt:
                continue
            seq[tid].append((int(row["stop_sequence"]), pid, to_min(dt)))

    # ---- calendar (filtered per bundle below -- MBTA's exc list is huge) ----
    svc_all = {c["service_id"]: {"dow": [int(c[k]) for k in ("monday", "tuesday", "wednesday",
                                                             "thursday", "friday", "saturday", "sunday")],
                                 "start": c["start_date"], "end": c["end_date"]}
               for c in rows(zf, "calendar.txt")} if "calendar.txt" in zf.namelist() else {}
    exc_all = defaultdict(lambda: {"add": [], "rem": []})
    if "calendar_dates.txt" in zf.namelist():
        for c in rows(zf, "calendar_dates.txt"):
            e = exc_all[c["date"]]
            (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])

    def emit(group, out_name, extra=None):
        trips_out, used_stations, used_svc = [], set(), set()
        for tid, s in seq.items():
            if trip_group.get(tid) != group:
                continue
            s.sort()
            if len(s) < 2:
                continue
            tr = trips_all[tid]
            for _, pid, _ in s:
                used_stations.add(pid)
            used_svc.add(tr["service_id"])
            trips_out.append({
                "line": line_label(tr["route_id"]),
                "hs": (tr.get("trip_headsign") or "").strip(),
                "s": tr["service_id"],
                "st": [[pid, mins] for _, pid, mins in s],
            })
        stations = [{"id": pid, "name": name_of.get(pid, pid),
                     "lat": parent_coord[pid][0], "lon": parent_coord[pid][1]}
                    for pid in sorted(used_stations) if pid in parent_coord]
        svc = {sid: v for sid, v in svc_all.items() if sid in used_svc}
        exc = {}
        for date, e in exc_all.items():
            add = [x for x in e["add"] if x in used_svc]
            rem = [x for x in e["rem"] if x in used_svc]
            if add or rem:
                exc[date] = {"add": add, "rem": rem}
        out = {"generated": datetime.date.today().isoformat(),
               "note": f"MBTA GTFS ({GTFS_URL}), {group} bundle",
               "stations": stations, "svc": svc, "exc": exc, "trips": trips_out}
        if extra:
            out.update(extra)
        path = os.path.join(HERE, out_name)
        with open(path, "w") as fh:
            json.dump(out, fh, separators=(",", ":"))
        print(f"Wrote {path}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(path)} bytes")

    # platform-level id -> parent station id, subway only (for live v3-API
    # vehicles, which reference platform-granularity stop ids)
    platforms = {}
    for tid, s in seq.items():
        if trip_group.get(tid) == "subway":
            for _, pid, _ in s:
                platforms.setdefault(pid, pid)
    for s in all_stops:
        pid = parent_of.get(s["stop_id"])
        if s.get("location_type") != "1" and pid in platforms:
            platforms[s["stop_id"]] = pid

    emit("cr", "mbta-cr-schedule.json")
    emit("subway", "mbta-subway-schedule.json", extra={"platforms": platforms})
    emit("bus", "mbta-bus-schedule.json")

    # ---- subway route shapes ----
    route_shape_trips = defaultdict(lambda: defaultdict(int))
    for t in trips_all.values():
        if t["route_id"] in subway_routes and t.get("shape_id"):
            route_shape_trips[t["route_id"]][t["shape_id"]] += 1
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
        if len(pts) >= 2:
            shapes_out[route_id] = simplify([[lat, lon] for _, lat, lon in pts], TARGET_POINTS)
    path = os.path.join(HERE, "mbta-subway-shapes.json")
    with open(path, "w") as fh:
        json.dump(shapes_out, fh, separators=(",", ":"))
    print(f"Wrote {path}: {len(shapes_out)} routes, {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
