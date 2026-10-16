#!/usr/bin/env bash
# Disaster-recovery bundle for the VM used as a development machine (docs/recovery.md).
#
#   bash deploy/recovery/backup-vm.sh            # build, encrypt, upload to Google Drive
#   bash deploy/recovery/backup-vm.sh --local    # build and encrypt only (prints the file)
#   bash deploy/recovery/backup-vm.sh --install  # run it every day from cron (03:30 KST)
#
# The Mac's bundle (backup.sh) has the Mac's Claude Code sessions; sessions run on this VM
# (~/dev/PPFP, docs/remote-dev.md) live only here. This bundles, with the same layout:
#   vm/       ~/ppfp/.env and rclone.conf (as in the Mac's bundle)
#   home/     ~/.claude (sessions, memory, settings; not the desktop app's own copy in remote/),
#             the dev checkout's .env and .claude/
#   repo.bundle  every branch of ~/dev/PPFP, pushed or not
# encrypted with a recovery passphrase (the VM has its own since 2026-10-14), read from ~/.config/ppfp-recovery/passphrase
# (mode 600) or PPFP_RECOVERY_PASSPHRASE, and uploaded as ppfp-vm-<stamp>.tar.gz.enc next to
# the Mac's bundles. Uploads go through the rclone image and config the offsite service uses.
set -euo pipefail

REPO="${PPFP_REPO_DIR:-$HOME/dev/PPFP}"
PROD="${PPFP_PROD_DIR:-$HOME/ppfp}"
REMOTE="${PPFP_RECOVERY_REMOTE:-gdrive:ppfp-recovery}"
KEEP_DAYS="${PPFP_RECOVERY_KEEP_DAYS:-60}"
PASS_FILE="${PPFP_RECOVERY_PASS_FILE:-$HOME/.config/ppfp-recovery/passphrase}"
RCLONE_IMAGE="rclone/rclone:1.71.1"
LOG="$HOME/.local/state/ppfp-recovery.log"
ITER=600000
say() { printf '[recovery] %s %s\n' "$(date -u +%FT%TZ)" "$*"; }

if [ "${1:-}" = "--install" ]; then
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  mkdir -p "$(dirname "$LOG")"
  # The VM runs on UTC: 18:30 UTC is 03:30 KST
  line="30 18 * * * bash $self >>$LOG 2>&1"
  { crontab -l 2>/dev/null | grep -v 'backup-vm.sh' || true; echo "$line"; } | crontab -
  say "cron: $line"
  exit 0
fi

local_only=0
[ "${1:-}" = "--local" ] && local_only=1

pass="${PPFP_RECOVERY_PASSPHRASE:-}"
if [ -z "$pass" ] && [ -f "$PASS_FILE" ]; then
  if [ "$(stat -c %a "$PASS_FILE")" != 600 ]; then
    echo "$PASS_FILE must be readable only by you: chmod 600 $PASS_FILE" >&2
    exit 2
  fi
  pass="$(cat "$PASS_FILE")"
fi
if [ -z "$pass" ]; then
  echo "No recovery passphrase. Put one (and a copy in a password manager) in $PASS_FILE once:" >&2
  echo "  mkdir -p $(dirname "$PASS_FILE") && (umask 077; read -rsp 'passphrase: ' p && printf %s \"\$p\" >$PASS_FILE)" >&2
  exit 2
fi
rclone() {
  docker run --rm -v "$PROD/rclone:/config/rclone" -v "$work:/data:ro" "$RCLONE_IMAGE" "$@"
}

stamp="$(date -u +%Y%m%d-%H%M%S)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/b/vm" "$work/b/home"

say "production secrets from $PROD"
# rclone.conf is root's (the offsite container writes it)
if cp "$PROD/.env" "$work/b/vm/env" 2>/dev/null && sudo -n cat "$PROD/rclone/rclone.conf" >"$work/b/vm/rclone.conf" 2>/dev/null; then
  chmod 600 "$work/b/vm/"*
else
  say "could not read $PROD/.env or rclone.conf: this bundle leaves them out"
  rm -f "$work/b/vm/env" "$work/b/vm/rclone.conf"
fi

say "this VM's files"
cd "$HOME"
paths=()
add() { for p in "$@"; do if [ -e "$p" ]; then paths+=("$p"); fi; done; }
rel="${REPO#"$HOME"/}"
add .claude .claude.json .local/bin/ppfp-claude "$rel/.env" "$rel/.claude"
tar -cf "$work/b/home/files.tar" \
  --exclude '.claude/cache' --exclude '.claude/downloads' --exclude '.claude/remote' \
  --exclude "$rel/.claude/worktrees" --exclude "$rel/.claude/apk" \
  "${paths[@]}"

say "repository branches"
git -C "$REPO" bundle create "$work/b/repo.bundle" --all 2>/dev/null

{
  echo "made: $stamp UTC on $(hostname -s) as $USER (home $HOME)"
  echo "repo: $REPO -> $(git -C "$REPO" remote get-url origin)"
  echo "vm: $PROD ($( [ -f "$work/b/vm/env" ] && echo included || echo 'NOT included'))"
  echo "node: $(node -v 2>/dev/null || echo none)  claude: $(claude --version 2>/dev/null || echo none)"
  echo "worktrees:"
  git -C "$REPO" worktree list
  echo "sessions:"
  for f in .claude/projects/*/*.jsonl; do
    echo "  $f $(du -h "$f" | cut -f1) $(date -u -r "$f" +%FT%TZ)"
  done
} >"$work/b/MANIFEST.txt"

name="ppfp-vm-$stamp.tar.gz.enc"
out="$work/$name"
tar -czf - -C "$work/b" . | PASS="$pass" openssl enc -aes-256-cbc -pbkdf2 -iter $ITER -md sha256 -salt -pass env:PASS -out "$out"
# Decrypt once to be sure the passphrase and file agree before anything is uploaded
PASS="$pass" openssl enc -d -aes-256-cbc -pbkdf2 -iter $ITER -md sha256 -pass env:PASS -in "$out" | tar -tzf - >/dev/null
rm -rf "$work/b"
size="$(du -h "$out" | cut -f1)"

if [ "$local_only" = 1 ]; then
  dest="${PPFP_RECOVERY_OUT:-$HOME/$name}"
  mv "$out" "$dest"
  say "wrote $dest ($size)"
  exit 0
fi
rclone copy "/data/$name" "$REMOTE" --log-level NOTICE
rclone delete "$REMOTE" --include 'ppfp-vm-*.tar.gz.enc' --min-age "${KEEP_DAYS}d" --log-level NOTICE
say "uploaded $name ($size) to $REMOTE"
