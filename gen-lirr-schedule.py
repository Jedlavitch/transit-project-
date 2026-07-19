#!/usr/bin/env python3
"""
Regenerate lirr-schedule.json from LIRR's published GTFS.

Unlike MARC/SEPTA (which needed a Cloudflare Worker just for CORS), LIRR's
live GTFS-Realtime feed is directly fetchable from the browser (CORS-open, no
key -- confirmed via curl) so this bundle is a fallback/labeling reference,
not the primary data source: it powers the departures card when the live
feed is unreachable and supplies station coordinates for the route line. The
live map/card itself is driven by nyc.html's client-side GTFS-Realtime
decoder (shared with the subway).

LIRR's system is small (13 branches, 127 stations, ~2600 trips) so it's
bundled whole, same as MARC -- no geographic filtering needed (unlike the
subway, which spans the whole city and had to be scoped to a box).

Re-run whenever LIRR changes its timetable: python3 gen-lirr-schedule.py
"""
import csv, io, json, os, urllib.request, zipfile, datetime

GTFS_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfslirr.zip"
OUT = os.path.join(os.path.dirname(__file__), "lirr-schedule.json")

def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

def line_of(long_name):
    # "Babylon Branch" -> "Babylon", "City Terminal Zone" -> "City Terminal Zone" (no suffix to strip)
    return (long_name or "LIRR").replace(" Branch", "").strip()

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
        d = seq.setdefault(st["trip_id"], {"line": line_of(routes.get(tr["route_id"], {}).get("route_long_name")),
                                           "hs": (tr.get("trip_headsign") or "").strip(), "s": tr["service_id"], "seq": []})
        d["seq"].append((int(st["stop_sequence"]), st["stop_id"], to_min(dt)))
    trips_out = []
    for d in seq.values():
        d["seq"].sort()
        if len(d["seq"]) < 2:
            continue
        trips_out.append({"line": d["line"], "hs": d["hs"], "s": d["s"],
                          "st": [[x[1], x[2]] for x in d["seq"]]})

    # LIRR's GTFS has no calendar.txt, only calendar_dates.txt -- every active
    # service_id for a given date is listed explicitly (exception_type=1), so
    # svc stays empty and marcActiveServices() resolves purely from exc, which
    # it already supports (base calendar match is a no-op, then exceptions
    # apply) -- same runtime helper every other bundled system already uses.
    svc = {}
    exc = {}
    for c in rows(zf, "calendar_dates.txt"):
        e = exc.setdefault(c["date"], {"add": [], "rem": []})
        (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])

    # route_id -> branch name, for the LIVE card: LIRR's GTFS-Realtime feed
    # reports a numeric route_id (e.g. "10") but no branch name, so the board
    # resolves "10" -> "Port Jefferson" through this map. Same stripped names
    # the trips above use (line_of()).
    route_names = {rid: line_of(r.get("route_long_name")) for rid, r in routes.items()}

    out = {"generated": datetime.date.today().isoformat(), "note": f"LIRR GTFS ({GTFS_URL})",
           "stations": stations, "svc": svc, "exc": exc, "trips": trips_out, "routes": route_names}
    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {OUT}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(OUT)} bytes")

if __name__ == "__main__":
    main()
