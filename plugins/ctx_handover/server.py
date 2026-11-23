"""Serveur HTTP du master ctx_handover.

GET  /v1/health                         sans jeton
POST /v1/push                           bundle JSON (gzip accepté) → entrée du journal
GET  /v1/changes?since=N&exclude=dev&wait=25   long-poll : répond dès qu'il y a du neuf
GET  /v1/sessions                       index (dernière version de chaque session)
GET  /v1/sessions/<origin>/<session>    bundle complet
GET  /v1/devices, /v1/status

Authentification : « Authorization: Bearer <jeton> ». À exposer derrière TLS
(--tls-cert/--tls-key), Tailscale ou un tunnel SSH ; écoute 127.0.0.1 par défaut.
"""
from __future__ import annotations

import json
import ssl
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import core


def make_handler(store: core.MasterStore, token: str, log=None):
    class Handler(BaseHTTPRequestHandler):
        server_version = "ctx_handover/" + core.VERSION
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # noqa: N802 — signature imposée
            if log:
                log("%s %s" % (self.address_string(), fmt % args))

        def _send(self, code: int, body) -> None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _auth(self) -> bool:
            h = self.headers.get("Authorization") or ""
            given = h[7:] if h.startswith("Bearer ") else ""
            if not core.check_token(token, given):
                self._send(401, {"error": "unauthorized"})
                return False
            dev = self.headers.get("X-Ctx-Device")
            if dev:
                store.touch(dev)
            return True

        def do_GET(self):  # noqa: N802
            url = urllib.parse.urlparse(self.path)
            parts = [urllib.parse.unquote(p) for p in url.path.strip("/").split("/") if p]
            q = dict(urllib.parse.parse_qsl(url.query))
            if parts == ["v1", "health"]:
                return self._send(200, {"ok": True, "version": core.VERSION})
            if not self._auth():
                return None
            try:
                if parts == ["v1", "changes"]:
                    wait = min(max(float(q.get("wait", 0) or 0), 0.0), 55.0)
                    return self._send(200, store.changes(int(q.get("since", 0) or 0), q.get("exclude", ""), int(q.get("limit", 500) or 500), wait))
                if parts == ["v1", "sessions"]:
                    return self._send(200, {"sessions": store.index(int(q.get("limit", 200) or 200))})
                if len(parts) == 4 and parts[:2] == ["v1", "sessions"]:
                    b = store.get(parts[2], parts[3])
                    return self._send(200, b) if b else self._send(404, {"error": "not_found"})
                if parts == ["v1", "devices"]:
                    return self._send(200, {"devices": store.status()["devices"]})
                if parts == ["v1", "status"]:
                    return self._send(200, store.status())
            except (ValueError, KeyError) as e:
                return self._send(400, {"error": str(e)})
            return self._send(404, {"error": "not_found"})

        def do_POST(self):  # noqa: N802
            url = urllib.parse.urlparse(self.path)
            if not self._auth():
                return None
            if url.path.rstrip("/") != "/v1/push":
                return self._send(404, {"error": "not_found"})
            length = int(self.headers.get("Content-Length") or 0)
            if length <= 0 or length > core.MAX_BUNDLE:
                return self._send(413, {"error": "taille invalide"})
            raw = self.rfile.read(length)
            try:
                entry = store.ingest(core.decode_bundle(raw))
            except (ValueError, OSError) as e:
                return self._send(400, {"error": str(e)})
            return self._send(200, entry)

    return Handler


def make_server(store: core.MasterStore, host: str, port: int, token: str, tls_cert: str = "", tls_key: str = "", log=None):
    if not token:
        raise SystemExit("Un jeton est obligatoire pour le master (--token, CTX_HANDOVER_TOKEN ou ctx_handover.json).")
    httpd = ThreadingHTTPServer((host, port), make_handler(store, token, log))
    httpd.daemon_threads = True
    if tls_cert:
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(tls_cert, tls_key or None)
        httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
    return httpd
