# KostoLabs AI — Cockpit Hermes

Application macOS (Apple Silicon et Intel) qui pilote [Hermes Agent](https://hermes-agent.nousresearch.com/) au design system **KostoLabs AI · Fin** : plusieurs projets en parallèle, sessions, approbations, sous-agents, revue Git, tâches planifiées, et synchro des sessions entre vos appareils.

- Journal des versions : [CHANGELOG.md](CHANGELOG.md) · audit de départ : [docs/AUDIT.md](docs/AUDIT.md)
- Plugin de synchro : [plugins/ctx_handover/README.md](plugins/ctx_handover/README.md)

## Installer

Les DMG et ZIP **arm64** (Apple Silicon) et **x64** (Intel) sont produits par le workflow *Build macOS* (onglet Actions, artefact `KostoLabs-AI-Cockpit-mac`, et page Releases pour les tags `v*`).

1. Ouvrir le DMG de votre architecture, glisser **KostoLabs AI Cockpit** dans Applications.
2. Sans certificat Developer ID, l'app est signée en ad hoc : au premier lancement, clic droit → **Ouvrir**, ou `xattr -cr "/Applications/KostoLabs AI Cockpit.app"`.
3. Un ZIP construit hors macOS n'est pas signé : `sh scripts/mac-adhoc-sign.sh "/Applications/KostoLabs AI Cockpit.app"`.

macOS 12 ou plus récent. Pour une distribution signée et notarisée, renseigner les secrets du dépôt `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` : le workflow signe et notarise alors automatiquement.

## Brancher Hermes

1. `~/.hermes/.env` : `API_SERVER_ENABLED=true` et `API_SERVER_KEY=une-cle`.
2. `hermes gateway` (port 8642 par défaut).
3. Cockpit → ⌘, : URL, clé (chiffrée dans le trousseau), « Tester la connexion ».

Le cockpit lit les sessions de toutes les surfaces Hermes (CLI, TUI, Desktop, messagerie). Celles d'une autre surface sont en lecture seule — Hermes refuse qu'un autre client écrive dedans — et « Reprendre ici » les dérive dans le cockpit.

## Ce que fait l'app

| Écran | Contenu |
|---|---|
| Vue d'ensemble (D′) | Salutation, filtres, index numéroté des projets (sessions regroupées par dossier), À traiter (approbations, questions, erreurs, réponses à relire), sous-agents, agenda du jour |
| Projet (E′) | Onglets, côte à côte, chronologie, conversation Markdown, outils, raisonnement, approbations et questions en ligne, Orienter / Arrêter les sous-agents, composer (modèle par session, pièces jointes, historique), Activité : outils du tour, **Revoir** (Git : Non validé / Branche / Dernier tour, commit, push) |
| Capacités | Compétences et jeux d'outils du gateway |
| Messagerie | Conversations Telegram, Discord, Slack… par plateforme |
| Artefacts | Fichiers écrits et liens cités, aperçu, Finder |
| Tâches planifiées | Routines du planificateur Hermes : créer, exécuter, pause, supprimer |
| Terminal | Commandes dans votre shell, dossier au choix |
| Synchro | Appareils, sessions des autres appareils, lecture, reprise ici, installation du plugin `ctx_handover` |
| HUD (⇧⌘H) | Fenêtre flottante toujours au premier plan |

Raccourcis : ⌘K palette, ⌘N nouvelle session, ⌘F rechercher, ⌘. arrêter, ⌘W fermer l'onglet, ⌃⇥ onglet suivant, ⌘1–4 écrans, ⌘, réglages.

## Développer

```bash
npm install          # Electron 45, polices (postinstall)
npm run dev          # avec DevTools
node tests/fake-gateway.js --port 8642   # faux gateway Hermes pour travailler sans agent
npm test             # 22 tests : client Hermes, SSE, renderer, Git
npm run test:plugin  # 13 tests du plugin ctx_handover
xvfb-run -a npm run e2e -- /tmp/captures   # parcours complet de l'app réelle (SMOKE_STEPS=overview,project,chat,review,term,sync)
npm run dist:mac     # DMG + ZIP arm64/x64 (sur macOS ; hors macOS : npm run dist:mac:zip)
```

```
main.js                   fenêtres, menu, HUD, IPC sur liste blanche, tours de conversation
preload.js                pont sandboxé : klai.hermes.*, klai.ext.*, klai.settings, klai.on
src/main/hermes-client.js client du gateway : sessions, runs (approbations, stop, steer), jobs, skills
src/main/sse.js           parseur Server-Sent Events
src/main/settings.js      réglages, secrets via safeStorage
src/main/git.js           revue Git (instantané de début de tour)
src/main/terminal.js      exécuteur de commandes
src/main/sync.js          pont vers ctx_handover (master HTTP/SSH, miroir local)
renderer/                 React 18 sans build : lib/ (état, Markdown), components/, screens/
design-system/            KostoLabs AI · Fin : tokens, composants window.KLAI, polices, logos
plugins/ctx_handover/     plugin Hermes de synchro des sessions entre appareils
build/                    entitlements, signature ad hoc (afterPack)
.github/workflows/        build macOS arm64 + x64, release sur tag
```

© KostoLabs Company
