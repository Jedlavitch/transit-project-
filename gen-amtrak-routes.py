#!/usr/bin/env python3
"""
Regenerate amtrak-routes.json: real curved track geometry for every Amtrak
route, from Amtrak's own published GTFS shapes.txt.

Without this, the board drew an Amtrak train's "route" by connecting its
station stops with straight lines -- which cuts across curves, rivers, and
cities instead of following the actual corridor. This bundles Amtrak's real
route shapes instead: for each named route (Acela, Northeast Regional,
Crescent, etc.) the shape used by the most trips is picked, then simplified
(uniform decimation, capped at ~150 points/route -- plenty for a smooth
line on a map, cheap to bundle) so the whole national network fits in one
small file.

At runtime the board matches a live train's `routeName` (from the amtraker
API) to this bundled map by a normalized name (lowercase, strip " service").
Non-Amtrak trains amtraker also tracks (VIA Rail, Brightline, etc.) won't
match anything here and just don't get a route line drawn -- a harmless,
silent fallback, not an error.

Re-run when Amtrak updates its route network (rare):
    python3 gen-amtrak-routes.py
"""
import csv, io, json, os, urllib.request, zipfile
from collections import defaultdict

GTFS_URL = "https://content.amtrak.com/content/gtfs/GTFS.zip"
OUT = os.path.join(os.path.dirname(__file__), "amtrak-routes.json")
EXCLUDE = {"Amtrak Thruway Connecting Service", "Commuter Rail", ""}
TARGET_POINTS = 150   # per-route cap after simplification

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

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
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "Mozilla/5.0 (compatible; transit-board-schedule-fetch/1.0)"})
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=120).read()))

    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    trips = rows(zf, "trips.txt")

    # route_long_name -> {shape_id: trip_count}
    name_shape_trips = defaultdict(lambda: defaultdict(int))
    for t in trips:
        r = routes.get(t["route_id"])
        if not r:
            continue
        name = r.get("route_long_name", "")
        if name in EXCLUDE:
            continue
        sid = t.get("shape_id", "")
        if sid:
            name_shape_trips[name][sid] += 1

    candidate_shapes = {sid for sc in name_shape_trips.values() for sid in sc}

    # shape_id -> [(seq, lat, lon), ...]
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

    out = {}
    for name, sc in name_shape_trips.items():
        # prefer the shape used by the most trips; tie-break by point count (fuller route)
        best_sid = max(sc.items(), key=lambda kv: (kv[1], len(shape_pts.get(kv[0], []))))[0]
        pts = sorted(shape_pts.get(best_sid, []))
        if len(pts) < 2:
            continue
        latlon = [[lat, lon] for _, lat, lon in pts]
        out[name] = simplify(latlon, TARGET_POINTS)

    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    total_pts = sum(len(v) for v in out.values())
    print(f"Wrote {OUT}: {len(out)} routes, {total_pts} points total, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
