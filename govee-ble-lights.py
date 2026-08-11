#!/usr/bin/env python3
"""
govee-ble-lights.py — bedroom strip wears the colour of whatever is flying over.

FOR BLUETOOTH-ONLY GOVEE STRIPS (tested target: H617A)
  The H617A has no Wi-Fi radio. It is invisible to Govee's cloud API, so
  govee-worker.js cannot drive it and never will — that Worker only ever sees
  devices registered on the account over Wi-Fi. The only way in is Bluetooth
  from a machine in the same room.

  Govee publishes nothing about their BLE protocol. The packets below come from
  the Home Assistant community's reverse-engineering of this exact model:
  https://community.home-assistant.io/t/govee-h617a-ble-led-strip-lights-reverse-engineering/901353
  They are self-consistent — the documented on/off/keep-alive checksums all fall
  out of the same XOR — which is the best assurance available short of a strip
  to try them on.

WHAT IT CANNOT DO
  Restore the strip to how it was. BLE on this model is write-only: there is no
  characteristic to read the current colour or power state from, so "put it back
  the way you found it" — which the Wi-Fi version does properly — is impossible
  here. Instead the strip returns to an idle you choose (--idle off, the default,
  or --idle "#RRGGBB"). This is a real downgrade from the Govee/Hue versions and
  not something a cleverer script could fix.

CONNECTION STYLE
  Connect, send, disconnect — rather than holding the link open with the 2s
  keep-alive the protocol also supports. BLE allows one connection at a time, so
  a persistent link would mean the Govee phone app could never control the strip
  while this runs. Connecting costs a few seconds, and we change colour at most
  once every 45s, so the trade is heavily worth it: the app keeps working
  normally except during the moment of a change.

SETUP
    pip3 install --user bleak
    python3 govee-ble-lights.py --scan            # find the strip's address
    python3 govee-ble-lights.py --address <UUID>  # remember it
    python3 govee-ble-lights.py --test            # 15s of United blue
    python3 govee-ble-lights.py                   # watch, polling every 60s

macOS will ask for Bluetooth permission the first time; if it does not, grant it
under System Settings -> Privacy & Security -> Bluetooth.

    python3 govee-ble-lights.py --selftest        # packet checks, no Bluetooth
"""

import argparse
import asyncio
import json
import os
import re
import sys
import time
import urllib.request

UA = "transit-govee-ble/1"
CONFIG_DIR = os.path.expanduser("~/.config/transit-lights")
CONFIG_PATH = os.path.join(CONFIG_DIR, "ble.json")
NIGHT_HTML = os.path.join(os.path.dirname(os.path.abspath(__file__)), "night.html")

CHAR_UUID = "00010203-0405-0607-0809-0a0b0c0d2b11"

DEFAULT_LAT, DEFAULT_LON = 38.9582, -77.1080     # Bethesda, as CITY_CONFIG.dc has it
DEFAULT_RADIUS_NM = 10
DWELL_S, CLEAR_S, POLL_S = 45, 90, 60


# ---------------------------------------------------------------- packets

def packet(body):
    """20 bytes: the command, zero padding, and an XOR of the first 19 as the
    last byte. Every documented packet checks out against this — on is
    0x33^0x01^0x01=0x33, off is 0x32, keep-alive is 0xAA^0x01=0xAB."""
    if len(body) > 19:
        raise ValueError("body too long")
    b = bytearray(20)
    b[0:len(body)] = bytes(body)
    x = 0
    for v in b[:19]:
        x ^= v
    b[19] = x
    return bytes(b)


PWR_ON = packet([0x33, 0x01, 0x01])
PWR_OFF = packet([0x33, 0x01, 0x00])
KEEPALIVE = packet([0xAA, 0x01])


def color_packet(r, g, b):
    # 33 05 15 01 R G B 00*5 FF 7F 00*5 [xor] -- the 15/01 selects the segmented
    # (RGBIC) colour mode and FF 7F addresses every segment on the strip.
    return packet([0x33, 0x05, 0x15, 0x01, r, g, b,
                   0x00, 0x00, 0x00, 0x00, 0x00, 0xFF, 0x7F])


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


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
    os.replace(tmp, CONFIG_PATH)


def airline_brand():
    """Carrier -> hex, parsed out of night.html so the room and the screen can
    never disagree. TRANSIT_BRAND is deliberately skipped: this only asks
    adsb.lol what is overhead, and a three-letter agency key like GVB
    could collide with a callsign prefix."""
    try:
        with open(NIGHT_HTML, encoding="utf-8") as fh:
            src = fh.read()
    except OSError:
        return {}
    i = src.find("const AIRLINE_BRAND={")
    if i < 0:
        return {}
    block = src[i:src.index("};", i)]
    return {k: v for k, v in
            re.findall(r'"?([A-Z0-9]{2,3})"?\s*:\s*"(#[0-9A-Fa-f]{6})"', block)}


# ---------------------------------------------------------------- bluetooth

def _bleak():
    """Imported late and by hand so that --selftest, --help and the packet
    logic all work on a machine with no bleak and no Bluetooth, and so a missing
    dependency reads as a sentence rather than an import traceback."""
    try:
        from bleak import BleakClient, BleakScanner
        return BleakClient, BleakScanner
    except ImportError:
        print("bleak is not installed.  pip3 install --user bleak", file=sys.stderr)
        raise SystemExit(1)


async def _send(address, packets):
    BleakClient, _ = _bleak()
    async with BleakClient(address, timeout=20.0) as c:
        for p in packets:
            await c.write_gatt_char(CHAR_UUID, p, response=False)
            await asyncio.sleep(0.15)      # the strip drops packets sent back to back


def send(address, packets):
    try:
        asyncio.run(_send(address, packets))
        return True
    except Exception as e:                                    # noqa: BLE001
        print(f"  ! bluetooth: {e}", file=sys.stderr)
        return False


async def _scan():
    _, BleakScanner = _bleak()
    found = await BleakScanner.discover(timeout=8.0)
    return [(d.address, d.name or "?") for d in found]


def cmd_scan():
    devs = asyncio.run(_scan())
    # Govee strips advertise under a few different prefixes depending on the
    # production run, so show everything and mark the likely ones rather than
    # filtering the strip out by accident.
    for addr, name in sorted(devs, key=lambda x: x[1]):
        hint = "  <-- looks like a Govee strip" if re.search(
            r"govee|ihoment|GBK|H6[0-9A-Fa-f]{3}", name, re.I) else ""
        print(f"{addr}  {name}{hint}")
    if not devs:
        print("Nothing found. Is the strip powered, and is Bluetooth on?")
    return 0


# ---------------------------------------------------------------- aircraft

def nearest_carrier(lat, lon, radius_nm, brands):
    url = f"https://api.adsb.lol/v2/point/{lat:.4f}/{lon:.4f}/{int(radius_nm)}"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.load(r)
    except Exception as e:                                    # noqa: BLE001
        print(f"  ! adsb.lol: {e}", file=sys.stderr)
        return None, None
    ac = [a for a in (d or {}).get("ac", []) if a.get("alt_baro") != "ground"]
    if not ac:
        return None, None
    # nearest FIRST, then look for a colour. If a private jet is overhead the
    # honest answer is "no carrier", not the airliner behind it.
    ac.sort(key=lambda a: a.get("dst") if isinstance(a.get("dst"), (int, float)) else 9e9)
    call = str(ac[0].get("flight") or "").strip().upper()
    return brands.get(call[:3]), (call or None)


# ---------------------------------------------------------------- loop

def apply_color(addr, hexstr):
    r, g, b = hex_rgb(hexstr)
    return send(addr, [PWR_ON, color_packet(r, g, b)])


def go_idle(addr, idle):
    if idle and idle != "off":
        r, g, b = hex_rgb(idle)
        return send(addr, [PWR_ON, color_packet(r, g, b)])
    return send(addr, [PWR_OFF])


def run(cfg, brands, once):
    addr, idle = cfg["address"], cfg.get("idle", "off")
    cur, at, seen = "", 0.0, 0.0
    print(f"{len(brands)} carrier colours; watching "
          f"{cfg.get('radius', DEFAULT_RADIUS_NM)}nm around "
          f"{cfg.get('lat', DEFAULT_LAT):.4f},{cfg.get('lon', DEFAULT_LON):.4f}")
    while True:
        try:
            hexcol, label = nearest_carrier(cfg.get("lat", DEFAULT_LAT),
                                            cfg.get("lon", DEFAULT_LON),
                                            cfg.get("radius", DEFAULT_RADIUS_NM),
                                            brands)
            now = time.time()
            if hexcol:
                seen = now
                if hexcol == cur:
                    print(f"  {label}: already {hexcol}")
                elif now - at < DWELL_S:
                    print(f"  {label}: holding for {int(DWELL_S - (now - at))}s more")
                else:
                    at = now
                    # only claim the colour if the strip took it -- an
                    # out-of-range strip must not suppress the next retry
                    cur = hexcol if apply_color(addr, hexcol) else ""
                    if cur:
                        print(f"  -> {label} {hexcol}")
            elif cur and now - seen > CLEAR_S:
                print("  sky quiet -> idle")
                if go_idle(addr, idle):
                    cur = ""
            else:
                print(f"  nothing overhead{' (holding)' if cur else ''}")
        except Exception as e:                                # noqa: BLE001
            print(f"! pass failed: {e}", file=sys.stderr)
        if once:
            return 0
        time.sleep(POLL_S)


# ---------------------------------------------------------------- selftest

def cmd_selftest():
    """Checks the packets against the bytes the reverse-engineering documented,
    so a transcription slip shows up here rather than as a strip that does
    nothing."""
    ok = True

    def chk(name, got, want):
        nonlocal ok
        w = bytes.fromhex(want.replace(" ", ""))
        good = got == w
        ok &= good
        print(f"  {'ok ' if good else 'FAIL'} {name}: {got.hex(' ')}")
        if not good:
            print(f"       expected: {w.hex(' ')}")

    chk("power on ", PWR_ON,
        "33 01 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 33")
    chk("power off", PWR_OFF,
        "33 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 32")
    chk("keepalive", KEEPALIVE,
        "AA 01 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 AB")
    # United blue #005DAA -> 00 5D AA, xor of the constant part is 0xA2
    want_xor = 0xA2 ^ 0x00 ^ 0x5D ^ 0xAA
    chk("UA blue  ", color_packet(0x00, 0x5D, 0xAA),
        f"33 05 15 01 00 5D AA 00 00 00 00 00 FF 7F 00 00 00 00 00 {want_xor:02X}")

    brands = airline_brand()
    print(f"  {'ok ' if len(brands) > 50 else 'FAIL'} parsed {len(brands)} carrier colours "
          f"(UAL={brands.get('UAL')})")
    ok &= len(brands) > 50
    print("\nall good" if ok else "\nSOMETHING IS WRONG")
    return 0 if ok else 1


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--scan", action="store_true")
    p.add_argument("--selftest", action="store_true")
    p.add_argument("--test", action="store_true")
    p.add_argument("--once", action="store_true")
    p.add_argument("--address")
    p.add_argument("--idle", help='"off" (default) or a hex colour like "#221100"')
    p.add_argument("--lat", type=float)
    p.add_argument("--lon", type=float)
    p.add_argument("--radius", type=float)
    a = p.parse_args()

    if a.selftest:
        return cmd_selftest()
    if a.scan:
        return cmd_scan()

    cfg = load_cfg()
    for k in ("address", "idle", "lat", "lon", "radius"):
        if getattr(a, k) is not None:
            cfg[k] = getattr(a, k)
    if any(getattr(a, k) is not None for k in ("address", "idle", "lat", "lon", "radius")):
        save_cfg(cfg)
        print(f"saved to {CONFIG_PATH}")

    if not cfg.get("address"):
        print("No strip chosen yet — run --scan, then --address <address>", file=sys.stderr)
        return 1

    brands = airline_brand()
    if not brands:
        print(f"! no colours found in {NIGHT_HTML}", file=sys.stderr)
        return 1

    if a.test:
        hexcol = brands.get("UAL", "#005DAA")
        print(f"United blue ({hexcol}) for 15s…")
        if not apply_color(cfg["address"], hexcol):
            return 1
        time.sleep(15)
        print("back to idle…")
        go_idle(cfg["address"], cfg.get("idle", "off"))
        return 0

    return run(cfg, brands, a.once)


if __name__ == "__main__":
    sys.exit(main())
