#!/usr/bin/env python3
"""
Rome's metro as a bundled timetable: rome-metro-schedule.json.

ATAC publishes no live data for the metro, so this is the only way to know where
every train should be. Bundled rather than looked up because the alternatives
cost a free public API far too much: Transitous's /map/trips answers with about
1.5 MB of gzip per poll for this city, nearly all of it buses.

Same output shape as every other bundle here (see gen-stencil-schedule.py). The
feed is calendar_dates-only, so `svc` stays empty and service lives in `exc`.
Its calendar runs only a few weeks ahead: refresh-schedules.py keeps it current.

    python3 gen-rome-metro-schedule.py
"""
import csv, io, json, os, re, urllib.request, zipfile

GTFS_URL = "https://romamobilita.it/sites/default/files/rome_static_gtfs.zip"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rome-metro-schedule.json")
ROUTES = {"MEA": "A", "MEB": "B", "MEB1": "B1", "MEC": "C"}
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; transit-board-schedule-fetch/1.0)"}


def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))


def to_min(t):
    h, m = t.split(":")[:2]   # GTFS hours run past 24 for after-midnight trains
    return int(h) * 60 + int(m)


def headsign(s):
    # "ANAGNINA (MA)" -> "Anagnina": the bracket only names the line it is already on
    return re.sub(r"\s*\([^)]*\)", "", s or "").strip().title()


def main():
    req = urllib.request.Request(GTFS_URL, headers=HEADERS)
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=300).read()))
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt") if t["route_id"] in ROUTES}

    seq = {}
    with zf.open("stop_times.txt") as fh:
        for r in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            if r["trip_id"] in trips and (r.get("departure_time") or "").strip():
                seq.setdefault(r["trip_id"], []).append(
                    (int(r["stop_sequence"]), r["stop_id"], to_min(r["departure_time"])))

    out, used = [], set()
    for tid, s in seq.items():
        if len(s) < 2:
            continue
        s.sort()
        t = trips[tid]
        used.update(x[1] for x in s)
        out.append({"line": ROUTES[t["route_id"]], "hs": headsign(t.get("trip_headsign")),
                    "s": t["service_id"], "st": [[x[1], x[2]] for x in s]})

    stations = [{"id": s["stop_id"], "name": s["stop_name"],
                 "lat": round(float(s["stop_lat"]), 5), "lon": round(float(s["stop_lon"]), 5)}
                for s in rows(zf, "stops.txt") if s["stop_id"] in used]

    services = {t["s"] for t in out}
    exc = {}
    for d in rows(zf, "calendar_dates.txt"):
        if d["service_id"] in services:
            key = "add" if d["exception_type"] == "1" else "rem"
            exc.setdefault(d["date"], {}).setdefault(key, []).append(d["service_id"])

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"stations": stations, "svc": {}, "exc": exc, "trips": out}, f,
                  ensure_ascii=False, separators=(",", ":"))
    print(f"{OUT}: {len(out)} trips, {len(stations)} stops, {len(exc)} service days, "
          f"{os.path.getsize(OUT) // 1024} KB")


if __name__ == "__main__":
    main()
