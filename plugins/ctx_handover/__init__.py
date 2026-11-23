"""Plugin Hermes ctx_handover : les sessions d'un appareil partent en continu vers
un master, qui les redistribue aux autres appareils (HTTP long-poll ou SSH).

Dans le gateway Hermes :
- hooks post_llm_call / on_stream_end / on_session_end / on_session_finalize :
  la session touchée est marquée puis exportée et poussée (délai de 3 s) ;
- un scan périodique rattrape ce que les hooks n'ont pas signalé ;
- les sessions des autres appareils arrivent dans ~/.hermes/ctx_handover/device/mirror ;
- outil « handover_context » : l'agent peut relire une session d'un autre appareil ;
- commande « /handover [list|resume <id ou titre>|push|status] » ;
- sous-commande « hermes ctx_handover … » (voir cli.py).
"""
from __future__ import annotations

import json
import logging

from . import core

log = logging.getLogger("ctx_handover")
_SYNCER = None


def _session_id(args, kwargs) -> str:
    for k in ("session_id", "sessionId", "session"):
        v = kwargs.get(k)
        if isinstance(v, str) and v:
            return v
        if v is not None and getattr(v, "id", None):
            return str(v.id)
        if v is not None and getattr(v, "session_id", None):
            return str(v.session_id)
    for k in ("agent", "context", "ctx"):
        obj = kwargs.get(k)
        sid = getattr(obj, "session_id", None) if obj is not None else None
        if sid:
            return str(sid)
    try:  # variables de session liées par le gateway autour des hooks
        from gateway.session_context import get_session_env  # type: ignore
        env = get_session_env() or {}
        return str(env.get("HERMES_SESSION_ID") or env.get("session_id") or "")
    except Exception:  # noqa: BLE001
        return ""


def _on_turn(*args, **kwargs):
    if _SYNCER is None:
        return None
    sid = _session_id(args, kwargs)
    if sid:
        _SYNCER.mark_dirty(sid)
    return None


TOOL_SCHEMA = {
    "name": "handover_context",
    "description": ("Relit une conversation Hermes menée sur un autre appareil de l'utilisateur (synchronisée par ctx_handover). "
                    "Sans argument : liste les sessions disponibles (appareil, titre, date). Avec « query » (identifiant ou "
                    "fragment de titre) : renvoie la transcription pour reprendre le travail là où il s'est arrêté."),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "Identifiant de session ou fragment du titre."},
            "max_chars": {"type": "integer", "description": "Longueur maximale de la transcription (défaut 12000)."}
        }
    }
}


def _tool(params, **kwargs):
    cfg = core.load_config()
    state = core.DeviceState(cfg["store"])
    q = (params or {}).get("query") or ""
    if not q:
        rows = state.list_mirror()[:40]
        return json.dumps({"success": True, "sessions": [{k: r[k] for k in ("origin", "session_id", "title", "updated_at")} for r in rows]}, ensure_ascii=False)
    b = state.find_mirror(q)
    if not b:
        return json.dumps({"success": False, "error": "Aucune session synchronisée ne correspond à « %s »." % q}, ensure_ascii=False)
    return json.dumps({"success": True, "origin": b["origin"], "session_id": b["session_id"], "title": b.get("title"),
                       "transcript": core.transcript(b, int((params or {}).get("max_chars") or 12000))}, ensure_ascii=False)


def _command(ctx):
    def handler(arg_text="", session_key=None, session_id=None, **kwargs):
        cfg = core.load_config()
        state = core.DeviceState(cfg["store"])
        parts = (arg_text or "").strip().split(None, 1)
        sub = parts[0] if parts else "status"
        rest = parts[1] if len(parts) > 1 else ""
        if sub == "list":
            rows = state.list_mirror()[:20]
            if not rows:
                return "Aucune session reçue des autres appareils."
            return "\n".join("• {} — {} ({})".format(r["origin"], r["title"], r["session_id"]) for r in rows)
        if sub == "resume":
            b = state.find_mirror(rest)
            if not b:
                return "Aucune session synchronisée ne correspond à « %s »." % rest
            text = ("Contexte repris depuis l'appareil « {} » (session {}). Prends-en connaissance puis continue "
                    "le travail là où il s'est arrêté.\n\n{}").format(b["origin"], b["session_id"], core.transcript(b, 16000))
            try:
                ctx.inject_message(text, role="user", session_key=session_key)
                return "Contexte de « {} » injecté dans cette session.".format(b.get("title"))
            except Exception:  # noqa: BLE001 — surface sans injection : on rend le texte
                return text
        if sub == "push":
            if _SYNCER is None:
                return "Synchro inactive (rôle master ou plugin désactivé)."
            if session_id:
                _SYNCER.mark_dirty(session_id)
            return "{} session(s) poussée(s).".format(_SYNCER.flush(force=True))
        d = state.data
        return ("ctx_handover {} · appareil {} · rôle {} · transport {}\n"
                "poussées : {} · reçues : {} · curseur {} · dernière erreur : {}").format(
            core.VERSION, cfg["device"], cfg["role"], cfg["transport"], len(d["pushed"]), len(state.list_mirror()),
            d["cursor"], d["last_error"] or "aucune")
    return handler


def register(ctx):
    global _SYNCER
    ctx.register_tool(name="handover_context", toolset="ctx_handover", schema=TOOL_SCHEMA, handler=_tool)
    for hook in ("post_llm_call", "on_stream_end", "on_session_end", "on_session_finalize"):
        try:
            ctx.register_hook(hook, _on_turn)
        except Exception as e:  # noqa: BLE001 — hook absent dans cette version d'Hermes
            log.debug("hook %s indisponible : %s", hook, e)
    try:
        ctx.register_command("handover", _command(ctx), "Synchro des sessions entre appareils : list, resume <id>, push, status")
    except Exception as e:  # noqa: BLE001
        log.debug("commande indisponible : %s", e)
    try:
        from .cli import handle, setup_parser
        ctx.register_cli_command("ctx_handover", "Synchro des sessions entre appareils (master / devices)", setup_parser, handle)
    except Exception as e:  # noqa: BLE001
        log.debug("sous-commande CLI indisponible : %s", e)

    try:
        cfg = core.load_config()
    except Exception as e:  # noqa: BLE001
        log.warning("configuration illisible : %s", e)
        return
    if not cfg.get("enabled") or cfg.get("role") != "device" or _SYNCER is not None:
        return
    try:
        _SYNCER = core.Syncer(cfg, log=lambda *a: log.info(" ".join(str(x) for x in a)))
        _SYNCER.start()
        log.info("synchro démarrée : appareil %s", cfg["device"])
    except core.TransportError as e:
        log.warning("synchro inactive : %s (lancer « hermes ctx_handover init »)", e)
