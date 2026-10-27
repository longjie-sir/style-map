#!/usr/bin/env python3
"""本地开发服务器：静态文件 + 远端资源磁盘缓存代理。

用法:  python scripts/serve.py [port]
访问:  http://127.0.0.1:8899/?q=low&proxy=1

/proxy?u=<url> 会把远端请求落到 .cache/ 下，命中后离线也能用，
方便反复截图与调试（DataV 边界、Terrarium DEM 瓦片都走这条路）。
"""
import hashlib
import os
import sys
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CACHE = os.path.join(ROOT, '.cache')
os.makedirs(CACHE, exist_ok=True)

CTYPE = {
    '.json': 'application/json; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
}


def cache_path(url):
    h = hashlib.sha1(url.encode('utf-8')).hexdigest()
    ext = os.path.splitext(urllib.parse.urlparse(url).path)[1] or '.bin'
    return os.path.join(CACHE, h + ext)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        pass

    def do_GET(self):
        if self.path.startswith('/proxy?'):
            return self.proxy()
        return super().do_GET()

    def proxy(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        url = (q.get('u') or [''])[0]
        if not url.startswith('http'):
            self.send_error(400, 'bad url')
            return
        path = cache_path(url)
        if not os.path.exists(path):
            try:
                req = urllib.request.Request(url, headers={
                    'User-Agent': 'Mozilla/5.0 (terrain-atelier dev proxy)',
                    'Referer': 'https://geo.datav.aliyun.com/',
                })
                with urllib.request.urlopen(req, timeout=45) as r, open(path, 'wb') as f:
                    f.write(r.read())
            except Exception as e:  # noqa: BLE001
                self.send_error(502, 'upstream failed: %s' % e)
                return
        ext = os.path.splitext(path)[1]
        with open(path, 'rb') as f:
            data = f.read()
        self.send_response(200)
        self.send_header('Content-Type', CTYPE.get(ext, 'application/octet-stream'))
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        self.end_headers()
        self.wfile.write(data)


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8899
    srv = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    print('serving %s on http://127.0.0.1:%d  (cache: %s)' % (ROOT, port, CACHE), flush=True)
    srv.serve_forever()
