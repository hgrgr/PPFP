#!/usr/bin/env bash
# Pulls the latest main and rebuilds PPFP on the VM. Migrations apply when the app starts.
#   bash ~/ppfp/deploy/cloud/update.sh
set -euo pipefail
cd "${PPFP_DIR:-$HOME/ppfp}"
git pull -q --ff-only
PROFILES=()
[ -s rclone/rclone.conf ] && PROFILES=(--profile offsite)
# A backup before the new migrations
sudo docker compose exec -T backup sh /scripts/backup.sh once || echo "[ppfp] backup before update failed; continuing"
sudo docker compose -f docker-compose.yml -f docker-compose.cloud.yml "${PROFILES[@]}" up -d --build
sudo docker image prune -f >/dev/null
echo "[ppfp] updated to $(git log -1 --format='%h %s')"
