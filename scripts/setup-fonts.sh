#!/bin/sh
# Télécharge les polices Fontsource (SIL OFL) référencées par fonts.css.
# Les woff2 ne sont pas versionnés : lancez ce script après le clonage.
set -e
cd "$(dirname "$0")/../design-system/fonts"

fetch() {
  fam="$1"; weight="$2"; file="$3"
  url="https://cdn.jsdelivr.net/fontsource/fonts/${fam}@latest/latin-${weight}-normal.woff2"
  echo "→ $file"
  curl -fL --retry 3 -o "$file" "$url"
  # signature wOF2 attendue en tête de fichier
  head -c 4 "$file" | grep -q "wOF2" || { echo "signature invalide pour $file"; exit 1; }
}

fetch inter 400          inter-latin-400-normal.woff2
fetch inter 500          inter-latin-500-normal.woff2
fetch inter 600          inter-latin-600-normal.woff2
fetch ibm-plex-mono 400 ibm-plex-mono-latin-400-normal.woff2
fetch ibm-plex-mono 500 ibm-plex-mono-latin-500-normal.woff2
fetch outfit 200         outfit-latin-200-normal.woff2
fetch outfit 300         outfit-latin-300-normal.woff2
fetch outfit 400         outfit-latin-400-normal.woff2
fetch outfit 500         outfit-latin-500-normal.woff2

echo "Polices installées."
