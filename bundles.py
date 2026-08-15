#!/usr/bin/env python3
"""
bundles.py — what rail is running near a point, read straight from the committed
GTFS bundles.

WHY THIS EXISTS
  interesting.js scored trains by reading the rendered departure rows off each
  board's DOM (scoreRow, interesting.js:730-774). A bot has no DOM. Everything
  scoreRow actually needed — a line, a destination, and where it was leaving
  from — is already in the ~29 *-schedule.json files this repo commits, so the
  rail side is re-derived here from the bundles instead of scraped.

  This module is deliberately dumb: it loads a bundle, works out which services
  run today, and lists the next departures near a coordinate. It does not score,
  does not know about cities, and does not talk to the network.

WHAT A BUNDLE CANNOT TELL YOU
  Delays. A bundled timetable is a timetable — it has no idea whether the 8:14
  is running twenty minutes late, and there is no field in these files that
  could be coaxed into saying so. Every row this module returns therefore
  carries late_min = None, and it will keep carrying None forever. That is the
  honest ceiling of the server-side rail path: scoreRow's two universal signals
  were the lateness ladder (interesting.js:756-758) and the cancellation scrape
  (interesting.js:759), and a bundle supplies neither. Do not synthesise one.
  In particular, do NOT compute a "delay" by interpolating a trip along its own
  schedule — that construction puts every train exactly on time by definition,
  so the number would be a fabricated zero dressed up as a measurement.

  Cities that do have a reachable live feed (WMATA, MBTA v3, Amtraker,
  transitous, BART) should use it and keep their lateness intact. This module
  is for the systems that genuinely have nothing live: MARC without its Worker,
  Ride On, PATCO, PATH, NJT, SEPTA subway, all of Amsterdam, LA and SF.

MISSING FEED != EMPTY SKY
  An expired bundle and a quiet railway look identical if you only count rows,
  and nine of the committed bundles are calendar_dates-only (svc == {}): every
  ams-*, lirr, mnr, njt-nyc, njt-phl and njt-state-*. When their exception list
  runs off the end of its horizon they resolve zero services, the JS stale
  fallback cannot fire (it iterates svc, which is empty), and the card goes
  blank with no error at all. That is how a lapsed bundle gets reported as "no
  trains ran". active_services() raises BundleLapsed instead, and
  departures_near() refuses to run on an empty service set, so the caller has
  to make the distinction out loud.

TIME
  Bundle minutes are minutes since midnight IN THE CITY, and only 9 of the 29
  files (ams-*, la-*, sf-*) carry a tz field at all — the boards fall back to
  the viewer's clock for the other 20. On a GitHub runner that clock is UTC,
  which is 4-5 hours off every US East Coast bundle and 2 hours off Amsterdam,
  so every entry point here takes an explicit IANA zone and resolves it with
  zoneinfo. There is no device-clock fallback on purpose.

USE
    import bundles
    p = bundles.now_parts("America/New_York")
    b = bundles.load_bundle("marc-schedule.json")
    try:
        act = bundles.active_services(b, p["ymd"], p["dow"])
    except bundles.BundleLapsed as e:
        ...                                  # say "feed lapsed", never "quiet"
    rows = bundles.departures_near(b, 38.9582, -77.1080, p["min"], act)

    python3 bundles.py        # self-test against six real bundles
"""

import json
import math
import os
import sys
import time
from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

__all__ = [
    "BundleLapsed", "load_bundle", "expand_bundle", "clear_cache",
    "active_services", "is_stale", "bundle_tz",
    "now_parts", "now_min", "sched_clock", "haversine_km",
    "departures_near",
]

# Earth radius in km — the rail side's haversine, matching nyc.html:867. This is
# NOT interesting.js:496's R=3440.065, which is nautical miles for the aircraft
# distance. The bot needs both and they must not be mixed up.
_EARTH_KM = 6371.0

# A GTFS service day is longer than a calendar day: trips that leave after
# midnight keep counting up rather than wrapping. Measured across all 29
# committed bundles, the latest stop time is 2120 (ams-intl, i.e. 11:20 the
# following morning), so times up to ~35:00 really do occur.
_DAY_MIN = 1440

# How far from the point a stop can be and still count as "near". The SEPTA
# board uses 40 miles for exactly this reason (philadelphia.html:2551) — its
# bundle spans the whole region, and without a cap the nearest stop with a
# departure can be an hour's drive away. 80 km is that cap, rounded up.
_DEFAULT_MAX_KM = 80.0


class BundleLapsed(Exception):
    """
    Raised when a bundle can resolve no services at all for the requested day.

    This is emphatically not "no trains ran". It means the committed timetable
    has run off the end of its horizon (or was asked about a day it never
    covered), and the correct thing for a caller to report is that the feed is
    missing — not that the city was quiet.

    Attributes: path, name, ymd, dow, first, last, calendar_only.
    """

    def __init__(self, message, path=None, ymd=None, dow=None,
                 first=None, last=None, calendar_only=False):
        super().__init__(message)
        self.path = path
        self.name = os.path.basename(path) if path else None
        self.ymd = ymd
        self.dow = dow
        self.first = first
        self.last = last
        self.calendar_only = calendar_only


# ------------------------------------------------------------------ loading

_CACHE = {}


def expand_bundle(doc):
    """
    Reconstitute a pattern-compressed ("v":2) bundle into the plain
    {line, hs, s, st:[[stop, min], ...]} trip shape. Port of expandBundle
    (nyc.html:857-866); the compressor that produced these files is
    compress-bundle.py:31-54.

    THIS IS NOT OPTIONAL. mta-subway-schedule.json, mnr-schedule.json and
    njt-state-bus-schedule.json ship compressed, and their trips carry the keys
    h/l/o/p/s/t — no "line", no "st". Reading trip["line"] on those raises
    KeyError, which is a hard crash in the middle of the two densest rail
    systems the bot covers. Everything downstream is written against the plain
    shape, so the expansion happens once, here, on load.

    A v1 document is returned untouched.
    """
    if not isinstance(doc, dict) or doc.get("v") != 2 or not isinstance(doc.get("pats"), list):
        return doc
    pats = doc.get("pats") or []
    offs = doc.get("offs") or []
    out = []
    for t in (doc.get("trips") or []):
        # The JS guards every lookup (`pats[t.p]||[]`, `offs[t.o]||[]`,
        # `off[i]||0`, `base = t.t||0`) because a truncated file should thin the
        # board out, not kill the page. Same reasoning here: a bad index yields
        # a short or flat trip that later filters drop, rather than an
        # IndexError that takes the whole city down.
        pi, oi = t.get("p"), t.get("o")
        ids = pats[pi] if isinstance(pi, int) and 0 <= pi < len(pats) else []
        off = offs[oi] if isinstance(oi, int) and 0 <= oi < len(offs) else []
        base = t.get("t") or 0
        st = [[sid, base + ((off[i] or 0) if i < len(off) else 0)]
              for i, sid in enumerate(ids)]
        out.append({"line": t.get("l") or "", "hs": t.get("h") or "",
                    "s": t.get("s") or "", "st": st})
    doc["trips"] = out
    # Drop the shared tables once they are spent — mnr's expand to 460k stop
    # times and there is no reason to hold the source arrays as well.
    doc.pop("pats", None)
    doc.pop("offs", None)
    return doc


def load_bundle(path):
    """
    Read a *-schedule.json bundle, expanding format v2 transparently, and cache
    it by resolved path.

    Lazy and per-path on purpose: the 29 committed bundles total 47 MB on disk
    and 3.28 million stop times, so a run that touched them all would spend its
    whole budget on JSON it never looks at. Load a city's rail systems when that
    city's turn comes; the cache stops a second call re-parsing the same file.

    Errors are NOT cached and NOT swallowed. A missing or malformed bundle
    raises (FileNotFoundError, json.JSONDecodeError, ValueError) so the caller
    can report a broken feed. Returning {} here would hand back a bundle with no
    trips, which reads downstream as a quiet railway — the exact lie this module
    exists to prevent.
    """
    key = os.path.realpath(path)
    hit = _CACHE.get(key)
    if hit is not None:
        return hit
    with open(key, "r", encoding="utf-8") as f:
        doc = json.load(f)
    if not isinstance(doc, dict) or "trips" not in doc:
        raise ValueError("%s is not a schedule bundle (no trips key)" % path)
    doc = expand_bundle(doc)
    doc["_path"] = key
    _CACHE[key] = doc
    return doc


def clear_cache():
    """Drop every cached bundle. For tests and for a long-lived process that
    wants its memory back; a single daily run never needs it."""
    _CACHE.clear()


def bundle_tz(bundle):
    """The bundle's own IANA zone, or None. Only ams-*, la-* and sf-* carry one
    (verified by reading all 29) — for the other 20 the caller must supply the
    city's zone itself. Never fall back to the process clock: on the runner that
    is UTC."""
    return (bundle or {}).get("tz") or None


# ------------------------------------------------------------------- clocks

def now_parts(tz, at=None):
    """
    {"ymd": "YYYYMMDD", "dow": Mon0..Sun6, "min": minutes since local midnight}
    for `tz`. Port of schedNowParts (losangeles.html:1253-1262), with the
    device-clock branch removed.

    That removal is the point. The JS falls back to the viewer's clock when a
    bundle has no tz field, which is right in a browser sitting in the city and
    catastrophic on a UTC runner: the daily job fires at 23:10 UTC, which is
    already the next calendar day in Amsterdam, Zurich, Cologne and Stuttgart,
    and roughly 19:10 in Washington. Getting either wrong silently reads the
    wrong day's timetable. So tz is required, and a bad one raises.

    date.weekday() is already Mon=0..Sun=6, which is what the JS builds by hand
    as (getDay()+6)%7. Python's %H is always 00-23, so the JS's `parseInt(hour)
    % 24` guard against Intl emitting "24" for midnight has no analogue here.
    """
    if not tz:
        raise ValueError("bundles.now_parts needs an IANA zone (e.g. "
                         "'America/New_York'); there is no safe device-clock "
                         "fallback on a UTC runner")
    if at is None:
        try:
            zone = ZoneInfo(tz) if isinstance(tz, str) else tz
        except ZoneInfoNotFoundError as e:
            # A slim container without /usr/share/zoneinfo fails here. Say so;
            # the fix is a tzdata package, not a code change.
            raise ZoneInfoNotFoundError(
                "no timezone database entry for %r (%s) — the host needs "
                "tzdata installed" % (tz, e)) from e
        at = datetime.now(zone)
    return {"ymd": at.strftime("%Y%m%d"), "dow": at.weekday(),
            "min": at.hour * 60 + at.minute}


def now_min(tz, at=None):
    """Minutes since midnight in `tz`. Bundle times are city-local minutes, so
    this is the only clock that can be compared against them."""
    return now_parts(tz, at)["min"]


def sched_clock(minute):
    """Bundle minute -> '11:05 PM'. Port of schedClock (losangeles.html:1526).
    The %24 is what makes an after-midnight time such as 1465 print as 12:25 AM
    rather than 24:25."""
    minute = int(minute)
    h = (minute // 60) % 24
    m = minute % 60
    return "%d:%02d %s" % (((h + 11) % 12) + 1, m, "PM" if h >= 12 else "AM")


def haversine_km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km, R=6371 (nyc.html:867)."""
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    s = (math.sin(d_lat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(d_lon / 2) ** 2)
    return 2 * _EARTH_KM * math.asin(math.sqrt(s))


# ---------------------------------------------------------------- calendars

def _coverage(bundle):
    """(first, last) YYYYMMDD the bundle says anything about, from calendar
    windows and calendar_dates keys together. Used only to make BundleLapsed
    say something useful."""
    svc = bundle.get("svc") or {}
    exc = bundle.get("exc") or {}
    firsts = [v.get("start") for v in svc.values() if isinstance(v, dict) and v.get("start")]
    lasts = [v.get("end") for v in svc.values() if isinstance(v, dict) and v.get("end")]
    days = [k for k in exc.keys() if k]
    firsts += days
    lasts += days
    return (min(firsts) if firsts else None), (max(lasts) if lasts else None)


def active_services(bundle, day_yyyymmdd, dow):
    """
    The set of service_ids running on `day_yyyymmdd` (a "YYYYMMDD" string, or a
    date) with weekday `dow` (Mon=0 .. Sun=6). Port of activeServices /
    marcActiveServices (boston.html:1302-1321, losangeles.html:1264-1291,
    dc.html:2374-2392), which are the same function three times over.

    Both bundle shapes are handled, because both are committed:
      * calendar + calendar_dates — svc gives a start/end window and a 7-flag
        weekday mask, exc patches individual days;
      * calendar_dates ONLY — svc is {} and every running day is spelled out in
        exc. Nine bundles are like this: all five ams-*, lirr, mnr, njt-nyc,
        njt-phl and njt-state-*.

    Removals are applied before additions, matching the JS and GTFS itself.

    Then the divergence that matters. When nothing is active the JS retries on
    weekday alone and marks the bundle stale (the guard that was added after LA
    Metro Rail silently vanished, losangeles.html:1270-1277). That fallback
    iterates svc — so for the nine calendar_dates-only bundles it iterates
    nothing, act stays empty, _stale is never set, and the system reports zero
    trains with no error anywhere. This raises BundleLapsed instead. An empty
    return value cannot be told apart from a genuinely quiet hour, and the one
    thing this bot must never do is post a city as quiet because its timetable
    expired.
    """
    if isinstance(day_yyyymmdd, (date, datetime)):
        day_yyyymmdd = day_yyyymmdd.strftime("%Y%m%d")
    ymd = str(day_yyyymmdd)
    dow = int(dow)
    if not 0 <= dow <= 6:
        raise ValueError("dow must be Mon=0 .. Sun=6, got %r" % (dow,))

    svc = bundle.get("svc") or {}
    exc = bundle.get("exc") or {}

    # Cleared per call rather than left sticky as the JS leaves it: one run can
    # ask the same cached bundle about more than one day (NJT is shared by the
    # Philadelphia and New York boards), and a flag left over from an earlier
    # question would label a healthy answer stale.
    bundle["_stale"] = False

    act = set()
    for sid, v in svc.items():
        if not isinstance(v, dict):
            continue
        start, end = v.get("start"), v.get("end")
        mask = v.get("dow") or []
        # YYYYMMDD compares correctly as a string, which is why the bundles
        # store it that way. A record missing either bound is treated as not
        # running, matching the JS (where the comparison against undefined is
        # simply false) rather than guessing a window.
        if not start or not end:
            continue
        if start <= ymd <= end and dow < len(mask) and mask[dow]:
            act.add(sid)

    ex = exc.get(ymd)
    if isinstance(ex, dict):
        for sid in (ex.get("rem") or []):
            act.discard(sid)
        for sid in (ex.get("add") or []):
            act.add(sid)

    if act:
        return act

    # Last resort for calendar-backed bundles: same weekday, ignore the window.
    # Times drift as the bundle ages, so the boards label this "stale schedule"
    # rather than passing it off as current, and so should anything built on it.
    for sid, v in svc.items():
        if isinstance(v, dict):
            mask = v.get("dow") or []
            if dow < len(mask) and mask[dow]:
                act.add(sid)
    if act:
        bundle["_stale"] = True
        return act

    first, last = _coverage(bundle)
    raise BundleLapsed(
        "%s has no service for %s (dow=%d); it covers %s..%s%s"
        % (os.path.basename(bundle.get("_path") or "bundle"), ymd, dow,
           first or "?", last or "?",
           " and is calendar_dates-only, so there is no weekday fallback"
           if not svc else ""),
        path=bundle.get("_path"), ymd=ymd, dow=dow,
        first=first, last=last, calendar_only=not svc)


def is_stale(bundle):
    """True when active_services fell back to weekday-only matching, i.e. the
    calendar has expired and the times are drifting. Report it; do not hide it."""
    return bool((bundle or {}).get("_stale"))


# --------------------------------------------------------------- departures

def _wait(dep_min, now_min_val):
    """
    Minutes until a bundle time, or None if it has already gone.

    The two-clock rule the boards use for map interpolation (`for nm of
    [nowMin, nowMin+1440]`, losangeles.html:1737) matters here too. GTFS keeps
    counting past midnight, so a train leaving at 00:25 is stored as 1465 on
    the PREVIOUS service day. At 00:20 the naive subtraction makes that train
    1445 minutes away — just under a day — and it sinks below every ordinary
    departure instead of being the next one out.

    So a time at or past 1440 is measured against now+1440 whenever that leaves
    it in the future. Outside the small hours the shifted comparison cannot fire
    (it needs now <= dep-1440, and the latest time in any committed bundle is
    2120), so daytime behaviour is exactly the boards'.
    """
    if dep_min >= _DAY_MIN:
        shifted = dep_min - (now_min_val + _DAY_MIN)
        if shifted >= 0:
            return shifted
    plain = dep_min - now_min_val
    return plain if plain >= 0 else None


def departures_near(bundle, lat, lon, now_min_val, active,
                    max_stops=3, per_stop=6, max_km=_DEFAULT_MAX_KM):
    """
    The next departures from the nearest stops to (lat, lon), nearest stop
    first, soonest departure first within a stop.

    Returns a list of dicts, each exactly:
        {"line": str, "headsign": str, "stop_name": str,
         "dep_min": int, "dist_km": float, "late_min": None}

    late_min is always None and always will be. A bundled timetable has no
    delays — see the module docstring. The key exists so a caller can merge
    these rows with live-feed rows that do carry a number, without having to
    special-case which source a row came from.

    dep_min is the raw bundle minute and may exceed 1440 for an after-midnight
    trip; sched_clock() prints it correctly. `wait_min` is included alongside
    (an addition to the six contract keys, not a replacement) because
    dep_min - now_min_val is wrong for exactly those after-midnight rows — see
    _wait. Prefer it over recomputing.

    headsign is returned RAW, including the empty string, which la-rail really
    does ship for its Metro trips. It is deliberately not defaulted here: every
    board applies its own fallback — `d.hs || d.line + ' Line'` on SEPTA
    (philadelphia.html:2567), `marcStationName(d.hs) || d.line + ' Line'` on
    MARC (dc.html:2419), `d.hs || d.line` on LA/SF/Amsterdam
    (losangeles.html:1748) — and inventing one here would fork the dest token
    away from what the board displays.

    Only the nearest stop with departures counts against max_stops; stops with
    nothing upcoming are skipped, as the boards do. Stops further than max_km
    are never considered: these bundles span whole regions (njt-state-rail
    reaches from Philadelphia to the Hudson), and without the cap "near this
    point" quietly becomes "somewhere in the state".

    Departures are deduplicated per stop by (line, headsign), keeping the
    soonest. The consumer's entry id is row:<sysId>:<line>:<dest>
    (interesting.js:766), so three copies of the same 1 train to South Ferry
    collapse into one entry downstream anyway — returning them would only crowd
    out the other direction. This is the same effect groupDepsByDirection
    (boston.html:1335) gets by grouping on headsign before it truncates.
    """
    if not active:
        # An empty service set only ever comes from a lapsed bundle, since
        # active_services raises rather than returning one. Refusing here stops
        # that turning into an empty departure list, which reads as "no trains".
        raise BundleLapsed(
            "departures_near called with no active services for %s — the "
            "bundle has lapsed; report a missing feed, not a quiet railway"
            % os.path.basename(bundle.get("_path") or "bundle"),
            path=bundle.get("_path"))

    now_min_val = int(now_min_val)
    active = active if isinstance(active, (set, frozenset)) else set(active)

    # 1. Stops within reach, nearest first. Duplicate ids keep the nearer one;
    #    a stop with no usable coordinates is dropped rather than placed at
    #    (0, 0), which would sit off West Africa and win every distance test.
    near = {}
    for st in (bundle.get("stations") or []):
        sid = st.get("id")
        slat, slon = st.get("lat"), st.get("lon")
        if sid is None or not isinstance(slat, (int, float)) or not isinstance(slon, (int, float)):
            continue
        if isinstance(slat, bool) or isinstance(slon, bool):
            continue
        km = haversine_km(lat, lon, slat, slon)
        if km > max_km:
            continue
        cur = near.get(sid)
        if cur is None or km < cur[1]:
            near[sid] = (st.get("name") or str(sid), km)
    if not near:
        return []

    # 2. One pass over the trips, keeping only the soonest departure per
    #    (stop, line, headsign). The working set stays tiny — a few thousand
    #    triples even for ams-tram — where a faithful copy of prepSchedule's
    #    full _dep index (losangeles.html:1547-1553) would materialise every
    #    stop time in the file: 526k for njt-state-bus, 460k for mnr. Trips are
    #    walked in bundle order, so the per-stop grouping below still comes out
    #    in the order the boards' insertion-ordered Map produces.
    per_stop_rows = {}
    for tr in (bundle.get("trips") or []):
        if tr.get("s") not in active:
            continue
        line = tr.get("line") or ""
        hs = tr.get("hs") or ""
        for entry in (tr.get("st") or []):
            # A stop time is [stop_id, minute]; anything else is a corrupt file
            # and is skipped rather than crashing the city.
            if not isinstance(entry, (list, tuple)) or len(entry) < 2:
                continue
            sid, minute = entry[0], entry[1]
            if sid not in near:
                continue
            # Every one of the 3.28 million stop times across the 29 committed
            # bundles is a plain int (checked, not assumed), but a generator
            # that ever emits a float should thin the board rather than crash
            # it, and JSON true must not sneak through as minute 1.
            if isinstance(minute, bool) or not isinstance(minute, (int, float)):
                continue
            minute = int(minute)
            # The last stop time of a trip is really an arrival, so a terminating
            # service shows up as "17 to Centraal Station" departing Centraal
            # Station. That is kept rather than filtered because prepSchedule
            # (losangeles.html:1547-1553) indexes every stop time the same way,
            # so it is exactly what the board renders — and the line/dest tokens
            # have to match the board or the registry vocabulary forks.
            w = _wait(minute, now_min_val)
            if w is None:
                continue
            rows = per_stop_rows.setdefault(sid, {})
            key = (line, hs)
            cur = rows.get(key)
            if cur is None or w < cur[0]:
                rows[key] = (w, minute)

    # 3. Walk outwards until max_stops stops have produced something.
    out = []
    used = 0
    for sid, (name, km) in sorted(near.items(), key=lambda kv: kv[1][1]):
        if used >= max_stops:
            break
        rows = per_stop_rows.get(sid)
        if not rows:
            continue
        used += 1
        ordered = sorted(rows.items(), key=lambda kv: kv[1][0])[:per_stop]
        for (line, hs), (w, minute) in ordered:
            out.append({
                "line": line,
                "headsign": hs,
                "stop_name": name,
                "dep_min": minute,
                "dist_km": km,
                # Not a placeholder to be filled in later: a timetable does not
                # know about delays, and nothing in this file can learn one.
                "late_min": None,
                "wait_min": w,
            })
    return out


# ------------------------------------------------------------------ selftest

def _selftest():
    """
    Runs against the real committed bundles for today, in each city's own zone.
    The six chosen cover every shape that has bitten this port: compressed v2,
    calendar_dates-only, both at once, a plain calendar bundle, the 9 MB one,
    and one that carries its own tz.
    """
    here = os.path.dirname(os.path.abspath(__file__))
    cases = [
        # file, city label, lat, lon, tz, what it is here to prove
        ("mta-subway-schedule.json", "NYC Times Sq", 40.7506, -73.9935,
         "America/New_York", "v2 compressed, has calendar"),
        ("mnr-schedule.json", "NYC Grand Central", 40.7527, -73.9772,
         "America/New_York", "v2 compressed AND calendar_dates-only"),
        ("njt-state-bus-schedule.json", "Newark Penn", 40.7346, -74.1643,
         "America/New_York", "v2 compressed, calendar_dates-only, 3287 stops"),
        ("marc-schedule.json", "Bethesda MD", 38.9582, -77.1080,
         "America/New_York", "plain v1 with a real calendar"),
        ("ams-tram-schedule.json", "Amsterdam Centraal", 52.3791, 4.9003,
         "Europe/Amsterdam", "9 MB, calendar_dates-only, carries its own tz"),
        ("la-rail-schedule.json", "LA Union Station", 34.0562, -118.2365,
         "America/Los_Angeles", "empty headsigns, tz in bundle"),
    ]
    print("bundles.py self-test — %s" % datetime.now().astimezone().isoformat(timespec="seconds"))
    print("")
    bad = 0
    for fname, label, lat, lon, tz, why in cases:
        path = os.path.join(here, fname)
        print("%s   (%s)" % (fname, why))
        try:
            t0 = time.time()
            b = load_bundle(path)
            load_s = time.time() - t0
            p = now_parts(bundle_tz(b) or tz)
            print("  loaded %d trips in %.2fs   tz=%s (%s)  local %s  ymd=%s dow=%d"
                  % (len(b.get("trips") or []), load_s, bundle_tz(b) or tz,
                     "from bundle" if bundle_tz(b) else "supplied by caller",
                     sched_clock(p["min"]), p["ymd"], p["dow"]))
            # The v2 files must come back in the plain shape or every consumer
            # downstream dies on trip["line"].
            t0trip = (b.get("trips") or [{}])[0]
            assert "line" in t0trip and "st" in t0trip, "expandBundle did not run"
            act = active_services(b, p["ymd"], p["dow"])
            print("  services active: %d%s   (svc=%d exc=%d -> %s)"
                  % (len(act), "  STALE SCHEDULE" if is_stale(b) else "",
                     len(b.get("svc") or {}), len(b.get("exc") or {}),
                     "calendar_dates-only" if not (b.get("svc") or {}) else "calendar"))
            t0 = time.time()
            rows = departures_near(b, lat, lon, p["min"], act)
            scan_s = time.time() - t0
            print("  departures near %s: %d rows in %.2fs" % (label, len(rows), scan_s))
            for r in rows[:5]:
                print("    %-22s %-28s %-30s %s (in %d min, %.1f km) late=%s"
                      % (r["line"] or "(no line)", (r["headsign"] or "(no headsign)")[:28],
                         r["stop_name"][:30], sched_clock(r["dep_min"]),
                         r["wait_min"], r["dist_km"], r["late_min"]))
            if not rows:
                print("    (nothing upcoming at the nearest stops within %.0f km — "
                      "a real hole in the timetable, not a missing feed)"
                      % _DEFAULT_MAX_KM)
        except BundleLapsed as e:
            bad += 1
            print("  BUNDLE LAPSED: %s" % e)
        except Exception as e:                                      # noqa: BLE001
            bad += 1
            print("  FAILED: %s: %s" % (type(e).__name__, e))
        print("")

    # The distinction this module exists for, shown both ways on a date no
    # bundle can possibly cover.
    print("lapse handling, asked about 20991231 (Thursday):")
    for fname in ("mnr-schedule.json", "marc-schedule.json"):
        b = load_bundle(os.path.join(here, fname))
        try:
            act = active_services(b, "20991231", 3)
            print("  %-28s %d services, stale=%s  <- weekday fallback fired"
                  % (fname, len(act), is_stale(b)))
        except BundleLapsed as e:
            print("  %-28s BundleLapsed(calendar_only=%s): %s"
                  % (fname, e.calendar_only, e))
    # And the guard that stops a lapsed set becoming an empty, silent list.
    try:
        departures_near(load_bundle(os.path.join(here, "marc-schedule.json")),
                        38.9582, -77.1080, 720, set())
        print("  departures_near(active=empty) DID NOT RAISE  <- bug")
        bad += 1
    except BundleLapsed:
        print("  departures_near(active=empty) raises BundleLapsed, as it must")

    print("")
    print("self-test %s" % ("FAILED (%d case(s))" % bad if bad else "OK"))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(_selftest())
