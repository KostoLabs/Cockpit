# KostoLabs AI — Cockpit Hermes

Application desktop Electron qui habille Hermes (l'agent de Nous Research) au design system KostoLabs AI. Vue d'ensemble des projets, projet ouvert avec session, éléments à traiter, sous-agents, barre d'état.

## Lancer

```bash
npm install
npm start        # production
npm run dev      # avec DevTools
```

Requiert Node 18+ et une plateforme supportée par Electron (macOS, Windows, Linux).

## Structure

```
main.js                    fenêtre, menu, réglages persistés, pilote Hermes (HTTP + SSE)
preload.js                 pont renderer <-> main : klai.hermes, klai.settings, événements
renderer/
  index.html               charge design-system + React UMD, sans build step
  app.js                   les trois écrans (vue d'ensemble, projet, réglages) et les mocks
design-system/             copie locale du design system KostoLabs AI
  tokens.css / tokens.json tokens du design system (source de vérité)
  fonts/fonts.css          polices locales (woff2 à ajouter)
  components/bundle.css   styles des composants KLAI
  components/bundle.js    window.KLAI : Logo, Icon, Button, StatusChip, Badge,
                          ProjectAvatar, NavItem, SearchField, Segmented,
                          ContextMeter, Panel
vendor/                    React 18.3.1 UMD
```

## Version v0.4.4 (synchro des sessions Hermes)

- Écrans « Vue d'ensemble », « Projet » et « Réglages Hermes », navigation entre les trois.
- Thème clair/sombre persisté dans `settings.json` (menu Affichage, raccourcis ⌘L/⌘D).
- Composants officiels du design system avec `index.d.ts`, polices locales (Fontsource, SIL OFL) : 100 % hors ligne.
- **Pilote Hermes** : le process main parle au gateway Hermes (API OpenAI-compatible, `http://127.0.0.1:8642/v1` par défaut, clé `API_SERVER_KEY`). Le renderer reste isolé (`contextIsolation`) et ne voit que l'ipc `klai.hermes`.
- Chat en streaming : `POST /v1/chat/completions` (SSE, `X-Hermes-Session-Id`, `Idempotency-Key`), deltas affichés en direct, bouton Arrêter (AbortController), `finish_reason` particuliers signalés.
- **Synchro des sessions réelles** : `GET /api/sessions`, `GET /api/projects` et `GET /api/session?session_id=…&messages=1` interrogés au lancement puis toutes les 30 s (et après chaque tour de chat). Les sessions sont groupées par projet, sinon par espace de travail, dans la navigation et la vue d'ensemble ; l'historique complet d'une session se charge à son ouverture.
- Sessions créées par une autre surface (CLI, TUI, bureau) : visibles en **lecture seule** (le gateway refuse l'écriture sur ces sessions, 409), avec notice et composer désactivé.
- Réglages (⌘,) : URL du backend, clé API, modèle, test de connexion. Persistés dans `settings.json` (userData).
- Sans backend, l'app démarre quand même : la vue d'ensemble affiche les données factices et le chat répond en mode démonstration. `node tests/test-pilote-hermes.js` valide le pilote SSE et les mappings de synchro sans Electron.

## Brancher Hermes

1. Dans `~/.hermes/.env` : `API_SERVER_ENABLED=true` et `API_SERVER_KEY=une-cle`.
2. Lancer `hermes gateway` (le port s'affiche, 8642 par défaut).
3. Lancer le cockpit : `npm start`, puis ⌘, pour renseigner URL et clé si besoin, « Tester la connexion ».

## Bundles macOS (v0.4.4)

Deux bundles prêts à glisser dans `/Applications` sont fournis : **mac-intel** (x64) et **mac-silicon** (arm64), app nommée « KostoLabs AI Cockpit », version 0.4.4, icône AppIcon générée depuis `design-system/logos/kl-app-icon.svg`.

- App non signée : au premier lancement, clic droit sur l'app puis « Ouvvrir », ou `xattr -dr com.apple.quarantine "KostoLabs AI Cockpit.app"`.
- macOS 10.15 ou plus récent (Electron 31).
- Pour reconstruire : `python3 buildmac.py <electron-darwin.zip> design-system/logos/AppIcon.icns . <sortie>.zip` (les symlinks du bundle sont recopiés directement dans le zip, jamais extraits sur disque).
- `python3 icongen.py <dossier>` régénère les PNG et l'ICNS à partir du SVG, sans dépendance.


## Prochaines étapes

1. Approbations : récepteur d'événements d'approbation du gateway dans le panneau « À traiter ».
2. Géométrie de fenêtre persistée.
3. Création de projet et sessions multiples côté cockpit (écrire, pas seulement lire).

© KostoLabs Company
