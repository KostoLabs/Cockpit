# KostoLabs AI Cockpit

Application macOS qui pilote [Hermes Agent](https://hermes-agent.nousresearch.com/) (Nous Research) : plusieurs projets en parallèle, sessions, approbations, sous-agents, revue Git, tâches planifiées et synchro des sessions entre vos appareils. Interface au design system **KostoLabs AI · Fin**.

Disponible pour Mac **Apple Silicon** (M1 et suivants) et **Intel**, macOS 12 ou plus récent.

---

## Installer

### 1. Télécharger

Sur la page [**Releases**](https://github.com/KostoLabs/Cockpit/releases) du dépôt, prenez le DMG de votre Mac :

| Votre Mac | Fichier |
|---|---|
| Puce Apple (M1, M2, M3, M4…) | `KostoLabs-AI-Cockpit-<version>-mac-arm64.dmg` |
| Processeur Intel | `KostoLabs-AI-Cockpit-<version>-mac-x64.dmg` |

Pour savoir lequel prendre : menu  → *À propos de ce Mac* → ligne *Puce* ou *Processeur*.

### 2. Installer

Ouvrez le DMG et glissez **KostoLabs AI Cockpit** dans le dossier **Applications**.

Tant que les runners macOS ne sont pas activés sur le dépôt, la page Releases propose une **pré-version en ZIP** (`…-mac-arm64.zip` ou `…-mac-x64.zip`), construite sans Mac et donc non signée. Décompressez-le, glissez l'app dans **Applications**, puis signez-la une fois sur votre Mac :

```bash
xattr -cr "/Applications/KostoLabs AI Cockpit.app"
codesign --force --deep --sign - "/Applications/KostoLabs AI Cockpit.app"
```

### 3. Premier lancement

Tant que l'app n'est pas signée avec un certificat Apple Developer ID, macOS la bloque au premier lancement. Ouvrez-la une première fois, puis au choix :

- **Réglages Système → Confidentialité et sécurité**, en bas : *KostoLabs AI Cockpit a été bloquée* → **Ouvrir quand même** ;
- ou dans le Terminal :

  ```bash
  xattr -cr "/Applications/KostoLabs AI Cockpit.app"
  ```

Les lancements suivants sont normaux.

---

## Brancher Hermes

Le Cockpit parle au **gateway Hermes** (son API server).

1. Dans `~/.hermes/.env`, activez l'API :

   ```bash
   API_SERVER_ENABLED=true
   API_SERVER_KEY=choisissez-une-cle
   ```

2. Lancez le gateway :

   ```bash
   hermes gateway
   ```

3. Dans le Cockpit, ouvrez les réglages (**⌘,**), renseignez l'URL (`http://127.0.0.1:8642` par défaut) et la clé, puis **Tester la connexion**. La clé est rangée dans le trousseau macOS.

Le Cockpit affiche les sessions de toutes les surfaces Hermes : CLI, TUI, Hermes Desktop, Telegram, Discord…

Quand le gateway tourne sur le même Mac, le Cockpit :
- lit vos **projets** et le dossier de chaque session dans `~/.hermes` (lecture seule), comme Hermes Desktop ;
- **écrit dans les sessions Hermes Desktop**, CLI et messagerie en passant par le gateway partagé (`hermes gateway attach`), avec approbations, arrêt et choix du modèle.

Ces deux fonctions se règlent dans Réglages → *Hermes local* (dossier Hermes, chemin de la commande `hermes`). Avec un gateway distant, les sessions des autres surfaces restent en lecture seule ; **Reprendre ici** les dérive dans le Cockpit.

---

## Synchroniser les sessions entre vos Mac

Le plugin **ctx_handover** envoie en continu les sessions de chaque Mac vers un **master** (un Mac toujours allumé, un serveur, un VPS), qui les redistribue aux autres. Vous reprenez sur le MacBook ce que vous avez commencé sur le Mac Studio.

**Sur le master** (Hermes n'y est pas nécessaire, Python 3 suffit) :

```bash
PYTHONPATH=/chemin/vers/Cockpit/plugins python3 -m ctx_handover init --role master
PYTHONPATH=/chemin/vers/Cockpit/plugins python3 -m ctx_handover serve --host 0.0.0.0
```

`init` affiche un **jeton** à garder. Rendez le master joignable par Tailscale, un tunnel SSH ou en HTTPS (`--tls-cert`, `--tls-key`) ; n'ouvrez pas le port en clair sur Internet.

**Sur chaque Mac**, dans le Cockpit :

1. Réglages → *Synchro des sessions* : activez, renseignez l'URL du master et le jeton (ou une cible SSH), **Tester le master**.
2. Écran **Synchro** → **Installer sur cet appareil**.
3. Dans un terminal : `hermes plugins enable ctx_handover`, puis redémarrez `hermes gateway`.

L'écran Synchro liste alors les appareils et leurs sessions ; **Lire** affiche une conversation, **Reprendre** ouvre une session ici avec tout son contexte. Dans une conversation Hermes, `/handover resume <titre>` fait la même chose. Détails, transport SSH et options : [plugins/ctx_handover/README.md](plugins/ctx_handover/README.md).

---

## Utiliser

| Écran | Ce qu'on y fait |
|---|---|
| **Vue d'ensemble** | Projets actifs (sessions regroupées par dossier), filtres, colonne *À traiter* : approbations, questions de l'agent, erreurs, réponses à relire ; sous-agents en cours ; tâches du jour |
| **Projet** | Sessions en onglets ou côte à côte, conversation, outils utilisés, approbations, sous-agents (*Orienter*, *Arrêter*), choix du modèle, pièces jointes ; colonne *Activité* avec la revue Git (*Non validé*, *Branche*, *Dernier tour*, commit, push) |
| **Capacités** | Compétences et outils dont dispose Hermes |
| **Messagerie** | Conversations venues de Telegram, Discord, Slack… |
| **Artefacts** | Fichiers écrits et liens cités par l'agent |
| **Tâches planifiées** | Routines du planificateur : créer, exécuter, mettre en pause, supprimer |
| **Terminal** | Commandes dans votre shell, dans le dossier d'un projet |
| **Synchro** | Sessions de vos autres Mac |
| **HUD** | Petite fenêtre flottante, toujours au premier plan |

| Raccourci | Action |
|---|---|
| ⌘K | Palette : aller à un projet, une session, une commande |
| ⌘N | Nouvelle session |
| ⌘F | Rechercher dans la conversation |
| ⌘. | Arrêter le tour en cours |
| ⌘W | Fermer l'onglet |
| ⌃⇥ | Onglet suivant |
| ⇧⌘H | Mode HUD |
| ⌘1 à ⌘4 | Vue d'ensemble, Tâches, Capacités, Synchro |
| ⌘, | Réglages |

---

## Publier une version (mainteneurs)

Le workflow **Build macOS** a deux voies :

- `mac-zip` (runner Linux, toujours disponible) : à chaque push sur `Live` ou une branche `claude/…`, construit les ZIP arm64 et x64 non signés et les publie en **pré-version** `v<version>` ;
- `mac` (runner macOS) : construit les DMG et ZIP signés et publie la release définitive quand on pousse un tag `v*`.

1. **Une seule fois** : autoriser les runners macOS pour le dépôt (*Settings → Actions* de l'organisation, et un budget Actions qui couvre macOS pour un dépôt privé), puis créer la variable de dépôt `MAC_RUNNERS` = `true` (*Settings → Secrets and variables → Actions → Variables*). Sans elle, le job `mac` est ignoré.
2. Mettre à jour `version` dans `package.json` et `CHANGELOG.md`, fusionner dans `Live`.
3. Taguer et pousser :

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

Le workflow lance les tests, construit les DMG et ZIP arm64 et x64, vérifie les architectures et les signatures, puis crée la release avec les notes du CHANGELOG.

**Signature Apple** (supprime l'étape « Ouvrir quand même ») : ajouter les secrets du dépôt `MAC_CERT_P12_BASE64` (certificat Developer ID Application en base64), `MAC_CERT_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` et `APPLE_TEAM_ID`. Le workflow signe et notarise alors automatiquement ; sans eux, l'app est signée en ad hoc.

**Sans GitHub Actions**, sur un Mac : `npm install && npm run dist:mac` produit les mêmes fichiers dans `dist/`. Un ZIP construit sous Linux (`npm run dist:mac:zip`) n'est pas signé : après l'avoir décompressé dans Applications, lancez `sh scripts/mac-adhoc-sign.sh`.

---

## Développer

Node.js 20 ou plus récent.

```bash
npm install                               # Electron, polices
npm run dev                               # l'app, avec les outils de développement
node tests/fake-gateway.js --port 8642    # faux gateway Hermes pour travailler sans agent
npm test                                  # tests : client Hermes, renderer, Git
npm run test:plugin                       # tests du plugin ctx_handover
xvfb-run -a npm run e2e -- /tmp/captures  # parcours complet de l'app (Linux)
```

```
main.js                   fenêtres, menu, HUD, échanges avec l'interface
preload.js                pont sécurisé entre l'interface et le reste de l'app
src/main/                 client Hermes, réglages, revue Git, terminal, synchro
renderer/                 interface (React 18, sans étape de build)
design-system/            KostoLabs AI · Fin : couleurs, composants, polices, logos
plugins/ctx_handover/     plugin Hermes de synchro des sessions
build/                    signature et droits de l'app macOS
.github/workflows/        build macOS et publication des releases
```

Historique des versions : [CHANGELOG.md](CHANGELOG.md) · audit de la version de départ : [docs/AUDIT.md](docs/AUDIT.md).

© KostoLabs Company
