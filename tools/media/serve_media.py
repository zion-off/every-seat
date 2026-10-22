#!/usr/bin/env python3
"""Serve the built media over plain HTTP for the Fire TV emulator.

Binds 127.0.0.1 only. The emulator reaches the host's localhost as 10.0.2.2, so the stream is at
http://10.0.2.2:PORT/<film>/master.m3u8. There is no TLS: the emulator rejects self-signed
certificates and plain HTTP is accepted.

Usage: serve_media.py [--root DIR] [--port N]
"""

import argparse
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / "build" / "media"


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".m3u8": "application/vnd.apple.mpegurl",
        ".m4s": "video/iso.segment",
        ".mp4": "video/mp4",
        ".vtt": "text/vtt",
        ".sensevtt": "text/vtt",
        ".json": "application/json",
    }

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format: str, *args) -> None:  # noqa: A002
        print(f"{time.time():.3f} {self.address_string()} {format % args}", flush=True)

    def handle(self) -> None:
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve built media over plain HTTP.")
    parser.add_argument("--root", type=Path, default=DEFAULT_ROOT, help="directory to serve")
    parser.add_argument("--port", type=int, default=8080, help="port (default 8080)")
    args = parser.parse_args()
    if not args.root.is_dir():
        print(f"error: {args.root} is not a directory (run prepare.sh first)", file=sys.stderr)
        return 2

    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, directory=args.root))
    print(f"serving {args.root} on 127.0.0.1:{args.port} (emulator: http://10.0.2.2:{args.port})")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
