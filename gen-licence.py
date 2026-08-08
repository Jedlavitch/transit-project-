#!/usr/bin/env python3
"""
gen-licence.py — mint licence keys for the feed proxy.

Keys are SIGNED, not stored. The proxy checks a key by recomputing its signature
from one secret, so there is no database, no KV namespace and no binding to
create — the single step that has gone wrong every previous time. Deploy one
Worker with one environment variable and it works.

The trade-off that buys: without storage there is no per-key usage tracking, and
revoking one key before it expires means listing it in REVOKED (see below). For
a few dozen hobbyist customers that is a good trade; at thousands it is not.

    # one secret, once, kept somewhere safe and pasted into the Worker
    python3 gen-licence.py --new-secret

    # a key valid for a year
    python3 gen-licence.py --secret <SECRET> --days 365

    # check one
    python3 gen-licence.py --secret <SECRET> --check TB-XXXXX-XXXXX-XXXXX-XXXXX
"""

import argparse
import base64
import hashlib
import hmac
import os
import secrets
import sys
import time

# Crockford-ish: no I, L, O or U, so a customer reading a key aloud or off a
# screen cannot turn it into a different valid-looking one.
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
EPOCH = 1577836800          # 2020-01-01, so an expiry fits in two bytes of days
SIG_LEN = 5                 # 40 bits — forging one needs ~10^12 tries against a
                            # live endpoint, which rate limiting makes hopeless


def b32encode(data: bytes) -> str:
    bits = int.from_bytes(data, "big")
    width = (len(data) * 8 + 4) // 5
    return "".join(ALPHABET[(bits >> (5 * (width - 1 - i))) & 31] for i in range(width))


def b32decode(text: str) -> bytes:
    text = "".join(c for c in text.upper() if c in ALPHABET)
    bits = 0
    for c in text:
        bits = (bits << 5) | ALPHABET.index(c)
    nbytes = len(text) * 5 // 8
    return bits.to_bytes((len(text) * 5 + 7) // 8, "big")[-nbytes:] if nbytes else b""


def sign(secret: str, raw: bytes) -> bytes:
    return hmac.new(secret.encode(), raw, hashlib.sha256).digest()[:SIG_LEN]


def mint(secret: str, days: int) -> str:
    ident = secrets.token_bytes(5)
    expiry_day = int((time.time() - EPOCH) // 86400) + days
    if not 0 <= expiry_day <= 0xFFFF:
        sys.exit("--days puts the expiry outside the supported range (to ~2199)")
    raw = ident + expiry_day.to_bytes(2, "big")
    body = b32encode(raw + sign(secret, raw))
    return "TB-" + "-".join(body[i:i + 5] for i in range(0, len(body), 5))


def check(secret: str, key: str):
    data = b32decode(key.replace("TB-", "", 1))
    if len(data) < 7 + SIG_LEN:
        return False, "too short to be a key", None
    raw, sig = data[:7], data[7:7 + SIG_LEN]
    if not hmac.compare_digest(sig, sign(secret, raw)):
        return False, "signature does not match this secret", None
    expiry_day = int.from_bytes(raw[5:7], "big")
    expires = EPOCH + expiry_day * 86400
    left = (expires - time.time()) / 86400
    ident = raw[:5].hex()
    if left < 0:
        return False, f"expired {abs(left):.0f} days ago", ident
    return True, f"valid, {left:.0f} days left", ident


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--new-secret", action="store_true", help="print a fresh signing secret")
    ap.add_argument("--secret", default=os.environ.get("TB_LICENCE_SECRET", ""))
    ap.add_argument("--days", type=int, default=365)
    ap.add_argument("--count", type=int, default=1)
    ap.add_argument("--check", metavar="KEY")
    a = ap.parse_args()

    if a.new_secret:
        print(base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("="))
        print("\nPaste this into the Worker as the LICENCE_SECRET variable, and keep a copy.",
              file=sys.stderr)
        print("Losing it invalidates every key you have issued.", file=sys.stderr)
        return 0

    if not a.secret:
        sys.exit("need --secret (or set TB_LICENCE_SECRET)")

    if a.check:
        ok, why, ident = check(a.secret, a.check)
        print(("VALID  " if ok else "INVALID") + f"  {why}" + (f"  id={ident}" if ident else ""))
        return 0 if ok else 1

    for _ in range(a.count):
        print(mint(a.secret, a.days))
    return 0


if __name__ == "__main__":
    sys.exit(main())
