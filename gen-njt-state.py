#!/usr/bin/env python3
"""
Bundles for the statewide New Jersey board (newjersey.html).

    python3 gen-njt-state.py

Writes:
    njt-state-rail-schedule.json   ALL 17 NJT rail + light-rail routes, statewide
    njt-state-bus-schedule.json    the busiest bus routes that fit a size budget

WHY THE BUS BUNDLE IS PARTIAL (read before "fixing" it):
NJT rail is small enough to bundle whole -- 4,754 trips across every line in the
state. Buses are not, and not by a little: 263 routes / 33,536 trips, with
stop_times.txt alone at 78MB and shapes.txt at 128MB. A bus trip carries 40-80
stops where a rail trip carries ~15, so the bundled cost is roughly 1.3KB per bus
trip vs 0.23KB per rail trip -- bundling even the top 30 routes would be ~17MB of
JSON for the browser to download and parse on every board load. That is not a
tuning problem, it's a wrong-tool problem.

So the statewide bus card is LIVE-FIRST: with an NJT BusTime key configured (see
njt-worker.js) every one of the 263 routes shows real vehicles and real
predictions. This bundle exists so the card still does something useful with zero
setup -- it carries the highest-frequency routes that fit BUS_BUDGET_BYTES, added
busiest-first. Raise the budget if you're happy with a bigger download.

Feed quirks (same as gen-njt-schedule.py, which does the NYC/Philly slices):
calendar_dates.txt only (no calendar.txt) so `svc` is empty and every operating
day lands in `exc`; times run past 24h for after-midnight trips; flat stops;
shapes.txt deliberately never parsed (route lines come from the boards'
drawScheduleRouteLines()).
"""
import csv, io, json, os, urllib.request, zipfile, datetime, collections

RAIL_URL = "https://www.njtransit.com/rail_data.zip"
BUS_URL = "https://www.njtransit.com/bus_data.zip"
HERE = os.path.dirname(os.path.abspath(__file__))
BUS_BUDGET_BYTES = 1_600_000          # keep the browser download sane
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

    # ---------------- bus: busiest routes that fit the budget ----------------
    zf = fetch(BUS_URL)
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt")}
    counts = collections.Counter(t["route_id"] for t in rows(zf, "trips.txt"))
    by_trip = stop_times_by_trip(zf)
    trips = {t["trip_id"]: t for t in rows(zf, "trips.txt")}
    per_route = collections.defaultdict(list)
    for tid, seq in by_trip.items():
        tr = trips.get(tid)
        if not tr:
            continue
        seq = sorted(seq)
        if len(seq) < 2:
            continue
        per_route[tr["route_id"]].append(
            {"line": (routes[tr["route_id"]].get("route_short_name") or "").strip(),
             "hs": (tr.get("trip_headsign") or "").strip(),
             "s": tr["service_id"],
             "st": [[sid, m] for _, sid, m in seq]})

    chosen, total, kept_lines = [], 0, []
    for rid, _n in counts.most_common():
        block = per_route.get(rid) or []
        if not block:
            continue
        size = len(json.dumps(block, separators=(",", ":")))
        if total + size > BUS_BUDGET_BYTES:
            continue                     # skip this one, a smaller route may still fit
        chosen += block
        total += size
        kept_lines.append((routes[rid].get("route_short_name") or "").strip())
    used = {sid for t in chosen for sid, _ in t["st"]}
    print(f"  bus routes kept ({len(kept_lines)}): {', '.join(kept_lines)}")
    write("njt-state-bus-schedule.json", stations_for(zf, used), read_exc(zf), chosen,
          f"NJ Transit bus — {len(kept_lines)} highest-frequency routes only "
          f"({', '.join(kept_lines)}); all 263 routes need the live BusTime feed ({BUS_URL})")


if __name__ == "__main__":
    main()
