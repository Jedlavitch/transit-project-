#!/usr/bin/env python3
"""
Regenerate the four Amsterdam schedule bundles (+ metro shapes) for
amsterdam.html, night.html and flipboard.html from the Dutch national GTFS
(OVapi/NDOV -- one feed covers every operator in the Netherlands):

  ams-metro-schedule.json  -- GVB metro, lines 50-54 (route_type 1)
  ams-tram-schedule.json   -- GVB tram, all ~18 lines (route_type 0)
  ams-ferry-schedule.json  -- GVB IJ ferries F1-F22, the free "pontjes"
                              behind Centraal (route_type 4)
  ams-rail-schedule.json   -- NS trains (IFF:NS, route_type 2) truncated to a
                              greater-Amsterdam bounding box (Centraal/Zuid/
                              Sloterdijk/Amstel/Bijlmer/Schiphol/Zaandam/
                              Weesp) -- an Intercity crosses the whole
                              country, so this keeps only in-box stops per
                              trip, same technique as gen-mta-subway's box.
                              Line label: IC / SPR.
  ams-intl-schedule.json   -- international trains (NS International +
                              European Sleeper + GoVolta + DB/NMBS/Eurobahn):
                              Eurostar, ICE, Nightjet, EuroCity, Intercity
                              direct, ES, GV. Kept at FULL route length (so
                              the map can show one en route to Brussels or
                              Berlin) but only trips that actually CALL at a
                              station inside the Amsterdam box. Line labels:
                              EST / ICE / NJ / EC / ECD / ICD / ES / GV.
  ams-metro-shapes.json    -- real metro geometry for the map, most-used
                              shape per line + uniform decimation.

EUROPEAN-TIMEZONE NOTE: every bundle carries "tz":"Europe/Amsterdam". The
runtime helpers (amsterdam.html, night.html, flipboard.html) compute
"now" in that zone, so the board is correct no matter where it's viewed.
The Dutch feed is calendar_dates-only (no calendar.txt) -- svc stays empty
and service activity resolves purely from exc, which the runtime supports.

The feed is ~268MB, so the script caches the download:
  python3 gen-amsterdam-schedule.py [path-to-local-gtfs-nl.zip]
With no argument it downloads to /tmp/gtfs-nl.zip and reuses it if present.
"""
import csv, io, json, os, sys, urllib.request, zipfile, datetime
from collections import defaultdict

GTFS_URL = "http://gtfs.ovapi.nl/nl/gtfs-nl.zip"
HERE = os.path.dirname(__file__)
TZ = "Europe/Amsterdam"
TARGET_POINTS = 150
# The Dutch feed enumerates every service date for months ahead, which makes
# raw bundles huge (trams alone were 17MB). Keep only trips that actually run
# within this many days -- re-run the generator at least this often.
HORIZON_DAYS = 30

# Greater Amsterdam box for NS rail (see module docstring)
LAT_MIN, LAT_MAX = 52.20, 52.50
LON_MIN, LON_MAX = 4.70, 5.06

# Official-ish GVB metro line colors (also hardcoded in amsterdam.html /
# flipboard.html as AMS_METRO_COL -- keep in sync)
METRO_LINES = {"50", "51", "52", "53", "54"}

# International operators serving the Netherlands in the national feed. The
# eastern cross-border regionals (DB/Eurobahn/NMBS) never call inside the
# Amsterdam box, so they filter themselves out naturally.
INTL_AGENCIES = {"IFF:NS_INT", "IFF:EU_SLEEPER", "IFF:GV", "IFF:DB", "IFF:NMBS", "IFF:EUROBAHN"}


def intl_label(sn):
    s = (sn or "").strip().lower()
    if s.startswith("eurostar"): return "EST"
    if s.startswith("nightjet"): return "NJ"
    if s.startswith("ice"): return "ICE"
    if s.startswith("eurocity direct"): return "ECD"
    if s.startswith("eurocity"): return "EC"
    if s.startswith("intercity direct"): return "ICD"
    if s.startswith("european sleeper"): return "ES"
    if s.startswith("govolta"): return "GV"
    return (sn or "INT").split()[0][:6].upper()


def rows_iter(zf, name):
    return csv.DictReader(io.TextIOWrapper(zf.open(name), encoding="utf-8-sig"))


def rows(zf, name):
    return list(rows_iter(zf, name))


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
    cache = sys.argv[1] if len(sys.argv) > 1 else "/tmp/gtfs-nl.zip"
    if not os.path.exists(cache):
        print(f"Downloading {GTFS_URL} -> {cache} (~268MB) …")
        urllib.request.urlretrieve(GTFS_URL, cache)
    zf = zipfile.ZipFile(cache)

    # ---- stops: consolidate platforms ("stoparea:*" parents) ----
    print("Reading stops …")
    parent_of, parent_coord, name_of = {}, {}, {}
    all_stops = rows(zf, "stops.txt")
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
    for s in all_stops:
        pid = parent_of.get(s["stop_id"])
        if pid and pid not in parent_coord:
            try:
                parent_coord[pid] = (round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5))
            except (ValueError, KeyError):
                pass

    # ---- routes: pick the four bundles ----
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    def short(rid): return (routes[rid].get("route_short_name") or "").strip()
    gvb = {rid for rid, r in routes.items() if r.get("agency_id") == "GVB"}
    metro_routes = {rid for rid in gvb if routes[rid].get("route_type") == "1"}
    tram_routes  = {rid for rid in gvb if routes[rid].get("route_type") == "0"}
    ferry_routes = {rid for rid in gvb if routes[rid].get("route_type") == "4"}
    rail_routes  = {rid for rid, r in routes.items()
                    if r.get("agency_id") == "IFF:NS" and r.get("route_type") == "2"}
    intl_routes  = {rid for rid, r in routes.items()
                    if r.get("agency_id") in INTL_AGENCIES and r.get("route_type") == "2"}
    print(f"Routes: metro={sorted(short(r) for r in metro_routes)} "
          f"tram={len(tram_routes)} ferry={len(ferry_routes)} NS rail={len(rail_routes)} "
          f"intl={len(intl_routes)}")

    def group_of(rid):
        if rid in metro_routes: return "metro"
        if rid in tram_routes: return "tram"
        if rid in ferry_routes: return "ferry"
        if rid in rail_routes: return "rail"
        if rid in intl_routes: return "intl"
        return None

    def line_label(rid):
        if rid in rail_routes:
            sn = short(rid)
            return "IC" if "intercity" in sn.lower() else "SPR" if "sprinter" in sn.lower() else (sn or "NS")
        if rid in intl_routes:
            return intl_label(short(rid))
        return short(rid) or rid

    trips_all, trip_group = {}, {}
    for t in rows_iter(zf, "trips.txt"):
        g = group_of(t["route_id"])
        if g:
            trips_all[t["trip_id"]] = t
            trip_group[t["trip_id"]] = g

    # NS trips are box-truncated; GVB is entirely local so no box needed.
    def in_box(pid):
        c = parent_coord.get(pid)
        return c and LAT_MIN <= c[0] <= LAT_MAX and LON_MIN <= c[1] <= LON_MAX

    print("Reading stop_times (1.4GB, a few minutes) …")
    seq = defaultdict(list)
    for row in rows_iter(zf, "stop_times.txt"):
        tid = row["trip_id"]
        g = trip_group.get(tid)
        if not g:
            continue
        pid = parent_of.get(row["stop_id"])
        dt = (row.get("departure_time") or "").strip()
        if not pid or not dt:
            continue
        if g == "rail" and not in_box(pid):
            continue          # NS domestic: keep only the in-box portion
        seq[tid].append((int(row["stop_sequence"]), pid, to_min(dt)))
        # intl keeps its FULL route; trips that never call in the box are
        # dropped later in emit() via must_touch_box.

    # calendar_dates-only feed: svc stays empty, activity comes from exc.
    print("Reading calendar_dates …")
    today = datetime.date.today()
    window = {(today + datetime.timedelta(days=d)).strftime("%Y%m%d")
              for d in range(HORIZON_DAYS + 1)}
    exc_all = defaultdict(lambda: {"add": [], "rem": []})
    window_svc = set()   # services that run at least once inside the horizon
    for c in rows_iter(zf, "calendar_dates.txt"):
        if c["date"] not in window:
            continue
        e = exc_all[c["date"]]
        (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])
        if c["exception_type"] == "1":
            window_svc.add(c["service_id"])

    def emit(group, out_name, must_touch_box=False):
        trips_out, used_stations, used_svc, used_routes = [], set(), set(), set()
        for tid, s in seq.items():
            if trip_group.get(tid) != group:
                continue
            s.sort()
            if len(s) < 2:
                continue
            if must_touch_box and not any(in_box(pid) for _, pid, _ in s):
                continue   # an international that never calls near Amsterdam
            tr = trips_all[tid]
            if tr["service_id"] not in window_svc:
                continue   # never runs inside the horizon -- don't bundle it
            used_routes.add(tr["route_id"])
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
        exc = {}
        for date, e in exc_all.items():
            add = [x for x in e["add"] if x in used_svc]
            rem = [x for x in e["rem"] if x in used_svc]
            if add or rem:
                exc[date] = {"add": add, "rem": rem}
        out = {"generated": datetime.date.today().isoformat(),
               "note": f"NL national GTFS ({GTFS_URL}), {group} bundle", "tz": TZ,
               # GTFS route_id -> line label, so the live GTFS-RT feed's
               # vehicles (which carry route_id) can be matched to this
               # bundle's lines (see amsterdam.html's fetchAmsLive).
               "routeLines": {rid: line_label(rid) for rid in sorted(used_routes)},
               "stations": stations, "svc": {}, "exc": exc, "trips": trips_out}
        path = os.path.join(HERE, out_name)
        with open(path, "w") as fh:
            json.dump(out, fh, separators=(",", ":"))
        print(f"Wrote {path}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(path)} bytes")

    emit("metro", "ams-metro-schedule.json")
    emit("tram",  "ams-tram-schedule.json")
    emit("ferry", "ams-ferry-schedule.json")
    emit("rail",  "ams-rail-schedule.json")
    emit("intl",  "ams-intl-schedule.json", must_touch_box=True)

    # ---- metro route shapes ----
    print("Reading shapes …")
    route_shape_trips = defaultdict(lambda: defaultdict(int))
    for t in trips_all.values():
        if t["route_id"] in metro_routes and t.get("shape_id"):
            route_shape_trips[t["route_id"]][t["shape_id"]] += 1
    candidate_shapes = {sid for sc in route_shape_trips.values() for sid in sc}
    shape_pts = defaultdict(list)
    for row in rows_iter(zf, "shapes.txt"):
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
            shapes_out[short(route_id) or route_id] = simplify([[lat, lon] for _, lat, lon in pts], TARGET_POINTS)
    path = os.path.join(HERE, "ams-metro-shapes.json")
    with open(path, "w") as fh:
        json.dump(shapes_out, fh, separators=(",", ":"))
    print(f"Wrote {path}: {len(shapes_out)} lines, {os.path.getsize(path)} bytes")


if __name__ == "__main__":
    main()
