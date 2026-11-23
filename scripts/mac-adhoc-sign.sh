#!/bin/sh
# Rend exécutable un bundle non signé (zip construit hors macOS) :
# retire la quarantaine et signe en ad hoc avec le codesign d'Apple.
#   sh scripts/mac-adhoc-sign.sh "/Applications/KostoLabs AI Cockpit.app"
set -e
APP="${1:-/Applications/KostoLabs AI Cockpit.app}"
[ -d "$APP" ] || { echo "Introuvable : $APP"; exit 1; }
xattr -cr "$APP"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict "$APP" && echo "Signé (ad hoc) : $APP"
