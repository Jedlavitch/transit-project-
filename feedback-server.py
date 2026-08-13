#!/usr/bin/env python3
"""feedback-server.py — local dev server for the transit boards.

Drop-in replacement for `python3 -m http.server` (serves this directory
exactly the same way) that additionally answers POST /api/feedback, so the
"Report a bug / Give feedback" button (feedback.js, wired into dc.html) has
something to talk to while developing locally.

Why this exists: the boards are a static site meant for GitHub Pages, which
has no server-side code at all. There's nothing to "wire the submit to"
there. This script is the simplest way to get real persistence during local
development without adding a JS runtime or framework this project doesn't
otherwise use (see .claude/launch.json, which now runs this instead of the
plain http.server module). It is NOT what runs in production — GitHub Pages
serves the static files only, and a submission there will just fail (see the
comment in feedback.js for how that's handled and what a production version
would need — most likely a small Cloudflare Worker, same pattern as this
project's other optional server-side features).

Usage: python3 feedback-server.py [port]   (default 4173, same as before)
Also honors the PORT environment variable (overrides the default, not an
explicit argument) so tooling that assigns a port dynamically still works.
"""
import json
import os
import sys
from datetime import datetime, timezone
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPORTS_FILE = ROOT / "reports" / "feedback.jsonl"
MAX_MESSAGE_LEN = 5000


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        if self.path != "/api/feedback":
            super().log_message(fmt, *args)

    def do_POST(self):
        if self.path != "/api/feedback":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            message = str(body.get("message", "")).strip()[:MAX_MESSAGE_LEN]
            page = str(body.get("page", "")).strip()[:2000]
            if not message:
                self.send_error(400, "empty message")
                return

            REPORTS_FILE.parent.mkdir(parents=True, exist_ok=True)
            record = {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "message": message,
                "page": page,
            }
            with REPORTS_FILE.open("a", encoding="utf-8") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": False, "error": str(e)}).encode())


if __name__ == "__main__":
    default_port = int(os.environ.get("PORT", 4173))
    port = int(sys.argv[1]) if len(sys.argv) > 1 else default_port
    server = ThreadingHTTPServer(("", port), Handler)
    print(f"Serving {ROOT} on http://localhost:{port}  (POST /api/feedback -> {REPORTS_FILE})")
    server.serve_forever()
