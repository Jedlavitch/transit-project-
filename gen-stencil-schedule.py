#!/usr/bin/env python3
"""
STENCIL generator: turn an agency's public GTFS zip into a bundled
<agency>-schedule.json the board can read with zero setup (no key, no Worker).

Use this for any system whose live feed a browser can't read (no CORS, or no
real-time feed at all): the card shows next scheduled departures at nearby
stops, and vehicles are placed on the map by interpolating each running trip
between the two stops its schedule puts it between right now.

TO USE:
  1. Set GTFS_URL to the agency's published static GTFS zip.
  2. Set OUT to the output filename.
  3. If the agency is large, set ROUTES to the handful you want (see note below);
     leave it as None to bundle the whole system (fine for small agencies).
  4. Run:  python3 gen-stencil-schedule.py
  5. Wire the resulting JSON into your board -- see ADDING-A-CITY.md.

The output shape is the SAME for every bundled system in this project, so it
plugs into the shared runtime helpers (activeServices / groupDepsByDirection /
drawScheduleRouteLines) with no changes:
  {stations:[{id,name,lat,lon}], svc:{service_id:{dow:[7],start,end}},
   exc:{date:{add:[],rem:[]}}, trips:[{line,hs,s:service_id,st:[[stop_id,dep_min],...]}]}

Real examples to copy from, closest-first:
  gen-patco-schedule.py        -- tiny single-line system, bundled whole (this file mirrors it)
  gen-marc-schedule.py         -- small multi-line system, derives line name from routes.txt
  gen-lirr-schedule.py         -- calendar_dates-only feed (no calendar.txt)
  gen-rideon-schedule.py       -- ROUTES-filtered (huge agency, only 2 routes bundled)
  gen-mta-subway-schedule.py   -- geographic bounding-box filter + a second shapes.json output
"""
import csv, io, json, os, urllib.request, zipfile, datetime

# [SETUP] the agency's published static GTFS zip:
GTFS_URL = "https://example.com/path/to/gtfs.zip"
# [SETUP] output filename (keep the <agency>-schedule.json convention):
OUT = os.path.join(os.path.dirname(__file__), "AGENCY-schedule.json")
# [SETUP] route filter. None = bundle every route (fine for small agencies).
# For a BIG agency, list the specific route_ids you want, e.g. {"M42","M15"} --
# a full-length route can be very long, so filtering keeps the file small AND
# scopes which vehicles appear. (route_id, not route_short_name -- check the
# agency's routes.txt; they're sometimes different.) See gen-rideon/-mta-bus.
ROUTES = None

# Some GTFS hosts reject Python's default urllib User-Agent -- if you get an
# HTTP 403, set this to a browser-like UA (a few agencies in this repo need it).
HEADERS = {}   # e.g. {"User-Agent": "Mozilla/5.0 (compatible; transit-board-schedule-fetch/1.0)"}


def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))


def to_min(t):
    # GTFS times can exceed 24:00 for after-midnight trips; that's fine -- the
    # runtime checks both nowMin and nowMin+1440 to catch them.
    p = t.split(":")
    return int(p[0]) * 60 + int(p[1])


def line_name(route_row):
    # What shows on the badge. Many agencies put a usable name in
    # route_short_name; some only have route_long_name. Adjust per agency.
    return (route_row.get("route_short_name")
            or route_row.get("route_long_name")
            or "").strip() or "?"


def main():
    req = urllib.request.Request(GTFS_URL, headers=HEADERS)
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=120).read()))

    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    if ROUTES is not None:
        routes = {rid: r for rid, r in routes.items() if rid in ROUTES}
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt") if t["route_id"] in routes}

    # trip_id -> [(stop_sequence, stop_id, dep_min)]
    seq = {}
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
    for tid, s in seq.items():
        s.sort()
        if len(s) < 2:
            continue
        tr = trips[tid]
        for _, sid, _ in s:
            used_stops.add(sid)
        trips_out.append({
            "line": line_name(routes.get(tr["route_id"], {})),
            "hs": (tr.get("trip_headsign") or "").strip(),
            "s": tr["service_id"],
            "st": [[sid, mins] for _, sid, mins in s],
        })

    # Only emit stations actually used by a kept trip.
    stations = []
    for s in rows(zf, "stops.txt"):
        if s["stop_id"] not in used_stops:
            continue
        try:
            stations.append({"id": s["stop_id"], "name": s["stop_name"],
                             "lat": round(float(s["stop_lat"]), 5), "lon": round(float(s["stop_lon"]), 5)})
        except (ValueError, KeyError):
            pass

    # calendar.txt -> svc (day-of-week bitmask + validity window). Some feeds have
    # NO calendar.txt (calendar_dates-only, e.g. LIRR/Metro-North) -- then svc
    # stays empty and the runtime resolves activity purely from exc, which it
    # already supports. Guard the read so a missing file doesn't crash.
    svc = {}
    if "calendar.txt" in zf.namelist():
        svc = {c["service_id"]: {"dow": [int(c[k]) for k in ("monday","tuesday","wednesday","thursday","friday","saturday","sunday")],
                                 "start": c["start_date"], "end": c["end_date"]} for c in rows(zf, "calendar.txt")}
    exc = {}
    if "calendar_dates.txt" in zf.namelist():
        for c in rows(zf, "calendar_dates.txt"):
            e = exc.setdefault(c["date"], {"add": [], "rem": []})
            (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])

    out = {"generated": datetime.date.today().isoformat(), "note": f"GTFS ({GTFS_URL})",
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT)} bytes")


if __name__ == "__main__":
    main()
