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

# PNG exports the guide lists. 28px is deliberately absent: the guide shows it
# as "too small", so there is no file that invites anyone to use one.
PNG_SIZES = {
    "icon-dark.svg":         [1024, 180, 60],
    "icon-light.svg":        [1024, 180, 60],
    "instagram-profile.svg": [1024],
}


def write_svgs():
    for name, body in FILES.items():
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
