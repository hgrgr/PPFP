#!/usr/bin/env bash
# Sets up PPFP on a fresh Ubuntu 24.04 VM (Oracle Cloud Always Free Ampere A1, or any VM).
# Run as the default user (ubuntu) with sudo rights:
#
#   sudo apt-get install -y git && git clone https://github.com/hgrgr/PPFP.git ~/ppfp
#   bash ~/ppfp/deploy/cloud/setup.sh
#
# Safe to run again: it skips what is already done. Steps, in docs/deploy-cloud.md:
#   1. swap, automatic security updates, Docker, git
#   2. Tailscale (you sign in once with the link it prints)
#   3. the repository in ~/ppfp and a .env with fresh secrets (printed once: save them)
#   4. docker compose up (app, db, daily backup; off-site copies when rclone is set up)
#   5. HTTPS on https://<this machine>.<tailnet>.ts.net through `tailscale serve`
set -euo pipefail

DIR="${PPFP_DIR:-$HOME/ppfp}"
REPO="${PPFP_REPO:-https://github.com/hgrgr/PPFP.git}"
say() { printf '\n\033[1m[ppfp] %s\033[0m\n' "$*"; }

say "1/5 swap, automatic updates, Docker, git"
if ! swapon --show | grep -q .; then
  sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 git unattended-upgrades openssl >/dev/null
sudo systemctl enable --now docker >/dev/null
sudo usermod -aG docker "$USER"
DOCKER="sudo docker"

say "2/5 Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if ! tailscale status >/dev/null 2>&1; then
  echo "Open the link below in a browser and sign in to Tailscale (Google account is fine)."
  sudo tailscale up --ssh --hostname=ppfp
fi

say "3/5 repository and .env"
if [ ! -d "$DIR/.git" ]; then git clone -q "$REPO" "$DIR"; else git -C "$DIR" pull -q --ff-only; fi
cd "$DIR"
mkdir -p backups rclone
if [ ! -f .env ]; then
  cp .env.example .env
  set_env() { sed -i "s|^$1=.*|$1=\"$2\"|" .env; }
  set_env APP_ENCRYPTION_KEY "$(openssl rand -base64 32)"
  set_env CRON_SECRET "$(openssl rand -hex 24)"
  set_env COOKIE_SECURE true
  set_env SIGNUP_MODE invite
  set_env BACKUP_GPG_PASSPHRASE "$(openssl rand -base64 24 | tr -d '/+=')"
  chmod 600 .env
  say "New secrets in $DIR/.env — save these two now (password manager), apart from the backups:"
  grep -E '^(APP_ENCRYPTION_KEY|BACKUP_GPG_PASSPHRASE)=' .env
  echo "Without APP_ENCRYPTION_KEY a restored backup cannot open its broker keys; without"
  echo "BACKUP_GPG_PASSPHRASE the encrypted backups cannot be opened at all."
fi

say "4/5 starting PPFP (the first build takes 5–10 minutes)"
PROFILES=()
[ -s rclone/rclone.conf ] && PROFILES=(--profile offsite)
$DOCKER compose -f docker-compose.yml -f docker-compose.cloud.yml "${PROFILES[@]}" up -d --build
for _ in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:3000/login && break; sleep 3; done

say "5/5 HTTPS through Tailscale"
sudo tailscale serve --bg http://127.0.0.1:3000 >/dev/null
URL="https://$(tailscale status --json | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1)"
say "Done. Open $URL on a device signed in to the same Tailscale network."
echo "If the page does not load over HTTPS, turn on MagicDNS and HTTPS certificates in the"
echo "Tailscale admin console (DNS page), then run: sudo tailscale serve --bg http://127.0.0.1:3000"
[ ${#PROFILES[@]} -eq 0 ] && echo "Off-site backups are off: see docs/deploy-cloud.md, 'Google Drive로 백업 복사'."
exit 0
