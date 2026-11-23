# KostoLabs AI — Cockpit Hermes

Application desktop Electron qui pilote [Hermes Agent](https://hermes-agent.nousresearch.com/) (Nous Research) au design system **KostoLabs AI · Fin** : plusieurs projets en parallèle, sessions, approbations, sous-agents.

Version courante : voir [CHANGELOG.md](CHANGELOG.md). Audit de départ : [docs/AUDIT.md](docs/AUDIT.md).

## Lancer

```bash
npm install      # dépendances, Electron 45, polices (postinstall)
npm start        # production
npm run dev      # avec DevTools
npm test         # tests unitaires (client Hermes, SSE)
```

Démo sans Hermes : `node tests/fake-gateway.js --port 8642` puis `npm start`.

## Brancher Hermes

1. Dans `~/.hermes/.env` : `API_SERVER_ENABLED=true` et `API_SERVER_KEY=une-cle`.
2. Lancer `hermes gateway` (port 8642 par défaut).
3. Dans le cockpit : ⌘, puis URL, clé et « Tester la connexion ». La clé est chiffrée dans le trousseau macOS.

## Structure

```
main.js                  fenêtres, menu, IPC (liste blanche), tours de conversation
preload.js               pont sandboxé : klai.hermes.*, klai.settings, klai.ext.*, klai.on
src/main/hermes-client.js client du gateway (sessions, runs, approbations, jobs, skills)
src/main/sse.js          parseur Server-Sent Events
src/main/settings.js     réglages persistés, secrets chiffrés
src/main/extensions.js   extensions main (HUD, git, terminal, synchro)
renderer/                interface React 18 (UMD, sans build)
design-system/           KostoLabs AI · Fin : tokens, composants window.KLAI, polices
tests/                   tests unitaires, faux gateway, test de fumée Electron (tests/e2e)
scripts/                 polices, icônes, packaging macOS
```

© KostoLabs Company
