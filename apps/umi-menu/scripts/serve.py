"""Serve the built SPA locally, including direct menu and QR paths."""
import http.server
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent / 'dist'

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        path = urlsplit(self.path).path
        if not Path(self.translate_path(path)).is_file() and not Path(path).suffix:
            self.path = '/index.html'
        return super().do_GET()

    def log_message(self, format, *args):
        # QR paths contain credentials. Never write them to the development log.
        pass

http.server.ThreadingHTTPServer(('127.0.0.1', 56456), Handler).serve_forever()
