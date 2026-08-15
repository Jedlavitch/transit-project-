#!/usr/bin/env python3
"""
roundup_card.py — draws the daily round-up card: one photograph, two heroes,
and every city.

WHAT IT DRAWS
  A two-deck card in the boards' own visual language (same gradient, same brand
  rule, same palette as draw_card() in post-daily.py). Top deck: the day's best
  AIRCRAFT as a photograph, then two labelled hero lines — BEST AIRCRAFT and
  BEST TRAIN — each with its own name, meta line, top reason and score. Bottom
  deck: a league table with one row per city and three columns — the city, its
  best aircraft, its best train.

WHY PLANES AND TRAINS ARE KEPT APART
  They are not comparable. An aircraft scores on type rarity and operator; a
  train scores on lateness and line rarity, and the two ladders were tuned
  independently (interesting.js:504 vs :756). Ranking them in one list makes the
  card assert an equivalence the scorer never claimed, and in practice it meant
  one kind quietly swept every slot. Two heroes and two columns say what is
  actually known: the best of each, separately.

WHY THE PHOTOGRAPH IS ALWAYS AN AIRCRAFT
  planespotters returns the EXACT airframe by ADS-B hex, so an aircraft hero can
  be shown as itself. There is no equivalent for a train: the best a rail entry
  gets is a representative photo of the wrong unit on the wrong day, which is a
  picture that quietly misrepresents. So the photo band belongs to the aircraft,
  and the train hero is carried by type.

WHAT IT WILL NOT DRAW
  A city that is not there. Every city passed in gets a row, always. If a feed
  failed the row says "feed unavailable"; if the feed answered and nothing
  cleared the bar the row says "nothing scored". Those are different claims and
  the card makes them differently. Dropping the row would assert that nothing
  happened in Boston, which is the one thing this card cannot know.

  A card that refutes itself. The hero and the table are two views of one list.
  If the hero's score does not match the top of its own column, drawing stops
  and nothing is written — see the block comment on _hero_agrees().

INTERFACE
  draw_roundup(hero_plane, hero_train, city_rows, out_path, wide=False,
               photo_bytes=None, photo_credit="", day_label="") -> str or None

  hero_plane / hero_train  one interesting.js finish() entry each, or None:
                           {title, sub, detail, score, reasons:[{w,t}], ...}
  city_rows                [{city, label, plane: entry|None, train: entry|None,
                             error: str|None}, ...]
  returns                  out_path, or None if the card could not honestly be
                           drawn (no Pillow, no font, or hero/table disagree)

WHY THIS FILE DUPLICATES find_font() AND THE FIT HELPERS
  post-daily.py is not importable — the hyphen in its name is not a legal Python
  identifier — so the alternative to a copy is renaming a file the workflow
  calls by path. The copies are deliberate and small; if find_font() changes
  there, change it here too.

RUN IT ALONE
  python3 roundup_card.py [outdir]     renders both sizes from sample data into
                                       outdir (default /tmp), draws no network.
"""

import io
import os
import re

SITE = "transitproject.online"

# The boards' palette, unchanged from draw_card() (post-daily.py:256-409) so the
# round-up and the single-winner card read as the same account.
INK = (238, 243, 255)
MUTED = (147, 165, 207)
DIM = (95, 116, 166)
BLUE = (124, 192, 255)
GOLD = (255, 209, 102)
RULE = (34, 52, 90)
ZEBRA = (16, 25, 54)
GROUND = (10, 19, 48)
CREDIT = (200, 214, 240)

# Every monospace face this card can resolve to advances 0.6021 em per glyph
# (measured on /System/Library/Fonts/Menlo.ttc: every advance is 1233/2048;
# DejaVu Sans Mono matches it). That is where the column budgets below come
# from. It is NOT how anything is positioned: IBM Plex Mono is 0.600 em, which
# is 4px of drift across a 20-character column, so every draw still measures.
MONO_EM = 0.6021

# The control glyph for has_arrow(). Written as an escape on purpose: a literal
# Private Use Area character is invisible in every editor and would be silently
# lost by an innocent copy-paste, which would quietly break the arrow check.
PUA = "\ue000"

# How many characters the row shortener aims at before the measured clip takes
# over. These are budgets, not limits — see _row_title().
#
# WHERE THE NUMBERS COME FROM, AND WHY THEY ARE NOT MEASURED HERE. The title
# columns are proportional, and find_font() resolves to a different face on
# every machine, so a budget tuned on one face overflows on another. Measured on
# this Mac over a corpus of real row titles, Arial Bold averages 0.53 em per
# character. DejaVu Sans Bold — what the ubuntu-latest runner actually gets, and
# therefore the face that has to fit — is about 12% wider than that on the same
# text, so the budgets below are set at 0.60 em per character: 27 chars at row
# size 19 is 308px against a 324px column, and 34 at size 18 is 367px against
# 407px. Both leave headroom, and clip() still measures at draw time regardless.
CHARS_SQUARE = 27
CHARS_WIDE = 34


def log(msg):
    print(msg, flush=True)


def env(name, default=""):
    return (os.environ.get(name) or default).strip()


# ---------------------------------------------------------------- fonts

def find_font(bold=False, mono=False):
    """
    Pillow needs a real font file. Ubuntu runners always have DejaVu, which is
    what this falls back to; FONT_DIR lets anyone point at IBM Plex to match the
    boards exactly. Returns a path or None (None means Pillow's tiny bitmap
    default, which would look wrong, so the caller treats it as fatal).

    Kept byte-for-byte in step with post-daily.py:189-219 on purpose.
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


def has_arrow(draw, font):
    """
    U+2192 buys two characters a row over the word "to", which on a three-column
    table is worth having. But Pillow draws a codepoint the face does not carry
    as a hollow .notdef box rather than falling back to another font, and
    find_font() can resolve to DejaVu, Archivo, IBM Plex or Helvetica depending
    on the machine — so this measures rather than hopes.

    The control is U+E000, the first Private Use Area codepoint, which no text
    font maps. If the arrow measures exactly like it — same advance, same
    bounding box — then both are the same .notdef glyph and the arrow is not
    really in the face. False negatives are harmless: the card falls back to
    "to", which is two characters longer and always correct.
    """
    try:
        arrow = (draw.textlength("→", font=font), tuple(font.getbbox("→")))
        absent = (draw.textlength(PUA, font=font), tuple(font.getbbox(PUA)))
        return arrow != absent
    except Exception:                                               # noqa: BLE001
        return False


def clip(draw, text, font, max_w):
    """
    Trim to fit, marking the trim. This is the BACKSTOP, not the plan: rows are
    built short by _row_title() so that this rarely fires. When it does, the
    ellipsis matters — a silently cut registration or destination is a wrong
    claim, where a visibly cut one is only a short one.
    """
    t = str(text or "")
    if not t or draw.textlength(t, font=font) <= max_w:
        return t
    while len(t) > 1 and draw.textlength(t + "…", font=font) > max_w:
        t = t[:-1]
    return t.rstrip(" ·-→") + "…"


def fit_line(draw, text, font_path, size, floor, max_w, ImageFont):
    """
    Shrink a hero name until it fits on ONE line, then clip only as a last
    resort. Same instinct as wrap() (post-daily.py:222-239) — the name is the
    post, so never truncate it while there is type size left to give up — but
    single-line, because the two-hero deck has a fixed height and a name that
    wraps would push the second hero into the table.
    """
    t = str(text or "").strip() or "—"
    while size > floor:
        f = ImageFont.truetype(font_path, size)
        if draw.textlength(t, font=f) <= max_w:
            return t, f
        size -= 2
    f = ImageFont.truetype(font_path, floor)
    return clip(draw, t, f, max_w), f


def top_for_baseline(font, baseline_y):
    """
    Pillow anchors text at the TOP-LEFT; leaderboard.html's canvas twin anchors
    at the BASELINE, and every y in this file is a top. In the table that is not
    enough on its own: three columns at three different sizes given the same top
    sit on three different baselines, and it shows. So the row columns are
    positioned by the baseline they should share and converted here, using the
    face's own ascent rather than a fudge factor, because the ascent differs
    between DejaVu, Helvetica and IBM Plex.
    """
    try:
        return int(baseline_y - font.getmetrics()[0])
    except Exception:                                               # noqa: BLE001
        return int(baseline_y - font.size * 0.93)


# ---------------------------------------------------------------- the words
# Rows must be BUILT short, not clipped short. The titles the scorer produces
# ("Bombardier Regional Jet CRJ-700", "Red to Shady Grove") are written for a
# hero line, where there is room for them.

MANUFACTURER = re.compile(
    r"^(?:Boeing|Airbus Helicopters|Airbus|Embraer|Bombardier|Antonov|Canadair|"
    r"Cessna|Gulfstream|Lockheed(?: Martin)?|McDonnell Douglas|Douglas|Sikorsky|"
    r"Dassault|Pilatus|Beechcraft|Beech|Piper|Fokker|Saab|Robinson|Bell|"
    r"Eurocopter|Leonardo|AgustaWestland|Agusta|Textron|Cirrus|Diamond|Mooney|"
    r"Tecnam|De Havilland Canada|De Havilland|Britten-Norman|Ilyushin|Tupolev|"
    r"Sukhoi|Mitsubishi|Kawasaki|Learjet|Grumman|Raytheon|Hawker|BAe|"
    r"British Aerospace|Aerospatiale|Air Tractor|Quest|Viking)\s+", re.I)

# "Regional Jet CRJ-700" is marketing wrapped around the designator; the
# designator is the part a reader recognises.
MARKETING = re.compile(r"^(?:Regional Jet|Business Jet|Corporate Jet|Bizjet)\s+", re.I)

# "American Airlines" -> "American" is a contraction everybody reads correctly.
# Nothing else is dropped: "Cathay Cargo", "Maryland State Police" and "Antonov
# Design Bureau" all mean something different with a word missing.
AIRLINE_WORD = re.compile(r"\s+(?:Air Lines|Airlines|Airways|Airline)$", re.I)

CALLSIGN = re.compile(r"^[A-Z0-9][A-Z0-9\-]{1,9}$")


def _clean(s):
    return str(s if s is not None else "").strip()


def _score(entry):
    """Scores arrive as ints from finish(); anything else is not a score."""
    if not entry:
        return 0
    v = entry.get("score")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return 0
    return int(v)


def _short_type(title):
    """'Airbus A380-861' -> 'A380-861'. The manufacturer is the droppable half:
    no reader needs telling that an A380 is an Airbus, and the designator is
    what identifies the airframe."""
    t = _clean(title)
    for pattern in (MANUFACTURER, MARKETING):
        cut = pattern.sub("", t, count=1).strip()
        # Only take the cut if what is left still identifies something. A
        # two-letter remnant identifies nothing.
        if cut != t and len(cut) >= 3:
            t = cut
    return t or _clean(title)


def _op_and_callsign(sub):
    """
    scorePlane() builds `sub` as [operator, callsign or registration] joined
    with " · " (interesting.js:592), and drops whichever it does not have — so a
    one-part sub is ambiguous. A callsign or a registration is all upper case
    with no spaces; an operator name is not. Never invent the missing one.
    """
    parts = [p.strip() for p in _clean(sub).split("·") if p.strip()]
    if len(parts) >= 2:
        return parts[0], parts[1]
    if len(parts) == 1:
        return ("", parts[0]) if CALLSIGN.match(parts[0]) else (parts[0], "")
    return "", ""


def _plane_row_title(entry, max_chars):
    """'A380 · Emirates', falling back to the callsign when no operator is
    known. If it still will not fit, the operator goes and the type stays: the
    type is what the photograph shows and what the score was mostly made of."""
    typ = _short_type(entry.get("title"))
    op, cs = _op_and_callsign(entry.get("sub"))
    tail = op or cs
    out = (typ + " · " + tail) if tail else typ
    if len(out) > max_chars and op:
        short_op = AIRLINE_WORD.sub("", op).strip()
        if short_op and short_op != op:
            out = typ + " · " + short_op
    if len(out) > max_chars and op and cs:
        out = typ + " · " + cs
    if len(out) > max_chars:
        out = typ
    return out


def _cut_dest(dest):
    """Destinations arrive qualified — 'Shady Grove, MD', 'Newark (Penn
    Station)'. The qualifier is the part a row can lose without changing which
    train it is."""
    return re.split(r"\s*[,(\[/]", _clean(dest), 1)[0].strip() or _clean(dest)


def _train_row_title(entry, max_chars, arrow):
    """
    'Red → Shady Grove'. scoreRow() builds the title as "<line> to <dest>"
    (interesting.js:768) and scoreAmtrak() as "<route> <number>"; the first has
    a separator worth exploiting and the second does not.

    Nothing is word-dropped from a destination. Losing the qualifier after a
    comma leaves the same place; losing a word off the end invents a different
    one ("Shady Grove" -> "Shady"), so past that point the measured clip takes
    over and marks what it cut.
    """
    t = _clean(entry.get("title"))
    if " to " in t:
        line, dest = t.split(" to ", 1)
        line, dest = line.strip(), _cut_dest(dest)
        out = (line + " " + arrow + " " + dest).strip() if line else dest
    else:
        out = t
    return out


def _row_title(entry, kind, max_chars, arrow):
    if kind == "plane":
        return _plane_row_title(entry, max_chars)
    return _train_row_title(entry, max_chars, arrow)


def _fix_arrows(text, arrow):
    """planeDetail() already writes routes as 'IAD → FRA'
    (interesting.js:639), so text arriving from the scorer has to be sanitised
    for the resolved face too, not just the arrows this file adds."""
    return _clean(text).replace("→", arrow)


def _sentence(text):
    """post-daily.py:459-462 carries the scar: .capitalize() lowercases the
    rest, turning 'an Airbus A380' into 'an airbus a380'."""
    t = _clean(text)
    return t[:1].upper() + t[1:]


def _where(entry, city_rows):
    """The hero's city, preferring the label the bot stamped on the entry."""
    if not entry:
        return ""
    lab = _clean(entry.get("cityLabel"))
    if lab:
        return lab
    cid = _clean(entry.get("city"))
    for r in (city_rows or []):
        if _clean(r.get("city")) == cid and cid:
            return _clean(r.get("label")) or cid
    return cid


def _hero_meta(entry, city_rows, arrow):
    bits = [_where(entry, city_rows), _clean(entry.get("sub")), _clean(entry.get("detail"))]
    return _fix_arrows(" · ".join([b for b in bits if b]), arrow)


def _empty_hero_line(city_rows, kind):
    """
    Says which kind of nothing this is. An empty sky and a feed that never
    answered look identical on a card that only knows how to say "none", and
    they are not the same claim.
    """
    erred = [r for r in (city_rows or []) if r.get("error")]
    if city_rows and len(erred) == len(city_rows):
        return "no feed answered today"
    return "nothing cleared the bar today"


# ---------------------------------------------------------------- agreement

def _hero_agrees(hero, city_rows, kind):
    """
    The hero and the table are two views of one frozen list, and a reader can
    check them against each other in a glance. If the hero says 96 and the top
    of its own column says 92 — because the table was built from a different
    snapshot, or the hero was re-scored after a later sighting — the card
    refutes itself and every number on it becomes unreliable.

    So this is checked rather than assumed, and a mismatch stops the drawing
    instead of being quietly papered over: a card that contradicts itself is
    worse than no card, and the caller can post the day's text without an image.
    Loud, not silent — it prints both numbers so the bug is actionable.
    """
    ranked = sorted([r for r in (city_rows or []) if r.get(kind)],
                    key=lambda r: _score(r.get(kind)), reverse=True)
    if hero is None:
        if ranked:
            log("! hero/table disagree: no %s hero was given, but the table has one "
                "scoring %d" % (kind, _score(ranked[0].get(kind))))
            return False
        return True
    if not ranked:
        log("! hero/table disagree: %s hero scores %d, but no city row carries a %s"
            % (kind, _score(hero), kind))
        return False
    top = _score(ranked[0].get(kind))
    if top != _score(hero):
        log("! hero/table disagree: %s hero scores %d, the table's best scores %d"
            % (kind, _score(hero), top))
        return False
    return True


def _is_hero(entry, hero):
    """Which cell in the table is the one the deck is talking about. Identity
    first, because the caller should be passing the same object; the id/score
    comparison is only for a caller that rebuilt the dict."""
    if entry is None or hero is None:
        return False
    if entry is hero:
        return True
    eid, hid = _clean(entry.get("id")), _clean(hero.get("id"))
    if eid and hid:
        return eid == hid
    return (_clean(entry.get("title")) == _clean(hero.get("title"))
            and _score(entry) == _score(hero))


# ---------------------------------------------------------------- geometry

def geometry(wide, n):
    """
    Every number the card is built from, derived in one place.

    THE TABLE IS BOTTOM-ANCHORED AND THE PHOTOGRAPH ABSORBS THE SLACK. The last
    row always ends on the same pixel, so the bottom half of the card is
    identical every day and the feed crop is predictable; fewer cities means
    more photograph, never a floating table.

    WHAT CHANGED FROM THE ONE-HERO BUDGET, AND WHAT IT COST
    Two labelled heroes instead of one merged hero is ~90px of vertical on the
    square card, and a three-column table is wider rows. Paid for by:
      - row pitch 30 instead of 32 (row text dropped 24 -> 21, so the leading is
        actually looser than it was), which returns 2px per city;
      - dropping the rank column. With two independent kinds in one table a
        single rank number asserts a merged ordering the card no longer makes
        anywhere else. Rows are still ordered by their better score, but an
        ordered list is a softer claim than a numbered one.
      - on the wide card, the two heroes sit SIDE BY SIDE and the table is one
        full-width column rather than two half-width ones. Two stacked heroes
        plus a table would have left 72px of photograph, which is not a
        photograph.
    At 11 cities the square card keeps 304px of photo (the one-hero version had
    366) and the wide card 176 (was 230).

    The three-column square table is also why the row shortener aims at 26
    characters rather than the 36 a single title column allowed: the measured
    title columns are 316px (square, sans-bold 21) and 413px (wide, 18).
    """
    n = max(1, int(n))
    if wide:
        g = {
            "W": 1200, "H": 675, "x0": 48, "x1": 1152,
            "pitch": 24, "row_h": 22, "last_bottom": 644,
            "rule_gap": 34, "deck_h": 172,
            "kick_dy": 16, "kick": 16,
            "hero_dy": 46, "hero_side_by_side": True, "hero_gap": 48,
            "row_title": 18, "row_city": 14, "row_score": 17, "row_head": 13,
            "city_x": 60, "city_w": 118,
            "a_x": 194, "a_w": 413, "a_score_r": 661,
            "b_x": 685, "b_w": 407, "b_score_r": 1152,
            "zebra_pad": 8, "zebra_r": 6,
            "credit": 14, "credit_dy": 28, "foot": 15, "foot_dy": 650,
            "chars": CHARS_WIDE,
            # meta_gutter 0: on the wide card the score sits ABOVE the meta line
            # (it ends at +60, the meta starts at +64), so the meta gets the
            # whole block. There is no score label here either — "BEST AIRCRAFT"
            # is already in the block and repeating it costs a line of type the
            # wide card does not have.
            "hero": {"label": 14, "label_dy": 0, "name": 34, "name_floor": 22,
                     "name_dy": 20, "meta": 16, "meta_dy": 64, "rw": 14, "rt": 16,
                     "reason_dy": 88, "reason_gap": 44, "score": 46, "score_dy": 14,
                     "slab": 0, "slab_dy": 0, "gutter": 120, "meta_gutter": 0,
                     "h": 108},
        }
    else:
        g = {
            "W": 1080, "H": 1080, "x0": 64, "x1": 1016,
            "pitch": 30, "row_h": 28, "last_bottom": 1014,
            "rule_gap": 42, "deck_h": 340,
            "kick_dy": 22, "kick": 21,
            "hero_dy": 56, "hero_side_by_side": False, "hero_gap": 16,
            "row_title": 19, "row_city": 18, "row_score": 22, "row_head": 16,
            "city_x": 76, "city_w": 148,
            "a_x": 240, "a_w": 332, "a_score_r": 620,
            "b_x": 644, "b_w": 324, "b_score_r": 1016,
            "zebra_pad": 8, "zebra_r": 8,
            "credit": 15, "credit_dy": 32, "foot": 19, "foot_dy": 1036,
            "chars": CHARS_SQUARE,
            # The name clears the 3-digit score (gutter 190). The meta line sits
            # lower, level with the score LABEL rather than the score, so it can
            # run 38px wider before it would touch "AIRCRAFT SCORE" at x=890.
            "hero": {"label": 17, "label_dy": 0, "name": 46, "name_floor": 30,
                     "name_dy": 24, "meta": 20, "meta_dy": 78, "rw": 19, "rt": 21,
                     "reason_dy": 104, "reason_gap": 56, "score": 60, "score_dy": 22,
                     "slab": 15, "slab_dy": 92, "gutter": 190, "meta_gutter": 152,
                     "h": 126},
        }
    g["n"] = n
    g["r0"] = g["last_bottom"] - g["row_h"] - g["pitch"] * (n - 1)
    g["rule_y"] = g["r0"] - g["rule_gap"]
    # The photo band and the deck share a top edge: with no photograph the deck
    # stays exactly where it is and the band above it is plain gradient, which
    # reads as a card with no picture rather than a card with a hole in it.
    g["deck_top"] = g["rule_y"] - g["deck_h"]
    g["photo_h"] = max(0, g["deck_top"])
    return g


# ---------------------------------------------------------------- the card

def draw_roundup(hero_plane, hero_train, city_rows, out_path, wide=False,
                 photo_bytes=None, photo_credit="", day_label=""):
    """Draws the round-up card. Returns out_path, or None (see module docstring)."""
    try:
        from PIL import Image, ImageDraw, ImageFont
    except ImportError:
        log("! Pillow is not installed — no round-up card will be drawn.")
        return None

    body_f = find_font(bold=True)
    mono_f = find_font(mono=True)
    if not body_f or not mono_f:
        log("! No usable font found — no round-up card will be drawn.")
        return None

    rows = list(city_rows or [])
    if not rows:
        log("  (round-up card: no city rows were passed — the table will be empty)")
    if not (_hero_agrees(hero_plane, rows, "plane") and _hero_agrees(hero_train, rows, "train")):
        log("! Not drawing the round-up: the hero deck and the league table do not agree.")
        return None

    # Ordered by whichever of the city's two entries scored higher. Ties keep
    # the caller's order — Python's sorted is stable and does not reverse ties.
    rows.sort(key=lambda r: max(_score(r.get("plane")), _score(r.get("train"))), reverse=True)

    g = geometry(wide, len(rows))
    W, H = g["W"], g["H"]
    x0, x1 = g["x0"], g["x1"]
    hero_g = g["hero"]

    img = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(img)

    # background: the boards' own gradient, top-left navy to bottom-right violet
    for y in range(H):
        t = y / max(1, H - 1)
        d.line([(0, y), (W, y)],
               fill=(int(10 + 10 * t), int(19 - 6 * t), int(48 - 12 * t)))
    _brand_rule(d, W)

    # ---- BAND B: the photograph -----------------------------------------
    photo_h = 0
    if photo_bytes:
        try:
            src = Image.open(io.BytesIO(photo_bytes)).convert("RGB")
            photo_h = g["photo_h"]
            s = max(W / src.width, photo_h / src.height)
            src = src.resize((max(1, int(src.width * s)), max(1, int(src.height * s))),
                             Image.LANCZOS)
            # planespotters' public API tops out at 497px wide, so filling a
            # 1080px card means roughly a 2.2x upscale. A light unsharp mask
            # puts back the edge definition Lanczos softens.
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
                base = Image.new("RGB", (W, 1), GROUND)
                img.paste(Image.blend(band, base, a), (0, yy))
            d = ImageDraw.Draw(img)
            if photo_credit:
                f_c = ImageFont.truetype(mono_f, g["credit"])
                cw = d.textlength(photo_credit, font=f_c)
                d.text((x1 - cw, photo_h - g["credit_dy"]), photo_credit, font=f_c, fill=CREDIT)
            _brand_rule(d, W)          # the rule sits over the photo, not under it
        except Exception as e:                                      # noqa: BLE001
            log("  (round-up photo could not be composited: %s)" % e)
            photo_h = 0

    # Arrow availability is a property of the resolved face, so it is measured
    # once here and every string that could carry one is routed through it.
    f_probe_sans = ImageFont.truetype(body_f, g["row_title"])
    f_probe_mono = ImageFont.truetype(mono_f, hero_g["meta"])
    arrow_sans = "→" if has_arrow(d, f_probe_sans) else "to"
    arrow_mono = "→" if has_arrow(d, f_probe_mono) else "to"

    # ---- BAND C: the two heroes -----------------------------------------
    deck_top = g["deck_top"]
    kicker = "BEST OF THE DAY"
    if _clean(day_label):
        kicker += " · " + _clean(day_label).upper()
    kicker += " · %d %s" % (len(rows), "CITY" if len(rows) == 1 else "CITIES")
    f_kick = ImageFont.truetype(mono_f, g["kick"])
    d.text((x0, deck_top + g["kick_dy"]), clip(d, kicker, f_kick, x1 - x0),
           font=f_kick, fill=MUTED)

    hero_top = deck_top + g["hero_dy"]
    if g["hero_side_by_side"]:
        block_w = (x1 - x0 - g["hero_gap"]) // 2
        blocks = [(hero_plane, "plane", x0, block_w, hero_top),
                  (hero_train, "train", x0 + block_w + g["hero_gap"], block_w, hero_top)]
    else:
        second = hero_top + hero_g["h"] + g["hero_gap"]
        blocks = [(hero_plane, "plane", x0, x1 - x0, hero_top),
                  (hero_train, "train", x0, x1 - x0, second)]
        # a hairline between the two decks, so BEST TRAIN is read as its own
        # claim rather than as more of the aircraft's
        d.line([(x0, second - 10), (x1, second - 10)], fill=RULE, width=1)

    for entry, kind, bx, bw, by in blocks:
        _hero_block(d, img, entry, kind, bx, bw, by, rows, hero_g, body_f, mono_f,
                    arrow_mono, ImageFont)

    # ---- BAND D: the league table ---------------------------------------
    d.line([(x0, g["rule_y"]), (x1, g["rule_y"])], fill=RULE, width=2)
    f_head = ImageFont.truetype(mono_f, g["row_head"])
    head_y = g["r0"] - g["rule_gap"] + 12
    d.text((g["city_x"], head_y), "CITY", font=f_head, fill=DIM)
    d.text((g["a_x"], head_y), "BEST AIRCRAFT", font=f_head, fill=DIM)
    d.text((g["b_x"], head_y), "BEST TRAIN", font=f_head, fill=DIM)

    f_city = ImageFont.truetype(mono_f, g["row_city"])
    f_title = ImageFont.truetype(body_f, g["row_title"])
    f_rscore = ImageFont.truetype(mono_f, g["row_score"])
    # One shared baseline for all three column faces; see top_for_baseline().
    for i, r in enumerate(rows):
        t = g["r0"] + g["pitch"] * i
        base = t + g["row_h"] - (7 if not wide else 6)
        if i % 2 == 0:
            d.rounded_rectangle([x0 - g["zebra_pad"], t - 2, x1 + g["zebra_pad"], t + g["row_h"]],
                                radius=g["zebra_r"], fill=ZEBRA)
        label = _clean(r.get("label")) or _clean(r.get("city")) or "—"
        d.text((g["city_x"], top_for_baseline(f_city, base)),
               clip(d, label.upper(), f_city, g["city_w"]), font=f_city, fill=MUTED)
        for kind, kx, kw, ksr, hero in (
                ("plane", g["a_x"], g["a_w"], g["a_score_r"], hero_plane),
                ("train", g["b_x"], g["b_w"], g["b_score_r"], hero_train)):
            _row_cell(d, r, kind, kx, kw, ksr, base, hero, f_title, f_rscore,
                      g["chars"], arrow_sans)

    # ---- BAND E: the footer ---------------------------------------------
    # The right-hand figure is the honest coverage note: how many of the cities
    # on this card actually produced something today. It is derived from the
    # rows, so it cannot drift from what the table shows.
    reporting = len([r for r in rows if r.get("plane") or r.get("train")])
    f_foot = ImageFont.truetype(mono_f, g["foot"])
    d.text((x0, g["foot_dy"]), SITE.upper(), font=f_foot, fill=DIM)
    note = "%d OF %d CITIES REPORTING" % (reporting, len(rows))
    d.text((x1 - d.textlength(note, font=f_foot), g["foot_dy"]), note, font=f_foot, fill=DIM)

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    img.save(out_path, "PNG", optimize=True)
    log("  round-up card written: %s (%dx%d, %d cities, %d reporting)"
        % (out_path, W, H, len(rows), reporting))
    return out_path


def _brand_rule(d, W):
    """The 7px brand rule, #FF3D77 -> #4ea1ff -> #00E0C6, exactly as
    post-daily.py:265-273 draws it."""
    for x in range(W):
        t = x / max(1, W - 1)
        if t < 0.5:
            u = t / 0.5
            col = (int(255 - 176 * u), int(61 + 100 * u), int(119 + 136 * u))
        else:
            u = (t - 0.5) / 0.5
            col = (int(79 - 79 * u), int(161 + 63 * u), int(255 - 57 * u))
        d.line([(x, 0), (x, 7)], fill=col)


def _hero_block(d, img, entry, kind, bx, bw, by, rows, hg, body_f, mono_f, arrow, ImageFont):
    """One labelled hero: what it is, what it is called, where and what it was
    doing, the single reason that earned the most, and the score."""
    right = bx + bw
    f_lab = ImageFont.truetype(mono_f, hg["label"])
    d.text((bx, by + hg["label_dy"]),
           "BEST AIRCRAFT" if kind == "plane" else "BEST TRAIN", font=f_lab, fill=MUTED)

    if not entry:
        # Nothing to boast about, said plainly and in the quiet colour. The
        # score column gets a middot, never a zero: zero is a score, and this is
        # the absence of one.
        f_none = ImageFont.truetype(body_f, hg["name_floor"])
        d.text((bx, by + hg["name_dy"]), _empty_hero_line(rows, kind), font=f_none, fill=DIM)
        f_sc = ImageFont.truetype(mono_f, hg["score"])
        sw = d.textlength("·", font=f_sc)
        d.text((right - sw, by + hg["score_dy"]), "·", font=f_sc, fill=DIM)
        return

    score = str(_score(entry))
    f_sc = ImageFont.truetype(mono_f, hg["score"])
    sw = d.textlength(score, font=f_sc)
    d.text((right - sw, by + hg["score_dy"]), score, font=f_sc, fill=GOLD)
    if hg["slab"]:
        f_slab = ImageFont.truetype(mono_f, hg["slab"])
        slab = "AIRCRAFT SCORE" if kind == "plane" else "RAIL SCORE"
        d.text((right - d.textlength(slab, font=f_slab), by + hg["slab_dy"]),
               slab, font=f_slab, fill=MUTED)

    name_w = bw - hg["gutter"]
    name, f_name = fit_line(d, _fix_arrows(entry.get("title"), arrow), body_f,
                            hg["name"], hg["name_floor"], name_w, ImageFont)
    d.text((bx, by + hg["name_dy"]), name, font=f_name, fill=INK)

    f_meta = ImageFont.truetype(mono_f, hg["meta"])
    meta = _hero_meta(entry, rows, arrow)
    d.text((bx, by + hg["meta_dy"]), clip(d, meta, f_meta, bw - hg["meta_gutter"]),
           font=f_meta, fill=BLUE)

    # ONE inline reason, not the stacked chips of the single-winner card: a chip
    # costs 72px of height and there are two heroes now. The honesty mechanism
    # survives intact — the score is a sum of stated reasons and the card still
    # says which one carried it.
    reasons = entry.get("reasons") or []
    if reasons:
        r = reasons[0]
        f_w = ImageFont.truetype(mono_f, hg["rw"])
        f_t = ImageFont.truetype(body_f, hg["rt"])
        d.text((bx, by + hg["reason_dy"] + 2), "+%d" % _weight(r), font=f_w, fill=GOLD)
        txt = _sentence(_fix_arrows(r.get("t"), arrow))
        d.text((bx + hg["reason_gap"], by + hg["reason_dy"]),
               clip(d, txt, f_t, bw - hg["reason_gap"]), font=f_t, fill=INK)


def _weight(reason):
    v = reason.get("w")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return 0
    return int(v)


def _row_cell(d, row, kind, x, w, score_r, base, hero, f_title, f_score, chars, arrow):
    """
    One city's best of one kind. THE ROW IS NEVER OMITTED and the three
    outcomes are said differently, because they are different claims:
      an entry           the thing itself, with its score
      no entry, error    "feed unavailable", score "·" — we could not look
      no entry, no error "nothing scored", score "·" — we looked and nothing
                         cleared the bar
    A card that omits Boston asserts that nothing happened in Boston.
    """
    entry = row.get(kind)
    if entry:
        fill = INK
        title = _row_title(entry, kind, chars, arrow)
        d.text((x, top_for_baseline(f_title, base)), clip(d, title, f_title, w),
               font=f_title, fill=fill)
        score = str(_score(entry))
        d.text((score_r - d.textlength(score, font=f_score), top_for_baseline(f_score, base)),
               score, font=f_score, fill=GOLD if _is_hero(entry, hero) else BLUE)
        return

    err = _clean(row.get("error"))
    said = err if err else "nothing scored"
    d.text((x, top_for_baseline(f_title, base)), clip(d, said, f_title, w),
           font=f_title, fill=DIM)
    d.text((score_r - d.textlength("·", font=f_score), top_for_baseline(f_score, base)),
           "·", font=f_score, fill=DIM)


# ---------------------------------------------------------------- sample run
# Not a test framework, just enough realistic data to render both sizes without
# a network: eleven cities in the order interesting.js:98-110 lists them, one
# feed failure, one city with a train and no aircraft, and one European city
# with no operator string (adsb.fi carries no ownOp for EU registrations).

def _sample():
    def plane(title, sub, detail, score, w, why, city, label, hexid=""):
        return {"id": "plane:" + (hexid or sub), "kind": "plane", "title": title,
                "sub": sub, "detail": detail, "score": score, "hex": hexid,
                "city": city, "cityLabel": label, "reasons": [{"w": w, "t": why}]}

    def train(title, sub, detail, score, w, why, city, label):
        return {"id": "row:" + title, "kind": "train", "title": title, "sub": sub,
                "detail": detail, "score": score, "city": city, "cityLabel": label,
                "reasons": [{"w": w, "t": why}]}

    p_dc = plane("Antonov An-124 Ruslan", "Antonov Airlines · ADB2308",
                 "GYD → IAD · 8,200 ft · 214 kt", 96, 58,
                 "the first An-124 in 30 days of watching", "dc", "Washington DC", "508035")
    # Amtrak entries carry the destination in `sub`, not in the title
    # (scoreAmtrak, interesting.js:679-683) — the board-row entries below are the
    # ones shaped "<line> to <dest>". The shortener has to handle both.
    t_nyc = train("Empire Service 234", "to Niagara Falls",
                  "31 mi away · 79 mph · +112 min", 74, 30,
                  "running 112 minutes late", "nyc", "New York")

    rows = [
        {"city": "dc", "label": "Washington DC", "error": None, "plane": p_dc,
         "train": train("Red to Shady Grove, MD", "Metrorail", "every 8 min", 41, 22,
                        "only the 2nd day with Red on Metrorail", "dc", "Washington DC")},
        {"city": "philly", "label": "Philadelphia", "error": None,
         "plane": plane("Boeing 767-300F", "FedEx Express · FDX1234",
                        "MEM → PHL · 12,400 ft", 52, 26,
                        "operated by FedEx Express, not an airline", "philly", "Philadelphia", "a1b2c3"),
         "train": train("Keystone 645", "to Harrisburg", "18 mi away · 104 mph", 38, 14,
                        "doing 104 mph", "philly", "Philadelphia")},
        {"city": "nj", "label": "New Jersey", "error": None,
         "plane": plane("Boeing 787-9 Dreamliner", "United Airlines · UAL149",
                        "EWR → SIN · 34,000 ft", 61, 33,
                        "a Boeing 787-9 Dreamliner, which is rare here", "nj", "New Jersey", "a9f001"),
         "train": train("NEC to Trenton Transit Center", "NJT Rail", "on time", 22, 12,
                        "only the 3rd day with NEC on NJT Rail", "nj", "New Jersey")},
        {"city": "nyc", "label": "New York", "error": None,
         "plane": plane("Airbus A380-861", "Emirates · UAE201",
                        "DXB → JFK · 9,100 ft · 188 kt", 88, 46,
                        "an Airbus A380-861, the largest airliner flying", "nyc", "New York", "8961ab"),
         "train": t_nyc},
        {"city": "boston", "label": "Boston", "error": "feed unavailable",
         "plane": None, "train": None},
        {"city": "amsterdam", "label": "Amsterdam", "error": None,
         "plane": plane("Boeing 747-8F", "Cathay Cargo · CPA0043",
                        "HKG → AMS · 4,300 ft", 67, 34,
                        "the first 747-8F in 30 days of watching", "amsterdam", "Amsterdam", "780012"),
         "train": train("IC to Berlin Hauptbahnhof", "International", "platform 11a", 44, 20,
                        "only the 2nd day with service to Berlin Hauptbahnhof",
                        "amsterdam", "Amsterdam")},
        {"city": "la", "label": "Los Angeles", "error": None,
         "plane": plane("Bombardier Regional Jet CRJ-700", "SkyWest · SKW3391",
                        "LAX → SFO · 6,700 ft", 34, 18,
                        "a CRJ-700, which is rare here", "la", "Los Angeles", "a44c1d"),
         "train": train("Ventura County to East Ventura", "Metrolink", "+38 min", 47, 30,
                        "38 minutes late", "la", "Los Angeles")},
        {"city": "sf", "label": "San Francisco", "error": None,
         "plane": plane("Gulfstream G650ER", "· N650GD", "SFO → HND · 41,000 ft",
                        43, 21, "a Gulfstream G650ER, which is rare here", "sf",
                        "San Francisco", "a7c331"),
         "train": train("Powell-Hyde to Fisherman's Wharf", "Cable cars", "every 9 min", 29, 15,
                        "only the 2nd day with Powell-Hyde on Cable cars", "sf", "San Francisco")},
        # Zurich: a real European gap, not a failure — adsb.fi carries no ownOp
        # for EU registrations, so the row falls back to the callsign.
        {"city": "zurich", "label": "Zurich", "error": None,
         "plane": plane("Airbus A340-313", "· SWR23", "ZRH → JFK · 7,800 ft",
                        39, 19, "an Airbus A340-313, which is rare here", "zurich", "Zurich", "4b1a90"),
         "train": train("S12 to Winterthur, Seen", "S-Bahn", "+4 min", 26, 13,
                        "only the 3rd day with S12 on S-Bahn", "zurich", "Zurich")},
        # Cologne: the thinnest sky of the eleven (3 aircraft, flagged stale on
        # the day this was measured) — a train and nothing airborne worth saying.
        {"city": "cologne", "label": "Cologne", "error": None, "plane": None,
         "train": train("RE1 to Aachen Hauptbahnhof", "Regional", "cancelled", 51, 34,
                        "cancelled", "cologne", "Cologne")},
        {"city": "stuttgart", "label": "Stuttgart", "error": None,
         "plane": plane("Embraer ERJ-195", "· DLH8KP", "STR → FRA · 5,200 ft",
                        24, 12, "an Embraer ERJ-195, which is rare here", "stuttgart",
                        "Stuttgart", "3c6511"),
         "train": train("U6 to Gerlingen", "U-Bahn", "every 10 min", 19, 10,
                        "only the 3rd day with U6 on U-Bahn", "stuttgart", "Stuttgart")},
    ]
    return p_dc, t_nyc, rows


if __name__ == "__main__":
    import sys

    outdir = (sys.argv[1] if len(sys.argv) > 1 else "/tmp").rstrip("/")
    hp, ht, sample_rows = _sample()
    draw_roundup(hp, ht, sample_rows, outdir + "/roundup-sample.png", wide=False,
                 photo_credit="photo © Sam Chui · planespotters.net",
                 day_label="Sat 15 Aug")
    draw_roundup(hp, ht, sample_rows, outdir + "/roundup-sample-wide.png", wide=True,
                 photo_credit="photo © Sam Chui · planespotters.net",
                 day_label="Sat 15 Aug")
