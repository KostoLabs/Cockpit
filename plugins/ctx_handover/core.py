"""ctx_handover — synchronisation continue des sessions Hermes entre appareils.

Topologie en étoile : chaque appareil (« device ») pousse ses sessions vers un
« master », qui les journalise et les redistribue aux autres appareils.

  device A ──push──▶ master ──push (long-poll HTTP ou fan-out SSH)──▶ device B, C…

Transports : HTTP(S) avec jeton (serveur du master, long-poll) ou SSH (commande
distante, aucune exposition réseau supplémentaire). Bibliothèque standard
uniquement : le master peut tourner sur une machine sans Hermes.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import hmac
import json
import os
import re
import shlex
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Iterable, Optional

VERSION = "1.0.0"
PROTOCOL = 1
MAX_BUNDLE = 32 * 1024 * 1024
SAFE = re.compile(r"[^A-Za-z0-9_.-]+")


# --------------------------------------------------------------------------- config

def hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes").expanduser()


def default_config() -> dict:
    return {
        "enabled": True,
        "role": "device",               # device | master
        "device": socket.gethostname().split(".")[0].lower() or "device",
        "transport": "http",            # http | ssh
        "master_url": "http://127.0.0.1:8765",
        "token": "",
        "ssh_target": "",               # user@master
        "ssh_command": "python3 -m ctx_handover",
        "ssh_binary": "ssh",
        "ssh_options": ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10"],
        "devices": {},                  # master : {"laptop": {"ssh": "q@laptop"}} pour le fan-out SSH
        "exporter": "cli",              # cli (hermes sessions export) | api (API server REST)
        "hermes_bin": "hermes",
        "api_url": "http://127.0.0.1:8642",
        "api_key": "",
        "redact": False,
        "interval": 20,                 # secondes entre deux scans complets
        "debounce": 3,                  # secondes après un tour avant export
        "long_poll": 25,
        "import_command": "",           # ex. « hermes sessions import --format hermes {file} »
        "store": "",
    }


def config_path() -> Path:
    return Path(os.environ.get("CTX_HANDOVER_CONFIG") or hermes_home() / "ctx_handover.json")


def load_config(path: Optional[Path] = None) -> dict:
    cfg = default_config()
    p = Path(path) if path else config_path()
    if p.exists():
        with p.open("r", encoding="utf-8") as fh:
            cfg.update(json.load(fh))
    if os.environ.get("CTX_HANDOVER_TOKEN"):
        cfg["token"] = os.environ["CTX_HANDOVER_TOKEN"]
    if os.environ.get("API_SERVER_KEY") and not cfg.get("api_key"):
        cfg["api_key"] = os.environ["API_SERVER_KEY"]
    cfg["device"] = safe_name(cfg.get("device") or "device")
    cfg["store"] = str(Path(cfg.get("store") or hermes_home() / "ctx_handover").expanduser())
    return cfg


def save_config(cfg: dict, path: Optional[Path] = None) -> Path:
    p = Path(path) if path else config_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(p)
    return p


def safe_name(value: str) -> str:
    """Nom sûr pour un fichier : pas de séparateur, pas de « .. »."""
    s = SAFE.sub("-", str(value or "")).strip(".-")
    return s[:120] or "x"


def now() -> float:
    return time.time()


# --------------------------------------------------------------------------- bundles

def make_bundle(origin: str, session_id: str, jsonl: str, title: str = "", updated_at: float = 0.0, meta: Optional[dict] = None) -> dict:
    """Instantané d'une session : export JSONL Hermes + métadonnées + hash."""
    digest = hashlib.sha256(jsonl.encode("utf-8")).hexdigest()
    return {
        "protocol": PROTOCOL,
        "origin": safe_name(origin),
        "session_id": str(session_id),
        "title": title or _title_from_jsonl(jsonl) or str(session_id),
        "updated_at": float(updated_at or now()),
        "hash": digest,
        "jsonl": jsonl,
        "meta": meta or {},
    }


def check_bundle(b: dict) -> dict:
    if not isinstance(b, dict):
        raise ValueError("bundle invalide")
    for k in ("origin", "session_id", "jsonl"):
        if not b.get(k) or not isinstance(b[k], str):
            raise ValueError("champ manquant : " + k)
    if len(b["jsonl"]) > MAX_BUNDLE:
        raise ValueError("bundle trop volumineux")
    digest = hashlib.sha256(b["jsonl"].encode("utf-8")).hexdigest()
    if b.get("hash") and b["hash"] != digest:
        raise ValueError("hash incohérent")
    b["hash"] = digest
    b["origin"] = safe_name(b["origin"])
    b.setdefault("title", b["session_id"])
    b.setdefault("updated_at", now())
    return b


def encode_bundle(b: dict) -> bytes:
    return gzip.compress(json.dumps(b, ensure_ascii=False).encode("utf-8"))


def decode_bundle(raw: bytes) -> dict:
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return check_bundle(json.loads(raw.decode("utf-8")))


def _records(jsonl: str) -> list:
    out = []
    for line in jsonl.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except ValueError:
            continue
    return out


def _title_from_jsonl(jsonl: str) -> str:
    for r in _records(jsonl):
        t = r.get("title") or r.get("display_title")
        if t:
            return str(t)
    return ""


def _text(content) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for p in content:
            if isinstance(p, dict):
                if p.get("type") in ("text", "input_text", "output_text"):
                    parts.append(p.get("text", ""))
                elif "image" in str(p.get("type", "")):
                    parts.append("[image]")
            elif isinstance(p, str):
                parts.append(p)
        return "".join(parts)
    if isinstance(content, dict):
        return content.get("text") or json.dumps(content, ensure_ascii=False)
    return str(content)


def transcript(bundle: dict, max_chars: int = 0, include_tools: bool = False) -> str:
    """Transcription Markdown lisible d'une session (messages actifs uniquement)."""
    lines = []
    head = "# {} \n\n_Session {} · appareil {} · {}_\n".format(
        bundle.get("title") or bundle["session_id"], bundle["session_id"], bundle["origin"],
        time.strftime("%Y-%m-%d %H:%M", time.localtime(bundle.get("updated_at") or now())))
    lines.append(head)
    for rec in _records(bundle["jsonl"]):
        for m in rec.get("messages") or []:
            if m.get("active") is False:
                continue
            role = m.get("role") or m.get("type") or ""
            if role == "system":
                continue
            if role == "tool" and not include_tools:
                continue
            text = _text(m.get("content") if "content" in m else m.get("text"))
            calls = m.get("tool_calls") or []
            if not text.strip() and not calls:
                continue
            label = {"user": "Utilisateur", "assistant": "Hermes", "tool": "Outil"}.get(role, role or "Message")
            body = text.strip()
            if calls and role == "assistant":
                names = []
                for c in calls:
                    fn = c.get("function", c) if isinstance(c, dict) else {}
                    names.append(str(fn.get("name", "outil")))
                body = (body + "\n" if body else "") + "_outils : " + ", ".join(names) + "_"
            lines.append("**{}** — {}\n".format(label, body))
    out = "\n".join(lines)
    if max_chars and len(out) > max_chars:
        keep = max_chars // 2
        out = out[:keep] + "\n\n[… {} caractères omis …]\n\n".format(len(out) - 2 * keep) + out[-keep:]
    return out


# --------------------------------------------------------------------------- master

class MasterStore:
    """Stockage du master : dernière version de chaque session + journal séquencé.

    store/master/sessions/<origin>/<session>.json   dernier bundle
    store/master/journal.jsonl                       une entrée par version reçue
    store/master/devices.json                        appareils vus (dernière activité, curseur)
    """

    def __init__(self, root: str):
        self.root = Path(root) / "master"
        (self.root / "sessions").mkdir(parents=True, exist_ok=True)
        self.journal_path = self.root / "journal.jsonl"
        self.devices_path = self.root / "devices.json"
        self.lock = threading.Lock()
        self.cond = threading.Condition(self.lock)
        self.entries: list = []
        self.latest: dict = {}
        if self.journal_path.exists():
            for line in self.journal_path.read_text(encoding="utf-8").splitlines():
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                self.entries.append(e)
                self.latest[(e["origin"], e["session_id"])] = e
        self.seq = self.entries[-1]["seq"] if self.entries else 0
        try:
            self.devices = json.loads(self.devices_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.devices = {}

    def _bundle_path(self, origin: str, session_id: str) -> Path:
        d = self.root / "sessions" / safe_name(origin)
        d.mkdir(parents=True, exist_ok=True)
        return d / (safe_name(session_id) + ".json")

    def touch(self, device: str, **fields) -> None:
        if not device:
            return
        with self.lock:
            d = self.devices.setdefault(safe_name(device), {"first_seen": now()})
            d["last_seen"] = now()
            d.update({k: v for k, v in fields.items() if v is not None})
            self._save_devices()

    def _save_devices(self) -> None:
        tmp = self.devices_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.devices, indent=2), encoding="utf-8")
        tmp.replace(self.devices_path)

    def ingest(self, bundle: dict) -> dict:
        b = check_bundle(bundle)
        key = (b["origin"], b["session_id"])
        with self.cond:
            prev = self.latest.get(key)
            if prev and prev["hash"] == b["hash"]:
                return dict(prev, duplicate=True)
            path = self._bundle_path(*key)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps(b, ensure_ascii=False), encoding="utf-8")
            tmp.replace(path)
            self.seq += 1
            entry = {"seq": self.seq, "origin": b["origin"], "session_id": b["session_id"], "title": b.get("title", ""),
                     "hash": b["hash"], "updated_at": b.get("updated_at", 0), "received_at": now(), "size": len(b["jsonl"])}
            with self.journal_path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
            self.entries.append(entry)
            self.latest[key] = entry
            d = self.devices.setdefault(b["origin"], {"first_seen": now()})
            d["last_push"] = now()
            d["last_seen"] = now()
            self._save_devices()
            self.cond.notify_all()
            return dict(entry, duplicate=False)

    def changes(self, since: int = 0, exclude: str = "", limit: int = 500, wait: float = 0) -> dict:
        """Entrées postérieures à `since`, hors appareil `exclude`. Avec `wait`, attend
        qu'une entrée arrive (long-poll) : c'est ce qui fait du HTTP un « push »."""
        exclude = safe_name(exclude) if exclude else ""
        deadline = now() + max(0.0, float(wait or 0))
        with self.cond:
            while True:
                out = [e for e in self.entries if e["seq"] > since and (not exclude or e["origin"] != exclude)]
                if out or now() >= deadline:
                    break
                self.cond.wait(timeout=max(0.05, deadline - now()))
            # seule la dernière version de chaque session compte
            seen = {}
            for e in out:
                seen[(e["origin"], e["session_id"])] = e
            latest = sorted(seen.values(), key=lambda e: e["seq"])[:limit]
            cursor = latest[-1]["seq"] if len(latest) == limit and latest else self.seq
            return {"entries": latest, "cursor": cursor}

    def get(self, origin: str, session_id: str) -> Optional[dict]:
        p = self.root / "sessions" / safe_name(origin) / (safe_name(session_id) + ".json")
        if not p.exists():
            return None
        return json.loads(p.read_text(encoding="utf-8"))

    def index(self, limit: int = 200) -> list:
        with self.lock:
            rows = sorted(self.latest.values(), key=lambda e: e.get("updated_at", 0), reverse=True)
            return rows[:limit]

    def status(self) -> dict:
        with self.lock:
            return {"version": VERSION, "protocol": PROTOCOL, "seq": self.seq, "sessions": len(self.latest),
                    "devices": self.devices}


# --------------------------------------------------------------------------- device

class DeviceState:
    """État local d'un appareil : curseur, hash poussés, miroir des autres appareils."""

    def __init__(self, root: str):
        self.root = Path(root) / "device"
        self.mirror = self.root / "mirror"
        self.mirror.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "state.json"
        self.lock = threading.Lock()
        try:
            self.data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            self.data = {}
        self.data.setdefault("cursor", 0)
        self.data.setdefault("pushed", {})
        self.data.setdefault("last_push", 0)
        self.data.setdefault("last_pull", 0)
        self.data.setdefault("last_error", "")
        self.data.setdefault("last_scan", 0)

    def save(self) -> None:
        with self.lock:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
            tmp.replace(self.path)

    def put_mirror(self, bundle: dict) -> Path:
        b = check_bundle(bundle)
        d = self.mirror / b["origin"]
        d.mkdir(parents=True, exist_ok=True)
        p = d / (safe_name(b["session_id"]) + ".json")
        p.write_text(json.dumps(b, ensure_ascii=False), encoding="utf-8")
        (d / (safe_name(b["session_id"]) + ".md")).write_text(transcript(b), encoding="utf-8")
        return p

    def list_mirror(self) -> list:
        out = []
        for p in self.mirror.glob("*/*.json"):
            try:
                b = json.loads(p.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            out.append({"origin": b["origin"], "session_id": b["session_id"], "title": b.get("title", ""),
                        "updated_at": b.get("updated_at", 0), "hash": b.get("hash", ""), "size": len(b.get("jsonl", "")),
                        "transcript": str(p.with_suffix(".md"))})
        return sorted(out, key=lambda r: r["updated_at"], reverse=True)

    def find_mirror(self, query: str) -> Optional[dict]:
        q = (query or "").strip().lower()
        rows = self.list_mirror()
        for r in rows:
            if r["session_id"].lower() == q or r["session_id"].lower().startswith(q):
                return json.loads((self.mirror / r["origin"] / (safe_name(r["session_id"]) + ".json")).read_text(encoding="utf-8"))
        for r in rows:
            if q and q in (r["title"] or "").lower():
                return json.loads((self.mirror / r["origin"] / (safe_name(r["session_id"]) + ".json")).read_text(encoding="utf-8"))
        return None


# --------------------------------------------------------------------------- exporters

class CliExporter:
    """Export via « hermes sessions export » (format JSONL, une ligne par session)."""

    def __init__(self, hermes_bin: str = "hermes", redact: bool = False, runner: Callable = subprocess.run):
        self.bin = hermes_bin
        self.redact = redact
        self.run = runner

    def _export(self, extra: list) -> str:
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "export.jsonl")
            cmd = [self.bin, "sessions", "export", out] + extra + (["--redact"] if self.redact else [])
            r = self.run(cmd, capture_output=True, text=True, timeout=180)
            if r.returncode != 0:
                raise RuntimeError("hermes sessions export : " + (r.stderr or r.stdout or "échec").strip()[:300])
            return Path(out).read_text(encoding="utf-8") if os.path.exists(out) else ""

    def export(self, session_id: str) -> str:
        return self._export(["--session-id", str(session_id)])

    def recent(self, since: float) -> Iterable[tuple]:
        iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime(max(0, since - 120)))
        text = self._export(["--after", iso])
        for line in text.splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            sid = rec.get("session_id") or rec.get("id")
            if sid:
                yield str(sid), line + "\n", rec.get("title") or "", 0.0


class ApiExporter:
    """Export via l'API server du gateway (GET /api/sessions, /messages)."""

    def __init__(self, base_url: str, api_key: str = ""):
        self.base = base_url.rstrip("/")
        self.key = api_key

    def _get(self, path: str):
        req = urllib.request.Request(self.base + path, headers={"Accept": "application/json"})
        if self.key:
            req.add_header("Authorization", "Bearer " + self.key)
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode("utf-8"))

    def _record(self, meta: dict, session_id: str) -> str:
        data = self._get("/api/sessions/" + urllib.parse.quote(session_id) + "/messages?inline_images=false")
        msgs = data if isinstance(data, list) else data.get("messages") or (data.get("session") or {}).get("messages") or []
        rec = dict(meta)
        rec["session_id"] = session_id
        rec["messages"] = msgs
        return json.dumps(rec, ensure_ascii=False) + "\n"

    def export(self, session_id: str) -> str:
        try:
            meta = self._get("/api/sessions/" + urllib.parse.quote(session_id))
            meta = meta.get("session", meta) if isinstance(meta, dict) else {}
        except urllib.error.HTTPError:
            meta = {}
        return self._record(meta, session_id)

    def recent(self, since: float) -> Iterable[tuple]:
        data = self._get("/api/sessions?limit=200")
        rows = data if isinstance(data, list) else data.get("sessions") or data.get("data") or []
        for s in rows:
            sid = s.get("session_id") or s.get("id")
            upd = s.get("last_message_at") or s.get("updated_at") or s.get("started_at") or 0
            try:
                upd = float(upd)
            except (TypeError, ValueError):
                upd = 0.0
            if upd > 1e12:
                upd /= 1000.0
            if sid and upd >= since - 120:
                yield str(sid), self._record(s, str(sid)), s.get("title") or s.get("display_title") or "", upd


def make_exporter(cfg: dict):
    if cfg.get("exporter") == "api":
        return ApiExporter(cfg.get("api_url") or "http://127.0.0.1:8642", cfg.get("api_key") or "")
    return CliExporter(cfg.get("hermes_bin") or "hermes", bool(cfg.get("redact")))


# --------------------------------------------------------------------------- transports

class TransportError(RuntimeError):
    pass


class HttpTransport:
    def __init__(self, url: str, token: str, device: str, timeout: float = 30):
        self.url = url.rstrip("/")
        self.token = token
        self.device = device
        self.timeout = timeout

    def _req(self, method: str, path: str, body: Optional[bytes] = None, timeout: Optional[float] = None, gz: bool = False):
        req = urllib.request.Request(self.url + path, data=body, method=method)
        req.add_header("Authorization", "Bearer " + self.token)
        req.add_header("X-Ctx-Device", self.device)
        req.add_header("Accept", "application/json")
        if body is not None:
            req.add_header("Content-Type", "application/json")
            if gz:
                req.add_header("Content-Encoding", "gzip")
        try:
            with urllib.request.urlopen(req, timeout=timeout or self.timeout) as res:
                return json.loads(res.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise TransportError("HTTP {} : {}".format(e.code, e.read()[:200].decode("utf-8", "replace")))
        except (urllib.error.URLError, OSError) as e:
            raise TransportError(str(getattr(e, "reason", e)))

    def push(self, bundle: dict) -> dict:
        return self._req("POST", "/v1/push", encode_bundle(bundle), gz=True)

    def changes(self, since: int, wait: float = 0) -> dict:
        q = urllib.parse.urlencode({"since": since, "exclude": self.device, "wait": int(wait)})
        return self._req("GET", "/v1/changes?" + q, timeout=wait + self.timeout)

    def fetch(self, origin: str, session_id: str) -> dict:
        return check_bundle(self._req("GET", "/v1/sessions/" + urllib.parse.quote(origin) + "/" + urllib.parse.quote(session_id)))

    def status(self) -> dict:
        return self._req("GET", "/v1/status")


class SshTransport:
    """Le master est joint par « ssh <cible> <commande ctx_handover> <sous-commande> »."""

    def __init__(self, target: str, remote_cmd: str, device: str, ssh_binary: str = "ssh", options: Optional[list] = None):
        if not target:
            raise TransportError("ssh_target manquant")
        self.target = target
        self.remote = remote_cmd
        self.device = device
        self.ssh = ssh_binary
        self.options = list(options or [])

    def _run(self, args: list, stdin: Optional[bytes] = None, timeout: float = 120) -> bytes:
        remote = self.remote + " " + " ".join(shlex.quote(str(a)) for a in args)
        cmd = [self.ssh] + self.options + [self.target, remote]
        try:
            r = subprocess.run(cmd, input=stdin, capture_output=True, timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as e:
            raise TransportError("ssh : " + str(e))
        if r.returncode != 0:
            raise TransportError("ssh ({}) : {}".format(r.returncode, r.stderr.decode("utf-8", "replace").strip()[:300]))
        return r.stdout

    def push(self, bundle: dict) -> dict:
        return json.loads(self._run(["ingest", "--device", self.device], stdin=encode_bundle(bundle)) or b"{}")

    def changes(self, since: int, wait: float = 0) -> dict:
        return json.loads(self._run(["changes", "--since", since, "--exclude", self.device]) or b"{}")

    def fetch(self, origin: str, session_id: str) -> dict:
        return decode_bundle(self._run(["get", origin, session_id]))

    def status(self) -> dict:
        info = json.loads(self._run(["status", "--json"]) or b"{}")
        return info.get("master", info) if isinstance(info.get("master"), dict) else info


def make_transport(cfg: dict):
    if cfg.get("transport") == "ssh":
        return SshTransport(cfg.get("ssh_target", ""), cfg.get("ssh_command") or "python3 -m ctx_handover", cfg["device"],
                            cfg.get("ssh_binary") or "ssh", cfg.get("ssh_options"))
    if not cfg.get("token"):
        raise TransportError("jeton du master manquant (token ou CTX_HANDOVER_TOKEN)")
    return HttpTransport(cfg.get("master_url") or "http://127.0.0.1:8765", cfg["token"], cfg["device"])


# --------------------------------------------------------------------------- synchro côté appareil

class Syncer:
    """Pousse les sessions modifiées de cet appareil et reçoit celles des autres.

    - mark_dirty(session_id) : appelé par les hooks Hermes après un tour ;
    - flush() : exporte et pousse les sessions marquées (déduplication par hash) ;
    - scan() : filet de sécurité périodique (sessions modifiées depuis le dernier scan) ;
    - pull(wait) : récupère les nouveautés des autres appareils (long-poll en HTTP).
    """

    def __init__(self, cfg: dict, exporter=None, transport=None, state: Optional[DeviceState] = None, log: Callable = None):
        self.cfg = cfg
        self.exporter = exporter or make_exporter(cfg)
        self.transport = transport or make_transport(cfg)
        self.state = state or DeviceState(cfg["store"])
        self.log = log or (lambda *a: None)
        self.dirty: dict = {}
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.threads: list = []

    def mark_dirty(self, session_id: str) -> None:
        if not session_id:
            return
        with self.lock:
            self.dirty[str(session_id)] = now()

    def _push_text(self, session_id: str, jsonl: str, title: str = "", updated: float = 0.0) -> bool:
        if not jsonl.strip():
            return False
        b = make_bundle(self.cfg["device"], session_id, jsonl, title, updated or now())
        if self.state.data["pushed"].get(session_id) == b["hash"]:
            return False
        self.transport.push(b)
        self.state.data["pushed"][session_id] = b["hash"]
        self.state.data["last_push"] = now()
        self.state.data["last_error"] = ""
        self.state.save()
        self.log("poussée", session_id)
        return True

    def flush(self, force: bool = False) -> int:
        delay = float(self.cfg.get("debounce", 3))
        with self.lock:
            ready = [sid for sid, t in self.dirty.items() if force or now() - t >= delay]
            for sid in ready:
                self.dirty.pop(sid, None)
        pushed = 0
        for sid in ready:
            try:
                if self._push_text(sid, self.exporter.export(sid)):
                    pushed += 1
            except Exception as e:  # noqa: BLE001 — on garde la session pour la prochaine passe
                self.state.data["last_error"] = str(e)
                self.state.save()
                self.mark_dirty(sid)
                self.log("échec", sid, e)
        return pushed

    def scan(self) -> int:
        since = float(self.state.data.get("last_scan") or 0)
        started = now()
        pushed = 0
        for sid, jsonl, title, upd in self.exporter.recent(since):
            try:
                if self._push_text(sid, jsonl, title, upd):
                    pushed += 1
            except Exception as e:  # noqa: BLE001
                self.state.data["last_error"] = str(e)
                self.log("échec", sid, e)
                return pushed
        self.state.data["last_scan"] = started
        self.state.save()
        return pushed

    def pull(self, wait: float = 0) -> int:
        res = self.transport.changes(int(self.state.data.get("cursor") or 0), wait)
        got = 0
        for e in res.get("entries") or []:
            if e.get("origin") == self.cfg["device"]:
                continue
            b = self.transport.fetch(e["origin"], e["session_id"])
            path = self.state.put_mirror(b)
            self._import(path)
            got += 1
        self.state.data["cursor"] = int(res.get("cursor") or self.state.data.get("cursor") or 0)
        self.state.data["last_pull"] = now()
        self.state.save()
        return got

    def _import(self, path: Path) -> None:
        cmd = self.cfg.get("import_command") or ""
        if not cmd:
            return
        argv = [a.replace("{file}", str(path)) for a in shlex.split(cmd)]
        subprocess.run(argv, capture_output=True, timeout=120)

    # ---- boucles d'arrière-plan (plugin chargé dans le gateway ou démon autonome)
    def start(self) -> None:
        if self.threads:
            return

        def pusher():
            last_scan = 0.0
            while not self.stop_event.is_set():
                try:
                    self.flush()
                    if now() - last_scan >= float(self.cfg.get("interval", 20)):
                        last_scan = now()
                        self.scan()
                except Exception as e:  # noqa: BLE001
                    self.state.data["last_error"] = str(e)
                self.stop_event.wait(1.0)

        def puller():
            backoff = 2.0
            while not self.stop_event.is_set():
                try:
                    wait = float(self.cfg.get("long_poll", 25)) if isinstance(self.transport, HttpTransport) else 0
                    self.pull(wait)
                    backoff = 2.0
                    if not wait:
                        self.stop_event.wait(float(self.cfg.get("interval", 20)))
                except Exception as e:  # noqa: BLE001
                    self.state.data["last_error"] = str(e)
                    self.stop_event.wait(backoff)
                    backoff = min(backoff * 2, 120)

        for fn in (pusher, puller):
            t = threading.Thread(target=fn, name="ctx_handover-" + fn.__name__, daemon=True)
            t.start()
            self.threads.append(t)

    def stop(self) -> None:
        self.stop_event.set()


# --------------------------------------------------------------------------- fan-out SSH (master)

def fanout_once(store: MasterStore, cfg: dict, runner: Callable = subprocess.run) -> dict:
    """Pousse aux appareils SSH déclarés les versions qu'ils n'ont pas encore reçues."""
    report = {}
    for name, spec in (cfg.get("devices") or {}).items():
        target = (spec or {}).get("ssh")
        if not target:
            continue
        dev = safe_name(name)
        cursor = int(store.devices.get(dev, {}).get("fanout_cursor", 0))
        res = store.changes(cursor, exclude=dev)
        sent = 0
        for e in res["entries"]:
            b = store.get(e["origin"], e["session_id"])
            if not b:
                continue
            remote = (spec.get("command") or cfg.get("ssh_command") or "python3 -m ctx_handover") + " receive"
            cmd = [cfg.get("ssh_binary") or "ssh"] + list(cfg.get("ssh_options") or []) + [target, remote]
            r = runner(cmd, input=encode_bundle(b), capture_output=True, timeout=120)
            if r.returncode != 0:
                report[dev] = "échec : " + (r.stderr or b"").decode("utf-8", "replace").strip()[:200]
                break
            sent += 1
            cursor = e["seq"]
        else:
            cursor = max(cursor, res["cursor"])
            report[dev] = "{} envoyée(s)".format(sent)
        store.touch(dev, fanout_cursor=cursor)
    return report


def check_token(expected: str, given: str) -> bool:
    return bool(expected) and hmac.compare_digest(expected.encode("utf-8"), (given or "").encode("utf-8"))


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")
