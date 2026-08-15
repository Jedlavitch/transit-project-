#!/usr/bin/env python3
"""
interesting.py — the scorer from interesting.js, ported for a bot with no board.

WHAT THIS IS
  A faithful port of the SCORING half of interesting.js: the weight tables, the
  rarity registry, and the three scorers (aircraft, Amtrak, everything else on
  rails). Nothing here fetches, stores or posts. It is handed already-fetched
  dicts and hands back scored entries, so the gathering side can be rewritten
  per city without touching a single weight.

WHAT WAS DELIBERATELY LEFT BEHIND
  Everything that needed a browser: localStorage, the card, the nav link, the
  jsonblob publish, the DOM scrape. Two consequences worth stating out loud
  rather than discovering later:

    * The browser re-ran its pass every 20 seconds, so from the second pass of
      the day onward a token had already been noted and later sightings scored
      LOWER. A bot that samples a day and notes once at the end never does that,
      so it will score marginally HIGHER than a board watching the same sky.
      That is closer to the documented intent (score against yesterday's
      knowledge), not a bug — but it is the first thing that will look wrong if
      anyone compares this against a board's "Today's best".

    * The board let a viewer hide a card, and a hidden card was not scored. A
      bot has no viewer, so it scores every system its caller hands it.

  Day boundaries are NOT decided here. interesting.js used the viewing device's
  local midnight, which on a GitHub runner is UTC — and the daily job fires at
  23:10 UTC, which is 01:10 TOMORROW in Amsterdam, Zurich, Cologne and
  Stuttgart. A naive port files four cities' evenings under the next day and
  resets their lists mid-evening. So `day` is a caller-supplied argument on
  every registry function, and `city_day()` below is the correct way to compute
  it: per city, in that city's own zone.

THE PHRASING IS NOT THE BROWSER'S
  rarePhrase() said "the first A380 this board has shown", and scoreRow appended
  "on this board". There is no board here. Repeating those sentences would be
  publishing a claim about a thing that does not exist, so the phrasing is keyed
  to what this registry can actually vouch for: how many days of history it is
  holding. "The first Airbus A380 over Washington DC in 30 days" is checkable
  against the registry file; "this board has shown" is not checkable at all.
  See rare_phrase() for the retention-window reasoning.

WHAT IT WILL NOT CLAIM
  A missing feed and an empty sky are different facts, and neither is decided
  here — this file only scores what it is given. A caller that hands over an
  empty aircraft list because the ADS-B proxy returned {"error":"upstream 429"}
  will get zero entries back, and it must not report that as a quiet day.

PORTED FROM
  interesting.js (all tables and scorers) and delays.js:114-121 (amtrakLateMin),
  which interesting.js reached through window.amtrakLateMin and which therefore
  has to travel with it.

STDLIB ONLY. Target Python 3.11+ (the ubuntu-latest runner); it also runs on
3.9, which is what a macOS system Python offers for local testing.
"""

import math
import re

# ---------------------------------------------------------------- constants
# Copied from interesting.js:68-93. These are tuned numbers, not preferences:
# every one of them has a measurement behind it in the original's comments.

KEEP_PER_CITY = 12        # stored per city per day; the page shows 10
RESERVE_PER_KIND = 4      # ...of which each kind is guaranteed this many
ARCHIVE_MAX = 30          # days of past winners kept
SEEN_HALFLIFE = 45        # days after which a token is forgotten entirely

# Deliberately low. A registry's first week has no history to be rare against,
# so the learned half scores almost nothing and a high floor would leave every
# new city saying "nothing out of the ordinary" for days. The cap of twelve per
# city does the real filtering: rank order is what matters.
MIN_SCORE = 3

# How remarkable a NON-airline aircraft must be, on universal signals alone, to
# be scored at all while the default airline-only scope is on.
#
# Measured against live traffic rather than guessed. At 32 a Maryland State
# Police AW-139 reached second place on the DC board with 34 — AGENCY_OPERATOR
# 26 plus 8 for being low overhead. 45 puts that whole class back out: a police
# or medevac helicopter tops out around 34, while everything genuinely worth
# stopping for clears it comfortably — a Special Air Mission 58, an An-124 76,
# anything squawking 7700 62, a C-17 114, a B-17 124.
NON_AIRLINE_BAR = 45


# ---------------------------------------------------------------- the cities
# Eleven, not twelve. Four independent lists in the repo agree exactly
# (interesting.js:98-110, leaderboard.html, index.html, post-daily.py's
# CITY_LABELS) and none contains a twelfth; stencil.html looks like a board but
# is the city-setup template. Any "all cities" caption that says twelve is a
# checkable false statement on day one.
#
# Order is the boards' own picker order, so anything built from this list reads
# the same way round as the rest of the product. `id` matches the ?city=
# parameter the shared pages already use AND post-daily.py's CITY_LABELS keys —
# change one and pick()/city_label() there stop resolving.
#
# lat/lon are each board's own default location, read out of the board files —
# NOT a city centroid. Washington's is Bethesda, MD (dc.html:810), New Jersey's
# is Newark Penn Station, Boston's is South Station. Using a centroid instead
# would quietly change which aircraft are in range.
#
# tz is supplied HERE because the boards mostly do not declare one: only the
# three European stencil boards (zurich/cologne/stuttgart) set CFG.tz, and only
# the ams-*, la-* and sf-* schedule bundles carry a tz field. Everything else
# fell back to the viewing device's clock, which is exactly the trap described
# in the module docstring.
CITIES = [
    {"id": "dc",        "label": "Washington DC",  "lat": 38.9582, "lon": -77.1080, "tz": "America/New_York"},
    {"id": "philly",    "label": "Philadelphia",   "lat": 39.9812, "lon": -75.1563, "tz": "America/New_York"},
    {"id": "nj",        "label": "New Jersey",     "lat": 40.7346, "lon": -74.1643, "tz": "America/New_York"},
    {"id": "nyc",       "label": "New York",       "lat": 40.7506, "lon": -73.9935, "tz": "America/New_York"},
    {"id": "boston",    "label": "Boston",         "lat": 42.3519, "lon": -71.0552, "tz": "America/New_York"},
    {"id": "amsterdam", "label": "Amsterdam",      "lat": 52.3791, "lon":   4.9003, "tz": "Europe/Amsterdam"},
    {"id": "la",        "label": "Los Angeles",    "lat": 34.0562, "lon": -118.2365, "tz": "America/Los_Angeles"},
    {"id": "sf",        "label": "San Francisco",  "lat": 37.7844, "lon": -122.4078, "tz": "America/Los_Angeles"},
    {"id": "zurich",    "label": "Zurich",         "lat": 47.3779, "lon":   8.5403, "tz": "Europe/Zurich"},
    {"id": "cologne",   "label": "Cologne",        "lat": 50.9430, "lon":   6.9588, "tz": "Europe/Berlin"},
    {"id": "stuttgart", "label": "Stuttgart",      "lat": 48.7838, "lon":   9.1817, "tz": "Europe/Berlin"},
]

CITY_BY_ID = {c["id"]: c for c in CITIES}


# ---------------------------------------------------------------- the tables
# Copied verbatim from interesting.js. These are tuned data, not logic, and any
# drift silently changes every score in every city.

# Aircraft that are notable anywhere. Deliberately short: this list is for types
# a person would cross a road to look at regardless of where they live, and
# everything else is left to the learned half, which knows what is normal here.
PLANE_TYPES = {
    "A388": (46, "an Airbus A380 — the biggest airliner flying"),
    "A124": (58, "an Antonov An-124 heavy lifter"), "AN24": (30, "an Antonov An-24"),
    "A225": (95, "the Antonov An-225"),
    "B741": (44, "an early Boeing 747"), "B742": (44, "a Boeing 747-200"),
    "B743": (44, "a Boeing 747-300"), "B744": (38, "a Boeing 747-400"),
    "B748": (36, "a Boeing 747-8"), "B74S": (46, "a shortened Boeing 747SP"),
    "BLCF": (52, "a Boeing Dreamlifter"), "A337": (46, "an Airbus Beluga"),
    "A3ST": (52, "an Airbus Beluga"),
    "MD11": (42, "an MD-11 — nearly all of them are freighters now"),
    "DC10": (46, "a DC-10"), "L101": (52, "a Lockheed TriStar"),
    "B703": (55, "a Boeing 707"), "CONC": (99, "Concorde"),
    "A342": (34, "an Airbus A340"), "A343": (34, "an Airbus A340"),
    "A345": (40, "an A340-500"), "A346": (40, "an A340-600"),
    "C17": (36, "a C-17 Globemaster"), "C5M": (48, "a C-5 Galaxy"),
    "B52": (58, "a B-52"), "E3TF": (46, "an E-3 Sentry AWACS"), "E3CF": (46, "an E-3 Sentry"),
    "E6": (52, "an E-6 Mercury"), "K35R": (30, "a KC-135 tanker"), "KC35": (30, "a KC-135 tanker"),
    "K35E": (30, "a KC-135 tanker"), "KC46": (32, "a KC-46 tanker"), "KC10": (38, "a KC-10 tanker"),
    "P8": (30, "a P-8 Poseidon"), "C130": (24, "a C-130 Hercules"), "C30J": (24, "a C-130J"),
    "U2": (72, "a U-2 — they are rarely visible at all"),
    "B461": (26, "a BAe 146"), "B462": (26, "a BAe 146"), "B463": (26, "a BAe 146"),
    # pre-war and post-war survivors: if one of these is overhead, it is an
    # airshow transit and there is nothing else on the board to touch it
    "DC3": (64, "a Douglas DC-3"), "C47": (64, "a Douglas C-47"),
    "DC6": (62, "a Douglas DC-6"), "CVLT": (52, "a Convair"),
    "B17": (78, "a B-17 Flying Fortress"), "B25": (72, "a B-25 Mitchell"),
    "P51": (68, "a P-51 Mustang"), "SPIT": (78, "a Spitfire"),
    "T6": (46, "a T-6 Texan"), "AN2": (52, "an Antonov An-2 biplane"),
    "JU52": (82, "a Junkers Ju 52"), "LANC": (88, "an Avro Lancaster"),
}

# Callsign prefixes that say what a flight IS when the type does not. Matched on
# the alphabetic head of the callsign.
#
# THIS MUST STAY AN ORDERED LIST. Both is_airline_flight() and score_plane()
# walk it and take the FIRST prefix that hits, then stop. Sorting it, or making
# it a dict, changes which of two overlapping prefixes wins.
CALLSIGN_TAGS = [
    ("RCH",       34, "a US Air Force Reach cargo flight"),
    ("SAM",       58, "a Special Air Mission — US government VIP"),
    ("EXEC1",     95, "Air Force One"),
    ("VENUS",     62, "a UK royal or ministerial flight"),
    ("KITTY",     40, "a US Air Force training flight"),
    ("DOOM",      56, "a US bomber mission callsign"),
    ("JAKE",      40, "a US Air Force tanker"),
    ("PAT",       38, "US Army Priority Air Transport"),
    ("NAVY",      38, "a US Navy aircraft"),
    ("ARMY",      36, "a US Army aircraft"),
    ("CNV",       34, "a US Navy logistics flight"),
    ("EVAC",      52, "an aeromedical evacuation flight"),
    ("LIFEGUARD", 48, "a Lifeguard flight — a medical priority"),
    ("MEDEVAC",   48, "a medical evacuation"),
    ("ANGEL",     40, "an air-ambulance flight"),
    ("COAST",     40, "a Coast Guard aircraft"),
    ("RESCUE",    46, "a search-and-rescue flight"),
    ("FIREBIRD",  38, "a firefighting aircraft"),
    ("TANKER",    36, "an air tanker"),
]

# Named Amtrak services worth remarking on, and WHY each one is — the wording
# matters, because calling a Northeast Regional "one of the long-distance
# trains" is wrong in a way anyone who knows the corridor spots immediately.
# The Regional is not in this table at all: it is the most ordinary train on the
# busiest line in the country.
#
# Priced by HOW OFTEN THE SERVICE RUNS, which is what makes a sighting rare.
# Three-a-week trains sit at the top; once-daily around 20; and the Acela sits
# near the bottom despite being the famous one, because roughly twenty round
# trips a weekday pass through a 60-mile radius on five of these boards. It kept
# winning for being famous rather than for being unusual.
NAMED_TRAINS = {
    "empire builder":      (40, "one of the long-distance trains — Chicago to the Pacific Northwest"),
    "california zephyr":   (42, "one of the long-distance trains — Chicago to San Francisco Bay"),
    "southwest chief":     (40, "one of the long-distance trains — Chicago to Los Angeles"),
    "sunset limited":      (44, "the least frequent long-distance train in the country"),
    "texas eagle":         (38, "a long-distance train, Chicago to San Antonio"),
    "coast starlight":     (38, "a long-distance train, Seattle to Los Angeles"),
    "lake shore limited":  (32, "an overnight long-distance train to Chicago"),
    "capitol limited":     (30, "an overnight long-distance train to Chicago"),
    "cardinal":            (36, "a long-distance train, and only three days a week"),
    "city of new orleans": (34, "an overnight long-distance train"),
    "crescent":            (32, "an overnight long-distance train, New York to New Orleans"),
    "silver star":         (30, "an overnight long-distance train to Florida"),
    "silver meteor":       (30, "an overnight long-distance train to Florida"),
    "floridian":           (34, "a long-distance train to Florida"),
    "auto train":          (34, "the Auto Train — it carries its passengers' cars"),
    "palmetto":            (20, "a long-distance daytime train to Savannah"),
    "adirondack":          (26, "a scenic long-distance train toward Montreal"),
    "maple leaf":          (24, "a cross-border train to Toronto"),
    "ethan allen express": (20, "a long-distance train into Vermont"),
    "vermonter":           (22, "a long-distance train into Vermont"),
    "borealis":            (22, "one of the newest long-distance services"),
    "pennsylvanian":       (18, "a daily through train over the Alleghenies"),
    # An Acela is the fastest train in the country and also runs many times a
    # day past every board on the corridor. Worth naming, not worth winning.
    "acela":               (10, "the Acela — the fastest train in the country"),
}

# Operators that make an aircraft interesting whatever it is. A county police
# helicopter is a more unusual thing to have overhead than another A319, and no
# amount of learned rarity gets there on day one.
#
# re.ASCII is not decoration. JS's \b is ASCII-only, so /\b(city of)\b/i matches
# inside "City ofé" because é is a non-word character to JS; Python's Unicode \b
# does not. These boards carry German, Dutch and Swiss operator names, so the
# difference fires in practice.
AGENCY_OPERATOR = re.compile(
    r"\b(police|sheriff|state patrol|highway patrol|county of|city of|air force|army|navy|"
    r"marine corps|coast guard|customs|border|nasa|noaa|forest service|fire|ambulance|"
    r"air ambulance|medstar|life ?flight|national guard)\b",
    re.IGNORECASE | re.ASCII)

# The escape hatch that goes with it, used at both call sites: an operator whose
# name contains "airlines"/"airways"/"air lines" is an airline even if it also
# contains "fire" or "border".
AIRLINE_WORD = re.compile(r"airlines|airways|air lines", re.IGNORECASE)

# Widebodies, by ICAO type. Two aisles is the most visible difference there is
# between one airliner and another from the ground.
#
# fullmatch, not match: Python's `$` also matches before a trailing newline, so
# "A388\n" would pass a plain .match() where JS rejects it.
WIDEBODY = re.compile(
    r"^(A30B|A306|A310|A30F|A332|A333|A337|A338|A339|A33F|A342|A343|A345|A346|A359|A35K|"
    r"A358|A388|B742|B743|B744|B748|B74S|B74F|B762|B763|B764|B772|B773|B77W|B77L|B77F|"
    r"B788|B789|B78X|IL96|MD11|DC10|L101|A124|A225|C5M|C17)$")

# Rotorcraft, by the ADS-B emitter category first — "A7" is the field's own
# answer and does not depend on guessing from a model name. The type list is the
# fallback for feeds that omit the category, and covers the machines that
# actually orbit a city: police, air ambulance, news, tour.
#
# PREFIX-ANCHORED WITH NO TRAILING ANCHOR — it is a startswith test, so this one
# uses re.match, never fullmatch. re.ASCII narrows \d back to JS's meaning.
HELI_TYPES = re.compile(
    r"^(B06|B07|B27|B29|B37|B39|B42|B429|B430|B47|EC[0-9]|EC[35]\d|H[0-9]{2}|A109|A119|"
    r"A139|A169|A189|AS[0-9]{2}|AS3[25]|R22|R44|R66|S76|S92|S64|UH1|H60|H500|MD5\d|MD90|"
    r"GAZL|EN28|EXPL|NH90|TIGR)", re.ASCII)

# A scheduled airline flight's callsign: three letters then a flight number. A
# tail number in the callsign field — N212FX — is general aviation and fails
# this by design.
#
# re.ASCII because Python's \d matches Unicode digits and JS's does not;
# fullmatch because of the trailing-newline difference.
AIRLINE_CALLSIGN = re.compile(r"^[A-Z]{3}\d{1,4}[A-Z]?$", re.ASCII)

# Cancellation wording as the boards render it, in four languages.
#
# NO re.ASCII HERE, deliberately. This pattern has to fold the umlaut in
# "fällt aus" — under re.ASCII, "FÄLLT AUS" would stop matching "fällt aus",
# and the German boards are exactly where this signal comes from.
CANCEL_RE = re.compile(r"cancel|fällt aus|falt aus|vervallen|uitgevallen", re.IGNORECASE)

# Rarity ladder, interesting.js:296-304. It is a table wearing an if-chain; it
# is not a curve and must not be "simplified" into one.
_RARITY_LADDER = ((1, 0.75), (2, 0.55), (4, 0.35), (8, 0.18))


# ---------------------------------------------------------------- primitives

def jsround(x):
    """
    Math.round: half-UP, always. Python's round() is half-to-EVEN and the
    difference is not theoretical here — with maturity at 1.0 the learned
    weights land exactly on .5 four times: 30*0.75=22.5, 30*0.55=16.5,
    30*0.35=10.5, 14*0.75=10.5. Python's round() gives 22/16/10/10 where JS
    gives 23/17/11/11. A routine bundled rail row totals exactly 3 against
    MIN_SCORE=3, so one point of rounding decides whether it is stored at all.

    Use this for EVERY Math.round in the original. There are no exceptions.
    """
    return int(math.floor(x + 0.5))


def num(v):
    """
    typeof v === "number" && isFinite(v).

    Two traps. bool is a subclass of int in Python, so JSON `true` would sail
    through isinstance(v, int) as the number 1. And the feed really does send
    non-numbers in numeric fields: alt_baro arrives as the STRING "ground" for
    aircraft on the ground, which is precisely what this must reject.
    """
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return v if math.isfinite(v) else None


def clean(s):
    """
    String(s == null ? "" : s).trim(), with JS's stringification rather than
    Python's where they differ.

    The bool and float-integer cases look like pedantry and are not: these
    strings become registry TOKENS. "1000.0" and "1000" would be two different
    tokens for the same thing, forking the vocabulary and making both look rarer
    than either is.
    """
    if s is None:
        return ""
    if s is True:
        return "true"
    if s is False:
        return "false"
    if isinstance(s, float) and math.isfinite(s) and s.is_integer():
        return str(int(s)).strip()
    return str(s).strip()


_TIDY_UPPER = re.compile(r"^[A-Z]+$")


def tidy(s):
    """
    The ADS-B description arrives shouting — "BOEING 737 MAX 8", "BOMBARDIER
    Regional Jet CRJ-700". That is fine in a dense board row and wrong as the
    headline of a share card, so manufacturer words get title-cased while short
    all-caps tokens (MAX, CRJ-700, A-319) are left exactly as they are, because
    those are how the type is actually written.

    split(" ") not split(): JS's split on a single space keeps empty strings for
    runs of spaces, and joining them back preserves the original spacing.
    """
    out = []
    for w in clean(s).split(" "):
        if len(w) > 3 and w == w.upper() and _TIDY_UPPER.match(w):
            out.append(w[0] + w[1:].lower())
        else:
            out.append(w)
    return " ".join(out)


_ART_VOWEL = re.compile(r"^[AEIOU]")
_ART_SAID = re.compile(r"^[FHLMNRSX]$")
_ART_LOWER = re.compile(r"^[a-z]")


def article(word):
    """
    "a Acela" and "an B429" are the kind of thing that makes a generated
    sentence read as generated.

    The second test is transcribed literally, double negative and all: letters
    that are SAID with a leading vowel take "an" even though they are consonants
    — an A319, an F-16, an MD-11, an L-1011. The `not lowercase` check rather
    than `isupper` matters because a DIGIT must also pass, as in "F16".
    """
    w = clean(word)
    if not w:
        return "a"
    first = w[0].upper()
    if _ART_VOWEL.match(first):
        return "an"
    if _ART_SAID.match(first) and len(w) > 1 and not _ART_LOWER.match(w[1]):
        return "an"
    return "a"


def ord_(n):
    """Ordinal with the 11/12/13 exception. `ord` is a builtin, hence the tail."""
    if 11 <= n % 100 <= 13:
        return "%dth" % n
    return "%d%s" % (n, {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th"))


_INT_HEAD = re.compile(r"^[+-]?\d+", re.ASCII)


def _parse_int(v):
    """
    parseInt(v, 10): leading sign, leading digits, stop at the first thing that
    is not one. Returns None where JS returns NaN, which is what the vintage
    ladder tests for — a.year arrives as the STRING "2023" in this feed.
    """
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return int(v) if math.isfinite(v) else None
    m = _INT_HEAD.match(str(v if v is not None else "").strip())
    return int(m.group(0)) if m else None


def _locale_num(n):
    """
    Number.prototype.toLocaleString() as an en-US runner renders it: "9,575".
    Integral floats lose the ".0" first, because JS has no such thing and
    "9,575.0 ft" on a share card would look like a bug.
    """
    if isinstance(n, float) and n.is_integer():
        n = int(n)
    return "{:,}".format(n)


# ------------------------------------------------------------ days and zones

def _as_date(s):
    """A 'YYYY-MM-DD' registry stamp as a date, or None if it will not parse."""
    if not isinstance(s, str):
        return None
    try:
        from datetime import date
        return date.fromisoformat(s.strip())
    except (ValueError, TypeError):
        return None


def days_between(a, b):
    """
    Whole days from a to b, both 'YYYY-MM-DD'.

    The original used Date.parse + Math.round because JS parses a bare
    'YYYY-MM-DDT00:00:00' as LOCAL time, so across a DST boundary the raw delta
    is not a whole number of days. Python's date arithmetic is exact and needs
    no rounding. Returns 0 when either stamp is unparseable — matching the
    original — but note prune() does NOT rely on that: see its comment.
    """
    da, db = _as_date(a), _as_date(b)
    if da is None or db is None:
        return 0
    return (db - da).days


def city_day(city, now=None):
    """
    Today's 'YYYY-MM-DD' in one city's own zone.

    THIS IS THE MOST IMPORTANT FOUR LINES IN THE FILE for anything that runs on
    a schedule. interesting.js used the viewing device's local midnight, which
    was right for a kiosk and is wrong for a runner: the daily job fires at
    23:10 UTC, which is 01:10 the NEXT day in Europe/Amsterdam, Europe/Zurich
    and Europe/Berlin. Computing the day once, globally, files four cities'
    evenings under tomorrow and resets their lists mid-evening.

    `city` is a CITIES entry or a city id. No UTC fallback: if the zone database
    is missing this raises, because a wrong day is worse than a failed city and
    the caller is expected to be scoring cities inside a try/except anyway.
    """
    from datetime import datetime
    from zoneinfo import ZoneInfo
    if isinstance(city, str):
        city = CITY_BY_ID[city]
    when = now or datetime.now(ZoneInfo(city["tz"]))
    # A naive datetime is taken as already being that city's wall clock, which
    # is what the original did with the device clock. Anything tz-aware is
    # converted, so passing datetime.now(timezone.utc) from a runner is correct.
    if when.tzinfo is not None:
        when = when.astimezone(ZoneInfo(city["tz"]))
    return when.strftime("%Y-%m-%d")


# ---------------------------------------------------------- the rarity registry
# Keyed by city, then by token ("type:A388", "op:Emirates", "route:Empire
# Builder"). What is stored is the number of DISTINCT DAYS the token has been
# seen, not the number of sightings: an aircraft that loiters over the city for
# an hour would otherwise teach the registry that its type is common, which is
# the exact opposite of the truth.

def seen_city(reg, city):
    """
    The live per-city dict, created if absent. It MUST be the parent's own dict
    and not a copy — note_seen() and prune() both mutate through it.
    """
    return reg.setdefault(city, {})


def note_seen(reg, city, tokens, day):
    """
    Record today's sightings. Returns True if anything changed, which is what
    gates the prune-and-write in the caller.

    Distinct days, not sightings: `rec["last"] != day` is the whole mechanism.
    """
    c = seen_city(reg, city)
    changed = False
    for t in tokens or []:
        if not t:
            continue
        rec = c.get(t)
        if not rec:
            c[t] = {"d": 1, "last": day, "first": day}
            changed = True
            continue
        if rec.get("last") != day:
            rec["d"] = (rec.get("d") or 0) + 1
            rec["last"] = day
            changed = True
    return changed


def prune(reg, day):
    """
    Drop tokens nothing has seen in a month and a half, so the registry cannot
    grow without bound.

    TWO PORTING TRAPS, both real. Deleting while iterating is legal in JS and
    raises RuntimeError in Python, so the key list is snapshotted first. And the
    original read c[t].last with no null guard — unlike maturity(), which guards
    the same access — from a call site that was not inside a try, so one
    half-written record killed the whole pass.

    Deliberate divergence: a record whose `last` will not parse is DELETED here.
    The original's daysBetween returned 0 for an unparseable stamp, which made
    such a record immortal — it could never age out and would be re-examined
    every run forever. Dropping it costs one token's history and bounds the file.
    """
    for city in list(reg.keys()):
        c = reg.get(city)
        if not isinstance(c, dict):
            del reg[city]
            continue
        for t in list(c.keys()):
            rec = c.get(t)
            if not isinstance(rec, dict) or _as_date(rec.get("last")) is None:
                del c[t]
                continue
            if days_between(rec["last"], day) > SEEN_HALFLIFE:
                del c[t]


def rarity(city_reg, token):
    """
    Rarity of one token, 0..1, where 1 is "never seen here".

    `is None`, not falsiness: an empty dict is falsy too, and would wrongly read
    as never-seen.
    """
    rec = city_reg.get(token)
    if rec is None:
        return 1
    d = rec.get("d") or 0
    for threshold, value in _RARITY_LADDER:
        if d <= threshold:
            return value
    return 0.05


def maturity(city_reg):
    """
    How much history has this city accumulated? Used to damp the learned half of
    the score: with three days of watching, "never seen before" means "this only
    started on Tuesday".

    THE FLOOR MATTERS MORE THAN THE RAMP. Damping to literally zero on a new
    registry did not make the leaderboard humble, it made it wrong: every
    learned signal vanished, and since ordinary airliners have almost no
    history-free signal while every Amtrak train has a named-service or lateness
    bonus, the card filled with trains on all eleven boards. "The first A380
    here" is TRUE on day one — it is merely less impressive than it will be in a
    month. So scale it down, never out.

    With a few hundred tokens noted on the first run, n/80 is already >= 1 and
    distinct/4 governs: 0.28 on day one, 0.5 day two, 0.75 day three, 1.0 from
    day four.
    """
    days = {}
    n = 0
    for rec in (city_reg or {}).values():
        if rec and rec.get("last"):
            days[rec["last"]] = 1
            n += 1
    distinct = len(days)
    ramp = min(1, min(distinct / 4, n / 80))
    return max(0.28, ramp)


def watch_window(city_reg):
    """
    How many days of history this registry can actually vouch for, which is what
    every rarity sentence is keyed to.

    Capped at SEEN_HALFLIFE, and that cap is the honest part. prune() deletes
    any token not seen in 45 days, so however long this has been running, the
    retained data can only support a claim about the last 45 days. A registry
    that has been going a year still cannot say "the first A380 in 365 days" —
    an A380 seen on day 200 and never since has been forgotten, and the claim
    would be unbacked.

    Returns 0 when there is no history at all, which callers read as "say
    nothing about a window".
    """
    first, last = None, None
    for rec in (city_reg or {}).values():
        if not isinstance(rec, dict):
            continue
        f, l = _as_date(rec.get("first")), _as_date(rec.get("last"))
        if f is not None and (first is None or f < first):
            first = f
        if l is not None and (last is None or l > last):
            last = l
    if first is None or last is None:
        return 0
    span = (last - first).days + 1          # inclusive: one day of data is 1
    return max(0, min(span, SEEN_HALFLIFE))


# ================================ SCORING ==================================
# Each signal contributes a weight AND a sentence. The sentence is the point: a
# leaderboard that says "score 84" tells you nothing, and one that says "first
# Antonov here in 30 days, and it's squawking 7700" is the thing worth putting
# on a screen. Reasons are sorted by weight and the top few are what gets posted.

def push(rs, w, text):
    """
    if (w > 0) rs.push({w: Math.round(w), t: text}).

    THE WEIGHT IS ROUNDED HERE, BEFORE IT IS SUMMED. finish() then totals
    already-rounded integers, so the score is a sum of rounded parts and never a
    rounded sum. The two differ, and the difference is what decides a marginal
    entry against MIN_SCORE.

    A NaN weight fails `w > 0` silently in JS; here it is rejected explicitly,
    because silently dropping a signal is how a scoring bug hides for a month.
    """
    if w is None or isinstance(w, bool) or not isinstance(w, (int, float)):
        return
    if not math.isfinite(w) or w <= 0:
        return
    rs.append({"w": jsround(w), "t": text})


def finish(rs, entry):
    """
    Total the weights, then keep only the reasons worth reading. A "+1 only the
    3rd day with a service to New York Penn" is true, contributes almost
    nothing, and crowds out the reason the thing actually won — so it counts
    toward the score and stays out of the sentence list.
    """
    total = 0
    for r in rs:
        total += r["w"]
    ordered = sorted(rs, key=lambda r: -r["w"])          # stable, like JS's sort
    shown = [r for r in ordered if r["w"] >= 4]
    if not shown and ordered:
        shown = ordered[:1]
    entry["score"] = jsround(total)
    entry["reasons"] = shown[:4]
    return entry


def rare_phrase(city_reg, token, subject, use_article, place=""):
    """
    One sentence saying how unusual a thing is here.

    THIS IS WHERE THE PORT DELIBERATELY STOPS BEING A PORT. The original said
    "the first X this board has shown", and scoreRow appended "on this board".
    There is no board. A bot that says "this board has shown" is describing
    something that does not exist, and the sentence is printed on a public card
    where it cannot be checked against anything.

    So the claim is keyed to what the registry can actually back: its retention
    window. "The first Airbus A380 over Washington DC in 30 days" is a statement
    somebody could verify against bot-seen.json. When there is no window yet —
    the first run, or every record created today — the window clause is dropped
    rather than faked, because "in 1 days" is both ungrammatical and a claim
    about nothing.

    `use_article` is off for proper nouns: "only the 2nd day with a PSA Airlines"
    is not English. `place` is a ready-made prepositional phrase (" over
    Washington DC") supplied by the scorer, because the right preposition
    depends on the kind — an aeroplane is over a city, a train is near one.

    d + 1, not d: this runs BEFORE note_seen, so the record does not yet include
    today. Today is what makes it the (d+1)th day.
    """
    rec = city_reg.get(token)
    art = (article(subject) + " ") if use_article else ""
    span = watch_window(city_reg)
    if rec is None:
        if span >= 2:
            return "the first %s%s in %d days" % (subject, place, span)
        return "the first %s%s since this started watching" % (subject, place)
    d = rec.get("d") or 0
    if d <= 2:
        if span >= 2:
            return "only the %s day with %s%s%s in %d days" % (ord_(d + 1), art, subject, place, span)
        return "only the %s day with %s%s%s" % (ord_(d + 1), art, subject, place)
    # Deliberately NOT "seen on d of the last N days": d is cumulative over the
    # record's whole life and can exceed the window, so that phrasing would
    # eventually print "seen on 400 of the last 45 days".
    return "%s%s%s, seen here on %d days so far" % (art, subject, place, d)


# ---------------------------------------------------------------- aircraft

def operator(a):
    """
    The operator, which is the closest thing to a LIVERY signal that exists.

    The browser preferred the board's operatorFor(), which read a cached adsbdb
    answer — the only thing that stops an American Airlines jet reading as
    "Wilmington Trust Trustee". Server-side there is no such cache, so the
    convention is that the fetch layer merges its adsbdb answer onto the
    aircraft dict as `op` before calling in here, and ownOp is the fallback.

    This string is a REGISTRY TOKEN. An inconsistent resolution order forks the
    token vocabulary — the same airline under two spellings looks half as
    common as it is — so the order is pinned here and must not be varied per
    city. Measured: adsb.fi supplies ownOp for US registrations and NOTHING for
    European ones, so without adsbdb enrichment every op: token dies in Zurich,
    Cologne and Stuttgart.
    """
    return clean(a.get("op")) or clean(a.get("ownOp"))


def route_of(a):
    """
    The flight's city pair, if the fetch layer resolved one. Same convention as
    operator(): adsbdb's answer merged on as `route`, shaped
    {from, to, flat, flon, tlat, tlon}. Absent means the long-haul reasons are
    simply not scored — never guessed from the aircraft's heading.
    """
    rt = a.get("route")
    return rt if isinstance(rt, dict) else None


def short_type(a):
    return tidy(a.get("desc")) or clean(a.get("t")) or "aircraft"


def title_of(a):
    return tidy(a.get("desc")) or clean(a.get("t")) or "Aircraft"


def is_rotor(a):
    """
    Category first — "A7" is the ADS-B field's own answer and does not depend on
    guessing from a model name. HELI_TYPES is the fallback for feeds that omit
    it, and is a PREFIX test (re.match, no trailing anchor).
    """
    if clean(a.get("category")).upper() == "A7":
        return True
    return bool(HELI_TYPES.match(clean(a.get("t")).upper()))


def is_airline_flight(a, op):
    """
    A scheduled airline flight: an ICAO callsign that is not one of the military
    or state prefixes, flown by something that is not a helicopter.

    First prefix hit wins and returns False, which is why CALLSIGN_TAGS is an
    ordered list.
    """
    cs = clean(a.get("flight")).upper()
    if not AIRLINE_CALLSIGN.fullmatch(cs):
        return False
    if is_rotor(a):
        return False
    for prefix, _w, _t in CALLSIGN_TAGS:
        if cs.startswith(prefix):
            return False
    if op and AGENCY_OPERATOR.search(op) and not AIRLINE_WORD.search(op):
        return False
    return True


def plane_tokens(a, op):
    """
    What an admitted aircraft teaches the registry.

    ONLY ADMITTED AIRCRAFT. Learning from aircraft the gate rejected would make
    an airliner look common because a hundred bizjets went past, which is a
    different question from the one being asked.
    """
    out = []
    t = clean(a.get("t")).upper()
    if t:
        out.append("type:" + t)
    if op:
        out.append("op:" + op)
    return out


def nm_between(a, b):
    """Haversine in NAUTICAL miles. The rail side needs the kilometre one; this
    is not it."""
    R, rad = 3440.065, math.pi / 180
    d_lat = (b["lat"] - a["lat"]) * rad
    d_lon = (b["lon"] - a["lon"]) * rad
    h = (math.sin(d_lat / 2) ** 2 +
         math.cos(a["lat"] * rad) * math.cos(b["lat"] * rad) * math.sin(d_lon / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(h))


def plane_detail(a, rt):
    bits = []
    if rt and rt.get("from") and rt.get("to"):
        bits.append("%s → %s" % (rt["from"], rt["to"]))
    alt = num(a.get("alt_baro"))
    if alt is not None:
        bits.append(_locale_num(alt) + " ft")
    gs = num(a.get("gs"))
    if gs is not None:
        bits.append("%d kt" % jsround(gs))
    return " · ".join(bits)


def score_plane(a, city_reg, mat, where=""):
    """
    Score one aircraft. `a` is one entry from the ADS-B proxy's `ac` array, with
    the fetch layer's optional `op`/`route` enrichment merged on.

    DO NOT REORDER THE PUSHES. Everything before the `universal` total is a
    universal signal — true of the aeroplane itself, needing no history — and
    that total is what NON_AIRLINE_BAR is tested against. Moving a learned push
    above the line lets a young registry walk a survey aircraft straight in on
    unfamiliarity alone, which is the failure the bar exists to prevent.
    """
    rs = []
    t = clean(a.get("t")).upper()
    cs = clean(a.get("flight")).upper()
    op = operator(a)
    rt = route_of(a)
    place = (" over " + where) if where else ""

    # --- universal -------------------------------------------------------
    sq = clean(a.get("squawk"))
    if sq == "7700":
        push(rs, 62, "squawking 7700 — a general emergency")
    elif sq == "7600":
        push(rs, 56, "squawking 7600 — radio failure")
    elif sq == "7500":
        push(rs, 72, "squawking 7500 — unlawful interference")
    em = clean(a.get("emergency")).lower()
    if em and em != "none":
        push(rs, 50, "declaring an emergency")

    if t in PLANE_TYPES:
        push(rs, PLANE_TYPES[t][0], PLANE_TYPES[t][1])

    m = re.match(r"[A-Z]+", cs)
    head = m.group(0) if m else ""
    for prefix, weight, text in CALLSIGN_TAGS:
        if head == prefix or cs.startswith(prefix):
            push(rs, weight, text)
            break

    yr = _parse_int(a.get("year"))
    if yr and yr < 1970:
        push(rs, 46, "built in %d" % yr)
    elif yr and yr < 1985:
        push(rs, 26, "built in %d" % yr)
    elif yr and yr < 1995:
        push(rs, 12, "built in %d" % yr)

    # SIZE IS PART OF THE TYPE. A widebody is a visibly different aeroplane from
    # the narrowbodies that make up almost all traffic, and at most of these
    # cities it is genuinely the unusual sight — but it is not in the universal
    # table, because a widebody over JFK is Tuesday. So it scores modestly on
    # its own and lets the learned half decide how odd it is HERE.
    if WIDEBODY.fullmatch(t):
        push(rs, 18, "a widebody — " + short_type(a))

    # Kinematics deliberately score low. Altitude and speed say what a flight is
    # doing, not what it IS, and this is about the aeroplane.
    alt = num(a.get("alt_baro"))
    if alt is not None and alt >= 45000:
        push(rs, 12, "cruising at %s ft, above the airliners" % _locale_num(alt))
    elif alt is not None and 0 < alt < 900:
        push(rs, 8, "low overhead at %s ft" % _locale_num(alt))

    gs = num(a.get("gs"))
    if gs is not None and gs >= 540:
        push(rs, 8, "%d kt over the ground" % jsround(gs))

    if rt and rt.get("from") and rt.get("to"):
        leg = None
        # All FOUR coordinates, not just the two latitudes the original checked.
        # JS turned a missing longitude into NaN and quietly skipped the reason;
        # Python would raise a KeyError and take the whole aircraft down with it.
        ends = [num(rt.get(k)) for k in ("flat", "flon", "tlat", "tlon")]
        if all(v is not None for v in ends):
            leg = nm_between({"lat": ends[0], "lon": ends[1]},
                             {"lat": ends[2], "lon": ends[3]})
        if leg is not None and leg >= 3400:
            push(rs, 18, "flying %s to %s, %s nm" % (rt["from"], rt["to"], _locale_num(jsround(leg))))
        elif leg is not None and leg >= 1900:
            push(rs, 9, "a long haul, %s to %s" % (rt["from"], rt["to"]))

    # An agency aircraft is interesting from the first day, before the registry
    # has learned anything — which is the gap the learned half cannot fill.
    if op and AGENCY_OPERATOR.search(op) and not AIRLINE_WORD.search(op):
        push(rs, 26, "operated by %s, not an airline" % op)

    # --- learned ---------------------------------------------------------
    # THE TWO THINGS THIS IS ABOUT.
    #
    # Type carries the most weight of anything learned: an aeroplane that has
    # not turned up here before is the answer to "what was the most interesting
    # thing today", far more than how fast it was going.
    #
    # Operator is the closest thing to a livery signal that exists. No feed
    # broadcasts paint — ADS-B carries a type code, a registration and a
    # callsign, and nothing about what the aircraft looks like. What it does
    # carry is who operates it, and an airline rarely seen over this city is a
    # colour scheme rarely seen over this city, which is the same sighting. Said
    # that way in the reason text, because claiming to detect a special livery
    # would be inventing a capability the data does not have.
    universal = 0
    for r in rs:
        universal += r["w"]

    if t:
        push(rs, 52 * rarity(city_reg, "type:" + t) * mat,
             rare_phrase(city_reg, "type:" + t, short_type(a), True, place))
    # Just "<operator> colours" — rare_phrase supplies the rest of the sentence.
    # Passing a place phrase into the subject as well produced "the first
    # Maryland State Police colours over Washington over Washington".
    if op:
        push(rs, 34 * rarity(city_reg, "op:" + op) * mat,
             rare_phrase(city_reg, "op:" + op, op + " colours", False, place))

    return finish(rs, {
        "uni": jsround(universal),
        "id": "plane:" + (clean(a.get("hex")) or cs or clean(a.get("r"))),
        "kind": "plane",
        "title": title_of(a),
        "sub": " · ".join([s for s in (op, cs or clean(a.get("r"))) if s]),
        "detail": plane_detail(a, rt),
        "hex": clean(a.get("hex")).lower(),
        # Two ways to find a picture, because they answer different questions.
        # `hex` gets the EXACT airframe from planespotters. photo_query gets a
        # representative photo of the type from Wikimedia Commons.
        #
        # Both spellings are emitted on purpose: photo_query is this module's
        # contract, photoQuery is what post-daily.py:147 already reads. One key
        # renamed in silence is a picture that stops appearing and nobody
        # noticing for a week.
        "photo_query": " ".join([s for s in (op, tidy(a.get("desc")) or clean(a.get("t"))) if s]).strip(),
        "photoQuery": " ".join([s for s in (op, tidy(a.get("desc")) or clean(a.get("t"))) if s]).strip(),
        "tokens": plane_tokens(a, op),
        "lat": num(a.get("lat")), "lon": num(a.get("lon")),
    })


def admits_plane(entry, a, op, airline_only=True):
    """
    The one-line gate from interesting.js:822, provided here so nobody
    re-derives it and gets it backwards. It was backwards once, and it quietly
    killed most of the aircraft scoring.

    THE FILTER USED TO RUN BEFORE SCORING. is_airline_flight() rejects
    tail-number callsigns, rotorcraft, agency operators and every CALLSIGN_TAGS
    prefix — which is the exact population that CALLSIGN_TAGS (19 entries,
    34-95 points), AGENCY_OPERATOR, and 28 of the 52 PLANE_TYPES entries
    describe. Every military and every vintage type in that table flies on a
    tail number, not a flight number. So a B-17, a DC-3, an An-124, a C-17 and
    an aircraft squawking 7700 were all discarded before a single point was
    counted: roughly 60% of the universal aircraft scoring was unreachable.

    The filter was right about WHAT it was avoiding and wrong about HOW. The
    thing to keep out is the police helicopter orbiting for an hour — not
    because it is non-airline, but because it is not interesting. So score
    everything, and admit a non-airline aircraft only when its UNIVERSAL half
    clears the bar: it has to be remarkable in itself, not merely unfamiliar.
    That distinction matters because maturity() is floored at 0.28, so on a
    young registry simply being new is worth ~25 points to anything.
    """
    if not airline_only:
        return True
    if is_airline_flight(a, op):
        return True
    return (entry.get("uni") or 0) >= NON_AIRLINE_BAR


# ---------------------------------------------------------------- Amtrak

def next_stop(t):
    """
    The stop the train is working toward: the first one still Enroute or at the
    Station, else the last one in the list. Measured against the live feed:
    Enroute / Departed / Station are the three status values in use.
    """
    st = (t or {}).get("stations")
    if not st:
        return None
    for s in st:
        if s and s.get("status") in ("Enroute", "Station"):
            return s
    return st[-1] or None


def _iso(s):
    """
    Amtraker's stamps are ISO with an offset — '2026-08-15T09:00:00-05:00'.
    fromisoformat handles those directly. The 'Z' swap is for robustness on
    Python < 3.11, where a trailing Z is not accepted; the feed does not
    currently use one, and nothing here depends on that staying true.
    """
    if not isinstance(s, str) or not s.strip():
        return None
    from datetime import datetime
    txt = s.strip()
    if txt.endswith("Z"):
        txt = txt[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(txt)
    except ValueError:
        return None


def amtrak_late_min(stop):
    """
    Minutes late for an Amtrak train, from one station object.

    Ported from delays.js:114-121, which interesting.js reached through
    window.amtrakLateMin. Amtrak's own trainTimely string used to be the source
    and is now empty on every active train — 177 of 177 when that was written —
    so the number is DERIVED: actual arrival minus scheduled arrival, falling
    back to the departure pair at the origin, where there is no arrival.

    Returns None when either half is missing. None is not zero: a train with no
    reported time is not a train running on time.
    """
    if not stop:
        return None
    sch = _iso(stop.get("schArr") or stop.get("schDep"))
    act = _iso(stop.get("arr") or stop.get("dep"))
    if sch is None or act is None:
        return None
    mins = (act - sch).total_seconds() / 60.0
    return jsround(mins) if math.isfinite(mins) else None


def amtrak_tokens(t):
    """What one Amtrak train teaches the registry."""
    out = []
    route, dest = clean(t.get("routeName")), clean(t.get("destName"))
    if route:
        out.append("route:" + route)
    if dest:
        out.append("dest:" + dest)
    return out


def score_amtrak(t, dist_mi, city_reg, mat, where=""):
    """
    Score one Amtrak train. `t` is one train object straight from
    api-v3.amtraker.com/v3/trains; `dist_mi` is how far it is from the city's
    board location, which the caller has already computed (or None).

    This is the one rail path that keeps its live lateness server-side, so it is
    also the one place the lateness ladder still fires outside the live-feed
    cities.
    """
    rs = []
    route = clean(t.get("routeName"))
    dest = clean(t.get("destName"))
    num_train = clean(t.get("trainNum"))
    # \Z not $: Python's $ also matches before a trailing newline, and count=1
    # because the original had no /g.
    key = re.sub(r"\s+service\Z", "", route.lower(), count=1)
    # A train is near a city, not over it.
    place = (" near " + where) if where else ""

    if key in NAMED_TRAINS:
        push(rs, NAMED_TRAINS[key][0], NAMED_TRAINS[key][1])

    late = amtrak_late_min(next_stop(t))
    # LATENESS WAS OVER-REWARDED, and it is why the card filled with trains. A
    # late train is common, not interesting — the Northeast Corridor produces
    # one every hour — and at +22 for merely 45 minutes down it outscored every
    # aircraft in the sky. Only a genuinely extraordinary delay says anything.
    #
    # `is not None`, never truthiness: zero is a real answer, and the
    # early-arrival branch below is about NEGATIVE numbers, which a truthiness
    # test would keep but a `if late:` test would silently drop at exactly zero.
    if late is not None and late >= 180:
        push(rs, 26, "running %d hours late" % jsround(late / 60))
    elif late is not None and late >= 90:
        push(rs, 16, "%d minutes late" % late)
    elif late is not None and late >= 45:
        push(rs, 8, "%d minutes late" % late)
    elif late is not None and late <= -10:
        push(rs, 6, "%d minutes early" % abs(late))

    # Same reasoning: 100 mph is simply what a train on this corridor does.
    v = num(t.get("velocity"))
    if v is not None and v >= 125:
        push(rs, 14, "doing %d mph" % jsround(v))
    elif v is not None and v >= 100:
        push(rs, 6, "doing %d mph" % jsround(v))

    universal = 0
    for r in rs:
        universal += r["w"]

    # The original appended " on this board" here. Dropped, not translated:
    # there is no board, and the place phrase now says where truthfully.
    if route:
        push(rs, 30 * rarity(city_reg, "route:" + route) * mat,
             rare_phrase(city_reg, "route:" + route, route, False, place))
    if dest:
        push(rs, 14 * rarity(city_reg, "dest:" + dest) * mat,
             rare_phrase(city_reg, "dest:" + dest, "service to " + dest, False))

    detail = [
        ("%d mi away" % jsround(dist_mi)) if num(dist_mi) is not None else "",
        ("%d mph" % jsround(v)) if v is not None else "",
        ("+%d min" % late) if (late is not None and late > 0) else "",
    ]

    return finish(rs, {
        "uni": jsround(universal),
        "id": "amtrak:" + num_train,
        "kind": "train",
        "title": (route + " " + num_train) if route else ("Amtrak " + num_train),
        "sub": ("to " + dest) if dest else "Amtrak",
        "detail": " · ".join([s for s in detail if s]),
        "photo_query": ("Amtrak %s train" % route) if route else "Amtrak train",
        "photoQuery": ("Amtrak %s train" % route) if route else "Amtrak train",
        "tokens": amtrak_tokens(t),
        "lat": num(t.get("lat")), "lon": num(t.get("lon")),
    })


# ------------------------------------------------- everything else on rails

_ROW_PLACEHOLDER = re.compile(r"^-+$")
_ROW_EMPTY_DEST = re.compile(r"^(train|bus|tram)$", re.IGNORECASE | re.ASCII)
_ROW_HAS_WORD = re.compile(r"[a-z0-9]", re.IGNORECASE | re.ASCII)
_ROW_DEADHEAD = re.compile(r"^(no|unknown|nopassengers?)$", re.IGNORECASE | re.ASCII)
_ROW_NOPAX = re.compile(r"no ?passenger", re.IGNORECASE | re.ASCII)


def is_bus_system(sys_id, sys_label):
    """
    Buses and trams-that-are-really-buses are deliberately not scored. The ask
    was planes and trains; including a Metrobus would bury a Zephyr under forty
    ordinary 30-minute headways.

    Confirmed effect: it excludes DC's busCard and rideonCard, Philadelphia's
    septaBusCard, NJ's njtBusCard, New York's and Boston's busCards, and the
    German/Swiss busxCard — and does NOT exclude Amsterdam's tramCard or
    ferryCard, or the DACH tramCard/ferryCard, which are scored today and stay
    scored.
    """
    return bool(re.search(r"bus|rideon", "%s %s" % (sys_id, sys_label), re.IGNORECASE))


def _sched_clock(minutes, clock24=False):
    """
    Minutes since local midnight to a clock time. The %24 handles GTFS times
    that run past midnight, which are expressed as 1440+.
    """
    if minutes is None:
        return ""
    h = int(minutes // 60) % 24
    m = int(minutes % 60)
    if clock24:
        return "%02d:%02d" % (h, m)
    return "%d:%02d %s" % (h % 12 or 12, m, "AM" if h < 12 else "PM")


def score_rail_row(row, sys_id, sys_label, city_reg, mat, clock24=False, metric=False):
    """
    Score one departure from any rail system that is not Amtrak: metro, tram,
    subway, regional rail, ferry. Returns None for a row that should not be
    scored at all.

    THE DOM IS GONE. The original read three elements off a rendered row —
    .badge, .dest, .sub — plus two whole-row text scrapes, because eleven boards
    with eleven fetch paths shared exactly one thing: the markup they produced.
    A bot has no markup, so `row` is the small dict those elements amounted to:

        line       the badge — "S12", "CYN", "A", "Red Line"
        headsign   where it is going
        stop_name  the stop this departure leaves from   (may be None)
        dep_min    minutes since local midnight          (may be None)
        dist_km    how far that stop is from the city    (may be None)
        late_min   minutes late, or None when unknown

    late_min=None and late_min=0 ARE DIFFERENT CLAIMS and are treated as such: a
    timetable bundle carries no delays at all, and reporting "on time" from a
    bundle would be inventing data. Callers deriving a position by interpolating
    a schedule must pass None here — a delay computed from a train's own
    timetable is identically zero by construction, and publishing it would be
    fabrication.

    Optional keys, both honoured when present and neither required:
        cancelled  a real boolean from a feed that has one (transitous does)
        note       any free text the feed carries, scanned for cancellation
                   wording in four languages

    clock24/metric shape the human-readable detail line only, never the score.
    Pass clock24=True and metric=True for Amsterdam, Zurich, Cologne and
    Stuttgart; the defaults are US customary because seven of the eleven cities
    are American.
    """
    line = clean(row.get("line"))
    to = clean(row.get("headsign"))

    if not line and not to:
        return None
    # Placeholder rows. A board renders "--" into a badge while a feed is still
    # loading, and one card's empty state literally reads "Train"; scoring those
    # put "-- to Train" on the leaderboard. A GTFS-derived feed produces none of
    # these, but a live one still can, so the guards stay.
    if not _ROW_HAS_WORD.search(line + to):
        return None
    if _ROW_PLACEHOLDER.match(line) and _ROW_EMPTY_DEST.fullmatch(to):
        return None
    # Not-in-service workings. WMATA reports a train's ServiceType as
    # "NoPassengers" or "Unknown", which put "No to No Passenger" on the
    # leaderboard — a deadhead move to the yard, dressed up as the most
    # interesting train of the day. This one is NOT dead code: the DC path still
    # reads the live WMATA API, which still reports it.
    if _ROW_DEADHEAD.fullmatch(line) or _ROW_NOPAX.search(to):
        return None

    rs = []
    late = row.get("late_min")
    if not isinstance(late, (int, float)) or isinstance(late, bool) or not math.isfinite(late):
        late = None
    if late is not None:
        late = jsround(late)
        if late >= 60:
            push(rs, 44, "running %d minutes late" % late)
        elif late >= 30:
            push(rs, 30, "%d minutes late" % late)
        elif late >= 15:
            push(rs, 16, "%d minutes late" % late)

    # A feed with a real cancellation flag is believed; otherwise the wording is
    # read out of whatever text the row carries, which is how the boards showed
    # it — "fällt aus", "vervallen". IGNORECASE without re.ASCII, so the umlaut
    # folds.
    cancelled = bool(row.get("cancelled"))
    if not cancelled:
        blob = " ".join([clean(row.get(k)) for k in ("note", "status", "headsign", "line")])
        cancelled = bool(CANCEL_RE.search(blob))
    if cancelled:
        push(rs, 34, "cancelled")

    universal = 0
    for r in rs:
        universal += r["w"]

    line_tok = "line:%s:%s" % (sys_id, line)
    dest_tok = "dest:%s:%s" % (sys_id, to)
    # No place phrase on these two. The system label is already the locator —
    # "the first CYN on SEPTA Regional Rail in 30 days" says where perfectly
    # well, and adding "around Philadelphia" on top of it is noise.
    if line:
        push(rs, 30 * rarity(city_reg, line_tok) * mat,
             rare_phrase(city_reg, line_tok, "%s on %s" % (line, sys_label), False))
    if to:
        push(rs, 20 * rarity(city_reg, dest_tok) * mat,
             rare_phrase(city_reg, dest_tok, "service to " + to, False))

    # The board's sub-line, rebuilt from the fields that used to render it.
    bits = []
    if clean(row.get("stop_name")):
        bits.append(clean(row.get("stop_name")))
    if row.get("dep_min") is not None and num(row.get("dep_min")) is not None:
        bits.append(_sched_clock(num(row["dep_min"]), clock24))
    dk = num(row.get("dist_km"))
    if dk is not None:
        bits.append("%.1f km" % dk if metric else "%.1f mi" % (dk * 0.621371))
    if late is None:
        # Say it on the card. A system scored from a timetable has no delays in
        # it at all, and the difference between "on time" and "nobody knows" is
        # the difference between a fact and a guess. The boards already print
        # "scheduled" against "live" in their own count spans.
        bits.append("scheduled")

    return finish(rs, {
        "uni": jsround(universal),
        "id": "row:%s:%s:%s" % (sys_id, line, to),
        "kind": "train",
        "title": (line + " " if line else "") + (("to " + to) if to else sys_label),
        "sub": sys_label,
        "detail": " · ".join([b for b in bits if b]),
        "photo_query": sys_label + " train",
        "photoQuery": sys_label + " train",
        # Only tokens that were actually scored. The original emitted both
        # unconditionally, so a row with an empty badge taught the registry a
        # token "line:railCard:" that nothing ever scores against — junk that
        # counts toward maturity() and ages out 45 days later having done
        # nothing but inflate n.
        "tokens": [t for t in (line_tok if line else "", dest_tok if to else "") if t],
    })


# ---------------------------------------------------------------- self-test
# Run against the real feeds:  python3 interesting.py
#
# macOS system Python cannot TLS to the ADS-B proxy — LibreSSL 2.8.3 has no
# TLS 1.3 — so the fetch tries urllib first and falls back to shelling out to
# curl. On a runner urllib works and curl is never touched.

def _fetch(url, timeout=60):
    import subprocess
    import urllib.request
    ua = "transit-project-daily/1 (+https://github.com/Jedlavitch/transit-project-)"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": ua})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read(), "urllib"
    except Exception as e:                                          # noqa: BLE001
        out = subprocess.run(["curl", "-sS", "--max-time", str(timeout), "-A", ua, url],
                             capture_output=True)
        if out.returncode != 0 or not out.stdout:
            raise RuntimeError("urllib failed (%s) and curl failed (%s)"
                               % (e, out.stderr.decode("utf-8", "replace")[:200]))
        return out.stdout, "curl"


def _selftest():
    import json
    from datetime import date, timedelta

    dc = CITY_BY_ID["dc"]
    print("day in each city, right now:")
    for c in CITIES:
        print("  %-10s %s  %s" % (c["id"], city_day(c), c["tz"]))

    # jsround, against the four collisions the analysis measured.
    print("\njsround vs round(), the four .5 collisions:")
    for x in (30 * 0.75, 30 * 0.55, 30 * 0.35, 14 * 0.75):
        print("  %5.2f -> jsround %2d, round() %2d" % (x, jsround(x), round(x)))
    assert (jsround(22.5), jsround(16.5), jsround(10.5)) == (23, 17, 11)

    # A registry with a month of history behind it, built FORWARD in time the
    # way a real run does: note_seen writes `last` on every new day, so feeding
    # it days in descending order would leave `last` older than `first` and the
    # window would read as zero.
    #
    # maturity() needs BOTH >= 4 distinct `last` values and >= 80 records before
    # it reaches 1.0, so the filler is 90 tokens spread over the last six days.
    today = date.today().isoformat()
    reg = {}
    for i in range(30, 0, -1):
        d = (date.today() - timedelta(days=i)).isoformat()
        filler = ["type:FILL%02d" % (n + (i % 6) * 15) for n in range(15)]
        note_seen(reg, "dc", filler + ["type:B738", "route:Northeast Regional"], d)
    note_seen(reg, "dc", ["op:SOUTHWEST AIRLINES CO"], (date.today() - timedelta(days=2)).isoformat())
    note_seen(reg, "dc", ["op:SOUTHWEST AIRLINES CO"], (date.today() - timedelta(days=1)).isoformat())
    c = seen_city(reg, "dc")
    mat = maturity(c)
    print("\nregistry: %d tokens, maturity %.2f, window %d days"
          % (len(c), mat, watch_window(c)))
    assert mat == 1.0, mat

    print("all three rarity sentences, as they will be published:")
    print("   never seen : " + rare_phrase(c, "type:A388", "Airbus A380", True, " over Washington DC"))
    print("   seen twice : " + rare_phrase(c, "op:SOUTHWEST AIRLINES CO",
                                           "Southwest Airlines colours", False, " over Washington DC"))
    print("   routine    : " + rare_phrase(c, "type:B738", "Boeing 737-800", True, " over Washington DC"))
    print("   no history : " + rare_phrase({}, "type:A388", "Airbus A380", True, " over Washington DC"))

    body, how = _fetch("https://142.93.200.253.sslip.io/v2/point/38.9582/-77.108/12")
    sky = json.loads(body)
    ac = sky.get("ac") or []
    print("\nADS-B (%s): %d aircraft, source %s%s"
          % (how, len(ac), sky.get("source"), "  STALE" if sky.get("stale") else ""))
    if sky.get("error"):
        print("  proxy reported an error (%r) — an empty sky here would be a"
              " missing feed, not a quiet one" % sky["error"])

    scored = []
    for a in ac[:40]:
        op = operator(a)
        e = score_plane(a, c, mat, where=dc["label"])
        e["admitted"] = admits_plane(e, a, op)
        scored.append(e)
    scored.sort(key=lambda e: -e["score"])
    print("  top aircraft (airline gate applied at NON_AIRLINE_BAR=%d):" % NON_AIRLINE_BAR)
    for e in scored[:5]:
        print("   %4d uni%4d %-3s %-34s %s"
              % (e["score"], e["uni"], "in" if e["admitted"] else "OUT",
                 e["title"][:34], e["reasons"][0]["t"] if e["reasons"] else ""))

    body, how = _fetch("https://api-v3.amtraker.com/v3/trains", timeout=120)
    trains = [t for v in json.loads(body).values() for t in v]
    print("\nAmtrak (%s): %d trains" % (how, len(trains)))
    near = []
    for t in trains:
        la, lo = num(t.get("lat")), num(t.get("lon"))
        if la is None or lo is None:
            continue
        mi = nm_between({"lat": dc["lat"], "lon": dc["lon"]}, {"lat": la, "lon": lo}) * 1.15078
        if mi <= 60:
            near.append(score_amtrak(t, mi, c, mat, where=dc["label"]))
    near.sort(key=lambda e: -e["score"])
    print("  %d within 60 mi of %s; top:" % (len(near), dc["label"]))
    for e in near[:5]:
        print("   %4d uni%4d %-34s %s"
              % (e["score"], e["uni"], e["title"][:34], e["reasons"][0]["t"] if e["reasons"] else ""))

    # Rail rows, including every reject the DOM guards existed for.
    print("\nrail rows:")
    rows = [
        ({"line": "CYN", "headsign": "Center City", "stop_name": "Cynwyd",
          "dep_min": 1145, "dist_km": 6.2, "late_min": None}, "septaRailCard", "SEPTA Regional Rail"),
        ({"line": "PAO", "headsign": "Thorndale", "stop_name": "Suburban Station",
          "dep_min": 1150, "dist_km": 1.1, "late_min": 37}, "septaRailCard", "SEPTA Regional Rail"),
        ({"line": "S12", "headsign": "Köln Hbf", "stop_name": "Köln Süd",
          "dep_min": 1150, "dist_km": 1.4, "late_min": None, "cancelled": True},
         "regioCard", "Regional & S-Bahn"),
        ({"line": "RE1", "headsign": "Aachen", "stop_name": "Köln Hbf", "dep_min": 1160,
          "dist_km": 0.3, "late_min": None, "note": "Fällt aus"}, "regioCard", "Regional & S-Bahn"),
        ({"line": "--", "headsign": "Train", "stop_name": None, "dep_min": None,
          "dist_km": None, "late_min": None}, "railCard", "Metrorail"),
        ({"line": "No", "headsign": "No Passenger", "stop_name": None, "dep_min": None,
          "dist_km": None, "late_min": None}, "railCard", "Metrorail"),
    ]
    for row, sid, label in rows:
        metric = sid == "regioCard"
        e = score_rail_row(row, sid, label, c, mat, clock24=metric, metric=metric)
        if e is None:
            print("   ---- rejected: %r / %r" % (row["line"], row["headsign"]))
            continue
        print("   %4d uni%4d %-30s %-34s %s"
              % (e["score"], e["uni"], e["title"][:30], e["detail"][:34],
                 e["reasons"][0]["t"] if e["reasons"] else ""))

    # A routine bundled row sits exactly on MIN_SCORE, which is why jsround is
    # not optional: one point either way decides whether it is stored at all.
    old = {"line:x:1": {"d": 40, "last": today, "first": today},
           "dest:x:Somewhere": {"d": 40, "last": today, "first": today}}
    e = score_rail_row({"line": "1", "headsign": "Somewhere", "stop_name": None,
                        "dep_min": None, "dist_km": None, "late_min": None},
                       "x", "Some System", old, 1.0)
    print("\nan entirely routine bundled row scores %d against MIN_SCORE=%d"
          % (e["score"], MIN_SCORE))

    # prune must not raise on a half-written record, and must not keep one.
    bad = {"dc": {"good": {"d": 2, "last": today, "first": today},
                  "ancient": {"d": 9, "last": "2020-01-01", "first": "2020-01-01"},
                  "broken": {"d": 1, "last": None, "first": today},
                  "junk": "not a dict"}}
    prune(bad, today)
    print("prune kept %r" % sorted(bad["dc"].keys()))
    assert sorted(bad["dc"].keys()) == ["good"]
    print("\nself-test OK")


if __name__ == "__main__":
    _selftest()
