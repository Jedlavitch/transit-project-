#!/usr/bin/env python3
"""Every map hub in map-data/station-hubs.json must land on real stops: each
feed a hub lists needs at least one station inside the hub's radius that has
departures in the bundle. Run after moving a hub or refreshing a timetable.
Prints what each hub resolved to, so a wrong coordinate is obvious by eye."""
import json, math, sys

def far(a, b):
    return math.hypot((a[0]-b[0])*111000, (a[1]-b[1])*111000*math.cos(math.radians(a[0])))

data = json.load(open("map-data/station-hubs.json"))
cache, bad = {}, 0
for city, cfg in data["cities"].items():
    print("==", city)
    for hub in cfg["hubs"]:
        where = (hub["near"]["lat"], hub["near"]["lon"]) if "near" in hub else (hub["lat"], hub["lon"])
        radius = hub["near"]["r"] if "near" in hub else hub["r"]
        for key in hub["feeds"]:
            name = cfg["feeds"][key]["file"]
            if name not in cache:
                cache[name] = json.load(open(name))
            b = cache[name]
            near = {s["id"]: s["name"] for s in b["stations"] if far(where, (s["lat"], s["lon"])) <= radius}
            if b.get("v") == 2:
                pats = b["pats"]
                count = sum(1 for t in b["trips"] for i in pats[t["p"]][:-1] if i in near)
            else:
                count = sum(1 for t in b["trips"] for s in t["st"][:-1] if s[0] in near)
            print(f"  {hub['name']:28} {key:9} {count:6} deps  {sorted(set(near.values()))[:5]}")
            if not count:
                bad += 1
                print("    ^^^ NOTHING HERE")
print("FAILED" if bad else "ok", bad)
sys.exit(1 if bad else 0)
