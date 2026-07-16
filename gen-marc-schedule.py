#!/usr/bin/env python3
"""
Regenerate marc-schedule.json from MARC's published GTFS.

The board reads this bundled file for the MARC card (next scheduled trains) AND
to place MARC trains on the map (each train's position is interpolated between
stations from its scheduled times) — no API key, no Worker, no proxy.

Re-run whenever MARC changes its timetable:  python3 gen-marc-schedule.py
"""
import csv, io, json, os, urllib.request, zipfile, datetime

GTFS_URL = "https://feeds.mta.maryland.gov/gtfs/marc"
OUT = os.path.join(os.path.dirname(__file__), "marc-schedule.json")

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def line_of(long_name):
    return long_name.split(" - ")[0].split("-")[0].strip().title()

def to_min(t):
    p = t.split(":"); return int(p[0]) * 60 + int(p[1])

def main():
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(GTFS_URL, timeout=60).read()))
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
        d = seq.setdefault(st["trip_id"], {"line": line_of(routes.get(tr["route_id"], {}).get("route_long_name", "MARC")),
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

    out = {"generated": datetime.date.today().isoformat(), "note": f"MARC GTFS ({GTFS_URL})",
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
