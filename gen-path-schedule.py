#!/usr/bin/env python3
"""
Regenerate path-schedule.json from PATH's published GTFS (mirrored via
Trillium Transit -- PANYNJ doesn't self-host a static GTFS zip at a stable
URL, same situation gen-patco-schedule.py already had to work around for
PATCO via National RTAP).

PATH's own live data (panynj.gov/bin/portauthority/ridepath.json) is
STATION-based next-arrival countdowns, not vehicle GPS/positions -- there's
no live "where is this train right now" concept to place a moving dot with,
unlike subway/LIRR/Metro-North/MTA Bus. So this bundle is NOT just a
fallback here: it's what powers scheduled positions on the map (interpolated
between stops, same technique as MARC/Ride On/PATCO) at all times, live or
not. The optional path-worker.js Worker (see that file) only upgrades the
DEPARTURES CARD to real live countdowns -- the map keeps using this bundled
schedule's interpolation regardless, since PATH's live feed has nothing
better to offer a map.

PATH's GTFS has the same platform/parent-station split as the subway (child
stops with a parent_station pointing to one of the 13 real stations) -- same
consolidation technique as gen-mta-subway-schedule.py, just without the
geographic bounding-box filter (PATH's whole system is small enough to
bundle whole, like PATCO).

Re-run whenever PATH changes its timetable: python3 gen-path-schedule.py
"""
import csv, io, json, os, urllib.request, zipfile, datetime

GTFS_URL = "http://data.trilliumtransit.com/gtfs/path-nj-us/path-nj-us.zip"
OUT = os.path.join(os.path.dirname(__file__), "path-schedule.json")

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def to_min(t):
    p = t.split(":"); return int(p[0]) * 60 + int(p[1])

def main():
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "Mozilla/5.0 (compatible; transit-board-schedule-fetch/1.0)"})
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=60).read()))

    all_stops = rows(zf, "stops.txt")
    parent_of, parent_coord = {}, {}
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
    for s in all_stops:
        pid = parent_of.get(s["stop_id"])
        if pid and pid not in parent_coord:
            try:
                parent_coord[pid] = (round(float(s["stop_lat"]), 5), round(float(s["stop_lon"]), 5))
            except (ValueError, KeyError):
                pass

    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt")}

    seq = {}  # trip_id -> [(stop_seq, parent_stop_id, dep_min)]
    with zf.open("stop_times.txt") as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            tid = row["trip_id"]
            if tid not in trips:
                continue
            pid = parent_of.get(row["stop_id"])
            if not pid or pid not in parent_coord:
                continue
            dt = (row.get("departure_time") or "").strip()
            if not dt:
                continue
            seq.setdefault(tid, []).append((int(row["stop_sequence"]), pid, to_min(dt)))

    trips_out, used_stations = [], set()
    for tid, s in seq.items():
        s.sort()
        if len(s) < 2:
            continue
        tr = trips[tid]
        for _, pid, _ in s:
            used_stations.add(pid)
        trips_out.append({
            "line": routes.get(tr["route_id"], {}).get("route_long_name", "PATH"),
            "hs": (tr.get("trip_headsign") or "").strip(),
            "s": tr["service_id"],
            "st": [[pid, mins] for _, pid, mins in s],
        })

    stations = []
    for s in all_stops:
        if s.get("location_type") == "1" and s["stop_id"] in used_stations:
            stations.append({"id": s["stop_id"], "name": s["stop_name"],
                              "lat": parent_coord[s["stop_id"]][0], "lon": parent_coord[s["stop_id"]][1]})

    # Trillium's mirror is a snapshot with a stated end_date that goes stale
    # (observed expired entirely as of this run -- every service's end_date
    # had already passed, so the runtime's date-range check found ZERO
    # active services on any given day, a broken card/map for real, current
    # PATH service). PATH runs a stable "Year Round" pattern with no
    # seasonal variation, so the day-of-week pattern itself stays accurate
    # long after the mirror's administrative validity window lapses -- only
    # extend end_date (never start_date, which still matters if a service
    # hasn't started yet) far into the future so day-of-week is what
    # actually decides activity, same as it would if the mirror were fresh.
    FAR_FUTURE_END = "20991231"
    svc = {c["service_id"]: {"dow": [int(c[k]) for k in ("monday","tuesday","wednesday","thursday","friday","saturday","sunday")],
                             "start": c["start_date"], "end": FAR_FUTURE_END} for c in rows(zf, "calendar.txt")}
    exc = {}
    for c in rows(zf, "calendar_dates.txt"):
        e = exc.setdefault(c["date"], {"add": [], "rem": []})
        (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])

    out = {"generated": datetime.date.today().isoformat(), "note": f"PATH GTFS ({GTFS_URL})",
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
