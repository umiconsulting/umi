"""Serve the local menu and optionally forward its public API requests."""
import http.server
import os
from pathlib import Path
import re
import urllib.error
import urllib.request
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent / 'dist'
UPSTREAM = os.environ.get('UMI_MENU_PROXY_API_ORIGIN', '').rstrip('/')
if UPSTREAM:
    target = urlsplit(UPSTREAM)
    if target.scheme != 'https' or not target.netloc or target.username or target.password or target.path or target.query or target.fragment:
        raise ValueError('UMI_MENU_PROXY_API_ORIGIN must be an HTTPS origin.')

PUBLIC_READ = re.compile(r'^/api/public/(?:menu/[a-zA-Z0-9-]{1,80}|table-order/[A-Za-z0-9_-]{20,120})/?$')
PUBLIC_ORDER = re.compile(r'^/api/public/table-order/[A-Za-z0-9_-]{20,120}/orders/?$')

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def forward_public_api(self):
        path = urlsplit(self.path).path
        allowed = (self.command == 'GET' and PUBLIC_READ.fullmatch(path)) or (self.command == 'POST' and PUBLIC_ORDER.fullmatch(path))
        if not UPSTREAM or not allowed:
            self.send_error(404)
            return
        body = None
        if self.command == 'POST':
            origin = self.headers.get('Origin')
            if origin != 'http://127.0.0.1:56456':
                self.send_error(403)
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                self.send_error(400)
                return
            if size < 1 or size > 65536 or self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                self.send_error(400)
                return
            body = self.rfile.read(size)
        request = urllib.request.Request(UPSTREAM + self.path, data=body, method=self.command,
            headers={'Accept': 'application/json', **({'Content-Type': 'application/json'} if body else {})})
        try:
            response = urllib.request.urlopen(request, timeout=25)
        except urllib.error.HTTPError as error:
            response = error
        except (urllib.error.URLError, TimeoutError):
            self.send_error(502, 'Staging API unavailable')
            return
        with response:
            payload = response.read(5 * 1024 * 1024 + 1)
            if len(payload) > 5 * 1024 * 1024:
                self.send_error(502)
                return
            self.send_response(response.code)
            self.send_header('Content-Type', response.headers.get('Content-Type', 'application/json'))
            self.send_header('Content-Length', str(len(payload)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            if response.headers.get('Retry-After'):
                self.send_header('Retry-After', response.headers['Retry-After'])
            self.end_headers()
            self.wfile.write(payload)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith('/api/'):
            return self.forward_public_api()
        if not Path(self.translate_path(path)).is_file() and not Path(path).suffix:
            self.path = '/index.html'
        return super().do_GET()

    def do_POST(self):
        return self.forward_public_api()

    def log_message(self, format, *args):
        # QR paths contain credentials. Keep them out of development logs.
        pass

http.server.ThreadingHTTPServer(('127.0.0.1', 56456), Handler).serve_forever()
