"""Serve the sample app like a dev server: no browser caching, so reloads always fetch fresh files.

    python3 examples/hello-app/serve.py            # http://127.0.0.1:3000
    python3 examples/hello-app/serve.py 3001
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 3000
    root = os.path.dirname(os.path.abspath(__file__))
    handler = functools.partial(NoCacheHandler, directory=root)
    with http.server.ThreadingHTTPServer(("127.0.0.1", port), handler) as server:
        print(f"Sample app on http://127.0.0.1:{port}", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
