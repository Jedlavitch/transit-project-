#!/usr/bin/env python3
"""
make-brand.py — every logo file, generated from one copy of the geometry.

WHY A GENERATOR AND NOT EIGHT HAND-DRAWN FILES
  The brand guide's rule is "never redraw these by eye — scale the supplied
  SVG". Eight files maintained by hand is eight chances to drift: a stroke
  width that is 11 in one and 10.5 in another, a dot that moved two units. The
  path data below appears exactly once. Every variant, every size, and every
  PNG comes out of it, so they cannot disagree.

WHAT IT WRITES (brand/)
  icon-dark.svg              primary — ink tile, white-ringed dots
  icon-light.svg             light surfaces — paper tile, ink-ringed dots
  mark-on-dark.svg           transparent, for placing on a dark UI
  mark-on-light.svg          transparent, for placing on a light UI
  favicon.svg                16px form: three lines, NO dots (see below)
  instagram-profile.svg      circle-safe, two dots, pink/blue glow
  ...and PNG exports at the sizes the guide lists.

TWO RULES FROM THE GUIDE THAT ARE ENCODED HERE, NOT LEFT TO THE CALLER
  1. Minimum size is 40px, "below that the station dots close up and the mark
     turns to mush. If you need something smaller — a favicon at 16px — drop
     the dots entirely." So favicon.svg is a genuinely different drawing, not
     the same file scaled down, and it is the only one allowed under 40px.
  2. Dot centres carry the background colour, so the ring reads as a ring
     rather than a filled blob. Each variant passes its own dot fill; nothing
     inherits a default that might be wrong for the surface it lands on.

RUN
  python3 brand/make-brand.py           # regenerates everything
"""

import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

# ---- the palette, verbatim from the guide -------------------------------
PINK  = "#FF3D77"
TEAL  = "#00E0C6"
BLUE  = "#2F7BFF"
INK   = "#12101A"
PAPER = "#FFFCF5"

# ---- the mark, verbatim from the guide ----------------------------------
# viewBox "9 8 84 76": 84 wide, 76 tall, on the 100-unit construction grid.
MARK_VB = (9, 8, 84, 76)
ROUTES = [
    ("M18,26 H50 L74,50",      PINK),
    ("M26,74 L50,50 L50,20",   TEAL),
    ("M18,50 H38 L58,70 H80",  BLUE),
]
DOTS = [(50, 20), (74, 50), (80, 70)]
STROKE_W = 11          # line weight on the 100-unit grid
DOT_R = 6.5
DOT_STROKE_W = 4


def routes_svg(indent="  "):
    out = [f'{indent}<g fill="none" stroke-width="{STROKE_W}" stroke-linecap="round" stroke-linejoin="round">']
    for d, col in ROUTES:
        out.append(f'{indent}  <path d="{d}" stroke="{col}"/>')
    out.append(f"{indent}</g>")
    return "\n".join(out)


def dots_svg(fill, stroke, dots=None, indent="  "):
    dots = DOTS if dots is None else dots
    out = [f'{indent}<g fill="{fill}" stroke="{stroke}" stroke-width="{DOT_STROKE_W}">']
    for cx, cy in dots:
        out.append(f'{indent}  <circle cx="{cx}" cy="{cy}" r="{DOT_R}"/>')
    out.append(f"{indent}</g>")
    return "\n".join(out)


def placed(scale_pct, canvas=100):
    """Transform that centres the mark at scale_pct of a square canvas.

    The guide's own tiles set the mark to 64% of the square, and clear space is
    'the width of one station dot on all four sides' — at 64% the margin is
    comfortably more than 13 units, so this satisfies both."""
    _, _, mw, mh = MARK_VB
    s = (canvas * scale_pct / 100.0) / mw
    tx = (canvas - mw * s) / 2.0
    ty = (canvas - mh * s) / 2.0
    return f"translate({tx:.4f},{ty:.4f}) scale({s:.6f}) translate({-MARK_VB[0]},{-MARK_VB[1]})"


def tile(bg, dot_fill, dot_stroke, radius_pct=22, scale_pct=64, title="Transit Project"):
    """A full app-icon tile: rounded square, mark centred inside it."""
    r = radius_pct
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024" role="img" aria-label="{title}">
  <title>{title}</title>
  <rect width="100" height="100" rx="{r}" ry="{r}" fill="{bg}"/>
  <g transform="{placed(scale_pct)}">
{routes_svg("    ")}
{dots_svg(dot_fill, dot_stroke, indent="    ")}
  </g>
</svg>
"""


def bare(dot_fill, dot_stroke, title="Transit Project"):
    """The mark alone on a transparent ground, for placing in a UI."""
    x, y, w, h = MARK_VB
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {w} {h}" role="img" aria-label="{title}">
  <title>{title}</title>
{routes_svg("  ")}
{dots_svg(dot_fill, dot_stroke, indent="  ")}
</svg>
"""


def favicon():
    """16px form. Per the guide: three lines, no dots.

    The dots are what fails first at small sizes, and a favicon is displayed at
    16px whatever we wish. Dropping them is the guide's own instruction, and it
    leaves three strokes that still read as crossing routes."""
    x, y, w, h = MARK_VB
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {w} {h}" role="img" aria-label="Transit Project">
  <title>Transit Project</title>
  <!-- No station dots: below 40px they close up. The guide says to drop them
       at favicon size rather than ship a mark that turns to mush. -->
{routes_svg("  ")}
</svg>
"""


def instagram():
    """Circle-safe profile picture.

    Three things the guide asks for and this does: the mark is pulled in
    tighter so the circular crop cannot clip it, it carries TWO dots instead of
    three because the third disappears at story size, and it sits on ink with a
    pink/blue glow so it separates from a white feed. The no-glow rule elsewhere
    is about the mark itself; this is the one file the guide exempts."""
    two_dots = [DOTS[0], DOTS[1]]
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024" role="img" aria-label="Transit Project">
  <title>Transit Project</title>
  <defs>
    <radialGradient id="glowA" cx="28%" cy="26%" r="62%">
      <stop offset="0%" stop-color="{PINK}" stop-opacity=".55"/>
      <stop offset="100%" stop-color="{PINK}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowB" cx="76%" cy="78%" r="62%">
      <stop offset="0%" stop-color="{BLUE}" stop-opacity=".55"/>
      <stop offset="100%" stop-color="{BLUE}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="100" height="100" fill="{INK}"/>
  <rect width="100" height="100" fill="url(#glowA)"/>
  <rect width="100" height="100" fill="url(#glowB)"/>
  <g transform="{placed(52)}">
{routes_svg("    ")}
{dots_svg(INK, "#FFFFFF", dots=two_dots, indent="    ")}
  </g>
</svg>
"""


FILES = {
    "icon-dark.svg":          tile(INK,   INK,   "#FFFFFF"),
    "icon-light.svg":         tile(PAPER, PAPER, INK),
    "mark-on-dark.svg":       bare(INK,   "#FFFFFF"),
    "mark-on-light.svg":      bare(PAPER, INK),
    "favicon.svg":            favicon(),
    # Same drawing as the favicon, under a name that reads honestly in markup.
    # The city boards scale themselves down (#app carries zoom:0.8), so a 40px
    # mark in a board header paints at 32 and the dots start closing up. This is
    # the guide's own answer to being under the floor: drop the dots.
    "mark-small.svg":         favicon(),
    "instagram-profile.svg":  instagram(),
}

# ---- the walkthrough's cast ------------------------------------------------
# mascot.js expects three files by name and falls back to an inline placeholder
# when they are missing, which is where the tour has been living. These are
# those three.
#
# CONSTRAINTS THAT ACTUALLY DECIDED THE DRAWINGS
#   * viewBox 0 0 64 76, rendered at 58 wide — matching the placeholder, so any
#     of them can stand in for another without the card reflowing.
#   * They sit on the tour card, which is PAPER. So every one of them is
#     mostly INK: a paper-coloured animal on a paper card is a rumour. Paper is
#     used only for the parts that need to read against the body — belly,
#     muzzle, eyes.
#   * Told apart by SILHOUETTE, not colour, because at 58px on a bright screen
#     the outline is all anyone gets: the penguin is a round upright, the camel
#     has two humps, the llama has tall ears and no humps.
#   * Each wears a scarf drawn as a route line with a station dot on it — the
#     mark's own vocabulary, which is what stops them being three cartoons that
#     happen to sit next to a logo. One route colour each, so the cast spans the
#     palette the way the mark does. The llama's is the teal one and its scarf
#     lies across an ink neck, because the guide bars teal from pale ground.
#   * class="tb-eye" on every pupil: mascot.js animates blinks through it.

def _ground():
    return f'  <ellipse cx="32" cy="70" rx="17" ry="4.6" fill="{INK}" opacity=".10"/>'


def _eye(cx, cy, r=2.3):
    return (f'  <circle cx="{cx}" cy="{cy}" r="{r + 2.3}" fill="{PAPER}"/>\n'
            f'  <circle class="tb-eye" cx="{cx}" cy="{cy}" r="{r}" fill="{INK}"/>')


def _leg(x, top, bottom, w=4.6):
    return (f'  <rect x="{x}" y="{top}" width="{w}" height="{bottom - top}" '
            f'rx="{w / 2}" fill="{INK}"/>')


def _wrap(name, inner):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" class="tb-mascot" viewBox="0 0 64 76" role="img" aria-label="{name}">
  <title>{name}</title>
{inner}
</svg>
"""


def mascot_penguin():
    """Round upright. Same drawing as mascot.js's inline fallback, so the first
    of the cast looks identical whether the file loaded or not."""
    inner = "\n".join([
        _ground(),
        f'  <path d="M20 62 q-6 5 -1 7 h10 q3 -3 -2 -7 z" fill="{PINK}"/>',
        f'  <path d="M44 62 q6 5 1 7 h-10 q-3 -3 2 -7 z" fill="{PINK}"/>',
        f'  <path d="M32 6 c14 0 21 12 21 27 v14 c0 11 -9 19 -21 19 s-21 -8 -21 -19 v-14 c0 -15 7 -27 21 -27 z" fill="{INK}"/>',
        f'  <path d="M32 22 c8 0 13 8 13 19 v6 c0 8 -5 14 -13 14 s-13 -6 -13 -14 v-6 c0 -11 5 -19 13 -19 z" fill="{PAPER}"/>',
        f'  <path d="M11 34 c-4 6 -4 16 -1 22 c2 4 5 3 5 -1 v-20 c0 -3 -3 -4 -4 -1 z" fill="{INK}"/>',
        f'  <path d="M53 34 c4 6 4 16 1 22 c-2 4 -5 3 -5 -1 v-20 c0 -3 3 -4 4 -1 z" fill="{INK}"/>',
        _eye(26, 25), _eye(40, 25),
        f'  <path d="M32 30 l5 5 l-5 4 l-5 -4 z" fill="{PINK}"/>',
        f'  <path d="M17 44 h30" stroke="{BLUE}" stroke-width="6" stroke-linecap="round" fill="none"/>',
        f'  <path d="M45 44 l7 9" stroke="{BLUE}" stroke-width="5" stroke-linecap="round" fill="none"/>',
        f'  <circle cx="24" cy="44" r="2.4" fill="{PAPER}"/>',
        f'  <circle cx="38" cy="44" r="2.4" fill="{PAPER}"/>',
    ])
    return _wrap("Penguin", inner)


def mascot_camel():
    """Two humps, and they have to READ as two.

    First attempt put r=8.5 and r=9.5 humps 13 apart on a tall body: they
    overlapped into one mound and the camel came out as a second llama. The
    fix is geometric — centres 14 apart with radii summing to 14, so the
    circles meet exactly and leave a notch — plus a flatter body, so the humps
    stand proud of the back instead of being swallowed by it."""
    inner = "\n".join([
        _ground(),
        _leg(17, 53, 68), _leg(24, 55, 68), _leg(34, 53, 68), _leg(41, 55, 68),
        f'  <ellipse cx="28" cy="51" rx="16" ry="8.5" fill="{INK}"/>',
        f'  <circle cx="21" cy="41" r="6.5" fill="{INK}"/>',        # rear hump
        f'  <circle cx="35" cy="40" r="7.5" fill="{INK}"/>',        # front hump
        f'  <path d="M12 48 q-4 4 -2 8" stroke="{INK}" stroke-width="3" stroke-linecap="round" fill="none"/>',
        # Neck carried forward, the way a camel holds it — the llama's goes straight up.
        f'  <path d="M42 47 Q47 34 50 22" stroke="{INK}" stroke-width="8.5" stroke-linecap="round" fill="none"/>',
        f'  <ellipse cx="51" cy="19" rx="6.6" ry="5.2" fill="{INK}"/>',
        f'  <path d="M46 15 l0 -4 l4 3 z" fill="{INK}"/>',          # short ear: camels have little ones
        f'  <ellipse cx="56" cy="21" rx="4" ry="3.1" fill="{PAPER}"/>',
        _eye(50, 17, 1.8),
        f'  <ellipse cx="29" cy="55" rx="8" ry="4" fill="{PAPER}" opacity=".9"/>',
        f'  <path d="M44 32 l8 -2" stroke="{PINK}" stroke-width="5.4" stroke-linecap="round" fill="none"/>',
        f'  <circle cx="48" cy="31" r="2.2" fill="{PAPER}"/>',
    ])
    return _wrap("Camel", inner)


def mascot_llama():
    """No humps, tall ears, neck straight up — the opposite tells to the camel."""
    inner = "\n".join([
        _ground(),
        _leg(18, 54, 68), _leg(25, 56, 68), _leg(34, 54, 68), _leg(41, 56, 68),
        f'  <ellipse cx="29" cy="49" rx="15.5" ry="10" fill="{INK}"/>',
        f'  <path d="M14 45 q-4 -3 -3 -7" stroke="{INK}" stroke-width="3" stroke-linecap="round" fill="none"/>',
        f'  <path d="M39 46 L45 20" stroke="{INK}" stroke-width="9.5" stroke-linecap="round" fill="none"/>',
        f'  <ellipse cx="46" cy="17" rx="6.2" ry="5.2" fill="{INK}"/>',
        # The tell. Joined to the skull rather than floating: the first version
        # had a separate pink chip hanging in the air above the ear.
        f'  <path d="M41 14 l0.5 -10 l4.5 9 z" fill="{INK}"/>',
        f'  <path d="M49 14 l2.5 -9.5 l3 9 z" fill="{INK}"/>',
        f'  <ellipse cx="51" cy="20" rx="3.6" ry="2.9" fill="{PAPER}"/>',
        _eye(45, 15, 1.8),
        f'  <ellipse cx="30" cy="54" rx="8" ry="4.2" fill="{PAPER}" opacity=".9"/>',
        f'  <path d="M38 32 l7 -2" stroke="{TEAL}" stroke-width="5.4" stroke-linecap="round" fill="none"/>',
        f'  <circle cx="42" cy="31" r="2.2" fill="{PAPER}"/>',
    ])
    return _wrap("Llama", inner)


MASCOTS = {
    "mascot-penguin.svg": mascot_penguin(),
    "mascot-camel.svg":   mascot_camel(),
    "mascot-llama.svg":   mascot_llama(),
}

# PNG exports the guide lists. 28px is deliberately absent: the guide shows it
# as "too small", so there is no file that invites anyone to use one.
PNG_SIZES = {
    "icon-dark.svg":         [1024, 180, 60],
    "icon-light.svg":        [1024, 180, 60],
    "instagram-profile.svg": [1024],
}


def write_svgs():
    for name, body in {**FILES, **MASCOTS}.items():
        with open(os.path.join(HERE, name), "w", encoding="utf-8") as fh:
            fh.write(body)
        print(f"  {name}")


def write_pngs():
    """Rasterise with qlmanage, the only converter on this machine.

    It is a Quick Look thumbnailer, not a real renderer: it writes
    <name>.svg.png, it will silently produce nothing on some inputs, and it
    fits the image INSIDE the requested box rather than filling it. So every
    output is checked for existence and non-trivial size rather than assumed."""
    made, failed = [], []
    for src, sizes in PNG_SIZES.items():
        for px in sizes:
            stem = src[:-4]
            out = os.path.join(HERE, f"{stem}-{px}.png")
            tmpdir = os.path.join(HERE, ".ql")
            os.makedirs(tmpdir, exist_ok=True)
            subprocess.run(
                ["qlmanage", "-t", "-s", str(px), "-o", tmpdir, os.path.join(HERE, src)],
                capture_output=True, text=True,
            )
            produced = os.path.join(tmpdir, src + ".png")
            if os.path.exists(produced) and os.path.getsize(produced) > 500:
                os.replace(produced, out)
                made.append(f"{os.path.basename(out)} ({os.path.getsize(out)//1024} KB)")
            else:
                failed.append(f"{stem}-{px}.png")
    for m in made:
        print(f"  {m}")
    if failed:
        print("  NOT PRODUCED: " + ", ".join(failed), file=sys.stderr)
    tmpdir = os.path.join(HERE, ".ql")
    if os.path.isdir(tmpdir):
        for f in os.listdir(tmpdir):
            os.unlink(os.path.join(tmpdir, f))
        os.rmdir(tmpdir)
    return failed


if __name__ == "__main__":
    print("SVG masters:")
    write_svgs()
    print("PNG exports:")
    bad = write_pngs()
    sys.exit(1 if bad else 0)
