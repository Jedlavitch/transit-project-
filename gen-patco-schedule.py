#!/usr/bin/env python3
"""
Regenerate patco-schedule.json from PATCO's published GTFS.

PATCO (the Philadelphia<->Camden, NJ high-speed line, run by the Delaware
River Port Authority) publishes no real-time API at all -- not even a
CORS-blocked one like MARC/SEPTA. It's also tiny (one line, 14 stations), so
this bundles the whole system: the card shows next scheduled trains at
nearby stations, and trains are placed on the map by interpolating each
running trip's position between stations.

PATCO doesn't self-host its GTFS; it's mirrored via National RTAP's transit
data hosting.

Re-run whenever PATCO changes its timetable:  python3 gen-patco-schedule.py
"""
import csv, io, json, os, urllib.request, zipfile, datetime

GTFS_URL = "https://rapid.nationalrtap.org/GTFSFileManagement/UserUploadFiles/13562/PATCO_GTFS.zip"
OUT = os.path.join(os.path.dirname(__file__), "patco-schedule.json")

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def to_min(t):
    p = t.split(":"); return int(p[0]) * 60 + int(p[1])

def main():
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "Mozilla/5.0 (compatible; transit-board-schedule-fetch/1.0)"})
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=60).read()))
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt")}

    seq = {}  # trip_id -> [(stop_seq, stop_id, dep_min)]
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
    for tid, t in trips.items():
        s = sorted(seq.get(tid, []))
        if len(s) < 2:
            continue
        for _, sid, _ in s:
            used_stops.add(sid)
        trips_out.append({
            "line": "PATCO",
            "hs": (t.get("trip_headsign") or "").strip(),
            "s": t["service_id"],
            "st": [[sid, mins] for _, sid, mins in s],
        })

    stations = []
    for s in rows(zf, "stops.txt"):
        if s["stop_id"] not in used_stops:
            continue
        try:
            stations.append({"id": s["stop_id"], "name": s["stop_name"],
                             "lat": round(float(s["stop_lat"]), 5), "lon": round(float(s["stop_lon"]), 5)})
        except (ValueError, KeyError):
            pass

    svc = {c["service_id"]: {"dow": [int(c[k]) for k in ("monday","tuesday","wednesday","thursday","friday","saturday","sunday")],
                             "start": c["start_date"], "end": c["end_date"]} for c in rows(zf, "calendar.txt")}
    exc = {}
    for c in rows(zf, "calendar_dates.txt"):
        e = exc.setdefault(c["date"], {"add": [], "rem": []})
        (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])

    out = {"generated": datetime.date.today().isoformat(), "note": f"PATCO GTFS ({GTFS_URL})",
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
