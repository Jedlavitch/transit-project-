#!/usr/bin/env python3
"""
gen-mta-stations.py — every NYC subway station id -> name, for the station displays.

WHY THIS IS SEPARATE FROM THE SCHEDULE BUNDLE
  mta-subway-schedule.json is deliberately scoped to "Manhattan + nearby Brooklyn
  and Queens" to keep it small, so it knows 252 stations. The realtime feed does
  not respect that boundary: a train standing at Times Square is bound for
  Van Cortlandt Park or Flatbush Avenue, and those ids are not in the bundle. A
  station display whose headline reads "to 247" is useless.

  This produces the id -> name map for the WHOLE system. It is names and
  coordinates only, no timetable, so it stays tiny — a few tens of KB against the
  bundle's megabytes — and it is what makes destinations and strip maps read in
  English everywhere on the network.

  Parent stations only: GTFS lists "127", "127N" and "127S" as separate stops,
  where the two suffixed ones are the platforms. The display joins on the parent,
  the same way mta-live.js strips the direction letter.

RUN
  python3 gen-mta-stations.py          # writes mta-stations.json
"""

import csv
import io
import json
import sys
import urllib.request
import zipfile

GTFS_URL = "https://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip"
OUT = "mta-stations.json"


def main():
    print(f"downloading {GTFS_URL} …", file=sys.stderr)
    req = urllib.request.Request(GTFS_URL, headers={"User-Agent": "Mozilla/5.0"})
    raw = urllib.request.urlopen(req, timeout=120).read()
    zf = zipfile.ZipFile(io.BytesIO(raw))

    with zf.open("stops.txt") as fh:
        rows = list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))

    stations = {}
    for r in rows:
        sid = (r.get("stop_id") or "").strip()
        # location_type 1 == station (the parent). Platforms carry a
        # parent_station instead and are skipped: joining on the parent is what
        # mta-live.js does when it strips the N/S suffix.
        if (r.get("location_type") or "").strip() != "1":
            continue
        name = (r.get("stop_name") or "").strip()
        if not sid or not name:
            continue
        try:
            lat = round(float(r["stop_lat"]), 5)
            lon = round(float(r["stop_lon"]), 5)
        except (KeyError, ValueError, TypeError):
            lat = lon = None
        stations[sid] = {"n": name, "lat": lat, "lon": lon}

    if not stations:
        sys.exit("no stations found — MTA changed stops.txt; check location_type")

    out = {
        "generated": __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": f"NYC subway stations (id -> name), whole system, from {GTFS_URL}",
        "stations": stations,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))

    import os
    print(f"{OUT}: {len(stations)} stations, {os.path.getsize(OUT)/1024:.0f} KB", file=sys.stderr)


if __name__ == "__main__":
    main()
