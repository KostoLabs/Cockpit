"""Ligne de commande ctx_handover.

Utilisable sans Hermes (« python3 -m ctx_handover … », PYTHONPATH sur le dossier
plugins) ou via Hermes une fois le plugin activé (« hermes ctx_handover … »).
"""
from __future__ import annotations

import argparse
import json
import secrets
import sys
import threading
import time

from . import core


def setup_parser(p: argparse.ArgumentParser) -> None:
    p.add_argument("--config", help="fichier de configuration (défaut ~/.hermes/ctx_handover.json)")
    sub = p.add_subparsers(dest="ctx_cmd")

    s = sub.add_parser("init", help="créer ou compléter la configuration")
    s.add_argument("--role", choices=["device", "master"])
    s.add_argument("--device")
    s.add_argument("--transport", choices=["http", "ssh"])
    s.add_argument("--master-url")
    s.add_argument("--ssh-target")
    s.add_argument("--ssh-command")
    s.add_argument("--exporter", choices=["cli", "api"])
    s.add_argument("--token")
    s.add_argument("--gen-token", action="store_true", help="générer un jeton aléatoire (master)")

    s = sub.add_parser("serve", help="master : serveur HTTP (long-poll)")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8765)
    s.add_argument("--tls-cert", default="")
    s.add_argument("--tls-key", default="")
    s.add_argument("--fanout", action="store_true", help="pousser aussi aux appareils SSH déclarés")

    s = sub.add_parser("fanout", help="master : pousser aux appareils SSH")
    s.add_argument("--watch", action="store_true", help="en continu")

    s = sub.add_parser("ingest", help="master : lire un bundle sur l'entrée standard")
    s.add_argument("--device", default="")
    s = sub.add_parser("changes", help="master : nouveautés depuis un curseur")
    s.add_argument("--since", type=int, default=0)
    s.add_argument("--exclude", default="")
    s = sub.add_parser("get", help="master : afficher un bundle")
    s.add_argument("origin")
    s.add_argument("session_id")

    sub.add_parser("receive", help="appareil : recevoir un bundle poussé par le master (SSH)")
    s = sub.add_parser("push", help="appareil : pousser des sessions")
    s.add_argument("--session", action="append", default=[])
    s.add_argument("--scan", action="store_true", help="pousser les sessions modifiées depuis le dernier scan")
    s = sub.add_parser("pull", help="appareil : récupérer les sessions des autres appareils")
    s.add_argument("--wait", type=float, default=0)
    sub.add_parser("daemon", help="appareil : synchro continue au premier plan")
    sub.add_parser("list", help="appareil : sessions reçues des autres appareils")
    s = sub.add_parser("show", help="appareil : transcription d'une session reçue")
    s.add_argument("query")
    s.add_argument("--max", type=int, default=0)
    s = sub.add_parser("status", help="état local (et du master s'il est joignable)")
    s.add_argument("--json", action="store_true")


def _out(obj) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False, indent=None) + "\n")
    sys.stdout.flush()


def handle(args: argparse.Namespace) -> int:
    cfg = core.load_config(args.config)
    cmd = getattr(args, "ctx_cmd", None)
    log = lambda *a: sys.stderr.write("[ctx_handover] " + " ".join(str(x) for x in a) + "\n")  # noqa: E731

    if cmd == "init":
        for key in ("role", "device", "transport", "master_url", "ssh_target", "ssh_command", "exporter", "token"):
            v = getattr(args, key, None)
            if v:
                cfg[key] = v
        if args.gen_token or (cfg.get("role") == "master" and not cfg.get("token")):
            cfg["token"] = secrets.token_urlsafe(32)
        store = cfg.pop("store", "")
        path = core.save_config(cfg, args.config)
        cfg["store"] = store
        print("Configuration écrite : {}\nrôle {} · appareil {} · transport {}".format(path, cfg["role"], cfg["device"], cfg["transport"]))
        if cfg.get("role") == "master":
            print("Jeton (à copier sur chaque appareil) : " + cfg["token"])
        return 0

    if cmd in ("serve", "fanout", "ingest", "changes", "get"):
        store = core.MasterStore(cfg["store"])
        if cmd == "serve":
            from . import server
            httpd = server.make_server(store, args.host, args.port, cfg.get("token", ""), args.tls_cert, args.tls_key, log)
            if args.fanout:
                threading.Thread(target=_fanout_loop, args=(store, cfg, log), daemon=True).start()
            log("master à l'écoute sur {}://{}:{} (journal {}, {} sessions)".format(
                "https" if args.tls_cert else "http", args.host, args.port, store.seq, len(store.latest)))
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                pass
            return 0
        if cmd == "fanout":
            if args.watch:
                _fanout_loop(store, cfg, log)
            else:
                _out(core.fanout_once(store, cfg))
            return 0
        if cmd == "ingest":
            b = core.decode_bundle(sys.stdin.buffer.read())
            if args.device:
                store.touch(args.device)
            _out(store.ingest(b))
            return 0
        if cmd == "changes":
            store.touch(args.exclude)
            _out(store.changes(args.since, args.exclude))
            return 0
        if cmd == "get":
            b = store.get(args.origin, args.session_id)
            if not b:
                log("session introuvable")
                return 1
            _out(b)
            return 0

    if cmd == "receive":
        state = core.DeviceState(cfg["store"])
        b = core.decode_bundle(sys.stdin.buffer.read())
        if b["origin"] == cfg["device"]:
            _out({"ignored": True})
            return 0
        path = state.put_mirror(b)
        if cfg.get("import_command"):
            core.Syncer(cfg, exporter=_NoExport(), transport=_NoTransport(), state=state)._import(path)
        _out({"stored": str(path)})
        return 0

    if cmd in ("push", "pull", "daemon"):
        syncer = core.Syncer(cfg, log=log)
        if cmd == "push":
            for sid in args.session:
                syncer.mark_dirty(sid)
            n = syncer.flush(force=True)
            if args.scan or not args.session:
                n += syncer.scan()
            print("{} session(s) poussée(s).".format(n))
            return 0
        if cmd == "pull":
            print("{} session(s) reçue(s).".format(syncer.pull(args.wait)))
            return 0
        syncer.start()
        log("synchro continue : appareil {} → {}".format(cfg["device"], cfg.get("master_url") if cfg.get("transport") == "http" else cfg.get("ssh_target")))
        try:
            while True:
                time.sleep(3600)
        except KeyboardInterrupt:
            syncer.stop()
        return 0

    if cmd == "list":
        rows = core.DeviceState(cfg["store"]).list_mirror()
        for r in rows:
            print("{:<14} {:<28} {}  {}".format(r["origin"][:14], r["session_id"][:28],
                                                 time.strftime("%d/%m %H:%M", time.localtime(r["updated_at"])), r["title"]))
        if not rows:
            print("Aucune session reçue.")
        return 0

    if cmd == "show":
        b = core.DeviceState(cfg["store"]).find_mirror(args.query)
        if not b:
            log("aucune session reçue ne correspond")
            return 1
        print(core.transcript(b, args.max))
        return 0

    if cmd == "status":
        state = core.DeviceState(cfg["store"])
        info = {"device": cfg["device"], "role": cfg["role"], "transport": cfg["transport"], "store": cfg["store"],
                "cursor": state.data["cursor"], "pushed": len(state.data["pushed"]), "mirror": len(state.list_mirror()),
                "last_push": state.data["last_push"], "last_pull": state.data["last_pull"], "last_error": state.data["last_error"]}
        if cfg["role"] == "master":
            info["master"] = core.MasterStore(cfg["store"]).status()
        else:
            try:
                info["master"] = core.make_transport(cfg).status()
            except Exception as e:  # noqa: BLE001
                info["master_error"] = str(e)
        if getattr(args, "json", False):
            _out(info)
        else:
            for k, v in info.items():
                print("{:<12} {}".format(k, json.dumps(v, ensure_ascii=False) if isinstance(v, (dict, list)) else v))
        return 0

    print("Sous-commande attendue : init, serve, fanout, push, pull, daemon, list, show, status (voir --help).")
    return 2


def _fanout_loop(store, cfg, log):
    while True:
        try:
            rep = core.fanout_once(store, cfg)
            if any(not str(v).startswith("0 ") for v in rep.values()):
                log("fan-out", rep)
        except Exception as e:  # noqa: BLE001
            log("fan-out en échec", e)
        with store.cond:
            store.cond.wait(timeout=float(cfg.get("interval", 20)))


class _NoExport:
    def export(self, sid):
        return ""

    def recent(self, since):
        return []


class _NoTransport:
    pass


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="ctx_handover", description="Synchro continue des sessions Hermes entre appareils (master / devices, HTTP ou SSH).")
    setup_parser(p)
    return handle(p.parse_args(argv))
