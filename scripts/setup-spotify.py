#!/usr/bin/env python3
"""Authorize Spotify locally and send credentials directly to GitHub Secrets."""
import argparse
import pathlib
import shutil
import base64
import getpass
import hashlib
import http.server
import json
import secrets
import subprocess
import time
import urllib.parse
import urllib.request
import urllib.error

REPO = 'jormbee/jeremybaum.xyz'
REDIRECT = 'http://127.0.0.1:8888/callback'


def save_secret(name, value):
    result = subprocess.run(['gh', 'secret', 'set', name, '--repo', REPO], input=value,
                            text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'Could not save {name}; check GitHub authentication and repository permissions.')
    print(f'Saved {name}.', flush=True)


ROOT = pathlib.Path(__file__).resolve().parent.parent


def preview_handler(payload):
    class Preview(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def log_message(self, *_args):
            pass

        def end_headers(self):
            self.send_header('Cache-Control', 'no-store')
            super().end_headers()

        def do_GET(self):
            path = urllib.parse.unquote(urllib.parse.urlparse(self.path).path)
            if path == '/data/listening.json':
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)
                return
            candidate = (ROOT / path.lstrip('/')).resolve()
            allowed_file = path in ['/', '/index.html', '/script.js', '/favicon.png']
            allowed_asset = path.startswith(('/css/', '/images/'))
            safe = candidate.is_relative_to(ROOT) and not any(part.startswith('.') for part in pathlib.PurePosixPath(path).parts)
            if not safe or not (allowed_file or allowed_asset) or (path != '/' and not candidate.is_file()):
                self.send_error(404)
                return
            super().do_GET()

        def do_HEAD(self):
            self.send_error(405)

    return Preview


def local_preview(access_token, port):
    result = subprocess.run(['node', str(ROOT / 'scripts/preview-spotify.mjs')],
        input=json.dumps({'accessToken': access_token}), text=True, capture_output=True,
        cwd=ROOT, timeout=180)
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or 'Spotify local collection failed.')
    data = json.loads(result.stdout)
    payload = json.dumps(data).encode()
    if data['album']:
        print(f"\nFeatured album: {data['album']['name']}", flush=True)
    else:
        print('\nNo album plays available; the preview will hide the listening sentence. Singles and compilations are excluded.', flush=True)
    print('Based on the past seven days of history Spotify currently provides; this may be incomplete.', flush=True)
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), preview_handler(payload)) as server:
        print(f'Open http://127.0.0.1:{port} to preview. Ctrl+C stops the server.', flush=True)
        print('Preview data stays in memory. No GitHub secrets or repository data were changed.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print('\nLocal preview stopped.', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--local-test', action='store_true', help='Authorize Spotify and preview the live album locally without changing GitHub secrets or files.')
    parser.add_argument('--port', type=int, default=8765, help='Local preview port (default: 8765; OAuth callback remains 8888).')
    args = parser.parse_args()
    if args.local_test:
        if not 1024 <= args.port <= 65535 or args.port == 8888:
            parser.error('Choose a preview port from 1024 to 65535 other than 8888.')
        if not shutil.which('node'):
            raise RuntimeError('Install Node.js 22 or newer to run the local preview.')
        print('Local test: credentials go only to Spotify; GitHub secrets and repository files stay unchanged.', flush=True)
    else:
        check = subprocess.run(['gh', 'api', f'repos/{REPO}', '--jq', '.permissions.admin'], capture_output=True, text=True)
        if check.returncode or check.stdout.strip() != 'true':
            raise RuntimeError('Run gh auth login first with repository administration access.')
        print('Credentials stay in memory and are sent only to Spotify and GitHub Secrets.', flush=True)
    client_id = getpass.getpass('Spotify Client ID (hidden): ').strip()
    client_secret = getpass.getpass('Spotify Client Secret (hidden): ').strip()
    if not client_id or not client_secret:
        raise RuntimeError('Both credentials are required.')
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    result = {}

    class Callback(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Never log authorization codes or callback URLs.

        def do_GET(self):
            request = urllib.parse.urlparse(self.path)
            query = urllib.parse.parse_qs(request.query)
            if request.path != '/callback':
                self.send_error(404)
                return
            incoming = query.get('state', [''])[0]
            if not secrets.compare_digest(incoming, state):
                self.send_error(400, 'Invalid authorization state')
                return
            if 'error' in query:
                result['error'] = 'Spotify authorization was declined.'
            else:
                result['code'] = query.get('code', [''])[0]
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.end_headers()
            self.wfile.write(b'Return to the terminal to see whether setup completed. You can close this tab.')

    with http.server.HTTPServer(('127.0.0.1', 8888), Callback) as server:
        server.timeout = 1
        params = urllib.parse.urlencode({'client_id': client_id, 'response_type': 'code',
            'redirect_uri': REDIRECT, 'state': state, 'scope': 'user-read-recently-played',
            'code_challenge_method': 'S256', 'code_challenge': challenge})
        print('\nOpen this URL in your browser and approve read-only listening history:\n', flush=True)
        print('https://accounts.spotify.com/authorize?' + params, flush=True)
        deadline = time.monotonic() + 600
        while not result and time.monotonic() < deadline:
            server.handle_request()
    if result.get('error'):
        raise RuntimeError(result['error'])
    if not result.get('code'):
        raise RuntimeError('Authorization timed out. Run the helper again.')
    payload = urllib.parse.urlencode({'grant_type': 'authorization_code', 'code': result['code'],
        'redirect_uri': REDIRECT, 'code_verifier': verifier}).encode()
    auth = base64.b64encode(f'{client_id}:{client_secret}'.encode()).decode()
    request = urllib.request.Request('https://accounts.spotify.com/api/token', data=payload,
        headers={'Authorization': 'Basic ' + auth, 'Content-Type': 'application/x-www-form-urlencoded'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            tokens = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Spotify token exchange failed (HTTP {error.code}); check credentials and redirect URI.') from None
    if not tokens.get('refresh_token'):
        raise RuntimeError('Spotify did not return a refresh token.')
    # Confirm the requested permission works before storing credentials.
    request = urllib.request.Request('https://api.spotify.com/v1/me/player/recently-played?limit=1',
        headers={'Authorization': 'Bearer ' + tokens['access_token']})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Listening history access failed (HTTP {error.code}); check app access and Premium status.') from None
    if args.local_test:
        local_preview(tokens['access_token'], args.port)
        return
    existing = subprocess.run(['gh', 'secret', 'list', '--repo', REPO, '--json', 'name'], capture_output=True, text=True, check=True)
    names = {entry['name'] for entry in json.loads(existing.stdout)}
    if 'SPOTIFY_STATE_KEY' not in names:
        save_secret('SPOTIFY_STATE_KEY', base64.b64encode(secrets.token_bytes(32)).decode())
    save_secret('SPOTIFY_CLIENT_ID', client_id)
    save_secret('SPOTIFY_CLIENT_SECRET', client_secret)
    save_secret('SPOTIFY_REFRESH_TOKEN', tokens['refresh_token'])
    print('\nSpotify access verified; all four GitHub Secrets are configured. No files were committed or pushed.', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        print(f'Setup stopped: {error}', flush=True)
        raise SystemExit(1)
    except (KeyboardInterrupt, EOFError):
        print('\nSetup cancelled. No credentials written to disk.')
        raise SystemExit(1)
