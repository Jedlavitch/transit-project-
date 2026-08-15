#!/usr/bin/env python3
"""
publish.py — the three publishers, and the caption ladder that feeds them.

WHAT IT DOES
  Turns one day's result (an aircraft of the day, a train of the day, and a row
  per city) into the words each network gets, and puts the card out on Bluesky,
  Mastodon and Threads. Nothing scores anything here; this file only writes and
  sends.

WHY A LADDER AND NOT A TRUNCATION
  post-daily.py builds ONE caption and hands it to every network (post-daily.py
  :751-756). Bluesky's 300-grapheme ceiling therefore silently shortens Mastodon
  and Threads, which both allow 500, and its last resort is `text[:limit-1] + "…"`
  (post-daily.py:446). That blind slice is the actual danger: cut in the wrong
  place it turns "N124AN" into "N12" and "Acela 2150" into "Acela 21". A short
  post is fine. A post that states a wrong tail number is the thing that ends a
  daily account the first time somebody checks it.
  So: six tiers of the same caption, each one whole and true, each shorter than
  the last by dropping a complete part. Every network takes the first tier that
  fits ITS OWN limit. Nothing is ever cut mid-token.

WHY PLANES AND TRAINS ARE BOTH NAMED
  They are scored separately and they stay separate here. The caption labels them
  "Air:" and "Rail:" with their own scores, so nothing in the wording implies one
  beat the other. There is no combined ranking to misread.

THE THREADS DIFFERENCE, WHICH IS NOT OPTIONAL
  Bluesky and Mastodon take the image as BYTES. Threads does not: Meta cURLs the
  picture off a public HTTPS URL you hand it ("We will cURL your image using the
  URL provided so it must be on a public server" — developers.facebook.com/docs/
  threads/posts). There is no byte-upload endpoint for Threads images at all.
  post_threads therefore takes a URL, never a path, and wait_for_public_image()
  exists to prove that URL is really being served before Meta is asked to fetch
  it. Measured 2026-08-15: https://transitproject.online/shots/board-dc.png ->
  200 image/png, but .../shots/leaderboard-latest.png -> 404. The card has never
  been public. Pages redeploys asynchronously after a push, so "we pushed it" is
  not evidence; only a 200 is.

CREDENTIALS
  BSKY_HANDLE, BSKY_APP_PASSWORD          (+ BSKY_HOST, default bsky.social)
  MASTODON_BASE_URL, MASTODON_TOKEN
  THREADS_ACCESS_TOKEN, THREADS_USER_ID
  A network with no credentials returns None and is skipped. A network that
  fails returns False and does not touch the others.

RUN
  python3 publish.py --selftest    exercise the ladder on synthetic data and
                                   print every tier with its length
  python3 publish.py --probe       unauthenticated reachability check of
                                   graph.threads.net and bsky.social
"""

import json
import mimetypes
import os
import random
import re
import string
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone

UA = "transit-project-daily/1 (+https://github.com/Jedlavitch/transit-project-)"
SITE = "transitproject.online"
LINK = "https://%s/leaderboard.html" % SITE          # 46 characters; see LIMITS

# Fallback only. Every city row should carry its own label — this map exists so
# a row that arrives with just an id still prints as English rather than "dc".
# It mirrors post-daily.py:55-60 and interesting.js CITIES. ELEVEN cities, not
# twelve: stencil.html looks like a board but is the city-setup template, and a
# caption that says "12 cities" is a checkable false statement on day one.
CITY_LABELS = {
    "dc": "Washington DC", "philly": "Philadelphia", "nj": "New Jersey",
    "nyc": "New York", "boston": "Boston", "amsterdam": "Amsterdam",
    "la": "Los Angeles", "sf": "San Francisco", "zurich": "Zurich",
    "cologne": "Cologne", "stuttgart": "Stuttgart",
}


def log(msg):
    print(msg, flush=True)


def env(name, default=""):
    return (os.environ.get(name) or default).strip()


# ---------------------------------------------------------------- http bits
# Lifted from post-daily.py:469-489 so this file stands alone. post-daily.py is
# not importable as a module (the hyphen), and duplicating forty lines beats
# importlib gymnastics in a script that has to keep working at 23:10 UTC.

def http(url, data=None, headers=None, method=None, timeout=45):
    req = urllib.request.Request(url, data=data, method=method,
                                 headers=dict({"User-Agent": UA}, **(headers or {})))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status, r.read()


def multipart(fields, files):
    """fields: {name: str}. files: {name: (filename, bytes, content_type)}."""
    boundary = "----tb" + "".join(random.choice(string.ascii_letters) for _ in range(24))
    out = b""
    for k, v in fields.items():
        out += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n"
                % (boundary, k, v)).encode()
    for k, (fn, blob, ct) in files.items():
        out += ("--%s\r\nContent-Disposition: form-data; name=\"%s\"; filename=\"%s\"\r\n"
                "Content-Type: %s\r\n\r\n" % (boundary, k, fn, ct)).encode()
        out += blob + b"\r\n"
    out += ("--%s--\r\n" % boundary).encode()
    return out, "multipart/form-data; boundary=" + boundary


def detail(e):
    """HTTP errors carry the reason in the body; without it every failure reads
    the same and there is nothing to act on."""
    if isinstance(e, urllib.error.HTTPError):
        try:
            return "HTTP %s — %s" % (e.code, e.read().decode("utf-8", "replace")[:400])
        except Exception:                                           # noqa: BLE001
            return "HTTP %s" % e.code
    return "%s: %s" % (type(e).__name__, e)


def redact(url):
    """Never let a token reach a log. The Threads token-bearing GETs are the
    documented form for /me and container status, so the token is in the query
    string whether we like it or not — it just must not be echoed."""
    return re.sub(r"(access_token=)[^&]*", r"\1<redacted>", url)


# ---------------------------------------------------------------- the limits
#
# BLUESKY 300 GRAPHEMES (and 3000 bytes). Read off the lexicon at
#   lexicons/app/bsky/feed/post.json: maxGraphemes 300, maxLength 3000.
#   300 is what binds — the leaderboard URL alone is 46 of them, 15% of the
#   budget, and Bluesky does not shorten URLs the way Mastodon and X do.
#   There is no grapheme segmenter in the stdlib and `regex` is not installed.
#   len() counts CODE POINTS, and graphemes <= code points always, so len() can
#   only ever reject a caption that would have fitted — never accept one that
#   would not. That is the safe direction, so len() is the proxy. With no emoji
#   in the caption (house rule) the two counts are identical anyway.
# THREADS 500. Documented for text posts; the docs do not restate it for the
#   `text` field of an IMAGE post, so treat 500 as the ceiling and confirm on the
#   first real post rather than assuming a larger one exists.
# MASTODON is per-instance and admins change it. Read it live; see mastodon_limit().
# X 280 and DISCORD 2000 are here so nobody writes a third caption builder for
#   them later — post-daily.py:754 already builds X a separate one by hand, which
#   is the right instinct and the wrong place for it.
BLUESKY_LIMIT = 300
BLUESKY_BYTE_LIMIT = 3000
THREADS_LIMIT = 500
MASTODON_FALLBACK_LIMIT = 500
X_LIMIT = 280
DISCORD_LIMIT = 2000

NETWORKS = ("bluesky", "threads", "mastodon", "x", "discord")

_masto_limit_cache = None


def mastodon_limit():
    """
    configuration.statuses.max_characters from {base}/api/v1/instance, falling
    back to 500. Verified against mastodon.social: 500. Plenty of instances run
    1000 or 5000, and hardcoding 500 would throw away room we were given.

    Never raises, and never returns something absurd: a garbage value here would
    silently pick the wrong caption tier for the rest of the run. Cached, because
    caption_for() may be called several times per run and this is one fact.
    """
    global _masto_limit_cache
    if _masto_limit_cache is not None:
        return _masto_limit_cache
    base = env("MASTODON_BASE_URL").rstrip("/")
    if not base:
        _masto_limit_cache = MASTODON_FALLBACK_LIMIT
        return _masto_limit_cache
    _masto_limit_cache = MASTODON_FALLBACK_LIMIT
    try:
        # /api/v2/instance also exists on 4.x; v1 is the one measured to carry
        # configuration.statuses.max_characters, and the fallback covers its
        # eventual removal.
        _, body = http(base + "/api/v1/instance", timeout=15)
        n = (((json.loads(body) or {}).get("configuration") or {})
             .get("statuses") or {}).get("max_characters")
        # bool is a subclass of int in Python, and JSON `true` would sail through
        # an isinstance(n, int) check as the number 1.
        if isinstance(n, int) and not isinstance(n, bool) and 100 <= n <= 100000:
            _masto_limit_cache = n
            log("  Mastodon status limit: %d (read from %s)" % (n, base))
        else:
            log("  Mastodon limit not readable (got %r) — using %d"
                % (n, MASTODON_FALLBACK_LIMIT))
    except Exception as e:                                          # noqa: BLE001
        log("  Mastodon limit not readable (%s) — using %d"
            % (detail(e), MASTODON_FALLBACK_LIMIT))
    return _masto_limit_cache


def limit_for(network):
    """(character limit, byte limit or None) for one network."""
    n = (network or "").strip().lower()
    if n == "bluesky":
        return BLUESKY_LIMIT, BLUESKY_BYTE_LIMIT
    if n == "threads":
        return THREADS_LIMIT, None
    if n == "mastodon":
        return mastodon_limit(), None
    if n == "x":
        return X_LIMIT, None
    if n == "discord":
        return DISCORD_LIMIT, None
    raise ValueError("unknown network %r — expected one of %s"
                     % (network, ", ".join(NETWORKS)))


def fits(text, limit, byte_limit=None):
    if len(text) > limit:
        return False
    if byte_limit and len(text.encode("utf-8")) > byte_limit:
        return False
    return True


# ---------------------------------------------------------------- reading entries
# An entry is finish()'s shape (interesting.js:610-619): id, kind, title, sub,
# detail, score, reasons, tokens, photoQuery, hex, lat, lon — plus cityLabel,
# which post-daily.py:116 already prefers over the id lookup.

def _s(v):
    return "" if v is None else str(v).strip()


def _title(e):
    return _s((e or {}).get("title")) or "—"


def _score(e):
    v = (e or {}).get("score")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return 0
    return int(v)


def _city_of(e):
    e = e or {}
    return (_s(e.get("cityLabel")) or CITY_LABELS.get(_s(e.get("city")), "")
            or _s(e.get("city")))


# rarePhrase() (interesting.js:630-635) and scoreRow() (interesting.js:762) write
# "the first X this board has shown" and "... on this board". This bot HAS no
# board — it derives everything itself, server-side, with no page open anywhere.
# Printing those sentences would put a claim on a public post about a thing that
# did not produce it. A reason that says it is dropped, not reworded: rewriting
# another module's sentence means asserting something we did not compute. Losing
# a clause makes the caption thinner; keeping it makes the caption wrong.
_BOARD_RELATIVE = re.compile(r"\bthis board\b", re.I)
_warned_board_relative = set()


def _echoes_title(txt, e):
    """
    True when a reason says nothing the headline has not already said.

    The type table's sentences are written to stand alone in a list of reasons
    ("a Boeing 747-400"), and next to a headline that already names the aircraft
    they read as a stutter: "Air: Boeing 747-400 over Los Angeles, scoring 74.
    A Boeing 747-400." Compared with the article and punctuation stripped, so
    "a Boeing 747-400" is recognised as an echo of "Boeing 747-400" while
    "an Airbus A380 - the biggest airliner flying" is kept, because it earns its
    place by adding the clause.
    """
    def norm(s):
        s = re.sub(r"^(a|an|the)\s+", "", _s(s), flags=re.I)
        return re.sub(r"[^a-z0-9]+", "", s.lower())
    t, title = norm(txt), norm(_title(e))
    return bool(t) and bool(title) and (t == title or t in title or title in t)


def _reasons(e):
    """[(weight, sentence)] worth printing, in the scorer's own order."""
    out = []
    for r in ((e or {}).get("reasons") or []):
        if not isinstance(r, dict):
            continue
        # interesting.js:313 pushes {w, t}. Some of the scoping notes write the
        # key as `text`; accept both rather than silently printing nothing.
        txt = _s(r.get("t")) or _s(r.get("text"))
        if not txt:
            continue
        if _BOARD_RELATIVE.search(txt):
            if txt not in _warned_board_relative:
                _warned_board_relative.add(txt)
                log("  ! dropping a board-relative reason — this bot has no board "
                    "to have shown anything: %r" % txt)
            continue
        if _echoes_title(txt, e):
            continue
        w = r.get("w")
        w = int(w) if isinstance(w, (int, float)) and not isinstance(w, bool) else 0
        out.append((w, txt[:1].upper() + txt[1:]))
    return out


def _sentence(txt):
    txt = _s(txt)
    if not txt:
        return ""
    return txt if txt[-1] in ".!?" else txt + "."


# ---------------------------------------------------------------- reading city rows
# One row per city, the same list roundup_card.py draws the league table from:
#   {"city": "dc", "label": "Washington DC",
#    "plane": entry|None, "train": entry|None, "error": str|None}
#
# THREE STATES, NOT TWO, AND THE DIFFERENCE IS THE WHOLE POINT:
#   error set                  the feed did not answer. We know nothing.
#   no error, no entry         the feed answered and nothing cleared the bar.
#   an entry                   something scored, and it can be named.
# "Feed unavailable" and "nothing scored" are different claims about the world
# and this file never lets them collapse into each other — collapsing them is how
# a bot ends up telling people Boston was quiet when in fact nobody asked Boston.
#
# A flat row — {title, kind, score} with no nested entries — is also read, so a
# caller using the simpler shape degrades to a thinner caption rather than to
# eleven false "feed unavailable" claims.

def _row_label(row):
    row = row or {}
    return (_s(row.get("label")) or _s(row.get("cityLabel"))
            or CITY_LABELS.get(_s(row.get("city")), "") or _s(row.get("city")))


def _row_error(row):
    return _s((row or {}).get("error"))


def _row_best(row):
    """
    The better of the row's two entries. The card draws a city's aircraft and its
    train; a runner-up line in a 300-character caption has room for one, so it
    names the one that scored higher.
    """
    row = row or {}
    cands = [e for e in (row.get("plane"), row.get("train")) if isinstance(e, dict)]
    if cands:
        return max(cands, key=_score)
    # flat fallback: the row is itself the entry
    if _s(row.get("title")):
        v = row.get("score")
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return row
    return None


def _row_reported(row):
    """Something scored here and can be named. NOT the same as "the feed worked"."""
    return _row_best(row) is not None


def _row_score(row):
    return _score(_row_best(row))


def _row_title(row):
    return _title(_row_best(row))


# ---------------------------------------------------------------- the ladder

_TAGS = {
    "plane": ("#avgeek", "#planespotting"),
    "train": ("#trainspotting", "#railfan"),
}


def _tag_line(hero_plane, hero_train, count):
    """
    Two tags at the top of the ladder, one at the bottom. When the post carries
    both an aircraft and a train, the two tags are one of each — tagging a mixed
    post #avgeek #planespotting sends it to half its audience.
    """
    if count <= 0:
        return ""
    lead = "plane" if _score(hero_plane) >= _score(hero_train) else "train"
    if hero_plane and hero_train:
        pair = (_TAGS["plane"][0], _TAGS["train"][0])
    elif hero_plane:
        pair = _TAGS["plane"]
    else:
        pair = _TAGS["train"]
    if count == 1:
        return _TAGS[lead][0] if (hero_plane and hero_train) else pair[0]
    return " ".join(pair[:count])


def _day_phrase(day):
    """
    "Sat 15 Aug", or nothing at all. An unparseable day is dropped rather than
    printed raw: "Best of the day, 2026-08-15x" is worse than no date, and
    guessing at what the caller meant is worse than both. %a/%b are C-locale
    English on the runner.
    """
    d = _s(day)
    if not d:
        return ""
    try:
        parsed = date.fromisoformat(d[:10])
    except ValueError:
        log("  ! day=%r is not YYYY-MM-DD — leaving the date out of the caption" % day)
        return ""
    return "%s %d %s" % (parsed.strftime("%a"), parsed.day, parsed.strftime("%b"))


def _headline(day_phrase, answered, total):
    """
    The count is a checkable claim, so it says what actually happened. Eleven
    cities looked at with three feeds down is "8 of 11 cities reporting", never
    "11 cities" — the second one is the sentence a reader could disprove by
    reading the card underneath it.

    `answered` counts cities whose FEEDS ANSWERED, not cities that scored
    something. A city that reported an uneventful day did report; saying
    otherwise would understate the coverage as badly as the other version
    overstates it.
    """
    bits = ["Best of the day"]
    if day_phrase:
        bits.append(", " + day_phrase)
    if total:
        if answered >= total:
            bits.append(" — %d cities" % total)
        else:
            bits.append(" — %d of %d cities reporting" % (answered, total))
    return "".join(bits) + "."


def _hero_line(prefix, entry, preposition, with_reason):
    if not entry:
        return ""
    city = _city_of(entry)
    where = (" %s %s" % (preposition, city)) if city else ""
    # "scoring 96" rather than "— 96": the scorer's own sentences carry em dashes
    # ("an Antonov An-124 — one of the largest aircraft flying"), and two of them
    # in one line reads as one broken sentence.
    line = "%s: %s%s, scoring %d." % (prefix, _title(entry), where, _score(entry))
    if with_reason:
        rs = _reasons(entry)
        if rs:
            line += " " + _sentence(rs[0][1])
    return line


def _hero_keys(entry):
    """Both handles a city row might be matched on."""
    e = entry or {}
    return {k for k in (_city_of(e).lower(), _s(e.get("city")).lower()) if k}


def _runner_rows(city_rows, heroes):
    """Cities that reported, best first, minus the ones already named as heroes."""
    used = set()
    for h in heroes:
        used |= _hero_keys(h)
    rows = []
    for r in (city_rows or []):
        keys = {_row_label(r).lower(), _s(r.get("city")).lower()} - {""}
        if keys & used or not _row_reported(r):
            continue
        rows.append(r)
    rows.sort(key=lambda r: _row_score(r), reverse=True)
    return rows


def _check_hero_agrees(hero, city_rows):
    """
    The hero and the table describe the same day and must not contradict each
    other. A hero from a city whose row says the feed was down means one of the
    two is wrong, and the card would refute itself in a single glance. Say so
    here rather than let the caption assert both.
    """
    keys = _hero_keys(hero)
    if not keys:
        return
    for r in (city_rows or []):
        rk = {_row_label(r).lower(), _s(r.get("city")).lower()} - {""}
        if not (rk & keys):
            continue
        if _row_error(r):
            log("  ! %s is named as a hero but its city row carries a feed error "
                "(%s) — the caption and the card disagree. Check the caller."
                % (_title(hero), _row_error(r)))
        elif not _row_reported(r):
            log("  ! %s is named as a hero but its city row scored nothing — the "
                "caption and the card disagree. Check the caller." % _title(hero))
        return


def _runner_text(rows, count, style):
    if count <= 0 or not rows:
        return ""
    rows = rows[:count]
    if style == "named":
        return "Also: " + " · ".join(
            "%s, %s (%d)" % (_row_label(r), _row_title(r), _row_score(r))
            for r in rows) + "."
    return " · ".join("%s %d" % (_row_label(r), _row_score(r)) for r in rows)


# Each rung names a whole part to drop. Nothing here shortens a string; it only
# stops including one.
#   T0 headline + 2 reasons + 3 named runners-up + "every city" + link + 2 tags
#   T1 drop the 3rd runner-up
#   T2 drop the 2nd reason
#   T3 runners-up become names + scores only
#   T4 one tag
#   T5 headline + link
#
# T4a and T4b are additions, and here is why they earn their place. The rungs
# above were sized for a caption with ONE hero. This post names two — an aircraft
# and a train, kept apart on purpose — so every rung costs a whole hero line more
# than it was measured at, and the gap that opens up lands exactly on Bluesky's
# 300. Measured on the self-test data (run `python3 publish.py`): T4 is 339 and
# T5 is 204, so with the specified rungs alone Bluesky drops to T5 and throws
# away 96 characters of a 300 budget — it would post the thinnest thing on the
# ladder while having room for most of the richest. T4a (296) and T4b (260) drop
# the runners-up but keep a reason, which is the part readers actually want.
#
# (name, date, reasons, runners, style, closer, tags)
_TIERS = (
    {"n": "T0",  "date": True,  "reasons": 2, "runners": 3, "style": "named", "closer": True,  "tags": 2},
    {"n": "T1",  "date": True,  "reasons": 2, "runners": 2, "style": "named", "closer": True,  "tags": 2},
    {"n": "T2",  "date": True,  "reasons": 1, "runners": 2, "style": "named", "closer": True,  "tags": 2},
    {"n": "T3",  "date": False, "reasons": 1, "runners": 3, "style": "score", "closer": True,  "tags": 2},
    {"n": "T4",  "date": False, "reasons": 1, "runners": 3, "style": "score", "closer": True,  "tags": 1},
    {"n": "T4a", "date": False, "reasons": 1, "runners": 0, "style": None,    "closer": True,  "tags": 1},
    {"n": "T4b", "date": False, "reasons": 1, "runners": 0, "style": None,    "closer": False, "tags": 0},
    {"n": "T5",  "date": False, "reasons": 0, "runners": 0, "style": None,    "closer": False, "tags": 0},
)
TIER_NAMES = tuple(t["n"] for t in _TIERS) + ("floor",)


def caption_tiers(hero_plane, hero_train, city_rows, day):
    """
    Every rung of the ladder, longest first. Exposed separately from caption_for
    so it can be inspected on a dry run and fitted to a limit this file does not
    know about, without anyone writing a second builder.
    """
    if not hero_plane and not hero_train:
        # There is no post to write. Saying "nothing today" is still a post, and
        # deciding to stay quiet belongs to the caller, not to the wording.
        raise ValueError("caption_for needs at least one hero: both were empty")

    rows = list(city_rows or [])
    total = len(rows)
    answered = sum(1 for r in rows if not _row_error(r))
    runners = _runner_rows(rows, (hero_plane, hero_train))
    day_phrase = _day_phrase(day)
    for h in (hero_plane, hero_train):
        _check_hero_agrees(h, rows)

    out = []
    for t in _TIERS:
        head = _headline(day_phrase if t["date"] else "", answered, total)
        heroes = [ln for ln in (
            _hero_line("Air", hero_plane, "over", t["reasons"] >= 1),
            _hero_line("Rail", hero_train, "in", t["reasons"] >= 2),
        ) if ln]
        blocks = [head, "\n".join(heroes)]

        mid = _runner_text(runners, t["runners"], t["style"])
        # "every city on the card" is a claim about the CARD, not about the data,
        # so it stays true even when some rows read "feed unavailable" — but only
        # if there is a table at all.
        if t["closer"] and total:
            if mid and t["style"] == "score":
                mid += " · full table on the card."
            elif mid:
                mid += " Every city is on the card."
            else:
                mid = "Every city is on the card."
        if mid:
            blocks.append(mid)

        blocks.append(LINK)
        text = "\n\n".join(b for b in blocks if b)
        tags = _tag_line(hero_plane, hero_train, t["tags"])
        if tags:
            text += "\n" + tags
        out.append(text)

    # THE FLOOR. T5 still names both vehicles, and a title arriving 400
    # characters long would push it past 280 on X. The spec's rule is absolute —
    # never end on a blind slice — so the ladder has to bottom out on something
    # provably short instead of on a knife. This rung states less and states
    # nothing false: no names, no scores, just what the card is and where it is.
    # Its length is bounded no matter what the caller passes, because the only
    # variable parts are two integers and a constant URL.
    out.append(_headline("", answered, total) + " Full table: " + LINK)
    return out


def caption_for(network, hero_plane, hero_train, city_rows, day):
    """The first tier that fits this network's own limit."""
    char_limit, byte_limit = limit_for(network)
    tiers = caption_tiers(hero_plane, hero_train, city_rows, day)
    for i, text in enumerate(tiers):
        if fits(text, char_limit, byte_limit):
            if i == len(tiers) - 1:  # the floor rung, not one of the named tiers
                log("  ! %s fell to the floor caption — something upstream is "
                    "unusually long. Check the hero titles." % network)
            return text
    # Even the floor did not fit. The floor runs 74-110 characters depending only
    # on the city counts, so this means a limit no network here has, i.e. a bug
    # rather than a long day. Return the true short thing and let the post fail
    # visibly — a caption cut to size would be the one outcome worse than none.
    log("  ! %s: nothing fits a %d-character limit, not even the floor caption. "
        "Posting will fail, and that is better than posting a cut claim."
        % (network, char_limit))
    return tiers[-1]


# ---------------------------------------------------------------- alt text
# ALT TEXT LIMITS
#   Threads   1,000 (documented).
#   X         1,000 (post-daily.py:628 already slices to it).
#   Mastodon  commonly 1,500 — NOT verified, so the builder never relies on it:
#             it adds whole city entries and stops, so an over-generous guess
#             costs a rejected description, never a mangled one.
#   Bluesky   the lexicon states no maximum for an image alt; 1,500 is a
#             self-imposed ceiling, not a discovered one.
ALT_LIMITS = {"threads": 1000, "x": 1000, "mastodon": 1500,
              "bluesky": 1500, "discord": 1500}
ALT_DEFAULT_LIMIT = 1000


def alt_text_for(network, hero_plane, hero_train, city_rows):
    """
    Hero first, then the table. A round-up whose alt text describes only the
    winner is a black box to a screen reader for eleven of its twelve facts, and
    the table is most of the card.

    Grows by whole city entries and stops, then says how many it did not reach.
    No slicing: "Washington DC 96, Antonov An-1" is a wrong claim about an
    aircraft that does not exist.
    """
    limit = ALT_LIMITS.get((network or "").strip().lower(), ALT_DEFAULT_LIMIT)
    rows = list(city_rows or [])
    total = len(rows)

    head = ["A dark card headed 'best of the day'%s."
            % (", covering %d cities" % total if total else "")]
    for label, hero, prep in (("Aircraft of the day", hero_plane, "over"),
                              ("Train of the day", hero_train, "in")):
        if not hero:
            continue
        city = _city_of(hero)
        head.append("%s: %s%s, score %d."
                    % (label, _title(hero), (" %s %s" % (prep, city)) if city else "",
                       _score(hero)))
        rs = _reasons(hero)
        if rs:
            head.append(_sentence(rs[0][1]))
    lead = " ".join(head)

    if not rows:
        return lead if len(lead) <= limit else _short_alt(total)

    # The three states the card draws, said the same three ways here. A screen
    # reader must be able to tell "nobody asked Boston" from "Boston was quiet";
    # they are different facts and only one of them is about Boston.
    entries = []
    for r in rows:
        if _row_reported(r):
            entries.append("%s %d, %s" % (_row_label(r), _row_score(r), _row_title(r)))
        elif _row_error(r):
            entries.append("%s, feed unavailable" % _row_label(r))
        else:
            entries.append("%s, nothing scored" % _row_label(r))

    kept = []
    for ent in entries:
        left = len(entries) - len(kept) - 1
        tail = (" And %d more on the card." % left) if left else ""
        candidate = lead + " City table: " + "; ".join(kept + [ent]) + "." + tail
        if len(candidate) > limit:
            break
        kept.append(ent)

    if not kept:
        # The hero sentences alone already ate the budget. Drop them rather than
        # cut them.
        return _short_alt(total)
    left = len(entries) - len(kept)
    tail = (" And %d more on the card." % left) if left else ""
    return lead + " City table: " + "; ".join(kept) + "." + tail


def _short_alt(total):
    return ("A dark card headed 'best of the day': a photograph, the aircraft "
            "and the train of the day with their scores, and a table of "
            "%s below them."
            % ("all %d cities" % total if total else "every city covered"))


# ---------------------------------------------------------------- guard rails

def _too_long(network, text):
    """
    Refuse rather than trim. Callers get their caption from caption_for(), which
    already fits; anything longer arriving here means a caller built its own, and
    quietly shaving it is exactly the bug this file exists to remove.
    """
    char_limit, byte_limit = limit_for(network)
    if fits(text, char_limit, byte_limit):
        return False
    log("  ! %s: caption is %d characters (%d bytes) against a limit of %d — "
        "not posting. Use caption_for(%r, ...) rather than trimming by hand."
        % (network, len(text), len(text.encode("utf-8")), char_limit, network))
    return True


def _clip_sentences(text, limit):
    """Last resort for alt text handed in over-length from elsewhere: drop whole
    sentences off the end. Still never mid-word."""
    text = _s(text)
    if len(text) <= limit:
        return text
    parts = re.split(r"(?<=[.!?]) ", text)
    out = ""
    for p in parts:
        nxt = (out + " " + p).strip()
        if len(nxt) > limit:
            break
        out = nxt
    return out


# ---------------------------------------------------------------- Bluesky
# Adapted from post-daily.py:496-551. Both fixes it carries are kept: the image
# goes up as a binary blob, and the link facets are measured in UTF-8 BYTES.

def post_bluesky(text, image_path, alt):
    handle, app_pw = env("BSKY_HANDLE"), env("BSKY_APP_PASSWORD")
    if not handle or not app_pw:
        return None
    if _too_long("bluesky", text):
        return False
    host = env("BSKY_HOST", "https://bsky.social").rstrip("/")
    try:
        _, body = http(host + "/xrpc/com.atproto.server.createSession",
                       data=json.dumps({"identifier": handle, "password": app_pw}).encode(),
                       headers={"Content-Type": "application/json"})
        sess = json.loads(body)
        jwt, did = sess["accessJwt"], sess["did"]
        auth = {"Authorization": "Bearer " + jwt}

        embed = None
        if image_path and os.path.exists(image_path):
            with open(image_path, "rb") as fh:
                blob = fh.read()
            # The declared type is stored in the blob record, so a PNG announced
            # as something else renders as nothing. Guess from the name and fall
            # back to PNG, which is what the card writer produces.
            ctype = mimetypes.guess_type(image_path)[0] or "image/png"
            _, b = http(host + "/xrpc/com.atproto.repo.uploadBlob", data=blob,
                        headers=dict(auth, **{"Content-Type": ctype}))
            embed = {"$type": "app.bsky.embed.images",
                     "images": [{"alt": alt or "", "image": json.loads(b)["blob"]}]}

        record = {
            "$type": "app.bsky.feed.post",
            "text": text,
            "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "facets": link_facets(text),
        }
        if embed:
            record["embed"] = embed
        _, b = http(host + "/xrpc/com.atproto.repo.createRecord",
                    data=json.dumps({"repo": did, "collection": "app.bsky.feed.post",
                                     "record": record}).encode(),
                    headers=dict(auth, **{"Content-Type": "application/json"}))
        uri = ""
        try:
            uri = json.loads(b).get("uri", "")
        except Exception:                                           # noqa: BLE001
            pass
        log("  ✓ Bluesky%s" % (" " + uri if uri else ""))
        return True
    except Exception as e:                                          # noqa: BLE001
        log("  ! Bluesky failed: %s" % detail(e))
        return False


def link_facets(text):
    """
    Bluesky does not linkify on its own, and it counts in UTF-8 BYTES, not
    characters — one em dash before the URL shifts every index after it, so the
    offsets are measured on the encoded form and nowhere else.

    The pattern deliberately matches only a full https?:// URL. Dropping the
    scheme to save eight graphemes would silently turn the link into plain text.
    """
    out = []
    b = text.encode("utf-8")
    for m in re.finditer(rb"https?://[^\s]+", b):
        uri = m.group(0).decode("utf-8").rstrip(".,)")
        out.append({
            "index": {"byteStart": m.start(), "byteEnd": m.start() + len(uri.encode("utf-8"))},
            "features": [{"$type": "app.bsky.richtext.facet#link", "uri": uri}],
        })
    return out


# ---------------------------------------------------------------- Mastodon
# Adapted from post-daily.py:554-580. One change: post-daily.py sleeps a flat two
# seconds after the upload (post-daily.py:569-571). Mastodon answers 202 while an
# attachment is still processing and 200 once it is ready, so the length of the
# wait is a property of the file, not of the clock. The round-up card is denser
# than the single-winner one. Ask the server instead of guessing.

MASTODON_MEDIA_POLL_FOR = 60
MASTODON_MEDIA_POLL_EVERY = 3


def post_mastodon(text, image_path, alt):
    base, token = env("MASTODON_BASE_URL").rstrip("/"), env("MASTODON_TOKEN")
    if not base or not token:
        return None
    if _too_long("mastodon", text):
        return False
    auth = {"Authorization": "Bearer " + token}
    try:
        media_ids = []
        if image_path and os.path.exists(image_path):
            with open(image_path, "rb") as fh:
                blob = fh.read()
            # Mastodon takes the description at upload time, unlike X where alt
            # text is a second call.
            body, ct = multipart({"description": _clip_sentences(alt or "", 1500)},
                                 {"file": (os.path.basename(image_path), blob,
                                           mimetypes.guess_type(image_path)[0] or "image/png")})
            status, b = http(base + "/api/v2/media", data=body,
                             headers=dict(auth, **{"Content-Type": ct}))
            mid = json.loads(b)["id"]
            media_ids.append(mid)
            if status == 202:
                _wait_for_mastodon_media(base, auth, mid)
        data = urllib.parse.urlencode([("status", text)] +
                                      [("media_ids[]", m) for m in media_ids]).encode()
        _, b = http(base + "/api/v1/statuses", data=data,
                    headers=dict(auth, **{"Content-Type": "application/x-www-form-urlencoded"}))
        url = ""
        try:
            url = json.loads(b).get("url", "")
        except Exception:                                           # noqa: BLE001
            pass
        log("  ✓ Mastodon%s" % (" " + url if url else ""))
        return True
    except Exception as e:                                          # noqa: BLE001
        log("  ! Mastodon failed: %s" % detail(e))
        return False


def _wait_for_mastodon_media(base, auth, media_id):
    """202 means still processing; 200 means ready. Never raises — a failed poll
    should let the status attempt go ahead and fail loudly there, not swallow the
    whole post here."""
    deadline = time.time() + MASTODON_MEDIA_POLL_FOR
    while time.time() < deadline:
        time.sleep(MASTODON_MEDIA_POLL_EVERY)
        try:
            status, _ = http("%s/api/v1/media/%s" % (base, urllib.parse.quote(str(media_id))),
                             headers=auth, timeout=20)
            if status == 200:
                return True
        except Exception as e:                                      # noqa: BLE001
            log("  (Mastodon media poll: %s)" % detail(e))
            return False
    log("  ! Mastodon attachment %s was still processing after %ds — attaching it "
        "anyway" % (media_id, MASTODON_MEDIA_POLL_FOR))
    return False


# ---------------------------------------------------------------- Threads
#
# Two-step, and the image is fetched by Meta rather than uploaded by us:
#   1. POST {base}/v1.0/{user_id}/threads          media_type=IMAGE, image_url, text
#   2. GET  {base}/v1.0/{creation_id}?fields=status,error_message   until FINISHED
#   3. POST {base}/v1.0/{user_id}/threads_publish  creation_id
# base is https://graph.threads.net. Verified live, unauthenticated, on
# 2026-08-15: GET /v1.0/me?fields=id,username -> HTTP 400 with
# {"error":{"message":"Invalid OAuth 2.0 Access Token","type":"OAuthException",
# "code":190,...}}. That confirms the host, the /v1.0/ prefix, the `me` alias and
# the error shape; everything past the token is documentation until the first
# real post.
#
# TOKENS ARE NOT ROTATED HERE, DELIBERATELY. refresh_access_token returns a NEW
# string, and a token that is refreshed but not persisted is a token that still
# dies sixty days after it was issued. Persisting it means rewriting a repo
# secret from inside the workflow, which needs a PAT plus libsodium sealed-box
# encryption — PyNaCl, not stdlib. So this file does the honest thing instead: it
# asks /me first, and when Graph answers code 190 it says so in one unmissable
# block and gives up. A human then redoes the browser OAuth legs. Failing
# visibly every sixtieth day beats failing silently on the sixty-first.

THREADS_BASE = "https://graph.threads.net"
THREADS_API = THREADS_BASE + "/v1.0"
THREADS_ALT_LIMIT = 1000
# "It is recommended to wait on average 30 seconds before publishing" and
# "query a container's status once per minute, for no more than 5 minutes".
THREADS_PROCESS_WAIT = 30
THREADS_POLL_EVERY = 60
THREADS_POLL_FOR = 300


def _graph_error(e):
    """The {"error": {...}} object out of an HTTPError body, or {}."""
    if not isinstance(e, urllib.error.HTTPError):
        return {}
    try:
        return (json.loads(e.read().decode("utf-8", "replace")) or {}).get("error") or {}
    except Exception:                                               # noqa: BLE001
        return {}


def _threads_token_dead(token):
    """
    True only when Graph says the token is gone. Anything else — a 500, a
    timeout, a shape we do not recognise — is NOT a reason to skip the day's
    post: the container call two lines later would surface a real auth problem
    anyway, and refusing to post because a health check hiccuped is its own bug.
    """
    url = "%s/me?fields=id,username&access_token=%s" % (THREADS_API,
                                                        urllib.parse.quote(token))
    try:
        _, body = http(url, timeout=20)
        who = json.loads(body) or {}
        log("  Threads token is live (%s)" % (who.get("username") or who.get("id") or "?"))
        return False
    except Exception as e:                                          # noqa: BLE001
        err = _graph_error(e)
        if err.get("code") == 190:
            log("")
            log("  !! THE THREADS TOKEN HAS EXPIRED OR BEEN REVOKED (Graph code 190).")
            log("  !! Long-lived tokens last 60 days and cannot be revived once they")
            log("  !! lapse — refreshing is not possible after the fact and there is")
            log("  !! no unattended recovery. A human has to redo the browser OAuth")
            log("  !! legs and re-paste THREADS_ACCESS_TOKEN. See SOCIAL.md.")
            log("  !! Graph said: %s" % (err.get("message") or "?"))
            log("")
            return True
        log("  (Threads token check inconclusive: %s — continuing)" % detail(e))
        return False


def post_threads(text, image_url, alt):
    """
    image_url is a PUBLIC HTTPS URL, never a path. There is no byte upload for
    Threads images; Meta fetches the picture itself at container-creation time,
    so it must already be live. Call wait_for_public_image() first.
    """
    token, uid = env("THREADS_ACCESS_TOKEN"), env("THREADS_USER_ID")
    if not token or not uid:
        return None
    if _too_long("threads", text):
        return False

    url = _s(image_url)
    if not url.lower().startswith("https://"):
        # The commonest way to get this wrong is to hand post_threads the same
        # local path the other two posters take. It cannot work: Meta fetches the
        # picture from its own servers, so a path — or plain http — is unusable.
        log("  ! Threads needs a public https:// image URL, not %r. Meta cURLs the "
            "image itself, so a file path cannot work." % image_url)
        return False

    if _threads_token_dead(token):
        return False

    try:
        # Form-encoded POST BODY, not a query string: the token must not end up
        # in a URL, a redirect, or anybody's access log.
        fields = {
            "media_type": "IMAGE",
            "image_url": url,
            "text": text,
            "access_token": token,
        }
        if alt:
            fields["alt_text"] = _clip_sentences(alt, THREADS_ALT_LIMIT)
        # link_attachment is documented as TEXT-post-only, so the leaderboard
        # link lives inside the 500 characters like every other word.
        _, b = http("%s/%s/threads" % (THREADS_API, urllib.parse.quote(uid)),
                    data=urllib.parse.urlencode(fields).encode(),
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=60)
        creation_id = _s((json.loads(b) or {}).get("id"))
        if not creation_id:
            log("  ! Threads container came back with no id: %s" % b[:300])
            return False
        log("  Threads container %s created for %s" % (creation_id, url))
    except Exception as e:                                          # noqa: BLE001
        log("  ! Threads container failed: %s" % detail(e))
        return False

    ready = _threads_container_ready(creation_id, token)
    if ready is False:
        return False

    try:
        _, b = http("%s/%s/threads_publish" % (THREADS_API, urllib.parse.quote(uid)),
                    data=urllib.parse.urlencode({"creation_id": creation_id,
                                                 "access_token": token}).encode(),
                    headers={"Content-Type": "application/x-www-form-urlencoded"},
                    timeout=60)
        media_id = _s((json.loads(b) or {}).get("id"))
        # This id is the only receipt that the post went out. Log it.
        log("  ✓ Threads (media id %s)" % (media_id or "?"))
    except Exception as e:                                          # noqa: BLE001
        log("  ! Threads publish failed: %s" % detail(e))
        return False

    _log_threads_quota(uid, token)
    return True


def _threads_container_ready(creation_id, token):
    """
    True when the container reported FINISHED, False when it reported ERROR or
    EXPIRED or never finished, None when the status endpoint itself never
    answered.

    The None case matters and is not the same as False. If every status call
    errored we have learned nothing about the container, only about the poll — so
    the caller publishes anyway, having already served the documented 30-second
    processing wait, and any real problem surfaces on the publish call. But a
    container that answered and stayed IN_PROGRESS is a container the docs say
    not to publish, and that one we do not touch.
    """
    log("  waiting %ds for Threads to fetch and process the image" % THREADS_PROCESS_WAIT)
    time.sleep(THREADS_PROCESS_WAIT)
    url = "%s/%s?fields=status,error_message&access_token=%s" % (
        THREADS_API, urllib.parse.quote(creation_id), urllib.parse.quote(token))
    deadline = time.time() + THREADS_POLL_FOR
    answered = False
    while True:
        try:
            _, b = http(url, timeout=30)
            st = json.loads(b) or {}
            answered = True
            state = _s(st.get("status")).upper()
            if state == "FINISHED":
                return True
            if state == "PUBLISHED":
                log("  (Threads container %s is already published)" % creation_id)
                return True
            if state in ("ERROR", "EXPIRED"):
                # This is where an image_url that 404s for Meta finally shows up,
                # which is the whole reason wait_for_public_image exists.
                log("  ! Threads container %s went %s: %s"
                    % (creation_id, state, _s(st.get("error_message")) or "no message"))
                return False
            log("  Threads container %s: %s" % (creation_id, state or "no status"))
        except Exception as e:                                      # noqa: BLE001
            log("  (Threads status poll: %s)" % detail(e))
        if time.time() >= deadline:
            break
        time.sleep(min(THREADS_POLL_EVERY, max(1, deadline - time.time())))
    if answered:
        log("  ! Threads container %s never reached FINISHED within %ds. Not "
            "publishing it. It stays valid for 24 hours if you want to publish "
            "it by hand." % (creation_id, THREADS_POLL_FOR))
        return False
    log("  ! Threads status never answered — publishing on the strength of the "
        "%ds processing wait alone." % THREADS_PROCESS_WAIT)
    return None


def _log_threads_quota(uid, token):
    """
    250 published posts per profile per 24 hours; a once-a-day bot uses 0.4% of
    it. This is a debugging aid, never a gate, and the raw JSON is printed
    because the exact field nesting (config.quota_total, config.quota_duration)
    comes from docs search rather than from a page that was read end to end.
    """
    try:
        _, b = http("%s/%s/threads_publishing_limit?fields=quota_usage,config"
                    "&access_token=%s" % (THREADS_API, urllib.parse.quote(uid),
                                          urllib.parse.quote(token)), timeout=20)
        log("  Threads quota: %s" % b.decode("utf-8", "replace")[:300])
    except Exception as e:                                          # noqa: BLE001
        log("  (Threads quota unreadable: %s)" % detail(e))


# ---------------------------------------------------------------- the image wait
# Measured, not assumed: pages.yml redeploys the site on push to main, which
# takes minutes, and daily-post.yml's `concurrency` group does not serialise
# against it. A successful `git push` is not evidence that the picture is being
# served. Only a 200 with an image content-type is.

_DATED = re.compile(r"\d{4}-\d{2}-\d{2}|[?&]v=")
_IMAGE_MAGIC = (b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff", b"GIF8", b"RIFF")


def wait_for_public_image(url, timeout_s=300, interval_s=15):
    """
    Poll until the URL really is public, or give up. True means Meta can fetch
    it; False means skip Threads and leave the byte-based networks alone.

    Never sleeps a fixed interval and calls it done — that is the assumption this
    whole function exists to replace.
    """
    url = _s(url)
    if not url.lower().startswith("https://"):
        log("  ! %r is not an https:// URL — Threads cannot use it." % url)
        return False
    if not _DATED.search(url):
        # A reused filename invites a stale fetch through the Pages CDN, which
        # here means posting yesterday's card under today's caption. This project
        # has already been bitten twice by exactly that with ?v= cache-busting, so
        # it is worth saying out loud even though it is not fatal.
        log("  ! %s carries no date or version. A stable filename can be served "
            "stale by the CDN; prefer shots/daily/YYYY-MM-DD.png." % url)

    started = time.time()
    deadline = started + max(0, timeout_s)
    attempt = 0
    last = ""
    while True:
        attempt += 1
        try:
            with urllib.request.urlopen(
                    urllib.request.Request(url, headers={"User-Agent": UA}),
                    timeout=20) as r:
                status = r.status
                ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
                head = r.read(512)          # never pull the whole 3 MB card back
            if status != 200 or not ctype.startswith("image/") or not head:
                last = "HTTP %s, content-type %r, %d bytes" % (status, ctype, len(head))
            elif head.lstrip()[:9].lower().startswith(b"<!doctype") or \
                    head.lstrip()[:5].lower().startswith(b"<html"):
                # A 200 with an image content-type can still be an error page when
                # something in front of the origin rewrites responses, so look at
                # the bytes before believing the header.
                last = "HTML served under an image content-type"
            else:
                if not any(head.startswith(sig) for sig in _IMAGE_MAGIC):
                    log("  (unfamiliar magic bytes for %s — accepting the header)" % ctype)
                log("  image is public after %ds (%s)" % (time.time() - started, ctype))
                return True
        except Exception as e:                                      # noqa: BLE001
            last = detail(e)
        if time.time() >= deadline:
            break
        # A 404 is the expected answer while Pages is still deploying, so this
        # only narrates every fourth try rather than every one.
        if attempt == 1 or attempt % 4 == 0:
            log("  waiting for %s to go live (%s)" % (url, last))
        time.sleep(min(max(1, interval_s), max(1, deadline - time.time())))
    log("  ! %s never became public within %ds (%s). Skipping Threads; the other "
        "networks are unaffected." % (url, timeout_s, last))
    return False


# ---------------------------------------------------------------- self-test
# No credentials required. Exercises the ladder against real-looking data at
# every limit, checks the facet byte offsets, and probes the Threads host.

def _demo(kind, title, city, score, reasons):
    return {"kind": kind, "title": title, "cityLabel": city, "score": score,
            "reasons": [{"w": w, "t": t} for w, t in reasons]}


def _demo_day():
    plane = _demo("plane", "Antonov An-124 Ruslan", "Washington DC", 96,
                  [(58, "an Antonov An-124 — one of the largest aircraft flying"),
                   (22, "only the 2nd day with an Antonov Airlines"),
                   (3, "squawking 7700")])
    train = _demo("train", "Acela 2150 to Boston", "New York", 71,
                  [(34, "running 22 minutes late"),
                   (16, "an Acela, which is rare here")])
    def row(cid, label, air=None, rail=None, error=None):
        return {"city": cid, "label": label, "plane": air, "train": rail,
                "error": error}

    def ent(kind, title, score):
        return {"kind": kind, "title": title, "score": score, "reasons": []}

    # The shape roundup_card.py draws from: a plane AND a train per city, plus
    # the three states — scored, feed error, and answered-but-nothing-scored
    # (Philadelphia below, which is the case a flat row cannot express at all).
    rows = [
        row("dc", "Washington DC", plane, ent("train", "Red to Shady Grove", 31)),
        row("nyc", "New York", ent("plane", "B77W · United", 40), train),
        row("amsterdam", "Amsterdam", ent("plane", "B77W · KLM", 64),
            ent("train", "IC 3051 to Utrecht", 22)),
        row("boston", "Boston", None, ent("train", "Downeaster 685", 58)),
        row("sf", "San Francisco", ent("plane", "A359 · United", 51), None),
        row("la", "Los Angeles", None, ent("train", "Metrolink 342", 44)),
        row("philly", "Philadelphia"),
        row("nj", "New Jersey", ent("plane", "B739 · United", 33), None),
        row("zurich", "Zurich", None, ent("train", "S12 to Winterthur", 28)),
        row("stuttgart", "Stuttgart", None, ent("train", "U6 to Fasanenhof", 21)),
        row("cologne", "Cologne", error="upstream 429"),
    ]
    return plane, train, rows, "2026-08-15"


def _selftest():
    bad = 0
    plane, train, rows, day = _demo_day()

    log("LINK is %d characters%s" % (len(LINK), "" if len(LINK) == 46 else "  <- expected 46"))
    if len(LINK) != 46:
        bad += 1

    log("\n=== the ladder (synthetic data, nothing here was measured today) ===")
    tiers = caption_tiers(plane, train, rows, day)
    for name, t in zip(TIER_NAMES, tiers):
        log("\n--- %s: %d chars, %d bytes ---\n%s" % (name, len(t), len(t.encode()), t))

    # Each rung must be shorter than the one above it. The scan in caption_for is
    # correct either way, but a rung that grew would mean a network silently
    # skipping a richer caption it had room for.
    for a, b, na, nb in zip(tiers, tiers[1:], TIER_NAMES, TIER_NAMES[1:]):
        if len(b) >= len(a):
            log("  ! %s (%d) is not shorter than %s (%d)" % (nb, len(b), na, len(a)))
            bad += 1

    log("\n=== per network ===")
    for net in NETWORKS:
        lim, blim = limit_for(net)
        text = caption_for(net, plane, train, rows, day)
        which = next((n for n, t in zip(TIER_NAMES, tiers) if t == text), "?")
        ok = fits(text, lim, blim)
        log("  %-9s limit %4d  ->  %s at %3d chars  %s"
            % (net, lim, which, len(text), "ok" if ok else "OVER LIMIT"))
        if not ok:
            bad += 1
        alt = alt_text_for(net, plane, train, rows)
        alim = ALT_LIMITS.get(net, ALT_DEFAULT_LIMIT)
        log("            alt %d/%d chars %s" % (len(alt), alim,
                                                "ok" if len(alt) <= alim else "OVER LIMIT"))
        if len(alt) > alim:
            bad += 1

    log("\n=== degenerate cases ===")
    for label, p, t, r in (("plane only", plane, None, rows),
                           ("train only", None, train, rows),
                           ("no city table", plane, train, []),
                           ("every feed down", plane, train,
                            [{"city": c, "ok": False} for c in CITY_LABELS])):
        for net in ("bluesky", "threads"):
            lim, blim = limit_for(net)
            text = caption_for(net, p, t, r, day)
            ok = fits(text, lim, blim)
            log("  %-16s %-9s %3d chars %s" % (label, net, len(text),
                                               "ok" if ok else "OVER LIMIT"))
            if not ok:
                bad += 1
        log("      %s" % caption_for("bluesky", p, t, r, day).replace("\n", " | "))

    log("\n=== an absurd title must not be cut, only dropped ===")
    huge = _demo("plane", "Antonov " + "Ruslan " * 60, "Washington DC", 96, [])
    text = caption_for("x", huge, train, rows, day)
    ok = fits(text, X_LIMIT) and "Ruslan Ruslan" not in text
    log("  x: %d chars, floor used: %s  %s" % (len(text), "Ruslan" not in text,
                                               "ok" if ok else "FAILED"))
    if not ok:
        bad += 1

    log("\n=== a board-relative reason must be dropped, not printed ===")
    liar = _demo("plane", "Airbus A380-861", "New York", 88,
                 [(46, "the first Airbus A380 this board has shown")])
    text = caption_for("threads", liar, None, rows, day)
    if "this board" in text:
        log("  FAILED — 'this board' reached the caption")
        bad += 1
    else:
        log("  ok — the claim about a board this bot does not have was dropped")

    log("\n=== link_facets byte offsets ===")
    for probe in ("plain %s end" % LINK,
                  "an em dash — and a middot · before %s" % LINK,
                  "Zürich, Köln, and %s\n#avgeek" % LINK):
        fs = link_facets(probe)
        b = probe.encode("utf-8")
        okf = bool(fs)
        for f in fs:
            sl = b[f["index"]["byteStart"]:f["index"]["byteEnd"]].decode("utf-8")
            if sl != f["features"][0]["uri"] or sl != LINK:
                okf = False
        log("  %-52s %d facet(s) %s" % (probe.split("\n")[0][:52], len(fs),
                                        "ok" if okf else "FAILED"))
        if not okf:
            bad += 1
    # The reason the offsets are taken on bytes at all: they differ from the
    # character offsets the moment anything non-ASCII appears before the URL.
    probe = "Zürich — %s" % LINK
    log("  char index %d vs byte index %d for the same URL"
        % (probe.index(LINK), link_facets(probe)[0]["index"]["byteStart"]))

    log("\n=== alt text ===")
    alt = alt_text_for("threads", plane, train, rows)
    log("  %d chars\n  %s" % (len(alt), alt))
    if "feed unavailable" not in alt:
        log("  FAILED — the down feed vanished from the table")
        bad += 1

    log("\n=== unknown network fails loudly ===")
    try:
        limit_for("tumblr")
        log("  FAILED — no error raised")
        bad += 1
    except ValueError as e:
        log("  ok — %s" % e)

    log("\n%s" % ("ALL CHECKS PASSED" if not bad else "%d CHECK(S) FAILED" % bad))
    return 1 if bad else 0


def _probe():
    """Unauthenticated reachability. Confirms the hosts and the error shapes; it
    cannot and does not confirm anything that needs a token."""
    log("GET %s/me?fields=id,username  (expect 400 / code 190)" % THREADS_API)
    try:
        st, b = http(THREADS_API + "/me?fields=id,username", timeout=20)
        log("  HTTP %s %s" % (st, b[:200]))
    except Exception as e:                                          # noqa: BLE001
        err = _graph_error(e) if isinstance(e, urllib.error.HTTPError) else {}
        log("  %s" % ("code %s: %s — host, /v1.0/ prefix and `me` alias are real"
                      % (err.get("code"), err.get("message")) if err else detail(e)))
    log("GET bsky.social/xrpc/com.atproto.server.describeServer")
    try:
        st, _ = http("https://bsky.social/xrpc/com.atproto.server.describeServer", timeout=20)
        log("  HTTP %s" % st)
    except Exception as e:                                          # noqa: BLE001
        log("  %s" % detail(e))
    return 0


if __name__ == "__main__":
    if "--probe" in sys.argv:
        sys.exit(_probe())
    sys.exit(_selftest())
