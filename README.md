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
main.js                    fenêtre, menu, réglages persistés, câblage IPC du pilote
pilote.js                  pilote Hermes (HTTP + SSE) sans dépendance Electron, partagé avec les tests
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

## Version v0.5.0 (audit et reprise)

Audit complet après v0.4.4 : plusieurs éléments étaient cassés ou non branchés.

- **Pilote extrait dans `pilote.js`** (sans Electron) : `tests/test-pilote-hermes.js` teste désormais le code livré, contre un mock au format réel du gateway (`{object:'list', data:[…]}`, SSE nommé, 409, approbations).
- **Endpoints corrigés** : `GET /api/sessions?limit=200` (forme réelle `{data:[…]}`, tolère `{sessions:[…]}`), historique via `GET /api/sessions/{id}/messages` (repli `GET /api/session?session_id=…&messages=1`), `GET /api/jobs`, `POST /api/sessions` (création), `POST /api/sessions/{id}/fork`, `POST /v1/runs/{id}/approval`. `/api/projects` n'existe pas sur le gateway local (404 toléré).
- **Envoi natif** : `POST /api/sessions/{id}/chat/stream` (SSE nommé : `assistant.delta`, `tool.started/completed`, `approval.request`, `run.completed`, `done`), repli `/v1/chat/completions` + `X-Hermes-Session-Id` si 404/405. Les lignes `event:` sont parsées (progression d'outils, approbations affichées dans « À traiter » avec Approuver/Refuser).
- **409 `permission_denied`** (session CLI/TUI/messaging) : converti en événement `readonly`, composer désactivé avec notice, au lieu d'une erreur brute. La lecture seule se déduit aussi du champ `source`.
- **Nouvelle session fonctionnelle** : `POST /api/sessions` puis ouverture ; repli démo hors-ligne. Boutons branchés : Nouvelle session (barre + ⌘N + cartes), Réglages (⌘,), Ajouter un projet, Tous les projets, Côte à côte (fork), Session par carte.
- **Navigation réparée** : `KLAI.NavItem` ne propage pas `onClick` ; les items sont enveloppés. **Recherche** : ⌘K focus le champ et filtre les projets/sessions.
- **Données réelles dès que le backend répond** (même liste vide) ; le mode démo n'est montré que hors-ligne, et le chat répond en démo dans ce cas (auparavant : erreur 409/connrefused dans Electron).
- **Aside et barre d'état réels** : approbations en attente, sessions en cours, jobs planifiés (`/api/jobs`), outils du tour (SSE), contexte %, compteurs réels ; la frise chronologique reflète le nombre de messages.
- **Fenêtre** : géométrie (position/taille/maximisé) persistée dans `settings.json` et restaurée. **Thème** : `nativeTheme.themeSource` synchronisé (chrome de la fenêtre comprise).

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

1. Steer du tour en cours (`POST /v1/runs/{run_id}/steer`) depuis la barre sous-agent.
2. Pièges/renommage/suppression de sessions (PATCH/DELETE /api/sessions/{id}).
3. Piège de modèle par session (`POST /api/sessions/{id}/model`).

© KostoLabs Company
