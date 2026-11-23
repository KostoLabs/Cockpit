# Journal des versions

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions sémantiques. Chaque version est taguée `vX.Y.Z` dans git.

## [0.8.0] — 2026-11-23 · Plugin ctx_handover

### Ajouté
- **Plugin Hermes `ctx_handover`** (`plugins/ctx_handover/`, Python standard) : synchro continue des sessions entre appareils via un master.
  - Côté appareil : hooks de fin de tour → export (`hermes sessions export` ou API server) → poussée dédupliquée par hash ; scan de rattrapage périodique.
  - Master : journal séquencé, dernière version par session, serveur HTTP à jeton avec **long-poll** (les autres appareils sont servis dès qu'une poussée arrive), TLS optionnel ; ou **SSH** (commandes distantes, fan-out du master vers les appareils).
  - Reprise : outil `handover_context` pour l'agent, commande `/handover [list|resume|push|status]`, CLI `hermes ctx_handover …` / `python3 -m ctx_handover …`, unités launchd et systemd pour le master.
  - 13 tests (HTTP et SSH de bout en bout, fan-out, long-poll, enregistrement dans un Hermes simulé).
- **Écran Synchro** du Cockpit : appareils et dernière poussée, sessions des autres appareils, lecture de la transcription, **Reprendre ici** (nouvelle session nourrie du contexte), état du plugin local, installation et configuration du plugin en un clic.
- Réglages : master de synchro (HTTP + jeton chiffré, ou SSH), nom de l'appareil, test.
- Test e2e avec un vrai master Python et deux appareils simulés.

## [0.7.0] — 2026-11-23 · Parité Hermes Desktop

### Ajouté
- **Tâches planifiées** (API Jobs) : liste avec planification, prochaine et dernière exécution, état ; création, modification, exécution immédiate, pause / reprise, suppression.
- **Capacités** : compétences par catégorie (`/v1/skills`) et jeux d'outils avec leur état (`/v1/toolsets`), filtre.
- **Messagerie** : conversations Telegram, Discord, Slack, WhatsApp, Signal… regroupées par plateforme, reprise dans le cockpit par dérivation.
- **Artefacts** : fichiers écrits par les outils et liens cités dans les sessions récentes, aperçu, ouverture, affichage dans le Finder.
- **Terminal** : exécution de commandes dans le shell de l'utilisateur, dossier au choix, sortie en continu, historique ↑/↓, interruption.
- **Revoir** (colonne Activité de E′) : statut Git, fichiers modifiés par portée **Non validé / Branche / Dernier tour** (instantané `git stash create` pris au début de chaque tour), diff, indexation, commit, commit et push, « Demander à Hermes ».
- Tests : revue Git sur dépôt temporaire, terminal et revue dans le test e2e (22 tests unitaires).

### Corrigé
- Alignement du tableau des tâches, champs de filtre au style du design system.

## [0.6.0] — 2026-11-23 · Écrans D′ et E′

### Ajouté
- Nouveau renderer fidèle aux maquettes **D′ Vue d'ensemble** et **E′ Dans un projet** (design system Fin) : trois colonnes séparées par des filets, index numéroté des projets, salutation selon l'heure, filtres soulignés.
- Données réelles partout : sessions regroupées par dossier de travail, état de chaque session (en cours, approbation, erreur, à relire), barre d'état branchée sur le gateway.
- Colonne « À traiter » : approbations (Approuver / Refuser), questions de l'agent, erreurs, réponses non lues ; sous-agents en direct ; tâches planifiées du jour.
- Projet : onglets de sessions (fermeture, ⌃Tab), vue côte à côte, chronologie des prompts, conversation en Markdown (rendu sans `innerHTML`), activité des outils, raisonnement repliable, approbations et questions en ligne, barre des sous-agents (Orienter, Arrêter), composer (historique ↑/↓, pièces jointes texte, glisser-déposer, choix du modèle par session, brouillons conservés), colonne Activité (outils du tour, session, ailleurs).
- Création, renommage, dérivation (« Reprendre ici » pour les sessions d'une autre surface) et suppression de sessions ; menu contextuel.
- Palette de commandes ⌘K, recherche dans la conversation ⌘F, arrêt du tour ⌘., notifications.
- Mode HUD (⇧⌘H) : fenêtre flottante toujours au premier plan avec une session et son composer.
- Réglages refaits : gateway (URL, profil, clé chiffrée, test avec les capacités annoncées), prénom, modèle par défaut, rafraîchissement, thème clair / sombre / système.
- Tests du renderer (Markdown, reducer, regroupement) : 19 tests au total.

## [0.5.0] — 2026-11-23 · Socle

Audit complet : [docs/AUDIT.md](docs/AUDIT.md).

### Ajouté
- `src/main/hermes-client.js` : client du gateway Hermes sur les routes documentées (`/api/sessions/{id}/messages`, API Runs avec approbations, clarifications, orientation et arrêt coopératif, tâches planifiées, skills, toolsets, catalogue de modèles), choix du transport par `/v1/capabilities` (runs → `chat/stream` → `chat/completions`).
- `src/main/sse.js` : parseur SSE complet (événements nommés, keepalive, CRLF, data multiligne).
- `src/main/settings.js` : réglages en liste blanche, écriture atomique, secrets chiffrés par safeStorage.
- Faux gateway Hermes (`tests/fake-gateway.js`) pour les tests et la démo hors ligne, 14 tests unitaires, test de fumée Electron (`tests/e2e/smoke.js`).
- Verrou d'instance unique, géométrie de fenêtre persistée, garde de navigation.

### Modifié
- Design system remplacé par **KostoLabs AI · Fin** (tokens, composants `Greeting`, `Overline`, `ProgressLine`).
- Polices Outfit 200–500, Inter 300–500, IBM Plex Mono 300–500 depuis `@fontsource/*` 5.3.0 épinglés.
- Electron 45.2.3 épinglé, preload sandboxé.
- `buildmac.py` et `icongen.py` déplacés dans `scripts/`.

### Supprimé
- `tests/test-pilote-hermes.js` (recopiait le pilote au lieu de le tester).

## [0.4.4] — 2026-11-22
Synchro des sessions Hermes en lecture (version de départ de l'audit).
