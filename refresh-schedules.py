#!/usr/bin/env python3
"""
Keep the bundled GTFS schedules from silently going stale.

WHY THIS EXISTS
    Every board falls back to a bundled schedule when a system has no live
    feed (and several systems have no live feed at all). Those bundles carry
    the agency's own service calendar, and agencies publish only a short
    horizon -- LACMTA about three weeks, SEPTA and SF about a month. When the
    last date passes, `activeServices()` matches nothing, and the card simply
    goes empty. Nothing errors, nothing logs; the trains just quietly stop
    appearing, which is exactly how LA Metro Rail went blank.

WHAT IT DOES
    Reads the calendar out of every bundle, works out the last day it can
    still show service, and re-runs the generator for anything already expired
    or about to be. Run it from CI on a schedule (see
    .github/workflows/schedule-refresh.yml) and the bundles keep themselves
    current; run it by hand when you want to know where things stand.

    The bundle's last date is not enough on its own. A feed can publish light
    rail into next year and heavy rail only to next month, and then the bundle
    reads healthy while every NEC train is gone (NJ Transit, October 2026). So
    each line is also dated separately: see stopped_lines().

USAGE
    python3 refresh-schedules.py              # report only (default)
    python3 refresh-schedules.py --fix        # regenerate what needs it
    python3 refresh-schedules.py --fix --days 21   # widen the warning window
    python3 refresh-schedules.py --all        # regenerate everything

EXIT CODES (so CI can gate on them)
    0  every bundle is good for at least --days
    1  something is expired or expiring inside the window (report mode), or a
       generator failed (--fix mode)
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# bundle -> the generator that rebuilds it. Several generators emit more than
# one bundle, so the same script legitimately appears more than once; it is
# only ever run once per pass (see the dedupe in main()).
GENERATORS = {
    "la-rail-schedule.json":        "gen-la-schedule.py",
    "la-metrolink-schedule.json":   "gen-la-schedule.py",
    "mbta-bus-schedule.json":       "gen-mbta-schedule.py",
    "mbta-cr-schedule.json":        "gen-mbta-schedule.py",
    "mbta-subway-schedule.json":    "gen-mbta-schedule.py",
    "mta-subway-schedule.json":     "gen-mta-subway-schedule.py",
    "mta-bus-schedule.json":        "gen-mta-bus-schedule.py",
    "septa-bus-schedule.json":      "gen-septa-bus-schedule.py",
    "septa-rail-schedule.json":     "gen-septa-rail-schedule.py",
    "septa-subway-schedule.json":   "gen-septa-subway-schedule.py",
    "sf-bart-schedule.json":        "gen-sf-schedule.py",
    "sf-muni-schedule.json":        "gen-sf-schedule.py",
    "sf-cablecar-schedule.json":    "gen-sf-schedule.py",
    "sf-caltrain-schedule.json":    "gen-sf-schedule.py",
    "ams-tram-schedule.json":       "gen-amsterdam-schedule.py",
    "ams-metro-schedule.json":      "gen-amsterdam-schedule.py",
    "ams-rail-schedule.json":       "gen-amsterdam-schedule.py",
    "ams-ferry-schedule.json":      "gen-amsterdam-schedule.py",
    "ams-intl-schedule.json":       "gen-amsterdam-schedule.py",
    "rideon-schedule.json":         "gen-rideon-schedule.py",
    "rome-metro-schedule.json":     "gen-rome-metro-schedule.py",
    "marc-schedule.json":           "gen-marc-schedule.py",
    "patco-schedule.json":          "gen-patco-schedule.py",
    "path-schedule.json":           "gen-path-schedule.py",
    "lirr-schedule.json":           "gen-lirr-schedule.py",
    "mnr-schedule.json":            "gen-mnr-schedule.py",
    "njt-nyc-schedule.json":        "gen-njt-schedule.py",
    "njt-phl-schedule.json":        "gen-njt-schedule.py",
    "njt-state-bus-schedule.json":  "gen-njt-state.py",
    "njt-state-rail-schedule.json": "gen-njt-state.py",
}

# A line is reported when its own dates stop at least this many days before the
# bundle's last date. Shorter gaps are just calendar shape: a weekday line in a
# feed that ends on a Saturday, or a weekend line that ends a week early.
LINE_GAP_DAYS = 21
# ...and only if it ran on at least this many days, or a quarter of the bundle's
# days if that is fewer (Amsterdam publishes 31 days, so a line 21 days short of
# the end cannot have run 14). Below that it is event or seasonal service whose
# end means nothing: Meadowlands Rail runs 1-3 game days per feed, Foxboro 5. A
# long season (a summer Friday-Sunday service, say) still clears this and gets
# reported. Better a person looks once than a line vanishes.
LINE_MIN_DAYS = 14


def ymd(d):
    return d.strftime("%Y%m%d")


def coverage_end(bundle):
    """Last date this bundle can still put a vehicle on the board.

    Two calendar styles have to be handled, because agencies use both:
      * calendar.txt  -> `svc` entries with a start/end range and a day mask
      * calendar_dates.txt only -> `svc` is empty and service exists solely as
        dated exceptions in `exc` (LIRR, Metro-North, NJT and the Amsterdam
        feeds all do this)
    The answer is the later of the two horizons; None means we could not tell.
    """
    ends = [v["end"] for v in (bundle.get("svc") or {}).values() if v.get("end")]
    exc_dates = [d for d, v in (bundle.get("exc") or {}).items() if (v or {}).get("add")]
    candidates = ends + exc_dates
    return max(candidates) if candidates else None


def active_on(bundle, day):
    """How many services run on `day` -- the same test the boards apply."""
    y, dow = ymd(day), (day.weekday())  # Mon=0 .. Sun=6, matching the bundles
    active = set()
    for sid, v in (bundle.get("svc") or {}).items():
        try:
            if v["start"] <= y <= v["end"] and v["dow"][dow]:
                active.add(sid)
        except (KeyError, IndexError, TypeError):
            continue
    ex = (bundle.get("exc") or {}).get(y)
    if ex:
        for sid in ex.get("rem", []):
            active.discard(sid)
        for sid in ex.get("add", []):
            active.add(sid)
    return len(active)


def service_dates(bundle):
    """service id -> every date it runs, by the same rules as active_on()."""
    out = {}
    for sid, v in (bundle.get("svc") or {}).items():
        try:
            day = datetime.datetime.strptime(v["start"], "%Y%m%d").date()
            end = datetime.datetime.strptime(v["end"], "%Y%m%d").date()
            mask = v["dow"]
            dates = out.setdefault(sid, set())
            while day <= end:
                if mask[day.weekday()]:
                    dates.add(ymd(day))
                day += datetime.timedelta(days=1)
        except (KeyError, IndexError, TypeError, ValueError):
            continue
    for date, ex in (bundle.get("exc") or {}).items():
        for sid in (ex or {}).get("rem", []):
            out.get(sid, set()).discard(date)
        for sid in (ex or {}).get("add", []):
            out.setdefault(sid, set()).add(date)
    return out


def stopped_lines(bundle, today, days_window):
    """Lines whose own dates run out well before the rest of their bundle.

    -> [{"line", "end", "days"}], earliest end first. A line counts once it is
    within days_window of its last date, the same warning the whole bundle gets.
    Compact ("v":2) bundles spell a trip's line `l` instead of `line`.
    """
    dates = service_dates(bundle)
    lines = {}
    for trip in bundle.get("trips") or []:
        line = trip.get("line") or trip.get("l")
        if line:
            lines.setdefault(line, set()).update(dates.get(trip.get("s"), ()))
    ends = [max(d) for d in lines.values() if d]
    if not ends:
        return []
    last = datetime.datetime.strptime(max(ends), "%Y%m%d").date()
    min_days = min(LINE_MIN_DAYS, len(set().union(*lines.values())) // 4)
    out = []
    for line, days in lines.items():
        if len(days) < min_days or not days:
            continue
        end = datetime.datetime.strptime(max(days), "%Y%m%d").date()
        if (last - end).days >= LINE_GAP_DAYS and (end - today).days <= days_window:
            out.append({"line": line, "end": max(days), "days": len(days)})
    return sorted(out, key=lambda r: (r["end"], r["line"]))


def audit(days_window):
    """Report on every bundle we know how to rebuild."""
    today = datetime.date.today()
    rows = []
    for name in sorted(GENERATORS):
        path = os.path.join(HERE, name)
        if not os.path.exists(path):
            rows.append({"name": name, "state": "missing", "end": None, "left": None, "today": 0})
            continue
        try:
            with open(path) as fh:
                bundle = json.load(fh)
        except Exception as exc:  # a truncated/corrupt bundle should be rebuilt too
            rows.append({"name": name, "state": "unreadable", "end": None, "left": None,
                         "today": 0, "err": str(exc)})
            continue
        end = coverage_end(bundle)
        today_count = active_on(bundle, today)
        lines = stopped_lines(bundle, today, days_window)
        if end is None:
            state, left = "unknown", None
        else:
            end_date = datetime.datetime.strptime(end, "%Y%m%d").date()
            left = (end_date - today).days
            if today_count == 0:
                state = "EXPIRED"
            elif left <= days_window or lines:
                state = "expiring"
            else:
                state = "ok"
        rows.append({"name": name, "state": state, "end": end, "left": left, "today": today_count,
                     "lines": lines})
    return rows


def lines_summary(lines):
    """'NEC, RARV to 20261010; BNTN to 20261009', latest-stopping group last."""
    by_end = {}
    for r in lines:
        by_end.setdefault(r["end"], []).append(r["line"])
    return "; ".join(f"{', '.join(names)} to {end}" for end, names in sorted(by_end.items()))


def run_generator(script):
    path = os.path.join(HERE, script)
    if not os.path.exists(path):
        print(f"    ! {script} not found -- skipped")
        return False
    print(f"    running {script} …", flush=True)
    try:
        res = subprocess.run([sys.executable, path], cwd=HERE, capture_output=True,
                             text=True, timeout=1800)
    except subprocess.TimeoutExpired:
        print(f"    ! {script} timed out after 30 min")
        return False
    if res.returncode != 0:
        tail = (res.stderr or res.stdout or "").strip().splitlines()[-6:]
        print(f"    ! {script} failed (exit {res.returncode})")
        for line in tail:
            print(f"      {line}")
        return False
    for line in (res.stdout or "").strip().splitlines()[-4:]:
        print(f"      {line}")
    return True


def main():
    ap = argparse.ArgumentParser(description="Audit and refresh the bundled GTFS schedules.")
    ap.add_argument("--fix", action="store_true", help="regenerate expired/expiring bundles")
    ap.add_argument("--all", action="store_true", help="regenerate every bundle regardless")
    ap.add_argument("--days", type=int, default=10,
                    help="warn when fewer than this many days of service remain (default 10)")
    args = ap.parse_args()

    rows = audit(args.days)
    today = datetime.date.today()
    print(f"Schedule bundles as of {today:%Y-%m-%d}  (window: {args.days} days)\n")
    width = max(len(r["name"]) for r in rows)
    for r in rows:
        left = "" if r["left"] is None else f"{r['left']:>4}d left"
        end = r["end"] or "-"
        mark = {"EXPIRED": "!!", "expiring": " *", "missing": "!!", "unreadable": "!!"}.get(r["state"], "  ")
        print(f" {mark} {r['name']:<{width}}  {r['state']:<10} ends {end}  {left}"
              f"   ({r['today']} services today)")
        if r.get("lines"):
            print(f"      lines stopping early: {lines_summary(r['lines'])}")

    stale = [r for r in rows if r["state"] in ("EXPIRED", "expiring", "missing", "unreadable")]

    if not args.fix and not args.all:
        print()
        if stale:
            print(f"{len(stale)} bundle(s) need attention -- re-run with --fix")
            return 1
        print("All bundles current.")
        return 0

    targets = rows if args.all else stale
    scripts = []
    for r in targets:                      # dedupe, preserving order
        s = GENERATORS[r["name"]]
        if s not in scripts:
            scripts.append(s)
    if not scripts:
        print("\nNothing to regenerate.")
        return 0

    print(f"\nRegenerating via {len(scripts)} generator(s):")
    failed = []
    for s in scripts:
        if not run_generator(s):
            failed.append(s)

    # Only a bundle that is still EXPIRED is a problem worth naming. One that
    # merely reads "expiring" right after a rebuild is simply as far ahead as
    # the agency publishes -- SEPTA and LACMTA rarely offer more than ~2 weeks,
    # so flagging that every run would be noise, not news.
    print("\nAfter refresh:")
    after = audit(args.days)
    broken = [r for r in after if r["state"] in ("EXPIRED", "missing", "unreadable")]
    for r in broken:
        print(f"  still {r['state']}: {r['name']} (ends {r['end']}) -- feed URL or format may have changed")
    # A line still stopping early after a rebuild is different news from a short
    # horizon: the agency's own feed has dropped it, and the "--days 0" gate in CI
    # will fail on it once its last date has passed.
    early = [r for r in after if r.get("lines")]
    for r in early:
        print(f"  lines stopping early in the agency's own feed: {r['name']} "
              f"({lines_summary(r['lines'])}, bundle runs to {r['end']})")
    horizon = [r for r in after if r["state"] == "expiring" and not r.get("lines")]
    if horizon:
        print("  short agency horizon (rebuilt, nothing more to get): "
              + ", ".join(f"{r['name'].replace('-schedule.json','')} to {r['end']}" for r in horizon))
    if not broken and not horizon and not early:
        print("  all bundles current")
    if failed:
        print(f"\n{len(failed)} generator(s) failed: {', '.join(failed)}")
        return 1
    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
