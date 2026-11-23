# ctx_handover — synchro continue des sessions Hermes entre appareils

Plugin Hermes Agent (bibliothèque standard Python, aucune dépendance). Chaque appareil pousse ses sessions vers un **master** dès qu'un tour se termine ; le master les journalise et les **redistribue** aux autres appareils. Sur n'importe quel appareil, on reprend le travail commencé ailleurs.

```
 MacBook Air ──push──▶ ┌────────┐ ──push──▶ Mac mini
                       │ master │
 Mac Studio  ──push──▶ └────────┘ ──push──▶ MacBook Air, Mac Studio…
          HTTP(S) avec jeton (long-poll) ou SSH (fan-out)
```

## Fonctionnement

| Côté | Ce qui se passe |
|---|---|
| Appareil | Les hooks `post_llm_call`, `on_stream_end`, `on_session_end`, `on_session_finalize` marquent la session ; 3 s plus tard elle est exportée (`hermes sessions export --session-id`, ou l'API server avec `"exporter": "api"`) et poussée si son contenu a changé (hash SHA-256). Un scan toutes les 20 s rattrape ce que les hooks n'ont pas signalé. |
| Master | Garde la dernière version de chaque session (`master/sessions/<appareil>/<session>.json`) et un journal séquencé (`master/journal.jsonl`). Une version identique n'est jamais rejournalisée. |
| Redistribution HTTP | Chaque appareil garde une requête `GET /v1/changes?since=<curseur>&wait=25` ouverte : le master y répond **dès** qu'une autre machine pousse. C'est un push sans port ouvert côté appareils. |
| Redistribution SSH | `ctx_handover serve --fanout` ou `ctx_handover fanout --watch` : le master se connecte à chaque appareil déclaré et lui envoie les versions manquantes (`… receive`). Les appareils peuvent aussi tirer eux-mêmes (`pull`) via SSH. |
| Réception | Les sessions des autres appareils arrivent dans `~/.hermes/ctx_handover/device/mirror/<appareil>/` (bundle JSON + transcription Markdown). Un appareil ne reçoit jamais ses propres sessions. |
| Reprise | Outil **`handover_context`** (l'agent relit une session d'un autre appareil quand on lui dit « reprends ce que j'ai fait sur le MacBook »), commande **`/handover resume <id ou titre>`** (injecte la transcription dans la session courante), bouton **Reprendre ici** du Cockpit. |

Les sessions reçues sont des **miroirs** : la session d'origine reste la propriété de son appareil (comme Hermes le fait déjà entre surfaces). Si une future version de Hermes expose un import en ligne de commande, `"import_command": "hermes sessions import … {file}"` l'appelle pour chaque session reçue.

## Installation

Sur chaque appareil (ou depuis le Cockpit : Synchro → *Installer sur cet appareil*) :

```bash
cp -R plugins/ctx_handover ~/.hermes/plugins/
hermes plugins enable ctx_handover
```

### Master en HTTP

Sur le master (un Mac toujours allumé, un serveur, un VPS) — Hermes n'y est pas nécessaire :

```bash
PYTHONPATH=/chemin/vers/plugins python3 -m ctx_handover init --role master
PYTHONPATH=/chemin/vers/plugins python3 -m ctx_handover serve --host 0.0.0.0 --port 8765
```

`init` affiche le jeton à copier sur les appareils. Exposez le port via Tailscale, un tunnel SSH, ou ajoutez `--tls-cert cert.pem --tls-key key.pem` ; n'exposez jamais le port en clair sur Internet.

Sur chaque appareil :

```bash
hermes ctx_handover init --master-url http://master.tailnet:8765 --token <jeton>
hermes gateway restart
```

### Master en SSH

Aucun port à ouvrir : il suffit d'une clé SSH sans mot de passe vers le master (et, pour le fan-out, du master vers les appareils).

```bash
# appareil
hermes ctx_handover init --transport ssh --ssh-target quentin@master --ssh-command "PYTHONPATH=~/ctx/plugins python3 -m ctx_handover"
# master : ~/.hermes/ctx_handover.json → "role": "master", "devices": {"macbook-air": {"ssh": "quentin@macbook-air", "command": "hermes ctx_handover"}}
PYTHONPATH=~/ctx/plugins python3 -m ctx_handover fanout --watch
```

## Commandes

| Commande | Rôle |
|---|---|
| `init` | Crée ou complète `~/.hermes/ctx_handover.json` (`--role`, `--device`, `--transport`, `--master-url`, `--token`, `--gen-token`, `--ssh-target`, `--exporter`). |
| `serve [--fanout]` | Master : serveur HTTP (`/v1/push`, `/v1/changes`, `/v1/sessions`, `/v1/status`). |
| `fanout [--watch]` | Master : poussée SSH vers les appareils déclarés. |
| `push [--session ID] [--scan]` | Appareil : pousse maintenant. |
| `pull [--wait 25]` | Appareil : récupère les nouveautés. |
| `daemon` | Appareil : synchro continue hors du gateway (launchd, systemd). |
| `list`, `show <id ou titre>` | Appareil : sessions reçues, transcription. |
| `status [--json]` | État local et du master. |
| `ingest`, `changes`, `get`, `receive` | Plomberie utilisée par le transport SSH. |

Dans une conversation : `/handover`, `/handover list`, `/handover resume <id>`, `/handover push`.

## Configuration (`~/.hermes/ctx_handover.json`)

| Clé | Défaut | Rôle |
|---|---|---|
| `role` | `device` | `device` ou `master` |
| `device` | nom de la machine | identifiant de l'appareil |
| `transport` | `http` | `http` ou `ssh` |
| `master_url`, `token` | | master HTTP (jeton aussi via `CTX_HANDOVER_TOKEN`) |
| `ssh_target`, `ssh_command`, `ssh_options` | | master SSH |
| `devices` | `{}` | master : appareils joignables en SSH pour le fan-out |
| `exporter` | `cli` | `cli` (`hermes sessions export`) ou `api` (`api_url`, `api_key`) |
| `redact` | `false` | exporte avec `--redact` (clés et jetons masqués) |
| `interval`, `debounce`, `long_poll` | 20, 3, 25 | cadences (secondes) |
| `import_command` | | commande appelée pour chaque session reçue (`{file}`) |

## Sécurité

- Le jeton est comparé en temps constant ; le fichier de configuration est écrit en 0600.
- Les noms d'appareil et de session sont assainis avant tout accès disque (pas de `..`, pas de séparateur).
- Les bundles sont limités à 32 Mo et vérifiés par hash.
- Les sessions contiennent tout l'historique, y compris les sorties d'outils : activez `redact` si elles peuvent contenir des secrets, et ne placez le master que sur une machine de confiance.

## Tests

```bash
python3 -m unittest discover -s plugins/ctx_handover/tests -t plugins
```

13 tests : stockage et déduplication, long-poll, bout en bout HTTP (deux appareils), bout en bout SSH avec un faux `ssh`, fan-out, exporteur CLI, enregistrement dans un Hermes simulé.
