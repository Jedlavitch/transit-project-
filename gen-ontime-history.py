#!/usr/bin/env python3
"""
Poll the live feeds and keep a lasting on-time record — the half ontime.js
cannot do for itself.

WHY THIS EXISTS
  ontime.js records what a BOARD watched, in that browser's localStorage. That
  is honest and it is also the whole limitation: a screen that was off recorded
  nothing, and a fortnight chart full of "board was off" is a chart about the
  screen rather than about the trains. This runs on a schedule instead, from CI,
  so the record continues overnight and on days nobody had a board open.

WHAT IT MEASURES
  Exactly what the browser measures, so the two are the same quantity and can sit
  in one chart: minutes behind the operator's OWN schedule, as the operator
  publishes it. Nothing here is inferred from a countdown.

    Amtrak      api-v3.amtraker.com — scheduled vs actual per stop, every route
    SEPTA rail  www3.septa.org TrainView — its own `late`, per line
    SEPTA Metro www3.septa.org TransitView — its own `late`, L B T G D M

  Buses are deliberately absent: there are ~300 routes and this has no location,
  so it cannot know which of them anybody stands at. The board scopes those to
  what is near you; a national archive of all of them would be mostly noise.

THE RECORD
  One entry per line per day, in the SAME six-element shape ontime.js keeps in
  localStorage, so merging is a lookup rather than a conversion:

    [n, sumLate, onTime, worst, [5 delay bands], [onTime, delayed, cancelled]]

  `n` counts POLLS, not vehicles: each poll contributes the median lateness
  across that line's vehicles, which is what stops one stuck train from reading
  as a systemic failure. The status triple counts vehicles, because a
  cancellation is a service and no median can express one.

  Written to a data branch, never to main: at a poll every twenty minutes this
  would otherwise be seventy-odd commits a day on the branch that deploys the
  site.

Run by hand to test:  python3 gen-ontime-history.py --out ontime-history.json
"""
import argparse, datetime, json, os, statistics, sys, urllib.error, urllib.request

AMTRAK_URL      = "https://api-v3.amtraker.com/v3/trains"
SEPTA_TRAINVIEW = "https://www3.septa.org/api/TrainView/index.php"
SEPTA_TRANSITV  = "https://www3.septa.org/api/TransitView/index.php"

KEEP_DAYS   = 90     # the archive is the durable copy; the board only draws 14
ON_TIME_MAX = 6      # under six minutes late, the same bar ontime.js applies
SANE_LATE   = 90     # past an hour and a half it is a parsing fault, not a delay

SEPTA_METRO_NAME = {"L": "Market-Frankford", "B": "Broad Street", "T": "Subway-Surface",
                    "M": "Norristown", "G": "Girard", "D": "Media-Sharon Hill"}
SEPTA_METRO_COL  = {"L": "#1c6bb0", "B": "#f7941d", "T": "#3f9c46",
                    "M": "#5b2d90", "G": "#fdb913", "D": "#e0457b"}


def get(url, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent": "transit-project-ontime/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def badge(name):
    """Initials where there is more than one word ("Chestnut Hill East" -> CHE,
    which is also what keeps East and West apart), first three letters where
    there is only one ("Airport" -> AIR)."""
    words = [w for w in "".join(c if c.isalnum() else " " for c in str(name)).split() if w]
    if len(words) > 1:
        return "".join(w[0] for w in words).upper()[:4]
    return (words[0] if words else "?")[:3].upper()


def band_of(m):
    return 0 if m <= 0 else 1 if m <= 5 else 2 if m <= 14 else 3 if m <= 29 else 4


def usable(v):
    try:
        m = float(v)
    except (TypeError, ValueError):
        return None
    if m != m or abs(m) > SANE_LATE:      # NaN or beyond the sane bound
        return None
    return int(round(m))


def amtrak_rows():
    """{id: {meta, lates[]}} — one entry per ROUTE, not per train number, which
    is unique to a single journey and could never build a record."""
    try:
        data = get(AMTRAK_URL, timeout=60)
    except Exception as e:
        print("  amtrak: %s" % e, file=sys.stderr)
        return {}
    out = {}
    trains = []
    for v in (data.values() if isinstance(data, dict) else data):
        trains.extend(v if isinstance(v, list) else [v])
    for t in trains:
        if not isinstance(t, dict):
            continue
        nxt = next((s for s in (t.get("stations") or []) if s.get("status") != "Departed"), None)
        if not nxt:
            continue
        sch, act = nxt.get("schArr") or nxt.get("schDep"), nxt.get("arr") or nxt.get("dep")
        if not sch or not act:
            continue
        try:
            mins = (datetime.datetime.fromisoformat(act) -
                    datetime.datetime.fromisoformat(sch)).total_seconds() / 60.0
        except Exception:
            continue
        m = usable(mins)
        if m is None:
            continue
        name = (t.get("routeName") or "Amtrak").strip() or "Amtrak"
        rec = out.setdefault("amtrak|" + name,
                             {"meta": [name, "train", "#3ad0c8", badge(name), 0], "lates": []})
        rec["lates"].append(m)
    return out


def septa_rows():
    out = {}
    try:
        for t in get(SEPTA_TRAINVIEW):
            line = (t.get("line") or "").strip()
            m = usable(t.get("late"))
            if not line or m is None:
                continue
            rec = out.setdefault("septa-rail|" + line,
                                 {"meta": [line, "train", "#4F758B", badge(line), 0], "lates": []})
            rec["lates"].append(m)
    except Exception as e:
        print("  septa trainview: %s" % e, file=sys.stderr)

    try:
        for b in (get(SEPTA_TRANSITV).get("bus") or []):
            code = str(b.get("route_id") or "").upper().strip()
            # A Metro code is a letter plus its service-pattern number. The digit
            # is required: SEPTA also runs BUS routes lettered G, L and R, and a
            # bare "L" is the L bus, not the Market-Frankford Line.
            if not (len(code) >= 2 and code[0] in SEPTA_METRO_NAME and code[1:].isdigit()):
                continue
            m = usable(b.get("late"))
            if m is None:
                continue
            label = "%s · %s" % (code, SEPTA_METRO_NAME[code[0]])
            rec = out.setdefault("septa-metro|" + code,
                                 {"meta": [label, "metro", SEPTA_METRO_COL[code[0]], code, 0],
                                  "lates": []})
            rec["lates"].append(m)
    except Exception as e:
        print("  septa transitview: %s" % e, file=sys.stderr)
    return out


def merge(archive, rows, day):
    """One poll folded into the day's running record, in ontime.js's own shape."""
    for key, r in rows.items():
        lates = sorted(r["lates"])
        if not lates:
            continue
        med = int(round(statistics.median(lates)))
        entry = archive.setdefault(key, {})
        entry["_"] = r["meta"]
        rec = entry.get(day) or [0, 0, 0, 0, [0] * 5, [0, 0, 0]]
        rec[0] += 1
        rec[1] += med
        if med < ON_TIME_MAX:
            rec[2] += 1
        rec[3] = max(rec[3], lates[-1])
        rec[4][band_of(med)] += 1
        # The status triple counts VEHICLES: a line is not "on time" or "late" as
        # a whole, its services are. Cancellations stay at zero — neither feed
        # publishes them, and a zero we invented would be a claim they never made.
        for m in lates:
            rec[5][1 if m >= ON_TIME_MAX else 0] += 1
        entry[day] = rec


def prune(archive, today):
    cut = (today - datetime.timedelta(days=KEEP_DAYS)).isoformat()
    for key in list(archive):
        for d in [k for k in archive[key] if k != "_" and k < cut]:
            del archive[key][d]
        if not [k for k in archive[key] if k != "_"]:
            del archive[key]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "ontime-history.json"))
    args = ap.parse_args()

    now = datetime.datetime.now(datetime.timezone.utc)
    # US Eastern is where every line this watches runs; a poll just after midnight
    # UTC belongs to the previous local day, not the next one.
    eastern = now - datetime.timedelta(hours=5)
    day = eastern.date().isoformat()

    archive = {}
    if os.path.exists(args.out):
        try:
            archive = json.load(open(args.out)).get("lines", {})
        except Exception as e:
            print("existing archive unreadable, starting fresh: %s" % e, file=sys.stderr)

    rows = {}
    rows.update(amtrak_rows())
    rows.update(septa_rows())
    if not rows:
        print("no feed answered; leaving the archive untouched", file=sys.stderr)
        return 1

    merge(archive, rows, day)
    prune(archive, eastern.date())

    payload = {
        "generated": now.replace(microsecond=0).isoformat(),
        "day": day,
        "keepDays": KEEP_DAYS,
        "onTimeMax": ON_TIME_MAX,
        "lines": archive,
    }
    with open(args.out, "w") as fh:
        json.dump(payload, fh, separators=(",", ":"), sort_keys=True)
    days = sum(len([k for k in v if k != "_"]) for v in archive.values())
    print("%d lines, %d line-days, %.0f KB" % (len(archive), days, os.path.getsize(args.out) / 1024.0))
    return 0


if __name__ == "__main__":
    sys.exit(main())
