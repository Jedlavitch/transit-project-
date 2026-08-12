#!/bin/bash
# shoot-shots.sh — marketing captures of the boards, straight from the running site.
#
# Headless Chrome with a THROWAWAY profile, which is the point: no saved licence,
# no saved settings, so the boards come up exactly as a stranger first sees them
# and the demo chip never appears (gate.js is dormant with no licence worker
# configured). Style and city come from the URL so nothing has to be clicked.
#
# Needs the local server running: preview_start "transit-intl" (port 4176).
#
#   ./shoot-shots.sh            # every shot
#   ./shoot-shots.sh septa      # just the ones matching "septa"
set -u

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE="${BASE:-http://localhost:4176}"
OUT="shots"
FILTER="${1:-}"
# Long enough for the live feeds to answer and the flaps to finish turning.
# Too short and you photograph a board mid-flip, which reads as broken.
BUDGET="${BUDGET:-22000}"

mkdir -p "$OUT"

shoot() {  # name  width  height  url
  local name="$1" w="$2" h="$3" url="$4"
  if [ -n "$FILTER" ] && [[ "$name" != *"$FILTER"* ]]; then return; fi
  local profile; profile="$(mktemp -d)"
  printf '  %-26s %sx%s\n' "$name" "$w" "$h"
  # Via shot-setup.html, which seeds the cached-licence keys and then redirects
  # to the board IN THE SAME RUN — so it photographs as the product rather than
  # with EVALUATION stamped across it. Seeding in a separate run does not work:
  # Chrome is killed when --screenshot finishes and never flushes localStorage.
  local enc; enc=$(printf '%s' "$url" | sed 's/&/%26/g')
  "$CHROME" --headless --disable-gpu --hide-scrollbars --no-first-run \
    --user-data-dir="$profile" \
    --window-size="${w},${h}" \
    --virtual-time-budget="$BUDGET" \
    --screenshot="$OUT/$name.png" \
    "$BASE/shot-setup.html?next=$enc" >/dev/null 2>&1
  rm -rf "$profile"
}

echo "shooting into $OUT/ …"

# --- the two New York platform displays -------------------------------------
# Portrait, because the OUTFRONT panels in the stations are mounted that way.
shoot station-nyc-next    1400 2200 "station.html?stop=127&view=next"
# The overhead countdown is a wide strip; shot at its real proportions.
shoot station-nyc-clock   2560  760 "station.html?stop=127&view=clock"

# --- the flip board, per style ----------------------------------------------
shoot flipboard-nyc       2560 1440 "flipboard.html?city=nyc&style=metro"
shoot flipboard-septa     2560 1440 "flipboard.html?city=philly&style=septa"
shoot flipboard-dc-metro  2560 1440 "flipboard.html?city=dc&style=metro"
shoot flipboard-zurich    2560 1440 "flipboard.html?city=zurich&style=euro"
shoot flipboard-nyc-usa   2560 1440 "flipboard.html?city=nyc&style=usa"

# --- city boards (the map view) ---------------------------------------------
shoot board-cologne-new    2560 1440 "cologne.html"
shoot board-stuttgart-new  2560 1440 "stuttgart.html"

echo
echo "done:"
ls -lh "$OUT" | grep -E "$(date +%b) +$(date +%-d)" || ls -lh "$OUT"
