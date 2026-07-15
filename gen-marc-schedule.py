#!/usr/bin/env python3
"""
Regenerate marc-schedule.json from MARC's published GTFS.

The board's MARC card reads this bundled file, so it needs no API key, no
Cloudflare Worker, and no proxy. Re-run this whenever MARC changes its
timetable (a few times a year):

    python3 gen-marc-schedule.py

Output: marc-schedule.json (compact) next to this script.
"""
import csv, io, json, os, urllib.request, zipfile, datetime

GTFS_URL = "https://feeds.mta.maryland.gov/gtfs/marc"
OUT = os.path.join(os.path.dirname(__file__), "marc-schedule.json")

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def line_of(long_name):
    return long_name.split(" - ")[0].split("-")[0].strip().title()

def main():
    data = urllib.request.urlopen(GTFS_URL, timeout=60).read()
    zf = zipfile.ZipFile(io.BytesIO(data))
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    trips  = {t["trip_id"]: t for t in rows(zf, "trips.txt")}

    stations = []
    for s in rows(zf, "stops.txt"):
        try:
            stations.append({"id": s["stop_id"], "name": s["stop_name"],
                             "lat": round(float(s["stop_lat"]), 5),
                             "lon": round(float(s["stop_lon"]), 5)})
        except (ValueError, KeyError):
            pass

    dep = {}
    for st in rows(zf, "stop_times.txt"):
        tr = trips.get(st["trip_id"])
        dt = (st.get("departure_time") or "").strip()
        if not tr or not dt or st.get("pickup_type", "0") == "1":
            continue
        dep.setdefault(st["stop_id"], []).append({
            "t": ":".join(dt.split(":")[:2]),
            "line": line_of(routes.get(tr["route_id"], {}).get("route_long_name", "MARC")),
            "hs": (tr.get("trip_headsign") or "").strip(),
            "s": tr["service_id"]})

    svc = {}
    for c in rows(zf, "calendar.txt"):
        svc[c["service_id"]] = {
            "dow": [int(c[d]) for d in ("monday","tuesday","wednesday","thursday","friday","saturday","sunday")],
            "start": c["start_date"], "end": c["end_date"]}

    exc = {}
    for c in rows(zf, "calendar_dates.txt"):
        e = exc.setdefault(c["date"], {"add": [], "rem": []})
        (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])

    out = {"generated": datetime.date.today().isoformat(),
           "note": f"MARC GTFS schedule ({GTFS_URL})",
           "stations": stations, "svc": svc, "exc": exc, "dep": dep}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(stations)} stations, {len(svc)} services, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
