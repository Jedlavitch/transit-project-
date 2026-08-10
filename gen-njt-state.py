#!/usr/bin/env python3
"""
Bundles for the statewide New Jersey board (newjersey.html).

    python3 gen-njt-state.py

Writes:
    njt-state-rail-schedule.json   ALL 17 NJT rail + light-rail routes, statewide
    njt-state-bus-schedule.json    the bus routes serving the board's area

WHY THE BUS BUNDLE IS PARTIAL (read before "fixing" it):
NJT rail is small enough to bundle whole -- 4,754 trips across every line in the
state. Buses are not: 263 routes / 33,536 trips, with stop_times.txt alone at
78MB. Bundling all of them is a wrong-tool problem, not a tuning one, so the
statewide bus card is LIVE-FIRST -- with a BusTime key configured (see
njt-worker.js) every one of the 263 routes shows real vehicles.

What this bundle does give you with zero setup is the 30 routes that actually
run near the board, using two tricks that together buy ~4x the coverage of the
first version for the same download:

  * routes are ranked by service NEAR THE BOARD, not statewide -- counting trips
    statewide picked Atlantic City routes while missing buses passing Newark
    every few minutes;
  * stop patterns and running-time profiles are DEDUPLICATED. Bus trips repeat
    heavily (2,807 trips shared just 106 stop sequences), so storing each
    sequence once and referencing it by index cuts the file by ~78%: 30 routes
    now cost 1.8MB where 7 routes used to cost 1.6MB.

That produces a "v":2 bundle with `pats` / `offs` / compact `trips`. Consumers
call expandBundle() on load to turn it back into the plain
{line, hs, s, st:[[stop,min]...]} shape every other schedule uses, so nothing
downstream needed to change.

Feed quirks (same as gen-njt-schedule.py, which does the NYC/Philly slices):
calendar_dates.txt only (no calendar.txt) so `svc` is empty and every operating
day lands in `exc`; times run past 24h for after-midnight trips; flat stops;
shapes.txt deliberately never parsed (route lines come from the boards'
drawScheduleRouteLines()).
"""
import csv, io, json, math, os, urllib.request, zipfile, datetime, collections

RAIL_URL = "https://www.njtransit.com/rail_data.zip"
BUS_URL = "https://www.njtransit.com/bus_data.zip"
HERE = os.path.dirname(os.path.abspath(__file__))
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"}


def fetch(url):
    print(f"Downloading {url} …")
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=600) as r:
        blob = r.read()
    print(f"  {len(blob):,} bytes")
    return zipfile.ZipFile(io.BytesIO(blob))


def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))


def to_min(t):
    p = t.strip().split(":")
    return int(p[0]) * 60 + int(p[1])


def read_exc(zf):
    exc = {}
    for c in rows(zf, "calendar_dates.txt"):
        e = exc.setdefault(c["date"], {"add": [], "rem": []})
        (e["add"] if c["exception_type"] == "1" else e["rem"]).append(c["service_id"])
    return exc


def stop_times_by_trip(zf):
    out = {}
    with zf.open("stop_times.txt") as fh:
        for r in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            t = (r.get("departure_time") or r.get("arrival_time") or "").strip()
            if not t:
                continue
            out.setdefault(r["trip_id"], []).append((int(r["stop_sequence"]), r["stop_id"], to_min(t)))
    return out


def write(fname, stations, exc, trips_out, note):
    out = {"generated": datetime.date.today().isoformat(), "note": note,
           "stations": stations, "svc": {}, "exc": exc, "trips": trips_out}
    path = os.path.join(HERE, fname)
    with open(path, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"Wrote {fname}: {len(trips_out)} trips, {len(stations)} stations, {os.path.getsize(path):,} bytes")


def build(zf, keep_route_ids, routes, label):
    """-> (trips_out, used_stop_ids) for the given route ids"""
    by_trip = stop_times_by_trip(zf)
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt")}
    trips_out, used = [], set()
    for tid, seq in by_trip.items():
        tr = trips.get(tid)
        if not tr or tr["route_id"] not in keep_route_ids:
            continue
        seq = sorted(seq)
        if len(seq) < 2:
            continue
        for _, sid, _ in seq:
            used.add(sid)
        trips_out.append({"line": (routes[tr["route_id"]].get("route_short_name") or "").strip(),
                          "hs": (tr.get("trip_headsign") or "").strip(),
                          "s": tr["service_id"],
                          "st": [[sid, m] for _, sid, m in seq]})
    return trips_out, used


def stations_for(zf, used):
    stops = {s["stop_id"]: s for s in rows(zf, "stops.txt")}
    return [{"id": sid, "name": stops[sid]["stop_name"].strip(),
             "lat": float(stops[sid]["stop_lat"]), "lon": float(stops[sid]["stop_lon"])}
            for sid in sorted(used) if sid in stops]


def main():
    # ---------------- rail: everything, statewide ----------------
    zf = fetch(RAIL_URL)
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    trips_out, used = build(zf, set(routes), routes, "all rail")
    write("njt-state-rail-schedule.json", stations_for(zf, used), read_exc(zf), trips_out,
          f"NJ Transit ALL rail + light rail, statewide ({RAIL_URL})")

    # ---------------- bus: routes that actually serve the board's area -------
    # Two changes that together buy 4x the coverage for the same download:
    #
    # 1. PICK BY LOCAL RELEVANCE, not statewide trip count. Counting trips
    #    statewide chose Atlantic City routes while missing buses that pass
    #    Newark every few minutes. Routes are now ranked by how much service
    #    they run near the board's home area.
    #
    # 2. DEDUPLICATE STOP PATTERNS. Bus trips repeat: 2,807 trips shared just
    #    106 distinct stop sequences, so every stop list was stored ~26 times.
    #    Storing each pattern once, plus each running-time profile once, and
    #    referencing them by index, shrinks the bundle by ~78%. Consumers expand
    #    it back to the plain shape on load (see expandBundle in the boards), so
    #    nothing downstream had to change.
    HOME = (40.7346, -74.1643)      # Newark Penn Station: the NJ board's default
    NEAR_MI, KEEP_MI, ROUTES_N = 6, 25, 30

    def miles(a, b):
        R = 3958.8
        dla, dlo = math.radians(b[0] - a[0]), math.radians(b[1] - a[1])
        h = (math.sin(dla / 2) ** 2 +
             math.cos(math.radians(a[0])) * math.cos(math.radians(b[0])) * math.sin(dlo / 2) ** 2)
        return 2 * R * math.asin(math.sqrt(h))

    zf = fetch(BUS_URL)
    routes = {r["route_id"]: (r.get("route_short_name") or "").strip() for r in rows(zf, "routes.txt")}
    stops = {s["stop_id"]: s for s in rows(zf, "stops.txt")}
    coord = {k: (float(v["stop_lat"]), float(v["stop_lon"])) for k, v in stops.items()}
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt")}
    near = {sid for sid, ll in coord.items() if miles(HOME, ll) <= NEAR_MI}

    hits, seqs = collections.Counter(), collections.defaultdict(list)
    with zf.open("stop_times.txt") as fh:
        for r in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            t = (r.get("departure_time") or r.get("arrival_time") or "").strip()
            if not t:
                continue
            seqs[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], to_min(t)))
            if r["stop_id"] in near:
                rid = trips.get(r["trip_id"], {}).get("route_id")
                if rid:
                    hits[rid] += 1

    keep = {rid for rid, _ in hits.most_common(ROUTES_N)}
    pats, offs, out, used = {}, {}, [], set()
    for tid, s in seqs.items():
        tr = trips.get(tid)
        if not tr or tr["route_id"] not in keep:
            continue
        s = sorted(s)
        # a bus 60 miles away is never shown, and those tails are most of the bytes
        s = [x for x in s if x[1] in coord and miles(HOME, coord[x[1]]) <= KEEP_MI]
        if len(s) < 2:
            continue
        ids = tuple(x[1] for x in s)
        times = [x[2] for x in s]
        prof = tuple(m - times[0] for m in times)
        pi = pats.setdefault(ids, len(pats))
        oi = offs.setdefault(prof, len(offs))
        used.update(ids)
        out.append({"l": routes.get(tr["route_id"], ""), "h": (tr.get("trip_headsign") or "").strip(),
                    "s": tr["service_id"], "p": pi, "o": oi, "t": times[0]})

    stations = [{"id": sid, "name": stops[sid]["stop_name"].strip(),
                 "lat": round(coord[sid][0], 5), "lon": round(coord[sid][1], 5)}
                for sid in sorted(used)]
    doc = {"v": 2, "generated": datetime.date.today().isoformat(),
           "note": f"NJ Transit bus — {len(keep)} routes serving within {NEAR_MI} mi of Newark, "
                   f"stops trimmed to {KEEP_MI} mi; pattern-deduplicated (see gen-njt-state.py). "
                   f"All 263 routes need the live BusTime feed ({BUS_URL})",
           "stations": stations, "svc": {}, "exc": read_exc(zf),
           "pats": [list(k) for k, _ in sorted(pats.items(), key=lambda kv: kv[1])],
           "offs": [list(k) for k, _ in sorted(offs.items(), key=lambda kv: kv[1])],
           "trips": out}
    path = os.path.join(HERE, "njt-state-bus-schedule.json")
    with open(path, "w") as fh:
        json.dump(doc, fh, separators=(",", ":"))
    lines = sorted({t["l"] for t in out})
    print(f"Wrote njt-state-bus-schedule.json: {len(out)} trips, {len(stations)} stations, "
          f"{len(pats)} patterns, {len(offs)} time profiles, {os.path.getsize(path):,} bytes")
    print(f"  routes ({len(lines)}): {', '.join(lines)}")


if __name__ == "__main__":
    main()
