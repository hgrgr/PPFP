#!/usr/bin/env bash
# Puts a disaster-recovery bundle (deploy/recovery/backup.sh) back on a Mac (docs/recovery.md).
#
#   bash restore.sh                         # newest bundle from Google Drive (rclone remote gdrive)
#   bash restore.sh ppfp-recovery-....enc   # a bundle file already downloaded
#   bash restore.sh --force ...             # also overwrite files that already exist
#
# Asks for the recovery passphrase (or reads PPFP_RECOVERY_PASSPHRASE). Restores, under $HOME:
# ~/.claude (Claude Code sessions and memory), the desktop app's session list, SSH and Android
# signing keys, the repository's .env and .claude/; then clones the repository if it is missing,
# brings back branches that were never pushed, and recreates the worktrees sessions ran in.
# The VM's .env and rclone.conf are left in the unpacked folder for docs/recovery.md step B.
set -euo pipefail

REPO="${PPFP_REPO_DIR:-$HOME/claude/PPFP}"
REMOTE="${PPFP_RECOVERY_REMOTE:-gdrive:ppfp-recovery}"
ITER=600000
say() { printf '[restore] %s\n' "$*"; }

force=0
if [ "${1:-}" = "--force" ]; then force=1; shift; fi
file="${1:-}"

if [ -z "$file" ]; then
  if ! command -v rclone >/dev/null || ! rclone listremotes 2>/dev/null | grep -qx "${REMOTE%%:*}:"; then
    echo "Download the newest ppfp-recovery-*.tar.gz.enc from Google Drive (folder ${REMOTE#*:}) and pass" >&2
    echo "it as an argument, or install rclone and run: rclone config create ${REMOTE%%:*} drive scope=drive.file" >&2
    exit 2
  fi
  name="$(rclone lsf "$REMOTE" --include 'ppfp-recovery-*.tar.gz.enc' | sort | tail -1)"
  [ -n "$name" ] || { echo "no bundle in $REMOTE" >&2; exit 2; }
  say "downloading $name"
  rclone copy "$REMOTE/$name" "$HOME/Downloads" --log-level NOTICE
  file="$HOME/Downloads/$name"
fi
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 2; }

pass="${PPFP_RECOVERY_PASSPHRASE:-}"
if [ -z "$pass" ]; then
  read -r -s -p "recovery passphrase: " pass
  echo
fi

out="$HOME/ppfp-restore-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
chmod 700 "$out"
PASS="$pass" openssl enc -d -aes-256-cbc -pbkdf2 -iter $ITER -md sha256 -pass env:PASS -in "$file" | tar -xzf - -C "$out" \
  || { echo "could not open the bundle: wrong passphrase or damaged file" >&2; exit 1; }
say "unpacked into $out"
sed -n '1,4p' "$out/MANIFEST.txt"

say "files under $HOME ($([ $force = 1 ] && echo overwriting || echo 'keeping what already exists'))"
if [ $force = 1 ]; then tar -xpf "$out/home/files.tar" -C "$HOME"; else tar -xpkf "$out/home/files.tar" -C "$HOME" 2>/dev/null || true; fi

say "repository $REPO"
if [ ! -d "$REPO/.git" ]; then
  mkdir -p "$(dirname "$REPO")"
  # The bundle's .claude/ and .env were just put in place; clone around them
  tmp="$(mktemp -d)"
  url="$(sed -n 's/^repo: .* -> //p' "$out/MANIFEST.txt")"
  git clone -q "${url:-https://github.com/hgrgr/PPFP.git}" "$tmp/repo"
  mkdir -p "$REPO"
  cp -Rn "$tmp/repo/." "$REPO/"
  rm -rf "$tmp"
fi
# Branches GitHub never got
git -C "$REPO" fetch -q "$out/repo.bundle" 'refs/heads/*:refs/remotes/recovered/*'
for ref in $(git -C "$REPO" for-each-ref --format='%(refname:strip=3)' refs/remotes/recovered); do
  git -C "$REPO" show-ref -q --verify "refs/heads/$ref" || git -C "$REPO" branch -q "$ref" "refs/remotes/recovered/$ref"
done

say "worktrees the sessions ran in"
for f in "$HOME/Library/Application Support/Claude/claude-code-sessions"/*/*/local_*.json; do
  [ -f "$f" ] || continue
  read -r wt br < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("worktreePath") or "-", d.get("branch") or "-")' "$f")
  [ "$wt" != "-" ] && [ ! -e "$wt/.git" ] || continue
  case "$wt" in "$REPO"/*) ;; *) continue ;; esac
  if [ "$br" != "-" ] && git -C "$REPO" show-ref -q --verify "refs/heads/$br" && ! git -C "$REPO" worktree list --porcelain | grep -qx "branch refs/heads/$br"; then
    git -C "$REPO" worktree add -q "$wt" "$br" && say "  $wt ($br)"
  else
    git -C "$REPO" worktree add -q --detach "$wt" origin/main 2>/dev/null && say "  $wt (main; branch $br is gone)"
  fi
  [ -e "$REPO/.env" ] && [ ! -e "$wt/.env" ] && ln -s "$REPO/.env" "$wt/.env"
done

say "done. Next (docs/recovery.md):"
echo "  - Install the Claude desktop app and sign in; the sessions above show in the sidebar, or run"
echo "    'claude --resume' in a session's folder. Run 'npm install' in the repository and each worktree."
[ -f "$out/vm/env" ] && echo "  - VM secrets for a rebuilt VM: $out/vm/env and $out/vm/rclone.conf"
echo "  - Delete $out when finished: it holds the secrets unencrypted."
