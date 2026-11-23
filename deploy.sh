#!/bin/bash
# One-command deploy for the transit boards.
#
#   ./deploy.sh "what changed"      (message is optional)
#
# Stages every change in this folder, commits it, and pushes to GitHub, which
# republishes GitHub Pages within ~1 minute. Run it any time you (or Claude)
# change a board file, a schedule JSON, etc.
#
# First-time setup only (see ADDING-A-CITY.md / the chat): the very first push
# must align the histories with:  git push -f origin main
# After you authenticate once, macOS remembers it and every later ./deploy.sh
# needs no password.

set -e
cd "$(dirname "$0")"

if git diff --quiet && git diff --cached --quiet; then
  echo "Nothing changed since the last deploy."
  exit 0
fi

git add -A
git commit -m "${1:-Update transit boards}"
git push
echo ""
echo "Pushed. GitHub Pages will republish in about a minute."
echo "Then hard-refresh the live page (Cmd+Shift+R) to skip the browser cache."
