#!/usr/bin/env bash
# Rebuild and restart after uploading a new version of the code:   sudo bash deploy/update.sh
set -euo pipefail
[ "$(id -u)" -eq 0 ] || { echo "Please run with sudo."; exit 1; }
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
set -a; . /etc/album/admin.env; . /etc/album/album.env; set +a
cd "$APP_DIR"; chmod -R a+rX .
npm install --legacy-peer-deps --no-audit --no-fund
PUBLIC_API_URL="$APP_URL" npm run build
( cd worker && npm install --omit=dev --no-audit --no-fund && npm run build:node )
SKIP_SEED=1 bash db/migrate.sh
for f in album-api.service album-cleanup.service album-cleanup.timer album-backup.service album-backup.timer; do sed "s|@APP_DIR@|${APP_DIR}|g" "deploy/systemd/$f" > "/etc/systemd/system/$f"; done
systemctl daemon-reload; systemctl restart album-api.service
sleep 2; curl -fsS http://127.0.0.1:8787/api/auth/ok >/dev/null && echo "Updated. API is running." || { echo "API did not start: journalctl -u album-api -n 50"; exit 1; }
