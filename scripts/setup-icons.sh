#!/bin/sh
# Génère AppIcon.icns et les PNG de l'icône applicative à partir du SVG source
# (design-system/logos/kl-app-icon.svg). Les binaires ne sont pas versionnés :
# lancez ce script après le clonage. Requiert python3 (stdlib uniquement).
set -e
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
python3 icongen.py "$tmp"
cp "$tmp/AppIcon.icns"   design-system/logos/AppIcon.icns
cp "$tmp/icon_256.png"   design-system/logos/icon_256.png
cp "$tmp/icon_1024.png"  design-system/logos/icon_1024.png
rm -rf "$tmp"

echo "Icônes générées dans design-system/logos/."
