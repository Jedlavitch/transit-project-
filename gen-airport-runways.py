#!/usr/bin/env python3
"""Builds airport-runways.json for Sky's airport view (sky-airport.js).

Usage:  python3 -I gen-airport-runways.py airports.csv runways.csv > airport-runways.json

Both CSVs are OurAirports' public-domain data
(https://davidmegginson.github.io/ourairports-data/). The airport list is the
NEAR_AIRPORTS table in night.html, by IATA code; re-run when that list grows.
Only open, paved runways of 3,000 ft or more with both thresholds surveyed
are kept: those are the ones an airliner uses, and the ones worth drawing.
"""
import csv, json, re, sys

night = open("night.html", encoding="utf-8").read()
block = night[night.index("const NEAR_AIRPORTS=["):]
block = block[:block.index("]];") + 2]
iatas = re.findall(r'\["([A-Z]{3})"', block)

aps = {}
with open(sys.argv[1], encoding="utf-8") as f:
    for r in csv.DictReader(f):
        if r["iata_code"] in iatas and r["type"] in ("large_airport", "medium_airport"):
            aps[r["ident"]] = {"icao": r["ident"], "iata": r["iata_code"], "name": r["name"],
                               "lat": round(float(r["latitude_deg"]), 5), "lon": round(float(r["longitude_deg"]), 5),
                               "elev": int(float(r["elevation_ft"] or 0)), "rwy": []}

PAVED = re.compile(r"ASP|CON|PEM|BIT|ASPH|CONC", re.I)
with open(sys.argv[2], encoding="utf-8") as f:
    for r in csv.DictReader(f):
        a = aps.get(r["airport_ident"])
        if not a or r["closed"] == "1" or not PAVED.search(r["surface"] or ""):
            continue
        try:
            ln = int(r["length_ft"] or 0)
            ends = [float(r[k]) for k in ("le_latitude_deg", "le_longitude_deg", "he_latitude_deg", "he_longitude_deg")]
        except ValueError:
            continue
        if ln < 3000:
            continue
        def hdg(k):
            try: return round(float(r[k]), 1)
            except ValueError: return None
        a["rwy"].append({"le": r["le_ident"], "he": r["he_ident"], "len": ln,
                         "a": [round(ends[0], 5), round(ends[1], 5)], "b": [round(ends[2], 5), round(ends[3], 5)],
                         "leH": hdg("le_heading_degT"), "heH": hdg("he_heading_degT")})

out = sorted((a for a in aps.values() if a["rwy"]), key=lambda a: a["icao"])
missing = sorted(set(iatas) - {a["iata"] for a in out})
if missing:
    print("no runways for: " + " ".join(missing), file=sys.stderr)
json.dump({"source": "OurAirports (public domain)", "airports": out}, sys.stdout, separators=(",", ":"))
