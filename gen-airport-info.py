#!/usr/bin/env python3
"""Builds airport-info/<ICAO>.json for Sky's airport view: terminals (with
their outlines and gate counts), and the places to eat, drink and wait inside
them, from OpenStreetMap via the Overpass API.

Usage:  python3 -I gen-airport-info.py [ICAO ...]      (default: every airport in airport-runways.json)

Why bundled rather than queried live: the public Overpass servers took 40+
seconds to answer one airport, and an Echo Show would wait that long every
time the view opened. Airport interiors change slowly; re-run this every few
months. Data (c) OpenStreetMap contributors, ODbL — credited in the view.

Only places INSIDE a terminal outline are kept, so the Crystal City
restaurants next to DCA don't show up as airport food.
"""
import json, os, sys, time, urllib.parse, urllib.request

MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
UA = "transit-project-airport-info/1.0"
FOOD = {"restaurant", "cafe", "fast_food", "bar", "pub", "ice_cream"}


def overpass(q):
    last = None
    for attempt in range(4):
        url = MIRRORS[attempt % len(MIRRORS)]
        try:
            req = urllib.request.Request(url, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=200) as r:
                return json.load(r)
        except Exception as e:  # busy server: back off and try the other one
            last = e
            time.sleep(15 * (attempt + 1))
    raise last


def inside(pt, poly):
    x, y, c = pt[1], pt[0], False
    for i in range(len(poly)):
        y1, x1 = poly[i]; y2, x2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def simplify(pts, keep=60):
    if len(pts) <= keep:
        return pts
    step = len(pts) / keep
    return [pts[int(i * step)] for i in range(keep)]


def build(ap):
    lats = [p for r in ap["rwy"] for p in (r["a"][0], r["b"][0])] + [ap["lat"]]
    lons = [p for r in ap["rwy"] for p in (r["a"][1], r["b"][1])] + [ap["lon"]]
    bb = "%.4f,%.4f,%.4f,%.4f" % (min(lats) - .01, min(lons) - .01, max(lats) + .01, max(lons) + .01)
    # Two light queries, not one heavy one: outlines only for terminals, centre
    # points for everything else. The combined "geom for all" form timed out.
    q1 = ('[out:json][timeout:120];(way["aeroway"="terminal"](%(b)s);relation["aeroway"="terminal"](%(b)s););out tags geom;') % {"b": bb}
    q2 = ("[out:json][timeout:120];("
          'nwr["aeroway"="gate"](%(b)s);'
          'nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|ice_cream|lounge)$"](%(b)s);'
          'nwr["name"~"[Ll]ounge|[Cc]lub|Centurion|Sky ?Club|Admirals|Polaris"](%(b)s);'
          'nwr["shop"](%(b)s);'
          'nwr["aeroway"="aerodrome"](%(b)s);'
          ");out center tags;") % {"b": bb}
    els = overpass(q1)["elements"]
    time.sleep(3)
    els = els + overpass(q2)["elements"]

    terms = []
    for e in els:
        t = e.get("tags", {})
        if t.get("aeroway") != "terminal":
            continue
        ring = [[round(g["lat"], 5), round(g["lon"], 5)] for g in (e.get("geometry") or []) if g]
        if e["type"] == "relation":   # multipolygon: use its outer members' points
            ring = [[round(g["lat"], 5), round(g["lon"], 5)] for m in e.get("members", []) if m.get("role") == "outer" for g in (m.get("geometry") or [])]
        if len(ring) < 3:
            continue
        terms.append({"name": t.get("name") or (("Terminal " + t["ref"]) if t.get("ref") else "Terminal"),
                      "ring": ring, "gates": 0, "places": []})

    def where(pt):
        for tm in terms:
            if inside(pt, tm["ring"]):
                return tm
        return None

    site = None
    lounges, food_n, shop_n = [], 0, 0
    for e in els:
        t = e.get("tags", {})
        c = e.get("center") or ({"lat": e["lat"], "lon": e["lon"]} if "lat" in e else None)
        if t.get("aeroway") == "aerodrome" and (t.get("iata") == ap["iata"] or t.get("icao") == ap["icao"]):
            site = t.get("website") or t.get("contact:website") or site
            continue
        if not c or t.get("aeroway") == "terminal":
            continue
        pt = [c["lat"], c["lon"]]
        tm = where(pt)
        if not tm:
            continue
        if t.get("aeroway") == "gate":
            tm["gates"] += 1
            continue
        name = t.get("name") or t.get("brand")
        if not name:
            continue
        lounge = t.get("amenity") == "lounge" or any(w in name.lower() for w in ("lounge", " club", "centurion", "admirals", "polaris"))
        kind = "lounge" if lounge else ("food" if t.get("amenity") in FOOD else ("shop" if "shop" in t else None))
        if not kind:
            continue
        p = {"n": name, "k": kind}
        if t.get("cuisine"): p["c"] = t["cuisine"].replace(";", ", ").replace("_", " ")
        if t.get("opening_hours"): p["h"] = t["opening_hours"]
        unit = t.get("addr:unit") or t.get("level:ref") or t.get("ref")
        if unit: p["u"] = unit
        if t.get("shop"): p["s"] = t["shop"].replace("_", " ")
        p["at"] = [round(pt[0], 5), round(pt[1], 5)]
        tm["places"].append(p)
        if kind == "lounge": lounges.append(name)
        elif kind == "food": food_n += 1
        else: shop_n += 1

    # one entry per terminal name (OSM often splits a terminal into several ways)
    merged = {}
    for tm in terms:
        m = merged.setdefault(tm["name"], {"name": tm["name"], "rings": [], "gates": 0, "places": []})
        m["rings"].append(simplify(tm["ring"]))
        m["gates"] += tm["gates"]
        m["places"] += tm["places"]
    out = sorted(merged.values(), key=lambda m: m["name"])
    for m in out:
        m["places"].sort(key=lambda p: ({"lounge": 0, "food": 1, "shop": 2}[p["k"]], p["n"].lower()))
    return {"icao": ap["icao"], "website": site, "terminals": out,
            "counts": {"food": food_n, "shops": shop_n, "lounges": len(lounges)},
            "built": time.strftime("%Y-%m-%d"), "source": "OpenStreetMap contributors (ODbL)"}


def main():
    aps = json.load(open("airport-runways.json"))["airports"]
    want = set(a.upper() for a in sys.argv[1:])
    os.makedirs("airport-info", exist_ok=True)
    for ap in aps:
        if want and ap["icao"] not in want and ap["iata"] not in want:
            continue
        try:
            doc = build(ap)
        except Exception as e:
            print("%s: FAILED %s" % (ap["icao"], e), file=sys.stderr, flush=True)
            continue
        with open("airport-info/%s.json" % ap["icao"], "w") as f:
            json.dump(doc, f, separators=(",", ":"))
        print("%s: %d terminals, %d food, %d shops, %d lounges" % (ap["icao"], len(doc["terminals"]), doc["counts"]["food"], doc["counts"]["shops"], doc["counts"]["lounges"]), flush=True)
        time.sleep(5)   # be a polite client of a free service


if __name__ == "__main__":
    main()
