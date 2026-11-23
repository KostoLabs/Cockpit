# Journal des versions

Format : [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), versions sémantiques. Chaque version est taguée `vX.Y.Z` dans git.

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
