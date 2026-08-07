#!/usr/bin/env python3
"""
spotter-watch.py — alerts you when something you've logged comes past, with the
Spotter app closed.

WHY THIS EXISTS
  The in-app notifications only fire while the Spotter is open, because a phone
  cannot poll in the background. Waking a closed phone needs something else
  watching, and something else able to push. This is the watcher; ntfy.sh is the
  push. Neither needs an account, a key, or an Apple Developer membership.

HOW IT FITS TOGETHER
  The phone already publishes its log to a jsonblob (the "share code" the boards
  read). That same blob carries the alert settings, so this script needs exactly
  one piece of configuration -- the blob id -- and everything else follows the
  user's own app. Dedupe state is written back into the blob, because a cron job
  has no memory between runs.

  phone  --publishes-->  jsonblob  <--reads/writes--  this script  --POST-->  ntfy
                                                            |
                                                    airplanes.live / amtraker

RUN
  SPOT_BLOB=<blob-uuid> python3 spotter-watch.py
  Optional: SPOT_ONCE=0 to loop forever (for an always-on host) instead of a
  single pass (for cron).
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BLOB_API = "https://jsonblob.com/api/jsonBlob/"
NTFY = "https://ntfy.sh/"
UA = "transit-spotter-watch/1 (+https://github.com/Jedlavitch/transit-project-)"
COOLDOWN_S = 30 * 60          # same 30 min the in-app alerts use
DEFAULT_RADIUS_NM = 12


def get_json(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def put_json(url, payload, timeout=20):
    body = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=body, method="PUT",
        headers={"User-Agent": UA, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.status


def notify(topic, title, message, tag):
    """Fire and forget: a failed alert must never stop the watch loop."""
    req = urllib.request.Request(
        NTFY + topic,
        data=message.encode("utf-8"),
        headers={"User-Agent": UA,
                 "Title": title.encode("utf-8").decode("latin-1", "replace"),
                 "Tags": tag},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status == 200
    except Exception as e:                                   # noqa: BLE001
        print(f"  ! ntfy failed: {e}", file=sys.stderr)
        return False


def ident(v):
    return str(v or "").strip().upper()


def live_now(lat, lon, radius_nm):
    """Vehicle identities currently near that point, by mode.

    Only feeds that are keyless and CORS-free are used, so this needs no secrets:
    airplanes.live for aircraft, amtraker for Amtrak. Local buses and metros need
    a per-city key or a bundled timetable, so they are left to the in-app alerts
    -- see the note in the workflow about what this can and cannot cover.
    """
    out = {"plane": set(), "train": set()}
    try:
        d = get_json(f"https://api.airplanes.live/v2/point/{lat:.4f}/{lon:.4f}/{int(radius_nm)}")
        for a in d.get("ac", []):
            if a.get("alt_baro") == "ground":
                continue
            for k in (a.get("flight"), a.get("r")):
                if ident(k):
                    out["plane"].add(ident(k))
    except Exception as e:                                   # noqa: BLE001
        print(f"  ! airplanes.live: {e}", file=sys.stderr)
    try:
        d = get_json("https://api-v3.amtraker.com/v3/trains", timeout=25)
        for arr in (d or {}).values():
            for t in arr or []:
                if not isinstance(t, dict):
                    continue
                if t.get("trainState") and t["trainState"] != "Active":
                    continue
                tlat, tlon = t.get("lat"), t.get("lon")
                if not isinstance(tlat, (int, float)) or not isinstance(tlon, (int, float)):
                    continue
                # rough degrees box ~25 mi, good enough to decide "near"
                if abs(tlat - lat) > 0.4 or abs(tlon - lon) > 0.5:
                    continue
                if ident(t.get("trainNum")):
                    out["train"].add(ident(t.get("trainNum")))
    except Exception as e:                                   # noqa: BLE001
        print(f"  ! amtraker: {e}", file=sys.stderr)
    return out


def run_once(blob_id):
    url = BLOB_API + blob_id
    try:
        blob = get_json(url)
    except Exception as e:                                   # noqa: BLE001
        print(f"! cannot read blob: {e}", file=sys.stderr)
        return 1

    push = (blob or {}).get("push") or {}
    topic = str(push.get("topic") or "").strip()
    if not topic:
        print("no alert topic set in the app yet — nothing to do")
        return 0
    lat, lon = push.get("lat"), push.get("lon")
    if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
        print("no location saved for alerts yet — nothing to do")
        return 0
    radius = push.get("radiusNm") or DEFAULT_RADIUS_NM

    spots = [s for s in (blob.get("spots") or []) if isinstance(s, dict)]
    if not spots:
        print("log is empty — nothing to match")
        return 0

    live = live_now(float(lat), float(lon), radius)
    seen = blob.get("notified") or {}
    now = time.time()
    fired = 0

    for s in spots:
        mode = str(s.get("mode") or "")
        pool = live.get(mode)
        if not pool:
            continue
        r, v = ident(s.get("route")), ident(s.get("vehicle"))
        if not ((r and r in pool) or (v and v in pool)):
            continue
        tag = f"{mode}:{r or v}"
        if tag in seen and now - float(seen.get(tag) or 0) < COOLDOWN_S:
            continue
        seen[tag] = now
        icon = {"plane": "airplane", "train": "train", "bus": "bus"}.get(mode, "eyes")
        rode = " and rode" if s.get("ridden") else ""
        if notify(topic,
                  f"{s.get('route') or 'A vehicle'} is passing you now",
                  f"The {mode} you logged{rode} is near you right now.",
                  icon):
            fired += 1
            print(f"  -> alerted: {tag}")

    # drop stale dedupe entries so the blob can't grow without bound
    seen = {k: t for k, t in seen.items() if now - float(t or 0) < COOLDOWN_S * 4}
    if fired or seen != (blob.get("notified") or {}):
        blob["notified"] = seen
        try:
            put_json(url, blob)
        except Exception as e:                               # noqa: BLE001
            print(f"  ! could not save dedupe state: {e}", file=sys.stderr)

    print(f"checked {len(spots)} logged, "
          f"{len(live['plane'])} aircraft + {len(live['train'])} trains near, "
          f"{fired} alert(s) sent")
    return 0


def main():
    blob_id = (os.environ.get("SPOT_BLOB") or "").strip()
    if not blob_id:
        print("SPOT_BLOB is not set — add the share code as a repository secret",
              file=sys.stderr)
        return 1
    once = os.environ.get("SPOT_ONCE", "1") != "0"
    if once:
        return run_once(blob_id)
    # always-on mode: poll every 60s, which is what planes actually need
    while True:
        try:
            run_once(blob_id)
        except Exception as e:                               # noqa: BLE001
            print(f"! pass failed: {e}", file=sys.stderr)
        time.sleep(60)


if __name__ == "__main__":
    sys.exit(main())
