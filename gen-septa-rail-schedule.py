#!/usr/bin/env python3
"""
Regenerate septa-rail-schedule.json from SEPTA's published Regional Rail GTFS.

Same technique as MARC: SEPTA's live APIs (TrainView/TransitView) have real
data but NO CORS headers, so a browser can't call them directly. Regional
Rail's own GTFS is small (157 stations, ~1400 trips) so — like MARC — it's
bundled whole: the board shows next-scheduled trains at nearby stations AND
places trains on the map by interpolating each running trip's position
between stations. No API key, no Worker, no proxy.

SEPTA's public GTFS zip is a zip-of-zips: google_bus.zip (~20MB, the whole
bus/trolley network — too big to bundle, not filtered here since routes
aren't known yet) and google_rail.zip (~650KB, all 13 Regional Rail lines —
small enough to bundle whole).

Re-run whenever SEPTA changes its Regional Rail timetable:
    python3 gen-septa-rail-schedule.py
"""
import csv, io, json, os, urllib.request, zipfile, datetime

GTFS_URL = "https://www3.septa.org/developer/gtfs_public.zip"
OUT = os.path.join(os.path.dirname(__file__), "septa-rail-schedule.json")

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def to_min(t):
    p = t.split(":"); return int(p[0]) * 60 + int(p[1])

def main():
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "Mozilla/5.0 (compatible; transit-board-schedule-fetch/1.0)"})
    outer = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=120).read()))
    zf = zipfile.ZipFile(io.BytesIO(outer.read("google_rail.zip")))  # rail-only, small

    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    trips  = {t["trip_id"]: t for t in rows(zf, "trips.txt")}

    stations = []
    for s in rows(zf, "stops.txt"):
        try:
            stations.append({"id": s["stop_id"], "name": s["stop_name"],
                             "lat": round(float(s["stop_lat"]), 5), "lon": round(float(s["stop_lon"]), 5)})
        except (ValueError, KeyError):
            pass

    seq = {}  # trip_id -> {line, hs, s, seq:[(stop_seq, stop_id, dep_min)]}
    for st in rows(zf, "stop_times.txt"):
        tr = trips.get(st["trip_id"]); dt = (st.get("departure_time") or "").strip()
        if not tr or not dt:
            continue
        d = seq.setdefault(st["trip_id"], {"line": (routes.get(tr["route_id"], {}).get("route_short_name") or "?").strip(),
                                           "hs": (tr.get("trip_headsign") or "").strip(), "s": tr["service_id"], "seq": []})
        d["seq"].append((int(st["stop_sequence"]), st["stop_id"], to_min(dt)))
    trips_out = []
    for d in seq.values():
        d["seq"].sort()
        trips_out.append({"line": d["line"], "hs": d["hs"], "s": d["s"],
                          "st": [[x[1], x[2]] for x in d["seq"]]})

    svc = {c["service_id"]: {"dow": [int(c[k]) for k in ("monday","tuesday","wednesday","thursday","friday","saturday","sunday")],
                             "start": c["start_date"], "end": c["end_date"]} for c in rows(zf, "calendar.txt")}
    exc = {}
    for c in rows(zf, "calendar_dates.txt"):
        e = exc.setdefault(c["date"], {"add": [], "rem": []})
        (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])

    out = {"generated": datetime.date.today().isoformat(), "note": f"SEPTA Regional Rail GTFS ({GTFS_URL})",
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
