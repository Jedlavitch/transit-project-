#!/usr/bin/env python3
"""
roundup.py — the daily all-cities bot.

WHAT IT IS
  A standalone bot. It gathers its own data for all eleven city boards, scores the
  aircraft and the trains SEPARATELY, renders one round-up card, and posts it to
  Threads, Mastodon and Bluesky.

WHY IT IS NOT post-daily.py
  post-daily.py reads a leaderboard that BROWSERS built: interesting.js scores what
  a board displays and publishes it to a jsonblob. That can only ever cover cities
  whose board happened to be open on somebody's screen — in practice one or two,
  never eleven. This one owes nothing to a browser:

    aircraft   the ADS-B proxy, once per city (this is the only per-city network call)
    Amtrak     api-v3.amtraker.com, ONE national call, then filtered by distance
    rail       the GTFS bundles committed in this repo, read straight off disk

  post-daily.py still works and is still wired to its own schedule. This is a second,
  independent path; neither depends on the other.

WHAT IT CANNOT DO, SAID PLAINLY
  A bundled timetable carries no delays and no vehicle identity. Server-side, the only
  train lateness available is Amtrak's, so metro and tram entries are scored on which
  line and destination is running and how rarely this bot has seen it — nothing else.
  That is thinner than what a browser sees, and the card must never imply otherwise.

ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER
  Threads has NO byte upload: Meta fetches the image from a public HTTPS URL you give
  it (verified against developers.facebook.com/docs/threads/posts). So the card has to
  be committed, pushed, and live on GitHub Pages BEFORE the Threads call. Bluesky and
  Mastodon take raw bytes and can go at once. Hence:

    score -> render -> commit+push -> post Bluesky/Mastodon -> wait for Pages -> post Threads

  The card is written to shots/daily/YYYY-MM-DD.png, a path that has never existed
  before. A dated path cannot be served stale by Meta's fetcher or by the Pages CDN,
  which is a failure this project has already been bitten by twice with ?v= keys.

RUN
  DRY_RUN=1 python3 roundup.py          score everything, draw the card, post nothing
  python3 roundup.py                     the real thing (needs network credentials)
  CITIES=dc,nyc python3 roundup.py       limit to some cities, for testing
"""

import json
import math
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

import interesting
import bundles as bundlemod

UA = "transit-project-roundup/1 (+https://github.com/Jedlavitch/transit-project-)"
ADSB_DEFAULT = "https://142.93.200.253.sslip.io"
AMTRAK_URL = "https://api-v3.amtraker.com/v3/trains"
REGISTRY = "leaderboard-registry.json"

# Which committed timetables cover each city's RAIL. Buses are deliberately absent —
# the brief is planes and trains, and a metro line competing with forty 30-minute bus
# headways is not a contest anyone wants to read.
#
# Zurich, Cologne and Stuttgart have no bundle at all: those boards read transitous
# live, which is rate-limited and shared. So the bot gets AIRCRAFT ONLY for the three
# German-speaking cities. That is a real gap and the card must render it as an absent
# train, not as a broken feed — "feed unavailable" would be a different, false claim.
CITY_BUNDLES = {
    "dc":        [("marc-schedule.json", "MARC")],
    "philly":    [("septa-rail-schedule.json", "SEPTA Regional Rail"),
                  ("septa-subway-schedule.json", "SEPTA Metro"),
                  ("patco-schedule.json", "PATCO"),
                  ("njt-phl-schedule.json", "NJ Transit")],
    "nj":        [("njt-state-rail-schedule.json", "NJ Transit")],
    "nyc":       [("mta-subway-schedule.json", "Subway"),
                  ("lirr-schedule.json", "Long Island Rail Road"),
                  ("mnr-schedule.json", "Metro-North"),
                  ("path-schedule.json", "PATH"),
                  ("njt-nyc-schedule.json", "NJ Transit")],
    "boston":    [("mbta-subway-schedule.json", "MBTA Subway"),
                  ("mbta-cr-schedule.json", "MBTA Commuter Rail")],
    "la":        [("la-rail-schedule.json", "Metro Rail"),
                  ("la-metrolink-schedule.json", "Metrolink")],
    "sf":        [("sf-bart-schedule.json", "BART"),
                  ("sf-caltrain-schedule.json", "Caltrain"),
                  ("sf-muni-schedule.json", "Muni Metro"),
                  ("sf-cablecar-schedule.json", "Cable Car")],
    "amsterdam": [("ams-rail-schedule.json", "NS"),
                  ("ams-intl-schedule.json", "International"),
                  ("ams-metro-schedule.json", "GVB Metro"),
                  ("ams-tram-schedule.json", "GVB Tram"),
                  ("ams-ferry-schedule.json", "GVB Ferry")],
    "zurich":    [],
    "cologne":   [],
    "stuttgart": [],
}

# The proxy returns empty for rapid successive calls. Measured: nine back-to-back
# fetches all came back with no aircraft, while the same nine spaced ~3s apart every
# one returned traffic. Without this pause the bot would quietly conclude that most
# of the world has an empty sky.
CITY_PAUSE_S = 3.5

# Below this many cities with real data, say nothing. A league table that is mostly
# "feed unavailable" is worse than silence, and an account that posts one anyway is
# not worth following.
MIN_CITIES = 4


def log(msg):
    print(msg, flush=True)


def env(name, default=""):
    return (os.environ.get(name) or default).strip()


# ----------------------------------------------------------------- http
def http_json(url, timeout=30):
    """
    urllib first, curl second.

    Not belt-and-braces: macOS system Python links LibreSSL 2.8.3, which predates
    TLS 1.3, and the ADS-B proxy negotiates TLS 1.3 only — so urllib raises
    TLSV1_ALERT_INTERNAL_ERROR there while curl succeeds. GitHub runners ship
    OpenSSL 3.x and never hit it, but a bot that cannot be run by hand on the
    maintainer's own laptop is a bot nobody will debug.
    """
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.load(r)
    except Exception as first:                                      # noqa: BLE001
        try:
            out = subprocess.run(
                ["curl", "-s", "--max-time", str(timeout), "-A", UA, url],
                capture_output=True, text=True, timeout=timeout + 10).stdout
            if not out.strip():
                raise RuntimeError("empty body")
            return json.loads(out)
        except Exception as second:                                 # noqa: BLE001
            raise RuntimeError("urllib: %s / curl: %s" % (first, second))


def adsb_base():
    return env("ADSB_URL", ADSB_DEFAULT).rstrip("/")


# ----------------------------------------------------------------- registry
def load_registry():
    """
    The learned-rarity registry, committed to the repo so it survives between cron
    runs. A cron job has no memory otherwise, and the whole point of the scoring is
    that "rare" means rare compared with what this bot has actually seen before.
    """
    try:
        with open(REGISTRY, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {}
    except Exception as e:                                          # noqa: BLE001
        log("  ! registry unreadable (%s) — starting a fresh one" % e)
        return {}


def save_registry(reg):
    # Temp file plus os.replace: a run killed mid-write must not leave a truncated
    # registry behind, because the next run would silently treat every token as new.
    tmp = REGISTRY + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(reg, fh, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, REGISTRY)


# ----------------------------------------------------------------- geo
def nm_between(a_lat, a_lon, b_lat, b_lon):
    R = 3440.065
    rad = math.pi / 180
    d_lat = (b_lat - a_lat) * rad
    d_lon = (b_lon - a_lon) * rad
    h = (math.sin(d_lat / 2) ** 2 +
         math.cos(a_lat * rad) * math.cos(b_lat * rad) * math.sin(d_lon / 2) ** 2)
    return 2 * R * math.asin(math.sqrt(h))


# ----------------------------------------------------------------- gathering
def city_aircraft(city):
    """Aircraft overhead, scored. Returns (entries, tokens, error_or_None)."""
    url = "%s/v2/point/%.4f/%.4f/12" % (adsb_base(), city["lat"], city["lon"])
    try:
        data = http_json(url)
    except Exception as e:                                          # noqa: BLE001
        return [], [], "aircraft feed unreachable: %s" % str(e)[:70]

    ac = [a for a in (data.get("ac") or []) if a.get("alt_baro") != "ground"]
    return ac, [], None


def amtrak_for_city(all_trains, city, radius_mi=60):
    """
    Amtrak within radius of the city. ONE national fetch is shared across all
    eleven cities — the feed is 1.1MB and hitting it eleven times would be rude
    to a free service that asks nothing of us.
    """
    out = []
    for _num, arr in (all_trains or {}).items():
        for t in arr or []:
            lat, lon = t.get("lat"), t.get("lon")
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                continue
            nm = nm_between(city["lat"], city["lon"], lat, lon)
            mi = nm * 1.15078
            if mi <= radius_mi:
                out.append((t, mi))
    return out


# ----------------------------------------------------------------- main
def main():
    day_utc = datetime.now(ZoneInfo("UTC")).strftime("%Y-%m-%d")
    only = [c.strip() for c in env("CITIES").split(",") if c.strip()]
    cities = [c for c in interesting.CITIES if not only or c["id"] in only]

    log("Round-up for %s — %d cities" % (day_utc, len(cities)))
    reg = load_registry()

    log("Fetching Amtrak once for everybody...")
    try:
        amtrak_all = http_json(AMTRAK_URL, timeout=45)
        log("  %d trains nationally" % sum(len(v) for v in amtrak_all.values()))
    except Exception as e:                                          # noqa: BLE001
        log("  ! Amtrak unreachable: %s" % e)
        amtrak_all = {}

    rows = []
    for i, city in enumerate(cities):
        # Each city keeps its OWN day. The runner clock is UTC and daily-post fires
        # at 23:10 UTC, which is already tomorrow in Amsterdam — filing a Dutch tram
        # under the wrong date would quietly split its rarity history in two.
        tz = ZoneInfo(city.get("tz") or "UTC")
        city_day = datetime.now(tz).strftime("%Y-%m-%d")
        city_reg = reg.setdefault(city["id"], {})
        mat = interesting.maturity(city_reg)

        log("[%s] %s" % (city["id"], city["label"]))
        row = {"city": city["id"], "label": city["label"],
               "plane": None, "train": None, "error": None}
        tokens = []

        # ---- aircraft -------------------------------------------------------
        ac, _t, err = city_aircraft(city)
        if err:
            row["error"] = err
            log("  ! %s" % err)
        else:
            best = None
            for a in ac:
                op = interesting.operator(a)
                e = interesting.score_plane(a, city_reg, mat, where=city["label"])
                # The canonical gate, not a hand-rolled copy. Re-deriving this is
                # exactly how it got written backwards the first time.
                if not interesting.admits_plane(e, a, op):
                    continue
                tokens += interesting.plane_tokens(a, op)
                if best is None or e["score"] > best["score"]:
                    best = e
            row["plane"] = best
            log("  aircraft: %d aloft, best %s" %
                (len(ac), best["title"] + " " + str(best["score"]) if best else "none"))

        # ---- trains: Amtrak first, it is the only live rail a server can get ---
        best_train = None
        for t, mi in amtrak_for_city(amtrak_all, city):
            e = interesting.score_amtrak(t, mi, city_reg, mat)
            if best_train is None or e["score"] > best_train["score"]:
                best_train = e
            rn = (t.get("routeName") or "").strip()
            dn = (t.get("destName") or "").strip()
            if rn:
                tokens.append("route:" + rn)
            if dn:
                tokens.append("dest:" + dn)

        # ---- trains: the bundled timetables, for everything Amtrak does not reach
        for path, label in CITY_BUNDLES.get(city["id"], []):
            if not os.path.exists(path):
                continue
            try:
                b = bundlemod.load_bundle(path)
                nowm = bundlemod.now_min(city.get("tz") or "UTC")
                dt = datetime.now(tz)
                active = bundlemod.active_services(b, dt.strftime("%Y%m%d"), dt.weekday())
                deps = bundlemod.departures_near(b, city["lat"], city["lon"], nowm, active)
            except bundlemod.BundleLapsed:
                # An expired bundle is not a quiet railway. Say nothing about it
                # rather than reporting zero trains as though none ran.
                log("  ! %s: timetable has lapsed, skipping (NOT reported as quiet)" % label)
                continue
            except Exception as e:                                  # noqa: BLE001
                log("  ! %s: %s" % (label, str(e)[:70]))
                continue
            for d in deps:
                e = interesting.score_rail_row(d, path, label, city_reg, mat)
                if not e:
                    continue
                if best_train is None or e["score"] > best_train["score"]:
                    best_train = e
                tokens.append("line:%s:%s" % (path, d.get("line", "")))
                tokens.append("dest:%s:%s" % (path, d.get("headsign", "")))

        row["train"] = best_train
        log("  trains:   best %s" %
            (best_train["title"] + " " + str(best_train["score"]) if best_train else "none"))

        # The registry learns only from what was actually admitted, and only after
        # scoring — so the first sighting of a day is scored against yesterday's
        # knowledge and genuinely reads as new.
        interesting.note_seen(reg, city["id"], tokens, city_day)
        rows.append(row)

        if i < len(cities) - 1:
            time.sleep(CITY_PAUSE_S)

    interesting.prune(reg, day_utc)
    save_registry(reg)

    live = [r for r in rows if r["plane"] or r["train"]]
    log("\n%d of %d cities produced data" % (len(live), len(rows)))
    if len(live) < MIN_CITIES:
        log("Too few cities reporting to publish an honest round-up. Not posting.")
        return 0

    planes = [r["plane"] for r in rows if r["plane"]]
    trains = [r["train"] for r in rows if r["train"]]
    hero_plane = max(planes, key=lambda e: e["score"]) if planes else None
    hero_train = max(trains, key=lambda e: e["score"]) if trains else None
    # publish.py identifies a hero's city via cityLabel/city (_city_of), and uses it
    # to keep that city out of its own runners-up list. Writing any other key name
    # here silently disables the dedup and the caption names New York twice.
    for r in rows:
        for hero in (hero_plane, hero_train):
            if hero and (r["plane"] is hero or r["train"] is hero):
                hero["cityLabel"] = r["label"]
                hero["city"] = r["city"]

    log("BEST AIRCRAFT: %s" % (hero_plane and
        "%s (%s) %d" % (hero_plane["title"], hero_plane.get("cityLabel", ""), hero_plane["score"])))
    log("BEST TRAIN:    %s" % (hero_train and
        "%s (%s) %d" % (hero_train["title"], hero_train.get("cityLabel", ""), hero_train["score"])))

    return render_and_post(hero_plane, hero_train, rows, day_utc)


def publish_card(*paths):
    """
    Commit and push the card and the registry, so Pages serves them.

    Done from inside the run rather than as a later workflow step because Threads
    needs the image live BEFORE its call, and because splitting render and post
    across two steps meant re-scoring and posting a card nobody had published.
    Failure here is not fatal: Bluesky and Mastodon take bytes and do not need it.
    """
    files = [p for p in list(paths) + [REGISTRY] if os.path.exists(p)]
    try:
        if not subprocess.run(["git", "status", "--porcelain"] + files,
                              capture_output=True, text=True).stdout.strip():
            log("  card unchanged, nothing to publish")
            return True
        subprocess.run(["git", "config", "user.name", "github-actions[bot]"], check=True)
        subprocess.run(["git", "config", "user.email",
                        "41898282+github-actions[bot]@users.noreply.github.com"], check=True)
        subprocess.run(["git", "add"] + files, check=True)
        subprocess.run(["git", "commit", "-m", "Round-up card for " + datetime.now().strftime("%Y-%m-%d")],
                       check=True, capture_output=True)
        subprocess.run(["git", "push"], check=True, capture_output=True)
        log("  card published")
        return True
    except Exception as e:                                          # noqa: BLE001
        log("  ! could not publish the card (%s) — Threads will be skipped, the "
            "byte-based networks are unaffected" % str(e)[:90])
        return False


def render_and_post(hero_plane, hero_train, rows, day):
    import importlib.util

    import publish
    import roundup_card

    # photo of the hero aircraft, via the existing lookup in post-daily.py.
    # Loaded by path because the filename has a hyphen and cannot be imported.
    photo_bytes, photo_credit = None, ""
    if hero_plane and env("CARD_PHOTO", "1") != "0":
        try:
            spec = importlib.util.spec_from_file_location("pdaily", "post-daily.py")
            pdaily = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(pdaily)
            p = pdaily.photo_for({"kind": "plane", "hex": hero_plane.get("hex", ""),
                                  "photoQuery": hero_plane.get("photo_query", ""),
                                  "title": hero_plane.get("title", "")})
            if p:
                log("  photo: %s (%s)" % (p["url"], "exact" if p["exact"] else "representative"))
                photo_bytes, photo_credit = pdaily.fetch_image(p["url"]), p["credit"]
        except Exception as e:                                      # noqa: BLE001
            log("  (no photo: %s)" % str(e)[:80])

    # The card prints the hero's top reason under its name, and the type table's
    # sentences are written to stand alone ("a Boeing 747-400") — directly beneath
    # a headline that already says "Boeing 747-400" they read as a stutter. The
    # captions already suppress that; the card must use the same test or the two
    # halves of the same post disagree about what is worth saying.
    for hero in (hero_plane, hero_train):
        if not hero:
            continue
        kept = [r for r in (hero.get("reasons") or [])
                if not publish._echoes_title(r.get("t", ""), hero)]
        if kept:
            hero["reasons"] = kept

    dated = os.path.join("shots", "daily", day + ".png")
    wide = os.path.join("shots", "daily", day + "-wide.png")
    os.makedirs(os.path.dirname(dated), exist_ok=True)
    day_label = datetime.strptime(day, "%Y-%m-%d").strftime("%a %d %b").upper()

    roundup_card.draw_roundup(hero_plane, hero_train, rows, dated, wide=False,
                              photo_bytes=photo_bytes, photo_credit=photo_credit,
                              day_label=day_label)
    roundup_card.draw_roundup(hero_plane, hero_train, rows, wide, wide=True,
                              photo_bytes=photo_bytes, photo_credit=photo_credit,
                              day_label=day_label)

    # PUBLISH THE CARD BEFORE POSTING ANYTHING.
    #
    # Threads fetches the image from a public URL, so it has to be live first. That
    # is also why the whole run is ONE invocation: an earlier draft rendered in one
    # workflow step and posted in another, which re-scored from scratch and handed
    # Meta the URL of a card built from a different snapshot of the sky.
    if env("COMMIT_CARD") == "1" and env("DRY_RUN") != "1":
        publish_card(dated, wide)

    if env("DRY_RUN") == "1":
        for net in ("threads", "mastodon", "bluesky"):
            log("\n--- %s ---\n%s" % (net, publish.caption_for(net, hero_plane, hero_train, rows, day)))
        log("\nDry run — nothing posted, nothing committed.")
        return 0

    # Bytes-based networks can go now; Threads needs the image publicly served first.
    ok = []
    for fn, net in ((publish.post_bluesky, "bluesky"), (publish.post_mastodon, "mastodon")):
        r = fn(publish.caption_for(net, hero_plane, hero_train, rows, day), dated,
               publish.alt_text_for(net, hero_plane, hero_train, rows))
        if r is not None:
            ok.append(r)

    if env("THREADS_ACCESS_TOKEN"):
        url = "https://%s/shots/daily/%s.png" % (env("SITE", "transitproject.online"), day)
        if publish.wait_for_public_image(url):
            r = publish.post_threads(publish.caption_for("threads", hero_plane, hero_train, rows, day),
                                     url, publish.alt_text_for("threads", hero_plane, hero_train, rows))
            if r is not None:
                ok.append(r)
        else:
            log("  ! the card never became publicly readable; skipped Threads rather than "
                "handing Meta a URL that 404s")

    log("Posted to %d networks." % len([r for r in ok if r]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
