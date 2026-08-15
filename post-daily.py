#!/usr/bin/env python3
"""
post-daily.py — posts the day's most interesting plane or train.

WHAT IT DOES
  Reads the leaderboard the boards have been building (the share code, the same
  jsonblob the leaderboard page writes), draws the card, and posts it to
  whichever networks have credentials set. Nothing else.

WHAT IT WILL NOT DO
  Invent a post. If no board was running, or the list is from a day that is not
  the one being posted, it says so and exits 0 without posting. A daily account
  that goes quiet on a quiet day is honest; one that posts a made-up aircraft is
  not, and the first time somebody checks the tail number that account is over.

HOW THE DATA GETS HERE
  boards (interesting.js)  --PUT-->  jsonblob  --GET-->  this script  --> networks
  The boards only publish when a share code is set, which is deliberate: with no
  code nothing ever leaves the device, and there is nothing here to post.

SET UP
  See SOCIAL.md. Short version: put your share code in the LEADER_BLOB secret,
  then add credentials for as many networks as you want. Every network is
  independent — set none and this is a no-op that draws a card and stops.

RUN
  LEADER_BLOB=<uuid> python3 post-daily.py
  DRY_RUN=1  draw the card and print the caption, post nothing   (default when
             no credentials are present)
  SCOPE=all|dc|nyc|...   which leaderboard to post (default: all)
  OUT=path.png           where to write the card (default: shots/leaderboard-latest.png)
"""

import base64
import hashlib
import hmac
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
from datetime import datetime, timezone

BLOB_API = "https://jsonblob.com/api/jsonBlob/"
UA = "transit-project-daily/1 (+https://github.com/Jedlavitch/transit-project-)"
SITE = "transitproject.online"
LINK = "https://%s/leaderboard.html" % SITE

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


# ---------------------------------------------------------------- the data

def fetch_leaders(blob_id):
    url = BLOB_API + blob_id
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def pick(box, scope):
    """The winner, and the runners-up, for one scope."""
    cities = (box or {}).get("cities") or {}
    if scope == "all":
        rows = []
        for city, lst in cities.items():
            for e in (lst or []):
                e = dict(e)
                e.setdefault("city", city)
                rows.append(e)
    else:
        rows = [dict(e, city=scope) for e in (cities.get(scope) or [])]
    rows.sort(key=lambda e: e.get("score", 0), reverse=True)
    return rows


def mix_for_display(rows, n, min_minority=1):
    """
    Keep the true order, but let the minority kind appear among the runners-up
    when it exists at all. The winner is never swapped — claiming an aircraft
    won when a train did would be a lie, and the card prints the reasons so it
    can be checked.
    """
    if len(rows) <= n:
        return list(rows)
    head = rows[:n]
    kinds = {e.get("kind") for e in head}
    short = "plane" if "plane" not in kinds else ("train" if "train" not in kinds else None)
    if not short:
        return head
    missing = [e for e in rows if e.get("kind") == short][:min_minority]
    if not missing:
        return head
    return head[:max(1, n - len(missing))] + missing


def city_label(e):
    return e.get("cityLabel") or CITY_LABELS.get(e.get("city", ""), e.get("city", ""))


# ---------------------------------------------------------------- pictures
# The exact airframe from planespotters.net by ADS-B hex, falling back to a
# representative photo from Wikimedia Commons. Server-side there is no CORS to
# work around, so unlike the browser card this one can always use the real
# aeroplane — which is the whole point, because livery is not in any feed and a
# photograph is the only way anybody sees it.
#
# planespotters REQUIRES a descriptive User-Agent with a contact URL and rejects
# generic library strings outright; UA above is that. Photographs stay their
# photographer's, so the credit is drawn onto the card, not dropped.

def photo_for(entry):
    """Returns {'url','credit','exact'} or None. Never raises."""
    hexid = (entry.get("hex") or "").strip()
    if entry.get("kind") == "plane" and hexid:
        try:
            _, body = http("https://api.planespotters.net/pub/photos/hex/" +
                           urllib.parse.quote(hexid), timeout=20)
            photos = (json.loads(body) or {}).get("photos") or []
            for p in photos:
                src = (p.get("thumbnail_large") or p.get("thumbnail") or {}).get("src")
                if src:
                    return {"url": src, "exact": True,
                            "credit": "photo © %s · planespotters.net" % (p.get("photographer") or "")}
        except Exception as e:                                      # noqa: BLE001
            log("  (no planespotters photo: %s)" % detail(e))

    q = entry.get("photoQuery") or entry.get("title") or ""
    if not q:
        return None
    try:
        url = ("https://commons.wikimedia.org/w/api.php?action=query&generator=search"
               "&gsrsearch=%s&gsrnamespace=6&gsrlimit=8&prop=imageinfo"
               "&iiprop=url|extmetadata&iiurlwidth=1600&format=json"
               % urllib.parse.quote(q))
        _, body = http(url, timeout=20)
        pages = ((json.loads(body) or {}).get("query") or {}).get("pages") or {}
        best = sorted(pages.values(), key=lambda p: p.get("index", 0))
        for page in best:
            info = (page.get("imageinfo") or [{}])[0]
            title = str(page.get("title") or "")
            if not re.search(r"\.(jpe?g|png|webp)$", title, re.I):
                continue
            if re.search(r"\b(map|diagram|logo|icon|seal|chart|schematic|timetable|sign|ticket)\b",
                         title, re.I):
                continue
            src = info.get("thumburl") or info.get("url")
            if not src:
                continue
            artist = re.sub(r"<[^>]+>", "", (info.get("extmetadata") or {})
                            .get("Artist", {}).get("value", "") or "").strip()
            return {"url": src, "exact": False,
                    "credit": ("representative photo · %s · Wikimedia Commons" % artist).replace(" ·  · ", " · ")}
    except Exception as e:                                          # noqa: BLE001
        log("  (no Commons photo: %s)" % detail(e))
    return None


def fetch_image(url):
    try:
        _, body = http(url, timeout=30)
        return body
    except Exception as e:                                          # noqa: BLE001
        log("  (photo download failed: %s)" % detail(e))
        return None


# ---------------------------------------------------------------- the card

def find_font(bold=False, mono=False):
    """
    Pillow needs a real font file. Ubuntu runners always have DejaVu, which is
    what this falls back to; FONT_DIR lets anyone point at IBM Plex to match the
    boards exactly. Returns a path or None (None means Pillow's tiny bitmap
    default, which would look wrong, so the caller treats it as fatal).
    """
    names = []
    d = env("FONT_DIR")
    if d:
        if mono:
            names += [os.path.join(d, n) for n in
                      ("IBMPlexMono-SemiBold.ttf", "IBMPlexMono-Medium.ttf", "IBMPlexMono-Regular.ttf")]
        else:
            names += [os.path.join(d, n) for n in
                      ("Archivo-ExtraBold.ttf", "Archivo-Bold.ttf",
                       "IBMPlexSans-Bold.ttf", "IBMPlexSans-Regular.ttf")]
    if mono:
        names += ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
                  "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
                  "/System/Library/Fonts/Menlo.ttc"]
    else:
        names += ["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
                  if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
                  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                  "/System/Library/Fonts/Helvetica.ttc"]
    for n in names:
        if n and os.path.exists(n):
            return n
    return None


def wrap(draw, text, font_path, size, max_w, max_lines, ImageFont):
    """Shrink until it fits in max_lines. The name is the post; never truncate it."""
    while True:
        f = ImageFont.truetype(font_path, size)
        lines, line = [], ""
        for word in str(text or "").split():
            t = (line + " " + word).strip()
            if draw.textlength(t, font=f) <= max_w or not line:
                line = t
            else:
                lines.append(line)
                line = word
        if line:
            lines.append(line)
        if len(lines) <= max_lines or size <= 22:
            return lines, f
        size -= 3


def draw_card(win, others, scope, out_path, wide=False, photo_bytes=None, photo_credit=""):
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        log("! Pillow is not installed — no image will be attached.")
        return None

    body_f = find_font(bold=True)
    mono_f = find_font(mono=True)
    if not body_f or not mono_f:
        log("! No usable font found — no image will be attached.")
        return None

    W, H = (1200, 675) if wide else (1080, 1080)
    pad = 66 if wide else 78
    img = Image.new("RGB", (W, H), (10, 19, 48))
    d = ImageDraw.Draw(img)

    # background: the boards' own gradient, top-left navy to bottom-right violet
    for y in range(H):
        t = y / max(1, H - 1)
        d.line([(0, y), (W, y)],
               fill=(int(10 + 10 * t), int(19 - 6 * t), int(48 - 12 * t)))
    # brand rule
    for x in range(W):
        t = x / max(1, W - 1)
        if t < 0.5:
            u = t / 0.5
            col = (int(255 - 176 * u), int(61 + 100 * u), int(119 + 136 * u))
        else:
            u = (t - 0.5) / 0.5
            col = (int(79 - 79 * u), int(161 + 63 * u), int(255 - 57 * u))
        d.line([(x, 0), (x, 7)], fill=col)

    # The photograph, cover-cropped across the top and faded into the card.
    photo_h = 0
    if photo_bytes:
        try:
            import io
            src = Image.open(io.BytesIO(photo_bytes)).convert("RGB")
            photo_h = int(H * (0.46 if not wide else 0.42))
            s = max(W / src.width, photo_h / src.height)
            src = src.resize((max(1, int(src.width * s)), max(1, int(src.height * s))),
                             Image.LANCZOS)
            # planespotters' public API tops out at 497px wide, so filling a
            # 1080px card means roughly a 2x upscale. A light unsharp mask puts
            # back the edge definition Lanczos softens; without it the aircraft
            # looks slightly out of focus at full size.
            if s > 1.35:
                from PIL import ImageFilter
                src = src.filter(ImageFilter.UnsharpMask(radius=1.6, percent=115, threshold=3))
            left = (src.width - W) // 2
            top = (src.height - photo_h) // 2
            img.paste(src.crop((left, top, left + W, top + photo_h)), (0, 0))
            # fade the lower part into the card colour, so the type sits on ink
            # rather than on whatever was in the sky that day
            fade_from = int(photo_h * 0.45)
            for yy in range(fade_from, photo_h):
                a = (yy - fade_from) / max(1, photo_h - fade_from)
                band = img.crop((0, yy, W, yy + 1)).convert("RGB")
                base = Image.new("RGB", (W, 1), (10, 19, 48))
                img.paste(Image.blend(band, base, a), (0, yy))
            d = ImageDraw.Draw(img)
            if photo_credit:
                f_c = ImageFont.truetype(mono_f, 16)
                cw = d.textlength(photo_credit, font=f_c)
                d.text((W - 18 - cw, photo_h - 30), photo_credit, font=f_c,
                       fill=(200, 214, 240))
            # brand rule sits over the photo, not under it
            for x in range(W):
                t = x / max(1, W - 1)
                if t < 0.5:
                    u = t / 0.5
                    col = (int(255 - 176 * u), int(61 + 100 * u), int(119 + 136 * u))
                else:
                    u = (t - 0.5) / 0.5
                    col = (int(79 - 79 * u), int(161 + 63 * u), int(255 - 57 * u))
                d.line([(x, 0), (x, 7)], fill=col)
        except Exception as e:                                      # noqa: BLE001
            log("  (photo could not be composited: %s)" % detail(e))
            photo_h = 0

    y = (photo_h + 34) if photo_h else (pad + 8)
    f_kick = ImageFont.truetype(mono_f, 22 if not wide else 20)
    where = city_label(win) if scope == "all" else CITY_LABELS.get(scope, scope)
    kicker = "MOST INTERESTING TODAY" + (" · " + where.upper() if where else "")
    d.text((pad, y), kicker, font=f_kick, fill=(147, 165, 207))

    y += 56 if photo_h else (74 if not wide else 58)
    name_max = W - pad * 2 - (0 if not wide else 200)
    name_size = (74 if not wide else 60) if photo_h else (88 if not wide else 70)
    lines, f_name = wrap(d, win.get("title", "—"), body_f, name_size,
                         name_max, 3 if not wide else 2, ImageFont)
    for ln in lines:
        d.text((pad, y), ln, font=f_name, fill=(238, 243, 255))
        y += int(f_name.size * 1.08)

    y += 12
    meta = "  ·  ".join([s for s in (win.get("sub"), win.get("detail")) if s])
    mlines, f_meta = wrap(d, meta, mono_f, 30 if not wide else 26, W - pad * 2, 2, ImageFont)
    for ln in mlines:
        d.text((pad, y), ln, font=f_meta, fill=(124, 192, 255))
        y += int(f_meta.size * 1.3)

    y += 30 if not wide else 18
    f_w = ImageFont.truetype(mono_f, 24 if not wide else 21)
    f_r = ImageFont.truetype(body_f, 27 if not wide else 23)
    max_rsn = (3 if not wide else 2) if photo_h else (4 if not wide else 3)
    for r in (win.get("reasons") or [])[:max_rsn]:
        txt = str(r.get("t", ""))
        txt = txt[:1].upper() + txt[1:]
        chip_h = 60 if not wide else 52
        tw = min(d.textlength(txt, font=f_r), W - pad * 2 - 130)
        d.rounded_rectangle([pad, y - 8, pad + tw + 118, y + chip_h - 16], radius=12,
                            fill=(28, 34, 62))
        d.text((pad + 20, y + 4), "+%d" % r.get("w", 0), font=f_w, fill=(255, 209, 102))
        # clip rather than overflow the chip
        t2 = txt
        while d.textlength(t2, font=f_r) > W - pad * 2 - 130 and len(t2) > 4:
            t2 = t2[:-1]
        if t2 != txt:
            t2 += "…"
        d.text((pad + 96, y), t2, font=f_r, fill=(238, 243, 255))
        y += chip_h + (12 if not wide else 8)

    # Runners-up fill what is otherwise a large empty band on the square card,
    # and they earn their place: they say this is a ranking of a whole day's
    # traffic rather than one lucky sighting.
    score_top = H - pad - (104 if not wide else 86) - 26
    if others and y < score_top - 150:
        f_lab = ImageFont.truetype(mono_f, 18)
        d.line([(pad, y + 14), (W - pad, y + 14)], fill=(34, 52, 90), width=2)
        d.text((pad, y + 30), "ALSO TODAY", font=f_lab, fill=(95, 116, 166))
        y += 62
        f_ru = ImageFont.truetype(body_f, 26 if not wide else 22)
        f_rs = ImageFont.truetype(mono_f, 24 if not wide else 20)
        for o in others[:2]:
            if y > score_top - 40:
                break
            t = o.get("title", "—")
            while d.textlength(t, font=f_ru) > W - pad * 2 - 240 and len(t) > 4:
                t = t[:-1]
            if t != o.get("title", "—"):
                t += "…"
            d.text((pad, y), t, font=f_ru, fill=(147, 165, 207))
            sc = str(o.get("score", 0))
            d.text((pad + W - pad * 2 - d.textlength(sc, font=f_rs) - 190, y),
                   sc, font=f_rs, fill=(124, 192, 255))
            lbl = city_label(o) if scope == "all" else ""
            if lbl:
                f_c = ImageFont.truetype(mono_f, 17)
                d.text((W - pad - d.textlength(lbl.upper(), font=f_c), y + 6),
                       lbl.upper(), font=f_c, fill=(95, 116, 166))
            y += 46 if not wide else 38

    # score, bottom right
    f_score = ImageFont.truetype(mono_f, 104 if not wide else 86)
    f_slab = ImageFont.truetype(mono_f, 18)
    s = str(win.get("score", 0))
    sw = d.textlength(s, font=f_score)
    sy = H - pad - (104 if not wide else 86) - 26
    d.text((W - pad - sw, sy), s, font=f_score, fill=(255, 209, 102))
    slab = "AIRCRAFT SCORE" if win.get("kind") == "plane" else "RAIL SCORE"
    lw = d.textlength(slab, font=f_slab)
    d.text((W - pad - lw, sy + (104 if not wide else 86) + 6), slab, font=f_slab,
           fill=(147, 165, 207))

    f_foot = ImageFont.truetype(mono_f, 20)
    d.text((pad, H - pad + 4), SITE.upper(), font=f_foot, fill=(95, 116, 166))

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    img.save(out_path, "PNG", optimize=True)
    log("  card written: %s (%dx%d)" % (out_path, W, H))
    return out_path


# ---------------------------------------------------------------- the words

def build_caption(win, others, scope, limit=None):
    where = city_label(win) if scope == "all" else CITY_LABELS.get(scope, scope)
    reasons = [str(r.get("t", "")) for r in (win.get("reasons") or [])[:2]]
    reasons = [r[:1].upper() + r[1:] for r in reasons if r]
    why = ". ".join(reasons)
    if why and not why.endswith("."):
        why += "."
    tags = "#avgeek #planespotting" if win.get("kind") == "plane" else "#trainspotting #railfan"
    runner = ""
    if others:
        runner = "\n\nRunner-up: %s (%d)." % (others[0].get("title", "—"), others[0].get("score", 0))

    parts = [
        "Most interesting over %s today: %s." % (where, win.get("title", "—")),
        "",
        "%s Scored %d." % (why, win.get("score", 0)),
    ]
    text = "\n".join(parts) + runner + "\n\n" + LINK + "\n\n" + tags
    if limit and len(text) > limit:
        # drop the runner-up first, then the tags, then trim the reasons
        text = "\n".join(parts) + "\n\n" + LINK + "\n\n" + tags
    if limit and len(text) > limit:
        text = "\n".join(parts) + "\n\n" + LINK
    if limit and len(text) > limit:
        head = "Most interesting over %s today: %s." % (where, win.get("title", "—"))
        text = head + "\n\n" + LINK
    if limit and len(text) > limit:
        text = text[: limit - 1] + "…"
    return text


def alt_text(win, scope):
    where = city_label(win) if scope == "all" else CITY_LABELS.get(scope, scope)
    bits = [
        "A dark card headed 'most interesting today' for %s." % where,
        "It names %s." % win.get("title", "an aircraft or train"),
    ]
    if win.get("sub") or win.get("detail"):
        bits.append(" ".join([s for s in (win.get("sub"), win.get("detail")) if s]) + ".")
    for r in (win.get("reasons") or [])[:2]:
        # .capitalize() would lowercase the rest, turning "an Airbus A380" into
        # "an airbus a380" — the one place the model name must not be touched
        t = str(r.get("t", ""))
        bits.append(t[:1].upper() + t[1:] + ".")
    bits.append("Score %d." % win.get("score", 0))
    return " ".join(bits)[:1900]


# ---------------------------------------------------------------- http bits

def http(url, data=None, headers=None, method=None, timeout=45):
    req = urllib.request.Request(url, data=data, method=method,
                                 headers=dict({"User-Agent": UA}, **(headers or {})))
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        return r.status, body


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


# ---------------------------------------------------------------- networks
# Each poster returns True on success. Each is independent: a network with no
# credentials is skipped silently, and one that fails must not stop the others.

def post_bluesky(text, image, alt):
    handle, app_pw = env("BSKY_HANDLE"), env("BSKY_APP_PASSWORD")
    if not handle or not app_pw:
        return None
    host = env("BSKY_HOST", "https://bsky.social").rstrip("/")
    try:
        _, body = http(host + "/xrpc/com.atproto.server.createSession",
                       data=json.dumps({"identifier": handle, "password": app_pw}).encode(),
                       headers={"Content-Type": "application/json"})
        sess = json.loads(body)
        jwt, did = sess["accessJwt"], sess["did"]
        auth = {"Authorization": "Bearer " + jwt}

        embed = None
        if image and os.path.exists(image):
            with open(image, "rb") as fh:
                blob = fh.read()
            _, b = http(host + "/xrpc/com.atproto.repo.uploadBlob", data=blob,
                        headers=dict(auth, **{"Content-Type": "image/png"}))
            embed = {"$type": "app.bsky.embed.images",
                     "images": [{"alt": alt, "image": json.loads(b)["blob"]}]}

        record = {
            "$type": "app.bsky.feed.post",
            "text": text,
            "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "facets": link_facets(text),
        }
        if embed:
            record["embed"] = embed
        http(host + "/xrpc/com.atproto.repo.createRecord",
             data=json.dumps({"repo": did, "collection": "app.bsky.feed.post",
                              "record": record}).encode(),
             headers=dict(auth, **{"Content-Type": "application/json"}))
        log("  ✓ Bluesky")
        return True
    except Exception as e:                                          # noqa: BLE001
        log("  ! Bluesky failed: %s" % detail(e))
        return False


def link_facets(text):
    """
    Bluesky does not linkify on its own, and it counts in UTF-8 BYTES, not
    characters — an em dash in the caption shifts every index after it, so the
    offsets are measured on the encoded form.
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


def post_mastodon(text, image, alt):
    base, token = env("MASTODON_BASE_URL").rstrip("/"), env("MASTODON_TOKEN")
    if not base or not token:
        return None
    auth = {"Authorization": "Bearer " + token}
    try:
        media_ids = []
        if image and os.path.exists(image):
            with open(image, "rb") as fh:
                blob = fh.read()
            body, ct = multipart({"description": alt},
                                 {"file": (os.path.basename(image), blob, "image/png")})
            _, b = http(base + "/api/v2/media", data=body,
                        headers=dict(auth, **{"Content-Type": ct}))
            media_ids.append(json.loads(b)["id"])
            # a large attachment can still be processing; Mastodon answers 202
            # and the status would post without it if we went straight on
            time.sleep(2)
        data = urllib.parse.urlencode([("status", text)] +
                                      [("media_ids[]", m) for m in media_ids]).encode()
        http(base + "/api/v1/statuses", data=data,
             headers=dict(auth, **{"Content-Type": "application/x-www-form-urlencoded"}))
        log("  ✓ Mastodon")
        return True
    except Exception as e:                                          # noqa: BLE001
        log("  ! Mastodon failed: %s" % detail(e))
        return False


def oauth1_header(method, url, consumer_key, consumer_secret, token, token_secret, extra=None):
    """
    OAuth 1.0a, which X still requires for posting as a user. Only the oauth_*
    parameters are signed here: the request bodies used below are JSON and
    multipart, and the spec only folds the body into the signature when it is
    form-encoded.
    """
    params = {
        "oauth_consumer_key": consumer_key,
        "oauth_nonce": "".join(random.choice(string.ascii_letters + string.digits) for _ in range(32)),
        "oauth_signature_method": "HMAC-SHA1",
        "oauth_timestamp": str(int(time.time())),
        "oauth_token": token,
        "oauth_version": "1.0",
    }
    params.update(extra or {})
    q = lambda s: urllib.parse.quote(str(s), safe="~")              # noqa: E731
    norm = "&".join("%s=%s" % (q(k), q(params[k])) for k in sorted(params))
    base = "&".join([method.upper(), q(url), q(norm)])
    key = "%s&%s" % (q(consumer_secret), q(token_secret))
    sig = base64.b64encode(hmac.new(key.encode(), base.encode(), hashlib.sha1).digest()).decode()
    params["oauth_signature"] = sig
    return "OAuth " + ", ".join('%s="%s"' % (q(k), q(v)) for k, v in sorted(params.items()))


def post_x(text, image, alt):
    ck, cs = env("X_API_KEY"), env("X_API_SECRET")
    tok, ts = env("X_ACCESS_TOKEN"), env("X_ACCESS_SECRET")
    if not (ck and cs and tok and ts):
        return None
    try:
        media_id = None
        if image and os.path.exists(image):
            up = "https://upload.twitter.com/1.1/media/upload.json"
            with open(image, "rb") as fh:
                blob = fh.read()
            body, ct = multipart({}, {"media": (os.path.basename(image), blob, "image/png")})
            hdr = oauth1_header("POST", up, ck, cs, tok, ts)
            _, b = http(up, data=body, headers={"Authorization": hdr, "Content-Type": ct})
            media_id = str(json.loads(b)["media_id_string"])
            # alt text is a separate call, and worth making: a card of small
            # type is unreadable to a screen reader without it
            meta = "https://upload.twitter.com/1.1/media/metadata/create.json"
            try:
                http(meta,
                     data=json.dumps({"media_id": media_id, "alt_text": {"text": alt[:1000]}}).encode(),
                     headers={"Authorization": oauth1_header("POST", meta, ck, cs, tok, ts),
                              "Content-Type": "application/json"})
            except Exception:                                       # noqa: BLE001
                pass

        url = "https://api.twitter.com/2/tweets"
        payload = {"text": text}
        if media_id:
            payload["media"] = {"media_ids": [media_id]}
        http(url, data=json.dumps(payload).encode(),
             headers={"Authorization": oauth1_header("POST", url, ck, cs, tok, ts),
                      "Content-Type": "application/json"})
        log("  ✓ X")
        return True
    except Exception as e:                                          # noqa: BLE001
        log("  ! X failed: %s" % detail(e))
        return False


def post_discord(text, image, alt):
    hook = env("DISCORD_WEBHOOK")
    if not hook:
        return None
    try:
        files = {}
        if image and os.path.exists(image):
            with open(image, "rb") as fh:
                files["file"] = (os.path.basename(image), fh.read(), "image/png")
        body, ct = multipart({"payload_json": json.dumps({"content": text})}, files)
        http(hook, data=body, headers={"Content-Type": ct})
        log("  ✓ Discord")
        return True
    except Exception as e:                                          # noqa: BLE001
        log("  ! Discord failed: %s" % detail(e))
        return False


def detail(e):
    """HTTP errors carry the reason in the body; without it every failure reads
    the same and there is nothing to act on."""
    if isinstance(e, urllib.error.HTTPError):
        try:
            return "HTTP %s — %s" % (e.code, e.read().decode("utf-8", "replace")[:400])
        except Exception:                                           # noqa: BLE001
            return "HTTP %s" % e.code
    return "%s: %s" % (type(e).__name__, e)


# ---------------------------------------------------------------- main

def main():
    blob = env("LEADER_BLOB")
    scope = env("SCOPE", "all")
    out = env("OUT", "shots/leaderboard-latest.png")
    wide_out = env("OUT_WIDE", "shots/leaderboard-latest-wide.png")

    if not blob:
        log("LEADER_BLOB is not set — nothing to read. See SOCIAL.md.")
        return 0

    log("Reading the shared leaderboard…")
    try:
        box = fetch_leaders(blob)
    except Exception as e:                                          # noqa: BLE001
        log("! Could not read the share code: %s" % detail(e))
        return 0

    day = (box or {}).get("day") or ""
    rows = pick(box, scope)
    log("  day=%s  scope=%s  entries=%d" % (day or "?", scope, len(rows)))

    if not rows:
        log("Nothing scored — no board was running, or nothing stood out. Not posting.")
        return 0

    # A stale list means the boards have been off. Posting yesterday's aircraft
    # as "today" is the one thing that would make this account untrustworthy.
    allow_stale = env("ALLOW_STALE") == "1"
    today = datetime.now().strftime("%Y-%m-%d")
    if day and day != today and not allow_stale:
        log("The list is from %s, not %s — the boards have not been running. Not posting."
            % (day, today))
        return 0

    shown = mix_for_display(rows, 3, 1)
    win, others = shown[0], shown[1:3]
    log("  winner: %s (%s) — %d" % (win.get("title"), city_label(win), win.get("score", 0)))

    # CARD_PHOTO=0 turns the picture off. Photographs belong to the people who
    # took them: planespotters' are used under their API's terms with the credit
    # drawn on the card, Commons' under their own licences. If you would rather
    # post a card that is purely your own data, set it and this draws type only.
    photo_bytes, photo_credit = None, ""
    if env("CARD_PHOTO", "1") != "0":
        p = photo_for(win)
        if p:
            log("  photo: %s (%s)" % (p["url"], "exact airframe" if p["exact"] else "representative"))
            photo_bytes = fetch_image(p["url"])
            photo_credit = p["credit"]

    img = draw_card(win, others, scope, out, wide=False,
                    photo_bytes=photo_bytes, photo_credit=photo_credit)
    draw_card(win, others, scope, wide_out, wide=True,
              photo_bytes=photo_bytes, photo_credit=photo_credit)
    alt = alt_text(win, scope)

    have_creds = any([
        env("BSKY_HANDLE") and env("BSKY_APP_PASSWORD"),
        env("MASTODON_BASE_URL") and env("MASTODON_TOKEN"),
        env("X_API_KEY") and env("X_ACCESS_TOKEN"),
        env("DISCORD_WEBHOOK"),
    ])
    dry = env("DRY_RUN") == "1" or not have_creds

    caption = build_caption(win, others, scope)
    log("\n--- caption ---\n%s\n---------------\n" % caption)

    if dry:
        log("Dry run%s — nothing posted." %
            ("" if env("DRY_RUN") == "1" else " (no network credentials are set)"))
        return 0

    results = [
        post_bluesky(caption, img, alt),
        post_mastodon(caption, img, alt),
        post_x(build_caption(win, others, scope, limit=280), img, alt),
        post_discord(caption, img, alt),
    ]
    tried = [r for r in results if r is not None]
    ok = [r for r in tried if r]
    log("Posted to %d of %d configured networks." % (len(ok), len(tried)))
    # A failure is reported but does not fail the workflow: one bad token should
    # not turn the whole job red every morning.
    return 0


if __name__ == "__main__":
    sys.exit(main())
