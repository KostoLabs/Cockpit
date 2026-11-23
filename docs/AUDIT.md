# Audit du dépôt Cockpit — état v0.4.4 (23 novembre 2026)

Périmètre : `main.js`, `preload.js`, `renderer/`, `design-system/`, `tests/`, `buildmac.py`, `icongen.py`, scripts. Référentiels : maquettes D′ et E′ et planche d'identité du canvas *Hermes Desktop — Refonte UI*, design system *KostoLabs AI · Fin*, doc officielle Hermes Agent (Desktop, API server, sessions, plugins).

Légende : 🔴 bloquant · 🟠 important · 🟡 à améliorer. La colonne *Statut* indique la version qui corrige.

## 1. Intégration Hermes (pilote réseau)

| # | Constat | Gravité | Statut |
|---|---|---|---|
| H1 | L'historique est lu sur `GET /api/session?session_id=…&messages=1`, route absente de la doc. L'API documentée est `GET /api/sessions/{id}/messages` (avec `inline_images=false` pour un client distant). | 🔴 | v0.5.0 (route documentée, l'ancienne gardée en repli) |
| H2 | Les tours passent par `/v1/chat/completions` (+ `X-Hermes-Session-Id`), qui ne transporte ni approbations, ni sous-agents, ni arrêt coopératif. L'API **Runs** (`POST /v1/runs`, `GET /v1/runs/{id}/events`, `/stop`, `/approval`, `/clarify`, `/steer`) est faite pour un client riche. | 🔴 | v0.5.0 (runs → `chat/stream` → `chat/completions`, choisi via `/v1/capabilities`) |
| H3 | Aucune approbation possible : le panneau « À traiter » et ses boutons Approuver/Refuser sont des maquettes. | 🔴 | v0.6.0 |
| H4 | Le bouton Arrêter coupe seulement le flux local (AbortController) : l'agent continue côté gateway. | 🟠 | v0.5.0 (`POST /v1/runs/{id}/stop`, coupure locale en filet après 8 s) |
| H5 | Les événements nommés (`event: tool.started`, `hermes.tool.progress`…) sont ignorés : le parseur ne lit que les lignes `data:`. Pas de CRLF, pas de data multiligne. | 🟠 | v0.5.0 (`src/main/sse.js`) |
| H6 | Le code 409 `permission_denied` (session tenue par CLI/TUI/Desktop/messagerie) n'est pas interprété ; la lecture seule repose sur des champs non documentés (`read_only`, `is_cli_session`). | 🟠 | v0.5.0 (déduit de `source`, 409 traduit en lecture seule) |
| H7 | `GET /api/projects` n'est pas une route de l'API server : l'appel échoue silencieusement. Les sessions doivent être regroupées par dossier de travail (`cwd`). | 🟡 | v0.5.0 (appel toléré, regroupement par `cwd`) |
| H8 | Pas de création de session côté cockpit : « Nouvelle session » réutilise un id fixe `cockpit-accueil`. | 🟠 | v0.6.0 (`POST /api/sessions`) |
| H9 | Tâches planifiées, capacités (skills/toolsets), catalogue de modèles (`/api/model/options`) non branchés. | 🟠 | v0.7.0 |

## 2. Sécurité Electron

| # | Constat | Gravité | Statut |
|---|---|---|---|
| S1 | `sandbox: false` alors que le preload n'utilise que `contextBridge`/`ipcRenderer`. | 🟠 | v0.5.0 (`sandbox: true`) |
| S2 | Clé API Hermes stockée en clair dans `settings.json` et renvoyée au renderer par `settings:get`. | 🟠 | v0.5.0 (safeStorage / trousseau macOS, le renderer ne voit que `hasApiKey`, migration automatique) |
| S3 | Pas de garde de navigation : un lien dans une réponse de l'agent peut remplacer la page de l'app. | 🟠 | v0.5.0 (`will-navigate` + `setWindowOpenHandler`, liens externes vers le navigateur) |
| S4 | `settings:set` accepte n'importe quelle clé. | 🟡 | v0.5.0 (liste blanche) |
| S5 | Écriture de `settings.json` non atomique, permissions par défaut. | 🟡 | v0.5.0 (fichier temporaire + rename, mode 0600) |
| S6 | Pas de verrou d'instance unique. | 🟡 | v0.5.0 |

## 3. Design system et fidélité aux maquettes

| # | Constat | Gravité | Statut |
|---|---|---|---|
| D1 | Le dépôt embarque l'ancien système *KostoLabs AI* (canvas gris, cartes, aplats) ; les maquettes D′/E′ utilisent *KostoLabs AI · Fin* (papier blanc, filets, typographie légère, `Greeting`, `Overline`, `ProgressLine`). | 🔴 | v0.5.0 (tokens, bundle, types copiés du système Fin) |
| D2 | Graisses manquantes : Outfit 200 et Inter/Plex Mono 300 ne sont pas déclarées, les titres légers retombent en 400. | 🟠 | v0.5.0 |
| D3 | Polices téléchargées depuis jsDelivr en `@latest` (non reproductible, réseau requis). | 🟡 | v0.5.0 (paquets `@fontsource/*` épinglés, copie au `postinstall`) |
| D4 | Mise en page v0.4 en cartes et panneaux arrondis ; D′/E′ demandent trois colonnes séparées par des filets, index numéroté, onglets soulignés, chronologie à points. | 🔴 | v0.6.0 |
| D5 | Barre d'état codée en dur (« 6 sessions en cours », `d923a5e`) ; sous-agents, « À traiter », « Aujourd'hui », « Outils de ce tour », « Ailleurs » sont des mocks même avec un gateway connecté. | 🟠 | v0.6.0 |
| D6 | Réponses de l'agent affichées en texte brut (`pre-wrap`) : pas de Markdown (titres, listes, code). | 🟠 | v0.6.0 (rendu Markdown sans `innerHTML`) |

## 4. Qualité, tests, livraison

| # | Constat | Gravité | Statut |
|---|---|---|---|
| Q1 | Le test `tests/test-pilote-hermes.js` **recopie** le code du pilote au lieu de l'importer : il peut passer alors que l'app est cassée. | 🟠 | v0.5.0 (module `src/main/hermes-client.js` testé directement, 14 tests, faux gateway réutilisable) |
| Q2 | Tout le main dans un fichier, réseau mêlé à Electron : rien n'est testable hors Electron. | 🟡 | v0.5.0 (`src/main/*`) |
| Q3 | Pas de test de bout en bout de l'app. | 🟡 | v0.5.0 (`tests/e2e/smoke.js`, Playwright + Electron + faux gateway) |
| Q4 | `electron ^31` : version en fin de support, plage non épinglée. | 🟠 | v0.5.0 (Electron 45.2.3 épinglé) |
| Q5 | Packaging macOS manuel (zip Electron fourni à la main), version codée en dur dans `buildmac.py`, app non signée, pas de CI. | 🟠 | v1.0.0 |
| Q6 | Géométrie de fenêtre non persistée. | 🟡 | v0.5.0 |
| Q7 | README : coquille « Ouvvrir », section structure obsolète. | 🟡 | v0.5.0 |

## 5. Couverture fonctionnelle par rapport à Hermes Desktop

Hermes Desktop (doc officielle) : chat en streaming avec activité des outils, onglets et fenêtres multiples, chronologie de conversation, recherche dans la page, barre d'état (YOLO, contexte, modèle, approbations), sélecteur de modèle et d'effort, sous-agents en direct (Orienter / Arrêter), revue Git (Non validé / Branche / Dernier tour), worktrees, terminal, explorateur de fichiers, artefacts, tâches planifiées, capacités (skills, toolsets, MCP), messagerie, profils, HUD, palette de commandes, réglages, connexion à un gateway distant.

| Fonction | v0.4.4 | Cible |
|---|---|---|
| Chat streaming + outils | partiel (texte seul) | v0.6.0 |
| Approbations / clarifications | non | v0.6.0 |
| Sous-agents (Orienter / Arrêter) | maquette | v0.6.0 |
| Onglets de sessions, chronologie | maquette | v0.6.0 |
| Palette ⌘K, recherche ⌘F | non | v0.6.0 |
| Création / renommage / fork / suppression de session | non | v0.6.0 |
| Tâches planifiées | non | v0.7.0 |
| Capacités (skills, toolsets) | non | v0.7.0 |
| Messagerie (sessions des plateformes) | non | v0.7.0 |
| Artefacts | non | v0.7.0 |
| Revue Git | maquette | v0.7.0 |
| Terminal | non | v0.7.0 (exécuteur de commandes ; un vrai PTY demande un module natif, hors périmètre) |
| HUD | non | v0.7.0 |
| Profils / gateway distant | URL seule | v0.7.0 (profil `/p/<profil>/`) |
| Synchro des sessions entre appareils | non | v0.8.0 (plugin `ctx_handover`) |
| Bots, Memory Graph, voix, worktrees, Quick Entry | non | hors périmètre : renvoi vers Hermes Desktop |
