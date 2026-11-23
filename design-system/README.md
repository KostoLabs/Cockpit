# KostoLabs AI · Fin

Proposition de design system « fin » pour KostoLabs AI, le studio de développement de Saiki. Même logo, même palette noir et blanc, même API de composants que le système KostoLabs AI ; l'écriture change : papier blanc, filets, typographie légère. Il habille le cockpit Hermes qui pilote les projets en parallèle (Koordo, GusAI, GenRes et les autres).

## Principes

- **Le papier, pas les panneaux.** Un seul fond, `canvas` (blanc). On ne pose pas de cartes : on sépare les zones et les lignes par des filets de 1px (`line`), et on ouvre un écran ou une liste importante par un filet fort (`rule`).
- **Léger partout.** Titres en Outfit 200–300, texte courant en Inter 300, intitulés de ligne en Inter 400. Le gras est réservé à l'élément actif.
- **Le mono pour l'ordre.** Surtitres en capitales espacées (`overline`), numéros d'index (01, 02…), chemins, compteurs et barre d'état en IBM Plex Mono.
- **Aucun aplat.** Les boutons sont des contours fins, les statuts un point et un mot, les jauges un filet de 2px. Le noir plein n'apparaît qu'au survol du bouton principal et dans la bulle de l'utilisateur.
- **La couleur signale, elle ne décore pas.** `attention` (ambre) et `danger` (rouge), en texte et en point uniquement.
- **De l'air.** Colonnes latérales en `space-6`, zone principale en `space-12`, lignes de liste de 10px de haut en bas.

## Logo

Inchangé : le symbole aux deux courbes qui se chevauchent, « KostoLabs » en Outfit 400 et « AI » en exposant, plus fin et plus petit. Dans ce système on l'emploie de préférence sans tuile (`KLAI.Logo variant="lockup-mark"`), aligné à gauche dans l'en-tête. Fichiers dans le groupe *Logos*.

## Couleurs

| Rôle | Tokens | Règle |
| --- | --- | --- |
| Fond | `canvas` (= `surface`) | Unique. `surface-muted` seulement pour un bloc de commande ou un survol. |
| Filets | `line`, `rule`, `line-control` | `line` entre les lignes et les colonnes ; `rule` sous le titre d'écran et en tête de la liste prioritaire ; `line-control` pour le contour d'un contrôle. |
| Texte | `ink`, `ink-muted`, `ink-subtle` | `ink-subtle` pour les surtitres et numéros, sur `canvas` uniquement. |
| États | `attention`, `danger` | Texte et point. Les variantes `-soft` restent disponibles pour un bandeau d'alerte, rarement. |
| Focus | `focus` | 2px de `canvas` puis 1px de `focus`. |

Statuts : *En cours* point plein `ink` ; *À valider* point `attention` ; *Erreur* point `danger` ; *Terminée* et *En veille* point creux `ink-muted`.

## Typographie

| Style | Police | Usage |
| --- | --- | --- |
| `display` 56/60 · 200 | Outfit | Couvertures |
| `greeting` 34/40 · 200 | Outfit | Salutation du tableau de bord |
| `title` 24/30 · 300 | Outfit | Nom de projet dans un index, titre de section |
| `body` 14/22 · 300 | Inter | Texte courant (15/24 pour les réponses de l'agent) |
| `item` 13.5/20 · 400 | Inter | Intitulé d'une ligne |
| `meta` 12.5/18 · 300 | Inter | Étape, contexte, métadonnées |
| `overline` 11/16 · 400, capitales, +0,08em | IBM Plex Mono | Surtitre de section |
| `mono` 12/18 · 300 | IBM Plex Mono | Chemins, branches, commandes, numéros, barre d'état |

Les trois familles viennent de Google Fonts :

```html
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@200;300;400&family=Inter:wght@300;400;500&family=IBM+Plex+Mono:wght@300;400;500&display=swap" rel="stylesheet">
```

## Salutation

Le tableau de bord s'ouvre sur une salutation tirée au hasard selon l'heure, à la manière d'un assistant : « Bonjour Quentin », « Session nocturne », « On reprend, Quentin ? »… Composant `KLAI.Greeting` (`name`, `size`, `hour` pour forcer un créneau, `seed` pour figer le tirage). Quatre créneaux (nuit avant 6 h et après 23 h, matin, après-midi, soir), quatre phrases chacun. Au-dessus, un `KLAI.Overline` rappelle où l'on est : « Vue d'ensemble · lundi 23 novembre ». Ton : court, complice, jamais de point d'exclamation ni d'emoji.

## Mise en page type : le cockpit

- En-tête de 72px : logo à gauche, recherche au centre (une simple ligne), *Nouvelle session* en bouton contour, filet `line` dessous.
- Trois colonnes séparées par des filets verticaux : navigation (248px), zone principale, *À traiter* (300–340px).
- Zone principale : surtitre, salutation, résumé en `meta`, filtres soulignés, filet `rule`, puis un **index numéroté** des projets : numéro mono, nom en `title`, chemin mono, puis les sessions en lignes (intitulé · étape · statut) séparées par `line`.
- Barre d'état en mono 11px sous un filet.

## Espacement et rayons

Échelle de 4px jusqu'à `space-16` (64). Rayons quasi nuls (`radius-sm` 2, `radius-md` 4) sauf les boutons et points en `radius-pill`.

## Iconographie

Icônes au trait 24×24, trait 1,25, en `currentColor` : composant `KLAI.Icon` (mêmes noms que KostoLabs AI). Pas d'emoji.

## Composants

`KLAI.Logo`, `KLAI.Icon`, `KLAI.Button`, `KLAI.StatusChip`, `KLAI.Badge`, `KLAI.ProjectAvatar`, `KLAI.NavItem`, `KLAI.SearchField`, `KLAI.Segmented`, `KLAI.ContextMeter`, `KLAI.Panel`, et trois nouveaux : `KLAI.Greeting`, `KLAI.Overline`, `KLAI.ProgressLine`. Même API que KostoLabs AI : un écran peut passer d'un système à l'autre en changeant les fichiers chargés.

Pour les utiliser : charger la feuille Google Fonts, `tokens.css`, `components/bundle.css`, puis React 18 et `components/bundle.js`, qui expose `window.KLAI`. Sur un canvas Design, lier `tokens.css`, `components/bundle.css` et `components/bundle.js` après la ligne `support.js` et monter les composants avec `x-import`.

## Ton éditorial

Français, phrases courtes, casse de phrase. Boutons en verbe (« Approuver », « Ouvrir »). Surtitres en capitales mono avec un tiret cadratin avant le compte (« À TRAITER — 3 »). Pas de point d'exclamation, pas d'emoji.
