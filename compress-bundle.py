#!/usr/bin/env python3
"""
Shrink a bundled GTFS timetable in place by deduplicating repeated structure.

    python3 compress-bundle.py mta-subway-schedule.json mnr-schedule.json
    python3 compress-bundle.py --check *.json      (report only, write nothing)

WHY
These bundles are dominated by repetition. A subway line runs the same stop
sequence hundreds of times a day, and each trip stored its own full copy of that
sequence plus a timestamp per stop. Metro-North is worse: its GTFS is
calendar_dates-only, so the same physical trip appears once per service-day
pattern, multiplying near-identical rows.

Two levels of sharing fix it, with no loss:
  * `pats`  — every distinct stop sequence, stored once
  * `offs`  — every distinct running-time profile (minutes from the trip's own
              start), stored once; trips that run the same route at the same
              pace share one entry no matter what time they leave
A trip then costs a line name, a headsign, a service id and three integers.

The result is marked "v":2. Consumers call expandBundle() on load, which
reconstitutes the original {line, hs, s, st:[[stop,min],...]} shape, so nothing
downstream has to know this happened.

Safe to re-run: an already-compressed file is detected and skipped.
"""
import json, os, sys


def compress(doc):
    """v1 bundle dict -> (v2 dict, stats). Returns None if already compressed."""
    if doc.get("v") == 2:
        return None
    trips = doc.get("trips") or []
    pats, offs, out = {}, {}, []
    for t in trips:
        st = t.get("st") or []
        if len(st) < 2:
            continue
        ids = tuple(s[0] for s in st)
        times = [s[1] for s in st]
        base = times[0]
        prof = tuple(m - base for m in times)
        pi = pats.setdefault(ids, len(pats))
        oi = offs.setdefault(prof, len(offs))
        out.append({"l": t.get("line", ""), "h": t.get("hs", ""), "s": t.get("s", ""),
                    "p": pi, "o": oi, "t": base})
    new = {k: v for k, v in doc.items() if k != "trips"}
    new["v"] = 2
    new["pats"] = [list(k) for k, _ in sorted(pats.items(), key=lambda kv: kv[1])]
    new["offs"] = [list(k) for k, _ in sorted(offs.items(), key=lambda kv: kv[1])]
    new["trips"] = out
    return new, {"trips": len(out), "pats": len(pats), "offs": len(offs)}


def verify(before, after):
    """Expanding the compressed form must reproduce the original trips exactly."""
    pats, offs = after["pats"], after["offs"]
    rebuilt = [{"line": t["l"], "hs": t["h"], "s": t["s"],
                "st": [[sid, t["t"] + offs[t["o"]][i]] for i, sid in enumerate(pats[t["p"]])]}
               for t in after["trips"]]
    original = [t for t in (before.get("trips") or []) if len(t.get("st") or []) >= 2]
    if len(rebuilt) != len(original):
        return f"trip count {len(rebuilt)} != {len(original)}"
    for a, b in zip(original, rebuilt):
        if a.get("line", "") != b["line"] or a.get("hs", "") != b["hs"] or a.get("s", "") != b["s"]:
            return "trip metadata differs"
        if [list(x) for x in a["st"]] != b["st"]:
            return f"stop times differ in trip {a.get('line')} {a.get('hs')}"
    return None


def main(argv):
    check = "--check" in argv
    files = [a for a in argv if a.endswith(".json")]
    if not files:
        print(__doc__.strip().splitlines()[2]); return 1
    total_before = total_after = 0
    for f in files:
        path = os.path.abspath(f)
        try:
            doc = json.load(open(path))
        except Exception as e:
            print(f"{f}: skipped ({e})"); continue
        if not isinstance(doc, dict) or "trips" not in doc:
            print(f"{f}: skipped (not a schedule bundle)"); continue
        before = os.path.getsize(path)
        res = compress(doc)
        if res is None:
            print(f"{f}: already compressed"); continue
        new, stats = res
        blob = json.dumps(new, separators=(",", ":"))
        err = verify(doc, new)
        if err:
            print(f"{f}: NOT WRITTEN — round-trip check failed: {err}"); continue
        after = len(blob)
        total_before += before; total_after += after
        pct = 100 * (1 - after / before)
        print(f"{f}: {before//1024:>6} KB -> {after//1024:>5} KB  ({pct:4.1f}% smaller)  "
              f"{stats['trips']} trips, {stats['pats']} patterns, {stats['offs']} profiles"
              + ("   [check only]" if check else ""))
        if not check:
            open(path, "w").write(blob)
    if total_before:
        print(f"TOTAL: {total_before//1024} KB -> {total_after//1024} KB "
              f"({100*(1-total_after/total_before):.1f}% smaller)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
