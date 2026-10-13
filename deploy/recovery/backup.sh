#!/usr/bin/env bash
# Disaster-recovery bundle, run on the Mac PPFP is developed on (docs/recovery.md).
#
#   bash deploy/recovery/backup.sh            # build, encrypt, upload to Google Drive
#   bash deploy/recovery/backup.sh --local    # build and encrypt only (prints the file)
#
# GitHub keeps the code and the Drive keeps the database dumps (offsite service on the VM),
# but neither has the secrets those need, nor this Mac's own setup. This bundles them:
#   vm/       the VM's .env (APP_ENCRYPTION_KEY, BACKUP_GPG_PASSPHRASE, ...) and rclone.conf
#   home/     ~/.claude (Claude Code sessions, memory, settings), the desktop app's session
#             list, the Android signing key, the VM's SSH key, the repository's .env and .claude/
#             (worktrees left out: they are checkouts of branches in repo.bundle)
#   repo.bundle  every branch of the local repository, pushed or not
# encrypted with one recovery passphrase (AES-256, PBKDF2) that has to live outside both
# machines: a password manager or paper. On this Mac it is read from the login keychain
# (service "ppfp-recovery"; add it with: security add-generic-password -s ppfp-recovery -a "$USER" -w)
# or from PPFP_RECOVERY_PASSPHRASE.
set -euo pipefail

REPO="${PPFP_REPO_DIR:-$HOME/claude/PPFP}"
VM="${PPFP_VM:-ubuntu@100.121.56.5}"
SSH_KEY="${PPFP_VM_KEY:-$HOME/.ssh/oci_ppfp}"
REMOTE="${PPFP_RECOVERY_REMOTE:-gdrive:ppfp-recovery}"
KEEP_DAYS="${PPFP_RECOVERY_KEEP_DAYS:-60}"
APP="$HOME/Library/Application Support/Claude"
ITER=600000
say() { printf '[recovery] %s\n' "$*"; }

local_only=0
[ "${1:-}" = "--local" ] && local_only=1

pass="${PPFP_RECOVERY_PASSPHRASE:-}"
[ -n "$pass" ] || pass="$(security find-generic-password -s ppfp-recovery -w 2>/dev/null || true)"
if [ -z "$pass" ]; then
  echo "No recovery passphrase. Add it to the keychain once (and keep a copy off this Mac):" >&2
  echo "  security add-generic-password -s ppfp-recovery -a \"\$USER\" -w" >&2
  exit 2
fi
if [ "$local_only" = 0 ] && ! rclone listremotes 2>/dev/null | grep -qx "${REMOTE%%:*}:"; then
  echo "rclone has no '${REMOTE%%:*}' remote on this Mac. Set it up once (a browser opens):" >&2
  echo "  rclone config create ${REMOTE%%:*} drive scope=drive.file" >&2
  exit 2
fi

stamp="$(date -u +%Y%m%d-%H%M%S)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/b/vm" "$work/b/home"

say "VM secrets from $VM"
# The VM's .env and rclone.conf hold the keys that open its data; rclone.conf is root's
if ssh -i "$SSH_KEY" -o ConnectTimeout=20 -o BatchMode=yes "$VM" 'cat ~/ppfp/.env' >"$work/b/vm/env" 2>/dev/null &&
  ssh -i "$SSH_KEY" -o ConnectTimeout=20 -o BatchMode=yes "$VM" 'sudo cat ~/ppfp/rclone/rclone.conf' >"$work/b/vm/rclone.conf" 2>/dev/null; then
  :
else
  say "could not reach the VM (Tailscale SSH may want a browser check): this bundle leaves out its secrets; older bundles still have them"
  rm -f "$work/b/vm/env" "$work/b/vm/rclone.conf"
fi

say "this Mac's files"
cd "$HOME"
paths=()
add() { for p in "$@"; do [ -e "$p" ] && paths+=("$p"); done; }
add .claude ".ssh/oci_ppfp" ".ssh/oci_ppfp.pub" .local/ppfp-signing .local/android-env.sh .config/rclone/rclone.conf
add "Library/Application Support/Claude/claude-code-sessions" "Library/Application Support/Claude/git-worktrees.json" \
  "Library/Application Support/Claude/claude_desktop_config.json"
rel="${REPO#"$HOME"/}"
add "$rel/.env" "$rel/.claude" "$rel/mobile/android/keystore.properties"
tar -cf "$work/b/home/files.tar" \
  --exclude '.claude/cache' --exclude '.claude/downloads' --exclude "$rel/.claude/worktrees" --exclude "$rel/.claude/apk" \
  "${paths[@]}"

say "repository branches"
git -C "$REPO" bundle create "$work/b/repo.bundle" --all 2>/dev/null

{
  echo "made: $stamp UTC on $(hostname -s) as $USER (home $HOME)"
  echo "repo: $REPO -> $(git -C "$REPO" remote get-url origin)"
  echo "vm: $VM ($( [ -f "$work/b/vm/env" ] && echo included || echo 'NOT included'))"
  echo "node: $(node -v 2>/dev/null || echo none)  claude: $(ls "$APP/claude-code" 2>/dev/null | sort -V | tail -1)"
  echo "worktrees:"
  git -C "$REPO" worktree list
  echo "sessions (desktop app):"
  for f in "$APP"/claude-code-sessions/*/*/local_*.json; do
    python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(" ", d.get("sessionId"), d.get("cliSessionId"), d.get("cwd"), "|", d.get("title"))' "$f" 2>/dev/null || true
  done
} >"$work/b/MANIFEST.txt"

out="$work/ppfp-recovery-$stamp.tar.gz.enc"
tar -czf - -C "$work/b" . | PASS="$pass" openssl enc -aes-256-cbc -pbkdf2 -iter $ITER -md sha256 -salt -pass env:PASS -out "$out"
# Decrypt once to be sure the passphrase and file agree before anything is uploaded
PASS="$pass" openssl enc -d -aes-256-cbc -pbkdf2 -iter $ITER -md sha256 -pass env:PASS -in "$out" | tar -tzf - >/dev/null
size="$(du -h "$out" | cut -f1)"

if [ "$local_only" = 1 ]; then
  dest="${PPFP_RECOVERY_OUT:-$HOME/ppfp-recovery-$stamp.tar.gz.enc}"
  mv "$out" "$dest"
  say "wrote $dest ($size)"
  exit 0
fi
rclone copy "$out" "$REMOTE" --log-level NOTICE
rclone delete "$REMOTE" --include 'ppfp-recovery-*.tar.gz.enc' --min-age "${KEEP_DAYS}d" --log-level NOTICE
say "uploaded ppfp-recovery-$stamp.tar.gz.enc ($size) to $REMOTE"
