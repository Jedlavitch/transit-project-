#!/usr/bin/env python3
"""
hue-lights.py — your room wears the colour of whatever is flying over it.

WHY THIS EXISTS, AND WHY IT IS NOT A WORKER
  govee-worker.js does this same job for Govee lights through their cloud. That
  route is impossible for Hue and it is worth being clear that it is a routing
  fact, not a missing feature: the Hue bridge lives on your LAN behind a private
  address, and a Cloudflare Worker runs in Cloudflare's network. There is no path
  from one to the other. Hue's own cloud API exists but wants developer
  registration and an OAuth dance.

  Talking to the bridge directly is both the only way and the nicer one. No key
  to apply for, no cloud round trip, no rate limits -- and, unlike the browser
  version, this keeps running when the board is closed. The board is a display;
  the lights do not actually need it, they need the same data it reads.

HOW IT FITS TOGETHER
  airplanes.live  -->  this script  -->  Hue bridge  -->  your lights
                            |
                     night.html (AIRLINE_BRAND)

  The colours are not duplicated here. They are parsed out of night.html at
  startup, so the room and the screen can never disagree about what colour
  United is, and adding a carrier in one place adds it in both.

SETUP (once)
    python3 hue-lights.py --setup      # finds the bridge, asks you to press
                                       # the link button, saves the app key
    python3 hue-lights.py --list       # shows your lights and their ids
    python3 hue-lights.py --light <id> [--light <id> ...]     # choose them
    python3 hue-lights.py --test       # 15s of United blue, then back

RUN
    python3 hue-lights.py              # loop forever, polling every 60s
    python3 hue-lights.py --once       # single pass, for cron/launchd

Config lives in ~/.config/transit-lights/config.json. Nothing here needs pip:
stdlib only, same as spotter-watch.py.
"""

import argparse
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.request

UA = "transit-hue-lights/1"
CONFIG_DIR = os.path.expanduser("~/.config/transit-lights")
CONFIG_PATH = os.path.join(CONFIG_DIR, "config.json")
NIGHT_HTML = os.path.join(os.path.dirname(os.path.abspath(__file__)), "night.html")

# Bethesda — the same default the DC board carries in CITY_CONFIG.dc
DEFAULT_LAT, DEFAULT_LON = 38.9582, -77.1080
DEFAULT_RADIUS_NM = 10        # matches GOVEE_RADIUS_NM in night.html
DWELL_S = 45                  # hold a colour at least this long
CLEAR_S = 90                  # sky empty this long -> put the room back
POLL_S = 60

# The bridge serves HTTPS with a certificate signed by Philips' own CA for a
# hostname that is its bridge id, not its IP. Verifying it means pinning that CA
# and resolving the bridge by id -- real work, for a device on your own LAN that
# you are addressing by address. Unverified TLS to a private IP is the accepted
# trade here, and is what every Hue library does by default.
SSL_CTX = ssl.create_default_context()
SSL_CTX.check_hostname = False
SSL_CTX.verify_mode = ssl.CERT_NONE


# ---------------------------------------------------------------- transport

def _req(url, method="GET", body=None, headers=None, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    h = {"User-Agent": UA}
    if data:
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=timeout, context=SSL_CTX) as r:
        raw = r.read().decode("utf-8", "replace")
    return json.loads(raw) if raw.strip() else None


def bridge_get(cfg, path):
    return _req(f"https://{cfg['bridge']}/clip/v2/resource/{path}",
                headers={"hue-application-key": cfg["key"]})


def bridge_put(cfg, path, body):
    return _req(f"https://{cfg['bridge']}/clip/v2/resource/{path}",
                method="PUT", body=body,
                headers={"hue-application-key": cfg["key"]})


# ---------------------------------------------------------------- config

def load_cfg():
    try:
        with open(CONFIG_PATH) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_cfg(cfg):
    os.makedirs(CONFIG_DIR, exist_ok=True)
    tmp = CONFIG_PATH + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(cfg, fh, indent=1)
    os.replace(tmp, CONFIG_PATH)      # never leave a half-written config behind


# ---------------------------------------------------------------- colours

def airline_brand():
    """The carrier -> hex table, read out of night.html rather than copied.

    One source of truth is the whole point: a colour added to the board should
    light the room too, without anyone remembering there are two lists. If the
    file moves or the table is renamed this returns empty and the script says so
    rather than quietly lighting nothing.
    """
    try:
        with open(NIGHT_HTML, encoding="utf-8") as fh:
            src = fh.read()
    except OSError:
        return {}
    i = src.find("const AIRLINE_BRAND={")
    if i < 0:
        return {}
    block = src[i:src.index("};", i)]
    # keys appear as  AA:"#0078D2"  or  "9E":"#C8102E"
    out = {}
    for k, v in re.findall(r'"?([A-Z0-9]{2,3})"?\s*:\s*"(#[0-9A-Fa-f]{6})"', block):
        out[k] = v
    # TRANSIT_BRAND is deliberately NOT read. This script only ever asks
    # airplanes.live what is overhead, so an agency colour could never be
    # chosen -- but "GVB" and friends are three characters, and a callsign
    # prefix that happened to match one would paint the room a tram colour.
    return out


def hex_to_xy(hexstr):
    """sRGB hex -> CIE xy, the only colour space the v2 light API accepts.

    This is Philips' own published conversion (gamma-expand to linear, then the
    Wide-RGB D65 matrix). Rolling our own matrix would land the hues slightly
    off, and 'slightly off' on a brand colour is the entire point of the
    feature.
    """
    h = hexstr.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    f = lambda c: pow((c + 0.055) / 1.055, 2.4) if c > 0.04045 else c / 12.92
    r, g, b = f(r), f(g), f(b)
    X = r * 0.649926 + g * 0.103455 + b * 0.197109
    Y = r * 0.234327 + g * 0.743075 + b * 0.022598
    Z = g * 0.053077 + b * 1.035763
    s = X + Y + Z
    if s == 0:
        return 0.3127, 0.3290          # D65 white, for a hex of #000000
    return round(X / s, 4), round(Y / s, 4)


# ---------------------------------------------------------------- lights

def list_lights(cfg):
    data = bridge_get(cfg, "light") or {}
    out = []
    for l in data.get("data", []):
        out.append({
            "id": l.get("id"),
            "name": ((l.get("metadata") or {}).get("name")) or l.get("id"),
            "on": ((l.get("on") or {}).get("on")),
            "brightness": ((l.get("dimming") or {}).get("brightness")),
            "xy": (((l.get("color") or {}).get("xy")) or None),
            "color": "color" in l,
        })
    return out


def snapshot(cfg):
    """What the room looked like before we touched it, per chosen light."""
    byid = {l["id"]: l for l in list_lights(cfg)}
    snap = {}
    for lid in cfg.get("lights", []):
        l = byid.get(lid)
        if l:
            snap[lid] = {"on": l["on"], "brightness": l["brightness"], "xy": l["xy"]}
    return snap


def apply_color(cfg, hexstr):
    xy = hex_to_xy(hexstr)
    for lid in cfg.get("lights", []):
        try:
            bridge_put(cfg, "light/" + lid,
                       {"on": {"on": True}, "color": {"xy": {"x": xy[0], "y": xy[1]}}})
        except Exception as e:                                # noqa: BLE001
            print(f"  ! {lid}: {e}", file=sys.stderr)
            return False
    return True


def restore(cfg, snap):
    """Put each light back. A light found OFF only needs turning off again --
    same reasoning as the board's gvRestoreBody(): pushing a colour onto a dark
    lamp is a call to set something nobody can see."""
    for lid, s in (snap or {}).items():
        body = {"on": {"on": bool(s.get("on"))}}
        if s.get("on"):
            if s.get("brightness") is not None:
                body["dimming"] = {"brightness": s["brightness"]}
            if s.get("xy"):
                body["color"] = {"xy": s["xy"]}
        try:
            bridge_put(cfg, "light/" + lid, body)
        except Exception as e:                                # noqa: BLE001
            print(f"  ! restore {lid}: {e}", file=sys.stderr)


# ---------------------------------------------------------------- aircraft

def nearest_carrier(lat, lon, radius_nm, brands):
    """(hex, label) for the nearest aircraft we can name a carrier for.

    Nearest FIRST, then look for a colour -- not "nearest one we happen to have
    a colour for". If a private jet is directly overhead, the honest answer is
    no carrier, not the airliner behind it.
    """
    url = f"https://api.airplanes.live/v2/point/{lat:.4f}/{lon:.4f}/{int(radius_nm)}"
    try:
        d = _req(url, timeout=20)
    except Exception as e:                                    # noqa: BLE001
        print(f"  ! airplanes.live: {e}", file=sys.stderr)
        return None, None
    ac = [a for a in (d or {}).get("ac", []) if a.get("alt_baro") != "ground"]
    if not ac:
        return None, None
    ac.sort(key=lambda a: a.get("dst") if isinstance(a.get("dst"), (int, float)) else 9e9)
    top = ac[0]
    call = str(top.get("flight") or "").strip().upper()
    icao = call[:3]
    hexcol = brands.get(icao)
    return (hexcol, call or icao) if hexcol else (None, call or None)


# ---------------------------------------------------------------- main loop

class Runner:
    def __init__(self, cfg, brands):
        self.cfg, self.brands = cfg, brands
        self.cur = ""          # colour the room is actually wearing
        self.at = 0.0          # when we last changed it
        self.seen = 0.0        # last time anything was overhead
        self.snap = cfg.get("snapshot") or None

    def _remember(self, snap):
        self.snap = snap
        self.cfg["snapshot"] = snap
        save_cfg(self.cfg)     # on disk: a crash mid-colour must not strand the room

    def step(self):
        cfg = self.cfg
        hexcol, label = nearest_carrier(cfg.get("lat", DEFAULT_LAT),
                                        cfg.get("lon", DEFAULT_LON),
                                        cfg.get("radius", DEFAULT_RADIUS_NM),
                                        self.brands)
        now = time.time()
        if hexcol:
            self.seen = now
            if hexcol == self.cur:
                print(f"  {label}: already {hexcol}")
                return
            if now - self.at < DWELL_S:
                print(f"  {label}: holding {self.cur} for another "
                      f"{int(DWELL_S - (now - self.at))}s")
                return
            self.at = now
            first = self.snap is None
            if first:
                self._remember(snapshot(cfg))
            if apply_color(cfg, hexcol):
                self.cur = hexcol
                print(f"  -> {label} {hexcol}")
            else:
                # nothing changed; don't claim it did (same fix as the board's)
                self.cur = ""
                if first:
                    self._remember(None)
            return

        if self.cur and now - self.seen > CLEAR_S:
            print("  sky quiet -> restoring")
            restore(cfg, self.snap)
            self.cur = ""
            self._remember(None)
        else:
            print(f"  nothing overhead{' (holding)' if self.cur else ''}")


# ---------------------------------------------------------------- commands

def cmd_setup(cfg):
    ip = cfg.get("bridge")
    if not ip:
        print("Looking for your bridge…")
        try:
            found = _req("https://discovery.meethue.com")
        except Exception as e:                                # noqa: BLE001
            print(f"! discovery failed: {e}", file=sys.stderr)
            found = []
        if not found:
            print("No bridge found. Pass one: --bridge 192.168.1.x", file=sys.stderr)
            return 1
        ip = found[0]["internalipaddress"]
        print(f"  found {ip}")
    print("\nPress the round LINK BUTTON on top of the bridge, then hit Enter.")
    input()
    # Key creation still goes through the v1 endpoint even for v2 clients --
    # this is Philips' documented flow, not a leftover.
    for attempt in range(3):
        try:
            r = _req(f"https://{ip}/api", method="POST",
                     body={"devicetype": "transit-lights#board", "generateclientkey": True})
        except Exception as e:                                # noqa: BLE001
            print(f"! bridge unreachable: {e}", file=sys.stderr)
            return 1
        first = (r or [{}])[0]
        if "success" in first:
            cfg["bridge"] = ip
            cfg["key"] = first["success"]["username"]
            save_cfg(cfg)
            print(f"Paired. Key saved to {CONFIG_PATH}")
            return 0
        err = (first.get("error") or {}).get("description", "?")
        print(f"  {err} — press the button and press Enter again.")
        if attempt < 2:
            input()
    return 1


def cmd_list(cfg):
    for l in list_lights(cfg):
        mark = "  " if l["color"] else " (no colour)"
        state = "on " if l["on"] else "off"
        print(f'{l["id"]}  {state}{mark} {l["name"]}')
    chosen = cfg.get("lights") or []
    print(f"\nchosen: {', '.join(chosen) if chosen else '(none yet — use --light <id>)'}")
    return 0


def cmd_test(cfg, brands):
    hexcol = brands.get("UAL", "#005DAA")
    snap = snapshot(cfg)
    print(f"United blue ({hexcol}) for 15s…")
    if not apply_color(cfg, hexcol):
        return 1
    time.sleep(15)
    print("restoring…")
    restore(cfg, snap)
    return 0


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--setup", action="store_true")
    p.add_argument("--list", action="store_true")
    p.add_argument("--test", action="store_true")
    p.add_argument("--once", action="store_true")
    p.add_argument("--bridge")
    p.add_argument("--light", action="append", dest="lights")
    p.add_argument("--lat", type=float)
    p.add_argument("--lon", type=float)
    p.add_argument("--radius", type=float)
    a = p.parse_args()

    cfg = load_cfg()
    for k in ("bridge", "lat", "lon", "radius"):
        if getattr(a, k) is not None:
            cfg[k] = getattr(a, k)
    if a.lights:
        cfg["lights"] = a.lights
    if any([a.bridge, a.lights, a.lat, a.lon, a.radius]):
        save_cfg(cfg)
        if a.lights:
            print(f"lights set: {', '.join(a.lights)}")

    if a.setup:
        return cmd_setup(cfg)
    if not cfg.get("bridge") or not cfg.get("key"):
        print("Not paired yet — run:  python3 hue-lights.py --setup", file=sys.stderr)
        return 1
    if a.list:
        return cmd_list(cfg)

    brands = airline_brand()
    if not brands:
        print(f"! no colours found in {NIGHT_HTML} — is it next to this script?",
              file=sys.stderr)
        return 1
    if a.test:
        return cmd_test(cfg, brands)
    if not cfg.get("lights"):
        print("No lights chosen — run --list, then --light <id>", file=sys.stderr)
        return 1

    print(f"{len(brands)} operator colours; watching "
          f"{cfg.get('radius', DEFAULT_RADIUS_NM)}nm around "
          f"{cfg.get('lat', DEFAULT_LAT):.4f},{cfg.get('lon', DEFAULT_LON):.4f}")
    run = Runner(cfg, brands)
    # A snapshot left on disk means the last run died mid-colour. Hand the room
    # back before watching anything new.
    if run.snap:
        print("restoring a room left coloured by the last run…")
        restore(cfg, run.snap)
        run._remember(None)

    while True:
        try:
            run.step()
        except Exception as e:                                # noqa: BLE001
            print(f"! pass failed: {e}", file=sys.stderr)
        if a.once:
            return 0
        time.sleep(POLL_S)


if __name__ == "__main__":
    sys.exit(main())
