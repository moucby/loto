#!/usr/bin/env bash
# Publie l'appli Loto sur le VPS (à lancer depuis Git Bash sur le PC).
#   ./deploiement/publier.sh utilisateur@adresse-du-vps
# Envoie uniquement les fichiers de l'appli dans /var/www/loto (Nginx sert ce dossier).
set -euo pipefail

CIBLE="${1:?Usage : ./deploiement/publier.sh utilisateur@adresse-du-vps}"
DOSSIER_DISTANT=/var/www/loto
ARCHIVE="$(mktemp -d)/loto.tgz"

cd "$(dirname "$0")/.."
FICHIERS=(index.html styles.css app.js scan.js multi.js sw.js manifest.webmanifest icon.svg fonts vendor)

echo "→ Préparation de l'archive"
tar -czf "$ARCHIVE" "${FICHIERS[@]}"

echo "→ Envoi vers $CIBLE"
scp "$ARCHIVE" "$CIBLE:/tmp/loto.tgz"

echo "→ Installation dans $DOSSIER_DISTANT"
# On remplace l'ancienne version en une fois : pas de fichiers obsolètes qui traînent
ssh -t "$CIBLE" "set -e
  sudo rm -rf $DOSSIER_DISTANT.nouveau
  sudo mkdir -p $DOSSIER_DISTANT.nouveau
  sudo tar -xzf /tmp/loto.tgz -C $DOSSIER_DISTANT.nouveau
  sudo chown -R www-data:www-data $DOSSIER_DISTANT.nouveau
  sudo rm -rf $DOSSIER_DISTANT.ancien
  if [ -d $DOSSIER_DISTANT ]; then sudo mv $DOSSIER_DISTANT $DOSSIER_DISTANT.ancien; fi
  sudo mv $DOSSIER_DISTANT.nouveau $DOSSIER_DISTANT
  rm -f /tmp/loto.tgz"

rm -f "$ARCHIVE"
echo "✓ Appli publiée. Pense à changer la version du cache dans sw.js à chaque mise à jour."
