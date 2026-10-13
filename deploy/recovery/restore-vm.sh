#!/usr/bin/env bash
# On a rebuilt VM, after ~/ppfp/.env and ~/ppfp/rclone/rclone.conf came back from the recovery
# bundle and deploy/cloud/setup.sh has run (docs/recovery.md step B):
#
#   bash ~/ppfp/deploy/recovery/restore-vm.sh                 # newest dump on Google Drive
#   bash ~/ppfp/deploy/recovery/restore-vm.sh ppfp-....dump.gpg
#
# Downloads the encrypted database dump the offsite service copied to the Drive and restores
# it with scripts/backup/restore.sh, using BACKUP_GPG_PASSPHRASE from .env.
set -euo pipefail
cd "${PPFP_DIR:-$HOME/ppfp}"
[ -f .env ] || { echo "no .env: put the one from the recovery bundle here first" >&2; exit 2; }
[ -s rclone/rclone.conf ] || { echo "no rclone/rclone.conf: put the one from the recovery bundle here first" >&2; exit 2; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a
remote="${OFFSITE_REMOTE:-gdrive:ppfp-backups}"
rclone() { sudo docker run --rm -v "$PWD/rclone:/config/rclone" -v "$PWD/backups:/backups" rclone/rclone:1.71.1 "$@"; }

name="${1:-}"
if [ -z "$name" ]; then
  name="$(rclone lsf "$remote" --include '*.dump.gpg' | sort | tail -1)"
  [ -n "$name" ] || { echo "no *.dump.gpg in $remote" >&2; exit 2; }
fi
mkdir -p backups
echo "[restore-vm] downloading $name from $remote"
rclone copy "$remote/$name" /backups --log-level NOTICE
sudo env BACKUP_GPG_PASSPHRASE="$BACKUP_GPG_PASSPHRASE" sh scripts/backup/restore.sh "backups/$name"
