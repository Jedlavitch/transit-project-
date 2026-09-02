#!/usr/bin/env python3
"""
Regenerate septa-metro-shapes.json — the ROUTE GEOMETRY for every SEPTA Metro
line, and nothing else.

Why geometry-only, when gen-septa-subway-schedule.py already exists:

  The board draws its route lines by joining the stops of a line's longest trip
  with straight segments, which is free but is a diagram, not a map — the
  Market-Frankford Line comes out as a dogleg through Center City rather than
  following Market Street. And it needs a bundled TIMETABLE to work at all, so
  the four Metro lines that have no bundle (the T trolleys, G on Girard, D to
  Media and Sharon Hill, the M to Norristown) had no line on the map whatsoever
  even though their vehicles were moving along it.

  Adding those four to the timetable bundle would take it from ~0.9MB to ~3MB,
  which is a real cost on a page whose premise is that it is free to host
  forever. Their SHAPES cost a fraction of that: GTFS ships the actual traced
  path in shapes.txt, and after dropping points that add nothing to the drawn
  line the whole six-line set is tens of kilobytes. Same trick, same shape of
  output as ams-metro-shapes.json.

Emits { "<pattern>": [[lat, lon], ...], ... } keyed by SERVICE PATTERN — T1, T2,
T3, T4, T5, D1, D2, B1, B2, B3, L1, G1, M1 — not by line letter.

Keying by letter was the first attempt and it was wrong on the ground. The five
T patterns are five physically different trolley routes (10, 34, 13, 11, 36)
that share a tunnel through Center City and then fan out to five different
termini in West and Southwest Philadelphia; D1 and D2 are the Media and Sharon
Hill branches, which split at Drexel Hill. Drawing "the T" as a single longest
shape put one of those five on the map and silently dropped the rest, which is
exactly the coverage gap this file existed to close.

Patterns that genuinely do share track — B1 local and B2 express run the same
rails — simply draw over each other in the same colour, which costs a little
file size and looks like the one line it is.

Re-run when SEPTA realigns something (rare — this is track, not timetable):
    python3 gen-septa-metro-shapes.py
"""
import csv, io, json, math, os, urllib.request, zipfile

GTFS_URL = "https://www3.septa.org/developer/gtfs_public.zip"
OUT = os.path.join(os.path.dirname(__file__), "septa-metro-shapes.json")

# Every SEPTA Metro service pattern, mapped to the LINE it belongs to.
# Trolleys T1-T5 are routes 10/34/13/11/36; G1 is 15; D1/D2 are 101/102;
# M1 is the Norristown High Speed Line. SEPTA's GTFS has been using the new
# codes since the 2024 rebrand, but the legacy numbers are accepted too so a
# regeneration against an older feed still works.
PATTERNS = {
    "L1": "L",
    "B1": "B", "B2": "B", "B3": "B",
    "T1": "T", "T2": "T", "T3": "T", "T4": "T", "T5": "T",
    "G1": "G",
    "D1": "D", "D2": "D",
    "M1": "M",
    # legacy route ids, same lines
    "MFL": "L", "BSL": "B", "BSO": "B", "BSS": "B",
    "10": "T", "34": "T", "13": "T", "11": "T", "36": "T",
    "15": "G", "101": "D", "102": "D", "NHSL": "M",
}


def rows(zf, name):
    with zf.open(name) as fh:
        return list(csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")))


def simplify(pts, tol_m=12.0):
    """Ramer-Douglas-Peucker, iterative so a 5,000-point shape cannot blow the
    stack. `tol_m` is roughly how far the drawn line may stray from the true
    one; 12m is well under a pixel at the zooms this board uses, so the saving
    is invisible and substantial (typically 90%+ of the points)."""
    if len(pts) < 3:
        return pts
    # Metres per degree at Philadelphia's latitude — good enough for a tolerance.
    mlat, mlon = 111_320.0, 111_320.0 * math.cos(math.radians(40.0))

    def seg_dist(p, a, b):
        px, py = (p[1] - a[1]) * mlon, (p[0] - a[0]) * mlat
        bx, by = (b[1] - a[1]) * mlon, (b[0] - a[0]) * mlat
        L2 = bx * bx + by * by
        if L2 == 0:
            return math.hypot(px, py)
        t = max(0.0, min(1.0, (px * bx + py * by) / L2))
        return math.hypot(px - t * bx, py - t * by)

    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        worst, wi = 0.0, -1
        for k in range(i + 1, j):
            d = seg_dist(pts[k], pts[i], pts[j])
            if d > worst:
                worst, wi = d, k
        if worst > tol_m:
            keep[wi] = True
            stack.append((i, wi))
            stack.append((wi, j))
    return [p for p, k in zip(pts, keep) if k]


def main():
    req = urllib.request.Request(
        GTFS_URL, headers={"User-Agent": "Mozilla/5.0 (compatible; transit-board-schedule-fetch/1.0)"}
    )
    outer = zipfile.ZipFile(io.BytesIO(urllib.request.urlopen(req, timeout=180).read()))
    zf = zipfile.ZipFile(io.BytesIO(outer.read("google_bus.zip")))  # subway/trolley/bus all live here

    routes = rows(zf, "routes.txt")
    # Match on route_id OR short name: SEPTA has used both spellings across feeds.
    want, pattern_of = {}, {}
    for r in routes:
        for key in (r.get("route_id", ""), (r.get("route_short_name") or "").strip()):
            if key in PATTERNS:
                want[r["route_id"]] = PATTERNS[key]
                # The Metro code itself (T2, D1, ...) when the feed already uses
                # it; a legacy numeric route keeps its number and is still drawn,
                # just under the name that feed gave it.
                pattern_of[r["route_id"]] = key
                break
    if not want:
        raise SystemExit("No SEPTA Metro routes matched — check PATTERNS against routes.txt")

    # trip -> pattern, and which shape each trip traces.
    shape_line, shape_pattern = {}, {}
    for t in rows(zf, "trips.txt"):
        rid = t.get("route_id")
        line = want.get(rid)
        sid = t.get("shape_id")
        if not line or not sid:
            continue
        shape_line[sid] = line
        shape_pattern[sid] = pattern_of.get(rid, rid)

    # Pull only the shapes we care about.
    pts_by_shape = {}
    with zf.open("shapes.txt") as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig")):
            sid = row["shape_id"]
            if sid not in shape_line:
                continue
            pts_by_shape.setdefault(sid, []).append(
                (int(row["shape_pt_sequence"]), float(row["shape_pt_lat"]), float(row["shape_pt_lon"]))
            )

    out = {}
    for pat in sorted(set(shape_pattern.values())):
        # Longest shape on THIS pattern: one clean end-to-end trace of the route
        # rather than every short-turn stacked on top of itself. Per pattern
        # rather than per line, so all five trolley branches survive.
        best, best_len = None, -1
        for sid, pp in shape_pattern.items():
            if pp != pat or sid not in pts_by_shape:
                continue
            n = len(pts_by_shape[sid])
            if n > best_len:
                best, best_len = sid, n
        if not best:
            continue
        seq = [(la, lo) for _, la, lo in sorted(pts_by_shape[best])]
        out[pat] = [[round(la, 5), round(lo, 5)] for la, lo in simplify(seq)]

    with open(OUT, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    total = sum(len(v) for v in out.values())
    print(f"wrote {OUT}: {len(out)} lines, {total} points, {os.path.getsize(OUT)/1024:.1f} KB")
    for k, v in out.items():
        print(f"  {k}: {len(v)} pts")


if __name__ == "__main__":
    main()
