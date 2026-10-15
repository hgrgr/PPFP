#!/usr/bin/env bash
# Mails when the VM's disk is nearly full (docs/deploy-cloud.md).
#
#   bash deploy/cloud/disk-alert.sh            # check now (mails only above the threshold)
#   bash deploy/cloud/disk-alert.sh --test     # send a test mail
#   bash deploy/cloud/disk-alert.sh --install  # check every 30 minutes from cron
#
# Mail goes through Gmail SMTP with msmtp (sudo apt-get install msmtp) and a Gmail app password
# kept in ~/.config/ppfp-mail/app-password (mode 600); sender and recipient are $PPFP_ALERT_TO.
# Above $PPFP_DISK_LIMIT % (default 90) it mails once, then again every 24 hours while it stays
# up, and once more when the disk is back below the limit minus five.
set -euo pipefail

TO="${PPFP_ALERT_TO:-fsi.hbw@gmail.com}"
LIMIT="${PPFP_DISK_LIMIT:-90}"
MOUNT="${PPFP_DISK_MOUNT:-/}"
PASS_FILE="${PPFP_MAIL_PASS_FILE:-$HOME/.config/ppfp-mail/app-password}"
STATE="$HOME/.local/state/ppfp-disk-alert"
LOG="$HOME/.local/state/ppfp-disk-alert.log"
mkdir -p "$(dirname "$STATE")"

if [ "${1:-}" = "--install" ]; then
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  line="*/30 * * * * bash $self >>$LOG 2>&1"
  { crontab -l 2>/dev/null | grep -v 'disk-alert.sh' || true; echo "$line"; } | crontab -
  echo "[disk-alert] cron: $line"
  exit 0
fi

send() {
  local subject="$1" body="$2"
  if [ ! -s "$PASS_FILE" ]; then
    echo "[disk-alert] no app password in $PASS_FILE; cannot mail: $subject" >&2
    return 1
  fi
  {
    printf 'From: PPFP VM <%s>\nTo: %s\nSubject: =?UTF-8?B?%s?=\nMIME-Version: 1.0\nContent-Type: text/plain; charset=UTF-8\n\n' "$TO" "$TO" "$(printf %s "$subject" | base64 -w0)"
    printf '%s\n' "$body"
  } | msmtp --host=smtp.gmail.com --port=587 --tls=on --tls-starttls=on --auth=on \
      --user="$TO" --from="$TO" --passwordeval="cat $PASS_FILE" "$TO"
}

usage="$(df -P "$MOUNT" | awk 'NR==2 {gsub("%","",$5); print $5}')"
detail="$(df -h "$MOUNT" | tail -1)
$(sudo -n docker system df 2>/dev/null || true)"
now="$(date +%s)"
host="$(hostname -s)"

if [ "${1:-}" = "--test" ]; then
  send "[PPFP] 디스크 알림 시험 ($host ${usage}%)" "디스크 알림이 동작합니다. 지금 $MOUNT 사용량 ${usage}% (기준 ${LIMIT}%).

$detail"
  echo "[disk-alert] test mail sent to $TO"
  exit 0
fi

last="$(cat "$STATE" 2>/dev/null || echo 0)"
if [ "$usage" -ge "$LIMIT" ]; then
  if [ "$last" = 0 ] || [ $((now - last)) -ge 86400 ]; then
    send "[PPFP] 디스크 ${usage}% 사용 ($host)" "VM 디스크($MOUNT)가 ${usage}% 찼습니다 (기준 ${LIMIT}%).

$detail

정리할 만한 것: sudo docker builder prune -f --keep-storage 10GB (빌드 캐시), ~/ppfp/backups (DB 백업, 최근 30개 유지).
24시간 뒤에도 기준을 넘으면 다시 알립니다." && echo "$now" >"$STATE"
    echo "[disk-alert] $(date -u +%FT%TZ) ${usage}% — mailed $TO"
  fi
elif [ "$last" != 0 ] && [ "$usage" -lt $((LIMIT - 5)) ]; then
  send "[PPFP] 디스크 정상으로 돌아옴 ${usage}% ($host)" "VM 디스크($MOUNT) 사용량이 ${usage}%로 내려왔습니다.

$detail" && echo 0 >"$STATE"
  echo "[disk-alert] $(date -u +%FT%TZ) back to ${usage}% — mailed $TO"
fi
