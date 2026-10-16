#!/usr/bin/env bash
# Sets up the cloud VM as a development machine you reach over SSH (from Windows or anywhere):
# Node 22, Claude Code and the GitHub CLI in ~/.local (no sudo), the repo in ~/dev/PPFP, and a
# development Postgres on 127.0.0.1:5433 in its own container and volume, apart from the
# running app's database. Rerunning it is safe.
#
#   bash setup-vm.sh [path/to/ppfp.bundle]
#
# With a git bundle (made on the Mac with `git bundle create ppfp.bundle --all`) the repo comes
# from it, unpushed branches included; otherwise from GitHub (needs `gh auth login` first).
set -euo pipefail

NODE_VERSION=22.23.3
GH_VERSION=2.102.0
DEV=$HOME/dev/PPFP
BIN=$HOME/.local/bin
mkdir -p "$BIN" "$HOME/dev"

case "$(uname -m)" in
  aarch64 | arm64) ARCH=arm64 ;;
  x86_64) ARCH=x64 ;;
  *) echo "unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac

# ---------------------------------------------------------------- Node
if [ "$("$HOME/.local/node/bin/node" -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  echo "installing Node $NODE_VERSION"
  tmp=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.xz" -o "$tmp/node.tar.xz"
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
  (cd "$tmp" && grep " node-v$NODE_VERSION-linux-$ARCH.tar.xz\$" SHASUMS256.txt | sed "s|node-v.*|node.tar.xz|" | sha256sum -c -)
  rm -rf "$HOME/.local/node" && mkdir -p "$HOME/.local/node"
  tar -xJf "$tmp/node.tar.xz" -C "$HOME/.local/node" --strip-components=1
  rm -rf "$tmp"
fi
for b in node npm npx; do ln -sf "$HOME/.local/node/bin/$b" "$BIN/$b"; done
export PATH="$BIN:$HOME/.local/node/bin:$PATH"

# ---------------------------------------------------------------- Claude Code
if ! command -v claude >/dev/null; then
  echo "installing Claude Code"
  npm install -g @anthropic-ai/claude-code >/dev/null
fi
ln -sf "$HOME/.local/node/bin/claude" "$BIN/claude"

# ---------------------------------------------------------------- GitHub CLI
if ! "$BIN/gh" --version 2>/dev/null | grep -q "$GH_VERSION"; then
  echo "installing gh $GH_VERSION"
  tmp=$(mktemp -d)
  gharch=$([ "$ARCH" = x64 ] && echo amd64 || echo arm64)
  curl -fsSL "https://github.com/cli/cli/releases/download/v$GH_VERSION/gh_${GH_VERSION}_linux_${gharch}.tar.gz" -o "$tmp/gh.tgz"
  tar -xzf "$tmp/gh.tgz" -C "$tmp"
  install -m 755 "$tmp"/gh_*/bin/gh "$BIN/gh"
  rm -rf "$tmp"
fi

# ---------------------------------------------------------------- PATH
if ! grep -q 'ppfp-dev PATH' "$HOME/.bashrc"; then
  printf '\n# ppfp-dev PATH\nexport PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"\n' >>"$HOME/.bashrc"
fi

# ---------------------------------------------------------------- repo
if [ ! -d "$DEV/.git" ]; then
  if [ -n "${1:-}" ]; then
    git clone -q "$1" "$DEV"
    # Every branch in the bundle becomes a local branch
    git -C "$DEV" for-each-ref --format='%(refname:strip=3)' refs/remotes/origin | grep -v '^HEAD$' | while read -r b; do
      git -C "$DEV" show-ref -q "refs/heads/$b" || git -C "$DEV" branch -q "$b" "origin/$b"
    done
  else
    gh repo clone hgrgr/PPFP "$DEV"
  fi
  git -C "$DEV" remote set-url origin https://github.com/hgrgr/PPFP.git
fi
git -C "$DEV" config user.name hgrgr
git -C "$DEV" config user.email fsi.hbw@gmail.com

# ---------------------------------------------------------------- development database
# Its own container, volume and port; the app's database (compose project ppfp) is not touched
if ! sudo docker ps -a --format '{{.Names}}' | grep -qx ppfp-dev-db; then
  echo "starting the development database"
  sudo docker run -d --name ppfp-dev-db --restart unless-stopped \
    -e POSTGRES_USER=ppfp -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=ppfp_dev \
    -v ppfp-dev-db:/var/lib/postgresql/data -p 127.0.0.1:5433:5432 postgres:16 >/dev/null
  until sudo docker exec ppfp-dev-db pg_isready -U ppfp >/dev/null 2>&1; do sleep 1; done
  sudo docker exec ppfp-dev-db psql -U ppfp -d ppfp_dev -qc 'CREATE DATABASE ppfp_demo' >/dev/null
fi

if [ ! -f "$DEV/.env" ]; then
  cat >"$DEV/.env" <<EOF
# Development only: the dev database on 127.0.0.1:5433, not the running app's
DATABASE_URL="postgresql://ppfp@127.0.0.1:5433/ppfp_dev?schema=public"
APP_ENCRYPTION_KEY="$(openssl rand -base64 32)"
CRON_SECRET="$(openssl rand -hex 24)"
EOF
fi

cd "$DEV"
npm ci --no-audit --no-fund >/dev/null
npx prisma migrate deploy >/dev/null
echo "repo ready at $DEV ($(git rev-parse --abbrev-ref HEAD) $(git log --oneline -1))"

# ---------------------------------------------------------------- tmux launcher
cat >"$BIN/ppfp-claude" <<'EOF'
#!/usr/bin/env bash
# Opens (or reattaches to) the tmux session that keeps Claude Code running after you disconnect.
#   ppfp-claude            reattach, or start Claude Code in ~/dev/PPFP
#   ppfp-claude <session>  start by resuming that session id
export PATH="$HOME/.local/bin:$HOME/.local/node/bin:$PATH"
if tmux has-session -t claude 2>/dev/null; then exec tmux attach -t claude; fi
cd "$HOME/dev/PPFP"
if [ -n "${1:-}" ]; then exec tmux new -s claude "claude --resume $1; bash"; fi
exec tmux new -s claude "claude --continue || claude; bash"
EOF
chmod +x "$BIN/ppfp-claude"

cat <<'EOF'

Done. Still to do by you (they need your accounts):
  claude          # log in to Claude once (opens a URL to approve in your browser)
  gh auth login   # GitHub, for push and pull requests
Then: ppfp-claude
EOF
