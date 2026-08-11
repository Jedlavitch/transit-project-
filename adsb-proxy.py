#!/usr/bin/env python3
"""
adsb-proxy.py — the aircraft feed proxy, as a standalone service.

WHY THIS EXISTS RATHER THAN THE WORKER

adsb-worker.js is correct and does the same job, but it cannot escape one fact:
Cloudflare Workers egress from a SHARED pool of IPs, and adsb.lol rate-limits
per IP. Measured on the deployed Worker — adsb.lol answered a laptop with 200
and 44 aircraft while answering the Worker "429 Too Many Requests" three times
running. The quota was spent by other people's Workers before the first request.

A $5 VPS has its OWN address. It gets adsb.lol's ordinary per-IP allowance,
which one proxy serving cached responses stays comfortably inside. Same logic,
different IP — that is the whole fix.

WHAT IT DOES (identical contract to the Worker, so nothing in the app changes)

    GET /v2/point/<lat>/<lon>/<radiusNm>   -> { ac: [...], source, grid }
    GET /health                            -> { ok, upstream, cache stats }

Three behaviours carried over, each of which was measured into existence:

  GRID SNAPPING. Customers each type their own address, so caching on exact
  coordinates gives every one of them a unique key and N customers cost N
  upstream calls. Rounding to 0.1° puts a whole metro area on one key. The
  upstream query is widened by the worst-case snap offset (2.54nm across the
  real board locations, checked) and each caller is trimmed back to the radius
  they actually asked for — 33 aircraft came back for a Bethesda query, 19
  belonged, 14 did not.

  RECOMPUTED DISTANCE. Upstream measures `dst` from the query centre, which is
  now a grid point. It reported 3.25nm for an aircraft actually 2.18nm away, and
  "nearest aircraft" is a number the boards print. Recomputed per caller.

  STALE ON FAILURE. adsb.lol throttles and its latency spikes (4.6s on one of
  three direct calls, measured). Returning an empty list on that blanks the sky
  and reads as the product being broken. The last good answer is replayed
  instead, flagged `stale` with its age, and refused past STALE_MAX_S because
  past that a position is not honest even dead-reckoned.

ODbL: adsb.lol's data is Open Database Licence. Commercial use is permitted and
ATTRIBUTION IS A CONDITION — the boards already carry "Aircraft data adsb.lol
(ODbL)" whenever this proxy is configured. Do not remove it.

DEPLOY (about five minutes on any $5 box)

    sudo apt install -y python3 && mkdir -p /opt/adsb && cd /opt/adsb
    # copy this file here, then:
    sudo tee /etc/systemd/system/adsb-proxy.service >/dev/null <<'UNIT'
    [Unit]
    Description=ADS-B caching proxy
    After=network-online.target
    [Service]
    ExecStart=/usr/bin/python3 /opt/adsb/adsb-proxy.py
    Environment=PORT=8080
    Restart=always
    RestartSec=3
    User=nobody
    [Install]
    WantedBy=multi-user.target
    UNIT
    sudo systemctl enable --now adsb-proxy

Then put a TLS terminator in front (Caddy is two lines and gets you a
certificate automatically) — the boards are served over https and a browser will
refuse to fetch http from them:

    sudo apt install -y caddy
    echo 'adsb.yourdomain.com { reverse_proxy localhost:8080 }' | sudo tee /etc/caddy/Caddyfile
    sudo systemctl restart caddy

Finally set adsbUrl in config.js to https://adsb.yourdomain.com and redeploy the
site. Nothing else in the app changes.

Standard library only, on purpose: no pip install, no dependency that can break
a box you are not watching.
"""

import json
import math
import os
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

UPSTREAM = os.environ.get("UPSTREAM", "https://api.adsb.lol/v2").rstrip("/")
PORT = int(os.environ.get("PORT", "8080"))

GRID = 0.1          # ~11km cells: one upstream call serves a whole metro area
SNAP_PAD_NM = 5     # covers the worst-case offset from a cell's corner
FRESH_S = 30        # how long a cached answer is served as live
STALE_MAX_S = 600   # past this, refuse rather than draw a stale position
MAX_RADIUS_NM = 250
UPSTREAM_TIMEOUT_S = 12

_cache = {}                 # grid key -> {"at": epoch, "ac": [...]}
_lock = threading.Lock()    # one in-flight fetch per key, so a burst of boards
_inflight = {}              # does not become a burst of upstream calls
_stats = {"hits": 0, "misses": 0, "upstream_ok": 0, "upstream_fail": 0, "stale_served": 0}


def _snap(v):
    return round(round(v / GRID) * GRID, 1)


def _nm_between(lat1, lon1, lat2, lon2):
    """Equirectangular, which is exact enough at these distances and far cheaper
    than haversine when it runs over every aircraft on every request."""
    d_lat = (lat2 - lat1) * 60.0
    d_lon = (lon2 - lon1) * 60.0 * math.cos(math.radians(lat1))
    return math.hypot(d_lat, d_lon)


def _fetch_upstream(q_lat, q_lon, q_radius):
    url = "%s/point/%s/%s/%s" % (UPSTREAM, q_lat, q_lon, q_radius)
    req = urllib.request.Request(url, headers={
        "accept": "application/json",
        # Identify honestly. A feed run by volunteers deserves to know who is
        # calling, and it is what gets you talked to rather than blocked.
        "user-agent": "transit-board-proxy/1.0 (+https://transitproject.online)",
    })
    with urllib.request.urlopen(req, timeout=UPSTREAM_TIMEOUT_S) as r:
        d = json.loads(r.read().decode("utf-8"))
    return d.get("ac") or d.get("aircraft") or []


def _get_cell(q_lat, q_lon, q_radius):
    """Return (aircraft, age_seconds, error). Never raises.

    Collapses concurrent misses onto one upstream call: without this, ten boards
    waking together in the same city would each fire their own request and walk
    straight into the rate limit this proxy exists to avoid."""
    key = (q_lat, q_lon, q_radius)
    now = time.time()

    with _lock:
        entry = _cache.get(key)
        if entry and (now - entry["at"]) < FRESH_S:
            _stats["hits"] += 1
            return entry["ac"], now - entry["at"], None
        ev = _inflight.get(key)
        leader = ev is None
        if leader:
            ev = _inflight[key] = threading.Event()

    if not leader:
        # Someone else is already asking. Wait for them rather than piling on.
        ev.wait(timeout=UPSTREAM_TIMEOUT_S + 2)
        with _lock:
            entry = _cache.get(key)
        if entry:
            age = time.time() - entry["at"]
            return entry["ac"], age, None if age < FRESH_S else "served while refreshing"
        return [], None, "upstream unavailable"

    try:
        _stats["misses"] += 1
        ac = _fetch_upstream(q_lat, q_lon, q_radius)
        with _lock:
            _cache[key] = {"at": time.time(), "ac": ac}
            _stats["upstream_ok"] += 1
        return ac, 0.0, None
    except Exception as e:                      # HTTPError, URLError, timeout, bad JSON
        why = "upstream %s" % getattr(e, "code", type(e).__name__)
        with _lock:
            _stats["upstream_fail"] += 1
            entry = _cache.get(key)
        if entry:
            age = time.time() - entry["at"]
            if age <= STALE_MAX_S:
                with _lock:
                    _stats["stale_served"] += 1
                return entry["ac"], age, why      # stale beats an empty sky
        return [], None, why
    finally:
        with _lock:
            _inflight.pop(key, None)
        ev.set()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, obj, status=200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        # The response is trimmed per caller, so it must not be cached by
        # anything in front of us. Only the upstream call is shared.
        self.send_header("cache-control", "no-store")
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET,OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-methods", "GET,OPTIONS")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("content-length", "0")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]

        if path == "/health":
            with _lock:
                cells, stats = len(_cache), dict(_stats)
            return self._send({"ok": True, "upstream": UPSTREAM,
                               "cells_cached": cells, "stats": stats})

        parts = [p for p in path.split("/") if p]
        if len(parts) != 5 or parts[0] != "v2" or parts[1] != "point":
            return self._send({"ok": False,
                               "error": "expected /v2/point/<lat>/<lon>/<radius>",
                               "ac": []}, 404)
        try:
            t_lat, t_lon = float(parts[2]), float(parts[3])
            radius = float(parts[4])
        except ValueError:
            return self._send({"ok": False, "error": "bad coordinates", "ac": []}, 400)
        if not (-90 <= t_lat <= 90 and -180 <= t_lon <= 180):
            return self._send({"ok": False, "error": "bad coordinates", "ac": []}, 400)

        # Clamp: this endpoint is public, and an unbounded radius turns it into
        # a way for a stranger to hammer a volunteer-run feed using your IP.
        radius = max(1.0, min(MAX_RADIUS_NM, radius))
        q_lat, q_lon = _snap(t_lat), _snap(t_lon)
        q_radius = min(MAX_RADIUS_NM, radius + SNAP_PAD_NM)

        ac, age, err = _get_cell(q_lat, q_lon, q_radius)

        # Re-centre on this caller: their true radius, their true distances.
        out = []
        for a in ac:
            lat, lon = a.get("lat"), a.get("lon")
            if not isinstance(lat, (int, float)) or not isinstance(lon, (int, float)):
                continue
            nm = _nm_between(t_lat, t_lon, lat, lon)
            if nm > radius:
                continue
            b = dict(a)
            b["dst"] = round(nm, 2)
            out.append(b)

        body = {"ac": out, "source": UPSTREAM, "grid": [q_lat, q_lon, q_radius]}
        if err and not out:
            return self._send({"ok": False, "error": err, "ac": []}, 502)
        if age is not None and age >= FRESH_S:
            body["stale"] = True
            body["ageSec"] = int(age)
        if err:
            body["error"] = err
        return self._send(body)

    def log_message(self, fmt, *args):
        pass        # journald already timestamps; per-request noise fills a small disk


def _sweep():
    """Drop cells nobody has asked for lately, so memory tracks live demand."""
    while True:
        time.sleep(300)
        cutoff = time.time() - STALE_MAX_S
        with _lock:
            for k in [k for k, v in _cache.items() if v["at"] < cutoff]:
                del _cache[k]


if __name__ == "__main__":
    threading.Thread(target=_sweep, daemon=True).start()
    print("adsb-proxy on :%d -> %s" % (PORT, UPSTREAM), flush=True)
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
