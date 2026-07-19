#!/usr/bin/env python3
"""
Regenerate mnr-schedule.json from Metro-North's published GTFS.

Same rationale as gen-lirr-schedule.py: Metro-North's live GTFS-Realtime feed
is directly fetchable from the browser (CORS-open, no key -- confirmed via
curl), so this bundle is a fallback/labeling reference, not the primary data
source. Metro-North's system is small by station count (6 branches, 114
stations) but its GTFS carries many near-duplicate trips across ~260 distinct
service-day patterns (holiday/exception variants, no shared weekday/weekend
calendar.txt -- same calendar_dates-only structure as LIRR), so the bundle
ends up larger than a station count this size would suggest. Still bundled
whole rather than deduplicated: every other system in this project shares
one flat {line,hs,s,st} trip schema with a single scalar service_id per
trip, and de-duplicating by merging service_id lists would mean diverging
that shared shape just for this one system.

Re-run whenever Metro-North changes its timetable: python3 gen-mnr-schedule.py
"""
import csv, io, json, os, urllib.request, zipfile, datetime

GTFS_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfsmnr.zip"
OUT = os.path.join(os.path.dirname(__file__), "mnr-schedule.json")

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def to_min(t):
    p = t.split(":"); return int(p[0]) * 60 + int(p[1])

def main():
    zf = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(GTFS_URL, timeout=60).read()))
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    trips  = {t["trip_id"]: t for t in rows(zf, "trips.txt")}

    stations = []
    for s in rows(zf, "stops.txt"):
        if s.get("location_type") not in ("", "0"):
            continue   # skip any non-station location_type (parent/entrance rows, if present)
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
        d = seq.setdefault(st["trip_id"], {"line": routes.get(tr["route_id"], {}).get("route_long_name") or "MNR",
                                           "hs": (tr.get("trip_headsign") or "").strip(), "s": tr["service_id"], "seq": []})
        d["seq"].append((int(st["stop_sequence"]), st["stop_id"], to_min(dt)))
    trips_out = []
    for d in seq.values():
        d["seq"].sort()
        if len(d["seq"]) < 2:
            continue
        trips_out.append({"line": d["line"], "hs": d["hs"], "s": d["s"],
                          "st": [[x[1], x[2]] for x in d["seq"]]})

    # Same calendar_dates-only structure as LIRR (no calendar.txt) -- svc
    # stays empty, marcActiveServices() resolves purely from exc.
    svc = {}
    exc = {}
    for c in rows(zf, "calendar_dates.txt"):
        e = exc.setdefault(c["date"], {"add": [], "rem": []})
        (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])

    # train number (trip_short_name) -> line name, for the LIVE card. Metro-North's
    # GTFS-Realtime feed carries NO route_id at all (neither VehiclePosition nor a
    # matching TripUpdate) -- the only line identifier is its `trip_id`, which is
    # actually the rider-facing train NUMBER (matches the static feed's
    # trip_short_name, NOT its trip_id). So the board resolves e.g. "6300" ->
    # "New Haven" through this map. ~1400 distinct numbers, no conflicts, ~25KB.
    trip_lines = {}
    for t in trips.values():
        tsn = (t.get("trip_short_name") or "").strip()
        if not tsn:
            continue
        trip_lines[tsn] = routes.get(t["route_id"], {}).get("route_long_name") or "Metro-North"

    out = {"generated": datetime.date.today().isoformat(), "note": f"Metro-North GTFS ({GTFS_URL})",
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out, "tripLines": trip_lines}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
