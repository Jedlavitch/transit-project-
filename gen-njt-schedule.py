#!/usr/bin/env python3
"""
Regenerate the NJ Transit rail bundles from NJT's own published GTFS.

    python3 gen-njt-schedule.py

Writes TWO files, because NJT is one agency serving both of this project's
east-coast boards but with almost no route overlap between them:

    njt-phl-schedule.json   Atlantic City Rail Line + River LINE   (Philly board)
    njt-nyc-schedule.json   the Penn Station / Hoboken lines       (NYC board)

Splitting by city rather than bundling all 17 routes twice keeps each board's
download to the routes it can actually show as "near me" -- the same scoping
logic as gen-rideon-schedule.py (routes 23/29 only) and
gen-mta-subway-schedule.py (Manhattan-ish bounding box).

WHY THIS EXISTS AT ALL (worth knowing before touching it): NJ Transit's
*developer portal* (developer.njtransit.com) gates its LIVE feeds behind a
registered account, which is why live NJT was left out of this project for a
long time. But the STATIC GTFS zips are served straight off njtransit.com with
no credentials at all -- verified, `application/zip`, no login, no key. So NJT
gets the same zero-setup treatment as MARC/SEPTA/PATCO/Ride On: a bundled
timetable, with each trip's position interpolated between the two stops its
schedule puts it between right now. No account, no Worker, nothing for a user
to configure. If someone later wants EXACT live NJT positions, that's the only
part that needs the registered API.

Feed shape notes (differ from most of the other agencies here):
  * calendar_dates.txt ONLY -- there is no calendar.txt. So `svc` is written
    empty and every operating day lands in `exc[date].add`. The runtime's
    marcActiveServices() already handles this (it iterates svc, which is empty,
    then applies the exc add/remove lists), same as the PATH bundle.
  * Only ~24 distinct service ids, so this does NOT hit the near-duplicate-trip
    explosion that made the Metro-North bundle 7.7MB.
  * departure_time runs past 24h (up to 27:xx for after-midnight trips); raw
    minutes are kept as-is and the runtime's nowMin+1440 check catches them.
  * stops.txt is flat -- no parent_station -- so no platform consolidation is
    needed (unlike the subway/PATH bundles).
  * shapes.txt is 30MB and is deliberately NOT parsed: route lines are drawn by
    the boards' existing drawScheduleRouteLines() helper from each line's own
    stop sequence, exactly like MARC/SEPTA/PATCO.
"""
import csv, io, json, os, urllib.request, zipfile, datetime

GTFS_URL = "https://www.njtransit.com/rail_data.zip"
HERE = os.path.dirname(os.path.abspath(__file__))

# route_short_name -> which board wants it.
PHL_ROUTES = {"ATLC", "RVLN"}                       # Atlantic City Line, River LINE (Camden-Trenton)
NYC_ROUTES = {"NEC", "NJCL", "NJCLL",               # Northeast Corridor, North Jersey Coast
              "MNE", "MNEG",                        # Morris & Essex, Gladstone Branch
              "MNBN", "MNBNP",                      # Main/Bergen, Port Jervis
              "BNTN", "BNTNM",                      # Montclair-Boonton
              "PASC", "RARV",                       # Pascack Valley, Raritan Valley
              "HBLR", "NLR", "MRL"}                 # Hudson-Bergen LR, Newark LR, Meadowlands
# PRIN (Princeton "Dinky" shuttle) is left out of both: it's two stops, far from
# either board's centre, and would only ever show as a distant curiosity.

OUTPUTS = [("njt-phl-schedule.json", PHL_ROUTES, "Philadelphia-area"),
           ("njt-nyc-schedule.json", NYC_ROUTES, "New York-area")]


def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))


def to_min(t):
    p = t.strip().split(":")
    return int(p[0]) * 60 + int(p[1])


def main():
    req = urllib.request.Request(GTFS_URL, headers={
        # njtransit.com rejects urllib's default UA (same workaround the Ride On
        # and PATCO generators need for their hosts)
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"})
    print(f"Downloading {GTFS_URL} …")
    with urllib.request.urlopen(req, timeout=300) as r:
        blob = r.read()
    print(f"  {len(blob):,} bytes")
    zf = zipfile.ZipFile(io.BytesIO(blob))

    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    stops = {s["stop_id"]: s for s in rows(zf, "stops.txt")}
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt")}

    # calendar_dates-only: no weekly pattern to express, so svc stays empty and
    # each operating date carries its own service ids.
    exc = {}
    for c in rows(zf, "calendar_dates.txt"):
        e = exc.setdefault(c["date"], {"add": [], "rem": []})
        (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])
    dates = sorted(exc)
    today = datetime.date.today().strftime("%Y%m%d")
    if dates and not (dates[0] <= today <= dates[-1]):
        print(f"  !! WARNING: feed covers {dates[0]}-{dates[-1]} but today is {today}. "
              f"Cards/map will be EMPTY -- NJT has published a new zip; re-run this script.")

    # one pass over the big stop_times file, bucketed per trip
    by_trip = {}
    with zf.open("stop_times.txt") as fh:
        for r in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            t = (r.get("departure_time") or r.get("arrival_time") or "").strip()
            if not t:
                continue
            by_trip.setdefault(r["trip_id"], []).append(
                (int(r["stop_sequence"]), r["stop_id"], to_min(t)))

    for fname, wanted, label in OUTPUTS:
        keep_rid = {rid for rid, r in routes.items()
                    if (r.get("route_short_name") or "").strip() in wanted}
        trips_out, used = [], set()
        for tid, seq in by_trip.items():
            tr = trips.get(tid)
            if not tr or tr["route_id"] not in keep_rid:
                continue
            seq = sorted(seq)
            if len(seq) < 2:
                continue
            for _, sid, _ in seq:
                used.add(sid)
            trips_out.append({
                "line": (routes[tr["route_id"]].get("route_short_name") or "").strip(),
                "hs": (tr.get("trip_headsign") or "").strip(),
                "s": tr["service_id"],
                "st": [[sid, m] for _, sid, m in seq],
            })

        stations = [{"id": sid, "name": stops[sid]["stop_name"].strip(),
                     "lat": float(stops[sid]["stop_lat"]), "lon": float(stops[sid]["stop_lon"])}
                    for sid in sorted(used) if sid in stops]

        out = {"generated": datetime.date.today().isoformat(),
               "note": f"NJ Transit rail GTFS ({GTFS_URL}) — {label} routes",
               "stations": stations, "svc": {}, "exc": exc, "trips": trips_out}
        path = os.path.join(HERE, fname)
        with open(path, "w") as fh:
            json.dump(out, fh, separators=(",", ":"))
        lines = sorted({t["line"] for t in trips_out})
        print(f"Wrote {fname}: {len(trips_out)} trips, {len(stations)} stations, "
              f"{os.path.getsize(path):,} bytes — lines: {', '.join(lines)}")


if __name__ == "__main__":
    main()
