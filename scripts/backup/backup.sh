#!/bin/sh
# PPFP database backup: pg_dump (custom format) into $BACKUP_DIR, keeps the newest $BACKUP_KEEP,
# and records the last backup in the app's AppSetting table so 가져오기 · 내보내기 can show it.
#
#   sh backup.sh once     one backup now
#   sh backup.sh loop     one now, then every $BACKUP_INTERVAL_HOURS (the docker compose `backup` service)
#
# Connection from the usual libpq variables: PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE.
# Optional: BACKUP_GPG_PASSPHRASE encrypts each file (gpg, AES-256) as <name>.dump.gpg.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
DB="${PGDATABASE:-ppfp}"

log() { echo "[backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) $*"; }

record() {
  # $1 = JSON value; best effort, the dump is what matters
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -c "INSERT INTO \"AppSetting\" (key, value) VALUES ('backup.last', '$1') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value" >/dev/null 2>&1 || log "could not record the backup in AppSetting"
}

backup_once() {
  mkdir -p "$BACKUP_DIR"
  stamp="$(date -u +%Y%m%d-%H%M%S)"
  name="ppfp-$stamp.dump"
  tmp="$BACKUP_DIR/.$name.part"
  if ! pg_dump -Fc -d "$DB" -f "$tmp"; then
    rm -f "$tmp"
    log "pg_dump failed"
    record "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"ok\":false,\"error\":\"pg_dump failed\"}"
    return 1
  fi
  # A dump that pg_restore cannot list is not a backup
  tables="$(pg_restore -l "$tmp" | grep -c 'TABLE DATA' || true)"
  if [ -n "${BACKUP_GPG_PASSPHRASE:-}" ]; then
    if command -v gpg >/dev/null 2>&1; then
      echo "$BACKUP_GPG_PASSPHRASE" | gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 0 --symmetric --cipher-algo AES256 -o "$tmp.gpg" "$tmp"
      rm -f "$tmp"
      tmp="$tmp.gpg"
      name="$name.gpg"
    else
      log "BACKUP_GPG_PASSPHRASE is set but gpg is not installed; keeping the file unencrypted"
    fi
  fi
  mv "$tmp" "$BACKUP_DIR/$name"
  size="$(wc -c < "$BACKUP_DIR/$name" | tr -d ' ')"
  log "wrote $name ($size bytes, $tables tables)"
  # Keep the newest $BACKUP_KEEP
  ls -1t "$BACKUP_DIR"/ppfp-*.dump* 2>/dev/null | tail -n +"$((BACKUP_KEEP + 1))" | while read -r old; do
    rm -f "$old"
    log "removed $(basename "$old")"
  done
  kept="$(ls -1 "$BACKUP_DIR"/ppfp-*.dump* 2>/dev/null | wc -l | tr -d ' ')"
  record "{\"at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"ok\":true,\"file\":\"$name\",\"bytes\":$size,\"tables\":$tables,\"kept\":$kept,\"keep\":$BACKUP_KEEP,\"intervalHours\":$BACKUP_INTERVAL_HOURS}"
}

case "${1:-once}" in
  once) backup_once ;;
  loop)
    log "every ${BACKUP_INTERVAL_HOURS}h into $BACKUP_DIR, keeping $BACKUP_KEEP"
    while true; do
      backup_once || true
      sleep "$((BACKUP_INTERVAL_HOURS * 3600))"
    done
    ;;
  *) echo "usage: backup.sh once|loop" >&2; exit 2 ;;
esac
