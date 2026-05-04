"""
TN Template Test — local dev server with CORS enabled.

Run instead of `python -m http.server 8080` when you need to bake the video
backdrop into PNG/MP4/WebM exports (Chrome requires CORS headers on the video
response even for same-origin, otherwise the canvas becomes "tainted" and
toBlob() fails with SecurityError).

Usage:
    cd "D:\\TN template test"
    python serve.py

Opens on http://localhost:8080/ — same as the vanilla http.server.
"""

import http.server
import socketserver
import sys

PORT = 8080

class CORSHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Allow any origin to fetch our resources
        self.send_header('Access-Control-Allow-Origin', '*')
        # Cross-Origin-Resource-Policy lets images/videos load across origins
        self.send_header('Cross-Origin-Resource-Policy', 'cross-origin')
        # ===== Cross-Origin Isolation =====
        # ffmpeg.wasm 0.12+ requires SharedArrayBuffer, which the browser only
        # exposes when the page is "cross-origin isolated". That requires BOTH:
        #   • COOP: same-origin
        #   • COEP: require-corp  (or credentialless)
        # Without these the browser strips SharedArrayBuffer and the H.264
        # encoder fails with "SharedArrayBuffer is not defined".
        # `credentialless` is the lenient mode — lets cross-origin <script>
        # from CDNs (unpkg, jsdelivr) load without the CDN setting CORP itself.
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'credentialless')
        # No caching during dev so Ctrl+R actually fetches fresh files
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def guess_type(self, path):
        """Override MIME guessing to attach UTF-8 charset on text types so Czech
        diacritics render correctly regardless of file BOM or browser heuristics.
        """
        base = super().guess_type(path)
        # Python returns a single string; treat it as the MIME type
        mime = base if isinstance(base, str) else (base[0] if base else 'application/octet-stream')
        if mime.startswith('text/') or mime in ('application/javascript', 'application/json'):
            return f'{mime}; charset=utf-8'
        return mime

    # Ensure correct MIME types for media
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.mp4':  'video/mp4',
        '.webm': 'video/webm',
        '.mov':  'video/quicktime',
        '.otf':  'font/otf',
        '.woff2': 'font/woff2',
    }

if __name__ == '__main__':
    handler = CORSHandler
    with socketserver.TCPServer(('', PORT), handler) as httpd:
        print(f'TN Template Test server (CORS-enabled) running on http://localhost:{PORT}/')
        print(f'Cwd: {sys.argv[0] if len(sys.argv) > 0 else "."}')
        print('Press Ctrl+C to stop.')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\nShutting down.')
            sys.exit(0)
