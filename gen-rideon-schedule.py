#!/usr/bin/env python3
"""
Regenerate rideon-schedule.json from Montgomery County Ride On's GTFS.

Ride On has NO public real-time feed, and its full GTFS is huge (~34 MB of
stop_times), so this bundles only the schedule for stops within RADIUS_MI of
HERE (the board's home location). The board reads it to show the next
scheduled Ride On departures at your nearest stops — no key, no Worker.

Re-run when Ride On changes its timetable, or change HERE/RADIUS_MI for a
different area:  python3 gen-rideon-schedule.py
"""
import csv, io, json, math, os, urllib.request, zipfile, datetime

GTFS_URL = "https://www.montgomerycountymd.gov/DOT-Transit/Resources/Files/GTFS/RideOnGTFS.zip"
HERE = (38.958, -77.108)     # Bethesda, MD 20816
RADIUS_MI = 1.5
OUT = os.path.join(os.path.dirname(__file__), "rideon-schedule.json")

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def mi(lat, lon):
    return math.hypot((lat - HERE[0]) * 69, (lon - HERE[1]) * 54)

def to_min(t):
    p = t.split(":"); return int(p[0]) * 60 + int(p[1])

def main():
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(GTFS_URL, timeout=120).read()))
    routes = {r["route_id"]: (r.get("route_short_name") or r.get("route_long_name") or "?") for r in rows(zf, "routes.txt")}
    trips  = {t["trip_id"]: t for t in rows(zf, "trips.txt")}
    stops  = {s["stop_id"]: s for s in rows(zf, "stops.txt")}
    near = {sid: s for sid, s in stops.items()
            if s.get("stop_lat") and mi(float(s["stop_lat"]), float(s["stop_lon"])) < RADIUS_MI}

    route_list, route_idx, svc_list, svc_idx, dep = [], {}, [], {}, {}
    for st in rows(zf, "stop_times.txt"):
        sid = st["stop_id"]
        if sid not in near:
            continue
        tr = trips.get(st["trip_id"]); dt = (st.get("departure_time") or "").strip()
        if not tr or not dt:
            continue
        rn = str(routes.get(tr["route_id"], "?")); sv = tr["service_id"]
        if rn not in route_idx: route_idx[rn] = len(route_list); route_list.append(rn)
        if sv not in svc_idx: svc_idx[sv] = len(svc_list); svc_list.append(sv)
        dep.setdefault(sid, []).append([route_idx[rn], to_min(dt), svc_idx[sv]])

    stations = [{"id": s, "name": near[s]["stop_name"], "lat": round(float(near[s]["stop_lat"]), 5),
                 "lon": round(float(near[s]["stop_lon"]), 5)} for s in dep]
    svc = {c["service_id"]: {"dow": [int(c[k]) for k in ("monday","tuesday","wednesday","thursday","friday","saturday","sunday")],
                             "start": c["start_date"], "end": c["end_date"]}
           for c in rows(zf, "calendar.txt") if c["service_id"] in svc_idx}
    exc = {}
    for c in rows(zf, "calendar_dates.txt"):
        if c["service_id"] in svc_idx:
            e = exc.setdefault(c["date"], {"add": [], "rem": []})
            (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])

    out = {"generated": datetime.date.today().isoformat(),
           "note": f"Ride On GTFS trimmed {RADIUS_MI}mi of {HERE}",
           "routes": route_list, "svcList": svc_list, "stations": stations, "svc": svc, "exc": exc, "dep": dep}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(stations)} stops, {sum(len(v) for v in dep.values())} departures, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
