#!/usr/bin/env python3
"""yt-dlp download daemon for the smart mirror backend.

Why this exists: spawning the yt-dlp CLI on a Raspberry Pi 2 costs ~3.8s of
interpreter startup plus ~5s of module imports and regex compilation, and the
extraction machinery (SSL contexts, cached player responses) is rebuilt every
time. Measured on the Pi: a cold `yt-dlp` process needs ~20s to deliver an
m4a; the same work in a warm process takes ~4-6s. On a 1GHz ARMv7 that is the
difference between a song starting and a Cast receiver giving up.

The download MUST happen in this process: extract_info(skip_download) returns
URLs with the nsig throttling challenge unsolved, and googlevideo serves those
at ~32KB/s (measured: 3.5MB in 110s). ydl.download() solves nsig in-process
and the same URL arrives at full LAN speed (~1s).

Usage: run with the yt-dlp venv interpreter, e.g.
    /opt/yt-dlp-venv/bin/python backend/bin/yt-dlp-daemon.py
PM2 starts it as the `yt-dlp-daemon` app (see ecosystem.config.js).

API (localhost only — it accepts arbitrary output paths, so never expose it):
    GET  /health                      -> {"ok": true}
    POST /download {"id", "out"}      -> {"ok": true, "path": "<actual file>"}
                                         or HTTP 500 {"ok": false, "error": ...}
"""

import glob
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import yt_dlp

HOST = os.environ.get("YTDLP_DAEMON_HOST", "127.0.0.1")
PORT = int(os.environ.get("YTDLP_DAEMON_PORT", "5055"))
VIDEO_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{11}$")

# yt_dlp.YoutubeDL is not thread-safe and two extractions would fight over the
# Pi's 4 cores and 921MB of RAM anyway, so serialize downloads.
download_lock = threading.Lock()

BASE_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
    # Same preference as the backend's FORMAT_PLANS.m4a: itag 140 is 128k
    # LC-AAC in MP4, remuxed (not re-encoded) by the backend afterwards.
    "format": "140/bestaudio[ext=m4a]/bestaudio",
}


def download(video_id, out_base):
    """Download `video_id`'s audio next to `out_base`; return the real path.

    yt-dlp picks the extension from the selected format, so the caller passes
    an extension-less base and we glob for what actually landed.
    """
    for stale in glob.glob(out_base + ".*"):
        try:
            os.unlink(stale)
        except OSError:
            pass
    opts = dict(BASE_OPTS, outtmpl=out_base + ".%(ext)s")
    with download_lock:
        with yt_dlp.YoutubeDL(opts) as ydl:
            ydl.download(["https://www.youtube.com/watch?v=" + video_id])
    produced = [p for p in glob.glob(out_base + ".*") if os.path.getsize(p) > 0]
    if not produced:
        raise RuntimeError("yt-dlp produced no output file")
    return produced[0]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass  # the backend logs failures with context; keep stdout quiet for PM2

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"ok": True})
        else:
            self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        if self.path != "/download":
            self._send(404, {"ok": False, "error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
            req = json.loads(self.rfile.read(length) or b"{}")
            video_id = str(req.get("id") or "")
            out_base = str(req.get("out") or "")
            if not VIDEO_ID_RE.match(video_id):
                raise ValueError("invalid id")
            if not out_base.startswith("/"):
                raise ValueError("out must be an absolute path")
            path = download(video_id, out_base)
            self._send(200, {"ok": True, "path": path})
        except Exception as exc:  # report anything; the backend falls back to the CLI
            self._send(500, {"ok": False, "error": str(exc)[:300]})


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print("yt-dlp daemon listening on %s:%d" % (HOST, PORT), flush=True)
    server.serve_forever()
