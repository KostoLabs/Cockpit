"""Tests du plugin ctx_handover (bibliothèque standard, sans Hermes).
Lancer depuis la racine du dépôt : python3 -m unittest discover -s plugins/ctx_handover/tests -t plugins
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

from ctx_handover import core, server

PLUGINS = str(Path(__file__).resolve().parents[2])


def record(sid, *msgs, title="Titre"):
    return json.dumps({"session_id": sid, "title": title, "messages": [
        {"role": r, "content": c, "active": a} for (r, c, a) in msgs]}) + "\n"


class FakeExporter:
    def __init__(self):
        self.data = {}

    def export(self, sid):
        return self.data.get(sid, "")

    def recent(self, since):
        for sid, text in self.data.items():
            yield sid, text, "", 0.0


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def cfg(self, name, **extra):
        c = core.default_config()
        c.update({"device": name, "store": str(self.dir / name), "token": "secret", "debounce": 0})
        c.update(extra)
        return c


class TestStore(Base):
    def test_safe_name(self):
        self.assertEqual(core.safe_name("../../etc/passwd"), "etc-passwd")
        self.assertNotIn("/", core.safe_name("a/b"))

    def test_ingest_dedupe_changes(self):
        st = core.MasterStore(str(self.dir / "m"))
        a1 = core.make_bundle("laptop", "s1", record("s1", ("user", "Bonjour", True)))
        e = st.ingest(a1)
        self.assertFalse(e["duplicate"])
        self.assertTrue(st.ingest(dict(a1))["duplicate"])
        st.ingest(core.make_bundle("laptop", "s1", record("s1", ("user", "Bonjour", True), ("assistant", "Salut", True))))
        st.ingest(core.make_bundle("desk", "s2", record("s2", ("user", "Autre", True))))
        ch = st.changes(0, exclude="desk")
        self.assertEqual([(x["origin"], x["session_id"], x["seq"]) for x in ch["entries"]], [("laptop", "s1", 2)])
        self.assertEqual(ch["cursor"], 3)
        self.assertEqual(st.changes(3, exclude="laptop")["entries"], [])
        # persistance
        st2 = core.MasterStore(str(self.dir / "m"))
        self.assertEqual(st2.seq, 3)
        self.assertEqual(len(st2.index()), 2)
        self.assertIn("Salut", st2.get("laptop", "s1")["jsonl"])

    def test_bundle_hash_check(self):
        b = core.make_bundle("a", "s", "x\n")
        b["jsonl"] = "y\n"
        with self.assertRaises(ValueError):
            core.check_bundle(dict(b))

    def test_long_poll_wakes_on_push(self):
        st = core.MasterStore(str(self.dir / "m"))
        out = {}

        def waiter():
            t0 = time.time()
            out["res"] = st.changes(0, exclude="b", wait=5)
            out["dt"] = time.time() - t0
        th = threading.Thread(target=waiter)
        th.start()
        time.sleep(0.2)
        st.ingest(core.make_bundle("a", "s1", record("s1", ("user", "x", True))))
        th.join(3)
        self.assertEqual(len(out["res"]["entries"]), 1)
        self.assertLess(out["dt"], 2)

    def test_transcript(self):
        b = core.make_bundle("laptop", "s1", record("s1", ("system", "prompt", True), ("user", "Question", True),
                                                    ("assistant", "Ancienne", False), ("assistant", "Réponse", True)))
        t = core.transcript(b)
        self.assertIn("**Utilisateur** — Question", t)
        self.assertIn("**Hermes** — Réponse", t)
        self.assertNotIn("Ancienne", t)
        self.assertNotIn("prompt", t)


class TestHttp(Base):
    def setUp(self):
        super().setUp()
        self.store = core.MasterStore(str(self.dir / "master"))
        self.httpd = server.make_server(self.store, "127.0.0.1", 0, "secret")
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.url = "http://127.0.0.1:%d" % self.port

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def syncer(self, name, exporter=None):
        cfg = self.cfg(name, master_url=self.url)
        return core.Syncer(cfg, exporter=exporter or FakeExporter(), transport=core.HttpTransport(self.url, "secret", name))

    def test_push_then_pull_on_other_device(self):
        ex = FakeExporter()
        ex.data["s1"] = record("s1", ("user", "Lance la recette", True), ("assistant", "12 tests", True), title="Recette")
        a = self.syncer("laptop", ex)
        b = self.syncer("desktop")
        a.mark_dirty("s1")
        self.assertEqual(a.flush(force=True), 1)
        self.assertEqual(a.flush(force=True), 0)
        a.mark_dirty("s1")
        self.assertEqual(a.flush(force=True), 0, "même contenu : pas de nouvelle poussée")
        self.assertEqual(b.pull(), 1)
        rows = b.state.list_mirror()
        self.assertEqual((rows[0]["origin"], rows[0]["session_id"], rows[0]["title"]), ("laptop", "s1", "Recette"))
        self.assertIn("12 tests", Path(rows[0]["transcript"]).read_text())
        self.assertEqual(a.pull(), 0, "un appareil ne reçoit pas ses propres sessions")
        self.assertIn("laptop", self.store.status()["devices"])

    def test_long_poll_over_http(self):
        b = self.syncer("desktop")
        res = {}
        th = threading.Thread(target=lambda: res.setdefault("n", b.pull(wait=5)))
        th.start()
        time.sleep(0.3)
        ex = FakeExporter()
        ex.data["s9"] = record("s9", ("user", "x", True))
        a = self.syncer("laptop", ex)
        a.mark_dirty("s9")
        a.flush(force=True)
        th.join(4)
        self.assertEqual(res.get("n"), 1)

    def test_scan_pushes_recent(self):
        ex = FakeExporter()
        ex.data = {"a": record("a", ("user", "1", True)), "b": record("b", ("user", "2", True))}
        self.assertEqual(self.syncer("laptop", ex).scan(), 2)

    def test_bad_token(self):
        t = core.HttpTransport(self.url, "mauvais", "x")
        with self.assertRaises(core.TransportError):
            t.status()
        self.assertTrue(core.HttpTransport(self.url, "secret", "x").status()["protocol"] == core.PROTOCOL)


class TestSsh(Base):
    """« ssh » remplacé par un script qui exécute la commande distante en local."""

    def setUp(self):
        super().setUp()
        self.fake_ssh = self.dir / "fake-ssh"
        self.fake_ssh.write_text("#!/bin/sh\nfor last; do :; done\nexec sh -c \"$last\"\n")
        self.fake_ssh.chmod(self.fake_ssh.stat().st_mode | stat.S_IEXEC)
        os.environ["PYTHONPATH"] = PLUGINS + os.pathsep + os.environ.get("PYTHONPATH", "")
        self.master_cfg = self.dir / "master.json"
        mc = core.default_config()
        mc.update({"role": "master", "device": "master", "store": str(self.dir / "master")})
        self.master_cfg.write_text(json.dumps(mc))
        self.remote = "%s -m ctx_handover --config %s" % (sys.executable, self.master_cfg)

    def transport(self, name):
        return core.SshTransport("master-host", self.remote, name, str(self.fake_ssh), [])

    def test_push_pull_via_ssh(self):
        ex = FakeExporter()
        ex.data["s1"] = record("s1", ("user", "via ssh", True))
        a = core.Syncer(self.cfg("laptop"), exporter=ex, transport=self.transport("laptop"))
        a.mark_dirty("s1")
        self.assertEqual(a.flush(force=True), 1)
        b = core.Syncer(self.cfg("desktop"), exporter=FakeExporter(), transport=self.transport("desktop"))
        self.assertEqual(b.pull(), 1)
        self.assertEqual(b.state.list_mirror()[0]["origin"], "laptop")
        self.assertEqual(self.transport("x").status()["seq"], 1)

    def test_fanout_to_device(self):
        st = core.MasterStore(str(self.dir / "master"))
        st.ingest(core.make_bundle("laptop", "s1", record("s1", ("user", "fan-out", True))))
        dev_cfg = self.dir / "desk.json"
        dc = core.default_config()
        dc.update({"device": "desktop", "store": str(self.dir / "desktop")})
        dev_cfg.write_text(json.dumps(dc))
        cfg = {"ssh_binary": str(self.fake_ssh), "ssh_options": [],
               "devices": {"desktop": {"ssh": "desk-host", "command": "%s -m ctx_handover --config %s" % (sys.executable, dev_cfg)},
                           "laptop": {"ssh": "lap-host", "command": "false"}}}
        rep = core.fanout_once(st, cfg)
        self.assertEqual(rep["desktop"], "1 envoyée(s)")
        self.assertEqual(rep["laptop"], "0 envoyée(s)", "l'origine ne reçoit pas sa propre session")
        self.assertEqual(core.DeviceState(str(self.dir / "desktop")).list_mirror()[0]["session_id"], "s1")
        self.assertEqual(core.fanout_once(st, cfg)["desktop"], "0 envoyée(s)")


class TestExporterAndPlugin(Base):
    def test_cli_exporter(self):
        calls = []

        def runner(cmd, **kw):
            calls.append(cmd)
            Path(cmd[3]).write_text(record("s1", ("user", "x", True)))
            return subprocess.CompletedProcess(cmd, 0, "", "")
        ex = core.CliExporter("hermes", redact=True, runner=runner)
        self.assertIn('"s1"', ex.export("s1"))
        self.assertEqual(calls[0][:3], ["hermes", "sessions", "export"])
        self.assertIn("--session-id", calls[0])
        self.assertIn("--redact", calls[0])
        self.assertEqual([r[0] for r in ex.recent(0)], ["s1"])

    def test_register_with_fake_hermes(self):
        import ctx_handover as plugin
        os.environ["CTX_HANDOVER_CONFIG"] = str(self.dir / "cfg.json")
        (self.dir / "cfg.json").write_text(json.dumps({"role": "master", "store": str(self.dir / "st")}))

        class Ctx:
            def __init__(self):
                self.tools, self.hooks, self.commands, self.cli = {}, {}, {}, {}

            def register_tool(self, name, toolset, schema, handler):
                self.tools[name] = handler

            def register_hook(self, name, fn):
                self.hooks[name] = fn

            def register_command(self, name, fn, desc):
                self.commands[name] = fn

            def register_cli_command(self, name, help, setup, handler):
                self.cli[name] = handler
        c = Ctx()
        plugin.register(c)
        self.assertIn("handover_context", c.tools)
        self.assertIn("post_llm_call", c.hooks)
        self.assertIn("ctx_handover", c.cli)
        st = core.DeviceState(str(self.dir / "st"))
        st.put_mirror(core.make_bundle("laptop", "abc123", record("abc123", ("user", "Contrat", True)), "Analyse contrat"))
        self.assertIn("Analyse contrat", c.tools["handover_context"]({}))
        out = json.loads(c.tools["handover_context"]({"query": "contrat"}))
        self.assertTrue(out["success"])
        self.assertIn("Contrat", out["transcript"])
        self.assertIn("laptop", c.commands["handover"]("list"))
        del os.environ["CTX_HANDOVER_CONFIG"]


if __name__ == "__main__":
    unittest.main()
