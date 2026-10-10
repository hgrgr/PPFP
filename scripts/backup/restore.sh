#!/bin/sh
# Restores a PPFP backup into the docker compose database. Run from the repository root:
#
#   sh scripts/backup/restore.sh backups/ppfp-20261010-030000.dump
#
# Stops the app, replaces every table with the backup's, then starts the app again, which
# applies any newer migrations. The current data is dumped first to backups/before-restore-*.dump.
set -eu

file="${1:-}"
if [ -z "$file" ] || [ ! -f "$file" ]; then
  echo "usage: sh scripts/backup/restore.sh <backup file>" >&2
  exit 2
fi

# Encrypted backups are opened inside the db container (it has gpg) with BACKUP_GPG_PASSPHRASE
decrypt=""
case "$file" in
  *.gpg)
    if [ -z "${BACKUP_GPG_PASSPHRASE:-}" ]; then
      echo "set BACKUP_GPG_PASSPHRASE to the passphrase the backup was made with" >&2
      exit 2
    fi
    decrypt=1
    ;;
esac

mkdir -p backups
safety="backups/before-restore-$(date -u +%Y%m%d-%H%M%S).dump"
echo "[restore] saving the current data to $safety"
docker compose exec -T db pg_dump -U ppfp -d ppfp -Fc > "$safety"

echo "[restore] stopping the app"
docker compose stop app

echo "[restore] restoring $file"
if [ -n "$decrypt" ]; then
  docker compose exec -T -e P="$BACKUP_GPG_PASSPHRASE" db sh -c 'umask 077; printf %s "$P" > /tmp/.p; gpg --batch --quiet --pinentry-mode loopback --passphrase-file /tmp/.p -d > /tmp/.restore.dump; rm -f /tmp/.p; pg_restore -U ppfp -d ppfp --clean --if-exists --no-owner /tmp/.restore.dump; s=$?; rm -f /tmp/.restore.dump; exit $s' < "$file"
else
  docker compose exec -T db pg_restore -U ppfp -d ppfp --clean --if-exists --no-owner < "$file"
fi

echo "[restore] starting the app (migrations newer than the backup are applied on start)"
docker compose start app
echo "[restore] done"
